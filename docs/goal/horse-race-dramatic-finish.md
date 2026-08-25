<!-- /autoplan restore point: C:\Users\user\.gstack\projects\on1659-LAMDiceBot\main-autoplan-restore-20260825-181553.md -->
# 경마 레이스 디렉터 — 결과 선결정 + 드라마 스크립트 재작성

상태: **리뷰 완료 · 범위 재결정 (2026-08-26)** — 스톱갭(기믹 창 0.95 + 시뮬 상한 90s)
**즉시 적용됨** (`feature/horse-race-director`). ② 조건부 "경계 낮잠" 기믹(반나절, A안형)은
사용자 지시 대기. B안 전면 재작성 플랜(이하 전체)은 리뷰 완료 상태로 **보관** — 스톱갭
운영 후 아쉬우면 재개.

## 사용자 결정 (2026-08-25 전제 게이트)

| 항목 | 결정 |
|------|------|
| 접근 | **B안 — 결과 선결정 + 드라마 궤적 역산 (전면 재작성 승인)** |
| 드라마 종류 | **전부** (D1 선두 낮잠 · D2 막판 이벤트 · D3 접전 유지 · D4 2등 스퍼트) — 동시 아님, 확률 발동 |
| 발동 빈도 | 중간 (~30-35%) — config 상수 |
| 부가 조건 | 재작성 과정에서 dead code 일괄 정리, **공정성 훼손 절대 금지** |

## 문제

사용자 원문: "1등이 직전에 잠들어서 못 온다거나, 중간 등수가 갑자기 뒤로 간다거나 —
아쉬운 게 자꾸 앞에서 이미 결과가 빤히 보인다."

버그가 아닌 게임 필(feel) 결함: 중반이면 승자가 사실상 확정되어 보이고,
마지막 15%는 긴장감 없는 행진이다.

## 현재 구조 진단 (코드 근거)

- 서버가 레이스를 프레임 단위로 시뮬레이션해 순위 산출 (`socket/horse.js`
  `calculateHorseRaceResult`), 클라가 같은 시드로 동일 시뮬 재생
  (`js/horse-race.js:4421` — 서버 :523과 동일 LCG, 16ms 고정 스텝).
- **단, 순수 물리-우선이 아니다**: 클라는 이미 서버 순위를 강제한다 — 상위 순위 말이
  결승선 미통과면 하위 말을 결승선 앞에서 자빠뜨려 세운다
  (`js/horse-race.js:4455-4474` finishStun). 현행도 절반은 결과-우선 연출이며,
  B안은 이 경향의 정직한 완성이다.
- 결과가 빤히 보이는 원인:
  1. 기믹 트리거 창 `[0.10, 0.85]` — 마지막 15% 무변동 (`config/horse/race.json`).
  2. 속도 스프레드 좁음 (85~95km/h) + 요동 평균 회귀 → 격차 단조 누적.
  3. 기믹 지속 짧음 (300~2000ms / 레이스 19~42초).
  4. 역전 장치는 진화(p=0.06, 꼴찌 부스트)뿐 — 선두 붕괴 장치 없음.
  5. 결승 슬로모션은 확정된 결말을 늘일 뿐.
- 승리 규칙은 first/last 둘이 아니다 — **등수 투표 룰렛**(`userRankVotes` →
  `resolvedTargetRank`, `socket/horse.js:755-796`)으로 임의 등수가 판돈 경계가 된다.
- 스포일러: `horseRaceStarted`가 `rankings`/`winners`/`speeds`/`horseRankings`/`record`
  (내부 중첩 포함)를 애니메이션 전에 평문 전송 — DevTools 선열람 가능 (기존 노출).

## 설계 v2 — Race Director (CEO 리뷰 반영)

### 드라마 2층 구조 (F-1 — critical 반영)

- **L0 베이스라인 계약 (매판 적용)** — "드라마 없어도 심심하지 않은 판"이 목표.
  - 진행 90%까지 선두-2위(정확히는 stakeRank 경계) 격차 상한 (config, px)
  - 판당 선두 교체 최소 N회 (스크립트 저작 제약)
  - 종반 0.85~0.97에도 소형 기믹(연출) 배치 — 진단 1번의 직접 해소
  - KPI: "승부 확정 가시화 시점"(최종 승자가 선두를 굳히는 진행률) 분포를 구/신 비교
- **L1 빅 피날레 비트 (판당 ~30-35%)** — D1~D4 중 배타적 1개.
  **⚠️ 모든 비트는 1·2등(포디움)이 아니라 stakeRank 경계(당첨이 갈리는 등수) 기준이다**
  (2026-08-26 게이트에서 사용자 재확인 — "1,2등이 아니라 특정되는 등수가 중요"):
  - D1 **경계 낮잠**: stakeRank 자리를 차지한 듯 보이던 말이 💤 잠들어 경계 밖으로 밀림
    — first 모드 = 선두 낮잠, last 모드 = "안전해 보이던 말이 잠들어 꼴찌행",
    룰렛 N등 판 = N등 자리 낮잠 → 진짜 당첨마가 그 자리로 미끄러져 들어옴
  - D2 막판 이벤트: 종반 구간(0.85~0.97) 기존 기믹류(슬립·역주행·부스트) 대형 배치
    — **경계 인접 말 우선** (경계 무관 말의 대형 이벤트는 낭비)
  - D3 경계 포토피니시: **경계 그룹** 3+마리 초박빙 유지 → 📸 판독
  - D4 경계 스퍼트: 경계 밖 추격자가 최후 스퍼트로 **정확히 stakeRank 안으로** 진입
    (first 모드의 "2등 스퍼트"는 이것의 특수형)

### 패턴 발각 방지 (F-7)

- 비트 파라미터 지터: 낮잠 지점·대상·지속을 범위로 (85% 고정 금지)
- 방 단위 최근 비트 기억 → 동일 비트 연속 발동 억제
- 비트 라이브러리는 config 데이터 (`config/horse/drama.json` 신설) — 추가가 코드
  작업이 아니게
- 발동률 설계 상한 주석: ≤0.40 (드라마는 평범한 판과의 대비로만 성립 — F-9)

### stakeRank 일반화 (F-4 — critical 반영)

- `generateRaceScript(rankings, stakeRank, dramaConfig)` — stakeRank = first면 1,
  last면 꼴등, 등수 투표 룰렛이면 `resolvedTargetRank`.
- L0 격차 상한·L1 비트 전부 **stakeRank 경계에 상대적으로** 배치 (3등 찾기 판이면
  3등 경계가 접전이어야 한다). 1·2등 포토피니시는 stakeRank=1일 때의 특수형.

### 서버 (socket/horse.js — 레이스 생성층 교체)

