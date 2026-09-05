# goal: ladder-horse-style-5lane

## One-line Goal
사다리타기를 **`9f82a1c`(2026-06-17)의 경마화 메커니즘으로 되돌리고**, 소유자가 오늘 확정한
4가지를 얹는다: **레인 5개**(그때 6), **번호 중복 선택 허용**(그때 1인 1레인), **인원 상한 없음**
(그때 6명), **「당첨」**(그때 「꽝」 💀). 중복 허용 때문에 새로 필요해지는 **재경기**를 경마
패턴으로 붙인다. `dbd8f2a`로 복원해둔 v2(네이버식 라벨 편집)는 이 게임이 아니므로 걷어낸다.

## Background / Motivation
소유자 증언 (2026-09-05):

> "우린 경마같은 거야. 경마인데 그 과정이 사다리인 것뿐이야. 아래 선택지에 이름 쓰는 거?
> 사람들이 자기 위치 고르는 거? 그런 거 없음. 이미 5개가 세팅되어 있고, 사람들은 몇 번에서
> 시작할지 고르는 거야. 그리고 자연스럽게 내려가고. 중복 있으면 한 번 더 하는 식이고."
>
> "ladder 브랜치에서는 내가 원하는대로 사다리가 동작했었는데"

이력을 뒤져 그 버전을 특정했다.

| 커밋 | 날짜 | 내용 |
|---|---|---|
| `569a3f2` | 06-10 | 사다리 경마화 — 6레인 고정 + 번호(1~6) 고르기 + 동시 출발/도착 |
| `f2b91d9` | 06-17 | 다중 막대기·스크램블·히든 리빌·자동 레인 점유 |
| **`9f82a1c`** | **06-17** | **연출 2× 둔화·중력 하강 ← 경마화 사다리의 완성형 (복원 기준점)** |
| `53656e1` | 07-01 | v2 네이버식으로 in-place 교체 — 여기서 경마화가 사라짐 |
| `f7cafa1` | 07-02 | pick-elimination (숨은 막대기 + 토너먼트) |
| `dbd8f2a` | 09-05 | v2 복원 (현재 HEAD) |

`9f82a1c`는 main에 있던 상태다. `feature/ladder-rung-color-speed` 브랜치가 `569a3f2`에 멈춰 있다.
**소유자가 기억하는 "잘 되던 사다리"는 `9f82a1c`다.**

### `9f82a1c`가 이미 옳게 하고 있던 것
`socket/ladder.js:453` (그 시절) 주석 그대로:

> 꽝(losingLane)은 반드시 **점유된 레인 중에서만** 선택 — 6레인 고정이라 빈 레인이 있어도
> "패자 없는 판"이 생기지 않게 한다(꽝 항상 정확히 1명). **점유 레인 균등 랜덤** → 공정성 불변.
> kkwangBottom은 **그 레인의 도착 바닥칸**.

막대기를 조작해서 맞추는 게 아니라, **사람이 있는 레인 중 균등 추첨 → 그 레인의 도착칸에 표식을
놓는다.** 소유자가 오늘 요구한 "아무도 안 고른 애는 당첨 안 걸리게"가 이미 이 설계로 보장된다.

