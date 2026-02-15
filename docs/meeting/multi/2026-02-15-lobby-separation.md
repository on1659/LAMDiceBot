# LAMDiceBot 팀 회의록

**일시**: 2026-02-15
**주제**: 로비를 주사위 게임에서 분리하여 독립 페이지로 만들기
**참석자**: 기획자(A), 개발자(B), QA/UX(C)
**회의 방식**: 3인 멀티에이전트 독립 분석 → 교차 검토 → 합의 도출

---

## 1. 현황 요약

- 로비(방 목록, 방 생성/입장)가 `dice-game-multiplayer.html`(7,284줄)에 종속
- 다른 게임(룰렛, 경마, 크레인)은 로비 UI 없이 게임 섹션만 존재
- 방 생성/입장 시 다른 게임 타입이면 localStorage에 데이터 저장 후 해당 페이지로 redirect
- 백엔드 `socket/rooms.js`는 이미 게임 타입에 무관한 공통 구조

---

## 2. 독립 분석 결과

### 2-1. 기획자 (A)

| # | 기능명 | 전략적 의의 | 사용자 가치 | 우선순위 |
|---|--------|------------|------------|---------|
| 1 | 통합 로비 (게임 섹션 포함) | 한 페이지에 모든 게임 | redirect 없이 즉시 전환 | 상 |
| 2 | 독립 로비 + redirect | 로비/게임 명확 분리 | 로비 로딩 빠름 | 중상 |
| 3 | 게임별 자체 로비 | 각 게임에 로비 탑재 | 게임별 독립 진입 | 중 |
| 4 | 모달 로비 | 게임 중 다른 방 조회 | 게임 중단 없음 | 하 |
| 5 | API 기반 라우팅 | 서버 주도 | 확장성 | 하 |

### 2-2. 개발자 (B)

| # | 기능명 | 구현 방법 | 영향 파일 | 난이도 |
|---|--------|----------|----------|--------|
| 1 | lobby.html 분리 | 로비 HTML/JS 추출, 라우트 추가 | lobby.html(신규), routes/api.js, dice HTML | 중상 |
| 2 | lobby-shared.js 모듈 | ranking-shared.js 패턴 활용 | lobby-shared.js(신규), 각 게임 HTML | 중 |
| 3 | Web Components | `<lam-lobby>` 커스텀 엘리먼트 | components/(신규), 각 게임 HTML | 상 |
| 4 | SPA 전환 | 클라이언트 라우터 도입 | 전체 구조 변경 | 상상 |
| 5 | EJS 템플릿 | 서버사이드 렌더링 | server.js, views/(신규) | 상 |

**B 의견**: 방안 1 추천 (순수 HTML 원칙 준수, socket/rooms.js 변경 불필요)

### 2-3. QA/UX (C)

| # | 기능명 | 테스트 방법 | UX 개선점 | 리스크 |
|---|--------|------------|----------|--------|
| 1 | 소켓 상태 보존 | 게임 전환 시 채팅 연속성 확인 | redirect 중 메시지 유실 방지 | 중 |
| 2 | 모바일 로비 반응형 | 360-1024px 뷰포트 테스트 | 터치 친화 버튼(44px+) | 하 |
| 3 | 연결 상태 표시 | 네트워크 쓰로틀링 테스트 | "연결 중..." 토스트 표시 | 하 |
| 4 | 스토리지 키 정리 | 페이지 전환 시 잔존 데이터 확인 | 키 네이밍 표준화 | 중 |
| 5 | 로비 로딩 성능 | Lighthouse FCP/LCP 측정 | 스켈레톤 로더 | 상 |

---

## 3. 교차 검토 결과

### 3-1. 기획자 → B, C 평가

- B-1(lobby.html 분리): **찬성** — A-2와 동일, 가장 현실적
- B-4(SPA), B-5(EJS): **반대** — 프로젝트 규모 대비 과도한 변경
- C-1(소켓 보존): **찬성** — 게임 전환 시 채팅 끊김은 사용자 불만 요소
- C-4(스토리지 정리): **찬성** — 로비 분리 전 선행 작업으로 적절

### 3-2. 개발자 → A, C 평가

- A-1(통합 로비): **우려** — 모든 게임 JS를 한 페이지에 넣으면 7,000줄+ 파일이 더 커짐
- A-2(독립 로비): **찬성** — B-1과 동일, 구현 가능
- C-1(소켓 보존): **기술적 한계** — 페이지 전환 시 소켓은 불가피하게 끊김. sessionStorage 기반 재연결이 현실적
- C-5(로딩 성능): **찬성** — 로비에서 게임 JS 제거하면 자연스럽게 해결

