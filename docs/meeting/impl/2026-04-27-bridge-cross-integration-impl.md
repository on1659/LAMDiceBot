# Bridge Cross 4번째 게임 통합 구현 명세 (impl)

작성일: 2026-04-27 (베팅 게임 구조로 재작성)
대상: LAMDiceBot 본 서버에 bridge-cross를 4번째 게임으로 통합 — **경마 패턴 베팅 게임**
구현 추천 모델: **Opus** (다파일 + Socket + 자산 + 공유 모듈 + 게임 디자인 판단)
선행 작업: bridge-cross 목업 (`output/bridge-cross/bridge-cross-game-mockup.html`) — 시각/카메라/디버그 완성

> **On completion**: move this file to `docs/meeting/applied/`

---

## 0. 배경

- 현재 LAMDiceBot 게임 3종: 주사위 / 룰렛 / 경마 — 모두 **베팅 게임**
- bridge-cross 목업이 **자동 진행 게임**으로 완성됨 — 사용자 입력 0
- 4번째 게임으로 정식 편입 시 다른 게임과 일관된 **베팅 게임 패턴**으로 변환 필요
- 경마(`socket/horse.js`) 패턴 그대로 차용

선행 컨텍스트:

- 자산 (`assets/bridge-cross/{sprites,stage}/`) 정리 완료
- 카메라 / 디버그 / 시각 완성
- glass-fx-v2 새 자산 + 매니페스트 anchor 0.88 변경은 도착 후 통합

> **📝 새 세션 참고**: 이 impl이 어떻게 도출됐는지 / 사용자 결정 흐름 / 시각 시행착오 등은
> `D:\Work\LAMDiceBot\docs\etc\2026-04-27-bridge-cross-integration-impl.txt`
> 에 이전 세션 대화 요약이 있으니 막힐 때 참고. 단 본 impl 문서가 source of truth.

---

## 0.5 서버-클라이언트 책임 분리 (핵심 원칙)

본 게임의 **모든 결과는 서버가 단독으로 결정**하고, 클라이언트는 받은 데이터를 시각으로 재생한다. 경마(`socket/horse.js`)와 동일한 패턴.

### 서버 (Source of Truth)

- **통과자 결정**: `passerIndex K = random(1, M)` (M = 활성 캐릭터 수)
- **안전 경로 결정**: `safeRows[N]` — 각 column의 top/bottom (균등 random)
- **캐릭터 시나리오 결정**: 각 도전자별 `{ failColumn, failRow }` 또는 `{ success: true }`
- **베팅 정산**: K번째 통과 캐릭터 색에 베팅한 사용자 = 승자
- **broadcast**: `bridge-cross:gameStart` 이벤트로 위 데이터를 모든 클라이언트에 동일하게 전송

### 클라이언트

- **수신**: 서버 broadcast 데이터 (K, safeRows, scenarios, activeColors)
- **재생**: 받은 데이터대로 시각 재생만. **`Math.random()` 호출 0회**.
- **자유 영역**: 카메라 워크, 애니메이션 타이밍, FX, BGM — 시각 효과는 클라이언트 자유 (결과 영향 없음)
- **위변조 불가**: K / safeRows / scenarios 모두 서버 결정이라 클라이언트가 조작해도 서버 정산 결과 동일

### 동기화 보장

- 같은 시드 → 같은 결과 (deterministic) — 모든 클라이언트가 동일 시각 재생
- 네트워크 지연 / FPS 차이로 한 클라이언트 약간 느려도 결과 일치
- 사용자 이탈 시에도 시나리오 그대로 (클라이언트는 시각만, 서버가 정산)

### 검증 책임

- **서버**: 모든 게임 결과를 직접 결정 — 최종 winner뿐 아니라 **중간 시나리오도 서버가 사전 결정**:
  - 통과자 K (1~M 균등 random)
  - 각 column 안전 row (top/bottom)
  - 각 캐릭터의 도전 결과 (어느 column에서 어느 row 시도해서 떨어지는지)
  - 통계 / 랭킹도 서버에서
