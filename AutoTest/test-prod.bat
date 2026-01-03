@echo off
chcp 65001 > nul
echo 🚀 프로덕션 서버 테스트 시작...
node test-bot.js --url https://lamdicebot-production.up.railway.app
pause

