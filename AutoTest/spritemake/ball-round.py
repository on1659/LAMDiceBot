#!/usr/bin/env python3
"""데구리 공 칸 원형 검사·보정. 구르는 공은 정원 링(반지름 15 표시 = 60 소스 px) 안에 그려지므로 공이 타원이면 회전할 때 링 안에 틈이 보인다(2026-09-29 너구리 제보).

usage:
  /opt/homebrew/bin/python3 AutoTest/spritemake/ball-round.py check <sheet.webp|png> ...   # 회전 공 칸(r2c0·r2c2·r2c3)의 몸통 크기·링 채움(반지름 54 안 불투명 비율)
  /opt/homebrew/bin/python3 AutoTest/spritemake/ball-round.py fix <src.png> <dst.png>      # 타원이면 세로로 늘려 원형(≈폭×min(폭,116)), 작으면 큰 쪽이 120 이 되게 균등 확대, r1c3=r2c0 복제, 위성은 칸 안에서 같이 이동

기준: r2c0 을 72방향으로 재서 가장 움푹한 반지름 ≥ 46, 반지름 52 미만 방향 ≤ 20 (아래 RADIUS_MIN/LOW_MAX).
찌그러짐(r2c1)·r3c0 은 회전하지 않아서 건드리지 않는다. fix 뒤에는 pickup-skin.py(--nofs 양자화)·verify-creature.py 로 다시 검증."""
import math, sys
from collections import deque
from PIL import Image

TARGET_MAX = 116
BALL_MAX = 120            # 공 최대 치수(계약: 108~120) = 링 지름
CELLS = [(2, 0), (2, 2), (2, 3)]
# 기준(2026-09-29 실측, 소스 px): 판다 min 49·15방향, 기본 돼지 47·16, 보정 후 너구리 49·4. 보정 전 너구리 44·14 는 틈이 보였다
RADIUS_MIN, LOW_MAX = 46, 20


def components(a):
    seen = [[False] * 160 for _ in range(160)]; comps = []
    for y in range(160):
        for x in range(160):
            if a[x, y] >= 8 and not seen[y][x]:
                q = deque([(x, y)]); seen[y][x] = True; pts = []
                while q:
                    cx, cy = q.popleft(); pts.append((cx, cy))
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < 160 and 0 <= ny < 160 and not seen[ny][nx] and a[nx, ny] >= 8:
                                seen[ny][nx] = True; q.append((nx, ny))
                comps.append(pts)
    return sorted(comps, key=len, reverse=True)


def body_box(cell):
    body = components(cell.getchannel('A').load())[0]
    xs = [p[0] for p in body]; ys = [p[1] for p in body]
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def radii(cell):
    """5° 간격 72방향으로 중심(80,80)에서 가장 먼 불투명 픽셀까지 거리 — 꼬리·소품 돌기는 값을 키울 뿐이라 '움푹한 곳'만 잡힌다"""
    a = cell.getchannel('A').load(); out = []
    for k in range(72):
        t = math.radians(k * 5); r = 0
        for s in range(80):
            x, y = int(round(80 + s * math.cos(t))), int(round(80 + s * math.sin(t)))
            if 0 <= x < 160 and 0 <= y < 160 and a[x, y] >= 8: r = s
        out.append(r)
    return out


def check(paths):
    ok = True
    for p in paths:
        im = Image.open(p).convert('RGBA')
        cell = im.crop((0, 320, 160, 480)); r = radii(cell); x0, y0, x1, y1 = body_box(cell)
        low = sum(v < 52 for v in r); bad = min(r) < RADIUS_MIN or low > LOW_MAX
        ok &= not bad
        print(f"{p.split('/')[-1]:32s} r2c0 body {x1 - x0}x{y1 - y0}  min radius {min(r)}  angles<52 {low:2d}/72{'  <- NOT ROUND' if bad else ''}")
    print('ROUND_OK' if ok else 'ROUND_FAIL (ball-round.py fix — 기준: 최소 반지름 ≥ %d, 52 미만 방향 ≤ %d)' % (RADIUS_MIN, LOW_MAX))


