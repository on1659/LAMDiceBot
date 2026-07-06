# 회전 칼날(spin-arena) — 게임성 개편 + 경마 패리티 — Goal

spin-arena의 **게임 메커니즘을 개편**(칼날 속도/킬 성장/봇 제거·가변 인원/이동 속도/실제 넉백)하고, **경마 수준의 관전 UX**(칼 그래픽, 데미지 숫자, HP 패널, 채팅 오버레이, 카운트다운, 튜토리얼, BGM, 다시보기)를 입힌다. 서버 시뮬 변경이 포함되므로 **밸런스 재튜닝(200시드 배치)** 이 필수다. 새 feature 브랜치 권장.

> 전제/baseline: 비주얼 오버홀 완료 상태(`docs/goal/applied/spin-arena-juice-and-hit-feedback.md` — 타격 피드백/탈락·결판 연출/캐릭터 스프라이트 색치환/대기 미리보기). 캐릭터 스프라이트 = `assets/spin-arena/sprites/players-base.png`(blue-dominant 색치환 계약). 데이터 계약 = `docs/meeting/applied/2026-06-10-spin-arena-impl.md`.
>
> **사용자 확정 결정 (재질문 금지):** ① 진행 = 이 goal 한 방 ② 참가 모델 = **"준비=참가, 입장=표시"** ③ 칼날 증가 상한 = **5개** ④ 넉백 = **서버 시뮬에 실제 반영**. 또한 기존 goal의 "데미지 숫자 미표시" 결정을 사용자가 **명시적으로 뒤집음** — 이번엔 데미지 숫자를 표시한다.

## 한 줄 요약

① 게임성: 칼날 회전↑·이동속도↑·킬당 칼날 +1(상한 5)·서버 실제 넉백·봇 제거(사람 n명=캐릭터 n명) + 200시드 재튜닝 ② 비주얼/UI: 칼(sword) 그래픽·데미지 숫자 플로팅·HP 현황 패널·채팅 화면 오버레이 ③ 경마 패리티: 3-2-1 카운트다운·튜토리얼·BGM·다시보기.

## A. 게임성 — 서버 시뮬 변경 (socket/spin-arena.js + js/spin-arena.js 공유 상수 동기)

### A-1. 칼날 회전속도 상향
- 현재 `BLADE_SPIN_MIN 2.2 ~ BLADE_SPIN_MAX 3.6 rad/s`가 너무 느림. **체감 1.5~2배** 수준으로 상향(예 3.5~6.0)하되 최종 수치는 A-6 배치 튜닝으로 확정.

### A-2. 킬당 칼날 +1 (상한 5) — 핵심 신메커니즘
- 시작 2개 → 내 칼날이 누군가를 탈락시키면 +1 (2→3→4→5, **상한 5**).
- **킬 크레딧 판정(서버 시뮬)**: 탈락 틱에서 그 캐릭터에게 칼날 데미지를 준 가해자 중 **그 틱 기여 데미지가 가장 큰 슬롯** (동률이면 슬롯 id 낮은 쪽 — 결정론 tie-break). 링 데미지만으로 죽으면 킬 크레딧 없음.
- **클라 동기 계약**: `eliminations[]`에 `killerId`(없으면 null) 필드를 **추가**(additive — 기존 필드 불변). 클라는 `bladeCount(slot, t) = 2 + (t까지 그 슬롯의 킬 수)`를 eliminations에서 결정론 산출 — frames 페이로드 증가 없음.
- **칼날 배치 규칙(서버·클라 동일)**: 항상 `angle_k = baseAngle + spinDir·spinSpeed·(t/1000) + k·(2π/bladeCount(t))`. 킬 순간 칼날이 재배치(snap)되는 것을 허용 — 클라는 그 순간 새 칼날 스폰 플래시(시각 전용)로 자연스럽게 가린다.