```
1) drawRankings()
   - **베팅된 말 집합에만** 균등 확률 순열 추첨 (crypto 기반) — 무베팅 말은 그 뒤
     (인덱스 순) 고정 + 스크립트에서 정지 인코딩 (E-C1: 현행 unbetted_stop과 동치.
     전체 말 추첨이면 first 모드에서 무베팅 말 1등 → 당첨자 0명 사고)
     · 중복 베팅(canSelectDuplicate) 시에도 말 단위 추첨 = 현행 시뮬과 동치 (명문화)
     · 가중치 훅 지원, 기본값 균등 — 날씨/탈것 특성의 미래를 막지 않되 지금은 미사용
   - 완주 시간 타깃: 트랙 프리셋 duration 범위 내, L0 격차 프로파일 적용
   - **runnerCount 전제조건 표** (E-C1): 달리는 말 수(베팅 unique)별 가용 비트 —
     D3는 3+마리, L0 선두 교체는 2+마리, 1마리(allSameBet)는 독주 쇼 전용 등
2) generateRaceScript(rankings, stakeRank, dramaConfig)
   - 막 구성: 서장(0~30%) → 중반 셔플(30~70%) → 종반 드라마(70~100%)
   - 출력: per-horse 조각별 속도 키프레임 + 이벤트 마커([{t, horse, type}])
     + timeScale 트랙(슬로모션도 스크립트 소유)
3) validateScript() — 재생 1회로 단언:
   - 완주 순서 == 추첨 순위 / 순간이동 없음(속도 상한) / 완주 시간 오차 내
   - L0 계약 충족 (격차 상한·선두 교체 횟수) / 무원인 델타 검출 / 슬로모 예산
   - **timeScale 반영 wall-clock 총 재생 길이 산출** (워치독·타이밍 가드의 canonical 값)
   - 위반 시 스크립트만 재생성 (상한 N회) — **drawRankings 결과는 불변** (F-6:
     재추첨 금지, 균등성 보존)
   - **제약 완화 사다리** (해 불능 조합 대비 — short 트랙 × 6마리 등에서 L0 격차
     상한+완주 시간 오차 동시 만족 불가 가능): L1 비트 드롭 → L0 완화 → 무드라마
     기본 스크립트 폴백. **폴백률 로그 + 임계 경고 필수** (E: 조용히 "드라마 없는
     게임"으로 회귀하고 아무도 모르는 사고 방지)

4) 스크립트 평가 모듈 단일화 (E-C2 — dual-sim 표류 재생산 금지)
   - `js/shared/race-script-engine.js` 신설: 키프레임 보간·마커 판정·완주 세만틱
     (오른쪽 끝 판정·visualWidth·2단계 완주·150ms 최소 간격)을 **한 모듈**로
   - UMD 스타일 (CommonJS export + 브라우저 전역) — 서버 validateScript와 클라
     재생기가 **같은 코드**를 소비. js/shared 크로스게임 검증 규칙 적용
   - 마커 타입 어휘는 2계층 (E-C3): {비트 프리미티브 8종} ∪ {legacy 기믹 시각 타입
     (wobble 지그재그·reverse scaleX·slip·아이템 아이콘 등)} — D2·L0 소형 기믹이
     기존 어휘를 요구한다
```

### 클라이언트 (js/horse-race.js — 시뮬 제거, 플레이어로 전환)

- 미러 물리 시뮬(LCG·기믹 트리거·진화 로직·finishStun 순위 강제) 제거 →
  **키프레임 보간 재생기** (스크립트가 이미 순위를 보장하므로 강제 불필요)
- 이벤트 마커 → 시각 연출(💤 등)·**중계 멘트**(`js/horse-race-commentary.js` 비트
  연동 — F-2 반영: 베팅 유저 이름 호명 등 리액션 증폭, in-scope)·사운드 구동
- 슬로모션·카메라는 스크립트 timeScale/마커 소비 (자체 판정 제거)
- 기존 유지: 선택 UI·베팅·등수 투표 룰렛 연출·결과 오버레이·PiP(C-35 준수)·
  코스메틱·관전 catchup·숨김 탭 처리(아래 계약 변경 참조)·**다시보기**(F-13:
  record를 raceScript 저장으로 전환, 구포맷 레코드는 "다시보기 불가" 안내)

### 소켓 계약 변경 (화이트리스트 + 전 채널 봉인 — F-14/E-B1 수정판)

**결과 유출 채널은 하나가 아니다 — 3채널 전부 봉인해야 화이트리스트가 유효하다:**

1. `horseRaceStarted`: 허용 필드 **열거형 화이트리스트** — 결과 유도 필드
   (rankings/winners/speeds/horseRankings/record/evolutionTargets) 전부 제거,
   `raceScript` + 선택/코스메틱/트랙 정보만. 잔여 노출(수용): raceScript 자체가
   결말 함의 — 현행 노출과 동급, 정직하게 문서화. 스트리밍/청크는 TODOS 이연
2. **`getCurrentRoom` 재입장 채널 (E-B1 — 현행 경마 마스킹 0줄)**: `...gameState`
   스프레드에 경마 마스크 신설 — `pendingRaceResult`(winners·rankings·**coinRef**
   노출 중) 제거, 진행 중 라운드 record의 결과 필드 제거, **Node Timeout 핸들**
   (`horseRaceCountdownTimeout`/`horseRouletteTimeout` — room-helpers 경고 위반
   기존 결함) 직렬화 제외
3. **`joinRoom`/`createRoom` payload**: `horseRaceHistory`·`horseRankings` 명시
   필드 — 진행 중 판의 결과 필드 마스킹

**record 라이프사이클 (catchup 계약 보존)**: 레이스 시작 시 **스텁 record**
(id/round/players/bets만) push — 재접속 same-round 판별(`record.id ∈ history`,
`js/horse-race.js:6487`)이 이것에 의존한다. 결과·script 필드는 settle에서 병합.

**정산 이벤트 흐름 (E-A2 — 현행 진단 정정)**: 정상 정산(`settleRace`)은 현재
`horseRaceResult`를 **emit하지 않는다** (newMessage + horseRaceEnded만; :1788의
유일 emit은 도달 불가 좀비 경로). 재작성에서:
- settle 시 `horseRaceResult`(rankings/winners/record 결과부)를 **신규로 정식 emit**
- 클라 결과 오버레이(`showRaceResult` — 현재 시작 payload의 winners를 읽음)는
  이 이벤트를 공급원으로 재배선, **오버레이 게이트 = 로컬 재생 완료** (먼저 정산돼도
  재생 중인 클라에서 조기 오버레이 금지)
- `raceAnimationComplete` 핸들러 무장 (E-D1): `ctx.checkRateLimit()` 추가 (현행
  누락 — backend.md 위반) + **타이밍 가드** — `startedAt + scriptWallMs − ε` 이전
  complete 무시 (현행에도 존재하는 조기 정산 그리핑 벡터를 스크립트 체제가 처음으로
  봉쇄 가능)

