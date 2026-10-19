/* 풍선 타기(balloon) 렌더러 — (서버 타임라인, 재생 시각) → 화면. docs/goal/balloon-climb.md §4-1·§7.
   물리 없음: 동물 위치는 서버 frames 를 보간하고, 상태(불기·터짐·낙하산·착지·도착)는 events 로만 바뀐다.
   장애물 위치는 BalloonWorld 의 시각 함수(서버 시뮬과 같은 식)로 다시 계산해 그린다. 그림은 목업 mockups/balloon-climb.html 그대로.
   공정성: 이 파일은 결과를 정하지 않는다. 자체 난수는 장식(구름·별)용 고정 시드 mulberry32 뿐이다.
   재생 제어(js/balloon.js · js/deguri-replay-gif.js 계약): play(delayMs) · stop · pause · resume · seek(ms) · time() · isPlaying · isPaused */
(function () {
    'use strict';
    var BW = window.BalloonWorld;
    var R = BW.R, Z = BW.Z, WORLD_W = BW.WORLD_W, BODY = BW.BODY, BAL_OFF = BW.BAL_OFF;

    var COUNTDOWN_MS = 4000;          // 서버 socket/balloon.js COUNTDOWN_MS 와 같은 값
    var INFLATE_DONE_BEFORE_MS = 1000; // 카운트다운 '1' 이 뜨기 전에 풍선을 다 분다(사용자 2026-10-18) — 출발 1초 전까지 COUNT_INFLATE_MS 동안 불고, '1' 동안은 다 분 풍선을 잡고 기다린다
    var COUNT_INFLATE_MS = 2000;       // 카운트다운 풍선 불기 시간("자연스럽게 빨리")
    var PUFF_GROW = 0.8;               // 불기 앞 80% = 훅훅 부풀기(입에 댄 채), 뒤 20% = 다 분 풍선이 입에서 머리 위로 떠오르기
    var PUFF_BLOW = 0.6;               // 한 번 불 때 앞 60% 는 쑥 커지고(볼 빵빵), 나머지는 숨 들이쉼
    var VIEW_ASPECT = 1.5;
    var OFFSCREEN_ASPECT = 1.2;       // 화면 밖(하이라이트 GIF) 캔버스 세로 비율 — 결과 카드에 들어가고 GIF 가 너무 커지지 않게            // 캔버스 세로 = 가로 × 이 값(위로 오르는 게임이라 세로로 길게)
    var VIEW_MIN_H = 360;             // 캔버스 최소 높이(px)
    var VIEW_PAD_H = 150;
    var AD_LIFT_KEEP = 50, AD_CHECK_MS = 300;   // 광고를 피해 올려도 알약이 캔버스 위쪽 50px 안으로는 안 간다 · 광고 겹침 다시 재는 간격             // 창 높이에서 뺄 여백 — 캔버스가 창보다 길어지지 않게
    var MAX_DPR = 2;
    var TAP_PX = 40, DRAG_PX = 6;     // 동물 탭 반경 · 끌기 문턱(목업)
    var TOAST_MS = 1100;              // 토스트 한 줄 표시(시뮬 시각 ms)
    var POP_FX_MS = 700, DUST_FX_MS = 400, SHAKE_MS = 180, DECIDE_SHAKE_MS = 200;
    var SEEK_SNAP_MS = 500;           // 이보다 크게 건너뛰면(이동 막대) 카메라를 바로 옮기고 소리를 안 낸다
    var NAME_MAX = 6;
    var NAME_HEAD = 0.8;               // 이름표 아래 끝 = 발에서 몸 크기 × 이만큼 위(머리 꼭대기 근처)
    var SAFE_BLINK_HZ = 12;
    var FACE_VX = 18;                  // 공중에서 이 가로 속도(세계/초)를 넘어야 바라보는 쪽을 바꾼다 — 그 아래는 보던 쪽 유지
    // 2차(docs/goal/balloon-climb.md §11)
    var VIEW_FIT = 0.6;   // 기본 배율(알약 100%) = 세계 폭을 화면 폭의 60% 로 — 예전 '60%' 시야가 새 100%(사용자 2026-10-19 "너무 확대, 60 을 100 으로 고정"). 알약 % 는 이 기준 대비
    var CAM_AHEAD = 60 / VIEW_FIT;   // 카메라가 동물보다 위(앞)를 보는 양 — 예전 100% 에서 화면에 보이던 60 세계 단위를 새 기준 배율에서도 같은 화면 거리로
    var ZOOM_MIN = 1, ZOOM_MAX = 2.2 / VIEW_FIT, ZOOM_STEP = 1.25, WHEEL_ZOOM = 1.1;   // 확대·축소(데구리처럼, 사용자 2026-10-18) — 알약 − 100% + 한 번에 ×/÷1.25, Ctrl+휠 한 칸 ×/÷1.1
    var MANUAL_IDLE_RETURN_MS = 3000;  // 끌어서 옮긴 카메라는 이만큼 입력이 없으면 자동으로(데구리와 같은 값). 동물 따라가기는 유지
    var CAM_EASE = 7, CAM_EASE_FAST = 16, CAM_EDGE = 0.3;   // 자동 추적 — 목표가 화면 가운데에서 CAM_EDGE×높이 넘게 벗어나면 빠르게 따라잡는다
    var CAM_ICONS = { auto: '/assets/ui/camera-auto.png?v=1', manual: '/assets/ui/camera-manual.png?v=1' };   // 카메라 버튼 아이콘 — 데구리(js/deguri-render.js)와 같은 그림
    var MM_TOP = 46, MM_W = 10, MM_H_RATIO = 0.4, MM_H_MIN = 120, MM_H_MAX = 240;   // 높이 막대 — 위끝(깃발 아래)·캡슐 폭·캔버스 높이 대비 길이(최소·최대 px)
    var RANK_ROW = 20, RANK_NAME_MAX = 5, RANK_MAX_H = 0.55, RANK_COLLAPSED = 3;   // 순위표 한 줄 높이·이름 글자 수·최대 높이(캔버스 비율)·접혔을 때 줄 수
    var BUMP_FX_MS = 350, WARP_FX_MS = 600, ITEM_FX_MS = 600, SHIELD_FX_MS = 450, FINISH_FX_MS = 1400, CLOUD_SQUISH_MS = 350;
    var BEAVER = { cell: 96, worldH: 32 };   // balloon/props/beaver-hammer.webp 96×96 ×4(걷기 2 · 망치 들기 · 내려치기) — 없으면 데구리 beaver-v2.webp(통나무 밀기)
    var PIPE = { rimTop: 8, bodyW: 101, rimW: 135 };   // 데구리 warp-pipe.webp 192×224 — 몸통 폭(px)을 R.warpBodyW 로 맞춘다
    var SKY_BANDS = [   // 높이(cam/worldH)에 따라 겹쳐 그리는 먼 배경 — [이름, 보이기 시작, 다 보임, 사라지기 시작, 다 사라짐]
        ['sky-mid', 0.08, 0.22, 0.45, 0.6], ['sky-high', 0.45, 0.6, 0.72, 0.85], ['sky-top', 0.72, 0.85, 2, 2]];

    // 게임 그림 색(캔버스) — 스킨과 무관(목업 C)
    var C = { skyLow: [159, 211, 245], skyHigh: [34, 44, 98], star: '#ffffff', cloud: '#ffffff', ground: '#7cc24a', groundDark: '#4e9a2e',
        plat: '#9b6a3c', platDark: '#6e4624', platTop: '#7cc24a', spike: '#8a5a2b', spikeTip: '#3a2a1a', string: '#4a4a4a', hand: '#f2c58d', ink: '#3a2a1a',
        tag: '#ffffff', tagInk: '#14110f', tagMe: '#ffd166', finish: '#c8281a', chuteA: '#ffffff', chuteB: '#ff5a5f', warn: '#e63946', warnInk: '#ffffff',
        wind: 'rgba(255,255,255,0.75)', alt: 'rgba(255,255,255,0.55)', gauge: 'rgba(0,0,0,0.25)', count: '#ffffff', countInk: '#14110f', popInk: '#ffffff',
        rock: '#8b7765', rockDark: '#5e4e40', thorn: '#2f5e1f', blade: '#e3b071', bladeDark: '#7a4f24', bladeTip: '#d64545', hub: '#5a3a1a', chain: '#5b5b5b',
        storm: '#4b5066', stormHi: '#8a90a8', bolt: '#ffe066',
        door: '#a7b1bc', doorDark: '#5c6773', updraft: 'rgba(255,255,255,0.18)', updraftArrow: 'rgba(255,255,255,0.7)',
        sign: '#ffffff', signInk: '#14110f', hinge: '#3a2a1a', platHint: 'rgba(255,255,255,0.75)', hud: 'rgba(20,17,15,0.72)', hudInk: '#ffffff', mmEdge: '#e0a93a', mmBand: '#ffd166' };   // mmEdge·mmBand = --deguri-gold-deep·--deguri-gold(캔버스라 값으로)
    var BALLOON = ['#ff5a5f', '#ffb400', '#3db4f2', '#7ed957', '#c77dff', '#ff8fab', '#ff7b29', '#2ec4b6'];
    var SPRITE = { frames: 4, size: 160, fps: 7 };          // 동물 시트 row 0 = 서기 4칸(데구리 manifest)
    var EAGLE = { cell: 256, h: 160, frames: 4, fps: 10, w: 92 };
    var STAR = { cell: 96, frames: 4 };
    var BAL_SPRITE = { w: 96, h: 128, knotX: 48, knotY: 106, worldH: 46 };   // 야식 풍선(deguri_balloon) 셀·매듭 — docs/goal/deguri-balloon-accessory.md 계약
    var CAUSE_TEXT = { spike: '가시에 찔렸다', blade: '풍차에 펑!', pend: '통나무에 펑!', bolt: '번개에 펑!', bee: '벌한테 펑!', thorn: '가시벽에 펑!', eagle: '독수리한테 펑!', finale: '풍선이 펑!', bomb: '폭탄에 펑!', meteor: '별똥별에 펑!' };
    var ITEM_TEXT = { super: '슈퍼 풍선!', shield: '방패!', slow: '무거운 풍선!', bomb: '깜짝 폭탄!' };
    var ITEM_FX_TEXT = { super: '슈퍼!', shield: '방패!', slow: '무거워!', bomb: '꽝!' };
    var START_BUILD_MS = 600;          // 카운트다운 때 아직 없는 층을 비버가 짓는 시간(보통은 대기 화면에서 이미 지어져 있다)
    var ARRIVE_POP_MS = 320, ARRIVE_CHUTE_MS = 1500, ROW_BUILD_MS = 1000;   // 들어올 때(사용자 2026-10-18) — 1층은 톡 튀어나옴 · 2층부터는 화면 위에서 낙하산으로 내려오고 그동안 비버가 그 층을 짓는다   // 출발 줄(§13-24) — 카운트다운 시작부터 비버가 계단 들보를 짓는 시간 · 위 줄로 뛰어오르는 시간(그다음 풍선 불기)
    var DISMOUNT_FLY_S = 1.6, DISMOUNT_DROP_H = 40, DISMOUNT_DROP_S = 0.35, DISMOUNT_RISE_S = 0.25;   // 도착 — 놓은 풍선이 날아가는 시간 · 구름 위로 더 떠오르는 높이 · 떨어지는 시간 · 더 떠오르는 시간          // 도착해서 놓은 풍선이 날아가 사라지는 시간(§13-3)
    var ROCK_TILE_WORLD = 110;         // 바위 벽 질감 타일 한 장의 세계 크기(§13-2)
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
    var GRAVE_WORLD_H = 58;
    var GRAVE_STONE_TOP = 53 / 128, GRAVE_TAG_H = 19;   // gravestone.webp 96×128 의 돌 윗선(그 위는 투명) · 이름표 높이 + 틈 — 이름표를 돌 바로 위에(사용자 2026-10-19)
    var GRAVE_WORDS = ['하늘이 너무 높았다', '풍선아 미안해', '다음 판엔 꼭 간다', '여기 잠들다', '바람이 나빴어', '조금만 더 갔으면…', '꼴찌의 영광', '내 풍선 돌려줘'];   // 비석 위 한마디(이름으로 하나 고름)            // 비석 키(세계 단위) — 몸(44)보다 커야 끝 장면의 주인공이 된다

    var A = '/assets/deguri/', VER = '?v=6';   // 데구리 에셋 그대로(js/deguri-render.js ASSET_VER 와 같은 캐시 키)
    var CREATURES = ['hedgehog', 'armadillo', 'pillbug', 'turtle', 'panda', 'hamster', 'pufferfish', 'raccoon', 'rabbit', 'ribbonpig'];
    var PIECES = { eagle: 'pieces/eagle.webp', beam: 'pieces/start-platform-mid.webp', fan: 'pieces/fan.webp', hive: 'pieces/beehive.webp', plog: 'pieces/pendulum-log.webp',
        pivot: 'pieces/pendulum-pivot.webp', flag: 'pieces/flag.webp', star: 'fx/impact-star.webp', swarm: 'fx/bee-swarm.webp', wind: 'fx/wind.webp', dust: 'fx/dust-puff.webp',
        beaver: 'pieces/beaver-v2.webp', fence: 'pieces/fence-mid.webp', post: 'pieces/fence-post.webp', pipe: 'pieces/warp-pipe.webp', skyFar: 'stage/sky-far.webp',
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
        ['balloon', 'chute', 'chestnut', 'storm', 'storm-flash', 'gravestone', 'plank', 'thorn', 'shutter', 'item-box', 'super-balloon', 'shield', 'cloud', 'cloud-happy', 'beaver-hammer', 'mystery-box', 'weight', 'bomb', 'rock'].forEach(BP);
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
    var CLOUDS = []; for (var ci = 0; ci < 8; ci++) CLOUDS.push({ x: decoRng(), y: 300 + ci * 420 + decoRng() * 160, s: 0.6 + decoRng() * 0.8 });   // 장식 구름 — 22 → 8개(사용자 2026-10-18 "구름이 너무 많다")
    var STARS = []; for (var si = 0; si < 70; si++) STARS.push({ x: decoRng(), y: decoRng(), r: 0.6 + decoRng() * 1.2 });

    var clamp = BW.clamp;
    function shortName(n) { var c = Array.from(String(n || '')); return c.length > NAME_MAX ? c.slice(0, NAME_MAX).join('') + '…' : c.join(''); }

    function create(canvas, opts) {
        var ctx = canvas.getContext('2d');
        var box = canvas.parentElement;
        var W = 0, H = 0, dpr = 1, s = 1, baseS = 1, zoom = 1, camX = WORLD_W / 2;   // s = 지금 배율(세계 → 화면 px) = baseS(세계 폭 = 화면 폭) × zoom, camX = 화면 가운데의 세계 x
        var mode = 'idle';                 // idle | play
        var tl = null, me = '', idle = null, map = null, people = [];
        var cam = 0, camMode = 'auto', drag = null;
        var playing = false, paused = false, delay = 0, t0 = 0, pauseAt = 0, raf = 0, lastRender = 0, endLoop = false;   // endLoop = 경주가 끝난 마지막 장면을 계속 움직이며 그리는 중(시뮬 시각은 끝에 멈춤)
        var lastSim = -1, finaleFired = false, onFinaleCb = null, onEventCb = null;
        var flaps = [];
        var toastEl = null, camBtn = null, camIcon = null, toastText = '', zoomPill = null, zoomVal = null, camBar = null, camLabel = '';
        var lastInput = 0, rankOpen = false, rankHits = [], rankToggle = null;
        var camFocus = null, followMe = false, mmRect = null, frameIds = null;   // frameIds = 하이라이트 GIF 가 따라갈 동물 id 순서(frameBalls)
        var idleKnown = null, rowBuildAt = {}, idleArrive = {};   // idleArrive = 이름 → 들어오는 연출 { t0, kind } — 대기 화면이 다시 갱신돼도 끝날 때까지 유지   // 출발 좌석(§13-24) — 대기 화면에 이미 있던 이름들(처음 그릴 땐 null — 들어오는 연출 없이) · 층마다 짓기 시작한 시각(ms, 없으면 아직 안 지음)   // 카메라가 보는 동물(순위표 표시) · 내 동물 따라가기 · 미니맵 자리(누르기)

        // ── DOM: 카메라 복귀 버튼 · 토스트(캔버스 박스 안, 캔버스에 그리지 않음 — C-41) ──
        if (box && !(opts && opts.offscreen)) {
            toastEl = document.createElement('div'); toastEl.className = 'balloon-toast'; toastEl.setAttribute('aria-live', 'polite'); box.appendChild(toastEl);
            // 가운데 아래 한 줄(사용자 2026-10-18·19 "데구리처럼"): 확대·축소 알약 + 카메라 버튼(데구리 아이콘 그대로 — 자동/수동 그림·색, 상태 글은 title).
            // 누르면 자동 ↔ 수동(지금 자리에 고정). 누구를 따라가는 중이어도 누르면 자동으로
            camBar = document.createElement('div'); camBar.className = 'balloon-cam-bar'; box.appendChild(camBar);
            camBtn = document.createElement('button'); camBtn.type = 'button'; camBtn.className = 'deguri-cam-btn'; camBtn.hidden = true;
            camIcon = document.createElement('img'); camIcon.alt = ''; camIcon.width = 22; camIcon.height = 22; camIcon.className = 'deguri-cam-btn__icon'; camBtn.appendChild(camIcon);
            camBtn.addEventListener('click', function () { if (camMode !== 'auto') setCam('auto'); else { setCam('free'); lastInput = now(); } });
            new Image().src = CAM_ICONS.manual;   // 처음 누를 때 아이콘이 늦게 뜨지 않게
            zoomPill = document.createElement('div'); zoomPill.className = 'deguri-zoom-pill';   // 데구리 알약 그대로(css/deguri.css) — 글자는 −·+·%. 자리는 줄(.balloon-cam-bar)이 정한다
            var mkZ = function (cls, text, label, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.title = label; b.setAttribute('aria-label', label); b.addEventListener('click', fn); zoomPill.appendChild(b); return b; };
            mkZ('deguri-zoom-pill__btn', '\u2212', '카메라 축소', function () { setZoom(zoom / ZOOM_STEP); });
            zoomVal = mkZ('deguri-zoom-pill__value', '100%', '카메라 배율 100%로 되돌리기', function () { setZoom(1); });
            mkZ('deguri-zoom-pill__btn', '+', '카메라 확대', function () { setZoom(zoom * ZOOM_STEP); });
            camBar.appendChild(zoomPill);
            camBar.appendChild(camBtn);
            document.addEventListener('scroll', liftOverAd, { passive: true, capture: true });   // 안쪽 스크롤 상자도 잡는다
        }
        // 하단 고정 광고(.ad-sticky, 경주 중엔 숨음)가 캔버스 아래를 덮으면 줌 알약·카메라 버튼을 광고 위로 올린다(사용자 2026-10-19 — 알약이 광고에 가려 "없어졌다")
        var adEl = null, adCheckAt = 0;
        function liftOverAd() {
            if (!zoomPill || hostWin() !== window) return;
            if (!adEl || !adEl.isConnected) adEl = document.querySelector('.ad-container.ad-sticky');
            var lift = 0;
            if (adEl && adEl.getClientRects().length) {
                var br = box.getBoundingClientRect(), ar = adEl.getBoundingClientRect();
                if (br.bottom > ar.top && br.bottom <= ar.bottom) lift = Math.min(br.bottom - ar.top, Math.max(0, br.height - AD_LIFT_KEEP));   // 캔버스 아래 끝이 광고 띠 안에 있을 때만 — 화면 밖이면 그대로
            }
            camBar.style.bottom = (10 + lift) + 'px';
        }
        function setCam(m) {
            camMode = m;
            updateCamLabel();
            if (!playing) redraw();
        }
        // 카메라 상태 글 — 경주 화면에서만(대기 화면은 숨김). 바뀔 때만 DOM 을 고친다
        function updateCamLabel() {
            if (!camBtn) return;
            var mine = camFocus && camFocus.name === me;
            var text = mode !== 'play' ? '' : camMode === 'free' ? '수동 카메라 — 누르면 자동으로' : camMode !== 'auto' ? shortName(camMode.name) + ' 따라가는 중 — 누르면 자동으로'
                : '자동 카메라' + (camFocus ? ' · ' + (mine ? '내 동물' : shortName(camFocus.name)) + ' 보는 중' : '');
            if (text === camLabel) return;
            camLabel = text; camBtn.title = text; camBtn.setAttribute('aria-label', text); camBtn.hidden = !text;
            var icon = camMode === 'auto' ? CAM_ICONS.auto : CAM_ICONS.manual;
            if (camIcon.getAttribute('src') !== icon) camIcon.src = icon;
            camBtn.classList.toggle('is-manual', camMode !== 'auto');
        }

        // ── 좌표 ──
        var sx = function (x) { return W / 2 + (x - camX) * s; };
        var sy = function (y) { return H / 2 - (y - cam) * s; };
        var worldH = function () { return map ? map.worldH : 4800; };
        var camMin = function () { return (H / 2 - 70) / s; };
        var camMax = function () { return Math.max(camMin(), worldH() + 170 - H / 2 / s); };

        // 캔버스가 지금 있는 창 — PiP 작은 창(js/balloon.js toggleDeguriPip)으로 옮겨 가면 그 창(데구리 rehost 와 같은 방식)
        function hostWin() { return (canvas.ownerDocument && canvas.ownerDocument.defaultView) || window; }
        var rafWin = window;
        function reqFrame() { rafWin = hostWin(); raf = rafWin.requestAnimationFrame(loop); }
        function cancelFrame() { try { rafWin.cancelAnimationFrame(raf); } catch (e) { /* 닫힌 PiP 창 */ } raf = 0; }
        // 가로 카메라 — 확대해서 세계가 화면보다 넓으면 camX 를 세계 안으로 조인다, 아니면 가운데
        function clampCamX() { var half = W / 2 / s; camX = half >= WORLD_W / 2 ? WORLD_W / 2 : clamp(camX, half, WORLD_W - half); }
        function setZoom(z) {
            zoom = clamp(z, ZOOM_MIN, ZOOM_MAX); s = baseS * zoom; clampCamX(); cam = clamp(cam, camMin(), camMax());
            if (zoomVal) zoomVal.textContent = Math.round(zoom * 100) + '%';
            if (!playing || paused) redraw();
        }
        function resize() {
            var hw = hostWin(), pip = hw !== window;
            var fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
            var fs = (!!fsEl && (fsEl === box || fsEl === canvas)) || (box && box.classList.contains('is-pseudo-fs'));
            if (!fs || pip) { canvas.style.width = ''; canvas.style.height = ''; }
            var cssW = (box && box.clientWidth) || canvas.clientWidth || WORLD_W, cssH;
            if (pip) { cssW = hw.innerWidth; cssH = hw.innerHeight; }   // 작은 창은 창을 꽉 채운다
            else if (fs) { cssW = Math.min(window.innerWidth, window.innerHeight / VIEW_ASPECT * 1.2); cssH = window.innerHeight; }
            else if (opts && opts.offscreen) cssH = Math.round(cssW * OFFSCREEN_ASPECT);
            else cssH = Math.round(Math.max(VIEW_MIN_H, Math.min(cssW * VIEW_ASPECT, window.innerHeight - VIEW_PAD_H)));
            dpr = (opts && opts.dpr) || Math.min(MAX_DPR, hw.devicePixelRatio || 1);
            W = cssW; H = cssH;
            canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
            canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
            baseS = W / WORLD_W * VIEW_FIT; s = baseS * zoom; clampCamX();
            cam = clamp(cam, camMin(), camMax());
            liftOverAd();
            if (!playing) redraw();
        }

        // ── 타임라인 준비: 공마다 상태 전환 열 · 토스트 · 연출 ──
        function setTimeline(data, myName) {
            tl = data; me = myName || ''; map = data.map; idle = null;
            var n = data.players.length;
            people = data.players.map(function (p, i) {
                return { id: p.id, name: p.owner, creature: p.creature, skin: p.skin || null, balloon: p.balloon || null, color: BALLOON[(p.colorIdx != null ? p.colorIdx : i) % BALLOON.length], colorIdx: p.colorIdx != null ? p.colorIdx : i,
                    ph: i * 1.7 + 0.3, trans: [{ t: 0, st: 'rise', safe: false }], pops: [], finishT: -1, superIv: [], shieldIv: [], slowIv: [], shieldNs: [], warps: [] };
            });
            var byId = {}; people.forEach(function (p) { byId[p.id] = p; });
            var nameOf = function (id) { return byId[id] ? byId[id].name : ''; };
            tl.toasts = [{ t: 0, text: '출발!' }];
            tl.rowSpans = [];   // 출발 줄 — frames[0] 의 높이로 줄을 알아낸다(시뮬이 줄마다 R.startRowGap 위에 세운다). 줄 1 이상은 계단 들보 위
            tl.rowPrebuilt = {};   // 대기 화면에서 이미 지은 층은 카운트다운 때 다시 짓지 않는다
            tl.seatTop = 0;
            people.forEach(function (p, i) {
                var q = BW.seatPos(data.players[i].seat != null ? data.players[i].seat : i);   // 대기 화면과 같은 좌석(서버 seat)에서 출발
                p.slotX = q.x; p.seatY = q.y; p.row = q.row; tl.seatTop = Math.max(tl.seatTop, q.y);
                var hv = Math.sin((p.id + 1) * 12.9898 + data.map.worldH * 0.0123 + data.frames.length * 0.71) * 43758.5453;   // 부스터가 터지는 순간(그림 전용) — 모든 탭이 같은 값
                p.boostAt = (hv - Math.floor(hv)) * R.boostJitter;
                tl.rowSpans[p.row] = rowFullSpan();   // 층 전체 폭
            });
            for (var rr2 = 1; rr2 < tl.rowSpans.length; rr2++) tl.rowPrebuilt[rr2] = rowBuildAt[rr2] != null;
            tl.spikeFall = {}; tl.popFx = []; tl.dust = []; tl.eagles = []; tl.gusts = []; tl.decided = null; tl.grave = null;
            tl.bridgeT = {}; tl.boxTaken = {}; tl.fx = []; tl.cloudHit = {};   // 2차: 다리 놓인 시각 · 상자 먹힌 시각들 · 짧은 연출(퉁·쏙·뿅·방패 깨짐·아이템) · 구름 착지
            var openIv = function (list, t) { var last = list[list.length - 1]; if (!(last && last.b === Infinity)) list.push({ a: t, b: Infinity }); };   // 이미 열려 있으면(겹쳐 먹기) 그대로
            var closeIv = function (list, t) { var last = list[list.length - 1]; if (last && last.b === Infinity) last.b = t; };
            var warpsOf = map.warps || [];
            people.forEach(function (p) { ['hang', 'blow', 'fall'].forEach(function (k) { bimage('creatures/' + p.creature + '-' + k + '.webp'); if (p.skin) bimage('creatures/' + p.creature + '-' + p.skin + '-' + k + '.webp'); }); });
            var curEagle = null, finN = 0;
            data.events.forEach(function (e) {
                var p = e.ball != null ? byId[e.ball] : null;
                switch (e.type) {
                    case 'pop':
                        closeIv(p.shieldIv, e.t); closeIv(p.superIv, e.t); closeIv(p.slowIv, e.t);
                        p.trans.push({ t: e.t, st: e.cause === 'finale' ? 'fdrop' : 'pop' }); p.pops.push(e.t);   // 피날레 펑 = 낙하산 없이 바로 떨어진다
                        tl.popFx.push({ t: e.t, x: e.x, y: e.y, color: p.color, row: (p.colorIdx || 0) % BALLOON.length });
                        if (e.spike != null) tl.spikeFall[e.spike] = e.t;
                        tl.toasts.push({ t: e.t, text: shortName(p.name) + ' ' + (e.cause === 'spike' ? '펑! ' : '') + (CAUSE_TEXT[e.cause] || '펑!') });
                        break;
                    case 'drop': p.trans.push({ t: e.t, st: 'drop' }); break;
                    case 'chute': p.trans.push({ t: e.t, st: 'chute' }); break;
                    case 'land':
                        p.trans.push({ t: e.t, st: 'land' }); tl.dust.push({ t: e.t, ball: e.ball });
                        if (e.plat >= 0 && map.plats[e.plat].kind === 'cloud') (tl.cloudHit[e.plat] = tl.cloudHit[e.plat] || []).push(e.t);
                        break;
                    case 'bridge': tl.bridgeT[e.idx] = e.t; tl.toasts.push({ t: e.t, text: '세이브! 비버들이 다리를 놓았다' }); break;
                    case 'item':
                        (tl.boxTaken[e.box] = tl.boxTaken[e.box] || []).push(e.t);
                        if (e.kind !== 'bomb') openIv(e.kind === 'super' ? p.superIv : e.kind === 'shield' ? p.shieldIv : p.slowIv, e.t);
                        tl.fx.push({ t: e.t, type: 'item', ball: e.ball, kind: e.kind, x: map.items[e.box].x, y: map.items[e.box].y });
                        if (e.kind === 'shield') p.shieldNs.push({ t: e.t, n: e.n || 1 });
                        if (e.kind !== 'bomb') tl.toasts.push({ t: e.t, text: shortName(p.name) + ' ' + ITEM_TEXT[e.kind] + (e.kind === 'shield' && e.n > 1 ? ' x' + e.n : '') });   // 폭탄은 바로 뒤 펑 토스트('폭탄에 펑!')가 대신한다
                        else if (e.blocked) tl.toasts.push({ t: e.t, text: shortName(p.name) + ' 폭탄도 끄떡없다!' });
                        break;
                    case 'superEnd': closeIv(p.superIv, e.t); break;
                    case 'slowEnd': closeIv(p.slowIv, e.t); break;
                    case 'shieldEnd': closeIv(p.shieldIv, e.t); p.shieldNs.push({ t: e.t, n: 0 }); break;
                    case 'shieldPop':
                        if (!e.n) closeIv(p.shieldIv, e.t); p.shieldNs.push({ t: e.t, n: e.n || 0 }); tl.fx.push({ t: e.t, type: 'shield', ball: e.ball });
                        if (e.spike != null) tl.spikeFall[e.spike] = e.t;   // 방패로 막아도 밤송이는 쓰여서 떨어진다(시뮬 spikeUsed 와 맞춤 — 안 그러면 안 터지는 밤송이가 남아 보였다)
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
                    case 'spikeKnock': tl.spikeFall[e.spike] = e.t; break;   // 무적 풍선에 닿은 밤송이 — 떨어져 사라진다
                    case 'inflate': p.trans.push({ t: e.t, st: 'inflate', dur: e.dur }); break;
                    case 'rise': p.trans.push({ t: e.t, st: 'rise', safe: true }); break;
                    case 'finish':
                        p.trans.push({ t: e.t, st: 'done' }); p.finishT = e.t;
                        finN++; tl.fx.push({ t: e.t, type: 'finish', ball: e.ball, n: finN });   // 도착하는 순간 바로 몇 등인지 띄운다 — 도착한 동물은 그 순간 꼴등 후보에서 빠진다
                        tl.toasts.push({ t: e.t, text: shortName(p.name) + ' ' + finN + '등 도착!' });
                        break;
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
        var manualNow = null;   // 화면 밖(하이라이트 GIF) 그리기 — 시계를 render(t, dt) 가 민다(그리는 속도와 상관없이 GIF 시각대로 움직이게)
        function now() { return manualNow != null ? manualNow : performance.now(); }
        function elapsed() { return (paused ? pauseAt : now()) - t0; }   // play() 뒤 지난 실제 ms(카운트다운 포함)
        function raceReal() { return elapsed() - delay; }
        function play(delayMs) {
            delay = delayMs || 0; t0 = now(); paused = false; playing = true; endLoop = false; lastSim = -1; finaleFired = false; lastRender = now();
            cancelFrame(); reqFrame();
        }
        function stop() { playing = false; paused = false; endLoop = false; cancelFrame(); }
        function pause() { if (!playing || paused) return; pauseAt = now(); paused = true; cancelFrame(); drawAt(raceReal(), 0); }
        function startEndLoop() { endLoop = true; lastRender = now(); cancelFrame(); reqFrame(); }   // 도착 뒤에도 동물·구름이 계속 움직이게(사용자 2026-10-18)
        function resume() { if (!playing || !paused) return; t0 += now() - pauseAt; paused = false; lastRender = now(); reqFrame(); }
        // 캔버스가 다른 창(PiP)으로 옮겨진 뒤 — 토스트·카메라 버튼을 캔버스 옆으로 데려가고, 걸려 있던 프레임을 새 창에 다시 건다
        function rehost() {
            var host = canvas.parentElement;
            if (host) { if (toastEl) host.appendChild(toastEl); if (camBar) host.appendChild(camBar); }
            if (playing && !paused) { cancelFrame(); reqFrame(); }
        }
        function seek(ms) {
            if (!tl) return;
            endLoop = false;
            ms = clamp(ms, 0, tl.durationMs);
            t0 = (paused ? pauseAt : now()) - delay - ms;
            if (!playing) { playing = true; paused = true; pauseAt = now(); t0 = pauseAt - delay - ms; }
            drawAt(ms, 0);
        }
        function time() { return tl ? clamp(raceReal(), 0, tl.durationMs) : 0; }
        function loop() {
            raf = 0;
            if (mode === 'idle' && !playing) { if (W && map && idle) drawIdleScene(); reqFrame(); return; }   // 대기 화면 — 계단 짓기·깡충·서기 프레임
            if (endLoop && !playing && tl) { var tN = now(), d2 = Math.min(0.1, (tN - lastRender) / 1000); lastRender = tN; drawAt(tl.durationMs, d2); reqFrame(); return; }
            if (!playing || paused) return;
            var tNow = now(), dt = Math.min(0.1, (tNow - lastRender) / 1000); lastRender = tNow;
            var rr = raceReal();
            drawAt(rr, dt);
            if (tl && rr >= tl.durationMs) { playing = false; startEndLoop(); return; }   // 시뮬은 마지막 장면에 멈추고, 그림은 계속 움직인다
            reqFrame();
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
            var bo = boostOffset(people[i], sim);   // 출발 부스터 — 아래층은 처져 보이다가 제 순간에 따라붙는다(계산은 모두 같은 출발선)
            var wps = people[i] && people[i].warps;   // 하수구 순간이동이 두 표본 사이에 있으면 미끄러지지 않게 — 그 전은 앞 표본, 그 뒤는 뒤 표본
            if (wps) for (var w = 0; w < wps.length; w++) if (wps[w] > a * tl.sampleMs && wps[w] <= b * tl.sampleMs) { u = sim < wps[w] ? 0 : 1; break; }
            var fa = f[a], fb = f[b];
            return { x: fa[i * 3] + (fb[i * 3] - fa[i * 3]) * u, y: fa[i * 3 + 1] + (fb[i * 3 + 1] - fa[i * 3 + 1]) * u - bo, lean: fa[i * 3 + 2] + (fb[i * 3 + 2] - fa[i * 3 + 2]) * u };
        }
        // 그림에서만 아래로 처지는 양 — 맨 위 층과의 높이 차를 부스터 순간(boostAt)부터 boostDur 동안 메운다(시뮬은 모두 맨 위 층 높이에서 출발, 층은 결과와 무관)
        function boostOffset(p, sim) {
            if (!p || !tl || p.seatY == null) return 0;
            var gap = tl.seatTop - p.seatY; if (gap <= 0) return 0;
            var k = clamp((sim / 1000 - p.boostAt) / R.boostDur, 0, 1);
            return gap * (1 - k * k * (3 - 2 * k));
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
            if (now() - adCheckAt > AD_CHECK_MS) { adCheckAt = now(); liftOverAd(); }   // 광고가 나타나고 사라지는 건 스크롤 없이도 일어난다
            if (!tl) return;
            var counting = rr < 0, csMs = elapsed() - (delay - COUNTDOWN_MS), sim = simAt(rr), jump = lastSim < 0 || Math.abs(sim - lastSim) > SEEK_SNAP_MS;
            var simDt = jump ? 0 : (sim - lastSim) / 1000;
            if (!jump && playing && !paused && onEventCb) tl.events.forEach(function (e) { if (e.t > lastSim && e.t <= sim) onEventCb(e); });
            if (!finaleFired && tl.decided && sim >= tl.decided.t) {
                finaleFired = true;
                if (tl.target !== 'first' && camMode !== 'auto') setCam('auto');   // 꼴찌 하이라이트 — 누구를 따라가고 있었든 꼴찌에게로(데구리처럼 확정 순간 한 번)
                if (!jump && onFinaleCb) onFinaleCb();
            }
            var t = sim / 1000, clockS = now() / 1000;
            var rule = tl.target;
            // 동물 상태
            var view = people.map(function (p, i) {
                var ck = counting ? clamp((elapsed() - (delay - INFLATE_DONE_BEFORE_MS - COUNT_INFLATE_MS)) / COUNT_INFLATE_MS, 0, 1) : 1;
                var pos = posAt(i, sim), st = counting ? { st: ck < 1 ? 'inflate' : 'rise', t: -1 } : stateAt(p, sim), back = posAt(i, Math.max(0, sim - 80));   // 다 불었으면 풍선을 잡고 출발을 기다린다
                var vx = (pos.x - back.x) / 0.08;
                var v = { p: p, x: pos.x, y: pos.y, wind: pos.lean, st: st.st, since: (sim - st.t) / 1000, vx: vx, pops: 0 };
                for (var k = 0; k < p.pops.length && p.pops[k] <= sim; k++) v.pops++;
                if (counting) { v.k = ck; v.dur = COUNT_INFLATE_MS; }
                else if (st.st === 'inflate') { v.k = clamp((sim - st.t) / st.dur, 0, 1); v.dur = st.dur; }
                else v.k = 1;
                v.safe = st.st === 'rise' && st.safe && sim - st.t < R.safeDur * 1000;
                var airborne = st.st === 'rise' || st.st === 'chute' || st.st === 'drop' || st.st === 'done';
                if (Math.abs(vx) > FACE_VX) p.faceDir = Math.sign(vx);   // 움직이는 쪽을 본다 — 거의 멈추면 보던 쪽 그대로(풍선과 따로 놀지 않게, 사용자 2026-10-18)
                v.face = airborne ? (p.faceDir || 1) : Math.abs(vx) > 14 ? Math.sign(vx) : (Math.sin(t * 0.45 + p.ph * 7) > 0.15 ? 1 : -1);   // 땅에선 멈추면 두리번(그림 전용)
                var inIv = function (list) { for (var q = 0; q < list.length; q++) if (sim >= list[q].a && sim < list[q].b) return true; return false; };
                v.super = !counting && inIv(p.superIv); v.shield = !counting && inIv(p.shieldIv); v.slow = !counting && inIv(p.slowIv);
                v.shieldN = 0; for (var sq = 0; sq < p.shieldNs.length && p.shieldNs[sq].t <= sim; sq++) v.shieldN = p.shieldNs[sq].n;   // 방패 개수(겹쳐 먹기)
                return v;
            });
            var picked = tl.decided && sim >= tl.decided.t ? view[tl.decided.ball] : null;
            // 카메라 — 끌어서 옮긴 수동 카메라는 입력 없이 3초 지나면 자동으로(데구리 MANUAL_IDLE_RETURN_MS)
            if (camMode === 'free' && playing && !paused && !drag && now() - lastInput > MANUAL_IDLE_RETURN_MS) setCam('auto');
            camFocus = null;   // 순위표 카메라 표시 — 지금 카메라가 따라가는 동물
            if (camMode !== 'free') {
                var target, mine = followMe && me ? view.filter(function (v) { return v.p.name === me && v.st !== 'done'; })[0] : null;   // 내가 도착하면 시스템 카메라(꼴등 쪽)로 넘긴다(사용자 2026-10-19)
                if (camMode !== 'auto') { var fv = view.filter(function (v) { return v.p === camMode; })[0]; target = fv ? fv.y + CAM_AHEAD : cam; camFocus = fv ? fv.p : null; }
                else if (frameIds && frameIds.length) {   // 하이라이트 장면 — 앞에 놓인 동물부터, 도착한 동물은 건너뛴다(다 도착했으면 첫 동물)
                    var fl = frameIds.map(function (id) { return view.filter(function (v) { return v.p.id === id; })[0]; }).filter(Boolean);
                    var hv = fl.filter(function (v) { return v.st !== 'done'; })[0] || fl[0];
                    if (hv) { target = hv.y + CAM_AHEAD; camFocus = hv.p; } else target = cam;
                }
                else if (picked) { target = picked.y + CAM_AHEAD * 2 / 3; camFocus = picked.p; }
                else if (mine) { target = mine.y + CAM_AHEAD; camFocus = mine.p; }   // 내 동물 따라가기 스위치(§12-10)
                else {
                    var lv = view.filter(function (v) { return v.st !== 'done'; }); if (!lv.length) lv = view.slice();
                    lv.sort(function (a, b) { return a.y - b.y; });
                    var span = H / s * 0.55;   // 꼴등 룰: 아래 두 마리가 한 화면에 들어오면 둘의 중간, 멀면 꼴등만(중간을 비추면 아무도 안 보인다)
                    if (rule === 'first') { target = lv[lv.length - 1].y + CAM_AHEAD * 2; camFocus = lv[lv.length - 1].p; }
                    else { target = (lv.length > 1 && lv[1].y - lv[0].y < span ? (lv[0].y + lv[1].y) / 2 : lv[0].y) + CAM_AHEAD; camFocus = lv[0].p; }
                }
                target = clamp(target, camMin(), camMax());
                var ease = Math.abs(target - cam) * s > H * CAM_EDGE ? CAM_EASE_FAST : CAM_EASE;   // 화면 끝 쪽으로 벗어나면 빨리 따라잡는다(슈퍼 풍선·하수구)
                cam = jump || counting ? (counting ? camMin() : target) : cam + (target - cam) * Math.min(1, Math.max(simDt, dt) * ease);
                var fx = WORLD_W / 2; if (camFocus) view.forEach(function (v) { if (v.p === camFocus) fx = v.x; });   // 확대했을 때 가로도 보는 동물을 따라간다
                camX = jump || counting ? fx : camX + (fx - camX) * Math.min(1, Math.max(simDt, dt) * CAM_EASE); clampCamX();
            }
            updateCamLabel();
            // 여닫이 발판 — 밑에서 오르는 동물이 지나가는 동안 열린다(그림 전용)
            var fdt = jump ? 1 : dt;
            map.plats.forEach(function (q, i) {
                if (q.solid || q.kind) return;
                var fl = flaps[i];
                if (view.some(function (v) { return v.st === 'rise' && v.y < q.y - 4 && v.y + BAL_OFF + R.balloonR > q.y - 6 && Math.abs(v.x - q.x) < q.w / 2 + 14; })) fl.hold = R.flapHold;   // 시뮬(FLAP_BELOW 4)과 같은 조건 — 판 위에서 출발하는 동물은 제 판을 안 연다
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
            drawBleachers(tl.rowSpans, function (r) { return tl.rowPrebuilt[r] || !counting ? 1 : csMs / START_BUILD_MS; }, clockS);
            view.slice().sort(function (a, b) { return ((a.p.name === me) - (b.p.name === me)) || ((a.p === camFocus) - (b.p === camFocus)) || a.y - b.y; }).forEach(function (v) { drawPlayer(v, clockS, picked); });   // 내 동물은 맨 앞, 그다음 카메라가 보는 동물
            if (!counting && sim < (R.boostJitter + R.boostDur) * 1000) view.forEach(function (v) { drawBoost(v, sim, clockS); });   // 출발 부스터 불꽃 — 동물마다 제각각 터진다(솟는 속도만큼) · 동물·이름표 앞에
            if (picked && rule !== 'first') drawSpotlight(picked, sim);
            drawFx(sim, view);
            drawEagle(sim, clockS);
            drawGust(sim, clockS);
            map.hazards.forEach(function (h) { if (h.type === 'meteor') drawMeteor(h, t, clockS); });   // 별똥별은 화면 표시(순위표·배지)만 빼고 맨 앞 — 동물·이펙트·꼴찌 스포트라이트 위(사용자 2026-10-18 "배경 같다")
            drawHud(view, rule);
            drawRank(view, rule, picked);
            drawMinimap(view);
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
            var tNow = now(), first = idleKnown === null, rows = {};
            people = preview.players.map(function (p, i) {
                var q = BW.seatPos(p.seat != null ? p.seat : i), arrive = null;   // 좌석은 서버가 정해 그대로 — 사람이 들어와도 이미 선 동물은 안 움직인다
                rows[q.row] = true;
                if (!first && !idleKnown[p.owner]) {   // 새로 들어왔다 — 1층은 톡 튀어나오고, 2층부터는 화면 위에서 낙하산으로(그동안 비버가 그 층을 짓는다)
                    idleArrive[p.owner] = { t0: tNow, kind: q.row ? 'chute' : 'pop' };
                    if (q.row && rowBuildAt[q.row] == null) rowBuildAt[q.row] = tNow;
                }
                arrive = idleArrive[p.owner] || null;
                if (arrive && tNow - arrive.t0 > ARRIVE_CHUTE_MS + 1000) { delete idleArrive[p.owner]; arrive = null; }
                return { id: p.id, name: p.owner, creature: p.creature, skin: p.skin || null, balloon: p.balloon || null, color: BALLOON[(p.colorIdx != null ? p.colorIdx : i) % BALLOON.length], colorIdx: p.colorIdx != null ? p.colorIdx : i, ph: i * 1.7 + 0.3, dim: !!p.dim,
                    seatX: q.x, seatY: q.y, row: q.row, arrive: arrive };
            });
            Object.keys(rowBuildAt).forEach(function (r) { if (!rows[r]) delete rowBuildAt[r]; });   // 비어 버린 층은 걷는다
            Object.keys(rows).forEach(function (r) { if (+r > 0 && rowBuildAt[r] == null) rowBuildAt[r] = -Infinity; });   // 처음 그릴 때 이미 있던 층은 다 지어진 채로
            idleKnown = {}; people.forEach(function (p) { idleKnown[p.name] = true; });
            idle.slotSpans = [];   // 층 들보는 늘 그 층 전체 폭(8칸) — 9번째가 들어오는 순간 2층 전체를 왼쪽부터 한 번에 짓는다(사용자 2026-10-18)
            people.forEach(function (p) { idle.slotSpans[p.row] = rowFullSpan(); });
            flaps = map.plats.map(function () { return { open: 0, hold: 0 }; });
            if (camMode === 'auto' || typeof camMode === 'object') { camMode = 'auto'; cam = camMin(); }
            updateCamLabel();
            redraw();
            cancelFrame(); reqFrame();   // 대기 화면도 계속 움직인다(들어오기·계단 짓기·서기 프레임)
        }
        // 대기 화면 한 사람의 지금 모습 — 들어오는 중이면 톡(1층)·낙하산(2층~), 아니면 좌석에 서 있다
        function idleViewOf(p, tNow) {
            var v = { p: p, x: p.seatX, y: p.seatY, wind: 0, st: 'wait', since: 0, vx: 0, k: 0, face: 1, safe: false, pops: 0 }, a = p.arrive;
            if (!a) return v;
            var el = tNow - a.t0;
            if (a.kind === 'pop') { var u = clamp(el / ARRIVE_POP_MS, 0, 1); if (u < 1) { v.y += Math.sin(u * Math.PI) * 16; v.st = u < 0.5 ? 'land' : 'wait'; v.since = u < 0.5 ? 0 : (el - ARRIVE_POP_MS / 2) / 1000; } return v; }
            var k = clamp(el / ARRIVE_CHUTE_MS, 0, 1), topY = cam + H / 2 / s + 40, e = 1 - (1 - k) * (1 - k);
            if (k < 1) { v.y = topY + (p.seatY - topY) * e; v.x += Math.sin(el / 300 + p.ph) * 10 * (1 - k); v.st = 'chute'; v.since = el / 1000; return v; }
            if (el - ARRIVE_CHUTE_MS < R.landDur * 1000) { v.st = 'land'; v.since = (el - ARRIVE_CHUTE_MS) / 1000; }
            return v;
        }
        function drawIdleScene() {
            var tNow = now(), clockS = tNow / 1000;
            cam = clamp(cam, camMin(), camMax());
            drawBackground();
            drawWorld(0, 0, clockS);
            drawBleachers(idle.slotSpans, function (r) { return rowBuildAt[r] == null ? 0 : (tNow - rowBuildAt[r]) / ROW_BUILD_MS; }, clockS);
            people.map(function (p) { return idleViewOf(p, tNow); }).sort(function (a, b) { return (a.p.name === me) - (b.p.name === me); }).forEach(function (v) { drawPlayer(v, clockS, null); });
            drawMinimap(null);
        }
        function redraw() {
            if (!W) return;
            if (mode === 'idle') { if (map && idle) drawIdleScene(); }   // setTimeline 도중(idle 비움 → mode 'play' 사이)에는 그리지 않는다
            else if (tl) drawAt(playing ? raceReal() : tl.durationMs, 0);
        }
        function renderEnd() { if (tl) { stop(); lastSim = -1; drawAt(tl.durationMs, 0); startEndLoop(); } }

        // ── 그리기(목업 그대로) ──
        function skyColor(k) { var a = C.skyLow, b = C.skyHigh; return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * k); }).join(',') + ')'; }
        function drawBackground() {
            var k = clamp(cam / worldH(), 0, 1);
            ctx.fillStyle = skyColor(k); ctx.fillRect(-10, -10, W + 20, H + 20);
            drawFarBackground(k);
            if (k > 0.45) { ctx.globalAlpha = (k - 0.45) / 0.55; ctx.fillStyle = C.star; STARS.forEach(function (st) { ctx.beginPath(); ctx.arc(st.x * W, st.y * H, st.r, 0, Math.PI * 2); ctx.fill(); }); ctx.globalAlpha = 1; }
            ctx.fillStyle = C.cloud; ctx.globalAlpha = 0.35 * (1 - k * 0.6);
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
                if (q.kind === 'pivot') return;   // 흔들 통나무 축 받침 — 받침 그림은 장치(drawHazards)가 그린다
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
            drawFences(t);
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
            if (fy > -60 && fy < H + 60) {   // 도착 지점 = 구름 줄(§12-4) — 구름 쿠션 그림을 이어 깐다(없으면 흰 원)
                if (ok(BP('cloud'))) {
                    var cw3 = 96 * s, ch3 = cw3 / 2;
                    for (var cx3 = -cw3 * 0.3, ci3 = 0; cx3 < W + cw3; cx3 += cw3 * 0.62, ci3++) ctx.drawImage(BP('cloud'), 0, 0, 192, 96, cx3 - cw3 / 2, fy - ch3 * 0.45 + (ci3 % 2) * 5 * s, cw3, ch3);
                } else {
                    ctx.fillStyle = C.cloud;
                    for (var cx2 = -10; cx2 < W + 30; cx2 += 34) { ctx.beginPath(); ctx.arc(cx2, fy + 8 + (Math.round(cx2) % 3) * 2, 24, 0, Math.PI * 2); ctx.fill(); }
                    ctx.fillRect(0, fy + 8, W, 40);
                }
                if (!ok(BP('cloud'))) { ctx.setLineDash([8, 6]); ctx.strokeStyle = C.finish; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke(); ctx.setLineDash([]); }
                if (ok(P('flag'))) {
                    var fr = Math.floor(clockS * 4) % 2, fs = 40 * s;
                    ctx.drawImage(P('flag'), fr * 32, 0, 32, 64, 10, fy - fs * 2 + 6, fs, fs * 2);
                    ctx.save(); ctx.translate(W - 10, 0); ctx.scale(-1, 1); ctx.drawImage(P('flag'), fr * 32, 0, 32, 64, 0, fy - fs * 2 + 6, fs, fs * 2); ctx.restore();
                }
                var flw = Math.max(5, 6 * s);   // 도착선 — 발이 이 높이에 닿으면 도착(서버 p.y >= worldH). 글자 없이 굵은 흰·빨강 줄무늬 띠(거의 동시에 도착해도 어느 쪽이 먼저인지 보이게, 사용자 2026-10-19)
                ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(0, fy - flw * 1.8, W, flw * 3.6);
                ctx.lineWidth = flw; ctx.setLineDash([flw * 2, flw * 2]);
                ctx.strokeStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
                ctx.lineDashOffset = flw * 2; ctx.strokeStyle = C.finish; ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke();
                ctx.setLineDash([]); ctx.lineDashOffset = 0;
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
        // 출발 계단 들보(§13-24) — 줄 1 이상마다 그 줄 폭만큼 들보 + 땅까지 기둥. 카운트다운 처음 START_BUILD_MS 동안 비버가 망치질하며 왼쪽부터 깐다
        function rowFullSpan() { var a = BW.seatPos(0).x, b = a; for (var k = 1; k < 8; k++) { var x = BW.seatPos(k).x; a = Math.min(a, x); b = Math.max(b, x); } return [a, b]; }   // 한 층 8칸의 왼쪽·오른쪽 끝
        function drawBleachers(spans, progressOf, clockS) {   // spans[줄] = [왼쪽 x, 오른쪽 x], progressOf(줄) = 짓기 진행도(1 이상이면 다 지음)
            if (!spans) return;
            var tw = 44 * s, th = tw * 44 / 128;
            for (var r = 1; r < spans.length; r++) {
                var sp = spans[r]; if (!sp) continue;
                var k = clamp(progressOf(r), 0, 1), x0 = sx(sp[0] - 30), x1 = sx(sp[1] + 30), y = sy(r * R.startRowGap), reach = x0 + (x1 - x0) * k;
                if (y < -40 || y > H + 60 || k <= 0) continue;
                ctx.strokeStyle = C.platDark; ctx.lineWidth = 4 * s;   // 기둥
                [x0 + 6 * s, x1 - 6 * s].forEach(function (px) { if (px <= reach) seg(px, y, px, sy(0)); });
                for (var x = x0; x < reach - 0.5; x += tw) { var cw = Math.min(tw, reach - x); if (ok(P('beam'))) ctx.drawImage(P('beam'), 0, 3, 128 * cw / tw, 44, x, y - 2, cw, th); else { ctx.fillStyle = C.platDark; ctx.fillRect(x, y, cw, 9 * s); } }
                if (k < 1 && ok(BP('beaver-hammer'))) { var bh = BEAVER.worldH * s; ctx.drawImage(BP('beaver-hammer'), (2 + Math.floor(clockS * 8) % 2) * BEAVER.cell, 0, BEAVER.cell, BEAVER.cell, reach - bh * 0.4, y - bh, bh, bh); }   // 들보 끝에서 망치질
            }
        }
        // 출발 부스터 불꽃(사용자 2026-10-18 "부스터 같은 연출") — 좌석이 낮을수록 세게, 부스터가 끝날수록 잦아든다. 위치는 결과를 안 바꾼다(시뮬이 같은 높이로 맞춤)
        function drawBoost(v, sim, clockS) {   // 부스터가 터진 동안(boostAt ~ +boostDur) 불꽃 — 따라붙을 높이가 클수록 세게
            var p = v.p, gap = tl.seatTop - (p.seatY || 0), k = (sim / 1000 - p.boostAt) / R.boostDur;
            if (gap <= 0 || k <= 0 || k >= 1) return;
            var gain = clamp(gap / Math.max(R.startRowGap, tl.seatTop), 0.35, 1) * Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5 + 0.0) * (1 - k * 0.5);
            var x = sx(v.x), y = sy(v.y) + 3, L = (24 + 56 * gain) * s * (0.85 + 0.15 * Math.sin(clockS * 40 + p.ph)), wd = (7 + 5 * gain) * s;   // 발밑에서 뿜는다
            var g = ctx.createLinearGradient(x, y, x, y + L);
            g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.3, 'rgba(255,200,60,0.95)'); g.addColorStop(1, 'rgba(255,80,20,0)');
            ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - wd, y); ctx.quadraticCurveTo(x, y + L * 1.15, x + wd, y); ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,240,180,0.9)'; for (var q = 0; q < 3; q++) { var ph = (clockS * 5 + q / 3 + p.ph) % 1; dot(x + Math.sin(q * 2.3 + clockS * 9) * wd, y + L * ph, (1 - ph) * 2.4 * s); }   // 불티
        }
        function drawBridges(sim, clockS, view) {   // 세이브 다리(§12-1) — 양 벽에서 비버가 망치질하며 앞으로 나오고(망치질한 데까지 통나무), 다 놓으면(bridgeBuild) 펑 사라진다. 다리는 남는다
            (map.bridges || []).forEach(function (b) {
                var bt = tl && tl.bridgeT[b.idx]; if (bt == null || sim < bt) return;
                var y = sy(b.y); if (y < -40 || y > H + 40) return;
                var el = (sim - bt) / 1000, k = clamp(el / R.bridgeBuild, 0, 1), reach = WORLD_W / 2 * s * k, L0 = sx(0), R0 = sx(WORLD_W);   // 세계 폭 기준(확대·축소)
                var tw = 44 * s, th = tw * 44 / 128, gaps = [];
                (view || []).forEach(function (v) { if (v.st === 'rise' && Math.abs(v.y + BAL_OFF - b.y) < 60) gaps.push(sx(v.x)); });   // 밑에서 오르는 동물 — 통나무가 비켜 준다
                [1, -1].forEach(function (d) {
                    for (var x = 0; x < reach; x += tw) {
                        var cw = Math.min(tw, reach - x), x0 = d > 0 ? L0 + x : R0 - x - cw;
                        if (gaps.some(function (g) { return Math.abs(x0 + cw / 2 - g) < 26 * s; })) continue;
                        if (ok(P('beam'))) ctx.drawImage(P('beam'), 0, 3, 128 * cw / tw, 44, x0, y - 2, cw, th); else { ctx.fillStyle = C.platDark; ctx.fillRect(x0, y, cw, 10 * s); }
                    }
                });
                if (el > R.bridgeBuild + R.bridgePoof) return;   // 비버는 다 놓고 사라졌다
                var bh = BEAVER.worldH * s, hammer = BP('beaver-hammer');
                [1, -1].forEach(function (d) {
                    var bx = d > 0 ? L0 + reach - bh * 0.3 : R0 - reach + bh * 0.3;   // 놓인 통나무 맨 앞(가운데 쪽)에 서서 망치질
                    if (el > R.bridgeBuild) {   // 펑 — 먼지와 함께 사라진다
                        var pk = (el - R.bridgeBuild) / R.bridgePoof;
                        if (ok(P('dust'))) { var ds = bh * 1.4; ctx.globalAlpha = 1 - pk * 0.5; ctx.drawImage(P('dust'), Math.min(3, Math.floor(pk * 4)) * 80, 0, 80, 80, bx - ds / 2, y - ds * 0.85, ds, ds); ctx.globalAlpha = 1; }
                        return;
                    }
                    ctx.save(); ctx.translate(bx, y); if (d < 0) ctx.scale(-1, 1);   // 시트는 오른쪽 향함 — 오른쪽 비버는 뒤집어 가운데를 본다
                    if (ok(hammer)) ctx.drawImage(hammer, (2 + Math.floor(clockS * 7) % 2) * BEAVER.cell, 0, BEAVER.cell, BEAVER.cell, -bh / 2, -bh, bh, bh);   // 망치 들기 · 내려치기
                    else if (ok(P('beaver'))) ctx.drawImage(P('beaver'), (Math.floor(clockS * 6) % 2) * BEAVER.cell, 0, BEAVER.cell, BEAVER.cell, -bh / 2, -bh, bh, bh);
                    ctx.restore();
                });
            });
        }
        function drawItems(sim, clockS) {   // 아이템 상자 — item-box.webp 64×64 ×2(가만 · 반짝). 먹힌 뒤 itemRespawn 초 동안 없다
            if (!map.items) return;
            map.items.forEach(function (it) {
                var taken = tl && (tl.boxTaken[it.idx] || []).some(function (ts) { return sim >= ts && sim < ts + R.itemRespawn * 1000; });
                if (taken) return;
                var y = sy(it.y + Math.sin(clockS * 2.4 + it.idx) * 4); if (y < -30 || y > H + 30) return;
                var sz = R.itemR * 2.4 * s, fr = Math.floor(clockS * 2.5 + it.idx) % 2;
                var box = BP(it.kind === 'mystery' ? 'mystery-box' : 'item-box');   // 선물 상자 / ? 상자(mystery-box.webp 64×64 ×2)
                if (ok(box)) ctx.drawImage(box, fr * 64, 0, 64, 64, sx(it.x) - sz / 2, y - sz / 2, sz, sz);
                else { ctx.fillStyle = C.tagMe; ctx.fillRect(sx(it.x) - sz / 3, y - sz / 3, sz / 1.5, sz / 1.5); }
            });
        }
        function drawFences(t) {   // 웃는 얼굴 울타리(§12-11) — 데구리 drawWall 과 같은 그림(fence-mid 128×40 을 선분 따라 이어 깔고 양 끝에 fence-post 24×56)
            (map.fences || []).forEach(function (f0) {
                var f = BW.fenceSeg(f0, t);   // 눈 꼭대기 문은 경첩을 축으로 아래로 젖혀진다(시뮬과 같은 식)
                var x1 = sx(f.x1), y1 = sy(f.y1), x2 = sx(f.x2), y2 = sy(f.y2);
                if (Math.max(y1, y2) < -30 || Math.min(y1, y2) > H + 30) return;
                var len = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1), fh = 15 * s, seg = fh * 128 / 40;
                ctx.save(); ctx.translate(x1, y1); ctx.rotate(ang);
                if (ok(P('fence'))) for (var d = 0; d < len; d += seg) ctx.drawImage(P('fence'), 0, 0, 128 * Math.min(1, (len - d) / seg), 40, d, -fh / 2, Math.min(seg, len - d), fh);
                else { ctx.strokeStyle = C.platDark; ctx.lineWidth = 5 * s; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke(); }
                ctx.restore();
                if (ok(P('post'))) { var pw = 9 * s, ph = 21 * s; [[x1, y1], [x2, y2]].forEach(function (q) { ctx.drawImage(P('post'), q[0] - pw / 2, q[1] - ph + 5 * s, pw, ph); }); }
            });
        }
        // 바위 벽 질감(§13-2) — rock.webp 이음매 없는 타일을 세계에 붙여(카메라와 같이 움직이게) 채운다. 못 받았으면 null → 단색
        var rockPat = null, rockPatImg = null;
        function rockFill() {
            var im = BP('rock'); if (!ok(im)) return null;
            if (rockPatImg !== im || !rockPat) { rockPat = ctx.createPattern(im, 'repeat'); rockPatImg = im; }
            var k = ROCK_TILE_WORLD * s / im.naturalWidth, oy = sy(0) % (ROCK_TILE_WORLD * s);
            if (rockPat.setTransform && window.DOMMatrix) rockPat.setTransform(new DOMMatrix().translate(0, oy).scale(k));
            return rockPat;
        }
        function drawWalls() {
            map.sections.forEach(function (q) {
                if (!q.corr || sy(q.y1) > H + 20 || sy(q.y0) < -20) return;
                [0, 1].forEach(function (side) {
                    ctx.beginPath(); ctx.moveTo(side ? W : 0, sy(q.y0));
                    for (var y = q.y0; y < q.y1 + 12; y += 12) { var yy = Math.min(y, q.y1); ctx.lineTo(sx(BW.sectionBounds(q, yy - q.y0)[side]), sy(yy)); }
                    ctx.lineTo(side ? W : 0, sy(q.y1)); ctx.closePath();
                    ctx.fillStyle = rockFill() || C.rock; ctx.fill(); ctx.strokeStyle = C.rockDark; ctx.lineWidth = 3; ctx.stroke();
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
        function drawMeteor(h, t, clockS) {   // 별똥별(§13-16) — 떨어질 자리 위에서 반짝(경고) → 빛나는 머리 + 꼬리
            var m = BW.meteorAt(h, t), fade = null;
            if (!m) { m = fade = BW.meteorFadeAt(h, t); if (!m) return; }   // 다 떨어진 뒤 — 계속 내려가며 흐려진다(충돌 없음)
            var mx = sx(m.x);
            if (m.y == null) {   // 경고 — 떨어질 자리 꼭대기에서 별이 반짝이며 커진다
                var ty = sy(h.y - 30), r = (4 + 8 * m.warn) * s * (Math.floor(clockS * 10) % 2 ? 1 : 0.7);
                if (ty < -20 || ty > H + 20) return;
                ctx.save(); ctx.translate(mx, ty); ctx.fillStyle = 'rgba(255,245,180,' + (0.5 + 0.5 * m.warn) + ')';
                ctx.beginPath(); for (var q = 0; q < 8; q++) { var a = q / 8 * Math.PI * 2, rr = q % 2 ? r * 0.35 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.restore();
                return;
            }
            var hx = mx, hy = sy(m.y); if (hy < -120 || hy > H + 120) return;
            ctx.save(); if (fade) ctx.globalAlpha *= fade.a;
            var tl2 = 120 * s, dx = -24 / h.len * tl2 * 6, tail = ctx.createLinearGradient(hx, hy, hx + dx, hy - tl2);   // 긴 불꼬리(주황 → 투명)
            tail.addColorStop(0, 'rgba(255,170,60,0.95)'); tail.addColorStop(0.5, 'rgba(255,120,40,0.5)'); tail.addColorStop(1, 'rgba(255,90,30,0)');
            ctx.strokeStyle = tail; ctx.lineWidth = Z.meteorR * 1.8 * s; ctx.lineCap = 'round'; seg(hx, hy, hx + dx, hy - tl2);
            var gl = ctx.createRadialGradient(hx, hy, 0, hx, hy, Z.meteorR * 3 * s);   // 바깥 빛
            gl.addColorStop(0, 'rgba(255,240,180,0.9)'); gl.addColorStop(1, 'rgba(255,200,80,0)');
            ctx.fillStyle = gl; dot(hx, hy, Z.meteorR * 3 * s);
            ctx.fillStyle = '#fff8e0'; ctx.strokeStyle = '#ff8a1f'; ctx.lineWidth = 2.5 * s; ctx.beginPath(); ctx.arc(hx, hy, Z.meteorR * 1.05 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();   // 흰 심 + 주황 테두리
            ctx.fillStyle = '#ffffff'; for (var sp = 0; sp < 4; sp++) { var sk = (clockS * 6 + sp * 0.25) % 1; dot(hx + dx * sk + Math.sin(sp * 2.1) * 6 * s, hy - tl2 * sk, (1 - sk) * 2.2 * s); }   // 꼬리 불티
            ctx.restore();
        }
        // 꼴찌 하이라이트(사용자 2026-10-18) — 꼴찌 확정부터 끝까지 꼴찌 둘레만 밝고 나머지는 어둡게(0.4초에 걸쳐 들어온다)
        function drawSpotlight(v, sim) {
            var k = clamp((sim - tl.decided.t) / 400, 0, 1); if (k <= 0) return;
            var cx = sx(v.x), cy = sy(v.y + 30), r0 = 55 * s, r1 = 140 * s;   // 밤하늘에서도 보이게 진하게
            var g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
            g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + (0.72 * k) + ')');
            ctx.fillStyle = 'rgba(255,240,200,' + (0.10 * k) + ')'; dot(cx, cy, r0);   // 꼴찌 자리는 살짝 밝게
            ctx.fillStyle = g; ctx.fillRect(-10, -10, W + 20, H + 20);
        }
        // 번개 줄기 — 위(x, y0)에서 len 아래로 지그재그 + 잔가지 하나. 모양은 seed(시각 프레임)로 바뀌며 깜빡인다. 빛(넓고 옅게) → 노란 줄기 → 흰 심
        function drawLightning(x, y0, len, seed) {
            var rnd = function (k) { var v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
            var pts = [[x, y0]], N = 9;
            for (var i = 1; i <= N; i++) pts.push([x + (i < N ? (rnd(i) - 0.5) * 26 * s : (rnd(i) - 0.5) * 8 * s), y0 + len * i / N]);
            var bi = 3 + Math.floor(rnd(20) * 3), bd = rnd(21) < 0.5 ? -1 : 1, br = [pts[bi]];
            for (var j = 1; j <= 3; j++) br.push([pts[bi][0] + bd * j * 11 * s + (rnd(30 + j) - 0.5) * 8 * s, pts[bi][1] + j * len / N * 0.8]);
            var path = function (ps) { ctx.beginPath(); ctx.moveTo(ps[0][0], ps[0][1]); for (var q = 1; q < ps.length; q++) ctx.lineTo(ps[q][0], ps[q][1]); ctx.stroke(); };
            ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            [[16, 'rgba(255,236,140,0.35)'], [7, 'rgba(255,210,60,0.95)'], [3, '#ffffff']].forEach(function (l) { ctx.lineWidth = l[0] * s; ctx.strokeStyle = l[1]; path(pts); ctx.lineWidth = l[0] * s * 0.6; path(br); });
            ctx.restore();
        }
        function drawHazards(t, clockS) {
            map.hazards.forEach(function (h) {
                if (h.type === 'meteor') return;   // 동물 앞에서 따로 그린다(drawAt)
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
                    if (st === 1) {   // 경고(§13-13) — 네모 범위 대신 빗방울 + 구름 밑에서 자라는 희미한 전기 줄기(깜빡)
                        var wp = clamp((BW.cyc(h, t, Z.boltPeriod) - (Z.boltPeriod - Z.boltWarn - Z.boltDur)) / Z.boltWarn, 0, 1), L = Z.boltLen * s;
                        ctx.strokeStyle = 'rgba(110,140,190,0.6)'; ctx.lineWidth = 1.4;
                        for (var rd = 0; rd < 9; rd++) { var rx = x + ((rd * 37) % bw) - bw / 2, ry = y + 10 * s + ((clockS * 420 + rd * 61) % (L * 0.9)); seg(rx, ry, rx - 2, ry + 9 * s); }
                        if (Math.floor(clockS * 14) % 3) {
                            ctx.strokeStyle = 'rgba(255,240,150,' + (0.25 + 0.35 * wp) + ')'; ctx.lineWidth = 1.6 + wp; ctx.beginPath(); ctx.moveTo(x, y + 12 * s);
                            for (var zj = 1; zj <= 6; zj++) ctx.lineTo(x + Math.sin(zj * 1.9 + Math.floor(clockS * 10)) * 9 * s, y + 12 * s + L * wp * zj / 6);
                            ctx.stroke();
                        }
                    }
                    if (st === 2) {   // 내리치는 끝자락 번쩍임
                        var gl = ctx.createRadialGradient(x, y + Z.boltLen * s, 0, x, y + Z.boltLen * s, 34 * s);
                        gl.addColorStop(0, 'rgba(255,240,150,0.7)'); gl.addColorStop(1, 'rgba(255,240,150,0)');
                        ctx.fillStyle = gl; ctx.fillRect(x - 34 * s, y + Z.boltLen * s - 34 * s, 68 * s, 68 * s);
                    }
                    if (st === 2) drawLightning(x, y + 12 * s, Z.boltLen * s, Math.floor(clockS * 24) + h.phase * 100);   // 번개 — 그림(아이콘 모양)을 늘리면 도트가 깨져서 코드로 그린다(사용자 2026-10-18)
                    var flash = st === 2 || (st === 1 && Math.floor(clockS * 12) % 2), cloud = BP(flash ? 'storm-flash' : 'storm');
                    if (st === 0 && ok(BP('cloud-happy'))) {   // 쉬는 동안은 하얀 웃는 구름(cloud-happy.webp 192×128 ×2, 숨쉬기) — 화나면(경고·내리침) 먹구름(§12-3)
                        var hw2 = 104 * s, hh2 = hw2 * 128 / 192;
                        ctx.drawImage(BP('cloud-happy'), (Math.floor(clockS * 1.6) % 2) * 192, 0, 192, 128, x - hw2 / 2, y - hh2 * 0.55, hw2, hh2);
                    } else if (ok(cloud)) { var cw2 = 104 * s, ch2 = cw2 * 128 / 192; ctx.drawImage(cloud, x - cw2 / 2, y - ch2 * 0.55, cw2, ch2); }   // storm(-flash).webp 192×128
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
                    var nearHive = sw && sw[1] > h.y - 60;   // 벌 떼가 벌집 앞에 올 때만 들썩
                    if (ok(P('hive'))) { ctx.save(); ctx.translate(x, y); if (h.s < 0) ctx.scale(-1, 1); ctx.rotate(nearHive ? Math.sin(clockS * 30) * 0.06 : 0); ctx.drawImage(P('hive'), nearHive ? 96 : 0, 0, 96, 128, -hw / 2, -hw * 0.45, hw, hw * 4 / 3); ctx.restore(); }
                    if (sw && ok(P('swarm'))) { var sb = 2 * Z.beeR * s * 1.5; ctx.drawImage(P('swarm'), Math.floor(clockS * 10) % 4 * 128, 0, 128, 96, sx(sw[0]) - sb / 2, sy(sw[1]) - sb * 0.375, sb, sb * 0.75); }
                } else if (h.type === 'shutter') {
                    var open = BW.shutOpen(h, t), c = BW.cyc(h, t, Z.shutPeriod), pr = Math.min(1, c / Z.shutSlide), e = pr * pr * (3 - 2 * pr), halfW = WORLD_W / 2 * s, L0 = sx(0), dth = 10 * s;   // 문은 세계 폭 기준(확대·축소)
                    var lOff = open < 0 ? e : 1 - e, rOff = open > 0 ? e : 1 - e;   // 열리는 쪽은 벽 속으로, 닫히는 쪽은 나온다
                    ctx.fillStyle = C.doorDark; ctx.fillRect(L0, y - 2, halfW * 2, 4);
                    if (ok(BP('shutter'))) {   // shutter.webp 192×32 — 경고 줄무늬가 가운데(맞닿는 쪽)에 오게 왼쪽 문은 뒤집는다
                        var sh = 13 * s;
                        ctx.save(); ctx.translate(L0 - lOff * halfW + halfW, y - sh / 2); ctx.scale(-1, 1); ctx.drawImage(BP('shutter'), 0, 0, halfW, sh); ctx.restore();
                        ctx.drawImage(BP('shutter'), L0 + halfW + rOff * halfW, y - sh / 2, halfW, sh);
                    } else {
                        ctx.fillStyle = C.door; ctx.strokeStyle = C.doorDark; ctx.lineWidth = 2;
                        ctx.beginPath(); ctx.rect(L0 - lOff * halfW, y - dth / 2, halfW, dth); ctx.fill(); ctx.stroke();
                        ctx.beginPath(); ctx.rect(L0 + halfW + rOff * halfW, y - dth / 2, halfW, dth); ctx.fill(); ctx.stroke();
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
                var sc3 = 2 * R.balloonR * 1.15 * s * k * 1.3 / BAL_CELL.bodyW, sf = Math.floor(now() / 120) % 2;
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
        // 내 동물 = 금색 실선 테두리(데구리처럼 또렷하게, 사용자 2026-10-18 "너무 안 보임") · 카메라가 보는 다른 동물 = 노란 빛 테두리
        var OUTLINE_PX = 2.5, MINE_OUTLINE = '#ffc928';
        var canFilter = typeof ctx.filter === 'string';
        function drawPlayer(v, clockS, picked) {
            var mine = me && v.p.name === me, glow = !mine && mode === 'play' && camFocus && v.p === camFocus;
            if (!mine && !glow) { drawPlayerBody(v, clockS, picked); return; }
            ctx.save();
            if (mine && canFilter) {   // 그림 둘레를 네 방향으로 밀어 찍은 그림자 = 실선 테두리
                var o = OUTLINE_PX + 'px', c = MINE_OUTLINE;
                ctx.filter = 'drop-shadow(' + o + ' 0 0 ' + c + ') drop-shadow(-' + o + ' 0 0 ' + c + ') drop-shadow(0 ' + o + ' 0 ' + c + ') drop-shadow(0 -' + o + ' 0 ' + c + ')';
            } else { ctx.shadowColor = mine ? MINE_OUTLINE : 'rgba(255,240,150,1)'; ctx.shadowBlur = mine ? 6 : 12; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }   // 필터를 못 쓰는 브라우저는 진한 빛으로
            drawPlayerBody(v, clockS, picked);
            ctx.restore();
        }
        function drawPlayerBody(v, clockS, picked) {
            var S = BODY * s, x = sx(v.x), feet = sy(v.y), p = v.p, st = v.st;
            if (st === 'warp' || feet < -160 || feet > H + 80) return;   // 하수구 안 — 안 보인다
            var hop = picked === v && tl && tl.target === 'first' ? Math.abs(Math.sin(clockS * 6)) * 12 : 0;   // 1등 룰 당첨자만 폴짝(꼴등은 비석)
            feet -= hop;
            var lift = 0, doneT = st === 'done' ? v.since : -1;   // 도착 직후 — 풍선을 잡은 채 구름 위로 조금 더 떠올랐다가(DISMOUNT_RISE_S) 놓고 떨어진다
            if (doneT >= 0 && doneT < DISMOUNT_RISE_S) { var ru = doneT / DISMOUNT_RISE_S; lift = DISMOUNT_DROP_H * s * (1 - (1 - ru) * (1 - ru)); feet -= lift; st = 'rise'; }
            if (p.dim) ctx.globalAlpha = 0.45;
            var hangSt = st === 'rise', flail = st === 'pop' || st === 'drop' || st === 'fdrop' || st === 'shock';
            var face = v.face, main = sheet(p.creature, p.skin);
            var bx = sx(v.x + v.wind * R.balTilt), knotY = sy(v.y + BAL_OFF) + R.balloonR * 1.15 * s - lift;   // 풍선 매듭(화면)
            // 매달림: 줄 토막 꼭대기(HANG_ANCHOR)를 축으로 — 몸은 풍선 줄 방향을 따라 기울고(바람에 풍선이 쏠리면 몸도 줄을 따라), 옆으로 움직이면 살짝 뒤처져 흔들린다
            var rot = 0;
            if (hangSt) {
                var a0 = cellPt(x, feet, S, face, HANG_ANCHOR[0], HANG_ANCHOR[1]);
                var lean = Math.atan2(bx - a0[0], Math.max(4, a0[1] - knotY));
                rot = clamp(lean * 0.85 + v.vx / 520, -0.45, 0.45) + Math.sin(clockS * 2.1 + p.ph) * 0.035;
            }
            var blink = v.safe && Math.floor(clockS * SAFE_BLINK_HZ) % 2 ? 0.45 : 1;
            if (hangSt || st === 'shock') {
                var hs = st === 'shock' ? poseSheet(p, 'fall') : poseSheet(p, 'hang');
                var anc = st === 'shock' ? cellPt(x, feet, S, face, 80, 28) : cellPt(x, feet, S, face, HANG_ANCHOR[0], HANG_ANCHOR[1]);
                stringTo(anc[0], anc[1], bx, knotY, (bx - anc[0]) * 0.2 + 3 * s); drawBalloonAt(v, bx, knotY, 1, blink * (p.dim ? 0.45 : 1));
                ctx.save(); ctx.translate(anc[0], anc[1]); ctx.rotate(st === 'shock' ? Math.sin(clockS * 40) * 0.06 : rot); ctx.translate(-anc[0], -anc[1]);
                if (hs) cellTo(hs, st === 'shock' ? 0 : frameOf('hang', clockS, p, Math.abs(v.vx) > 30), 0, x, feet, S, face);
                else { codeArms(x, feet - S / 2, S, feet - S / 2 - S * 0.62, false, clockS); if (ok(main)) cellTo(main, 0, 0, x, feet, S, face); }
                ctx.restore();
                if (st === 'shock') drawExclaim(x, feet - S * 1.02, clockS);
                if (v.slow && st === 'rise') {   // 무거운 풍선(§13-1) — 발밑에 쇳덩이 추가 매달려 흔들린다
                    var wsz = 20 * s, wy = feet + 6 * s, wx = x + Math.sin(clockS * 3 + p.ph) * 3 * s;
                    ctx.strokeStyle = C.string; ctx.lineWidth = Math.max(1, s); seg(x, feet - 2 * s, wx, wy);
                    if (ok(BP('weight'))) ctx.drawImage(BP('weight'), wx - wsz / 2, wy - wsz * 0.15, wsz, wsz);
                    else { ctx.fillStyle = C.ink; dot(wx, wy + wsz / 2, wsz / 2); }
                }
            } else if (st === 'chute') {   // 낙하산 — 손으로 잡지 않고 가만히 엎드린 채 등에 단다(사용자 2026-10-18). 엎드린 자세 = 동물 시트 row 4 c0
                var back = cellPt(x, feet, S, face, 80, 100);
                drawChuteAt(v, back[0], back[1]);
                if (ok(main)) cellTo(main, 0, 4, x, feet, S, face);
                else { var hs2 = poseSheet(p, 'hang'); if (hs2) cellTo(hs2, 0, 0, x, feet, S, face); }
            } else if (st === 'done') {   // 도착(§13-3) — 풍선에서 내려 도착 구름 위에 선다. 놓은 풍선은 위로 날아가며 사라진다
                var t2 = v.since - DISMOUNT_RISE_S, fk = clamp(t2 / DISMOUNT_FLY_S, 0, 1), dk = clamp(t2 / DISMOUNT_DROP_S, 0, 1), lt = t2 - DISMOUNT_DROP_S;   // 구름보다 조금 위에서 놓고 떨어져 내린다(사용자 2026-10-18)
                var drop = (1 - dk * dk) * DISMOUNT_DROP_H * s, sq2 = lt >= 0 && lt < 0.25 ? 0.8 + 0.2 * lt / 0.25 : 1;
                if (fk < 1) drawBalloonAt(v, bx + Math.sin(t2 * 4 + p.ph) * 6 * s, knotY - DISMOUNT_DROP_H * s - t2 * 90 * s, 1, (1 - fk) * (p.dim ? 0.45 : 1));
                ctx.save(); ctx.translate(x, feet); ctx.scale(1, sq2); ctx.translate(-x, -feet);
                if (dk < 1) { var fs2 = poseSheet(p, 'fall'); if (fs2) cellTo(fs2, 1 + Math.floor(t2 * 10) % 3, 0, x, feet - drop, S, face); else if (ok(main)) cellTo(main, 0, 0, x, feet - drop, S, face); }   // 떨어지는 동안은 허우적
                else if (ok(main)) cellTo(main, Math.floor((clockS + p.ph) * SPRITE.fps) % SPRITE.frames, 0, x, feet, S, face);
                ctx.restore();
                if (dk < 1) feet -= drop;   // 이름표도 같이
            } else if (st === 'inflate') {   // 훅훅 불기(한 번에 쑥 커지고 살짝 출렁) → 다 불면 입에서 머리 위로 떠오른다 — 시각은 v.k(0~1)만의 함수라 되감기·시크에도 같다
                var bs = poseSheet(p, 'blow'), mouth = MOUTH[p.creature] || [116, 66];
                var m = bs ? cellPt(x, feet, S, face, mouth[0], mouth[1]) : [x, feet - S * 0.9];
                var pf = puffLook(v.k, v.dur), kx = m[0] + (bx - m[0]) * pf.lift, ky = m[1] + (knotY - m[1]) * pf.lift;
                if (pf.lift > 0) stringTo(m[0], m[1], kx, ky, 2 * s);
                if (bs) { cellTo(bs, pf.frame, 0, x, feet, S, face); drawBalloonAt(v, kx, ky, pf.size, 1); }
                else { drawBalloonAt(v, kx, ky, pf.size, 1); if (ok(main)) cellTo(main, 0, 0, x, feet, S, face); }
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
            if (v.shield && (hangSt || st === 'shock')) drawShield(bx, knotY - (BAL_CELL.knotY - BAL_CELL.popCY) * (2 * R.balloonR * 1.15 * s / BAL_CELL.bodyW), R.balloonR * 2.1 * s, clockS, v.shieldN);   // 방패는 풍선 몸통 가운데(풍선 칸의 몸통 중심 popCY)를 감싼다(§12-5)
            if (st !== 'grave') nameTag(p, x, feet - S * NAME_HEAD - 19);   // 이름표는 머리 위(사용자 2026-10-18) — nameTag 는 y+1~y+17 에 그린다
            ctx.globalAlpha = 1;
        }
        function drawShield(x, cy, rr, clockS, count) {   // 방패 — shield.webp 128×128 ×2 의 첫 칸(속이 빈 비눗방울 고리), 풍선 가운데(x, cy)를 반지름 rr 로 감싼다
            var r = rr * (1 + 0.04 * Math.sin(clockS * 5));
            if (ok(BP('shield'))) { ctx.globalAlpha *= 0.9; ctx.drawImage(BP('shield'), 0, 0, 128, 128, x - r, cy - r, r * 2, r * 2); ctx.globalAlpha = 1; }
            else { ctx.strokeStyle = 'rgba(120,200,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, cy, r * 0.9, 0, Math.PI * 2); ctx.stroke(); }
            if (count > 1) {   // 겹쳐 먹은 방패 — 'x2'
                var lx = x + r * 0.75, ly = cy - r * 0.75, lab = 'x' + count;
                ctx.font = '900 11px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                var lw = ctx.measureText(lab).width + 8;
                ctx.fillStyle = '#3db4f2'; ctx.strokeStyle = C.tagInk; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(lx - lw / 2, ly - 8, lw, 16, 8); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#ffffff'; ctx.fillText(lab, lx, ly + 0.5);
            }
        }
        // 풍선 불기 모양 — k(0~1)·불기 시간(ms) → { size(0.18~1), lift(0~1, 입 → 머리 위), frame(blow 시트 칸) }. 1.5초 넘게 불면 세 번, 짧으면 두 번 훅훅
        function puffLook(k, dur) {
            var n = dur >= 1500 ? 3 : 2, ease = function (u) { return 1 - Math.pow(1 - u, 3); };
            if (k >= PUFF_GROW) { var u2 = (k - PUFF_GROW) / (1 - PUFF_GROW), l = u2 * u2 * (3 - 2 * u2); return { size: 1 + 0.06 * Math.sin(u2 * Math.PI), lift: l, frame: 0 }; }
            var P = k / PUFF_GROW * n, i = Math.min(n - 1, Math.floor(P)), u = P - i, blow = u < PUFF_BLOW;
            var g = (i + ease(Math.min(1, u / PUFF_BLOW))) / n;
            var wob = blow ? 0 : 0.07 * Math.sin((u - PUFF_BLOW) / (1 - PUFF_BLOW) * Math.PI * 2) * (1 - (u - PUFF_BLOW) / (1 - PUFF_BLOW));   // 다 불고 나서 살짝 출렁
            return { size: (0.18 + 0.82 * g) * (1 + wob), lift: 0, frame: (blow ? 1 : 0) + (i % 2) * 2 };
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
        // 비석(데구리와 같음, 사용자 2026-10-18 "떨어지고 나면 비석만") — 비석이 위에서 떨어지는 동안만 동물이 엎어져 있고(시트 row 4 c0),
        // 박히는 순간 먼지와 함께 동물은 사라져 비석만 남는다
        function drawGrave(v, x, feet, S, face, main, clockS) {
            var k = clamp(v.since / R.graveDrop, 0, 1), e = k * k, gh = GRAVE_WORLD_H * s, gw = gh * 96 / 128;
            var gy = feet - (1 - e) * 160;
            if (k < 1 && ok(main)) cellTo(main, 0, 4, x, feet, S, face);
            if (ok(BP('gravestone'))) ctx.drawImage(BP('gravestone'), x - gw / 2, gy - gh, gw, gh);
            else { ctx.fillStyle = C.door; ctx.strokeStyle = C.doorDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - gw / 2, gy - gh, gw, gh, [gw / 2, gw / 2, 2, 2]); ctx.fill(); ctx.stroke(); }
            // 비석 바로 위에 이름표(사용자 2026-10-19 — 비석 안에 새기면 가장자리에 걸려서 더 위로) — 머리 위 이름표와 같은 모양
            var stoneTop = ok(BP('gravestone')) ? gy - gh * (1 - GRAVE_STONE_TOP) : gy - gh;
            nameTag(v.p, x, stoneTop - GRAVE_TAG_H);
            if (k < 1) return;
            // 비석 위 한마디 — 박힌 뒤 떠오른다. 문구는 이름에서 정해져 모든 탭이 같다
            var mk = clamp((v.since - R.graveDrop) / 0.4, 0, 1);
            if (mk > 0) {
                var hv = 0; for (var ci = 0; ci < v.p.name.length; ci++) hv = (hv * 31 + v.p.name.charCodeAt(ci)) % 9973;
                var msg = GRAVE_WORDS[hv % GRAVE_WORDS.length], by = stoneTop - GRAVE_TAG_H - 20 - mk * 6;   // 이름표 위
                ctx.save(); ctx.globalAlpha *= mk; ctx.font = '800 12px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                var mw = ctx.measureText(msg).width + 16;
                ctx.fillStyle = C.tag; ctx.strokeStyle = C.tagInk; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.roundRect(x - mw / 2, by - 11, mw, 22, 11); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(x - 5, by + 11); ctx.lineTo(x, by + 17); ctx.lineTo(x + 5, by + 11); ctx.fill(); ctx.stroke();
                ctx.fillStyle = C.tag; ctx.fillRect(x - 5, by + 9, 10, 3);
                ctx.fillStyle = C.tagInk; ctx.fillText(msg, x, by + 0.5);
                ctx.restore();
            }
            if (v.since - R.graveDrop < 0.5 && ok(P('dust'))) { var dk = (v.since - R.graveDrop) / 0.5, ds = 64 * s; ctx.globalAlpha = 1 - dk * 0.7; ctx.drawImage(P('dust'), Math.min(3, Math.floor(dk * 4)) * 80, 0, 80, 80, x - ds / 2, feet - ds * 0.75, ds, ds); ctx.globalAlpha = 1; }   // 펑 — 동물이 사라진 자리
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
                ctx.globalAlpha = 1;   // 떠오르는 '펑!' 글자는 뺐다 — 터짐 그림·토스트가 이미 있어 헷갈렸다(사용자 2026-10-18)
            });
            tl.fx.forEach(function (f) {   // 2차 짧은 연출
                var dur = f.type === 'bump' ? BUMP_FX_MS : f.type === 'item' ? ITEM_FX_MS : f.type === 'shield' ? SHIELD_FX_MS : f.type === 'finish' ? FINISH_FX_MS : WARP_FX_MS;
                if (sim < f.t || sim - f.t >= dur) return;
                var k = (sim - f.t) / dur, x, y;
                ctx.globalAlpha = 1 - k;
                ctx.font = '900 14px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = C.countInk; ctx.fillStyle = C.popInk;
                if (f.type === 'bump') {
                    var a = view[f.a], b = view[f.b]; if (!a || !b) return;
                    x = sx((a.x + b.x) / 2); y = sy((a.y + b.y) / 2 + BAL_OFF) - 6 * k * s;
                    if (ok(P('star'))) { var ss = 26 * s; ctx.drawImage(P('star'), Math.min(3, Math.floor(k * 4)) * STAR.cell, 0, STAR.cell, STAR.cell, x - ss / 2, y - ss / 2, ss, ss); }
                } else if (f.type === 'item') {
                    var v = view[f.ball]; if (!v) return;
                    if (f.kind === 'bomb') {   // 깜짝 폭탄 — 상자 자리에서 폭탄이 부풀었다가 별과 함께 터진다
                        var bxx = sx(f.x), byy = sy(f.y), bs = R.itemR * 2.6 * s * (1 + k * 0.6);
                        if (k < 0.35 && ok(BP('bomb'))) { ctx.globalAlpha = 1; ctx.drawImage(BP('bomb'), bxx - bs / 2, byy - bs / 2, bs, bs); }
                        else if (ok(P('star'))) { var ss2 = 54 * s; ctx.drawImage(P('star'), Math.min(3, Math.floor((k - 0.35) / 0.65 * 4)) * STAR.cell, 0, STAR.cell, STAR.cell, bxx - ss2 / 2, byy - ss2 / 2, ss2, ss2); }
                        ctx.globalAlpha = 1 - k;
                    }
                    x = sx(v.x); y = sy(v.y + BAL_OFF) - 20 - 20 * k;
                    var label = ITEM_FX_TEXT[f.kind] || '';
                    ctx.strokeText(label, x, y); ctx.fillText(label, x, y);
                } else if (f.type === 'finish') {   // 도착 순서 알약 — 도착선 위에 'N등'. 거의 동시에 들어와도 알약이 겹치지 않게 높이를 번갈아
                    var fv = view[f.ball]; if (!fv) return;
                    ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
                    var lab = f.n + '등', lx = clamp(sx(fv.x), 26, W - 26), ly = sy(worldH()) - (58 + ((f.n - 1) % 3) * 20 + 8 * k) * s;
                    ctx.font = '900 14px Pretendard, sans-serif';
                    var lw2 = ctx.measureText(lab).width + 16;
                    ctx.fillStyle = C.tagMe; ctx.strokeStyle = C.tagInk; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.roundRect(lx - lw2 / 2, ly - 11, lw2, 22, 11); ctx.fill(); ctx.stroke();
                    ctx.fillStyle = C.tagInk; ctx.fillText(lab, lx, ly + 0.5);
                } else if (f.type === 'shield') {
                    var w = view[f.ball]; if (!w) return;
                    var r = R.balloonR * 2.1 * s * (1 + k * 0.4), bcy = sy(w.y + BAL_OFF);   // 풍선 자리에서 깨진다
                    if (ok(BP('shield'))) ctx.drawImage(BP('shield'), 128, 0, 128, 128, sx(w.x + w.wind * R.balTilt) - r, bcy - r, r * 2, r * 2);
                } else {   // 하수구 들어감·나옴 — 먼지 + 글자
                    x = sx(f.x); y = sy(f.y);
                    if (ok(P('dust'))) { var ds = 44 * s; ctx.drawImage(P('dust'), Math.min(3, Math.floor(k * 4)) * 80, 0, 80, 80, x - ds / 2, y - ds * 0.8, ds, ds); }
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
        var RULE_BADGE_H = 22, RULE_BADGE_GAP = 4;
        function drawHud(view, rule) {   // 오른쪽 위 룰 배지만(순위표 바로 위) — 왼쪽 위 '꼴등 찾기 · 도착 n/m' 은 뺐다(사용자 2026-10-18)
            var text = rule === 'first' ? '1등 찾기' : '꼴등 찾기';
            ctx.font = '800 12px Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            var tw = ctx.measureText(text).width + 18, x0 = W - 8 - tw;
            ctx.fillStyle = rule === 'first' ? 'rgba(200,150,20,0.9)' : 'rgba(200,40,50,0.9)'; ctx.beginPath(); ctx.roundRect(x0, 8, tw, RULE_BADGE_H, 11); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.fillText(text, x0 + tw / 2, 8 + RULE_BADGE_H / 2 + 0.5);
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
        var FACE_CROP = { x: 62, y: 34, w: 86, h: 86 };   // 서기 칸(160) 안 머리 자리 — 데구리 drawMiniIcon 과 같은 값
        function faceIcon(p, cx, cy, size, strong) {   // 동물 얼굴 원 + 풍선 색 테두리(데구리 순위표·미니맵 아이콘)
            var im = sheet(p.creature, p.skin), r = size / 2;
            ctx.save();
            if (ok(im)) {
                ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
                ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(cx - r, cy - r, size, size);
                ctx.drawImage(im, FACE_CROP.x, FACE_CROP.y, FACE_CROP.w, FACE_CROP.h, cx - r, cy - r, size, size);
                ctx.restore(); ctx.save();
            }
            ctx.strokeStyle = p.color; ctx.lineWidth = strong ? 2.2 : 1.4; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
            if (!ok(im)) { ctx.fillStyle = p.color; ctx.fill(); }
            if (strong) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r + 1.6, 0, Math.PI * 2); ctx.stroke(); }
            ctx.restore();
        }
        function camGlyph(x, y) {   // 작은 카메라 표시(순위표 — 지금 카메라가 보는 동물)
            ctx.save(); ctx.fillStyle = C.tagMe; ctx.strokeStyle = C.tagInk; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(x - 5, y - 3, 10, 7, 1.5); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.rect(x - 2, y - 5, 4, 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = C.tagInk; ctx.beginPath(); ctx.arc(x, y + 0.5, 1.8, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
        function drawRank(view, rule, picked) {   // 데구리 순위표(§12-9): '순위표' · N위/꼴찌 · 얼굴 · 이름 · 카메라 표시 · 전체 보기/접기
            rankHits = []; rankToggle = null;
            if (!view.length) return;
            var order = rankOrder(view), n = order.length, endIdx = rule === 'first' ? 0 : n - 1;
            if (picked) { order = order.filter(function (v) { return v !== picked; }); order.splice(rule === 'first' ? 0 : order.length, 0, picked); }   // 판정 뒤엔 당첨자를 룰 쪽 끝에
            var keep = {};   // 접혔을 때 = 1등 · 꼴등 · 내 동물만(사용자 2026-10-18)
            keep[0] = true; keep[n - 1] = true;
            order.forEach(function (v, i) { if (v.p.name === me) keep[i] = true; });
            var collapsible = n > RANK_COLLAPSED, open = rankOpen || !collapsible;
            var rows = [];
            order.forEach(function (v, i) { if (open || keep[i]) rows.push({ v: v, i: i }); });
            var maxRows = Math.max(2, Math.floor((H * RANK_MAX_H - RANK_ROW * 2) / RANK_ROW));
            if (rows.length > maxRows) rows = rows.filter(function (r) { return keep[r.i]; }).concat(rows.filter(function (r) { return !keep[r.i]; })).slice(0, maxRows).sort(function (a, b) { return a.i - b.i; });
            var label = function (i) { return rule !== 'first' && i === n - 1 && n > 1 ? '꼴찌' : (i + 1) + '위'; };
            ctx.font = '700 11px Pretendard, sans-serif';
            var nameW = 0, labW = 0;
            rows.forEach(function (r) { nameW = Math.max(nameW, ctx.measureText(shortRank(r.v.p.name)).width); labW = Math.max(labW, ctx.measureText(label(r.i)).width); });
            var icon = RANK_ROW - 3, xLab = 8 + labW, xFace = xLab + 6 + icon / 2, xName = xFace + icon / 2 + 5;
            var pw = Math.max(xName + nameW + 8, 74), x0 = W - 8 - pw, y0 = 8 + RULE_BADGE_H + RULE_BADGE_GAP, foot = collapsible ? RANK_ROW : 0, ph = RANK_ROW * (rows.length + 1) + foot + 4;
            ctx.fillStyle = C.hud; ctx.beginPath(); ctx.roundRect(x0, y0, pw, ph, 8); ctx.fill();
            ctx.fillStyle = C.hudInk; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
            ctx.font = '800 11px Pretendard, sans-serif'; ctx.fillText('순위표', x0 + pw / 2, y0 + RANK_ROW / 2 + 2);
            ctx.font = '700 11px Pretendard, sans-serif';
            rows.forEach(function (r, k) {
                var v = r.v, ry = y0 + RANK_ROW * (k + 1) + 2, cy = ry + RANK_ROW / 2;
                if (k > 0 && r.i - rows[k - 1].i > 1) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x0 + 8, ry, pw - 16, 1); }   // 건너뛴 줄
                var isEnd = r.i === endIdx, mine = v.p.name === me;
                if (isEnd) { ctx.fillStyle = rule === 'first' ? 'rgba(255,209,102,0.35)' : 'rgba(230,57,70,0.42)'; ctx.beginPath(); ctx.roundRect(x0 + 3, ry + 1, pw - 6, RANK_ROW - 2, 5); ctx.fill(); }
                ctx.fillStyle = isEnd ? C.tagMe : C.hudInk; ctx.textAlign = 'right'; ctx.fillText(label(r.i), x0 + xLab, cy);
                faceIcon(v.p, x0 + xFace, cy, icon, mine);
                if (v.p === camFocus) camGlyph(x0 + xFace - icon / 2 + 1, ry + 4);
                ctx.textAlign = 'left'; ctx.fillStyle = mine ? C.tagMe : C.hudInk;
                ctx.fillText(shortRank(v.p.name), x0 + xName, cy);
                rankHits.push({ x: x0, y: ry, w: pw, h: RANK_ROW, p: v.p });
            });
            if (collapsible) {
                var fy0 = y0 + RANK_ROW * (rows.length + 1) + 2;
                ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'center'; ctx.font = '700 10px Pretendard, sans-serif';
                ctx.fillText(open ? '▲ 접기' : '▼ 전체 보기', x0 + pw / 2, fy0 + RANK_ROW / 2);
                rankToggle = { x: x0, y: fy0, w: pw, h: RANK_ROW + 2 };
            }
        }
        // 높이 막대(§12-8 → 사용자 2026-10-18 "미니맵은 그냥 1자로, 높이만" → 10-19 "너무 길다, 작게·디자인 톤") — 왼쪽 위 짧은 HUD 캡슐(순위표·알약과 같은 어두운 바탕 + 금 테두리):
        // 꼭대기 깃발 = 도착 · 세이브 다리 눈금 · 지금 화면 범위(금 띠) · 동물 얼굴(높이 비율). 누르거나 끌면 그 높이로
        function drawMinimap(view) {
            if (!map) { mmRect = null; return; }
            var y0 = MM_TOP, h = clamp(H * MM_H_RATIO, MM_H_MIN, MM_H_MAX), wh = map.worldH, cx = 16, hw = MM_W / 2;
            var my = function (y) { return y0 + h - clamp(y / wh, 0, 1) * h; };
            mmRect = { x: 0, y: y0 - 16, w: 34, h: h + 26, y0: y0, h0: h };
            ctx.save();
            ctx.fillStyle = C.hud; ctx.strokeStyle = C.mmEdge; ctx.lineWidth = 1.5;   // 캡슐
            ctx.beginPath(); ctx.roundRect(cx - hw, y0 - hw, MM_W, h + MM_W, hw); ctx.fill(); ctx.stroke();
            (map.bridges || []).forEach(function (b) { var on = tl && tl.bridgeT[b.idx] != null && simNow() >= tl.bridgeT[b.idx]; ctx.fillStyle = on ? C.mmBand : 'rgba(255,255,255,0.4)'; ctx.fillRect(cx - 3, my(b.y) - 1, 6, 2); });
            var half = H / 2 / s, vt = my(cam + half), vb = Math.max(vt + 4, my(cam - half));   // 지금 화면 범위 — 캡슐 안 금 띠
            ctx.fillStyle = C.mmBand; ctx.beginPath(); ctx.roundRect(cx - 2.5, vt, 5, vb - vt, 2.5); ctx.fill();
            ctx.strokeStyle = C.mmEdge; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, y0 - hw); ctx.lineTo(cx, y0 - hw - 12); ctx.stroke();   // 꼭대기 깃발 = 도착
            ctx.fillStyle = C.finish; ctx.beginPath(); ctx.moveTo(cx, y0 - hw - 12); ctx.lineTo(cx + 9, y0 - hw - 8.5); ctx.lineTo(cx, y0 - hw - 5); ctx.closePath(); ctx.fill();
            if (view) {
                var icon = 12;
                view.slice().sort(function (a, b) { return (a.p.name === me) - (b.p.name === me); }).forEach(function (v) {   // 내 동물은 맨 위에 크게
                    if (v.st === 'warp') return;
                    var m = v.p.name === me, yy = my(v.y + 20);
                    if (view.length <= 12) faceIcon(v.p, cx, yy, m ? icon + 3 : icon, m);
                    else { ctx.fillStyle = v.p.color; ctx.beginPath(); ctx.arc(cx, yy, m ? 4 : 3, 0, Math.PI * 2); ctx.fill(); }
                });
                // 지금 보는 동물이 1등과 몇 m 차이인지(사용자 2026-10-19) — 그 얼굴 오른쪽 작은 알약. 1등이면 '1등'. 높이 10px = 1m(왼쪽 고도 눈금과 같은 환산)
                var fv = camFocus && view.filter(function (q) { return q.p === camFocus; })[0];
                if (fv && fv.st !== 'warp') {
                    var top = Math.max.apply(null, view.map(function (q) { return q.y; })), gap = Math.round((top - fv.y) / 10);
                    var label = gap <= 0 ? '1등' : '-' + gap + 'm', ly = my(fv.y + 20);
                    ctx.font = '800 10px Pretendard, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                    var lw = ctx.measureText(label).width + 10, lx = cx + 11;
                    ctx.fillStyle = C.hud; ctx.strokeStyle = C.mmEdge; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.roundRect(lx, ly - 8, lw, 16, 8); ctx.fill(); ctx.stroke();
                    ctx.fillStyle = gap <= 0 ? C.mmBand : C.hudInk; ctx.fillText(label, lx + 5, ly + 0.5);
                }
            }
            ctx.restore();
        }
        function simNow() { return lastSim < 0 ? 0 : lastSim; }
        function minimapY(py) { return mmRect ? clamp((mmRect.y0 + mmRect.h0 - py) / mmRect.h0, 0, 1) * map.worldH : null; }
        function shortRank(nm) { var c = Array.from(String(nm || '')); return c.length > RANK_NAME_MAX ? c.slice(0, RANK_NAME_MAX).join('') + '…' : c.join(''); }
        function drawCountdown(left) {   // left = 출발까지 남은 ms. 첫 1초는 "준비", 그다음 3·2·1 — 풍선은 준비·3·2 동안 불어 '1' 전에 다 나온다(INFLATE_DONE_BEFORE_MS)
            var n = Math.ceil(left / 1000), label = n > R.inflate ? '준비' : String(n), k = left / 1000 - Math.floor(left / 1000), sc = 1 + 0.5 * k;
            ctx.save(); ctx.translate(W / 2, H * 0.4); ctx.scale(sc, sc); ctx.font = (n > R.inflate ? '900 40px' : '900 72px') + ' Pretendard, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 8; ctx.strokeStyle = C.countInk; ctx.strokeText(label, 0, 0); ctx.fillStyle = C.count; ctx.fillText(label, 0, 0); ctx.restore();
        }

        // ── 카메라 조작 — 끌면 그 자리 고정(3초 입력 없으면 자동으로), 동물·순위표 행을 탭하면 그 동물 따라가기, 미니맵을 누르거나 끌면 그 높이로. 휠은 페이지 스크롤(데구리와 같음). 왼쪽 아래 버튼으로 자동 복귀 ──
        function viewPeople() {
            if (mode === 'idle') return people.map(function (p) { return { p: p, x: p.x0, y: 0 }; });
            var sim = simAt(playing ? raceReal() : tl.durationMs);
            return people.map(function (p, i) { var q = posAt(i, sim); return { p: p, x: q.x, y: q.y }; });
        }
        function localPt(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
        function inMinimap(pt) { return mmRect && pt.x >= mmRect.x && pt.x <= mmRect.x + mmRect.w && pt.y >= mmRect.y && pt.y <= mmRect.y + mmRect.h; }
        function jumpTo(pt) { setCam('free'); lastInput = now(); cam = clamp(minimapY(pt.y), camMin(), camMax()); if (!playing || paused) redraw(); }   // 미니맵 → 그 높이로(수동 카메라 — 3초 뒤 자동)
        var pointers = {}, pinch = null;   // 두 손가락 벌리기·좁히기 = 확대·축소(데구리처럼)
        var pinchDist = function () { var ks = Object.keys(pointers); return Math.hypot(pointers[ks[0]].x - pointers[ks[1]].x, pointers[ks[0]].y - pointers[ks[1]].y); };
        canvas.addEventListener('pointerdown', function (e) {
            if (!map) return;
            var pt = localPt(e);
            pointers[e.pointerId] = pt;
            if (Object.keys(pointers).length === 2) { pinch = { d0: Math.max(1, pinchDist()), z0: zoom }; drag = null; return; }
            if (inMinimap(pt)) { drag = { minimap: true, id: e.pointerId, moved: true }; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } jumpTo(pt); return; }
            drag = { x: e.clientX, y: e.clientY, cam: cam, cx: camX, moved: false, id: e.pointerId };
        });
        canvas.addEventListener('pointermove', function (e) {
            if (pointers[e.pointerId]) pointers[e.pointerId] = localPt(e);
            if (pinch && Object.keys(pointers).length >= 2) { setZoom(pinch.z0 * pinchDist() / pinch.d0); lastInput = now(); return; }
            if (!drag) { if (e.pointerType === 'mouse') { var hp = localPt(e), ih = function (h) { return hp.x >= h.x && hp.x <= h.x + h.w && hp.y >= h.y && hp.y <= h.y + h.h; }; canvas.style.cursor = inMinimap(hp) || (mode === 'play' && (rankHits.some(ih) || (rankToggle && ih(rankToggle)))) ? 'pointer' : ''; } return; }
            if (drag.id !== e.pointerId) return;
            if (drag.minimap) { jumpTo(localPt(e)); return; }
            var dy = e.clientY - drag.y, dx = e.clientX - drag.x;
            if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
            if (!drag.moved) { drag.moved = true; try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } }
            if (camMode !== 'free') setCam('free');
            lastInput = now();
            cam = clamp(drag.cam + dy / s, camMin(), camMax());
            camX = drag.cx - dx / s; clampCamX();   // 확대했으면 옆으로도 끈다
            if (!playing || paused) redraw();
        });
        canvas.addEventListener('pointerup', function (e) {
            delete pointers[e.pointerId];
            if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; drag = null; return; }
            if (drag && drag.minimap) { lastInput = now(); drag = null; return; }
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
        canvas.addEventListener('pointercancel', function (e) { delete pointers[e.pointerId]; pinch = null; drag = null; });
        canvas.addEventListener('wheel', function (e) {   // Ctrl+휠 = 확대·축소(그냥 휠은 페이지 스크롤 — 데구리와 같음)
            if (!map || !e.ctrlKey) return;
            e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM));
        }, { passive: false });
        canvas.addEventListener('dblclick', function () { if (map) { setZoom(1); setCam('auto'); } });   // 두 번 누르면 배율 100% + 자동 카메라

        // 아이콘(선택 버튼·결과 카드) — 시트 row 0 의 frame 칸
        function drawCreatureIcon(cv, creature, frame, skin) {
            var c = cv.getContext('2d'), im = sheet(creature, skin || null);
            var sk = skin ? image('creatures/' + creature + '-' + skin + '.webp') : null;
            if (sk && !sk.complete) sk.addEventListener('load', function () { drawCreatureIcon(cv, creature, frame, skin); }, { once: true });   // 스킨 시트가 늦게 오면 다시 — 상점 카드는 한 번만 그린다
            c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = false;
            if (ok(im)) c.drawImage(im, (frame || 0) * SPRITE.size, 0, SPRITE.size, SPRITE.size, 0, 0, cv.width, cv.height);
            else if (!im.complete) im.addEventListener('load', function () { drawCreatureIcon(cv, creature, frame, skin); }, { once: true });
        }
        // 야식 아이콘(데구리 상점 카드·옷장, js/deguri-shop.js) — 세로로 긴 셀을 캔버스 높이에 맞춰 가운데(js/deguri-render.js drawBalloonIcon 과 같은 모양)
        function drawBalloonIcon(cv, sprite) {
            var c = cv.getContext('2d'), im = balloonSprite(sprite);
            c.clearRect(0, 0, cv.width, cv.height);
            if (!ok(im)) { if (!im.complete) im.addEventListener('load', function () { drawBalloonIcon(cv, sprite); }, { once: true }); return; }
            var h = cv.height, w = h * BAL_SPRITE.w / BAL_SPRITE.h;
            c.imageSmoothingEnabled = true;
            c.drawImage(im, 0, 0, BAL_SPRITE.w, BAL_SPRITE.h, (cv.width - w) / 2, 0, w, h);
        }

        resize();
        var api = {
            resize: resize, rehost: rehost, setTimeline: setTimeline, drawIdle: drawIdle, play: play, stop: stop, pause: pause, resume: resume, seek: seek, time: time,
            renderEnd: renderEnd, redraw: redraw,
            isPlaying: function () { return playing && !paused; }, isPaused: function () { return paused; },
            onFinale: function (fn) { onFinaleCb = fn; }, onEvent: function (fn) { onEventCb = fn; },
            hasCreatureSprite: function (c) { return ok(image('creatures/' + c + '.webp')); },
            drawCreatureIcon: drawCreatureIcon,
            drawBalloonIcon: drawBalloonIcon,
            camMode: function () { return camMode === 'auto' || camMode === 'free' ? camMode : 'follow'; },   // 테스트용
            zoom: function () { return zoom; }, setZoom: setZoom,   // 테스트용
            camY: function () { return cam; },   // 테스트용 — 화면 가운데의 세계 높이
            setFollowMe: function (on) { followMe = !!on; if (!playing || paused) redraw(); },   // 내 동물 따라가기 스위치(§12-10) — 자동 카메라가 내 동물을 본다
            redrawIfIdle: function () { if (!playing || paused) redraw(); },
            // 화면 밖 하이라이트 GIF(js/deguri-highlight.js, 둥둥라이더 연결은 js/balloon.js) — 장면 동물 고르기 · 재생 시각 t 를 dt(초)만큼 시계를 밀며 그리기
            frameBalls: function (ids) { frameIds = ids && ids.length ? ids.slice() : null; },
            render: function (t, dt) { manualNow = (manualNow || 0) + dt * 1000; drawAt(t, dt); }
        };
        if (!(opts && opts.offscreen)) instances.push(api);   // 화면 밖 캔버스는 판마다 새로 만든다 — 에셋 도착 다시 그리기 목록에 쌓지 않는다
        return api;
    }

    window.BalloonRender = { create: create, loadAssets: loadAssets, COUNTDOWN_MS: COUNTDOWN_MS };
})();
