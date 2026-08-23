# 사다리타기 실플레이 결함 4건 수리

작성: 2026-08-18 · 트리아지 COMPLEX · 근거: 2탭 실측 + Scout 코드 정찰

## 배경

사용자가 2탭 실플레이 후 4건을 신고. 소켓 프로토콜 회귀(`AutoTest/qa-ladder-pick-elimination-test.js`)는 23 PASS로 통과 — **캔버스 연출과 타이밍을 검증하지 않아 이 4건을 못 잡았다.**

실측으로 확인된 각 항목의 정체:

| 신고 | 실측 결과 | 처리 |
|---|---|---|
| ① 그린 선이 동기화 안 됨 | base·public은 양 탭 **완전 동일**. 차이는 숨김 막대기 설계(본인 전체 / 남은 1개) — desync 아님. 단 인지창→사라짐 경계에 **렌더 팝** 버그가 별도로 존재 | 규칙 유지, 렌더 팝만 수정 |
| ② 여러 명이 골라도 표시 부실 | 배지 17×17px·11px, 버튼이 `1`+`2명` → **"12명"으로 오독**. 이름 없음. 캔버스 `×N`이 토큰 원 위에 겹침. 카운트에 참가자 필터 없음 | 수정 |
| ③ 안 보이던 선이 막 생김 | 시작 시 남의 숨김 막대기 일괄 공개 + 스크램블 + 하강 중 변형 4회 | **규칙 유지** (사용자 결정). ①의 렌더 팝 제거로 체감 완화 |
| ④ 끝났는데 뭔가 더 함 | 같은 칸 공유 픽 → 다중 당첨 → 재대결. **재대결 자체는 유지**(경마 동점 자동준비와 동일 철학). 진짜 버그는 결과 오버레이 유실 + 백그라운드 탭 RAF 정지 | 수정 |

## 사용자 결정 (2026-08-18)

- **규칙 방향**: 지금 규칙 유지 + 개별 수리. 숨김 막대기·스크램블·하강 중 변형 **모두 존치**.
- **④ 꼴등 결정**: 경마처럼 승부 날 때까지 재대결 반복. **중복 칸 금지나 즉시 결정 도입하지 않음.**

## 범위 밖 (명시)

- 스크램블/변형 상수(`LADDER_SCRAMBLE_ERASE/ADD`, `LADDER_MIN_TOTAL_RUNGS`, 리빙 변형 횟수) 조정
- 재대결 규칙 변경
- 6칸 고정 → 인원수 레인 전환
- `js/shared/order-shared.js` 수정 (전 게임 영향 — 사다리 쪽에서 회피)

## 작업

### A. ④ 결과 표시·타이밍 버그 (최우선 — 나머지의 전제)

**A1. `visibilitychange` catch-up 추가** — `js/ladder.js`
리빌 연출 전체가 RAF 체인인데 브라우저는 백그라운드 탭에서 RAF를 정지시킨다. 서버 `ld.endTimeout`은 그대로 발화 → 탭 복귀 시 이미 끝난 게임의 하강 애니가 그 지점부터 재개된다. `js/horse-race.js:3320-3331`의 catch-up/reconcile 패턴을 **읽고 참고**하되 경마 파일은 수정하지 않는다.

**A2. `ladder:gameEnd` 수신 시 뒤처진 애니 따라잡기** — `js/ladder.js:1978`
현재 payload만 저장하고 애니를 앞당기지 않는다. 서버가 이미 종료를 알렸는데 로컬 연출이 진행 중이면 최종 프레임으로 점프한 뒤 결과를 표시한다.
**필수**: 점프하더라도 `landings`대로 **최종 프레임을 반드시 렌더**한다(`finishLiving(paths, tokenProgress)`를 progress=1로). 화면이 결과를 설명하지 못하면 2026-07-02 신뢰 결함이 되살아난다.

**A3. 결과 오버레이 유실 차단** — `js/ladder.js:1826`, `:2011`
`finishLiving`의 `popupTimer`(1200ms 뒤 결과 표시)가 `ladderRevealTimers`에 들어가는데, 같은 틱에 도착한 `ladder:tournamentRound`의 `clearLadderRevealTimers()`가 이를 죽인다 → **재대결 사유를 설명하는 결과 오버레이를 아무도 못 본다.** 사용자가 "끝났는데 뭔가 더 한다"고 느낀 직접 원인.
→ 결과 표시 타이머를 연출 타이머 배열과 **분리**하거나, `tournamentRound`에서 결과 오버레이를 먼저 보장 표시한 뒤 빌드로 전환한다.

### B. ① 인지창 렌더 팝 제거 — `js/ladder.js:1547`

인지창은 `ladderDrawFrame([], [])`로 `initialRungs`(= remaining + added, erased 없음)를 그린다. 이어지는 "사라짐" 단계는 remaining + erased를 그리고 added는 `drawProgress=0`이라 사라진다.
→ 인지창→사라짐 경계에서 **added가 통째로 증발하고 erased가 부활하는 팝**이 발생. 캡션("모두가 그린 사다리를 확인하세요")과도 모순.
→ 인지창이 **스크램블 전 union**(remaining + erased)을 그리게 한다.
**타이밍 상수는 건드리지 않는다** — `LADDER_RECOGNITION_MS`는 2000 그대로. `ladderRun.rungs`/`rungPolylines`도 `initialRungs`로 유지(하강 path와 mutation replay가 의존).

### C. ② 픽 표시 개선

