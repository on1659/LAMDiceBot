# Lobby (Server Select) Tutorial Steps

> **File to modify**: `server-select-shared.js` + `index.html`
> **Common module**: `tutorial-shared.js` (see [impl.md](impl.md))
> **Status**: Not yet implemented

---

## Problem

Many new users get stuck on the index.html server-select screen:

- Don't know they need to **log in** to see the server list
- Don't know they can **create a server** to invite friends
- Don't know the difference between "바로 플레이" and "서버 참여"

---

## Solution

Add a `?` (help) button inside the ServerSelectModule overlay + step-by-step tooltip tutorial.

- **First visit**: auto-start after 500ms (localStorage `tutorialSeen_lobby` check)
- **Return visit**: click `?` button to replay

---

## Tutorial Steps

| # | target | title | position | 조건 |
|---|--------|-------|----------|------|
| 1 | `.ss-free-btn` | 바로 플레이 | `bottom` | 항상 표시 |
| 2 | `.ss-login-btn` | 서버 참여는 로그인 필요 | `bottom` | 항상 표시 |
| 3 | `.ss-create-btn` | 서버 만들기 | `top` | 로그인 상태일 때만 (비로그인 시 자동 스킵) |
| 4 | `.ss-server-card` | 서버 클릭해서 입장 | `right` | 서버 목록 있을 때만 (없으면 자동 스킵) |

---

## STEPS Array

```javascript
const LOBBY_TUTORIAL_STEPS = [
    {
        target: '.ss-free-btn',
        title: '바로 플레이',
        content: '로그인 없이 바로 게임을 즐길 수 있습니다. 같은 방에 있는 친구들과 함께 하세요!',
        position: 'bottom'
    },
    {
        target: '.ss-login-btn',
        title: '서버 참여하기',
        content: '친구들과 함께하려면 로그인이 필요합니다. 이름과 간단한 코드만 있으면 됩니다!',
        position: 'bottom'
    },
    {
        target: '.ss-create-btn',
        title: '내 서버 만들기',
        content: '서버를 만들면 친구들을 초대할 수 있습니다. 비공개 서버는 참여코드로 보호됩니다.',
        position: 'top'
        // 비로그인 시 .ss-create-btn은 DOM에 존재하지 않음 (display:none이 아닌 미렌더링)
        // querySelector → null 반환 → TutorialModule null-target 처리로 자동 스킵
    },
    {
        target: '.ss-server-card',
        title: '서버 입장',
        content: '서버를 클릭하면 바로 입장! 비공개 서버는 참여코드가 필요합니다.',
        position: 'right'
        // 서버 없을 때 .ss-server-card는 DOM에 존재하지 않음
        // 서버 있어도 소켓 응답(serversList) 후에만 렌더링 → 타이밍 보장 불가
        // querySelector → null 반환 → TutorialModule null-target 처리로 자동 스킵
    }
];
```

---

## Key Element Classes/IDs (from server-select-shared.js)

| Selector | Description | Visible for |
|----------|-------------|-------------|
| `.ss-free-btn` | "🎲 바로 플레이" 버튼 | Always |
| `#ss-login-btn` / `.ss-login-btn` | 로그인/로그아웃 버튼 (상단) | Always |
| `.ss-create-btn` | "새 서버 만들기" 버튼 | **Logged-in only** |
| `.ss-server-card` | 서버 목록 카드 (첫 번째) | **When servers exist** |
| `#ss-server-section` | 서버 목록 섹션 전체 | Always (content varies) |
| `.ss-container` | 중앙 흰색 컨테이너 | Always |

---

## "?" Button Addition

Add a help button inside `.ss-container` — position: absolute, bottom-right.

```javascript
// Inside server-select-shared.js show() or _render(), after container is created
const helpBtn = document.createElement('button');
helpBtn.id = 'ss-tutorial-btn';
helpBtn.textContent = '?';
helpBtn.title = '도움말';
// Styles injected inline (no external CSS dependency)
helpBtn.style.cssText = [
    'position: absolute',
    'bottom: 16px',
    'right: 16px',
    'width: 36px',
    'height: 36px',
    'border-radius: 50%',
    'background: #8B5CF6',
    'color: white',
    'border: none',
    'cursor: pointer',
    'font-size: 1.1rem',
    'font-weight: bold',
    'z-index: 10001',
    'opacity: 0.85',
    'transition: opacity 0.2s'
].join(';');
helpBtn.addEventListener('mouseover', () => helpBtn.style.opacity = '1');
helpBtn.addEventListener('mouseout', () => helpBtn.style.opacity = '0.85');
helpBtn.addEventListener('click', () => {
    if (typeof TutorialModule !== 'undefined') {
        TutorialModule.start('lobby', LOBBY_TUTORIAL_STEPS, { force: true });
    }
});
container.style.position = 'relative'; // ensure absolute child works
container.appendChild(helpBtn);
```

