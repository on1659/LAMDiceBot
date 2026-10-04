#!/usr/bin/env python3
"""데구리 구슬 뽑기 '일반' 등급 그림 — 레어(파랑) 그림의 색만 초록으로 돌려 만든다 (docs/goal/deguri-shop-declutter-common-tier.md).
그림 생성 없음, 난수 없음: 같은 입력 → 같은 출력. 모양·알파는 레어와 100% 같아서 좌표(gacha-anchors.json)를 그대로 쓴다.

    capsule/capsule-rare{,-cup,-lid,-lidflip,-open}.webp → capsule/capsule-common*.webp
    fx/gacha-rays-rare.webp                              → fx/gacha-rays-common.webp
    machine/gacha-machine-lamp.webp                      → 맨 뒤에 일반 칸 한 칸 덧붙임(4칸 → 5칸, 앞 4칸 픽셀 불변)

초록인 이유: 유리구 안에 이미 초록 공(시트 1번 칸)이 있고, 회색 램프는 꺼진 램프와 구분이 안 된다.
실행 뒤 js/deguri-gacha.js 의 ASSET_VER 을 올린다(assets/deguri 7일 캐시).

usage:
  /opt/homebrew/bin/python3 AutoTest/spritemake/make-gacha-common.py            # assets/deguri/gacha 에 쓰고 manifest 갱신
  /opt/homebrew/bin/python3 AutoTest/spritemake/make-gacha-common.py --png DIR  # 검수용 PNG 만 DIR 에
"""
import hashlib, json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

GAME = Path(__file__).resolve().parents[2]
GACHA = GAME / 'assets' / 'deguri' / 'gacha'
MAN = GAME / 'assets' / 'deguri' / 'deguri.manifest.json'
RECOLOR = ['capsule/capsule-rare', 'capsule/capsule-rare-cup', 'capsule/capsule-rare-lid', 'capsule/capsule-rare-lidflip', 'capsule/capsule-rare-open', 'fx/gacha-rays-rare']
LAMP = 'machine/gacha-machine-lamp'
LAMP_CELL_W, LAMP_CELLS, LAMP_RARE = 54, 4, 1     # 원본 시트: [꺼짐, 레어, 에픽, 전설]
BLUE_HUE = (160, 265)             # 레어의 파랑·하늘색(크림 hue≈40, 외곽선 hue≈325 는 범위 밖)
HUE_SHIFT = -85                   # 파랑 210° → 초록 125°
MIN_SAT = 0.06                    # 이보다 옅으면 흰 하이라이트 — 그대로


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


def green(im):
    a = np.array(im.convert('RGBA'))
    h, s, v = to_hsv(a)
    m = (a[..., 3] > 0) & (h >= BLUE_HUE[0]) & (h < BLUE_HUE[1]) & (s >= MIN_SAT)
    h[m] += HUE_SHIFT
    out = a.copy()
    out[..., :3][m] = np.clip(np.round(to_rgb(h, s, v) * 255), 0, 255).astype(np.uint8)[m]
    return Image.fromarray(out, 'RGBA')


def build():
    """{ 상대 경로(확장자 없음): 이미지 }"""
    made = {}
    for src in RECOLOR:
        made[src.replace('-rare', '-common')] = green(Image.open(GACHA / f'{src}.webp'))
    lamp = Image.open(GACHA / f'{LAMP}.webp').convert('RGBA')
    w, hgt = lamp.size
    cells = w // LAMP_CELL_W
    assert cells in (LAMP_CELLS, LAMP_CELLS + 1), f'lamp sheet has {cells} cells'
    base = lamp.crop((0, 0, LAMP_CELL_W * LAMP_CELLS, hgt))   # 다시 돌려도 5번째 칸을 새로 만든다(멱등)
    sheet = Image.new('RGBA', (LAMP_CELL_W * (LAMP_CELLS + 1), hgt), (0, 0, 0, 0))
    sheet.paste(base, (0, 0))
    sheet.paste(green(base.crop((LAMP_CELL_W * LAMP_RARE, 0, LAMP_CELL_W * (LAMP_RARE + 1), hgt))), (LAMP_CELL_W * LAMP_CELLS, 0))
    made[LAMP] = sheet
    return made


def main():
    made = build()
    if len(sys.argv) > 2 and sys.argv[1] == '--png':
        out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
        for rel, im in made.items():
            im.save(out / (rel.replace('/', '__') + '.png'))
        print(f'PNG {len(made)}장 → {out}')
        return
    raw = MAN.read_text(encoding='utf-8')
    man = json.loads(raw)
    assert json.dumps(man, indent=2, ensure_ascii=False) + '\n' == raw, 'manifest formatting would change'
    with tempfile.TemporaryDirectory() as td:
        for rel, im in made.items():
            png, dst = Path(td) / 'a.png', GACHA / f'{rel}.webp'
            im.save(png)
            subprocess.run(['cwebp', '-quiet', '-lossless', '-exact', '-z', '9', str(png), '-o', str(dst)], check=True)   # -exact: 투명 픽셀의 색도 보존(빛살 가장자리)
            assert (np.array(Image.open(dst).convert('RGBA')) == np.array(im)).all(), f'lossy write: {rel}'
            man['gachaMachine']['assets'][f'gacha/{rel}.webp'] = {'md5': hashlib.md5(dst.read_bytes()).hexdigest(), 'bytes': dst.stat().st_size}
            print(f'  {rel}.webp  {im.size[0]}x{im.size[1]}  {dst.stat().st_size:,}B')
    MAN.write_text(json.dumps(man, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('manifest 갱신 — js/deguri-gacha.js ASSET_VER 을 올릴 것')


main()
