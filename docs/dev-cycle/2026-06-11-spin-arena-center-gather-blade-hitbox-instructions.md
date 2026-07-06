# spin-arena 중앙 군집 + 하드 월 검토 + 칼날 선분 히트박스 — 이더 지시서

- goal: `docs/goal/spin-arena-center-gather-and-blade-hitbox.md`
- baseline: `docs/goal/applied/spin-arena-gameplay-rework-and-parity.md` (2026-06-11 게임성 개편 완료 상태)
- 브랜치: `feature/spin-arena-rework` (이어서 작업, 새 브랜치 만들지 않음)
- 정찰: Scout + ScoutCodex 완료 (아래 줄번호는 정찰 시점 기준 — 코드가 권위)

## 수정 파일

| 파일 | 내용 |
|---|---|
| `D:\Work\LAMDiceBot\socket\spin-arena.js` | ① CENTER_PULL ② 하드 월(채택 시) ③ 선분 충돌 — 전부 simulate() 내부 + 상단 const |
| `D:\Work\LAMDiceBot\js\spin-arena.js` | 공유 상수(SWORD_LEN 등) + 타격감지 tips 선분 동기 + 스파크 접촉점 + (②채택 시) 링 밖 빨간 연출 정리 |
| `D:\Work\LAMDiceBot\spin-arena-multiplayer.html` | 캐시버스트 `?v=2`→`?v=3` (L290) + (②채택 시) 튜토리얼 4단계 문구(L476) |
| `D:\Work\LAMDiceBot\AutoTest\spin-arena-determinism-test.js` | 새 규칙 반영 단언 갱신 + (②채택 시) "링 밖 좌표 0건" 단언 |
| `D:\Work\LAMDiceBot\AutoTest\spin-arena-render-harness.html` | `__PAYLOAD` 재생성 (새 시뮬 출력) |
| `D:\Work\LAMDiceBot\update-log.md` | 평이한 한국어 기록 |

