@echo off
setlocal
cd /d "%~dp0"
title Xiangqi

if not exist "server.js" (
  echo.
  echo Startup failed: server.js was not found.
  echo Please extract the whole ZIP file before running it.
  echo.
  pause
  exit /b 1
)

if not exist "engine\Pikafish-Windows-x86-64-universal.exe" (
  echo.
  echo Startup failed: the Pikafish engine was not found.
  echo Please make sure the engine folder is complete.
  echo.
  pause
  exit /b 1
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo.
  echo Startup failed: Node.js was not found.
  echo Install Node.js 20 or newer from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo Starting Xiangqi. The browser should open automatically.
echo If it does not open, use the local address shown below.
echo.

node "%~dp0server.js"

echo.
echo Xiangqi has exited.
echo If an error is shown above, keep this window open for troubleshooting.
pause
exit /b 0
