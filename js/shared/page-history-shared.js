// 페이지 히스토리 관리 공유 모듈
// 뒤로가기 버튼이 사용자 기대대로 동작하도록 통합 관리
const PageHistoryManager = (function () {
    let _config = null;

    function init(config) {
        _config = config;
        window.addEventListener('popstate', _onPopState);
    }

    function _onPopState(e) {
        if (!_config) return;
        const targetPage = (e.state && e.state.page) || 'serverSelect';
        const currentPage = _config.getCurrentPage();

        if (currentPage === targetPage) return;

        // 랭킹 오버레이가 열려있으면 먼저 닫기
        if (currentPage === 'ranking') {
            _config.onHideRanking();
            if (targetPage === 'gameRoom' || targetPage === 'lobby') return;
        }

        switch (targetPage) {
            case 'lobby':
                if (currentPage === 'gameRoom') {
                    _config.onLeaveRoom();
                } else if (currentPage === 'createRoom') {
                    _config.onLobby();
                }
                break;
            case 'serverSelect':
                if (currentPage === 'gameRoom') {
                    _config.onLeaveRoom();
                }
                _config.onServerSelect();
                break;
            case 'gameRoom':
                // 랭킹에서 돌아온 경우 (위에서 이미 처리됨)
                break;
        }
    }

    function pushPage(page) {
        if (history.state && history.state.page === page) return;
        history.pushState({ page: page }, '');
    }

    function replacePage(page) {
        history.replaceState({ page: page }, '');
    }

    return { init, pushPage, replacePage };
})();
