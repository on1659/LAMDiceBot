# Bridge Cross 카메라 + 줌 시스템 구현 명세 (impl)

작성일: 2026-04-26 (Claude × Codex 토론 합의, 3 라운드 조기 합의)
회의록: [`../plan/codex/2026-04-26-1430-bridge-cross-camera.md`](../plan/codex/2026-04-26-1430-bridge-cross-camera.md)
대상: `output/bridge-cross/bridge-cross-game-mockup.html` (standalone, main 미연결)
구현 추천 모델: **Opus** (Camera 설계 + render 파이프라인 + UI 통합 = 설계 판단 多)

> **On completion**: move this file to `docs/meeting/applied/`

---

## 0. 배경

- 현재 캔버스 1536×1024에 stage 자산 그대로. 다리 거리 = 시작 RIGHT(743) → 골 LEFT(870) = 191px / tile 214px → 인접 타일 ~82% 겹침. 시각 어색.
- 사용자 결정: **던파/3D 게임식 카메라**(pan + zoom + follow + 흔들림) + **수동 zoom UI** 도입.

---

## 1. 좌표계

| 항목 | 값 | 비고 |
|------|------|-----|
| World 가로 | **2400px** | 현재 1536 → 1.56배 확장 |
| World 세로 | 1024px | 그대로 |
| Viewport (canvas native) | **1024×683** | 3:2 유지, native pixel. canvas HTML width="1024" height="683" |
| Viewport CSS | aspect-ratio 3:2, max-width 1280px | 모바일은 width 100% |
| **minZoom 가드** | **0.667** | `max(viewport.w/world.w, viewport.h/world.h) = max(0.427, 0.667)`. effectiveZoom 하한. |

**중요**: `world` / `viewport` 별도 객체로 보관. **`canvas.width` / `canvas.height` 직접 참조 금지** (Codex Round 2 지적).

---

## 2. Stage 자산 world 배치

자산은 그대로(수정 금지). drawImage 시 world dx/dy로 위치 결정.

```
start-stage-v3.png  → drawImage(img, 0,   0, 1536, 1024)
finish-stage-v2.png → drawImage(img, 864, 0, 1536, 1024)   ← +864 x offset
background-void-v2.png → drawImage(img, 0, 0, 1536, 1024) + drawImage(img, 864, 0, 1536, 1024) (2회)
```

**finish corners world 좌표** (자산 corners + 864 x offset):
- TOP    (1892, 223)
- RIGHT  (2238, 392)
- BOTTOM (2059, 487)
- LEFT   (**1734, 303**) ← 다리 마지막 타일 위치

**다리 entrance/exit (world)**:
- entrance = start.RIGHT = (743, 446)
- exit     = finish.LEFT = (1734, 303)
- 거리 √(991² + 143²) ≈ **1001px**, 6 columns → column step **≈ 200px**, tile 214 대비 ~7% 겹침 (자연스러움)

---

## 3. 클래스 구조

### Camera

**핵심 규칙** (Codex Round 2/3 검증 합의):
- lerp는 **dt-based**: `x += (target - x) × (1 - exp(-dt × rate))`. pan rate 8.0, zoom rate 5.0. FPS 무관.
- shake는 **screen-space**: apply 순서 `translate(viewport.center + shake) → scale → translate(-render)`. shake가 zoom 비례하지 않게.
- shake 감쇠: `amp × (shakeT / duration)` (normalized).
- effectiveZoom 하한: `Math.max(zoom × userZoom, minZoom)`. minZoom = 0.667.

