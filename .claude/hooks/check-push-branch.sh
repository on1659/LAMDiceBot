#!/bin/bash
# git push 전 main 브랜치 확인 — main이면 승인 요청
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.tool_input?.command||'')}catch{}})")

if echo "$COMMAND" | grep -q "git push"; then
  branch=$(git -C "$CLAUDE_PROJECT_DIR" branch --show-current 2>/dev/null)
  if [ "$branch" = "main" ]; then
    echo '{"decision":"block","reason":"⚠️ main 브랜치 푸시 → 실서버 즉시 배포됩니다. 정말 푸시하시겠습니까?"}'
  fi
fi
