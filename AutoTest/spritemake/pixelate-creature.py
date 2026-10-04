#!/usr/bin/env python3
"""데구리 동물 시트 결정론 도트화 — "굵은 옛날 게임 도트" 상점 스킨용 (2026-10-01 판다·햄스터 도트 스킨).
기본 시트 3장(main/sleep/scuffle)의 160px 칸을 32×32 격자(5px 블록)로 다시 찍는다. 자세·칸 순서·접지선(150)은 기본 시트 그대로,
같은 입력 → 같은 출력(난수 없음). GPT 생성 없음.

usage:
  /opt/homebrew/bin/python3 AutoTest/spritemake/pixelate-creature.py make <creature> <skin>            # → assets/marble/creatures/{creature}-{skin}*.webp (무손실)
  /opt/homebrew/bin/python3 AutoTest/spritemake/pixelate-creature.py compare <creature> <skin> <out.png>   # 기본 / 도트 대조 (main 5줄 + sleep + scuffle)

방법(칸마다):
  1. 불투명 픽셀을 덩어리로 나눠 가장 큰 것 = 몸, 나머지 = 위성(별·진흙·충격선).
  2. 블록이 몸으로 BODY_COVER 이상 덮이면 몸 블록, 위성으로 SAT_COVER 이상 덮이면 위성 블록(가는 선이 사라지지 않게 문턱이 낮다).
  3. 색은 동물별 손 팔레트(PALETTES)에서 고른다. 몸 블록 = 블록 안 득표(포인트 색은 한 표가 무겁다 — 눈·볼터치·코가 몸 색에 묻히지 않게),
     몸 가장자리 블록(4방향에 빈 칸) = 외곽선 색, 위성 블록 = 밝은 색 우선 득표.
  4. 공 칸은 격자에 맞추다 중심이 밀리면 넘친 쪽 끝줄을 떼어 (80,80) 에 맞춘다. 빙글 눈은 DIZZY 도장으로 직접 찍는다.
  5. 5배 최근접 확대. 알파는 0/255 뿐.
새 동물은 PALETTES 에 색을(첫 색 = 외곽선, 네 번째 값 = 포인트 색 가중), DIZZY 에 빙글 눈 칸과 블록 좌표를 추가한다. 검증은 verify-creature.py · ball-round.py 그대로(스킬 .claude/skills/marble-skin/SKILL.md 2단계)."""
import sys
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image

GAME = Path(__file__).resolve().parents[2]
SRC = GAME / 'assets' / 'marble' / 'creatures'
SHEETS = ['', '-sleep', '-scuffle']
CELL, BLOCK = 160, 5
GRID = CELL // BLOCK      # 32
ALPHA_MIN = 8
BODY_COVER, SAT_COVER = 0.5, 0.3
DARK_V = 0.45             # 이보다 어두운 팔레트 색 = 외곽선 계열(위성 색 고를 때 뒤로 미룬다)
EDGE_KEEP_WEIGHT, EDGE_KEEP_SHARE = 3, 0.5   # 가장자리 블록은 외곽선 색 — 가중이 이 값 이상인 색(코)이 블록 절반을 넘을 때만 그 색을 남긴다

# creature → 팔레트(첫 색 = 외곽선). 기본 시트에서 잰 값(2026-10-01)을 옛 게임기처럼 몇 색으로 추렸다.
# 네 번째 값 = 포인트 색 가중(블록 투표에서 한 표의 무게, 없으면 1) — 전부 올리면 진흙·별 색이 털에 점점이 박힌다. 3 이상은 가장자리에서도 남는다(코)
PALETTES = {
    'panda': [
        (20, 12, 14),      # 외곽선·검은 털
        (58, 46, 44),      # 검은 털 밝은 면
        (251, 241, 227),   # 크림 털
        (226, 206, 190),   # 크림 음영
        (200, 180, 168),   # 크림 짙은 음영(팔·다리 밑) — 없으면 이 색이 볼터치로 붙어 발밑에 분홍 점이 찍힌다
        (160, 140, 128),   # 회갈색 음영
        (255, 255, 255, 2),     # 하이라이트
        (250, 168, 164, 2),     # 볼터치
        (252, 220, 60),    # 별·충격선
        (216, 160, 4),     # 별 음영
        (112, 72, 40),     # 진흙
        (80, 44, 20),      # 진흙 음영
        (132, 80, 66),     # 발바닥
    ],
    'hamster': [
        (70, 12, 8),       # 외곽선
        (28, 4, 6, 1.5),   # 눈
        (252, 180, 68),    # 주황 털
        (254, 208, 96),    # 주황 하이라이트
        (232, 108, 36),    # 주황 음영·공 줄무늬
        (196, 60, 16),     # 외곽선 안쪽 적갈색 음영 — 없으면 이 색이 코 빨강으로 붙어 온몸에 빨간 점이 박힌다
        (253, 240, 215),   # 크림 배·볼
        (250, 205, 148),   # 크림 음영
        (255, 255, 255, 2.5),   # 눈 하이라이트
        (252, 136, 120, 2.5),   # 볼터치
        (238, 80, 64, 3),       # 코
        (252, 224, 80),    # 별·충격선
        (200, 110, 12),    # 별 음영
        (150, 90, 50),     # 진흙
        (96, 52, 34),      # 진흙 음영·해바라기씨
    ],
}

