@echo off
chcp 65001 > nul
title LAMDice AutoTest

:: .env PORT 반영 (미설정 시 3000)
if not defined PORT set PORT=3000
set LOCAL_URL=http://localhost:%PORT%

:: 인자가 있으면 직접 실행 모드
if not "%1"=="" goto args_mode

:: 인자가 없으면 메뉴 모드
echo.
echo ========================================
echo   🎰 LAMDice 자동 테스트
echo ========================================
echo.
echo [1] 룰렛 로컬 테스트 (localhost:%PORT%)
echo [2] 룰렛 프로덕션 테스트
echo [3] 다이스 로컬 테스트
echo [4] 다이스 프로덕션 테스트
echo [5] 커스텀 테스트
echo [0] 종료
echo.
echo 또는 인자로 직접 실행:
echo   run-test.bat --clients 5 --rounds 20
echo   run-test.bat --start-delay 5 --delay 3
echo   run-test.bat --game dice --clients 3
echo.

set /p choice="선택: "

if "%choice%"=="1" goto roulette_local
if "%choice%"=="2" goto roulette_prod
if "%choice%"=="3" goto dice_local
if "%choice%"=="4" goto dice_prod
if "%choice%"=="5" goto custom
if "%choice%"=="0" goto end

echo 잘못된 선택입니다.
pause
goto end

:roulette_local
echo.
echo 🚀 룰렛 로컬 서버 테스트 시작...
echo.
node roulette/test-bot.js --url %LOCAL_URL%
pause
goto end

:roulette_prod
echo.
echo 🚀 룰렛 프로덕션 서버 테스트 시작...
echo.
node roulette/test-bot.js --url https://lamdicebot-production.up.railway.app
pause
goto end

:dice_local
echo.
echo 🚀 다이스 로컬 서버 테스트 시작...
echo.
node dice/dice-test-bot.js --url %LOCAL_URL%
pause
goto end

:dice_prod
echo.
echo 🚀 다이스 프로덕션 서버 테스트 시작...
echo.
node dice/dice-test-bot.js --url https://lamdicebot-production.up.railway.app
pause
goto end

:custom
echo.
set /p game="게임 타입 (roulette/dice, 기본 roulette): "
set /p clients="클라이언트 수 (기본 3): "
set /p rounds="테스트 라운드 (기본 10): "
set /p startdelay="시작 딜레이 초 (기본 0): "
set /p delay="라운드 딜레이 초 (기본 0): "
set /p url="서버 URL (기본 localhost:%PORT%): "

if "%game%"=="" set game=roulette
if "%clients%"=="" set clients=3
if "%rounds%"=="" set rounds=10
if "%startdelay%"=="" set startdelay=0
if "%delay%"=="" set delay=0
if "%url%"=="" set url=%LOCAL_URL%

echo.
echo 🚀 커스텀 테스트 시작...
echo    - 게임: %game%
echo    - 클라이언트: %clients%
echo    - 라운드: %rounds%
echo    - 시작딜레이: %startdelay%초
echo    - 라운드딜레이: %delay%초
echo    - URL: %url%
echo.

if "%game%"=="dice" (
    node dice/dice-test-bot.js --url %url% --clients %clients% --rounds %rounds% --start-delay %startdelay% --delay %delay%
) else (
    node roulette/test-bot.js --url %url% --clients %clients% --rounds %rounds% --start-delay %startdelay% --delay %delay%
)
pause
goto end

:: ========== 인자 모드 ==========
:args_mode
set game=roulette
set clients=3
set rounds=10
set startdelay=0
set delay=0
set url=%LOCAL_URL%

:: 인자 파싱
:parse_args
if "%1"=="" goto run_args
if "%1"=="--game" set game=%2& shift & shift & goto parse_args
if "%1"=="--clients" set clients=%2& shift & shift & goto parse_args
if "%1"=="--rounds" set rounds=%2& shift & shift & goto parse_args
if "%1"=="--start-delay" set startdelay=%2& shift & shift & goto parse_args
if "%1"=="--delay" set delay=%2& shift & shift & goto parse_args
if "%1"=="--url" set url=%2& shift & shift & goto parse_args
if "%1"=="--prod" set url=https://lamdicebot-production.up.railway.app& shift & goto parse_args
shift
goto parse_args

:run_args
echo.
echo 🚀 테스트 시작...
echo    - 게임: %game%
echo    - 클라이언트: %clients%
echo    - 라운드: %rounds%
echo    - 시작딜레이: %startdelay%초
echo    - 라운드딜레이: %delay%초
echo    - URL: %url%
echo.

if "%game%"=="dice" (
    node dice/dice-test-bot.js --url %url% --clients %clients% --rounds %rounds% --start-delay %startdelay% --delay %delay%
) else (
    node roulette/test-bot.js --url %url% --clients %clients% --rounds %rounds% --start-delay %startdelay% --delay %delay%
)
goto end

:end

