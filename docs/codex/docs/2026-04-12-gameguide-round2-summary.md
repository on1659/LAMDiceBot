# GameGuide 2차 정리 요약

날짜: 2026-04-12
관련 커밋: `0133103` `docs: rebuild GameGuide structure`

## 목적

`docs/GameGuide`를 현재 코드 기준 문서로 다시 세운 뒤, 2차 점검에서 확인한 어긋남을 함께 정리한다.

## 이번에 수정한 내용

### 1. 문서 구조 재구성

- `docs/GameGuide`를 현재 운영 문서와 아카이브로 분리했다.
- 운영 문서를 아래 구조로 재편했다.
  - `00-current-product/`
  - `01-architecture/`
  - `02-shared-systems/`
  - `03-games/`
  - `04-ops/`
  - `90-archive/`
- 과거 `feature-proposals`, `01-plan`, `game-type`, `system` 하위 문서는 역할에 맞게 `90-archive/` 또는 새 운영 폴더로 이동했다.

### 2. 메인 진입 문서 재작성

- `docs/GameGuide/README.md`를 현재 구조 기준으로 다시 작성했다.
- 현재 운영 문서와 보관 문서의 경계를 분리했다.
- 문서 작성 원칙에 "현재 라우트", "현재 소켓 이벤트명", "현재 상태 필드" 기준을 명시했다.

### 3. 주사위 문서 정정

- `docs/GameGuide/03-games/dice.md`를 현재 구현 기준으로 다시 작성했다.
- `requestGameStart` 같은 예전 이벤트명을 제거하고 `startGame` 기준으로 정리했다.
- `toggleReady`가 payload 없이 동작한다는 점을 반영했다.
- `createRoomGameState()`의 실제 기준 위치를 `utils/room-helpers.js` 중심으로 설명했다.
- 공통 이벤트(`socket/shared.js`)와 게임 전용 이벤트(`socket/dice.js`)를 나눠 설명했다.

### 4. 경마 문서 정정

- `docs/GameGuide/03-games/horse-race.md`를 현재 구현 기준으로 다시 작성했다.
- 방 타입을 `horse`가 아니라 `horse-race` 기준으로 정정했다.
- `setTrackLength` payload를 `{ length }`가 아니라 `{ trackLength }` 기준으로 정정했다.
- 선택 단계 문서를 `horseSelectionReady`, `horseSelectionUpdated`, `randomHorseSelected`, `horseSelectionCancelled` 중심으로 정리했다.
- 예전 재경주 이벤트(`requestReraceReady`, `startRerace`, `reraceReady`)는 현재 운영 계약에서 제거했다.
- `horseRaceResult`, `horseRaceEnded`, `horseRaceGameReset` payload 범위를 현재 서버 emit 기준으로 반영했다.

### 5. QA 문서 정리

- `docs/GameGuide/04-ops/QA-GUIDE.md`를 현재 저장소 기준으로 다시 작성했다.
- 현재 없는 AutoTest 경로를 전제로 한 옛 설명을 제거했다.
- 실제로 남아 있는 `AutoTest/horse-race/test-loser-slowmo.js`만 현재 사용 가능한 자동화 테스트로 남겼다.
- 공통 모듈 수정 시 어떤 게임까지 같이 확인해야 하는지 다시 정리했다.

## 이번에 확인된 효과

- `docs/GameGuide`가 "현재 문서 + 과거 메모" 혼합 상태에서 "운영 문서 + 아카이브" 구조로 바뀌었다.
- 메인 운영 문서에서 레거시 이벤트명과 삭제된 경로 참조를 대부분 제거했다.
- 새로 문서를 읽는 사람이 현재 라우트, 현재 이벤트명, 현재 폴더 구조를 기준으로 따라갈 수 있는 상태가 됐다.

## 아직 수정이 필요한 내용

### 1. 경마 클라이언트 레거시 흔적 정리

`js/horse-race.js`에는 현재 서버 계약과 완전히 일치하지 않는 오래된 흔적이 남아 있다.

- `horseSelected` 리스너가 남아 있음
- `updateGameRules({ horseRaceMode: 'last' })` 형태의 emit 흔적이 남아 있음

운영 문서는 현재 계약 기준으로 정리했지만, 코드도 같은 기준으로 정리하면 혼선을 더 줄일 수 있다.

### 2. 경마 문서와 실제 클라이언트 흐름 추가 대조

현재 문서는 서버 기준 계약에 맞춰 정리했다.
다만 이후에는 아래 항목도 한 번 더 맞춰볼 필요가 있다.

- 선택 단계 UI 흐름
- 랜덤 선택 후 ready 처리 흐름
- 결과창/다시보기/게임 리셋 흐름

즉, 지금은 "서버 기준 정합성"은 맞췄고, 다음 단계는 "클라이언트 UX 흐름 설명 보강"이다.

### 3. 룰렛 문서 정밀 검수

이번 2차 수정의 중심은 `README`, `dice`, `horse-race`, `QA-GUIDE`였다.
`docs/GameGuide/03-games/roulette.md`는 구조 재편에는 포함됐지만, 이벤트 계약 수준의 세밀한 대조는 아직 부족하다.

다음 점검 포인트:

- 룰렛 전용 소켓 이벤트명
- 공통 이벤트와 전용 이벤트 분리
- 결과/랭킹/히스토리 payload 설명

### 4. 아키텍처 문서 세부 보강

현재는 큰 구조를 세우는 데 집중했다.
다음 단계에서는 아래 문서를 더 촘촘히 보강할 수 있다.

- `01-architecture/socket-system.md`
- `01-architecture/data-model.md`
- `02-shared-systems/shared-modules.md`

특히 "공통 이벤트는 어디서 처리되고, 게임 전용 이벤트는 어디서 갈리는지"를 더 선명하게 정리하면 유지보수성이 좋아진다.

### 5. archive 문서 안내 문구 보강

현재 `90-archive/`로 과거 문서를 잘 옮겼지만, 일부 문서는 예전 이벤트명과 예전 구조를 그대로 포함한다.
의도된 보관이긴 하지만, 아래 안내를 더 넣으면 혼동을 줄일 수 있다.

- archive 문서는 현재 구현 기준이 아님
- line number 중심 설명은 과거 버전 기준임
- 운영 판단에는 `README`와 새 운영 문서를 우선 사용

## 다음 추천 작업

1. `js/horse-race.js`의 레거시 이벤트 흔적 정리
2. `roulette.md`를 코드 기준으로 1회 재검수
3. `socket-system.md`와 `shared-modules.md`를 이벤트 흐름 중심으로 보강
4. `90-archive/` 상단에 "보관 문서" 안내 추가

## 결론

이번 2차 작업으로 `docs/GameGuide`는 구조와 기준이 크게 바로잡혔다.

다만 완성 단계라기보다는 "현재 운영 문서의 기준선이 생긴 상태"에 가깝다.
이후 작업은 새 구조를 다시 뒤엎는 것이 아니라, 현재 구조 안에서 게임별 세부 정합성과 클라이언트 레거시 흔적을 정리하는 방향이 맞다.
