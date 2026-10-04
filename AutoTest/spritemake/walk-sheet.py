#!/usr/bin/env python3
"""데구리 걷기 시트({look}-walk.webp — 4×1, 칸 160, 오른쪽 향함) 만들기: 스캐폴드 → (Codex 가 그림) → 리팩·검증 → 인수, 그리고 리컬러·도트 스킨용 파생.
명세: docs/goal/marble-walk-sheets.md. GPT(Codex exec)는 그리기만, 자르기·배율·정렬·판정은 여기서 한다.

칸 순서(4칸이 한 바퀴): c0 디딤 A(가장 낮음) → c1 넘김 A(발 듦) → c2 디딤 B(반대 발) → c3 넘김 B. 렌더러(js/marble-render.js stepPose)가 걸은 거리로 칸을 고른다.
깡충 걸음(GAIT_HOP — 토끼)은 한 바퀴가 한 번 뜀: c0 웅크림 → c1 박차기 → c2 공중 → c3 착지.
규격: 몸 넓이(불투명 픽셀 수) = 기본 시트 row 0(서기 4칸) 몸 넓이의 중앙값 — 키로 맞추면 서 있다가 엎드려 걷는 동물(아르마딜로·공벌레)이 커진다. 발바닥선 y=150, 가로는 윗몸(위 60%) 무게중심을 기본 시트 서기와 같은 x 에 — 서기↔걷기 전환과 칸 사이에서 몸이 안 튄다.

usage (파이썬은 /opt/homebrew/bin/python3, 배치 폴더 쓰기·Codex 실행은 샌드박스 해제):
  walk-sheet.py scaffold <look> [date] [--posture=biped|quad]   # SpriteMake/output/marble-run-walk-<date>/<look>/ 에 ref·prompt·CODEX-BRIEF. 기본 동물은 새 포즈, 스킨은 기본 동물 걷기 시트에 의상 입히기.
                                                # --posture: 스킨의 서기 자세가 기본 동물과 다를 때(네 발 돼지 → 두 발로 선 파일럿 돼지) 스킨 main 시트에서 새 포즈로 그린다
  walk-sheet.py repack <look> [attempt] [date]  # source/<look>-walk-attempt-NN.png → final/<look>-walk.png + 검증 수치
  walk-sheet.py verify <png> <look>             # 규격 검사만(webp 를 풀어서 다시 볼 때)
  walk-sheet.py pickup <look> [date] [--force] [--allow-fail]  # final → assets/marble/creatures/<look>-walk.webp (pngquant --nofs + cwebp 무손실, 알파 마스크 불변 확인).
                                                # --allow-fail: 검사 불합격을 눈으로 확인하고 받아들일 때만(사유를 의뢰 기록에)
  walk-sheet.py recolor <creature> <skin>       # 리컬러 스킨: 기본 걷기 시트에 recolor-creature.py PRESETS 적용
  walk-sheet.py pixelate <creature> <skin>      # 도트 스킨: 기본 걷기 시트를 pixelate-creature.py 방식으로
  walk-sheet.py strip <out.png> <look>...       # 눈으로 볼 대조 그림(서기 4칸 | 걷기 4칸, 줄마다 한 look)
"""
import datetime, hashlib, importlib.util, json, os, subprocess, sys, tempfile
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image

OUT = Path('/Users/radar/Work/SpriteMake/output')
GAME = Path(__file__).resolve().parents[2]
CREATURES = GAME / 'assets' / 'marble' / 'creatures'
CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'
CELL, COLS, PLANE = 160, 4, 150
ALPHA_MIN = 8
BG_DELTA = 60            # 배경 flood 허용 편차(채널 최대 차) — 기존 리팩 도구와 같은 값
BODY_MIN_SHARE = 0.03    # 가장 큰 덩어리의 이 비율 이상이면 몸(나머지는 위성)
SAT_KEEP_PAD = 0.04      # 몸 bbox 를 이만큼(가로·세로 비율) 넓힌 안에 있는 위성만 남긴다(끊어진 귀 끝 등) — 먼지·그림자·동작선은 버린다
TOP_SHARE = 0.6          # 가로 정렬에 쓰는 윗몸 비율
MAX_W, MAX_H = 152, 140  # 칸 안전 한계(넘으면 배율을 줄인다)
BASES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig']

LEGS = ("The character has a NEAR leg (closest to the viewer, drawn in the normal colour) and a FAR leg (on the other side of the body, drawn slightly DARKER and partly hidden behind the near one). "
        "Both must be visible in every cell, and the cells must show them trading places — never the same leg leading twice.\n")
