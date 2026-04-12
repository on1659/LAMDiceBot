# Hook 사양 및 입출력 정의

> 하네스 시스템의 물리적 강제 계층 — 에이전트가 규칙을 위반하면 차단/경고

---

## 운영 등급 요약

| Hook | 등급 | 기본 모드 | 이유 |
|------|------|----------|------|
| security-guard | 🟢 **block** | 즉시 적용 | Socket Rate Limiting 누락은 보안 직결 |
| fairness-guard | 🟡 **warn** | 경고만 | 연출용 랜덤까지 차단하면 과차단 |
| css-var-guard | 🟡 **warn** | 경고만 | 차단하면 생산성 저하, 경고로 충분 |
| mobile-guard | 🟡 **warn** | 경고만 | 자동 감지가 부정확할 수 있음 |
| tdd-guard | 🔴 **future** | 미적용 | 테스트 자산 일부만 존재, 핵심 경로부터 점진 적용 |
| format-guard | 🔴 **future** | 미적용 | /meeting 실사용 후 형식 안정화 뒤 적용 |

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

### 1. tdd-guard.sh — 🔴 future

| 항목 | 내용 |
|------|------|
| **운영 등급** | 🔴 **future** — 테스트 자산 확충 후 핵심 경로(socket/, db/)부터 점진 적용 |
| **이벤트** | PreToolUse:Write |
| **트리거 조건** | `socket/*.js`, `routes/*.js`, `db/*.js` 파일 작성 시 |
| **검증** | 대응하는 테스트 파일 존재 여부 |
| **차단 조건** | 테스트 파일이 없으면 block |
| **제외** | `*.test.js`, `*.spec.js` 자체는 제외 (테스트 작성은 허용) |
| **선행조건** | tests/ 디렉토리에 주요 핸들러 테스트 파일 확보 필요 |
| **과차단 위험** | 현재 테스트 파일이 일부만 존재 → 전역 적용 시 거의 모든 Write가 차단됨 |

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

### 2. security-guard.sh — 🟢 block

| 항목 | 내용 |
|------|------|
| **운영 등급** | 🟢 **block** — 즉시 적용 가능. 보안 직결 |
| **이벤트** | PostToolUse:Write |
| **트리거 조건** | `socket/*.js` 파일 작성 완료 후 |
| **검증** | `checkRateLimit()` 호출 포함 여부 |
| **차단 조건** | socket.on 이벤트 핸들러에 checkRateLimit 없으면 block |
| **과차단 위험** | 낮음 — 모든 Socket 핸들러에 필수인 패턴 |

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

### 3. fairness-guard.sh — 🟡 warn

| 항목 | 내용 |
|------|------|
| **운영 등급** | 🟡 **warn** — 경고만. 연출용 랜덤까지 차단하면 과차단 |
| **이벤트** | PostToolUse:Write |
| **트리거 조건** | `js/*.js` (클라이언트 코드) 파일 작성 완료 후 |
| **검증** | `Math.random()` 사용 여부 — **게임 결과 결정 컨텍스트** 감지 |
| **경고 조건** | 클라이언트 측 코드에서 Math.random 사용 시 warn |
| **제외** | `socket/*.js` (서버 측), 연출용 파일 (`*-sprites.js`, `*-commentary.js`, `tagline-*.js`, `gif-*.js`) |
| **과차단 위험** | 높음 — 애니메이션 흔들림, 파티클 효과, 태그라인 롤러 등 연출용 랜덤까지 막을 수 있음 |

**차단해야 할 것 vs 허용할 것:**

| 구분 | 예시 | 판정 |
|------|------|------|
| 게임 결과 결정 | 주사위 값, 룰렛 결과, 경마 순위 | 반드시 서버 측 |
| 게임 진행 보조 | 팀 배정 순서, 베팅 배당률 계산 | 반드시 서버 측 |
| 연출/UI 효과 | 애니메이션 타이밍, 파티클 방향, 스프라이트 흔들림 | 클라이언트 허용 |
| 비게임 기능 | 태그라인 롤러, GIF 녹화 타이밍 | 클라이언트 허용 |

```bash
#!/bin/bash
# fairness-guard.sh — 클라이언트 측 게임 결과 랜덤 감지 (경고)
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}
  })")

# 서버 측 제외
if echo "$FILE" | grep -qE '(socket|routes|db|node_modules|tests|AutoTest)/'; then
  exit 0
fi

# 연출용 파일 제외
if echo "$FILE" | grep -qE '(sprites|commentary|tagline|gif-|animation|particle)'; then
  exit 0
fi

# 클라이언트 JS만 검사
if echo "$FILE" | grep -qE '\.js$'; then
  CONTENT=$(echo "$INPUT" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.tool_input?.content||'')}catch{}
    })")

  if echo "$CONTENT" | grep -q "Math.random"; then
    echo "{\"decision\":\"allow\",\"reason\":\"⚠️ 클라이언트 코드에서 Math.random() 감지. 게임 결과를 결정하는 용도라면 반드시 서버 측에서 수행해야 합니다. 연출용(애니메이션, UI 효과)이면 무시해도 됩니다.\"}"
    exit 0
  fi
fi
```

**매핑**: `skill-qa.md` 공정성 검증 + `skill-backend.md` 보안 체크리스트

---

### 4. css-var-guard.sh — 🟡 warn

