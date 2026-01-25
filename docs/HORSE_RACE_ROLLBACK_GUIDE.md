# 경마 게임 롤백 가이드

경마 게임 관련 코드를 제거하는 방법을 안내합니다.

## 제거할 파일

- `horse-race-multiplayer.html` (전체 파일 삭제)

## server.js에서 제거할 코드

### 1. 게임 상태 필드 (324-332줄)
`createRoomGameState()` 함수 내 경마 게임 관련 필드:
```javascript
// 경마 게임 관련
horseRaceHistory: [],
isHorseRaceActive: false,
availableHorses: [],
userHorseBets: {},
horseRankings: [],
horseRaceMode: 'first',
currentRoundPlayers: [],
raceRound: 1
```

### 2. roomCreated 핸들러 (1070-1093줄)
경마 게임인 경우 말 선택 UI 표시하는 분기 전체 제거

### 3. roomJoined 핸들러 (1258-1280줄)
경마 게임인 경우 말 선택 UI 표시하는 분기 전체 제거

### 4. updateGameRules 핸들러 (2070-2076줄)
경마 모드 업데이트 로직 제거

### 5. startHorseRace 핸들러 (2789-2893줄)
전체 핸들러 제거

### 6. selectHorse 핸들러 (2894-3126줄)
전체 핸들러 제거

### 7. calculateHorseRaceResult 함수 (3127-3163줄)
전체 함수 제거

### 8. getWinnersByRule 함수 (3164-3190줄)
전체 함수 제거

### 9. endHorseRace 핸들러 (3191-3220줄)
전체 핸들러 제거

### 10. horseRaceEnded 이벤트 처리 (3068-3126줄)
`selectHorse` 핸들러 내부의 경주 종료 후 재시작 로직 제거

## dice-game-multiplayer.html에서 제거할 코드

### 1. 게임 타입 선택 UI (1321-1323줄)
경마 라디오 버튼 및 레이블 제거

### 2. 방 생성 분기 (3284-3298줄)
경마 게임인 경우 경마 페이지로 이동하는 분기 전체 제거

## Git 롤백 방법

### 방법 1: 특정 커밋으로 되돌리기
```bash
# 경마 게임 관련 커밋 이전으로 되돌리기
git log --oneline --grep="horse\|경마"  # 관련 커밋 확인
git revert <commit-hash>  # 또는
git reset --hard <commit-hash>  # 주의: 변경사항 모두 삭제
```

### 방법 2: 수동 제거 후 커밋
1. 위의 파일 및 코드 제거
2. 테스트 후 커밋
```bash
git add .
git commit -m "Remove horse race game implementation"
```

## 주의사항

- 롤백 전 현재 작업 내용을 백업하세요
- `server.js`는 큰 파일이므로 코드 제거 시 주의하세요
- 제거 후 서버 재시작하여 오류 확인하세요
