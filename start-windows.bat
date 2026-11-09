@echo off
rem Double-click to start Claude Code Office (needs Node.js 18+ from https://nodejs.org).
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js 18 or newer is required: https://nodejs.org
  pause
  exit /b 1
)
node server.js --open
pause
