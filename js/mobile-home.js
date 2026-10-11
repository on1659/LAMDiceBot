/*
 * mobile-home.js — 실제 모바일 모임 로비 (docs/goal/mobile-live-ui.md)
 * 소켓·API 연결, 세 상태(처음·단골·로그인), 방 만들기·합류 인계. 화면은 mobile.html 안에서 전환한다.
 *
 * 베낀 곳 (서버 쪽 이벤트는 새로 만들지 않았다):
 *   - 인증 복원·토큰 갱신: js/shared/server-select-shared.js _authRestore/_validateToken (약 370~400행)
 *   - 로그인·회원가입 응답 처리: 같은 파일 _authModal doApiCall (약 1030~1070행), _takeReturnLink (1113~1122행)
 *   - 방 만들기 인계: dice-game-multiplayer.html 4405~4436행 / 합류 인계: 4570~4594행
 *   - 주사위 자유 합류(diceSession + diceActiveRoom): js/free.js joinExistingRoom (425~480행)
 *   - 서버 선택 저장(diceSession·lamdice_lastServer): dice 로비 2480~2487·2636~2641행, server-select-shared.js 310~320행
 *   - 이름 규칙: 자유 방 = localStorage.freeUserName, 서버 방 = userAuth.name (js/free.js 1013~1030행 주석)
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  // ─── 상수 ───
  var EXPIRY_HOURS = 3;            // dice 로비 4379행 기본값
  var BLOCK_IP_PER_USER = false;   // dice 로비 4383행 기본값(체크 안 함)
  var TOAST_MS = 2200;
  var SERVER_WAIT_MS = 8000;       // joinServer 응답 대기(server-select-shared.js SS_JOIN_TIMEOUT 과 같은 역할)
  var SUGGEST = ['토끼', '거북이', '고슴도치', '판다', '로켓'];
  var FREE_LABEL = '자유 방';
  var ROOM_WAIT_MS = 12000, HASH_SHIFT = 5, UPDATE_LINES = 70;
  var diceHandoff = null, diceTimer = null, privateTarget = null, authenticated = false;
  var scopeChosen = !!ls('mobileLastScope');
  var panelVersion = 0;
  var SKINS = [['light','라이트'],['dark','다크'],['black','블랙'],['midnight','미드나잇'],['mocha','모카'],['purple','퍼플']];

  // gameType(서버 표기) 기준. 사다리(준비 중)·미사용 게임은 넣지 않는다 → 목록에서도 숨겨진다.
  var GAMES = {
    'horse-race': { name: '경마',   soft: 'var(--horse-soft)',    icon: 'ui-horse', nameKey: 'horseRaceUserName', createKey: 'pendingHorseRaceRoom', joinKey: 'pendingHorseRaceJoin', path: '/horse-race' },
    'dice':       { name: '주사위', soft: 'var(--dice-soft)',     icon: 'ui-dice' },
    'roulette':   { name: '룰렛',   soft: 'var(--roulette-soft)', icon: 'ui-slot',  nameKey: 'rouletteUserName',  createKey: 'pendingRouletteRoom',  joinKey: 'pendingRouletteJoin',  path: '/roulette-game-multiplayer.html' },
    'deguri':     { name: '데구리', soft: 'var(--deguri-soft)',   icon: 'ui-paw',   nameKey: 'deguriUserName',    createKey: 'pendingDeguriRoom',    joinKey: 'pendingDeguriJoin',    path: '/deguri' }
  };

  // ─── 저장소 유틸 ───
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function readJson(k) { try { return JSON.parse(ls(k) || 'null'); } catch (e) { return null; } }

  // ─── 상태 ───
  var socket = io();
  var auth = readJson('userAuth');            // { name, token, ... } | null  — 서버 방 정체성
  var freeName = ls('freeUserName') || '';    // 자유 방 별명
  var server = null;                          // { serverId, serverName, hostName } | null
  var rooms = [];                             // 이 소속의 열린 방(걸러진 것)
  var servers = [];                           // serversList 캐시
  var pending = null;                         // 이름 시트 뒤 이어갈 일 { game, target }
  var register = false;                       // 계정 시트: 회원가입 모드
  var joining = null;                         // joinServer 대기 { serverId, timer }
  var autoServerId = null;                    // 지난번 서버 자동 선택 중(serverError 오면 자유 방으로)


  function isLoggedIn() { return !!(auth && auth.name); }
  function currentName() { return server ? ((auth && auth.name) || '') : freeName; }
  function pick(list) { return list[Date.now() % list.length]; }

  // ─── 화면 공통 ───
  function show() { $('#s-home').hidden = false; $('#s-rooms').hidden = true; $('#scroller').scrollTop = 0; }
  function toast(msg) {
    var o = $('.toast'); if (o) o.remove();
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-atomic', 'true'); t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, TOAST_MS);
  }
  function closeSheets() { $$('.sheet').forEach(function (s) { s.hidden = true; }); }
  $$('.sheet').forEach(function (s) { s.addEventListener('click', function (e) { if (e.target === s) closeSheets(); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheets(); });
  $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.go); }); });

  function syncTop() {
    $('#acct').textContent = isLoggedIn() ? auth.name : (freeName || '로그인');
    $('#where').hidden = false;
    $('#serverTitle').textContent = server ? server.serverName : FREE_LABEL;
    $('#whereName').textContent = server ? server.serverName : FREE_LABEL;
    $('#roomCount').textContent = String(rooms.length);
  }

  // ─── 서버 선택 저장 — 게임 페이지들이 읽는 두 키를 반드시 함께 쓴다 ───
  function selectServer(sel) {
    server = sel || null;
    lsSet('mobileLastScope', server ? String(server.serverId) : 'free');
    if (!server) lsDel('lamdice_lastServer');
    if (typeof RankingModule !== 'undefined') { RankingModule.invalidateCache(); RankingModule.init(server ? server.serverId : null, currentName()); RankingModule.setHost(!!(server && auth && server.hostName === auth.name)); }
    ssSet('diceSession', JSON.stringify(server
      ? { serverId: server.serverId, serverName: server.serverName, hostName: server.hostName }
      : { serverId: null, serverName: null, hostName: null }));
    if (server) lsSet('lamdice_lastServer', JSON.stringify({ serverId: server.serverId, serverName: server.serverName, hostName: server.hostName }));
    rooms = [];
    syncTop();
    requestRooms();
  }

  // 서버 모드면 소속을 먼저 알리고 조회. setServerId 는 비동기라 서버가 확정 뒤 roomsList 를 다시 밀어준다 —
  // 어느 쪽이 먼저 와도 onRooms 가 serverId 로 한 번 더 거른다.
  function requestRooms() {
    socket.emit('setServerId', { serverId: server ? server.serverId : null, userName: server && auth ? auth.name : null });
    socket.emit('getRooms');
  }
  function onRooms(list) {
    var sid = server ? Number(server.serverId) : null;
    rooms = (list || []).filter(function (r) {
      return GAMES[r.gameType] && (r.serverId ? Number(r.serverId) : null) === sid;
    });
    syncTop();
    renderRooms();
  }
  socket.on('roomsList', onRooms);
  socket.on('roomsListUpdated', onRooms);

  // ─── 그림 = 방 만들기. 이름이 있으면 바로, 없으면 이름 한 번 묻고 같은 곳으로 이어간다 ───
  function go(game, target) {
    if (!socket.connected || joining || (server && !authenticated)) { toast('연결을 확인한 뒤 다시 눌러 주세요'); return; }
    closeSheets();
    var name = currentName();
    if (!name) {
      pending = { game: game, target: target };
      $('#nameInput').value = pick(SUGGEST) + (10 + Date.now() % 90);
      $('#nameSheet').hidden = false;
      setTimeout(function () { $('#nameInput').select(); }, 50);
      return;
    }
    handoff(game, target, name);
  }

  function handoff(game, target, name) {
    var g = GAMES[game];
    if (!g) return;
    var serverId = server ? server.serverId : null;
    var serverName = server ? server.serverName : null;

    if (game === 'dice') {
      if (diceHandoff) return;
      if (target.kind === 'join' && target.room.isPrivate && !target.password) {
        privateTarget = { game: game, target: target, name: name };
        $('#roomPasswordInput').value = ''; $('#passwordError').textContent = '';
        $('#passwordSheet').hidden = false; $('#roomPasswordInput').focus(); return;
      }
      diceHandoff = { name: name, target: target, serverId: serverId, serverName: serverName };
      diceTimer = setTimeout(function () { diceHandoff = null; toast('방 응답이 늦어요. 목록을 새로고침해 주세요'); }, ROOM_WAIT_MS);
      if (!sessionStorage.getItem('tabId')) ssSet('tabId', crypto.randomUUID());
      if (target.kind === 'create') {
        socket.emit('createRoom', { userName: name, roomName: name + '님의 주사위', gameType: 'dice', isPrivate: false, password: '', expiryHours: EXPIRY_HOURS, blockIPPerUser: BLOCK_IP_PER_USER, serverId: serverId, serverName: serverName, deviceId: deviceId(), tabId: sessionStorage.getItem('tabId') });
      } else {
        socket.emit('joinRoom', { roomId: target.room.roomId, userName: name, isHost: false, password: target.password || '', deviceId: deviceId(), tabId: sessionStorage.getItem('tabId') });
      }
      return;
    }

    lsSet(g.nameKey, name);
    if (target.kind === 'join') {
      lsSet(g.joinKey, JSON.stringify({ roomId: target.room.roomId, userName: name, isPrivate: !!target.room.isPrivate, serverId: serverId, serverName: serverName }));
      ssSet('mobileLobbyReturn', '/mobile');
      window.location.href = g.path + '?joinRoom=true&from=mobile';
      return;
    }
    lsSet(g.createKey, JSON.stringify({
      userName: name, roomName: name + '님의 ' + g.name, isPrivate: false, password: '',
      expiryHours: EXPIRY_HOURS, blockIPPerUser: BLOCK_IP_PER_USER,
      serverId: serverId, serverName: serverName
    }));
    ssSet('mobileLobbyReturn', '/mobile');
    window.location.href = g.path + '?createRoom=true&from=mobile';
  }

  $$('.tile').forEach(function (t) { t.addEventListener('click', function () { go(t.dataset.game, { kind: 'create' }); }); });

  $('#nameForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#nameInput').value.trim();
    if (!name) { $('#nameInput').focus(); return; }
    freeName = name; lsSet('freeUserName', name);
    closeSheets(); syncTop();
    if (pending) { var p = pending; pending = null; handoff(p.game, p.target, currentName()); }
  });

  // ─── 열린 방 ───
  function renderRooms() {
    var ul = $('#roomList'); ul.textContent = '';
    $('#roomEmpty').hidden = rooms.length > 0;
    $('#roomEmpty').textContent = socket.connected ? '아직 열린 방이 없어요. 첫 방을 만들어 보세요.' : '서버에 연결하고 있어요.';
    $('#featuredJoin').hidden = !rooms.length;
    $('#featuredTitle').textContent = rooms.length ? rooms[0].roomName : '친구들과\n가볍게 한 판.';
    $('#featuredLabel').textContent = rooms.length ? GAMES[rooms[0].gameType].name + ' · ' + rooms[0].playerCount + '명' : '오늘의 한 판';
    rooms.forEach(function (r) {
      var g = GAMES[r.gameType], li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'item'; b.dataset.roomId = r.roomId; b.dataset.game = r.gameType;
      var sq = document.createElement('span'); sq.className = 'sq'; var ic = document.createElement('i'); ic.className = 'ui ' + g.icon; sq.appendChild(ic);
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.roomName; var detail = document.createElement('small'); detail.textContent = g.name; nm.appendChild(detail);
      var live = !!(r.isGameActive || r.isOrderActive);
      var rt = document.createElement('span'); rt.className = 'r' + (live ? ' live' : ''); rt.textContent = r.playerCount + '명' + (live ? ' 진행' : '') + (r.isPrivate ? ' 비공개' : '');
      b.appendChild(sq); b.appendChild(nm); b.appendChild(rt);
      b.addEventListener('click', function () { go(r.gameType, { kind: 'join', room: r }); });
      li.appendChild(b); ul.appendChild(li);
    });
  }
  $('#toRooms').addEventListener('click', function () { renderRooms(); show('rooms'); socket.emit('getRooms'); });

  // ─── 계정: 처음·단골은 로그인 시트, 로그인 상태는 로그아웃 ───
  $('#acct').addEventListener('click', function () {
    if (isLoggedIn()) { var body = openPanel('내 계정'); body.appendChild(textNode('p', auth.name)); body.appendChild(panelButton('로그아웃', function () { $('#dialog').close(); logout(); })); return; }
    setRegister(false);
    $('#acctName').value = freeName || ''; $('#acctPin').value = ''; $('#acctErr').hidden = true;
    $('#acctSheet').hidden = false;
    setTimeout(function () { ($('#acctName').value ? $('#acctPin') : $('#acctName')).focus(); }, 50);
  });
  function setRegister(on) {
    register = on; $('#pinConfirmLabel').hidden = !on; $('#acctPinConfirm').required = on;
    $('#acctTitle').textContent = on ? '회원가입' : '로그인';
    $('#acctGo').textContent = on ? '가입' : '로그인';
    $('#acctAlt').textContent = on ? '이미 있으면 로그인' : '처음이면 회원가입';
    $('#acctPin').placeholder = on ? '숫자 암호 4~6자리 (잊으면 못 찾아요)' : '숫자 암호 4~6자리';
  }
  $('#acctAlt').addEventListener('click', function () { setRegister(!register); $('#acctErr').hidden = true; });

  // 로그아웃 — userAuth 만 지운다(이름 키는 유지). 서버 소속은 자유 방으로.
  function logout() {
    lsDel('userAuth'); auth = null; authenticated = false;
    socket.disconnect(); socket.connect();
    selectServer(null);
    toast('로그아웃');
  }

  // 서버 방 링크 복귀 — js/free.js 가 미로그인 진입 시 sessionStorage.lamdice_returnAfterLogin 에 경로를 저장한다.
  // 같은 오리진 경로만 인정(`/`로 시작, `//` 제외). 읽는 즉시 지운다 (1회용).
  function takeReturnLink() {
    var link = null;
    try { link = sessionStorage.getItem('lamdice_returnAfterLogin'); sessionStorage.removeItem('lamdice_returnAfterLogin'); } catch (e) {}
    if (!link || link.charAt(0) !== '/' || link.charAt(1) === '/') return null;
    return link;
  }

  $('#acctForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#acctName').value.trim(), pin = $('#acctPin').value.trim();
    var err = $('#acctErr');
    if (!name) { $('#acctName').focus(); return; }
    if (!/^\d{4,6}$/.test(pin)) { err.textContent = '암호코드는 숫자 4~6자리'; err.hidden = false; $('#acctPin').focus(); return; }
    if (register && $('#acctPinConfirm').value !== pin) { err.textContent = '암호코드가 일치하지 않아요'; err.hidden = false; return; }
    var go = $('#acctGo'); go.disabled = true;
    fetch(register ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, pin: pin })
    }).then(function (res) { return res.json().then(function (j) { return { ok: res.ok, body: j }; }); })
      .then(function (r) {
        go.disabled = false;
        if (!r.ok) { err.textContent = r.body.error || '다시 시도해 주세요'; err.hidden = false; return; }
        var result = r.body;
        if (result.adminToken) { ssSet('adminToken', result.adminToken); window.location.href = '/admin'; return; }
        // result.token: socket 인증용 (지갑/상점). 로그인 응답에만 존재.
        var authData = Object.assign({}, result.user);
        if (result.token) authData.token = result.token;
        lsSet('userAuth', JSON.stringify(authData)); auth = authData;
        closeSheets();
        // 서버 방 링크에서 미로그인으로 넘어온 경우 — 로그인/가입 성공 즉시 그 링크로 복귀
        var returnLink = takeReturnLink();
        if (returnLink) { window.location.href = returnLink; return; }
        toast(register ? '가입 완료' : '로그인 완료');
        validateToken(auth.token, true, function () { restoreLastServer(); openServers(); });
      })
      .catch(function () { go.disabled = false; err.textContent = '서버에 연결하지 못했어요'; err.hidden = false; });
  });

  // 지난번 서버가 있으면 자동 선택. 멤버십이 끊겼으면 serverError 가 와서 자유 방으로 되돌린다.
  function restoreLastServer() {
    var last = readJson('lamdice_lastServer');
    try { var session = JSON.parse(sessionStorage.getItem('diceSession') || 'null'); if (session && session.serverId && isLoggedIn()) { last = session; lsSet('mobileLastScope', String(session.serverId)); } } catch (e) {}
    if (ls('mobileLastScope') !== 'free' && isLoggedIn() && last && last.serverId) {
      autoServerId = Number(last.serverId);
      joinServer(last.serverId, last.serverName);
    } else {
      selectServer(null);
    }
  }

  // 토큰 만료 감지 — auth 거부면 AuthToken.renew 로 1회 연장, 그래도 안 되면 로그아웃 처리.
  // 인증 응답을 확인한 뒤에만 서버 방을 조회하고 만들 수 있다.
  function expireLogin() {
    lsDel('userAuth'); auth = null; authenticated = false;
    socket.disconnect(); socket.connect();
    selectServer(null);
    toast('로그인이 만료됐어요. 다시 로그인해 주세요');
  }
  function validateToken(token, allowRenew, done) {
    authenticated = false;
    socket.timeout(SERVER_WAIT_MS).emit('socket:authenticate', { token: token }, function (err, res) {
      if (err) { toast('로그인 확인에 실패했어요. 다시 연결해 주세요'); selectServer(null); return; }
      if (res && res.ok) { authenticated = true; if (done) done(); return; }
      if (allowRenew && window.AuthToken) {
        window.AuthToken.renew(function (newToken) {
          if (newToken) { auth = readJson('userAuth'); validateToken(newToken, false, done); }
          else { expireLogin(); }
        });
      } else expireLogin();
    });
  }

  // ─── 서버(팀) 시트 ───
  var LABEL_PENDING = '승인 대기', LABEL_OPEN = '참여 가능', LABEL_CODE = '참여코드', LABEL_NOW = '지금';
  var openCode = null, openNew = false;   // 펼쳐진 참여코드 줄 / 새 서버 폼

  function row(cls, sqText, name, right, rightCls, onClick) {
    var li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.className = 'item' + (cls ? ' ' + cls : '');
    var sq = document.createElement('span'); sq.className = 'sq'; sq.textContent = sqText;
    var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = name;
    var rt = document.createElement('span'); rt.className = 'r' + (rightCls ? ' ' + rightCls : ''); rt.textContent = right;
    b.appendChild(sq); b.appendChild(nm); b.appendChild(rt); b.addEventListener('click', onClick); li.appendChild(b);
    return li;
  }
  function input(id, placeholder, opts) {
    var i = document.createElement('input'); i.className = 'txt'; i.id = id; i.placeholder = placeholder; i.autocomplete = 'off';
    Object.assign(i, opts || {});
    return i;
  }
  function smallBtn(label, onClick) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = label; b.addEventListener('click', onClick); return b; }

  function renderServers() {
    var ul = $('#srvList'); ul.textContent = '';
    var nowId = server ? Number(server.serverId) : null;
    if (!isLoggedIn()) {
      var loginRow = row('', '', '로그인하고 내 서버 선택', '›', '', function () { closeSheets(); $('#acct').click(); }); ul.appendChild(loginRow);
    }
    var search = $('#serverSearch').value.trim().toLowerCase();
    servers.filter(function (s) { return isLoggedIn() && (!search || s.name.toLowerCase().includes(search)); }).forEach(function (s) {
      var isNow = Number(s.id) === nowId;
      var right = isNow ? LABEL_NOW : s.is_member ? '' : s.is_pending ? LABEL_PENDING : s.is_private ? LABEL_CODE : LABEL_OPEN;
      var cls = isNow ? 'now' : '';
      var li = row(cls, s.name.charAt(0), s.name, right, s.is_pending ? 'live' : 'ok', function () {
        if (isNow) { closeSheets(); return; }
        if (s.is_pending) { toast('방장 승인을 기다리는 중'); return; }
        if (s.is_member) { joinServer(s.id, s.name); return; }
        if (s.is_private) { openCode = Number(s.id) === openCode ? null : Number(s.id); renderServers(); return; }
        joinServer(s.id, s.name);   // 참여 가능 → 가입 신청
      });
      if (openCode === Number(s.id)) {
        var sub = document.createElement('div'); sub.className = 'sub';
        var code = input('srvCode', '참여코드', { maxLength: 20 });
        sub.appendChild(code);
        sub.appendChild(smallBtn('신청', function () { var v = code.value.trim(); if (!v) { code.focus(); return; } joinServer(s.id, s.name, v); }));
        code.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var v = code.value.trim(); if (v) joinServer(s.id, s.name, v); } });
        li.appendChild(sub);
        setTimeout(function () { code.focus(); }, 30);
      }
      ul.appendChild(li);
    });
    var freeRow = row('dash' + (nowId === null ? ' now' : ''), '', FREE_LABEL, '로그인 없이', 'ok', function () { scopeChosen = true; selectServer(null); closeSheets(); }); freeRow.querySelector('button').dataset.server = 'free'; ul.appendChild(freeRow);
    if (!isLoggedIn()) return;
    var newLi = row('dash', '+', '새 서버', '', '', function () { openNew = !openNew; renderServers(); });
    if (openNew) {
      var form = document.createElement('div'); form.className = 'sub col';
      var nm = input('newSrvName', '서버 이름 (2~20자)', { maxLength: 20 });
      var pw = input('newSrvCode', '참여코드 (선택, 영문·숫자 4~20자)', { maxLength: 20 });
      form.appendChild(nm); form.appendChild(pw);
      form.appendChild(smallBtn('만들기', function () { createServer(nm.value.trim(), pw.value.trim()); }));
      newLi.appendChild(form);
      setTimeout(function () { nm.focus(); }, 30);
    }
    ul.appendChild(newLi);
  }

  function joinServer(serverId, name, password) {
    if (joining || !authenticated) return;
    var payload = { serverId: serverId, userName: auth.name };
    if (password) payload.password = password;
    joining = { serverId: Number(serverId), timer: setTimeout(function () { joining = null; toast('서버가 응답하지 않아요. 다시 시도해 주세요'); }, SERVER_WAIT_MS) };
    socket.emit('joinServer', payload);
  }
  function clearJoining() { if (joining) { clearTimeout(joining.timer); joining = null; } }

  function createServer(name, password) {
    if (name.length < 2 || name.length > 20) { toast('서버 이름은 2~20자'); return; }
    if (password && !/^[a-zA-Z0-9]{4,20}$/.test(password)) { toast('참여코드는 영문·숫자 4~20자'); return; }
    socket.emit('createServer', { name: name, description: '', hostName: auth.name, password: password || '' });
  }

  function openServers() {
    closeSheets(); openCode = null; openNew = false; renderServers(); $('#srvSheet').hidden = false; $('#serverSearch').focus();
    if (isLoggedIn() && authenticated) socket.emit('getServers', { userName: auth.name });
  }
  $('#where').addEventListener('click', openServers);
  $('#serverSearch').addEventListener('input', renderServers);

  socket.on('serversList', function (list) {
    servers = list || [];
    if (!$('#srvSheet').hidden) renderServers();
  });
  socket.on('serversUpdated', function () { if (isLoggedIn()) socket.emit('getServers', { userName: auth.name }); });
  socket.on('memberUpdated', function () { if (isLoggedIn()) socket.emit('getServers', { userName: auth.name }); });
  socket.on('serverCreated', function (data) {
    openNew = false;
    toast('서버 만듦: ' + data.name);
    joinServer(data.id, data.name);   // 호스트는 자동 멤버 — 입장하면 serverJoined 로 선택된다
  });
  socket.on('serverJoined', function (data) {
    clearJoining(); scopeChosen = true;
    autoServerId = null;
    selectServer({ serverId: data.id, serverName: data.name, hostName: data.hostName });
    closeSheets();
    toast(data.name + ' 입장');
  });
  socket.on('serverJoinRequested', function (data) {
    clearJoining(); openCode = null;
    toast('가입 신청함. 방장 승인을 기다려요');
    socket.emit('getServers', { userName: auth.name });
  });
  socket.on('serverError', function (msg) {
    clearJoining();
    if (autoServerId !== null) {   // 지난번 서버 자동 선택이 거부됨(멤버십 없음·대기 중) → 자유 방
      autoServerId = null;
      lsDel('lamdice_lastServer');
      selectServer(null);
    }
    toast(typeof msg === 'string' && msg ? msg : '서버 오류');
  });
  socket.on('serverDeleted', function (data) { if (server && Number(server.serverId) === Number(data.serverId)) { lsDel('lamdice_lastServer'); selectServer(null); toast('서버가 삭제됐어요'); } });
  socket.on('serverApproved', function () { if (isLoggedIn()) socket.emit('getServers', { userName: auth.name }); });
  socket.on('serverRejected', function () { if (isLoggedIn()) socket.emit('getServers', { userName: auth.name }); toast('서버 가입 신청이 거절됐어요'); });
  socket.on('serverKicked', function (data) {
    if (server && Number(server.serverId) === Number(data.serverId)) { lsDel('lamdice_lastServer'); selectServer(null); }
    toast('"' + data.serverName + '" 서버에서 나가게 됐어요');
    if (isLoggedIn()) socket.emit('getServers', { userName: auth.name });
  });

  // ─── 접속 ───
  socket.on('connect', function () {
    $('#connectionStatus').textContent = '연결됨';
    function readyLobby() {
      restoreLastServer();
      if (isLoggedIn()) socket.emit('getServers', { userName: auth.name });
      if (!scopeChosen && !freeName && !server && !joining) openServers();
    }
    if (auth && auth.token) validateToken(auth.token, true, readyLobby);
    else { if (auth && auth.name) expireLogin(); readyLobby(); }
  });
  socket.on('disconnect', function () { authenticated = false; $('#connectionStatus').textContent = '다시 연결하는 중'; });
  socket.on('connect_error', function () { $('#connectionStatus').textContent = '연결되지 않았어요. 잠시 후 다시 시도해 주세요'; });

  function deviceId() {
    var info = { userAgent: navigator.userAgent || '', platform: navigator.platform || '', hardwareConcurrency: navigator.hardwareConcurrency || 0, screenWidth: screen.width || 0, screenHeight: screen.height || 0, language: navigator.language || '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '' };
    var str = JSON.stringify(info), hash = 0;
    for (var i = 0; i < str.length; i++) { hash = ((hash << HASH_SHIFT) - hash) + str.charCodeAt(i); hash = hash & hash; }
    return hash.toString();
  }
  function finishDice(data) {
    if (!diceHandoff || !data.roomId) return;
    var action = diceHandoff; diceHandoff = null; clearTimeout(diceTimer);
    ssSet('diceActiveRoom', JSON.stringify({ roomId: data.roomId, userName: action.name, serverId: action.serverId, serverName: action.serverName, password: action.target.password || '' }));
    ssSet('mobileLobbyReturn', '/mobile');
    window.location.href = '/game?from=mobile';
  }
  socket.on('roomCreated', finishDice); socket.on('roomJoined', finishDice);
  socket.on('roomError', function (message) { clearTimeout(diceTimer); diceHandoff = null; $('#passwordError').textContent = typeof message === 'string' ? message : '방에 들어갈 수 없어요'; toast($('#passwordError').textContent); });
  $('#passwordForm').addEventListener('submit', function (e) { e.preventDefault(); if (!privateTarget) return; privateTarget.target.password = $('#roomPasswordInput').value; handoff(privateTarget.game, privateTarget.target, privateTarget.name); });
  $('#createGame').onclick = function () { if (!socket.connected) { toast('연결 중이에요'); return; } closeSheets(); $('#gameSheet').hidden = false; $('#gameSheet .tile').focus(); };
  $('#featuredJoin').onclick = function () { if (rooms[0]) go(rooms[0].gameType, { kind: 'join', room: rooms[0] }); };
  $('#navHome').onclick = show; $('#navServers').onclick = openServers;
  $$('[data-close]').forEach(function (b) { b.onclick = closeSheets; });
  function textNode(tag, text) { var n = document.createElement(tag); n.textContent = text; return n; }
  function panelButton(label, fn) { var b = textNode('button', label); b.type = 'button'; b.onclick = fn; return b; }
  function openPanel(title) { panelVersion++; closeSheets(); $('#dialogTitle').textContent = title; $('#panelContent').replaceChildren(); if (!$('#dialog').open) $('#dialog').showModal(); return $('#panelContent'); }
  $('#closeDialog').onclick = function () { $('#dialog').close(); };
  function dataRow(title, detail) { var r = textNode('div', ''); r.className = 'data-row'; r.appendChild(textNode('strong', title)); if (detail) r.appendChild(textNode('small', detail)); return r; }
  function fetchJson(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error('조회하지 못했어요. 잠시 후 다시 시도해 주세요'); return r.json(); }); }
  function loadPanel(title, url, paint) { var body = openPanel(title), version = panelVersion; body.appendChild(textNode('p', '불러오는 중…')); fetchJson(url).then(function (data) { if (!body.isConnected || version !== panelVersion) return; body.replaceChildren(); paint(body, data); }).catch(function (e) { if (version !== panelVersion) return; body.replaceChildren(textNode('p', e.message), panelButton('다시 시도', function () { loadPanel(title, url, paint); })); }); }
  function feature(key) {
    if (key === 'ranking') { $('#dialog').close(); closeSheets(); RankingModule.init(server ? server.serverId : null, currentName()); RankingModule.show(); return; }
    if (key === 'menu') { var p = openPanel('더보기'), grid = textNode('div', ''); grid.className = 'menu-grid'; [['members','멤버'],['history','지난 게임'],['updates','업데이트'],['settings','화면 설정'],['account','계정'],['servers','서버 선택'],['help','사용법'],['manage','서버 관리']].forEach(function (entry) { grid.appendChild(panelButton(entry[1], function () { feature(entry[0]); })); }); p.appendChild(grid); return; }
    if (key === 'account') { $('#dialog').close(); $('#acct').click(); return; }
    if (key === 'servers') { $('#dialog').close(); openServers(); return; }
    if (key === 'settings') { var settings = openPanel('화면 설정'), label = textNode('label','화면 스킨'), select = document.createElement('select'); select.id='mobileSkin'; SKINS.forEach(function(s){var option=textNode('option',s[1]);option.value=s[0];select.appendChild(option);}); select.value=ThemeModule.get(); select.onchange=function(){ThemeModule.set(select.value);}; label.appendChild(select);settings.appendChild(label);return; }
    if (key === 'updates') { var updates = openPanel('업데이트'), updateVersion = panelVersion; updates.appendChild(textNode('p','불러오는 중…')); fetch('/update-log.md').then(function (r) { if (!r.ok) throw new Error('업데이트를 불러오지 못했어요'); return r.text(); }).then(function (text) { if(updateVersion!==panelVersion)return; updates.replaceChildren(); var pre = textNode('div', text.split('\n').slice(0, UPDATE_LINES).join('\n')); pre.className = 'updates-copy'; updates.appendChild(pre); var link = textNode('a','업데이트 전체 보기'); link.href='/pages/changelog.html'; updates.appendChild(link); }).catch(function (e) { if(updateVersion!==panelVersion)return; updates.replaceChildren(textNode('p',e.message)); }); return; }
    if (key === 'help') { var help = openPanel('사용법'), a = textNode('a','게임 사용법 보기'); a.href='/pages/game-guides.html'; help.appendChild(a); return; }
    if (!server) { var empty = openPanel(key === 'members' ? '멤버' : key === 'manage' ? '서버 관리' : '지난 게임'); empty.append(textNode('p','서버를 선택하면 모임의 멤버와 기록을 볼 수 있어요.'),panelButton('서버 선택',function(){ $('#dialog').close(); openServers(); })); return; }
    if (key === 'members' || key === 'manage') {
      loadPanel(key === 'manage' ? '서버 관리' : '멤버', '/api/server/' + server.serverId + '/members', function (body, data) {
        if (!data.length) body.appendChild(textNode('p','멤버가 없어요.'));
        data.forEach(function (m) { var r = dataRow(m.user_name, m.is_approved ? (m.isOnline ? '접속 중' : '오프라인') : '승인 대기'); body.appendChild(r);
          if (key === 'manage' && auth && server.hostName === auth.name && !m.is_approved) {
            [true,false].forEach(function (approved) { r.appendChild(panelButton(approved ? '승인' : '거절',function(){fetch('/api/server/'+server.serverId+'/members/'+encodeURIComponent(m.user_name)+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({isApproved:approved,hostName:auth.name})}).then(function(res){if(!res.ok)throw new Error('처리하지 못했어요');feature('manage');}).catch(function(e){toast(e.message);});})); });
          }
        });
      }); return;
    }
    if (key === 'history') loadPanel('지난 게임', '/api/ranking/' + server.serverId + '/calendar', function (body, data) { var list = data.sessions || []; if (!list.length) body.appendChild(textNode('p','아직 게임 기록이 없어요.')); list.forEach(function (session) { var winners = (session.winners || []).map(function (w) { return typeof w === 'string' ? w : w.userName || w.name || ''; }).filter(Boolean).join(', '); body.appendChild(dataRow(session.roomName || ({horse:'경마',dice:'주사위',roulette:'룰렛',deguri:'데구리'}[session.gameType]) || '게임', (session.playedAt ? new Date(session.playedAt).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}) : '') + (winners ? ' · ' + winners : ''))); }); body.appendChild(panelButton('랭킹 · 달력',function(){feature('ranking');})); });
  }
  $$('[data-panel]').forEach(function (b) { b.onclick = function () { feature(b.dataset.panel); }; });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    var sheet = $$('.sheet').find(function (s) { return !s.hidden; }); if (!sheet) return;
    var items = Array.prototype.filter.call(sheet.querySelectorAll('button,input,select,a[href]'),function(e){return !e.disabled && e.getClientRects().length;}); if (!items.length) return;
    var first = items[0], last = items[items.length-1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  syncTop();
  show('home');
})();
