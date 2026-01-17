@echo off
chcp 65001 >nul
echo 🤖 주사위 게임 테스트 봇 실행 스크립트
echo ==================================
echo.

REM 서버가 실행 중인지 확인
echo 📡 서버 연결 확인 중...
curl -s http://localhost:3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ 서버가 실행 중입니다.
) else (
    echo ❌ 서버가 실행되지 않았습니다!
    echo    먼저 'node server.js'를 실행해주세요.
    pause
    exit /b 1
)

echo.
echo 🚀 테스트 봇 시작...
echo.

REM 봇 실행
node dice-test-bot.js

pause
