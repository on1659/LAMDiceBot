# 보안 함정 (Socket / Auth)

소켓 핸들러와 인증 흐름에서 반복되는 보안 결함. 새 핸들러 추가 시 **반드시** 검토.

---

## S-1. Socket 핸들러가 `data.name`을 신뢰하면 안 된다

### 문제

`socket.on('이벤트', (data) => { db.update(data.name, ...) })` 패턴은 **클라이언트가 보낸 닉네임을 그대로 권위 식별자로 사용**한다.
악의적 클라이언트가 임의의 다른 유저 이름을 `data.name`에 넣어 emit하면 타인의 상태를 변경 가능.

### 현재 영향받는 핸들러 (2026-05-28 기준)

- `socket/index.js` `getUserFlags` / `setGuideComplete` — 튜토리얼 비트필드
- `socket/index.js` `getUserPrefs` / `setUserPref` — 유저 prefs (자동선택 토글 등)

### 현재 영향 수준

- 게임 결과·서버 가입·인증 토큰과는 무관 (게임 공정성 침해 없음)
- "남의 튜토리얼 완료 비트가 켜졌다 / 자동선택 토글이 켜졌다 꺼졌다" 수준
- 단 **prefs 키가 늘어날수록 공격 표면 확대**. 알림 차단, 자동 시작, 통계 공개 토글 등이 추가되면 결함이 누적된다.

### 올바른 패턴

```javascript
// ❌ 나쁨 — 클라이언트 신뢰
socket.on('setUserPref', async (data) => {
    await setUserPref(data.name, data.key, data.value);
});

// ✅ 좋음 — 서버 권위 식별자 사용
socket.on('setUserPref', async (data) => {
    const name = socket.authenticatedUserName; // 로그인 시 서버가 저장
    if (!name) return; // 비로그인 차단
    await setUserPref(name, data.key, data.value);
});
```

### 도입 전제

- 로그인 성공 핸들러(`routes/server.js` `/api/auth/login`)에서 PIN 검증 후 socket으로 `setAuth({name, token})` 같은 이벤트를 보내고, 서버가 검증한 뒤 `socket.authenticatedUserName`을 set.
- 또는 socket connection 시 cookie / Bearer 토큰 검증 미들웨어.
- 단, 현재 코드베이스는 socket 인증 미들웨어가 없으므로 별도 보안 PR로 일괄 도입 필요.

### 일괄 교정 PR 항목

1. socket auth 미들웨어 추가 (PIN 로그인 시 서버 측 socket 식별자 저장)
2. 영향 핸들러 모두 `data.name` → `socket.authenticatedUserName`으로 교체
3. 비로그인 게스트 자동 차단
4. 기존 테스트에서 회귀 검증

### 출처

- 2026-05-28 경마 자동선택 토글 작업 (ReviewerCodex 지적)
- 추가 PR 시점: 미정 (prefs 키 3개 이상 누적되면 우선순위 상승)

---

## S-2. 돈(코인)을 도입하면 socket이 HTTP 로그인 신원을 알아야 한다 — 토큰은 login·register 양쪽에서 발급

### 문제

이 코드베이스의 HTTP 로그인은 stateless다. socket은 "이 연결이 누구인지" 모른 채 `data.name`(자유 닉네임)만 받는다(S-1). 여기에 코인 지갑/상점을 얹으면 **무한코인·타인지갑 조작**이 가능해진다 — 돈은 자유 닉네임이 아니라 **인증 계정(`users.id`)**에 매달아야 한다.

### 해결 패턴 (2026-06-07 경마 상점에서 확립)

- 로그인 성공 시 서버가 랜덤 토큰 발급(`db/auth-tokens.js`, 인메모리 Map) → 클라 `localStorage.userAuth.token` 저장 → socket 연결 후 `socket:authenticate { token }` → 서버가 `socket.authedUserId` 세팅.
- **모든 지갑/상점 핸들러는 `socket.authedUserId`만 사용. `data.name` 신뢰 금지.** 미인증 시 `{ ok:false, reason:'auth' }`.
- 가격은 **서버 카탈로그가 권위** — 클라가 보낸 가격 무시(위변조 차단).

### 함정

