# Horse Race — Evolution Gimmick

- **작성일**: 2026-04-22
- **추천 구현 모델**: Opus (설계 판단, 다파일 연계, 동기화 안전성)
- **트리아지**: COMPLEX (서버 시뮬레이션 + 클라이언트 이펙트 + 스프라이트 + 공정성)

## 1. 배경

경마 레이스에서 꼴찌/하위권 말은 중반 이후 관전 흥미가 떨어진다.
"역전 가능성"을 시각적으로 극대화하는 기믹이 필요하다.

### 기존 인프라
- **기믹 시스템**: sprint(가속), stop(정지), wobble(지그재그) — `progressTrigger` + `speedMultiplier` + `duration`
- **power SVG 시스템**: `getVehiclePowerSVG()` — 오라(radialGradient) + 글로우(dropShadow) + 스파크 자동 래핑
- **POWER_VEHICLE_PALETTES**: 탈것별 고유 색상 (glow/spark/core) 이미 정의
- **슬로우모션**: 선두 결승선 15m 이내 발동 (factor 0.4), 1등 finishJudged 시 해제
- **과거 버그**: 서버/클라이언트 슬로우모션 발동 타이밍 불일치 → 도착순서 ≠ 서버순위 (7d71c92에서 수정)

## 2. 목표

꼴찌/하위권 말에게 레이스 중반에 **진화 이펙트 + 장거리 부스터**를 부여한다.
공정성 불변 — 서버 seed 기반 사전 시뮬레이션 결과가 최종 순위.

## 3. 핵심 제약

### 3.1 공정성 불변
- Evolution 포함 상태로 서버가 시뮬레이션 → 순위 확정 → 클라이언트는 재생만
- Evolution이 결과를 "바꾸는" 게 아니라, 결과에 이미 "포함"되어 있음

### 3.2 슬로우모션 구간 격리
- **Evolution 발동 가능 구간: 진행률 40%~70%**
- 슬로우모션 발동 구간 (결승선 15m 이내 ≈ 진행률 97%+) 과 구조적으로 겹치지 않음
- Evolution duration이 70% 이후까지 이어질 수 있으나, speedMultiplier는 끝남 → 슬로우모션과 동시 속도 조작 없음

### 3.3 기존 기믹과 배타적
- Evolution 활성 중 다른 기믹(sprint, stop, wobble) 발동 안 함
- Evolution 대상 말에게는 40%~70% 구간에 다른 기믹을 배정하지 않음

## 4. 스프라이트 시스템

### 4.1 네이밍 규칙
```
{vehicleId}        → 기본 SVG (getVehicleSVG)
{vehicleId}_power  → 파워업 SVG (별도 스프라이트)
```

### 4.2 초기 구현
- `{id}_power` 스프라이트가 없으면 기본 SVG + 오라 래핑(`applyPowerUpAuraToSVG`)으로 대체
- 이후 Codex가 탈것별 power 스프라이트를 별도 제작

### 4.3 수정 대상
| 파일 | 내용 |
|------|------|
| `js/horse-race-sprites.js` | `{id}_power` 키 추가, `getVehiclePowerSVG()` fallback 로직 유지 |

## 5. 서버 구현 (Phase 1)

### 5.1 상수 (`socket/horse.js` 상단)
```js
const EVOLUTION_CONFIG = {
    progressMin: 0.40,        // 발동 가능 시작 진행률
    progressMax: 0.70,        // 발동 가능 종료 진행률
    checkProgress: 0.50,      // 하위권 판별 시점 (50% 지점)
    rankThreshold: -1,        // 하위 몇 등까지 (-1 = 꼴찌만, -2 = 꼴찌+꼴찌직전)
    speedMultiplier: 2.2,     // 부스터 배율
    durationMs: 3000,         // 부스터 지속 시간 (ms)
    probability: 0.6,         // 발동 확률 (60%)
};
```

### 5.2 시뮬레이션 내 Evolution 삽입
`calculateHorseRaceResult()` 시뮬레이션 루프 내:

