#!/bin/bash
# css-var-guard.sh — 🟡 warn: CSS 색상 하드코딩 경고
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}
  })")

if echo "$FILE" | grep -qE '\.(css|html)$'; then
  CONTENT=$(echo "$INPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.tool_input?.content||'')}catch{}
    })")

  # :root 블록 외부에서 #hex 색상 사용 감지 (간이 검사)
  HEX_OUTSIDE_ROOT=$(echo "$CONTENT" | grep -vE '^\s*--' | grep -cE '#[0-9a-fA-F]{3,8}[^0-9a-fA-F]')

  if [ "$HEX_OUTSIDE_ROOT" -gt 0 ]; then
    echo "{\"decision\":\"allow\",\"reason\":\"⚠️ CSS에 하드코딩된 색상(#hex)이 감지됐습니다. CSS 변수(var(--...))를 사용하세요. (css/theme.css 참조)\"}"
    exit 0
  fi
fi