공유 파일(rooms.js, room-helpers.js, api.js, theme.css, *-shared.js, db/*)은 **수정 금지** — 이번 작업의 안전 경계.

## ③ 칼날 히트박스: 점 → 검 날 선분 (먼저 구현 — ②검토의 전제)

### 서버 (`socket/spin-arena.js`)

- 신설 공유 상수 (상단 칼날 const 블록 L24~29 부근):
  - `SWORD_LEN = 28` — 도신 길이. 현재 클라 도신 그리기가 로컬 x 18~46이므로 28 = BLADE_RADIUS(46) − 18. 보이는 것 = 맞는 것.
  - `BLADE_EDGE_R = 3.5` — 캡슐(선분 두께) 반경. 도신 그리기 반폭 최대 3.4px에 정합. 기존 BLADE_TIP_R(7)을 쓰면 기존보다 후해지고, 0이면 칼끝 스침이 사라진다 — 3.5가 "보이는 폭" 기준. 배치 게이트가 흔들리면 이 값도 레버(최대 7).
- 충돌 판정 교체 (L142~150 tips 계산 + L161~162 점 비교):
  - 칼날마다 선분 양 끝 = 허브에서 `BLADE_RADIUS - SWORD_LEN` 지점(inner)과 `BLADE_RADIUS` 지점(outer). owner 좌표 + cos/sin은 기존 방식 그대로.
  - 판정 = 선분-원: 몸 중심에서 선분 위 최근접점 t = clamp(dot/len², 0, 1) → 최근접점 px,py → `distSq(c, p) < (CHAR_RADIUS + BLADE_EDGE_R)²`. 전부 결정론 산술(sqrt/hypot OK).
  - **넉백 방향 = 최근접점 → 몸 중심** (기존 칼끝→몸 dx,dy 대체). 거리 0 가드 `|| 1` 유지 (기존 L167 패턴).
  - bladeDmgBy 킬 크레딧, KNOCK_IMPULSE 가산→KNOCK_MAX 클램프, 동률 tie=낮은 슬롯 id — 전부 기존 그대로.
  - BLADE_TIP_R 상수는 클라 글린트 연출이 쓰면 유지, 판정에서만 제거. 안 쓰이면 정리.

### 클라 (`js/spin-arena.js`)

- 상단 공유 상수 블록(L7~23)에 `SWORD_LEN = 28`, `BLADE_EDGE_R = 3.5` 동일 값 추가. `HIT_THRESH2`(L470) = `(CHAR_RADIUS + BLADE_EDGE_R)²`로 교체.
- 타격감지(L972~1017): tips 끝점 1개 검사 → 서버와 **같은 선분 최근접점 수식**으로 교체. `hpDrop` AND 조건 유지.
- 스파크 접촉점(L1000~1002): "몸 중심→칼끝 방향 × CHAR_RADIUS" → **선분 최근접점 투영 기준**으로. 중간날 타격 위치가 맞아야 한다.
- 검 그래픽(L796~822): 도신 시작 x=18 하드코딩 → `BLADE_RADIUS - SWORD_LEN` 파생으로 교체 (값은 동일 28이라 시각 변화 없음 — 상수만 연결). 트레일/풀러/글린트 좌표도 가능한 한 파생으로.

## ① 중앙 군집 (CENTER_PULL)

- 서버 simulate() 이동 적분부(L180~208): 살아있는 캐릭터에 **항상**(링 안팎 무관) 중심(CX,CY) 방향 가속 `CENTER_PULL` 적용. 기존 INWARD_ACCEL(링 밖 전용)은 일단 유지 — ② 하드 월 채택 시 도달 불가 데드코드가 되므로 그때 정리.
- **ScoutCodex 경고**: drag가 없어 보존력은 영구 진동(중심 관통 왕복) → "모임"이 안 된다. 대응(단순한 순서로):
  1. CENTER_PULL을 작게 (예 20~40) + 벽 반사 감쇠 의존
  2. 그래도 진동이면 약한 선형 drag 추가 (예 `vx -= vx * SPIN_DRAG * dt`, SPIN_DRAG 0.3~0.6) — 신설 상수는 const 블록에
  - 방식 선택은 구현자 판단, 배치 분포가 권위. 드리프트 무작위 방향성은 유지(일직선 돌진 금지).
- 군집 체감 검증: 배치 시뮬에서 **생존자 평균 중심거리(t=15s, 25s)** 또는 평균 첫 교전 시각을 before/after 비교해 수치로 보고.

## ② 링 이탈 금지 하드 월 — 검토 후 채택/폐기 결정 (결정 권한 위임됨)

- 구현(검토용): 이동 적분 후, **alive 캐릭터만** `dist(c, center) > ring - CHAR_RADIUS`이면:
  - 위치를 경계로 클램프 + 법선 속도 반사(`WALL_BOUNCE` 재사용 가능) + **kvx/kvy는 kdot>0일 때만 반사** — 바깥벽 블록 L191~203이 정답 템플릿.
  - **시체는 절대 클램프 금지** (사망 좌표 동결 단언 L52~61이 깨진다). 사망자는 수축 링 밖에 남는 게 정상.
  - 링은 틱 시작 1회 계산이라 벽에 붙은 캐릭터가 다음 틱 0.32px 밖 — 순수 하드 월이면 무해. "벽 접촉 데미지" 레버를 쓰게 되면 ε 여유 필수(플리커 방지).
- 채택 시 RING_DPS 데미지 블록(L174~177) 제거 또는 레버로 남기면 주석으로 의도 명시. `killerId: null` 경로·INWARD_ACCEL 데드코드 정리.
- **판정 절차 (200시드 배치가 권위)**:
  1. ①+③+하드 월 ON으로 배치 → h2/h3 ≥ 95%, h6 ≥ 88% ("정확히 1명 생존") + 칼날킬 ~100% 확인
  2. 미달 시 보완 레버 순서: (a) 벽 접촉 중 소량 데미지 (b) HIT_DPS 상향 (c) 링 수축 타이밍 단축 — (c) 사용 시 determinism-test L17 링 경계 단언(220/220/140/60/60) 동기
  3. 그래도 미달 → 하드 월 폐기, 링 데미지 현행 유지 (①③만 적용 상태로 게이트 재충족)
  - **결정과 분포 수치를 보고에 명시** (채택/폐기 둘 다).
- 채택 시 클라 정리: 링 밖 빨간 연출 일괄 (`drawDangerDonut` L728~738 의미 변경/제거, outside 판정 L909, 붉은 틴트 L1096~1099, 폴백 붉은 원 L1110~1115, dangerLevel L1183~1184). frames 반올림으로 벽 캐릭터가 0.5px 밖으로 보일 수 있으니 outside 판정에 ε. 튜토리얼 4단계(HTML L476 "안전구역 밖에 있으면 체력이 깎여요") 새 규칙 문구로.

## A. 밸런스 재튜닝 (필수 게이트)

- `AutoTest/spin-arena-determinism-test.js` 배치 루프(L68~93): h∈{2,3,4,5,6} × 200시드, **h2/h3 ≥95%, h6 ≥88%** "정확히 1명 생존" + **칼날킬 비율 표** 필수 보고.
- ScoutCodex 최우선 경고 — **h2 0생존(동시 사망) 분포를 별도 항목으로 볼 것**: 선분화로 겹침=즉사 지대가 되고, 결판 보호는 틱 시작 평가라 같은 틱 동시 0 HP면 둘 다 죽는다. RING_DPS 제거 시 대칭 데미지라 동률 빈도 추가 상승.
- 조정 레버: CENTER_PULL / SPIN_DRAG / SWORD_LEN / BLADE_EDGE_R / HIT_DPS / KNOCK_* / 링 수축 타이밍 / DRIFT_SPEED. **기준 충족하는 가장 단순한 조합** 선택, 최종 수치 표를 보고에 첨부.
- `AutoTest/qa-spin-slot-bias.js` 재실행 — 동시 사망 증가 시 slotId tie-break(L253)가 슬롯 0을 체계적으로 벌칙 시키는지 카이제곱 확인.

## 불변조건 (절대 깨뜨리지 말 것)

1. 결과는 서버 결정론 시뮬에서만 — 시뮬 내부 Math.random/Date.now 0건 유지 (시드 생성 L401은 시뮬 밖, 허용).
2. 클라 Math.random 실호출 정확히 2회 (L64 tabId, L72 deviceId).
3. 소켓 이벤트 9개 이름 불변 (selectSkin/requestSkins/start/skinsUpdated/reveal/gameEnd/roundReset/gameAborted/error).
4. reveal payload에 seed/timeline 미포함, rooms.js 재진입 마스킹 유지. 페이로드 변경은 additive만 (예: `swordLen` 필드 추가는 OK).
5. 결판 규칙: 사람 최후 1인 무적(L157, 데미지+넉백 함께 skip)·전체 1명 정지(L155)·tie-break(L217 HP 낮은 쪽 먼저)·rankHumans 정렬 키·selected=최후 생존자=당첨(벌칙) 시맨틱·DB 기록(recordGamePlay / recordServerGame rank 1·2 / recordGameSession 'spin-survival').
6. frames 계약: 길이 301, 폭 n×3, 정수 반올림, 사망 좌표 동결.
7. 데미지→이동→사망 적용 **섹션 순서 보존** (tips는 이동 전 스냅샷, 탈락 좌표는 이동 후). 순서 변경은 동일 시드 결과를 통째로 바꾼다.
8. 킬러 칼날 +1은 다음 틱부터(서버) ↔ 클라 bladeCountAt strict `<` ↔ 테스트 미러 — 3중 계약 유지.
9. `module.exports.simulate/rankHumans/ringRadiusAt` 시그니처·반환 형태 유지 (테스트 3종이 의존).
10. COUNTDOWN_MS 4000 변경 금지. 캔버스 논리 480×480 유지.
11. 킬당 칼날+1(상한 5)·killerId·데미지 숫자·HP 패널·채팅 오버레이·카운트다운·튜토리얼·BGM·다시보기 전부 계속 동작.

## 테스트 (순서대로)

1. `node -c D:\Work\LAMDiceBot\socket\spin-arena.js` + `node --check D:\Work\LAMDiceBot\js\spin-arena.js`
2. 공정성 grep: `js/spin-arena.js` Math.random 실호출 2회 (주석 제외)
3. `node D:\Work\LAMDiceBot\AutoTest\spin-arena-determinism-test.js` — 결정론 회귀 + 200시드 배치 (단언은 새 규칙 반영해 갱신: 하드 월 채택 시 "alive 캐릭터 링 밖 좌표 0건" 단언 추가, 칼날킬 단언 추가 검토)
4. `node D:\Work\LAMDiceBot\AutoTest\qa-spin-slot-bias.js`
5. 렌더 하네스 `__PAYLOAD` 재생성: 일회성 node로 `require('./socket/spin-arena').simulate(...)` 호출 → reveal 형태 조립 → `AutoTest/spin-arena-render-harness.html`의 `window.__PAYLOAD=` JSON 치환 (3슬롯, 기존 형태 동일). 실브라우저 스모크: 에러 0, 검 길이 = 판정 길이 시각 확인, 같은 t 2회 픽셀 동일.
6. **dev 서버(5173) 재시작** (socket/* 변경 — 자동 리로드 없음) 후 `node D:\Work\LAMDiceBot\AutoTest\spin-arena-2tab-test.js`: 동일 reveal/당첨자, 하드 월 채택 시 링 밖 이탈 0.
7. 경마/사다리/주사위/룰렛 미파손: `node -c` 대상에 socket/index.js, server.js 포함 + 공유 파일 diff 0 확인.

## 모바일/PC

- 캔버스 논리 480×480 불변이라 시뮬·판정 변경은 화면 비의존. 클라 변경분(스파크 접촉점, 도신 파생 좌표, 링 연출 정리)은 렌더 하네스 + 2탭에서 확인. 새 UI 요소 없음.

## 보고 형식 (Coder 최종 보고에 포함)

1. 변경 요약 + 파일별 변경 내용
2. ② 결정(채택/폐기) + 분포 근거 수치
3. 최종 튜닝 수치 표 (before→after)
4. 200시드 분포 표 (h2~h6 정확히 1명 생존 % + 칼날킬 % + h2 0생존 %) + 군집 지표(평균 중심거리 or 첫 교전 시각 before/after)
5. 테스트 명령/결과 전부
6. 남은 이슈 / 수동 QA 체크리스트
7. 💡 lesson 후보 (새 함정 발견 시)
