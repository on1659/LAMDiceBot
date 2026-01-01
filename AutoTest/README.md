# 🎰 LAMDice 룰렛 테스트 봇

룰렛 게임의 UI와 다중 클라이언트 동기화를 테스트하는 봇입니다.

## 테스트 항목

### 1. 룰렛 UI 테스트
- 서버에서 보낸 `winnerIndex`와 클라이언트에서 계산한 화살표 위치가 일치하는지 검증
- 화살표가 당첨자 세그먼트를 정확히 가리키는지 확인

### 2. 다중 클라이언트 동기화 테스트
- 여러 클라이언트가 동시에 접속했을 때 같은 결과를 받는지 확인
- `winner`, `winnerIndex`, `participants`, `totalRotation` 동기화 검증

## 설치

```bash
cd AutoTest
npm install
```

## 사용법

### 로컬 서버 테스트 (기본)
```bash
# 먼저 서버 실행 (다른 터미널에서)
cd ..
node server.js

# 테스트 실행
npm run test:local
# 또는
node test-bot.js --url http://localhost:3000
```

### 프로덕션 서버 테스트
```bash
npm run test:prod
# 또는
node test-bot.js --url https://lamdicebot-production.up.railway.app
```

### 옵션
```bash
# 클라이언트 수 변경 (기본: 3)
node test-bot.js --clients 5

# 테스트 라운드 변경 (기본: 5)
node test-bot.js --rounds 10

# 조합
node test-bot.js --url http://localhost:3000 --clients 4 --rounds 3
```

## 결과

테스트 결과는 콘솔에 출력되며, `roulette-test-results.log` 파일에 저장됩니다.

### 출력 예시
```
[✅ SUCCESS] 라운드 1 UI 테스트 통과
[✅ SUCCESS] 라운드 1 동기화 테스트 통과: 모든 클라이언트가 동일한 데이터 수신
```

### 검증 로직

**UI 검증 (각도 계산)**
```javascript
// conic-gradient(from 0deg): index N은 N*segmentAngle ~ (N+1)*segmentAngle
const segmentAngle = 360 / participants.length;
const winnerCenterAngle = (winnerIndex + 0.5) * segmentAngle;
const neededRotation = 360 - winnerCenterAngle;
const fullRotations = Math.floor(totalRotation / 360);
const finalAngle = fullRotations * 360 + neededRotation;

// 화살표가 가리키는 위치
const arrowPointsTo = (360 - (finalAngle % 360) + 360) % 360;
```

## 주의사항

1. 테스트 전 서버가 실행 중이어야 합니다
2. 로컬 테스트 시: `cd .. && node server.js`
3. 테스트 중 방이 자동 생성/삭제됩니다

## 트러블슈팅

### 연결 실패
- 서버가 실행 중인지 확인
- URL이 올바른지 확인 (http/https)

### 타임아웃 에러
- 서버 응답이 느린 경우 발생
- 네트워크 상태 확인

### 동기화 실패
- 서버 코드에서 당첨자 결정 로직 확인
- 모든 클라이언트에게 같은 데이터를 emit하는지 확인
