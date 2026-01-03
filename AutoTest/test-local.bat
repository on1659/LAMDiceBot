@echo off
chcp 65001 > nul
echo 🚀 로컬 서버 테스트 시작...
node test-bot.js --url http://localhost:3000
pause

