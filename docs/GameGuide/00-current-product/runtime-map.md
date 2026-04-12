# 런타임 요청 흐름

## HTTP 요청

```
브라우저 → Express (routes/api.js, routes/server.js)
    ↓
정적 파일: *.html, js/, css/, assets/
API 응답: /api/statistics, /api/ranking/*, /api/server/*
GPT 판정: /api/calculate-custom-winner
    ↓
DB 조회/기록 (db/*.js) → PostgreSQL 또는 파일 폴백
```

## WebSocket 요청

```
브라우저 → Socket.IO → socket/index.js (연결 수립)
    ↓ rate limit: 50 req/10sec
socket/rooms.js     방 생성/입장/퇴장
socket/shared.js    주문/준비/룰/메뉴
socket/dice.js      주사위 게임
socket/roulette.js  룰렛 게임
socket/horse.js     경마 게임
socket/chat.js      채팅/이미지/반응
socket/board.js     건의 게시판
socket/server.js    서버 가입/관리
    ↓
rooms (인메모리) ←→ DB (통계/랭킹/기록)
```

## 게임 진입 흐름

```
사용자가 /game 접속
    ↓
dice-game-multiplayer.html 로드
    ↓
Socket.IO 연결 수립
    ↓
서버 선택 (server-select-shared.js)
  → 프리 플레이 또는 서버 가입
    ↓
방 생성 (createRoom) 또는 방 입장 (joinRoom)
    ↓
roomJoined 이벤트 수신
    ↓
모듈 초기화: Chat → Ready → Order → Sound
    ↓
게임 준비 → 시작 → 진행 → 종료
    ↓
결과 기록 (DB) → 랭킹 갱신
```

## 데이터 흐름

```
클라이언트 상태          서버 상태              영구 저장
─────────────          ─────────              ─────────
UI/DOM                 rooms (인메모리)        PostgreSQL
localStorage           onlineMembers          또는
(사운드/튜토리얼)       (인메모리)             JSON 파일
```

- 방/게임 상태: 인메모리 (서버 재시작 시 소실)
- 랭킹/통계/멤버: DB 영구 저장 (파일 폴백)
- 사운드/튜토리얼 설정: 클라이언트 localStorage
