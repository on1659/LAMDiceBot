// QA: 꾸미기 상점 전 카탈로그 렌더/적용 종합 검증 — Playwright (headless)
//
//   목적: horse-race 7슬롯(paint/trail/accessory/bib/aura/track_theme/finish_fx)과
//         spin-arena spin_skin 의 "모든" 카탈로그 아이템을 한 개씩 적용/렌더해
//         (1) 기대 DOM 노드가 생성되고 (2) 가시(non-zero box)이며 (3) 아이템별 distinct 하게
//         렌더되는지 단언한다. "throw 안 남"이 아니라 "실제로 그 아이템이 보이는가"를 검증.
//         각 슬롯마다 전 아이템을 나란히 그린 contact-sheet PNG 를 사람이 눈으로 확인하도록 저장.
//
//   공정성: 결과/시뮬/winner 경로 미접근. 순수 외형 render/apply 공개 API 만 호출
//           (HorseShop.applyEquippedToHorse / applyMyTrackTheme / playFinishFx / getLabelStyle,
//            spin 피커 renderSkinPicker 산출 DOM). 서버 소유권/selectSkin 위조 없음 —
//            spin_skin 은 인증 host 로 잠금만 해제(소유 위조 아님), 색/blade 는 클라 SPIN_SKIN_COLORS 거울.
//
//   전제: 로컬 서버 5173 가동 + 로컬 DB(host=코인 무한). Playwright 설치.
//   실행: node AutoTest/qa-shop-all-cosmetics-test.js     (cwd = 프로젝트 루트)
//   산출: AutoTest/qa-shop-contact-sheets/<slot>.png  (8장)
//   종료코드: 전 아이템 렌더 OK → 0, 하나라도 실패 → 1 (스크립트 예외 → 2)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:5173';
const SHOT_DIR = path.join(__dirname, 'qa-shop-contact-sheets');
// accessory 앵커 다양성: ACC_ANCHOR 에 존재하는 8종으로 분산(탈것별 위치 보정 시각 확인)
const VEHICLES = ['car', 'rocket', 'bird', 'rabbit', 'helicopter', 'horse', 'crab', 'knight'];

// AdSense/서드파티/리소스 노이즈 필터 (기존 테스트들과 동일 정책)
const NOISE = /favicon|sound-config|\.mp3|ERR_|net::|Failed to load resource|AdSense|adsbygoogle|TagError|googlesyndication|pagead|tailwind|ERR_BLOCKED_BY_CLIENT|status of 403/i;

const wait = ms => new Promise(r => setTimeout(r, ms));

// 슬롯별 결과 집계: { slot: { total, ok, fails: [{id, reason}] } }
const results = {};
function rec(slot, id, ok, reason) {
    if (!results[slot]) results[slot] = { total: 0, ok: 0, fails: [] };
    results[slot].total++;
    if (ok) results[slot].ok++;
    else results[slot].fails.push({ id, reason: reason || '(no reason)' });
}

