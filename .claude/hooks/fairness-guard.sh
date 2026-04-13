#!/bin/bash
# fairness-guard.sh — 🟡 warn: 클라이언트 측 게임 결과 랜덤 감지 (경고만)
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}
  })")

# 서버 측 제외
if echo "$FILE" | grep -qE '(socket|routes|db|node_modules|tests|AutoTest)/'; then
  exit 0
fi

# 연출용 파일 제외
if echo "$FILE" | grep -qE '(sprites|commentary|tagline|gif-|animation|particle)'; then
  exit 0
fi

# 클라이언트 JS만 검사
if echo "$FILE" | grep -qE '\.js$'; then
  CONTENT=$(echo "$INPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.tool_input?.content||'')}catch{}
    })")

  if echo "$CONTENT" | grep -q "Math.random"; then
    echo "{\"decision\":\"allow\",\"reason\":\"⚠️ 클라이언트 코드에서 Math.random() 감지. 게임 결과를 결정하는 용도라면 반드시 서버 측에서 수행해야 합니다. 연출용(애니메이션, UI 효과)이면 무시해도 됩니다.\"}"
    exit 0
  fi
fi
