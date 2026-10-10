/* Mobile presentation only. Native controls, socket contracts and renderers own gameplay. */
(function () {
    'use strict';
    const MOBILE_WIDTH = 760;
    const SYNC_MS = 120;
    const PENDING_KEYS = ['pendingHorseRaceRoom', 'pendingHorseRaceJoin', 'pendingRouletteRoom', 'pendingRouletteJoin', 'pendingDeguriRoom', 'pendingDeguriJoin'];
    const ROOM_KEYS = ['diceActiveRoom', 'horseRaceActiveRoom', 'rouletteActiveRoom', 'deguriActiveRoom'];
    const media = matchMedia('(max-width: ' + MOBILE_WIDTH + 'px)');
    const byId = id => document.getElementById(id);
    const moved = [];
    const panels = new Map();
    let enabled = false, timer = null, leaving = false, currentAction = null, lastActive = false;
    let sheet, sheetBody, footer, header, lobbyLink, originalFocus, currentPanel = '';
    const isDice = !!byId('diceIdleEmoji');
    const title = byId('deguriCanvas') ? '데구리' : byId('raceTrack') ? '경마' : byId('rouletteWheel') ? '룰렛' : '주사위';
    const node = (tag, text, attrs) => {
        const result = document.createElement(tag);
        if (text) result.textContent = text;
        Object.entries(attrs || {}).forEach(([key, value]) => result.setAttribute(key, value));
        return result;
    };
    function button(text, action, attrs) {
        const result = node('button', text, { type: 'button', ...attrs });
        result.addEventListener('click', action);
        return result;
    }
    function pendingEntry() {
        const query = new URLSearchParams(location.search);
        if (['createRoom', 'joinRoom', 'room', 'roomId', 'code', 'invite'].some(key => query.has(key))) return true;
        try {
            return ROOM_KEYS.some(key => sessionStorage.getItem(key)) ||
                PENDING_KEYS.some(key => localStorage.getItem(key) || sessionStorage.getItem(key));
        } catch (_) { return true; }
    }
    function active() { return !!byId('gameSection')?.classList.contains('active'); }
    // Ignore the adapter's closed sheet, but honor every native visibility/permission gate.
    function nativeVisible(element) {
        if (!element) return false;
        for (let parent = element; parent && parent !== sheetBody; parent = parent.parentElement) {
            if (parent.classList.contains('mobile-native-panel')) continue;
            if (parent.hidden || getComputedStyle(parent).display === 'none' || getComputedStyle(parent).visibility === 'hidden') return false;
        }
        return true;
    }
    function move(key, target) {
        if (!target || moved.some(entry => entry.target === target)) return;
        const marker = document.createComment('mobile-game: original position');
        target.before(marker);
        const wrapper = node('div', '', { class: 'mobile-native-panel', 'data-mobile-native': key });
        wrapper.hidden = true;
        sheetBody.append(wrapper);
        wrapper.append(target);
        moved.push({ target, marker, wrapper });
        panels.set(key, wrapper);
    }
    function restore() {
        moved.splice(0).reverse().forEach(({ target, marker, wrapper }) => {
            if (marker.parentNode) marker.replaceWith(target);
            wrapper.remove();
        });
        panels.clear();
    }
    function closeSheet() {
        if (!sheet) return;
        sheet.hidden = true;
        currentPanel = '';
        document.body.classList.remove('mobile-sheet-open');
        if (originalFocus?.isConnected) originalFocus.focus({ preventScroll: true });
    }
    function scrollTo(target) {
        closeSheet();
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function showPanel(key) {
        if (key === 'ranking') {
            closeSheet();
            if (typeof RankingModule !== 'undefined') RankingModule.show();
            return;
        }
        if (key === 'chat' && isDice) { scrollTo(byId('chatMessages')); byId('chatInput')?.focus(); return; }
        originalFocus = document.activeElement;
        currentPanel = key;
        const names = { chat: '채팅', orders: '주문', people: '참여자', history: '게임 기록', settings: '화면·소리', host: '방장 설정', rules: '게임 규칙', more: '더보기' };
        byId('mobileGameSheetTitle').textContent = names[key] || '더보기';
        sheetBody.querySelectorAll('.mobile-native-panel').forEach(panel => { panel.hidden = true; });
        byId('mobileGameMore').hidden = key !== 'more';
        if (panels.has(key)) panels.get(key).hidden = false;
        sheet.hidden = false;
        document.body.classList.add('mobile-sheet-open');
        refreshPanelStatus();
        byId('mobileGameSheetClose').focus({ preventScroll: true });
    }
    function refreshPanelStatus() {
        const status = byId('mobileGamePanelStatus');
        if (!status) return;
        const noOrders = currentPanel === 'orders' && !nativeVisible(byId('ordersSection'));
        status.hidden = !noOrders;
        byId('mobileGameStartOrder').hidden = !nativeVisible(byId('hostControls'));
    }
    function addMore(label, action, attrs) { byId('mobileGameMore').append(button(label, action, attrs)); }
    function build() {
        header = node('div', '', { id: 'mobileGameHeader', class: 'mobile-game-chrome' });
        const identity = node('div', '', { class: 'mobile-game-identity' });
        identity.append(node('small', title), node('strong', '', { id: 'mobileGameTitle' }));
        const back = button('‹ 로비', () => {
            if (!active()) { location.assign('/mobile'); return; }
            const nativeLeave = byId('leaveBtn');
            if (nativeLeave) { leaving = true; nativeLeave.click(); }
        }, { id: 'mobileGameBack' });
        header.append(back, identity, button('메뉴', () => showPanel('more')));
        document.body.prepend(header);
        footer = node('div', '', { id: 'mobileGameFooter', class: 'mobile-game-chrome' });
        const action = button('', () => {
            if (!currentAction || currentAction.disabled) return;
            currentAction.click();
            schedule();
        }, { id: 'mobileGameAction' });
        footer.append(action);
        const dock = node('nav', '', { id: 'mobileGameDock', 'aria-label': '방 도구' });
        [['chat', '채팅', 'chat'], ['orders', '주문', 'burger'], ['people', '참여자', 'people'], ['ranking', '랭킹', 'trophy'], ['more', '더보기', 'list']].forEach(([key, label, icon]) => {
            const tool = button('', () => showPanel(key), { 'data-mobile-panel': key });
            tool.append(node('i', '', { class: 'ui ui-' + icon, 'aria-hidden': 'true' }), node('span', label));
            dock.append(tool);
        });
        footer.append(dock); document.body.append(footer);
        sheet = node('section', '', { id: 'mobileGameSheet', class: 'mobile-game-chrome', role: 'region', 'aria-labelledby': 'mobileGameSheetTitle', hidden: '' });
        const sheetHead = node('div', '', { class: 'mobile-sheet-heading' });
        sheetHead.append(node('h2', '', { id: 'mobileGameSheetTitle' }), button('×', closeSheet, { id: 'mobileGameSheetClose', 'aria-label': '닫기' }));
        sheetBody = node('div', '', { id: 'mobileGameSheetBody' });
        sheetBody.append(node('div', '', { id: 'mobileGameMore' }));
        const panelStatus = node('div', '', { id: 'mobileGamePanelStatus', hidden: '' });
        panelStatus.append(node('p', '아직 주문을 받지 않아요.'), button('주문받기 시작', () => byId('startOrderButton')?.click(), { id: 'mobileGameStartOrder' }));
        sheetBody.append(panelStatus);
        sheet.append(sheetHead, sheetBody); document.body.append(sheet);
        addMore('화면·소리', () => showPanel('settings'));
        addMore('게임 기록', () => showPanel('history'));
        addMore('게임 규칙', () => {
            if (panels.has('rules')) showPanel('rules');
            else if (nativeVisible(byId('rankVoteSection'))) scrollTo(byId('rankVoteSection'));
            else window.open(title === '데구리' ? '/pages/game-guides.html' : '/pages/' + (title === '경마' ? 'horse-race' : 'roulette') + '-guide.html', '_blank', 'noopener');
        });
        addMore('방장 설정·예약', () => showPanel('host'), { id: 'mobileGameHostMenu' });
        addMore('꾸미기', () => {
            closeSheet();
            if (window.DeguriShop) window.DeguriShop.openShop();
            else if (window.HorseShop?.openShop) window.HorseShop.openShop();
            else scrollTo(byId('horseSelectionSection') || byId('deguriPickSection'));
        }, { id: 'mobileGameShopMenu' });
        addMore('친구 초대', () => { closeSheet(); const invite = byId('freeInviteFab') || byId('freeInviteBar')?.querySelector('button'); if (invite) invite.click(); });
        lobbyLink = node('a', '‹ 모바일 로비', { href: '/mobile', id: 'mobileGameLobbyLink', class: 'mobile-game-chrome' });
        document.body.prepend(lobbyLink);
        document.addEventListener('keydown', event => { if (enabled && event.key === 'Escape' && !sheet.hidden) closeSheet(); });
    }
    function enable() {
        if (enabled) return;
        enabled = true;
        if (!header) build();
        document.body.classList.add('mobile-ui');
        document.body.classList.toggle('mobile-debug', new URLSearchParams(location.search).has('debug'));
        // Dice renders authoritative rolls inside chat; keep its chat stage in the main flow.
        if (!isDice) move('chat', byId('chatMessages')?.closest('.chat-section'));
        move('people', byId('usersList')?.closest('.users-section'));
        move('orders', byId('ordersSection'));
        move('history', byId('historySection') || byId('historyList')?.closest('.history-section'));
        move('host', byId('hostControls'));
        move('rules', byId('gameRulesSection'));
        move('settings', document.querySelector('.control-bar-meta'));
        sync();
    }
    function disable() {
        if (!enabled) return;
        closeSheet(); restore(); enabled = false; currentAction = null;
        document.body.classList.remove('mobile-ui', 'mobile-game-active', 'mobile-debug');
        document.documentElement.style.removeProperty('--mobile-game-bottom');
    }
    function chooseAction() {
        const visible = ids => ids.map(byId).find(element => nativeVisible(element));
        const reset = visible(['deguriResetButton']);
        if (reset) return reset;
        // Native dice /주사위 handles readiness and one-roll-per-round itself.
        if (isDice && typeof isGameActive !== 'undefined' && isGameActive) return byId('diceIdleEmoji');
        const ready = visible(['readyButton']);
        if (ready && !ready.disabled && ready.textContent.trim() === '준비') return ready;
        const start = visible(['startHorseRaceButton', 'startRouletteButton', 'startDeguriButton', 'startButton']);
        if (start) return start;
        return visible(['readyButton']);
    }
    function sync() {
        timer = null;
        if (!enabled) return;
        const inRoom = active();
        if (document.body.classList.contains('mobile-game-active') !== inRoom) document.body.classList.toggle('mobile-game-active', inRoom);
        header.hidden = footer.hidden = !inRoom;
        lobbyLink.hidden = inRoom;
        if (!inRoom) { if (lastActive) closeSheet(); lastActive = false; return; }
        lastActive = true;
        const text = (byId('roomNameText') || byId('roomNameDisplay'))?.textContent.trim() || title;
        if (byId('mobileGameTitle').textContent !== text) byId('mobileGameTitle').textContent = text;
        refreshPanelStatus();
        byId('mobileGameHostMenu').hidden = !nativeVisible(byId('hostControls'));
        byId('mobileGameShopMenu').hidden = !window.DeguriShop && !window.HorseShop;
        currentAction = chooseAction();
        const action = byId('mobileGameAction');
        const label = currentAction?.id === 'diceIdleEmoji' ? '주사위 굴리기' : currentAction?.textContent.trim() || '진행을 기다리는 중';
        if (action.textContent !== label) action.textContent = label;
        action.disabled = !currentAction || !!currentAction.disabled;
        const fullscreen = !!document.fullscreenElement || !!document.querySelector('.race-fs-css, .is-pseudo-fs');
        footer.hidden = fullscreen;
        document.documentElement.style.setProperty('--mobile-game-bottom', fullscreen ? '0px' : Math.ceil(footer.getBoundingClientRect().height) + 'px');
    }
    function schedule() { if (enabled && timer === null) timer = setTimeout(sync, SYNC_MS); }
    function boot() {
        if (media.matches && isDice && ['/', '/game', '/dice-game-multiplayer.html'].includes(location.pathname) && !active() && !pendingEntry()) { location.replace('/mobile'); return; }
        // The native listener performs cleanup first; the confirmed departure then returns to /mobile.
        const gameSocket = typeof socket !== 'undefined' ? socket : window.socket;
        if (gameSocket?.on) {
            ['roomLeft', 'leftRoom'].forEach(event => gameSocket.on(event, () => { if (enabled && leaving) location.replace('/mobile'); }));
        }
        const observer = new MutationObserver(records => {
            if (records.some(record => record.target.closest?.('.mobile-native-panel') || !record.target.closest?.('.mobile-game-chrome'))) schedule();
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true, attributeFilter: ['class', 'style', 'disabled', 'hidden'] });
        media.addEventListener('change', () => { if (media.matches) enable(); else disable(); });
        window.addEventListener('resize', schedule);
        document.addEventListener('fullscreenchange', schedule);
        if (media.matches) enable();
        window.MobileGameUI = { showPanel, refresh: schedule };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
