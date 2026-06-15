# impl: 경마 꾸미기 상점 + 코인 지갑 (인증 포함 풀 구현)

작성: 2026-06-07 · /office-hours 설계 → Scout/ScoutCodex 정찰 → 본 명세
브랜치(예정): `feat/horse-shop`
근거 설계: `docs/meeting/plan/single/2026-06-07-horse-shop-cosmetics.md`
트리아지: **COMPLEX (보안 임계)** — DB 신규 + socket 인증 + 트랜잭션 + 공정성 경계 + 크로스게임 공유 자산

> 이 문서가 구현의 source of truth다. 구현 세션은 이것만 읽는다.
> 사용자 결정: **"인증까지 포함한 풀 상점 한 덩어리"** — 게스트(비로그인)는 상점 제외, 로그인 전용.

---

## 0. 정찰이 바꾼 전제 (반드시 먼저 읽을 것)

Scout + ScoutCodex 양측이 합의한 블로커:

1. **이 코드베이스엔 서버 인증이 없다.** 게임 속 `userName`은 자유 입력 닉네임이고 `users` 계정과 무관. 기존 `setUserPref`/`getUserPrefs`/`getUserFlags`는 클라가 보낸 `data.name`을 그냥 믿는다 (`socket/index.js:197,219,228`). → **돈을 그 위에 올리면 무한코인·타인지갑 조작 가능.** 미래 현금충전 계획 때문에 진짜 금전사고.
2. **트랜잭션이 코드베이스에 0건.** 돈은 원자적 차감 + 원장 정합성 필수.
3. **적립 지점이 `room.serverId` 가드 안** (`socket/horse.js:522,1058`) → 가드 밖으로 빼지 않으면 자유플레이 0코인.
4. **경마 종료 경로 2개** (`socket/horse.js:518-556`, `:1029-1091`) → sessionId 멱등성 없으면 이중/누락 적립.
5. **`.horse` `style.filter`를 이벤트 연출이 점유** (`js/horse-race.js:2494,2525,2563`) → 도색 필터와 충돌. wrapper 분리 필요.
6. **탈것은 SVG 인라인 렌더** (`getVehicleSVG`, `js/horse-race-sprites.js`) — 설계의 "PNG hue-rotate"는 부정확하나 CSS filter는 SVG에도 동일 적용.

→ 결론: **인증 식별자가 모든 것의 린치핀.** 지갑/인벤토리는 `users.id`에 매단다.

---

## 1. 보안 모델 (린치핀 — 가장 먼저 구현)

### 1-1. socket 인증 핸드셰이크 (신규)
- HTTP 로그인(`db/auth.js login`)은 stateless. socket에 인증을 심는 신규 이벤트:
  - `socket:authenticate { name, pin }` → 서버가 `db/auth.js`의 `comparePin`으로 재검증 → 성공 시
    - `socket.authedUserId = user.id` (서버 메모리, 클라가 못 건드림)
    - `socket.authedUserName = user.name`
    - `callback({ ok:true, name, balance })` 로 잔고까지 반환
  - 실패 시 `callback({ ok:false })`. socket.authed* 미설정.
- **클라이언트:** `localStorage.userAuth`(name + pin)로 socket connect 직후 1회 `socket:authenticate` emit. (pin 평문 보관은 기존 앱이 이미 하는 방식 — 본 작업 범위 밖, security.md 별도 과제로 남김.)
- **모든 지갑/상점 핸들러는 `socket.authedUserId`만 사용. `data.name` 절대 신뢰 금지.** 미인증 socket의 `shop:*`/`wallet:*`는 즉시 `{ ok:false, reason:'auth' }`.

### 1-2. 불변조건
- 기존 `getUserPrefs`/`setUserPref`/`getUserFlags`/`setGuideComplete` 핸들러는 **이번 작업에서 손대지 않는다** (회귀 위험). 신규 지갑만 `authedUserId` 기반.
- 단, **장착(equip) 정보도 돈과 같은 신뢰 경계** → 장착 저장은 신규 `shop:equip`(authedUserId 기반)으로. 기존 `setUserPref` 재사용 금지.

---

## 2. DB 스키마 (`db/init.js` initDatabase 내부, users 블록 직후 추가)

모두 `CREATE TABLE IF NOT EXISTS` (기존 멱등 마이그레이션 패턴, `db/init.js:240`). **FK는 `users(id)`로 건다** (게스트는 행 자체가 없으므로 지갑 없음 = 의도된 설계).

