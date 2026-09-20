/* 마블런(marble) 캔버스 렌더러 + 재생기.
   소켓/DOM 상태 없음 — (타임라인, t) → 화면 의 순수 함수에 가깝다. js/marble.js 와 game-lab/marble-preview.html 이 공용.
   좌표계: 트랙 논리폭 800(서버 socket/marble-sim.js 와 동일), 카메라가 세로로 따라간다.
   에셋: assets/marble/ 1차+2차 배치(52장, 규격은 marble-run.manifest.json). ASSETS 값이 null 이거나 로드 실패면 코드 도형(라벨 포함)으로 그린다.
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
    var ZOOM_MIN = 0.58;             // 결승 프레임(구멍밭+스탠드)을 한 화면에 넣기 위한 줌아웃 하한
    var FRAME_ENTER_PX = 200;        // 선두가 구멍밭 위 이 거리 안에 들어오면 결승 프레임 모드
    var MINIMAP_W = 22;
    var SRC_SCALE = 0.25;            // 4x 소스 → 표시
    var CELL = 160;                  // 동물 시트 셀
    var STAND_ROW_H = 44;            // 도착 스탠드 한 줄 높이
    var STAND_MAX_ROWS = 4;          // 스탠드에 보여줄 최대 줄 수 (넘치면 첫 줄 + 마지막 줄들)
    var WALL_SCALE = 1.5;            // 울타리 스프라이트 확대(128×40 소스 → 48×15)
    var SEESAW_SCALE = 1.5;
    var BASKET_SCALE = 2;            // 골 바구니·판자벽 — 결승 채널(160)을 채우게
    var SUN_WALK_SPEED = 260;        // 햇볕 잔디 안에서 이 속도 미만이면 공을 풀고 서서 걷는 모습(시각 — 물리는 그대로 원)
    var SUN_UNCURL_MS = 240;         // 펴지는 전환 프레임 시간
    var WAKE_POSE_MS = 380;          // 깨어남 → 벌떡(sleep 시트 col 2·3) 후 다시 공
    var GATE_TILE_SRC_W = 128, GATE_TILE_OVERLAP_SRC = 8;   // last-gate 타일 — 양 끝 기둥이 8px 겹치게
    var DAM_FRAMES = 5;              // beaver-dam.png 프레임 수 (2400×256, 셀 480×256): 온전/금 살짝/금 많이/금+물/터짐

    // 24색 플레이어 링 팔레트 (참가자 순서 index) — spin-arena 24색과 동일 hue 분포
    var RING_COLORS = ['#e23b3b', '#3b82e2', '#2bb673', '#e2a23b', '#9b59e2', '#e23b8f', '#22c1d6', '#9ccf2f',
        '#4053d6', '#d63be2', '#b07033', '#aab6c4', '#3bc9a7', '#e6dfc8', '#5a6472', '#343344',
        '#ff7a1a', '#f2c014', '#8a8d2f', '#0e9488', '#5b3fd6', '#ff6f61', '#7d3a6a', '#46708f'];
    var CREATURE_NAMES = { hedgehog: '고슴도치', armadillo: '아르마딜로', pillbug: '공벌레', turtle: '거북이', panda: '판다' };

    // ─── 에셋 맵 (null = 2차 미도착 → 플레이스홀더) ───
    var A = '/assets/marble/';
    var ASSETS = {
        creatures: { hedgehog: A + 'creatures/hedgehog.png', armadillo: A + 'creatures/armadillo.png', pillbug: A + 'creatures/pillbug.png', turtle: A + 'creatures/turtle.png', panda: A + 'creatures/panda.png' },
        sleep: { hedgehog: A + 'creatures/hedgehog-sleep.png', armadillo: A + 'creatures/armadillo-sleep.png', pillbug: A + 'creatures/pillbug-sleep.png', turtle: A + 'creatures/turtle-sleep.png', panda: A + 'creatures/panda-sleep.png' },   // 4×1, 셀 160: 누움/숨쉬기/깨어남/벌떡
        pieces: {
            'start-platform-mid': A + 'pieces/start-platform-mid.png', 'start-platform-end': A + 'pieces/start-platform-end.png',
            'start-gate': A + 'pieces/start-gate.png', 'log-bumper': A + 'pieces/log-bumper.png', 'stake': A + 'pieces/stake.png',
            'seesaw-plank': A + 'pieces/seesaw-plank.png', 'seesaw-pivot': A + 'pieces/seesaw-pivot.png', 'mud-puddle': A + 'pieces/mud-puddle.png',
            'fence-mid': A + 'pieces/fence-mid.png', 'fence-post': A + 'pieces/fence-post.png',
            'goal-basket-back': A + 'pieces/goal-basket-back.png', 'goal-basket-front': A + 'pieces/goal-basket-front.png', 'dump-wall': A + 'pieces/dump-wall.png',
            'beehive': A + 'pieces/beehive.png', 'sun-patch': A + 'pieces/sun-patch.png', 'beaver-dam': A + 'pieces/beaver-dam.png', 'beaver': A + 'pieces/beaver.png',
            'pit': A + 'pieces/pit.png', 'last-gate': A + 'pieces/last-gate.png', 'flag': A + 'pieces/flag.png'
        },
        stage: {
            'sky-far': A + 'stage/sky-far.png', 'meadow-tile': A + 'stage/meadow-tile.png',
            'tree': A + 'stage/decor-tree.png', 'bush-big': A + 'stage/decor-bush-big.png', 'bush-small': A + 'stage/decor-bush-small.png',
            'rock': A + 'stage/decor-rock.png', 'signpost': A + 'stage/decor-signpost.png',
            'flower-pink': A + 'stage/decor-flower-pink.png', 'flower-yellow': A + 'stage/decor-flower-yellow.png', 'flower-white': A + 'stage/decor-flower-white.png'
        },
        fx: {
            'dust-puff': A + 'fx/dust-puff.png', 'impact-star': A + 'fx/impact-star.png', 'mud-splash': A + 'fx/mud-splash.png', 'curl-poof': A + 'fx/curl-poof.png',
            'bee-swarm': A + 'fx/bee-swarm.png', 'zz': A + 'fx/zz.png', 'wake': A + 'fx/wake.png', 'dam-burst': A + 'fx/dam-burst.png', 'cheer': A + 'fx/cheer.png'
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
                x: 0, y: 0, angle: 0, state: 'roll', stateAt: 0, dizzyUntil: 0, muddy: false, squashUntil: 0, finishIdx: -1, finishAt: 0, napAt: 0, wakeAt: -1e9, sunSince: -1, dir: 1, spd: 0, landAt: 0 }; });
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
            if (t < lastT) { evCursor = 0; fxList = []; balls.forEach(function (b) { b.state = 'roll'; b.finishIdx = -1; b.muddy = false; b.dizzyUntil = 0; b.wakeAt = -1e9; b.sunSince = -1; b.landAt = 0; }); }
            var ev = data.events;
            while (evCursor < ev.length && ev[evCursor].t <= t) {
                var e = ev[evCursor++];
                var b = e.ball != null ? byId[e.ball] : null;
                switch (e.type) {
                    case 'nap': b.state = 'nap'; b.napAt = e.t; break;
                    case 'wake': if (b.state !== 'done') { b.state = 'roll'; b.wakeAt = e.t; } fxList.push({ type: 'wake', ball: b.id, t0: e.t, dur: WAKE_FX_MS }); break;
                    case 'pitFall': b.state = 'pit'; fxList.push({ type: 'dust', ball: b.id, t0: e.t, dur: POOF_FX_MS }); break;
                    case 'pitRise': break;
                    case 'mud': b.state = 'mud'; b.muddy = true; fxList.push({ type: 'mud', ball: b.id, t0: e.t, dur: MUD_FX_MS }); break;
                    case 'mudEnd': b.state = 'roll'; b.dizzyUntil = e.t + MUD_DIZZY_MS; break;
                    case 'bump': fxList.push({ type: 'star', x: e.x, y: e.y, t0: e.t, dur: BUMP_FX_MS }); if (b) b.squashUntil = e.t + 160; break;
                    case 'bees': fxList.push({ type: 'bees', t0: e.t, dur: BEE_MS }); break;
                    case 'damCrack': break;
                    case 'damBurst': fxList.push({ type: 'damburst', t0: e.t, dur: DAM_FX_MS }); break;
                    case 'land': b.state = 'walk'; b.landAt = e.t; fxList.push({ type: 'dust', ball: b.id, t0: e.t, dur: POOF_FX_MS }); break;
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
                    if (Math.abs(dx) + Math.abs(dy) < 200) {
                        b.angle += (dx * 0.6 + dy) / BALL_R;   // 진행 방향 회전(시각)
                        b.spd = Math.hypot(dx, dy) / Math.max(1e-3, s / 1000);   // 샘플 간 평균 속도(px/s)
                        if (Math.abs(dx) > 0.5) b.dir = dx > 0 ? 1 : -1;
                    }
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
            var hf = (pieces.holefield || [])[0];
            var wallP = (pieces.dumpwall || [])[0];
            // 결승 프레임: 선두가 구멍밭 근처(위 FRAME_ENTER_PX 이내)에 오면 구멍밭+스탠드+판자벽을 한 화면에 고정 — 이후 도착하는 공은 위에서 들어오고, 후미 추적 없이 전원이 보인다
            var frameMode = hf && lead && lead.y >= hf.zone.y - FRAME_ENTER_PX;
            cam.mode = frameMode ? 'frame' : (remaining <= finalK ? 'rear' : 'lead');
            focus = cam.mode === 'rear' ? rear : lead;
            var targetY, targetX = TRACK_W / 2, targetZoom = 1;
            if (t < 0) targetY = data.track.startY * 0.5 + 60;
            else if (!focus) { targetY = goalY + 40; targetX = TRACK_W / 2; targetZoom = ZOOM_MAX * 0.8; }
            else if (frameMode) {
                var standP = (pieces.stand || [])[0];
                var top = hf.zone.y - 30, bottom = standP ? standP.zone.y + standP.zone.h + 10 : (wallP ? wallP.y : goalY) + 50;
                targetY = (top + bottom) / 2; targetX = TRACK_W / 2;
                targetZoom = clamp(view.h / (bottom - top), ZOOM_MIN, ZOOM_MAX);
                if (remaining <= 1 && rear) {   // 마지막 한 마리: 그 공으로 줌인
                    var kk = clamp((rear.y - (goalY - ZOOM_ZONE)) / ZOOM_ZONE, 0, 1);
                    targetZoom = Math.max(targetZoom, 1 + (ZOOM_MAX - 1) * kk);
                    if (kk > 0.3) { targetX = rear.x; targetY = rear.y + view.h * CAM_LEAD / targetZoom; }
                }
            }
            else {
                targetY = focus.y + view.h * CAM_LEAD;
                var k = clamp((focus.y - (goalY - ZOOM_ZONE)) / ZOOM_ZONE, 0, 1);
                targetZoom = 1 + (ZOOM_MAX - 1) * k;
                if (targetZoom > 1.01) { targetX = focus.x; targetY = focus.y + view.h * CAM_LEAD / targetZoom; }
            }
            var minY = data.track.startY + view.h / 2 - 140, maxY = data.track.endY - view.h / 2 + 20;   // 출발대 위 140px(하늘 띠)까지
            targetY = clamp(targetY, minY, maxY);
            var halfW = view.w / 2 / targetZoom;
            targetX = halfW >= TRACK_W / 2 ? TRACK_W / 2 : clamp(targetX, halfW, TRACK_W - halfW);   // 줌아웃으로 트랙보다 넓으면 중앙 고정
            if (!cam.init) { cam.y = targetY; cam.x = targetX; cam.zoom = targetZoom; cam.init = true; }
            else {
                var k2 = Math.min(1, dt * CAM_SMOOTH);
                cam.y += (targetY - cam.y) * k2; cam.x += (targetX - cam.x) * k2; cam.zoom += (targetZoom - cam.zoom) * Math.min(1, dt * 2.5);
                if (Math.abs(cam.zoom - 1) < 0.004) cam.zoom = 1;   // 1 근처에서 스냅 — 미세 배율의 타일 이음새 방지
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
                ctx.drawImage(sky, -view.w, off - dh, view.w * 3, dh * 3); ctx.drawImage(sky, -view.w, off + dh * 2, view.w * 3, dh * 3);
            } else {
                var g = ctx.createLinearGradient(0, 0, 0, view.h);
                g.addColorStop(0, '#9fd8ff'); g.addColorStop(1, '#dff3ff');
                ctx.fillStyle = g; ctx.fillRect(-view.w, -view.h, view.w * 3, view.h * 3);
            }
            // 초원은 출발대 위 80px 부터 — 그 위로는 하늘·먼 산이 보인다
            var tile = img('stage', 'meadow-tile');
            var ts = 1024 * SRC_SCALE;
            var topY = toScreenY(data.track.startY - 30);
            // 줌아웃(zoom<1)이면 화면이 논리 뷰보다 넓다 — 덮어야 할 범위를 줌으로 늘린다
            var padX = (view.w / cam.zoom - view.w) / 2 + ts, padY = (view.h / cam.zoom - view.h) / 2 + ts;
            // 줌 시 가로 초점이 움직여도 빈 곳이 없도록 트랙 폭 밖으로 한 타일씩 더 깐다
            var y0 = toScreenY(Math.floor((cam.y - padY) / ts) * ts - ts);
            ctx.save(); ctx.beginPath(); ctx.rect(-padX, Math.max(-padY, topY), view.w + padX * 2, view.h + padY * 2); ctx.clip();
            if (tile) {
                for (var y = y0; y < view.h + padY; y += ts) for (var x = -padX; x < view.w + padX; x += ts) ctx.drawImage(tile, x, y, ts + 1, ts + 1);   // +1: 줌 배율에서 타일 이음새 방지
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
                // 햇볕 잔디: 스프라이트(256×128, 4배=64×32)를 2배 크기(128×64) 벽돌 패턴으로 깔아 구역을 채운다
                var sp = img('pieces', 'sun-patch');
                var glow = ctx.createRadialGradient(z.x + z.w / 2, toScreenY(z.y + z.h / 2), 30, z.x + z.w / 2, toScreenY(z.y + z.h / 2), z.w * 0.6);
                glow.addColorStop(0, 'rgba(255,235,130,0.55)'); glow.addColorStop(1, 'rgba(255,235,130,0)');
                ctx.fillStyle = glow; ctx.fillRect(z.x - 40, toScreenY(z.y) - 30, z.w + 80, z.h + 60);
                if (sp) {
                    var tw = 128, th = 64, row = 0;
                    for (var yy = z.y - 10; yy < z.y + z.h - th * 0.6; yy += th * 0.55, row++) {
                        for (var xx = z.x - 20 + (row % 2 ? tw * 0.35 : 0); xx < z.x + z.w - tw * 0.5; xx += tw * 0.7) ctx.drawImage(sp, 0, 0, 256, 128, xx, toScreenY(yy), tw, th);
                    }
                }
                // 햇살 반짝임 (t 파생, 결정론)
                for (var q = 0; q < 10; q++) {
                    var ph = (t / 900 + hash01(q + 11)) % 1, a = Math.sin(ph * Math.PI);
                    var px = z.x + 30 + hash01(q + 5) * (z.w - 60), py = z.y + 30 + hash01(q + 17) * (z.h - 60);
                    ctx.fillStyle = 'rgba(255,255,210,' + (0.85 * a).toFixed(2) + ')';
                    ctx.beginPath(); ctx.arc(px, toScreenY(py), 1.5 + a * 2, 0, Math.PI * 2); ctx.fill();
                }
                // 팻말: 구역 입구 왼쪽
                drawSprite('stage', 'signpost', z.x + 26, z.y + 6, 64, 96, { anchor: 'bottom' });
                label('☀ 햇볕 잔디', z.x + 26, z.y - 30, '#fff7c0', 12);
                label('따뜻해서 걷다가 잠들어요', z.x + z.w / 2, z.y + z.h - 14, '#fff7c0', 12);
            });
            (pieces.pit || []).forEach(function (pt) {
                var z = pt.zone; if (!visible(z.y + z.h / 2, z.h)) return;
                if (!drawSprite('pieces', 'pit', z.x + z.w / 2, z.y + z.h, 480, 160, { anchor: 'bottom', scale: z.w / (480 * SRC_SCALE) })) placeholderBox(z.x, z.y, z.w, z.h, 'rgba(70,45,25,0.9)', '#3b2412', '구덩이', 14);
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
                if (!drawSprite('pieces', 'beehive', h.x, h.y + 24, 96, 128, { sx: shaking ? 96 : 0, sw: 96, rot: wob, anchor: 'bottom', scale: 1.5 })) {
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
                // 프레임 = 압력 단계. 압력 = 댐 구역 안 미도착 공 수 / 서버 임계(max(2, ceil(전체×0.5)) — socket/marble-sim.js DAM_* 와 동일 값).
                // DAM_FRAMES 3: [온전, 금+물, 터짐] / 5(2400×256 도착 시): [온전, 금 살짝, 금 많이, 금+물, 터짐] — 상수만 바꾸면 됨
                var burstEv = data.events.some(function (e) { return e.type === 'damBurst' && e.t <= t; });
                var inDam = 0;
                for (var bi = 0; bi < balls.length; bi++) { var bb = balls[bi]; if (bb.state !== 'done' && bb.x >= d.zone.x && bb.x <= d.zone.x + d.zone.w && bb.y >= d.zone.y && bb.y <= d.zone.y + d.zone.h) inDam++; }
                var damThreshold = Math.max(2, Math.ceil(balls.length * 0.5));
                var pressure = clamp(inDam / damThreshold, 0, 1);
                var st = burstEv ? DAM_FRAMES - 1 : Math.min(DAM_FRAMES - 2, Math.floor(pressure * (DAM_FRAMES - 1)));
                var cx = (d.x1 + d.x2) / 2, w = d.x2 - d.x1;
                if (st < DAM_FRAMES - 1 || burst) {
                    var dsc = w / (480 * SRC_SCALE);   // 채널 폭에 맞춤. 벽 = 셀 상단 가장자리 → 바닥 앵커를 y1 + 셀높이 로
                    if (!drawSprite('pieces', 'beaver-dam', cx, d.y1 + 256 * SRC_SCALE * dsc, 480, 256, { sx: st * 480, sw: 480, anchor: 'bottom', scale: dsc, alpha: burst ? 1 - (t - (data.events.find(function (e) { return e.type === 'damBurst'; }) || { t: t }).t) / DAM_FX_MS * 0.7 : 1 })) {
                        ctx.save(); ctx.globalAlpha = burst ? 0.4 : 1;
                        for (var li = 0; li < 4; li++) { ctx.fillStyle = li % 2 ? '#9c6a3a' : '#7d5330'; roundRect(d.x1 + 2, toScreenY(d.y1) - 6 - li * 9, w - 4, 8, 4); ctx.fill(); }
                        if (st > 0 && st < DAM_FRAMES - 1) { ctx.strokeStyle = '#3aa0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 6, toScreenY(d.y1) - 40); ctx.lineTo(cx + 4, toScreenY(d.y1) - 20); ctx.lineTo(cx - 2, toScreenY(d.y1)); ctx.stroke(); }
                        ctx.restore();
                        label(st > 0 ? '비버 댐 — 금이 간다!' : '비버 댐', cx, d.y1 - 52, '#fff', 12);
                    }
                }
                if (!drawSprite('pieces', 'beaver', d.beaverX, d.y1 + 26, 96, 96, { sx: st > 0 ? 96 : 0, sw: 96, anchor: 'bottom', scale: 1.3 })) {
                    ctx.fillStyle = '#6b4423'; ctx.beginPath(); ctx.ellipse(d.beaverX, toScreenY(d.y1) - 48, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
                    if (st > 0) label('!', d.beaverX, d.y1 - 68, '#fff', 14);
                }
            });
            (pieces.holefield || []).forEach(function (hf) {
                var z = hf.zone; if (!visible(hf.floorY, z.h + 100)) return;
                // 구멍 + 파이프: 어두운 구멍(타원) 위에 '골' 표시, 파이프 안쪽은 어둡게
                hf.holes.forEach(function (h, i) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(40,25,10,0.95)';
                    ctx.fillRect(h.x - h.w / 2 + 2, toScreenY(h.y), h.w - 4, hf.pipeH);
                    ctx.beginPath(); ctx.ellipse(h.x, toScreenY(h.y), h.w / 2, 8, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 2; ctx.stroke();
                    ctx.restore();
                    label('골', h.x, h.y - 14, '#ffe08a', 11);
                });
                label('🕳 골 구멍 — 마지막에 떨어지는 동물이 당첨', z.x + z.w / 2, z.y - 16, '#fff', 13);
            });
            (pieces.lane || []).forEach(function (ln) {
                if (!visible(ln.y, 80)) return;
                // 흙길 + 골 선 + 안내
                ctx.save();
                ctx.fillStyle = 'rgba(150,115,70,0.55)'; ctx.fillRect(ln.x0, toScreenY(ln.y - ln.h / 2), ln.x1 - ln.x0, ln.h);
                ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(ln.goalX, toScreenY(ln.y - ln.h / 2)); ctx.lineTo(ln.goalX, toScreenY(ln.y + ln.h / 2)); ctx.stroke();
                ctx.restore();
                label('골', ln.goalX, ln.y - ln.h / 2 - 10, '#ffe08a', 12);
                label('→ 떨어진 자리에서 골까지 한 줄로 걸어갑니다', (ln.x0 + ln.x1) / 2, ln.y + ln.h / 2 + 12, '#fff', 11);
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
                // 통로 끝 판자벽(facing left): 통로 높이에 맞춰 1.2배, 바닥 = 통로 아래
                var wsc = d.facing === 'left' ? 1.2 : BASKET_SCALE, wyy = d.facing === 'left' ? d.y + 34 : d.y + 30;
                if (!drawSprite('pieces', 'dump-wall', d.x, wyy, 96, 160, { anchor: 'bottom', scale: wsc })) placeholderBox(d.x - 12, d.y - 30, 24, 60, '#8a6a4a', '#4a3420', '끝', 4);
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

        // 꼴찌 깃발 — 흰 천을 플레이어 색으로 틴트 (multiply 후 원본 알파 복원). (colorIdx, frame) 별 오프스크린 캐시
        var flagCache = {};
        function drawTintedFlag(b, x, y, frame) {
            var im = img('pieces', 'flag'); if (!im) return false;
            var key = b.colorIdx + ':' + frame;
            var c = flagCache[key];
            if (!c) {
                c = document.createElement('canvas'); c.width = 32; c.height = 64;
                var cc = c.getContext('2d');
                cc.drawImage(im, frame * 32, 0, 32, 64, 0, 0, 32, 64);
                cc.globalCompositeOperation = 'multiply'; cc.fillStyle = ringColor(b); cc.fillRect(0, 0, 32, 64);
                cc.globalCompositeOperation = 'destination-in'; cc.drawImage(im, frame * 32, 0, 32, 64, 0, 0, 32, 64);
                flagCache[key] = c;
            }
            var sc = SRC_SCALE * 1.4;
            ctx.drawImage(c, x - 16 * sc, toScreenY(y) - 64 * sc, 32 * sc, 64 * sc);
            return true;
        }
        // 햇볕 잔디에서 느려진 동물: 공을 풀고(uncurl 2프레임) 서서 걷는다(idle 루프). 진행 방향으로 뒤집기.
        function inSunZone(b) { var sz = (pieces.sunpatch || [])[0]; return !!sz && b.x >= sz.zone.x && b.x <= sz.zone.x + sz.zone.w && b.y >= sz.zone.y && b.y <= sz.zone.y + sz.zone.h; }
        function drawSunWalker(b, t) {
            var since = t - b.sunSince;
            var row, col;
            if (since < SUN_UNCURL_MS) { row = 3; col = since < SUN_UNCURL_MS / 2 ? 0 : 1; }
            else { row = 0; col = Math.floor((since - SUN_UNCURL_MS) / 140) % 4; }
            var im = img('creatures', b.creature);
            if (!im) { drawCreatureFrame(b, 2, 0, b.x, b.y, 0); return; }
            var sc = SRC_SCALE;
            ctx.save(); ctx.translate(b.x, toScreenY(b.y + 6)); ctx.scale(b.dir, 1);
            ctx.drawImage(im, col * CELL, row * CELL, CELL, CELL, -CELL * sc / 2, -CELL * sc / 2, CELL * sc, CELL * sc);
            ctx.restore();
        }

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
                    else drawSprite('fx', 'zz', b.x + 14, zy - 4, 48, 48, { sx: Math.floor(zt / 225) * 48, sw: 48, alpha: za, scale: 1.3 });
                    continue;
                }
                if (b.state === 'walk') {   // 집결 통로: 펴져서 오른쪽으로 걷는다 (앞을 추월 못 하는 한 줄)
                    var ws = t - b.landAt;
                    var wrow = ws < SUN_UNCURL_MS ? 3 : 0, wcol = ws < SUN_UNCURL_MS ? (ws < SUN_UNCURL_MS / 2 ? 0 : 1) : Math.floor(ws / 140) % 4;
                    var wim = img('creatures', b.creature);
                    if (wim) { ctx.save(); ctx.translate(b.x, toScreenY(b.y + 6)); ctx.drawImage(wim, wcol * CELL, wrow * CELL, CELL, CELL, -CELL * SRC_SCALE / 2, -CELL * SRC_SCALE / 2, CELL * SRC_SCALE, CELL * SRC_SCALE); ctx.restore(); }
                    else drawCreatureFrame(b, 2, 0, b.x, b.y, 0);
                    drawRing(b, b.x, b.y, BALL_R + 3, mine);
                    continue;
                }
                if (b.state === 'mud') { drawCreatureFrame(b, 2, 3, b.x, b.y); drawRing(b, b.x, b.y, BALL_R + 3, mine); continue; }
                // 깨어남 직후: sleep 시트 col 2(눈 번쩍) → col 3(벌떡) 후 다시 공
                if (t - b.wakeAt < WAKE_POSE_MS && img('sleep', b.creature)) {
                    var wf = (t - b.wakeAt) < WAKE_POSE_MS / 2 ? 2 : 3;
                    ctx.save(); ctx.translate(b.x, toScreenY(b.y)); ctx.drawImage(img('sleep', b.creature), wf * CELL, 0, CELL, CELL, -20, -22, 40, 40); ctx.restore();
                    drawRing(b, b.x, b.y, BALL_R + 3, mine);
                    continue;
                }
                // 햇볕 잔디에서 느려짐 → 펴져서 걷는 모습 (느려지는 이유가 화면에서 읽히게)
                if (inSunZone(b) && b.spd < SUN_WALK_SPEED && t > 0) {
                    if (b.sunSince < 0) b.sunSince = t;
                    drawSunWalker(b, t);
                    drawRing(b, b.x, b.y, BALL_R + 3, mine);
                    continue;
                }
                b.sunSince = -1;
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
                if (!drawTintedFlag(rb, fx + 4, fy + 22, Math.floor(t / 200) % 2)) {
                    ctx.save(); ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(fx, toScreenY(fy)); ctx.lineTo(fx, toScreenY(fy) + 20); ctx.stroke();
                    ctx.fillStyle = ringColor(rb); ctx.beginPath(); ctx.moveTo(fx, toScreenY(fy)); ctx.lineTo(fx + 12 + wave, toScreenY(fy) + 4); ctx.lineTo(fx, toScreenY(fy) + 9); ctx.closePath(); ctx.fill(); ctx.restore();
                }
                if (owner === myName) label(owner, rb.x, rb.y - 34, '#fff', 12);
            });
        }

        // ─── 응원석 + 피날레 ───
        // 도착 스탠드: finishOrder 순서대로 왼쪽부터 1, 2, 3… (한 줄 cols 마리). 줄이 넘치면 첫 줄 + 마지막 줄들만.
        function drawCheerStand(t) {
            var st = (pieces.stand || [])[0]; if (!st) return;
            var z = st.zone, cols = st.cols || 10, colW = z.w / cols;
            var total = data.finishOrder.length;
            var lastId = data.finishOrder[total - 1];
            var finishedCount = 0;
            for (var i = 0; i < balls.length; i++) if (balls[i].state === 'done') finishedCount++;
            var rows = Math.ceil(Math.max(1, finishedCount) / cols);
            // 보이는 줄 → 화면 줄 번호 매핑
            var rowMap = {};
            if (rows <= STAND_MAX_ROWS) { for (var r = 0; r < rows; r++) rowMap[r] = r; }
            else { rowMap[0] = 0; for (var r2 = rows - (STAND_MAX_ROWS - 1); r2 < rows; r2++) rowMap[r2] = r2 - (rows - STAND_MAX_ROWS); }
            var shownRows = Math.min(rows, STAND_MAX_ROWS);
            // 나무 판 (start-platform-mid 타일) — 보이는 줄 수만큼
            var mid = img('pieces', 'start-platform-mid');
            for (var sr = 0; sr < shownRows; sr++) {
                var py = z.y + sr * STAND_ROW_H;
                if (!visible(py, STAND_ROW_H)) continue;
                if (mid) { for (var x = z.x; x < z.x + z.w; x += 32) ctx.drawImage(mid, 0, 0, 128, 96, x, toScreenY(py + 10), Math.min(32, z.x + z.w - x), 24); }
                else { ctx.fillStyle = 'rgba(160,110,60,0.85)'; ctx.fillRect(z.x, toScreenY(py + 10), z.w, 24); }
            }
            if (rows > STAND_MAX_ROWS) label('··· ' + (rows - STAND_MAX_ROWS) * cols + '마리 더 ···', z.x + z.w / 2, z.y + STAND_ROW_H - 4, '#fff', 11);
            for (var i2 = 0; i2 < balls.length; i2++) {
                var b = balls[i2];
                if (b.state !== 'done') continue;
                var idx = b.finishIdx;
                if (b.id === lastId && idx === total - 1) continue;   // 꼴찌는 판자벽 앞(drawLastBall)
                var row = Math.floor(idx / cols), col = idx % cols;
                if (rowMap[row] == null) continue;
                var x2 = z.x + colW * (col + 0.5), y2 = z.y + rowMap[row] * STAND_ROW_H + 8;
                if (!visible(y2, 40)) continue;
                var since = t - b.finishAt;
                var frame = since < 300 ? Math.min(1, Math.floor(since / 150)) : 2 + Math.floor((t / 260 + idx) % 2);
                drawCreatureFrame(b, 3, frame, x2, y2 - 6, 0, 0.85);
                // 순위 배지 (플레이어 색)
                ctx.save();
                ctx.fillStyle = ringColor(b); ctx.beginPath(); ctx.arc(x2 - 13, toScreenY(y2) - 20, 8, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(String(idx + 1), x2 - 13, toScreenY(y2) - 19.5);
                ctx.restore();
                if (since > 400 && ((t / 700 + idx * 3) % 9) < 1) {   // 간헐 응원 fx
                    if (!drawSprite('fx', 'cheer', x2, y2 - 30, 96, 96, { sx: Math.floor(t / 120) % 4 * 96, sw: 96 })) label('♪', x2 + 6, y2 - 30, ringColor(b), 12);
                }
            }
        }
        function drawLastBall(t) {
            var lastId = data.finishOrder[data.finishOrder.length - 1];
            var b = byId[lastId];
            if (!b || b.state !== 'done') return;
            var since = t - b.finishAt;
            var wall = (pieces.dumpwall || [])[0];
            // 통로 끝: 골 x 에서 판자벽 앞까지 마저 걸어가 벽에 퍽 → 엎어짐
            var wx = wall ? wall.x - 30 : b.x + 40, wy = data.track.goalY;
            var k = clamp(since / LAST_ROLL_MS, 0, 1);
            var x = lerp(data.track.goalX || b.x, wx, k), y = wy;
            if (k < 1) {
                drawShadow(x, y, BALL_R);
                var lim = img('creatures', b.creature);
                if (lim) { ctx.save(); ctx.translate(x, toScreenY(y + 6)); ctx.drawImage(lim, Math.floor(since / 140) % 4 * CELL, 0, CELL, CELL, -CELL * SRC_SCALE / 2, -CELL * SRC_SCALE / 2, CELL * SRC_SCALE, CELL * SRC_SCALE); ctx.restore(); }
                drawRing(b, x, y, BALL_R + 3, b.owner === myName); return;
            }
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
        // 미니맵 — 좌측 세로 스트립: 구간 띠 + 공 점(플레이어 색, 내 공 크게) + 현재 화면 범위. 리플레이 시각 기준이라 모든 클라 동일.
        var MINIMAP_BANDS = [   // [y0, y1, color, 라벨] — socket/marble-sim.js buildTrack 구간과 동일
            [0, 300, '#b48a5a', '출발'], [300, 900, '#c9a26a', '말뚝'], [900, 1250, '#e6b73a', '벌집'], [1250, 1650, '#f2e27a', '햇볕'],
            [1650, 2030, '#7fa6d6', '댐'], [2030, 2200, '#6b4a2b', '구덩이'], [2200, 4120, '#8fd07a', '뱀길'], [4120, 4880, '#a07a4a', '범퍼·진흙'],
            [4880, 5320, '#d98c3a', '구멍밭'], [5320, 5800, '#f2b134', '통로·스탠드']
        ];
        function drawMinimap(t) {
            var x0 = 12, y0 = 44, h = view.h - 60, w = MINIMAP_W;
            var startY = data.track.startY, endY = data.track.endY;
            var sc = h / (endY - startY);
            var my = function (wy) { return y0 + (wy - startY) * sc; };
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(x0 - 4, y0 - 4, w + 8, h + 8, 6); ctx.fill();
            MINIMAP_BANDS.forEach(function (bd) {
                var a = Math.max(startY, bd[0]), bb = Math.min(endY, bd[1]);
                ctx.fillStyle = bd[2]; ctx.globalAlpha = 0.8; ctx.fillRect(x0, my(a), w, Math.max(1, my(bb) - my(a)));
            });
            ctx.globalAlpha = 1;
            // 화면 범위
            var vh = view.h / cam.zoom;
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x0 - 2, my(cam.y - vh / 2), w + 4, Math.max(3, vh * sc));
            // 공 점: 남의 공 작게, 내 공 크게(테두리)
            for (var i = 0; i < balls.length; i++) {
                var b = balls[i]; if (b.state === 'done' || t < 0) continue;
                var px = x0 + 3 + (b.x / TRACK_W) * (w - 6), py = my(b.y);
                ctx.fillStyle = ringColor(b);
                ctx.beginPath(); ctx.arc(px, py, b.owner === myName ? 3.2 : 2, 0, Math.PI * 2); ctx.fill();
                if (b.owner === myName) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
            }
            // 골 표시
            ctx.fillStyle = '#fff'; ctx.font = 'bold 9px "Jua", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText('골', x0 + w / 2, my(data.track.goalY) + 2);
            ctx.restore();
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
            drawMinimap(t);
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
