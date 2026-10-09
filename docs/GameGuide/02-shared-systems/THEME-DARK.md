# 화면 스킨 · 다크 테마 가이드

다크 테마를 만들거나, 새 화면·게임에 다크 대응을 넣거나, 스킨을 추가할 때 이 문서를 먼저 읽는다.
2026-10-01~03 다크 스킨 도입 작업에서 정한 규칙과 실제로 겪은 함정을 모았다.
(명세: [`docs/goal/applied/dark-mode-skin-picker.md`](../../goal/applied/dark-mode-skin-picker.md), 함정 상세: [lessons C-47~C-53](../lessons/_common.md))

---

## 1. 구조

```
<html data-theme="light|dark" data-skin="스킨 id">
         │                     │
         │                     └─ 다크 안에서 바탕 톤만 다른 변형 (dark / black / midnight / mocha / purple)
         └─ 색 규칙의 큰 갈래. 모든 다크 규칙은 [data-theme="dark"] 에 건다
```

| 파일 | 역할 |
|------|------|
| `js/shared/theme-shared.js` | 스킨 결정·적용, 선택 버튼(해/달 아이콘 → 목록), `themechange` 이벤트 |
| `css/theme.css` `:root` | 라이트 토큰 (= 원래 값) |
| `css/theme.css` `[data-theme="dark"]` | 다크 토큰 + 게임 방 무채화 규칙 + 공통 바닥 |
| `css/theme.css` `[data-theme="dark"][data-skin="…"]` | 스킨별 표면·테두리·바닥만 갈아 끼움 |
| 각 게임 CSS / 페이지 `<style>` 의 `[data-theme="dark"]` | 게임 전용 토큰의 다크 값 |

- **로드 순서**: 모든 페이지 `<head>`에서 `<script src="/js/shared/theme-shared.js"></script>`를 `theme.css`보다 **먼저, 동기로**. 첫 페인트 전에 속성을 정해 깜빡임을 막는다.
- **스킨 결정**: `localStorage.lamdiceTheme`(스킨 id) → 없으면 기기 설정(`prefers-color-scheme` → `light` 또는 `dark`).
- **선택 버튼 자리**: 정적 마크업은 `<span data-theme-switcher></span>`만 두면 자동으로 붙는다. 동적으로 그리는 곳은 `ThemeModule.mount(el)` — 컨트롤 바(`#themeSwitcherMount`), 서버 선택 화면(`#ss-theme-switcher`).
- **API**: `ThemeModule.get()` / `set(id)` / `mount(el)`, `document`의 `themechange` 이벤트(`detail.theme` = light|dark, `detail.skin` = id). 캔버스처럼 CSS 변수를 읽어 직접 그리는 코드는 이 이벤트에서 다시 그린다.
- **제외**: 미사용 게임(다리건너기·해적·회전칼날)은 `theme-shared.js`를 싣지 않아 계속 라이트.

---

## 2. 색 원칙 (레퍼런스 조사 결과)

2026-10-02 조사: 디자인 시스템 8종(Material·Apple·GitHub Primer·Fluent·Carbon·Atlassian·Radix·Tailwind) 공식 토큰 + 서비스 24곳 + 게임·파티 사이트 약 58곳 실측.

| 항목 | 기준 | 우리 값 (기본 다크) |
|------|------|------|
| 페이지 바닥 | L\* 4~8 (대부분 L\* 4~7) | `#141413` L\* 6 (게임은 같은 명도에 게임 색조만) |
| 바닥 → 카드 계단 | L\* 4~6 이상 | 카드 `#262624` L\* 15 |
| 표면 단계 | 높을수록 밝게, 한 단계 ΔL\* 3~5, 최고 L\* 25 이하 | 꺼진 면 `#1f1e1d` · 카드 `#262624` · 올라온 면 `#30302e` · `#3a3a37` |
| 본문 글자 | 대비 10~17:1, 순백보다 살짝 낮춘 흰색 | `#faf9f5` (14:1) |
| 보조 글자 | 6~11:1 | `#c2c0b6` · `#a6a39a` · `#9c9a92` |
| 장식 테두리 | 면 대비 1.3~2.0:1 | `#4a4944` (1.7:1) |
| 색 버튼 위 흰 글자 | 4.5:1 이상 (주요 서비스는 4.6~5.0) | 4.9~5.9:1 |
| 강조색 채도 | 밝고 **채도 낮은** 톤 (원색은 "떨려" 보임) | HSL S 25~60% |
| 상태 틴트 배경 | 표면보다 L\* +5~8, 저채도 | L\* 17~22 |

