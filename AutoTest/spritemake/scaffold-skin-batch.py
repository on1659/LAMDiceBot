#!/usr/bin/env python3
"""데구리 생성 스킨 배치 스캐폴드 — SpriteMake/output/marble-run-skin-{creature}-{skin}-{date}/ 를 만든다.
계약(contracts/)·리팩 도구(tools/creatures_skin_png.js)는 같은 동물의 기존 스킨 배치에서 시트 이름만 바꿔 복사하고,
GPT(Codex exec)용 프롬프트 3장 + CODEX-BRIEF.md(생성만, 편집 금지)를 쓴다. 참조 그림은 게임 에셋 webp 를 PNG 로 풀어 ref/ 에.

usage:
  /opt/homebrew/bin/python3 AutoTest/spritemake/scaffold-skin-batch.py <creature> <skin> "<costume>" "<ball note>" [date]
    costume  : 영문 — 기본 동물에 더해지는 의상/변신 설명 (모든 칸에서 보여야 함)
    ball note: 영문 — 공 칸에서 의상이 어떻게 보이는지 (공은 원형 유지, 돌출 ≤120)
  예) ... ribbonpig iron "a steel-grey riveted iron helmet-hood ..." "In ball cells the ball is plated in grey iron ..."

새 동물을 쓰려면 TEMPLATE(그 동물의 기존 생성 스킨 배치)와 ROWS(시트별 칸 순서 문장)를 추가한다.
실행은 CODEX-BRIEF.md 첫 줄 주석 참고. 이후: 원본 직접 판정 → source/SOURCES.json → tools/creatures_skin_png.js repack·qa
→ final/creatures/ 복사 → verify-creature.py → pickup-skin.py (스킬 .claude/skills/marble-skin/SKILL.md)."""
import datetime, shutil, sys
from pathlib import Path
from PIL import Image

OUT = Path('/Users/radar/Work/SpriteMake/output')
GAME = Path(__file__).resolve().parents[2]
CREATURES = GAME / 'assets' / 'marble' / 'creatures'
CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex'