## Decisions locked (소유자 확인, 2026-09-05 — 구현 중 재논의 금지)
1. **구현 기반 = `9f82a1c` 메커니즘 복원.** 새로 설계하지 않는다.
2. **레인 5개 고정 (번호 1~5).** 줄 수 스테퍼 없음.
3. **번호 중복 선택 허용** — 남이 고른 번호도 고를 수 있다.
4. **방 인원 상한 없음** — 경마와 동일 (`9f82a1c`의 `LADDER_MAX_PLAYERS = 6` 폐기).
5. **바닥 표식은 「당첨」** — 상인지 벌칙인지는 유저들이 정한다. 게임은 "누가 걸렸는지"까지만 말한다.
6. **💀 폭탄 룰렛 포인터 연출 부활** — 하강 전에 바닥칸을 가속→감속으로 훑다가 당첨 칸에 딱 정지.
7. **하강 = 한 명씩 차례로, 마지막 두 토큰만 같이.** (`9f82a1c`는 마지막도 혼자였다 — "마지막에는
   같이"만 v2에서 가져온다.)
8. **막대기 그리기 유지** — 인당 3개, 전원 실시간 가시.
9. **당첨자를 승자로 랭킹·통계에 기록** — 지금 비어 있는 사다리 랭킹 탭이 채워진다.
10. **당첨자 2명 이상이면 그 사람들만 30초 자동 재경기**, 한 명이 남을 때까지.
11. **미선택자는 경마처럼 자동 배정**하고 채팅으로 알린다.

## 룰 (게임 흐름)

```
[대기] 방 입장 → 서버가 빈 레인 하나를 자동 점유해줌 → 준비
   ↓
[빌드] 번호 1~5 중 고르기 (중복 OK, 언제든 변경 OK)
       + 막대기 그리기 (인당 3개, 서로 실시간으로 보임)
   ↓  방장이 [시작] (준비 ≥ 2명) — 안 고른 사람은 서버가 자동 배정
[공개] 3·2·1 → 막대기 지우기 → 새로 그리기 → 한 박자 멈춤
       → 💀 폭탄 포인터가 바닥칸을 훑다가 「당첨」 칸에 정지
       → 토큰이 한 명씩 차례로 하강 (마지막 두 개는 같이)
   ↓
[결과] 「당첨」 칸에 도착한 레인을 고른 사람(들)이 당첨
   ├─ 1명  → 끝. 결과 발표.
   └─ 2명+ → 그 사람들만 자동 준비 + 30초 뒤 자동 시작 → [빌드]로 (한 명 남을 때까지)
```

## 설계 결정 (재논의 금지)

### D1. 당첨 레인은 최종 착지 계산이 끝난 뒤 점유 레인 중에서 균등 추첨한다
`9f82a1c`의 `doReveal` 방식 그대로다. 순서가 중요하다:

1. 스크램블까지 끝난 **최종 보드**로 `laneToBottom`(레인 → 도착 바닥칸)을 계산한다.
2. `occupiedLanes` = 사람이 한 명이라도 고른 레인들.
3. `winLane` = `occupiedLanes` 중 **서버 RNG 균등 추첨**.
4. `winBottom` = `laneToBottom[winLane]` — 그 칸에 「당첨」을 놓는다.
5. `winners` = `winLane`을 고른 사람 전원.

빈 레인은 3단계에서 후보에 없으므로 **구조적으로 당첨될 수 없다.** 막대기는 한 개도 조작하지 않는다.

**확률**: 점유 레인이 k개면 각 레인 1/k. 같은 번호를 고른 사람들은 함께 당첨된다 — 경마에서
같은 말에 여럿 건 것과 같다. 막대기를 어떻게 그리든 이 분포는 바뀌지 않는다.

### D2. 하강 중 막대기 변형(living-rungs)은 넣지 않는다
`9f82a1c`에는 없던 기능이다(`mutation` 등장 0회). v2에서 도입된 것이고, 이번 복원 범위 밖이다.
하강은 **스크램블이 끝난 고정 보드**에서 진행한다. 이래야 폭탄 포인터가 미리 공개한 당첨 칸과
하강 결과가 어긋날 여지가 없다.

**단, 마지막 두 토큰은 같이 내려보낸다** — 마지막 한 명의 결과가 미리 확정돼 김빠지는 것을 막는
v2의 개선점이고, 소유자가 명시적으로 요청했다(Decision 7).

### D3. v2의 카드 셔플 연출(`LADDER_SHUFFLE_MS`)은 제거한다
폭탄 포인터가 "당첨 칸이 어디인지"를 보여주는 역할을 이미 한다. 두 연출은 같은 정보를 두 번
말하는 것이므로 셔플을 걷어낸다. `perm`/`shufflePermutation`도 함께 제거한다
(바닥 라벨이 사라지면 섞을 대상 자체가 없다).

### D4. v2가 만든 것 중 **메커니즘과 무관한 하드닝만** 이식한다
`dbd8f2a`로 만든 것 중 아래는 게임 룰과 독립적이므로 복원본 위에 살려 온다:

- **`points` 깊은 복사** — `buildLadder`의 union이 `points` 배열 참조를 원본과 공유해
  `resolveContacts`가 원본을 오염시키던 버그("내가 그린 선이 제멋대로 변한다").
  **`9f82a1c`에도 같은 구조가 있는지 먼저 확인하고, 있으면 양쪽 분기 모두 고친다.**
- **재접속 자동 재입장** + 재진입자 개인 emit 복구.
- **백그라운드 탭 대응** — `gameEnd → jumpToFinal`(멱등 적용 + 최종 프레임), 진행 중 재진입 시
  경과 ms로 연출 seek. 폭탄 포인터 단계도 seek 대상에 포함해야 한다.
- **`getCurrentRoom`의 ladder 통째 마스킹**(C-20) — 공개 전 `winLane`/`winBottom` 누출 차단.

반대로 **v2의 게임 로직**(라벨 편집, 줄 수, `perm` 셔플, physical descent 슬롯 그리드,
living-rungs)은 가져오지 않는다.

### D5. 토큰은 점유 레인만. 빈 레인은 기둥만 선다
`9f82a1c` 그대로 — `tokenCount = 점유 레인 수`. 5레인 중 3개만 점유됐으면 토큰 3개가 내려간다.
중복 선택이어도 **레인당 토큰은 하나**(그 레인을 고른 사람들이 그 토큰을 공유한다).

### D6. 입장 시 자동 레인 점유는 유지하되 "빈 레인 우선"
`9f82a1c`는 입장 즉시 빈 레인 하나를 균등 랜덤 배정했다(자리를 먼저 주고 마음에 안 들면 옮기는
방식). 중복이 허용돼도 **자동 배정은 빈 레인을 우선**해서 자연스럽게 분산시킨다. 빈 레인이
없으면 아무 레인이나 배정한다. 사람이 직접 고를 때만 중복이 생긴다.

### D7. 튜토리얼 억제 버전은 올리지 않는다 (구현 중 확인해 뒤집은 결정)
처음엔 "룰이 바뀌었으니 다시 보여주자"고 적었으나, `js/shared/tutorial-shared.js:5`의 `VERSION`은
**전 게임 공용 상수**다. 올리면 주사위·룰렛·경마 튜토리얼까지 모든 사용자에게 다시 뜬다.
사다리 하나 때문에 치를 값이 아니다. 게임별 버전 분리는 이번 범위 밖(별도 요청 시).
사다리는 실서버에서 아직 막혀 있어 억제가 걸린 사람은 로컬 개발자뿐이고, 그들은 도움말(?) 버튼으로 볼 수 있다.
튜토리얼 **문구**는 새 룰로 전면 교체한다.

### D8. DB는 경마와 같은 시점에 기록한다
경마는 재경기 라운드도 매번 기록하고 동점자 전원에게 `is_winner=true`를 준다
(`socket/horse.js:1209`). 사다리도 **매 판** 기록한다 — 중복 당첨 판에서는 당첨자 전원이,
이어지는 재경기 판에서 최종 1명이 다시 승자로 들어간다.

## In-scope (파일별)

### `config/index.js`
- `LADDER_REMATCH_AUTO_START_MS` 추가 (기본 30000, env 오버라이드 — `HORSE_REMATCH_AUTO_START_MS`와 같은 꼴).

### `socket/ladder.js` — `9f82a1c` 버전을 기준으로 재작성
**상수 (`9f82a1c`에서 가져오되 조정)**
- `LADDER_LANES = 5` (그때 6).
- `LADDER_MAX_PLAYERS` **삭제** (인원 상한 없음).
- 연출 타이밍 복원: `LADDER_COUNTDOWN_MS 3200` / `ERASE 2400` / `DRAW 1800` /
  `TOKEN_SLOT 6000` / `BOTTOM_PAUSE 500` / `BOMB_POINTER 5200` / `FINAL_HOLD 1800`.
- `LADDER_SHUFFLE_MS`, `LADDER_MUTATION_MS` **삭제**.
- `ladderRevealDelay(N)` = COUNTDOWN + ERASE + DRAW + BOTTOM_PAUSE + BOMB_POINTER
  + **하강** + FINAL_HOLD. **하강 = (N ≤ 1 ? N : N-1) × TOKEN_SLOT** — 마지막 두 토큰이 한 슬롯을
  공유하므로 `9f82a1c`의 `N × TOKEN_SLOT`에서 바뀐다. **클라와 반드시 동일 유지.**

**상태 (`utils/room-helpers.js` ladder gameState)**
- 복원: `numLanes`(=5 고정), `userLanes: {}`, `losingLane`, `kkwangBottom`, `laneToBottom`,
  `revealOrder`, `participants`.
- 이름 교체: `losingLane` → `winLane`, `kkwangBottom` → `winBottom`, `loser` → `winners: []`
  (「꽝」이 아니라 「당첨」이므로 코드 어휘도 맞춘다).
- 제거: `numColumns`, `topLabels`, `bottomLabels`, `labelEditMode`, `labelLocks`,
  `mutationScript`, `landings`, `results`, `initialRungs`.
- 유지: `userRungs`, `baseRungs`, `colorIndex`, `rungSeq`, `rungs`, `erased`, `added`,
  `ladderHistory`, `round`, `revealStartAt`, `revealPayload`, `participantsAtStart`.

**핸들러**
- 복원: `ladder:pickLane { lane }` — **중복 허용으로 완화**(`9f82a1c`는 이미 점유된 레인을 거절했다).
  `ctx.checkRateLimit()` 필수(security-guard). 검증: `phase === 'idle'`, 방 소속, `lane` 정수 0..4.
- 복원: `ladder:addRung` / `ladder:removeRung` / `ladder:start` / `ladder:reset`.
- 제거: `ladder:setColumns`, `ladder:setLabel`, `ladder:labelFocus`, `ladder:labelBlur`,
  `ladder:labelTyping`, `ladder:setEditMode`, `ctx.releaseLadderLocksByUser`.
- `userLanes`는 배열 값이 아니라 `{ [userName]: laneIndex }` 그대로 — 중복은 여러 이름이 같은
  값을 갖는 것으로 표현된다.

**판정 (`doReveal`)** — D1 순서 그대로. `occupiedLanes`는 **유니크 레인 집합**임에 주의
(같은 레인을 3명이 골랐어도 후보에는 한 번만 들어간다 — 그래야 레인 균등이 된다).

**종료 (`endGame`)**
- `ladder:gameEnd`에 `{ winners, winLane, winBottom, userLanes }`.
- DB: `recordGamePlay('ladder', ...)` +
  `recordServerGame(serverId, name, `${lane+1}번`, 'ladder', winners.includes(name), sessionId, winners.includes(name) ? 1 : null)` +
  `recordGameSession({ gameRules: 'ladder-5lane', winnerName: winners.length === 1 ? winners[0] : null, ... })`.
- **재경기**: `winners.length >= 2`면 `gameState.readyUsers = winners.slice()` →
  `readyUsersUpdated` + 개인 `readyStateChanged`, `userLanes` 초기화,
  `gameState.scheduledStartAt = Date.now() + LADDER_REMATCH_AUTO_START_MS`,
  `scheduled.broadcastSchedule` + `scheduled.roomNotice`
  (`socket/horse.js:1358` 블록과 같은 구조). 나머지는 준비 해제 → 관전.

### `socket/rooms.js` / `socket/chat.js`
- `ctx.releaseLadderLocksByUser` 호출부 제거(leaveRoom / disconnect / 방장 이양 3경로).
- 입장 시 자동 레인 점유 훅(`9f82a1c`의 `rooms.js` 호출부) 복원.
- `getCurrentRoom`의 ladder 통째 마스킹 유지.

### `ladder-multiplayer.html`
- 제거: 줄 수 스테퍼(`#colDecBtn`/`#colIncBtn`), "칸 채우기 권한" 토글, `#topLabelsRow`/
  `#bottomLabelsRow`의 텍스트 입력.
- 추가/복원: **번호 고르기 섹션** — 경마 `#horseSelectionSection` / `#horseSelectionGrid` UX.
  1~5 버튼, 내가 고른 번호 강조, 번호별로 그걸 고른 사람 이름.
  **중복 허용이므로 남이 고른 번호를 비활성화하지 않는다**(경마와 다른 점 — 의도적).
- "🪜 내려가기" 토글: 하강 방식이 한 가지로 확정됐으므로 **제거**한다.
- 튜토리얼 문구 전면 교체 + 억제 버전 `'v2'`.
- SEO 문구(`<meta description>`, JSON-LD, 하단 소개문) 교체 — "위·아래 칸을 채우고"는 더 이상 사실이 아니다.
- `/js/ladder.js` 캐시버스터 **v4 → v5**.

### `js/ladder.js` — `9f82a1c` 버전을 기준으로 재작성
- 복원: 레인 번호 렌더, 번호 고르기 UI, 폭탄 룰렛 포인터 연출, 순차 하강, 중력 하강 곡선.
- 마지막 두 토큰 동시 하강 추가(v2에서 이식).
- 제거: 라벨 입력/락 UI, 줄 수 스테퍼, 카드 셔플 연출.
- 이식: 백그라운드 탭 seek/`jumpToFinal`(폭탄 포인터 단계 포함), 재진입 복구.
- 결과 화면: 당첨자 이름 + 당첨 번호. 중복이면 "N명 동시 당첨 — 30초 뒤 한 판 더".

### `css/ladder.css`
- 라벨 카드 스타일 → 번호 카드 + 폭탄 포인터 + 당첨 칸 강조. 번호 고르기 그리드(모바일 5열).

### 테스트
- `tests/test-ladder.js` 갱신 — 2탭: 방 생성/입장 → 준비 → 서로 다른 번호 → 막대기 배치 →
  시작 → 폭탄 포인터 → 순차 하강(마지막 둘 동시) → 당첨자 1명 → 콘솔 에러 없음.
- `AutoTest/` 서버 판정 단위 테스트:
  - **빈 레인은 절대 당첨되지 않는다** — 3명(2레인 빈 상태) 200회, 위반 0.
  - **레인 단위 균등** — 점유 레인 k개일 때 각 1/k에 수렴.
  - **중복 당첨 → 재경기 대상은 당첨자뿐** — `readyUsers`가 정확히 winners와 일치.
  - **막대기 구조는 당첨 확률과 무관** — 막대기를 극단적으로 몰아도 분포 불변.
  - **서버 `ladderRevealDelay` 합 = 클라 연출 합** (상수 동기 회귀).

## Out-of-scope (건드리지 말 것)
- **실서버 공개 게이트** — `socket/rooms.js:248` / `socket/free.js:82`의 `IS_LOCAL_DEV` 차단 유지.
  공개는 별도 요청.
- 상점/코스메틱, 주문받기 자동 시작, 채팅·준비·랭킹 팝업 등 셸 배선.
- 다른 게임(주사위/룰렛/경마/다리건너기)의 어떤 파일도.

## 공정성
- 당첨 레인 추첨·자동 배정·막대기 생성·하강 순서 전부 **서버 RNG**.
  클라 `Math.random`은 deviceId/tabId 외 0회.
- 공개 전 `winLane`/`winBottom`/`laneToBottom`은 server-only. ladder 통째 마스킹 유지.
- 확률은 **점유 레인 균등(1/k)**. 막대기를 아무리 몰아 그려도 바뀌지 않는다 — 테스트로 못 박는다.

## 완료 기준 (하나라도 미완이면 완료 아님)
- 레인이 항상 1~5로 고정 표시되고, 줄 수 스테퍼와 라벨 입력이 화면·코드 어디에도 없다.
- 입장하면 빈 레인이 자동 배정되고, 번호를 자유롭게 바꿀 수 있으며 **남이 고른 번호도 고를 수 있다**.
- 안 고른 채 시작되면 자동 배정되고 채팅으로 누가 배정됐는지 알려준다.
- 하강 전에 💀 폭탄 포인터가 바닥칸을 훑다가 「당첨」 칸에 정지한다.
- 토큰이 한 명씩 차례로 내려가고 **마지막 두 개는 같이** 내려간다.
- **아무도 고르지 않은 레인은 절대 당첨되지 않는다** (테스트 200회 위반 0).
- 당첨자가 2명 이상이면 그 사람들만 자동 준비되고 30초 뒤 다음 판이 자동 시작된다.
  한 명이 남을 때까지 반복된다.
- 사다리 랭킹 탭에 당첨 기록이 실제로 쌓인다.
- 튜토리얼이 새 룰을 설명하고 기존 사용자에게 다시 노출된다.
- 모바일·PC 양쪽에서 번호 고르기와 5레인 캔버스가 정상으로 보인다.
- 서버 `ladderRevealDelay` 합과 클라 연출 합이 일치한다(결과가 연출 도중 끼어들지 않는다).
- 콘솔 에러 0. 경마 등 기존 게임 1개 이상 미파손 확인.
- `node --check` 통과, 소켓 변경 후 dev 서버 재시작하고 테스트.

## 작업 방식
- 시작 전 `docs/GameGuide/lessons/_common.md` + `lessons/ladder.md` + `lessons/horse-race.md`를 읽는다.
- **복원 기준점 열람**: `git show 9f82a1c:socket/ladder.js`, `git show 9f82a1c:js/ladder.js`,
  `git show 9f82a1c:ladder-multiplayer.html`, `git show 9f82a1c:css/ladder.css`.
  (서버 912줄 / 클라 2069줄 — 현재 v2보다 작다.)
- 서버 프로토콜과 클라 payload가 짝을 이루므로 **한 커밋에 원자적으로** 교체한다.
- `socket/*` 변경 후 `node server.js` 재시작하고 테스트(자동 리로드 없음).
- 완료하면 이 파일 경로를 `.claude/.goal-applied-queue`에 append한다.
