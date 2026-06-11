# 회전 칼날 (spin-arena) — 새 방치형 게임 모드 — Goal

LAMDiceBot에 새 방치형 멀티플레이어 게임 모드 **`spin-arena`(노출명 "회전 칼날")** 를 추가한다.
참가자마다 캐릭터가 한 아레나에 배치되고, 각 캐릭터 주변을 칼날이 빙빙 회전한다. 남의 회전 칼날에 캐릭터가 닿으면 HP가 깎이고, 좁혀오는 안전구역에 몰리며 **30초 안에 최후 1인**이 가려진다. 유저는 시작 전 스킨(외형)만 한 번 고르고, 그 뒤엔 자동으로 굴러가는 걸 다 같이 관전한다. 경마(horse-race)를 base로 복사해 만든다.

> 전제/baseline: 새 게임은 `horse-race-multiplayer.html` / `js/horse-race.js`를 복사해 시작한다(`.claude/rules/new-game.md` 0번 권장 시작점). 공통 시스템(주문/준비/채팅/통계/랭킹/튜토리얼/사운드)은 그대로 가져간다. 새 feature 브랜치에서 작업 권장.
> 설계 출처: `C:\Users\user\.gstack\projects\on1659-LAMDiceBot\user-feature-ladder-rung-color-speed-design-20260610-015723.md` (office-hours 세션 산출).

## 한 줄 요약

① 회전 칼날 PvP 생존 게임 — 남 칼날에 닿으면 HP↓, 좁혀오는 링으로 30초 안에 최후 1인 ② **1인 1캐릭터 + 봇으로 빈 슬롯 채움**(6~8 고정), 승패는 100% 서버 결정(순수 운, 공정) ③ 시작 전 **스킨(외형)만** 선택(성능 무관) ④ 서버가 30초 결정론 시뮬을 사전계산 → 클라는 2D Canvas로 리플레이만(클라 Math.random 0회).

## 핵심 규칙

### 1. 게임 진행 — 30초 3막
- 작은 원형 아레나. 캐릭터들이 자동으로 천천히 드리프트, 칼날은 t=0부터 회전.
- **0~10초 탐색** (간격 있어 잘 안 죽음) → **10~22초 압축** (안전구역 링이 닫히며 가운데로 밀어넣음, 첫 탈락) → **22~30초 결판** (난투 → 최후 1인).
- **좁혀오는 안전구역(링)** 이 결판을 강제한다. 링 자체가 타이머 → 교착 구조적으로 불가능. 링 밖(지나간 자리)은 지속 데미지로 가운데 몰림 강제.

### 2. 캐릭터 모델 — 1인 1캐릭터 + 봇 채우기
- 슬롯 **6~8개 고정**(좁은 30초 아레나엔 10개는 빽빽 — 6~8이 가독성 좋음, 튜닝 가능).
- 참가자 1명 = 캐릭터 1개("내 캐릭터"). 사람이 먼저 채우고 모자란 슬롯은 **봇(주인 없는 캐릭터)** 으로 채워 항상 꽉 찬 난투(2명이 해도 풀 아레나).
- 봇도 **같은 결정론 시뮬에 동일 규칙으로** 태운다(별도 AI 거의 불필요). 사람 캐릭터는 닉네임/스킨 강조, 봇은 회색으로 한눈에 구분.
- **벌칙 귀속:** 사람 캐릭터들 중 마지막까지 살아남은 사람이 당첨. 봇이 끝까지 남아도 "사람 기준" 순위로 판정. 동시 탈락 엣지는 탈락 직전 HP 순.
- **Fallback(설계에 명시):** 1인 1캐릭터가 저인원에서 영 심심하면 경마식 "고정 로스터 + 픽"으로 전환할 수 있게 둔다. 단 **이번 작업 범위는 1인 1캐릭터 + 봇 버전.**

### 3. 전투 규칙
- 각 캐릭터는 HP + 주변 회전 칼날. **남의 회전 칼날에 캐릭터(몸)가 닿으면 HP 감소.** HP 0 → 탈락.
- 칼날 vs 칼날 충돌을 실제 시뮬할지, "캐릭터-칼날"만 판정할지는 구현 단계에서 단순한 쪽으로 결정(막힘 기준 참조).

### 4. 시작 전 선택 — 스킨(외형)뿐
- **스킨만 고른다**(색/칼날 모양 등 외형). **성능 영향 없음** → 영원히 공정, 밸런싱 부담 0.
- 승패는 100% 서버가 정함(순수 운). 전략 없음, 다 같이 관전, 누가 걸리나 — 주사위/룰렛과 동일 성격.
- v1: 프리셋 스킨 몇 개, 영속 저장 없음. (v2에서 개인 수집/잠금해제 progression으로 확장 가능 — 순수 외형이라 pay-to-win 없음, 영속 시 DB. **이번 범위 아님.**)

