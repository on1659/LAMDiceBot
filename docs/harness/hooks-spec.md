# Hook 사양 및 입출력 정의

> 하네스 시스템의 물리적 강제 계층 — 에이전트가 규칙을 위반하면 차단/경고

---

## Hook 아키텍처

```
Claude Code Tool Call
  │
  ├─ PreToolUse Hook (도구 실행 전)
  │   → 조건 불충족 시 block/deny → 도구 실행 차단
  │   → 조건 충족 시 allow → 도구 실행 허용
  │
  ├─ [도구 실행]
  │
  ├─ PostToolUse Hook (도구 실행 후)
  │   → 결과 검증 → 경고 또는 다음 단계 트리거
  │
  └─ Stop Hook (에이전트 완료 시)
      → 최종 품질 체크
```

---

## Hook 입출력 형식

### 입력 (stdin → JSON)

```json
{
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/d/Work/lamdicebot/socket/newgame.js",
    "content": "socket.on('newEvent', (data) => { ... })"
  }
}
```

### 출력 (stdout → JSON)

```json
// 허용
{"decision": "allow"}

// 경고 (허용하되 메시지 표시)
{"decision": "allow", "reason": "⚠️ Math.random 감지 — 서버 측 사용인지 확인 필요"}

// 차단 (도구 실행 거부)
{"decision": "block", "reason": "❌ tests/newgame.test.js가 없습니다. 테스트를 먼저 작성하세요."}
```

---

## Hook 목록

### 1. tdd-guard.sh

| 항목 | 내용 |
|------|------|
| **이벤트** | PreToolUse:Write |
| **트리거 조건** | `socket/*.js`, `routes/*.js`, `db/*.js` 파일 작성 시 |
| **검증** | 대응하는 테스트 파일 존재 여부 |
| **차단 조건** | 테스트 파일이 없으면 block |
| **제외** | `*.test.js`, `*.spec.js` 자체는 제외 (테스트 작성은 허용) |

```bash
#!/bin/bash
# tdd-guard.sh — 테스트 없이 코드 작성 차단
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}
  })")

# 테스트 파일 자체는 허용
if echo "$FILE" | grep -qE '\.(test|spec)\.(js|ts)$'; then
  exit 0
fi

# socket/, routes/, db/ 파일만 검사
if echo "$FILE" | grep -qE '(socket|routes|db)/'; then
  BASENAME=$(basename "$FILE" .js)
  DIR=$(dirname "$FILE")
  TEST_FILE="$CLAUDE_PROJECT_DIR/tests/${BASENAME}.test.js"
  AUTOTEST=$(find "$CLAUDE_PROJECT_DIR/AutoTest" -name "*${BASENAME}*" 2>/dev/null)

  if [ ! -f "$TEST_FILE" ] && [ -z "$AUTOTEST" ]; then
    echo "{\"decision\":\"block\",\"reason\":\"❌ ${BASENAME}의 테스트 파일이 없습니다. tests/${BASENAME}.test.js를 먼저 작성하세요.\"}"
    exit 0
  fi
fi
```

**매핑**: `skill-backend.md` 보안 체크리스트 + Superpowers TDD 강제 개념

---

### 2. security-guard.sh

| 항목 | 내용 |
|------|------|
| **이벤트** | PostToolUse:Write |
| **트리거 조건** | `socket/*.js` 파일 작성 완료 후 |
| **검증** | `checkRateLimit()` 호출 포함 여부 |
| **경고 조건** | socket.on 이벤트 핸들러에 checkRateLimit 없으면 warn |

```bash
#!/bin/bash
# security-guard.sh — Socket 핸들러에 Rate Limiting 누락 경고
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}
  })")

if echo "$FILE" | grep -q 'socket/'; then
  CONTENT=$(echo "$INPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.tool_input?.content||'')}catch{}
    })")

  HAS_SOCKET_ON=$(echo "$CONTENT" | grep -c "socket.on")
  HAS_RATE_LIMIT=$(echo "$CONTENT" | grep -c "checkRateLimit")

  if [ "$HAS_SOCKET_ON" -gt 0 ] && [ "$HAS_RATE_LIMIT" -eq 0 ]; then
    echo "{\"decision\":\"allow\",\"reason\":\"⚠️ socket.on 핸들러에 ctx.checkRateLimit() 호출이 없습니다. 보안 체크리스트를 확인하세요.\"}"
    exit 0
  fi
fi
```

**매핑**: `skill-backend.md` 핵심 패턴 + `rules/backend.md`

---

### 3. fairness-guard.sh

| 항목 | 내용 |
|------|------|
| **이벤트** | PostToolUse:Write |
| **트리거 조건** | `js/*.js` (클라이언트 코드) 파일 작성 완료 후 |
| **검증** | `Math.random()` 사용 여부 |
| **차단 조건** | 클라이언트 측 코드에서 Math.random 사용 시 block |
| **제외** | `socket/*.js` (서버 측)은 검사 대상 아님 |

