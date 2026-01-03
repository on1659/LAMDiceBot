@echo off
chcp 65001 > nul

REM ========== 설정 ==========
set TEST_URL=https://lamdicebot-production.up.railway.app/
set CLIENT_COUNT=4
set TEST_COUNT=15

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