---

## Auto-Start on First Visit

Add at the end of `show()` function in `server-select-shared.js`:

```javascript
// First-visit tutorial auto-start
setTimeout(function() {
    if (typeof TutorialModule !== 'undefined') {
        TutorialModule.start('lobby', LOBBY_TUTORIAL_STEPS);
    }
}, 500);
```

---

## script Load Order in index.html

`tutorial-shared.js` must load **before** `server-select-shared.js`:

```html
<!-- BEFORE server-select-shared.js -->
<script src="/tutorial-shared.js"></script>
<script src="/server-select-shared.js"></script>
```

---

## display:none Auto-Skip Rules

| Situation | Behavior |
|-----------|----------|
| Not logged in → `.ss-create-btn` not in DOM | `querySelector` → `null` → TutorialModule null-target 처리 → step 3 auto-skip |
| No servers / socket not yet responded → `.ss-server-card` not in DOM | `querySelector` → `null` → TutorialModule null-target 처리 → step 4 auto-skip |
| Logged in + servers loaded → all 4 steps show | Full tutorial |

---

## Timing

`ServerSelectModule.show()` dynamically creates all DOM elements.

- **Step 1~3** (`.ss-free-btn`, `.ss-login-btn`, `.ss-create-btn`): `show()` innerHTML에 포함된 고정 요소 → 500ms 내 렌더링 보장
- **Step 4** (`.ss-server-card`): 소켓 응답(`serversList` 이벤트) 후 `renderServerList()`가 실행되어야 렌더링됨 → **500ms 보장 불가**

Step 4는 타이밍에 관계없이 TutorialModule의 null-target 처리로 자동 스킵됨.
서버 목록이 있을 때도 소켓 응답이 늦으면 스킵될 수 있음 — 허용 가능한 trade-off.

```
show() called
  → .ss-free-btn, .ss-login-btn, .ss-create-btn 즉시 렌더링
  → socket.emit('getServers') (비동기)
  → setTimeout 500ms
  → TutorialModule.start('lobby', ...)
  → step 1~3: 정상 표시
  → step 4: 소켓 응답 도착 여부에 따라 표시 or 스킵
```

---

## Files to Modify

| File | Action | Detail |
|------|--------|--------|
| `tutorial-shared.js` | CREATE | highlight+tooltip module (see impl.md) |
| `server-select-shared.js` | MODIFY | Add `?` button + LOBBY_TUTORIAL_STEPS + auto-start |
| `index.html` | MODIFY | Add `<script src="/tutorial-shared.js">` before server-select-shared.js |

> **구현 순서 주의**: `tutorial-shared.js`를 **먼저** 생성한 후 `server-select-shared.js`를 수정할 것.
> 순서가 뒤바뀌면 `TutorialModule`이 undefined인 상태에서 코드가 실행되어 런타임 에러 발생.
> `tutorial-shared.js`가 없는 상태로 `index.html`에 `<script src="/tutorial-shared.js">` 추가 시 404 에러.

---

## Verification

```javascript
// Force-show lobby tutorial (paste in browser console on index.html)
TutorialModule.reset('lobby');
TutorialModule.start('lobby', LOBBY_TUTORIAL_STEPS, { force: true });
```

Expected behavior:
1. `.ss-free-btn` highlighted with purple pulse border + tooltip below
2. `.ss-login-btn` highlighted + tooltip below
3. `.ss-create-btn`: logged-in user sees step, non-logged-in auto-skips
4. `.ss-server-card`: shows if servers exist, skips if empty
5. "건너뛰기" closes tutorial immediately
6. `localStorage.getItem('tutorialSeen_lobby')` → `'v1'` after completion
7. Refresh page → no auto-tutorial (already seen)
8. Click `?` button → tutorial starts again (force: true)