```js
class Camera {
  constructor({ viewportW, viewportH, worldW, worldH }) {
    this.viewport = { w: viewportW, h: viewportH };
    this.world = { w: worldW, h: worldH };
    this.minZoom = Math.max(viewportW / worldW, viewportH / worldH);
    this.x = worldW / 2; this.y = worldH / 2; this.zoom = 1;
    this.targetX = this.x; this.targetY = this.y; this.targetZoom = 1;
    this.lerpRate = { pan: 8.0, zoom: 5.0 };
    this.shakeT = 0; this.shakeDuration = 0; this.shakeAmp = 0;
    this._effectiveZoom = 1;
    this._renderX = this.x; this._renderY = this.y;
    this._shakeX = 0; this._shakeY = 0;
  }

  setTarget({ x, y, zoom }) {
    if (x !== undefined) this.targetX = x;
    if (y !== undefined) this.targetY = y;
    if (zoom !== undefined) this.targetZoom = zoom;
  }

  shake(amp, duration) {
    this.shakeAmp = amp;
    this.shakeDuration = duration;
    this.shakeT = duration;
  }

  update(dt, userZoom = 1) {
    // dt-based lerp: 1 - exp(-dt * rate)
    const panAlpha = 1 - Math.exp(-dt * this.lerpRate.pan);
    const zoomAlpha = 1 - Math.exp(-dt * this.lerpRate.zoom);
    this.x += (this.targetX - this.x) * panAlpha;
    this.y += (this.targetY - this.y) * panAlpha;
    this.zoom += (this.targetZoom - this.zoom) * zoomAlpha;

    // effectiveZoom + minZoom floor
    this._effectiveZoom = Math.max(this.zoom * userZoom, this.minZoom);

    // shake (screen-space, normalized 감쇠)
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const decay = this.shakeT / this.shakeDuration;
      this._shakeX = (Math.random() - 0.5) * 2 * this.shakeAmp * decay;
      this._shakeY = (Math.random() - 0.5) * 2 * this.shakeAmp * decay;
    } else {
      this._shakeX = 0; this._shakeY = 0;
    }

    // clamp: viewport가 world 밖으로 못 나가게
    const halfW = this.viewport.w / 2 / this._effectiveZoom;
    const halfH = this.viewport.h / 2 / this._effectiveZoom;
    const minX = Math.min(halfW, this.world.w / 2);
    const maxX = Math.max(this.world.w - halfW, this.world.w / 2);
    const minY = Math.min(halfH, this.world.h / 2);
    const maxY = Math.max(this.world.h - halfH, this.world.h / 2);
    this._renderX = Math.max(minX, Math.min(maxX, this.x));
    this._renderY = Math.max(minY, Math.min(maxY, this.y));
  }

  apply(ctx) {
    ctx.save();
    // shake가 scale 전에 적용되어야 screen-space pixel amp 보존
    ctx.translate(this.viewport.w / 2 + this._shakeX, this.viewport.h / 2 + this._shakeY);
    ctx.scale(this._effectiveZoom, this._effectiveZoom);
    ctx.translate(-this._renderX, -this._renderY);
  }

  release(ctx) { ctx.restore(); }
}
```

### CameraDirector

phase 관찰 → camera target 설정. 게임 로직에 영향 X.

**Phase별 zoom + target** (Codex Round 3 합의 — 모두 minZoom 0.667 위, "전체 맵 보기" 의도 폐기):

```js
// phase → { zoom, target } 결정 함수
function resolvePhaseFraming(state, layout) {
  const phase = state.phase;
  const startCenter = layout.startPlatform.center;
  const finishCenter = layout.finishPlatform.center;
  const current = state.current && state.avatar
    ? { x: state.avatar.x, y: state.avatar.y }
    : null;

  switch (phase) {
    case 'ready':
      return { zoom: 0.7, target: startCenter };
    case 'next-player':
      return { zoom: 0.85, target: current ?? startCenter };
    case 'enter-bridge':
    case 'walk-known':
    case 'walk-known-wait':
    case 'safe-flash':
      return { zoom: 1.0, target: current ?? startCenter };
    case 'choose':
      return { zoom: 1.12, target: current ?? startCenter };
    case 'choice-wait':
      return { zoom: 1.18, target: current ?? startCenter };
    case 'falling':
      return { zoom: 1.25, target: current ?? startCenter };
    case 'finish-wait':
    case 'finished':
      return { zoom: 0.7, target: finishCenter };
    default:
      return { zoom: 1.0, target: current ?? startCenter };
  }
}

class CameraDirector {
  constructor(camera, layout) {
    this.camera = camera;
    this.layout = layout;
    this._shakeAppliedFor = null;
  }

  update(state) {
    const { zoom, target } = resolvePhaseFraming(state, this.layout);
    this.camera.setTarget({ x: target.x, y: target.y, zoom });

    // falling shake (캐릭터당 1회)
    if (state.phase === 'falling' && this._shakeAppliedFor !== state.currentIndex) {
      this.camera.shake(8, 0.4);
      this._shakeAppliedFor = state.currentIndex;
    } else if (state.phase !== 'falling') {
      this._shakeAppliedFor = null;
    }
  }
}
```