- **클라이언트**:
  - 결과 표시만. 통과/실패 판정 X.
  - 중간 시나리오 random 결정 X (서버 broadcast 데이터 그대로 재생).
  - `Math.random()` 호출 0회 (시각 jitter / 호흡 등 외관 효과 제외).

---

## 1. 게임 룰 (확정)

### 1.1 핵심 메커니즘

**다리 건너기 = 베팅 게임**:

- 사용자는 **빨주노초파남 6색** 중 1색에 베팅 (N=6, 보라 제외)
- 베팅된 색의 캐릭터만 다리에 도전 (나머지는 시작 plat 정지)
- 베팅된 캐릭터 중 **K번째 도전자가 통과** (서버 사전 결정)
- K번째 통과 캐릭터 색에 베팅한 사용자 승리

### 1.2 결정 사항

| 항목 | 값 |
|---|---|
| 유리(column) 수 | **N = 6 고정** (Phase 1 시각 검증 후 변경 가능) |
| 캐릭터 수 | **6명** (유리 수와 동일) |
| 캐릭터 색상 | **빨 → 주 → 노 → 초 → 파 → 남** (6색, 보라 제외) |
| 도전 순서 | 색상 순서 (빨강 먼저, 남색 마지막) |
| 베팅 | 1~6 중 1색 선택, **중복 허용**, **비공개** (게임 시작 시 공개) |
| 통과 확률 | 베팅된 캐릭터 M명 중 K번째 균등 random (1/M) |
| 게임 시작 조건 | 방 인원 ≥ 2명 |
| 베팅 마감 조건 | 베팅 인원 ≥ 2명 |
| 배팅 안 된 캐릭터 | 시작 plat 정지 (경마 `unbetted_stop` 동등) |

### 1.3 시나리오 결정 (서버)

```
1. 베팅 마감 → 활성 캐릭터 인덱스 추출 (베팅된 색)
2. 활성 캐릭터 수 M 측정 (M ≥ 2)
3. K = random(1, M) — 통과 순서 결정
4. safeRows[N] = 각 column의 안전 row (top/bottom 균등 random)
5. scenarios[M] 생성:
   - i < K-1: { failColumn: m_i, failRow: ... } — m_i는 column 0..N-1 중 K-1개 오름차순 선택
   - i = K-1 (K번째 도전자): { failColumn: null, success: true }
   - i > K-1: 도전 X (게임 종료 후)
6. broadcast: { passerIndex K, activeColors, safeRows, scenarios, bettingDeadline }
```

### 1.4 동작 예시

- 7명 사용자 방 / 유리 수 N=6 / 베팅: 빨 3, 노 2, 파 1, 남 1 (4색 활성)
- M = 4 (활성 캐릭터)
- K = random(1, 4) → 예: K=2 (노랑 통과)
- 도전 순서: 빨(1번) → 노(2번) → 파(3번 X 도전 안 함) → 남(4번 X)
- 시나리오:
  - 빨: { failColumn: m_1, failRow: ... }
  - 노: { failColumn: null, success: true }
- 승자: 노랑에 베팅한 사용자 2명

### 1.5 N 결정

- **N = 6 확정** (빨주노초파남 6색, 보라 제외)
- Phase 1 시각 검증 후 5/7로 변경 가능 (후속 옵션)

---

## 2. 서버 측 구현

### 2.1 새 파일: `socket/bridge-cross.js`
경마 (`socket/horse.js`) 패턴 그대로 차용. register 함수 export.

### 2.2 게임 상태 (`room.bridgeCross`)

```js
{
  phase: 'idle' | 'betting' | 'playing' | 'finished',
  userColorBets: { [userName]: colorIndex },  // 1~N
  passerIndex: K,                             // 통과자 인덱스 (1~M)
  activeColors: [colorIndex, ...],            // 베팅된 색 정렬
  safeRows: ['top'|'bottom', ...N개],
  scenarios: [{ failColumn, failRow } | { success: true }, ...M개],
  bettingDeadline: timestamp,
  winner: [userName, ...] | null
}
```

### 2.3 클라이언트 → 서버 이벤트

