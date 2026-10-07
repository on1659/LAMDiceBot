/** 네 인게임 페이지에서 기존 노드/게임 상태를 유지한 채 헤더와 보조 패널을 배치한다. */
(function () {
    'use strict';
    const PANELS = [
        { key: 'chat', label: '채팅', selector: '.chat-section' },
        { key: 'history', label: '기록', selector: '.history-section' },
        { key: 'orders', label: '주문', selector: '#ordersSection' }
    ];
    const MOBILE = '(max-width: 760px)';
    function init() {
        const extras = document.querySelector('.room-extras');
        const mount = document.getElementById('controlBarMount');
        if (!extras || !mount) return;
        const layout = document.querySelector('.room-layout');
        const sidebar = document.querySelector('.room-sidebar');
        const playfield = document.querySelector('.room-playfield');
        const mobile = window.matchMedia(MOBILE);
        layout.prepend(sidebar);
        layout.append(extras);
        // 기존 목록과 이벤트를 유지하고 상세 명단만 접는다.
        const people = document.querySelector('.users-section');
        const members = document.createElement('details');
        members.className = 'room-members';
        const memberTitle = document.createElement('summary');
        memberTitle.textContent = '참가자 보기';
        people.before(members);
        members.append(memberTitle, people);
        const readyList = document.getElementById('readyUsersList');
        if (readyList) {
            const listDetails = document.createElement('details');
            listDetails.className = 'room-ready-members';
            const summary = document.createElement('summary');
            summary.textContent = '준비 명단 · 드래그 관리';
            readyList.before(listDetails);
            listDetails.append(summary, readyList);
        }
        const countNode = document.getElementById('userCount') || document.getElementById('usersCount');
        if (countNode) {
            const updateCount = () => { memberTitle.textContent = '참가자 ' + countNode.textContent + '명 보기'; };
            new MutationObserver(updateCount).observe(countNode, { childList: true, subtree: true, characterData: true });
            updateCount();
        }
        function header() {
            const bar = mount.querySelector('.room-control-bar');
            if (!bar) return;
            if (!bar.querySelector('.room-heading')) {
                const heading = document.createElement('div');
                heading.className = 'room-heading';
                bar.prepend(heading);
                const label = document.querySelector('.room-game-label');
                if (label) heading.append(label);
                heading.append(document.getElementById('roomTitle'));
                const meta = bar.querySelector('.control-bar-meta');
                const expiry = document.getElementById('roomExpirySection');
                if (expiry) meta.append(expiry);
                const serverName = document.getElementById('currentServerNameDisplay');
                if (serverName) meta.append(serverName);
                const details = document.createElement('details');
                details.className = 'room-tools';
                const summary = document.createElement('summary');
                summary.textContent = '도구';
                details.append(summary, meta);
                bar.insertBefore(details, document.getElementById('leaveBtn'));
            }
            const invite = document.getElementById('freeInviteBar');
            if (invite && !invite.querySelector('.room-invite-label')) {
                const label = document.createElement('span');
                label.className = 'room-invite-label';
                label.textContent = '친구 초대';
                invite.append(label);
                invite.setAttribute('role', 'button');
                invite.setAttribute('aria-label', '친구 초대 링크 복사');
                invite.tabIndex = 0;
                invite.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); invite.click(); }
                });
                bar.insertBefore(invite, bar.querySelector('.room-tools'));
                new MutationObserver(() => {
                    label.textContent = invite.classList.contains('fi-bar-copied') ? '복사됨!' : '친구 초대';
                }).observe(invite, { attributes: true, attributeFilter: ['class'] });
            }
        }
        header();
        new MutationObserver(header).observe(mount, { childList: true, subtree: true });
        const tabs = document.createElement('div');
        tabs.className = 'room-tabs';
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', '방 활동');
        extras.append(tabs);
        const entries = [];
        let sheetOpen = false;
        let returnFocus = null;
        const inertNodes = new Map();
        const backdrop = document.createElement('button');
        backdrop.type = 'button';
        backdrop.className = 'room-sheet-backdrop';
        backdrop.setAttribute('aria-label', '활동 패널 닫기');
        backdrop.tabIndex = -1;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'room-sheet-close';
        close.textContent = '닫기 ✕';
        extras.prepend(close);
        document.body.append(backdrop);
        function closeSheet(restore = true) {
            if (!sheetOpen) return;
            sheetOpen = false;
            document.body.classList.remove('room-activity-open');
            extras.removeAttribute('role');
            extras.removeAttribute('aria-modal');
            extras.removeAttribute('aria-label');
            inertNodes.forEach((wasInert, node) => { node.inert = wasInert; });
            inertNodes.clear();
            if (restore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        }
        function openSheet(key) {
            select(key);
            if (!mobile.matches) return;
            if (!sheetOpen) {
                returnFocus = document.activeElement;
                sheetOpen = true;
                document.body.classList.add('room-activity-open');
                extras.setAttribute('role', 'dialog');
                extras.setAttribute('aria-modal', 'true');
                extras.setAttribute('aria-label', '채팅과 방 활동');
                [sidebar, playfield, mount, dock].forEach(node => {
                    inertNodes.set(node, node.inert);
                    node.inert = true;
                });
            }
            entries.find(entry => entry.key === key)?.button.focus({ preventScroll: true });
        }
        close.addEventListener('click', () => closeSheet());
        backdrop.addEventListener('click', () => closeSheet());
        extras.addEventListener('keydown', event => {
            if (!sheetOpen || tutorialActive()) return;
            if (event.key === 'Escape') { event.preventDefault(); closeSheet(); }
            if (event.key !== 'Tab') return;
            const nodes = [...extras.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
                .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
            const first = nodes[0], last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
        function tutorialActive() {
            const host = document.getElementById('tutorialShadowHost');
            return host && getComputedStyle(host).display !== 'none';
        }
        new MutationObserver(records => {
            if (!sheetOpen) return;
            for (const record of records) for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && node.matches('#orderListModal, #defaultOrderModal')) {
                    closeSheet(false);
                    node.querySelector('input:not([disabled]), button:not([disabled])')?.focus();
                }
            }
        }).observe(document.body, { childList: true });
        const dock = document.createElement('nav');
        dock.className = 'room-action-dock';
        dock.setAttribute('aria-label', '게임 바로 조작');
        function dockButton(id, label) {
            const button = document.createElement('button');
            button.type = 'button'; button.id = id; button.textContent = label;
            dock.append(button);
            return button;
        }
        const readyProxy = dockButton('roomDockReady', '준비');
        const actionProxy = dockButton('roomDockAction', '게임 시작');
        const activityProxy = dockButton('roomDockActivity', '채팅 · 주문');
        document.body.append(dock);
        const readySource = document.getElementById('readyButton');
        const startSource = document.querySelector('#startButton, #startRouletteButton, #startHorseRaceButton, #startDeguriButton');
        const rollSource = document.getElementById('diceIdleEmoji');
        function available(node) {
            if (!node) return false;
            for (let parent = node; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                if (parent.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
            }
            return true;
        }
        const resultSource = document.querySelector('#deguriResetButton, #endGameSection .end-button, #roomStageAction');
        function actionSource() {
            const phase = document.body.dataset.roomPhase;
            if (phase === 'playing') return rollSource;
            if (phase === 'result' && available(resultSource)) return resultSource;
            return startSource;
        }
        function syncProxy(proxy, source, label) {
            const shown = available(source);
            proxy.hidden = !shown;
            proxy.disabled = !shown || source.disabled;
            const text = label || source?.textContent.trim().replace(/\s+/g, ' ');
            if (text && proxy.textContent !== text) proxy.textContent = text;
        }
        function updateDock() {
            syncProxy(readyProxy, document.body.dataset.roomPhase === 'playing' || (document.body.dataset.roomPhase === 'result' && resultSource?.dataset.source === 'readyButton') ? null : readySource);
            syncProxy(actionProxy, actionSource(), document.body.dataset.roomPhase === 'playing' ? '주사위 굴리기' : null);
            const active = document.getElementById('gameSection').classList.contains('active');
            const fullscreen = !!document.fullscreenElement || !!document.querySelector('.race-fs-css, .is-pseudo-fs');
            dock.hidden = !active || fullscreen;
            if ((!active || fullscreen) && sheetOpen) closeSheet(false);
        }
        readyProxy.addEventListener('click', () => { if (available(readySource) && !readySource.disabled) readySource.click(); });
        actionProxy.addEventListener('click', () => { const source = actionSource(); if (available(source) && !source.disabled) source.click(); });
        activityProxy.addEventListener('click', () => openSheet('chat'));
        // 원본 조작부만 관찰해 보조 버튼 갱신이 재귀하지 않도록 한다.
        const controlObserver = new MutationObserver(updateDock);
        [readySource, startSource, rollSource, resultSource, document.getElementById('hostControls'), document.getElementById('readySection')].filter(Boolean).forEach(node => {
            controlObserver.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'disabled', 'hidden'], childList: true, characterData: true, subtree: true });
        });
        let phase = document.body.dataset.roomPhase;
        new MutationObserver(() => {
            const next = document.body.dataset.roomPhase;
            if (next !== phase) {
                if (sheetOpen && next === 'result') closeSheet(false);
                if (mobile.matches && next === 'playing' && !sheetOpen) playfield.scrollIntoView({ block: 'start' });
                phase = next;
            }
            updateDock();
        }).observe(document.body, { attributes: true, attributeFilter: ['data-room-phase', 'class'] });
        new MutationObserver(updateDock).observe(document.getElementById('gameSection'), { attributes: true, attributeFilter: ['class'] });
        document.addEventListener('fullscreenchange', updateDock);
        if (window.visualViewport) {
            const fitKeyboard = () => {
                document.documentElement.style.setProperty('--room-visible-height', window.visualViewport.height + 'px');
                document.documentElement.style.setProperty('--room-keyboard-offset', Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop) + 'px');
            };
            window.visualViewport.addEventListener('resize', fitKeyboard);
            window.visualViewport.addEventListener('scroll', fitKeyboard);
            fitKeyboard();
        }
        mobile.addEventListener('change', () => { closeSheet(false); updateDock(); });
        updateDock();
        function select(key, focus) {
            entries.forEach(entry => {
                const active = entry.key === key;
                entry.button.setAttribute('aria-selected', String(active));
                entry.button.tabIndex = active ? 0 : -1;
                entry.panel.hidden = !active;
                if (active && focus) entry.button.focus();
            });
        }
        PANELS.forEach(({ key, label, selector }) => {
            const node = document.querySelector(selector);
            if (!node) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'room-tab';
            button.id = 'room-tab-' + key;
            button.textContent = label;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', 'room-panel-' + key);
            const panel = document.createElement('section');
            panel.className = 'room-panel';
            panel.id = 'room-panel-' + key;
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', button.id);
            panel.tabIndex = 0;
            panel.append(node);
            tabs.append(button);
            extras.append(panel);
            entries.push({ key, button, panel });
            button.addEventListener('click', () => select(key));
            if (key === 'orders') {
                const empty = document.createElement('p');
                empty.className = 'room-empty';
                empty.textContent = '호스트가 주문받기를 시작하면 여기에 표시됩니다.';
                panel.append(empty);
                const update = () => {
                    empty.hidden = getComputedStyle(node).display !== 'none';
                    button.textContent = node.classList.contains('active') ? '주문 · 진행 중' : label;
                };
                new MutationObserver(update).observe(node, { attributes: true, attributeFilter: ['style', 'class'] });
                update();
            }
        });
        tabs.addEventListener('keydown', event => {
            const index = entries.findIndex(entry => entry.button === event.target);
            if (index < 0) return;
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % entries.length;
            if (event.key === 'ArrowLeft') next = (index + entries.length - 1) % entries.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = entries.length - 1;
            if (next !== undefined) { event.preventDefault(); select(entries[next].key, true); }
        });
        select('chat');
        document.addEventListener('click', event => {
            if (event.target.closest('#startOrderButton, #deguriOrderRow button')) openSheet('orders');
        }, true);
        // 튜토리얼이 숨겨진 패널을 가리키면 기존 beforeShow보다 먼저 연다.
        if (window.TutorialModule) {
            const start = TutorialModule.start;
            let tutorialFocusObserver;
            function focusTutorial() {
                const host = document.getElementById('tutorialShadowHost');
                if (tutorialActive()) host.shadowRoot?.querySelector('.tutorial-btn-next, .tutorial-btn-close')?.focus();
            }
            TutorialModule.start = function (game, steps, options) {
                closeSheet(false);
                const visibleSteps = steps.map(step => ({ ...step, cleanup() {
                    if (step.cleanup) step.cleanup.call(this);
                    (this.layoutDetails || []).forEach(([details, wasOpen]) => { details.open = wasOpen; });
                    this.layoutDetails = [];
                    closeSheet(false);
                }, beforeShow() {
                    closeSheet(false);
                    this.layoutDetails = [];
                    const target = document.querySelector(step.target);
                    const entry = entries.find(item => item.panel.contains(target));
                    if (entry) openSheet(entry.key);
                    for (let parent = target?.parentElement; parent; parent = parent.parentElement) {
                        if (parent.tagName === 'DETAILS') { this.layoutDetails.push([parent, parent.open]); parent.open = true; }
                    }
                    if (step.beforeShow) step.beforeShow.call(this);
                    const createdTarget = document.querySelector(step.target);
                    const createdEntry = entries.find(item => item.panel.contains(createdTarget));
                    if (createdEntry) openSheet(createdEntry.key);
                } }));
                const result = start.call(this, game, visibleSteps, options);
                const shadow = document.getElementById('tutorialShadowHost')?.shadowRoot;
                if (shadow && !tutorialFocusObserver) {
                    tutorialFocusObserver = new MutationObserver(focusTutorial);
                    tutorialFocusObserver.observe(shadow, { childList: true, subtree: true });
                }
                focusTutorial();
                return result;
            };
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
