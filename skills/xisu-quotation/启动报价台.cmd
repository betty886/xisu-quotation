@echo off
setlocal
cd /d "%~dp0" || exit /b 1
where node >nul 2>nul
if errorlevel 1 if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
node scripts\web-server.cjs --open --temporary-password
if errorlevel 1 pause
