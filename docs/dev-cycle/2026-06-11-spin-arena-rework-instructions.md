# spin-arena 게임성 개편 + 경마 패리티 — Coder 지시서

> 발주: 이더(하네스 COMPLEX 파이프라인). goal 원문: `d:\Work\LAMDiceBot\docs\goal\spin-arena-gameplay-rework-and-parity.md` (반드시 함께 읽을 것).
> Scout 정찰 완료 — 아래 행번호는 2026-06-11 현재 기준.

## 수정 파일

| 파일 | 내용 |
|------|------|
| `d:\Work\LAMDiceBot\socket\spin-arena.js` | A-1~A-6, C-1 서버 상수 |
| `d:\Work\LAMDiceBot\js\spin-arena.js` | 공유 상수 동기, A-2/A-3/A-5 클라, B-1~B-4, C-1~C-4 |
| `d:\Work\LAMDiceBot\css\spin-arena.css` | HP 패널, 카운트다운, 모바일 |
| `d:\Work\LAMDiceBot\spin-arena-multiplayer.html` | HP 패널 DOM, 채팅 오버레이 div, 튜토리얼 STEPS, 다시보기 버튼, js 캐시버스트 `?v=2` |
| `d:\Work\LAMDiceBot\assets\sounds\sound-config.json` | `spin-arena_bgm` 키 (additive) |
| `d:\Work\LAMDiceBot\AutoTest\spin-arena-determinism-test.js` | 가변 n/killerId 회귀 + 200시드 배치 확장 |
| `d:\Work\LAMDiceBot\AutoTest\spin-arena-render-harness.html` | `window.__PAYLOAD` 새 simulate 출력으로 교체 |

**수정 금지**: `js/shared/*` 전부(사용만), `socket/rooms.js`, `utils/room-helpers.js`, `routes/api.js`, `css/horse-race.css`, AdSense 블록 3곳, SEO/메타.

## 이더 확정 결정 (재질문 금지)

