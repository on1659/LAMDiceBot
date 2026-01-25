# LAMDiceBot 빠른 시작 가이드

신규 개발자를 위한 핵심 요약본입니다.

## 5분 안에 시작하기

### 1. 설치 & 실행
```bash
git clone https://github.com/on1659/LAMDiceBot.git
cd LAMDiceBot
npm install
npm start
```

### 2. 브라우저에서 확인
```
http://localhost:3000
```

---

## 핵심 규칙 3가지

### 1️⃣ 공통 컴포넌트 재사용
```jsx
// ✅ 이렇게
import Chat from '../../common/Chat';
<Chat socket={socket} roomId="my-room" />

// ❌ 이러면 안 됨
function MyGameChat() { ... } // 중복 작성 금지!
```

### 2️⃣ 설정은 JSON 파일로
```javascript
// ✅ 이렇게
const config = await loadGameConfig('dice');
const maxValue = config.rules.maxValue;

// ❌ 이러면 안 됨
const maxValue = 6; // 하드코딩 금지!
```

### 3️⃣ 난수는 서버에서만
```javascript
// ✅ 서버 (server.js)
const result = crypto.randomInt(1, 7);

// ❌ 클라이언트 (절대 금지!)
const result = Math.random(); // 조작 가능!
```

---

## 자주 쓰는 Commands

Cursor 채팅창에서 `/` 입력:

```
/add-new-game          # 새 게임 추가
/add-socket-event      # Socket 이벤트 추가
/commit-with-log       # 커밋 + update-log
/validate-config       # Config 검증
```

---

## 새 게임 추가 (5단계)

### 1단계: 컴포넌트 생성
```
/add-new-game
→ "빙고 게임 추가해줘"
```

### 2단계: Config 작성
```json
// config/bingo-config.json
{
  "gameName": "빙고",
  "rules": { "gridSize": 5 },
  "probabilities": { "bonus": 0.1 }
}
```

### 3단계: Config 검증
```
/validate-config
→ "bingo-config.json 검증해줘"
```

### 4단계: Socket 이벤트
```
/add-socket-event
→ "startBingo 이벤트 추가해줘"
```

### 5단계: 커밋
```
/commit-with-log
→ "feat: 빙고 게임 추가"
```

---

## 필수 체크리스트

코드 작성 전:
- [ ] 공통 컴포넌트 재사용하는가?
- [ ] Config는 JSON으로 분리했는가?
- [ ] 입력값 검증을 추가했는가?
- [ ] try-catch 에러 처리를 했는가?
- [ ] 콘솔 로그를 추가했는가?

---

## 금지 사항

❌ **절대 하지 말 것:**
1. 클라이언트에서 난수 생성
2. Config 값 하드코딩
3. 입력값 검증 생략
4. 에러 처리 생략
5. 채팅/사용자목록 컴포넌트 중복 작성

---

## 트러블슈팅 1분 해결

### Socket 연결 안 됨
```javascript
console.log('연결 상태:', socket.connected);
console.log('서버 URL:', process.env.REACT_APP_SERVER_URL);
```

### 이벤트 동작 안 함
```javascript
// 양쪽 모두 로그 확인
console.log('[클라이언트] 전송:', data);
console.log('[서버] 수신:', data);
```

### Config 로드 실패
```bash
# 파일 존재 확인
ls config/my-config.json

# JSON 문법 검증
/validate-config
```

---

## 더 자세한 내용

- 전체 가이드: `docs/DEVELOPMENT_GUIDE.md`
- 배포 가이드: `Railway배포완벽가이드.md`
- 보안 가이드: `보안가이드.md`
- AI 개발 규칙: `.cursorrules`

---

**팁**: Cursor Commands (`/`)를 적극 활용하면 개발 속도 3배 빨라집니다! 🚀
