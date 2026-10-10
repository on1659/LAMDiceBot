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
    const layoutMoved = [];
    const panels = new Map();
    let enabled = false, timer = null, leaving = false, currentAction = null;
    let sheet, sheetBody, footer, header, lobbyLink, currentPanel = '', currentTab = 'game';
    let gameAttributes = null, diceAttributes = null, selectionToggle = null, workspace = null, adsGroup = null, lastSelection = null;
    const TAB_KEYS = ['game', 'chat', 'orders', 'more'];
    const isDice = !!byId('diceIdleEmoji');
    const isHorse = !!byId('raceTrack');
    let horseCountdown = false, sheetOpener = null, horseChoiceFocused = false;
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
        const wrapper = panels.get(key) || node('div', '', { class: 'mobile-native-panel', 'data-mobile-native': key });
        if (!panels.has(key)) { wrapper.hidden = true; sheetBody.append(wrapper); }
        wrapper.append(target);
        moved.push({ target, marker, wrapper });
        panels.set(key, wrapper);
    }
    function restore() {
        layoutMoved.splice(0).reverse().forEach(({ target, marker }) => {
            if (target.id === 'canvasResultCenter' && (target.ownerDocument !== document || target.closest('#raceFsStage'))) {
                marker.remove(); return;
            }
            if (marker.parentNode) marker.replaceWith(nativeAnchor(target));
        });
        // Horse presentation can create this native sibling after our workspace was built.
        // Keep it with the renderer; its own fade callback still owns its contents/cleanup.
        const center = workspace?.querySelector(':scope > #canvasResultCenter');
        const stage = byId('raceTrackWrapper');
        if (center && stage) nativeAnchor(stage).before(center);
        workspace?.remove(); workspace = null; adsGroup?.remove(); adsGroup = null;
        moved.splice(0).reverse().forEach(({ target, marker, wrapper }) => {
            if (marker.parentNode) marker.replaceWith(target);
            wrapper.remove();
        });
        panels.clear();
    }
    function nativeAnchor(target) {
        if (target._canvasPlaceholder?.parentNode) return target._canvasPlaceholder;
        if (target.id === 'raceTrackWrapper' && typeof _racePipPlaceholder !== 'undefined' && _racePipPlaceholder?.parentNode) return _racePipPlaceholder;
        if (target.id === 'raceTrackWrapper' && target.closest('#raceFsStage')) return target.closest('#raceFsStage');
        return target;
    }
    function relocate(target, destination) {
        if (!target) return;
        const anchor = nativeAnchor(target);
        const marker = document.createComment('mobile-app: original position');
        anchor.before(marker); destination.append(anchor);
        layoutMoved.push({ target, marker });
    }
    function diceKeypress(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); event.currentTarget.click();
    }
    function buildWorkspace() {
        const game = byId('gameSection');
        workspace = node('div', '', { id: 'mobileGameWorkspace' });
        game.prepend(workspace);
        // Move the actual renderer, never recreate it or override its native display gate.
        const stage = byId('raceTrackWrapper') || byId('deguriStage') || byId('rouletteContainer') || document.querySelector('.chat-history-wrapper');
        const center = byId('canvasResultCenter');
        if (center && !center.closest('#raceFsStage')) relocate(center, workspace);
        relocate(stage, workspace);
        if (isDice) {
            const dieStage = node('section', '', { id: 'mobileDiceStage', 'aria-label': '주사위 게임' });
            workspace.prepend(dieStage);
            const die = byId('diceIdleEmoji');
            diceAttributes = new Map(['role', 'tabindex', 'aria-label'].map(name => [name, die.getAttribute(name)]));
            die.setAttribute('role', 'button'); die.setAttribute('tabindex', '0'); die.setAttribute('aria-label', '주사위 굴리기');
            die.addEventListener('keydown', diceKeypress);
            relocate(die, dieStage);
        }
        ['targetRankBanner', 'targetRankReason', 'gameStatus'].forEach(id => relocate(byId(id), workspace));
        workspace.append(node('div', '', { id: 'mobileGameReadySummary', role: 'status' }));
        relocate(byId('horseSelectionSection') || byId('deguriPickSection'), workspace);
        if (isHorse) workspace.prepend(byId('horseSelectionSection'));
        // Voting stays directly available even when the art tray is folded.
        relocate(byId('rankVoteSection'), workspace);
        ['progressSection', 'notRolledSection', 'replaySection', 'turboSettingSection'].forEach(id => relocate(byId(id), workspace));
        adsGroup = node('div', '', { id: 'mobileGameAds' });
        game.append(adsGroup);
        game.querySelectorAll('.ad-container').forEach(ad => relocate(ad, adsGroup));
        document.querySelectorAll('body > .ad-container').forEach(ad => relocate(ad, adsGroup));
    }
    function closeSheet() { if (enabled && sheet) showPanel('game'); }
    function scrollTo(target) {
        showPanel('game');
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function showPanel(key) {
        if (key === 'ranking') {
            if (isHorse) closeSheet();
            if (typeof RankingModule !== 'undefined') RankingModule.show();
            return;
        }
        currentPanel = key;
        currentTab = TAB_KEYS.includes(key) ? key : 'more';
        const game = byId('gameSection');
        if (isHorse) {
            const open = key !== 'game';
            if (open && sheet.hidden) sheetOpener = document.activeElement;
            game.inert = open;
            header.inert = footer.inert = open;
            game.setAttribute('aria-hidden', String(open));
            const names = { chat: '채팅', orders: '주문', people: '참여자', history: '게임 기록', settings: '화면·소리', host: '방장 설정', rules: '게임 규칙', more: '방 메뉴' };
            byId('mobileGameSheetTitle').textContent = names[key] || '방 메뉴';
            sheetBody.querySelectorAll('.mobile-native-panel').forEach(panel => { panel.hidden = true; });
            byId('mobileGameMore').hidden = key !== 'more';
            if (panels.has(key)) panels.get(key).hidden = false;
            sheet.hidden = !open;
            byId('mobileGameDock').querySelectorAll('button').forEach(tool => tool.setAttribute('aria-pressed', String(open && tool.dataset.mobilePanel === currentTab)));
            refreshPanelStatus(); sync();
            if (open) byId('mobileGameSheetClose').focus({ preventScroll: true });
            else if (sheetOpener?.isConnected) { sheetOpener.focus({ preventScroll: true }); sheetOpener = null; }
            return;
        }
        const mainVisible = currentTab === 'game' || (isDice && currentTab === 'chat');
        game.classList.toggle('mobile-tab-away', !mainVisible);
        game.classList.toggle('mobile-dice-chat-only', isDice && currentTab === 'chat');
        game.setAttribute('aria-hidden', String(!mainVisible));
        game.inert = !mainVisible;
        game.setAttribute('aria-labelledby', 'mobileGameTab-' + (isDice && currentTab === 'chat' ? 'chat' : 'game'));
        byId('mobileGameDock').querySelectorAll('[role=tab]').forEach(tab => {
            const selected = tab.dataset.mobilePanel === currentTab;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        });
        const names = { chat: '채팅', orders: '주문', people: '참여자', history: '게임 기록', settings: '화면·소리', host: '방장 설정', rules: '게임 규칙', more: '더보기' };
        byId('mobileGameSheetTitle').textContent = names[key] || '게임';
        sheetBody.querySelectorAll('.mobile-native-panel').forEach(panel => { panel.hidden = true; });
        byId('mobileGameMore').hidden = key !== 'more';
        if (panels.has(key)) panels.get(key).hidden = false;
        sheet.hidden = mainVisible;
        sheet.setAttribute('aria-labelledby', 'mobileGameTab-' + currentTab);
        refreshPanelStatus();
        sync();
        // Keep the actual canvas mounted and measurable; notify its native resize handler on return.
        if (mainVisible) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
        document.querySelector('body > .container')?.scrollTo({ top: 0, behavior: 'instant' });
        window.scrollTo({ top: 0, behavior: 'instant' });
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
        header.append(back, identity, button('', () => showPanel('people'), { id: 'mobileGamePeople', 'aria-label': '참여자 보기' }));
        document.body.prepend(header);
        footer = node('div', '', { id: 'mobileGameFooter', class: 'mobile-game-chrome' });
        const action = button('', () => {
            if (!currentAction || currentAction.disabled) return;
            currentAction.click();
            schedule();
        }, { id: 'mobileGameAction' });
        footer.append(action);
        const dock = node('nav', '', { id: 'mobileGameDock', role: isHorse ? 'toolbar' : 'tablist', 'aria-label': isHorse ? '방 도구' : '방 탭' });
        const tools = isHorse ? [['chat', '채팅', 'chat'], ['orders', '주문', 'burger'], ['more', '메뉴', 'list']] : [['game', '게임', 'play'], ['chat', '채팅', 'chat'], ['orders', '주문', 'burger'], ['more', '더보기', 'list']];
        tools.forEach(([key, label, icon]) => {
            const attrs = isHorse ? { 'aria-pressed': 'false' } : { role: 'tab', 'aria-selected': String(key === 'game'), tabindex: key === 'game' ? '0' : '-1' };
            const tool = button('', () => showPanel(key), { 'data-mobile-panel': key, id: 'mobileGameTab-' + key, 'aria-controls': key === 'game' || (isDice && key === 'chat') ? 'gameSection' : 'mobileGameSheet', ...attrs });
            tool.append(node('i', '', { class: 'ui ui-' + icon, 'aria-hidden': 'true' }), node('span', label));
            dock.append(tool);
        });
        dock.addEventListener('keydown', event => {
            if (isHorse) return;
            if (event.key === 'Tab' && !event.shiftKey) {
                event.preventDefault();
                const selected = dock.querySelector('[aria-selected=true]');
                byId(selected.getAttribute('aria-controls'))?.focus({ preventScroll: true });
                return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = TAB_KEYS.indexOf(currentTab);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? TAB_KEYS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TAB_KEYS.length) % TAB_KEYS.length;
            showPanel(TAB_KEYS[next]); byId('mobileGameTab-' + TAB_KEYS[next]).focus();
        });
        footer.append(dock); document.body.append(footer);
        sheet = node('section', '', { id: 'mobileGameSheet', class: 'mobile-game-chrome', role: 'tabpanel', tabindex: '0', 'aria-labelledby': 'mobileGameTab-more', hidden: '' });
        if (isHorse) { sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'mobileGameSheetTitle'); }
        const sheetHead = node('div', '', { class: 'mobile-sheet-heading' });
        sheetHead.append(node('h2', '', { id: 'mobileGameSheetTitle' }), button('게임으로', closeSheet, { id: 'mobileGameSheetClose' }));
        sheetBody = node('div', '', { id: 'mobileGameSheetBody' });
        sheetBody.append(node('div', '', { id: 'mobileGameMore' }));
        const panelStatus = node('div', '', { id: 'mobileGamePanelStatus', hidden: '' });
        panelStatus.append(node('p', '아직 주문을 받지 않아요.'), button('주문받기 시작', () => byId('startOrderButton')?.click(), { id: 'mobileGameStartOrder' }));
        sheetBody.append(panelStatus);
        sheet.append(sheetHead, sheetBody); byId('gameSection').after(sheet);
        addMore('참여자', () => showPanel('people'));
        addMore('랭킹', () => showPanel('ranking'));
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
        document.addEventListener('keydown', event => {
            if (!enabled || sheet.hidden) return;
            if (event.key === 'Escape' && (!isHorse || sheet.contains(document.activeElement))) closeSheet();
            if (isHorse && event.key === 'Tab' && sheet.contains(document.activeElement)) {
                const focusable = [...sheet.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
                const first = focusable[0], last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        });
    }
    function enable() {
        if (enabled) return;
        enabled = true;
        if (!header) build();
        document.body.classList.add('mobile-ui');
        document.body.classList.toggle('mobile-dice-app', isDice);
        document.body.classList.toggle('mobile-horse-focus', isHorse);
        document.body.classList.toggle('mobile-debug', new URLSearchParams(location.search).has('debug'));
        // Dice renders authoritative rolls inside chat; keep its chat stage in the main flow.
        if (!isDice) move('chat', byId('chatMessages')?.closest('.chat-section'));
        move('people', byId('usersList')?.closest('.users-section'));
        move('people', byId('readySection'));
        move('people', byId('roomExpirySection'));
        if (isHorse) move('people', byId('notSelectedVehicleSection'));
        move('orders', byId('ordersSection'));
        move('history', byId('historySection') || byId('historyList')?.closest('.history-section'));
        move('host', byId('hostControls'));
        move('rules', byId('gameRulesSection'));
        move('settings', document.querySelector('.control-bar-meta'));
        move('settings', document.querySelector('.horse-selection-header-right'));
        const game = byId('gameSection');
        gameAttributes = new Map(['role', 'tabindex', 'aria-labelledby', 'aria-hidden', 'inert'].map(name => [name, game.getAttribute(name)]));
        game.setAttribute('role', isHorse ? 'region' : 'tabpanel'); game.setAttribute('tabindex', '0');
        if (isHorse) game.setAttribute('aria-labelledby', 'mobileGameTitle');
        buildWorkspace();
        const selection = byId('horseSelectionSection') || byId('deguriPickSection');
        if (selection) {
            selectionToggle = button('선택', () => {
                if (isHorse && lastSelection === null) return;
                const collapsed = selection.classList.toggle('mobile-selection-collapsed');
                selectionToggle.setAttribute('aria-expanded', String(!collapsed));
                if (isHorse && !collapsed) selection.querySelector('.horse-selection-button.selected, .horse-selection-button')?.focus({ preventScroll: true });
            }, { id: 'mobileSelectionToggle', class: 'mobile-game-chrome', 'aria-expanded': 'true', 'aria-controls': isDice ? '' : byId('raceTrack') ? 'horseSelectionGrid horseSelectionInfo' : 'deguriPicker deguriPickStatus' });
            selection.querySelector('.horse-selection-header, .deguri-pick-head')?.append(selectionToggle);
            if (isHorse) {
                const own = node('div', '', { id: 'mobileHorseOwnSelection', role: 'status' });
                own.append(node('span', '', { id: 'mobileHorseOwnIcon', 'aria-hidden': 'true' }), node('strong', '', { id: 'mobileHorseOwnLabel' }));
                selection.querySelector('.horse-selection-header')?.prepend(own);
                selection.addEventListener('click', rememberHorseChoiceFocus);
            }
        }
        showPanel('game');
    }
    function rememberHorseChoiceFocus(event) {
        if (event.target.closest('#horseSelectionGrid button')) horseChoiceFocused = byId('horseSelectionGrid').contains(document.activeElement);
    }
    function disable() {
        if (!enabled) return;
        restore(); enabled = false; currentAction = null;
        sheet.hidden = true; currentPanel = ''; currentTab = 'game';
        header.inert = footer.inert = false;
        const game = byId('gameSection');
        game.classList.remove('mobile-tab-away', 'mobile-dice-chat-only');
        gameAttributes?.forEach((value, key) => { if (value === null) game.removeAttribute(key); else game.setAttribute(key, value); });
        (byId('horseSelectionSection') || byId('deguriPickSection'))?.classList.remove('mobile-selection-collapsed');
        selectionToggle?.remove(); selectionToggle = null;
        byId('mobileHorseOwnSelection')?.remove();
        byId('horseSelectionSection')?.removeEventListener('click', rememberHorseChoiceFocus);
        horseChoiceFocused = false;
        if (isDice) {
            const die = byId('diceIdleEmoji');
            die.removeEventListener('keydown', diceKeypress);
            diceAttributes?.forEach((value, key) => { if (value === null) die.removeAttribute(key); else die.setAttribute(key, value); });
        }
        lastSelection = null;
        document.body.classList.remove('mobile-ui', 'mobile-game-active', 'mobile-debug', 'mobile-app-running', 'mobile-app-fullscreen', 'mobile-stage-map-visible', 'mobile-dice-app', 'mobile-horse-focus');
        document.body.removeAttribute('data-mobile-phase');
        document.documentElement.style.removeProperty('--mobile-game-bottom');
    }
    function chooseAction() {
        const visible = ids => ids.map(byId).find(element => nativeVisible(element));
        const reset = visible(['deguriResetButton']);
        if (reset) return reset;
        const end = byId('endGameSection')?.querySelector('button');
        if (nativeVisible(end)) return end;
        // Native dice /주사위 handles readiness and one-roll-per-round itself.
        if (isDice && typeof isGameActive !== 'undefined' && isGameActive) return byId('diceIdleEmoji');
        const ready = visible(['readyButton']);
        if (ready && !ready.disabled && ready.textContent.trim() === '준비') return ready;
        const start = visible(['startHorseRaceButton', 'startRouletteButton', 'startDeguriButton', 'startButton']);
        if (start) return start;
        return visible(['readyButton']);
    }
    function syncWorkspace() {
        // The native renderer creates this control lazily and later updates it by ID.
        if (isHorse) move('rules', byId('trackLengthSelector'));
        const count = (byId('usersCount') || byId('userCount'))?.textContent.trim() || '0';
        const people = byId('mobileGamePeople');
        const peopleLabel = count + '명';
        if (people.textContent !== peopleLabel) people.textContent = peopleLabel;
        people.setAttribute('aria-label', '참여자 ' + peopleLabel + ' 보기');
        const summary = byId('mobileGameReadySummary');
        const readyText = '준비 ' + (byId('readyCount')?.textContent.trim() || '0') + '/' + count;
        if (summary.textContent !== readyText) summary.textContent = readyText;
        const running = title === '경마' ? horseCountdown || (typeof isRaceActive !== 'undefined' && isRaceActive) : title === '데구리' ? typeof isDeguriActive !== 'undefined' && isDeguriActive : title === '룰렛' ? typeof isSpinning !== 'undefined' && isSpinning : false;
        if (document.body.classList.contains('mobile-app-running') !== running) document.body.classList.toggle('mobile-app-running', running);
        const mapVisible = nativeVisible(byId('raceMinimap'));
        if (document.body.classList.contains('mobile-stage-map-visible') !== mapVisible) document.body.classList.toggle('mobile-stage-map-visible', mapVisible);
        const selection = byId('horseSelectionSection') || byId('deguriPickSection');
        const selected = selection?.querySelector('.horse-selection-button.selected, .deguri-creature-btn.selected');
        // The native map is filled by the server's private confirmation, including index 0.
        const ownIndex = isHorse && typeof userHorseBets !== 'undefined' && typeof currentUser !== 'undefined' ? userHorseBets[currentUser] : undefined;
        const ownSelection = isHorse ? (ownIndex !== undefined ? String(ownIndex) : (typeof mySelectedHorse !== 'undefined' && mySelectedHorse === -999 ? '-999' : null)) : selected?.getAttribute('data-creature') || null;
        if (ownSelection !== lastSelection) {
            lastSelection = ownSelection;
            const collapsed = !!ownSelection;
            const focusInChoices = isHorse && (byId('horseSelectionGrid')?.contains(document.activeElement) || (horseChoiceFocused && document.activeElement === document.body));
            selection?.classList.toggle('mobile-selection-collapsed', collapsed);
            selectionToggle?.setAttribute('aria-expanded', String(!collapsed));
            if (collapsed && focusInChoices && selectionToggle) { selectionToggle.hidden = false; selectionToggle.focus({ preventScroll: true }); }
            horseChoiceFocused = false;
        }
        if (selectionToggle) {
            const selectionLabel = ownSelection ? '변경' : '선택';
            if (selectionToggle.textContent !== selectionLabel) selectionToggle.textContent = selectionLabel;
            if (isHorse) selectionToggle.hidden = ownSelection === null;
        }
        if (isHorse) {
            const chosen = ownSelection !== null;
            const own = byId('mobileHorseOwnSelection');
            if (own.hidden === chosen) own.hidden = !chosen;
            const vehicleId = ownIndex !== undefined && typeof selectedVehicleTypes !== 'undefined' ? selectedVehicleTypes?.[ownIndex] : null;
            const vehicles = typeof ALL_VEHICLES !== 'undefined' ? ALL_VEHICLES : [];
            const vehicle = vehicles.find(item => item.id === vehicleId) || (ownIndex !== undefined ? vehicles[ownIndex % vehicles.length] : null);
            const name = ownSelection === '-999' ? '랜덤 선택됨' : (vehicle?.name || '탈것') + ' 선택됨';
            if (byId('mobileHorseOwnLabel').textContent !== name) byId('mobileHorseOwnLabel').textContent = name;
            const icon = ownSelection === '-999' ? '🎲' : vehicle?.emoji || '✓';
            if (byId('mobileHorseOwnIcon').textContent !== icon) byId('mobileHorseOwnIcon').textContent = icon;
            const result = !running && (byId('resultOverlay')?.classList.contains('visible') || nativeVisible(byId('endGameSection')));
            const phase = running ? 'running' : result ? 'result' : chosen ? 'selected' : 'selecting';
            if (document.body.dataset.mobilePhase !== phase) document.body.dataset.mobilePhase = phase;
        }
    }
    function sync() {
        timer = null;
        if (!enabled) return;
        const inRoom = active();
        if (document.body.classList.contains('mobile-game-active') !== inRoom) document.body.classList.toggle('mobile-game-active', inRoom);
        header.hidden = footer.hidden = !inRoom;
        lobbyLink.hidden = inRoom;
        if (!inRoom) { sheet.hidden = true; return; }
        const text = (byId('roomNameText') || byId('roomNameDisplay'))?.textContent.trim() || title;
        if (byId('mobileGameTitle').textContent !== text) byId('mobileGameTitle').textContent = text;
        syncWorkspace();
        refreshPanelStatus();
        byId('mobileGameHostMenu').hidden = !nativeVisible(byId('hostControls'));
        byId('mobileGameShopMenu').hidden = !window.DeguriShop && !window.HorseShop;
        currentAction = chooseAction();
        const action = byId('mobileGameAction');
        const label = currentAction?.id === 'diceIdleEmoji' ? '주사위 굴리기' : currentAction?.closest('#endGameSection') ? '다음 판 준비' : currentAction?.textContent.trim() || '진행을 기다리는 중';
        if (action.textContent !== label) action.textContent = label;
        action.hidden = currentTab !== 'game' || (isHorse && (document.body.classList.contains('mobile-app-running') || !currentAction));
        action.disabled = !currentAction || !!currentAction.disabled;
        const fullscreen = !!document.fullscreenElement || !!document.querySelector('.race-fs-css, .is-pseudo-fs');
        if (document.body.classList.contains('mobile-app-fullscreen') !== fullscreen) document.body.classList.toggle('mobile-app-fullscreen', fullscreen);
        header.hidden = fullscreen;
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
            if (isHorse) {
                gameSocket.on('horseRaceCountdown', () => { horseCountdown = true; schedule(); });
                ['horseRaceStarted', 'horseRaceGameReset', 'horseRaceDataCleared'].forEach(event => gameSocket.on(event, () => { horseCountdown = false; schedule(); }));
                gameSocket.on('horseSelectionReady', () => { if (typeof isRaceActive === 'undefined' || !isRaceActive) horseCountdown = false; schedule(); });
            }
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
