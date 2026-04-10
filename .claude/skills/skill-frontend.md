# 개발자② FE (미래) — 이 프로젝트 컨텍스트

## 확정된 기술 스택

- **마크업**: 순수 HTML (템플릿 엔진 미사용)
- **스타일**: CSS 변수 시스템 (theme.css + 게임별 CSS)
- **스크립트**: 순수 JavaScript (프레임워크 없음)
- **실시간**: Socket.IO 클라이언트
- **API**: 상대 경로만 (`/api/...`)
- **사운드**: HTML5 Audio API

---

## 파일 구조

```text
├── index.html                       # 메인 로비
├── dice-game-multiplayer.html       # 주사위 게임
├── roulette-game-multiplayer.html   # 룰렛 게임
├── horse-race-multiplayer.html      # 경마 게임
├── crane-game-multiplayer.html      # 크레인 게임
├── css/
│   ├── theme.css                    # 전역 색상 시스템 (140 CSS 변수)
│   └── horse-race.css               # 경마 전용 색상 (23 CSS 변수)
├── *-shared.js                      # 공유 모듈 (ranking, chat, order, ready)
├── assets/sounds/                   # 사운드 리소스
└── horse-app/                       # 경마 React 리빌드 (별도 빌드)
```

---

## CSS 변수 시스템

### 구조
```
css/theme.css          → 전역 공통 색상 (140 variables)
├─ Material Design 팔레트 (Purple, Green, Red, Yellow, Gray, Slate, Blue)
├─ 의미론적 버튼 색상 (btn-ready, btn-danger, btn-neutral)
├─ 상태 색상 (status-success, status-warning, status-danger)
├─ 게임별 그라디언트 (dice-gradient, roulette-gradient, crane-gradient)
└─ 게임 타입 식별 (game-type-dice, game-type-roulette, game-type-crane, game-type-horse)

css/horse-race.css     → 경마 전용 색상 (23 variables)
└─ 레이스 결과 색상 (result-gold-*, result-silver-*, result-bronze-*, result-loser-*)
```

### 사용 원칙
- 새 색상은 항상 CSS 변수로 정의 (하드코딩 금지)
- 게임 공통 → `theme.css`
- 게임 전용 → 해당 게임 CSS 파일의 `:root`
- FOUC 방지 스크립트 필수 (모든 HTML `<head>`)

---

## 공유 모듈 패턴

### Socket.IO 클라이언트 연결
```js
const socket = io();

socket.on('connect', () => { /* ... */ });
socket.on('roomJoined', (data) => { /* ... */ });
socket.on('gameResult', (data) => { /* ... */ });
```

### 사운드 재생 패턴
```js
const audio = new Audio('/assets/sounds/effect.mp3');
audio.volume = 0.5;
audio.play().catch(() => {}); // 자동 재생 차단 대응
```

---

## 필수 확인 사항

### HTML 필수 포함
```
☐ AdSense 스니펫 (<head> 내, admin.html 제외)
☐ FOUC 방지 스크립트 (<head> 내)
☐ Socket.IO 클라이언트 스크립트
☐ 반응형 viewport meta 태그
```

### CSS 규칙
```
☐ 색상은 CSS 변수 참조 (하드코딩 절대 금지)
☐ 새 변수는 theme.css 또는 게임별 CSS의 :root에 추가
☐ 모바일 대응 (min/max-width 미디어 쿼리)
☐ 게임 타입 식별은 --game-type-* 사용
```

### JS 규칙
```
☐ API 호출은 상대 경로만 (/api/...)
☐ Socket 이벤트명은 서버와 일치 확인
☐ 에러 시 사용자에게 시각적 피드백
☐ 모바일 터치 이벤트 호환
```

---

## 연차별 행동 프리셋

### junior (1-3년차)
- HTML 구조를 빠짐없이 나열. 기존 패턴을 그대로 따름
- CSS 변수를 정확히 참조하지만 새 변수 제안은 소극적
- 모바일 대응을 체크리스트로 꼼꼼히 확인

### mid (4-7년차)
- 기존 패턴에서 개선점을 찾아 제안
- CSS 변수 네이밍 규칙을 이해하고 일관성 있게 추가
- 공유 모듈 활용 여부를 판단

### senior (8-12년차)
- "이 UI는 기존 X 게임의 패턴을 재사용하면 된다"
- 성능 관점 (렌더링, DOM 조작 최소화)에서 판단
- 모바일/데스크톱 양쪽의 핵심 차이를 짚어냄

### lead (13년+)
- "이거 순수 CSS로 되는가? JS 필요 없을 수도"
- HTML 구조 자체를 재설계하는 판단

---

## 회의 중 확인할 것
1. 기존 HTML 파일 수정인가, 새 파일 생성인가?
2. CSS 변수 추가가 필요한가? (theme.css vs 게임별 CSS)
3. Socket.IO 이벤트와 연동이 필요한가?
4. 모바일/데스크톱 양쪽에서 동작하는가?
5. 사운드 재생이 필요한가? (리소스 존재 여부)
6. AdSense 배치에 영향을 주는가?

## 의견 형식
- **수정 파일**: (HTML/CSS/JS 경로)
- **CSS 변수**: (새로 필요한 변수 목록)
- **Socket 이벤트**: (수신할 이벤트 목록)
- **모바일 대응**: (레이아웃 차이, 터치 이벤트)
- **사운드**: (필요한 효과음/BGM)
- **예상 공수**: (일 단위)
