#!/usr/bin/env python3
"""
UI/UX 하네스 체크 — Edit/Write PostToolUse 훅
HTML/CSS/js/shared 편집 시 자동으로 실행:
  1. 색 토큰 검사 (docs/GameGuide/02-shared-systems/THEME-DARK.md §5-1)
     이번 편집으로 새로 들어간 줄만 본다 — 원래 있던 줄은 다시 알리지 않는다.
     - 색 리터럴(#hex·rgb()·white/black) → 라이트 값이 같은 theme.css 토큰을 알려 준다
     - 게임 CSS :root 의 리터럴 색 토큰, var(--x, 예비값), 정의 안 된 토큰
  2. AdSense 스니펫 누락 체크 (admin.html 제외)
경고는 additionalContext 로 낸다 — PostToolUse 의 평문 stdout 은 에이전트에게 안 보인다.
"""
import json, sys, re, os, io, glob, subprocess
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

MAX_ISSUES = 10
NEAR_DIST = 40   # 같은 값 토큰이 없을 때 "가까운 값"으로 보여 줄 RGB 거리 한도
GROUPS = ['shop', 'dice', 'roulette', 'horse', 'ladder', 'deguri']  # horse-shop 은 shop 이 먼저 잡힌다

# 검사 제외 경로 — 토큰 정의 파일, 미사용 게임(다리건너기·해적·회전칼날), 별도 앱·목업·문서·테스트
SKIP_PATH = re.compile(r'^css/theme\.css$|bridge-cross|pirate|spin-arena|^(horse-app|mockups|AutoTest|docs|assets|\.claude)/|node_modules/|/prototype/')
# 한 줄 예외 (§5-1) — 캔버스 그리기, CSS mask, 콘솔 스타일, theme-color 메타
SKIP_LINE = re.compile(r'fillStyle|strokeStyle|shadowColor|addColorStop|\bctx\.|mask|console\.|theme-color')
DEAD_TOKEN = re.compile(r'^--(bridge|pirate|spin-arena)')

