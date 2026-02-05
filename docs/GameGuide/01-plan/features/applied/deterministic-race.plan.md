# Plan: 결정적 레이스 애니메이션 (Deterministic Race Animation)

## 목표
호스트가 시작을 누르는 순간, 레이스의 모든 시나리오를 서버에서 확정하여 전송.
모든 클라이언트가 동일한 결과를 보고, 다시보기도 항상 같은 결과를 재현.

## 현재 상태 분석

### 이미 결정적인 부분 (서버에서 전송)
- `horseRankings`: 최종 순위
- `speeds`: 각 말의 총 소요시간(duration)
- `serverGimmicks`: 가속/감속 이벤트 (progressTrigger, type, duration, speedMultiplier)
- 속도 변화: **시드 기반 LCG** (line 2783-2798) - `horseIndex`와 `elapsed`로 결정적

### 클라이언트마다 달라질 수 있는 부분
| 항목 | 위치 | 원인 |
|------|------|------|
| 프레임 타이밍 | `setInterval(16ms)` + `Date.now()` | 클라이언트 성능/부하 |
| 초기 속도 팩터 | line 2638 `horseIndex * 1234567` | 결정적이지만 서버와 무관 |
| 배경 장식 위치 | `createLane()` 내 `Math.random()` | 별/구름/당근 위치 |
| 꽃가루 효과 | `createConfetti()` 내 `Math.random()` | 시각 효과 |

### 핵심 발견
속도 변화 LCG가 `elapsed` (밀리초)에 의존함:
```js
const currentInterval = Math.floor(elapsed / 500);
const speedSeed = (state.speedChangeSeed + currentInterval) * 16807 % 2147483647;
```
→ `elapsed`가 클라이언트마다 미세하게 달라도, 500ms 단위로 반올림하므로 대부분 같은 결과.
→ 하지만 경계 타이밍에서 1프레임 차이 가능.

## 해결 방안

### 접근: 논리적 프레임 기반 애니메이션 (Logical Frame)

`Date.now()` 대신 **논리적 프레임 카운터**를 사용.
매 `setInterval` 호출마다 `frameCount++`하고, `elapsed = frameCount * 16`으로 계산.

이렇게 하면:
- 실제 시간에 무관하게 모든 클라이언트가 같은 `elapsed` 값을 가짐
- 기믹 트리거, 속도 변화, 위치 계산이 모두 동일
- 다시보기도 동일한 프레임 시퀀스 재생

### 변경 사항

#### 1. 서버 측 (server.js)
- 변경 없음. 이미 `rankings`, `speeds`, `gimmicks`를 보내고 있음
- (선택) `raceSeed` 값을 추가 전송하여 장식용 랜덤도 통일 가능

#### 2. 클라이언트 측 (horse-race-multiplayer.html)

**A. 애니메이션 루프 변경** (line 2665-2671)
```js
// Before
const startTime = Date.now();
const elapsed = Date.now() - startTime;

// After
let frameCount = 0;
const elapsed = frameCount * frameInterval; // 논리적 시간
frameCount++;
```

**B. 초기 속도 팩터** (line 2638)
- 현재도 `horseIndex` 기반이라 결정적. 변경 불필요.

**C. 배경 장식 (createLane 내 Math.random)**
- 시각적 장식이므로 레이스 결과에 무관. 변경 불필요.
- (선택) 통일하려면 시드 기반 난수로 교체 가능.

**D. 다시보기 (playReplay)**
- 현재 `startRaceAnimation`을 그대로 호출하므로, 위 변경이 자동 적용됨.

### 변경 범위 요약

| 파일 | 변경 | 영향도 |
|------|------|--------|
| `horse-race-multiplayer.html` | 애니메이션 루프: `Date.now()` → 논리적 프레임 카운터 | 핵심 |
| `server.js` | 없음 | - |

## 리스크

- `setInterval(16ms)`이 실제로 16ms마다 정확히 호출되지 않을 수 있음.
  → 하지만 논리적 프레임이므로 호출 간격이 달라도 **계산 결과는 동일**.
  → 느린 기기에서는 애니메이션이 느리게 보일 수 있지만, 결과는 같음.

## 검증 방법
1. 두 브라우저에서 동시에 같은 방 입장 후 레이스 시작
2. 결승선 도착 순서 + 순위 텍스트 동일 확인
3. 다시보기 2회 실행하여 동일한 애니메이션 확인
4. 느린 기기(throttle CPU)에서도 순위 동일 확인
