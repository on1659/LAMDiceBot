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

## 누적 규칙

새로운 보안 함정 발견 시 다음 번호(S-2, S-3…)로 추가.
