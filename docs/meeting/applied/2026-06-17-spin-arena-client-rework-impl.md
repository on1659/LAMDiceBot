# impl: spin-arena 클라이언트 재단순화 (lowest-damage 2단계)

> 출처 goal: `docs/goal/spin-arena-resimplify-lowest-damage.md` (서버/테스트는 이미 구현 완료).
> 이 문서 = **클라이언트(`js/spin-arena.js`, `spin-arena-multiplayer.html`) 재작성**의 source of truth.
> 서버 `socket/spin-arena.js`는 이미 새 모델로 재작성됨 — 클라는 새 reveal payload를 소비하도록 맞춘다.

## 모델 한 줄 요약
- **단일 단계(n<6)**: 30초 데미지 레이스 → 최저 누적 데미지 = 당첨. 결승 없음.
- **2단계(n≥6)**: 30초 데미지 레이스(전원, 탈락 없음) → 최저 데미지 **하위 3명** 결승(축소 링 서든데스, 첫 HP 0 = 당첨). 나머지는 안전(승자).

## 1. 새 reveal payload (서버가 이미 보냄 — 클라가 맞출 대상)

```
{
  twoStage: bool,            // true(n≥6) | false(n<6)   ← 기존 `rule` 대체
  durationMs, decideMs,      // decideMs는 이제 절대 null 아님(HP-lowest fallback 보장)
  round1EndMs,               // Stage1 종료 시각(2단계만; 단일 단계 = null)  ← 단계 경계 신호(필드명 유지)
  sampleMs,
  arena: { w, h, cx, cy, r },
  ring: { rStart:220, rEnd:60, stage1End:150, introMs:8000, shrinkMs:6500 },   ← 형태 변경(phase1Ms/phase2Ms/shrink2Ms 제거)
  slots: [{ id, isBot, name, skinId, color, blade, tier, bladeCount, bladeRadius, baseAngle, spinSpeed, spinDir }],
  frames: [[x,y,c]...],      // c = dealt = "다른 플레이어에게 입힌 누적 데미지"(점수/리더보드 지표, 단조 증가)
  hpFrames: [[hp...]],       // stride 1, length === frames.length. 결승 HP바용. Stage1 동안 = HP_MAX(100) 불변
  hpMax: 100,
  finalists: [slotId...],    // 결승 진출 슬롯ID 배열(2단계=3개; 단일 단계=[])   ← NEW
  geom: { scale, charRadius, bladeRadius, swordLen, bladeEdgeR, spawnR },
  result: { selected, rankings:[{name,slotId,rank,escapeMs:null}], successionList:[names worst→best] }
}
```

**제거된 필드(서버가 더 이상 보내지 않음)**: `rule`, `monsterFrames`, `escapes`, `downs`, `staggers`, `monsterKills`, `monsters`. → 클라에서 이 필드를 읽는 코드는 전부 제거.

## 2. ringRadiusAt — 서버와 **반드시 비트 동일** (새 시그니처 `(t, round1EndMs)`)

```js
function ringRadiusAt(t, round1EndMs) {
  if (round1EndMs == null) {                         // 단일 단계 전체 / 2단계 Stage1 진행 중
    const k = Math.min(1, Math.max(0, t / STAGE1_MS));
    return RING_R_START + (STAGE1_RING_END - RING_R_START) * k;
  }
  if (t < round1EndMs) {                             // 2단계 Stage1
    const k = Math.min(1, Math.max(0, t / round1EndMs));
    return RING_R_START + (STAGE1_RING_END - RING_R_START) * k;
  }
  if (t < round1EndMs + ROUND2_INTRO_MS) return RING_R_START;   // 인트로(집결)
  const k = Math.min(1, (t - (round1EndMs + ROUND2_INTRO_MS)) / RING2_SHRINK_MS);   // 결승 수축
  return RING_R_START + (RING_R_END - RING_R_START) * k;
}
```
- **모든 `ringRadiusAt(t, rule, round1EndMs)` 호출부에서 rule 인자 제거** → `ringRadiusAt(t, round1EndMs)`.
- **미러 상수 갱신**: `GAME_MS = 60000`(현재 60000으로 이미 일치하나 주석/근거 갱신), `STAGE1_MS = 30000`(신규), `ROUND2_INTRO_MS = 8000`, `RING2_SHRINK_MS = 6500`, `RING_R_START = 220`, `RING_R_END = 60`, `STAGE1_RING_END = 150`(신규), `HP_MAX = 100`. (서버 socket/spin-arena.js 값과 동일해야 함.)

## 3. 단계 판정 (rule 분기 ~30곳을 이걸로 대체)

