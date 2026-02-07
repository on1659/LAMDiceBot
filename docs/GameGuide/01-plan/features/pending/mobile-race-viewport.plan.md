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

## 검증 방법
- 모바일 브라우저(Chrome/Safari)에서 경마 실행
- `body.game-active` 상태에서 컨테이너 정상 표시 확인
- 히스토리 패널이 트랙을 가리지 않는지 확인
- 5마리 이상 경주 시 레인 겹침 없는지 확인
- 경기 중 터치 드래그 불가 확인
- 결승선 도착 시 결승선 화면에 표시 확인
- PC에서 기존 동작 변함없는지 확인

## 상태
- [ ] 구현 대기 중
- [ ] 테스트 완료
- [ ] 배포 완료