```bash
#!/bin/bash
# fairness-guard.sh — 클라이언트 측 난수 생성 차단
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}
  })")

# 클라이언트 JS만 검사 (서버 측 socket/, routes/, db/ 제외)
if echo "$FILE" | grep -qE '\.js$' && ! echo "$FILE" | grep -qE '(socket|routes|db|node_modules|tests|AutoTest)/'; then
  CONTENT=$(echo "$INPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.tool_input?.content||'')}catch{}
    })")

  if echo "$CONTENT" | grep -q "Math.random"; then
    echo "{\"decision\":\"block\",\"reason\":\"❌ 클라이언트 코드에서 Math.random() 사용 금지. 난수 생성은 반드시 서버 측에서 수행해야 합니다. (공정성 원칙)\"}"
    exit 0
  fi
fi
```

**매핑**: `skill-qa.md` 공정성 검증 + `skill-backend.md` 보안 체크리스트

---

### 4. css-var-guard.sh

| 항목 | 내용 |
|------|------|
| **이벤트** | PostToolUse:Write |
| **트리거 조건** | `css/*.css`, `*.html` (인라인 스타일) 파일 작성 완료 후 |
| **검증** | `#` 16진수 색상 하드코딩 여부 |
| **경고 조건** | `:root` 외부에서 #hex 색상 직접 사용 시 warn |
| **제외** | `:root` 블록 내 변수 정의, `theme.css`의 `:root`는 허용 |

```bash
#!/bin/bash
# css-var-guard.sh — CSS 색상 하드코딩 경고
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}
  })")

if echo "$FILE" | grep -qE '\.(css|html)$'; then
  CONTENT=$(echo "$INPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.tool_input?.content||'')}catch{}
    })")

  # :root 블록 외부에서 #hex 색상 사용 감지 (간이 검사)
  HEX_OUTSIDE_ROOT=$(echo "$CONTENT" | grep -vE '^\s*--' | grep -cE '#[0-9a-fA-F]{3,8}[^0-9a-fA-F]')

  if [ "$HEX_OUTSIDE_ROOT" -gt 0 ]; then
    echo "{\"decision\":\"allow\",\"reason\":\"⚠️ CSS에 하드코딩된 색상(#hex)이 감지됐습니다. CSS 변수(var(--...))를 사용하세요. (css/theme.css 참조)\"}"
    exit 0
  fi
fi
```

**매핑**: `skill-frontend.md` CSS 규칙 + `skill-ui.md` CSS 변수 아키텍처

---

### 5. format-guard.sh (meeting 전용)

| 항목 | 내용 |
|------|------|
| **이벤트** | PostToolUse (에이전트 출력 검증) |
| **트리거 조건** | /meeting 파이프라인 에이전트 출력 |
| **검증** | 역할별 필수 의견 형식 포함 여부 |
| **동작** | 누락 시 해당 에이전트 재실행 요청 |

**역할별 필수 키워드:**

| 에이전트 | 필수 포함 |
|---------|----------|
| 현우 | `MoSCoW`, `성공 지표` |
| 소연 | `ICE`, `KPI` |
| 태준 | `수정 파일`, `DB 영향`, `Socket 영향` |
| 미래 | `수정 파일`, `CSS 변수`, `모바일` |
| 다은 | `CSS 변수`, `레이아웃` |
| 승호 | `사용자 플로우`, `접근성` |
| 윤서 | `리스크 등급`, `공정성`, `DoD` |
| 지민 | `Go`, `범위`, `배포 리스크` |

**매핑**: 각 `skill-*.md` 파일의 "의견 형식" 섹션

---

## settings.json Hook 등록 (예시)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/tdd-guard.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/security-guard.sh"
          },
          {
            "type": "command",
            "command": "bash .claude/hooks/fairness-guard.sh"
          },
          {
            "type": "command",
            "command": "bash .claude/hooks/css-var-guard.sh"
          }
        ]
      }
    ]
  }
}
```

---

## Hook 테스트 방법

각 hook은 독립적으로 테스트할 수 있다:

```bash
# tdd-guard 테스트 — 테스트 파일 없는 경우
echo '{"tool_name":"Write","tool_input":{"file_path":"socket/newgame.js","content":"..."}}' | bash .claude/hooks/tdd-guard.sh
# 기대: block 반환

# fairness-guard 테스트 — 클라이언트 Math.random 사용
echo '{"tool_name":"Write","tool_input":{"file_path":"js/game.js","content":"let x = Math.random();"}}' | bash .claude/hooks/fairness-guard.sh
# 기대: block 반환

# security-guard 테스트 — Rate Limit 누락
echo '{"tool_name":"Write","tool_input":{"file_path":"socket/dice.js","content":"socket.on(\"roll\", (data) => { })"}}' | bash .claude/hooks/security-guard.sh
# 기대: warn 반환
```
