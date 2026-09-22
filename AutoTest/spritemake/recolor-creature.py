#!/usr/bin/env python3
"""데구리 동물 시트 결정론 리컬러 — 색만 바뀌는 상점 스킨용 (docs/goal/marble-skins-all-creatures.md).
기본 시트 3장(main/sleep/scuffle)을 HSV 에서 "몸 색 범위"만 골라 hue/채도/명도를 바꾸고 나머지(alpha·외곽선·눈·보호 색)는 그대로 둔다.
픽셀 정렬 100%, 같은 입력 → 같은 출력(난수 없음).

usage:
  /opt/homebrew/bin/python3 AutoTest/spritemake/recolor-creature.py analyze <creature>            # hue 히스토그램(규칙 잡을 때)
  /opt/homebrew/bin/python3 AutoTest/spritemake/recolor-creature.py make <creature> <skin>        # PRESETS[creature][skin] 로 3장 생성 → assets/marble/creatures/{creature}-{skin}*.webp (무손실)
  /opt/homebrew/bin/python3 AutoTest/spritemake/recolor-creature.py compare <creature> <skin>     # 28px 대조 PNG (scratch 경로 출력)

규칙(rule) 필드: hue [lo,hi] (도, lo>hi 면 0 을 감싸 회전), sat [min,max], val [min,max] 로 대상 픽셀을 고르고
  set_hue / shift_hue (도), sat_mul / sat_add, val_mul / val_add 를 적용. protect 규칙(action 없음)은 먼저 매칭돼 보호한다.
공통 보호: 외곽선·눈 = val < OUTLINE_V (프리셋 outline_v 로 조정), 프리셋 outline_val_mul 이 있으면 외곽선만 명도 배율.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

GAME = Path(__file__).resolve().parents[2]
SRC = GAME / 'assets' / 'marble' / 'creatures'
SHEETS = ['', '-sleep', '-scuffle']
ALPHA_MIN = 8

# creature → skin → preset. 색 범위는 analyze 로 잰 값(2026-09-22).
PRESETS = {
    'hedgehog': {
        # 벚꽃 고슴도치: 갈색 가시 → 연분홍. 얼굴·배 크림(저채도 노랑)은 보호, 볼 분홍은 그대로
        'cherry': {
            'outline_v': 0.22,
            'rules': [
                {'hue': [15, 60], 'sat': [0.0, 0.32], 'val': [0.6, 1.01]},                                   # 크림 얼굴·배 보호
                {'hue': [8, 46], 'sat': [0.30, 1.01], 'val': [0.22, 1.01], 'set_hue': 343, 'sat_mul': 0.62, 'val_mul': 1.32, 'val_max': 0.98},   # 가시·갈색 → 벚꽃 연분홍 (노란 '!!' 마크 hue≈50 은 범위 밖)
            ],
        },
    },
    'armadillo': {
        # 황금 아르마딜로: 갑옷 띠(회갈색) → 금색. 배·얼굴 크림은 보호
        'gold': {
            'outline_v': 0.22,
            'rules': [
                {'hue': [10, 55], 'sat': [0.0, 0.6], 'val': [0.76, 1.01]},                                   # 크림·살구 얼굴·배·발 보호(sat≈0.4 val≈0.93) — 갑옷 갈색은 val≈0.63 라 걸리지 않음
                {'hue': [345, 36], 'sat': [0.42, 1.01], 'val': [0.22, 1.01], 'set_hue': 46, 'sat_mul': 1.15, 'val_mul': 1.4, 'val_max': 0.98},   # 갈색 갑옷·음영 → 밝은 금(음영은 어두운 금)
            ],
        },
    },
    'pufferfish': {
        # 파란 복어: 노랑 → 하늘색, 점무늬(갈색/주황)는 남색
        'blue': {
            'outline_v': 0.22,
            'rules': [
                {'hue': [40, 70], 'sat': [0.25, 1.01], 'val': [0.22, 1.01], 'set_hue': 200, 'sat_mul': 0.85},            # 노랑 몸 → 하늘색
                {'hue': [10, 40], 'sat': [0.25, 1.01], 'val': [0.22, 1.01], 'set_hue': 225, 'sat_add': 0.2, 'val_mul': 0.75},   # 주황/갈색 점 → 남색
            ],
        },
    },
    'rabbit': {
        # 검정 토끼: 흰 몸 → 진회색/검정, 귀 안쪽·코 분홍 유지, 외곽선 더 어둡게
        'black': {
            'outline_v': 0.22, 'outline_val_mul': 0.6,
            'rules': [
                {'hue': [320, 20], 'sat': [0.28, 1.01], 'val': [0.5, 1.01]},                                 # 분홍(귀 안쪽·코·볼·공 띠) 보호 — 털 음영(분홍빛 흰색 sat≈0.23)은 제외
                {'hue': [0, 360], 'sat': [0.0, 0.28], 'val': [0.5, 1.01], 'set_hue': 230, 'sat_add': 0.08, 'val_mul': 0.34},   # 흰 털·분홍빛 음영 → 진회색
                {'hue': [0, 360], 'sat': [0.0, 1.01], 'val': [0.22, 0.5], 'val_mul': 0.45},                  # 외곽선(연한 분홍회색) → 검게
            ],
        },
    },
    'turtle': {
        # 바다 거북이: 초록 → 청록/파랑
        'ocean': {
            'outline_v': 0.0,   # 거북이 외곽선은 짙은 초록(3,40,5) — 외곽선까지 같이 돌려 남색 외곽선으로(안 돌리면 파란 몸에 초록 테)
            'rules': [
                {'hue': [60, 170], 'sat': [0.18, 1.01], 'val': [0.0, 1.01], 'shift_hue': 95},                # 초록 계열 전부 → 파랑 계열(등딱지 진초록 → 파랑, 몸 연두 → 청록, 외곽선 → 남색)
            ],
        },
    },
    'hamster': {
        # 회색 햄스터: 주황 → 회색, 볼 크림 유지
        'grey': {
            'outline_v': 0.22,
            'rules': [
                {'hue': [25, 60], 'sat': [0.0, 0.30], 'val': [0.72, 1.01]},                                  # 크림 볼·배 보호
                {'hue': [335, 359.9], 'sat': [0.6, 1.01], 'val': [0.22, 0.6]},                               # 코(진분홍) 보호
                {'hue': [0, 25], 'sat': [0.5, 1.01], 'val': [0.22, 0.6], 'sat_mul': 0.15, 'val_mul': 0.75},   # 적갈색 외곽선 → 진회색
                {'hue': [10, 50], 'sat': [0.30, 1.01], 'val': [0.22, 1.01], 'sat_mul': 0.06, 'val_mul': 0.74},   # 주황 털 → 중간 회색
            ],
        },
    },
}


def rgb_to_hsv(rgb):
    rgb = rgb.astype(np.float32) / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn
    h = np.zeros_like(mx)
    m = d > 1e-6
    rc = np.where(m, (mx - r) / np.where(m, d, 1), 0); gc = np.where(m, (mx - g) / np.where(m, d, 1), 0); bc = np.where(m, (mx - b) / np.where(m, d, 1), 0)
    h = np.where(mx == r, bc - gc, np.where(mx == g, 2.0 + rc - bc, 4.0 + gc - rc))
    h = np.where(m, (h / 6.0) % 1.0, 0) * 360.0
    s = np.where(mx > 1e-6, d / np.where(mx > 1e-6, mx, 1), 0)
    return h, s, mx


def hsv_to_rgb(h, s, v):
    h = (h % 360.0) / 60.0
    i = np.floor(h).astype(int) % 6; f = h - np.floor(h)
    p = v * (1 - s); q = v * (1 - s * f); t = v * (1 - s * (1 - f))
    r = np.choose(i, [v, q, p, p, t, v]); g = np.choose(i, [t, v, v, q, p, p]); b = np.choose(i, [p, p, t, v, v, q])
    return np.clip(np.stack([r, g, b], -1) * 255.0 + 0.5, 0, 255).astype(np.uint8)


def hue_in(h, lo, hi):
    return (h >= lo) & (h <= hi) if lo <= hi else (h >= lo) | (h <= hi)


def apply_preset(im, preset):
    a = np.array(im.convert('RGBA'))
    rgb = a[..., :3]; alpha = a[..., 3]
    h, s, v = rgb_to_hsv(rgb)
    visible = alpha >= ALPHA_MIN
    outline_v = preset.get('outline_v', 0.22)
    outline = visible & (v < outline_v)
    done = ~visible | outline
    h2, s2, v2 = h.copy(), s.copy(), v.copy()
    for rule in preset['rules']:
        sel = ~done & hue_in(h, *rule['hue'])
        if 'sat' in rule: sel &= (s >= rule['sat'][0]) & (s <= rule['sat'][1])
        if 'val' in rule: sel &= (v >= rule['val'][0]) & (v <= rule['val'][1])
        if 'set_hue' in rule: h2[sel] = rule['set_hue']
        if 'shift_hue' in rule: h2[sel] = (h[sel] + rule['shift_hue']) % 360
        if 'sat_mul' in rule: s2[sel] = s[sel] * rule['sat_mul']
        if 'sat_add' in rule: s2[sel] = s2[sel] + rule['sat_add']
        if 'val_mul' in rule: v2[sel] = v[sel] * rule['val_mul']
        if 'val_add' in rule: v2[sel] = v2[sel] + rule['val_add']
        if 'val_max' in rule: v2[sel] = np.minimum(v2[sel], rule['val_max'])
        done |= sel   # 보호 규칙(action 없음)도 여기서 잠긴다
    if 'outline_val_mul' in preset: v2[outline] = v[outline] * preset['outline_val_mul']
    out = a.copy()
    out[..., :3] = hsv_to_rgb(h2, np.clip(s2, 0, 1), np.clip(v2, 0, 1))
    out[~visible, :3] = rgb[~visible]   # 투명 픽셀의 RGB 는 원본 그대로(alpha 도 그대로)
    return Image.fromarray(out, 'RGBA')


def analyze(creature):
    for suf in SHEETS:
        im = Image.open(SRC / f'{creature}{suf}.webp').convert('RGBA'); a = np.array(im)
        vis = a[..., 3] >= ALPHA_MIN; h, s, v = rgb_to_hsv(a[..., :3])
        h, s, v = h[vis], s[vis], v[vis]
        print(f'== {creature}{suf}.png  visible px {vis.sum()}  dark(v<0.22) {(v<0.22).mean()*100:.1f}%  greyish(s<0.15) {(s<0.15).mean()*100:.1f}%')
        bins = np.arange(0, 361, 15)
        cnt, _ = np.histogram(h[(s >= 0.15) & (v >= 0.22)], bins=bins)
        tot = max(cnt.sum(), 1)
        for i, c in enumerate(cnt):
            if c / tot >= 0.01:
                sel = (s >= 0.15) & (v >= 0.22) & (h >= bins[i]) & (h < bins[i + 1])
                print(f'   hue {bins[i]:3d}-{bins[i+1]:3d}: {100*c/tot:5.1f}%  sat {s[sel].mean():.2f}  val {v[sel].mean():.2f}')
        lo = (s < 0.15) & (v >= 0.22)
        if lo.any(): print(f'   low-sat (s<0.15, v>=0.22): {100*lo.mean():.1f}%  val mean {v[lo].mean():.2f}')


def make(creature, skin):
    preset = PRESETS[creature][skin]
    for suf in SHEETS:
        src = SRC / f'{creature}{suf}.webp'; dst = SRC / f'{creature}-{skin}{suf}.webp'
        base = Image.open(src); out = apply_preset(base, preset)
        assert np.array_equal(np.array(base.convert('RGBA'))[..., 3], np.array(out)[..., 3]), 'alpha changed'   # 픽셀 정렬 100% — 기하(접지·공 bbox·run)는 기본 시트와 동일
        out.save(dst, lossless=True, quality=100, method=6)   # 게임 시트는 WebP 무손실(docs/GameGuide/04-ops/image-assets.md)
        print('wrote', dst, '(alpha identical to base)')


def compare(creature, skin, out_path):
    base = Image.open(SRC / f'{creature}.webp').convert('RGBA'); sk = Image.open(SRC / f'{creature}-{skin}.webp').convert('RGBA')
    bg = (110, 190, 100, 255)
    # 위: 기본 row0 4칸 + 공 2칸, 아래: 스킨 — 160px 원본 / 오른쪽에 28px(=×0.175) 축소
    def strip(im):
        cells = [im.crop((c * 160, 0, (c + 1) * 160, 160)) for c in range(4)] + [im.crop((0, 320, 160, 480)), im.crop((320, 320, 480, 480))]
        row = Image.new('RGBA', (160 * 6 + 200, 160), bg)
        for i, c in enumerate(cells): row.alpha_composite(c, (i * 160, 0))
        small = im.crop((0, 0, 160, 160)).resize((40, 40), Image.LANCZOS); row.alpha_composite(small, (160 * 6 + 20, 60))
        smallb = im.crop((0, 320, 160, 480)).resize((40, 40), Image.LANCZOS); row.alpha_composite(smallb, (160 * 6 + 80, 60))
        return row
    top = strip(base); bot = strip(sk)
    out = Image.new('RGBA', (top.width, 320), bg); out.alpha_composite(top, (0, 0)); out.alpha_composite(bot, (0, 160))
    out.save(out_path); print('wrote', out_path)


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'analyze': analyze(sys.argv[2])
    elif cmd == 'make': make(sys.argv[2], sys.argv[3])
    elif cmd == 'compare': compare(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else f'/tmp/{sys.argv[2]}-{sys.argv[3]}-compare.png')
    else: sys.exit(__doc__)
