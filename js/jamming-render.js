// 재밍라이더(jamming) 렌더러 — (타임라인, 재생 시각) → 캔버스. 물리 없음, 브라우저 난수 함수 호출 0회(그림용 흔들림은 고정 시드 mulberry32). docs/goal/jamming-rider.md §4-1·§7
// 서버(socket/jamming-sim.js)가 보낸 frames(동물 x·높이·상태·효과 비트 + 움직이는 물체)를 보간하고, events 로 연출(먼지·충격선·알약·소식 줄)을 다시 짓는다.
// 그림은 목업 mockups/sunset-glide-v7.html 의 그리기 코드를 그대로 옮겼다(같은 색·같은 도형). 카메라·외곽선·느리게 보기는 전부 그림만 — 결과에 못 닿는다.
// 쓰는 쪽: js/jamming.js. 브라우저 전역 window.JammingRender
(function () {
    'use strict';
    var JW = window.JammingWorld, R = JW.R, clamp = JW.clamp, lerp = JW.lerp;
    var CLIFF = JW.CLIFF, LINE0 = JW.LINE0, LINE_GAP = JW.LINE_GAP, ISL0 = JW.ISL0, ZONE_R = JW.ZONE_R, ISL1 = JW.ISL1, TGT = JW.TGT, GA = JW.GA;
    var ITEMS = JW.ITEMS, STATES = JW.STATES, FX = JW.FX, OBJ = JW.OBJ;

    // ── 그림 전용 상수(목업 R 의 그림 몫) ──
    var V = {
        viewAlt: 790, seaY: 0.86, horizon: 0.6, anchorX: 0.7, camEase: 3, worldR: ISL1 + 220,   // 화면에 보이는 높이(위아래 고정) · 바다 줄 · 수평선 · 카메라 대상 자리(화면 가로 70% 고정, §10) · 코스 오른끝
        cutHold: 1.8, cutMax: 3, cutGap: 2.5, cutEase: 5, lastCam: 2,                         // 선두 카메라의 아이템 컷 · 꼴찌 룰에서 이만큼 남으면 꼴찌 카메라
        shoutDur: 0.9, shakePx: 5, shakeDur: 0.35, slowDur: 0.28, slowK: 0.35, slowRepay: 1.25,   // 큰 글자 · 흔들림 · 잠깐 느리게(보는 속도만 — 밀린 만큼 1.25배로 따라잡는다)
        otherAlpha: 0.6, meLine: 3, meBox: 300,                                               // 내 동물 돋보이기: 다른 동물 진하기 · 흰 외곽선 굵기 · 외곽선용 겹 크기
        prepAt: [0.1, 1.1], prepOpen: 0.45, prepLift: 0.4, countdown: 3,                      // 3·2·1 준비(그림만) — 카운트다운 마지막 3초
        trailN: 24, nameMax: 5,
        keepL: 0.14, keepR: 0.86                                                              // 카메라가 늦어도 대상을 이 가로 범위 안에 둔다
    };
    var DT = JW.DT, PXU = 1.3, CS = 50, FEET = 0.925, CELL = 160;
    var COUNTDOWN_MS = 4000;   // socket/jamming.js COUNTDOWN_MS 와 같은 값

    // ── 게임 그림 색(캔버스 전용 — 스킨과 무관, 목업 C 그대로). 해가 수평선에 걸린 저녁 바다
    var C = {
        sky: ['#1b1f4e', '#3a2d6c', '#7e4577', '#d4665e', '#f7ab5c'], sun: '#ffe28c', sunEdge: '#ffb45e', sunGlow: '255,190,115', star: '#fff6dc',
        seaTop: '#f0956a', seaMid: '#8a5480', seaLow: '#34406f', seaDeep: '#1a2648', wave: '255,222,190', glint: '#ffe6a8',
        cloudFar: '#8d5384', cloud: '#a85d82', cloudLit: '#ffae86', isleFar: '#4b3164', gull: '#ffe9dc',
        rock: '#5e3c55', rockLit: '#a2666c', rockDark: '#3c2640', grass: '#78924d', grassDark: '#556d3b',
        sand: '#f3c48f', sandDark: '#c88d6c', trunk: '#7a4b2a', palm: '#3e7a4c', palmDark: '#2b5937',
        mat: '#e0432b', matLight: '#fff3e0', tower: '#f6efe4', towerStripe: '#d8432b', lamp: '#fff1a8', beam: '255,236,160',
        storm: '#4c4569', stormDark: '#332e4c', stormLit: '#77699a', rain: 'rgba(170,180,230,.45)', bolt: '#fff6a8',
        line: 'rgba(40,24,48,.8)', water: '#8fd8ff', waterDark: '#2f8fd1', shield: '130,225,255', foam: '#ffffff',
        zone: 'rgba(255,255,255,.55)', shieldInk: '#7fe8ff', sweat: '#9fdcff', spot: '12,8,26', speed: 'rgba(255,255,255,.55)',
        wind: '205,245,255', windBig: '255,236,150', windCore: '#f2fdff', dirt: '#8a5a3a', dirtLit: '#b37a4e', dirtDark: '#5e3a26', therm: '255,214,170',
        confetti: ['#ff5a4f', '#ffd23a', '#7fd04a', '#3aa0ff', '#f15bb5', '#ffffff'],
        boost: '#ffad2e', boostHot: '#fff3a8', rocket: '#f2f2f2', halo: '255,214,90', halo2: '#ffd23a', ink: 'rgba(30,20,44,.9)', magnet: 'rgba(224,67,43,.7)', boom: '#ffb02e', tag: '#ffffff', tagInk: '#14110f', me: '#ffd54a', bar: 'rgba(20,16,32,.55)', warn: '#ff5a3c', dusk: '#2a2550'
    };
    var INK = [42, 26, 36];
    var DISPLAY = '"Jua", "Apple SD Gothic Neo", sans-serif', BODY = 'Pretendard, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    var COLORS = ['#ff5a4f', '#ff9f1c', '#e9c400', '#7fb800', '#2ec4b6', '#1982c4', '#4361ee', '#9b5de5', '#f15bb5', '#a0612a', '#6c757d', '#00a6c7', '#c1121f', '#40916c', '#7209b7'];   // 날개 색(socket/jamming.js JAMMING_COLORS = 15)
    var EVT = { rock: '바위에 쿵', eagle: '독수리에 콕', bolt: '번개에 찌릿', sea: '바다에 풍덩', over: '착지 못 하고 지나감', isle: '섬에 내려 쉬어 감' };
    var ITEM = { balloon: '물풍선', mine: '풍선 지뢰', shield: '방패', boost: '부스터', missile: '유도 미사일', ink: '먹물', magnet: '자석', zap1: '1등 번개', zapAll: '번개', angel: '무적', rocket: '로켓' };
    var ITEMCOL = { balloon: '#3aa0ff', mine: '#e0432b', shield: '#22b8a0', boost: '#ff7a1a', missile: '#e0432b', ink: '#5b3f8a', magnet: '#e0432b', zap1: '#f2b600', zapAll: '#f2b600', angel: '#f0a800', rocket: '#ff7a1a' };
    var CUTK = { missile: 1, balloon: 1, mine: 1, zap1: 1, zapAll: 1, ink: 1, magnet: 1, rocket: 1 };   // 선두 카메라가 넘어가 보여 줄 아이템

    function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    function shortName(n) { var c = Array.from(String(n || '')); return c.length > V.nameMax ? c.slice(0, V.nameMax).join('') + '…' : c.join(''); }

    // ── 에셋: 동물·독수리·물기둥은 데구리 그림 ──
    var A = '/assets/deguri/', VER = '?v=9';
    var CREATURES = ['hedgehog', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig', 'cat', 'penguin'];
    var PIECES = { eagle: 'pieces/eagle.webp', geyser: 'fx/geyser.webp', dust: 'fx/dust-puff.webp', star: 'fx/impact-star.webp', flag: 'pieces/flag.webp' };
    var images = {}, loadState = 0, loadWaiters = [], instances = [];
    function image(path) {
        var im = images[path];
        if (!im) {
            im = new Image(); im.src = A + path + VER; images[path] = im;
            im.addEventListener('load', function () { instances.forEach(function (r) { r.redrawIfIdle(); }); }, { once: true });
        }
        return im;
    }
    var ok = function (im) { return !!im && im.complete && im.naturalWidth > 0; };
    function sheetOf(creature, skin, kind) {   // kind = '' | '-walk' — 스킨 시트가 없거나 아직이면 기본 동물 것
        if (skin) { var sk = image('creatures/' + creature + '-' + skin + kind + '.webp'); if (ok(sk)) return sk; }
        return image('creatures/' + creature + kind + '.webp');
    }
    function loadAssets(cb) {
        if (loadState === 2) { if (cb) cb(); return; }
        if (cb) loadWaiters.push(cb);
        if (loadState === 1) return;
        loadState = 1;
        var list = [];
        CREATURES.forEach(function (c) { list.push('creatures/' + c + '.webp', 'creatures/' + c + '-walk.webp'); });
        Object.keys(PIECES).forEach(function (k) { list.push(PIECES[k]); });
        var left = list.length;
        var done = function () { if (--left > 0) return; loadState = 2; var w = loadWaiters; loadWaiters = []; w.forEach(function (f) { f(); }); };
        list.forEach(function (p) { var im = image(p); if (im.complete) done(); else { im.addEventListener('load', done, { once: true }); im.addEventListener('error', done, { once: true }); } });
    }
    var IMG = function (k) { return image(PIECES[k]); };

    // ── 도트 그림(목업 mkSprite) — 낮은 해상도로 그려 키운다 ──
    function mkSprite(w, h, draw, outline) {
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var g = c.getContext('2d'); draw(g);
        var im = g.getImageData(0, 0, w, h), d = im.data;
        for (var i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
        if (outline) {
            var on = function (x, y) { return x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] === 255; }, edge = [];
            for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) edge.push((y * w + x) * 4);
            edge.forEach(function (k) { d[k] = outline[0]; d[k + 1] = outline[1]; d[k + 2] = outline[2]; d[k + 3] = 255; });
        }
        g.putImageData(im, 0, 0); return c;
    }
    var poly = function (g, col, pts) { g.fillStyle = col; g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.fill(); };
    var chev = function (g, x, y, k) { poly(g, '#ff7a1a', [[x, y], [x + 4 * k, y], [x + 10 * k, y + 6 * k], [x + 4 * k, y + 12 * k], [x, y + 12 * k], [x + 6 * k, y + 6 * k]]); };
    var boltShape = function (g, col, x, y, k) { poly(g, col, [[x + 5 * k, y], [x + 1 * k, y + 8 * k], [x + 5 * k, y + 8 * k], [x + 2 * k, y + 15 * k], [x + 10 * k, y + 5 * k], [x + 6 * k, y + 5 * k], [x + 9 * k, y]]); };
    var bubble = function (g, ring) { g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.arc(13, 13, 12, 0, 7); g.fill(); g.fillStyle = ring; g.beginPath(); g.arc(13, 13, 10, 0, 7); g.fill(); };
    var HG = { w: 98, h: 49, hx: 60, hy: 26, up: 60 };   // 행글라이더 그림 크기 · 그림 안 매다는 점(용골 가운데) · 매다는 점 높이(발에서)
    var sailCache = {};
    function sail(col) {   // 행글라이더 날개: 비스듬히 본 넓은 세모(델타), 코에서 부채꼴로 뻗는 색 칸(참가자 색·흰색 번갈아), 가운데 용골
        return sailCache[col] || (sailCache[col] = mkSprite(HG.w, HG.h, function (g) {
            var N = [96, 28], F = [12, 1], E = [3, 47], M = [34, 24];
            var edge = function (k) { var a = 1 - k; return [a * a * F[0] + 2 * a * k * M[0] + k * k * E[0], a * a * F[1] + 2 * a * k * M[1] + k * k * E[1]]; };
            g.fillStyle = col; g.beginPath(); g.moveTo(N[0], N[1]); g.lineTo(F[0], F[1]); g.quadraticCurveTo(M[0], M[1], E[0], E[1]); g.closePath(); g.fill();
            g.globalCompositeOperation = 'source-atop';
            [[0.16, 0.3, 'rgba(255,255,255,.9)'], [0.62, 0.74, 'rgba(255,255,255,.9)'], [0.3, 0.5, 'rgba(255,255,255,.28)']].forEach(function (q) { poly(g, q[2], [N, edge(q[0]), edge(q[1])]); });
            poly(g, 'rgba(0,0,0,.16)', [N, edge(0.5), edge(1), E]);
            var K = edge(0.5); g.strokeStyle = 'rgba(42,26,36,.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(K[0], K[1]); g.lineTo(N[0], N[1]); g.stroke();
        }, INK));
    }
    var SP = null, ICON = null;
    function buildSprites() {
        if (SP) return;
        SP = {
            box: mkSprite(26, 26, function (g) {
                ['#ff5a4f', '#ffb02e', '#7fd04a', '#3aa0ff', '#9b5de5'].forEach(function (c, i) { g.strokeStyle = c; g.lineWidth = 2.5; g.beginPath(); g.arc(13, 13, 11, i * 1.2566, (i + 1) * 1.2566); g.stroke(); });
                g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(13, 13, 9, 0, 7); g.fill();
                g.fillStyle = '#ff7a1a'; g.font = '900 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 13, 14);
            }, INK),
            boost: mkSprite(26, 26, function (g) { bubble(g, '#ffe3b0'); chev(g, 5, 7, 1); chev(g, 12, 7, 1); }, INK),
            shot: mkSprite(12, 13, function (g) { g.fillStyle = '#3aa0ff'; g.beginPath(); g.ellipse(6, 6, 5, 5.5, 0, 0, 7); g.fill(); g.fillStyle = '#ffffff'; g.fillRect(3, 3, 2, 2); }, INK),
            missile: mkSprite(22, 9, function (g) { poly(g, '#e0432b', [[2, 2], [15, 2], [21, 4.5], [15, 7], [2, 7]]); g.fillStyle = '#ffffff'; g.fillRect(6, 2, 3, 5); poly(g, '#7a2a1a', [[0, 0], [5, 2], [5, 7], [0, 9]]); }, INK),
            mine: mkSprite(20, 26, function (g) {
                g.fillStyle = '#e0432b'; g.beginPath(); g.arc(10, 9, 7, 0, 7); g.fill(); g.fillStyle = '#3a2a1a'; [[10, 0], [19, 9], [10, 18], [1, 9], [4, 3], [16, 3], [4, 15], [16, 15]].forEach(function (q) { g.fillRect(q[0] - 1, q[1] - 1, 2, 2); });
                g.fillStyle = '#ffffff'; g.fillRect(7, 5, 2, 2); g.fillStyle = '#3a2a1a'; g.fillRect(10, 18, 1, 8);
            }, INK)
        };
        ICON = {
            balloon: mkSprite(16, 16, function (g) { g.fillStyle = '#3aa0ff'; g.beginPath(); g.ellipse(8, 7, 5, 6, 0, 0, 7); g.fill(); poly(g, '#3aa0ff', [[7, 12], [9, 12], [8, 15]]); g.fillStyle = '#fff'; g.fillRect(5, 4, 2, 2); }, INK),
            mine: mkSprite(16, 16, function (g) { g.fillStyle = '#e0432b'; g.beginPath(); g.arc(8, 8, 5, 0, 7); g.fill(); g.fillStyle = '#3a2a1a'; [[8, 1], [15, 8], [8, 15], [1, 8]].forEach(function (q) { g.fillRect(q[0] - 1, q[1] - 1, 2, 2); }); g.fillStyle = '#fff'; g.fillRect(6, 5, 2, 2); }, INK),
            shield: mkSprite(16, 16, function (g) { poly(g, '#22b8a0', [[2, 2], [14, 2], [14, 9], [8, 15], [2, 9]]); poly(g, '#7fe8d2', [[4, 4], [8, 4], [8, 12], [4, 8]]); }, INK),
            boost: mkSprite(16, 16, function (g) { chev(g, 1, 2, 1); chev(g, 7, 2, 1); }, INK),
            missile: mkSprite(16, 16, function (g) { poly(g, '#e0432b', [[1, 6], [10, 6], [15, 8], [10, 10], [1, 10]]); g.fillStyle = '#fff'; g.fillRect(4, 6, 2, 4); poly(g, '#7a2a1a', [[0, 4], [3, 6], [3, 10], [0, 12]]); }, INK),
            ink: mkSprite(16, 16, function (g) { g.fillStyle = '#2b1f3a'; g.beginPath(); g.ellipse(8, 7, 6, 5, 0, 0, 7); g.fill(); g.fillRect(4, 9, 2, 6); g.fillRect(9, 10, 2, 4); g.fillStyle = '#7a6a9a'; g.fillRect(5, 4, 2, 2); }, INK),
            magnet: mkSprite(16, 16, function (g) { g.strokeStyle = '#e0432b'; g.lineWidth = 4; g.beginPath(); g.arc(8, 7, 4.5, 0, Math.PI); g.stroke(); g.fillStyle = '#d8d8e0'; g.fillRect(1, 2, 5, 5); g.fillRect(10, 2, 5, 5); }, INK),
            zap1: mkSprite(16, 16, function (g) { poly(g, '#ffc400', [[3, 6], [3, 1], [6, 4], [8, 0], [10, 4], [13, 1], [13, 6]]); boltShape(g, '#ffe14d', 4, 6, 0.65); }, INK),
            zapAll: mkSprite(16, 16, function (g) { boltShape(g, '#ffe14d', 2, 0, 1); }, INK),
            angel: mkSprite(16, 16, function (g) { g.strokeStyle = '#ffd23a'; g.lineWidth = 2; g.beginPath(); g.ellipse(8, 4, 5, 2, 0, 0, 7); g.stroke(); poly(g, '#ffffff', [[8, 9], [1, 6], [3, 13]]); poly(g, '#ffffff', [[8, 9], [15, 6], [13, 13]]); }, INK),
            rocket: mkSprite(16, 16, function (g) { poly(g, '#ff9a2e', [[1, 15], [3, 9], [7, 13]]); poly(g, '#f2f2f2', [[4, 12], [11, 3], [15, 1], [13, 5], [5, 14]]); poly(g, '#e0432b', [[11, 3], [15, 1], [13, 5]]); }, INK)
        };
    }

    // 배경 자료(그림 전용 고정 시드): 구름 두 겹 · 먼 섬 · 갈매기 · 별
    var BG = (function () {
        var r = mulberry32(31), span = 2600;
        var clouds = [0.03, 0.09].map(function (par, L) { var a = []; for (var i = 0; i < 7; i++) a.push({ x: r() * span, y: (L ? 0.3 : 0.1) + r() * (L ? 0.32 : 0.22), w: 90 + r() * (L ? 200 : 140), par: par, L: L }); return a; });
        var isles = []; for (var i = 0; i < 6; i++) isles.push({ x: r() * span, w: 60 + r() * 160, h: 6 + r() * 16 });
        var gulls = []; for (var j = 0; j < 7; j++) gulls.push({ x: r() * span, y: 0.15 + r() * 0.35, ph: r() * 6, k: 0.7 + r() * 0.5 });
        var stars = []; for (var k = 0; k < 26; k++) stars.push({ x: r(), y: r() * 0.2, ph: r() * 6 });
        return { span: span, clouds: clouds[0].concat(clouds[1]), isles: isles, gulls: gulls, stars: stars };
    })();

    function create(canvas, opts) {
        buildSprites();
        var main = canvas.getContext('2d'), ctx = main;
        var box = canvas.parentElement;
        var W = 0, H = 0, dpr = 1, s = 1;
        var tl = null, me = '', mode = 'idle', idle = null;
        var players = [], rocks = [], storms = [], items = [], isles = [], therms = [], eagles = [], shots = [], mines = [], zaps = [], fx = [];
        var t = 0, clock = 0, phase = 'idle', countT = 0, endT = 0, picked = null, boxOpen = true, flashT = -9, decidedReal = 0;
        var camX = 0, followMe = true, follow = null, cut = null, cutEnd = -9, shout = { p: null, key: '', text: '', at: -9 }, shakeAt = -9, slowUntil = -9, lag = 0;
        var playing = false, paused = false, delay = 0, t0 = 0, pauseAt = 0, raf = 0, lastRender = 0, endLoop = false;
        var lastSim = -1, finaleFired = false, onFinaleCb = null, onEventCb = null, evIdx = 0;
        var feed = [], feedEl = null, rankEl = null, boardEl = null, hudAt = -1, feedDirty = false;

        // ── DOM: 소식 줄 · 내 순위 · 넓은 화면 순위 칸(캔버스 박스 안, 글자는 캔버스에 그리지 않는다) ──
        if (box && !(opts && opts.offscreen)) {
            feedEl = document.createElement('ul'); feedEl.className = 'jamming-feed'; feedEl.setAttribute('aria-live', 'polite'); box.appendChild(feedEl);
            rankEl = document.createElement('div'); rankEl.className = 'jamming-rank'; rankEl.hidden = true; box.appendChild(rankEl);
            boardEl = document.createElement('ol'); boardEl.className = 'jamming-board'; boardEl.hidden = true; box.appendChild(boardEl);
        }

        // ── 좌표: 화면 x = 따라가는 자리 + (x − camX)·s, 화면 y = 바다 줄 − a·s ──
        var SHX = 0, SHY = 0;
        var X = function (x) { return W * V.anchorX + (x - camX) * s + SHX; }, Y = function (a) { return H * V.seaY - a * s + SHY; };
        function place(x, a) { ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * X(x), dpr * Y(a)); }
        var scr = function () { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
        var inX = function (x, m) { return X(x) > -m && X(x) < W + m; };
        function resize() {
            var fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
            var fs = (!!fsEl && (fsEl === box || fsEl === canvas)) || (box && box.classList.contains('is-pseudo-fs'));
            var bw = box ? box.clientWidth : canvas.clientWidth;
            if (!bw) return;
            var vh = window.innerHeight || 700;
            var h = fs ? (box.clientHeight || vh) : Math.round(bw < 560 ? clamp(vh * 0.66, 380, 620) : clamp(bw * 0.58, 360, vh * 0.72));   // 폰은 세로로 넉넉히(높이 0~790 이 늘 다 보인다), PC 는 가로로 길게
            canvas.style.width = '100%'; canvas.style.height = h + 'px';
            dpr = Math.min(3, window.devicePixelRatio || 1); W = bw; H = h; s = H * V.seaY / V.viewAlt;
            canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
            if (boardEl) boardEl.hidden = !(mode === 'play' && W >= 640);
            updateCam(0, true); redraw();
        }
        function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
        function spr(c, x, y, ax, ay, k) { var w = c.width * PXU * (k || 1), h = c.height * PXU * (k || 1); ctx.imageSmoothingEnabled = false; ctx.drawImage(c, x - w * ax, y - h * ay, w, h); }
        function cell(p, row, col) { var im = sheetOf(p.animal, p.skin, ''); if (!ok(im)) return; ctx.imageSmoothingEnabled = true; ctx.drawImage(im, col * CELL, row * CELL, CELL, CELL, -CS / 2, -CS * FEET, CS, CS); }
        function walk(p, f) { var im = sheetOf(p.animal, p.skin, '-walk'); if (!ok(im)) { cell(p, 0, f); return; } ctx.imageSmoothingEnabled = true; ctx.drawImage(im, f * CELL, 0, CELL, CELL, -CS / 2, -CS * FEET, CS, CS); }
        function wpoly(pts) { ctx.beginPath(); pts.forEach(function (q, i) { if (i) ctx.lineTo(X(q[0]), Y(q[1])); else ctx.moveTo(X(q[0]), Y(q[1])); }); ctx.closePath(); }

        // ── 타임라인 → 동물별 상태 바뀐 시각·사건 목록 ──
        var ev = [];   // tl.events
        function setTimeline(data, myName) {
            tl = data; me = myName || ''; mode = 'play';
            var c = tl.course;
            rocks = c.rocks; storms = c.storms.map(function (o) { return Object.assign({ flash: -9, fx: 0, fa: 0 }, o); }); items = c.items; isles = c.isles; therms = c.therms;
            var vr = mulberry32(4242), n = tl.players.length;   // 3·2·1 준비 동작 — 그림 전용 고정 시드(목업 vr 과 같은 값)
            players = tl.players.map(function (pl, i) {
                return { i: i, id: pl.id, name: pl.owner, short: shortName(pl.owner), animal: pl.creature, skin: pl.skin || null, color: COLORS[(pl.colorIdx != null ? pl.colorIdx : i) % COLORS.length],
                    prepAt: V.prepAt[0] + vr() * (V.prepAt[1] - V.prepAt[0]), prepKind: Math.floor(vr() * 4),
                    x: 0, a: CLIFF, st: 'line', va: 0, dir: 1, fx: 0, item: null, roll: 0, holdT: 0, done: false, rank: 0, landT: 0, tm: 0, anim: i * 0.37, over: false, th: null,
                    boost: 0, shield: 0, small: 0, inked: 0, magnet: 0, rocket: 0, angel: 0, swoop: 0, magT: null, trail: [], since: [] };
            });
            // 상태 바뀐 시각(초) — 프레임을 훑어 처음 본 표본 시각으로(그림용 경과 시간: 물속·쉬기·부스터·박차기)
            var sm = tl.sampleMs / 1000;
            players.forEach(function (p, i) {
                var prev = -1;
                for (var k = 0; k < tl.frames.length; k++) { var st = tl.frames[k][i * 4 + 2]; if (st !== prev) { p.since.push([k * sm, st]); prev = st; } }
            });
            ev = tl.events; evIdx = 0;
            picked = null; follow = null; cut = null; cutEnd = -9; shout = { p: null, key: '', text: '', at: -9 }; lag = 0; slowUntil = -9; feed = []; feedDirty = true;
            decidedReal = JW.realDuration(tl.decidedMs, tl.slow) / 1000;
            if (rankEl) rankEl.hidden = !meP();
            if (boardEl) { boardEl.hidden = W < 640; boardEl.textContent = ''; }
        }
        function meP() { for (var i = 0; i < players.length; i++) if (players[i].name === me) return players[i]; return null; }
        function sinceOf(p, ts) { var cur = p.since[0] || [0, 1]; for (var i = 1; i < p.since.length && p.since[i][0] <= ts + 1e-6; i++) cur = p.since[i]; return cur[0]; }

        // 시뮬 시각 ts(초)의 동물 자리 — 프레임 사이 보간
        function frameAt(ts) { var k = ts / (tl.sampleMs / 1000), a = Math.max(0, Math.min(tl.frames.length - 1, Math.floor(k))); return { a: a, b: Math.min(tl.frames.length - 1, a + 1), u: clamp(k - a, 0, 1) }; }
        function posAt(i, ts) {
            var q = frameAt(ts), fa = tl.frames[q.a], fb = tl.frames[q.b];
            return { x: lerp(fa[i * 4], fb[i * 4], q.u), a: lerp(fa[i * 4 + 1], fb[i * 4 + 1], q.u) };
        }
        function objsOf(f, n) { var out = {}, base = n * 4 + 2, m = f[n * 4 + 1]; for (var j = 0; j < m; j++) { var o = base + j * 4; out[f[o + 1]] = { kind: f[o], id: f[o + 1], x: f[o + 2], a: f[o + 3] }; } return out; }

        // ── 시뮬 시각 ts 의 세계 상태 짓기(그리기 전에 한 번) ──
        function buildAt(ts) {
            t = ts;
            var n = players.length, q = frameAt(ts), fa = tl.frames[q.a], fb = tl.frames[q.b], u = q.u;
            var fp = tl.frames[Math.max(0, frameAt(Math.max(0, ts - 0.05)).a)];
            boxOpen = !!fa[n * 4];
            players.forEach(function (p, i) {
                var o = i * 4, st = STATES[fa[o + 2]];
                p.x = lerp(fa[o], fb[o], u); p.a = lerp(fa[o + 1], fb[o + 1], u);
                if (STATES[fb[o + 2]] !== st && u > 0.5) st = STATES[fb[o + 2]];
                p.st = st; var f = fa[o + 3]; p.fx = f;
                var pa = posAt(i, Math.max(0, ts - 0.1)); p.va = (p.a - pa.a) / 0.1;
                p.boost = f & FX.boost ? 1 : 0; p.shield = f & FX.shield ? 1 : 0; p.small = f & FX.small ? 1 : 0; p.inked = f & FX.inked ? 1 : 0; p.magnet = f & FX.magnet ? 1 : 0;
                p.rocket = f & FX.rocket ? 1 : 0; p.angel = f & FX.angel ? 1 : 0; p.swoop = f & FX.swoop ? 1 : 0; p.over = !!(f & FX.over);
                p.th = f & FX.th ? { big: !!(f & FX.big) } : null;
                var code = f >> 12; p.item = code ? ITEMS[code - 1] : null; p.roll = f & FX.roll ? 1 : 0;
                var el = ts - sinceOf(p, ts); p.el = el;
                p.tm = st === 'sea' ? R.seaDur - el : st === 'isle' ? R.isleRest - el : st === 'tumble' ? R.tumbleDur - el : el;
                p.anim = clock + i * 0.37;
                // 꼬리: 지나온 길(약 1.2초) — 나는 상태일 때만
                p.trail = [];
                for (var k = V.trailN - 1; k >= 0; k--) {
                    var tk = ts - k * 0.05; if (tk < 0) continue;
                    var fk = tl.frames[frameAt(tk).a], sk = STATES[fk[o + 2]];
                    var flying = sk === 'fly' || sk === 'jump' || sk === 'bubble' || sk === 'tumble' || sk === 'blast';
                    p.trail.push(flying ? { x: fk[o], a: fk[o + 1] + 26, b: !!(fk[o + 3] & FX.boost) } : null);
                }
            });
            // 착지·당첨·아이템 쥔 시각 — 사건에서(ts 까지)
            players.forEach(function (p) { p.done = false; p.rank = 0; p.magT = null; p.gotAt = -9; });
            picked = null; zaps = []; flashT = -9; var takenAt = {};
            for (var e = 0; e < ev.length && ev[e].t <= ts * 1000; e++) {
                var E = ev[e], et = E.t / 1000, P = E.who != null ? players[E.who] : null;
                if (E.type === 'finish') { P.done = true; P.rank = E.rank; P.landT = R.landDur - (ts - et); }
                else if (E.type === 'decided') picked = P;
                else if (E.type === 'box') { P.gotAt = et; takenAt[E.idx] = et; }
                else if (E.type === 'orb') takenAt[E.idx] = et;
                else if (E.type === 'use' && E.item === 'magnet' && E.to != null) P.magT = players[E.to];
                else if (E.type === 'zapWarn' && ts - et < R.zapWarn) zaps.push({ to: P, t: ts - et });
                else if (E.type === 'zap' || E.type === 'zapAll') flashT = et;
                else if (E.type === 'bolt') { var c = storms[E.storm]; c.flash = et; var bp = posAt(E.who, et); c.fx = bp.x; c.fa = bp.a + 30; }
            }
            players.forEach(function (p) { p.holdT = p.item ? ts - p.gotAt : 0; if (p.done) p.st = 'done'; });
            items.forEach(function (it, i) { it.off = takenAt[i] != null && ts - takenAt[i] < R.itemRespawn ? 1 : 0; });
            // 움직이는 물체(보간, 같은 id 끼리)
            var oa = objsOf(fa, n), ob = objsOf(fb, n), op = objsOf(fp, n);
            eagles = []; shots = []; mines = [];
            Object.keys(oa).forEach(function (id) {
                var A0 = oa[id], B0 = ob[id] || A0, x = lerp(A0.x, B0.x, u), a = lerp(A0.a, B0.a, u), P0 = op[id] || A0;
                var o = { id: +id, x: x, a: a, ang: Math.atan2(-(a - P0.a), x - P0.x || 1) };
                if (A0.kind === OBJ.eagle) eagles.push(o);
                else if (A0.kind === OBJ.mine) mines.push(o);
                else { o.kind = A0.kind === OBJ.missile ? 'missile' : 'balloon'; if (o.kind === 'missile') o.hist = missileHist(+id, ts); shots.push(o); }
            });
            buildFx(ts);
        }
        function missileHist(id, ts) {   // 연기 꼬리 — 같은 미사일의 지난 자리 10개(약 0.07초 간격)
            var out = [], n = players.length;
            for (var k = 10; k >= 1; k--) { var tk = ts - k * 0.067; if (tk < 0) continue; var o = objsOf(tl.frames[frameAt(tk).a], n)[id]; if (o) out.push([o.x, o.a]); }
            return out;
        }

        // ── 사건 → 연출(목업 addFx 와 같은 종류·수명) ──
        function pushFx(list, ts, et, kind, x, a, o) { var f = Object.assign({ kind: kind, x: x, a: a, t: ts - et, life: 0.6 }, o); if (f.t >= 0 && f.t < f.life) list.push(f); }
        function buildFx(ts) {
            var list = [], from = ts * 1000 - 3200;   // 가장 긴 연출(흙더미 3.9초)보다 넉넉히 — 아래에서 수명으로 거른다
            for (var e = 0; e < ev.length; e++) {
                var E = ev[e]; if (E.t > ts * 1000) break; if (E.t < from - 1500) continue;
                var et = E.t / 1000, P = E.who != null ? players[E.who] : null, pp = P ? posAt(P.i, et) : null;
                switch (E.type) {
                    case 'snap': pushFx(list, ts, et, 'dust', pp.x, pp.a); pushFx(list, ts, et, 'snap', pp.x, pp.a, { life: 0.5, p: P }); break;
                    case 'isle': pushFx(list, ts, et, 'dust', pp.x, pp.a, { life: 0.6 }); break;
                    case 'sea': pushFx(list, ts, et, 'bigsplash', pp.x, 0, { life: 1.3, k: E.k }); break;
                    case 'toss': pushFx(list, ts, et, 'geyser', pp.x, 0, { life: R.tossDur }); break;
                    case 'mound': pushFx(list, ts, et, 'mound', E.x, 0, { life: R.moundDur + R.blastDur + 2.2 }); break;
                    case 'blast': pushFx(list, ts, et, 'dust', pp.x, pp.a, { life: 0.6 }); break;
                    case 'hit': pushFx(list, ts, et, 'hit', pp.x, pp.a + 30, { life: 0.5, bolt: E.kind === 'bolt' || E.kind === 'zap1' }); break;
                    case 'block': pushFx(list, ts, et, 'pop', pp.x, pp.a + 24, { life: 0.5 }); pushFx(list, ts, et, 'label', pp.x, pp.a, { life: 0.9, text: '막았다!', col: C.shieldInk }); break;
                    case 'bubble': pushFx(list, ts, et, 'splat', pp.x, pp.a + 24, { life: 0.5 }); break;
                    case 'bubbleEnd': pushFx(list, ts, et, 'pop', pp.x, pp.a + 24, { life: 0.5 }); break;
                    case 'box': { var it = items[E.idx]; pushFx(list, ts, et, 'boxpop', it.x, it.a, { life: 0.6 }); break; }
                    case 'orb': pushFx(list, ts, et, 'use', pp.x, pp.a, { life: 0.9, item: 'boost' }); break;
                    case 'use': pushFx(list, ts, et, 'use', pp.x, pp.a, { life: 1, item: E.item, p: P }); break;
                    case 'zap': pushFx(list, ts, et, 'zap', pp.x, pp.a + 30, { life: 0.6 }); break;
                    case 'zapAll': E.hit.forEach(function (j) { var q = posAt(j, et); pushFx(list, ts, et, 'zap', q.x, q.a + 30, { life: 0.5, small: true }); }); break;
                    case 'ink': { var ip = posAt(E.by, et); E.to.forEach(function (j) { pushFx(list, ts, et, 'inkshot', ip.x, ip.a + 30, { life: 0.45, to: players[j] }); }); break; }   // 먹물은 쏜 쪽이 by
                    case 'boom': pushFx(list, ts, et, 'boom', E.x, E.a, { life: 0.7, big: !!E.big }); break;
                    case 'burst': pushFx(list, ts, et, 'burst', E.x, E.a); break;
                    case 'runback': pushFx(list, ts, et, 'dust', pp.x, GA, { life: 0.6 }); pushFx(list, ts, et, 'label', pp.x, GA, { life: 1.1, text: '헐레벌떡!', col: C.tag }); break;
                    case 'over': pushFx(list, ts, et, 'label', pp.x, pp.a, { life: 1, text: E.boost ? '못 멈춰!' : '지나쳤다!', col: C.warn }); break;
                    case 'finish': pushFx(list, ts, et, 'dust', pp.x, GA, { life: 0.6 }); pushFx(list, ts, et, 'pill', pp.x, GA, { life: 1.6, n: E.rank }); if (E.rank === 1) pushFx(list, ts, et, 'confetti', pp.x, GA + 60, { life: 2 }); break;
                }
            }
            // 이어지는 먼지(그림만): 뛰어 돌아오는 발밑 · 부스터 연기
            players.forEach(function (p) {
                if (p.st !== 'runback' && p.st !== 'blast') return;
                var every = p.st === 'runback' ? 0.16 : 0.09, life = p.st === 'runback' ? 0.45 : 0.5, st0 = ts - p.el;
                for (var k = Math.floor(p.el / every); k >= 1 && p.el - k * every < life; k--) {
                    var et = st0 + k * every, q = posAt(p.i, et);
                    pushFx(list, ts, et, 'dust', p.st === 'runback' ? q.x + 14 : q.x, p.st === 'runback' ? GA : q.a - 30, { life: life, small: true });
                }
            });
            fx = list;
        }

        // ── 소식 줄(DOM) — 나·지금 보는 동물 일, 그리고 모두에게 닿는 일만(목업 say) ──
        function say(text, mine, who) { if (!mine && who !== 'all' && who !== camFocus()) return; feed.push({ text: text, mine: mine, at: clock }); if (feed.length > 3) feed.shift(); feedDirty = true; }
        function feedEvent(E) {
            var P = E.who != null ? players[E.who] : null, B = E.by != null ? players[E.by] : null, mine = function (q) { return !!q && q.name === me; };
            var nm = function (q) { return q.short; };
            switch (E.type) {
                case 'hit': if (B) say(nm(P) + ', ' + nm(B) + (E.kind === 'bump' ? '에게 튕김' : ' ' + ITEM[E.kind] + '에 펑'), mine(P) || mine(B), P); else if (EVT[E.kind]) say(nm(P) + ' ' + EVT[E.kind], mine(P), P); break;
                case 'sea': case 'isle': say(nm(P) + ' ' + EVT[E.type], mine(P), P); break;
                case 'over': say(nm(P) + ' ' + EVT.over, mine(P), 'all'); break;
                case 'block': say(nm(P) + ' 방패로 막음', mine(P), P); break;
                case 'bubble': say(nm(P) + ', ' + nm(B) + ' 물풍선에 갇힘', mine(P) || mine(B), P); break;
                case 'runback': say(nm(P) + ' 모래사장에 내려 뛰어옴', mine(P), P); break;
                case 'finish': say(nm(P) + ' ' + E.rank + '등 착지', mine(P), 'all'); break;
                case 'zapWarn': say(nm(B) + ' 1등 번개 → ' + nm(P), mine(P) || mine(B), 'all'); break;
                case 'zapAll': say(nm(B) + ' 번개! 모두 작아짐', mine(B), 'all'); break;
                case 'ink': say(nm(B) + ' 먹물!', mine(B) || E.to.some(function (j) { return mine(players[j]); }), B); break;
                case 'use': if (E.item === 'angel') say(nm(P) + ' 무적!', mine(P), P); else if (E.item === 'rocket') say(nm(P) + ' 로켓 발사!', mine(P), 'all'); break;
            }
        }

        // ── 카메라(결과와 무관): 기본 = 내 카메라(내 동물을 화면 가로 70% 자리에). 끄면 선두 카메라 + 아이템 컷 ──
        var toIsle = function (p) { return Math.abs(TGT - p.x); };
        function autoFocus() {
            var act = players.filter(function (p) { return !p.done; }); if (!act.length) return null;
            if (tl.target === 'last' && act.length <= V.lastCam) return act.reduce(function (a, b) { return toIsle(b) > toIsle(a) ? b : a; });
            return act.reduce(function (a, b) { return toIsle(b) < toIsle(a) ? b : a; });
        }
        function camFocus() {
            if (mode !== 'play' || phase === 'count') return null;
            if (picked) return picked;
            if (follow && !follow.done) return follow;
            if (cut) return cut.p;
            return autoFocus() || players[0];
        }
        function cutX(c) {
            var b = c.obj != null ? shots.filter(function (o) { return o.id === c.obj; })[0] : null;
            if (b) c.x = b.x;
            else if (c.k === 'zap1' && c.to && zaps.some(function (z) { return z.to === c.to; })) c.x = c.to.x;
            else if (c.k === 'magnet' && c.p.magT && c.p.magnet > 0) c.x = (c.p.x + c.p.magT.x) / 2;
            else if (c.k === 'ink') c.x = c.p.x + 140 * c.p.dir;
            else if (c.x == null || c.k !== 'missile' && c.k !== 'balloon') c.x = c.p.x;
            return c.x;
        }
        function cutLive(c) { return (c.obj != null && shots.some(function (o) { return o.id === c.obj; })) || (c.k === 'zap1' && zaps.length); }
        function updateCam(dt, snap) {
            follow = followMe ? meP() : null;
            if (cut && (follow || picked || cut.p.done || clock - cut.t0 > (cutLive(cut) ? V.cutMax : V.cutHold))) { cut = null; cutEnd = clock; }
            var f = camFocus(), back = f && !f.done && (f.st === 'runback' || f.st === 'toss');
            var x;
            if (!f) {   // 기다릴 땐 절벽 끝을 화면 62% 자리에 — 줄 뒤쪽에 서 있어도 내 동물이 화면 안에 들어오게
                x = -(0.62 - V.anchorX) * W / s;
                var m = meP() || (mode === 'idle' && idle ? idle.meP : null);
                if (m) x = Math.min(x, m.x + (V.anchorX * W - 56) / s);
            } else x = (cut && f === cut.p ? cutX(cut) : f.done ? TGT : f.x) + (back ? (2 * V.anchorX - 1) * W / s : 0);
            x = Math.min(x, V.worldR - (1 - V.anchorX) * W / s);
            var fast = cut || clock - cutEnd < 1;
            camX += (x - camX) * (snap ? 1 : 1 - Math.exp(-(fast ? V.cutEase : V.camEase) * dt));   // dt = 실제 경과(가려진 탭에서 프레임이 드물어도 따라잡는다 — 경주 시계는 서버 기준이라 멈추지 않는다)
            if (f && !cut) camX = clamp(camX, x - (V.keepR - V.anchorX) * W / s, x + (V.anchorX - V.keepL) * W / s);   // 로켓·부스터로 빨라져도 대상이 화면 가로 keepL~keepR 밖으로 안 나가게(폰 375 에서 오른쪽 끝에 걸렸다)
        }

        // ── 그리기(목업 그대로) ──
        var wrapX = function (x0, par, w) { var sp = Math.max(BG.span, W + 400), v = ((x0 - camX * s * par) % sp + sp) % sp; return v - w; };
        function drawBack() {
            var hz = H * V.horizon;
            var g = ctx.createLinearGradient(0, 0, 0, hz); C.sky.forEach(function (c, i) { g.addColorStop(i / (C.sky.length - 1), c); });
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, hz + 1);
            ctx.fillStyle = C.star; BG.stars.forEach(function (st) { ctx.globalAlpha = 0.35 + 0.35 * Math.sin(clock * 1.7 + st.ph); ctx.fillRect(st.x * W, st.y * hz, 2, 2); }); ctx.globalAlpha = 1;
            var sx = W * 0.72 - camX * s * 0.012, sr = Math.min(W, H) * 0.11;
            var gl = ctx.createRadialGradient(sx, hz, sr * 0.6, sx, hz, sr * 4.5); gl.addColorStop(0, 'rgba(' + C.sunGlow + ',.55)'); gl.addColorStop(1, 'rgba(' + C.sunGlow + ',0)');
            ctx.fillStyle = gl; ctx.fillRect(0, 0, W, hz);
            ctx.fillStyle = C.sunEdge; ctx.beginPath(); ctx.arc(sx, hz, sr + 3, Math.PI, 0); ctx.fill();
            ctx.fillStyle = C.sun; ctx.beginPath(); ctx.arc(sx, hz, sr, Math.PI, 0); ctx.fill();
            BG.clouds.forEach(function (c) {
                var x = wrapX(c.x, c.par, c.w), y = c.y * hz, h = c.w * 0.16; if (x > W + 20) return;
                ctx.fillStyle = c.L ? C.cloud : C.cloudFar; ctx.beginPath(); ctx.ellipse(x + c.w / 2, y, c.w / 2, h, 0, 0, 7); ctx.ellipse(x + c.w * 0.32, y - h * 0.6, c.w * 0.22, h * 0.9, 0, 0, 7); ctx.fill();
                ctx.fillStyle = C.cloudLit; ctx.fillRect(x + c.w * 0.12, y + h * 0.55, c.w * 0.76, Math.max(2, h * 0.3));
            });
            ctx.fillStyle = C.isleFar; BG.isles.forEach(function (i) { var x = wrapX(i.x, 0.02, i.w); if (x > W) return; ctx.beginPath(); ctx.ellipse(x + i.w / 2, hz, i.w / 2, i.h, 0, Math.PI, 0); ctx.fill(); });
            var sg = ctx.createLinearGradient(0, hz, 0, H); sg.addColorStop(0, C.seaTop); sg.addColorStop(0.25, C.seaMid); sg.addColorStop(0.6, C.seaLow); sg.addColorStop(1, C.seaDeep);
            ctx.fillStyle = sg; ctx.fillRect(0, hz, W, H - hz);
            ctx.fillStyle = C.glint;
            for (var y = hz + 3, i = 0; y < H; y += 5, i++) { var f = (y - hz) / (H - hz), w = sr * (0.5 + f * 1.8) * (0.45 + 0.55 * Math.abs(Math.sin(clock * 1.3 + i * 1.7))); ctx.globalAlpha = 0.7 * (1 - f); ctx.fillRect(sx - w / 2, y, w, 2); }
            ctx.globalAlpha = 1;
            var near = H * V.seaY - hz;
            for (var k = 1; k <= 16; k++) {
                var ff = Math.pow(k / 16, 1.6), yy = hz + (H - hz) * ff, par = clamp((yy - hz) / near, 0.04, 1.4), gap = 30 + 90 * ff, len = 6 + 22 * ff;
                ctx.strokeStyle = 'rgba(' + C.wave + ',' + (0.15 + 0.3 * ff).toFixed(2) + ')'; ctx.lineWidth = 1 + ff * 1.5; ctx.beginPath();
                for (var x = ((-camX * s * par + k * 37) % gap + gap) % gap - gap; x < W; x += gap) { var y2 = yy + Math.sin(clock * 2 + x * 0.05 + k) * 1.5; ctx.moveTo(x, y2); ctx.quadraticCurveTo(x + len / 2, y2 - 2 - ff * 2, x + len, y2); }
                ctx.stroke();
            }
            ctx.strokeStyle = C.gull; ctx.lineWidth = 1.5; ctx.beginPath();
            BG.gulls.forEach(function (gu) { var x = wrapX(gu.x, 0.18, 20), y = gu.y * hz + Math.sin(clock * 0.8 + gu.ph) * 6, wv = 3 + 2 * Math.sin(clock * 6 * gu.k + gu.ph), w = 7 * gu.k; if (x > W) return; ctx.moveTo(x - w, y - wv); ctx.quadraticCurveTo(x - w / 2, y - wv - 2, x, y); ctx.quadraticCurveTo(x + w / 2, y - wv - 2, x + w, y - wv); });
            ctx.stroke();
        }
        function drawCliff() {
            if (!inX(-200, W + 400)) return;
            ctx.fillStyle = C.rock; wpoly([[-3000, 0], [-3000, CLIFF], [0, CLIFF], [14, 370], [6, 290], [26, 210], [12, 120], [34, 40], [28, 0]]); ctx.fill();
            ctx.fillStyle = C.rockLit; wpoly([[0, CLIFF], [14, 370], [6, 290], [26, 210], [12, 120], [34, 40], [28, 0], [10, 0], [16, 60], [-6, 140], [6, 230], [-12, 300], [-4, 380]]); ctx.fill();
            ctx.fillStyle = C.rockDark; for (var x = -60; x > -3000; x -= 140) { wpoly([[x, CLIFF - 60], [x + 40, CLIFF - 110], [x + 10, CLIFF - 200], [x - 20, CLIFF - 130]]); ctx.fill(); }
            ctx.fillStyle = C.grassDark; wpoly([[-3000, CLIFF], [-3000, CLIFF - 16], [6, CLIFF - 16], [8, CLIFF]]); ctx.fill();
            ctx.fillStyle = C.grass; wpoly([[-3000, CLIFF + 2], [-3000, CLIFF - 8], [10, CLIFF - 8], [10, CLIFF + 2]]); ctx.fill();
            place(4, CLIFF); ctx.fillStyle = C.trunk; ctx.fillRect(-2, -46, 4, 46); if (ok(IMG('flag'))) { ctx.imageSmoothingEnabled = false; ctx.drawImage(IMG('flag'), 0, -50, 26, 26); }
            scr();
        }
        function drawRock(r) {
            if (!inX(r.x, 200)) return;
            var w = r.hw;
            ctx.fillStyle = C.rock; wpoly([[r.x - w * 1.35, 0], [r.x - w, r.h * 0.45], [r.x - w * 0.9, r.h * 0.8], [r.x - w * 0.6, r.h], [r.x + w * 0.55, r.h], [r.x + w * 0.85, r.h * 0.75], [r.x + w, r.h * 0.4], [r.x + w * 1.3, 0]]); ctx.fill();
            ctx.fillStyle = C.rockLit; wpoly([[r.x + w * 0.2, 0], [r.x + w * 0.3, r.h * 0.6], [r.x + w * 0.55, r.h], [r.x + w * 0.85, r.h * 0.75], [r.x + w, r.h * 0.4], [r.x + w * 1.3, 0]]); ctx.fill();
            ctx.fillStyle = C.grass; wpoly([[r.x - w * 0.65, r.h], [r.x - w * 0.5, r.h + 6], [r.x + w * 0.5, r.h + 6], [r.x + w * 0.6, r.h]]); ctx.fill();
            if (r.lh) {
                ctx.fillStyle = C.tower; wpoly([[r.x - 13, r.h], [r.x - 9, r.h + 58], [r.x + 9, r.h + 58], [r.x + 13, r.h]]); ctx.fill();
                ctx.fillStyle = C.towerStripe; [14, 36].forEach(function (y) { wpoly([[r.x - 12, r.h + y], [r.x - 11, r.h + y + 9], [r.x + 11, r.h + y + 9], [r.x + 12, r.h + y]]); ctx.fill(); });
                ctx.fillStyle = C.lamp; wpoly([[r.x - 8, r.h + 58], [r.x - 8, r.h + 68], [r.x + 8, r.h + 68], [r.x + 8, r.h + 58]]); ctx.fill();
                ctx.fillStyle = C.towerStripe; wpoly([[r.x - 10, r.h + 68], [r.x, r.h + 76], [r.x + 10, r.h + 68]]); ctx.fill();
                var ang = clock * 1.4, lx = X(r.x), ly = Y(r.h + 63), L = 260 * s, sw = Math.cos(ang);
                var bg = ctx.createLinearGradient(lx, ly, lx + L * sw, ly); bg.addColorStop(0, 'rgba(' + C.beam + ',.5)'); bg.addColorStop(1, 'rgba(' + C.beam + ',0)');
                ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(lx, ly - 3); ctx.lineTo(lx + L * sw, ly - 26 * s); ctx.lineTo(lx + L * sw, ly + 26 * s); ctx.lineTo(lx, ly + 3); ctx.fill();
            }
        }
        function drawIsland() {
            if (X(ISL1 + 200) < -20 || X(ISL0 - 200) > W + 20) return;
            ctx.fillStyle = C.sandDark; wpoly([[ISL0 - 200, 0], [ISL0 - 40, GA - 8], [ISL0, GA], [ISL1, GA], [ISL1 + 40, GA - 8], [ISL1 + 200, 0]]); ctx.fill();
            ctx.fillStyle = C.sand; wpoly([[ISL0 - 150, 8], [ISL0 - 30, GA - 4], [ISL0, GA], [ISL1, GA], [ISL1 + 30, GA - 4], [ISL1 + 150, 8], [ISL1 + 60, 16], [ISL0 - 60, 16]]); ctx.fill();
            ctx.fillStyle = C.zone; wpoly([[ISL0 + 10, GA], [ISL0 + 10, GA + 3], [ZONE_R, GA + 3], [ZONE_R, GA]]); ctx.fill();
            ctx.fillStyle = C.mat; wpoly([[TGT - 70, GA], [TGT - 60, GA + 5], [TGT + 60, GA + 5], [TGT + 70, GA]]); ctx.fill();
            ctx.fillStyle = C.matLight; wpoly([[TGT - 44, GA + 1], [TGT - 38, GA + 5], [TGT + 38, GA + 5], [TGT + 44, GA + 1]]); ctx.fill();
            ctx.fillStyle = C.mat; wpoly([[TGT - 18, GA + 2], [TGT - 15, GA + 5], [TGT + 15, GA + 5], [TGT + 18, GA + 2]]); ctx.fill();
            [ISL1 - 70, ZONE_R + 520, ZONE_R + 160].forEach(function (px, j) {
                var hgt = 120 - j * 14; ctx.fillStyle = C.trunk; wpoly([[px - 6, GA], [px - 2, GA + hgt], [px + 4, GA + hgt], [px + 6, GA]]); ctx.fill();
                [[-1, 0.5], [1, 0.4], [-1, -0.2], [1, -0.3], [0, 1]].forEach(function (q, i) { var d = q[0], up = q[1]; ctx.fillStyle = i & 1 ? C.palmDark : C.palm; wpoly([[px, GA + hgt], [px + d * 40 + (d ? 0 : -6), GA + hgt + up * 30], [px + d * 70 + (d ? 0 : 6), GA + hgt - 8 + up * 34], [px + d * 30, GA + hgt + 4 + up * 18]]); ctx.fill(); });
            });
            [ZONE_R + 330, ZONE_R + 860].forEach(function (ux, j) {
                ctx.fillStyle = C.trunk; wpoly([[ux - 2, GA], [ux - 2, GA + 62], [ux + 2, GA + 62], [ux + 2, GA]]); ctx.fill();
                for (var k = 0; k < 4; k++) { ctx.fillStyle = (k + j) & 1 ? C.matLight : C.mat; wpoly([[ux - 46 + k * 23, GA + 54], [ux, GA + 78], [ux - 46 + (k + 1) * 23, GA + 54]]); ctx.fill(); }
            });
            [[ISL0 + 20, '착지'], [ZONE_R, '여기까지']].forEach(function (q) {
                place(q[0], GA); ctx.fillStyle = C.trunk; ctx.fillRect(-2, -64, 4, 64); if (ok(IMG('flag'))) { ctx.imageSmoothingEnabled = false; ctx.drawImage(IMG('flag'), 0, -68, 30, 30); }
                ctx.font = '800 11px ' + BODY; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = C.tagInk; ctx.fillStyle = C.tag; ctx.strokeText(q[1], 0, -76); ctx.fillText(q[1], 0, -76);
            });
            scr();
        }
        function drawStorm(c) {
            if (!inX(c.x, c.hw * s + 80)) return;
            ctx.fillStyle = C.rain; for (var i = 0; i < 14; i++) { var x = c.x - c.hw * 0.8 + i * c.hw * 0.12, y0 = c.a - c.hh * 0.6 - ((clock * 300 + i * 53) % 90); ctx.fillRect(X(x), Y(y0), 1.5, 14 * s); }
            [[0, 0, 1, C.stormDark], [-0.45, 0.25, 0.6, C.storm], [0.4, 0.2, 0.65, C.storm], [0, 0.45, 0.55, C.stormLit]].forEach(function (q) {
                ctx.fillStyle = q[3]; ctx.beginPath(); ctx.ellipse(X(c.x + q[0] * c.hw), Y(c.a + q[1] * c.hh), c.hw * q[2] * s, c.hh * q[2] * 0.8 * s, 0, 0, 7); ctx.fill();
            });
            if (t - c.flash < 0.18 && t >= c.flash) {
                ctx.strokeStyle = C.bolt; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X(c.fx), Y(c.a - c.hh * 0.3));
                for (var k = 1; k <= 5; k++) ctx.lineTo(X(c.fx + (k & 1 ? 14 : -10)), Y(lerp(c.a - c.hh * 0.3, c.fa, k / 5)));
                ctx.stroke(); ctx.fillStyle = 'rgba(255,250,210,.18)'; ctx.fillRect(0, 0, W, H);
            }
        }
        function drawTherm(c) {
            if (!inX(c.x, c.hw * s + 120)) return;
            var k = JW.windK(c, t), u = (t + c.ph) % (c.on + c.off), cx = X(c.x), yb = Y(0), yt = Y(c.top), hw = c.hw * s, i;
            ctx.lineCap = 'round';
            var charge = k > 0 ? 1 : clamp((u - c.on) / c.off, 0, 1);
            for (i = 0; i < 3; i++) { var q = k > 0 ? ((clock * 2.2 + i / 3) % 1) : 1 - ((clock * 1.4 + i / 3) % 1); ctx.strokeStyle = 'rgba(' + C.wind + ',' + ((k > 0 ? 0.8 : 0.35 + 0.35 * charge) * (1 - q * 0.7)).toFixed(2) + ')'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.ellipse(cx, yb + 2, hw * (0.6 + q * 0.9), (5 + q * 4) * s, 0, 0, 7); ctx.stroke(); }
            if (k <= 0) {
                ctx.strokeStyle = 'rgba(' + C.wind + ',.35)'; ctx.lineWidth = 1.5;
                for (i = 0; i < 3; i++) { var a = clock * 4 + i * 2.1; ctx.beginPath(); ctx.ellipse(cx, yb - (12 + i * 10) * s, hw * 0.5, 4 * s, 0, a, a + 2.2); ctx.stroke(); }
                ctx.lineCap = 'butt'; return;
            }
            ctx.globalAlpha = k;
            var g = ctx.createLinearGradient(cx - hw * 1.3, 0, cx + hw * 1.3, 0); g.addColorStop(0, 'rgba(' + C.wind + ',0)'); g.addColorStop(0.35, 'rgba(' + C.wind + ',.22)'); g.addColorStop(0.5, 'rgba(' + (c.big ? C.windBig : C.wind) + ',' + (c.big ? '.5' : '.38') + ')'); g.addColorStop(0.65, 'rgba(' + C.wind + ',.22)'); g.addColorStop(1, 'rgba(' + C.wind + ',0)');
            ctx.fillStyle = g; ctx.fillRect(cx - hw * 1.3, yt - 30 * s, hw * 2.6, yb - yt + 30 * s);
            for (i = 0; i < (c.big ? 26 : 14); i++) {
                var sp = 900 + (i * 137) % 500, L = 60 + (i * 53) % 90, a0 = ((clock * sp + i * 211) % (c.top + L)) - L, xx = c.x + (((i * 37) % 100) / 100 - 0.5) * c.hw * 1.6;
                var lo = Math.max(0, a0), hi = Math.min(c.top, a0 + L); if (hi <= lo) continue;
                var fade = Math.min(1, (c.top - lo) / 80);
                ctx.strokeStyle = i % 3 ? 'rgba(' + C.wind + ',' + (0.75 * fade).toFixed(2) + ')' : C.windCore; ctx.globalAlpha = k * (i % 3 ? 1 : 0.9 * fade); ctx.lineWidth = (i % 3 ? 2 : 3) * s + 0.5;
                ctx.beginPath(); ctx.moveTo(X(xx), Y(lo)); ctx.lineTo(X(xx), Y(hi)); ctx.stroke();
            }
            ctx.globalAlpha = k;
            for (i = 0; i < (c.big ? 7 : 4); i++) {
                var a1 = (clock * (c.big ? 900 : 520) + i * c.top / (c.big ? 7 : 4)) % c.top, fd = Math.min(1, a1 / 40, (c.top - a1) / 60), w = c.hw * (0.75 + 0.35 * a1 / c.top);
                ctx.strokeStyle = 'rgba(' + (c.big && i % 2 ? C.windBig : C.wind) + ',' + (0.9 * fd).toFixed(2) + ')'; ctx.lineWidth = (c.big ? 3.5 : 2.5) * s + 0.5;
                ctx.beginPath(); ctx.ellipse(cx, Y(a1), w * s, 6 * s, 0, 0.15, Math.PI * 2 - 0.15); ctx.stroke();
            }
            for (i = 0; i < 5; i++) {
                var q2 = (clock * 1.8 + i / 5) % 1, side = i & 1 ? 1 : -1; ctx.strokeStyle = 'rgba(' + C.wind + ',' + (0.7 * (1 - q2)).toFixed(2) + ')'; ctx.lineWidth = 2 * s + 0.5;
                ctx.beginPath(); ctx.arc(X(c.x + side * (20 + q2 * 50)), Y(c.top + 10 + q2 * 26), (10 + q2 * 8) * s, side > 0 ? Math.PI : 0, side > 0 ? Math.PI * 1.8 : -Math.PI * 0.8, side < 0); ctx.stroke();
            }
            ctx.globalAlpha = 1; ctx.lineCap = 'butt';
        }
        function drawIsle(isl) {
            if (X(isl.x1 + 80) < -20 || X(isl.x - 80) > W + 20) return;
            var h = isl.h, px = isl.x + (isl.x1 - isl.x) * (0.25 + ((isl.x * 7) % 100) / 400);
            ctx.fillStyle = C.sandDark; wpoly([[isl.x - 70, 0], [isl.x - 14, h - 8], [isl.x, h], [isl.x1, h], [isl.x1 + 14, h - 8], [isl.x1 + 70, 0]]); ctx.fill();
            ctx.fillStyle = C.sand; wpoly([[isl.x - 46, 8], [isl.x - 10, h - 4], [isl.x, h], [isl.x1, h], [isl.x1 + 10, h - 4], [isl.x1 + 46, 8]]); ctx.fill();
            ctx.fillStyle = C.grass; wpoly([[isl.x + 16, h], [isl.x + 20, h + 4], [isl.x1 - 20, h + 4], [isl.x1 - 16, h]]); ctx.fill();
            var hgt = 70; ctx.fillStyle = C.trunk; wpoly([[px - 4, h], [px - 1, h + hgt], [px + 3, h + hgt], [px + 5, h]]); ctx.fill();
            [[-1, 0.5], [1, 0.4], [-1, -0.2], [1, -0.3], [0, 1]].forEach(function (q, i) { var d = q[0], up = q[1]; ctx.fillStyle = i & 1 ? C.palmDark : C.palm; wpoly([[px, h + hgt], [px + d * 28 + (d ? 0 : -5), h + hgt + up * 22], [px + d * 50 + (d ? 0 : 5), h + hgt - 6 + up * 24], [px + d * 22, h + hgt + 3 + up * 13]]); ctx.fill(); });
            place(isl.x1 - 6, h); ctx.fillStyle = C.trunk; ctx.fillRect(-1.5, -40, 3, 40); if (ok(IMG('flag'))) { ctx.imageSmoothingEnabled = false; ctx.drawImage(IMG('flag'), 0, -44, 22, 22); }
            scr();
        }
        function drawMound(f) {
            if (!inX(f.x, 120)) return;
            var up = Math.min(1, f.t / R.moundDur), down = clamp((f.life - f.t) / 1.2, 0, 1), k = (1 - (1 - up) * (1 - up)) * down, h = R.moundH * k, w = 34 + 10 * k;
            if (h < 1) return;
            ctx.fillStyle = C.dirtDark; wpoly([[f.x - w - 14, 0], [f.x - w * 0.7, h * 0.7], [f.x - w * 0.3, h], [f.x + w * 0.3, h], [f.x + w * 0.7, h * 0.7], [f.x + w + 14, 0]]); ctx.fill();
            ctx.fillStyle = C.dirt; wpoly([[f.x - w, 0], [f.x - w * 0.6, h * 0.72], [f.x - w * 0.25, h - 2], [f.x + w * 0.1, h - 2], [f.x + w * 0.2, h * 0.5], [f.x - w * 0.1, 0]]); ctx.fill();
            ctx.fillStyle = C.dirtLit; wpoly([[f.x - w * 0.3, h], [f.x - w * 0.25, h + 3], [f.x + w * 0.3, h + 3], [f.x + w * 0.3, h]]); ctx.fill();
            if (f.t < R.moundDur + 0.3) {
                var q = f.t / (R.moundDur + 0.3);
                for (var i = 0; i < 12; i++) { var side = i & 1 ? 1 : -1, sp = 40 + (i * 31) % 60, upv = 120 + (i * 47) % 90, tt = q * 1.2, dx = side * sp * tt, dy = upv * tt - 260 * tt * tt;
                    if (dy < -4) continue; ctx.globalAlpha = 1 - q; ctx.fillStyle = i % 3 ? C.dirtLit : C.water; ctx.fillRect(X(f.x + dx) - 2.5 * s, Y(h * 0.6 + dy) - 2.5 * s, 5 * s, 5 * s); }
                ctx.globalAlpha = 1;
            }
            ctx.strokeStyle = C.foam; ctx.lineWidth = 2; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.ellipse(X(f.x), Y(0) + 2, (w + 20 + Math.sin(clock * 3) * 4) * s, 5 * s, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        }
        function drawGlider(p, o) {
            var sp = sail(p.color);
            ctx.save(); ctx.translate(o.x === undefined ? 2 : o.x, o.y === undefined ? -HG.up : o.y); ctx.scale(o.k || 1, o.k || 1); ctx.imageSmoothingEnabled = false;
            if (o.crumple) { ctx.rotate(Math.sin(p.anim * 11) * 0.7); ctx.scale(0.55, 1.4); ctx.drawImage(sp, -HG.hx, -HG.hy, HG.w, HG.h); ctx.restore(); return; }
            ctx.rotate(o.tilt || 0);
            var op = o.open === undefined ? 1 : o.open;
            if (op >= 1) {
                ctx.strokeStyle = C.line; ctx.lineWidth = 1.4; ctx.beginPath();
                ctx.moveTo(0, 0); ctx.lineTo(10, 46); ctx.lineTo(22, 43); ctx.closePath();
                ctx.moveTo(0, 0); ctx.lineTo(-4, 24); ctx.stroke();
            }
            ctx.scale(1, Math.max(0.001, op)); ctx.drawImage(sp, -HG.hx, -HG.hy, HG.w, HG.h);
            ctx.restore();
        }
        function bag(p, x, y, rot) {
            ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
            ctx.fillStyle = 'rgb(' + INK + ')'; rr(-33, -4.5, 66, 9, 4.5); ctx.fill();
            ctx.fillStyle = p.color; rr(-32, -3.5, 64, 7, 3.5); ctx.fill();
            ctx.fillStyle = C.matLight; ctx.fillRect(-6, -3.5, 4, 7); ctx.fillRect(10, -3.5, 2, 7);
            ctx.restore();
        }
        function prep(p) {   // 3·2·1 동안 저마다 출발 준비(그림만)
            var el = phase === 'count' ? V.countdown - countT : 0, u = el - p.prepAt;
            var o = clamp(u / V.prepOpen, 0, 1), l = clamp((u - V.prepOpen) / V.prepLift, 0, 1), e = 1 - Math.pow(1 - l, 3);
            if (o <= 0) { bag(p, -22, -4, 0.08); cell(p, 0, Math.floor(p.anim * 4) % 4); return; }
            var wob = o < 1 ? 0 : 0.1 * Math.sin(Math.min(1, (u - V.prepOpen) / 0.25) * Math.PI);
            var lean = phase === 'count' && countT < 0.4 ? 1 - countT / 0.4 : 0;
            ctx.save(); ctx.rotate(lean * 0.12);
            drawGlider(p, { x: lerp(-18, 2, e), y: lerp(-32, -HG.up, e), tilt: lerp(-0.2, -0.1, e) - lean * 0.06, open: o * o, k: 1 + wob });
            if (u > V.prepOpen && u < V.prepOpen + 0.25) {
                var k = (u - V.prepOpen) / 0.25; ctx.strokeStyle = C.foam; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
                ctx.beginPath(); for (var i = 0; i < 6; i++) { var a = -0.3 - i * 0.55, r0 = 46 + k * 10, r1 = 58 + k * 18; ctx.moveTo(-16 + Math.cos(a) * r0, -14 + Math.sin(a) * r0 * 0.6); ctx.lineTo(-16 + Math.cos(a) * r1, -14 + Math.sin(a) * r1 * 0.6); } ctx.stroke(); ctx.globalAlpha = 1;
            }
            if (l < 1) cell(p, 1, 1);
            else if (lean > 0) walk(p, 0);
            else {
                var kk = p.prepKind, tt = clock + p.i * 0.7;
                if (kk === 0) { ctx.translate(0, -Math.abs(Math.sin(tt * 7)) * 5); cell(p, 0, 0); }
                else if (kk === 1) cell(p, 3, 2 + (Math.floor(tt * 3) & 1));
                else if (kk === 2) cell(p, 0, Math.floor(tt * 4) % 4);
                else cell(p, 1, Math.floor(tt * 2.5) & 1);
            }
            ctx.restore();
        }
        function dizzy(x, y, r, rot) {
            ctx.beginPath(); for (var i = 0; i < 10; i++) { var a = rot + i * Math.PI / 5 - Math.PI / 2, q = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
            ctx.closePath(); ctx.fillStyle = C.lamp; ctx.fill(); ctx.strokeStyle = C.tagInk; ctx.lineWidth = 1; ctx.stroke();
        }
        function spinCell(p) { var im = sheetOf(p.animal, p.skin, ''); if (ok(im)) { ctx.imageSmoothingEnabled = true; ctx.drawImage(im, 0, 2 * CELL, CELL, CELL, -CS / 2, -CS / 2, CS, CS); } }
        function drawPlayer(p) {
            if (!inX(p.x, 90)) return;
            var st = p.st, i, k; place(p.x, p.a); ctx.save();
            if (st === 'line') prep(p);
            else if (st === 'run') { ctx.translate(0, -Math.abs(Math.sin(p.anim * 12)) * 3); drawGlider(p, { tilt: -0.14 }); walk(p, Math.floor(p.anim * 10) % 4); }
            else if (st === 'done') {
                var walking = p !== picked && p.landT <= 0 && Math.abs(p.va) < 1 && p.moving;
                var ps = p === picked ? [4, 3] : p.landT > 0 ? [1, 1] : [3, 2 + (Math.floor(clock * 3 + p.i) & 1)];
                if (p.walkDir < 0 && p.landT <= 0) ctx.scale(-1, 1);
                if (walking) walk(p, Math.floor(p.anim * 6) % 4); else cell(p, ps[0], ps[1]);
            } else if (st === 'runback') {
                var bob = Math.abs(Math.sin(p.anim * 16)) * 5; ctx.translate(0, -bob); ctx.scale(-1, 1);
                bag(p, -2, -34, -0.32); walk(p, Math.floor(p.anim * 14) % 4);
                ctx.fillStyle = C.sweat; for (i = 0; i < 3; i++) { k = (p.anim * 2.2 + i / 3) % 1; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.ellipse(-10 - k * 18 - i * 3, -44 + k * 10 - i * 4, 2.2, 3.2, 0, 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
            } else if (st === 'toss') { ctx.translate(0, -24); ctx.rotate(-p.tm * 16); spinCell(p); }
            else if (st === 'sea') {
                var el = R.seaDur - p.tm, sink = el < 0.4 ? Math.sin(el / 0.4 * Math.PI) * 34 : 0;
                ctx.translate(0, sink + Math.sin(clock * 5 + p.i) * 2.5);
                ctx.save(); ctx.beginPath(); ctx.rect(-CS, -CS * 1.4, CS * 2, CS * 1.4 - sink - 2); ctx.clip(); ctx.translate(Math.sin(clock * 18) * 2, 16); cell(p, 4, el < 0.4 ? 2 : 1); ctx.restore();
                ctx.translate(0, -sink); ctx.fillStyle = C.foam; ctx.strokeStyle = C.foam; ctx.lineWidth = 1.5;
                for (i = 0; i < 4; i++) { k = (clock * 1.6 + i / 4) % 1; ctx.globalAlpha = 0.8 * (1 - k); ctx.beginPath(); ctx.arc(Math.sin(i * 2.3 + clock) * 10, -k * 34, 2 + i % 2, 0, 7); ctx.stroke(); }
                k = (clock * 1.2) % 1; ctx.globalAlpha = 0.6 * (1 - k); ctx.beginPath(); ctx.ellipse(0, 2, 20 + k * 30, 4 + k * 4, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
                if (el > 0.4) for (i = 0; i < 3; i++) { var a = clock * 5 + i * 2.09; dizzy(Math.cos(a) * 16, -52 + Math.sin(a) * 4, 5, a); }
            } else if (st === 'isle') {
                drawGlider(p, { tilt: -0.1 }); var el2 = R.isleRest - p.tm;
                if (el2 < 0.3) cell(p, 1, 1); else { ctx.translate(0, -Math.abs(Math.sin(clock * 6 + p.i)) * 2); cell(p, 0, 0); }
                ctx.fillStyle = C.sweat; for (i = 0; i < 2; i++) { k = (p.anim * 1.6 + i / 2) % 1; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.ellipse(14 + k * 10, -44 + k * 8, 2, 3, 0, 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
            } else if (st === 'mound') {
                ctx.translate(Math.sin(clock * 30) * 1.2, 0); drawGlider(p, { tilt: -0.12 }); cell(p, 1, 1);
                ctx.fillStyle = C.water; for (i = 0; i < 3; i++) { k = (p.anim * 2 + i / 3) % 1; ctx.globalAlpha = 1 - k; ctx.fillRect(-12 + i * 10, -30 + k * 26, 2, 4); } ctx.globalAlpha = 1;
            } else if (st === 'blast') {
                var f = 0.75 + 0.25 * Math.sin(clock * 50 + p.i), L = (36 + 30 * (1 - Math.min(1, p.tm / R.blastDur))) * f;
                ctx.fillStyle = C.boost; ctx.beginPath(); ctx.moveTo(-9, -2); ctx.lineTo(0, L); ctx.lineTo(9, -2); ctx.fill();
                ctx.fillStyle = C.boostHot; ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(0, L * 0.55); ctx.lineTo(5, -2); ctx.fill();
                ctx.fillStyle = C.rocket; rr(-8, -8, 16, 8, 3); ctx.fill();
                drawGlider(p, { tilt: -0.08 }); walk(p, 1);
            } else {
                ctx.scale(p.dir, 1);
                if (st === 'tumble') {
                    drawGlider(p, { crumple: true });
                    for (i = 0; i < 3; i++) { var a2 = clock * 6 + i * 2.09; dizzy(Math.cos(a2) * 20, -60 + Math.sin(a2) * 5, 6, a2); }
                    ctx.translate(0, -26); ctx.rotate(p.anim * 12); spinCell(p);
                } else {
                    var rise = st === 'jump' ? Math.min(1, p.tm / R.openDur) : 1, e = 1 - Math.pow(1 - rise, 3), pv = -HG.up;
                    var pitch = st === 'bubble' ? 0 : clamp(-p.va / 420, -0.4, 0.4) * 0.7 + Math.sin(clock * 2 + p.i) * 0.04 + (p.over ? 0.18 : 0);
                    ctx.translate(0, pv); ctx.rotate(pitch); ctx.translate(0, -pv);
                    if (p.angel > 0) {
                        var gl = ctx.createRadialGradient(0, -26, 4, 0, -26, 46); gl.addColorStop(0, 'rgba(' + C.halo + ',.75)'); gl.addColorStop(1, 'rgba(' + C.halo + ',0)');
                        ctx.fillStyle = gl; ctx.globalAlpha = 0.7 + 0.3 * Math.sin(clock * 14); ctx.fillRect(-46, -72, 92, 92); ctx.globalAlpha = 1;
                    }
                    drawGlider(p, { tilt: -0.14 * (1 - e), k: p.small > 0 ? 0.62 : 1 });
                    if (p.rocket > 0) {
                        var f2 = 0.75 + 0.25 * Math.sin(clock * 50 + p.i); ctx.fillStyle = C.boost; ctx.beginPath(); ctx.moveTo(-26, -12); ctx.lineTo(-26 - 60 * f2, -6); ctx.lineTo(-26, 0); ctx.fill();
                        ctx.fillStyle = C.boostHot; ctx.beginPath(); ctx.moveTo(-26, -9); ctx.lineTo(-26 - 30 * f2, -6); ctx.lineTo(-26, -3); ctx.fill();
                        ctx.fillStyle = C.rocket; ctx.fillRect(-26, -14, 40, 16); ctx.fillStyle = C.mat; ctx.beginPath(); ctx.moveTo(14, -14); ctx.lineTo(26, -6); ctx.lineTo(14, 2); ctx.fill(); ctx.fillRect(-26, -20, 8, 26);
                    } else if (p.boost > 0) {
                        var f3 = 0.7 + 0.3 * Math.sin(clock * 40 + p.i); ctx.fillStyle = C.boost; ctx.beginPath(); ctx.moveTo(-14, -26); ctx.lineTo(-14 - 34 * f3, -20); ctx.lineTo(-14, -14); ctx.fill();
                        ctx.fillStyle = C.boostHot; ctx.beginPath(); ctx.moveTo(-14, -23); ctx.lineTo(-14 - 18 * f3, -20); ctx.lineTo(-14, -17); ctx.fill();
                    }
                    ctx.save(); if (p.small > 0) { ctx.translate(0, -8); ctx.scale(0.8, 0.8); }
                    if (st === 'bubble') cell(p, 4, 0);
                    else if (st === 'jump' && rise < 0.4) walk(p, 1);
                    else { ctx.translate(0, -8); cell(p, 1, 1); }   // 매달린 자세는 웅크림 칸으로 대신(§6-1 — 새 그림 B 가 오면 바꾼다)
                    ctx.restore();
                    if (p.inked > 0) {
                        ctx.fillStyle = C.ink; ctx.beginPath(); ctx.ellipse(7, -36, 11, 8, 0.3, 0, 7); ctx.ellipse(-4, -30, 6, 5, 0, 0, 7); ctx.fill();
                        ctx.fillRect(3, -30, 2, 7 + Math.sin(clock * 3) * 2); ctx.fillRect(10, -31, 2, 5);
                    }
                    if (p.angel > 0) { ctx.strokeStyle = C.halo2; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(2, -56, 11, 3.5, 0, 0, 7); ctx.stroke(); }
                    if (p.small > 0) { ctx.strokeStyle = C.bolt; ctx.lineWidth = 2; ctx.beginPath(); [-18, 16].forEach(function (x) { ctx.moveTo(x, -50); ctx.lineTo(x + 4, -42); ctx.lineTo(x - 2, -38); ctx.lineTo(x + 3, -30); }); ctx.stroke(); }
                    if (st === 'bubble') {
                        ctx.fillStyle = 'rgba(' + C.shield + ',.28)'; ctx.strokeStyle = C.water; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, -24, 32 + Math.sin(clock * 8) * 2, 0, 7); ctx.fill(); ctx.stroke();
                        ctx.fillStyle = C.foam; ctx.fillRect(-18, -46, 6, 4); ctx.fillRect(-21, -40, 3, 3);
                    }
                    if (p.shield > 0) { ctx.strokeStyle = 'rgba(' + C.shield + ',.9)'; ctx.fillStyle = 'rgba(' + C.shield + ',.18)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -24, 30, 0, 7); ctx.fill(); ctx.stroke(); }
                }
            }
            ctx.restore();
        }
        // 내 동물 돋보이기: 다른 동물은 한 겹에 모아 살짝 흐리게 깔고, 내 동물은 작은 겹에 따로 그려 흰 외곽선을 두른 뒤 맨 위에(목업 drawPlayers)
        var LA = document.createElement('canvas'), LAc = LA.getContext('2d'), LM = document.createElement('canvas'), LMc = LM.getContext('2d'), LS = document.createElement('canvas'), LSc = LS.getContext('2d');
        function drawPlayers(f) {
            var mine = mode === 'idle' && idle ? idle.meP : meP();
            if (LA.width !== canvas.width || LA.height !== canvas.height) { LA.width = canvas.width; LA.height = canvas.height; }
            ctx = LAc; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, LA.width, LA.height);
            players.forEach(function (p) { if (p !== mine && p !== f) drawPlayer(p); }); if (f && f !== mine) drawPlayer(f);
            ctx = main; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = mine ? V.otherAlpha : 1; ctx.drawImage(LA, 0, 0); ctx.globalAlpha = 1;
            if (!mine || !inX(mine.x, 90)) return;
            var B = V.meBox, sz = Math.round(B * dpr); if (LM.width !== sz) { LM.width = LM.height = LS.width = LS.height = sz; }
            var ox = Math.round((X(mine.x) - B / 2) * dpr) / dpr, oy = Math.round((Y(mine.a) - B * 0.68) * dpr) / dpr, sx0 = SHX, sy0 = SHY;
            SHX -= ox; SHY -= oy; ctx = LMc; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, sz, sz); drawPlayer(mine); ctx = main; SHX = sx0; SHY = sy0;
            LSc.setTransform(1, 0, 0, 1, 0, 0); LSc.globalCompositeOperation = 'source-over'; LSc.clearRect(0, 0, sz, sz); LSc.drawImage(LM, 0, 0);
            LSc.globalCompositeOperation = 'source-in'; LSc.fillStyle = C.tag; LSc.fillRect(0, 0, sz, sz);
            scr(); ctx.imageSmoothingEnabled = false;
            for (var i = 0; i < 12; i++) { var a = i * Math.PI / 6; ctx.drawImage(LS, ox + Math.cos(a) * V.meLine, oy + Math.sin(a) * V.meLine, B, B); }
            ctx.drawImage(LM, ox, oy, B, B);
        }
        function exclaim(x, y, col) {
            var k = 1 + 0.25 * Math.abs(Math.sin(clock * 18)); ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
            ctx.fillStyle = col || C.warn; ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.tag; ctx.stroke();
            ctx.fillStyle = C.tag; ctx.font = '900 14px ' + BODY; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, 1); ctx.restore();
        }
        function drawTrails() {
            var f = camFocus(); scr(); ctx.lineCap = 'round';
            players.forEach(function (p) {
                var tr = p.trail, mine = p === f; if (tr.length < 2 || !inX(p.x, 500)) return;
                for (var pass = 0; pass < (mine ? 2 : 1); pass++) for (var i = 1; i < tr.length; i++) {
                    var a = tr[i - 1], b = tr[i]; if (!a || !b) continue; var k = i / tr.length;
                    ctx.globalAlpha = k * (mine ? 0.9 : 0.45); ctx.strokeStyle = pass ? C.foam : b.b ? C.boost : p.color; ctx.lineWidth = ((mine ? 9 : 4.5) * k + 1) * s * (pass ? 0.35 : 1);
                    ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.a)); ctx.lineTo(X(b.x), Y(b.a)); ctx.stroke();
                }
                if (mine) { ctx.fillStyle = C.foam; for (var j = 2; j < tr.length; j += 3) { var q = tr[j]; if (!q) continue; ctx.globalAlpha = (j / tr.length) * (0.5 + 0.5 * Math.sin(clock * 12 + j)); var z = 2 + (j % 2); ctx.fillRect(X(q.x) + Math.sin(j * 7) * 6 - z / 2, Y(q.a) + Math.cos(j * 5) * 6 - z / 2, z, z); } }
            });
            ctx.globalAlpha = 1; ctx.lineCap = 'butt';
        }
        var pillText = function (txt, x, y, col, size) {
            ctx.font = '900 ' + size + 'px ' + BODY; var w = ctx.measureText(txt).width + size * 1.1, h = size * 1.6;
            ctx.fillStyle = col; ctx.strokeStyle = C.tagInk; ctx.lineWidth = 2.5; rr(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = C.tag; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = C.tagInk; ctx.strokeText(txt, x, y + 1); ctx.fillText(txt, x, y + 1);
        };
        var pop = function (k) { return k < 0.18 ? 0.4 + k / 0.18 * 0.9 : 1.3 - Math.min(0.3, (k - 0.18) * 1.5); };
        function bolt2(x, y0, y1, w, seed) {
            var r = mulberry32(seed), pts = [[x, y0]]; for (var i = 1; i <= 7; i++) pts.push([x + (i < 7 ? (r() - 0.5) * 30 : 0), y0 + (y1 - y0) * i / 7]);
            [[w * 3, 'rgba(255,246,168,.35)'], [w, C.bolt], [w * 0.4, C.foam]].forEach(function (q) { ctx.lineWidth = q[0]; ctx.strokeStyle = q[1]; ctx.beginPath(); pts.forEach(function (pt, j) { if (j) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]); }); ctx.stroke(); });
        }
        function drawFx(f) {
            var k = f.t / f.life, P0 = f.p && !f.p.done ? f.p : null, fx0 = P0 ? P0.x : f.x, fa0 = P0 ? P0.a : f.a, i, a, d;
            if (!inX(fx0, 140)) return;
            scr(); var x = X(fx0), y = Y(fa0);
            if (f.kind === 'zap') {
                if (k < 0.5) bolt2(x, f.small ? y - 90 * s : 0, y, f.small ? 3 : 6, Math.floor(f.t * 20) + Math.round(f.x));
                ctx.strokeStyle = C.bolt; ctx.lineWidth = 2.5; for (i = 0; i < 8; i++) { a = i * 0.785 + f.t * 9; var r0 = (18 + k * 30) * s; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a + 0.3) * r0 * 1.5, y + Math.sin(a + 0.3) * r0 * 1.5); ctx.stroke(); }
                ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'hit') {
                ctx.strokeStyle = f.bolt ? C.bolt : C.foam; ctx.lineWidth = 3.5; ctx.globalAlpha = 1 - k;
                for (i = 0; i < 10; i++) { a = i * 0.628 + 0.2; var q0 = (24 + k * 40) * s, q1 = q0 + 20 * s; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * q0, y + Math.sin(a) * q0); ctx.lineTo(x + Math.cos(a) * q1, y + Math.sin(a) * q1); ctx.stroke(); }
                ctx.globalAlpha = 1; if (ok(IMG('star')) && k < 0.7) { var z = 70 * s; ctx.imageSmoothingEnabled = true; ctx.drawImage(IMG('star'), Math.min(3, Math.floor(k / 0.7 * 4)) * 96, 0, 96, 96, x - z / 2, y - z / 2, z, z); }
                return;
            }
            if (f.kind === 'boom') {
                var R0 = (f.big ? 60 : 40) * s; ctx.globalAlpha = 1 - k;
                ctx.fillStyle = C.boostHot; ctx.beginPath(); ctx.arc(x, y, R0 * (0.5 + k * 0.6) * (1 - k * 0.6), 0, 7); ctx.fill();
                ctx.fillStyle = C.boom; for (i = 0; i < 10; i++) { a = i * 0.628 + k * 2; d = R0 * (0.3 + k * 1.1); ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, R0 * 0.28 * (1 - k) + 2, 0, 7); ctx.fill(); }
                ctx.fillStyle = 'rgba(80,60,90,.5)'; for (i = 0; i < 5; i++) { a = i * 1.26; d = R0 * (0.5 + k); ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d - k * 30 * s, R0 * 0.3 * k, 0, 7); ctx.fill(); }
                ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'bigsplash') {
                var K = f.k || 1, colH = 150 * K * s * Math.sin(Math.min(1, k * 2.2) * Math.PI) * (1 - k * 0.3);
                ctx.fillStyle = C.water; ctx.globalAlpha = 0.9 * (1 - k * 0.6); ctx.beginPath(); ctx.moveTo(x - 16 * s, y); ctx.quadraticCurveTo(x - 8 * s, y - colH, x, y - colH - 8 * s); ctx.quadraticCurveTo(x + 8 * s, y - colH, x + 16 * s, y); ctx.fill();
                ctx.fillStyle = C.foam; ctx.beginPath(); ctx.arc(x, y - colH - 6 * s, 9 * s * (1 - k), 0, 7); ctx.fill();
                for (i = 0; i < 18; i++) {
                    var side = i & 1 ? 1 : -1, sp = (60 + (i * 37) % 90) * K, up = (200 + (i * 53) % 160) * K, tt = k * 1.4, dx = side * sp * tt, dy = up * tt - 380 * tt * tt;
                    if (dy < -10) continue; ctx.globalAlpha = 1 - k; ctx.fillStyle = i % 3 ? C.foam : C.water; ctx.beginPath(); ctx.arc(x + dx * s, y - dy * s, (3 + i % 3) * s, 0, 7); ctx.fill();
                }
                ctx.strokeStyle = C.foam; ctx.lineWidth = 2.5;
                for (i = 0; i < 3; i++) { var q = Math.max(0, k - i * 0.15); if (q <= 0) continue; ctx.globalAlpha = (1 - q) * 0.9; ctx.beginPath(); ctx.ellipse(x, y + 2, (30 + q * 120) * K * s, (6 + q * 16) * s, 0, 0, 7); ctx.stroke(); }
                ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'geyser') {
                var gy = IMG('geyser'); if (!ok(gy)) return; var hh = 240 * s * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2) * (1 - Math.max(0, k - 0.7) / 0.3), fr = Math.min(4, Math.floor(k * 5));
                ctx.imageSmoothingEnabled = true; ctx.drawImage(gy, fr * 128, 0, 128, 256, x - 40 * s, y - hh, 80 * s, hh); return;
            }
            if (f.kind === 'splat' || f.kind === 'burst') {
                ctx.fillStyle = C.water; for (i = 0; i < 12; i++) { a = i * 0.524 + (f.kind === 'burst' ? 0.3 : 0); d = (8 + k * 46) * s; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d + k * 14 * s, (4 * (1 - k) + 1.5) * s, 0, 7); ctx.fill(); }
                ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'boxpop') {
                ctx.strokeStyle = C.foam; ctx.lineWidth = 3; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(x, y, (14 + k * 46) * s, 0, 7); ctx.stroke();
                for (i = 0; i < 12; i++) { a = i * 0.524 + 0.2; d = (10 + k * 60) * s; ctx.fillStyle = C.confetti[i % 5]; ctx.save(); ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d + k * k * 30 * s); ctx.rotate(a + k * 8); ctx.fillRect(-4 * s, -2 * s, 8 * s, 4 * s); ctx.restore(); }
                ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'use') {
                var col = ITEMCOL[f.item] || C.me, cy = y - 26 * s;
                ctx.strokeStyle = col; ctx.lineWidth = 5 * (1 - k) + 1; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(x, cy, (20 + k * 70) * s, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
                var ly = Y(fa0 + R.wingY + 60) - k * 18, sc = pop(k); ctx.save(); ctx.translate(x, ly); ctx.scale(sc, sc); ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
                pillText(ITEM[f.item] + '!', 0, 0, col, 14); ctx.restore(); ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'label') {
                var ly2 = Y(fa0 + 120) - k * 26, sc2 = pop(k); ctx.save(); ctx.translate(x, ly2); ctx.scale(sc2, sc2); ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
                ctx.font = '400 20px ' + DISPLAY; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = C.tagInk; ctx.fillStyle = f.col || C.tag; ctx.strokeText(f.text, 0, 0); ctx.fillText(f.text, 0, 0);
                ctx.restore(); ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'pill') {
                var ly3 = Y(GA + 110 + ((f.n - 1) % 3) * 22) - k * 10, sc3 = pop(Math.min(1, k * 2)); ctx.save(); ctx.translate(x, ly3); ctx.scale(sc3, sc3); ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
                pillText(f.n + '등', 0, 0, f.n === 1 ? C.mat : C.bar, 15); ctx.restore(); ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'confetti') {
                for (i = 0; i < 40; i++) { a = (i * 2.39) % 6.283; var sp2 = 80 + (i * 29) % 160, t2 = k * 2, dx2 = Math.cos(a) * sp2 * t2 * 0.6, dy2 = Math.abs(Math.sin(a)) * sp2 * t2 + 60 * t2 - 120 * t2 * t2;
                    ctx.fillStyle = C.confetti[i % 6]; ctx.globalAlpha = 1 - k * 0.8; ctx.save(); ctx.translate(x + dx2 * s, y - dy2 * s); ctx.rotate(i + f.t * 10); ctx.fillRect(-3 * s, -1.5 * s, 6 * s, 3 * s); ctx.restore(); }
                ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'snap') {
                var cy2 = Y(fa0 + R.wingY); ctx.strokeStyle = C.foam; ctx.lineWidth = 2.5; ctx.globalAlpha = 1 - k;
                for (i = -2; i <= 2; i++) { a = -Math.PI / 2 + i * 0.5; var r1 = (40 + k * 30) * s; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r1, cy2 + Math.sin(a) * r1 * 0.6); ctx.lineTo(x + Math.cos(a) * (r1 + 14 * s), cy2 + Math.sin(a) * (r1 + 14 * s) * 0.6); ctx.stroke(); }
                ctx.globalAlpha = 1; return;
            }
            if (f.kind === 'inkshot') {
                var qq = f.to, tx = X(qq.x), ty = Y(qq.a + 30), kk = Math.min(1, k * 1.4), bx = lerp(X(f.x), tx, kk), by = lerp(Y(f.a), ty, kk) - Math.sin(kk * Math.PI) * 40 * s;
                ctx.fillStyle = C.ink; if (kk < 1) { ctx.beginPath(); ctx.arc(bx, by, 7 * s, 0, 7); ctx.fill(); }
                else { ctx.globalAlpha = 1 - (k - 0.71) / 0.29; for (i = 0; i < 7; i++) { a = i * 0.9; ctx.beginPath(); ctx.arc(tx + Math.cos(a) * 16 * s, ty + Math.sin(a) * 12 * s, 5 * s, 0, 7); ctx.fill(); } ctx.globalAlpha = 1; }
                return;
            }
            if (f.kind === 'pop') { ctx.strokeStyle = 'rgba(' + C.shield + ',' + (1 - k).toFixed(2) + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, (30 + k * 40) * s, 0, 7); ctx.stroke(); return; }
            if (f.kind === 'dust' && ok(IMG('dust'))) { var z2 = (f.small ? 26 : 50) * s; ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1 - k * 0.7; ctx.drawImage(IMG('dust'), Math.min(3, Math.floor(k * 4)) * 80, 0, 80, 80, x - z2 / 2, y - z2 * 0.75, z2, z2); ctx.globalAlpha = 1; }
        }
        var big = function (txt, size, col, y) { ctx.font = '400 ' + size + 'px ' + DISPLAY; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = size / 9; ctx.lineJoin = 'round'; ctx.strokeStyle = C.tagInk; ctx.fillStyle = col; ctx.strokeText(txt, W / 2, y); ctx.fillText(txt, W / 2, y); };
        function camLabel() {
            if (phase !== 'run') return null;
            if (follow && !follow.done) return { text: '내 카메라' };
            if (cut) return { text: cut.p.short + ' · ' + ITEM[cut.k], col: ITEMCOL[cut.k] };
            var act = players.filter(function (p) { return !p.done; }).length;
            return { text: tl.target === 'last' && act <= V.lastCam ? '꼴찌 카메라' : '선두 카메라' };
        }
        function draw() {
            if (!W) return;
            var sh = Math.max(0, 1 - (clock - shakeAt) / V.shakeDur, phase === 'end' && endT < 0.45 ? 1 - endT / 0.45 : 0) * V.shakePx;
            SHX = Math.sin(clock * 83) * sh; SHY = Math.cos(clock * 71) * sh;
            ctx = main; scr(); drawBack();
            therms.forEach(drawTherm); drawCliff(); rocks.forEach(drawRock); isles.forEach(drawIsle); drawIsland(); storms.forEach(drawStorm);
            fx.forEach(function (f) { if (f.kind === 'mound') drawMound(f); });
            items.forEach(function (it) {
                if (it.off > 0 || !inX(it.x, 40)) return;
                var dim = it.kind === 'box' && !boxOpen; ctx.globalAlpha = dim ? 0.28 : 1;
                place(it.x, it.a + (dim ? 0 : Math.sin(clock * 2.5 + it.x) * 5)); if (!dim) { var z = 1 + 0.08 * Math.sin(clock * 6 + it.x); ctx.scale(z, z); } spr(SP[it.kind], 0, 0, 0.5, 0.5);
                ctx.globalAlpha = 1;
            });
            scr(); if (mode === 'play') drawTrails();
            var eg = IMG('eagle');
            eagles.forEach(function (e) { if (!inX(e.x, 80) || !ok(eg)) return; place(e.x, e.a); ctx.scale(-1, 1); ctx.imageSmoothingEnabled = true; ctx.drawImage(eg, (Math.floor(clock * 9 + e.x) & 3) * 256, 0, 256, 160, -36, -23, 72, 45); });
            mines.forEach(function (m) { if (!inX(m.x, 30)) return; place(m.x, m.a + Math.sin(clock * 3 + m.x) * 4); spr(SP.mine, 0, 0, 0.5, 0.35); });
            shots.forEach(function (b) {
                if (!inX(b.x, 40)) return;
                if (b.kind === 'missile') { scr(); b.hist.forEach(function (q, i) { ctx.fillStyle = 'rgba(235,225,240,' + (0.15 + i * 0.05).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(X(q[0]), Y(q[1]), (4 + (b.hist.length - i) * 0.9) * s, 0, 7); ctx.fill(); }); }
                place(b.x, b.a);
                if (b.kind === 'missile') { ctx.rotate(b.ang || 0); ctx.fillStyle = C.boost; ctx.beginPath(); ctx.moveTo(-12, -3); ctx.lineTo(-24 - Math.sin(clock * 50) * 4, 0); ctx.lineTo(-12, 3); ctx.fill(); spr(SP.missile, 0, 0, 0.5, 0.5); }
                else { ctx.rotate(clock * 8); spr(SP.shot, 0, 0, 0.5, 0.5); }
            });
            var f = camFocus(); drawPlayers(f);
            fx.forEach(function (q) { if (q.kind !== 'mound') drawFx(q); });
            scr();
            players.forEach(function (p) {
                if (p.magnet <= 0 || !p.magT || p.st !== 'fly' || !inX(p.x, 400)) return;
                ctx.strokeStyle = C.magnet; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.lineDashOffset = -clock * 40; ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.a + 26)); ctx.lineTo(X(p.magT.x), Y(p.magT.a + 26)); ctx.stroke(); ctx.setLineDash([]);
            });
            zaps.forEach(function (z) {
                var q = z.to; if (!inX(q.x, 60)) return; var x = X(q.x), y = Y(q.a + R.wingY + 52);
                ctx.fillStyle = C.stormDark; ctx.beginPath(); ctx.ellipse(x, y, 26, 11, 0, 0, 7); ctx.ellipse(x - 12, y - 6, 12, 9, 0, 0, 7); ctx.ellipse(x + 10, y - 7, 13, 10, 0, 0, 7); ctx.fill();
                if (Math.floor(clock * 10) & 1) { ctx.fillStyle = C.bolt; ctx.beginPath(); ctx.moveTo(x + 2, y + 6); ctx.lineTo(x - 5, y + 18); ctx.lineTo(x + 1, y + 18); ctx.lineTo(x - 3, y + 28); ctx.lineTo(x + 8, y + 13); ctx.lineTo(x + 2, y + 13); ctx.fill(); }
            });
            if (t - flashT < 0.3 && t >= flashT) { ctx.fillStyle = 'rgba(255,250,210,' + (0.4 * (1 - (t - flashT) / 0.3)).toFixed(2) + ')'; ctx.fillRect(0, 0, W, H); }
            // 이름표 — 내 것이 맨 위
            var mine = mode === 'idle' && idle ? idle.meP : meP();
            scr(); ctx.font = '700 11px ' + BODY; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            players.filter(function (p) { return p !== mine; }).concat(mine ? [mine] : []).forEach(function (p) {
                ctx.globalAlpha = p === mine || p === f ? 1 : p.dim ? 0.45 : 0.8;
                if ((p.st === 'line' || p.st === 'run') && p !== mine && p !== f && players.length > 6) return;   // 절벽 위 한 줄일 땐 내 이름표만(많으면 겹친다)
                var st = p.st, up = st === 'fly' || st === 'jump' || st === 'bubble' || st === 'run' || st === 'line' || st === 'isle' || st === 'mound' || st === 'blast' ? R.wingY + 26 : st === 'tumble' ? 100 : 62, X0 = X(p.x), Y0 = Y(p.a + up);
                if (X0 < -30 || X0 > W + 30 || Y0 < -20 || Y0 > H + 20) return;
                var tw = ctx.measureText(p.short).width + 10;
                ctx.fillStyle = p === mine ? C.me : C.tag; rr(X0 - tw / 2, Y0 - 8, tw, 16, 5); ctx.fill();
                ctx.fillStyle = p.color; ctx.fillRect(X0 - tw / 2 + 3, Y0 + 6, tw - 6, 2);
                ctx.fillStyle = C.tagInk; ctx.fillText(p.short, X0, Y0);
                if (p.item && !p.done) {
                    var keys = Object.keys(ICON), ic = p.roll > 0 ? keys[Math.floor(clock * 16 + p.i) % keys.length] : p.item;
                    var bx = X0 + tw / 2 + 15, sc = p.roll > 0 ? 1 : pop(Math.min(1, (p.holdT - R.rollDur) * 3));
                    ctx.save(); ctx.translate(bx, Y0); ctx.scale(sc, sc); ctx.fillStyle = C.tag; ctx.strokeStyle = p.roll > 0 ? C.confetti[Math.floor(clock * 12) % 5] : ITEMCOL[p.item]; ctx.lineWidth = 2.5;
                    ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.fill(); ctx.stroke(); ctx.imageSmoothingEnabled = false; ctx.drawImage(ICON[ic], -9, -9, 18, 18); ctx.restore();
                    ctx.font = '700 11px ' + BODY; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                }
            });
            ctx.globalAlpha = 1;
            if (mode !== 'play') return;
            var warned = []; zaps.forEach(function (z) { warned.push(z.to); });
            if (f && f.st === 'fly') eagles.forEach(function (e) { if (e.x > f.x && e.x - f.x < 380 && Math.abs(e.a - f.a - 20) < 90 && warned.indexOf(f) < 0) warned.push(f); });
            warned.forEach(function (q) { if (!inX(q.x, 30) || q.done) return; exclaim(X(q.x) - 26, Y(q.a + R.wingY + 30)); });
            if (f && !f.done) eagles.forEach(function (e) {
                var ex = X(e.x); if (ex < W + 10 || ex > W + 700 * s) return;
                var Yy = clamp(Y(e.a), 30, H - 90); ctx.fillStyle = C.warn; ctx.beginPath(); ctx.arc(W - 22, Yy, 11, 0, 7); ctx.fill(); ctx.fillStyle = C.tag; ctx.font = '800 14px ' + BODY; ctx.fillText('!', W - 22, Yy + 0.5); ctx.font = '700 11px ' + BODY;
            });
            var r2, i;
            if (f && !f.done && (f.boost > 0 || f.rocket > 0 || f.angel > 0) && f.st === 'fly') {
                var n = f.rocket > 0 ? 26 : 16; r2 = mulberry32(Math.floor(clock * 20)); ctx.strokeStyle = f.angel > 0 ? 'rgba(' + C.halo + ',.6)' : C.speed; ctx.lineWidth = 2;
                for (i = 0; i < n; i++) { var yy = r2() * H, xx = r2() * W, len = 40 + r2() * (f.rocket > 0 ? 140 : 80); if (Math.abs(yy - Y(f.a + 40)) < 40) continue; ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx - len, yy); ctx.stroke(); }
            }
            if (f && f.th && f.st === 'fly' && f.va > 120) {
                r2 = mulberry32(Math.floor(clock * 24)); ctx.strokeStyle = 'rgba(' + C.wind + ',.6)'; ctx.lineWidth = 2;
                for (i = 0; i < 18; i++) { var x3 = r2() * W, y3 = r2() * H, len2 = 50 + r2() * 90; if (Math.abs(x3 - X(f.x)) < 40) continue; ctx.beginPath(); ctx.moveTo(x3, y3); ctx.lineTo(x3, y3 + len2); ctx.stroke(); }
            }
            if (f && f.inked > 0 && f.st === 'fly') {
                ctx.fillStyle = C.ink; ctx.globalAlpha = 0.6;
                [[0.03, 0.2, 34], [0.97, 0.3, 30], [0.05, 0.62, 28], [0.95, 0.66, 36]].forEach(function (q, j) {
                    var cx = q[0] * W, cy = q[1] * H, r0 = q[2]; ctx.beginPath(); ctx.arc(cx, cy, r0, 0, 7); ctx.fill();
                    for (var m = 0; m < 5; m++) { var a = m * 1.26 + j; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r0 * 1.25, cy + Math.sin(a) * r0 * 1.25, r0 * 0.22, 0, 7); ctx.fill(); }
                    ctx.fillRect(cx - 3, cy, 6, r0 * 0.6 + Math.min(R.inkDur, f.el) * 16);
                });
                ctx.globalAlpha = 1;
            }
            if (picked && phase === 'end') {   // 당첨 순간: 당첨 동물만 동그랗게 밝고 나머지는 어둡게
                var kq = clamp(endT / 0.4, 0, 1), cx2 = X(picked.x), cy3 = Y(picked.a + (picked.st === 'fly' ? 60 : 30));
                var g = ctx.createRadialGradient(cx2, cy3, 70, cx2, cy3, 170); g.addColorStop(0, 'rgba(' + C.spot + ',0)'); g.addColorStop(1, 'rgba(' + C.spot + ',' + (0.72 * kq).toFixed(2) + ')');
                ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
            }
            // 진행 막대: 절벽 → 섬, 동물 점
            var by = H - 24, x0 = 20, x1 = W - 20, a0 = LINE0 - LINE_GAP * 14, a1 = ISL1 + 300, mx = function (x) { return x0 + clamp((x - a0) / (a1 - a0), 0, 1) * (x1 - x0); };
            ctx.fillStyle = C.bar; rr(x0 - 8, by - 9, x1 - x0 + 16, 18, 9); ctx.fill();
            ctx.fillStyle = C.sand; ctx.fillRect(mx(ISL0), by - 3, mx(ISL1) - mx(ISL0), 6); ctx.fillStyle = C.zone; ctx.fillRect(mx(ISL0), by - 5, mx(ZONE_R) - mx(ISL0), 10); ctx.fillStyle = C.mat; ctx.fillRect(mx(TGT) - 1, by - 5, 3, 10);
            ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(mx(ISL0), by); ctx.stroke();
            ctx.fillStyle = C.sand; isles.forEach(function (q) { ctx.fillRect(mx(q.x), by - 3, Math.max(3, mx(q.x1) - mx(q.x)), 6); });
            ctx.fillStyle = 'rgba(' + C.therm + ',.9)'; therms.forEach(function (c) { var xx2 = mx(c.x); ctx.beginPath(); ctx.moveTo(xx2 - 3, by - 6); ctx.lineTo(xx2, by - 10); ctx.lineTo(xx2 + 3, by - 6); ctx.fill(); });
            players.slice().sort(function (a, b) { return (a === mine) - (b === mine); }).forEach(function (p) { ctx.beginPath(); ctx.arc(mx(p.x), by, p === mine ? 5.5 : 3.5, 0, 7); ctx.fillStyle = p.color; ctx.fill(); ctx.lineWidth = p === mine ? 2 : 1; ctx.strokeStyle = p === mine ? C.me : C.tagInk; ctx.stroke(); });
            var cl = camLabel();
            if (cl) {
                ctx.font = '800 12px ' + BODY; var tw2 = ctx.measureText(cl.text).width, bw = tw2 + 22, bx2 = W - 12 - bw, by2 = 50;
                ctx.fillStyle = cl.col || C.bar; rr(bx2, by2, bw, 24, 12); ctx.fill();
                ctx.fillStyle = C.tag; ctx.beginPath(); ctx.arc(bx2 + 10, by2 + 12, 3, 0, 7); ctx.fill();
                ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(cl.text, bx2 + 16, by2 + 12.5);
            }
            if (phase === 'count') big(String(Math.ceil(countT)), Math.min(110, W * 0.26), C.tag, H * 0.42);
            else if (phase === 'run' && t < 0.7) big('출발!', Math.min(64, W * 0.16), C.me, H * 0.42);
            if (f && phase !== 'count') {   // 따라가는 동물에게 일어난 일을 큰 글자로 잠깐
                var key = f.done ? 'done' : f.st === 'sea' ? 'sea' : f.st === 'runback' ? 'run' : f.over ? 'over' : f.st === 'tumble' ? 'tumble' : f.st === 'bubble' ? 'bubble' : f.st === 'isle' ? 'isle' : f.st === 'blast' ? 'blast' : f.th ? (f.th.big ? 'big' : 'therm') : '';
                if (f !== shout.p) { shout.p = f; shout.key = key; }
                else if (key !== shout.key) {
                    shout.key = key; var w = { done: '착지!', sea: '풍덩!', over: '못 멈춰!', tumble: '으악!', run: '뛰어!', bubble: '갇혔다!', isle: '쉬어 가자!', blast: '부스터!', therm: '쌩!', big: '슈우웅!' }[key];
                    if (w) { shout.text = w; shout.at = clock; }
                    if ((key === 'sea' || key === 'tumble' || key === 'done') && phase === 'run') { shakeAt = clock; slowUntil = clock + V.slowDur; }
                }
                var kk2 = (clock - shout.at) / V.shoutDur; if (kk2 < 1 && kk2 >= 0) { ctx.globalAlpha = 1 - kk2 * kk2; big(shout.text, Math.min(44, W * 0.11) + 10 * Math.sin(Math.min(1, kk2 * 4) * Math.PI), shout.text === '착지!' ? C.me : shout.text === '풍덩!' ? C.water : C.tag, H * 0.24); ctx.globalAlpha = 1; }
            }
        }

        function ranking() { return players.slice().sort(function (a, b) { return a.done && b.done ? a.rank - b.rank : a.done ? -1 : b.done ? 1 : Math.abs(TGT - a.x) - Math.abs(TGT - b.x) || a.i - b.i; }); }
        function hud() {
            if (!feedEl) return;
            while (feed.length && clock - feed[0].at > 2.4) { feed.shift(); feedDirty = true; }
            if (feedDirty) { feedDirty = false; feedEl.textContent = ''; feed.forEach(function (f) { var li = document.createElement('li'); li.textContent = f.text; if (f.mine) li.className = 'me'; feedEl.appendChild(li); }); }
            if (clock - hudAt < 0.25) return; hudAt = clock;
            var order = ranking(), m = meP();
            if (rankEl) { rankEl.hidden = !m || phase === 'count'; if (m) rankEl.textContent = (order.indexOf(m) + 1) + '등'; }
            if (boardEl && !boardEl.hidden) {
                order.forEach(function (p, k) {
                    var li = boardEl.children[k] || boardEl.appendChild(document.createElement('li'));
                    if (!li.firstChild) { li.appendChild(document.createElement('b')); li.appendChild(document.createElement('span')); }
                    li.className = (p === m ? 'me ' : '') + (p.done ? 'done' : ''); li.firstChild.style.background = p.color; li.lastChild.textContent = (k + 1) + ' ' + p.short + (p.done ? ' 착지' : '');
                });
                while (boardEl.children.length > order.length) boardEl.removeChild(boardEl.lastChild);
            }
        }

        // ── 재생 시계 ──
        function now() { return performance.now(); }
        function elapsed() { return (paused ? pauseAt : now()) - t0; }
        function raceReal() { return elapsed() - delay; }
        function reqFrame() { raf = requestAnimationFrame(loop); }
        function cancelFrame() { if (raf) cancelAnimationFrame(raf); raf = 0; }
        function play(delayMs) { delay = delayMs || 0; t0 = now(); paused = false; playing = true; endLoop = false; lastSim = -1; finaleFired = false; lastRender = now(); evIdx = 0; lag = 0; cancelFrame(); reqFrame(); }
        function stop() { playing = false; paused = false; endLoop = false; cancelFrame(); }
        function pause() { if (!playing || paused) return; pauseAt = now(); paused = true; cancelFrame(); drawAt(raceReal(), 0); }
        function resume() { if (!playing || !paused) return; t0 += now() - pauseAt; paused = false; lastRender = now(); reqFrame(); }
        function seek(ms) {
            if (!tl) return;
            endLoop = false; ms = clamp(ms, 0, tl.durationMs); lag = 0;
            if (!playing) { playing = true; paused = true; pauseAt = now(); }
            t0 = (paused ? pauseAt : now()) - delay - ms;
            evIdx = 0; while (evIdx < ev.length && ev[evIdx].t <= simAt(ms)) evIdx++;   // 건너뛴 사건 소리·소식은 내지 않는다
            drawAt(ms, 0, true);
        }
        function time() { return tl ? clamp(raceReal(), 0, tl.durationMs) : 0; }
        function simAt(rv) { return rv <= 0 ? 0 : Math.min(tl.simEndMs, JW.simTimeAt(rv, tl.slow)); }
        var camDt = 0;   // 카메라용 실제 경과(초) — 그림 시계(dt)는 0.1초로 자르지만 카메라는 자르지 않는다
        function drawAt(rReal, dt, snap) {
            clock += dt;
            // 큰 일 직후 잠깐 느리게(보는 속도만): 밀린 만큼(lag) 뒤에 1.25배로 따라잡는다 — 서버 종료 시각과 어긋나지 않게
            if (dt > 0 && rReal > 0) { if (clock < slowUntil) lag += dt * (1 - V.slowK) * 1000; else if (lag > 0) lag = Math.max(0, lag - dt * (V.slowRepay - 1) * 1000); }
            var rv = rReal - lag;
            if (rReal < 0) { phase = 'count'; countT = -rReal / 1000; }
            else phase = rv / 1000 >= decidedReal ? 'end' : 'run';
            endT = rv / 1000 - decidedReal;
            var sim = simAt(rv);
            buildAt(sim / 1000);
            if (phase === 'count') players.forEach(function (p) { p.st = 'line'; });
            players.forEach(function (p) { var prevX = p.px == null ? p.x : p.px; p.moving = Math.abs(p.x - prevX) > 0.3; if (p.moving) p.walkDir = p.x < prevX ? -1 : 1; p.px = p.x; });
            // 지난 사건 — 소리(쓰는 쪽 콜백)·소식 줄·선두 카메라 컷
            while (evIdx < ev.length && ev[evIdx].t <= sim) {
                var E = ev[evIdx++];
                feedEvent(E);
                if (E.type === 'use' && CUTK[E.item]) {
                    var P = players[E.who];
                    if (!followMe && !picked && !cut && phase === 'run' && clock - cutEnd > V.cutGap && P !== autoFocus()) cut = { p: P, k: E.item, obj: E.obj != null ? E.obj : null, to: E.to != null ? players[E.to] : null, t0: clock, x: P.x };
                }
                if (E.type === 'decided' && !finaleFired) { finaleFired = true; if (onFinaleCb) onFinaleCb(E); }
                if (onEventCb) onEventCb(E, players);
            }
            updateCam(camDt, snap); draw(); hud();
        }
        function loop() {
            raf = 0;
            if (mode === 'idle') { var tq = now(), d0 = Math.min(0.1, (tq - lastRender) / 1000); lastRender = tq; drawIdleScene(d0); reqFrame(); return; }
            if (endLoop && !playing && tl) { var tN = now(), d2 = Math.min(0.1, (tN - lastRender) / 1000); lastRender = tN; drawAt(tl.durationMs + lag, d2); reqFrame(); return; }
            if (!playing || paused) return;
            var tNow = now(), dt = Math.min(0.1, (tNow - lastRender) / 1000); camDt = Math.min(2, (tNow - lastRender) / 1000); lastRender = tNow;
            var rr0 = raceReal();
            drawAt(rr0, dt);
            if (tl && rr0 - lag >= tl.durationMs) { playing = false; endLoop = true; lastRender = now(); reqFrame(); return; }
            reqFrame();
        }
        function renderEnd() { if (!tl) return; stop(); lag = 0; evIdx = ev.length; drawAt(tl.durationMs, 0, true); }

        // ── 대기 화면: 절벽 위에 한 줄(준비 안 한 사람은 흐리게) ──
        function drawIdle(preview, myName) {
            mode = 'idle'; me = myName || ''; tl = null; stop();
            var list = preview && preview.players ? preview.players : [];
            var vr = mulberry32(4242);
            players = list.map(function (pl, i) {
                return { i: i, id: pl.id, name: pl.owner, short: shortName(pl.owner), animal: pl.creature, skin: pl.skin || null, color: COLORS[(pl.colorIdx != null ? pl.colorIdx : i) % COLORS.length], dim: !!pl.dim,
                    prepAt: V.prepAt[0] + vr() * (V.prepAt[1] - V.prepAt[0]), prepKind: Math.floor(vr() * 4),
                    x: LINE0 - i * LINE_GAP, a: CLIFF, st: 'line', va: 0, dir: 1, trail: [], anim: i * 0.37, done: false };
            });
            idle = { meP: players.filter(function (p) { return p.name === me; })[0] || null };
            rocks = []; storms = []; items = []; isles = []; therms = []; eagles = []; shots = []; mines = []; zaps = []; fx = []; picked = null; phase = 'idle'; t = 0;
            if (feedEl) feedEl.textContent = ''; if (rankEl) rankEl.hidden = true; if (boardEl) boardEl.hidden = true;
            updateCam(0, true); lastRender = now(); cancelFrame(); reqFrame();
        }
        function drawIdleScene(dt) {
            clock += dt || 0;
            players.forEach(function (p, i) { p.anim = clock + i * 0.37; });
            updateCam(dt || 0); ctx = main; draw();
        }
        function redraw() {
            if (!W) return;
            if (mode === 'idle') { drawIdleScene(0); return; }
            if (tl) drawAt(playing ? raceReal() : tl.durationMs, 0, true);
        }

        // 동물을 누르면 그 동물을 따라간다(선두 카메라일 때) — 내 카메라는 버튼으로
        canvas.addEventListener('click', function (e) {
            if (mode !== 'play' || phase !== 'run') return;
            var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = 48;
            players.forEach(function (p) { if (p.done) return; var d = Math.hypot(X(p.x) - x, Y(p.a + 30) - y); if (d < bd) { bd = d; best = p; } });
            if (best && !followMe) { cut = { p: best, k: null, obj: null, t0: clock + 1e6, x: best.x }; }   // 누른 동물에 머문다(다음 컷까지)
        });

        // 아이콘(선택 버튼·결과 카드·상점) — 시트 row 0 의 frame 칸
        function drawCreatureIcon(cv, creature, frame, skin) {
            var c = cv.getContext('2d'), im = sheetOf(creature, skin || null, '');
            var sk = skin ? image('creatures/' + creature + '-' + skin + '.webp') : null;
            if (sk && !sk.complete) sk.addEventListener('load', function () { drawCreatureIcon(cv, creature, frame, skin); }, { once: true });
            c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
            if (ok(im)) c.drawImage(im, (frame || 0) * CELL, 0, CELL, CELL, 0, 0, cv.width, cv.height);
            else if (!im.complete) im.addEventListener('load', function () { drawCreatureIcon(cv, creature, frame, skin); }, { once: true });
        }
        function drawBalloonIcon(cv, sprite) {   // 데구리 상점 카드의 야식 아이콘(js/deguri-shop.js) — 세로로 긴 셀(96×160)을 캔버스 높이에 맞춰 가운데
            var c = cv.getContext('2d'), im = image('accessories/' + sprite + '.webp');
            c.clearRect(0, 0, cv.width, cv.height);
            if (!ok(im)) { if (!im.complete) im.addEventListener('load', function () { drawBalloonIcon(cv, sprite); }, { once: true }); return; }
            var h = cv.height, w = h * 96 / 160; c.imageSmoothingEnabled = true; c.drawImage(im, 0, 0, 96, 160, (cv.width - w) / 2, 0, w, h);
        }

        resize();
        var api = {
            resize: resize, setTimeline: setTimeline, drawIdle: drawIdle, play: play, stop: stop, pause: pause, resume: resume, seek: seek, time: time,
            renderEnd: renderEnd, redraw: redraw,
            isPlaying: function () { return playing && !paused; }, isPaused: function () { return paused; },
            onFinale: function (fn) { onFinaleCb = fn; }, onEvent: function (fn) { onEventCb = fn; },
            hasCreatureSprite: function (c) { return ok(image('creatures/' + c + '.webp')); },
            drawCreatureIcon: drawCreatureIcon, drawBalloonIcon: drawBalloonIcon,
            setFollowMe: function (on) { followMe = !!on; cut = null; if (!playing || paused) redraw(); },   // 켜짐 = 내 카메라(기본), 꺼짐 = 선두 카메라 + 아이템 컷
            redrawIfIdle: function () { if (!playing || paused) redraw(); },
            // 테스트·측정용
            debug: function () { var m = meP() || (idle && idle.meP); return { mode: mode, phase: phase, t: t, camX: camX, W: W, H: H, s: s, me: m ? { x: m.x, a: m.a, sx: X(m.x), sy: Y(m.a), st: m.st } : null, lag: lag, focus: camFocus() ? camFocus().name : null }; }
        };
        if (!(opts && opts.offscreen)) instances.push(api);
        return api;
    }

    window.JammingRender = { create: create, loadAssets: loadAssets, COUNTDOWN_MS: COUNTDOWN_MS, COLORS: COLORS };
})();
