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

# 트리아지 형식 검사 — '[트리아지: SIMPLE|STANDARD|COMPLEX]' 정확 매칭
# 공백·반각/전각 콜론은 허용. 단순 키워드("STANDARD가 아닌데..." 등)는 통과 안 됨.
if ! printf '%s' "$after_user" | grep -qE '\[\s*트리아지\s*[:：]\s*(SIMPLE|STANDARD|COMPLEX)\s*\]'; then
    # 미선언 또는 형식 불일치 → 차단
    echo "❌ 트리아지 1줄 선언 후 다시 시도하세요." >&2
    echo "   형식: [트리아지: SIMPLE] 사유  /  [트리아지: STANDARD] 사유  /  [트리아지: COMPLEX] 사유" >&2
    echo "   기준: .claude/rules/harness.md" >&2
    exit 2
fi

# 계약-위험 경로 자동 에스컬레이션 — socket/ · db/ · js/shared/ · utils/room-helpers 는 SIMPLE 불가
# 수정 대상 file_path 추출 (jq 없이) 후 경로 구분자 정규화(\ → /)
file_path=$(printf '%s' "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)"/\1/' | head -1)
norm_path=$(printf '%s' "$file_path" | tr '\\' '/' 2>/dev/null)

if printf '%s' "$norm_path" | grep -qE '/(socket|db)/|/js/shared/|/utils/room-helpers'; then
    # 계약-위험 구역 → STANDARD 또는 COMPLEX 선언이 있어야 통과
    if printf '%s' "$after_user" | grep -qE '\[\s*트리아지\s*[:：]\s*(STANDARD|COMPLEX)\s*\]'; then
        exit 0
    fi
    echo "❌ 계약-위험 경로는 SIMPLE 불가 — STANDARD 이상으로 재트리아지 후 다시 시도하세요." >&2
    echo "   대상: $file_path" >&2
    echo "   사유: socket/ · db/ · js/shared/ · utils/room-helpers 는 크로스게임 계약/공정성 가정-오류 위험 구역." >&2
    echo "   기준: .claude/rules/harness.md (자동 에스컬레이션)" >&2
    exit 2
fi

# 비위험 경로 + 트리아지 선언 있음 → 통과
exit 0