1. **COUNTDOWN_MS = 4000** (서버·클라 공유 상수). countdown-shared의 콜백은 '3','2','1','START!' 각 1000ms 후 발화 = 실측 4000ms. goal의 "예 3000"은 예시일 뿐 — 실제 클라 대기시간과 일치시키는 게 C-1의 목적. 서버 `endTimeout = COUNTDOWN_MS + GAME_MS + RESULT_HOLD_MS`.
2. **phase enum은 idle|playing|finished 3개 유지.** 카운트다운은 클라 로컬 상태 — `routes/api.js:174`가 `phase === 'playing'`을 직접 읽으므로 새 phase 값 추가 금지.
3. **칼날 수 경계 규칙**: 서버는 탈락 처리 직후 킬러 bladeCount++ (다음 틱부터 적용). 클라 공식 `bladeCount(si, t) = 2 + count(eliminations where killerId === si && timeMs < t)` — **strict `<`**. 서버 다음 틱 tMs > te와 정합.
4. **킬 크레딧**: 탈락 틱에서 피해자에게 칼날 데미지를 준 가해자 중 그 틱 기여 데미지 최대 슬롯, 동률이면 슬롯 id 낮은 쪽. 링 데미지만으로 죽으면 killerId = null. (HIT_DPS×dt 균일이라 동률이 기본 — tie-break가 거의 매번 발동함을 인지)
5. **넉백 구현**: 캐릭터별 넉백 속도 성분 `kvx, kvy` 분리 신설. 칼날 피격 시 칼끝→몸 단방향 임펄스 가산(상수 `KNOCK_IMPULSE`), 크기 상한 `KNOCK_MAX`, 지수 감쇠 `KNOCK_DECAY`. 적용 순서 고정: 데미지 루프에서 임펄스 가산 → 이동 단계에서 `(vx+kvx, vy+kvy)`로 위치 적분 → kv 감쇠. 전부 결정론(고정 배열 순회, Math.random 0).
6. **클라 렌더 넉백 KNOCK_PUSH(L450)**: 실제 넉백이 frames에 반영되므로 **제거**(0으로 두지 말고 코드 자체 정리 — 단 히트 스파크/셰이크 등 다른 피드백은 유지).
7. **스킨 피커 유지** + 자동 배정 기본. 색 배정 규칙(서버·클라 거울): users 배열(입장 순서)을 순회하며 명시 선택 스킨 우선, 없으면 free preset 순차 배정. 게임 슬롯 = readyUsers를 **users 배열 순서로** 정렬해 slice(0,6) — 미리보기 색 == 실제 게임 색 보장. (기존 "readyUsers 배열 순서=슬롯 순서" 계약을 users 순서로 옮길 것 — 서버 start L302와 클라 previewRoster L1169 동시에)
8. **데미지 숫자 색 단일** (흰/노랑 계열) — 칼날/링 구분은 모호하므로 하지 않는다. 키프레임(100ms) 경계마다 구간 감소량 합산 1개, 반올림 정수, 0 미표시. `spawnText` 재사용, 위치/타이밍 전부 t·frames 파생(2탭 픽셀 동일).
9. **HP 패널 위치 = 캔버스 아래** (`#spinArenaWrap` 내부), 모바일 컴팩트 가로 스택. 종료 후 최종 상태 유지, idle에서 숨김.
10. **다시보기**: gameEnd 시점에 `savedReveal` 별도 변수에 보관 (roundReset의 `spinReplay.payload = null`과 분리 — L1342~1356이 다시보기를 끊지 않게 가드). 결과 오버레이/게임 영역에 "다시보기" 버튼. 라이브 reveal 도착 시 다시보기 즉시 중단 + savedReveal 교체. 다시보기 중 사운드는 음소거(BGM/효과음 모두 스킵, 가장 단순).
11. **7명+ 초과자 안내는 클라 측**: reveal 수신 시 내가 준비했는데 slots에 없으면 gameStatus에 "준비 선착 6명 초과 — 이번 판은 관전입니다" 표시. 서버 emit 신설 없음.
12. **isBot 필드는 revealSlots에 false로 유지** (additive-safe). 봇 로직(SPIN_BOT_SKIN, 채움 루프)은 삭제하되 클라의 isBot 참조 분기는 정리(이름표 '봇', 회색 변형 등 — 죽은 코드 제거).
13. **튜닝 초기값** (A-6 배치가 권위 — 미달 시 조정): BLADE_SPIN_MIN 3.5 / MAX 6.0, DRIFT_SPEED 50, KNOCK_IMPULSE 90, KNOCK_MAX 140, KNOCK_DECAY 3.0/s. HIT_DPS/RING_DPS/RING_PHASE*는 분포 보고 보고 조정.

## A. 서버 (socket/spin-arena.js)

- **A-1**: L27 `BLADE_SPIN_MIN/MAX` 2.2/3.6 → 3.5/6.0 (배치 튜닝 대상).
- **A-2**: 데미지 루프 L141~157을 가해자별 기여 추적(`dmgBy[victim][attacker]`)으로 확장. tips 계산 L136~137의 `BLADE_COUNT` → 캐릭터별 `c.bladeCount` (시작 2). 탈락 L179~191에서 killerId 판정 → `eliminations.push({id, timeMs, x, y, killerId})` (additive). 킬러 bladeCount = min(5, +1). revealSlots L377의 `bladeCount: BLADE_COUNT`는 "시작 칼날 수 2" 의미로 유지.
- **A-3**: 봇 채움 L337~339 + SPIN_BOT_SKIN L59 삭제. **L91 `baseAng = (i / SLOT_COUNT)` → `(i / slots.length)`** (핵심 — 인접 스폰 방지). slice(0,6) L316 유지(상수명 `SLOT_COUNT` → `MAX_SLOTS` 개명 또는 주석 "최대 슬롯"). 슬롯 순서 = users 배열 순서 기반(결정 7). decided/allDone L124~131: 전원이 사람이므로 수렴하지만 결판 규칙(최후 1인 무적·1명 정지) 코드는 형태 유지.
- **A-4**: L41 `DRIFT_SPEED` 34 → 50 (튜닝 대상).
- **A-5**: 결정 5의 kvx/kvy 방식. simulate 내부만, export 시그니처 `simulate(slots, seed)` 유지.
- **A-6**: determinism-test의 배치 루프(L29~42) 확장 — 200시드 × h2~h6, "정확히 1명 생존" 비율 리포트. 기준 h2/h3 ≥ 95%, h6 ≥ 88%. 미달 시 HIT_DPS/RING_DPS/RING_PHASE*/KNOCK_IMPULSE/속도 조정 후 재돌림. **최종 수치를 보고에 표로 첨부.**
- **C-1**: 상수 `COUNTDOWN_MS = 4000` 추가(클라와 동일 값), L396~399 `setTimeout(endGame, COUNTDOWN_MS + GAME_MS + RESULT_HOLD_MS)`.

