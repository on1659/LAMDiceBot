# Playwright MCP 모바일 테스트 연동

> QA Agent가 실제 브라우저에서 모바일/태블릿/데스크톱 뷰포트를 테스트하는 방법
>
> 조사일: 2026-04-13

---

## 개요

현재 하네스의 모바일 검증은 2계층으로 구성된다:

```
1계층: mobile-guard.sh (Hook — 정적 검사)
  → CSS/HTML 코드에서 패턴 매칭 (viewport meta, 고정 너비, 터치 타겟)
  → 코드 작성 시점에 즉시 차단/경고
  → 한계: 실제 렌더링 결과를 볼 수 없음

2계층: Playwright MCP (브라우저 — 동적 검사)  ← 이 문서
  → 실제 브라우저를 열고 뷰포트를 바꿔가며 스크린샷 촬영
  → 버튼 클릭, 폼 입력, 게임 플로우 실행
  → QA Agent가 스크린샷을 보고 판정
```

---

## 도구 비교

| 도구 | 방식 | 모바일 테스트 | 설치 난이도 |
|------|------|-------------|-----------|
| **Playwright MCP** (Microsoft) | MCP 서버 — 33+ 브라우저 도구 | `browser_resize`로 뷰포트 변경 + WebKit(Safari) 지원 | `.claude/mcp.json`에 추가 |
| **Playwright Skill** (lackeyjb) | Skill — Claude가 Playwright 코드 자동 생성/실행 | 내장 뷰포트 프리셋 (Mobile 375x667) | `.claude/skills/`에 추가 |
| **Glance** | MCP 서버 — 실제 Chromium + 비전 | 뷰포트 리사이즈 + 비주얼 리그레션 | npm 설치 |
| **GStack /qa** | Skill — Playwright 기반 QA | 실제 브라우저 클릭 테스트 | gstack 설치 필요 |

**권장: Playwright MCP** — 프로젝트에 이미 Playwright devDependency가 있고, WebKit으로 모바일 Safari 테스트 가능

---

## 설치

### `.claude/mcp.json`에 추가

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

### 브라우저 엔진 설치 (최초 1회)

```bash
npx playwright install chromium webkit
# chromium: 데스크톱/안드로이드 Chrome 시뮬레이션
# webkit: 모바일 Safari 시뮬레이션
```

---

## 사용 가능한 MCP 도구

| 도구 | 설명 | 모바일 테스트 활용 |
|------|------|------------------|
| `browser_navigate` | URL 이동 | 게임 페이지 로드 |
| `browser_resize` | 뷰포트 크기 변경 | **모바일/태블릿/데스크톱 전환** |
| `browser_take_screenshot` | 현재 화면 캡처 | **각 뷰포트별 스크린샷 비교** |
| `browser_click` | 요소 클릭 | 터치 타겟 동작 확인 |
| `browser_type` | 텍스트 입력 | 소프트 키보드 시나리오 |
| `browser_evaluate` | JS 실행 | Socket.IO 상태 확인, DOM 검사 |
| `browser_snapshot` | 접근성 트리 | 스크린 리더 호환성 |

---

## 테스트 뷰포트 정의

LAMDiceBot 사용 환경에 맞춘 테스트 뷰포트:

| 이름 | 너비 x 높이 | 대상 |
|------|------------|------|
| `mobile-portrait` | 375 x 667 | iPhone SE/8 (세로) |
| `mobile-landscape` | 667 x 375 | iPhone SE/8 (가로) |
| `mobile-large` | 430 x 932 | iPhone 14 Pro Max |
| `tablet` | 768 x 1024 | iPad (세로) |
| `desktop` | 1920 x 1080 | 일반 데스크톱 |

---

## QA Agent 테스트 시나리오

### 시나리오 1: 게임 페이지 반응형 검증

```
1. browser_navigate → http://localhost:5173/dice-game-multiplayer.html
2. browser_resize(1920, 1080) → 데스크톱 스크린샷
3. browser_resize(768, 1024)  → 태블릿 스크린샷
4. browser_resize(375, 667)   → 모바일 스크린샷
5. 각 스크린샷에서 확인:
   ☐ 게임 영역이 화면에 맞게 조정되는가
   ☐ 컨트롤 버튼이 가려지지 않는가
   ☐ 채팅 영역이 접근 가능한가
   ☐ 텍스트가 잘리지 않는가
```

### 시나리오 2: 모바일 게임 플로우 (Happy Path)

```
1. browser_resize(375, 667) → 모바일 뷰포트
2. browser_navigate → http://localhost:5173/
3. browser_type → 닉네임 입력
4. browser_click → 방 만들기 버튼
5. browser_take_screenshot → 방 생성 확인
6. browser_click → 게임 시작 버튼
7. browser_take_screenshot → 게임 진행 확인
8. 확인:
   ☐ 모든 버튼이 터치 가능한 크기인가
   ☐ 모달/팝업이 화면을 벗어나지 않는가
   ☐ 스크롤이 자연스러운가
```

