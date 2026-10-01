@echo off
setlocal

rem Wrapper around send-task.ps1 that keeps the task text together as one argument.
rem Options may appear anywhere: --inbox, --list-id LIST_ID, --due YYYY-MM-DD, --asap,
rem --provider gist^|repo, --dry-run. Everything else is the parent id and task text.
rem Arguments are only expanded outside ( ) blocks, so text like "(2L)" stays intact.

set "TARGET=child"
set "PS_OPTS="
set "FIRST="
set "REST="

:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="--inbox" goto :opt_inbox
if /i "%~1"=="--list-id" goto :opt_list
if /i "%~1"=="--due" goto :opt_due
if /i "%~1"=="--asap" goto :opt_asap
if /i "%~1"=="--provider" goto :opt_provider
if /i "%~1"=="--dry-run" goto :opt_dry_run
if defined FIRST goto :add_rest
set "FIRST=%~1"
goto :next_arg
:add_rest
if defined REST goto :append_rest
set "REST=%~1"
goto :next_arg
:append_rest
set "REST=%REST% %~1"
:next_arg
shift
goto :parse

:opt_inbox
set "TARGET=inbox"
shift
goto :parse

:opt_list
if "%~2"=="" goto :usage
set "TARGET=list"
set PS_OPTS=%PS_OPTS% -ListId "%~2"
shift
shift
goto :parse

:opt_due
if "%~2"=="" goto :usage
set PS_OPTS=%PS_OPTS% -Due "%~2"
shift
shift
goto :parse

:opt_asap
set PS_OPTS=%PS_OPTS% -Asap
shift
goto :parse

:opt_provider
if "%~2"=="" goto :usage
set PS_OPTS=%PS_OPTS% -Provider "%~2"
shift
shift
goto :parse

:opt_dry_run
set PS_OPTS=%PS_OPTS% -DryRun
shift
goto :parse

:parsed
set "PS_SCRIPT=%~dp0send-task.ps1"
if not exist "%PS_SCRIPT%" set "PS_SCRIPT=%~dp0scripts\send-task.ps1"
if not exist "%PS_SCRIPT%" (
	echo Could not find send-task.ps1 next to this script.
	exit /b 1
)

if not defined FIRST goto :usage
if "%TARGET%"=="child" goto :send_child

rem --inbox / --list-id: every word is task text.
set "TASK_TEXT=%FIRST%"
if defined REST set "TASK_TEXT=%FIRST% %REST%"
if "%TARGET%"=="inbox" set PS_OPTS=%PS_OPTS% -Inbox
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %PS_OPTS% -TextParts "%TASK_TEXT%"
goto :done

:send_child
if not defined REST goto :usage
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %PS_OPTS% -ParentTaskId "%FIRST%" -TextParts "%REST%"

:done
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
	echo Failed to queue task. Exit code: %ERR%
)

exit /b %ERR%

:usage
echo Usage: send-task.cmd PARENT_TASK_ID TASK_TEXT [options]
echo        send-task.cmd --inbox TASK_TEXT [options]
echo        send-task.cmd --list-id LIST_ID TASK_TEXT [options]
echo Options: --due YYYY-MM-DD, --asap, --provider gist^|repo, --dry-run
echo Example: send-task.cmd abc123 Buy milk --due 2026-10-05
echo Tip: You can also pass permalink form, e.g. #task-abc123
exit /b 1
