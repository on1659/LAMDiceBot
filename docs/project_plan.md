# LAMDiceBot Project Plan

## Recent Updates

### 2026-01-27: 방 생성 규칙 개선 및 중복 닉네임 처리

#### 변경 사항
1. **방 생성 시 호스트 이름 입력 필드 제거**
   - 대기실에서 입력한 이름(globalUserNameInput)을 자동으로 사용
   - 방 생성 페이지 단순화

2. **아이디 유효성 검사 구현**
   - 허용 문자: 한글, 영문 소문자, 숫자, 언더바(_), 하이픈(-)
   - 공백 및 특수문자(!, @, #, *, (, ) 등) 입력 시 에러 메시지 표시
   - 포커스 아웃 시 유효하지 않은 문자 자동 제거
   - 재사용 가능한 `validateUserId()` 함수로 분리

3. **중복 닉네임 자동 처리**
   - 같은 이름이 이미 있으면 자동으로 `_1`, `_2` 접미사 추가
   - 예: "이더" → "이더_1" → "이더_2"
   - 클라이언트에 변경된 이름 알림 표시
   - 서버에 `generateUniqueUserName()` 함수 추가

#### 수정 파일
- `dice-game-multiplayer.html`: UI 및 유효성 검사 추가
- `server.js`: 중복 이름 처리 로직 추가

---

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