BIPED = (LEGS +
         "c0 CONTACT A: legs spread wide like open scissors — the NEAR foot is stretched FORWARD (to the right) with its heel on the ground, the FAR foot is stretched BACK (to the left) with its toe on the ground. Near arm swung back, far arm swung forward. Body at its lowest.\n"
         "c1 PASSING A: the NEAR foot is flat on the ground directly under the body, carrying the weight; the FAR leg is bent and its foot is lifted clearly OFF the ground, swinging forward beside the near leg. Body at its highest.\n"
         "c2 CONTACT B: legs spread wide like open scissors the OTHER way — the FAR (darker) foot is stretched FORWARD with its heel on the ground, the NEAR foot is stretched BACK with its toe on the ground. Arms opposite to c0.\n"
         "c3 PASSING B: the FAR (darker) foot is flat on the ground under the body; the NEAR leg is bent and its foot is lifted clearly OFF the ground, swinging forward.\n"
         "In c0 and c2 the two feet are far apart (a wide stride); in c1 and c3 the feet are close together under the body with one foot in the air. "
         "It walks upright on two feet exactly as it stands in row 0 of the reference — do not make it stand still with only one leg kicking.")
QUAD = (LEGS.replace('a NEAR leg', 'NEAR-side legs').replace('a FAR leg', 'FAR-side legs').replace('the near one', 'the near ones') +
        "It walks on all four legs with the same body posture as row 0 of the reference. Make the leg movement LARGE and obvious.\n"
        "c0 CONTACT A: the NEAR front leg and the FAR hind leg reach clearly FORWARD (angled about 35 degrees), the NEAR hind leg and the FAR front leg are pushed clearly BACK — feet far apart, body at its lowest.\n"
        "c1 PASSING A: the NEAR front leg and FAR hind leg stand straight under the body carrying the weight; the NEAR hind leg and FAR front leg are bent and lifted clearly OFF the ground (a visible gap under the feet), swinging forward. Body at its highest.\n"
        "c2 CONTACT B: the opposite of c0 — the NEAR hind leg and the FAR front leg reach clearly FORWARD, the NEAR front leg and the FAR hind leg are pushed clearly BACK.\n"
        "c3 PASSING B: the opposite of c1 — the NEAR hind leg and FAR front leg stand straight; the NEAR front leg and FAR hind leg are bent and lifted clearly OFF the ground, swinging forward.\n"
        "c0 and c2 must be clearly different drawings (the near front leg is forward in c0 and back in c2), and so must c1 and c3 (the near front leg is on the ground in c1 and in the air in c3).")
