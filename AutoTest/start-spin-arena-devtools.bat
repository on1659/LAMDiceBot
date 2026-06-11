@echo off
title Spin Arena DevTools Launcher

REM Check if server is up on 5173, start if not
netstat -ano | findstr ":5173 " | findstr "LISTENING" >nul
if errorlevel 1 (
    echo Server not running on 5173. Starting...
    start "LAMDiceBot Server" cmd /k "cd /d %~dp0\.. && set PORT=5173 && node server.js"
    timeout /t 3 /nobreak >nul
) else (
    echo Server already running on 5173.
)

REM Open spin-arena devtools page
start "" "http://localhost:5173/AutoTest/spin-arena-devtools.html"

echo Done. Closing in 2s...
timeout /t 2 /nobreak >nul
