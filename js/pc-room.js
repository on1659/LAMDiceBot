/* PC (>760px) room presentation only — direction B "people-first, 3 columns".
 * Moves the native elements into left (people) / center (stage) / right (chat·orders·history) columns
 * and puts them back when the viewport drops to phone width. Game JS keeps owning every element. */
(function () {
    'use strict';
    const MOBILE_WIDTH = 760;
    const SYNC_MS = 150;
    // Stage fit: the game fills the free height; what does not fit becomes filler bars.
    const HORSE_LAYOUT_W = 600;      // horse track keeps one layout width and is scaled (camera coordinates never change)
    const HORSE_BTN_ROW = 32;        // the track's top button row sits above the wrapper (css/horse-race.css .track-top-btn-row)
    const HORSE_SCALE_MAX = 1.6;
    const DEGURI_RATIO_NATIVE = 0.72, DEGURI_RATIO_MIN = 0.55, DEGURI_RATIO_MAX = 1.78;   // native = js/deguri-render.js DESKTOP_ASPECT; a short wide window may go below it mid-race; max = the phone ratio
    const WHEEL_MIN = 280, WHEEL_MAX = 680, WHEEL_GAP = 16;
    const RANK_SLIDE_MS = 320;
    const media = matchMedia('(max-width: ' + MOBILE_WIDTH + 'px)');
    const landscapeMedia = matchMedia('(orientation: landscape) and (max-height: ' + MOBILE_WIDTH + 'px) and (pointer: coarse)');
    const byId = id => document.getElementById(id);
    const game = byId('deguriCanvas') ? 'deguri' : byId('raceTrack') ? 'horse' : byId('rouletteWheel') ? 'roulette' : 'dice';
    const isDice = game === 'dice';
    const TABS = isDice ? [['orders', '주문'], ['history', '기록']] : [['chat', '채팅'], ['orders', '주문'], ['history', '기록']];
    const moved = [];
    let enabled = false, timer = null, top = null, grid = null, leftColumn = null, panels = null, tabButtons = null, menu = null, currentTab = '';
    let userPickedTab = false, lastPhase = '';
    let fit = null, fitBox = null, fitInner = null, fitObserver = null;

    const node = (tag, attrs, text) => {
        const element = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([key, value]) => element.setAttribute(key, value));
        if (text) element.textContent = text;
        return element;
    };
    // Horse can lift its track into fullscreen / PiP and leaves a placeholder; move whatever holds the native slot.
    function anchor(target) {
        if (target._canvasPlaceholder?.parentNode) return target._canvasPlaceholder;
        if (target.id === 'raceTrackWrapper' && typeof _racePipPlaceholder !== 'undefined' && _racePipPlaceholder?.parentNode) return _racePipPlaceholder;
        if (target.id === 'raceTrackWrapper' && target.closest('#raceFsStage')) return target.closest('#raceFsStage');
        return target;
    }
    function relocate(target, destination) {
        if (!target || moved.some(entry => entry.target === target)) return;
        const marker = document.createComment('pc-room: original position');
        const slot = anchor(target);
        slot.before(marker);
        destination.append(slot);
        moved.push({ target, marker });
    }
    function active() { return !!byId('gameSection')?.classList.contains('active'); }
    function phoneMatches() { return media.matches || landscapeMedia.matches; }

    function showTab(key, byUser) {
        if (!panels) return;
        currentTab = key;
        if (byUser) userPickedTab = true;
        tabButtons.forEach(button => {
            const on = button.dataset.tab === key;
            button.setAttribute('aria-selected', String(on));
            button.tabIndex = on ? 0 : -1;
        });
        panels.forEach((panel, panelKey) => { panel.hidden = panelKey !== key; });
        if (key === 'chat') {
            const messages = byId('chatMessages');
            if (messages) messages.scrollTop = messages.scrollHeight;
        }
    }
    function buildRight(right) {
        const tabs = node('div', { class: 'pc-room-tabs', role: 'tablist', 'aria-label': '채팅·주문·기록' });
        panels = new Map(); tabButtons = [];
        TABS.forEach(([key, label]) => {
            const button = node('button', { type: 'button', role: 'tab', id: 'pcRoomTab-' + key, 'data-tab': key, 'aria-controls': 'pcRoomPanel-' + key }, label);
            button.addEventListener('click', () => showTab(key, true));
            button.addEventListener('keydown', event => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                const index = TABS.findIndex(([tab]) => tab === key);
                const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
                showTab(next, true);
                byId('pcRoomTab-' + next).focus();
            });
            tabs.append(button); tabButtons.push(button);
            const panel = node('div', { class: 'pc-room-panel', role: 'tabpanel', id: 'pcRoomPanel-' + key, 'aria-labelledby': 'pcRoomTab-' + key, 'data-panel': key });
            panels.set(key, panel);
        });
        right.append(tabs, ...panels.values());
        if (!isDice) relocate(byId('chatMessages')?.closest('.chat-section'), panels.get('chat'));
        relocate(byId('ordersSection'), panels.get('orders'));
        relocate(byId('historySection') || byId('historyList')?.closest('.history-section'), panels.get('history'));
    }
    function buildTop(gameSection) {
        top = node('div', { id: 'pcRoomTop', role: 'banner' });
        const logo = node('a', { class: 'pc-room-logo', href: '/mobile', 'aria-label': 'LAMDICE 홈' });
        logo.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/><circle cx="16" cy="10.5" r="1" fill="currentColor"/><circle cx="12" cy="6.5" r="1" fill="currentColor"/></svg><span>LAMDICE</span>';
        const inner = node('div', { class: 'pc-room-top-inner' });
        const bar = node('div', { class: 'pc-room-top-bar' });
        inner.append(logo, bar);
        const menuButton = node('button', { type: 'button', id: 'pcRoomMenuButton', 'aria-expanded': 'false', 'aria-controls': 'pcRoomMenu' }, '메뉴');
        menu = node('div', { id: 'pcRoomMenu', hidden: '' });
        menuButton.addEventListener('click', () => {
            menu.hidden = !menu.hidden;
            menuButton.setAttribute('aria-expanded', String(!menu.hidden));
        });
        document.addEventListener('click', closeMenuOutside, true);
        document.addEventListener('keydown', closeMenuOnEscape);
        const menuWrap = node('div', { class: 'pc-room-menu-wrap' });
        menuWrap.append(menuButton, menu);
        inner.append(menuWrap);
        top.append(inner);
        gameSection.prepend(top);
        relocate(byId('controlBarMount'), bar);
        relocate(document.querySelector('#controlBarMount .control-bar-meta'), menu);
    }
    function closeMenuOutside(event) {
        if (!menu || menu.hidden || event.target.closest('.pc-room-menu-wrap')) return;
        menu.hidden = true; byId('pcRoomMenuButton')?.setAttribute('aria-expanded', 'false');
    }
    function closeMenuOnEscape(event) {
        if (event.key !== 'Escape' || !menu || menu.hidden) return;
        menu.hidden = true;
        const button = byId('pcRoomMenuButton');
        button?.setAttribute('aria-expanded', 'false'); button?.focus();
    }
    function build() {
        const gameSection = byId('gameSection');
        buildTop(gameSection);
        grid = node('div', { id: 'pcRoomGrid' });
        const left = node('aside', { id: 'pcRoomLeft', 'aria-label': '참여자' });
        leftColumn = left;
        const center = node('div', { id: 'pcRoomCenter' });
        const right = node('aside', { id: 'pcRoomRight', 'aria-label': '채팅·주문·기록' });
        grid.append(left, center, right);
        top.after(grid);

        // Left — people.
        relocate(byId('roomExpirySection'), left);
        relocate(byId('usersList')?.closest('.users-section'), left);
        relocate(byId('readySection'), left);
        relocate(byId('horseShopMount') || byId('deguriShopMount'), left);

        // Center — picker, stage, one action row.
        const stage = node('div', { id: 'pcRoomStage' });
        const actions = node('div', { id: 'pcRoomActions' });
        if (isDice) {
            relocate(byId('gameRulesSection'), center);
            center.append(stage);
            ['gameStatus', 'scheduleNotice', 'progressSection', 'notRolledSection'].forEach(id => relocate(byId(id), stage));
            relocate(document.querySelector('.chat-history-wrapper'), stage);
        } else {
            relocate(byId('horseSelectionSection'), center);
            relocate(byId('deguriPickSection'), center);
            relocate(byId('rankVoteSection'), center);
            center.append(stage);
            ['rouletteScheduleStatus', 'gameStatus', 'targetRankBanner', 'targetRankReason'].forEach(id => relocate(byId(id), stage));
            fit = node('div', { id: 'pcRoomFit' });
            stage.append(fit);
            if (game === 'horse') {
                fitBox = node('div', { id: 'pcRoomFitBox' });
                fitInner = node('div', { id: 'pcRoomFitInner' });
                fitBox.append(fitInner); fit.append(fitBox);
                relocate(byId('raceTrackWrapper'), fitInner);
            } else relocate(byId('deguriStage') || byId('rouletteContainer'), fit);
            fitObserver = new ResizeObserver(fitStage);
            fitObserver.observe(fit);
            // Roulette's winner popup becomes a line right under the wheel (css/pc-room.css).
            if (game === 'roulette') relocate(byId('resultOverlay'), stage);
            ['turboSettingSection', 'replaySection', 'endGameSection'].forEach(id => relocate(byId(id), stage));
        }
        // Horse shows only the picker while waiting, so its one action sits right under it.
        if (game === 'horse') stage.before(actions); else center.append(actions);
        relocate(byId('readyButton'), actions);
        relocate(byId('scheduleOpenRow'), actions);
        relocate(byId('hostControls'), actions);

        buildRight(right);
        showTab(TABS[0][0]);
        document.body.classList.add('pc-room', 'pc-room-' + game);
    }
    function restore() {
        document.removeEventListener('click', closeMenuOutside, true);
        document.removeEventListener('keydown', closeMenuOnEscape);
        moved.splice(0).reverse().forEach(({ target, marker }) => {
            if (!marker.parentNode) return;
            // A horse track lifted into fullscreen/PiP keeps its own placeholder chain; only return what we moved.
            const slot = anchor(target);
            marker.replaceWith(slot);
        });
        fitObserver?.disconnect();
        byId('deguriCanvasBox')?.style.removeProperty('--deguri-view-height-ratio');
        document.body.style.removeProperty('--pc-wheel');
        stopRankSlide();
        top?.remove(); grid?.remove();
        top = grid = leftColumn = panels = tabButtons = menu = fit = fitBox = fitInner = fitObserver = null;
        currentTab = ''; userPickedTab = false; lastPhase = '';
        document.body.classList.remove('pc-room', 'pc-room-' + game);
        byId('readyButton')?.classList.remove('pc-room-primary');
        document.body.removeAttribute('data-pc-phase');
        document.documentElement.style.removeProperty('--pc-room-bottom');
    }
    function enable() {
        if (enabled) return;
        enabled = true;
        build();
    }
    function disable() {
        if (!enabled) return;
        enabled = false;
        restore();
    }
    function running() {
        if (game === 'horse') return typeof isRaceActive !== 'undefined' && !!isRaceActive;
        if (game === 'deguri') return typeof isDeguriActive !== 'undefined' && !!isDeguriActive;
        if (game === 'roulette') return typeof isSpinning !== 'undefined' && !!isSpinning;
        return typeof isGameActive !== 'undefined' && !!isGameActive;
    }
    function visible(element) {
        return !!element && element.isConnected && getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0;
    }
    function result() {
        return byId('resultOverlay')?.classList.contains('visible') || visible(byId('endGameSection')) || visible(byId('deguriAfterRace')) || visible(byId('replaySection'));
    }
    function sync() {
        timer = null;
        const want = !phoneMatches() && active();
        if (want) enable(); else disable();
        if (!enabled) return;
        const isRunning = running();
        const phase = isRunning ? 'running' : result() ? 'result' : 'wait';
        if (phase !== lastPhase) {
            lastPhase = phase;
            document.body.dataset.pcPhase = phase;
            // Result → show the record unless the viewer already chose a tab.
            if (phase === 'result' && !userPickedTab) showTab('history');
            if (phase === 'result' && game === 'roulette') byId('resultOverlay')?.scrollIntoView({ block: 'nearest' });
        }
        // Horse builds its live ranking lazily (inside the record panel); during a race it belongs on the left.
        const live = byId('liveRankingPanel');
        if (live && leftColumn) { relocate(live, leftColumn); if (live.parentNode === leftColumn && leftColumn.firstChild !== live) leftColumn.prepend(live); }
        if (game === 'horse') { if (phase === 'wait') slides.clear(); watchRankSlide(); }
        // Ready list folds into badges on the one people list.
        const readyNames = new Set(Array.from(document.querySelectorAll('#readyUsersList [data-user-name]'), tag => tag.dataset.userName));
        document.querySelectorAll('#usersList .user-tag[data-user-name]').forEach(tag => {
            const isReady = readyNames.has(tag.dataset.userName);
            if (tag.hasAttribute('data-pc-ready') !== isReady) tag.toggleAttribute('data-pc-ready', isReady);
        });
        const ready = byId('readyButton');
        if (ready) ready.classList.toggle('pc-room-primary', ready.textContent.trim() === '준비');
        // Keep the bottom sticky ad from covering the columns.
        const bottom = Math.ceil(Math.max(0, ...Array.from(document.querySelectorAll('.ad-sticky'), sticky => visible(sticky) ? sticky.getBoundingClientRect().height : 0)));
        const value = bottom + 'px';
        if (document.documentElement.style.getPropertyValue('--pc-room-bottom') !== value) document.documentElement.style.setProperty('--pc-room-bottom', value);
        fitStage();
    }
    // Make the game as large as the free stage height allows.
    function fitStage() {
        if (!fit || !fit.isConnected) return;
        const width = fit.clientWidth, height = fit.clientHeight;
        if (!width || !height) return;
        if (game === 'horse') {
            const wrapper = byId('raceTrackWrapper');
            const natural = fitInner.offsetHeight;
            const lifted = !wrapper || !fitInner.contains(wrapper) || !visible(wrapper);
            // Never smaller than the native track: while the picker takes the height, the column scrolls instead.
            const scale = lifted || natural < 60 ? 1 : Math.max(1, Math.min(width / HORSE_LAYOUT_W, height / natural, HORSE_SCALE_MAX));
            fit.style.minHeight = lifted ? '' : natural + 'px';
            fitInner.style.transform = scale === 1 ? '' : 'scale(' + scale.toFixed(4) + ')';
            fitBox.style.width = Math.floor(HORSE_LAYOUT_W * scale) + 'px';
            fitBox.style.height = lifted ? '' : Math.floor(natural * scale) + 'px';
            return;
        }
        // Deguri / roulette size themselves: free height = what the stage grew by, minus what overflows the column.
        const center = byId('pcRoomCenter');
        const outer = child => { const style = getComputedStyle(child); return child.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom); };
        const spareOf = child => (child ? height - outer(child) : 0) + Math.min(0, center.clientHeight - center.scrollHeight);
        if (game === 'deguri') {
            const box = byId('deguriCanvasBox'), canvas = byId('deguriCanvas'), stageEl = byId('deguriStage');
            if (!box || !canvas || !stageEl || !visible(canvas) || !fit.contains(box) || !box.clientWidth) return;
            // Only a running race trades height for width below the native ratio; while picking, the column scrolls instead.
            const floor = document.body.dataset.pcPhase === 'running' ? DEGURI_RATIO_MIN : DEGURI_RATIO_NATIVE;
            const ratio = Math.min(DEGURI_RATIO_MAX, Math.max(floor, (canvas.offsetHeight + spareOf(stageEl)) / box.clientWidth));
            const current = parseFloat(box.style.getPropertyValue('--deguri-view-height-ratio')) || 0;
            // js/deguri-render.js sizes the canvas only on window resize — also nudge it when the column width changed.
            if (Math.abs(ratio - current) < 0.01 && Math.abs(canvas.offsetWidth - box.clientWidth) < 2) return;
            box.style.setProperty('--deguri-view-height-ratio', ratio.toFixed(4));
            window.dispatchEvent(new Event('resize'));
        } else if (game === 'roulette') {
            const container = byId('rouletteContainer'), wheel = container?.querySelector('.roulette-wrapper');
            if (!wheel || !visible(wheel)) return;
            const size = Math.round(Math.min(WHEEL_MAX, Math.max(WHEEL_MIN, Math.min(width - WHEEL_GAP, wheel.offsetHeight + spareOf(container)))));
            const value = size + 'px';
            if (document.body.style.getPropertyValue('--pc-wheel') !== value) document.body.style.setProperty('--pc-wheel', value);
        }
    }
    // Horse live ranking: rows are rebuilt every 100ms (js/horse-race.js updateLiveRanking); slide each vehicle
    // from where it was drawn to its new place instead of jumping. Keyed by the vehicle thumbnail (unique per race).
    const slides = new Map();
    let slideFrame = 0, rankObserver = null;
    function rankRows() {
        const list = byId('liveRankingList');
        return list ? Array.from(list.children).map(row => ({ row, key: row.children[1]?.innerHTML || row.textContent })) : [];
    }
    function paintRankSlide() {
        slideFrame = 0;
        const now = performance.now();
        let moving = false;
        rankRows().forEach(({ row, key }) => {
            const slide = slides.get(key);
            if (!slide) return;
            const t = Math.min(1, (now - slide.start) / RANK_SLIDE_MS);
            const eased = 1 - Math.pow(1 - t, 3);
            const y = slide.from + (slide.to - slide.from) * eased;
            row.style.transform = Math.abs(y - slide.to) < 0.5 ? '' : 'translateY(' + (y - slide.to).toFixed(1) + 'px)';
            slide.at = y;
            if (t < 1) moving = true;
        });
        if (moving) slideFrame = requestAnimationFrame(paintRankSlide);
    }
    function onRankRebuilt() {
        const now = performance.now();
        rankRows().forEach(({ row, key }) => {
            const top = row.offsetTop;
            const slide = slides.get(key);
            if (!slide) slides.set(key, { from: top, to: top, at: top, start: 0 });
            else if (slide.to !== top) slides.set(key, { from: slide.at, to: top, at: slide.at, start: now });
        });
        if (!slideFrame) paintRankSlide();
    }
    function watchRankSlide() {
        const list = byId('liveRankingList');
        if (!list || rankObserver?.target === list) return;
        stopRankSlide();
        rankObserver = new MutationObserver(onRankRebuilt);
        rankObserver.observe(list, { childList: true });
        rankObserver.target = list;
    }
    function stopRankSlide() {
        rankObserver?.disconnect(); rankObserver = null;
        if (slideFrame) cancelAnimationFrame(slideFrame);
        slideFrame = 0; slides.clear();
    }
    function schedule() { if (timer === null) timer = setTimeout(sync, SYNC_MS); }
    function boot() {
        const observer = new MutationObserver(records => {
            if (records.some(record => !(record.target.closest?.('#pcRoomTop')))) schedule();
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        // Entering phone width: give the elements back before mobile-game.js (registered after us) takes them.
        // Leaving it: wait a tick so mobile-game.js has restored them first.
        const layoutChange = () => { if (phoneMatches()) disable(); schedule(); };
        media.addEventListener('change', layoutChange);
        landscapeMedia.addEventListener('change', layoutChange);
        window.addEventListener('resize', schedule);
        sync();
        window.PcRoomUI = { showTab: key => showTab(key, true), refresh: schedule };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