- **`bridge-cross:select`** `{ colorIndex }` — 캐릭터 색 선택 (베팅, 토글 가능)
  - rate limit
  - 방 phase = 'idle' or 'betting'에서만 허용
  - 같은 색 다시 선택 → 베팅 취소
  - 다른 색 선택 → 변경
  - 본인에게만 확인 응답 (`bridge-cross:selectionConfirm`), 다른 사용자에겐 숫자만 ("X명이 베팅 완료" 같은 형태)

- **`bridge-cross:start`** (host only) — 게임 시작 요청
  - 방 인원 ≥ 2 검증
  - 베팅 인원 ≥ 2 검증
  - 시나리오 결정 → broadcast

### 2.4 서버 → 클라이언트 이벤트

- **`bridge-cross:bettingOpen`** `{ deadline }` — 베팅 phase 시작
- **`bridge-cross:selectionConfirm`** `{ colorIndex }` — 본인 베팅 확인 (선택자 본인만)
- **`bridge-cross:selectionCount`** `{ count }` — 베팅 인원 수 (모두에게)
- **`bridge-cross:gameStart`** `{ passerIndex, activeColors, allBets, safeRows, scenarios }` — 게임 시작 (모든 베팅 공개)
- **`bridge-cross:gameEnd`** `{ winnerColor, winners, ranking }` — 결과

### 2.5 공정성 보장

- **시드 / 안전 경로 / K / scenarios 모두 서버 결정**
- 클라이언트는 시각 재생만, 결과 위변조 불가
- 시나리오 deterministic — 같은 input 같은 result
- 베팅 phase 동안 다른 사용자 베팅 비공개 (게임 시작 시 broadcast로 공개)

### 2.6 Rate limit + 방 상태 broadcast

- 모든 핸들러 첫 줄: `if (!ctx.checkRateLimit()) return;`
- 방 상태 변경 시: `ctx.updateRoomsList()`

### 2.7 등록: `socket/index.js`

```js
const bridgeCross = require('./bridge-cross');
bridgeCross.register(io, socket, ctx);
```

---

## 3. 클라이언트 측 구현

### 3.1 새 파일: `bridge-cross-multiplayer.html`
`horse-race-multiplayer.html` 패턴 참조. 게임 시각만 목업에서 가져옴.

#### 3.1.1 Script 태그 (순서 중요)
```html
<script src="/js/shared/chat-shared.js"></script>
<script src="/js/shared/ready-shared.js"></script>
<script src="/js/shared/order-shared.js"></script>
<script src="/assets/sounds/sound-manager.js"></script>
```

#### 3.1.2 필수 HTML 요소
- ReadyModule, ChatModule, OrderModule 표준 ID
- 게임 캔버스: `<canvas id="game" width="1024" height="683">`
- **베팅 UI**: 7색 카드 (베팅 phase에서 표시)
- 줌 UI / HUD
- 디버그 패널: `?debug=1` 쿼리 시만

##### 3.1.2.1 Section layout (표준 수직 스택)

다른 게임(주사위/룰렛/경마)과 동일한 표준 레이아웃을 따른다:

1. topbar (제목/시작/나가기)
2. usersSection (접속자)
3. readySection (준비)
4. bettingSection (★ bridge-cross 고유 — 베팅 UI)
5. ordersSection (주문)
6. gameStatus
7. stage-wrap (★ bridge-cross 고유 — 게임 캔버스)
8. chat-section
9. statusbar (Event Feed + Crossing Order)

`.integration-grid` 같은 다중 컬럼 그리드 wrapper 사용 금지. `.shell { display: grid; gap: 12px; }`로 자연스러운 수직 스택을 형성한다.

**랭킹 통합은 후속 단계로 보류**: `ranking-shared.js`, `page-history-shared.js` import는 제거. 추후 랭킹 시스템 연동 시 (1) 두 모듈 import 추가, (2) RankingModule.init 호출, (3) 서버에서 `everPlayedUsers` emit 연결 — 셋을 함께 진행한다.

#### 3.1.3 CSS user-tag 색상
시안 테마 (`#42edff`)

#### 3.1.4 모듈 초기화 순서 (roomJoined 내)
```js
ChatModule.init → ReadyModule.init → OrderModule.init → SoundManager.loadConfig
```

