# Kept for backward compatibility: queues an addChild request in the Gist inbox.
# send-task.ps1 does the work, and also supports -Inbox / -ListId, -Due / -Asap and -Provider repo.
param(
  [Parameter(Mandatory = $true)]
  [string]$ParentTaskId,

  [Parameter(Mandatory = $true)]
  [string]$Content,

  [string]$GistId = $env:MGTD_GIST_ID,
  [string]$Token = $env:MGTD_GIST_TOKEN,
  [string]$InboxFile = 'monkeygtd-inbox.ndjson'
)

$scriptPath = Join-Path $PSScriptRoot 'send-task.ps1'
& $scriptPath -Provider gist -ParentTaskId $ParentTaskId -TextParts $Content -GistId $GistId -Token $Token -InboxFile $InboxFile
