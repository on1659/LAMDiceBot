# Horse Race — 150ms Finish Gap Guarantee

- **작성일**: 2026-04-18
- **추천 구현 모델**: Sonnet (파일/라인 명시, 코드 위주)
- **트리아지**: COMPLEX (공정성 + 서버/클라/React 3파일)

## 1. 배경

경마는 클라이언트마다 **독립 시뮬레이션**으로 결승선을 그린다. 탭 전환/catch-up/프레임 편차로 인해 서버 순위와 시각적 결승 순서가 어긋날 수 있다.

수학적 결론 (2026-04-16 세션):
- 클라 `deltaTime` cap = 50ms → 두 클라 간 위치 오차 ≤ ±50ms
- 서버가 결승 gap ≥ 100ms 보장하면 순위 역전 불가
- **150ms = 100ms 이론 하한 + 50% 안전마진** (catch-up 대응)

## 2. 목표

**서버 rankings 순위 = 모든 클라이언트 화면 결승 순서 = React/Vanilla UI 표시 순위** (100% 일치).

## 3. 수정 대상

| 파일 | 수정 내용 |
|------|----------|
| `socket/horse.js` | baseDuration을 simFinishJudgedTime 순서로 재매핑 + 150ms gap 강제 |
| `horse-app/src/components/RaceResult.tsx` | `finishTime` 기준 재정렬 제거 |

## 4. 상수

`socket/horse.js` 파일 상단 `const` 블록에 추가:
```js
const MIN_FINISH_GAP_MS = 150;
```

## 5. 구체 변경

### 5.1 `socket/horse.js` L1515~1529 (simResults 정렬 직후)

**현재**:
```js
const simResults = horseStates.map(s => ({
    horseIndex: s.horseIndex,
    simFinishJudgedTime: s.finishJudgedTime || 60000,
    simFinishTime: s.finishTime || 60000,
    baseDuration: s.baseDuration
}));
simResults.sort((a, b) => a.simFinishJudgedTime - b.simFinishJudgedTime);

const rankings = simResults.map((result, rank) => ({
    horseIndex: result.horseIndex,
    rank: rank + 1,
    finishTime: result.baseDuration,
    speed: parseFloat((0.8 + Math.random() * 0.7).toFixed(2))
}));
```

**변경 후**:
```js
const simResults = horseStates.map(s => ({
    horseIndex: s.horseIndex,
    simFinishJudgedTime: s.finishJudgedTime || 60000,
    simFinishTime: s.finishTime || 60000,
    baseDuration: s.baseDuration
}));
simResults.sort((a, b) => a.simFinishJudgedTime - b.simFinishJudgedTime);

// ─── 150ms gap 보장: SSOT 확립 ───
// 조건: forcePhotoFinish 모드가 아닐 때만 적용 (접전 UX 보존)
if (!forcePhotoFinish) {
    // (a) baseDuration 값들을 simFinishJudgedTime 순서로 재매핑
    //     → "서버 1등 말 = 가장 작은 baseDuration" 보장
    //     → 클라 재시뮬도 같은 순서로 결승선 통과
    const sortedBase = simResults
        .map(r => r.baseDuration)
        .sort((a, b) => a - b);
    simResults.forEach((r, i) => { r.baseDuration = sortedBase[i]; });

    // (b) 150ms 이상 gap 강제 (순차적으로)
    //     unbetted_stop으로 60000ms cap된 말은 이미 충분히 떨어져 있음 → 영향 없음
    for (let i = 1; i < simResults.length; i++) {
        const minAllowed = simResults[i - 1].baseDuration + MIN_FINISH_GAP_MS;
        if (simResults[i].baseDuration < minAllowed) {
            simResults[i].baseDuration = minAllowed;
        }
    }
}

const rankings = simResults.map((result, rank) => ({
    horseIndex: result.horseIndex,
    rank: rank + 1,
    finishTime: result.baseDuration,
    speed: parseFloat((0.8 + Math.random() * 0.7).toFixed(2))
}));
```

