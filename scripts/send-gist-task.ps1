param(
  [Parameter(Mandatory = $true)]
  [string]$ParentTaskId,

  [Parameter(Mandatory = $true)]
  [string]$Content,

  [string]$GistId = $env:MGTD_GIST_ID,
  [string]$Token = $env:MGTD_GIST_TOKEN,
  [string]$InboxFile = 'monkeygtd-inbox.ndjson'
)

if ([string]::IsNullOrWhiteSpace($GistId)) {
  throw 'Missing GistId. Pass -GistId or set MGTD_GIST_ID.'
}

if ([string]::IsNullOrWhiteSpace($Token)) {
  throw 'Missing Token. Pass -Token or set MGTD_GIST_TOKEN.'
}

if ([string]::IsNullOrWhiteSpace($ParentTaskId)) {
  throw 'ParentTaskId is required.'
}

if ([string]::IsNullOrWhiteSpace($Content)) {
  throw 'Content is required.'
}

$headers = @{
  Accept        = 'application/vnd.github+json'
  Authorization = "token $Token"
  'User-Agent'  = 'MonkeyGTD-CLI'
}

$gistUrl = "https://api.github.com/gists/$GistId"
$meta = Invoke-RestMethod -Uri $gistUrl -Headers $headers -Method Get

$existing = ''
$fileInfo = $meta.files.PSObject.Properties[$InboxFile]
if ($fileInfo) {
  $file = $fileInfo.Value
  if (-not $file.truncated) {
    $existing = [string]$file.content
  } elseif ($file.raw_url) {
    $existing = [string](Invoke-WebRequest -Uri $file.raw_url -Method Get).Content
  }
}

$lineObject = @{
  id           = [guid]::NewGuid().ToString()
  action       = 'addChild'
  parentTaskId = $ParentTaskId
  content      = $Content
  at           = (Get-Date).ToString('o')
  source       = 'powershell-cli'
}

$line = $lineObject | ConvertTo-Json -Compress
$trimmed = ($existing -as [string]).TrimEnd("`r", "`n")
if ([string]::IsNullOrWhiteSpace($trimmed)) {
  $newContent = $line
} else {
  $newContent = "$trimmed`n$line"
}

$patchBody = @{
  files = @{
    $InboxFile = @{
      content = $newContent
    }
  }
} | ConvertTo-Json -Depth 8 -Compress

Invoke-RestMethod -Uri $gistUrl -Headers $headers -Method Patch -ContentType 'application/json' -Body $patchBody | Out-Null

Write-Host "Queued addChild request for parent '$ParentTaskId' in '$InboxFile'."
