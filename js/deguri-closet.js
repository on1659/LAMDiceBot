/*
 * deguri-closet.js — 데구리 꾸미기 팝업의 [옷장] 탭 본문 (단독판 데구리 옷장 이식, docs/goal/deguri-closet-standalone-port.md)
 *
 * 전역 `DeguriCloset.build(api)` — js/deguri-shop.js 의 hooks.buildClosetBody 가 부른다. api 는 공유 셸(js/shared/shop-shared.js closetApi):
 *   items(slotKey) 그룹 칩·정렬 적용 목록 / owns(item) / isEquipped(slot,id) / equip(slot,id,item) / buy(slot,item) / groupFilter
 *
 * 화면: 위 = 무대(입은 모습을 크게, 동작을 돌아가며 — 누르면 다음 동작) + 이름·상태·버튼 하나
 *       아래 = 보유 N(정렬 전환) · 미보유 N. 미보유 칸은 자물쇠 — 누르면 무대에 입혀 보기만(서버 요청 없음), 무대의 [사기]/[뽑기]로 얻는다.
 * 카드는 상점 탭과 같은 모양(.hshop-card / .hshop-thumb--{rarity} / .hshop-rarity--{rarity}).
 * 장착·구매는 셸 경로 그대로(deguri:equip / 확인 팝업 → deguri:shop:buy → 바로 장착). 공정성: 순수 외형, 난수 없음.
 */
