#!/usr/bin/env python3
"""데구리 풍선 액세서리 스프라이트 생성기 — 저녁 메뉴 7종 (docs/goal/marble-balloon-accessory.md).

이미지 생성 모델 없이 PIL 도형만으로 그린다. **같은 스크립트 → 바이트 동일한 출력**(난수 없음).
나중에 GPT/SpriteMake 그림으로 갈아끼울 때는 아래 계약만 지키면 코드·카탈로그를 안 건드리고 파일만 덮어쓰면 된다:

    캔버스   96 × 128 소스 px, 단일 프레임 (애니 스트립 아님)
    표시     24 × 32 화면 px (SRC_SCALE 0.25 — 동물 시트와 같은 배율)
    매듭     소스 (48, 106) — 줄이 붙는 점. 여기가 어긋나면 줄이 엉뚱한 데 매달린다
    외곽선   #5A3D52, 4 소스 px (화면 1px) — 동물 시트와 동일
    알파     하드 에지 (반투명 테두리 없음) — 동물 시트와 동일

사용법:
    python3 make-balloons.py               # assets/marble/accessories/*.webp 로 내보내기 (pngquant → cwebp 무손실)
    python3 make-balloons.py --png DIR     # 검수용 PNG + 미리보기 시트만 DIR 에
    python3 make-balloons.py --verify DIR  # 남이 그려 온 PNG/WEBP 가 계약을 지키는지만 검사(생성 안 함)

pngquant/cwebp 는 pickup-skin.py 와 같은 요구 사항 (brew install pngquant webp).
"""
import argparse, math, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops

# ─── 계약 상수 ───
SS = 4                        # 슈퍼샘플 배율 (4배로 그린 뒤 축소)
CW, CH = 96, 128              # 소스 셀
W, H = CW * SS, CH * SS
KNOT = (48, 106)              # 줄이 붙는 점 (소스 px)
OUTLINE = (90, 61, 82, 255)   # #5A3D52 — 동물 시트 외곽선
OUTLINE_PX = 4                # 소스 px
ALPHA_CUT = 110               # 하드 에지 임계값 (동물 시트 alphaThreshold 와 같은 기준)
OUTLINE_TOL = 40              # 외곽선 색 허용치(채널당) — LANCZOS 축소 + pngquant 팔레트 양자화가 섞여 정확한 값은 안 나온다
EDGE_MARGIN = OUTLINE_PX + 1  # 실루엣이 캔버스 가장자리에서 떨어져 있어야 하는 최소 거리 — 붙으면 외곽선이 잘린다

DEST = Path(__file__).resolve().parents[2] / 'assets' / 'marble' / 'accessories'


def S(v):
    """소스 px → 작업 캔버스 px."""
    return v * SS


# ─── 칠하기 ───
def mask_new():
    return Image.new('L', (W, H), 0)


def shaded(mask, base, dark, light):
    """부위 하나를 칠한다 — 왼위 밝음 → 오른아래 어두움 대각 그라데이션(풍선 특유의 부풀어 보이는 음영)."""
    g = Image.linear_gradient('L').resize((W, H)).rotate(-35, resample=Image.BILINEAR, fillcolor=128)
    layer = Image.new('RGBA', (W, H), base)
    layer = Image.composite(Image.new('RGBA', (W, H), dark), layer, g.point(lambda v: max(0, min(255, (v - 150) * 2))))
    layer = Image.composite(Image.new('RGBA', (W, H), light), layer, g.point(lambda v: max(0, min(255, (110 - v) * 2))))
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste(layer, (0, 0), mask)
    return out


def dots(spec, color, clip=None, blur=1.0):
    """작은 점 무리(참깨·페퍼로니·튀김옷 등). spec = [(x, y, r)] 소스 px."""
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for (x, y, r) in spec:
        d.ellipse((S(x - r), S(y - r), S(x + r), S(y + r)), fill=color)
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur * SS * 0.25))
    if clip is not None:
        out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        out.paste(im, (0, 0), clip)
        return out
    return im