### 5.2 `horse-app/src/components/RaceResult.tsx` L34

**현재**:
```tsx
// Sort rankings by finishTime
const sortedRankings = [...rankings].sort((a, b) => a.finishTime - b.finishTime);
```

**변경 후**:
```tsx
// 서버 rankings는 이미 rank 오름차순 (서버 SSOT)
const sortedRankings = rankings;
```

## 6. 예외 처리

| 케이스 | 처리 |
|--------|------|
| `forcePhotoFinish === true` (슬로모션 명령) | **150ms gap skip** — 접전 UX 보존 |
| `unbetted_stop`으로 60000ms cap된 말 | 자동으로 큰 gap 가짐 → 영향 없음 |
| `allSameBet` 5배 부스터 | baseDuration 조정으로 부스터 영향 없음 (곱셈이라 비례) |

## 7. 불변조건 (깨지면 안 됨)

- `rankings[]` 배열 순서: **rank 오름차순** (서버가 확정)
- `rankings[i].rank`: 1부터 시작하는 정수
- `rankings[i].finishTime`: baseDuration (ms) — React UI 초 단위 표시 (`/1000`)
- `speeds` 배열: `rankings.map(r => r.finishTime)` — 클라 재시뮬 입력
- `socket.emit('horseRaceStarted', raceData)` payload 스키마 변경 금지
- `recordVehicleRaceResult` 호출 시 rankings 구조 보존

## 8. 검증 체크리스트

### 정적 검증
- [ ] `node -c socket/horse.js` — 문법 체크
- [ ] `cd horse-app && npm run build` — React 빌드 성공
- [ ] `grep` 로 `rankings.sort` 또는 `finishTime - a.finishTime` 패턴이 남은 곳 없는지 확인

### 런타임 QA (수동 체크리스트)
1. **일반 경마**: 5인 방 생성 → 경마 시작 → 결승 gap 확인 (서버 로그에서 finishTime 차이 ≥ 150ms인지)
2. **슬로모션 명령** (`/슬로모션` 채팅): 1-2등 gap이 150ms 미만 (예: 100ms)로 좁혀지는지 — 접전 UX 살아있는지
3. **다중 클라이언트 동기**: 2탭 동시 관전 → 양쪽 화면 결승선 통과 순서 동일한지
4. **결과창 순위**: React 앱(`/horse-race`) 결과 UI에서 `1등, 2등, 3등...` 서버 rank 순서로 표시되는지
5. **다시보기**: replay 재생 시에도 결승 gap 보존되는지 (speeds 배열에 조정된 값이 들어가므로 자연 반영)
6. **배팅되지 않은 말 있는 방**: unbetted 말이 60000ms로 cap되는지, 배팅된 말들 간 150ms gap 유지되는지

### 크로스게임 영향
- 주사위/룰렛: 영향 없음 (socket/horse.js만 수정)

## 9. 커밋 메시지 예시

```
fix(horse): 서버-클라 순위 일치 보장 - 결승 gap 최소 150ms 강제

- baseDuration을 simFinishJudgedTime 순서로 재매핑 (SSOT 확립)
- 150ms gap 강제로 클라이언트 간 순위 역전 방지 (이론 하한 100ms + 50% 여유)
- horse-app RaceResult.tsx 재정렬 제거 — 서버 rankings 그대로 사용
- forcePhotoFinish 모드는 skip (접전 UX 보존)
```

## 10. 관련 세션/문서

- 2026-04-16 세션 (`908abde6-96ae-4ee1-94cc-828582d50644`) — deltaTime cap 분석, 100ms 이론 하한 도출
- Scout 정찰 (2026-04-18) — 영향 범위 분석
- ScoutCodex 정찰 (2026-04-18) — horse-app RaceResult 재정렬 발견, 순위 역전 가능성 경고
