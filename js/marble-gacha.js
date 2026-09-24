/*
 * marble-gacha.js — 데구리 구슬 뽑기 (docs/goal/marble-gacha.md, 사용자 2026-09-23)
 *
 * 전역 `MarbleGacha` { connect(socket), open(), close() }.
 *   - 추첨은 서버(marble:gacha:pull)만 한다. 응답이 먼저 오고, 그다음 연출을 튼다 → 스킵이 네트워크를 기다리지 않는다.
 *   - 연출은 전부 "시작 후 경과 ms(t)"의 순수 함수(drawAt)다. 스킵 = t 를 END 로 옮기는 것 하나.
 *     그래서 어느 순간에 눌러도 같은 최종 화면(휴지 기계 + 크랭크 restDeg + 램프 등급 + 열린 캡슐 5칸 + 빛살 + 상품)이 나온다.
 *   - 순서: 코인 넣기(T_COIN) → 손잡이·바람 섞기(등급별 TIER_FX.crank, 높을수록 길다) → 공 찜·빨려 듦 → 레일 구르기 → 떠오름 → 두근두근 → 열림.
 *     절대 시각은 전부 timeline(tier) 에서 읽는다.
 *   - 그림·좌표는 assets/marble/gacha/ + gacha-anchors.json 이 권위(의뢰서 docs/spritemake-request/2026-09-23-marble-gacha-machine.md).
 *   - Math.random() 미사용(흔들림·반짝임은 t 의 함수).
 */
