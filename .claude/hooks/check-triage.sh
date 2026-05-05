#!/usr/bin/env bash
# 하네스 트리아지 강제 검사 — 현재 turn에 트리아지 키워드 없으면 Edit/Write 차단
# 검사 키워드: SIMPLE / STANDARD / COMPLEX / 트리아지
# 분류는 Claude가 판단 — 훅은 "어떤 트리아지든 1번 선언" 여부만 강제

input=$(cat)

# stdin JSON에서 transcript_path 추출 (jq 없이)
transcript_path=$(printf '%s' "$input" | grep -oE '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"([^"]*)"/\1/' | head -1)

# transcript 없으면 통과 (안전 기본값)
if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
    exit 0
fi

# 마지막 REAL user 메시지 라인 (tool_result도 type:"user"로 기록되므로 제외)
last_user=$(grep -n '"type":"user"' "$transcript_path" | grep -v '"type":"tool_result"' | tail -1 | cut -d: -f1)

# user 메시지 없으면 통과
if [ -z "$last_user" ]; then
    exit 0
fi

# 마지막 user 메시지 이후 내용 = 현재 turn의 assistant 메시지들
after_user=$(tail -n +$((last_user + 1)) "$transcript_path")

# 트리아지 키워드 검사
if printf '%s' "$after_user" | grep -qE 'SIMPLE|STANDARD|COMPLEX|트리아지'; then
    exit 0
fi

# 미선언 → 차단
echo "❌ 트리아지 1줄 선언 후 다시 시도하세요. 형식: '[트리아지: SIMPLE|STANDARD|COMPLEX] 한 줄 사유'" >&2
exit 2
