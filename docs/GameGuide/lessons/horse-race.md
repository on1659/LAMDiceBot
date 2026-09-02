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

## 2026-06-23 — directBuy 앵커는 그 (슬롯,경제) 풀의 *최저등급*이어야 한다

**상황:** 가챠 상점 — (슬롯,경제)별로 최저등급 1개만 직접구매(directBuy), 나머지 rare/epic은 뽑기 전용.
**함정/실수:** 광고 경제 풀에는 common 아이템이 없어 **최저등급이 rare**다. 신규 ad 슬롯(track_theme ad 등)을 만들 때 무심코 epic 아이템에 directBuy를 붙이면, 그 풀에서 **가장 희귀·고가 아이템이 가챠를 우회해 직접 구매**되어 "레어=뽑기 전용"이라는 가챠 설계가 깨진다.
**증상:** Scout/Reviewer가 (슬롯,경제)별 `directBuy.rarity === min(pool.rarity)` 전수 검사로 식별.
**해결/예방:** directBuy 앵커는 항상 그 (슬롯,경제) 풀의 최저등급(common 우선, 없으면 rare). 코인 경제는 `price`, 광고 경제는 `adPrice`로 동률 tie-break. 슬롯 추가/편집 시 (슬롯,경제)별 directBuy 정확히 1개 + 그게 최저등급인지 검증.
**관련:** `config/horse/cosmetics.json`, `socket/shop.js buildPool`

## 2026-06-23 — 노랑 계열 이름표는 기본 닉네임 태그(노랑)와 충돌 — 등급/색 추가 시 회피

