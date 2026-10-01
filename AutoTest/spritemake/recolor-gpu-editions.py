#!/usr/bin/env python3
"""데구리 5090 에디션 스킨 3종을 색으로 가른다 — 구를 때 셋 다 "검은 공 + 초록 링"이라 구분이 안 됐다(사용자 2026-10-01).
실제 그래픽카드 라인업처럼 화이트 / 블랙 / LED 로 나눈다. 그림(모양·포즈·알파)은 그대로, 색만 결정론으로 바꾼다(난수 없음).

    armadillo-gpu  화이트 — 건메탈 판 → 흰색, 라임 LED → 하늘색
    pillbug-gpu    LED    — 라임 LED → 무지개(공 칸은 중심 둘레 각도, 나머지 칸은 가로 방향), 공 칸은 팬 날개도 무지개로 켠다
    turtle-gpu     블랙   — 그대로(이 스크립트가 안 건드림)

원본은 SpriteMake 배치의 final/creatures/*.png(검은 판, GPT 생성본을 리팩한 것). 결과는 pickup-skin.py 와 같은 길
(pngquant --nofs → cwebp 무손실, alpha>=8 마스크 불변 확인)로 assets/marble/creatures/ 에 덮어쓰고 manifest md5 를 갱신한다.
같은 이름 교체이므로 실행 뒤 js/marble-render.js ASSET_VER 을 올린다.

usage:
  /opt/homebrew/bin/python3 AutoTest/spritemake/recolor-gpu-editions.py            # 두 스킨 × 시트 3장 교체 + manifest
  /opt/homebrew/bin/python3 AutoTest/spritemake/recolor-gpu-editions.py --png DIR  # 검수용 PNG 만 DIR 에(게임 파일 안 건드림)
"""
import hashlib, json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

OUT = Path('/Users/radar/Work/SpriteMake/output')
GAME = Path(__file__).resolve().parents[2]
DEST = GAME / 'assets' / 'marble' / 'creatures'
MAN = GAME / 'assets' / 'marble' / 'marble-run.manifest.json'
KINDS = ['', '-sleep', '-scuffle']
CELL = 160
ALPHA_MIN = 8
BALL_CELLS = {(1, 3), (2, 0), (2, 1), (2, 2), (2, 3)}   # main 시트의 공 칸 (row, col) — 중심 (80, 80)

NEUTRAL_SAT = 0.25                # 이보다 채도가 낮으면 건메탈·은색(판·팬·하이라이트)
LINE_V = 0.10                     # 이보다 어두운 무채색은 선·눈·외곽선 — 건드리지 않는다
LED_HUE, LED_SAT = (58, 150), 0.35   # 라임 LED 띠·링(진흙 hue≈25, 별·금색 단자 hue≈45 는 범위 밖)
WHITE_LED_HUE = 195               # 화이트 에디션 LED = 하늘색
FAN_GLOW_RADIUS = 40              # 공 칸에서 팬 날개로 치는 반지름(LED 링 안쪽)


def to_hsv(a):
    r, g, b = [a[..., i].astype(float) / 255. for i in range(3)]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    i = m & (mx == r); h[i] = ((g - b)[i] / d[i]) % 6
    i = m & (mx == g) & ~(mx == r); h[i] = (b - r)[i] / d[i] + 2
    i = m & (mx == b) & ~(mx == r) & ~(mx == g); h[i] = (r - g)[i] / d[i] + 4
    return h * 60, np.where(mx > 0, d / np.maximum(mx, 1e-6), 0), mx


def to_rgb(h, s, v):
    h = (h % 360) / 60.
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - f * s), v * (1 - (1 - f) * s)
    return np.stack([np.choose(i, [v, q, p, p, t, v]), np.choose(i, [t, v, v, q, p, p]), np.choose(i, [p, p, t, v, v, q])], -1)


def finish(a, op, h, s, v):
    out = a.copy()
    out[..., :3] = np.clip(np.round(to_rgb(h, s, v) * 255), 0, 255).astype(np.uint8)
    out[~op] = a[~op]
    assert (out[..., 3] == a[..., 3]).all()
    return Image.fromarray(out, 'RGBA')


def led_mask(op, h, s):
    return op & (h >= LED_HUE[0]) & (h < LED_HUE[1]) & (s >= LED_SAT)


def white(im, main):
    """화이트 — 건메탈 판을 흰색으로(음영 방향 유지), 은색 하이라이트는 더 밝게, LED 는 하늘색."""
    a = np.array(im.convert('RGBA'))
    h, s, v = to_hsv(a)
    op = a[..., 3] >= ALPHA_MIN
    h2, s2, v2 = h.copy(), s.copy(), v.copy()
    shroud = op & (s < NEUTRAL_SAT) & (v >= LINE_V) & (v < 0.50)
    v2[shroud] = 0.70 + (v[shroud] - LINE_V) / 0.40 * 0.26
    s2[shroud] = s[shroud] * 0.35
    hi = op & (s < NEUTRAL_SAT) & (v >= 0.50)
    v2[hi] = np.minimum(1.0, 0.96 + (v[hi] - 0.5) * 0.08)
    h2[led_mask(op, h, s)] = WHITE_LED_HUE
    return finish(a, op, h2, s2, v2)


