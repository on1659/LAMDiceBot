# impl: spin-arena 듀얼룰 승리조건 (인원수 분기 배틀로얄 / 몬스터 레이스→결승)

> Source of truth for the dual-rule rework. Goal: `docs/goal/spin-arena-dual-rule-win-condition.md`.
> 수치는 시작값(starting point) — **권위는 200시드 배치(`AutoTest/spin-arena-determinism-test.js`)**. 구현 후 배치로 튜닝.

## 0. 핵심 아키텍처 결정 (정찰에서 확정)

- **단일 reveal payload + t-결정론 보간 유지.** 라운드 전환을 새 소켓 이벤트로 쪼개지 않는다. round1→round2 경계는 payload 안의 t-임계(`round1EndMs`)로 처리한다 → 2탭 동기·다시보기 일관성 보존. (정찰 lesson 후보)
- **공정성 절대 불변:** 몬스터 스폰/이동/AI, 점수, 탈출, 부활, 라운드 경계 전부 서버 시드 시뮬 안. 클라 `Math.random` = deviceId/tabId + cosmetic만. 몬스터 위치/데미지/순위는 100% payload 파생.
- **소켓 이벤트명 불변.** payload는 additive(필드 추가). `frames` 슬롯 폭은 유지(`n*3`).

## 1. 룰 분기 (인원수)

`simulate(slots, seed)` 시작 시 `n = slots.length`로 분기:

| n | rule | 승리조건 |
|---|------|----------|
| ≤4 | `battle-royale` | 몬스터·부활 없음. **첫 죽음(HP 0)=당첨**. 즉시 종료(decideMs=첫 죽음). |
| ≥5 | `monster-race` | round1(몬스터 데미지 레이스, 타임박스)→round2(잔여 배틀로얄). |

payload 신규 필드 `rule`('battle-royale'|'monster-race'), `round1EndMs`(≥5만, round1 끝=round2 시작 t), `monsters`(reveal 메타: 개수/스폰), `monsterFrames`(키프레임), `monsterKills`(킬 FX 이벤트).

## 2. frames 채널 의미 (폭 = n*3 유지: [x, y, c])

`c` = 룰별 **단조 비감소 진행 스칼라**:
- **≤4:** c = 받은 데미지 누적. HP바 = (HP_MAX−c)/HP_MAX. c≥HP_MAX 도달=죽음=종료.
- **≥5:** c = **몬스터에 입힌 데미지 누적**(=리더보드 점수·탈출 진행도). 탈출 임계 `SCORE_ESCAPE` 도달=탈출. round2 동안 동결(몬스터 없음). round1 몬스터 피격→tombstone은 `downs[]`로 별도(현 부활 구조 재사용).

round2 전투는 frames의 x/y 이동 + decideMs 죽음 이벤트로 표현(별도 HP 채널 불필요 — 현 게임이 보여주던 막판 KO 연출 재사용).

## 3. ≤4 배틀로얄 시뮬

기존 칼날 전투(회전 칼날 선분 vs 몸 원, 넉백, 링 수축, 중앙 인력) **그대로 재사용**하되:
- 칼 성장(받은 데미지→칼 +1) **제거**(BLADE_COUNT 고정). "맞으면 좋다" 반직관 제거 — goal 동기.
- 탈출 **없음**. 부활 **없음**.
- HP 0 첫 도달 캐릭터 = `down`(좌표 동결) + `decideMs = tMs` 확정 → 종료 압축(durationMs = min(GAME_MS, ceil((decideMs+DECIDE_TAIL_MS)/SAMPLE_MS)*SAMPLE_MS)).
- selected = 그 죽은 캐릭터. 나머지 = 안전(승자).
- 링 수축이 강제 교전 → 첫 죽음 보장. (배치로 결판률 검증.)

## 4. ≥5 몬스터 레이스→결승 시뮬

