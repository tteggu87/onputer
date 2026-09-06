@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org then reopen this file.
  popd
  pause
  exit /b 1
)
node "%~dp0scripts\launch.mjs" %*
set "ONPUTER_EXIT=%ERRORLEVEL%"
popd
if not "%ONPUTER_EXIT%"=="0" pause
exit /b %ONPUTER_EXIT%
