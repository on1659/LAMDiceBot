# 회전 칼날(spin-arena) — 기질 선택(플레이어 능동성) (office-hours 우선) — Goal

회전 칼날은 입력 0 관전형 게임이라 "그냥 버티다 보니 됐다"는 수동성 불만이 남아 있다. 게임 시작 전 각자 **기질(temperament)을 한 가지 고르면 그 선택이 서버 시뮬에 반영**되어 캐릭터의 싸우는 방식이 달라지게 한다 — 입력 0 게임에 처음으로 "진짜 내 선택"을 도입한다. 단 이 사이트의 존재 이유인 **공정한 벌칙 당첨자 뽑기**를 깨지 않도록, 기질별 당첨 확률은 배치 시뮬로 **균등(가위바위보식 상성, 승률은 균등)** 하게 보장한다. 시뮬 입력과 공정성 모델을 동시에 건드리므로 **바로 코딩하지 말고 `/office-hours`(필요시 `/meeting-codex`)로 설계를 먼저 확정**한 뒤 구현한다.

> 전제/baseline: 「칼 수집 탈출 + 부활 + 종료 압축」 재설계가 적용된 상태가 기준 (`docs/dev-cycle/2026-06-12-spin-arena-blade-escape-design.md`). 카메라+인원 스케일링 goal(`docs/goal/spin-arena-spectator-camera-and-scaling.md`)과는 **독립**이며 순서 무관(둘 다 같은 시뮬 위에 얹힘 — 먼저 하는 쪽이 baseline 갱신). 기준 파일: `socket/spin-arena.js`(simulate), `js/spin-arena.js`, `css/spin-arena.css`, `spin-arena-multiplayer.html`. 기질 선택 UI는 기존 **스킨 피커**(idle 단계 `spin-arena:selectSkin`) 패턴을 그대로 차용한다.

## 한 줄 요약

① **기질 선택** — idle 단계에서 각자 기질 1종 선택(스킨 피커 패턴 재사용) → 서버 시뮬 입력 파라미터가 되어 캐릭터의 이동/교전/칼 수집 방식이 달라짐 ② **공정성 = 균형 트레이드오프(office-hours D5=B 채택)** — 기질별로 "과정"은 다르되 200시드 배치로 **당첨 확률 균등(±오차)** 보장. 가위바위보식 상성만 다르고 승률은 균등 ③ **입력 0 → 첫 능동 선택**이지만 서버 결정론·클라 Math.random 0 불변 ④ **착수 전 office-hours로 기질 세트·상성·균형 수치 확정**.

## 0. 작업 순서 — 설계 먼저 (스킵 금지)

- **Phase 0 (필수): `/office-hours` 빌더 모드**로 아래 열린 질문을 결론내고 **설계 결정서**를 `docs/dev-cycle/YYYY-MM-DD-spin-arena-temperament-design.md`로 남긴다. 직전 blade-escape 결정서처럼 적대적 스펙 리뷰를 거쳐 확정한다.
- Phase 0에서 "균등 당첨률을 배치로 보장할 수 없다 / 메타(전원 같은 기질)가 균형을 깬다 / 정체성을 해친다"는 결론이 나오면 구현하지 말고 대안과 함께 보고한다.
- Phase 1(구현)은 결정서 확정 후에만. 트리아지 **COMPLEX**(시뮬 입력 변경 + 밸런스 재튜닝 + 공정성 영향 + UI).

## 핵심 규칙 (제안 — Phase 0에서 확정)

### 1. 기질 = 시뮬 입력, 결과는 여전히 서버 결정론
- idle 단계에서 준비자가 기질 1종 선택 → `spin-arena:start` 시 슬롯에 `temperament` 부여 → `simulate(slots, seed)`가 기질별로 이동/교전 파라미터를 다르게 적용. **클라는 시각화만**, Math.random 0 유지.
- 선택 UI는 스킨 피커(`renderSkinPicker`, `spin-arena:selectSkin`)와 동일 패턴 — 별도 신규 시스템 만들지 말 것. 스킨과 기질을 한 카드에 합칠지(스킨=외형, 기질=전법 분리) Phase 0 결정.