### 3.2 게임 phase 흐름

```
1. 입장 → Ready
2. 호스트 Start → 서버가 베팅 phase 시작 (10~15초)
3. 사용자: 7색 카드 중 1색 클릭 → 베팅 (토글)
4. 베팅 마감 (deadline 도달 또는 호스트 강제) → 시나리오 결정
5. 서버 broadcast → 모든 베팅 공개 + 게임 시각 재생
6. 시각 재생: 활성 캐릭터만 다리 도전 (시나리오대로), 비활성 캐릭터는 시작 plat 정지
7. K번째 통과 → gameEnd → 베팅 정산
```

### 3.3 시각 재생 (목업 코드 그대로 차용)

> **🎯 source of truth**: `D:\Work\LAMDiceBot\output\bridge-cross\bridge-cross-game-mockup.html`
> 사용자 시각 검증 완료된 목업 — 마음에 들어함. **그대로 가져옴**.

#### 3.3.1 목업에서 가져올 것

- Camera / CameraDirector / resolvePhaseFraming
- StageLayout / Platform / Bridge
- SpriteAnimator / PlayerActor / AvatarController
- drawStageImage / drawBackground / drawTile / drawPlayer / drawScreenAtmosphere / render / loop
- UserZoomController + 줌 UI (마우스 휠 + 버튼 + reset)
- 디버그 모드 (프로덕션은 `?debug=1` 가드)

#### 3.3.2 목업의 사용자 확정 default 값 (그대로 박힘)

`StageLayout` 생성자 default — 변경 X:

```js
this.startWorld         = { x: -145, y: 751 };
this.finishWorld        = { x: 1013, y: -27 };
this.entranceOffset     = { x: 217, y: -159 };
this.exitOffset         = { x: -122, y: 40 };
this.rowStep            = { x: 146, y: 76 };
this.tileSize           = { w: 300, h: 143 };
this.tileRotation       = 0;
this.startStageRotation = 2.5;
this.finishStageRotation = 0;
this.charFootOffset     = 30;
```

기타 기본값:

- canvas 1024×683, world 2400×1024
- minZoom 0.667
- 카메라 lerp pan 8.0 / zoom 5.0
- finishSlots padU/padV = 0.3 / finishSlot[0] = finishPlatform.center
- bob: bobX ±1.5 (캐릭터별 phase 분산), bobY ±5

#### 3.3.3 목업 → 멀티플레이어 변경

- `resetGame(true)` 제거 — 클라이언트 시드 X. **서버 broadcast 데이터 사용**.
- `state.players` = 활성 캐릭터만 (베팅된 색, 색상 순)
- 비활성 캐릭터: 시작 plat에 추가 그림 (`idle` 자세, 회색조 또는 alpha 0.5 dim)
- 캐릭터 도전 시퀀스: 서버 `scenarios`대로 진행 (mulberry32 / Math.random 0회)
- `safeRows` 결정: 서버 broadcast값 그대로 사용 (`Array.from({...}, () => randItem(...))` 제거)
- `revealChoice`: 서버가 결정한 결과대로 표시만 (`success = (choice === safe)` 같은 클라이언트 판정 X)

### 3.4 베팅 UI

베팅 phase 동안만 표시:
- 7색 카드 (빨주노초파남보) 가로 정렬
- 각 카드: 색상 사각형 + 번호 (1~7) + "X명 베팅" 표시 (본인 빼고 카운트만)
- 본인이 선택한 카드 highlight
- 클릭 → 토글 (다시 클릭 = 취소, 다른 클릭 = 변경)
- deadline 카운트다운 (10초 → 0)

### 3.5 자산 경로

목업: `../../assets/bridge-cross/*` (상대)
실제: `/assets/bridge-cross/*` (절대)

### 3.6 모바일 대응

- canvas `width: 100%; aspect-ratio: 3/2`
- 줌 UI 우하단
- 베팅 카드 모바일 줄바꿈 (4 + 3 또는 7 가로)
- 채팅 / 준비 / 주문 표준

### 3.7 라우트: `routes/api.js`

```js
app.get('/bridge-cross', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'bridge-cross-multiplayer.html'));
});
```

