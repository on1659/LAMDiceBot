# 경마 게임 개발 가이드

경마 게임의 현재 구현 상태, 개발 계획, 롤백 방법, 스크롤링 계획을 정리한 문서입니다.

---

## 1. 현재 구현 상태

### 완료된 부분

- **클라이언트**: `horse-race-multiplayer.html` 구현 완료
  - 말 선택 UI
  - 경주 트랙 애니메이션
  - 순위 팝업
  - 채팅/주문/순위 시스템 통합

- **최근 반영된 UI·사운드**
  - **등수 표시**: 1~6등 라벨을 트랙 내부(`#raceTrack` 자식)에 배치. `position: absolute` + `offsetLeft/offsetTop` 기준으로 스크롤과 함께 유지.
  - **순위 발표 UI**: 1·2·3등 블록에 `resultRankBounce`, `resultRankPulse` 애니메이션. 4·5등 블록은 `padding`·`margin-bottom`·폰트 축소로 여백 축소.
  - **당첨자 1명일 때**: "축하합니다! 🎉" 문구 제거(메시지 영역 비움).
  - **꼴등 유저 강조**: 순위 발표에서 꼴등(마지막 순위) 탈것에 베팅한 유저 이름을 `<strong>`으로 표시.
  - **트랙 퍼센트 라벨 제거**: 각 레인 좌측의 남은 거리 퍼센트(82%, 56% 등) 라벨 제거. 이름 라벨 위치 `left: 5px`.
  - **사운드**: `assets/sounds/sound-manager.js` 로드. 게임 섹션에 사운드 체크박스, `getHorseSoundEnabled()`·`localStorage`(horseSoundEnabled). 재생 키: `horse-race_countdown`, `horse-race_gunshot`, `horse-race_crowd`, `horse-race_bgm`, `horse-race_finish`, `horse-race_result`, `common_notification`.

- **서버**: `server.js`에 경마 게임 핸들러 구현 완료
  - `startHorseRace`: 경마 시작
  - `selectHorse`: 말 선택 처리
  - `calculateHorseRaceResult`: 경주 결과 계산
  - `getWinnersByRule`: 룰에 따른 당첨자 결정
  - `endHorseRace`: 경마 종료

- **메인페이지**: `dice-game-multiplayer.html`에서 경마 게임 선택 가능
  - 게임 타입 선택 UI에 경마 옵션 추가
  - 경마 페이지로 이동하는 분기 구현

### 완벽하지 않은 부분 (알려진 이슈)

#### 1. 게임 시작 이슈 (중요)
- **문제**: 두 번째 플레이어 입장 시 말 선택 UI가 표시되지 않음
- **증상**:
  - 방 생성 시점(플레이어 1명)에만 `horseSelectionReady` 전송
  - 두 번째 플레이어 입장 후 재전송되지 않아 말 선택 불가
  - 결과적으로 시작 버튼이 활성화되지 않음
- **상태**: 부분 수정됨 (완전히 해결되지 않음)

#### 2. 방 생성/입장 흐름
- **문제**: 메인페이지에서 방 타입 선택 후 생성 즉시 입장하는 흐름이 완전히 구현되지 않음
- **요구사항**: 룰렛 입장 흐름 참고하여 동일하게 구현 필요
- **현재**: 경마 페이지로 이동은 되지만, 흐름이 룰렛과 완전히 일치하지 않음

#### 3. 루트 경로 접근
- **문제**: `localhost:3000` 루트에서 경마 게임 접근 불가
- **현재**: 직접 URL 입력 필요 (`/horse-race-multiplayer.html`)
- **향후 개선**: 루트 경로에서 게임 타입 선택 페이지 제공

#### 4. 애니메이션 동기화
- **가능성**: 서버와 클라이언트 간 애니메이션 타이밍 이슈 가능성
- **상태**: 기본 구현은 완료되었으나 완전히 테스트되지 않음

