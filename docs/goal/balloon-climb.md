# 풍선 타기 (balloon-climb) — 기획서 · Goal

데구리 동물이 풍선을 불어 하늘로 올라가는 **보기만 하는** 새 게임을 LAMDice 에 추가한다. 결과는 서버가 시드로
타임라인을 통째로 계산하고 클라이언트는 재생만 한다(데구리와 같은 계약). 작업 브랜치는 `feature/balloon-climb`
(새로 판다), 테스트 서버에서 `DEV_GAMES=1` 로만 열고 실서버는 잠근다(1차 출시 범위 §9 참고).

> 전제/baseline: `mockups/balloon-climb.html`(2026-10-18, 미커밋 — 규칙·수치의 원본) + 데구리 현행
> (`socket/deguri.js`, `socket/deguri-sim.js`, `js/deguri-render.js`, `js/deguri.js`, `deguri-multiplayer.html`).
> 이 문서는 **기획서**다 — 코드·목업은 고치지 않았다. "추측" 표시가 붙은 항목은 코드로 확인하지 못한 것이다.
> 목업은 사용자가 동시에 고치는 중이라 "목업 반영 예정" 항목(§3-4, §2-5)은 아직 목업에 없다.

## 한 줄 요약

① 3·2·1 동안 다 같이 풍선을 불고 0 에 떠오른다 → 장애물에 터지면 낙하산으로 떨어져 발판에서 다시 분다 → 도착 순서로
1등/꼴등 당첨(기본 꼴등). ② 맵은 데구리처럼 구간 덱을 판마다 섞어 쌓고 좌우를 뒤집는다(방향만 위로). ③ 서버 시드
타임라인 + 클라 재생, 데구리의 방 흐름·투표·결과·하이라이트·다시 보기 GIF·스킨 지갑을 재사용한다.

## 1. 핵심 재미, 데구리·경마와 다른 점

- **핵심 재미**: 내 동물이 터질 듯 말 듯 올라가는 조마조마함 + 터져서 떨어지다가 발판에 걸려 "살았다"는 안도. 꼴등 룰이
  기본이라 **많이 터져도 끝까지 가면 된다** — 역전이 잦다(많이 터진 동물은 조금 빨리 오른다, 목업 `R.popBoost`).
- 데구리와 다른 점: 데구리는 **중력에 맡겨 굴러 내려가는** 몸싸움·확률 장치 중심이고, 풍선 타기는 **위로 떠오르는 동안
  장애물을 피하는가**가 전부다. 공-공 충돌이 없어 결과가 "누가 어디서 터졌나"로만 갈리고, 터짐 → 낙하 → 발판 → 재출발
  루프가 한 동물 안에서 여러 번 반복된다(데구리는 한 번 떨어지면 끝).
- 경마와 다른 점: 경마는 레인 고정·속도 랜덤이고, 풍선 타기는 레인이 없고(통로 안 자기 몫의 자리만) 장애물 접촉이 결과다.
- 같은 점: 보기만 함, 서버 결정, 당첨 = 벌칙, 투표로 1등/꼴등 룰 고름(데구리 `decideTarget`, `socket/deguri.js:318-338`).

## 2. 규칙 전체

목업 상수(`mockups/balloon-climb.html:86-96`, `R`·`Z`)를 기준으로 쓴다. 전부 §9-3 상수 표로 옮긴다.

### 2-1. 시작
- 참가자 = 준비한 사람(데구리와 같은 기준, `socket/deguri.js:471-472`). 동물은 고른 것, 안 골랐으면 자동 배정
  (`assignCreature`, `socket/deguri.js:66`). 사람당 **한 마리**(데구리 crowd 프리셋 없음 — §10 Q4 결정).
- 출발: 땅(y=0) 위에 참가자 수로 등분한 x 에 선다(목업 `setup` `x: (i+0.5)/n * WORLD_W`). 데구리의 자리 고르기
  (`deguri:moveTo`)는 1차엔 없음.
- 카운트다운: 3·2·1 동안 전원이 풍선을 분다(목업 `beginCount`, `R.countdown` 3). 풍선은 손에서 줄 끝으로 올라가며 커진다.
  0 이 되면 동시에 `rise` 로 바뀐다(`startRace`). 카운트다운은 **데구리와 같은 4초**(`js/deguri.js:8`, `socket/deguri.js:17`,
  공용 countdown-shared 그대로)이고, 풍선은 **마지막 3초 동안** 분다(§10 Q6 결정 — 목업은 3초 전체를 불기로 씀).

### 2-2. 오르기
- 상승 속도 = `base(128~150/s, 마리별 시드) × (1 + 0.22·sin 흔들림) × 따라잡기(선두와의 차이 비례, catchUp 0.9) ×
  돌풍 중 0.55 × 상승 기류 안 1.9 × (1 + min(0.35, 터진 횟수×0.07))` (목업 `updatePlayer` `case 'rise'`).
- 가로: 통로 폭 안에서 **제 몫의 자리**(`frac`)로 돌아가려는 힘 + 좌우 방황(wanderAmp 34) + 바람(돌풍·선풍기). 벽 패딩 16.
- 좁아지는 통로의 벽 판정은 **풍선 높이**(`p.y + BAL_OFF(76)`) 기준(목업 274행 주석).
- 돌풍: 5~8초마다 1.5초, 방향 시드 랜덤, 전원에 같은 힘(gustPush 80). 토스트 "돌풍 →".
- 독수리: 8초 뒤 첫 출격, 이후 7~10초 간격. 후보 = 떠 있는 동물 중 높이 12%~꼭대기 150 아래, **벽 있는 구간은 못
  들어온다**. 높은 동물일수록 더 노린다(높이 가중). 0.9초 경고(`!`) → 1.1초 비행, 맞출 확률 0.4, 빗나가면 "휙~ 놓쳤다"
  (목업 `updateEagle`).
- 무적: 다시 뜬 직후 1.2초 반짝이며 아무것에도 안 터진다(`R.safeDur`).

### 2-3. 터짐
- 풍선(반지름 15)이 닿으면 터진다: 밤송이(1회용, 터뜨린 뒤 떨어져 사라짐 — 목업 346행), 구간 장애물(풍차 날/허브, 가시공,
  번개 내리침, 벌 떼), 가시벽(바람 골목 통로 안쪽, 입출구 깔때기 120 제외), 독수리.
- 터지면 옆으로 튕긴다(kickV 110, 1.3/s 감쇠 — 같은 가시에 또 찔리는 반복 방지). 0.25초 멈춤(`pop`) → 0.3초 자유낙하
  (`drop`, g 900) → 낙하산(`chute`, 종단 300/s, 좌우 흔들림 26).
- 화면: 터진 자리에 `impact-star` + "펑!" 글자 + 색 조각(목업 `drawFx`), 카메라 살짝 흔들림.

