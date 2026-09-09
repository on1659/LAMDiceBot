// 헤드리스 렌더 스모크 — js/spin-arena.js 의 2스테이지 전투/전환/룰렛 렌더를 가짜 2D ctx + 실제 simulateMatch() payload로 구동.
//   목적(lessons): (1) 죽은 렌더 경로 dangling-ref ReferenceError(node -c 미검출) 포착,
//                  (2) var-hoist NaN/throw 포착, (3) frames stride·탈락 시각 맵·**링 반경/단계 판정이 서버와 동일한지**.
//   브라우저 전용 전역(window/document/socket/Image 등)은 최소 shim. simulateMatch는 socket/spin-arena.js 실export.
//   실행: node AutoTest/spin-arena-render-smoke.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const spinServer = require('../socket/spin-arena.js');

// ── 가짜 2D 컨텍스트 — 모든 draw 호출을 받아들이고 throw 0. createLinearGradient/RadialGradient는 addColorStop 받는 객체. ──
function makeFakeCtx() {
  const grad = { addColorStop() {} };
  const ctx = {
    canvas: null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt',
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    shadowBlur: 0, shadowColor: '#000', lineDashOffset: 0,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {}, rect() {},
    quadraticCurveTo() {}, bezierCurveTo() {},
    fill() {}, stroke() {}, fillRect() {}, strokeRect() {}, clearRect() {},
    translate() {}, scale() {}, rotate() {}, setTransform() {}, transform() {},
    setLineDash() {}, clip() {},
    drawImage() {}, putImageData() {}, getImageData() { return { data: new Uint8ClampedArray(4) }; },
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; }, createPattern() { return grad; },
    measureText(t) { return { width: (String(t).length) * 6 }; },
    fillText() {}, strokeText() {}, isPointInPath() { return false; }
  };
  return ctx;
}

// ── 가짜 canvas + DOM. getElementById('spinArenaCanvas')만 canvas, 나머지는 generic stub. ──
function makeStubEl(id) {
  const ctx = makeFakeCtx();
  const el = {
    id: id || '', width: 480, height: 480, style: {}, className: '', dataset: {},
    classList: {
      add(c) { const cur = (el.className || '').split(' ').filter(Boolean); if (cur.indexOf(c) < 0) cur.push(c); el.className = cur.join(' '); },
      remove(c) { el.className = (el.className || '').split(' ').filter(x => x && x !== c).join(' '); },
      toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); },
      contains(c) { return (el.className || '').split(' ').indexOf(c) >= 0; }
    },
    children: [], firstChild: null,
    getContext() { return ctx; },
    getAttribute() { return null; }, setAttribute() {}, hasAttribute() { return false; },
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 480, height: 480 }; },
    insertBefore() {}, contains() { return false; }
  };
  ctx.canvas = el;
  return el;
}

function buildSandbox() {
  const els = {};
  function getEl(id) {
    if (!els[id]) els[id] = makeStubEl(id);
    return els[id];
  }
  const documentStub = {
    getElementById: getEl,
    querySelector() { return makeStubEl(); },
    querySelectorAll() { return []; },
    createElement() { return makeStubEl(); },
    addEventListener() {}, removeEventListener() {},
    body: makeStubEl('body'),
    documentElement: makeStubEl('html'),
    title: ''
  };
  const storage = () => {
    const m = {};
    return { getItem(k) { return k in m ? m[k] : null; }, setItem(k, v) { m[k] = String(v); }, removeItem(k) { delete m[k]; } };
  };
  // io() stub — 클라 최상위에서 socket = io({...}) 호출. on/emit/off/connected 필요.
  function ioStub() {
    return { on() {}, off() {}, emit() {}, connected: false, id: 'smoke' };
  }
  const win = {
    location: { hostname: 'localhost', search: '', pathname: '/spin-arena', replace() {}, href: '' },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    addEventListener() {}, removeEventListener() {},
    history: { replaceState() {} },
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    performance: { now: () => 0 },
    navigator: { userAgent: 'node-smoke' },
    Image: function () { this.onload = null; this.src = ''; },
    ImageData: function (data, w, h) { this.data = data; this.width = w; this.height = h; },
    io: ioStub,
    JSON, Math, Date, parseInt, parseFloat, isNaN, console
  };
  win.window = win;
  const sandbox = Object.assign({}, win, {
    window: win, document: documentStub,
    localStorage: storage(), sessionStorage: storage(),
    URLSearchParams,
    requestAnimationFrame: win.requestAnimationFrame, cancelAnimationFrame: win.cancelAnimationFrame,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout, setInterval: win.setInterval, clearInterval: win.clearInterval,
    performance: win.performance, navigator: win.navigator,
    Image: win.Image, ImageData: win.ImageData, io: ioStub,
    matchMedia: win.matchMedia,
    console, JSON, Math, Date, parseInt, parseFloat, isNaN
  });
  return { sandbox, getEl };
}

