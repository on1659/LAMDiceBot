#!/usr/bin/env bash
# 하네스 셸 쓰기 가드 — Bash/PowerShell 명령의 계약-위험 경로 쓰기를 트리아지 게이트에 편입
# check-triage.sh가 Write/Edit만 막던 우회로(셸 리다이렉트, Set-Content 등)를 봉쇄한다.
# 기준: socket/ · db/ · js/shared/ · utils/room-helpers 는 SIMPLE 불가 (harness.md 자동 에스컬레이션)

input=$(cat)

transcript_path=$(printf '%s' "$input" | grep -oE '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"([^"]*)"/\1/' | head -1)

# transcript 없으면 통과 (check-triage.sh와 동일한 안전 기본값)
if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
    exit 0
fi

# tool_input.command 문자열 추출 (jq 없이, 이스케이프 따옴표 허용) 후 \ → / 정규화
command_str=$(printf '%s' "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"(\\.|[^"\\])*"' | head -1 | tr '\\' '/')

if [ -z "$command_str" ]; then
    exit 0
fi

# 1) 계약-위험 경로 언급 없음 → 통과 (websocket/ 같은 오탐 방지 위해 앞 문자 제한)
if ! printf '%s' "$command_str" | grep -qE '(^|[^A-Za-z0-9_.-])(socket|db)/|(^|[^A-Za-z0-9_.-])js/shared/|(^|[^A-Za-z0-9_.-])utils/room-helpers'; then
    exit 0
fi

# 2) 쓰기 지시자 없음(순수 조회: node -c, grep, git diff 등) → 통과
if ! printf '%s' "$command_str" | grep -qiE '>|\b(tee|dd|cp|mv|rm|del|copy|move)\b|sed[[:space:]]+(-[a-zA-Z]*i)|Set-Content|Add-Content|Out-File|New-Item|Copy-Item|Move-Item|Remove-Item'; then
    exit 0
fi

# 3) 현재 turn에 STANDARD/COMPLEX 선언 있으면 통과 (check-triage.sh와 동일 로직)
last_user=$(grep -n '"type":"user"' "$transcript_path" | grep -v '"type":"tool_result"' | tail -1 | cut -d: -f1)
if [ -z "$last_user" ]; then
    exit 0
fi
after_user=$(tail -n +$((last_user + 1)) "$transcript_path")
if printf '%s' "$after_user" | grep -qE '\[\s*트리아지\s*[:：]\s*(STANDARD|COMPLEX)\s*\]'; then
    exit 0
fi

echo "❌ 계약-위험 경로에 쓰는 셸 명령은 SIMPLE 불가 — STANDARD 이상으로 재트리아지 후 다시 시도하세요." >&2
echo "   (조회만 하는 명령인데 차단됐다면 리다이렉트/복사 토큰 오탐 — 트리아지 상향 후 진행하세요)" >&2
echo "   기준: .claude/rules/harness.md (자동 에스컬레이션) / 훅: check-shell-write.sh" >&2
exit 2
