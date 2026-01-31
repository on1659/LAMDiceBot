# 주사위 게임 롤백 가이드

주사위 게임 관련 코드를 제거하는 방법을 안내합니다.

> **주의**: 주사위 게임은 이 프로젝트의 핵심 게임입니다. 제거 시 다른 게임(룰렛, 경마, 팀 배정)의 메인 진입점도 영향을 받습니다.

## 제거할 파일

- `dice-game-multiplayer.html` (전체 파일 삭제)
- `AutoTest/dice/` (주사위 테스트 디렉토리)

## server.js에서 제거할 코드

### 1. 게임 상태 필드 (484-517줄)
`createRoomGameState()` 함수 내 주사위 관련 필드:
```javascript
diceMax: 100,
history: [],
rolledUsers: [],
gamePlayers: [],
everPlayedUsers: [],
readyUsers: [],
userDiceSettings: {},
gameRules: '',
allPlayersRolledMessageSent: false,
```

### 2. seededRandom 함수 (804-816줄)
시드 기반 랜덤 생성 함수 전체 제거

### 3. 커스텀 룰 판정 API (599-800줄)
`POST /api/calculate-custom-winner` 엔드포인트 전체 제거

### 4. requestGameStart 핸들러 (2600-2689줄)
게임 시작 처리 핸들러 전체 제거

### 5. endGame 핸들러 (2692줄~)
게임 종료 처리 핸들러 전체 제거

### 6. requestRoll 핸들러 (3969-4310줄)
주사위 굴리기 처리 핸들러 전체 제거

### 7. updateUserDiceSettings 핸들러
사용자별 주사위 범위 설정 핸들러 제거

### 8. updateGameRules 핸들러
게임 룰 업데이트 핸들러 중 주사위 관련 부분 제거

### 9. clearGameData 핸들러
이전 게임 데이터 삭제 핸들러 제거

### 10. 라우트
`dice-game-multiplayer.html` 서빙 라우트 제거

## 영향받는 다른 파일

- `roulette-game-multiplayer.html`: 메인 페이지에서의 게임 선택 분기
- `horse-race-multiplayer.html`: 메인 페이지에서의 게임 선택 분기
- `team-game-multiplayer.html`: 메인 페이지에서의 게임 선택 분기

> 주사위 게임 HTML이 다른 게임의 메인 진입점 역할도 하므로, 제거 시 별도 메인 페이지 구현이 필요합니다.

## Git 롤백 방법

### 방법 1: 특정 커밋으로 되돌리기
```bash
git log --oneline --grep="dice\|주사위"  # 관련 커밋 확인
git revert <commit-hash>
```

### 방법 2: 수동 제거 후 커밋
1. 위의 파일 및 코드 제거
2. 테스트 후 커밋
```bash
git add .
git commit -m "Remove dice game implementation"
```

## 주의사항

- 롤백 전 현재 작업 내용을 백업하세요
- `server.js`는 큰 파일이므로 코드 제거 시 주의하세요
- 제거 후 서버 재시작하여 오류 확인하세요
- 주사위 게임 HTML이 메인 진입점이므로 대체 페이지가 필요합니다
