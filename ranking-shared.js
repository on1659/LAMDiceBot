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
        if (_overlay) { _overlay.remove(); _overlay = null; }
        createOverlay();
        fetchAndRender();
    }

    function hide() {
        if (_overlay) {
            _overlay.style.opacity = '0';
            setTimeout(() => { if (_overlay) { _overlay.remove(); _overlay = null; } }, 200);
        }
    }

    function createOverlay() {
        _overlay = document.createElement('div');
        _overlay.id = 'ranking-overlay';
        _overlay.innerHTML = `
            <style>
                #ranking-overlay {
                    position: fixed; inset: 0; z-index: 9999;
                    background: #f5f6fa;
                    display: flex; flex-direction: column;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    opacity: 0; transition: opacity 0.2s ease;
                }
                #ranking-overlay.rk-visible { opacity: 1; }

                .rk-header {
                    display: flex; align-items: center; gap: 12px;
                    padding: 14px 16px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white; flex-shrink: 0;
                }
                .rk-back-btn {
                    background: rgba(255,255,255,0.15); border: none; color: white;
                    width: 36px; height: 36px; border-radius: 10px;
                    font-size: 1.1em; cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    transition: background 0.2s;
                }
                .rk-back-btn:hover { background: rgba(255,255,255,0.25); }
                .rk-header-title { font-size: 1.15em; font-weight: 700; }

                .rk-tabs {
                    display: flex; gap: 4px;
                    background: white; border-bottom: 1px solid #eee;
                    overflow-x: auto; flex-shrink: 0;
                    padding: 6px 12px;
                    -webkit-overflow-scrolling: touch;
                    scrollbar-width: none;
                }
                .rk-tabs::-webkit-scrollbar { display: none; }
                .rk-tab {
                    padding: 8px 16px; border: none;
                    background: transparent; color: #888;
                    font-size: 0.88em; font-weight: 500;
                    cursor: pointer; border-radius: 20px;
                    white-space: nowrap; transition: all 0.2s;
                }
                .rk-tab.active {
                    background: #667eea; color: white; font-weight: 600;
                    box-shadow: 0 2px 8px rgba(102,126,234,0.3);
                }
                .rk-tab:not(.active):hover { background: #f0f0f0; color: #555; }

                .rk-content {
                    flex: 1; overflow-y: auto;
                    padding: 16px;
                    -webkit-overflow-scrolling: touch;
                }

                .rk-section { margin-bottom: 20px; }
                .rk-section-title {
                    font-size: 0.85em; font-weight: 600; color: #888;
                    text-transform: uppercase; letter-spacing: 0.5px;
                    margin: 0 0 8px 4px;
                }
                .rk-card {
                    background: white; border-radius: 14px;
                    overflow: hidden;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
                }
                .rk-row {
                    display: flex; align-items: center;
                    padding: 11px 14px; gap: 10px;
                    border-bottom: 1px solid #f5f5f5;
                    transition: background 0.15s;
                }
                .rk-row:last-child { border-bottom: none; }
                .rk-row:hover { background: #fafbff; }
                .rk-rank {
                    min-width: 28px; text-align: center;
                    font-size: 1.05em; flex-shrink: 0;
                }
                .rk-rank-num {
                    display: inline-flex; align-items: center; justify-content: center;
                    width: 24px; height: 24px; border-radius: 8px;
                    font-size: 0.8em; font-weight: 700; color: #aaa;
                    background: #f5f5f5;
                }
                .rk-name {
                    flex: 1; color: #333; font-size: 0.93em;
                    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                }
                .rk-top3 .rk-name { font-weight: 600; }
                .rk-value {
                    color: #667eea; font-size: 0.88em; font-weight: 600;
                    white-space: nowrap;
                }
                .rk-empty {
                    text-align: center; padding: 48px 20px;
                    color: #bbb; font-size: 0.93em;
                }
                .rk-loading {
                    text-align: center; padding: 48px 20px;
                    color: #999; font-size: 0.93em;
                }
                .rk-loading .rk-spinner {
                    display: inline-block; width: 24px; height: 24px;
                    border: 3px solid #eee; border-top-color: #667eea;
                    border-radius: 50%; animation: rkSpin 0.7s linear infinite;
                    margin-bottom: 12px;
                }
                @keyframes rkSpin { to { transform: rotate(360deg); } }

                /* 탈것 등수 테이블 */
                .rk-vehicle-table {
                    width: 100%; border-collapse: collapse;
                    font-size: 0.85em;
                }
                .rk-vehicle-table th {
                    padding: 8px 6px; text-align: center;
                    color: #999; font-weight: 600; font-size: 0.85em;
                    border-bottom: 2px solid #eee;
                }
                .rk-vehicle-table th:first-child { text-align: left; padding-left: 14px; }
                .rk-vehicle-table td {
                    padding: 9px 6px; text-align: center;
                    color: #555; border-bottom: 1px solid #f5f5f5;
                }
                .rk-vehicle-table td:first-child {
                    text-align: left; padding-left: 14px;
                    font-weight: 600; color: #333;
                }
                .rk-vehicle-table tr:last-child td { border-bottom: none; }
                .rk-vehicle-table tr:hover td { background: #fafbff; }
                .rk-rank-cell {
                    display: inline-flex; align-items: center; justify-content: center;
                    min-width: 26px; height: 22px; border-radius: 6px;
                    font-weight: 600; font-size: 0.9em;
                }
                .rk-rank-1 { background: #fff8e1; color: #f59e0b; }
                .rk-rank-6 { background: #fef2f2; color: #ef4444; }
            </style>

            <div class="rk-header">
                <button class="rk-back-btn" onclick="RankingModule.hide()">&#8592;</button>
                <span class="rk-header-title">랭킹</span>
            </div>
            <div class="rk-tabs" id="ranking-tabs"></div>
            <div class="rk-content" id="ranking-content"></div>
        `;

        document.body.appendChild(_overlay);
        requestAnimationFrame(() => _overlay.classList.add('rk-visible'));
    }

    function switchTab(key) {
        const tabs = _overlay.querySelectorAll('.rk-tab');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === key));
        renderTab(key);
    }

    async function fetchAndRender() {
        const content = document.getElementById('ranking-content');
        if (!content) return;
        content.innerHTML = '<div class="rk-loading"><div class="rk-spinner"></div><div>불러오는 중...</div></div>';

        const data = await fetchRanking();
        if (!data) {
            content.innerHTML = '<div class="rk-empty">랭킹 데이터를 불러올 수 없습니다.</div>';
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
        tabs.forEach((t, i) => {
            const btn = document.createElement('button');
            btn.className = 'rk-tab' + (i === 0 ? ' active' : '');
            btn.textContent = t.label;
            btn.dataset.tab = t.key;
            btn.onclick = () => switchTab(t.key);
            tabsEl.appendChild(btn);
        });
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
        if (!d.mostPlayed.length && !d.mostWins.length) {
            el.innerHTML = emptyMsg('아직 게임 기록이 없습니다.');
            return;
        }
        let html = '';
        html += section('게임 참여 TOP', d.mostPlayed.map((r, i) => row(i + 1, r.name, `${r.games}게임`)));
        html += section('승리 TOP', d.mostWins.map((r, i) => row(i + 1, r.name, `${r.wins}승`)));
        html += section('승률 TOP (5게임+)', d.winRate.map((r, i) => row(i + 1, r.name, `${r.winRate}% (${r.wins}/${r.games})`)));
        if (d.avgRank && d.avgRank.length > 0) {
            html += section('평균 등수 TOP', d.avgRank.map((r, i) => row(i + 1, r.name, `${r.avgRank}등 (TOP3: ${r.top3}회)`)));
        }
        el.innerHTML = html;
    }

    function renderGame(el, d, label) {
        if (!d.winners.length) {
            el.innerHTML = emptyMsg(`아직 ${label} 기록이 없습니다.`);
            return;
        }
        let html = '';
        html += section(`${label} 승리 TOP`, d.winners.map((r, i) => row(i + 1, r.name, `${r.wins}승 / ${r.games}게임`)));
        html += section(`${label} 참여 TOP`, d.players.map((r, i) => row(i + 1, r.name, `${r.games}게임`)));
        el.innerHTML = html;
    }

    function renderHorse(el) {
        const d = _cache.horseRace;
        const VN = {
            'car': '자동차', 'rocket': '로켓', 'bird': '새', 'boat': '보트', 'bicycle': '자전거',
            'rabbit': '토끼', 'turtle': '거북이', 'eagle': '독수리', 'scooter': '킥보드', 'helicopter': '헬리콥터', 'horse': '말'
        };

        if (!d.winners.length && (!d.vehicles || !d.vehicles.length)) {
            el.innerHTML = emptyMsg('아직 경마 기록이 없습니다.');
            return;
        }

        let html = '';
        html += section('경마 승리 TOP', d.winners.map((r, i) => row(i + 1, r.name, `${r.wins}승 / ${r.games}게임`)));

        // 탈것 등수 분포 테이블
        if (d.vehicles && d.vehicles.length > 0) {
            let tableHtml = `
                <div class="rk-section">
                    <div class="rk-section-title">탈것 등수 분포</div>
                    <div class="rk-card" style="padding:0;">
                        <table class="rk-vehicle-table">
                            <thead>
                                <tr>
                                    <th>탈것</th>
                                    <th>1등</th><th>2등</th><th>3등</th>
                                    <th>4등</th><th>5등</th><th>6등</th>
                                </tr>
                            </thead>
                            <tbody>`;
            d.vehicles.forEach(v => {
                const name = VN[v.id] || v.id;
                const r = v.ranks;
                tableHtml += `<tr>
                    <td>${esc(name)}</td>
                    <td><span class="rk-rank-cell${r[0] > 0 ? ' rk-rank-1' : ''}">${r[0]}</span></td>
                    <td>${r[1]}</td><td>${r[2]}</td>
                    <td>${r[3]}</td><td>${r[4]}</td>
                    <td><span class="rk-rank-cell${r[5] > 0 ? ' rk-rank-6' : ''}">${r[5]}</span></td>
                </tr>`;
            });
            tableHtml += '</tbody></table></div></div>';
            html += tableHtml;
        }

        el.innerHTML = html;
    }

    function renderOrders(el) {
        const d = _cache.orders;
        if (!d) { el.innerHTML = emptyMsg('주문 데이터가 없습니다.'); return; }

        let html = '';
        if (d.myTopMenus && d.myTopMenus.length > 0) {
            html += section('내 TOP 메뉴', d.myTopMenus.map((r, i) => row(i + 1, r.menu, `${r.count}회`)));
        }
        html += section('최다 주문자', d.topOrderers.map((r, i) => row(i + 1, r.name, `${r.orders}회`)));
        html += section('인기 메뉴', d.popularMenus.map((r, i) => row(i + 1, r.menu, `${r.orders}회`)));

        el.innerHTML = html || emptyMsg('아직 주문 기록이 없습니다.');
    }

    // ─── 렌더 헬퍼 ───

    function section(title, rows) {
        if (!rows || rows.length === 0) return '';
        return `
            <div class="rk-section">
                <div class="rk-section-title">${title}</div>
                <div class="rk-card">${rows.join('')}</div>
            </div>
        `;
    }

    function row(rank, name, value) {
        const medal = rank === 1 ? '<span style="font-size:1.1em">🥇</span>'
            : rank === 2 ? '<span style="font-size:1.1em">🥈</span>'
            : rank === 3 ? '<span style="font-size:1.1em">🥉</span>'
            : `<span class="rk-rank-num">${rank}</span>`;
        const top3Class = rank <= 3 ? ' rk-top3' : '';
        return `
            <div class="rk-row${top3Class}">
                <span class="rk-rank">${medal}</span>
                <span class="rk-name">${esc(name)}</span>
                <span class="rk-value">${esc(value)}</span>
            </div>
        `;
    }

    function emptyMsg(text) {
        return `<div class="rk-empty">${text}</div>`;
    }

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { init, show, hide, invalidateCache };
})();
