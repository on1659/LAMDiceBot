# 경마 꾸미기 상점 + 코인 지갑 — Goal

경마 게임에 **꾸미기 상점**(탈것 도색/트레일/액세서리 + 방 연출)과 **코인 지갑**(플레이로 적립, 미래 현금충전)을 추가한다. 브랜치 `feature/goal-game-mode`. 꾸미기는 **게임 결과에 0 영향**(시각/청각만), 코인은 상점 구매용. 이미 **Phase 1(시각 전용)이 구현·리뷰 완료**되었으므로, 새 세션은 먼저 현재 상태를 체크하고 남은 단계를 이어서 진행한다.

> 전제/baseline: Phase 1(상점 UI + 도색/트레일/액세서리 렌더 + localStorage 무료장착)이 이미 적용됨. 전체 설계의 source of truth는 **`docs/meeting/impl/2026-06-07-horse-shop-impl.md`** (이걸 반드시 먼저 읽는다). 설계 배경은 `docs/meeting/plan/single/2026-06-07-horse-shop-cosmetics.md`.

## 한 줄 요약

① **시작 전 Phase 1 상태 체크** → ② **방 연출 꾸미기**(트랙 테마/결승 이펙트) 추가 → ③ **코인 지갑 + 인증 + 실제 구매**(무료장착 → 코인 차감) 구현.

## 시작 전 현재 상태 체크 (반드시 먼저 — 중복 구현 방지)

새 세션은 코드를 쓰기 전에 아래를 확인해서 **어디까지 됐는지** 판단한다:

**Phase 1 (시각 전용) — 이미 완료되었어야 함. 다음이 존재/동작하면 스킵:**
- [ ] `config/horse/cosmetics.json` 존재 (paint 4 / trail 3 / accessory 3 + 빈 후속 카테고리)
- [ ] `js/horse-shop.js` 존재 (전역 `HorseShop` 모듈: openShop/applyToHorse/getEquipped)
- [ ] `css/horse-shop.css` 존재
- [ ] `horse-race-multiplayer.html`에 `horse-shop.css` link + `horse-shop.js` script(horse-race.js보다 먼저) + 🛒 상점 버튼 + mount div
- [ ] `js/horse-race.js` 내 탈것 생성부(약 1670줄)에 `horse.classList.add('my-horse')` + `HorseShop.applyToHorse(horse)` 훅
- 확인 명령: `git log --oneline -10`, `grep -rn "HorseShop\|horse-shop" horse-race-multiplayer.html js/horse-race.js`, `ls config/horse/cosmetics.json js/horse-shop.js css/horse-shop.css`

**판단 기준:** 위가 다 있으면 Phase 1 완료 → ②부터. 일부만 있으면 impl 문서의 해당 모듈(M5 상점UI / M6 꾸미기렌더)부터 보강. 전혀 없으면 impl 문서 M5/M6부터.

**아직 안 된 것 (이번 goal의 작업 대상):**
- 방 연출 꾸미기(트랙 테마/결승 이펙트) — 미구현
- 코인 지갑/원장/인벤토리 DB(`user_coins`/`coin_ledger`/`user_cosmetics`) — 미구현
- socket 인증(`socket:authenticate`, `socket.authedUserId`) — 미구현
- 적립 훅(경마 종료 시 코인) — 미구현
- 상점 소켓 핸들러(`shop:buy`/`shop:equip`/`wallet:get`) — 미구현
- 현재 "구매"는 localStorage 무료장착 → 실제 코인 차감으로 전환 필요

## 핵심 규칙 (남은 작업, impl 문서 모듈 매핑)

1. **방 연출 꾸미기 추가** — 트랙 테마(우주/사막/해변/네온/설원 배경 교체) + 결승 이펙트(폭죽/색종이). v1은 **방장(host) 장착분만 방 전체 broadcast**(개인은 자기 화면만). gameState/leaveRoom cleanup을 건드리지 않게 `horseRaceStarted` 페이로드에 transient `roomCosmetics`로 실어 보냄(impl §6 "방 연출 꾸미기"). → 타인 탈것 꾸미기 broadcast도 이때 함께(현재 Phase 1은 내 탈것만 보임).

2. **코인 지갑 + 인증 (보안 린치핀, impl §1·§2·§3)** — **반드시 인증 먼저.** 이 코드베이스는 socket 인증이 없어 `data.name`을 그냥 믿는다 → 돈을 올리면 무한코인/타인지갑 조작 가능. 지갑은 자유 닉네임이 아니라 **`users.id`(인증 계정)**에 매단다. 게스트(비로그인)는 상점 제외.
   - DB: `user_coins`(잔고, CHECK≥0) / `coin_ledger`(원장, 멱등 UNIQUE) / `user_cosmetics`(인벤토리). `db/init.js`에 멱등 CREATE.
   - 트랜잭션: `db/ranking.js:430 startNewSeason`이 이미 `pool.connect()` + BEGIN/COMMIT 패턴을 쓴다 → 그대로 재사용(구매/적립은 원자적, silent-fail 금지).
   - 적립: 경마 종료 **2경로 모두**(`socket/horse.js` 메인 ~530 + 라운드형 ~1058), **serverId 가드 밖**으로(자유플레이 0코인 버그 방지), sessionId 멱등.
   - 시작 코인(전적 환산, 낮은 배율): `판수×3 + 승수×10` (config 조정 가능). `server_game_records` 집계(`db/ranking.js getOverallRanking` 패턴)로 1회 backfill.