function loadClient(sandbox) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'spin-arena.js'), 'utf8');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: 'js/spin-arena.js' });
  return ctx;
}

// reveal payload 조립 — socket/spin-arena.js 의 emit 구조를 그대로 거울링
function mkPayload(sim, targetRank) {
    const PALETTE = ['#e23b3b', '#3b82e2', '#2bb673', '#e2a23b', '#9b59e2', '#e23b8f', '#22c1d6', '#9ccf2f'];
    const BLADE = ['#ff7a7a', '#7ab0ff', '#6fe0a8', '#ffce7a', '#c79aff', '#ff7ac0', '#7ae9f6', '#d3f57a'];
    const players = [];
    for (let i = 0; i < sim.n; i++) {
        players.push({
            slotId: i, name: 'P' + i, skinId: 'crimson',
            color: PALETTE[i % PALETTE.length], blade: BLADE[i % BLADE.length], tier: 1, bladeCount: 2
        });
    }
    const target = sim.rankings.find(r => r.rank === targetRank) || sim.rankings[0];
    const champ = sim.rankings.find(r => r.rank === 1);
    return {
        players,
        arena: { w: 480, h: 480, cx: 240, cy: 240, r: 220 },
        geom: sim.geom,
        blades: sim.blades,
        frames: sim.frames,
        sampleMs: sim.sampleMs,
        durationMs: sim.durationMs,
        countdownMs: 4000,
        twoStage: sim.twoStage,
        stage1EndMs: sim.stage1EndMs,
        finaleStartMs: sim.finaleStartMs,
        finalists: sim.finalists,
        finalistCount: 4,
        roulette: {
            segments: [{ rank: targetRank, count: 2 }, { rank: 1, count: 1 }],
            rankOrder: [targetRank, 1, targetRank],
            winningRank: targetRank,
            reason: '룰렛 추첨 결과 ' + targetRank + '등 벌칙',
            animDurationMs: 5500, holdMs: 1200
        },
        result: {
            targetRank, targetSlot: target.slotId, targetName: 'P' + target.slotId,
            championSlot: champ ? champ.slotId : null, championName: champ ? 'P' + champ.slotId : null,
            rankings: sim.rankings
        }
    };
}

