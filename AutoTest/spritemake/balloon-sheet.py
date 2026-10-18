#!/usr/bin/env python3
"""풍선 타기 그림 만들기 — 동물 포즈 시트 3종 + 소품: 스캐폴드 → (Codex 가 그림) → 리팩·검증 → 인수.
의뢰서: docs/spritemake-request/2026-10-18-balloon-sprites.md. GPT(Codex exec)는 그리기만, 자르기·배율·정렬·판정은 여기서 한다.
배경 제거·덩어리 배정·인수(pngquant --nofs + cwebp 무손실)는 walk-sheet.py 함수를 그대로 쓴다.

동물 시트(4×1, 칸 160, 오른쪽 향함, 알파 0/255) — assets/balloon/creatures/{creature}-{kind}.webp
  hang : 두 앞발을 머리 위로 올려 짧은 줄 토막을 잡고 매달림. 줄 토막 꼭대기 = 칸에서 가장 높은 점 = (HANG_X, HANG_TOP) — 렌더러가 풍선 줄·낙하산 줄을 여기에 잇는다
         c0 가만 · c1 다리 앞으로 · c2 가만(살짝 늘어짐) · c3 다리 뒤로
  blow : 땅에 서서 앞발로 풍선 꼭지를 입에 대고 분다(풍선은 그리지 않음 — 렌더러가 입 앞에서 키운다). 발바닥선 y=150, 윗몸 무게중심 x = 기본 시트 서기
         c0 들이쉼 · c1 볼 빵빵 · c2 들이쉼 · c3 더 빵빵
  fall : 풍선이 터진 뒤. c0 깜짝 놀람(터지는 순간) · c1~c3 허우적 낙하. 몸 bbox 가운데 = (80, FALL_CY)
크기: 몸 넓이(불투명 픽셀 수) = 기본 시트 row 0 서기 칸 넓이의 중앙값 × AREA_K[kind] (시트당 배율 1개)

usage (/opt/homebrew/bin/python3, 배치 폴더 쓰기·Codex 실행은 샌드박스 해제):
  balloon-sheet.py scaffold <creature> <kind> [date]     # SpriteMake/output/balloon-<kind>-<date>/<creature>/ 에 ref·prompt·CODEX-BRIEF
  balloon-sheet.py repack <creature> <kind> [attempt] [date]
  balloon-sheet.py verify <png> <creature> <kind>
  balloon-sheet.py pickup <creature> <kind> [date] [--force] [--allow-fail]
  balloon-sheet.py strip <out.png> <kind>               # 눈으로 볼 대조 그림(서기 4칸 | 그 kind 4칸, 동물 10줄)
  balloon-sheet.py scaffold-props [date]                # 소품 배치(풍선·낙하산·장애물) — 리팩은 props-repack
  balloon-sheet.py props-repack [date] [balloon=N] [chute=N] [items=N]
  balloon-sheet.py skin-kind <creature> <skin>             # recolor | remap | pixelate | dress
  balloon-sheet.py recolor|remap|pixelate <creature> <skin> [kinds…]   # GPT 없이 기본 포즈 시트에서 파생 → assets/balloon/creatures/{creature}-{skin}-{kind}.webp
  balloon-sheet.py scaffold-skin <creature> <skin> <kind> [date]       # 옷 입히기 배치(balloon-<kind>-<date>/<creature>-<skin>/) — 리팩·인수는 repack/pickup <creature>-<skin> <kind>
"""
import colorsys, datetime, importlib.util, sys
from pathlib import Path
import numpy as np
from PIL import Image

_spec = importlib.util.spec_from_file_location('walk_sheet', Path(__file__).with_name('walk-sheet.py'))
W = importlib.util.module_from_spec(_spec); _argv = sys.argv; sys.argv = ['walk-sheet']; _spec.loader.exec_module(W); sys.argv = _argv

OUT, GAME, CREATURES, CODEX = W.OUT, W.GAME, W.CREATURES, W.CODEX
DEST = GAME / 'assets' / 'balloon'
CELL, COLS, PLANE, ALPHA_MIN = W.CELL, W.COLS, W.PLANE, W.ALPHA_MIN
BASES = W.BASES
KINDS = ('hang', 'blow', 'fall')
HANG_X, HANG_TOP = 80, 4          # 줄 토막 꼭대기 — 렌더러 js/balloon-render.js HANG_ANCHOR 와 같은 값
FALL_CY = 82
AREA_K = {'hang': 1.0, 'blow': 1.0, 'fall': 1.0}
MAX_W, MAX_H = 152, 154
AREA_TOL = {'hang': (0.78, 1.15), 'blow': (0.85, 1.15), 'fall': (0.85, 1.15)}   # 매달림은 세로로 늘어져 칸 키(154)에 먼저 닿는다 — 서기보다 넓이가 작다
ROPE_W_FRAC, ROPE_KEEP = 0.12, 0.3
NO_ROPE = {'raccoon'}   # 끈 토막을 그리면 이미지 도구 안전 검사에 막혔다(2026-10-18) — 두 팔 만세 자세로 그리고 앞발 꼭대기를 기준점으로 쓴다(끈은 렌더러가 그린다)   # 매달림 줄 토막: 몸 폭의 12% 이하 행이 줄, 그 아래쪽 30% 만 남긴다           # 매달림·허우적은 몸이 늘어나 서기와 넓이가 조금 다를 수 있다
STYLE = ("Preserve EXACTLY the reference's chibi pixel-art style, chunky dark outline, palette, lighting, face, body proportions and size. "
         "It must look like the row-0 character in a new pose — not a redesign.")

ARMS = {   # 무엇으로 줄·꼭지를 잡나
    'pufferfish': 'it has NO arms or legs (never draw any): it holds things in its MOUTH and moves only its fins',
    'pillbug': 'it uses its two FRONT legs as arms',
}
QUADS = {'armadillo', 'turtle', 'raccoon', 'ribbonpig', 'rabbit'}


