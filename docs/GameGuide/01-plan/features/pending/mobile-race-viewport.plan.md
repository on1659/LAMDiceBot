# 모바일 경마 시뮬레이션 화면 대응

## 문제 현상
1. **화면 짤림**: 모바일에서 경마 시뮬레이션 화면이 제대로 표시되지 않음
2. **터치 드래그**: PC에서는 안 되지만 모바일에서 경기 화면이 드래그됨 → 카메라 시스템 충돌

## 원인 분석

### 핵심 원인: `overflow-x: auto` + 터치 방지 없음

| 항목 | 현재 상태 | 문제 |
|------|-----------|------|
| `.race-track-container` | `overflow-x: auto` | 모바일에서 터치 드래그로 수동 스크롤 가능 |
| `touch-action` CSS | 미사용 | 브라우저 기본 터치 동작 허용 |
| touch 이벤트 핸들러 | 없음 | `preventDefault()` 없음 |
| viewport meta | `initial-scale=1.0` | `user-scalable=no` 없음, 핀치줌 가능 |
| 트랙 너비 | 5000~10000px (거리에 따라) | 컨테이너 밖으로 크게 벗어남 |
| 카메라 시스템 | `scrollLeft` 기반 | 사용자 터치 스크롤과 충돌 |

### 관련 파일 구조

```
horse-race-multiplayer.html  ← viewport meta, 트랙 HTML 구조
css/horse-race.css           ← 트랙 컨테이너 스타일, 미디어쿼리
js/horse-race.js             ← 카메라 시스템, 트랙 렌더링, 애니메이션
```

### 현재 CSS (css/horse-race.css:294-309)
```css
.race-track-container {
    position: relative;
    width: 100%;
    height: 400px;
    overflow-x: auto;          /* ← 문제: 터치 드래그 허용 */
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
```

### 현재 모바일 대응 (css/horse-race.css:1360-1378)
```css
@media (max-width: 768px) {
    .race-track-container {
        height: 300px;          /* 400 → 300px 줄이기만 함 */
    }
}
```

## 수정 방안

### 1. 터치 드래그 방지 (CSS)
```css
.race-track-container {
    overflow-x: hidden;         /* auto → hidden */
    touch-action: pan-y;        /* 수직 스크롤만 허용, 수평 드래그 차단 */
}
```
- 카메라 시스템이 `scrollLeft`로 제어하므로 `overflow-x: hidden`이면 JS에서 직접 스크롤 불가
- 대안: `overflow-x: auto` 유지 + touch 이벤트 `preventDefault()`

### 2. 카메라 시스템 transform 전환 (권장)
현재 `scrollLeft` 기반 → CSS `transform: translateX()` 기반으로 전환
```javascript
// 현재: trackContainer.scrollLeft = scrollAmount;
// 변경: track.style.transform = `translateX(-${scrollAmount}px)`;
```
- `overflow-x: hidden`과 호환
- 모바일 GPU 가속으로 성능 향상
- 터치 드래그 문제 원천 차단

### 3. 모바일 뷰포트 최적화
```css
@media (max-width: 768px) {
    .race-track-container {
        height: 250px;
        margin: 10px 0;
        border-radius: 8px;
    }
    /* 말 레인 높이 축소 */
    /* 폰트/아이콘 크기 축소 */
    /* 미니맵 숨김 또는 축소 */
}
```

### 4. touch 이벤트 방지 (JS 보강)
```javascript
trackContainer.addEventListener('touchmove', (e) => {
    if (e.target.closest('.race-track')) {
        e.preventDefault();
    }
}, { passive: false });
```

## 구현 우선순위

1. **[필수]** `overflow-x: hidden` + `touch-action: pan-y` → 드래그 즉시 차단
2. **[필수]** 카메라 시스템 `scrollLeft` → `transform` 전환
3. **[권장]** 모바일 미디어쿼리 강화 (높이, 폰트, 레인 크기)
4. **[선택]** viewport meta에 `user-scalable=no` 추가

## 영향 범위
- `css/horse-race.css` — 컨테이너 overflow, touch-action, 미디어쿼리
- `js/horse-race.js` — 카메라 스크롤 로직 (scrollLeft → transform)
- `horse-race-multiplayer.html` — viewport meta (선택)

## 검증 방법
- 모바일 브라우저(Chrome/Safari)에서 경마 실행
- 경기 중 화면 터치 드래그 시도 → 드래그 안 됨 확인
- 카메라가 선두/내 말 정상 추적하는지 확인
- PC에서 기존 동작 변함없는지 확인

## 상태
- [ ] 구현 대기 중
- [ ] 테스트 완료
- [ ] 배포 완료
