param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ParentTaskId,

  [Parameter(Mandatory = $true, Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$TextParts,

  [string]$GistId = $env:MGTD_GIST_ID,
  [string]$Token = $env:MGTD_GIST_TOKEN,
  [string]$InboxFile = 'monkeygtd-inbox.ndjson'
)

if ($TextParts.Length -gt 0) {
  $first = [string]$TextParts[0]
  if ($first -eq $ParentTaskId -or $first -eq "#task-$ParentTaskId") {
    if ($TextParts.Length -gt 1) {
      $TextParts = $TextParts[1..($TextParts.Length - 1)]
    } else {
      $TextParts = @()
    }
  }
}

$content = ($TextParts -join ' ').Trim()
if ([string]::IsNullOrWhiteSpace($content)) {
  throw 'Task text is required after ParentTaskId.'
}

$scriptPath = Join-Path $PSScriptRoot 'send-gist-task.ps1'
& $scriptPath -ParentTaskId $ParentTaskId -Content $content -GistId $GistId -Token $Token -InboxFile $InboxFile