### 2-4. 낙하·착지·다시 달기
- 떨어지는 동안 **바로 밑**(가로로 발판 폭 안)에 발판이 있으면 그 위에 선다(`land` 0.3초, 먼지 fx). 없으면 땅(y=0)까지.
- 착지하면 통로 안에서 제 자리 비율(`frac`)을 다시 잡는다(0.1~0.9 클램프).
- 다시 달기: 1.0~2.0초(시드) 동안 분 뒤 `rise`. 다시 뜬 1.2초 무적.
- 발판 바로 위 130 안의 밤송이는 맵 생성 때 뺀다(`R.spikeClear`, 목업 195행) — 뜨자마자 또 터지는 반복 방지.

### 2-5. 발판(목업 반영 예정 포함)
- **여닫이 판**: 밑에서 오르는 동물이 지나가는 동안 위로 열리고(1.25rad, 0.3초 유지), 위에서 내려오면 닫힌 판에 선다.
  가운데가 갈라진 두 쪽, 양 끝 경첩, 밑면에 ▲ 표시(목업 `drawWorld`).
- **단단한 발판**(목업 반영 예정): 안 열린다. 밑에서 오면 풍선이 밑면에 부딪혀 **옆으로 비켜 간다**(터지지 않음). 위에서
  내려오면 똑같이 선다. 비율·배치는 목업이 정한 값을 그대로(추측: 구간당 1~2개, 가운데 발판에 두면 비켜 가는 모습이 잘 보임).
- 발판은 **왼벽·가운데·오른벽에 고르게** 둔다(튜닝 교훈).

### 2-6. 도착·판정
- 도착 = 발 높이가 `WORLD_H`(= 시작 마당 240 + 구간 합 + 도착 마당 280)를 넘는 순간. 도착 구름 띠 + 빨간 점선 + "도착".
- **1등 찾기**: 첫 도착이 당첨, 그 순간 끝(목업 `finish` `rule === 'first'`). 나머지는 결과 순위만(높이 순).
- **꼴등 찾기(기본)**: N-1 명이 도착하면 남은 한 명이 당첨. 당첨 확정 순간 0.25초 정지 → 0.35배속 1.6초 → 결과.
- 결승 슬로모: 누가 꼭대기 220 안에 들어오고 (1등 룰이거나 남은 동물이 2명)이면 0.5배속(`inFinal`).
- **동시 도착**: 같은 스텝(서버 `SIM_DT`)에 둘이 넘으면 **공 id 순**(참가자 입장 순)으로 finishOrder 에 넣는다. 재경기는
  없다(§10 Q7 결정). 데구리도 같은 스텝 안 처리 순서로 갈린다(`finishBall`, `socket/deguri-sim.js:913-918`). 꼴등 룰에서
  마지막 둘이 같은 스텝에 들어오면 id 가 큰 쪽이 꼴등.
- **시간 상한**: 목업 `R.maxSec` 240 — 넘으면 1등 룰은 가장 높은 동물, 꼴등 룰은 가장 낮은 동물이 당첨. 데구리 하드 캡은
  120초(`SIM_CAP_MS`, `socket/deguri-sim.js:9`). 풍선 타기 **서버 캡은 150초**(§10 Q5 결정 — 꼴등 중앙값 ~58초의 2.5배).
- 순위표: 도착 순 → 미도착은 높이 순(목업 `showResult`). 결과 카드에 "펑 N번"을 같이 보여 준다.

### 2-7. 한 판 길이(기준)
- 데구리 실측(30시드): 꼴등 54~61초, 1등 42~48초. 목업: 꼴등 54~56초, 1등 38~44초(`__balloonMeasure`).
- 목표: 서버 시뮬도 같은 범위. 스윕 테스트(§4-5)가 ±15% 를 지킨다.

## 3. 맵

### 3-1. 좌표·마당
- 세계 폭 `WORLD_W` 360(화면과 무관, 서버가 같은 값으로 계산), y 는 발 높이(위로 갈수록 큼). 몸 44, 풍선 오프셋 76.
- 시작 마당 240(땅 + 출발 자리), 도착 마당 280(구름 띠). 구간은 그 사이에 쌓는다(목업 `buildMap`).

### 3-2. 구간 9종 (목업 `SECTIONS`, 143-173행)

| 구간 | 높이 | 장애물 | 발판 | 벽 | 위험도 | 비고 |
|---|---|---|---|---|---|---|
| 밤송이 숲 chestnut | 700 | 고정 밤송이 11개(±15/±20 흔들림), 1회용 | 4 | 없음 | 중 | 터뜨린 밤송이는 떨어진다 |
| 지그재그 굴 zigzag | 900 | 통로 가시 3 | 4 | 통로(반폭 85, 꺾임 5점) | 중 | 벽 판정은 풍선 높이 |
| 풍차 windmill | 720 | 날개 4 × 길이 100, 주기 6초 | 5 | 없음 | 중상 | 허브에 닿아도 펑 |
| 흔들 가시공 pendulum | 760 | 진자 2(길이 150, 진폭 0.8rad, 주기 2.8) | 4 | 없음 | 중상 | 위상 반대 |
| 먹구름 번개 storm | 760 | 번개 3(주기 3.6, 경고 0.7, 내리침 0.25, 폭 70·길이 280) | 4 | 없음 | 상 | 경고 때 내리칠 자리 미리 보임 |
| 바람 골목 fans | 720 | 가시벽 + 선풍기 3(주기 3, 켜짐 1.4, 밀기 150, 띠 120) | 4 | 통로 62~298 + 가시 | 상 | 벽에 밀리면 펑 |
| 벌집 bees | 660 | 벌 떼 1(주기 3.4, 1.6초, 호 280×240) + 가시 1 | 3 | 없음 | 중 | |
| 셔터 shutter | 540 | 반쪽 문(주기 3, 열린 쪽으로 몰림) | 3 | 없음 | 하 | 지연만, 안 터짐 |
| 상승 기류 updraft | 640 | 기류 띠(폭 70, 1.9배) + 가시 2 | 3 | 없음 | 하 | 추월 요소 |

### 3-3. 덱·반전·높이 예산 (데구리 방식)
- **덱**: 방마다 9종을 섞은 한 벌을 다 쓸 때까지 이어 쓴다(데구리 `drawOrder`, `socket/deguri-sim.js:642-665`; 방 상태
  `trackDeck`·`trackOrder`, `socket/deguri.js:412-419`). 판마다 새로 섞으면 몇 판 표본에서 몰린다(lessons/deguri.md 2026-10-01).
- **높이 예산**: 목업은 "합 ≥ 3500 이 될 때까지"(`R.middleMin`). 데구리처럼 **MIN·MAX 두 값**(추천 3500·4400)으로 — MAX 를
  넘는 구간은 건너뛰고 덱 뒤로. 보통 5~6구간.
- **최소 보장**: 데구리 `GIMMICK_MIN` 2 처럼 **움직이는 장애물 구간(풍차·가시공·번개·바람 골목·벌집) 최소 2개** — 밤송이·
  셔터·기류만 나오면 밋밋하다(추측, 데구리 2026-09-24 피드백과 같은 이유).
