// 랭킹 UI 오버레이 모듈
const RankingModule = (function () {
    let _serverId = null;
    let _userName = null;
    let _overlay = null;
    let _cache = null;
    let _cacheTime = 0;
    const CACHE_TTL = 10000; // 10초

    function init(serverId, userName) {
        _serverId = serverId;
        _userName = userName;
    }

    function invalidateCache() {
        _cache = null;
        _cacheTime = 0;
    }

    async function fetchRanking() {
        if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
        const url = _serverId
            ? `/api/ranking/${_serverId}?userName=${encodeURIComponent(_userName || '')}`
            : '/api/ranking/free';
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed');
            _cache = await res.json();
            _cacheTime = Date.now();
            return _cache;
        } catch (e) {
            console.warn('랭킹 조회 실패:', e);
            return null;
        }
    }

    function show() {
        if (_overlay) { _overlay.style.display = 'flex'; fetchAndRender(); return; }
        createOverlay();
        fetchAndRender();
    }

    function hide() {
        if (_overlay) _overlay.style.display = 'none';
    }

    function createOverlay() {
        _overlay = document.createElement('div');
        _overlay.id = 'ranking-overlay';
        _overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#f5f6fa;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
        _overlay.innerHTML = `
            <div id="ranking-header" style="display:flex;align-items:center;padding:16px 20px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;flex-shrink:0;">
                <button onclick="RankingModule.hide()" style="background:none;border:none;color:white;font-size:1.4em;cursor:pointer;padding:4px 8px;margin-right:8px;">←</button>
                <span style="font-size:1.2em;font-weight:700;">랭킹</span>
            </div>
            <div id="ranking-tabs" style="display:flex;gap:0;background:white;border-bottom:1px solid #e0e0e0;overflow-x:auto;flex-shrink:0;padding:0 8px;"></div>
            <div id="ranking-content" style="flex:1;overflow-y:auto;padding:16px 20px;-webkit-overflow-scrolling:touch;"></div>
        `;
        document.body.appendChild(_overlay);
    }

    function createTab(label, key, isActive) {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.dataset.tab = key;
        btn.style.cssText = `padding:10px 16px;border:none;background:${isActive ? '#667eea' : 'transparent'};color:${isActive ? 'white' : '#666'};font-size:0.9em;font-weight:${isActive ? '700' : '500'};cursor:pointer;border-radius:8px 8px 0 0;white-space:nowrap;transition:all 0.2s;`;
        btn.onclick = () => switchTab(key);
        return btn;
    }

    function switchTab(key) {
        const tabs = document.querySelectorAll('#ranking-tabs button');
        tabs.forEach(t => {
            const isActive = t.dataset.tab === key;
            t.style.background = isActive ? '#667eea' : 'transparent';
            t.style.color = isActive ? 'white' : '#666';
            t.style.fontWeight = isActive ? '700' : '500';
        });
        renderTab(key);
    }

    async function fetchAndRender() {
        const content = document.getElementById('ranking-content');
        if (!content) return;
        content.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">로딩 중...</div>';

        const data = await fetchRanking();
        if (!data) {
            content.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">랭킹 데이터를 불러올 수 없습니다.</div>';
            return;
        }

        // 탭 생성
        const tabsEl = document.getElementById('ranking-tabs');
        tabsEl.innerHTML = '';
        const tabs = [
            { label: '종합', key: 'overall' },
            { label: '주사위', key: 'dice' },
            { label: '경마', key: 'horse' },
            { label: '룰렛', key: 'roulette' }
        ];
        if (data.serverType === 'private') {
            tabs.push({ label: '주문', key: 'orders' });
        }
        tabs.forEach((t, i) => tabsEl.appendChild(createTab(t.label, t.key, i === 0)));
        renderTab('overall');
    }

    function renderTab(key) {
        const content = document.getElementById('ranking-content');
        if (!content || !_cache) return;

        switch (key) {
            case 'overall': renderOverall(content); break;
            case 'dice': renderGame(content, _cache.dice, '주사위'); break;
            case 'horse': renderHorse(content); break;
            case 'roulette': renderGame(content, _cache.roulette, '룰렛'); break;
            case 'orders': renderOrders(content); break;
        }
    }

    function renderOverall(el) {
        const d = _cache.overall;
        el.innerHTML = `
            ${renderSection('게임 참여 TOP', d.mostPlayed.map((r, i) => rankRow(i + 1, r.name, `${r.games}게임`)))}
            ${renderSection('승리 TOP', d.mostWins.map((r, i) => rankRow(i + 1, r.name, `${r.wins}승`)))}
            ${renderSection('승률 TOP (5게임+)', d.winRate.map((r, i) => rankRow(i + 1, r.name, `${r.winRate}% (${r.wins}/${r.games})`)))}
        `;
        if (!d.mostPlayed.length && !d.mostWins.length) {
            el.innerHTML = emptyMsg('아직 게임 기록이 없습니다.');
        }
    }

    function renderGame(el, d, label) {
        el.innerHTML = `
            ${renderSection(`${label} 승리 TOP`, d.winners.map((r, i) => rankRow(i + 1, r.name, `${r.wins}승 / ${r.games}게임`)))}
            ${renderSection(`${label} 참여 TOP`, d.players.map((r, i) => rankRow(i + 1, r.name, `${r.games}게임`)))}
        `;
        if (!d.winners.length) {
            el.innerHTML = emptyMsg(`아직 ${label} 기록이 없습니다.`);
        }
    }

    function renderHorse(el) {
        const d = _cache.horseRace;
        const vehicleNames = {
            'car': '자동차', 'rocket': '로켓', 'bird': '새', 'boat': '보트', 'bicycle': '자전거',
            'rabbit': '토끼', 'turtle': '거북이', 'eagle': '독수리', 'scooter': '킥보드', 'helicopter': '헬리콥터', 'horse': '말'
        };
        let html = renderSection('경마 승리 TOP', d.winners.map((r, i) => rankRow(i + 1, r.name, `${r.wins}승 / ${r.games}게임`)));
        if (d.popularHorse) {
            html += renderSection('인기 탈것', [`<div style="padding:8px 12px;background:#f0f4ff;border-radius:10px;color:#333;font-weight:600;">⭐ ${vehicleNames[d.popularHorse] || d.popularHorse}</div>`]);
        }
        if (d.worstHorse) {
            html += renderSection('꼴등 단골', [`<div style="padding:8px 12px;background:#fff0f0;border-radius:10px;color:#333;font-weight:600;">💀 ${vehicleNames[d.worstHorse] || d.worstHorse}</div>`]);
        }
        el.innerHTML = html || emptyMsg('아직 경마 기록이 없습니다.');
    }

    function renderOrders(el) {
        const d = _cache.orders;
        if (!d) { el.innerHTML = emptyMsg('주문 데이터가 없습니다.'); return; }

        let html = '';
        if (d.myTopMenus && d.myTopMenus.length > 0) {
            html += renderSection('내 TOP 메뉴', d.myTopMenus.map((r, i) => rankRow(i + 1, r.menu, `${r.count}회`)));
        }
        html += renderSection('최다 주문자', d.topOrderers.map((r, i) => rankRow(i + 1, r.name, `${r.orders}회`)));
        html += renderSection('인기 메뉴', d.popularMenus.map((r, i) => rankRow(i + 1, r.menu, `${r.orders}회`)));

        el.innerHTML = html || emptyMsg('아직 주문 기록이 없습니다.');
    }

    function renderSection(title, rows) {
        if (!rows || rows.length === 0) return '';
        const rowsHtml = typeof rows[0] === 'string' ? rows.join('') : rows.join('');
        return `
            <div style="margin-bottom:24px;">
                <h3 style="margin:0 0 12px 0;font-size:1em;color:#333;font-weight:700;">${title}</h3>
                <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">${rowsHtml}</div>
            </div>
        `;
    }

    function rankRow(rank, name, value) {
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `<span style="color:#999;font-size:0.85em;min-width:24px;text-align:center;">${rank}</span>`;
        const highlight = rank <= 3 ? 'font-weight:600;' : '';
        return `
            <div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid #f0f0f0;gap:10px;${highlight}">
                <span style="min-width:28px;text-align:center;font-size:1.1em;">${medal}</span>
                <span style="flex:1;color:#333;font-size:0.95em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</span>
                <span style="color:#667eea;font-size:0.9em;font-weight:600;white-space:nowrap;">${escapeHtml(value)}</span>
            </div>
        `;
    }

    function emptyMsg(text) {
        return `<div style="text-align:center;padding:60px 20px;color:#aaa;font-size:0.95em;">${text}</div>`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { init, show, hide, invalidateCache };
})();