## B/C. 클라 (js/spin-arena.js + css + html)

- **공유 상수 동기**: 클라 상단 const 블록에 서버와 같은 값(COUNTDOWN_MS 포함, RING_PHASE* 등 튜닝 변경분 동기). **값 다르면 데싱크 — 양쪽 동시 수정.**
- **A-2 클라**: `bladeCountAt(si, t)` 단일 함수 신설(결정 3 공식, initSpinFx L1105에서 killerId 누적 사전계산 가능) — drawBladeSet 트레일 L727/본체 L749/타격감지 L886 **3곳 모두** 이 함수 사용. 킬 순간 칼날 스냅은 새 칼날 스폰 플래시(시각 전용, hash01 결정론)로 가림.
- **A-3 클라**: previewRoster L1169 — readyUsers 기반 → **currentUsers(입장 순서) 기반**, 준비자 강조(글로우/체크) + 미준비자 반투명. drawSpinIdleFrame L1188~1253 — 6슬롯 고정 → n 가변(빈 슬롯 봇 표시 삭제), 문구 L1249 "남는 자리는 봇이 채워요" → 새 모델 문구("준비하면 참가 · 최대 6명" 등 평이한 한국어). 시작 시 미준비 캐릭터 페이드 아웃.
- **A-5 클라**: KNOCK_PUSH 관련 코드(L450, L913~914, L982) 제거.
- **B-1**: drawBladeSet L726~765 — 선+끝원 → 검 형태(테이퍼드 도신+풀러+가드+힐트, 프로시저럴 벡터). 칼끝 = BLADE_RADIUS 지점 유지(서버 판정 일치). 칼날색 = 스킨 blade 색, 글린트/트레일 유지.
- **B-2**: 슬롯 루프 L843~865 부근에서 키프레임 경계 감지 → 구간 HP 감소량 합산 → spawnText. 결정 8.
- **B-3**: html `#spinArenaWrap`(L215~217) 안 캔버스 아래에 `#spinHpPanel` — 참가자별 이름+HP바+수치, rAF에서 보간 HP로 갱신, 탈락자 회색+순위. CSS는 spin-arena.css(미디어쿼리 패턴 L103~113 참조).
- **B-4**: horse-race.js L6178~6229 패턴 lift — html에 `<div id="raceChatOverlay">`를 spinArenaWrap 안에 추가(**같은 id 사용 → horse-race.css L1222~1256 CSS 무료**, 페이지별 link라 경마 무영향). MutationObserver로 `#chatMessages` 미러, textContent만(XSS). 리플레이 시작 시 show, 종료/리셋/중단 시 hide.
- **C-1**: reveal 핸들러 L1321 — 즉시 startSpinReplay → `showGameCountdown(컨테이너, () => startSpinReplay(data))`. 카운트다운 중 BGM 미재생. 다시보기에도 카운트다운 생략 가능(구현 단순한 쪽).
- **C-2**: html 인라인 `SPIN_ARENA_TUTORIAL_STEPS`(horse html L806~1021 패턴) + 도움 버튼 + roomJoined 1초 후 `TutorialModule.start('spin-arena', STEPS)`. FLAG_BITS 128 등록 완료 확인됨. 내용 = 새 참가 모델 기준(입장→캐릭터 표시→준비=참가→30초 생존전→킬마다 칼날+1(최대 5)→최후 생존자 당첨/벌칙).
- **C-3**: sound-config.json에 `"spin-arena_bgm": "assets/sounds/horse-race/bgm.mp3"` (기존 mp3 재활용, 새 파일 없음). startSpinReplay에서 `SoundManager.playLoop('spin-arena_bgm', enabled, 0.3)`, stopLoop는 리플레이 종료 L1096~1101 / roundReset L1342 / gameAborted L1358 / **pagehide(신규 핸들러)** 4곳.
- **C-4**: 결정 10.
- **html**: `<script src="/js/spin-arena.js?v=2">` 캐시버스트(현재 미부여 — 상수 재튜닝 배포 시 구클라 desync 방지).

