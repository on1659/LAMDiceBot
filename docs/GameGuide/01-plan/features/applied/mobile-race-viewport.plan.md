# 모바일 경마 시뮬레이션 화면 대응

## 문제 현상 (전체 목록)

### 치명적 (게임 불가능)
1. **컨테이너 화면 밖으로 사라짐**: `body.game-active .container`의 margin 계산이 1140px 기준 → 모바일(375px)에서 margin-left가 -222px
2. **히스토리 패널이 화면 전체 가림**: `position: fixed; width: 320px; z-index: 100` → 375px 화면의 85% 차지
3. **말 5마리 이상이면 레인 겹침**: 레인 높이 계산이 350px 하드코딩, 모바일 트랙은 300px
4. **터치 드래그**: PC에서는 안 되지만 모바일에서 경기 화면이 드래그됨 → 카메라 시스템 충돌
5. **결승선 안 보임**: 트랙 끝 버퍼 30px → 카메라가 결승선까지 따라가지 못함

### 심각 (기능 저하)
6. **실시간 순위 패널 읽기 불가**: 히스토리 패널(320px) 안에 있어 모바일에서 보이지 않음
7. **미니맵 화면 절반 차지**: `width: 180px` 고정 → 375px 화면의 48%, 글씨 9px로 읽기 불가
8. **카메라 전환 버튼 터치 불가**: 10px 폰트 + 2px 패딩 → 터치 타겟 ~25px (최소 44px 필요)
9. **말 선택 그리드 스크롤 필요**: 8마리 = 4행 x 2열 = 680px → 뷰포트(667px) 초과

### 성능/기타
10. **백그라운드 탭 디싱크**: `setInterval` 사용 → 모바일 백그라운드 탭에서 1000ms로 제한됨
11. **모바일 오디오 자동재생 실패**: iOS/Android 자동재생 차단, 에러 핸들링 없음
12. **날씨 효과 저사양 렉**: 파티클 애니메이션 + backdrop-filter 모바일 성능 저하
13. **핀치줌 가능**: viewport meta에 `user-scalable=no` 없음, 실수로 확대됨

---

## 원인 분석

### 1. 컨테이너 margin 문제 (css/horse-race.css:33-37)
```css
body.game-active .container {
    margin-left: calc((100vw - 1140px) / 2 + 160px);  /* 375px → -222px! */
    margin-right: auto;
    max-width: 800px;
}
```
1200px 미디어쿼리에서 리셋되지만, `.game-active` 상태에서의 모바일 처리가 없음

### 2. 히스토리 패널 (css/horse-race.css:988-1002)
```css
.history-section {
    position: fixed;
    right: 20px;
    top: 20px;
    width: 320px;
    max-height: calc(100vh - 40px);
    z-index: 100;
}
```
1200px 브레이크포인트에서 `position: static`으로 변경되지만, 768~1200px 구간 처리 없음

### 3. 레인 높이 하드코딩 (js/horse-race.js:494)
```javascript
const laneHeight = Math.min(75, Math.floor((350 - wallHeight * (horseCount - 1)) / horseCount));
```
350px 고정값 사용 → 모바일 트랙 높이(300px)와 불일치

### 4. 터치 드래그 (css/horse-race.css:294-309)
```css
.race-track-container {
    overflow-x: auto;          /* 터치 드래그 허용 */
}
```
`touch-action` 미사용, touch 이벤트 핸들러 없음

### 5. 트랙 끝 버퍼 (js/horse-race.js:1193)
```javascript
track.style.width = `${finishLine + 30}px`;  /* 버퍼 겨우 30px */
```
카메라가 결승선을 중앙에 놓으려면 뷰포트 절반(~175px) 필요

---

## 수정 방안

### 1. [필수] 컨테이너 모바일 margin 수정 (CSS)
```css
@media (max-width: 768px) {
    body.game-active .container {
        margin-left: auto;
        margin-right: auto;
        max-width: 100%;
        padding: 10px;
    }
}
```

### 2. [필수] 히스토리 패널 모바일 대응 (CSS)
```css
@media (max-width: 768px) {
    .history-section {
        position: static;
        width: 100%;
        max-height: 200px;
        z-index: auto;
    }
}
```

### 3. [필수] 레인 높이 동적 계산 (JS)
```javascript
// 350 하드코딩 → 실제 트랙 높이 사용
const trackHeight = trackContainer.offsetHeight || 400;
const laneHeight = Math.min(75, Math.floor((trackHeight - wallHeight * (horseCount - 1)) / horseCount));
```

### 4. [필수] 터치 드래그 방지 + 카메라 전환 (CSS + JS)
```css
.race-track-container {
    overflow-x: hidden;
    touch-action: pan-y;
}
```
```javascript
// scrollLeft → transform 전환
track.style.transform = `translateX(-${scrollAmount}px)`;
```

### 5. [필수] 결승선 가시성 확보 (JS)
```javascript
const viewportBuffer = Math.max(trackContainer.offsetWidth / 2, 200);
track.style.width = `${finishLine + viewportBuffer}px`;
```

### 6. [권장] 미니맵 모바일 축소/숨김 (CSS)
```css
@media (max-width: 768px) {
    #raceMinimap { display: none; }
}
```

### 7. [권장] 카메라 버튼 터치 타겟 확대 (CSS)
```css
@media (max-width: 768px) {
    #cameraSwitchBtn {
        min-width: 44px;
        min-height: 44px;
        font-size: 14px;
        padding: 8px 12px;
    }
}
```

