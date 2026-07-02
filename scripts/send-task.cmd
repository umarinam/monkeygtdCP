@echo off
setlocal

if "%~1"=="" (
  echo Usage: send-task.cmd PARENT_TASK_ID TASK_TEXT
  echo Example: send-task.cmd abc123 Buy milk
  exit /b 1
)

if "%~2"=="" (
  echo Usage: send-task.cmd PARENT_TASK_ID TASK_TEXT
  echo Example: send-task.cmd abc123 Buy milk
  exit /b 1
)

set "PARENT=%~1"
shift
set "TASK_TEXT=%*"

powershell -ExecutionPolicy Bypass -File "%~dp0send-task.ps1" "%PARENT%" %TASK_TEXT%
