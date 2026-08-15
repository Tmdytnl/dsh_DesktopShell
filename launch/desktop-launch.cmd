@echo off
setlocal EnableExtensions
rem ============================================================
rem DeepSeek Harness - desktop launcher (Productization v1, v0.1.4)
rem
rem Responsibilities (thin, debug-friendly, may be run directly):
rem   1. resolve the installed package root (this folder's parent)
rem   2. verify the Electron runtime (fail-fast, never silently downloads)
rem   3. verify the dsh CLI resolves through PATH
rem   4. run  dsh web --patch <desktop-app.patch.yml> --port 0
rem      in the CURRENT working directory - the Windows shortcut's
rem      Working Directory owns the workspace, NOT this script.
rem
rem FAIL-FAST CONTRACT: any preflight check that fails writes one log line
rem plus one notification popup and TERMINATES the launcher (goto :fail ->
rem exit /b 1). It is structurally impossible to continue into
rem "dsh web ..." after a preflight failure.
rem
rem Deliberately NOT done here: PID checks, port polling, process
rem supervision, waiting on Electron, closing Node. Lifecycle belongs
rem to desktop-app + ctx.appExit (frozen).
rem ============================================================

set "LAUNCH_DIR=%~dp0"
set "PKG_ROOT=%~dp0.."
set "PATCH=%LAUNCH_DIR%desktop-app.patch.yml"
set "LOG_DIR=%LOCALAPPDATA%\dsh-desktop-shell\logs"
set "LOG_FILE=%LOG_DIR%\launcher.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul

rem ---- 1. patch must exist (absolute path; cwd is never changed) ----
if not exist "%PATCH%" (
  set "FAIL_MSG=desktop-app.patch.yml missing (%PATCH%)"
  goto :fail
)

rem ---- 2. Electron runtime must be ready (check only; fast fail) ----
call "%PKG_ROOT%\scripts\ensure-electron-runtime.cmd" --check >nul 2>&1
if errorlevel 1 (
  rem record the detailed reason, then terminate
  call "%PKG_ROOT%\scripts\ensure-electron-runtime.cmd" --check >> "%LOG_FILE%" 2>&1
  set "FAIL_MSG=electron runtime not ready - run scripts\install-desktop.cmd once"
  goto :fail
)

rem ---- 3. dsh CLI must resolve through PATH (no legacy fallbacks) ----
where dsh >nul 2>&1
if errorlevel 1 (
  set "FAIL_MSG=dsh command not found in PATH"
  goto :fail
)

rem ---- 4. launch Desktop App Mode in the current working directory ----
dsh web --patch "%PATCH%" --port 0
exit /b %errorlevel%

rem ---- fail-fast terminal: log + popup, then exit 1 (never returns) ----
:fail
echo %date% %time%  [desktop-launch] FAIL: %FAIL_MSG% >> "%LOG_FILE%"
> "%TEMP%\dsh-desktop-launch-failure.vbs" echo MsgBox "DeepSeek Harness failed to start." ^& vbCrLf ^& "Reason: %FAIL_MSG%" ^& vbCrLf ^& "Log: %LOG_FILE%", 48, "DeepSeek Harness"
wscript.exe "%TEMP%\dsh-desktop-launch-failure.vbs" 2>nul
exit /b 1
