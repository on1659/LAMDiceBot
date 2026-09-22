#!/usr/bin/env bash
# Stop 훅 — 완료된 goal 명세를 docs/goal/applied/ 로 아카이브.
#
# 동작:
#   - 완료 큐 파일(.claude/.goal-applied-queue)에 적힌 경로만 이동한다.
#   - 큐는 "goal을 완료했을 때" Claude가 한 줄에 하나씩 append 한다(완료 신호).
#   - 큐가 없거나 비어 있으면 아무것도 하지 않는다 → goal 무관한 일반 stop에서 안전.
#   - 안전장치: docs/goal/*.md 경로만 허용(다른 경로는 무시), 존재하는 파일만 이동.
#
# Stop 훅은 매 멈춤마다 호출되지만, 큐가 비어 있으면 즉시 종료하므로 부작용이 없다.
# (goal 진행 중 멈춤이 차단되는 순간에도 큐는 비어 있어 조기 이동이 일어나지 않는다.)
set -euo pipefail

PROJ="${CLAUDE_PROJECT_DIR:-$(pwd)}"
QUEUE="$PROJ/.claude/.goal-applied-queue"

[ -f "$QUEUE" ] || exit 0

APPLIED="$PROJ/docs/goal/applied"
mkdir -p "$APPLIED"

moved=""
while IFS= read -r line || [ -n "$line" ]; do
    rel="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -z "$rel" ] && continue
    # docs/goal/ 바로 아래 .md 만 허용 (applied/ 재이동·경로 탈출 방지)
    case "$rel" in
        docs/goal/*/*) continue ;;   # 하위 폴더(applied 등)는 제외
        docs/goal/*.md) ;;
        *) continue ;;
    esac
    src="$PROJ/$rel"
    [ -f "$src" ] || continue
    base="$(basename "$rel")"
    if mv -f "$src" "$APPLIED/$base"; then
        moved="$moved $base"
    fi
done < "$QUEUE"

rm -f "$QUEUE"

if [ -n "$moved" ]; then
    echo "[goal-archive] 완료 goal을 docs/goal/applied/ 로 이동:$moved" >&2
fi
exit 0