**사용자가 정한 것 (2026-10-02~03)**
- 기본 다크 = **따뜻한 무채색 회색** (Claude 앱 다크와 같은 계열). 남색 기 차콜은 폐기, 파란 계열은 미드나잇 스킨이 맡는다.
- **형광 금지**: 라이트의 원색(형광 노랑 `#ffc107`, 쨍한 보라·초록·빨강)을 다크에 그대로 두면 "야광 같아 눈이 아프다". 다크 강조색은 전부 채도를 낮춘다.
- **크롬은 무채, 색은 액센트만**: 섹션마다 게임 색 테두리·노랑 그라디언트 상자·갈색 종이를 깔면 "색감이 다크랑 안 맞는다". 게임 색은 이름표·주요 버튼·선택 상태에만.
- 게임 그림(트랙·맵·룰렛판·스프라이트·사다리 보드)은 스킨과 무관하게 그대로. 단 너무 밝은 종이(사다리 보드)는 한 톤 낮춘다.

---

## 3. 토큰 쓰는 법 — 이것만 지키면 대부분 맞는다

### 3-1. 뒤집히는 토큰 vs 고정 토큰

다크에서 **뒤집히는** 토큰: `--bg-white`(카드 면), `--text-primary/secondary/tertiary/muted`, `--gray-50~900`, `--panel-primary`, `--border-color`.
이걸 "흰색·검정"이라는 뜻으로 쓰면 다크에서 깨진다.

| 하고 싶은 것 | 쓸 토큰 | 쓰면 안 되는 것 |
|------|------|------|
| 카드·패널 면 | `--bg-white` | `white`, `#fff` |
| 색 버튼·그라디언트 위 흰 글자 | `--text-on-accent` (늘 `#fff`) | `color: var(--bg-white)` ← 다크에서 어두운 글자가 됨 |
| 노랑·금색 위 글자 | `--text-on-light` (늘 `#212529`) | `--text-primary`, `--gray-900` |
| 그림(돌림판 선·결과 카드 글자 등) | 게임 전용 **리터럴** 고정 토큰 | `--gray-800` 등 뒤집히는 토큰, 그걸 참조하는 로컬 토큰 |
| "늘 어두운" 패널(중계 판 등) 안 | 리터럴 고정값 | `--gray-900` (다크에서 밝아짐) |

### 3-2. 버튼 바탕 vs 강조 글자 — 반드시 분리

한 색으로 "카드 위 강조 글자"와 "흰 글자 버튼 바탕"을 둘 다 만족시킬 수 없다(밝아야 읽히고 진해야 흰 글자가 올라간다). 그래서 나눴다.

| 용도 | 토큰 | 다크 값 |
|------|------|------|
| 강조 글자·테두리 | `--purple-500`, `--dice-accent`, `--green-500`, `--red-500`, `--red-400`, `--roulette-500`, `--link-brand`, `--heading-brand` | 밝고 채도 낮은 톤 (카드 위 약 6:1) |
| 흰 글자 버튼·배지 바탕 | `--fill-brand`, `--fill-success`(-light), `--fill-danger`(-soft), `--fill-help`, `--fill-ready-end`, `--btn-ready/-start/-danger`(-hover/-active), `--btn-neutral` | 진하고 채도 낮은 톤 (흰 글자 4.9~5.9:1) |

- 라이트에서는 `--fill-*`가 팔레트 500과 **같은 값의 별칭**이라 라이트 화면은 그대로다.
- `background`에 팔레트 500을 직접 쓰지 말 것. 반대로 `color`·`border`에 `--fill-*`/`--btn-*`를 쓰지 말 것.
- 경마 CSS를 빌려 쓰는 게임(사다리·데구리)은 `--horse-500/600`이 "흰 글자 바탕", `--horse-accent`·`--horse-ink`가 "글자"다. 그 게임 CSS 다크 블록에서 `--horse-500/600`만 진하게 다시 정한다(alias 뒤에 와야 이긴다).

### 3-3. 새 색을 만들 때

