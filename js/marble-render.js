/* 마블런(marble) 캔버스 렌더러 + 재생기.
   소켓/DOM 상태 없음 — (타임라인, t) → 화면 의 순수 함수에 가깝다. js/marble.js 와 game-lab/marble-preview.html 이 공용.
   좌표계: 트랙 논리폭 800(서버 socket/marble-sim.js 와 동일), 카메라가 세로로 따라간다.
   에셋: 1차 배치(assets/marble/)는 스프라이트, 2차 미도착분은 ASSETS 값이 null → 코드 도형(라벨 포함)으로 그린다.
   2차 도착 시 ASSETS 의 null 만 경로로 바꾸면 된다 (로직 무변경).
   Math.random 0회 — 모든 흔들림/파티클은 t 에서 파생. */
var MarbleRender = (function () {
    'use strict';

    // ─── 공유 상수 (socket/marble-sim.js 와 동일 값) ───
    var TRACK_W = 800;
    var BALL_R = 14;
    var NAP_R = 17;
    var COUNTDOWN_MS = 4000;         // js/marble.js 카운트다운과 동일 — t<0 구간(서기 → 웅크림)
    var CURL_START_MS = -1100;       // 이 시각부터 curl 애니(4프레임 9fps ≈ 440ms) 후 공으로 대기
    var GATE_ANIM_MS = 400;          // 출발 빗장 올라가는 시간
    var BEE_MS = 1800;
    var MUD_DIZZY_MS = 1000;
    var BUMP_FX_MS = 380;
    var WAKE_FX_MS = 600;
    var MUD_FX_MS = 520;
    var DAM_FX_MS = 900;
    var POOF_FX_MS = 420;
    var LAST_ROLL_MS = 700;          // 마지막 공: 골 → 판자벽까지 굴러가는 시간
    // 카메라 (Marble Roulette 차용): 평소엔 선두를 따라가고, 남은 동물이 FINAL_K 이하가 되면 판정 대상(후미)으로 전환.
    // 골 앞 ZOOM_ZONE 안에 들어오면 줌인, 마지막 공은 서버가 준 slow 구간에서 슬로모.
    var CAM_LEAD = 0.22;             // 카메라 중심을 대상 공보다 아래(진행 방향)로 두는 비율(뷰 높이 기준)
    var CAM_SMOOTH = 6;              // /s
    var FINAL_K_MIN = 3, FINAL_K_RATIO = 0.1;
    var ZOOM_ZONE = 700;             // 골 앞 이 거리부터 줌인 시작
    var ZOOM_MAX = 1.7;
    var SRC_SCALE = 0.25;            // 4x 소스 → 표시
    var CELL = 160;                  // 동물 시트 셀
    var CHEER_ROWS = 12;
    var WALL_SCALE = 1.5;            // 울타리 스프라이트 확대(128×40 소스 → 48×15)
    var SEESAW_SCALE = 1.5;
    var BASKET_SCALE = 2;            // 골 바구니·판자벽 — 결승 채널(160)을 채우게

    // 24색 플레이어 링 팔레트 (참가자 순서 index) — spin-arena 24색과 동일 hue 분포
    var RING_COLORS = ['#e23b3b', '#3b82e2', '#2bb673', '#e2a23b', '#9b59e2', '#e23b8f', '#22c1d6', '#9ccf2f',
        '#4053d6', '#d63be2', '#b07033', '#aab6c4', '#3bc9a7', '#e6dfc8', '#5a6472', '#343344',
        '#ff7a1a', '#f2c014', '#8a8d2f', '#0e9488', '#5b3fd6', '#ff6f61', '#7d3a6a', '#46708f'];
    var CREATURE_NAMES = { hedgehog: '고슴도치', armadillo: '아르마딜로', pillbug: '공벌레', turtle: '거북이', panda: '판다' };

    // ─── 에셋 맵 (null = 2차 미도착 → 플레이스홀더) ───
    var A = '/assets/marble/';
    var ASSETS = {
        creatures: { hedgehog: A + 'creatures/hedgehog.png', armadillo: A + 'creatures/armadillo.png', pillbug: A + 'creatures/pillbug.png', turtle: A + 'creatures/turtle.png', panda: A + 'creatures/panda.png' },
        sleep: { hedgehog: null, armadillo: null, pillbug: null, turtle: null, panda: null },   // 2차: creatures/{id}-sleep.png (4×1, 160)
        pieces: {
            'start-platform-mid': A + 'pieces/start-platform-mid.png', 'start-platform-end': A + 'pieces/start-platform-end.png',
            'start-gate': A + 'pieces/start-gate.png', 'log-bumper': A + 'pieces/log-bumper.png', 'stake': A + 'pieces/stake.png',
            'seesaw-plank': A + 'pieces/seesaw-plank.png', 'seesaw-pivot': A + 'pieces/seesaw-pivot.png', 'mud-puddle': A + 'pieces/mud-puddle.png',
            'fence-mid': A + 'pieces/fence-mid.png', 'fence-post': A + 'pieces/fence-post.png',
            'goal-basket-back': A + 'pieces/goal-basket-back.png', 'goal-basket-front': A + 'pieces/goal-basket-front.png', 'dump-wall': A + 'pieces/dump-wall.png',
            'beehive': null, 'sun-patch': null, 'beaver-dam': null, 'beaver': null, 'pit': null, 'last-gate': null, 'flag': null   // 2차
        },
        stage: {
            'sky-far': A + 'stage/sky-far.png', 'meadow-tile': A + 'stage/meadow-tile.png',
            'tree': A + 'stage/decor-tree.png', 'bush-big': A + 'stage/decor-bush-big.png', 'bush-small': A + 'stage/decor-bush-small.png',
            'rock': A + 'stage/decor-rock.png', 'signpost': A + 'stage/decor-signpost.png',
            'flower-pink': A + 'stage/decor-flower-pink.png', 'flower-yellow': A + 'stage/decor-flower-yellow.png', 'flower-white': A + 'stage/decor-flower-white.png'
        },
        fx: {
            'dust-puff': A + 'fx/dust-puff.png', 'impact-star': A + 'fx/impact-star.png', 'mud-splash': A + 'fx/mud-splash.png', 'curl-poof': A + 'fx/curl-poof.png',
            'bee-swarm': null, 'zz': null, 'wake': null, 'dam-burst': null, 'cheer': null   // 2차
        }
    };
    // 4열×1행 fx 아틀라스 셀 크기(소스) — 2차분은 의뢰서 규격
    var FX_CELL = { 'dust-puff': [80, 80], 'impact-star': [96, 96], 'mud-splash': [128, 96], 'curl-poof': [96, 96],
        'bee-swarm': [128, 96], 'zz': [48, 48], 'wake': [48, 48], 'dam-burst': [192, 128], 'cheer': [96, 96] };
    var DECOR_SIZE = { tree: [160, 224], 'bush-big': [128, 96], 'bush-small': [64, 48], rock: [64, 48], signpost: [64, 96],
        'flower-pink': [32, 32], 'flower-yellow': [32, 32], 'flower-white': [32, 32] };

    var images = {};      // key → HTMLImageElement | null(실패/미정)
    var loadStarted = false;
    function imgKey(group, name) { return group + ':' + name; }
    function img(group, name) { var im = images[imgKey(group, name)]; return (im && im.complete && im.naturalWidth > 0) ? im : null; }
    function loadAll(onDone) {
        if (loadStarted) { if (onDone) onDone(); return; }
        loadStarted = true;
        var pending = 0;
        Object.keys(ASSETS).forEach(function (group) {
            Object.keys(ASSETS[group]).forEach(function (name) {
                var src = ASSETS[group][name];
                if (!src) { images[imgKey(group, name)] = null; return; }
                var im = new Image();
                pending++;
                im.onload = im.onerror = function () { pending--; if (pending === 0 && onDone) onDone(); };
                im.src = src;
                images[imgKey(group, name)] = im;
            });
        });
        if (pending === 0 && onDone) onDone();
    }

    function lerp(a, b, k) { return a + (b - a) * k; }
    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    function gateIsOpen(g, t) { var c = g.openMs + g.closedMs; var m = ((t + g.phaseMs) % c + c) % c; return m < g.openMs; }
    function seesawAngle(s, t) { return (s.amp * Math.PI / 180) * Math.sin(2 * Math.PI * t / s.period); }
    // 결정론 해시(파티클 분산용 — Math.random 대체)
    function hash01(n) { var x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }

    // ═══════════════════════════════════════════════════════
    // 렌더러 인스턴스
    // ═══════════════════════════════════════════════════════
    function create(canvas) {
        var ctx = canvas.getContext('2d');
        var R = {};
        var data = null;          // reveal 페이로드
        var balls = [];           // 렌더 상태(회전각·마지막 위치)
        var byId = {};
        var evCursor = 0;         // events 처리 커서 (t 단조 증가 가정, seek 시 리셋)
        var lastT = -1;
        var myName = '';
        var phase = 'idle';       // idle | countdown | play | finale | done
        var cam = { x: TRACK_W / 2, y: 0, zoom: 1, init: false, mode: 'lead' };
        var view = { w: TRACK_W, h: 600, scale: 1 };
        var pieces = {};          // kind → 조각 배열
        var fxList = [];          // { type, x, y, t0, dur, ball? }
        var lastFrameWall = 0;
        var startWall = 0;        // 재생 기준 performance.now()
        var rafId = null;
        var hudInfo = { remaining: 0, worst: [] };
        var onFinaleCb = null;

        R.loadAssets = loadAll;
        R.debug = function () { return { cam: cam, view: view, phase: phase, fx: fxList.length, evCursor: evCursor, simT: data && simTime(lastT) }; };

        // 캔버스 크기 → 논리 뷰
        R.resize = function () {
            var box = canvas.parentElement;
            var cssW = box ? box.clientWidth : canvas.clientWidth;
            if (!cssW) cssW = TRACK_W;   // display:none 상태(대기 중) — 0폭이면 논리폭으로 (NaN 방지)
            var cssH;
            var fs = document.fullscreenElement && (document.fullscreenElement === box || document.fullscreenElement === canvas);
            if (fs) { cssW = window.innerWidth; cssH = window.innerHeight; }
            else { cssH = Math.round(cssW < 600 ? cssW * 1.25 : cssW * 0.72); }
            var dpr = Math.min(2, window.devicePixelRatio || 1);
            canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
            canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
            view.scale = canvas.width / TRACK_W;
            view.w = TRACK_W; view.h = canvas.height / view.scale;
        };

        R.setTimeline = function (payload, me) {
            data = payload; myName = me || '';
            balls = payload.balls.map(function (b) { return { id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num,
                x: 0, y: 0, angle: 0, state: 'roll', stateAt: 0, dizzyUntil: 0, muddy: false, squashUntil: 0, finishIdx: -1, finishAt: 0, napAt: 0 }; });
            byId = {}; balls.forEach(function (b) { byId[b.id] = b; });
            pieces = {}; payload.track.pieces.forEach(function (p) { (pieces[p.kind] = pieces[p.kind] || []).push(p); });
            evCursor = 0; lastT = -1; fxList = []; cam.init = false;
            hudInfo = { remaining: balls.length, worst: [] };
            R.resize();
        };
        R.setPhase = function (p) { phase = p; };
        R.onFinale = function (cb) { onFinaleCb = cb; };

        // ─── 재생 ───
        R.play = function (countdownMs) {
            startWall = performance.now() + (countdownMs == null ? COUNTDOWN_MS : countdownMs);
            phase = 'countdown';
            lastFrameWall = performance.now();
            if (rafId) cancelAnimationFrame(rafId);
            var loop = function () {
                var now = performance.now();
                var t = now - startWall;
                R.render(t, (now - lastFrameWall) / 1000);
                lastFrameWall = now;
                rafId = requestAnimationFrame(loop);
            };
            rafId = requestAnimationFrame(loop);
        };
        R.stop = function () { if (rafId) cancelAnimationFrame(rafId); rafId = null; };
        R.isPlaying = function () { return !!rafId; };

        // ─── 이벤트 → 공 상태 (t 까지) ───
        function applyEventsUpTo(t) {
            if (!data) return;
            if (t < lastT) { evCursor = 0; fxList = []; balls.forEach(function (b) { b.state = 'roll'; b.finishIdx = -1; b.muddy = false; b.dizzyUntil = 0; }); }
            var ev = data.events;
            while (evCursor < ev.length && ev[evCursor].t <= t) {
                var e = ev[evCursor++];
                var b = e.ball != null ? byId[e.ball] : null;
                switch (e.type) {
                    case 'nap': b.state = 'nap'; b.napAt = e.t; break;
                    case 'wake': if (b.state !== 'done') { b.state = 'roll'; } fxList.push({ type: 'wake', ball: b.id, t0: e.t, dur: WAKE_FX_MS }); break;
                    case 'pitFall': b.state = 'pit'; fxList.push({ type: 'dust', ball: b.id, t0: e.t, dur: POOF_FX_MS }); break;
                    case 'pitRise': break;
                    case 'mud': b.state = 'mud'; b.muddy = true; fxList.push({ type: 'mud', ball: b.id, t0: e.t, dur: MUD_FX_MS }); break;
                    case 'mudEnd': b.state = 'roll'; b.dizzyUntil = e.t + MUD_DIZZY_MS; break;
                    case 'bump': fxList.push({ type: 'star', x: e.x, y: e.y, t0: e.t, dur: BUMP_FX_MS }); if (b) b.squashUntil = e.t + 160; break;
                    case 'bees': fxList.push({ type: 'bees', t0: e.t, dur: BEE_MS }); break;
                    case 'damCrack': break;
                    case 'damBurst': fxList.push({ type: 'damburst', t0: e.t, dur: DAM_FX_MS }); break;
                    case 'finish':
                        b.state = 'done'; b.finishAt = e.t; b.finishIdx = data.finishOrder.indexOf(b.id);
                        fxList.push({ type: 'poof', ball: b.id, x: b.x, y: data.track.goalY, t0: e.t, dur: POOF_FX_MS });
                        break;
                }
            }
            lastT = t;
            // 만료 fx 정리
            fxList = fxList.filter(function (f) { return t - f.t0 < f.dur; });
        }

        // ─── 위치 보간 ───
        function samplePositions(t) {
            var fr = data.frames, s = data.sampleMs;
            var k = Math.floor(t / s);
            if (t <= 0 || k < 0) { k = 0; }
            var k1 = Math.min(fr.length - 1, k), k2 = Math.min(fr.length - 1, k + 1);
            var f1 = fr[k1], f2 = fr[k2];
            var a = (k2 === k1 || t <= 0) ? 0 : clamp((t - k1 * s) / s, 0, 1);
            for (var i = 0; i < balls.length; i++) {
                var b = balls[i];
                var x1 = f1[i * 2], y1 = f1[i * 2 + 1], x2 = f2[i * 2], y2 = f2[i * 2 + 1];
                if (x1 < 0) continue;                // 이미 도착 — 마지막 위치 유지
                if (x2 < 0) { x2 = x1; y2 = y1; }
                var nx = lerp(x1, x2, a), ny = lerp(y1, y2, a);
                if (b.state === 'roll') {
                    var dx = nx - b.x, dy = ny - b.y;
                    if (Math.abs(dx) + Math.abs(dy) < 200) b.angle += (dx * 0.6 + dy) / BALL_R;   // 진행 방향 회전(시각)
                }
                b.x = nx; b.y = ny;
            }
        }

        // ─── 카메라 ───
        function updateCamera(t, dt) {
            var goalY = data.track.goalY;
            var focus = null, remaining = 0, lead = null, rear = null;
            for (var i = 0; i < balls.length; i++) {
                var b = balls[i]; if (b.state === 'done') continue;
                remaining++;
                if (!lead || b.y > lead.y) lead = b;
                if (!rear || b.y < rear.y) rear = b;
            }
            var finalK = Math.max(FINAL_K_MIN, Math.ceil(balls.length * FINAL_K_RATIO));
            cam.mode = remaining <= finalK ? 'rear' : 'lead';
            focus = cam.mode === 'rear' ? rear : lead;
            var targetY, targetX = TRACK_W / 2, targetZoom = 1;
            if (t < 0) targetY = data.track.startY * 0.5 + 60;
            else if (!focus) { targetY = goalY + 40; targetX = TRACK_W / 2; targetZoom = ZOOM_MAX * 0.8; }
            else {
                targetY = focus.y + view.h * CAM_LEAD;
                var k = clamp((focus.y - (goalY - ZOOM_ZONE)) / ZOOM_ZONE, 0, 1);
                targetZoom = 1 + (ZOOM_MAX - 1) * k;
                if (targetZoom > 1.01) { targetX = focus.x; targetY = focus.y + view.h * CAM_LEAD / targetZoom; }
            }
            var minY = data.track.startY + view.h / 2 - 140, maxY = data.track.endY - view.h / 2 + 20;   // 출발대 위 140px(하늘 띠)까지
            targetY = clamp(targetY, minY, maxY);
            var halfW = view.w / 2 / targetZoom;
            targetX = clamp(targetX, halfW, TRACK_W - halfW);
            if (!cam.init) { cam.y = targetY; cam.x = targetX; cam.zoom = targetZoom; cam.init = true; }
            else {
                var k2 = Math.min(1, dt * CAM_SMOOTH);
                cam.y += (targetY - cam.y) * k2; cam.x += (targetX - cam.x) * k2; cam.zoom += (targetZoom - cam.zoom) * Math.min(1, dt * 2.5);
            }
        }
        // 재생 시각(벽시계) → 시뮬 시각: 서버 slow 구간에서 rate 배 느리게 (서버 durationMs 와 같은 식)
        function simTime(tPlay) {
            var sl = data.slow;
            if (!sl || tPlay <= sl.startMs) return tPlay;
            var slowPlayLen = (sl.endMs - sl.startMs) / sl.rate;
            if (tPlay <= sl.startMs + slowPlayLen) return sl.startMs + (tPlay - sl.startMs) * sl.rate;
            return sl.endMs + (tPlay - sl.startMs - slowPlayLen);
        }

        // ─── 그리기 유틸 ───
        function toScreenY(y) { return y - cam.y + view.h / 2; }
        function visible(y, margin) { var sy = toScreenY(y); return sy > -margin && sy < view.h + margin; }
        function drawSprite(group, name, x, y, w, h, opt) {
            // x,y = 표시 좌표(월드), w,h = 소스 크기. opt: {sx,sy,sw,sh, anchor:'bottom'|'center', rot, alpha}
            var im = img(group, name); if (!im) return false;
            opt = opt || {};
            var sx = opt.sx || 0, sy = opt.sy || 0, sw = opt.sw || w, sh = opt.sh || h;
            var k = SRC_SCALE * (opt.scale || 1);
            var dw = sw * k, dh = sh * k;
            var ox = -dw / 2, oy = opt.anchor === 'bottom' ? -dh : -dh / 2;
            ctx.save();
            ctx.translate(x, toScreenY(y));
            if (opt.rot) ctx.rotate(opt.rot);
            if (opt.alpha != null) ctx.globalAlpha = opt.alpha;
            ctx.drawImage(im, sx, sy, sw, sh, ox, oy, dw, dh);
            ctx.restore();
            return true;
        }
        function label(text, x, y, color, size) {
            ctx.save();
            ctx.font = 'bold ' + (size || 11) + 'px "Jua", sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.fillStyle = color || '#fff';
            ctx.strokeText(text, x, toScreenY(y)); ctx.fillText(text, x, toScreenY(y));
            ctx.restore();
        }
        function roundRect(x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
        }

        // ─── 배경 ───
        function drawBackground(t) {
            var sky = img('stage', 'sky-far');
            if (sky) {
                // 1920×1080 을 뷰 폭에 맞춰, 카메라의 10% 만 따라감
                var sc = view.w / 1920 * 1.0; var dh = 1080 * sc;
                var off = -((cam.y * 0.08) % dh);
                ctx.drawImage(sky, -view.w / 2, off - dh, view.w * 2, dh * 2); ctx.drawImage(sky, -view.w / 2, off + dh, view.w * 2, dh * 2);
            } else {
                var g = ctx.createLinearGradient(0, 0, 0, view.h);
                g.addColorStop(0, '#9fd8ff'); g.addColorStop(1, '#dff3ff');
                ctx.fillStyle = g; ctx.fillRect(-view.w, -view.h, view.w * 3, view.h * 3);
            }
            // 초원은 출발대 위 80px 부터 — 그 위로는 하늘·먼 산이 보인다
            var tile = img('stage', 'meadow-tile');
            var ts = 1024 * SRC_SCALE;
            var topY = toScreenY(data.track.startY - 30);
            // 줌 시 가로 초점이 움직여도 빈 곳이 없도록 트랙 폭 밖으로 한 타일씩 더 깐다
            var y0 = toScreenY(Math.floor(cam.y / ts) * ts - ts * 2);
            ctx.save(); ctx.beginPath(); ctx.rect(-ts, Math.max(0, topY), view.w + ts * 2, view.h); ctx.clip();
            if (tile) {
                for (var y = y0; y < view.h + ts; y += ts) for (var x = -ts; x < view.w + ts; x += ts) ctx.drawImage(tile, x, y, ts, ts);
            } else {
                ctx.fillStyle = '#8fd07a'; ctx.fillRect(-ts, 0, view.w + ts * 2, view.h);
            }
            ctx.restore();
        }

        // ─── 트랙 조각 ───
        function drawWall(w) {
            var len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1), ang = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
            var fence = img('pieces', 'fence-mid');
            ctx.save();
            ctx.translate(w.x1, toScreenY(w.y1)); ctx.rotate(ang);
            if (fence) {
                var seg = 128 * SRC_SCALE * WALL_SCALE, fh = 40 * SRC_SCALE * WALL_SCALE;
                for (var d = 0; d < len; d += seg) ctx.drawImage(fence, 0, 0, 128 * Math.min(1, (len - d) / seg), 40, d, -fh / 2, Math.min(seg, len - d), fh);
            } else {
                ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 6; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
            }
            ctx.restore();
            var post = img('pieces', 'fence-post');
            if (post) { drawSprite('pieces', 'fence-post', w.x1, w.y1 + 6, 24, 56, { anchor: 'bottom', scale: WALL_SCALE }); drawSprite('pieces', 'fence-post', w.x2, w.y2 + 6, 24, 56, { anchor: 'bottom', scale: WALL_SCALE }); }
        }
        function placeholderBox(x, y, w, h, fill, stroke, text, radius) {
            ctx.save();
            ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
            roundRect(x, toScreenY(y), w, h, radius || 8); ctx.fill(); ctx.stroke();
            ctx.restore();
            if (text) label(text, x + w / 2, y + h / 2, '#fff', 13);
        }
        function drawPieces(t) {
            var k, i, p;
            // 출발대
            (pieces.platform || []).forEach(function (pl) {
                var z = pl.zone; if (!visible(z.y + z.h / 2, z.h)) return;
                var mid = img('pieces', 'start-platform-mid');
                if (mid) { var seg = 128 * SRC_SCALE; for (var x = z.x; x < z.x + z.w; x += seg) { for (var y = z.y; y < z.y + z.h; y += 96 * SRC_SCALE) ctx.drawImage(mid, 0, 0, 128, 96, x, toScreenY(y), seg, 24); } }
                else placeholderBox(z.x, z.y, z.w, z.h, 'rgba(160,110,60,0.85)', '#6b4420', '출발대');
            });
            (pieces.sunpatch || []).forEach(function (s) {
                var z = s.zone; if (!visible(z.y + z.h / 2, z.h)) return;
                if (!drawSprite('pieces', 'sun-patch', z.x + z.w / 2, z.y + z.h / 2, 256, 128)) {
                    var g = ctx.createRadialGradient(z.x + z.w / 2, toScreenY(z.y + z.h / 2), 20, z.x + z.w / 2, toScreenY(z.y + z.h / 2), z.w / 2);
                    g.addColorStop(0, 'rgba(255,240,150,0.75)'); g.addColorStop(1, 'rgba(255,240,150,0)');
                    ctx.fillStyle = g; ctx.fillRect(z.x, toScreenY(z.y), z.w, z.h);
                    label('☀ 햇볕 잔디 — 느려지면 잠들어요', z.x + z.w / 2, z.y + 18, '#fff7c0', 13);
                }
            });
            (pieces.pit || []).forEach(function (pt) {
                var z = pt.zone; if (!visible(z.y + z.h / 2, z.h)) return;
                if (!drawSprite('pieces', 'pit', z.x + z.w / 2, z.y + z.h / 2, 480, 160)) placeholderBox(z.x, z.y, z.w, z.h, 'rgba(70,45,25,0.9)', '#3b2412', '구덩이', 14);
            });
            (pieces.mud || []).forEach(function (m) {
                if (!visible(m.y, 60)) return;
                if (!drawSprite('pieces', 'mud-puddle', m.x, m.y, 192, 80, { scale: m.rx * 2 / (192 * SRC_SCALE) })) {
                    ctx.save(); ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.ellipse(m.x, toScreenY(m.y), m.rx, m.ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
                }
            });
            (pieces.wall || []).forEach(function (w) { if (visible((w.y1 + w.y2) / 2, Math.abs(w.y2 - w.y1) / 2 + 40)) drawWall(w); });
            (pieces.stake || []).forEach(function (s) {
                if (!visible(s.y, 20)) return;
                if (!drawSprite('pieces', 'stake', s.x, s.y, 32, 32, { scale: s.r * 2 / (32 * SRC_SCALE) })) { ctx.fillStyle = '#7a4d22'; ctx.beginPath(); ctx.arc(s.x, toScreenY(s.y), s.r, 0, Math.PI * 2); ctx.fill(); }
            });
            (pieces.log || []).forEach(function (s) {
                if (!visible(s.y, 30)) return;
                if (!drawSprite('pieces', 'log-bumper', s.x, s.y, 96, 96, { scale: s.r * 2 / (96 * SRC_SCALE) })) { ctx.fillStyle = '#a06a35'; ctx.beginPath(); ctx.arc(s.x, toScreenY(s.y), s.r, 0, Math.PI * 2); ctx.fill(); }
            });
            (pieces.seesaw || []).forEach(function (s) {
                if (!visible(s.y, 60)) return;
                var ang = seesawAngle(s, Math.max(0, t));
                if (!drawSprite('pieces', 'seesaw-pivot', s.x, s.y + 6, 48, 40, { anchor: 'bottom', scale: SEESAW_SCALE })) { ctx.fillStyle = '#6b4420'; ctx.beginPath(); ctx.moveTo(s.x - 8, toScreenY(s.y) + 6); ctx.lineTo(s.x + 8, toScreenY(s.y) + 6); ctx.lineTo(s.x, toScreenY(s.y) - 4); ctx.fill(); }
                if (!drawSprite('pieces', 'seesaw-plank', s.x, s.y, 224, 24, { rot: ang, scale: s.len / (224 * SRC_SCALE) })) {
                    ctx.save(); ctx.translate(s.x, toScreenY(s.y)); ctx.rotate(ang); ctx.fillStyle = '#b07a3a'; ctx.fillRect(-s.len / 2, -3, s.len, 6); ctx.restore();
                }
            });
            (pieces.beehive || []).forEach(function (h) {
                if (!visible(h.y, 60)) return;
                var shaking = fxList.some(function (f) { return f.type === 'bees'; });
                var wob = shaking ? Math.sin(t / 40) * 0.12 : 0;
                if (!drawSprite('pieces', 'beehive', h.x, h.y, 96, 128, { sx: shaking ? 96 : 0, sw: 96, rot: wob })) {
                    ctx.save(); ctx.translate(h.x, toScreenY(h.y)); ctx.rotate(wob);
                    ctx.fillStyle = '#e0a52a'; ctx.beginPath(); ctx.ellipse(0, 0, 16, 20, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = '#8a5f10'; ctx.lineWidth = 2; for (var yy = -12; yy <= 12; yy += 8) { ctx.beginPath(); ctx.moveTo(-14, yy); ctx.lineTo(14, yy); ctx.stroke(); }
                    ctx.restore();
                    label('벌집', h.x, h.y + 30, '#fff', 12);
                }
            });
            (pieces.dam || []).forEach(function (d) {
                if (!visible(d.y1, 60)) return;
                var burst = fxList.some(function (f) { return f.type === 'damburst'; });
                var st = data.events.some(function (e) { return e.type === 'damBurst' && e.t <= t; }) ? 2 : (data.events.some(function (e) { return e.type === 'damCrack' && e.t <= t; }) ? 1 : 0);
                var cx = (d.x1 + d.x2) / 2, w = d.x2 - d.x1;
                if (st < 2 || burst) {
                    if (!drawSprite('pieces', 'beaver-dam', cx, d.y1 + 10, 480, 256, { sx: st * 480, sw: 480, anchor: 'bottom', alpha: burst ? 0.5 : 1 })) {
                        ctx.save(); ctx.globalAlpha = burst ? 0.4 : 1;
                        for (var li = 0; li < 4; li++) { ctx.fillStyle = li % 2 ? '#9c6a3a' : '#7d5330'; roundRect(d.x1 + 2, toScreenY(d.y1) - 6 - li * 9, w - 4, 8, 4); ctx.fill(); }
                        if (st === 1) { ctx.strokeStyle = '#3aa0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 6, toScreenY(d.y1) - 40); ctx.lineTo(cx + 4, toScreenY(d.y1) - 20); ctx.lineTo(cx - 2, toScreenY(d.y1)); ctx.stroke(); }
                        ctx.restore();
                        label(st === 1 ? '비버 댐 — 금이 간다!' : '비버 댐', cx, d.y1 - 52, '#fff', 12);
                    }
                }
                if (!drawSprite('pieces', 'beaver', d.beaverX, d.y1 - 40, 96, 96, { sx: st > 0 ? 96 : 0, sw: 96, anchor: 'bottom' })) {
                    ctx.fillStyle = '#6b4423'; ctx.beginPath(); ctx.ellipse(d.beaverX, toScreenY(d.y1) - 48, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
                    if (st > 0) label('!', d.beaverX, d.y1 - 68, '#fff', 14);
                }
            });
            (pieces.gate || []).forEach(function (g) {
                if (!visible(g.y1, 60)) return;
                var open = gateIsOpen(g, Math.max(0, t));
                var cyc = g.openMs + g.closedMs, m = ((Math.max(0, t) + g.phaseMs) % cyc + cyc) % cyc;
                var prog = open ? clamp(m / 250, 0, 1) : clamp(1 - (m - g.openMs) / 250, 0, 1);   // 0 닫힘 → 1 열림
                var frame = Math.round(prog * 3);
                var cx = (g.x1 + g.x2) / 2, w = g.x2 - g.x1;
                var drawn = false;
                if (img('pieces', 'last-gate')) { for (var x = g.x1; x < g.x2; x += 32) drawSprite('pieces', 'last-gate', x + 16, g.y1 + 8, 128, 96, { sx: frame * 128, sw: 128, anchor: 'bottom' }); drawn = true; }
                if (!drawn) {
                    var h = 22 * (1 - prog);
                    ctx.fillStyle = '#c99a5b'; ctx.fillRect(g.x1, toScreenY(g.y1) - h, w, Math.max(4, h));
                    ctx.fillStyle = '#6b4420'; ctx.fillRect(g.x1 - 4, toScreenY(g.y1) - 30, 6, 36); ctx.fillRect(g.x2 - 2, toScreenY(g.y1) - 30, 6, 36);
                    label(open ? '마지막 문 — 열림' : '마지막 문 — 닫힘!', cx, g.y1 - 40, open ? '#c8ffc8' : '#ffd0d0', 12);
                }
            });
            (pieces.startGate || []).forEach(function (g) {
                if (!visible(g.y1, 40)) return;
                var prog = t <= 0 ? 0 : clamp(t / GATE_ANIM_MS, 0, 1);
                var frame = Math.round(prog * 3);
                var w = g.x2 - g.x1;
                if (img('pieces', 'start-gate')) { for (var x = g.x1; x < g.x2; x += 32) drawSprite('pieces', 'start-gate', x + 16, g.y1, 128, 48, { sx: frame * 128, sw: 128 }); }
                else if (prog < 1) { ctx.fillStyle = '#b8863b'; ctx.fillRect(g.x1, toScreenY(g.y1) - 4 - prog * 20, w, 6); }
            });
            (pieces.basket || []).forEach(function (bk) {
                if (!visible(bk.y, 80)) return;
                if (!drawSprite('pieces', 'goal-basket-back', bk.x, bk.y + 20, 320, 160, { anchor: 'bottom', scale: BASKET_SCALE })) placeholderBox(bk.x - 80, bk.y - 30, 160, 50, '#c9a26a', '#7d5330', '골');
            });
            (pieces.decor || []).forEach(function (d) {
                if (!visible(d.y, 80)) return;
                var sz = DECOR_SIZE[d.decor] || [64, 64];
                if (!drawSprite('stage', d.decor, d.x, d.y, sz[0], sz[1], { anchor: 'bottom' })) { ctx.fillStyle = '#4f9d4a'; ctx.beginPath(); ctx.arc(d.x, toScreenY(d.y) - 8, 10, 0, Math.PI * 2); ctx.fill(); }
            });
        }
        function drawBasketFront() {
            (pieces.basket || []).forEach(function (bk) {
                if (!visible(bk.y, 80)) return;
                drawSprite('pieces', 'goal-basket-front', bk.x, bk.y + 20, 320, 120, { anchor: 'bottom', scale: BASKET_SCALE });
            });
            (pieces.dumpwall || []).forEach(function (d) {
                if (!visible(d.y, 60)) return;
                if (!drawSprite('pieces', 'dump-wall', d.x, d.y + 30, 96, 160, { anchor: 'bottom', scale: BASKET_SCALE })) placeholderBox(d.x - 40, d.y - 10, 80, 20, '#8a6a4a', '#4a3420', '끝', 4);
            });
        }

        // ─── 동물 ───
        function ringColor(b) { return RING_COLORS[b.colorIdx % RING_COLORS.length]; }
        function drawCreatureFrame(b, row, col, x, y, rot, scale) {
            var im = img('creatures', b.creature);
            var sc = (scale || 1) * SRC_SCALE;
            if (im) {
                ctx.save(); ctx.translate(x, toScreenY(y)); if (rot) ctx.rotate(rot);
                ctx.drawImage(im, col * CELL, row * CELL, CELL, CELL, -CELL * sc / 2, -CELL * sc / 2, CELL * sc, CELL * sc);
                ctx.restore();
            } else {
                ctx.fillStyle = '#c8b28c'; ctx.beginPath(); ctx.arc(x, toScreenY(y), BALL_R, 0, Math.PI * 2); ctx.fill();
            }
        }
        function drawRing(b, x, y, r, strong) {
            ctx.save();
            ctx.strokeStyle = ringColor(b); ctx.lineWidth = strong ? 4 : 2.5; ctx.globalAlpha = strong ? 1 : 0.85;
            if (strong) { ctx.shadowColor = ringColor(b); ctx.shadowBlur = 8; }
            ctx.beginPath(); ctx.arc(x, toScreenY(y), r, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
            // 숫자 배지
            ctx.save();
            ctx.fillStyle = ringColor(b); ctx.beginPath(); ctx.arc(x + r * 0.75, toScreenY(y) - r * 0.75, 6.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(b.num), x + r * 0.75, toScreenY(y) - r * 0.75 + 0.5);
            ctx.restore();
        }
        function drawShadow(x, y, r) { ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(x, toScreenY(y) + r * 0.75, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }

        function drawBalls(t) {
            var i, b, mine;
            // 그림자 먼저
            for (i = 0; i < balls.length; i++) { b = balls[i]; if (b.state === 'done' || !visible(b.y, 40)) continue; drawShadow(b.x, b.y, b.state === 'roll' ? BALL_R : NAP_R); }
            // 후미 공(플레이어별) — 꼴찌 깃발 대상
            var rearByOwner = {};
            for (i = 0; i < balls.length; i++) { b = balls[i]; if (b.state === 'done') continue; if (!rearByOwner[b.owner] || b.y < rearByOwner[b.owner].y) rearByOwner[b.owner] = b; }
            for (i = 0; i < balls.length; i++) {
                b = balls[i];
                if (b.state === 'done' || !visible(b.y, 40)) continue;
                mine = b.owner === myName;
                if (t < 0) {
                    // 카운트다운: 서 있음 → 웅크림
                    if (t < CURL_START_MS) drawCreatureFrame(b, 0, Math.floor((t + 100000) / 140) % 4, b.x, b.y + 8);
                    else { var cf = Math.min(3, Math.floor((t - CURL_START_MS) / 110)); drawCreatureFrame(b, 1, cf, b.x, b.y + (cf === 3 ? 0 : 8)); }
                    drawRing(b, b.x, b.y, BALL_R + 3, mine);
                    continue;
                }
                if (b.state === 'nap' || b.state === 'pit') {
                    // 잠든 포즈 — 2차 sleep 스트립 없으면 1차 faceplant col 2(엎어짐) 프레임
                    var sl = img('sleep', b.creature);
                    if (sl) { var sf = Math.floor(t / 400) % 2; ctx.save(); ctx.translate(b.x, toScreenY(b.y)); ctx.drawImage(sl, sf * CELL, 0, CELL, CELL, -20, -22, 40, 40); ctx.restore(); }
                    else drawCreatureFrame(b, 4, 2, b.x, b.y - 4);
                    drawRing(b, b.x, b.y, NAP_R + 2, mine);
                    // zz
                    var zt = (t - b.napAt) % 900; var zy = b.y - 20 - zt / 45; var za = 1 - zt / 900;
                    if (!img('fx', 'zz')) label(zt < 450 ? 'z' : 'Z', b.x + 14, zy, 'rgba(255,255,255,' + za.toFixed(2) + ')', 12);
                    else drawSprite('fx', 'zz', b.x + 14, zy, 48, 48, { sx: Math.floor(zt / 225) * 48, sw: 48, alpha: za });
                    continue;
                }
                if (b.state === 'mud') { drawCreatureFrame(b, 2, 3, b.x, b.y); drawRing(b, b.x, b.y, BALL_R + 3, mine); continue; }
                var col = 0;
                if (t < b.squashUntil) col = 1; else if (t < b.dizzyUntil) col = 3; else if (b.muddy) col = 2;
                drawCreatureFrame(b, 2, col, b.x, b.y, col === 1 ? 0 : b.angle);
                drawRing(b, b.x, b.y, BALL_R + 3, mine);
            }
            // 깃발 + 내 이름표
            Object.keys(rearByOwner).forEach(function (owner) {
                var rb = rearByOwner[owner]; if (!visible(rb.y, 60) || t < 0) return;
                var fx = rb.x + 10, fy = rb.y - 24;
                var wave = Math.sin(t / 120 + rb.id) * 2;
                if (!drawSprite('pieces', 'flag', fx + 4, fy, 32, 64, { sx: Math.floor(t / 200) % 2 * 32, sw: 32 })) {
                    ctx.save(); ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(fx, toScreenY(fy)); ctx.lineTo(fx, toScreenY(fy) + 20); ctx.stroke();
                    ctx.fillStyle = ringColor(rb); ctx.beginPath(); ctx.moveTo(fx, toScreenY(fy)); ctx.lineTo(fx + 12 + wave, toScreenY(fy) + 4); ctx.lineTo(fx, toScreenY(fy) + 9); ctx.closePath(); ctx.fill(); ctx.restore();
                }
                if (owner === myName) label(owner, rb.x, rb.y - 34, '#fff', 12);
            });
        }

        // ─── 응원석 + 피날레 ───
        function drawCheerStand(t) {
            var cz = (pieces.cheer || [])[0]; if (!cz) return;
            var z = cz.zone;
            var lastId = data.finishOrder[data.finishOrder.length - 1];
            for (var i = 0; i < balls.length; i++) {
                var b = balls[i];
                if (b.state !== 'done') continue;
                var idx = b.finishIdx;
                var isLast = b.id === lastId && idx === data.finishOrder.length - 1;
                if (isLast) continue;   // 마지막 공은 판자벽 위에 그린다(drawLastBall — drawBasketFront 뒤)
                var side = idx % 2, row = Math.floor(idx / 2) % CHEER_ROWS;
                var x = side ? z.x + z.w - 22 : z.x + 22, y = z.y + z.h - 10 - row * 18 + (Math.floor(idx / (CHEER_ROWS * 2)) % 2) * 9;
                if (!visible(y, 40)) continue;
                var since = t - b.finishAt;
                var frame = since < 300 ? Math.min(1, Math.floor(since / 150)) : 2 + Math.floor((t / 260 + idx) % 2);
                drawCreatureFrame(b, 3, frame, x, y - 6, 0, 0.85);
                if (since > 400 && ((t / 700 + idx * 3) % 7) < 1) {   // 간헐 응원 fx
                    if (!drawSprite('fx', 'cheer', x, y - 30, 96, 96, { sx: Math.floor(t / 120) % 4 * 96, sw: 96 })) label(idx % 3 === 0 ? '♪' : idx % 3 === 1 ? '★' : '♥', x + (idx % 2 ? 6 : -6), y - 30, ringColor(b), 12);
                }
            }
        }
        function drawLastBall(t) {
            var lastId = data.finishOrder[data.finishOrder.length - 1];
            var b = byId[lastId];
            if (!b || b.state !== 'done') return;
            var since = t - b.finishAt;
            var wall = (pieces.dumpwall || [])[0];
            var wy = wall ? wall.y + 14 : data.track.goalY + 60;   // 판자벽 앞(아래)에 엎어짐
            var k = clamp(since / LAST_ROLL_MS, 0, 1);
            var y = lerp(data.track.goalY, wy, k), x = lerp(b.x, wall ? wall.x : b.x, k);
            if (k < 1) { drawShadow(x, y, BALL_R); drawCreatureFrame(b, 2, 2, x, y, b.angle + since / 40); drawRing(b, x, y, BALL_R + 3, b.owner === myName); return; }
            var fs = since - LAST_ROLL_MS;
            var frame = fs < 150 ? 0 : fs < 320 ? 1 : fs < 700 ? 2 : 2 + Math.floor(fs / 300) % 2;
            drawShadow(x, y, BALL_R + 2);
            drawCreatureFrame(b, 4, frame, x, y - 6, 0, 1.15);
            drawRing(b, x, y, BALL_R + 6, true);
            if (fs > 350) {
                // 스포트라이트 + 이름
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.45)';
                ctx.beginPath(); ctx.rect(-view.w, -view.h, view.w * 3, view.h * 3); ctx.arc(x, toScreenY(y), 70, 0, Math.PI * 2, true); ctx.fill();
                ctx.restore();
                label(b.owner + ' 님의 ' + (CREATURE_NAMES[b.creature] || '') + ' ' + b.num + '번', x, y - 44, '#fff', 15);
                label('꼴찌 도착… 당첨!', x, y + 40, '#ffd166', 17);
            }
        }

        // ─── fx ───
        function drawFx(t) {
            fxList.forEach(function (f) {
                var age = t - f.t0, k = age / f.dur, frame = Math.min(3, Math.floor(k * 4));
                var b = f.ball != null ? byId[f.ball] : null;
                var x = f.x != null ? f.x : (b ? b.x : 0), y = f.y != null ? f.y : (b ? b.y : 0);
                switch (f.type) {
                    case 'star': if (!visible(y, 40)) return; if (!drawSprite('fx', 'impact-star', x, y, 96, 96, { sx: frame * 96, sw: 96 })) label('✦', x, y - 10 - k * 10, 'rgba(255,255,160,' + (1 - k).toFixed(2) + ')', 16); break;
                    case 'mud': if (!visible(y, 40)) return; if (!drawSprite('fx', 'mud-splash', x, y - 8, 128, 96, { sx: frame * 128, sw: 128 })) { ctx.fillStyle = 'rgba(90,60,30,' + (1 - k) + ')'; ctx.beginPath(); ctx.arc(x, toScreenY(y) - 12 - k * 14, 6 - k * 4, 0, Math.PI * 2); ctx.fill(); } break;
                    case 'dust': if (!visible(y, 40)) return; if (!drawSprite('fx', 'dust-puff', x, y, 80, 80, { sx: frame * 80, sw: 80, alpha: 1 - k })) { ctx.fillStyle = 'rgba(230,220,200,' + (1 - k) + ')'; ctx.beginPath(); ctx.arc(x, toScreenY(y), 8 + k * 14, 0, Math.PI * 2); ctx.fill(); } break;
                    case 'poof': if (!visible(y, 40)) return; if (!drawSprite('fx', 'curl-poof', x, y, 96, 96, { sx: frame * 96, sw: 96, alpha: 1 - k })) { ctx.fillStyle = 'rgba(255,255,255,' + (1 - k) + ')'; ctx.beginPath(); ctx.arc(x, toScreenY(y), 10 + k * 16, 0, Math.PI * 2); ctx.fill(); } break;
                    case 'wake': if (!visible(y, 40)) return; if (!drawSprite('fx', 'wake', x, y - 26, 48, 48, { sx: frame * 48, sw: 48 })) label('!', x, y - 26 - k * 8, '#fff7a0', 18); break;
                    case 'bees': {
                        var h = (pieces.beehive || [])[0]; if (!h) return; var z = h.zone; if (!visible(z.y + z.h / 2, z.h)) return;
                        for (var n = 0; n < 14; n++) {
                            var px = z.x + hash01(n * 7 + 1) * z.w + Math.sin(t / 90 + n) * 18, py = z.y + hash01(n * 13 + 2) * z.h + Math.cos(t / 70 + n * 2) * 14;
                            if (!drawSprite('fx', 'bee-swarm', px, py, 128, 96, { sx: (frame + n) % 4 * 128, sw: 128, alpha: 0.9 })) {
                                ctx.fillStyle = n % 2 ? '#f2c014' : '#222'; ctx.beginPath(); ctx.arc(px, toScreenY(py), 3, 0, Math.PI * 2); ctx.fill();
                            }
                        }
                        label('벌 떼다!!', z.x + z.w / 2, z.y + 40, '#fff', 14);
                        break;
                    }
                    case 'damburst': {
                        var d = (pieces.dam || [])[0]; if (!d || !visible(d.y1, 80)) return;
                        var cx = (d.x1 + d.x2) / 2;
                        if (!drawSprite('fx', 'dam-burst', cx, d.y1 - 10, 192, 128, { sx: frame * 192, sw: 192, alpha: 1 - k })) {
                            for (var q = 0; q < 10; q++) { var ang = hash01(q + 3) * Math.PI * 2, dist = k * (40 + hash01(q + 9) * 60); ctx.fillStyle = q % 2 ? 'rgba(120,80,40,' + (1 - k) + ')' : 'rgba(120,190,255,' + (1 - k) + ')'; ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * dist, toScreenY(d.y1) + Math.sin(ang) * dist * 0.6 + k * 30, 4, 0, Math.PI * 2); ctx.fill(); }
                            label('댐이 터졌다!', cx, d.y1 - 70, '#fff', 15);
                        }
                        break;
                    }
                }
            });
        }

        // ─── HUD ───
        function updateHud() {
            var rem = 0, rearByOwner = {};
            for (var i = 0; i < balls.length; i++) { var b = balls[i]; if (b.state === 'done') continue; rem++; if (!rearByOwner[b.owner] || b.y < rearByOwner[b.owner].y) rearByOwner[b.owner] = b; }
            var worst = Object.keys(rearByOwner).map(function (o) { return rearByOwner[o]; }).sort(function (a, b) { return a.y - b.y; }).slice(0, 5);
            hudInfo = { remaining: rem, worst: worst };
        }
        function drawHud(t) {
            ctx.save();
            ctx.font = 'bold 14px "Jua", sans-serif'; ctx.textBaseline = 'top';
            var txt = t < 0 ? '출발 준비…' : (hudInfo.remaining > 0 ? '남은 동물 ' + hudInfo.remaining + '마리' : '전원 도착!');
            ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(8, 8, ctx.measureText(txt).width + 20, 26, 8); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(txt, 18, 13);
            if (t >= 0 && hudInfo.worst.length) {
                ctx.font = 'bold 12px "Jua", sans-serif';
                var y = 8, w = 150;
                ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(view.w - w - 8, y, w, 22 + hudInfo.worst.length * 18, 8); ctx.fill();
                ctx.fillStyle = '#ffd166'; ctx.fillText('🚩 꼴찌 후보', view.w - w, y + 5);
                hudInfo.worst.forEach(function (b, i) {
                    var yy = y + 24 + i * 18;
                    ctx.fillStyle = ringColor(b); ctx.beginPath(); ctx.arc(view.w - w + 8, yy + 7, 5, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = b.owner === myName ? '#fff' : '#e8e8e8';
                    var name = b.owner.length > 8 ? b.owner.slice(0, 8) + '…' : b.owner;
                    ctx.fillText(name + ' ' + b.num + '번', view.w - w + 18, yy);
                });
            }
            if (t < 0) {
                var n = Math.ceil(-t / 1000);
                ctx.font = 'bold 64px "Jua", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.fillStyle = '#fff';
                var s = n >= 4 ? '준비!' : String(n);
                ctx.strokeText(s, view.w / 2, view.h / 2); ctx.fillText(s, view.w / 2, view.h / 2);
            }
            ctx.restore();
        }

        // ─── 프레임 ───
        R.render = function (tPlay, dt) {
            if (!data) return;
            dt = dt || 0.016;
            var t = tPlay < 0 ? tPlay : simTime(tPlay);
            applyEventsUpTo(Math.max(0, t));
            samplePositions(t);
            updateCamera(t, dt);
            updateHud();
            ctx.save();
            ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
            ctx.imageSmoothingEnabled = (view.scale * cam.zoom) % 1 !== 0;
            // 줌: 화면 중심 기준 확대 + 가로 초점 이동 (세로는 toScreenY 가 cam.y 로 처리)
            ctx.save();
            ctx.translate(view.w / 2, view.h / 2); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x, -view.h / 2);
            drawBackground(t);
            drawPieces(t);
            drawBalls(t);
            drawCheerStand(t);
            drawBasketFront();
            drawLastBall(t);
            drawFx(t);
            ctx.restore();
            drawHud(t);
            ctx.restore();
            if (t >= 0 && phase !== 'finale' && phase !== 'done' && hudInfo.remaining === 0) { phase = 'finale'; if (onFinaleCb) onFinaleCb(); }
            if (t >= 0 && phase === 'countdown') phase = 'play';
            if (tPlay >= data.durationMs && phase !== 'done') { phase = 'done'; R.stop(); }
        };

        // 대기 화면(타임라인 없을 때) — 출발대 프리뷰
        R.drawIdle = function (previewBalls) {
            R.resize();
            ctx.save(); ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
            var g = ctx.createLinearGradient(0, 0, 0, view.h); g.addColorStop(0, '#9fd8ff'); g.addColorStop(1, '#cdefc0');
            ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, view.h);
            ctx.font = 'bold 18px "Jua", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#2f5d3a';
            ctx.fillText('동물을 고르고 준비하면 출발대에 섭니다', view.w / 2, view.h / 2);
            ctx.restore();
        };

        // 동물 아이콘(피커 버튼용) — row 0 col 0 서 있는 프레임
        R.drawCreatureIcon = function (iconCanvas, creature) {
            var c = iconCanvas.getContext('2d'); var im = img('creatures', creature);
            c.clearRect(0, 0, iconCanvas.width, iconCanvas.height);
            if (im) { c.imageSmoothingEnabled = false; c.drawImage(im, 0, 0, CELL, CELL, 0, 0, iconCanvas.width, iconCanvas.height); }
            else { c.fillStyle = '#c8b28c'; c.beginPath(); c.arc(iconCanvas.width / 2, iconCanvas.height / 2, iconCanvas.width / 3, 0, Math.PI * 2); c.fill(); }
        };

        return R;
    }

    return { create: create, loadAssets: loadAll, RING_COLORS: RING_COLORS, CREATURE_NAMES: CREATURE_NAMES, COUNTDOWN_MS: COUNTDOWN_MS, ASSETS: ASSETS };
})();