- **좌우 반전**: 구간마다 0.5 로 `x → WORLD_W − x`, 통로 bounds·선풍기 방향·셔터 쪽도 뒤집는다(목업 `buildMap` `m`).
- **대기 화면 = 경주 맵**: 데구리 계약 그대로(`ensureTrackSeed`, 대기 미니맵). 리셋 때 시드 0 으로.

### 3-4. 더하거나 빼거나 다듬을 것(제안)
- **다듬기 — 셔터**: 위험도 0 이라 "장애물" 느낌이 없다. 닫힌 문 밑에서 기다리는 동안만이라도 **밤송이 1개**를 문 옆에 두거나,
  덱 가중치를 낮추기보다 2차에 "문이 닫히는 순간 끼이면 펑"을 넣는다(추천: 1차 그대로, 2차 검토).
- **다듬기 — 바람 골목·먹구름**: 둘 다 위험도 상. 덱에서 **연달아 나오지 않게** 데구리처럼 "방금 나온 모듈은 새 벌의 뒤로"
  규칙을 쓴다(이미 `drawOrder` 에 있음). 두 구간이 같은 판에 둘 다 나오면 꼴등 룰 길이가 늘어난다(목업 worst 시드 확인 필요).
- **더하기 후보(2차)**: ① **구름 발판** 구간 — 밟으면 1.5초 뒤 흩어지는 발판(단단·여닫이에 이어 세 번째 발판 종류, 그림은
  기존 구름 도형). ② **새 떼** — 벌 떼와 같은 식이지만 화면 가로를 가로지른다(독수리 그림 축소 재사용 가능). ③ **단단한
  발판 밭** — 단단한 발판만 촘촘히 있어 비켜 가기 연속(목업 반영 예정 기능의 전시 구간).
- **빼기**: 없음. 9종 전부 1차.

## 4. 서버 결정 구조 (데구리 `deguri-sim` 계약 복제)

### 4-1. 책임 나누기
- `socket/balloon-sim.js`: 순수 함수. `buildMap(rng, opts)`, `simulate(players, seed, map, { target })` →
  `{ map, sampleMs, frames, events, finishOrder, simEndMs, slow, durationMs }`. 데구리 `simulate` 반환 모양과 같은 이름
  (`socket/deguri-sim.js:795-803`). PRNG 는 데구리 `mulberry32`(`socket/deguri-sim.js:225-232`) — 목업도 같은 함수.
- `socket/balloon.js`: 방 흐름. 시드는 `Math.floor(Math.random() * 2147483647)` (데구리 `socket/deguri.js:483`, 서버 RNG 허용),
  reveal 페이로드를 `mb.timeline` 에 server-only 로 들고(`socket/deguri.js:539`), 종료 타이머 = `COUNTDOWN + durationMs +
  RESULT_HOLD`(`socket/deguri.js:554-557`).
- 클라 `js/balloon-render.js`: `(타임라인, t) → 화면` 순수 렌더러. **물리 없음**, `Math.random` 0회. 장애물 위치는 **t 만의
  함수**(목업 `bladeAng`·`pendBall`·`boltState`·`fanOn`·`swarmAt`·`shutOpen`)라 서버와 같은 식을 클라가 다시 계산해 그린다
  — 데구리도 주기 장치를 같은 식으로 양쪽에서 계산한다(`deviceOn`, `socket/deguri-sim.js:791`). 엔진 간 `Math.sin` 마지막
  비트 차이는 그림만 움직이고 결과는 프레임에 이미 구워져 있어 영향 없다.

### 4-2. 시뮬 스텝·샘플
- 내부 스텝: 목업은 1/60초. 서버는 **`SIM_DT_MS` 10**(초당 100) 추천 — 풍선 상승 ≤ 150/s, 낙하 ≤ 300/s 라 스텝당 3px 로
  터널링 없음(데구리는 5ms, `socket/deguri-sim.js:8`). 샘플 40ms(`SAMPLE_MS_FEW`)로 프레임 기록. 사람당 1마리 ≤ 8명이라
  100ms 샘플 분기는 필요 없다.
- 캡: `SIM_CAP_MS` 150000(§10 Q5 결정). 캡에 걸리면 목업 366행 규칙으로 정산하고 `events` 에 `{ type:'cap' }`.

### 4-3. 프레임·이벤트 형식(제안)
- `frames[k]` = `[x0, y0, lean0, x1, y1, lean1, …]` 정수. `lean` = 바람 기울기(`p.wind` 를 −100~100 으로)·낙하산 흔들림을
  한 값으로 — 클라가 물리 없이 몸 기울기를 그린다. 도착한 동물은 `-1,-1,0`(데구리 `record`, `socket/deguri-sim.js:1024-1033`).
- `events` = `[{ t, type, ball?, … }]` (데구리 `pushEvent`, `socket/deguri-sim.js:899-904`). 종류:
  `inflate {ball, dur}` · `rise {ball}` · `pop {ball, cause:'spike'|'blade'|'pend'|'bolt'|'bee'|'thorn'|'eagle', spike?, x, y, dir}` ·
  `drop {ball}` · `chute {ball}` · `land {ball, plat|'ground'}` · `finish {ball}` · `gust {dir, dur}` ·
  `eagleWarn {ball, dir, y}` · `eagleFly {ball, hit}` · `eagleMiss {ball}` · `cap` · `decided {ball}`(당첨 확정 순간).
  클라 상태기계는 이벤트로만 바뀐다(풍선 크기 = `inflate` 뒤 경과/`dur`, 낙하산 = `chute`~`land`, 무적 반짝임 = `rise` 뒤 1.2초).
- 발판 열림·밤송이 떨어짐·먼지 같은 **순수 연출은 클라가 프레임·이벤트에서 파생**(데구리 flap/dust 와 같음).
- `slow` = `[{ startMs, rate, endMs }]` **배열** — 결승 슬로모(0.5) + 판정 순간(0 → 0.35). 데구리는 `slow` 하나·`fast` 하나
  (`socket/deguri-sim.js:1515,1537`)라 하이라이트 `segments()`(`socket/deguri-highlight.js:36-`)가 둘만 읽는다 — 재사용하려면
  배열을 받게 **그 함수만** 넓힌다(§5-3). `fast`·`cutMs` 는 `null` 고정.
- `map` = `{ worldH, sections:[{ name, y0, y1, mirror, bounds?:{pts}, thorn }], plats:[{x,y,w,hard}], spikes:[{x,y}],
  hazards:[{type,x,y,s,phase,w?,h?}] }` — 목업 `buildMap` 결과를 그대로 직렬화. 클라는 이것만 보고 그린다.

### 4-4. 2탭 동기·재접속
- 동기: 두 탭 다 `balloon:reveal` 받는 순간 + 카운트다운 뒤 재생 시작, `durationMs` 고정 → 데구리와 같은 수준(지연 차만).
  서버 `endTimeout` 이 결과를 보내므로 느린 탭도 같은 순간에 결과 카드를 본다.
