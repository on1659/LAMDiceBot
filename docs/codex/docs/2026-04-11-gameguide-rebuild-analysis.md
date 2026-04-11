# GameGuide 재구성 분석

날짜: 2026-04-11
기준: `docs/GameGuide`를 처음부터 다시 만든다는 가정

## 목적

이 문서는 현재 `docs/GameGuide`가 실제 코드 구조와 얼마나 맞는지 다시 점검하고, 새로 문서를 만든다면 어떤 기준과 구조로 재편해야 하는지 정리한 메모입니다.

## 결론 요약

현재 `docs/GameGuide`는 유지보수보다 재구성이 더 적절합니다.

이유는 다음과 같습니다.

- 현재 운영 구조보다 과거 구조 설명이 더 많이 남아 있음
- 운영 문서, 계획 문서, 제안 문서, 구현 메모가 같은 레벨에 섞여 있음
- 실제 코드 기준 축보다 문서 작성 당시의 작업 단위 기준 축이 강함
- QA 문서와 테스트 경로 일부가 현재 저장소 상태와 맞지 않음

한 줄로 정리하면, 지금의 `GameGuide`는 "현재 시스템 설명서"라기보다 "현재 문서 + 과거 메모 + 제안 아카이브"의 혼합본에 가깝습니다.

## 현재 코드 기준 실제 구조

문서를 다시 만들 때 기준이 되어야 하는 실제 코드 구조는 아래에 가깝습니다.

### 1. 서버 진입점

- `server.js`
- `routes/api.js`
- `routes/server.js`

### 2. 실시간 소켓 구조

- `socket/index.js`
- `socket/rooms.js`
- `socket/shared.js`
- `socket/dice.js`
- `socket/roulette.js`
- `socket/horse.js`
- `socket/chat.js`
- `socket/board.js`
- `socket/server.js`

### 3. 상태 및 공통 유틸

- `utils/room-helpers.js`
- `config/index.js`
- `config/client-config.js`

### 4. 데이터 계층

- `db/init.js`
- `db/stats.js`
- `db/menus.js`
- `db/suggestions.js`
- `db/ranking.js`
- `db/servers.js`
- `db/auth.js`
- `db/vehicle-stats.js`

### 5. 프런트 공통 모듈

- `js/shared/chat-shared.js`
- `js/shared/ready-shared.js`
- `js/shared/order-shared.js`
- `js/shared/ranking-shared.js`
- `js/shared/server-select-shared.js`
- `js/shared/control-bar-shared.js`
- `js/shared/countdown-shared.js`
- `js/shared/page-history-shared.js`

### 6. 실제 운영 페이지

- `dice-game-multiplayer.html`
- `roulette-game-multiplayer.html`
- `horse-race-multiplayer.html`
- `admin.html`
- `pages/*.html`

## 현재 GameGuide의 핵심 문제

### 1. 문서 축이 코드 축과 다름

현재 `GameGuide`는 `game-type`, `system`, `feature-proposals`, `01-plan` 등으로 나뉘어 있습니다.

하지만 실제 프로젝트는 아래 축으로 이해하는 편이 정확합니다.

- 서버/라우트
- 소켓 이벤트 구조
- room state
- 공통 프런트 모듈
- 데이터 저장 및 폴백
- 게임별 규칙/화면
- 운영/배포/QA

즉 지금 문서 구조는 "실제 코드가 어떻게 돌아가는가"보다 "예전 작업을 어떻게 분류했는가"에 더 가깝습니다.

### 2. `server.js` 중심 설명이 과도함

기존 주사위/경마 문서는 `server.js` 줄 번호 기준 설명이 많습니다.

하지만 현재 게임별 로직은 이미 상당 부분 `socket/*.js`로 분리돼 있습니다.

예시:

- 주사위: `socket/dice.js`
- 경마: `socket/horse.js`
- 방 관련 상태: `socket/rooms.js`
- 공통 규칙: `socket/shared.js`

따라서 새 문서는 파일 분리 이후 구조를 기준으로 작성하는 것이 맞습니다.

### 3. QA 문서가 저장소 현실과 맞지 않음

`docs/GameGuide/system/QA-GUIDE.md`에는 현재 없는 테스트 경로가 적혀 있습니다.

대표 예시:

- `AutoTest/dice/dice-test-bot.js`
- `AutoTest/roulette/test-bot.js`
- `AutoTest/console-error-check.js`
- `AutoTest/horse.bat`

즉 QA 문서는 "실행 가능한 운영 가이드"가 아니라 "예전 테스트 체계 기준 메모"가 섞인 상태입니다.

### 4. 운영 라우트와 문서 기준이 어긋남

예를 들어 경마 문서는 직접 HTML 경로 접근을 기준으로 설명하는 부분이 남아 있지만, 현재 실제 라우트는 `routes/api.js`에서 `/horse-race`로 서빙됩니다.

즉 문서는 "파일 경로"보다 "사용자 진입 경로" 기준으로 다시 써야 합니다.

### 5. 아카이브와 현재 문서가 섞여 있음

현재 `docs/GameGuide`에는 아래 성격의 문서가 같은 레벨에 섞여 있습니다.