1. `:root`에 라이트 값, `[data-theme="dark"]`에 다크 값을 **같이** 정한다.
2. 라이트 값은 절대 바꾸지 않는다. 리터럴을 토큰으로 바꿀 땐 토큰의 라이트 값 = 원래 리터럴.
3. 다크 값 체크: 채도 HSL S ≤ 60%, 글자면 카드(`#262624`)·올라온 면(`#30302e`) 위 4.5:1 이상, 바탕이면 흰 글자 4.5:1 이상.
4. 공통 색 → `css/theme.css`, 게임 전용 → 그 게임 CSS(또는 페이지 `<style>`)의 `:root` + `[data-theme="dark"]`.
5. `var(--없는토큰, 대체값)` 금지 — 대체값이 라이트 전용이면 다크에서 조용히 깨진다(`--bg-subtle` 사례). `grep -rn "^\s*--이름:" css/ *.html`로 정의 확인.

---

## 4. 게임 방 화면 규칙 (`css/theme.css` "게임 방 화면 차분하게" 블록)

다크에서 아래는 무채로 덮는다. 새 게임도 같은 클래스를 쓰면 자동 적용.

| 대상 | 다크 처리 |
|------|------|
| `.host-controls`, `.room-expiry-section` | 면 `--gray-100`, 테두리 `--border-color` |
| `.ready-section`, `.chat-section`, `.horse-selection-section`, `.horse-selection-button`, `.rank-vote-section:not(.on-canvas)`, `.rank-vote-box:not(.selected)`, `#deguriPickSection`, `.ladder-lane-btn`(선택·당첨 제외) | 테두리 `--border-color` |
| `.users-list`, 미선택 목록(`#notSelectedVehicleSection`, `#notPickedSection`) | 면 `--gray-100` |
| `.users-title`, `.container h2/h3` 밑줄 | `--border-color` |
| `#startOrderButton` (주문받기 시작) | 중립 버튼 `--btn-neutral` |
| 경마 트랙 칩 선택 | 형광 노랑 → `--gray-300` |
| 예약·랭킹·상점 버튼 테두리 | `--border-color` |
| 알림·확인 창 (`#customAlert`, `#customConfirm`, `#playerActionDialog`, `#deguriPlayerActionDialog`, 경마 `#confirmOk/#confirmCancel`) | 상자 무채 테두리, 확인 = `--fill-brand`, 취소 = `--btn-neutral`, 포커스 링 `--purple-500`. 종류(경고·오류·성공)는 아이콘이 알려 준다 — 노랑·빨강 상자/버튼 금지 |

- 인라인 `style`로 색을 주는 요소는 다크 전용 `!important`로만 덮인다. 새 코드는 인라인 색 대신 클래스+토큰으로.
- 데구리 나무·종이 재질(`--deguri-paper/cream/wood-*`)은 다크에서 무채 면으로 매핑돼 있다.
- 남겨 두는 색: 이름표(`.user-tag`), 주요 버튼(경주 시작·준비), 선택 상태, 게임 그림, 로컬 전용 디버그 로그.

---

## 5. 다크 규칙이 닿지 않는 곳

| 경우 | 해법 |
|------|------|
| **Shadow DOM** (튜토리얼 툴팁) | 커스텀 속성은 호스트를 통해 상속된다 → 안쪽에서 `var(--tutorial-*)`를 예비값 없이 쓰고, 값은 theme.css에만 둔다(모든 페이지가 theme.css를 싣는다) |
| **인라인 style만 쓰는 모듈** (채팅·주문·랭킹·서버 선택·초대) | 인라인에서 `var(--chat-*)` 등 토큰만 참조하고, 토큰 정의는 theme.css `common` 섹션에 있다(모듈 안에 색 리터럴·토큰 정의를 두지 않는다) |
| **광고 iframe** | 페이지가 `color-scheme: dark`면 투명 iframe 뒤에 흰 바탕이 깔린다 → 채워지지 않은 칸만 `color-scheme: light` (`.ad-container ins.adsbygoogle:not([data-ad-status="filled"])`) |
| **호스트 페이지 전역 `button` 규칙** (C-42) | 공유 팝업의 버튼은 `width·margin·padding·background·color·min-width/min-height`를 전부 명시 |
| **Tailwind CDN preflight** (경마·사다리·데구리) | 전역 `button` 바탕이 지워진다 — CSS 파일만 보고 판단하지 말고 `getComputedStyle`로 확인 |
| **같은 UI를 두 곳에서 그림** (채팅 반응 칩: 페이지 + chat-shared) | 색을 바꾸기 전에 그리는 곳을 전부 grep |

---

## 5-1. 하드코딩 색 금지 (2026-10-03 전체 정리 완료)

