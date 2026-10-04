#!/usr/bin/env python3
"""데구리 생성 스킨 배치 스캐폴드 — SpriteMake/output/deguri-skin-{creature}-{skin}-{date}/ 를 만든다.
계약(contracts/)·리팩 도구(tools/creatures_skin_png.js)는 같은 동물의 기존 스킨 배치에서 시트 이름만 바꿔 복사하고,
GPT(Codex exec)용 프롬프트 3장 + CODEX-BRIEF.md(생성만, 편집 금지)를 쓴다. 참조 그림은 게임 에셋 webp 를 PNG 로 풀어 ref/ 에.

usage:
  /opt/homebrew/bin/python3 AutoTest/spritemake/scaffold-skin-batch.py <creature> <skin> "<costume>" "<ball note>" [date] [--ref=<sheet>]
    costume  : 영문 — 기본 동물에 더해지는 의상/변신 설명 (모든 칸에서 보여야 함)
    ball note: 영문 — 공 칸에서 의상이 어떻게 보이는지 (공은 원형 유지, 돌출 ≤120)
    --ref    : 편집 원본 시트(기본 = <creature>). 이미 있는 스킨 위에 덧그릴 때(예 ribbonpig-red) — 게임 에셋에 있어야 함
  예) ... ribbonpig iron "a steel-grey riveted iron helmet-hood ..." "In ball cells the ball is plated in grey iron ..."
브리프는 main 을 먼저 그리고, sleep·scuffle 은 채택한 main 을 두 번째 입력 그림으로 넣어 의상을 똑같이 맞추게 한다
(2026-09-30 강철 돼지: 세 시트를 따로 그려 갑옷이 투구 두건 / 아르마딜로 판 / 어깨 견갑으로 제각각이었다).

새 동물을 쓰려면 TEMPLATE(그 동물의 기존 생성 스킨 배치)와 ROWS(시트별 칸 순서 문장)를 추가한다.
실행은 CODEX-BRIEF.md 첫 줄 주석 참고. 이후: 원본 직접 판정 → source/SOURCES.json → tools/creatures_skin_png.js repack·qa
→ final/creatures/ 복사 → verify-creature.py → pickup-skin.py (스킬 .claude/skills/deguri-skin/SKILL.md)."""
import datetime, shutil, sys
from pathlib import Path
from PIL import Image

OUT = Path('/Users/radar/Work/SpriteMake/output')
GAME = Path(__file__).resolve().parents[2]
CREATURES = GAME / 'assets' / 'deguri' / 'creatures'
CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'   # 2026-10-01 앱 업데이트로 Resources/codex → codex-cli/bin/codex

