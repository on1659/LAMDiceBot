# Ahead Indicator — Implementation Document

> 기획 회의록: [2026-02-27-1700-horse-ahead-indicator.md](../plan/single/2026-02-27-1700-horse-ahead-indicator.md)
> Recommended model: **Opus** (설계 판단 필요 — 뷰포트/카메라 관계 이해, 좌우 분기 재설계)

## Summary

Add an "ahead indicator" to each lane — the mirror of the existing `offscreenIndicator`.
When a horse is off-screen to the **right**, show a fixed label on the **right edge
of the viewport** in that horse's lane. Also add 😴 display for sleeping (not started)
horses on the **left** side.

## Known Issues (구현 시도 후 발견)

### Issue 1: 오른쪽 인디케이터가 leader 모드에서 절대 안 보임

**원인**: 뷰포트 기반 판정 `horseDisplayPos > trackWidth`를 사용했으나,
leader 모드에서 카메라가 1등을 추적하면:
- 1등의 `horseDisplayPos ≈ centerPosition` (350px 모바일 / 350px PC)
- 1등보다 앞선 말은 물리적으로 없음
- **어떤 말도 `trackWidth(700px)`을 넘지 않음** → 인디케이터 절대 불가

오른쪽 밖이 발생하는 경우:
- ✅ `myHorse` 모드: 내 말이 꼴등이면 1등이 오른쪽 밖
- ✅ `_loser` 모드: 꼴등 추적 중 앞선 말들이 오른쪽 밖
- ✅ 랜덤 컷어웨이: 중위권 말 추적 중 1등이 오른쪽 밖
- ❌ **leader 모드 (기본)**: 1등 추적 → 오른쪽 밖 불가능

**영향**: 기본 카메라 모드에서 기능이 완전히 무의미.

### Issue 2: 왼쪽 쉬는 말 😴 표시 없음

**원인**: 기존 `offscreenIndicator`는 출발 안 한 말에 대한 특별 표시가 없음.
`isOffscreen && !state.finished` 조건으로 `◀ Xm`만 표시.
출발 안 한 말이 왼쪽 밖에 있으면 `◀ 490m` 같은 거리만 보임 — 😴 표시 안 됨.

### Issue 3: 출발 안 한 말이 오른쪽 밖에 올 수 없음

**원인**: 출발 안 한 말의 `currentPos ≈ startPosition(10)`.
카메라가 앞으로 이동하면 `bgScrollOffset`이 음수 → `horseDisplayPos = 10 + (음수)` → **항상 왼쪽 밖**.
출발 안 한 말이 오른쪽 밖에 있는 시나리오는 물리적으로 불가능.
따라서 오른쪽 전용 😴 분기는 절대 실행되지 않음.

## 이전 시도 이력

### 시도 1: cameraTarget 기반 (최초 impl)

```js
const isAhead = state.currentPos > cameraTarget.currentPos;
if (isCameraTarget || !isAhead) { hide }
```

- `cameraTarget` 호이스팅 필요 (else 블록 스코프 문제)
- **실패**: leader 모드에서 `cameraTarget = leaderState` → 모든 말이 behind → 전부 숨김

### 시도 2: 뷰포트 기반 (현재)

```js
const isOffRight = horseDisplayPos > trackWidth;
if (!isOffRight) { hide }
```

- `cameraTarget` 호이스팅 불필요
- **실패**: leader 모드에서 어떤 말도 오른쪽 밖으로 안 나감 (Issue 1)
- 😴 분기에 도달 불가능 (Issue 3)

## 해결 방향 (미구현)

위 이슈들을 해결하려면 **양방향 통합** 접근이 필요:

### 방향 A: offscreenIndicator 확장

기존 offscreenIndicator에 상태별 분기 추가 (왼쪽 밖 + 오른쪽 밖 통합):
- 왼쪽 밖 + 달리는 중 → `◀ Xm` (기존)
- 왼쪽 밖 + 출발 안 함 → `😴` (신규)
- 왼쪽 밖 + 완주 → `🏁N등` (신규)
- 오른쪽 밖 + 달리는 중 → `Xm ▶` (신규)
- 오른쪽 밖 + 완주 → `🏁N등` (신규)

### 방향 B: 기준 재설계

화면 밖 여부 + 1등 대비 위치를 조합:
- 화면에 안 보이는 모든 말에 대해 인디케이터 표시
- 왼쪽/오른쪽 위치는 말의 `horseDisplayPos` 부호로 판단
- 표시 내용은 상태에 따라 분기

## 현재 코드 상태

`js/horse-race.js`에 ahead indicator 코드가 삽입되어 있으나 위 이슈들로 인해
leader 모드에서 동작하지 않음. 왼쪽 😴도 미구현.

## Existing Reference: offscreenIndicator

File: `js/horse-race.js`

### 기존 코드 (line ~2381)

```js
if (isOffscreen && !state.finished) {
    const distBehind = Math.round((leaderPos - state.currentPos) / PIXELS_PER_METER);
    state.offscreenIndicator.innerHTML = `◀ ${distBehind}m`;
    state.offscreenIndicator.style.display = 'block';
    state.horse.style.left = `-200px`;
    state.horse.style.visibility = 'hidden';
} else {
    state.offscreenIndicator.style.display = 'none';
    // ...
}
```

### Key facts

1. **lane width is NOT viewport width** — `track.style.width` = `finishLine + viewportBuffer`
   (e.g. 5400px). `right: 2px` on a lane = 5398px from left — NOT visible.

2. **`horseDisplayPos`** = `state.currentPos + bgScrollOffset` (lane 좌표계)

3. **Off-screen left** = `horseDisplayPos < cullEdge` (cullEdge = -10)

4. **Viewport right edge in lane coordinates** = `-bgScrollOffset + trackWidth`

5. **offscreenIndicator** uses `left: 2px` (viewport 왼쪽 끝에 고정)

6. **Distance**: `leaderPos - state.currentPos` (1등 기준)

7. **한계**: `!state.finished` 가드 → 완주 말 숨김, 출발 안 한 말은 거리만 표시 (😴 없음)

## Pitfalls (누적)

| # | Mistake | Why it broke | Prevention |
|---|---------|-------------|------------|
| 1 | Put indicator inside `horse` element | Horse is 80px wide, sprite covers it | Use `state.lane.appendChild()` |
| 2 | Used `right: 2px` on lane | Lane is 5400px wide, right edge is off-screen | Calculate `left` from viewport |
| 3 | Used `cameraTarget`-based detection (시도 1) | Leader mode → 1등 추적 → 모든 말 behind → 전부 숨김 | Not sufficient alone |
| 4 | Used viewport-based detection only (시도 2) | Leader mode → 어떤 말도 오른쪽 밖 안 나감 | 양방향 통합 필요 |
| 5 | 😴를 오른쪽 전용으로 구현 | 출발 안 한 말은 항상 왼쪽 밖 → 오른쪽 😴 분기 도달 불가 | 왼쪽 offscreenIndicator에 😴 추가 필요 |
| 6 | `cameraTarget` 호이스팅 불필요하게 적용 (시도 1) | viewport 기반으로 전환 후 되돌림 필요했음 | 설계 확정 후 코딩 |
