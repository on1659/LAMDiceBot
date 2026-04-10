ㅈ@echo off
chcp 65001 >nul 2>&1
title Claude Code Remote Control 설정

echo ============================================
echo   Claude Code Remote Control 설정 도우미
echo ============================================
echo.

:: 1. Node.js 버전 확인
echo [1/5] Node.js 버전 확인 중...
for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VER=%%i
if "%NODE_VER%"=="" (
    echo [오류] Node.js가 설치되어 있지 않습니다.
    echo        https://nodejs.org 에서 22 LTS를 설치하세요.
    pause
    exit /b 1
)
echo        Node.js %NODE_VER% 감지됨
echo.

:: 2. Claude Code 버전 확인
echo [2/5] Claude Code 버전 확인 중...
for /f "tokens=*" %%i in ('claude --version 2^>nul') do set CLAUDE_VER=%%i
if "%CLAUDE_VER%"=="" (
    echo [오류] Claude Code가 설치되어 있지 않습니다.
    echo        설치를 진행합니다...
    goto :INSTALL_NATIVE
)
echo        Claude Code %CLAUDE_VER% 감지됨
echo.

:: 3. 설치 방법 선택
echo [3/5] 설치 방법을 선택하세요:
echo.
echo   1. 네이티브 인스톨러로 재설치 (권장 - sdk-url 에러 해결)
echo   2. npm 업데이트만 시도
echo   3. 기존 npm 설치 마이그레이션
echo   4. 클린 재설치 (npm 제거 후 네이티브 설치)
echo   5. 바로 Remote Control 실행 (이미 정상 작동하는 경우)
echo.
set /p CHOICE="선택 (1-5): "

if "%CHOICE%"=="1" goto :INSTALL_NATIVE
if "%CHOICE%"=="2" goto :NPM_UPDATE
if "%CHOICE%"=="3" goto :MIGRATE
if "%CHOICE%"=="4" goto :CLEAN_INSTALL
if "%CHOICE%"=="5" goto :RUN_RC
echo [오류] 잘못된 선택입니다.
pause
exit /b 1

:INSTALL_NATIVE
echo.
echo [작업] 네이티브 인스톨러로 설치 중...
echo        (PowerShell이 실행됩니다)
powershell -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"
if %ERRORLEVEL% NEQ 0 (
    echo [오류] 네이티브 설치 실패. 관리자 권한으로 다시 시도하세요.
    pause
    exit /b 1
)
echo [완료] 네이티브 설치 완료!
echo        터미널을 재시작한 후 이 배치파일을 다시 실행하고 5번을 선택하세요.
pause
exit /b 0

:NPM_UPDATE
echo.
echo [작업] npm으로 Claude Code 업데이트 중...
call npm update -g @anthropic-ai/claude-code
echo [완료] 업데이트 완료!
goto :RUN_RC

:MIGRATE
echo.
echo [작업] 네이티브 설치로 마이그레이션 중...
call claude migrate-installer
if %ERRORLEVEL% NEQ 0 (
    echo [오류] 마이그레이션 실패. 1번(네이티브 설치)을 시도하세요.
    pause
    exit /b 1
)
echo [완료] 마이그레이션 완료!
echo        터미널을 재시작한 후 이 배치파일을 다시 실행하고 5번을 선택하세요.
pause
exit /b 0

:CLEAN_INSTALL
echo.
echo [작업] 기존 npm 설치 제거 중...
call npm uninstall -g @anthropic-ai/claude-code
echo [작업] 네이티브 인스톨러로 설치 중...
powershell -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"
if %ERRORLEVEL% NEQ 0 (
    echo [오류] 네이티브 설치 실패.
    pause
    exit /b 1
)
echo [완료] 클린 재설치 완료!
echo        터미널을 재시작한 후 이 배치파일을 다시 실행하고 5번을 선택하세요.
pause
exit /b 0

:RUN_RC
echo.
echo [4/5] 재로그인 확인...
echo        (이미 로그인되어 있으면 건너뛰셔도 됩니다)
echo.
set /p RELOGIN="재로그인 하시겠습니까? (y/n): "
if /i "%RELOGIN%"=="y" (
    echo        로그인 페이지를 엽니다...
    claude /login
)

echo.
echo [5/5] Remote Control 실행 중...
echo ============================================
echo   QR코드가 나타나면 폰으로 스캔하세요!
echo   종료: Ctrl+C
echo ============================================
echo.
claude remote-control

pause