def arms(c): return ARMS.get(c, 'it uses its two FRONT paws as hands' + (' (it is normally on all fours, so here it reaches up with its front paws like a cartoon animal)' if c in QUADS else ''))


def frames_for(c, kind):
    if kind == 'hang':
        # "밧줄에 매달림(hang from a rope)" 은 이미지 도구 안전 검사에 걸린다(2026-10-18 너구리 3번 차단) — 풍선 끈을 쥐고 둥실 떠 있는 장면으로 쓴다
        grip = ('it holds the string in its mouth; the round body floats just below the mouth' if c == 'pufferfish'
                else 'both front paws/arms are raised straight UP above the head, holding the string with both hands')
        return (f"The character FLOATS UP INTO THE SKY carried by a party balloon (cheerful, like a kids' cartoon). {arms(c).capitalize()}.\n"
                f"In EVERY cell: {grip}. Draw only the short lower end of the balloon STRING: a thin DARK-BROWN line (about 1/8 of the cell height, 2 pixels thick) going straight UP from the paws — "
                "its TOP END is the HIGHEST point of the whole drawing and sits at the horizontal CENTRE of the cell. The balloon itself is NOT drawn (it is above the cell).\n"
                "The body floats below the paws, relaxed and happy; legs/tail swing loosely below.\n"
                "c0: floating calmly, legs straight down.\n"
                "c1: a happy little kick — legs swing FORWARD (to the right) a bit.\n"
                "c2: floating calmly again, body very slightly stretched.\n"
                "c3: legs swing BACK (to the left) a bit.\n"
                + ("Fins: up in c1, level in c0/c2, down in c3. " if c == 'pufferfish' else '')
                + "The head, face and paws on the string are the same drawing in all four cells; only the swinging legs/tail (and a tiny body sway) change.")
    if kind == 'blow':
        how = ('the rubber nozzle is in its mouth and the whole round body puffs up slightly bigger in the blowing cells (c1, c3)' if c == 'pufferfish'
               else 'both front paws hold the nozzle at its mouth' + ('; it SITS UP on its hind legs to do this' if c in QUADS else ''))
        return (f"The character STANDS ON THE GROUND (same ground line in every cell), facing RIGHT, BLOWING UP A BALLOON. {arms(c).capitalize()}: {how}.\n"
                "Do NOT draw the balloon. Draw only a tiny PINK rubber balloon nozzle (about 6 pixels long) sticking out FORWARD and slightly UP from the lips.\n"
                "c0 INHALE: cheeks normal, chest slightly raised, eyes open.\n"
                "c1 BLOW: cheeks puffed big and round, eyes squeezed shut.\n"
                "c2 INHALE: like c0 (may differ by a pixel or two).\n"
                "c3 BLOW HARDER: cheeks puffed even rounder, a little red effort blush.\n"
                "Feet on the same ground line in every cell. Same body size in every cell.")
    return (f"The character is FALLING THROUGH THE AIR right after its balloon popped. {arms(c).capitalize()}.\n"
            "c0 SHOCKED (the instant of the pop): eyes wide open (big round white eyes with tiny pupils), mouth open in surprise, arms and legs flung out stiffly, body upright, fur/spikes bristling.\n"
            "c1 FLAIL A: tumbling, body tilted about 25 degrees forward, arms flailing UP, legs kicking, panicked face.\n"
            "c2 FLAIL B: body tilted about 25 degrees backward, arms and legs in clearly different positions from c1, panicked face.\n"
            "c3 FLAIL C: body tilted forward again, limbs windmilling in a third position, eyes squeezed shut.\n"
            "Nothing else in the cell: no balloon pieces, no stars, no motion lines, no sweat drops floating away.")


def batch_dir(c, kind, date): return OUT / f'balloon-{kind}-{date}' / c


def scaffold(c, kind, date):
    dst = batch_dir(c, kind, date)
    if dst.exists(): sys.exit(f'exists: {dst}')
    for d in ('ref', 'source', 'final'): (dst / d).mkdir(parents=True)
    Image.open(CREATURES / f'{c}.webp').convert('RGBA').save(dst / 'ref' / f'{c}.png')
    title = {'hang': 'floating with a balloon', 'blow': 'blowing up a balloon', 'fall': 'shocked + falling'}[kind]
    (dst / 'prompt.md').write_text(f"""# {c} — {title} (4x1)

Use `ref/{c}.png` as the FIRST input image of the image tool. It is the existing sprite sheet of this character; row 0 (top row) shows its standing/idle poses, facing right.
Draw a NEW sprite sheet of the SAME character: 4 frames, side view, facing RIGHT.
{STYLE}

Layout: exactly 4 columns x 1 row of equal cells (a wide landscape image), one pose per cell, order c0 c1 c2 c3:
{frames_for(c, kind)}

Rules:
- Same character size in every cell, centred in its cell.
- All cells face RIGHT in side profile. No ground, no shadow, no dust, no text, no second character.

BACKDROP: a transparent background is fine (preferred), or one {W.BACKDROP.get(c, 'flat mid-green #6EBE64')}. Never draw the backdrop colour on the character. No border, drawn grid, labels or watermark.
Each frame fully inside its cell with padding, no bleed into neighbour cells. Large PNG.
""")
    brief(dst, f'balloon-{kind}-{date}/{c}', [(f'source/{c}-{kind}-attempt-NN.png', 'prompt.md', f'`ref/{c}.png` as the only input image')],
          'not exactly 4 cells in one row, a cell missing or holding two poses, frames bleeding across cells, the character facing LEFT, the four cells being the same pose, '
          'the character redesigned, ' + ({'hang': 'no string above the paws / the character standing on the ground instead of floating, ', 'blow': 'a balloon drawn / the character not standing, ', 'fall': 'the character standing calmly, '}[kind]) + 'or text/labels/grid lines drawn')
    print(dst)


