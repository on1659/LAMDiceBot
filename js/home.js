/*
 * home.js — 홈 프로토타입 (docs/goal/home-proto.prompt.md)
 * 소켓·API 연결, 세 상태(처음·단골·로그인), 방 만들기·합류 인계. 화면은 home.html 안에서만 전환한다.
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
  var firstConnect = true;

  function isLoggedIn() { return !!(auth && auth.name); }
  function currentName() { return server ? auth.name : freeName; }
  function pick(list) { return list[Date.now() % list.length]; }

  // ─── 화면 공통 ───
  function show(id) { ['home', 'rooms'].forEach(function (k) { $('#s-' + k).hidden = k !== id; }); window.scrollTo(0, 0); }
  function toast(msg) {
    var o = $('.toast'); if (o) o.remove();
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, TOAST_MS);
  }
  function closeSheets() { $$('.sheet').forEach(function (s) { s.hidden = true; }); }
  $$('.sheet').forEach(function (s) { s.addEventListener('click', function (e) { if (e.target === s) closeSheets(); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheets(); });
  $$('[data-go]').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.go); }); });

  function syncTop() {
    $('#acct').textContent = isLoggedIn() ? auth.name : (freeName || '로그인');
    $('#where').hidden = !isLoggedIn();
    $('#whereName').textContent = server ? server.serverName : FREE_LABEL;
    $('#roomCount').textContent = rooms.length + ' ›';
  }

  // ─── 서버 선택 저장 — 게임 페이지들이 읽는 두 키를 반드시 함께 쓴다 ───
  function selectServer(sel) {
    server = sel || null;
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
    if (server) socket.emit('setServerId', { serverId: server.serverId, userName: auth.name });
    socket.emit('getRooms');
  }
  function onRooms(list) {
    var sid = server ? Number(server.serverId) : null;
    rooms = (list || []).filter(function (r) {
      return GAMES[r.gameType] && (r.serverId ? Number(r.serverId) : null) === sid;
    });
    syncTop();
    if (!$('#s-rooms').hidden) renderRooms();
  }
  socket.on('roomsList', onRooms);
  socket.on('roomsListUpdated', onRooms);

  // ─── 그림 = 방 만들기. 이름이 있으면 바로, 없으면 이름 한 번 묻고 같은 곳으로 이어간다 ───
  function go(game, target) {
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
      // 로비와 게임이 한 페이지 — diceSession 을 맞춰 두고 기존 로비로 보낸다 (1차 방식)
      ssSet('diceSession', JSON.stringify({ serverId: serverId, serverName: serverName, hostName: server ? server.hostName : null }));
      if (target.kind === 'join') {
        ssSet('diceActiveRoom', JSON.stringify({ roomId: target.room.roomId, userName: name, serverId: serverId, serverName: serverName }));
        window.location.href = '/game';
        return;
      }
      window.location.href = server ? '/game' : '/free';
      return;
    }

    lsSet(g.nameKey, name);
    if (target.kind === 'join') {
      lsSet(g.joinKey, JSON.stringify({ roomId: target.room.roomId, userName: name, isPrivate: !!target.room.isPrivate, serverId: serverId, serverName: serverName }));
      window.location.href = g.path + '?joinRoom=true';
      return;
    }
    lsSet(g.createKey, JSON.stringify({
      userName: name, roomName: name + '님의 ' + g.name, isPrivate: false, password: '',
      expiryHours: EXPIRY_HOURS, blockIPPerUser: BLOCK_IP_PER_USER,
      serverId: serverId, serverName: serverName
    }));
    window.location.href = g.path + '?createRoom=true';
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
    rooms.forEach(function (r) {
      var g = GAMES[r.gameType], li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button'; b.className = 'item'; b.style.setProperty('--soft', g.soft);
      var sq = document.createElement('span'); sq.className = 'sq'; var ic = document.createElement('i'); ic.className = 'ui ' + g.icon; sq.appendChild(ic);
      var nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.roomName;
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
    if (isLoggedIn()) { logout(); return; }
    setRegister(false);
    $('#acctName').value = freeName || ''; $('#acctPin').value = ''; $('#acctErr').hidden = true;
    $('#acctSheet').hidden = false;
    setTimeout(function () { ($('#acctName').value ? $('#acctPin') : $('#acctName')).focus(); }, 50);
  });
  function setRegister(on) {
    register = on;
    $('#acctTitle').textContent = on ? '회원가입' : '로그인';
    $('#acctGo').textContent = on ? '가입' : '로그인';
    $('#acctAlt').textContent = on ? '이미 있으면 로그인' : '처음이면 회원가입';
    $('#acctPin').placeholder = on ? '숫자 암호 4~6자리 (잊으면 못 찾아요)' : '숫자 암호 4~6자리';
  }
  $('#acctAlt').addEventListener('click', function () { setRegister(!register); $('#acctErr').hidden = true; });

  // 로그아웃 — userAuth 만 지운다(이름 키는 유지). 서버 소속은 자유 방으로.
  function logout() {
    lsDel('userAuth'); auth = null;
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
        if (result.token && socket.connected) socket.emit('socket:authenticate', { token: result.token }, function () {});
        restoreLastServer();
        socket.emit('getServers', { userName: auth.name });
      })
      .catch(function () { go.disabled = false; err.textContent = '서버에 연결하지 못했어요'; err.hidden = false; });
  });

  // 지난번 서버가 있으면 자동 선택. 멤버십이 끊겼으면 serverError 가 와서 자유 방으로 되돌린다.
  function restoreLastServer() {
    var last = readJson('lamdice_lastServer');
    if (isLoggedIn() && last && last.serverId) {
      autoServerId = Number(last.serverId);
      selectServer({ serverId: last.serverId, serverName: last.serverName, hostName: last.hostName || '' });
    } else {
      selectServer(null);
    }
  }

  // 토큰 만료 감지 — auth 거부면 AuthToken.renew 로 1회 연장, 그래도 안 되면 로그아웃 처리.
  // 콜백 성공/무응답이면 아무것도 하지 않는다 (오탐 로그아웃 방지).
  function expireLogin() {
    lsDel('userAuth'); auth = null;
    selectServer(null);
    toast('로그인이 만료됐어요. 다시 로그인해 주세요');
  }
  function validateToken(token, allowRenew) {
    socket.emit('socket:authenticate', { token: token }, function (res) {
      if (!(res && res.ok === false && res.reason === 'auth')) return;
      if (allowRenew && window.AuthToken) {
        window.AuthToken.renew(function (newToken) {
          if (newToken) { auth = readJson('userAuth'); validateToken(newToken, false); } else { expireLogin(); }
        });
      } else {
        expireLogin();
      }
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
    servers.forEach(function (s) {
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
    ul.appendChild(row('dash' + (nowId === null ? ' now' : ''), '', FREE_LABEL, nowId === null ? LABEL_NOW : '기록 없음', 'ok', function () { selectServer(null); closeSheets(); }));
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
    if (joining) return;
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

  $('#where').addEventListener('click', function () {
    openCode = null; openNew = false;
    renderServers(); $('#srvSheet').hidden = false;
    socket.emit('getServers', { userName: auth.name });
  });

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
    clearJoining();
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
  socket.on('serverKicked', function (data) {
    if (server && Number(server.serverId) === Number(data.serverId)) { lsDel('lamdice_lastServer'); selectServer(null); }
    toast('"' + data.serverName + '" 서버에서 나가게 됐어요');
    if (isLoggedIn()) socket.emit('getServers', { userName: auth.name });
  });

  // ─── 접속 ───
  socket.on('connect', function () {
    if (firstConnect) {
      firstConnect = false;
      if (auth && auth.token) validateToken(auth.token, true);
      else if (auth && auth.name && window.AuthToken) window.AuthToken.renew(function () { auth = readJson('userAuth') || auth; });
      restoreLastServer();
      if (isLoggedIn()) socket.emit('getServers', { userName: auth.name });
      return;
    }
    requestRooms();   // 재접속 — 소속을 다시 알린다
  });

  syncTop();
  show('home');
})();