HEX_RE = re.compile(r'(?<![&\w])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])')
RGB_RE = re.compile(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(,[^)]*)?\)|(?:rgba?|hsla?)\(\s*\d')
NAMED_RE = re.compile(
    r'(?<![\w-])(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?'
    r'|fill|stroke|box-shadow|text-shadow|caret-color|accent-color)\s*:\s*[^;{}]*?(?<![\w-])(white|black)(?![\w-])'
    r'|\.style\.\w+\s*=\s*[\'"`](white|black)[\'"`]')
ALPHA_CAT_RE = re.compile(r'\$\{[^}]+\}[0-9a-fA-F]{2}(?!\w)')
VAR_RE = re.compile(r'var\(\s*(--[\w-]+)(?![\w$-])\s*(,)?')
DEF_RE = re.compile(r'(--[\w-]+)\s*:|[\'"](--[\w-]+)[\'"]\s*[:,]')
TOKEN_DEF_LINE = re.compile(r'^(--[\w-]+)\s*:\s*([^;]*)')

WHITE_HINT = '흰색 → 카드 면 var(--bg-white), 색 바탕 위 흰 글자 var(--text-on-accent)'
BLACK_HINT = '검정 → 그림자 rgba(var(--shadow-rgb), a), 글자 var(--text-primary)'


def read(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            return f.read()
    except Exception:
        return ''


def norm_hex(h):
    h = h.lower()
    return ''.join(c * 2 for c in h) if len(h) in (3, 4) else h


def load_theme():
    """theme.css → (어디서든 정의된 토큰 이름, :root 라이트 토큰 {이름: (값, 그룹)})"""
    text = read(os.path.join(ROOT, 'css', 'theme.css'))
    light, group = {}, None
    m = re.search(r':root\s*\{', text)
    for line in (text[m.end():text.find('\n}', m.end())] if m else '').split('\n'):
        if '[/tokens:' in line:
            group = None
        g = re.search(r'\[tokens:(\w+):light\]', line)
        if g:
            group = g.group(1)
        d = TOKEN_DEF_LINE.match(line.strip())
        if d:
            light[d.group(1)] = (d.group(2).strip(), group)
    return {a or b for a, b in DEF_RE.findall(text)}, light


def build_index():
    """라이트 값 → 토큰 이름 (별칭 var() 은 끝까지 따라가서 값으로)"""
    def resolve(v, depth=0):
        a = re.fullmatch(r'var\((--[\w-]+)\)', v)
        return resolve(LIGHT.get(a.group(1), ('',))[0], depth + 1) if a and depth < 6 else v
    hexes, rgbs = {}, {}
    for name, (val, _) in LIGHT.items():
        if DEAD_TOKEN.match(name):
            continue
        v = resolve(val)
        if re.fullmatch(r'#[0-9a-fA-F]{3,8}', v):
            hexes.setdefault(norm_hex(v[1:]), []).append(name)
        t = re.fullmatch(r'(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', v)
        if t:
            rgbs.setdefault(tuple(map(int, t.groups())), []).append(name)
    return hexes, rgbs


def group_rank(n):
    return {GRP: 0, None: 1, 'common': 2}.get(LIGHT[n][1], 3)


def ranked(names):
    """이 파일의 그룹 → 기본 팔레트 → common(모듈 전용 이름) → 다른 그룹 순으로 3개"""
    return sorted(names, key=group_rank)[:3]


def new_token():
    return f'theme.css [tokens:{GRP}:light]·[tokens:{GRP}:dark] 에 새 토큰'


def hex_hint(h):
    if len(h) == 8:
        names = RGBS.get(tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)))
        return f'투명도 붙은 hex → rgba(var({ranked(names)[0]}), a)' if names else \
            '투명도 붙은 hex → --<이름>-rgb 토큰 + rgba(var(--<이름>-rgb), a)'
    if h == 'ffffff':
        return WHITE_HINT
    if h == '000000':
        return BLACK_HINT
    if h in HEXES:
        names = ranked(HEXES[h])
        note = '다른 게임 토큰 — 같이 쓰려면 common 에 하나로' if group_rank(names[0]) == 3 else '라이트 값 같음'
        return ' · '.join(f'var({n})' for n in names) + f' ({note})'
    rgb = [int(h[i:i + 2], 16) for i in (0, 2, 4)]
    near = min(((sum((a - int(k[i * 2:i * 2 + 2], 16)) ** 2 for i, a in enumerate(rgb)) ** 0.5, k)
                for k in HEXES if len(k) == 6), default=None)
    if near and near[0] <= NEAR_DIST:
        return f'같은 값 토큰 없음 — 가까운 값 var({ranked(HEXES[near[1]])[0]}) #{near[1]}, 아니면 {new_token()}'
    return f'같은 값 토큰 없음 — {new_token()}'


def rgb_hint(m):
    if not m.group(1):
        return '토큰으로 (hsl()·공백 문법은 대체 토큰 안내 없음)'
    rgb = tuple(int(x) for x in m.group(1, 2, 3))
    if rgb in RGBS:
        return f'rgba(var({ranked(RGBS[rgb])[0]}), a)'
    if not m.group(4):
        return hex_hint('%02x%02x%02x' % rgb)
    return '--<이름>-rgb: r, g, b 토큰 + rgba(var(--<이름>-rgb), a)'


def is_defined(name):
    global ALL_DEFS
    if name in THEME_DEFS or name in FILE_DEFS:
        return True
    if ALL_DEFS is None:  # 드물게만 필요 — 그때 한 번 전체를 훑는다
        ALL_DEFS = set()
        for pat in ('css/*.css', '*.html', 'pages/*.html', 'js/**/*.js'):
            for p in glob.glob(os.path.join(ROOT, pat), recursive=True):
                ALL_DEFS |= {a or b for a, b in DEF_RE.findall(read(p))}
    return name in ALL_DEFS