## 불변조건 (절대 깨지 말 것)

- 소켓 이벤트 8개 이름 유지, payload는 killerId additive만.
- reveal 전 server-only(timeline/result/seed) 비노출 — rooms.js L177~181 화이트리스트에 아무것도 추가하지 마라.
- 결판 규칙(최후 1인 무적·전체 1명 정지), survivalKey 랭킹, selected=당첨=rank2/isWinner=false, gameRules 'spin-survival' 불변.
- 클라 Math.random 실호출 2회(deviceId/tabId) 유지 — 모든 신규 연출은 t·페이로드·hash01 파생.
- frames 길이 301(0~30000ms/100ms), triple 폭 n×3, 죽은 캐릭터 사망 위치 동결 유지.
- 준비 시스템/호스트 시작 버튼/시작 게이트(준비≥2)/주문/채팅/컨트롤바/통계/히스토리/결과 오버레이 동작 유지.
- 캔버스 논리 480×480. AdSense/SEO 블록 불변.

## 검증 (Coder가 직접 실행)

1. `node -c socket/spin-arena.js` + `node --check js/spin-arena.js` (server.js 등 미수정 파일 포함 전체)
2. `node AutoTest/spin-arena-determinism-test.js` — 동일 시드 동일 결과, frames 301, 폭 n×3, killerId 검증 추가
3. 200시드 배치 분포 리포트 출력 (h2~h6 "정확히 1명" 비율) — 기준 충족까지 튜닝 반복, 최종 수치 기록
4. `Select-String -Path js/spin-arena.js -Pattern "Math.random"` — 실호출 2회 유지 확인
5. render-harness `__PAYLOAD` 재생성(새 simulate 출력 — 가변 n 샘플, 예: h3)
6. 보고서: 변경 요약·파일·구현자 판단 사항(렌더 넉백 제거, 데미지 숫자 단일색, HP 패널 위치, COUNTDOWN_MS=4000 근거)·밸런스 최종 수치·남은 이슈·💡 lesson 후보

## 주의 (Codex 정찰 발견 함정)

- 클라는 reveal payload의 bladeCount/arena/ring 필드를 무시하고 전역 상수를 쓴다 — "payload에 넣었으니 동기됨" 착각 금지. 칼날 수는 클라가 eliminations.killerId에서 직접 산출.
- roundReset 핸들러(L1342)는 무조건 raf 취소 + payload null — 다시보기 분리 가드 필수.
- `spin-arena:start`는 phase 'finished'에서도 허용(즉시 리매치) — 기존 동작 유지.
- 리플레이 중 입장자가 auto-ready되는 것(rooms.js:977)은 **공유 코드라 수정 금지** — 기존 동작 수용.
- dev 서버(5173)는 자동 리로드 없음 — 소켓 수정 후 테스트 전 재시작 필요(2탭 테스트는 이더가 QA 단계에서).