| 항목 | 내용 |
|------|------|
| **운영 등급** | 🟡 **warn** — 경고만. 차단하면 스타일 작업 생산성 저하 |
| **이벤트** | PostToolUse:Write |
| **트리거 조건** | `css/*.css`, `*.html` (인라인 스타일) 파일 작성 완료 후 |
| **검증** | `#` 16진수 색상 하드코딩 여부 |
| **경고 조건** | `:root` 외부에서 #hex 색상 직접 사용 시 warn |
| **제외** | `:root` 블록 내 변수 정의, `theme.css`의 `:root`는 허용 |
| **과차단 위험** | 중간 — SVG inline 색상, 외부 라이브러리 CSS 등 의도적 하드코딩 가능 |

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

### 5. mobile-guard.sh — 🟡 warn

| 항목 | 내용 |
|------|------|
| **운영 등급** | 🟡 **warn** — 경고만. 자동 감지가 부정확할 수 있음 |
| **이벤트** | PostToolUse:Write |
| **트리거 조건** | `*.html`, `css/*.css` 파일 작성 완료 후 |
| **검증** | 모바일 호환성 필수 요소 포함 여부 |
| **경고 조건** | viewport meta 누락, 고정 px 너비, 터치 타겟 미달 감지 시 warn |
| **과차단 위험** | 중간 — 의도적 고정 너비(모달, 팝업), 아이콘 버튼 등 오탐 가능 |

```bash
#!/bin/bash
# mobile-guard.sh — 모바일 호환성 검증
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

# CSS 파일: 고정 너비 감지 (모바일 깨짐 원인)
if echo "$FILE" | grep -qE '\.css$'; then
  # width: Npx (300px 이상 고정 너비는 모바일에서 문제)
  FIXED_WIDTH=$(echo "$CONTENT" | grep -cE 'width:\s*[3-9][0-9]{2,}px' || true)
  if [ "$FIXED_WIDTH" -gt 0 ]; then
    WARNINGS="${WARNINGS}300px 이상 고정 너비(width: Npx) 감지 — max-width 또는 % 사용 권장. "
  fi

  # 터치 타겟: 44px 미만 감지
  SMALL_TARGET=$(echo "$CONTENT" | grep -cE '(width|height):\s*([1-3][0-9]|[0-9])px' || true)
  if [ "$SMALL_TARGET" -gt 0 ]; then
    WARNINGS="${WARNINGS}44px 미만 크기 감지 — 터치 타겟 최소 44x44px 필요. "
  fi

  # 미디어 쿼리 없음 감지 (새 CSS 파일에 반응형 누락)
  if ! echo "$CONTENT" | grep -q '@media'; then
    LINE_COUNT=$(echo "$CONTENT" | wc -l)
    if [ "$LINE_COUNT" -gt 30 ]; then
      WARNINGS="${WARNINGS}@media 쿼리 없음 — 반응형 대응이 필요할 수 있습니다. "
    fi
  fi
fi

if [ -n "$WARNINGS" ]; then
  echo "{\"decision\":\"allow\",\"reason\":\"⚠️ 모바일 호환성: ${WARNINGS}(skill-ui.md 반응형 전략 참조)\"}"
fi
```

**매핑**: `skill-ui.md` 반응형 전략 + `skill-ux.md` 모바일 우선 고려사항 + `skill-qa.md` 브라우저 호환성

**검증 항목:**

| 검증 | 대상 파일 | 감지 |
|------|----------|------|
| viewport meta 누락 | `*.html` | `<meta name="viewport">` 없음 |
| 고정 너비 | `*.css` | `width: 300px+` (max-width 아닌 width) |
| 터치 타겟 미달 | `*.css` | `width/height: 43px 이하` |
| 반응형 누락 | `*.css` | 30줄 이상인데 `@media` 없음 |

---

### 6. format-guard.sh (meeting 전용) — 🔴 future

| 항목 | 내용 |
|------|------|
| **운영 등급** | 🔴 **future** — /meeting 실사용 후 형식 안정화 뒤 적용 |
| **이벤트** | PostToolUse (에이전트 출력 검증) |
| **트리거 조건** | /meeting 파이프라인 에이전트 출력 |
| **검증** | 역할별 필수 의견 형식 포함 여부 |
| **동작** | 누락 시 해당 에이전트 재실행 요청 |
| **선행조건** | /meeting을 여러 번 실사용하여 형식이 안정화된 후 적용 |

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

## settings.json Hook 등록

### 지금 적용 가능한 설정 (운영 버전)

```json
{
  "hooks": {
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
          },
          {
            "type": "command",
            "command": "bash .claude/hooks/mobile-guard.sh"
          }
        ]
      }
    ]
  }
}
```

> - security-guard: block (Socket Rate Limiting 필수)
> - fairness-guard, css-var-guard, mobile-guard: warn (경고만)
> - tdd-guard: 미등록 (테스트 자산 확충 후 추가)
> - format-guard: 미등록 (/meeting 실사용 후 추가)

### 테스트 자산 확충 후 추가할 설정 (장기 목표)

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
    ]
  }
}
```
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

# mobile-guard 테스트 — viewport 누락
echo '{"tool_name":"Write","tool_input":{"file_path":"new-game.html","content":"<html><head><title>Test</title></head></html>"}}' | bash .claude/hooks/mobile-guard.sh
# 기대: warn (viewport meta 누락)

# mobile-guard 테스트 — 고정 너비 + 터치 타겟 미달
echo '{"tool_name":"Write","tool_input":{"file_path":"css/new-game.css","content":".container { width: 500px; } .btn { width: 30px; height: 30px; }"}}' | bash .claude/hooks/mobile-guard.sh
# 기대: warn (고정 너비 + 터치 타겟 미달)
```
