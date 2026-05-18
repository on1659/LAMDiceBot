#!/bin/bash
# mobile-guard.sh — 🟡 warn: 모바일 호환성 검증
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}
  })")
CONTENT=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.content||'')}catch{}
  })")

WARNINGS=""

# HTML 파일: viewport meta 태그 확인
if echo "$FILE" | grep -qE '\.html$'; then
  if ! echo "$CONTENT" | grep -q 'viewport'; then
    WARNINGS="${WARNINGS}viewport meta 태그 누락. "
  fi
fi

# CSS 파일 검사
if echo "$FILE" | grep -qE '\.css$'; then
  # width: Npx (300px 이상 고정 너비는 모바일에서 문제)
  FIXED_WIDTH=$(echo "$CONTENT" | grep -cE 'width:\s*[3-9][0-9]{2,}px' || true)
  if [ "$FIXED_WIDTH" -gt 0 ]; then
    WARNINGS="${WARNINGS}300px 이상 고정 너비 감지 — max-width 또는 % 사용 권장. "
  fi

  # NOTE: 터치 타겟 < 44px 검사는 false-positive 폭탄(border-width / icon / gap 등 모두 매치)이라
  #       비활성화. 추후 .btn / button / [role=button] / .touch- 컨텍스트 한정해서 재도입 권장.

  # 미디어 쿼리 없음 감지 (30줄 이상 CSS에 반응형 누락)
  if ! echo "$CONTENT" | grep -q '@media'; then
    LINE_COUNT=$(echo "$CONTENT" | wc -l)
    if [ "$LINE_COUNT" -gt 30 ]; then
      WARNINGS="${WARNINGS}@media 쿼리 없음 — 반응형 대응이 필요할 수 있습니다. "
    fi
  fi
fi

if [ -n "$WARNINGS" ]; then
  echo "{\"decision\":\"allow\",\"reason\":\"⚠️ 모바일 호환성: ${WARNINGS}\"}"
fi