### round1 (몬스터 데미지 레이스, 타임박스 = `ROUND1_MS`)
- **몬스터 스폰:** 개수 `monsterCount(n) = clamp(round(n*MON_PER_PLAYER)+jitter, MON_MIN, MON_MAX)`, jitter=seeded 0/1. 스폰 좌표 = 시드. 몬스터 HP = `MON_HP` 각.
- **캐릭터 auto-hunt:** 활성 캐릭터는 매 틱 **가장 가까운 살아있는 몬스터** 방향으로 가속(`HUNT_PULL`) — 입력 없음, 결정론. 몬스터 없으면 기존 드리프트.
- **데미지 입힘:** 캐릭터 회전 칼날 선분이 몬스터 원과 겹치면 몬스터 HP↓, 그만큼 캐릭터 `c`(점수)↑. 몬스터 HP 0 = 처치(제거, `monsterKills` push). **리스폰 없음**(유한 풀 → 점수 상한 → escapers<total 자연 funnel).
- **몬스터 반격:** 몬스터 몸이 캐릭터에 닿으면 캐릭터 HP↓(`MON_TOUCH_DPS`). 캐릭터 HP 0 = tombstone→`REVIVE_MS` 부활(round1 죽음은 탈락 아님). 기존 down/revive/grace 구조 재사용.
- **탈출:** 캐릭터 `c ≥ SCORE_ESCAPE` = 탈출(좌표 동결·시뮬 이탈, `escapes` push, 순위=탈출 순). **문 닫힘 규칙: 항상 잔류 ≥1**(마지막 1명 탈출 거부 — 현 sim 패턴).
- **round1 종료** = **EARLIEST**(timer `ROUND1_MS`, 잔류(비탈출)≤`ROUND1_EARLY_CUT`, 살아있는 몬스터 0). → `round1EndMs` 확정.

### round2 (잔여 배틀로얄)
- round1 종료 시점 **비탈출 잔류자**들로 진행. 부활 OFF. 칼 고정.
- 잔류 1명: 그가 곧 selected(round2 전투 불필요).
- 잔류 ≥2: 칼날 전투(링 계속 수축) → **첫 HP 0 죽음 = decideMs = selected**, 즉시 종료압축.
- 몬스터는 round1 종료 시 전부 제거(monsterFrames에서 round1EndMs 이후 비표시).

### selected (당첨)
- ≤4: 첫 죽음. ≥5: round2 첫 죽음. 둘 다 **정확히 1명**. DB rank2/isWinner=false 불변.

## 5-b. 페이싱 재조정 (2026-06-13 추가 — "보는 맛" 요청, 경마 1000m≈40초 기준)

round1을 메인 볼거리로 확장. **이 절이 최신 수치 권위.**

```
GAME_MS = 60000;          // 하드 캡 상향(인트로 3s 가산)
ROUND1_MS = 30000;        // round1 = 30초 (몬스터 레이스 = 메인). 실측 전 게임 round1EndMs=30000
ROUND1_EARLY_CUT = 1;     // 사실상 미발동(문닫힘 ≥2라 잔류 항상 ≥2)
MON_RESPAWN = true;       // 처치 시 새 몬스터 즉시 등장(시드) → 30초 사냥 지속(dead-air 방지)
MON_HP = 180; MON_PER_PLAYER = 0.9; MON_MAX = 20; MON_HIT_DPS = 85;
SCORE_ESCAPE = 560;       // 높게 → 30초 동안 상위권만 탈출, 나머지 계속 사냥
RING2_SHRINK_MS = 6500; ROUND2_HP = 90;
문닫힘 = 잔류 ≥2 (탈출 거부) → round2 항상 ≥2인 결투 보장(escapes ≤ n-2)
// 배틀로얄(≤4) 최소 10초 보장
BR_HIT_DPS = 50;          // 캐릭터간 데미지 낮춤 → 첫 죽음 ~10~25초(n4 ~13s·n2 ~28s)
MIN_BR_MS = 10000;        // 이 시각 전엔 hp 1 미만 클램프 → 절대 죽지 않음(최소 10초 하드 보장)
// round2 진입 3·2·1 인트로
ROUND2_INTRO_MS = 3000;   // round1 종료 후 3초 전투 정지(중앙 집결·링 풀) + 화면 3·2·1 카운트다운 → 결투 시작.
                          // 링 수축은 인트로 종료(round1End+3000)부터. 클라는 t로 카운트다운 렌더(스크린 공간, 2탭 동일)
```

배치 실측(200시드): round1 = 전 게임 30초, round2 ≈ 9~17초, 전체 ≈ 38~47초. 결판률 n5~16 ≥96%·n20=90%·n24=99%(나머지 캡 hp-tiebreak, 단일 당첨자 유지). 몬스터 리스폰으로 mhp 채널 톱니(단조 아님) — 클라는 hp 증가 감지 시 새 좌표로 스냅(슬라이드 방지). 데스캠 줌+슬로우모션 연출은 **후속 작업**.

## 5. 수치 (초기 튜닝 — 5-b가 최신 권위)