### 3.8 메인 진입: `index.html`

```html
<a href="/bridge-cross" class="game-link">
  <h3>다리 건너기</h3>
  <p>유리 다리에서 누가 살아남을지 베팅!</p>
</a>
```

---

## 4. 사운드 시스템

### 4.1 사운드 키 (`assets/sounds/sound-config.json`)
- `bridge-cross_step` — 캐릭터 점프
- `bridge-cross_safe` — 안전 타일 도착
- `bridge-cross_crack` — 미지 타일 도전 (긴장)
- `bridge-cross_break` — 깨짐
- `bridge-cross_fall` — 낙하
- `bridge-cross_betting_open` — 베팅 phase 시작
- `bridge-cross_countdown` — 베팅 카운트다운
- `bridge-cross_result` — 결과 발표
- `bridge-cross_bgm` — 배경 음악

### 4.2 자산
Pixabay / Mixkit / Kenney CC0. 라이선스 노트 필수.

### 4.3 사운드 호출 위치
- 베팅 phase 시작 → `betting_open`
- 카운트다운 5초 → `countdown` (1초 간격)
- 캐릭터 점프 → `step`
- 미지 column 도전 → `crack`
- 안전 통과 → `safe`
- 낙하 → `break` + `fall`
- 결과 → `result`
- 게임 시작 ~ 종료 → `bgm` (loop, vol 0.4)

---

## 5. UI / UX

### 5.1 HUD (한국어)
- 좌상: "다리 건너기" + phase 표시 (Ready / 베팅 중 / 진행 중 / 결과)
- 우상: 시드 + 진행 column / N
- Event Feed (좌하): 한국어 메시지 ("빨강이 X열에서 떨어졌습니다")
- Order panel (우하): 사용자 베팅 결과 / 승자 표시

### 5.2 베팅 phase 화면
- 캔버스 위에 베팅 UI overlay
- 7색 카드 + 카운트다운
- 본인 베팅 highlight + 다른 사람 베팅 인원 (비공개라 본인이 선택한 색만 보임)

### 5.3 게임 시작 시 (베팅 공개)
- 베팅 UI 사라짐
- "X 색에 N명 베팅" 같은 형태로 모든 베팅 공개 (Order panel)
- 시각 재생 시작

### 5.4 결과 phase
- 승자 캐릭터 색상 강조
- 베팅 사용자 목록 (Order panel)
- "다시 하기" 버튼 (호스트만)

### 5.5 도움 / 튜토리얼
- 우상단 `?` 플로팅 버튼 → 튜토리얼 모달
- gameType: `'bridge'` (FLAG_BITS 등록)
- 첫 입장 시 자동

**튜토리얼 통합은 후속 단계로 보류**: 위 spec은 최종 목표이며, 현재 구현 본문에는 미반영 상태다. 다음 작업 시 (1) `js/shared/tutorial-shared.js`의 `FLAG_BITS`에 `bridge: <적절한 비트>` 추가, (2) `BRIDGE_CROSS_TUTORIAL_STEPS` 정의 (horse-race 템플릿 참조: `docs/tutorial/diff/horse-race-implementation-diff.md` §10), (3) `roomJoined`에서 `TutorialModule.setUser()` + `init()` 호출, (4) `bridge-cross-multiplayer.html` 우상단 `?` 도움 버튼 추가 — 4건을 함께 진행한다.

### 5.6 에셋 한국어 표기
- 게임명: "다리 건너기"
- 본문 한국어 → "에셋" (사용자 메모리 규칙)

---

## 6. 작업 단계

### Phase 1 — 정적 페이지 + 자산 통합 (1~2일)
- `bridge-cross-multiplayer.html` 신규 (목업 코드 이식)
- `routes/api.js` 라우트
- `index.html` 게임 링크
- 자산 경로 절대 경로 변경
- 자동 진행 모드 유지 (Socket 미연결, 시각 검증)

### Phase 2 — Socket 베팅 핸들러 (2~3일)
- `socket/bridge-cross.js` 신규
- `socket/index.js` 등록
- 시나리오 결정 알고리즘 (passerIndex K + safeRows + scenarios)
- 베팅 / 시작 / 종료 이벤트
- 공정성 검증

