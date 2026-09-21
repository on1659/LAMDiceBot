#!/usr/bin/env python3
"""Pick up batch H rabbit finals into LAMDiceBot assets + manifest creaturesH (no overwrite of existing files)."""
import hashlib, json, os, shutil, sys, tempfile
from pathlib import Path

BATCH = Path('/Users/radar/Work/SpriteMake/output/marble-run-creatures-i-2026-09-21')
FINAL = BATCH / 'final' / 'creatures'
GAME = Path('/Users/radar/Work/LAMDiceBot')
DEST = GAME / 'assets' / 'marble' / 'creatures'
MANIFEST = GAME / 'assets' / 'marble' / 'marble-run.manifest.json'
NAMES = ['ribbonpig', 'ribbonpig-sleep', 'ribbonpig-scuffle']
note = sys.argv[1] if len(sys.argv) > 1 else ''

def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()

qa = json.loads((BATCH / 'qa' / 'candidate-qa.json').read_text())
qa_md5 = {}
for item in qa['assets']:
    aid = item['assetId'].replace('-main', '')
    qa_md5[aid] = item['checks']['md5']

copied = {}
for n in NAMES:
    src = FINAL / f'{n}.png'; dst = DEST / f'{n}.png'
    if not src.exists(): sys.exit(f'missing final: {src}')
    if dst.exists(): sys.exit(f'refusing to overwrite existing game asset: {dst}')
    m = md5(src)
    if qa_md5.get(n) != m: sys.exit(f'md5 mismatch vs batch QA for {n}: final {m} qa {qa_md5.get(n)}')
    with tempfile.NamedTemporaryFile(dir=dst.parent, prefix=f'.{dst.name}.', delete=False) as tmp:
        tmp.write(src.read_bytes()); tmp_path = Path(tmp.name)
    os.replace(tmp_path, dst); os.chmod(dst, 0o644)
    assert md5(dst) == m
    copied[n] = m
    print('copied', dst, m)

raw = MANIFEST.read_text(encoding='utf-8')
j = json.loads(raw)
assert json.dumps(j, indent=2, ensure_ascii=False) + '\n' == raw, 'manifest formatting would change'
if 'creaturesI' in j: sys.exit('creaturesH already present')
base = dict(canvas=[640, 800], grid=[4, 5], cell=[160, 160], anchor=[80, 150], sourcePlaneY=150, ballCenter=[80, 80], ballDiameter=112)
j['creaturesI'] = {
    'batch': 'marble-run-creatures-i-2026-09-21',
    'status': 'all-3-picked-up',
    'request': 'docs/spritemake-request/2026-09-21-marble-run-creatures-i.md',
    'note': note,
    'assets': {
        'ribbonpig': {'image': 'creatures/ribbonpig.png', **base, 'animations': 'hedgehog 시트와 동일(idle/curl/ball/uncurl/faceplant)', 'targetGamePath': 'assets/marble/creatures/ribbonpig.png', 'md5': copied['ribbonpig'], 'qaStatus': 'PASS'},
        'ribbonpig-sleep': {'image': 'creatures/ribbonpig-sleep.png', 'canvas': [640, 160], 'grid': [4, 1], 'cell': [160, 160], 'anchor': [80, 150], 'sourcePlaneY': 150, 'frames': ['lying', 'breathing', 'waking', 'sit-up'], 'targetGamePath': 'assets/marble/creatures/ribbonpig-sleep.png', 'md5': copied['ribbonpig-sleep'], 'qaStatus': 'PASS'},
        'ribbonpig-scuffle': {'image': 'creatures/ribbonpig-scuffle.png', 'canvas': [640, 320], 'grid': [4, 2], 'cell': [160, 160], 'anchor': [80, 150], 'sourcePlaneY': 150, 'frames': ['push-lean', 'push-step', 'push-heave', 'push-recoil', 'startle-jump', 'falling', 'dizzy-sit-a', 'dizzy-sit-b'], 'targetGamePath': 'assets/marble/creatures/ribbonpig-scuffle.png', 'md5': copied['ribbonpig-scuffle'], 'qaStatus': 'PASS'},
    },
}
MANIFEST.write_text(json.dumps(j, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print('manifest creaturesH written')