def bottom_center(mask):
    """마스크의 가장 아래 채워진 행의 가로 중심 (소스 px). 기울인 모양도 목이 몸에서 자연스럽게 나오게."""
    bbox = mask.getbbox()
    y1 = bbox[3]
    row = mask.crop((0, max(0, y1 - 3 * SS), W, y1)).getbbox()
    return ((row[0] + row[2]) / 2 / SS, (y1 - SS) / SS)


def neck(mask, w=7):
    """몸 아래 끝 → 계약 매듭점까지 잇는 목. 모양마다 좌표를 손으로 맞추지 않는다."""
    cx, by = bottom_center(mask)
    return knot_mask(by - 2, cx=cx, w=w)


def knot_mask(from_y, cx=KNOT[0], w=7):
    """목 + 매듭 — 몸 아래(from_y)에서 계약 지점 KNOT(48, 106)까지 이어 준다.
    모양마다 몸이 끝나는 높이가 달라도 줄이 붙는 점은 항상 같아야 하므로, 목 길이로 그 차이를 흡수한다."""
    m = mask_new()
    d = ImageDraw.Draw(m)
    kx, ky = KNOT
    d.polygon([(S(cx - w / 2), S(from_y)), (S(cx + w / 2), S(from_y)),
               (S(kx + 2), S(ky - 5)), (S(kx - 2), S(ky - 5))], fill=255)
    d.ellipse((S(kx - 5), S(ky - 5), S(kx + 5), S(ky + 5)), fill=255)
    return m


class Cell:
    """부위(마스크 + 색)를 쌓아 셀 한 장을 만든다. 외곽선은 전체 실루엣 기준으로 한 번만 두른다."""

    def __init__(self):
        self.parts = []      # (mask, base, dark, light, rim|None)
        self.decals = []     # RGBA 레이어 (부위 위에 얹는 무늬)
        self.shines = []     # (cx, cy, rx, ry) 소스 px

    def add(self, mask, colors, rim=None):
        self.parts.append((mask, colors, rim))
        return mask

    def decal(self, layer):
        self.decals.append(layer)

    def shine(self, cx, cy, rx, ry):
        self.shines.append((cx, cy, rx, ry))

    def union(self):
        u = mask_new()
        for (m, _, _) in self.parts:
            u = ImageChops.lighter(u, m)
        return u

    def render(self):
        union = self.union()
        out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        out.paste(Image.new('RGBA', (W, H), OUTLINE), (0, 0), union.filter(ImageFilter.MaxFilter(OUTLINE_PX * SS * 2 + 1)))
        for (m, colors, rim) in self.parts:
            if rim:   # 부위 경계선 — 24px 에서 층이 뭉개지지 않게 (햄버거·김밥)
                out = Image.alpha_composite(out, shaded(m.filter(ImageFilter.MaxFilter(2 * SS + 1)), rim, rim, rim))
            out = Image.alpha_composite(out, shaded(m, *colors))
        for layer in self.decals:
            out = Image.alpha_composite(out, layer)
        if self.shines:
            hl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            d = ImageDraw.Draw(hl)
            for (cx, cy, rx, ry) in self.shines:
                d.ellipse((S(cx - rx), S(cy - ry), S(cx + rx), S(cy + ry)), fill=(255, 255, 255, 205))
            hl = hl.filter(ImageFilter.GaussianBlur(0.6 * SS))
            inside = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            inside.paste(hl, (0, 0), union)   # 외곽선 밴드가 아니라 몸 안쪽으로만 — 부푼 마스크로 자르면 하이라이트가 외곽선을 덮는다
            out = Image.alpha_composite(out, inside)
        # 하이라이트·무늬가 외곽선 밖으로 번지지 않게 실루엣으로 한 번 더 자른다
        clipped = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        clipped.paste(out, (0, 0), union.filter(ImageFilter.MaxFilter(OUTLINE_PX * SS * 2 + 1)))
        small = clipped.resize((CW, CH), Image.LANCZOS)
        small.putalpha(small.getchannel('A').point(lambda v: 255 if v >= ALPHA_CUT else 0))
        return small