#### 5. 재경주 로직
- **상태**: 구현은 되어 있으나 완전히 테스트되지 않음
- **기능**: 당첨자가 2명 이상일 경우 재경주 진행

---

## 2. 게임 룰 및 플로우

### 기본 구조
- 주사위/룰렛 게임과 동일한 구조로 구현
- 준비/채팅/주문/순위 시스템 유지
- 게임 룰만 경마 방식으로 변경

### 게임 룰
- **말 수**: 4~6마리 랜덤 (서버에서 결정)
- **베팅 방식**: 1인 1말 선택 (포인트 없음)
- **경주 진행**: 자동 랜덤 (서버에서 순위 결정 후 애니메이션 재생)
- **최소 인원**: 2명 이상
- **게임 모드**: 'first' (1등 찾기) 또는 'last' (꼴등 찾기)

### 게임 플로우
1. 참가자들이 말 선택
2. 호스트가 "경마 시작" 버튼 클릭
3. 서버에서 말 수 결정 (4~6마리)
4. 각 참가자가 말 선택 (베팅)
5. 모든 참가자가 선택 완료 시 경주 시작
6. 서버에서 순위 결정 (랜덤)
7. 클라이언트에서 애니메이션 재생
8. 모든 말이 도착하면 순위 팝업 표시

---

## 3. 재경주 룰 및 구현 상태

### 재경주 룰 요구사항

#### 기본 규칙
1. **동점 발생 시**: 당첨자가 2명 이상일 경우 재경주 진행
2. **재경주 대상자**: 동점으로 당첨된 플레이어들만 재경주에 참여
3. **라운드 증가**: 재경주마다 `raceRound` 값이 1씩 증가
4. **호스트 제어**: 재경주 준비 및 시작은 호스트만 가능

#### 재경주 플로우
1. 경주 종료 후 당첨자 2명 이상 확인
2. 서버에서 `raceRound++`, `currentRoundPlayers = winners` 설정
3. 호스트에게 "재경주 준비" 버튼 표시 (`reraceReady` 이벤트)
4. 호스트가 "재경주 준비" 버튼 클릭 (`requestReraceReady`)
5. 재경주 대상자에게만 말 선택 UI 표시 (`horseSelectionReady` with `isRerace: true`)
6. 재경주 대상자들이 탈것 선택
7. 모든 재경주 대상자가 선택 완료 시 호스트에게 "재경주" 버튼 활성화
8. 호스트가 "재경주" 버튼 클릭 (`startRerace`)
9. 재경주 진행 (기존 경주와 동일한 로직)
10. 재경주 결과에 따라:
    - 당첨자 1명: 게임 종료, `raceRound = 1` 초기화
    - 당첨자 2명 이상: 다시 재경주 진행 (2-9 반복)

### 현재 구현된 부분

#### 서버 측 (`server.js`)
- ✅ 동점 감지 및 재경주 준비 상태 설정 (3436-3450줄 근처)
- ✅ `raceRound` 증가 및 `currentRoundPlayers` 설정 (3489-3490줄)
- ✅ 재경주 준비 버튼 핸들러 (`requestReraceReady`)
- ✅ 재경주 시작 핸들러 (`startRerace`, 3680-3852줄 근처)
- ✅ 재경주 대상자만 말 선택 가능하도록 필터링
- ✅ 재경주 시 탈것 타입 랜덤 재설정 (3657-3664줄)
- ✅ 재경주 기록 저장 (`horseRaceHistory`에 저장)
- ✅ 게임 종료 시 `raceRound = 1` 초기화 (3495-3498줄, 3878줄)

#### 클라이언트 측 (`horse-race-multiplayer.html`)
- ✅ 재경주 준비 버튼 표시 (3646-3658줄, 4394-4409줄)
- ✅ 재경주 상태 관리 (`isReraceActive` 변수)
- ✅ 재경주 대상자 필터링 (2232줄, 2240줄, 2295줄)
- ✅ 재경주 대상자가 아닌 사용자에게 안내 메시지 (2295-2297줄)
- ✅ 재경주 버튼 업데이트 로직 (`updateReraceButton`, 3677-3704줄)
- ✅ 재경주 라운드 번호 표시 (`raceRound` 변수 사용)

