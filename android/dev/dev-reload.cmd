@echo off
rem Streamo Android — dev hot-reload (watch + incremental build + reinstall + relaunch)
rem Usage: dev\dev-reload.cmd [optional-device-serial]
setlocal
cd /d "%~dp0.."
node "%~dp0dev-reload.mjs" %*
endlocal
