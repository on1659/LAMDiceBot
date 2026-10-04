#!/usr/bin/env python3
"""SpriteMake 배치 final/ 의 시트 3장(<sheet>.png/-sleep/-scuffle)을 pngquant(256색) → cwebp 무손실로 최적화해 게임 assets/deguri/creatures/{n}.webp 로 들여오고 manifest 에 섹션을 쓴다
(brew install pngquant webp 필요. 기준: docs/GameGuide/04-ops/image-assets.md) (기존 파일 덮어쓰기 거부).
usage: pickup-skin.py <batch-dir-name> <sheet> <manifestSection> "<note>" [request-doc-path] [--allow-fail=<assetId,...>]
  sheet 예: pillbug-rainbow (스킨) / ribbonpig (기본 시트 교체는 먼저 옛 파일을 옮겨 둔 뒤)
md5 는 배치 qa/candidate-qa.json(assetId <sheet>-main / <sheet>-sleep / <sheet>-scuffle)과 대조한다 — 검증(verify-creature.py)은 호출 전에 따로.
배치 QA 가 불합격(checks.pass=false)인 시트는 거부한다. 오탐을 눈으로 확인했을 때만 --allow-fail 로 그 assetId 를 허용하고 note 에 사유를 적는다
(예: 분홍 꽃 의상이 halo 게이트에 걸림 — raccoon-aloha-sleep)."""
import hashlib, json, os, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image   # /opt/homebrew/bin/python3 로 실행(시스템 python3 엔 PIL 없음)

allow_fail = set()
for a in [x for x in sys.argv[1:] if x.startswith('--allow-fail=')]:
    allow_fail |= set(a.split('=', 1)[1].split(',')); sys.argv.remove(a)
batch, sheet, section, note = sys.argv[1:5]
request = sys.argv[5] if len(sys.argv) > 5 else ''
BATCH = Path('/Users/radar/Work/SpriteMake/output') / batch
FINAL = BATCH / 'final' / 'creatures'
GAME = Path(__file__).resolve().parents[2]
DEST = GAME / 'assets' / 'deguri' / 'creatures'
MAN = GAME / 'assets' / 'deguri' / 'deguri.manifest.json'
NAMES = [sheet, f'{sheet}-sleep', f'{sheet}-scuffle']

def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()

qa = json.loads((BATCH / 'qa' / 'candidate-qa.json').read_text())
qa_md5 = {i['assetId'].replace('-main', ''): i['checks']['md5'] for i in qa['assets']}
failed = [i['assetId'] for i in qa['assets'] if not i['checks'].get('pass') and i['assetId'] not in allow_fail]
if failed: sys.exit(f'batch QA failed for {failed} — fix, or --allow-fail=<assetId> after checking it is a false positive')

copied = {}
for n in NAMES:
    src = FINAL / f'{n}.png'; dst = DEST / f'{n}.webp'
    if not src.exists(): sys.exit(f'missing final: {src}')
    if dst.exists(): sys.exit(f'refusing to overwrite existing game asset: {dst}')
    m = md5(src)
    if qa_md5.get(n) != m: sys.exit(f'md5 mismatch vs batch QA for {n}: final {m} qa {qa_md5.get(n)}')
    with tempfile.TemporaryDirectory() as td:
        q = Path(td) / f'{n}.png'
        # 품질 하한 80 을 못 맞추면(exit 99, 무지개 그라데 등) 60 으로 한 번 더 — 그래도 실패면 중단
        # --nofs: 디더링이 거의 투명한 픽셀을 alpha≥8 로 만들어 발바닥선(151)·공 복제 칸(r1c3=r2c0)이 어긋났다(2026-09-29)
        r = subprocess.run(['pngquant', '--nofs', '--quality', '80-100', '--speed', '1', '--strip', '--force', '-o', str(q), str(src)])
        if r.returncode == 99: r = subprocess.run(['pngquant', '--nofs', '--quality', '60-100', '--speed', '1', '--strip', '--force', '-o', str(q), str(src)])
        if r.returncode != 0: sys.exit(f'pngquant failed for {n} (exit {r.returncode})')
        mask = lambda p: [a >= 8 for a in Image.open(p).convert('RGBA').getchannel('A').getdata()]
        if mask(q) != mask(src): sys.exit(f'quantize changed the alpha>=8 mask for {n}')
        subprocess.run(['cwebp', '-quiet', '-lossless', '-z', '9', str(q), '-o', str(dst)], check=True)
    os.chmod(dst, 0o644)
    copied[n] = m; print('copied', dst, f'{src.stat().st_size}→{dst.stat().st_size}B', 'src md5', m)

raw = MAN.read_text(encoding='utf-8'); j = json.loads(raw)
assert json.dumps(j, indent=2, ensure_ascii=False) + '\n' == raw, 'manifest formatting would change'
if section in j: sys.exit(f'{section} already present')
base = dict(canvas=[640, 800], grid=[4, 5], cell=[160, 160], anchor=[80, 150], sourcePlaneY=150, ballCenter=[80, 80], ballDiameter=112)
j[section] = {
    'batch': batch, 'status': 'all-3-picked-up', 'request': request, 'note': note,
    'assets': {
        sheet: {'image': f'creatures/{sheet}.png', **base, 'animations': 'hedgehog 시트와 동일(idle/curl/ball/uncurl/faceplant)', 'targetGamePath': f'assets/deguri/creatures/{sheet}.webp', 'md5': copied[sheet], 'qaStatus': 'PASS'},
        f'{sheet}-sleep': {'image': f'creatures/{sheet}-sleep.png', 'canvas': [640, 160], 'grid': [4, 1], 'cell': [160, 160], 'anchor': [80, 150], 'sourcePlaneY': 150, 'frames': ['lying', 'breathing', 'waking', 'sit-up'], 'targetGamePath': f'assets/deguri/creatures/{sheet}-sleep.webp', 'md5': copied[f'{sheet}-sleep'], 'qaStatus': 'PASS'},
        f'{sheet}-scuffle': {'image': f'creatures/{sheet}-scuffle.png', 'canvas': [640, 320], 'grid': [4, 2], 'cell': [160, 160], 'anchor': [80, 150], 'sourcePlaneY': 150, 'frames': ['push-lean', 'push-step', 'push-heave', 'push-recoil', 'startle-jump', 'falling', 'dizzy-sit-a', 'dizzy-sit-b'], 'targetGamePath': f'assets/deguri/creatures/{sheet}-scuffle.webp', 'md5': copied[f'{sheet}-scuffle'], 'qaStatus': 'PASS'},
    },
}
MAN.write_text(json.dumps(j, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'manifest {section} written')
print('NOTE: 같은 이름의 시트를 교체한 경우 js/deguri-render.js ASSET_VER 을 올릴 것 (assets/deguri/** 는 7일 캐시)')