# 빙글 눈 도장 — 소용돌이 눈(지름 ≈22px)은 블록 투표로는 얼룩이 된다. 칸마다 눈의 왼쪽 위 블록 좌표를 재서 고리 눈으로 찍는다.
# K = 눈 테·눈동자, W = 흰자, . = 그대로. sheet suffix, row, col → [(x, y, 도장)]
EYE_RING = ['.KKK.', 'KWWWK', 'KWKWK', 'KWWWK', '.KKK.']
EYE_RING_TALL = ['.KKK.', 'KWWWK', 'KWKWK', 'KWKWK', 'KWWWK', '.KKK.']
DIZZY = {
    'panda': {'K': (20, 12, 14), 'W': (255, 255, 255), 'cells': {
        ('', 2, 3): [(12, 17, EYE_RING), (18, 17, EYE_RING)],
        ('-scuffle', 1, 2): [(11, 12, EYE_RING), (19, 9, EYE_RING)],
        ('-scuffle', 1, 3): [(12, 9, EYE_RING), (19, 13, EYE_RING)],
    }},
    'hamster': {'K': (28, 4, 6), 'W': (255, 255, 255), 'cells': {
        ('', 2, 3): [(11, 12, EYE_RING_TALL), (21, 12, EYE_RING_TALL)],
        ('', 4, 3): [(21, 19, EYE_RING)],
        ('-scuffle', 1, 2): [(20, 13, EYE_RING)],
        ('-scuffle', 1, 3): [(19, 13, EYE_RING)],
    }},
}


def oklab(rgb):
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    l = np.cbrt(0.4122214708 * c[..., 0] + 0.5363325363 * c[..., 1] + 0.0514459929 * c[..., 2])
    m = np.cbrt(0.2119034982 * c[..., 0] + 0.6806995451 * c[..., 1] + 0.1073969566 * c[..., 2])
    s = np.cbrt(0.0883024619 * c[..., 0] + 0.2817188376 * c[..., 1] + 0.6299787005 * c[..., 2])
    return np.stack([0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                     1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                     0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s], -1)


def nearest(rgb, pal):
    """픽셀마다 가장 가까운 팔레트 색 번호 — 눈에 보이는 색 차이(OKLab) 기준."""
    return ((oklab(rgb)[..., None, :] - oklab(pal)) ** 2).sum(-1).argmin(-1)


def components(mask):
    """8방향 연결 덩어리 번호(0 = 없음), 큰 것부터 1,2,…"""
    lab = np.zeros(mask.shape, dtype=np.int32); sizes = []
    for y, x in zip(*np.nonzero(mask)):
        if lab[y, x]: continue
        n = len(sizes) + 1; q = deque([(y, x)]); lab[y, x] = n; size = 0
        while q:
            cy, cx = q.popleft(); size += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < CELL and 0 <= nx < CELL and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n; q.append((ny, nx))
        sizes.append(size)
    order = np.argsort(sizes)[::-1]; rank = np.zeros(len(sizes) + 1, dtype=np.int32)
    rank[order + 1] = np.arange(1, len(sizes) + 1)
    return rank[lab]


def blocks(a):
    return a.reshape(GRID, BLOCK, GRID, BLOCK).swapaxes(1, 2).reshape(GRID, GRID, BLOCK * BLOCK)


