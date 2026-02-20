# Implementation: Main Screen Free Play Highlight + AdSense Compliance

> **Meeting**: [`2026-02-21-1800-main-screen-redesign.md`](../plan/multi/2026-02-21-1800-main-screen-redesign.md)
> **Recommended Model**: Sonnet (CSS/HTML changes only, all locations specified)

---

## Target File

| File | Description |
|------|-------------|
| `server-select-shared.js` | Server select overlay (CSS + HTML + JS) |

All 6 items modify only this single file.

---

## Item 1: Free Play Button CTA Highlight

**Priority**: 1 (All agents agreed)

### CSS Change (lines 145-150)

**Before**:
```css
.ss-free-btn {
    width: 100%; padding: 16px; border: 2px dashed #ccc; border-radius: 14px;
    background: #fafafa; cursor: pointer; font-size: 1.05em; color: #666;
    transition: all 0.2s; margin-bottom: 20px; text-align: center;
}
.ss-free-btn:hover { border-color: #667eea; color: #667eea; background: #f0f0ff; }
```

**After**:
```css
.ss-free-btn {
    width: 100%; padding: 18px 16px; border: none; border-radius: 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    cursor: pointer; font-size: 1.1em; color: white; font-weight: 700;
    transition: all 0.3s; margin-bottom: 20px; text-align: center;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
}
.ss-free-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5); }
```

---

## Item 2: Button Text Improvement

**Priority**: 2 (All agents agreed)

### HTML Change (lines 391-393)

**Before**:
```html
<button class="ss-free-btn" onclick="ServerSelectModule.selectFree()">
    🎲 자유 플레이 (기존 방식) 🎲
</button>
```

**After**:
```html
<button class="ss-free-btn" onclick="ServerSelectModule.selectFree()">
    🎲 바로 플레이
    <div style="font-size:0.7em;font-weight:400;margin-top:4px;opacity:0.9;">회원가입 없이 바로 시작</div>
</button>
```

---

## Item 3: Game Icons + Names in Button

**Priority**: 3 (2/3 agreed, AdSense content value)

### HTML Change (merged with Item 2, lines 391-393)

**Final combined button**:
```html
<button class="ss-free-btn" onclick="ServerSelectModule.selectFree()">
    🎲 바로 플레이
    <div style="font-size:0.75em;font-weight:400;margin-top:6px;opacity:0.85;">🎲 주사위 · 🎰 룰렛 · 🏇 경마</div>
    <div style="font-size:0.65em;font-weight:400;margin-top:2px;opacity:0.7;">회원가입 없이 바로 시작</div>
</button>
```

---

## Item 4: Tagline + Trust Signals

**Priority**: 4 (All agents agreed)

### HTML Change (lines 386-389)

**Before**:
```html
<div class="ss-header">
    <h1>🎮 LAMDice</h1>
    <p>서버에 참여하거나 자유롭게 플레이하세요</p>
</div>
```

**After**:
```html
<div class="ss-header">
    <h1>🎮 LAMDice</h1>
    <p>친구와 함께하는 무료 온라인 보드게임</p>
    <div style="display:flex;gap:12px;justify-content:center;margin-top:10px;flex-wrap:wrap;">
        <span style="font-size:0.75em;color:#28a745;">✅ 100% 무료</span>
        <span style="font-size:0.75em;color:#667eea;">🎯 공정 난수</span>
        <span style="font-size:0.75em;color:#ff9800;">⚡ 즉시 시작</span>
    </div>
</div>
```

---

## Item 5: Shrink Login Prompt (Non-logged-in)

**Priority**: 5 (2/3 agreed)

### HTML Change — `_loginPromptHTML()` function (lines 433-442)

**Before**:
```js
function _loginPromptHTML() {
    return `
        <div class="ss-login-prompt">
            <div class="ss-login-prompt-icon">🔐</div>
            <h3>로그인이 필요합니다</h3>
            <p>서버에 참여하려면 먼저 로그인하세요</p>
            <button class="ss-login-prompt-btn" onclick="ServerSelectModule.showLoginModal()">로그인</button>
        </div>
    `;
}
```

**After**:
```js
function _loginPromptHTML() {
    return `
        <div class="ss-login-prompt" style="padding:16px 20px;">
            <p style="margin:0 0 10px;color:#888;font-size:0.85em;">서버 참여는 로그인이 필요합니다</p>
            <button class="ss-login-prompt-btn" onclick="ServerSelectModule.showLoginModal()">로그인</button>
            <button class="ss-login-prompt-btn" onclick="ServerSelectModule.showRegisterModal()" style="margin-left:8px;background:#28a745;">회원가입</button>
        </div>
    `;
}
```

### CSS Change — `.ss-login-prompt` (lines 157-161)

Remove unused sub-elements (icon, h3 styles no longer needed — they become dead CSS but we leave them since other code may reference the class).

No CSS change required — inline `style` on the div overrides padding.

---

## Item 6: CTA Pulse Animation (1-time)

**Priority**: 6 (All agents agreed)

### CSS Addition — Add after `.ss-free-btn:hover` (after line 150)

```css
@keyframes ssCtaPulse {
    0% { box-shadow: 0 4px 15px rgba(102,126,234,0.4); }
    50% { box-shadow: 0 4px 25px rgba(102,126,234,0.7); }
    100% { box-shadow: 0 4px 15px rgba(102,126,234,0.4); }
}
.ss-free-btn.ss-pulse { animation: ssCtaPulse 1.5s ease-in-out 2; }
```

### JS Addition — In `show()` function, after overlay is appended (after line 412)

```js
// One-time pulse animation for CTA
const freeBtn = _overlay.querySelector('.ss-free-btn');
if (freeBtn) {
    freeBtn.classList.add('ss-pulse');
    freeBtn.addEventListener('animationend', () => freeBtn.classList.remove('ss-pulse'), { once: true });
}
```

---

## Implementation Order

1. **Item 1** — CSS: `.ss-free-btn` gradient + shadow (lines 145-150)
2. **Item 6** — CSS: `@keyframes ssCtaPulse` (add after line 150)
3. **Item 2+3** — HTML: Button text + game icons (lines 391-393)
4. **Item 4** — HTML: Header tagline + trust signals (lines 386-389)
5. **Item 5** — HTML: Login prompt shrink (`_loginPromptHTML`, lines 433-442)
6. **Item 6** — JS: Pulse trigger (after line 412)

## QA Checklist

- [ ] Free play button: gradient background, white text, shadow visible
- [ ] Button hover: slight lift + stronger shadow
- [ ] Button text: "바로 플레이" + game icons + subtitle
- [ ] Header: "LAMDice" + tagline + 3 trust badges
- [ ] Non-logged-in: login prompt is compact (1-2 lines + buttons)
- [ ] Pulse animation plays once on overlay open, then stops
- [ ] Mobile: button and trust badges wrap correctly on small screens
- [ ] Overlay scroll: no layout breakage on short viewports

> **On completion**: move this file to `docs/meeting/applied/`
