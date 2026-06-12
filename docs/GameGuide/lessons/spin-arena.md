# Spin-Arena (회전 칼날) — Lessons Learned

회전 칼날 게임 작업 중 발견한 함정 / 실수 / 복구 케이스 누적.

> 공통 함정은 [`_common.md`](_common.md) 참조.

## 누적

### 2026-06-12 — 인원 가변 스케일 도입 시 RNG 소비 순서가 n≤6 동결을 깬다

**상황:** 상한 6→24 확장 + `s(n)=√(6/n)` 가변 스케일 도입(`socket/spin-arena.js` simulate). n≤6은 검증된 baseline 밸런스를 비트 동일로 동결해야 했다.

**함정/실수:** 스폰 배치 지터를 `ARENA_R*0.1 → ARENA_R*0.04`로 바꾸면, 동일 시드에서 슬롯0 스폰 좌표가 달라져(383→370) 결정론 시뮬 전체가 갈라진다. 결정론 시뮬은 **RNG 호출 횟수·순서·배율 어느 하나만 바뀌어도** 이후 모든 산출(frames/escapes/decideMs)이 달라진다.

**증상:** n≤6 비트 동일 회귀 테스트에서 즉시 FAIL(슬롯 좌표 불일치).

**해결/예방:**
- 동결 경계 분기: `n≤6 → 원본 식(ARENA_R*0.1)`, `n>6 → 새 식`. 동결 구간은 RNG 소비를 1비트도 바꾸지 않는다.
- 스케일 수치(charR/bladeR/swordLen 등)는 s=1에서 원본 리터럴과 **수학적으로 동일**해야 한다(`46*1===46`).
- 회귀 검증: 원본 simulate를 재구성해 n=2~6 × 100시드 비트 동일 대조.

**관련:** `socket/spin-arena.js` simulate, `AutoTest/spin-arena-determinism-test.js`, 설계 결정서 `docs/dev-cycle/2026-06-12-spin-arena-camera-scaling-design.md` §3-1

---

### 2026-06-12 — "스폰 즉시 피격 0"은 frame-0 기하 성질 — 0.5초 윈도우로 단언하면 거짓 FAIL

**상황:** spawnR 규칙(인접 칼끝 간격 > 2×칼날+여유)으로 스폰 즉시 피격을 막고, 테스트로 검증하려 했다.

**함정/실수:** "시작 0.5초 내 피격 0건"으로 단언하면, frame2(200ms)부터 `CENTER_PULL` 드리프트로 캐릭터가 **정상 군집 접촉**을 시작해 n≥16에서 거짓 FAIL이 난다. spawnR이 보장하는 건 **스폰 순간(frame 0~1)** 의 spacing이지 0.5초 동안의 무접촉이 아니다.

**증상:** n=16+ 배치 테스트에서 "스폰 피격" FAIL — 실제로는 정상 게임플레이(드리프트 접촉).

**해결/예방:**
- 스폰 피격 단언은 **frame 0~1(0~100ms)** 로 한정. 0~500ms 최이른 피격 frame은 spacing 여유 가시화용 **정보 보고**.
- 설계 문서에 "스폰 즉시 피격 0" vs "0.5초 내 피격 0" 같은 상충 표현이 있으면 데이터로 정합(전자 채택).

**관련:** `AutoTest/spin-arena-determinism-test.js`, 설계 결정서 §5

---

### 2026-06-12 — drawSpinFrame 같은 대형 함수에 새 `var` 추가 시 호이스팅 충돌로 조용한 NaN

**상황:** 카메라 스케일 소스를 `drawSpinFrame`에 `var s = payload.geom.scale`로 추가.

**함정/실수:** 같은 함수 스코프의 슬롯 보간 루프에 이미 `var s = S[si]`가 있었다. JS `var` 호이스팅으로 둘이 **동일 변수**가 되어, 루프 후 `s`가 슬롯 객체로 덮여 `CHAR_RADIUS * s = NaN` → `createRadialGradient` non-finite throw.