def blob(pts):
    """원을 겹쳐 만든 매끈한 덩어리. pts = [(cx, cy, r)] 소스 px."""
    m = mask_new()
    d = ImageDraw.Draw(m)
    for (cx, cy, r) in pts:
        d.ellipse((S(cx - r), S(cy - r), S(cx + r), S(cy + r)), fill=255)
    return m


def taper(x0, y0, r0, x1, y1, r1, steps=9):
    """두 원 사이를 원으로 이어 물방울/원뿔 실루엣을 만든다."""
    pts = []
    for k in range(steps):
        t = k / (steps - 1)
        pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t * t))
    return blob(pts)


def smooth(mask, px):
    """열림→닫힘으로 뾰족한 모서리를 둥글린다(풍선은 각이 안 선다)."""
    k = px * SS + 1
    return mask.filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k)) \
               .filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))


# ─── 메뉴 7종 ───
# 실루엣을 서로 다르게 잡았다 — 24px 에서는 색보다 윤곽이 먼저 읽힌다.
#   치킨 물방울+뼈 / 피자 삼각 / 떡볶이 세로원통 / 족발 두갈래굽 / 김밥 원 / 햄버거 넓적층 / 탕수육 울퉁불퉁

def chicken():
    """치킨 — 닭다리: 황갈색 살이 아래로 좁아지며 짧은 흰 뼈로 이어진다."""
    c = Cell()
    meat = ImageChops.lighter(taper(46, 43, 32, 52, 74, 14), blob([(29, 50, 19)]))
    bone = mask_new()
    d = ImageDraw.Draw(bone)
    d.polygon([(S(46), S(70)), (S(60), S(70)), (S(60), S(92)), (S(48), S(92))], fill=255)
    d.ellipse((S(42), S(84), S(56), S(98)), fill=255)   # 뼈 끝 두 혹 — 살에 가깝게 붙여 별개 덩어리로 안 보이게
    d.ellipse((S(54), S(84), S(68), S(98)), fill=255)
    c.add(ImageChops.lighter(bone, neck(bone)), ((247, 238, 214, 255), (206, 190, 156, 255), (255, 253, 244, 255)))
    c.add(meat, ((222, 142, 52, 255), (162, 88, 28, 255), (246, 192, 112, 255)))
    c.decal(dots([(62, 38, 2.5), (48, 58, 2), (28, 48, 2), (58, 20, 1.8)], (170, 92, 30, 130), clip=meat))
    c.shine(32, 29, 9, 11)
    return c


def pizza():
    """피자 — 아래로 뾰족한 삼각 조각. 크러스트는 윗변에 얹은 얇은 띠(넓으면 버섯처럼 보인다)."""
    c = Cell()
    slice_m = mask_new()
    ImageDraw.Draw(slice_m).polygon([(S(14), S(24)), (S(82), S(24)), (S(48), S(100))], fill=255)
    slice_m = smooth(slice_m, 3)
    crust = mask_new()
    ImageDraw.Draw(crust).rounded_rectangle((S(14), S(14), S(82), S(32)), radius=S(9), fill=255)
    c.add(ImageChops.lighter(slice_m, neck(slice_m)), ((250, 196, 82, 255), (206, 142, 36, 255), (255, 228, 150, 255)))
    c.add(crust, ((226, 162, 76, 255), (176, 112, 38, 255), (248, 202, 130, 255)), rim=(150, 96, 40, 255))
    c.decal(dots([(33, 46, 6.5), (63, 44, 6), (48, 66, 5.5)], (206, 58, 48, 255), clip=slice_m, blur=0.5))
    c.decal(dots([(35, 44, 2), (65, 42, 1.9), (50, 64, 1.8)], (236, 118, 102, 200), clip=slice_m, blur=0.6))
    c.shine(30, 22, 8, 4)
    return c


