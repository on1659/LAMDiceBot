# 인형뽑기 (Crane Game) 구현 계획

## Context
새로운 멀티플레이어 게임 "인형뽑기"를 추가한다. 게임 컨셉:
- 룰렛처럼 1명이 랜덤으로 선정되는 게임
- 시각적으로는 인형뽑기(UFO 캐처) 연출
- 참가자 이름이 인형(봉제인형)으로 표시되고, 집게가 내려와서 당첨자를 잡아 올림
- 채팅 메시지가 인형 머리 위에 말풍선으로 표시됨

## 수정/생성할 파일 목록

### 서버 (5개 파일)

| 파일 | 작업 | 설명 |
|------|------|------|
| `utils/room-helpers.js` | 수정 | `createRoomGameState()`에 crane-game 필드 추가 |
| `socket/rooms.js` | 수정 | validGameType 배열에 `'crane-game'` 추가 (line 208) |
| `socket/crane-game.js` | **생성** | 인형뽑기 소켓 이벤트 핸들러 |
| `socket/index.js` | 수정 | crane-game 핸들러 import & 등록 |
| `routes/api.js` | 수정 | `GET /crane-game` 라우트 추가 + 통계 defaultGameStats에 crane-game 추가 |

### 클라이언트 (2개 파일)

| 파일 | 작업 | 설명 |
|------|------|------|
| `crane-game-multiplayer.html` | **생성** | 인형뽑기 전용 게임 페이지 (메인 작업) |
| `dice-game-multiplayer.html` | 수정 | 게임타입 라디오버튼 + 방생성/입장 리다이렉트 추가 |

---

## 1단계: 서버 인프라

### 1-1. `utils/room-helpers.js` (line 59 뒤에 추가)
```javascript
craneGameHistory: [],
isCraneGameActive: false,
```

### 1-2. `socket/rooms.js` (line 208)
```javascript
// Before:
const validGameType = ['dice', 'roulette', 'horse-race'].includes(gameType) ? gameType : 'dice';
// After:
const validGameType = ['dice', 'roulette', 'horse-race', 'crane-game'].includes(gameType) ? gameType : 'dice';
```

### 1-3. `socket/crane-game.js` (새 파일, roulette.js 패턴 그대로)

소켓 이벤트:
- **`startCraneGame`** (호스트만) - 게임 시작
  - ready 유저 2명 이상 검증
  - `Math.random()`으로 당첨자 결정
  - fake-out 횟수: `Math.floor(Math.random() * 3)` (0~2회)
  - 애니메이션 파라미터 생성 (집게 이동/하강/잡기/상승/낙하 타이밍)
  - `craneGameStarted` 브로드캐스트 (participants, winner, winnerIndex, animParams)
  - DB 기록 (`recordGamePlay('crane-game', ...)`)
  - 시스템 채팅 메시지 발송

- **`craneGameResult`** (호스트만) - 애니메이션 완료 확인
  - DB 서버 기록 저장 (`recordGameSession`, `recordServerGame`)
  - readyUsers 초기화
  - 당첨 시스템 메시지 발송
  - `craneGameEnded` 브로드캐스트

- **`endCraneGame`** (호스트만) - 게임 종료
  - 전체 상태 초기화
  - `craneGameFullEnded` 브로드캐스트

### 1-4. `socket/index.js`
```javascript
// import 추가 (line 9 부근)
const registerCraneGameHandlers = require('./crane-game');

// 등록 추가 (line 175 부근, registerHorseHandlers 뒤)
registerCraneGameHandlers(socket, io, ctx);
```

### 1-5. `routes/api.js`
```javascript
// /roulette 라우트 뒤에 추가
app.get('/crane-game', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'crane-game-multiplayer.html'));
});

// 통계 API의 defaultGameStats에 추가 (line 131)
'crane-game': { count: 0, totalParticipants: 0 }
```

---