### Phase 3 — 클라이언트 베팅 UI + 동기화 (2~3일)
- 베팅 phase UI (7색 카드 + 카운트다운)
- Socket 연동 (select / bettingOpen / gameStart / gameEnd)
- 시나리오 충실 재생 (mulberry32 random 제거)
- 활성 / 비활성 캐릭터 시각 처리

### Phase 4 — 사운드 + 튜토리얼 (1~2일)
- 사운드 자산 임포트 + 라이선스 노트
- `sound-config.json` 키 추가
- 튜토리얼 (FLAG_BITS, TUTORIAL_STEPS)

### Phase 5 — 모바일 + 디버그 정리 (1일)
- 모바일 시각 / 터치 / 베팅 카드 레이아웃
- 디버그 패널 `?debug=1` 가드

### Phase 6 — QA (2~3일)
- 2탭 베팅 / 동기화
- 인원 가변 (2명, 4명, 7명, 8명+ 일 때 처리)
- 베팅 edge case (1명만 베팅, 0명 베팅, 모두 같은 색)
- 호스트 이탈 / 사용자 이탈 (게임 진행 중)
- 모바일 (iOS Safari, Android Chrome)
- 사운드 (자동재생 정책)

---

## 7. 보존 / 불변조건

- 게임 시퀀스 mulberry32 (서버 결정 deterministic)
- 자산 파일 경로 + 매니페스트 row/anchor 계약
- 공유 모듈 시그니처 (Chat / Ready / Order)
- 코드 호출 인터페이스 (목업과 동일): `layout.tileCenter`, `tileRect`, `entrance()`, `waitingSlot`, `finishSlot` 등
- 다른 게임 (주사위 / 룰렛 / 경마) 코드 영향 0

---

## 8. 위험 / 함정

### 8.1 베팅 처리
- **베팅 phase 중 사용자 이탈**: 베팅 무효 → 활성 캐릭터 수 변동 → 시나리오 재결정? 또는 그대로?
  - 추천: 베팅 마감 시점에 동결. 이탈 사용자 베팅도 유효 유지 (경마 패턴).
- **베팅 phase 중 신규 입장**: 입장 가능, 베팅 가능. 마감 전까지 자유.
- **모든 사용자 같은 색 베팅** (M=1): 자동 당첨 방지 → 게임 시작 차단? 또는 1명 도전 + 통과?
  - 추천: M=1이면 자동 통과 (당첨 보장 — 모두 승자, 베팅 의미 없지만 진행)

### 8.2 인원 가변
- 방 max 인원 없음. 중복배팅가능
- 추천: 경마와 동일 패턴 따름

### 8.3 게임 진행 중 이탈
- 시나리오 deterministic이라 클라이언트 시각만 영향 0
- 결과 정산 시 이탈 사용자도 정산 (다음 입장 시 표시 또는 fire-and-forget)

### 8.4 자동재생 / 사운드
- BGM은 사용자 인터랙션 (Start 클릭) 후 시작
- 모바일 자동재생 정책 주의

### 8.5 자산 도착 의존
- glass-fx-v2 새 자산 + 매니페스트 anchor 0.88 변경 후 시각 안정
- Phase 1 진행 가능, Phase 6 QA 전 자산 통합 권장

---

## 9. 검증

### 9.1 정적 검증
```bash
node -c server.js
grep -rn "document\.hasAttribute\|document\.style[^E]" bridge-cross-multiplayer.html
```

### 9.2 단일 클라이언트 (Phase 1 후)
- 페이지 로드 → 자산 로드 → 자동 진행 시각 OK

### 9.3 멀티 클라이언트 (Phase 2~3 후)
- 2탭+ 입장 → 베팅 → 베팅 마감 → 시나리오 broadcast → 모두 동시 시각 재생 → 결과 동일
- 베팅 비공개 검증 (다른 사용자 베팅 색 안 보임)
- 게임 시작 시 모든 베팅 공개

### 9.4 공정성
- 시나리오 deterministic (서버 결정, 클라이언트 위변조 X)
- 통과 확률 1/M 균등 (1000회 시뮬레이션)
- 활성 캐릭터 인덱스별 통과 비율 통계

