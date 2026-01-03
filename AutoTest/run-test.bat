@echo off
chcp 65001 > nul
title LAMDice AutoTest

echo.
echo ========================================
echo   🎰 LAMDice 자동 테스트
echo ========================================
echo.
echo [1] 로컬 서버 테스트 (localhost:3000)
echo [2] 프로덕션 서버 테스트
echo [3] UI 테스트 (브라우저)
echo [4] UI 테스트 (헤드리스)
echo [5] 커스텀 테스트
echo [0] 종료
echo.

set /p choice="선택: "

if "%choice%"=="1" goto local
if "%choice%"=="2" goto prod
if "%choice%"=="3" goto ui
if "%choice%"=="4" goto ui_headless
if "%choice%"=="5" goto custom
if "%choice%"=="0" goto end

echo 잘못된 선택입니다.
pause
goto end

:local
echo.
echo 🚀 로컬 서버 테스트 시작...
echo.
node test-bot.js --url http://localhost:3000
pause
goto end

:prod
echo.
echo 🚀 프로덕션 서버 테스트 시작...
echo.
node test-bot.js --url https://lamdicebot-production.up.railway.app
pause
goto end

:ui
echo.
echo 🚀 UI 테스트 시작 (브라우저)...
echo.
node ui-test.js
pause
goto end

:ui_headless
echo.
echo 🚀 UI 테스트 시작 (헤드리스)...
echo.
node ui-test.js --headless
pause
goto end

:custom
echo.
set /p clients="클라이언트 수 (기본 3): "
set /p rounds="테스트 라운드 (기본 10): "
set /p url="서버 URL (기본 localhost:3000): "

if "%clients%"=="" set clients=3
if "%rounds%"=="" set rounds=10
if "%url%"=="" set url=http://localhost:3000

echo.
echo 🚀 커스텀 테스트 시작...
echo    - 클라이언트: %clients%
echo    - 라운드: %rounds%
echo    - URL: %url%
echo.
node test-bot.js --url %url% --clients %clients% --rounds %rounds%
pause
goto end

:end

