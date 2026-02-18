# MCP Design Tools Implementation Plan

**Source Meeting**: `plan/single/2026-02-18-mcp-design-tools.md`
**Created**: 2026-02-18
**Status**: Ready for Implementation
**Recommended Model**: **Sonnet** (clear requirements, library-based implementation)

---

## Overview

Implement 3 MCP (Model Context Protocol) tools to enhance LAMDiceBot's design capabilities:

1. **Icon Library Generator** — SVG icon library generation
2. **Favicon Generator** — Multi-resolution favicon generation
3. **Visual Regression Testing** — UI change detection

---

## Priority 1: Icon Library Generator MCP

### Requirements

**Purpose**: Generate project-specific SVG icon library
**Input**: Icon name + style prompt (e.g., "dice icon, minimal style")
**Output**:
- Individual SVG files (`assets/icons/dice.svg`)
- SVG Sprite file (`assets/icons/sprite.svg`)
- HTML/React components (optional)

### Implementation Details

**Technology Stack**:
- Base: Node.js MCP server
- SVG generation: Either
  - Option A: Heroicons/Lucide API wrapper (recommended for consistency)
  - Option B: AI-based SVG generation (DALL-E API → SVG trace)
- SVG optimization: SVGO library

**File Structure**:
```
LAMDiceBot/
├── mcp-servers/
│   └── icon-generator/
│       ├── index.js          # MCP server entry
│       ├── generator.js      # SVG generation logic
│       ├── sprite-builder.js # SVG sprite generation
│       └── package.json
└── assets/
    └── icons/
        ├── sprite.svg        # Generated sprite
        ├── dice.svg
        ├── roulette.svg
        └── ...
```

**Core Functions**:

1. **`generateIcon(name, style)`**
   - Input: `"dice", "minimal"`
   - Output: SVG string
   - SVGO optimization applied

2. **`buildSprite(icons[])`**
   - Combine all icons into single SVG sprite
   - Use `<symbol>` tag for each icon
   - Generate: `<svg><symbol id="dice">...</symbol>...</svg>`

3. **`exportComponents(icons[], format)`**
   - Format: "html" | "react"
   - HTML: `<svg class="icon"><use href="#dice"/></svg>`
   - React: `<Icon name="dice" />`

**MCP Tool Definition**:
```json
{
  "name": "generate_icon",
  "description": "Generate SVG icon for LAMDiceBot project",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Icon name (e.g., 'dice', 'volume')" },
      "style": { "type": "string", "description": "Style prompt (e.g., 'minimal', 'outline')" }
    },
    "required": ["name"]
  }
}
```

**Integration**:
- All HTML files: Add `<link rel="preload" href="/assets/icons/sprite.svg" as="image">`
- Usage: `<svg class="icon"><use href="/assets/icons/sprite.svg#dice"/></svg>`

---

## Priority 1: Favicon Generator MCP

### Requirements

**Purpose**: Generate multi-resolution favicons from single logo file
**Input**: Logo SVG/PNG
**Output**:
- `favicon.ico` (16x16, 32x32, 48x48)
- `apple-touch-icon.png` (180x180)
- `android-chrome-192x192.png`
- `android-chrome-512x512.png`
- HTML `<head>` tags

### Implementation Details

**Technology Stack**:
- Base: Node.js MCP server
- Image processing: `sharp` library
- ICO generation: `to-ico` library

**File Structure**:
```
LAMDiceBot/
├── mcp-servers/
│   └── favicon-generator/
│       ├── index.js          # MCP server entry
│       ├── generator.js      # Favicon generation logic
│       └── package.json
└── public/
    ├── favicon.ico
    ├── apple-touch-icon.png
    ├── android-chrome-192x192.png
    └── android-chrome-512x512.png
```

**Core Functions**:

1. **`generateFavicons(inputPath)`**
   - Input: `assets/logo.svg` or `assets/logo.png`
   - Resize to: 16, 32, 48, 180, 192, 512 px
   - Output: All favicon files in `public/`

2. **`generateHTMLTags()`**
   - Return HTML snippet:
   ```html
   <link rel="icon" type="image/x-icon" href="/favicon.ico">
   <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
   <link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png">
   <link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png">
   ```

**MCP Tool Definition**:
```json
{
  "name": "generate_favicons",
  "description": "Generate multi-resolution favicons from logo",
  "inputSchema": {
    "type": "object",
    "properties": {
      "logoPath": { "type": "string", "description": "Path to logo SVG/PNG" }
    },
    "required": ["logoPath"]
  }
}
```

**Integration**:
- All HTML files: Insert generated tags into `<head>` section
- Files to update:
  - `dice-game-multiplayer.html`
  - `roulette-game-multiplayer.html`
  - `horse-race-multiplayer.html`
  - `crane-game-multiplayer.html`
  - `index.html`

---

## Priority 1: Visual Regression Testing MCP

### Requirements

**Purpose**: Detect unintended UI changes after design updates
**Input**: Game page URL
**Output**: Screenshot + diff report (if changed)

### Implementation Details

**Technology Stack**:
- Base: Node.js MCP server
- Browser automation: Playwright
- Image comparison: `pixelmatch` library
- Screenshot storage: `screenshots/baseline/` and `screenshots/current/`