def tteokbokki():
    """떡볶이 — 양념 두른 떡 두 가락이 어긋나게 겹친 모습. 한 가락만 세우면 유리컵으로 읽힌다."""
    c = Cell()

    def stick(x0, y0, x1, y1):
        m = mask_new()
        ImageDraw.Draw(m).rounded_rectangle((S(x0), S(y0), S(x1), S(y1)), radius=S((x1 - x0) / 2), fill=255)
        return m

    back = stick(20, 14, 56, 80)     # 뒤 떡 (왼쪽 위)
    front = stick(44, 30, 80, 96)    # 앞 떡 (오른쪽 아래)
    body = ImageChops.lighter(back, front)
    c.add(ImageChops.lighter(body, neck(front)), ((216, 52, 40, 255), (150, 26, 24, 255), (240, 112, 84, 255)))
    c.add(ImageChops.subtract(front, mask_new()), ((208, 46, 36, 255), (144, 24, 22, 255), (236, 104, 78, 255)), rim=(140, 22, 20, 255))
    cap = mask_new()   # 앞 떡의 썰린 단면 — 양념이 덮여 크림색이 조금만 드러난다
    ImageDraw.Draw(cap).ellipse((S(48), S(30), S(76), S(44)), fill=255)
    c.add(ImageChops.multiply(cap, front), ((246, 226, 198, 255), (204, 180, 150, 255), (255, 248, 238, 255)), rim=(160, 34, 28, 255))
    c.decal(dots([(32, 46, 4.5), (62, 74, 4.2)], (94, 158, 74, 245), clip=body, blur=0.4))                       # 대파
    c.decal(dots([(30, 64, 2.1), (44, 26, 2), (66, 58, 2), (56, 86, 1.9)], (252, 242, 214, 230), clip=body, blur=0.4))   # 참깨
    c.shine(28, 24, 5, 8)
    return c


def jokbal():
    """족발 — 짙은 적갈 살덩이 + 맨 아래 크림색 발굽 둘. 치킨(밝은 황갈 + 흰 뼈)과 색 대비로 구분된다."""
    c = Cell()
    meat = ImageChops.lighter(taper(48, 42, 32, 48, 72, 15), blob([(28, 56, 16), (68, 54, 15)]))
    hoof = mask_new()
    d = ImageDraw.Draw(hoof)
    d.ellipse((S(28), S(68), S(48), S(98)), fill=255)
    d.ellipse((S(48), S(68), S(68), S(98)), fill=255)
    gap = mask_new()   # 굽 사이 골 — 굽 높이 안에서만(위로 올라가면 다리 두 개로 보인다)
    ImageDraw.Draw(gap).polygon([(S(45), S(76)), (S(51), S(76)), (S(50), S(100)), (S(46), S(100))], fill=255)
    hoof = ImageChops.subtract(hoof, gap)
    c.add(ImageChops.lighter(hoof, neck(hoof)), ((238, 224, 200, 255), (194, 176, 148, 255), (255, 250, 240, 255)))
    c.add(ImageChops.subtract(meat, gap), ((158, 76, 44, 255), (100, 42, 24, 255), (202, 122, 78, 255)))
    c.shine(34, 32, 9, 10)
    return c


def gimbap():
    """김밥 — 썰어 놓은 단면: 검은 김 테두리 + 흰 밥 + 속 세 가지."""
    c = Cell()
    nori = blob([(48, 52, 38)])
    rice = blob([(48, 52, 30)])
    c.add(ImageChops.lighter(nori, neck(nori)), ((46, 44, 48, 255), (24, 22, 26, 255), (84, 80, 86, 255)))
    c.add(rice, ((252, 250, 242, 255), (214, 210, 198, 255), (255, 255, 255, 255)))
    c.decal(dots([(48, 52, 8)], (250, 206, 70, 255), clip=rice, blur=0.4))                      # 단무지
    c.decal(dots([(36, 42, 6), (61, 62, 5.5)], (232, 122, 48, 255), clip=rice, blur=0.4))       # 당근
    c.decal(dots([(61, 41, 5.5), (36, 63, 6)], (86, 158, 74, 255), clip=rice, blur=0.4))        # 시금치
    c.shine(34, 32, 6, 5)
    return c