def pixelate_cell(cell, pal, dark, weight, keep):
    opaque = cell[..., 3] >= ALPHA_MIN
    out = np.zeros((GRID, GRID, 4), dtype=np.uint8)
    if not opaque.any(): return out
    comp = components(opaque); body = comp == 1
    idx = blocks(nearest(cell[..., :3], pal)); bb = blocks(body); cb = blocks(comp)
    is_body = bb.mean(-1) >= BODY_COVER
    ys, xs = np.nonzero(body); w, h = xs.max() + 1 - xs.min(), ys.max() + 1 - ys.min()
    if 100 <= w <= 120 and 100 <= h <= 120 and abs(xs.min() + xs.max() + 1 - CELL) <= 4 and abs(ys.min() + ys.max() + 1 - CELL) <= 4:
        # 공 칸(몸이 칸 한가운데 원): 폭 115 처럼 격자에 안 맞는 공은 한쪽 끝줄만 남아 중심이 2.5px 밀린다(검증 ±2) → 넘친 쪽 끝줄을 뗀다
        for m in (is_body, is_body.T):   # 세로 → 가로 (.T 는 같은 배열의 뷰)
            used = np.nonzero(m.any(1))[0]; off = used[0] + used[-1] + 1 - GRID
            if off: m[used[-1] if off > 0 else used[0]] = False
    is_sat = ~is_body & ((cb > 1).mean(-1) >= SAT_COVER)
    for m in (is_body, is_sat):   # 칸 맨 바깥 블록 줄은 비운다 — 몸에 붙은 충격선이 칸 끝에 닿으면 이웃 칸으로 번진다(계약: 꽈당 줄 폭 ≤ 156)
        m[[0, -1], :] = False; m[:, [0, -1]] = False
    pad = np.pad(is_body, 1)
    edge = is_body & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    for y in range(GRID):
        for x in range(GRID):
            if is_body[y, x]:
                votes = np.bincount(idx[y, x][bb[y, x]], minlength=len(pal))
                c = (votes * weight).argmax()
                if edge[y, x] and not (keep[c] and votes[c] >= EDGE_KEEP_SHARE * votes.sum()): c = 0   # 가장자리는 외곽선 색으로 통일(코만 예외)
            elif is_sat[y, x]:
                votes = np.bincount(idx[y, x][cb[y, x] > 1], minlength=len(pal))
                light = np.where(dark, 0, votes)   # 별·충격선은 외곽선보다 속 색으로 읽히게
                c = light.argmax() if light.max() >= 0.3 * votes.sum() else votes.argmax()
            else: continue
            out[y, x, :3] = pal[c]; out[y, x, 3] = 255
    return out


def pixelate(creature):
    sheets = [np.array(Image.open(SRC / f'{creature}{suf}.webp').convert('RGBA')) for suf in SHEETS]
    pal = np.array([p[:3] for p in PALETTES[creature]], dtype=np.int32)
    weight = np.array([p[3] if len(p) > 3 else 1 for p in PALETTES[creature]], dtype=np.float64)
    dark = pal.max(-1) / 255.0 < DARK_V
    keep = weight >= EDGE_KEEP_WEIGHT
    dizzy = DIZZY.get(creature, {'cells': {}})
    outs = []
    for suf, a in zip(SHEETS, sheets):
        H, W = a.shape[:2]; small = np.zeros((H // BLOCK, W // BLOCK, 4), dtype=np.uint8)
        for r in range(H // CELL):
            for c in range(W // CELL):
                small[r * GRID:(r + 1) * GRID, c * GRID:(c + 1) * GRID] = pixelate_cell(a[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL], pal, dark, weight, keep)
                for (bx, by, stamp) in dizzy['cells'].get((suf, r, c), []):
                    for j, line in enumerate(stamp):
                        for i, ch in enumerate(line):
                            if ch != '.': small[r * GRID + by + j, c * GRID + bx + i] = (*dizzy[ch], 255)
        outs.append(Image.fromarray(small, 'RGBA').resize((W, H), Image.NEAREST))
    return outs


def make(creature, skin):
    for suf, out in zip(SHEETS, pixelate(creature)):
        dst = SRC / f'{creature}-{skin}{suf}.webp'
        out.save(dst, lossless=True, quality=100, method=6)   # 게임 시트는 WebP 무손실(docs/GameGuide/04-ops/image-assets.md)
        print('wrote', dst)


def compare(creature, skin, out_path):
    bg = (110, 190, 100, 255); rows = []
    for suf in SHEETS:
        for name in (creature, f'{creature}-{skin}'):
            rows.append(Image.open(SRC / f'{name}{suf}.webp').convert('RGBA'))
    # 왼쪽 기본 / 오른쪽 도트, 시트별로 세로로 쌓는다
    h = sum(rows[i].height for i in range(0, len(rows), 2))
    out = Image.new('RGBA', (1280 + 20, h), bg); y = 0
    for i in range(0, len(rows), 2):
        out.alpha_composite(rows[i], (0, y)); out.alpha_composite(rows[i + 1], (660, y)); y += rows[i].height
    out.save(out_path); print('wrote', out_path)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'make' and len(sys.argv) == 4: make(sys.argv[2], sys.argv[3])
    elif cmd == 'compare' and len(sys.argv) == 5: compare(sys.argv[2], sys.argv[3], sys.argv[4])
    else: sys.exit(__doc__)