화면 UI에 색 리터럴(`#hex`, `rgb()/rgba()`, `white`/`black` 같은 이름 색)을 직접 쓰지 않는다. **모든 색은 `css/theme.css`의 토큰**이다.

- **토큰 위치**: `css/theme.css` 안 그룹별 섹션 — `[tokens:<그룹>:light]`(`:root`)와 `[tokens:<그룹>:dark]`(`[data-theme="dark"]`)가 짝이다. 그룹: `common`(공유 모듈·free·여러 게임 공통), `pages`(홈·관리자·안내), `shop`(꾸미기 상점 셸), `dice`, `roulette`, `horse`, `ladder`, `deguri`.
- **새 색이 필요하면**: ① 라이트 값이 같은 기존 토큰이 있는지 먼저 찾고 ② 없으면 해당 그룹 섹션에 `--<그룹>-<무엇>-<역할>` 이름으로 라이트·다크 **둘 다** 추가한다. 여러 게임이 쓰면 `common`에 하나만(`--alert-*`, `--bg-subtle`, `--order-star-idle` 처럼).
- **게임 CSS·페이지 `:root`에 색 토큰을 다시 정의하지 말 것.** theme.css보다 뒤에 로드돼 같은 우선순위로 다크 값까지 라이트로 덮는다(free.css `--dice-gradient` 사례). 게임 CSS에는 `--horse-500: var(--ladder-fill)` 같은 **별칭만** 둔다.
- **반투명 색**: `rgba(var(--shadow-rgb), a)`(검정 그림자), `rgba(var(--highlight-rgb), a)`(흰 광택), 그 밖은 `--<이름>-rgb: r, g, b` 토큰 + `rgba(var(--<이름>-rgb), a)`. hex 뒤에 투명도를 붙이는 `${color}15` 꼴 금지.
- **`var(--x, 예비값)` 금지** — 토큰이 정의돼 있으면 예비값은 필요 없고, 정의가 없으면 예비값이 조용히 라이트 값으로 굳는다(`--bg-subtle`·`--horse-100` 사례). 
- **JS에서 색을 고를 때**: `'var(--alert-error)'`처럼 토큰 문자열을 넣는다.
- **예외(리터럴 허용)**: 게임 그림·연출 — 캔버스 그리기(`ctx.fillStyle` 등), 스프라이트·SVG 그림(`js/horse-race-sprites.js`, `js/horse-race-fall-motion.js`), 트랙 하늘·잔디·결승선·날씨·이펙트, 룰렛 판 칸 팔레트, 사다리·데구리 캔버스, 색종이·메달, 꾸미기 아이템 그림. 그리고 로컬 전용 디버그 로그(`console.log` 스타일 포함), CSS `mask`처럼 색이 화면에 안 나오는 값, 미사용 게임(다리건너기·해적·회전칼날).
- **점검 — `/summit` 이 커밋 전에 자동으로 돌린다** (훅 아님). 기준선(`AutoTest/hardcoded-colors-baseline.json`, 2026-10-05 기준 4,679개 — 전부 위 예외)에 없는 **새 리터럴만** 잡는다. 기준선은 줄 번호가 아니라 줄 내용으로 맞추므로 다른 줄을 고쳐도 오탐이 안 난다.

```bash
node AutoTest/check-hardcoded-colors.js                  # 새 하드코딩 있으면 목록 + exit 1
node AutoTest/check-hardcoded-colors.js --list           # 기준선 포함 전체
node AutoTest/check-hardcoded-colors.js --update-baseline  # 게임 그림 예외를 새로 남길 때만
```
UI 색이 걸리면 기준선에 넣지 말고 토큰으로 바꾼다.

---

## 6. 스킨 추가하기

1. `js/shared/theme-shared.js`의 `THEMES`에 한 줄: `{ id, mode: 'dark', label, desc }`
2. `css/theme.css`에 `[data-theme="dark"][data-skin="id"]` 블록 — 표면(`--gray-50/100/200/300`, `--bg-white`, `--panel-primary`), 바닥(`--dark-ground-page`, `--dark-ground-<게임>`), **브랜드 강조색**(아래), 중립 버튼(`--btn-neutral`·`-hover`·`-active`, 스킨 색조).
   - 브랜드 강조색 = 보라 계열 토큰 전체: `--purple-50~900`, `--dice-50/500/600/700`, `--dice-500-rgb`, `--dice-accent-bg/-light`, `--fill-brand`, `--fill-help`, `--brand-gradient`, `--dice-gradient`, `--link-brand`(-light/-border), `--heading-brand`. 확인 버튼·링크·선택 표시·포커스 링이 스킨을 따라간다.
   - 규칙: 500(글자)은 카드·올라온 면 위 5:1 이상·채도 S ≤ 60%, 600(=`--fill-brand`, 흰 글자 바탕)은 흰 글자 5:1 이상, 50~200은 틴트 면, 700~900은 밝은 글자.
   - 성공(초록)·위험(빨강)·노랑과 게임별 색(룰렛·경마·사다리·데구리)은 스킨과 무관하게 공유.
