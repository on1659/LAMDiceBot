#!/bin/bash
# Hook A: main 브랜치에서 파일 수정 시 경고
branch=$(git -C "$CLAUDE_PROJECT_DIR" branch --show-current 2>/dev/null)
if [ "$branch" = "main" ]; then
  echo '{"systemMessage":"⚠️ MAIN 브랜치입니다! 실서버에 바로 배포됩니다. feature 브랜치로 전환을 권장합니다."}'
fi