### A-3. 참가 모델 개편 — "준비=참가, 입장=표시" (봇 제거)
- **입장 = 표시**: 방에 들어오면 즉시 아레나 미리보기에 내 캐릭터가 등장(색 자동 배정 — 입장 순서 기반 결정론). 기존 "준비 기반" 미리보기를 "입장 기반 표시 + 준비한 사람 강조(예: 글로우/체크), 미준비자는 반투명"으로 수정.
- **준비 = 참가**: 실제 게임 참가자는 시작 시점 준비자만. 준비 안 한 사람은 관전(시작 시 그 캐릭터는 미리보기에서 퇴장 연출 또는 페이드).
- **봇 제거**: `SLOT_COUNT 6` 고정 폐기 → **참가자 수 n(2~6) 가변**. `SPIN_BOT_SKIN`/봇 슬롯 채움 로직 삭제. frames triple 폭 = n×3. 시작 게이트(준비 ≥2)·준비 시스템·호스트 시작 버튼은 그대로.
- **스킨**: 미리 고르기 강제 없음 — 입장 시 자동 배정이 기본. 기존 스킨 피커는 "원하면 바꾸기" 옵션으로 유지/축소/제거 중 구현자 판단(서버 `selectSkin` 계약 유지가 가장 단순하면 유지 권장). 6스킨 색 정체성·봇 회색 변형은 색치환 파이프라인에 이미 있음.
- 인원 7명+ 방: 준비 선착 6명만 참가(기존 `slice(0, 6)` 의미 유지) — 초과자는 관전 안내.

### A-4. 이동속도 상향
- 현재 `DRIFT_SPEED 34 px/s` → 체감 1.5배± 상향. 최종 수치는 A-6 튜닝으로.

### A-5. 서버 시뮬에 실제 넉백
- 칼날 피격 틱마다 가해 칼날끝→몸 방향으로 **속도 임펄스**(상수 예: `KNOCK_IMPULSE`)를 실제로 가함 → 위치가 진짜 바뀌고 링 밖으로 밀려나는 변수 발생. 감쇠/상한 포함, 전부 결정론 시뮬 내부.
- 클라의 기존 **렌더 전용 넉백 저크(KNOCK_PUSH)** 는 실제 넉백과 이중으로 읽히지 않게 줄이거나 제거(구현자 판단, 보고에 명시).

### A-6. 밸런스 재튜닝 (필수 게이트)
- 위 변경 전부 적용 후 **200시드 배치 시뮬**로 "30초 내 사람 최후 1인" 분포 재검증. 기준: **h2/h3 ≥ ~95%, h6 ≥ ~88%가 정확히 1명 생존**(기존 h2/h3 ~98%, h6 ~90%에 준함). 미달 시 `HIT_DPS`/`RING_DPS`/링 수축 타이밍(`RING_PHASE*`)/`KNOCK_IMPULSE`/스핀·이동 속도를 조정해 재돌림.
- 결판 규칙(사람 최후 1인 무적·전체 1명 정지)과 survivalKey 랭킹·selected(당첨) 의미·DB 기록 시맨틱은 **불변**.

## B. 비주얼/UI — 클라 (js/spin-arena.js + css/spin-arena.css + spin-arena-multiplayer.html)

### B-1. 칼(sword) 그래픽
- 현재 "선 + 끝 원" → **검 형태**(블레이드(테이퍼드 도신+풀러)+가드+힐트, 프로시저럴 벡터)로. 칼날색 = 스킨 blade 색 유지, 금속 글린트/트레일 유지. 충돌 시각 기준점(칼끝 = BLADE_RADIUS 지점)은 서버 판정과 일치하게.

### B-2. 데미지 숫자 플로팅
- HP가 깎일 때 캐릭터 위로 **-5, -4** 같은 수치가 떠오른다. HP 최초 100 유지.
- 산출(결정론): frames는 100ms HP 키프레임이므로 **키프레임 경계마다 그 구간 감소량을 합산해 1개 숫자**로 표시(틱 단위 스팸 방지). 반올림 정수, 0이면 미표시. 색: 칼날 데미지 추정(칼끝 근접) = 흰/노랑, 링 데미지 = 붉은 계열(구분 모호하면 단일색 — 구현자 판단).
- 기존 플로팅 텍스트 인프라(`spawnText`) 재사용.

### B-3. HP 현황 패널 (캔버스 밖)
- 리플레이 중 참가자별 **이름 + HP바 + 수치**를 보여주는 패널(캔버스 아래 또는 옆, 모바일은 컴팩트 가로 스택). 보간 HP로 실시간 갱신, 탈락자는 회색 처리 + 탈락 순위 표시. idle/종료 시 숨김 또는 최종 상태 유지(구현자 판단).

