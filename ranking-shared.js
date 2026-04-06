// 랭킹 UI 오버레이 모듈 - 다크 게임 테마
const RankingModule = (function () {
    let _serverId = null;
    let _userName = null;
    let _isHost = false;
    let _overlay = null;
    let _cache = null;
    let _cacheTime = 0;
    const CACHE_TTL = 10000; // 10초
    let _currentSeason = 1;
    let _viewingSeason = null; // null = 현재 시즌

    // 탭 상태
    let _currentMainTab = 'overall';
    let _currentGameTab = 'dice';
    let _currentOverallSubTab = 'rank'; // 'rank' | 'participant'

    // 제스처 상태
    let _touchStartX = 0;
    let _touchStartY = 0;
    let _pullStartY = 0;
    let _isPulling = false;
    let _searchResult = null; // { found, userName, myRank } | null

    function init(serverId, userName) {
        _serverId = serverId;
        _userName = userName;
    }

    function setHost(isHost) {
        _isHost = !!isHost;
        if (_overlay) {
            const btn = _overlay.querySelector('.rk-reset-btn');
            if (btn) btn.style.display = (_isHost && _serverId && !_viewingSeason) ? 'flex' : 'none';
        }
    }

    function invalidateCache() {
        _cache = null;
        _cacheTime = 0;
    }

    async function fetchRanking() {
        if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;
        let url;
        if (_viewingSeason && _serverId) {
            url = `/api/ranking/${_serverId}/season/${_viewingSeason}?userName=${encodeURIComponent(_userName || '')}`;
        } else if (_serverId) {
            url = `/api/ranking/${_serverId}?userName=${encodeURIComponent(_userName || '')}`;
        } else {
            url = '/api/ranking/free';
        }
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed');
            _cache = await res.json();
            _cacheTime = Date.now();
            if (_cache.currentSeason) {
                _currentSeason = _cache.currentSeason;
                updateSeasonTitle();
            }
            return _cache;
        } catch (e) {
            console.warn('랭킹 조회 실패:', e);
            return null;
        }
    }

    function show(gameType) {
        if (_overlay) { _overlay.remove(); _overlay = null; }
        if (gameType) {
            _currentMainTab = 'games';
            _currentGameTab = gameType;
        } else {
            _currentMainTab = 'overall';
            _currentGameTab = 'dice';
        }
        _searchResult = null;
        _viewingSeason = null;
        if (typeof PageHistoryManager !== 'undefined') PageHistoryManager.pushPage('ranking');
        createOverlay();
        fetchAndRender().then(() => fetchSeasonList());
    }

    function hide() {
        if (_overlay) {
            _overlay.style.opacity = '0';
            setTimeout(() => { if (_overlay) { _overlay.remove(); _overlay = null; } }, 250);
        }
        // UI 버튼으로 닫을 때 히스토리도 되돌리기
        if (history.state && history.state.page === 'ranking') {
            history.back();
        }
    }

    // popstate 핸들러에서 호출 (history.back 없이 DOM만 정리)
    function forceHide() {
        if (_overlay) {
            _overlay.style.opacity = '0';
            setTimeout(() => { if (_overlay) { _overlay.remove(); _overlay = null; } }, 250);
        }
    }

    // ─── CSS ───

    const CSS = `
        #ranking-overlay {
            --rk-bg-start: #1a1a2e;
            --rk-bg-end: #16213e;
            --rk-accent: #667eea;
            --rk-accent-light: #8B9CF7;
            --rk-accent-purple: #764ba2;
            --rk-accent-purple2: #9B59B6;
            --rk-gold: #FFD700;
            --rk-silver: #C0C0C0;
            --rk-bronze: #CD7F32;
            --rk-text: rgba(255,255,255,0.85);
            --rk-text-dim: rgba(255,255,255,0.5);
            --rk-text-muted: rgba(255,255,255,0.4);
            --rk-border: rgba(255,255,255,0.08);
            --rk-border-light: rgba(255,255,255,0.12);
            --rk-surface: rgba(255,255,255,0.06);
            --rk-surface-hover: rgba(255,255,255,0.03);
            --rk-btn-bg: rgba(255,255,255,0.2);
            --rk-btn-hover: rgba(255,255,255,0.3);

            position: fixed; inset: 0; z-index: 9999;
            background: linear-gradient(180deg, var(--rk-bg-start) 0%, var(--rk-bg-end) 100%);
            display: flex; flex-direction: column;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            opacity: 0; transition: opacity 0.25s ease;
        }
        #ranking-overlay.rk-visible { opacity: 1; }
        @media (min-width: 768px) {
            .rk-content {
                max-width: 640px;
                margin-left: auto;
                margin-right: auto;
                width: 100%;
            }
        }

        /* ── 헤더 ── */
        .rk-header {
            display: flex; align-items: center; gap: 12px;
            padding: 18px 16px 14px;
            background: linear-gradient(135deg, var(--rk-accent) 0%, var(--rk-accent-purple) 50%, var(--rk-accent-purple2) 100%);
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
            background: var(--rk-btn-bg); border: none; color: white;
            width: 38px; height: 38px; border-radius: 12px;
            font-size: 1.15em; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: background 0.2s; z-index: 1;
        }
        .rk-back-btn:hover { background: var(--rk-btn-hover); }
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
            background: var(--rk-surface-hover);
            border-bottom: 1px solid var(--rk-surface);
            flex-shrink: 0;
        }
        .rk-tab {
            flex: 1; max-width: 160px;
            padding: 11px 20px; border: none;
            border-radius: 14px;
            font-family: 'Jua', sans-serif;
            font-size: 1em; cursor: pointer;
            border: 2px solid rgba(102,126,234,0.2); /* --rk-accent */
            background: rgba(255,255,255,0.04);
            color: var(--rk-text-dim);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            white-space: nowrap;
        }
        .rk-tab.active {
            background: linear-gradient(135deg, var(--rk-accent), var(--rk-accent-purple));
            color: white; border-color: transparent;
            box-shadow: 0 4px 16px rgba(102,126,234,0.4); /* --rk-accent */
            transform: scale(1.03);
        }
        .rk-tab:not(.active):hover {
            background: var(--rk-border);
            color: rgba(255,255,255,0.7);
            border-color: rgba(102,126,234,0.3); /* --rk-accent */
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
            border: 1.5px solid var(--rk-border-light);
            background: rgba(255,255,255,0.04);
            color: rgba(255,255,255,0.45);
            transition: all 0.25s; white-space: nowrap;
        }
        .rk-game-chip:active { transform: scale(0.95); }

        /* ── 검색 ── */
        .rk-search-wrap {
            display: flex; gap: 8px; padding: 10px 16px 12px;
            background: rgba(255,255,255,0.02);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            flex-shrink: 0;
        }
        .rk-search-input {
            flex: 1; padding: 10px 14px; border-radius: 12px;
            border: 1px solid var(--rk-border-light);
            background: var(--rk-surface);
            color: rgba(255,255,255,0.9);
            font-size: 0.95em;
        }
        .rk-search-input::placeholder { color: var(--rk-text-muted); }
        .rk-search-btn {
            padding: 10px 18px; border-radius: 12px; border: none;
            background: linear-gradient(135deg, var(--rk-accent), var(--rk-accent-purple));
            color: white; font-weight: 600; cursor: pointer;
            white-space: nowrap;
        }
        .rk-search-btn:active { transform: scale(0.97); }
        .rk-top10-label {
            font-family: 'Jua', sans-serif; font-size: 1em;
            color: var(--rk-accent-light); margin: 0 0 8px 4px; padding: 0;
        }
        .rk-my-rank-card, .rk-search-result-card {
            margin: 16px 0; padding: 14px 16px;
            border-radius: 16px; border: 1px solid var(--rk-border);
            background: var(--rk-surface);
        }
        .rk-my-rank-title, .rk-search-result-title {
            font-family: 'Jua', sans-serif; font-size: 0.95em;
            color: var(--rk-accent-light); margin-bottom: 8px;
        }
        .rk-my-rank-body, .rk-search-result-body {
            color: var(--rk-text); font-size: 0.9em; line-height: 1.6;
        }

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
            font-size: 0.95em; color: var(--rk-accent-light);
            margin: 0 0 10px 4px;
            display: flex; align-items: center; gap: 8px;
        }
        .rk-section-title::after {
            content: ''; flex: 1; height: 1px;
            background: linear-gradient(90deg, rgba(102,126,234,0.3), transparent); /* --rk-accent */
        }

        /* ── 카드 ── */
        .rk-card {
            background: var(--rk-surface);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 16px;
            border: 1px solid var(--rk-border);
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
        .rk-row:hover { background: var(--rk-surface-hover); }
        .rk-rank {
            min-width: 32px; text-align: center;
            flex-shrink: 0;
        }
        .rk-name {
            flex: 1; color: var(--rk-text); font-size: 0.93em;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rk-top3 .rk-name { font-weight: 600; color: rgba(255,255,255,0.95); }
        .rk-value {
            color: var(--rk-gold); font-size: 0.88em; font-weight: 600;
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
            background: linear-gradient(135deg, var(--rk-gold), #FFA500);
            box-shadow: 0 0 12px rgba(255,215,0,0.5); /* --rk-gold */
            animation: rkPulseGold 2.5s ease-in-out infinite;
        }
        .rk-silver {
            background: linear-gradient(135deg, var(--rk-silver), #A8A8A8);
            box-shadow: 0 0 8px rgba(192,192,192,0.3); /* --rk-silver */
        }
        .rk-bronze {
            background: linear-gradient(135deg, var(--rk-bronze), #B87333);
            box-shadow: 0 0 8px rgba(205,127,50,0.3); /* --rk-bronze */
        }
        .rk-rank-num {
            display: inline-flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; border-radius: 50%;
            font-size: 0.8em; font-weight: 700;
            color: rgba(255,255,255,0.35);
            background: var(--rk-surface);
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
            background: var(--rk-surface);
            border-radius: 16px; padding: 4px 0;
            border: 1px solid var(--rk-border);
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
            color: var(--rk-text-muted);
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
            color: var(--rk-text-muted); font-weight: 600;
            font-size: 0.85em;
            border-bottom: 2px solid var(--rk-border);
        }
        .rk-vehicle-table th:first-child { text-align: left; padding-left: 14px; }
        .rk-vehicle-table td {
            padding: 10px 6px; text-align: center;
            color: rgba(255,255,255,0.6);
            border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .rk-vehicle-table td:first-child {
            text-align: left; padding-left: 14px;
            font-weight: 600; color: var(--rk-text);
        }
        .rk-vehicle-table tr:last-child td { border-bottom: none; }
        .rk-vehicle-table tr:hover td { background: var(--rk-surface-hover); }
        .rk-rank-cell {
            display: inline-flex; align-items: center; justify-content: center;
            min-width: 26px; height: 22px; border-radius: 6px;
            font-weight: 600; font-size: 0.9em;
        }
        .rk-rank-1 { background: rgba(255,215,0,0.15); color: var(--rk-gold); }
        .rk-rank-6 { background: rgba(239,68,68,0.15); color: var(--red-500, #ef4444); } /* --red-500 */

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
            0%, 100% { box-shadow: 0 0 12px rgba(255,215,0,0.5); } /* --rk-gold */
            50% { box-shadow: 0 0 20px rgba(255,215,0,0.8); } /* --rk-gold */
        }
        @keyframes rkFadeInUp {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* ── 새 시즌 버튼 ── */
        .rk-reset-btn {
            background: var(--rk-btn-bg); border: none; color: white;
            width: 38px; height: 38px; border-radius: 12px;
            font-size: 1.15em; cursor: pointer;
            display: none; align-items: center; justify-content: center;
            transition: background 0.2s; z-index: 1;
            margin-left: auto;
        }
        .rk-reset-btn:hover { background: rgba(59,130,246,0.5); } /* --blue-500 */
        .rk-reset-btn:active { transform: scale(0.95); }

        /* ── 확인바 / 피드백바 ── */
        .rk-confirm-bar {
            display: flex; align-items: center; justify-content: center; gap: 12px;
            padding: 10px 16px;
            background: rgba(59,130,246,0.15); /* --blue-500 */
            border-bottom: 1px solid rgba(59,130,246,0.3); /* --blue-500 */
            font-family: 'Jua', sans-serif; font-size: 0.9em;
            color: rgba(255,255,255,0.9);
            flex-shrink: 0;
            animation: rkSlideDown 0.2s ease;
        }
        .rk-confirm-yes {
            padding: 6px 16px; border: none; border-radius: 8px;
            background: var(--blue-500); color: white;
            font-family: 'Jua', sans-serif; font-size: 0.85em;
            cursor: pointer; white-space: nowrap;
        }
        .rk-confirm-yes:active { transform: scale(0.95); }
        .rk-confirm-no {
            padding: 6px 16px; border: none; border-radius: 8px;
            background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8);
            font-family: 'Jua', sans-serif; font-size: 0.85em;
            cursor: pointer; white-space: nowrap;
        }
        .rk-confirm-no:active { transform: scale(0.95); }
        .rk-feedback-bar {
            display: flex; align-items: center; justify-content: center;
            padding: 10px 16px;
            font-family: 'Jua', sans-serif; font-size: 0.9em;
            color: white; flex-shrink: 0;
            animation: rkSlideDown 0.2s ease;
        }
        .rk-feedback-bar.success { background: rgba(40,167,69,0.3); /* --green-500 */ }
        .rk-feedback-bar.error { background: rgba(220,53,69,0.3); /* --red-500 */ }

        /* ── 시즌 셀렉터 ── */
        .rk-season-bar {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 16px;
            border-bottom: 1px solid var(--rk-surface);
        }
        .rk-season-select {
            background: var(--gray-900, var(--rk-bg-start));
            border: 1px solid rgba(255,255,255,0.15);
            color: white; border-radius: 8px;
            padding: 5px 10px; font-size: 0.85em;
            font-family: 'Jua', sans-serif;
        }
        .rk-season-label {
            color: var(--rk-text-dim);
            font-size: 0.8em;
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
                <span class="rk-header-title">🏆 랭킹 · 시즌 ${_currentSeason}</span>
                <button class="rk-reset-btn" style="display:${(_isHost && _serverId && !_viewingSeason) ? 'flex' : 'none'}" onclick="RankingModule._showConfirm()">&#128260;</button>
            </div>
            <div id="ranking-confirm-slot"></div>
            <div id="ranking-season-bar"></div>
            <div class="rk-tabs" id="ranking-tabs"></div>
            <div class="rk-game-tabs" id="ranking-overall-sub-tabs" style="display:none;"></div>
            <div class="rk-game-tabs" id="ranking-game-tabs" style="display:none;"></div>
            <div class="rk-search-wrap" id="ranking-search-wrap">
                <input type="text" class="rk-search-input" id="ranking-search-input" placeholder="닉네임 검색" maxlength="32" autocomplete="off">
                <button type="button" class="rk-search-btn" id="ranking-search-btn">검색</button>
            </div>
            <div class="rk-content" id="ranking-content"></div>
        `;

        document.body.appendChild(_overlay);
        requestAnimationFrame(() => _overlay.classList.add('rk-visible'));
        setupSearch();
        setupGestures();
        setupPullToRefresh();
    }

    function setupSearch() {
        const wrap = document.getElementById('ranking-search-wrap');
        const input = document.getElementById('ranking-search-input');
        const btn = document.getElementById('ranking-search-btn');
        if (!wrap || !input || !btn) return;
        function doSearch() {
            const q = (input.value || '').trim();
            if (!q) return;
            _searchResult = null;
            const url = _serverId
                ? `/api/ranking/${_serverId}/search?userName=${encodeURIComponent(q)}`
                : `/api/ranking/free/search?userName=${encodeURIComponent(q)}`;
            fetch(url).then(r => r.json()).then(data => {
                _searchResult = data;
                const content = document.getElementById('ranking-content');
                if (content && _overlay) {
                    if (_currentMainTab === 'overall') renderOverall(content);
                    else renderGameContent(_currentGameTab);
                }
            }).catch(() => {
                _searchResult = { found: false, userName: q };
                const content = document.getElementById('ranking-content');
                if (content && _overlay) {
                    if (_currentMainTab === 'overall') renderOverall(content);
                    else renderGameContent(_currentGameTab);
                }
            });
        }
        btn.addEventListener('click', doSearch);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    }

    // ─── 탭 전환 ───

    function switchMainTab(key) {
        _currentMainTab = key;
        const tabs = _overlay.querySelectorAll('.rk-tab');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === key));

        const overallSubTabsEl = document.getElementById('ranking-overall-sub-tabs');
        const gameTabsEl = document.getElementById('ranking-game-tabs');
        if (key === 'games') {
            if (overallSubTabsEl) overallSubTabsEl.style.display = 'none';
            gameTabsEl.style.display = 'flex';
            renderGameContent(_currentGameTab);
        } else {
            gameTabsEl.style.display = 'none';
            if (overallSubTabsEl) overallSubTabsEl.style.display = 'flex';
            setContentWithTransition(document.getElementById('ranking-content'), () => {
                renderOverall(document.getElementById('ranking-content'));
            });
        }
    }

    function switchOverallSubTab(key) {
        _currentOverallSubTab = key;
        const el = document.getElementById('ranking-overall-sub-tabs');
        if (el) {
            el.querySelectorAll('.rk-game-chip').forEach(c => {
                const isActive = c.dataset.overallSub === key;
                c.classList.toggle('active', isActive);
                if (isActive && c.dataset.color) {
                    c.style.background = c.dataset.color;
                    c.style.borderColor = c.dataset.color;
                    c.style.color = 'white';
                } else {
                    c.style.background = '';
                    c.style.borderColor = '';
                    c.style.color = '';
                }
            });
        }
        setContentWithTransition(document.getElementById('ranking-content'), () => {
            renderOverall(document.getElementById('ranking-content'));
        });
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
                c.style.background = '';
                c.style.borderColor = '';
                c.style.color = '';
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
        if (_viewingSeason) _currentMainTab = 'overall';
        const mainTabs = _viewingSeason
            ? [{ label: '🏆 종합', key: 'overall' }]
            : [{ label: '🏆 종합', key: 'overall' }, { label: '🎮 게임별', key: 'games' }];
        mainTabs.forEach((t) => {
            const btn = document.createElement('button');
            btn.className = 'rk-tab' + (t.key === _currentMainTab ? ' active' : '');
            btn.textContent = t.label;
            btn.dataset.tab = t.key;
            btn.onclick = () => switchMainTab(t.key);
            tabsEl.appendChild(btn);
        });

        // 종합 서브탭 (순위 | 참여)
        const overallSubTabsEl = document.getElementById('ranking-overall-sub-tabs');
        if (overallSubTabsEl) {
            overallSubTabsEl.innerHTML = '';
            _currentOverallSubTab = 'rank';
            const overallSubTabs = [
                { label: '🏅 순위', key: 'rank', color: '#667eea' },
                { label: '👥 참여', key: 'participant', color: '#27ae60' }
            ];
            overallSubTabs.forEach((t, i) => {
                const chip = document.createElement('button');
                chip.className = 'rk-game-chip';
                chip.textContent = t.label;
                chip.dataset.overallSub = t.key;
                chip.dataset.color = t.color;
                if (i === 0) {
                    chip.classList.add('active');
                    chip.style.background = t.color;
                    chip.style.borderColor = t.color;
                    chip.style.color = 'white';
                }
                chip.onclick = () => switchOverallSubTab(t.key);
                overallSubTabsEl.appendChild(chip);
            });
            overallSubTabsEl.style.display = _currentMainTab === 'overall' ? 'flex' : 'none';
        }

        // 게임 서브탭 생성
        const gameTabsEl = document.getElementById('ranking-game-tabs');
        gameTabsEl.innerHTML = '';
        gameTabsEl.style.display = _currentMainTab === 'games' ? 'flex' : 'none';
        const gameTabs = [
            { label: '🎲 주사위', key: 'dice', color: '#667eea' },
            { label: '🐎 경마', key: 'horse', color: '#e67e22' },
            { label: '🎰 룰렛', key: 'roulette', color: '#7c4dff' }
        ];
        if (data.orders) {
            gameTabs.push({ label: '🍜 주문', key: 'orders', color: '#e91e63' });
        }
        gameTabs.forEach((t) => {
            const chip = document.createElement('button');
            chip.className = 'rk-game-chip';
            chip.textContent = t.label;
            chip.dataset.game = t.key;
            chip.dataset.color = t.color;
            if (t.key === _currentGameTab) {
                chip.classList.add('active');
                chip.style.background = t.color;
                chip.style.borderColor = t.color;
                chip.style.color = 'white';
            }
            chip.onclick = () => switchGameSubTab(t.key);
            gameTabsEl.appendChild(chip);
        });

        // 기본 탭 렌더링
        if (_currentMainTab === 'games') {
            renderGameContent(_currentGameTab);
        } else {
            renderOverall(content);
        }
    }

    // ─── 렌더러 ───

    function renderOverall(el) {
        const subTab = _currentOverallSubTab || 'rank';
        if (subTab === 'participant') {
            renderOverallParticipant(el);
        } else {
            renderOverallRank(el);
        }
    }

    function renderOverallRank(el) {
        const d = _cache.overall;
        if (!d.mostWins.length && !d.winRate.length && (!d.avgRank || !d.avgRank.length)) {
            el.innerHTML = emptyMsg('아직 순위 기록이 없습니다.') + myRankBlock() + searchResultBlock();
            return;
        }
        let html = top10Label();
        const winsRanks = assignDisplayRanks(d.mostWins, r => r.wins);
        html += section('승리 TOP', d.mostWins.map((r, i) => row(winsRanks[i], r.name, `${r.wins}승`)));
        const rateRanks = assignDisplayRanks(d.winRate, r => r.winRate);
        html += section('승률 TOP (5게임+)', d.winRate.map((r, i) => row(rateRanks[i], r.name, `${r.winRate}% (${r.wins}/${r.games})`)));
        if (d.avgRank && d.avgRank.length > 0) {
            const avgRanks = assignDisplayRanks(d.avgRank, r => r.avgRank);
            html += section('평균 등수 TOP', d.avgRank.map((r, i) => row(avgRanks[i], r.name, `${r.avgRank}등 (TOP3: ${r.top3}회)`)));
        }
        html += myRankBlock() + searchResultBlock();
        el.innerHTML = html;
    }

    function renderOverallParticipant(el) {
        const d = _cache.overall;
        if (!d.mostPlayed.length) {
            el.innerHTML = emptyMsg('아직 참여 기록이 없습니다.') + myRankBlock() + searchResultBlock();
            return;
        }
        let html = top10Label();
        const ranks = assignDisplayRanks(d.mostPlayed, r => r.games);
        html += section('게임 참여 TOP', d.mostPlayed.map((r, i) => row(ranks[i], r.name, `${r.games}게임`)));
        html += myRankBlock() + searchResultBlock();
        el.innerHTML = html;
    }

    function renderGame(el, d, label) {
        if (!d.winners.length) {
            el.innerHTML = emptyMsg(`아직 ${label} 기록이 없습니다.`) + myRankBlock() + searchResultBlock();
            return;
        }
        let html = top10Label();
        const winsRanks = assignDisplayRanks(d.winners, r => r.wins);
        const playRanks = assignDisplayRanks(d.players, r => r.games);
        html += section(`${label} 승리 TOP`, d.winners.map((r, i) => row(winsRanks[i], r.name, `${r.wins}승 / ${r.games}게임`)));
        html += section(`${label} 참여 TOP`, d.players.map((r, i) => row(playRanks[i], r.name, `${r.games}게임`)));
        html += myRankBlock() + searchResultBlock();
        el.innerHTML = html;
    }

    function renderHorse(el) {
        const d = _cache.horseRace;
        const VN = {
            'car': '자동차', 'rocket': '로켓', 'bird': '새', 'boat': '보트', 'bicycle': '자전거',
            'rabbit': '토끼', 'turtle': '거북이', 'eagle': '독수리', 'scooter': '킥보드', 'helicopter': '헬리콥터', 'horse': '말',
            'knight': '기사', 'dinosaur': '공룡', 'ninja': '닌자', 'crab': '게'
        };

        if (!d.winners.length && (!d.vehicles || !d.vehicles.length)) {
            el.innerHTML = emptyMsg('아직 경마 기록이 없습니다.');
            return;
        }

        const winsRanks = assignDisplayRanks(d.winners, r => r.wins);
        let html = top10Label();
        html += section('경마 승리 TOP', d.winners.map((r, i) => row(winsRanks[i], r.name, `${r.wins}승 / ${r.games}게임`)));

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
        html += myRankBlock() + searchResultBlock();
        el.innerHTML = html;
    }

    function renderOrders(el) {
        const d = _cache.orders;
        if (!d) { el.innerHTML = emptyMsg('주문 데이터가 없습니다.'); return; }
        if (!(d.myTopMenus && d.myTopMenus.length) && !(d.popularMenus && d.popularMenus.length)) {
            el.innerHTML = emptyMsg('아직 주문 기록이 없습니다.') + myRankBlock() + searchResultBlock();
            return;
        }
        let html = '';
        if (d.myTopMenus && d.myTopMenus.length > 0) {
            const menuRanks = assignDisplayRanks(d.myTopMenus, r => r.count);
            html += section('내 TOP 메뉴', d.myTopMenus.map((r, i) => row(menuRanks[i], r.menu, `${r.count}회`)));
        }
        if (d.popularMenus && d.popularMenus.length > 0) {
            html += top10Label();
            const popularRanks = assignDisplayRanks(d.popularMenus, r => r.orders);
            html += section('인기 메뉴', d.popularMenus.map((r, i) => row(popularRanks[i], r.menu, `${r.orders}회`)));
        }
        html += myRankBlock() + searchResultBlock();
        el.innerHTML = html || emptyMsg('아직 주문 기록이 없습니다.');
    }

    // ─── 동점자 표시 등수 (동점=같은 등수, 다음은 건너뛴 등수) ───
    function assignDisplayRanks(items, getValue) {
        if (!items || items.length === 0) return [];
        const ranks = [1];
        for (let i = 1; i < items.length; i++) {
            const v = getValue(items[i]);
            const prevV = getValue(items[i - 1]);
            const same = (typeof v === 'number' && typeof prevV === 'number' && !Number.isInteger(v))
                ? Math.abs(v - prevV) < 1e-6
                : (v === prevV);
            ranks.push(same ? ranks[i - 1] : i + 1);
        }
        return ranks;
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

    function top10Label() {
        return '<div class="rk-section-title rk-top10-label">1~10등까지 랭킹</div>';
    }

    function myRankBlock() {
        if (!_cache.myRank || !_userName) return '';
        const m = _cache.myRank;
        const parts = [];
        if (m.overall && m.overall.mostPlayed) parts.push(`참여 ${m.overall.mostPlayed.rank}등 (전체 ${m.overall.mostPlayed.total}명)`);
        if (m.overall && m.overall.mostWins) parts.push(`승리 ${m.overall.mostWins.rank}등`);
        if (m.overall && m.overall.winRate) parts.push(`승률 ${m.overall.winRate.rank}등`);
        if (m.overall && m.overall.avgRank) parts.push(`평균등수 ${m.overall.avgRank.rank}등`);
        if (parts.length === 0) return '';
        return `
            <div class="rk-section">
                <div class="rk-my-rank-card">
                    <div class="rk-my-rank-title">내 랭킹</div>
                    <div class="rk-my-rank-body">${esc(parts.join(' · '))}</div>
                </div>
            </div>`;
    }

    function searchResultBlock() {
        if (!_searchResult) return '';
        const s = _searchResult;
        if (!s.found || !s.myRank) {
            return `
            <div class="rk-section">
                <div class="rk-search-result-card">
                    <div class="rk-search-result-title">검색 결과</div>
                    <div class="rk-search-result-body">"${esc(s.userName || '')}" 님의 랭킹 기록이 없습니다.</div>
                </div>
            </div>`;
        }
        const parts = [];
        const m = s.myRank;
        if (m.overall && m.overall.mostPlayed) parts.push(`참여 ${m.overall.mostPlayed.rank}등`);
        if (m.overall && m.overall.mostWins) parts.push(`승리 ${m.overall.mostWins.rank}등`);
        if (m.overall && m.overall.winRate) parts.push(`승률 ${m.overall.winRate.rank}등`);
        if (m.overall && m.overall.avgRank) parts.push(`평균등수 ${m.overall.avgRank.rank}등`);
        return `
            <div class="rk-section">
                <div class="rk-search-result-card">
                    <div class="rk-search-result-title">검색 결과: ${esc(s.userName)}</div>
                    <div class="rk-search-result-body">${esc(parts.join(' · ') || '기록 없음')}</div>
                </div>
            </div>`;
    }

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── 스와이프 제스처 ───

    function getGameTabKeys() {
        const keys = ['dice', 'horse', 'roulette'];
        if (_cache && _cache.orders) keys.push('orders');
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
                if (_currentMainTab === 'overall') {
                    if (dx < 0) {
                        if (_currentOverallSubTab === 'rank') switchOverallSubTab('participant');
                        else switchMainTab('games');
                    } else if (dx > 0 && _currentOverallSubTab === 'participant') {
                        switchOverallSubTab('rank');
                    }
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

    // ─── 초기화 확인바 ───

    let _confirmTimer = null;

    function showConfirm() {
        const slot = document.getElementById('ranking-confirm-slot');
        if (!slot) return;
        clearConfirmTimer();
        slot.innerHTML = `
            <div class="rk-confirm-bar">
                <span>새 시즌을 시작할까요?</span>
                <button class="rk-confirm-no" onclick="RankingModule._hideConfirm()">취소</button>
                <button class="rk-confirm-yes" onclick="RankingModule._doNewSeason()">시작</button>
            </div>`;
        _confirmTimer = setTimeout(hideConfirm, 3000);
    }

    function hideConfirm() {
        clearConfirmTimer();
        const slot = document.getElementById('ranking-confirm-slot');
        if (slot) slot.innerHTML = '';
    }

    function clearConfirmTimer() {
        if (_confirmTimer) { clearTimeout(_confirmTimer); _confirmTimer = null; }
    }

    function showFeedback(msg, ok) {
        const slot = document.getElementById('ranking-confirm-slot');
        if (!slot) return;
        clearConfirmTimer();
        slot.innerHTML = `<div class="rk-feedback-bar ${ok ? 'success' : 'error'}">${esc(msg)}</div>`;
        setTimeout(() => { if (slot) slot.innerHTML = ''; }, 2000);
    }

    async function doNewSeason() {
        hideConfirm();
        try {
            const res = await fetch(`/api/ranking/${_serverId}/new-season`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostName: _userName })
            });
            if (!res.ok) throw new Error('Failed');
            const result = await res.json();
            const newSeason = result.newSeason || (_currentSeason + 1);
            _currentSeason = newSeason;
            _viewingSeason = null;
            showFeedback(`시즌 ${newSeason}이 시작되었습니다`, true);
            invalidateCache();
            fetchAndRender();
            fetchSeasonList();
        } catch (e) {
            showFeedback('시즌 시작에 실패했습니다', false);
        }
    }

    function onNewSeason(data) {
        if (data && data.newSeason) _currentSeason = data.newSeason;
        _viewingSeason = null;
        invalidateCache();
        if (_overlay) {
            updateSeasonTitle();
            updateResetBtnVisibility();
            fetchAndRender();
            fetchSeasonList();
        }
    }

    function updateSeasonTitle() {
        if (!_overlay) return;
        const titleEl = _overlay.querySelector('.rk-header-title');
        if (titleEl) {
            const viewing = _viewingSeason || _currentSeason;
            titleEl.textContent = `🏆 랭킹 · 시즌 ${viewing}`;
        }
    }

    function updateResetBtnVisibility() {
        if (!_overlay) return;
        const btn = _overlay.querySelector('.rk-reset-btn');
        if (btn) btn.style.display = (_isHost && _serverId && !_viewingSeason) ? 'flex' : 'none';
    }

    async function fetchSeasonList() {
        if (!_serverId) return;
        try {
            const res = await fetch(`/api/ranking/${_serverId}/seasons`);
            if (!res.ok) return;
            const data = await res.json();
            renderSeasonBar(data.seasons || []);
        } catch (e) {
            // 시즌 목록 조회 실패 — 무시
        }
    }

    function renderSeasonBar(seasons) {
        const bar = document.getElementById('ranking-season-bar');
        if (!bar) return;
        const nums = seasons.map(s => typeof s === 'object' ? s.season : s);
        if (!nums.length) { bar.innerHTML = ''; return; }
        const all = [_currentSeason, ...nums.filter(n => n !== _currentSeason)];
        if (all.length <= 1) { bar.innerHTML = ''; return; }
        const viewing = _viewingSeason || _currentSeason;
        let options = '';
        all.forEach(s => {
            const label = s === _currentSeason ? `시즌 ${s} (현재)` : `시즌 ${s}`;
            options += `<option value="${s}"${s === viewing ? ' selected' : ''}>${label}</option>`;
        });
        bar.innerHTML = `
            <div class="rk-season-bar">
                <span class="rk-season-label">시즌 선택</span>
                <select class="rk-season-select" id="ranking-season-select">${options}</select>
            </div>`;
        const sel = document.getElementById('ranking-season-select');
        if (sel) sel.addEventListener('change', function () {
            const val = parseInt(this.value, 10);
            _viewingSeason = val === _currentSeason ? null : val;
            invalidateCache();
            updateSeasonTitle();
            updateResetBtnVisibility();
            fetchAndRender();
        });
    }

    return {
        init, show, hide, forceHide, invalidateCache, setHost,
        onRankingReset: onNewSeason, onNewSeason,
        _showConfirm: showConfirm, _hideConfirm: hideConfirm, _doNewSeason: doNewSeason
    };
})();