- 재접속(새로고침): 데구리는 `mb.timeline` 이 server-only 라 재입장자는 `phase:'playing'` 만 받고 캔버스엔 출발대 프리뷰를
  본다(`publicState`, `socket/deguri.js:647-653`; `getCurrentRoom` 마스킹 `socket/rooms.js:172-175`). 1차는 **같은 동작**.
  2차 후보: `balloon:requestState` 가 `playing` 이면 `revealedAt` 기준 경과 시각과 함께 타임라인을 다시 줘서 중간 합류
  (타임라인은 이미 공개된 정보라 공정성 문제 없음 — reveal 뒤만).
- 종료 뒤 결과·다시 보기: 데구리처럼 `reveal` 을 클라가 들고 있어 `replay` 가 된다(`js/deguri.js` `stopReplay`/`deguriReplayButton`).

### 4-5. 결정성·길이 테스트
- `AutoTest/balloon-determinism-test.js`: 같은 시드 두 번 → `frames`·`events` 바이트 동일; 시드 1 고정 맵 JSON 을 기준선으로
  저장(데구리 `deguri-track-a.canonical.json` 방식); `target:'last'` 와 `opts` 없음이 같음.
- `AutoTest/balloon-sweep.js`: 30시드 × 인원 {2,4,8} × 룰 {first,last} → 캡 0건, 중앙값 꼴등 54~61·1등 42~48 ±15%,
  인당 터짐 수 중앙값(목업 `popsPerPlayer`)·원인별 분포(`why`) 출력, 한 동물이 같은 장애물에 3번 연속 터지는 판 0건(무한 반복
  감시). 목업 `__balloonMeasure` 와 같은 지표라 목업 수치와 바로 비교된다.
- 클라 `Math.random` grep 0회(deviceId/tabId 외).

## 5. 소켓 이벤트·방 흐름

### 5-1. 데구리에서 그대로 쓰는 것
| 흐름 | 데구리 근거 | 풍선 타기 |
|---|---|---|
| 준비·채팅·주문·랭킹·튜토리얼 공용 모듈 | `deguri-multiplayer.html:532-544` 스크립트 순서 | 같은 순서, `js/balloon.js` 만 교체 |
| 당첨 순위 투표 → 룰렛/사유 카드 → reveal | `deguri:voteRank`(`socket/deguri.js:964-979`), `decideTarget`, `rouletteStart`/`reasonHold`(500-503) | 이름만 `balloon:` — 기본 꼴등 그대로 |
| 시작 검문·자동 배정·예약 시작 | `canStartDeguri`(351-363), `module.exports.canStart/start` | 같은 export 계약(`socket/scheduled-start.js` 가 부름 — 추측: 게임별 분기 추가 필요) |
| 결과·승계·DB 기록·다음 판 준비 | `endGame`(563-615), `resetRound`(618-622) | 그대로, gameType `balloon` |
| 재진입 마스킹·퇴장 정리 | `socket/rooms.js:172-175, 1274-1290`, `socket/chat.js:652-659` | `balloon` 블록을 짝으로 추가(C-19·C-20) |
| 하이라이트 GIF | `pickHighlight`(431-457), `deguri:highlight`, `js/deguri-highlight.js` | §5-3 |
| 다시 보기·GIF 녹화 | `js/deguri-replay-gif.js`(재생 제어 `{time,duration,seekTo,pause,resume}` 계약) | 렌더러가 같은 제어 API 를 내면 그대로 |
| 수동 카메라 | `docs/goal/applied/deguri-manual-camera.md` | 목업 카메라 규칙(§7-3)으로 대체 |

### 5-2. 새로 만드는 이벤트 (`balloon:` 접두)
`balloon:pick` · `balloon:voteRank` · `balloon:start {force?}` · `balloon:reset` · `balloon:requestState` →
`balloon:stateUpdated {phase, picks, votes, minPlayers, preview:{map, players, frame}, myEquip}` · `balloon:rouletteStart` ·
`balloon:reasonHold` · `balloon:reveal {durationMs, sampleMs, map, players:[{id, owner, creature, colorIdx, skin?, balloon?}],
frames, events, finishOrder, slow, target, everPlayedUsers, result}` · `balloon:highlight` · `balloon:gameEnd` ·
`balloon:gameAborted` · `balloon:roundReset` · `balloon:error`. 방장 설정은 **없음**(crowd·맵 고정/랜덤 버튼 안 둠, 맵은 늘 랜덤 — §10 Q4 결정).
모든 핸들러 첫 줄 `ctx.checkRateLimit()`(security-guard 훅, `socket/deguri.js:642` 주석대로 리터럴 호출).

### 5-3. 하이라이트 재사용 범위
- 서버 `socket/deguri-highlight.js` 는 입력을 "reveal 페이로드 모양 `{frames, events, finishOrder, balls, track, …}`" 으로 읽고
  사건 종류(`eagleGrab`·`scuffle`·`trip`…)가 데구리 전용이다(`WEIGHTS`·`CAUSES`). 풍선 타기용은 **사건 표만 바꾼 얇은 모듈**
  (`socket/balloon-highlight.js`: `pop`·`eagleFly`·`land`·순위 바뀜·결승 접전)을 만들고 `segments`·`selectScenes` 같은 순수
  부분은 `require` 로 공유한다. 1차 포함 여부는 **구현자가 분리 비용을 재서** 반나절 안이면 넣고, 넘거나 데구리 회귀를
  부르면 2차로 미룬다(§10 Q9 결정 — 어느 쪽으로 했는지 보고에 적는다).
- 클라 `js/deguri-highlight.js` 는 `DeguriRender.create(canvas, {dpr})`·`R.frameBalls(ids)`(`js/deguri-render.js:389, 501`)에
  묶여 있다. 풍선 렌더러가 같은 두 API 를 내면 GIF 인코더(`js/deguri-replay-gif.js` `encoder`)와 결과 카드 UI 는 그대로 쓴다.

## 6. 에셋

### 6-1. 데구리에서 그대로 쓰는 것(실제 파일)
- 동물: `assets/deguri/creatures/{creature}.webp`(서기 idle 4칸 160셀, row 0 — `assets/deguri/deguri.manifest.json`),
  `{creature}-{skin}.webp` 스킨 시트 70종, `-walk`·`-sleep`·`-scuffle` 시트(도착 환호·착지 쿵에 재활용). 목업은
  `mockups/assets/mb-{creature}-idle.webp` 6종을 쓰는데 실제 게임은 `assets/deguri/creatures/` 를 직접 읽는다.
- 장애물·소품: `assets/deguri/pieces/eagle.webp`(목업도 사용, 256셀·4칸), `fan.webp`(선풍기), `windmill-rotor.webp`·
  `windmill-pole.webp`(풍차 — 날개 길이 100 에 맞춰 배율), `beehive.webp`(벌집), `pendulum-pivot.webp`(진자 축),
  `last-gate.webp`(셔터 문 — 추측: 모양이 맞는지 확인), `flag.webp`(도착).
