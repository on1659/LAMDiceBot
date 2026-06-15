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