**증상:** 렌더 즉시 throw(캔버스 그리기 실패). 렌더 하네스가 바로 잡아냄.

**해결/예방:**
- 대형 함수에 새 `var`를 추가할 땐 함수 내 기존 `var`(특히 한 글자 `s`/`i`/`f`)와의 충돌을 먼저 grep. 고유 이름(`scl` 등) 사용.
- 렌더 하네스로 변경 직후 픽셀/에러 검증하면 이런 런타임 NaN을 즉시 포착.

**관련:** `js/spin-arena.js` drawSpinFrame

---

### 2026-06-12 — 렌더 하네스는 roomJoined를 안 거쳐 currentUser가 비어 있다 (follow 카메라가 항상 폴백)

**상황:** 관전 카메라 렌더 하네스 테스트. follow 모드는 `currentUser`로 내 슬롯을 찾는다.

**함정/실수:** `AutoTest/spin-arena-render-harness.html`는 소켓 이벤트(`roomJoined`)를 거치지 않아 `currentUser`가 빈 문자열로 남는다. 그러면 follow 등 currentUser 의존 카메라 로직이 항상 폴백(director)으로 빠져 follow를 실제로 테스트하지 못한다.

**증상:** follow 모드 픽셀 결정론을 단언해도 실제론 director가 그려짐(테스트가 거짓 통과/무의미).

**해결/예방:**
- 하네스에서 currentUser 의존 기능을 테스트하려면 `initSpinFx` 전에 `currentUser`(및 `_mySlotIdx`)를 **명시 주입**.
- 카메라 모드별 테스트는 모드와 타깃을 인자로 강제(`renderTo(mode, target, t)`)해 폴백에 가려지지 않게.

**관련:** `AutoTest/spin-arena-render-harness.html`, `js/spin-arena.js` 카메라 모듈

---

### 2026-06-12 — 스킨 색은 3파일 동기 + 자동배정 풀 ≠ 명시픽 소유검증 풀

**상황:** 스킨 16→24색 확장 + 24명 식별을 위한 자동배정 변경.

**함정/실수:** 스킨 색 정의가 **3곳**(`socket/spin-arena.js` SPIN_SKIN_COLORS / `js/spin-arena.js` SPIN_SKIN_COLORS / `config/spin-arena/cosmetics.json`)에 있고 id·순서·color·blade 모두 일치해야 한다. 한쪽만 바꾸면 미리보기≠게임 색 또는 소유 우회. 또한 **자동배정 풀과 명시픽 검증 풀은 분리 개념**: 자동배정은 식별을 위해 전체 24색(`BASE_SKINS`, tier1) 무중복 분배(소유 무관), 명시 픽은 `free` 플래그 기반 소유 검증. 둘을 혼동하면 24명 색 중복(식별 깨짐) 또는 프리미엄 우회.

**증상:** 7명+ 색 중복(자동배정 풀이 무료 6색뿐일 때), 또는 미리보기와 실제 게임 색 불일치.

**해결/예방:**
- 색 변경 시 3파일 **개수·id·순서·color·blade 대조**(스크립트 권장).
- "식별색 ≠ 소유 코스메틱" 결정: 자동배정 = 전체 base 색 distinct 분배, `free` 플래그 = 명시 픽 상점 검증 전용.
- 클라 previewRoster도 서버와 동일 분배 규칙(미리보기 색 == 게임 색 불변조건).

**관련:** `socket/spin-arena.js` 스킨 배정, `js/spin-arena.js` previewRoster, `config/spin-arena/cosmetics.json`, 설계 결정서 §3-7

---

## 추가 형식

```markdown
## YYYY-MM-DD — 한 줄 제목

**상황:** 작업 컨텍스트
**함정/실수:** 무엇이 잘못되었나
**증상:** 어떻게 발견했나
**해결/예방:** 다음에는 어떻게
**관련:** 파일/커밋/PR
```