```sql
-- 코인 지갑 (계정당 1행)
CREATE TABLE IF NOT EXISTS user_coins (
  user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance   INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 코인 원장 (모든 적립/소비/충전 감사 추적)
CREATE TABLE IF NOT EXISTS coin_ledger (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,              -- +적립 / -소비
  reason     VARCHAR(40) NOT NULL,          -- 'race_join' | 'race_win' | 'buy:<cosmeticId>' | 'topup'
  ref        VARCHAR(80),                   -- game_session_id 또는 결제 id
  created_at TIMESTAMP DEFAULT NOW()
);
-- 게임 적립 멱등성: 같은 (user, session, reason)은 1회만
CREATE UNIQUE INDEX IF NOT EXISTS coin_ledger_idem
  ON coin_ledger (user_id, ref, reason) WHERE ref IS NOT NULL;

-- 소유 꾸미기 인벤토리
CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id  VARCHAR(40) NOT NULL,
  acquired_at  TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, cosmetic_id)
);
```

- **장착 상태(equipped)**는 `users.prefs` JSONB의 `equipped` 단일 키에 저장 (예 `{ paint:'gold', trail:'star', accessory:'crown', track_theme:'space', finish_fx:'firework', caster:'hot' }`). `setUserPref`의 최상위 키 1개 제약(`db/auth.js:95`)과 호환 — `equipped` 객체 통째 set. **단 신규 `shop:equip` 핸들러가 authedUserName으로 직접 jsonb_set** (기존 setUserPref 핸들러 우회).
- 신규 유저 **시드 코인 100** (`db/init.js` 유저 생성 또는 `socket:authenticate` 최초 시 user_coins 행 없으면 `INSERT ... balance=100`).

## 3. DB 모듈 (신규)

### `db/coins.js`
- `getBalance(userId)` → `SELECT balance ...`, 행 없으면 0.
- `ensureWallet(userId)` → `INSERT INTO user_coins(user_id,balance) VALUES($1,100) ON CONFLICT DO NOTHING` (시드).
- `grant(userId, delta, reason, ref)` — **트랜잭션**: `pool.connect()` → BEGIN → `INSERT coin_ledger`(ON CONFLICT DO NOTHING로 멱등) → `rowCount>0`이면 `UPDATE user_coins SET balance=balance+delta` → COMMIT. ref 중복이면 적립 스킵.
- `spend(userId, price, cosmeticId)` — **트랜잭션 + 원자 차감**:
  ```
  UPDATE user_coins SET balance = balance - $price
    WHERE user_id=$1 AND balance >= $price   -- rowCount===0 ⇒ 잔고부족
  INSERT coin_ledger(delta=-price, reason='buy:'+id)
  INSERT user_cosmetics(user_id, cosmetic_id) ON CONFLICT DO NOTHING  -- 중복구매 방지
  ```
  rowCount 0이면 ROLLBACK + `{ ok:false, reason:'insufficient' }`.
- 트랜잭션 헬퍼는 `db/coins.js` 내부에 작게 둔다 (코드베이스 첫 트랜잭션 도입 — 신중히, 이 파일에 한정).
- **silent fail 금지**: 돈 경로는 실패를 `{ok:false}`로 명시 emit (기존 `.catch(()=>{})` 관례 깨기).

### `db/cosmetics.js`
- `getOwned(userId)` → `SELECT cosmetic_id ...` 배열.
- (구매는 `db/coins.spend`가 user_cosmetics까지 한 트랜잭션에서 처리.)

## 4. 카탈로그 (서버 권위)

### `config/horse/cosmetics.json` (신규)
- `socket/shop.js`가 서버 시작 시 `fs.readFileSync`로 1회 로드 (`config/horse/race.json` 패턴, `socket/horse.js:19`).
- 형식:
```json
{
  "paint":   [{ "id":"paint_gold", "name":"황금 도색", "price":50, "rarity":"rare" }, ...],
  "trail":   [...], "accessory":[...], "skin_premium":[...], "bib":[...],
  "track_theme":[...], "finish_fx":[...], "win_sound":[...], "win_emote":[...], "caster":[...]
}
```
- **서버가 가격·존재의 권위.** `shop:buy`는 클라가 보낸 가격 무시, 카탈로그에서 조회. 위변조 차단.
- 클라이언트는 `shop:catalog` emit으로 동일 JSON을 표시용으로만 수신.
- 코인 경제 기본값(**확정 필요, config로 조정 가능**): 참여 +10, 승리 +30, 시드 100. 가격은 카탈로그 표 기준(도색 50, 트레일 80, 액세서리 120, 트랙테마 150, 결승이펙트 200, 프리미엄 350~500, 사운드 100, 이모트 250, 중계 180, 마번 40).