```
SPIN_BR_MAX = 4;             // ≤4 배틀로얄, ≥5 몬스터레이스
ROUND1_MS = 15000;           // round1 타임박스(주 종료). 실측: 대부분 ≤3 조기컷이 먼저 발동(round1End ~4~9s)
ROUND1_EARLY_CUT = 3;        // 비탈출 ≤3 → round1 조기 종료
MON_PER_PLAYER = 0.8; MON_MIN = 3; MON_MAX = 18;   // 몬스터 수 = round(n*0.8)+지터(0/1)
MON_HP = 340;                // 타임박스 동안 생존(데미지 레이스 성립). 유한 풀(리스폰 없음)
MON_RADIUS = 16; MON_TOUCH_DPS = 80; MON_DRIFT = 16;
MON_HIT_DPS = 95;            // 칼날→몬스터 = 점수 획득량
HUNT_PULL = 90;              // round1 캐릭터→최근접 몬스터 가속
SCORE_ESCAPE = 150;          // 탈출 점수 임계
RING2_SHRINK_MS = 4200;      // round2 링 수축(round1End부터, 빠른 강제 교전)
ROUND2_HP = 60;              // round2 진입 시 잔류자 HP 정규화(빠른 결투 — 소형스케일 고인원 캡 안 결판)
REVIVE_MS = 3000; REVIVE_GRACE_MS = 800;   // round1만
```

배치 실측(200시드): 양 경로 **전량 단일 당첨자 1명**, 구조 0위반, 결정론 동일. 결판률(death로 확정) n2~16=100%, n20=99.5%, n24=95.5%(나머지 캡 hp-tiebreak — 여전히 단일 당첨자, durationMs≤30000). 탈출 평균 n5=2.0 … n24=21.0(escapers<total funnel). selected 편향 균등.

## 6. 클라 렌더

- **몬스터 렌더:** 월드 변환 안, 바닥/링 다음. `drawMonster` 신규(monsters-base.png spriteOn + 벡터 폴백). monsterFrames t-보간. 미니맵에 몬스터 점.
- **실시간 데미지 리더보드:** 기존 `#spinHpPanel` + `cols-N` 인프라 재사용. round1 = 점수(c) 내림차순 순위 + 탈출 마킹. round2 = round1 최종 순위 동결 + 잔류자 "결승" 표시. ≤4 = HP 게이지(현 패널 의미 유지).
- **미션 텍스트(`spinMissionText(rule, round, t)`):** 룰/라운드별 평이한 한국어.
  - ≤4: `"⚔️ 먼저 쓰러지는 1명이 당첨! 끝까지 버티세요"`
  - ≥5 round1: `"👾 몬스터를 처치해 점수를 모으세요! 먼저 탈출하면 안전"`
  - ≥5 round2: `"🏁 최종 결투 — 먼저 쓰러지는 1명이 당첨!"`
- **round1→round2 전환 연출:** `round1EndMs` t-임계에서 플래시+텍스트("최종 결투!"). 몬스터 페이드아웃.
- **결과 오버레이:** ≥5는 탈출자=통과 / round2 패자=당첨 2계층. 기존 `escapeMs` 분기 확장.
- **스포일러 가드 유지:** selected 적색 강조는 decideMs 이후만.

## 7. 에셋 (먼저 생산)

- `assets/spin-arena/sprites/monsters-base.png`: 512×128, 4×1, cell 128×128, anchor(64,64), baseline y=64. 어둡고/붉은 위협적 실루엣, 플레이어와 명확히 구분. 고정 외형(per-player tint 불필요 → 별도 로더, tint 미적용).
- manifest: monster 엔트리 추가(image+grid+idle).
- 생성: 로컬 procedural(Node + 내장 zlib PNG 인코더, 이미지 라이브러리 무의존). 생성 스크립트는 dev 도구로 서버 경로 밖.
- 벡터 폴백 유지(spriteOn=false 경로). PNG 로드 실패해도 게임 무중단.
- 사운드(선택): `spin-arena_monster_hit`/`_die` 키 placeholder.

## 8. 검증

- `node -c` 전 대상 파일.
- 결정론/구조정합/200시드 배치(양 룰) PASS.
- 2탭 동기(frames/monsterFrames/result 동일).
- fairness grep: `js/spin-arena.js` Math.random = deviceId/tabId만.
- reveal 마스킹(timeline/result/seed 미노출) 유지.
- 통합: recordGamePlay/recordServerGame/recordGameSession, sound, skins, tutorial, chat, countdown, replay.
- dev 서버(5173) 재시작 후 수동 QA(≤4 / ≥5 양 경로).

## 9. 불변조건 (must-preserve)

- No-input 결정론. 단일 당첨자(벌칙) DB rank2/isWinner=false. 클라 Math.random 결과 무영향. reveal 마스킹·2탭 동기. 30초 캡. 소켓 이벤트명 불변·payload additive. "회전 칼날 in 아레나" 정체성 유지(몬스터는 칼날이 베는 추가 위협, 새 장르 아님).
