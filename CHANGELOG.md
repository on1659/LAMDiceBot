# 업데이트 내역

## 📅 최근 업데이트 (GitHub와 비교)

### 통계
- **dice-game-multiplayer.html**: +1,027줄 추가, -119줄 삭제
- **server.js**: +731줄 추가, -119줄 삭제
- **총 변경량**: 약 1,639줄 추가, 238줄 삭제

---

## 🔄 주요 변경사항

### 1. 방(Room) 관리 시스템 도입

#### 서버 측 변경 (server.js)
- **기존**: 단일 전역 게임 상태 관리
- **변경**: 다중 방 지원 시스템으로 전환
  - `rooms` 객체를 통한 방 관리
  - 각 방마다 독립적인 게임 상태(`gameState`) 유지
  - 방 ID 생성 함수 추가 (`generateRoomId()`)
  - 방별 게임 상태 생성 함수 (`createRoomGameState()`)

#### 주요 기능 추가
- **방 생성** (`createRoom` 이벤트)
  - 호스트 이름과 방 제목으로 방 생성
  - 자동 방 ID 할당
  - 방별 게임 상태 초기화
  
- **방 입장** (`joinRoom` 이벤트)
  - 방 ID로 입장
  - 중복 이름 체크
  - 최대 접속자 수 제한 (50명)
  - 재접속 시 상태 복구
  
- **방 나가기** (`leaveRoom` 이벤트)
  - 호스트 나감 시 새 호스트 자동 지정
  - 모든 사용자 나감 시 방 자동 삭제
  - 방 목록 실시간 업데이트

- **방 목록 조회** (`getRooms` 이벤트)
  - 활성화된 모든 방 목록 조회
  - 방 제목, 호스트명, 참여자 수, 게임 상태 정보 제공

---

### 2. UI 변경 (dice-game-multiplayer.html)

#### 새로운 섹션 추가
- **로비 섹션** (`.lobby-section`)
  - 방 목록 표시
  - 방 생성/입장 기능
  
- **방 생성 섹션** (`.create-room-section`)
  - 호스트 이름 입력
  - 방 제목 입력
  - 방 생성 버튼

#### CSS 스타일 추가
- `.rooms-list`: 방 목록 컨테이너 스타일
- `.room-item`: 개별 방 아이템 스타일
  - 호버 효과
  - 활성 상태 표시
  - 내가 만든 방 표시 (`.my-room`)

---

### 3. 서버 측 기능 개선

#### 방 관리 기능
- **호스트 권한 관리**
  - 호스트 전환 기능 (호스트 나감 시 자동)
  - 호스트 권한 확인 로직 강화
  
- **방 제목 변경** (`updateRoomName` 이벤트)
  - 호스트만 방 제목 변경 가능
  - 30자 이하 제한
  
- **실시간 방 목록 업데이트** (`updateRoomsList()`)
  - 방 생성/삭제 시 모든 클라이언트에 알림
  - 게임 상태 변경 시 방 목록 업데이트

#### 게임 상태 관리 개선
- **방별 독립 게임 상태**
  - 각 방의 게임 진행 상황 독립 관리
  - 준비 상태 관리 (`readyUsers`)
  - 게임 참여자 목록 (`gamePlayers`)
  
- **재접속 처리**
  - 사용자 재접속 시 이전 상태 복구
  - 이미 굴린 주사위 결과 유지
  - 준비 상태 유지

---

### 4. 하위 호환성 유지

- **기존 로그인 기능** (`login` 이벤트) 유지
  - 기존 단일 방 모드 지원
  - 전역 `gameState` 유지 (하위 호환성)

---

## 🔧 기술적 개선사항

### 소켓 관리
- 각 소켓에 방 정보 저장
  - `socket.currentRoomId`: 현재 방 ID
  - `socket.userName`: 사용자 이름
  - `socket.isHost`: 호스트 여부

### 에러 처리
- 방 관련 에러 처리 추가
  - `roomError`: 방 관련 일반 에러
  - `permissionError`: 권한 관련 에러
  - `hostTransferred`: 호스트 전환 알림

### Rate Limiting
- 기존 요청 제한 기능 유지 (10초당 50회)
- 모든 새로운 이벤트에 적용

---

## 📝 변경된 이벤트 목록

### 새로 추가된 이벤트
- `getRooms`: 방 목록 조회
- `createRoom`: 방 생성
- `joinRoom`: 방 입장
- `leaveRoom`: 방 나가기
- `updateRoomName`: 방 제목 변경
- `roomsList`: 방 목록 수신
- `roomsListUpdated`: 방 목록 업데이트 알림
- `roomCreated`: 방 생성 성공
- `roomJoined`: 방 입장 성공
- `roomLeft`: 방 나가기 완료
- `roomDeleted`: 방 삭제 알림
- `roomNameUpdated`: 방 제목 변경 알림
- `hostTransferred`: 호스트 전환 알림
- `hostChanged`: 호스트 변경 알림

### 기존 이벤트 유지
- 게임 관련: `startGame`, `endGame`, `requestRoll` 등
- 설정 관련: `updateUserDiceSettings`, `updateGameRules` 등
- 주문 관련: `startOrder`, `endOrder`, `updateOrder` 등
- 채팅 관련: `sendMessage`
- 메뉴 관련: `addFrequentMenu`, `deleteFrequentMenu` 등

---

## 🎯 주요 개선 효과

1. **다중 게임 세션 지원**: 여러 방에서 동시에 게임 진행 가능
2. **독립적인 게임 상태**: 각 방의 게임 상태가 서로 영향받지 않음
3. **향상된 사용자 경험**: 방 선택 및 입장/나가기 기능 제공
4. **확장성 향상**: 향후 방 검색, 비밀번호 기능 등 추가 용이

---

## ⚠️ 주의사항

- 기존 단일 방 모드(`login` 이벤트)는 여전히 지원되지만, 새로운 방 시스템을 사용하는 것을 권장합니다
- 방 생성 시 방 ID가 자동 생성되며, 이 ID로 방에 입장할 수 있습니다
- 호스트가 나가면 자동으로 새 호스트가 지정됩니다
- 모든 사용자가 나가면 방이 자동으로 삭제됩니다

