// 랭킹 UI 오버레이 모듈 - 다크 게임 테마
const RankingModule = (function () {
    let _serverId = null;
    let _userName = null;
    let _isHost = false;
    let _overlay = null;
    let _closing = false; // hide() 재진입 가드 — 백드롭 더블클릭 시 history.back() 2회 방지
    let _cache = null;
    let _cacheTime = 0;
    const CACHE_TTL = 10000; // 10초
    let _currentSeason = 1;
    let _viewingSeason = null; // null = 현재 시즌

    // 탭 상태
    let _currentMainTab = 'overall';
    let _currentGameTab = 'dice';
    let _currentOverallSubTab = 'rank'; // 'rank' | 'participant'
    let _horseSubTab = 'rank'; // 'rank' | 'vehicles' — 경마 게임 탭 내부 서브탭

    // 달력 뷰 (날짜별 당첨자) — 등수 랭킹과 배타적으로 전환
    let _calendarOn = false;
    let _calCache = {};   // { [시즌키]: { sessions, truncated } } — 시즌별 분리 (셀렉터로 바꿔도 안 섞이게)
    let _calMonth = null; // 'YYYY-MM' 보고 있는 달
    let _calDay = null;   // 'YYYY-MM-DD' 펼쳐 놓은 날

    // server_game_records에 실제로 기록되는 8종 전부 (팝업 게임 탭은 4종만 커버해서 재사용 불가)
    const CAL_GAME_LABELS = {
        'dice': '🎲 주사위',
        'horse': '🐎 경마',
        'roulette': '🎰 룰렛',
        'ladder': '🪜 사다리타기',
        'pirate': '🏴‍☠️ 해적 룰렛',
        'spin-arena': '🌀 회전 칼날',
        'bridge': '🌉 다리 건너기',
        'crane-game': '🪄 인형뽑기'
    };
    const CAL_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

    // 제스처 상태
    let _touchStartX = 0;
    let _touchStartY = 0;
    let _pullStartY = 0;
    let _isPulling = false;

    // 시즌 우승 탈것 — 탈것 이름/이모지 메타 (1회 로드 후 모듈 캐시, 패널 열 때마다 재요청 금지)
    let _vehicleThemes = null;         // { id: { name, emoji, ... } } | null
    let _vehicleThemesPromise = null;
    const VEHICLE_NAME_MAP = {
        'car': '자동차', 'rocket': '로켓', 'bird': '새', 'boat': '보트', 'bicycle': '자전거',
        'rabbit': '토끼', 'turtle': '거북이', 'eagle': '독수리', 'scooter': '킥보드', 'helicopter': '헬리콥터', 'horse': '말',
        'knight': '기사', 'dinosaur': '공룡', 'ninja': '닌자', 'crab': '게'
    };

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
        _calCache = {}; // 달력도 같이 버린다 — 당겨서 새로고침·시즌 시작이 이 함수 하나만 부른다
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
        _closing = false;
        if (gameType) {
            _currentMainTab = 'games';
            _currentGameTab = gameType;
        } else {
            _currentMainTab = 'overall';
            _currentGameTab = 'dice';
        }
        _viewingSeason = null;
        _horseSubTab = 'rank';
        _calendarOn = false;
        _calMonth = null;
        _calDay = null;
        if (typeof PageHistoryManager !== 'undefined') PageHistoryManager.pushPage('ranking');
        createOverlay();
        fetchAndRender().then(() => fetchSeasonList());
    }

    function hide() {
        if (!_overlay || _closing) return;
        _closing = true;
        // 타이머는 지역 캡처 — 250ms 안에 재오픈돼도 새 오버레이를 지우지 않는다
        const el = _overlay;
        el.style.opacity = '0';
        setTimeout(() => { el.remove(); if (_overlay === el) _overlay = null; }, 250);
        // UI 버튼으로 닫을 때 히스토리도 되돌리기
        if (history.state && history.state.page === 'ranking') {
            history.back();
        }
    }

    // popstate 핸들러에서 호출 (history.back 없이 DOM만 정리)
    function forceHide() {
        if (_overlay) {
            const el = _overlay;
            el.style.opacity = '0';
            setTimeout(() => { el.remove(); if (_overlay === el) _overlay = null; }, 250);
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
            background: rgba(0,0,0,0.8); /* 백드롭 — 구 탈것 통계 모달 패리티, 페이지 라이트/다크 무관 고정 */
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            opacity: 0; transition: opacity 0.25s ease;
        }
        #ranking-overlay.rk-visible { opacity: 1; }

        /* ── 패널 (모바일 = 풀스크린, PC = 중앙 카드) ── */
        .rk-panel {
            width: 100%; height: 100%;
            background: linear-gradient(180deg, var(--rk-bg-start) 0%, var(--rk-bg-end) 100%);
            display: flex; flex-direction: column;
        }
        @media (min-width: 768px) {
            #ranking-overlay {
                display: flex; align-items: center; justify-content: center;
            }
            .rk-panel {
                width: min(640px, 92vw);
                height: min(85vh, 720px);
                border-radius: 20px;
                overflow: hidden;
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
            /* margin-top:0 로 전역 button{margin-top:10px}(horse-race.css) 상쇄 — 안 하면 헤더에서 아래로 밀려 제목과 어긋남 */
            background: var(--rk-btn-bg); border: none; color: white;
            width: 38px; height: 38px; border-radius: 12px; margin-top: 0;
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

        .rk-top10-label {
            font-family: 'Jua', sans-serif; font-size: 1em;
            color: var(--rk-accent-light); margin: 0 0 8px 4px; padding: 0;
        }
        .rk-my-rank-card {
            margin: 16px 0; padding: 14px 16px;
            border-radius: 16px; border: 1px solid var(--rk-border);
            background: var(--rk-surface);
        }
        .rk-my-rank-title {
            font-family: 'Jua', sans-serif; font-size: 0.95em;
            color: var(--rk-accent-light); margin-bottom: 8px;
        }
        .rk-my-rank-body {
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

        /* ── 탈것 통계 테이블 ── */
        .rk-table-scroll {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }
        .rk-vehicle-table {
            width: 100%; border-collapse: collapse;
            font-size: 0.85em;
        }
        .rk-vehicle-table th {
            padding: 10px 6px; text-align: center;
            color: var(--rk-text-muted); font-weight: 600;
            font-size: 0.85em; white-space: nowrap;
            border-bottom: 2px solid var(--rk-border);
        }
        .rk-vehicle-table th:first-child { text-align: left; padding-left: 14px; }
        .rk-vehicle-table td {
            padding: 10px 6px; text-align: center;
            color: rgba(255,255,255,0.6); white-space: nowrap;
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
        .rk-vehicle-table tr.rk-low-sample td { opacity: 0.5; }
        .rk-low-label {
            display: inline-block; margin-left: 4px;
            font-size: 0.8em; color: var(--rk-text-muted);
        }
        .rk-table-note {
            margin: 0; padding: 10px 14px 12px;
            font-size: 0.78em; line-height: 1.5;
            color: var(--rk-text-muted);
        }

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
            /* margin-top:0 로 전역 button{margin-top:10px}(horse-race.css) 상쇄 — 헤더 정렬 */
            background: var(--rk-btn-bg); border: none; color: white;
            width: 38px; height: 38px; border-radius: 12px; margin-top: 0;
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

        /* ── 시즌 우승 탈것 ── */
        .rk-vchamp-bar {
            display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px;
            padding: 8px 16px;
            border-bottom: 1px solid var(--rk-surface);
            font-size: 0.8em;
        }
        .rk-vchamp-label {
            color: var(--rk-text-dim);
            flex-shrink: 0;
        }
        .rk-vchamp-chip {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 3px 10px; border-radius: 999px;
            background: var(--rk-surface);
            border: 1px solid var(--rk-border-light);
            color: var(--rk-text);
            white-space: nowrap;
        }
        .rk-vchamp-1 { border-color: var(--rk-gold); color: var(--rk-gold); }
        .rk-vchamp-2 { border-color: var(--rk-silver); color: var(--rk-silver); }
        .rk-vchamp-3 { border-color: var(--rk-bronze); color: var(--rk-bronze); }

        /* ── 보기 전환 바 (등수 ↔ 달력) ── */
        /* 콘텐츠 밖의 고정 행이라 기록이 없어 본문이 빈 상태여도 토글이 사라지지 않는다 */
        .rk-viewbar {
            display: flex; align-items: center; justify-content: flex-end;
            padding: 8px 16px;
            border-bottom: 1px solid var(--rk-surface);
            flex-shrink: 0;
        }
        /* 경마 자동선택 스위치(css/horse-race.css)와 같은 형태 — 이 모듈은 전 게임 공용이라 스타일을 여기로 이식 */
        .rk-cal-toggle {
            display: inline-flex; align-items: center; gap: 8px;
            cursor: pointer; user-select: none;
            font-size: 0.82em; color: var(--rk-text-dim);
            font-family: 'Jua', sans-serif;
        }
        .rk-cal-toggle input[type="checkbox"] {
            position: absolute; opacity: 0; width: 0; height: 0;
        }
        .rk-cal-toggle-slider {
            position: relative; display: inline-block;
            width: 36px; height: 20px;
            background: rgba(255,255,255,0.25);
            border-radius: 999px; transition: background 0.2s;
            flex-shrink: 0;
        }
        .rk-cal-toggle-slider::before {
            content: ""; position: absolute; top: 2px; left: 2px;
            width: 16px; height: 16px;
            background: white; border-radius: 50%;
            transition: transform 0.2s;
        }
        .rk-cal-toggle input[type="checkbox"]:checked ~ .rk-cal-toggle-slider {
            background: var(--rk-accent);
        }
        .rk-cal-toggle input[type="checkbox"]:checked ~ .rk-cal-toggle-slider::before {
            transform: translateX(16px);
        }
        .rk-cal-toggle input[type="checkbox"]:checked ~ .rk-cal-toggle-label {
            color: var(--rk-accent-light);
        }
        .rk-cal-toggle-label { font-weight: 600; }

        /* ── 달력 ── */
        .rk-cal-nav {
            display: flex; align-items: center; justify-content: center; gap: 14px;
            margin-bottom: 12px;
        }
        .rk-cal-nav-btn {
            /* 전역 button{width:100%;margin-top:10px;padding:12px 25px}(horse-race.css) 상쇄 —
               경마·사다리·해적·회전칼날·다리건너기 5개 페이지가 그 시트를 로드한다 */
            background: var(--rk-surface); border: 1px solid var(--rk-border-light);
            color: var(--rk-text); margin-top: 0; padding: 0;
            width: 32px; height: 32px; border-radius: 10px;
            font-size: 0.95em; cursor: pointer; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            transition: background 0.2s;
        }
        .rk-cal-nav-btn:hover:not(:disabled) { background: var(--rk-btn-bg); }
        .rk-cal-nav-btn:disabled { opacity: 0.25; cursor: default; }
        .rk-cal-title {
            font-family: 'Jua', sans-serif; font-size: 1.02em;
            color: var(--rk-accent-light); min-width: 130px; text-align: center;
        }
        .rk-cal-wdrow, .rk-cal-grid {
            display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;
        }
        .rk-cal-wdrow { margin-bottom: 4px; }
        .rk-cal-wd {
            text-align: center; font-size: 0.72em;
            color: var(--rk-text-muted); padding: 2px 0;
        }
        .rk-cal-wd.sun { color: rgba(239,68,68,0.75); } /* --red-500 */
        .rk-cal-cell {
            min-height: 54px; border-radius: 10px;
            padding: 4px 2px 5px;
            display: flex; flex-direction: column; align-items: center; gap: 2px;
            background: rgba(255,255,255,0.03);
            border: 1px solid transparent;
            overflow: hidden;
        }
        .rk-cal-blank { background: none; }
        .rk-cal-daynum {
            font-size: 0.7em; color: var(--rk-text-muted);
            line-height: 1.2; flex-shrink: 0;
        }
        .rk-cal-has {
            background: var(--rk-surface);
            border-color: var(--rk-border);
            cursor: pointer;
        }
        .rk-cal-has:hover { background: var(--rk-btn-bg); }
        .rk-cal-has .rk-cal-daynum { color: var(--rk-text); }
        .rk-cal-today { border-color: rgba(102,126,234,0.55); } /* --rk-accent */
        .rk-cal-sel {
            border-color: var(--rk-gold);
            box-shadow: 0 0 10px rgba(255,215,0,0.25); /* --rk-gold */
        }
        .rk-cal-winner {
            font-size: 0.68em; line-height: 1.25;
            color: var(--rk-gold); font-weight: 600;
            max-width: 100%;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rk-cal-more {
            font-size: 0.62em; color: var(--rk-text-muted);
            line-height: 1.1;
        }
        .rk-cal-nowin { font-size: 0.66em; color: var(--rk-text-muted); }

        /* ── 날짜 상세 (달력 아래 인라인 — 팝업 위 팝업은 뒤로가기가 꼬여서 안 씀) ── */
        .rk-cal-drow {
            display: flex; align-items: center; gap: 10px;
            padding: 11px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.04);
        }
        .rk-cal-drow:last-child { border-bottom: none; }
        .rk-cal-seq {
            flex-shrink: 0; min-width: 30px;
            font-size: 0.78em; font-weight: 700;
            color: var(--rk-accent-light);
        }
        .rk-cal-game {
            flex-shrink: 0; font-size: 0.85em;
            color: var(--rk-text);
        }
        .rk-cal-win {
            flex: 1; text-align: right;
            font-size: 0.85em; color: var(--rk-gold); font-weight: 600;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rk-cal-hint {
            text-align: center; padding: 14px 10px 0;
            font-size: 0.78em; color: var(--rk-text-muted);
        }
        .rk-cal-note {
            margin: 12px 0 0; padding: 10px 14px;
            border-radius: 10px; background: var(--rk-surface);
            font-size: 0.76em; line-height: 1.5; color: var(--rk-text-muted);
        }

        @media (max-width: 360px) {
            .rk-cal-cell { min-height: 48px; }
            .rk-cal-winner { font-size: 0.62em; }
            .rk-cal-title { min-width: 108px; font-size: 0.95em; }
        }
    `;

    // ─── 오버레이 생성 ───

    function createOverlay() {
        _overlay = document.createElement('div');
        _overlay.id = 'ranking-overlay';
        _overlay.innerHTML = `
            <style>${CSS}</style>
            <div class="rk-panel">
                <div class="rk-header">
                    <button class="rk-back-btn" onclick="RankingModule.hide()">&#8592;</button>
                    <span class="rk-header-title">🏆 랭킹 · 시즌 ${_currentSeason}</span>
                    <button class="rk-reset-btn" style="display:${(_isHost && _serverId && !_viewingSeason) ? 'flex' : 'none'}" onclick="RankingModule._showConfirm()">&#128260;</button>
                </div>
                <div id="ranking-confirm-slot"></div>
                <div id="ranking-season-bar"></div>
                <div id="ranking-vehicle-champs"></div>
                <div class="rk-tabs" id="ranking-tabs"></div>
                <div class="rk-game-tabs" id="ranking-overall-sub-tabs" style="display:none;"></div>
                <div class="rk-game-tabs" id="ranking-game-tabs" style="display:none;"></div>
                <div class="rk-game-tabs" id="ranking-horse-sub-tabs" style="display:none;"></div>
                <div id="ranking-view-bar"></div>
                <div class="rk-content" id="ranking-content"></div>
            </div>
        `;

        // 백드롭 클릭 닫기 (PC 카드 모드 전용 — 모바일은 panel이 전면 커버라 e.target이 루트가 될 수 없음)
        // press-release 양쪽이 모두 백드롭일 때만 닫는다 — 카드 안 드래그(텍스트 선택)가 백드롭에서 끝나도 닫히지 않게
        let pressOnBackdrop = false;
        _overlay.addEventListener('pointerdown', function (e) {
            pressOnBackdrop = (e.target === _overlay);
        });
        _overlay.addEventListener('click', function (e) {
            if (e.target === _overlay && pressOnBackdrop) hide();
            pressOnBackdrop = false;
        });

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
        updateHorseSubTabsVisibility();
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
        updateHorseSubTabsVisibility();
    }

    // 경마 게임 탭 진입 시에만 경마 서브탭 바를 노출하고 활성칩을 스타일링.
    // (overall-sub/game/horse-sub 칩이 rk-game-chip 클래스를 공유 → switchGameSubTab의
    //  광역 셀렉터가 horse-sub 칩 인라인 스타일을 지우므로, show 시 항상 재적용해 하이라이트 유지)
    function updateHorseSubTabsVisibility() {
        const el = document.getElementById('ranking-horse-sub-tabs');
        if (!el) return;
        const show = (!_calendarOn && _currentMainTab === 'games' && _currentGameTab === 'horse');
        el.style.display = show ? 'flex' : 'none';
        if (!show) return;
        el.querySelectorAll('.rk-game-chip').forEach(c => {
            const active = c.dataset.horseSub === _horseSubTab;
            c.classList.toggle('active', active);
            if (active && c.dataset.color) {
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

    function switchHorseSubTab(key) {
        _horseSubTab = key;
        updateHorseSubTabsVisibility(); // 활성칩 스타일 재적용
        // renderGameContent가 내부에서 setContentWithTransition으로 감싸므로 직접 호출
        // (switchGameSubTab 패턴 — 이중 래핑 시 페이드 이중 플래시 발생)
        renderGameContent('horse');
    }

    function renderGameContent(key) {
        const el = document.getElementById('ranking-content');
        if (!el || !_cache) return;
        setContentWithTransition(el, () => {
            switch (key) {
                case 'dice': renderGame(el, _cache.dice, '주사위'); break;
                case 'horse': _horseSubTab === 'vehicles' ? renderHorseVehicles(el) : renderHorseRank(el); break;
                case 'roulette': renderGame(el, _cache.roulette, '룰렛'); break;
                case 'ladder': renderGame(el, _cache.ladder, '사다리타기'); break;
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
            { label: '🎰 룰렛', key: 'roulette', color: '#7c4dff' },
            { label: '🪜 사다리타기', key: 'ladder', color: '#f59e0b' }
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

        // 경마 서브탭 생성 (경마 순위 | 탈것 통계)
        const horseSubTabsEl = document.getElementById('ranking-horse-sub-tabs');
        if (horseSubTabsEl) {
            horseSubTabsEl.innerHTML = '';
            const horseSubTabs = [
                { label: '🏆 경마 순위', key: 'rank', color: '#e67e22' },
                { label: '📊 탈것 통계', key: 'vehicles', color: '#e67e22' }
            ];
            horseSubTabs.forEach((t) => {
                const chip = document.createElement('button');
                chip.className = 'rk-game-chip';
                chip.textContent = t.label;
                chip.dataset.horseSub = t.key;
                chip.dataset.color = t.color;
                if (t.key === _horseSubTab) {
                    chip.classList.add('active');
                    chip.style.background = t.color;
                    chip.style.borderColor = t.color;
                    chip.style.color = 'white';
                }
                chip.onclick = () => switchHorseSubTab(t.key);
                horseSubTabsEl.appendChild(chip);
            });
            horseSubTabsEl.style.display = (_currentMainTab === 'games' && _currentGameTab === 'horse') ? 'flex' : 'none';
        }

        // 보기 전환 바 (등수 ↔ 달력) — 탭 생성 이후에 붙여야 탭 표시 상태를 함께 정리할 수 있다
        renderViewBar();
        applyTabBarsVisibility();

        // 기본 탭 렌더링
        if (_calendarOn) {
            renderCalendarView(content);
        } else if (_currentMainTab === 'games') {
            renderGameContent(_currentGameTab);
        } else {
            renderOverall(content);
        }

        // 시즌 우승 탈것 (메인 렌더 후 — _currentSeason 갱신 이후 시점, 모든 갱신 경로 공통 커버)
        renderVehicleChamps();
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
            el.innerHTML = emptyMsg('아직 순위 기록이 없습니다.') + myRankBlock();
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
        html += myRankBlock();
        el.innerHTML = html;
    }

    function renderOverallParticipant(el) {
        const d = _cache.overall;
        if (!d.mostPlayed.length) {
            el.innerHTML = emptyMsg('아직 참여 기록이 없습니다.') + myRankBlock();
            return;
        }
        let html = top10Label();
        const ranks = assignDisplayRanks(d.mostPlayed, r => r.games);
        html += section('게임 참여 TOP', d.mostPlayed.map((r, i) => row(ranks[i], r.name, `${r.games}게임`)));
        html += myRankBlock();
        el.innerHTML = html;
    }

    function renderGame(el, d, label) {
        if (!d || !d.winners || !d.winners.length) {
            el.innerHTML = emptyMsg(`아직 ${label} 기록이 없습니다.`) + myRankBlock();
            return;
        }
        let html = top10Label();
        const winsRanks = assignDisplayRanks(d.winners, r => r.wins);
        const playRanks = assignDisplayRanks(d.players, r => r.games);
        html += section(`${label} 승리 TOP`, d.winners.map((r, i) => row(winsRanks[i], r.name, `${r.wins}승 / ${r.games}게임`)));
        html += section(`${label} 참여 TOP`, d.players.map((r, i) => row(playRanks[i], r.name, `${r.games}게임`)));
        html += myRankBlock();
        el.innerHTML = html;
    }

    // 경마 순위 서브탭 — 승리 TOP + 내 랭킹 (탈것 표는 renderHorseVehicles로 분리)
    function renderHorseRank(el) {
        const d = _cache && _cache.horseRace;
        // 시즌 뷰 payload에는 horseRace가 없음 — 스와이프로 도달 시 TypeError 방지
        if (!d) { el.innerHTML = emptyMsg('아직 경마 기록이 없습니다.'); return; }
        if (!d.winners || !d.winners.length) {
            el.innerHTML = emptyMsg('아직 경마 기록이 없습니다.') + myRankBlock();
            return;
        }
        const winsRanks = assignDisplayRanks(d.winners, r => r.wins);
        let html = top10Label();
        html += section('경마 승리 TOP', d.winners.map((r, i) => row(winsRanks[i], r.name, `${r.wins}승 / ${r.games}게임`)));
        html += myRankBlock();
        el.innerHTML = html;
    }

    // 탈것 통계 서브탭 — 표만 (섹션 제목은 서브탭 라벨과 중복이라 제거, myRankBlock 없음)
    function renderHorseVehicles(el) {
        const d = _cache && _cache.horseRace;
        // 시즌 뷰 payload에는 horseRace가 없음 — 스와이프로 도달 시 TypeError 방지
        if (!d) { el.innerHTML = emptyMsg('아직 경마 기록이 없습니다.'); return; }
        if (!d.vehicles || !d.vehicles.length) {
            el.innerHTML = emptyMsg('아직 탈것 기록이 없습니다.');
            return;
        }
        const VN = {
            'car': '자동차', 'rocket': '로켓', 'bird': '새', 'boat': '보트', 'bicycle': '자전거',
            'rabbit': '토끼', 'turtle': '거북이', 'eagle': '독수리', 'scooter': '킥보드', 'helicopter': '헬리콥터', 'horse': '말',
            'knight': '기사', 'dinosaur': '공룡', 'ninja': '닌자', 'crab': '게'
        };

        // 승률 내림차순, 동률 시 출전 많은 순 (서버는 rank_1 DESC — 클라에서 재정렬 필수)
        const vehicles = d.vehicles.slice().sort((a, b) => {
            const wa = a.appearances > 0 ? a.ranks[0] / a.appearances : 0;
            const wb = b.appearances > 0 ? b.ranks[0] / b.appearances : 0;
            if (wb !== wa) return wb - wa;
            return (b.appearances || 0) - (a.appearances || 0);
        });
        let tableHtml = `
            <div class="rk-section" style="animation: rkFadeInUp 0.35s ease 0.1s both;">
                <div class="rk-card" style="padding:0;">
                    <div class="rk-table-scroll">
                    <table class="rk-vehicle-table">
                        <thead><tr>
                            <th>탈것</th><th>출전</th><th>경기당 선택</th><th>승률</th>
                            <th>1등</th><th>2등</th><th>3등</th>
                            <th>4등</th><th>5등</th><th>6등</th>
                        </tr></thead>
                        <tbody>`;
        vehicles.forEach(v => {
            const t = _vehicleThemes ? _vehicleThemes[v.id] : null;
            const label = t ? ((t.emoji || '') + ' ' + (t.name || VN[v.id] || v.id)).trim() : (VN[v.id] || v.id);
            const appearances = Number(v.appearances) || 0;
            const picks = Number(v.picks) || 0;
            const r = v.ranks || [0, 0, 0, 0, 0, 0];
            const winRate = appearances > 0 ? Math.round((r[0] / appearances) * 100) : 0;
            // 같은 탈것에 여러 명이 베팅할 수 있어 1을 넘을 수 있다 → 비율(%)이 아니라 인원수로 표시
            const pickAvg = appearances > 0 ? (picks / appearances).toFixed(1) : '0.0';
            const lowSample = appearances < 5; // 추천 배지와 동일 기준 (최소 등장 5회)
            tableHtml += `<tr${lowSample ? ' class="rk-low-sample"' : ''}>
                <td>${esc(label)}</td>
                <td>${appearances}</td>
                <td>${pickAvg}명</td>
                <td>${winRate}%${lowSample ? '<span class="rk-low-label">기록 부족</span>' : ''}</td>
                <td><span class="rk-rank-cell${r[0] > 0 ? ' rk-rank-1' : ''}">${r[0]}</span></td>
                <td>${r[1]}</td><td>${r[2]}</td>
                <td>${r[3]}</td><td>${r[4]}</td>
                <td><span class="rk-rank-cell${r[5] > 0 ? ' rk-rank-6' : ''}">${r[5]}</span></td>
            </tr>`;
        });
        tableHtml += '</tbody></table></div>'
            + '<p class="rk-table-note">경기당 선택 = 그 탈것이 나온 경기에서 평균 몇 명이 골랐는지입니다. '
            + '같은 탈것에 여러 명이 걸 수 있어 1명을 넘을 수 있습니다.</p>'
            + '</div></div>';
        el.innerHTML = tableHtml;

        // 테마 미로드 시 이름 맵으로 먼저 동기 렌더 후, 로드 성공 시에만 1회 재렌더
        // (실패 시 _vehicleThemes가 null로 남으므로 재렌더 루프 없음 — C-26/C-27 stale 가드)
        if (!_vehicleThemes) {
            loadVehicleThemesOnce().then(() => {
                if (_vehicleThemes && _overlay && _currentMainTab === 'games' && _currentGameTab === 'horse' && _horseSubTab === 'vehicles' && _cache && _cache.horseRace) {
                    // 트랜지션 재사용 금지 — 스크롤 보존 제자리 패치 (이모지/이름만 갱신되므로 충분)
                    const el2 = document.getElementById('ranking-content');
                    if (el2) { const st = el2.scrollTop; renderHorseVehicles(el2); el2.scrollTop = st; }
                }
            });
        }
    }

    function renderOrders(el) {
        const d = _cache.orders;
        if (!d) { el.innerHTML = emptyMsg('주문 데이터가 없습니다.'); return; }
        if (!(d.myTopMenus && d.myTopMenus.length) && !(d.popularMenus && d.popularMenus.length)) {
            el.innerHTML = emptyMsg('아직 주문 기록이 없습니다.') + myRankBlock();
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
        html += myRankBlock();
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

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── 스와이프 제스처 ───

    function getGameTabKeys() {
        const keys = ['dice', 'horse', 'roulette', 'ladder'];
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
            // 가로 스크롤 테이블 안에서 시작한 터치는 탭 전환 스와이프로 해석하지 않음
            // (터치 이벤트의 target은 터치 시작 요소로 고정됨)
            if (e.target && e.target.closest && e.target.closest('.rk-table-scroll')) return;
            const dx = e.changedTouches[0].clientX - _touchStartX;
            const dy = e.changedTouches[0].clientY - _touchStartY;

            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                // 달력에서는 탭이 숨겨져 있다 — 가로 스와이프를 달 이동으로 돌린다
                if (_calendarOn) { stepCalMonth(dx < 0 ? 1 : -1); return; }
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
            // 가로 스크롤 테이블 안에서 시작한 터치는 PTR 대상 아님 (스와이프 스킵과 동일 기준)
            if (e.target && e.target.closest && e.target.closest('.rk-table-scroll')) return;
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
            _calMonth = null; // 시즌마다 기록이 있는 달이 달라 이월시키면 빈 달을 보게 된다
            _calDay = null;
            invalidateCache();
            updateSeasonTitle();
            updateResetBtnVisibility();
            fetchAndRender();
        });
    }

    // ─── 시즌 우승 탈것 ───

    function loadVehicleThemesOnce() {
        if (_vehicleThemes) return Promise.resolve(_vehicleThemes);
        if (!_vehicleThemesPromise) {
            _vehicleThemesPromise = fetch('/assets/vehicle-themes.json')
                .then(r => r.json())
                .then(data => {
                    _vehicleThemes = (data && data.vehicleThemes) || {};
                    return _vehicleThemes;
                })
                .catch(() => {
                    _vehicleThemesPromise = null; // 실패 결과는 캐시하지 않음 — 다음 열람 때 재시도
                    return {}; // 이번 렌더는 하드코딩 이름 맵 사용
                });
        }
        return _vehicleThemesPromise;
    }

    async function renderVehicleChamps() {
        const slot = document.getElementById('ranking-vehicle-champs');
        if (!slot) return;
        if (!_serverId) { slot.innerHTML = ''; return; } // 자유 랭킹은 시즌 탈것 데이터 없음
        const viewing = _viewingSeason || _currentSeason;
        // 응답 대기 중 시즌이 바뀌었거나 패널이 닫혔으면 stale — DOM을 건드리지 않는다 (늦은 응답이 새 화면을 덮지 않게)
        const isStale = () => !_overlay || viewing !== (_viewingSeason || _currentSeason);
        try {
            const res = await fetch(`/api/ranking/${_serverId}/vehicles?season=${viewing}`);
            if (isStale()) return;
            if (!res.ok) { slot.innerHTML = ''; return; }
            const data = await res.json();
            const vehicles = (data && data.success && Array.isArray(data.vehicles)) ? data.vehicles : [];
            if (isStale()) return;
            if (!vehicles.length) { slot.innerHTML = ''; return; }
            const themes = await loadVehicleThemesOnce();
            if (isStale()) return;
            const medals = ['🥇', '🥈', '🥉'];
            const chips = vehicles.slice(0, 3).map((v, i) => {
                const t = themes ? themes[v.vehicle_id] : null;
                const name = (t && t.name) || VEHICLE_NAME_MAP[v.vehicle_id] || v.vehicle_id;
                const emoji = (t && t.emoji) || '';
                const wins = Number(v.rank_1) || 0;
                return `<span class="rk-vchamp-chip rk-vchamp-${i + 1}">${medals[i]} ${esc(emoji + name)} ${wins}승</span>`;
            });
            slot.innerHTML = `
                <div class="rk-vchamp-bar">
                    <span class="rk-vchamp-label">시즌 우승 탈것</span>
                    ${chips.join('')}
                </div>`;
        } catch (e) {
            if (isStale()) return;
            const s = document.getElementById('ranking-vehicle-champs');
            if (s) s.innerHTML = ''; // 조회 실패 시 섹션 숨김 — 랭킹 본문에는 영향 없음
        }
    }

    // ─── 날짜별 당첨자 달력 ───

    // 보기 전환 바 — 콘텐츠 밖 고정 행이라 본문이 빈 상태여도 토글이 남는다
    function renderViewBar() {
        const bar = document.getElementById('ranking-view-bar');
        if (!bar) return;
        // 자유 랭킹은 배포 전역 기록이라 "누가 걸렸나"가 의미 없음 → 토글 미노출
        if (!_serverId) { bar.innerHTML = ''; return; }
        bar.innerHTML = `
            <div class="rk-viewbar">
                <label class="rk-cal-toggle" title="날짜별로 누가 당첨됐는지 봅니다">
                    <input type="checkbox" id="ranking-cal-toggle"${_calendarOn ? ' checked' : ''}>
                    <span class="rk-cal-toggle-slider"></span>
                    <span class="rk-cal-toggle-label">📅 달력</span>
                </label>
            </div>`;
        const cb = document.getElementById('ranking-cal-toggle');
        if (cb) cb.addEventListener('change', function () { setCalendarMode(this.checked); });
    }

    // 달력은 게임 구분 없이 전체를 보여주므로 탭 바를 모두 접는다
    function applyTabBarsVisibility() {
        const tabsEl = document.getElementById('ranking-tabs');
        const overallSubTabsEl = document.getElementById('ranking-overall-sub-tabs');
        const gameTabsEl = document.getElementById('ranking-game-tabs');
        if (tabsEl) tabsEl.style.display = _calendarOn ? 'none' : 'flex';
        if (overallSubTabsEl) overallSubTabsEl.style.display = (!_calendarOn && _currentMainTab === 'overall') ? 'flex' : 'none';
        if (gameTabsEl) gameTabsEl.style.display = (!_calendarOn && _currentMainTab === 'games') ? 'flex' : 'none';
        updateHorseSubTabsVisibility();
    }

    function setCalendarMode(on) {
        _calendarOn = !!on;
        _calDay = null;
        applyTabBarsVisibility();
        const content = document.getElementById('ranking-content');
        if (!content) return;
        // switchMainTab과 같은 규칙 — renderGameContent는 내부에서 트랜지션을 걸므로 이중 래핑 금지
        if (_calendarOn) {
            setContentWithTransition(content, () => renderCalendarView(content));
        } else if (_currentMainTab === 'games') {
            renderGameContent(_currentGameTab);
        } else {
            setContentWithTransition(content, () => renderOverall(content));
        }
    }

    function calKey() {
        return _viewingSeason ? ('s' + _viewingSeason) : 'current';
    }

    // 한국은 서머타임이 없어 UTC+9 고정 오프셋으로 KST 달력 날짜를 안전하게 얻는다.
    // 서버 created_at은 타임존 없는 TIMESTAMP라 SQL에서 날짜를 자르면 호스트 타임존에 끌려간다.
    function kstParts(iso) {
        const t = new Date(iso).getTime();
        if (!isFinite(t)) return null;
        const k = new Date(t + 9 * 3600 * 1000).toISOString();
        return { day: k.slice(0, 10), month: k.slice(0, 7) };
    }

    function buildCalIndex(sessions) {
        const days = {};
        const monthSet = {};
        (sessions || []).forEach(s => {
            const p = kstParts(s.playedAt);
            if (!p) return;
            (days[p.day] = days[p.day] || []).push(s);
            monthSet[p.month] = true;
        });
        // 회차(1차·2차)는 그 날 이른 판부터 매긴다
        Object.keys(days).forEach(d => {
            days[d].sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt));
        });
        return { days: days, months: Object.keys(monthSet).sort() };
    }

    // 칸에 넣을 대표 당첨자 — 그 날 가장 많이 걸린 사람, 동률이면 이름순
    function calDaySummary(list) {
        const counts = {};
        list.forEach(s => (s.winners || []).forEach(n => { counts[n] = (counts[n] || 0) + 1; }));
        const names = Object.keys(counts);
        if (!names.length) return null;
        names.sort((a, b) => (counts[b] - counts[a]) || a.localeCompare(b));
        return { top: names[0], extra: names.length - 1 };
    }

    async function fetchCalendar(key) {
        if (_calCache[key]) return _calCache[key];
        const url = _viewingSeason
            ? `/api/ranking/${_serverId}/season/${_viewingSeason}/calendar`
            : `/api/ranking/${_serverId}/calendar`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed');
            const data = await res.json();
            const parsed = {
                sessions: Array.isArray(data.sessions) ? data.sessions : [],
                truncated: !!data.truncated
            };
            _calCache[key] = parsed; // 실패는 캐시하지 않는다 — 다음 열람 때 재시도
            return parsed;
        } catch (e) {
            console.warn('달력 조회 실패:', e);
            return { sessions: [], truncated: false, failed: true };
        }
    }

    function renderCalendarView(el) {
        if (!el) return;
        const key = calKey();
        const cached = _calCache[key];
        if (cached) { paintCalendar(el, cached); return; }
        el.innerHTML = skeletonHTML();
        fetchCalendar(key).then(data => {
            // 응답 대기 중 모드나 시즌이 바뀌었으면 stale — 늦은 응답이 새 화면을 덮지 않게
            if (!_overlay || !_calendarOn || calKey() !== key) return;
            const el2 = document.getElementById('ranking-content');
            if (el2) paintCalendar(el2, data);
        });
    }

    function paintCalendar(el, data) {
        if (data.failed) { el.innerHTML = emptyMsg('달력을 불러올 수 없습니다.'); return; }
        const idx = buildCalIndex(data.sessions);
        if (!idx.months.length) { el.innerHTML = emptyMsg('아직 기록이 없습니다.'); return; }
        if (!_calMonth || idx.months.indexOf(_calMonth) === -1) {
            _calMonth = idx.months[idx.months.length - 1]; // 기록이 있는 가장 최근 달
        }
        const pos = idx.months.indexOf(_calMonth);
        const y = parseInt(_calMonth.slice(0, 4), 10);
        const m = parseInt(_calMonth.slice(5, 7), 10);
        // KST 달력 라벨을 그대로 쓰므로 UTC 날짜 연산으로 로컬 타임존 영향을 없앤다
        const startWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const today = kstParts(new Date().toISOString()).day;

        let wds = '';
        CAL_WEEKDAYS.forEach((w, i) => {
            wds += `<div class="rk-cal-wd${i === 0 ? ' sun' : ''}">${w}</div>`;
        });

        let cells = '';
        for (let i = 0; i < startWd; i++) cells += '<div class="rk-cal-cell rk-cal-blank"></div>';
        for (let d = 1; d <= lastDay; d++) {
            const dayKey = `${_calMonth}-${String(d).padStart(2, '0')}`;
            const list = idx.days[dayKey];
            const cls = ['rk-cal-cell'];
            if (list) cls.push('rk-cal-has');
            if (dayKey === today) cls.push('rk-cal-today');
            if (dayKey === _calDay) cls.push('rk-cal-sel');
            let inner = '';
            if (list) {
                const sum = calDaySummary(list);
                inner = sum
                    ? `<span class="rk-cal-winner">${esc(sum.top)}</span>`
                        + (sum.extra > 0 ? `<span class="rk-cal-more">+${sum.extra}</span>` : '')
                    : '<span class="rk-cal-nowin">-</span>';
            }
            cells += `<div class="${cls.join(' ')}"${list ? ` data-cal-day="${dayKey}"` : ''}>`
                + `<span class="rk-cal-daynum">${d}</span>${inner}</div>`;
        }

        el.innerHTML = `
            <div class="rk-section">
                <div class="rk-cal-nav">
                    <button type="button" class="rk-cal-nav-btn" id="rk-cal-prev"${pos <= 0 ? ' disabled' : ''}>&#8249;</button>
                    <span class="rk-cal-title">${y}년 ${m}월</span>
                    <button type="button" class="rk-cal-nav-btn" id="rk-cal-next"${pos >= idx.months.length - 1 ? ' disabled' : ''}>&#8250;</button>
                </div>
                <div class="rk-cal-wdrow">${wds}</div>
                <div class="rk-cal-grid">${cells}</div>
                ${_calDay ? '' : '<div class="rk-cal-hint">날짜를 누르면 그 날 기록을 봅니다</div>'}
            </div>
            ${renderCalDetail(idx)}
            ${data.truncated ? '<p class="rk-cal-note">기록이 많아 최근 것만 표시합니다. 오래된 날짜 일부는 달력에 나오지 않습니다.</p>' : ''}
        `;
        bindCalendarEvents();
    }

    // 상세는 달력 아래 인라인 — 팝업 위에 팝업을 겹치면 뒤로가기 히스토리가 꼬인다
    function renderCalDetail(idx) {
        if (!_calDay) return '';
        const list = idx.days[_calDay];
        if (!list || !list.length) return '';
        const yy = parseInt(_calDay.slice(0, 4), 10);
        const mm = parseInt(_calDay.slice(5, 7), 10);
        const dd = parseInt(_calDay.slice(8, 10), 10);
        const wd = CAL_WEEKDAYS[new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()];
        const rows = list.map((s, i) => {
            const label = CAL_GAME_LABELS[s.gameType] || '🎮 기타 게임';
            const winners = (s.winners && s.winners.length)
                ? `<span class="rk-cal-win">👑 ${esc(s.winners.join(', '))}</span>`
                : '<span class="rk-cal-win rk-cal-nowin">당첨자 없음</span>';
            return `<div class="rk-cal-drow">
                <span class="rk-cal-seq">${i + 1}차</span>
                <span class="rk-cal-game">${label}</span>
                ${winners}
            </div>`;
        }).join('');
        return `
            <div class="rk-section">
                <div class="rk-section-title">${mm}월 ${dd}일 (${wd}) · ${list.length}판</div>
                <div class="rk-card">${rows}</div>
            </div>`;
    }

    function bindCalendarEvents() {
        const prev = document.getElementById('rk-cal-prev');
        const next = document.getElementById('rk-cal-next');
        if (prev) prev.addEventListener('click', () => stepCalMonth(-1));
        if (next) next.addEventListener('click', () => stepCalMonth(1));
        const el = document.getElementById('ranking-content');
        if (!el) return;
        el.querySelectorAll('[data-cal-day]').forEach(cell => {
            cell.addEventListener('click', function () {
                const key = this.getAttribute('data-cal-day');
                _calDay = (_calDay === key) ? null : key; // 같은 날 다시 누르면 접는다
                repaintCalendar();
            });
        });
    }

    // 트랜지션 없이 제자리 갱신 — 날짜를 누를 때마다 페이드가 들어가면 눈이 아프다
    function repaintCalendar() {
        const el = document.getElementById('ranking-content');
        const data = _calCache[calKey()];
        if (!el || !data) return;
        const st = el.scrollTop;
        paintCalendar(el, data);
        el.scrollTop = st;
    }

    function stepCalMonth(dir) {
        const data = _calCache[calKey()];
        if (!data) return;
        const idx = buildCalIndex(data.sessions);
        const pos = idx.months.indexOf(_calMonth);
        const nextPos = pos + dir;
        if (pos < 0 || nextPos < 0 || nextPos >= idx.months.length) return;
        _calMonth = idx.months[nextPos];
        _calDay = null;
        const el = document.getElementById('ranking-content');
        if (el) setContentWithTransition(el, () => paintCalendar(el, data));
    }

    return {
        init, show, hide, forceHide, invalidateCache, setHost,
        onRankingReset: onNewSeason, onNewSeason,
        _showConfirm: showConfirm, _hideConfirm: hideConfirm, _doNewSeason: doNewSeason
    };
})();