FRAMES = {
    'hedgehog': BIPED, 'panda': BIPED, 'hamster': BIPED,
    'armadillo': QUAD + " The tail tip sways slightly.", 'turtle': QUAD + " The head bobs slightly forward in the contact cells.",
    'raccoon': QUAD + " The striped tail sways slightly up and down.", 'ribbonpig': QUAD + " The curly tail bounces slightly.",
    'pillbug': ("It crawls on its row of short legs (count the visible legs from the head: 1, 2, 3, 4). Draw the legs a little longer than in the reference so their movement reads clearly.\n"
                "c0: legs 1 and 3 swing clearly FORWARD (angled toward the head), legs 2 and 4 are pushed clearly BACK (angled toward the rear); body at its lowest; antennae tipped forward.\n"
                "c1: legs 1 and 3 stand straight down on the ground; legs 2 and 4 are lifted clearly OFF the ground and swinging forward; body raised 2-3 pixels; antennae upright.\n"
                "c2: the opposite of c0 — legs 2 and 4 swing clearly FORWARD, legs 1 and 3 are pushed clearly BACK; body at its lowest; antennae tipped back.\n"
                "c3: legs 2 and 4 stand straight down; legs 1 and 3 are lifted clearly OFF the ground and swinging forward; body raised 2-3 pixels; antennae upright.\n"
                "The shell segments, head and face stay the same drawing in all four cells. c0 and c2 must be clearly different, and so must c1 and c3."),
    'pufferfish': ("It has NO legs and must not grow any: it wiggles forward on its fins just above the ground line.\n"
                   "c0: tail fin swung UP, side fin pressed DOWN, body at its lowest.\n"
                   "c1: tail fin and side fin level, body slightly higher.\n"
                   "c2: tail fin swung DOWN, side fin raised UP, body at its lowest.\n"
                   "c3: tail fin and side fin level the other way (side fin slightly forward), body slightly higher.\n"
                   "The round body, spikes and face stay the same drawing in all four cells."),
    'rabbit': ("It moves by HOPPING like a real rabbit. The four cells are ONE single hop, in order, and the loop repeats.\n"
               "In ALL four cells the rabbit is on all fours with a LOW, HORIZONTAL body (back roughly level, head at the right, ears laid back along the neck at about the same angle) — "
               "it is NEVER sitting upright and NEVER standing on its hind legs. The head and face are the same drawing in all four cells.\n"
               "c0 CROUCH: on the ground, body compact and rounded, hind legs folded under the rump, front paws on the ground under the chest.\n"
               "c1 PUSH-OFF: the hind feet are still on the ground and the hind legs are stretching out behind; the front paws have left the ground and reach forward; the body stretches and tilts slightly up at the front.\n"
               "c2 FLIGHT: fully in the air, body stretched long, front paws reaching forward, hind legs trailing straight behind, tail up.\n"
               "c3 LANDING: the front paws touch the ground, the rump is slightly raised and the hind legs are tucked forward under the belly, about to land.\n"
               "Body length changes (compact in c0, longest in c2) but the body never rotates upright."),
}
GAIT_HOP = {'rabbit'}    # 한 바퀴 = 한 번 뜀(웅크림 · 박차기 · 공중 · 착지) — 렌더러 js/marble-render.js HOP_GAIT 과 같은 목록
LEG_ZONE, LEG_DIFF_MIN = 0.35, 20.0   # 걷는 동물: 다리 구역(몸 아래 35%)에서 디딤 A·B, 넘김 A·B 가 각각 이 비율(%) 이상 달라야 한다 — 같은 다리만 두 번 그린 시트(2026-10-02 고슴도치 3%·판다 11%)를 거른다
BACKDROP = {'turtle': 'flat lavender #B9A7E8'}   # 초록 동물은 초록 배경과 섞인다


def creature_of(look): return next(b for b in sorted(BASES, key=len, reverse=True) if look == b or look.startswith(b + '-'))
def batch_dir(look, date): return OUT / f'marble-run-walk-{date}' / look


def prompt_base(look, creature, frames=None):
    return f"""# {look} — walk cycle (4x1)

Use `ref/{look}.png` as the FIRST input image of the image tool. It is the existing sprite sheet of this character; row 0 (top row) shows its standing/idle poses, facing right.
Draw a NEW sprite sheet of the SAME character: a 4-frame {'HOP' if creature in GAIT_HOP and not frames else 'WALK'} CYCLE seen from the side, facing RIGHT.
Preserve EXACTLY the reference's chibi pixel-art style, chunky dark outline, palette, lighting, face, body proportions and size. It must look like the row-0 character taking steps — not a redesign.

Layout: exactly 4 columns x 1 row of equal cells (a wide landscape image), one pose per cell, loop order c0 -> c1 -> c2 -> c3 -> c0:
{frames or FRAMES[creature]}

Rules:
- {'The head and face are the same drawing in all four cells; the body only stretches and compacts as described.' if creature in GAIT_HOP and not frames else 'Head, face and torso are the same drawing in all four cells (at most a tiny 1-2 pixel bob); only the legs/feet/fins (and a slight sway of arms, ears or tail) change.'}
- c0 and c2 must be clearly different from each other, and so must c1 and c3.
- Same character size in every cell, the lowest point of every cell on the same ground line, the character centred in its cell (it walks in place).
- All cells face RIGHT in side profile. No ground, no shadow, no dust, no motion lines, no sparkles, no marks above the head, no text, no second character.

BACKDROP: a transparent background is fine (preferred), or one {BACKDROP.get(creature, 'flat mid-green #6EBE64')}. Never draw the backdrop colour on the character. No border, drawn grid, labels or watermark.
Each frame fully inside its cell with padding, no bleed into neighbour cells. Large PNG.
"""


