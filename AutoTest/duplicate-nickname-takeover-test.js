// QA: 중복 닉네임 인계(takeover) 통합 테스트 — duplicate-nickname-takeover.md 게이트.
// 검증 (socket.io-client only, 브라우저 불필요):
//   T1 라이브 중복 join → 첫 소켓 sessionTakenOver 수신 + disconnect, 둘째는 슬롯 인계(_1 없음, 1명 유지)
//   T2 호스트 인계 → 새 소켓이 host 승계, room 호스트 1명, hostId 갱신(updateUsers의 isHost로 확인)
//   T3 같은 탭(tabId 동일) 새로고침 재바인딩 → sessionTakenOver 안 옴(조용히 재연결), 1명 유지, _1 없음
//   T4 stale(disconnect된) 옛 소켓 → 같은 이름 재입장 가능, 슬롯 재확보, 1명 유지
// 주의: 이 서버는 방 입장 시 자동 준비. 실행 전 dev 서버 재기동(socket/* 무리로드). PORT=5173 가정.
const { io } = require('socket.io-client');
const URL = process.env.BASE_URL || 'http://localhost:5173';

function mkClient(name) {
  const s = io(URL, { reconnection: false, transports: ['websocket'] });
  s._name = name;
  s._takenOver = null;
  s._users = null;
  s._joined = null;
  s._roomErr = null;
  s.on('sessionTakenOver', m => { s._takenOver = m; });
  s.on('updateUsers', u => { s._users = Array.isArray(u) ? u : (u && u.users) || []; });
  s.on('roomJoined', d => { s._joined = d; });
  s.on('roomCreated', d => { s._joined = d; });
  s.on('roomError', m => { s._roomErr = m; });
  return s;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function once(s, ev) { return new Promise(res => s.once(ev, res)); }

let pass = true;
const check = (cond, label) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) pass = false; };

