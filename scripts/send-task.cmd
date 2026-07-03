@echo off
setlocal

if "%~1"=="" goto :usage

set "PARENT_RAW=%~1"
set "PARENT=%PARENT_RAW:#task-=%"

shift
if "%~1"=="" goto :usage

set "TASK_TEXT=%~1"
:collect_text
shift
if "%~1"=="" goto :have_text
set "TASK_TEXT=%TASK_TEXT% %~1"
goto :collect_text

:have_text

set "PS_SCRIPT=%~dp0send-task.ps1"
if not exist "%PS_SCRIPT%" set "PS_SCRIPT=%~dp0scripts\send-task.ps1"
if not exist "%PS_SCRIPT%" (
	echo Could not find send-task.ps1 next to this script.
	exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" "%PARENT%" "%TASK_TEXT%"
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
	echo Failed to queue task. Exit code: %ERR%
)

exit /b %ERR%

:usage
echo Usage: send-task.cmd PARENT_TASK_ID TASK_TEXT
echo Example: send-task.cmd abc123 Buy milk
echo Tip: You can also pass permalink form, e.g. #task-abc123
exit /b 1
