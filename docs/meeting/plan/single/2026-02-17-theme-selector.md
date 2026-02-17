# 사용자 테마 선택 기능 (localStorage 버전)

**작성일**: 2026-02-17
**작성자**: Claude Sonnet 4.5
**우선순위**: 낮음 (Phase 1 완료 후 진행)

---

## 1. 요구사항

### 배경
- Phase 1에서 CSS 변수 시스템 구축 완료
- 사용자가 로비에서 원하는 색상 테마를 선택할 수 있도록 함
- localStorage 기반으로 빠르게 구현 (나중에 DB 마이그레이션 가능)

### 목표
- 로비에 테마 선택 UI 추가
- 클릭 한 번으로 테마 변경
- 브라우저 새로고침해도 선택한 테마 유지
- 모바일/PC 디바이스별 독립 설정 (차후 DB 버전에서 구현)

---

## 2. 구현 범위

### 2.1 테마 프리셋 추가 (theme.css)
```css
/* 기본 테마 (현재) */
[data-theme="light"] { /* :root와 동일 */ }

/* 추가 테마 */
[data-theme="blue"] {
  --brand-primary: #3B82F6;
  --brand-secondary: #2563EB;
  --dice-500: #3B82F6;
  --dice-600: #2563EB;
}

[data-theme="green"] {
  --brand-primary: var(--green-500);
  --brand-secondary: var(--green-600);
  --dice-500: var(--green-500);
  --dice-600: var(--green-600);
}

[data-theme="pink"] {
  --brand-primary: #EC4899;
  --brand-secondary: #DB2777;
  --dice-500: #EC4899;
  --dice-600: #DB2777;
}

[data-theme="orange"] {
  --brand-primary: #F97316;
  --brand-secondary: #EA580C;
  --dice-500: #F97316;
  --dice-600: #EA580C;
}
```

### 2.2 테마 선택 UI (index.html)
```html
<!-- 로비 상단 또는 헤더에 추가 -->
<div class="theme-selector">
  <span>테마 선택:</span>
  <button class="theme-btn" data-theme="light" style="background: #667eea">보라</button>
  <button class="theme-btn" data-theme="blue" style="background: #3B82F6">파랑</button>
  <button class="theme-btn" data-theme="green" style="background: #28a745">초록</button>
  <button class="theme-btn" data-theme="pink" style="background: #EC4899">분홍</button>
  <button class="theme-btn" data-theme="orange" style="background: #F97316">주황</button>
</div>

<style>
.theme-selector {
  padding: 10px;
  text-align: center;
  background: var(--gray-100);
  border-radius: 8px;
  margin: 10px;
}

.theme-btn {
  width: 40px;
  height: 40px;
  border: 3px solid transparent;
  border-radius: 50%;
  cursor: pointer;
  margin: 0 5px;
  transition: border-color 0.2s;
}

.theme-btn:hover {
  border-color: var(--gray-700);
}

.theme-btn.active {
  border-color: var(--gray-900);
  box-shadow: 0 0 0 2px var(--bg-white);
}
</style>
```

### 2.3 테마 적용 JS (index.html)
```javascript
<script>
// 테마 변경 함수
function changeTheme(themeName) {
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('user-theme', themeName);

  // 버튼 활성화 상태 업데이트
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === themeName);
  });
}

// 페이지 로드 시 저장된 테마 적용
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('user-theme') || 'light';
  changeTheme(savedTheme);

  // 버튼 클릭 이벤트
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      changeTheme(btn.dataset.theme);
    });
  });
});
</script>
```

### 2.4 FOUC 스크립트 수정 (모든 HTML)
```javascript
<!-- 현재 -->
<script>
  (function() {
    document.documentElement.setAttribute('data-theme', 'light');
  })();
</script>

<!-- 수정 후 -->
<script>
  (function() {
    const theme = localStorage.getItem('user-theme') || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  })();
</script>
```

---

## 3. 수정 파일 목록

### 3.1 CSS
- `css/theme.css` - 테마 프리셋 추가 (5개)

### 3.2 HTML (FOUC 스크립트 수정)
- `index.html` - 테마 선택 UI 추가 + 스크립트 수정
- `dice-game-multiplayer.html` - 스크립트 수정
- `roulette-game-multiplayer.html` - 스크립트 수정
- `crane-game-multiplayer.html` - 스크립트 수정
- `horse-race-multiplayer.html` - 스크립트 수정
- 나머지 9개 HTML - 스크립트 수정

**총 14개 HTML 파일 수정**

---

## 4. 테스트 계획

### 4.1 기능 테스트
1. 로비에서 각 테마 버튼 클릭 → 즉시 색상 변경 확인
2. 브라우저 새로고침 → 선택한 테마 유지 확인
3. 다른 페이지 이동 → 테마 유지 확인
4. localStorage 삭제 → 기본 테마(보라) 복원 확인

### 4.2 브라우저 호환성
- Chrome, Firefox, Safari, Edge
- 모바일 브라우저 (iOS Safari, Chrome Android)

---

## 5. 차후 개선 사항 (DB 버전)

### 5.1 DB 마이그레이션
```sql
-- users 테이블에 컬럼 추가
ALTER TABLE users ADD COLUMN theme_desktop VARCHAR(20) DEFAULT 'light';
ALTER TABLE users ADD COLUMN theme_mobile VARCHAR(20) DEFAULT 'light';
```

### 5.2 서버 API
```javascript
// 테마 저장
socket.emit('saveUserTheme', { theme: 'blue', device: 'desktop' });

// 로그인 시 테마 불러오기
socket.on('userTheme', ({ desktop, mobile }) => {
  const device = isMobileDevice() ? mobile : desktop;
  changeTheme(device);
});
```

### 5.3 디바이스 감지
```javascript
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    || window.innerWidth <= 768;
}
```

---

## 6. 예상 작업 시간

- **localStorage 버전**: 30분
  - theme.css 수정: 5분
  - index.html UI 추가: 10분
  - 14개 HTML FOUC 스크립트 수정: 10분
  - 테스트: 5분

- **DB 버전 (차후)**: 1-2시간
  - DB 스키마 추가: 10분
  - 서버 API 구현: 30분
  - 클라이언트 수정: 20분
  - 디바이스 감지 로직: 20분
  - 마이그레이션 코드: 10분
  - 테스트: 30분

---

## 7. 참고사항

### 7.1 localStorage → DB 마이그레이션이 쉬운 이유
```javascript
// localStorage 버전
localStorage.setItem('user-theme', 'blue');
const theme = localStorage.getItem('user-theme');

// DB 버전 (거의 동일한 로직)
socket.emit('saveTheme', 'blue');
socket.on('loadTheme', (theme) => { /* ... */ });
```

함수 이름만 바뀌므로 마이그레이션이 매우 간단함.

### 7.2 Phase 1과의 관계
- Phase 1 (CSS 변수 시스템) 완료됨
- 이 기능은 Phase 1 기반 위에 추가되는 선택적 기능
- Gap Analysis 완료 후 진행 권장

---

**구현 추천 모델**: Sonnet 4.5
- 단순 반복 작업 (14개 HTML 수정)
- localStorage API 사용 (간단)
- CSS 추가 (패턴 반복)

**다음 단계**: Phase 1 Gap Analysis 완료 후 구현
