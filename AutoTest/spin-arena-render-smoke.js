// 헤드리스 렌더 스모크 — js/spin-arena.js 의 SEQUENTIAL 연출 타임라인/렌더를 가짜 2D ctx + 실제 simulate() payload로 구동.
//   목적(lessons): (1) 죽은 렌더 경로 dangling-ref ReferenceError(node -c 미검출) 포착,
//                  (2) var-hoist NaN/throw 포착, (3) 클라 세그 타임라인 총합 === 서버 payload.durationMs(off-by-one → 결과 조기/지연).
//   브라우저 전용 전역(window/document/socket/Image 등)은 최소 shim. simulate는 socket/spin-arena.js 실export.
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
    id: id || '', width: 480, height: 480, style: {}, className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    children: [], firstChild: null,
    getContext() { return ctx; },
    getAttribute() { return null; }, setAttribute() {}, hasAttribute() { return false; },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {}, remove() {},
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

function mkSlots(n) {
  const slots = [];
  for (let i = 0; i < n; i++) slots.push({ id: i, isBot: false, name: 'P' + i, skinId: null });
  return slots;
}

(async () => {
  let pass = true;
  const check = (cond, label) => { console.log(label + ':', cond ? 'PASS' : 'FAIL'); if (!cond) pass = false; };

  for (const reduced of [false, true]) {
    for (const n of [2, 8, 24]) {
      const seed = (n * 7919 + (reduced ? 13 : 1)) >>> 0;
      const sim = await spinServer.simulate(mkSlots(n), seed);
      // reveal payload 형태(클라가 받는 것과 동일 필드)
      const skById = {};
      const revealSlots = sim.slots.map(s => {
        const meta = { id: s.id, isBot: false, name: s.name, skinId: 'crimson', color: '#e23b3b', blade: '#ff7a7a', tier: 1, bladeCount: 2, bladeRadius: sim.geom.bladeRadius };
        skById[s.id] = meta; return meta;
      });
      const payload = {
        durationMs: sim.durationMs, sampleMs: sim.sampleMs,
        arena: { w: 480, h: 480, cx: 240, cy: 240, r: 220 },
        slots: revealSlots, bracket: sim.bracket, geom: sim.geom, result: { selected: null, rankings: sim.rankings, successionList: sim.succession }
      };

      const { sandbox, getEl } = buildSandbox();
      const win = sandbox.window;
      win.matchMedia = function () { return { matches: reduced, addEventListener() {}, removeEventListener() {} }; };
      sandbox.matchMedia = win.matchMedia;
      let ctx;
      let loadErr = null;
      try { ctx = loadClient(sandbox); } catch (e) { loadErr = e; }
      check(!loadErr, `n=${n} reduced=${reduced} client load (no throw)` + (loadErr ? ' — ' + loadErr.message : ''));
      if (loadErr) continue;

      // initSpinFx(payload) → _slotById/_duelFx/_seqTL 세팅
      let initErr = null;
      try { ctx.initSpinFx(payload); } catch (e) { initErr = e; }
      check(!initErr, `n=${n} reduced=${reduced} initSpinFx (no throw)` + (initErr ? ' — ' + initErr.message : ''));
      if (initErr) continue;

      // 타임라인 총합 === payload.durationMs (서버 식과 동일 — off-by-one 이면 결과 조기/지연)
      const tl = ctx.spinReplay._seqTL;
      const total = tl ? tl.total : -1;
      const capped = Math.min(spinServer.GAME_MS || 340000, total);
      check(Math.min(340000, total) === payload.durationMs,
        `n=${n} reduced=${reduced} 클라 세그 타임라인 총합 === payload.durationMs (client=${total}→cap ${Math.min(340000, total)}, server=${payload.durationMs})`);
      void capped;

      // 전 세그먼트 통과(경계 + 중간 + 끝) — drawSpinFrame 직접 호출(startTs=0, now=t). 모든 t에서 0 throw 단언.
      // drawSpinFrame은 gt>=durationMs면 endSpinReplayToResult로 종료하므로, 안전하게 가짜 raf 무한루프 차단:
      //   payload/canvas를 세팅하고 t를 직접 주입. spinReplay.payload/phase 세팅 필요.
      ctx.spinReplay.payload = payload;
      ctx.spinReplay.phase = 'playing';
      ctx.spinReplay.startTs = 0;
      ctx.spinReplay.raf = 1;   // raf!==null이라 endSpinReplayToResult가 자연 호출되어도 안전 stub
      // 캔버스 stub 폭/높이 보장
      getEl('spinArenaCanvas').width = 480; getEl('spinArenaCanvas').height = 480;

      // 세그 경계마다 start/mid/end-1 샘플 + 전역 균등 200샘플
      const samplePts = new Set();
      if (tl) for (const s of tl.segs) {
        samplePts.add(s.start); samplePts.add(Math.floor((s.start + s.end) / 2)); samplePts.add(Math.max(s.start, s.end - 1));
      }
      const dur = payload.durationMs;
      for (let k = 0; k <= 200; k++) samplePts.add(Math.floor(dur * k / 200));
      samplePts.add(dur); samplePts.add(dur + 50);   // 종료 경계

      let renderErr = null, renderErrT = -1;
      const pts = Array.from(samplePts).sort((a, b) => a - b);
      for (const t of pts) {
        ctx.spinReplay.lastNow = t;   // dt=0 방지
        ctx.spinReplay.raf = 1;       // 매 샘플마다 살려둠(자연 종료가 raf=null 세팅해도 다음 호출 가능)
        try { ctx.drawSpinFrame(t); } catch (e) { renderErr = e; renderErrT = t; break; }
      }
      check(!renderErr, `n=${n} reduced=${reduced} drawSpinFrame 전 세그 0-throw` + (renderErr ? ` — t=${renderErrT}: ${renderErr.message}` : ''));

      // 카운트다운 백드롭 1프레임(드로우 경로 추가 커버)
      let cdErr = null;
      try { ctx.drawSpinCountdownFrame(payload, 0); } catch (e) { cdErr = e; }
      check(!cdErr, `n=${n} reduced=${reduced} drawSpinCountdownFrame 0-throw` + (cdErr ? ' — ' + cdErr.message : ''));

      // idle 프리뷰 1프레임(roster 경로) — currentUsers 비어도 0 throw
      let idleErr = null;
      try { ctx.spinReplay.phase = 'idle'; ctx.drawSpinIdleFrame(0); } catch (e) { idleErr = e; }
      check(!idleErr, `n=${n} reduced=${reduced} drawSpinIdleFrame 0-throw` + (idleErr ? ' — ' + idleErr.message : ''));

      // 결과 오버레이 1회
      let resErr = null;
      try { ctx.showSpinResult(payload.result); } catch (e) { resErr = e; }
      check(!resErr, `n=${n} reduced=${reduced} showSpinResult 0-throw` + (resErr ? ' — ' + resErr.message : ''));
    }
  }

  console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('SMOKE ERROR:', e); process.exit(2); });