**Phase별 zoom 표** (전부 minZoom 0.667 위):

| phase | zoom | target |
|-------|------|--------|
| ready | 0.7 | start.center |
| next-player | 0.85 | newPlayer |
| enter-bridge / walk-known / safe-flash | 1.0 | follow current |
| choose | 1.12 | follow current |
| choice-wait | 1.18 | follow current |
| falling | 1.25 | follow current (+ shake 8, 0.4s) |
| finish-wait | 0.7 | finish.center |
| finished | 0.7 | finish.center |

### UserZoomController (Phase 2)

```js
class UserZoomController {
  constructor({ min = 0.5, max = 2.0, defaultValue = 1.0 } = {}) {
    this.min = min; this.max = max; this.value = defaultValue;
  }
  set(v) { this.value = Math.max(this.min, Math.min(this.max, v)); }
  delta(d) { this.set(this.value + d); }
  reset() { this.value = 1.0; }
}
```

UI 컨트롤:
- 우측 하단 floating: `[-]` `[1.0×]` `[+]` `[Reset]`
- 마우스 휠: canvas hover 시 wheelDelta로 0.05 단위 조절
- 모바일 pinch: 두 손가락 거리 비율로 set (선택, 우선순위 낮음)

---

## 4. Render 파이프라인

```
function render() {
  ctx.clearRect(0, 0, viewport.w, viewport.h);
  ctx.fillStyle = '#030511';
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  camera.apply(ctx);
    drawBackground();   // bg + start-stage(0,0) + finish-stage(864,0)
    drawTiles();        // world 좌표 그대로
    drawPlayers();      // world 좌표 그대로
  camera.release(ctx);

  drawHud();            // 스크린 좌표
  drawZoomUI();         // Phase 2
}
```

`update(dt)`도 분리:
```
function loop(now) {
  const dt = ...;
  update(dt);                  // 게임 로직 + avatar 이동
  cameraDirector.update(state);
  camera.update(dt, userZoom?.value ?? 1);
  render();
  requestAnimationFrame(loop);
}
```

---

## 5. 작업 단계

### Phase 1 — Camera + Director (자동)
- World 가로 2400 적용 (StageLayout 확장)
- finish corners +864 x offset
- Camera 클래스 신규
- CameraDirector 신규
- finish-stage 자산 (864, 0) drawImage
- background 2회 drawImage
- render 파이프라인 변경 (apply/release)
- viewport canvas 1024×683 (HTML width/height + CSS aspect-ratio 3:2)
- userZoom 고정 1.0

### Phase 2 — UserZoom UI
- UserZoomController 신규
- HTML/CSS 슬라이더 또는 floating 컨트롤
- 마우스 휠 핸들러
- 모바일 pinch (선택)
- effectiveZoom = directorZoom × userZoom

---

## 6. 결정값 (Claude × Codex 합의 최종)

| 항목 | 값 |
|------|-----|
| world 가로/세로 | 2400 / 1024 |
| viewport canvas | 1024 × 683 (HTML width/height) |
| finish stage offset x | 864 |
| **minZoom 가드** | **0.667** (max(vw/worldW, vh/worldH)) |
| director phase zoom | ready 0.7, next-player 0.85, walk/safe-flash 1.0, choose 1.12, choice-wait 1.18, falling 1.25, finish-wait 0.7, finished 0.7 |
| **lerp 산식** | **dt-based**: `x += (target - x) × (1 - exp(-dt × rate))` |
| lerp rate | pan 8.0, zoom 5.0 |
| camera clamp | viewport ⊆ world (minZoom 가드와 함께 안전) |
| **shake 적용** | **screen-space**: `translate(center + shake) → scale → translate(-render)` |
| camera shake | falling 시 amp 8, dur 0.4s, 1회/캐릭터, 감쇠 normalized |
| userZoom | range 0.5~2.0, default 1.0 |
| zoom 합산 | `Math.max(directorZoom × userZoom, minZoom)` (multiplier + floor) |

