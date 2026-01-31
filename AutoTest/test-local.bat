@echo off
chcp 65001 > nul
if not defined PORT set PORT=3000
echo 🚀 로컬 서버 테스트 시작...
node test-bot.js --url http://localhost:%PORT%
pause

