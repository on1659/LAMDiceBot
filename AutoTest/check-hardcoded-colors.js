#!/usr/bin/env node
/**
 * 하드코딩 색 검사 — 서밋(커밋) 전에 돌린다. 규칙: docs/GameGuide/02-shared-systems/THEME-DARK.md 5-1절
 *
 * 화면 UI 색은 전부 css/theme.css 토큰이어야 한다. 이 스크립트는 HTML·CSS·JS 에서 색 리터럴
 * (#hex, rgb()/rgba()/hsl() 숫자, white/black 같은 이름 색)을 찾아, 기준선(허용 목록)에 없는 **새 것만** 보고한다.
 *
 *   node AutoTest/check-hardcoded-colors.js                 새 하드코딩 검사 (있으면 exit 1)
 *   node AutoTest/check-hardcoded-colors.js --list          기준선 포함 전체 목록
 *   node AutoTest/check-hardcoded-colors.js --update-baseline
 *        기준선 다시 쓰기 — 새로 생긴 리터럴이 **게임 그림·연출**(캔버스·스프라이트·이펙트)이라 예외로 남길 때만.
 *        UI 색이면 기준선에 넣지 말고 theme.css 토큰으로 바꿀 것.
 *
 * 세지 않는 것: css/theme.css (토큰 정의 자리), 주석, var(--x) 안쪽, transparent/currentColor/inherit,
 *              미사용 게임(다리건너기·해적·회전칼날)·mockups/·docs/·AutoTest/·node_modules/·horse-app/·game-lab/
 *              홈 프로토타입(home.html·css/home.css·js/home.js — 시험 화면이라 검사 제외, 사용자 2026-10-08)
 * 기준선: AutoTest/hardcoded-colors-baseline.json — 파일별 (줄 내용, 리터럴) 개수. 줄 번호가 아니라 내용으로 맞추므로
 *        다른 줄을 고쳐 줄이 밀려도 오탐이 안 난다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'hardcoded-colors-baseline.json');
const DEAD = /(bridge-cross|pirate|spin-arena|spin-shop)/;
const PROTO = /^home\.(html|css|js)$/;   // 홈 프로토타입 — 검사 제외

function listFiles() {
    const out = [];
    const add = (dir, re) => {
        const abs = path.join(ROOT, dir);
        if (!fs.existsSync(abs)) return;
        for (const f of fs.readdirSync(abs)) {
            const rel = path.posix.join(dir, f).replace(/^\.\//, '');
            if (re.test(f) && !DEAD.test(f) && !PROTO.test(f)) out.push(rel);
        }
    };
    add('.', /\.html$/);
    add('pages', /\.html$/);
    add('css', /\.css$/);
    add('js', /\.js$/);
    add('js/shared', /\.js$/);
    return out.filter(f => f !== 'css/theme.css').sort();
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d[^)]*\)|hsla?\(\s*\d[^)]*\)|(?<![-\w.$'"])(?:white|black|red|green|blue|yellow|orange|purple|gray|grey|gold|pink|cyan|magenta|lime|navy|silver|crimson|tomato|orchid|brown)(?![-\w])/g;
const NAMED_CONTEXT = /(color|background|border|fill|stroke|shadow|outline)\s*[:=]/i;
const HTML_ENTITY = /&#x?[0-9a-fA-F]+;/g;

function stripComments(src, file) {
    let s = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    if (file.endsWith('.html')) s = s.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
    // // 주석 (URL 의 // 는 앞이 : 라 제외)
    s = s.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
    return s;
}

function scan(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const lines = stripComments(src, file).split('\n');
    const hits = [];
    lines.forEach((raw, i) => {
        let line = raw.replace(HTML_ENTITY, ' ');
        // var(--x) / var(--x, 예비값) 안쪽은 토큰 참조 — 예비값 리터럴도 세지 않음(예비값 자체는 THEME-DARK 5-1 에서 금지하지만 별도 이슈)
        let prev;
        do { prev = line; line = line.replace(/var\(--[\w-]+(?:\s*,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g, 'VAR'); } while (line !== prev);
        // <meta name="theme-color"> 는 브라우저 UI 색이라 제외
        if (/name=["']theme-color["']/.test(line)) return;
        for (const m of line.matchAll(COLOR)) {
            const lit = m[0];
            if (/^[a-z]+$/i.test(lit) && !NAMED_CONTEXT.test(line)) continue;  // 이름 색은 색 속성 문맥일 때만
            hits.push({ line: i + 1, text: raw.trim().replace(/\s+/g, ' ').slice(0, 220), lit: lit.replace(/\s+/g, '') });
        }
    });
    return hits;
}

function keyOf(h) { return h.text + '\u0000' + h.lit; }

function main() {
    const args = process.argv.slice(2);
    const files = listFiles();
    const all = {};
    for (const f of files) all[f] = scan(f);

    if (args.includes('--update-baseline')) {
        const base = {};
        for (const f of files) {
            if (!all[f].length) continue;
            base[f] = {};
            for (const h of all[f]) base[f][keyOf(h)] = (base[f][keyOf(h)] || 0) + 1;
        }
        fs.writeFileSync(BASELINE, JSON.stringify(base, null, 1) + '\n');
        const n = Object.values(base).reduce((a, o) => a + Object.values(o).reduce((x, y) => x + y, 0), 0);
        console.log(`기준선 갱신: ${Object.keys(base).length}개 파일, ${n}개 리터럴 → ${path.relative(ROOT, BASELINE)}`);
        return;
    }

    const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
    const fresh = [];
    let total = 0;
    for (const f of files) {
        const budget = Object.assign({}, base[f] || {});
        for (const h of all[f]) {
            total++;
            const k = keyOf(h);
            if (budget[k] > 0) { budget[k]--; if (args.includes('--list')) console.log(`  (기준선) ${f}:${h.line}  ${h.lit}`); continue; }
            fresh.push({ file: f, ...h });
        }
    }

    if (!fresh.length) {
        console.log(`✅ 새 하드코딩 색 없음 (검사 ${files.length}개 파일, 기준선 예외 ${total}개 — 게임 그림·디버그 로그 등)`);
        return;
    }
    console.log(`❌ 새 하드코딩 색 ${fresh.length}개 — css/theme.css 토큰으로 바꿀 것 (규칙: docs/GameGuide/02-shared-systems/THEME-DARK.md 5-1절)\n`);
    for (const h of fresh) console.log(`  ${h.file}:${h.line}  ${h.lit}\n      ${h.text}`);
    console.log('\n게임 그림·연출(캔버스·스프라이트·이펙트)이라 예외로 남길 때만: node AutoTest/check-hardcoded-colors.js --update-baseline');
    process.exitCode = 1;
}

main();