# creature → (템플릿 배치, 템플릿 시트 이름, 리팩 JS). 리팩 JS 는 동물별 칸 규칙(판다·돼지는 r3c0 도 공)이 들어 있어 같은 동물 것을 쓴다
TEMPLATE = {
    'raccoon': ('marble-run-skin-raccoon-ninja-2026-09-22', 'raccoon-ninja', 'creatures_ninja_png.js'),
    'panda': ('marble-run-skin-panda-red-2026-09-22', 'panda-red', 'creatures_redpanda_png.js'),
    'ribbonpig': ('marble-run-skin-ribbonpig-base-2026-09-22', 'ribbonpig', 'creatures_pigbase_png.js'),
}
ROWS = {
    'raccoon': {
        'main': ("row0 idle: c0 ear flick; c1 front-paw tap; c2 sniff/blink; c3 settle. Preserve each base idle pose and half-lidded raccoon expression.\n"
                 "row1 curl: c0 stand; c1 crouch; c2 body rounding; c3 complete ball EXACTLY the same drawing as row2 c0.\n"
                 "row2 ball: c0 plain ball; c1 visibly wide landing squash ball; c2 ball with brown mud splotches; c3 dizzy ball with @@ eyes. All four are genuine curled tail-wrapped BALLS, visibly different, costume visible.\n"
                 "row3 uncurl: c0 ball; c1 half-open; c2 base standing pose A; c3 base standing pose B (match the base poses exactly, no exaggerated waving).\n"
                 "row4 faceplant: c0 wall-hit squashed snout; c1 airborne bounce; c2 spread faceplant (top-down allowed); c3 seeing stars. Same character scale as standing rows."),
        'sleep': "c0 lying sideways asleep, closed eyes; c1 breathing belly rise; c2 wakes with one ear up, no text; c3 sits upright. Match the base raccoon-sleep poses exactly.",
        'scuffle': ("row0 push: c0 leaning stand; c1 stepping and pushing; c2 forceful push with snout scrunch; c3 push recoil.\n"
                    "row1: c0 startled jump (ears up, slightly airborne); c1 falling crouched with paws spread, NOT a ball; c2 seated dizzy A with swirl eyes; c3 seated dizzy B with swirl eyes, no stars.\n"
                    "Match the base raccoon-scuffle poses and the unimpressed expression treatment."),
    },
    'panda': {
        'main': ("r0 idle: ear flick / front paw tap / sniff with blink / settle.\n"
                 "r1 curl: standing / crouch / rounding up / COMPLETE BALL (identical to r2c0).\n"
                 "r2 ball: plain complete ball / landing squash visibly wider than tall / ball with brown mud splotches / dizzy ball with spiral eyes. The four balls visibly differ.\n"
                 "r3 uncurl: COMPLETE BALL / half open / waving A / waving B.\n"
                 "r4 faceplant: wall-hit nose squashed facing right / airborne bounce / spread-eagle belly faceplant (above view allowed) / flattened facing right with circling stars."),
        'sleep': "side-lying asleep eyes closed / sleeping breath inflated slightly / awakening eyes open / spring up sitting upright. Copy base panda-sleep poses exactly.",
        'scuffle': ("r0 pushing: leaning forward / one step while pushing / pushing hard eyes scrunched / recoil after being pushed.\n"
                    "r1: startled eyes wide ears up slightly airborne / falling tucked body with splayed feet (NOT a ball) / seated dizzy A / seated dizzy B.\n"
                    "Copy base panda-scuffle proportions, limbs, expressions and gestures; right-facing side profile in ALL 8 cells."),
    },
    'ribbonpig': {
        'main': ("row0 idle: ear twitch, front-hoof tap, snout sniff/blink, settled idle. All right-facing side profile.\n"
                 "row1 curl: standing, crouch, rounding, COMPLETE BALL. r1c3 identical to r2c0.\n"
                 "row2 ball: plain round ball, wider flattened landing squash, round ball with brown mud patches, round ball with spiral dizzy eyes. All four clearly distinct and ROUND (a circle, not an oval), with the tiny curly-tail bump.\n"
                 "row3 uncurl: complete ball, half opened, waving hoof A, waving hoof B. Preserve reference poses.\n"
                 "row4 faceplant: nose compressed on impact, airborne bounce, splayed faceplant viewed from above, dizzy with orbiting stars."),
        'sleep': "c0 side-lying asleep eyes closed; c1 sleeping breath slightly inflated; c2 awakening eyes open; c3 sits up. Copy the base pig-sleep poses exactly.",
        'scuffle': ("row0 push: leaning forward / one step while pushing / pushing hard eyes scrunched / recoil after being pushed.\n"
                    "row1: startled jump slightly airborne / falling tucked with splayed hooves (NOT a ball) / seated dizzy A / seated dizzy B.\n"
                    "Copy the base pig-scuffle poses; right-facing side profile."),
    },
}
GRID = {'main': (4, 5), 'sleep': (4, 1), 'scuffle': (4, 2)}


def prompt(sheet, creature, kind, costume, ballnote):
    cols, rows = GRID[kind]
    ref = creature + ('' if kind == 'main' else '-' + kind) + '.png'
    return f"""# {sheet} {kind}

EDIT the reference sprite sheet `ref/{ref}` (use it as the input image of the image tool) into the shop skin `{sheet}`.
Preserve EXACTLY the base's chibi pixel-art style, chunky dark outline, palette, lighting, face, expressions, body proportions and each cell's pose. Same {cols} columns x {rows} rows layout, one pose per cell, in the same order as the reference.
The change: {costume}
The costume must be visible in EVERY cell. {ballnote if kind == 'main' else ''}
All cells face RIGHT in side profile (as the base; main r4c2 faceplant may be seen from above). Do not add water, splashes, scenery, text or a second character. Keep the personality of the base.

Frame order:
{ROWS[creature][kind]}

BACKDROP: a transparent background is fine (preferred), or one flat mid-green #6EBE64. Never draw green on the character. No border, drawn grid, labels or watermark.
Exact equal cells: {cols} columns x {rows} rows, each complete frame fully inside its cell with padding, no bleed into neighbour cells. Large PNG.
"""