```js
const twoStage = payload.twoStage;
const r1 = payload.round1EndMs;                       // null이면 단일 단계
const finalistSet = new Set(payload.finalists || []);
function stageAt(t) {
  if (r1 == null) return 'stage1';                    // 단일 단계는 전체가 stage1
  if (t < r1) return 'stage1';
  if (t < r1 + introMs) return 'intro';               // 결승 집결 + 3·2·1
  return 'finale';
}
const isFinalist = (slotId) => finalistSet.has(slotId);   // 2단계 결승 진출자
const isSafe = (slotId) => twoStage && !finalistSet.has(slotId);  // 2단계 안전(승자) — 결승에서 숨김/페이드
```
- 기존 `rule === 'monster-race'` / `rule === 'battle-royale'` 분기 전부 위 단계 판정으로 치환.
- 기존 round1/round2 명칭은 Stage1/결승으로 재해석. **round1EndMs를 단계 경계로 쓰는 기존 인프라(전환 FX·블랙아웃·3·2·1 카운트다운)는 살려서 재활용**(통째 삭제 금지).

## 4. 제거 대상 (새 모델에서 죽은 코드 — 데이터가 안 오므로 안전하게 제거)

scout 보고 라인 기준(코더가 현재 라인 재확인):
- **몬스터 렌더 전부**: `SPIN_MON_COLS`, `buildSpinMonsterSprite`, `loadSpinMonsterSprite`(IIFE), `drawMonster`, drawSpinFrame §1.7 몬스터 보간(~2189-2215)·§1.75 히트FX(~2217-2246)·§1.8 kill FX(~2248-2262)·몬스터 그리기 호출(~2379-2399), `_monState`/`_monHit` 사전할당. `monsterFrames`/`monsters`/`monsterKills` 모든 소비.
- **탈출(escape) FX**: `_escapeMs`, `slotFx[i].escX/escY`, escape 기반 cut/rank/danger-clock/recap. `escapes` 모든 소비.
- **다운/부활 FX**: `_downs`, 묘비 그리기(~2429-2473), 다운/부활 FX(~2086-2135). `downs` 모든 소비.
- **경직(stagger) FX**: `_staggers`, 머리 위 경직 프로그래스바(~2137-2162). `staggers` 모든 소비.
- **near-miss 자동 리플레이**: `spinNearMissWindow`(~1765-1784), `nmActive`/`nmDone`/`nmEndMs`, near-miss 캡션(~2789-2799), 종료 블록(~2801-2827), `NEARMISS_*` 상수(~640-641). (`endSpinReplayToResult`는 단일 종료 경로로 유지.)
- **death-cam / showdown / 슬로모**: `DEATHCAM_*`·`ZOOM_FIT_SHOWDOWN`(~609-622), 슬로모 타임워프(`_warpAccum`, drawSpinFrame ~2024-2035), death-cam 컷(buildCutSchedule ~1316-1323), showdown 줌/`showdownStartT`(~2349-2352, ~2887-2895). → **§6 결승 프레이밍으로 대체**.
- **카메라 모드 토글**: `setSpinCameraMode`/`updateSpinCameraButtons`/`setSpinCameraBarVisible`(~1789-1824), `spinCameraTarget`의 follow/director/roam/overview 모드 분기(~1378-1427). HTML `#spinCameraBar` + 버튼 3개(~222-226). → **§6 단일 자동 카메라로 대체**.
- **monsters-base.png** 로드/참조 전부.

> 주의: 제거는 "조용한 무효화"라 크래시는 안 나지만, **드로 호출이 남으면 함수 미정의로 throw** 가능. drawMonster 등은 호출부와 정의부를 **함께** 제거할 것. 제거 후 `node -c js/spin-arena.js` + grep로 잔존 확인.

## 5. 유지 + 적응

- **리플레이 코어**: 키프레임 보간(slot x/y/c), `startSpinReplay`, rAF 루프, 3·2·1 카운트다운(시작), `endSpinReplayToResult`(단일 종료 경로). 유지.
- **캐릭터/칼날 그리기**(`drawCharSprite`, 칼날 세그먼트, 파티클, 히트판정 FX). 유지.
- **데미지 숫자 플로터**: `c`(dealt) 증가분으로 구동 — 입힌 쪽 머리 위 "+N"(Stage1 피드백 "점수 쌓는 중"). 기존 c-delta 플로터 패턴 재사용.
- **리더보드**:
  - Stage1(+단일 전체): `c`(=dealt) 기준 정렬 표시. **하위 3명(최저 dealt)을 "위험"으로 강조**(단일 단계는 최하위 1명 = 당첨 위험). 기존 `updateSpinScoreboard`(c 기준 정렬) 재사용, escape/down/임계 상태 표기는 제거.
  - 결승: 결승 3인 HP바(hpFrames) 표시. 기존 `updateSpinHpPanel` 재사용, 결승 3인만.
  - 리더보드 churn-free 규칙(노드 위치 고정, 텍스트/클래스만 갱신) 유지(lessons 2026-06-13).
