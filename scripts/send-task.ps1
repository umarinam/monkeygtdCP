<#
.SYNOPSIS
Queue a MonkeyGTD task in the sync inbox (GitHub Gist or GitHub repo).

.DESCRIPTION
The app imports queued tasks on its next sync (js/infra/gist-sync.js and
js/infra/repo-sync.js), the same way it imports tasks sent from Inbox.html.

ParentTaskId may also be a permalink (#task-<id> or a full URL ending in it).
With -Inbox or -ListId every positional word is task text.

Environment variables:
  Gist: MGTD_GIST_ID, MGTD_GIST_TOKEN
  Repo: MGTD_REPO_TOKEN, MGTD_REPO_OWNER, MGTD_REPO_NAME,
        MGTD_REPO_BRANCH      (default: main)
        MGTD_REPO_PATH        (backup file; default: monkeygtd-backup.json)
        MGTD_REPO_INBOX_PATH  (default: monkeygtd-inbox.ndjson next to the backup file)
  MGTD_SYNC_PROVIDER (gist or repo) picks the default for -Provider.

.EXAMPLE
./send-task.ps1 abc123 Buy milk

.EXAMPLE
./send-task.ps1 -Inbox Call the dentist -Due 2026-10-05

.EXAMPLE
./send-task.ps1 -ListId l42 -Provider repo Renew passport -Asap
#>
[CmdletBinding(DefaultParameterSetName = 'Child')]
param(
  [Parameter(ParameterSetName = 'Child', Mandatory = $true, Position = 0)]
  [string]$ParentTaskId,

  [Parameter(ParameterSetName = 'Inbox', Mandatory = $true)]
  [switch]$Inbox,

  [Parameter(ParameterSetName = 'List', Mandatory = $true)]
  [string]$ListId,

  [Parameter(ParameterSetName = 'Child', Mandatory = $true, Position = 1, ValueFromRemainingArguments = $true)]
  [Parameter(ParameterSetName = 'Inbox', Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [Parameter(ParameterSetName = 'List', Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$TextParts,

  [string]$Due = '',
  [switch]$Asap,

  [string]$Provider = $env:MGTD_SYNC_PROVIDER,
  [string]$Token = '',

  [string]$GistId = $env:MGTD_GIST_ID,
  [string]$InboxFile = 'monkeygtd-inbox.ndjson',

  [string]$RepoOwner = $env:MGTD_REPO_OWNER,
  [string]$RepoName = $env:MGTD_REPO_NAME,
  [string]$RepoBranch = $env:MGTD_REPO_BRANCH,
  [string]$RepoPath = $env:MGTD_REPO_PATH,
  [string]$RepoInboxPath = $env:MGTD_REPO_INBOX_PATH,

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Overridable so tests can point the script at a local stub server.
$GitHubApiUrl = if ($env:MGTD_GITHUB_API_URL) { $env:MGTD_GITHUB_API_URL.TrimEnd('/') } else { 'https://api.github.com' }

function Get-ParentTaskIdFromInput([string]$Value) {
  # Accept a bare id, '#task-<id>', or a full permalink URL ending in '#task-<id>'.
  return ([string]$Value -replace '^.*#task-', '').Trim()
}

function Get-DefaultRepoInboxPath([string]$BackupPath) {
  # Mirrors repoDefaultInboxPath() in js/infra/repo-sync.js.
  $path = ([string]$BackupPath).Trim()
  if (-not $path) { $path = 'monkeygtd-backup.json' }
  $idx = $path.LastIndexOf('/')
  if ($idx -lt 0) { return 'monkeygtd-inbox.ndjson' }
  return $path.Substring(0, $idx) + '/monkeygtd-inbox.ndjson'
}

function Join-InboxLine([string]$Existing, [string]$Line) {
  $trimmed = ([string]$Existing).TrimEnd("`r", "`n")
  if ([string]::IsNullOrWhiteSpace($trimmed)) { return $Line }
  return "$trimmed`n$Line"
}

function Get-HttpStatus($ErrorRecord) {
  $response = $ErrorRecord.Exception.Response
  if ($response -and $response.StatusCode) { return [int]$response.StatusCode }
  return 0
}

function Invoke-GitHubJson([string]$Method, [string]$Uri, [string]$AuthToken, $Body = $null) {
  $params = @{
    Uri     = $Uri
    Method  = $Method
    Headers = @{
      Accept        = 'application/vnd.github+json'
      Authorization = "token $AuthToken"
      'User-Agent'  = 'MonkeyGTD-CLI'
    }
  }
  if ($null -ne $Body) {
    # Send UTF-8 bytes; Windows PowerShell 5.1 would otherwise encode a string body as ISO-8859-1.
    $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress))
    $params.ContentType = 'application/json; charset=utf-8'
  }
  return Invoke-RestMethod @params
}

function Get-Utf8Text([string]$Uri, [hashtable]$Headers) {
  $res = Invoke-WebRequest -Uri $Uri -Method Get -Headers $Headers -UseBasicParsing
  return [Text.Encoding]::UTF8.GetString($res.RawContentStream.ToArray())
}

function Add-GistInboxLine([string]$Id, [string]$AuthToken, [string]$FileName, [string]$Line) {
  $gistUrl = "$GitHubApiUrl/gists/$([uri]::EscapeDataString($Id))"
  $meta = Invoke-GitHubJson 'Get' $gistUrl $AuthToken

  $existing = ''
  $fileInfo = $meta.files.PSObject.Properties[$FileName]
  if ($fileInfo) {
    $file = $fileInfo.Value
    if (-not $file.truncated) {
      $existing = [string]$file.content
    } elseif ($file.raw_url) {
      $existing = Get-Utf8Text $file.raw_url @{ 'User-Agent' = 'MonkeyGTD-CLI' }
    }
  }

  $body = @{ files = @{ $FileName = @{ content = (Join-InboxLine $existing $Line) } } }
  Invoke-GitHubJson 'Patch' $gistUrl $AuthToken $body | Out-Null
}

function Add-RepoInboxLine([string]$Owner, [string]$Name, [string]$Branch, [string]$Path, [string]$AuthToken, [string]$Line) {
  $encodedPath = ($Path -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
  $url = "$GitHubApiUrl/repos/$([uri]::EscapeDataString($Owner))/$([uri]::EscapeDataString($Name))/contents/$encodedPath"
  $readUrl = "${url}?ref=$([uri]::EscapeDataString($Branch))"

  $existing = ''
  $sha = ''
  $meta = $null
  try {
    $meta = Invoke-GitHubJson 'Get' $readUrl $AuthToken
  } catch {
    if ((Get-HttpStatus $_) -ne 404) { throw }
  }

  if ($meta -is [array]) {
    throw "Repo inbox path points to a directory: $Path"
  }
  if ($meta) {
    $sha = [string]$meta.sha
    $encoded = ([string]$meta.content) -replace '\s', ''
    if ($encoded) {
      $existing = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
    } elseif ($meta.size) {
      # Files over 1 MB come back without inline content.
      $existing = Get-Utf8Text $readUrl @{
        Accept        = 'application/vnd.github.raw'
        Authorization = "token $AuthToken"
        'User-Agent'  = 'MonkeyGTD-CLI'
      }
    }
  }

  $body = [ordered]@{
    message = "MonkeyGTD inbox queue $((Get-Date).ToUniversalTime().ToString('o'))"
    content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Join-InboxLine $existing $Line)))
    branch  = $Branch
  }
  if ($sha) { $body.sha = $sha }
  Invoke-GitHubJson 'Put' $url $AuthToken $body | Out-Null
}

$Provider = ([string]$Provider).Trim().ToLowerInvariant()
if (-not $Provider) { $Provider = 'gist' }
if ($Provider -notin @('gist', 'repo')) {
  throw "Unknown Provider '$Provider'. Use gist or repo."
}

$words = @($TextParts | Where-Object { $null -ne $_ })
$ListId = ([string]$ListId).Trim()
$parentId = ''
if ($PSCmdlet.ParameterSetName -eq 'Child') {
  $action = 'addChild'
  $parentId = Get-ParentTaskIdFromInput $ParentTaskId
  if (-not $parentId) {
    throw 'ParentTaskId is required (or pass -Inbox / -ListId).'
  }
  # Tolerate the parent id being repeated as the first word of the text.
  if ($words.Count -gt 0 -and (Get-ParentTaskIdFromInput $words[0]) -eq $parentId) {
    $words = @($words | Select-Object -Skip 1)
  }
} else {
  $action = 'addInbox'
}

$content = ($words -join ' ').Trim()
if ([string]::IsNullOrWhiteSpace($content)) {
  throw 'Task text is required.'
}

$Due = ([string]$Due).Trim()
if ($Due -and $Asap) {
  throw 'Pass either -Due or -Asap, not both.'
}
if ($Due) {
  $parsedDue = [datetime]::MinValue
  $validDue = ($Due -match '^\d{4}-\d{2}-\d{2}$') -and [datetime]::TryParseExact(
    $Due, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::None, [ref]$parsedDue)
  if (-not $validDue) {
    throw "Invalid -Due '$Due'. Use YYYY-MM-DD."
  }
}

$request = [ordered]@{
  id     = [guid]::NewGuid().ToString()
  action = $action
}
if ($parentId) {
  $request.parentTaskId = $parentId
} elseif ($ListId) {
  $request.listId = $ListId
}
$request.content = $content
if ($Due) {
  $request.due = $Due
} elseif ($Asap) {
  $request.due_asap = $true
}
$request.at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$request.source = 'powershell-cli'

$line = $request | ConvertTo-Json -Compress

if ($Provider -eq 'gist') {
  $GistId = ([string]$GistId).Trim()
  if (-not $Token) { $Token = $env:MGTD_GIST_TOKEN }
  $gistLabel = if ($GistId) { $GistId } else { '<MGTD_GIST_ID not set>' }
  $target = "gist '$gistLabel' file '$InboxFile'"
} else {
  $RepoOwner = ([string]$RepoOwner).Trim()
  $RepoName = ([string]$RepoName).Trim()
  $RepoBranch = ([string]$RepoBranch).Trim()
  if (-not $RepoBranch) { $RepoBranch = 'main' }
  $RepoInboxPath = ([string]$RepoInboxPath).Trim()
  if (-not $RepoInboxPath) { $RepoInboxPath = Get-DefaultRepoInboxPath $RepoPath }
  if (-not $Token) { $Token = $env:MGTD_REPO_TOKEN }
  $ownerLabel = if ($RepoOwner) { $RepoOwner } else { '<owner>' }
  $nameLabel = if ($RepoName) { $RepoName } else { '<name>' }
  $target = "repo '$ownerLabel/$nameLabel' branch '$RepoBranch' file '$RepoInboxPath'"
}

if ($DryRun) {
  [Console]::Error.WriteLine("Dry run: would queue $action to $target")
  $stdout = [Console]::OpenStandardOutput()
  $bytes = [Text.Encoding]::UTF8.GetBytes("$line`n")
  $stdout.Write($bytes, 0, $bytes.Length)
  $stdout.Flush()
  return
}

if ($Provider -eq 'gist') {
  if (-not $GistId) {
    throw 'Missing GistId. Pass -GistId or set MGTD_GIST_ID.'
  }
  if ([string]::IsNullOrWhiteSpace($Token)) {
    throw 'Missing Token. Pass -Token or set MGTD_GIST_TOKEN.'
  }
  Add-GistInboxLine $GistId $Token $InboxFile $line
} else {
  if (-not $RepoOwner -or -not $RepoName) {
    throw 'Missing repo. Pass -RepoOwner/-RepoName or set MGTD_REPO_OWNER/MGTD_REPO_NAME.'
  }
  if ([string]::IsNullOrWhiteSpace($Token)) {
    throw 'Missing Token. Pass -Token or set MGTD_REPO_TOKEN.'
  }
  Add-RepoInboxLine $RepoOwner $RepoName $RepoBranch $RepoInboxPath $Token $line
}

$what = if ($parentId) { "for parent '$parentId'" } elseif ($ListId) { "for list '$ListId'" } else { 'for the Inbox list' }
Write-Host "Queued $action request $what in $target."
