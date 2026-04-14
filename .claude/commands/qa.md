---
description: "Run QA verification. Automatically performed after code changes when user says 'verify', 'run QA', or 'qa'."
---

# QA Agent - Automated Verification After Code Changes

A 4-step QA process designed based on failure cases. Must be performed in order with each step's results reported.

## Step 1: Detect Changed Files

```bash
git diff --name-only
git diff --cached --name-only
```

Check the list of changed files and determine the QA level based on the criteria below:

| Changed File | QA Level |
|--------------|----------|
| `server.js` | Level 2 (Server verification) |
| `*.html` (game pages) | Level 3 (Browser runtime) |
| `*-shared.js` (common modules) | Level 4 (Cross-game) |
| Other `.js` files | Level 1 (Static verification) |

## Step 2: Static Verification (Level 1)

### 2-1. Node.js Syntax Check
When `server.js` is changed:
```bash
node -c server.js
```

### 2-2. Browser Dangerous Pattern Inspection ⭐ Important
Inspect the following patterns in changed `.js` and `.html` files using grep.
These patterns cannot be detected by Node.js syntax check and only cause runtime errors in browsers.

**Dangerous patterns to check:**

| Pattern | Problem | Correct Code |
|---------|---------|--------------|
| `document.hasAttribute(` | Method doesn't exist on document | `document.documentElement.hasAttribute(` |
| `document.setAttribute(` (except `document.documentElement.setAttribute`) | Method doesn't exist on document | `document.documentElement.setAttribute(` |
| `document.style` (when not followed by `.`) | Property doesn't exist on document | `document.body.style` |
| `document.classList` | Property doesn't exist on document | `document.documentElement.classList` |

Inspect changed files using the Grep tool. Fix immediately if dangerous patterns are found.

### 2-3. Call Chain Tracing
Trace where the changed function is called from. Identify the cascade failure scope when an error occurs.
Example: `setupDragAndDrop()` error → `renderReadyUsers()` → `setReadyUsers()` → entire `initializeGameScreen()` crashes

## Step 3: Server Verification (Level 2)

When `server.js` or server-related files are changed:

```bash
node server.js
```
- Run with 5-second timeout
- Check for "listening" or normal boot message
- PASS if no errors, FAIL + report error content if errors exist
- If port conflict, test with another port (e.g., 3199)

## Step 4: Browser Console Error Check (Level 3) ⭐ Core

**This step is the most important.** Previous QA missed this step and failed to catch the `document.hasAttribute` error.

### Using Automation Script:
```bash
node AutoTest/console-error-check.js --game all
```

### Manual Procedure When Automation Not Available:
1. With server running, access each game page in browser
2. Open Developer Tools (F12) → Console tab
3. Check for console errors on page load
4. Click create room button and check for console errors
5. FAIL if there are red error messages

### Level 4 (Cross-game):
When common modules (`*-shared.js`) are changed, check all 3 games:
- `dice-game-multiplayer.html`
- `roulette-game-multiplayer.html`
- `horse-race-multiplayer.html`

## Step 4-1: Functional Testing (Level 3+) ⭐ New

**Even without console errors, functionality may not work.**
When common modules are changed, **actual button click testing in all 3 games** is required.

### Test Using MCP Browser or Manually:

Perform the following scenarios by **actually clicking** on each game page.

### Module-specific Functional Test Scenarios

#### OrderModule (order-shared.js)
| Scenario | Action | Expected Result |
|----------|--------|-----------------|
| Start taking orders | Click `#startOrderButton` | End button appears, input enabled |
| Save order | Enter input and click save button | Green flash feedback |
| Order list (in progress) | Click `#showOrderListButton` | Modal appears |
| Order list (not started) | Click `#showOrderListButton` | Alert shows "Only available while taking orders..." |
| End taking orders | Click `#endOrderButton` | Input disabled, alert shown |

#### ReadyModule (ready-shared.js)
| Scenario | Action | Expected Result |
|----------|--------|-----------------|
| Ready button toggle | Click `#readyButton` | State changes (Ready/Not Ready) |
| Drag and drop (host) | Drag user | Order changes |

#### ChatModule (chat-shared.js)
| Scenario | Action | Expected Result |
|----------|--------|-----------------|
| Send chat | Enter message and send | Message appears in chat window |
| Emoticon reaction | Hover message → Click emoticon | Reaction count increases |

### Test Methods

**Method 1: Using MCP Browser**
```
browser_navigate → Access page
browser_fill_form → Enter name
browser_click → Click button
browser_snapshot → Check result
```

**Method 2: Manual Testing**
1. Access each game page in browser
2. Create or join room
3. Perform actions in scenario table above
4. Verify results match expected outcomes

### Functional Test Result Report Format

```
### Level 3+: Functional Testing
- OrderModule:
  - Start taking orders: ✅/❌
  - Order list button: ✅/❌
  - End taking orders: ✅/❌
- ReadyModule:
  - Ready button: ✅/❌
- ChatModule:
  - Send chat: ✅/❌
```

## Step 5: Result Report

After completing all steps, report in the following format:

```
## QA Results

Changed files: (list)
QA Level: Level X

### Level 1: Static Verification
- Syntax check: ✅ PASS / ❌ FAIL
- Dangerous patterns: ✅ None / ❌ Found (details)
- Call chain: (impact scope)

### Level 2: Server Verification
- Server boot: ✅ PASS / ❌ FAIL

### Level 3: Browser Runtime
- Page load: ✅ No errors / ❌ Errors found
- Room creation: ✅ No errors / ❌ Errors found
- Functionality: ✅ Normal / ❌ Abnormal

### Final Verdict: ✅ PASS / ❌ FAIL
```

## Reference: Common Module List

| Module | Used In | Caution on Change | Functional Test |
|--------|---------|-------------------|-----------------|
| `order-shared.js` | Dice, Roulette, Horse Race | Level 4 required | Start/End order taking, Order list button |
| `ready-shared.js` | Dice, Roulette, Horse Race | Level 4 required | Ready button, Drag and drop |
| `chat-shared.js` | Dice, Roulette, Horse Race | Level 4 required | Send chat, Emoticon reaction |
| `server.js` | All | Level 2 + Level 3 | Verify socket event operation |
