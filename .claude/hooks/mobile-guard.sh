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

  # 터치 타겟: 44px 미만 감지
  SMALL_TARGET=$(echo "$CONTENT" | grep -cE '(width|height):\s*([1-3][0-9]|[0-9])px' || true)
  if [ "$SMALL_TARGET" -gt 0 ]; then
    WARNINGS="${WARNINGS}44px 미만 크기 감지 — 터치 타겟 최소 44x44px 필요. "
  fi

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