### 8. [권장] 말 선택 그리드 모바일 최적화 (CSS)
```css
@media (max-width: 768px) {
    .horse-selection-grid {
        grid-template-columns: repeat(3, 1fr);  /* 2→3열로 높이 절약 */
    }
    .vehicle-card { padding: 10px; }
    .vehicle-emoji { font-size: 36px; }  /* 48→36px */
}
```

### 9. [선택] viewport meta 핀치줌 방지
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```

### 10. [선택] touch 이벤트 방지 보강 (JS)
```javascript
trackContainer.addEventListener('touchmove', (e) => {
    if (e.target.closest('.race-track')) {
        e.preventDefault();
    }
}, { passive: false });
```

---

## 구현 우선순위

| 순서 | 작업 | 등급 | 파일 |
|------|------|------|------|
| 1 | 컨테이너 모바일 margin 수정 | 필수 | css/horse-race.css |
| 2 | 히스토리 패널 모바일 대응 | 필수 | css/horse-race.css |
| 3 | 레인 높이 동적 계산 | 필수 | js/horse-race.js |
| 4 | overflow-x: hidden + touch-action | 필수 | css/horse-race.css |
| 5 | 카메라 scrollLeft → transform 전환 | 필수 | js/horse-race.js |
| 6 | 트랙 끝 버퍼 확대 | 필수 | js/horse-race.js |
| 7 | 미니맵 모바일 숨김 | 권장 | css/horse-race.css |
| 8 | 카메라 버튼 터치 타겟 | 권장 | css/horse-race.css |
| 9 | 선택 그리드 최적화 | 권장 | css/horse-race.css |
| 10 | viewport meta 핀치줌 방지 | 선택 | horse-race-multiplayer.html |

## 영향 범위
- `css/horse-race.css` — 컨테이너 margin, 히스토리 패널, overflow, 미디어쿼리 전반
- `js/horse-race.js` — 카메라 시스템, 레인 높이 계산, 트랙 버퍼
- `horse-race-multiplayer.html` — viewport meta

## 테스트 방법

### 환경 준비
- Chrome DevTools → Toggle Device Toolbar (Ctrl+Shift+M)
- 디바이스: iPhone SE (375x667), iPhone 12 (390x844), Galaxy S21 (360x800)
- 실제 모바일 기기 테스트 필수 (터치 이벤트 검증)

### TC-01: 컨테이너 표시 (치명적 #1)
1. 모바일 뷰포트(375px)에서 경마 방 입장
2. 게임 시작 (body.game-active 상태)
3. **확인**: 게임 컨테이너가 화면 중앙에 정상 표시되는지
4. **실패 조건**: 컨테이너가 왼쪽으로 밀려 안 보임

### TC-02: 히스토리 패널 (치명적 #2)
1. 모바일에서 게임 진행 중 상태
2. **확인**: 히스토리 패널이 트랙 아래에 위치하는지 (fixed가 아닌 static)
3. **확인**: 트랙 영역이 히스토리에 가려지지 않는지
4. **실패 조건**: 320px 패널이 화면 대부분을 가림

### TC-03: 레인 겹침 (치명적 #3)
1. 모바일에서 말 6마리 이상으로 경주 시작
2. **확인**: 모든 말이 겹치지 않고 각자 레인에 표시되는지
3. **확인**: 말 이름/라벨이 읽을 수 있는 크기인지
4. **실패 조건**: 말끼리 겹침, 레인 구분 불가

### TC-04: 터치 드래그 (치명적 #4)
1. 모바일에서 경주 진행 중
2. 트랙 영역을 좌우로 터치 드래그 시도
3. **확인**: 수동 스크롤이 안 되고, 카메라가 자동으로만 움직이는지
4. **확인**: 페이지 상하 스크롤은 정상 작동하는지
5. **실패 조건**: 트랙이 터치로 좌우 이동됨

### TC-05: 결승선 표시 (치명적 #5)
1. 모바일에서 경주 진행, 말이 결승선 근처 도착
2. **확인**: 결승선이 화면에 보이는지 (잘리지 않는지)
3. **확인**: 카메라가 결승선까지 정상 추적하는지
4. **실패 조건**: 결승선이 화면 밖에 있어 안 보임

### TC-06: 미니맵/카메라 버튼 (심각 #7, #8)
1. 모바일에서 경주 중
2. **확인**: 미니맵이 숨겨지거나 적절한 크기인지
3. **확인**: 카메라 전환 버튼이 손가락으로 터치 가능한 크기인지 (44px 이상)
4. **실패 조건**: 미니맵이 화면 절반 차지, 버튼 터치 불가

### TC-07: 말 선택 화면 (심각 #9)
1. 모바일에서 말 선택 화면 진입 (8마리)
2. **확인**: 모든 말이 과도한 스크롤 없이 보이는지
3. **확인**: 말 이모지/이름이 읽을 수 있는 크기인지
4. **실패 조건**: 절반 이상 스크롤해야 나머지 말 보임

### TC-08: 핀치줌 (기타 #13)
1. 모바일에서 게임 중 두 손가락으로 핀치줌 시도
2. **확인**: 화면이 확대되지 않는지
3. **실패 조건**: 실수로 화면 확대됨

### TC-09: PC 회귀 테스트
1. PC 브라우저(1920x1080)에서 경마 전체 플로우 테스트
2. **확인**: 기존 레이아웃, 카메라, 히스토리 패널 모두 정상
3. **확인**: 마우스 스크롤/클릭 기존대로 작동
4. **실패 조건**: PC에서 기존 동작이 깨짐

## 상태
- [ ] 구현 대기 중
- [ ] 테스트 완료
- [ ] 배포 완료