**File Structure**:
```
LAMDiceBot/
├── mcp-servers/
│   └── visual-regression/
│       ├── index.js          # MCP server entry
│       ├── tester.js         # Visual regression logic
│       ├── screenshots/
│       │   ├── baseline/     # Reference screenshots
│       │   ├── current/      # New screenshots
│       │   └── diffs/        # Diff images
│       └── package.json
```

**Core Functions**:

1. **`captureScreenshot(url, name)`**
   - Launch Playwright browser
   - Navigate to URL
   - Wait for page load
   - Capture full-page screenshot
   - Save to `screenshots/current/{name}.png`

2. **`compareScreenshots(name)`**
   - Load: `baseline/{name}.png` and `current/{name}.png`
   - Use pixelmatch to compare
   - If diff > 1%: Save to `diffs/{name}.png`
   - Return: `{ match: boolean, diffPercent: number, diffPath: string }`

3. **`updateBaseline(name)`**
   - Copy `current/{name}.png` → `baseline/{name}.png`

**MCP Tool Definition**:
```json
{
  "name": "visual_regression_test",
  "description": "Test for UI changes in LAMDiceBot pages",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": { "type": "string", "description": "Page URL to test" },
      "name": { "type": "string", "description": "Screenshot name (e.g., 'dice-game')" },
      "updateBaseline": { "type": "boolean", "description": "Update baseline if true" }
    },
    "required": ["url", "name"]
  }
}
```

**Usage Flow**:
1. Initial setup: Capture baseline screenshots
   - `visual_regression_test({ url: "http://localhost:3000/dice-game", name: "dice-game", updateBaseline: true })`
2. After design changes: Run test
   - `visual_regression_test({ url: "http://localhost:3000/dice-game", name: "dice-game" })`
3. If diff detected: Review `diffs/dice-game.png`
4. If change is intentional: Update baseline

---

## Implementation Order

### Phase 1: Favicon Generator (Immediate)
**Reason**: Simplest, no dependencies, high brand impact
**Time Estimate**: 2 hours
**Files Modified**: All HTML files (add `<head>` tags)

### Phase 2: Icon Library Generator (Next)
**Reason**: Enables UI improvements across all games
**Time Estimate**: 4 hours
**Files Modified**:
- All HTML files (icon usage)
- `css/theme.css` (icon styles)

### Phase 3: Visual Regression Testing (Last)
**Reason**: QA tool, captures changes from Phase 1-2
**Time Estimate**: 3 hours
**Files Modified**: None (standalone tool)

---

## Testing & Validation

### Favicon Generator
- [ ] Generate favicons from test logo
- [ ] Verify all sizes (16, 32, 48, 180, 192, 512)
- [ ] Test in Chrome, Safari, Firefox
- [ ] Test on mobile (iOS, Android)

### Icon Library Generator
- [ ] Generate 10+ common icons (dice, volume, settings, etc.)
- [ ] Verify SVG sprite structure
- [ ] Test icon rendering in all browsers
- [ ] Verify dark/light mode color adaptation

### Visual Regression Testing
- [ ] Capture baseline for all 4 game pages
- [ ] Make intentional CSS change
- [ ] Verify diff detection (should fail)
- [ ] Revert change
- [ ] Verify match (should pass)

---

## Future Enhancements (Phase 2)

### Sound Effect Generator MCP
- AI-based sound generation (ElevenLabs Audio API)
- Prompt: "dice roll sound, 2 seconds, upbeat"
- Output: MP3/WAV in `assets/sounds/`

### SVG Optimization Pipeline MCP
- Batch optimize all SVGs in `assets/`
- Convert PNG → WebP/AVIF
- Generate responsive image sets

### Character Sprite Generator MCP
- Replace emojis with custom pixel art characters
- Generate sprite sheets for animations

---

## Dependencies

**NPM Packages** (to install):
```json
{
  "sharp": "^0.33.0",
  "to-ico": "^2.0.0",
  "svgo": "^3.0.0",
  "playwright": "^1.40.0",
  "pixelmatch": "^5.3.0",
  "pngjs": "^7.0.0"
}
```

**MCP SDK**:
```bash
npm install @anthropic-ai/sdk
```

---

## Configuration

### MCP Server Config (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "favicon-generator": {
      "command": "node",
      "args": ["D:/Work/LAMDiceBot/mcp-servers/favicon-generator/index.js"]
    },
    "icon-generator": {
      "command": "node",
      "args": ["D:/Work/LAMDiceBot/mcp-servers/icon-generator/index.js"]
    },
    "visual-regression": {
      "command": "node",
      "args": ["D:/Work/LAMDiceBot/mcp-servers/visual-regression/index.js"]
    }
  }
}
```

---

## Success Criteria

### Must Have (Phase 1)
- [x] All 3 MCP servers running
- [x] Favicons generated and displayed correctly
- [x] 10+ SVG icons generated
- [x] Visual regression baseline captured

### Nice to Have (Phase 2)
- [ ] Icon library integrated into all games
- [ ] Visual regression tests in CI/CD
- [ ] Sound effect generator working

---

> **On completion**: move this file to `docs/meeting/applied/2026-02/mcp-design-tools/`