### 시나리오 3: 게임별 모바일 애니메이션

```
주사위:
  browser_resize(375, 667) → 모바일
  주사위 굴리기 → 애니메이션 완료 후 스크린샷
  ☐ 결과가 화면 내에 표시되는가

룰렛:
  browser_resize(375, 667) → 모바일
  룰렛 시작 → 회전 중 스크린샷 → 결과 스크린샷
  ☐ 파이차트가 잘리지 않는가
  ☐ 플레이어 이름이 읽히는가

경마:
  browser_resize(375, 667) → 모바일
  레이스 시작 → 진행 중 스크린샷 → 결과 스크린샷
  ☐ 말 애니메이션이 화면에 맞는가
  ☐ 순위표가 읽히는가
```

### 시나리오 4: 크로스 브라우저 (WebKit/Safari)

```
Playwright MCP를 WebKit 엔진으로 실행:
  npx @playwright/mcp@latest --browser webkit

1. browser_navigate → 각 게임 페이지
2. browser_resize(375, 667) → iPhone Safari 시뮬레이션
3. 확인:
   ☐ CSS 변수가 정상 렌더링되는가
   ☐ Socket.IO 연결이 정상인가
   ☐ 사운드 자동재생 차단 대응이 되는가
   ☐ Safari 특유의 100vh 이슈가 없는가
```

---

## /build 파이프라인 통합

```
/build "기능 구현"
  │
  ├─ Stage 2: Coder → 구현
  ├─ Stage 3: Reviewer → 코드 리뷰 (정적 검사)
  │
  ├─ Stage 4: QA Agent
  │   │
  │   ├─ 기존 검증 (로직)
  │   │   ├─ 공정성 체크리스트
  │   │   ├─ 멀티플레이어 동기화
  │   │   └─ 엣지케이스
  │   │
  │   └─ Playwright MCP 검증 (시각)    ← 추가
  │       ├─ 서버 시작 (node server.js)
  │       ├─ 5개 뷰포트 스크린샷
  │       ├─ 모바일 게임 플로우 실행
  │       ├─ 터치 타겟 동작 확인
  │       └─ 스크린샷 기반 pass/fail
  │
  └─ Stage 5: 이더 → 최종 확인
```

---

## QA Agent 출력 형식 (Playwright 포함)

```markdown
## QA 검증
- **판정**: pass / fail

### 로직 검증
- 공정성: pass
- 멀티플레이어 동기화: pass
- 엣지케이스: 1건 발견 (상세 기술)

### 모바일 UI 검증 (Playwright MCP)
- **테스트 뷰포트**: mobile(375x667), tablet(768x1024), desktop(1920x1080)

| 뷰포트 | 페이지 | 결과 | 비고 |
|--------|--------|------|------|
| mobile | 로비 | pass | |
| mobile | 주사위 | fail | 결과 영역이 하단 채팅에 가려짐 |
| mobile | 룰렛 | pass | |
| mobile | 경마 | pass | |
| tablet | 전체 | pass | |
| desktop | 전체 | pass | |

### 스크린샷
- [mobile-dice.png] 주사위 모바일 — 결과 영역 가림 이슈
- [desktop-dice.png] 주사위 데스크톱 — 정상
```

---

## 대안: Playwright Skill

MCP 대신 Skill로 사용하는 방법도 있다. Skill은 Claude가 자동으로 Playwright 코드를 생성/실행하므로 더 유연하지만, 실행 시간이 길 수 있다.

| 비교 | Playwright MCP | Playwright Skill |
|------|---------------|-----------------|
| 설치 | mcp.json 추가 | skills/ 디렉토리 추가 |
| 트리거 | Claude가 MCP 도구 호출 | Claude가 자동 판단 |
| 유연성 | 33개 고정 도구 | 임의의 Playwright 코드 |
| 속도 | 빠름 (도구 직접 호출) | 느림 (코드 생성 → 실행) |
| WebKit | 지원 (--browser webkit) | 지원 |

**권장**: 하네스 QA에는 MCP (빠르고 예측 가능), 탐색적 테스트에는 Skill (유연)

---

## 참고 자료

- [Playwright MCP GitHub](https://github.com/microsoft/playwright-mcp)
- [Playwright Skill GitHub](https://github.com/lackeyjb/playwright-skill)
- [Playwright MCP + Claude Code 가이드](https://www.builder.io/blog/playwright-mcp-server-claude-code)
- [반응형 테스트 with Playwright](https://dev.to/ohugonnot/zero-overflow-in-10-minutes-responsive-testing-with-claude-code-and-playwright-59an)
- [AI QA Engineer 구축하기](https://alexop.dev/posts/building_ai_qa_engineer_claude_code_playwright/)
