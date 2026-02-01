# 주사위 게임 종료 버그 (2번째 게임부터 발생)

## 증상
첫 번째 게임은 정상 종료되지만, 두 번째 게임부터 게임 종료가 되지 않음.

## 근본 원인 (3가지)

### 1. processGameEnd 세대 충돌
- 1차 게임의 processGameEnd가 5초 타임아웃으로 지연 실행됨
- 2차 게임이 이미 시작된 후에 1차 게임의 processGameEnd가 실행
- lastRollerAnimationComplete 등 전역 플래그가 파괴됨

**타임라인 예시:**
- 22:57:09 - 2차 게임 주사위 굴리기 시작
- 22:57:12 - 2차 게임 마지막 플레이어 굴림
- 22:57:15 - 1차 게임의 processGameEnd 실행 -> 전역 상태 오염

### 2. DOM 중복 체크가 2차 게임 결과 배너 차단
1차 게임의 결과 배너가 DOM에 남아있어서 existingResultMessage 체크가 true를 반환, 2차 게임 결과 표시를 차단함.

### 3. 서버 history 배열 누적 오염
- gameState.history가 게임 간 초기화되지 않고 누적
- 이전 게임 기록이 필터에 포함되어 승자 판정 오류 발생

## 수정 내용

### dice-game-multiplayer.html
- gameGeneration 카운터 도입: 게임 시작마다 증가, processGameEnd에서 세대 확인
- gameStarted 핸들러: 이전 게임의 interval/timeout 정리, 이전 결과 배너 DOM 제거
- DOM 중복 체크 제거 -> allRolledMessageShown 플래그로 대체
- waitForAnimation: 세대 체크 + safeProcessGameEnd 가드

### server.js
- 게임 시작 시 이전 history 레코드에 isGameActive = false 마킹
- 현재 게임 기록만 필터링 가능하도록 변경

## 교훈
- 전역 상태 + 비동기 타이머 = 반드시 세대(generation) 관리 필요
- DOM 기반 상태 체크는 게임 간 잔존 요소로 인해 위험
- 누적 배열은 게임 경계에서 격리 또는 초기화 필수