- **토큰 발급을 `login`에만 넣고 `register`에 빠뜨리면** 신규 가입자는 재로그인 전까지 지갑/상점이 막힌다. 클라가 login/register를 같은 핸들러로 처리하므로 **양쪽 경로 모두** 토큰을 내려줘야 한다. (ReviewerCodex가 잡은 major)
- 잘못된/만료 토큰으로 재인증할 때 **기존 유효 `authedUserId`를 침묵 초기화하지 말 것** — 진행 중 레이스의 적립 매핑이 끊긴다. 성공 시에만 세팅.
- 토큰 인메모리 보관은 서버 재시작 시 전원 재로그인 필요(게임 플레이엔 무영향). 재배포 잦으면 DB/Redis 백업 검토.

### 출처

- 2026-06-07 경마 꾸미기 상점 + 코인 지갑 (Reviewer/ReviewerCodex)

---

## S-3. 토큰은 서명(stateless) 방식 — 현금화(실제 화폐) 도입 전 체크리스트

### 배경

`db/auth-tokens.js`는 인메모리 Map → **HMAC-SHA256 서명 토큰**으로 전환됐다(2026-06-09). 서버가 토큰을 저장하지 않고 `AUTH_TOKEN_SECRET`으로 서명/검증만 하므로, 비밀키만 안정적이면 **재시작·배포에도 로그인이 유지**된다. 형식: `base64url(payload).base64url(sig)`, `payload={u,n,e}`. 검증은 `timingSafeEqual`, 알고리즘 HMAC-SHA256 고정(alg 필드 없음).

- **비밀키가 새면 임의 userId 토큰 위조 = 전면 사칭.** 비밀키는 `.env`(git 미추적)에 두고 **로그·HTTP 응답에 절대 출력 금지**.
- `AUTH_TOKEN_SECRET` 미설정 시 임시 키를 생성하되 "비영속(재시작 시 전원 재로그인)" 경고를 크게 남긴다 — 운영에서는 반드시 `.env`에 강한 랜덤 키를 설정한다.
- **무저장의 한계**: `revokeToken`은 no-op이다(서버 측 즉시 무효화 불가). 만료(7일) 전까지는 탈취 토큰을 막을 수 없다.

### 현금화(실제 돈)가 실제로 올 때 — 필수 선결 항목

지금은 의도적으로 단순 서명 토큰을 쓴다(현금화는 "언젠가"). 실제 화폐가 닿는 순간 아래는 **선택이 아니라 필수**다:

- **세션 revocation**: 서명 토큰 → DB/Redis 세션 스토어로 승격. `revokeToken`에서 실제 세션 레코드 삭제(로그아웃·탈취 대응·강제 만료).
- **인증 강화**: PIN(4~6자리) → 실제 비밀번호 + **2FA**. 계정 복구/**KYC**.
- **비밀번호 저장**: 현재 `db/auth.js`는 bcrypt **미설치 시 평문 저장**(`:4~28`). 돈 닿기 전 **bcrypt 강제**(평문 경로 제거).
- **어뷰징 방지**: 멀티계정, **승부조작(win-trading)**, 봇 적립 탐지.
- **출금 안전**: 멱등(idempotency) 키 + 동시성 락(이중 출금 차단).
- **느슨한 토큰 부트스트랩 폐기/격상**: `POST /api/auth/token`(2026-06-17 추가)은 PIN 없이 **이름만으로** 토큰을 발급한다 — 상점 도입 전 로그인 사용자의 재로그인 방지용. 이름은 공개라 **사칭 가능**(현재는 플레이머니라 그리핑 한정). 현금화 시 이 엔드포인트를 **폐기하거나 구글 OAuth 검증 뒤로 격상**하고, **느슨한 토큰으로는 절대 출금/실거래를 인가하지 말 것** — 돈 경로는 구글 검증 세션 전용으로 분리한다.
- **클라이언트 보안**: XSS → 실금전 피해로 격상되므로 **CSP** 적용.
- **규제**: 도박/전자화폐 관련 법규·**AML**(자금세탁방지) 검토.

### 출처

- 2026-06-09 인증 토큰 서명 방식 전환 (`docs/goal/auth-signed-token-persistence.md`)
- 2026-06-17 토큰 부트스트랩 추가 — `/api/auth/token`(PIN 없이 이름으로 발급, 재로그인 방지, 플레이머니 한정)

---

## 누적 규칙

새로운 보안 함정 발견 시 다음 번호(S-2, S-3…)로 추가.