**워치독 (E-B4)**: `validateScript`가 **timeScale 반영 wall-clock 총 재생 길이**를
canonical 값으로 산출 → `watchdog = scriptWallMs + max(HORSE_SETTLE_GRACE_MS,
catchup 허용치)`. 고정 60s 폐기. (스크립트가 짧아질 때 grace가 catchup을 못 덮으면
복귀 클라 완주 전 정산→스포일 — 현행보다 잦아지는 회귀 방지)

**history 브로드캐스트 증폭 방지 (E-B3)**: `horseRaceEnded`·입장 payload의 history
(최대 100건)에서 **script 본문 제거** (id+요약만) — script는 record당 수십 KB로
판마다 수 MB 브로드캐스트가 되는 구조. 다시보기는 **on-demand fetch**
(`horse:getReplay {recordId}` — checkRateLimit 필수). script 보존 상한 N건.

**단계 전환 규칙 (E-B2)**:
- Phase 2 (서버 이중): legacy 필드(gimmicks+speedSeeds) 유지 + rankings만 draw로
  오버라이드 → 구클라 finishStun 발동 빈도 증가를 **수용·고지** (일상 케이스화)
- 혼재 방(구/신 클라)의 시각 불일치(최종 순위만 동일) **수용 항목으로 명시**
- **서버 config 킬스위치**: 드라마 off / 레거시 payload 재emit — 새벽 장애 시
  git revert 배포가 유일한 롤백이면 안 된다
- 배포 창 구버전 탭: payload 버전 필드 + 안내/리로드 유도 (C-40 계열)

### Race Presentation Contract (디자인 리뷰 반영 — 구현 전 확정 계약)

**L0 겸손 원칙 (D-C2 — L0/대비 모순 해소)**: L0은 "지루함 방지 하한"이다.
격차 상한은 진행 **~75%까지만**, 상한값은 관대하게(화면 이탈 방지 수준), 선두 교체
최소 **1회**. **독주 판 허용 비율 config** (기본 10-15% — 격차 상한 미적용, 압도적
1등 서사도 재미 어휘). 종반 박빙은 L1 비트의 전유물 — 매판 접전이면 접전이 죽는다.

**카메라 소유권 (D-C1)**:
- 마커에 `cameraHint` (대상 말 · 홀드 ms · 강제 여부) 포함
- **L1 비트 구간은 사용자 카메라('내 말' 포함) 강제 오버라이드** + "📷 하이라이트
  카메라" 배지 고지 (`showCameraModeOverlay` 관례 재사용), 비트 종료 후 사용자
  모드 복원. L0 소형 기믹은 오버라이드 없음
- 종반 카메라 기본 타깃: "선두" → **"stakeRank 경계 그룹"** 재정의
  (3등 찾기 판이면 결승 락 카메라도 3등 경계를 잡는다)

**stakeRank 경계 HUD**: "N등 경계 · Xm 차" 상시 HUD + 미니맵 경계 하이라이트.
미니맵에 낮잠 💤 점 등 비트 상태 반영 (모바일 풀바 미니맵 저비용 고효율).

**비트 스토리보드 (텔레그래프 → 발동 → 해소, 비트당 3막 의무)**:

| 비트 (전부 stakeRank 경계 기준) | 텔레그래프 | 발동 | 해소 |
|------|-----------|------|------|
| D1 경계 낮잠 | 하품/휘청 ~1초 (졸음 신호) — 경계 자리 점유마 | 정지 + rest 스프라이트(기존 stop 기믹 재사용) + 💤 말풍선 루프 + 스포트라이트 | 경계 밖으로 밀린 뒤 **화들짝 기상 → 허둥지둥 늦은 스퍼트 완주** (코미디 마무리 — 잠든 채 방치 금지) |
| D2 막판 이벤트 | 기존 기믹 예고 큐 재사용 | 기존 기믹 이펙트 — "대형" = 지속 상향 + 트랙 전역 큐 동반, 경계 인접 말 우선 | 경계 순위 변화를 중계가 확인 |
| D3 경계 포토피니시 | 70%부터 경계 그룹 3+마리 한 프레임 유지 | 경계 확정 순간 플래시 + **프리즈 프레임 + "📸 판독 중..." ~1.5초 홀드** | 순위 리빌 (판독 발표 — "N등은...!") |
| D4 경계 스퍼트 | 경계 밖 추격자 충전 신호 (전용 오라 — 기존 sprint 불꽃과 구분) | 스퍼트 + timeScale | 경계 진입 성공/간발 실패를 명확히 해소 |

**무원인 속도 변화 금지 (D-H3)**: 체감 임계 이상의 모든 속도 키프레임 변화에는
원인 마커(기믹 이펙트) 동반 필수. `validateScript()`에 "무원인 델타 검출" 단언 추가.

**중계 계약 (D-H4)**:
- 비트 자막은 **트랙 안 캡션 레이어** (`raceTrackWrapper` 내부 — 전체화면·PiP 자동
  동반. 현행 `gameStatus`는 래퍼 밖이라 두 모드에서 부재 — 앰비언트 전용으로 격하)
- 비트당 **멘트 시퀀스**(마커 시각 오프셋 포함)를 `drama.json` 비트 정의에 포함 —
  단발 3초 로테이션으로는 4문장 서사(조짐→잠듦→추월→결말) 불가