### 구현되지 않았거나 개선이 필요한 부분

- **재경주 연속 발생 처리**: 재경주에서도 동점 시 `reraceReady` 정상 발생·`raceRound` 증가 테스트 필요
- **재경주 비참가자 UI**: "관찰자 모드" 표시, 재경주 진행 현황 UI
- **재경주 라운드 번호 UI**: 말 선택/경주/결과 화면에 "재경주 N라운드" 명확 표시
- **재경주 중 새 플레이어 입장**: `currentRoundPlayers` 제외 및 안내 메시지 확인
- **재경주 기록 히스토리**: "2라운드 (재경주)" 등 표시, 그룹화
- **재경주 준비 상태 복구**: `roomJoined` 시 재경주 준비 상태 전송·호스트 버튼 표시 확인
- **재경주 중 게임 종료**: `endHorseRace`에서 `raceRound`·대상자 초기화 (이미 구현됨)
- **재경주 대상자 선택 완료 알림**: 모든 사용자에게 선택 완료·재경주 시작 알림

### 테스트 시나리오 (재경주)
- **기본 재경주**: 4명 참여 → 2명 동점 → 재경주 → 1명 당첨 → 종료
- **연속 재경주**: 재경주에서도 2명 동점 → 2차 재경주 → 1명 당첨 → 종료
- **재경주 중 새 플레이어 입장**: 재경주 준비 중 입장한 플레이어는 재경주 미참여
- **재경주 중 게임 종료**: 호스트가 종료 시 모든 상태 초기화

### 관련 코드 위치 (재경주)
- **서버**: `server.js` selectHorse 내 재경주 분기(3436-3450), requestReraceReady·startRerace·endHorseRace, 상태 필드(509-516줄)
- **클라이언트**: `horse-race-multiplayer.html` 재경주 버튼·필터링·상태 변수 (검색: `isReraceActive`, `updateReraceButton`, `reraceReady`)

---

## 4. 롤백 가이드

경마 게임 관련 코드를 제거하는 방법입니다.

### 제거할 파일
- `horse-race-multiplayer.html` (전체 파일 삭제)

### server.js에서 제거할 코드
(줄 번호는 참고용이며, `server.js` 변경 시 `grep`/검색으로 재확인하세요.)
1. **게임 상태 필드 (507-516줄)** `createRoomGameState()` 내 경마 관련: `horseRaceHistory`, `isHorseRaceActive`, `isReraceReady`, `availableHorses`, `userHorseBets`, `horseRankings`, `horseRaceMode`, `currentRoundPlayers`, `raceRound`
2. **roomCreated (1247-1321줄)** 경마일 때 `selectedVehicleTypes` 설정 및 말 선택 UI(`horseSelectionReady`) 분기 전체
3. **roomJoined** 경마 분기: 재연결 시 1470-1510줄, 새 사용자 입장 시 1674-1713줄
4. **updateGameRules (2394-2402줄)** 경마 모드(`horseRaceMode`) 업데이트 로직
5. **startHorseRace (3120-3308줄)** 핸들러 전체
6. **selectHorse (3311-3450줄)** 핸들러 전체
7. **calculateHorseRaceResult (3551-3585줄)** 함수 전체
8. **getWinnersByRule (3588줄~)** 함수 전체
9. **endHorseRace (3854-3918줄)** 핸들러 전체
10. **clearHorseRaceData (3920-3947줄)** 핸들러 전체 (선택)
11. **selectHorse 내부** 경주 종료·재경주 분기 (3436-3450줄)

