# LAMDiceBot 팀 회의록 (Single)

**일시**: 2026-02-18
**주제**: 흰색 배경에 흰색 글씨 input 문제 전수조사 및 수정
**참석자 (관점)**:
- 기획팀: 기획 팀장
- 개발팀: 개발 팀장, 개발 사원
- 디자인팀: UI/UX 디자이너
- 품질팀: QA 엔지니어
**회의 방식**: 1인 순차 분석 (경량 버전)
**게임 대상**: 주사위 / 룰렛 / 경마 / 인형뽑기 / 건의사항 (공통)

---

## 1. 현황 요약

### 문제점

브라우저 다크 모드(크롬 등) 또는 시스템 테마 설정에 따라 `<input>` 요소의 기본 텍스트 색상이 흰색으로 렌더링됨. CSS에서 `color` 속성을 명시하지 않아 **흰색 배경 위에 흰색 글씨**가 되어 텍스트가 안 보이는 현상 발생.

### 영향 범위

- 비밀번호 모달 (인형뽑기, 룰렛, 경마)
- 방 이름 수정 input (인형뽑기, 룰렛, 경마 — JS 동적 생성)
- 주사위 방 만들기/설정 모달의 input들
- 건의사항 페이지 폼 input들

---

## 2. 전수조사 결과

### CSS input 규칙에 `color` 속성 누락 (6곳)

| 파일 | 라인 | 셀렉터 |
|------|------|--------|
| `dice-game-multiplayer.html` | 348 | `input[type="text"], input[type="number"], textarea` |
| `crane-game-multiplayer.html` | 107 | `input[type="text"], input[type="password"]` |
| `roulette-game-multiplayer.html` | 107 | `input[type="text"], input[type="password"]` |
| `css/horse-race.css` | 133 | `input[type="text"], input[type="password"]` |
| `contact.html` | 80 | `.board-form input, .board-form textarea` |
| `contact.html` | 197 | `.modal-content input[type="password"]` |

### JS 동적 생성 input에 `color` 속성 누락 (3곳)

방 이름 수정 시 동적 생성하는 input에 `background: var(--bg-white)` 설정하면서 `color` 미지정:

| 파일 | 라인 | 용도 |
|------|------|------|
| `crane-game-multiplayer.html` | 1233 | 방 이름 수정 input |
| `roulette-game-multiplayer.html` | 1089 | 방 이름 수정 input |
| `horse-race-multiplayer.html` | 520 | 방 이름 수정 input |

### 추가 발견

- `dice-game-multiplayer.html`의 CSS 셀렉터에 `input[type="password"]`가 빠져있음 (비밀번호 입력 필드 스타일 미적용)

### 3차 재검토 (추가 발견)

| 유형 | 파일 | 라인 | 내용 | 심각도 |
|------|------|------|------|--------|
| 인라인 color 리셋 | `dice-game-multiplayer.html` | 1488 | `label.style.background = 'white'` + `label.style.color = ''` (라디오 버튼 레이블) | 낮음 — label은 input이 아니므로 전역 규칙 무관, 브라우저 기본 color(검정) 상속 |
| 하드코딩 white | `horse-race-multiplayer.html` | 282, 346, 424 | `background: white` (모달 컨테이너) | 낮음 — 내부 텍스트에 `color: rgb(17,24,39)` 명시됨, 가독성 OK. 일관성만 문제 |

→ input 흰글씨 문제와 직접 관련 없는 항목이므로 이번 수정 범위에서 제외. 향후 일관성 정리 시 처리 가능.

---

## 3. 결정사항

1. ~~개별 파일 CSS 규칙 수정~~ → **theme.css에 전역 `input, select, textarea` 규칙 추가** (더 간단하고 미래 대비)
2. JS 동적 생성 input의 `style.cssText`에도 `color: var(--text-primary)` 추가 (인라인이 CSS를 덮어쓰므로 필수)

---

## 4. 리스크/주의사항

- `var(--text-primary)` = `var(--gray-900)` = `#212121` — 충분히 어두운 색상이므로 가독성 문제 없음
- `var(--bg-white)` = `#ffffff` — 명시적으로 지정하면 브라우저 다크 모드에서도 강제 적용됨
- 기존 동작에 영향 없음 (현재도 라이트 모드에서는 동일하게 보임)
- CSS specificity: 각 HTML `<style>` 블록의 `input[type="text"]` 등은 `color`/`background`를 선언하지 않으므로 theme.css 전역 값이 cascade에서 유지됨 (충돌 없음)

---

## 5. 구현 문서

→ [impl 문서](../../impl/2026-02-18-input-color-fix-impl.md)

**구현 추천 모델**: Sonnet (파일/위치/속성 모두 구체적, 단순 속성 추가 작업)