def strip_comments(text):
    """/* */·<!-- --> 주석을 공백으로 (줄 수는 그대로)"""
    return re.sub(r'/\*.*?\*/|<!--.*?-->', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text, flags=re.S)


def block_of(n):
    """n번째 줄(1부터)을 감싼 블록의 선택자"""
    stack = []
    for line in CODE_LINES[:n - 1]:
        parts = re.split(r'([{}])', line)
        for i, part in enumerate(parts):
            if part == '{':
                stack.append(parts[i - 1])
            elif part == '}' and stack:
                stack.pop()
    return stack[-1] if stack else ''


def added_lines():
    """이번 편집으로 새로 들어간 줄 번호(1부터)"""
    if TOOL == 'Edit':
        new = (TOOL_INPUT.get('new_string') or '').replace('\r\n', '\n')
        old = set((TOOL_INPUT.get('old_string') or '').replace('\r\n', '\n').split('\n'))
        at = CONTENT.find(new) if new else -1
        if at < 0:
            return set()
        start = CONTENT.count('\n', 0, at)
        return {start + i + 1 for i, l in enumerate(new.split('\n')) if l not in old}
    # Write — git HEAD 에 없던 줄 (새 파일이면 전부)
    try:
        r = subprocess.run(['git', 'show', f'HEAD:{REL}'], cwd=ROOT, capture_output=True, timeout=3)
        prev = set(r.stdout.decode('utf-8', 'replace').replace('\r\n', '\n').split('\n')) if r.returncode == 0 else set()
    except Exception:
        prev = set()
    return {i + 1 for i, l in enumerate(LINES) if l not in prev}


def has_dark_pair(name):
    """theme.css 에 있거나, 이 파일의 다크 블록에 같은 이름이 정의돼 있는가"""
    if name in THEME_DEFS:
        return True
    pat = re.compile(re.escape(name) + r'\s*:')
    return any(pat.search(l) and 'dark' in block_of(i + 1) for i, l in enumerate(CODE_LINES))


def check_line(n):
    """(리터럴 색인가, 알림 문구) 목록"""
    s = CODE_LINES[n - 1].strip()
    if not s or s.startswith('//') or SKIP_LINE.search(s):
        return []
    d = TOKEN_DEF_LINE.match(s)
    if d and (HEX_RE.search(d.group(2)) or RGB_RE.search(d.group(2))):
        blk = block_of(n)
        if 'dark' in blk or 'data-skin' in blk:
            return []  # 다크 짝 값
        if ':root' in blk:
            name = d.group(1)
            if name in LIGHT:
                return [(True, f'{name} — theme.css 토큰을 리터럴로 다시 정의하면 다크 값까지 덮는다 → var() 별칭만')]
            if has_dark_pair(name):
                return []
            msg = f'{name} — 다크 값 없음: UI 색이면 {new_token()}(라이트·다크 둘 다), 그림·늘 고정 색이면 그대로'
            hx = HEX_RE.search(d.group(2))
            if hx and norm_hex(hx.group(1)) in HEXES:
                msg += f', 같은 값 토큰이면 별칭 var({ranked(HEXES[norm_hex(hx.group(1))])[0]})'
            return [(True, msg)]
    text = re.sub(r'href\s*=\s*(["\']).*?\1|url\([^)]*\)', '', s)
    if REL.endswith('.css') and '{' in text:
        text = text.split('{', 1)[1]  # 선택자(#id)는 색이 아니다
    lit = re.sub(r'var\(\s*--[\w-]+\s*,[^)]*\)?', '', text)  # 예비값 안 색은 아래 예비값 규칙이 한 번만 알린다
    out = [(True, f'#{m.group(1)} → {hex_hint(norm_hex(m.group(1)))}') for m in HEX_RE.finditer(lit)]
    out += [(True, f'{m.group(0)} → {rgb_hint(m)}') for m in RGB_RE.finditer(lit)]
    for m in NAMED_RE.finditer(lit):
        word = m.group(1) or m.group(2)
        out.append((True, f'{word} → {WHITE_HINT if word == "white" else BLACK_HINT}'))
    if ALPHA_CAT_RE.search(lit):
        out.append((True, 'hex 뒤 투명도 붙이기(${color}15) 금지 → rgba(var(--<이름>-rgb), a)'))
    for m in VAR_RE.finditer(text):
        name = m.group(1)
        if name.endswith('-'):
            continue  # 'var(--x-' + i + ')' 같은 동적 이름
        if m.group(2):
            fb = text[m.end():].split(')', 1)[0]
            if name in LIGHT or HEX_RE.search(fb) or RGB_RE.search(fb + ')') or re.search(r'\b(white|black)\b', fb):
                out.append((False, f'var({name}, {fb.strip()}) 예비값 금지 → var({name})'))
        if not is_defined(name):
            out.append((False, f'{name} — 정의 안 된 토큰'))
    return out