### dice-game-multiplayer.html에서 제거할 코드
1. **게임 타입 선택 UI** `#horseRaceLabel`, `#horseRaceRadio` 및 관련 스타일·enable/disable 로직 (117-157줄, 1374-1375줄, 3221-3251줄, 3372-3383줄, 3443-3450줄)
2. **방 생성/입장 분기** `gameType === 'horse-race'`일 때 경마 페이지 이동 (2326줄, 2445-2452줄, 3372-3383줄, 3443-3450줄)

### Git 롤백
```bash
git log --oneline --grep="horse\|경마"   # 관련 커밋 확인
git revert <commit-hash>                 # 또는
git reset --hard <commit-hash>           # 주의: 변경사항 모두 삭제
```
수동 제거 후: `git add .` → `git commit -m "Remove horse race game implementation"`

### 주의사항
- 롤백 전 백업 권장. `server.js`는 용량이 크므로 제거 시 줄 번호 재확인. 제거 후 서버 재시작하여 오류 확인.

---

## 5. 스크롤링 구현 계획

### 개념
- **게임 스크롤링**: 화면은 고정되고, 배경·게임 요소가 움직이는 효과. 수평 스크롤링이 경마에 적합.
- **구현**: 컨테이너 `overflow-x: auto` + 내부 요소 위치 조절. 말 이동 시 `scrollLeft` 자동 갱신.

### 현재 구조
- `.race-track-container`: `width: 100%`, `height: 400px`, `overflow: visible` (현재 스크롤 없음)
- `.race-track`: `width: 100%` → 경주 시작 시 `width: ${finishLine + 100}px` 확장, `background-repeat: repeat-x`
- 말 위치: `startRaceAnimation` 내 `state.currentPos`, `state.horse.style.left`
- 스크롤 관련: `startPosition = 10px`, `centerPosition = trackWidth / 2`, `finishLine = trackWidth * 2 - 60`. 말이 `centerPosition` 도달 시부터 스크롤, 모든 말이 `finishLine` 도달 시 종료 (2884-2898줄)

### 구현 계획

#### CSS
- `.race-track-container`: `overflow-x: auto`, `overflow-y: hidden`, 필요 시 최대 너비 제한 (예: 게임 종료 버튼 크기)

#### JavaScript
- **getEndButtonWidth()**: `.end-button`의 `offsetWidth` 반환 (기본값 200)
- **updateTrackScroll(trackContainer, horsePosition, centerPosition)**: `horsePosition > centerPosition`일 때 `scrollLeft = horsePosition - centerPosition`, 그 외 0
- **startRaceAnimation 수정**: 컨테이너 최대 너비 설정, 애니메이션 루프에서 말 위치에 따라 스크롤 갱신 (리더 말 기준 권장)

#### 최적화
- 리더 추적, `scrollTo`/`requestAnimationFrame`으로 부드러운 스크롤, 업데이트 빈도 조절

### 구현 단계
1. CSS: `race-track-container`에 `overflow-x: auto`, 최대 너비, 스크롤바 스타일(선택)
2. `getEndButtonWidth()` 구현, 경주 시작 시 컨테이너 최대 너비 설정
3. `updateTrackScroll()` 구현, `startRaceAnimation`에서 호출 및 리더 추적
4. 다양한 해상도·성능 테스트

---

## 6. 참고 및 리소스

### 참고 파일
- `roulette-game-multiplayer.html`: UI 구조 참고
- `dice-game-multiplayer.html`: 순위 시스템 참고
- `server.js`: 룰렛 게임 핸들러 참고

### 리소스 스펙
- 말 애니메이션 스프라이트 (8프레임), 경기장 트랙 배경, UI 컴포넌트 등 상세 스펙은 **`HORSE_RESOURCES.md`** 참고.

### 향후 작업
1. 게임 시작 이슈 완전 해결
2. 방 생성/입장 흐름 룰렛과 동일하게 구현
3. 루트 경로 접근 개선
4. 애니메이션 동기화 테스트 및 개선
5. 재경주 로직 완전 테스트