- 효과: `assets/deguri/fx/impact-star.webp`(펑, 목업 사용), `bee-swarm.webp`, `gust-band.webp`·`wind.webp`(돌풍·선풍기 바람),
  `dust-puff.webp`(착지), `eagle-shadow.webp`, `cheer.webp`(도착), `dizzy-swirl.webp`(땅까지 떨어진 뒤), `quake-warn.webp`
  (번개 경고 `!` 대용 — 추측).
- 배경: `assets/deguri/stage/sky-far.webp`(하늘 — 높이에 따라 색을 어둡게 덮는다, 목업 `skyColor`), `meadow-tile.webp`(땅),
  `decor-*.webp`(시작 마당 장식).
- 풍선 장식: `assets/deguri/accessories/balloon-*.webp` 8종(야식 풍선) — 데구리 `deguri_balloon` 슬롯. 장착했으면 **그 그림이
  타는 풍선**이 되고, 안 했으면 색 풍선(§10 Q3 결정). 풍선 그림 크기·줄 매다는 점은 구현 때 그림에서 잰다.

### 6-2. 새로 그릴 것 (SpriteMake)
1차는 **서기 시트 + 코드로 그린 팔·줄**(목업 `drawPlayer`)로 가고, 아래는 2차 의뢰다(사용자 2026-10-18 계획).
- **동물 매달림 4상태 시트**(기본 동물 10종 먼저, 스킨은 그 뒤): `hang`(풍선 줄 잡고 다리 흔들, 4칸) · `blow`(풍선 불기,
  볼 부풀림 4칸) · `flail`(터진 뒤 허둥, 4칸) · `chute`(낙하산 줄 잡고 흔들림, 3칸). 착지·도착은 기존 walk/idle/cheer 로.
  걷기 시트 전례(`docs/spritemake-request/applied/2026-10-02-deguri-walk-sheets.md`, `AutoTest/spritemake/walk-sheet.py`)처럼
  검증 스크립트(칸 간 차이·발바닥선)를 먼저 정한다. 방향: 시트는 오른쪽 보기 한 장, 왼쪽은 반전(목업 반영 예정 "방향 자유").
- **풍선**: 색 8종은 코드 도형으로 충분(목업). `deguri_balloon` 장착자는 그 장식 그림을 쓴다(§6-1).
- **낙하산**: 캐노피 1장(흰·빨강 줄무늬, 목업 `drawChute`) + 펴지는 3칸.
- **발판 2종**: 여닫이(닫힘·반열림·열림 3칸, 양 끝 경첩) · 단단한 판(1장). 1차는 코드 도형.
- **장애물**: 밤송이(1장 + 떨어지는 1장), 가시공(1장 — 진자 끝), 먹구름(쉼·번쩍 2칸) + 번개(1장), 셔터 문(좌·우 1장씩),
  상승 기류(화살표 띠 — 코드), 가시벽 타일(1장), 도착 구름 띠(1장).
- **의뢰 단위**: ① 소품 배치 1(발판 2종·밤송이·가시공·먹구름/번개·셔터·가시벽·도착 띠·낙하산) ② 동물 `hang`+`blow` 10종
  ③ 동물 `flail`+`chute` 10종 ④ 스킨 70종 × 4상태(규모가 커서 사용자 결정 뒤). 규격·앵커는 데구리 manifest 와 같은 JSON 으로.

## 7. 화면

### 7-1. 구조
- **`deguri-multiplayer.html` 을 복사해 베이스로 쓴다**(§10 Q8 결정). `docs/GameGuide/NEW-GAME.md` §0 의 경마 베이스 규칙과
  다르지만, 캔버스 무대·동물 고르기·투표 칸·결과 카드·하이라이트·GIF 조작줄이 이미 있어 더 가깝다. 데구리 전용(동물수·맵
  버튼 `deguri-multiplayer.html:238-256`, 상점·뽑기 마운트)은 뺀다.
- 캔버스 세로 비율: 폰은 세로로 길게(데구리 `MOBILE_ASPECT` 1.4, `js/deguri-render.js`) — 위로 오르는 게임이라 더 유리.
  목업은 `.app` 480 폭 세로 꽉 채움.

### 7-2. 숫자 기준 (DESIGN.md UX 원칙 — 게임 화면은 범위 밖이지만 원칙은 적용)
- 폰 375×812 **방에 들어온 첫 화면**: 글자 60자 이하(캔버스 안 이름표·토스트 제외), 조작 요소 6개 이하 —
  [준비] [1등 찾기] [꼴등 찾기] [내 동물] [경주 시작(방장)] [채팅] 까지 6개. 동물수·맵 버튼을 안 두는 이유.
- 목표까지 탭: 다시 온 사람 **준비 1탭**(룰 기본 꼴등, 동물은 지난 선택 유지 — 데구리 `resetDeguri` 가 picks 유지), 방장은
  시작 1탭. `node mockups/measure.js` 는 목업 전용이라 게임 페이지는 Playwright 로 글자 수·버튼 수를 센다(§테스트).

### 7-3. 카메라(목업 650-678행 그대로, 클라 전용)
- 자동: 1등 룰은 선두 +120, 꼴등 룰은 **아래 두 마리 중간 +60**(남은 1명이면 그 동물). 당첨 확정 뒤 당첨자. 완만 추적
  (camEase 3), 세계 위아래 한계 클램프.
- 끌면 그 자리 고정(`free`), 동물 탭(반경 40)하면 그 동물 따라가기, 휠도 고정. 왼쪽 아래 "카메라 고정 · 자동으로" /
  "{이름} 따라가기 · 자동으로" 버튼 한 개로 복귀. 데구리의 3초 자동 복귀(`MANUAL_IDLE_RETURN_MS`)는 **안 쓴다**(목업 결정).
- 오른쪽 세로 높이 게이지(참가자 색 점), 1000 단위 고도 점선(`y/10 m`), 하늘은 높이에 따라 어두워지고 별이 뜬다.
- HUD: 당첨 룰 배지·순위(데구리 순위표 접기 규칙 재사용), 토스트 한 줄(1.1초).

## 8. 스킨·뽑기·코인·랭킹

- 사용자 전제: "데구리 스킨·뽑기·옷장 그대로". 지갑은 **서버별 scope**(`roomScope`, `socket/deguri.js:145`; 슬롯 키
  `deguri_skin@N`, lessons/deguri.md 2026-10-15). 풍선 타기 방도 같은 scope·같은 슬롯을 읽으면 데구리에서 산 스킨이 그대로
  보인다. **1차는 읽기만**(장착 스킨 표시 + 옷장 보기), 상점·뽑기·코인 적립은 2차(§10 Q2 결정).