```
진행률 50% 도달 시 (1회만):
  1. 모든 말의 currentPos 비교 → 순위 산출
  2. 꼴찌 말 식별 (배팅된 말만 대상)
  3. seed 기반 확률 판정 (EVOLUTION_CONFIG.probability)
  4. 통과 시 → 해당 말의 gimmicks 배열에 evolution 기믹 추가:
     {
       type: 'evolution',
       progressTrigger: 0.55,  // 50% 판별 후 55%에서 실제 발동
       speedMultiplier: EVOLUTION_CONFIG.speedMultiplier,
       duration: EVOLUTION_CONFIG.durationMs,
       triggered: false,
       active: false
     }
  5. 해당 말의 40%~70% 구간 기존 기믹 제거 (충돌 방지)
```

### 5.3 클라이언트 전달
기존 `gimmicksData`에 evolution 기믹이 포함된 채로 전달.
별도 이벤트 불필요 — 기존 기믹 파이프라인 그대로 사용.

추가 필드: `raceData.evolutionTargets = [horseIndex]` (클라이언트 이펙트 트리거용)

## 6. 클라이언트 이펙트 (Phase 2)

### 6.1 3단계 시각 흐름

| 단계 | 이름 | 타이밍 | 시각 효과 | 구현 |
|------|------|--------|-----------|------|
| 1 | Charge (예고) | 발동 1.5초 전 | 말 주변 맥동, 미세 떨림 | CSS `@keyframes pulse` |
| 2 | Burst (변신) | 발동 시점 | 강한 빛 폭발, 스프라이트 → power 교체 | CSS `brightness(3) blur(2px)` → SVG swap |
| 3 | Evolved (질주) | 발동 ~ duration 종료 | power 스프라이트 + 강화 잔상 + 오라 | sprint 잔상 재활용 + hue-rotate |

### 6.2 CSS 클래스
```css
.evolution-charge { animation: evo-pulse 0.4s infinite alternate; }
.evolution-burst  { animation: evo-burst 0.5s ease-out; }
.evolution-run    { filter: drop-shadow(0 0 6px var(--evo-glow)); }

@keyframes evo-pulse {
    from { filter: brightness(1); }
    to   { filter: brightness(1.4) drop-shadow(0 0 4px gold); }
}
@keyframes evo-burst {
    0%   { filter: brightness(3) blur(2px); transform: scale(1.3); }
    100% { filter: brightness(1) blur(0); transform: scale(1); }
}
```

### 6.3 카메라 연동
- Evolution Charge 시작 시 → 카메라 강제 컷어웨이 (해당 말로)
- Burst + Evolved 질주 1~2초 추적 후 원래 카메라 로직 복귀
- 기존 `selectRandomCutawayTarget()` 로직과 분리된 우선순위 컷어웨이

### 6.4 스프라이트 교체
```js
// animLoop 내 evolution 기믹 활성화 시
if (gimmick.type === 'evolution' && gimmick.active) {
    const powerSVG = getVehiclePowerSVG(vehicleId);
    // 또는 getVehicleSVG(vehicleId + '_power') fallback
    horseElement.innerHTML = currentFrame === 1 ? powerSVG.run.frame1 : powerSVG.run.frame2;
}
```

### 6.5 모바일 대응
- 이펙트는 CSS filter 기반 → GPU 합성 레이어(`will-change: transform, filter`)
- 파티클 효과는 별도 div 오버레이, 메인 트랙과 z-index 분리
- 복수 Evolution 동시 발동 시 0.5초 딜레이 분산

## 7. UX 설계

### 7.1 사용자 인지
- 레이스 룰/도움말에 한 줄 추가: "하위권 말에게 역전 기회가 발동될 수 있습니다"
- 구체적 조건(확률, 배율)은 비공개 — 긴장감 유지

### 7.2 기대 왜곡 방지 (현우 옵션 C 채택)
- **Evolution 이펙트는 실제로 순위 상승한 말에게만 표시**
- 서버 시뮬레이션 완료 후 → evolution 기믹이 삽입된 말의 최종 순위가 발동 시점 순위보다 상승했는지 확인
- 상승 안 했으면 `evolutionTargets`에서 제외 (기믹 speedMultiplier는 유지, 이펙트만 제거)
- 결과: Evolution 발동 = 반드시 역전 장면 → 사용자 신뢰 유지

