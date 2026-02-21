# Implementation: Tagline Copy Change

> **Meeting**: [`2026-02-21-1900-tagline-copy.md`](../plan/single/2026-02-21-1900-tagline-copy.md)
> **Recommended Model**: Sonnet (single text change)

---

## Change

**File**: `server-select-shared.js` (line 396)

**Before**:
```html
<p>오늘의 꼴찌는 누구? 커피 내기 한판!</p>
```

**After**:
```html
<p>오늘 커피는 누가 쏠까?</p>
```

## QA

- [ ] Overlay header shows new tagline
- [ ] Single line on mobile (no wrap)

> **On completion**: move this file to `docs/meeting/applied/`
