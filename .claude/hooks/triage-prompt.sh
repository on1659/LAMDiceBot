#!/usr/bin/env bash
# UserPromptSubmit 훅 — 매 사용자 메시지 시작 시 트리아지 강제 리마인더 주입.
# 출력은 stdout으로 보내며 Claude의 이번 턴 컨텍스트에 system 메시지로 합쳐진다.

cat <<'EOF'
<harness-triage-reminder>
이건 새 사용자 메시지다. 이전 턴의 트리아지 판정은 자동 재사용되지 않는다.
이 턴의 첫 응답(어떤 도구도 호출하기 전)은 반드시 아래 형식의 한 줄로 시작해야 한다:

  [트리아지: SIMPLE] 한 줄 사유
  [트리아지: STANDARD] 한 줄 사유
  [트리아지: COMPLEX] 한 줄 사유

판정 기준 (.claude/rules/harness.md 권위):
- SIMPLE   : 수정 1~2파일, UI 무관, 공정성 무관, DB/Socket 무관 → 직접 수정
- STANDARD : UI 변경 있지만 소규모 또는 코드 3파일 미만 → Scout → Coder → Reviewer
- COMPLEX  : 파일 3개+, 새 기능, DB/Socket 변경, 공정성 영향 → + QA

조사·분석만 요청된 경우("확인해봐", "왜 이래?")도 트리아지는 선언한다 — 보통 SIMPLE.
조사 중 수정 필요성이 드러나면 멈추고 재트리아지 한 줄을 다시 선언한다.

PreToolUse 훅(check-triage.sh)이 Edit/Write 시점에 `[트리아지: ...]` 형식을 재검증한다.
형식 위반 시 차단된다.
</harness-triage-reminder>
EOF

exit 0
