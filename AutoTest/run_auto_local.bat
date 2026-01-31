@echo off
chcp 65001 > nul

REM ========== 설정 (.env PORT 미설정 시 3000) ==========
if not defined PORT set PORT=3000
set TEST_URL=http://localhost:%PORT%
set CLIENT_COUNT=4
set TEST_COUNT=5

REM ========== 실행 ==========
echo.
echo 🎰 LAMDice 자동 테스트
echo ========================================
echo    URL: %TEST_URL%
echo    클라이언트: %CLIENT_COUNT%명
echo    테스트: %TEST_COUNT%회
echo ========================================
echo.

node test-bot.js --url %TEST_URL% --clients %CLIENT_COUNT% --rounds %TEST_COUNT%

pause