def prompt_skin(look, creature):
    return f"""# {look} — walk cycle (4x1)

EDIT the reference walk-cycle sheet `ref/{creature}-walk.png` (use it as the FIRST input image of the image tool) into the shop skin `{look}`.
SECOND INPUT IMAGE: `ref/{look}.png`, the existing sprite sheet of this skin (row 0 = its standing poses). The costume / colours / accessories in the new sheet must be the SAME DESIGN as in that sheet — same pieces, shapes, colours, patterns and proportions on the body. Do not reinvent or restyle it.
Preserve EXACTLY each cell's pose from the first image — the leg, foot, fin, ear and tail positions of the walk cycle must not change — and its chibi pixel-art style, chunky dark outline, lighting, face and body proportions. Same 4 columns x 1 row layout, one pose per cell, same order.
The costume must be visible in EVERY cell and must not hide the legs/feet that carry the walk cycle.

All cells face RIGHT in side profile. No ground, no shadow, no dust, no motion lines, no sparkles, no text, no second character.
BACKDROP: a transparent background is fine (preferred), or one {BACKDROP.get(creature, 'flat mid-green #6EBE64')}. Never draw the backdrop colour on the character. No border, drawn grid, labels or watermark.
Each frame fully inside its cell with padding, no bleed into neighbour cells. Large PNG.
"""


def scaffold(look, date, posture=None):
    creature = creature_of(look); dst = batch_dir(look, date); is_base = look == creature or bool(posture)
    if dst.exists(): sys.exit(f'exists: {dst}')
    for d in ('ref', 'source', 'final'): (dst / d).mkdir(parents=True)
    Image.open(CREATURES / f'{look}.webp').convert('RGBA').save(dst / 'ref' / f'{look}.png')
    if not is_base:
        bw = CREATURES / f'{creature}-walk.webp'
        if not bw.exists(): sys.exit(f'base walk sheet missing: {bw} — do the base creature first')
        Image.open(bw).convert('RGBA').save(dst / 'ref' / f'{creature}-walk.png')
    (dst / 'prompt.md').write_text(prompt_base(look, creature, {'biped': BIPED, 'quad': QUAD}.get(posture)) if is_base else prompt_skin(look, creature))
    inputs = f'`ref/{look}.png` as the only input image' if is_base else f'`ref/{creature}-walk.png` as the first input image and `ref/{look}.png` as the second'
    (dst / 'CODEX-BRIEF.md').write_text(f"""You are generating one raw sprite sheet for SpriteMake batch `marble-run-walk-{date}/{look}` (cwd = {dst}).
Your job is ONLY to DRAW with the built-in image generation tool. Do NOT write any scripts, do NOT crop/repack/resize/edit pixels, do NOT touch any other folder.

1. Generate the sheet described in `prompt.md` with the image tool, passing {inputs}, plus the prompt text.
2. Save the raw result as `source/{look}-walk-attempt-01.png`.
3. Look at it. A TRANSPARENT background is GOOD (it may look black in some viewers) and slight backdrop tone variation is fine — never retry for the background.
   Regenerate (attempt-02, then attempt-03 at most) ONLY for hard failures: not exactly 4 cells in one row, a cell missing or holding two poses, frames bleeding across cells, the character facing LEFT,
   the four cells being the same pose (no visible leg/fin change), the character redesigned, or text/labels/grid lines drawn.
4. Write `REPORT.md`: attempts made and one line of observations per attempt. Do not pick a winner — every attempt is reviewed by someone else.
""")
    print(dst)
    print(f"run: ( {CODEX} exec -C {dst} -s workspace-write -c 'approval_policy=\"never\"' --enable image_generation --skip-git-repo-check -o {dst}/codex-last.md - < {dst}/CODEX-BRIEF.md > {dst}/codex.log 2>&1 )")


# ── 리팩 ──
def remove_backdrop(a):
    """모서리 색과 가까운(BG_DELTA) 픽셀 중 테두리에서 이어진 것만 투명으로. 이미 투명 배경이면 그대로."""
    h, w = a.shape[:2]; alpha = a[..., 3]
    corners = [a[y, x, :3].astype(int) for y, x in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)) if alpha[y, x] >= ALPHA_MIN]
    if not corners: return a, None
    rgb = a[..., :3].astype(int)
    cand = np.zeros((h, w), bool)
    for c in corners: cand |= np.abs(rgb - c).max(-1) <= BG_DELTA
    cand &= alpha >= ALPHA_MIN
    seen = np.zeros((h, w), bool); q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not seen[ny, nx]: seen[ny, nx] = True; q.append((ny, nx))
    out = a.copy(); out[seen] = 0
    return out, np.mean(corners, 0)


