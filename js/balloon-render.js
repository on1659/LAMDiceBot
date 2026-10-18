/* 풍선 타기(balloon) 렌더러 — (서버 타임라인, 재생 시각) → 화면. docs/goal/balloon-climb.md §4-1·§7.
   물리 없음: 동물 위치는 서버 frames 를 보간하고, 상태(불기·터짐·낙하산·착지·도착)는 events 로만 바뀐다.
   장애물 위치는 BalloonWorld 의 시각 함수(서버 시뮬과 같은 식)로 다시 계산해 그린다. 그림은 목업 mockups/balloon-climb.html 그대로.
   공정성: 이 파일은 결과를 정하지 않는다. 자체 난수는 장식(구름·별)용 고정 시드 mulberry32 뿐이다.
   재생 제어(js/balloon.js · js/deguri-replay-gif.js 계약): play(delayMs) · stop · pause · resume · seek(ms) · time() · isPlaying · isPaused */
(function () {
    'use strict';
    var BW = window.BalloonWorld;
    var R = BW.R, Z = BW.Z, WORLD_W = BW.WORLD_W, BODY = BW.BODY, BAL_OFF = BW.BAL_OFF;

    var COUNTDOWN_MS = 4000;          // 서버 socket/balloon.js COUNTDOWN_MS 와 같은 값 — 마지막 R.inflate 초 동안 풍선을 분다
    var VIEW_ASPECT = 1.5;            // 캔버스 세로 = 가로 × 이 값(위로 오르는 게임이라 세로로 길게)
    var VIEW_MIN_H = 360;             // 캔버스 최소 높이(px)
    var VIEW_PAD_H = 150;             // 창 높이에서 뺄 여백 — 캔버스가 창보다 길어지지 않게
    var MAX_DPR = 2;
    var TAP_PX = 40, DRAG_PX = 6;     // 동물 탭 반경 · 끌기 문턱(목업)
    var TOAST_MS = 1100;              // 토스트 한 줄 표시(시뮬 시각 ms)
    var POP_FX_MS = 700, DUST_FX_MS = 400, SHAKE_MS = 180, DECIDE_SHAKE_MS = 200;
    var SEEK_SNAP_MS = 500;           // 이보다 크게 건너뛰면(이동 막대) 카메라를 바로 옮기고 소리를 안 낸다
    var NAME_MAX = 6;
    var SAFE_BLINK_HZ = 12;
    // 2차(docs/goal/balloon-climb.md §11)
    var MANUAL_IDLE_RETURN_MS = 3000;  // 끌어서 옮긴 카메라는 이만큼 입력이 없으면 자동으로(데구리와 같은 값). 동물 따라가기는 유지
    var CAM_EASE = 7, CAM_EASE_FAST = 16, CAM_EDGE = 0.3;   // 자동 추적 — 목표가 화면 가운데에서 CAM_EDGE×높이 넘게 벗어나면 빠르게 따라잡는다
    var RANK_ROW = 18, RANK_NAME_MAX = 5, RANK_MAX_H = 0.55, RANK_COLLAPSED = 3;   // 순위표 한 줄 높이·이름 글자 수·최대 높이(캔버스 비율)·접혔을 때 줄 수
    var SMILE_MS = 1400;               // ^ ^ 말풍선 — 다리·구름 착지, 아이템 먹은 뒤
    var BUMP_FX_MS = 350, WARP_FX_MS = 600, ITEM_FX_MS = 600, SHIELD_FX_MS = 450, CLOUD_SQUISH_MS = 350;
    var BEAVER = { cell: 96, worldH: 30, n: 3 };   // 데구리 beaver-v2.webp 96×96 ×4(통나무 밀기 2칸 · 놀람 · 도망) — 세이브 다리에 서 있는 비버 수
    var PIPE = { rimTop: 8, bodyW: 101, rimW: 135 };   // 데구리 warp-pipe.webp 192×224 — 몸통 폭(px)을 R.warpBodyW 로 맞춘다
    var SKY_BANDS = [   // 높이(cam/worldH)에 따라 겹쳐 그리는 먼 배경 — [이름, 보이기 시작, 다 보임, 사라지기 시작, 다 사라짐]
        ['sky-mid', 0.08, 0.22, 0.45, 0.6], ['sky-high', 0.45, 0.6, 0.72, 0.85], ['sky-top', 0.72, 0.85, 2, 2]];

    // 게임 그림 색(캔버스) — 스킨과 무관(목업 C)
    var C = { skyLow: [159, 211, 245], skyHigh: [34, 44, 98], star: '#ffffff', cloud: '#ffffff', ground: '#7cc24a', groundDark: '#4e9a2e',
        plat: '#9b6a3c', platDark: '#6e4624', platTop: '#7cc24a', spike: '#8a5a2b', spikeTip: '#3a2a1a', string: '#4a4a4a', hand: '#f2c58d', ink: '#3a2a1a',
        tag: '#ffffff', tagInk: '#14110f', tagMe: '#ffd166', finish: '#c8281a', chuteA: '#ffffff', chuteB: '#ff5a5f', warn: '#e63946', warnInk: '#ffffff',
        wind: 'rgba(255,255,255,0.75)', alt: 'rgba(255,255,255,0.55)', gauge: 'rgba(0,0,0,0.25)', count: '#ffffff', countInk: '#14110f', popInk: '#ffffff',
        rock: '#8b7765', rockDark: '#5e4e40', thorn: '#2f5e1f', blade: '#e3b071', bladeDark: '#7a4f24', bladeTip: '#d64545', hub: '#5a3a1a', chain: '#5b5b5b',
        storm: '#4b5066', stormHi: '#8a90a8', bolt: '#ffe066', boltZone: 'rgba(255,224,102,0.18)',
        door: '#a7b1bc', doorDark: '#5c6773', updraft: 'rgba(255,255,255,0.18)', updraftArrow: 'rgba(255,255,255,0.7)',
        sign: '#ffffff', signInk: '#14110f', hinge: '#3a2a1a', platHint: 'rgba(255,255,255,0.75)', hud: 'rgba(20,17,15,0.72)', hudInk: '#ffffff' };
    var BALLOON = ['#ff5a5f', '#ffb400', '#3db4f2', '#7ed957', '#c77dff', '#ff8fab', '#ff7b29', '#2ec4b6'];
    var SPRITE = { frames: 4, size: 160, fps: 7 };          // 동물 시트 row 0 = 서기 4칸(데구리 manifest)
    var EAGLE = { cell: 256, h: 160, frames: 4, fps: 10, w: 92 };
    var STAR = { cell: 96, frames: 4 };
    var BAL_SPRITE = { w: 96, h: 128, knotX: 48, knotY: 106, worldH: 46 };   // 야식 풍선(deguri_balloon) 셀·매듭 — docs/goal/deguri-balloon-accessory.md 계약
    var CAUSE_TEXT = { spike: '가시에 찔렸다', blade: '풍차에 펑!', pend: '통나무에 펑!', bolt: '번개에 펑!', bee: '벌한테 펑!', thorn: '가시벽에 펑!', eagle: '독수리한테 펑!', finale: '풍선이 펑!' };
    var ITEM_TEXT = { super: '슈퍼 풍선!', shield: '방패!' };
    // 풍선 타기 전용 그림(assets/balloon/, SpriteMake 2026-10-18 — 의뢰서 docs/spritemake-request/2026-10-18-balloon-sprites.md, 도구 AutoTest/spritemake/balloon-sheet.py)
    //  creatures/{동물}-{hang|blow|fall}.webp : 4×1, 칸 160, 오른쪽 향함. hang 은 줄 토막 꼭대기가 (HANG_ANCHOR) — 풍선 줄·낙하산 줄이 여기 붙는다
    //  props/balloon.webp : 칸 96×120, 행 = 색(BALLOON 순서), c0 풍선(매듭 아래 끝 BAL_KNOT) · c1~c3 터짐
    //  props/chute.webp : 칸 160×112, c0 접힘 → c3 펼침, 캐노피 아랫단 가운데 = CHUTE_RIM
    //  props/{chestnut,storm,storm-flash,gravestone,bolt,plank,thorn,shutter}.webp
    //  스킨은 creatures/{동물}-{스킨}-{kind}.webp(데구리 deguri_skin 전부) — 없으면 기본 동물 포즈로 그린다(서기·착지는 스킨 시트 그대로)
    var BA = '/assets/balloon/', BVER = '?v=1';
    var HANG_ANCHOR = [80, 4];
    var MOUTH = { hedgehog: [141, 91], armadillo: [145, 95], pillbug: [139, 102], turtle: [146, 100], panda: [141, 84], hamster: [141, 92], pufferfish: [145, 100], raccoon: [142, 89], rabbit: [133, 89], ribbonpig: [131, 78] };   // blow 칸 분홍 꼭지 끝(입) — balloon-sheet.py mouth 로 잰 값
    var BAL_CELL = { w: 96, h: 120, knotX: 48, knotY: 116, bodyW: 88, popCY: 60 };
    var CHUTE = { w: 160, h: 112, rimX: 80, rimY: 108, openW: 150, worldW: 60, lift: 30 };
    var POSE_FPS = { hang: 5, blow: 4, fall: 10 };
    var GRAVE_WORLD_H = 58;            // 비석 키(세계 단위) — 몸(44)보다 커야 끝 장면의 주인공이 된다

    var A = '/assets/deguri/', VER = '?v=6';   // 데구리 에셋 그대로(js/deguri-render.js ASSET_VER 와 같은 캐시 키)
    var CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'];
    var PIECES = { eagle: 'pieces/eagle.webp', beam: 'pieces/start-platform-mid.webp', fan: 'pieces/fan.webp', hive: 'pieces/beehive.webp', plog: 'pieces/pendulum-log.webp',
        pivot: 'pieces/pendulum-pivot.webp', flag: 'pieces/flag.webp', star: 'fx/impact-star.webp', swarm: 'fx/bee-swarm.webp', wind: 'fx/wind.webp', dust: 'fx/dust-puff.webp',
        beaver: 'pieces/beaver-v2.webp', pipe: 'pieces/warp-pipe.webp', skyFar: 'stage/sky-far.webp',
        meadow: 'stage/meadow-tile.webp', tree: 'stage/decor-tree.webp', bush: 'stage/decor-bush-big.webp', bushS: 'stage/decor-bush-small.webp', rotor: 'pieces/windmill-rotor.webp' };
    var images = {}, loadState = 0, loadWaiters = [], instances = [];
    function image(path) {
        var im = images[path];
        if (!im) {
            im = new Image(); im.src = A + path + VER; images[path] = im;
            im.addEventListener('load', function () { instances.forEach(function (r) { r.redrawIfIdle(); }); }, { once: true });   // 스킨·야식은 처음 쓸 때 받는다 — 멈춘 화면(대기·일시정지·끝 장면)도 도착하면 다시 그린다
        }
        return im;
    }
    var ok = function (im) { return !!im && im.complete && im.naturalWidth > 0; };
    function sheet(creature, skin) {
        if (skin) { var sk = image('creatures/' + creature + '-' + skin + '.webp'); if (ok(sk)) return sk; if (sk.complete) return image('creatures/' + creature + '.webp'); }
        return image('creatures/' + creature + '.webp');
    }
    function balloonSprite(name) { return image('accessories/' + name + '.webp'); }
    function loadAssets(cb) {
        if (loadState === 2) { if (cb) cb(); return; }
        if (cb) loadWaiters.push(cb);
        if (loadState === 1) return;
        loadState = 1;
        ['balloon', 'chute', 'chestnut', 'storm', 'storm-flash', 'gravestone', 'bolt', 'plank', 'thorn', 'shutter', 'item-box', 'super-balloon', 'shield', 'cloud'].forEach(BP);
        SKY_BANDS.forEach(function (b) { bimage('bg/' + b[0] + '.webp'); });   // 풍선 타기 소품 — 기다리지 않는다(없으면 코드 도형)
        var list = CREATURES.map(function (c) { return 'creatures/' + c + '.webp'; }).concat(Object.keys(PIECES).map(function (k) { return PIECES[k]; }));
        var left = list.length;
        var done = function () { if (--left > 0) return; loadState = 2; var w = loadWaiters; loadWaiters = []; w.forEach(function (f) { f(); }); };
        list.forEach(function (p) { var im = image(p); if (im.complete) done(); else { im.addEventListener('load', done, { once: true }); im.addEventListener('error', done, { once: true }); } });
    }
    var P = function (k) { return image(PIECES[k]); };
    var bimages = {};
    function bimage(path) {
        var im = bimages[path];
        if (!im) {
            im = new Image(); im.src = BA + path + BVER; bimages[path] = im;
            im.addEventListener('load', function () { instances.forEach(function (r) { r.redrawIfIdle(); }); }, { once: true });
        }
        return im;
    }
    var BP = function (k) { return bimage('props/' + k + '.webp'); };
    // 포즈 시트 — 스킨이면 {동물}-{스킨}-{kind} 를 먼저(없거나 아직 못 받았으면 기본 동물 것). 둘 다 없으면 null → 코드 도형
    function poseSheet(p, kind) {
        if (p.skin) { var sk = bimage('creatures/' + p.creature + '-' + p.skin + '-' + kind + '.webp'); if (ok(sk)) return sk; }
        var im = bimage('creatures/' + p.creature + '-' + kind + '.webp'); return ok(im) ? im : null;
    }

    // 장식 — 고정 시드(판과 무관)
    function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    var decoRng = mulberry32(7);
    var CLOUDS = []; for (var ci = 0; ci < 22; ci++) CLOUDS.push({ x: decoRng(), y: 200 + ci * 150 + decoRng() * 100, s: 0.6 + decoRng() * 0.8 });
    var STARS = []; for (var si = 0; si < 70; si++) STARS.push({ x: decoRng(), y: decoRng(), r: 0.6 + decoRng() * 1.2 });

    var clamp = BW.clamp;
    function shortName(n) { var c = Array.from(String(n || '')); return c.length > NAME_MAX ? c.slice(0, NAME_MAX).join('') + '…' : c.join(''); }

    function create(canvas, opts) {
        var ctx = canvas.getContext('2d');
        var box = canvas.parentElement;
        var W = 0, H = 0, dpr = 1, s = 1;
        var mode = 'idle';                 // idle | play
        var tl = null, me = '', idle = null, map = null, people = [];
        var cam = 0, camMode = 'auto', drag = null;
        var playing = false, paused = false, delay = 0, t0 = 0, pauseAt = 0, raf = 0, lastRender = 0;
        var lastSim = -1, finaleFired = false, onFinaleCb = null, onEventCb = null;
        var flaps = [];
        var toastEl = null, camBtn = null, toastText = '';
        var lastInput = 0, rankOpen = false, rankHits = [], rankToggle = null;

        // ── DOM: 카메라 복귀 버튼 · 토스트(캔버스 박스 안, 캔버스에 그리지 않음 — C-41) ──
        if (box && !(opts && opts.offscreen)) {
            toastEl = document.createElement('div'); toastEl.className = 'balloon-toast'; toastEl.setAttribute('aria-live', 'polite'); box.appendChild(toastEl);
            camBtn = document.createElement('button'); camBtn.type = 'button'; camBtn.className = 'balloon-cam-btn'; camBtn.hidden = true; box.appendChild(camBtn);
            camBtn.addEventListener('click', function () { setCam('auto'); });
        }
        function setCam(m) {
            camMode = m;
            if (camBtn) {
                camBtn.hidden = m === 'auto';
                camBtn.textContent = m === 'free' ? '카메라 고정 · 자동으로' : m !== 'auto' ? shortName(m.name) + ' 따라가기 · 자동으로' : '';
            }
            if (!playing) redraw();
        }

        // ── 좌표 ──
        var sx = function (x) { return x * s; };
        var sy = function (y) { return H / 2 - (y - cam) * s; };
        var worldH = function () { return map ? map.worldH : 4800; };
        var camMin = function () { return (H / 2 - 70) / s; };
        var camMax = function () { return Math.max(camMin(), worldH() + 170 - H / 2 / s); };

        function resize() {
            var fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
            var fs = (!!fsEl && (fsEl === box || fsEl === canvas)) || (box && box.classList.contains('is-pseudo-fs'));
            if (!fs) { canvas.style.width = ''; canvas.style.height = ''; }
            var cssW = (box && box.clientWidth) || canvas.clientWidth || WORLD_W, cssH;
            if (fs) { cssW = Math.min(window.innerWidth, window.innerHeight / VIEW_ASPECT * 1.2); cssH = window.innerHeight; }
            else cssH = Math.round(Math.max(VIEW_MIN_H, Math.min(cssW * VIEW_ASPECT, window.innerHeight - VIEW_PAD_H)));
            dpr = (opts && opts.dpr) || Math.min(MAX_DPR, window.devicePixelRatio || 1);
            W = cssW; H = cssH;
            canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
            canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
            s = W / WORLD_W;
            cam = clamp(cam, camMin(), camMax());
            if (!playing) redraw();
        }

        // ── 타임라인 준비: 공마다 상태 전환 열 · 토스트 · 연출 ──
        function setTimeline(data, myName) {
            tl = data; me = myName || ''; map = data.map; idle = null;
            var n = data.players.length;
            people = data.players.map(function (p, i) {
                return { id: p.id, name: p.owner, creature: p.creature, skin: p.skin || null, balloon: p.balloon || null, color: BALLOON[(p.colorIdx != null ? p.colorIdx : i) % BALLOON.length], colorIdx: p.colorIdx != null ? p.colorIdx : i,
                    ph: i * 1.7 + 0.3, trans: [{ t: 0, st: 'rise', safe: false }], pops: [], finishT: -1, superIv: [], shieldIv: [], smiles: [], warps: [] };
            });
            var byId = {}; people.forEach(function (p) { byId[p.id] = p; });
            var nameOf = function (id) { return byId[id] ? byId[id].name : ''; };
            tl.toasts = [{ t: 0, text: '출발!' }];
            tl.spikeFall = {}; tl.popFx = []; tl.dust = []; tl.eagles = []; tl.gusts = []; tl.decided = null; tl.grave = null;
            tl.bridgeT = {}; tl.boxTaken = {}; tl.fx = []; tl.cloudHit = {};   // 2차: 다리 놓인 시각 · 상자 먹힌 시각들 · 짧은 연출(퉁·쏙·뿅·방패 깨짐·아이템) · 구름 착지
            var openIv = function (list, t) { list.push({ a: t, b: Infinity }); };
            var closeIv = function (list, t) { var last = list[list.length - 1]; if (last && last.b === Infinity) last.b = t; };
            var warpsOf = map.warps || [];
            people.forEach(function (p) { ['hang', 'blow', 'fall'].forEach(function (k) { bimage('creatures/' + p.creature + '-' + k + '.webp'); if (p.skin) bimage('creatures/' + p.creature + '-' + p.skin + '-' + k + '.webp'); }); });
            var curEagle = null;
            data.events.forEach(function (e) {
                var p = e.ball != null ? byId[e.ball] : null;
                switch (e.type) {
                    case 'pop':
                        closeIv(p.shieldIv, e.t); closeIv(p.superIv, e.t);
                        p.trans.push({ t: e.t, st: e.cause === 'finale' ? 'fdrop' : 'pop' }); p.pops.push(e.t);   // 피날레 펑 = 낙하산 없이 바로 떨어진다
                        tl.popFx.push({ t: e.t, x: e.x, y: e.y, color: p.color, row: (p.colorIdx || 0) % BALLOON.length });
                        if (e.spike != null) tl.spikeFall[e.spike] = e.t;
                        tl.toasts.push({ t: e.t, text: shortName(p.name) + ' ' + (e.cause === 'spike' ? '펑! ' : '') + (CAUSE_TEXT[e.cause] || '펑!') });
                        break;
                    case 'drop': p.trans.push({ t: e.t, st: 'drop' }); break;
                    case 'chute': p.trans.push({ t: e.t, st: 'chute' }); break;
                    case 'land':
                        p.trans.push({ t: e.t, st: 'land' }); tl.dust.push({ t: e.t, ball: e.ball });
                        if (e.plat <= -2) p.smiles.push(e.t);   // 세이브 다리에 섰다
                        else if (e.plat >= 0 && map.plats[e.plat].kind === 'cloud') { p.smiles.push(e.t); (tl.cloudHit[e.plat] = tl.cloudHit[e.plat] || []).push(e.t); }
                        break;
                    case 'bridge': tl.bridgeT[e.idx] = e.t; tl.toasts.push({ t: e.t, text: '세이브! 비버들이 다리를 놓았다' }); break;
                    case 'item':
                        (tl.boxTaken[e.box] = tl.boxTaken[e.box] || []).push(e.t); p.smiles.push(e.t);
                        openIv(e.kind === 'super' ? p.superIv : p.shieldIv, e.t);
                        tl.fx.push({ t: e.t, type: 'item', ball: e.ball, kind: e.kind });
                        tl.toasts.push({ t: e.t, text: shortName(p.name) + ' ' + ITEM_TEXT[e.kind] });
                        break;
                    case 'superEnd': closeIv(p.superIv, e.t); break;
                    case 'shieldEnd': closeIv(p.shieldIv, e.t); break;
                    case 'shieldPop':
                        closeIv(p.shieldIv, e.t); tl.fx.push({ t: e.t, type: 'shield', ball: e.ball });
                        tl.toasts.push({ t: e.t, text: shortName(p.name) + ' 방패로 막았다!' });
                        break;
                    case 'warp': {
                        var wf = warpsOf[e.from], wt = warpsOf[e.to], up = wt && wf && wt.y > wf.y;
                        p.trans.push({ t: e.t, st: 'warp' }); p.warps.push(e.t);
                        if (wf) tl.fx.push({ t: e.t, type: 'warpIn', x: wf.x, y: wf.top });
                        tl.toasts.push({ t: e.t, text: shortName(p.name) + (up ? ' 인생역전! 위로 슝~' : ' 하수구로 쏙!') });
                        break;
                    }
                    case 'warpOut': p.trans.push({ t: e.t, st: 'drop' }); tl.fx.push({ t: e.t, type: 'warpOut', x: e.x, y: e.y }); break;
                    case 'bump': tl.fx.push({ t: e.t, type: 'bump', a: e.a, b: e.b }); break;
                    case 'inflate': p.trans.push({ t: e.t, st: 'inflate', dur: e.dur }); break;
                    case 'rise': p.trans.push({ t: e.t, st: 'rise', safe: true }); break;
                    case 'finish': p.trans.push({ t: e.t, st: 'done' }); p.finishT = e.t; break;
                    case 'shock': p.trans.push({ t: e.t, st: 'shock' }); break;
                    case 'grave': p.trans.push({ t: e.t, st: 'grave' }); tl.grave = { t: e.t, ball: e.ball, x: e.x, y: e.y }; break;
                    case 'gust': tl.gusts.push({ t: e.t, dur: e.dur, dir: e.dir }); tl.toasts.push({ t: e.t, text: e.dir > 0 ? '돌풍 →' : '← 돌풍' }); break;
                    case 'eagleWarn': curEagle = { warnT: e.t, flyT: Infinity, ball: e.ball, dir: e.dir }; tl.eagles.push(curEagle); tl.toasts.push({ t: e.t, text: '독수리가 ' + shortName(nameOf(e.ball)) + '를 노린다!' }); break;
                    case 'eagleFly': if (curEagle) curEagle.flyT = e.t; break;
                    case 'eagleMiss': tl.toasts.push({ t: e.t, text: '휙~ 놓쳤다' }); break;
                    case 'decided':
                        tl.decided = { t: e.t, ball: e.ball };
                        tl.toasts.push({ t: e.t, text: shortName(nameOf(e.ball)) + (data.target === 'first' ? ' 1등 도착!' : ' 꼴등 확정!') });
                        break;
                }
            });
            tl.toasts.sort(function (a, b) { return a.t - b.t; });
            flaps = map.plats.map(function () { return { open: 0, hold: 0 }; });
            cam = camMin(); setCam('auto'); lastSim = -1; finaleFired = false;
            mode = 'play';
        }

        // ── 재생 시계 ──
        function now() { return performance.now(); }
        function elapsed() { return (paused ? pauseAt : now()) - t0; }   // play() 뒤 지난 실제 ms(카운트다운 포함)
        function raceReal() { return elapsed() - delay; }
        function play(delayMs) {
            delay = delayMs || 0; t0 = now(); paused = false; playing = true; lastSim = -1; finaleFired = false; lastRender = now();
            cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
        }
        function stop() { playing = false; paused = false; cancelAnimationFrame(raf); raf = 0; }
        function pause() { if (!playing || paused) return; pauseAt = now(); paused = true; cancelAnimationFrame(raf); raf = 0; drawAt(raceReal(), 0); }
        function resume() { if (!playing || !paused) return; t0 += now() - pauseAt; paused = false; lastRender = now(); raf = requestAnimationFrame(loop); }
        function seek(ms) {
            if (!tl) return;
            ms = clamp(ms, 0, tl.durationMs);
            t0 = (paused ? pauseAt : now()) - delay - ms;
            if (!playing) { playing = true; paused = true; pauseAt = now(); t0 = pauseAt - delay - ms; }
            drawAt(ms, 0);
        }
        function time() { return tl ? clamp(raceReal(), 0, tl.durationMs) : 0; }
        function loop() {
            raf = 0;
            if (!playing || paused) return;
            var tNow = now(), dt = Math.min(0.1, (tNow - lastRender) / 1000); lastRender = tNow;
            var rr = raceReal();
            drawAt(rr, dt);
            if (tl && rr >= tl.durationMs) { playing = false; return; }   // 마지막 장면에 멈춘다
            raf = requestAnimationFrame(loop);
        }
        function simAt(rr) { return rr <= 0 ? 0 : Math.min(tl.simEndMs, BW.simTimeAt(rr, tl.slow)); }

        // 공 하나의 지금 상태 { st, since(ms), dur, safe }
        function stateAt(p, sim) {
            var cur = p.trans[0];
            for (var i = 1; i < p.trans.length && p.trans[i].t <= sim; i++) cur = p.trans[i];
            return cur;
        }
        function posAt(i, sim) {
            var f = tl.frames, k = sim / tl.sampleMs, a = Math.min(f.length - 1, Math.floor(k)), b = Math.min(f.length - 1, a + 1), u = k - a;
            var wps = people[i] && people[i].warps;   // 하수구 순간이동이 두 표본 사이에 있으면 미끄러지지 않게 — 그 전은 앞 표본, 그 뒤는 뒤 표본
            if (wps) for (var w = 0; w < wps.length; w++) if (wps[w] > a * tl.sampleMs && wps[w] <= b * tl.sampleMs) { u = sim < wps[w] ? 0 : 1; break; }
            var fa = f[a], fb = f[b];
            return { x: fa[i * 3] + (fb[i * 3] - fa[i * 3]) * u, y: fa[i * 3 + 1] + (fb[i * 3 + 1] - fa[i * 3 + 1]) * u, lean: fa[i * 3 + 2] + (fb[i * 3 + 2] - fa[i * 3 + 2]) * u };
        }
        function eagleAt(sim) {
            var f = tl.frames, k = sim / tl.sampleMs, a = Math.min(f.length - 1, Math.floor(k)), b = Math.min(f.length - 1, a + 1), u = k - a, n = tl.players.length;
            var ex = f[a][n * 3], ey = f[a][n * 3 + 1];
            if (ex <= -900 || f[b][n * 3] <= -900) return { x: ex, y: ey };
            return { x: ex + (f[b][n * 3] - ex) * u, y: ey + (f[b][n * 3 + 1] - ey) * u };
        }

        // ── 한 장면 ──
        // rr = 경주 시작 뒤 실제 ms(음수 = 카운트다운). dt = 지난 장면 뒤 실제 초(카메라·발판 부드럽게)
        function drawAt(rr, dt) {
            if (!tl) return;
            var counting = rr < 0, sim = simAt(rr), jump = lastSim < 0 || Math.abs(sim - lastSim) > SEEK_SNAP_MS;
            var simDt = jump ? 0 : (sim - lastSim) / 1000;
            if (!jump && playing && !paused && onEventCb) tl.events.forEach(function (e) { if (e.t > lastSim && e.t <= sim) onEventCb(e); });
            if (!finaleFired && tl.decided && sim >= tl.decided.t) { finaleFired = true; if (!jump && onFinaleCb) onFinaleCb(); }
            var t = sim / 1000, clockS = now() / 1000;
            var rule = tl.target;
            // 동물 상태
            var view = people.map(function (p, i) {
                var pos = posAt(i, sim), st = counting ? { st: 'inflate', t: -1 } : stateAt(p, sim), back = posAt(i, Math.max(0, sim - 80));
                var vx = (pos.x - back.x) / 0.08;
                var v = { p: p, x: pos.x, y: pos.y, wind: pos.lean, st: st.st, since: (sim - st.t) / 1000, vx: vx, pops: 0 };
                for (var k = 0; k < p.pops.length && p.pops[k] <= sim; k++) v.pops++;
                if (counting) v.k = clamp((elapsed() - (delay - R.inflate * 1000)) / (R.inflate * 1000), 0, 1);
                else if (st.st === 'inflate') v.k = clamp((sim - st.t) / st.dur, 0, 1);
                else v.k = 1;
                v.safe = st.st === 'rise' && st.safe && sim - st.t < R.safeDur * 1000;
                v.face = Math.abs(vx) > 14 ? Math.sign(vx) : (Math.sin(t * 0.45 + p.ph * 7) > 0.15 ? 1 : -1);   // 움직이는 쪽을 보고, 멈추면 두리번(그림 전용)
                var inIv = function (list) { for (var q = 0; q < list.length; q++) if (sim >= list[q].a && sim < list[q].b) return true; return false; };
                v.super = !counting && inIv(p.superIv); v.shield = !counting && inIv(p.shieldIv);
                v.smile = st.st === 'done' || p.smiles.some(function (ts) { return sim >= ts && sim - ts < SMILE_MS; });
                return v;
            });
            var picked = tl.decided && sim >= tl.decided.t ? view[tl.decided.ball] : null;
            // 카메라 — 끌어서 옮긴 수동 카메라는 입력 없이 3초 지나면 자동으로(데구리 MANUAL_IDLE_RETURN_MS)
            if (camMode === 'free' && playing && !paused && !drag && now() - lastInput > MANUAL_IDLE_RETURN_MS) setCam('auto');
            if (camMode !== 'free') {
                var target;
                if (camMode !== 'auto') { var fv = view.filter(function (v) { return v.p === camMode; })[0]; target = fv ? fv.y + 60 : cam; }
                else if (picked) target = picked.y + 40;
                else {
                    var ys = view.filter(function (v) { return v.st !== 'done'; }).map(function (v) { return v.y; }).sort(function (a, b) { return a - b; });
                    if (!ys.length) ys = view.map(function (v) { return v.y; });
                    var span = H / s * 0.55;   // 꼴등 룰: 아래 두 마리가 한 화면에 들어오면 둘의 중간, 멀면 꼴등만(중간을 비추면 아무도 안 보인다)
                    target = rule === 'first' ? ys[ys.length - 1] + 120 : (ys.length > 1 && ys[1] - ys[0] < span ? (ys[0] + ys[1]) / 2 : ys[0]) + 60;
                }
                target = clamp(target, camMin(), camMax());
                var ease = Math.abs(target - cam) * s > H * CAM_EDGE ? CAM_EASE_FAST : CAM_EASE;   // 화면 끝 쪽으로 벗어나면 빨리 따라잡는다(슈퍼 풍선·하수구)
                cam = jump || counting ? (counting ? camMin() : target) : cam + (target - cam) * Math.min(1, Math.max(simDt, dt) * ease);
            }
            // 여닫이 발판 — 밑에서 오르는 동물이 지나가는 동안 열린다(그림 전용)
            var fdt = jump ? 1 : dt;
            map.plats.forEach(function (q, i) {
                if (q.solid || q.kind) return;
                var fl = flaps[i];
                if (view.some(function (v) { return v.st === 'rise' && v.y < q.y + 6 && v.y + BAL_OFF + R.balloonR > q.y - 6 && Math.abs(v.x - q.x) < q.w / 2 + 14; })) fl.hold = R.flapHold;
                fl.hold -= fdt; fl.open += ((fl.hold > 0 ? 1 : 0) - fl.open) * Math.min(1, fdt * R.flapEase);
            });
            lastSim = sim;

            ctx.save();
            var shake = 0;
            tl.popFx.forEach(function (f) { if (sim >= f.t && sim - f.t < SHAKE_MS) shake = Math.max(shake, 1 - (sim - f.t) / SHAKE_MS); });
            if (tl.decided && sim >= tl.decided.t && sim - tl.decided.t < DECIDE_SHAKE_MS) shake = 1;
            if (shake > 0) ctx.translate(Math.sin(clockS * 80) * 6 * shake * 0.6, Math.cos(clockS * 70) * 4 * shake * 0.6);
            drawBackground();
            drawWorld(sim, t, clockS, view);
            view.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (v) { drawPlayer(v, clockS, picked); });
            drawFx(sim, view);
            drawEagle(sim, clockS);
            drawGust(sim, clockS);
            drawGauge(view);
            drawHud(view, rule);
            drawRank(view, rule, picked);
            if (counting) drawCountdown(-rr);
            ctx.restore();
            // 토스트(시뮬 시각 기준 마지막 한 줄)
            var msg = '';
            if (!counting) for (var i = tl.toasts.length - 1; i >= 0; i--) { var ts = tl.toasts[i]; if (ts.t <= sim) { if (sim - ts.t < TOAST_MS) msg = ts.text; break; } }
            setToast(msg);
        }
        function setToast(msg) {
            if (!toastEl || msg === toastText) return;
            toastText = msg;
            if (msg) toastEl.textContent = msg;
            toastEl.classList.toggle('on', !!msg);
        }

        // ── 대기 화면: 다음 판 맵 + 출발 자리 ──
        function drawIdle(preview, myName) {
            if (!preview || !preview.map) return;
            stop(); mode = 'idle'; tl = null; me = myName || ''; idle = preview; map = preview.map; setToast(''); rankHits = []; rankToggle = null;
            var n = Math.max(1, preview.players.length);
            people = preview.players.map(function (p, i) {
                return { id: p.id, name: p.owner, creature: p.creature, skin: p.skin || null, balloon: p.balloon || null, color: BALLOON[(p.colorIdx != null ? p.colorIdx : i) % BALLOON.length], colorIdx: p.colorIdx != null ? p.colorIdx : i, ph: i * 1.7 + 0.3, dim: !!p.dim, x0: (i + 0.5) / n * WORLD_W };
            });
            flaps = map.plats.map(function () { return { open: 0, hold: 0 }; });
            if (camMode === 'auto' || typeof camMode === 'object') { camMode = 'auto'; if (camBtn) camBtn.hidden = true; cam = camMin(); }
            redraw();
        }
        function drawIdleScene() {
            var clockS = now() / 1000;
            cam = clamp(cam, camMin(), camMax());
            drawBackground();
            drawWorld(0, 0, clockS);
            people.forEach(function (p) {
                drawPlayer({ p: p, x: p.x0, y: 0, wind: 0, st: 'wait', since: 0, vx: 0, k: 0, face: 1, safe: false, pops: 0 }, clockS, null);
            });
            drawGauge(people.map(function (p) { return { p: p, y: 0 }; }));
        }
        function redraw() {
            if (!W) return;
            if (mode === 'idle') { if (map) drawIdleScene(); }
            else if (tl) drawAt(playing ? raceReal() : tl.durationMs, 0);
        }
        function renderEnd() { if (tl) { stop(); lastSim = -1; drawAt(tl.durationMs, 0); } }

        // ── 그리기(목업 그대로) ──
        function skyColor(k) { var a = C.skyLow, b = C.skyHigh; return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * k); }).join(',') + ')'; }
        function drawBackground() {
            var k = clamp(cam / worldH(), 0, 1);
            ctx.fillStyle = skyColor(k); ctx.fillRect(-10, -10, W + 20, H + 20);
            drawFarBackground(k);
            if (k > 0.45) { ctx.globalAlpha = (k - 0.45) / 0.55; ctx.fillStyle = C.star; STARS.forEach(function (st) { ctx.beginPath(); ctx.arc(st.x * W, st.y * H, st.r, 0, Math.PI * 2); ctx.fill(); }); ctx.globalAlpha = 1; }
            ctx.fillStyle = C.cloud; ctx.globalAlpha = 0.55 * (1 - k * 0.6);
            CLOUDS.forEach(function (c) {
                var y = H / 2 - (c.y - cam * 0.55) * s, x = c.x * W; if (y < -60 || y > H + 60) return;
                [[0, 0, 22], [-22, 8, 15], [22, 6, 17]].forEach(function (o) { ctx.beginPath(); ctx.arc(x + o[0] * c.s, y + o[1] * c.s, o[2] * c.s, 0, Math.PI * 2); ctx.fill(); });
            });
            ctx.globalAlpha = 1;
            ctx.font = '700 11px Pretendard, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            for (var y = 1000; y < worldH(); y += 1000) {
                var yy = sy(y); if (yy < -10 || yy > H + 10) continue;
                ctx.strokeStyle = C.alt; ctx.lineWidth = 1; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); ctx.setLineDash([]);
                ctx.fillStyle = C.alt; ctx.fillText(y / 10 + 'm', 6, yy - 2);
            }
        }
        // 먼 배경(빈 하늘 채우기, §11-5) — 땅 근처는 데구리 sky-far(언덕), 그 위는 높이 띠마다 balloon/bg/sky-*.webp 를 겹쳐 흐리게 바꾼다. 천천히 미끄러진다(시차)
        function drawFarBackground(k) {
            var far = P('skyFar'), gy = sy(0);
            if (ok(far) && gy > -H * 0.2) {   // 1920×1080 — 언덕이 땅선 조금 위에 오게, 땅보다 느리게 따라 올라간다
                var fh = Math.max(H, W * 1080 / 1920) * 1.05, fw = fh * 1920 / 1080, fy = Math.min(0, H - fh) + (gy - H) * 0.35;
                ctx.globalAlpha = clamp((gy + H * 0.2) / (H * 0.6), 0, 1); ctx.drawImage(far, (W - fw) / 2, fy, fw, fh); ctx.globalAlpha = 1;
                if (fy > -fh * 0.4) {   // 그림 윗단이 화면 안에 들어오면 경계선이 보인다 — 위쪽 40% 를 지금 하늘색으로 덮어 이어지게
                    var sk = skyColor(k), g = ctx.createLinearGradient(0, fy, 0, fy + fh * 0.4);
                    g.addColorStop(0, sk); g.addColorStop(1, sk.replace('rgb', 'rgba').replace(')', ',0)'));
                    ctx.fillStyle = sk; ctx.fillRect(-10, -10, W + 20, fy + 10); ctx.fillStyle = g; ctx.fillRect(-10, fy, W + 20, fh * 0.4);
                }
            }
            SKY_BANDS.forEach(function (b) {
                var im = bimage('bg/' + b[0] + '.webp'); if (!ok(im)) return;
                var a = clamp(k < b[2] ? (k - b[1]) / (b[2] - b[1]) : k < b[3] ? 1 : 1 - (k - b[3]) / (b[4] - b[3]), 0, 1); if (a <= 0) return;
                var ih = Math.max(H * 1.15, W * im.naturalHeight / im.naturalWidth), iw = ih * im.naturalWidth / im.naturalHeight;
                var prog = clamp((k - b[1]) / (b[4] - b[1]), 0, 1), iy = -(ih - H) * (1 - prog);   // 띠를 지나는 동안 그림이 위에서 아래로 천천히 내려온다
                ctx.globalAlpha = a * 0.9; ctx.drawImage(im, (W - iw) / 2, iy, iw, ih); ctx.globalAlpha = 1;
            });
        }
        var dot = function (x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
        var seg = function (ax, ay, bx, by) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); };
        function spikeBall(x, y, r) {
            ctx.strokeStyle = C.spikeTip; ctx.lineWidth = 2; ctx.lineCap = 'round';
            for (var a = 0; a < 12; a++) { var an = a / 12 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * r * 0.6, y + Math.sin(an) * r * 0.6); ctx.lineTo(x + Math.cos(an) * r * 1.35, y + Math.sin(an) * r * 1.35); ctx.stroke(); }
            ctx.fillStyle = C.spike; ctx.beginPath(); ctx.arc(x, y, r * 0.85, 0, Math.PI * 2); ctx.fill();
        }
        function drawWorld(sim, t, clockS, view) {
            var gy = sy(0);
            if (gy < H + 40) {
                if (ok(P('tree'))) ctx.drawImage(P('tree'), sx(8), gy - 112 * s, 80 * s, 112 * s);
                if (ok(P('bush'))) ctx.drawImage(P('bush'), sx(270), gy - 40 * s, 64 * s, 48 * s);
                if (ok(P('bushS'))) ctx.drawImage(P('bushS'), sx(150), gy - 22 * s, 32 * s, 24 * s);
            }
            if (gy < H) {
                if (ok(P('meadow'))) ctx.drawImage(P('meadow'), 0, 0, 1024, 1024 * (H - gy + 10) / W, 0, gy, W, H - gy + 10);
                else { ctx.fillStyle = C.ground; ctx.fillRect(0, gy, W, H - gy + 10); }
                ctx.fillStyle = C.groundDark; ctx.fillRect(0, gy, W, 5);
            }
            map.plats.forEach(function (q, i) {
                var y = sy(q.y); if (y < -40 || y > H + 20) return;
                if (q.kind === 'cloud') { drawCloudPlat(q, i, sim, y); return; }
                if (q.solid) {   // 안 열리는 들보 — 데구리 출발대 나무(128×96, 칠해진 곳 3~47줄)
                    var bx0 = sx(q.x - q.w / 2), bw = q.w * s, tw = 44 * s, th0 = tw * 44 / 128;
                    if (ok(P('beam'))) for (var x = bx0; x < bx0 + bw - 0.5; x += tw) { var cw = Math.min(tw, bx0 + bw - x); ctx.drawImage(P('beam'), 0, 3, 128 * cw / tw, 44, x, y - 2, cw, th0); }
                    else { ctx.fillStyle = C.platDark; ctx.fillRect(bx0, y, bw, 14 * s); }
                    return;
                }
                // 가운데가 갈라진 여닫이 판 두 쪽 — 양 끝 경첩, 위로만 열린다
                var x0 = sx(q.x - q.w / 2), x1 = sx(q.x + q.w / 2), half = q.w / 2 * s - 1, a = (flaps[i] ? flaps[i].open : 0) * R.flapOpen, th = 9 * s;
                var plank = BP('plank'), pth = 11 * s;
                [[x0, -1], [x1, 1]].forEach(function (hd) {
                    var hx = hd[0], d = hd[1];
                    ctx.save(); ctx.translate(hx, y); ctx.rotate(d * a); ctx.scale(-d, 1);
                    if (ok(plank)) ctx.drawImage(plank, 0, 0, 96, 32, 0, -2, half, pth);   // plank.webp 192×32 의 왼쪽 반(경첩 쇠가 왼쪽 끝) — 오른쪽 판은 scale(-1) 로 뒤집혀 경첩이 오른쪽 끝에 온다(ㅇ==ㅇ)
                    else {
                        ctx.fillStyle = C.platDark; ctx.beginPath(); ctx.roundRect(0, 0, half, th, 3); ctx.fill();
                        ctx.fillStyle = C.plat; ctx.fillRect(2, 3, half - 4, 3 * s);
                        ctx.fillStyle = C.platTop; ctx.beginPath(); ctx.roundRect(-1, -2, half + 1, 4, 2); ctx.fill();
                    }
                    ctx.restore();
                    if (!ok(plank)) { ctx.fillStyle = C.hinge; dot(hx, y + th / 2, 3); }
                });
                if (a < 0.1) {   // 밑면 ▲ — 밑에서는 열린다
                    ctx.strokeStyle = C.platHint; ctx.lineWidth = 1.5;
                    [-1, 1].forEach(function (d) { var cx = sx(q.x) + d * q.w * 0.22 * s, cy = y + th + 5; seg(cx - 4, cy + 3, cx, cy - 1); seg(cx, cy - 1, cx + 4, cy + 3); });
                }
            });
            drawPipes();
            drawBridges(sim, clockS, view);
            drawItems(sim, clockS);
            drawWalls();
            map.spikes.forEach(function (q, i) {
                var ft = tl && tl.spikeFall[i] != null && sim >= tl.spikeFall[i] ? (sim - tl.spikeFall[i]) / 1000 : -1;
                if (ft >= 2) return;
                var y = sy(q.y) + (ft > 0 ? 0.5 * R.dropG * ft * ft * s : 0); if (y < -30 || y > H + 30) return;
                var shx = sx(q.x) + (ft >= 0 && ft < 0.25 ? Math.sin(clockS * 60) * 2 : 0);
                var spin = clockS * (0.5 + (i % 3) * 0.18) * (i % 2 ? 1 : -1) + i;   // 제자리에서 천천히 돈다(밤송이마다 방향·속도 다르게, 그림 전용)
                if (ok(BP('chestnut'))) { var cs = R.spikeR * 2.8 * s; ctx.save(); ctx.translate(shx, y); ctx.rotate(spin + (ft > 0 ? ft * 6 : 0)); ctx.drawImage(BP('chestnut'), -cs / 2, -cs / 2, cs, cs); ctx.restore(); }
                else spikeBall(shx, y, R.spikeR * s);
            });
            drawHazards(t, clockS);
            drawSigns();
            var fy = sy(worldH());
            if (fy > -60 && fy < H + 60) {
                ctx.fillStyle = C.cloud;
                for (var cx2 = -10; cx2 < W + 30; cx2 += 34) { ctx.beginPath(); ctx.arc(cx2, fy + 8 + (Math.round(cx2) % 3) * 2, 24, 0, Math.PI * 2); ctx.fill(); }
                ctx.fillRect(0, fy + 8, W, 40);
                ctx.setLineDash([8, 6]); ctx.strokeStyle = C.finish; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke(); ctx.setLineDash([]);
                if (ok(P('flag'))) {
                    var fr = Math.floor(clockS * 4) % 2, fs = 40 * s;
                    ctx.drawImage(P('flag'), fr * 32, 0, 32, 64, 10, fy - fs * 2 + 6, fs, fs * 2);
                    ctx.save(); ctx.translate(W - 10, 0); ctx.scale(-1, 1); ctx.drawImage(P('flag'), fr * 32, 0, 32, 64, 0, fy - fs * 2 + 6, fs, fs * 2); ctx.restore();
                }
                ctx.fillStyle = C.finish; ctx.font = '800 13px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('도착', W / 2, fy - 4);
            }
        }
        // ── 2차 장치(§11) ──
        function drawCloudPlat(q, i, sim, y) {   // 구름 쿠션 — cloud.webp 192×96 ×2(가만 · 눌림). 착지 순간 잠깐 눌린다
            var hit = tl && tl.cloudHit[i] && tl.cloudHit[i].some(function (ts) { return sim >= ts && sim - ts < CLOUD_SQUISH_MS; });
            var w = (q.w + 24) * s, h = w * 96 / 192;
            if (ok(BP('cloud'))) ctx.drawImage(BP('cloud'), hit ? 192 : 0, 0, 192, 96, sx(q.x) - w / 2, y - h * 0.55, w, h);
            else { ctx.fillStyle = C.cloud; [[-0.3, 0, 0.22], [0, -0.08, 0.28], [0.3, 0, 0.22]].forEach(function (o) { dot(sx(q.x) + o[0] * w, y + o[1] * w, o[2] * w); }); }
        }
        function drawPipes() {   // 하수구 — 발판 위에 선 파이프(입이 위). 몸통 폭 = R.warpBodyW, 키 = R.warpH(아래는 발판 뒤로 잘림)
            (map.warps || []).forEach(function (w) {
                var top = sy(w.top), base = sy(w.y); if (base < -20 || top > H + 20) return;
                var k = R.warpBodyW * s / PIPE.bodyW, srcH = (base - top) / k;
                if (ok(P('pipe'))) ctx.drawImage(P('pipe'), 0, PIPE.rimTop, 192, srcH, sx(w.x) - 96 * k, top, 192 * k, base - top);
                else { ctx.fillStyle = '#2fa84f'; ctx.fillRect(sx(w.x) - R.warpBodyW * s / 2, top, R.warpBodyW * s, base - top); }
                ctx.font = '800 10px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';   // 짝 표시 — 위로 가는 파이프는 ▲, 아래로 가는 파이프는 ▼
                var pair = map.warps[w.pair], up = pair && pair.y > w.y;
                ctx.fillStyle = up ? C.tagMe : C.tag; ctx.strokeStyle = C.tagInk; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(sx(w.x), top + (base - top) * 0.55, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = C.tagInk; ctx.fillText(up ? '▲' : '▼', sx(w.x), top + (base - top) * 0.55 + 0.5);
            });
        }
        function drawBridges(sim, clockS, view) {   // 세이브 다리 — 놓인 뒤 통나무 들보 + 비버. 놓이는 동안(bridgeBuild) 양 끝에서 가운데로 자라고 비버가 통나무를 민다
            (map.bridges || []).forEach(function (b) {
                var bt = tl && tl.bridgeT[b.idx]; if (bt == null || sim < bt) return;
                var y = sy(b.y); if (y < -40 || y > H + 40) return;
                var k = clamp((sim - bt) / (R.bridgeBuild * 1000), 0, 1), e = 1 - (1 - k) * (1 - k), reach = W / 2 * e;
                var tw = 44 * s, th = tw * 44 / 128, gaps = [];
                (view || []).forEach(function (v) { if (v.st === 'rise' && Math.abs(v.y + BAL_OFF - b.y) < 60) gaps.push(sx(v.x)); });   // 밑에서 오르는 동물 — 비버가 비켜 준다
                [[0, 1], [W, -1]].forEach(function (side) {
                    for (var x = 0; x < reach; x += tw) {
                        var cw = Math.min(tw, reach - x), x0 = side[1] > 0 ? x : W - x - cw;
                        if (gaps.some(function (g) { return Math.abs(x0 + cw / 2 - g) < 26 * s; })) continue;
                        if (ok(P('beam'))) ctx.drawImage(P('beam'), 0, 3, 128 * cw / tw, 44, x0, y - 2, cw, th); else { ctx.fillStyle = C.platDark; ctx.fillRect(x0, y, cw, 10 * s); }
                    }
                });
                if (!ok(P('beaver'))) return;
                var bh = BEAVER.worldH * s, fr;
                for (var j = 0; j < BEAVER.n; j++) {
                    var home = (j + 0.5) / BEAVER.n * W, from = j < BEAVER.n / 2 ? -bh : W + bh, bx = from + (home - from) * e;
                    var near = gaps.some(function (g) { return Math.abs(g - bx) < 40 * s; });
                    fr = near ? 2 : k < 1 ? Math.floor(clockS * 6) % 2 : 0;
                    var hop = near ? Math.abs(Math.sin(clockS * 10)) * 6 * s : 0;
                    ctx.save(); ctx.translate(bx + (near ? (bx < W / 2 ? -14 : 14) * s : 0), y - hop); if (home < from) ctx.scale(-1, 1);
                    ctx.drawImage(P('beaver'), fr * BEAVER.cell, 0, BEAVER.cell, BEAVER.cell, -bh / 2, -bh, bh, bh);
                    ctx.restore();
                }
            });
        }
        function drawItems(sim, clockS) {   // 아이템 상자 — item-box.webp 64×64 ×2(가만 · 반짝). 먹힌 뒤 itemRespawn 초 동안 없다
            if (!map.items) return;
            map.items.forEach(function (it) {
                var taken = tl && (tl.boxTaken[it.idx] || []).some(function (ts) { return sim >= ts && sim < ts + R.itemRespawn * 1000; });
                if (taken) return;
                var y = sy(it.y + Math.sin(clockS * 2.4 + it.idx) * 4); if (y < -30 || y > H + 30) return;
                var sz = R.itemR * 2.4 * s, fr = Math.floor(clockS * 2.5 + it.idx) % 2;
                if (ok(BP('item-box'))) ctx.drawImage(BP('item-box'), fr * 64, 0, 64, 64, sx(it.x) - sz / 2, y - sz / 2, sz, sz);
                else { ctx.fillStyle = C.tagMe; ctx.fillRect(sx(it.x) - sz / 3, y - sz / 3, sz / 1.5, sz / 1.5); }
            });
        }
        function drawWalls() {
            map.sections.forEach(function (q) {
                if (!q.corr || sy(q.y1) > H + 20 || sy(q.y0) < -20) return;
                [0, 1].forEach(function (side) {
                    ctx.beginPath(); ctx.moveTo(side ? W : 0, sy(q.y0));
                    for (var y = q.y0; y < q.y1 + 12; y += 12) { var yy = Math.min(y, q.y1); ctx.lineTo(sx(BW.sectionBounds(q, yy - q.y0)[side]), sy(yy)); }
                    ctx.lineTo(side ? W : 0, sy(q.y1)); ctx.closePath();
                    ctx.fillStyle = C.rock; ctx.fill(); ctx.strokeStyle = C.rockDark; ctx.lineWidth = 3; ctx.stroke();
                    if (q.thorn) {   // 가시벽 — 닿으면 터진다. 가시 덩굴 타일(thorn.webp 32×96, 가시가 오른쪽)을 벽 따라 세운다 — 오른쪽 벽은 뒤집어 안쪽을 향하게
                        var d = side ? -1 : 1, th2 = ok(BP('thorn'));
                        var tw = 14 * s, tH = 42 * s;
                        for (var y2 = q.y0 + R.funnel; y2 < q.y1 - R.funnel; y2 += th2 ? 42 : 16) {
                            var x = sx(BW.sectionBounds(q, y2 - q.y0)[side]), yy2 = sy(y2);
                            if (th2) { ctx.save(); ctx.translate(x, yy2); ctx.scale(d, 1); ctx.drawImage(BP('thorn'), -tw * 0.45, -tH, tw, tH); ctx.restore(); }
                            else { ctx.fillStyle = C.thorn; ctx.beginPath(); ctx.moveTo(x, yy2 - 5); ctx.lineTo(x + d * 9, yy2); ctx.lineTo(x, yy2 + 5); ctx.fill(); }
                        }
                    }
                });
            });
        }
        function drawSigns() {   // 구간 이름표 — 들어서는 자리 오른쪽
            ctx.font = '800 11px Pretendard, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            map.sections.forEach(function (q) {
                var y = sy(q.y0 + 16); if (y < -20 || y > H + 20) return;
                var tw = ctx.measureText(q.label).width + 14, x = W - tw - 18;
                ctx.fillStyle = C.sign; ctx.strokeStyle = C.signInk; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(x, y - 9, tw, 18, 4); ctx.fill(); ctx.stroke();
                ctx.fillStyle = C.signInk; ctx.fillText(q.label, x + 7, y);
            });
        }
        function drawHazards(t, clockS) {
            map.hazards.forEach(function (h) {
                var x = sx(h.x), y = sy(h.y);
                if (y < -320 || y > H + 320) return;
                ctx.lineCap = 'round';
                if (h.type === 'blade' && ok(P('rotor'))) {   // windmill-rotor.webp 192×192, 날개 끝까지 96px — 화면은 y 가 아래라 각도 부호가 반대
                    var rs = Z.bladeLen * s / 96 * 1.02;
                    ctx.save(); ctx.translate(x, y); ctx.rotate(-BW.bladeAng(h, t)); ctx.drawImage(P('rotor'), -96 * rs, -96 * rs, 192 * rs, 192 * rs); ctx.restore();
                } else if (h.type === 'blade') {
                    var a0 = BW.bladeAng(h, t);
                    for (var i = 0; i < 4; i++) {
                        var a = a0 + i * Math.PI / 2, ex = sx(h.x + Math.cos(a) * Z.bladeLen), ey = sy(h.y + Math.sin(a) * Z.bladeLen);
                        ctx.strokeStyle = C.bladeDark; ctx.lineWidth = 12 * s; seg(x, y, ex, ey);
                        ctx.strokeStyle = C.blade; ctx.lineWidth = 7 * s; seg(x, y, ex, ey);
                        ctx.fillStyle = C.bladeTip; dot(ex, ey, 6 * s);
                    }
                    ctx.fillStyle = C.hub; dot(x, y, Z.bladeHub * s);
                } else if (h.type === 'pend') {
                    var b = BW.pendBall(h, t), px = sx(b[0]), py = sy(b[1]);
                    ctx.strokeStyle = C.chain; ctx.lineWidth = 3; seg(x, y, px, py);
                    if (ok(P('pivot'))) ctx.drawImage(P('pivot'), x - 24 * s, y - 18 * s, 48 * s, 36 * s); else { ctx.fillStyle = C.hub; dot(x, y, 6); }
                    if (ok(P('plog'))) { var k = 2 * Z.pendR * s / 150; ctx.save(); ctx.translate(px, py); ctx.rotate(Math.atan2(x - px, -(y - py))); ctx.drawImage(P('plog'), -96 * k, -144 * k, 192 * k, 240 * k); ctx.restore(); }   // 나이테 원 중심(96,144), 쇠고리가 축을 본다
                    else spikeBall(px, py, Z.pendR * s);
                } else if (h.type === 'bolt') {
                    var st = BW.boltState(h, t), bw = Z.boltW * s;
                    if (st >= 1) { ctx.fillStyle = C.boltZone; ctx.fillRect(x - bw / 2, y, bw, Z.boltLen * s); }   // 내리칠 자리 미리 보이기
                    if (st === 2) {
                        if (ok(BP('bolt'))) { var bwid = 34 * s, flick = Math.floor(clockS * 30) % 2 ? 1 : -1; ctx.save(); ctx.translate(x, y + 12 * s); ctx.scale(flick, 1); ctx.drawImage(BP('bolt'), -bwid / 2, 0, bwid, Z.boltLen * s); ctx.restore(); }   // bolt.webp 72×288 — 내리치는 길이(boltLen)로 늘린다
                        else {
                            ctx.strokeStyle = C.bolt; ctx.lineWidth = 5;
                            ctx.beginPath(); ctx.moveTo(x, y + 10);
                            for (var j = 1; j <= 7; j++) ctx.lineTo(x + (j % 2 ? 1 : -1) * (8 + Math.sin(clockS * 50 + j) * 6), y + 10 + Z.boltLen * s * j / 7);
                            ctx.stroke();
                        }
                    }
                    var flash = st === 2 || (st === 1 && Math.floor(clockS * 12) % 2), cloud = BP(flash ? 'storm-flash' : 'storm');
                    if (ok(cloud)) { var cw2 = 104 * s, ch2 = cw2 * 128 / 192; ctx.drawImage(cloud, x - cw2 / 2, y - ch2 * 0.55, cw2, ch2); }   // storm(-flash).webp 192×128
                    else { ctx.fillStyle = flash ? C.stormHi : C.storm; [[0, 0, 26], [-26, 8, 18], [26, 6, 20], [-12, -12, 18], [14, -14, 16]].forEach(function (o) { dot(x + o[0] * s, y + o[1] * s, o[2] * s); }); }
                } else if (h.type === 'fan') {
                    var on = BW.fanOn(h, t), d = -h.s, fs = 44 * s, fr = on ? Math.floor(clockS * 20) % 2 : Math.floor(clockS * 2.5) % 2;   // fan.webp 128×128 ×2(벽 받침이 왼쪽)
                    ctx.save(); ctx.translate(x + d * fs * 0.3, y); ctx.scale(d, 1); if (ok(P('fan'))) ctx.drawImage(P('fan'), fr * 128, 0, 128, 128, -fs / 2, -fs / 2, fs, fs); ctx.restore();
                    if (on && ok(P('wind'))) for (var w = 0; w < 3; w++) {   // wind.webp 96×48 ×4
                        var xx = x + d * (((clockS * 260 + w * 80) % 220) + 30) * s, yy = y + (w - 1) * Z.fanBand / 3 * s, ww = 48 * s;
                        ctx.save(); ctx.translate(xx, yy); ctx.scale(d, 1); ctx.globalAlpha = 0.85; ctx.drawImage(P('wind'), (Math.floor(clockS * 10) + w) % 4 * 96, 0, 96, 48, -ww / 2, -ww / 4, ww, ww / 2); ctx.restore(); ctx.globalAlpha = 1;
                    }
                } else if (h.type === 'bee') {
                    var sw = BW.swarmAt(h, t), hw = 60 * s;   // beehive.webp 96×128 ×2(가만/흔들), bee-swarm.webp 128×96 ×4
                    if (ok(P('hive'))) { ctx.save(); ctx.translate(x, y); if (h.s < 0) ctx.scale(-1, 1); ctx.rotate(sw ? Math.sin(clockS * 30) * 0.06 : 0); ctx.drawImage(P('hive'), sw ? 96 : 0, 0, 96, 128, -hw / 2, -hw * 0.45, hw, hw * 4 / 3); ctx.restore(); }
                    if (sw && ok(P('swarm'))) { var sb = 2 * Z.beeR * s * 1.5; ctx.drawImage(P('swarm'), Math.floor(clockS * 10) % 4 * 128, 0, 128, 96, sx(sw[0]) - sb / 2, sy(sw[1]) - sb * 0.375, sb, sb * 0.75); }
                } else if (h.type === 'shutter') {
                    var open = BW.shutOpen(h, t), c = BW.cyc(h, t, Z.shutPeriod), pr = Math.min(1, c / Z.shutSlide), e = pr * pr * (3 - 2 * pr), halfW = W / 2, dth = 10 * s;
                    var lOff = open < 0 ? e : 1 - e, rOff = open > 0 ? e : 1 - e;   // 열리는 쪽은 벽 속으로, 닫히는 쪽은 나온다
                    ctx.fillStyle = C.doorDark; ctx.fillRect(0, y - 2, W, 4);
                    if (ok(BP('shutter'))) {   // shutter.webp 192×32 — 경고 줄무늬가 가운데(맞닿는 쪽)에 오게 왼쪽 문은 뒤집는다
                        var sh = 13 * s;
                        ctx.save(); ctx.translate(-lOff * halfW + halfW, y - sh / 2); ctx.scale(-1, 1); ctx.drawImage(BP('shutter'), 0, 0, halfW, sh); ctx.restore();
                        ctx.drawImage(BP('shutter'), halfW + rOff * halfW, y - sh / 2, halfW, sh);
                    } else {
                        ctx.fillStyle = C.door; ctx.strokeStyle = C.doorDark; ctx.lineWidth = 2;
                        ctx.beginPath(); ctx.rect(-lOff * halfW, y - dth / 2, halfW, dth); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.rect(halfW + rOff * halfW, y - dth / 2, halfW, dth); ctx.fill(); ctx.stroke();
                    }
                } else if (h.type === 'up') {
                    var uw = h.w * s, top = sy(h.y + h.h);
                    ctx.fillStyle = C.updraft; ctx.fillRect(x - uw / 2, top, uw, h.h * s);
                    ctx.strokeStyle = C.updraftArrow; ctx.lineWidth = 2;
                    for (var m = 0; m < 6; m++) { var ay = sy(h.y + ((t * 160 + m * h.h / 6) % h.h)); seg(x - 9, ay + 7, x, ay); seg(x, ay, x + 9, ay + 7); }
                }
            });
        }
        // ── 동물 한 칸 그리기 — 칸 160 을 몸 크기 S 로, 칸 아래 = 발(feet). face < 0 이면 좌우 반전(시트는 오른쪽 향함) ──
        function cellTo(img, col, row, x, feet, S, face) {
            ctx.save(); ctx.translate(x, feet - S / 2); if (face < 0) ctx.scale(-1, 1);
            ctx.drawImage(img, col * SPRITE.size, row * SPRITE.size, SPRITE.size, SPRITE.size, -S / 2, -S / 2, S, S);
            ctx.restore();
        }
        // 칸 안 점(cx, cy) → 화면 점
        function cellPt(x, feet, S, face, cx, cy) { return [x + face * (cx - 80) / 160 * S, feet - S + cy / 160 * S]; }
        function frameOf(kind, clockS, p, fast) { return Math.floor((clockS + p.ph) * POSE_FPS[kind] * (fast ? 1.8 : 1)) % 4; }

        // 풍선 — 색 풍선 시트(행 = 색) 또는 야식 풍선. knot = 매듭 아래 끝(화면), k = 크기(불 때 0.15→1)
        function drawBalloonAt(v, kx, ky, k, alpha) {
            var p = v.p, spr = p.balloon ? balloonSprite(p.balloon) : null;
            ctx.globalAlpha = alpha;
            if (v.super && ok(BP('super-balloon'))) {   // 슈퍼 풍선 — 금색 별 풍선(super-balloon.webp 96×120 ×2, 무지개 꼬리 칸과 번갈아), 1.3배
                var sc3 = 2 * R.balloonR * 1.15 * s * k * 1.3 / BAL_CELL.bodyW, sf = Math.floor(performance.now() / 120) % 2;
                ctx.drawImage(BP('super-balloon'), sf * BAL_CELL.w, 0, BAL_CELL.w, BAL_CELL.h, kx - BAL_CELL.knotX * sc3, ky - BAL_CELL.knotY * sc3, BAL_CELL.w * sc3, BAL_CELL.h * sc3);
            } else if (spr && ok(spr)) {   // 야식 풍선(deguri_balloon) — 매듭이 줄 끝에 오게
                var hpx = BAL_SPRITE.worldH * s * k, sc = hpx / BAL_SPRITE.h;
                ctx.drawImage(spr, 0, 0, BAL_SPRITE.w, BAL_SPRITE.h, kx - BAL_SPRITE.knotX * sc, ky - BAL_SPRITE.knotY * sc, BAL_SPRITE.w * sc, hpx);
            } else if (ok(BP('balloon'))) {
                var sc2 = 2 * R.balloonR * 1.15 * s * k / BAL_CELL.bodyW, row = p.colorIdx % BALLOON.length;
                ctx.drawImage(BP('balloon'), 0, row * BAL_CELL.h, BAL_CELL.w, BAL_CELL.h, kx - BAL_CELL.knotX * sc2, ky - BAL_CELL.knotY * sc2, BAL_CELL.w * sc2, BAL_CELL.h * sc2);
            } else {   // 그림을 못 받았을 때 — 목업 도형
                var r = R.balloonR * s * Math.max(0.15, k), cx = kx, cy = ky - r * 1.15;
                ctx.fillStyle = p.color; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 1.18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
        function stringTo(ax, ay, kx, ky, sag) {
            ctx.strokeStyle = C.string; ctx.lineWidth = Math.max(1, 0.9 * s);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + kx) / 2 + sag, (ay + ky) / 2, kx, ky); ctx.stroke();
        }
        function drawChuteAt(v, ax, ay) {
            var t = v.since, f = t < 0.08 ? 0 : t < 0.18 ? 1 : 2 + (Math.floor(t * 2) % 2), sway = Math.sin(t * 2.2 + v.p.ph) * 4 * s;
            var sc = CHUTE.worldW * s / CHUTE.openW, rimX = ax + sway, rimY = ay - CHUTE.lift * s;
            var half = [0.18, 0.32, 0.47, 0.47][f] * CHUTE.worldW * s;
            ctx.strokeStyle = C.string; ctx.lineWidth = 1;
            [-1, -0.35, 0.35, 1].forEach(function (k) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(rimX + k * half, rimY); ctx.stroke(); });
            if (ok(BP('chute'))) ctx.drawImage(BP('chute'), f * CHUTE.w, 0, CHUTE.w, CHUTE.h, rimX - CHUTE.rimX * sc, rimY - CHUTE.rimY * sc, CHUTE.w * sc, CHUTE.h * sc);
            else { ctx.fillStyle = C.chuteB; ctx.beginPath(); ctx.ellipse(rimX, rimY, half, half * 0.8, 0, Math.PI, Math.PI * 2); ctx.fill(); }
        }
        // 그림 시트가 없는 동물(못 받음) — 목업처럼 서기 칸에 코드 팔
        function codeArms(x, cy, S, gy, flail, clockS) {
            var hands = flail ? [[-S * 0.46, -S * 0.32 + Math.sin(clockS * 30) * 4], [S * 0.46, -S * 0.32 - Math.sin(clockS * 30) * 4]] : [[-3, gy - cy], [3, gy - cy]];
            hands.forEach(function (hd, k) {
                var shx = x + (k ? S * 0.2 : -S * 0.2), shy = cy - S * 0.1;
                ctx.beginPath(); ctx.lineWidth = 6; ctx.strokeStyle = C.ink; ctx.moveTo(shx, shy); ctx.lineTo(x + hd[0], cy + hd[1]); ctx.stroke();
                ctx.beginPath(); ctx.lineWidth = 3.5; ctx.strokeStyle = C.hand; ctx.moveTo(shx, shy); ctx.lineTo(x + hd[0], cy + hd[1]); ctx.stroke();
            });
        }
        function drawPlayer(v, clockS, picked) {
            var S = BODY * s, x = sx(v.x), feet = sy(v.y), p = v.p, st = v.st;
            if (st === 'warp' || feet < -160 || feet > H + 80) return;   // 하수구 안 — 안 보인다
            var hop = picked === v && tl && tl.target === 'first' ? Math.abs(Math.sin(clockS * 6)) * 12 : 0;   // 1등 룰 당첨자만 폴짝(꼴등은 비석)
            feet -= hop;
            if (p.dim) ctx.globalAlpha = 0.45;
            var hangSt = st === 'rise' || st === 'done' || st === 'chute', flail = st === 'pop' || st === 'drop' || st === 'fdrop' || st === 'shock';
            var face = v.face, main = sheet(p.creature, p.skin);
            // 매달림: 줄 토막 꼭대기(HANG_ANCHOR)를 축으로 진자처럼 흔들린다
            var rot = 0;
            if (hangSt) rot = clamp(v.vx / 260, -0.35, 0.35) + Math.sin(clockS * 2.1 + p.ph) * (st === 'chute' ? 0.16 : 0.07);
            var bx = sx(v.x + v.wind * R.balTilt), knotY = sy(v.y + BAL_OFF) + R.balloonR * 1.15 * s;   // 풍선 매듭(화면)
            var blink = v.safe && Math.floor(clockS * SAFE_BLINK_HZ) % 2 ? 0.45 : 1;
            if (hangSt || st === 'shock') {
                var hs = st === 'shock' ? poseSheet(p, 'fall') : poseSheet(p, 'hang');
                var anc = st === 'shock' ? cellPt(x, feet, S, face, 80, 28) : cellPt(x, feet, S, face, HANG_ANCHOR[0], HANG_ANCHOR[1]);
                if (st !== 'chute') { stringTo(anc[0], anc[1], bx, knotY, (bx - anc[0]) * 0.2 + 3 * s); drawBalloonAt(v, bx, knotY, 1, blink * (p.dim ? 0.45 : 1)); }
                else drawChuteAt(v, anc[0], anc[1]);
                ctx.save(); ctx.translate(anc[0], anc[1]); ctx.rotate(st === 'shock' ? Math.sin(clockS * 40) * 0.06 : rot); ctx.translate(-anc[0], -anc[1]);
                if (hs) cellTo(hs, st === 'shock' ? 0 : frameOf('hang', clockS, p, Math.abs(v.vx) > 30), 0, x, feet, S, face);
                else { codeArms(x, feet - S / 2, S, feet - S / 2 - S * 0.62, false, clockS); if (ok(main)) cellTo(main, 0, 0, x, feet, S, face); }
                ctx.restore();
                if (st === 'shock') drawExclaim(x, feet - S * 1.02, clockS);
            } else if (st === 'inflate') {
                var bs = poseSheet(p, 'blow'), mouth = MOUTH[p.creature] || [116, 66];
                var m = bs ? cellPt(x, feet, S, face, mouth[0], mouth[1]) : [x, feet - S * 0.9];
                var k = Math.max(0.15, v.k) * (1 + 0.05 * Math.sin(clockS * 22));
                var kx = m[0] + (bx - m[0]) * v.k * 0.35, ky = m[1] + (knotY - m[1]) * v.k * 0.35 - 2 * s;   // 다 불수록 머리 위로 떠오른다
                if (bs) { cellTo(bs, frameOf('blow', clockS, p), 0, x, feet, S, face); drawBalloonAt(v, kx, ky, k, 1); }
                else { drawBalloonAt(v, kx, ky, k, 1); if (ok(main)) cellTo(main, 0, 0, x, feet, S, face); }
            } else if (flail) {
                var fs = poseSheet(p, 'fall');
                if (fs) cellTo(fs, st === 'pop' ? 0 : 1 + (frameOf('fall', clockS, p) % 3), 0, x, feet, S, face);
                else if (ok(main)) { ctx.save(); ctx.translate(x, feet - S / 2); ctx.rotate(Math.sin(clockS * 22 + p.ph) * 0.45); ctx.translate(-x, -(feet - S / 2)); codeArms(x, feet - S / 2, S, 0, true, clockS); cellTo(main, 0, 0, x, feet, S, face); ctx.restore(); }
            } else if (st === 'grave') {
                drawGrave(v, x, feet, S, face, main, clockS);
            } else {   // wait · land — 서기(착지 순간은 납작)
                var sq = st === 'land' ? 0.8 + 0.2 * clamp(v.since / R.landDur, 0, 1) : 1, frame = Math.floor((clockS + p.ph) * SPRITE.fps) % SPRITE.frames;
                ctx.save(); ctx.translate(x, feet); ctx.scale(1, sq); ctx.translate(-x, -feet);
                if (ok(main)) cellTo(main, frame, 0, x, feet, S, face);
                else { ctx.fillStyle = C.hand; ctx.beginPath(); ctx.arc(x, feet - S / 2, S * 0.4, 0, Math.PI * 2); ctx.fill(); }
                ctx.restore();
            }
            ctx.globalAlpha = p.dim ? 0.45 : 1;
            if (v.shield) drawShield(x, feet - S * 0.5, S, clockS);
            if (st !== 'grave') nameTag(p, x, st === 'rise' || st === 'done' || st === 'chute' ? feet + 2 : feet - S * 0.06);
            if (v.smile && st !== 'grave') drawSmile(x + face * S * 0.5, feet - S * (hangSt ? 0.95 : 1.05), clockS + p.ph);
            ctx.globalAlpha = 1;
        }
        function drawShield(x, cy, S, clockS) {   // 방패 — shield.webp 128×128 ×2 의 첫 칸(속이 빈 비눗방울 고리), 몸을 감싼다
            var r = S * 0.78 * (1 + 0.04 * Math.sin(clockS * 5));
            if (ok(BP('shield'))) { ctx.globalAlpha *= 0.9; ctx.drawImage(BP('shield'), 0, 0, 128, 128, x - r, cy - r, r * 2, r * 2); ctx.globalAlpha = 1; }
            else { ctx.strokeStyle = 'rgba(120,200,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, cy, r * 0.9, 0, Math.PI * 2); ctx.stroke(); }
        }
        function drawSmile(x, y, ph) {   // ^ ^ 말풍선
            var b = 1 + 0.06 * Math.sin(ph * 6);
            ctx.save(); ctx.translate(x, y); ctx.scale(b, b);
            ctx.fillStyle = C.tag; ctx.strokeStyle = C.tagInk; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.roundRect(-15, -10, 30, 18, 9); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-4, 8); ctx.lineTo(-8, 13); ctx.lineTo(1, 8); ctx.fill(); ctx.stroke();
            ctx.fillStyle = C.tag; ctx.fillRect(-5, 6, 7, 3);
            ctx.strokeStyle = C.tagInk; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            [-6, 6].forEach(function (ex) { ctx.beginPath(); ctx.moveTo(ex - 4, 1); ctx.lineTo(ex, -3); ctx.lineTo(ex + 4, 1); ctx.stroke(); });
            ctx.restore();
        }
        function nameTag(p, x, y) {
            var mine = p.name === me, label = shortName(p.name);
            ctx.font = '700 11px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            var tw = ctx.measureText(label).width + 12, ty = y + 9;
            ctx.fillStyle = mine ? C.tagMe : C.tag; ctx.strokeStyle = C.tagInk; ctx.lineWidth = mine ? 2 : 1.5;
            ctx.beginPath(); ctx.roundRect(x - tw / 2, ty - 8, tw, 16, 8); ctx.fill(); ctx.stroke();
            ctx.fillStyle = C.tagInk; ctx.fillText(label, x, ty + 0.5);
        }
        function drawExclaim(x, y, clockS) {   // 놀람 "!" — 머리 위에서 톡 튄다
            var pop = 1 + 0.25 * Math.abs(Math.sin(clockS * 18));
            ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop);
            ctx.fillStyle = C.warn; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = C.warnInk; ctx.font = '900 15px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, 1);
            ctx.restore();
        }
        // 비석 — 착지 자리에 위에서 떨어져 박히고(graveDrop), 동물은 그 앞에 어질어질 앉는다(기본 시트 row 4 c3)
        function drawGrave(v, x, feet, S, face, main, clockS) {
            var k = clamp(v.since / R.graveDrop, 0, 1), e = k * k, gh = GRAVE_WORLD_H * s, gw = gh * 96 / 128;
            var gy = feet - (1 - e) * 160;
            if (ok(BP('gravestone'))) ctx.drawImage(BP('gravestone'), x - gw / 2 - S * 0.1, gy - gh, gw, gh);
            else { ctx.fillStyle = C.door; ctx.strokeStyle = C.doorDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - gw / 2 - S * 0.18, gy - gh, gw, gh, [gw / 2, gw / 2, 2, 2]); ctx.fill(); ctx.stroke(); }
            if (ok(main)) cellTo(main, 3, 4, x + S * 0.22, feet, S * 0.9, face);
            if (k < 1) return;
            if (v.since - R.graveDrop < 0.4 && ok(P('dust'))) { var dk = (v.since - R.graveDrop) / 0.4, ds = 46 * s; ctx.globalAlpha = 1 - dk * 0.6; ctx.drawImage(P('dust'), Math.min(3, Math.floor(dk * 4)) * 80, 0, 80, 80, x - ds / 2 - S * 0.18, feet - ds * 0.8, ds, ds); ctx.globalAlpha = 1; }
        }
        function drawFx(sim, view) {
            tl.popFx.forEach(function (f) {
                if (sim < f.t || sim - f.t >= POP_FX_MS) return;
                var k = (sim - f.t) / POP_FX_MS, x = sx(f.x), y = sy(f.y);
                if (ok(BP('balloon')) && k < 0.6) {   // 풍선 시트의 터짐 3칸(그 사람 색) — 지나며 알파로 서서히 사라진다
                    var fr = 1 + Math.min(2, Math.floor(k / 0.6 * 3)), sc = 2 * R.balloonR * 1.15 * s / BAL_CELL.bodyW * 1.15;
                    ctx.globalAlpha = 1 - k / 0.6;
                    ctx.drawImage(BP('balloon'), fr * BAL_CELL.w, f.row * BAL_CELL.h, BAL_CELL.w, BAL_CELL.h, x - BAL_CELL.knotX * sc, y - BAL_CELL.popCY * sc, BAL_CELL.w * sc, BAL_CELL.h * sc);
                } else if (!ok(BP('balloon'))) {
                    ctx.fillStyle = f.color; ctx.globalAlpha = 1 - k;
                    for (var i = 0; i < 7; i++) { var a = i / 7 * Math.PI * 2 + 0.3, d = (8 + 40 * k) * s; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 3 * s, 0, Math.PI * 2); ctx.fill(); }
                    ctx.globalAlpha = 1;
                }
                ctx.globalAlpha = 1 - k;
                ctx.font = '900 18px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = C.countInk; ctx.strokeText('펑!', x, y - 30 - 18 * k); ctx.fillStyle = C.popInk; ctx.fillText('펑!', x, y - 30 - 18 * k);
                ctx.globalAlpha = 1;
            });
            tl.fx.forEach(function (f) {   // 2차 짧은 연출
                var dur = f.type === 'bump' ? BUMP_FX_MS : f.type === 'item' ? ITEM_FX_MS : f.type === 'shield' ? SHIELD_FX_MS : WARP_FX_MS;
                if (sim < f.t || sim - f.t >= dur) return;
                var k = (sim - f.t) / dur, x, y;
                ctx.globalAlpha = 1 - k;
                ctx.font = '900 14px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = C.countInk; ctx.fillStyle = C.popInk;
                if (f.type === 'bump') {
                    var a = view[f.a], b = view[f.b]; if (!a || !b) return;
                    x = sx((a.x + b.x) / 2); y = sy((a.y + b.y) / 2 + BAL_OFF) - 6 * k * s;
                    if (ok(P('star'))) { var ss = 26 * s; ctx.drawImage(P('star'), Math.min(3, Math.floor(k * 4)) * STAR.cell, 0, STAR.cell, STAR.cell, x - ss / 2, y - ss / 2, ss, ss); }
                    ctx.strokeText('퉁', x, y - 14); ctx.fillText('퉁', x, y - 14);
                } else if (f.type === 'item') {
                    var v = view[f.ball]; if (!v) return;
                    x = sx(v.x); y = sy(v.y + BAL_OFF) - 20 - 20 * k;
                    var label = f.kind === 'super' ? '슈퍼!' : '방패!';
                    ctx.strokeText(label, x, y); ctx.fillText(label, x, y);
                } else if (f.type === 'shield') {
                    var w = view[f.ball]; if (!w) return;
                    var r = BODY * s * 0.78 * (1 + k * 0.4);
                    if (ok(BP('shield'))) ctx.drawImage(BP('shield'), 128, 0, 128, 128, sx(w.x) - r, sy(w.y) - BODY * s * 0.5 - r, r * 2, r * 2);
                } else {   // 하수구 들어감·나옴 — 먼지 + 글자
                    x = sx(f.x); y = sy(f.y);
                    if (ok(P('dust'))) { var ds = 44 * s; ctx.drawImage(P('dust'), Math.min(3, Math.floor(k * 4)) * 80, 0, 80, 80, x - ds / 2, y - ds * 0.8, ds, ds); }
                    var word = f.type === 'warpIn' ? '쏙!' : '뿅!';
                    ctx.strokeText(word, x, y - 26 - 10 * k); ctx.fillText(word, x, y - 26 - 10 * k);
                }
                ctx.globalAlpha = 1;
            });
            if (!ok(P('dust'))) return;
            tl.dust.forEach(function (f) {
                if (sim < f.t || sim - f.t >= DUST_FX_MS) return;
                var k = (sim - f.t) / DUST_FX_MS, v = view[f.ball], ds = 40 * s;   // dust-puff.webp 80×80 ×4
                ctx.globalAlpha = 1 - k * 0.6; ctx.drawImage(P('dust'), Math.min(3, Math.floor(k * 4)) * 80, 0, 80, 80, sx(v.x) - ds / 2, sy(v.y) - ds * 0.8, ds, ds); ctx.globalAlpha = 1;
            });
        }
        function drawEagle(sim, clockS) {
            var e = null;
            for (var i = 0; i < tl.eagles.length; i++) { var q = tl.eagles[i]; if (sim >= q.warnT && sim < q.flyT + R.eagleFly * 1000) e = q; }
            if (!e) return;
            var pos = eagleAt(sim); if (pos.x <= -900) return;
            var y = sy(pos.y);
            if (sim < e.flyT) {
                if (Math.floor(clockS * 6) % 2) return;
                var wx = e.dir > 0 ? 18 : W - 18;
                ctx.fillStyle = C.warn; ctx.beginPath(); ctx.arc(wx, y, 13, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = C.warnInk; ctx.font = '900 16px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', wx, y + 1);
                return;
            }
            var w = EAGLE.w * s, h = w * EAGLE.h / EAGLE.cell, fr = Math.floor(clockS * EAGLE.fps) % EAGLE.frames;
            ctx.save(); ctx.translate(sx(pos.x), y - h * 0.3); if (e.dir < 0) ctx.scale(-1, 1);
            if (ok(P('eagle'))) ctx.drawImage(P('eagle'), fr * EAGLE.cell, 0, EAGLE.cell, EAGLE.h, -w / 2, -h / 2, w, h);
            else { ctx.fillStyle = C.ink; ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 4, 0, 0, Math.PI * 2); ctx.fill(); }
            ctx.restore();
        }
        function drawGust(sim, clockS) {
            var g = null;
            tl.gusts.forEach(function (q) { if (sim >= q.t && sim < q.t + q.dur) g = q; });
            if (!g) return;
            var left = (g.t + g.dur - sim) / 1000, a = Math.min(1, left / 0.3, (sim - g.t) / 300);
            ctx.strokeStyle = C.wind; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.globalAlpha = a;
            for (var i = 0; i < 9; i++) {
                var y = (i * 97 + 40) % H, len = 40 + (i % 3) * 18, x = ((clockS * 420 * g.dir + i * 137) % (W + 80) + W + 80) % (W + 80) - 40;
                ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - g.dir * len, y); ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
        function drawGauge(view) {
            var x = W - 8, top = 18, bot = H - 18, yAt = function (y) { return bot - (bot - top) * clamp(y / worldH(), 0, 1); };
            ctx.strokeStyle = C.gauge; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bot); ctx.stroke();
            view.forEach(function (v) { var mine = v.p.name === me; ctx.fillStyle = v.p.color; ctx.strokeStyle = C.ink; ctx.lineWidth = mine ? 2 : 1; ctx.beginPath(); ctx.arc(x, yAt(v.y), mine ? 5.5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
        }
        function drawHud(view, rule) {   // 왼쪽 위 배지: 당첨 룰 · 도착 수
            var arrived = view.filter(function (v) { return v.st === 'done'; }).length;
            var text = (rule === 'first' ? '1등 찾기' : '꼴등 찾기') + ' · 도착 ' + arrived + '/' + view.length;
            ctx.font = '800 12px Pretendard, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            var tw = ctx.measureText(text).width + 16;
            ctx.fillStyle = C.hud; ctx.beginPath(); ctx.roundRect(8, 8, tw, 22, 11); ctx.fill();
            ctx.fillStyle = C.hudInk; ctx.fillText(text, 16, 19.5);
        }
        // 순위표(데구리처럼 오른쪽 위, 높이 게이지 왼쪽) — 도착 순 → 미도착은 높이 순. 접힘 = 당첨 자리·나·따라가는 동물, 제목을 누르면 펼침. 행을 누르면 그 동물 따라가기
        function rankOrder(view) {
            return view.slice().sort(function (a, b) {
                var da = a.st === 'done', db = b.st === 'done';
                if (da !== db) return da ? -1 : 1;
                if (da) return a.p.finishT - b.p.finishT || a.p.id - b.p.id;
                return b.y - a.y || a.p.id - b.p.id;
            });
        }
        function drawRank(view, rule, picked) {
            rankHits = []; rankToggle = null;
            if (!view.length) return;
            var order = rankOrder(view), n = order.length, endIdx = rule === 'first' ? 0 : n - 1;
            if (picked) { order = order.filter(function (v) { return v !== picked; }); order.splice(rule === 'first' ? 0 : order.length, 0, picked); }   // 판정 뒤엔 당첨자를 룰 쪽 끝에
            var keep = {};
            keep[endIdx] = true;
            order.forEach(function (v, i) { if (v.p.name === me || (camMode !== 'auto' && camMode !== 'free' && v.p === camMode)) keep[i] = true; });
            for (var i = 0; Object.keys(keep).length < Math.min(RANK_COLLAPSED, n) && i < n; i++) keep[rule === 'first' ? i : n - 1 - i] = true;
            var collapsible = n > RANK_COLLAPSED + 1, open = rankOpen || !collapsible;
            var rows = [];
            order.forEach(function (v, i) { if (open || keep[i]) rows.push({ v: v, i: i }); });
            var maxRows = Math.max(2, Math.floor((H * RANK_MAX_H - RANK_ROW) / RANK_ROW));
            if (rows.length > maxRows) rows = rows.filter(function (r) { return keep[r.i]; }).concat(rows.filter(function (r) { return !keep[r.i]; })).slice(0, maxRows).sort(function (a, b) { return a.i - b.i; });
            ctx.font = '700 11px Pretendard, sans-serif';
            var nameW = 0; rows.forEach(function (r) { nameW = Math.max(nameW, ctx.measureText(shortRank(r.v.p.name)).width); });
            var pw = 24 + 18 + nameW + 10, x0 = W - 20 - pw, y0 = 8, ph = RANK_ROW * (rows.length + 1) + 4;
            ctx.fillStyle = C.hud; ctx.beginPath(); ctx.roundRect(x0, y0, pw, ph, 8); ctx.fill();
            ctx.fillStyle = C.hudInk; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.font = '800 11px Pretendard, sans-serif';
            ctx.fillText('순위' + (collapsible ? (open ? ' ▴' : ' ▾') : ''), x0 + 8, y0 + RANK_ROW / 2 + 2);
            if (collapsible) rankToggle = { x: x0, y: y0, w: pw, h: RANK_ROW + 2 };
            ctx.font = '700 11px Pretendard, sans-serif';
            rows.forEach(function (r, k) {
                var v = r.v, ry = y0 + RANK_ROW * (k + 1) + 2, cy = ry + RANK_ROW / 2;
                if (k > 0 && r.i - rows[k - 1].i > 1) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x0 + 8, ry, pw - 16, 1); }   // 건너뛴 줄
                var isEnd = r.i === endIdx, following = camMode === v.p, mine = v.p.name === me;
                if (isEnd || following) { ctx.fillStyle = isEnd ? (rule === 'first' ? 'rgba(255,209,102,0.35)' : 'rgba(230,57,70,0.4)') : 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.roundRect(x0 + 3, ry + 1, pw - 6, RANK_ROW - 2, 5); ctx.fill(); }
                ctx.fillStyle = C.hudInk; ctx.textAlign = 'right'; ctx.fillText(String(r.i + 1), x0 + 20, cy);
                ctx.fillStyle = v.p.color; ctx.beginPath(); ctx.arc(x0 + 31, cy, 5.5, 0, Math.PI * 2); ctx.fill();
                ctx.textAlign = 'left'; ctx.fillStyle = mine ? C.tagMe : C.hudInk;
                ctx.fillText(shortRank(v.p.name), x0 + 42, cy);
                rankHits.push({ x: x0, y: ry, w: pw, h: RANK_ROW, p: v.p });
            });
        }
        function shortRank(nm) { var c = Array.from(String(nm || '')); return c.length > RANK_NAME_MAX ? c.slice(0, RANK_NAME_MAX).join('') + '…' : c.join(''); }
        function drawCountdown(left) {   // left = 출발까지 남은 ms. 첫 1초는 "준비", 그다음 3·2·1 동안 풍선을 분다
            var n = Math.ceil(left / 1000), label = n > R.inflate ? '준비' : String(n), k = left / 1000 - Math.floor(left / 1000), sc = 1 + 0.5 * k;
            ctx.save(); ctx.translate(W / 2, H * 0.4); ctx.scale(sc, sc); ctx.font = (n > R.inflate ? '900 40px' : '900 72px') + ' Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 8; ctx.strokeStyle = C.countInk; ctx.strokeText(label, 0, 0); ctx.fillStyle = C.count; ctx.fillText(label, 0, 0); ctx.restore();
        }

        // ── 카메라 조작 — 끌면 그 자리 고정(3초 입력 없으면 자동으로), 동물·순위표 행을 탭하면 그 동물 따라가기, 휠도 고정. 왼쪽 아래 버튼으로 자동 복귀 ──
        function viewPeople() {
            if (mode === 'idle') return people.map(function (p) { return { p: p, x: p.x0, y: 0 }; });
            var sim = simAt(playing ? raceReal() : tl.durationMs);
            return people.map(function (p, i) { var q = posAt(i, sim); return { p: p, x: q.x, y: q.y }; });
        }
        canvas.addEventListener('pointerdown', function (e) {
            if (!map) return;
            drag = { y: e.clientY, cam: cam, moved: false, id: e.pointerId };
        });
        canvas.addEventListener('pointermove', function (e) {
            if (!drag || drag.id !== e.pointerId) return;
            var dy = e.clientY - drag.y;
            if (!drag.moved && Math.abs(dy) < DRAG_PX) return;
            if (!drag.moved) { drag.moved = true; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } }
            if (camMode !== 'free') setCam('free');
            lastInput = now();
            cam = clamp(drag.cam + dy / s, camMin(), camMax());
            if (!playing || paused) redraw();
        });
        canvas.addEventListener('pointerup', function (e) {
            if (drag && drag.moved) lastInput = now();
            if (drag && !drag.moved && map) {   // 탭 — 순위표(제목 = 펼치기, 행 = 따라가기) 먼저, 아니면 가장 가까운 동물(몸·풍선 근처)을 따라간다
                var r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, best = null, bd = TAP_PX;
                var inBox = function (h) { return px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h; };
                if (mode === 'play' && rankToggle && inBox(rankToggle)) { rankOpen = !rankOpen; drag = null; if (!playing || paused) redraw(); return; }
                var hit = mode === 'play' ? rankHits.filter(inBox)[0] : null;
                if (hit) { setCam(hit.p); drag = null; return; }
                viewPeople().forEach(function (v) { var d = Math.hypot(sx(v.x) - px, sy(v.y + 30) - py); if (d < bd) { bd = d; best = v.p; } });
                if (best && mode === 'play') setCam(best);
            }
            drag = null;
        });
        canvas.addEventListener('pointercancel', function () { drag = null; });
        canvas.addEventListener('wheel', function (e) {
            if (!map) return;
            e.preventDefault();
            if (camMode !== 'free') setCam('free');
            lastInput = now();
            cam = clamp(cam - e.deltaY / s, camMin(), camMax());
            if (!playing || paused) redraw();
        }, { passive: false });

        // 아이콘(선택 버튼·결과 카드) — 시트 row 0 의 frame 칸
        function drawCreatureIcon(cv, creature, frame, skin) {
            var c = cv.getContext('2d'), im = sheet(creature, skin || null);
            c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
            if (ok(im)) c.drawImage(im, (frame || 0) * SPRITE.size, 0, SPRITE.size, SPRITE.size, 0, 0, cv.width, cv.height);
            else if (!im.complete) im.addEventListener('load', function () { drawCreatureIcon(cv, creature, frame, skin); }, { once: true });
        }

        resize();
        var api = {
            resize: resize, setTimeline: setTimeline, drawIdle: drawIdle, play: play, stop: stop, pause: pause, resume: resume, seek: seek, time: time,
            renderEnd: renderEnd, redraw: redraw,
            isPlaying: function () { return playing && !paused; }, isPaused: function () { return paused; },
            onFinale: function (fn) { onFinaleCb = fn; }, onEvent: function (fn) { onEventCb = fn; },
            hasCreatureSprite: function (c) { return ok(image('creatures/' + c + '.webp')); },
            drawCreatureIcon: drawCreatureIcon,
            camMode: function () { return camMode === 'auto' || camMode === 'free' ? camMode : 'follow'; },   // 테스트용
            camY: function () { return cam; },   // 테스트용 — 화면 가운데의 세계 높이
            redrawIfIdle: function () { if (!playing || paused) redraw(); }
        };
        instances.push(api);
        return api;
    }

    window.BalloonRender = { create: create, loadAssets: loadAssets, COUNTDOWN_MS: COUNTDOWN_MS };
})();
