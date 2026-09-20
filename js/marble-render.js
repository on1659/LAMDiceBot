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
    var IDLE_T = -100000;            // 대기 화면 프레임 시각 — 카운트다운 전(서 있는 포즈) 구간을 그대로 쓴다
    // 카운트다운 복제 연출: 사람당 1마리(num 1)는 대기 때부터 서 있고, 나머지는 이 구간에 순서대로 위에서 떨어져 마릿수를 보여준다
    var SPAWN_START_MS = -COUNTDOWN_MS + 400;
    var SPAWN_END_MS = CURL_START_MS - 350;   // 웅크리기 전에 전원 착지
    var SPAWN_DROP_MS = 300;                  // 한 마리 낙하 시간
    var SPAWN_DROP_H = 110;                   // 낙하 시작 높이(px)
    var GATE_ANIM_MS = 400;          // 출발 빗장 올라가는 시간
    var BEE_MS = 1800;
    var MUD_DIZZY_MS = 1000;
    var BUMP_FX_MS = 380;
    var WAKE_FX_MS = 600;
    var MUD_FX_MS = 520;
    var DAM_FX_MS = 900;
    var DAM_FLOW_MS = 1400;          // 댐이 터진 뒤 물이 쏟아져 내려가는 연출 시간
    var DAM_CRUMBLE_MS = 260;        // 마지막 금 프레임 → 터진 프레임 크로스페이드
    var GEYSER_FX_MS = 750;          // 간헐천 분출 물기둥
    var POOF_FX_MS = 420;
    var SUCK_FX_MS = 380;            // 워프 파이프에 빨려 들어가는 시간(공이 작아지며 회전)
    var WARP_COLORS = ['#e23b3b', '#3b82e2', '#f2c014'];   // 짝 파이프 띠 색 (1↔6 빨강, 2↔5 파랑, 3↔4 노랑)
    var GRAVE_DROP_MS = 450;         // 꼴찌 비석 낙하 시간
    var GRAVE_DROP_H = 160;          // 비석 낙하 시작 높이(px)
    // 카메라 (Marble Roulette 차용): 평소엔 선두를 따라가고, 남은 동물이 FINAL_K 이하가 되면 판정 대상(후미)으로 전환.
    // 골 앞 ZOOM_ZONE 안에 들어오면 줌인, 마지막 공은 서버가 준 slow 구간에서 슬로모.
    var CAM_LEAD = 0.22;             // 카메라 중심을 대상 공보다 아래(진행 방향)로 두는 비율(뷰 높이 기준)
    var CAM_SMOOTH = 6;              // /s
    var FINAL_K_MIN = 3, FINAL_K_RATIO = 0.1;
    var ZOOM_ZONE = 700;             // 골 앞 이 거리부터 줌인 시작
    var ZOOM_MAX = 1.7;
    var ZOOM_MIN = 0.5;              // 결승 프레임(범퍼·시소·진흙 + 구멍밭 + 스탠드)을 한 화면에 넣기 위한 줌아웃 하한
    var FRAME_ABOVE_PX = 400;        // 결승 프레임 위쪽 여유 — 구멍밭 위 이만큼(범퍼 3줄·시소·진흙)까지 보여 "갑자기 위에서 떨어지는" 느낌을 없앤다. 선두가 이 안에 들어오면 프레임 모드
    var MINIMAP_MAX_W = 96;          // 미니맵 최대 폭(논리 px) — 실제 트랙 배치를 축소해 그린다
    var CHUTE_SPEED = 320;           // 도착 파이프(골 → 홈통 → 자기 자리) 굴러가는 속도 px/s
    var MINIMAP_ICON_MAX = 60;       // 이 마리 수까지는 미니맵 점을 동물 공 아이콘으로, 넘으면 색 점(겹쳐서 안 읽힘)
    var MINIMAP_ICON_PX = 10;        // 미니맵 동물 얼굴 아이콘 크기
    var HUD_ICON_PX = 18;            // 꼴찌 후보 목록 동물 얼굴 아이콘 크기
    var SRC_SCALE = 0.25;            // 4x 소스 → 표시
    var CELL = 160;                  // 동물 시트 셀
    var STAND_ROW_H = 44;            // 도착 스탠드 한 줄 높이
    var STAND_MAX_ROWS = 3;          // 스탠드에 보여줄 최대 줄 수 (넘치면 첫 줄 + 마지막 줄들) — socket/marble-sim.js STAND_ROWS_MAX 와 동일
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
            'pit': A + 'pieces/pit.png', 'last-gate': A + 'pieces/last-gate.png', 'flag': A + 'pieces/flag.png',
            'windmill-pole': A + 'pieces/windmill-pole.png', 'windmill-rotor': A + 'pieces/windmill-rotor.png',
            'mole-hole': A + 'pieces/mole-hole.png', 'mole': A + 'pieces/mole.png', 'flipflop-arm': A + 'pieces/flipflop-arm.png', 'flipflop-pivot': A + 'pieces/flipflop-pivot.png',
            'belt': A + 'pieces/belt.png', 'belt-end': A + 'pieces/belt-end.png', 'fan': A + 'pieces/fan.png',
            'warp-pipe': A + 'pieces/warp-pipe.png', 'gravestone': A + 'pieces/gravestone.png', 'gap-mark': A + 'pieces/gap-mark.png',   // 4차(finale-d) — 도착 전엔 코드 도형
            'spring-plank': A + 'pieces/spring-plank.png'   // 5차(events-e) — 4셀 240×64 평평/살짝/많이 휨/튕김
        },
        stage: {
            'sky-far': A + 'stage/sky-far.png', 'meadow-tile': A + 'stage/meadow-tile.png',
            'tree': A + 'stage/decor-tree.png', 'bush-big': A + 'stage/decor-bush-big.png', 'bush-small': A + 'stage/decor-bush-small.png',
            'rock': A + 'stage/decor-rock.png', 'signpost': A + 'stage/decor-signpost.png',
            'flower-pink': A + 'stage/decor-flower-pink.png', 'flower-yellow': A + 'stage/decor-flower-yellow.png', 'flower-white': A + 'stage/decor-flower-white.png',
            'lane-dirt': A + 'stage/lane-dirt.png'   // 4차
        },
        fx: {
            'dust-puff': A + 'fx/dust-puff.png', 'impact-star': A + 'fx/impact-star.png', 'mud-splash': A + 'fx/mud-splash.png', 'curl-poof': A + 'fx/curl-poof.png',
            'bee-swarm': A + 'fx/bee-swarm.png', 'zz': A + 'fx/zz.png', 'wake': A + 'fx/wake.png', 'dam-burst': A + 'fx/dam-burst.png', 'cheer': A + 'fx/cheer.png', 'wind': A + 'fx/wind.png',
            'suck-swirl': A + 'fx/suck-swirl.png'   // 4차
        }
    };
    // 4열×1행 fx 아틀라스 셀 크기(소스) — 2차분은 의뢰서 규격
    var FX_CELL = { 'dust-puff': [80, 80], 'impact-star': [96, 96], 'mud-splash': [128, 96], 'curl-poof': [96, 96],
        'bee-swarm': [128, 96], 'zz': [48, 48], 'wake': [48, 48], 'dam-burst': [192, 128], 'cheer': [96, 96], 'wind': [96, 48], 'suck-swirl': [96, 96] };
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
    // 구멍 뚜껑 덮인 비율 0~1 — socket/marble-sim.js lidCover 와 같은 식 (hole 에 period/open/phase/slide 가 실려 온다)
    function lidCover(h, t) {
        var c = ((t + h.phase) % h.period + h.period) % h.period;
        if (c >= h.open) return 1;
        if (c < h.slide) return 1 - c / h.slide;
        if (c > h.open - h.slide) return 1 - (h.open - c) / h.slide;
        return 0;
    }
    function windmillAngle(w, t) { return 2 * Math.PI * t / w.period; }
    // 스프링 널빤지 — socket/marble-sim.js springAngle()/springSnapping() 과 동일식 (+=아래로 처짐)
    function springPhase(sp, t) { return (((t + sp.phase) % sp.period + sp.period) % sp.period) / sp.period; }
    function springAngle(sp, t) {
        var p = springPhase(sp, t), bend = sp.bendDeg * Math.PI / 180, up = -sp.upDeg * Math.PI / 180;
        if (p < sp.chargeEnd) { var k = p / sp.chargeEnd; return bend * k * k; }
        if (p < sp.snapEnd) { var k2 = (p - sp.chargeEnd) / (sp.snapEnd - sp.chargeEnd); return bend + (up - bend) * Math.min(1, k2 * 1.6); }
        var k3 = (p - sp.snapEnd) / (1 - sp.snapEnd); return up * (1 - k3);
    }
    // 주기 장치(두더지·선풍기) 켜짐 판정 — socket/marble-sim.js deviceOn 과 같은 식
    function deviceOn(d, t) { var c = ((t + d.phase) % d.period + d.period) % d.period; return c < (d.on != null ? d.on : d.up); }
    function devicePhase(d, t) { return (((t + d.phase) % d.period + d.period) % d.period) / (d.on != null ? d.on : d.up); }   // 켜진 창 안 진행도(0~1, 꺼져 있으면 >1)
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
        var ffDir = 1;             // 플립플롭 팔 방향 — flip 이벤트로 바뀐다(시크 시 조각 초기값으로 리셋)
        var onFinaleCb = null;

        R.loadAssets = loadAll;
        R.debug = function () { return { cam: cam, view: view, phase: phase, fx: fxList.length, evCursor: evCursor, simT: data && simTime(lastT) }; };

        // 캔버스 크기 → 논리 뷰
        R.resize = function () {
            var box = canvas.parentElement;
            var fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
            var fs = !!fsEl && (fsEl === box || fsEl === canvas);
            if (!fs) { canvas.style.width = ''; canvas.style.height = ''; }   // 전체화면에서 남은 인라인 크기가 박스 폭 측정에 끼지 않게
            var cssW = box ? box.clientWidth : canvas.clientWidth;
            if (!cssW) cssW = TRACK_W;   // display:none 상태(대기 중) — 0폭이면 논리폭으로 (NaN 방지)
            var cssH;
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
            balls = payload.balls.map(function (b) { return { id: b.id, owner: b.owner, creature: b.creature, colorIdx: b.colorIdx, num: b.num, dim: !!b.dim,
                x: 0, y: 0, angle: 0, state: 'roll', stateAt: 0, dizzyUntil: 0, muddy: false, squashUntil: 0, finishIdx: -1, finishAt: 0, napAt: 0, wakeAt: -1e9, sunSince: -1, dir: 1, spd: 0, landAt: 0, walkKind: '', walkStallAt: 0 }; });
            byId = {}; balls.forEach(function (b) { byId[b.id] = b; });
            // 복제 연출 순서: 2번째 마리부터 번호순(같은 번호면 id순) — 프리뷰(전부 num 1)는 spawnAt=-Infinity 라 즉시 표시
            var extras = balls.filter(function (b) { return b.num > 1; }).sort(function (a, c) { return a.num - c.num || a.id - c.id; });
            var spawnIv = extras.length ? (SPAWN_END_MS - SPAWN_START_MS) / extras.length : 0;
            balls.forEach(function (b) { b.spawnAt = -Infinity; b.landed = true; });
            extras.forEach(function (b, k) { b.spawnAt = SPAWN_START_MS + k * spawnIv; b.landed = false; });
            pieces = {}; payload.track.pieces.forEach(function (p) { (pieces[p.kind] = pieces[p.kind] || []).push(p); });
            evCursor = 0; lastT = -1; fxList = []; cam.init = false; mmCache = null; ffDir = (pieces.flipflop && pieces.flipflop[0]) ? pieces.flipflop[0].dir : 1;
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
            if (t < lastT) { evCursor = 0; fxList = []; ffDir = (pieces.flipflop && pieces.flipflop[0]) ? pieces.flipflop[0].dir : 1; balls.forEach(function (b) { b.state = 'roll'; b.finishIdx = -1; b.muddy = false; b.dizzyUntil = 0; b.wakeAt = -1e9; b.sunSince = -1; b.landAt = 0; b.walkKind = ''; b.graveLanded = false; }); }
            var ev = data.events;
            while (evCursor < ev.length && ev[evCursor].t <= t) {
                var e = ev[evCursor++];
                var b = e.ball != null ? byId[e.ball] : null;
                switch (e.type) {
                    case 'nap': b.state = 'nap'; b.napAt = e.t; break;
                    case 'wake': if (b.state === 'walk') { b.walkKind = ''; } else if (b.state !== 'done') { b.state = 'roll'; b.wakeAt = e.t; } fxList.push({ type: 'wake', ball: b.id, t0: e.t, dur: WAKE_FX_MS }); break;
                    case 'pitFall': b.state = 'pit'; b.pitAt = e.t; fxList.push({ type: 'dust', ball: b.id, t0: e.t, dur: POOF_FX_MS }); break;
                    case 'pitErupt': fxList.push({ type: 'geyser', x: e.x, y: e.y, count: e.count || 1, t0: e.t, dur: GEYSER_FX_MS }); break;
                    case 'mole': fxList.push({ type: 'mole', x: e.x, y: e.y, t0: e.t, dur: POOF_FX_MS }); b.squashUntil = e.t + 160; break;
                    case 'spring': fxList.push({ type: 'spring', x: e.x, y: e.y, t0: e.t, dur: POOF_FX_MS }); b.squashUntil = e.t + 160; break;
                    case 'flip': ffDir = e.dir; break;
                    case 'mud': b.state = 'mud'; b.muddy = true; fxList.push({ type: 'mud', ball: b.id, t0: e.t, dur: MUD_FX_MS }); break;
                    case 'mudEnd': b.state = 'roll'; b.dizzyUntil = e.t + MUD_DIZZY_MS; break;
                    case 'bump': fxList.push({ type: 'star', x: e.x, y: e.y, t0: e.t, dur: BUMP_FX_MS }); if (b) b.squashUntil = e.t + 160; break;
                    case 'bees': fxList.push({ type: 'bees', t0: e.t, dur: BEE_MS }); break;
                    case 'damCrack': break;
                    case 'damBurst': fxList.push({ type: 'damburst', t0: e.t, dur: DAM_FX_MS }); break;
                    case 'warp':   // 워프 파이프에 빨려 들어감 — 짝 파이프에서 warpOut 으로 나올 때까지 안 그린다(프레임은 이미 출구 자리)
                        b.state = 'warp';
                        fxList.push({ type: 'suck', ball: b.id, x: e.x, y: e.y, t0: e.t, dur: SUCK_FX_MS });
                        break;
                    case 'warpOut': b.state = 'roll'; fxList.push({ type: 'warpout', x: e.x, y: e.y, t0: e.t, dur: POOF_FX_MS }); break;
                    case 'land':
                        b.state = 'walk'; b.landAt = e.t; b.walkSpeed = e.speed || 95; fxList.push({ type: 'dust', ball: b.id, t0: e.t, dur: POOF_FX_MS }); break;
                    case 'trip': b.walkKind = 'trip'; b.walkStallAt = e.t; fxList.push({ type: 'star', x: b.x, y: b.y, t0: e.t, dur: BUMP_FX_MS }); break;
                    case 'doze': b.walkKind = 'doze'; b.walkStallAt = e.t; b.napAt = e.t; break;
                    case 'finish':   // 골(x ≥ goalX) 진입 또는 탈출 파이프 진입 = 도착. 여기서 순위 확정
                        b.state = 'done'; b.finishAt = e.t; b.finishIdx = data.finishOrder.indexOf(b.id);
                        fxList.push({ type: 'poof', ball: b.id, x: data.track.goalX, y: data.track.goalY, t0: e.t, dur: POOF_FX_MS });
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
                if (x1 < 0 || b.state === 'done') continue;   // 이미 도착 — 마지막 위치 유지
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
        // 진행도: 굴러오는 동안은 y, 통로에 내려 걷는 동안은 골 x 까지의 거리 (통로 안 동물은 y 가 모두 같다)
        function progress(b) { return b.state === 'walk' ? data.track.goalY + b.x : b.y; }
        function updateCamera(t, dt) {
            var goalY = data.track.goalY;
            var focus = null, remaining = 0, lead = null, rear = null;
            for (var i = 0; i < balls.length; i++) {
                var b = balls[i]; if (b.state === 'done') continue;
                remaining++;
                if (!lead || progress(b) > progress(lead)) lead = b;
                if (!rear || progress(b) < progress(rear)) rear = b;
            }
            var finalK = Math.max(FINAL_K_MIN, Math.ceil(balls.length * FINAL_K_RATIO));
            var loserB = byId[data.finishOrder[data.finishOrder.length - 1]], loserDone = !!(loserB && loserB.state === 'done');
            var hf = (pieces.holefield || [])[0];
            var wallP = (pieces.dumpwall || [])[0];
            // 결승 프레임: 선두가 구멍밭 위 FRAME_ABOVE_PX 안에 오면 (범퍼·시소·진흙)+구멍밭+스탠드를 한 화면에 고정 — 위에서 무슨 일이 벌어지는지 보이면서 후미 추적 없이 전원이 보인다
            var frameMode = hf && lead && lead.y >= hf.zone.y - FRAME_ABOVE_PX;
            cam.mode = frameMode ? 'frame' : (remaining <= finalK ? 'rear' : 'lead');
            focus = cam.mode === 'rear' ? rear : lead;
            var targetY, targetX = TRACK_W / 2, targetZoom = 1;
            if (t < 0) targetY = data.track.startY * 0.5 + 60;
            else if (loserDone) { targetX = data.track.goalX; targetY = goalY + 30; targetZoom = ZOOM_MAX * 0.8; }   // 꼴찌 확정: 골 앞 비석으로
            else if (!focus) { targetY = goalY + 40; targetX = data.track.goalX || TRACK_W / 2; targetZoom = ZOOM_MAX * 0.8; }
            else if (frameMode) {
                var standP = (pieces.stand || [])[0];
                var top = hf.zone.y - FRAME_ABOVE_PX, bottom = standP ? standP.zone.y + standP.zone.h + 10 : (wallP ? wallP.y : goalY) + 50;
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
        // 컬링은 줌을 반영한 실제 세로 시야로 — 줌아웃(결승 프레임 0.5x)에서 논리 뷰 높이로만 재면 스탠드처럼 아래쪽이 통째로 안 그려진다
        function visible(y, margin) { var half = view.h / 2 / (cam.zoom || 1), dy = y - cam.y; return dy > -half - margin && dy < half + margin; }
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
                // 햇볕 잔디 '자리'(서버 spots 타원)만 노랗게 — 밟은 놈만 느려진다. 자리마다 스프라이트(256×128) 두 장을 위아래로 겹쳐 타원(세로로 긴) 모양으로
                var sp = img('pieces', 'sun-patch');
                var spots = s.spots || [];
                spots.forEach(function (o) {
                    var cy = toScreenY(o.y);
                    var glow = ctx.createRadialGradient(o.x, cy, 10, o.x, cy, o.rx * 1.7);
                    glow.addColorStop(0, 'rgba(255,235,130,0.6)'); glow.addColorStop(1, 'rgba(255,235,130,0)');
                    ctx.fillStyle = glow; ctx.fillRect(o.x - o.rx * 1.7, cy - o.ry * 1.7, o.rx * 3.4, o.ry * 3.4);
                    if (sp) {
                        var tw = o.rx * 2.3, th = tw / 2;
                        ctx.drawImage(sp, 0, 0, 256, 128, o.x - tw / 2, cy - o.ry * 0.95 - th * 0.1, tw, th);
                        ctx.drawImage(sp, 0, 0, 256, 128, o.x - tw / 2, cy + o.ry * 0.95 - th * 0.9, tw, th);
                        ctx.drawImage(sp, 0, 0, 256, 128, o.x - tw / 2, cy - th / 2, tw, th);
                    } else { ctx.fillStyle = 'rgba(255,230,120,0.55)'; ctx.beginPath(); ctx.ellipse(o.x, cy, o.rx, o.ry, 0, 0, Math.PI * 2); ctx.fill(); }
                });
                // 햇살 반짝임 (t 파생, 결정론) — 자리 위에서만
                for (var q = 0; q < 12 && spots.length; q++) {
                    var o2 = spots[q % spots.length];
                    var ph = (Math.max(0, t) / 900 + hash01(q + 11)) % 1, a = Math.sin(ph * Math.PI);   // t<0(대기·시크)에서 음수 반지름 방지
                    var px = o2.x + (hash01(q + 5) - 0.5) * o2.rx * 1.6, py = o2.y + (hash01(q + 17) - 0.5) * o2.ry * 1.6;
                    ctx.fillStyle = 'rgba(255,255,210,' + (0.85 * a).toFixed(2) + ')';
                    ctx.beginPath(); ctx.arc(px, toScreenY(py), 1.5 + a * 2, 0, Math.PI * 2); ctx.fill();
                }
                // 팻말: 구역 입구 왼쪽
                drawSprite('stage', 'signpost', z.x + 26, z.y + 6, 64, 96, { anchor: 'bottom' });
                label('☀ 햇볕 잔디', z.x + 26, z.y - 30, '#fff7c0', 12);
                label('노란 자리를 밟으면 느려지고 잠들 수 있어요', z.x + z.w / 2, z.y + z.h - 14, '#fff7c0', 12);
            });
            (pieces.pit || []).forEach(function (pt) {
                var z = pt.zone; if (!visible(z.y + z.h / 2, z.h)) return;
                if (!drawSprite('pieces', 'pit', z.x + z.w / 2, z.y + z.h, 480, 160, { anchor: 'bottom', scale: z.w / (480 * SRC_SCALE) })) placeholderBox(z.x, z.y, z.w, z.h, 'rgba(70,45,25,0.9)', '#3b2412', '간헐천', 14);
            });
            (pieces.mud || []).forEach(function (m) {
                if (!visible(m.y, 60)) return;
                if (!drawSprite('pieces', 'mud-puddle', m.x, m.y, 192, 80, { scale: m.rx * 2 / (192 * SRC_SCALE) })) {
                    ctx.save(); ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.ellipse(m.x, toScreenY(m.y), m.rx, m.ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
                }
            });
            (pieces.wall || []).forEach(function (w) { if (visible((w.y1 + w.y2) / 2, Math.abs(w.y2 - w.y1) / 2 + 40)) drawWall(w); });
            // 끊긴 경사로의 틈(지름길) — 벽의 빈 자리를 어두운 홈으로 표시 (경사 각도대로 회전)
            (pieces.spring || []).forEach(function (sp) {   // 스프링 널빤지: 경첩(sp.x, sp.y)에 매달린 판. 에셋(4셀: 평평/살짝/많이 휨/튕김)이 오면 그 프레임, 없으면 각도대로 그린 코드 도형
                if (!visible(sp.y, 80)) return;
                var tt = Math.max(0, t), p = springPhase(sp, tt), a = sp.angle + springAngle(sp, tt);
                var frame = p < 0.3 ? 0 : p < 0.6 ? 1 : p < sp.chargeEnd ? 2 : p < sp.snapEnd + 0.06 ? 3 : 0;
                var snapping = p >= sp.chargeEnd && p < sp.snapEnd;
                var im = img('pieces', 'spring-plank');
                ctx.save(); ctx.translate(sp.x, toScreenY(sp.y));
                if (im) {   // 셀 왼쪽 끝 세로 중앙 = 경첩(의뢰서 §2-2). 경사로 각도로만 회전 — 휨은 프레임이 표현
                    ctx.rotate(sp.angle);
                    var cw = 240 * SRC_SCALE, ch = 64 * SRC_SCALE;
                    ctx.drawImage(im, frame * 240, 0, 240, 64, -6, -ch / 2, cw, ch);
                } else {
                    ctx.rotate(a);
                    ctx.fillStyle = '#6b4420'; ctx.fillRect(-4, -12, 8, 24);                                  // 경첩 기둥
                    ctx.fillStyle = '#c8873a'; ctx.strokeStyle = '#5a3416'; ctx.lineWidth = 1.5;
                    roundRect(0, -4, sp.len, 8, 3); ctx.fill(); ctx.stroke();                                 // 판
                    ctx.strokeStyle = '#8a9aa2'; ctx.lineWidth = 2; ctx.beginPath();                          // 스프링(지그재그, 처질수록 눌림)
                    var sx = sp.len * 0.6, sh = 16 - Math.max(0, springAngle(sp, tt)) * 20;
                    for (var zi = 0; zi <= 6; zi++) ctx.lineTo(sx + ((zi % 2) ? 5 : -5), 4 + sh * zi / 6); ctx.stroke();
                    ctx.fillStyle = '#5a3416'; ctx.fillRect(sx - 8, 4 + sh, 16, 3);                          // 스프링 받침
                }
                ctx.restore();
                if (snapping) { ctx.save(); ctx.strokeStyle = 'rgba(255,240,160,0.8)'; ctx.lineWidth = 2; var ex = sp.x + Math.cos(a) * sp.len, ey = toScreenY(sp.y) + Math.sin(a) * sp.len; ctx.beginPath(); ctx.moveTo(ex - 6, ey - 14); ctx.lineTo(ex - 14, ey - 30); ctx.moveTo(ex + 4, ey - 16); ctx.lineTo(ex + 2, ey - 32); ctx.stroke(); ctx.restore(); }   // 튕김 속도선
                label('스프링', sp.x + Math.cos(sp.angle) * sp.len * 0.5, sp.y + Math.sin(sp.angle) * sp.len * 0.5 + 26, '#ffe08a', 11);
            });
            (pieces.zzhole || []).forEach(function (h) {
                if (!visible(h.y, 40)) return;
                if (!drawSprite('pieces', 'gap-mark', h.x, h.y, 176, 48, { rot: h.angle, scale: h.w / (176 * SRC_SCALE) })) {   // 틈 표시(4차) — 없으면 둥근 홈
                    ctx.save(); ctx.translate(h.x, toScreenY(h.y)); ctx.rotate(h.angle);
                    ctx.fillStyle = 'rgba(40,25,10,0.85)'; roundRect(-h.w / 2, -5, h.w, 10, 5); ctx.fill();
                    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
                    ctx.restore();
                }
                label('↓', h.x, h.y - 16, '#ffe08a', 12);
            });
            (pieces.bowl || []).forEach(function (bw) {   // U자 그릇: 벽(호)은 wall 로 그려지고 여기선 안내와 바닥 틈만
                if (!visible(bw.y + bw.r, bw.r)) return;
                ctx.save(); ctx.fillStyle = 'rgba(40,25,10,0.85)'; ctx.beginPath(); ctx.ellipse(bw.x, toScreenY(bw.y + bw.r), bw.gapW / 2, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
                label('그릇 — 바닥 틈으로만 빠져요', bw.x, bw.y + bw.r * 0.55, '#fff', 12);
                label('↓', bw.x, bw.y + bw.r - 16, '#ffe08a', 12);
            });
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
            (pieces.windmill || []).forEach(function (wm) {
                if (!visible(wm.y, wm.len + wm.poleH)) return;
                // 기둥(A자) 먼저, 그 위에 회전 날개. 물리 날개 길이 len = rotor 반지름(96 소스) × 스케일
                var wsc = wm.len / (96 * SRC_SCALE);
                if (!drawSprite('pieces', 'windmill-pole', wm.x, wm.y + wm.poleH, 96, 192, { anchor: 'bottom', scale: wm.poleH / (192 * SRC_SCALE) })) {
                    ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(wm.x, toScreenY(wm.y)); ctx.lineTo(wm.x - 32, toScreenY(wm.y + wm.poleH)); ctx.moveTo(wm.x, toScreenY(wm.y)); ctx.lineTo(wm.x + 32, toScreenY(wm.y + wm.poleH)); ctx.stroke();
                }
                var ang = windmillAngle(wm, Math.max(0, t));
                if (!drawSprite('pieces', 'windmill-rotor', wm.x, wm.y, 192, 192, { rot: ang, scale: wsc })) {
                    ctx.save(); ctx.translate(wm.x, toScreenY(wm.y)); ctx.rotate(ang); ctx.strokeStyle = '#b07a3a'; ctx.lineWidth = 8; ctx.lineCap = 'round';
                    for (var bi = 0; bi < wm.blades; bi++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(wm.len, 0); ctx.stroke(); ctx.rotate(Math.PI * 2 / wm.blades); }
                    ctx.restore();
                }
                label('풍차 — 날개에 맞으면 튕겨요', wm.x, wm.y - wm.len - 16, '#fff', 12);
            });
            (pieces.mole || []).forEach(function (m) {
                if (!visible(m.y, 50)) return;
                // 두더지 구멍(경사로 각도로 회전) + 박자대로 올라오는 두더지(3프레임: 고개/반쯤/팔 벌림). 에셋 없으면 코드 도형
                var on = deviceOn(m, Math.max(0, t)), ph = devicePhase(m, Math.max(0, t));
                var pop = on ? Math.sin(Math.min(1, ph) * Math.PI) : 0;   // 올라왔다 내려감
                if (!drawSprite('pieces', 'mole-hole', m.x, m.y, 192, 96, { rot: m.angle, scale: m.r * 2 / (192 * SRC_SCALE) })) {
                    ctx.save(); ctx.translate(m.x, toScreenY(m.y)); ctx.rotate(m.angle);
                    ctx.fillStyle = 'rgba(40,25,10,0.9)'; ctx.beginPath(); ctx.ellipse(0, 0, m.r, m.r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                }
                if (pop > 0.05) {
                    var mf = pop < 0.4 ? 0 : pop < 0.75 ? 1 : 2;
                    if (!drawSprite('pieces', 'mole', m.x, m.y + 8, 96, 112, { sx: mf * 96, sw: 96, anchor: 'bottom', scale: 1.3 })) {
                        var mh = 26 * pop;
                        ctx.save(); ctx.translate(m.x, toScreenY(m.y));
                        ctx.beginPath(); ctx.rect(-m.r - 4, -60, m.r * 2 + 8, 60 + 2); ctx.clip();
                        ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.ellipse(0, -mh + 10, 12, 16, 0, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = '#f2a1b0'; ctx.beginPath(); ctx.arc(0, -mh + 2, 3.5, 0, Math.PI * 2); ctx.fill();
                        ctx.restore();
                    }
                }
            });
            (pieces.flipflop || []).forEach(function (f) {
                if (!visible(f.y, 80)) return;
                // 팔: 축에서 아래로, ffDir 쪽으로 젖힘. 라벨로 지름길/돌아가는 길 표시
                var a = f.angleDeg * Math.PI / 180, armIm = img('pieces', 'flipflop-arm');
                ctx.save(); ctx.translate(f.x, toScreenY(f.y)); ctx.rotate(-ffDir * a);
                if (armIm) ctx.drawImage(armIm, 0, 0, 40, 240, -5, -4, 10, 60);   // 축(20,16) → 표시 (0,0)
                else { ctx.fillStyle = '#c9944f'; roundRect(-5, -4, 10, f.len + 4, 4); ctx.fill(); ctx.strokeStyle = '#6b4420'; ctx.lineWidth = 1.5; ctx.stroke(); }
                ctx.restore();
                if (!drawSprite('pieces', 'flipflop-pivot', f.x, f.y, 48, 48)) { ctx.fillStyle = '#4a3420'; ctx.beginPath(); ctx.arc(f.x, toScreenY(f.y), 6, 0, Math.PI * 2); ctx.fill(); }
                label(ffDir < 0 ? '◀ 이번엔 왼쪽' : '이번엔 오른쪽 ▶', f.x, f.y - 22, '#ffe08a', 12);
                label('지름길', f.x - 125, f.y + 80, '#dfffd0', 12);
                label('돌아가는 길', f.x + 125, f.y + 80, '#ffd0d0', 12);
            });
            (pieces.belt || []).forEach(function (bt) {
                if (!visible(bt.y1, 30)) return;
                // 컨베이어: 어두운 띠 + 이동 방향으로 흐르는 밝은 줄(t 파생). 에셋 오면 belt.png 4프레임 타일로 교체
                var w = bt.x2 - bt.x1, sy = toScreenY(bt.y1);
                var beltIm = img('pieces', 'belt');
                if (beltIm) {
                    var bf = Math.floor(Math.max(0, t) / 90) % 4, tw = 64 * SRC_SCALE, th = 56 * SRC_SCALE;
                    ctx.save(); ctx.beginPath(); ctx.rect(bt.x1, sy - th / 2, w, th); ctx.clip();
                    if (bt.speed < 0) { ctx.translate(bt.x1 + bt.x2, 0); ctx.scale(-1, 1); }   // 왼쪽 흐름 = 좌우 반전(프레임은 같은 순서)
                    for (var tx = bt.x1; tx < bt.x2; tx += tw) ctx.drawImage(beltIm, bf * 64, 0, 64, 56, tx, sy - th / 2, tw + 0.5, th);
                    ctx.restore();
                    drawSprite('pieces', 'belt-end', bt.x1, bt.y1, 56, 56); drawSprite('pieces', 'belt-end', bt.x2, bt.y1, 56, 56);
                    return;
                }
                ctx.save();
                ctx.fillStyle = '#3b3b3b'; roundRect(bt.x1, sy - 7, w, 14, 5); ctx.fill();
                ctx.beginPath(); ctx.rect(bt.x1 + 2, sy - 6, w - 4, 12); ctx.clip();
                ctx.strokeStyle = 'rgba(255,220,120,0.8)'; ctx.lineWidth = 2;
                var off = ((Math.max(0, t) / 1000 * bt.speed) % 16 + 16) % 16;
                for (var sx = bt.x1 - 16 + off; sx < bt.x2 + 16; sx += 16) { ctx.beginPath(); ctx.moveTo(sx, sy - 5); ctx.lineTo(sx + (bt.speed > 0 ? 6 : -6), sy); ctx.lineTo(sx, sy + 5); ctx.stroke(); }
                ctx.restore();
                ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(bt.x1, sy, 6, 0, Math.PI * 2); ctx.arc(bt.x2, sy, 6, 0, Math.PI * 2); ctx.fill();
            });
            (pieces.fan || []).forEach(function (f) {
                if (!visible(f.y, f.band)) return;
                // 선풍기: 벽에 붙은 둥근 몸통 + 도는 날개, 켜진 동안 바람 줄(띠 전체). 에셋 오면 fan.png 2프레임으로 교체
                var on = deviceOn(f, Math.max(0, t)), sy = toScreenY(f.y), bx = f.x + f.dir * 22;
                var fanIm = img('pieces', 'fan');
                if (fanIm) {
                    var ffr = on ? Math.floor(Math.max(0, t) / 50) % 2 : Math.floor(Math.max(0, t) / 400) % 2;
                    ctx.save(); ctx.translate(bx, sy); if (f.dir < 0) ctx.scale(-1, 1);
                    ctx.drawImage(fanIm, ffr * 128, 0, 128, 128, -20, -20, 40, 40);
                    ctx.restore();
                } else {
                    ctx.save(); ctx.translate(bx, sy);
                    ctx.fillStyle = '#5a6472'; ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
                    ctx.rotate(on ? Math.max(0, t) / 60 : Math.max(0, t) / 400); ctx.fillStyle = '#c8d0da';
                    for (var bi = 0; bi < 3; bi++) { ctx.beginPath(); ctx.ellipse(0, -10, 5, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.rotate(Math.PI * 2 / 3); }
                    ctx.restore();
                }
                if (on) {
                    var windIm = img('fx', 'wind');
                    if (windIm) {
                        for (var wi = 0; wi < 8; wi++) {   // 띠 안에 바람 줄 8개 — 바람 방향으로 흐르고 멀수록 옅어짐(t 파생, 결정론)
                            var wph = ((Math.max(0, t) / 900 + hash01(wi + 31)) % 1), wx = f.x + f.dir * (40 + wph * 440), wy = f.y + (hash01(wi + 7) - 0.5) * f.band * 0.9;
                            var wfr = Math.floor(Math.max(0, t) / 110 + wi) % 4;
                            ctx.save(); ctx.translate(wx, toScreenY(wy)); if (f.dir < 0) ctx.scale(-1, 1); ctx.globalAlpha = 0.9 * (1 - wph * 0.7);
                            ctx.drawImage(windIm, wfr * 96, 0, 96, 48, -24, -12, 48, 24);
                            ctx.restore();
                        }
                    } else {
                        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]); ctx.lineDashOffset = -(Math.max(0, t) / 4) * f.dir;
                        for (var li = -2; li <= 2; li++) { var ly = sy + li * f.band / 5; ctx.beginPath(); ctx.moveTo(f.x + f.dir * 40, ly); ctx.lineTo(f.x + f.dir * 480, ly + (li % 2 ? 6 : -6)); ctx.stroke(); }
                        ctx.restore();
                    }
                    label('바람!', bx + f.dir * 60, f.y - 26, '#fff', 13);
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
                // 프레임 = 시간 진행. 서버 damHit(첫 접촉) → damBurst 사이를 [온전, 금 살짝, 금 많이, 금+물] 4단계로 나누고,
                // 터진 뒤에는 마지막 프레임(부서진 잔해)이 그대로 남는다 — 물리(터질 때까지 벽, 터지면 통과)와 화면이 일치. 사라지는 페이드 없음
                var hitEv = null, burstE = null;
                for (var ei = 0; ei < data.events.length && !(hitEv && burstE); ei++) { var ee = data.events[ei]; if (ee.type === 'damHit') hitEv = ee; else if (ee.type === 'damBurst') burstE = ee; }
                var burstEv = !!burstE && burstE.t <= t;
                var st = 0;
                if (burstEv) st = DAM_FRAMES - 1;
                else if (hitEv && burstE && t >= hitEv.t) st = Math.min(DAM_FRAMES - 2, Math.floor((t - hitEv.t) / Math.max(1, burstE.t - hitEv.t) * (DAM_FRAMES - 1)));
                var cx = (d.x1 + d.x2) / 2, w = d.x2 - d.x1;
                var gap = d.gap || null;   // 새는 틈 — 이 x 범위는 댐을 그리지 않고(클립) 물줄기만
                var dsc = w / (480 * SRC_SCALE);   // 채널 폭에 맞춤. 벽 = 셀 상단 가장자리 → 바닥 앵커를 y1 + 셀높이 로
                ctx.save();
                if (gap && !burstEv) {
                    ctx.beginPath();
                    ctx.rect(-view.w, toScreenY(d.y1) - 200, gap.x1 + view.w, 400);
                    ctx.rect(gap.x2, toScreenY(d.y1) - 200, view.w * 2, 400);
                    ctx.clip();
                }
                // 터지는 순간: 마지막 금 프레임 → 부서진 프레임을 DAM_CRUMBLE_MS 동안 크로스페이드 (툭 바뀌지 않게)
                var crumble = burstEv ? clamp((t - burstE.t) / DAM_CRUMBLE_MS, 0, 1) : 1;
                if (burstEv && crumble < 1) drawSprite('pieces', 'beaver-dam', cx, d.y1 + 256 * SRC_SCALE * dsc, 480, 256, { sx: (DAM_FRAMES - 2) * 480, sw: 480, anchor: 'bottom', scale: dsc, alpha: 1 - crumble });
                if (!drawSprite('pieces', 'beaver-dam', cx, d.y1 + 256 * SRC_SCALE * dsc, 480, 256, { sx: st * 480, sw: 480, anchor: 'bottom', scale: dsc, alpha: burstEv ? crumble : 1 })) {
                    ctx.save(); ctx.globalAlpha = burstEv ? 0.4 : 1;
                    for (var li = 0; li < 4; li++) { ctx.fillStyle = li % 2 ? '#9c6a3a' : '#7d5330'; roundRect(d.x1 + 2, toScreenY(d.y1) - 6 - li * 9, w - 4, 8, 4); ctx.fill(); }
                    if (st > 0 && st < DAM_FRAMES - 1) { ctx.strokeStyle = '#3aa0ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 6, toScreenY(d.y1) - 40); ctx.lineTo(cx + 4, toScreenY(d.y1) - 20); ctx.lineTo(cx - 2, toScreenY(d.y1)); ctx.stroke(); }
                    ctx.restore();
                    label(burstEv ? '댐이 터졌다' : st > 0 ? '비버 댐 — 금이 간다!' : '비버 댐', cx, d.y1 - 52, '#fff', 12);
                }
                ctx.restore();
                if (burstEv && t - burstE.t < DAM_FLOW_MS) {   // 터진 물이 채널을 타고 쏟아져 내려간다 — 앞머리는 아래로, 꼬리는 옅어지며 (t 파생 잔물결)
                    var fk = (t - burstE.t) / DAM_FLOW_MS, head = 60 + fk * 320, fa = 0.6 * (1 - fk * fk);
                    ctx.save(); ctx.beginPath(); ctx.rect(d.x1, toScreenY(d.y1) - 24, w, head + 24); ctx.clip();
                    var fg = ctx.createLinearGradient(0, toScreenY(d.y1) - 24, 0, toScreenY(d.y1) + head);
                    fg.addColorStop(0, 'rgba(120,190,255,' + (fa * 0.5).toFixed(2) + ')'); fg.addColorStop(0.7, 'rgba(120,190,255,' + fa.toFixed(2) + ')'); fg.addColorStop(1, 'rgba(200,240,255,0)');
                    ctx.fillStyle = fg; ctx.fillRect(d.x1, toScreenY(d.y1) - 24, w, head + 24);
                    ctx.strokeStyle = 'rgba(255,255,255,' + (fa * 0.8).toFixed(2) + ')'; ctx.lineWidth = 2;
                    for (var si = 0; si < 6; si++) { var sxx = d.x1 + 12 + si * (w - 24) / 5 + Math.sin(t / 90 + si) * 4, sy0 = toScreenY(d.y1) + ((t / 6 + si * 37) % Math.max(1, head)); ctx.beginPath(); ctx.moveTo(sxx, sy0); ctx.lineTo(sxx + 2, sy0 + 14); ctx.stroke(); }
                    ctx.restore();
                }
                if (gap && !burstEv) {   // 틈으로 새는 물줄기 (t 파생 흔들림)
                    ctx.save();
                    var gx = (gap.x1 + gap.x2) / 2, gw = gap.x2 - gap.x1;
                    ctx.fillStyle = 'rgba(90,170,255,0.55)';
                    ctx.fillRect(gap.x1 + 3, toScreenY(d.y1) - 30, gw - 6, 30);
                    ctx.strokeStyle = 'rgba(230,245,255,0.85)'; ctx.lineWidth = 2;
                    for (var wi = 0; wi < 3; wi++) {
                        var wx = gap.x1 + 8 + wi * (gw - 16) / 2, wph = (Math.max(0, t) / 260 + wi * 0.33) % 1;
                        ctx.beginPath(); ctx.moveTo(wx, toScreenY(d.y1) - 30 + wph * 10); ctx.lineTo(wx + 2, toScreenY(d.y1) + 6 + wph * 20); ctx.stroke();
                    }
                    ctx.restore();
                    label('틈!', gx, d.y1 - 40, '#dff4ff', 11);
                }
                if (!burstEv) label('부딪히면 크게 튕겨요', cx, d.y1 - 64, '#fff', 11);
                if (!drawSprite('pieces', 'beaver', d.beaverX, d.y1 + 26, 96, 96, { sx: st > 0 ? 96 : 0, sw: 96, anchor: 'bottom', scale: 1.3 })) {
                    ctx.fillStyle = '#6b4423'; ctx.beginPath(); ctx.ellipse(d.beaverX, toScreenY(d.y1) - 48, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
                    if (st > 0) label('!', d.beaverX, d.y1 - 68, '#fff', 14);
                }
            });
            (pieces.holefield || []).forEach(function (hf) {
                var z = hf.zone; if (!visible(hf.floorY, z.h + 100)) return;
                // 구멍 + 파이프: 어두운 구멍(타원) 위에 '골' 표시, 파이프 안쪽은 어둡게. 뚜껑은 서버와 같은 lidCover 로 왼쪽부터 덮는다
                hf.holes.forEach(function (h, i) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(40,25,10,0.95)';
                    ctx.fillRect(h.x - h.w / 2 + 2, toScreenY(h.y), h.w - 4, hf.pipeH);
                    ctx.beginPath(); ctx.ellipse(h.x, toScreenY(h.y), h.w / 2, 8, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 2; ctx.stroke();
                    var cover = h.period ? lidCover(h, Math.max(0, t)) : 0;
                    if (cover > 0) {   // 나무 뚜껑
                        var lw = h.w * cover, lx = h.x - h.w / 2;
                        ctx.fillStyle = '#c9944f'; roundRect(lx, toScreenY(h.y) - 5, lw, 10, 3); ctx.fill();
                        ctx.strokeStyle = '#7a4d22'; ctx.lineWidth = 1.5; ctx.stroke();
                        ctx.strokeStyle = 'rgba(120,70,30,0.5)'; ctx.beginPath(); for (var gx = lx + 8; gx < lx + lw - 4; gx += 10) { ctx.moveTo(gx, toScreenY(h.y) - 3); ctx.lineTo(gx, toScreenY(h.y) + 3); } ctx.stroke();
                    }
                    ctx.restore();
                    label(cover >= 1 ? '닫힘' : '골', h.x, h.y - 14, cover >= 1 ? '#ffb3a0' : '#ffe08a', 11);
                    if (h.period) label(i === 0 ? '자주 열림' : i === hf.holes.length - 1 ? '가끔 열림' : '', h.x, h.y + hf.pipeH + 10, '#fff', 10);
                });
                label('🕳 골 구멍 — 골에 가까울수록 뚜껑이 가끔 열려요', z.x + z.w / 2, z.y - 16, '#fff', 13);
            });
            (pieces.lane || []).forEach(function (ln) {
                if (!visible(ln.y, 80)) return;
                // 흙길 + 골 선 + 안내
                ctx.save();
                var dirt = img('stage', 'lane-dirt'), lty = toScreenY(ln.y - ln.h / 2);   // 4차 흙길 타일(256×240 → 64×60 가로 반복) — 없으면 반투명 갈색
                if (dirt) { ctx.beginPath(); ctx.rect(ln.x0, lty, ln.x1 - ln.x0, ln.h); ctx.clip(); for (var dx = ln.x0; dx < ln.x1; dx += 64) ctx.drawImage(dirt, 0, 0, 256, 240, dx, lty, 64, ln.h); }
                else { ctx.fillStyle = 'rgba(150,115,70,0.55)'; ctx.fillRect(ln.x0, lty, ln.x1 - ln.x0, ln.h); }
                ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(ln.goalX, toScreenY(ln.y - ln.h / 2)); ctx.lineTo(ln.goalX, toScreenY(ln.y + ln.h / 2)); ctx.stroke();
                ctx.restore();
                label('골', ln.goalX, ln.y - ln.h / 2 - 10, '#ffe08a', 12);
                label('→ 떨어진 자리에서 골까지 달려요 — 골에 들어간 순서가 순위', (ln.x0 + ln.x1) / 2, ln.y + ln.h / 2 + 12, '#fff', 11);
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
            // 워프 파이프 — 공 위에 그려서 들어갈 때 파이프 속으로 사라지고 나올 때 파이프 안에서 솟는다. 몸통 48×56, 입구 위. 짝은 같은 색 띠 + 번호
            (pieces.warp || []).forEach(function (q) {
                if (!visible(q.y, 80)) return;
                var col = WARP_COLORS[q.color % WARP_COLORS.length], top = toScreenY(q.y), bw = q.bodyW, bh = q.bodyH;
                if (!drawSprite('pieces', 'warp-pipe', q.x, q.y + bh, 192, 224, { anchor: 'bottom' })) {   // 5차 에셋(녹색 마리오 파이프 1장) — 없으면 코드 도형
                    ctx.save();
                    ctx.fillStyle = '#2f9e44'; ctx.fillRect(q.x - bw / 2 + 3, top + 10, bw - 6, bh - 10);                 // 몸통
                    ctx.fillStyle = '#1e7a33'; ctx.fillRect(q.x + bw / 2 - 11, top + 10, 8, bh - 10);                    // 몸통 그늘
                    ctx.fillStyle = '#37b24d'; roundRect(q.x - bw / 2, top, bw, 12, 3); ctx.fill();                      // 입구 테
                    ctx.fillStyle = '#0b1a10'; ctx.beginPath(); ctx.ellipse(q.x, top + 2, q.w / 2, 4, 0, 0, Math.PI * 2); ctx.fill();   // 구멍
                    ctx.restore();
                }
                ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = col; ctx.fillRect(q.x - bw / 2 + 3, top + 20, bw - 6, 9); ctx.restore();   // 짝 색 띠(코드 틴트)
                label(String(q.idx + 1), q.x, q.y + 42, '#fff', 13);
            });
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
        // 이름표: 공 옆에 주인 이름(플레이어 색 알약). 번호 대신 누구 동물인지 바로 읽히게. 긴 이름은 앞 6자 + …
        function drawNameTag(b, cx, cy, strong) {
            var name = String(b.owner || ''); if (name.length > 6) name = name.slice(0, 6) + '…';
            ctx.save();
            ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            var w = ctx.measureText(name).width + 8, h = 12;
            ctx.fillStyle = ringColor(b); roundRect(cx - w / 2, cy - h / 2, w, h, 6); ctx.fill();
            if (strong) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
            ctx.fillStyle = '#fff'; ctx.fillText(name, cx, cy + 0.5);
            ctx.restore();
        }
        function drawRing(b, x, y, r, strong) {
            ctx.save();
            ctx.strokeStyle = ringColor(b); ctx.lineWidth = strong ? 4 : 2.5; ctx.globalAlpha = strong ? 1 : 0.85;
            if (strong) { ctx.shadowColor = ringColor(b); ctx.shadowBlur = 8; }
            ctx.beginPath(); ctx.arc(x, toScreenY(y), r, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
            drawNameTag(b, x, toScreenY(y) - r - 7, strong);
        }
        // 공이 아닐 때(서 있음·걷기·잠·엎어짐)의 표식: 링 없이 머리 옆 번호 배지만 — 링은 구를 때만(스프라이트 원에 딱 맞게)
        function drawBadge(b, x, y, strong) {
            drawNameTag(b, x, toScreenY(y) - 22 - (b.id % 2) * 9, strong);   // 출발대에서 옆 공과 이름표가 겹치지 않게 지그재그
        }
        // 작은 동물 아이콘(HUD·미니맵용): 서 있는 프레임(row 0, col 0)의 얼굴 부분(FACE_CROP)을 원으로 잘라 size px 로 + 플레이어 색 테두리. 화면 좌표 그대로(toScreenY 없음)
        var FACE_CROP = { x: 22, y: 6, w: 116, h: 116 };   // 160 셀 안에서 머리가 들어오는 정사각 영역(소스 px)
        function drawMiniIcon(b, sx, sy, size, strong) {
            var im = img('creatures', b.creature);
            var r = size / 2;
            ctx.save();
            if (im) {
                ctx.imageSmoothingEnabled = true;
                ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.clip();
                ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(sx - r, sy - r, size, size);
                ctx.drawImage(im, FACE_CROP.x, FACE_CROP.y, FACE_CROP.w, FACE_CROP.h, sx - r, sy - r, size, size);
                ctx.restore(); ctx.save();
                ctx.strokeStyle = ringColor(b); ctx.lineWidth = strong ? 2 : 1.2;
                ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
            } else {
                ctx.fillStyle = ringColor(b); ctx.beginPath(); ctx.arc(sx, sy, r * 0.7, 0, Math.PI * 2); ctx.fill();
            }
            if (strong) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx, sy, r + 1.5, 0, Math.PI * 2); ctx.stroke(); }
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
        function inSunZone(b) {   // 잔디 '자리'(타원) 안에 있을 때만 — 서버 SUN_SPOTS 와 동일
            var sz = (pieces.sunpatch || [])[0]; if (!sz || !sz.spots) return false;
            for (var i = 0; i < sz.spots.length; i++) { var o = sz.spots[i], dx = (b.x - o.x) / o.rx, dy = (b.y - o.y) / o.ry; if (dx * dx + dy * dy < 1) return true; }
            return false;
        }
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
            for (i = 0; i < balls.length; i++) { b = balls[i]; if (b.state === 'done' || b.state === 'warp' || !visible(b.y, 40) || t < b.spawnAt) continue; drawShadow(b.x, b.y, b.state === 'roll' ? BALL_R : NAP_R); }
            // 후미 공(플레이어별) — 꼴찌 깃발 대상
            var rearByOwner = {};
            for (i = 0; i < balls.length; i++) { b = balls[i]; if (b.state === 'done') continue; if (!rearByOwner[b.owner] || b.y < rearByOwner[b.owner].y) rearByOwner[b.owner] = b; }
            for (i = 0; i < balls.length; i++) {
                b = balls[i];
                if (b.state === 'done' || b.state === 'warp' || !visible(b.y, 40)) continue;   // warp = 파이프 속(안 보임)
                mine = b.owner === myName;
                if (t < 0) {
                    // 카운트다운·대기 프리뷰: 서 있음 → 웅크림. 서 있는 프레임(≈32px 높이, 발이 y+25)은 공 링(r17)보다 커서 삐져나오므로
                    // 공이 되기 전까지는 발밑 마커(플레이어 색 타원 + 번호)로, 완전히 말린 뒤에만 링을 그린다
                    if (t < b.spawnAt) continue;   // 아직 안 나온 복제 마리
                    var dropK = clamp((t - b.spawnAt) / SPAWN_DROP_MS, 0, 1);   // spawnAt=-Infinity → 1(착지 상태)
                    var dropOff = (1 - dropK) * (1 - dropK) * SPAWN_DROP_H;     // 위에서 가속 낙하
                    if (!b.landed && dropK >= 1) { b.landed = true; fxList.push({ type: 'dust', ball: b.id, t0: t, dur: POOF_FX_MS }); }
                    var by = b.y - dropOff;
                    var curled = false;
                    if (b.dim) ctx.globalAlpha = 0.45;   // 대기 프리뷰: 동물은 골랐지만 아직 준비 안 한 사람(반투명)
                    if (t < CURL_START_MS) drawCreatureFrame(b, 0, Math.floor((t + 100000) / 140) % 4, b.x, by + 8);
                    else { var cf = Math.min(3, Math.floor((t - CURL_START_MS) / 110)); curled = cf === 3; drawCreatureFrame(b, 1, cf, b.x, by + (curled ? 0 : 8)); }
                    if (curled) drawRing(b, b.x, by, BALL_R + 1, mine);
                    else drawBadge(b, b.x, by, mine);
                    ctx.globalAlpha = 1;
                    continue;
                }
                if (b.state === 'pit') {
                    // 간헐천에 빠짐: 공 모양 그대로 반쯤 잠겨 어둡게 + 물결/거품 (t 파생), 튀어 오르기 직전 흔들림
                    var ps = t - (b.pitAt || 0), sink = Math.min(1, ps / 250);
                    ctx.save(); ctx.globalAlpha = 0.55;
                    drawCreatureFrame(b, 2, 0, b.x, b.y + 8 * sink, b.angle, 0.85);
                    ctx.restore();
                    ctx.save(); ctx.fillStyle = 'rgba(120,200,255,0.55)';
                    for (var bi = 0; bi < 3; bi++) { var bt = ((t / 500) + hash01(b.id * 5 + bi)) % 1; ctx.beginPath(); ctx.arc(b.x - 10 + bi * 10 + Math.sin(t / 150 + bi) * 2, toScreenY(b.y + 6) - bt * 18, 2 + (1 - bt) * 1.5, 0, Math.PI * 2); ctx.fill(); }
                    ctx.restore();
                    drawBadge(b, b.x, b.y + 4, mine);
                    continue;
                }
                if (b.state === 'nap') {
                    // 잠든 포즈 — 2차 sleep 스트립 없으면 1차 faceplant col 2(엎어짐) 프레임
                    var sl = img('sleep', b.creature);
                    if (sl) { var sf = Math.floor(t / 400) % 2; ctx.save(); ctx.translate(b.x, toScreenY(b.y)); ctx.drawImage(sl, sf * CELL, 0, CELL, CELL, -20, -22, 40, 40); ctx.restore(); }
                    else drawCreatureFrame(b, 4, 2, b.x, b.y - 4);
                    drawBadge(b, b.x, b.y, mine);
                    // zz
                    var zt = (t - b.napAt) % 900; var zy = b.y - 20 - zt / 45; var za = 1 - zt / 900;
                    if (!img('fx', 'zz')) label(zt < 450 ? 'z' : 'Z', b.x + 14, zy, 'rgba(255,255,255,' + za.toFixed(2) + ')', 12);
                    else drawSprite('fx', 'zz', b.x + 14, zy - 4, 48, 48, { sx: Math.floor(zt / 225) * 48, sw: 48, alpha: za, scale: 1.3 });
                    continue;
                }
                if (b.state === 'walk') {   // 집결 통로: 펴져서 오른쪽으로 걷는다 (충돌 없음 — 겹쳐서 제 속도로)
                    if (b.walkKind === 'trip' && t - b.walkStallAt < 700) {   // 넘어짐 — 엎어진 프레임
                        drawShadow(b.x, b.y, BALL_R); drawCreatureFrame(b, 4, t - b.walkStallAt < 200 ? 1 : 2, b.x, b.y - 4);
                        drawBadge(b, b.x, b.y, mine); continue;
                    }
                    if (b.walkKind === 'doze') {   // 졸음 — sleep 시트 + zz
                        var slw = img('sleep', b.creature);
                        if (slw) { var sfw = Math.floor(t / 400) % 2; ctx.save(); ctx.translate(b.x, toScreenY(b.y)); ctx.drawImage(slw, sfw * CELL, 0, CELL, CELL, -20, -22, 40, 40); ctx.restore(); }
                        else drawCreatureFrame(b, 4, 2, b.x, b.y - 4);
                        drawBadge(b, b.x, b.y, mine);
                        var ztw = (t - b.walkStallAt) % 900, zyw = b.y - 20 - ztw / 45;
                        if (!drawSprite('fx', 'zz', b.x + 14, zyw - 4, 48, 48, { sx: Math.floor(ztw / 225) * 48, sw: 48, alpha: 1 - ztw / 900, scale: 1.3 })) label('z', b.x + 14, zyw, '#fff', 12);
                        continue;
                    }
                    var ws = t - b.landAt;
                    var stepMs = 140 * 95 / (b.walkSpeed || 95);   // 빠른 놈은 발을 빨리 구른다
                    var wrow = ws < SUN_UNCURL_MS ? 3 : 0, wcol = ws < SUN_UNCURL_MS ? (ws < SUN_UNCURL_MS / 2 ? 0 : 1) : Math.floor(ws / stepMs) % 4;
                    var wim = img('creatures', b.creature);
                    if (wim) { ctx.save(); ctx.translate(b.x, toScreenY(b.y + 6)); ctx.drawImage(wim, wcol * CELL, wrow * CELL, CELL, CELL, -CELL * SRC_SCALE / 2, -CELL * SRC_SCALE / 2, CELL * SRC_SCALE, CELL * SRC_SCALE); ctx.restore(); }
                    else drawCreatureFrame(b, 2, 0, b.x, b.y, 0);
                    drawBadge(b, b.x, b.y, mine);
                    if (b.walkSpeed >= 125) label('💨', b.x - 18, b.y - 4, '#fff', 11);   // 빠른 놈 표시
                    else if (b.walkSpeed <= 72) label('🐢', b.x - 18, b.y - 4, '#fff', 10);   // 굼벵이
                    continue;
                }
                if (b.state === 'mud') { drawCreatureFrame(b, 2, 3, b.x, b.y); drawBadge(b, b.x, b.y, mine); continue; }
                // 깨어남 직후: sleep 시트 col 2(눈 번쩍) → col 3(벌떡) 후 다시 공
                if (t - b.wakeAt < WAKE_POSE_MS && img('sleep', b.creature)) {
                    var wf = (t - b.wakeAt) < WAKE_POSE_MS / 2 ? 2 : 3;
                    ctx.save(); ctx.translate(b.x, toScreenY(b.y)); ctx.drawImage(img('sleep', b.creature), wf * CELL, 0, CELL, CELL, -20, -22, 40, 40); ctx.restore();
                    drawBadge(b, b.x, b.y, mine);
                    continue;
                }
                // 햇볕 잔디에서 느려짐 → 펴져서 걷는 모습 (느려지는 이유가 화면에서 읽히게)
                if (inSunZone(b) && b.spd < SUN_WALK_SPEED && t > 0) {
                    if (b.sunSince < 0) b.sunSince = t;
                    drawSunWalker(b, t);
                    drawBadge(b, b.x, b.y, mine);
                    continue;
                }
                b.sunSince = -1;
                var col = 0;
                if (t < b.squashUntil) col = 1; else if (t < b.dizzyUntil) col = 3; else if (b.muddy) col = 2;
                drawCreatureFrame(b, 2, col, b.x, b.y, col === 1 ? 0 : b.angle);
                drawRing(b, b.x, b.y, BALL_R + 1, mine);   // 구를 때만 링 — 공 스프라이트(지름 28)에 딱 맞게
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
        // 스탠드 배치 계산 — 판자/홈통(동물 뒤에 깔림)과 도착 동물(동물 위에 그림)이 같은 값을 쓴다
        function standLayout() {
            var st = (pieces.stand || [])[0]; if (!st) return null;
            var z = st.zone, cols = st.cols || 10;
            var finishedCount = 0;
            for (var i = 0; i < balls.length; i++) if (balls[i].state === 'done') finishedCount++;
            var rows = Math.ceil(Math.max(1, finishedCount) / cols);
            var rowMap = {};
            if (rows <= STAND_MAX_ROWS) { for (var r = 0; r < rows; r++) rowMap[r] = r; }
            else { rowMap[0] = 0; for (var r2 = rows - (STAND_MAX_ROWS - 1); r2 < rows; r2++) rowMap[r2] = r2 - (rows - STAND_MAX_ROWS); }
            var ln = (pieces.lane || [])[0];
            var chute = (st.chuteY != null && ln) ? { x: st.chuteX, y: st.chuteY, h: st.chuteH || 24, top: ln.y + ln.h / 2 } : null;
            return { st: st, z: z, cols: cols, colW: z.w / cols, rows: rows, rowMap: rowMap, shownRows: Math.min(rows, STAND_MAX_ROWS), ln: ln, chute: chute };
        }
        // 스탠드 판자 + 도착 파이프(홈통) — 동물보다 먼저 그린다. 통로가 2~3열이면 아래 줄 동물 발이 통로 바닥 아래로 내려오는데, 뒤에 그리면 홈통이 그 발을 가린다
        function drawStandBase(t) {
            var L = standLayout(); if (!L) return;
            var z = L.z, chute = L.chute;
            var mid = img('pieces', 'start-platform-mid');
            for (var sr = 0; sr < L.shownRows; sr++) {
                var py = z.y + sr * STAND_ROW_H;
                if (!visible(py, STAND_ROW_H)) continue;
                if (mid) { for (var x = z.x; x < z.x + z.w; x += 32) ctx.drawImage(mid, 0, 0, 128, 96, x, toScreenY(py + 22), Math.min(32, z.x + z.w - x), 24); }
                else { ctx.fillStyle = 'rgba(160,110,60,0.85)'; ctx.fillRect(z.x, toScreenY(py + 22), z.w, 24); }
            }
            if (L.rows > STAND_MAX_ROWS) label('··· ' + (L.rows - STAND_MAX_ROWS) * L.cols + '마리 더 ···', z.x + z.w / 2, z.y + STAND_ROW_H - 4, '#fff', 11);
            // 도착 파이프: 골 x 에서 통로 바닥 아래로 떨어져(세로 관) 스탠드 위 홈통을 왼쪽으로 굴러가 자기 자리에 떨어진다 — 텔레포트 없음
            if (chute && visible(chute.y, 60)) {
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.ellipse(chute.x, toScreenY(chute.top), 16, 6, 0, 0, Math.PI * 2); ctx.fill();   // 통로 바닥 구멍
                ctx.fillStyle = '#7d5330'; ctx.fillRect(chute.x - 16, toScreenY(chute.top), 32, chute.y + chute.h / 2 - chute.top);                    // 세로 관
                roundRect(z.x - 12, toScreenY(chute.y - chute.h / 2), chute.x + 16 - (z.x - 12), chute.h, 6); ctx.fill();                                // 홈통
                ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(z.x - 8, toScreenY(chute.y - chute.h / 2) + 4, chute.x + 12 - (z.x - 8), chute.h - 8, 4); ctx.fill();
                ctx.strokeStyle = 'rgba(255,220,160,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(z.x - 12, toScreenY(chute.y - chute.h / 2) + 0.5); ctx.lineTo(chute.x + 16, toScreenY(chute.y - chute.h / 2) + 0.5); ctx.stroke();
                ctx.restore();
            }
        }
        // 도착 동물: 파이프 이동 중이면 그 위치에 공으로, 자리에 도착했으면 순위 배지와 함께 판자 위에
        function drawCheerStand(t) {
            var L = standLayout(); if (!L) return;
            var z = L.z, cols = L.cols, colW = L.colW, rowMap = L.rowMap, chute = L.chute, ln = L.ln;
            var total = data.finishOrder.length;
            var lastId = data.finishOrder[total - 1];
            for (var i2 = 0; i2 < balls.length; i2++) {
                var b = balls[i2];
                if (b.state !== 'done') continue;
                var idx = b.finishIdx;
                if (b.id === lastId && idx === total - 1) continue;   // 꼴찌는 골 앞 판자벽 자리 비석(drawLastBall)
                var row = Math.floor(idx / cols), col = idx % cols;
                if (rowMap[row] == null) continue;
                var x2 = z.x + colW * (col + 0.5), y2 = z.y + rowMap[row] * STAND_ROW_H + 18;   // 홈통(스탠드 위) 아래, 판자(+22) 위에 서도록
                var since = t - b.finishAt;
                if (chute) {   // 홈통 이동 중이면 그 위치에 공으로 — 골 x 에서 내려가 홈통을 따라 왼쪽으로 굴러 자기 자리로
                    var d0 = chute.y - ln.y, d1 = chute.x - x2, d2 = (y2 - 6) - chute.y, dist = since / 1000 * CHUTE_SPEED;
                    if (dist < d0 + d1 + d2) {
                        var px, py;
                        if (dist < d0) { px = chute.x; py = ln.y + dist; }
                        else if (dist < d0 + d1) { px = chute.x - (dist - d0); py = chute.y; }
                        else { px = x2; py = chute.y + (dist - d0 - d1); }
                        if (!visible(py, 40)) continue;
                        drawCreatureFrame(b, 2, 0, px, py, -dist / BALL_R, 0.85);
                        drawRing(b, px, py, BALL_R * 0.85 + 1, b.owner === myName);
                        continue;
                    }
                    since -= (d0 + d1 + d2) / CHUTE_SPEED * 1000;   // 자리에 떨어진 뒤 경과
                }
                if (!visible(y2, 40)) continue;
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
        // 꼴찌 연출: 골에 도착한 그 자리에 비석이 떨어진다. (판자벽까지 걸어가던 예전 연출은 x≈715 라 결승 카메라 밖이었다)
        function drawLastBall(t) {
            var lastId = data.finishOrder[data.finishOrder.length - 1];
            var b = byId[lastId];
            if (!b || b.state !== 'done') return;
            var since = t - b.finishAt;
            var x = data.track.goalX + BALL_R, y = data.track.goalY;   // 골 선 넘어 판자벽 앞
            // 비석: 위에서 가속 낙하 → 쿵(먼지). 동물은 비석이 깔리기 전까지만 엎어져 있고, 깔리는 순간 펑 하고 사라진다(비석이 동물을 대신한다)
            var k = clamp(since / GRAVE_DROP_MS, 0, 1);
            var drop = (1 - k) * (1 - k) * GRAVE_DROP_H;
            if (k < 1) {
                var frame = since < 150 ? 0 : since < 320 ? 1 : 2;
                drawShadow(x, y, BALL_R + 2);
                drawCreatureFrame(b, 4, frame, x, y - 6, 0, 1.15);
            }
            if (!b.graveLanded && k >= 1) { b.graveLanded = true; fxList.push({ type: 'dust', x: x, y: y + 6, t0: t, dur: POOF_FX_MS }); fxList.push({ type: 'poof', x: x, y: y - 6, t0: t, dur: POOF_FX_MS }); }
            if (since > GRAVE_DROP_MS + 250) {   // 비석 뒤 은은한 빛 (먼저 그려 비석을 덮지 않게). 화면 전체를 어둡게 하는 스포트라이트는 통로·스탠드와 겹쳐 뺐다
                ctx.save();
                var glow = ctx.createRadialGradient(x, toScreenY(y - 10), 6, x, toScreenY(y - 10), 70);
                glow.addColorStop(0, 'rgba(255,240,170,0.55)'); glow.addColorStop(1, 'rgba(255,240,170,0)');
                ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, toScreenY(y - 10), 70, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
            drawGravestone(x, y + 8 - drop, since - GRAVE_DROP_MS);
            drawNameTag(b, x, toScreenY(y) - 48, true);
            if (since > GRAVE_DROP_MS + 250) {
                label(b.owner + ' 님의 ' + (CREATURE_NAMES[b.creature] || '') + ' ' + b.num + '번', x, y - 62, '#fff', 15);
                label('꼴찌 확정… 당첨!', x, y + 40, '#ffd166', 17);
            }
        }
        // 비석 (코드 도형): 둥근 머리 회색 돌 + "꼴찌". yBase = 바닥(월드). sinceLand<120ms 동안 착지 눌림
        function drawGravestone(x, yBase, sinceLand) {
            var w = 30, h = 42;
            var squash = (sinceLand >= 0 && sinceLand < 120) ? 1 - 0.18 * (1 - sinceLand / 120) : 1;
            ctx.save();
            ctx.translate(x, toScreenY(yBase)); ctx.scale(1 / Math.sqrt(squash), squash);
            var gim = img('pieces', 'gravestone');   // 4차 비석(128×160, 하단 정렬, 글자 없음) — 없으면 코드 도형
            if (gim) { var gw = 128 * SRC_SCALE, gh = 160 * SRC_SCALE; ctx.drawImage(gim, 0, 0, 128, 160, -gw / 2, -gh, gw, gh); }
            else {
                ctx.fillStyle = '#9aa1ab'; ctx.strokeStyle = '#3b4149'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h + w / 2); ctx.arc(0, -h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(w / 2, 0); ctx.closePath();
                ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#6f767f'; ctx.fillRect(-w / 2 - 4, -3, w + 8, 4);   // 받침돌
            }
            ctx.fillStyle = '#2b2f36'; ctx.font = 'bold 10px "Jua", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('꼴찌', 0, -h / 2 + 2);
            ctx.restore();
        }

        // ─── fx ───
        function drawFx(t) {
            fxList.forEach(function (f) {
                var age = t - f.t0, k = age / f.dur, frame = Math.min(3, Math.floor(k * 4));
                var b = f.ball != null ? byId[f.ball] : null;
                var x = f.x != null ? f.x : (b ? b.x : 0), y = f.y != null ? f.y : (b ? b.y : 0);
                switch (f.type) {
                    case 'suck': {   // 파이프에 빨려 들어감: 공이 돌며 작아지고 가라앉는다
                        if (!visible(y, 40) || !b) return;
                        var kk = Math.min(1, k);
                        drawCreatureFrame(b, 2, 0, x, y + kk * 6, kk * Math.PI * 3, 1 - kk * 0.9);
                        drawSprite('fx', 'suck-swirl', x, y - 4, 96, 96, { sx: frame * 96, sw: 96, alpha: 0.9 });   // 소용돌이(없으면 생략)
                        if (kk < 0.7) label('슝!', x, y - 28 - kk * 20, 'rgba(160,225,255,' + (1 - kk).toFixed(2) + ')', 13);
                        break;
                    }
                    case 'warpout':   // 짝 파이프에서 뿅
                        if (!visible(y, 40)) return;
                        if (!drawSprite('fx', 'curl-poof', x, y, 96, 96, { sx: frame * 96, sw: 96, alpha: 1 - k })) { ctx.fillStyle = 'rgba(255,255,255,' + (1 - k) + ')'; ctx.beginPath(); ctx.arc(x, toScreenY(y), 8 + k * 14, 0, Math.PI * 2); ctx.fill(); }
                        label('뿅!', x, y - 26 - k * 20, 'rgba(255,240,160,' + (1 - k).toFixed(2) + ')', 14);
                        break;
                    case 'star': if (!visible(y, 40)) return; if (!drawSprite('fx', 'impact-star', x, y, 96, 96, { sx: frame * 96, sw: 96 })) label('✦', x, y - 10 - k * 10, 'rgba(255,255,160,' + (1 - k).toFixed(2) + ')', 16); break;
                    case 'mud': if (!visible(y, 40)) return; if (!drawSprite('fx', 'mud-splash', x, y - 8, 128, 96, { sx: frame * 128, sw: 128 })) { ctx.fillStyle = 'rgba(90,60,30,' + (1 - k) + ')'; ctx.beginPath(); ctx.arc(x, toScreenY(y) - 12 - k * 14, 6 - k * 4, 0, Math.PI * 2); ctx.fill(); } break;
                    case 'dust': if (!visible(y, 40)) return; if (!drawSprite('fx', 'dust-puff', x, y, 80, 80, { sx: frame * 80, sw: 80, alpha: 1 - k })) { ctx.fillStyle = 'rgba(230,220,200,' + (1 - k) + ')'; ctx.beginPath(); ctx.arc(x, toScreenY(y), 8 + k * 14, 0, Math.PI * 2); ctx.fill(); } break;
                    case 'mole': if (!visible(y, 40)) return; drawSprite('fx', 'dust-puff', x, y + 4, 80, 80, { sx: frame * 80, sw: 80, alpha: 1 - k }); label('쿵!', x, y - 18 - k * 24, 'rgba(255,240,160,' + (1 - k).toFixed(2) + ')', 13); break;
                    case 'spring': if (!visible(y, 40)) return; if (!drawSprite('fx', 'impact-star', x, y - 6, 96, 96, { sx: frame * 96, sw: 96 })) label('✦', x, y - 10, 'rgba(255,255,160,' + (1 - k).toFixed(2) + ')', 16); label('튕!', x - 10, y - 26 - k * 30, 'rgba(255,240,160,' + (1 - k).toFixed(2) + ')', 15); break;
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
                    case 'geyser': {   // 간헐천 분출: 물기둥(위로 늘어나며 옅어짐) + 물방울 + 흙먼지 + 라벨
                        if (!visible(y, 120)) return;
                        ctx.save();
                        var gh = 40 + k * 150, gw = 26 + Math.min(40, (f.count || 1) * 3);
                        var grd = ctx.createLinearGradient(0, toScreenY(y), 0, toScreenY(y) - gh);
                        grd.addColorStop(0, 'rgba(140,210,255,' + (0.8 * (1 - k)).toFixed(2) + ')'); grd.addColorStop(1, 'rgba(200,240,255,0)');
                        ctx.fillStyle = grd; ctx.beginPath(); ctx.ellipse(x, toScreenY(y) - gh / 2, gw / 2 * (1 - k * 0.4), gh / 2, 0, 0, Math.PI * 2); ctx.fill();
                        for (var q = 0; q < 14; q++) { var qa = (hash01(q + 21) - 0.5) * 1.6, qs = 60 + hash01(q + 33) * 120; var qx = x + Math.sin(qa) * qs * k, qy = y - Math.cos(qa) * qs * k + 200 * k * k; ctx.fillStyle = 'rgba(150,215,255,' + (1 - k).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(qx, toScreenY(qy), 3, 0, Math.PI * 2); ctx.fill(); }
                        ctx.restore();
                        drawSprite('fx', 'dust-puff', x - 24, y, 80, 80, { sx: frame * 80, sw: 80, alpha: 1 - k, scale: 1.6 }); drawSprite('fx', 'dust-puff', x + 24, y, 80, 80, { sx: frame * 80, sw: 80, alpha: 1 - k, scale: 1.6 });
                        if (k < 0.6) label('펑!', x, y - 60 - k * 40, '#fff', 18);
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
            var loser = byId[data.finishOrder[data.finishOrder.length - 1]];
            for (var i = 0; i < balls.length; i++) { var b = balls[i]; if (b.state === 'done') continue; rem++; if (!rearByOwner[b.owner] || progress(b) < progress(rearByOwner[b.owner])) rearByOwner[b.owner] = b; }
            var worst = Object.keys(rearByOwner).map(function (o) { return rearByOwner[o]; }).sort(function (a, b) { return progress(a) - progress(b); }).slice(0, 5);
            if (loser && loser.state === 'done') { rem = 0; worst = []; }   // 꼴찌(골에 마지막으로 들어간 놈) 확정 = 피날레
            hudInfo = { remaining: rem, worst: worst };
        }
        // 미니맵 — 좌측 세로 스트립: 구간 띠 + 공 점(플레이어 색, 내 공 크게) + 현재 화면 범위. 리플레이 시각 기준이라 모든 클라 동일.
        // 미니맵 — 좌측 세로 스트립에 실제 트랙 배치(벽·말뚝·장치·구멍·통로·스탠드)를 축소해 그린다. 정적 부분은 오프스크린 캐시,
        // 공 점(플레이어 색, 내 공 크게)과 현재 화면 범위만 매 프레임. 리플레이 시각 기준이라 모든 클라 동일.
        var mmCache = null;
        function buildMinimapCache(sc, w, h, dpr, startY) {
            var c = document.createElement('canvas'); c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
            var g = c.getContext('2d'); g.scale(dpr, dpr);
            var X = function (wx) { return wx * sc; }, Y = function (wy) { return (wy - startY) * sc; };
            var dot = function (x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
            var ell = function (x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2); g.fill(); };
            g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, w, h);
            g.fillStyle = 'rgba(110,170,80,0.5)'; g.fillRect(0, Y(data.track.startY - 30), w, h);
            data.track.pieces.forEach(function (p) {
                switch (p.kind) {
                    case 'platform': g.fillStyle = '#b48a5a'; g.fillRect(X(p.zone.x), Y(p.zone.y), p.zone.w * sc, p.zone.h * sc); break;
                    case 'wall': g.strokeStyle = '#e0bd82'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(p.x1), Y(p.y1)); g.lineTo(X(p.x2), Y(p.y2)); g.stroke(); break;
                    case 'stake': g.fillStyle = '#d9a35c'; g.fillRect(X(p.x) - 0.6, Y(p.y) - 0.6, 1.2, 1.2); break;
                    case 'log': g.fillStyle = '#a06a35'; dot(X(p.x), Y(p.y), Math.max(1.5, p.r * sc)); break;
                    case 'warp': g.fillStyle = WARP_COLORS[p.color % WARP_COLORS.length]; g.fillRect(X(p.x) - 1.5, Y(p.y), 3, Math.max(2, p.bodyH * sc)); break;
                    case 'mud': g.fillStyle = '#5a3d22'; ell(X(p.x), Y(p.y), p.rx * sc, p.ry * sc); break;
                    case 'sunpatch': g.fillStyle = '#f2e27a'; (p.spots || []).forEach(function (o) { ell(X(o.x), Y(o.y), o.rx * sc, o.ry * sc); }); break;
                    case 'beehive': g.fillStyle = '#e6b73a'; dot(X(p.x), Y(p.y), 2.5); break;
                    case 'dam': g.fillStyle = '#7fa6d6'; g.fillRect(X(p.x1), Y(p.y1) - 1.5, (p.x2 - p.x1) * sc, 3); if (p.gap) { g.fillStyle = '#bfefff'; g.fillRect(X(p.gap.x1), Y(p.y1) - 1.5, (p.gap.x2 - p.gap.x1) * sc, 3); } break;
                    case 'pit': g.fillStyle = '#2b1a0a'; ell(X(p.zone.x + p.zone.w / 2), Y(p.zone.y + p.zone.h / 2), p.zone.w * sc / 2, p.zone.h * sc / 2); break;
                    case 'windmill': g.strokeStyle = '#e0bd82'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(p.x - p.len), Y(p.y)); g.lineTo(X(p.x + p.len), Y(p.y)); g.moveTo(X(p.x), Y(p.y - p.len)); g.lineTo(X(p.x), Y(p.y + p.len)); g.stroke(); break;
                    case 'mole': g.fillStyle = '#5a3d22'; dot(X(p.x), Y(p.y), 1.8); break;
                    case 'spring': g.strokeStyle = '#ffd166'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(p.x), Y(p.y)); g.lineTo(X(p.x + Math.cos(p.angle) * p.len), Y(p.y + Math.sin(p.angle) * p.len)); g.stroke(); break;
                    case 'flipflop': g.strokeStyle = '#ffe08a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(p.x), Y(p.y)); g.lineTo(X(p.x - 20), Y(p.y + 40)); g.moveTo(X(p.x), Y(p.y)); g.lineTo(X(p.x + 20), Y(p.y + 40)); g.stroke(); break;
                    case 'belt': g.strokeStyle = '#ffd166'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(p.x1), Y(p.y1)); g.lineTo(X(p.x2), Y(p.y2)); g.stroke(); break;
                    case 'fan': g.fillStyle = '#c8d0da'; g.beginPath(); g.moveTo(X(p.x), Y(p.y - 12)); g.lineTo(X(p.x + p.dir * 24), Y(p.y)); g.lineTo(X(p.x), Y(p.y + 12)); g.closePath(); g.fill(); break;
                    case 'seesaw': g.strokeStyle = '#c9944f'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(p.x - p.len / 2), Y(p.y)); g.lineTo(X(p.x + p.len / 2), Y(p.y)); g.stroke(); break;
                    case 'holefield': g.fillStyle = '#1e1208'; p.holes.forEach(function (hh) { g.fillRect(X(hh.x - hh.w / 2), Y(hh.y), Math.max(1.5, hh.w * sc), Math.max(2, p.pipeH * sc)); }); break;
                    case 'lane': g.fillStyle = 'rgba(150,115,70,0.85)'; g.fillRect(X(p.x0), Y(p.y - p.h / 2), (p.x1 - p.x0) * sc, Math.max(2, p.h * sc)); g.fillStyle = '#ffe08a'; g.fillRect(X(p.goalX) - 0.5, Y(p.y - p.h / 2), 1, Math.max(2, p.h * sc)); break;
                    case 'stand': g.fillStyle = '#c9a26a'; g.fillRect(X(p.zone.x), Y(p.zone.y), p.zone.w * sc, p.zone.h * sc); break;
                }
            });
            return c;
        }
        function drawMinimap(t) {
            var x0 = 12, y0 = 44, hMax = view.h - 60;
            var startY = data.track.startY - 40, endY = data.track.endY;
            var sc = Math.min(hMax / (endY - startY), MINIMAP_MAX_W / TRACK_W);
            var w = TRACK_W * sc, h = (endY - startY) * sc;
            var key = w.toFixed(1) + ':' + h.toFixed(1) + ':' + view.scale + ':' + data.track.pieces.length;
            if (!mmCache || mmCache.key !== key) mmCache = { key: key, canvas: buildMinimapCache(sc, w, h, view.scale, startY) };
            var mx = function (wx) { return x0 + wx * sc; }, my = function (wy) { return y0 + (wy - startY) * sc; };
            ctx.save();
            ctx.drawImage(mmCache.canvas, x0, y0, w, h);
            // 공: 마리 수가 적으면 동물 공 아이콘(플레이어 색 테두리, 내 공은 흰 테두리 추가), 많으면 색 점. 내 공은 맨 위에
            var useIcon = balls.length <= MINIMAP_ICON_MAX;
            var mine = [];
            for (var i = 0; i < balls.length; i++) {
                var b = balls[i]; if (b.state === 'done' || t < 0) continue;
                if (b.owner === myName) { mine.push(b); continue; }
                if (useIcon) drawMiniIcon(b, mx(b.x), my(b.y), MINIMAP_ICON_PX, false);
                else { ctx.fillStyle = ringColor(b); ctx.beginPath(); ctx.arc(mx(b.x), my(b.y), 1.7, 0, Math.PI * 2); ctx.fill(); }
            }
            for (var mi = 0; mi < mine.length; mi++) {
                var mb = mine[mi];
                if (useIcon) drawMiniIcon(mb, mx(mb.x), my(mb.y), MINIMAP_ICON_PX + 3, true);
                else { ctx.fillStyle = ringColor(mb); ctx.beginPath(); ctx.arc(mx(mb.x), my(mb.y), 2.8, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
            }
            // 현재 화면 범위
            var vw = view.w / cam.zoom, vh = view.h / cam.zoom;
            var rx = clamp(mx(cam.x - vw / 2), x0, x0 + w), ry = clamp(my(cam.y - vh / 2), y0, y0 + h);
            var rw = Math.min(x0 + w, mx(cam.x + vw / 2)) - rx, rh = Math.min(y0 + h, my(cam.y + vh / 2)) - ry;
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(rx, ry, Math.max(3, rw), Math.max(3, rh));
            ctx.restore();
        }

        function drawHud(t) {
            ctx.save();
            ctx.font = 'bold 14px "Jua", sans-serif'; ctx.textBaseline = 'top';
            var spawned = 0; if (t < 0) for (var si = 0; si < balls.length; si++) if (t >= balls[si].spawnAt) spawned++;
            var txt = phase === 'idle' ? (balls.length ? '출발대 대기 ' + balls.length + '마리' : '출발대') : t < 0 ? '출발 준비… ' + spawned + ' / ' + balls.length + '마리' : (hudInfo.remaining > 0 ? '남은 동물 ' + hudInfo.remaining + '마리' : '꼴찌 확정!');
            ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(8, 8, ctx.measureText(txt).width + 20, 26, 8); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(txt, 18, 13);
            if (t >= 0 && hudInfo.worst.length) {
                ctx.font = 'bold 12px "Jua", sans-serif';
                var y = 8, w = 150;
                ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(view.w - w - 8, y, w, 22 + hudInfo.worst.length * 18, 8); ctx.fill();
                ctx.fillStyle = '#ffd166'; ctx.fillText('🚩 꼴찌 후보', view.w - w, y + 5);
                hudInfo.worst.forEach(function (b, i) {
                    var yy = y + 24 + i * 18;
                    drawMiniIcon(b, view.w - w + 9, yy + 7, HUD_ICON_PX, b.owner === myName);
                    ctx.fillStyle = b.owner === myName ? '#fff' : '#e8e8e8';
                    var name = b.owner.length > 8 ? b.owner.slice(0, 8) + '…' : b.owner;
                    ctx.fillText(name + ' ' + b.num + '번', view.w - w + 18, yy);
                });
            }
            drawMinimap(t);
            if (phase === 'idle') {
                if (!balls.length) {
                    ctx.font = 'bold 18px "Jua", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.fillStyle = '#fff';
                    ctx.strokeText('동물을 고르고 준비하면 출발대에 섭니다', view.w / 2, view.h * 0.6); ctx.fillText('동물을 고르고 준비하면 출발대에 섭니다', view.w / 2, view.h * 0.6);
                }
            } else if (t < 0) {
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
            drawStandBase(t);
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

        // 대기 화면 — 출발대 프리뷰. preview = 서버 marble:stateUpdated.preview { track, balls, frame } (준비한 사람의 동물이 출발대에 서 있음).
        // 카운트다운 전 구간(IDLE_T)을 한 프레임 그린다 — 재생 루프 없음. preview 가 없으면 하늘만.
        R.drawIdle = function (preview, me) {
            R.stop();
            if (preview && preview.track) {
                R.setTimeline({ track: preview.track, balls: preview.balls, frames: [preview.frame], sampleMs: 100, events: [], finishOrder: [], durationMs: 0, slow: null }, me);
                phase = 'idle';
                R.render(IDLE_T, 0);
                return;
            }
            phase = 'idle'; data = null;
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