def bg_like(rgb, bg):
    """배경 물이 든 색인가 — 배경과 가깝거나 배경과 같은 계열이 우세."""
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    near = np.abs(rgb.astype(int) - bg.astype(int)).max(-1) <= BG_DELTA
    if bg[1] > bg[0] + 30 and bg[1] > bg[2] + 30: return near | ((g > r + 30) & (g > b + 30))
    if bg[2] > bg[1] + 20 and bg[0] > bg[1]: return near | ((b > g + 35) & (r > g + 10) & (b >= r - 10))
    return near


def despill(a, bg):
    """가장자리(투명과 2px 이내)의 배경 물든 픽셀을 가장 가까운 안쪽 색으로 바꾼다(지우지 않는다 — 발바닥선이 무너진다)."""
    if bg is None: return a, 0
    op = a[..., 3] >= ALPHA_MIN; h, w = op.shape
    near_clear = np.zeros((h, w), bool)
    pad = np.pad(~op, 2, constant_values=True)
    for dy in range(5):
        for dx in range(5): near_clear |= pad[dy:dy + h, dx:dx + w]
    rim = op & near_clear & bg_like(a[..., :3], bg)
    good = op & ~rim; out = a.copy(); fixed = 0
    ys, xs = np.nonzero(rim)
    for y, x in zip(ys, xs):
        done = False
        for rad in range(1, 9):
            y0, y1, x0, x1 = max(0, y - rad), min(h, y + rad + 1), max(0, x - rad), min(w, x + rad + 1)
            gy, gx = np.nonzero(good[y0:y1, x0:x1])
            if len(gy):
                k = np.argmin((gy + y0 - y) ** 2 + (gx + x0 - x) ** 2); out[y, x, :3] = a[gy[k] + y0, gx[k] + x0, :3]; fixed += 1; done = True; break
        if not done: out[y, x] = 0
    return out, fixed


def components(mask):
    """8-연결 덩어리 → [(area, x0, y0, x1, y1, cx, 픽셀 flat index 배열)] (큰 것부터)."""
    h, w = mask.shape; lab = np.zeros((h, w), np.int32); comps = []; flat = mask.ravel()
    for start in np.flatnonzero(flat):
        if lab.flat[start]: continue
        n = len(comps) + 1; lab.flat[start] = n; q = [start]; i = 0
        while i < len(q):
            p = q[i]; i += 1; y, x = divmod(p, w)
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < 0 or ny >= h: continue
                for dx in (-1, 0, 1):
                    nx = x + dx
                    if nx < 0 or nx >= w: continue
                    k = ny * w + nx
                    if flat[k] and not lab.flat[k]: lab.flat[k] = n; q.append(k)
        idx = np.array(q); ys, xs = np.divmod(idx, w)
        comps.append((len(q), xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, xs.mean(), idx))
    return sorted(comps, key=lambda c: -c[0])


def top_centroid_x(alpha):
    """윗몸(위 TOP_SHARE)의 가로 무게중심 — 다리가 벌어져도 안 흔들린다."""
    ys, xs = np.nonzero(alpha >= ALPHA_MIN); y0, y1 = ys.min(), ys.max() + 1
    sel = ys < y0 + (y1 - y0) * TOP_SHARE
    return xs[sel].mean()


def stand_reference(look):
    """기본 시트 row 0 네 칸의 몸(가장 큰 덩어리) 넓이(픽셀 수)·윗몸 무게중심 x — 중앙값."""
    a = np.array(Image.open(CREATURES / f'{look}.webp').convert('RGBA'))
    hs, cxs = [], []
    for c in range(COLS):
        cell = a[0:CELL, c * CELL:(c + 1) * CELL, 3].copy()
        big = components(cell >= ALPHA_MIN)[0]
        body = np.zeros(CELL * CELL, bool); body[big[6]] = True; body = body.reshape(CELL, CELL)
        hs.append(big[0]); cxs.append(top_centroid_x(np.where(body, 255, 0)))
    return float(np.median(hs)), float(np.median(cxs))


