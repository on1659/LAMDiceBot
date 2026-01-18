@echo off
chcp 65001 > nul
echo ========================================
echo 🚀 LAMDiceBot 서버 시작
echo ========================================
echo.

REM Node.js 설치 확인
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js가 설치되어 있지 않습니다.
    echo    https://nodejs.org 에서 Node.js를 설치해주세요.
    pause
    exit /b 1
)

echo ✅ Node.js 버전 확인 중...
node --version
echo.

REM 의존성 확인
if not exist "node_modules" (
    echo 📦 의존성 패키지 설치 중...
    call npm install
    if %errorlevel% neq 0 (
        echo ❌ 의존성 설치 실패
        pause
        exit /b 1
    )
    echo ✅ 의존성 설치 완료
    echo.
) else (
    echo ✅ 의존성 패키지 확인됨
    echo.
)

REM 프론트엔드 빌드 확인
if not exist "dist" (
    echo 🏗️  프론트엔드 빌드 중...
    call npm run build
    if %errorlevel% neq 0 (
        echo ❌ 빌드 실패
        pause
        exit /b 1
    )
    echo ✅ 빌드 완료
    echo.
) else (
    echo ✅ 빌드된 파일 확인됨
    echo.
)

REM 환경 변수 파일 확인
if not exist ".env" (
    echo ⚠️  .env 파일이 없습니다.
    echo    DATABASE_URL과 ADMIN_PASSWORD를 설정해주세요.
    echo.
)

echo ========================================
echo 🎮 서버 시작 중...
echo ========================================
echo.
echo 📍 서버 주소: http://localhost:3000
echo 📍 React 앱: http://localhost:5173 (개발 모드)
echo.
echo 종료하려면 Ctrl+C를 누르세요.
echo.

REM 서버 실행
call npm start

pause
