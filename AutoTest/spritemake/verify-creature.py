#!/usr/bin/env python3
"""SpriteMake 동물 시트 독립 검증 (Codex QA 를 믿지 않는다). usage: /opt/homebrew/bin/python3 AutoTest/spritemake/verify-creature.py <dir> <species>  — 시트 이름은 <species>.png/-sleep/-scuffle. 스킨 검증은 species 자리에 "ribbonpig-scarf" 처럼 시트 이름을 넣는다."""
import hashlib, sys
from pathlib import Path
from PIL import Image
root = Path(sys.argv[1]); sp = sys.argv[2]
SPECS = {f'{sp}.png': (640, 800, 4, 5), f'{sp}-sleep.png': (640, 160, 4, 1), f'{sp}-scuffle.png': (640, 320, 4, 2)}
def bb(c): return c.getchannel('A').point(lambda a: 255 if a >= 8 else 0).getbbox()
def runs(seq):
    out=[]; s=None
    for i,n in enumerate(seq+[0]):
        if n and s is None: s=i
        if not n and s is not None: out.append((s,i-1)); s=None
    return out
ok = True
for name,(w,h,cols,rows) in SPECS.items():
    p = root/name
    if not p.exists(): print(name,'MISSING'); ok=False; continue
    im = Image.open(p).convert('RGBA'); px = im.load(); W,H = im.size
    size_ok = im.size == (w,h)
    a17 = sum(1 for a in im.getchannel('A').getdata() if 1 <= a <= 7)
    multi=[]; bottoms={}; empty=[]
    for r in range(rows):
        for c in range(cols):
            cell = im.crop((c*160,r*160,(c+1)*160,(r+1)*160)); b = bb(cell)
            if b is None: empty.append((r,c)); continue
            yr = runs([sum(1 for x in range(160) if px[c*160+x,r*160+y][3]>=8) for y in range(160)])
            xr = runs([sum(1 for y in range(160) if px[c*160+x,r*160+y][3]>=8) for x in range(160)])
            if len(yr)>1 or len(xr)>1: multi.append((r,c,yr,xr))
            bottoms[(r,c)] = b[3]
    edge=purple=bgish=0
    for y in range(H):
        for x in range(W):
            r_,g,b_,a = px[x,y]
            if a<8: continue
            if any(not(0<=x+dx<W and 0<=y+dy<H) or px[x+dx,y+dy][3]<8 for dx in(-1,0,1) for dy in(-1,0,1)):
                edge+=1
                if b_>g+35 and r_>g+10 and b_>=r_-10: purple+=1
                if g>r_+30 and g>b_+30: bgish+=1   # green rim (this batch's backdrop)
    line = f'{name}: size {im.size} {"OK" if size_ok else "BAD"} | alpha1-7 {a17} | empty {empty} | multi-run {multi or "none"} | rim purple {100*purple/max(edge,1):.1f}% green {100*bgish/max(edge,1):.1f}% | md5 {hashlib.md5(p.read_bytes()).hexdigest()}'
    if name == f'{sp}.png':
        left = im.crop((480,160,640,320)); right = im.crop((0,320,160,480))
        dup = list(left.getdata()) == list(right.getdata())
        b = bb(right); cx=(b[0]+b[2])/2; cy=(b[1]+b[3])/2
        balls=[im.crop((c*160,320,(c+1)*160,480)) for c in range(4)]
        mind=min(sum(1 for u,v in zip(balls[i].getdata(),balls[j].getdata()) if u!=v) for i in range(4) for j in range(i+1,4))
        grounded=sorted(set(v for (r,c),v in bottoms.items() if (r not in (1,2) or (r==1 and c!=3)) and not (r==4 and c==1) and not (r==3 and c==0)))
        ballok = abs(cx-80)<=2 and abs(cy-80)<=2 and 108<=max(b[3]-b[1],b[2]-b[0])<=120 and b[2]-b[0]<=120
        # standing-frame size spec (original five: <=138x128) -> cap 134x130 for main non-ball cells
        over=[(r,c,bb(im.crop((c*160,r*160,(c+1)*160,(r+1)*160)))) for r in (0,1,3,4) for c in range(4) if not (r==1 and c==3)]
        over=[(r,c,x[2]-x[0],x[3]-x[1]) for r,c,x in over if x and ((r!=4 and (x[2]-x[0]>134 or x[3]-x[1]>130)) or (r==4 and (x[2]-x[0]>156 or x[3]-x[1]>148)))]
        line += f'\n   ball bbox {b} {b[2]-b[0]}x{b[3]-b[1]} center ({cx},{cy}) {"OK" if ballok else "BAD"} | dup {dup} | ball-row min pair diff {mind} | grounded bottoms {grounded}'
        line += f'\n   standing-size >134x130: {over or "none"}'
        # proportion sanity: per-cell maximising shows up as crouch/flatten/faceplant all hitting the same max width as standing
        def wh(r,c):
            x=bb(im.crop((c*160,r*160,(c+1)*160,(r+1)*160))); return (x[2]-x[0], x[3]-x[1])
        stand=wh(0,0); crouch=wh(1,1); flat=wh(1,2)
        widths=[wh(r,c)[0] for r in (0,1,3,4) for c in range(4) if not (r==1 and c==3) and not (r==3 and c==0)]
        same_max=sum(1 for w in widths if w>=max(widths)-1)
        prop_bad = same_max>=8
        line += f'\n   proportions: stand {stand} crouch {crouch} flatten {flat} | cells at max width {same_max}/{len(widths)} -> {"SUSPECT per-cell fit" if prop_bad else "ok"}'
        if not (dup and ballok and grounded==[150]) or over or prop_bad: ok=False
    else:
        line += f'\n   bottoms {sorted(bottoms.items())}'
    if not size_ok or a17 or empty or multi: ok=False
    print(line)
print('ALL_OK' if ok else 'FAIL')