3. **실제 구매/장착 전환 (impl §4·§5)** — `socket/shop.js`(신규) + index.js 등록. `shop:catalog`/`shop:buy`/`shop:equip`/`wallet:get` 전부 `socket.authedUserId` 기반(`data.name` 금지). 가격은 서버 카탈로그 권위(위변조 차단). Phase 1의 무료 localStorage 장착 → 코인 차감 + DB 인벤토리/equipped로 전환.

## 공정성 (게임 대상 — 필수)
- 결과는 서버에서만 결정, 클라는 시각화. 클라 `Math.random`은 deviceId/tabId 외 0회.
- **cosmetic id는 결과 계산 경로에 진입 0** — `calculateHorseRaceResult`(`socket/horse.js:1587`)·`getWinnersByRule`(`:348`)에 장착/cosmetic 데이터 유입 금지. 장착을 `gameState.users[]`·`userHorseBets`에 병합 금지. 정적 가드: `grep -nE "cosmetic|equipped|paint|trail" socket/horse.js`가 적립/emit 경로에만, 계산 함수 본문엔 0.
- 인지적 공정성: trail/finish_fx가 타 레인·결승선 통과를 가리지 않게(z-index/overflow/pointer-events).
- 도색 필터는 `.vehicle-sprite`에만(이벤트 연출이 `.horse` filter 점유 → `.horse`에 걸면 첫 기믹에 사라짐).

## 기존 통합 유지 (스킵 금지)
- 통계/랭킹/튜토리얼/사운드/Order/Ready/Chat 계속 동작.
- 기존 prefs 핸들러(`getUserPrefs`/`setUserPref`/`getUserFlags`/`setGuideComplete`) 무수정(회귀 위험). 장착은 신규 `shop:equip`(authedUserId)로.
- 공유 모듈(`control-bar-shared.js`, `room-helpers.js`, `theme.css`, `ctx` 객체) 무수정 — 주사위/룰렛/사다리/다리건너기 0영향.
- AdSense 블록(`horse-race-multiplayer.html` ~131-141) 침범 금지.

## 작업 방식
- **먼저 읽기:** `docs/meeting/impl/2026-06-07-horse-shop-impl.md`(전체 명세), `docs/GameGuide/03-games/horse-race.md`, `docs/GameGuide/lessons/horse-race.md`, `docs/GameGuide/lessons/security.md`(socket 인증 S-1), `docs/GameGuide/lessons/_common.md`.
- 트리아지 COMPLEX(DB+socket+인증+공정성) → Scout→Coder→Reviewer→QA 파이프라인.
- 모바일·PC 양쪽 대응을 계획 단계부터. 소켓 변경 시 dev 서버 수동 재시작(자동 리로드 없음).
- 순서: ① 방 연출(저위험) → ② 인증 → ③ 지갑 DB → ④ 적립 → ⑤ 상점 핸들러 → ⑥ 무료장착→코인 전환. 각 단계 `node -c` + 2탭 테스트.

## 테스트
- 수동 2탭(로컬 서버 + 경마 방): 로그인 유저 상점 구매→코인 차감→장착→레이스 적용, 게스트 상점 차단, 동시 구매 시 잔고 음수 불가, 자유플레이 적립, 재경기 이중적립 없음, 방장 트랙테마 방 전체 표시.
- 공정성 grep 가드 통과. 경마 기존 흐름(선택→레이스→결과→히스토리·랭킹·통계) 미파손.

## 완료 기준 (하나라도 미완이면 완료 아님)
- 방 연출 꾸미기(트랙 테마/결승 이펙트) 장착·적용 동작 + 방장 broadcast.
- 코인 지갑 DB 3테이블 생성, 인증된 유저만 적립/소비, 트랜잭션 원자성·잔고 음수 불가·멱등 적립.
- 상점에서 코인으로 실제 구매→소유→장착, 게스트 차단, 가격 위변조 차단.
- 타인 탈것 꾸미기가 레이스에서 보임(broadcast).
- 공정성 grep 가드 0, 크로스게임 미파손.
- `update-log.md` 기록. 새 리소스(사운드/배경 등) 여부 명시.
- 마지막 보고에 변경 요약·파일·테스트 명령/결과·자체 평가·남은 이슈 포함.

## 막힘 기준
- 코인 경제 수치/가격이 불명확하면 impl 문서 기본값(참여+10/승리+30/시드=판수×3+승수×10/가격표)으로 진행하되 보고.
- 인증 방식(매 연결 pin 재검증 vs 토큰)이 애매하면 최소변경(매 연결 재검증) 채택, 근거와 함께.
- 테스트 불가(DB 미연결 등) 시 구현은 완료하되 어디서 막혔는지 구체 보고 + 수동 QA 체크리스트 제시.

## 참고
- 전체 명세(source of truth): `docs/meeting/impl/2026-06-07-horse-shop-impl.md`
- 설계 배경: `docs/meeting/plan/single/2026-06-07-horse-shop-cosmetics.md`
- 목업: `prototype/horse-shop-mockup.html`(상점), `prototype/horse-shop-applied-mockup.html`(적용 화면)
- 규칙: `.claude/rules/new-game.md`, `.claude/rules/backend.md`, `.claude/rules/frontend.md`
- Scout 핵심 발견(린치핀): socket 인증 부재 → 지갑은 `users.id`. 트랜잭션은 `db/ranking.js:430` 패턴 재사용. 적립은 serverId 가드 밖 + sessionId 멱등. 도색 필터는 `.vehicle-sprite`.
