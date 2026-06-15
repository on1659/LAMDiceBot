# 인증 토큰 — 서명 방식 전환 (재시작에도 로그인 유지) — Goal

상점/지갑 인증 토큰이 **서버 재시작·배포 때마다 전부 무효화**되어 "로그인했는데 상점에서 자꾸 인증 실패"가 나는 문제를 고친다. 원인은 토큰을 **인메모리 `Map`**([db/auth-tokens.js](../../db/auth-tokens.js))에 보관하기 때문. 이를 **HMAC 서명 토큰(무저장, stateless)** 으로 바꿔, 비밀키만 안정적이면 재시작·배포에도 토큰이 유지되게 한다. 브랜치 `feature/goal-game-mode`. **DB 스키마 변경 없음.**

> 전제/baseline: 코인 지갑/상점은 직전 세션에서 구현·배포 완료. 토큰 발급은 login·register 양쪽([routes/server.js](../../routes/server.js) `:71`/`:91`)에서, 재검증은 `socket:authenticate`([socket/shop.js](../../socket/shop.js) `:33`)에서 일어난다. 보안 배경은 [docs/GameGuide/lessons/security.md](../../docs/GameGuide/lessons/security.md) S-2 참조. **현금화(실제 화폐)는 "언젠가"이고 지금 단계가 아님** — 그래서 revocable DB 세션(2번)이 아니라 단순한 서명 토큰(1번)을 채택하되, **나중에 세션 스토어로 승격할 수 있도록 인터페이스를 보존**한다.

## 한 줄 요약

① `db/auth-tokens.js` 내부를 인메모리 Map → **HMAC-SHA256 서명 토큰**으로 교체(인터페이스 동일) → ② `.env`에 안정적 `AUTH_TOKEN_SECRET` 추가 → ③ **현금화 전 보안 체크리스트** 문서 신설.

## 핵심 규칙 (번호 절)

### 1. db/auth-tokens.js — 서명 토큰으로 내부 교체 (인터페이스 보존)

- **공개 시그니처 `issueToken(userId, name)` / `verifyToken(token)` / `revokeToken(token)` 를 그대로 유지** → 호출부([routes/server.js](../../routes/server.js), [socket/shop.js](../../socket/shop.js))는 **무수정**이어야 한다. (구현자 검증: Grep으로 세 함수 호출부 전부 확인 후 시그니처 일치)
- 토큰 형식: `base64url(payload) + "." + signature`, `payload = {u: userId, n: name, e: 만료ms}`(JSON), `signature = HMAC-SHA256(payload문자열, SECRET)`.
- `verifyToken`:
  - **서명 비교는 반드시 `crypto.timingSafeEqual`** (`===`/`!=` 금지 — 타이밍 공격).
  - 서명 검증 **통과 후에만** payload(userId/name/exp)를 신뢰·파싱. 형식 깨짐/서명 불일치/만료는 `null` 반환.
  - 기존과 동일하게, 검증 실패 시 `socket:authenticate`가 **기존 유효 `authedUserId`를 침묵 초기화하지 않도록** 한다(security.md S-2 함정: 만료 토큰 재전송이 진행 중 적립 매핑을 끊으면 안 됨).
- **알고리즘 고정**: HMAC-SHA256 하드코딩. **토큰에 `alg` 필드를 두지 않는다**(클라가 알고리즘을 고르게 하는 `alg:none` 류 취약점 원천 차단).
- `revokeToken`: 무저장이라 실효적 동작이 없다. **인터페이스는 유지**하고, "현금화 도입 시 DB/Redis 세션 스토어로 승격하면 여기서 실제 무효화" 주석을 남긴다. 기존 호출부가 있으면(로그아웃 등) 깨지지 않게만 유지.
- TTL: 현재 7일 유지(현금화 전이라 충분). 단, 만료는 서버에서 검증.

### 2. 비밀키 (.env)

- `SECRET = process.env.AUTH_TOKEN_SECRET`.
- `.env`에 `crypto.randomBytes(32).toString('hex')` 수준의 **강한 랜덤 키**를 추가한다(`.env`는 `.gitignore`에 있고 git 미추적 — 검증됨).
- **미설정 시 동작 결정(막힘 기준 위임):** 임의 키를 매번 생성하면 재시작마다 무효 = 원점이므로, 미설정이면 **명확한 경고 로그**를 남긴다(기동 거부 vs 경고 후 임시키 중 택1, 근거와 함께 보고). 비밀키는 **절대 로그·HTTP 응답에 출력 금지.**

### 3. 현금화 전 보안 체크리스트 문서 신설

- 위치: `docs/GameGuide/` 하위 적절한 곳(예: `lessons/security.md`에 S-3로 추가 또는 `docs/security/cashout-readiness.md` 신설 — 구현자 판단).
- 담을 항목(현금화가 실제로 올 때 필수): **세션 revocation(서명→DB 세션 승격)**, PIN(4~6자리)→실제 비밀번호+**2FA**, **bcrypt 강제**(현재 [db/auth.js](../../db/auth.js) 미설치 시 평문 저장 — 이것도 명시), 계정 복구/KYC, 어뷰징·**승부조작(win-trading)**·멀티계정 방지, 출금 멱등+락, XSS→실금전 피해 격상에 따른 CSP, 도박/전자화폐 규제·AML.

