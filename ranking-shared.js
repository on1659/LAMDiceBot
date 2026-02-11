// 랭킹 UI 오버레이 모듈 - 다크 게임 테마
const RankingModule = (function () {
    let _serverId = null;
    let _userName = null;
    let _overlay = null;
    let _cache = null;
    let _cacheTime = 0;
    const CACHE_TTL = 10000; // 10초

    // 탭 상태
    let _currentMainTab = 'overall';
    let _currentGameTab = 'dice';

    // 제스처 상태
    let _touchStartX = 0;
    let _touchStartY = 0;
    let _pullStartY = 0;
    let _isPulling = false;

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
        _currentMainTab = 'overall';
        _currentGameTab = 'dice';
        createOverlay();
        fetchAndRender();
    }

    function hide() {
        if (_overlay) {
            _overlay.style.opacity = '0';
            setTimeout(() => { if (_overlay) { _overlay.remove(); _overlay = null; } }, 250);
        }
    }

    // ─── CSS ───

    const CSS = `
        #ranking-overlay {
            position: fixed; inset: 0; z-index: 9999;
            background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
            display: flex; flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            opacity: 0; transition: opacity 0.25s ease;
        }
        #ranking-overlay.rk-visible { opacity: 1; }

        /* ── 헤더 ── */
        .rk-header {
            display: flex; align-items: center; gap: 12px;
            padding: 18px 16px 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #9B59B6 100%);
            color: white; flex-shrink: 0;
            position: relative; overflow: hidden;
        }
        .rk-header::before {
            content: ''; position: absolute; top: -20px; right: -20px;
            width: 80px; height: 80px; border-radius: 50%;
            background: rgba(255,255,255,0.1);
        }
        .rk-header::after {
            content: ''; position: absolute; bottom: -30px; left: 30%;
            width: 60px; height: 60px; border-radius: 50%;
            background: rgba(255,255,255,0.08);
        }
        .rk-back-btn {
            background: rgba(255,255,255,0.2); border: none; color: white;
            width: 38px; height: 38px; border-radius: 12px;
            font-size: 1.15em; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: background 0.2s; z-index: 1;
        }
        .rk-back-btn:hover { background: rgba(255,255,255,0.3); }
        .rk-back-btn:active { transform: scale(0.95); }
        .rk-header-title {
            font-family: 'Jua', sans-serif;
            font-size: 1.35em; font-weight: 700;
            text-shadow: 0 2px 4px rgba(0,0,0,0.15);
            z-index: 1;
        }

        /* ── 메인 탭 ── */
        .rk-tabs {
            display: flex; justify-content: center; gap: 8px;
            padding: 12px 16px;
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid rgba(255,255,255,0.06);
            flex-shrink: 0;
        }
        .rk-tab {
            flex: 1; max-width: 160px;
            padding: 11px 20px; border: none;
            border-radius: 14px;
            font-family: 'Jua', sans-serif;
            font-size: 1em; cursor: pointer;
            border: 2px solid rgba(102,126,234,0.2);
            background: rgba(255,255,255,0.04);
            color: rgba(255,255,255,0.5);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            white-space: nowrap;
        }
        .rk-tab.active {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white; border-color: transparent;
            box-shadow: 0 4px 16px rgba(102,126,234,0.4);
            transform: scale(1.03);
        }
        .rk-tab:not(.active):hover {
            background: rgba(255,255,255,0.08);
            color: rgba(255,255,255,0.7);
            border-color: rgba(102,126,234,0.3);
        }
        .rk-tab:active { transform: scale(0.97); }

        /* ── 게임 서브탭 ── */
        .rk-game-tabs {
            display: flex; justify-content: center; gap: 6px;
            padding: 8px 16px 12px;
            background: rgba(255,255,255,0.02);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            overflow-x: auto; flex-shrink: 0;
            animation: rkSlideDown 0.25s ease;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
        }
        .rk-game-tabs::-webkit-scrollbar { display: none; }
        .rk-game-chip {
            padding: 7px 14px; border: none;
            border-radius: 20px;
            font-family: 'Jua', sans-serif;
            font-size: 0.88em; cursor: pointer;
            border: 1.5px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.04);
            color: rgba(255,255,255,0.45);
            transition: all 0.25s; white-space: nowrap;
        }
        .rk-game-chip:active { transform: scale(0.95); }

        /* ── 콘텐츠 ── */
        .rk-content {
            flex: 1; overflow-y: auto;
            padding: 16px;
            -webkit-overflow-scrolling: touch;
            transition: opacity 0.15s ease, transform 0.15s ease;
        }

        /* ── 섹션 ── */
        .rk-section {
            margin-bottom: 20px;
            animation: rkFadeInUp 0.35s ease both;
        }
        .rk-section:nth-child(2) { animation-delay: 0.05s; }
        .rk-section:nth-child(3) { animation-delay: 0.1s; }
        .rk-section:nth-child(4) { animation-delay: 0.15s; }
        .rk-section-title {
            font-family: 'Jua', sans-serif;
            font-size: 0.95em; color: #8B9CF7;
            margin: 0 0 10px 4px;
            display: flex; align-items: center; gap: 8px;
        }
        .rk-section-title::after {
            content: ''; flex: 1; height: 1px;
            background: linear-gradient(90deg, rgba(102,126,234,0.3), transparent);
        }

        /* ── 카드 ── */
        .rk-card {
            background: rgba(255,255,255,0.06);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.08);
            overflow: hidden;
        }

        /* ── 행 ── */
        .rk-row {
            display: flex; align-items: center;
            padding: 13px 16px; gap: 12px;
            border-bottom: 1px solid rgba(255,255,255,0.04);
            transition: background 0.2s;
        }
        .rk-row:last-child { border-bottom: none; }
        .rk-row:hover { background: rgba(255,255,255,0.03); }
        .rk-rank {
            min-width: 32px; text-align: center;
            flex-shrink: 0;
        }
        .rk-name {
            flex: 1; color: rgba(255,255,255,0.85); font-size: 0.93em;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rk-top3 .rk-name { font-weight: 600; color: rgba(255,255,255,0.95); }
        .rk-value {
            color: #FFD700; font-size: 0.88em; font-weight: 600;
            white-space: nowrap;
        }

        /* ── 메달 뱃지 ── */
        .rk-medal {
            display: inline-flex; align-items: center; justify-content: center;
            width: 32px; height: 32px; border-radius: 50%;
            font-family: 'Jua', sans-serif;
            font-size: 0.85em; font-weight: 700; color: white;
        }
        .rk-gold {
            background: linear-gradient(135deg, #FFD700, #FFA500);
            box-shadow: 0 0 12px rgba(255,215,0,0.5);
            animation: rkPulseGold 2.5s ease-in-out infinite;
        }
        .rk-silver {
            background: linear-gradient(135deg, #C0C0C0, #A8A8A8);
            box-shadow: 0 0 8px rgba(192,192,192,0.3);
        }
        .rk-bronze {
            background: linear-gradient(135deg, #CD7F32, #B87333);
            box-shadow: 0 0 8px rgba(205,127,50,0.3);
        }
        .rk-rank-num {
            display: inline-flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; border-radius: 50%;
            font-size: 0.8em; font-weight: 700;
            color: rgba(255,255,255,0.35);
            background: rgba(255,255,255,0.06);
        }

        /* ── 빈 상태 ── */
        .rk-empty {
            text-align: center; padding: 60px 20px;
            color: rgba(255,255,255,0.35);
            font-family: 'Jua', sans-serif;
            font-size: 1em;
        }
        .rk-empty-icon {
            font-size: 3em; margin-bottom: 12px; opacity: 0.5;
        }

        /* ── 스켈레톤 로딩 ── */
        .rk-skeleton-section { margin-bottom: 20px; }
        .rk-skeleton-card {
            background: rgba(255,255,255,0.06);
            border-radius: 16px; padding: 4px 0;
            border: 1px solid rgba(255,255,255,0.08);
        }
        .rk-skeleton-row {
            display: flex; align-items: center;
            padding: 14px 16px; gap: 12px;
        }
        .rk-skeleton-circle {
            width: 32px; height: 32px; border-radius: 50%;
            background: rgba(255,255,255,0.07);
            animation: rkShimmer 1.5s ease-in-out infinite;
            flex-shrink: 0;
        }
        .rk-skeleton-bar {
            height: 16px; border-radius: 8px;
            background: rgba(255,255,255,0.07);
            animation: rkShimmer 1.5s ease-in-out infinite;
        }

        /* ── 당겨서 새로고침 ── */
        .rk-pull-indicator {
            text-align: center; padding: 12px;
            color: rgba(255,255,255,0.4);
            font-family: 'Jua', sans-serif;
            font-size: 0.85em; transition: opacity 0.2s;
        }

        /* ── 탈것 등수 테이블 ── */
        .rk-vehicle-table {
            width: 100%; border-collapse: collapse;
            font-size: 0.85em;
        }
        .rk-vehicle-table th {
            padding: 10px 6px; text-align: center;
            color: rgba(255,255,255,0.4); font-weight: 600;
            font-size: 0.85em;
            border-bottom: 2px solid rgba(255,255,255,0.08);
        }
        .rk-vehicle-table th:first-child { text-align: left; padding-left: 14px; }
        .rk-vehicle-table td {
            padding: 10px 6px; text-align: center;
            color: rgba(255,255,255,0.6);
            border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .rk-vehicle-table td:first-child {
            text-align: left; padding-left: 14px;
            font-weight: 600; color: rgba(255,255,255,0.85);
        }
        .rk-vehicle-table tr:last-child td { border-bottom: none; }
        .rk-vehicle-table tr:hover td { background: rgba(255,255,255,0.03); }
        .rk-rank-cell {
            display: inline-flex; align-items: center; justify-content: center;
            min-width: 26px; height: 22px; border-radius: 6px;
            font-weight: 600; font-size: 0.9em;
        }
        .rk-rank-1 { background: rgba(255,215,0,0.15); color: #FFD700; }
        .rk-rank-6 { background: rgba(239,68,68,0.15); color: #ef4444; }

        /* ── 애니메이션 ── */
        @keyframes rkSpin { to { transform: rotate(360deg); } }
        @keyframes rkShimmer {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
        }
        @keyframes rkSlideDown {
            from { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
            to { opacity: 1; max-height: 60px; }
        }
        @keyframes rkPulseGold {
            0%, 100% { box-shadow: 0 0 12px rgba(255,215,0,0.5); }
            50% { box-shadow: 0 0 20px rgba(255,215,0,0.8); }
        }
        @keyframes rkFadeInUp {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;

    // ─── 오버레이 생성 ───

    function createOverlay() {
        _overlay = document.createElement('div');
        _overlay.id = 'ranking-overlay';
        _overlay.innerHTML = `
            <style>${CSS}</style>
            <div class="rk-header">
                <button class="rk-back-btn" onclick="RankingModule.hide()">&#8592;</button>
                <span class="rk-header-title">🏆 랭킹</span>
            </div>
            <div class="rk-tabs" id="ranking-tabs"></div>
            <div class="rk-game-tabs" id="ranking-game-tabs" style="display:none;"></div>
            <div class="rk-content" id="ranking-content"></div>
        `;

        document.body.appendChild(_overlay);
        requestAnimationFrame(() => _overlay.classList.add('rk-visible'));
        setupGestures();
        setupPullToRefresh();
    }

    // ─── 탭 전환 ───

    function switchMainTab(key) {
        _currentMainTab = key;
        const tabs = _overlay.querySelectorAll('.rk-tab');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === key));

        const gameTabsEl = document.getElementById('ranking-game-tabs');
        if (key === 'games') {
            gameTabsEl.style.display = 'flex';
            renderGameContent(_currentGameTab);
        } else {
            gameTabsEl.style.display = 'none';
            setContentWithTransition(document.getElementById('ranking-content'), () => {
                renderOverall(document.getElementById('ranking-content'));
            });
        }
    }

    function switchGameSubTab(key) {
        _currentGameTab = key;
        const chips = _overlay.querySelectorAll('.rk-game-chip');
        chips.forEach(c => {
            const isActive = c.dataset.game === key;
            c.classList.toggle('active', isActive);
            if (isActive) {
                c.style.background = c.dataset.color;
                c.style.borderColor = c.dataset.color;
                c.style.color = 'white';
            } else {
                c.style.background = 'rgba(255,255,255,0.04)';
                c.style.borderColor = 'rgba(255,255,255,0.12)';
                c.style.color = 'rgba(255,255,255,0.45)';
            }
        });
        renderGameContent(key);
    }

    function renderGameContent(key) {
        const el = document.getElementById('ranking-content');
        if (!el || !_cache) return;
        setContentWithTransition(el, () => {
            switch (key) {
                case 'dice': renderGame(el, _cache.dice, '주사위'); break;
                case 'horse': renderHorse(el); break;
                case 'roulette': renderGame(el, _cache.roulette, '룰렛'); break;
                case 'orders': renderOrders(el); break;
            }
        });
    }

    // ─── 콘텐츠 전환 애니메이션 ───

    function setContentWithTransition(el, renderFn) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(8px)';
        setTimeout(() => {
            renderFn();
            el.scrollTop = 0;
            requestAnimationFrame(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            });
        }, 150);
    }

    // ─── 스켈레톤 로딩 ───

    function skeletonHTML() {
        const skRow = `
            <div class="rk-skeleton-row">
                <div class="rk-skeleton-circle"></div>
                <div class="rk-skeleton-bar" style="flex:1;"></div>
                <div class="rk-skeleton-bar" style="width:60px;"></div>
            </div>`;
        return `
            <div class="rk-skeleton-section">
                <div class="rk-skeleton-bar" style="width:120px;height:14px;margin-bottom:12px;margin-left:4px;"></div>
                <div class="rk-skeleton-card">${skRow.repeat(5)}</div>
            </div>
            <div class="rk-skeleton-section">
                <div class="rk-skeleton-bar" style="width:100px;height:14px;margin-bottom:12px;margin-left:4px;"></div>
                <div class="rk-skeleton-card">${skRow.repeat(4)}</div>
            </div>
        `;
    }

    // ─── 데이터 로드 + 렌더링 ───

    async function fetchAndRender() {
        const content = document.getElementById('ranking-content');
        if (!content) return;
        content.innerHTML = skeletonHTML();

        const data = await fetchRanking();
        if (!data) {
            content.innerHTML = emptyMsg('랭킹 데이터를 불러올 수 없습니다.');
            return;
        }

        // 메인 탭 생성
        const tabsEl = document.getElementById('ranking-tabs');
        tabsEl.innerHTML = '';
        const mainTabs = [
            { label: '🏆 종합', key: 'overall' },
            { label: '🎮 게임별', key: 'games' }
        ];
        mainTabs.forEach((t, i) => {
            const btn = document.createElement('button');
            btn.className = 'rk-tab' + (i === 0 ? ' active' : '');
            btn.textContent = t.label;
            btn.dataset.tab = t.key;
            btn.onclick = () => switchMainTab(t.key);
            tabsEl.appendChild(btn);
        });

        // 게임 서브탭 생성
        const gameTabsEl = document.getElementById('ranking-game-tabs');
        gameTabsEl.innerHTML = '';
        const gameTabs = [
            { label: '🎲 주사위', key: 'dice', color: '#667eea' },
            { label: '🐎 경마', key: 'horse', color: '#e67e22' },
            { label: '🎰 룰렛', key: 'roulette', color: '#7c4dff' }
        ];
        if (data.serverType === 'private') {
            gameTabs.push({ label: '🍜 주문', key: 'orders', color: '#e91e63' });
        }
        gameTabs.forEach((t, i) => {
            const chip = document.createElement('button');
            chip.className = 'rk-game-chip';
            chip.textContent = t.label;
            chip.dataset.game = t.key;
            chip.dataset.color = t.color;
            if (i === 0) {
                chip.classList.add('active');
                chip.style.background = t.color;
                chip.style.borderColor = t.color;
                chip.style.color = 'white';
            }
            chip.onclick = () => switchGameSubTab(t.key);
            gameTabsEl.appendChild(chip);
        });

        // 기본 탭 렌더링
        renderOverall(content);
    }

    // ─── 렌더러 ───

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

        if (d.vehicles && d.vehicles.length > 0) {
            let tableHtml = `
                <div class="rk-section" style="animation: rkFadeInUp 0.35s ease 0.1s both;">
                    <div class="rk-section-title">탈것 등수 분포</div>
                    <div class="rk-card" style="padding:0;">
                        <table class="rk-vehicle-table">
                            <thead><tr>
                                <th>탈것</th>
                                <th>1등</th><th>2등</th><th>3등</th>
                                <th>4등</th><th>5등</th><th>6등</th>
                            </tr></thead>
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
        let medal;
        if (rank === 1) {
            medal = '<span class="rk-medal rk-gold">1</span>';
        } else if (rank === 2) {
            medal = '<span class="rk-medal rk-silver">2</span>';
        } else if (rank === 3) {
            medal = '<span class="rk-medal rk-bronze">3</span>';
        } else {
            medal = `<span class="rk-rank-num">${rank}</span>`;
        }
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
        return `<div class="rk-empty">
            <div class="rk-empty-icon">🎮</div>
            <div>${text}</div>
        </div>`;
    }

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── 스와이프 제스처 ───

    function getGameTabKeys() {
        const keys = ['dice', 'horse', 'roulette'];
        if (_cache && _cache.serverType === 'private') keys.push('orders');
        return keys;
    }

    function setupGestures() {
        const content = document.getElementById('ranking-content');
        if (!content) return;

        content.addEventListener('touchstart', function (e) {
            _touchStartX = e.touches[0].clientX;
            _touchStartY = e.touches[0].clientY;
        }, { passive: true });

        content.addEventListener('touchend', function (e) {
            const dx = e.changedTouches[0].clientX - _touchStartX;
            const dy = e.changedTouches[0].clientY - _touchStartY;

            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                if (_currentMainTab === 'overall' && dx < 0) {
                    switchMainTab('games');
                } else if (_currentMainTab === 'games' && dx > 0) {
                    // 게임별 첫 번째 서브탭에서 오른쪽 스와이프 → 종합으로
                    const keys = getGameTabKeys();
                    if (keys.indexOf(_currentGameTab) === 0) {
                        switchMainTab('overall');
                    } else {
                        const idx = keys.indexOf(_currentGameTab);
                        if (idx > 0) switchGameSubTab(keys[idx - 1]);
                    }
                } else if (_currentMainTab === 'games') {
                    const keys = getGameTabKeys();
                    const idx = keys.indexOf(_currentGameTab);
                    if (dx < 0 && idx < keys.length - 1) {
                        switchGameSubTab(keys[idx + 1]);
                    } else if (dx > 0 && idx > 0) {
                        switchGameSubTab(keys[idx - 1]);
                    }
                }
            }
        }, { passive: true });
    }

    // ─── 당겨서 새로고침 ───

    function setupPullToRefresh() {
        const content = document.getElementById('ranking-content');
        if (!content) return;

        let pullIndicator = null;

        content.addEventListener('touchstart', function (e) {
            if (content.scrollTop <= 0) {
                _pullStartY = e.touches[0].clientY;
                _isPulling = true;
            }
        }, { passive: true });

        content.addEventListener('touchmove', function (e) {
            if (!_isPulling) return;
            const dy = e.touches[0].clientY - _pullStartY;
            if (dy > 0 && content.scrollTop <= 0) {
                if (!pullIndicator) {
                    pullIndicator = document.createElement('div');
                    pullIndicator.className = 'rk-pull-indicator';
                    pullIndicator.textContent = '↓ 당겨서 새로고침';
                    content.prepend(pullIndicator);
                }
                const progress = Math.min(dy / 80, 1);
                pullIndicator.style.opacity = String(progress);
                pullIndicator.style.transform = 'translateY(' + Math.min(dy * 0.4, 40) + 'px)';
                if (progress >= 1) {
                    pullIndicator.textContent = '↑ 놓으면 새로고침';
                }
            }
        }, { passive: true });

        content.addEventListener('touchend', function (e) {
            if (!_isPulling) return;
            _isPulling = false;
            const dy = e.changedTouches[0].clientY - _pullStartY;
            if (pullIndicator) {
                pullIndicator.remove();
                pullIndicator = null;
            }
            if (dy > 80 && content.scrollTop <= 0) {
                invalidateCache();
                fetchAndRender();
            }
        }, { passive: true });
    }

    return { init, show, hide, invalidateCache };
})();