# creature → (템플릿 배치, 템플릿 시트 이름, 리팩 JS). 리팩 JS 는 동물별 칸 규칙(판다·돼지는 r3c0 도 공)이 들어 있어 같은 동물 것을 쓴다
TEMPLATE = {
    'raccoon': ('marble-run-skin-raccoon-ninja-2026-09-22', 'raccoon-ninja', 'creatures_ninja_png.js'),
    'panda': ('marble-run-skin-panda-red-2026-09-22', 'panda-red', 'creatures_redpanda_png.js'),
    'ribbonpig': ('marble-run-skin-ribbonpig-base-2026-09-22', 'ribbonpig', 'creatures_pigbase_png.js'),
    'pillbug': ('marble-run-skin-pillbug-rainbow-2026-09-22', 'pillbug-rainbow', 'creatures_rainbow_png.js'),
    'turtle': ('marble-run-skin-turtle-melon-2026-09-22', 'turtle-melon', 'creatures_melon_png.js'),   # r3c0 도 공
    # 아르마딜로는 생성 스킨 배치가 없다 — 칸 규칙이 같은 공벌레 것(r3c0 = 공 아님)을 쓴다. 거북이 도구는 r3c0 을 공으로 맞춰 버려서 못 쓴다
    'armadillo': ('marble-run-skin-pillbug-rainbow-2026-09-22', 'pillbug-rainbow', 'creatures_rainbow_png.js'),
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
    'pillbug': {
        'main': ("row0 idle: c0 antenna flick; c1 front-leg tap; c2 sniff/blink; c3 settle. All side-facing-right as in the base.\n"
                 "row1 curl: c0 standing; c1 crouching; c2 body rounding; c3 COMPLETE BALL, identical to r2c0.\n"
                 "row2 ball: c0 plain round ball; c1 landing squash, wider and flatter; c2 round ball with brown mud splotches; c3 round dizzy ball with @@ eyes. Four visibly distinct genuine BALLS, costume visible on each.\n"
                 "row3 uncurl: c0 curled up with the face showing; c1 half opened; c2 waving A; c3 waving B, matching base poses.\n"
                 "row4 faceplant: c0 wall impact, squashed face; c1 airborne bounce; c2 sprawled faceplant (overhead view allowed); c3 dazed with circling stars. Same body scale as the standing rows."),
        'sleep': "c0 sleeping on its side, eyes closed; c1 same pose with the belly slightly inflated; c2 waking, eyes open, antenna raised, no exclamation mark; c3 abruptly sat up. Copy the base pillbug-sleep poses exactly.",
        'scuffle': ("row0 push: c0 leaning forward; c1 stepping and pushing; c2 strongest shove with scrunched face; c3 pushed-back recoil.\n"
                    "row1: c0 startled, eyes wide, antennae up, slightly airborne; c1 falling, curled/crouched with legs spread, NOT a ball; c2 seated dizzy A; c3 seated dizzy B with swirl eyes, no stars.\n"
                    "Copy the base pillbug-scuffle poses; right-facing side profile."),
    },
    'turtle': {
        'main': ("r0 idle: neutral; forefoot tap; blink; settle with foreleg gesture.\n"
                 "r1 curl: standing; crouching head; rounding with head hidden; perfectly ROUND BALL.\n"
                 "r2 ball: round ball identical to r1c3; flattened wide landing-squash ball; round muddy ball; round dizzy ball with spiral eyes. All are complete round balls without protruding head or legs, costume visible on each.\n"
                 "r3 uncurl: round ball; half-open with the head emerging toward the right; standing waving A; standing waving B.\n"
                 "r4 faceplant: muzzle pressed against an invisible wall at RIGHT; rebound airborne, head toward RIGHT; sprawled faceplant (top-down allowed); dazed recovery, right-facing, with orbiting stars."),
        'sleep': "c0 side-lying asleep, eyes closed; c1 same with subtly inflated breathing belly; c2 awake, eyes wide; c3 rises to sit/stand. Every head faces RIGHT. Copy the base turtle-sleep poses exactly.",
        'scuffle': ("r0 push: leaning forward braced push; stepping push; strongest push with eyes squeezing; recoil from pushing.\n"
                    "r1: startled, forefeet lifted, slightly airborne; falling curled torso with legs splayed (NOT a ball); seated dizzy spiral eyes A; seated dizzy spiral eyes B. No stars.\n"
                    "Copy the base turtle-scuffle poses; every head points RIGHT in side profile."),
    },
    'armadillo': {
        'main': ("row0 idle: c0 standing; c1 one step with a front paw; c2 alert, head up with two small surprise ticks above the ears; c3 settle with a happy closed-eye smile.\n"
                 "row1 curl: c0 standing, head lowered; c1 crouching with the head tucking down; c2 nearly rolled up, face still peeking out at the lower right; c3 COMPLETE BALL, identical to r2c0.\n"
                 "row2 ball: c0 plain round ball; c1 landing squash, wider and flatter, with small impact ticks at both sides; c2 round ball with brown mud splotches; c3 round dizzy ball with @@ eyes and circling stars. Four visibly distinct genuine BALLS, costume visible on each.\n"
                 "row3 uncurl: c0 rolled up with the sleepy face showing at the lower right (NOT a plain ball); c1 half opened, face and paws out; c2 standing upright waving A; c3 standing upright waving B, eyes closed happily.\n"
                 "row4 faceplant: c0 flat on its belly, face squashed, impact ticks at both sides; c1 airborne bounce, tumbling with mouth open; c2 flat on its back, limbs up; c3 flat on its back with circling stars. Same body scale as the standing rows."),
        'sleep': "c0 lying curled on its belly asleep, eyes closed; c1 same pose, breathing; c2 same pose with one eye opening; c3 sat up on its hind legs, awake. Copy the base armadillo-sleep poses exactly.",
        'scuffle': ("row0 push: c0 leaning forward, frowning; c1 pushing with front paws; c2 strongest shove, low and stretched; c3 knocked back onto its rump, eyes shut.\n"
                    "row1: c0 startled, mouth open, paws up; c1 tumbling in the air on its back, limbs splayed, NOT a ball; c2 seated dizzy A with swirl eyes; c3 seated dizzy B with swirl eyes, no stars.\n"
                    "Copy the base armadillo-scuffle poses; right-facing side profile."),
    },
}
GRID = {'main': (4, 5), 'sleep': (4, 1), 'scuffle': (4, 2)}


