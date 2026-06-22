# Horse Race — Lessons Learned

경마 게임 작업 중 발견한 함정 / 실수 / 복구 케이스 누적.

> 공통 함정은 [`_common.md`](_common.md) 참조 (Tailwind override, .game-section.active, updateUsers, horse-race.css 의존, URL 진입).

## 누적

## 2026-06-07 — 꾸미기 슬롯은 broadcast·상점탭·렌더 3곳을 동시에 맞춰야 한다

**상황:** 경마 꾸미기 상점 — cosmetic 슬롯(paint/trail/accessory/bib/track_theme/finish_fx)을 추가.
**함정/실수:** `bib`를 서버 `PUBLIC_HORSE_SLOTS`(broadcast 대상)와 상점 탭(`SLOTS`)에는 넣었지만 클라 렌더(`js/horse-shop.js applyEquippedToHorse`)에 빠뜨려, **코인 주고 산 마번이 시각적으로 무반응**. 유료 아이템이 아무것도 안 하는 버그.
**증상:** ReviewerCodex가 "broadcast/탭에는 있는데 렌더 함수엔 없다"고 지적.
**해결/예방:** 꾸미기 슬롯 1개를 추가할 땐 **① 카탈로그(`config/horse/cosmetics.json`) ② broadcast 화이트리스트(`db/cosmetics.js PUBLIC_HORSE_SLOTS`/방연출은 buildRaceCosmetics) ③ 상점 탭(`js/horse-shop.js SLOTS`) ④ 클라 렌더(`applyEquippedToHorse` 또는 방연출 apply)** 4곳을 한 세트로 동기화. `stale` 제거 querySelector에도 새 클래스 추가.
**관련:** `js/horse-shop.js`, `db/cosmetics.js`, `socket/horse.js buildRaceCosmetics`

## 2026-06-07 — 적립 멱등 ref에 generateSessionId(Date.now 포함)를 적립 시점에 쓰지 말 것

**상황:** 경마 종료 시 코인 적립(`socket/horse.js awardRaceCoins`)에 `coin_ledger_idem` 유니크 인덱스(`(user_id, ref, reason)`)로 이중적립 방지 설계.
**함정/실수:** ref를 적립 시점에 `generateSessionId('horsecoin', ...)`로 만들었는데, 이 함수가 **`Date.now()`를 포함**해 매 호출마다 ref가 달라짐 → DB 멱등 인덱스가 **死문**(중복을 못 막음). 당장은 상위 단일-호출 가드(`pendingRaceResult` consume, `isHorseRaceActive=false`) 덕에 무사고지만, grace 재시작/재처리가 추가되면 즉시 이중적립.
**증상:** ReviewerCodex가 `db/servers.js generateSessionId`의 Date.now를 추적해 멱등성 무력화 지적.
**해결/예방:** 멱등 ref는 **레이스당 1회 생성해 저장**(애니메이션 경로는 `pendingRaceResult.coinRef`) 하거나 **결정론적 값**(라운드형은 `horsecoin_${roomId}_${raceRound}`)으로. 적립 시점에 Date.now를 호출하면 안 된다. "레이스 유일 + 재호출 멱등" 둘 다 만족해야 함.
**관련:** `socket/horse.js awardRaceCoins`, `db/coins.js grant`, `db/init.js coin_ledger_idem`

## 2026-06-20 — broadcast 병합 함수의 early-return이 인증-독립(게스트) 경로를 dead code로 만든다

**상황:** 광고 보상 코스메틱 티어 — 게스트/stale-token 유저의 ad-코스메틱을 transient 채널(`room.adCosmetics[socket.id]`)로 broadcast. `socket/horse.js buildRaceCosmetics`가 DB equip(인증 유저)과 ad-오버레이(게스트 포함)를 병합.
**함정/실수:** 함수 앞부분의 `const userIds = users.filter(u => u.authedUserId)...; if (userIds.length === 0) return result;` 조기 return이 **ad-오버레이 코드 앞**에 있었다. ad-오버레이는 `authedUserId`와 무관하게 동작하도록 작성됐지만, **인증 유저가 0명인 방(= 게스트만 모인 방, 이 기능의 1차 타깃)에서는 조기 return에 막혀 영영 실행되지 않음.** 게스트끼리는 ad-코스메틱이 서로 안 보이는 버그.
**증상:** QA 라이브 2탭 테스트(게스트 2명)에서 `horseRaceStarted.horseCosmetics = {}`(빈 값). 코드 리뷰/정적 분석은 통과했고 **라이브 멀티탭 테스트만 잡아냄**.
**해결/예방:** "인증 유저 0명" 조기 return을 제거하고, **DB 조회 블록만 `if (userIds.length > 0) { ... }`로 감싸고, 인증-독립(게스트 transient) 경로는 그 밖에 두어 항상 실행**되게 분리. 일반 규칙: broadcast 병합 함수에 인증 기반 early-return을 둘 때, 그 뒤에 인증과 무관한 경로가 있으면 dead code가 된다 — 조기 return은 인증-의존 블록만 가드하라.
**관련:** `socket/horse.js buildRaceCosmetics`, `docs/goal/applied/shop-ad-reward-tier.md`

## 2026-06-22 — 전역 transient 캐시는 대입 지점만큼 초기화 지점도 명시하라 (라운드 반복 stale)