def roundify(cell):
    a = cell.getchannel('A').load()
    comps = components(a); body = comps[0]
    xs = [p[0] for p in body]; ys = [p[1] for p in body]
    x0, x1, y0, y1 = min(xs), max(xs) + 1, min(ys), max(ys) + 1
    w, h = x1 - x0, y1 - y0
    th = max(h, min(w, TARGET_MAX))                        # 타원 → 세로로 늘려 원형(너구리)
    up = min(BALL_MAX / w, BALL_MAX / th)                  # 작은 공 → 폭·높이 중 큰 쪽이 120 이 되게 균등 확대(저팔계: 승모까지 112 로 맞춰져 몸통이 작았다)
    up = up if up > 1.02 else 1.0
    tw, th = round(w * up), round(th * up)
    if (tw, th) == (w, h): return cell, (w, h, w, h)
    src = cell.load(); bimg = Image.new('RGBA', (w, h), (0, 0, 0, 0)); bp = bimg.load()
    for (x, y) in body: bp[x - x0, y - y0] = src[x, y]
    big = bimg.convert('RGBa').resize((tw, th), Image.LANCZOS).convert('RGBA')   # premultiplied 리샘플 — 가장자리 색 번짐 방지
    out = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    bcx, bcy = (x0 + x1) / 2, (y0 + y1) / 2; grow = (th - h) / 2
    for pts in comps[1:]:   # 위성(진흙 점·별): 몸통이 커진 만큼 바깥으로(위쪽이면 위로, 아래쪽이면 아래로) — 칸 밖으로는 안 나가게
        cxc = sum(p[0] for p in pts) / len(pts); cyc = sum(p[1] for p in pts) / len(pts)
        dx = round((cxc - bcx) * (up - 1) + (80 - bcx))
        dy = round(80 - bcy + (-grow if cyc < bcy else grow))
        sx0, sx1 = min(p[0] for p in pts), max(p[0] for p in pts); sy0, sy1 = min(p[1] for p in pts), max(p[1] for p in pts)
        dx = max(2 - sx0, min(157 - sx1, dx)); dy = max(2 - sy0, min(157 - sy1, dy))
        for (x, y) in pts:
            if 0 <= x + dx < 160 and 0 <= y + dy < 160: out.putpixel((x + dx, y + dy), src[x, y])
    out.alpha_composite(big, (round(80 - tw / 2), round(80 - th / 2)))   # 몸통 중심을 (80,80) 에
    px = out.load()
    for y in range(160):
        for x in range(160):
            if 0 < px[x, y][3] < 8: px[x, y] = (0, 0, 0, 0)
    for pts in components(out.getchannel('A').load()):   # 리샘플 가장자리에서 떨어져 나온 4px 이하 부스러기 제거(파이프라인 규칙 — 배치 QA residualSpeckComponents)
        if len(pts) <= 4:
            for (x, y) in pts: px[x, y] = (0, 0, 0, 0)
    return out, (w, h, tw, th)


def fix(src, dst):
    im = Image.open(src).convert('RGBA')
    cells = list(CELLS)
    x0, y0, x1, y1 = body_box(im.crop((0, 480, 160, 640)))
    if abs((y0 + y1) / 2 - 80) < 6: cells.append((3, 0))   # r3c0 가 온전한 공인 동물(판다·돼지) — 펴기 첫 칸도 같은 크기로
    for (r, c) in cells:
        new, info = roundify(im.crop((c * 160, r * 160, c * 160 + 160, r * 160 + 160)))
        im.paste(new, (c * 160, r * 160))
        print(f'  r{r}c{c}: body {info[0]}x{info[1]} -> {info[2]}x{info[3]}')
    im.paste(im.crop((0, 320, 160, 480)), (480, 160))   # r1c3 = r2c0 (계약: 픽셀 동일)
    im.save(dst); print('wrote', dst)


if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    if sys.argv[1] == 'check': check(sys.argv[2:])
    elif sys.argv[1] == 'fix': fix(sys.argv[2], sys.argv[3])
    else: sys.exit(__doc__)