(function () {
    'use strict';

    var BASE = '/assets/marble/gacha/';
    var ASSET_VER = '?v=12';   // anchors json·그림이 바뀌면 반드시 올린다(2026-09-24: 벽 윤곽 추가 후 안 올려서 옛 캐시로 뽑기가 멈춘 사고)
    var PRICE = 60, REFUND = 30;   // 표시용 — 서버 socket/marble.js GACHA_PRICE / GACHA_REFUND 와 같은 값
    var ODDS_TEXT = '레어 60% · 에픽 30% · 전설 10% · 이미 가진 게 나오면 ' + REFUND + '코인을 돌려받아요';
    var STAY_COIN = 10;   // 표시용 — 서버 STAY_COIN / STAY_COIN_MS(5분)와 같은 값. 방에 머문 시간 보상
    var TIER_LABEL = { rare: '레어', epic: '에픽', legend: '전설' };
    var LAMP_CELL = { off: 0, rare: 1, epic: 2, legend: 3 };
    var TIERS = ['rare', 'epic', 'legend'];

    // 무대(캔버스) 논리 크기(CSS px). 그림은 화면의 2배로 그려져 있다
    var STAGE_W = 300, STAGE_H = 420;
    var MACHINE_K = (STAGE_H - 12) / 704;   // 기계 704px → 무대 높이
    var REVEAL_K = 0.8;                     // 열린 캡슐·상품 배율
    var REVEAL_CX = STAGE_W / 2, REVEAL_CY = 250;   // 동물이 무대 가운데(사용자 2026-09-24) — 뚜껑은 왼쪽으로 조금 나가도 된다

    // 타임라인(ms) — 절대 시각은 timeline(tier) 가 만든다: 코인 넣기 → 손잡이(등급별 길이) → 구르기 → 떠오름 → 두근두근 → 열림
    // 0) 코인 넣기(사용자 2026-09-24): 무대 오른쪽 아래 밖에서 코인이 올라와 투입구(anchors machine.coinSlot)로 오른쪽에서 꺾여 들어간다
    var T_COIN = 900;                       // 코인 단계 전체 — 그 뒤 손잡이가 돈다
    var COIN_FLY1 = 620, COIN_IN1 = 800;   // 날아옴(0~FLY1) → 슬롯에 밀려 들어감(FLY1~IN1) → 쨍그랑 여운
    var COIN_FROM = { x: STAGE_W - 36, y: STAGE_H + 26 };   // 출발점 = 무대 오른쪽 아래 바깥(뽑기 버튼 쪽) — 위(잔고 칩)에서 날아오는 건 이상하다(사용자 2026-09-24 스케치)
    var COIN_SIZE = 36;                     // 아틀라스 coin 칸 크기(기계 좌표) — 보이는 지름 ≈ 칸의 0.8 = 29, 슬롯 높이 32 안에 든다
    // 1) 손잡이(섞기) 길이는 등급별 TIER_FX.crank — 레어 3120 = 옛 2400 × 1.3(사용자 2026-09-24: 섞는 시간 30% 길게), 높은 등급일수록 더 오래 굴린다
    var PICK_LEAD = 600, AIR_TAIL = 400;    // 손잡이가 멈추기 600ms 전에 공이 찜, 400ms 전부터 바람이 잦아든다
    var T_BLINK = 320;                      // 램프 깜빡임
    var T_ROLL = 1350;                      // 레일 구르기 — 1000 × 1.35(사용자 2026-09-24: 공이 나올 때 30~40% 느리게)
    var T_GAP = 150;
    var T_RISE = 500;                       // 가운데로 떠오르기(기계 어두워짐)
    var OPEN_MS = [160, 140, 140, 260, 220];   // 열기 0~4칸 (5칸 = 정지)
    var T_POP = 300;                        // 상품 튀어나오기
    // 결과 화면에서도 상품이 살아 있게(사용자 2026-09-23) — 동물은 선택 버튼과 같은 idle 루프(js/marble.js PICKER_ICON_FRAMES/MS), 풍선은 흔들림
    var ITEM_IDLE_FRAMES = [0, 1, 0, 1, 0, 1, 2, 3], ITEM_IDLE_MS = 230;
    // 뽑힌 공: 찜(빛 테두리) → 출구로 빨려 들며 같은 색 캡슐로 변신 → 곧바로 배출구에서 굴러 나온다(사용자 2026-09-24: 기계 안 공과 이어지게)
    // 공은 유리구 바닥의 황동 관(anchors machine.chute, 배출구 바로 위)으로 쏙 들어가고, 잠시 뒤 배출구에서 캡슐로 나온다
    //   (곡선으로 몸통 앞을 지나가게 했더니 앞에 떠 보여 이상하다는 피드백 — 관으로 대체)
    var PICK_DUR = 480, PICK_HILITE_MS = 350, PICK_TO_ROLL_MS = 220;
    // 열리기 전 두근두근(사용자 2026-09-24: 열릴 때 감흥이 없다) — 떠오른 공이 점점 세게 흔들리고 폴짝, 진동선·빛 맥박·화면 떨림.
    // 등급이 높을수록 길고 세다. 뚜껑이 튀는 순간(열기 4칸) 하얀 섬광 + 화면 쿵.
    // 등급별 연출(사용자 2026-09-24: 고등급일수록 화려하게, 레어는 수수하게) — 한 표에서 전부 읽는다
    //   crank 손잡이(섞기) ms · turns 손잡이 바퀴 수(한 바퀴 ≈ 0.75초) · shake 흔들기 ms · power 세기 · hops 폴짝 시점 · stall 멈칫(전설: 흔들다 잠깐 멈췄다 더 세게) · lines 진동선 · pulse 뒤 빛 맥박
    //   cam 화면 떨림 · flash 섬광 · flash2 두 번째 섬광 · glare 눈부심 · cross 십자 빛줄기 · burst 열릴 때 튀는 반짝이 수
    //   rays 결과 빛살 배율 · rays2 반대로 도는 두 번째 빛살 · sparkles 결과 화면 반짝이 수
    var TIER_FX = {
        rare:   { crank: 3120, turns: 4, shake: 600,  power: 0.8, hops: [0.55],                  stall: false, lines: false, pulse: false, cam: 0,   flash: 0,    flash2: 0,   glare: 0.45, cross: false, burst: 0,  rays: 0.8,  rays2: false, sparkles: 1 },
        epic:   { crank: 3700, turns: 5, shake: 1200, power: 1.3, hops: [0.3, 0.6, 0.85],        stall: false, lines: true,  pulse: true,  cam: 1,   flash: 0.6,  flash2: 0,   glare: 1,    cross: true,  burst: 10, rays: 1,    rays2: false, sparkles: 2 },
        legend: { crank: 4400, turns: 6, shake: 1800, power: 1.7, hops: [0.25, 0.68, 0.8, 0.92], stall: true,  lines: true,  pulse: true,  cam: 1.4, flash: 0.85, flash2: 0.5, glare: 1.35, cross: true,  burst: 24, rays: 1.15, rays2: true,  sparkles: 5 }
    };
    function fx(tier) { return TIER_FX[tier] || TIER_FX.rare; }
    var TIER_GLOW = { rare: '#8fd3ff', epic: '#c99bff', legend: '#ffd45a' };
    var T_FLASH = 220, T_KICK = 260, FLASH2_DELAY = 320, BURST_MS = 1100;
    var OPEN_SUM = OPEN_MS.reduce(function (a, b) { return a + b; }, 0);
    var OPEN_POP = OPEN_MS[0] + OPEN_MS[1] + OPEN_MS[2] + OPEN_MS[3];   // 열기 4칸(뚜껑 튐) 시작
    // 등급별 타임라인(절대 ms) — 손잡이·흔들기 길이가 등급별로 다르다. end 는 스킵 목표(최종 화면)
    function timeline(tier) {
        var F = fx(tier), crank0 = T_COIN, crank1 = crank0 + F.crank, pick = crank1 - PICK_LEAD;
        var roll0 = pick + PICK_DUR + PICK_TO_ROLL_MS, roll1 = roll0 + T_ROLL, rise0 = roll1 + T_GAP, rise1 = rise0 + T_RISE;
        var open0 = rise1 + F.shake, open5 = open0 + OPEN_SUM;
        return { crank0: crank0, crank1: crank1, pick: pick, roll0: roll0, roll1: roll1, rise0: rise0, rise1: rise1,
            shake0: rise1, open0: open0, pop: open0 + OPEN_POP, open5: open5, end: open5 + T_POP + 100 };
    }

    var _socket = null, _anchors = null, _catalog = null, _loading = null;
    var _img = {}, _itemImg = {};
    var _el = null, _ctx = null, _raf = 0;
    var _anim = null;      // { res, item, t0, done }
    var _busy = false, _balance = null;
    var _nextStayAt = 0, _stayTimer = 0, _tickTimer = 0, _pollTimer = 0;   // 다음 머문 시간 보상 시각(클라 시계) — 그때 잔고를 다시 받는다
    var WALLET_POLL_MS = 30000;   // 상점 구매 등 다른 경로로 바뀐 잔고를 알약에 맞추는 주기
    var _walletListened = null;   // wallet:updated 를 건 소켓(재연결마다 connect 가 다시 불려 중복 등록 방지)

    // ── 에셋 ──────────────────────────────────────────────
    function loadImage(key, src) {
        if (_img[key]) return _img[key];
        var im = new Image(); im.src = src; _img[key] = im; return im;
    }
    function ready(im) { return im && im.complete && im.naturalWidth > 0; }
    function loadAll() {
        if (_loading) return _loading;
        var files = { machine: 'machine/gacha-machine', globeEmpty: 'machine/gacha-globe-empty', globeBalls: 'machine/gacha-globe-balls', lamp: 'machine/gacha-machine-lamp',
            crank: 'machine/gacha-crank', railFront: 'machine/gacha-machine-rail-front', sparkle: 'fx/gacha-sparkle' };
        TIERS.forEach(function (t) {
            files['cap-' + t] = 'capsule/capsule-' + t; files['open-' + t] = 'capsule/capsule-' + t + '-open'; files['rays-' + t] = 'fx/gacha-rays-' + t;
            files['cup-' + t] = 'capsule/capsule-' + t + '-cup'; files['lid-' + t] = 'capsule/capsule-' + t + '-lid';
        });
        var waits = Object.keys(files).map(function (k) {
            var im = loadImage(k, BASE + files[k] + '.webp' + ASSET_VER);
            return new Promise(function (res) { if (ready(im)) res(); else { im.onload = res; im.onerror = res; } });
        });
        if (window.UIIcons && UIIcons.image) {   // 코인 그림 = 공용 아이콘 아틀라스(캔버스 draw 용 Image 는 CSS 와 별개로 받는다)
            var ai = UIIcons.image();
            waits.push(new Promise(function (res) { if (ready(ai)) res(); else { ai.addEventListener('load', res); ai.addEventListener('error', res); } }));
        }
        waits.push(fetch(BASE + 'gacha-anchors.json' + ASSET_VER).then(function (r) { return r.json(); }).then(function (j) { _anchors = j; }));
        waits.push(fetch('/config/marble/cosmetics.json').then(function (r) { return r.json(); }).then(function (j) { _catalog = j; }));
        _loading = Promise.all(waits);
        return _loading;
    }
    function catalogItem(id) {
        if (!_catalog) return null;
        var slots = Object.keys(_catalog);
        for (var i = 0; i < slots.length; i++) {
            var list = _catalog[slots[i]] || [];
            for (var j = 0; j < list.length; j++) if (list[j].id === id) return list[j];
        }
        return null;
    }
    // 상품 그림: 스킨 = 시트 idle 첫 칸(160×160, 발바닥 y=150) / 야식 = 풍선 한 장(96×128, 아래 끝)
    function itemImage(item) {
        if (!item) return null;
        var src = item.creature && item.skin ? '/assets/marble/creatures/' + item.creature + '-' + item.skin + '.webp'
            : item.sprite ? '/assets/marble/accessories/' + item.sprite + '.webp' : null;
        if (!src) return null;
        if (!_itemImg[src]) { var im = new Image(); im.src = src; _itemImg[src] = im; }
        return _itemImg[src];
    }

    // ── 그리기 ────────────────────────────────────────────
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function easeOut(u) { return 1 - (1 - u) * (1 - u); }
    function easeInOut(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
    function easeOutBack(u) { var c = 1.70158; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); }
    function machineOrigin() { return { x: (STAGE_W - 512 * MACHINE_K) / 2, y: STAGE_H - 704 * MACHINE_K - 6 }; }
    function toStage(p) { var o = machineOrigin(); return { x: o.x + p[0] * MACHINE_K, y: o.y + p[1] * MACHINE_K }; }

    // 유리구 안 공들 — 로또 추첨기처럼(사용자 2026-09-24): 손잡이를 돌리면 가운데 바닥에서 바람이 뿜어져 공들이 솟구쳐 튀고,
    // 바람이 잦아들 때 결과 등급 색 공(레어 파랑·에픽 보라·전설 금) 하나가 바닥 출구로 빨려 내려가 사라진다 → 곧 같은 색 캡슐이 배출구로 굴러 나온다.
    // 뽑는 순간 2D 물리(중력·공끼리 충돌·유리벽)를 끝까지 미리 계산해 프레임으로 저장 → 그리기는 t 로 프레임을 고를 뿐이라 스킵 = 마지막 프레임.
    // 벽 = anchors machine.globeBalls.boundary. 뽑힌 공은 다음 뽑기 시작 때 위에서 다시 떨어져 채워진다. Math.random 대신 시드 난수.
    var SIM_HZ = 120, SIM_FRAME_MS = 1000 / 60, SIM_TAIL_MS = 2000;   // 손잡이가 멈춘 뒤 2초 더 계산(공이 가라앉게)
    var BALL_R = 22, WALL_R = 27, GRAV = 1100;
    var AIR_RAMP_MS = 300, JET_W = 80, JET_ACC = 5200, TURB_ACC = 900;   // 바람은 손잡이 끝 AIR_TAIL 전부터 잦아든다
    var TIER_BALL = { rare: 2, epic: 3, legend: 5 };        // 등급 → 공 시트 칸(파랑·보라·금)
    var _globePile = null;   // [{x,y,c,rot,s}] 지금 쌓인 더미(첫 뽑기 전엔 anchors 더미). s = 0 이면 뽑혀 나간 공
    function currentPile() {
        if (!_globePile) _globePile = _anchors.machine.globeBalls.pile.map(function (b) { return { x: b.x, y: b.y, c: b.c, rot: 0, s: 1 }; });
        return _globePile;
    }
    function wallDist(bd, ang) {
        var n = bd.radii.length, f = (((ang / (2 * Math.PI)) % 1) + 1) % 1 * n, i = Math.floor(f), u = f - i;
        return bd.radii[i % n] * (1 - u) + bd.radii[(i + 1) % n] * u;
    }
    function simulateGlobe(start, seed, pickColor, crankMs) {   // crankMs = 이 등급의 손잡이 길이. 시각(ms)은 손잡이 시작 기준
        var airEnd = crankMs - AIR_TAIL, pickMs = crankMs - PICK_LEAD, simMs = crankMs + SIM_TAIL_MS;
        var bd = _anchors.machine.globeBalls.boundary, cx = bd.center[0], cy = bd.center[1], n = start.length;
        var ch = _anchors.machine.chute;   // 바닥 관 입구 — 공은 작아지며 입구 바로 위로 온다
        var ex = ch ? ch.hole[0] : cx, ey = ch ? ch.hole[1] - 2 : cy + wallDist(bd, Math.PI / 2) - 14;   // 입구 한가운데로 빨려 든다
        var x = [], y = [], vx = [], vy = [], rot = [], sc = [], i, j;
        for (i = 0; i < n; i++) {
            var b0 = start[i], back = b0.s === 0;   // 지난번에 뽑혀 나간 공은 위에서 다시 떨어진다
            x.push(back ? cx + (i % 3 - 1) * 30 : b0.x); y.push(back ? cy - 90 : b0.y); vx.push(0); vy.push(0); rot.push(b0.rot || 0); sc.push(1);
        }
        var s = (seed >>> 0) || 1;
        function rnd() { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }
        var dt = 1 / SIM_HZ, steps = Math.round(simMs / 1000 * SIM_HZ), per = SIM_HZ / 60;
        var nFrames = Math.floor(steps / per) + 1, frames = new Float32Array(nFrames * n * 4), fi = 0;
        var pick = -1, pickX = 0, pickY = 0;
        function record() { for (var k = 0; k < n; k++) { var o = (fi * n + k) * 4; frames[o] = x[k]; frames[o + 1] = y[k]; frames[o + 2] = rot[k]; frames[o + 3] = sc[k]; } fi++; }
        record();
        for (var st = 1; st <= steps; st++) {
            var ms = st * dt * 1000;
            var air = ms < airEnd ? clamp01(ms / AIR_RAMP_MS) : 0;
            if (air > 0 && ms > airEnd - 250) air *= (airEnd - ms) / 250;   // 잦아듦
            if (pick < 0 && ms >= pickMs) {   // 결과 색 공 중 출구에 가장 가까운 것
                var best = 1e9;
                for (i = 0; i < n; i++) { if (start[i].c !== pickColor) continue; var dd = Math.hypot(x[i] - ex, y[i] - ey); if (dd < best) { best = dd; pick = i; } }
                if (pick < 0) pick = 0;
                pickX = x[pick]; pickY = y[pick];
            }
            for (i = 0; i < n; i++) {
                if (i === pick) {   // 출구로 빨려 들어간다(물리에서 빠짐)
                    var pu = clamp01((ms - pickMs) / PICK_DUR), e = pu * pu;
                    x[i] = pickX + (ex - pickX) * e; y[i] = pickY + (ey - pickY) * e; rot[i] += 0.25;
                    sc[i] = pu < 1 ? 1 : 0;   // 크기·가라앉기는 drawPicked 가 그린다
                    continue;
                }
                vy[i] += GRAV * dt;
                if (air > 0) {
                    var jx = x[i] - cx, jd = Math.abs(jx);
                    if (jd < JET_W && y[i] > cy - 70) vy[i] -= JET_ACC * air * (1 - jd / JET_W) * dt;   // 가운데 바람 기둥
                    vx[i] += (rnd() - 0.5) * TURB_ACC * 2 * air * dt; vy[i] += (rnd() - 0.5) * TURB_ACC * air * dt;   // 난류
                }
                var damp = air > 0 ? 0.999 : 0.996;
                vx[i] *= damp; vy[i] *= damp;
                x[i] += vx[i] * dt; y[i] += vy[i] * dt;
                rot[i] += vx[i] * dt / WALL_R;
            }
            for (var it = 0; it < 3; it++) {
                for (i = 0; i < n; i++) {
                    if (i === pick) continue;
                    for (j = i + 1; j < n; j++) {
                        if (j === pick) continue;
                        var dx2 = x[j] - x[i], dy2 = y[j] - y[i], ed = Math.hypot(dx2, dy2) || 0.01, ov = 2 * BALL_R - ed;
                        if (ov <= 0) continue;
                        var ux = dx2 / ed, uy = dy2 / ed;
                        x[i] -= ux * ov / 2; y[i] -= uy * ov / 2; x[j] += ux * ov / 2; y[j] += uy * ov / 2;
                        var vn = (vx[j] - vx[i]) * ux + (vy[j] - vy[i]) * uy;
                        if (vn < 0) { var imp = -(1 + 0.4) * vn / 2; vx[i] -= imp * ux; vy[i] -= imp * uy; vx[j] += imp * ux; vy[j] += imp * uy; }
                    }
                }
                for (i = 0; i < n; i++) {   // 유리벽
                    if (i === pick) continue;
                    var wx = x[i] - cx, wy = y[i] - cy, wd = Math.hypot(wx, wy) || 1, lim = wallDist(bd, Math.atan2(wy, wx)) - WALL_R;
                    if (wd > lim) {
                        var nx = wx / wd, ny = wy / wd;
                        x[i] = cx + nx * lim; y[i] = cy + ny * lim;
                        var vr = vx[i] * nx + vy[i] * ny;
                        if (vr > 0) { vx[i] -= (1 + 0.5) * vr * nx; vy[i] -= (1 + 0.5) * vr * ny; }
                        vx[i] *= 0.99; vy[i] *= 0.99;
                    }
                }
            }
            if (st % per === 0) record();
        }
        var fin = [];
        for (i = 0; i < n; i++) fin.push({ x: x[i], y: y[i], c: start[i].c, rot: rot[i], s: i === pick ? 0 : 1 });
        return { frames: frames, n: n, nFrames: fi, final: fin, jet: [cx, ey], pick: pick, pickMs: pickMs, airEnd: airEnd };
    }
    // tc = 손잡이 시작 기준 연출 시각(코인 단계는 음수 → 첫 프레임) / 뽑기 중이 아니면 지금 더미
    function drawGlobeBalls(c, tc) {
        var g = _anchors.machine.globeBalls, sh = _img.globeBalls;
        if (!g || !ready(sh) || !ready(_img.globeEmpty)) return false;
        c.drawImage(_img.globeEmpty, 0, 0);
        var cell = g.cell, half = cell / 2, list = [], sim = _anim && _anim.globe, k, air = 0;
        if (sim) {
            var fi = Math.min(sim.nFrames - 1, Math.floor(Math.max(0, tc) / SIM_FRAME_MS)), base = fi * sim.n * 4;
            for (k = 0; k < sim.n; k++) list.push({ x: sim.frames[base + k * 4], y: sim.frames[base + k * 4 + 1], rot: sim.frames[base + k * 4 + 2], s: sim.frames[base + k * 4 + 3], c: sim.final[k].c, picked: k === sim.pick });
            air = windLevel(tc, sim.airEnd);
            if (air > 0) drawWindCone(c, sim.jet, air, tc);   // 공 뒤 빛기둥
        } else {
            list = currentPile().slice();
        }
        list.sort(function (p, q) { return (p.picked ? 1e6 : p.y) - (q.picked ? 1e6 : q.y); });   // 아래(앞) 공이 위에, 뽑힌 공은 맨 앞
        for (k = 0; k < list.length; k++) {
            var p = list[k], sc = p.s === undefined ? 1 : p.s;
            if (sc <= 0) continue;
            if (p.picked && tc >= sim.pickMs - PICK_HILITE_MS && tc < sim.pickMs + PICK_DUR) { drawPicked(c, p, sc, tc, cell); continue; }
            c.save(); c.translate(p.x, p.y); if (p.rot) c.rotate(p.rot); if (sc !== 1) c.scale(sc, sc);
            c.drawImage(sh, p.c * cell, 0, cell, cell, -half, -half, cell, cell); c.restore();
        }
        if (air > 0) drawWind(c, sim.jet, air, tc);   // 공 앞 바람(갈매기·줄기·시동 돌풍)
        return true;
    }
    // 바람(사용자 2026-09-24: 시작할 때 밑에서 바람이 부는 느낌이 나게) — 유리구 바닥 가운데 분출구(sim.jet)에서 위로.
    // 물리(공이 뜨는 것)보다 먼저 보이기 시작(120ms)하고, 처음 0.7초는 돌풍(진하고 넓게 + 분출구에서 퍼지는 고리 두 개), 그 뒤엔 잔잔히 이어지다
    // 손잡이 끝에 잦아든다. 갈매기·줄기는 공 앞에 'lighter' 로 그려 공 위를 스치는 공기처럼, 빛기둥은 공 뒤에. 전부 tc 의 함수(난수 없음)
    var WIND_H = 190, WIND_CHEVRONS = 6, WIND_STREAKS = 5, WIND_GUST_MS = 700, WIND_RAMP_MS = 120;
    function windLevel(tc, airEnd) {
        if (tc < 0 || tc >= airEnd) return 0;
        var v = clamp01(tc / WIND_RAMP_MS);
        return tc > airEnd - 250 ? v * (airEnd - tc) / 250 : v;
    }
    function windGust(tc) { return 1 + 0.8 * (1 - clamp01(tc / WIND_GUST_MS)); }
    function clipGlobe(c) {   // 유리 안쪽 윤곽(anchors boundary) — 바람이 유리 밖으로 안 새게
        var bd = _anchors.machine.globeBalls.boundary, n = bd.radii.length;
        c.beginPath();
        for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2, r = bd.radii[i] - 3; c[i ? 'lineTo' : 'moveTo'](bd.center[0] + Math.cos(a) * r, bd.center[1] + Math.sin(a) * r); }
        c.closePath(); c.clip();
    }
    function drawWindCone(c, jet, air, tc) {
        var jx = jet[0], jy = jet[1], H = WIND_H + 20, a = Math.min(1, 0.32 * air * windGust(tc));
        c.save(); clipGlobe(c); c.globalCompositeOperation = 'lighter';
        var grd = c.createLinearGradient(0, jy, 0, jy - H);
        grd.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = grd; c.beginPath(); c.moveTo(jx - 34, jy); c.lineTo(jx + 34, jy); c.lineTo(jx + 72, jy - H); c.lineTo(jx - 72, jy - H); c.closePath(); c.fill();
        c.restore();
    }
    function drawWind(c, jet, air, tc) {
        var jx = jet[0], jy = jet[1], gust = windGust(tc), k;
        c.save(); clipGlobe(c);
        c.globalCompositeOperation = 'lighter'; c.strokeStyle = '#ffffff'; c.fillStyle = '#ffffff'; c.lineCap = 'round'; c.lineJoin = 'round';
        c.lineWidth = 5;   // 솟는 갈매기 — 올라가며 넓어지고 옅어진다
        for (k = 0; k < WIND_CHEVRONS; k++) {
            var f = ((tc / 520) + k / WIND_CHEVRONS) % 1, y = jy - 6 - f * WIND_H, hw = 16 + 16 * f, x = jx + Math.sin(tc / 90 + k * 1.3) * 3;
            c.globalAlpha = Math.min(1, 0.8 * air * gust * Math.sin(f * Math.PI));
            c.beginPath(); c.moveTo(x - hw, y + 9); c.quadraticCurveTo(x - hw * 0.35, y + 3, x, y - 7); c.quadraticCurveTo(x + hw * 0.35, y + 3, x + hw, y + 9); c.stroke();
        }
        for (k = 0; k < WIND_STREAKS; k++) {   // 바람 줄기 — 짧은 흰 줄이 흔들리며 솟는다
            var ph = ((tc / 380) + k / WIND_STREAKS) % 1, sx = jx + (k - 2) * 14 + Math.sin(tc / 90 + k) * 4, len = 22 + 10 * (k % 2), sy = jy - ph * (WIND_H - 20);
            c.globalAlpha = Math.min(1, 0.7 * air * gust * Math.sin(ph * Math.PI));
            c.fillRect(Math.round(sx - 2), Math.round(sy - len), 4, len);
        }
        for (k = 0; k < 2; k++) {   // 시동 돌풍 — 분출구에서 퍼지는 고리 두 개(0.3초)
            var u = (tc - k * 90) / 300;
            if (u < 0 || u >= 1) continue;
            var rr = 10 + 70 * u;
            c.globalAlpha = 0.8 * (1 - u); c.lineWidth = 6 - 4 * u;
            c.beginPath(); c.ellipse(jx, jy - 4, rr, rr * 0.45, 0, 0, Math.PI * 2); c.stroke();
        }
        c.restore();
    }
    // 뽑힌 공 — 찜(등급 색 빛 테두리가 맥박) → 빨려 드는 동안 같은 색 캡슐로 바뀐다(배출구에서 나올 그 캡슐)
    function drawPicked(c, p, sc, t, cell) {
        var tier = _anim.res.tier, col = TIER_GLOW[tier] || TIER_GLOW.rare, half = cell / 2;
        var pickMs = _anim.globe.pickMs;
        var hu = clamp01((t - (pickMs - PICK_HILITE_MS)) / PICK_HILITE_MS), pu = clamp01((t - pickMs) / PICK_DUR);
        var ring = t < pickMs ? hu : (pu < 0.85 ? 1 : (1 - pu) / 0.15);   // 빨려 드는 내내 유지 — 뭐가 내려가는지 눈으로 따라가게(사용자 2026-09-24)
        if (ring > 0) {   // 빛 테두리(점점 뚜렷, 빨려 들면 사라짐)
            c.save(); c.globalAlpha = ring * (0.8 + 0.2 * Math.sin(t / 45));
            var rr = half * sc * ringScale(pu);
            c.strokeStyle = col; c.lineWidth = 8; c.beginPath(); c.arc(p.x, p.y, rr + 6, 0, Math.PI * 2); c.stroke();
            c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.55; c.lineWidth = 16; c.beginPath(); c.arc(p.x, p.y, rr + 12, 0, Math.PI * 2); c.stroke(); c.restore();
        }
        var morph = clamp01((pu - 0.15) / 0.35);   // 15~50% 구간에 공 → 캡슐
        var ch = _anchors.machine.chute;
        if (ch && pu > 0) drawSuction(c, ch.hole[0], ch.hole[1], t, pu);
        // 빨려 들어감(사용자 2026-09-24): 입구로 끌려가며 점점 빨리 작아지고(1→0), 막바지엔 입구 쪽으로 길쭉해지며 빙글 돈다
        var shrink = ringScale(pu), stretch = pu * pu;
        var ang = ch ? Math.atan2(ch.hole[1] - p.y, ch.hole[0] - p.x) : Math.PI / 2;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(ang); c.scale(1 + 0.45 * stretch, 1 - 0.3 * stretch); c.rotate(-ang);   // 입구 방향으로 늘어남
        c.rotate((p.rot || 0) + pu * pu * 7);
        c.scale(sc * shrink, sc * shrink);
        if (morph < 1) { c.globalAlpha = 1 - morph; c.drawImage(_img.globeBalls, p.c * cell, 0, cell, cell, -half, -half, cell, cell); }
        var cap = _img['cap-' + tier];
        if (morph > 0 && ready(cap)) {
            var cc = _anchors.capsule.center, k = cell / _anchors.capsule.diameter;
            c.globalAlpha = morph; c.scale(k, k); c.drawImage(cap, -cc[0], -cc[1]);
        }
        c.restore();
    }
    // 빨려 드는 크기 — 입구에 닿을 때까지 절반 가까이 유지(작은 점이 되어 다른 공 사이에 묻히지 않게), 마지막 15% 에 사라짐
    function ringScale(pu) { return pu < 0.85 ? 1 - 0.5 * Math.pow(pu / 0.85, 2) : 0.5 * (1 - (pu - 0.85) / 0.15); }
    // 흡입선 — 입구 둘레에서 짧은 흰 선들이 안쪽으로 모여든다(빨아들이는 느낌)
    var SUCTION_LINES = 7;
    function drawSuction(c, hx, hy, t, pu) {
        var fade = pu < 0.8 ? 1 : (1 - pu) / 0.2;
        c.save(); c.strokeStyle = '#ffffff'; c.lineWidth = 5; c.lineCap = 'round';
        for (var k = 0; k < SUCTION_LINES; k++) {
            var a = Math.PI + (k / (SUCTION_LINES - 1)) * Math.PI;   // 입구 위쪽 반원(유리 안)
            var f = ((t / 160) + k * 0.37) % 1, r = 14 + 62 * (1 - f);
            c.globalAlpha = 0.95 * fade * Math.sin(f * Math.PI);
            c.beginPath(); c.moveTo(hx + Math.cos(a) * r, hy + Math.sin(a) * r * 0.8); c.lineTo(hx + Math.cos(a) * (r + 20), hy + Math.sin(a) * (r + 20) * 0.8); c.stroke();
        }
        c.restore();
    }
    // 기계 한 장: 휴지 + 유리구 공(tt: 손잡이 시작 기준 연출 시각 — 뽑기 중이 아니면 쌓인 더미) + 램프 칸 + 크랭크(각도) — shakeX 는 흔들림
    function drawMachine(c, tt, lamp, crankDeg, shakeX) {
        var a = _anchors.machine, o = machineOrigin(), K = MACHINE_K;
        c.save(); c.translate(o.x + shakeX, o.y); c.scale(K, K);
        if (ready(_img.machine)) c.drawImage(_img.machine, 0, 0);
        drawGlobeBalls(c, tt);
        var lb = a.lamp;
        if (ready(_img.lamp)) c.drawImage(_img.lamp, LAMP_CELL[lamp] * lb.w, 0, lb.w, lb.h, lb.x, lb.y, lb.w, lb.h);
        if (ready(_img.crank)) {
            var cp = a.crankPivot, cs = _anchors.crank.size, pv = _anchors.crank.pivot;
            c.save(); c.translate(cp[0], cp[1]); c.rotate(crankDeg * Math.PI / 180);
            c.drawImage(_img.crank, -pv[0], -pv[1], cs, cs); c.restore();
        }
        c.restore();
    }
    // 닫힌 캡슐(192 칸, 중심 capsule.center) — 무대 좌표 (x,y) 중심, 배율 k, 회전 rad
    function drawClosed(c, tier, x, y, k, rad) {
        var im = _img['cap-' + tier]; if (!ready(im)) return;
        var cc = _anchors.capsule.center;
        c.save(); c.translate(x, y); c.rotate(rad); c.scale(k, k); c.drawImage(im, -cc[0], -cc[1]); c.restore();
    }
    function drawOpenFrame(c, tier, frame) {
        var im = _img['open-' + tier]; if (!ready(im)) return;
        var op = _anchors.capsule.open, cc = op.center;
        c.drawImage(im, frame * op.cellW, 0, op.cellW, op.cellH,
            REVEAL_CX - cc[0] * REVEAL_K, REVEAL_CY - cc[1] * REVEAL_K, op.cellW * REVEAL_K, op.cellH * REVEAL_K);
    }
    // 열린 캡슐(열기 5칸 대신) — 컵 + 컵 왼쪽 가장자리에 경첩으로 붙은 뚜껑(사용자 2026-09-24: 왼쪽으로 열려 대롱대롱).
    // 튀어 오른 뚜껑이 경첩을 축으로 왼쪽으로 넘어가며 크게 흔들리다 잦아들고, 결과 화면에서도 살짝 계속 흔들린다(t 의 함수).
    var LID_SWING_MS = 450, LID_SWING_PERIOD = 800, LID_START_DEG = -20, LID_SWAY_DEG = 10, LID_SWAY_MS = 460;   // 180° 로 활짝 펼쳐진 뒤에도 계속 흔들흔들(사용자 2026-09-24)
    function drawHingedOpen(c, tier, t, TL) {
        var h = _anchors.capsule.hinge, cup = _img['cup-' + tier], lid = _img['lid-' + tier];
        if (!h || !ready(cup) || !ready(lid)) return false;
        var K = REVEAL_K, cc = _anchors.capsule.center, ox = REVEAL_CX - cc[0] * K, oy = REVEAL_CY - cc[1] * K;
        var dt = Math.max(0, t - TL.open5), rest = h.restDeg, start = LID_START_DEG;
        var deg = rest + (start - rest) * Math.exp(-dt / LID_SWING_MS) * Math.cos(2 * Math.PI * dt / LID_SWING_PERIOD) + LID_SWAY_DEG * Math.sin(dt / LID_SWAY_MS) * clamp01(dt / 600);
        c.drawImage(cup, ox, oy, h.cell * K, h.cell * K);
        c.save(); c.translate(ox + h.pivot[0] * K, oy + h.pivot[1] * K); c.rotate(deg * Math.PI / 180); c.scale(K, K);   // 뚜껑은 컵 앞(사용자 2026-09-24)
        c.drawImage(lid, -h.pivot[0], -h.pivot[1]); c.restore();
        return true;
    }
    function itemAnchorStage(tier) {
        var op = _anchors.capsule.open, ia = (op.itemAnchor && op.itemAnchor[tier]) || op.itemAnchor.rare, cc = op.center;
        return { x: REVEAL_CX + (ia[0] - cc[0]) * REVEAL_K, y: REVEAL_CY + (ia[1] - cc[1]) * REVEAL_K };
    }
    // t = 연출 시각 — 결과 화면에서 계속 움직이는 idle 은 전부 t 의 함수
    // 그림 칸 안에서 실제로 그려진 부분의 가로 가운데(첫 칸 알파 기준) — 동물마다 칸 안 위치가 달라 칸 가운데로 맞추면 한쪽으로 쏠린다
    var _itemCx = {};
    function itemVisualCx(im, cw, ch) {
        if (_itemCx[im.src] !== undefined) return _itemCx[im.src];
        var v = cw / 2;
        try {
            var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
            var x = cv.getContext('2d'); x.drawImage(im, 0, 0, cw, ch, 0, 0, cw, ch);
            var d = x.getImageData(0, 0, cw, ch).data, lo = cw, hi = -1;
            for (var yy = 0; yy < ch; yy++) for (var xx = 0; xx < cw; xx++) if (d[(yy * cw + xx) * 4 + 3] > 8) { if (xx < lo) lo = xx; if (xx > hi) hi = xx; }
            if (hi >= lo) v = (lo + hi + 1) / 2;
        } catch (e) {}
        _itemCx[im.src] = v;
        return v;
    }
    function drawItem(c, item, tier, s, t) {
        var im = itemImage(item); if (!ready(im) || s <= 0) return;
        var a = itemAnchorStage(tier), k = REVEAL_K * s;
        var cw = item.creature ? 160 : 96, chh = item.creature ? 160 : 128;
        var shift = (cw / 2 - itemVisualCx(im, cw, chh)) * REVEAL_K;   // 보이는 몸통이 무대 가운데에 오게
        c.save(); c.translate(a.x + shift, a.y);
        if (item.creature) {
            var col = ITEM_IDLE_FRAMES[Math.floor(t / ITEM_IDLE_MS) % ITEM_IDLE_FRAMES.length];
            c.translate(0, -Math.abs(Math.sin(t / 460)) * 3);   // 컵 안에서 살짝 들썩
            c.scale(k, k);
            c.drawImage(im, col * 160, 0, 160, 160, -80, -150, 160, 160);
        } else {
            c.translate(0, Math.sin(t / 520) * 2.5);            // 줄 끝(아래) 기준으로 흔들리며 떠 있음
            c.rotate(Math.sin(t / 680) * 0.1);
            c.scale(k, k);
            c.drawImage(im, 0, 0, 96, 128, -48, -128, 96, 128);
        }
        c.restore();
    }

    // t(ms) → 한 장. 연출의 유일한 그리기 함수(스킵은 t 만 바꾼다). 화면 떨림·섬광은 여기서 씌운다
    function drawAt(t) {
        var c = _ctx; if (!c || !_anchors) return;
        c.clearRect(0, 0, STAGE_W, STAGE_H);
        var res = _anim && _anim.res, tier = res ? res.tier : 'rare';
        var TL = timeline(tier), F = fx(tier), pw = F.power, cam = 0;
        if (res && F.cam && t >= TL.shake0 && t < TL.open0) { var su0 = (t - TL.shake0) / (TL.open0 - TL.shake0); if (su0 > 0.6) cam = 1.6 * pw * F.cam * (su0 - 0.6) / 0.4; }
        if (res && F.cam && t >= TL.pop && t < TL.pop + T_KICK) cam = 5 * pw * F.cam * (1 - (t - TL.pop) / T_KICK);
        c.save();
        if (cam) c.translate(Math.sin(t / 17) * cam, Math.cos(t / 13) * cam * 0.7);
        drawScene(c, t, res, tier, TL, pw);
        c.restore();
        if (res) { drawBurst(c, tier, t, TL); drawGlare(c, tier, t, TL); }
        var fl = 0;   // 뚜껑이 튀는 순간 하얀 섬광(전설은 한 번 더)
        if (res && F.flash && t >= TL.pop && t < TL.pop + T_FLASH) fl = F.flash * (1 - (t - TL.pop) / T_FLASH);
        if (res && F.flash2 && t >= TL.pop + FLASH2_DELAY && t < TL.pop + FLASH2_DELAY + T_FLASH) fl = Math.max(fl, F.flash2 * (1 - (t - TL.pop - FLASH2_DELAY) / T_FLASH));
        if (fl > 0) { c.fillStyle = 'rgba(255, 255, 255, ' + fl.toFixed(3) + ')'; c.fillRect(0, 0, STAGE_W, STAGE_H); }
    }
    // 열릴 때 눈부심(사용자 2026-09-24) — 뚜껑이 튀기 직전부터 캡슐에서 빛이 차오르고, 튀는 순간 하얀 광원 + 등급 색 번짐 + 십자 빛줄기, 이후 서서히 가라앉음.
    // 'lighter' 합성(더하기)이라 밑그림이 밝게 타 보인다. 스킵(END)에서는 이미 다 사라진 상태.
    var GLARE_PRE = 300, GLARE_POST = 900;
    function drawGlare(c, tier, t, TL) {
        if (t < TL.pop - GLARE_PRE || t > TL.pop + GLARE_POST) return;
        var I = t < TL.pop ? Math.pow((t - (TL.pop - GLARE_PRE)) / GLARE_PRE, 2) * 0.6 : 1 - Math.pow((t - TL.pop) / GLARE_POST, 0.6) * 1;
        var F = fx(tier);
        I = clamp01(I) * F.glare;
        if (I <= 0) return;
        var col = TIER_GLOW[tier] || TIER_GLOW.rare, gx = REVEAL_CX, gy = REVEAL_CY - 8;
        c.save(); c.globalCompositeOperation = 'lighter';
        var R = 50 + 150 * Math.min(1, I);
        var grd = c.createRadialGradient(gx, gy, 0, gx, gy, R);
        grd.addColorStop(0, 'rgba(255,255,255,' + Math.min(1, 0.95 * I).toFixed(3) + ')');
        grd.addColorStop(0.25, hexA(col, Math.min(1, 0.7 * I)));
        grd.addColorStop(1, hexA(col, 0));
        c.fillStyle = grd; c.fillRect(gx - R, gy - R, R * 2, R * 2);
        if (!F.cross) { c.restore(); return; }   // 레어는 은은한 빛만
        // 십자 빛줄기(렌즈 플레어) — 가로 길게, 세로 짧게, 대각은 더 가늘게
        var L = 90 + 180 * Math.min(1, I), rot = t / 1400;
        c.translate(gx, gy); c.rotate(rot);
        [[L, 5], [L * 0.6, 4]].forEach(function (d, k) {
            c.save(); if (k === 1) c.rotate(Math.PI / 2);
            var lg = c.createLinearGradient(-d[0], 0, d[0], 0);
            lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,' + Math.min(1, 0.9 * I).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = lg; c.fillRect(-d[0], -d[1] / 2, d[0] * 2, d[1]); c.restore();
        });
        c.rotate(Math.PI / 4);
        [0, 1].forEach(function (k) {
            c.save(); c.rotate(k * Math.PI / 2);
            var dl = L * 0.35, lg = c.createLinearGradient(-dl, 0, dl, 0);
            lg.addColorStop(0, hexA(col, 0)); lg.addColorStop(0.5, hexA(col, Math.min(1, 0.7 * I))); lg.addColorStop(1, hexA(col, 0));
            c.fillStyle = lg; c.fillRect(-dl, -1.5, dl * 2, 3); c.restore();
        });
        c.restore();
    }
    // 열릴 때 반짝이가 사방으로 튄다(에픽 10·전설 24) — 각도·속도는 칸 번호에서 결정(난수 없음), 중력으로 떨어지며 사라진다
    function drawBurst(c, tier, t, TL) {
        var F = fx(tier), spk = _img.sparkle, dtm = t - TL.pop;
        if (!F.burst || !ready(spk) || dtm < 0 || dtm > BURST_MS) return;
        var sec = dtm / 1000, sc = _anchors.sparkle.cell, cx = REVEAL_CX, cy = REVEAL_CY - 10;
        c.save(); c.globalAlpha = clamp01(1 - dtm / BURST_MS);
        for (var k = 0; k < F.burst; k++) {
            var a = k * 2.39996, v = 150 + (k * 53) % 160, sz = sc * (0.28 + (k % 3) * 0.1);
            var x = cx + Math.cos(a) * v * sec, y = cy + Math.sin(a) * v * sec + 0.5 * 420 * sec * sec;
            c.drawImage(spk, ((Math.floor(dtm / 90) + k) % 4) * sc, 0, sc, sc, x - sz / 2, y - sz / 2, sz, sz);
        }
        c.restore();
    }
    // 결과 화면 반짝이 자리(아이템 발 기준) — 등급별로 앞에서부터 N개
    var SPARKLE_SPOTS = [[34, -150, 0.55], [-96, -92, 0.45], [58, -60, 0.4], [-70, -150, 0.35], [-10, -178, 0.42]];
    function hexA(hex, a) {
        var n = parseInt(hex.slice(1), 16);
        return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a.toFixed(3) + ')';
    }
    function drawScene(c, t, res, tier, TL, pw) {
        if (!res) { drawMachine(c, -1, 'off', _anchors.crank.restDeg || 0, 0); return; }
        var rest = _anchors.crank.restDeg || 0, a = _anchors.machine, F = fx(tier);
        // 0) 코인 넣기 → 1) 손잡이(등급별 길이) + 바람 섞기 + 흔들기. tc = 손잡이 시작 기준 시각
        var tc = t - TL.crank0, cu = clamp01(tc / F.crank);
        var crank = rest + 360 * F.turns * easeInOut(cu);
        var shake = 0;
        if (tc < 0) { var ck = t - COIN_FLY1; if (ck >= 0) shake = Math.sin(ck / 16) * 2.2 * (1 - clamp01(ck / 240)); }   // 코인이 들어가는 쨍그랑
        else if (tc < F.crank) shake = Math.sin(tc / 28) * 2.5 * (cu < 0.85 ? 1 : (1 - cu) / 0.15);
        // 2) 램프
        var lampOn = TL.pick - PICK_HILITE_MS;   // 공이 찜 되는 순간 등급 색으로 켜진다(처음엔 깜빡)
        var lamp = t < lampOn ? 'off' : (t < lampOn + T_BLINK && Math.floor((t - lampOn) / 80) % 2 === 1) ? 'off' : tier;
        drawMachine(c, tc, lamp, tc < F.crank ? crank : rest, shake);
        if (t < T_COIN + 300) drawCoin(c, t);   // 코인 + 투입구 반짝(손잡이 시작 직후까지 여운)
        // 3) 레일 구르기(기계 배율) — 배출구 구멍(42×34) 안에서 작게 시작해 앞으로 나오며 커진다. 캡슐은 늘 기계 앞에 그린다
        //    (2라운드 lip 레이어는 배출구 위 몸통을 잘못 오린 덩어리라 캡슐을 가려 잘랐다 — 삭제, anchors machine.lip 참고)
        var pf = a.path.from, pt = a.path.to, rMach = _anchors.capsule.diameter * _anchors.capsule.machineScale / 2;
        var capK = _anchors.capsule.machineScale * MACHINE_K;
        if (t >= TL.roll0 && t < TL.rise0) {
            var ru = easeOut(clamp01((t - TL.roll0) / T_ROLL));
            var mx = pf[0] + (pt[0] - pf[0]) * ru, my = pf[1] + (pt[1] - pf[1]) * ru;
            var dist = Math.hypot(mx - pf[0], my - pf[1]);
            var sp = toStage([mx, my]);
            var emerge = 0.7 + 0.3 * easeOut(clamp01((t - TL.roll0) / (T_ROLL * 0.18)));   // 배출구 구멍 안에서 작게 나와 커진다
            drawClosed(c, tier, sp.x, sp.y, capK * emerge, dist / rMach);
            // 레일 앞 나무판을 공 위에 덮는다 — 공이 두 나무 사이 홈에 앉아 아랫부분이 가려진다(anchors machine.railFront)
            if (ready(_img.railFront)) { var o = machineOrigin(); c.drawImage(_img.railFront, o.x, o.y, 512 * MACHINE_K, 704 * MACHINE_K); }
        }
        if (t < TL.rise0) return;
        // 4) 가운데로 떠오르며 커짐 + 기계 어둡게
        var su = easeInOut(clamp01((t - TL.rise0) / T_RISE));
        c.fillStyle = 'rgba(12, 18, 30, ' + (0.62 * su).toFixed(3) + ')';
        c.fillRect(-12, -12, STAGE_W + 24, STAGE_H + 24);   // 화면 떨림으로 밀려도 가장자리가 안 비게
        var endDist = Math.hypot(pt[0] - pf[0], pt[1] - pf[1]);
        var endRot = endDist / rMach;
        if (t < TL.rise1) {
            var sp0 = toStage(pt);
            drawClosed(c, tier, sp0.x + (REVEAL_CX - sp0.x) * su, sp0.y + (REVEAL_CY - sp0.y) * su,
                capK + (REVEAL_K - capK) * su, endRot + (Math.ceil(endRot / (2 * Math.PI)) * 2 * Math.PI - endRot) * su);   // 같은 방향으로 마저 굴러 똑바로 선다(거꾸로 감기지 않게)
            return;
        }
        // 5) 두근두근 — 점점 세게 흔들리고 폴짝, 진동선·빛 맥박
        if (t < TL.open0) { drawShake(c, tier, t - TL.shake0, TL.open0 - TL.shake0, pw); return; }
        // 6) 열기 0~4칸 → 5칸 정지, 뒤로 빛살(천천히 회전)
        var ot = t - TL.open0, frame = 5;
        for (var i = 0, acc = 0; i < OPEN_MS.length; i++) { acc += OPEN_MS[i]; if (ot < acc) { frame = i; break; } }
        if (frame === 5) {
            var pu = clamp01((t - TL.open5) / T_POP);
            var rays = _img['rays-' + tier], F = fx(tier);
            if (ready(rays)) {
                var ia = itemAnchorStage(tier), rc = _anchors.rays.center, rk = REVEAL_K * (0.4 + 0.6 * easeOut(pu)) * F.rays;
                if (F.rays2) {   // 전설: 반대로 도는 두 번째 빛살(작게, 반투명)
                    c.save(); c.globalAlpha = 0.6; c.translate(ia.x, ia.y - 60 * REVEAL_K); c.rotate(-t / 1900 + 0.26); c.scale(rk * 0.8, rk * 0.8);
                    c.drawImage(rays, -rc[0], -rc[1]); c.restore();
                }
                c.save(); c.translate(ia.x, ia.y - 60 * REVEAL_K); c.rotate(t / (F.rays2 ? 2000 : 2600)); c.scale(rk, rk);
                c.drawImage(rays, -rc[0], -rc[1]); c.restore();
            }
            if (!drawHingedOpen(c, tier, t, TL)) drawOpenFrame(c, tier, 5);
            drawItem(c, _anim.item, tier, easeOutBack(pu), t);
            var spk = _img.sparkle;
            if (ready(spk) && pu > 0.5) {
                var sc = _anchors.sparkle.cell, ia2 = itemAnchorStage(tier);
                for (var q = 0; q < Math.min(F.sparkles, SPARKLE_SPOTS.length); q++) {
                    var sp2 = SPARKLE_SPOTS[q], fq = (Math.floor(t / 130) + q * 2) % 4;
                    c.drawImage(spk, fq * sc, 0, sc, sc, ia2.x + sp2[0], ia2.y + sp2[1], sc * sp2[2], sc * sp2[2]);
                }
            }
        } else {
            drawOpenFrame(c, tier, frame);
        }
    }

    // ── 코인 넣기(사용자 2026-09-24) ─────────────────────
    // 무대 오른쪽 아래 밖(COIN_FROM)에서 올라와 오른쪽으로 부푼 곡선을 타고 투입구 높이에서 왼쪽으로 꺾여 들어온다(사용자 스케치: 파란 선).
    // 날아오는 동안 빙글 뒤집히다 모로(세로) 서서 슬롯에 맞춰지고, 슬롯 안으로 밀려 들어가며 짧아지고 어두워진다
    // → 쨍그랑(기계 흔들림은 drawScene) + 투입구 반짝. 코인 그림 = 공용 아틀라스 coin(UIIcons.draw)
    function coinSlotStage() { var s = _anchors.machine.coinSlot; return toStage(s ? s.center : [297, 467]); }   // 옛 캐시 json 이면 실측값
    function drawCoin(c, t) {
        var to = coinSlotStage(), from = COIN_FROM;
        if (t < COIN_IN1) {
            var size = COIN_SIZE * MACHINE_K, x = to.x, y = to.y, sx = 0.14, sy = 1, alpha = 1, big = 1;
            if (t < COIN_FLY1) {
                var u = clamp01(t / COIN_FLY1), e = easeInOut(u);
                var mx = STAGE_W + 6, my = to.y + 16;   // 제어점 = 무대 오른쪽 가장자리, 슬롯보다 조금 아래 → 위로 솟았다가 오른쪽에서 거의 수평으로 들어온다
                x = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * mx + e * e * to.x;
                y = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * my + e * e * to.y;
                big = 2.2 - 1.2 * e;                                             // 날 땐 크게(가까이), 슬롯에 닿으며 제 크기로
                sx = Math.max(0.14, Math.abs(Math.cos(u * Math.PI * 1.5)));      // 한 바퀴 반 뒤집혀 끝에 모로 선다
            } else {
                var v = clamp01((t - COIN_FLY1) / (COIN_IN1 - COIN_FLY1));       // 슬롯 안으로: 짧아지고 어두워진다
                sy = 1 - 0.95 * v; alpha = 1 - 0.8 * v; x = to.x + 2 * v;
            }
            c.save(); c.globalAlpha = alpha; c.translate(x, y); c.scale(sx * big, sy * big);
            if (!(window.UIIcons && UIIcons.draw(c, 'coin', 0, 0, size))) { c.fillStyle = '#f4c542'; c.beginPath(); c.arc(0, 0, size * 0.4, 0, Math.PI * 2); c.fill(); }   // 아틀라스가 아직이면 노란 동그라미
            c.restore();
        }
        var spk = _img.sparkle, gt = t - (COIN_IN1 - 40);   // 투입구 반짝 — 들어간 직후
        if (ready(spk) && gt >= 0 && gt < 320) {
            var sc = _anchors.sparkle.cell, sz = sc * 0.42 * (0.6 + 0.4 * Math.sin(Math.min(1, gt / 320) * Math.PI));
            c.save(); c.globalAlpha = 1 - gt / 320;
            c.drawImage(spk, (Math.floor(gt / 80) % 4) * sc, 0, sc, sc, to.x - sz / 2 + 2, to.y - sz / 2 - 6, sz, sz); c.restore();
        }
    }

    // 두근두근 한 장 — st = 흔들기 시작 후 ms, dur = 흔들기 길이. 캡슐은 바닥을 축으로 기우뚱(빨라지고 세짐), 가끔 폴짝
    function drawShake(c, tier, st, dur, pw) {
        var u = clamp01(st / dur), s = st / 1000;
        var K = REVEAL_K, r = (_anchors.capsule.diameter / 2) * K;
        var glowCol = TIER_GLOW[tier] || TIER_GLOW.rare, F = fx(tier);
        // 전설: 흔들다 잠깐 멈칫(45~58%) → 더 세게
        var amp = 1;
        if (F.stall) amp = u < 0.45 ? 1 : u < 0.58 ? 0.08 : 1.35;
        // 뒤에서 등급 빛이 맥박처럼(점점 밝게) — 레어는 없음
        var rays = _img['rays-' + tier];
        if (F.pulse && ready(rays)) {
            var rc = _anchors.rays.center, rk = K * (0.45 + 0.3 * u) * (1 + 0.06 * Math.sin(st / 70));
            c.save(); c.globalAlpha = (0.12 + 0.4 * u) * (0.7 + 0.3 * Math.sin(st / 55));
            c.translate(REVEAL_CX, REVEAL_CY); c.rotate(st / 900); c.scale(rk, rk); c.drawImage(rays, -rc[0], -rc[1]); c.restore();
        }
        // 기우뚱 — 주파수가 점점 올라간다(위상 = 적분), 세기도 점점
        var phi = 2 * Math.PI * (4 * s + 5 * s * s);
        var ang = Math.sin(phi) * (0.06 + 0.22 * u) * pw * amp;
        var jx = Math.sin(phi * 1.7) * (1 + 3 * u) * pw * amp;
        var hop = 0;
        for (var i = 0; i < F.hops.length; i++) { var l = (u - F.hops[i]) / 0.08; if (l >= 0 && l < 1) hop = Math.sin(l * Math.PI) * 9 * pw; }
        var bx = REVEAL_CX + jx, by = REVEAL_CY + r - hop;   // 바닥 접점(축)
        drawClosed(c, tier, bx + Math.sin(ang) * r, by - Math.cos(ang) * r, K, ang);
        if (!F.lines) return;   // 레어는 여기까지(수수하게)
        // 진동선 — 양옆 짧은 선이 번갈아 파르르(등급 색)
        var on = Math.floor(st / 60) % 2, len = (8 + 8 * u) * (amp > 1 ? 1.4 : amp < 0.5 ? 0 : 1), gap = r + 8 + 2 * Math.sin(st / 40);
        c.fillStyle = glowCol;
        for (var k = 0; k < 3; k++) {
            if ((k + on) % 2) continue;
            var yy = REVEAL_CY - 18 + k * 18;
            c.fillRect(Math.round(bx - gap - len), Math.round(yy), Math.round(len), 3);
            c.fillRect(Math.round(bx + gap), Math.round(yy + 9), Math.round(len), 3);
        }
        // 전설·에픽은 막바지에 반짝이가 튄다
        var spk = _img.sparkle;
        if (ready(spk) && u > 0.5) {
            var sc = _anchors.sparkle.cell, f = Math.floor(st / 90) % 4;
            c.drawImage(spk, f * sc, 0, sc, sc, bx + r - 6, REVEAL_CY - r - 18, sc * 0.4, sc * 0.4);
            c.drawImage(spk, ((f + 2) % 4) * sc, 0, sc, sc, bx - r - 30, REVEAL_CY - 8, sc * 0.35, sc * 0.35);
        }
    }

    function loop(now) {
        if (!_anim) return;
        var t = now - _anim.t0, TL = timeline(_anim.res.tier);
        drawAt(t);
        if (t >= TL.crank0) payShown();   // 코인이 투입구에 들어갔다 → 잔고가 줄어든다
        if (t >= TL.end && !_anim.done) { _anim.done = true; showResult(); }
        _raf = requestAnimationFrame(loop);   // 결과 화면에서도 빛살이 돈다 — 모달을 닫으면 멈춘다
    }
    function stopLoop() { if (_raf) cancelAnimationFrame(_raf); _raf = 0; }
    // 뽑기 값(서버 응답 balance)을 화면에 반영 — 코인이 들어간 순간(loop) 또는 스킵·닫기(showResult)에 한 번
    function payShown() { if (_anim && !_anim.paid) { _anim.paid = true; setBalance(_anim.res.balance); } }
    function skip() {
        if (!_anim || _anim.done) return;
        _anim.t0 = performance.now() - timeline(_anim.res.tier).end;   // 시간만 끝으로 — 그리기는 drawAt 이 알아서 최종 화면
    }

    // ── DOM ───────────────────────────────────────────────
    // 마우스 호버가 없는 기기(폰) — 말풍선을 탭으로 열고 닫는다. PC 는 :hover 로만 보인다(사용자 2026-09-24)
    function TOUCH_ONLY() { return !!(window.matchMedia && window.matchMedia('(hover: none)').matches); }
    function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function build() {
        if (_el) return _el;
        var ov = h('div', 'mgacha-overlay'); ov.hidden = true;
        var m = h('div', 'mgacha-modal'); m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', '구슬 뽑기');
        var head = h('div', 'mgacha-head');
        // 제목·아이콘 없음(사용자 2026-09-24) — 닫기만
        var x = h('button', 'mgacha-close', '✕'); x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.onclick = close;
        head.appendChild(x);
        m.appendChild(head);
        var stageWrap = h('div', 'mgacha-stage-wrap');
        var cv = h('canvas', 'mgacha-stage');
        cv.width = STAGE_W; cv.height = STAGE_H;   // 실제 크기는 fitCanvas 가 화면에 맞춘다
        cv.addEventListener('click', skip);
        stageWrap.appendChild(cv);
        // 잔고 — ✕ 바로 아래(무대 오른쪽 위에 얹음 → 모달 크기 불변): 코인 아이콘 + "N · +10 m:ss"
        var bal = coinLabel('mgacha-coin');
        stageWrap.appendChild(bal);
        m.appendChild(stageWrap);
        var result = h('div', 'mgacha-result'); result.hidden = true;
        // 결과 칸 자리의 안내 한 줄 — 뽑기 전 / 연출 중(건너뛰기). 결과가 뜨면 CSS 가 숨긴다
        var hint = h('div', 'mgacha-wait', '뽑기를 누르면 구슬이 굴러 나와요');
        result.appendChild(hint);
        var badge = h('span', 'mgacha-badge'); var name = h('span', 'mgacha-name');
        var line = h('div', 'mgacha-result-line'); line.appendChild(badge); line.appendChild(name);
        var note = h('div', 'mgacha-note');
        var equip = h('button', 'mgacha-equip', '장착하기'); equip.type = 'button'; equip.onclick = equipPulled;
        result.appendChild(line); result.appendChild(note); result.appendChild(equip);
        m.appendChild(result);
        var pull = h('button', 'mgacha-pull', '뽑기 · ' + PRICE + '코인'); pull.type = 'button'; pull.onclick = pullOnce;
        // 확률 안내 ? — 빨간 버튼 안 오른쪽에 겹쳐 둔다(버튼 속 버튼은 안 되므로 감싼 상자 기준 절대 위치). 말풍선은 위로 뜬다
        var pullWrap = h('div', 'mgacha-pull-wrap');
        var help = h('button', 'mgacha-help', '?'); help.type = 'button'; help.setAttribute('aria-label', '뽑기 확률');
        var tip = h('span', 'mgacha-tip'); tip.setAttribute('role', 'tooltip');
        tip.appendChild(h('span', null, ODDS_TEXT));
        var stayLine = h('span', 'mgacha-tip-stay', '방에 있으면 5분마다 ' + STAY_COIN + '코인이 쌓여요');
        tip.appendChild(stayLine);
        help.onclick = function (e) { e.stopPropagation(); if (TOUCH_ONLY()) help.classList.toggle('is-open'); };   // PC 는 호버로만(누르면 남아 있지 않게), 폰은 탭으로
        document.addEventListener('click', function () { help.classList.remove('is-open'); });   // 바깥을 누르면 닫힘(모바일)
        pullWrap.appendChild(pull); pullWrap.appendChild(help); pullWrap.appendChild(tip);   // tip 은 ? 바로 뒤 형제(:hover + 선택자)
        var msg = h('div', 'mgacha-msg');
        m.appendChild(pullWrap); m.appendChild(msg);
        ov.appendChild(m);
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        document.body.appendChild(ov);
        _ctx = cv.getContext('2d');
        window.addEventListener('resize', function () { if (_el && !_el.ov.hidden) { fitCanvas(); if (!_raf) drawAt(_anim && _anim.done ? 1e9 : 0); } });
        _el = { ov: ov, cv: cv, bal: bal, stayLine: stayLine, hint: hint, result: result, badge: badge, name: name, note: note, equip: equip, pull: pull, msg: msg };
        return _el;
    }
    // 코인 아이콘(공용 아틀라스 coin) + 숫자 칸. el.txt 에 글자를 넣는다
    function coinLabel(cls, el) {
        el = el || h('div', cls);
        if (!el.txt) {
            el.textContent = '';
            if (window.UIIcons && typeof UIIcons.el === 'function') el.appendChild(UIIcons.el('coin'));
            el.txt = h('span', 'mgacha-coin-txt'); el.appendChild(el.txt);
        }
        return el;
    }
    // 잔고 표시 = 뽑기 창 무대 오른쪽 위("코인아이콘 N · +10 m:ss") + 동물 고르기 제목 줄 알약(#marbleCoinPill, 코인만)
    function balanceEls() { return [_el && _el.bal, document.getElementById('marbleCoinPill')].filter(Boolean); }
    function setBalance(b) {
        var gained = typeof b === 'number' && typeof _balance === 'number' && b > _balance && !_busy;   // 뽑기 말고 늘어남 = 머문 시간·한 판 보상
        _balance = b;
        renderBalance();
        if (gained) balanceEls().forEach(function (e) { e.classList.remove('is-gain'); void e.offsetWidth; e.classList.add('is-gain'); });
    }
    function stayLeftText() {
        if (!_nextStayAt) return '';
        var left = Math.max(0, Math.round((_nextStayAt - Date.now()) / 1000));
        return Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2);
    }
    // 캔버스 버퍼 = 실제로 보이는 CSS 크기 × 화면 배율, 그리기는 부드럽게(사용자 2026-09-24 '두 장씩 그려진다' 제보).
    // 300 논리 크기를 CSS 가 312 등으로 늘리고 pixelated·NN 으로 비정수 배율 그리기를 하면 픽셀 줄이 두 번 찍혀 윤곽이 겹쳐 보였다.
    // 그림 원본이 화면의 2배라 줄여 그릴 때 보간하면 깔끔하다.
    function fitCanvas() {
        var cv = _el.cv, w = cv.clientWidth || STAGE_W, dpr = Math.min(3, window.devicePixelRatio || 1);
        var bw = Math.round(w * dpr), bh = Math.round(w * STAGE_H / STAGE_W * dpr);
        if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
        var k = bw / STAGE_W;
        _ctx.setTransform(k, 0, 0, k, 0, 0);
        _ctx.imageSmoothingEnabled = true; _ctx.imageSmoothingQuality = 'high';
    }
    // "N분 뒤에 10코인이 들어와요" — 분 단위 올림, 1분 미만은 "1분 안에"
    function stayTipText() {
        if (!_nextStayAt) return '방에 있으면 5분마다 ' + STAY_COIN + '코인이 들어와요';
        var sec = Math.max(0, Math.ceil((_nextStayAt - Date.now()) / 1000));
        return (sec < 60 ? '1분 안에' : Math.ceil(sec / 60) + '분 뒤에') + ' ' + STAY_COIN + '코인이 들어와요';
    }
    function pillTip(pill) {
        if (!pill.tip) {
            pill.tip = h('span', 'marble-coin-tip'); pill.tip.setAttribute('role', 'tooltip');
            pill.appendChild(pill.tip);
            pill.setAttribute('tabindex', '0');
            pill.addEventListener('click', function (e) { e.stopPropagation(); if (TOUCH_ONLY()) pill.classList.toggle('is-open'); });
            document.addEventListener('click', function () { pill.classList.remove('is-open'); });
        }
        return pill.tip;
    }
    function renderBalance() {
        var coin = typeof _balance === 'number' ? _balance.toLocaleString('ko-KR') : '…';   // 내부 테스트 200만 코인도 읽히게 쉼표
        if (_el) _el.bal.txt.textContent = coin;   // 코인만(사용자 2026-09-24) — 다음 +10 까지 남은 시간은 ? 말풍선·방 화면 코인 말풍선에서
        var pill = document.getElementById('marbleCoinPill');
        if (pill && typeof _balance === 'number') {   // 방 화면은 코인만 — 남은 시간은 마우스를 올리면(폰은 누르면) 말풍선(사용자 2026-09-23)
            pill.hidden = false; coinLabel(null, pill).txt.textContent = coin;
            pillTip(pill).textContent = stayTipText();
        }
    }
    // 지갑 응답 반영 + 다음 보상 시각에 다시 받기 예약(창이 열려 있을 때만)
    function applyWallet(w) {
        if (!w || !w.ok) return;
        setBalance(w.balance);
        if (typeof w.stayNextMs === 'number') _nextStayAt = Date.now() + w.stayNextMs;
        clearTimeout(_stayTimer);
        if (_nextStayAt) _stayTimer = setTimeout(refreshWallet, Math.max(500, _nextStayAt - Date.now() + 400));
    }
    function refreshWallet() { if (_socket) _socket.emit('marble:shop:get', {}, applyWallet); }
    function tickStay() {
        renderBalance();
        if (_el && _nextStayAt) _el.stayLine.textContent = '방에 있으면 5분마다 ' + STAY_COIN + '코인이 쌓여요 · 다음까지 ' + stayLeftText();
    }
    // 방에 들어온 뒤 한 번(js/marble.js roomCreated/roomJoined) — 알약 표시·1초 카운트다운·주기 갱신 시작
    function onRoomEntered() {
        refreshWallet();
        clearInterval(_tickTimer); _tickTimer = setInterval(tickStay, 1000);
        clearInterval(_pollTimer); _pollTimer = setInterval(refreshWallet, WALLET_POLL_MS);
    }
    function setMsg(t) { if (_el) _el.msg.textContent = t || ''; }

    function showResult() {
        var res = _anim.res, item = _anim.item || {};
        payShown();
        _el.hint.hidden = true;
        _el.badge.textContent = TIER_LABEL[res.tier] || '';
        _el.badge.className = 'mgacha-badge mgacha-badge--' + res.tier;
        _el.name.textContent = item.displayName || item.name || '';
        _el.note.textContent = res.dupe ? '이미 가진 거라 ' + res.refund + '코인을 돌려받았어요' : '';   // 뻔한 안내는 없음(사용자 2026-09-24) — 중복 환급만 알린다
        _el.equip.disabled = false; _el.equip.textContent = '장착하기';
        _el.result.hidden = false;
        _busy = false;
        _el.pull.disabled = false; _el.pull.textContent = '한 번 더 · ' + PRICE + '코인';
    }

    function pullOnce() {
        if (_busy || !_socket) return;
        _busy = true; _el.pull.disabled = true; setMsg('');
        _socket.emit('marble:gacha:pull', {}, function (res) {
            if (!res || !res.ok) {
                _busy = false; _el.pull.disabled = false;
                if (res && typeof res.balance === 'number') setBalance(res.balance);
                setMsg(res && res.reason === 'insufficient' ? '코인이 모자라요. 한 판 뛰면 10코인씩 모여요.' : '지금은 뽑을 수 없어요. 잠시 뒤 다시 해 주세요.');
                return;
            }
            var item = catalogItem(res.cosmeticId);   // 잔고는 코인이 투입구에 들어간 순간 줄어든다(payShown)
            itemImage(item);   // 연출 도는 동안 미리 받는다
            _el.result.hidden = true; _el.hint.hidden = false; _el.hint.textContent = '화면을 누르면 건너뛰어요';
            var seed = 0; for (var si = 0; si < res.cosmeticId.length; si++) seed = (seed * 31 + res.cosmeticId.charCodeAt(si)) >>> 0;
            var globe = null;   // 유리구 공 움직임을 끝까지 미리 계산 — 실패해도(옛 캐시 등) 연출은 시작한다(공은 쌓인 채로)
            try { if (_anchors && _anchors.machine.globeBalls && _anchors.machine.globeBalls.boundary) globe = simulateGlobe(currentPile(), seed ^ Math.floor(res.balance * 7919), TIER_BALL[res.tier] !== undefined ? TIER_BALL[res.tier] : 2, fx(res.tier).crank); } catch (e) { globe = null; }
            if (globe) _globePile = globe.final;   // 새 더미 = 다음 뽑기의 출발점
            _anim = { res: res, item: item, t0: performance.now(), done: false, globe: globe, paid: false };
            stopLoop(); _raf = requestAnimationFrame(loop);
        });
    }

    function equipPulled() {
        if (!_anim || !_socket) return;
        var res = _anim.res;
        _el.equip.disabled = true;
        _socket.emit('marble:equip', { slot: res.slot, cosmeticId: res.cosmeticId }, function (r) {
            if (!r || !r.ok) { _el.equip.disabled = false; setMsg('장착하지 못했어요. 꾸미기에서 다시 해 주세요.'); return; }
            _el.equip.textContent = '장착했어요 ✓';
            if (window.MarbleShop && typeof MarbleShop.syncRoomEquip === 'function') MarbleShop.syncRoomEquip(r.equipped || {});
        });
    }

    function open() {
        build();
        _el.ov.hidden = false;
        document.body.classList.add('mgacha-open');
        fitCanvas();
        setMsg('');
        refreshWallet();
        tickStay();
        loadAll().then(function () {
            if (_el.ov.hidden) return;
            if (_anim && _anim.done) { stopLoop(); _raf = requestAnimationFrame(loop); }   // 지난 결과 화면을 다시(빛살 회전)
            else if (!_anim) drawAt(0);
        });
        _el.pull.disabled = _busy;
    }
    function close() {
        if (!_el) return;
        // 연출 중에 닫아도 결과는 이미 서버에 반영됨 — 다음에 열면 결과 화면부터
        if (_anim && !_anim.done) { _anim.done = true; showResult(); }
        stopLoop();
        _el.ov.hidden = true;
        document.body.classList.remove('mgacha-open');
    }

    window.MarbleGacha = {
        connect: function (socket) {
            _socket = socket;
            if (_walletListened !== socket) {   // 한 판 보상(awardRaceCoins)이 보내는 잔고
                _walletListened = socket;
                socket.on('wallet:updated', function (d) { if (d && typeof d.balance === 'number') setBalance(d.balance); });
            }
        },
        onRoomEntered: onRoomEntered,
        open: open,
        close: close
    };
})();