## 보안/신뢰경계 (코드 변경이 돈 경계에 닿음 — 명시)

- 이 변경은 **토큰→userId 확인 방식만** 바꾼다. 지갑/구매/장착은 여전히 **`socket.authedUserId`만 신뢰**하고 `data.name`을 믿지 않는다(S-1/S-2 유지). 가격은 서버 카탈로그 권위(위변조 차단) 그대로.
- 비밀키가 새면 임의 userId 토큰 위조 → 전면 사칭이 가능하다. 비밀키 보호(미추적·무로깅·강한 랜덤)와 §1의 구현 정확성(timingSafeEqual·alg 고정)이 보안의 핵심.

## 기존 통합 유지 (스킵 금지)

- 로그인/회원가입 양쪽 토큰 발급, 로그인 직후 `socket:authenticate` 트리거([js/shared/server-select-shared.js](../../js/shared/server-select-shared.js) `doApiCall` ~`:962`/`:969`), 경마 페이지의 `HorseShop.connect`/`authenticate`([js/horse-race.js](../../js/horse-race.js) ~`:4926`) 모두 그대로 동작.
- **기존 토큰 1회 무효 처리**: 형식이 바뀌므로 현재 로그인된 사용자는 **마지막으로 한 번 재로그인**하면 이후로는 재시작에도 유지된다. 이 점을 보고/안내에 명시.
- 게스트(비로그인) 상점 차단, `wallet:updated` 잔고 갱신 등 기존 흐름 유지.

## 작업 방식

- 먼저 읽기: [db/auth-tokens.js](../../db/auth-tokens.js)(전체), [routes/server.js](../../routes/server.js) `:60~95`(register/login 토큰 발급), [socket/shop.js](../../socket/shop.js) `:33~62`(socket:authenticate), `revokeToken` 호출부 Grep, [docs/GameGuide/lessons/security.md](../../docs/GameGuide/lessons/security.md) S-2.
- 소켓/인증 변경이므로 **로컬 서버 재기동 후** 테스트(인메모리가 아니어도 핸들러 코드 갱신 반영 위해).

## 테스트

- `node -c db/auth-tokens.js routes/server.js socket/shop.js server.js` 문법 검증.
- 단위: 발급한 토큰이 `verifyToken`으로 `{userId,name}` 복원되는지 / 변조(payload 1글자 변경)·만료·형식깨짐 토큰이 `null`인지 / 잘못된 비밀키로 서명된 토큰 거부.
- 수동(2탭/재기동): 로그인 → 상점 인증·`wallet:get` 정상 → **서버 재시작** → 새로고침 → **재로그인 없이 상점 인증 유지** 확인. 비밀키 미설정 시 경고 동작 확인.
- 회귀: 회원가입 직후 상점 이용 가능(양쪽 발급), 게스트 차단, 경마 본 게임/적립 미파손.

## 완료 기준 (하나라도 미완이면 완료 아님)

- `db/auth-tokens.js`가 HMAC 서명 방식으로 동작하고 `issueToken`/`verifyToken`/`revokeToken` 시그니처·호출부 무수정.
- 서명 비교 `timingSafeEqual` 사용, 알고리즘 고정(alg 필드 없음), 비밀키 무로깅.
- `.env`에 강한 `AUTH_TOKEN_SECRET` 추가(미추적 확인), 미설정 시 경고 동작.
- **서버 재시작 후에도 기존 로그인 세션 유지**(최초 1회 재로그인 제외) 수동 검증 통과.
- 현금화 전 보안 체크리스트 문서 신설.
- update-log.md 기록(유저용 평이한 한국어). 새 리소스(이미지/사운드) 없음 명시.
- 마지막 보고에 변경 요약·파일·테스트 명령/결과·자체 평가·남은 이슈 포함.

## 막힘 기준

- `AUTH_TOKEN_SECRET` 미설정 시 정책(기동 거부 vs 경고+임시키)이 애매하면 **운영 안전 쪽(경고를 크게 + 임시키는 명확히 비영속임을 로그)**으로 정하고 근거와 함께 보고.
- `revokeToken` 기존 호출부가 실제 무효화를 기대하는 곳이 있으면(예: 로그아웃이 서버 무효화에 의존) 멈추고 보고 — 무저장 토큰의 한계를 명확히.
- 토큰 포맷 세부(base64url 패딩 처리 등)는 Node `crypto`/`Buffer` 표준에 맞춰 합리적으로.

## 참고

- 원인 파일: [db/auth-tokens.js](../../db/auth-tokens.js) (인메모리 Map)
- 발급/검증 호출부: [routes/server.js](../../routes/server.js) `:71`/`:91`, [socket/shop.js](../../socket/shop.js) `:33`
- 클라 흐름: [js/shared/server-select-shared.js](../../js/shared/server-select-shared.js), [js/horse-race.js](../../js/horse-race.js) `~:4926`
- 보안 배경: [docs/GameGuide/lessons/security.md](../../docs/GameGuide/lessons/security.md) S-1/S-2
- PIN 저장(현금화 체크리스트 근거): [db/auth.js](../../db/auth.js) `:4~28` (bcrypt 선택적, 미설치 시 평문)