### B-4. 채팅 화면 오버레이 (경마 패턴)
- 경마 `raceChatOverlay`/`showRaceChatOverlay()`(js/horse-race.js 6178행대, MutationObserver로 `#chatMessages` 미러) 패턴을 lift — 리플레이 중 캔버스 위로 최근 채팅이 올라온다. 종료/리셋 시 해제. XSS: 기존 패턴 그대로(노드 복제) — 사용자 입력 innerHTML 삽입 금지.

## C. 경마 패리티 — 클라 (+ 서버 타이밍 상수 1개)

### C-1. 3-2-1 카운트다운
- 경마 카운트다운(js/horse-race.js 4080행대, countdown-shared.js) 패턴으로 reveal 수신 → 아레나 위 3-2-1 → 리플레이 시작.
- **타이밍 동기(중요)**: 서버 `endTimeout = GAME_MS + RESULT_HOLD_MS`에 **`COUNTDOWN_MS`(예 3000)를 더한다** — 서버·클라 공유 상수로 추가(양쪽 동일 값). 카운트다운만큼 클라 리플레이가 늦게 시작해도 gameEnd/roundReset이 리플레이를 침범하지 않게.

### C-2. 튜토리얼
- `SPIN_ARENA_TUTORIAL_STEPS` + TutorialModule(경마 1003행대 패턴). `FLAG_BITS['spin-arena'] = 128` 이미 등록됨. **내용은 개편된 참가 모델 기준**(입장하면 캐릭터 생김 → 준비하면 참가 → 시작하면 30초 생존전 → 칼날은 킬마다 늘어남 → 최후 생존자가 당첨/벌칙).

### C-3. BGM
- `spin-arena_bgm` 키를 `assets/sounds/sound-config.json`에 추가(기존 mp3 재활용 우선 — 예 horse-race/bgm.mp3 또는 분위기 맞는 common). 리플레이 시작 `playLoop` → 종료/리셋/중단/페이지 이탈 `stopLoop`. ControlBar 사운드 토글·마스터 볼륨 존중(경마 패턴).

### C-4. 다시보기
- 게임 종료 후 "다시보기" 버튼 — **클라가 보관한 마지막 reveal 페이로드로 로컬 재생**(서버 변경 불필요). 다음 판 시작/새 reveal 도착 시 비활성·교체. 다시보기 중 라이브 reveal이 오면 즉시 중단하고 라이브 우선. 사운드는 작게 또는 음소거(구현자 판단).

## 공정성 (절대 불변)
- 결과는 **서버 결정론 시뮬에서만** 결정(시드 PRNG, 동일 시드 = 동일 frames/eliminations/result). 넉백·칼날 성장도 전부 서버 시뮬 안.
- 클라 `Math.random` 결과 영향 0회 유지(deviceId/tabId 외 — 현재 2회). 이펙트/숫자/패널 전부 리플레이 t·페이로드에서 파생(2탭 동일).
- reveal 전 server-only(timeline/result/seed) 비노출·재진입 마스킹 유지. `eliminations.killerId` 추가는 reveal(공개 시점) 페이로드라 OK.
- 자동 색 배정·스킨은 순수 외형(결과 무관) 유지.

## 기존 통합 유지 (스킵 금지)
- 주문/준비/채팅/컨트롤바/통계/랭킹/사운드/히스토리/결과 오버레이 계속 동작.
- 소켓 계약: 기존 이벤트 이름 유지. payload 변경은 additive만(killerId). DB 기록(selected=당첨=rank2/isWinner=false) 시맨틱 불변.
- 직전 작업 산출물과 통합: 타격 피드백 스택/탈락·결판 연출/캐릭터 스프라이트 색치환/대기 미리보기(참가 모델에 맞게 수정).

## 작업 방식
- 먼저 읽을 것: `socket/spin-arena.js`(simulate/start/endGame), `js/spin-arena.js`(drawSpinFrame/미리보기/스프라이트), `js/horse-race.js`(카운트다운 4080행대, 채팅 오버레이 6178행대, BGM·튜토리얼 패턴), `js/shared/countdown-shared.js`, `docs/GameGuide/lessons/_common.md`, `.claude/rules/new-game.md` §7.
- 서버·클라 공유 상수는 **양쪽 파일 상단 const 블록 동시 수정** — 값 다르면 데싱크.
- 가변 슬롯(n=2~6)으로 frames 인덱싱(si*3)·미리보기·HP패널·결과 전부 n 기준으로 일반화. SLOT_COUNT 상수는 "최대 슬롯(6)" 의미로 개명 또는 주석 명확화.
- 모바일·PC 양쪽: HP 패널 컴팩트 모드, 채팅 오버레이 가독성, 카운트다운 크기. 캔버스 논리 480×480 유지.
- **소켓 변경 → dev 서버 재시작 필수**(MEMORY: node server.js 자동 리로드 없음, 현재 5173에 떠 있음).

