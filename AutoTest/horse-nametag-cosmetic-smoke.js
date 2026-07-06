// 헤드리스 렌더 스모크 — js/horse-race.js 의 이름표(닉네임 라벨) 꾸미기 분기 로직을 VM 샌드박스에서 검증.
//   목적: H-1(useBroadcast=false → 타인 stale 라벨 차단), M-1(refreshMyNameTags 복원 순서/unequip 복귀),
//         applyLabelCosmetic 4-분기, 특수문자 닉네임 dataset.username 비교, ||{} fallback.
//   브라우저 전용 전역은 최소 shim. HorseShop / _raceCosmetics 는 테스트가 주입.
//   실행: node AutoTest/horse-nametag-cosmetic-smoke.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── 가짜 DOM 노드 (span.race-name-tag 모사). style.cssText 세터는 background/color/borderColor 를 리셋, 개별 세터는 덮어씀. ──
function makeStyle() {
  const style = {
    _bg: '', _color: '', _border: '', _cssText: '',
    get cssText() { return this._cssText; },
    set cssText(v) {
      this._cssText = v;
      // cssText 적용 = 인라인 스타일 전체 교체. 개별 프로퍼티 파싱은 단순화(테스트는 이후 개별 세터 결과만 본다).
      this._bg = ''; this._color = ''; this._border = '';
      // ME_NAMETAG_CSS 는 background/color 를 담으므로 대략 반영(분기 결과 식별용)
      if (/background:/.test(v)) this._bg = '__cssText_bg__';
      if (/color:/.test(v)) this._color = '__cssText_color__';
    },
    get background() { return this._bg; }, set background(v) { this._bg = v; },
    get color() { return this._color; }, set color(v) { this._color = v; },
    get borderColor() { return this._border; }, set borderColor(v) { this._border = v; }
  };
  return style;
}
function makeTag(username) {
  const el = {
    nodeType: 1, tagName: 'SPAN', textContent: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    dataset: { username: username },
    style: makeStyle()
  };
  return el;
}

function buildSandbox(allTags) {
  const documentStub = {
    getElementById() { return null; },
    querySelector() { return null; },
    // refreshMyNameTags 가 .race-name-tag 전부 가져옴 — 테스트가 등록한 태그 반환
    querySelectorAll(sel) { return sel === '.race-name-tag' ? allTags.slice() : []; },
    createElement() { return makeTag(''); },
    addEventListener() {}, removeEventListener() {},
    body: { style: {}, classList: { add() {}, remove() {}, contains() { return false; } } },
    documentElement: { classList: { add() {}, remove() {}, contains() { return false; } }, hasAttribute() { return false; }, setAttribute() {} },
    title: ''
  };
  const storage = () => { const m = {}; return { getItem(k) { return k in m ? m[k] : null; }, setItem(k, v) { m[k] = String(v); }, removeItem(k) { delete m[k]; } }; };
  function ioStub() { return { on() {}, off() {}, emit() {}, connected: false, id: 'smoke' }; }
  const win = {
    location: { hostname: 'localhost', search: '', pathname: '/horse-race', replace() {}, href: '' },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    addEventListener() {}, removeEventListener() {},
    history: { replaceState() {} },
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    performance: { now: () => 0 }, navigator: { userAgent: 'node-smoke' },
    Image: function () { this.onload = null; this.src = ''; },
    io: ioStub, JSON, Math, Date, parseInt, parseFloat, isNaN, console
  };
  win.window = win;
  const sandbox = Object.assign({}, win, {
    window: win, document: documentStub,
    localStorage: storage(), sessionStorage: storage(),
    URLSearchParams,
    requestAnimationFrame: win.requestAnimationFrame, cancelAnimationFrame: win.cancelAnimationFrame,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout, setInterval: win.setInterval, clearInterval: win.clearInterval,
    performance: win.performance, navigator: win.navigator, Image: win.Image, io: ioStub,
    matchMedia: win.matchMedia, console, JSON, Math, Date, parseInt, parseFloat, isNaN
  });
  return sandbox;
}

function loadClient(sandbox) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'horse-race.js'), 'utf8');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { filename: 'js/horse-race.js' });
  return ctx;
}

