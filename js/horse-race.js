// localhost 체크
var isLocalhost = window.location.hostname === 'localhost' || 
                   window.location.hostname === '127.0.0.1' ||
                   window.location.hostname === '';

// 로컬에서는 방 제목 기본값을 "test"로 설정
if (isLocalhost) {
    const roomNameInput = document.getElementById('createRoomNameInput');
    if (roomNameInput) {
        roomNameInput.value = 'test';
    }
}

// 디버그 로그 설정
var debugLogEnabled = isLocalhost;

// 디버그 로그 함수 (먼저 정의)
var MAX_LOG_LINES = 100;
function addDebugLog(message, type = 'info') {
    if (!debugLogEnabled) return;
    
    const logSection = document.getElementById('debugLogSection');
    const logContent = document.getElementById('debugLogContent');
    
    if (!logSection || !logContent) return;
    
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    const colors = {
        'info': '#0f0',
        'warn': '#ff0',
        'error': '#f00',
        'race': '#0ff',
        'selection': '#ff0',
    };
    const color = colors[type] || '#0f0';
    
    const logLine = document.createElement('div');
    logLine.style.color = color;
    logLine.style.marginBottom = '2px';
    logLine.innerHTML = `[${timestamp}] ${message}`;
    logContent.appendChild(logLine);
    
    // 최대 로그 라인 수 제한
    while (logContent.children.length > MAX_LOG_LINES) {
        logContent.removeChild(logContent.firstChild);
    }
    
    // 자동 스크롤
    logContent.scrollTop = logContent.scrollHeight;
    
    // 로그 섹션 표시
    logSection.style.display = 'block';
}

// 탭 세션 ID (새로고침: 유지, 새 탭: 새로 생성)
if (!sessionStorage.getItem('tabId')) {
    sessionStorage.setItem('tabId', Math.random().toString(36).substr(2, 9) + Date.now());
}
function getTabId() { return sessionStorage.getItem('tabId'); }

// 내(me) 이름표 라벨 기본 스타일 cssText — 렌더 2곳(renderTrackForSelection/startRaceAnimation)의
// isMe 분기와 refreshMyNameTags 복원(applyMyDefaultTagStyle)이 모두 이 상수를 공유(같은 파일 내 dedup).
var ME_NAMETAG_CSS = 'background: linear-gradient(135deg, var(--yellow-500), var(--yellow-600));'
    + 'color: var(--text-primary);'
    + 'padding: 2px 6px;'
    + 'border-radius: 4px;'
    + 'font-size: 11px;'
    + 'line-height: 16px;'
    + 'font-weight: bold;'
    + 'white-space: nowrap;'
    + 'border: 2px solid var(--bg-white);'
    + 'box-shadow: 0 2px 4px rgba(0,0,0,0.5), 0 0 8px rgba(255,215,0,0.6);'
    + 'text-shadow: 0 1px 1px rgba(255,255,255,0.5);';

// 상태 변수
var currentRoomId = null;
var currentUser = '';
var isHost = false;
var isReady = false;
var readyUsers = [];
var horseRaceHistory = [];
var isRaceActive = false;
var roomExpiryInterval = null;
var roomExpiresAtMs = null; // 방이 사라지는 시각(epoch ms) — 예약 프리셋 노출 판단용
var pendingRoomId = null;
var isOrderActive = false;
var everPlayedUsers = [];
var availableHorses = [];
var autoSelectHorseEnabled = false;
var autoSelectAttempted = false; // 방마다 1회만 시도
var userHorseBets = {};
var selectedUsersFromServer = [];  // 선택 완료자 목록 (서버에서 전송)
var selectedHorseIndices = [];  // 선택된 말 인덱스 목록 (서버에서 전송)
var canSelectDuplicate = false;  // 중복 선택 가능 여부 (사람수 > 말수)
var mySelectedHorse = null;
var horseRaceMode = 'last'; // 무조건 꼴등 찾기
var currentTrackLength = 'medium'; // 트랙 길이 옵션
var currentTrackDistanceMeters = 500; // 트랙 거리(m)
var trackPresetsFromServer = { short: 500, medium: 700, long: 1000 }; // 서버에서 받은 프리셋
var selectedVehicleTypes = null; // 선택된 탈것 타입 (null이면 랜덤)
var popularVehicles = []; // 인기말 vehicle_id 목록
var NEW_VEHICLES = []; // 신규 탈것 (NEW 배지)
var vehicleStatsData = []; // 탈것별 통계 데이터
var isReplayActive = false; // 다시보기 진행 중 여부
var pendingHorseSelectionReady = null; // 경주/다시보기 재생 중 도착한 다음 라운드 선택 이벤트(가드로 드롭되는 것)를 보관 → 종료 시 적용
var raceResultShown = false; // 현재 라운드 결과 이미 표시 여부
var userRankVotes = {};        // { [userName]: 1-based rank } — N등 투표 (서버 broadcast 동기화)
var rouletteAnimFrameId = null; // 룰렛 애니메이션 rAF id
// 룰렛 tick을 예약한 창 — PiP attach 중엔 PiP 창에 예약해야 메인 탭 숨김 스로틀(1초)을 피한다.
// 타이머 id는 창별 카운터라 반드시 예약한 창에서 취소해야 한다 (rAF의 migrateRaceDriver와 같은 함정).
var rouletteAnimWin = null;
var _rouletteReschedule = null; // 진행 중 룰렛의 재예약 통로 (창 이관용, 종료/취소 시 null)

// 룰렛 tick 취소 — 예약한 창에서 취소한다. 창이 닫혔으면 메인으로 정규화(취소는 어차피 무의미).
function clearRouletteTick() {
    if (rouletteAnimFrameId != null) {
        var w = (rouletteAnimWin && !rouletteAnimWin.closed) ? rouletteAnimWin : window;
        try { w.clearTimeout(rouletteAnimFrameId); } catch (e) {}
        rouletteAnimFrameId = null;
    }
    _rouletteReschedule = null;
}

// ═══ 경주 트랙 PiP (Document Picture-in-Picture) — 데스크톱 Chromium 전용, 시각 전용 ═══
// 개정3(2026-08-12) 상시 attach — 단일 규칙: "열면 래퍼가 들어가고, 닫으면 나온다".
//  - 버튼은 래퍼가 보이는 동안 상시 노출 (pipSupported 게이트만). 2-상태 라벨.
//  - 클릭 → requestWindow resolve 즉시 attach — 모든 단계(선택/룰렛/투표/카운트다운/레이스/종료 후) 유효.
//    대기 화면 없음: 창이 열려 있는 동안 래퍼는 전 단계에서 PiP 문서에 산다 (메인 페이지에는 트랙 부재).
//  - 창을 닫는 경로만 래퍼를 메인으로 복귀: 사용자 닫기(X/토글) 또는 페이지 unload(브라우저 자동 닫힘).
//    레이스 종료/중단/리셋은 창·래퍼를 건드리지 않는다 (멈춘 트랙도 창에 그대로 보이는 것이 의도).
//  - 이식 UI(룰렛/투표/배너)는 기존 placeholder 프로토콜 그대로 래퍼를 따라 PiP를 왕복 —
//    placeholder는 항상 메인 문서에 남는다.
// 공정성 영향 0 — 물리는 Date.now() 기반 서버 결정 시뮬 그대로, 렌더 문서만 옮긴다.
var pipSupported = 'documentPictureInPicture' in window;
window._racePipWin = null;      // 열린 PiP 창 (대기 또는 attach 상태. 닫히면 null)
window._raceAnimWin = window;   // 현재 rAF 드라이버 창 — 예약한 창에서 취소해야 한다 (유령 루프 방지)
var _racePipPlaceholder = null; // 래퍼 원위치 comment placeholder (moveResultUiToCanvas 패턴)
var _racePipWrapperEl = null;   // attach 시 캡처한 래퍼 참조 — pip 문서 조회가 실패해도 복원 가능. null = 미이동(대기)
var _racePipOpening = false;    // requestWindow 진행 중 재클릭 가드
var _raceDriverHooks = null;    // 현재 레이스 init이 등록 — { gen, reschedule, rearmPause } (클로저 내부 제어 통로)

// 트랙이 실제로 PiP 창에 이동해 있는가 — 개정3에선 "창 열림 + 래퍼 이동됨"과 사실상 동치.
// (예외: requestWindow 진행 중/attach 실패 창은 열려 있어도 미이동) raceDoc 분기·pause/mute 우회의 단일 판정.
function racePipAttached() {
    return !!(_racePipWrapperEl && window._racePipWin && !window._racePipWin.closed);
}

// 작은 창 관전 중엔 메인 문서가 포커스를 잃어도(창을 클릭만 해도 hasFocus()가 false) 사용자는
// 레이스를 보고 있다 — SoundManager의 포커스 게이트를 우회시킨다. 아래 visibilitychange/blur의
// muteAll 우회와 짝이다(그쪽만 있고 이쪽이 없어 신규 사운드가 전부 막히던 상태였다).
// 미등록 게임(주사위/룰렛/사다리/해적)은 영향 없음. PiP 미사용 시 항상 false라 기존 정책 그대로.
if (window.SoundManager && SoundManager.setFocusBypass) SoundManager.setFocusBypass(racePipAttached);

// 래퍼(트랙)를 소유한 문서 — attach 상태면 PiP 문서, 아니면 메인 문서.
// 래퍼 내부/전속 요소의 런타임 조회는 이 헬퍼를 쓴다 (캡처 참조는 문서 입양 후에도 유효하므로 그대로 둠).
function raceDoc() {
    return racePipAttached() ? window._racePipWin.document : document;
}

// 이식(transplant) UI 조회 — 배너/투표/canvasResultCenter처럼 래퍼를 "따라다니는" 요소는
// 시점에 따라 PiP에 있을 수도(이식 중) 메인에 있을 수도(원위치) 있다. 래퍼 문서 우선, 메인 폴백.
// (미attach면 raceDoc()===document라 단일 조회와 동일)
function anyDocGetById(id) {
    return raceDoc().getElementById(id) || document.getElementById(id);
}

// 현재 rAF 드라이버 창 — 닫힌 PiP 창이 잔존해도 메인 창으로 수렴 (닫힌 창 예약 사고 방지)
function raceAnimWin() {
    var w = window._raceAnimWin;
    return (w && w !== window && !w.closed) ? w : window;
}

// rAF 드라이버 이관 — 예약했던 창에서 취소 후 새 창에서 재예약 (현재 레이스 훅 경유, _raceGen 세대 가드)
function migrateRaceDriver(newWin) {
    // ⚠️ 원시 참조 비교 — raceAnimWin()(닫힌 창→메인 정규화) 금지.
    // pagehide 시점에 pipWin.closed면 정규화가 oldWin을 window로 수렴시켜 oldWin===newWin 조기 return
    // → 재예약 누락(경주 영구 동결) + stale frameId가 이후 메인 창의 무관한 rAF를 오취소(id는 창별 카운터).
    var oldWin = window._raceAnimWin || window;
    window._raceAnimWin = newWin;
    if (oldWin === newWin) return; // 드라이버 창 무변경 — pending rAF 그대로 유효
    if (window._raceAnimFrameId != null) {
        try { oldWin.cancelAnimationFrame(window._raceAnimFrameId); } catch (e) {}
        window._raceAnimFrameId = null;
        if (_raceDriverHooks && _raceDriverHooks.gen === window._raceGen) {
            _raceDriverHooks.reschedule();
        }
    }
}

// 룰렛 tick 타이머 창 이관 — 예약 창에서 취소 후 새 창에서 재예약 (rAF 드라이버 이관과 같은 이유).
// 이관하지 않으면 창을 닫는 순간 예약이 사라져 룰렛이 당첨 막대에 도달하지 못한 채 얼어붙는다.
// 남은 지연은 알 수 없어 현재 스텝 지연으로 다시 잡는다 — 순수 시각 연출이라 결과 영향 0.
function migrateRouletteTimer(newWin) {
    var oldWin = rouletteAnimWin || window;
    rouletteAnimWin = newWin;
    if (oldWin === newWin) return;            // 창 무변경 — pending 그대로 유효
    if (rouletteAnimFrameId == null || !_rouletteReschedule) return; // 진행 중 룰렛 없음 — 창 교체만
    try { oldWin.clearTimeout(rouletteAnimFrameId); } catch (e) {}
    rouletteAnimFrameId = null;
    _rouletteReschedule();
}

function updatePipButtonLabel() {
    // 버튼은 래퍼와 함께 이동 — attach면 raceDoc()=PiP 문서, 아니면 메인 문서 (같은 헬퍼로 수렴). 2-상태.
    var btn = raceDoc().getElementById('racePipBtn');
    if (!btn) return;
    btn.textContent = racePipAttached() ? '↩ 원래 화면으로' : '📺 작은 창으로';
}

// PiP 창 열기 — 클릭 시 즉시 requestWindow(제스처 소비는 미룰 수 없음) → resolve 즉시 attach.
// 개정3: 대기 모드/레이스 상태 게이트 없음 — 어느 단계든 열면 래퍼가 들어간다 (단일 규칙).
// 스타일만 복제하고 <script>/AdSense는 절대 복사하지 않는다.
function racePipOpen() {
    if (!pipSupported || _racePipOpening) return;
    if (window._racePipWin && !window._racePipWin.closed) return; // 이미 열림
    // 상호배타 — 전체화면 중이면 먼저 끄고 연다 (래퍼가 두 모드에 동시에 걸리지 않게)
    if (typeof raceFsExit === 'function') raceFsExit();
    var wrapper = document.getElementById('raceTrackWrapper'); // open 시점은 항상 미attach — 메인 조회
    var trackContainer = document.getElementById('raceTrackContainer');
    if (!wrapper || !trackContainer) return;

    // 폭 = 캡처된 trackWidth 기준. 모바일 미디어쿼리(768px) 경계 위로 클램프해 데스크톱 레이아웃 유지
    // (카메라 산식은 init 시점 캡처값을 쓰므로 소폭 확대는 무해 — goal 수용 한계)
    var pipW = Math.max(trackContainer.offsetWidth || 700, 780);
    // 높이 = 래퍼 + 상단 버튼 여백 (버튼 행 top:-32px 감안 ~48px)
    var pipH = (wrapper.offsetHeight || 440) + 48;
    // 스케일 루트에 고정할 자연폭 = "래퍼가 인페이지에서 갖던 폭" (전체화면의 raceFsPageNaturalWidth와 같은 관례).
    // 창 폭(innerWidth)을 쓰면 트랙 컨테이너가 width:100%라 attach/detach 때 trackWidth가 바뀌고,
    // init 1회 캡처인 카메라 좌표계(화면 밖 거리표시·중앙정렬)가 그 라운드 내내 어긋난다.
    var pipNatW = wrapper.offsetWidth || trackContainer.offsetWidth || 700;

    _racePipOpening = true;
    documentPictureInPicture.requestWindow({ width: pipW, height: pipH }).then(function (pipWin) {
        _racePipOpening = false;
        window._racePipWin = pipWin;

        // 라이브 head의 stylesheet/style 전부 복제 — theme/horse-race/horse-shop cascade,
        // Google Fonts(Jua/Yeon Sung), Tailwind 런타임 주입 style 포함.
        document.head.querySelectorAll('link[rel="stylesheet"], style').forEach(function (node) {
            pipWin.document.head.appendChild(node.cloneNode(true));
        });
        var themeAttr = document.documentElement.getAttribute('data-theme');
        if (themeAttr) pipWin.document.documentElement.setAttribute('data-theme', themeAttr);
        // PiP 전용 보정 — 상단 버튼(-32px) 노출 여백 + 스크롤 방지 + 스케일 루트 수평 중앙 정렬.
        // flex 중앙: 창을 가로로만 늘려도(k가 세로 비율/캡에 걸린 상태) 고정폭 루트가 가운데 유지되고
        // 좌우 대칭 여백만 생긴다 (좌측 치우침 버그 수정).
        var pipFix = pipWin.document.createElement('style');
        // 미디어쿼리는 "PiP 창 자신의 폭"으로 평가된다 — 창을 768px 아래로 줄이면 모바일 규칙이 걸려
        // 트랙 높이가 400→300으로 줄고(레인 좌표는 init 때 400 기준 px로 굳어 아래 레인이 잘린다),
        // 미니맵이 하단 풀바로 바뀌고 버튼이 커진다. 스케일 루트는 고정폭 캔버스이므로 그 안에서는
        // 데스크톱 레이아웃을 유지하고, 창이 좁아지는 만큼은 fit 스케일(k)이 흡수하게 한다.
        // 이 스타일은 PiP 문서에만 주입되고 #pipScaleRoot 하위로 스코프된다 — 메인·타 게임 영향 0.
        pipFix.textContent = 'body{margin:0;padding:40px 8px 8px;overflow:hidden;display:flex;justify-content:center;align-items:flex-start;}'
            + '#pipScaleRoot .race-track-container{height:400px;margin:20px 0;border-radius:12px;}'
            + '#pipScaleRoot #raceMinimap{position:absolute!important;bottom:8px!important;right:8px!important;top:auto!important;left:auto!important;width:180px!important;border-radius:8px!important;padding:8px 10px!important;background:rgba(0,0,0,0.75)!important;}'
            + '#pipScaleRoot #cameraSwitchBtn{min-width:0;min-height:0;font-size:11px!important;padding:4px 10px!important;}'
            + '#pipScaleRoot .race-pip-btn,#pipScaleRoot .race-fullscreen-btn{min-height:0;font-size:11px;padding:4px 10px;}';
        pipWin.document.head.appendChild(pipFix);

        // 스케일 루트 — fit transform은 이 컨테이너에 건다. 래퍼는 이 안에 들어가므로
        // insertBefore(x, wrapper)로 오는 형제(canvasResultCenter 등)도 함께 스케일된다.
        // 폭은 open 시점 자연폭으로 고정(flex-shrink 차단) — 유동 100% 폭이면 창 확대 시 트랙이
        // 재배치로 넓어져 init 캡처 trackWidth 기준 카메라 좌표계가 왼쪽으로 쏠린다(원인 확정).
        // transform-origin(top center)은 레이아웃 박스 중앙 기준 대칭 스케일이라 flex 중앙과 조합 시 정확히 가운데.
        var scaleRoot = pipWin.document.createElement('div');
        scaleRoot.id = 'pipScaleRoot';
        scaleRoot.style.cssText = 'width:' + pipNatW + 'px;flex:0 0 auto;';
        pipWin.document.body.appendChild(scaleRoot);

        // 닫힘 처리 — attach면 트랙 복귀(reattach). attach가 실패한 창이면 참조 정리만.
        pipWin.addEventListener('pagehide', function () {
            racePipReattach();
            if (window._racePipWin === pipWin) { // reattach가 no-op이었던 예외 상태(attach 실패 창) 정리
                window._racePipWin = null;
                updatePipButtonLabel();
            }
        });
        // 창 크기 변경 시 fit-to-window 재계산 — 창 수명당 1회 바인딩
        pipWin.addEventListener('resize', racePipApplyScale);

        // requestWindow await 사이에 전체화면이 다시 켜졌을 수 있다 — attach가 래퍼만 빼가면
        // 빈 스테이지(+CSS 폴백이면 오버레이·스크롤 잠금)가 남는다. 멱등이라 비활성 시 no-op.
        if (typeof raceFsExit === 'function') raceFsExit();

        // 개정3: 무조건 즉시 attach — 모든 단계 유효 (열면 들어간다).
        racePipAttachTrack();
        if (racePipAttached()) racePipResumeIfPaused(); // 레이스 중 open + 클릭~resolve 사이 탭 숨김 코너 해제
        updatePipButtonLabel();
    }).catch(function (err) {
        _racePipOpening = false;
        console.warn('[경마 PiP] 창 열기 실패:', err && err.message);
    });
}

// 열린 PiP 창으로 트랙 이동 — 스케일 루트(#pipScaleRoot) 안에 래퍼를 넣는다. 멱등.
// 호출처: ① racePipOpen resolve(즉시 attach — 유일한 정규 경로) ② 레이스 init(attach 실패 창 재시도 방어)
function racePipAttachTrack() {
    var pipWin = window._racePipWin;
    if (!pipWin || pipWin.closed) return;
    if (_racePipWrapperEl || _racePipPlaceholder) return; // 이미 attach됨
    var wrapper = document.getElementById('raceTrackWrapper');
    if (!wrapper) return;
    // 스케일 루트 확보 + pip 문서 접근성 확인 — 접근 불가면 attach 포기 (트랙은 메인에 남아 정상 진행)
    var host;
    try {
        host = pipWin.document.getElementById('pipScaleRoot');
        if (!host) { // 방어 — open이 만들지만 유실 시 재생성 (open과 동일 스타일: 고정폭 + flex-shrink 차단)
            host = pipWin.document.createElement('div');
            host.id = 'pipScaleRoot';
            host.style.cssText = 'width:' + (wrapper.offsetWidth || 700) + 'px;flex:0 0 auto;'; // 이동 전 인페이지 자연폭
            pipWin.document.body.appendChild(host);
        }
    } catch (e) {
        return;
    }

    // 원위치 comment placeholder(#targetRankReason 뒤·#replaySection 앞 계약 유지) 남기고 래퍼 이동
    if (!_racePipPlaceholder || !_racePipPlaceholder.parentNode) {
        _racePipPlaceholder = document.createComment('raceTrackWrapper-pip-placeholder');
        wrapper.parentNode.insertBefore(_racePipPlaceholder, wrapper);
    }
    _racePipWrapperEl = wrapper;
    host.appendChild(wrapper);

    // rAF 드라이버 이관: 메인 pending 취소 → PiP 창에서 재예약 (메인 탭 숨김에도 경주 지속).
    // 레이스 없는 단계에서는 pending이 없어 창 교체만 일어난다.
    migrateRaceDriver(pipWin);
    migrateRouletteTimer(pipWin); // 룰렛 tick도 같이 — 이식된 막대가 PiP 안에서 돌기 때문

    // 이식이 먼저 일어난 뒤 open한 경우 재앵커 — canvasResultCenter(타깃 배너 컨테이너)는 래퍼의
    // "형제"라 래퍼 이동만으로는 메인에 잔류한다(barsOverlay는 래퍼 내부라 자동 동행).
    // moveResultUiToCanvas는 멱등: placeholder는 !_canvasPlaceholder 가드로 이중 생성 없고,
    // center만 스케일 루트 안(래퍼 앞)으로 옮겨 배너를 재부착한다.
    // 'fading-out' 가드: offCanvas 600ms 페이드 중 open이 복원을 부활시키는 역엣지 차단
    // (center 요소는 활성 이식/페이드 중에만 존재 — 정상 선-open 경로에서는 null이라 no-op).
    var activeCenter = document.getElementById('canvasResultCenter');
    if (activeCenter && !activeCenter.classList.contains('fading-out')) {
        moveResultUiToCanvas();
    }

    // resume(일시정지 해제)은 호출처가 racePipResumeIfPaused()로 따로 수행 (attach는 훅 없이 성립).

    // 루트 자연 높이가 변할 때마다 재fit — 룰렛 배너(canvasResultCenter)가 래퍼 앞 형제로 끼어들면
    // 루트가 ~60px 높아지는데, 재fit이 없으면 body{overflow:hidden}에 하단(미니맵·맨 아래 레인)이
    // 조용히 잘린 채 라운드 내내 유지된다(창을 1px 드래그하면 resize 리스너가 고쳐주던 증상).
    // transform은 관측 대상의 border-box를 바꾸지 않으므로 자기유발 루프가 없고, 창이 닫히면 함께 소멸한다.
    try {
        if (pipWin.ResizeObserver) new pipWin.ResizeObserver(function () { racePipApplyScale(); }).observe(host);
    } catch (e) {}

    racePipApplyScale(); // fit-to-window (시각 전용 transform — 재앵커 후라 center 높이도 자연 크기에 포함)
    updatePipButtonLabel();
    if (typeof updateFullscreenButtonAvailability === 'function') updateFullscreenButtonAvailability(); // 상호배타: 전체화면 버튼 숨김
}

// attach 후 일시정지 해제 — 현재 레이스 훅 경유(gen 가드). attach 성공(racePipAttached()) 시에만 호출할 것 —
// 미attach 상태에서 부르면 숨김 메인 탭의 정상 pause/catch-up을 오해제한다.
// 숨김 탭 init·"클릭~resolve 사이 숨김" 코너의 시작선 동결 방지 (가시 탭이면 pausedAt=0 no-op).
function racePipResumeIfPaused() {
    if (_raceDriverHooks && _raceDriverHooks.gen === window._raceGen && _raceDriverHooks.resumeIfPaused) {
        _raceDriverHooks.resumeIfPaused();
    }
}

// fit-to-window 스케일 — 스케일 루트(#pipScaleRoot)에 transform을 걸어 래퍼와 이식 형제
// (canvasResultCenter 등)를 통째로 PiP 뷰포트에 맞춘다 (개정3).
// transform은 offsetWidth/Height 레이아웃 값에 영향 없음 → 카메라/물리 산식 무영향(시각 전용).
var RACE_PIP_SCALE_MAX = 1.25; // 과확대 캡 (1.0~1.5 권장 범위 내 — 배경 비트맵 블러 방지)
// 마지막으로 적용된 fit 배율. 스케일 루트 "밖"에 있는 요소(PiP body 직속 fixed 오버레이 = 유령 연출)는
// 이 transform을 못 받으므로, 그쪽에서 직접 곱해 트랙과 크기 비율을 맞춘다.
var _racePipScaleK = 1;
function racePipApplyScale() {
    if (!racePipAttached()) return;
    var pipWin = window._racePipWin;
    try {
        var root = pipWin.document.getElementById('pipScaleRoot');
        if (!root) return;
        var natW = root.offsetWidth || 1;   // 자연(레이아웃) 크기 — 자기 transform 무영향 값
        var natH = root.offsetHeight || 1;
        var availW = Math.max(1, pipWin.innerWidth - 16);  // pip body padding(40px 8px 8px) 제외 가용 영역
        var availH = Math.max(1, pipWin.innerHeight - 48);
        var k = Math.min(availW / natW, availH / natH, RACE_PIP_SCALE_MAX);
        _racePipScaleK = isFinite(k) ? k : 1;
        root.style.transformOrigin = 'top center';
        root.style.transform = (isFinite(k) && Math.abs(k - 1) > 0.01) ? 'scale(' + k + ')' : '';
    } catch (e) {}
}

// 트랙 복귀 + 창 닫기 — 래퍼를 메인으로 되돌리는 유일한 경로 (사용자 X/pagehide, attach 상태 토글).
// 개정3: 레이스 종료/중단은 창·래퍼를 건드리지 않으므로(teardown 폐기) 이 함수가 전부다.
// 몇 번을 불려도 안전한 멱등 함수 (사용자 X와 pagehide 경로가 겹칠 수 있다).
function racePipReattach() {
    if (!_racePipWrapperEl && !_racePipPlaceholder) return; // 미이동 — 복귀 대상 없음
    var pipWin = window._racePipWin;
    var wrapper = _racePipWrapperEl;
    var placeholder = _racePipPlaceholder;
    window._racePipWin = null;      // 이후 raceDoc()/pause/mute는 즉시 메인 문서 기준
    _racePipWrapperEl = null;
    _racePipPlaceholder = null;

    // 래퍼 복원 — attach 때 캡처한 참조 우선 (pip 문서가 이미 닫혀도 노드 참조는 유효)
    if (!wrapper && pipWin) {
        try { wrapper = pipWin.document.getElementById('raceTrackWrapper'); } catch (e) {}
    }
    if (wrapper && placeholder && placeholder.parentNode) {
        var pipHost = (wrapper.ownerDocument !== document) ? wrapper.parentNode : null;
        if (pipHost) {
            // 스케일 루트의 자식 전부를 순서대로 원위치 앞에 복귀 — 래퍼뿐 아니라 이식된 형제
            // (canvasResultCenter 등)도 함께 돌아와야 배너류가 창과 함께 유실되지 않는다.
            while (pipHost.firstChild) {
                placeholder.parentNode.insertBefore(pipHost.firstChild, placeholder);
            }
        } else {
            placeholder.parentNode.insertBefore(wrapper, placeholder);
        }
    }
    if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
    }

    // PiP 전용 카운트다운 오버레이 잔존 제거 — 틱 체인이 닫힌 창에 묶여 있어 스스로 사라지지 못한다.
    // 그대로 두면 불투명 75% 검은 막이 메인 트랙 위에 영구히 남는다 (래퍼와 함께 돌아오므로).
    if (wrapper) {
        var stuckCountdown = wrapper.querySelector('#countdownOverlay');
        if (stuckCountdown) stuckCountdown.remove();
        // 작은 창 전용 결과 요약도 함께 정리 — 메인에는 이미 #resultOverlay가 떠 있어 중복이다.
        var stuckResult = wrapper.querySelector('#pipResultBanner');
        if (stuckResult) stuckResult.remove();
    }

    // 드라이버 메인 복귀 — 레이스 진행 중이면 메인에서 재예약.
    // 닫힌 PiP 창의 pending rAF는 발화하지 않으므로 이중 예약 없음 (+ _raceGen 세대 가드).
    migrateRaceDriver(window);
    migrateRouletteTimer(window); // 룰렛 진행 중 닫기 — 메인에서 재예약해야 막대가 얼지 않는다

    // pause 게이트 재무장 — 복귀 순간 메인 탭이 숨김이면 기존 catch-up 경로에 태움
    if (_raceDriverHooks && _raceDriverHooks.gen === window._raceGen) {
        _raceDriverHooks.rearmPause();
    }

    // 사운드 정책 원복 — attach 동안 우회했던 숨김/블러 음소거를 즉시 재적용.
    // (복귀로 메인 창이 포커스를 되찾는 경우엔 기존 focus 핸들러가 곧바로 unmute — 부작용 없음)
    if ((document.hidden || !document.hasFocus()) && window.SoundManager) SoundManager.muteAll();

    if (pipWin) {
        try { if (!pipWin.closed) pipWin.close(); } catch (e) {}
    }
    updatePipButtonLabel();
    if (typeof updateFullscreenButtonAvailability === 'function') updateFullscreenButtonAvailability(); // 트랙 복귀 — 전체화면 버튼 재노출
}

function toggleRacePip() {
    var pipWin = window._racePipWin;
    if (pipWin && !pipWin.closed) {
        if (racePipAttached()) {
            racePipReattach(); // 트랙 복귀 + 창 닫기
        } else {
            // attach 실패로 빈 창만 남은 예외 상태 — 닫고 참조 정리
            try { pipWin.close(); } catch (e) {}
            window._racePipWin = null;
            updatePipButtonLabel();
        }
    } else {
        racePipOpen();
    }
}

// 버튼 바인딩 — 인라인 onclick 금지: 문서 입양 후 인라인 핸들러는 PiP 전역을 참조해 죽는다.
// addEventListener 클로저는 원 실행 컨텍스트(메인 창)를 유지한다. (터치는 click으로 수렴 — 별도 처리 불필요)
// 개정(2026-08-12): 지원 브라우저에서 상시 노출 — 실제 표시 여부는 래퍼(display) 가시성이 게이트한다.
if (pipSupported) {
    (function () {
        var btn = document.getElementById('racePipBtn');
        if (btn) {
            btn.addEventListener('click', toggleRacePip);
            btn.style.display = 'block';
            updatePipButtonLabel();
        }
    })();
}

// ═══ 경주 트랙 전체화면(최대화) — 전 기기 지원, 시각 전용 ═══
// 2단 구현: ① Fullscreen API(데스크톱 전 브라우저·안드로이드 크롬·iPadOS) ② CSS 의사 전체화면 폴백(아이폰 사파리).
// 두 경로 모두 같은 fit 스케일 + 수평 중앙 정렬을 적용해 시각 결과가 같다.
// PiP와 상호배타 — 래퍼가 PiP 문서에 있으면 버튼 숨김, 전체화면 중 PiP 열기는 전체화면을 먼저 끈다.
// 공정성 영향 0 — transform은 레이아웃 값(offsetWidth)에 영향이 없어 카메라·물리 산식 불변.
var _raceFsActive = false;      // 전체화면 모드 진행 중 (API/CSS 폴백 공통)
var _raceFsCssFallback = false; // CSS 의사 전체화면으로 진입했는가
var _raceFsPrevBodyOverflow = null; // CSS 폴백 진입 전 body overflow 원복용
var _raceFsHintTimer = null;    // 가로 회전 힌트 제거 타이머
// 전체화면 스케일 상한 — PiP(1.25)보다 크게 허용하되 배경이 비트맵(PNG)이라 과확대 블러를 고려해 2.0에서 컷.
// (트랙 자연폭 ~700~800px 기준 1600px 안팎 — 일반적인 FHD 화면을 가로로 채우는 수준)
var RACE_FS_SCALE_MAX = 2.0;
// 트랙 상단 버튼 행이 래퍼 위로 돌출하는 높이(px). css/horse-race.css의
// `.track-top-btn-row { top: -32px }`와 짝이다 — CSS 값을 바꾸면 이 상수도 함께 바꿔야 한다.
// 스케일 시 이 돌출분도 k배로 커지므로(origin: top center) 높이 예산과 스테이지 상단 패딩에 반영한다.
var RACE_TRACK_BTN_ROW_OVERHANG_PX = 32;

function raceFsSupported() {
    var el = document.getElementById('raceTrackWrapper');
    return !!(el && el.requestFullscreen && document.exitFullscreen);
}

// 브라우저가 실제 전체화면 상태인가 (Escape/브라우저 자체 종료 감지용)
function raceFsApiActive() {
    return !!(document.fullscreenElement);
}

function updateFullscreenButtonLabel() {
    // 버튼은 래퍼 안이라 PiP attach 시 PiP 문서로 함께 이동한다 — 메인만 조회하면 null(데드 클릭)
    var btn = anyDocGetById('raceFullscreenBtn');
    if (!btn) return;
    btn.textContent = _raceFsActive ? '⛶ 전체화면 종료' : '⛶ 전체화면';
}

// PiP 상호배타 — 래퍼가 PiP 문서에 있으면 이 페이지엔 트랙이 없으므로 버튼을 숨긴다.
// (PiP attach/detach·전체화면 진입/종료 시 호출)
function updateFullscreenButtonAvailability() {
    var btn = anyDocGetById('raceFullscreenBtn'); // PiP 문서로 이동한 버튼도 잡아 실제로 숨긴다
    if (!btn) return;
    var blocked = racePipAttached();
    btn.style.display = blocked ? 'none' : 'block';
    btn.disabled = blocked;
    updateFullscreenButtonLabel();
}

// fit-to-viewport 스케일 — PiP와 같은 접근(고정 자연폭 + min 비율 + 중앙)이지만 상한·가용영역 산식이
// 달라(PiP는 창 padding 16/48 기준, 전체화면은 뷰포트 전체) 별도 함수로 둔다. PiP 함수는 무접촉.
// ⚠️ transform은 스테이지가 아니라 내부 스케일 루트에 건다 — 전체화면 요소(스테이지)는 top layer로
// 승격돼 조상 transform이 무시되고 UA가 width/height를 100% !important로 덮는다.
// 스케일 루트에 고정할 자연폭 = "래퍼가 지금 인페이지에 있었다면 가졌을 폭".
// raceFsMount가 래퍼 자리에 스테이지를 끼우므로 stage.parentNode가 곧 원래 페이지 부모다 →
// 그 콘텐츠 폭이 인페이지 레이아웃 폭과 같다(래퍼는 블록 요소로 부모를 채운다).
// API 전체화면(top layer)·CSS 폴백(position:fixed) 모두 이 부모는 정상 레이아웃을 유지해 측정이 유효하다.
// 실패 시 0을 반환해 호출부가 기존 고정폭을 그대로 두게 한다(회귀 안전).
function raceFsPageNaturalWidth() {
    var stage = document.getElementById('raceFsStage');
    var host = stage && stage.parentNode;
    if (!host || host.nodeType !== 1) return 0;
    var w = host.clientWidth || 0;
    if (!w) return 0;
    try {
        var cs = window.getComputedStyle(host);
        w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    } catch (e) {}
    return w > 0 ? Math.round(w) : 0;
}

function raceFsApplyScale() {
    if (!_raceFsActive) return;
    var root = document.getElementById('raceFsScaleRoot');
    if (!root) return;
    // 자연폭 재동결 — 진입 시점 폭을 영구 동결하면 세로로 진입 후 가로로 돌렸을 때 좁은 세로 폭(약 370px)이
    // 그대로 남아 전체화면이 인페이지보다 작아진다(높이 항이 k를 누르므로 폭 손실이 그대로 렌더 폭 손실).
    // 매 fit마다 현재 방향의 페이지 자연폭으로 다시 고정한다 — "유동 100% 폭 금지"(카메라 좌표계 보호)는
    // 그대로 지키면서(항상 px 고정) 값만 현재 뷰포트 기준으로 갱신하는 것이라, 결과가 그 방향에서
    // 처음부터 진입한 경우와 동일해진다.
    var pageW = raceFsPageNaturalWidth();
    if (pageW > 0 && Math.abs(pageW - (parseFloat(root.style.width) || 0)) >= 1) {
        root.style.width = pageW + 'px';
    }
    // 자연(레이아웃) 크기 — 자기 transform 무영향 값
    var natW = root.offsetWidth || 1;
    var natH = root.offsetHeight || 1;
    var overhang = RACE_TRACK_BTN_ROW_OVERHANG_PX;
    var availW = Math.max(1, window.innerWidth - 16);
    var availH = Math.max(1, window.innerHeight - 16); // 하단 여백만 (상단 돌출분은 아래 분모에 반영)
    // 높이 예산에 버튼 행 돌출분을 포함 — 스케일되면 돌출도 k배라 natH만 보면 k>1.25에서 행이 잘린다
    var k = Math.min(availW / natW, availH / (natH + overhang), RACE_FS_SCALE_MAX);
    root.style.transformOrigin = 'top center';
    root.style.transform = (isFinite(k) && Math.abs(k - 1) > 0.01) ? 'scale(' + k + ')' : '';
    // 스테이지 상단 패딩을 k에 연동 — 확대된 돌출분(32k)을 정확히 수용해 행 상단이 화면 밖으로 안 나간다.
    // 총 시각 높이 = 32k + k·natH = k·(natH+32) ≤ availH 로 상·하단 동시 수납.
    // (CSS의 padding-top:40px는 마운트 직후 첫 fit 전까지의 초기값. 스테이지는 exit/unmount에서 DOM
    //  제거되므로 인라인 잔존은 없다 — 다만 스테이지를 재사용하는 경로를 추가한다면 여기서 클리어할 것)
    var stage = document.getElementById('raceFsStage');
    if (stage) stage.style.paddingTop = Math.ceil(overhang * k) + 'px';
}

// 세로 화면에서 진입 시 가로 고정 시도 — 실패/미지원(iOS)은 조용히 무시하고 안내만 1회.
function raceFsTryLandscape() {
    if (window.innerWidth >= window.innerHeight) return; // 이미 가로
    var locked = false;
    try {
        if (screen.orientation && typeof screen.orientation.lock === 'function') {
            var p = screen.orientation.lock('landscape');
            locked = true;
            if (p && typeof p.catch === 'function') {
                p.catch(function () { raceFsShowRotateHint(); }); // reject(iOS/데스크톱) — 안내로 폴백
            }
        }
    } catch (e) {
        locked = false;
    }
    if (!locked) raceFsShowRotateHint();
}

function raceFsShowRotateHint() {
    // 스테이지에 붙인다 — 전체화면에서는 전체화면 요소(스테이지) 하위만 렌더되고, 스케일 루트에 붙이면
    // fit transform까지 같이 먹어 크기가 흔들린다.
    var host = document.getElementById('raceFsStage') || document.getElementById('raceTrackWrapper');
    if (!host) return;
    if (document.getElementById('raceFsRotateHint')) return;
    var hint = document.createElement('div');
    hint.id = 'raceFsRotateHint';
    hint.className = 'race-fs-rotate-hint';
    hint.textContent = '가로로 돌리면 더 크게 볼 수 있어요';
    host.appendChild(hint);
    if (_raceFsHintTimer) clearTimeout(_raceFsHintTimer);
    _raceFsHintTimer = setTimeout(raceFsRemoveRotateHint, 3000);
}

function raceFsRemoveRotateHint() {
    if (_raceFsHintTimer) {
        clearTimeout(_raceFsHintTimer);
        _raceFsHintTimer = null;
    }
    var hint = document.getElementById('raceFsRotateHint');
    if (hint) hint.remove();
}

// 스테이지 + 스케일 루트 마운트 (PiP와 동일한 2단 구조: 뷰포트 스테이지 > 고정폭 스케일 루트 > 래퍼).
// 래퍼 자리에 스테이지를 끼우고 그 안으로 옮기는 부모-삽입 방식이라 DOM 순서
// (#targetRankReason 뒤·#replaySection 앞)가 그대로 보존된다 — placeholder 불필요.
// 이식 UI(canvasResultCenter)가 래퍼 앞 형제면 루트 안에 함께 담아 같은 스케일을 받게 한다.
function raceFsMount(wrapper) {
    var stage = document.getElementById('raceFsStage');
    if (!stage) {
        stage = document.createElement('div');
        stage.id = 'raceFsStage';
        stage.className = 'race-fs-stage';
    }
    var root = document.getElementById('raceFsScaleRoot');
    if (!root) {
        root = document.createElement('div');
        root.id = 'raceFsScaleRoot';
        root.className = 'race-fs-scale-root';
    }
    if (wrapper.parentNode !== root) {
        var natW = wrapper.offsetWidth || 800; // 이동 전 자연폭 측정
        wrapper.parentNode.insertBefore(stage, wrapper); // 래퍼 자리에 스테이지 삽입
        // 이식 UI(canvasResultCenter) 동반은 여기서 하지 않는다 — 위 insertBefore로 center의
        // nextSibling이 이미 stage가 되어 형제 판별이 불가능하다. 마운트 후 호출처가
        // moveResultUiToCanvas()로 재앵커한다 (PiP attach와 동일 관례).
        root.appendChild(wrapper);
        stage.appendChild(root);
        // 자연폭 고정 — 유동 100% 폭이면 화면이 넓어질 때 트랙이 재배치로 넓어져
        // init 캡처 trackWidth 기준 카메라 좌표계가 좌측으로 쏠린다 (PiP 가로확대 버그와 동일 원인)
        root.style.width = natW + 'px';
    }
    return { stage: stage, root: root };
}

// 해체 — 스케일 루트의 자식(래퍼 + 이식 UI)을 스테이지 자리로 되돌리고 두 컨테이너 제거. 멱등.
function raceFsUnmount() {
    var stage = document.getElementById('raceFsStage');
    var root = document.getElementById('raceFsScaleRoot');
    if (root) {
        root.style.transform = '';
        root.style.transformOrigin = '';
        root.style.width = '';
    }
    if (!stage || !stage.parentNode) return;
    if (root) {
        while (root.firstChild) {
            stage.parentNode.insertBefore(root.firstChild, stage); // 순서 보존 복귀
        }
        if (root.parentNode) root.parentNode.removeChild(root);
    }
    stage.parentNode.removeChild(stage);
}

function raceFsEnter() {
    if (_raceFsActive) return;
    if (racePipAttached()) return; // 상호배타 — 트랙이 PiP 문서에 있으면 이 페이지에서 전체화면 불가
    var wrapper = document.getElementById('raceTrackWrapper');
    if (!wrapper) return;

    _raceFsActive = true;
    var mounted = raceFsMount(wrapper);
    var stage = mounted.stage;

    // 활성 이식(룰렛/투표/배너)이 있으면 재앵커 — 스케일 루트 안(래퍼 앞)으로 끌어와 함께 스케일되게.
    // 안 하면 배너가 스테이지 밖에 남아 API 경로에서 top layer에 가려진다.
    // 'fading-out' 가드는 offCanvas 페이드 중 진입이 복원을 부활시키는 역엣지 차단 (PiP attach와 동일 관례).
    var activeCenterFs = document.getElementById('canvasResultCenter');
    if (activeCenterFs && !activeCenterFs.classList.contains('fading-out')) {
        moveResultUiToCanvas();
    }

    // 전체화면 요소는 스테이지 — 래퍼를 직접 전체화면으로 만들면 UA가 width/height를 100% !important로
    // 덮어 트랙 컨테이너가 화면폭으로 재배치되고(카메라 좌표계 좌측 쏠림), top layer 승격으로
    // 조상 transform(fit 스케일)도 무시된다.
    if (raceFsSupported()) {
        _raceFsCssFallback = false;
        stage.classList.add('race-fs-api');
        var req;
        try {
            req = stage.requestFullscreen({ navigationUI: 'hide' });
        } catch (e) {
            req = null;
        }
        if (req && typeof req.catch === 'function') {
            req.catch(function () {
                // 권한 거부/제스처 소실 등 — CSS 폴백으로 즉시 전환 (사용자 입장에선 동일 결과)
                if (!_raceFsActive) return;
                stage.classList.remove('race-fs-api');
                raceFsApplyCssFallback(stage);
                raceFsApplyScale();
            });
        } else if (!req) {
            stage.classList.remove('race-fs-api');
            raceFsApplyCssFallback(stage);
        }
    } else {
        raceFsApplyCssFallback(stage);
    }

    raceFsApplyScale();
    raceFsTryLandscape();
    updateFullscreenButtonLabel();
}

// CSS 의사 전체화면 — 고정 오버레이로 뷰포트를 채우고 페이지 스크롤 잠금 (아이폰 사파리 등)
function raceFsApplyCssFallback(stage) {
    _raceFsCssFallback = true;
    stage.classList.add('race-fs-css');
    if (_raceFsPrevBodyOverflow === null) {
        _raceFsPrevBodyOverflow = document.body.style.overflow || '';
    }
    document.body.style.overflow = 'hidden';
}

// 종료 — 버튼 토글 / Escape·브라우저 자체 종료 / 페이지 이탈이 모두 수렴하는 멱등 정리 루틴
function raceFsExit() {
    if (!_raceFsActive) return;
    _raceFsActive = false;

    // 실제 전체화면 상태면 해제 (Escape 경유 호출이면 이미 해제돼 있어 스킵)
    try {
        if (document.fullscreenElement && document.exitFullscreen) {
            var p = document.exitFullscreen();
            if (p && typeof p.catch === 'function') p.catch(function () {});
        }
    } catch (e) {}

    try {
        if (screen.orientation && typeof screen.orientation.unlock === 'function') {
            screen.orientation.unlock();
        }
    } catch (e) {}

    raceFsRemoveRotateHint();

    var stage = document.getElementById('raceFsStage');
    if (stage) stage.classList.remove('race-fs-api', 'race-fs-css');
    if (_raceFsCssFallback) {
        document.body.style.overflow = (_raceFsPrevBodyOverflow === null) ? '' : _raceFsPrevBodyOverflow;
    }
    _raceFsPrevBodyOverflow = null;
    _raceFsCssFallback = false;

    raceFsUnmount();
    updateFullscreenButtonLabel();
}

function toggleRaceFullscreen() {
    if (_raceFsActive) {
        raceFsExit();
    } else {
        raceFsEnter();
    }
}

// 버튼 바인딩 + 라이프사이클 리스너 (기능 감지로 숨기지 않는다 — 미지원은 CSS 폴백)
(function () {
    var btn = document.getElementById('raceFullscreenBtn');
    if (btn) btn.addEventListener('click', toggleRaceFullscreen);

    // Escape·브라우저 자체 종료 → 상태 동기화 (API 경로에서만 발화)
    document.addEventListener('fullscreenchange', function () {
        if (_raceFsActive && !_raceFsCssFallback && !raceFsApiActive()) {
            raceFsExit();
        } else if (_raceFsActive) {
            raceFsApplyScale(); // 진입 완료 직후 실제 뷰포트 크기로 재fit
        }
    });

    // 리사이즈/방향전환 재계산 (미사용 시 _raceFsActive=false 가드로 no-op)
    window.addEventListener('resize', raceFsApplyScale);
    window.addEventListener('orientationchange', function () {
        setTimeout(raceFsApplyScale, 200); // 방향전환 후 뷰포트 확정 대기
    });

    // 페이지 이탈 — 스크롤 잠금/orientation 잔존 방지
    window.addEventListener('pagehide', function () { raceFsExit(); });
})();


// 경마 사운드 볼륨 관리 (ControlBar 위임)
function getHorseSoundEnabled() {
    return ControlBar.getSoundEnabled();
}

function getHorseMasterVolume() {
    return ControlBar.getMasterVolume();
}

// 기존 호환성 유지 (호출하는 곳이 있으므로 빈 함수로 유지)
function setHorseSoundCheckboxes() {}

// 디버그 로그 초기화
addDebugLog('경마 게임 초기화', 'info');

// 탈것 테마 데이터 (JSON에서 로드)
var vehicleThemes = {};
var ALL_VEHICLES = [];

// JSON 파일 로드
async function loadVehicleThemes() {
    try {
        const response = await fetch('/assets/vehicle-themes.json');
        const data = await response.json();
        vehicleThemes = data.vehicleThemes;
        
        // ALL_VEHICLES 배열 생성
        ALL_VEHICLES = Object.values(vehicleThemes).map(theme => ({
            id: theme.id,
            name: theme.name,
            emoji: theme.emoji,
            bgType: theme.theme,
            visualWidth: theme.visualWidth || 60 // SVG 내 실제 시각적 너비
        }));
        
        addDebugLog(`탈것 테마 데이터 로드 완료: ${ALL_VEHICLES.length}개`, 'info');
        console.log('ALL_VEHICLES 로드 완료:', ALL_VEHICLES);
    } catch (error) {
        addDebugLog(`테마 데이터 로드 실패: ${error.message}`, 'error');
        // 기본값으로 폴백
        ALL_VEHICLES = [
            { id: 'car', name: '자동차', emoji: '🚗', bgType: 'expressway', visualWidth: 50 },
            { id: 'rocket', name: '로켓', emoji: '🚀', bgType: 'sky', visualWidth: 60 },
            { id: 'bird', name: '새', emoji: '🐦', bgType: 'sky', visualWidth: 60 },
            { id: 'boat', name: '보트', emoji: '🚤', bgType: 'ocean', visualWidth: 50 },
            { id: 'bicycle', name: '자전거', emoji: '🚴', bgType: 'road', visualWidth: 56 },
            { id: 'rabbit', name: '토끼', emoji: '🐇', bgType: 'forest', visualWidth: 53 },
            { id: 'turtle', name: '거북이', emoji: '🐢', bgType: 'forest', visualWidth: 58 },
            { id: 'eagle', name: '독수리', emoji: '🦅', bgType: 'sky', visualWidth: 60 },
            { id: 'scooter', name: '킥보드', emoji: '🛴', bgType: 'road', visualWidth: 54 },
            { id: 'helicopter', name: '헬리콥터', emoji: '🚁', bgType: 'sky', visualWidth: 48 },
            { id: 'horse', name: '말', emoji: '🐎', bgType: 'forest', visualWidth: 56 },
            { id: 'knight', name: '기사', emoji: '⚔️', bgType: 'road', visualWidth: 48 },
            { id: 'dinosaur', name: '공룡', emoji: '🦕', bgType: 'beach', visualWidth: 56 },
            { id: 'ninja', name: '닌자', emoji: '🥷', bgType: 'sky', visualWidth: 44 },
            { id: 'crab', name: '게', emoji: '🦀', bgType: 'beach', visualWidth: 54 }
        ];
    }
}

// 페이지 로드 시 테마 데이터 로드
loadVehicleThemes();
var ordersData = {};
var currentUsers = [];

// 디바이스 ID 생성/가져오기
function getDeviceId() {
    let deviceId = localStorage.getItem('horseRaceDeviceId');
    if (!deviceId) {
        deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('horseRaceDeviceId', deviceId);
    }
    return deviceId;
}

// 소켓 연결
var socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
});
var currentServerId = null;
var currentServerName = null;

// 직접 URL 접속 차단 + 새로고침 시 재입장 지원
(function() {
    var urlParams = new URLSearchParams(window.location.search);
    var fromDice = urlParams.get('createRoom') === 'true' || urlParams.get('joinRoom') === 'true';

    // 새로고침: sessionStorage에 방 정보가 있으면 재입장
    var activeRoom = sessionStorage.getItem('horseRaceActiveRoom');
    if (!fromDice && activeRoom) {
        try {
            var rd = JSON.parse(activeRoom);
            currentServerId = rd.serverId || null;
            currentServerName = rd.serverName || null;
            if (currentServerId) {
                socket.emit('setServerId', { serverId: currentServerId, userName: rd.userName });
            }
            if (rd.serverName) {
                document.title = rd.serverName + ' - Horse Race';
            }
            // 소켓 연결 후 재입장
            socket.on('connect', function onReconnect() {
                socket.emit('joinRoom', {
                    roomId: rd.roomId,
                    userName: rd.userName,
                    isHost: false,
                    password: '',
                    deviceId: getDeviceId(),
                    tabId: getTabId()
                });
            });
        } catch(e) {
            sessionStorage.removeItem('horseRaceActiveRoom');
            window.location.replace('/game');
        }
        return;
    }

    if (!fromDice) {
        window.location.replace('/game');
        return;
    }
    var pending = localStorage.getItem('pendingHorseRaceRoom') || localStorage.getItem('pendingHorseRaceJoin');
    if (pending) {
        try {
            var pd = JSON.parse(pending);
            currentServerId = pd.serverId || null;
            currentServerName = pd.serverName || null;
            if (currentServerId) {
                socket.emit('setServerId', { serverId: currentServerId, userName: pd.userName });
                if (pd.serverName) {
                    document.title = pd.serverName + ' - Horse Race';
                }
            }
        } catch(e) {}
    }
})();

// ═══ 진입(생성/입장) 상태 머신 — 사용자 개시 entry에만 적용 ═══
// 자동 재입장 경로(위 IIFE의 onReconnect, 아래 전역 connect 핸들러)에는 절대 걸지 않는다 (C-10 핑퐁 방지).
var ENTRY_WATCHDOG_MS = 10000;      // 워치독: 응답 없으면 실패 UI 전환
var ROOM_ERROR_REDIRECT_MS = 3000;  // roomError 알림 후 로비 이동 대기

var entryInFlight = false;      // 사용자 개시 생성/입장 진행 중
var entrySettled = false;       // 현재 시도의 첫 settle 이후 중복 알림/이동 무시 (serverError→roomError 이중 도착 dedupe)
var entryWatchdogTimer = null;  // 10초 워치독 타이머
var entryRetryData = null;      // [다시 시도]용 pending payload ({ kind: 'create'|'join', data })
var entryConnectHandler = null; // entry용 once('connect') 핸들러 (재시도 시 off 대상)
var entryLoadingHTML = null;    // loadingScreen 원본 마크업 (재시도 시 스피너 복원용)
var entryErrorNavPending = false; // roomError 실패 알림→이동 대기 창 (이 창의 중복 roomError 알림 스택 금지, A-2 첫 settle만 유효)

// 워치독/in-flight/entry용 connect 핸들러 해제 (settle 공통)
function disarmEntry() {
    entryInFlight = false;
    if (entryWatchdogTimer) {
        clearTimeout(entryWatchdogTimer);
        entryWatchdogTimer = null;
    }
    if (entryConnectHandler) {
        socket.off('connect', entryConnectHandler);
        entryConnectHandler = null;
    }
}

function armEntryWatchdog() {
    if (entryWatchdogTimer) clearTimeout(entryWatchdogTimer);
    entryWatchdogTimer = setTimeout(onEntryWatchdogTimeout, ENTRY_WATCHDOG_MS);
}

function onEntryWatchdogTimeout() {
    entryWatchdogTimer = null;
    if (entrySettled) return;
    disarmEntry();
    entrySettled = true;
    showEntryFailureUI('네트워크 상태를 확인하고 다시 시도해주세요.');
}

// 진입 성공 settle — pending 소비 + 쿼리 스트립은 성공 시점에만 (실패/타임아웃 시 재시도 가능하게)
function settleEntrySuccess() {
    disarmEntry();
    entrySettled = true;
    entryRetryData = null;
    try {
        localStorage.removeItem('pendingHorseRaceRoom');
        localStorage.removeItem('pendingHorseRaceJoin');
    } catch (e) {}
    stripEntryQuery();
}

function stripEntryQuery() {
    try {
        var u = new URL(window.location.href);
        if (!u.searchParams.has('createRoom') && !u.searchParams.has('joinRoom')) return;
        u.searchParams.delete('createRoom');
        u.searchParams.delete('joinRoom');
        window.history.replaceState({}, document.title, u.pathname + (u.search || ''));
    } catch (e) {}
}

function isEntryFailureVisible() {
    return !!document.getElementById('entryFailNotice');
}

function updateEntryFailureReason(msg) {
    var el = document.getElementById('entryFailReason');
    if (el) el.textContent = msg;
}

// 실패 UI — loadingScreen 내부 교체. 마크업은 하드코딩 상수만, 사유 텍스트는 textContent 주입.
function showEntryFailureUI(reason) {
    var ls = document.getElementById('loadingScreen');
    if (!ls) return;
    if (entryLoadingHTML === null) entryLoadingHTML = ls.innerHTML;
    ls.innerHTML = '' +
        '<div id="entryFailNotice" style="text-align: center; color: white; padding: 0 20px; max-width: 400px;">' +
            '<div style="font-size: 60px; margin-bottom: 16px;">🐎</div>' +
            '<h2 style="font-size: 22px; margin-bottom: 10px;">방에 들어가지 못했어요</h2>' +
            '<p id="entryFailReason" style="font-size: 15px; opacity: 0.9; margin-bottom: 24px; line-height: 1.5; word-break: keep-all;"></p>' +
            '<div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">' +
                '<button id="entryRetryBtn" type="button" style="padding: 12px 24px; background: var(--bg-white); color: var(--text-primary); border: none; border-radius: 8px; font-size: 15px; font-weight: bold; cursor: pointer;">다시 시도</button>' +
                '<button id="entryLobbyBtn" type="button" style="padding: 12px 24px; background: transparent; color: white; border: 2px solid rgba(255,255,255,0.6); border-radius: 8px; font-size: 15px; font-weight: bold; cursor: pointer;">로비로</button>' +
            '</div>' +
        '</div>';
    updateEntryFailureReason(reason || '네트워크 상태를 확인하고 다시 시도해주세요.');
    var retryBtn = document.getElementById('entryRetryBtn');
    var lobbyBtn = document.getElementById('entryLobbyBtn');
    if (retryBtn) {
        if (entryRetryData) {
            retryBtn.addEventListener('click', retryEntry);
        } else {
            // 재시도 데이터 없음(수동 URL 진입/이미 소비) — 재시도 불가
            retryBtn.style.display = 'none';
        }
    }
    if (lobbyBtn) lobbyBtn.addEventListener('click', goLobbyFromEntryFailure);
    ls.style.display = 'flex';
}

function restoreEntryLoadingUI() {
    var ls = document.getElementById('loadingScreen');
    if (!ls) return;
    if (entryLoadingHTML !== null) ls.innerHTML = entryLoadingHTML;
    ls.style.display = 'flex';
}

// [다시 시도] — in-flight 무시 → 스피너 복원 → 안전 재발사
function retryEntry() {
    if (entryInFlight) return;
    if (!entryRetryData) {
        goLobbyFromEntryFailure();
        return;
    }
    restoreEntryLoadingUI();
    fireUserEntry();
}

// [로비로] — 스테일 pending의 자동 재생성 방지 위해 pending 2키 명시 삭제 후 이동
function goLobbyFromEntryFailure() {
    try {
        localStorage.removeItem('pendingHorseRaceRoom');
        localStorage.removeItem('pendingHorseRaceJoin');
    } catch (e) {}
    window.location.replace('/game');
}

// 사용자 개시 진입 발사 — emit은 항상 "connected면 즉시, 아니면 once('connect')" 경로만 (오프라인 버퍼링 금지)
function fireUserEntry() {
    if (!entryRetryData) return;
    var kind = entryRetryData.kind;
    var d = entryRetryData.data;

    // 비공개방 입장 — 비밀번호 모달 경유 (emit·워치독은 submitPassword에서. 입력 중 워치독 오발 방지)
    if (kind === 'join' && d.isPrivate) {
        pendingRoomId = d.roomId;
        pendingUserName = d.userName;
        document.getElementById('passwordModal').style.display = 'flex';
        document.getElementById('roomPasswordInput').focus();
        return;
    }

    entryInFlight = true;
    entrySettled = false;
    var fire = function () {
        entryConnectHandler = null;
        if (kind === 'create') {
            socket.emit('createRoom', {
                userName: d.userName,
                roomName: d.roomName,
                isPrivate: d.isPrivate,
                password: d.password,
                gameType: 'horse-race',
                expiryHours: d.expiryHours,
                blockIPPerUser: d.blockIPPerUser,
                deviceId: getDeviceId(),
                serverId: d.serverId || currentServerId,
                serverName: d.serverName || currentServerName,
                tabId: getTabId()
            });
        } else {
            socket.emit('joinRoom', {
                roomId: d.roomId,
                userName: d.userName,
                isHost: false,
                password: '',
                deviceId: getDeviceId(),
                tabId: getTabId()
            });
        }
    };
    dispatchEntryEmit(fire);
}

// 사용자 개시 emit 공통 발사기 — connected면 즉시, 아니면 once('connect') 단일 등록
// (+ 엔진이 죽어 있을 때만 명시 connect).
// (미연결 raw emit 버퍼링 금지 규율의 단일 경로 — fireUserEntry/submitPassword 공용)
function dispatchEntryEmit(fire) {
    // 이전 entry용 connect 핸들러 제거 — 재시도/재발사 시 이중 발사 방지
    if (entryConnectHandler) {
        socket.off('connect', entryConnectHandler);
        entryConnectHandler = null;
    }
    armEntryWatchdog();
    if (socket.connected) {
        fire();
    } else {
        entryConnectHandler = function onEntryConnect() {
            entryConnectHandler = null;
            fire();
        };
        socket.once('connect', entryConnectHandler);
        // 명시 재연결은 "엔진이 실제로 죽은 경우"에만 — reconnectionAttempts(10) 소진 대비.
        // 엔진이 open/opening인데 부르면(= 페이지 진입 직후 네임스페이스 CONNECT 진행 중 구간)
        // socket.connect()가 onopen()을 다시 태워 중복 CONNECT 패킷을 폴링 POST로 한 번 더 쏜다.
        // 그 POST가 웹소켓 업그레이드와 엇갈리면 서버가 400(TRANSPORT_MISMATCH) → 세션 강제
        // 재접속 → 진행 중이던 createRoom/joinRoom이 통째로 유실된다(2026-07-31 실측).
        var eng = socket.io && socket.io.engine;
        if (!eng || (eng.readyState !== 'open' && eng.readyState !== 'opening')) {
            socket.connect();
        }
    }
}


// 비밀번호 모달 닫기
function closePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
    document.getElementById('roomPasswordInput').value = '';
    pendingRoomId = null;
    pendingUserName = null;
}

// 비밀번호 제출
function submitPassword() {
    const password = document.getElementById('roomPasswordInput').value;

    if (pendingRoomId && pendingUserName) {
        // closePasswordModal()이 pending*을 null로 만들기 전에 캡처 (once('connect') 지연 발사 대비)
        var joinRoomId = pendingRoomId;
        var joinUserName = pendingUserName;
        // 사용자 개시 입장 — 공통 발사기 경유 (미연결 raw emit 버퍼링 금지) + 워치독 arm
        entryInFlight = true;
        entrySettled = false;
        dispatchEntryEmit(function () {
            socket.emit('joinRoom', {
                roomId: joinRoomId,
                userName: joinUserName,
                isHost: false,
                password: password,
                deviceId: getDeviceId(),
                tabId: getTabId()
            });
        });
    }

    closePasswordModal();
}

// 방 나가기
function leaveRoom() {
    showCustomConfirm('방을 나가시겠습니까?').then(result => {
        if (result) {
            socket.emit('leaveRoom');
        }
    });
}

// 준비 함수 (ReadyModule 위임)
function toggleReady() {
    ReadyModule.toggleReady();
}
function updateReadyButton() {
    ReadyModule.updateReadyButton();
}
function renderReadyUsers() {
    ReadyModule.renderReadyUsers();
}

// 시작 버튼 상태 업데이트
function updateStartButton() {
    const btn = document.getElementById('startHorseRaceButton');
    if (btn && isHost) {
        if (readyUsers.length >= 2 && !isRaceActive) {
            btn.disabled = false;
            btn.textContent = '🐎 경마 시작!';
        } else {
            btn.disabled = true;
            btn.textContent = `🐎 경마 시작 (${readyUsers.length}/2명 준비)`;
        }
    }
}

// 경마 시작
function startHorseRace() {
    addDebugLog('경주 시작 요청', 'race');
    socket.emit('startHorseRace');
}

// 말 선택
function selectHorse(horseIndex) {
    addDebugLog(`탈것 선택: ${horseIndex}`, 'selection');
    // 이미 선택한 탈것을 다시 선택하면 취소
    // 다른 탈것을 선택하면 재선택 (서버에서 검증)
    socket.emit('selectHorse', {
        horseIndex: horseIndex
    });
}

// 자동선택 토글 초기화 (로그인 유저만 표시, DB prefs 로드)
function initAutoSelectHorseToggle() {
    const wrap = document.getElementById('autoSelectHorseToggleWrap');
    const checkbox = document.getElementById('autoSelectHorseToggle');
    if (!wrap || !checkbox) return;

    // 꾸미기 상점 진입 버튼은 로컬 환경(localhost)에서만 노출 — 실서버에서는 숨김 (HTML 기본값 display:none 유지)
    const shopBtn = document.querySelector('.hshop-open-btn');
    if (shopBtn && isLocalhost) shopBtn.style.display = 'inline-flex';

    // 게스트(비로그인) 또는 무료방(serverId 없음)은 자동선택 토글 숨김 (상점 버튼은 위에서 로컬 한정 노출)
    // early-return이 아래 getUserPrefs 로드를 건너뛰므로 무료방에선 autoSelectHorseEnabled=false 유지
    // → tryAutoSelectHorse의 자동 픽도 발동하지 않음 (서버방에서 켠 pref가 무료방에서 새는 것 차단)
    let userAuth = null;
    try { userAuth = JSON.parse(localStorage.getItem('userAuth') || 'null'); } catch (e) {}
    if (!currentServerId || !userAuth || !userAuth.name || userAuth.name !== currentUser) {
        wrap.style.display = 'none';
        return;
    }

    // DB에서 prefs 로드
    socket.emit('getUserPrefs', { name: currentUser }, (resp) => {
        const prefs = (resp && resp.prefs) || {};
        autoSelectHorseEnabled = !!prefs.horseAutoSelect;
        checkbox.checked = autoSelectHorseEnabled;
        wrap.style.display = 'inline-flex';

        // 페이지 진입 직후 자동선택 시도 (조건 충족 시)
        tryAutoSelectHorse();
    });

    // 토글 변경 핸들러 (중복 바인딩 방지)
    if (!checkbox._autoSelectBound) {
        checkbox.addEventListener('change', () => {
            autoSelectHorseEnabled = checkbox.checked;
            socket.emit('setUserPref', {
                name: currentUser,
                key: 'horseAutoSelect',
                value: autoSelectHorseEnabled
            });
            // 토글을 ON으로 바꾸면 즉시 한 번 더 시도
            if (autoSelectHorseEnabled) {
                autoSelectAttempted = false; // 토글 변경 시 재시도 허용
                tryAutoSelectHorse();
            }
        });
        checkbox._autoSelectBound = true;
    }
}

// 자동선택 시도 (조건 가드 — 한 라운드 1회만)
function tryAutoSelectHorse() {
    if (!autoSelectHorseEnabled) return;
    if (autoSelectAttempted) return;
    if (typeof isRaceActive !== 'undefined' && isRaceActive) return;
    if (!Array.isArray(availableHorses) || availableHorses.length === 0) return;
    if (!Array.isArray(readyUsers) || !readyUsers.includes(currentUser)) return;
    if (typeof mySelectedHorse !== 'undefined' && mySelectedHorse !== null && mySelectedHorse !== undefined && mySelectedHorse !== -1) return;

    const choices = availableHorses.filter(h => h !== mySelectedHorse);
    if (choices.length === 0) return;

    autoSelectAttempted = true;
    const randomIndex = choices[Math.floor(Math.random() * choices.length)];
    selectHorse(randomIndex);
    if (typeof addDebugLog === 'function') addDebugLog(`자동선택: 탈것 ${randomIndex}`, 'selection');
}

// 탈것 선택 화면에 트랙 표시 (초기 상태)
function renderTrackForSelection() {
    // 개정3: 상시 PiP — 선택 화면 트랙 미리보기도 래퍼가 있는 문서(raceDoc)에 렌더.
    // 픽 UI(horseSelectionSection)는 래퍼 밖이라 메인 유지.
    const track = raceDoc().getElementById('raceTrack');
    const trackContainer = raceDoc().getElementById('raceTrackContainer');

    if (!track || !trackContainer) {
        console.warn('[renderTrackForSelection] track 또는 trackContainer를 찾을 수 없음');
        return;
    }

    trackContainer.style.display = 'block';
    const wrapper = raceDoc().getElementById('raceTrackWrapper');
    if (wrapper) wrapper.style.display = 'block';
    removePipResultBanner(); // 다음 라운드 선택 화면 — 지난 판 결과 요약 정리
    track.innerHTML = '';
    track.style.width = '100%';

    const trackWidth = trackContainer.offsetWidth || 700;
    const horseCount = availableHorses.length;
    
    if (horseCount === 0) {
        console.warn('[renderTrackForSelection] availableHorses가 비어있음');
        return;
    }
    
    const wallHeight = 6;
    // [모바일대응] 트랙 높이 동적 계산 (350 하드코딩 → 실제 높이)
    // 위에서 raceDoc()으로 잡아 둔 trackContainer를 재사용한다 — 여기서 메인 문서를 다시 조회하면
    // 작은 창(PiP) attach 중에는 null이 되어 400 폴백으로 레인 높이가 어긋난다.
    const availableTrackHeight = (trackContainer.offsetHeight || 400) - 50; // 상단 여백
    const laneHeight = Math.min(75, Math.floor((availableTrackHeight - wallHeight * (horseCount - 1)) / horseCount));
    const totalLaneHeight = laneHeight + wallHeight;

    console.log('[renderTrackForSelection] 시작:', {
        horseCount,
        selectedVehicleTypes: selectedVehicleTypes,
        ALL_VEHICLES: ALL_VEHICLES.length,
        vehicleThemes: Object.keys(vehicleThemes).length
    });
    
    availableHorses.forEach((horseIndex, rank) => {
        // selectedVehicleTypes가 있으면 사용, 없으면 ALL_VEHICLES에서 가져오기
        // 말 선택 화면에서는 availableHorses 순서대로 표시하므로 horseIndex를 그대로 사용
        const vehicleId = selectedVehicleTypes && selectedVehicleTypes[horseIndex] 
            ? selectedVehicleTypes[horseIndex] 
            : (ALL_VEHICLES.length > 0 ? ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id : 'car');
        
        console.log(`[renderTrackForSelection] 말 ${horseIndex} (rank ${rank}): vehicleId=${vehicleId}`);
        
        const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId) || ALL_VEHICLES[0];

        const { lane, vehicleBg } = createLane({ vehicleId, topPx: rank * totalLaneHeight, laneHeight, isRacing: false });
        track.appendChild(lane);

        if (rank < horseCount - 1) {
            track.appendChild(createWall({ topPx: rank * totalLaneHeight + laneHeight, wallHeight }));
        }
        
        // 탈것 표시 (시작 위치)
        const horse = document.createElement('div');
        horse.className = 'horse idle';
        horse.id = `horse_preview_${horseIndex}`;
        horse.className = 'horse idle';
        horse.style.cssText = `
            position: absolute;
            left: 10px;
            top: ${rank * totalLaneHeight + 10}px;
            width: 80px;
            height: ${laneHeight - 10}px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: ${100 - rank};
        `;
        
        // 선택한 모든 사용자 이름 표시 (중복 선택 가능)
        const selectedUsers = Object.entries(userHorseBets)
            .filter(([_, h]) => h === horseIndex)
            .map(([name, _]) => name);
        
        // 탈것 스프라이트
        const vehicleContent = document.createElement('div');
        vehicleContent.className = 'vehicle-sprite';

        const frame1 = document.createElement('div');
        frame1.className = 'frame1';
        const frame2 = document.createElement('div');
        frame2.className = 'frame2';
        const vehicleSVGs = getVehicleSVG(vehicleId);
        const idleData = vehicleSVGs.idle || vehicleSVGs.run || vehicleSVGs;
        frame1.innerHTML = idleData.frame1 || vehicleSVGs.frame1;
        frame2.innerHTML = (idleData.frame2 || vehicleSVGs.frame2) || '';

        const activeLayer = document.createElement('div');
        activeLayer.className = 'vehicle-active-layer';
        activeLayer.appendChild(frame1);
        activeLayer.appendChild(frame2);

        vehicleContent.appendChild(activeLayer);
        horse.appendChild(vehicleContent);
        horse.dataset.vehicleId = vehicleId;
        horse.dataset.vehicleVariant = 'base';

        // 내가 선택한 탈것 위에 화살표 표시
        if (userHorseBets[currentUser] === horseIndex) {
            const arrow = document.createElement('div');
            arrow.className = 'my-horse-arrow';
            arrow.innerHTML = '▼';
            arrow.style.cssText = `
                position: absolute;
                top: -18px;
                left: 50%;
                transform: translateX(-50%);
                font-size: 16px;
                color: var(--yellow-500);
                text-shadow: 0 0 6px rgba(255,215,0,0.8);
                animation: arrowBounce 0.8s ease-in-out infinite;
                pointer-events: none;
                z-index: 300;
            `;
            horse.style.overflow = 'visible';
            horse.appendChild(arrow);
        }

        track.appendChild(horse);

        // 이름 라벨을 레인 왼쪽에 표시
        if (selectedUsers.length > 0) {
            const namesContainer = document.createElement('div');
            namesContainer.className = 'names-container';
            namesContainer.style.cssText = `
                position: absolute;
                top: ${rank * totalLaneHeight + 5}px;
                left: 5px;
                display: flex;
                flex-wrap: wrap;
                gap: 3px;
                z-index: 200;
                max-width: 250px;
            `;

            // 내 이름이 먼저 오도록 정렬
            const sortedUsers = [...selectedUsers].sort((a, b) => {
                if (a === currentUser) return -1;
                if (b === currentUser) return 1;
                return 0;
            });

            sortedUsers.forEach(userName => {
                const nameTag = document.createElement('span');
                const isMe = userName === currentUser;
                nameTag.classList.add('race-name-tag');
                nameTag.dataset.username = userName;

                if (isMe) {
                    // 내 탈것: 금색 배경 + 검은 글씨 + 테두리 + 큰 폰트
                    nameTag.style.cssText = ME_NAMETAG_CSS;
                    nameTag.textContent = '⭐ ' + userName;
                } else {
                    // 다른 사용자: 개선된 가독성
                    nameTag.style.cssText = `
                        background: rgba(0,0,0,0.75);
                        color: var(--bg-white);
                        padding: 2px 5px;
                        border-radius: 3px;
                        font-size: 10px;
                        line-height: 15px;
                        font-weight: bold;
                        white-space: nowrap;
                        border: 1px solid rgba(255,255,255,0.3);
                        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
                    `;
                    nameTag.textContent = userName;
                }
                // 평소 선택화면은 내 로컬만(false) — 카운트다운부터는 fresh broadcast로 전원 이름표 적용
                applyLabelCosmetic(nameTag, userName, isMe, raceLabelsFresh);
                namesContainer.appendChild(nameTag);
            });

            track.appendChild(namesContainer);
        }
    });
}

// 카운트다운~경주 시작 사이 "이번 라운드" 이름표 broadcast 도착 여부.
// horseRaceCountdown(labelCosmetics 동봉)에서 true → horseRaceStarted에서 false.
// 선택화면 태그 렌더가 이전 라운드 stale labels를 쓰지 않게 게이팅한다(lesson 2026-06-22).
var raceLabelsFresh = false;

// 이름표(닉네임 라벨) 꾸미기 적용 — 색만 오버라이드(textContent/위치/폰트 불변).
// useBroadcast=true(경주중/카운트다운 fresh): 서버 broadcast(labels, 전원) → 없으면 isMe일 때 내 로컬.
// useBroadcast=false(선택화면): broadcast 무시(타인의 현재 이름표는 알 수 없음). isMe면 내 로컬, 타인은 기본 유지.
function applyLabelCosmetic(nameTag, userName, isMe, useBroadcast) {
    var bibId = null;
    if (useBroadcast) {
        var labels = window._raceCosmetics && window._raceCosmetics.labels;
        if (labels && labels[userName]) bibId = labels[userName];
        else if (isMe && window.HorseShop && window.HorseShop.getMyEquippedLabel) bibId = window.HorseShop.getMyEquippedLabel();
    } else if (isMe && window.HorseShop && window.HorseShop.getMyEquippedLabel) {
        bibId = window.HorseShop.getMyEquippedLabel();
    }
    if (bibId && window.HorseShop && window.HorseShop.getLabelStyle) {
        var st = window.HorseShop.getLabelStyle(bibId);
        if (st) {
            if (st.bg) nameTag.style.background = st.bg;
            if (st.color) nameTag.style.color = st.color;
            if (st.border) nameTag.style.borderColor = st.border; // 기본 border-width/style 유지
        }
    }
}

// 내(me) 이름표 라벨의 기본 스타일을 다시 인라인 적용(해제 시 복원에 필수).
function applyMyDefaultTagStyle(nameTag) {
    nameTag.style.cssText = ME_NAMETAG_CSS;
}

// 내 이름표 라벨을 현재 화면(.race-name-tag)에 즉시 재적용 (장착/해제 라이브 반영).
// 셀렉터엔 유저입력을 넣지 않고 JS로 dataset.username을 비교한다.
function refreshMyNameTags() {
    var tags = raceDoc().querySelectorAll('.race-name-tag'); // 이름표는 트랙 내부 — 상시 PiP 대응
    for (var i = 0; i < tags.length; i++) {
        var tag = tags[i];
        if (tag.dataset.username !== currentUser) continue;
        applyMyDefaultTagStyle(tag);                       // 기본 "내" 스타일 복원(해제 시 필수)
        applyLabelCosmetic(tag, currentUser, true, false); // 내 로컬 장착 재적용(없으면 기본 유지)
    }
}
window.refreshMyNameTags = refreshMyNameTags;

// 탈것 선택 UI 렌더링
function renderHorseSelection() {
    const grid = document.getElementById('horseSelectionGrid');
    const info = document.getElementById('horseSelectionInfo');
    const scrollY = window.scrollY;
    
    console.log('[renderHorseSelection] 시작', {
        grid: !!grid,
        availableHorses: availableHorses.length,
        ALL_VEHICLES: ALL_VEHICLES.length,
        selectedVehicleTypes: selectedVehicleTypes,
        vehicleThemes_loaded: Object.keys(vehicleThemes).length
    });
    
    if (!grid) {
        console.error('[renderHorseSelection] grid 요소를 찾을 수 없음');
        return;
    }
    
    grid.innerHTML = '';

    // 트랙 길이 선택 UI (방장 전용)
    let trackLengthContainer = document.getElementById('trackLengthSelector');
    if (!trackLengthContainer) {
        trackLengthContainer = document.createElement('div');
        trackLengthContainer.id = 'trackLengthSelector';
        trackLengthContainer.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;';
        grid.parentElement.insertBefore(trackLengthContainer, grid);
    }
    if (isHost) {
        const activeColor = 'var(--yellow-400)'; // 모든 트랙 버튼 노란색 통일
        const trackLabels = { short: '짧게', medium: '보통', long: '길게' };
        const presets = trackPresetsFromServer;
        let btnsHtml = '<span style="font-size: 12px; color: var(--gray-300);">트랙:</span>';
        for (const key of ['short', 'medium', 'long']) {
            const isActive = currentTrackLength === key;
            btnsHtml += `<button class="track-length-btn" data-length="${key}"
                style="padding: 4px 10px; border-radius: 12px; border: 1px solid var(--gray-600); background: ${isActive ? activeColor : 'var(--gray-800)'}; color: ${isActive ? 'var(--gray-900)' : 'var(--gray-300)'}; cursor: pointer; font-size: 11px; font-weight: bold;">
                ${trackLabels[key]} (${presets[key]}m)
            </button>`;
        }
        trackLengthContainer.innerHTML = btnsHtml;
        trackLengthContainer.querySelectorAll('.track-length-btn').forEach(btn => {
            btn.onclick = () => {
                // 즉시 변수 갱신 (낙관적 업데이트)
                currentTrackLength = btn.dataset.length;
                currentTrackDistanceMeters = trackPresetsFromServer[btn.dataset.length] || 500;

                // 즉시 선택 피드백
                trackLengthContainer.querySelectorAll('.track-length-btn').forEach(b => {
                    b.style.background = 'var(--gray-800)';
                    b.style.color = 'var(--gray-300)';
                    b.style.boxShadow = 'none';
                });
                const activeColor = 'var(--yellow-400)'; // 노란색 통일
                btn.style.background = activeColor;
                btn.style.color = 'var(--gray-900)';
                btn.style.boxShadow = '0 0 8px ' + activeColor + '80';
                socket.emit('setTrackLength', { trackLength: btn.dataset.length });

                // 로그인 유저면 마지막 선택 트랙을 계정 pref로 저장 — 다음 방 생성 시 서버가 시딩해 자동선택.
                // 게이트는 계정(userAuth)이지 방 종류가 아님 — 무료방에서도 저장 (currentServerId 게이트 금지)
                let userAuth = null;
                try { userAuth = JSON.parse(localStorage.getItem('userAuth') || 'null'); } catch (e) {}
                if (userAuth && userAuth.name && userAuth.name === currentUser) {
                    socket.emit('setUserPref', { name: currentUser, key: 'horseTrackLength', value: btn.dataset.length });
                }

                // 트랙 미리보기 즉시 갱신
                renderTrackForSelection();
            };
        });
        trackLengthContainer.style.display = 'flex';
    } else {
        trackLengthContainer.innerHTML = `<span style="display: inline-block; padding: 6px 16px; border-radius: 12px; background: linear-gradient(135deg, var(--slate-800), var(--slate-700)); border: 1px solid var(--slate-600); font-size: 14px; font-weight: bold; color: var(--slate-200); letter-spacing: 1px;">🏁 <span id="trackLengthInfo" style="color: var(--blue-400);">${currentTrackDistanceMeters}m</span></span>`;
        trackLengthContainer.style.display = 'flex';
    }

    // 트랙 표시 (배경 이미지 포함)
    // selectedVehicleTypes가 설정되어 있어야 배경이 제대로 표시됨
    console.log('[renderHorseSelection] renderTrackForSelection 호출 전:', {
        selectedVehicleTypes: selectedVehicleTypes,
        availableHorses: availableHorses.length,
        vehicleThemes_loaded: Object.keys(vehicleThemes).length > 0
    });
    
    // vehicleThemes가 로드되지 않았으면 로드 대기
    if (Object.keys(vehicleThemes).length === 0) {
        console.warn('[renderHorseSelection] vehicleThemes가 로드되지 않음, 로드 대기...');
        loadVehicleThemes().then(() => {
            renderTrackForSelection();
        }).catch(() => {
            renderTrackForSelection(); // 폴백으로 렌더링
        });
    } else {
        renderTrackForSelection();
    }
    
    if (availableHorses.length === 0) {
        info.textContent = '탈것 목록을 불러오는 중...';
        console.warn('[renderHorseSelection] availableHorses가 비어있음');
        return;
    }
    
    // ALL_VEHICLES가 아직 로드되지 않았으면 폴백 데이터 사용
    if (ALL_VEHICLES.length === 0) {
        console.warn('[renderHorseSelection] ALL_VEHICLES가 비어있음, 폴백 데이터 사용');
        // 폴백 데이터 설정
        ALL_VEHICLES = [
            { id: 'car', name: '자동차', emoji: '🚗', bgType: 'expressway' },
            { id: 'rocket', name: '로켓', emoji: '🚀', bgType: 'sky' },
            { id: 'bird', name: '새', emoji: '🐦', bgType: 'sky' },
            { id: 'boat', name: '보트', emoji: '🚤', bgType: 'ocean' },
            { id: 'bicycle', name: '자전거', emoji: '🚴', bgType: 'road' },
            { id: 'rabbit', name: '토끼', emoji: '🐇', bgType: 'forest' },
            { id: 'turtle', name: '거북이', emoji: '🐢', bgType: 'forest' },
            { id: 'eagle', name: '독수리', emoji: '🦅', bgType: 'sky' },
            { id: 'scooter', name: '킥보드', emoji: '🛴', bgType: 'road' },
            { id: 'helicopter', name: '헬리콥터', emoji: '🚁', bgType: 'sky' },
            { id: 'horse', name: '말', emoji: '🐎', bgType: 'forest' },
            { id: 'knight', name: '기사', emoji: '⚔️', bgType: 'road' },
            { id: 'dinosaur', name: '공룡', emoji: '🦕', bgType: 'beach' },
            { id: 'ninja', name: '닌자', emoji: '🥷', bgType: 'sky' },
            { id: 'crab', name: '게', emoji: '🦀', bgType: 'beach' }
        ];
        // 비동기로 로드 시도 (나중에 업데이트됨)
        loadVehicleThemes().catch(err => {
            console.error('[renderHorseSelection] 테마 로드 실패:', err);
        });
    }

    // 추천 탈것 계산: 현재 배팅 가능한 탈것 중 1등 비율이 가장 낮은 것 (승률 평준화)
    let recommendedVehicleId = null;
    if (vehicleStatsData.length > 0) {
        let lowestWinRate = Infinity;
        availableHorses.forEach(hi => {
            const vid = selectedVehicleTypes ? selectedVehicleTypes[hi] : ALL_VEHICLES[hi % ALL_VEHICLES.length].id;
            const st = vehicleStatsData.find(s => s.vehicle_id === vid);
            if (st && st.appearance_count >= 5) {
                const winRate = st.rank_1 / st.appearance_count;
                if (winRate < lowestWinRate) {
                    lowestWinRate = winRate;
                    recommendedVehicleId = vid;
                }
            }
        });
    }

    availableHorses.forEach((horseIndex, index) => {
        const button = document.createElement('button');
        button.className = 'horse-selection-button';
        button.id = `horseButton_${horseIndex}`;
        
        // 탈것 타입 가져오기
        const vehicleId = selectedVehicleTypes ? selectedVehicleTypes[horseIndex] : ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id;
        const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId) || ALL_VEHICLES[0];
        
        // 내 선택 여부만 확인 (타인 선택 정보는 서버에서 숨김)
        const isMyHorse = userHorseBets[currentUser] === horseIndex;

        // 참가자 수 계산
        const totalPlayers = currentUsers.length > 0 ? currentUsers.length :
                            (readyUsers.length > 0 ? readyUsers.length : 1);

        // 디버깅용 로그
        if (index === 0) {
            console.log('[말 선택]', {
                availableHorses: availableHorses.length,
                totalPlayers,
                currentUsers: currentUsers.length,
                readyUsers: readyUsers.length,
                isHost: isHost,
                currentUser: currentUser,
                selectedUsersFromServer: selectedUsersFromServer.length
            });
        }

        if (isMyHorse) {
            button.classList.add('selected');
            mySelectedHorse = horseIndex;
        } else {
            button.classList.remove('selected');
        }
        
        // 탈것 버튼 내용 생성 (SVG idle 애니메이션 - 4프레임)
        const svgData = getVehicleSVG(vehicleId);
        const idleData = svgData.idle || svgData.run || svgData;
        let vehicleDisplay = '';
        if (idleData && idleData.frame1) {
            const uid = `idle_${horseIndex}`;
            // 4프레임: frame1(원위치) → frame2(살짝위) → frame1(원위치) → frame2(살짝아래)
            vehicleDisplay = `<div class="vehicle-display" style="width: 60px; height: 45px; margin: 0 auto; position: relative;">
                <div id="${uid}_wrap" style="position:absolute;inset:0;transition:transform 0.3s ease-in-out;">
                    <div id="${uid}_f1" style="position:absolute;inset:0;">${idleData.frame1}</div>
                    <div id="${uid}_f2" style="position:absolute;inset:0;opacity:0;">${idleData.frame2 || idleData.frame1}</div>
                </div>
            </div>`;
        } else {
            vehicleDisplay = `<div class="vehicle-display" style="font-size: 48px;">${vehicle.emoji}</div>`;
        }
        let content = vehicleDisplay;
        const isPopular = popularVehicles.includes(vehicleId);
        const isNew = NEW_VEHICLES.includes(vehicleId);
        const badges = (isNew ? ' <span style="font-size: 10px; background: var(--green-500); color: var(--bg-white); padding: 1px 5px; border-radius: 8px; vertical-align: middle;">NEW</span>' : '') + (isPopular ? ' <span style="font-size: 10px; background: var(--red-600); color: var(--bg-white); padding: 1px 5px; border-radius: 8px; vertical-align: middle;">인기</span>' : '');
        content += `<div style="font-size: 14px; margin-top: 5px; font-weight: 600;">${vehicle.name}${badges}</div>`;

        // 추천 뱃지 표시 (1등 비율이 가장 낮은 탈것 = 승률 평준화 목적)
        if (vehicleId === recommendedVehicleId) {
            content += `<div style="margin-top: 3px;"><span style="font-size: 10px; background: var(--red-700); color: var(--bg-white); padding: 1px 6px; border-radius: 8px;">추천!</span></div>`;
        }

        // 내 선택만 표시 (타인 선택은 숨김 - 카운트다운 후 공개)
        if (isMyHorse) {
            content += `<div style="font-size: 12px; margin-top: 5px; color: var(--horse-accent); font-weight: bold;">✓ 내가 선택</div>`;
        }
        // 타인 선택은 탈것 버튼에 표시하지 않음 (유추 방지)
        
        button.innerHTML = content;
        
        button.onclick = () => {
            // 비활성화된 버튼은 선택 불가
            if (button.disabled) {
                console.log(`[말 선택] ${vehicle.name}은(는) 선택할 수 없습니다 (이미 다른 사람이 선택함)`);
                return;
            }
            
            // 같은 탈것을 다시 선택하면 취소, 다른 탈것을 선택하면 재선택
            selectHorse(horseIndex);
        };
        
        grid.appendChild(button);
    });

    // 랜덤 선택 버튼 추가
    const randomButton = document.createElement('button');
    randomButton.className = 'horse-selection-button random-select';
    randomButton.id = 'randomSelectButton';

    // 탈것 6개 이상이면 직사각형 (가로로 꽉 차게)
    if (availableHorses.length >= 6) {
        randomButton.style.gridColumn = '1 / -1';  // 전체 가로 차지
        randomButton.style.height = '60px';
    }

    // 이미 랜덤 선택했는지 확인
    const isRandomSelected = mySelectedHorse !== null && window._isRandomSelection;
    if (isRandomSelected) {
        randomButton.classList.add('selected');
    }

    // 6개 이상이면 가로 레이아웃, 아니면 세로 레이아웃
    if (availableHorses.length >= 6) {
        randomButton.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;gap:12px;">
                <span style="font-size:24px;animation:diceWobble 2s ease-in-out infinite;">🎲</span>
                <span style="font-size:14px;font-weight:bold;color:var(--red-400);">랜덤 선택!!</span>
            </div>
        `;
    } else {
        randomButton.innerHTML = `
            <div class="vehicle-card-content" style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;">
                <div style="font-size:24px;animation:diceWobble 2s ease-in-out infinite;">🎲</div>
                <div class="vehicle-name" style="font-size:12px;">랜덤!</div>
            </div>
        `;
    }

    randomButton.onclick = () => {
        // showCustomAlert 사용 — 이전의 showToast는 이 페이지에 정의되지 않아 ReferenceError로
        // 안내 없이 조용히 실패했다(등수 박스 핸들러와 같은 함수·같은 문구로 통일).
        if (!readyUsers.includes(currentUser)) {
            showCustomAlert('먼저 준비를 해주세요!', 'warning');
            return;
        }
        // 현재 선택한 말 제외하고 랜덤 선택
        const choices = availableHorses.filter(h => h !== mySelectedHorse);
        if (choices.length === 0) {
            showCustomAlert('선택할 수 있는 탈것이 없습니다!', 'warning');
            return;
        }
        const randomIndex = choices[Math.floor(Math.random() * choices.length)];
        selectHorse(randomIndex);
    };

    // 랜덤 버튼을 맨 앞에 추가
    grid.insertBefore(randomButton, grid.firstChild);

    console.log('[renderHorseSelection] 완료', {
        생성된_버튼_수: grid.children.length,
        availableHorses: availableHorses.length
    });

    // 선택 정보는 "탈것 선택 안한 사람" 섹션에서 표시 (주사위 게임과 동일한 방식)
    info.innerHTML = '';

    // idle 애니메이션 (4프레임 사이클: f1↑ → f2→ → f1↓ → f2→)
    if (window._idleAnimInterval) clearInterval(window._idleAnimInterval);
    let idleFrame = 0;
    const idleYOffsets = [0, -2, 0, 2]; // 위아래 흔들림
    window._idleAnimInterval = setInterval(() => {
        const phase = idleFrame % 4;
        const showF1 = phase === 0 || phase === 2;
        const yOff = idleYOffsets[phase];
        availableHorses.forEach((hi) => {
            const wrap = document.getElementById(`idle_${hi}_wrap`);
            const f1 = document.getElementById(`idle_${hi}_f1`);
            const f2 = document.getElementById(`idle_${hi}_f2`);
            if (wrap && f1 && f2) {
                wrap.style.transform = `translateY(${yOff}px)`;
                f1.style.opacity = showF1 ? '1' : '0';
                f2.style.opacity = showF1 ? '0' : '1';
            }
        });
        idleFrame++;
    }, 300);

    // 선택된 탈것 랜덤 춤 애니메이션 (1~2초마다)
    if (window._selectedDanceTimeout) clearTimeout(window._selectedDanceTimeout);
    function triggerRandomDance() {
        const selectedButtons = document.querySelectorAll('.horse-selection-button.selected .vehicle-display');
        selectedButtons.forEach(el => {
            el.classList.remove('dancing');
            void el.offsetWidth; // reflow 트리거
            el.classList.add('dancing');
            setTimeout(() => el.classList.remove('dancing'), 600);
        });
        // 다음 춤은 1~2초 후 랜덤
        window._selectedDanceTimeout = setTimeout(triggerRandomDance, 1000 + Math.random() * 1000);
    }
    window._selectedDanceTimeout = setTimeout(triggerRandomDance, 1000 + Math.random() * 1000);

    // 탈것 선택 안한 사람 표시 (주사위 게임의 "주사위 안 굴린 사람"과 동일한 방식)
    const notSelectedSection = document.getElementById('notSelectedVehicleSection');
    const notSelectedList = document.getElementById('notSelectedVehicleList');
    if (notSelectedSection && notSelectedList) {
        const notSelectedUsers = readyUsers.filter(name => !selectedUsersFromServer.includes(name));
        if (notSelectedUsers.length > 0 && readyUsers.length > 0) {
            notSelectedSection.style.display = 'block';
            notSelectedList.innerHTML = '';
            notSelectedUsers.sort((a, b) => a.localeCompare(b, 'ko')).forEach(name => {
                const tag = document.createElement('div');
                tag.className = 'not-rolled-tag';
                tag.textContent = name + (name === currentUser ? ' (나)' : '');
                notSelectedList.appendChild(tag);
            });
        } else {
            notSelectedSection.style.display = 'none';
        }
    }
    window.scrollTo(0, scrollY);

    // N등 투표 박스 렌더 (탈것 수 = 등수 옵션 수)
    renderRankVoteSection();
}

// ─── N등 투표 섹션 ───
// availableHorses.length = 등수 옵션 수.
// 단, "달리는 말"(베팅된 unique 말 수) > 0 이면 그 수 초과 등수는 invalid 표시.
// 트랙 안 토스트 — 작은 창(PiP) 관전 중에는 showCustomAlert가 메인 문서에만 떠서 창 안에서는
// "눌러도 아무 반응 없음"이 되고, 여러 번 누르면 숨은 메인 창에 경고창만 겹겹이 쌓인다.
// 경주 재개 토스트와 같은 형태·같은 자리. 정적 문자열만 넣는다(유저 입력 미사용).
function showTrackToast(message) {
    var doc = raceDoc();
    var container = doc.getElementById('raceTrackContainer');
    if (!container) return;
    var timerWin = (racePipAttached() && window._racePipWin && !window._racePipWin.closed)
        ? window._racePipWin : window;
    var toast = doc.createElement('div');
    toast.textContent = message;
    toast.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;'
        + 'background:rgba(0,0,0,0.75);color:var(--yellow-400);padding:8px 20px;border-radius:8px;'
        + 'font-size:14px;font-weight:bold;pointer-events:none;transition:opacity 0.5s;';
    container.style.position = 'relative';
    container.appendChild(toast);
    timerWin.setTimeout(function () { toast.style.opacity = '0'; }, 900);
    timerWin.setTimeout(function () { toast.remove(); }, 1500);
}

// 작은 창 전용 결과 요약 — #resultOverlay는 래퍼 밖 형제라 PiP를 따라가지 않고, 확인 버튼이
// 인라인 onclick이라 이식해도 문서 입양 후 PiP 전역을 참조해 죽는다. 그래서 옮기는 대신 요약을 그린다.
// 다른 탭에 둔 채 작은 창만 보고 있으면 결과를 통째로 놓치던 공백을 메운다 (메인 오버레이는 그대로).
// 유저 입력(당첨자 이름)은 반드시 escapeHtmlText 경유.
function showPipResultBanner(targetRank, winners) {
    if (!racePipAttached()) return;
    var doc = raceDoc();
    var container = doc.getElementById('raceTrackContainer');
    if (!container) return;
    removePipResultBanner();

    var names = (winners && winners.length)
        ? winners.map(function (n) { return escapeHtmlText(n); }).join(', ')
        : '없음';
    var titleText = (typeof targetRank === 'number' && targetRank >= 1)
        ? targetRank + '등을 찾아라!'
        : '꼴등을 찾아라!';

    var banner = doc.createElement('div');
    banner.id = 'pipResultBanner';
    banner.style.cssText = 'position:absolute;inset:0;z-index:150;display:flex;justify-content:center;'
        + 'align-items:center;background:rgba(0,0,0,0.72);cursor:pointer;'
        + 'font-family:"Jua","Segoe UI",Tahoma,sans-serif;';
    banner.innerHTML =
        '<div style="background:rgba(20,20,20,0.95);border:2px solid var(--yellow-400);border-radius:14px;'
        + 'padding:16px 22px;max-width:88%;text-align:center;color:#fff;">'
        + '<div style="font-size:20px;font-weight:900;margin-bottom:6px;">🎊 순위 발표</div>'
        + '<div style="font-size:14px;color:var(--yellow-400);margin-bottom:10px;">🎯 ' + escapeHtmlText(titleText) + '</div>'
        + '<div style="font-size:15px;font-weight:700;line-height:1.5;word-break:break-all;">당첨: ' + names + '</div>'
        + '<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:12px;">자세한 순위는 원래 화면에서 · 눌러서 닫기</div>'
        + '</div>';
    // 인라인 onclick 금지 — 문서 입양 후 PiP 전역을 참조해 죽는다. 클로저 리스너는 살아남는다.
    banner.addEventListener('click', removePipResultBanner);
    container.style.position = 'relative';
    container.appendChild(banner);
    if (typeof racePipApplyScale === 'function') racePipApplyScale(); // 배너는 absolute라 무영향이지만 멱등
}

// 결과 요약 제거 — 클릭·다음 라운드(선택 렌더/카운트다운)·창 닫기에서 호출. 어느 문서에 있든 잡는다.
function removePipResultBanner() {
    var el = anyDocGetById('pipResultBanner');
    if (el) el.remove();
}

function renderRankVoteSection(opts) {
    var forceShow = !!(opts && opts.forceShow);
    // 이식 대상(룰렛 구간에 래퍼를 따라 PiP로 이동) — 형제 함수들과 같은 anyDoc 조회.
    // 메인 전용 조회면 이식 중 조기 return 되어 낡은 투표 막대가 다음 판까지 남는다.
    var section = anyDocGetById('rankVoteSection');
    var boxesEl = anyDocGetById('rankVoteBoxes');
    if (!section || !boxesEl) return;

    if (!availableHorses || availableHorses.length === 0) {
        section.style.display = 'none';
        return;
    }
    if (!forceShow && isRaceActive) {
        section.style.display = 'none';
        return;
    }

    // 본인이 readyUsers 목록에 없으면 투표 불가 (UI 숨김) — 단 forceShow면 룰렛 시각화 위해 표시
    if (!forceShow && !readyUsers.includes(currentUser)) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';

    // 등수별 표 수 집계 (익명 — 이름 비공개)
    var tallyByRank = {};
    Object.values(userRankVotes || {}).forEach(function(rank) {
        if (!Number.isInteger(rank)) return;
        tallyByRank[rank] = (tallyByRank[rank] || 0) + 1;
    });

    var myVote = userRankVotes ? userRankVotes[currentUser] : undefined;
    boxesEl.innerHTML = '';

    for (var r = 1; r <= availableHorses.length; r++) {
        var box = document.createElement('div');
        box.className = 'rank-vote-box';
        box.dataset.rank = String(r);
        if (myVote === r) box.classList.add('selected');

        var count = tallyByRank[r] || 0;
        // 익명 처리: 투표자 이름 숨기고 막대(=표)로 표시
        var barsHtml = '';
        for (var b = 0; b < count; b++) barsHtml += '<div class="rank-vote-bar"></div>';
        box.innerHTML =
            '<div class="rank-vote-rank">' + r + '등</div>' +
            '<div class="rank-vote-bars">' + barsHtml + '</div>';
        (function(rankVal) {
            box.addEventListener('click', function() {
                if (!readyUsers.includes(currentUser)) {
                    // 이 박스는 룰렛 구간에 래퍼를 따라 작은 창으로 이식된다 — 그 안에서 누른 경고를
                    // 메인 문서에 띄우면 사용자에겐 무반응으로 보인다.
                    if (racePipAttached()) {
                        showTrackToast('먼저 준비를 해주세요!');
                    } else if (typeof showCustomAlert === 'function') {
                        showCustomAlert('먼저 준비를 해주세요!', 'warning');
                    }
                    return;
                }
                socket.emit('voteRank', { rank: rankVal });
            });
        })(r);
        boxesEl.appendChild(box);
    }

    // 안내 메시지: 출전 말 수는 선택이 끝나야 확정되므로, 마릿수에 의존하지 않는 상시 참 규칙으로 표시
    var warnEl = anyDocGetById('rankVoteWarn'); // section과 같은 이식 대상
    if (warnEl) {
        if (forceShow) {
            // 룰렛 시각화 단계 — 투표가 끝났으므로 규칙 안내 숨김
            warnEl.style.display = 'none';
        } else {
            warnEl.textContent = '🐎 선택된 말 수보다 높은 등수에 던진 표는 사라져요.';
            warnEl.style.display = 'block';
        }
    }
}

function escapeHtmlText(str) {
    return String(str).replace(/[&<>"']/g, function(c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
}
function escapeHtmlAttr(str) {
    return escapeHtmlText(str);
}

// 결과 연출 UI를 경주 캔버스(raceTrackWrapper) 위 가운데 오버레이
// 의도: 게임 관련 UI는 항상 캔버스 위에 떠 있게 — 투표 입력은 위, 결과 연출은 캔버스 위
var _resultUiFadeTimeout = null;

function moveResultUiToCanvas() {
    // 개정3: 래퍼 앵커는 raceDoc() — attach 상태면 룰렛/투표 UI가 래퍼를 따라 PiP로 이식된다
    // (Document PiP는 실제 창이라 그 안에서 클릭 가능). placeholder는 아래에서 메인 문서에 남는다.
    var wrapper = raceDoc().getElementById('raceTrackWrapper');
    var gameStatus = document.getElementById('gameStatus');
    if (!wrapper || !wrapper.parentNode || !gameStatus) return;

    if (_resultUiFadeTimeout) {
        clearTimeout(_resultUiFadeTimeout);
        _resultUiFadeTimeout = null;
    }

    // 배너용 컨테이너 (캔버스 위쪽 빈 공간에 인라인 배치) — 이식 가능 요소라 anyDoc 조회
    var center = anyDocGetById('canvasResultCenter');
    if (!center) {
        center = document.createElement('div');
        center.id = 'canvasResultCenter';
        center.className = 'canvas-result-center';
    }
    center.classList.remove('fading-out');
    center.style.opacity = '';
    // 앵커를 래퍼의 실제 부모로 — attach 상태면 스케일 루트 안(래퍼 형제)으로 들어가 함께 스케일된다
    if (center.parentNode !== wrapper.parentNode || center.nextSibling !== wrapper) {
        wrapper.parentNode.insertBefore(center, wrapper);
    }

    // 투표 섹션용 오버레이 컨테이너 (캔버스 내부 중앙 absolute)
    var barsOverlay = anyDocGetById('canvasBarsOverlay');
    if (!barsOverlay) {
        barsOverlay = document.createElement('div');
        barsOverlay.id = 'canvasBarsOverlay';
        barsOverlay.className = 'canvas-bars-overlay';
    }
    barsOverlay.classList.remove('fading-out');
    if (!wrapper.contains(barsOverlay)) wrapper.appendChild(barsOverlay);

    var banner = anyDocGetById('targetRankBanner');
    var reasonEl = anyDocGetById('targetRankReason');
    var voteSection = anyDocGetById('rankVoteSection');

    // 배너 → 캔버스 위쪽 컨테이너
    if (banner && !banner._canvasPlaceholder) {
        var ph1 = document.createComment('targetRankBanner-placeholder');
        if (banner.parentNode) banner.parentNode.insertBefore(ph1, banner);
        banner._canvasPlaceholder = ph1;
        banner.classList.add('on-canvas');
        center.appendChild(banner);
    } else if (banner && banner._canvasPlaceholder) {
        center.appendChild(banner);
    }

    // 결정 사유 텍스트 → 캔버스 정중앙 오버레이 (막대 투표 섹션과 같은 위치)
    if (reasonEl && !reasonEl._canvasPlaceholder) {
        var phReason = document.createComment('targetRankReason-placeholder');
        if (reasonEl.parentNode) reasonEl.parentNode.insertBefore(phReason, reasonEl);
        reasonEl._canvasPlaceholder = phReason;
        reasonEl.classList.add('on-canvas');
        barsOverlay.appendChild(reasonEl);
    } else if (reasonEl && reasonEl._canvasPlaceholder) {
        barsOverlay.appendChild(reasonEl);
    }

    // 투표 섹션 → 캔버스 내부 중앙 오버레이
    if (voteSection && !voteSection._canvasPlaceholder) {
        var ph2 = document.createComment('rankVoteSection-placeholder');
        if (voteSection.parentNode) voteSection.parentNode.insertBefore(ph2, voteSection);
        voteSection._canvasPlaceholder = ph2;
        voteSection.classList.add('on-canvas');
        barsOverlay.appendChild(voteSection);
    } else if (voteSection && voteSection._canvasPlaceholder) {
        barsOverlay.appendChild(voteSection);
    }
}

// barsOverlay만 페이드 아웃 (배너는 캔버스 위 컨테이너에 잔존)
// 카운트다운 시작 시 호출 — reason/막대를 화면에서 비워서 "3,2,1" 시작 자리 확보
function fadeBarsOverlayOnly() {
    // 이식 가능 요소들 — 래퍼를 따라 PiP에 있을 수 있어 anyDoc 조회 (placeholder 복원은 메인 기준 그대로)
    var barsOverlay = anyDocGetById('canvasBarsOverlay');
    var voteSection = anyDocGetById('rankVoteSection');
    var reasonEl = anyDocGetById('targetRankReason');
    if (!barsOverlay && !voteSection?._canvasPlaceholder && !reasonEl?._canvasPlaceholder) return;
    if (barsOverlay) barsOverlay.classList.add('fading-out');
    setTimeout(function() {
        if (voteSection && voteSection._canvasPlaceholder) {
            voteSection.classList.remove('on-canvas');
            var ph = voteSection._canvasPlaceholder;
            if (ph.parentNode) ph.parentNode.insertBefore(voteSection, ph);
            ph.remove();
            voteSection._canvasPlaceholder = null;
        }
        if (reasonEl && reasonEl._canvasPlaceholder) {
            reasonEl.classList.remove('on-canvas');
            var ph2 = reasonEl._canvasPlaceholder;
            if (ph2.parentNode) ph2.parentNode.insertBefore(reasonEl, ph2);
            ph2.remove();
            reasonEl._canvasPlaceholder = null;
            reasonEl.style.display = 'none';
        }
        if (barsOverlay) {
            barsOverlay.classList.remove('fading-out');
            if (barsOverlay.parentNode) barsOverlay.parentNode.removeChild(barsOverlay);
        }
    }, 500);
}

function moveResultUiOffCanvas() {
    // 이식 가능 요소들 — 래퍼를 따라 PiP에 있을 수 있어 anyDoc 조회. 복원처(placeholder)는 메인 문서.
    var center = anyDocGetById('canvasResultCenter');
    var barsOverlay = anyDocGetById('canvasBarsOverlay');
    var banner = anyDocGetById('targetRankBanner');
    var reasonEl = anyDocGetById('targetRankReason');
    var voteSection = anyDocGetById('rankVoteSection');

    var anyOnCanvas = (banner && banner._canvasPlaceholder) || (voteSection && voteSection._canvasPlaceholder) || (reasonEl && reasonEl._canvasPlaceholder);
    if (!anyOnCanvas) return;

    // fade-out 시작 (양쪽 컨테이너)
    if (center) center.classList.add('fading-out');
    if (barsOverlay) barsOverlay.classList.add('fading-out');

    if (_resultUiFadeTimeout) {
        clearTimeout(_resultUiFadeTimeout);
    }
    _resultUiFadeTimeout = setTimeout(function() {
        _resultUiFadeTimeout = null;
        if (banner && banner._canvasPlaceholder) {
            banner.classList.remove('on-canvas');
            var ph = banner._canvasPlaceholder;
            if (ph.parentNode) ph.parentNode.insertBefore(banner, ph);
            ph.remove();
            banner._canvasPlaceholder = null;
        }
        if (reasonEl && reasonEl._canvasPlaceholder) {
            reasonEl.classList.remove('on-canvas');
            var phR = reasonEl._canvasPlaceholder;
            if (phR.parentNode) phR.parentNode.insertBefore(reasonEl, phR);
            phR.remove();
            reasonEl._canvasPlaceholder = null;
            reasonEl.style.display = 'none';
        }
        if (voteSection && voteSection._canvasPlaceholder) {
            voteSection.classList.remove('on-canvas');
            var ph2 = voteSection._canvasPlaceholder;
            if (ph2.parentNode) ph2.parentNode.insertBefore(voteSection, ph2);
            ph2.remove();
            voteSection._canvasPlaceholder = null;
        }
        if (center) {
            center.classList.remove('fading-out');
            if (center.parentNode) center.parentNode.removeChild(center);
        }
        if (barsOverlay) {
            barsOverlay.classList.remove('fading-out');
            if (barsOverlay.parentNode) barsOverlay.parentNode.removeChild(barsOverlay);
        }
    }, 600);
}

// 타깃 등수 배너 + 결정 사유 토글
// reasonText: 문자열 명시 시에만 reason 표시. 안 넘기면 숨김 (게임 진행 중 중복 표시 방지)
function updateTargetRankBanner(targetRank, show, reasonText) {
    // 배너/사유는 이식 가능 요소 — 룰렛~레이스 동안 PiP(canvasResultCenter)에 있을 수 있다
    var banner = anyDocGetById('targetRankBanner');
    var numEl = anyDocGetById('targetRankBannerNum');
    var reasonEl = anyDocGetById('targetRankReason');
    if (!banner || !numEl) return;
    if (!show) {
        banner.style.display = 'none';
        if (reasonEl) reasonEl.style.display = 'none';
        return;
    }
    if (typeof targetRank === 'number' && targetRank >= 1) {
        numEl.textContent = String(targetRank);
        banner.querySelector('.trb-text').innerHTML = '<span id="targetRankBannerNum">' + targetRank + '</span>등을 찾아라!';
    } else {
        banner.querySelector('.trb-text').innerHTML = '<span id="targetRankBannerNum">꼴</span>등을 찾아라!';
    }
    banner.style.display = 'flex';
    if (reasonEl) {
        if (typeof reasonText === 'string' && reasonText.length > 0) {
            reasonEl.textContent = reasonText;
            reasonEl.style.display = 'block';
        } else {
            reasonEl.style.display = 'none';
        }
    }
}

// ─── N등 룰렛 애니메이션 (인라인 막대 하이라이트) ───
// 서버가 결정한 winningRank의 막대로 정확히 정지. 클라이언트는 시각화만.
function playRouletteAnimation(data) {
    if (!data) return;
    var winningRank = (typeof data.winningRank === 'number') ? data.winningRank : null;
    var animDurationMs = (typeof data.animDurationMs === 'number') ? data.animDurationMs : 5000;
    if (winningRank === null) return;

    // 옛 풀스크린 오버레이는 숨김 (인라인 표시로 전환)
    var overlay = document.getElementById('rouletteOverlay');
    if (overlay) {
        overlay.classList.remove('visible');
        overlay.style.display = 'none';
    }

    // 막대가 화면에 그려져 있는지 보장 (룰렛 시각화는 readyUsers/isRaceActive 무관하게 강제 표시)
    if (typeof renderRankVoteSection === 'function') renderRankVoteSection({ forceShow: true });

    // 개정3: 투표 섹션 요소 기준으로 조회 — 아래 moveResultUiToCanvas가 섹션을 PiP로 이식해도
    // 요소 참조는 문서 이동에 유효하므로 이후 막대 수집/타깃 조회가 어느 문서에서든 성립한다.
    var voteHost = anyDocGetById('rankVoteSection');

    // 룰렛 단계에서 불가능한 등수 disable — 실제 출주 마릿수보다 높은 등수는 invalid 표시
    // 서버가 horseRouletteStart payload로 보내는 runningHorseCount를 신뢰 (익명성 보호로 클라 글로벌은 본인 베팅만 가짐).
    // 서버 값이 없는 경우에만 클라 자체 계산을 fallback으로 사용.
    var runningHorseCount = (typeof data.runningHorseCount === 'number')
        ? data.runningHorseCount
        : new Set(Object.values(userHorseBets || {})).size;
    if (runningHorseCount > 0 && voteHost) {
        var rankBoxes = voteHost.querySelectorAll('.rank-vote-box[data-rank]');
        rankBoxes.forEach(function(box) {
            var rank = parseInt(box.getAttribute('data-rank'), 10);
            if (rank > runningHorseCount) {
                box.classList.add('invalid');
            }
        });
    }

    // 결과 연출 UI를 경주 캔버스 오버레이로 이동
    moveResultUiToCanvas();

    // DOM 순서대로 활성 막대만 수집 — invalid(비활성) 박스 막대는 표시만 하고 룰렛 순회에서 제외
    // (voteHost 요소 스코프 조회 — 위 이식 후 PiP 문서에 있어도 동작)
    var allBars = voteHost ? Array.prototype.slice.call(
        voteHost.querySelectorAll('.rank-vote-box:not(.invalid) .rank-vote-bar')
    ) : [];
    if (allBars.length === 0) return;

    // 타깃 = 우승 등수 박스의 첫 막대
    var targetBox = voteHost.querySelector('.rank-vote-box[data-rank="' + winningRank + '"]');
    if (!targetBox) return;
    var targetBar = targetBox.querySelector('.rank-vote-bar');
    if (!targetBar) return;
    var targetIdx = allBars.indexOf(targetBar);
    if (targetIdx < 0) return;

    // 서버가 단일 등수 확정(skipAnim) — 스핀 없이 즉시 당첨 막대 + 배너로 점프
    if (data.skipAnim) {
        allBars.forEach(function(b) { b.classList.remove('active', 'winner'); });
        targetBar.classList.add('winner');
        updateTargetRankBanner(winningRank, true, window._targetRankReason);
        return;
    }

    // 이전 상태 청소
    allBars.forEach(function(b) { b.classList.remove('active', 'winner'); });
    clearRouletteTick();

    // 총 스텝 = 전체 사이클 REPEAT 회 + 마지막 사이클에서 target까지
    var REPEAT = 4;
    var totalSteps = REPEAT * allBars.length + targetIdx + 1;

    // 각 스텝 가중치(ease-out) — 처음 빠르게, 끝 천천히 (쫄깃한 감속)
    var weights = [];
    for (var i = 0; i < totalSteps; i++) {
        var t = totalSteps > 1 ? (i / (totalSteps - 1)) : 1;
        // 시작 더 빠르게(지수 3.0) + 감속비 강화 (1x → 40x)
        var eased = 1 - Math.pow(1 - t, 3.0);
        weights.push(1 + eased * 40);
    }
    // 마지막 5스텝은 추가로 더 느리게 — 쫄깃하게 (점진적 부스트 1.6x→4.0x)
    var tailBoost = [1.6, 2.0, 2.5, 3.0, 4.0];
    for (var k = 0; k < tailBoost.length && (totalSteps - 1 - k) >= 0; k++) {
        weights[totalSteps - 1 - k] *= tailBoost[k];
    }
    // 마지막 step weight cap — 막대 수가 적을 때(예: REPEAT=4, allBars=1 → totalSteps=5)
    // 마지막 한 step이 전체 시간의 60%+ 차지해 "감속" 대신 "갑자기 정지"처럼 보이는 문제 방지.
    // 마지막 weight 비중을 30% 이하로 제한.
    var weightCapRatio = 0.30;
    var totalWeightBeforeCap = weights.reduce(function(a, b) { return a + b; }, 0);
    var otherWeightSum = totalWeightBeforeCap - weights[totalSteps - 1];
    var maxLastWeight = otherWeightSum * weightCapRatio / (1 - weightCapRatio);
    if (weights[totalSteps - 1] > maxLastWeight) {
        weights[totalSteps - 1] = maxLastWeight;
    }
    var totalWeight = weights.reduce(function(a, b) { return a + b; }, 0);
    var scale = animDurationMs / totalWeight;
    var stepDurations = weights.map(function(w) { return Math.max(20, w * scale); });

    var step = 0;
    var prevBar = null;
    // 예약은 항상 "지금 트랙이 있는 창"에 건다 — attach 중 메인 창에 걸면 다른 탭에서 1초 스로틀에
    // 걸려 5.5초 연출이 17초로 늘어지고, 서버가 8.5초 뒤 카운트다운을 쏘면 막대가 당첨에 도달하기 전에
    // 오버레이째 제거된다("작은 창에선 룰렛이 안 돈다").
    function scheduleRouletteTick(delay) {
        rouletteAnimWin = (racePipAttached() && window._racePipWin && !window._racePipWin.closed)
            ? window._racePipWin : window;
        rouletteAnimFrameId = rouletteAnimWin.setTimeout(tick, delay);
    }
    _rouletteReschedule = function () {
        scheduleRouletteTick(stepDurations[Math.min(step, stepDurations.length - 1)]);
    };
    function tick() {
        if (prevBar) prevBar.classList.remove('active');
        if (step >= totalSteps) {
            targetBar.classList.add('winner');
            // 결과 라벨 (배너 갱신)
            updateTargetRankBanner(winningRank, true, window._targetRankReason);
            rouletteAnimFrameId = null;
            _rouletteReschedule = null;
            return;
        }
        var idx = step % allBars.length;
        var bar = allBars[idx];
        bar.classList.add('active');
        prevBar = bar;
        scheduleRouletteTick(stepDurations[step]);
        step++;
    }
    tick();
}

// 경주 애니메이션 시작 (서버에서 받은 기믹 데이터 사용)
// 게임 종료 버튼 크기 계산 함수
function getEndButtonWidth() {
    const endButton = document.querySelector('.end-button');
    return endButton ? endButton.offsetWidth : 200;
}


// 거리 시스템 상수
var PIXELS_PER_METER = 10;
// 탈것별 시각적 너비는 ALL_VEHICLES[].visualWidth 참조 (JSON에서 로드)

function startRaceAnimation(horseRankings, speeds, serverGimmicks, onComplete, trackOptions) {
    // idle 애니메이션 정리
    if (window._idleAnimInterval) { clearInterval(window._idleAnimInterval); window._idleAnimInterval = null; }

    // 🔧 기존 경주 애니메이션 정리 (중복 호출 방지)
    if (window._raceAnimFrameId) {
        raceAnimWin().cancelAnimationFrame(window._raceAnimFrameId); // 예약한 창에서 취소 (PiP 이관 대응)
        window._raceAnimFrameId = null;
        console.log('[경주] 기존 animationFrame 정리됨');
    }
    if (window._raceRankingInterval) {
        clearInterval(window._raceRankingInterval);
        window._raceRankingInterval = null;
        console.log('[경주] 기존 rankingInterval 정리됨');
    }
    // 이전 경주의 visibility 일시정지 리스너 정리 (중단된 경주의 stale 리스너 → 중복 "경주 재개" 토스트 방지)
    if (window._raceVisHandler) {
        document.removeEventListener('visibilitychange', window._raceVisHandler);
        window._raceVisHandler = null;
    }
    // 레이스 세대(generation) 증가 — 이전 레이스 종료 시퀀스의 setTimeout tail(비석 4s + finishGame 200/600ms)은
    // rAF 취소로 못 죽이므로, 각 tail 재진입 지점에서 세대 불일치 시 중단시킨다.
    // (stale onComplete → raceAnimationComplete 조기 emit → 다음 라운드 pendingRaceResult 오소비 방지)
    window._raceGen = (window._raceGen || 0) + 1;
    const myRaceGen = window._raceGen;
    // 이전 경주의 순위 이펙트 정리
    clearFinishEffects();

    // 개정2: 카운트다운 시점 attach로 init이 래퍼가 PiP에 있는 상태에서 돌 수 있다 — doc-aware 캡처
    const track = raceDoc().getElementById('raceTrack');
    const trackContainer = raceDoc().getElementById('raceTrackContainer');
    
    if (!track || !trackContainer) {
        console.error('트랙 컨테이너를 찾을 수 없습니다');
        if (onComplete) onComplete();
        return 5000;
    }
    
    if (!horseRankings || horseRankings.length === 0) {
        console.error('말 순위 정보가 없습니다', horseRankings);
        if (onComplete) onComplete();
        return 5000;
    }

    trackContainer.style.display = 'block';
    const wrapper = raceDoc().getElementById('raceTrackWrapper');
    if (wrapper) wrapper.style.display = 'block';
    track.innerHTML = '';

    // 채팅 오버레이 활성화
    if (typeof window.showRaceChatOverlay === 'function') {
        window.showRaceChatOverlay();
    }

    // 이전 도착 이펙트 제거
    document.querySelectorAll('.finish-effect').forEach(el => el.remove());
    
    // 컨테이너 너비 (스크롤 영역의 뷰포트 크기)
    const trackWidth = trackContainer.offsetWidth || 700;
    // 서버에서 받은 트랙 거리(m) 기반 finishLine, 없으면 기존 방식
    const trackDistanceMeters = (trackOptions && trackOptions.trackDistanceMeters) || 500;
    const finishLine = trackDistanceMeters * PIXELS_PER_METER;


    // ========== 다시보기/Evolution 플래그 ==========
    const isReplay = (trackOptions && trackOptions.isReplay) || false;
    const evolutionTargets = (trackOptions && trackOptions.evolutionTargets) || [];
    const fakeEvolutionTargets = (trackOptions && trackOptions.fakeEvolutionTargets) || [];
    // 라이브 전용: horseRaceStarted 수신 시각 앵커 — 숨김 탭 setTimeout 스로틀로 startTime 원점이 밀리는 것 방지
    const startAnchor = (trackOptions && trackOptions.startAnchor) || null;
    // 알탭 복귀 catch-up 동기 루프 진행 중 플래그 — 물리 외 연출(사운드/카메라/중계/렌더) 억제 게이트
    let isCatchingUp = false;

    // ========== 날씨 시스템 초기화 ==========
    const speedSeeds = (trackOptions && trackOptions.speedSeeds) || null;
    const weatherSchedule = (trackOptions && trackOptions.weatherSchedule) || [];
    const weatherConfig = (trackOptions && trackOptions.weatherConfig) || {};
    let currentWeather = weatherSchedule.length > 0 ? weatherSchedule[0].weather : 'sunny';
    let lastWeatherChangeIndex = 0;

    // 날씨 오버레이 생성
    const weatherOverlay = document.createElement('div');
    weatherOverlay.className = 'weather-overlay';
    weatherOverlay.id = 'weatherOverlay';
    trackContainer.style.position = 'relative';
    trackContainer.appendChild(weatherOverlay);

    // 날씨 배너 생성
    const weatherBanner = document.createElement('div');
    weatherBanner.className = 'weather-banner';
    weatherBanner.id = 'weatherBanner';
    const weatherEmojis = { sunny: '☀️', rain: '🌧️', wind: '💨', fog: '🌫️' };
    const weatherNames = { sunny: '맑음', rain: '비', wind: '바람', fog: '안개' };
    weatherBanner.textContent = `${weatherEmojis[currentWeather]} ${weatherNames[currentWeather]}`;
    // sunny일 때는 배너 숨김
    if (currentWeather === 'sunny') {
        weatherBanner.style.display = 'none';
    }
    trackContainer.appendChild(weatherBanner);

    // 날씨 토스트 코멘트 (클라이언트 독립적 - 서버 동기화 X)
    const weatherComments = {
        rain: [
            "🌧️ 비가 내리기 시작합니다!",
            "🚤 보트가 신나하네요!",
            "🐰 토끼가 비를 싫어합니다...",
            "🚲 자전거 조심! 미끄러워요!",
            "🐢 거북이에겐 좋은 날씨네요~"
        ],
        wind: [
            "💨 바람이 불기 시작합니다!",
            "🦅 독수리가 날개를 펼칩니다!",
            "🚁 헬리콥터가 흔들리고 있어요!",
            "🚲 자전거가 힘들어합니다..."
        ],
        fog: [
            "🌫️ 안개가 끼기 시작합니다!",
            "👀 앞이 안 보여요!",
            "🚀 로켓은 안개 따위...",
            "🐦 새들이 방향을 잃었어요!"
        ],
        sunny: [
            "☀️ 날씨가 맑아졌습니다!",
            "🐰 토끼가 기뻐합니다!",
            "☀️ 달리기 좋은 날씨네요!"
        ]
    };

    // 날씨 효과 적용 함수
    function applyWeatherEffect(weather) {
        weatherOverlay.className = 'weather-overlay';
        if (weather === 'rain') {
            weatherOverlay.classList.add('weather-rain');
        } else if (weather === 'wind') {
            weatherOverlay.classList.add('weather-wind');
        } else if (weather === 'fog') {
            weatherOverlay.classList.add('weather-fog');
        }
        // sunny는 효과 없음 (기본)
    }

    // 날씨 토스트 표시 함수
    function showWeatherToast(weather) {
        // sunny일 때는 토스트 표시 안 함
        if (weather === 'sunny') return;
        const comments = weatherComments[weather] || [];
        if (comments.length === 0) return;
        const randomComment = comments[Math.floor(Math.random() * comments.length)];

        const toast = document.createElement('div');
        toast.className = 'weather-toast';
        toast.textContent = randomComment;
        trackContainer.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // 버프/디버프 표시 함수
    function showWeatherIndicators(horseStates, weather) {
        // sunny일 때는 인디케이터 표시 안 함
        if (weather === 'sunny') return;
        const vehicleModifiers = weatherConfig.vehicleModifiers || {};

        horseStates.forEach(state => {
            // 기존 indicator 제거
            const oldIndicator = state.horse.querySelector('.weather-indicator');
            if (oldIndicator) oldIndicator.remove();

            const vehicleId = selectedVehicleTypes && selectedVehicleTypes[state.horseIndex];
            if (!vehicleId) return;

            const mods = vehicleModifiers[vehicleId];
            if (!mods) return;

            const modifier = mods[weather] || 1;
            const buffThreshold = 1.08; // +8% 이상이면 버프
            const nerfThreshold = 0.92; // -8% 이하면 디버프

            if (modifier >= buffThreshold) {
                const indicator = document.createElement('div');
                indicator.className = 'weather-indicator weather-buff';
                indicator.textContent = '▲';
                state.horse.appendChild(indicator);
            } else if (modifier <= nerfThreshold) {
                const indicator = document.createElement('div');
                indicator.className = 'weather-indicator weather-nerf';
                indicator.textContent = '▼';
                state.horse.appendChild(indicator);
            }
        });
    }

    // 현재 날씨 가져오기 함수
    function getCurrentWeatherFromSchedule(progress) {
        let weather = 'sunny';
        for (let i = 0; i < weatherSchedule.length; i++) {
            if (progress >= weatherSchedule[i].progress) {
                weather = weatherSchedule[i].weather;
            } else {
                break;
            }
        }
        return weather;
    }

    // 초기 날씨 효과 적용
    applyWeatherEffect(currentWeather);

    // [필수6] 트랙 끝 버퍼 확대 → 결승선 가시성 확보
    const viewportBuffer = Math.max(trackContainer.offsetWidth / 2, 200);
    track.style.width = `${finishLine + viewportBuffer}px`;

    const horseCount = horseRankings.length;
    const wallHeight = 6; // 벽 높이
    // [필수3] 레인 높이 동적 계산 (350 하드코딩 → 실제 트랙 높이)
    const availableTrackHeight = (trackContainer.offsetHeight || 400) - 50;
    const laneHeight = Math.min(75, Math.floor((availableTrackHeight - wallHeight * (horseCount - 1)) / horseCount));
    const totalLaneHeight = laneHeight + wallHeight; // 레인 + 벽 높이
    
    console.log('경주 시작:', { horseRankings, speeds, trackWidth, finishLine, trackDistanceMeters });

    // 거리 마커 생성 (50m 간격)
    const markerInterval = 50; // 50m마다
    const distanceMarkers = [];
    for (let m = markerInterval; m < trackDistanceMeters; m += markerInterval) {
        const markerPx = m * PIXELS_PER_METER;
        const marker = document.createElement('div');
        marker.className = 'distance-marker';
        marker.style.cssText = `position: absolute; left: ${markerPx}px; top: 0; height: 100%; width: 1px; background: rgba(255,255,255,0.08); z-index: 1; pointer-events: none;`;
        const label = document.createElement('span');
        label.style.cssText = `position: absolute; top: -14px; left: -12px; font-size: 9px; color: rgba(255,255,255,0.75); white-space: nowrap;`;
        label.textContent = `${m}m`;
        marker.appendChild(label);
        track.appendChild(marker);
        distanceMarkers.push(marker);
    }

    // 각 말 생성 및 애니메이션 (모든 말을 먼저 생성)
    const horseElements = [];
    let maxDuration = 0;
    
    // 선택 화면에서 본 원래 순서 유지 (availableHorses 순서)
    // horseRankings는 순위 순서이므로, 원래 말 인덱스 순서로 매핑
    const originalHorseOrder = availableHorses.length > 0 ? availableHorses : 
                              (horseRankings.length > 0 ? [...new Set(horseRankings)].sort((a, b) => a - b) : []);
    
    console.log('[startRaceAnimation] 시작:', {
        horseRankings: horseRankings,
        selectedVehicleTypes: selectedVehicleTypes,
        availableHorses: availableHorses
    });
    
    // 말 선택 화면과 동일한 순서로 레인 배치 (availableHorses 순서)
    availableHorses.forEach((horseIndex, laneIndex) => {
        // 탈것 타입 가져오기: 선택 화면에서 본 원래 순서대로
        const vehicleId = selectedVehicleTypes && selectedVehicleTypes[horseIndex] 
            ? selectedVehicleTypes[horseIndex] 
            : (ALL_VEHICLES.length > 0 ? ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id : 'car');
        
        // 해당 말의 순위 찾기 (horseRankings에서 horseIndex의 위치)
        const rank = horseRankings.indexOf(horseIndex);
        
        console.log(`[startRaceAnimation] laneIndex ${laneIndex}: horseIndex=${horseIndex}, vehicleId=${vehicleId}, rank=${rank} (${rank === 0 ? '1등' : rank === 1 ? '2등' : rank === 2 ? '3등' : rank + 1 + '등'})`);
        
        const { lane, vehicleBg } = createLane({ vehicleId, topPx: laneIndex * totalLaneHeight, laneHeight, isRacing: true });

        if (laneIndex < horseCount - 1) {
            track.appendChild(createWall({ topPx: laneIndex * totalLaneHeight + laneHeight, wallHeight }));
        }

        // 각 레인별 결승선 추가 (배경과 함께 스크롤됨)
        const laneFinishLine = document.createElement('div');
        laneFinishLine.className = 'finish-line';
        laneFinishLine.style.cssText = `
            position: absolute;
            left: ${finishLine}px;
            top: 0;
            width: 6px;
            height: 100%;
        `;
        lane.appendChild(laneFinishLine);
        lane.finishLineElement = laneFinishLine;
        
        track.appendChild(lane);
        
        const horse = document.createElement('div');
        horse.className = 'horse idle';
        horse.id = `horse_${horseIndex}`;
        horse.style.cssText = `
            position: absolute;
            left: 10px;
            top: ${laneIndex * totalLaneHeight + 10}px;
            width: 80px;
            height: ${laneHeight - 10}px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: ${100 - laneIndex};
        `;
        
        // 선택한 모든 사용자 이름 표시 (중복 선택 가능)
        const selectedUsers = Object.entries(userHorseBets)
            .filter(([_, h]) => h === horseIndex)
            .map(([name, _]) => name);
        
        // 탈것 스프라이트 (2프레임 애니메이션)
        const vehicleContent = document.createElement('div');
        vehicleContent.className = 'vehicle-sprite';
        
        const frame1 = document.createElement('div');
        frame1.className = 'frame1';
        const frame2 = document.createElement('div');
        frame2.className = 'frame2';
        
        // 탈것별 SVG 생성 (idle 상태로 시작, 없으면 run)
        const vehicleSVGs = getVehicleSVG(vehicleId);
        const idleData = vehicleSVGs.idle || vehicleSVGs.run || vehicleSVGs;
        frame1.innerHTML = idleData.frame1 || vehicleSVGs.frame1;
        frame2.innerHTML = (idleData.frame2 || vehicleSVGs.frame2) || '';

        const activeLayer = document.createElement('div');
        activeLayer.className = 'vehicle-active-layer';
        activeLayer.appendChild(frame1);
        activeLayer.appendChild(frame2);

        vehicleContent.appendChild(activeLayer);

        horse.appendChild(vehicleContent);
        horse.dataset.vehicleId = vehicleId;
        horse.dataset.vehicleVariant = 'base';

        // 모든 말에 화살표 생성 (카메라 타겟에 따라 동적으로 표시)
        const arrow = document.createElement('div');
        arrow.className = 'camera-target-arrow';
        arrow.dataset.horseIndex = horseIndex;
        arrow.innerHTML = '▼';
        arrow.style.cssText = `
            position: absolute;
            top: -18px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 16px;
            color: var(--red-400);
            text-shadow: 0 0 4px rgba(233,69,96,0.6);
            animation: arrowBounce 0.8s ease-in-out infinite;
            pointer-events: none;
            z-index: 300;
            display: none;
        `;
        horse.style.overflow = 'visible';
        horse.appendChild(arrow);

        // 점프 기능 - 내 탈것 클릭 시 점프 애니메이션
        const isMyHorse = userHorseBets[currentUser] === horseIndex;
        if (isMyHorse) {
            horse.style.cursor = 'pointer';
            horse.addEventListener('click', () => {
                if (!isRaceActive) return;  // 경주 중일 때만
                if (horse.classList.contains('jumping')) return;  // 점프 중 방지

                horse.classList.add('jumping');
                setTimeout(() => horse.classList.remove('jumping'), 400);
            });
            // .my-horse 마커: 상점에서 장착 변경 시 내 말만 골라 갱신(타인 말 오염 방지)
            horse.classList.add('my-horse');
        }

        // 꾸미기 적용 — 외관만, 결과 무관.
        // 내 말 = 내 장착(서버 권위), 타인 말 = 서버 broadcast canonical(첫 선택자).
        if (window.HorseShop) {
            if (isMyHorse) {
                window.HorseShop.applyToHorse(horse);
            } else {
                // 타인/관전 말: 같은 말 고른 사람들의 꾸미기 배열. 클라가 랜덤으로 하나 골라 적용.
                // Math.random은 외형 선택 전용 — 게임 결과/시뮬과 무관(공정성 영향 0).
                var _list = (window._raceCosmetics && window._raceCosmetics.horses)
                    ? window._raceCosmetics.horses[horseIndex] : null;
                var _pick = Array.isArray(_list)
                    ? (_list.length ? _list[Math.floor(Math.random() * _list.length)] : null)
                    : _list; // 구버전 단일 객체 호환
                if (_pick) window.HorseShop.applyEquippedToHorse(horse, _pick);
            }
        }

        track.appendChild(horse);

        // 이름 라벨을 레인 왼쪽 상단에 표시
        if (selectedUsers.length > 0) {
            const namesContainer = document.createElement('div');
            namesContainer.className = 'names-container';
            namesContainer.style.cssText = `
                position: absolute;
                top: ${laneIndex * totalLaneHeight + 1}px;
                left: 3px;
                display: flex;
                flex-wrap: wrap;
                gap: 3px;
                z-index: 200;
                max-width: 250px;
            `;

            // 내 이름이 먼저 오도록 정렬
            const sortedUsers = [...selectedUsers].sort((a, b) => {
                if (a === currentUser) return -1;
                if (b === currentUser) return 1;
                return 0;
            });

            sortedUsers.forEach(userName => {
                const nameTag = document.createElement('span');
                const isMe = userName === currentUser;
                nameTag.classList.add('race-name-tag');
                nameTag.dataset.username = userName;

                if (isMe) {
                    // 내 탈것: 금색 배경 + 검은 글씨 + 테두리 + 큰 폰트
                    nameTag.style.cssText = ME_NAMETAG_CSS;
                    nameTag.textContent = '⭐ ' + userName;
                } else {
                    // 다른 사용자: 개선된 가독성
                    nameTag.style.cssText = `
                        background: rgba(0,0,0,0.75);
                        color: var(--bg-white);
                        padding: 2px 5px;
                        border-radius: 3px;
                        font-size: 10px;
                        line-height: 15px;
                        font-weight: bold;
                        white-space: nowrap;
                        border: 1px solid rgba(255,255,255,0.3);
                        text-shadow: 0 1px 2px rgba(0,0,0,0.8);
                    `;
                    nameTag.textContent = userName;
                }
                applyLabelCosmetic(nameTag, userName, isMe, true);
                namesContainer.appendChild(nameTag);
            });

            track.appendChild(namesContainer);
        }
        
        const duration = speeds[rank] || 5000;
        maxDuration = Math.max(maxDuration, duration);
        horseElements.push({ horse, vehicleContent, frames: [frame1, frame2], rank, duration, lane });
    });
    
    // 실시간 순위 패널 동적 생성
    let liveRankingPanel = document.getElementById('liveRankingPanel');
    if (!liveRankingPanel) {
        liveRankingPanel = document.createElement('div');
        liveRankingPanel.id = 'liveRankingPanel';
        liveRankingPanel.style.cssText = 'background: linear-gradient(135deg, var(--slate-950) 0%, var(--slate-960) 100%); color: white; padding: 12px 15px; border-radius: 10px; margin-top: 15px; font-size: 13px; font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;';
        const title = document.createElement('div');
        title.style.cssText = 'font-weight: bold; margin-bottom: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 8px; font-size: 14px; font-family: "Jua", "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;';
        title.textContent = '🏃 실시간 순위';
        liveRankingPanel.appendChild(title);
        const list = document.createElement('div');
        list.id = 'liveRankingList';
        liveRankingPanel.appendChild(list);
        const historySection = document.getElementById('historySection');
        if (historySection) historySection.appendChild(liveRankingPanel);
    }
    liveRankingPanel.style.display = 'block';
    const liveRankingList = document.getElementById('liveRankingList');
    
    // 탈것 정보 맵 생성 (horseIndex -> vehicleInfo)
    const vehicleInfoMap = {};
    availableHorses.forEach((horseIndex) => {
        const vehicleId = selectedVehicleTypes && selectedVehicleTypes[horseIndex] 
            ? selectedVehicleTypes[horseIndex] 
            : (ALL_VEHICLES.length > 0 ? ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id : 'car');
        const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId) || { name: '탈것', emoji: '🏃' };
        const bettingUsers = Object.entries(userHorseBets)
            .filter(([_, h]) => h === horseIndex)
            .map(([name, _]) => name);
        vehicleInfoMap[horseIndex] = { vehicleId, vehicle, bettingUsers };
    });
    
    // 실시간 순위 업데이트 함수
    const startPosition = 10; // 시작 위치
    const totalDistance = finishLine - startPosition; // 전체 거리
    // 모바일: 카메라 타겟을 화면 왼쪽 20%에 위치 → 오른쪽에 80% 시야 확보 (결승선 우측 배치)
    // PC: 기존대로 50% 중앙
    const centerPosition = trackWidth < 500 ? trackWidth * 0.2 : trackWidth / 2;
    
    // 도착 순서 추적 객체
    const finishOrderMap = {};
    
    function updateLiveRanking(horseStatesRef) {
        const positions = [];
        horseElements.forEach(({ horse, rank }) => {
            const actualHorseIndex = parseInt(horse.id.replace('horse_', ''));
            // 실제 위치(currentPos)를 사용 (화면 표시 위치가 아닌 진행 위치)
            const state = horseStatesRef ? horseStatesRef.find(s => s.horseIndex === actualHorseIndex) : null;
            const actualPos = state ? state.currentPos : (parseFloat(horse.style.left) || startPosition);
            const progress = Math.min(100, Math.max(0, ((actualPos - startPosition) / totalDistance) * 100));
            const remainingMeters = Math.max(0, Math.round((totalDistance - (actualPos - startPosition)) / PIXELS_PER_METER));
            const remaining = Math.max(0, 100 - progress);
            
            // 도착 순서 가져오기 (horseStates에서)
            let finishOrder = -1;
            let isFinished = false;
            if (horseStatesRef) {
                const state = horseStatesRef.find(s => s.horseIndex === actualHorseIndex);
                if (state && state.finished) {
                    isFinished = true;
                    finishOrder = state.finishOrder;
                    finishOrderMap[actualHorseIndex] = finishOrder;
                }
            }
            // 이미 기록된 도착 순서 사용
            if (finishOrderMap[actualHorseIndex] !== undefined) {
                isFinished = true;
                finishOrder = finishOrderMap[actualHorseIndex];
            }
            
            positions.push({ horseIndex: actualHorseIndex, position: actualPos, progress, remaining, remainingMeters, isFinished, finishOrder });
        });
        
        // 정렬: 도착한 말은 도착 순서대로, 나머지는 위치 순
        positions.sort((a, b) => {
            // 둘 다 도착한 경우 도착 순서로
            if (a.isFinished && b.isFinished) {
                return a.finishOrder - b.finishOrder;
            }
            // 하나만 도착한 경우 도착한 쪽이 앞
            if (a.isFinished) return -1;
            if (b.isFinished) return 1;
            // 둘 다 미도착시 위치 순
            return b.position - a.position;
        });
        
        // 순위 표시 업데이트
        if (liveRankingList) {
            let html = '';
            positions.forEach((pos, idx) => {
                const info = vehicleInfoMap[pos.horseIndex];
                if (info) {
                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
                    const users = info.bettingUsers.length > 0 ? info.bettingUsers.join(',') : '-';
                    const remainingText = pos.remaining <= 0 ? '🏁' : `${pos.remainingMeters}m`;
                    const progressColor = pos.remaining <= 0 ? 'var(--green-400)' : pos.remaining < 30 ? 'var(--yellow-400)' : 'var(--gray-400)';
                    html += `<div style="display: flex; align-items: center; gap: 4px; margin: 4px 0; ${idx === 0 ? 'color: var(--yellow-500); font-weight: bold;' : ''}">
                        <span style="width: 20px; font-size: 12px;">${medal}</span>
                        <span style="font-size: 14px;">${info.vehicle.emoji}</span>
                        <span style="flex: 1; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${users}</span>
                        <span style="font-size: 10px; color: ${progressColor}; min-width: 32px; text-align: right;">${remainingText}</span>
                    </div>`;
                }
            });
            liveRankingList.innerHTML = html;
        }
    }
    
    // 미니맵 초기화 및 표시 (개정2: attach 상태 init 대응 — doc-aware)
    const minimapEl = raceDoc().getElementById('raceMinimap');
    if (minimapEl) minimapEl.style.display = 'block';

    // 미니맵에 사용할 색상 팔레트
    const minimapColors = ['#ffd700', '#c0c0c0', '#cd7f32', '#ff6b6b', '#4ecdc4', '#a29bfe', '#fd79a8', '#00cec9', '#e17055', '#636e72'];

    function updateMinimap(horseStatesRef, startPos, totalDist, finishLinePx, trackMeters, vInfoMap) {
        // 매 프레임 조회 — 래퍼가 PiP 문서로 이동해 있으면 그쪽에서 찾는다
        const minimapTrack = raceDoc().getElementById('minimapTrack');
        const minimapMarkers = raceDoc().getElementById('minimapMarkers');
        const minimapDots = raceDoc().getElementById('minimapDots');
        if (!minimapTrack) return;

        const trackW = minimapTrack.offsetWidth;

        // 거리 마커 생성 (100m 간격, 200m 이하부턴 50m 간격)
        let markersHtml = '';
        let ticksHtml = '';
        const markers = [];
        for (let m = 0; m <= trackMeters; m += 100) {
            if (m === 0) continue;
            markers.push(m);
        }
        // 200m 이하 구간에 50m 단위 추가
        const lastStretch = Math.min(trackMeters, 200);
        for (let m = 50; m < lastStretch; m += 100) {
            const absM = trackMeters - lastStretch + m;
            if (absM > 0 && absM < trackMeters && !markers.includes(absM)) {
                markers.push(absM);
            }
        }
        // 마지막 200m 구간의 50m 마커
        for (let m = trackMeters - 200 + 50; m < trackMeters; m += 50) {
            if (m > 0 && !markers.includes(m) && m % 100 !== 0) {
                markers.push(m);
            }
        }
        markers.sort((a, b) => a - b);

        markers.forEach(m => {
            const pct = (m / trackMeters) * 100;
            const isMajor = m % 100 === 0;
            const remaining = trackMeters - m;
            ticksHtml += `<div style="position: absolute; left: ${pct}%; top: 0; width: 1px; height: 6px; background: rgba(255,255,255,${isMajor ? '0.4' : '0.2'}); transform: translateX(-50%);"></div>`;
            markersHtml += `<div style="position: absolute; left: ${pct}%; transform: translateX(-50%); font-size: 7px; color: rgba(255,255,255,${isMajor ? '0.75' : '0.6'}); white-space: nowrap;">${remaining}m</div>`;
        });
        // 결승선 마커
        ticksHtml += `<div style="position: absolute; right: 0; top: 0; width: 2px; height: 6px; background: var(--green-400);"></div>`;

        minimapTrack.innerHTML = ticksHtml;
        minimapMarkers.innerHTML = markersHtml;

        // 말 위치 점 + 범례
        let dotsHtml = '';
        // 정렬: 위치 순
        const sorted = [...horseStatesRef].sort((a, b) => b.currentPos - a.currentPos);
        sorted.forEach((state, idx) => {
            const progress = Math.min(1, Math.max(0, (state.currentPos - startPos) / totalDist));
            const leftPct = progress * 100;
            const color = minimapColors[state.horseIndex % minimapColors.length];
            const info = vInfoMap[state.horseIndex];
            const emoji = info ? info.vehicle.emoji : '🏃';

            // 트랙 위의 점
            const isMyBet = userHorseBets[currentUser] === state.horseIndex;
            const arrow = isMyBet ? `<div style="position: absolute; left: 50%; top: -8px; transform: translateX(-50%); font-size: 6px; color: var(--yellow-500); line-height: 1;">▼</div>` : '';
            minimapTrack.innerHTML += `<div style="position: absolute; left: ${leftPct}%; top: 50%; transform: translate(-50%, -50%) scaleX(-1); font-size: 10px; line-height: 1; z-index: ${isMyBet ? 100 : 10 + idx}; filter: ${isMyBet ? 'drop-shadow(0 0 3px var(--yellow-500))' : 'none'};">${arrow}${emoji}</div>`;
        });

        minimapDots.style.display = 'none';
    }

    // 실시간 순위 업데이트 인터벌
    let rankingInterval = null;
    let animationFrameId = null;
    let currentScrollOffset = 0; // 현재 스크롤 오프셋
    let cameraMode = 'leader'; // 'leader' | 'myHorse'

    // 1등 결승 후 꼴등으로 부드러운 패닝 (updateCameraBtnUI보다 먼저 선언)
    let panningToLoser = false;
    let panStartTime = 0;
    let panStartOffset = 0;
    let panTargetOffset = 0;
    const PAN_DURATION = 2500;
    let loserCameraTarget = null;
    let cameraModeBefore = null;

    // 랜덤 카메라 컷어웨이 관련 변수
    let leaderFocusStartTime = null;           // 1등 카메라 고정 시작 시간
    let isRandomCutaway = false;               // 랜덤 컷어웨이 중인지
    let randomCutawayStartTime = null;         // 컷어웨이 시작 시간
    let randomCutawayTarget = null;            // 컷어웨이 대상 말 상태
    let cutawayDisabled = false;               // 50m 진입 시 완전 비활성화 플래그

    // Evolution 카메라 컷어웨이
    let isEvolutionCutaway = false;
    let evolutionCutawayTarget = null;

    // 컷어웨이 상수
    const LEADER_FOCUS_DURATION = 6000;        // 1등 고정 시간 (6초 — 랜덤 컷어웨이는 저빈도 fallback)
    const CUTAWAY_DURATION_DEFAULT = 3000;     // 기본 컷어웨이 시간 (3초)
    const CUTAWAY_DURATION_CLOSE = 1500;       // 접전 시 컷어웨이 (1.5초)
    const CUTAWAY_DURATION_RUNAWAY = 4000;     // 단독 질주 시 컷어웨이 (4초)
    const FINISH_LOCK_DISTANCE_M = 50;         // 결승선 강제 복귀 거리 (50m)

    // 이벤트 컷어웨이 (기믹 발동 순간포착 — goal: horse-race-event-camera)
    let activeEventCut = null;   // { gimmick, state, priority, startWall, label, maxHoldMs }
    let lastEventCutEnd = 0;     // 이벤트 컷 종료 시각 (쿨다운 기준)
    const EVENT_CUT_CONFIG = {
        item_rocket:   { priority: 80, label: '🚀 로켓 발사',   maxHoldMs: 3000 },
        reverse_boost: { priority: 70, label: '🔥 맹추격',      maxHoldMs: 3000 },
        sprint:        { priority: 60, label: '💨 스퍼트',      maxHoldMs: 2500 },
        item_trap:     { priority: 50, label: '🍌 함정에 빠짐', maxHoldMs: 2500 }
    };
    const EVENT_CUT_COOLDOWN = 2000; // 이벤트 컷 종료 후 다음 컷까지 최소 간격

    // 경기 상황 분석 → 컷어웨이 시간 결정
    function getCutawayDuration(horseStates, finishLine) {
        const sorted = [...horseStates].filter(s => !s.finished)
            .sort((a, b) => b.currentPos - a.currentPos);
        if (sorted.length < 2) return CUTAWAY_DURATION_DEFAULT;
        const gap1st2nd = sorted[0].currentPos - sorted[1].currentPos;
        const progress = sorted[0].currentPos / finishLine;
        // 접전: 1-2등 격차 100px 미만이고 진행률 30% 이상
        if (gap1st2nd < 100 && progress > 0.3) return CUTAWAY_DURATION_CLOSE;
        // 단독 질주: 1등이 300px 이상 앞서감
        if (gap1st2nd > 300) return CUTAWAY_DURATION_RUNAWAY;
        return CUTAWAY_DURATION_DEFAULT;
    }

    // 가중치 기반 컷어웨이 타겟 선택 (순위 높을수록 자주 보여줌)
    function selectRandomCutawayTarget(horseStates, leaderIndex) {
        const bettedSet = new Set(Object.values(userHorseBets));
        const candidates = horseStates.filter(s =>
            s.horseIndex !== leaderIndex && !s.finished && (bettedSet.size === 0 || bettedSet.has(s.horseIndex))
        );
        if (candidates.length === 0) return null;
        // 순위별 가중치 (2위=30, 3위=25, 4위=20, 하위=15)
        const sorted = [...candidates].sort((a, b) => b.currentPos - a.currentPos);
        const weights = [30, 25, 20, 15, 10];
        let totalWeight = 0;
        const weightedCandidates = sorted.map((c, i) => {
            const w = weights[Math.min(i, weights.length - 1)];
            totalWeight += w;
            return { state: c, weight: w };
        });
        let roll = Math.random() * totalWeight;
        for (const wc of weightedCandidates) {
            roll -= wc.weight;
            if (roll <= 0) return wc.state;
        }
        return sorted[0];
    }

    // 이벤트 컷 시작 판정 (기믹 트리거 순간 호출 — goal: horse-race-event-camera)
    // 오버레이/사운드를 직접 호출하지 않는다 — updateCameraBtnUI가 renderFrame에서만 돌아 catch-up 중 자동 억제됨.
    function maybeStartEventCut(gimmick, state) {
        const config = EVENT_CUT_CONFIG[gimmick.type];
        if (!config) return;
        if (isEvolutionCutaway) return; // evolution 컷어웨이 최우선
        if (state.finished) return;
        if (activeEventCut) {
            // 진행 중 컷은 strictly higher priority만 교체 (큐 없음)
            if (config.priority <= activeEventCut.priority) return;
        } else if (Date.now() - lastEventCutEnd < EVENT_CUT_COOLDOWN) {
            return;
        }
        activeEventCut = {
            gimmick: gimmick,
            state: state,
            priority: config.priority,
            startWall: Date.now(),
            label: config.label,
            maxHoldMs: config.maxHoldMs
        };
        // 진행 중인 랜덤 컷어웨이 취소 (이벤트 컷 우선)
        isRandomCutaway = false;
        randomCutawayTarget = null;
    }

    // 카메라 모드 오버레이 표시 함수
    let cameraModeOverlay = null;
    let cameraModeOverlayTimer = null;
    function showCameraModeOverlay(text, color) {
        const trackContainer = raceDoc().getElementById('raceTrackContainer'); // 경주 중 호출 — PiP 문서 대응
        if (!trackContainer) return;
        if (!cameraModeOverlay) {
            cameraModeOverlay = document.createElement('div');
            cameraModeOverlay.style.cssText = `
                position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
                padding: 4px 14px; border-radius: 12px; font-size: 12px;
                font-family: 'Jua', sans-serif; color: var(--bg-white); pointer-events: none;
                z-index: 50; transition: opacity 0.5s; opacity: 0;
            `;
            trackContainer.style.position = 'relative';
            trackContainer.appendChild(cameraModeOverlay);
        }
        cameraModeOverlay.textContent = text;
        cameraModeOverlay.style.background = color;
        cameraModeOverlay.style.opacity = '1';
        if (cameraModeOverlayTimer) clearTimeout(cameraModeOverlayTimer);
        cameraModeOverlayTimer = setTimeout(() => {
            if (cameraModeOverlay) cameraModeOverlay.style.opacity = '0';
        }, 2000);
    }

    // 카메라 버튼 UI 동기화 함수 (루프 내에서도 호출) — 개정2: attach 상태 init 대응 doc-aware 캡처
    const cameraSwitchBtn = raceDoc().getElementById('cameraSwitchBtn');
    let prevCameraMode = null;
    function updateCameraBtnUI() {
        if (!cameraSwitchBtn) return;
        let label, bg;
        if (cameraMode === 'myHorse') {
            label = '📷 내 말 보는중';
            bg = 'rgba(255,215,0,0.3)';
        } else if (cameraMode === '_loser' || panningToLoser) {
            // N등 투표 결과(window._targetRank)에 따라 라벨 동적 표시
            const _tr = window._targetRank;
            const _trLabel = (typeof _tr === 'number' && _tr >= 1) ? (_tr + '등') : '꼴등';
            label = '📷 ' + _trLabel + ' 추적중';
            bg = 'rgba(233,69,96,0.4)';
        } else if (activeEventCut) {
            label = '📷 ' + activeEventCut.label;
            bg = 'rgba(255,140,0,0.45)';
        } else if (isRandomCutaway) {
            label = '📷 다른말 구경중';
            bg = 'rgba(100,200,255,0.4)';
        } else {
            label = '📷 시스템 카메라';
            bg = 'rgba(0,0,0,0.6)';
        }
        cameraSwitchBtn.textContent = label;
        cameraSwitchBtn.style.background = bg;
        // 모드 변경 시 오버레이 표시
        const currentMode = cameraMode + (isRandomCutaway ? '_cutaway' : '') + (panningToLoser ? '_panning' : '') + (activeEventCut && cameraMode === 'leader' && !panningToLoser ? '_event_' + activeEventCut.gimmick.type : '');
        if (prevCameraMode !== null && prevCameraMode !== currentMode) {
            showCameraModeOverlay(label.replace('📷 ', ''), bg);
        }
        prevCameraMode = currentMode;
    }
    if (cameraSwitchBtn) {
        if (userHorseBets[currentUser] !== undefined) {
            cameraSwitchBtn.style.display = 'block';
            cameraSwitchBtn.textContent = '📷 시스템 카메라';
            cameraSwitchBtn.style.transition = 'transform 0.15s ease';
            cameraSwitchBtn.onclick = () => {
                panningToLoser = false;
                if (cameraMode === '_loser') {
                    cameraMode = cameraModeBefore || 'leader';
                    cameraModeBefore = null;
                    loserCameraTarget = null;
                    loserReleaseTarget = null;
                }
                cameraMode = cameraMode === 'leader' ? 'myHorse' : 'leader';
                // 바운스 효과
                cameraSwitchBtn.style.transform = 'scale(1.1)';
                setTimeout(() => { cameraSwitchBtn.style.transform = 'scale(1)'; }, 150);
                updateCameraBtnUI();
            };
        } else {
            cameraSwitchBtn.style.display = 'none';
        }
    }
    
    // 각 탈것의 애니메이션 상태 (서버에서 받은 기믹 데이터 사용)
    const horseStates = horseElements.map(({ horse, frames, duration, rank, lane }) => {
        const horseIndex = parseInt(horse.id.replace('horse_', ''));

        // 탈것별 시각적 너비 가져오기
        const vehicleId = selectedVehicleTypes && selectedVehicleTypes[horseIndex]
            ? selectedVehicleTypes[horseIndex]
            : (ALL_VEHICLES.length > 0 ? ALL_VEHICLES[horseIndex % ALL_VEHICLES.length].id : 'car');
        const vehicleData = ALL_VEHICLES.find(v => v.id === vehicleId);
        const visualWidth = vehicleData ? vehicleData.visualWidth : 60;

        // 서버에서 받은 기믹 데이터 사용 (없으면 빈 배열)
        const serverGimmickList = serverGimmicks && serverGimmicks[horseIndex] ? serverGimmicks[horseIndex] : [];
        const gimmicks = serverGimmickList.map(g => ({
            progressTrigger: g.progressTrigger,
            type: g.type,
            duration: g.duration,
            speedMultiplier: g.speedMultiplier,
            nextGimmick: g.nextGimmick || null,
            triggered: false,
            active: false,
            endTime: 0
        }));

        // 기본 속도 계산 (duration 기반)
        const baseSpeed = totalDistance / duration;

        // 초기 속도 변화를 위한 시드 (서버에서 받은 값 우선, 폴백: 기존 horseIndex 기반)
        const serverSeed = speedSeeds && speedSeeds[horseIndex];
        const initialSpeedFactor = serverSeed ? serverSeed.initialFactor : (0.8 + ((horseIndex * 1234567) % 100) / 250);

        return {
            horse,
            frames,
            duration,
            rank,
            horseIndex,
            lane,
            currentPos: startPosition,
            baseSpeed,
            currentSpeed: baseSpeed * initialSpeedFactor,
            targetSpeed: baseSpeed,
            finishJudged: false, // 도착 판정 완료 (오른쪽 끝이 결승선 통과)
            finished: false, // 완전 정지 (왼쪽 끝이 결승선 통과)
            gimmicks,
            wobblePhase: 0,
            lastSpeedChange: 0,
            speedChangeSeed: serverSeed ? serverSeed.changeSeed : (horseIndex * 9876), // 속도 변화 시드
            simElapsed: 0, // 서버와 동기화용 고정 16ms 스텝 elapsed
            visualWidth // 탈것별 시각적 너비
        };
    });

    function getEvolutionCommentarySubject(horseIndex) {
        const info = vehicleInfoMap[horseIndex];
        const vehicleName = info && info.vehicle && info.vehicle.name ? info.vehicle.name : '탈것';
        const users = info && Array.isArray(info.bettingUsers) ? info.bettingUsers.filter(Boolean) : [];

        if (users.length === 1) return `${users[0]}의 ${vehicleName}`;
        if (users.length === 2) return `${users[0]}·${users[1]}의 ${vehicleName}`;
        if (users.length > 2) return `${users[0]} 외 ${users.length - 1}명의 ${vehicleName}`;
        return vehicleName;
    }

    function announceEvolutionStage(stage, state, holdMs) {
        if (isReplay || isCatchingUp || typeof announceEvolutionCommentary !== 'function' || !state) return;
        announceEvolutionCommentary(stage, getEvolutionCommentarySubject(state.horseIndex), holdMs);
    }

    function maybeAnnounceEvolutionLead(horseStatesRef) {
        if (isReplay || isCatchingUp || typeof announceEvolutionCommentary !== 'function') return;

        const currentLeader = horseStatesRef
            .filter(s => !s.finishJudged)
            .sort((a, b) => b.currentPos - a.currentPos)[0];

        if (!currentLeader || !currentLeader._evolutionBoostUsed || currentLeader._evolutionLeadAnnounced) return;
        if (currentLeader._evolutionLeadEligibleAt && Date.now() < currentLeader._evolutionLeadEligibleAt) return;

        currentLeader._evolutionLeadAnnounced = true;
        announceEvolutionStage('evolutionLead', currentLeader, 3200);
    }

    // 모든 탈것 동시에 애니메이션 시작
    setTimeout(() => {
        if (myRaceGen !== window._raceGen) return; // 시작 전 무효화됨 (리셋/새 라운드) — 죽은 레이스의 rAF 기동 방지
        // startTime 원점: 라이브는 horseRaceStarted 수신 앵커 + 500ms — 숨김 탭에서 이 setTimeout이
        // 스로틀로 늦게 발화해도 "라이브 진행 지점"의 기준이 밀리지 않는다. (다시보기는 기존대로 지금 시각)
        let startTime = startAnchor ? startAnchor + 500 : Date.now();
        let lastFrameTime = Date.now();
        // 숨김 탭이면 일시정지 게이트로 대기 — 복귀 시 onVisChange가 시뮬 커서(simulatedUpTo)부터
        // 라이브 진행 지점까지 고정 16ms 스텝으로 따라잡는다(catch-up).
        let pausedAt = document.hidden ? Date.now() : 0;
        let simulatedUpTo = 0;        // 시뮬레이션 커서 (마지막으로 stepRace가 처리한 elapsed)
        let raceEnded = false;        // 종료 블록 1회 실행 보장 + catch-up 동기 루프 즉시 탈출 신호
        let weatherVisualDirty = false; // catch-up 중 날씨 변화 발생 — reconcile에서 최종 비주얼 1회 적용
        let finishOrderCounter = 0; // 도착 순서 카운터
        const smConf = window._slowMotionConfig || { leader: { triggerDistanceM: 15, factor: 0.4 }, loser: { triggerDistanceM: 10, factor: 0.4 } };
        let slowMotionFactor = 1; // 1 = 정상속도
        let slowMotionActive = false;
        let slowMotionTriggered = false; // 한번만 트리거
        let loserSlowMotionTriggered = false; // 꼴등 결정 슬로우모션
        let loserSlowMotionActive = false;
        let loserReleaseTarget = null; // 해제 판정용 (카메라 추적과 분리)
        let leaderCheerFadeInterval = null; // 리더 슬로우 환호 페이드아웃 interval ID
        // loserCameraTarget, cameraModeBefore, 패닝 변수는 상위 스코프에서 선언됨

        // 테스트용: 콘솔에서 forceSlowMotion() 호출로 강제 발동
        window.forceSlowMotion = function() {
            slowMotionTriggered = true;
            slowMotionActive = true;
            slowMotionFactor = smConf.leader.factor;
            track.style.transition = 'filter 0.3s';
            track.style.filter = 'contrast(1.1) saturate(1.3)';
            console.log('[슬로우모션] 강제 발동!');
        };

        // 레이스 시작: idle → run 상태 전환
        horseStates.forEach(state => {
            if (state.horse && state.horse.dataset.vehicleId) {
                state.horse.classList.remove('idle');
                state.horse.classList.add('racing');
                setVehicleState(state.horse, state.horse.dataset.vehicleId, 'run');
            }
        });

        // 탭 전환 일시정지/재개 — 복귀 시 라이브는 진행 지점까지 따라잡기(catch-up), 다시보기는 pause-resume 유지
        function onVisChange() {
            if (myRaceGen !== window._raceGen) return; // 무효화된 레이스의 stale 리스너 (카운트다운→새 init 리스너 갭)
            if (!animationFrameId) return; // 경주 끝났으면 무시
            // 트랙이 PiP에 붙어 시청 중 — 메인 탭 숨김/복귀와 무관하게 경주 계속 (pausedAt 미세팅).
            // attach 판정 기준: 미attach(창 없음/attach 실패)면 기존 pause/catch-up 유지.
            // attach 중 pausedAt=0은 가정이 아니라 호출처의 racePipResumeIfPaused가 보장
            // (숨김 탭 init 포함) — 복귀 분기 스킵 무해. 재무장은 reattach의 rearmPause가 담당.
            if (racePipAttached()) return;
            if (document.hidden) {
                pausedAt = Date.now();
                return;
            }
            if (pausedAt === 0) return;
            if (isReplay) {
                // 다시보기: 동기화할 라이브 시점이 없음 — 멈춘 지점부터 재생 (기존 동작 유지)
                startTime += (Date.now() - pausedAt);
                lastFrameTime = Date.now();
                pausedAt = 0;
            } else {
                // 라이브: 숨김 구간을 즉시 시뮬레이션해 전원과 같은 진행 지점으로 점프
                pausedAt = 0;
                catchUpToLive();
            }
            // 재개 토스트
            const toast = document.createElement('div');
            toast.textContent = '▶ 경주 재개!';
            toast.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 9999; background: rgba(0,0,0,0.7); color: var(--green-400); padding: 8px 20px; border-radius: 8px; font-size: 14px; font-weight: bold; pointer-events: none; transition: opacity 0.5s;';
            trackContainer.style.position = 'relative';
            trackContainer.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; }, 800);
            setTimeout(() => toast.remove(), 1300);
        }

        // 숨김 구간을 고정 16ms 스텝(서버 시뮬 스텝과 동일, lerpFactor 0.05)으로 재생해 라이브 지점까지 도달.
        // 물리는 전부 수행, 연출(사운드/카메라/중계/렌더)은 isCatchingUp 게이트로 억제 → 종료 후 reconcile.
        function catchUpToLive() {
            const targetElapsed = Date.now() - startTime;
            const stepCap = Math.ceil((maxDuration + 30000) / 16); // 워치독: shouldEndRace 미발화 시 하드 캡
            let steps = 0;
            isCatchingUp = true;
            try {
                for (let t = simulatedUpTo + 16; t <= targetElapsed; t += 16) {
                    stepRace(16, t);
                    if (raceEnded) break; // 종료 블록 발화 — 이후는 기존 setTimeout tail(gen guard)로만 진행
                    if (++steps >= stepCap) break;
                }
            } finally {
                isCatchingUp = false;
            }
            lastFrameTime = Date.now();
            if (!raceEnded) reconcileAfterCatchUp();
        }

        // 카메라 즉시 스냅: 렌더의 lerp 스윕 방지 + Date.now() 기반 카메라 타임스탬프 리셋 (숨김 구간 오염 제거)
        function snapCameraToTarget() {
            panningToLoser = false;
            leaderFocusStartTime = null;
            isRandomCutaway = false;
            randomCutawayStartTime = null;
            randomCutawayTarget = null;
            // 만료된 이벤트 컷 정리 — renderFrame의 만료/킬 조건과 동일 술어 유지
            // (한쪽에만 조건이 있으면 snap 직후 renderFrame이 컷을 죽여 lerp 스윕 발생)
            if (activeEventCut) {
                const _snapLeader = horseStates.reduce((l, s) => s.currentPos > l.currentPos ? s : l, horseStates[0]);
                const _snapRemainM = (finishLine - _snapLeader.currentPos) / PIXELS_PER_METER;
                if (!activeEventCut.gimmick.active || activeEventCut.state.finished ||
                    (Date.now() - activeEventCut.startWall >= activeEventCut.maxHoldMs) ||
                    _snapRemainM <= FINISH_LOCK_DISTANCE_M) {
                    activeEventCut = null;
                    lastEventCutEnd = Date.now();
                }
            }
            // 현재 카메라 모드의 대상 결정 (renderFrame과 동일한 우선순위)
            let camTarget = null;
            if (isEvolutionCutaway && evolutionCutawayTarget) {
                camTarget = evolutionCutawayTarget;
            } else if (cameraMode === '_loser' && loserCameraTarget) {
                camTarget = loserCameraTarget;
            } else if (cameraMode === 'myHorse') {
                const myIdx = userHorseBets[currentUser];
                camTarget = horseStates.find(s => s.horseIndex === myIdx) || null;
            } else if (activeEventCut) {
                // 이벤트 컷은 leader 모드에서만 유효 (renderFrame과 동일 서열)
                camTarget = activeEventCut.state;
            }
            if (!camTarget) {
                camTarget = horseStates.reduce((l, s) => s.currentPos > l.currentPos ? s : l, horseStates[0]);
            }
            // renderFrame의 finishLineDisplayOffset(250)/maxScrollLimit 산식과 동일
            const scrollReleasePoint = finishLine - 250;
            const maxScrollLimit = -(scrollReleasePoint - centerPosition);
            let targetOffset = 0;
            if (camTarget.currentPos > centerPosition) {
                targetOffset = -(camTarget.currentPos - centerPosition);
                if (targetOffset < maxScrollLimit) targetOffset = maxScrollLimit;
            }
            currentScrollOffset = targetOffset;
        }

        // catch-up 종료 후 화면 상태 재구성 — 억제된 연출을 "최종 상태" 기준으로 1회 반영 (레이스 미종료 시에만)
        function reconcileAfterCatchUp() {
            // 1) 슬로우모션 최종 상태 (트리거/해제 비주얼·사운드는 catch-up 중 억제됨)
            let vignette = raceDoc().getElementById('slowmoVignette');
            if (slowMotionActive || loserSlowMotionActive) {
                if (!vignette) {
                    vignette = document.createElement('div');
                    vignette.id = 'slowmoVignette';
                    vignette.style.cssText = `
                        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                        pointer-events: none; z-index: 9999;
                        box-shadow: inset 0 0 60px 30px rgba(0,0,0,0.5);
                        border-radius: inherit;
                        transition: opacity 0.5s;
                    `;
                    track.parentElement.style.position = 'relative';
                    track.parentElement.appendChild(vignette);
                }
                // 리더=검정 / 꼴등(타깃)=빨강 비네트 (트리거 블록과 동일 값)
                vignette.style.boxShadow = loserSlowMotionActive
                    ? 'inset 0 0 60px 30px rgba(233,69,96,0.4)'
                    : 'inset 0 0 60px 30px rgba(0,0,0,0.5)';
                vignette.style.opacity = '1';
                track.style.transition = 'filter 0.3s';
                track.style.filter = 'contrast(1.1) saturate(1.3)';
                if (window.SoundManager) {
                    SoundManager.playLoop('horse-race_slowmo_cheer', getHorseSoundEnabled(), 0.9); // 이미 재생 중이면 무시됨
                    SoundManager.setVolume('horse-race_slowmo_cheer', 0.9); // 리더 페이드아웃 잔여 볼륨 복원
                }
                // 벌칙 타깃 lose 스프라이트 멱등 재적용 (트리거 블록에서도 적용되지만 최종 보증)
                if (loserSlowMotionActive && loserCameraTarget && loserCameraTarget.horse) {
                    const _loseVid = loserCameraTarget.horse.dataset.vehicleId;
                    if (_loseVid && typeof setVehicleState === 'function') {
                        setVehicleState(loserCameraTarget.horse, _loseVid, 'lose');
                    }
                }
            } else {
                track.style.filter = '';
                if (vignette) vignette.style.opacity = '0';
                if (window.SoundManager) SoundManager.stopLoop('horse-race_slowmo_cheer');
            }
            // 2) 날씨 최종 비주얼 (catch-up 중 변화가 있었을 때만 — 토스트는 순간 연출이라 생략)
            if (weatherVisualDirty) {
                weatherVisualDirty = false;
                if (currentWeather === 'sunny') {
                    weatherBanner.style.display = 'none';
                } else {
                    weatherBanner.style.display = '';
                    weatherBanner.textContent = `${weatherEmojis[currentWeather]} ${weatherNames[currentWeather]}`;
                    showWeatherIndicators(horseStates, currentWeather);
                }
                applyWeatherEffect(currentWeather);
            }
            // 3) 카메라 스냅 + 최종 상태 1회 렌더 (말 위치/스크롤/미니맵/화살표)
            snapCameraToTarget();
            renderFrame();
            // 4) 순위 HUD 즉시 1회 갱신
            updateLiveRanking(horseStates);
        }
        // 이전 경주의 리스너가 남아있으면 제거 후 재등록 (fresh closure의 removeEventListener는 no-op이므로 전역에 보관)
        if (window._raceVisHandler) {
            document.removeEventListener('visibilitychange', window._raceVisHandler);
        }
        window._raceVisHandler = onVisChange;
        document.addEventListener('visibilitychange', onVisChange);

        // 랜덤 카메라 컷어웨이 변수 초기화
        leaderFocusStartTime = null;
        isRandomCutaway = false;
        randomCutawayStartTime = null;
        randomCutawayTarget = null;
        cutawayDisabled = false;
        activeEventCut = null;
        lastEventCutEnd = 0;

        // 렌더 프레임: 카메라/스크롤/말 화면 위치/미니맵 — 기존 animLoop 렌더 섹션을 함수로 추출 (내용 무변경).
        // 라이브 스텝에서 매 프레임 호출되고, catch-up 완료 시 reconcile이 1회 호출해 최종 상태를 화면에 반영한다.
        function renderFrame() {
            // === 일정 속도 스크롤링 ===
            // 리더(1등) 말 찾기 (순위 표시용)
            const leaderState = horseStates.reduce((leader, state) => 
                state.currentPos > leader.currentPos ? state : leader, horseStates[0]);
            const leaderPos = leaderState.currentPos;
            
            // 스크롤 설정 — 결승선 화면위치 = offset + centerPosition
            // 모바일(400px): 250 + 80 = 330px (우측 82%), PC(800px): 250 + 400 = 650px (우측 81%)
            const finishLineDisplayOffset = 250;
            const scrollReleasePoint = finishLine - finishLineDisplayOffset;
            const maxScrollLimit = -(scrollReleasePoint - centerPosition);

            // 카메라 대상 결정 (1등 / 내 말 / 꼴등 슬로우모션 대상 / 패닝)
            let indicatorReferenceState = null;
            if (panningToLoser) {
                // 부드러운 패닝 중 (1등 결승 후 → 꼴등으로 이동)
                const panElapsed = Date.now() - panStartTime;
                const t = Math.min(panElapsed / PAN_DURATION, 1);
                const ease = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
                // 타겟 위치 갱신 (꼴등이 계속 움직이므로)
                if (loserCameraTarget) {
                    panTargetOffset = -(loserCameraTarget.currentPos - centerPosition);
                    if (panTargetOffset < maxScrollLimit) panTargetOffset = maxScrollLimit;
                }
                indicatorReferenceState = loserCameraTarget || null;
                currentScrollOffset = panStartOffset + (panTargetOffset - panStartOffset) * ease;
                if (t >= 1) {
                    panningToLoser = false;
                    cameraModeBefore = cameraMode;
                    cameraMode = '_loser';
                }
            } else {
                let cameraTarget = leaderState;

                // Evolution 컷어웨이 (최우선 — evolution_boost 종료까지 유지)
                if (isEvolutionCutaway && evolutionCutawayTarget) {
                    cameraTarget = evolutionCutawayTarget;
                } else if (cameraMode === '_loser') {
                    // 타깃 등수 모드 분기:
                    // - targetRank null 또는 꼴등 등수(K) → 매 프레임 꼴등(가장 느린 말) 재계산 (기존 동작)
                    // - targetRank 중간(2~K-1) → 트리거 시 정한 loserCameraTarget(=타깃 등수 말) 유지, 재계산 X
                    const _trCam = window._targetRank;
                    const bettedIndicesForLoser = [...new Set(Object.values(userHorseBets))];
                    const isMidTargetCam = (typeof _trCam === 'number' && _trCam >= 2 && _trCam < bettedIndicesForLoser.length);

                    if (isMidTargetCam) {
                        // 타깃 등수 말을 그대로 추적 (꼴등으로 옮겨가지 않음)
                        if (loserCameraTarget) cameraTarget = loserCameraTarget;
                    } else {
                        // 꼴등 모드: 매 프레임 가장 느린 말 재계산
                        const unfinishedNow = horseStates
                            .filter(s => !s.finished && bettedIndicesForLoser.includes(s.horseIndex))
                            .sort((a, b) => a.currentPos - b.currentPos);
                        if (unfinishedNow.length > 0) {
                            loserCameraTarget = unfinishedNow[0];
                        }
                        // 꼴등 후보 2마리 접전(80px 이내) → 중간점 추적 (둘 다 화면에)
                        if (unfinishedNow.length >= 2 && loserCameraTarget) {
                            const gap = unfinishedNow[1].currentPos - unfinishedNow[0].currentPos;
                            if (gap < 80) {
                                const midPos = (unfinishedNow[0].currentPos + unfinishedNow[1].currentPos) / 2;
                                cameraTarget = { currentPos: midPos, horseIndex: loserCameraTarget.horseIndex };
                            } else {
                                cameraTarget = loserCameraTarget;
                            }
                        } else if (loserCameraTarget) {
                            cameraTarget = loserCameraTarget;
                        }
                    }
                } else if (cameraMode === 'myHorse') {
                    // 내 말 추적 - 랜덤 컷어웨이 적용 안함
                    const myIdx = userHorseBets[currentUser];
                    const myState = horseStates.find(s => s.horseIndex === myIdx);
                    if (myState) cameraTarget = myState;
                } else {
                    // leader 모드 - 랜덤 컷어웨이 로직
                    const now = Date.now();
                    const leaderRemainingM = (finishLine - leaderState.currentPos) / PIXELS_PER_METER;

                    // 결승선 50m 전이면 컷어웨이 완전 비활성화
                    if (leaderRemainingM <= FINISH_LOCK_DISTANCE_M) {
                        if (isRandomCutaway) {
                            isRandomCutaway = false;
                            randomCutawayTarget = null;
                        }
                        if (activeEventCut) {
                            activeEventCut = null;
                            lastEventCutEnd = now;
                        }
                        cutawayDisabled = true;
                        leaderFocusStartTime = null;
                        cameraTarget = leaderState;
                    }
                    // 이벤트 컷 (기믹 순간포착 — 랜덤 컷어웨이보다 우선, goal: horse-race-event-camera)
                    else if (activeEventCut) {
                        const ec = activeEventCut;
                        // 만료 1차 판정은 시뮬 시간 기반 !gimmick.active — catch-up 중 발동+종료된 기믹도 reconcile 시 자동 수렴.
                        // maxHoldMs는 벽시계 상한 보조.
                        const expired = !ec.gimmick.active || ec.state.finished || (now - ec.startWall >= ec.maxHoldMs);
                        if (expired) {
                            activeEventCut = null;
                            lastEventCutEnd = now;
                            leaderFocusStartTime = now; // 리더 복귀 후 최소 고정 (재컷 쿨다운)
                            cameraTarget = leaderState;
                        } else {
                            cameraTarget = ec.state;
                        }
                    }
                    // 컷어웨이가 비활성화되지 않았을 때만 처리
                    else if (!cutawayDisabled) {
                        // 컷어웨이 중일 때
                        if (isRandomCutaway && randomCutawayTarget) {
                            // 상황별 컷어웨이 시간 경과 시 1등으로 복귀
                            const currentCutawayDuration = getCutawayDuration(horseStates, finishLine);
                            if (now - randomCutawayStartTime >= currentCutawayDuration) {
                                isRandomCutaway = false;
                                randomCutawayTarget = null;
                                leaderFocusStartTime = now;
                                cameraTarget = leaderState;
                            } else {
                                // 컷어웨이 대상이 완주했으면 새 타겟 선택 또는 1등 복귀
                                if (randomCutawayTarget.finished) {
                                    randomCutawayTarget = selectRandomCutawayTarget(horseStates, leaderState.horseIndex);
                                    if (!randomCutawayTarget) {
                                        isRandomCutaway = false;
                                        leaderFocusStartTime = now;
                                        cameraTarget = leaderState;
                                    } else {
                                        cameraTarget = randomCutawayTarget;
                                    }
                                } else {
                                    cameraTarget = randomCutawayTarget;
                                }
                            }
                        }
                        // 1등 고정 중일 때
                        else {
                            if (leaderFocusStartTime === null) {
                                leaderFocusStartTime = now;
                            }
                            // LEADER_FOCUS_DURATION 이상 1등 고정 시 랜덤 컷어웨이 시작
                            if (now - leaderFocusStartTime >= LEADER_FOCUS_DURATION) {
                                const target = selectRandomCutawayTarget(horseStates, leaderState.horseIndex);
                                if (target) {
                                    isRandomCutaway = true;
                                    randomCutawayStartTime = now;
                                    randomCutawayTarget = target;
                                    cameraTarget = target;
                                } else {
                                    leaderFocusStartTime = now;
                                }
                            } else {
                                cameraTarget = leaderState;
                            }
                        }
                    }
                }
                const cameraPos = cameraTarget.currentPos;
                indicatorReferenceState = horseStates.find(s => s.horseIndex === cameraTarget.horseIndex) || null;

                // 카메라 타겟에 화살표 표시 (다른 화살표는 숨김, 내 베팅 말이면 노란색)
                const myBetIndex = userHorseBets[currentUser];
                track.querySelectorAll('.camera-target-arrow').forEach(arrow => {
                    const idx = parseInt(arrow.dataset.horseIndex);
                    if (idx === cameraTarget.horseIndex) {
                        arrow.style.display = 'block';
                        // 내 베팅 말이면 노란색, 아니면 빨간색
                        if (idx === myBetIndex) {
                            arrow.style.color = '#ffd700';
                            arrow.style.textShadow = '0 0 6px rgba(255,215,0,0.8)';
                        } else {
                            arrow.style.color = '#e94560';
                            arrow.style.textShadow = '0 0 4px rgba(233,69,96,0.6)';
                        }
                    } else {
                        arrow.style.display = 'none';
                    }
                });

                let targetOffset = 0;
                if (cameraPos > centerPosition) {
                    targetOffset = -(cameraPos - centerPosition);
                    if (targetOffset < maxScrollLimit) {
                        targetOffset = maxScrollLimit;
                    }
                }
                // 부드러운 카메라 이동 (적응형 lerp — 거리 멀수록 빠르게 추격)
                const camDistance = Math.abs(targetOffset - currentScrollOffset);
                const lerpSpeed = camDistance < 50 ? 0.05 : camDistance < 200 ? 0.10 : camDistance < 500 ? 0.20 : 0.35;
                currentScrollOffset += (targetOffset - currentScrollOffset) * lerpSpeed;
            }
            
            // 카메라 버튼 UI 동기화
            updateCameraBtnUI();

            const bgScrollOffset = currentScrollOffset;
            
            // 거리 마커 스크롤
            distanceMarkers.forEach(marker => {
                const origLeft = parseFloat(marker.dataset.origLeft || marker.style.left);
                if (!marker.dataset.origLeft) marker.dataset.origLeft = origLeft;
                marker.style.left = `${origLeft + bgScrollOffset}px`;
            });

            // 모든 말의 화면 위치 및 배경 업데이트 (스크롤 오프셋 기준)
            const cullEdge = -10; // 화면 왼쪽 밖 판정 기준
            const rightEdge = trackWidth + 10; // 화면 오른쪽 밖 판정 기준
            // 현재 카메라 기준 말 위치 (우측 거리 표시 기준)
            const AHEAD_INDICATOR_EPSILON_PX = 1;
            const getFrontEdge = (horseState) => horseState.currentPos + (horseState.visualWidth || 0);
            const getAheadDistanceMeters = (gapPx) => {
                if (gapPx <= AHEAD_INDICATOR_EPSILON_PX) return 0;
                return Math.max(1, Math.ceil(gapPx / PIXELS_PER_METER));
            };
            const indicatorReferenceIdx = indicatorReferenceState ? indicatorReferenceState.horseIndex : null;
            const indicatorReferenceFrontEdge = indicatorReferenceState ? getFrontEdge(indicatorReferenceState) : null;
            horseStates.forEach(state => {
                // 화면 위치 = 실제 위치 + 스크롤 오프셋
                let horseDisplayPos = state.currentPos + bgScrollOffset;
                const isOffscreenLeft = horseDisplayPos < cullEdge;
                const isOffscreenRight = horseDisplayPos > rightEdge;
                // 현재 카메라 기준 말보다 앞서있는지 (기준 말 자신은 제외)
                const aheadGapPx = indicatorReferenceFrontEdge !== null && state.horseIndex !== indicatorReferenceIdx
                    ? getFrontEdge(state) - indicatorReferenceFrontEdge
                    : 0;
                const distAhead = getAheadDistanceMeters(aheadGapPx);
                const isAheadOfMe = distAhead > 0;

                // 왼쪽 오프스크린 인디케이터 처리
                if (!state.offscreenIndicator) {
                    const indicator = document.createElement('div');
                    indicator.className = 'offscreen-indicator';
                    indicator.style.cssText = `position: absolute; left: 2px; top: 50%; transform: translateY(-50%); z-index: 100; display: none; font-size: 10px; color: var(--yellow-400); white-space: nowrap; text-shadow: 0 0 4px rgba(0,0,0,0.8); pointer-events: none;`;
                    state.lane.appendChild(indicator);
                    state.offscreenIndicator = indicator;
                }

                // 오른쪽 거리 인디케이터 (내 말보다 앞서있는 말 표시)
                // 레인은 트랙(7350px) 기준 width:100%이므로 right:2px 사용 불가 → 뷰포트(trackWidth)의 오른쪽 끝에 고정
                if (!state.offscreenRightIndicator) {
                    const indicator = document.createElement('div');
                    indicator.className = 'offscreen-indicator-right';
                    indicator.style.cssText = `position: absolute; left: ${trackWidth - 5}px; top: 50%; transform: translate(-100%, -50%); z-index: 100; display: none; font-size: 10px; color: var(--yellow-400); white-space: nowrap; text-shadow: 0 0 4px rgba(0,0,0,0.8); pointer-events: none;`;
                    state.lane.appendChild(indicator);
                    state.offscreenRightIndicator = indicator;
                }

                if (isOffscreenLeft && !state.finished) {
                    // 화면 왼쪽 밖 — 선두와의 거리 표시
                    const distBehind = Math.round((leaderPos - state.currentPos) / PIXELS_PER_METER);
                    if (state.lastDistBehind !== distBehind) {
                        state.offscreenIndicator.innerHTML = `<span style="animation: blink 0.6s infinite;">◀</span> ${distBehind}m`;
                        state.lastDistBehind = distBehind;
                    }
                    state.offscreenIndicator.style.display = 'block';
                    state.offscreenRightIndicator.style.display = 'none';
                    state.horse.style.left = `-200px`;
                    state.horse.style.visibility = 'hidden';
                } else if (isOffscreenRight && !state.finished) {
                    // 화면 오른쪽 밖 — 현재 카메라 기준 말과의 거리 표시
                    if (isAheadOfMe) {
                        if (state.lastDistAhead !== distAhead) {
                            state.offscreenRightIndicator.innerHTML = `${distAhead}m <span style="animation: blink 0.6s infinite;">▶</span>`;
                            state.lastDistAhead = distAhead;
                        }
                        state.offscreenRightIndicator.style.display = 'block';
                    } else {
                        state.offscreenRightIndicator.style.display = 'none';
                    }
                    state.offscreenIndicator.style.display = 'none';
                    state.horse.style.left = `${trackWidth + 200}px`;
                    state.horse.style.visibility = 'hidden';
                } else {
                    // 화면 안에 있는 말
                    state.offscreenIndicator.style.display = 'none';
                    // 같은 화면에 보이는 말은 우측 거리 표시를 숨김
                    state.offscreenRightIndicator.style.display = 'none';
                    if (isOffscreenLeft) horseDisplayPos = cullEdge;
                    state.horse.style.left = `${horseDisplayPos}px`;
                    state.horse.style.visibility = 'visible';
                }
                
                // 배경 스크롤 - 모든 레인에서 리더 기준으로 동일하게
                if (state.lane) {
                    state.lane.style.backgroundPosition = `${bgScrollOffset}px center`;
                    
                    // 결승선도 리더 기준으로 스크롤
                    if (state.lane.finishLineElement) {
                        state.lane.finishLineElement.style.left = `${finishLine + bgScrollOffset}px`;
                    }
                }
            });
            
            // 미니맵 업데이트
            updateMinimap(horseStates, startPosition, totalDistance, finishLine, trackDistanceMeters, vehicleInfoMap);
        }

        // JavaScript 기반 애니메이션 루프 (rAF로 vsync 동기화) — 프레임 타이밍 + stepRace 호출 + 재예약만 담당
        function animLoop() {
            if (pausedAt > 0) {
                animationFrameId = window._raceAnimFrameId = raceAnimWin().requestAnimationFrame(animLoop);
                return; // 일시정지 중 (숨김 탭)
            }
            const now = Date.now();
            const deltaTime = Math.min(now - lastFrameTime, 50);
            lastFrameTime = now;
            const elapsed = now - startTime;
            stepRace(deltaTime, elapsed);
            if (raceEnded) return; // 종료 블록 실행됨 — 재예약 중단 (기존 흐름과 동일)
            animationFrameId = window._raceAnimFrameId = raceAnimWin().requestAnimationFrame(animLoop);
        }

        // 물리/판정 1스텝 — 라이브 rAF(가변 dt≤50ms)와 catch-up 동기 루프(고정 16ms)가 공유.
        // 산식·실행 순서는 기존 animLoop 본문 그대로 (항상-보이는 클라이언트 동작 무변경).
        function stepRace(deltaTime, elapsed) {
            if (raceEnded) return;
            simulatedUpTo = elapsed;
            let allFinished = true;
            
            // 슬로우모션 체크: 선두가 결승선 근처에 도달하면 발동 (서버와 동일 로직)
            if (!slowMotionTriggered) {
                const unfinishedHorses = horseStates.filter(s => !s.finishJudged);
                const rank1 = unfinishedHorses.length > 0
                    ? unfinishedHorses.reduce((a, b) => a.currentPos > b.currentPos ? a : b)
                    : null;
                if (rank1) {
                    const remainingPx = finishLine - (rank1.currentPos + rank1.visualWidth);
                    const remainingM = remainingPx / PIXELS_PER_METER;
                    if (remainingM <= smConf.leader.triggerDistanceM) {
                        slowMotionTriggered = true;
                        slowMotionActive = true;
                        slowMotionFactor = smConf.leader.factor; // 물리 — catch-up에서도 반드시 적용
                        if (!isCatchingUp) { // 비주얼/사운드는 억제 → reconcile이 최종 상태 반영
                            // 비네팅(가장자리 어둡게) + 필터 효과
                            let vignette = raceDoc().getElementById('slowmoVignette');
                            if (!vignette) {
                                vignette = document.createElement('div');
                                vignette.id = 'slowmoVignette';
                                vignette.style.cssText = `
                                    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                                    pointer-events: none; z-index: 9999;
                                    box-shadow: inset 0 0 60px 30px rgba(0,0,0,0.5);
                                    border-radius: inherit;
                                    transition: opacity 0.5s;
                                `;
                                track.parentElement.style.position = 'relative';
                                track.parentElement.appendChild(vignette);
                            }
                            vignette.style.opacity = '1';
                            track.style.transition = 'filter 0.3s';
                            track.style.filter = 'contrast(1.1) saturate(1.3)';
                            // 슬로우모션 환호성 (기존 crowd보다 크게)
                            if (window.SoundManager) {
                                SoundManager.playLoop('horse-race_slowmo_cheer', getHorseSoundEnabled(), 0.9);
                            }
                        }
                    }
                }
            }

            // ========== 날씨 변화 체크 (1등 진행도 기준) ==========
            if (weatherSchedule.length > 0) {
                const leaderState = horseStates.reduce((a, b) =>
                    (a && !a.finished && a.currentPos > b.currentPos) ? a : b, null);
                if (leaderState && !leaderState.finished) {
                    const raceProgress = (leaderState.currentPos - startPosition) / totalDistance;
                    const newWeather = getCurrentWeatherFromSchedule(raceProgress);

                    if (newWeather !== currentWeather) {
                        currentWeather = newWeather; // 물리(속도 배수 기준) — catch-up에서도 반드시 갱신
                        if (isCatchingUp) {
                            weatherVisualDirty = true; // 비주얼은 reconcile에서 최종 날씨 기준 1회 적용
                        } else {
                            // sunny일 때는 배너/토스트/인디케이터 숨김
                            if (currentWeather === 'sunny') {
                                weatherBanner.style.display = 'none';
                            } else {
                                // 배너 업데이트
                                weatherBanner.style.display = '';
                                weatherBanner.textContent = `${weatherEmojis[currentWeather]} ${weatherNames[currentWeather]}`;
                                // 토스트 메시지 표시 (클라이언트 독립)
                                showWeatherToast(currentWeather);
                                // 버프/디버프 삼각형 표시
                                showWeatherIndicators(horseStates, currentWeather);
                            }
                            // 오버레이 효과 업데이트 (sunny면 효과 없음)
                            applyWeatherEffect(currentWeather);
                        }
                    }
                }
            }

            // 슬로우모션 해제: 1등이 결승선 도착 판정(오른쪽 끝 통과)하면 즉시 해제
            if (slowMotionActive && horseStates.some(s => s.finishJudged)) {
                slowMotionActive = false;
                slowMotionFactor = 1; // 물리 — catch-up에서도 반드시 복원
                if (!isCatchingUp) { // 비주얼/사운드는 억제 → reconcile이 최종 상태(비활성) 반영
                    track.style.filter = '';
                    // vignette는 remove하지 않고 숨김만 (꼴등 슬로우모션이 재사용)
                    const vignette = raceDoc().getElementById('slowmoVignette');
                    if (vignette) {
                        vignette.style.opacity = '0';
                    }
                    // 슬로우모션 환호성 페이드아웃 + 골인 환호 재생
                    if (window.SoundManager) {
                        // 골인 환호 (단발)
                        SoundManager.playSound('horse-race_cheer_burst', getHorseSoundEnabled(), 1.0);
                        // 슬로우모션 환호 페이드아웃 (1초) — interval ID 보관 (꼴등 슬로우 시 취소용)
                        let slowmoVol = 0.9;
                        leaderCheerFadeInterval = setInterval(() => {
                            slowmoVol -= 0.15;
                            if (slowmoVol <= 0) {
                                SoundManager.stopLoop('horse-race_slowmo_cheer');
                                clearInterval(leaderCheerFadeInterval);
                                leaderCheerFadeInterval = null;
                            } else {
                                SoundManager.setVolume('horse-race_slowmo_cheer', slowmoVol);
                            }
                        }, 150);
                    }
                }
            }

            // N등 결정 슬로우모션 (loser 일반화): 리더 슬로우모션 해제 후, 타깃 등수 말 진입 시 발동
            // targetRank === 1 → leader 슬로우모션이 처리, 이 블록 skip
            // targetRank === null 또는 targetRank === bettedByRank.length → 기존 꼴등 동작 그대로
            // 2 <= targetRank < bettedByRank.length → 타깃 말이 결승선 근접 시 발동
            const _targetRankRace = (typeof window._targetRank === 'number') ? window._targetRank : null;
            if (!loserSlowMotionTriggered && !slowMotionActive && _targetRankRace !== 1) {
                const bettedHorseIndices = [...new Set(Object.values(userHorseBets))];
                const bettedByRank = bettedHorseIndices
                    .map(hi => horseStates.find(s => s.horseIndex === hi))
                    .filter(Boolean)
                    .sort((a, b) => a.currentPos - b.currentPos); // 위치순 정렬 (느린 순)

                let triggerHorse = null;     // 트리거 판정용 (결승선 근처 체크 대상)
                let cameraTargetHorse = null; // 카메라 추적 대상
                let releaseTargetHorse = null; // 해제 판정용 (finishJudged로 끝남)

                if (_targetRankRace === null || _targetRankRace === bettedByRank.length) {
                    // 기존 꼴등 동작: secondLastBetted가 결승선 근접 시 발동
                    if (bettedByRank.length >= 2) {
                        const lastBetted = bettedByRank[0];
                        const secondLastBetted = bettedByRank[1];
                        if (lastBetted && secondLastBetted && !lastBetted.finished && !secondLastBetted.finished) {
                            triggerHorse = secondLastBetted;
                            cameraTargetHorse = secondLastBetted;
                            releaseTargetHorse = secondLastBetted;
                        }
                    }
                } else if (_targetRankRace >= 2 && _targetRankRace < bettedByRank.length) {
                    // 일반화: 타깃 등수 말 자체가 결승선 근접 시 발동
                    const idx = bettedByRank.length - _targetRankRace;
                    const tgt = bettedByRank[idx];
                    if (tgt && !tgt.finished) {
                        triggerHorse = tgt;
                        cameraTargetHorse = tgt;
                        releaseTargetHorse = tgt;
                    }
                }

                if (triggerHorse) {
                    const slRemainingM = (finishLine - triggerHorse.currentPos) / PIXELS_PER_METER;
                    // 결승선 근처일 때 발동
                    if (slRemainingM <= smConf.loser.triggerDistanceM) {
                        loserSlowMotionTriggered = true;
                        loserSlowMotionActive = true;
                        // 리더 환호 페이드아웃이 진행 중이면 취소 (꼴등 사운드를 죽이지 않도록)
                        if (leaderCheerFadeInterval) {
                            clearInterval(leaderCheerFadeInterval);
                            leaderCheerFadeInterval = null;
                            // 볼륨 복원 (꼴등 환호가 이어서 사용) — catch-up 중엔 reconcile이 복원
                            if (!isCatchingUp && window.SoundManager) {
                                SoundManager.setVolume('horse-race_slowmo_cheer', 0.9);
                            }
                        }
                        slowMotionFactor = smConf.loser.factor; // 물리 — catch-up에서도 반드시 적용
                        loserCameraTarget = cameraTargetHorse;
                        loserReleaseTarget = releaseTargetHorse;
                        cameraModeBefore = cameraMode;
                        cameraMode = '_loser';

                        // 당첨 등수(=벌칙자) 말에 lose 스프라이트 적용 — 슬로우모션 시점부터 패배 자세
                        // (지속형 one-shot 스왑이라 catch-up 중에도 그대로 실행 — 해제 블록이 복원하지 않는 상태)
                        if (cameraTargetHorse && cameraTargetHorse.horse) {
                            const _loseVid = cameraTargetHorse.horse.dataset.vehicleId;
                            if (_loseVid && typeof setVehicleState === 'function') {
                                setVehicleState(cameraTargetHorse.horse, _loseVid, 'lose');
                            }
                        }
                        if (!isCatchingUp) { // 비네트/필터/사운드는 억제 → reconcile이 최종 상태 반영
                            let vignette = raceDoc().getElementById('slowmoVignette');
                            if (!vignette) {
                                vignette = document.createElement('div');
                                vignette.id = 'slowmoVignette';
                                vignette.style.cssText = `
                                    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                                    pointer-events: none; z-index: 9999;
                                    box-shadow: inset 0 0 60px 30px rgba(233,69,96,0.4);
                                    border-radius: inherit;
                                    transition: opacity 0.5s;
                                `;
                                track.parentElement.style.position = 'relative';
                                track.parentElement.appendChild(vignette);
                            }
                            // 리더 비네트(검정)→꼴등(빨강) 색상 전환 (기존 DOM 재사용 시)
                            vignette.style.boxShadow = 'inset 0 0 60px 30px rgba(233,69,96,0.4)';
                            vignette.style.opacity = '1';
                            track.style.transition = 'filter 0.3s';
                            track.style.filter = 'contrast(1.1) saturate(1.3)';
                            // 꼴등 슬로우모션 환호성 (이미 재생 중이면 무시됨)
                            if (window.SoundManager) {
                                SoundManager.playLoop('horse-race_slowmo_cheer', getHorseSoundEnabled(), 0.9);
                            }
                        }
                    }
                }
            }

            // 꼴등 슬로우모션 해제: 카메라 타겟이 완전 통과하면 해제 (서버와 동일)
            if (loserSlowMotionActive) {
                const loserFinished = !loserReleaseTarget || loserReleaseTarget.finishJudged;
                if (loserFinished) {
                    loserSlowMotionActive = false;
                    loserReleaseTarget = null;
                    slowMotionFactor = 1;

                    // 중간 등수 모드(타깃 자체가 트리거)면 release 후 카메라 해제
                    // 꼴등 모드(null 또는 꼴등 등수)면 진짜 꼴등으로 카메라 유지 (기존 동작)
                    const _trRel = window._targetRank;
                    const _bettedCount = new Set(Object.values(userHorseBets)).size;
                    const isMidTarget = (typeof _trRel === 'number' && _trRel >= 2 && _trRel < _bettedCount);

                    if (isMidTarget) {
                        loserCameraTarget = null;
                        if (cameraModeBefore) { cameraMode = cameraModeBefore; cameraModeBefore = null; }
                    } else {
                        const bettedIndices = [...new Set(Object.values(userHorseBets))];
                        const remaining = bettedIndices
                            .map(hi => horseStates.find(s => s.horseIndex === hi))
                            .filter(s => s && !s.finished)
                            .sort((a, b) => a.currentPos - b.currentPos);
                        if (remaining.length > 0) {
                            loserCameraTarget = remaining[0]; // 가장 느린 미완주 베팅 말
                            // _loser 모드 유지, 슬로우모션만 해제
                        } else {
                            loserCameraTarget = null;
                            if (cameraModeBefore) { cameraMode = cameraModeBefore; cameraModeBefore = null; }
                        }
                    }
                    if (!isCatchingUp) { // 비주얼/사운드는 억제 → reconcile이 최종 상태(비활성) 반영
                        track.style.filter = '';
                        const vignette = raceDoc().getElementById('slowmoVignette');
                        if (vignette) {
                            vignette.style.opacity = '0';
                            setTimeout(() => vignette.remove(), 500);
                        }
                        // 꼴등 슬로우모션 환호성 정지
                        if (window.SoundManager) {
                            SoundManager.stopLoop('horse-race_slowmo_cheer');
                        }
                    }
                }
            }

            horseStates.forEach(state => {
                if (state.finished) return;
                allFinished = false;

                const progress = (state.currentPos - startPosition) / totalDistance;

                // 기믹 체크
                state.gimmicks.forEach(gimmick => {
                    // Evolution 예고: 트리거 1.5초 전 (라이브만, 진짜/가짜 동일 처리)
                    if (!isReplay && (gimmick.type === 'evolution' || gimmick.type === 'evolution_fake') && !gimmick.triggered && !gimmick._chargeStarted) {
                        const chargeProgress = gimmick.progressTrigger - 0.03;
                        if (progress >= chargeProgress) {
                            gimmick._chargeStarted = true;
                            state.horse.classList.add('evolution-charge');
                            announceEvolutionStage('evolutionCharge', state, 3000);
                            // 카메라 강제 컷어웨이
                            isEvolutionCutaway = true;
                            evolutionCutawayTarget = state;
                            // evolution이 이벤트 컷을 선점
                            if (activeEventCut) {
                                activeEventCut = null;
                                lastEventCutEnd = Date.now();
                            }
                        }
                    }

                    // 기믹 트리거 체크
                    if (!gimmick.triggered && !gimmick.disabled && progress >= gimmick.progressTrigger) {
                        gimmick.triggered = true;
                        gimmick.active = true;
                        gimmick.endTime = elapsed + gimmick.duration;
                        maybeStartEventCut(gimmick, state); // 이벤트 컷어웨이 (goal: horse-race-event-camera)

                        // 기믹 시작 효과 및 이펙트 추가
                        if (gimmick.type === 'stop') {
                            state.horse.style.filter = 'brightness(0.7)';
                            // 쉬는 애니메이션으로 전환
                            state.horse.classList.remove('racing');
                            state.horse.classList.add('rest');
                            setVehicleState(state.horse, state.horse.dataset.vehicleId, 'rest');
                            // 브레이크 연기 이펙트
                            const stopEffect = document.createElement('div');
                            stopEffect.className = 'gimmick-effect-stop';
                            stopEffect.innerHTML = '<div class="brake-smoke"></div><div class="brake-smoke"></div><div class="brake-smoke"></div>';
                            state.horse.appendChild(stopEffect);
                            gimmick.effectElement = stopEffect;
                        } else if (gimmick.type === 'unbetted_stop') {
                            // 미베팅 말 정지 — dim + 쉬는 스프라이트만 (이모지/이펙트 없음)
                            // duration 999999라 종료 블록이 돌지 않음 → 레이스 끝까지 유지가 의도
                            state.horse.style.filter = 'brightness(0.6)';
                            state.horse.classList.remove('racing');
                            state.horse.classList.add('rest');
                            setVehicleState(state.horse, state.horse.dataset.vehicleId, 'rest');
                        } else if (gimmick.type === 'sprint') {
                            state.horse.style.filter = 'brightness(1.3) saturate(1.5)';
                            // 불꽃 + 속도선 이펙트
                            const sprintEffect = document.createElement('div');
                            sprintEffect.className = 'gimmick-effect-sprint';
                            sprintEffect.innerHTML = `
                                <div class="flame-core"></div>
                                <div class="flame"></div>
                                <div class="flame"></div>
                                <div class="flame"></div>
                            `;
                            state.horse.appendChild(sprintEffect);
                            // 속도선 추가
                            const speedLines = document.createElement('div');
                            speedLines.className = 'speed-lines';
                            speedLines.innerHTML = '<div class="speed-line"></div><div class="speed-line"></div><div class="speed-line"></div><div class="speed-line"></div><div class="speed-line"></div>';
                            state.horse.appendChild(speedLines);
                            gimmick.effectElement = sprintEffect;
                            gimmick.speedLinesElement = speedLines;
                        } else if (gimmick.type === 'slip') {
                            state.horse.style.filter = 'hue-rotate(20deg)';
                            // 미끄러짐 먼지 이펙트
                            const slipEffect = document.createElement('div');
                            slipEffect.className = 'gimmick-effect-slip';
                            slipEffect.innerHTML = '<div class="dust-cloud"></div><div class="dust-cloud"></div>';
                            state.horse.appendChild(slipEffect);
                            gimmick.effectElement = slipEffect;
                        } else if (gimmick.type === 'slow') {
                            state.horse.style.filter = 'brightness(0.9) grayscale(0.3)';
                            // 피로 땀방울 이펙트
                            const slowEffect = document.createElement('div');
                            slowEffect.className = 'gimmick-effect-slow';
                            slowEffect.innerHTML = '<div class="sweat-drop"></div><div class="sweat-drop"></div>';
                            state.horse.appendChild(slowEffect);
                            gimmick.effectElement = slowEffect;
                        } else if (gimmick.type === 'wobble') {
                            state.wobblePhase = 0;
                            // 어지러움 별 이펙트
                            const wobbleEffect = document.createElement('div');
                            wobbleEffect.className = 'gimmick-effect-wobble';
                            wobbleEffect.textContent = '💫';
                            state.horse.appendChild(wobbleEffect);
                            gimmick.effectElement = wobbleEffect;
                        } else if (gimmick.type === 'obstacle') {
                            // 장애물 — 쉬는 애니메이션 + 점프
                            state.horse.style.filter = 'brightness(0.6)';
                            state.horse.classList.remove('racing');
                            state.horse.classList.add('rest');
                            setVehicleState(state.horse, state.horse.dataset.vehicleId, 'rest');
                            state.horse.style.animation = 'obstacleJump 0.5s ease-in-out infinite';
                            const obstacleEffect = document.createElement('div');
                            obstacleEffect.className = 'gimmick-effect-obstacle';
                            obstacleEffect.textContent = '🚧';
                            obstacleEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:16px;';
                            state.horse.appendChild(obstacleEffect);
                            gimmick.effectElement = obstacleEffect;
                        } else if (gimmick.type === 'item_boost') {
                            // 황금 당근 — 강한 가속
                            state.horse.style.filter = 'brightness(1.5) saturate(2)';
                            const boostEffect = document.createElement('div');
                            boostEffect.className = 'gimmick-effect-item-boost';
                            boostEffect.textContent = '🥕✨';
                            boostEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:14px;animation:blink 0.3s infinite;';
                            state.horse.appendChild(boostEffect);
                            gimmick.effectElement = boostEffect;
                            // 속도선 추가
                            const speedLines = document.createElement('div');
                            speedLines.className = 'speed-lines';
                            speedLines.innerHTML = '<div class="speed-line"></div><div class="speed-line"></div><div class="speed-line"></div>';
                            state.horse.appendChild(speedLines);
                            gimmick.speedLinesElement = speedLines;
                        } else if (gimmick.type === 'item_trap') {
                            // 바나나 껍질 — 회전 애니메이션
                            state.horse.style.filter = 'hue-rotate(60deg) brightness(0.8)';
                            state.horse.style.animation = 'trapSpin 0.3s linear infinite';
                            const trapEffect = document.createElement('div');
                            trapEffect.className = 'gimmick-effect-item-trap';
                            trapEffect.textContent = '🍌';
                            trapEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:16px;';
                            state.horse.appendChild(trapEffect);
                            gimmick.effectElement = trapEffect;
                        } else if (gimmick.type === 'reverse') {
                            // 역주행 — 빨간 깜빡임
                            state.horse.style.filter = 'hue-rotate(180deg) brightness(1.2)';
                            state.horse.style.transform = 'scaleX(-1)';
                            const reverseEffect = document.createElement('div');
                            reverseEffect.className = 'gimmick-effect-reverse';
                            reverseEffect.textContent = '⚠️↩️';
                            reverseEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:14px;animation:blink 0.4s infinite;';
                            state.horse.appendChild(reverseEffect);
                            gimmick.effectElement = reverseEffect;
                        } else if (gimmick.type === 'reverse_boost') {
                            // 역주행 보상 부스트
                            state.horse.style.filter = 'brightness(1.4) saturate(1.8)';
                            state.horse.style.transform = '';
                            const rBoostEffect = document.createElement('div');
                            rBoostEffect.className = 'gimmick-effect-reverse-boost';
                            rBoostEffect.textContent = '💨🔥';
                            rBoostEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:14px;';
                            state.horse.appendChild(rBoostEffect);
                            gimmick.effectElement = rBoostEffect;
                        } else if (gimmick.type === 'item_rocket') {
                            // 로켓 — 초강력 단기 부스트
                            state.horse.style.filter = 'brightness(1.6) saturate(1.8)';
                            const rocketEffect = document.createElement('div');
                            rocketEffect.className = 'gimmick-effect-item-rocket';
                            rocketEffect.textContent = '🚀✨';
                            rocketEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:14px;animation:blink 0.3s infinite;';
                            state.horse.appendChild(rocketEffect);
                            gimmick.effectElement = rocketEffect;
                            // 속도선 추가
                            const speedLines = document.createElement('div');
                            speedLines.className = 'speed-lines';
                            speedLines.innerHTML = '<div class="speed-line"></div><div class="speed-line"></div><div class="speed-line"></div>';
                            state.horse.appendChild(speedLines);
                            gimmick.speedLinesElement = speedLines;
                        } else if (gimmick.type === 'item_ice') {
                            // 얼음 — 빙결된 채 천천히 미끄러짐
                            state.horse.style.filter = 'saturate(0.2) brightness(1.3)';
                            state.horse.classList.remove('racing');
                            state.horse.classList.add('rest');
                            setVehicleState(state.horse, state.horse.dataset.vehicleId, 'rest');
                            state.horse.style.animation = 'iceShiver 0.25s linear infinite';
                            const iceEffect = document.createElement('div');
                            iceEffect.className = 'gimmick-effect-item-ice';
                            iceEffect.textContent = '❄️';
                            iceEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:16px;';
                            state.horse.appendChild(iceEffect);
                            gimmick.effectElement = iceEffect;
                        } else if (gimmick.type === 'evolution' || gimmick.type === 'evolution_fake') {
                            // Evolution 변신 단계: 정지 + burst 이펙트 (진짜/가짜 동일 연출)
                            announceEvolutionStage('evolutionBurst', state, 3200);
                            state.horse.classList.remove('evolution-charge');
                            state.horse.classList.add('evolution-burst');
                            // rest 상태로 전환 (멈춤 연출)
                            state.horse.classList.remove('racing');
                            state.horse.classList.add('rest');
                            setVehicleState(state.horse, state.horse.dataset.vehicleId, 'rest');
                        } else if (gimmick.type === 'evolution_boost' || gimmick.type === 'evolution_fake_boost') {
                            // Evolution 질주 단계: power 스프라이트 + 가속 (라이브/다시보기 동일, 진짜/가짜 동일 연출)
                            state._evolutionBoostUsed = true;
                            state._evolutionLeadEligibleAt = Date.now() + 2200;
                            announceEvolutionStage('evolutionBoost', state, 3200);
                            state.horse.classList.remove('evolution-burst', 'rest');
                            state.horse.classList.add('racing', 'evolution-run');
                            const vehicleId = state.horse.dataset.vehicleId;
                            if (typeof getVehiclePowerSVG === 'function') {
                                const powerSVG = getVehiclePowerSVG(vehicleId);
                                if (powerSVG && powerSVG.run) {
                                    state._evolutionActive = true;
                                    if (isCatchingUp) {
                                        // 전환 연출(타이머/레이어) 없이 직접 스왑 — _evolutionActive ↔ 스프라이트 짝 유지
                                        state.horse.dataset.vehicleVariant = 'power';
                                        setVehicleState(state.horse, vehicleId, 'run');
                                    } else {
                                        animateVehicleVariantSwap(state.horse, vehicleId, 'power', 'run');
                                    }
                                }
                            }
                            // 카메라 컷어웨이 (아직 설정 안 됐으면)
                            if (!isEvolutionCutaway) {
                                isEvolutionCutaway = true;
                                evolutionCutawayTarget = state;
                                // evolution이 이벤트 컷을 선점
                                if (activeEventCut) {
                                    activeEventCut = null;
                                    lastEventCutEnd = Date.now();
                                }
                                }
                        }
                    }

                    // 기믹 종료 체크
                    if (gimmick.active && elapsed >= gimmick.endTime) {
                        gimmick.active = false;
                        state.horse.style.filter = '';
                        state.horse.style.animation = '';
                        if (gimmick.type === 'reverse') {
                            state.horse.style.transform = '';
                        }
                        // stop/obstacle/item_ice 기믹 종료 시 다시 달리기 상태로
                        if (gimmick.type === 'stop' || gimmick.type === 'obstacle' || gimmick.type === 'item_ice') {
                            state.horse.classList.remove('rest');
                            state.horse.classList.add('racing');
                            setVehicleState(state.horse, state.horse.dataset.vehicleId, 'run');
                        }
                        // evolution 변신 종료: burst 정리 (nextGimmick으로 boost가 이어짐, 진짜/가짜 동일)
                        if (gimmick.type === 'evolution' || gimmick.type === 'evolution_fake') {
                            state.horse.classList.remove('evolution-charge', 'evolution-burst');
                        }
                        // evolution_boost 종료: 이펙트 정리 + base 스프라이트 복원 + 카메라 해제 (진짜/가짜 동일)
                        if (gimmick.type === 'evolution_boost' || gimmick.type === 'evolution_fake_boost') {
                            state.horse.classList.remove('evolution-run', 'evolution-charge', 'evolution-burst');
                            state.horse.style.filter = '';
                            // 카메라 해제 — 리더 복귀 후 최소 고정 (stale 타임스탬프로 즉시 랜덤 컷 방지)
                            isEvolutionCutaway = false;
                            evolutionCutawayTarget = null;
                            leaderFocusStartTime = Date.now();
                            if (state._evolutionActive) {
                                state._evolutionActive = false;
                                const vid = state.horse.dataset.vehicleId;
                                const baseSVG = getVehicleSVG(vid);
                                if (baseSVG && baseSVG.run) {
                                    if (isCatchingUp) {
                                        // 전환 연출 없이 직접 복원 — _evolutionActive ↔ 스프라이트 짝 유지
                                        state.horse.dataset.vehicleVariant = 'base';
                                        setVehicleState(state.horse, vid, state.finished ? 'finish' : 'run');
                                    } else {
                                        animateVehicleVariantSwap(
                                            state.horse,
                                            vid,
                                            'base',
                                            state.finished ? 'finish' : 'run'
                                        );
                                    }
                                }
                            }
                        }
                        // 이펙트 요소 제거
                        if (gimmick.effectElement && gimmick.effectElement.parentNode) {
                            gimmick.effectElement.remove();
                            gimmick.effectElement = null;
                        }
                        if (gimmick.speedLinesElement && gimmick.speedLinesElement.parentNode) {
                            gimmick.speedLinesElement.remove();
                            gimmick.speedLinesElement = null;
                        }
                        // 연쇄 기믹 활성화
                        // - Evolution 체인만 triggered:false로 push → 같은 forEach 루프에서
                        //   트리거 블록이 실행되어 power SVG 교체가 발동됨.
                        //   (SVG 변환은 Evolution 기믹 전용 — 다른 체인에서 발동되면 안 됨)
                        // - 그 외 체인(reverse_boost 등)은 기존처럼 triggered:true로 즉시 활성화
                        //   (속도 배수만 반영, 시각 효과 분기는 기존 동작 유지)
                        if (gimmick.nextGimmick && !gimmick.chainTriggered) {
                            gimmick.chainTriggered = true;
                            const isEvolutionChain = gimmick.nextGimmick.type === 'evolution_boost' || gimmick.nextGimmick.type === 'evolution_fake_boost';
                            const chainGimmick = {
                                progressTrigger: 0,
                                type: gimmick.nextGimmick.type,
                                duration: gimmick.nextGimmick.duration,
                                speedMultiplier: gimmick.nextGimmick.speedMultiplier,
                                nextGimmick: null,
                                triggered: !isEvolutionChain,
                                active: !isEvolutionChain,
                                endTime: isEvolutionChain ? 0 : elapsed + gimmick.nextGimmick.duration
                            };
                            state.gimmicks.push(chainGimmick);
                            // 비-Evolution 체인(reverse_boost)은 triggered:true로 push되어 위 트리거 블록을
                            // 영영 안 타므로 시각 연출을 여기서 직접 적용 (트리거 블록과 동일 처리).
                            // ⚠️ push 객체의 triggered/active/endTime은 서버 시뮬 속도 parity — 변경 금지.
                            if (!isEvolutionChain && chainGimmick.type === 'reverse_boost') {
                                state.horse.style.filter = 'brightness(1.4) saturate(1.8)';
                                state.horse.style.transform = '';
                                const rBoostEffect = document.createElement('div');
                                rBoostEffect.className = 'gimmick-effect-reverse-boost';
                                rBoostEffect.textContent = '💨🔥';
                                rBoostEffect.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:14px;';
                                state.horse.appendChild(rBoostEffect);
                                chainGimmick.effectElement = rBoostEffect;
                                // 체인 기믹은 triggered:true로 push되어 트리거 블록을 안 탐 — 이벤트 컷 훅을 여기서 직접 호출
                                maybeStartEventCut(chainGimmick, state);
                            }
                        }
                    }
                });
                
                // 활성화된 기믹에 따른 속도 계산
                let speedMultiplier = 1;
                let hasActiveGimmick = false;
                state.gimmicks.forEach(gimmick => {
                    if (gimmick.active) {
                        hasActiveGimmick = true;
                        speedMultiplier = gimmick.speedMultiplier;
                        
                        // 지그재그 효과
                        if (gimmick.type === 'wobble') {
                            state.wobblePhase += 0.3;
                            const wobbleOffset = Math.sin(state.wobblePhase) * 3;
                            state.horse.style.transform = `translateY(${wobbleOffset}px)`;
                        }
                    }
                });
                
                // 지그재그/역주행이 아닐 때 transform 리셋
                // (reverse는 트리거 시 scaleX(-1) 반전 유지 필요 — wobble·reverse 동시 active면 wobble의 translateY가 이김)
                if (!state.gimmicks.some(g => g.active && (g.type === 'wobble' || g.type === 'reverse'))) {
                    state.horse.style.transform = '';
                }
                
                // 자연스러운 속도 변화 (기믹이 없을 때) - 서버와 동기화된 고정 스텝 사용
                // simElapsed: 서버와 동일한 16ms 고정 스텝으로 누적 (RNG 동기화용)
                while (state.simElapsed + 16 <= elapsed) {
                    state.simElapsed += 16;
                }

                if (!hasActiveGimmick) {
                    // 주기적으로 목표 속도 변경 (가속/감속) - 500ms 간격
                    const changeInterval = 500;
                    const currentInterval = Math.floor(state.simElapsed / changeInterval);
                    const lastInterval = Math.floor(state.lastSpeedChange / changeInterval);

                    if (currentInterval > lastInterval) {
                        state.lastSpeedChange = state.simElapsed;
                        // 시드 기반 속도 변화 (0.7 ~ 1.3 범위)
                        const speedSeed = (state.speedChangeSeed + currentInterval) * 16807 % 2147483647;
                        const speedFactor = 0.7 + (speedSeed % 600) / 1000;
                        state.targetSpeed = state.baseSpeed * speedFactor;
                    }

                    // 프레임 독립적 lerp 보간
                    const lerpFactor = 1 - Math.pow(0.95, deltaTime / 16);
                    const speedDiff = state.targetSpeed - state.currentSpeed;
                    state.currentSpeed += speedDiff * lerpFactor;
                    speedMultiplier = state.currentSpeed / state.baseSpeed;
                }
                
                // 날씨 보정 적용 (서버와 동일)
                if (weatherSchedule.length > 0 && selectedVehicleTypes && selectedVehicleTypes[state.horseIndex]) {
                    const vehicleModifiers = weatherConfig.vehicleModifiers || {};
                    const vehicleMods = vehicleModifiers[selectedVehicleTypes[state.horseIndex]];
                    if (vehicleMods && vehicleMods[currentWeather]) {
                        speedMultiplier *= vehicleMods[currentWeather];
                    }
                }

                // 위치 업데이트 (완전 정지 전까지)
                if (!state.finished) {
                    let movement;
                    if (state.finishJudged) {
                        // 도착 판정 후 감속 이동 (왼쪽 끝이 결승선을 넘을 때까지)
                        const finishSpeedFactor = 0.35; // 35% 속도로 감속
                        movement = state.baseSpeed * finishSpeedFactor * deltaTime * slowMotionFactor;
                    } else {
                        movement = state.baseSpeed * speedMultiplier * deltaTime * slowMotionFactor;
                    }
                    state.currentPos = Math.max(startPosition, state.currentPos + movement);
                }

                // 상위 순위 말이 아직 결승선 미통과 시 결승선 앞에서 fallen 연출
                // 버퍼는 탈것별 동적 — 최종 정착 위치가 모든 탈것에서 finishLine - FALL_FINAL_GAP_PX 로 정렬됨
                if (!state.finishJudged) {
                    const higherRankedPending = horseStates.some(s => s.rank < state.rank && !s.finishJudged);
                    const stunBuffer = (typeof getFinishStunBuffer === 'function')
                        ? getFinishStunBuffer(state.visualWidth)
                        : ((typeof FINISH_STUN_BUFFER_PX === 'number') ? FINISH_STUN_BUFFER_PX : 20);
                    // 결승선 직전에서 자빠지면 fallen 슬라이드가 결승선을 넘는 그림이 나옴 → 12m(120px) 뒤에서 자빠지게
                    const earlyStunDistance = 120;
                    const shouldStun = higherRankedPending && state.currentPos + state.visualWidth >= finishLine - stunBuffer - earlyStunDistance;
                    if (shouldStun) {
                        state.currentPos = finishLine - state.visualWidth - stunBuffer - earlyStunDistance;
                        if (!state.finishStunned) {
                            state.finishStunned = true;
                            console.log(`[DEBUG] 말 ${state.horseIndex} 결승 대기 자빠짐! rank=${state.rank}, pos=${state.currentPos.toFixed(0)}`);
                            const vid = state.horse.dataset.vehicleId;
                            if (vid) {
                                // catch-up 중엔 낙하 전환 연출(타이머) 대신 직접 스왑 — 반복 토글 churn/스테일 타이머 방지
                                if (!isCatchingUp && typeof animateVehicleFallState === 'function') {
                                    animateVehicleFallState(state.horse, vid, 'fallen');
                                } else {
                                    setVehicleState(state.horse, vid, 'fallen');
                                }
                            }
                        }
                    } else if (state.finishStunned) {
                        state.finishStunned = false;
                        const vid = state.horse.dataset.vehicleId;
                        if (vid) {
                            if (!isCatchingUp && typeof animateVehicleFallState === 'function') {
                                animateVehicleFallState(state.horse, vid, 'run');
                            } else {
                                setVehicleState(state.horse, vid, 'run');
                            }
                        }
                    }
                }

                // 결승선 도착 체크 (탈것의 오른쪽 끝 = currentPos + visualWidth가 결승선에 닿으면 도착 판정)
                const horseRightEdge = state.currentPos + state.visualWidth;

                // 1단계: 오른쪽 끝이 결승선에 닿으면 "도착 판정" (순위 확정)
                // 서버에서 슬로우모션 포함 순위 계산 → 대기 로직 불필요
                if (horseRightEdge >= finishLine && !state.finishJudged) {
                    // 도착 판정 완료 (순위 확정, 아직 이동은 계속)
                    state.finishJudged = true;
                    state.finishOrder = state.rank; // 서버 순위 사용
                    finishOrderCounter = Math.max(finishOrderCounter, state.rank + 1);
                    console.log(`[DEBUG] 말 ${state.horseIndex} 도착 판정! pos=${state.currentPos.toFixed(0)}, 결승선=${finishLine}`);

                    if (state.rank === 0 && state._evolutionBoostUsed && !state._evolutionWinAnnounced) {
                        state._evolutionWinAnnounced = true;
                        announceEvolutionStage('evolutionWin', state, 3600);
                    }

                    // 도착 애니메이션 표시 (순위 뱃지)
                    showFinishAnimation(state.horse, state.finishOrder, state.horseIndex);

                    // 1등 결승 후 → 0.8초 유지 후 타깃 등수(또는 꼴등) 베팅 말로 부드럽게 패닝
                    // (catch-up 중엔 스케줄 억제 — 그 시점은 이미 지나갔고 reconcile이 카메라를 스냅)
                    if (state.rank === 0 && !isCatchingUp) {
                        setTimeout(() => {
                            const bettedIndices = [...new Set(Object.values(userHorseBets))];
                            const unfinishedDesc = horseStates
                                .filter(s => !s.finishJudged && bettedIndices.includes(s.horseIndex))
                                .sort((a, b) => b.currentPos - a.currentPos);  // 빠른 순
                            if (unfinishedDesc.length === 0) return;

                            const _tr = window._targetRank;
                            let target;
                            if (typeof _tr === 'number' && _tr >= 1) {
                                if (_tr === 1) return;  // 1등이 이미 들어옴 — 패닝 불필요
                                // 2등 → unfinishedDesc[0] / 3등 → [1] / ... / 꼴등 → 마지막
                                const idx = Math.min(_tr - 2, unfinishedDesc.length - 1);
                                target = unfinishedDesc[Math.max(0, idx)];
                            } else {
                                target = unfinishedDesc[unfinishedDesc.length - 1];  // 꼴등
                            }
                            if (target) {
                                panningToLoser = true;
                                panStartTime = Date.now();
                                panStartOffset = currentScrollOffset;
                                loserCameraTarget = target;
                                panTargetOffset = loserCameraTarget.currentPos - trackWidth * 0.3;
                            }
                        }, 800);
                    }
                }

                // 2단계: 왼쪽 끝(currentPos)이 결승선을 넘으면 "완전 정지"
                if (state.finishJudged && state.currentPos >= finishLine && !state.finished) {
                    state.finished = true;
                    state.horse.style.filter = '';
                    state.horse.style.transform = '';
                    console.log(`[DEBUG] 말 ${state.horseIndex} 완전 정지! pos=${state.currentPos.toFixed(0)}`);

                    // finish 상태 SVG로 전환 (감속 걷기 → 정지)
                    const vid = state.horse.dataset.vehicleId;
                    if (vid) {
                        setVehicleState(state.horse, vid, 'finish');
                        // 프레임 애니메이션 속도 감속 (0.15s → 0.4s)
                        const sprite = state.horse.querySelector('.vehicle-sprite');
                        if (sprite) {
                            const { frame1: f1, frame2: f2 } = getVehicleSpriteFrameElements(sprite);
                            if (f1) f1.style.animationDuration = '0.4s';
                            if (f2) f2.style.animationDuration = '0.4s';
                        }
                    }
                }
            });

            maybeAnnounceEvolutionLead(horseStates);

            // 렌더(카메라/스크롤/말 위치/미니맵) — catch-up 동기 루프 중에는 스킵하고 물리만 진행
            if (!isCatchingUp) renderFrame();

            // 종료 조건: 베팅된 말 중 뒤에서 두 번째가 완주하면 종료
            const totalHorses = horseStates.length;
            const bettedIndicesForEnd = [...new Set(Object.values(userHorseBets))];
            const bettedFinishedCount = horseStates.filter(s => bettedIndicesForEnd.includes(s.horseIndex) && s.finished).length;
            const bettedTotal = bettedIndicesForEnd.length;
            // 베팅된 말이 1마리면 그 말 완주 시 종료, 2마리 이상이면 뒤에서 두 번째 완주 시
            const raceEndThreshold = bettedTotal <= 1 ? bettedTotal : bettedTotal - 1;
            const shouldEndRace = bettedFinishedCount >= raceEndThreshold;

            if (shouldEndRace) {
                raceEnded = true; // catch-up 동기 루프 즉시 탈출 + 스텝 재진입 방지 (종료 블록 1회 실행 보장)
                if (isCatchingUp) {
                    // 숨김 구간에서 종주 — 비석/사망 연출이 최신 위치를 읽도록 최종 상태를 1회 화면 반영
                    snapCameraToTarget();
                    renderFrame();
                }
                raceAnimWin().cancelAnimationFrame(animationFrameId); // 예약한 창(PiP 가능)에서 취소
                animationFrameId = null;
                window._raceAnimFrameId = null;
                document.removeEventListener('visibilitychange', onVisChange);
                if (window._raceVisHandler === onVisChange) window._raceVisHandler = null;
                // 개정3: 레이스 종료는 PiP를 건드리지 않는다 — 래퍼는 창이 열려 있는 한 PiP에 남고,
                // 멈춘 트랙이 창에 그대로 보인다. 사망 연출 오버레이는 doc-aware(raceDoc().body)로 생성.
                removeQuickRaceOverlay();

                // 슬로우모션 강제 해제
                slowMotionFactor = 1;
                slowMotionActive = false;
                loserSlowMotionActive = false;
                loserReleaseTarget = null;
                loserCameraTarget = null;
                activeEventCut = null; // 이벤트 컷 방어적 정리
                if (cameraModeBefore) { cameraMode = cameraModeBefore; cameraModeBefore = null; }
                track.style.filter = '';
                const vignetteCleanup = raceDoc().getElementById('slowmoVignette');
                if (vignetteCleanup) {
                    vignetteCleanup.style.opacity = '0';
                    setTimeout(() => vignetteCleanup.remove(), 500);
                }
                // 슬로우모션 환호성 정지
                if (window.SoundManager) {
                    SoundManager.stopLoop('horse-race_slowmo_cheer');
                }

                // 날씨 요소 정리 (raceDoc — 복귀 실패 등 어느 문서에 있어도 잔존 없이)
                const weatherOverlayCleanup = raceDoc().getElementById('weatherOverlay');
                const weatherBannerCleanup = raceDoc().getElementById('weatherBanner');
                if (weatherOverlayCleanup) {
                    weatherOverlayCleanup.style.opacity = '0';
                    setTimeout(() => weatherOverlayCleanup.remove(), 800);
                }
                if (weatherBannerCleanup) {
                    weatherBannerCleanup.style.opacity = '0';
                    setTimeout(() => weatherBannerCleanup.remove(), 800);
                }
                // 버프/디버프 인디케이터 제거
                raceDoc().querySelectorAll('.weather-indicator').forEach(el => el.remove());

                // 미완주 말들 전부 찾기 (비석 대상) - 결승선에 닿지 않은 말만
                const unfinishedStates = horseStates.filter(s => !s.finishJudged);

                // 실제 도착 순서 수집 (결승선에 닿은 말들만)
                const actualFinishOrder = horseStates
                    .filter(s => s.finishJudged)
                    .sort((a, b) => a.finishOrder - b.finishOrder)
                    .map(s => s.horseIndex);

                // 미완주 말들을 서버 순위(rank) 기준으로 정렬 후 순서대로 추가
                const baseFinishOrder = actualFinishOrder.length;
                console.log(`[DEBUG-TOMBSTONE] baseFinishOrder=${baseFinishOrder}, unfinishedStates.length=${unfinishedStates.length}`);
                console.log(`[DEBUG-TOMBSTONE] unfinishedStates:`, unfinishedStates.map(s => ({horseIndex: s.horseIndex, rank: s.rank, currentPos: s.currentPos.toFixed(0)})));
                unfinishedStates
                    .sort((a, b) => a.rank - b.rank) // 서버 순위(rank) 기준
                    .forEach((s, idx) => {
                        s.finished = true;
                        s.finishOrder = baseFinishOrder + idx;
                        console.log(`[DEBUG-TOMBSTONE] horse ${s.horseIndex}: finishOrder=${s.finishOrder} (${s.finishOrder+1}등)`);
                        actualFinishOrder.push(s.horseIndex);
                    });

                // 전역 변수에 저장
                window.lastActualFinishOrder = actualFinishOrder;

                // 미완주 말들 전부 비석 애니메이션 후 게임 종료
                // ⚠️ 각 setTimeout 재진입 지점에 세대 가드 — 지연 완주 클라이언트의 tail이 다음 라운드
                //    시작 후 발화하면 stale showRaceResult/raceAnimationComplete emit이 새 라운드를 오염시킴
                const finishGame = () => {
                    if (myRaceGen !== window._raceGen) return;
                    setTimeout(() => {
                        if (myRaceGen !== window._raceGen) return;
                        if (rankingInterval) {
                            clearInterval(rankingInterval);
                            rankingInterval = null;
                            window._raceRankingInterval = null;
                        }
                        // 최종 순위 한 번 더 업데이트
                        updateLiveRanking(horseStates);
                        // 잠시 후 패널 숨기기 및 콜백 호출
                        setTimeout(() => {
                            // onComplete 직전 필수 가드 — 다음 라운드 pendingRaceResult 조기 소비 차단
                            if (myRaceGen !== window._raceGen) return;
                            if (liveRankingPanel) {
                                liveRankingPanel.style.display = 'none';
                            }
                            const minimap = raceDoc().getElementById('raceMinimap');
                            if (minimap) minimap.style.display = 'none';
                            // 채팅 오버레이 해제
                            if (typeof window.hideRaceChatOverlay === 'function') {
                                window.hideRaceChatOverlay();
                            }
                            // 완료 콜백 호출
                            if (onComplete) {
                                onComplete(actualFinishOrder);
                            }
                        }, 600);
                    }, 200);
                };

                // 미완주 말 전부 비석 애니메이션 + 꼴등한테 카메라 이동
                if (unfinishedStates.length > 0) {
                    // 꼴등(가장 느린 말)한테 카메라 이동
                    const loserState = unfinishedStates[unfinishedStates.length - 1];
                    loserCameraTarget = loserState;
                    cameraModeBefore = cameraMode;
                    cameraMode = '_loser';
                    updateCameraBtnUI();

                    let completedCount = 0;
                    unfinishedStates.forEach((st) => {
                        showDeathAnimation(st.horse, st.horseIndex, st.finishOrder, () => {
                            if (myRaceGen !== window._raceGen) return; // stale 비석 콜백(4s 지연) — 종료 시퀀스 중단
                            completedCount++;
                            if (completedCount >= unfinishedStates.length) {
                                finishGame();
                            }
                        });
                    });
                } else {
                    finishGame();
                }
                return; // 레이스 종료 — 스텝 탈출 (재예약 중단은 raceEnded 플래그로 래퍼/catch-up 루프가 처리)
            }
        }
        // PiP 드라이버 훅 등록 — detach/reattach가 클로저 내부(animLoop/pausedAt)를 제어할 유일한 통로.
        // _raceGen 세대 가드로 stale 레이스의 훅 오발화를 차단한다 (전역 계약은 _raceAnimWin만 신설).
        _raceDriverHooks = {
            gen: myRaceGen,
            reschedule: function () {
                if (raceEnded) return;
                if (myRaceGen !== window._raceGen) return;
                animationFrameId = window._raceAnimFrameId = raceAnimWin().requestAnimationFrame(animLoop);
            },
            rearmPause: function () {
                if (raceEnded) return;
                if (window._raceAnimFrameId == null) return; // 중단된 레이스 — 재무장 불필요
                if (document.hidden) pausedAt = Date.now();  // 복귀 시 onVisChange가 catch-up으로 따라잡음
            },
            // attach 순간 일시정지 해제 — onVisChange 복귀 분기와 동일 산식(새 산식 발명 금지).
            // 숨김 탭에서 init이 발화해 pausedAt이 세팅된 채 자동 attach되는 케이스의 유일한 해제 경로
            // (attach 후 onVisChange는 attached 우회로 복귀 분기에 못 들어간다).
            resumeIfPaused: function () {
                if (raceEnded) return;
                if (myRaceGen !== window._raceGen) return;
                if (pausedAt === 0) return;
                if (isReplay) {
                    // 다시보기: 동기화할 라이브 시점이 없음 — 멈춘 지점부터 재생 (기존 동작 유지)
                    startTime += (Date.now() - pausedAt);
                    lastFrameTime = Date.now();
                    pausedAt = 0;
                } else {
                    // 라이브: 숨김 구간을 즉시 시뮬레이션해 전원과 같은 진행 지점으로 점프
                    pausedAt = 0;
                    catchUpToLive();
                }
            }
        };
        // 개정3: 창이 열려 있으면 래퍼는 이미 상시 attach — attachTrack은 attach 실패 창의 재시도 방어(멱등).
        // resumeIfPaused는 필수: attach 상태에서 init이 숨김 탭에서 발화하면 pausedAt이 세팅되는데,
        // onVisChange가 attached 우회라 여기서 해제하지 않으면 시작선 동결이 된다 (미attach면 정상 pause 유지).
        racePipAttachTrack();
        if (racePipAttached()) racePipResumeIfPaused();
        animationFrameId = window._raceAnimFrameId = raceAnimWin().requestAnimationFrame(animLoop);

        // 실시간 순위 업데이트 시작 (100ms 간격)
        rankingInterval = window._raceRankingInterval = setInterval(() => updateLiveRanking(horseStates), 100);
        updateLiveRanking(horseStates); // 즉시 첫 업데이트

        // 이 setTimeout이 스로틀로 늦게 발화한 채 이미 화면이 보이는 경우(숨김→500ms 내 복귀 등):
        // visibilitychange가 다시 오지 않으므로 여기서 즉시 라이브 지점까지 따라잡는다.
        // 정상 가시 클라이언트는 지연이 프레임 1개(50ms) 미만이라 스킵 — 동작 무변경.
        if (!document.hidden && Date.now() - startTime > 50) {
            catchUpToLive();
        }
    }, 500);
    
    return maxDuration + 1000;
}

// 순위 이펙트 오버레이 관리
var finishEffectsOverlay = null;
var finishEffectElements = new Map(); // horseIndex -> effectElement

function getOrCreateFinishEffectsOverlay() {
    // 트랙이 있는 문서의 body에 생성 — PiP attach면 PiP body (유령 좌표가 트랙 뷰포트 기준이 되게).
    // 전체화면(API)에서는 전체화면 요소(스테이지) 하위만 렌더되므로 body 직속이면 이펙트가 안 보인다
    // → 활성 시 스테이지를 부모로. ⚠️ 스케일 루트가 아니라 스테이지에 붙인다 — 루트는 transform이 걸려
    // fixed의 컨테이닝 블록이 되어 getBoundingClientRect(뷰포트 좌표)와 어긋난다.
    // fixed 오버레이는 스테이지에 transform이 없으므로 뷰포트 기준 유지 → gBCR과 정확히 일치.
    var doc = raceDoc();
    var host = doc.body;
    if (_raceFsActive && doc === document) {
        var fsStage = document.getElementById('raceFsStage');
        if (fsStage) host = fsStage;
    }
    if (finishEffectsOverlay && (finishEffectsOverlay.ownerDocument !== doc || finishEffectsOverlay.parentNode !== host)) {
        // 창 열기/닫기 또는 전체화면 진입/종료로 부모가 바뀜 — 이전 오버레이는 버리고 재생성
        try { finishEffectsOverlay.remove(); } catch (e) {}
        finishEffectsOverlay = null;
        finishEffectElements.clear();
    }
    if (!finishEffectsOverlay) {
        finishEffectsOverlay = doc.createElement('div');
        finishEffectsOverlay.id = 'finishEffectsOverlay';
        finishEffectsOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 99999;
        `;
        host.appendChild(finishEffectsOverlay);
    }
    return finishEffectsOverlay;
}

function clearFinishEffects() {
    if (finishEffectsOverlay) {
        finishEffectsOverlay.remove();
        finishEffectsOverlay = null;
    }
    finishEffectElements.clear();
}

// 도착 애니메이션 표시 (텍스트 스타일, 말 내부 왼쪽에 표시)
function showFinishAnimation(horseElement, finishOrder, horseIndex) {
    const rankTexts = ['🥇 1등!', '🥈 2등!', '🥉 3등!', '4등', '5등', '6등'];
    const rankColors = ['#FFD700', '#C0C0C0', '#CD7F32', '#888', '#888', '#888'];

    const existingEffect = finishEffectElements.get(horseIndex);
    if (existingEffect) existingEffect.remove();

    // 말 요소 안에 자식으로 삽입 (overflow visible로 왼쪽에 표시)
    horseElement.style.overflow = 'visible';

    const label = document.createElement('div');
    label.className = 'finish-effect';
    label.dataset.horseIndex = horseIndex;

    const fontSize = finishOrder === 0 ? '20px' : finishOrder <= 2 ? '17px' : '14px';

    label.style.cssText = `
        position: absolute;
        left: -75px;
        top: 40%;
        transform: translateY(-50%);
        font-size: ${fontSize};
        font-weight: 900;
        color: ${rankColors[finishOrder] || '#888'};
        pointer-events: none;
        z-index: 10;
        white-space: nowrap;
        animation: tombstoneDrop 0.5s ease-out forwards;
        opacity: 0;
    `;
    label.textContent = rankTexts[finishOrder] || `${finishOrder + 1}등`;

    horseElement.appendChild(label);
    finishEffectElements.set(horseIndex, label);

    // 1등 특별 효과: victory SVG + 금빛 효과
    if (finishOrder === 0) {
        const vid = horseElement.dataset.vehicleId;
        if (vid) setVehicleState(horseElement, vid, 'victory');
        horseElement.style.filter = 'drop-shadow(0 0 15px gold) brightness(1.2)';
        horseElement.style.transform = 'scale(1.1)';
    }
}

// 꼴등 사망 애니메이션 (시체 페이드 아웃 + 영혼만 오버레이, 비석은 트랙 안쪽에 그려서 스크롤과 함께 유지)
function showDeathAnimation(horseElement, horseIndex, finishRank, onComplete) {
    const track = raceDoc().getElementById('raceTrack'); // 정상 흐름은 복귀 후(메인) — 방어적 doc-aware
    const overlay = getOrCreateFinishEffectsOverlay();
    const horseRect = horseElement.getBoundingClientRect();
    
    // 기존 오버레이 이펙트만 제거 (비석은 트랙에 있으므로 여기서 제거 대상 아님)
    const existingEffect = finishEffectElements.get(horseIndex);
    if (existingEffect) existingEffect.remove();
    
    // dead 상태 SVG로 전환 (비석 + 유령)
    const vid = horseElement.dataset.vehicleId;
    if (vid) setVehicleState(horseElement, vid, 'dead');
    // 프레임 애니메이션 중지
    horseElement.classList.remove('racing');

    // BGM 정지 - 비석(사망) 애니메이션 시작 시
    if (window.SoundManager) {
        SoundManager.stopLoop('horse-race_bgm');
    }

    // 탈것 페이드 아웃 후 완전히 사라짐
    horseElement.style.animation = 'deathFade 2s ease-out forwards';
    
    // 영혼만 오버레이에 표시 (위로 올라가며 사라짐)
    const soulContainer = document.createElement('div');
    soulContainer.className = 'death-effect soul-only';
    soulContainer.dataset.horseIndex = horseIndex;
    soulContainer.style.cssText = `
        position: fixed;
        left: ${horseRect.left + horseRect.width / 2 - 15}px;
        top: ${horseRect.top + horseRect.height / 2 - 15}px;
        width: 30px;
        height: 40px;
        pointer-events: none;
        z-index: 10000;
    `;
    const soul = document.createElement('div');
    soul.innerHTML = '👻';
    soul.style.cssText = `
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        font-size: 30px;
        animation: soulRise 3s ease-out forwards;
        text-shadow: 0 0 10px rgba(255,255,255,0.8);
    `;
    soulContainer.appendChild(soul);
    // 유령은 PiP body 직속 fixed 오버레이(스케일 루트 밖)라 fit transform을 못 받는다 — 트랙과 비석은
    // 줄어드는데 👻만 원래 크기로 떠서 상승 거리(soulRise -100px)까지 과하게 보인다. 여기서 직접 곱한다.
    // transform이 아닌 개별 scale 프로퍼티를 써서 자식(soul)의 soulRise transform 애니메이션과 충돌시키지 않는다.
    // 위치는 getBoundingClientRect(뷰포트 좌표 = transform 반영)라 이미 정확 — 크기만 보정한다.
    if (racePipAttached() && Math.abs(_racePipScaleK - 1) > 0.01) {
        soulContainer.style.transformOrigin = 'top center';
        soulContainer.style.scale = String(_racePipScaleK);
    }
    overlay.appendChild(soulContainer);
    finishEffectElements.set(horseIndex, soulContainer);
    setTimeout(() => {
        if (soulContainer.parentNode) soulContainer.remove();
        finishEffectElements.delete(horseIndex);
    }, 3500);
    
    // 비석은 트랙 안쪽에 추가 (꼴등 전용)
    if (track) {
        const leftPx = horseElement.offsetLeft + (horseElement.offsetWidth / 2) - 25;
        const topPx = horseElement.offsetTop + (horseElement.offsetHeight / 2) - 40;
        const tombstoneWrap = document.createElement('div');
        tombstoneWrap.className = 'tombstone-in-track';
        tombstoneWrap.dataset.horseIndex = horseIndex;
        tombstoneWrap.style.cssText = `
            position: absolute;
            left: ${leftPx}px;
            top: ${topPx}px;
            pointer-events: none;
            z-index: 150;
            font-size: 35px;
            text-align: center;
            animation: tombstoneDrop 1.6s ease-out 1s forwards;
            opacity: 0;
            filter: drop-shadow(2px 4px 6px rgba(0,0,0,0.5));
        `;
        tombstoneWrap.innerHTML = `🪦<span style="display:block;font-size:12px;font-weight:bold;color:var(--gray-700);">${finishRank + 1}등</span>`;
        track.appendChild(tombstoneWrap);
    }
    
    setTimeout(() => {
        if (onComplete) onComplete();
    }, 4000);
}

// 축하 컨페티 생성
function createConfetti() {
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
    let confettiHtml = '';
    
    for (let i = 0; i < 20; i++) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        const left = Math.random() * 80 - 10;
        const delay = Math.random() * 0.3;
        const rotation = Math.random() * 360;
        const size = 4 + Math.random() * 4;
        const duration = 1 + Math.random() * 0.5;
        
        confettiHtml += `
            <div style="
                position: absolute;
                left: ${left}px;
                top: 0;
                width: ${size}px;
                height: ${size}px;
                background: ${color};
                transform: rotate(${rotation}deg);
                animation: confettiFall ${duration}s ease-out ${delay}s forwards;
                opacity: 0;
                border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
            "></div>
        `;
    }
    
    return confettiHtml;
}

const VEHICLE_VARIANT_TRANSITION_MS = 360;

function createVehicleSpriteLayer(frame1Markup, frame2Markup, className = 'vehicle-active-layer') {
    const layer = document.createElement('div');
    layer.className = className;

    const frame1 = document.createElement('div');
    frame1.className = 'frame1';
    frame1.innerHTML = frame1Markup || '';

    const frame2 = document.createElement('div');
    frame2.className = 'frame2';
    frame2.innerHTML = frame2Markup || frame1Markup || '';

    layer.appendChild(frame1);
    layer.appendChild(frame2);
    return layer;
}

function getVehicleSpriteActiveLayer(sprite) {
    if (!sprite) return null;
    return Array.from(sprite.children).find(child => child.classList && child.classList.contains('vehicle-active-layer')) || sprite;
}

function getVehicleSpriteFrameElements(sprite) {
    const layer = getVehicleSpriteActiveLayer(sprite);
    if (!layer) {
        return { layer: null, frame1: null, frame2: null };
    }

    const directChildren = Array.from(layer.children || []);
    const frame1 = directChildren.find(child => child.classList && child.classList.contains('frame1')) || layer.querySelector('.frame1');
    const frame2 = directChildren.find(child => child.classList && child.classList.contains('frame2')) || layer.querySelector('.frame2');
    return { layer, frame1, frame2 };
}

function getVehicleVariantResource(vehicleId, variant = 'base') {
    if (typeof getVehicleVariantSVG === 'function') {
        return getVehicleVariantSVG(vehicleId, variant);
    }
    if (variant === 'power' && typeof getVehiclePowerSVG === 'function') {
        return getVehiclePowerSVG(vehicleId);
    }
    if (typeof getVehicleBaseSVG === 'function') {
        return getVehicleBaseSVG(vehicleId);
    }
    return getVehicleSVG(vehicleId);
}

function resolveVehicleStateData(vehicleId, state, variant = 'base') {
    // lose state는 외부 atlas에서 우선 조회 (변형/파워 무관 단일 자산)
    if (state === 'lose' && typeof getVehicleLoseState === 'function') {
        const loseData = getVehicleLoseState(vehicleId);
        if (loseData) return loseData;
    }

    const preferredResource = getVehicleVariantResource(vehicleId, variant) || {};
    const baseResource = variant === 'base'
        ? preferredResource
        : (getVehicleVariantResource(vehicleId, 'base') || getVehicleSVG(vehicleId) || {});

    const preferredState = preferredResource[state] || (preferredResource.frame1 ? preferredResource : null);
    if (preferredState) return preferredState;

    const baseState = baseResource[state] || baseResource.run || baseResource.idle || (baseResource.frame1 ? baseResource : null);
    if (baseState) return baseState;

    return preferredResource.run || preferredResource.idle || (preferredResource.frame1 ? preferredResource : null) || null;
}

function writeVehicleSpriteState(sprite, stateData) {
    if (!sprite || !stateData) return;
    const { frame1, frame2 } = getVehicleSpriteFrameElements(sprite);

    // 외부 SVG atlas 지원 (lose state 등) — 인라인 SVG 대신 background-image로 좌/우 셀 표시
    if (stateData.external && stateData.src) {
        const cellW = stateData.cellWidth || 60;
        const cellH = stateData.cellHeight || 45;
        const atlasW = stateData.atlasWidth || (cellW * (stateData.frames || 2));
        const atlasH = stateData.atlasHeight || cellH;
        const applyExternal = (el, posX) => {
            if (!el) return;
            el.innerHTML = '';
            el.style.backgroundImage = `url('${stateData.src}')`;
            el.style.backgroundSize = `${atlasW}px ${atlasH}px`;
            el.style.backgroundPosition = `${posX}px 0`;
            el.style.backgroundRepeat = 'no-repeat';
            el.style.width = `${cellW}px`;
            el.style.height = `${cellH}px`;
        };
        applyExternal(frame1, 0);
        applyExternal(frame2, -cellW);
        return;
    }

    // 인라인 SVG 모드 — 외부 모드 잔존 스타일 정리
    const clearExternal = (el) => {
        if (!el) return;
        if (el.style.backgroundImage) {
            el.style.backgroundImage = '';
            el.style.backgroundSize = '';
            el.style.backgroundPosition = '';
            el.style.backgroundRepeat = '';
        }
    };
    clearExternal(frame1);
    clearExternal(frame2);
    if (frame1) frame1.innerHTML = stateData.frame1 || '';
    if (frame2) frame2.innerHTML = stateData.frame2 || stateData.frame1 || '';
}

function clearVehicleVariantTransition(sprite) {
    if (!sprite) return;
    if (sprite._vehicleVariantTransitionTimer) {
        clearTimeout(sprite._vehicleVariantTransitionTimer);
        sprite._vehicleVariantTransitionTimer = null;
    }
    sprite.classList.remove('vehicle-transforming', 'vehicle-transform-to-power', 'vehicle-transform-to-base');
    sprite.querySelectorAll('.vehicle-transition-layer, .vehicle-transition-flash').forEach(node => node.remove());
}

function animateVehicleVariantSwap(horseElement, vehicleId, variant, state = 'run') {
    const sprite = horseElement && horseElement.querySelector('.vehicle-sprite');
    const stateData = resolveVehicleStateData(vehicleId, state, variant);

    if (!sprite || !stateData) {
        if (horseElement) horseElement.dataset.vehicleVariant = variant;
        setVehicleState(horseElement, vehicleId, state);
        return;
    }

    clearVehicleVariantTransition(sprite);

    const { frame1, frame2 } = getVehicleSpriteFrameElements(sprite);
    const outgoingFrame1 = frame1 ? frame1.innerHTML : '';
    const outgoingFrame2 = frame2 ? frame2.innerHTML : '';

    horseElement.dataset.vehicleVariant = variant;
    writeVehicleSpriteState(sprite, stateData);

    if (outgoingFrame1 || outgoingFrame2) {
        const outgoingLayer = createVehicleSpriteLayer(
            outgoingFrame1,
            outgoingFrame2,
            'vehicle-transition-layer vehicle-transition-outgoing'
        );
        sprite.appendChild(outgoingLayer);
    }

    const flash = document.createElement('div');
    flash.className = 'vehicle-transition-flash';
    sprite.appendChild(flash);

    const directionClass = variant === 'power' ? 'vehicle-transform-to-power' : 'vehicle-transform-to-base';
    void sprite.offsetWidth;
    sprite.classList.add('vehicle-transforming', directionClass);
    sprite._vehicleVariantTransitionTimer = setTimeout(() => {
        clearVehicleVariantTransition(sprite);
    }, VEHICLE_VARIANT_TRANSITION_MS + 40);
}

// 탈것별 SVG 생성 함수
// 탈것 상태 전환 헬퍼
function setVehicleState(horseElement, vehicleId, state) {
    const sprite = horseElement && horseElement.querySelector('.vehicle-sprite');
    if (!sprite) return;

    const variant = horseElement.dataset.vehicleVariant || 'base';
    const stateData = resolveVehicleStateData(vehicleId, state, variant);
    writeVehicleSpriteState(sprite, stateData);
}


// 레인 생성 공통 함수
function createLane({ vehicleId, topPx, laneHeight, isRacing }) {
    const vehicleBg = getVehicleBackground(vehicleId);
    const lane = document.createElement('div');
    lane.style.cssText = `
        position: absolute;
        left: 0;
        top: ${topPx}px;
        width: 100%;
        height: ${laneHeight}px;
        background-image: ${vehicleBg.bg};
        background-size: ${isRacing ? 'auto 100%' : 'cover'};
        background-repeat: ${isRacing ? 'repeat-x' : 'no-repeat'};
        background-position: ${isRacing ? '0 center' : 'center'};
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
    `;

    // 배경 효과 추가
    if (vehicleBg.extra === 'road') {
        lane.innerHTML += `<div style="position: absolute; top: 50%; left: 0; width: 100%; height: 3px; background: repeating-linear-gradient(90deg, #fff 0px, #fff 20px, transparent 20px, transparent 40px);"></div>`;
    }
    if (vehicleBg.extra === 'stars') {
        for (let i = 0; i < 20; i++) {
            const size = 1 + Math.random() * 2;
            lane.innerHTML += `<div style="position: absolute; width: ${size}px; height: ${size}px; background: white; border-radius: 50%; left: ${Math.random() * 100}%; top: ${Math.random() * 100}%; opacity: ${0.5 + Math.random() * 0.5};"></div>`;
        }
    }
    if (vehicleBg.extra === 'waves') {
        lane.innerHTML += `<div style="position: absolute; bottom: 20%; left: 0; width: 100%; height: 4px; background: repeating-linear-gradient(90deg, transparent, transparent 15px, rgba(255,255,255,0.4) 15px, rgba(255,255,255,0.4) 30px);"></div>`;
        lane.innerHTML += `<div style="position: absolute; bottom: 40%; left: 10px; width: 100%; height: 3px; background: repeating-linear-gradient(90deg, transparent, transparent 20px, rgba(255,255,255,0.3) 20px, rgba(255,255,255,0.3) 35px);"></div>`;
    }
    if (vehicleBg.extra === 'clouds') {
        for (let i = 0; i < 4; i++) {
            const w = 25 + Math.random() * 20;
            lane.innerHTML += `<div style="position: absolute; width: ${w}px; height: ${w*0.5}px; background: rgba(255,255,255,0.7); border-radius: ${w/2}px; left: ${Math.random() * 85}%; top: ${10 + Math.random() * 50}%;"></div>`;
        }
    }
    if (vehicleBg.extra === 'carrots') {
        for (let i = 0; i < 6; i++) {
            lane.innerHTML += `<div style="position: absolute; font-size: 14px; left: ${10 + Math.random() * 80}%; top: ${40 + Math.random() * 50}%;">🥕</div>`;
        }
    }
    if (vehicleBg.extra === 'mountains') {
        lane.innerHTML += `<svg style="position: absolute; bottom: 30%; left: 0; width: 100%; height: 40%;" viewBox="0 0 100 40" preserveAspectRatio="none"><polygon points="0,40 15,15 30,40" fill="#7f8c8d"/><polygon points="20,40 40,10 60,40" fill="#95a5a6"/><polygon points="50,40 70,20 90,40" fill="#7f8c8d"/><polygon points="70,40 85,25 100,40" fill="#95a5a6"/></svg>`;
    }
    if (vehicleBg.extra === 'buildings') {
        lane.innerHTML += `<svg style="position: absolute; bottom: 0; left: 0; width: 100%; height: 35%;" viewBox="0 0 100 35" preserveAspectRatio="none"><rect x="0" y="10" width="8" height="25" fill="#1a252f"/><rect x="10" y="5" width="10" height="30" fill="#2c3e50"/><rect x="22" y="15" width="6" height="20" fill="#1a252f"/><rect x="30" y="8" width="12" height="27" fill="#34495e"/><rect x="45" y="12" width="8" height="23" fill="#2c3e50"/><rect x="55" y="3" width="10" height="32" fill="#1a252f"/><rect x="67" y="18" width="7" height="17" fill="#34495e"/><rect x="76" y="10" width="12" height="25" fill="#2c3e50"/><rect x="90" y="15" width="10" height="20" fill="#1a252f"/></svg>`;
    }

    return { lane, vehicleBg };
}

// 벽 생성 공통 함수
function createWall({ topPx, wallHeight }) {
    const wall = document.createElement('div');
    wall.style.cssText = `
        position: absolute;
        left: 0;
        top: ${topPx}px;
        width: 100%;
        height: ${wallHeight}px;
        background: linear-gradient(180deg, #2c3e50 0%, #34495e 50%, #2c3e50 100%);
        box-shadow:
            0 2px 4px rgba(0,0,0,0.3),
            inset 0 1px 2px rgba(255,255,255,0.1),
            inset 0 -1px 2px rgba(0,0,0,0.2);
        border-top: 1px solid rgba(255,255,255,0.2);
        border-bottom: 1px solid rgba(0,0,0,0.3);
        z-index: 10;
    `;
    return wall;
}

// 탈것별 배경 생성 함수
function getVehicleBackground(vehicleId) {
    // JSON에서 테마 데이터 가져오기
    const theme = vehicleThemes[vehicleId];
    
    if (theme) {
        // 배경 이미지 사용
        return {
            bg: `url('${theme.backgroundImage}')`,
            bgSize: 'cover',
            bgRepeat: 'no-repeat',
            bgPosition: 'center',
            textColor: getTextColorByTheme(theme.theme),
            theme: theme.theme,
            backgroundImage: theme.backgroundImage
        };
    }
    
    // 폴백: 기본값
    return {
        bg: 'linear-gradient(0deg, #333 0%, #333 30%, #555 30%, #555 70%, #87CEEB 70%, #87CEEB 100%)',
        textColor: '#fff',
        theme: 'expressway',
        backgroundImage: '/assets/backgrounds/expressway.png'
    };
}

// 테마에 따른 텍스트 색상 결정
function getTextColorByTheme(theme) {
    const themeColors = {
        'forest': '#fff',
        'sky': '#333',
        'expressway': '#fff',
        'ocean': '#fff',
        'road': '#fff',
        'beach': '#333'
    };
    return themeColors[theme] || '#fff';
}

// 경주 결과 표시
function showRaceResult(data, isReplay = false) {
    // 다시보기가 아닌 경우 중복 호출 방지
    if (!isReplay && raceResultShown) {
        console.warn('[showRaceResult] 중복 호출 차단!', new Error().stack);
        addDebugLog('⚠️ showRaceResult 중복 호출 무시', 'system');
        return;
    }
    console.log('[showRaceResult] 호출됨', { isReplay, raceResultShown, stack: new Error().stack });
    if (!isReplay) raceResultShown = true;

    isRaceActive = false;
    if (typeof stopRaceCommentary === 'function') stopRaceCommentary();
    updateStartButton(); // 게임 종료 시 버튼 상태 업데이트
    if (currentUsers.length > 0) updateUsers(currentUsers);

    const winners = data.winners || [];
    const horseRankings = data.horseRankings || [];
    const gameMode = data.horseRaceMode || 'last';
    // 타깃 등수 (N등 투표 결과). null = fallback 'last'(꼴등)
    const targetRankForResult = (typeof data.targetRank === 'number') ? data.targetRank : null;
    // 결과 표시 시 배너 숨김 (다음 라운드까지 비활성)
    updateTargetRankBanner(null, false);

    addDebugLog(`경주 결과: 당첨자 ${winners.length}명 (${winners.join(', ')})`, 'race');

    // 탈것 정보 가져오기 헬퍼 함수
    function getVehicleInfo(horseIndex) {
        const vehicleId = selectedVehicleTypes ? selectedVehicleTypes[horseIndex] : null;
        if (vehicleId && ALL_VEHICLES.length > 0) {
            const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId);
            if (vehicle) return { ...vehicle, vehicleId };
        }
        // 기본값
        return { id: 'horse', name: '말', emoji: '🐎', vehicleId: 'horse' };
    }
    
    // 해당 말에 베팅한 모든 사용자 찾기
    function getBettingUsers(horseIndex) {
        const users = [];
        Object.entries(userHorseBets).forEach(([userName, betHorse]) => {
            if (betHorse === horseIndex) {
                users.push(userName);
            }
        });
        return users;
    }
    
    // SVG 그림 가져오기 (크기 조절 가능)
    function getVehicleSVGForResult(vehicleId, size = 60) {
        const svgs = getVehicleSVG(vehicleId);
        // frame1 SVG에서 width/height 조절 (run 또는 idle 상태 사용)
        const stateData = svgs.run || svgs.idle || svgs;
        let svg = stateData.frame1 || svgs.frame1;
        svg = svg.replace(/width="60"/g, `width="${size}"`);
        svg = svg.replace(/height="45"/g, `height="${Math.round(size * 0.75)}"`);
        return svg;
    }
    
    // 타깃 등수 계산 — N등 투표가 있으면 그 등수, 없으면 꼴등 fallback
    let loserIndex, loserHorseIndex, loserBettingUsers;
    if (targetRankForResult !== null && targetRankForResult >= 1 && targetRankForResult <= horseRankings.length) {
        loserIndex = targetRankForResult - 1;
        loserHorseIndex = horseRankings[loserIndex];
        loserBettingUsers = getBettingUsers(loserHorseIndex);
    } else {
        // fallback: 꼴등부터 역순으로 베팅자 있는 순위 찾기
        loserIndex = horseRankings.length - 1;
        loserHorseIndex = horseRankings[loserIndex];
        loserBettingUsers = getBettingUsers(loserHorseIndex);
        for (let i = horseRankings.length - 1; i >= 0; i--) {
            const users = getBettingUsers(horseRankings[i]);
            if (users.length > 0) {
                loserIndex = i;
                loserHorseIndex = horseRankings[i];
                loserBettingUsers = users;
                break;
            }
        }
    }
    const loserVehicle = getVehicleInfo(loserHorseIndex);

    // 타깃 등수에 따른 라벨 동적 결정
    const isTargetMode = (targetRankForResult !== null && targetRankForResult >= 1);
    const targetIcon = !isTargetMode ? '💀' : (targetRankForResult === 1 ? '🥇' : '🎯');
    const targetBadge = !isTargetMode ? 'LOSER' : (targetRankForResult + '등');
    const targetCheerLabel = !isTargetMode ? '꼴등 축하!' : (targetRankForResult + '등 축하!');

    // 채팅에 LOSER 카드 표시 (결과 오버레이와 동일한 디자인)
    if (ChatModule && typeof ChatModule.displayChatMessage === 'function') {
        const chatLoserVehicle = getVehicleInfo(loserHorseIndex);
        const loserNames = loserBettingUsers.length > 0 ? loserBettingUsers.join(', ') : '없음';
        const chatLoserSvg = getVehicleSVGForResult ? getVehicleSVGForResult(chatLoserVehicle.vehicleId || chatLoserVehicle.id, 45) : '';
        const chatResultHtml = `
            <div style="background: linear-gradient(135deg, var(--result-loser-dark) 0%, var(--result-loser-dark2) 100%); padding: 4px 8px; border-radius: 6px; border: 1.5px solid var(--result-loser-border); position: relative; overflow: hidden; margin: 2px 0; display: inline-block;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 13px;">${targetIcon}</span>
                    <span style="font-size: 12px; font-weight: bold; color: var(--red-400);">${loserIndex + 1}등</span>
                    <div style="transform: scale(0.55); margin: -8px -4px; filter: grayscale(60%);">${chatLoserSvg}</div>
                    <span style="font-size: 11px; font-weight: bold; color: var(--gray-100);">${chatLoserVehicle.name}</span>
                    <span style="font-size: 11px; color: var(--red-400); margin-left: auto;">🎉 ${loserNames}</span>
                </div>
            </div>`;
        ChatModule.displayChatMessage({
            message: chatResultHtml,
            isSystemMessage: true,
            isHtml: true,
            noBackground: true,
            time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        }, true);
    }

    // 결과 오버레이 표시
    const rankingsDiv = document.getElementById('resultRankings');
    if (rankingsDiv) {

        // 타깃 등수 라벨 (N등 투표가 있을 때만 별도 표시 — null=꼴등 fallback은 기존 LOSER 박스가 표현)
        let targetRankBadgeHtml = '';
        if (targetRankForResult !== null && targetRankForResult >= 1) {
            targetRankBadgeHtml = `
                <div style="text-align: center; margin-bottom: 10px; padding: 8px 12px; border-radius: 8px; background: linear-gradient(135deg, var(--horse-500) 0%, var(--horse-600) 100%); color: var(--bg-white); font-weight: bold; font-size: 14px; letter-spacing: 0.5px;">
                    🎯 ${targetRankForResult}등 찾기
                </div>
            `;
        }

        // 꼴등 멘트 랜덤
        const loserComments = [
            '축하합니다! 영광의 꼴등!',
            '꼴등의 영광을 안고 갑니다!',
            '꼴찌는 아름답다...',
            '느림의 미학! 꼴등 축하!',
            '꼴등이야말로 진정한 주인공!',
            '마지막까지 최선을 다한 꼴등!',
        ];
        const loserComment = loserComments[Math.floor(Math.random() * loserComments.length)];

        // 1등~꼴등 전체 순위
        let rankingsHtml = targetRankBadgeHtml;
        horseRankings.forEach((horseIndex, index) => {
            const vehicle = getVehicleInfo(horseIndex);
            const bettingUsers = getBettingUsers(horseIndex);
            const rankNum = index + 1;
            const isLast = index === loserIndex;
            const usersHtml = bettingUsers.length > 0 ? bettingUsers.join(', ') : '베팅 없음';

            if (index === 0) {
                rankingsHtml += `
                    <div class="result-rank-1" style="background: linear-gradient(135deg, var(--result-gold-light) 0%, var(--result-gold-dark) 100%); padding: 12px 14px; border-radius: 10px; margin-bottom: 8px; border-left: 4px solid var(--result-gold-border);">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 22px;">🥇</span>
                            <span style="font-size: 18px; font-weight: bold; color: var(--result-gold-text);">${rankNum}등</span>
                            <div style="transform: scale(0.9);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 45)}</div>
                            <span style="font-size: 15px; font-weight: bold; color: var(--result-gold-text);">${vehicle.name}</span>
                            <span style="font-size: 12px; color: var(--result-gold-subtext); margin-left: auto;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            } else if (index === 1) {
                rankingsHtml += `
                    <div class="result-rank-2" style="background: linear-gradient(135deg, var(--result-silver-light) 0%, var(--result-silver-dark) 100%); padding: 10px 14px; border-radius: 8px; margin-bottom: 6px; border-left: 4px solid var(--result-silver-border);">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">🥈</span>
                            <span style="font-size: 16px; font-weight: bold; color: var(--text-secondary);">${rankNum}등</span>
                            <div style="transform: scale(0.8);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 40)}</div>
                            <span style="font-size: 14px; font-weight: bold; color: var(--text-secondary);">${vehicle.name}</span>
                            <span style="font-size: 12px; color: var(--gray-400); margin-left: auto;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            } else if (index === 2) {
                rankingsHtml += `
                    <div class="result-rank-3" style="background: linear-gradient(135deg, var(--result-bronze-light) 0%, var(--result-bronze-dark) 100%); padding: 10px 14px; border-radius: 8px; margin-bottom: 6px; border-left: 4px solid var(--result-bronze-border);">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 18px;">🥉</span>
                            <span style="font-size: 16px; font-weight: bold; color: var(--result-bronze-text);">${rankNum}등</span>
                            <div style="transform: scale(0.8);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 40)}</div>
                            <span style="font-size: 14px; font-weight: bold; color: var(--result-bronze-text);">${vehicle.name}</span>
                            <span style="font-size: 12px; color: var(--result-bronze-subtext); margin-left: auto;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            } else if (isLast) {
                rankingsHtml += `
                    <div class="result-target-row" style="background: linear-gradient(135deg, var(--result-loser-light) 0%, var(--result-loser-dark) 100%); padding: 10px 14px; border-radius: 8px; margin-bottom: 6px; border-left: 4px solid var(--result-loser-border);">
                        <div style="display: flex; align-items: center; gap: 6px; position: relative; z-index: 2;">
                            <span style="font-size: 16px;">${targetIcon}</span>
                            <span style="font-size: 15px; font-weight: bold; color: var(--red-400);">${rankNum}등</span>
                            <div style="transform: scale(0.7);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 40)}</div>
                            <span style="font-size: 13px; font-weight: bold; color: var(--red-400);">${vehicle.name}</span>
                            <span style="font-size: 12px; color: var(--red-400); margin-left: auto; font-weight: 600;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            } else {
                rankingsHtml += `
                    <div style="background: var(--bg-primary); padding: 8px 14px; border-radius: 6px; margin-bottom: 4px; border-left: 4px solid var(--gray-300);">
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 13px; font-weight: bold; color: var(--text-muted); min-width: 28px;">${rankNum}등</span>
                            <div style="transform: scale(0.65);">${getVehicleSVGForResult(vehicle.vehicleId || vehicle.id, 38)}</div>
                            <span style="font-size: 13px; color: var(--text-secondary);">${vehicle.name}</span>
                            <span style="font-size: 11px; color: var(--gray-400); margin-left: auto;">${usersHtml}</span>
                        </div>
                    </div>
                `;
            }
        });

        // 타깃 등수 하이라이트 (하단) — N등 모드면 N등 / fallback이면 LOSER
        const winnerChips = loserBettingUsers.length > 0
            ? loserBettingUsers.map(function(name) {
                return '<span class="winner-chip">🏆 ' + escapeHtmlText(name) + '</span>';
            }).join('')
            : '<span class="winner-chip empty">베팅한 사람 없음</span>';
        rankingsHtml += `
            <div class="result-target-block" style="background: linear-gradient(135deg, var(--result-loser-dark) 0%, var(--result-loser-dark2) 100%); padding: 14px 16px 16px; border-radius: 12px; margin-top: 12px; box-shadow: 0 6px 24px rgba(0,0,0,0.45); border: 2px solid var(--result-loser-border); position: relative; overflow: hidden;">
                <div style="position: absolute; top: -5px; left: 50%; transform: translateX(-50%); background: var(--result-loser-border); color: var(--bg-white); padding: 2px 12px; border-radius: 0 0 6px 6px; font-size: 10px; font-weight: bold; letter-spacing: 1.5px;">${targetBadge}</div>
                <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 8px;">
                    <span style="font-size: 22px;">${targetIcon}</span>
                    <span style="font-size: 17px; font-weight: bold; color: var(--red-400);">${loserIndex + 1}등</span>
                    <div style="transform: scale(0.85); filter: grayscale(40%);">${getVehicleSVGForResult(loserVehicle.vehicleId || loserVehicle.id, 40)}</div>
                    <span style="font-size: 15px; font-weight: bold; color: var(--gray-100);">${loserVehicle.name}</span>
                </div>
                <div style="text-align: center; margin-top: 10px; font-size: 11px; color: var(--gray-100); letter-spacing: 2px; opacity: 0.85;">
                    ★ 당 첨 자 ★
                </div>
                <div class="winner-chip-row">${winnerChips}</div>
            </div>
        `;

        rankingsDiv.innerHTML = rankingsHtml;
    }
    
    // 순위 이펙트 숨기기
    if (finishEffectsOverlay) {
        finishEffectsOverlay.style.display = 'none';
    }
    
    // 전체화면 스테이지(API=top layer / 폴백=z-index 10000 고정 오버레이)는 본문서의 #resultOverlay(z-index 1000)를
    // 덮는다 — 오버레이는 래퍼 밖 형제라 스테이지 안으로 들어가지도 않는다. 순위 발표를 놓치면(그 사이 다음 라운드가
    // 시작되면 영영 못 본다) 안 되므로 표시 직전에 전체화면을 종료한다. raceFsExit은 멱등 — 미사용 경주는 no-op.
    if (typeof raceFsExit === 'function') raceFsExit();

    console.log('[resultOverlay] visible 추가', { isReplay, stack: new Error().stack });
    document.getElementById('resultOverlay').classList.add('visible');

    // 작은 창 관전 중이면 창 안에도 결과 요약을 띄운다 — 오버레이는 래퍼 밖이라 창을 따라가지 않아,
    // 다른 탭에 둔 채 창만 보고 있으면 결과를 놓친다(전체화면은 위에서 종료로 해결, PiP는 유지가 설계).
    showPipResultBanner(targetRankForResult, winners);

    // 레이스 종료 — 결과 오버레이가 스티키 광고 자리를 덮으므로 광고 복원
    document.body.classList.remove('race-running');

    // 경주 종료 → 탈것 선택 UI 복원
    const horseSelectionSection = document.getElementById('horseSelectionSection');
    if (horseSelectionSection) {
        horseSelectionSection.classList.add('active');
    }
    
    // 게임 상태 업데이트
    const gameStatus = document.getElementById('gameStatus');
    if (gameStatus) {
        gameStatus.textContent = '게임 대기 중...';
        gameStatus.className = 'game-status waiting';
    }
    
    // 다시보기 버튼 표시 (모든 사용자)
    document.getElementById('replaySection').style.display = 'block';
    const replayBtn = document.getElementById('mainReplayButton');
    if (replayBtn) {
        replayBtn.disabled = false;
        replayBtn.textContent = '🎬 다시보기';
        replayBtn.style.opacity = '1';
        replayBtn.style.cursor = 'pointer';
    }

    // 호스트에게 종료 버튼 표시
    if (isHost) {
        document.getElementById('endGameSection').style.display = 'block';
    }
    
    // 경주 트랙은 유지 (게임 종료 시까지)

    // LOSER(꼴등 베팅자)가 2명 이상이면 자동 준비
    if (loserBettingUsers && loserBettingUsers.length >= 2) {
        setTimeout(() => {
            if (!isReady) {
                toggleReady();
                addDebugLog(`LOSER ${loserBettingUsers.length}명 → 자동 준비`, 'system');
            }
        }, 3000);
    }
}

// 3-2-1 카운트다운 표시 (경마맵 영역 안에) — 미이동 시 countdown-shared.js, PiP attach 시 로컬 렌더러(개정2)
function showCountdown() {
    removePipResultBanner(); // 새 레이스 시작 — 지난 판 결과 요약 정리(선택 화면을 건너뛰는 다시보기 포함)
    // 레이스 트랙 컨테이너 표시 (attach 상태면 PiP 문서에서 조회)
    const trackContainer = raceDoc().getElementById('raceTrackContainer');
    if (trackContainer) {
        trackContainer.style.display = 'block';
        const wrapper = raceDoc().getElementById('raceTrackWrapper');
        if (wrapper) wrapper.style.display = 'block';
    }

    // attach 상태: countdown-shared는 메인 문서 전용 조회(컨테이너 미발견 시 메인 풀스크린 폴백)라
    // PiP에는 아무것도 안 보인다 — 크로스게임 계약상 shared 수정 금지, 동일 연출의 로컬 렌더러 사용.
    if (racePipAttached()) {
        showPipCountdown(trackContainer);
        return;
    }
    showGameCountdown('raceTrackContainer');
}

// PiP 전용 카운트다운 — countdown-shared.js의 연출을 그대로 미러(3-2-1-START!, 1초 간격, 동일 색 변수,
// countPop 키프레임, 완료 콜백 없음 — 기존 호출부도 콜백 미사용). 정적 문자열만 innerHTML에 사용.
function showPipCountdown(container) {
    if (!container) return;
    var doc = raceDoc();
    // 틱 예약도 PiP 창에 — 메인 창에 걸면 다른 탭에서 1초 스로틀에 걸려 4초 카운트다운이 늘어지고,
    // 불투명 75% 검은 막이 걷히기 전에 경주가 시작돼 트랙을 가린 채 말들이 달린다.
    var cdWin = (window._racePipWin && !window._racePipWin.closed) ? window._racePipWin : window;
    try {
        // countPop 키프레임 주입 — PiP 문서 head에 창당 1회 (countdown-shared와 동일 내용)
        if (!doc.getElementById('countdownSharedStyles')) {
            var kfStyle = doc.createElement('style');
            kfStyle.id = 'countdownSharedStyles';
            kfStyle.textContent = '@keyframes countPop{0%{transform:scale(.3);opacity:0}50%{transform:scale(1.2);opacity:1}70%{transform:scale(.95)}100%{transform:scale(1);opacity:1}}';
            doc.head.appendChild(kfStyle);
        }
        var existing = doc.getElementById('countdownOverlay');
        if (existing) existing.remove();

        var overlay = doc.createElement('div');
        overlay.id = 'countdownOverlay';
        overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:100;display:flex;justify-content:center;align-items:center;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;';
        container.style.position = 'relative';
        container.appendChild(overlay);

        var nums = ['3', '2', '1', 'START!'];
        var colors = ['var(--red-500)', 'var(--yellow-500)', 'var(--green-500)', 'var(--blue-500)'];
        var idx = 0;
        function showNext() {
            if (idx >= nums.length) {
                overlay.remove();
                return;
            }
            overlay.innerHTML = '<div style="font-size:' + (nums[idx] === 'START!' ? '60px' : '90px')
                + ';font-weight:900;color:' + colors[idx]
                + ';text-shadow:0 0 30px ' + colors[idx] + ',0 0 60px ' + colors[idx] + '40'
                + ';animation:countPop 0.8s ease-out">' + nums[idx] + '</div>';
            idx++;
            cdWin.setTimeout(showNext, 1000);
        }
        showNext();
    } catch (e) {}
}

// 전원 동일 베팅 시 빠른 레이스 오버레이 (뒤에서 레이스 진행) — 개정2: attach 상태 대응 doc-aware
function showQuickRaceOverlay() {
    const trackContainer = raceDoc().getElementById('raceTrackContainer');

    const overlay = document.createElement('div');
    overlay.id = 'quickRaceOverlay';
    overlay.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); z-index: 100;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        pointer-events: none;
        transition: opacity 0.5s ease-out;
    `;
    overlay.innerHTML = `
        <style>@keyframes qr-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}</style>
        <div style="font-size: 40px; margin-bottom: 8px; animation: qr-bounce 0.8s ease-in-out infinite;">⚡</div>
        <div style="font-size: 20px; font-weight: 800; color: var(--yellow-400);
            text-shadow: 0 0 20px rgba(255,215,0,0.6);">
            모두 같은 선택!
        </div>
        <div style="font-size: 14px; color: var(--gray-300); margin-top: 6px;">
            빠르게 결과를 확인합니다
        </div>
    `;

    if (trackContainer) {
        trackContainer.appendChild(overlay);
    }

    // 10초 후 페이드아웃
    setTimeout(() => {
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 500);
    }, 10000);
}

function removeQuickRaceOverlay() {
    const overlay = raceDoc().getElementById('quickRaceOverlay'); // 트랙 컨테이너 내부 — PiP 문서 대응
    if (overlay) overlay.remove();
}

// 호스트 UI 업데이트 함수
function updateHostUI() {
    const hostBadge = document.getElementById('hostBadge');
    const hostControls = document.getElementById('hostControls');
    const dragHint = document.getElementById('dragHint');

    if (isHost) {
        if (hostBadge) hostBadge.style.display = 'inline-block';
        if (hostControls) hostControls.style.display = 'block';
        if (dragHint) dragHint.style.display = isRaceActive ? 'none' : 'inline';

        // 예약 시작 컨트롤 — 방장에게만 만든다 (호스트 위임으로 뒤늦게 방장이 되는 경로 포함)
        renderSchedulePresets();
        updateScheduleControls();

        // 주문받기 버튼 상태
        if (isOrderActive) {
            document.getElementById('startOrderButton').style.display = 'none';
            document.getElementById('endOrderButton').style.display = 'block';
        } else {
            document.getElementById('startOrderButton').style.display = 'block';
            document.getElementById('endOrderButton').style.display = 'none';
        }
    } else {
        if (hostBadge) hostBadge.style.display = 'none';
        if (hostControls) hostControls.style.display = 'none';
        if (dragHint) dragHint.style.display = 'none';
    }
}

// 사용자 목록 렌더링
function updateUsers(users) {
    currentUsers = users;
    const usersList = document.getElementById('usersList');
    const usersCount = document.getElementById('usersCount');

    if (!usersList || !usersCount) return;

    usersCount.textContent = users.length;
    usersList.innerHTML = '';

    // 드래그 힌트 표시
    const dragHint = document.getElementById('dragHint');
    if (dragHint) {
        dragHint.style.display = (isHost && !isRaceActive) ? 'inline' : 'none';
    }

    users.forEach(user => {
        const tag = document.createElement('span');
        tag.className = 'user-tag';
        if (user.isHost) {
            tag.classList.add('host');
        }
        if (user.name === currentUser) {
            tag.classList.add('me');
        }

        let content = user.name;
        if (user.isHost) {
            content += ' 👑';
        }
        if (user.name === currentUser) {
            content += ' (나)';
        }
        tag.textContent = content;

        // 호스트가 다른 사용자를 클릭하면 액션 선택 다이얼로그 표시
        if (isHost && user.name !== currentUser) {
            tag.style.cursor = 'pointer';
            tag.title = '클릭하여 호스트임명 또는 제외';
            tag.addEventListener('click', () => {
                showPlayerActionDialog(user.name).then(action => {
                    if (action === 'host') {
                        socket.emit('transferHost', user.name);
                    } else if (action === 'kick') {
                        showConfirmDialog(`${user.name}님을 게임에서 제외하시겠습니까?`, () => {
                            socket.emit('kickPlayer', user.name);
                        });
                    }
                });
            });
        }

        // 호스트만 드래그 가능 (게임 비활성 시)
        if (isHost && !isRaceActive) {
            tag.draggable = true;
            tag.style.cursor = 'grab';
            tag.setAttribute('data-user-name', user.name);

            tag.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', user.name);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('source', 'users');
                tag.style.opacity = '0.5';
            });

            tag.addEventListener('dragend', (e) => {
                tag.style.opacity = '1';
            });
        } else {
            tag.draggable = false;
            tag.style.cursor = 'default';
        }

        usersList.appendChild(tag);
    });
}

// 게임 기록 렌더링
function renderHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    if (horseRaceHistory.length === 0) {
        historyList.innerHTML = '<div style="color: var(--text-muted); text-align: center;">아직 기록이 없습니다</div>';
        return;
    }
    
    historyList.innerHTML = '';
    
    // 탈것 정보 가져오기 헬퍼 함수
    function getVehicleInfoForHistory(vehicleId) {
        if (vehicleId && ALL_VEHICLES.length > 0) {
            const vehicle = ALL_VEHICLES.find(v => v.id === vehicleId);
            if (vehicle) return vehicle;
        }
        return { id: 'horse', name: '말', emoji: '🐎' };
    }
    
    // SVG 가져오기 (작은 크기)
    function getSmallVehicleSVG(vehicleId) {
        const svgs = getVehicleSVG(vehicleId);
        const stateData = svgs.run || svgs.idle || svgs;
        let svg = stateData.frame1 || svgs.frame1;
        svg = svg.replace(/width="60"/g, 'width="30"');
        svg = svg.replace(/height="45"/g, 'height="22"');
        return svg;
    }
    
    // 해당 말에 베팅한 모든 사용자 찾기
    function getBettingUsersFromRecord(record, horseIndex) {
        const users = [];
        if (record.userHorseBets) {
            Object.entries(record.userHorseBets).forEach(([userName, betHorse]) => {
                if (betHorse === horseIndex) {
                    users.push(userName);
                }
            });
        }
        return users;
    }
    
    horseRaceHistory.slice().reverse().forEach((record, idx) => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.style.cssText = 'background: var(--yellow-50); padding: 12px; margin-bottom: 10px; border-radius: 8px; border: 1px solid var(--yellow-200);';
        
        // 시간 포맷
        const time = record.timestamp ? new Date(record.timestamp).toLocaleString('ko-KR', { 
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' 
        }) : '';
        
        // 순위별 결과 생성
        let rankingsHtml = '';
        if (record.rankings && record.rankings.length > 0) {
            record.rankings.forEach((horseIndex, rank) => {
                const vehicleId = record.selectedVehicleTypes ? record.selectedVehicleTypes[horseIndex] : 'horse';
                const vehicle = getVehicleInfoForHistory(vehicleId);
                const bettingUsers = getBettingUsersFromRecord(record, horseIndex);
                const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'];
                const medal = medals[rank] || `${rank + 1}`;
                const bgColors = ['var(--result-gold-light)', 'var(--result-silver-light)', 'var(--result-bronze-light)', 'var(--panel-secondary)', 'var(--panel-secondary)', 'var(--panel-secondary)'];
                const bgColor = bgColors[rank] || 'var(--panel-secondary)';
                
                rankingsHtml += `
                    <div style="display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: ${bgColor}; border-radius: 4px; margin-bottom: 4px;">
                        <span style="font-size: 14px;">${medal}</span>
                        <span style="font-size: 12px; font-weight: bold;">${rank + 1}등</span>
                        <div style="transform: scale(0.6); margin: -5px;">${getSmallVehicleSVG(vehicleId)}</div>
                        <span style="font-size: 11px; color: var(--text-secondary);">${vehicle.name}</span>
                        <span style="font-size: 11px; color: var(--horse-accent); margin-left: auto;">${bettingUsers.length > 0 ? bettingUsers.join(', ') : '-'}</span>
                    </div>
                `;
            });
        }
        
        // 최종 당첨자 또는 가장 높은 순위 베팅자
        let winnersText = '';
        if (record.winners && record.winners.length > 0) {
            winnersText = `🎊 당첨: ${record.winners.join(', ')}`;
        } else if (record.userHorseBets && record.rankings && record.rankings.length > 0) {
            // 당첨자 없을 때: 가장 높은 순위 베팅자 찾기
            let bestRank = -1;
            let bestBetters = [];
            Object.entries(record.userHorseBets).forEach(([username, horseIndex]) => {
                const rank = record.rankings.indexOf(horseIndex);
                if (rank !== -1) {
                    if (bestRank === -1 || rank < bestRank) {
                        bestRank = rank;
                        bestBetters = [username];
                    } else if (rank === bestRank) {
                        bestBetters.push(username);
                    }
                }
            });
            if (bestBetters.length > 0 && bestRank >= 0) {
                winnersText = `🏅 ${bestRank + 1}등 순위: ${bestBetters.join(', ')}`;
            }
        }
        
        const historyIdx = horseRaceHistory.length - 1 - idx;
        const recTargetRank = (typeof record.targetRank === 'number') ? record.targetRank : null;
        const recTargetLabel = (recTargetRank !== null && recTargetRank >= 1) ? (recTargetRank + '등') : '꼴등';
        const targetRankBadge = `<span style="margin-left: 6px; padding: 2px 5px; background: var(--horse-500); color: var(--bg-white); border-radius: 4px; font-size: 9px; font-weight: bold; white-space: nowrap;">🎯${recTargetLabel}</span>`;
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 6px;">
                <div style="font-weight: bold; color: var(--horse-accent); font-size: 14px; white-space: nowrap; min-width: 0; flex-shrink: 1;">${record.round || (horseRaceHistory.length - idx)}라운드${targetRankBadge}</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <button class="history-replay-btn" data-history-idx="${historyIdx}" style="width: auto; margin: 0; padding: 3px 8px; font-size: 10px; background: var(--bg-white); color: var(--horse-accent); border: 1px solid var(--horse-accent); border-radius: 5px; font-weight: 600; cursor: pointer; font-family: 'Jua', sans-serif;">▶ 다시보기</button>
                    <span style="font-size: 11px; color: var(--text-muted);">${time}</span>
                </div>
            </div>
            <div style="margin-bottom: 8px;">
                ${rankingsHtml}
            </div>
            ${winnersText ? `<div style="font-size: 13px; color: var(--horse-600); font-weight: bold; text-align: center; padding: 5px; background: var(--yellow-50); border-radius: 4px;">${winnersText}</div>` : ''}
        `;
        item.querySelector('.history-replay-btn').addEventListener('click', function() {
            if (isRaceActive || isReplayActive) {
                showCustomAlert('경주 또는 다시보기가 진행 중입니다.', 'warning');
                return;
            }
            playReplay(horseRaceHistory[historyIdx]);
        });
        historyList.appendChild(item);
    });
}

// (시크바 다시보기 제거됨 - 단순 재생만 사용)


// 다시보기 선택 모달 (최근 3개 레이스)
function showReplaySelector() {
    // 레이스/리플레이 중 방지 + 중복 오버레이 방지
    if (isRaceActive || isReplayActive) return;
    if (document.getElementById('replaySelectorOverlay')) return;

    // 기록이 0개면 경고, 1개면 바로 재생
    if (horseRaceHistory.length <= 1) {
        playLastReplay();
        return;
    }

    const recent = horseRaceHistory.slice(-3).reverse();

    const overlay = document.createElement('div');
    overlay.id = 'replaySelectorOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;justify-content:center;align-items:center;z-index:1000;';

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--bg-white);border-radius:16px;padding:20px;max-width:320px;width:90%;text-align:center;';

    card.innerHTML = '<div style="font-weight:bold;font-size:16px;margin-bottom:15px;font-family:\'Jua\',sans-serif;">🎬 다시보기 선택</div>';

    const bgColors = ['var(--horse-500)', '#A0522D', '#B8734A'];
    recent.forEach((record, idx) => {
        const roundNum = record.round || (horseRaceHistory.length - idx);
        const winnerText = record.winners && record.winners.length > 0
            ? record.winners.join(', ')
            : '진행 중';
        const bg = bgColors[idx];
        const btn = document.createElement('button');
        btn.style.cssText = 'display:block;width:100%;padding:12px;margin-bottom:8px;border:none;border-radius:8px;background:' + bg + ';color:white;font-weight:bold;cursor:pointer;font-family:\'Jua\',sans-serif;font-size:14px;';
        btn.textContent = roundNum + '라운드 — 승자: ' + winnerText;
        btn.onclick = function() {
            overlay.remove();
            playReplay(record);
        };
        card.appendChild(btn);
    });

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'display:block;width:100%;padding:10px;border:1px solid var(--gray-300);border-radius:8px;background:var(--bg-white);color:var(--text-primary);cursor:pointer;font-weight:600;font-family:\'Jua\',sans-serif;';
    closeBtn.textContent = '닫기';
    closeBtn.onclick = function() { overlay.remove(); };
    card.appendChild(closeBtn);

    overlay.appendChild(card);
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
}

// 마지막 경주 다시보기 (메인 다시보기 버튼)
function playLastReplay() {
    if (horseRaceHistory.length === 0) {
        showCustomAlert('기록을 찾을 수 없습니다.', 'warning');
        return;
    }
    const record = horseRaceHistory[horseRaceHistory.length - 1];
    playReplay(record);
}

// 다시보기 종료 버튼
function showReplayStopButton(onStop) {
    removeReplayStopButton();
    const btn = document.createElement('button');
    btn.id = 'replayStopBtn';
    btn.textContent = '⏹ 다시보기 종료';
    btn.style.cssText = 'position:absolute;top:8px;right:8px;z-index:200;width:auto;margin:0;padding:6px 14px;background:rgba(0,0,0,0.7);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:8px;font-size:12px;font-weight:bold;cursor:pointer;font-family:"Jua",sans-serif;';
    btn.onclick = onStop;
    const wrapper = raceDoc().getElementById('raceTrackWrapper'); // 상시 PiP — 래퍼가 있는 문서에 부착
    if (wrapper) {
        wrapper.appendChild(btn);
    } else {
        document.body.appendChild(btn);
    }
}

function removeReplayStopButton() {
    const btn = anyDocGetById('replayStopBtn'); // 래퍼 내부(래퍼 문서) 또는 메인 body 폴백 — 양쪽 커버
    if (btn) btn.remove();
}

// 다시보기 기능 (단순 재생, 시크바 없음)
function playReplay(record) {
    if (!record) {
        showCustomAlert('기록을 찾을 수 없습니다.', 'warning');
        return;
    }

    if (window.SoundManager) SoundManager.stopAll();

    const replayBtn = document.getElementById('mainReplayButton');
    if (replayBtn) {
        replayBtn.disabled = true;
        replayBtn.textContent = '🎬 다시보기 중...';
        replayBtn.style.opacity = '0.6';
        replayBtn.style.cursor = 'not-allowed';
    }

    const horseSelectionSection = document.getElementById('horseSelectionSection');
    if (horseSelectionSection) horseSelectionSection.classList.remove('active');

    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) resultOverlay.classList.remove('visible');

    const originalSelectedVehicleTypes = selectedVehicleTypes;
    const originalUserHorseBets = userHorseBets;
    const originalAvailableHorses = availableHorses;

    selectedVehicleTypes = record.selectedVehicleTypes;
    userHorseBets = record.userHorseBets || {};
    availableHorses = record.availableHorses || record.rankings.map((_, i) => i);

    isRaceActive = true;
    isReplayActive = true;
    document.body.classList.add('race-running'); // 다시보기 애니메이션 중 스티키 광고 숨김

    const horseRankings = record.rankings || [];
    const replaySpeeds = record.speeds || horseRankings.map((_, rank) => 3000 + rank * 500);
    const replayGimmicks = record.gimmicks || null;

    function cleanupReplay() {
        removeReplayStopButton();
        if (typeof window.hideRaceChatOverlay === 'function') {
            window.hideRaceChatOverlay();
        }
        isRaceActive = false;
        isReplayActive = false;
        document.body.classList.remove('race-running'); // 다시보기 종료/중단 — 스티키 광고 복원
        selectedVehicleTypes = originalSelectedVehicleTypes;
        userHorseBets = originalUserHorseBets;
        availableHorses = originalAvailableHorses;
        flushPendingHorseSelection();
        if (currentUsers.length > 0) updateUsers(currentUsers);
        if (replayBtn) {
            replayBtn.disabled = false;
            replayBtn.textContent = '🎬 다시보기';
            replayBtn.style.opacity = '1';
            replayBtn.style.cursor = 'pointer';
        }
    }

    showReplayStopButton(function() {
        if (window._raceAnimFrameId) {
            raceAnimWin().cancelAnimationFrame(window._raceAnimFrameId); // 예약한 창(PiP 가능)에서 취소
            window._raceAnimFrameId = null;
        }
        if (window.SoundManager) SoundManager.stopAll();
        const ro = document.getElementById('resultOverlay');
        if (ro) ro.classList.remove('visible');
        cleanupReplay();
        returnToSelectionAfterReplay(); // 종료 시 선택 섹션 .active 복원 + 렌더 (4518에서 해제됨)
    });

    showCountdown();
    setTimeout(() => {
        // 다시보기 시 targetRank 임시 적용 (슬로우모션 일반화에 사용)
        const _prevTargetRank = window._targetRank;
        window._targetRank = (typeof record.targetRank === 'number') ? record.targetRank : null;
        updateTargetRankBanner(window._targetRank, true);
        startRaceAnimation(horseRankings, replaySpeeds, replayGimmicks, (actualFinishOrder) => {
            // 결승 연출 — 본인 장착 finish_fx(개인 꾸미기). 다시보기에서도 본인 화면 기준이라 안전. 외관만, 결과 무관.
            if (window.HorseShop) window.HorseShop.playFinishFx();
            showRaceResult({
                winners: record.winners || [],
                horseRankings: actualFinishOrder || horseRankings,
                // 서버 record는 mode로 저장 (horseRaceMode는 구형 로컬 record 호환)
                horseRaceMode: record.mode || record.horseRaceMode || 'last',
                targetRank: (typeof record.targetRank === 'number') ? record.targetRank : null
            }, true);

            // 다시보기 종료 후 원래 targetRank 복원
            window._targetRank = _prevTargetRank;
            cleanupReplay();
        }, {
            trackDistanceMeters: record.trackDistanceMeters || 500,
            speedSeeds: record.speedSeeds || null,
            weatherSchedule: record.weatherSchedule || [],
            weatherConfig: window._weatherConfig || {},
            isReplay: true,
            evolutionTargets: record.evolutionTargets || [],
            fakeEvolutionTargets: record.fakeEvolutionTargets || []
        });
    }, 4000);
}

// 채팅 모듈 초기화 (roomCreated/roomJoined 후 호출)
var chatModuleInitialized = false;
function initChatModule() {
    if (chatModuleInitialized) return;
    chatModuleInitialized = true;
    ChatModule.init(socket, currentUser, {
        gameType: 'horse',
        systemGradient: 'var(--horse-gradient)',
        themeColor: 'var(--text-primary)',
        myColor: 'var(--horse-accent)',
        myBgColor: 'var(--horse-50)',
        myBorderColor: 'var(--yellow-500)',
        getRoomUsers: () => users
    });
}

// 글로벌 함수 (HTML onclick에서 호출)
function sendMessage() { ChatModule.sendMessage(); }
function handleChatKeypress(event) { ChatModule.handleChatKeypress(event); }
function uploadImage() {
    ChatModule.showImageUploadModal((imageData, caption) => {
        socket.emit('sendImage', { imageData, caption });
    });
}

var readyModuleInitialized = false;
function initReadyModule() {
    if (readyModuleInitialized) return;
    readyModuleInitialized = true;
    ReadyModule.init(socket, currentUser, {
        isHost: isHost,
        isGameActive: () => isRaceActive,
        onReadyChanged: (users) => {
            readyUsers = users;
            tryAutoSelectHorse();
            // 말 선택 UI가 활성화되어 있으면 "선택 안 한 사람" 목록 갱신
            const selectionSection = document.getElementById('horseSelectionSection');
            if (selectionSection && selectionSection.classList.contains('active')) {
                const notSelectedSection = document.getElementById('notSelectedVehicleSection');
                const notSelectedList = document.getElementById('notSelectedVehicleList');
                if (notSelectedSection && notSelectedList) {
                    const notSelectedUsers = readyUsers.filter(name => !selectedUsersFromServer.includes(name));
                    if (notSelectedUsers.length > 0 && readyUsers.length > 0) {
                        notSelectedSection.style.display = 'block';
                        notSelectedList.innerHTML = '';
                        notSelectedUsers.sort((a, b) => a.localeCompare(b, 'ko')).forEach(name => {
                            const tag = document.createElement('div');
                            tag.className = 'not-rolled-tag';
                            tag.textContent = name + (name === currentUser ? ' (나)' : '');
                            notSelectedList.appendChild(tag);
                        });
                    } else {
                        notSelectedSection.style.display = 'none';
                    }
                }
            }
        },
        onRenderComplete: (users) => {
            updateStartButton();
        },
        onError: (message) => showCustomAlert(message, 'error'),
        readyStyle: { background: 'var(--horse-gradient)', color: 'var(--bg-white)' },
        readyCancelStyle: { background: 'linear-gradient(135deg, var(--horse-600) 0%, var(--horse-500) 100%)', color: 'var(--bg-white)' }
    });
}

function initOrderModule() {
    OrderModule.init(socket, currentUser, {
        isHost: () => isHost,
        isGameActive: () => isRaceActive,
        getEverPlayedUsers: () => everPlayedUsers,
        getUsersList: () => currentUsers,
        showCustomAlert: (msg, type) => showCustomAlert(msg, type),
        onOrderStarted: () => { isOrderActive = true; },
        onOrderEnded: () => { isOrderActive = false; },
        onOrdersUpdated: (data) => { ordersData = data; },
    });
}

function addChatMessage(data) { ChatModule.displayChatMessage(data); }
function toggleReaction(messageIndex, emoji) {
    socket.emit('toggleReaction', { messageIndex, emoji });
}

// 결과 오버레이 닫기 (비석은 다음 경주 시작 전까지 유지)
function closeResultOverlay() {
    document.getElementById('resultOverlay').classList.remove('visible');
    // 순위 이펙트는 제거하지 않음 → 비석이 남음. 새 경주 시작 시 clearFinishEffects()로 정리됨
}

// 방 폭파 카운트다운

// 방이 사라진 뒤가 되는 프리셋은 숨긴다 — 눌러봐야 서버가 거절할 뿐이다.
// 방 만료 시각을 모르면(아직 못 받았으면) 그대로 둔다.
function updateSchedulePresetVisibility() {
    var buttons = document.querySelectorAll('[data-schedule-minutes]');
    for (var i = 0; i < buttons.length; i++) {
        var minutes = parseInt(buttons[i].getAttribute('data-schedule-minutes'), 10);
        var tooLate = roomExpiresAtMs && (Date.now() + minutes * 60 * 1000 >= roomExpiresAtMs);
        buttons[i].style.display = tooLate ? 'none' : '';
    }
}

function startRoomExpiryCountdown(createdAt, expiryHours) {
    roomExpiresAtMs = new Date(createdAt).getTime() + expiryHours * 60 * 60 * 1000;
    if (roomExpiryInterval) {
        clearInterval(roomExpiryInterval);
    }
    
    const expirySection = document.getElementById('roomExpirySection');
    const countdownElement = document.getElementById('roomExpiryCountdown');
    
    if (!expirySection || !countdownElement) return;
    
    expirySection.style.display = 'block';
    
    function updateCountdown() {
        const now = new Date();
        const createdAtDate = new Date(createdAt);
        const expiryTime = createdAtDate.getTime() + (expiryHours * 60 * 60 * 1000);
        const remaining = expiryTime - now.getTime();
        
        if (remaining <= 0) {
            countdownElement.textContent = '00:00:00';
            expirySection.style.background = 'var(--status-danger-bg)';
            expirySection.style.borderColor = 'var(--red-500)';
            countdownElement.style.color = 'var(--status-danger-text)';
            if (roomExpiryInterval) {
                clearInterval(roomExpiryInterval);
            }
            return;
        }
        
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
        
        countdownElement.textContent = 
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    updateCountdown();
    roomExpiryInterval = setInterval(updateCountdown, 1000);
}

// 게임 화면 초기화
function initializeGameScreen(data) {
    document.getElementById('roomTitle').textContent = data.roomName || '경마 방';
    
    if (data.createdAt && data.expiryHours) {
        startRoomExpiryCountdown(data.createdAt, data.expiryHours);
    }
    
    // 사용자 목록 초기화
    if (data.gameState && data.gameState.users) {
        currentUsers = data.gameState.users;
    }
    
    // 누적 참여자 목록 복원
    if (data.everPlayedUsers && Array.isArray(data.everPlayedUsers)) {
        everPlayedUsers = [...data.everPlayedUsers];
    } else if (data.gameState && data.gameState.everPlayedUsers && Array.isArray(data.gameState.everPlayedUsers)) {
        everPlayedUsers = [...data.gameState.everPlayedUsers];
    } else {
        everPlayedUsers = [];
    }
    
    // 주문받기 상태 초기화
    isOrderActive = (data.gameState && data.gameState.isOrderActive) || false;
    OrderModule.setIsOrderActive(isOrderActive);
    ordersData = (data.gameState && data.gameState.userOrders) || {};
    OrderModule.setOrdersData(ordersData);

    // 호스트 UI 설정
    updateHostUI();

    // 주문받기 상태 반영 (CSS: .orders-section { display:none }, .orders-section.active { display:block })
    if (isOrderActive) {
        document.getElementById('ordersSection').classList.add('active');
        document.getElementById('myOrderInput').disabled = false;
        document.getElementById('orderSaveButton').disabled = false;

        if (isHost) {
            document.getElementById('startOrderButton').style.display = 'none';
            document.getElementById('endOrderButton').style.display = 'block';
        }

        OrderModule.renderOrders();
        OrderModule.renderNotOrderedUsers();
    } else {
        document.getElementById('ordersSection').classList.remove('active');
        document.getElementById('myOrderInput').disabled = true;
        document.getElementById('orderSaveButton').disabled = true;

        // 서버에서 받은 게임 진행 상태 확인
        const serverIsRaceActive = (data.gameState && data.gameState.isHorseRaceActive) || data.isGameActive;
        if (serverIsRaceActive) {
            isRaceActive = true; // 클라이언트 상태도 동기화
            document.getElementById('gameStatus').textContent = '게임 진행 중!';
            document.getElementById('gameStatus').className = 'game-status playing';
        } else if (!isRaceActive) {
            document.getElementById('gameStatus').textContent = '게임 대기 중...';
            document.getElementById('gameStatus').className = 'game-status waiting';
        }

        if (isHost && !isRaceActive) {
            const startOrderBtn = document.getElementById('startOrderButton');
            const endOrderBtn = document.getElementById('endOrderButton');
            if (startOrderBtn) startOrderBtn.style.display = 'block';
            if (endOrderBtn) endOrderBtn.style.display = 'none';
        } else if (isHost) {
            const startOrderBtn = document.getElementById('startOrderButton');
            const endOrderBtn = document.getElementById('endOrderButton');
            if (startOrderBtn) startOrderBtn.style.display = 'none';
            if (endOrderBtn) endOrderBtn.style.display = 'none';
        }

        OrderModule.renderOrders();
        OrderModule.renderNotOrderedUsers();
    }
    
    // 기록 섹션 표시
    document.getElementById('historySection').classList.add('visible');
    
    // 채팅 기록 로드
    if (data.chatHistory) {
        document.getElementById('chatMessages').innerHTML = '';
        data.chatHistory.forEach(msg => addChatMessage(msg));
        ChatModule.recalculatePins();
    }

    // 경마 기록 로드
    if (data.gameState && data.gameState.horseRaceHistory) {
        horseRaceHistory = data.gameState.horseRaceHistory;
        renderHistory();
    }
    
    // 준비 상태 복원
    if (data.readyUsers) {
        readyUsers = data.readyUsers;
        isReady = readyUsers.includes(currentUser);
        ReadyModule.setReadyUsers(readyUsers);
        tryAutoSelectHorse();
    }

    // 경마 게임 상태 복원 및 말 선택 UI 표시
    if (data.gameType === 'horse-race' || (data.gameState && data.gameState.availableHorses)) {
        const gameState = data.gameState || {};
        
        // 말 선택 UI가 이미 활성화되어 있으면 유지, 없으면 활성화
        if (gameState.availableHorses && gameState.availableHorses.length > 0 && !gameState.isHorseRaceActive) {
            availableHorses = gameState.availableHorses;
            userHorseBets = gameState.userHorseBets || {};
            horseRaceMode = gameState.horseRaceMode || 'last';
            
            mySelectedHorse = userHorseBets[currentUser] !== undefined ? userHorseBets[currentUser] : null;
            
            // 말 선택 섹션 표시
            const horseSelectionSection = document.getElementById('horseSelectionSection');
            if (horseSelectionSection) {
                horseSelectionSection.classList.add('active');
                renderHorseSelection();
            }
        }
    }

    // 예약 시작 복원 — 재접속해도 걸려 있던 카운트다운이 이어진다 (입장 페이로드에 실려 온다)
    applyScheduledStart(data.gameState && data.gameState.scheduledStartAt, data.gameState && data.gameState.scheduledStartLabel);
}

// === 소켓 이벤트 핸들러 ===

socket.on('connect', () => {
    // 꾸미기 상점: 소켓 연결 + 토큰 인증 (지갑/장착 서버 동기화, 매 연결 멱등)
    if (window.HorseShop) {
        window.HorseShop.connect(socket);
        try {
            var _auth = JSON.parse(localStorage.getItem('userAuth') || 'null');
            if (_auth && _auth.token) window.HorseShop.authenticate(_auth.token);
        } catch (e) {}
    }

    // 방에 있었다면 자동 재입장 (transport close reconnect 대응)
    if (currentRoomId) {
        const activeRoom = sessionStorage.getItem('horseRaceActiveRoom');
        if (activeRoom) {
            try {
                const ar = JSON.parse(activeRoom);
                if (currentServerId) {
                    socket.emit('setServerId', { serverId: currentServerId, userName: ar.userName });
                }
                socket.emit('joinRoom', {
                    roomId: ar.roomId,
                    userName: ar.userName,
                    isHost: false,
                    password: '',
                    deviceId: getDeviceId(),
                    tabId: getTabId()
                });
            } catch(e) {
                sessionStorage.removeItem('horseRaceActiveRoom');
            }
        }
    }
});

socket.on('disconnect', () => {
});

socket.on('roomCreated', (data) => {
    // 진입 성공 — pending 소비 + 쿼리 스트립 (실패 재시도용으로 미뤄뒀던 것)
    settleEntrySuccess();
    currentRoomId = data.roomId;
    currentUser = data.userName || '';
    // 새로고침 시 재입장을 위해 방 정보 저장
    sessionStorage.setItem('horseRaceActiveRoom', JSON.stringify({
        roomId: data.roomId, userName: currentUser,
        serverId: currentServerId, serverName: currentServerName
    }));
    // 방 생성 직후는 항상 비-레이스 화면 — race-running 잔존 시 스티키 광고 영구 숨김 방지
    document.body.classList.remove('race-running');
    initChatModule();
    isHost = true;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];
    // 게임 진행 상태를 먼저 동기화 (initReadyModule 전에 필요)
    if ((data.gameState && data.gameState.isHorseRaceActive) || data.isGameActive) {
        isRaceActive = true;
    }
    initReadyModule();
    initOrderModule();
    if (typeof RankingModule !== 'undefined') {
        RankingModule.init(currentServerId, currentUser);
        RankingModule.setHost(isHost);
    }

    // 경마 게임 상태 초기화 (gameState에서 가져오기)
    if (data.gameState) {
        if (data.gameState.selectedVehicleTypes) {
            selectedVehicleTypes = data.gameState.selectedVehicleTypes;
            console.log('[roomCreated] selectedVehicleTypes 설정:', selectedVehicleTypes);
        }
        if (data.gameState.availableHorses) {
            availableHorses = data.gameState.availableHorses;
        }
        if (data.gameState.userHorseBets) {
            // 경기 중이면 전체 표시, 아니면 본인 선택만
            if (data.gameState.isHorseRaceActive || isRaceActive) {
                userHorseBets = data.gameState.userHorseBets;
            } else {
                userHorseBets = {};
                if (data.gameState.userHorseBets[currentUser] !== undefined) {
                    userHorseBets[currentUser] = data.gameState.userHorseBets[currentUser];
                }
            }
        }
        if (data.gameState.horseRaceMode) {
            horseRaceMode = data.gameState.horseRaceMode;
        }
        if (data.gameState.horseRaceHistory) {
            horseRaceHistory = data.gameState.horseRaceHistory;
            renderHistory();
        }
    }

    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('gameSection').classList.add('active');
    document.body.classList.add('game-active');

    initializeGameScreen(data);
    ReadyModule.setReadyUsers(readyUsers);
    autoSelectAttempted = false; // 방마다 리셋
    initAutoSelectHorseToggle();
    if (window.FreeInvite && data.shortcode) {
        window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
    }
    // 광고 코스메틱 재장착: 서버 transient(room.adCosmetics)는 leave/disconnect로 정리되므로
    // 방 (재)입장 시 sessionStorage 장착 상태로 shop:adEquip 재emit해 서버를 다시 채운다.
    if (window.ShopModule && typeof ShopModule.reapplyAdEquips === 'function') ShopModule.reapplyAdEquips();
});

socket.on('roomJoined', (data) => {
    // 진입 성공 — pending 소비 + 쿼리 스트립 (자동 재입장 재호출에도 멱등)
    settleEntrySuccess();
    sessionStorage.removeItem('horseRaceFromDice');
    document.getElementById('loadingScreen').style.display = 'none';

    // 재입장 시 로컬 레이스 처리 — "같은 라운드" 판별 후 분기.
    // 일시 재연결(모바일 백그라운드 → ping timeout → 복귀)은 일상 경로라, 무조건 gen++ 하면
    // rAF는 살고 종료 tail만 죽는 반쪽 무효화가 된다(결과/emit 유실, isRaceActive 고착, catch-up 사망).
    // 서버는 레이스 시작 시 record(고유 id)를 history에 push하므로 서버 history 마지막 id == 서버의 현재/최신 라운드 id.
    const _srvHistory = (data.gameState && data.gameState.horseRaceHistory) || [];
    const _srvLatestId = _srvHistory.length > 0 ? _srvHistory[_srvHistory.length - 1].id : null;
    const _sameRound = !!(window._raceRecordId && _srvLatestId === window._raceRecordId);
    if (!_sameRound) {
        // 다른 라운드/서버 기록 없음/로컬 record 없음 — 진행 중이던 로컬 레이스·다시보기 완전 무효화
        window._raceGen = (window._raceGen || 0) + 1;
        if (window._raceAnimFrameId) {
            raceAnimWin().cancelAnimationFrame(window._raceAnimFrameId); // 예약한 창(PiP 가능)에서 취소
            window._raceAnimFrameId = null;
        }
        if (window._raceRankingInterval) {
            clearInterval(window._raceRankingInterval);
            window._raceRankingInterval = null;
        }
        if (window._raceVisHandler) {
            document.removeEventListener('visibilitychange', window._raceVisHandler);
            window._raceVisHandler = null;
        }
        window._raceRecordId = null;
        // 다시보기 뒷정리 (horseRaceStarted 취소 블록과 대칭) — 죽은 다시보기의 종료 버튼·stale 선택 버퍼 잔존 방지
        removeReplayStopButton();
        pendingHorseSelectionReady = null;
        raceLabelsFresh = false; // 순단 재접속: 카운트다운~시작 창에서 started 유실 시 fresh 고착 방지
        // 로컬 레이스 상태 정리 — 아래에서 서버 payload(isHorseRaceActive) 기준으로 재동기화됨
        isRaceActive = false;
        isReplayActive = false;
    }
    // 같은 라운드면 아무것도 하지 않는다 — 레이스/종료 tail/catch-up 전부 생존, 이후 완주 emit은 정당.

    // 완주 알림이 순단으로 유실된 경우(window._pendingRaceCompleteEmit) — 같은 라운드 + 같은 세대 확인 후 1회 재전송
    const _pendingEmit = window._pendingRaceCompleteEmit;
    if (_pendingEmit) {
        window._pendingRaceCompleteEmit = null;
        if (_sameRound && _pendingEmit.gen === window._raceGen && _pendingEmit.recordId === _srvLatestId) {
            socket.emit('raceAnimationComplete');
            console.log('[경마] 재연결 후 완주 알림 재전송');
        }
    }

    currentRoomId = data.roomId;
    const globalInput = document.getElementById('globalUserNameInput');
    currentUser = (globalInput && globalInput.value) || data.userName || '';
    // 새로고침 시 재입장을 위해 방 정보 저장
    sessionStorage.setItem('horseRaceActiveRoom', JSON.stringify({
        roomId: data.roomId, userName: currentUser,
        serverId: currentServerId, serverName: currentServerName
    }));
    initChatModule();
    isHost = data.isHost;
    isReady = data.isReady || false;
    readyUsers = data.readyUsers || [];
    // 게임 진행 상태를 먼저 동기화 (initReadyModule 전에 필요)
    if ((data.gameState && data.gameState.isHorseRaceActive) || data.isGameActive) {
        isRaceActive = true;
    }
    initReadyModule();
    initOrderModule();
    if (typeof RankingModule !== 'undefined') {
        RankingModule.init(currentServerId, currentUser);
        RankingModule.setHost(isHost);
    }

    // 경마 게임 상태 초기화 (gameState에서 가져오기)
    if (data.gameState) {
        if (data.gameState.selectedVehicleTypes) {
            selectedVehicleTypes = data.gameState.selectedVehicleTypes;
            console.log('[roomJoined] selectedVehicleTypes 설정:', selectedVehicleTypes);
        }
        if (data.gameState.availableHorses) {
            availableHorses = data.gameState.availableHorses;
        }
        if (data.gameState.userHorseBets) {
            // 경기 중이면 전체 표시, 아니면 본인 선택만
            if (data.gameState.isHorseRaceActive || isRaceActive) {
                userHorseBets = data.gameState.userHorseBets;
            } else {
                userHorseBets = {};
                if (data.gameState.userHorseBets[currentUser] !== undefined) {
                    userHorseBets[currentUser] = data.gameState.userHorseBets[currentUser];
                }
            }
        }
        if (data.gameState.horseRaceMode) {
            horseRaceMode = data.gameState.horseRaceMode;
        }
        if (data.gameState.horseRaceHistory) {
            horseRaceHistory = data.gameState.horseRaceHistory;
            renderHistory();
        }
        if (data.gameState.trackLength) {
            currentTrackLength = data.gameState.trackLength;
            // trackLength에 따라 미터 값 설정 (서버 프리셋 사용)
            currentTrackDistanceMeters = trackPresetsFromServer[currentTrackLength] || 700;
        }
        // N등 투표 / 룰렛 결과 동기화 (재접속 + 신규 입장 모두)
        if (data.gameState.userRankVotes) {
            userRankVotes = data.gameState.userRankVotes;
        }
        if (typeof data.gameState.targetRank === 'number') {
            window._targetRank = data.gameState.targetRank;
        }
    }

    document.getElementById('gameSection').classList.add('active');
    document.body.classList.add('game-active');
    // 재입장(reconnect 포함)은 항상 비-레이스 화면 — race-running 잔존 시 스티키 광고 영구 숨김 방지
    document.body.classList.remove('race-running');

    setHorseSoundCheckboxes();
    if (window.SoundManager && typeof window.SoundManager.ensureContext === 'function') {
        window.SoundManager.ensureContext();
    }
    initializeGameScreen(data);
    ReadyModule.setReadyUsers(readyUsers);
    autoSelectAttempted = false; // 방마다 리셋
    initAutoSelectHorseToggle();

    // 기록 섹션 표시
    document.getElementById('historySection').classList.add('visible');
    
    // 경마 게임인 경우 말 선택 UI가 표시될 때까지 잠시 대기 후 다시 확인
    if (data.gameType === 'horse-race') {
        setTimeout(() => {
            const horseSelectionSection = document.getElementById('horseSelectionSection');
            if (horseSelectionSection && !horseSelectionSection.classList.contains('active')) {
                // 말 선택 UI가 아직 표시되지 않았으면 서버에 요청
                // horseSelectionReady 이벤트를 기다림 (서버에서 자동으로 보냄)
            }
        }, 500);
    }

    if (window.FreeInvite && data.shortcode) {
        window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
    }
    // 광고 코스메틱 재장착: 서버 transient(room.adCosmetics)는 leave/disconnect로 정리되므로
    // 방 (재)입장 시 sessionStorage 장착 상태로 shop:adEquip 재emit해 서버를 다시 채운다.
    if (window.ShopModule && typeof ShopModule.reapplyAdEquips === 'function') ShopModule.reapplyAdEquips();
});

socket.on('roomError', (message) => {
    // A-2 첫 settle만 유효 — 실패 알림→이동 대기 중 도착한 중복 roomError는 무시 (알림 스택 방지).
    // 진입 성공 후의 인게임 roomError(방제목 변경 실패 등)는 이 플래그가 false라 정상 표시된다.
    if (entryErrorNavPending) return;
    sessionStorage.removeItem('horseRaceFromDice');
    var msg = (typeof message === 'string' && message) ? message : '방에 들어가지 못했어요.';
    // 실패 UI가 먼저 떠 있으면(워치독/serverError 선발) 사유 텍스트만 갱신 — 이중 알림/이동 방지
    if (isEntryFailureVisible()) {
        disarmEntry();
        entrySettled = true;
        updateEntryFailureReason(msg);
        return;
    }
    disarmEntry();
    entrySettled = true;
    entryErrorNavPending = true;
    sessionStorage.removeItem('horseRaceActiveRoom');
    // 사유를 읽을 수 있게: 알림 확인(닫기) 또는 3초 중 먼저 오는 쪽에 로비 이동 (중복 이동 가드)
    var moved = false;
    var goLobby = function () {
        if (moved) return;
        moved = true;
        window.location.href = '/game';
    };
    showCustomAlert(msg, 'error', '', goLobby);
    setTimeout(goLobby, ROOM_ERROR_REDIRECT_MS);
});

// 서버 진입 거부(setServerId 강검증 등) — 사용자 개시 진입 구간에만 반응.
// 인게임 재연결 중 순단 serverError(DB 오류 등)로 게임 화면이 튕기지 않게 스코프를 제한한다.
socket.on('serverError', (message) => {
    if (!entryInFlight || entrySettled) return;
    disarmEntry();
    entrySettled = true;
    var msg = (typeof message === 'string' && message) ? message : '서버에 들어가지 못했어요.';
    showEntryFailureUI(msg);
});

socket.on('horseRaceError', (message) => {
    addDebugLog(`에러: ${message}`, 'error');
    showCustomAlert(message, 'error');
});

// readyError는 ReadyModule에서 처리

// 말 선택 준비 이벤트
// 경주/다시보기 중 보관해 둔 다음 라운드 선택 이벤트를 적용 (적용했으면 true)
function flushPendingHorseSelection() {
    if (pendingHorseSelectionReady && !isRaceActive) {
        var d = pendingHorseSelectionReady;
        pendingHorseSelectionReady = null;
        applyHorseSelectionReady(d);
        return true;
    }
    return false;
}

// 다시보기 중단 후 평소 준비/선택 화면으로 복귀
function returnToSelectionAfterReplay() {
    // 재생 중 열린 다음 라운드 선택이 있으면 적용 → 그리드 즉시 표시
    if (flushPendingHorseSelection()) return;
    // 보유한 선택 데이터로 탈것 선택 섹션을 다시 띄워 사용자가 고를 수 있게 한다.
    // (다시보기 진입 시 playReplay가 섹션 .active를 해제하므로 여기서 복원)
    var hss = document.getElementById('horseSelectionSection');
    if (hss && !isRaceActive && availableHorses && availableHorses.length > 0) {
        hss.classList.add('active');
        renderHorseSelection();
    }
    if (typeof updateReadyButton === 'function') updateReadyButton();
}

socket.on('horseSelectionReady', (data) => {
    // 🔧 경주/다시보기 중이면 트랙 초기화 방지 위해 즉시 처리하지 않고 보관 후 종료 시 적용.
    //    (라이브 경주 중 도착분도 버리면 숨김 탭 지연 재생 클라이언트가 다음 라운드 선택을 영영 못 받음)
    if (isRaceActive) {
        pendingHorseSelectionReady = data;
        return;
    }
    applyHorseSelectionReady(data);
});

async function applyHorseSelectionReady(data) {
    // 새 선택 페이즈 진입 = 이름표 fresh 창 종료 — 모든 경로(정상 라운드 종료/중단/재접속)의
    // 공통 수렴점에서 닫아 stale labels가 선택화면에 적용되는 것을 방지(lesson 2026-06-22).
    raceLabelsFresh = false;
    availableHorses = data.availableHorses || [];
    userHorseBets = data.userHorseBets || {};
    selectedUsersFromServer = data.selectedUsers || [];  // 선택 완료자 목록
    selectedHorseIndices = data.selectedHorseIndices || [];  // 선택된 말 인덱스 목록
    canSelectDuplicate = data.canSelectDuplicate || false;  // 중복 선택 가능 여부
    horseRaceMode = data.horseRaceMode || 'last';
    selectedVehicleTypes = data.selectedVehicleTypes || null;
    popularVehicles = data.popularVehicles || [];
    vehicleStatsData = data.vehicleStats || [];
    if (data.trackPresets) trackPresetsFromServer = data.trackPresets;
    currentTrackLength = data.trackLength || 'medium';
    currentTrackDistanceMeters = data.trackDistanceMeters || 500;
    
    addDebugLog(`말 선택 준비: ${availableHorses.length}마리`, 'selection');

    mySelectedHorse = userHorseBets[currentUser] !== undefined ? userHorseBets[currentUser] : null;
    // 새 라운드 시작 — 자동선택 재시도 허용
    autoSelectAttempted = false;
    tryAutoSelectHorse();

    // 결과 오버레이 숨기기
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) {
        resultOverlay.classList.remove('visible');
    }
    
    // 말 선택 섹션 표시
    const horseSelectionSection = document.getElementById('horseSelectionSection');
    if (horseSelectionSection) {
        horseSelectionSection.classList.add('active');
        console.log('[horseSelectionReady] 섹션 활성화됨');
    } else {
        console.error('[horseSelectionReady] horseSelectionSection 요소를 찾을 수 없음');
    }
    
    // ALL_VEHICLES가 로드되지 않았으면 먼저 로드
    if (ALL_VEHICLES.length === 0) {
        addDebugLog('ALL_VEHICLES가 비어있음, 로드 시작...', 'warn');
        await loadVehicleThemes();
        addDebugLog(`로드 완료: ${ALL_VEHICLES.length}개`, 'info');
    }
    
    console.log('[horseSelectionReady] renderHorseSelection 호출 전:', {
        availableHorses: availableHorses.length,
        ALL_VEHICLES: ALL_VEHICLES.length,
        selectedVehicleTypes: selectedVehicleTypes,
        userHorseBets: Object.keys(userHorseBets).length,
        currentUser: currentUser
    });
    
    // 약간의 지연 후 렌더링 (DOM 업데이트 대기)
    setTimeout(() => {
        renderHorseSelection();
    }, 100);

}

// 트랙 길이 변경 이벤트
socket.on('trackLengthChanged', (data) => {
    currentTrackLength = data.trackLength || 'medium';
    currentTrackDistanceMeters = data.trackDistanceMeters || 500;
    if (data.trackPresets) trackPresetsFromServer = data.trackPresets;
    // 버튼 상태 업데이트
    const activeColor = 'var(--yellow-400)'; // 노란색 통일
    document.querySelectorAll('.track-length-btn').forEach(btn => {
        const key = btn.dataset.length;
        const isActive = key === currentTrackLength;
        btn.style.background = isActive ? activeColor : 'var(--gray-800)';
        btn.style.color = isActive ? 'var(--gray-900)' : 'var(--gray-300)';
        btn.style.boxShadow = isActive ? `0 0 8px ${activeColor}80` : 'none';
        if (trackPresetsFromServer[key]) {
            const labels = { short: '짧게', medium: '보통', long: '길게' };
            btn.textContent = `${labels[key]} (${trackPresetsFromServer[key]}m)`;
        }
    });
    // 트랙 길이 표시 업데이트
    const trackLengthInfo = document.getElementById('trackLengthInfo');
    if (trackLengthInfo) {
        trackLengthInfo.textContent = `${currentTrackDistanceMeters}m`;
    }
    // 말 선택 UI 재렌더링 (트랙 표시 갱신) — 경주/다시보기 중엔 보류 (진행 중 트랙 DOM 보호,
    // 변수는 위에서 이미 갱신되어 다음 선택 페이즈 렌더에 자연 반영)
    if (!isRaceActive) renderHorseSelection();
});

// 말 선택 현황 업데이트 이벤트 (다른 사용자 선택 시)
socket.on('horseSelectionUpdated', (data) => {
    // 🔧 경주 중이면 무시 (트랙 초기화 방지)
    if (isRaceActive) {
        console.log('[horseSelectionUpdated] 경주 중이므로 무시');
        return;
    }

    // 본인 선택만 저장 (서버에서 본인 것만 전송됨)
    userHorseBets = data.userHorseBets || {};

    // 선택 완료자 목록 저장 (어떤 탈것인지는 모름, 이름만)
    selectedUsersFromServer = data.selectedUsers || [];

    // 선택된 말 인덱스 목록과 중복 선택 가능 여부 저장
    selectedHorseIndices = data.selectedHorseIndices || [];
    canSelectDuplicate = data.canSelectDuplicate || false;

    const selectedCount = selectedUsersFromServer.length;
    addDebugLog(`말 선택 업데이트: ${selectedCount}명 선택, 중복가능: ${canSelectDuplicate}`, 'selection');

    // 내 선택 상태 확인 (선택 취소 시 undefined가 될 수 있음)
    if (userHorseBets[currentUser] !== undefined) {
        mySelectedHorse = userHorseBets[currentUser];
        window._isRandomSelection = false;  // 일반 선택 시 랜덤 상태 초기화
    } else {
        mySelectedHorse = null; // 선택 취소
    }

    renderHorseSelection();
});

// N등 투표 현황 업데이트 (서버 broadcast)
socket.on('rankVotesUpdated', (data) => {
    if (isRaceActive) return; // 경주 중에는 무시
    userRankVotes = (data && data.userRankVotes) ? data.userRankVotes : {};
    addDebugLog(`N등 투표 갱신: ${Object.keys(userRankVotes).length}표`, 'selection');
    renderRankVoteSection();
});

// N등 룰렛 시작 (서버에서 결정된 winningRank를 시각화만)
socket.on('horseRouletteStart', (data) => {
    addDebugLog(`🎯 룰렛 시작: ${data.winningRank}등 결정`, 'race');
    // 본인 투표가 아직 반영 안된 라운드 보호: userRankVotes 동기화
    if (data && data.userRankVotes) userRankVotes = data.userRankVotes;
    if (data && typeof data.targetRankReason === 'string') {
        window._targetRankReason = data.targetRankReason;
    }
    playRouletteAnimation(data);
});

// fallback (투표 없음/모두 무효) — 사유 카드만 N초간 보여준 뒤 카운트다운
socket.on('horseRaceReasonHold', (data) => {
    if (data && typeof data.targetRankReason === 'string') {
        window._targetRankReason = data.targetRankReason;
    }
    if (typeof moveResultUiToCanvas === 'function') moveResultUiToCanvas();
    updateTargetRankBanner(null, true, window._targetRankReason);
});

// 랜덤 선택 완료 이벤트 (본인도 뭘 골랐는지 모름)
socket.on('randomHorseSelected', (data) => {
    // 랜덤 선택 상태 저장
    window._isRandomSelection = true;
    mySelectedHorse = -999; // 특수 값으로 "랜덤 선택됨" 표시

    // 선택 완료자 목록 업데이트
    selectedUsersFromServer = data.selectedUsers || [];
    canSelectDuplicate = data.canSelectDuplicate || false;

    addDebugLog(`랜덤 선택 완료 (어떤 탈것인지 비밀!)`, 'selection');
    renderHorseSelection();
});

// 준비 취소 시 말 선택 취소 이벤트
socket.on('horseSelectionCancelled', (data) => {
    // 경주/다시보기 중 도착분은 폐기 — renderHorseSelection이 진행 중인 트랙 DOM을 선택 미리보기로
    // 갈아엎고(전원 렌더링 정지), userHorseBets 삭제가 경주 종료 판정(뒤에서 두 번째 완주)을 흔든다.
    // 드롭해도 다음 선택 페이즈의 applyHorseSelectionReady가 서버 상태로 전체 재동기화하므로 유실 없음.
    if (isRaceActive) {
        // 이 로그가 보이면 = 서버 게이트를 통과한 cancelled가 경주 중 도착했고, 클라 2차 가드가 막은 것
        console.warn('[경마][가드] 경주 중 horseSelectionCancelled 폐기 —', data && data.userName, '(트랙 렌더 보호)');
        return;
    }
    const { userName } = data;

    // 해당 사용자의 선택 제거
    if (userHorseBets[userName] !== undefined) {
        delete userHorseBets[userName];
    }

    // 본인이면 내 선택도 초기화
    if (userName === currentUser) {
        mySelectedHorse = null;
        window._isRandomSelection = false;  // 랜덤 선택 상태도 초기화
    }

    // 선택 완료자 목록에서 제거
    selectedUsersFromServer = selectedUsersFromServer.filter(name => name !== userName);

    addDebugLog(`${userName} 준비 취소로 말 선택 취소`, 'selection');
    renderHorseSelection();
});

// 카운트다운 이벤트 (3,2,1 - 이미 게임 시작)
socket.on('horseRaceCountdown', (data) => {
    // 결정 사유 텍스트는 이미 표시됨 (horseRouletteStart 또는 horseRaceReasonHold).
    // 여기서는 reason+막대 페이드 아웃 → 카운트다운 자리 비우기 (배너는 잔존).
    if (typeof fadeBarsOverlayOnly === 'function') fadeBarsOverlayOnly();

    // 다시보기 중이면 즉시 중단 (새 라운드 시작)
    if (isReplayActive) {
        removeReplayStopButton();
        if (window._raceAnimFrameId) {
            raceAnimWin().cancelAnimationFrame(window._raceAnimFrameId); // 예약한 창(PiP 가능)에서 취소
            window._raceAnimFrameId = null;
        }
        if (window.SoundManager) SoundManager.stopAll();
        const resultOverlay = document.getElementById('resultOverlay');
        if (resultOverlay) resultOverlay.classList.remove('visible');
        isRaceActive = false;
        isReplayActive = false;
        pendingHorseSelectionReady = null; // 새 라운드 시작으로 다시보기 강제중단 — 보관된 선택 이벤트 폐기(stale 적용 방지)
        window._raceGen = (window._raceGen || 0) + 1; // 중단된 다시보기의 종료 시퀀스 tail 무효화
        // 중단된 다시보기의 visibility 리스너 제거 (카운트다운~새 레이스 init 사이 갭에서 stale 복귀 처리 방지)
        if (window._raceVisHandler) {
            document.removeEventListener('visibilitychange', window._raceVisHandler);
            window._raceVisHandler = null;
        }
    }

    addDebugLog(`카운트다운 시작: ${data.duration}초`, 'race');

    // 카운트다운부터 이름표 적용 — 서버가 동봉한 이번 라운드 labelCosmetics 저장.
    // labels만 fresh로 교체하고 room/horses는 보존 — 이 창에서 경주가 무산되면(호스트 종료 등)
    // 직전 라운드 다시보기가 horses 꾸미기를 계속 읽기 때문(통째 재대입 금지).
    // 필드 없으면(서버 구버전/조회 지연 폴백) 기존처럼 경주 시작 시점에 입힌다.
    if (data.labelCosmetics) {
        var _rc = window._raceCosmetics || {};
        window._raceCosmetics = { room: _rc.room || null, horses: _rc.horses || {}, labels: data.labelCosmetics };
        raceLabelsFresh = true;
    }

    // 카운트다운 시작 시 모든 선택 공개
    if (data.userHorseBets) {
        userHorseBets = data.userHorseBets;
        renderHorseSelection(); // UI 업데이트 (모든 선택 표시)
        addDebugLog(`선택 공개: ${JSON.stringify(data.userHorseBets)}`, 'selection');
    }

    // 모바일 사용자에게 경고 메시지 표시
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        ChatModule.displayChatMessage({
            userName: '시스템',
            message: '📱 모바일 환경에서는 경마 화면이 원활하지 않을 수 있습니다. PC 환경을 권장합니다!',
            isSystem: true
        });
    }

    // 사운드: 카운트다운 + 관중 웅성거림 시작 (저볼륨)
    if (window.SoundManager) {
        SoundManager.playSound('horse-race_countdown', getHorseSoundEnabled());
        SoundManager.playLoop('horse-race_crowd', getHorseSoundEnabled(), 0.2);
    }
    // 다시보기/게임종료 섹션 숨기기
    document.getElementById('replaySection').style.display = 'none';
    document.getElementById('endGameSection').style.display = 'none';
    // 개정3: 별도 attach 불필요 — 창이 열려 있으면 래퍼는 이미 상시 PiP, showCountdown이 그 문서에 렌더한다.
    showCountdown();
});

// 경주 시작 이벤트
socket.on('horseRaceStarted', (data) => {
    // 수신 시각 앵커 — 소켓 이벤트는 숨김 탭에서도 스로틀되지 않으므로 이 시각이 "라이브 출발 기준"이 된다.
    // startRaceAnimation의 500ms init 타이머가 스로틀로 늦어도 startTime 원점(anchor+500)은 밀리지 않는다.
    const raceStartAnchor = Date.now();
    addDebugLog(`📨 horseRaceStarted 이벤트 수신`, 'info');

    // 꾸미기 페이로드 저장 (말별 canonical + 방장 연출) — 시각 렌더용, 결과 무관
    window._raceCosmetics = { room: data.roomCosmetics || null, horses: data.horseCosmetics || {}, labels: data.labelCosmetics || {} };
    raceLabelsFresh = false; // fresh 창 종료 — 다음 라운드 선택화면은 다시 내 로컬만(stale 누출 방지)
    window._slowMotionConfig = data.slowMotionConfig || null;
    // 날씨 설정 저장 — 히스토리 다시보기(playReplay)가 읽음 (record에는 weatherConfig가 없음)
    window._weatherConfig = data.weatherConfig || {};
    // N등 투표 결과 (null = fallback 'last')
    window._targetRank = (typeof data.targetRank === 'number') ? data.targetRank : null;
    if (data && typeof data.targetRankReason === 'string') {
        window._targetRankReason = data.targetRankReason;
    }
    // 게임 시작 시 배너만 표시, reason은 이미 카운트다운 시점에 fade 됨 (중복 방지)
    updateTargetRankBanner(window._targetRank, true);

    // 현재 라운드 record를 로컬 히스토리에 즉시 추가 (horseRaceEnded 도착 전 다시보기 가능)
    if (data.record) {
        // 같은 id의 record가 이미 있으면 덮어쓰기, 없으면 추가
        const existIdx = horseRaceHistory.findIndex(r => r.id === data.record.id);
        if (existIdx >= 0) {
            horseRaceHistory[existIdx] = data.record;
        } else {
            horseRaceHistory.push(data.record);
        }
    }
    // 현재 라운드 record id — 재연결 roomJoined에서 "같은 라운드" 판별 재료.
    // 서버도 레이스 시작 시 같은 record를 history에 push하므로, 서버 history 마지막 entry id와 일치하면 같은 라운드다.
    window._raceRecordId = (data.record && data.record.id) || null;

    // 다시보기 중이면 즉시 중단
    removeReplayStopButton();
    pendingHorseSelectionReady = null; // 새 경주 시작으로 다시보기 강제중단 — 보관된 선택 이벤트 폐기(stale 적용 방지)
    if (window._raceAnimFrameId) {
        raceAnimWin().cancelAnimationFrame(window._raceAnimFrameId); // 예약한 창(PiP 가능)에서 취소
        window._raceAnimFrameId = null;
    }
    // 직전 레이스/다시보기의 종료 시퀀스 tail 무효화 — rAF가 이미 끝나 tail만 대기 중인 경우도
    // 커버해야 하므로 무조건 실행 (지연 완주 클라이언트의 stale raceAnimationComplete 방지)
    window._raceGen = (window._raceGen || 0) + 1;
    // 개정3: PiP는 건드리지 않는다 — 래퍼는 창이 열려 있는 한 상시 PiP, 새 레이스도 그 안에서 init된다.
    if (window.SoundManager) SoundManager.stopAll();
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) resultOverlay.classList.remove('visible');

    // 탭 숨김 여부와 무관하게 전원 같이 출발 — 숨김 탭은 startRaceAnimation의 pausedAt 초기화로
    // 일시정지 상태에서 시작해 복귀 시 t=0부터 재생됨
    raceResultShown = false; // 새 경주 시작 시 결과 표시 플래그 리셋
    isRaceActive = true;
    isReplayActive = false;
    document.body.classList.add('race-running'); // 레이스 중 스티키 광고 숨김
    updateStartButton(); // 게임 시작 시 버튼 상태 업데이트

    // 채팅에 게임 시작 시스템 메시지 추가
    if (ChatModule && typeof ChatModule.displayChatMessage === 'function') {
        ChatModule.displayChatMessage({
            message: `🏁 경주가 시작되었습니다!`,
            isSystemMessage: true,
            time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        }, true);
    }

    // 사운드: 출발 총소리 → 관중 볼륨 업 + BGM 시작
    if (window.SoundManager) {
        SoundManager.playSound('horse-race_gunshot', getHorseSoundEnabled());
        // 관중 볼륨 업 (0.2 → 0.7) + BGM 시작
        setTimeout(() => {
            SoundManager.setVolume('horse-race_crowd', 0.7);
            SoundManager.playLoop('horse-race_bgm', getHorseSoundEnabled(), 0.3);
        }, 300);
        // 레이스 중 관중 볼륨 안정화 (0.7 → 0.5)
        setTimeout(() => {
            SoundManager.setVolume('horse-race_crowd', 0.5);
        }, 2000);
    }

    // everPlayedUsers 업데이트
    if (data.everPlayedUsers) {
        everPlayedUsers = [...data.everPlayedUsers];
    }

    addDebugLog(`경주 시작: ${data.horseRankings?.length || 0}마리`, 'race');
    
    // 사용자 베팅 정보 업데이트 (경주 애니메이션에서 사용)
    if (data.userHorseBets) {
        userHorseBets = data.userHorseBets;
    }
    
    // 탈것 타입 비교 (게임 시작 전 vs 게임 시작 후)
    const beforeSelectedVehicleTypes = selectedVehicleTypes;
    console.log('[경주 시작] selectedVehicleTypes 비교:', {
        이전: beforeSelectedVehicleTypes,
        서버에서_받은_값: data.selectedVehicleTypes,
        horseRankings: data.horseRankings,
        availableHorses: availableHorses
    });
    
    // 탈것 타입 업데이트 (서버에서 전달된 것 사용, 없으면 기존 값 유지)
    if (data.selectedVehicleTypes && data.selectedVehicleTypes.length > 0) {
        // 서버에서 받은 값과 기존 값이 다르면 경고
        if (JSON.stringify(selectedVehicleTypes) !== JSON.stringify(data.selectedVehicleTypes)) {
            console.warn('[경주 시작] ⚠️ selectedVehicleTypes가 변경됨!', {
                이전: selectedVehicleTypes,
                새로운: data.selectedVehicleTypes
            });
        }
        selectedVehicleTypes = data.selectedVehicleTypes;
        console.log('[경주 시작] selectedVehicleTypes 업데이트:', selectedVehicleTypes);
    } else {
        console.warn('[경주 시작] selectedVehicleTypes가 전달되지 않음. 기존 값 유지:', selectedVehicleTypes);
    }
    
    // 말 선택 섹션 숨기기
    document.getElementById('horseSelectionSection').classList.remove('active');
    
    // 현재 진행 중인 경주 기록 저장
    const currentRaceRecord = data.record;

    // 전원 동일 베팅 시 오버레이 (뒤에서 레이스 진행됨)
    if (data.allSameBet) {
        showQuickRaceOverlay();
    }

    // 경주 트랙 표시 (서버에서 받은 기믹 데이터 전달) - 콜백으로 종료 처리
    startRaceAnimation(data.horseRankings, data.speeds, data.gimmicks, (actualFinishOrder) => {
        // 결승 연출(폭죽/색종이) 1회 재생 — 본인이 장착한 finish_fx 를 본인 화면에서 (개인 꾸미기, 방장 무관). 외관만, 결과 무관.
        if (window.HorseShop) {
            window.HorseShop.playFinishFx();
        }
        // 사운드: 골인! 관중 최고조 → 환호 → 페이드아웃
        if (window.SoundManager) {
            // 슬로우모션 환호성 정지 (아직 재생 중이면)
            SoundManager.stopLoop('horse-race_slowmo_cheer');
            // 관중 환호 최고조 (1.0)
            SoundManager.setVolume('horse-race_crowd', 1.0);
            // BGM 정지
            SoundManager.stopLoop('horse-race_bgm');
            // 팡파레/환호 재생
            SoundManager.playSound('horse-race_finish', getHorseSoundEnabled());
            SoundManager.playSound('horse-race_cheer_burst', getHorseSoundEnabled(), 0.8);
            // 3초 후 관중 페이드아웃
            setTimeout(() => {
                let vol = 1.0;
                const fadeInterval = setInterval(() => {
                    vol -= 0.1;
                    if (vol <= 0) {
                        SoundManager.stopLoop('horse-race_crowd');
                        clearInterval(fadeInterval);
                    } else {
                        SoundManager.setVolume('horse-race_crowd', vol);
                    }
                }, 200);
            }, 3000);
        }
        // 경주 기록은 서버가 horseRaceEnded 이벤트로 전송 (중복 방지)
        // 클라이언트 직접 push 제거 - 호스트 중복 및 라운드 번호 오류 해결
        // 서버 순위 기준으로 결과 표시 (기믹에 의한 애니메이션 순서 차이 무시)
        showRaceResult(data);

        // 서버에 애니메이션 완료 알림 (서버가 결과 메시지 전송)
        // socket.io는 재연결까지 emit을 버퍼링함 — 끊긴 상태의 stale 완료 알림이 재연결 후
        // 다른 라운드의 pendingRaceResult를 오소비하지 않도록 연결 중일 때만 전송
        if (socket.connected) {
            socket.emit('raceAnimationComplete');
            window._pendingRaceCompleteEmit = null;
            console.log('[경마] 애니메이션 완료 → 서버에 알림 전송');
        } else {
            // 완주 순간 순단 — 그냥 드롭하면 전원 순단 시 서버 pendingRaceResult 미소비(우승 채팅/DB/코인 유실).
            // 재연결 roomJoined에서 같은 라운드 + 같은 세대 확인 후 1회 재전송 (서버 first-consume 계약으로 중복 무해)
            window._pendingRaceCompleteEmit = {
                gen: window._raceGen, // 종료 tail의 gen 가드 직후라 이 레이스의 myRaceGen과 동일
                recordId: (data.record && data.record.id) || null
            };
        }

        // 숨김 탭 지연 재생 클라이언트: 경주 중 버퍼된 다음 라운드 선택 이벤트 적용
        // (showRaceResult가 isRaceActive=false로 만든 뒤라 flush 조건 충족, 버퍼 없으면 no-op)
        flushPendingHorseSelection();
    }, {
        trackDistanceMeters: data.trackDistanceMeters || 500,
        speedSeeds: data.speedSeeds || null,
        weatherSchedule: data.weatherSchedule || [],
        weatherConfig: data.weatherConfig || {},
        evolutionTargets: data.evolutionTargets || [],
        fakeEvolutionTargets: data.fakeEvolutionTargets || [],
        startAnchor: raceStartAnchor // 라이브 출발 기준 시각 (catch-up의 "라이브 진행 지점" 원점)
    });

    // 게임 상태 업데이트 + 실황 중계 시작
    const gameStatus = document.getElementById('gameStatus');
    if (gameStatus) {
        gameStatus.textContent = '게임 진행 중!';
        gameStatus.className = 'game-status playing';
    }
    if (typeof startRaceCommentary === 'function') startRaceCommentary();
});

// 경주 종료 이벤트 (라운드 결과 후 서버에서 보내는 경우)
socket.on('horseRaceEnded', (data) => {
    // 게임 기록 업데이트
    if (data.horseRaceHistory) {
        horseRaceHistory = data.horseRaceHistory;
        renderHistory();
    }

    // 말 선택만 초기화 (준비 상태는 서버의 readyUsersUpdated 이벤트가 처리)
    mySelectedHorse = null;
    // 동점자 자동준비 / 다음 라운드 자동선택을 위해 시도 플래그 리셋
    // (서버가 horseRaceEnded 직후 readyUsersUpdated를 보내면 onReadyChanged가 tryAutoSelectHorse 호출)
    autoSelectAttempted = false;
    // isReady 직접 초기화 제거 - 자동준비 대상자는 서버가 설정함

    // N등 투표 리셋 (다음 라운드에 잔존 방지) — 서버도 이미 비웠음
    userRankVotes = {};
    // 결과 연출 UI를 캔버스에서 원위치로 복귀 (다음 라운드 투표는 위에서)
    if (typeof moveResultUiOffCanvas === 'function') moveResultUiOffCanvas();
    if (typeof renderRankVoteSection === 'function') renderRankVoteSection();
});

// 게임 완전 리셋 이벤트 (호스트가 게임 종료 버튼을 누른 경우)
socket.on('horseRaceGameReset', (data) => {
    raceLabelsFresh = false; // 카운트다운~시작 창에서 게임 종료 시 fresh 고착 방지
    removeQuickRaceOverlay();
    // 🔧 경주 애니메이션 정리 (경주 중 리셋 시 화면 깨짐 방지)
    if (window._raceAnimFrameId) {
        raceAnimWin().cancelAnimationFrame(window._raceAnimFrameId); // 예약한 창(PiP 가능)에서 취소
        window._raceAnimFrameId = null;
        console.log('[horseRaceGameReset] animationFrame 정리됨');
    }
    if (window._raceRankingInterval) {
        clearInterval(window._raceRankingInterval);
        window._raceRankingInterval = null;
        console.log('[horseRaceGameReset] rankingInterval 정리됨');
    }
    // 중단된 레이스의 visibility 일시정지 리스너 정리 — 유령 "▶ 경주 재개!" 토스트 방지
    if (window._raceVisHandler) {
        document.removeEventListener('visibilitychange', window._raceVisHandler);
        window._raceVisHandler = null;
    }
    // 종료 시퀀스 tail 무효화 + 리셋 이전 라운드의 보관된 선택 이벤트 폐기 (stale 적용 방지)
    window._raceGen = (window._raceGen || 0) + 1;
    pendingHorseSelectionReady = null;
    window._raceRecordId = null; // 리셋된 라운드는 재연결 "같은 라운드" 판별 대상 아님
    // 개정3: PiP는 건드리지 않는다 — 리셋 후 선택 화면 재렌더도 raceDoc() 경유로 창 안에서 이어진다.

    if (window.SoundManager) {
        SoundManager.stopAll();
    }

    // 게임 기록 업데이트
    if (data.horseRaceHistory) {
        horseRaceHistory = data.horseRaceHistory;
        renderHistory();
    }

    // 결과 오버레이 숨기기
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) {
        resultOverlay.classList.remove('visible');
    }

    // 경주 중 리셋 시 race-running 잔존 방지 — 스티키 광고 복원
    document.body.classList.remove('race-running');

    // 다시보기/게임종료 섹션 숨기기
    document.getElementById('replaySection').style.display = 'none';
    document.getElementById('endGameSection').style.display = 'none';

    // 채팅 섹션 복원 (race-active 클래스 제거)
    if (typeof window.hideRaceChatOverlay === 'function') {
        window.hideRaceChatOverlay();
    }

    // 상태 초기화
    isReady = false;
    isRaceActive = false;
    mySelectedHorse = null;
    userRankVotes = {};   // N등 투표 리셋
    if (typeof moveResultUiOffCanvas === 'function') moveResultUiOffCanvas();
    if (typeof renderRankVoteSection === 'function') renderRankVoteSection();
    if (typeof stopRaceCommentary === 'function') stopRaceCommentary();
    updateReadyButton();
    updateStartButton();
    if (currentUsers.length > 0) updateUsers(currentUsers);
});

// 준비 상태 변경
// readyStateChanged, readyUsersUpdated는 ReadyModule에서 처리 (initReadyModule에서 바인딩)

// 사용자 목록 업데이트
socket.on('updateUsers', (users) => {
    if (window.SoundManager) SoundManager.playSound('common_notification', getHorseSoundEnabled());
    // 호스트 상태 확인 및 업데이트
    const myUser = users.find(u => u.name === currentUser);
    if (myUser && myUser.isHost !== isHost) {
        isHost = myUser.isHost;
        if (typeof RankingModule !== 'undefined') RankingModule.setHost(isHost);
        ReadyModule.setHost(isHost);
        updateHostUI();
        // 호스트 변경 시 트랙 길이 컨트롤 업데이트
        const hss = document.getElementById('horseSelectionSection');
        if (hss && hss.classList.contains('active')) {
            renderHorseSelection();
        }
    }
    ChatModule.updateConnectedUsers(users);
    updateUsers(users);
});

// 호스트 권한 전달 알림
socket.on('hostTransferred', (data) => {
    showCustomAlert(data.message || '호스트 권한이 전달되었습니다.', 'success');
    isHost = true;
    updateHostUI();
    // 호스트 변경 시 트랙 길이 컨트롤 업데이트
    const hss = document.getElementById('horseSelectionSection');
    if (hss && hss.classList.contains('active')) {
        renderHorseSelection();
    }
});

// 강퇴당했을 때
socket.on('kicked', (message) => {
    showCustomAlert(message, 'info');
    location.reload();
});

// 다른 곳에서 같은 닉네임으로 접속 → 이 세션 종료 (최신 접속 우선). reload 금지(핑퐁 방지).
socket.on('sessionTakenOver', (message) => {
    // 진입 워치독 무조건 해제 — 인계(C-10) 흐름에 실패 UI가 끼어들지 않게 (기존 흐름 무변경)
    disarmEntry();
    entrySettled = true;
    try { sessionStorage.removeItem('horseRaceActiveRoom'); } catch (e) {}
    try { socket.disconnect(); } catch (e) {}  // 소켓 즉시 종료 → 재연결·재입장 차단(핑퐁 방지)
    showCustomAlert(message || '다른 곳에서 접속하여 연결이 종료되었습니다.', 'info');
    setTimeout(() => { window.location.replace('/game'); }, 2500);
});

// 호스트 변경 알림
socket.on('hostChanged', (data) => {
    console.log('호스트 변경 알림:', data.message);
});

socket.on('newSeason', (data) => {
    if (typeof RankingModule !== 'undefined') RankingModule.onNewSeason(data);
});

// 채팅은 ChatModule에서 처리 (initChatModule에서 바인딩)

// 주문받기 이벤트/함수는 OrderModule에서 처리

// 커스텀 알림창 — 이 페이지의 단일 정의 (horse-race-multiplayer.html 인라인판을 이곳으로 통합).
// 구 인라인판의 #customAlert DOM 계약(AutoTest C-7 셀렉터)·아이콘·애니메이션을 유지하고
// title(3번째)·onClose(4번째, 닫힘 시 1회 콜백) 파라미터를 지원한다. 기존 1~2인자 호출부 하위호환.
function showCustomAlert(message, type = 'info', title = '', onClose) {
    // 기존 알림 대체 (#customAlert 1개 유지)
    const existingAlert = document.getElementById('customAlert');
    if (existingAlert) {
        existingAlert.remove();
    }

    let borderColor, icon;
    switch (type) {
        case 'error':
            borderColor = 'rgb(239, 68, 68)';
            icon = '⚠️';
            break;
        case 'warning':
            borderColor = 'rgb(234, 179, 8)';
            icon = '⚠️';
            break;
        case 'success':
            borderColor = 'rgb(34, 197, 94)';
            icon = '✅';
            break;
        default:
            borderColor = 'rgb(147, 51, 234)';
            icon = 'ℹ️';
    }

    const alertOverlay = document.createElement('div');
    alertOverlay.id = 'customAlert';
    alertOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.4); z-index: 10001;
        display: flex; justify-content: center; align-items: center;
        animation: fadeIn 0.2s ease-out;
    `;

    const alertContent = document.createElement('div');
    alertContent.style.cssText = `
        background: white; border-radius: 16px; padding: 20px;
        max-width: 450px; width: calc(100vw - 40px);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
        border: 2px solid ${borderColor};
        animation: slideDown 0.3s ease-out;
        box-sizing: border-box;
    `;

    // 닫기 공통 경로 — 버튼/Esc/배경 어느 쪽이든 onClose 1회 보장 + Esc 리스너 정리
    let alertClosed = false;
    const closeAlert = () => {
        if (alertClosed) return;
        alertClosed = true;
        document.removeEventListener('keydown', handleEsc);
        alertOverlay.style.animation = 'fadeOut 0.2s ease-out';
        setTimeout(() => alertOverlay.remove(), 200);
        if (typeof onClose === 'function') onClose();
    };
    const handleEsc = (e) => {
        if (e.key === 'Escape') closeAlert();
    };

    if (title) {
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = `font-size: 17px; font-weight: bold; text-align: center; margin-bottom: 10px; color: ${borderColor};`;
        titleDiv.textContent = title;
        alertContent.appendChild(titleDiv);
    }

    const messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
        font-size: 15px; line-height: 1.6; color: rgb(17, 24, 39);
        white-space: pre-wrap; word-wrap: break-word;
        word-break: keep-all; overflow-wrap: break-word;
        text-align: center; margin-bottom: 20px;
        max-width: 100%;
    `;
    messageDiv.innerHTML = `<span style="font-size: 24px; margin-right: 8px;">${icon}</span>${message}`;

    const confirmButton = document.createElement('button');
    confirmButton.textContent = '확인';
    confirmButton.style.cssText = `
        padding: 10px 30px;
        background: ${borderColor};
        color: white; border: none; border-radius: 8px;
        font-size: 16px; font-weight: 600; cursor: pointer;
        width: 100%; transition: transform 0.1s, box-shadow 0.1s;
    `;
    confirmButton.onmouseenter = () => { confirmButton.style.transform = 'scale(1.02)'; confirmButton.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; };
    confirmButton.onmouseleave = () => { confirmButton.style.transform = 'scale(1)'; confirmButton.style.boxShadow = 'none'; };
    confirmButton.onclick = closeAlert;

    document.addEventListener('keydown', handleEsc);

    alertOverlay.onclick = (e) => {
        if (e.target === alertOverlay) closeAlert();
    };

    alertContent.appendChild(messageDiv);
    alertContent.appendChild(confirmButton);
    alertOverlay.appendChild(alertContent);
    document.body.appendChild(alertOverlay);
    confirmButton.focus();
}

// 확인 다이얼로그
function showConfirmDialog(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 10000;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; padding: 25px; border-radius: 12px; max-width: 400px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.3);';
    
    modal.innerHTML = `
        <div style="margin-bottom: 20px; line-height: 1.6; text-align: center;">${message}</div>
        <div style="display: flex; gap: 10px;">
            <button id="confirmCancel" style="flex: 1; padding: 12px; background: var(--gray-100); color: var(--text-primary); border: none; border-radius: 8px; font-size: 14px; cursor: pointer;">취소</button>
            <button id="confirmOk" style="flex: 1; padding: 12px; background: var(--btn-danger); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer;">확인</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    modal.querySelector('#confirmCancel').addEventListener('click', () => overlay.remove());
    modal.querySelector('#confirmOk').addEventListener('click', () => {
        overlay.remove();
        if (onConfirm) onConfirm();
    });
}

// 플레이어 액션 선택 다이얼로그 (호스트임명, 제외시키기, 취소)
function showPlayerActionDialog(playerName) {
    return new Promise((resolve) => {
        const existingDialog = document.getElementById('playerActionDialog');
        if (existingDialog) existingDialog.remove();

        const dialogOverlay = document.createElement('div');
        dialogOverlay.id = 'playerActionDialog';
        dialogOverlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 10002; display: flex; justify-content: center; align-items: center;';

        const dialogContent = document.createElement('div');
        dialogContent.style.cssText = 'background: var(--bg-white); border-radius: 16px; padding: 25px 30px; max-width: 500px; width: 90vw; box-shadow: 0 10px 40px rgba(0,0,0,0.2); border: 2px solid var(--horse-accent);';

        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = 'font-size: 18px; line-height: 1.6; color: var(--text-primary); text-align: center; margin-bottom: 25px; font-weight: 600;';
        messageDiv.innerHTML = `<span style="font-size: 24px; margin-right: 8px;">👤</span>${playerName}님에게 어떤 행동을 하시겠습니까?`;

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

        function createBtn(text, bg, resolveValue) {
            const btn = document.createElement('button');
            btn.textContent = text;
            btn.style.cssText = `padding: 12px 25px; background: ${bg}; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;`;
            btn.onclick = () => { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve(resolveValue); };
            return btn;
        }

        const hostButton = createBtn('호스트임명', 'var(--brand-gradient)', 'host');
        const kickButton = createBtn('제외시키기', 'linear-gradient(135deg, var(--red-300) 0%, var(--red-400) 100%)', 'kick');
        const cancelButton = document.createElement('button');
        cancelButton.textContent = '취소';
        cancelButton.style.cssText = 'padding: 12px 25px; background: var(--gray-100); color: var(--text-secondary); border: 1px solid var(--gray-300); border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;';
        cancelButton.onclick = () => { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve('cancel'); };

        const handleEsc = (e) => {
            if (e.key === 'Escape') { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve('cancel'); }
        };
        document.addEventListener('keydown', handleEsc);

        dialogOverlay.onclick = (e) => {
            if (e.target === dialogOverlay) { dialogOverlay.remove(); document.removeEventListener('keydown', handleEsc); resolve('cancel'); }
        };

        buttonContainer.appendChild(hostButton);
        buttonContainer.appendChild(kickButton);
        buttonContainer.appendChild(cancelButton);
        dialogContent.appendChild(messageDiv);
        dialogContent.appendChild(buttonContainer);
        dialogOverlay.appendChild(dialogContent);
        document.body.appendChild(dialogOverlay);
        hostButton.focus();
    });
}

// 게임 종료
function endHorseRaceGame() {
    socket.emit('endHorseRace', {});
}

// 이전 게임 데이터 삭제
function clearHorseRaceData() {
    showConfirmDialog('이전 게임 데이터를 삭제하시겠습니까?\n(기록, 주문 내역 등이 초기화됩니다)', () => {
        socket.emit('clearHorseRaceData');
    });
}

// 데이터 삭제 완료 수신
socket.on('horseRaceDataCleared', () => {
    raceLabelsFresh = false; // 카운트다운~시작 창에서 데이터 초기화 시 fresh 고착 방지
    horseRaceHistory = [];
    ordersData = {};
    isOrderActive = false;
    userRankVotes = {};
    window._targetRank = null;
    window._targetRankReason = null;
    updateTargetRankBanner(null, false);
    OrderModule.setOrdersData(ordersData);
    OrderModule.setIsOrderActive(false);
    renderHistory();
    OrderModule.renderOrders();

    // 다시보기 섹션 숨기기
    const replaySection = document.getElementById('replaySection');
    if (replaySection) replaySection.style.display = 'none';
    const missedReplaySection = document.getElementById('missedReplaySection');
    if (missedReplaySection) missedReplaySection.style.display = 'none';

    // 결과 오버레이 숨기기
    const resultOverlay = document.getElementById('resultOverlay');
    if (resultOverlay) resultOverlay.classList.remove('visible');

    // 룰렛 오버레이 숨기기 + 진행 중 timeout 정리
    const rouletteOverlay = document.getElementById('rouletteOverlay');
    if (rouletteOverlay) {
        rouletteOverlay.classList.remove('visible');
        rouletteOverlay.style.display = 'none';
    }
    clearRouletteTick();

    // 트랙 숨기기 + 이펙트 정리.
    // 래퍼를 그대로 숨기면 특수 표시 모드(작은 창/전체화면)에서는 화면이 통째로 비고, 래퍼 안에 있는
    // [↩ 원래 화면으로]·[⛶ 전체화면 종료] 버튼까지 함께 사라져 되돌릴 방법이 없어진다.
    // → 먼저 본 화면으로 되돌린 뒤 숨긴다. 둘 다 멱등(비활성이면 즉시 return).
    if (racePipAttached()) racePipReattach();
    if (typeof raceFsExit === 'function') raceFsExit();
    const trackContainer = document.getElementById('trackContainer');
    if (trackContainer) trackContainer.style.display = 'none';
    const trackWrapper = document.getElementById('raceTrackWrapper'); // 위 복귀로 메인 확정
    if (trackWrapper) trackWrapper.style.display = 'none';
    clearFinishEffects();

    showCustomAlert('이전 게임 데이터가 삭제되었습니다.', 'success', '✅ 삭제 완료');
});

// 게임 모드 업데이트 수신 (무조건 꼴등 찾기)
socket.on('horseRaceModeUpdated', (mode) => {
    horseRaceMode = mode || 'last';
});

// 탈것 타입 업데이트 수신
socket.on('vehicleTypesUpdated', (data) => {
    selectedVehicleTypes = data.vehicleTypes;
    availableHorses = data.availableHorses;
    userHorseBets = {}; // 탈것 변경 시 선택 초기화
    mySelectedHorse = null;
    renderHorseSelection();
    // 탈것 목록 변경 — 자동선택 재시도 허용
    autoSelectAttempted = false;
    tryAutoSelectHorse();
});

// ═══ 예약 시작 — 방장이 건 시간에 서버가 [게임 시작]을 대신 눌러준다 ═══
// 예약은 시작 버튼을 대신 누를 뿐이다. 준비(readyUsers)나 시작 이후 참여에는 관여하지 않는다.
// 남은 시간은 서버가 준 절대 시각에서 현재 시각을 빼서 그린다 — 서버에 폴링하지 않는다.
// 프리셋은 시/분 입력을 채우는 도우미일 뿐이라 서버 상수와 맞출 필요가 없다.
var SCHEDULE_PRESET_MINUTES = [3, 5, 10, 30];
var SCHEDULE_NOTICE_MS = 5000;   // 안내 문구를 배지에 띄워두는 시간
var SCHEDULE_TICK_MS = 1000;     // 남은 시간 갱신 주기

var scheduledStartAt = null;      // 발화 시각(epoch ms) 또는 null
var scheduledStartLabel = null;   // 서버가 만든 벽시계 표기("15:30") 또는 null — 클라가 계산하지 않는다
var scheduleTickInterval = null;  // 남은 시간 갱신 타이머
var scheduleNoticeTimer = null;   // 안내 문구 소멸 타이머 (걸려 있으면 안내 표시 중)

// 배지는 래퍼 안에 있어 PiP attach 시 PiP 문서로 함께 이동한다 — 매번 현재 문서에서 다시 찾는다
function scheduleBadgeEl() {
    return raceDoc().getElementById('scheduledStartBadge');
}

// 프리셋 버튼 — 팝업 안에 만든다(방장만 팝업을 열 수 있다). 멱등.
// 누르면 "지금 + N분"을 시/분 입력에 채워줄 뿐이고, 예약은 [예약] 버튼을 눌러야 걸린다.
function renderSchedulePresets() {
    var box = document.getElementById('scheduleModalPresets');
    if (!box || box.childElementCount > 0) return;
    SCHEDULE_PRESET_MINUTES.forEach(function (minutes) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'schedule-preset-btn';
        btn.textContent = '+' + minutes + '분';
        btn.dataset.scheduleMinutes = String(minutes);
        btn.onclick = function () {
            setScheduleTimeInputs(scheduleTargetAfter(minutes));
        };
        box.appendChild(btn);
    });
}

// 팝업을 열 때 채워두는 기본 여유(분). 서버 최소 여유와 같아야 열자마자 [예약]을 눌러도 통과한다.
var SCHEDULE_PREFILL_OFFSET_MIN = 3;

// "지금 + N분"을 다음 분으로 올린다.
// 입력이 분 단위라 초가 절삭된다 — 23:49:44에 +3분을 그냥 쓰면 23:52(=2분16초)가 되어
// 서버 최소 여유(3분)에 걸린다. 올림하면 항상 N분 이상이 보장된다.
function scheduleTargetAfter(minutes) {
    var t = new Date(Date.now() + minutes * 60000);
    if (t.getSeconds() > 0 || t.getMilliseconds() > 0) {
        t.setSeconds(0, 0);
        t.setMinutes(t.getMinutes() + 1);
    }
    return t;
}

function schedulePad2(n) {
    return String(n).padStart(2, '0');
}

// 시(00~23)·분(00~59) 드롭다운 채우기 — 네이티브 시간 스피너보다 고르기 빠르다. 멱등.
// 분은 프리셋이 "22:53" 같은 임의 분을 채우므로 60개를 전부 넣는다.
function renderScheduleTimeOptions() {
    [['scheduleHourSelect', 24], ['scheduleMinuteSelect', 60]].forEach(function (pair) {
        var sel = document.getElementById(pair[0]);
        if (!sel || sel.childElementCount > 0) return;
        for (var i = 0; i < pair[1]; i++) {
            var opt = document.createElement('option');
            opt.value = schedulePad2(i);
            opt.textContent = schedulePad2(i);
            sel.appendChild(opt);
        }
    });
}

// 시/분 드롭다운에 넘긴 시각을 박는다 (팝업 열 때는 현재 시각, 프리셋은 지금 + N분).
function setScheduleTimeInputs(date) {
    var hourSel = document.getElementById('scheduleHourSelect');
    var minSel = document.getElementById('scheduleMinuteSelect');
    if (hourSel) hourSel.value = schedulePad2(date.getHours());
    if (minSel) minSel.value = schedulePad2(date.getMinutes());
}

// ── 예약 팝업 ──
function openScheduleModal() {
    renderScheduleTimeOptions();
    renderSchedulePresets();
    // 빈 칸으로 열지 않는다. 딱 현재 시각을 넣으면 그 분이 이미 지나는 중이라
    // 그대로 [예약]을 눌렀을 때 서버가 "이미 지났다"고 거절한다 — 1분 뒤로 채워 바로 눌러도 되게 한다.
    setScheduleTimeInputs(scheduleTargetAfter(SCHEDULE_PREFILL_OFFSET_MIN));
    updateSchedulePresetVisibility();
    updateScheduleModal();
    var modal = document.getElementById('scheduleModal');
    if (modal) modal.style.display = 'flex';
}

function closeScheduleModal() {
    var modal = document.getElementById('scheduleModal');
    if (modal) modal.style.display = 'none';
}

// 팝업 내용 — 예약 중이면 걸어둔 시각과 남은 시간을 보여주고 [예약 취소]를 띄운다.
function updateScheduleModal() {
    var current = document.getElementById('scheduleModalCurrent');
    var pickers = document.getElementById('scheduleModalPickers');
    var cancelBtn = document.getElementById('scheduleModalCancelButton');
    var timeEl = document.getElementById('scheduleModalTime');
    var remainEl = document.getElementById('scheduleModalRemain');
    var armed = !!scheduledStartAt;

    if (current) current.style.display = armed ? 'block' : 'none';
    if (pickers) pickers.style.display = armed ? 'none' : 'block';
    if (cancelBtn) cancelBtn.style.display = armed ? 'block' : 'none';
    if (armed && timeEl) timeEl.textContent = scheduledStartLabel || '예약됨';
    if (armed && remainEl) remainEl.textContent = formatScheduleRemain(scheduledStartAt - Date.now());
}

// 시각 입력 [예약] 버튼 (인라인 onclick — 이 페이지 관례). 실제 예약은 여기서만 일어난다.
// 값은 두 드롭다운을 이어 붙인 "HH:MM"이다. 지난 시각 판정은 서버 몫 —
// 여기서 Date로 목표 시각을 만들면 기기 시계 오차가 결과에 끼어든다.
function scheduleStartAtTime() {
    var hourSel = document.getElementById('scheduleHourSelect');
    var minSel = document.getElementById('scheduleMinuteSelect');
    var hour = hourSel ? hourSel.value : '';
    var minute = minSel ? minSel.value : '';
    if (!hour || !minute) {
        showCustomAlert('시간을 선택해주세요.', 'error');
        return;
    }
    socket.emit('scheduleStart', { at: hour + ':' + minute });
}

// 예약 중이면 버튼 글자에 걸어둔 시각을 박는다 — 팝업을 열지 않아도 언제인지 보이게.
// 1분 미만 남으면 초 카운트다운을 오른쪽에 덧붙인다.
function updateScheduleControls() {
    var openBtn = document.getElementById('scheduleOpenButton');
    if (openBtn) {
        var text = '⏰ 예약';
        if (scheduledStartAt) {
            text = '⏰ ' + (scheduledStartLabel || '예약됨');
            var remainMs = scheduledStartAt - Date.now();
            if (remainMs < SCHEDULE_TICK_MS * 60) {
                text += ' · 시작 ' + Math.max(0, Math.ceil(remainMs / 1000)) + '초 전';
            }
        }
        openBtn.textContent = text;
        openBtn.classList.toggle('is-armed', !!scheduledStartAt);
    }
    updateScheduleModal();
}

// "3분 12초 후 시작" — 시계 오차로 음수가 되어도 0으로 눌러 붙인다(서버가 곧 null을 보낸다)
function formatScheduleRemain(ms) {
    var totalSec = Math.max(0, Math.ceil(ms / 1000));
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    return min > 0 ? (min + '분 ' + sec + '초 후 시작') : (sec + '초 후 시작');
}

function renderScheduleBadge() {
    var el = scheduleBadgeEl();
    if (!el) return;
    if (scheduleNoticeTimer) return; // 안내 표시 중 — 같은 요소라 카운트다운이 덮어쓰면 안 된다
    if (!scheduledStartAt) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }
    // 시각 병기는 서버가 준 문자열이 있을 때만 — 없으면(재입장 등) 남은 시간만 보여준다
    el.textContent = '⏰ ' + formatScheduleRemain(scheduledStartAt - Date.now())
        + (scheduledStartLabel ? ' (' + scheduledStartLabel + ' 예정)' : '');
    el.style.display = 'block';
    updateScheduleControls(); // 버튼의 초 카운트다운과 팝업 남은 시간을 같이 흐르게
}

function stopScheduleTick() {
    if (scheduleTickInterval) {
        clearInterval(scheduleTickInterval);
        scheduleTickInterval = null;
    }
}

// 서버가 준 절대 시각 반영 — scheduledStartUpdated와 입장/재입장 gameState의 공통 진입점.
// label은 서버가 만든 벽시계 표기. 입장 페이로드에는 없어서 그때는 남은 시간만 그려진다.
function applyScheduledStart(at, label) {
    var wasArmed = !!scheduledStartAt;
    scheduledStartAt = (typeof at === 'number' && isFinite(at) && at > 0) ? at : null;
    scheduledStartLabel = (scheduledStartAt && typeof label === 'string' && label) ? label : null;
    stopScheduleTick();
    if (scheduledStartAt) {
        scheduleTickInterval = setInterval(renderScheduleBadge, SCHEDULE_TICK_MS);
    }
    renderScheduleBadge();
    updateScheduleControls();
    // 방금 예약이 잡혔으면 팝업은 할 일이 끝났다. 취소는 열어둔 채 다시 고를 수 있게 둔다.
    if (!wasArmed && scheduledStartAt) closeScheduleModal();
}

// 안내 문구를 카운트다운과 같은 요소에 잠깐 띄운다. 문구에 사용자 이름이 들어가므로 textContent만.
function showScheduleNotice(message) {
    var el = scheduleBadgeEl();
    if (!el) return;
    if (scheduleNoticeTimer) clearTimeout(scheduleNoticeTimer);
    el.textContent = message;
    el.style.display = 'block';
    scheduleNoticeTimer = setTimeout(function () {
        scheduleNoticeTimer = null;
        renderScheduleBadge(); // 예약이 남아 있으면 카운트다운으로 복귀, 없으면 숨김
    }, SCHEDULE_NOTICE_MS);
}

// 방 이탈/페이지 이탈 — 타이머 정리 (인터벌이 남으면 로비로 나간 뒤에도 계속 돈다)
function clearScheduledStart() {
    stopScheduleTick();
    if (scheduleNoticeTimer) {
        clearTimeout(scheduleNoticeTimer);
        scheduleNoticeTimer = null;
    }
    scheduledStartAt = null;
    scheduledStartLabel = null;
}

// [예약 취소] 버튼 (인라인 onclick — 이 페이지 관례)
function cancelScheduledStart() {
    socket.emit('cancelScheduledStart');
}

socket.on('scheduledStartUpdated', (data) => {
    applyScheduledStart(data && data.scheduledStartAt, data && data.scheduledStartLabel);
});

socket.on('scheduledStartNotice', (data) => {
    if (data && typeof data.message === 'string' && data.message) {
        showScheduleNotice(data.message);
    }
});

// 요청한 방장에게만 오는 거절 사유 — 이 페이지의 기존 에러 표시 방식을 그대로 쓴다
socket.on('scheduledStartError', (message) => {
    showCustomAlert((typeof message === 'string' && message) ? message : '예약에 실패했어요.', 'error');
});

window.addEventListener('pagehide', clearScheduledStart);

// 방 나가기
socket.on('roomLeft', () => {
    sessionStorage.removeItem('horseRaceActiveRoom');
    clearScheduledStart();
    if (roomExpiryInterval) {
        clearInterval(roomExpiryInterval);
    }
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    window.location.replace('/game');
});

socket.on('roomDeleted', (data) => {
    sessionStorage.removeItem('horseRaceActiveRoom');
    showCustomAlert(data.message || '방이 삭제되었습니다.', 'info');
    clearScheduledStart();
    if (roomExpiryInterval) {
        clearInterval(roomExpiryInterval);
    }
    sessionStorage.setItem('returnToLobby', JSON.stringify({ serverId: currentServerId, serverName: currentServerName }));
    window.location.replace('/game');
});

// 비공개 방 체크박스 이벤트
document.addEventListener('DOMContentLoaded', () => {
    const privateCheckbox = document.getElementById('createRoomPrivateCheckbox');
    const passwordContainer = document.getElementById('createRoomPasswordContainer');
    
    if (privateCheckbox && passwordContainer) {
        privateCheckbox.addEventListener('change', function() {
            passwordContainer.style.display = this.checked ? 'block' : 'none';
            if (!this.checked) {
                document.getElementById('createRoomPasswordInput').value = '';
            }
        });
    }
    

    // 탭 포커스 잃으면 소리 음소거, 복귀하면 다시 재생
    // (트랙 PiP 시청 중에는 우회 — 사용자가 경주를 보고 있으므로 사운드 유지. 복귀 시 reattach가 원복)
    document.addEventListener('visibilitychange', function() {
        if (racePipAttached()) return; // 트랙이 PiP에 붙어 있는 동안 우회 (창 없으면 일반 정책)
        if (window.SoundManager) {
            if (document.hidden) {
                SoundManager.muteAll();
            } else {
                SoundManager.unmuteAll();
            }
        }
    });
    window.addEventListener('blur', function() {
        if (racePipAttached()) return; // 트랙이 PiP에 붙어 있는 동안 음소거 우회 (창 없으면 일반 정책)
        if (window.SoundManager) SoundManager.muteAll();
    });
    window.addEventListener('focus', function() {
        if (window.SoundManager && document.visibilityState === 'visible') {
            SoundManager.unmuteAll();
        }
    });

    // 저장된 이름 불러오기
    const savedName = localStorage.getItem('horseRaceUserName');
    if (savedName) {
        document.getElementById('globalUserNameInput').value = savedName;
    }
    
    // URL 파라미터로 방 생성/입장 요청이 왔는지 확인
    const urlParams = new URLSearchParams(window.location.search);
    
    // 방 생성 요청 — pending 소비/쿼리 스트립은 roomCreated 성공 시점으로 이월 (실패 시 [다시 시도] 가능)
    if (urlParams.get('createRoom') === 'true') {
        const pendingRoom = localStorage.getItem('pendingHorseRaceRoom');
        let roomData = null;
        try {
            roomData = pendingRoom ? JSON.parse(pendingRoom) : null;
        } catch (e) {}
        if (roomData) {
            entryRetryData = { kind: 'create', data: roomData };
            fireUserEntry();
        } else {
            // 수동 URL 진입/이미 소비/손상 — 무한 스피너 대신 즉시 실패 안내
            showEntryFailureUI('진입 정보가 없어요. 로비에서 다시 들어와주세요.');
        }
    }

    // 방 입장 요청 — pending 소비/쿼리 스트립은 roomJoined 성공 시점으로 이월
    if (urlParams.get('joinRoom') === 'true') {
        const pendingJoin = localStorage.getItem('pendingHorseRaceJoin');
        let joinData = null;
        try {
            joinData = pendingJoin ? JSON.parse(pendingJoin) : null;
        } catch (e) {}
        if (joinData) {
            sessionStorage.setItem('horseRaceFromDice', 'true');

            document.getElementById('globalUserNameInput').value = joinData.userName;

            entryRetryData = { kind: 'join', data: joinData };
            fireUserEntry();
        } else {
            showEntryFailureUI('진입 정보가 없어요. 로비에서 다시 들어와주세요.');
        }
    }
});

// === Debug Log Functions ===
// localhost가 아니면 디버그 로그 섹션 숨기기
if (!isLocalhost) {
    const debugLogSection = document.getElementById('debugLogSection');
    if (debugLogSection) {
        debugLogSection.style.display = 'none';
    }
}

function clearDebugLog() {
    const logContent = document.getElementById('debugLogContent');
    if (logContent) {
        logContent.innerHTML = '';
    }
}

function toggleDebugLog() {
    const logSection = document.getElementById('debugLogSection');
    if (logSection) {
        logSection.style.display = logSection.style.display === 'none' ? 'block' : 'none';
    }
}

// ========== 채팅 오버레이 (레이스 중 트랙 위 텍스트 표시) ==========
(function() {
    let observer = null;
    const MAX_OVERLAY_MSGS = 6;

    function getCurrentUser() {
        return currentUser || '';
    }

    function parseMessage(node) {
        if (!node || node.nodeType !== 1) return null;

        // 시스템 메시지: .winner 클래스 또는 gradient 배경
        const isWinner = node.classList && node.classList.contains('winner');
        const style = node.getAttribute('style') || '';
        const isSystem = isWinner || style.includes('gradient');

        if (isSystem) {
            // 시스템 메시지: 텍스트 추출 (HTML 태그 제거)
            const text = node.textContent.trim();
            if (!text) return null;
            return { type: 'system', text: text };
        }

        // 일반 메시지: 첫번째 span = 이름, 두번째 span = 메시지
        const spans = node.querySelectorAll('span');
        if (spans.length < 2) return null;

        // 이름 추출: "👑 🖥️ 이름 (나)" → "이름"만
        const rawName = spans[0].textContent.trim();
        // 아이콘 제거, (나) 제거, 이름만 추출
        const name = rawName
            .replace(/👑\s*/g, '')
            .replace(/[🖥️📱💻🎮]\s*/g, '')
            .replace(/\s*\(나\)\s*/g, '')
            .trim();

        // 내 메시지인지 판별
        const isMe = rawName.includes('(나)') || name === getCurrentUser();

        // 메시지 텍스트
        const msg = spans[1].textContent.trim();

        // 이모지 반응 (있으면 추출)
        let reactions = '';
        const reactionSpans = node.querySelectorAll('.emoji-count-btn');
        if (reactionSpans.length > 0) {
            const parts = [];
            reactionSpans.forEach(function(btn) {
                const emoji = btn.querySelector('.emoji-icon');
                if (emoji) parts.push(emoji.textContent.trim());
            });
            if (parts.length > 0) reactions = ' ' + parts.join('');
        }

        return { type: 'user', name: name, msg: msg, isMe: isMe, reactions: reactions };
    }

    function addToOverlay(overlay, info) {
        const div = document.createElement('div');
        div.className = 'race-chat-msg';

        if (info.type === 'system') {
            div.classList.add('system');
            div.textContent = '[SYSTEM] ' + info.text;
        } else {
            if (info.isMe) div.classList.add('me');
            div.textContent = info.name + ' : ' + info.msg + info.reactions;
        }

        overlay.appendChild(div);
        while (overlay.children.length > MAX_OVERLAY_MSGS) {
            overlay.removeChild(overlay.firstChild);
        }
        overlay.scrollTop = overlay.scrollHeight;
    }

    window.showRaceChatOverlay = function() {
        const overlay = raceDoc().getElementById('raceChatOverlay'); // 개정2: attach 상태 init 대응 (래퍼 내부 요소)
        const chatMessages = document.getElementById('chatMessages'); // 채팅 원본은 항상 메인 문서
        if (!overlay || !chatMessages) return;

        // 기존 observer 정리 (중복 등록 방지)
        if (observer) {
            observer.disconnect();
            observer = null;
        }

        overlay.innerHTML = '';
        overlay.style.display = 'block';

        // 채팅 섹션: 메시지 목록 숨기고 입력바만 표시
        const chatSection = document.querySelector('.chat-section');
        if (chatSection) chatSection.classList.add('race-active');

        // 기존 메시지 복제 (최근 N개만)
        const existing = chatMessages.children;
        const start = Math.max(0, existing.length - MAX_OVERLAY_MSGS);
        for (let i = start; i < existing.length; i++) {
            const info = parseMessage(existing[i]);
            if (info) addToOverlay(overlay, info);
        }

        // 새 메시지 감시
        observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(m) {
                m.addedNodes.forEach(function(node) {
                    const info = parseMessage(node);
                    if (info) addToOverlay(overlay, info);
                });
            });
        });
        observer.observe(chatMessages, { childList: true });
    };

    window.hideRaceChatOverlay = function() {
        const overlay = raceDoc().getElementById('raceChatOverlay'); // 래퍼가 PiP에 있어도 정리되도록
        if (overlay) {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
        }
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        // 채팅 섹션 복원
        const chatSection = document.querySelector('.chat-section');
        if (chatSection) chatSection.classList.remove('race-active');
    };
})();