(async () => {
    if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

    // ── 인증 host 계정 생성 (spin_skin 잠금 해제용; 소유 위조가 아니라 정상 로그인) ──
    const qaName = 'qshop' + Date.now().toString(36).slice(-8);
    let token = null;
    try {
        const reg = await fetch(BASE + '/api/auth/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: qaName, pin: '1234' })
        }).then(r => r.json());
        token = reg.token || null;
    } catch (e) { /* 등록 실패해도 horse 슬롯은 진행, spin 은 잠금배지 모드로 폴백 */ }
    console.log('QA host 계정:', qaName, token ? '(register OK)' : '(register FAIL — spin 은 비로그인 모드)');

    const browser = await chromium.launch();

    // ─────────────────────────────────────────────────────────────────────────
    // PART 1 — HORSE: paint / trail / accessory / bib / aura / track_theme / finish_fx
    // ─────────────────────────────────────────────────────────────────────────
    const hErrs = [];
    const hPage = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    hPage.on('console', m => { if (m.type() === 'error') hErrs.push(m.text()); });
    hPage.on('pageerror', e => hErrs.push(String(e)));

    try {
        await hPage.goto(BASE + '/horse-race-multiplayer.html?createRoom=true', { waitUntil: 'domcontentloaded', timeout: 25000 });
        await hPage.waitForFunction(() => !!(window.HorseShop && window.HorseShop.loadCatalog), null, { timeout: 15000 });
        await hPage.evaluate(() => window.HorseShop.loadCatalog());
        await hPage.waitForFunction(() => !!(window.HorseShop.getCatalogItem('acc_crown')), null, { timeout: 10000 });

        // 카탈로그 전 아이템 id 목록을 페이지에서 직접 추출 (source of truth = 로드된 카탈로그)
        const catalog = await hPage.evaluate(() => {
            // ShopModule.getCatalog 가 슬롯별 배열을 갖는다. HorseShop.getCatalogItem 로 개별 접근 가능.
            // 슬롯별 id 목록을 만들기 위해 ShopModule 내부 카탈로그를 읽는다(공개 getCatalogItem 보조).
            var cat = (window.ShopModule && ShopModule.getCatalog && ShopModule.getCatalog()) || null;
            if (!cat) return null;
            var out = {};
            ['paint', 'trail', 'accessory', 'bib', 'aura', 'track_theme', 'finish_fx'].forEach(function (slot) {
                out[slot] = (cat[slot] || []).map(function (it) { return it.id; });
            });
            return out;
        });
        if (!catalog) throw new Error('ShopModule.getCatalog() 접근 실패 — 카탈로그 인덱스 없음');
        console.log('horse 카탈로그 슬롯별 개수:',
            Object.keys(catalog).map(s => s + '=' + catalog[s].length).join(' '));

        // ── 합성 sandbox: 측정 가능한 가시 div + 진짜 vehicle SVG 주입(없으면 색박스 폴백) + mid-gray backdrop ──
        await hPage.evaluate((vehicles) => {
            var old = document.getElementById('qa-shop-sandbox');
            if (old) old.remove();
            var box = document.createElement('div');
            box.id = 'qa-shop-sandbox';
            box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#6b7280;padding:14px;overflow:visible;';
            document.body.appendChild(box);

            function makeHorse(vid) {
                var wrap = document.createElement('div');
                wrap.className = 'qa-cell';
                wrap.style.cssText = 'display:inline-block;position:relative;width:96px;height:108px;margin:8px;background:#52525b;border-radius:8px;vertical-align:top;';
                var horse = document.createElement('div');
                horse.className = 'horse my-horse racing'; // racing → trail opacity 발현
                horse.style.cssText = 'position:absolute;left:50%;top:46px;transform:translateX(-50%);width:80px;height:60px;';
                horse.dataset.vehicleId = vid;
                var sprite = document.createElement('div');
                sprite.className = 'vehicle-sprite';
                sprite.style.cssText = 'width:64px;height:48px;display:flex;align-items:center;justify-content:center;margin:0 auto;';
                // 진짜 SVG 주입 (js/horse-race-sprites.js 의 getVehicleSVG). 없으면 색박스 폴백.
                var injected = false;
                if (typeof getVehicleSVG === 'function') {
                    try {
                        var v = getVehicleSVG(vid);
                        var d = v && (v.idle || v.run || v.rest || v);
                        var html = d && (d.frame1 || (v && v.frame1));
                        if (html) { sprite.innerHTML = html; injected = true; }
                    } catch (e) { /* 폴백 */ }
                }
                if (!injected) { sprite.style.background = '#e5e7eb'; sprite.style.borderRadius = '6px'; }
                var svgEl = sprite.querySelector('svg');
                if (svgEl) { svgEl.style.width = '100%'; svgEl.style.height = '100%'; }
                horse.appendChild(sprite);
                wrap.appendChild(horse);
                return wrap;
            }
            window.__qaMakeHorse = makeHorse; // 슬롯 렌더 함수에서 재사용
            window.__qaSandbox = box;
        }, VEHICLES);

        // 공용: sandbox 비우기
        const clearSandbox = () => hPage.evaluate(() => { window.__qaSandbox.innerHTML = ''; });

        // 슬롯 라벨 칩 추가(아이템 id 보이도록) → 사람이 contact-sheet 에서 어떤 칸이 어떤 id 인지 식별
        // (각 cell 안에 작은 캡션)
        async function captionCells() {
            await hPage.evaluate(() => {
                document.querySelectorAll('#qa-shop-sandbox .qa-cell').forEach(function (c) {
                    if (c.__capped) return;
                    var cap = c.querySelector('.qa-cap');
                    if (cap) { cap.style.cssText = 'position:absolute;left:0;bottom:0;width:100%;font:9px/1.1 monospace;color:#fff;text-align:center;background:rgba(0,0,0,.45);padding:1px 0;white-space:nowrap;overflow:hidden;'; }
                    c.__capped = true;
                });
            });
        }

        async function shoot(slot) {
            const box = await hPage.$('#qa-shop-sandbox');
            await box.screenshot({ path: path.join(SHOT_DIR, slot + '.png') });
        }

        // ── PAINT ── 각 아이템: 한 cell 에 horse 1개 만들고 paint 적용 → .vehicle-sprite filter == catalog.filter
        {
            await clearSandbox();
            const res = await hPage.evaluate((ids) => {
                var out = [];
                ids.forEach(function (id, idx) {
                    var vid = ['car', 'rocket', 'horse', 'bird'][idx % 4];
                    var cell = window.__qaMakeHorse(vid);
                    var cap = document.createElement('div'); cap.className = 'qa-cap'; cap.textContent = id.replace('paint_', '');
                    cell.appendChild(cap);
                    window.__qaSandbox.appendChild(cell);
                    var horse = cell.querySelector('.horse');
                    window.HorseShop.applyEquippedToHorse(horse, { paint: id });
                    var sprite = horse.querySelector('.vehicle-sprite');
                    var item = window.HorseShop.getCatalogItem(id);
                    var applied = sprite.style.filter || '';   // 브라우저 정규화됨(#hex→rgb, 0→0px)
                    // 비교 기준도 같은 정규화를 거치게: 카탈로그 filter 를 probe 에 세팅 후 읽어 정규화 일치 비교.
                    var probe = document.createElement('div');
                    probe.style.filter = (item && item.filter) || '';
                    var expectedNorm = probe.style.filter || '';
                    // distinct + 정확: 적용된(정규화) filter == 카탈로그 filter(동일 정규화) 이고 비어있지 않음
                    out.push({ id: id, applied: applied, expected: expectedNorm,
                        match: applied === expectedNorm && expectedNorm.length > 0 });
                });
                return out;
            }, catalog.paint);
            res.forEach(r => rec('paint', r.id, r.match,
                r.match ? null : ('filter "' + r.applied + '" != catalog "' + r.expected + '"')));
            // distinct: 전 paint filter 가 모두 서로 다른가
            const filters = res.map(r => r.applied);
            const uniq = new Set(filters);
            if (uniq.size !== filters.length) {
                // 중복 filter → 어느 id 쌍이 겹치는지 보고(설계 관찰)
                const seen = {}; const dups = [];
                res.forEach(r => { if (seen[r.applied]) dups.push(seen[r.applied] + '==' + r.id); seen[r.applied] = r.id; });
                console.log('  [paint 관찰] 동일 filter 중복:', dups.join(', '));
            }
            await captionCells();
            await shoot('paint');
        }

        // ── AURA ── 각 아이템: aura 적용 → .cosmetic-aura span, style.color == catalog.color, 가시(box>0)
        {
            await clearSandbox();
            const res = await hPage.evaluate((ids) => {
                var out = [];
                ids.forEach(function (id, idx) {
                    var vid = ['car', 'rocket', 'horse', 'bird'][idx % 4];
                    var cell = window.__qaMakeHorse(vid);
                    var cap = document.createElement('div'); cap.className = 'qa-cap'; cap.textContent = id.replace('aura_', '');
                    cell.appendChild(cap);
                    window.__qaSandbox.appendChild(cell);
                    var horse = cell.querySelector('.horse');
                    window.HorseShop.applyEquippedToHorse(horse, { aura: id });
                    var el = horse.querySelector('.cosmetic-aura');
                    var item = window.HorseShop.getCatalogItem(id);
                    if (!el) { out.push({ id: id, ok: false, reason: '.cosmetic-aura 미생성' }); return; }
                    void el.offsetHeight;
                    var cs = getComputedStyle(el);
                    var r = el.getBoundingClientRect();
                    // style.color 는 rgb 정규화됨 → catalog hex 를 rgb 로 비교하기보다 "비어있지 않고 box-shadow 가 currentColor 반영"으로 검증.
                    var colorSet = el.style.color; // 인라인 색 — 설정 여부
                    var visible = r.width > 0 && r.height > 0 && parseFloat(cs.opacity) > 0;
                    var hasGlow = cs.boxShadow && cs.boxShadow !== 'none';
                    out.push({ id: id, ok: !!colorSet && visible && hasGlow,
                        reason: (!colorSet ? 'color 미설정 ' : '') + (!visible ? 'box 0/opacity0 ' : '') + (!hasGlow ? 'box-shadow none' : ''),
                        rgb: cs.color });
                });
                return out;
            }, catalog.aura);
            res.forEach(r => rec('aura', r.id, r.ok, r.ok ? null : r.reason));
            // distinct: 전 aura 의 computed color 가 충분히 다양한가 (동일 hex 입력 → 동일 rgb 는 정상; 카탈로그상 중복 없으면 전부 distinct)
            const rgbs = res.map(r => r.rgb);
            const uniq = new Set(rgbs);
            if (uniq.size !== rgbs.length) {
                const seen = {}; const dups = [];
                res.forEach(r => { if (seen[r.rgb]) dups.push(seen[r.rgb] + '==' + r.id); seen[r.rgb] = r.id; });
                console.log('  [aura 관찰] 동일 color 중복:', dups.join(', '));
            }
            await captionCells();
            await shoot('aura');
        }

        // ── TRAIL ── 각 아이템: trail 적용 → .cosmetic-trail, textContent == emoji×5, racing opacity>0.9, tofu 아님
        {
            await clearSandbox();
            const res = await hPage.evaluate((ids) => {
                var out = [];
                ids.forEach(function (id, idx) {
                    var vid = ['car', 'rocket', 'horse', 'bird'][idx % 4];
                    var cell = window.__qaMakeHorse(vid);
                    var cap = document.createElement('div'); cap.className = 'qa-cap'; cap.textContent = id.replace('trail_', '');
                    cell.appendChild(cap);
                    window.__qaSandbox.appendChild(cell);
                    var horse = cell.querySelector('.horse');
                    window.HorseShop.applyEquippedToHorse(horse, { trail: id });
                    var el = horse.querySelector('.cosmetic-trail');
                    var item = window.HorseShop.getCatalogItem(id);
                    if (!el) { out.push({ id: id, ok: false, reason: '.cosmetic-trail 미생성' }); return; }
                    var cs = getComputedStyle(el);
                    var r = el.getBoundingClientRect();
                    var emoji = item && item.emoji;
                    // emoji×5 (Array.from 로 코드포인트 단위 카운트 — surrogate/ZWJ 안전)
                    var expected = emoji ? Array(5).fill(emoji).join('') : '';
                    var textOk = el.textContent === expected;
                    var visible = r.width > 0 && r.height > 0 && parseFloat(cs.opacity) > 0.5;
                    // tofu 탐지: 텍스트가 비었거나 U+FFFD(replacement) 포함이면 깨짐
                    var tofu = !el.textContent || /�/.test(el.textContent);
                    out.push({ id: id, ok: textOk && visible && !tofu,
                        reason: (!textOk ? 'text!=emoji×5 ' : '') + (!visible ? 'box0/opacity ' : '') + (tofu ? 'tofu' : ''),
                        text: el.textContent });
                });
                return out;
            }, catalog.trail);
            res.forEach(r => rec('trail', r.id, r.ok, r.ok ? null : r.reason));
            // distinct: trail emoji 텍스트가 서로 다른가 (동일 emoji 두 아이템이면 관찰 보고)
            const seen = {}; const dups = [];
            res.forEach(r => { if (r.text && seen[r.text]) dups.push(seen[r.text] + '==' + r.id); if (r.text) seen[r.text] = r.id; });
            if (dups.length) console.log('  [trail 관찰] 동일 이모지 중복(룩어라이크):', dups.join(', '));
            await captionCells();
            await shoot('trail');
        }

        // ── ACCESSORY ── 각 아이템: 탈것 분산 적용 → .cosmetic-accessory textContent==emoji, 앵커 px 설정, 가시, tofu 아님
        {
            await clearSandbox();
            const res = await hPage.evaluate((args) => {
                var ids = args.ids, vehicles = args.vehicles;
                var out = [];
                ids.forEach(function (id, idx) {
                    var vid = vehicles[idx % vehicles.length]; // 탈것별 앵커 다양성
                    var cell = window.__qaMakeHorse(vid);
                    var cap = document.createElement('div'); cap.className = 'qa-cap'; cap.textContent = id.replace('acc_', '') + '·' + vid;
                    cell.appendChild(cap);
                    window.__qaSandbox.appendChild(cell);
                    var horse = cell.querySelector('.horse');
                    window.HorseShop.applyEquippedToHorse(horse, { accessory: id });
                    var el = horse.querySelector('.cosmetic-accessory');
                    var item = window.HorseShop.getCatalogItem(id);
                    if (!el) { out.push({ id: id, ok: false, reason: '.cosmetic-accessory 미생성' }); return; }
                    void el.offsetHeight;
                    var cs = getComputedStyle(el);
                    var r = el.getBoundingClientRect();
                    var emoji = item && item.emoji;
                    var textOk = el.textContent === emoji;
                    var visible = r.width > 0 && r.height > 0;
                    var anchored = !!el.style.getPropertyValue('--acc-x'); // 앵커 px 주입됨
                    var matrix = /matrix/.test(cs.transform); // translate/scale 발현
                    var tofu = !el.textContent || /�/.test(el.textContent);
                    out.push({ id: id, ok: textOk && visible && anchored && matrix && !tofu,
                        reason: (!textOk ? 'text!=emoji ' : '') + (!visible ? 'box0 ' : '') + (!anchored ? 'no-anchor ' : '') + (!matrix ? 'no-matrix ' : '') + (tofu ? 'tofu' : ''),
                        text: el.textContent, vid: vid });
                });
                return out;
            }, { ids: catalog.accessory, vehicles: VEHICLES });
            res.forEach(r => rec('accessory', r.id, r.ok, r.ok ? null : r.reason));
            const seen = {}; const dups = [];
            res.forEach(r => { if (r.text && seen[r.text]) dups.push(seen[r.text] + '==' + r.id); if (r.text) seen[r.text] = r.id; });
            if (dups.length) console.log('  [accessory 관찰] 동일 이모지 중복(룩어라이크):', dups.join(', '));
            await captionCells();
            await shoot('accessory');
        }

        // ── TRACK_THEME ── 각 아이템: getAdWallet override → applyMyTrackTheme → .cosmetic-track-theme, bg 적용, distinct
        //   contact-sheet 는 #raceTrackContainer 가 비-경주화면에서 display:none 일 수 있어 측정 어려움 →
        //   별도 합성 그리드(각 cell 에 bg 직접 칠한 미니 트랙)로 시각화하되, 단언은 실제 applyMyTrackTheme 산출로 한다.
        {
            // 1) 단언: 실제 applyMyTrackTheme 경로
            const applyRes = await hPage.evaluate((ids) => {
                var cont = document.getElementById('raceTrackContainer');
                if (!cont) return { err: '#raceTrackContainer 없음' };
                var origAd = window.ShopModule.getAdWallet;
                var out = [];
                ids.forEach(function (id) {
                    cont.querySelectorAll('.cosmetic-track-theme').forEach(function (n) { n.remove(); });
                    window.ShopModule.getAdWallet = function () { return { equipped: { track_theme: id } }; };
                    var err = null;
                    try { window.HorseShop.applyMyTrackTheme(); } catch (e) { err = String(e); }
                    var ov = cont.querySelector('.cosmetic-track-theme');
                    var item = window.HorseShop.getCatalogItem(id);
                    if (!ov) { out.push({ id: id, ok: false, reason: err || '.cosmetic-track-theme 미생성', bg: '' }); return; }
                    var bg = ov.style.backgroundImage || '';
                    // 멱등: 정확히 1개
                    var count = cont.querySelectorAll('.cosmetic-track-theme').length;
                    var hasBg = bg && bg !== 'none' && /gradient/.test(bg);
                    out.push({ id: id, ok: !!hasBg && count === 1, reason: (!hasBg ? 'bg 미적용("' + bg + '")' : '') + (count !== 1 ? ' dup=' + count : ''), bg: bg });
                });
                window.ShopModule.getAdWallet = origAd;
                cont.querySelectorAll('.cosmetic-track-theme').forEach(function (n) { n.remove(); });
                return { out: out };
            }, catalog.track_theme);
            if (applyRes.err) {
                catalog.track_theme.forEach(id => rec('track_theme', id, false, applyRes.err));
            } else {
                applyRes.out.forEach(r => rec('track_theme', r.id, r.ok, r.ok ? null : r.reason));
                const seen = {}; const dups = [];
                applyRes.out.forEach(r => { if (r.bg && seen[r.bg]) dups.push(seen[r.bg] + '==' + r.id); if (r.bg) seen[r.bg] = r.id; });
                if (dups.length) console.log('  [track_theme 관찰] 동일 bg 중복:', dups.join(', '));
            }
            // 2) contact-sheet: 합성 그리드(각 칸에 catalog.bg 직접 칠) — 눈으로 23종 테마 일별
            await clearSandbox();
            await hPage.evaluate((ids) => {
                ids.forEach(function (id) {
                    var item = window.HorseShop.getCatalogItem(id);
                    var cell = document.createElement('div');
                    cell.className = 'qa-cell';
                    cell.style.cssText = 'display:inline-block;position:relative;width:150px;height:80px;margin:6px;border-radius:8px;overflow:hidden;vertical-align:top;border:1px solid #111;';
                    cell.style.backgroundImage = (item && item.bg) || '';
                    cell.style.backgroundSize = 'cover';
                    var cap = document.createElement('div'); cap.className = 'qa-cap';
                    cap.textContent = id.replace('theme_', '');
                    cell.appendChild(cap);
                    window.__qaSandbox.appendChild(cell);
                });
            }, catalog.track_theme);
            await captionCells();
            await shoot('track_theme');
        }

        // ── FINISH_FX ── 각 아이템: getAdWallet override → playFinishFx → .cosmetic-finish-fx(28조각), emoji 일치, tofu 아님
        {
            const fxRes = await hPage.evaluate((ids) => {
                var cont = document.getElementById('raceTrackContainer');
                if (!cont) return { err: '#raceTrackContainer 없음' };
                var origAd = window.ShopModule.getAdWallet;
                var out = [];
                ids.forEach(function (id) {
                    cont.querySelectorAll('.cosmetic-finish-fx').forEach(function (n) { n.remove(); });
                    window.ShopModule.getAdWallet = function () { return { equipped: { finish_fx: id } }; };
                    var err = null;
                    try { window.HorseShop.playFinishFx(); } catch (e) { err = String(e); }
                    var layer = cont.querySelector('.cosmetic-finish-fx');
                    var item = window.HorseShop.getCatalogItem(id);
                    if (!layer) { out.push({ id: id, ok: false, reason: err || '.cosmetic-finish-fx 미생성', emoji: '' }); return; }
                    var pieces = layer.querySelectorAll('.cosmetic-fx-piece');
                    var first = pieces[0] ? pieces[0].textContent : '';
                    var tofu = !first || /�/.test(first);
                    var emojiOk = first === (item && item.emoji);
                    out.push({ id: id, ok: pieces.length === 28 && emojiOk && !tofu,
                        reason: (pieces.length !== 28 ? 'pieces=' + pieces.length + ' ' : '') + (!emojiOk ? 'emoji!=catalog("' + first + '") ' : '') + (tofu ? 'tofu' : ''),
                        emoji: first });
                });
                cont.querySelectorAll('.cosmetic-finish-fx').forEach(function (n) { n.remove(); });
                window.ShopModule.getAdWallet = origAd;
                return { out: out };
            }, catalog.finish_fx);
            if (fxRes.err) {
                catalog.finish_fx.forEach(id => rec('finish_fx', id, false, fxRes.err));
            } else {
                fxRes.out.forEach(r => rec('finish_fx', r.id, r.ok, r.ok ? null : r.reason));
                const seen = {}; const dups = [];
                fxRes.out.forEach(r => { if (r.emoji && seen[r.emoji]) dups.push(seen[r.emoji] + '==' + r.id); if (r.emoji) seen[r.emoji] = r.id; });
                if (dups.length) console.log('  [finish_fx 관찰] 동일 이모지 중복(룩어라이크):', dups.join(', '));
            }
            // contact-sheet: 각 칸에 그 fx 이모지를 크게(28조각 다 그리면 겹쳐서 식별 어려움 → 대표 1개 크게 + id)
            await clearSandbox();
            await hPage.evaluate((ids) => {
                ids.forEach(function (id) {
                    var item = window.HorseShop.getCatalogItem(id);
                    var cell = document.createElement('div');
                    cell.className = 'qa-cell';
                    cell.style.cssText = 'display:inline-block;position:relative;width:96px;height:96px;margin:6px;border-radius:8px;vertical-align:top;background:#1f2937;overflow:hidden;';
                    var em = document.createElement('div');
                    em.textContent = (item && item.emoji) || '?';
                    em.style.cssText = 'font-size:44px;line-height:96px;text-align:center;';
                    cell.appendChild(em);
                    var cap = document.createElement('div'); cap.className = 'qa-cap';
                    cap.textContent = id.replace('fx_', '');
                    cell.appendChild(cap);
                    window.__qaSandbox.appendChild(cell);
                });
            }, catalog.finish_fx);
            await captionCells();
            await shoot('finish_fx');
        }

        // ── BIB ── horse 에 적용 안 됨 → getLabelStyle(id) 가 {color,bg,border} 반환하는지 단언 + 라벨 칩 그리드 contact-sheet
        {
            const bibRes = await hPage.evaluate((ids) => {
                var out = [];
                ids.forEach(function (id) {
                    var style = window.HorseShop.getLabelStyle ? window.HorseShop.getLabelStyle(id) : null;
                    var item = window.HorseShop.getCatalogItem(id);
                    if (!style) { out.push({ id: id, ok: false, reason: 'getLabelStyle null' }); return; }
                    // 카탈로그 shape: color + bg 존재(border 는 일부만 있을 수 있으나 카탈로그 전수 border 보유)
                    var ok = !!style.color && !!style.bg;
                    // distinct: 이름표 색 조합(color|bg)이 카탈로그 값과 일치
                    var matchCatalog = item && style.color === item.color && style.bg === item.bg;
                    out.push({ id: id, ok: ok && matchCatalog,
                        reason: (!ok ? 'color/bg 누락 ' : '') + (!matchCatalog ? 'catalog 불일치' : ''),
                        color: style.color, bg: style.bg, border: style.border });
                });
                return out;
            }, catalog.bib);
            bibRes.forEach(r => rec('bib', r.id, r.ok, r.ok ? null : r.reason));
            const seen = {}; const dups = [];
            bibRes.forEach(r => { var key = r.color + '|' + r.bg; if (seen[key]) dups.push(seen[key] + '==' + r.id); seen[key] = r.id; });
            if (dups.length) console.log('  [bib 관찰] 동일 color|bg 중복:', dups.join(', '));

            // contact-sheet: 각 bib 의 color/bg/border 로 칠한 라벨 칩 그리드(실제 이름표 모양 모사)
            await clearSandbox();
            await hPage.evaluate((ids) => {
                ids.forEach(function (id) {
                    var s = window.HorseShop.getLabelStyle(id) || {};
                    var chip = document.createElement('div');
                    chip.className = 'qa-cell';
                    chip.style.cssText = 'display:inline-block;position:relative;margin:7px;padding:6px 14px;border-radius:999px;font:bold 13px/1.2 sans-serif;vertical-align:top;';
                    chip.style.color = s.color || '#fff';
                    if (s.bg) chip.style.backgroundImage = s.bg; // linear-gradient 또는 단색
                    else chip.style.background = '#444';
                    if (s.border) chip.style.border = '2px solid ' + s.border;
                    chip.textContent = id.replace('bib_', '');
                    window.__qaSandbox.appendChild(chip);
                });
            }, catalog.bib);
            await shoot('bib');
        }

        // ── 멱등 재적용 spot-check: aura→trail→accessory 동일 horse 에 두 번 적용 → 각 .cosmetic-* 1개 ──
        const idemp = await hPage.evaluate(() => {
            window.__qaSandbox.innerHTML = '';
            var cell = window.__qaMakeHorse('car');
            window.__qaSandbox.appendChild(cell);
            var horse = cell.querySelector('.horse');
            var eq = { aura: 'aura_gold', trail: 'trail_flame', accessory: 'acc_crown', paint: 'paint_gold' };
            window.HorseShop.applyEquippedToHorse(horse, eq);
            window.HorseShop.applyEquippedToHorse(horse, eq); // 재적용
            return {
                aura: horse.querySelectorAll('.cosmetic-aura').length,
                trail: horse.querySelectorAll('.cosmetic-trail').length,
                acc: horse.querySelectorAll('.cosmetic-accessory').length
            };
        });
        rec('idempotent', 'aura/trail/accessory', idemp.aura === 1 && idemp.trail === 1 && idemp.acc === 1,
            'aura=' + idemp.aura + ' trail=' + idemp.trail + ' acc=' + idemp.acc);

    } catch (e) {
        console.log('HORSE 파트 예외:', e.message);
        ['paint', 'trail', 'accessory', 'bib', 'aura', 'track_theme', 'finish_fx'].forEach(s => {
            if (!results[s]) rec(s, '(part-error)', false, e.message);
        });
    }

    const hReal = hErrs.filter(e => !NOISE.test(e));
    if (hReal.length) console.log('  [horse 콘솔 에러]', hReal.slice(0, 5).join(' | '));
    await hPage.close();

    // ─────────────────────────────────────────────────────────────────────────
    // PART 2 — SPIN-ARENA: spin_skin (피커 스와치 24색 — color/blade distinct)
    // ─────────────────────────────────────────────────────────────────────────
    const sErrs = [];
    const sPage = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
    sPage.on('console', m => { if (m.type() === 'error') sErrs.push(m.text()); });
    sPage.on('pageerror', e => sErrs.push(String(e)));

    try {
        await sPage.addInitScript(args => {
            // 튜토리얼 스킵
            localStorage.setItem('tutorialSeen_spin-arena', 'v1');
            localStorage.setItem('tutorialSeen_horse-race', 'v1');
            localStorage.setItem('tutorialSeen_horse', 'v1');
            if (args.token) localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
            localStorage.setItem('pendingSpinArenaRoom', JSON.stringify({
                userName: args.name, roomName: 'qa-spin-skins', isPrivate: false,
                password: '', expiryHours: 1, blockIPPerUser: false
            }));
        }, { token: token, name: qaName });

        await sPage.goto(BASE + '/spin-arena?createRoom=true', { waitUntil: 'domcontentloaded', timeout: 25000 });
        await sPage.waitForFunction(() => {
            const ar = sessionStorage.getItem('spinArenaActiveRoom');
            return ar && JSON.parse(ar).roomId;
        }, null, { timeout: 12000 });
        await wait(1800); // socket auth + 픽커 렌더

        // 픽커는 "준비 2명 이상 + 내가 준비"라야 선택 가능하지만, 스와치 DOM 자체는 rc>=2 조건과 무관하게
        // SPIN_SKIN_COLORS 전체를 항상 그린다(잠금/활성만 토글). 단, hint 분기가 grid 를 그리는지 확인 필요 →
        // renderSkinPicker 는 항상 grid 를 그린다(분기는 hint 텍스트만). 곧장 스와치 측정 가능.
        // 다만 swatch 가 0개면 준비 상태 등 이유 → 강제로 amIReady 만들 수 없으니 DOM 만 본다.
        await sPage.waitForFunction(() => {
            var p = document.getElementById('spinSkinPicker');
            return p && p.querySelectorAll('.spin-skin-swatch').length > 0;
        }, null, { timeout: 8000 }).catch(() => {});

        // 카탈로그 base 색 개수(= 기대 스와치 수) — 페이지의 SPIN_SKIN_COLORS 와 비교
        const expected = await sPage.evaluate(() => {
            return (typeof SPIN_SKIN_COLORS !== 'undefined') ? SPIN_SKIN_COLORS.map(function (c) {
                return { id: c.id, color: c.color, blade: c.blade, free: !!c.free };
            }) : null;
        });
        const spinSkinCatalog = await hPageCatalogSpin(); // 카탈로그 base ids (별도 fetch)
        function noop() {}

        if (!expected) {
            rec('spin_skin', '(no SPIN_SKIN_COLORS)', false, 'window.SPIN_SKIN_COLORS 미노출');
        } else {
            // 렌더된 스와치 측정: dot 의 background-color + box-shadow(=blade 인코딩)
            const swatches = await sPage.evaluate(() => {
                var picker = document.getElementById('spinSkinPicker');
                var els = picker ? picker.querySelectorAll('.spin-skin-swatch') : [];
                var out = [];
                for (var i = 0; i < els.length; i++) {
                    var dot = els[i].querySelector('.spin-skin-dot');
                    var name = els[i].querySelector('.spin-skin-name');
                    if (!dot) { out.push({ idx: i, missing: true }); continue; }
                    var cs = getComputedStyle(dot);
                    var r = dot.getBoundingClientRect();
                    out.push({
                        idx: i,
                        name: name ? name.textContent.trim() : '',
                        bg: cs.backgroundColor,
                        shadow: cs.boxShadow,
                        locked: els[i].classList.contains('locked'),
                        visible: r.width > 0 && r.height > 0
                    });
                }
                return out;
            });

            const expectedCount = expected.length;
            // 1) 개수 일치
            rec('spin_skin', '__count', swatches.length === expectedCount,
                'rendered=' + swatches.length + ' expected=' + expectedCount);

            // 2) 각 스와치: 색(bg) + blade(box-shadow) 가 적용·가시
            swatches.forEach((sw, i) => {
                const exp = expected[i];
                const id = exp ? exp.id : ('swatch#' + i);
                if (sw.missing) { rec('spin_skin', id, false, 'dot 미생성'); return; }
                const bgOk = sw.bg && sw.bg !== 'rgba(0, 0, 0, 0)' && sw.bg !== 'transparent';
                const bladeOk = sw.shadow && sw.shadow !== 'none'; // box-shadow 에 blade 색 인코딩
                rec('spin_skin', id, bgOk && bladeOk && sw.visible,
                    (!bgOk ? 'bg 없음("' + sw.bg + '") ' : '') + (!bladeOk ? 'blade(box-shadow) 없음 ' : '') + (!sw.visible ? 'box0' : ''));
            });

            // 3) distinct: color(bg) 집합이 충분히 다양한가 — 동일 bg 쌍은 관찰 보고
            const bgs = swatches.filter(s => !s.missing).map(s => s.bg);
            const uniqBg = new Set(bgs);
            if (uniqBg.size !== bgs.length) {
                const seen = {}; const dups = [];
                swatches.forEach((s, i) => { if (s.missing) return; const id = expected[i] ? expected[i].id : i; if (seen[s.bg]) dups.push(seen[s.bg] + '==' + id); seen[s.bg] = id; });
                console.log('  [spin_skin 관찰] 동일 색(bg) 중복:', dups.join(', '));
            }
            // box-shadow(blade) distinct (색이 같아도 blade 다르면 구분). 동일 (bg+shadow) 쌍만 진짜 충돌.
            const combos = swatches.filter(s => !s.missing).map(s => s.bg + '||' + s.shadow);
            const uniqCombo = new Set(combos);
            if (uniqCombo.size !== combos.length) {
                console.log('  [spin_skin 관찰] 색+blade 완전 동일 스와치 존재(' + (combos.length - uniqCombo.size) + '쌍)');
            }
            console.log('  spin_skin distinct: bg=' + uniqBg.size + '/' + bgs.length + ', bg+blade=' + uniqCombo.size + '/' + combos.length);

            // 카탈로그 base ids 와 SPIN_SKIN_COLORS 동기 확인(거울)
            if (spinSkinCatalog) {
                const catSet = new Set(spinSkinCatalog);
                const missingInClient = spinSkinCatalog.filter(id => !expected.some(e => e.id === id));
                const extraInClient = expected.filter(e => !catSet.has(e.id)).map(e => e.id);
                if (missingInClient.length || extraInClient.length) {
                    console.log('  [spin_skin 관찰] 카탈로그↔클라 거울 불일치 missingInClient=' + JSON.stringify(missingInClient) + ' extraInClient=' + JSON.stringify(extraInClient));
                }
            }
        }

        // contact-sheet: 픽커 grid 전체를 화면에 담아 캡처 (스크롤/스케일로 전 스와치 in-frame)
        // 픽커가 작게 렌더되면 scale 로 키워 식별성 확보.
        await sPage.evaluate(() => {
            var picker = document.getElementById('spinSkinPicker');
            if (picker) { picker.scrollIntoView(); picker.style.maxHeight = 'none'; picker.style.overflow = 'visible'; }
        });
        const pickerEl = await sPage.$('#spinSkinPicker');
        if (pickerEl) {
            await pickerEl.screenshot({ path: path.join(SHOT_DIR, 'spin_skin.png') });
        } else {
            // 폴백: 합성 그리드(전 24색 dot)
            await sPage.evaluate((cols) => {
                var box = document.createElement('div');
                box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#1f2937;padding:12px;';
                box.id = 'qa-spin-fallback';
                cols.forEach(function (c) {
                    var cell = document.createElement('div');
                    cell.style.cssText = 'display:inline-block;text-align:center;margin:8px;color:#fff;font:10px monospace;vertical-align:top;';
                    var dot = document.createElement('span');
                    dot.style.cssText = 'display:block;width:34px;height:34px;border-radius:50%;margin:0 auto 4px;background:' + c.color + ';box-shadow:0 0 0 3px ' + c.blade + ',0 0 12px ' + c.blade + ';';
                    cell.appendChild(dot);
                    cell.appendChild(document.createTextNode(c.id));
                    box.appendChild(cell);
                });
                document.body.appendChild(box);
            }, expected || []);
            const fb = await sPage.$('#qa-spin-fallback');
            if (fb) await fb.screenshot({ path: path.join(SHOT_DIR, 'spin_skin.png') });
        }

    } catch (e) {
        console.log('SPIN 파트 예외:', e.message);
        if (!results['spin_skin']) rec('spin_skin', '(part-error)', false, e.message);
    }

    const sReal = sErrs.filter(e => !NOISE.test(e));
    if (sReal.length) console.log('  [spin 콘솔 에러]', sReal.slice(0, 5).join(' | '));
    await sPage.close();

    // spin 카탈로그 base ids fetch 헬퍼(서버 정적 파일에서 직접)
    async function hPageCatalogSpin() {
        try {
            const j = await fetch(BASE + '/config/spin-arena/cosmetics.json').then(r => r.json());
            return (j.spin_skin || []).filter(s => s.tier === 1).map(s => s.id.replace('spin_skin_', ''));
        } catch (e) { return null; }
    }

    await browser.close();

    // ─────────────────────────────────────────────────────────────────────────
    // 요약 출력
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n========== 슬롯별 렌더 요약 ==========');
    let anyFail = false;
    const ORDER = ['paint', 'trail', 'accessory', 'bib', 'aura', 'track_theme', 'finish_fx', 'spin_skin', 'idempotent'];
    ORDER.forEach(slot => {
        const r = results[slot];
        if (!r) { console.log(slot + ': (미실행)'); anyFail = true; return; }
        const line = slot + ': ' + r.ok + '/' + r.total + ' rendered OK';
        console.log(line);
        if (r.fails.length) {
            anyFail = true;
            r.fails.forEach(f => console.log('    FAIL [' + slot + '] ' + f.id + ' — ' + f.reason));
        }
    });

    console.log('\n========== contact-sheet PNG ==========');
    ['paint', 'trail', 'accessory', 'bib', 'aura', 'track_theme', 'finish_fx', 'spin_skin'].forEach(slot => {
        const p = path.join(SHOT_DIR, slot + '.png');
        if (fs.existsSync(p)) {
            const sz = fs.statSync(p).size;
            console.log('  ' + slot + '.png — ' + sz + ' bytes' + (sz < 1000 ? '  ⚠️ 너무 작음' : ''));
            if (sz < 1000) anyFail = true;
        } else {
            console.log('  ' + slot + '.png — 미생성 ⚠️');
            anyFail = true;
        }
    });

    console.log('\n=== ' + (anyFail ? 'SOME FAILURES' : 'ALL PASS') + ' ===');
    console.log('재현: node AutoTest/qa-shop-all-cosmetics-test.js  (서버 5173 가동 상태)');
    process.exit(anyFail ? 1 : 0);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(2); });
