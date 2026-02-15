#!/bin/bash

echo "🤖 주사위 게임 테스트 봇 실행 스크립트"
echo "=================================="
echo ""

# 서버가 실행 중인지 확인 (PORT 미설정 시 3000)
PORT=${PORT:-3000}
echo "📡 서버 연결 확인 중..."
if curl -s "http://localhost:${PORT}" > /dev/null 2>&1; then
    echo "✅ 서버가 실행 중입니다."
else
    echo "❌ 서버가 실행되지 않았습니다!"
    echo "   먼저 'node server.js'를 실행해주세요."
    exit 1
fi

echo ""
echo "🚀 테스트 봇 시작..."
echo ""

# 봇 실행
node dice-test-bot.js
