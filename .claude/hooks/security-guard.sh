#!/bin/bash
# security-guard.sh — 🟢 block: Socket 핸들러에 Rate Limiting 누락 차단
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}
  })")

if echo "$FILE" | grep -q 'socket/'; then
  CONTENT=$(echo "$INPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.tool_input?.content||'')}catch{}
    })")

  # 함수 호출 패턴만 매칭 — 주석·문자열 안의 단순 언급은 통과
  # socket.on(...) / ctx.checkRateLimit(...) 형태만 카운트
  HAS_SOCKET_ON=$(echo "$CONTENT" | grep -cE 'socket\.on\s*\(')
  HAS_RATE_LIMIT=$(echo "$CONTENT" | grep -cE '\bctx\.checkRateLimit\s*\(')

  if [ "$HAS_SOCKET_ON" -gt 0 ] && [ "$HAS_RATE_LIMIT" -eq 0 ]; then
    echo "{\"decision\":\"block\",\"reason\":\"❌ socket.on() 핸들러에 ctx.checkRateLimit() 호출이 없습니다. 모든 Socket 핸들러는 Rate Limiting이 필수입니다.\"}"
    exit 0
  fi

  # 핸들러 수보다 rate limit 호출이 적으면 경고 (block 아님)
  if [ "$HAS_SOCKET_ON" -gt "$HAS_RATE_LIMIT" ]; then
    echo "{\"decision\":\"allow\",\"reason\":\"⚠️ socket.on() ${HAS_SOCKET_ON}건 vs ctx.checkRateLimit() ${HAS_RATE_LIMIT}건. 신규 핸들러에 Rate Limit 누락 가능성 확인하세요.\"}"
    exit 0
  fi
fi