3. 미리보기 칸: `--theme-swatch-<id>` + `.theme-switcher-swatch-<id>`.
4. **조건**: 면 밝기가 기본 다크 이하(카드 L\* ≤ 15, 올라온 면 L\* ≤ 20) — 그래야 글자·강조색을 공유해도 대비가 유지된다. 표면 채도도 낮게(카드 HSL S 40% 안팎 이하).
5. 페이지·게임 CSS에서 `data-skin`으로 분기하지 않는다. 스킨 차이는 토큰 블록이 전부 맡는다. 그래서 버튼·링크에 보라 리터럴(`#667eea` 등)을 박으면 스킨을 안 따라간다 — 반드시 토큰으로.

| 스킨 | 카드 | 성격 | 버튼(`--fill-brand`) / 강조 글자(`--purple-500`) |
|------|------|------|------|
| light | `#ffffff` | 기존 라이트 | `#667eea` / `#667eea` |
| dark (기본) | `#262624` | 따뜻한 무채 회색 | `#5f58b8` / `#a9a4e0` (차분한 보라) |
| black | `#0d0d10` | 거의 검정 (바닥 `#000`) | `#55555f` / `#c9c9d3` (회색빛 흰색) |
| midnight | `#121b2e` | 짙은 남색 | `#3d5fae` / `#a3b8dc` (파랑) |
| mocha | `#26201b` | 따뜻한 갈색 | `#8a5f3c` / `#d1a77f` (캐러멜) |
| purple | `#211a3b` | 짙은 보라 | `#6550bd` / `#b0a6e3` (보라) |

---

## 7. 검증 체크리스트

다크 관련 변경 후 반드시:

- [ ] **라이트 불변**: 수정 전 커밋을 다른 포트로 띄워(`git worktree add --detach <임시> HEAD` + `node_modules`·`.env` 심링크 + `PORT=5177 node server.js`) 같은 페이지 모든 요소의 계산된 색을 비교 — 무작위 게임 상태 외 차이 0. `display:none` 요소도 값이 나와 숨은 팝업까지 덮인다. (C-51)
- [ ] **다크 대비**: 화면에 보이는 글자의 `getComputedStyle` 색 vs 가장 가까운 불투명 배경 대비 4.5:1 이상. 기본 다크 + 스킨 4종, 375px·1280px.
- [ ] **형광 점검**: 다크에서 HSL S ≥ 70%·L 40~85% 인 면·글자·테두리가 남았는지 (게임 그림·디버그 로그 제외).
- [ ] **틴트 점검**: 크롬 면·테두리에 게임 색(S > 25%)이 남았는지 — 액센트(이름표·주요 버튼·선택 상태) 외에는 무채여야 한다.
- [ ] 눈으로 캡처 확인: 홈·로비(`/game`)·안내 1~2쪽·게임 방(대기·진행·결과·상점·팝업).
- [ ] CRLF 파일(`css/theme.css`, `js/shared/ready-shared.js`, `js/shared/tutorial-shared.js`, `js/shared/control-bar-shared.js`, `js/horse-race.js`) 줄바꿈 유지 — `grep -vc $'\r$' 파일` 이 0.
- [ ] 바꾼 CSS/JS의 `?v=` 캐시 버전 올림(데구리 페이지가 특히 많이 씀).

**QA 요령**: 방 진입은 `localStorage`에 `pending<Game>Room`(룰렛 `pendingRouletteRoom`, 경마 `pendingHorseRaceRoom`, 사다리 `pendingLadderRoom`, 데구리 `pendingDeguriRoom`) + `/<game>?createRoom=true`, 튜토리얼은 `tutorialSeen_<game>`으로 끈다. 방에 들어오면 이미 준비 상태(C-24). 로컬 서버가 오래 켜져 있으면 새 라우트(`/deguri`)가 없다 — "안 열린다"는 서버 시작 시각부터 확인(C-45).