- 구현 방식: `socket/deguri.js` 의 지갑·장착 함수(`loadAccount`·`equippedIn`·`attachCosmetics`…)가 `gameState.deguri` 에
  묶여 있다(`socket/deguri.js:91-175`). 풍선 방이 쓰려면 ① 그 부분을 `socket/deguri-wallet.js` 로 떼어 두 게임이 `require`
  (주의 경로 `socket/*` 리팩터 — 데구리 회귀 테스트 `qa-deguri-skin-shop-test.js`·`qa-deguri-per-server-wallet.js` 필수) 또는
  ② 1차는 `users.prefs.equipped['deguri_skin@N']` 만 DB 에서 읽는 작은 함수로 시작. **1차는 ②**(§10 Q2 결정), ① 은 2차 상점
  공유 때. 풍선 장식도 같은 함수로 `deguri_balloon@N` 을 읽는다(슬롯 키 `slot + '@' + scope`, `db/cosmetics.js:31-32`; scope 의
  두 슬롯을 한 번에 돌려주는 함수가 이미 있다 `db/cosmetics.js:43-51`).
- 코인: 1차는 **적립 없음**(§10 Q2 결정). 2차에 한 판 참여 +10(`COIN_RACE_JOIN`)을 줄 때 원장 ref 를 `balloon:` 접두로.
- 랭킹·통계: gameType `balloon` 신규 — `db/stats.js` DEFAULT_GAME_STATS, `routes/api.js:443` defaultGameStats, `db/ranking.js`
  `getFullRanking` 만(NEW-GAME.md Phase D). 기록 규칙은 데구리와 같음(당첨 = 패자, `socket/deguri.js:594-602`).
- 튜토리얼: `FLAG_BITS.balloon = 1024`(현재 deguri 512 가 마지막, `js/shared/tutorial-shared.js:19`; 16 재사용 금지 C-44).

## 9. 단계 나누기

### 9-1. 1차 출시(테스트 서버만, `DEV_GATED_GAMES` 에 `balloon` 추가 — `config/index.js:26-31`, C-38 두 경로 짝으로)
- 서버: `socket/balloon-sim.js`(맵 덱·반전·예산, 시뮬, 1등/꼴등, 캡) + `socket/balloon.js`(투표·시작·reveal·결과·리셋·마스킹).
- 클라: `balloon-multiplayer.html`, `js/balloon.js`, `js/balloon-render.js`(재생·카메라·HUD·토스트), `css/balloon.css`.
- 등록 16곳(NEW-GAME.md §2) 전부 + `utils/og-meta.js` GAME_LABELS + `js/free.js` 5맵 + `js/shared/free-invite.js` 2맵 +
  dice 로비 href (데구리 슬러그 세트와 같은 묶음, `routes/api.js:29,132,210`).
- 그림: 서기 시트 + 코드 팔·줄·풍선·낙하산·발판·장애물(목업 그대로), 데구리 소품·fx 재사용분만.
- 스킨: 장착 스킨 **표시 + 옷장 보기**, 장착한 `deguri_balloon` 은 타는 풍선 그림으로(§10 Q2·Q3). 상점·뽑기·코인은 없음.
- 하이라이트·GIF 녹화: 렌더러가 `create(canvas,{dpr})`·`frameBalls`·재생 제어 API 를 내면 GIF 는 포함. 서버 하이라이트는
  분리 비용이 반나절 안이면 포함, 아니면 2차(§10 Q9).
- 테스트: 결정성·스윕·2탭 Playwright(§테스트).

### 9-2. 2차 이후
- 전용 애니 4상태(§6-2) · 단단한 발판/방향 자유(목업 반영 뒤 서버에 옮김 — 목업이 먼저) · 중간 합류 재전송 · 상점·뽑기·코인 공유 ·
  구름 발판·새 떼 구간 · 셔터 끼임 · 실서버 공개(로비 라디오·DEV 게이트 해제).

### 9-3. 목업 수치를 그대로 옮길 상수 (`socket/balloon-sim.js` 상단 `const` 블록 — 숫자는 파일 상단에, AGENTS.md)
- 세계: `WORLD_W 360 · BODY 44 · BAL_OFF 76 · startYard 240 · topYard 280 · middleMin 3500 · funnel 120 · wallPad 16 ·
  thornPad 4 · spikeR 13 · balloonR 15 · spikeClear 130`
- 움직임: `riseMin 128 · riseMax 150 · riseWobble 0.22 · catchUp 0.9 · wanderAmp 34 · wanderWMin 0.45 · wanderWMax 0.9 ·
  balTilt 0.12 · homeK 0.9 · kickV 110 · kickDecay 1.3 · safeDur 1.2 · popBoost 0.07 · popBoostMax 0.35`
- 터짐·낙하: `popStop 0.25 · dropDur 0.3 · dropG 900 · chuteV 300 · chuteEase 4 · chuteSway 26 · landDur 0.3 ·
  reInflMin 1.0 · reInflMax 2.0`
- 돌풍·독수리: `gustMin 5 · gustMax 8 · gustDur 1.5 · gustPush 80 · gustSlow 0.55 · windEase 3 · eagleFirst 8 · eagleMin 7 ·
  eagleMax 10 · eagleWarn 0.9 · eagleFly 1.1 · eagleHitP 0.4 · eagleFromH 0.12 · eagleTopGap 150 · eagleMissDy 46`
- 발판·판정·연출: `flapOpen 1.25 · flapEase 14 · flapHold 0.3 · finalZone 220 · finalSlow 0.5 · countdown 3 · hitStop 0.25 ·
  hitSlow 0.35 · resultDelay 1.6 · shakeDur 0.3 · camEase 3 · maxSec 240(→ 서버 캡 150초, §10 Q5)`. `countdown` 은 서버 4초 /
  풍선 불기 3초로 나눈다(§10 Q6)
- 구간 장치 `Z`: `bladeLen 100 · bladeHub 14 · bladePeriod 6 · pendLen 150 · pendAmp 0.8 · pendPeriod 2.8 · pendR 15 ·
  boltPeriod 3.6 · boltWarn 0.7 · boltDur 0.25 · boltW 70 · boltLen 280 · fanPeriod 3 · fanOn 1.4 · fanPush 150 · fanBand 120 ·
  beePeriod 3.4 · beeDur 1.6 · beeSpan 280 · beeDrop 240 · beeR 24 · shutPeriod 3 · shutSlide 0.4 · shutSteer 2.2 · shutReach 260 ·
  upBoost 1.9`
- 구간 9종의 높이·발판·가시·장치 좌표(§3-2, 목업 143-173행) 전부.
- 카메라·HUD(클라): `camEase 3 · 탭 반경 40 · 드래그 문턱 6px · 토스트 1.1s`.

## 10. 정해진 것 (2026-10-18 사용자: 열린 질문 9개 전부 추천안대로)

1. **이름·슬러그**: `balloon` — gameType·경로 `/balloon`·파일 접두(`socket/balloon.js` 등). 한 단어라 데구리처럼 한 세트로 바꾸기 쉽다.
2. **지갑 공유(1차)**: 데구리 장착 스킨 **읽기만**(표시 + 옷장 보기). 상점·뽑기·코인 적립은 2차. 1차 구현은 §8 방식 ②
   (DB 에서 장착값만 읽는 작은 함수), 지갑 모듈 분리는 2차.