// 카탈로그 기반 HorseShop 스텁. equippedBib = 내가 현재 장착한 bib id(null 가능).
function makeHorseShop(equippedBib) {
  const CAT = {
    bib_gold: { color: '#1a1a1a', bg: '#ffd54a', border: '#c79100' },
    bib_neon: { color: '#0b1020', bg: '#4ade80', border: '#16a34a' }
  };
  return {
    _equipped: equippedBib,
    getMyEquippedLabel() { return this._equipped; },
    getLabelStyle(id) { return CAT[id] ? { color: CAT[id].color, bg: CAT[id].bg, border: CAT[id].border } : null; }
  };
}

(function () {
  let pass = true;
  const check = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + ': ' + label); if (!cond) pass = false; };

  const allTags = [];
  const sandbox = buildSandbox(allTags);
  let ctx, loadErr = null;
  try { ctx = loadClient(sandbox); } catch (e) { loadErr = e; }
  check(!loadErr, 'horse-race.js VM 로드(no throw)' + (loadErr ? ' — ' + loadErr.message : ''));
  if (loadErr) { process.exit(2); }

  const win = sandbox.window;
  // currentUser 세팅 (refreshMyNameTags 가 비교)
  ctx.currentUser = '김영태';

  // ───────────────────────────────────────────────────────────────────
  // H-1: 선택화면(useBroadcast=false) — broadcast labels 가 있어도 타인 라벨 미적용
  // ───────────────────────────────────────────────────────────────────
  win.HorseShop = makeHorseShop(null); // 나는 미장착
  win._raceCosmetics = { labels: { '박철수': 'bib_neon' } }; // 타인 박철수가 broadcast로 bib_neon
  {
    const other = makeTag('박철수');
    other.style.cssText = 'background: rgba(0,0,0,0.75); color: var(--bg-white);'; // 기본 타인 스타일
    ctx.applyLabelCosmetic(other, '박철수', /*isMe*/false, /*useBroadcast*/false);
    // useBroadcast=false → labels 무시 → bg 변경 없음(cssText 세팅 후 그대로)
    check(other.style.background === '__cssText_bg__' && other.style._border === '',
      'H-1: 선택화면(false)에서 타인 broadcast 라벨 미적용(stale 차단)');
  }
  // 선택화면에서 내(isMe) 로컬 장착은 적용돼야 함
  win.HorseShop = makeHorseShop('bib_gold');
  {
    const me = makeTag('김영태');
    me.style.cssText = ctx.ME_NAMETAG_CSS;
    ctx.applyLabelCosmetic(me, '김영태', true, false);
    check(me.style.background === '#ffd54a' && me.style.color === '#1a1a1a' && me.style._border === '#c79100',
      'H-1: 선택화면(false)에서 내 로컬 장착(bib_gold)은 적용');
  }

  // ───────────────────────────────────────────────────────────────────
  // 경주중(useBroadcast=true) — broadcast labels 전원 적용
  // ───────────────────────────────────────────────────────────────────
  win.HorseShop = makeHorseShop(null);
  win._raceCosmetics = { labels: { '박철수': 'bib_neon' } };
  {
    const other = makeTag('박철수');
    other.style.cssText = 'background: rgba(0,0,0,0.75); color: var(--bg-white);';
    ctx.applyLabelCosmetic(other, '박철수', false, /*useBroadcast*/true);
    check(other.style.background === '#4ade80' && other.style.color === '#0b1020' && other.style._border === '#16a34a',
      '경주중(true): 타인 broadcast 라벨(bib_neon) 적용 — 전원 동일');
  }
  // broadcast 에 내 라벨 없으면 isMe fallback 으로 내 로컬 장착
  win.HorseShop = makeHorseShop('bib_gold');
  win._raceCosmetics = { labels: {} }; // 서버가 내 라벨 안 보냄
  {
    const me = makeTag('김영태');
    me.style.cssText = ctx.ME_NAMETAG_CSS;
    ctx.applyLabelCosmetic(me, '김영태', true, true);
    check(me.style.background === '#ffd54a',
      '경주중(true): broadcast에 내 라벨 없으면 isMe fallback으로 내 로컬 장착');
  }

  // ───────────────────────────────────────────────────────────────────
  // M-1: refreshMyNameTags 복원 순서 + unequip 기본색 복귀
  // ───────────────────────────────────────────────────────────────────
  allTags.length = 0;
  const meTag = makeTag('김영태');
  const otherTag = makeTag('박철수');
  // 처음 내 태그에 bib_gold 적용된 상태
  win.HorseShop = makeHorseShop('bib_gold');
  win._raceCosmetics = { labels: {} };
  meTag.style.cssText = ctx.ME_NAMETAG_CSS;
  ctx.applyLabelCosmetic(meTag, '김영태', true, false);
  // 타인 태그도 기본 스타일
  otherTag.style.cssText = 'background: rgba(0,0,0,0.75);';
  otherTag.style.background = 'rgba(0,0,0,0.75)';
  allTags.push(meTag, otherTag);

  // 장착 상태에서 refresh → 내 것만 bib_gold 재적용
  ctx.refreshMyNameTags();
  check(meTag.style.background === '#ffd54a', 'M-1: refresh(장착) — 내 태그 bib_gold 재적용');
  check(otherTag.style.background === 'rgba(0,0,0,0.75)', 'M-1: refresh — 타인 태그(dataset.username≠currentUser) 미변경');

  // 이제 unequip (장착 해제) 후 refresh → 기본 ME 스타일 복귀(bib 색 사라짐)
  win.HorseShop = makeHorseShop(null); // 해제됨
  ctx.refreshMyNameTags();
  // applyMyDefaultTagStyle(ME_NAMETAG_CSS) 가 먼저 호출돼 cssText 리셋 → bg='__cssText_bg__', 이후 applyLabelCosmetic(false)는 bibId null 이라 미적용
  check(meTag.style.background === '__cssText_bg__',
    'M-1: refresh(해제) — applyMyDefaultTagStyle 먼저 → 기본색 복귀(bib 색 제거)');

  // ───────────────────────────────────────────────────────────────────
  // 엣지: 특수문자/공백 닉네임 dataset.username 비교
  // ───────────────────────────────────────────────────────────────────
  allTags.length = 0;
  ctx.currentUser = '<b>해커</b> 김';
  const weird = makeTag('<b>해커</b> 김');
  win.HorseShop = makeHorseShop('bib_neon');
  win._raceCosmetics = { labels: {} };
  weird.style.cssText = ctx.ME_NAMETAG_CSS;
  allTags.push(weird);
  ctx.refreshMyNameTags();
  check(weird.style.background === '#4ade80', '엣지: 특수문자/공백 닉네임 dataset.username 정확 매칭 + 적용');

  // ───────────────────────────────────────────────────────────────────
  // 하위호환: _raceCosmetics.labels 없음 / HorseShop 없음 → 0 throw, 미적용
  // ───────────────────────────────────────────────────────────────────
  {
    win._raceCosmetics = undefined; // 서버가 labelCosmetics 안 보냄(구버전)
    delete win.HorseShop;
    const t = makeTag('아무개');
    t.style.cssText = 'background: rgba(0,0,0,0.75);';
    t.style.background = 'rgba(0,0,0,0.75)';
    let err = null;
    try { ctx.applyLabelCosmetic(t, '아무개', false, true); } catch (e) { err = e; }
    check(!err && t.style.background === 'rgba(0,0,0,0.75)',
      '하위호환: _raceCosmetics/HorseShop 부재 시 0-throw + 미적용' + (err ? ' — ' + err.message : ''));
  }
  // _raceCosmetics 있으나 labels 누락 → ||{} 효과는 5490행(수신부) 책임. 여기선 applyLabelCosmetic 가 labels undefined 안전 단언.
  {
    win._raceCosmetics = {}; // labels 키 없음
    win.HorseShop = makeHorseShop('bib_gold');
    const me = makeTag('김영태'); ctx.currentUser = '김영태';
    me.style.cssText = ctx.ME_NAMETAG_CSS;
    let err = null;
    try { ctx.applyLabelCosmetic(me, '김영태', true, true); } catch (e) { err = e; }
    // labels undefined → isMe fallback → bib_gold
    check(!err && me.style.background === '#ffd54a',
      '하위호환: _raceCosmetics.labels 누락 시 0-throw + isMe fallback' + (err ? ' — ' + err.message : ''));
  }

  console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
  process.exit(pass ? 0 : 1);
})();
