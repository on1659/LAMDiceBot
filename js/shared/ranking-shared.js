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

    // 보기·필터 상태 — 통합 랭킹: 보기 하나([순위|달력|메뉴]) × 게임 필터 하나
    let _view = 'rank';        // 'rank' | 'calendar' | 'menu'
    let _filter = 'all';       // 'all' | gameType — 순위와 달력에 같이 걸린다
    let _sort = 'wins';        // 'wins' | 'rate' | 'games'
    let _vehiclesOpen = false; // 경마 필터의 탈것 통계 펼침

    // 달력 (날짜별 당첨자)
    let _calCache = {};   // { [시즌키]: { sessions, truncated } } — 시즌별 분리 (셀렉터로 바꿔도 안 섞이게)
    let _calMonth = null; // 'YYYY-MM' 보고 있는 달
    let _calDay = null;   // 'YYYY-MM-DD' 펼쳐 놓은 날

    // server_game_records에 기록되는 게임 — 필터 칩·달력 아이콘·비율 막대가 이 표 하나를 쓴다 (키 순서 = 칩 순서)
    // 다리건너기·해적룰렛은 미사용 게임(CLAUDE.md)이라 뺐다 — 옛 기록은 '기타 게임'으로 묶여 전체에만 합산된다.
    // { icon: 공용 아이콘 id(css/ui-icons.css), text: 표시 이름, color: 비율 막대 색 토큰 }
    const GAME_META = {
        'dice': { icon: 'dice', text: '주사위', color: 'var(--rank-game-dice)' },
        'horse': { icon: 'horse', text: '경마', color: 'var(--rank-game-horse)' },
        'roulette': { icon: 'slot', text: '룰렛', color: 'var(--rank-game-roulette)' },
        'ladder': { icon: 'ladder', text: '사다리타기', color: 'var(--rank-game-ladder)' },
        'deguri': { icon: 'paw', text: '데구리', color: 'var(--rank-game-deguri)' },
        'spin-arena': { icon: 'swords', text: '회전 칼날', color: 'var(--rank-game-other)' }
    };
    const GAME_ORDER = Object.keys(GAME_META);
    const OTHER_GAME = 'other';
    const OTHER_META = { icon: 'gamepad', text: '기타 게임', color: 'var(--rank-game-other)' };
    function isKnownGame(type) { return Object.prototype.hasOwnProperty.call(GAME_META, type); }
    function gameMeta(type) { return isKnownGame(type) ? GAME_META[type] : OTHER_META; }
    function gameOrder(type) { const i = GAME_ORDER.indexOf(type); return i === -1 ? GAME_ORDER.length : i; }

    const VIEW_LABELS = {
        rank: { icon: 'medal', text: '순위' },
        calendar: { icon: 'calendar', text: '달력' },
        menu: { icon: 'burger', text: '메뉴' }
    };
    const SORTS = [
        { key: 'wins', text: '당첨 많은 순' },
        { key: 'rate', text: '당첨률' },
        { key: 'games', text: '참여 많은 순' }
    ];
    const TOP_N = 10;
    const RATE_MIN_GAMES = 5; // 당첨률은 그 범위에서 이 판수 이상인 사람만 (기존 승률 규칙)

    // 라벨 객체 렌더 — textContent 자리(탭·칩)는 노드로, innerHTML 템플릿(달력)은 문자열로. text 는 상수만.
    function setIconLabel(el, t) { el.replaceChildren(UIIcons.el(t.icon), ' ' + t.text); }
    function iconLabelHtml(t) { return UIIcons.tag(t.icon) + ' ' + t.text; }
    const CAL_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

    // 제스처 상태
    let _touchStartX = 0;
    let _touchStartY = 0;
    let _pullStartY = 0;
    let _isPulling = false;

    // 시즌 우승 탈것 — 탈것 이름/이모지 메타 (1회 로드 후 모듈 캐시, 패널 열 때마다 재요청 금지)
    let _vehicleThemes = null;         // { id: { name, emoji, ... } } | null
    let _vehicleThemesPromise = null;
    let _champsCache = {};             // { [시즌]: 시즌 우승 탈것 줄 HTML } — 필터를 경마로 바꿀 때마다 다시 받지 않게
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
        _champsCache = {};
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

    function show() {
        if (_overlay) { _overlay.remove(); _overlay = null; }
        _closing = false;
        // 어느 게임 방에서 열어도 통합 랭킹(전체·순위)으로 시작한다
        _view = 'rank';
        _filter = 'all';
        _sort = 'wins';
        _vehiclesOpen = false;
        _viewingSeason = null;
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

    // 색은 사이트 공통 토큰만 쓴다 — 라이트·다크·스킨을 그대로 따라간다 (THEME-DARK.md).
    // 크롬은 무채(카드 면·테두리·글자), 색은 액센트(선택 상태·내 줄·메달·게임 막대)에만.
    const CSS = `
        #ranking-overlay {
            position: fixed; inset: 0; z-index: 9999;
            background: rgba(var(--shadow-rgb),0.8); /* 백드롭 — 구 탈것 통계 모달 패리티, 페이지 라이트/다크 무관 고정 */
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            opacity: 0; transition: opacity 0.25s ease;
        }
        #ranking-overlay.rk-visible { opacity: 1; }

        /* ── 패널 (모바일 = 풀스크린, PC = 중앙 카드) — 위 고정 줄은 카드 면, 본문은 한 단계 꺼진 면 ── */
        .rk-panel {
            width: 100%; height: 100%;
            background: var(--gray-50);
            color: var(--text-primary);
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
                border: 1px solid var(--border-color);
                box-shadow: 0 12px 40px rgba(var(--shadow-rgb),0.25);
                overflow: hidden;
            }
        }

        /* ── 헤더 ── */
        .rk-header {
            display: flex; align-items: center; gap: 10px;
            padding: 12px 16px;
            background: var(--bg-white);
            flex-shrink: 0;
        }
        .rk-back-btn, .rk-reset-btn {
            /* width·margin·padding 직접 지정 — 전역 button{width:100%;margin-top:10px;padding:12px 25px}(horse-race.css) 상쇄 */
            width: 38px; height: 38px; margin: 0; padding: 0;
            border: 1px solid var(--border-color); border-radius: 10px;
            background: var(--bg-white); color: var(--text-secondary);
            font-size: 1.1em; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: background 0.15s;
        }
        .rk-reset-btn { display: none; margin-left: auto; }
        .rk-back-btn:hover, .rk-reset-btn:hover { background: var(--gray-50); transform: none; box-shadow: none; }
        .rk-back-btn:active, .rk-reset-btn:active { transform: scale(0.95); }
        .rk-header-title {
            font-family: 'Jua', sans-serif;
            font-size: 1.3em; color: var(--heading-brand);
        }

        /* ── 시즌 선택 ── */
        .rk-season-bar {
            display: flex; align-items: center; gap: 8px;
            padding: 0 16px 10px;
            background: var(--bg-white);
        }
        .rk-season-select {
            width: auto; margin: 0;
            background: var(--bg-white); color: var(--text-primary);
            border: 1px solid var(--border-color); border-radius: 8px;
            padding: 5px 10px; font-size: 0.85em;
            font-family: 'Jua', sans-serif;
        }
        .rk-season-label { color: var(--text-tertiary); font-size: 0.8em; }

        /* ── 보기 전환 (순위 | 달력 | 메뉴) ── */
        #ranking-view-bar:not(:empty) { background: var(--bg-white); padding: 0 16px 10px; }
        .rk-seg {
            display: flex; gap: 4px; padding: 3px;
            border-radius: 12px; background: var(--gray-100);
        }
        .rk-seg-btn {
            flex: 1; width: auto; margin: 0; padding: 8px 0;
            border: none; border-radius: 9px;
            background: transparent; color: var(--text-secondary);
            font-family: 'Jua', sans-serif; font-size: 0.92em;
            cursor: pointer; white-space: nowrap;
            transition: background 0.15s, color 0.15s;
        }
        .rk-seg-btn.active { background: var(--fill-brand); color: var(--text-on-accent); }
        .rk-seg-btn:not(.active):hover { color: var(--text-primary); }

        /* ── 게임 필터 칩 (순위·달력 공통) ── */
        #ranking-filter-bar:not(:empty) { background: var(--bg-white); }
        .rk-filter {
            position: relative; /* 활성 칩 offsetLeft 기준 — 가로 스크롤 맞추기 */
            display: flex; gap: 6px;
            padding: 0 16px 12px;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
        }
        .rk-filter::-webkit-scrollbar { display: none; }
        .rk-chip {
            flex-shrink: 0; width: auto; margin: 0; padding: 6px 12px;
            border-radius: 999px; border: 1px solid var(--border-color);
            background: var(--bg-white); color: var(--text-secondary);
            font-family: 'Jua', sans-serif; font-size: 0.86em;
            cursor: pointer; white-space: nowrap;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .rk-chip.active { background: var(--purple-50); border-color: var(--purple-500); color: var(--heading-brand); }
        .rk-chip:not(.active):hover { color: var(--text-primary); }
        /* 전역 button:hover(horse-race.css — 들뜸·그림자) 상쇄 — :active 보다 앞에 둬야 눌림 축소가 이긴다 */
        .rk-seg-btn:hover, .rk-chip:hover, .rk-sort-btn:hover, .rk-vtoggle:hover { transform: none; box-shadow: none; }
        .rk-chip:active { transform: scale(0.95); }

        /* ── 시즌 우승 탈것 (경마 필터) ── */
        #ranking-vehicle-champs:not(:empty) { background: var(--bg-white); }
        .rk-vchamp-bar {
            display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px;
            padding: 0 16px 12px;
            font-size: 0.8em;
        }
        .rk-vchamp-label { color: var(--text-tertiary); flex-shrink: 0; }
        .rk-vchamp-chip {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 3px 10px; border-radius: 999px;
            background: var(--gray-50); border: 1px solid var(--border-color);
            color: var(--text-secondary); white-space: nowrap;
        }
        .rk-vchamp-1 { border-color: var(--rank-gold); }
        .rk-vchamp-2 { border-color: var(--rank-silver); }
        .rk-vchamp-3 { border-color: var(--rank-bronze); }

        /* ── 콘텐츠 ── */
        .rk-content {
            flex: 1; overflow-y: auto;
            padding: 16px;
            border-top: 1px solid var(--border-color); /* 위 고정 줄 묶음(카드 면)과 본문 사이 */
            -webkit-overflow-scrolling: touch;
            transition: opacity 0.15s ease, transform 0.15s ease;
        }

        /* ── 섹션 ── */
        .rk-section {
            margin-bottom: 18px;
            animation: rkFadeInUp 0.3s ease both;
        }
        .rk-section-title {
            font-family: 'Jua', sans-serif;
            font-size: 0.95em; color: var(--text-secondary);
            margin: 0 0 10px 4px;
            display: flex; align-items: center; gap: 8px;
        }
        .rk-section-title::after { content: ''; flex: 1; height: 1px; background: var(--border-color); }
        .rk-top10-label { font-size: 0.85em; color: var(--text-tertiary); margin-bottom: 8px; }

        /* ── 카드 · 행 ── */
        .rk-card {
            background: var(--bg-white);
            border: 1px solid var(--border-color); border-radius: 14px;
            overflow: hidden;
        }
        .rk-row {
            display: flex; align-items: center;
            padding: 12px 14px; gap: 10px;
            border-bottom: 1px solid var(--gray-100);
        }
        .rk-row:last-child { border-bottom: none; }
        .rk-rank { min-width: 30px; text-align: center; flex-shrink: 0; }
        .rk-name { flex: 1; min-width: 0; color: var(--text-primary); font-size: 0.93em; }
        .rk-name-text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rk-top3 .rk-name { font-weight: 700; }
        /* 내 행 — 남들과 같은 줄 사이에서 한눈에 찾히게 (브랜드 틴트 — 스킨을 따라간다) */
        .rk-row.rk-me, .rk-cal-drow.rk-me {
            background: var(--purple-50);
            box-shadow: inset 3px 0 0 var(--purple-500);
        }
        .rk-row.rk-me .rk-name { color: var(--heading-brand); font-weight: 700; }
        .rk-me-badge {
            display: inline-block; margin-left: 6px; padding: 0 6px;
            border-radius: 8px; vertical-align: 1px;
            font-size: 0.7em; font-weight: 700; line-height: 1.6;
            background: var(--fill-brand); color: var(--text-on-accent);
        }
        .rk-value {
            color: var(--text-primary); font-size: 0.9em; font-weight: 700;
            white-space: nowrap; text-align: right;
            min-width: 5em; /* 숫자 폭이 줄마다 달라도 비율 막대 길이가 같게 */
        }
        .rk-value small {
            display: block; margin-top: 1px;
            font-size: 0.8em; font-weight: 400; color: var(--text-secondary);
        }

        /* ── 정렬 (당첨 많은 순 · 당첨률 · 참여 많은 순) ── */
        .rk-sort {
            display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px;
            margin: 0 4px 10px;
        }
        .rk-sort-btn {
            width: auto; margin: 0; padding: 2px 0;
            border: none; border-bottom: 2px solid transparent; border-radius: 0;
            background: none; color: var(--text-secondary);
            font-family: 'Jua', sans-serif; font-size: 0.88em;
            cursor: pointer;
        }
        .rk-sort-btn.active { color: var(--heading-brand); border-bottom-color: var(--purple-500); }
        .rk-sort-btn:not(.active):hover { color: var(--text-primary); }
        .rk-sort-note { margin-left: auto; font-size: 0.75em; color: var(--text-secondary); }

        /* 대표 게임 아이콘 — 전체 보기에서만. 당첨 0회인 사람은 빈 칸으로 열을 맞춘다 */
        .rk-gicon { flex-shrink: 0; width: 22px; text-align: center; font-size: 1.05em; }
        /* 게임별 당첨 비율 막대 */
        .rk-bar {
            display: flex; height: 4px; margin-top: 5px;
            border-radius: 2px; overflow: hidden;
            background: var(--gray-100);
        }
        .rk-bar span { display: block; height: 100%; }
        /* 내가 10등 밖일 때 목록과 내 줄 사이 */
        .rk-me-sep {
            text-align: center; padding: 2px 0;
            color: var(--text-tertiary); font-size: 0.8em; letter-spacing: 3px;
            border-bottom: 1px solid var(--gray-100);
        }
        .rk-legend {
            margin: 10px 4px 0;
            font-size: 0.76em; line-height: 1.5; color: var(--text-secondary);
        }

        /* ── 메달 (1~3등) ── */
        .rk-medal {
            display: inline-flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; border-radius: 50%;
            font-family: 'Jua', sans-serif; font-size: 0.85em;
            color: var(--rank-medal-ink);
        }
        .rk-gold { background: var(--rank-gold); }
        .rk-silver { background: var(--rank-silver); }
        .rk-bronze { background: var(--rank-bronze); }
        .rk-rank-num {
            display: inline-flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; border-radius: 50%;
            font-size: 0.8em; font-weight: 700;
            color: var(--text-tertiary); background: var(--gray-100);
        }

        /* ── 빈 상태 ── */
        .rk-empty {
            text-align: center; padding: 60px 20px;
            color: var(--text-tertiary);
            font-family: 'Jua', sans-serif; font-size: 1em;
        }
        .rk-empty-icon { font-size: 3em; margin-bottom: 12px; opacity: 0.6; }
        .rk-empty-sm { padding: 28px 12px; font-size: 0.9em; }

        /* ── 스켈레톤 로딩 ── */
        .rk-skeleton-section { margin-bottom: 20px; }
        .rk-skeleton-card {
            background: var(--bg-white);
            border: 1px solid var(--border-color); border-radius: 14px; padding: 4px 0;
        }
        .rk-skeleton-row { display: flex; align-items: center; padding: 14px 16px; gap: 12px; }
        .rk-skeleton-circle, .rk-skeleton-bar {
            background: var(--gray-100);
            animation: rkShimmer 1.5s ease-in-out infinite;
        }
        .rk-skeleton-circle { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; }
        .rk-skeleton-bar { height: 16px; border-radius: 8px; }

        /* ── 당겨서 새로고침 ── */
        .rk-pull-indicator {
            text-align: center; padding: 12px;
            color: var(--text-tertiary);
            font-family: 'Jua', sans-serif;
            font-size: 0.85em; transition: opacity 0.2s;
        }

        /* ── 탈것 통계 펼치기 (경마 필터) ── */
        .rk-vtoggle {
            width: 100%; margin: 0; padding: 12px 14px;
            display: flex; align-items: center; justify-content: space-between;
            border: 1px solid var(--border-color); border-radius: 14px;
            background: var(--bg-white); color: var(--heading-brand);
            font-family: 'Jua', sans-serif; font-size: 0.92em;
            cursor: pointer;
        }
        .rk-vtoggle:hover { background: var(--gray-50); }
        .rk-vtoggle-state { font-size: 0.85em; color: var(--text-tertiary); }
        .rk-vcard { margin-top: 8px; }

        /* ── 탈것 통계 표 ── */
        .rk-table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .rk-vehicle-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
        .rk-vehicle-table th {
            padding: 10px 6px; text-align: center;
            color: var(--text-tertiary); font-weight: 600;
            font-size: 0.85em; white-space: nowrap;
            border-bottom: 1px solid var(--border-color);
        }
        .rk-vehicle-table th:first-child { text-align: left; padding-left: 14px; }
        .rk-vehicle-table td {
            padding: 10px 6px; text-align: center;
            color: var(--text-secondary); white-space: nowrap;
            border-bottom: 1px solid var(--gray-100);
        }
        .rk-vehicle-table td:first-child {
            text-align: left; padding-left: 14px;
            font-weight: 600; color: var(--text-primary);
        }
        .rk-vehicle-table tr:last-child td { border-bottom: none; }
        .rk-rank-cell {
            display: inline-flex; align-items: center; justify-content: center;
            min-width: 26px; height: 22px; border-radius: 6px;
            font-weight: 600; font-size: 0.9em;
        }
        .rk-rank-1 { background: var(--rank-gold); color: var(--rank-medal-ink); }
        .rk-rank-6 { background: var(--red-50); color: var(--red-500); }
        .rk-vehicle-table tr.rk-low-sample td { opacity: 0.5; }
        .rk-low-label { display: inline-block; margin-left: 4px; font-size: 0.8em; color: var(--text-tertiary); }
        .rk-table-note {
            margin: 0; padding: 10px 14px 12px;
            font-size: 0.78em; line-height: 1.5;
            color: var(--text-tertiary);
        }

        /* ── 애니메이션 ── */
        @keyframes rkShimmer {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 1; }
        }
        @keyframes rkSlideDown {
            from { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
            to { opacity: 1; max-height: 60px; }
        }
        @keyframes rkFadeInUp {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* ── 새 시즌 확인바 / 피드백바 ── */
        .rk-confirm-bar {
            display: flex; align-items: center; justify-content: center; gap: 12px;
            padding: 10px 16px;
            background: var(--purple-50);
            border-bottom: 1px solid var(--border-color);
            font-family: 'Jua', sans-serif; font-size: 0.9em;
            color: var(--text-primary);
            flex-shrink: 0;
            animation: rkSlideDown 0.2s ease;
        }
        .rk-confirm-yes, .rk-confirm-no {
            width: auto; margin: 0; padding: 6px 16px;
            border: none; border-radius: 8px;
            font-family: 'Jua', sans-serif; font-size: 0.85em;
            cursor: pointer; white-space: nowrap;
            color: var(--text-on-accent);
        }
        .rk-confirm-yes { background: var(--fill-brand); }
        .rk-confirm-no { background: var(--btn-neutral); }
        .rk-confirm-yes:active, .rk-confirm-no:active { transform: scale(0.95); }
        .rk-feedback-bar {
            display: flex; align-items: center; justify-content: center;
            padding: 10px 16px;
            font-family: 'Jua', sans-serif; font-size: 0.9em;
            color: var(--text-on-accent); flex-shrink: 0;
            animation: rkSlideDown 0.2s ease;
        }
        .rk-feedback-bar.success { background: var(--fill-success); }
        .rk-feedback-bar.error { background: var(--fill-danger); }

        /* ── 달력 ── */
        .rk-cal-nav {
            display: flex; align-items: center; justify-content: center; gap: 14px;
            margin-bottom: 12px;
        }
        .rk-cal-nav-btn {
            /* 전역 button{width:100%;margin-top:10px;padding:12px 25px}(horse-race.css) 상쇄 —
               경마·사다리·해적·회전칼날·다리건너기 5개 페이지가 그 시트를 로드한다 */
            background: var(--bg-white); border: 1px solid var(--border-color);
            color: var(--text-primary); margin-top: 0; padding: 0;
            width: 32px; height: 32px; border-radius: 10px;
            font-size: 0.95em; cursor: pointer; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            transition: background 0.15s;
        }
        .rk-cal-nav-btn:hover:not(:disabled) { background: var(--gray-100); transform: none; box-shadow: none; }
        .rk-cal-nav-btn:disabled { opacity: 0.35; cursor: default; }
        .rk-cal-title {
            font-family: 'Jua', sans-serif; font-size: 1.02em;
            color: var(--heading-brand); min-width: 130px; text-align: center;
        }
        /* 달력 묶음만 본문 여백 밖으로 6px씩 — 모바일 칸 폭(약 48px)을 이름에 더 준다 */
        .rk-cal-month { margin-left: -6px; margin-right: -6px; }
        .rk-cal-wdrow, .rk-cal-grid {
            display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px;
        }
        .rk-cal-wdrow { margin-bottom: 4px; }
        .rk-cal-wd { text-align: center; font-size: 0.72em; color: var(--text-secondary); padding: 2px 0; }
        .rk-cal-wd.sun { color: var(--red-600); }
        .rk-cal-cell {
            /* 날짜 + 이름 2줄 + "+N" 까지 4줄이 들어간다 */
            min-height: 62px; border-radius: 10px;
            padding: 4px 1px 5px; /* 좌우 1px — 아이콘 옆 세 글자 이름이 말줄임 없이 들어가는 폭 */
            display: flex; flex-direction: column; align-items: center; gap: 1px;
            border: 1px solid transparent;
            overflow: hidden;
        }
        .rk-cal-daynum {
            font-size: 0.7em; color: var(--text-secondary);
            line-height: 1.2; flex-shrink: 0;
        }
        .rk-cal-has {
            background: var(--bg-white);
            border-color: var(--border-color);
            cursor: pointer;
        }
        .rk-cal-has:hover { background: var(--gray-100); }
        .rk-cal-has .rk-cal-daynum { color: var(--text-primary); }
        .rk-cal-today { border-color: var(--purple-500); }
        .rk-cal-today .rk-cal-daynum { color: var(--heading-brand); font-weight: 700; }
        .rk-cal-sel { border-color: var(--purple-500); box-shadow: inset 0 0 0 1px var(--purple-500); background: var(--purple-50); }
        /* 날짜 숫자 아래 남은 높이를 전부 차지하고 그 안에서 세로 가운데 정렬.
           1명이면 칸 가운데, 2명+"+N"이면 공간이 꽉 차 날짜 바로 아래로 붙는다 */
        .rk-cal-names {
            flex: 1; width: 100%; min-height: 0;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 1px;
            overflow: hidden;
        }
        /* 게임 아이콘 + 이름 한 줄 — 이름만 말줄임, 아이콘은 줄지 않는다 */
        .rk-cal-winner {
            display: flex; align-items: center; gap: 1px;
            font-size: 0.68em; line-height: 1.25; letter-spacing: -0.2px;
            color: var(--text-primary); font-weight: 600;
            max-width: 100%;
        }
        .rk-cal-winner .ui { width: 1.05em; height: 1.05em; }
        .rk-cal-wname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rk-cal-winner.rk-cal-me, .rk-cal-more.rk-cal-me, .rk-cal-win .rk-cal-me {
            padding: 0 2px; border-radius: 4px;
            color: var(--heading-brand);
            box-shadow: 0 0 0 1px var(--purple-500);
        }
        .rk-cal-more { font-size: 0.7em; color: var(--text-tertiary); line-height: 1; font-weight: 700; }
        .rk-cal-nowin { font-size: 0.66em; color: var(--text-tertiary); }

        /* ── 날짜 상세 (달력 아래 인라인 — 팝업 위 팝업은 뒤로가기가 꼬여서 안 씀) ── */
        .rk-cal-drow {
            display: flex; align-items: center; gap: 10px;
            padding: 11px 14px;
            border-bottom: 1px solid var(--gray-100);
        }
        .rk-cal-drow:last-child { border-bottom: none; }
        .rk-cal-seq { flex-shrink: 0; min-width: 30px; font-size: 0.78em; font-weight: 700; color: var(--heading-brand); }
        .rk-cal-game { flex-shrink: 0; font-size: 0.85em; color: var(--text-secondary); }
        .rk-cal-win {
            flex: 1; text-align: right;
            font-size: 0.85em; color: var(--text-primary); font-weight: 600;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .rk-cal-hint { text-align: center; padding: 14px 10px 0; font-size: 0.78em; color: var(--text-secondary); }
        .rk-cal-note {
            margin: 12px 0 0; padding: 10px 14px;
            border-radius: 10px; background: var(--bg-white); border: 1px solid var(--border-color);
            font-size: 0.76em; line-height: 1.5; color: var(--text-tertiary);
        }
        /* 날짜 상세 맨 위 — 그 날 사람별 당첨 요약 (많은 순) */
        .rk-cal-pills {
            display: flex; flex-wrap: wrap; gap: 6px;
            padding: 12px 14px;
            border-bottom: 1px solid var(--gray-100);
        }
        .rk-cal-pill {
            display: inline-flex; align-items: center; gap: 3px;
            padding: 3px 10px; border-radius: 999px;
            background: var(--gray-50); border: 1px solid var(--border-color);
            font-size: 0.8em; color: var(--text-primary); white-space: nowrap;
        }
        .rk-cal-pill b { color: var(--heading-brand); font-weight: 700; }
        .rk-cal-pill-me { border-color: var(--purple-500); background: var(--purple-50); }

        @media (max-width: 360px) {
            .rk-cal-cell { min-height: 56px; }
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
                    <span class="rk-header-title"><i class="ui ui-trophy"></i> 랭킹 · 시즌 ${_currentSeason}</span>
                    <button class="rk-reset-btn" style="display:${(_isHost && _serverId && !_viewingSeason) ? 'flex' : 'none'}" onclick="RankingModule._showConfirm()"><i class="ui ui-refresh"></i></button>
                </div>
                <div id="ranking-confirm-slot"></div>
                <div id="ranking-season-bar"></div>
                <div id="ranking-view-bar"></div>
                <div id="ranking-filter-bar"></div>
                <div id="ranking-vehicle-champs"></div>
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

    // ─── 보기 · 필터 전환 ───

    // 달력은 서버 기록에서만(자유 랭킹은 배포 전역이라 "누가 걸렸나"가 의미 없다),
    // 메뉴는 주문 데이터가 오는 서버 랭킹 현재 시즌에서만
    function availableViews() {
        const views = ['rank'];
        if (_serverId) views.push('calendar');
        if (_cache && _cache.orders) views.push('menu');
        return views;
    }

    // 필터 칩 — 이 시즌에 기록이 있는 게임만 (칩 순서는 GAME_META).
    // 경마는 탈것 통계(배포 전역 누적)만 있어도 연다 — 자유 랭킹은 게임 기록이 비어 이 표가 유일한 볼거리다
    function availableGames() {
        const has = {};
        ((_cache && _cache.players) || []).forEach(p => {
            Object.keys(p.byGame || {}).forEach(t => { if (p.byGame[t].games > 0) has[t] = true; });
        });
        if (_cache && _cache.vehicles && _cache.vehicles.length) has.horse = true;
        return GAME_ORDER.filter(t => has[t]);
    }

    function switchView(view) {
        if (view === _view) return;
        _view = view;
        _calDay = null;
        renderChrome();
        renderCurrentView();
    }

    function setFilter(key) {
        if (key === _filter) return;
        _filter = key;
        _calMonth = null; // 범위가 바뀌면 기록 있는 달도 달라진다
        _calDay = null;
        _vehiclesOpen = false;
        renderChrome();
        renderCurrentView();
    }

    // 본문 위 고정 줄들(보기 전환·게임 필터·시즌 우승 탈것)을 지금 상태에 맞춘다
    function renderChrome() {
        renderViewBar();
        renderFilterBar();
        syncVehicleChamps();
    }

    function renderViewBar() {
        const bar = document.getElementById('ranking-view-bar');
        if (!bar) return;
        bar.replaceChildren();
        const views = availableViews();
        if (views.length <= 1) return; // 고를 보기가 없으면(자유 랭킹) 줄째 숨긴다
        const seg = document.createElement('div');
        seg.className = 'rk-seg';
        views.forEach(v => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rk-seg-btn' + (v === _view ? ' active' : '');
            setIconLabel(btn, VIEW_LABELS[v]);
            btn.onclick = () => switchView(v);
            seg.appendChild(btn);
        });
        bar.appendChild(seg);
    }

    function renderFilterBar() {
        const bar = document.getElementById('ranking-filter-bar');
        if (!bar) return;
        bar.replaceChildren();
        if (_view === 'menu') return; // 주문은 게임 기록이 아니라 게임 필터가 맞지 않는다
        const games = availableGames();
        if (!games.length) return;
        const wrap = document.createElement('div');
        wrap.className = 'rk-filter';
        ['all'].concat(games).forEach(key => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'rk-chip' + (key === _filter ? ' active' : '');
            if (key === 'all') btn.textContent = '전체';
            else setIconLabel(btn, GAME_META[key]);
            btn.onclick = () => setFilter(key);
            wrap.appendChild(btn);
        });
        bar.appendChild(wrap);
        // 스와이프로 필터가 바뀌면 활성 칩이 가로 스크롤 밖일 수 있다 — 가운데로 당겨 온다
        const active = wrap.querySelector('.rk-chip.active');
        if (active) wrap.scrollLeft = Math.max(0, active.offsetLeft - (wrap.clientWidth - active.offsetWidth) / 2);
    }

    // 보기·필터를 바꿀 때 — 짧은 페이드 후 그린다
    function renderCurrentView() {
        const content = document.getElementById('ranking-content');
        if (!content) return;
        setContentWithTransition(content, () => paintCurrentView(content));
    }

    function paintCurrentView(el) {
        if (_view === 'calendar') renderCalendarView(el);
        else if (_view === 'menu') renderOrders(el);
        else renderRank(el);
    }

    // 정렬·펼치기·날짜 선택처럼 같은 화면 안에서 바뀔 때 — 페이드 없이 제자리, 스크롤 위치 유지
    function repaintInPlace() {
        const el = document.getElementById('ranking-content');
        if (!el) return;
        const st = el.scrollTop;
        paintCurrentView(el);
        el.scrollTop = st;
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

        // 시즌을 바꾸면 보기·게임 구성이 달라진다 — 없어진 보기·게임에 머물러 있지 않게
        if (availableViews().indexOf(_view) === -1) _view = 'rank';
        if (_filter !== 'all' && availableGames().indexOf(_filter) === -1) _filter = 'all';

        // 여기서는 달 선택을 초기화하지 않는다 (당겨서 새로고침이 보던 달을 유지하도록)
        renderChrome();
        paintCurrentView(content);
    }

    // ─── 통합 순위 ───

    // 사람별 byGame — 칩에 없는 옛 게임(다리건너기·해적룰렛 등)은 '기타 게임' 하나로 묶는다
    function normalizeByGame(by) {
        const out = {};
        Object.keys(by || {}).forEach(t => {
            const key = isKnownGame(t) ? t : OTHER_GAME;
            const cur = out[key] || (out[key] = { games: 0, wins: 0 });
            cur.games += by[t].games;
            cur.wins += by[t].wins;
        });
        return out;
    }

    // 지금 필터 범위로 사람별 수치를 합친다 — 전체면 모든 게임(기타 포함), 아니면 그 게임만
    function rankRows() {
        const rows = [];
        ((_cache && _cache.players) || []).forEach(p => {
            const by = normalizeByGame(p.byGame);
            const scope = _filter === 'all' ? Object.keys(by) : (by[_filter] ? [_filter] : []);
            let games = 0, wins = 0;
            scope.forEach(t => { games += by[t].games; wins += by[t].wins; });
            if (games > 0) rows.push({ name: p.name, games, wins, rate: wins / games, byGame: by });
        });
        return rows;
    }

    function sortRows(rows) {
        if (_sort === 'rate') {
            return rows.filter(r => r.games >= RATE_MIN_GAMES).sort((a, b) => b.rate - a.rate || b.games - a.games);
        }
        if (_sort === 'games') return rows.sort((a, b) => b.games - a.games || b.wins - a.wins);
        return rows.sort((a, b) => b.wins - a.wins || b.games - a.games);
    }

    function sortValue(r) {
        return _sort === 'rate' ? r.rate : (_sort === 'games' ? r.games : r.wins);
    }

    // 대표 게임 — 당첨이 가장 많은 게임. 동률이면 많이 한 게임, 그래도 같으면 칩 순서
    function topGame(by) {
        let best = null;
        Object.keys(by).forEach(t => {
            const v = by[t];
            if (!v.wins) return;
            const b = best && by[best];
            if (!b || v.wins > b.wins || (v.wins === b.wins && (v.games > b.games || (v.games === b.games && gameOrder(t) < gameOrder(best))))) best = t;
        });
        return best;
    }

    // 게임별 당첨 비율 막대 — 칩 순서로 쌓고 기타 게임은 맨 끝
    function winsBarHtml(by, total) {
        if (!total) return '';
        const types = Object.keys(by).filter(t => by[t].wins > 0).sort((a, b) => gameOrder(a) - gameOrder(b));
        const title = types.map(t => `${gameMeta(t).text} ${by[t].wins}회`).join(' · ');
        const segs = types.map(t => `<span style="width:${(by[t].wins / total * 100).toFixed(2)}%;background:${gameMeta(t).color}"></span>`).join('');
        return `<span class="rk-bar" title="${title}">${segs}</span>`;
    }

    function rankRow(rank, r, showGame) {
        let value;
        if (_sort === 'rate') value = `${Math.round(r.rate * 1000) / 10}%<small>${r.wins}/${r.games}판</small>`;
        else if (_sort === 'games') value = `${r.games}판<small>당첨 ${r.wins}회</small>`;
        else value = `${r.wins}회<small>${r.games}판 중</small>`;
        let gameCol = '';
        let bar = '';
        if (showGame) {
            const top = topGame(r.byGame);
            gameCol = top
                ? `<span class="rk-gicon" title="가장 많이 당첨된 게임: ${gameMeta(top).text}">${UIIcons.tag(gameMeta(top).icon)}</span>`
                : '<span class="rk-gicon"></span>';
            bar = winsBarHtml(r.byGame, r.wins);
        }
        const me = isMe(r.name);
        return `
            <div class="rk-row${rank <= 3 ? ' rk-top3' : ''}${me ? ' rk-me' : ''}">
                <span class="rk-rank">${medalHtml(rank)}</span>
                ${gameCol}
                <span class="rk-name"><span class="rk-name-text">${esc(r.name)}${me ? '<span class="rk-me-badge">나</span>' : ''}</span>${bar}</span>
                <span class="rk-value">${value}</span>
            </div>
        `;
    }

    function sortBarHtml() {
        const btns = SORTS.map(o => `<button type="button" class="rk-sort-btn${o.key === _sort ? ' active' : ''}" data-sort="${o.key}">${o.text}</button>`).join('');
        const note = _sort === 'rate' ? `<span class="rk-sort-note">${RATE_MIN_GAMES}판 이상만</span>` : '';
        return `<div class="rk-sort">${btns}${note}</div>`;
    }

    function renderRank(el) {
        const base = rankRows();
        if (!base.length) {
            const what = _filter === 'all' ? '' : iconLabelHtml(gameMeta(_filter)) + ' ';
            // 경마 순위가 비어도 탈것 통계는 있을 수 있다 — 볼 게 그것뿐이라 펼친 채로 보인다
            el.innerHTML = emptyMsg(`아직 ${what}기록이 없습니다.`) + (_filter === 'horse' ? vehicleSectionHtml(true) : '');
            return;
        }
        const rows = sortRows(base);
        const showGame = _filter === 'all';
        let body;
        if (!rows.length) {
            body = `<div class="rk-empty rk-empty-sm">${RATE_MIN_GAMES}판 이상 한 사람이 아직 없습니다.</div>`;
        } else {
            const ranks = assignDisplayRanks(rows, sortValue);
            const lines = rows.slice(0, TOP_N).map((r, i) => rankRow(ranks[i], r, showGame));
            const meIdx = rows.findIndex(r => isMe(r.name));
            if (meIdx >= TOP_N) lines.push('<div class="rk-me-sep">···</div>', rankRow(ranks[meIdx], rows[meIdx], showGame));
            body = `<div class="rk-card">${lines.join('')}</div>`;
        }
        let html = `<div class="rk-section">${sortBarHtml()}${body}`;
        if (showGame && rows.length) html += '<p class="rk-legend">아이콘 = 가장 많이 당첨된 게임 · 막대 = 게임별 당첨 비율</p>';
        html += '</div>';
        if (_filter === 'horse') html += vehicleSectionHtml();
        el.innerHTML = html;

        el.querySelectorAll('[data-sort]').forEach(btn => btn.addEventListener('click', function () {
            if (this.dataset.sort === _sort) return;
            _sort = this.dataset.sort;
            repaintInPlace();
        }));
        const vt = el.querySelector('.rk-vtoggle');
        if (vt) vt.addEventListener('click', () => { _vehiclesOpen = !_vehiclesOpen; repaintInPlace(); });
    }

    // 탈것 통계 — 배포 전역 누적이라 현재 시즌 응답에만 vehicles가 온다 (지난 시즌 보기에선 안 보인다)
    function vehicleSectionHtml(alwaysOpen) {
        const vehicles = _cache && _cache.vehicles;
        if (!vehicles || !vehicles.length) return '';
        if (alwaysOpen) return `<div class="rk-section"><div class="rk-section-title">${UIIcons.tag('chart')} 탈것 통계</div>${vehicleTableHtml(vehicles)}</div>`;
        const btn = `<button type="button" class="rk-vtoggle" aria-expanded="${_vehiclesOpen}">`
            + `<span>${UIIcons.tag('chart')} 탈것 통계</span>`
            + `<span class="rk-vtoggle-state">${_vehiclesOpen ? '접기 ▴' : '펼치기 ▾'}</span></button>`;
        return `<div class="rk-section">${btn}${_vehiclesOpen ? vehicleTableHtml(vehicles) : ''}</div>`;
    }

    function vehicleTableHtml(list) {
        // 승률 내림차순, 동률 시 출전 많은 순 (서버는 rank_1 DESC — 클라에서 재정렬 필수)
        const vehicles = list.slice().sort((a, b) => {
            const wa = a.appearances > 0 ? a.ranks[0] / a.appearances : 0;
            const wb = b.appearances > 0 ? b.ranks[0] / b.appearances : 0;
            if (wb !== wa) return wb - wa;
            return (b.appearances || 0) - (a.appearances || 0);
        });
        let tableHtml = `
                <div class="rk-card rk-vcard" style="padding:0;">
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
            const label = (t && t.name) || VEHICLE_NAME_MAP[v.id] || v.id;
            const thumb = vehicleThumbHtml(v.id, 28);
            const appearances = Number(v.appearances) || 0;
            const picks = Number(v.picks) || 0;
            const r = v.ranks || [0, 0, 0, 0, 0, 0];
            const winRate = appearances > 0 ? Math.round((r[0] / appearances) * 100) : 0;
            // 같은 탈것에 여러 명이 베팅할 수 있어 1을 넘을 수 있다 → 비율(%)이 아니라 인원수로 표시
            const pickAvg = appearances > 0 ? (picks / appearances).toFixed(1) : '0.0';
            const lowSample = appearances < 5; // 추천 배지와 동일 기준 (최소 등장 5회)
            tableHtml += `<tr${lowSample ? ' class="rk-low-sample"' : ''}>
                <td>${thumb}${esc(label)}</td>
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
            + '</div>';

        // 테마 미로드 시 이름 맵으로 먼저 그리고, 로드 성공 시에만 1회 제자리 재렌더
        // (실패 시 _vehicleThemes가 null로 남으므로 재렌더 루프 없음 — C-26/C-27 stale 가드)
        if (!_vehicleThemes) {
            loadVehicleThemesOnce().then(() => {
                if (_vehicleThemes && _overlay && _view === 'rank' && _filter === 'horse') repaintInPlace();
            });
        }
        return tableHtml;
    }

    function renderOrders(el) {
        const d = _cache.orders;
        if (!d) { el.innerHTML = emptyMsg('주문 데이터가 없습니다.'); return; }
        if (!(d.myTopMenus && d.myTopMenus.length) && !(d.popularMenus && d.popularMenus.length)) {
            el.innerHTML = emptyMsg('아직 주문 기록이 없습니다.');
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

    function medalHtml(rank) {
        if (rank === 1) return '<span class="rk-medal rk-gold">1</span>';
        if (rank === 2) return '<span class="rk-medal rk-silver">2</span>';
        if (rank === 3) return '<span class="rk-medal rk-bronze">3</span>';
        return `<span class="rk-rank-num">${rank}</span>`;
    }

    function row(rank, name, value, me) {
        const top3Class = rank <= 3 ? ' rk-top3' : '';
        const meClass = me ? ' rk-me' : '';
        const meBadge = me ? '<span class="rk-me-badge">나</span>' : '';
        return `
            <div class="rk-row${top3Class}${meClass}">
                <span class="rk-rank">${medalHtml(rank)}</span>
                <span class="rk-name"><span class="rk-name-text">${esc(name)}${meBadge}</span></span>
                <span class="rk-value">${esc(value)}</span>
            </div>
        `;
    }

    function emptyMsg(text) {
        return `<div class="rk-empty">
            <div class="rk-empty-icon"><i class="ui ui-xl ui-gamepad"></i></div>
            <div>${text}</div>
        </div>`;
    }

    function top10Label() {
        return '<div class="rk-section-title rk-top10-label">1~10등까지 랭킹</div>';
    }

    function isMe(name) {
        return !!_userName && name === _userName;
    }

    // 경마 탈것 썸네일 — 경마 페이지(js/horse-race-sprites.js 로드)에서만 인라인 SVG, 그 외엔 빈 문자열(탈것 통계 탭은 경마 전용)
    function vehicleThumbHtml(vehicleId, px) {
        if (typeof getVehicleSVG !== 'function') return '';
        const svgs = getVehicleSVG(vehicleId);
        const frame = svgs && ((svgs.idle && svgs.idle.frame1) || (svgs.run && svgs.run.frame1) || svgs.frame1);
        if (!frame) return '';
        return `<span class="rk-vthumb" style="display:inline-block;width:${px}px;height:${Math.round(px * 0.75)}px;vertical-align:middle;margin-right:4px;">${frame.replace(/<svg\b/, '<svg style="width:100%;height:100%"')}</span>`;
    }

    function esc(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── 스와이프 제스처 ───

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
                // 달력은 달 이동, 순위는 옆 게임 필터(칩 줄과 같은 순서), 메뉴는 넘길 게 없다
                if (_view === 'calendar') { stepCalMonth(dx < 0 ? 1 : -1); return; }
                if (_view !== 'rank') return;
                const keys = ['all'].concat(availableGames());
                const idx = keys.indexOf(_filter);
                const next = idx + (dx < 0 ? 1 : -1);
                if (idx !== -1 && next >= 0 && next < keys.length) setFilter(keys[next]);
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
            titleEl.replaceChildren(UIIcons.el('trophy'), ` 랭킹 · 시즌 ${viewing}`);
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

    // 경마 필터의 순위 보기에서만 — 다른 게임을 보는 중엔 군더더기
    function syncVehicleChamps() {
        const slot = document.getElementById('ranking-vehicle-champs');
        if (!slot) return;
        if (_view !== 'rank' || _filter !== 'horse') { slot.innerHTML = ''; return; }
        renderVehicleChamps();
    }

    async function renderVehicleChamps() {
        const slot = document.getElementById('ranking-vehicle-champs');
        if (!slot) return;
        if (!_serverId) { slot.innerHTML = ''; return; } // 자유 랭킹은 시즌 탈것 데이터 없음
        const viewing = _viewingSeason || _currentSeason;
        if (_champsCache[viewing] !== undefined) { slot.innerHTML = _champsCache[viewing]; return; }
        // 응답 대기 중 시즌·필터가 바뀌었거나 패널이 닫혔으면 stale — DOM을 건드리지 않는다 (늦은 응답이 새 화면을 덮지 않게)
        const isStale = () => !_overlay || viewing !== (_viewingSeason || _currentSeason) || _view !== 'rank' || _filter !== 'horse';
        try {
            const res = await fetch(`/api/ranking/${_serverId}/vehicles?season=${viewing}`);
            if (isStale()) return;
            if (!res.ok) { slot.innerHTML = ''; return; }
            const data = await res.json();
            const vehicles = (data && data.success && Array.isArray(data.vehicles)) ? data.vehicles : [];
            if (isStale()) return;
            if (!vehicles.length) { _champsCache[viewing] = ''; slot.innerHTML = ''; return; }
            const themes = await loadVehicleThemesOnce();
            if (isStale()) return;
            const medals = [UIIcons.tag('medal'), UIIcons.tag('silver'), UIIcons.tag('bronze')];
            const chips = vehicles.slice(0, 3).map((v, i) => {
                const t = themes ? themes[v.vehicle_id] : null;
                const name = (t && t.name) || VEHICLE_NAME_MAP[v.vehicle_id] || v.vehicle_id;
                const wins = Number(v.rank_1) || 0;
                return `<span class="rk-vchamp-chip rk-vchamp-${i + 1}">${medals[i]} ${vehicleThumbHtml(v.vehicle_id, 24)}${esc(name)} ${wins}승</span>`;
            });
            const html = `
                <div class="rk-vchamp-bar">
                    <span class="rk-vchamp-label">시즌 우승 탈것</span>
                    ${chips.join('')}
                </div>`;
            _champsCache[viewing] = html;
            slot.innerHTML = html;
        } catch (e) {
            if (isStale()) return;
            const s = document.getElementById('ranking-vehicle-champs');
            if (s) s.innerHTML = ''; // 조회 실패 시 섹션 숨김 — 랭킹 본문에는 영향 없음
        }
    }

    // ─── 날짜별 당첨자 달력 ───

    // 지금 화면이 어느 게임의 달력인지 — null이면 전체 (게임 필터를 그대로 따른다)
    function calGameFilter() {
        return _filter === 'all' ? null : _filter;
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

    // 지금 고른 탭 범위로 걸러서 날짜별로 묶는다. 달력을 그리는 모든 경로(paintCalendar·stepCalMonth)가
    // 이 함수를 거치므로 필터를 여기 한 곳에만 둔다 — 달 목록·칸·상세가 같은 기준으로 계산된다.
    function buildCalIndex(sessions) {
        const days = {};
        const monthSet = {};
        const only = calGameFilter(); // null이면 전체(종합)
        (sessions || []).forEach(s => {
            if (only && s.gameType !== only) return;
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

    // 그 날 당첨자 — 먼저 당첨된 사람부터(아래 1차·2차 목록과 같은 순서).
    // 승수 순으로 정렬하면 상세 패널의 1차·2차 순서와 어긋나 같은 날을 두 가지 순서로 보게 된다.
    // 사람마다 그 날 당첨 횟수와 가장 많이 당첨된 게임(game)을 붙인다 — 동률이면 그 날 먼저 당첨된 게임
    // (list는 buildCalIndex에서 playedAt 오름차순이라 먼저 본 게임이 앞선다)
    function calDayWinners(list) {
        const byName = new Map();
        list.forEach(s => (s.winners || []).forEach(n => {
            if (!byName.has(n)) byName.set(n, { name: n, count: 0, perGame: new Map() });
            const w = byName.get(n);
            w.count++;
            w.perGame.set(s.gameType, (w.perGame.get(s.gameType) || 0) + 1);
        }));
        const out = [...byName.values()];
        out.forEach(w => {
            let best = null;
            w.perGame.forEach((c, t) => { if (best === null || c > w.perGame.get(best)) best = t; });
            w.game = best;
        });
        return out;
    }

    // 칸에는 이름 2명까지, 3명째부터는 +N 하나로 접는다 (칸 폭이 모바일에서 46px라 그 이상은 안 들어간다)
    const CAL_CELL_NAMES = 2;

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
            if (!_overlay || _view !== 'calendar' || calKey() !== key) return;
            const el2 = document.getElementById('ranking-content');
            if (el2) paintCalendar(el2, data);
        });
    }

    function paintCalendar(el, data) {
        if (data.failed) { el.innerHTML = emptyMsg('달력을 불러올 수 없습니다.'); return; }
        const idx = buildCalIndex(data.sessions);
        const only = calGameFilter();
        if (!idx.months.length) {
            // 어느 범위가 비었는지 알려준다 — 전체가 빈 건지 이 게임만 빈 건지 구분이 안 되면 고장으로 읽힌다
            const what = only ? iconLabelHtml(gameMeta(only)) : '';
            el.innerHTML = emptyMsg(only ? `아직 ${what} 기록이 없습니다.` : '아직 기록이 없습니다.');
            return;
        }
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
                const winners = calDayWinners(list);
                const shown = winners.slice(0, CAL_CELL_NAMES);
                const hidden = winners.slice(CAL_CELL_NAMES);
                // 이름 앞 아이콘 = 그 날 가장 많이 당첨된 게임. 게임 필터를 고르면 전부 같은 아이콘이라 뺀다
                const icon = w => (only ? '' : UIIcons.tag(gameMeta(w.game).icon));
                // 내 이름이 +N 뒤로 접히면 +N을 내 색으로 — 그 날 당첨된 걸 칸에서도 알 수 있게
                const body = winners.length
                    ? shown.map(w => `<span class="rk-cal-winner${isMe(w.name) ? ' rk-cal-me' : ''}">${icon(w)}<span class="rk-cal-wname">${esc(w.name)}</span></span>`).join('')
                        + (hidden.length ? `<span class="rk-cal-more${hidden.some(w => isMe(w.name)) ? ' rk-cal-me' : ''}">+${hidden.length}</span>` : '')
                    : '<span class="rk-cal-nowin">-</span>';
                // 날짜 아래 남은 공간에 가운데 정렬 — 1명이면 가운데, 2명+ 는 꽉 차서 위로 붙는다
                inner = `<div class="rk-cal-names">${body}</div>`;
            }
            cells += `<div class="${cls.join(' ')}"${list ? ` data-cal-day="${dayKey}"` : ''}>`
                + `<span class="rk-cal-daynum">${d}</span>${inner}</div>`;
        }

        el.innerHTML = `
            <div class="rk-section rk-cal-month">
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
        // 맨 위 요약 — 그 날 많이 당첨된 사람 순 (동률은 먼저 당첨된 순서 그대로 — sort는 안정 정렬)
        const showGame = !calGameFilter();
        const winners = calDayWinners(list).sort((a, b) => b.count - a.count);
        const pills = winners.length
            ? `<div class="rk-cal-pills">${winners.map(w => `<span class="rk-cal-pill${isMe(w.name) ? ' rk-cal-pill-me' : ''}">`
                + `${showGame ? UIIcons.tag(gameMeta(w.game).icon) : ''}${esc(w.name)} <b>${w.count}회</b></span>`).join('')}</div>`
            : '';
        const rows = list.map((s, i) => {
            const label = iconLabelHtml(gameMeta(s.gameType));
            const won = !!(s.winners && s.winners.some(isMe));
            const names = (s.winners && s.winners.length)
                ? `<span class="rk-cal-win"><i class="ui ui-crown"></i> ${s.winners.map(n => `<span${isMe(n) ? ' class="rk-cal-me"' : ''}>${esc(n)}</span>`).join(', ')}</span>`
                : '<span class="rk-cal-win rk-cal-nowin">당첨자 없음</span>';
            return `<div class="rk-cal-drow${won ? ' rk-me' : ''}">
                <span class="rk-cal-seq">${i + 1}차</span>
                <span class="rk-cal-game">${label}</span>
                ${names}
            </div>`;
        }).join('');
        return `
            <div class="rk-section">
                <div class="rk-section-title">${mm}월 ${dd}일 (${wd}) · ${list.length}판</div>
                <div class="rk-card">${pills}${rows}</div>
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
                repaintInPlace();
            });
        });
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