- 현재 구조 설명
- 기능 제안
- 미완료 계획
- 예전 리팩터링 전제 문서
- 아이디어 회의 메모에 가까운 문서

이 상태에서는 새 팀원이나 미래의 본인이 봐도 "지금 읽어야 할 문서"와 "보관용 문서"를 구분하기 어렵습니다.

## 새 GameGuide를 만들 때의 기준

새 문서는 "이 프로젝트가 지금 실제로 어떻게 동작하는지"를 설명해야 합니다.

기준은 다음과 같습니다.

### 1. 현재 동작 우선

- 현재 라우트
- 현재 이벤트 흐름
- 현재 데이터 구조
- 현재 실행 가능한 QA 절차

### 2. 코드 구조 우선

- 폴더와 모듈 기준 설명
- 실제 책임 분리 기준 설명
- 줄 번호 중심 문서 지양

### 3. 운영 문서와 아카이브 분리

- 지금 살아 있는 문서
- 제안/과거 계획/폐기 후보 문서

이 둘을 한 폴더 안에서 같은 우선순위로 두면 안 됩니다.

## 추천 새 문서 구조

```text
docs/GameGuide/
  README.md
  00-current-product/
    overview.md
    runtime-map.md
  01-architecture/
    server-bootstrap.md
    routes-and-pages.md
    socket-system.md
    room-state.md
    data-model.md
  02-shared-systems/
    ready-chat-order.md
    ranking-and-stats.md
    server-membership.md
    sound-system.md
    config-and-env.md
  03-games/
    dice.md
    roulette.md
    horse-race.md
    crane-game.md
  04-ops/
    local-dev.md
    qa.md
    deploy.md
    release-checklist.md
  90-archive/
    proposals/
    old-plans/
    legacy-guides/
```

## 각 섹션이 담아야 할 내용

### `README.md`

- 문서 전체 지도
- 현재 운영 문서와 보관 문서의 차이
- 처음 읽을 순서

### `00-current-product`

- 지금 서비스가 무엇인지
- 어떤 게임이 실제 운영 중인지
- 현재 사용자 진입 경로

### `01-architecture`

- 서버 부팅 과정
- Express 라우트 구조
- Socket.IO 등록 구조
- `createRoomGameState()` 기준 room 상태 모델
- DB 및 파일 폴백 구조

### `02-shared-systems`

- ready/chat/order 공통 모듈
- 랭킹과 통계
- 서버 멤버십/관리자 기능
- 사운드 시스템
- 환경변수와 공통 설정

### `03-games`

- 게임별 규칙
- 게임별 프런트 화면 구조
- 게임별 서버 이벤트
- 공통 시스템과의 연결 방식

### `04-ops`

- 로컬 실행
- QA 실제 절차
- 배포 방식
- 릴리즈 전 체크리스트

### `90-archive`

- 기능 제안 문서
- 미완성 계획
- 과거 구조 전제 문서
- 더 이상 현재 구조 설명서로 쓰면 안 되는 문서

## 현재 문서 중 아카이브 후보

아래는 새 문서 체계에서는 `archive`로 내리는 것이 더 자연스러운 문서들입니다.

- `docs/GameGuide/feature-proposals/*`
- `docs/GameGuide/01-plan/*`
- `server.js 몇 줄` 방식의 과거 구조 설명 문서
- 현재 없는 `AutoTest` 경로를 기준으로 쓴 QA 문서

## 새 문서 작성 시 반드시 기준으로 삼아야 할 파일

### 서버/라우트

- `server.js`
- `routes/api.js`
- `routes/server.js`

### 실시간 구조

- `socket/index.js`
- `socket/rooms.js`
- `socket/shared.js`
- `socket/dice.js`
- `socket/roulette.js`
- `socket/horse.js`

### 상태/설정

- `utils/room-helpers.js`
- `config/index.js`
- `config/client-config.js`

### 데이터

- `db/init.js`
- `db/stats.js`
- `db/menus.js`
- `db/suggestions.js`
- `db/ranking.js`
- `db/servers.js`
- `db/auth.js`
- `db/vehicle-stats.js`

### 프런트 공통

- `js/shared/*`
- `assets/sounds/sound-config.json`

## 실제 재작성 우선순위

1. `README.md`
2. 현재 구조 요약
3. 라우트/소켓/room-state 문서
4. 공통 시스템 문서
5. 게임별 문서
6. QA/배포 문서
7. 기존 문서 archive 이동

## 최종 판단

`docs/GameGuide`는 "조금 고쳐서 계속 쓰는 구조"보다 "현재 코드 기준으로 새 골격을 세우고, 기존 문서를 archive로 분리하는 구조"가 더 적합합니다.

핵심은 다음입니다.

- 게임별 설명보다 상위의 공통 시스템 설명이 먼저 와야 함
- 운영 문서와 제안 문서를 분리해야 함
- `server.js` 줄 번호 기반 문서에서 모듈 구조 기반 문서로 넘어가야 함
- 현재 실제로 실행 가능한 QA와 라우트를 기준으로 다시 써야 함