def burger():
    """햄버거 — 넓적한 층: 참깨빵 / 치즈 / 패티 / 양상추 / 아랫빵."""
    c = Cell()

    def slab(x0, y0, x1, y1, r):
        m = mask_new()
        ImageDraw.Draw(m).rounded_rectangle((S(x0), S(y0), S(x1), S(y1)), radius=S(r), fill=255)
        return m

    top_bun = blob([(48, 36, 26), (30, 42, 20), (66, 42, 20)])   # 돔을 낮게 — 높으면 빵만 눈에 띈다
    ImageDraw.Draw(top_bun).rectangle((S(20), S(40), S(76), S(52)), fill=255)
    bottom_bun = slab(20, 84, 76, 100, 8)
    c.add(ImageChops.lighter(bottom_bun, neck(bottom_bun)),
          ((226, 166, 92, 255), (172, 116, 54, 255), (246, 200, 142, 255)))                 # 아랫빵
    c.add(slab(14, 76, 82, 90, 7), ((110, 174, 82, 255), (70, 124, 52, 255), (156, 206, 122, 255)), rim=(64, 108, 48, 255))   # 양상추
    c.add(slab(17, 62, 79, 80, 8), ((124, 78, 46, 255), (80, 46, 26, 255), (166, 114, 74, 255)), rim=(66, 38, 24, 255))       # 패티
    c.add(slab(10, 52, 86, 68, 4), ((250, 198, 66, 255), (208, 148, 30, 255), (255, 228, 140, 255)), rim=(184, 128, 28, 255)) # 치즈 — 빵보다 넓게 삐져나오게
    c.add(top_bun, ((232, 174, 98, 255), (178, 122, 58, 255), (250, 208, 150, 255)), rim=(154, 100, 46, 255))                 # 윗빵
    c.decal(dots([(34, 30, 3.4), (54, 26, 3.2), (64, 38, 3.2), (44, 40, 3)], (255, 250, 236, 255), clip=top_bun, blur=0.3))   # 참깨
    c.shine(30, 26, 7, 4)
    return c


def tangsuyuk():
    """탕수육 — 튀김 덩어리에 붉은 소스가 위에서 흘러내린 모습."""
    c = Cell()
    lump = blob([(48, 50, 26), (29, 56, 18), (67, 54, 19), (40, 74, 18), (61, 74, 16)])
    sauce = ImageChops.lighter(
        blob([(46, 38, 21), (29, 45, 13), (66, 43, 13)]),
        blob([(27, 60, 9), (67, 62, 8), (48, 58, 11)]),   # 옆·아래로 흘러내린 방울 — 위에만 있으면 모자처럼 보인다
    )
    c.add(ImageChops.lighter(lump, neck(lump)), ((236, 176, 84, 255), (186, 122, 40, 255), (252, 214, 148, 255)))
    c.add(ImageChops.multiply(sauce, lump), ((216, 82, 46, 255), (158, 44, 28, 255), (244, 140, 92, 255)))
    c.decal(dots([(34, 70, 4), (60, 76, 3.5)], (110, 170, 88, 255), clip=lump, blur=0.5))   # 오이
    c.decal(dots([(70, 64, 3.5)], (248, 208, 92, 255), clip=lump, blur=0.5))                # 파인애플
    c.decal(dots([(44, 86, 2.4), (30, 62, 2)], (176, 114, 40, 140), clip=lump, blur=0.6))
    c.shine(35, 31, 8, 6)
    return c


SPRITES = [
    ('balloon-chicken', chicken),
    ('balloon-pizza', pizza),
    ('balloon-tteokbokki', tteokbokki),
    ('balloon-jokbal', jokbal),
    ('balloon-gimbap', gimbap),
    ('balloon-burger', burger),
    ('balloon-tangsuyuk', tangsuyuk),
]