## 2단계: 로비 통합 (`dice-game-multiplayer.html`)

### 2-1. 게임타입 라디오 버튼 추가 (line 1492 부근)
- 경마 라벨 뒤에 인형뽑기 라디오 추가
- 아이콘: `🪄`, 이름: `인형뽑기`, 테마색: `#9c27b0` (보라색)
- NEW 뱃지 포함

### 2-2. colorMap에 추가 (line 1501)
```javascript
const colorMap = { dice: '#667eea', roulette: '#e91e63', 'horse-race': '#8b4513', 'crane-game': '#9c27b0' };
```

### 2-3. 방 생성 리다이렉트 (line 3597 뒤)
```javascript
if (gameType === 'crane-game') {
    localStorage.setItem('craneGameUserName', hostName);
    localStorage.setItem('pendingCraneGameRoom', JSON.stringify({...}));
    window.location.href = '/crane-game-multiplayer.html?createRoom=true';
    return;
}
```

### 2-4. 방 입장 리다이렉트 (3곳: joinRoomDirectly, joinSelectedRoom, 방목록 게임타입 표시)
- 룰렛/경마와 동일 패턴으로 crane-game 분기 추가
- 게임타입 아이콘: `🪄`, 라벨: `인형뽑기`

---

## 3단계: 게임 페이지 (`crane-game-multiplayer.html`)

`roulette-game-multiplayer.html` 구조를 그대로 따르되, 게임 영역만 인형뽑기 UI로 교체.
URL 경로: `/crane-game` → `crane-game-multiplayer.html`

### 3-1. 페이지 구조
```
<!DOCTYPE html>
├── <head> (AdSense, Google Fonts, CSS)
├── <body>
│   ├── .container
│   │   ├── 로비 섹션 (서버 선택, 방 목록, 방 생성)
│   │   └── 게임 섹션
│   │       ├── 방 헤더 (방 제목, 나가기, 사운드)
│   │       ├── 유저 목록
│   │       ├── 준비/레디 영역 (ReadyModule)
│   │       ├── 호스트 컨트롤 (시작 버튼)
│   │       ├── ★ 인형뽑기 머신 (핵심 UI) ★
│   │       ├── 결과 오버레이
│   │       ├── 히스토리 (우측 패널)
│   │       ├── 주문/채팅 영역
│   │       └── 게임 종료 버튼
│   ├── <script> Socket.IO + 공유 모듈
│   └── <script> 게임 로직
```

### 3-2. 인형뽑기 머신 비주얼 (CSS Only, No Canvas)

```
┌─────────────────────────┐  ← .claw-machine (어두운 프레임)
│ ════════════════════════ │  ← .claw-rail (레일)
│        ┃                │  ← .claw-arm (팔)
│       ╲╱                │  ← .claw-fingers (집게)
│                         │
│  ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ │  ← .dolls-grid
│  │🧸│ │🐰│ │🦊│ │🐱│ │🐶│ │     .doll (개별 인형)
│  │철수│ │영희│ │민수│ │지연│ │현우│ │     .doll-name
│  └─┘ └─┘ └─┘ └─┘ └─┘ │
│  ┌──────────┐          │  ← .prize-chute (상품 출구)
│  │  꺼내기  │          │
│  └──────────┘          │
└─────────────────────────┘
```

**핵심 CSS 요소:**
- `.claw-machine` - 메인 프레임 (어두운 그라데이션, 보라색 테두리)
- `.claw-rail` - 상단 레일
- `.claw-assembly` - 집게 전체 (position: absolute, CSS transition으로 이동)
- `.claw-arm` - 팔 (height 변경으로 하강/상승)
- `.claw-fingers` - 집게 손 (gap 변경으로 열림/닫힘)
- `.dolls-grid` - 인형 배치 영역 (flex-wrap)
- `.doll` - 개별 인형 (이모지 아바타 + 이름)
- `.speech-bubble` - 말풍선 (doll 위에 위치, 3-4초 후 페이드)
- `.prize-chute` - 하단 배출구