3. **풍선 그림**: `deguri_balloon`(야식 풍선 8종)을 장착했으면 그 그림이 타는 풍선, 안 했으면 색 풍선.
4. **방장 설정**: 없음. 사람당 1마리 고정, 맵은 늘 랜덤(고정 맵 버튼 없음).
5. **시간 상한**: 서버 캡 150초(`SIM_CAP_MS` 150000).
6. **카운트다운**: 데구리와 같은 4초(공용 모듈 그대로), 풍선은 마지막 3초 동안 분다.
7. **동시 도착**: 같은 스텝이면 입장 순(공 id)으로 가른다. 재경기 없음.
8. **페이지 베이스**: `deguri-multiplayer.html` 복사(NEW-GAME.md 의 경마 베이스 규칙의 예외).
9. **1차 하이라이트**: 구현자가 서버 하이라이트 모듈 분리 비용을 재서 반나절 안이면 포함, 아니면 2차. 어느 쪽인지 보고에 적는다.

## 11. 테스트 뒤 고칠 것 (2026-10-18 사용자 플레이 피드백)

화면(클라 전용, 소켓 계약 그대로):
1. **순위표** — 데구리처럼 캔버스 오른쪽 위(높이 게이지 왼쪽). 도착 순 → 미도착은 높이 순. 접힘 기본(당첨 자리·나·따라가는 동물),
   제목 눌러 펼침. 행을 누르면 그 동물 따라가기.
2. **카메라** — 데구리 규칙: 끌어서 옮긴 수동 카메라는 3초 입력이 없으면 자동으로 돌아간다(§7-3 "안 쓴다" 를 바꿈). 동물 탭·순위표로
   고른 따라가기는 유지. 추적이 늦어 동물이 화면 밖으로 나가던 것 → camEase 3 → 7, 목표가 화면 위·아래 끝 쪽이면 더 빨리(따라잡기). 꼴등 룰 자동 카메라는 아래 두 마리가 화면 높이 55% 안에 있을 때만 둘의 중간, 멀면 꼴등만(중간을 비춰 아무도 안 보이던 것).
3. **여닫이 판** — `plank.webp` 반쪽을 그릴 때 오른쪽 판이 경첩을 가운데로 그려 `ㅇ=ㅇ=` 로 보였다 → 두 판 모두 경첩이 바깥 끝(`ㅇ==ㅇ`).
4. **밤송이** — 제자리에서 천천히 돈다(밤송이마다 방향·속도 조금씩 다르게, 그림 전용).
5. **양옆 여백** — 높이에 따라 바뀌는 먼 배경(언덕·나무 → 구름 섬 → 별) 시차 그림으로 빈 하늘을 채운다. 트랙(벽·발판)보다 흐리게.
6. **풍선 터짐** — 터짐 3칸을 지나며 알파로 서서히 사라진다.
7. **풍차** — 날개 길이 100 → 60(그림·판정 같이).
8. **^ ^ 웃음** — 도착해서 서 있을 때, 세이브 다리·구름 쿠션에 내려앉을 때, 아이템을 먹을 때 머리 위에 ^ ^ 말풍선(그림 전용).

규칙(서버 시뮬, 결정론 그대로 — 새 장치도 시각 t·시드 rng 의 함수):
9. **세이브 다리(비버)** — 구간 경계마다 하나(맨 아래 구간 아래 제외). 판 길이를 지키려고 맵 높이 3500~4400 → 4200~5100. **꼴등(아직 안 도착한 동물 중 가장 낮은 동물)의 발이 경계 + 40 을
   넘으면** 비버들이 양옆에서 통나무를 들고 나와 다리를 놓는다(사건 `bridge{idx}`, 그림 0.9초). 그 뒤 위에서 떨어지는 동물은 거기서 선다
   (낙하산 착지와 같음). 밑에서 오르는 동물(하수구로 내려간 경우)은 비버가 비켜 줘서 통과한다.
   그림은 데구리 `pieces/beaver-v2.webp`(통나무 든 비버 2칸·놀람·도망) + 통나무 들보.
10. **아이템 상자** — 구간마다 1개(장애물과 안 겹치는 빈 자리, 맵 rng). 오르던 풍선이 닿으면 먹는다(그 상자는 6초 뒤 다시 생김).
    무엇이 나올지는 먹는 순간의 **순위로 정한 확률**(같은 식, 시드 rng): 슈퍼 풍선 확률 = 0.3 + 0.5 × (순위−1)/(인원−1)
    (선두 30% → 꼴등 80%), 나머지는 방패. 사건 `item{ball, kind: 'super'|'shield', box}`.
    - **슈퍼 풍선**: 2.5초 동안 상승 속도 ×2.3, 그동안 장애물에 안 터짐. 금색 풍선으로 바뀐다. 끝나면 `superEnd`.
    - **방패**: 다음 한 번의 터짐(가시·장애물·독수리, 피날레 제외)을 막는다. 막으면 `shieldPop` + 무적·튕김. 12초 지나면 사라짐.
    - 밸런스 확인: sweep 으로 판 길이 중앙값이 지금 범위(꼴등 룰 55~63초)에서 ±10% 안.
11. **하수구(워프 파이프)** — 한 판에 짝 1쌍(구간 4개 이상이면 2쌍): 아래쪽 파이프는 아래 절반 구간의 발판 위, 위쪽 파이프는 위 절반 구간의
    발판 위(그 발판은 늘 solid). **떨어지는 중(drop·chute)** 파이프 입(가장자리 근처까지 빨려 듦)에 들어가면 짝 파이프에서 뿅 나와(0.5초 숨음) 옆으로 튕겨
    그 발판에 내린다 — 아래 → 위는 "인생역전!", 위 → 아래는 "하수구로 쏙!". 오를 때는 들보처럼 비켜 간다(입으로 안 빨려 들어감).
    같은 동물이 파이프에 다시 들어가는 건 3초 뒤부터. 사건 `warp{ball, from, to}` · `warpOut{ball, x, y}`. 그림은 데구리 `warp-pipe.webp`.
12. **구름 쿠션** — 구간마다 0~1개(rng 0.5, 발판 없는 빈 자리). 떨어지다 닿으면 폭신 착지 → 다시 불기가 0.4~0.7초(평소 1~2초).
    오르는 동물은 그냥 통과. 착지 사건은 `land{plat}` 그대로(그 plat 의 kind = 'cloud').
13. **동물끼리 튕김** — 둘 다 오르는 중이고 풍선끼리 겹치면 서로 반대쪽으로 튕긴다. 같은 둘은 0.5초에 한 번. 사건 `bump{a, b}`(토스트 없이 그림만).

맵 기준선(`balloon-map-seed1.canonical.json`)은 이 변경으로 다시 찍는다(`--update`). 결정론·종료·덱 테스트는 그대로 통과해야 한다.
그림 2차(아이템 상자·슈퍼 풍선·방패·구름 쿠션)는 `balloon-sheet.py scaffold-props2` 배치 — 의뢰서에 기록.

## 공정성
- 결과는 서버 `socket/balloon-sim.js` 만 결정, 클라는 재생. 클라 `Math.random` 은 deviceId/tabId 외 0회
  (`grep -c "Math.random" js/balloon.js js/balloon-render.js`).