- 비트 중 앰비언트 랜덤 멘트 억제. 앰비언트 풀의 사실 주장형 라인("어? 1번
  졸고있는데요?" `js/horse-race-commentary.js:23`) 제거 또는 비트-인지형 게이트
  (양치기 소년 방지)

**호명 정책 (D-H6)**: 상승 비트(역전·스퍼트·당첨)는 유저 실명 호명, **하강
비트(낮잠·슬립)는 탈것 이름만** — 서버가 각본 쓴 굴욕 순간에 실명 금지.
중복 베팅 호명 포맷 명시. 비트 대상 선정은 베팅 분포 입력 → 베팅된 말·경계 인접
말 우선 (연출 대상 선정이므로 공정성 무손상 — 주석 명문화).

**연출 프리미티브 어휘 (D-M12)**: 닫힌 집합 ~8개로 비트를 조합 표기 —
정지+수면 루프 / 버스트(스퍼트) / 스포트라이트 / 비네트 / timeScale / 카메라 컷 /
멘트 슬롯 / 사운드 큐. 신규 비트 = 프리미티브 조합 + 파라미터 (이래야 "비트 추가가
코드 작업이 아니게"가 참이 된다). D1~D4 전부 이 어휘로 표기 가능함을 확정.

**비트 가중 차등 (디자인 감정 아크)**: 균등 4분할 금지 — D1은 최강 카드이므로
최희귀(전체 비트의 ~15-20%), D2 최빈. `drama.json` 가중 config.

**슬로모 예산 (D-M10)**: 판당 timeScale 예산 (총 슬로모 실시간 상한 + 최저 배율
1회) config + `validateScript` 단언 — 겹겹 슬로모로 레이스 늘어짐 방지.

**임의 t 합류 재구성 (D-M9)**: 마커를 **이벤트형**(1회성: 플래시·사운드·멘트)과
**상태형**(구간 지속: 스프라이트 상태·💤 루프·비네트)으로 분리 명기. catchup·탭
복귀·다시보기 진입 시 상태형만 재구성, 이벤트형 스킵 (`reconcileAfterCatchUp` 관례
승계). 다시보기 시크바는 현행에도 없음 — **명시적 스코프 외**.

**모바일·PiP 판독성 (D-M7)**: 비트마다 트랙 전역 큐 ≥1 의무 (비네트/스포트라이트/
timeScale — 스프라이트 큐만으로는 300px 트랙·PiP에서 발동 안 한 것과 같다).
QA 체크리스트에 "375px + PiP 창에서 각 비트 식별" 항목.

**중반 밀도 원칙 (디자인 감정 아크)**: 학습된 유저에게 중반 순위는 정보 가치 0 —
중반(30-70%)은 엔터테인먼트 구간으로 받아들이고 기믹·호명·개그 멘트 밀도를 중반에
집중 배치 (순위 셔플 흉내가 아니라 밀도 설계).

**allSameBet 독주 쇼 (D-M11)**: L0 면제 명시. 콘셉트 — 독주 말의 쇼맨십 기믹 +
나머지 말들의 개그 이벤트 + 전용 멘트 풀.

**공개 문구 위치·어투 (D-M8)**: 정밀 문장은 도움말에만. 결과 오버레이는 하단
음소거 톤 in-voice 1줄 ("결과는 출발 전에 이미 뽑혀 있었습니다. 연출은 쇼입니다 🎬"
류) — 하우스 톤("사실 다 운임")과 정합. 두 위치 복붙 금지.

**로딩·실패 상태**: 스크립트 생성 실패 → 무드라마 폴백(기정의), 구버전 payload
거부 안내, 비트 에셋 미로드 시 프리미티브 폴백.

### 공정성·신뢰 계약 (절대 조건 — CEO 리뷰 강화판)

- 순위 추첨은 서버 유일·베팅/유저 무관·말 단위 균등 — 드라마 스크립트는 100% 연출,
  결과에 인과 없음. 스크립트 재생성 시에도 추첨 불변 (F-6)
- 클라이언트 `Math.random()` 신규 0 (fairness-guard), 연출 난수도 서버 스크립트에서
- **체감 공정성 방어 (F-12/Codex#1)**: 도움말·결과 오버레이에 1줄 명시 —
  "순위는 경주 시작 전 서버 균등 추첨으로 확정되며, 경주 연출은 결과에 영향을
  주지 않습니다". 숨기면 발각 시 신뢰 붕괴, 공개하면 "복권 개봉 쇼" 프레임
- provably-fair(시드 해시 공개 커밋) 장치는 TODOS 이연 (친구방 판돈 수준 대비 과설계)

### 성공 지표 (F-12 — 내부 정합성 외 유저 지표)

- 방당 연속 판수(재경주 반복 횟수) before/after — `server_game_records` 기반
- 다시보기 클릭률 (계측 이벤트 1개 추가)
- "승부 확정 가시화 시점" 분포 (스크립트 생성기에서 직접 산출 가능 — 구조 KPI)

## Dead code 정리 (사용자 요청 — eng 리뷰로 재검증된 목록)

**⚠️ 원칙 (E-A1 교훈): dead 판정은 문서가 아니라 emit/on 지점 grep으로만.**

- ✅ 진짜 dead: **`selectHorse` 내 225줄 중복 정산 파이프라인** (`socket/horse.js:1731-1955`
  — 도달 불가 확인: 카운트다운 창에서 readyUsers 비고 toggleReady/joinRoom 전부
  isGameActive 게이트. 기믹 없는 별도 시뮬 + `horseRaceResult` 유일 emit + 이질
  coinRef 체계 `'horsecoin_'+roomId+'_'+raceRound` — 화이트리스트 뒷문·coinRef
  이원화·이벤트 혼선의 근원. **명시적 제거**)
- ✅ 클라 미러 시뮬 전체 (LCG·기믹 트리거·진화 체크·finishStun 순위 강제 클라 사본)
- ✅ 재작성으로 고아가 되는 시뮬 전용 상수/헬퍼 (구현 시 인벤토리)
- ❌ **`horseSelectionCancelled`는 dead code 아님** — 서버 3곳 emit
  (`socket/shared.js:477`, `:562`, `socket/chat.js:605`), 클라 리스너는 2026-08-21
  "전원 렌더링 정지 사고" 회귀 가드 하중 코드 (`AutoTest/qa-horse-disconnect-during-race-test.js`가
  계약 보호). **낡은 건 `docs/GameGuide/03-games/horse-race.md:95` 문서 쪽 — 문서를 정정**
- `selectRandomHorse` 서버 핸들러: 레거시 클라 미emit이나 **horse-app(React)이 emit**
  (`VehicleSelection.tsx:38`) — horse-app 처분 결정(게이트 안건)과 함께 처리

## 보존해야 할 현행 동작 (부록 — F-15, 사일런트 회귀 방지)

| 동작 | 현행 근거 | 스크립트 체제에서 |
|------|-----------|-------------------|
| allSameBet (전원 같은 말) | `socket/horse.js:940-952` — 그 말 부스트 질주 | 전용 "독주 쇼" 스크립트 |
| 정산 워치독 | `HORSE_RACE_SIM_MAX_MS=60000` (:12, :1158-1165) | scriptDuration + grace |
| 재경주 (동점 → 다음 라운드) | raceRound 증가 → 재선택 | 라운드마다 스크립트 재생성 |
| 등수 투표 룰렛 연출 | `:999-1054` rouletteSegments | 유지 (스크립트 앞단) |
| 관전 catchup-to-live | `docs/goal/applied/horse-race-catchup-to-live.md` | 스크립트 시각 동기 재생 (상태형 마커 재구성) |
| 숨김 탭 → pause+catchup (E-A3: "결과만 표시" 모드는 이미 제거됨 — applied/horse-race-items-and-focus-start.md) | `js/horse-race.js:7018` | **pause+seek 유지** — 스크립트라 오히려 단순해짐. 퇴행 금지 |
| 경주 중 이탈 게이트 | `socket/chat.js:584` `isHorseRaceActive \|\| pendingRaceResult` | 플래그 내리는 시점 의미 보존 (E-C4) |
| PiP 트랙 창 | C-35 (rAF 창별 취소) | 재생기 rAF에 동일 규칙 |
| 다시보기 | `js/horse-race.js:5536-6047`, record 재실행 | record=raceScript 저장 |

## NOT in scope

- 베팅 규칙/코인 경제/배당 변경 없음
- 신규 탈것·코스메틱 없음
- 날씨 확률 활성화·가중 추첨 사용 (훅만 마련, 활성화는 별건 goal)
- provably-fair 커밋·스크립트 스트리밍 전송 (TODOS 이연)
- 타 게임 무영향 (공유 모듈 변경 시 크로스게임 검증)
- **horse-app(React)은 "무영향"이 아니다 (E-A5)** — `useSocketEvents.ts:180-197`이
  `horseRaceStarted`의 rankings/speeds/gimmicks를 소비해 자체 미러 시뮬을 돌리고,
  `VehicleSelection.tsx:38`이 `selectRandomHorse`를 emit. 현재 `/horse-race`는
  레거시 HTML 서빙·dist 미라우팅 휴면 상태지만 화이트리스트 적용 시 전멸.
  **처분(아카이브/삭제 vs 마이그레이션)은 게이트 안건 — 사용자 결정**

## 드림 스테이트 델타

- **현재**: 시뮬 창발 순위 + 결승 순위 강제(finishStun) 혼합 — 중반이면 결말이 보이고,
  연출 확장은 서버·클라 이중 시뮬 락스텝에 묶여 있다.
- **이 플랜 후**: 결과(추첨)와 연출(스크립트)의 완전 분리 — 드라마는 데이터(drama.json
  비트)로 저작·조정 가능, 클라는 재생기라 연출 실험 비용이 급감, 결과 유출 3채널 봉인.
- **12개월 이상**: 비트 라이브러리 축적(시즌 이벤트 비트, 탈것 고유 무브), 날씨 가중
  추첨 활성화(훅 준비됨), 다른 레이스형 게임에 race-script-engine 재사용 가능성.

Phase 3.5 (DX 리뷰): 스킵 — 개발자 대상 스코프 없음 (API/CLI/SDK 무관 게임 기능).

## 이미 있는 것 (재사용 지도)

| 필요 | 기존 코드 |
|------|-----------|
| 순위-조건 드라마 선례 | evolution/fakeEvolution (`socket/horse.js:398-472`) — 비트 설계 참고 후 제거 |
| 기믹 시각 연출 | 기존 기믹 타입별 클라 연출 — 마커 소비형으로 재배선 |
| 중계 시스템 | `js/horse-race-commentary.js` — 비트 마커 구독으로 확장 |
| 슬로모션/카메라 | 기존 연출 코드 — timeScale/마커 소비로 전환 |
| 낙하/기절 모션 | `js/horse-race-fall-motion.js`, `js/horse-race-lose.js` |
| 결과 정산/코인 | `awardRaceCoins`·`pendingRaceResult` — 무변경 |
| 멱등 적립 | coinRef 관례 (lessons/horse-race.md 2026-06-07) — 무변경 |

## 검증 계획 (eng 리뷰 반영판)

- validateScript 몬테카를로 N=1,000: 순위 일치 100%, L0 계약 충족률, 재생성률,
  **비트별 폴백률의 순위 패턴 독립성** (E-D3: "재생성 판 분포==전체 분포"는 F-6
  구조상 동어반복이라 교체 — 진짜 위험은 특정 결말↔드라마 부재 상관 = 패턴 발각 신루트)
- 폴백률 로그 + 임계 경고 동작 확인 (트랙×말수 조합별)
- 드라마 발동률 실측 ≈ 설정값(30-35%), 비트 종류 분포 (D1 최희귀 가중 확인)
- 순위 추첨 균등성 카이제곱 (베팅 말 집합 기준, runnerCount별)
- "승부 확정 가시화 시점" 분포 구/신 비교 (개선 입증 KPI)
- **AutoTest 소비처 인벤토리** (E-E1): 제거 필드(rankings/speeds/gimmicks)의 전
  AutoTest·devtools 소비처 grep — `test-rank-distribution-real.js`(공정성 회귀 핵심)는
  drawRankings 단위 검정으로 **이식**, devtools의 고정 딜레이 complete emit 갱신
- e2e (Playwright): 정상 완주 / 다시보기 (신포맷 + **구포맷 record 클릭 → 크래시
  아닌 안내** — script 유무 feature-detect) / 숨김 탭 pause+catchup / 관전 catchup
  중간 합류(비트 상태 재구성) / targetRank 판 / allSameBet / 2마리 판 /
  **재입장(getCurrentRoom 트리거 — C-25) 중 결과 필드 부재** / PiP 창 L1 카메라
  오버라이드 / **워치독-only 정산(전원 complete 미전송) 코인 1회 적립** /
  구버전 탭 payload 거부 — 스테일 테스트 3종 주의 (메모리 참조)
- 조기 complete 타이밍 가드: `startedAt + scriptWallMs − ε` 이전 emit 무시 확인
- 배포: 단계 분할 (포맷 정의 → 서버 이중 emit(B-2 규칙) → 클라 재생기 전환 →
  구코드 제거) — main=실서버, 빅뱅 스위치 금지 (F-8) + **킬스위치 실동작 확인**

---

## CEO 리뷰 기록 (Phase 1 — 2026-08-25)

### 듀얼 보이스 합의표

```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════════
  Dimension                          Claude   Codex    Consensus
  ─────────────────────────────────── ──────── ──────── ───────────
  1. Premises valid?                  수정필요  수정필요  CONFIRMED(수정)
  2. Right problem to solve?          부분(F-1) 부분(신뢰) CONFIRMED(보강)
  3. Scope calibration correct?       미달(F-13/14/15) 미달(PiP/다시보기/워치독) CONFIRMED(확장)
  4. Alternatives sufficiently explored? 미흡(F-10) 프레이밍 과장 지적  DISAGREE→게이트
  5. Competitive/trust risks covered? 미흡(F-7/12) 미흡(조작감/밈)  CONFIRMED(보강)
  6. 6-month trajectory sound?        위험(F-8/9) 위험(레거시/패턴)  CONFIRMED(보강)
═══════════════════════════════════════════════════════════════════
```

### 판정 요약 (전 항목 처분)

- 반영(critical): F-1 드라마 2층 구조, F-4 stakeRank 일반화
- 반영(high/medium): F-2 중계 연동 in-scope, F-6 재추첨 금지, F-7 지터+비트 기억,
  F-8 단계 분할+확장 규약, F-9 발동률 상한 주석, F-12 지표+공개 문구,
  F-13 다시보기 in-scope, F-14 화이트리스트+숨김탭 재설계, F-15 동작 인벤토리,
  Codex#3 말 단위 균등 명문화, Codex#5 현행 finishStun 진단 반영
- 게이트 이관(taste): F-3 날씨/탈것 특성의 미래, F-10 구현 전략 (i) 제로베이스
  저작 vs (ii) 시뮬-생성기+후편집, F-11 config 스톱갭 선배포, D1 톤(Codex 이견)
- 기각: 없음 (전 항목 반영 또는 게이트 이관)

## 디자인 리뷰 기록 (Phase 2 — 2026-08-25)

### 듀얼 보이스 합의표 (디자인 litmus)

```
DESIGN DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════════
  Dimension                          Claude   Codex    Consensus
  ─────────────────────────────────── ──────── ──────── ───────────
  1. 정보 위계 (트랙/HUD/중계/미니맵)  4/10     4/10     CONFIRMED(계약 추가)
  2. 상태 명세 (catchup/숨김/리플레이) 3/10     3/10     CONFIRMED(계약 추가)
  3. 감정 아크 (막 구성·빈도·대비)     5/10     5/10     CONFIRMED(L0 겸손)
  4. 비트 구체성 (스토리보드)          2/10     2/10     CONFIRMED(3막 표)
  5. 카메라/슬로모 소유권              미정→계약 미정→계약 CONFIRMED
  6. 모바일/PiP 판독성                 0건→의무화 규칙없음→규칙 CONFIRMED
  7. 톤/신뢰 (호명·공개 문구)          위치분리  위치분리  CONFIRMED
═══════════════════════════════════════════════════════════════════
양 보이스 독립 검토가 사실상 동일 처방 수렴 — 이견(DISAGREE) 0건.
공통 결론: "엔진 계획은 통과, 연출 계약 부재" → Race Presentation Contract 신설로 해소.
```

### 판정 요약

- critical 반영: D-C1 카메라 소유권, D-C2 L0/대비 모순 (L0 겸손 원칙으로 해소)
- high 반영: D-H3 무원인 속도 변화 금지, D-H4 중계 계약(트랙 내 캡션·시퀀스·풀 정리),
  D-H5 비트 스토리보드, D-H6 호명 정책+베팅 근접 대상 선정
- medium 반영: D-M7 모바일/PiP 전역 큐, D-M8 공개 문구 위치/어투, D-M9 이벤트형/
  상태형 분리, D-M10 슬로모 예산, D-M11 독주 쇼 콘셉트, D-M12 프리미티브 어휘
- Codex 추가 반영: stakeRank 경계 HUD, 다시보기 시크 명시적 제외, 로딩/실패 상태
- 기각: 없음

## 엔지니어링 리뷰 기록 (Phase 3 — 2026-08-25) `[subagent-only]`

Codex 보이스는 사용량 한도(2026-09-14 리셋)로 불가 — 단일 모델 리뷰로 강등 기록.

### 아키텍처 (목표 구조)

```
                        ┌──────────────────────────── 서버 (socket/horse.js) ───────────────────────────┐
 selectHorse/룰렛 ──▶  drawRankings(bettedSet)      generateRaceScript(rankings, stakeRank, dramaCfg)   │
                        │  · 베팅 말 균등 순열        │  · L0 제약 + L1 비트 (drama.json)                │
                        │  · 무베팅 말 후미 고정      │  · cameraHint/멘트 시퀀스/timeScale               │
                        │        │                    ▼                                                  │
                        │        └────────▶ validateScript ──재생성/완화 사다리──▶ raceScript            │
                        │                       │ (wall-clock 산출)                  │                   │
                        │                       ▼                                    ▼                   │
                        │                 워치독 = wallMs+grace          horseRaceStarted(화이트리스트)  │
                        │                 settle ──▶ horseRaceResult(신규 정식 emit) + horseRaceEnded    │
                        └───────────────────────────│──────────────────────────────│────────────────────┘
                                                    │      js/shared/race-script-engine.js (공용)        
                                                    ▼                              ▼                     
                        ┌─────────────────────────── 클라 (js/horse-race.js) ──────────────────────────┐
                        │  스크립트 재생기 (보간·마커) ─▶ 연출 프리미티브 ∪ legacy 기믹 비주얼          │
                        │       │ 이벤트형/상태형 분리     ─▶ 중계 캡션(트랙 내)·사운드·카메라(cameraHint)│
                        │       ├─ pause+catchup(숨김 탭/관전)  ├─ PiP(C-35)  ├─ 다시보기(on-demand)     │
                        │       └─ raceAnimationComplete (서버: rate limit + 타이밍 가드)               │
                        └───────────────────────────────────────────────────────────────────────────────┘
 재입장: getCurrentRoom ─▶ 경마 마스크 신설 (pendingRaceResult/record 결과부/타이머 핸들 제외)
```

### 테스트 다이어그램 (신규 코드패스 → 커버)

| 코드패스/흐름 | 테스트 종류 | 존재 여부 → 계획 |
|---------------|------------|------------------|
| drawRankings 균등성·무베팅 후미 | 단위 (몬테카를로) | 신규 — rank-distribution 이식 |
| generateRaceScript L0/L1 충족 | 단위 (validate 재생) | 신규 |
| 폴백 사다리·폴백률 경고 | 단위 + 로그 검증 | 신규 |
| race-script-engine 서버/클라 동일성 | 단위 (양측 로드) | 신규 |
| 화이트리스트·3채널 마스킹 | e2e (getCurrentRoom 트리거) | 신규 (C-25 방식) |
| settle → horseRaceResult → 오버레이 게이트 | e2e 2탭 | 신규 |
| 타이밍 가드·워치독-only 정산·코인 멱등 | 소켓 프로토콜 테스트 | 신규 |
| 숨김 탭 pause+catchup / 비트 중간 합류 | e2e | 기존 catchup 테스트 확장 |
| 다시보기 신/구포맷 | e2e | 신규 (구포맷 graceful) |
| PiP 카메라 오버라이드 | e2e (C-36 방식) | 기존 PiP 테스트 확장 |
| 구버전 payload 거부·킬스위치 | e2e + 수동 | 신규 |
| AutoTest 스테일화 인벤토리 | grep 전수 | 착수 시 1회 |

### 판정 요약 (E-* 전 항목 처분)

- **사실 오류 정정 (플랜 v2 → v3)**: A-1 horseSelectionCancelled 살아있음(문서가
  낡음), A-2 horseRaceResult 정상 경로 미emit(신규 정식 emit으로 설계 변경),
  A-3 숨김 탭은 이미 pause+catchup(퇴행 방지), A-5 horse-app 소비자 존재
- **반영**: A-4 진짜 dead code(225줄 좀비 정산), B-1 3채널 봉인+스텁 record,
  B-2 이중 emit 규칙+킬스위치, B-3 history 증폭 방지+on-demand 다시보기,
  B-4 wall-clock 워치독, C-1 베팅 집합 추첨+runnerCount 표, C-2 공용 엔진 모듈,
  C-3 마커 2계층, D-1 complete 무장, D-3 검증 항목 교체, E 테스트 보강 전체
- **게이트 이관**: A-5 horse-app 처분 (아카이브 vs 마이그레이션)
- 기각: 없음

```
ENG REVIEW — CONSENSUS TABLE (subagent-only):
═══════════════════════════════════════════════════════
  Dimension                    Claude    Codex   Consensus
  ──────────────────────────── ───────── ─────── ─────────
  1. Architecture sound?       조건부(B-1/2 반영 후) N/A  FLAGGED→반영
  2. Test coverage sufficient? 미달→보강안 제시      N/A  FLAGGED→반영
  3. Performance risks?        B-3 브로드캐스트 증폭  N/A  FLAGGED→반영
  4. Security threats?         B-1/D-1/D-2           N/A  FLAGGED→반영
  5. Error paths handled?      폴백 사다리+경고 필요  N/A  FLAGGED→반영
  6. Deployment risk?          킬스위치 없인 불승인   N/A  FLAGGED→반영
═══════════════════════════════════════════════════════
단일 보이스 — critical 발견은 보이스 수와 무관하게 전건 반영.
```

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | Gate | 접근 = B안 (결과 선결정 재작성) | User decision | — | 사용자 명시 선택, 공정성 보존 확인 후 | A안, C안 |
| 2 | Gate | 드라마 = D1+D2+D3+D4 전부 | User decision | — | 확률 발동·비동시 조건 | — |
| 3 | Gate | 빈도 기본값 = 중간(~30-35%) | User decision | — | config 상수화 | 낮음/높음 |
| 4 | P1 | D3를 "힘"이 아닌 "스크립트 제약"으로 재해석 | Mechanical | P5 | 결과 선결정 하에서 격차 압축은 연출 제약이 단순·안전 | 물리 가속 |
| 5 | P1 | 슬로모션을 스크립트 timeScale로 이관 | Mechanical | P4 | 이중 판정 제거, 비트와 통합 | 클라 자체 판정 |
| 6 | P1 | 결과성 필드를 horseRaceStarted에서 제거 | Mechanical | P1 | 스포일러 축소, C-20 정합 | 현행 유지 |
| 7 | P1 | 드라마 2층 구조 채택 (L0 베이스라인 + L1 비트) | Mechanical | P1 | 무비트 65-70% 판 방치는 원 불만 미해결 (양 보이스 합의) | 비트 단층 |
| 8 | P1 | stakeRank 일반화 (룰렛 targetRank 포함) | Mechanical | P1 | 승리 규칙 부분집합만 모델링은 결함 (F-4) | first/last만 |
| 9 | P1 | 재생성 시 순위 재추첨 금지 명문화 | Mechanical | P1 | 균등성 침식 경로 차단 (F-6) | 미명시 |
| 10 | P1 | 비트 지터 + 방 단위 반복 억제 + config 비트 | Mechanical | P1 | 패턴 발각 = 한 층 위 지루함 재현 (F-7, 양 보이스) | 고정 파라미터 |
| 11 | P1 | 다시보기 in-scope (record=raceScript) | Mechanical | P2 | 제거 대상 시뮬의 직접 소비자 — 블래스트 반경 내 (F-13) | 스코프 외 방치 |
| 12 | P1 | 계약 변경을 화이트리스트 방식으로 | Mechanical | P1 | record 뒷문 잔존 방지 (F-14) | 필드 3개 삭제 |
| 13 | P1 | 숨김 탭 흐름 horseRaceResult 대기로 전환 | Mechanical | P1 | 시작 payload rankings 의존 제거의 필연 결과 | — |
| 14 | P1 | 공정성 공개 문구 1줄 채택 | Taste→채택 | P6 | 발각 시 신뢰 붕괴 vs 복권쇼 프레임 (양 보이스) — 정직 우위 | 비공개 |
| 15 | P1 | 유저 지표 3종 정의 (판수/다시보기/확정시점) | Mechanical | P1 | 내부 정합성만으론 성공 판정 불가 (F-12) | 지표 없음 |
| 16 | P1 | provably-fair·스트리밍 전송 TODOS 이연 | Mechanical | P3 | 친구방 판돈 대비 과설계 | 즉시 구현 |
| 17 | P1 | 가중 추첨 훅 마련 (기본 균등) | Taste→기본값 | P5 | 날씨 미래를 막지 않되 지금 미사용 — 게이트에서 확정 | 균등 고정 |
| 18 | P1 | 단계 분할 배포 (빅뱅 금지) | Mechanical | P1 | main=실서버 (F-8) | 일괄 스위치 |
| 19 | P1 | 중계·사운드 비트 연동 in-scope 승격 | Mechanical | P2 | 같은 인프라 위 최저비용 체감 증폭 레버 (F-2) | 후속 분리 |
| 20 | P1 | 발동률 설계 상한 ≤0.40 주석 | Mechanical | P5 | 드라마 인플레이션 트레드밀 방지 (F-9) | 무상한 |
| 21 | P2 | L1 비트 중 카메라 강제 오버라이드 + 배지 + 복원 | Mechanical | P1 | 안 보이는 드라마 = 체감 발동률 반토막 (양 보이스 동일 처방) | 사용자 카메라 존중 |
| 22 | P2 | 종반 카메라 타깃 = stakeRank 경계 그룹 | Mechanical | P1 | 3등 찾기 판에서 선두 카메라는 승부를 화면 밖에 방치 | 선두 고정 |
| 23 | P2 | L0 겸손 원칙 (75%까지·교체 1회·독주 판 10-15%) | Mechanical | P5 | L0 과욕은 F-9 대비 원칙과 정면 모순 — 접전의 화폐 가치 보존 | 매판 90% 접전 |
| 24 | P2 | 무원인 속도 변화 금지 + validate 단언 | Mechanical | P1 | 원인 없는 감속은 정확히 "조작"으로 읽힘 — 물리 시뮬 최대 자산의 승계 | 미규정 |
| 25 | P2 | 비트 3막 스토리보드 (D1 기상 코미디 포함) | Mechanical | P1 | "💤 등"은 스펙이 아님 — 미정이면 구현자 임의 결정 | 제네릭 기술 |
| 26 | P2 | 중계 = 트랙 내 캡션 레이어 + 비트 멘트 시퀀스 | Mechanical | P1 | gameStatus는 전체화면·PiP에서 부재 (래퍼 밖) — 증폭기 승격의 전제 | gameStatus 유지 |
| 27 | P2 | 앰비언트 풀 사실주장 라인 게이트 | Mechanical | P1 | "어? 1번 졸고있는데요?" 농담이 D1 도입 순간 양치기 소년 | 방치 |
| 28 | P2 | 호명 정책 (상승=실명, 하강=탈것명) | Taste→채택 | P6 | 각본 굴욕에 실명은 선 넘음 (양 보이스 동일 결론) | 전면 실명 |
| 29 | P2 | 비트 대상 = 베팅 분포 입력·경계 인접 우선 | Mechanical | P1 | 무베팅 말의 드라마는 감정 지분 0 | 무가중 랜덤 |
| 30 | P2 | 비트 가중 차등 (D1 최희귀 15-20%) | Mechanical | P1 | 균등 4분할이면 최강 카드가 한 달 안에 밈 소진 | 균등 분할 |
| 31 | P2 | 슬로모 예산 config + validate 단언 | Mechanical | P1 | timeScale 자유 저작 = 슬로모 남용 경로 | 무예산 |
| 32 | P2 | 이벤트형/상태형 마커 분리 + 임의 t 재구성 규칙 | Mechanical | P1 | catchup·탭복귀·다시보기 3경로가 전부 걸림 | 미분리 |
| 33 | P2 | 다시보기 시크바 명시적 스코프 외 | Mechanical | P3 | 현행에도 없음 — 재수화 규칙 비용 회피 | 시크 신설 |
| 34 | P2 | 비트당 트랙 전역 큐 ≥1 의무 (모바일/PiP) | Mechanical | P1 | 스프라이트 큐만으론 300px에서 발동 안 한 것과 동일 | 스프라이트만 |
| 35 | P2 | stakeRank 경계 HUD + 미니맵 하이라이트 | Mechanical | P1 | "N등을 찾아라" 배너만으론 경계 시선 유도 불가 | 배너만 |
| 36 | P2 | 공개 문구 위치 분리 (도움말=정밀, 오버레이=in-voice) | Taste→채택 | P6 | 하이 모먼트에 약관 문체는 판타지 훼손 | 동일 문장 복붙 |
| 37 | P2 | 프리미티브 어휘 8종 닫힌 집합 | Mechanical | P5 | 어휘 없이 "비트=데이터" 약속은 거짓 | 자유 형식 |
| 38 | P2 | 중반 = 밀도 설계 구간 명시 | Mechanical | P1 | 결과 선결정 학습 후 중반 순위는 정보 가치 0 | 셔플 흉내 |
| 39 | P3 | horseSelectionCancelled dead 판정 철회 + GameGuide 정정 | Mechanical | P1 | 서버 3곳 emit 실증 (E-A1) — 문서가 낡았지 코드가 죽은 게 아님 | 문서 신뢰 |
| 40 | P3 | settle에서 horseRaceResult 신규 정식 emit + 오버레이 게이트 | Mechanical | P1 | 현행 정상 경로는 미emit — 플랜 v2의 흐름은 존재하지 않는 이벤트 대기였음 (E-A2) | 좀비 경로 의존 |
| 41 | P3 | 숨김 탭 pause+catchup 유지 | Mechanical | P3 | "결과만 대기"는 이미 제거된 UX로의 퇴행 (E-A3) | 결과 대기 전환 |
| 42 | P3 | selectHorse 225줄 좀비 정산 경로 제거 등재 | Mechanical | P2 | 도달 불가 실증 — 화이트리스트 뒷문·coinRef 이원화 근원 (E-A4) | 방치 |
| 43 | P3 | 결과 유출 3채널 봉인 (started/getCurrentRoom/joinRoom) | Mechanical | P1 | 1채널 화이트리스트는 문서상 주장 (E-B1) — coinRef까지 새는 중 | 1채널만 |
| 44 | P3 | 스텁 record 시작 push + settle 병합 | Mechanical | P1 | catchup same-round 판별이 record.id에 의존 (E-B1) | history push 지연 |
| 45 | P3 | Phase 2 이중 emit 규칙 + 혼재 수용 명시 + 킬스위치 | Mechanical | P1 | main=실서버에서 revert 배포가 유일 롤백이면 안 됨 (E-B2) | 무규칙 이중 |
| 46 | P3 | history에서 script 본문 제거 + 다시보기 on-demand | Mechanical | P3 | 판당 수 MB 브로드캐스트 방지 (E-B3) | 전체 동봉 |
| 47 | P3 | 워치독 = script wall-clock + max(grace, catchup) | Mechanical | P1 | timeScale로 벽시계 가변 — 고정 60s는 조기 정산 스포일 (E-B4) | 고정 유지 |
| 48 | P3 | 추첨 모집단 = 베팅 말 집합 + runnerCount 전제표 | Mechanical | P1 | 전체 말 추첨은 first 모드 당첨자 0명 사고 (E-C1) | 전체 말 |
| 49 | P3 | race-script-engine 공용 모듈 (UMD) | Mechanical | P4 | 검증기/재생기 이원화는 dual-sim 표류의 재생산 (E-C2) | 각자 구현 |
| 50 | P3 | 마커 어휘 2계층 (프리미티브 ∪ legacy 기믹) | Mechanical | P1 | 8종만으론 D2·L0이 표기 불가 (E-C3) | 8종 고정 |
| 51 | P3 | raceAnimationComplete rate limit + 타이밍 가드 | Mechanical | P1 | 현행 그리핑 벡터를 스크립트 체제가 처음 봉쇄 가능 (E-D1) | 현행 방치 |
| 52 | P3 | 몬테카를로 항목 교체 (폴백률 순위 독립성) | Mechanical | P1 | 기존 항목은 동어반복 (E-D3) | 동어반복 유지 |
| 53 | P3 | AutoTest 인벤토리 + rank-distribution 이식 | Mechanical | P1 | 공정성 회귀 하네스가 화이트리스트에 즉사 (E-E1) | 방치 |
| 54 | Gate | 구현 전략 = 제로베이스 저작 엔진 | User decision | — | F-10 게이트 확정 | 시뮬-생성기+후편집 |
| 55 | Gate | config 스톱갭 선배포 승인 | User decision | — | 기믹 창 [0.10,0.93]+지속 상향 1커밋 — 로컬 확인 후, main 푸시(=배포)는 사용자 최종 승인 | 미배포 |
| 56 | Gate | horse-app 아카이브/제거 | User decision | — | dead code 정리 범위에 포함, selectRandomHorse 핸들러 동반 정리 | 마이그레이션/보류 |
| 57 | Gate | 전 작업 feature 브랜치 (feature/horse-race-director) | User decision | — | main=실서버 — 직접 작업 금지 | main 작업 |
| 58 | Gate | 비트 정의를 stakeRank 경계 상대로 전면 재표기 | User confirm | P1 | "1·2등이 아니라 특정되는 등수가 중요" — F-4를 표기 수준까지 관철 | 포디움 중심 표기 |
| 59 | Gate | 범위 재결정: 스톱갭 우선, B안 보관 | User decision | — | "0.85를 0.95로 수정해서 다양하게 하면 안 돼?" — 최소 비용 우선, 운영 후 재판단 | B안 즉시 착수 |
| 60 | 적용 | 기믹 창 [0.10,0.95] + 시뮬 상한 60s→90s (`HORSE_RACE_SIM_MAX_MS`, 루프·fallback 상수 참조화) | User decision | — | "60 상한 넘어도 돼" — 상한 퇴화(미완주 순위)·조기 워치독 방지. 순위 정합성은 3중 방어(기믹 반영 시뮬→순위, 결정론 재생, finishStun)로 무위험 | 상한 유지 |
