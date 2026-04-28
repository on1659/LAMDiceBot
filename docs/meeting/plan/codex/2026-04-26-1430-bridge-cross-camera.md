# Claude × Codex 계획 토론

**일시**: 2026-04-26
**주제**: Bridge Cross 카메라 + 줌 시스템 설계 검증
**참석자**: Claude (Opus), Codex
**라운드**: 3/5 (조기 합의)

---

## 1. 컨텍스트

- 대상: `output/bridge-cross/bridge-cross-game-mockup.html` (standalone, main 미연결)
- 현재 클래스: Platform / Bridge / StageLayout (4 corners + bilinear pointAt)
- 자산: stage/{background-void-v2, start-stage-v3, finish-stage-v2}.png (1536×1024) + sprites/players-*.png (1400×1122)
- 자산 측정: dimetric 2:1 isometric (슬로프 ±0.5253, ScoutCodex 회귀 검증 완료)
- 현재 문제: 다리 거리 191px / tile 214 → 인접 타일 ~82% 겹침, 시각 어색
- 사용자 결정: 던파/3D 게임식 카메라 + 줌 UI 도입
- Claude draft: `docs/meeting/impl/2026-04-26-bridge-cross-camera-impl.md`

---

## 2. 토론 과정

### Round 1 — Claude 초안 (7 포인트) → Codex 1차 분석

Claude 초안:
1. World 2400×1024 + Viewport 1024×683 + finish offset 864
2. Camera (pan + zoom + lerp + clamp + shake)
3. CameraDirector phase별 자동 zoom (ready 0.55 / falling 1.25 / finished 0.5 등)
4. UserZoomController multiplier 0.5~2.0
5. 2단계 작업 (Phase 1 자동 / Phase 2 UI)
6. Stage 자산 world 배치 (drawImage 2회)
7. Render 파이프라인 (apply/release)

Codex 판정: **AGREE 3개 (4, 5, 6) + PARTIAL 4개 (1, 2, 3, 7)**

핵심 지적:
- minZoom 가드 부재 — userZoom 0.5 × directorZoom 0.5 = 0.25면 viewport > world 노출
- shake amp × shakeT 감쇠가 약함, screen-space 적용 권장
- ready 0.55 / finished 0.5는 minZoom 아래 → 검은 영역
- lerp 0.10/0.06은 frame-based (FPS 의존) → dt-based로
- canvas.width/height 직접 참조 금지, world/viewport 분리

### Round 2 — Claude 수정 (1', 2', 3', 5', 6, 7')

수정안:
- 1'/3': minZoom = max(vw/worldW, vh/worldH) = 0.667 가드 추가
- 2': lerp `1 - exp(-dt × rate)` (dt-based), shake screen-space
- 3': phase zoom 모두 0.667 위 (ready 0.7, finished 0.7)
- 7': world/viewport 분리, canvas HTML 1024×683

Codex 판정: **AGREE 1개 (5) + PARTIAL 4개 (1, 2, 3, 7)**

핵심 지적:
- minZoom 0.667 → 가로는 1536만 보임 (2400 전체 X). "전체 보기" 의도 명확화 필요
- shake 순서 오류 — `translate(shake)`가 `scale()` 뒤에 있으면 zoom 비례. screen-space 원하면 scale 전에
- ready/finished 0.7도 1463×975만 보임. 진짜 전체면 0.427 + letterbox
- bg seam 검증 필요 (background-void-v2.png가 864px seamless 보장 X)

### Round 3 — Claude 의도 명확화 + 순서 수정 (1'', 2'', 3'', 6')

수정안:
- 1''/3'': "전체 맵 보기" 의도 폐기. ready는 startPlatform.center 클로즈업, finished는 finishPlatform.center 클로즈업
- 2'': apply 순서 수정 — `translate(center + shake) → scale → translate(-render)`
- 6': bg는 (0,0) + (864,0) 2회 drawImage 기본, seam은 시각 QA에서 확인 후 stretch/단색 변경