def brief(dst, name, jobs, fails):
    steps = '\n'.join(f'{i + 1}. Generate the image described in `{p}` with the image tool, passing {inp}, plus the prompt text. Save the raw result as `{out.replace("NN", "01")}`.' for i, (out, p, inp) in enumerate(jobs))
    (dst / 'CODEX-BRIEF.md').write_text(f"""You are generating raw sprite art for SpriteMake batch `{name}` (cwd = {dst}).
Your job is ONLY to DRAW with the built-in image generation tool. Do NOT write any scripts, do NOT crop/repack/resize/edit pixels, do NOT touch any other folder.

{steps}
{len(jobs) + 1}. Look at each result. A TRANSPARENT background is GOOD (it may look black in some viewers) and slight backdrop tone variation is fine — never retry for the background.
   Regenerate (attempt-02, then attempt-03 at most, same file name pattern) ONLY for hard failures: {fails}.
{len(jobs) + 2}. Write `REPORT.md`: attempts made and one line of observations per attempt. Do not pick a winner — every attempt is reviewed by someone else.
""")


# ── 리팩 ──
def cut_frames(a, cols):
    a, bg = W.remove_backdrop(a)
    a[a[..., 3] < 128] = 0; a[..., 3] = np.where(a[..., 3] >= 128, 255, 0).astype(np.uint8)
    a, _ = W.despill(a, bg)
    h, w = a.shape[:2]; comps = W.components(a[..., 3] >= ALPHA_MIN)
    if not comps: sys.exit('empty image')
    big = [c for c in comps if c[0] >= comps[0][0] * W.BODY_MIN_SHARE]; sats = [c for c in comps if c[0] < comps[0][0] * W.BODY_MIN_SHARE]
    cells = [[] for _ in range(cols)]
    for c in big: cells[min(cols - 1, int(c[5] // (w / cols)))].append(c)
    if any(not g for g in cells): sys.exit(f'cell without a body: {[len(g) for g in cells]} — wrong layout?')
    frames = []
    for g in cells:
        x0, y0, x1, y1 = min(c[1] for c in g), min(c[2] for c in g), max(c[3] for c in g), max(c[4] for c in g)
        px, py = (x1 - x0) * W.SAT_KEEP_PAD, (y1 - y0) * W.SAT_KEEP_PAD; mine = list(g)
        for s in sats:
            if s[1] >= x0 - px and s[3] <= x1 + px and s[2] >= y0 - py and s[4] <= y1 + py: mine.append(s)
        m = np.zeros(h * w, bool)
        for c in mine: m[c[6]] = True
        m = m.reshape(h, w); x0, y0, x1, y1 = min(c[1] for c in mine), min(c[2] for c in mine), max(c[3] for c in mine), max(c[4] for c in mine)
        crop = a[y0:y1, x0:x1].copy(); crop[~m[y0:y1, x0:x1]] = 0
        frames.append(crop)
    return frames, bg


def top_x(alpha):   # 가장 높은 줄(위 3줄)의 불투명 픽셀 x 평균 — 줄 토막 꼭대기
    ys, xs = np.nonzero(alpha >= ALPHA_MIN); y0 = ys.min(); sel = ys <= y0 + 2
    return xs[sel].mean()


def trim_rope(f, keep_frac):
    """매달림: 위쪽의 가는 줄 토막(행 폭 ≤ 몸 폭의 ROPE_W_FRAC)을 아래쪽 keep_frac 만 남기고 자른다 — 줄이 칸 높이를 먹어 몸이 작아지지 않게. 줄은 렌더러가 풍선까지 잇는다"""
    op = f[..., 3] >= ALPHA_MIN; widths = op.sum(1); limit = max(3, op.shape[1] * ROPE_W_FRAC)
    n = 0
    while n < len(widths) and 0 < widths[n] <= limit: n += 1
    cut = int(n * (1 - keep_frac))
    return f[cut:].copy() if n >= 4 else f


def repack(c, kind, attempt, date):
    dst = batch_dir(c, kind, date); src = dst / 'source' / f'{c}-{kind}-attempt-{attempt:02d}.png'
    frames, bg = cut_frames(np.array(Image.open(src).convert('RGBA')), COLS)
    if kind == 'hang' and c.split('-')[0] not in NO_ROPE: frames = [trim_rope(f, ROPE_KEEP) for f in frames]
    stand_area, stand_cx = W.stand_reference(c)
    s = (stand_area * AREA_K[kind] / float(np.median([(f[..., 3] >= ALPHA_MIN).sum() for f in frames]))) ** 0.5
    limit_h = MAX_H if kind == 'hang' else W.MAX_H
    s = min(s, MAX_W / max(f.shape[1] for f in frames), limit_h / max(f.shape[0] for f in frames))
    sheet = np.zeros((CELL, CELL * COLS, 4), np.uint8); info = []
    for i, f in enumerate(frames):
        fw, fh = max(1, round(f.shape[1] * s)), max(1, round(f.shape[0] * s))
        r = np.array(Image.fromarray(f, 'RGBA').resize((fw, fh), Image.NEAREST))
        if kind == 'hang': ox, oy = int(round(HANG_X - top_x(r[..., 3]))), HANG_TOP
        elif kind == 'blow': ox, oy = int(round(stand_cx - W.top_centroid_x(r[..., 3]))), PLANE - fh
        else: ox, oy = int(round(80 - fw / 2)), int(round(FALL_CY - fh / 2))
        ox = max(1, min(CELL - 1 - fw, ox)); oy = max(1, min(CELL - 1 - fh, oy))
        sheet[oy:oy + fh, i * CELL + ox:i * CELL + ox + fw] = r; info.append((fw, fh, ox, oy))
    out = dst / 'final' / f'{c}-{kind}.png'; Image.fromarray(sheet, 'RGBA').save(out)
    print(f'{c} {kind} attempt {attempt}: bg {"transparent" if bg is None else tuple(int(v) for v in bg)} | scale {s:.3f} | frames {info}')
    return verify(out, c, kind)


def verify(path, c, kind):
    a = np.array(Image.open(path).convert('RGBA')); ok = True; notes = []
    if a.shape[:2] != (CELL, CELL * COLS): print('FAIL size', a.shape); return False
    if ((a[..., 3] > 0) & (a[..., 3] < ALPHA_MIN)).any(): ok = False; notes.append('alpha 1-7')
    stand_area, stand_cx = W.stand_reference(c); st = []
    for i in range(COLS):
        cell = a[:, i * CELL:(i + 1) * CELL, 3]; ys, xs = np.nonzero(cell >= ALPHA_MIN)
        if not len(xs): print(f'FAIL empty c{i}'); return False
        st.append(dict(x0=xs.min(), y0=ys.min(), x1=xs.max() + 1, y1=ys.max() + 1, n=len(xs), tx=top_x(cell)))
    area = float(np.median([s['n'] for s in st])) / stand_area
    if not AREA_TOL[kind][0] <= area <= AREA_TOL[kind][1]: ok = False; notes.append(f'area {area:.2f}x stand')
    if kind == 'hang':
        if any(s['y0'] != HANG_TOP for s in st): ok = False; notes.append(f'rope tops {[int(s["y0"]) for s in st]}')
        if any(abs(s['tx'] - HANG_X) > 2 for s in st): ok = False; notes.append(f'rope x {[round(s["tx"], 1) for s in st]}')
        # 줄 토막: 꼭대기에서 아래로 4px 은 가늘어야 한다(폭 ≤ 12) — 줄 없이 머리·손이 꼭대기면 실패(너구리는 일부러 줄 없음)
        for i, s in enumerate(st if c.split('-')[0] not in NO_ROPE else []):
            band = a[HANG_TOP:HANG_TOP + 4, i * CELL:(i + 1) * CELL, 3] >= ALPHA_MIN
            wmax = max(int(r.sum()) for r in band)
            if wmax > 12: ok = False; notes.append(f'c{i} no thin rope at the top (width {wmax})'); break
    elif kind == 'blow':
        if any(s['y1'] != PLANE for s in st): ok = False; notes.append(f'bottoms {[int(s["y1"]) for s in st]}')
    def diff(i, j): return int((a[:, i * CELL:(i + 1) * CELL] != a[:, j * CELL:(j + 1) * CELL]).any(-1).sum())
    d = [diff(0, 1), diff(1, 2), diff(2, 3), diff(0, 3)]
    if min(d) < 120: ok = False; notes.append(f'cells nearly identical {d}')
    print(f'  {Path(path).name}: boxes {[(int(s["x1"] - s["x0"]), int(s["y1"] - s["y0"])) for s in st]} | area {area:.2f}x stand | diffs {d}')
    print('  ' + ('OK' if ok else 'FAIL: ' + '; '.join(notes)))
    return ok


def mouth(path):
    """불기 시트 c0 에서 분홍 꼭지 끝(가장 오른쪽 분홍 픽셀, 위 75% 안) → (x, y) 칸 좌표. 렌더러 MOUTH 표에 옮긴다"""
    a = np.array(Image.open(path).convert('RGBA'))[:, :CELL].astype(int); r, g, b, al = (a[..., k] for k in range(4))
    pink = (al >= ALPHA_MIN) & (r > 190) & (b > 110) & (g < r - 50) & (b < r - 10)
    ys, xs = np.nonzero(pink[:int(CELL * 0.75)])
    if not len(xs): return None
    k = xs.max(); sel = xs >= k - 2
    return int(k), int(round(ys[sel].mean()))


def pickup(c, kind, date, force, allow_fail):
    src = batch_dir(c, kind, date) / 'final' / f'{c}-{kind}.png'; dst = DEST / 'creatures' / f'{c}-{kind}.webp'
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and not force: sys.exit(f'refusing to overwrite {dst} (--force, and bump ASSET_VER in js/balloon-render.js)')
    if not verify(src, c, kind):
        if not allow_fail: sys.exit('verify failed — not picked up')
        print('  verify failed but --allow-fail given')
    W.to_webp(src, dst); print('copied', dst, f'{src.stat().st_size}→{dst.stat().st_size}B')
    if kind == 'blow': print('  mouth (nozzle tip) for js/balloon-render.js MOUTH:', mouth(src))


def strip_skins(out_path, looks):
    """스킨 대조 — 줄마다 한 look: 스킨 서기 4칸 | hang | blow | fall (없는 칸은 비움). 채택 전 눈 확인용"""
    bg = (110, 190, 100, 255); W4 = CELL * 4 + 8
    out = Image.new('RGBA', (W4 * 4, CELL * len(looks)), bg)
    for r, look in enumerate(looks):
        out.alpha_composite(Image.open(CREATURES / f'{look}.webp').convert('RGBA').crop((0, 0, CELL * 4, CELL)), (0, r * CELL))
        for i, kind in enumerate(KINDS):
            p = DEST / 'creatures' / f'{look}-{kind}.webp'
            if p.exists(): out.alpha_composite(Image.open(p).convert('RGBA'), ((i + 1) * W4, r * CELL))
    out.save(out_path); print('wrote', out_path)


def strip(out_path, kind):
    bg = (110, 190, 100, 255); rows = []
    for c in BASES:
        row = Image.new('RGBA', (CELL * 8 + 16, CELL), bg)
        row.alpha_composite(Image.open(CREATURES / f'{c}.webp').convert('RGBA').crop((0, 0, CELL * 4, CELL)), (0, 0))
        p = DEST / 'creatures' / f'{c}-{kind}.webp'
        if p.exists(): row.alpha_composite(Image.open(p).convert('RGBA'), (CELL * 4 + 16, 0))
        rows.append(row)
    out = Image.new('RGBA', (rows[0].width, CELL * len(rows)), bg)
    for i, r in enumerate(rows): out.alpha_composite(r, (0, i * CELL))
    out.save(out_path); print('wrote', out_path)


# ── 소품 ──
PROP_STYLE = ("Use `ref/style.png` (an existing sprite sheet of the game's characters) as a STYLE reference only — match its chibi pixel-art look: chunky dark-brown outline, "
              "flat cel shading with one highlight, warm saturated palette, crisp pixels. Do NOT draw that character.")
PROPS = {
    'balloon': ("balloon — rubber balloon + pop (4x1)",
                "Layout: exactly 4 columns x 1 row of equal TALL cells (each cell taller than wide), one item per cell:\n"
                "c0: ONE shiny RED party balloon, upright, slightly egg-shaped (taller than wide), a big soft white highlight at the upper left, a small tied KNOT at the bottom centre. NO string.\n"
                "c1: the SAME balloon at the instant it POPS — the rubber tearing open with a jagged burst outline and a few red rubber shreds just starting to fly out.\n"
                "c2: the pop a moment later — 6 to 8 red rubber shreds flying outward from the centre, no balloon left.\n"
                "c3: a few small red shreds drifting and falling, mostly gone.\n"
                "All four cells use the same red, same size scale, centred in their cell."),
    'chute': ("parachute canopy opening (4x1)",
              "Layout: exactly 4 columns x 1 row of equal WIDE cells, one item per cell. A small round PARACHUTE CANOPY with RED and WHITE alternating panels (like a little umbrella), seen from the side:\n"
              "c0: canopy still FOLDED — a small red/white bundle.\n"
              "c1: HALF open — canopy puffing up, narrow.\n"
              "c2: FULLY open — a wide dome, scalloped bottom edge.\n"
              "c3: fully open, very slightly tilted/swaying.\n"
              "Draw ONLY the canopy (no lines/cords hanging below it, no rider). Same palette in all cells, each canopy horizontally centred in its cell with its bottom edge at the same height."),
    'items': ("obstacles & props (4x2)",
              "Layout: exactly 4 columns x 2 rows of equal square cells, ONE item per cell, each item centred in its cell with padding:\n"
              "r0c0: a round spiky CHESTNUT BURR (brown-green spiky ball with a tiny chestnut peeking out), cute, hazardous.\n"
              "r0c1: a dark grey-purple STORM CLOUD, puffy, with an angry little frown face.\n"
              "r0c2: the SAME storm cloud FLASHING — lighter, glowing yellow-white edges, same shape and face (eyes squeezed).\n"
              "r0c3: a GRAVESTONE — a small rounded grey stone tombstone standing on a little patch of grass, NO text or letters on it (blank face), slightly cracked corner.\n"
              "r1c0: a vertical yellow LIGHTNING BOLT (zigzag), tall and narrow, bright yellow with orange outline.\n"
              "r1c1: a horizontal WOODEN PLANK platform (a short board with a small metal hinge at each end), seen from the side, long and thin.\n"
              "r1c2: a vertical strip of THORNY VINE (dark green vine with sharp thorns pointing right), tall and narrow, seamless top and bottom.\n"
              "r1c3: a horizontal grey METAL SHUTTER DOOR panel (one sliding panel with rivets and a yellow-black warning stripe at one end), long and thin.\n"
              "Same pixel-art style in all cells. No text."),
}


def scaffold_props(date):
    dst = OUT / f'balloon-props-{date}'
    if dst.exists(): sys.exit(f'exists: {dst}')
    for d in ('ref', 'source', 'final'): (dst / d).mkdir(parents=True)
    Image.open(CREATURES / 'hamster.webp').convert('RGBA').save(dst / 'ref' / 'style.png')
    jobs = []
    for key, (title, body) in PROPS.items():
        (dst / f'prompt-{key}.md').write_text(f"# {title}\n\n{PROP_STYLE}\n\n{body}\n\nBACKDROP: transparent (preferred) or one flat mid-green #6EBE64 — never on the items. No border, drawn grid, labels or watermark. Each item fully inside its cell. Large PNG.\n")
        jobs.append((f'source/{key}-attempt-NN.png', f'prompt-{key}.md', '`ref/style.png` as the only input image'))
    brief(dst, f'balloon-props-{date}', jobs, 'wrong number of cells/rows, items bleeding across cells, an item missing, text drawn, or (balloon) a string drawn')
    print(dst)


def fit(frame, box_w, box_h):
    s = min(box_w / frame.shape[1], box_h / frame.shape[0])
    return np.array(Image.fromarray(frame, 'RGBA').resize((max(1, round(frame.shape[1] * s)), max(1, round(frame.shape[0] * s))), Image.NEAREST)), s


def place(canvas, img, x, y):
    h, w = img.shape[:2]; sub = canvas[y:y + h, x:x + w]; m = img[..., 3] >= ALPHA_MIN; sub[m] = img[m]


def hue_set(rgb_img, target_hex):
    """빨강 풍선을 다른 색으로 — 채도 높은 픽셀만 색상·채도를 목표로, 명도는 유지(외곽선·하이라이트는 그대로)."""
    tr, tg, tb = (int(target_hex[i:i + 2], 16) / 255 for i in (1, 3, 5)); th, ts, tv = colorsys.rgb_to_hsv(tr, tg, tb)
    out = rgb_img.copy(); h, w = out.shape[:2]
    for y in range(h):
        for x in range(w):
            r, g, b, a = out[y, x]
            if a < ALPHA_MIN: continue
            hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if ss < 0.35 or vv < 0.25: continue
            nv = min(1, vv * (0.55 + 0.45 * tv / 0.9)) if tv < 0.9 else vv
            nr, ng, nb = colorsys.hsv_to_rgb(th, min(1, ss * (ts / 0.75) if ts < 0.75 else ss), nv)
            out[y, x, :3] = (round(nr * 255), round(ng * 255), round(nb * 255))
    return out


BALLOON_COLORS = ['#ff5a5f', '#ffb400', '#3db4f2', '#7ed957', '#c77dff', '#ff8fab', '#ff7b29', '#2ec4b6']   # js/balloon-render.js BALLOON 과 같은 순서
BAL_W, BAL_H = 96, 120            # 풍선 칸 — 매듭 아래 끝 = (48, BAL_KNOT_Y)
BAL_KNOT_Y = 116
CHUTE_W, CHUTE_H = 160, 112       # 낙하산 칸 — 캐노피 아랫단 = CHUTE_RIM_Y, 가운데 x = 80
CHUTE_RIM_Y = 108
ITEM_BOX = {   # 이름: (칸 크기 w, h, 정렬) — 아래 정렬(b) / 가운데(c)
    'chestnut': (64, 64, 'c'), 'storm': (192, 128, 'c'), 'storm-flash': (192, 128, 'c'), 'gravestone': (96, 128, 'b'),
    'bolt': (72, 288, 'c'), 'plank': (192, 32, 'c'), 'thorn': (32, 96, 'c'), 'shutter': (192, 32, 'c'),
}
ITEM_ORDER = ['chestnut', 'storm', 'storm-flash', 'gravestone', 'bolt', 'plank', 'thorn', 'shutter']


def props_repack(date, picks):
    dst = OUT / f'balloon-props-{date}'; fin = dst / 'final'
    # 풍선: 4칸 → 8색 × 4칸(행 = 색)
    fr, _ = cut_frames(np.array(Image.open(dst / 'source' / f'balloon-attempt-{picks.get("balloon", 1):02d}.png').convert('RGBA')), 4)
    s0 = min((BAL_W - 8) / fr[0].shape[1], (BAL_KNOT_Y - 4) / fr[0].shape[0])
    row = np.zeros((BAL_H, BAL_W * 4, 4), np.uint8)
    for i, f in enumerate(fr):
        si = s0 if i == 0 else min(s0, (BAL_W - 2) / f.shape[1], (BAL_H - 2) / f.shape[0])   # 터진 조각은 풍선보다 넓게 흩어진다 — 칸에 맞춰 줄인다(잘리지 않게)
        r = np.array(Image.fromarray(f, 'RGBA').resize((max(1, round(f.shape[1] * si)), max(1, round(f.shape[0] * si))), Image.NEAREST))
        x = i * BAL_W + (BAL_W - r.shape[1]) // 2
        cy = BAL_KNOT_Y - fr[0].shape[0] * s0 * 0.55   # 터짐 칸은 풍선 몸 가운데에 맞춘다
        y = BAL_KNOT_Y - r.shape[0] if i == 0 else round(cy - r.shape[0] / 2)
        place(row, r, x, int(max(1, min(BAL_H - r.shape[0] - 1, y))))
    sheet = np.zeros((BAL_H * len(BALLOON_COLORS), BAL_W * 4, 4), np.uint8)
    for k, col in enumerate(BALLOON_COLORS): sheet[k * BAL_H:(k + 1) * BAL_H] = hue_set(row, col)
    Image.fromarray(sheet, 'RGBA').save(fin / 'balloon.png'); print('balloon', sheet.shape, 'scale', round(s0, 3))
    # 낙하산: 4칸, 아랫단 정렬
    fr, _ = cut_frames(np.array(Image.open(dst / 'source' / f'chute-attempt-{picks.get("chute", 1):02d}.png').convert('RGBA')), 4)
    s1 = min((CHUTE_W - 8) / max(f.shape[1] for f in fr), (CHUTE_RIM_Y - 4) / max(f.shape[0] for f in fr))
    sheet = np.zeros((CHUTE_H, CHUTE_W * 4, 4), np.uint8)
    for i, f in enumerate(fr):
        r = np.array(Image.fromarray(f, 'RGBA').resize((max(1, round(f.shape[1] * s1)), max(1, round(f.shape[0] * s1))), Image.NEAREST))
        place(sheet, r, i * CHUTE_W + (CHUTE_W - r.shape[1]) // 2, CHUTE_RIM_Y - r.shape[0])
    Image.fromarray(sheet, 'RGBA').save(fin / 'chute.png'); print('chute', sheet.shape, 'scale', round(s1, 3))
    # 장애물·비석: 4×2 → 파일 하나씩
    src = np.array(Image.open(dst / 'source' / f'items-attempt-{picks.get("items", 1):02d}.png').convert('RGBA'))
    h = src.shape[0]
    for rowi in range(2):
        fr, _ = cut_frames(src[rowi * h // 2:(rowi + 1) * h // 2].copy(), 4)
        for ci, f in enumerate(fr):
            name = ITEM_ORDER[rowi * 4 + ci]; bw, bh, al = ITEM_BOX[name]
            r, s = fit(f, bw - 2, bh - 2); out = np.zeros((bh, bw, 4), np.uint8)
            place(out, r, (bw - r.shape[1]) // 2, bh - 1 - r.shape[0] if al == 'b' else (bh - r.shape[0]) // 2)
            Image.fromarray(out, 'RGBA').save(fin / f'{name}.png'); print(name, out.shape[:2][::-1], 'scale', round(s, 3))


def props_pickup(date):
    fin = OUT / f'balloon-props-{date}' / 'final'; (DEST / 'props').mkdir(parents=True, exist_ok=True)
    for p in sorted(fin.glob('*.png')):
        d = DEST / 'props' / (p.stem + '.webp'); W.to_webp(p, d); print('copied', d, d.stat().st_size, 'B')


# ── 스킨(데구리 deguri_skin 전부) — 기본 동물 포즈 시트에서 파생. 걷기 시트(walk-sheet.py)와 같은 갈래 ──
#   recolor  : recolor-creature.py PRESETS 가 있는 리컬러 스킨 — 프리셋 그대로(GPT 없음)
#   remap    : 프리셋은 없지만 기본 시트와 실루엣이 같은 색 스킨(일반 등급 20종) — 기본 main 시트 ↔ 스킨 main 시트의 같은 자리 픽셀로
#              "기본 색 → 스킨 색" 대응표를 만들어 포즈 시트에 입힌다(GPT 없음). 판정: 알파 IoU 1.0 · 대응 편차 < REMAP_DEV_MAX
#   pixelate : 도트 스킨 — pixelate-creature.py 방식(GPT 없음)
#   dress    : 장식·의상 스킨 — 기본 동물 포즈 시트(1번 입력) + 스킨 main 시트(2번 입력)로 옷만 입히기(GPT). 포즈는 그대로
REMAP_DEV_MAX = 5.0


def skin_kind(c, skin):
    rc = W.load_tool('recolor-creature'); px = W.load_tool('pixelate-creature')
    if skin in rc.PRESETS.get(c, {}): return 'recolor'
    if skin == 'dot' and c in px.PALETTES: return 'pixelate'
    a = np.array(Image.open(CREATURES / f'{c}.webp').convert('RGBA')); b = np.array(Image.open(CREATURES / f'{c}-{skin}.webp').convert('RGBA'))
    if a.shape == b.shape and np.array_equal(a[..., 3] >= ALPHA_MIN, b[..., 3] >= ALPHA_MIN) and remap_table(c, skin)[1] < REMAP_DEV_MAX: return 'remap'
    return 'dress'


def remap_table(c, skin):
    """기본 main 시트와 스킨 main 시트의 같은 자리 픽셀 → (기본 색 배열, 스킨 색 배열(중앙값), 가중 편차)."""
    a = np.array(Image.open(CREATURES / f'{c}.webp').convert('RGBA')).astype(int); b = np.array(Image.open(CREATURES / f'{c}-{skin}.webp').convert('RGBA')).astype(int)
    both = (a[..., 3] >= ALPHA_MIN) & (b[..., 3] >= ALPHA_MIN)
    ca, cb = a[both][:, :3], b[both][:, :3]
    keys = ca[:, 0] * 65536 + ca[:, 1] * 256 + ca[:, 2]
    order = np.argsort(keys, kind='stable'); k, v = keys[order], cb[order]
    uniq, idx = np.unique(k, return_index=True); idx = list(idx) + [len(k)]
    src, dst, dev, wt = [], [], [], []
    for i, key in enumerate(uniq):
        seg = v[idx[i]:idx[i + 1]]; med = np.median(seg, 0)
        src.append([key >> 16, (key >> 8) & 255, key & 255]); dst.append(med)
        if len(seg) > 20: dev.append(np.abs(seg - med).mean()); wt.append(len(seg))
    return (np.array(src), np.array(dst)), float(np.average(dev, weights=wt)) if dev else 99.0


def remap(c, skin, kinds=KINDS):
    (src, dst), dev = remap_table(c, skin)
    if dev >= REMAP_DEV_MAX: sys.exit(f'{c}-{skin}: not a pure recolour (map deviation {dev:.1f}) — use dress')
    for kind in kinds:
        base = np.array(Image.open(DEST / 'creatures' / f'{c}-{kind}.webp').convert('RGBA')).astype(int); out = base.copy()
        op = base[..., 3] >= ALPHA_MIN; pix = base[op][:, :3]
        nearest = np.empty(len(pix), int)
        for i0 in range(0, len(pix), 4096):   # 포즈 시트 색마다 가장 가까운 기본 색 → 그 스킨 색 + (원래 색 − 가까운 기본 색) — GPT 그림의 미세한 색 차이(음영)는 살린다
            d = ((pix[i0:i0 + 4096, None, :] - src[None, :, :]) ** 2).sum(-1); nearest[i0:i0 + 4096] = d.argmin(1)
        out_rgb = np.clip(dst[nearest] + (pix - src[nearest]), 0, 255)
        out[op, :3] = out_rgb.astype(int)
        save_skin(out.astype(np.uint8), c, skin, kind, f'remap (dev {dev:.1f})')


def recolor(c, skin, kinds=KINDS):
    rc = W.load_tool('recolor-creature')
    for kind in kinds:
        base = Image.open(DEST / 'creatures' / f'{c}-{kind}.webp')
        out = rc.apply_preset(base, rc.PRESETS[c][skin])
        save_skin(np.array(out.convert('RGBA')), c, skin, kind, 'recolor preset')


def pixelate(c, skin, kinds=KINDS):
    px = W.load_tool('pixelate-creature')
    pal = np.array([q[:3] for q in px.PALETTES[c]], dtype=np.int32)
    weight = np.array([q[3] if len(q) > 3 else 1 for q in px.PALETTES[c]], dtype=np.float64)
    dark = pal.max(-1) / 255.0 < px.DARK_V; keep = weight >= px.EDGE_KEEP_WEIGHT; g = px.GRID
    for kind in kinds:
        a = np.array(Image.open(DEST / 'creatures' / f'{c}-{kind}.webp').convert('RGBA'))
        small = np.zeros((g, g * COLS, 4), dtype=np.uint8)
        for i in range(COLS): small[:, i * g:(i + 1) * g] = px.pixelate_cell(a[:, i * CELL:(i + 1) * CELL], pal, dark, weight, keep)
        save_skin(np.array(Image.fromarray(small, 'RGBA').resize((CELL * COLS, CELL), Image.NEAREST)), c, skin, kind, 'pixelate')


def save_skin(arr, c, skin, kind, how):
    base = np.array(Image.open(DEST / 'creatures' / f'{c}-{kind}.webp').convert('RGBA'))
    if how != 'pixelate' and not np.array_equal(base[..., 3] >= ALPHA_MIN, arr[..., 3] >= ALPHA_MIN): sys.exit(f'{c}-{skin}-{kind}: alpha changed')
    tmp = OUT / 'balloon-skins-derived'; tmp.mkdir(exist_ok=True); png = tmp / f'{c}-{skin}-{kind}.png'
    Image.fromarray(arr, 'RGBA').save(png); dst = DEST / 'creatures' / f'{c}-{skin}-{kind}.webp'
    W.to_webp(png, dst); print('wrote', dst.name, how)


def scaffold_skin(c, skin, kind, date):
    look = f'{c}-{skin}'; dst = batch_dir(look, kind, date)
    if dst.exists(): sys.exit(f'exists: {dst}')
    for d in ('ref', 'source', 'final'): (dst / d).mkdir(parents=True)
    Image.open(DEST / 'creatures' / f'{c}-{kind}.webp').convert('RGBA').save(dst / 'ref' / f'{c}-{kind}.png')
    Image.open(CREATURES / f'{look}.webp').convert('RGBA').save(dst / 'ref' / f'{look}.png')
    what = {'hang': 'floating with a balloon (paws up on the string)', 'blow': 'blowing up a balloon', 'fall': 'shocked + falling'}[kind]
    keep = {'hang': 'the raised paws holding the short dark string stub at the top centre (the string stub must stay exactly where it is)',
            'blow': 'the paws holding the small pink nozzle at the mouth (keep the pink nozzle)',
            'fall': 'the shocked face in c0 and the tumbling limbs in c1-c3'}[kind]
    (dst / 'prompt.md').write_text(f"""# {look} — {what} (4x1)

EDIT the reference pose sheet `ref/{c}-{kind}.png` (use it as the FIRST input image of the image tool) into the shop skin `{look}`.
SECOND INPUT IMAGE: `ref/{look}.png`, the existing sprite sheet of this skin (row 0 = its standing poses). The costume / colours / accessories / markings in the new sheet must be the SAME DESIGN as in that sheet — same pieces, shapes, colours, patterns and proportions on the body, same face and eye style. Do not reinvent or restyle it, and do NOT keep any colour or marking of the plain {c} that the skin does not have.
Preserve EXACTLY each cell's pose from the first image — body angle, {keep}, limb and tail positions — and its chibi pixel-art style, chunky dark outline, lighting and body proportions. Same 4 columns x 1 row layout, one pose per cell, same order.
The costume must be visible in EVERY cell.

All cells face RIGHT in side profile. No ground, no shadow, no balloon, no text, no second character.
BACKDROP: a transparent background is fine (preferred), or one {W.BACKDROP.get(c, 'flat mid-green #6EBE64')}. Never draw the backdrop colour on the character. No border, drawn grid, labels or watermark.
Each frame fully inside its cell with padding, no bleed into neighbour cells. Large PNG.
""")
    brief(dst, f'balloon-{kind}-{date}/{look}', [(f'source/{look}-{kind}-attempt-NN.png', 'prompt.md', f'`ref/{c}-{kind}.png` as the first input image and `ref/{look}.png` as the second')],
          'not exactly 4 cells in one row, a cell missing, frames bleeding across cells, the character facing LEFT, the pose changed from the first input, the costume missing, or text/labels/grid lines drawn')
    print(dst)


if __name__ == '__main__':
    flags = [x for x in sys.argv[1:] if x.startswith('--')]; args = [x for x in sys.argv[1:] if not x.startswith('--')]
    if not args: sys.exit(__doc__)
    cmd = args[0]; today = datetime.date.today().isoformat()
    if cmd == 'scaffold': scaffold(args[1], args[2], args[3] if len(args) > 3 else today)
    elif cmd == 'repack': sys.exit(0 if repack(args[1], args[2], int(args[3]) if len(args) > 3 else 1, args[4] if len(args) > 4 else today) else 1)
    elif cmd == 'verify': sys.exit(0 if verify(args[1], args[2], args[3]) else 1)
    elif cmd == 'pickup': pickup(args[1], args[2], args[3] if len(args) > 3 else today, '--force' in flags, '--allow-fail' in flags)
    elif cmd == 'strip': strip(args[1], args[2])
    elif cmd == 'strip-skins': strip_skins(args[1], args[2:])
    elif cmd == 'mouth': print({c: mouth(DEST / 'creatures' / f'{c}-blow.webp') for c in BASES if (DEST / 'creatures' / f'{c}-blow.webp').exists()})
    elif cmd == 'scaffold-props': scaffold_props(args[1] if len(args) > 1 else today)
    elif cmd == 'props-repack':
        date = next((x for x in args[1:] if '=' not in x), today)
        props_repack(date, {k: int(v) for k, v in (x.split('=') for x in args[1:] if '=' in x)})
    elif cmd == 'props-pickup': props_pickup(args[1] if len(args) > 1 else today)
    elif cmd == 'skin-kind': print(skin_kind(args[1], args[2]))
    elif cmd in ('recolor', 'remap', 'pixelate'): {'recolor': recolor, 'remap': remap, 'pixelate': pixelate}[cmd](args[1], args[2], tuple(args[3:]) or KINDS)
    elif cmd == 'scaffold-skin': scaffold_skin(args[1], args[2], args[3], args[4] if len(args) > 4 else today)
    else: sys.exit(__doc__)