## 5. 소켓 핸들러 (신규 `socket/shop.js`)

`socket/index.js:186` 근처에 `registerShopHandlers(socket, io, ctx)` 1줄 추가 + 상단 require. ctx 확장 불필요.

| 이벤트 | 방향 | 동작 |
|--------|------|------|
| `socket:authenticate` | c→s (cb) | name+pin 재검증 → socket.authed* 설정 + ensureWallet + 잔고 반환 |
| `wallet:get` | c→s (cb) | authedUserId 잔고 + owned + equipped 반환. 미인증 `{ok:false}` |
| `shop:catalog` | c→s (cb) | cosmetics.json 반환 (표시용) |
| `shop:buy` | c→s (cb) | authedUserId로 `db/coins.spend(price from catalog)`. 결과 `{ok, balance, owned}` |
| `shop:equip` | c→s (cb) | authedUserId로 users.prefs.equipped 갱신 (소유 검증 후). `{ok, equipped}` |

- 모든 핸들러 첫 줄 `if (!ctx.checkRateLimit()) return;` (backend.md 규칙).
- 모든 핸들러 `if (!socket.authedUserId) return cb({ok:false, reason:'auth'})`.

### 코인 적립 훅 (`socket/horse.js` 종료 2경로 모두)
- `socket/horse.js:530-536`(메인) + `:1058`(라운드형) — 참여자 루프에서:
  - 각 참여자의 socket을 찾을 수 없으므로(서버측 userName만 보유), **적립은 `authedUserId` 매핑이 필요.** → 방 입장 시 `socket.authedUserId`를 room 참가자 레코드에 같이 보관하거나, 종료 시 방 내 각 socket의 authed* 조회.
  - **권장:** room 참가자에 `authedUserId` 필드 추가(인증된 유저만). 종료 시 그 필드 있는 참가자에게만 `grant(authedUserId, +10, 'race_join', sessionId)` / 승자 `grant(+30,'race_win',sessionId)`.
  - **serverId 가드 밖으로 적립 분리** — serverId 유무와 무관하게 authed 유저면 적립 (자유플레이 0코인 버그 방지).
  - `ref=sessionId`로 멱등 (재경기·grace 재시작 이중적립 방지). sessionId 없는 자유플레이는 `generateSessionId('horse', roomId)` 류로 생성.
- 적립 후 해당 socket에 `wallet:updated { balance }` emit.

## 6. 클라이언트 통합

### 진입점 (상점 버튼)
- **경마 전용 영역에 추가** (공유 `control-bar-shared.js` 수정 회피 → 크로스게임 0영향):
  - 탈것 선택 헤더 `horse-race-multiplayer.html:156` `autoSelectHorseToggleWrap` 옆, 또는 `#hostControls` 인근.
- 미로그인 시 버튼 클릭 → "로그인이 필요해요" 안내 (게스트 상점 제외).

### 상점 모달 (신규 — 목업 `prototype/horse-shop-mockup.html` 기반)
- `shop:catalog` + `wallet:get`으로 렌더. 구매=`shop:buy`, 장착=`shop:equip`.
- 잔고 표시 + 코인 충전 버튼(미래 결제, 지금은 "준비중" 비활성).

### 꾸미기 렌더 적용 (`js/horse-race.js`)
- **paint(도색):** `.horse` 직접 `style.filter` 금지(이벤트 연출과 충돌, `js/horse-race.js:2494` 등). → **탈것 SVG를 감싸는 wrapper div에 도색 필터, 연출 필터는 `.horse`에 유지**. 또는 CSS 변수 `--cosmetic-filter` 합성.
- **accessory:** `.horse`에 오버레이 자식 append (이름표 추가 패턴 `js/horse-race.js:1730` 참조).
- **trail / finish_fx:** 별도 canvas 레이어 (결과 계산과 무관).
- **bib:** 번호/이름표 영역 CSS.
- **다른 플레이어의 장착이 보이려면:** 서버가 race-start 페이로드(`horseRaceStarted`)에 참가자별 equipped(공개 항목: paint/accessory/trail/bib/skin)를 실어줘야 함 → `socket/horse.js` 레이스 시작부에서 방 내 authed 참가자 equipped 수집해 추가.