Codex 판정: **전부 AGREE (1'', 2'', 3'', 6', 7')**

조기 합의 — 토론 종료.

---

## 3. 최종 합의

### 1. 좌표계
- World 2400×1024
- Viewport 1024×683 (3:2)
- finish-stage 자산 world (864, 0) offset
- minZoom = max(viewport.w/world.w, viewport.h/world.h) = max(0.427, 0.667) = **0.667** 가드

### 2. Camera 클래스
- 멤버: x, y, zoom, targetX, targetY, targetZoom, smoothing.{pan, zoom}, shakeT, shakeAmp
- lerp dt-based: `x += (target - x) × (1 - exp(-dt × rate))`. pan rate 8.0, zoom rate 5.0.
- shake 감쇠: `amp × (shakeT / duration)`, shakeT는 dt만큼 감소.
- apply 순서: `ctx.save() → translate(viewport.center.x + shakeX, viewport.center.y + shakeY) → scale(effectiveZoom) → translate(-renderX, -renderY)`. shake가 screen-space 픽셀 amp.
- effectiveZoom = max(directorZoom × userZoom, minZoom) — clamp.

### 3. CameraDirector
- ready: zoom 0.7, target = startPlatform.center
- next-player: zoom 0.85, target = newPlayer
- enter-bridge / walk-known / safe-flash: zoom 1.0, follow current
- choose: zoom 1.12, follow
- choice-wait: zoom 1.18, follow
- falling: zoom 1.25 + shake(8, 0.4s), follow
- finish-wait: zoom 0.7, target = finishPlatform.center
- finished: zoom 0.7, target = finishPlatform.center

### 4. UserZoomController (Phase 2)
- range 0.5 ~ 2.0, default 1.0
- effectiveZoom = directorZoom × userZoom (multiplier)
- UI: 우측 하단 floating [-/+/Reset] + 마우스 휠 (canvas hover). 모바일 pinch는 후속.

### 5. 작업 단계
- Phase 1: World+Camera+Director (자동, userZoom 1.0 고정), clamp+minZoom 가드 포함
- Phase 2: UserZoom UI 추가

### 6. Stage 자산 배치
- start-stage-v3.png → drawImage(0, 0, 1536, 1024)
- finish-stage-v2.png → drawImage(864, 0, 1536, 1024)
- background-void-v2.png → drawImage(0, 0, 1536, 1024) + drawImage(864, 0, 1536, 1024)
- seam은 시각 QA에서 확인. 어색하면 후속에서 stretch 1회 또는 단색으로 변경.

### 7. Render 파이프라인
- `world` / `viewport` 별도 객체 (canvas.width/height 직접 참조 금지)
- canvas HTML: width="1024" height="683"
- render flow: `clearRect(viewport) + fillRect(screen) → camera.apply → drawWorldBg → drawStages → drawTiles → drawPlayers → camera.release → drawHud(screen) → drawZoomUI(screen)`
- update와 render 분리: `update(dt) → cameraDirector.update(state) → camera.update(dt, userZoom) → render()`
- HUD 좌표는 viewport 픽셀 (1024×683)에 맞게 재배치

---

## 4. 미해결 사항

없음.

---

## 5. 다음 단계

> 구현 상세: [`2026-04-26-bridge-cross-camera-impl.md`](../../impl/2026-04-26-bridge-cross-camera-impl.md)

- [ ] impl 문서에 합의 결과 반영 (Round 3 수정안 적용)
- [ ] 하네스 COMPLEX: Coder 호출 (Phase 1만)
- [ ] Reviewer + ReviewerCodex 병렬
- [ ] 시각 QA: 사용자 캡처 (ready/walk/choose/falling/finish-wait/finished 6 phase)
- [ ] bg seam 어색 여부 결정 → 어색하면 stretch/단색 변경
- [ ] Phase 2 UserZoom UI 추가
