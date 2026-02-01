# QA 지침서

> 코드 변경 후 필수 QA 절차. 실패 사례 기반으로 작성됨.

---

## QA 실패 사례 (교훈)

| # | 실패 | 원인 | 교훈 |
|---|------|------|------|
| 1 | `document.hasAttribute` 런타임 에러 | `document`에는 `hasAttribute` 없음 (`documentElement`에 있음) | Node.js 문법 체크는 브라우저 API 오용을 못 잡음 |
| 2 | 왕관 안 보임 | 위 에러로 `initializeGameScreen` 크래시 → 이후 코드 미실행 | 한 곳의 에러가 연쇄 실패 유발 |
| 3 | 경마 드래그앤드롭 누락 | 기능 자체가 없었음 (pre-existing) | 크로스게임 기능 비교 필수 |

---

## QA 레벨별 체크리스트

### Level 1: 정적 검증 (모든 변경)

- [ ] `node -c server.js` 문법 체크
- [ ] 위험 패턴 검사 (아래 목록)
- [ ] 변경 파일의 함수 호출 체인 추적 (에러 시 영향 범위 파악)

### Level 2: 서버 검증 (server.js 변경 시)

- [ ] `node server.js` → 3초 내 에러 없이 부팅
- [ ] 변경된 HTML 파일 정적 서빙 200 응답 확인

### Level 3: 브라우저 런타임 검증 (HTML/JS 변경 시) ⭐핵심

- [ ] 게임 페이지 로드 → **콘솔 에러 없음**
- [ ] 방 생성 → **콘솔 에러 없음**
- [ ] 방 입장 → **콘솔 에러 없음**
- [ ] 변경 기능 직접 동작 확인

### Level 4: 크로스게임 검증 (공통 모듈 변경 시)

- [ ] 3개 게임(주사위/룰렛/경마) 모두에서 Level 3 수행
- [ ] 기능 비교표 대비 누락 없는지 확인

---

## 위험 패턴 목록 (브라우저 API 오용)

이 패턴들은 Node.js 문법 체크로 검출 불가. grep으로 수동 검사 필요.

| 위험 패턴 | 문제 | 올바른 코드 |
|-----------|------|-------------|
| `document.hasAttribute()` | document에 없는 메서드 | `document.documentElement.hasAttribute()` |
| `document.setAttribute()` | document에 없는 메서드 | `document.documentElement.setAttribute()` |
| `document.style` | document에 없는 속성 | `document.body.style` |
| `document.classList` | document에 없는 속성 | `document.documentElement.classList` |
| `document.className` | document에 없는 속성 | `document.documentElement.className` |

**검사 명령어:**
```bash
grep -n "document\.hasAttribute\|document\.setAttribute\|document\.style[^.]" *.js *.html
```

---

## 자동화 테스트

### 기존 테스트 봇
- Dice: `node AutoTest/dice/dice-test-bot.js`
- Roulette: `node AutoTest/roulette/test-bot.js`
- Horse: `AutoTest/horse.bat`

### 브라우저 콘솔 에러 체크 (신규)
```bash
node AutoTest/console-error-check.js
node AutoTest/console-error-check.js --game horse-race
node AutoTest/console-error-check.js --game all
```

---

## 공통 모듈 목록

변경 시 Level 4 (크로스게임 검증) 필수:

| 모듈 | 사용처 |
|------|--------|
| `ready-shared.js` | 주사위, 룰렛, 경마 |
| `chat-shared.js` | 주사위, 룰렛, 경마 |
| `server.js` | 전체 |
