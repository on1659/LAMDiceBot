# 경마 게임 스크롤링 구현 계획

## 1. 스크롤링 개념 이해

### 게임 스크롤링이란?
- 게임 화면이 고정되어 있고, 배경이나 게임 요소가 움직이는 효과
- 플레이어의 시야를 따라가면서 게임 진행 상황을 보여주는 방식
- 수평 스크롤링: 좌우로 움직이는 스크롤 (경마 게임에 적합)

### 구현 방식
1. **컨테이너 스크롤 방식**: 컨테이너에 `overflow-x: auto`를 설정하고, 내부 요소의 위치를 조절하여 스크롤 발생
2. **자동 스크롤**: 말이 움직일 때 컨테이너의 `scrollLeft`를 자동으로 업데이트하여 시야를 따라가게 함

## 2. 현재 구조 분석

### 현재 상태
- `.race-track-container`: 트랙을 감싸는 컨테이너
  - `width: 100%`
  - `height: 400px`
  - `overflow: visible` (현재 스크롤 없음)
  
- `.race-track`: 실제 트랙 배경
  - `width: 100%` (기본)
  - `background-repeat: repeat-x` (배경 이미지 반복)
  - 경주 시작 시 `width: ${finishLine + 100}px`로 확장됨

- `.end-button`: 게임 종료 버튼
  - `padding: 15px 30px`
  - `font-size: 16px`
  - 예상 크기: 약 150-200px (텍스트 + 패딩)

### 말 위치 업데이트 로직
- `startRaceAnimation` 함수에서 경주 애니메이션 처리
- `state.currentPos`로 말의 현재 위치 관리
- `state.horse.style.left = ${state.currentPos}px`로 DOM 업데이트
- 배경 스크롤은 이미 일부 구현됨 (2884-2894줄)

### 스크롤링 위치 정보
- **시작 위치**: `startPosition = 10px` - 말이 경주를 시작하는 위치
- **중앙 위치**: `centerPosition = trackWidth / 2` - 화면 가운데 위치
- **종료 위치**: `finishLine = trackWidth * 2 - 60` - 결승선 위치
- **스크롤 시작 조건**: 말이 `centerPosition`에 도달했을 때부터 스크롤 시작 (2887줄)
- **스크롤 종료 조건**: 모든 말이 `finishLine`에 도착했을 때 (2898줄)

## 3. 구현 계획

### 3.1 CSS 수정
1. **race-track-container 스타일 변경**
   ```css
   .race-track-container {
       overflow-x: auto;  /* 가로 스크롤 활성화 */
       overflow-y: hidden; /* 세로 스크롤 방지 */
       max-width: [게임 종료 버튼 크기]; /* 최대 너비 제한 */
   }
   ```

2. **race-track 스타일 유지**
   - 현재 구조 유지 (동적 width 확장)
   - 배경 이미지 반복 유지

### 3.2 JavaScript 로직 추가

1. **게임 종료 버튼 크기 계산**
   ```javascript
   function getEndButtonWidth() {
       const endButton = document.querySelector('.end-button');
       if (endButton) {
           return endButton.offsetWidth;
       }
       return 200; // 기본값
   }
   ```

2. **자동 스크롤 함수**
   ```javascript
   function updateTrackScroll(trackContainer, horsePosition, centerPosition) {
       // 말이 중앙을 넘어가면 스크롤 시작
       // centerPosition = trackWidth / 2 (화면 가운데)
       if (horsePosition > centerPosition) {
           const scrollAmount = horsePosition - centerPosition;
           trackContainer.scrollLeft = scrollAmount;
       } else {
           // 말이 중앙에 도달하기 전에는 스크롤하지 않음
           trackContainer.scrollLeft = 0;
       }
   }
   ```
   
   **스크롤 범위**:
   - 시작: `centerPosition` (trackWidth / 2) - 첫 번째 말이 화면 가운데 도달 시
   - 종료: `finishLine` (trackWidth * 2 - 60) - 모든 말이 결승선 도착 시

3. **startRaceAnimation 함수 수정**
   - 경주 시작 시 컨테이너 최대 너비 설정
   - 애니메이션 루프에서 말 위치에 따라 스크롤 업데이트
   - 모든 말의 위치를 고려하여 최적의 스크롤 위치 계산

### 3.3 스크롤 최적화

1. **리더 추적**: 가장 앞서가는 말을 중심으로 스크롤
2. **부드러운 스크롤**: `scrollTo` 또는 `requestAnimationFrame` 사용
3. **성능 최적화**: 스크롤 업데이트 빈도 조절 (매 프레임이 아닌 일정 간격)

## 4. 구현 단계

### 단계 1: CSS 기본 설정
- [ ] race-track-container에 overflow-x: auto 추가
- [ ] 최대 너비를 게임 종료 버튼 크기로 제한
- [ ] 스크롤바 스타일링 (선택사항)

### 단계 2: 버튼 크기 계산 함수
- [ ] getEndButtonWidth() 함수 구현
- [ ] 경주 시작 시 컨테이너 최대 너비 설정

### 단계 3: 자동 스크롤 로직
- [ ] updateTrackScroll() 함수 구현
- [ ] startRaceAnimation에서 스크롤 업데이트 호출
- [ ] 리더 말 추적 로직 추가

### 단계 4: 테스트 및 최적화
- [ ] 다양한 화면 크기에서 테스트
- [ ] 스크롤 부드러움 확인
- [ ] 성능 최적화

## 5. 예상 결과

- 경주 중 말이 움직일 때 트랙이 자동으로 스크롤됨
- 스크롤 영역의 최대 너비가 게임 종료 버튼 크기로 제한됨
- 사용자는 항상 경주 진행 상황을 명확하게 볼 수 있음
- 부드러운 스크롤 애니메이션으로 사용자 경험 향상
