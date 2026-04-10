#!/usr/bin/env python3
"""
UI/UX 하네스 체크 — Edit/Write PostToolUse 훅
HTML/CSS 파일 편집 시 자동으로 실행:
  1. 하드코딩 hex 색상 감지 (CSS 변수 사용 권장)
  2. AdSense 스니펫 누락 체크 (admin.html 제외)
"""
import json, sys, re, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool_input = data.get('tool_input', {})
file_path = tool_input.get('file_path', '')

if not file_path:
    sys.exit(0)

# Windows 경로 정규화
file_path = file_path.replace('\\', '/')
ext = os.path.splitext(file_path)[1].lower()

if ext not in ['.html', '.css']:
    sys.exit(0)

if not os.path.exists(file_path):
    sys.exit(0)

try:
    with open(file_path, encoding='utf-8') as f:
        lines = f.readlines()
    content = ''.join(lines)
except Exception:
    sys.exit(0)

issues = []
in_root = False

for i, line in enumerate(lines, 1):
    stripped = line.strip()

    # :root 블록 추적 (CSS 변수 정의 영역은 skip)
    if re.search(r':root\s*\{', stripped):
        in_root = True
    if in_root:
        if '}' in stripped and ':root' not in stripped:
            in_root = False
        continue

    # CSS 변수 선언 라인 skip
    if stripped.startswith('--'):
        continue

    # 주석 라인 skip
    if stripped.startswith('//') or stripped.startswith('*') or stripped.startswith('/*'):
        continue

    # 하드코딩 hex 색상 탐지 (#RGB, #RRGGBB)
    hex_matches = re.findall(r'(?<!["\w\-])#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?![0-9a-fA-F\w])', line)
    for m in hex_matches:
        issues.append(f'  L{i}: #{m} → var() 사용 권장')

# AdSense 체크 (HTML만, admin.html 제외)
if ext == '.html':
    fname = os.path.basename(file_path)
    # admin.html과 prototype/ 디렉토리는 AdSense 체크 skip
    if fname != 'admin.html' and '/prototype/' not in file_path and 'pagead2.googlesyndication.com' not in content:
        issues.append('  AdSense 스니펫 없음 — <head>에 추가 필요')

if issues:
    fname = os.path.basename(file_path)
    print(f'\n[UI체크] {fname} — {len(issues)}건')
    for issue in issues[:10]:
        print(issue)
    if len(issues) > 10:
        print(f'  ... 외 {len(issues)-10}건 더')
