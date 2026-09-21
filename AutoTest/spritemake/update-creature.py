#!/usr/bin/env python3
"""배치 final/ 의 시트 3장을 게임 assets/marble/creatures/ 로 덮어쓰고 manifest md5 갱신. usage: update-creature.py <batch> <species-or-sheetname> <manifestSection> "<note>" (md5 는 배치 qa/candidate-qa.json 과 대조)"""
import hashlib, json, os, sys, tempfile
from pathlib import Path
batch, sp, section, note = sys.argv[1:5]
FINAL = Path('/Users/radar/Work/SpriteMake/output') / batch / 'final' / 'creatures'
GAME = Path('/Users/radar/Work/LAMDiceBot'); DEST = GAME/'assets'/'marble'/'creatures'; MAN = GAME/'assets'/'marble'/'marble-run.manifest.json'
def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()
qa = json.loads((Path('/Users/radar/Work/SpriteMake/output')/batch/'qa'/'candidate-qa.json').read_text())
qa_md5 = {i['assetId'].replace('-main',''): i['checks']['md5'] for i in qa['assets']}
raw = MAN.read_text(encoding='utf-8'); j = json.loads(raw)
assert json.dumps(j, indent=2, ensure_ascii=False)+'\n' == raw
sec = j[section]; assert sp in sec['assets']
for n in (sp, f'{sp}-sleep', f'{sp}-scuffle'):
    src = FINAL/f'{n}.png'; dst = DEST/f'{n}.png'; m = md5(src)
    assert qa_md5.get(n) == m, f'md5 mismatch vs batch QA for {n}: {m} vs {qa_md5.get(n)}'
    with tempfile.NamedTemporaryFile(dir=dst.parent, prefix=f'.{dst.name}.', delete=False) as t: t.write(src.read_bytes()); tp = Path(t.name)
    os.replace(tp, dst); os.chmod(dst, 0o644); assert md5(dst) == m
    old = sec['assets'][n]['md5']; sec['assets'][n]['md5'] = m
    print(f'{n}: {old} -> {m}')
sec['note'] = sec.get('note','') + ' / ' + note
MAN.write_text(json.dumps(j, indent=2, ensure_ascii=False)+'\n', encoding='utf-8'); print('manifest updated')
