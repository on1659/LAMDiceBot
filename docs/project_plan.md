# LAMDiceBot Project Plan

## Phase 2: 서버 개념 도입 (진행 중)

### 2026-01-10: 서버 시스템 기반 구축

#### 데이터베이스 스키마 설계
- **서버 테이블** (`servers`)
  - 서버 ID, 이름, 설명, 호스트 정보, 생성일시
  - 활성 상태 관리 (`is_active`)
  
- **서버 멤버 테이블** (`server_members`)
  - 서버-사용자 관계 관리
  - 소켓 ID 추적 (현재 연결 상태)
  - 가입일시, 최종 접속일시
  
- **게임 기록 테이블** (`server_game_records`)
  - 서버별 게임 기록 저장
  - 게임 타입 (dice/roulette), 게임 룰
  - 당첨 여부 (`is_winner`)
  - 게임 세션 ID로 그룹화
  
- **게임 세션 테이블** (`game_sessions`)
  - 한 게임의 전체 정보
  - 당첨자 정보, 참여자 수
  - 시작/종료 시간

#### 서버 API 구현
- **Socket.IO 이벤트**
  - `createServer`: 서버 생성
  - `getServers`: 서버 목록 조회
  - `joinServer`: 서버 입장
  - `getServerRecords`: 서버별 기록 조회
  
- **게임 기록 저장**
  - 게임 종료 시 자동으로 서버에 기록 저장
  - 당첨자 정보 계산 및 저장
  - 게임 세션 단위로 기록 관리

#### 리액트 프로젝트 설정
- Vite + React 설정 완료
- 기존 HTML을 리액트 컴포넌트로 전환 예정

### 다음 단계
1. 리액트 컴포넌트 구조 설계
2. 서버 관리 UI 구현 (서버 생성, 목록, 선택)
3. 기존 게임 화면을 리액트로 전환
4. 서버별 기록 조회 UI 구현

---

## Recent Updates

### 2026-01-01: 룰렛 게임 추가 및 애니메이션 버그 수정

#### 새 기능
- **룰렛 게임 모드 추가** (`roulette-game-multiplayer.html`)
  - 방 생성 시 주사위/룰렛 선택 가능
  - 참가자 이름이 파이 차트 형태로 표시
  - 방장이 시작 버튼으로 룰렛 실행
  - 모든 클라이언트에서 동일한 애니메이션 재생

#### 수정된 버그
- **룰렛 애니메이션-결과 불일치 문제 해결**
  - 문제: 화살표가 가리키는 위치와 당첨자가 다름
  - 원인 1: `createRouletteWheel`에서 휠 transform 초기화 누락
  - 원인 2: `totalRotation`이 360의 배수가 아닐 때 오차 발생
  - 원인 3: 변수명 변경 후 console.log에서 이전 변수 참조 (JS 오류)
  - 해결: 휠 초기화 + 정확한 각도 공식 적용

#### 각도 계산 공식 (최종)
```javascript
const winnerCenterAngle = (winnerIndex + 0.5) * segmentAngle;
const neededRotation = 360 - winnerCenterAngle;
const fullRotations = Math.floor(totalRotation / 360);
const finalAngle = fullRotations * 360 + neededRotation;
```

---

## Previous Updates

### Host-Initiated Player Removal
- [x] Backend `kickPlayer` socket event implemented
- [x] Frontend `dblclick` listener and `kicked` event handler
- [x] Check to prevent kicking players who have already rolled