### 5. 구현 방식 — 서버 사전계산 + 클라 Canvas 리플레이
- 게임 시작 시 **서버가 30초치 시뮬레이션을 통째로 결정론으로 계산**(고정 타임스텝 + 시드). 탈락 순서·승자 확정.
- 서버는 "누가 몇 초에 어디서 죽는다" 타임라인(키프레임 + 탈락 시각)만 클라에 전송. **클라는 2D Canvas로 그걸 재생만** 한다.
- → 클라 Math.random 0회, 모든 관전자 화면 완벽 동기화, 새로고침 재진입해도 같은 결말.

## 공정성
- 결과는 **서버에서만 결정**, 클라는 시각화(리플레이)만. 클라 Math.random은 deviceId/tabId 생성 외 **0회**.
- 스킨은 외형 전용 — 성능/확률에 영향 없음.
- reveal 전 server-only 정보(탈락 타임라인 등) 노출 금지, 재진입 시 동일 결과 마스킹 유지.
- 검증: `grep -c "Math.random" js/spin-arena.js` → deviceId/tabId 용만.

## 기존 통합 유지 (스킵 금지)
- 주문(Order)/준비(Ready)/채팅(Chat)/컨트롤바/통계/랭킹/튜토리얼/사운드가 계속 동작.
- horse-race 공통 layout/시스템 통합(`docs/GameGuide/lessons/_common.md` 함정 C-1~C-5 포함) 준수.

## 작업 방식
- `.claude/rules/new-game.md` 절차를 그대로 따른다: horse-race 복사(0번) → 서버/클라/CSS/소켓 4파일 생성 → **등록 14곳** → Phase D(통계/사운드/랭킹).
- 코딩 전 `docs/GameGuide/lessons/_common.md` 와 (있으면) `docs/GameGuide/lessons/horse-race.md` 를 읽어 함정 인지.
- **모바일·PC 양쪽 대응을 계획 단계부터.** 아레나 Canvas는 반응형(작은 화면에서도 6~8 캐릭터가 보이게).
- 새 게임 = 파일 3개+ / 소켓 / 신규 기능 → 트리아지 **COMPLEX** 로 진행(Scout→Coder→Reviewer→QA).

## 테스트
- `node -c socket/spin-arena.js socket/index.js socket/rooms.js utils/room-helpers.js js/spin-arena.js server.js routes/api.js`
- 클라 Math.random grep 검증.
- 로컬 5173 + 2탭: dice 로비 라디오 선택(게임 색 강조) → 방 생성 → `/spin-arena` redirect → 로딩 닫힘 → 스킨 선택 → 게임 시작 → **2탭에서 30초 리플레이가 동일 재생 + 동일 승자** → 히스토리 누적.
- `.container` 800px, #usersCount 갱신, 채팅/준비/주문 동작, 호스트 새로고침 시 hostControls 유지.
- 경마 등 기존 게임 미파손 확인.

## 완료 기준 (하나라도 미완이면 완료 아님)
- 위 테스트 항목 전부 통과.
- 4파일(`spin-arena-multiplayer.html`, `js/spin-arena.js`, `css/spin-arena.css`, `socket/spin-arena.js`) + 등록 14곳 완료.
- 봇으로 빈 슬롯 채워 항상 6~8 캐릭터, 사람/봇 시각 구분, 사람 기준 승자 판정.
- 서버 결정론 시뮬 → 클라 리플레이, 2탭 동기화 확인.
- 스킨 선택 UI 동작(성능 무관), 선택 결과 서버 전달.
- update-log.md 기록. **새 리소스(스킨 외형 에셋, 사운드) 여부 명시.**
- 마지막 보고에 변경 요약·파일·테스트 명령/결과·자체 평가·남은 이슈 포함.

## 막힘 기준
- 고정 슬롯 수(6/7/8), 봇 행동 강도, 칼날-칼날 충돌 시뮬 여부, 타임라인 샘플레이트 등 세부 수치/형태가 불명확하면 기존 horse-race 구조를 조사한 뒤 근거와 함께 가장 단순·공정한 쪽으로 합리적으로 선택하고 보고에 명시.
- v1 스킨 외형 에셋이 없으면 단색/도형 기반 프리셋으로 시작(추후 교체 가능)하고 그 사실을 보고.
- 테스트 불가(서버 미기동 등) 시 구현은 완료하되 어디서 막혔는지 구체 보고 + 수동 QA 체크리스트 제시.

## 참고
- 새 게임 절차: `.claude/rules/new-game.md`
- 함정/lesson: `docs/GameGuide/lessons/_common.md`, `docs/GameGuide/lessons/horse-race.md`
- 공유 모듈: `docs/GameGuide/02-shared-systems/shared-modules.md`, `ORDER-MODULE.md`, `SOUND-SYSTEM.md`
- 비교 대상(base): `horse-race-multiplayer.html`, `js/horse-race.js`, `socket/horse.js`
- 설계 원본(office-hours): `C:\Users\user\.gstack\projects\on1659-LAMDiceBot\user-feature-ladder-rung-color-speed-design-20260610-015723.md`
