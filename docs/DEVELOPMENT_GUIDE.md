# LAMDiceBot 개발 가이드

LAMDiceBot 프로젝트의 종합 개발 지침서입니다.

## 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [기술 스택](#기술-스택)
3. [개발 환경 설정](#개발-환경-설정)
4. [프로젝트 구조](#프로젝트-구조)
5. [코딩 컨벤션](#코딩-컨벤션)
6. [개발 워크플로우](#개발-워크플로우)
7. [테스트 가이드](#테스트-가이드)
8. [배포 가이드](#배포-가이드)
9. [트러블슈팅](#트러블슈팅)

---

## 프로젝트 개요

### 목적
실시간 멀티플레이어 게임 플랫폼 (주사위, 룰렛 등)

### 핵심 가치
- **100% 공정성**: 서버 사이드 난수 생성으로 조작 불가능
- **컴포넌트 재사용**: React 기반 공통 컴포넌트 최대 활용
- **설정 외부화**: JSON 파일로 게임 규칙/확률 관리

---

## 기술 스택

### Backend
- **Node.js** 14+
- **Express.js** - HTTP 서버
- **Socket.IO** - 실시간 WebSocket 통신
- **PostgreSQL** - 데이터베이스

### Frontend
- **React** - UI 프레임워크
- **Socket.IO Client** - 실시간 통신

### 배포
- **Railway** - 클라우드 플랫폼

---

## 개발 환경 설정

### 1. 필수 프로그램 설치
```bash
# Node.js 14+ 설치 확인
node --version

# npm 확인
npm --version
```

### 2. 프로젝트 클론
```bash
git clone https://github.com/on1659/LAMDiceBot.git
cd LAMDiceBot
```

### 3. 의존성 설치
```bash
npm install
```

### 4. 환경 변수 설정
`.env` 파일 생성:
```
PORT=3000
DATABASE_URL=postgresql://...
NODE_ENV=development
```

### 5. 서버 실행
```bash
# 개발 모드
npm run dev

# 프로덕션 모드
npm start
```

---

## 프로젝트 구조

```
LAMDiceBot/
├── server/
│   ├── server.js              # Express + Socket.IO 서버
│   ├── config/                # 서버 설정
│   └── utils/                 # 서버 유틸리티
│
├── client/
│   └── src/
│       ├── components/
│       │   ├── common/        # 공통 컴포넌트 (재사용)
│       │   │   ├── Chat.jsx
│       │   │   ├── UserList.jsx
│       │   │   └── GameStatus.jsx
│       │   ├── games/         # 게임별 컴포넌트
│       │   │   ├── Dice/
│       │   │   └── Roulette/
│       │   └── layout/
│       ├── hooks/             # 커스텀 훅
│       │   ├── useSocket.js
│       │   └── useGameState.js
│       ├── config/            # 클라이언트 설정
│       └── utils/
│
├── config/                    # 게임 설정 JSON
│   ├── dice-config.json
│   └── roulette-config.json
│
├── docs/                      # 문서
├── .cursor/                   # Cursor IDE 설정
│   └── commands/              # 자주 쓰는 명령어
└── .cursorrules               # AI 개발 규칙
```

---

## 코딩 컨벤션

### JavaScript/React 네이밍

```javascript
// 변수: camelCase
const userName = 'Alice';
const gameState = { isStarted: false };

// 상수: UPPER_SNAKE_CASE
const MAX_CONNECTIONS = 50;
const PORT = 3000;

// 함수: 동사로 시작
function handleRollDice() { ... }
function validateInput() { ... }

// 컴포넌트: PascalCase
function DiceGame() { ... }
function UserList() { ... }

// 훅: use로 시작
function useSocket() { ... }
function useGameState() { ... }

// Socket 이벤트: camelCase
socket.on('rollDice', ...)
socket.emit('diceResult', ...)
```

### 파일 네이밍

```
컴포넌트:  Chat.jsx, UserList.jsx
훅:        useSocket.js, useGameState.js
유틸:      configLoader.js, timeUtils.js
설정:      dice-config.json, roulette-config.json
```

### 주석 규칙

```javascript
// 모든 주석은 한글로 작성

// 나쁜 예 ❌
// Process user input
function processInput(data) { ... }

// 좋은 예 ✅
// 사용자 입력 처리
function processInput(data) { ... }
```

---

## 개발 워크플로우

### 1. 새 기능 추가

#### Step 1: Branch 생성
```bash
git checkout -b feat/new-game-bingo
```

#### Step 2: 개발
Cursor Commands 활용:
```
/add-new-game
→ 빙고 게임 추가
```

#### Step 3: 테스트
- 로컬에서 테스트
- 여러 브라우저 탭으로 멀티플레이 테스트

#### Step 4: 커밋
```
/commit-with-log
→ feat: 빙고 게임 추가
```

#### Step 5: Push & PR
```bash
git push origin feat/new-game-bingo
# GitHub에서 Pull Request 생성
```

### 2. Socket 이벤트 추가

```
/add-socket-event

이벤트명: placeBingoMark
파라미터: userId, position
```

자동으로 다음 생성:
- ✅ 서버 핸들러 (검증 포함)
- ✅ 클라이언트 emit/on
- ✅ 에러 처리
- ✅ 콘솔 로그

### 3. Config 파일 작성

```json
{
  "gameName": "빙고",
  "rules": {
    "gridSize": 5,
    "maxPlayers": 50
  },
  "probabilities": {
    "bonusNumber": 0.1
  }
}
```

검증:
```
/validate-config
→ bingo-config.json 검증
```

---

## 필수 개발 원칙

### 1. 컴포넌트 재사용 극대화

```jsx
// ❌ 나쁜 예: 게임별로 채팅 새로 만들기
function DiceChat() { ... }
function RouletteChat() { ... }

// ✅ 좋은 예: 공통 컴포넌트 재사용
import Chat from '../../common/Chat';

<Chat socket={socket} roomId="dice-room" />
<Chat socket={socket} roomId="roulette-room" />
```

### 2. 설정 외부화 (JSON)

```javascript
// ❌ 나쁜 예: 하드코딩
const MAX_DICE_VALUE = 6;
const WIN_PROBABILITY = 0.05;

// ✅ 좋은 예: JSON에서 로드
const config = loadGameConfig('dice');
const maxValue = config.rules.maxValue;
const winProb = config.probabilities.win;
```

### 3. 서버 사이드 난수 생성 (필수!)

```javascript
// ❌ 절대 금지: 클라이언트 난수 생성
const result = Math.floor(Math.random() * 6) + 1; // 조작 가능!

// ✅ 필수: 서버에서만 생성
const crypto = require('crypto');
const result = crypto.randomInt(1, 7); // 조작 불가능
```

### 4. 입력값 검증 (항상!)

```javascript
socket.on('rollDice', (data) => {
    // ✅ 필수: 입력값 검증
    if (!data || !data.userId) {
        return socket.emit('error', { message: '필수 데이터 누락' });
    }
    
    if (data.maxValue < 1 || data.maxValue > 10000) {
        return socket.emit('error', { message: '범위 오류' });
    }
    
    // ... 로직 처리
});
```

### 5. 에러 처리 (try-catch)

```javascript
socket.on('someEvent', async (data) => {
    try {
        // 로직 처리
        const result = await processData(data);
        socket.emit('success', result);
        
    } catch (error) {
        console.error('[someEvent] 오류:', error);
        socket.emit('error', { 
            message: '서버 오류',
            details: error.message 
        });
    }
});
```

### 6. 한국 시간 (UTC+9) 사용

```javascript
const moment = require('moment-timezone');

// ✅ 항상 한국 시간
const koreanTime = moment().tz('Asia/Seoul');
const timestamp = koreanTime.format('YYYY-MM-DD HH:mm:ss') + ' KST';

console.log(`[${timestamp}] 이벤트 발생`);
```

---

## Git 워크플로우

### 커밋 메시지 형식

```
[타입] 간단한 설명 (한글)

상세 설명 (선택)

타입:
- feat: 새 기능
- fix: 버그 수정
- docs: 문서 변경
- style: 코드 포맷팅
- refactor: 리팩토링
- perf: 성능 개선
- security: 보안 강화
```

### update-log.txt 규칙

**플레이어가 알아야 할 것만 기록**

✅ 포함:
- 새 기능 추가
- 버그 수정
- UI/UX 개선
- 체감 가능한 성능 개선

❌ 제외:
- 코드 리팩토링
- 내부 로직 변경
- 애니메이션 세부 수치
- 테스트 코드
- 개발 환경 설정

### 예시

**커밋 메시지:**
```
feat: 주사위 굴림 애니메이션 추가

- A 애니메이션 10% 확률
- B 애니메이션 50% 확률
- 애니메이션 duration 1000ms
- 테스트 자동화 개선
```

**update-log.txt:**
```
## [2025-01-25] (UTC+9)
- 주사위 굴림 애니메이션 추가
```

---

## 테스트 가이드

### 로컬 테스트

```bash
# 서버 실행
npm start

# 브라우저에서
http://localhost:3000
```

### 멀티플레이 테스트

1. 브라우저 탭 2개 이상 열기
2. 각 탭에서 다른 이름으로 입장
3. Host/참가자 역할 테스트
4. Socket 이벤트 동작 확인

### 개발자 도구 활용

```javascript
// 콘솔에서 확인
socket.on('diceResult', (data) => {
    console.log('[테스트] 주사위 결과:', data);
});
```

---

## 배포 가이드

### Railway 배포

1. **GitHub 연결**
   - Railway에서 GitHub 레포지토리 연결

2. **환경 변수 설정**
   ```
   PORT=3000
   DATABASE_URL=...
   NODE_ENV=production
   ```

3. **자동 배포**
   - main 브랜치에 push하면 자동 배포

### 배포 전 체크리스트

- [ ] 로컬에서 테스트 완료
- [ ] 환경 변수 설정 확인
- [ ] package.json의 start 스크립트 확인
- [ ] 데이터베이스 마이그레이션 완료
- [ ] README 업데이트
- [ ] update-log.txt 업데이트

자세한 내용: `Railway배포완벽가이드.md` 참조

---

## 트러블슈팅

### 일반적인 문제

#### 1. Socket 연결 실패

**증상**: 클라이언트가 서버에 연결되지 않음

**해결**:
```javascript
// 연결 상태 확인
console.log('Socket 연결 상태:', socket.connected);

// 연결 URL 확인
const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3000';
```

#### 2. 이벤트가 동작하지 않음

**증상**: socket.emit 했는데 응답 없음

**해결**:
- 서버/클라이언트 양쪽 콘솔 로그 확인
- 이벤트명 오타 확인 (대소문자 구분)
- socket.on 리스너가 등록되었는지 확인

#### 3. Config 파일 로드 실패

**증상**: loadGameConfig 에러

**해결**:
```bash
# Config 파일 경로 확인
ls config/dice-config.json

# JSON 문법 검증
/validate-config
```

#### 4. 확률 합계 오류

**증상**: probabilities 합계가 1.0 초과

**해결**:
```javascript
// 확률 확인
const total = Object.values(config.probabilities)
    .reduce((a, b) => a + b, 0);
    
console.log('확률 합계:', total); // 1.0 이하여야 함
```

---

## 추가 리소스

### 문서
- `README.md` - 프로젝트 소개
- `Railway배포완벽가이드.md` - 배포 가이드
- `보안가이드.md` - 보안 정책
- `.cursorrules` - AI 개발 규칙

### Cursor Commands
- `/add-new-game` - 새 게임 추가
- `/add-socket-event` - Socket 이벤트 추가
- `/commit-with-log` - 커밋 + update-log
- `/validate-config` - Config 검증

### 외부 링크
- [Socket.IO 문서](https://socket.io/docs/)
- [React 문서](https://react.dev/)
- [Railway 문서](https://docs.railway.app/)

---

## 연락처

문제나 질문이 있으면:
1. GitHub Issues에 등록
2. 팀 채널에 문의
3. 이 문서 업데이트 제안

---

**마지막 업데이트**: 2025-01-25 (UTC+9)
