/** 네 인게임 페이지에서 기존 노드/게임 상태를 유지한 채 헤더와 보조 패널을 배치한다. */
(function () {
    'use strict';
    const PANELS = [
        { key: 'chat', label: '채팅', selector: '.chat-section' },
        { key: 'history', label: '기록', selector: '.history-section' },
        { key: 'orders', label: '주문', selector: '#ordersSection' }
    ];
    function init() {
        const extras = document.querySelector('.room-extras');
        const mount = document.getElementById('controlBarMount');
        if (!extras || !mount) return;
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
            if (event.target.closest('#startOrderButton, #deguriOrderRow button')) select('orders');
        }, true);
        // 튜토리얼이 숨겨진 패널을 가리키면 기존 beforeShow보다 먼저 연다.
        if (window.TutorialModule) {
            const start = TutorialModule.start;
            TutorialModule.start = function (game, steps, options) {
                const visibleSteps = steps.map(step => ({ ...step, beforeShow() {
                    const target = document.querySelector(step.target);
                    const entry = entries.find(item => item.panel.contains(target));
                    if (entry) select(entry.key);
                    if (step.beforeShow) step.beforeShow.call(this);
                    const createdTarget = document.querySelector(step.target);
                    const createdEntry = entries.find(item => item.panel.contains(createdTarget));
                    if (createdEntry) select(createdEntry.key);
                } }));
                return start.call(this, game, visibleSteps, options);
            };
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