def led(im, main):
    """LED — 라임 LED 를 무지개로. 공 칸은 중심 둘레 각도로 색을 돌려 구르면 무지개가 돈다. 공 칸 팬 날개도 같이 켠다."""
    a = np.array(im.convert('RGBA'))
    h, s, v = to_hsv(a)
    op = a[..., 3] >= ALPHA_MIN
    h2, s2, v2 = h.copy(), s.copy(), v.copy()
    lm = led_mask(op, h, s)
    H, W = a.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]
    for r in range(H // CELL):
        for c in range(W // CELL):
            cell = (yy // CELL == r) & (xx // CELL == c)
            m = lm & cell
            cx, cy = c * CELL + CELL // 2, r * CELL + CELL // 2
            if main and (r, c) in BALL_CELLS:
                ang = (np.degrees(np.arctan2(yy - cy, xx - cx)) + 360) % 360
                h2[m] = ang[m]
                fan = op & cell & (s < NEUTRAL_SAT) & (v >= 0.16) & (v < 0.60) & (np.hypot(xx - cx, yy - cy) <= FAN_GLOW_RADIUS)
                h2[fan] = (ang[fan] + 40) % 360
                s2[fan] = 0.62
                v2[fan] = np.minimum(1.0, v[fan] * 1.55 + 0.12)
            elif m.any():
                lo, hi = xx[m].min(), xx[m].max()
                h2[m] = (xx[m] - lo) / max(1, hi - lo) * 300   # 빨강 → 보라 (360 까지 가면 양 끝이 같은 빨강)
            s2[m] = np.maximum(s[m], 0.85)
            v2[m] = np.minimum(1.0, v[m] * 1.15 + 0.05)
    return finish(a, op, h2, s2, v2)


EDITIONS = [   # (sheet, 배치, manifest 섹션, 변환, manifest note 에 덧붙일 말)
    ('armadillo-gpu', 'marble-run-skin-armadillo-gpu-2026-10-01', 'skinArmadilloGpu', white, '화이트 에디션'),
    ('pillbug-gpu', 'marble-run-skin-pillbug-gpu-2026-10-01', 'skinPillbugGpu', led, 'LED 에디션'),
]
NOTE = ' · 2026-10-01 {label}: recolor-gpu-editions.py 로 색만 변환(알파 동일). md5 는 변환한 PNG 기준, 검은 원본은 배치 final/.'


def main():
    png_dir = Path(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == '--png' else None
    man = None
    if not png_dir:
        raw = MAN.read_text(encoding='utf-8')
        man = json.loads(raw)
        assert json.dumps(man, indent=2, ensure_ascii=False) + '\n' == raw, 'manifest formatting would change'
    for sheet, batch, section, fn, label in EDITIONS:
        for k in KINDS:
            n = sheet + k
            im = fn(Image.open(OUT / batch / 'final' / 'creatures' / f'{n}.png'), k == '')
            if png_dir:
                png_dir.mkdir(parents=True, exist_ok=True)
                im.save(png_dir / f'{n}.png')
                print('png', png_dir / f'{n}.png')
                continue
            with tempfile.TemporaryDirectory() as td:
                src, q = Path(td) / f'{n}.png', Path(td) / f'{n}-q.png'
                im.save(src)
                # pickup-skin.py 와 같은 설정 — 무지개는 품질 하한 80 을 못 맞출 수 있어 60 으로 한 번 더
                for quality in ('80-100', '60-100'):
                    r = subprocess.run(['pngquant', '--nofs', '--quality', quality, '--speed', '1', '--strip', '--force', '-o', str(q), str(src)])
                    if r.returncode != 99: break
                if r.returncode != 0: sys.exit(f'pngquant failed for {n} (exit {r.returncode})')
                mask = lambda p: np.array(Image.open(p).convert('RGBA'))[..., 3] >= ALPHA_MIN
                if not (mask(q) == mask(src)).all(): sys.exit(f'quantize changed the alpha>=8 mask for {n}')
                subprocess.run(['cwebp', '-quiet', '-lossless', '-z', '9', str(q), '-o', str(DEST / f'{n}.webp')], check=True)
                man[section]['assets'][n]['md5'] = hashlib.md5(src.read_bytes()).hexdigest()
            print('replaced', DEST / f'{n}.webp', f'{(DEST / (n + ".webp")).stat().st_size}B')
        if man and label not in man[section]['note']:
            man[section]['note'] += NOTE.format(label=label)
    if man:
        MAN.write_text(json.dumps(man, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print('manifest md5 updated — js/marble-render.js ASSET_VER 을 올릴 것')


main()