try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

TOOL = data.get('tool_name', '')
TOOL_INPUT = data.get('tool_input', {}) or {}
file_path = (TOOL_INPUT.get('file_path') or '').replace('\\', '/')
ext = os.path.splitext(file_path)[1].lower()
if ext not in ('.html', '.css', '.js') or not os.path.isfile(file_path):
    sys.exit(0)

# 파일이 속한 저장소(worktree 포함) 기준 — 이 프로젝트가 아니면 건너뛴다
try:
    ROOT = subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=os.path.dirname(os.path.abspath(file_path)),
                          capture_output=True, text=True, timeout=3).stdout.strip()
except Exception:
    sys.exit(0)
if not ROOT or not os.path.isfile(os.path.join(ROOT, 'css', 'theme.css')):
    sys.exit(0)
REL = os.path.relpath(os.path.realpath(file_path), os.path.realpath(ROOT)).replace('\\', '/')
if REL.startswith('..') or SKIP_PATH.search(REL) or (ext == '.js' and not REL.startswith('js/shared/')):
    sys.exit(0)

CONTENT = read(file_path)
LINES = CONTENT.split('\n')
CODE_LINES = strip_comments(CONTENT).split('\n')
name = os.path.basename(REL)
GRP = next((g for g in GROUPS if g in name), 'pages' if ext == '.html' else 'common')
THEME_DEFS, LIGHT = load_theme()
HEXES, RGBS = build_index()
FILE_DEFS = {a or b for a, b in DEF_RE.findall(CONTENT)}
ALL_DEFS = None

issues = [(n, lit, msg) for n in sorted(added_lines()) if n <= len(LINES) for lit, msg in check_line(n)]

out = []
if issues:
    out.append(f'[색 토큰 검사] {REL} — 새로 넣은 줄에서 {len(issues)}건 (규칙: docs/GameGuide/02-shared-systems/THEME-DARK.md §5-1)')
    out += [f'  L{n}: {msg}' for n, _, msg in issues[:MAX_ISSUES]]
    if len(issues) > MAX_ISSUES:
        out.append(f'  ... 외 {len(issues) - MAX_ISSUES}건 더')
    if any(lit for _, lit, _ in issues):
        out.append('  게임 그림·연출 색(캔버스·트랙·룰렛 칸 팔레트 등 §5-1 예외)이면 그대로 둔다.')

if ext == '.html' and name != 'admin.html' and 'pagead2.googlesyndication.com' not in CONTENT:
    out.append(f'[UI체크] {REL} — AdSense 스니펫 없음, <head>에 추가 필요')

if out:
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PostToolUse', 'additionalContext': '\n'.join(out)}},
                     ensure_ascii=False))