### 3-3. QA/UX → A, B 평가

- A-2/B-1(독립 로비): **찬성** — 테스트 경로 명확 (로비→게임 단방향)
- 소켓 재연결: 현재 `sessionStorage` 기반 재입장 패턴 이미 존재 → 테스트 가능
- 스토리지 키 정리는 **분리 전에** 해야 테스트 혼란 없음

---

## 4. 합의 도출

| 우선순위 | 기능 | 판정 | 기획 | 개발 | QA/UX | 근거 |
|---------|------|------|------|------|-------|------|
| 1 | lobby.html 독립 분리 | **채택** | O | O | O | 3인 합의, 가장 현실적 |
| 2 | 스토리지 키 정리 | **채택** | O | O | O | 분리 전 선행 필수 |
| 3 | dice-game-multiplayer.html 경량화 | **채택** | O | O | O | 로비 코드 제거로 자동 달성 |
| 4 | lobby-shared.js 모듈화 | **보류** | - | O | - | 1차에선 lobby.html에 직접 작성, 추후 검토 |
| 5 | SPA 전환 / EJS 도입 | **기각** | X | X | - | 순수 HTML 원칙 위배, 과도한 변경 |
| 6 | Web Components | **기각** | - | X | - | 프로젝트 규모 대비 과도 |

---

## 5. 구현 계획

### Phase 0: 스토리지 키 정리 (선행)

- [ ] 현재 사용 중인 localStorage/sessionStorage 키 전수 조사
- [ ] 네이밍 표준화 (gameType 접두사 통일)

### Phase 1: lobby.html 생성

- [ ] `lobby.html` 신규 생성
  - `dice-game-multiplayer.html`에서 로비 관련 HTML 추출 (`#lobbySection`, `#createRoomSection`)
  - 로비 JS 함수 추출 (`renderRoomsList`, `refreshRooms`, `joinRoomDirectly`, `finalizeRoomCreation`, 비밀번호 모달 등)
  - Socket.IO 연결 + 방 목록 이벤트 (`getRooms`, `roomsList`)
  - 공유 모듈 로드 (`ranking-shared.js`, `server-select-shared.js`)
- [ ] `routes/api.js` 수정: `/game` → `lobby.html` 서빙
- [ ] `index.html` 수정: 서버 선택 후 `/game` (lobby)으로 이동

### Phase 2: 게임 페이지 정리

- [ ] `dice-game-multiplayer.html` 경량화
  - 로비 HTML/JS 제거 (약 2,000줄 감소 예상)
  - `?createRoom=true` / `?joinRoom=true` 진입 패턴 추가 (다른 게임과 동일)
  - localStorage `pendingDiceRoom` / `pendingDiceJoin` 패턴 적용
- [ ] 모든 게임 페이지에 "로비로 돌아가기" 버튼 통일 (현재 `leaveRoom()` → `/game`으로 redirect)

### Phase 3: 라우팅 정리

- [ ] `routes/api.js` 정리
  - `/game` → `lobby.html`
  - `/game/dice` → `dice-game-multiplayer.html` (또는 기존 경로 유지)
  - 기존 `/roulette`, `/horse-race`, `/crane-game` 유지

### Phase 4: 테스트

- [ ] 로비 → 각 게임 타입 방 생성 테스트 (4종)
- [ ] 로비 → 각 게임 타입 방 입장 테스트 (4종)
- [ ] 게임 → 로비 복귀 테스트
- [ ] 새로고침 시 재입장 테스트 (sessionStorage)
- [ ] 모바일 반응형 확인

### 수정 대상 파일 요약

| 파일 | 작업 |
|------|------|
| `lobby.html` (신규) | 로비 UI + JS (dice HTML에서 추출) |
| `routes/api.js` | `/game` → lobby.html 서빙 |
| `dice-game-multiplayer.html` | 로비 코드 제거, createRoom/joinRoom URL 파라미터 진입 추가 |
| `index.html` | 서버 선택 후 이동 경로 확인 |
| `socket/rooms.js` | **변경 없음** |
| 기타 게임 HTML | "로비로 돌아가기" 경로 `/game`으로 통일 (이미 대부분 되어있을 수 있음) |

### 변경하지 않는 것

- `socket/rooms.js` — 이미 게임 타입 무관한 공통 구조
- `socket/dice.js`, `socket/horse.js` 등 — 게임 로직 변경 없음
- `ranking-shared.js`, `chat-shared.js` 등 — 공유 모듈 변경 없음