**상황:** 경마 이름표(닉네임 라벨) 꾸미기 — `horseRaceStarted`가 보내는 `labelCosmetics`(userName→bibId)를 `window._raceCosmetics.labels`에 저장해 이름표 색을 적용.
**함정/실수:** `window._raceCosmetics`는 **`horseRaceStarted` 단 1곳에서만 대입**되고 어디서도 초기화되지 않았다. 이름표 렌더가 선택화면·경주중 양쪽에서 `labels[userName]`을 **전원**에게 적용 → 라운드 N 종료 후 라운드 N+1 **선택화면**에서 타인 이름표가 라운드 N의 옛 색으로 칠해짐(그새 변경/해제해도). broadcast는 경주 시작에만 오므로 선택화면 시점엔 타인의 최신 이름표를 알 수 없는 게 정상.
**증상:** ReviewerCodex가 "이 전역이 *언제 비워지는가*"를 grep으로 역추적(`window._raceCosmetics =` 단 1곳)해 발견. 변경된 라인만 보면 안 보이는 데이터 수명(lifecycle) 결함.
**해결/예방:** broadcast 캐시는 "경주 중"에만 전원 적용하도록 **컨텍스트 인자로 게이팅**(`applyLabelCosmetic(…, useBroadcast)` — 선택화면=내 로컬 장착만, 경주중=broadcast 전원). `_raceCosmetics` clear에 의존하지 않아 라이프사이클 타이밍 결합도 회피. 일반 규칙: 라운드 반복 게임의 전역 transient 캐시는 *대입 지점*을 추가할 때 *초기화/무효화 지점*(라운드 전환·방 이동·다시보기)도 같이 설계하라 — clear 누락이 stale 누수의 단골 원인.
**관련:** `js/horse-race.js`(`applyLabelCosmetic`/`window._raceCosmetics`), `socket/horse.js buildRaceCosmetics`

## 2026-06-22 — 광고 꾸미기를 sessionStorage로 옮기면 방 재입장 시 재emit이 없으면 상대 화면 비대칭

**상황:** 광고 꾸미기 지갑(`_adWallet`)을 영구(localStorage)에서 탭 세션 한정(sessionStorage)으로 전환하고, 같은 탭이면 방 이동/새 판에도 유지하도록 변경.
**함정/실수:** 서버 `room.adCosmetics[socket.id]`는 transient(leaveRoom/disconnect 시 cleanup)다. 저장소만 sessionStorage로 바꾸면 같은 탭에서 owned/equipped는 살아있지만, **방 재입장 시 서버가 비어 상대 화면(레이스 broadcast)에는 내 광고 꾸미기가 안 보이는** 비대칭이 생긴다(내 화면만 보임).
**증상:** F1 정찰/리뷰/QA가 "내 화면엔 보이는데 남에겐 안 보임" 인과로 공통 식별.
**해결/예방:** 방 (재)입장(`roomJoined`/`roomCreated`) 시 sessionStorage의 `_adWallet.equipped`를 슬롯별로 `shop:adEquip` 재emit해 서버 `room.adCosmetics`를 다시 채운다(`ShopModule.reapplyAdEquips`). 일반 규칙: transient 서버 상태를 클라 저장소로 옮길 땐 "재입장 시 재emit 복구" 경로를 항상 같이 설계.
**관련:** `js/shared/shop-shared.js`(loadAdWallet/saveAdWallet/reapplyAdEquips), `js/horse-race.js`(roomJoined/roomCreated), `socket/shop.js shop:adEquip`

## 2026-06-22 — free서버 판정은 currentServerId===null, shortcode는 모든 방에 발급되어 신호로 못 쓴다

**상황:** free서버(자유플레이, 로그인 없음)에서 코인샵을 사용 불가로 게이팅.
**함정/실수:** free 판정 신호로 `shortcode`(방 참여코드)를 쓰면 안 된다 — `socket/rooms.js`가 **정규 서버 방을 포함한 모든 방**에 shortcode를 발급하므로, shortcode 유무로 게이팅하면 정규 서버 코인샵까지 막힌다.
**증상:** F2 정찰이 shortcode 발급 지점(`socket/rooms.js`)을 추적해 "free 전용 신호 아님"을 식별.
**해결/예방:** free서버 = `currentServerId === null`(정규 서버 입장 시에만 값이 채워짐, free 방은 `serverId` 없음)가 유일하게 정확한 신호. 클라에서 free/정규를 가르는 분기는 `currentServerId`로만 판정.
**관련:** `js/horse-race.js`(currentServerId), `socket/rooms.js`(shortcode 발급), `js/horse-shop.js`(coinShopLocked hook)

## 2026-06-22 — 상점 grid 게이팅 시 서브탭 바·광고행은 독립 렌더라 같이 숨겨지지 않는다

**상황:** 코인샵 그리드를 free서버에서 안내문으로 치환(grid 게이팅).
**함정/실수:** `renderModal`에서 grid만 안내문으로 바꾸면, 서브탭 바(`renderTabBar`)와 광고 보기 행(`ad-row`)은 grid 바깥 `panel` 직속으로 **독립 렌더**돼 그대로 남는다 → 서브탭은 보이는데 어느 걸 눌러도 같은 안내문만 나오는 dead-click.
**증상:** Reviewer·QA 공통 지적(서브탭 바가 grid와 무관하게 그려짐).
**해결/예방:** 상점 grid를 게이팅/치환할 땐 **grid + 서브탭 바(renderTabBar) + ad-row 세 군데의 노출 조건을 함께** 점검. 잠금 시 `if (!isSingleSlot() && !coinLockMsg)`로 서브탭 바도 숨긴다.
**관련:** `js/shared/shop-shared.js`(renderModal: grid/renderTabBar/ad-row 노출 조건)

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