(function () {
    'use strict';

    var SKIN = 'deguri_skin', BALLOON = 'deguri_balloon';
    var SKIN_NONE = 'deguri_skin_none', BALLOON_NONE = 'deguri_balloon_none';
    var ICON_PX = 52;
    var STAGE_PX = 104;          // 무대 칸 표시 크기(시트 칸 160 → 104)
    var MOTION_MS = 2400;        // 동작 하나를 보여 주는 시간
    var TICK_MS = 50;
    var RARITY_RANK = { legend: 4, epic: 3, rare: 2, common: 1 };
    var RARITY_LABEL = { common: '일반', rare: '레어', epic: '에픽', legend: '전설' };
    // 시트 → [렌더러 그룹, 열, 줄]
    var SHEETS = { main: ['creatures', 4, 5], sleep: ['sleep', 4, 1], scuffle: ['scuffle', 4, 2], walk: ['walk', 4, 1] };
    // 동작: intro 를 한 번 보이고 loop 를 되풀이. spin = 공 칸을 굴린다(도/틱)
    var MOTIONS = [
        { sheet: 'main', loop: [[0, 0], [0, 1], [0, 2], [0, 3]], ms: 145 },                                   // 서기
        { sheet: 'walk', loop: [[0, 0], [0, 1], [0, 2], [0, 3]], ms: 160 },                                   // 걷기
        { sheet: 'main', loop: [[3, 2], [3, 3]], ms: 260 },                                                   // 손 흔들기
        { sheet: 'main', intro: [[1, 0], [1, 1], [1, 2], [1, 3]], loop: [[2, 0]], ms: 140, spin: 24 },        // 말아서 구르기
        { sheet: 'main', intro: [[4, 0], [4, 1], [4, 2]], loop: [[4, 3]], ms: 220 },                          // 꽈당 → 어지러움
        { sheet: 'sleep', loop: [[0, 0], [0, 1]], ms: 520 },                                                  // 잠
        { sheet: 'scuffle', loop: [[0, 0], [0, 1], [0, 2], [0, 3]], ms: 180 },                                // 밀기
        { sheet: 'scuffle', loop: [[1, 2], [1, 3]], ms: 300 }                                                 // 앉아서 빙글
    ];

    // 팝업이 열려 있는 동안 유지하는 상태(셸이 장착할 때마다 본문을 새로 그린다)
    var _sel = null;             // 무대에 올린 카드 { slot, item } — null 이면 지금 입은 모습
    var _lastFilter = null;
    var _sort = 'tier', _tierAsc = false;
    var _scrollTop = 0;
    var _motion = 0, _motionAt = 0, _timer = 0;

    function creatures() { return (typeof window.DEGURI_CREATURES !== 'undefined' && window.DEGURI_CREATURES) || []; }
    function creatureName(c) { return (window.DeguriRender && DeguriRender.CREATURE_NAMES && DeguriRender.CREATURE_NAMES[c]) || c; }
    function myCreature() { var picks = (window.deguriState && deguriState.picks) || {}; return picks[window.currentUser] || null; }
    function equippedSkinFor(c) { return window.DeguriShop ? DeguriShop.getEquippedSkinFor(c) : null; }
    function equippedBalloon() {
        var eq = (window.ShopModule && ShopModule.getEquipped()) || {};
        var id = eq[BALLOON];
        var item = id && id !== BALLOON_NONE ? ShopModule.getCatalogItem(id) : null;
        return item && item.sprite ? item : null;
    }
    // 이모지(🪙·🔒)는 사이트 공용 아이콘으로(js/shared/ui-icons.js) — 상점 탭과 같은 그림
    function setText(el, text) { if (window.UIIcons) UIIcons.setIconText(el, text); else el.textContent = text; }
    function reducedMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }

    // 동물 칩이 골라져 있으면 그 동물, 아니면 내가 고른 동물, 아니면 첫 동물
    function stageCreature(api) {
        if (api.groupFilter && api.groupFilter !== 'all') return api.groupFilter;
        return myCreature() || creatures()[0] || 'hedgehog';
    }
    function baseItem(c) { return { id: SKIN_NONE, creature: c, name: creatureName(c), rarity: 'common', base: true }; }

    // ── 무대 ──
    function stageLook(api) {
        var c = stageCreature(api), skin = equippedSkinFor(c), balloon = equippedBalloon();
        if (_sel && _sel.slot === SKIN) { c = _sel.item.creature; skin = _sel.item.base ? null : _sel.item.skin; }
        if (_sel && _sel.slot === BALLOON) balloon = _sel.item.sprite ? _sel.item : null;
        return { creature: c, look: skin ? c + '-' + skin : c, balloon: balloon };
    }
    function stageSubject(api) {
        if (_sel) return _sel;
        var c = stageCreature(api), skin = equippedSkinFor(c);
        var item = skin ? ShopModule.getCatalogItem('deguri_skin_' + c + '_' + skin) : null;
        return { slot: SKIN, item: item || baseItem(c) };
    }
    function drawFrame(view, look, now) {
        var m = MOTIONS[_motion % MOTIONS.length], sh = SHEETS[m.sheet];
        var t = Math.max(0, now - _motionAt), step = Math.floor(t / m.ms);
        var intro = m.intro || [], cell, n = 0;
        if (step < intro.length) cell = intro[step];
        else { n = step - intro.length; cell = m.loop[n % m.loop.length]; }
        var url = DeguriRender.sheetUrl(look, sh[0]);
        if (view._url !== url) { view._url = url; view.style.backgroundImage = 'url("' + url + '")'; view.style.backgroundSize = (sh[1] * STAGE_PX) + 'px ' + (sh[2] * STAGE_PX) + 'px'; }
        view.style.backgroundPosition = (-cell[1] * STAGE_PX) + 'px ' + (-cell[0] * STAGE_PX) + 'px';
        var fit = m.sheet === 'scuffle' ? DeguriRender.poseFit(look, 'scuffle') : 1;   // 서기보다 크게 그려진 몸싸움 그림은 발 기준으로 줄인다(동물 마당과 같은 식)
        var rot = m.spin && step >= intro.length ? n * m.spin : 0;
        view.style.transform = (fit < 1 ? 'translateY(' + (STAGE_PX * 70 / 160 * (1 - fit)).toFixed(1) + 'px) scale(' + fit.toFixed(3) + ') ' : '') + (rot ? 'rotate(' + rot + 'deg)' : '');
    }
    function startTimer(view, look) {
        if (_timer) clearInterval(_timer);
        _timer = 0;
        if (!_motionAt) _motionAt = performance.now();
        drawFrame(view, look, performance.now());
        if (reducedMotion()) return;
        _timer = setInterval(function () {
            if (!document.body.contains(view)) { clearInterval(_timer); _timer = 0; return; }   // 팝업을 닫았거나 다시 그렸다
            var now = performance.now();
            if (now - _motionAt >= MOTION_MS) { _motion = (_motion + 1) % MOTIONS.length; _motionAt = now; }
            drawFrame(view, look, now);
        }, TICK_MS);
    }

    function buildStage(api) {
        var lk = stageLook(api), sub = stageSubject(api), item = sub.item;
        var stage = document.createElement('div');
        stage.className = 'dcl-stage';

        var box = document.createElement('button');
        box.type = 'button'; box.className = 'dcl-stage-view';
        box.setAttribute('aria-label', '다음 동작 보기');
        var view = document.createElement('div');
        view.className = 'dcl-stage-sprite';
        box.appendChild(view);
        if (lk.balloon && window.deguriRendererForShop) {
            var bc = document.createElement('canvas');
            bc.width = 30; bc.height = 40; bc.className = 'dcl-stage-balloon';
            window.deguriRendererForShop.drawBalloonIcon(bc, lk.balloon.sprite);
            box.appendChild(bc);
        }
        box.addEventListener('click', function () { _motion = (_motion + 1) % MOTIONS.length; _motionAt = performance.now(); drawFrame(view, lk.look, _motionAt); });
        stage.appendChild(box);

        var info = document.createElement('div');
        info.className = 'dcl-stage-info';
        var nm = document.createElement('div');
        nm.className = 'dcl-stage-name';
        nm.textContent = item.displayName || item.name || '';
        info.appendChild(nm);

        var owned = item.base || item.defaultOwned || api.owns(item);
        var worn = isWorn(api, sub.slot, item);
        var status = document.createElement('div');
        status.className = 'dcl-stage-status';
        if (!item.base && !item.defaultOwned) {
            var pill = document.createElement('span');
            pill.className = 'hshop-rarity hshop-rarity--' + (item.rarity || 'common');
            pill.textContent = RARITY_LABEL[item.rarity] || '';
            status.appendChild(pill);
        }
        var st = document.createElement('span');
        setText(st, worn ? '입는 중' : owned ? '보유' : '🔒 미보유');
        status.appendChild(st);
        info.appendChild(status);

        var acts = document.createElement('div');
        acts.className = 'dcl-stage-acts';
        if (!owned) {
            if (Number.isFinite(item.price)) {
                var buy = document.createElement('button');
                buy.type = 'button'; buy.className = 'dcl-btn dcl-btn--buy';
                setText(buy, '🪙 ' + item.price + ' 사기');
                buy.addEventListener('click', function () { api.buy(sub.slot, item); });
                acts.appendChild(buy);
            }
            if (window.DeguriGacha) {
                var g = document.createElement('button');
                g.type = 'button'; g.className = 'dcl-btn';
                g.textContent = '뽑기';
                g.addEventListener('click', function () { if (window.DeguriShop) DeguriShop.closeShop(); DeguriGacha.open(); });
                acts.appendChild(g);
            }
        } else if (!worn) {
            var wear = document.createElement('button');
            wear.type = 'button'; wear.className = 'dcl-btn dcl-btn--wear';
            wear.textContent = '입기';
            wear.addEventListener('click', function () { wearItem(api, sub.slot, item); });
            acts.appendChild(wear);
        }
        if (acts.childNodes.length) info.appendChild(acts);
        stage.appendChild(info);

        startTimer(view, lk.look);
        return stage;
    }

    // ── 장착 ──
    function isWorn(api, slot, item) {
        if (slot === SKIN) return item.base ? !equippedSkinFor(item.creature) : api.isEquipped(SKIN, item.id);
        if (item.id === BALLOON_NONE) return !equippedBalloon();
        return api.isEquipped(BALLOON, item.id);
    }
    function wearItem(api, slot, item) {
        if (isWorn(api, slot, item)) return;
        if (slot === SKIN && item.base) api.equip(SKIN, null, item);            // 그 동물 스킨만 벗는다(어댑터가 creature 를 실어 보낸다)
        else if (item.id === BALLOON_NONE) api.equip(BALLOON, null, item);
        else api.equip(slot, item.id, item);
    }
    // 보유 칸 누르기 — 안 입었으면 입고, 입은 스킨을 다시 누르면 기본으로(지금 옷장과 같은 토글)
    function onOwnedClick(api, slot, item) {
        _sel = { slot: slot, item: item };
        if (!isWorn(api, slot, item)) return wearItem(api, slot, item);
        if (slot === SKIN && !item.base) { _sel = { slot: SKIN, item: baseItem(item.creature) }; return api.equip(SKIN, null, item); }
        if (slot === BALLOON && item.id !== BALLOON_NONE) return api.equip(BALLOON, null, item);
        api.rerender();
    }

    // ── 목록 ──
    function listItems(api) {
        var skins = api.items(SKIN).filter(function (it) { return it.id !== SKIN_NONE; });
        // 기본 모습 칸은 무대 동물(동물 칩 또는 내 동물) 하나만 — 동물마다 하나씩 열 칸이면 전부 '입는 중'이라 시끄럽다
        var bases = [baseItem(stageCreature(api))];
        var all = bases.map(function (it) { return { slot: SKIN, item: it }; })
            .concat(skins.map(function (it) { return { slot: SKIN, item: it }; }))
            .concat(api.items(BALLOON).map(function (it) { return { slot: BALLOON, item: it }; }));
        var owned = [], locked = [];
        all.forEach(function (e) { (e.item.base || api.owns(e.item) ? owned : locked).push(e); });
        return { owned: sortList(owned), locked: sortList(locked) };
    }
    function sortList(list) {
        var order = creatures();
        function kind(e) { return e.slot === SKIN ? (e.item.base ? 0 : 1) : (e.item.defaultOwned ? 2 : 3); }   // 기본 모습 → 스킨 → 야식 없음 → 야식
        return list.map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) {
            var x = a.e, y = b.e;
            var d = kind(x) - kind(y);
            if (d) return d;
            if (_sort === 'name') return String(x.item.name || '').localeCompare(String(y.item.name || ''), 'ko') || a.i - b.i;
            d = (RARITY_RANK[y.item.rarity] || 0) - (RARITY_RANK[x.item.rarity] || 0);
            if (d) return _tierAsc ? -d : d;
            return (order.indexOf(x.item.creature) - order.indexOf(y.item.creature)) || a.i - b.i;
        }).map(function (o) { return o.e; });
    }
    function iconFor(e) {
        var R = window.deguriRendererForShop, it = e.item;
        var cv = document.createElement('canvas');
        cv.width = ICON_PX; cv.height = ICON_PX; cv.className = 'mshop-icon';
        if (R && it.creature) R.drawCreatureIcon(cv, it.creature, 0, it.base ? null : it.skin);
        else if (R && it.sprite) R.drawBalloonIcon(cv, it.sprite);
        else { var g = document.createElement('span'); g.className = 'mshop-glyph'; g.textContent = it.emoji || '🐾'; return g; }
        return cv;
    }
    function card(api, e, locked) {
        var it = e.item, worn = !locked && isWorn(api, e.slot, it);
        var preview = _sel && _sel.slot === e.slot && _sel.item.id === it.id && (!it.base || _sel.item.creature === it.creature);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'hshop-card dcl-card' + (worn ? ' is-worn' : '') + (locked ? ' is-locked' : '') + (preview ? ' is-preview' : '');
        b.setAttribute('aria-pressed', worn ? 'true' : 'false');
        var rarity = it.rarity || 'common';
        var thumb = document.createElement('div');
        thumb.className = 'hshop-thumb hshop-thumb--' + rarity;
        if (!it.base && !it.defaultOwned) {
            var badge = document.createElement('span');
            badge.className = 'hshop-rarity hshop-rarity--' + rarity;
            badge.textContent = RARITY_LABEL[rarity] || rarity;
            thumb.appendChild(badge);
        }
        var box = document.createElement('div');
        box.className = 'mshop-preview';
        box.appendChild(iconFor(e));
        thumb.appendChild(box);
        if (locked) { var lk = document.createElement('span'); lk.className = 'dcl-lock'; setText(lk, '🔒'); lk.setAttribute('aria-hidden', 'true'); thumb.appendChild(lk); }
        if (worn) { var on = document.createElement('span'); on.className = 'dcl-on'; on.textContent = '입는 중'; thumb.appendChild(on); }
        var nm = document.createElement('div');
        nm.className = 'hshop-name';
        nm.textContent = it.base ? creatureName(it.creature) : (it.name || '');
        b.appendChild(thumb); b.appendChild(nm);
        b.setAttribute('aria-label', nm.textContent + (locked ? ' — 미보유, 미리 보기' : worn ? ' — 입는 중' : ' — 입기'));
        b.addEventListener('click', function () {
            if (locked) { _sel = e; api.rerender(); return; }   // 미리 보기만 — 서버 요청 없음
            onOwnedClick(api, e.slot, it);
        });
        return b;
    }
    function groupHead(label, n, extra) {
        var h = document.createElement('div');
        h.className = 'dcl-group';
        var t = document.createElement('span');
        t.className = 'dcl-group-title';
        t.textContent = label + ' ' + n;
        h.appendChild(t);
        if (extra) h.appendChild(extra);
        return h;
    }
    function sortControl(api) {
        var wrap = document.createElement('div');
        wrap.className = 'dcl-sort';
        var tier = document.createElement('button');
        tier.type = 'button'; tier.className = 'dcl-sort-btn' + (_sort === 'tier' ? ' is-active' : '');
        tier.textContent = _tierAsc ? '등급 낮은순 ▴' : '등급 높은순 ▾';
        tier.addEventListener('click', function () { if (_sort === 'tier') _tierAsc = !_tierAsc; else _sort = 'tier'; api.rerender(); });
        var name = document.createElement('button');
        name.type = 'button'; name.className = 'dcl-sort-btn' + (_sort === 'name' ? ' is-active' : '');
        name.textContent = '이름순';
        name.addEventListener('click', function () { if (_sort === 'name') return; _sort = 'name'; api.rerender(); });
        wrap.appendChild(tier); wrap.appendChild(name);
        return wrap;
    }

    function build(api) {
        var filterKey = api.groupFilter;
        if (filterKey !== _lastFilter) {   // 칩을 바꾸면 무대는 그 칩의 지금 입은 모습으로, 목록은 맨 위로
            if (_lastFilter !== null) { _sel = null; _scrollTop = 0; }
            _lastFilter = filterKey;
        }
        var root = document.createElement('div');
        root.className = 'hshop-inv-body dcl-body';
        root.appendChild(buildStage(api));

        var list = document.createElement('div');
        list.className = 'dcl-list';
        var groups = listItems(api);
        list.appendChild(groupHead('보유', groups.owned.length, sortControl(api)));
        var g1 = document.createElement('div');
        g1.className = 'hshop-grid hshop-inv-grid';
        groups.owned.forEach(function (e) { g1.appendChild(card(api, e, false)); });
        list.appendChild(g1);
        if (groups.locked.length) {
            list.appendChild(groupHead('미보유', groups.locked.length));
            var g2 = document.createElement('div');
            g2.className = 'hshop-grid hshop-inv-grid';
            groups.locked.forEach(function (e) { g2.appendChild(card(api, e, true)); });
            list.appendChild(g2);
        }
        list.addEventListener('scroll', function () { _scrollTop = list.scrollTop; }, { passive: true });
        root.appendChild(list);
        // 셸이 본문을 붙인 뒤에 스크롤을 되돌린다(장착할 때마다 새로 그려도 보던 자리에)
        requestAnimationFrame(function () { if (list.isConnected) list.scrollTop = _scrollTop; });
        return root;
    }

    // 팝업을 새로 열면 처음 상태로(무대 = 지금 입은 모습, 맨 위). 정렬은 열려 있는 동안만이 아니라 페이지 동안 유지
    function reset() { _sel = null; _lastFilter = null; _scrollTop = 0; _motion = 0; _motionAt = performance.now(); }

    window.DeguriCloset = { build: build, reset: reset };
})();