**C1. 카운트 참가자 필터** — `js/ladder.js:849-856`
`ladderTopPickCounts`가 `ladderUserTops`의 모든 키를 센다. 준비 해제한 사람의 픽도 잡힌다. `ladderRoundParticipants()`(`js/ladder.js:1144-1149`)로 필터.

**C2. 레인 버튼 배지 개선** — `js/ladder.js:880-885`
- "12명" 오독 해소 (번호와 카운트가 붙어 읽히지 않게)
- 누가 골랐는지 **이름 표시** — `ladderUserTops` 역인덱스. 인원이 많으면 축약.
- 내 픽과 남의 픽 시각 구분

**C3. 캔버스 `×N` 겹침 해소** — `js/ladder.js:841-844`
`×N`(흰색 11px)을 반지름 8px 토큰 원과 **동일 좌표**에 그린다. 스킨 이모지 장착 시 그 위를 덮는다. 오프셋을 주거나 레인 버튼 배지로 일원화.

**C4. 배지 스타일** — `css/ladder.css:183-187`, 모바일 미디어쿼리 `:206-216`
`.ladder-lane-count`에 명시 색/대비 부여. 모바일(≤480px)에서 버튼 44px·번호 17px인데 배지 규칙이 없어 눌린다.

### D. 부수 — `socket/ladder.js:349` points 앨리어싱

union 항목이 원본 `rg.points`를 참조 공유하고, `resolveContacts`(`:225-226`)가 이를 in-place 변형해 `ld.userRungs[owner][k].points`가 실제로 바뀐다("내가 그린 선이 달라졌다"의 한 축).
→ `points: rg.points ? rg.points.map(p => ({ x: p.x, y: p.y })) : null` 로 깊은 복사.

## 불변조건 (깨면 안 됨)

1. **`ladderRevealDelay(N)` byte-identical** — `socket/ladder.js:61-68` == `js/ladder.js:525-533`. 8개 단계 상수 쌍 `WINSLOT_SHUFFLE 1600 / RECOGNITION 2000 / ERASE 1600 / DRAW 1200 / COUNTDOWN 1600 / TOKEN_SLOT 3000 / MUTATION 900 / FINAL_HOLD 1200`. **이번 작업에서 타이밍 상수는 변경하지 않는다.**
2. **`N`은 칸 수(6)이지 토큰 수가 아니다.** `descentSlots = N-1`, `mutations = N-2`를 픽 인원수로 바꾸면 lockstep 붕괴.
3. **`forceRouteToWin`(balance add) 절대 제거 금지** — 꼴등 0명 방지의 단독 책임. 겹침 dedup 하드룰도 유지.
4. **`landings` 전단사** — 후보 채택의 `isBijection` 검사 유지. 발표 loser는 변형 후 `landings` 단일 소스에서만.
5. **클라 `Math.random()` 0회** — `getDeviceId`(`js/ladder.js:30`)만 허용.
6. **숨김 막대기 가시성 계약**(본인 전체 / 남은 public 1개) 유지 — 게임 정체성.
7. **레인 버튼 클릭 계약** — `onLanePick`이 `e.currentTarget.dataset.top`에 의존. 배지를 별도 클릭 타겟으로 만들지 말 것.
8. **터치 타겟 ≥44px**, 캔버스 `aspect-ratio 720/560` + `max-height 72vh`.
9. **이름 노출은 `textContent`만** — `innerHTML` 금지 (XSS).
10. **`document.body.classList.remove('race-running')`이 모든 종료/전환 경로에** (C-6, 스티키 광고 영구 숨김 방지). 새 전환 경로를 만들면 여기도 추가.
11. **`closeResultOverlay()` 호출 수 == 전환 경로 수** (2026-06-17 소프트락 lesson).
12. **소켓 이벤트 이름 13개 불변.** payload 모양 변경 시 서버·클라 한 커밋.
13. `emitRungsUpdated`의 `phase !== 'idle'` 조기 return = server-only 누출 단일 방어선.

## 검증

- `node -c js/ladder.js socket/ladder.js`
- `ladderRevealDelay` 양쪽 수치 대조 (변경 없음 확인)
- `grep -n "Math.random" js/ladder.js` → `getDeviceId`만
- 2탭 실플레이: 같은 칸 공유 픽 → 재대결 진입 시 **결과 오버레이가 실제로 보이는지**
- 한 탭을 백그라운드로 두고 라운드 진행 → 복귀 시 이미 끝난 애니가 계속 돌지 않는지
- 인지창→사라짐 경계에서 막대기 팝 없는지
- 모바일 375px 폭에서 배지 판독 + "12명" 오독 해소 확인
- `AutoTest/qa-ladder-pick-elimination-test.js` 23 PASS 유지

## 알려진 별건 (이번 범위 밖, 기록만)

- **모바일 튜토리얼 스크롤 잔존** — 튜토리얼 마지막 단계가 `.container`를 866px 내린 뒤 복원하지 않아 칸 고르기 버튼이 화면 밖으로 사라진다. 별도 작업.
- **미픽 칸의 빈 하강** — 2인전이면 6칸 중 4칸이 캡션만 뜬 채 15.6초 정지. 슬롯 수를 줄이면 lockstep이 깨지므로 캡션/시각 처리로만 접근 가능.
- **`orderStarted`의 `gameStatus` 덮어쓰기** — `js/shared/order-shared.js:69-72`가 사다리 상태 문구와 같은 엘리먼트를 비결정적으로 덮는다. 전 게임 공통이라 공유 모듈 수정은 별도 판단 필요.
