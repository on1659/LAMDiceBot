# LAMDiceBot Project Plan

## Recent Updates

### 2026-01-29: 사운드 on/off 체크박스 (기본 끔)

#### 작업 내용
- 주사위/룰렛/팀배정/경마 네 게임 모두 "연결됨" 옆에 **🔊 사운드** 체크박스 추가
- **기본값: 체크 해제(사운드 끔)**. 체크했을 때만 사운드 재생
- 룰렛: `getRouletteSoundEnabled()`로 체크 시에만 `RouletteSound` 재생
- 설정은 `localStorage`에 게임별 키 저장 (rouletteSoundEnabled, diceSoundEnabled, horseSoundEnabled, teamSoundEnabled)
- 팀배정: 기존에 연결 상태 표시가 없어 헤더 우측에 "● 연결됨" + 사운드 체크박스 추가, connect/disconnect 시 텍스트 갱신

#### 수정 파일
- `roulette-game-multiplayer.html`: connection-sound-row, 체크박스 2곳, getRouletteSoundEnabled/동기화, RouletteSound 재생 시 조건
- `dice-game-multiplayer.html`: connection-sound-row, 체크박스 2곳, localStorage 동기화
- `horse-race-multiplayer.html`: connection-sound-row, 체크박스 2곳, localStorage 동기화
- `team-game-multiplayer.html`: 헤더에 연결 상태 + 사운드 체크박스, connect/disconnect UI, localStorage

---

### 2026-01-29: 룰렛 게임 사운드 추가

#### 작업 내용
- 룰렛 게임에 Web Audio API 기반 사운드 추가 (외부 오디오 파일 불필요)
- **스핀 사운드**: 휠이 돌아가는 동안 120ms 간격 짧은 톤(90Hz)으로 틱 소리 재생
- **멈출 때 럼블**: 메인 회전이 끝나고 마무리 효과(bounce/shake/slowCrawl) 진입 시 짧은 저음(65Hz) 재생
- **당첨 사운드**: 결과 오버레이 표시 시 당첨자(`data.winner === currentUser`)에게만 팡파레(C5→E5→G5→C6) 재생
- 다시보기 시에도 동일한 스핀/멈춤/당첨 사운드 적용
- `RouletteSound` 객체로 `playSpin`, `stopSpin`, `playStopRumble`, `playWinner` 제공
- 사용자 제스처: "룰렛 시작" 클릭 시 `ensureContext()` 호출로 오디오 컨텍스트 활성화

#### 수정 파일
- `roulette-game-multiplayer.html`: RouletteSound 추가, spinRoulette/콜백/다시보기에서 사운드 연동

---

### 2026-01-29: 자동 검증 에이전트 구현 완료

#### 작업 내용
- 코드 변경 후 자동 검증(코드 품질, 서버 기동, Socket 연결) 수행
- `.cursorrules`에 섹션 21 "자동 검증 (REQUIRED!)" 추가
- 검증 스킬 `.cursor/skills/verification-agent/SKILL.md` 생성 (트리거: 검증해줘, 테스트해줘, 확인해줘)
- 통합 검증 스크립트 `AutoTest/verify-all.js` 추가 (문법 검사, 서버 기동, Socket 연결, JSON 결과 출력)

#### 사용 방법
- 기능 구현 후: ReadLints → 서버 실행 확인 → 해당 게임 테스트 봇 실행 (규칙에 따라 AI가 수행)
- 수동 검증: "검증해줘" 등으로 스킬 호출 또는 `node AutoTest/verify-all.js` 실행
- 전체 검증은 일반 터미널/CI에서 실행 권장 (child_process 제한 환경에서는 일부 스킵)

---

### 2026-01-29: 경마 게임 스크롤링 구현 계획 수립

#### 작업 내용
- 경마 게임에 수평 스크롤링 기능 추가 계획 수립
- 스크롤링 개념 및 구현 방식 분석
- 상세 구현 계획 문서 작성 (`docs/HORSE_RACE_SCROLLING_PLAN.md`)

#### 계획 요약
1. **스크롤링 개념**: 게임 화면이 고정되고 배경/요소가 움직이는 효과
2. **구현 방식**: 컨테이너에 `overflow-x: auto` 설정 + 자동 스크롤 로직
3. **최대 너비 제한**: 게임 종료 버튼 크기만큼으로 제한
4. **자동 스크롤**: 말이 움직일 때 리더를 중심으로 스크롤

#### 참고 문서
- `docs/HORSE_RACE_SCROLLING_PLAN.md`: 상세 구현 계획

---

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