### 9.5 Edge case
- 베팅 0명: 게임 시작 불가
- 베팅 1명: 자동 당첨 (또는 차단)
- 베팅 2명 같은 색: M=1 → 위와 동일
- 호스트 이탈: 자동 새 호스트 (다른 게임 패턴)
- 게임 진행 중 이탈: 시각 영향 0, 정산 정상

### 9.6 모바일
- iOS Safari, Android Chrome
- 베팅 카드 터치 / 줌 UI
- 캔버스 비율 / HUD 가독성

---

## 10. 후속 / 옵션 (Phase 7+)

- **자산 새 버전 통합** — glass-fx anchor 0.88 + drawTile anchor 기반 + charFootOffset 0
- **실시간 관전 모드** — 게임 진행 중 입장한 사용자 관전 (베팅 X)
- **리플레이** — 시나리오 저장해 다시 재생
- **랭킹 / 통계** — 통과 / 적중 횟수
- **테마 / 시즌** — 다리 디자인 변형
- **챌린지 모드** — N 또는 통과 확률 조정
- **N 가변** — 게임 옵션으로 5/6/7 선택 가능

---

## 11. 참고 파일

### 코드 (참조)

- 🎯 **`D:\Work\LAMDiceBot\output\bridge-cross\bridge-cross-game-mockup.html`** — 시각 source of truth (사용자 확정, 그대로 가져옴)
- **`socket/horse.js`** — 베팅 패턴 참조 (`selectHorse`, `unbetted_stop`, `bettedHorseIndices`)
- **`horse-race-multiplayer.html`** — 멀티플레이어 HTML 구조 + 베팅 UI 패턴
- `routes/api.js` — 라우트 등록
- `socket/index.js` — register 호출 위치

### 자산
- `assets/bridge-cross/sprites/` — sprite + manifest
- `assets/bridge-cross/stage/` — stage layer
- `assets/bridge-cross/asset-fix-list.md`
- `docs/asset/guide/bridge-cross.md`

### 공유 모듈
- `js/shared/chat-shared.js`, `ready-shared.js`, `order-shared.js`
- `assets/sounds/sound-manager.js`
- `docs/GameGuide/02-shared-systems/shared-modules.md`
- `docs/GameGuide/02-shared-systems/ORDER-MODULE.md`

### 가이드 / 규칙
- `.claude/rules/new-game.md` — 새 게임 추가 절차
- `.claude/rules/frontend.md`, `backend.md`
- `docs/GameGuide/03-games/horse-race.md` — 경마 게임 상세

### 회의록 (선행)

- `docs/meeting/applied/2026-04-26-bridge-cross-camera-impl.md` — 카메라 시스템
- `docs/asset/guide/bridge-cross-asset-alignment-request.md` — 자산 정합성
- 📝 **`docs/etc/2026-04-27-bridge-cross-integration-impl.txt`** — 이 impl 도출한 이전 세션 대화 요약 (사용자 결정 흐름, 시각 시행착오, 룰 결정 사유 등 컨텍스트)

---

## 12. 결정 사항 요약 (사용자 확정)

| # | 결정 |
|---|---|
| 1 | 유리 수 **N = 6 고정** |
| 2 | 도전 순서 고정: **빨주노초파남** (6색, 보라 제외) |
| 3 | 게임 시작 조건: 방 인원 ≥ 2명 |
| 4 | 베팅 마감 조건: 베팅 인원 ≥ 2명 |
| 5 | 캐릭터 = 유리 수와 동일 (**6명**) |
| 6 | 베팅: 중복 OK, 비공개 (게임 시작 시 공개) |
| 7 | 베팅 안 된 캐릭터: 시작 plat 정지 (경마 unbetted_stop 동등) |
| 8 | 통과: 활성 캐릭터 M명 중 K번째 균등 random |
| 9 | 시나리오 (K + safeRows + 각 캐릭터 행동): 서버 사전 결정 deterministic |
| 10 | 시각 source: `output/bridge-cross/bridge-cross-game-mockup.html` 목업 그대로 (default 값 §3.3.2 참조) |