- reveal 전 `timeline`·`seed`·`result`·`target` 비노출 — `getCurrentRoom` 화이트리스트(`socket/rooms.js:172-175` 데구리 줄과 같은
  모양), 재진입 `getCurrentRoom` 응답에 server-only 필드 0개(C-20·C-25).
- 투표 룰렛은 서버 RNG(`decideTarget`), 시드 생성은 서버 `Math.random`(데구리와 동일).
- 스킨·풍선 장식은 시뮬 뒤에 얹는다(`attachCosmetics` 순서, `socket/deguri.js:511`) — 순위·타임라인에 절대 안 들어간다.

## 기존 통합 유지 (스킵 금지)
- 준비·채팅·주문·랭킹·튜토리얼·사운드(`assets/sounds/sound-config.json` `balloon_*` 키: start·pop·land·goal·lose) 계속 동작.
- 데구리·경마·주사위·룰렛 무영향: 공유 파일(`socket/rooms.js`·`socket/chat.js`·`utils/room-helpers.js`·`routes/api.js`·
  `css/theme.css`·`js/shared/*`)에는 **등록 줄만** 추가. 지갑 함수를 떼어내지 않는 한 `socket/deguri.js` 는 건드리지 않는다.
- 미사용 게임(다리건너기·해적룰렛)은 참조·수정·검증 전부 제외(AGENTS.md).

## 작업 방식
- 먼저 읽기: 이 문서 → `mockups/balloon-climb.html` 전체 → `socket/deguri-sim.js` 1-250행(상수·모듈 계약)·625-700행(buildTrack·
  drawOrder)·795-830행(simulate 계약)·1500-1576행(종료·순위) → `socket/deguri.js` 300-630행 → `js/deguri.js` 1991-2070행 →
  `docs/GameGuide/NEW-GAME.md` → `docs/GameGuide/lessons/_common.md` C-19·C-20·C-24·C-25·C-38·C-44 → `lessons/deguri.md`.
- 순서: ① `balloon-sim.js` + 결정성·스윕 테스트(목업 수치와 비교, 여기서 길이 맞출 때까지 클라 안 만듦) → ② `socket/balloon.js`
  + 등록 16곳 + 마스킹 → ③ 렌더러·페이지(폰 375 먼저) → ④ 2탭 QA → ⑤ 하이라이트·GIF → ⑥ `update-log.md`.
- 모바일·PC 둘 다, 라이트·다크 스킨 둘 다 확인(캔버스 그림은 스킨 무관, HTML UI 는 토큰만 — THEME-DARK.md §5-1).
- 목업 파일은 **읽기만** — 사용자가 동시에 고치는 중. 목업에 들어간 값이 바뀌면 §9-3 상수를 따라 바꾼다.
- 새 그림 의뢰는 §6-2 단위로 `docs/spritemake-request/` 에 의뢰서를 쓰고 사용자 승인 뒤 `/spritemake-pickup`.

## 테스트
- `node -c` 전 변경 파일 + `node server.js` 실제 부팅(C-21).
- `node AutoTest/balloon-determinism-test.js`, `node AutoTest/balloon-sweep.js`(§4-5 기준값).
- Playwright 2탭(`AutoTest/qa-balloon-flow-test.js`): 방 생성 → 자동 ready(C-24) → 투표 없이 시작(기본 꼴등) → reveal 두 탭
  `durationMs` 동일·결과 카드 당첨자 동일 → 새로고침 재입장 `getCurrentRoom` 에 timeline 없음 → 결과 뒤 다시 보기 → 1등 룰
  투표 한 판. 폰 뷰포트 375×812 에서 첫 화면 글자 수·조작 요소 수를 세어 60자/6개 이하 단언.
- 기존: `AutoTest/deguri-determinism-test.js`·`qa-deguri-skin-shop-test.js`·`qa-deguri-per-server-wallet.js`·경마 대표 e2e 통과
  (스테일 3개는 `project_horse_stale_e2e_tests` 참고).
- 수동: 테스트 서버(`DEV_GAMES=1`) 폰 실기 — 카메라 끌기·탭·복귀, 토스트 가독, 결승 슬로모, 결과 카드 "펑 N번".

## 완료 기준 (하나라도 미완이면 완료 아님)
- 위 테스트 전부 통과, 스윕 중앙값 꼴등 54~61초·1등 42~48초 ±15%, 캡 0건.
- 등록 16곳 + 슬러그 세트 전부, 실서버는 `DEV_GATED_GAMES` 로 잠김(방 생성 2경로 모두).
- 클라 `Math.random` 0회, 재진입 마스킹 확인.
- 폰 375 첫 화면 60자/6개/준비 1탭.
- `update-log.md` 기록. 새 리소스 = 없음(1차는 데구리 에셋 재사용 + 코드 도형) 명시.
- 마지막 보고에 변경 요약·파일·테스트 명령/결과·자체 평가·남은 이슈(§9-2)·"💡 lesson 후보" 포함. 완료 시
  `.claude/.goal-applied-queue` 에 `docs/goal/balloon-climb.md` 한 줄 append.

## 막힘 기준
- 목업과 데구리가 다르게 하는 부분(카운트다운 길이·캡·동시 도착)은 §10 결정대로 가고 보고에 적는다.
- 하이라이트 서버 모듈 분리가 데구리 회귀를 부르면 1차에서 빼고 2차로(§10 Q9).
- 지갑 함수 분리가 필요해지면 멈추고 사용자에게 묻는다(주의 경로 `socket/*`, AGENTS.md).
- 테스트 불가 시 구현은 완료하되 어디서 막혔는지 구체 보고.

## 참고
- 원본: `mockups/balloon-climb.html`(미커밋), 사용자 결정 2026-10-18(이 문서 §2·§3·§7-3).
- 데구리 계약: `socket/deguri-sim.js`(simulate 795-803, buildTrack 625-640, drawOrder 642-665, rankPlayers 1545-1556),
  `socket/deguri.js`(startDeguri 459-561, endGame 563-615, publicState 647-653), `js/deguri.js`(reveal 1991-2026),
  `js/deguri-render.js`(create 389, frameBalls 501, exports 3065), `utils/room-helpers.js:123-137`, `socket/rooms.js:172-175, 252`.
- 적용된 데구리 goal: `docs/goal/applied/deguri-random-track.md`(덱·반전·예산), `docs/goal/deguri-first-rule-flow.md`(1등 룰
  전용 흐름·탈락 캡), `docs/goal/applied/deguri-jev-highlight.md`, `docs/goal/applied/deguri-manual-camera.md`,
  `docs/goal/applied/deguri-per-server-wallet.md`.
- 규칙: `AGENTS.md`, `DESIGN.md` UX 원칙, `docs/GameGuide/NEW-GAME.md`, `docs/GameGuide/lessons/_common.md`, `lessons/deguri.md`,
  `docs/GameGuide/02-shared-systems/THEME-DARK.md`.
