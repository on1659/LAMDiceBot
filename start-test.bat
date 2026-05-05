@echo off
title LAMDiceBot Test Launcher (port 5173)

echo ============================================
echo   LAMDiceBot Test Environment (port 5173)
echo ============================================
echo.

REM 1. Node.js check
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not installed. Get it from https://nodejs.org
    pause
    exit /b 1
)

REM 2. Kill process on port 5173 if any
echo [1/3] Checking port 5173...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    echo        Killing existing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

REM 3. Start server with PORT=5173
echo [2/3] Starting server on port 5173...
start "LAMDiceBot Server" cmd /k "cd /d %~dp0 && set PORT=5173&& node server.js"

REM 4. Wait for boot
echo        Waiting 3s for server boot...
timeout /t 3 /nobreak >nul

REM 5. Open browser tabs
echo [3/3] Opening browser tabs...
start "" "http://localhost:5173/AutoTest/horse-devtools.html"
start "" "http://localhost:5173/horse-race"
start "" "http://localhost:5173/horse-race"

echo.
echo ============================================
echo   Done
echo ============================================
echo   - DevTools : bot join/bet/ready/vote
echo   - Game x2  : host / guest manual
echo.
echo   Stop server: Ctrl+C in "LAMDiceBot Server" window
echo.
pause