def main():
    if len(sys.argv) < 5: sys.exit(__doc__)
    creature, skin, costume, ballnote = sys.argv[1:5]
    date = sys.argv[5] if len(sys.argv) > 5 else datetime.date.today().isoformat()
    if creature not in TEMPLATE: sys.exit(f'no template for {creature} — add TEMPLATE/ROWS entries')
    sheet = f'{creature}-{skin}'
    tbatch, tname, tjs = TEMPLATE[creature]
    src, dst = OUT / tbatch, OUT / f'marble-run-skin-{sheet}-{date}'
    if dst.exists(): sys.exit(f'exists: {dst}')
    for d in ('source', 'generated', 'qa', 'contracts', 'tools', 'prompts', 'ref', 'final/creatures'): (dst / d).mkdir(parents=True)
    for k in ('', '-sleep', '-scuffle'):
        Image.open(CREATURES / f'{creature}{k}.webp').convert('RGBA').save(dst / 'ref' / f'{creature}{k}.png')
    # 템플릿 이름이 기본 동물 이름과 같으면(돼지 base 배치) 'ribbonpig-main' 같은 자산 id 만 바꿔야 한다 — 긴 것부터 치환
    def rename(text):
        for suf in ('-main', '-sleep', '-scuffle', '.png', '.contract'):
            text = text.replace(tname + suf, sheet + suf)
        return text if tname == creature else text.replace(tname, sheet)
    for c in (src / 'contracts').glob('*.json'):
        (dst / 'contracts' / rename(c.name)).write_text(rename(c.read_text()))
    # 안전 축소: 배율 기준 칸이 아닌 칸(꽈당 줄·몸싸움 공중 칸)은 소품(쇠스랑·충격선)이 넓으면 칸을 넘쳐 "body would clip" 으로 멈춘다 → 156×148 에 맞게만 줄인다(2026-09-30 저팔계·스노클 판다)
    js = rename((src / 'tools' / tjs).read_text())
    assert js.count('const appliedScale=s;') == 1, 'template tool changed — safety-shrink anchor missing'
    js = js.replace('const appliedScale=s;', "const appliedScale=reference.includes(r+','+c)?s:Math.min(s,156/extent.width,148/extent.height);")
    (dst / 'tools' / 'creatures_skin_png.js').write_text(js)
    for kind in ('main', 'sleep', 'scuffle'):
        (dst / 'prompts' / f'{sheet}-{kind}.md').write_text(prompt(sheet, creature, kind, costume, ballnote))
    (dst / 'CODEX-BRIEF.md').write_text(f"""You are generating raw sprite sheets for SpriteMake batch `{dst.name}` (cwd = {dst}).
Your job is ONLY to DRAW with the built-in image generation tool. Do NOT write any scripts, do NOT crop/repack/resize/edit pixels, do NOT touch any other folder.

For each of the three prompts in `prompts/` ({sheet}-main.md, {sheet}-sleep.md, {sheet}-scuffle.md):
1. Generate the sheet with the image tool, passing the reference image named in the prompt (`ref/...png`) as the input image to edit, and the prompt text.
2. Save the raw result as `source/{sheet}-<kind>-attempt-01-unverified.png` (kind = main / sleep / scuffle).
3. Look at it. A TRANSPARENT background is GOOD (it may look black in some viewers) and slight backdrop tone variation is fine — never retry for the background.
   Regenerate (attempt-02, max 2 per sheet) ONLY for hard failures: wrong number of rows/columns, a cell missing or with two poses, frames bleeding across cells, characters facing LEFT, costume missing in several cells, text/labels/grid lines drawn.
4. Write `source/SOURCES.json` mapping exactly these keys to the chosen attempt paths:
   {{"{sheet}-main": "source/...", "{sheet}-sleep": "source/...", "{sheet}-scuffle": "source/..."}}
5. Write `REPORT.md`: per sheet, attempts made, which chosen, one line of observations per attempt.
""")
    print(dst)
    print(f"run: ( {CODEX} exec -C {dst} -s workspace-write -c 'approval_policy=\"never\"' --enable image_generation --skip-git-repo-check -o {dst}/codex-last.md - < {dst}/CODEX-BRIEF.md > {dst}/codex.log 2>&1 )   # 샌드박스 해제 필요")


main()