### 방 연출 꾸미기 (track_theme / finish_fx) — v1 스코프 한정
- **방장(host)의 equipped track_theme/finish_fx만 적용, 방 전체 broadcast.** `startHorseRace` 처리 시 호스트 authedUserId의 equipped를 읽어 `horseRaceStarted` 페이로드에 `roomCosmetics:{track_theme, finish_fx}` 추가 (transient — gameState/leaveRoom cleanup 안 건드림, Codex 경고 회피).
- 비호스트는 자기 개인 꾸미기(paint/trail/accessory)만 적용 + 방장 테마 수신.

## 7. 공정성 불변조건 (must-preserve)

- **cosmetic id는 `calculateHorseRaceResult`(`socket/horse.js:1587`)·`getWinnersByRule`(`:348`) 경로에 진입 0.** 장착 정보를 `gameState.users[]`·`userHorseBets`에 병합 금지.
- 정적 가드(QA 검증): `grep -nE "cosmetic|equipped|paint|trail" socket/horse.js` 결과가 적립/emit 경로에만, 결과 계산 함수 본문엔 0.
- **인지적 pay-to-win 방지:** trail/finish_fx가 타 탈것을 가리거나 결승 타이밍 착시 유발 금지 (QA 체크). 꾸미기는 z-index/투명도로 레이스 가독성 침해 안 함.
- 클라이언트 `Math.random()` 0회 (꾸미기는 외관만, deviceId 외).

## 8. 구현 순서 (한 작업이되 안전 검증 단위로 분할)

| 모듈 | 내용 | 검증 |
|------|------|------|
| **M1 인증** | `socket:authenticate` + socket.authed* + 클라 connect 핸드셰이크 | 인증 성공/실패, 미인증 shop 거부 |
| **M2 지갑 DB** | `db/init.js` 3테이블 + `db/coins.js`(트랜잭션) + `db/cosmetics.js` | `node -c`, 동시 구매 race 테스트, 잔고 음수 불가 |
| **M3 적립** | `socket/horse.js` 종료 2경로 적립(멱등) + serverId 가드 밖 | 참여/승리 적립, 자유플레이 적립, 이중적립 없음 |
| **M4 상점 핸들러** | `socket/shop.js` + `config/horse/cosmetics.json` + index 등록 | buy/equip/catalog/wallet 동작, 가격 위변조 차단 |
| **M5 상점 UI** | 경마 상점 버튼 + 모달 (목업 기반) | 모바일/PC, 구매→장착 흐름 |
| **M6 꾸미기 렌더** | paint(wrapper)/trail/accessory/bib + 방 연출 broadcast | 연출 충돌 없음, 타 플레이어 꾸미기 표시, 공정성 grep 가드 |

각 모듈 후 `node -c` + 소켓 변경 시 dev 서버 재시작(MEMORY: `project_dev_server_restart_for_socket`).

## 9. 미결 사항 (구현 전 확인 권장)

1. **코인 경제 숫자 최종 확정** — 참여 +10 / 승리 +30 / 시드 100 / 가격표 (현재 기본값, config 조정 가능).
2. **pin 재검증 방식** — `socket:authenticate`가 매 연결마다 pin 받는 게 맞는지, 아니면 HTTP 로그인에 토큰 발급을 추가할지 (현재: 매 연결 pin 재검증 = 최소 변경).
3. **방 연출 적용 정책** — v1 "방장 테마만 broadcast" 채택 (스코프 억제). 동의 여부.

## 10. 깨면 안 되는 계약

- 기존 `getUserPrefs/setUserPref/getUserFlags/setGuideComplete` 핸들러 무수정.
- `ctx` 객체 형태 무변경 (전 게임 공유).
- AdSense 블록(`horse-race-multiplayer.html:130-140`) 침범 금지.
- `js/shared/control-bar-shared.js`·`utils/room-helpers.js` 무수정 (크로스게임).
- `users.prefs` 기존 키(`horseAutoSelect`) 보존 — `equipped` 별도 키.
- main=실서버. `db/init.js`는 부팅 시 자동 실행 → 신규 테이블 멱등 안전, 단 롤백은 수동 DROP뿐이므로 스키마 보수적.

## 11. lesson 후보 (작업 종료 시 등록 검토)

- `.horse style.filter` 연출 점유 → 꾸미기 도색 wrapper 분리 (horse-race.md)
- 코인 적립이 serverId 가드 안이라 자유플레이 누락 (security.md / horse-race.md)
- security.md S-1: 돈 도입으로 socket 인증이 임계점 → authedUserId 패턴 확립 (security.md)
- DB 첫 트랜잭션 도입 패턴 (`db/coins.js`) (_common 또는 backend)