(async () => {
  // ---------- T1: 라이브 중복 인계 ----------
  console.log('\n--- T1: live duplicate takeover ---');
  const a1 = mkClient('A1'); const a2 = mkClient('A2');
  await Promise.all([once(a1, 'connect'), once(a2, 'connect')]);
  const cr = once(a1, 'roomCreated');
  a1.emit('createRoom', { userName: '이더', roomName: 'qa-takeover', isPrivate: false, password: '', gameType: 'dice', expiryHours: 1, deviceId: 'devA1', tabId: 'tabA1' });
  const room = await cr;
  const roomId = room.roomId;
  await wait(500);

  // 둘째 소켓이 같은 방·같은 이름·다른 tabId 로 join → 인계 발동
  const a2joined = once(a2, 'roomJoined');
  a2.emit('joinRoom', { roomId, userName: '이더', isHost: false, password: '', deviceId: 'devA2', tabId: 'tabA2' });
  const j2 = await a2joined;
  check(j2 && j2.userName === '이더', 'T1 second socket keeps original name (no _1)');
  check(j2 && !/_1$/.test(j2.userName || ''), 'T1 no _1 suffix in roomJoined');

  // 첫 소켓은 sessionTakenOver 수신해야
  await wait(300);
  check(a1._takenOver != null, 'T1 first socket receives sessionTakenOver');
  check(typeof a1._takenOver === 'string' && a1._takenOver.includes('다른 곳'), 'T1 takeover message is plain Korean notice');

  // 1초 후 첫 소켓 disconnect 되어야 (서버 setTimeout 1000)
  await wait(1300);
  check(a1.connected === false, 'T1 first socket disconnected after ~1s');

  // 방엔 이더 1명만, _1 없음
  await wait(300);
  const u1 = a2._users || j2.gameState && j2.gameState.users || [];
  const names1 = (u1 || []).map(u => u.name);
  check(names1.filter(n => n === '이더').length === 1, 'T1 exactly one 이더 in room');
  check(!names1.some(n => /_1$/.test(n)), 'T1 no _1 name anywhere in user list');

  // 핑퐁 방지: 둘째가 다시 쫓겨나지 않음(안정)
  check(a2._takenOver == null && a2.connected === true, 'T1 second socket stays (no ping-pong)');
  a2.disconnect();
  await wait(300);

  // ---------- T2: 호스트 인계 ----------
  console.log('\n--- T2: host takeover (hostId update, single host) ---');
  const h1 = mkClient('H1'); const h2 = mkClient('H2');
  await Promise.all([once(h1, 'connect'), once(h2, 'connect')]);
  const cr2 = once(h1, 'roomCreated');
  h1.emit('createRoom', { userName: '방장', roomName: 'qa-host', isPrivate: false, password: '', gameType: 'dice', expiryHours: 1, deviceId: 'devH1', tabId: 'tabH1' });
  const room2 = await cr2;
  await wait(400);
  const h2joined = once(h2, 'roomJoined');
  h2.emit('joinRoom', { roomId: room2.roomId, userName: '방장', isHost: false, password: '', deviceId: 'devH2', tabId: 'tabH2' });
  const jh = await h2joined;
  check(jh && jh.isHost === true, 'T2 new socket inherits host status');
  await wait(400);
  const uh = h2._users || [];
  const hosts = uh.filter(u => u.isHost === true);
  check(hosts.length === 1, 'T2 exactly one host in room');
  check(hosts.length === 1 && hosts[0].name === '방장', 'T2 host is 방장');
  check(uh.filter(u => u.name === '방장').length === 1, 'T2 single 방장 entry (no dup)');
  await wait(1300);
  check(h1.connected === false, 'T2 old host socket disconnected');
  // 인계 후에도 호스트 1명 유지 (옛 호스트 disconnect가 슬롯/호스트 안 깸)
  await wait(300);
  const uh2 = h2._users || [];
  check((uh2.filter(u => u.isHost === true)).length === 1, 'T2 still exactly one host after old socket disconnect');
  h2.disconnect();
  await wait(300);

  // ---------- T3: 같은 탭 새로고침 (tabId 동일) → 조용한 재바인딩 ----------
  console.log('\n--- T3: same-tab refresh (silent rebind, no takeover event) ---');
  const s1 = mkClient('S1');
  await once(s1, 'connect');
  const cr3 = once(s1, 'roomCreated');
  s1.emit('createRoom', { userName: '탭유저', roomName: 'qa-sametab', isPrivate: false, password: '', gameType: 'dice', expiryHours: 1, deviceId: 'devS', tabId: 'tabSAME' });
  const room3 = await cr3;
  await wait(400);
  // 같은 tabId 로 두 번째 소켓(새로고침 시뮬) join
  const s2 = mkClient('S2');
  await once(s2, 'connect');
  const s2joined = once(s2, 'roomJoined');
  s2.emit('joinRoom', { roomId: room3.roomId, userName: '탭유저', isHost: false, password: '', deviceId: 'devS', tabId: 'tabSAME' });
  const js = await s2joined;
  check(js && js.userName === '탭유저', 'T3 same-tab rebind keeps name (no _1)');
  await wait(300);
  check(s1._takenOver == null, 'T3 same-tab: old socket NOT notified (silent refresh path)');
  await wait(1300);
  check(s1.connected === false, 'T3 same-tab: old socket still disconnected (server force)');
  await wait(200);
  const us = s2._users || [];
  check(us.filter(u => u.name === '탭유저').length === 1, 'T3 exactly one 탭유저');
  s2.disconnect();
  await wait(300);

  // ---------- T4: stale(disconnect) 옛 소켓 → 재입장 슬롯 재확보 ----------
  console.log('\n--- T4: stale old socket → reclaim slot ---');
  const d1 = mkClient('D1');
  await once(d1, 'connect');
  const cr4 = once(d1, 'roomCreated');
  d1.emit('createRoom', { userName: '복귀자', roomName: 'qa-stale', isPrivate: false, password: '', gameType: 'dice', expiryHours: 1, deviceId: 'devD', tabId: 'tabD1' });
  const room4 = await cr4;
  await wait(400);
  d1.disconnect();            // 옛 소켓을 먼저 끊는다 (stale)
  await wait(600);            // grace 안에 재입장
  const d2 = mkClient('D2');
  await once(d2, 'connect');
  const d2joined = once(d2, 'roomJoined');
  d2.emit('joinRoom', { roomId: room4.roomId, userName: '복귀자', isHost: false, password: '', deviceId: 'devD', tabId: 'tabD2' });
  const jd = await d2joined;
  check(jd && jd.userName === '복귀자', 'T4 stale reclaim keeps name (no _1)');
  check(jd && jd.isHost === true, 'T4 stale reclaim keeps host status');
  await wait(400);
  const ud = d2._users || [];
  check(ud.filter(u => u.name === '복귀자').length === 1, 'T4 exactly one 복귀자');
  check(!ud.some(u => /_1$/.test(u.name)), 'T4 no _1 anywhere');
  d2.disconnect();
  await wait(300);

  console.log('\n==================================');
  console.log(pass ? 'OVERALL: PASS' : 'OVERALL: FAIL');
  console.log('==================================');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(2); });