**인형 색상/이모지:**
- 16가지 색상 팔레트 (룰렛 userColors와 동일)
- 16가지 동물 이모지: 🧸🐻🐰🦊🐱🐶🐼🦁🐸🐧🦄🐹🐮🐷🐵🦋

### 3-3. 애니메이션 시퀀스 (JavaScript setTimeout 체이닝)

```
Phase 0: 인형 렌더링 (참가자들을 인형으로 배치)
  ↓ 1초
Phase 1: 집게 열림 (fingers.open)
  ↓ clawMoveDelay (500~1500ms)
Phase 2: 수평 이동 (fake-out 0~2회 포함, 다른 인형 위에서 멈칫)
  ↓ horizontalDuration (2000~4000ms)
Phase 3: 하강 (arm height 증가 + 집게 아래로)
  ↓ descendDuration (1000~2000ms)
Phase 4: 잡기 (fingers.closed, 대상 인형에 .grabbed 효과, fake 효과가 랜덤으로 발생 (70%정도), 못잡을 확률도 추가, 관련해서  따로 시스템회의필요)
  ↓ grabPauseDuration (500~1000ms)
Phase 5: 상승 (arm height 감소, 인형도 같이 올라감)
  ↓ liftDuration (1500~2500ms)
Phase 6: 배출구로 이동
  ↓ 500ms
Phase 7: 놓기 (fingers.open, 인형 낙하 애니메이션)
  ↓ dropDuration (800~1200ms)
Phase 8: 결과 발표 (result overlay)
```

### 3-4. 말풍선 시스템

- 채팅 메시지 수신 시 (`newMessage` 이벤트), 해당 유저의 인형 위에 말풍선 표시
- ChatModule의 `beforeDisplay` 콜백 활용
- 말풍선은 4초 후 자동 페이드아웃
- 최대 1개 말풍선만 표시 (새 메시지 오면 기존 것 교체)

### 3-5. 공유 모듈 연동

기존 공유 JS 파일 모두 사용:
- `server-select-shared.js` - 서버 선택
- `chat-shared.js` - 채팅 (+ 말풍선 연동)
- `ranking-shared.js` - 랭킹 표시
- `ready-shared.js` - 준비/레디
- `order-shared.js` - 주문
- `page-history-shared.js` - 페이지 히스토리
- `assets/sounds/sound-manager.js` - 사운드

### 3-6. sessionStorage/localStorage 키
- `craneGameUserName` - 유저 이름
- `craneGameActiveRoom` - 현재 활성 방 (새로고침 재입장용)
- `pendingCraneGameRoom` - 방 생성 대기
- `pendingCraneGameJoin` - 방 입장 대기

---

## 4단계: 사운드 (선택사항, 나중에 추가 가능)

사운드 파일 없이도 동작하도록 구현. SoundManager는 파일이 없으면 조용히 무시.
- `sound-config.json`에 crane-game 키 추가는 사운드 파일 준비 후 진행

---

## 검증 방법

1. **서버 시작**: `node server.js` (또는 기존 실행 방식)
2. **로비 확인**: `/game` 접속 → 게임타입에 "인형뽑기" 라디오 표시 확인
3. **방 생성**: 인형뽑기 선택 후 방 생성 → `/crane-game` 페이지로 리다이렉트 확인
4. **멀티 테스트**: 브라우저 2개로 접속 → 방 입장 → 준비 → 게임 시작
5. **애니메이션**: 집게가 인형 위로 이동 → 하강 → 잡기 → 상승 → 결과 발표 확인
6. **채팅 말풍선**: 게임 중 채팅 → 인형 위에 말풍선 표시 확인
7. **DB 기록**: 게임 완료 후 `/api/statistics`에서 crane-game 통계 확인