## 8. 다시보기(Replay) 대응

### 8.1 라이브 vs 다시보기 연출 차이

| 요소 | 라이브 | 다시보기 |
|------|--------|----------|
| 속도 변화 (speedMultiplier) | **O** | **O** |
| 카메라 강제 컷어웨이 | **O** | **O** |
| 글로우 (drop-shadow) | **O** | **O** |
| Charge 예고 이펙트 | O | X |
| Burst 변신 이펙트 | O | X |
| power 스프라이트 교체 | O | X |

- 속도 변화 / 카메라 컷어웨이 / 글로우는 **라이브·다시보기 공통** (필수)
- Charge → Burst → power 스프라이트 풀 연출은 **라이브 전용**
- **목적**: 라이브 관전 가치 차별화 — "실시간으로 봐야 진화 장면을 볼 수 있다"

### 8.2 구현
- `startRaceAnimation`의 `trackOptions`에 `isReplay` 플래그 추가
- 다시보기 호출부(L3602, L3671)에서 `{ ...trackOptions, isReplay: true }` 전달
- animLoop 내 evolution 분기:
```js
if (gimmick.type === 'evolution' && gimmick.active) {
    if (!isReplay) {
        // 풀 연출: Charge → Burst → power 스프라이트 교체 + 카메라 컷어웨이
    } else {
        // 글로우만: CSS drop-shadow 추가
    }
}
```
- **부수 효과**: replay 비결정론적 버그(MEMORY 기록)와 완전 분리, 이펙트 동기화 이슈 없음

## 9. 테스트 계획

### 9.1 서버 단위 테스트
- 같은 seed 10회 시뮬레이션 → Evolution 대상, 발동 시점, 최종 순위 100% 동일
- Evolution 발동 후 순위가 변경된 경우 / 변경되지 않은 경우 모두 검증
- 기존 기믹(sprint, stop, wobble) + Evolution 동시 존재 시 충돌 없음

### 9.2 클라이언트 검증
- Evolution 이펙트 발동 시 → 해당 말이 실제로 순위 상승하는 화면 확인
- 슬로우모션 구간에서 Evolution 이펙트 잔재가 남아있지 않은지 확인
- 모바일/PC 양쪽에서 프레임 드랍 없는지 확인
- 카메라 컷어웨이가 Evolution 이펙트를 완전히 보여주는지 확인

### 9.3 동기화 검증
- 2탭 동시 관전 → 두 화면에서 Evolution 발동 타이밍/대상 동일
- Evolution 발동 구간(40~70%)이 슬로우모션 구간(97%+)과 겹치지 않음 확인

## 10. 단계별 배포

| Phase | 내용 | 범위 | 롤백 범위 |
|-------|------|------|-----------|
| 1 | 서버 시뮬레이션에 Evolution 기믹 삽입 + seed 재현성 검증 | `socket/horse.js` | 서버만 |
| 2 | 클라이언트 이펙트 + 스프라이트 교체 + 카메라 연동 | `js/horse-race.js`, `js/horse-race-sprites.js`, CSS | 클라이언트만 |
| 3 | QA 통과 + 배포 | 전체 | — |

## 11. 수정 대상 파일 요약

| 파일 | Phase | 수정 내용 |
|------|-------|----------|
| `socket/horse.js` | 1 | EVOLUTION_CONFIG 상수, 시뮬레이션 내 evolution 삽입 로직 |
| `js/horse-race-sprites.js` | 2 | `{id}_power` 키 지원, fallback 로직 |
| `js/horse-race.js` | 2 | evolution 이펙트 렌더링, 카메라 컷어웨이, CSS 클래스 토글 |
| `horse-race-multiplayer.html` | 2 | evolution CSS keyframes 추가 |

## 12. 미결 사항

- [ ] `EVOLUTION_CONFIG` 수치 튜닝 (probability, speedMultiplier, duration) — 실제 플레이 테스트 후 조정
- [ ] 복수 말 동시 Evolution 허용 여부 (현재: 꼴찌 1마리만)
- [ ] power 스프라이트 별도 제작 일정 (Codex 담당)
- [ ] replay 비결정론적 버그와의 관계 정리
