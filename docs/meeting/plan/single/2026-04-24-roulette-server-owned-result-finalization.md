# 룰렛 서버 주도 결과 확정 개선안
> 일시: 2026-04-24
> 범위: 문서화만 진행, 코드 구현은 후속 작업

## 배경

룰렛 게임은 현재 서버가 당첨자와 회전 파라미터를 한 번 결정한 뒤, 모든 클라이언트가 같은 데이터를 받아 같은 결과를 재생하는 구조다. 이 덕분에 각 클라이언트가 따로 랜덤을 돌리지 않아도 같은 참가자 순서, 같은 당첨자, 같은 최종 각도를 볼 수 있다.

다만 라운드의 최종 확정은 호스트 클라이언트가 애니메이션 종료 후 `rouletteResult`를 서버로 보내는 흐름에 의존한다. 호스트 탭이 백그라운드에 있거나 포커스를 잃거나, 브라우저가 지연되거나, 호스트가 이탈하면 서버의 라운드 상태가 늦게 닫힐 수 있다.

## 현재 구조

현재 룰렛 시작 흐름은 다음과 같다.

1. 호스트가 `startRoulette` 이벤트를 보낸다.
2. 서버가 준비자 목록을 복사해 `participants`를 고정한다.
3. 서버가 `winnerIndex`, `winner`, `spinDuration`, `totalRotation`, `effectType`, `effectParams`를 결정한다.
4. 서버가 모든 클라이언트에 `rouletteStarted`를 보낸다.
5. 각 클라이언트는 같은 `participants`와 `winnerIndex`로 룰렛판과 최종 각도를 계산한다.
6. 호스트 클라이언트는 애니메이션이 끝난 뒤 `rouletteResult`를 서버로 보낸다.
7. 서버가 `rouletteResult`를 받은 뒤 `isRouletteSpinning`과 `isGameActive`를 false로 바꾸고 `rouletteEnded`를 보낸다.

클라이언트의 최종 각도 계산은 서버 데이터에만 의존한다.

```javascript
const segmentAngle = 360 / data.participants.length;
const winnerCenterAngle = (data.winnerIndex + 0.5) * segmentAngle;
const neededRotation = 360 - winnerCenterAngle;
const fullRotations = Math.floor(data.totalRotation / 360);
const finalAngle = fullRotations * 360 + neededRotation;
```

따라서 모든 클라이언트가 같은 결과를 보는 이유는 서버가 같은 "정답지"를 내려주기 때문이다. 클라이언트는 결과를 새로 뽑지 않고, 같은 데이터를 재생한다.

## 문제점

- 결과 결정은 서버가 하지만, 결과 확정은 호스트 클라이언트의 `rouletteResult` 전송에 의존한다.
- 호스트 브라우저가 숨김 상태이거나 포커스가 없으면 애니메이션 콜백이 지연되거나 실행되지 않을 수 있다.
- 호스트가 라운드 중 이탈하면 `isRouletteSpinning` 상태가 오래 남을 수 있다.
- 클라이언트가 보낸 `{ winner }`를 확정 입력으로 사용하는 구조는 서버 저장 결과와 비교하는 보호막이 약하다.

## 개선 방향

라운드 종료 책임을 서버로 옮긴다. 클라이언트는 애니메이션과 화면 표시만 담당하고, 서버가 정한 종료 시각에 서버가 직접 결과를 확정한다.

서버는 `startRoulette` 처리 시 다음 값을 함께 만든다.

```javascript
{
  roundId,
  serverStartedAt,
  displayDurationMs,
  serverEndAt
}
```

- `roundId`: 중복 확정과 늦은 이벤트를 구분하는 라운드 식별자
- `serverStartedAt`: 서버 기준 라운드 시작 시각
- `displayDurationMs`: 실제 룰렛 연출이 끝날 것으로 보는 총 시간
- `serverEndAt`: 서버가 결과를 확정할 예정 시각

서버는 `rouletteStarted`에 위 값을 포함해 전송하고, 내부 타이머로 `serverEndAt`에 결과를 확정한다.

```text
서버: 당첨자/연출/종료 시각 결정
서버 -> 모든 클라: rouletteStarted
각 클라: 같은 데이터로 애니메이션 재생
서버 타이머: serverEndAt 도달 시 결과 확정
서버 -> 모든 클라: rouletteEnded
```

## 시간 계산 기준

현재 클라이언트 애니메이션은 `spinDuration` 전체를 항상 쓰지 않는다. 메인 회전은 `spinDuration * 0.75`이고, 마무리 효과에 따라 종료 시간이 달라진다.

```text
normal:
  spinDuration * 0.75

bounce:
  spinDuration * 0.75 + bounceDuration

slowCrawl:
  spinDuration * 0.75 + crawlDuration

shake:
  spinDuration * 0.75 + shakeDuration * (shakeCount * 2 + 1)
```

서버 구현 시에는 이 계산을 `displayDurationMs`로 캡슐화한다. 클라이언트가 효과별 종료 시간을 다시 판단하지 않도록, 서버가 확정한 `displayDurationMs`와 `serverEndAt`을 신뢰하게 만든다.

결과 표시 안정성을 위해 실제 서버 확정 타이머에는 짧은 여유 시간을 둘 수 있다.

```text
serverEndAt = serverStartedAt + displayDurationMs + resultGraceMs
```

초기 권장값은 `resultGraceMs = 500`이다.

## 호환 전략

- 기존 `rouletteStarted` 필드는 유지하고, `roundId`, `serverStartedAt`, `displayDurationMs`, `serverEndAt`만 추가한다.
- 기존 `rouletteResult` 이벤트는 바로 제거하지 않고 호환용으로 남긴다.
- 후속 구현에서는 `rouletteResult`가 도착해도 서버의 pending round와 `roundId`, `winner`가 일치할 때만 보조 완료 신호로 취급한다.
- 서버가 이미 결과를 확정했다면 이후 도착한 `rouletteResult`는 무시한다.
- 서버 저장 결과와 다른 `winner`가 오면 결과를 바꾸지 않고 무시한다.

## 기대 효과

- 호스트 탭 상태와 무관하게 라운드가 자동 종료된다.
- 호스트 이탈, 백그라운드 탭, 느린 브라우저 때문에 룰렛 상태가 묶일 가능성이 줄어든다.
- 당첨자 결정뿐 아니라 결과 확정까지 서버 책임이 되어 공정성 설명이 쉬워진다.
- 늦게 보거나 화면을 놓친 클라이언트는 기존 다시보기 흐름으로 같은 결과를 확인할 수 있다.

## 후속 구현 체크리스트

- `socket/roulette.js`에 pending round 상태와 서버 종료 타이머를 추가한다.
- `rouletteStarted` payload에 `roundId`, `serverStartedAt`, `displayDurationMs`, `serverEndAt`을 추가한다.
- 결과 확정 로직을 공통 함수로 분리해 서버 타이머와 호환용 `rouletteResult`가 같은 경로를 사용하게 한다.
- 클라이언트는 `rouletteResult` emit 의존도를 낮추고, `rouletteEnded`를 최종 상태 동기화 이벤트로 사용한다.
- 호스트 숨김, 호스트 이탈, 늦은 `rouletteResult`, 잘못된 `winner` 전송 시나리오를 QA에 포함한다.

## 결정

v1 개선은 "서버 주도 결과 확정"을 목표로 한다. 룰렛의 시각적 연출은 유지하고, 라운드 종료와 기록/통계 반영 책임만 서버로 옮긴다. 색상 선택, 효과음 연결, 추가 룰 옵션은 별도 개선으로 분리한다.