### 2. 기질 세트 + 상성 (제안 — 균등 보장이 권위)
- 예시 3종(Phase 0에서 종수·효과 확정): **공격형**(spinSpeed↑·중앙 인력↑ — 칼 빨리 모으나 피격·다운 위험↑), **수비형**(외곽 드리프트·넉백 저항 — 느리지만 안전, 칼 늦게 모음), **균형형**(현행 파라미터). 전부 받은 데미지=칼 성장 구조(blade-escape) 위에서 동작.
- **상성(가위바위보)**: 특정 기질이 특정 기질에 유리하되 전체 승률(=당첨 회피율)은 균등하도록 설계. "전원 같은 기질" 메타 방지책(예: 동일 기질끼리는 상성 무효라 운에 수렴) Phase 0 확정.

### 3. 공정성 재정의 — "모두 동일 확률" → "기질 무관 균등 당첨률" (office-hours 결론)
- 이 사이트의 공정성은 두 겹: ① 결과를 서버가 결정(조작 불가) ② 모두 당첨 확률 동일. 기질 선택은 ①은 보존하되 ②를 **"어떤 기질을 골라도 당첨 확률은 균등"**으로 재정의한다(B안). "잘 고른 사람이 벌칙 면제"가 되면 안 됨 — 200시드 배치로 기질별 당첨률 편차가 허용 오차(Phase 0이 정한 값, 예 ±3%p) 내임을 게이트로 강제.
- 균등이 안 잡히면: 효과 크기를 줄이거나(외형/연출 비중↑), 상성 구조를 바꾸거나, 최후엔 외형/서사 위주(영향 축소)로 후퇴 — Phase 0/막힘 기준.

### 4. UX — 선택의 의미가 보여야 함
- 기질 선택 시 "이 기질은 이렇게 싸운다" 한 줄 안내(공격형=빨리 모으나 위험 등). idle 미리보기에 기질 아이콘/색 표시. 리플레이 중 캐릭터가 고른 기질대로 움직이는 게 읽히도록(연출 차이). 결과 화면에 각자 기질 표기 옵션.
- 모바일/PC 양쪽 선택 UI 가독성(스킨 피커 레이아웃 재사용).

## 공정성 (절대 불변)
- 결과는 서버 결정론 시뮬에서만 결정(시드 PRNG + 기질 입력 = 동일 입력 동일 결과). 클라 `Math.random` 결과 영향 0(deviceId/tabId 외).
- 기질은 reveal 전 server-only가 아니라 **공개 선택**(스킨처럼 idle에 노출 OK) — 단 timeline/result/seed는 reveal 전 비노출 유지. 재진입 마스킹 유지.
- selected(당첨=벌칙)=DB rank 2/isWinner=false 시맨틱 유지. 기질은 당첨자 의미를 바꾸지 않는다(누가 걸리는지는 여전히 시뮬 결과).

## 기존 통합 유지 (스킵 금지)
- 통계/서버 랭킹/사운드/스킨/튜토리얼/채팅 오버레이/카운트다운/BGM/다시보기/주문 계속 동작. blade-escape 재설계 기능(칼 수집/부활/decideMs 종료 압축/핍 HUD/미션 패널/스포일러 가드) 무파손.
- 소켓 이벤트 이름 유지(기질 선택은 기존 `spin-arena:selectSkin` 확장 또는 신규 1개 — additive). 튜토리얼·메타·update-log 문구를 기질 규칙에 맞게 갱신.