def repack(look, attempt, date):
    dst = batch_dir(look, date); src = dst / 'source' / f'{look}-walk-attempt-{attempt:02d}.png'
    a = np.array(Image.open(src).convert('RGBA'))
    a, bg = remove_backdrop(a)
    a[a[..., 3] < 128] = 0; a[..., 3] = np.where(a[..., 3] >= 128, 255, 0).astype(np.uint8)   # 알파는 0/255 — 반투명 테두리는 줄였을 때 어두운 halo 가 된다
    a, fixed = despill(a, bg)
    h, w = a.shape[:2]; comps = components(a[..., 3] >= ALPHA_MIN)
    if not comps: sys.exit('empty image')
    big = [c for c in comps if c[0] >= comps[0][0] * BODY_MIN_SHARE]; sats = [c for c in comps if c[0] < comps[0][0] * BODY_MIN_SHARE]
    cells = [[] for _ in range(COLS)]
    for c in big: cells[min(COLS - 1, int(c[5] // (w / COLS)))].append(c)
    if any(not g for g in cells): sys.exit(f'cell without a body: {[len(g) for g in cells]} bodies per cell — wrong layout?')
    frames, dropped, kept = [], 0, 0
    for g in cells:
        x0, y0, x1, y1 = min(c[1] for c in g), min(c[2] for c in g), max(c[3] for c in g), max(c[4] for c in g)
        px, py = (x1 - x0) * SAT_KEEP_PAD, (y1 - y0) * SAT_KEEP_PAD
        mine = list(g)
        for s in sats:
            if s[1] >= x0 - px and s[3] <= x1 + px and s[2] >= y0 - py and s[4] <= y1 + py: mine.append(s); kept += s[0]
        m = np.zeros(h * w, bool)
        for c in mine: m[c[6]] = True
        m = m.reshape(h, w); x0, y0, x1, y1 = min(c[1] for c in mine), min(c[2] for c in mine), max(c[3] for c in mine), max(c[4] for c in mine)
        crop = a[y0:y1, x0:x1].copy(); crop[~m[y0:y1, x0:x1]] = 0
        frames.append(crop)
    dropped = sum(s[0] for s in sats) - kept
    stand_h, stand_cx = stand_reference(look)
    s = (stand_h / float(np.median([(f[..., 3] >= ALPHA_MIN).sum() for f in frames]))) ** 0.5
    s = min(s, MAX_W / max(f.shape[1] for f in frames), MAX_H / max(f.shape[0] for f in frames))
    sheet = np.zeros((CELL, CELL * COLS, 4), np.uint8); info = []
    for i, f in enumerate(frames):
        fw, fh = max(1, round(f.shape[1] * s)), max(1, round(f.shape[0] * s))
        r = np.array(Image.fromarray(f, 'RGBA').resize((fw, fh), Image.NEAREST))   # 최근접 — 기존 시트와 같은 방식
        ox = int(round(stand_cx - top_centroid_x(r[..., 3]))); ox = max(2, min(CELL - 2 - fw, ox)); oy = PLANE - fh
        sheet[oy:oy + fh, i * CELL + ox:i * CELL + ox + fw] = r
        info.append((fw, fh, ox))
    out = dst / 'final' / f'{look}-walk.png'; Image.fromarray(sheet, 'RGBA').save(out)
    print(f'{look} attempt {attempt}: source {w}x{h} bg {"transparent" if bg is None else tuple(int(v) for v in bg)} despill {fixed} | scale {s:.3f} (stand area {stand_h:.0f}, cx {stand_cx:.1f}) | frames {info} | satellites kept {kept}px dropped {dropped}px')
    return verify(out, look)


def cell_stats(sheet, c):
    cell = sheet[:, c * CELL:(c + 1) * CELL]; ys, xs = np.nonzero(cell[..., 3] >= ALPHA_MIN)
    return dict(x0=int(xs.min()), y0=int(ys.min()), x1=int(xs.max()) + 1, y1=int(ys.max()) + 1, cx=float(top_centroid_x(cell[..., 3])), n=len(xs))


def verify(path, look):
    im = Image.open(path).convert('RGBA'); a = np.array(im); ok = True; notes = []
    if im.size != (CELL * COLS, CELL): return print('FAIL size', im.size) or False
    a17 = int(((a[..., 3] > 0) & (a[..., 3] < ALPHA_MIN)).sum())
    if a17: ok = False; notes.append(f'alpha1-7 {a17}')
    st = []
    for c in range(COLS):
        if not (a[:, c * CELL:(c + 1) * CELL, 3] >= ALPHA_MIN).any(): return print(f'FAIL empty cell c{c}') or False
        st.append(cell_stats(a, c))
    stand_h, stand_cx = stand_reference(look)
    hs = [s['y1'] - s['y0'] for s in st]; bottoms = [s['y1'] for s in st]; drift = max(s['cx'] for s in st) - min(s['cx'] for s in st)
    if any(b != PLANE for b in bottoms): ok = False; notes.append(f'bottoms {bottoms}')
    area = float(np.median([s['n'] for s in st])) / stand_h
    if not 0.9 <= area <= 1.1: ok = False; notes.append(f'body area {area:.2f} x stand')
    if drift > 2.5: ok = False; notes.append(f'upper-body drift {drift:.1f}px')
    if any(abs(s['cx'] - stand_cx) > 3 for s in st): notes.append('clamped off the stand centre')
    def diff(i, j): return int((a[:, i * CELL:(i + 1) * CELL] != a[:, j * CELL:(j + 1) * CELL]).any(-1).sum())
    d = {f'{i}{j}': diff(i, j) for i, j in ((0, 1), (1, 2), (2, 3), (3, 0), (0, 2), (1, 3))}
    if min(d.values()) < 150: ok = False; notes.append('two cells nearly identical')
    def legdiff(i, j):   # 다리 구역(몸 아래 LEG_ZONE)에서 두 칸이 다른 픽셀 비율(%)
        ci, cj = a[:, i * CELL:(i + 1) * CELL].astype(int), a[:, j * CELL:(j + 1) * CELL].astype(int)
        op = (ci[..., 3] >= ALPHA_MIN) | (cj[..., 3] >= ALPHA_MIN); top = np.nonzero(op.any(1))[0].min()
        zone = np.zeros_like(op); zone[int(PLANE - (PLANE - top) * LEG_ZONE):] = True; vis = op & zone
        return 100.0 * (((np.abs(ci[..., :3] - cj[..., :3]).max(-1) > 40) | ((ci[..., 3] >= ALPHA_MIN) != (cj[..., 3] >= ALPHA_MIN))) & vis).sum() / max(vis.sum(), 1)
    legs = (legdiff(0, 2), legdiff(1, 3))
    if creature_of(look) != 'pufferfish' and creature_of(look) not in GAIT_HOP and min(legs) < LEG_DIFF_MIN: ok = False; notes.append(f'same legs twice (A/B leg-zone diff {legs[0]:.0f}% / {legs[1]:.0f}%)')
    edge = rim = 0
    op = a[..., 3] >= ALPHA_MIN; pad = np.pad(~op, 1, constant_values=True); e = np.zeros_like(op)
    for dy in range(3):
        for dx in range(3): e |= pad[dy:dy + CELL, dx:dx + CELL * COLS]
    e &= op; r, g, b = (a[..., k].astype(int) for k in range(3))
    edge = int(e.sum()); green = int((e & (g > r + 30) & (g > b + 30)).sum()); purple = int((e & (b > g + 35) & (r > g + 10) & (b >= r - 10)).sum())
    print(f'  {Path(path).name}: heights {hs} widths {[s["x1"] - s["x0"] for s in st]} bottoms {bottoms} | upper-body cx {[round(s["cx"], 1) for s in st]} (stand {stand_cx:.1f}, drift {drift:.1f}) | area {area:.2f}x stand | legs A/B {legs[0]:.0f}%/{legs[1]:.0f}% | rim green {100 * green / max(edge, 1):.1f}% purple {100 * purple / max(edge, 1):.1f}% | md5 {hashlib.md5(Path(path).read_bytes()).hexdigest()[:10]}')
    print('  ' + ('OK' if ok else 'FAIL: ' + '; '.join(notes)) + ('' if ok or not notes else '') + (f'  (note: {"; ".join(notes)})' if ok and notes else ''))
    return ok


def to_webp(src, dst):
    """pngquant(--nofs: 디더링이 거의 투명한 픽셀을 불투명으로 만든다) → cwebp 무손실. 알파 마스크가 바뀌면 중단."""
    with tempfile.TemporaryDirectory() as td:
        q = Path(td) / 'q.png'
        r = subprocess.run(['pngquant', '--nofs', '--quality', '80-100', '--speed', '1', '--strip', '--force', '-o', str(q), str(src)])
        if r.returncode == 99: r = subprocess.run(['pngquant', '--nofs', '--quality', '60-100', '--speed', '1', '--strip', '--force', '-o', str(q), str(src)])
        if r.returncode != 0: sys.exit(f'pngquant failed (exit {r.returncode})')
        mask = lambda p: np.array(Image.open(p).convert('RGBA'))[..., 3] >= ALPHA_MIN
        if not np.array_equal(mask(q), mask(src)): sys.exit('quantize changed the alpha>=8 mask')
        subprocess.run(['cwebp', '-quiet', '-lossless', '-z', '9', str(q), '-o', str(dst)], check=True)
    os.chmod(dst, 0o644)


def pickup(look, date, force, allow_fail=False):
    src = batch_dir(look, date) / 'final' / f'{look}-walk.png'; dst = CREATURES / f'{look}-walk.webp'
    if dst.exists() and not force: sys.exit(f'refusing to overwrite {dst} (--force, and bump ASSET_VER in js/marble-render.js)')
    if not verify(src, look):
        if not allow_fail: sys.exit('verify failed — not picked up (after checking the four cells by eye: --allow-fail, and note why in the request doc)')
        print('  verify failed but --allow-fail given')
    to_webp(src, dst); print('copied', dst, f'{src.stat().st_size}→{dst.stat().st_size}B')


def load_tool(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py')); mod = importlib.util.module_from_spec(spec)
    argv = sys.argv; sys.argv = [name]   # 도구들이 import 때 argv 를 읽지 않게
    try: spec.loader.exec_module(mod)
    finally: sys.argv = argv
    return mod


def recolor(creature, skin):
    rc = load_tool('recolor-creature'); base = Image.open(CREATURES / f'{creature}-walk.webp')
    out = rc.apply_preset(base, rc.PRESETS[creature][skin])
    assert np.array_equal(np.array(base.convert('RGBA'))[..., 3], np.array(out)[..., 3]), 'alpha changed'
    dst = CREATURES / f'{creature}-{skin}-walk.webp'; out.save(dst, lossless=True, quality=100, method=6); print('wrote', dst)


def pixelate(creature, skin):
    px = load_tool('pixelate-creature'); a = np.array(Image.open(CREATURES / f'{creature}-walk.webp').convert('RGBA'))
    pal = np.array([p[:3] for p in px.PALETTES[creature]], dtype=np.int32)
    weight = np.array([p[3] if len(p) > 3 else 1 for p in px.PALETTES[creature]], dtype=np.float64)
    dark = pal.max(-1) / 255.0 < px.DARK_V; keep = weight >= px.EDGE_KEEP_WEIGHT; g = px.GRID
    small = np.zeros((g, g * COLS, 4), dtype=np.uint8)
    for c in range(COLS): small[:, c * g:(c + 1) * g] = px.pixelate_cell(a[:, c * CELL:(c + 1) * CELL], pal, dark, weight, keep)
    dst = CREATURES / f'{creature}-{skin}-walk.webp'
    Image.fromarray(small, 'RGBA').resize((CELL * COLS, CELL), Image.NEAREST).save(dst, lossless=True, quality=100, method=6); print('wrote', dst)


def strip(out_path, looks):
    bg = (110, 190, 100, 255); rows = []
    for look in looks:
        row = Image.new('RGBA', (CELL * 8 + 16, CELL), bg)
        row.alpha_composite(Image.open(CREATURES / f'{look}.webp').convert('RGBA').crop((0, 0, CELL * 4, CELL)), (0, 0))
        wp = CREATURES / f'{look}-walk.webp'
        if wp.exists(): row.alpha_composite(Image.open(wp).convert('RGBA'), (CELL * 4 + 16, 0))
        rows.append(row)
    out = Image.new('RGBA', (rows[0].width, CELL * len(rows)), bg)
    for i, r in enumerate(rows): out.alpha_composite(r, (0, i * CELL))
    out.save(out_path); print('wrote', out_path)


if __name__ == '__main__':
    flags = [x for x in sys.argv[1:] if x.startswith('--')]; args = [x for x in sys.argv[1:] if not x.startswith('--')]
    if not args: sys.exit(__doc__)
    cmd = args[0]; today = datetime.date.today().isoformat()
    if cmd == 'scaffold': scaffold(args[1], args[2] if len(args) > 2 else today, next((f.split('=', 1)[1] for f in flags if f.startswith('--posture=')), None))
    elif cmd == 'repack': sys.exit(0 if repack(args[1], int(args[2]) if len(args) > 2 else 1, args[3] if len(args) > 3 else today) else 1)
    elif cmd == 'verify': sys.exit(0 if verify(args[1], args[2]) else 1)
    elif cmd == 'pickup': pickup(args[1], args[2] if len(args) > 2 else today, '--force' in flags, '--allow-fail' in flags)
    elif cmd == 'recolor': recolor(args[1], args[2])
    elif cmd == 'pixelate': pixelate(args[1], args[2])
    elif cmd == 'strip': strip(args[1], args[2:])
    else: sys.exit(__doc__)
