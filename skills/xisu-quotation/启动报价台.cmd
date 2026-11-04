@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install Node.js and try again.
  pause
  exit /b 1
)
if "%QUOTE_PASSWORD%"=="" (
  echo Set the QUOTE_PASSWORD environment variable before starting.
  echo Example: set QUOTE_PASSWORD=your-secret
  echo Do not put the password in this file.
  pause
  exit /b 1
)
node scripts\web-server.cjs --open
if errorlevel 1 pause
