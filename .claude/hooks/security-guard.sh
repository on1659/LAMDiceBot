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

  HAS_SOCKET_ON=$(echo "$CONTENT" | grep -c "socket.on")
  HAS_RATE_LIMIT=$(echo "$CONTENT" | grep -c "checkRateLimit")

  if [ "$HAS_SOCKET_ON" -gt 0 ] && [ "$HAS_RATE_LIMIT" -eq 0 ]; then
    echo "{\"decision\":\"block\",\"reason\":\"❌ socket.on 핸들러에 ctx.checkRateLimit() 호출이 없습니다. 모든 Socket 핸들러는 Rate Limiting이 필수입니다.\"}"
    exit 0
  fi
fi