## 작업 방식
- Phase 0 결정서가 권위. 먼저 읽을 것: `docs/dev-cycle/2026-06-12-spin-arena-blade-escape-design.md`(시뮬 틱 순서/cumDmg/페이로드), `socket/spin-arena.js` simulate(이동/넉백/칼 성장 — 기질이 끼어들 지점), `js/spin-arena.js` renderSkinPicker/selectSkin(선택 UI 패턴), `docs/GameGuide/lessons/_common.md`·spin-arena lesson, `.claude/rules/new-game.md` §7.
- **밸런스 재튜닝 필수 게이트**: 기질이 시뮬 입력을 바꾸므로 200시드 배치(h=2~6, 기질 조합)로 ① 30초 내 결판률 유지 ② **기질별 당첨률 균등(±오차)** 재검증. `AutoTest/spin-arena-determinism-test.js` 확장.
- 서버·클라 공유 상수/기질 정의는 양쪽 동시 수정 또는 페이로드 전달. 캐시버스트 상향. **소켓 변경 → dev 서버(5173) 재시작 필수.**
- ⚠️ 교훈: bridge-cross는 선택을 "없애" 표류했다 — 이번은 반대로 선택을 "넣는" 방향이라 정체성 강화 쪽이지만, 균형이 안 잡히면 무리하게 밀지 말 것.

## 테스트
- `node -c socket/spin-arena.js` + `node --check js/spin-arena.js` + 공정성 grep(Math.random 실호출 2회 유지).
- 결정론 회귀: 동일 시드+동일 기질 = 동일 frames/result. 기질별 시뮬 분기가 결정론인지 단언.
- 200시드 배치: 기질 조합별 결판률 + **기질별 당첨률 균등 검증(편차 ≤ Phase 0 허용 오차)** 표를 보고에 첨부.
- 봇 도구(`AutoTest/spin-arena-devtools.html`)로 2탭+봇 실연: 기질 선택→시뮬 반영(움직임 차이 가독), 결판/부활/HUD 정상, 경마/사다리/주사위/룰렛 미파손.

## 완료 기준 (하나라도 미완이면 완료 아님)
- Phase 0 설계 결정서 존재(기질 세트·상성·효과 수치·균등 보장 방식·허용 오차 전부 결론 + 근거). 채택 시에만 Phase 1.
- idle에서 기질 선택 → 시뮬 반영(기질별 움직임/칼 수집 차이가 화면에 읽힘).
- 200시드 배치: 기질별 당첨률 균등(허용 오차 내) + 30초 내 결판률 유지.
- 결정론·공정성·reveal 마스킹 불변. 클라 Math.random 결과 영향 0. blade-escape 기능 회귀 0.
- 기질 의미 안내 문구 + idle/결과 표기. 튜토리얼/메타/update-log 갱신(평이한 한국어). 새 리소스(기질 아이콘·사운드) 여부 명시.
- 마지막 보고: 설계 결론·변경 파일·테스트 명령/결과·기질별 당첨률 분포·자체 평가·남은 이슈.

## 막힘 기준
- 기질별 당첨률 균등이 배치로 안 잡히면: 효과 크기 축소 → 상성 재설계 → 외형/연출 위주(영향 축소) 순으로 후퇴, 근거 보고.
- "전원 같은 기질" 메타가 균형을 깨면 멈추고 사용자 결정 요청(동일 기질 상성 무효화 등 제안과 함께).
- 기질 세트 종수/효과는 배치 분포가 권위 — 균등·결판률 충족하는 가장 단순한 조합 채택 후 근거 보고.
- 테스트 불가 시 구현은 완료하되 막힌 지점 + 수동 QA 체크리스트.

## 참고
- office-hours 결론(이 goal의 근거): 영역=플레이어 능동성, 핵심=기질 선택, 공정성 축 D5=B(균형 트레이드오프 — 과정은 다르되 당첨률 균등). 전제 긴장: 입력0 vs 선택, 공정성 2겹 중 "동일 확률"을 "기질 무관 균등"으로 재정의.
- baseline 결정서: `docs/dev-cycle/2026-06-12-spin-arena-blade-escape-design.md`
- 직전 goal: `docs/goal/applied/spin-arena-blade-escape-and-revive.md`, 병행 goal: `docs/goal/spin-arena-spectator-camera-and-scaling.md`
- 현 구조: `socket/spin-arena.js`(simulate + rankHumans), `js/spin-arena.js`(renderSkinPicker/selectSkin)
- 규칙/교훈: `.claude/rules/new-game.md` §7, `docs/GameGuide/lessons/_common.md`
- 테스트/도구: `AutoTest/spin-arena-determinism-test.js`, `spin-arena-2tab-test.js`, `spin-arena-devtools.html`