def contract_check(name, im):
    """계약 위반을 조용히 넘기지 않는다 — 나중에 GPT 그림을 넣을 때도 같은 검사를 통과해야 한다."""
    errs = []
    if im.size != (CW, CH):
        errs.append(f'캔버스 {im.size} != ({CW}, {CH})')
    a = im.getchannel('A')
    hist = a.histogram()
    if sum(hist[1:255]) > 0:
        errs.append(f'반투명 픽셀 {sum(hist[1:255])}개 (하드 에지여야 함)')
    kx, ky = KNOT
    if a.getpixel((kx, ky)) != 255:
        errs.append(f'매듭 ({kx}, {ky}) 이 비었다 — 줄이 허공에 붙는다')
    if hist[255] == 0:
        errs.append('빈 이미지')
        return errs

    # 외곽선 — 계약의 네 번째 항목인데 예전엔 검사하지 않아 잘린 그림 3장이 통과했다.
    bbox = a.getbbox()
    if bbox[0] < EDGE_MARGIN or bbox[1] < EDGE_MARGIN or bbox[2] > CW - EDGE_MARGIN or bbox[3] > CH - EDGE_MARGIN:
        errs.append(f'실루엣이 캔버스 가장자리에 너무 가깝다 {bbox} — 외곽선이 잘린다 (여백 {EDGE_MARGIN}px 필요)')
    px, ap = im.load(), a.load()
    bad = tot = 0
    for y in range(CH):
        for x in range(CW):
            if ap[x, y] != 255:
                continue
            if all(0 <= x + dx < CW and 0 <= y + dy < CH and ap[x + dx, y + dy] == 255
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                continue   # 안쪽 픽셀
            tot += 1
            r, g, b = px[x, y][:3]
            if max(abs(r - OUTLINE[0]), abs(g - OUTLINE[1]), abs(b - OUTLINE[2])) > OUTLINE_TOL:
                bad += 1
    if tot and bad / tot > 0.08:
        errs.append(f'실루엣 경계 {bad}/{tot} 픽셀이 외곽선 색(±{OUTLINE_TOL})이 아니다 — 잘렸거나 무늬·하이라이트가 덮었다')
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--png', metavar='DIR', help='webp 대신 검수용 PNG + 미리보기 시트를 이 폴더에')
    ap.add_argument('--verify', metavar='DIR', help='이 폴더의 PNG/WEBP 를 계약으로 검사만 한다(외부 그림 인수용)')
    args = ap.parse_args()

    if args.verify:
        src = Path(args.verify)
        files = sorted([f for f in src.iterdir() if f.suffix.lower() in ('.png', '.webp') and not f.name.startswith('_')])
        if not files:
            print(f'{src} 에 PNG/WEBP 가 없다', file=sys.stderr)
            return 1
        bad = 0
        for f in files:
            im = Image.open(f).convert('RGBA')
            errs = contract_check(f.stem, im)
            print(('  OK  ' if not errs else '  ✗   ') + f.name + ('' if not errs else '\n        ' + '\n        '.join(errs)))
            bad += bool(errs)
        print(f'\n{len(files) - bad}/{len(files)} 통과')
        return 1 if bad else 0

    cells = [(name, fn().render()) for name, fn in SPRITES]

    failed = False
    for name, im in cells:
        errs = contract_check(name, im)
        for e in errs:
            print(f'  ✗ {name}: {e}', file=sys.stderr)
            failed = True
    if failed:
        return 1

    if args.png:
        out = Path(args.png)
        out.mkdir(parents=True, exist_ok=True)
        for name, im in cells:
            im.save(out / f'{name}.png')
        sheet = Image.new('RGBA', (CW * len(cells), CH), (0, 0, 0, 0))
        for i, (_, im) in enumerate(cells):
            sheet.paste(im, (i * CW, 0))
        Z = 3
        prev = Image.new('RGBA', (sheet.width * Z, sheet.height * Z), (120, 180, 120, 255))
        prev.alpha_composite(sheet.resize((sheet.width * Z, sheet.height * Z), Image.NEAREST))
        prev.save(out / '_preview.png')
        print(f'PNG {len(cells)}장 + _preview.png → {out}')
        return 0

    DEST.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, im in cells:
            raw = Path(tmp) / f'{name}.png'
            im.save(raw)
            q = Path(tmp) / f'{name}-q.png'
            subprocess.run(['pngquant', '--force', '--quality', '65-95', '--speed', '1', '--output', str(q), str(raw)], check=True)
            subprocess.run(['cwebp', '-quiet', '-lossless', '-z', '9', str(q), '-o', str(DEST / f'{name}.webp')], check=True)
            print(f'  {name}.webp  {(DEST / f"{name}.webp").stat().st_size:,}B')
    print(f'{len(cells)}종 → {DEST}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