(async () => {
    let pass = true;
    const check = (cond, label) => { console.log(label + ':', cond ? 'PASS' : 'FAIL'); if (!cond) pass = false; };

    for (const reduced of [false, true]) {
        for (const n of [2, 4, 8, 24]) {
            const seed = (n * 7919 + (reduced ? 13 : 1)) >>> 0;
            const sim = await spinServer.simulateMatch(n, seed);
            const targetRank = Math.min(2, n);
            const payload = mkPayload(sim, targetRank);
            const tag = `n=${n} reduced=${reduced}`;

            const { sandbox, getEl } = buildSandbox();
            const win = sandbox.window;
            win.matchMedia = function () { return { matches: reduced, addEventListener() {}, removeEventListener() {} }; };
            sandbox.matchMedia = win.matchMedia;

            let ctx, loadErr = null;
            try { ctx = loadClient(sandbox); } catch (e) { loadErr = e; }
            check(!loadErr, `${tag} client load (no throw)` + (loadErr ? ' — ' + loadErr.message : ''));
            if (loadErr) continue;

            let initErr = null;
            try { ctx.initSpinFx(payload); } catch (e) { initErr = e; }
            check(!initErr, `${tag} initSpinFx (no throw)` + (initErr ? ' — ' + initErr.message : ''));
            if (initErr) continue;

            check(Object.keys(ctx.spinReplay._elimAt).length === n - 1, `${tag} _elimAt === n-1`);
            check(Object.keys(ctx.spinReplay._rankBySlot).length === n, `${tag} _rankBySlot === n`);
            check(Object.keys(ctx.spinReplay._finalistSet).length === (n > 4 ? 4 : n), `${tag} _finalistSet 크기`);

            const samples = Math.floor(payload.durationMs / payload.sampleMs) + 1;
            check(payload.frames.length === samples * n * 3, `${tag} frames stride === n×3`);

            // 링 반경 — 클라 미러 함수가 서버와 같은 값을 내는가(단계 경계 포함)
            let ringOk = true;
            const probes = payload.twoStage
                ? [0, payload.stage1EndMs - 1, payload.stage1EndMs, payload.finaleStartMs - 1, payload.finaleStartMs, payload.durationMs]
                : [0, Math.floor(payload.durationMs / 2), payload.durationMs];
            for (const t of probes) {
                const cl = ctx.ringRadiusAt(t, payload.stage1EndMs, payload.finaleStartMs);
                const sv = spinServer.ringRadiusAt(t, payload.stage1EndMs, payload.finaleStartMs);
                if (Math.abs(cl - sv) > 1e-9) ringOk = false;
            }
            check(ringOk, `${tag} ringRadiusAt 클라 === 서버 (단계 경계 포함)`);

            // 단계 판정
            if (payload.twoStage) {
                check(ctx.spinStageAt(payload, 0) === 'stage1' &&
                      ctx.spinStageAt(payload, payload.stage1EndMs) === 'transition' &&
                      ctx.spinStageAt(payload, payload.finaleStartMs) === 'finale',
                      `${tag} spinStageAt 경계 정확`);
            } else {
                check(ctx.spinStageAt(payload, 0) === 'finale', `${tag} 단일 단계는 항상 finale`);
            }

            ctx.spinReplay.payload = payload;
            ctx.spinReplay.phase = 'playing';
            ctx.spinReplay.startTs = 0;
            ctx.spinReplay.raf = 1;
            getEl('spinArenaCanvas').width = 480; getEl('spinArenaCanvas').height = 480;

            const samplePts = new Set([0, payload.durationMs, payload.durationMs + 50]);
            if (payload.twoStage) {
                for (const t of [payload.stage1EndMs - 1, payload.stage1EndMs, payload.stage1EndMs + 1,
                                 payload.finaleStartMs - 1, payload.finaleStartMs, payload.finaleStartMs + 1]) samplePts.add(t);
                // 전환 구간 전체를 촘촘히(배너 낙하/홀드/페이드 분기)
                for (let k = 0; k <= 20; k++) samplePts.add(payload.stage1EndMs + Math.floor((payload.finaleStartMs - payload.stage1EndMs) * k / 20));
            }
            for (const r of payload.result.rankings) {
                if (r.atMs == null) continue;
                samplePts.add(Math.max(0, r.atMs - 1)); samplePts.add(r.atMs); samplePts.add(r.atMs + 1);
            }
            for (let k = 0; k <= 200; k++) samplePts.add(Math.floor(payload.durationMs * k / 200));

            let renderErr = null, renderErrT = -1;
            for (const t of Array.from(samplePts).sort((a, b) => a - b)) {
                ctx.spinReplay.lastNow = t;
                ctx.spinReplay.raf = 1;
                try { ctx.drawSpinFrame(t); } catch (e) { renderErr = e; renderErrT = t; break; }
            }
            check(!renderErr, `${tag} drawSpinFrame 전 구간 0-throw` + (renderErr ? ` — t=${renderErrT}: ${renderErr.message}` : ''));

            let rouErr = null;
            try {
                const c = getEl('spinArenaCanvas');
                for (const t of [0, 2000, 5499, 5500, 6700]) ctx.drawRouletteFrame(c.getContext('2d'), c, payload, t);
            } catch (e) { rouErr = e; }
            check(!rouErr, `${tag} drawRouletteFrame 0-throw` + (rouErr ? ' — ' + rouErr.message : ''));

            let cdErr = null;
            try { ctx.drawSpinCountdownFrame(payload, 0); } catch (e) { cdErr = e; }
            check(!cdErr, `${tag} drawSpinCountdownFrame 0-throw` + (cdErr ? ' — ' + cdErr.message : ''));

            let idleErr = null;
            try { ctx.spinReplay.phase = 'idle'; ctx.drawSpinIdleFrame(0); } catch (e) { idleErr = e; }
            check(!idleErr, `${tag} drawSpinIdleFrame 0-throw` + (idleErr ? ' — ' + idleErr.message : ''));

            let resErr = null;
            try { ctx.showSpinResult(payload.result); } catch (e) { resErr = e; }
            check(!resErr, `${tag} showSpinResult 0-throw` + (resErr ? ' — ' + resErr.message : ''));

            let uiErr = null;
            try {
                ctx.currentUser = 'P0';
                ctx.readyUsers = ['P0', 'P1', 'P2', 'P3', 'P4'];
                ctx.currentUsers = [{ name: 'P0' }, { name: 'P1' }, { name: 'P2' }, { name: 'P3' }, { name: 'P4' }];
                ctx.spinReplay.phase = 'idle';
                // 2등에 3표(P0 포함), 4등에 1표 — 익명 막대 개수가 표 수와 맞는지 본다
                ctx.spinRankVotes = { P0: 2, P1: 2, P2: 2, P3: 4 };
                getEl('spinRankVoteBoxes').children = [];
                ctx.renderRankVote();
            } catch (e) { uiErr = e; }
            check(!uiErr, `${tag} renderRankVote 0-throw` + (uiErr ? ' — ' + uiErr.message : ''));

            // 성향 패널 — 카드 2개(공격형/방어형), 내 선택에 .picked
            let dispErr = null;
            try {
                ctx.currentUser = 'P0';
                ctx.readyUsers = ['P0', 'P1'];
                ctx.spinReplay.phase = 'idle';
                ctx.spinDispositions = { P0: 'atk', P1: 'def' };
                getEl('spinDispPicker').innerHTML = '';
                ctx.renderDispPicker();
            } catch (e) { dispErr = e; }
            check(!dispErr, `${tag} renderDispPicker 0-throw` + (dispErr ? ' — ' + dispErr.message : ''));
            if (!dispErr) {
                const dh = getEl('spinDispPicker').innerHTML || '';
                check((dh.match(/disp-card/g) || []).length === 2, `${tag} 성향 카드 2개`);
                check(dh.indexOf('picked') >= 0, `${tag} 내 성향에 .picked`);
                check(dh.indexOf('공격형') >= 0 && dh.indexOf('방어형') >= 0, `${tag} 공격형/방어형 표기`);
            }

            // 스킨 팝업 열고 닫기 — 모달 경로
            let modalErr = null;
            try { ctx.openSpinSkinModal(); ctx.closeSpinSkinModal(); } catch (e) { modalErr = e; }
            check(!modalErr, `${tag} 스킨 팝업 open/close 0-throw` + (modalErr ? ' — ' + modalErr.message : ''));

            // 스킨 피커 — 고를 수 있는 색만 보여야 한다. 상점 모듈이 없으면 소유 0 → 무료 6색만.
            let skinErr = null;
            try {
                getEl('spinSkinPicker').innerHTML = '';
                ctx.renderSkinPicker();
            } catch (e) { skinErr = e; }
            check(!skinErr, `${tag} renderSkinPicker 0-throw` + (skinErr ? ' — ' + skinErr.message : ''));
            if (!skinErr) {
                const h = getEl('spinSkinPicker').innerHTML || '';
                const swatches = (h.match(/spin-skin-swatch/g) || []).length;
                const freeCount = ctx.SPIN_SKIN_COLORS.filter(c => c.free).length;
                check(swatches === freeCount, `${tag} 스와치 = 무료 스킨 수 (${swatches}/${freeCount})`);
                check(h.indexOf('spin-skin-lock') < 0 && h.indexOf('data-locked') < 0,
                      `${tag} 잠금 스와치가 노출되지 않음`);
            }

            // 경마식 DOM 계약: 박스 = FINALIST_COUNT개, 박스마다 "N등" + 표 수만큼의 막대, 내 표에 .selected
            if (!uiErr) {
                const boxes = getEl('spinRankVoteBoxes').children;
                const bars = r => {
                    // "rank-vote-bars"(컨테이너)가 부분 매칭되지 않게 닫는 따옴표까지 포함해서 센다
                    const m = (boxes[r - 1] && boxes[r - 1].innerHTML || '').match(/rank-vote-bar"/g);
                    return m ? m.length : 0;
                };
                check(boxes.length === 4, `${tag} 투표 박스 4개 (${boxes.length})`);
                check(boxes.every((b, i) => (b.innerHTML || '').indexOf((i + 1) + '등') >= 0),
                      `${tag} 각 박스에 "N등" 표기`);
                check(bars(2) === 3 && bars(4) === 1 && bars(1) === 0 && bars(3) === 0,
                      `${tag} 익명 표 막대 수 === 득표 수 (2등 ${bars(2)} / 4등 ${bars(4)})`);
                check(boxes[1].className.indexOf('selected') >= 0 && boxes[0].className.indexOf('selected') < 0,
                      `${tag} 내 표(2등)에만 .selected`);
            }
        }
    }

    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('SMOKE ERROR:', e); process.exit(2); });