## 테스트
- `node -c socket/spin-arena.js js/spin-arena.js` + 공정성 grep(`Math.random` 실호출 2회 유지).
- **결정론 회귀 갱신**: `AutoTest/spin-arena-determinism-test.js`를 새 시그니처(가변 슬롯/killerId/넉백/칼날 성장)에 맞게 갱신 — 동일 시드 동일 결과, frames 길이 301, triple 폭 n×3.
- **밸런스 배치**: 200시드 × h2~h6 분포 리포트(A-6 기준 충족 수치를 보고에 첨부).
- **렌더 하네스 갱신**: `AutoTest/spin-arena-render-harness.html` 페이로드 재생성(새 simulate 출력) → 실브라우저 스모크(에러 0, 칼 그래픽/데미지 숫자/HP패널/카운트다운/채팅 오버레이 페인트, 같은 t 2회 렌더 픽셀 해시 동일).
- 로컬 5173 + 2탭: 입장 즉시 캐릭터 표시 → 준비 강조 → 시작 → 카운트다운 → 30초 리플레이(칼날 성장/넉백/데미지 숫자/BGM/채팅 오버레이) → 동일 당첨자 → 다시보기 → 다음 판. 경마/사다리/주사위/룰렛 미파손.

## 완료 기준 (하나라도 미완이면 완료 아님)
- A-1~A-6 전부: 봇 없는 n인 게임 + 킬 성장(상한 5) + 실제 넉백 + 상향된 속도감, 200시드 분포 기준 충족(수치 보고).
- B-1~B-4 전부: 칼 그래픽·데미지 숫자·HP 패널·채팅 오버레이 동작.
- C-1~C-4 전부: 카운트다운(서버 타이밍 동기 포함)·튜토리얼·BGM·다시보기 동작.
- 공정성·결정론 회귀 통과(갱신된 테스트), 2탭 동일, 모바일/PC 프레임 안정.
- update-log.md 기록(평이한 한국어). 새 리소스(사운드 키/이미지) 여부 명시.
- 마지막 보고: 변경 요약·파일·테스트 명령/결과·밸런스 튜닝 최종 수치·자체 평가·남은 이슈.

## 막힘 기준
- 속도/임펄스/DPS 등 수치는 배치 시뮬 분포가 권위 — 기준 충족하는 가장 단순한 조합 선택 후 보고에 수치 명시.
- 킬 크레딧 동률·동시 탈락 등 엣지는 결정론 tie-break(슬롯 id) 우선, 선택 근거 보고.
- 스킨 피커 유지/축소, 렌더 넉백 잔존 여부, HP 패널 위치, 데미지 숫자 색 구분은 구현자 판단 — 결정과 사유만 보고.
- 카운트다운-서버 타이밍이 예상과 다르게 충돌하면(예: 재진입) 가장 단순·안전한 쪽(서버 상수 가산)으로 정하고 보고.
- 테스트 불가 시 구현은 완료하되 막힌 지점 + 수동 QA 체크리스트.

## 참고
- baseline: `docs/goal/applied/spin-arena-juice-and-hit-feedback.md`, `docs/meeting/applied/2026-06-10-spin-arena-impl.md`, `socket/spin-arena.js`, `js/spin-arena.js`, `css/spin-arena.css`
- 경마 패턴: `js/horse-race.js`(카운트다운 4080행대 / 채팅 오버레이 `showRaceChatOverlay` 6178행대 / BGM stopLoop 3411행대 / 튜토리얼 1003행대), `js/shared/countdown-shared.js`
- 사운드: `assets/sounds/sound-config.json`(`horse-race_bgm` 26행 선례), `docs/GameGuide/02-shared-systems/SOUND-SYSTEM.md`
- 규칙: `.claude/rules/new-game.md` §7 공정성, `docs/GameGuide/lessons/_common.md`, `.claude/rules/backend.md`
- 테스트 선례: `AutoTest/spin-arena-determinism-test.js`, `AutoTest/spin-arena-render-harness.html`, `AutoTest/gen-juice-report.js`