**상황:** 이름표(bib) 꾸미기 대량 추가. 내 닉네임 기본 태그는 노란색 그라데이션(`var(--yellow-500/600)`)이다.
**함정/실수:** 노랑/금색 bib(`bib_gold` #ffd54a, `bib_ad_topaz` #fbbf24)를 추가하면 장착 시 기본 노랑 태그와 구분이 안 된다. `bib_gold`는 하필 (bib,coin) directBuy 앵커여서, 삭제 시 앵커 재선정(비-노랑 최저등급 rare = `bib_neon`)까지 필요했다.
**해결/예방:** 이름표 색 추가 시 노랑/금색(#ffd54a/#fbbf24 계열) 회피. 노랑 앵커를 지우면 (bib,coin) directBuy를 비-노랑 최저등급으로 재선정.
**관련:** `config/horse/cosmetics.json`(bib), `js/horse-race.js`(닉네임 태그 기본색)

## 2026-07-21 — vehicle_stats는 배포 전역 키(SERVER_ID env)로만 누적 — 방 serverId로 조회하면 서버 방에서 항상 빈다

**상황:** 탈것 통계를 구 📊 모달에서 랭킹 오버레이 경마 탭으로 통합(`docs/goal/applied/ranking-popup-vehicle-stats.md`). 랭킹 payload가 이미 주는 `horseRace.vehicles`를 그대로 렌더.
**함정/실수:** `vehicle_stats`는 **배포 전역 누적 테이블**이다 — 기록이 `recordVehicleRaceResult(getServerId(), ...)`이고 `getServerId()`(`routes/api.js`)는 방/멤버십 serverId가 아니라 `process.env.SERVER_ID || 'default'` 전역 상수다. 그런데 새 통합 테이블은 랭킹 뷰의 방 serverId로 `getHorseRaceStats(serverId)` → `WHERE server_id='<숫자id>'`를 돌려서 **로그인 서버 방에선 항상 0행**(free/'default'에선 정상). 구 모달은 같은 `getServerId()`='default'로 읽어 어느 방에서든 데이터를 보여줬기에, 통합하면서 서버 방 표시가 사라지는 회귀가 생겼다.
**증상:** 사용자가 시즌4 서버 방에서 "탈것통계 어디감?" — free 랭킹은 vehicles 15개, 서버 랭킹(id 70/87)은 vehicles 0개로 확인. DB 직접 질의로 `vehicle_stats`에 `server_id='default'`(15종) 외 행이 없음을 확정.
**해결/예방:** `getHorseRaceStats`의 vehicles 조회만 **기록과 동일한 배포 전역 키**(`process.env.SERVER_ID || 'default'`)로 읽는다. winners(서버별 순위)는 방 serverId 유지. 일반 규칙: 배포 전역 통계 테이블(`vehicle_stats` 등)을 랭킹류에서 읽을 땐 **기록에 쓴 키와 짝을 맞춰라** — 방/멤버십 serverId로 조회하지 말 것. 시즌별 통계는 별도 테이블(`vehicle_season_stats`, champ 칩용)로 분리돼 있음.
**관련:** `db/ranking.js getHorseRaceStats`, `db/vehicle-stats.js`(record/get), `routes/api.js getServerId`, 커밋 `45b9c73`

## 2026-08-11 — rAF는 예약한 창에서만 취소된다 — 창 이관(PiP) 기능은 드라이버 창을 원시 참조로 추적하라

**상황:** 트랙을 Document PiP 창으로 분리하며 레이스 rAF 루프를 PiP 창으로 이관(`window._raceAnimWin` 신설, 취소 7곳·예약 4곳을 드라이버 창 경유로 전환).
**함정/실수:** ① rAF id는 창별 카운터라 예약한 창에서만 취소된다 — 메인 창에서 PiP 발급 id를 취소하면 no-op(유령 루프), 반대로 stale id를 메인에서 취소하면 무관한 rAF(룰렛/잔상)를 오취소. ② 이관 함수에서 "닫힌 창이면 window로 정규화"하는 헬퍼를 쓰면, pagehide 시점에 `closed === true`인 경우 oldWin===newWin으로 조기 return → 취소도 재예약도 안 되어 **경주 화면 영구 동결**.
**증상:** 리뷰에서 재현 경로 추적으로 발견 (PiP 창 X 닫기 → 복귀 후 트랙 정지).
**해결/예방:** 이관 함수 내부는 `window._raceAnimWin || window` **원시 참조 비교**(정규화 금지), 취소는 try/catch(닫힌 창 안전). 정규화 헬퍼(`raceAnimWin()`)는 취소/예약 지점에만 사용. PiP를 타 게임으로 확장하면 이 항목을 `_common.md`로 승격.
**관련:** `js/horse-race.js` migrateRaceDriver, `docs/goal/horse-race-track-pip.md`, C-35/C-36(_common)

## 2026-08-31 — 인덱스 0은 falsy다 — 같은 정리를 하는 코드가 여러 곳이면 한 곳만 어긋난다

**상황:** 추첨 단계에서 무효 등수 회색 처리(`.invalid`)가 어떤 판에서는 안 붙는다는 신고.
**함정/실수:** `leaveRoom`의 베팅 정리가 `if (gameState.userHorseBets[socket.userName])` — **truthy 검사**였다. 0번 탈것을 고른 사람이 나가면 `0`이 falsy라 `delete`를 건너뛰고 유령 베팅이 남는다. 같은 일을 하는 나머지 세 곳(`chat.js:595` 이탈 정리, `shared.js:421` 준비 취소, `shared.js:506` 강제 unready)은 전부 `!== undefined`였다 — 이 한 곳만 달랐다.
**증상:** 유령 베팅이 `runningHorseCount`(= 베팅된 유니크 말 수)를 부풀려 무효여야 할 등수가 유효로 남는다. 사람이 나간 판에서만, 그것도 그 사람이 0번 탈것을 골랐을 때만 재현되어 "가끔 안 된다"로 보였다. 회색 로직 자체는 정독해도 멀쩡했고, 실브라우저로 `runningHorseCount` 값을 찍어서야 원인이 상류에 있다는 게 드러났다.
**해결/예방:** 인덱스·개수처럼 **0이 정상값인 맵**을 정리·조회할 땐 반드시 `!== undefined`. 같은 상태를 정리하는 코드가 여러 경로(퇴장/이탈/준비취소/강제unready)에 흩어져 있으면, 하나를 고칠 때 나머지를 grep해 검사 방식이 같은지 확인하라. 유령 베팅은 회색 표시뿐 아니라 `getWinnersByRule` 당첨 판정과 코인 정산에도 섞여 들어갔다.
**관련:** `socket/rooms.js:1212`, `socket/horse.js:754` runningHorseCount, 커밋 5af3e3b

## 2026-08-31 — 상태 초기화는 "화면이 실제로 읽는 변수"를 기준으로 하라

**상황:** 재경기(게임 종료를 누르지 않고 준비만 다시 하고 시작) 시 탈것 선택 UI가 이전 라운드 선택을 그대로 보여주는데 서버는 미선택으로 판정.
**함정/실수:** 서버는 정산 때 `gameState.userHorseBets`를 비우고(`socket/horse.js:1236,1274`), 클라의 `horseRaceEnded` 핸들러는 `mySelectedHorse = null`만 했다. 그런데 선택 그리드가 "내 선택"을 칠하는 기준은 `mySelectedHorse`가 아니라 `userHorseBets[currentUser]`(`js/horse-race.js:1687`)다. 초기화한 변수와 화면이 읽는 변수가 달라 리셋이 무효였다.
**증상:** 시작 버튼에 "모든 사람이 말을 선택해야 시작할 수 있습니다!". 게임 종료(`endHorseRace`)를 누르면 `horseSelectionReady`가 새로 와서 전체 재동기화되므로 **그 경로로 테스트하면 재현되지 않는다** — 종료를 건너뛰는 흐름에서만 나온다.
**해결/예방:** 리셋 코드를 추가·수정할 땐 그 상태를 렌더가 실제로 읽는 곳을 grep해서 확인하라(같은 의미의 상태가 둘로 갈라져 있으면 둘 다). 재생 중 도착한 종료의 초기화는 즉시 적용하지 말고 재생 완료 시점으로 미룬다 — 중간에 비우면 미니맵의 "내 말 ▼" 표식(`:2995`)이 경주 도중 풀린다. `pendingHorseSelectionReady`와 같은 보관 패턴을 쓴다.
**관련:** `js/horse-race.js` clearRoundBets / horseRaceEnded, 커밋 695881c

## 2026-08-31 — "안 된다"는 신고는 코드 정독보다 실측이 빠르다

**상황:** 룰렛 단계 회색 처리 신고를 받고 클라·서버 코드를 반복해서 읽었지만 로직상 결함이 없었다. 잘못된 가설(투표 시점에 등수를 막아야 한다)로 한 번 배포했다가 되돌렸다.
**함정/실수:** 증상만 듣고 원인을 추측해 코드를 고쳤다. 실제로는 회색 로직이 정상이었고, 그 입력값(`runningHorseCount`)을 만드는 상류가 오염돼 있었다.
**증상:** 정적 분석으로는 끝까지 안 잡혔다. `AutoTest/qa-horse-render-vs-server-test.js`를 복제해 Playwright로 방을 만들고 `horseRouletteStart` payload와 `.rank-vote-box` 클래스를 찍자 15분 만에 값이 어긋나는 지점이 드러났다.
**해결/예방:** 멀티플레이 상태 버그는 **재현 프로브부터** 만들어라. 기존 하네스(방 생성 + 소켓 게스트 + 브라우저 1)를 복사해 확인하려는 값 하나만 찍으면 된다. 수정 후 같은 프로브로 A/B를 남기면 커밋 메시지의 근거가 된다.
**관련:** `AutoTest/qa-horse-render-vs-server-test.js`(하네스 원본), 커밋 5af3e3b·695881c

## 2026-09-03 — 테스트 대기 시간은 리터럴이 아니라 서버 상수에서 파생하라

**상황:** 재경기 자동 시작 작업의 회귀 확인으로 `AutoTest/qa-scheduled-start-horse-test.js`를 돌렸더니 3번 항목(정산 워치독)만 timeout FAIL.
**함정/실수:** 테스트가 `horseRaceEnded`를 `105000`ms 리터럴로 기다렸다. 그 사이 `socket/horse.js`의 `HORSE_RACE_SIM_MAX_MS`가 60s→90s로 늘어(막판 기믹 창 확장) 워치독 발동이 시작 후 120초(90s + `HORSE_SETTLE_GRACE_MS` 30s)로 밀렸는데, 테스트의 숫자는 아무도 따라 고치지 않았다.
**증상:** 서버 로그에는 `[경마] 정산 워치독 발동`이 정상으로 찍히는데 테스트만 "방이 잠긴 채로 남는다"고 보고해 회귀로 오판할 뻔했다.
**해결/예방:** 대기 시간을 `HORSE_RACE_SIM_MAX_MS + HORSE_SETTLE_GRACE_MS + 여유`로 파생(`socket/horse.js`가 테스트용으로 상수를 export). 규칙: 서버 타이머를 기다리는 테스트는 그 타이머를 만드는 상수를 require해서 계산하라 — 숫자를 베껴 적으면 상수가 바뀔 때 조용히 스테일이 된다. 회귀로 판정하기 전에 서버 로그에서 그 동작이 실제로 일어났는지 먼저 본다.
**관련:** `AutoTest/qa-scheduled-start-horse-test.js`, `socket/horse.js HORSE_RACE_SIM_MAX_MS`, `config/index.js HORSE_SETTLE_GRACE_MS`

## 2026-09-03 — 서버가 스스로 예약을 걸 땐 armSchedule을 타지 않는다

**상황:** 동점/당첨자 없음 재경기에서 서버가 30초 뒤 예약 시작을 자동으로 걸도록 추가(`docs/goal/applied/horse-race-rematch-auto-start.md`).
**함정/실수:** `socket/scheduled-start.js armSchedule`은 방장 입력 검증기다 — 프리셋 분 목록(3/5/10/30)과 최소 여유 3분을 강제해서 30초를 넣으면 "최소 3분 뒤부터"로 거절된다. 또 예약은 준비(readyUsers)를 대신 눌러주지 않으므로, 준비자가 2명 미만인 상태에서 걸면 발화 시 `canStartHorse`가 "최소 2명"으로 거절해 "건너뛰었어요" 알림만 남긴다.
**증상:** 정찰에서 armSchedule의 검증 목록과 `fire()`의 canStart 재검사를 읽고 사전에 회피.
**해결/예방:** 서버 내부 예약은 `gameState.scheduledStartAt`을 직접 쓰고 `broadcastSchedule` + `roomNotice`만 부른다(`startHorse`가 예약을 지울 때 이미 직접 쓰는 선례). 걸기 전에 발화 조건(준비자 ≥2)이 그 시점에 성립하는지 확인하고 아니면 걸지 않는다. 방장 리셋(`endHorseRace`/`clearHorseRaceData`)에서는 예약을 풀어 유령 발화를 막는다. 방장이 먼저 [시작]을 누르면 `startHorse`가 예약을 해제하고 알린다 — 예약은 시작 버튼을 대신 누를 뿐이라는 원칙 그대로.
**관련:** `socket/horse.js settleRace / dropScheduledStart`, `socket/scheduled-start.js armSchedule / fire`

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
