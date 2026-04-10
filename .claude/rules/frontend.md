---
paths:
  - "*.html"
  - "pages/**"
  - "css/**"
  - "js/**"
---

# Frontend Rules

## HTML
- AdSense 스니펫 `<head>`에 포함 확인 (admin.html 제외)
- API 호출은 `/api/...` 상대 경로만 (도메인 하드코딩 금지)
- FOUC 방지 스크립트 `<head>`에 포함 확인

## CSS
- 새 색상은 반드시 CSS 변수로 정의 (하드코딩 금지)
- 게임 공통 색상 → `css/theme.css`
- 게임 전용 색상 → 해당 게임 CSS 파일의 `:root`

## 공유 JS (js/shared/*-shared.js)
- 공유 모듈은 `js/shared/` 디렉토리에 위치 (chat, ranking, order, ready, control-bar, countdown, page-history, server-select, tutorial)
- 수정 시 이 모듈을 import하는 HTML 파일 전체에 영향 — Grep으로 사용처 확인
- Socket emit/on 이벤트명 변경 시 서버(`socket/*.js`)도 검색
- init 시그니처 변경 시 `docs/GameGuide/system/SHARED-MODULES.md` 참조 — 모든 게임 HTML의 호출부 동기화 필수

## 보안
- 사용자 입력(닉네임, 메시지 등)을 `innerHTML`에 삽입 금지 — `textContent` 사용 또는 이스케이프 적용
- `innerHTML` 사용 시: 모든 동적 값이 하드코딩/상수인지 확인, 사용자 입력이면 이스케이프 필수

## 위험 패턴 (Node.js 문법 체크로 검출 불가 — Grep으로 수동 확인)

| 잘못된 코드 | 올바른 코드 |
|-------------|-------------|
| `document.hasAttribute()` | `document.documentElement.hasAttribute()` |
| `document.setAttribute()` | `document.documentElement.setAttribute()` |
| `document.style` | `document.body.style` |
| `document.classList` | `document.documentElement.classList` |
| `document.className` | `document.documentElement.className` |

JS/HTML 변경 후 Grep 필수:
```
grep -rn "document\.hasAttribute\|document\.setAttribute\|document\.style[^E]\|document\.classList\|document\.className" js/ pages/ *.html
```

## 검증
- HTML 변경: 브라우저에서 페이지 로드 확인 항목 제시
- 공유 JS 변경: 영향받는 HTML 목록과 확인 시나리오 제시
- Socket 연동 변경: 최소 2탭 테스트 시나리오 제시