---

## 7. 보존 (불변조건)

- 게임 시퀀스 (mulberry32 / safeRows / shuffle / phase 흐름)
- 자산 파일 경로 (sprites/, stage/)
- 매니페스트 row 정의, anchor (0.5, 0.88) / (0.5, 0.62)
- Platform / Bridge / StageLayout 클래스 (corners 측정값) — **finish corners x에만 +864 offset**
- HUD draw 코드 (위치는 viewport 픽셀, 카메라 무관)
- 게임 호출처 19개 — `layout.tileCenter`, `tileRect`, `entrance()`, `waitingSlot`, `finishSlot`, `columnCount`, `tileW`, `tileH`

---

## 8. 위험 / 함정 (Codex 검증 합의)

- **minZoom 가드 부재 시 world 외부 검정 노출**: `Camera.update`에서 `effectiveZoom = max(zoom × userZoom, minZoom)`로 floor. world보다 viewport가 큰 경우 가드.
- **lerp frame-based(0.10/0.06)는 FPS 의존**: `1 - exp(-dt × rate)` dt-based로 변환. pan 8.0, zoom 5.0. 60fps와 30fps에서 동일한 부드러움.
- **shake 순서 오류 (scale 뒤 translate)**: zoom에 비례한 amp가 됨. **scale 전에 translate(center + shake)** 적용 필수. 원하는 픽셀 amp 그대로.
- **shake 감쇠 `amp × shakeT`는 약함**: `amp × (shakeT / duration)` normalized로 시작 amp 그대로 → 0.
- **canvas.width/height 직접 참조 금지**: world / viewport 분리 객체로 보관. canvas HTML width="1024" height="683". 기존 코드에서 `canvas.width`로 그린 부분 모두 `viewport.w` 또는 `world.w`로 명시.
- **HUD 좌표 재배치**: viewport 1024×683에 맞게 HUD 패널 위치/크기 재배치 (기존 1536×1024 좌표 그대로면 잘림).
- **bg seam (background-void-v2 (0,0)+(864,0))**: 자산이 864px seamless 보장 X. **시각 QA에서 확인** 후 어색하면 stretch 1회 또는 단색으로 변경.
- **anchor 중복 위험**: 기존 drawPlayer/moveAvatar `anchorOffset` 그대로 유지 (이전 라운드 검증됨).

---

## 9. 검증

- 인라인 script extract → `node --check`
- Grep: 옛 패턴 (`BridgeLayout`, `canvas.width` / `canvas.height` 직접 참조) 잔존 0 확인
- 시각 (사용자 캡처, 6 phase):
  - **ready**: 시작 플랫폼 + 다리 시작 부분 클로즈업 (zoom 0.7)
  - **next-player → walk-known**: 줌인 + 캐릭터 follow (0.85 → 1.0)
  - **choose → choice-wait**: 줌 1.12 → 1.18 점차 (긴장)
  - **falling**: 카메라 흔들림 + 줌 1.25 (1회/캐릭터)
  - **finish-wait**: 골 플랫폼 클로즈업 (zoom 0.7)
  - **finished**: 골 플랫폼 + winner 부각 (zoom 0.7)
- bg seam 시각 확인 (background-void-v2 2회 그리기 어색 여부)

---

## 10. 후속 (Phase 3+, 옵션)

- Auto 토글 (Auto OFF → director 무시, slider만)
- 모바일 pinch-to-zoom 정식 지원
- Camera target에 lookahead (캐릭터 진행 방향 살짝 미리 보여줌)
- Parallax background (스크롤 시 배경 다른 속도)
- Mini-map HUD (현재 카메라 위치 표시)
