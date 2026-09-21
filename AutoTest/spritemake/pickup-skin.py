#!/usr/bin/env python3
"""SpriteMake 배치 final/ 의 시트 3장(<sheet>.png/-sleep/-scuffle)을 게임 assets/marble/creatures/ 로 새로 들여오고 manifest 에 섹션을 쓴다 (기존 파일 덮어쓰기 거부).
usage: pickup-skin.py <batch-dir-name> <sheet> <manifestSection> "<note>" [request-doc-path]
  sheet 예: pillbug-rainbow (스킨) / ribbonpig (기본 시트 교체는 먼저 옛 파일을 옮겨 둔 뒤)
md5 는 배치 qa/candidate-qa.json(assetId <sheet>-main / <sheet>-sleep / <sheet>-scuffle)과 대조한다 — 검증(verify-creature.py)은 호출 전에 따로."""
import hashlib, json, os, sys, tempfile
from pathlib import Path

batch, sheet, section, note = sys.argv[1:5]
request = sys.argv[5] if len(sys.argv) > 5 else ''
BATCH = Path('/Users/radar/Work/SpriteMake/output') / batch
FINAL = BATCH / 'final' / 'creatures'
GAME = Path(__file__).resolve().parents[2]
DEST = GAME / 'assets' / 'marble' / 'creatures'
MAN = GAME / 'assets' / 'marble' / 'marble-run.manifest.json'
NAMES = [sheet, f'{sheet}-sleep', f'{sheet}-scuffle']

def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()

qa = json.loads((BATCH / 'qa' / 'candidate-qa.json').read_text())
qa_md5 = {i['assetId'].replace('-main', ''): i['checks']['md5'] for i in qa['assets']}

copied = {}
for n in NAMES:
    src = FINAL / f'{n}.png'; dst = DEST / f'{n}.png'
    if not src.exists(): sys.exit(f'missing final: {src}')
    if dst.exists(): sys.exit(f'refusing to overwrite existing game asset: {dst}')
    m = md5(src)
    if qa_md5.get(n) != m: sys.exit(f'md5 mismatch vs batch QA for {n}: final {m} qa {qa_md5.get(n)}')
    with tempfile.NamedTemporaryFile(dir=dst.parent, prefix=f'.{dst.name}.', delete=False) as t: t.write(src.read_bytes()); tp = Path(t.name)
    os.replace(tp, dst); os.chmod(dst, 0o644); assert md5(dst) == m
    copied[n] = m; print('copied', dst, m)

raw = MAN.read_text(encoding='utf-8'); j = json.loads(raw)
assert json.dumps(j, indent=2, ensure_ascii=False) + '\n' == raw, 'manifest formatting would change'
if section in j: sys.exit(f'{section} already present')
base = dict(canvas=[640, 800], grid=[4, 5], cell=[160, 160], anchor=[80, 150], sourcePlaneY=150, ballCenter=[80, 80], ballDiameter=112)
j[section] = {
    'batch': batch, 'status': 'all-3-picked-up', 'request': request, 'note': note,
    'assets': {
        sheet: {'image': f'creatures/{sheet}.png', **base, 'animations': 'hedgehog 시트와 동일(idle/curl/ball/uncurl/faceplant)', 'targetGamePath': f'assets/marble/creatures/{sheet}.png', 'md5': copied[sheet], 'qaStatus': 'PASS'},
        f'{sheet}-sleep': {'image': f'creatures/{sheet}-sleep.png', 'canvas': [640, 160], 'grid': [4, 1], 'cell': [160, 160], 'anchor': [80, 150], 'sourcePlaneY': 150, 'frames': ['lying', 'breathing', 'waking', 'sit-up'], 'targetGamePath': f'assets/marble/creatures/{sheet}-sleep.png', 'md5': copied[f'{sheet}-sleep'], 'qaStatus': 'PASS'},
        f'{sheet}-scuffle': {'image': f'creatures/{sheet}-scuffle.png', 'canvas': [640, 320], 'grid': [4, 2], 'cell': [160, 160], 'anchor': [80, 150], 'sourcePlaneY': 150, 'frames': ['push-lean', 'push-step', 'push-heave', 'push-recoil', 'startle-jump', 'falling', 'dizzy-sit-a', 'dizzy-sit-b'], 'targetGamePath': f'assets/marble/creatures/{sheet}-scuffle.png', 'md5': copied[f'{sheet}-scuffle'], 'qaStatus': 'PASS'},
    },
}
MAN.write_text(json.dumps(j, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'manifest {section} written')
