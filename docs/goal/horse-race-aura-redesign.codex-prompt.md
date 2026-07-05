# Codex prompt — horse-race aura CSS resource

Paste everything below into Codex.

---

## Task
Redesign the **"aura" cosmetic** in a browser horse-racing game into a genuinely beautiful, self-contained **CSS** effect, and return **drop-in CSS** I can paste into `css/horse-shop.css`. The current aura is a dull flat colored blob (`radial-gradient` circle + one `box-shadow`); make it read as a premium glowing aura. Do **not** produce image/sprite assets — it must stay pure CSS so it works for 20 arbitrary item colors.

The project is plain HTML/CSS/vanilla JS — **no framework, no build step, no Tailwind for this part**. Output must be paste-ready CSS.

## How the aura is colored (must keep this contract)
- For **20 of the 22** auras, JS sets an **inline `style.color = "#rrggbb"`** on an empty `<span>` aura node. Your CSS must derive the glow from **`currentColor`** so each item's color drives it. Colors span the full hue range including near-white `#eceff1`, gold `#ffca28`, neon green `#76ff03`, deep teal `#00897b`, magenta `#d500f9` — the effect must look good for *any* hue and not wash out on light/near-white colors.
- The **2 premium** auras are special and must ignore `currentColor`:
  - `data-variant="rainbow"` → an actual animated multi-color / rainbow glow.
  - `data-variant="prism"` → a prismatic / iridescent shimmer.
  JS will add that attribute to the same span (alongside the inline color, which you ignore for these two). Provide `[data-variant="rainbow"]` and `[data-variant="prism"]` override rules.

## The aura node
- An empty `<span aria-hidden="true" style="color:#xxxxxx">`, `position:absolute`, `pointer-events:none`, appended **behind** the vehicle sprite. No text content, no children (you may use `::before`/`::after`).
- It must **not** affect layout and must **not** take any filter from its parent (a `paint` filter lives on the sprite; event effects own the parent's filter). Pure absolute overlay, low `z-index`, centered with `top:50%; left:50%; transform:translate(-50%,-50%)`.

## Three render sites — give a class for each (same visual, three sizes)
1. **`.cosmetic-aura`** — in-race. Parent `.horse` is `80×80`, `display:flex` centered; the sprite `.vehicle-sprite` is `60×45` at `z-index:2`. Aura ≈ **52–64px**, `z-index:1`, centered behind the sprite. `.horse` is NOT `overflow:hidden`, so modest overflow is fine. **Up to ~14 of these animate at once** during a race behind fast-moving sprites → must be **cheap** (compositor-only animation; avoid large/animated `filter: blur` and avoid many stacked animated `box-shadow`s).
2. **`.hshop-preview-aura`** — shop card thumbnail. Sprite svg is `62px` wide. Aura ≈ **44px**, `z-index:1`, centered. (Only one visible at a time — can be a touch richer.)
3. **`.hshop-inv-aura`** — NEW, inventory "big preview". Sprite svg is `120px` wide, stage `140px` tall. Aura ≈ **96–116px**, `z-index:1`, centered. (Single, large, showcase — richest version.)

Keep the three visually consistent (same design language, scaled).

## Hard constraints
- **Self-contained CSS only**: no `@import`, no external fonts, no image/URL assets (tiny inline SVG data-URI acceptable only if unavoidable — prefer pure CSS gradients/conic-gradient).
- **Compositor-friendly motion**: animate only `transform`, `opacity`, and `background-position`/gradient rotation. Subtle, tasteful, "premium glow" — it plays during a race, must not be distracting or seizure-y.
- Provide a `@media (prefers-reduced-motion: reduce)` block that reduces the aura to a static glow (no motion).
- The in-race aura may be disabled mid-race via `animation: none` (a running-state rule) — design it so a static fallback still looks intentional.
- Uniquely name any `@keyframes` (e.g. `auraGlowPulse`, `auraRainbowSpin`) to avoid collisions.
- Don't change HTML structure or JS logic — just tell me, in one line, the exact attribute contract you assumed for rainbow/prism (I'll wire the JS).

## What you are replacing (current CSS)
```css
/* card preview */
.hshop-preview-aura {
    position: absolute; top: 50%; left: 50%;
    width: 44px; height: 44px;
    transform: translate(-50%, -50%);
    border-radius: 50%; z-index: 1; pointer-events: none;
    background: radial-gradient(circle, currentColor 0%, transparent 68%);
    opacity: 0.55;
    box-shadow: 0 0 16px 6px currentColor;
}

/* in-race */
.cosmetic-aura {
    position: absolute; top: 50%; left: 50%;
    width: 52px; height: 52px;
    transform: translate(-50%, -50%);
    border-radius: 50%; z-index: 1; pointer-events: none;
    background: radial-gradient(circle, currentColor 0%, transparent 66%);
    opacity: 0.5;
    box-shadow: 0 0 18px 7px currentColor;
    animation: cosmeticAuraPulse 2.2s ease-in-out infinite;
}
@keyframes cosmeticAuraPulse {
    0%, 100% { opacity: 0.42; transform: translate(-50%, -50%) scale(0.92); }
    50%      { opacity: 0.6;  transform: translate(-50%, -50%) scale(1.06); }
}

/* reduced-motion elsewhere: .cosmetic-aura { animation: none; } */
```

## Deliverable
One CSS block, paste-ready, containing:
1. `.cosmetic-aura`, `.hshop-preview-aura`, `.hshop-inv-aura` (three sizes, same design, `currentColor`-driven).
2. `[data-variant="rainbow"]` and `[data-variant="prism"]` overrides (applied on top of each of the three classes).
3. All needed `@keyframes` (uniquely named).
4. A `@media (prefers-reduced-motion: reduce)` fallback.
5. One line stating the rainbow/prism attribute contract you assumed.

Optimize for how it looks across the full color range and for the in-race performance budget.
