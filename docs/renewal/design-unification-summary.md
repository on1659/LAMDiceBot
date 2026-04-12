# 디자인 통합 (Design Unification) 변경 요약

> **브랜치**: `feature/design-unification`
> **기간**: 2026-04-04 ~
> **목적**: 3개 게임(주사위/룰렛/경마)의 UI/UX를 하나의 디자인 시스템으로 통일

---

## 1. 색상 시스템 통합

### 1-1. 게임별 메인 색상 변경

| 게임 | Before | After |
|------|--------|-------|
| 경마 | `#8B4513` (갈색) | `#F5A623` (웜 앰버) |
| 룰렛 배경 | `#8e99a4` (회색) | `#1a5c3a → #2d7a52` (딥그린 그라디언트) |
| 주사위 | 유지 | 유지 |

### 1-2. CSS 변수 토큰화

- **하드코딩 rgba 제거**: `rgba(102,126,234,0.3)` → `rgba(var(--dice-500-rgb),0.3)`
- **RGB 채널 변수 추가** (`theme.css`): `--dice-500-rgb`, `--green-500-rgb`, `--red-500-rgb` 등 (다크모드 포함)
- **게임별 파스텔 배경 토큰**: `--dice-accent-bg`, `--roulette-accent-bg`, `--horse-accent-bg`
- **공통 링크/SEO 색상**: `--link-brand`, `--link-brand-light`, `--heading-brand`

### 1-3. 변경 파일

- `css/theme.css` — 토큰 정의, 다크모드 RGB 변수
- `css/horse-race.css` — 경마 색상 전환
- `dice-game-multiplayer.html`, `roulette-game-multiplayer.html`, `horse-race-multiplayer.html` — 인라인 rgba → CSS 변수

---

## 2. 3게임 공통 UI 패턴 통일

### 2-1. 게임 상태 바

`.game-status` 클래스에 상태별 스타일 통일:

| 상태 | 클래스 | 배경 | 글자색 |
|------|--------|------|--------|
| 대기 | `.waiting` | `--gray-100` | `--gray-700` |
| 주문 | `.ordering` | `--status-warning-bg` | `--status-warning-text` |
| 진행 | `.playing` | `--status-success-bg` | `--status-success-text` |

- `font-weight: bold` 통일 (주사위 기존 `600` → `bold`)

### 2-2. 히스토리 패널

- 인라인 `font-family` 지정 제거 → 상속
- `.history-section.visible` 토글 통일 (`body.game-active` 조건 제거)
- 타이틀 스타일 및 열기/닫기 방식 3게임 동일

### 2-3. 방 폭파 카운트다운

- 배경색 `--yellow-100` → `--status-warning-bg` (공통 토큰 사용)

---

## 3. 새 공유 모듈

| 파일 | 역할 |
|------|------|
| `js/shared/control-bar-shared.js` | 컨트롤바 렌더링 + 볼륨 슬라이더. 3게임 공통 `ControlBar.init()` |
| `js/shared/countdown-shared.js` | 3-2-1-START! 카운트다운 오버레이. `showGameCountdown()` 전역 함수 |
| `js/shared/ranking-shared.js` | 랭킹 오버레이 — CSS 하드코딩 → CSS 변수 전환 |

---

## 4. 랭킹 시스템 통합

- 컨트롤바에 `🏆 랭킹` 버튼 추가 (3게임 동일 `ranking-shared.js` 오버레이)
- `#rankingBtn` 스타일 `theme.css`에 정의
- 경마 인라인 `liveRankingPanel` HTML 제거 → JS 동적 생성
- 경마 탈것 이름 매핑 4종 추가 (knight/dinosaur/ninja/crab)
- **랭킹 시즌 아카이브**: 새 시즌 시작 + 과거 시즌 열람 기능

---

## 5. 광고 배치 통일

| 위치 | 변경 내용 |
|------|----------|
| 게임중 하단 | 3게임 모두 `ad-container ad-game` 슬롯 추가 |
| 로비 | 룰렛/경마 `ad-lobby`를 접속자 목록 아래로 위치 통일 |
| 페이지 하단 | SEO 섹션 앞 → footer 앞으로 이동 |

---

## 6. 메인 페이지 (`index.html`) 리디자인

| 영역 | 변경 내용 |
|------|----------|
| 헤더 | 불투명 배경 → 글래스모피즘 (`backdrop-filter: blur(12px)`) |
| 히어로 제목 | 2em → 2.5em, `letter-spacing: -0.5px` |
| CTA 버튼 | 각진 모서리 → 필 모양 (`border-radius: 50px`), `cta-pulse` 애니메이션 |
| 게임 카드 | 상단 게임별 컬러 강조선, `card-in` 페이드인 애니메이션, hover lift 강화 |
| 콘텐츠 링크 | hover 시 `translateY(-2px)` 마이크로인터랙션 |
| 폰트 | `h1~h3`에 Jua 폰트 적용 |
| 링크 경로 | `*.html` → `/pages/*.html` |

---

## 7. 프로젝트 구조 정리

### 7-1. 파일 이동

| Before | After |
|--------|-------|
| `config.js` | `config/index.js` |
| `chat-shared.js` (루트) | `js/shared/chat-shared.js` |
| `order-shared.js` (루트) | `js/shared/order-shared.js` |
| `ready-shared.js` (루트) | `js/shared/ready-shared.js` |
| `ranking-shared.js` (루트) | `js/shared/ranking-shared.js` |
| `tutorial-shared.js` (루트) | `js/shared/tutorial-shared.js` |
| `gif-recorder.js` (루트) | `js/gif-recorder.js` |
| `gif.worker.js` (루트) | `js/gif.worker.js` |
| `tagline-roller.js` (루트) | `js/tagline-roller.js` |
| `gemini-utils.js` (루트) | `utils/gemini-utils.js` |
| `test-*.js` (루트) | `tests/` |
| 각종 `*.html` (루트) | `pages/` |

### 7-2. 문서 구조 재편

- `docs/GameGuide/` 전면 재구성 (00~04 + 90-archive)
- 기존 `docs/meeting/plan/`, `docs/meeting/impl/` 대량 정리/삭제
- `AutoTest/` 전체 삭제 (재설계 예정)
- `summit-log.txt`, `update-log_old.md` 등 레거시 파일 삭제

### 7-3. 크레인 게임

- 크레인 게임 참조 전체 제거 (비공개 처리)
- `crane-game-multiplayer.html` 최소화

---

## 8. 기타

- **텔레그램 봇 코드 분리**: 게임 서버에서 제거 → LAMDice-Pilot 프로젝트로 이관
- **서버 멤버십 라우트 추가** (`routes/api.js`, `routes/server.js`)
- **DB**: `db/init.js`에 시즌 아카이브 테이블, `db/ranking.js` 시즌 로직 추가