def prompt(sheet, creature, base, kind, costume, ballnote):
    cols, rows = GRID[kind]
    ref = base + ('' if kind == 'main' else '-' + kind) + '.png'
    match = '' if kind == 'main' else (
        f"\nSECOND INPUT IMAGE: the `{sheet}` MAIN attempt you chose (source/{sheet}-main-attempt-NN-unverified.png). "
        "The costume in this sheet must be the SAME DESIGN as in that main sheet — same pieces, shapes, colors, patterns and proportions on the body. "
        "Do not reinvent or restyle the costume; only the pose changes.\n")
    return f"""# {sheet} {kind}

EDIT the reference sprite sheet `ref/{ref}` (use it as the FIRST input image of the image tool) into the shop skin `{sheet}`.
Preserve EXACTLY the base's chibi pixel-art style, chunky dark outline, palette, lighting, face, expressions, body proportions and each cell's pose. Same {cols} columns x {rows} rows layout, one pose per cell, in the same order as the reference.
The change: {costume}
The costume must be visible in EVERY cell. {ballnote if kind == 'main' else ''}{match}
All cells face RIGHT in side profile (as the base; main r4c2 faceplant may be seen from above). Do not add water, splashes, scenery, text or a second character. Keep the personality of the base.

Frame order:
{ROWS[creature][kind]}

BACKDROP: a transparent background is fine (preferred), or one flat mid-green #6EBE64. Never draw green on the character. No border, drawn grid, labels or watermark.
Exact equal cells: {cols} columns x {rows} rows, each complete frame fully inside its cell with padding, no bleed into neighbour cells. Large PNG.
"""


def main():
    opts = [a for a in sys.argv[1:] if a.startswith('--')]; args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 4: sys.exit(__doc__)
    creature, skin, costume, ballnote = args[:4]
    date = args[4] if len(args) > 4 else datetime.date.today().isoformat()
    base = next((o.split('=', 1)[1] for o in opts if o.startswith('--ref=')), creature)
    if creature not in TEMPLATE: sys.exit(f'no template for {creature} — add TEMPLATE/ROWS entries')
    sheet = f'{creature}-{skin}'
    tbatch, tname, tjs = TEMPLATE[creature]
    src, dst = OUT / tbatch, OUT / f'deguri-skin-{sheet}-{date}'
    if dst.exists(): sys.exit(f'exists: {dst}')
    for d in ('source', 'generated', 'qa', 'contracts', 'tools', 'prompts', 'ref', 'final/creatures'): (dst / d).mkdir(parents=True)
    for k in ('', '-sleep', '-scuffle'):
        Image.open(CREATURES / f'{base}{k}.webp').convert('RGBA').save(dst / 'ref' / f'{base}{k}.png')
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
        (dst / 'prompts' / f'{sheet}-{kind}.md').write_text(prompt(sheet, creature, base, kind, costume, ballnote))
    (dst / 'CODEX-BRIEF.md').write_text(f"""You are generating raw sprite sheets for SpriteMake batch `{dst.name}` (cwd = {dst}).
Your job is ONLY to DRAW with the built-in image generation tool. Do NOT write any scripts, do NOT crop/repack/resize/edit pixels, do NOT touch any other folder.

Do the three prompts in `prompts/` IN THIS ORDER: {sheet}-main.md first, then {sheet}-sleep.md and {sheet}-scuffle.md.
Finish and choose the main sheet before starting the others: sleep and scuffle must pass the chosen main sheet as a SECOND input image so the costume is identical across all three sheets.
For each prompt:
1. Generate the sheet with the image tool, passing the reference image named in the prompt (`ref/...png`) as the first input image to edit (plus the chosen main sheet as the second input for sleep/scuffle), and the prompt text.
2. Save the raw result as `source/{sheet}-<kind>-attempt-01-unverified.png` (kind = main / sleep / scuffle).
3. Look at it. A TRANSPARENT background is GOOD (it may look black in some viewers) and slight backdrop tone variation is fine — never retry for the background.
   Regenerate (attempt-02, max 2 per sheet) ONLY for hard failures: wrong number of rows/columns, a cell missing or with two poses, frames bleeding across cells, characters facing LEFT, costume missing in several cells, text/labels/grid lines drawn,
   or (sleep/scuffle) a costume visibly different from the main sheet's.
4. Write `source/SOURCES.json` mapping exactly these keys to the chosen attempt paths:
   {{"{sheet}-main": "source/...", "{sheet}-sleep": "source/...", "{sheet}-scuffle": "source/..."}}
5. Write `REPORT.md`: per sheet, attempts made, which chosen, one line of observations per attempt.
""")
    print(dst)
    print(f"run: ( {CODEX} exec -C {dst} -s workspace-write -c 'approval_policy=\"never\"' --enable image_generation --skip-git-repo-check -o {dst}/codex-last.md - < {dst}/CODEX-BRIEF.md > {dst}/codex.log 2>&1 )   # 샌드박스 해제 필요")


main()
