@echo off
rem DeepSeek Harness - desktop setup thin shell (Productization v1).
rem All logic lives in install-desktop.mjs (node); this shim only forwards.
node "%~dp0install-desktop.mjs" %*
exit /b %errorlevel%
