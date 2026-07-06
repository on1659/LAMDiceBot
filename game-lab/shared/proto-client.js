// -----------------------------------------------------------------------------
// ProtoClient — game-lab의 10개 게임 페이지가 공통으로 쓰는 /proto 연결 헬퍼.
// 순수 vanilla JS, 빌드 스텝 없음 (이 프로젝트의 no-build-step 관례를 따름).
//
// 사용 페이지는 아래 두 스크립트를 이 순서로 로드해야 한다:
//   <script src="/socket.io/socket.io.js"></script>
//   <script src="/game-lab/shared/proto-client.js"></script>
//
// 기본 렌더링 대상 (있으면 자동 갱신, 없으면 무시):
//   #protoRoomCode  - 현재 방 코드 텍스트
//   #protoPlayerList - <ul>/<ol> 등, 플레이어 목록을 <li>로 채움 (호스트는 👑, 본인은 "(나)")
//
// 게임별 화면은 ProtoClient.init()의 onRoomState 콜백으로 자신만의 UI를 추가로 그리면 된다.
// -----------------------------------------------------------------------------

var ProtoClient = (function () {
    var socket = null;
    var roomCode = null;
    var userName = null;
    var gameSlug = null;
    var isHost = false;

    var onRoomStateCb = null;
    var onErrorCb = null;
    var onDisconnectCb = null;

    function renderRoomState(room) {
        var codeEl = document.getElementById('protoRoomCode');
        if (codeEl) codeEl.textContent = room.roomCode;

        var listEl = document.getElementById('protoPlayerList');
        if (!listEl) return;
        listEl.innerHTML = '';
        room.players.forEach(function (p) {
            var li = document.createElement('li');
            li.className = 'proto-player' + (p.name === userName ? ' me' : '') + (p.isHost ? ' host' : '');
            var label = p.name;
            if (p.isHost) label += ' 👑'; // 👑
            if (p.name === userName) label += ' (나)'; // (나)
            li.textContent = label;
            listEl.appendChild(li);
        });
    }

    function init(options) {
        options = options || {};
        onRoomStateCb = options.onRoomState || null;
        onErrorCb = options.onError || null;
        onDisconnectCb = options.onDisconnect || null;

        socket = io('/proto');

        socket.on('proto:roomState', function (room) {
            roomCode = room.roomCode;
            gameSlug = room.gameSlug;
            var me = room.players.filter(function (p) { return p.name === userName; })[0];
            isHost = !!(me && me.isHost);

            renderRoomState(room);
            if (onRoomStateCb) onRoomStateCb(room);
        });

        socket.on('proto:rateLimitError', function (message) {
            if (onErrorCb) onErrorCb(message);
        });

        socket.on('disconnect', function () {
            if (onDisconnectCb) onDisconnectCb();
        });

        return socket;
    }

    function createRoom(slug, name, callback) {
        gameSlug = slug;
        userName = name;
        socket.emit('proto:createRoom', { gameSlug: slug, userName: name }, function (res) {
            if (res && res.success) roomCode = res.roomCode;
            if (callback) callback(res);
        });
    }

    function joinRoom(code, name, callback) {
        userName = name;
        socket.emit('proto:joinRoom', { roomCode: code, userName: name }, function (res) {
            if (res && res.success) {
                roomCode = res.roomCode;
                gameSlug = res.room ? res.room.gameSlug : gameSlug;
            }
            if (callback) callback(res);
        });
    }

    function leaveRoom() {
        if (socket) socket.emit('proto:leaveRoom');
        roomCode = null;
        isHost = false;
    }

    function getSocket() { return socket; }
    function getRoomCode() { return roomCode; }
    function getUserName() { return userName; }
    function getGameSlug() { return gameSlug; }
    function getIsHost() { return isHost; }

    return {
        init: init,
        createRoom: createRoom,
        joinRoom: joinRoom,
        leaveRoom: leaveRoom,
        getSocket: getSocket,
        getRoomCode: getRoomCode,
        getUserName: getUserName,
        getGameSlug: getGameSlug,
        getIsHost: getIsHost
    };
})();
