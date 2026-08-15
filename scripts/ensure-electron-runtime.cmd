@echo off
REM dsh-desktop-shell — thin wrapper; all logic lives in ensure-electron-runtime.mjs
node "%~dp0ensure-electron-runtime.mjs" %*
exit /b %ERRORLEVEL%
