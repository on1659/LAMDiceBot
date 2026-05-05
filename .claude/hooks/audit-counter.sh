#!/bin/bash
# Memory audit counter — increments on each SessionStart, alerts every 10 sessions.
# Counter file lives next to memory files so it's tracked alongside the data it audits.

COUNTER_FILE="$HOME/.claude/projects/d--Work-LAMDiceBot/memory/.audit-counter"
INTERVAL=10

if [ -f "$COUNTER_FILE" ]; then
    COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
else
    COUNT=0
fi

# Guard against corrupted counter file
if ! [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    COUNT=0
fi

COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

if [ $((COUNT % INTERVAL)) -eq 0 ]; then
    echo "{\"systemMessage\":\"🔔 감사 주기 도달 (세션 ${COUNT}회). /memory-audit + /harness-audit 으로 점검을 권장합니다.\"}"
fi

exit 0