- **HP바**: 결승에서만 결승 3인 머리 위. Stage1은 HP바 없음(HP 불변 — dealt 리더보드가 메인). hpFrames/hpMax 소비 유지.
- **미션/상태 텍스트**:
  - Stage1(2단계): "💥 많이 칠수록 안전! 최하위 3명이 결승행"
  - Stage1(단일): "💥 많이 칠수록 안전! 최하위가 당첨"
  - 결승: "⚔️ 결승! 먼저 쓰러지면 당첨"
  - 평이한 한국어(당첨/안전/위험). raw "loser/winner" 노출 금지.

## 6. 결승 비주얼 프레임 (추가하는 단 하나의 레이어)

- **전환(round1EndMs 시점)**: 짧은 블랙아웃/플래시 + "결승전" 카드(결승 3인 이름·색). 기존 round1→2 전환 FX(블랙아웃) 재활용 → 결승 3인 표시로 적응.
- **인트로(round1EndMs → +introMs=8000)**: "상위 N명 안전!" 요약 + 결승 3인 강조 → 3·2·1 카운트다운. 기존 round2 인트로 3·2·1 재활용. escape/순위표 기반 recap 부분은 제거하고 finalists 기반으로 교체.
- **결승 본편**: 카메라가 결승 3인을 화면에 맞춰 줌(타이트). **안전(비결승) 플레이어는 페이드/숨김**.
- **클라이맥스**: 결승자 HP가 0이 되는 순간(hpFrames에서 보임) = 당첨자. (slowmo/death-cam 없이 자연 재생 — 줌 프레이밍이 드라마를 담당.)

## 7. 카메라 (단순화 — 단일 자동 줌, 모드/토글 없음)

- 결정론 함수 `cameraFit(t, stage, frame, finalists)` 하나로 대체:
  - `stage1`: 링 전체(모쉬핏 오버뷰)에 맞춤 — 중심=arena 중앙, 줌=링 반경이 화면에 들어오게.
  - `intro`/`finale`: 결승 3인의 bounding box에 맞춤(타이트 줌). 3인 좌표 평균=중심, 퍼짐에 맞춰 줌.
- `Math.random` 0회(결정론). 카메라 흔들림(shake)이 필요하면 `hash01(t)` 같은 결정론 PRNG만.
- 기존 카메라 변환 코드(drawSpinFrame ~2366-2377)는 유지하되 타깃/줌 산출만 위 단일 함수로 교체.

## 8. HTML (spin-arena-multiplayer.html)

- `#spinCameraBar` + 카메라 버튼 3개(~222-226) 제거.
- 튜토리얼: 몬스터/카메라/24인 단계(~493-505) 제거 또는 2단계 모델로 교체(30초 데미지 레이스 → 하위 3명 결승). 일반 단계는 유지.
- 메타/og/description/JSON-LD/본문 SEO 카피(~16-25, 54, 419, 495)에서 몬스터/탈출/듀얼룰/24인 표현 제거 → "30초 데미지 레이스 → 하위 3명 결승" 카피로.
- **필수 DOM ID 전부 유지**: loadingScreen, controlBarMount, usersSection/usersList/usersCount, dragHint, readySection/readyUsersList/readyCount/readyButton, spinSkinPicker, spinShopMount, hostControls/startSpinButton, gameStatus, spinArenaWrap, spinCanvasBox/spinArenaCanvas, raceChatOverlay, spinReplayBtn, chatMessages/chatInput, historySection/historyList, resultOverlay/resultRankings, passwordModal/roomPasswordInput.
- AdSense 블록 삭제 금지(주석 박힘). 스크립트 로드 순서(spin-shop.js → spin-arena.js) 유지.

## 9. 불변조건 (절대 깨지면 안 됨)

- 클라 gameplay `Math.random` = 0 (deviceId/tabId/cosmetic hash01만). 작업 후 grep 검증.
- 클라는 frames/hpFrames를 t로 보간만 — 서버 사전시뮬이 결과 권위.
- 2탭 byte-identical: 모든 클라(참가자+관전자)가 같은 reveal로 같은 화면.
- 공유모듈 init(Chat/Ready/Order/Ranking/Sound/Tutorial/ControlBar), 꾸미기 상점(SpinShop), 필수 DOM ID 유지.
- 결과 표시는 `gameEnd.selected`(서버 권위) 사용. reveal.result는 리플레이 클라이맥스용.
- `selected`가 null일 수 있음(2단계서 결승 3인 전원 이탈 — 극단 엣지) → "당첨자 없음" 안전 처리(크래시 금지).

## 10. 검증 (코더가 수행)

- `node -c js/spin-arena.js` 통과.
- grep 0건: `monsterFrames`, `escapes`, `downs`, `staggers`, `monsterKills`, `\.rule\b`(payload.rule), `drawMonster`, `nmActive`, `spinNearMissWindow`, `spinCameraBar`, `monsters-base`, `DEATHCAM`, `setSpinCameraMode`.
- `Math.random` grep = deviceId/tabId 생성만(gameplay 0회).
- 보간/단계 판정 로직이 단일/2단계 모두 커버하는지 코드 리뷰.
- (브라우저 QA는 이후 단계 — 2탭 테스트 + 수동 체크리스트.)
