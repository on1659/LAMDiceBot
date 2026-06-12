// QA: 2-client socket 통합 테스트 — 칼 수집 탈출 개편(가변 durationMs, escapes/downs/bladeUps/decideMs, requestSkins)
// 주의: 이 서버는 방 입장 시 자동 준비(rooms.js joinRoom) — 테스트는 그 사양을 전제로 한다.
// 검증: 동일 reveal payload, slots.length === 참가자 수, frames 길이 = durationMs/sampleMs+1 · 폭 n×3,
//       escapes/downs/bladeUps/decideMs 형태(eliminations/killerId 제거),
//       requestSkins → skinsUpdated(skins만), gameEnd 동일 당첨자, 엣지케이스 3종
const { io } = require('socket.io-client');
const URL = 'http://localhost:5173';

function mkClient(name) {
  const s = io(URL, { reconnection: false, transports: ['websocket'] });
  s._name = name;
  s._reveal = null;
  s._gameEnd = null;
  s._skinsUpdates = [];
  s._errors = [];
  s.on('spin-arena:reveal', d => { s._reveal = d; });
  s.on('spin-arena:gameEnd', d => { s._gameEnd = d; });
  s.on('spin-arena:skinsUpdated', d => { s._skinsUpdates.push(d); });
  s.on('spin-arena:error', m => { s._errors.push(m); console.log(`[${name}] error:`, m); });
  s.on('readyError', m => console.log(`[${name}] readyError:`, m));
  s.on('readyUsersUpdated', u => { s._ready = u; });
  return s;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function once(s, ev) { return new Promise(res => s.once(ev, res)); }
// 자기 자신의 준비 상태를 원하는 값으로 토글 (입장 시 자동 준비 전제)
async function setReady(s, name, want) {
  for (let i = 0; i < 3; i++) {
    const cur = (s._ready || []).includes(name);
    if (cur === want) return true;
    s.emit('toggleReady');
    await wait(400);
  }
  return ((s._ready || []).includes(name)) === want;
}

(async () => {
  const host = mkClient('HOST');
  const guest = mkClient('GUEST');
  let pass = true;
  const check = (cond, label) => { console.log(label + ':', cond ? 'PASS' : 'FAIL'); if (!cond) pass = false; };
  const fail = (m) => { pass = false; console.log('FAIL:', m); };

  await Promise.all([once(host, 'connect'), once(guest, 'connect')]);
  console.log('connected both');

  const created = once(host, 'roomCreated');
  host.emit('createRoom', { userName: 'HOST', roomName: 'qa-spin', isPrivate: false, password: '', gameType: 'spin-arena', expiryHours: 1, deviceId: 'devHost', tabId: 'tabHost' });
  const cr = await created;
  const roomId = cr.roomId;
  console.log('room created:', roomId);

  const joined = once(guest, 'roomJoined');
  guest.emit('joinRoom', { roomId, userName: 'GUEST', isHost: false, password: '', deviceId: 'devGuest', tabId: 'tabGuest' });
  await joined;
  console.log('guest joined (auto-ready expected)');
  await wait(800);
  console.log('ready list:', JSON.stringify(host._ready));

  // ── 엣지 1: GUEST 준비 해제 후 시작 → 인원 부족 거부 ──
  const okOff = await setReady(guest, 'GUEST', false);
  check(okOff, 'guest unready toggled');
  const errBefore = host._errors.length;
  host.emit('spin-arena:start');
  await wait(600);
  check(host._errors.length > errBefore && !host._reveal, 'edge1 start with <2 ready rejected');

  const okOn = await setReady(guest, 'GUEST', true);
  check(okOn, 'guest re-ready toggled');
  console.log('ready list:', JSON.stringify(host._ready));

  // ── 스킨 선택 (idle) + 브로드캐스트 동기화 ──
  host.emit('spin-arena:selectSkin', { skinId: 'crimson' });
  guest.emit('spin-arena:selectSkin', { skinId: 'azure' });
  await wait(500);
  const lastHostSU = host._skinsUpdates[host._skinsUpdates.length - 1];
  check(lastHostSU && lastHostSU.skins.HOST === 'crimson' && lastHostSU.skins.GUEST === 'azure', 'selectSkin broadcast reflects both skins');

  // ── 제3 클라이언트 입장(자동 준비됨 → 명시 해제) + requestSkins 동기화 ──
  const obs = mkClient('OBS');
  await once(obs, 'connect');
  const obsJoined = once(obs, 'roomJoined');
  obs.emit('joinRoom', { roomId, userName: 'OBS', isHost: false, password: '', deviceId: 'devObs', tabId: 'tabObs' });
  const obsJoinData = await obsJoined;
  await wait(500);
  // roomJoined payload에 server-only 데이터 누출 없는지 (공정성)
  const joinSA = obsJoinData && (obsJoinData.gameState ? obsJoinData.gameState.spinArena : obsJoinData.spinArena);
  if (joinSA) {
    check(!('timeline' in joinSA) && !('result' in joinSA) && !('seed' in joinSA), 'roomJoined spinArena masked (no timeline/result/seed)');
  } else {
    console.log('note: roomJoined payload has no spinArena field (keys=' + JSON.stringify(Object.keys(obsJoinData || {})) + ')');
  }
  const okObsOff = await setReady(obs, 'OBS', false);
  check(okObsOff, 'obs unready toggled');

  obs._skinsUpdates = [];
  obs.emit('spin-arena:requestSkins');
  await wait(500);
  const su = obs._skinsUpdates[obs._skinsUpdates.length - 1];
  check(!!su, 'requestSkins -> skinsUpdated received');
  if (su) {
    check(su.skins && su.skins.HOST === 'crimson' && su.skins.GUEST === 'azure', 'requestSkins returns selected skins');
    const keys = Object.keys(su);
    check(keys.length === 1 && keys[0] === 'skins', 'skinsUpdated has skins ONLY, keys=' + JSON.stringify(keys));
  }

  // ── 시작 (OBS는 비준비 — 슬롯 제외돼야 함) ──
  host.emit('spin-arena:start');
  await wait(1500);
  if (!host._reveal) fail('HOST got no reveal');
  if (!guest._reveal) fail('GUEST got no reveal');
  check(!!obs._reveal, 'OBS (in-room, non-participant) receives reveal broadcast');

  const revealAt = Date.now();
  if (host._reveal && guest._reveal) {
    check(JSON.stringify(host._reveal.frames) === JSON.stringify(guest._reveal.frames), 'reveal frames identical across clients');
    const hsel = host._reveal.result.selected, gsel = guest._reveal.result.selected;
    check(hsel === gsel, 'reveal selected identical (HOST=' + hsel + ' GUEST=' + gsel + ')');
    const n = host._reveal.slots.length;
    check(n === 2, 'slots.length === 2 (ready participants only), got ' + n);
    check(!host._reveal.slots.some(s => s.name === 'OBS'), 'edge2 non-ready user excluded from slots');
    const dur = host._reveal.durationMs, smp = host._reveal.sampleMs;
    check(Number.isInteger(dur) && dur > 0 && dur <= 30000 && dur % 100 === 0, 'durationMs valid (0<d<=30000, 100배수), got ' + dur);
    check(host._reveal.frames.length === dur / smp + 1, 'frames length === durationMs/sampleMs+1 (' + (dur / smp + 1) + '), got ' + host._reveal.frames.length);
    check(host._reveal.frames.every(f => f.length === n * 3), 'every frame width === n*3 (' + (n * 3) + ')');
    const escapes = host._reveal.escapes, downs = host._reveal.downs, bladeUps = host._reveal.bladeUps;
    console.log('escapes:', JSON.stringify(escapes), '| downs:', JSON.stringify(downs), '| bladeUps:', (bladeUps || []).length + '건', '| decideMs:', host._reveal.decideMs);
    check(Array.isArray(escapes) && escapes.every(e => ['id', 'timeMs', 'x', 'y'].every(k => k in e)), 'escapes array, entries have id/timeMs/x/y');
    check(Array.isArray(downs) && downs.every(d => ['id', 'timeMs', 'reviveMs', 'x', 'y'].every(k => k in d)), 'downs array, entries have id/timeMs/reviveMs/x/y');
    check(Array.isArray(bladeUps) && bladeUps.every(b => ['id', 'timeMs'].every(k => k in b)), 'bladeUps array, entries have id/timeMs');
    check('decideMs' in host._reveal && (host._reveal.decideMs === null || Number.isInteger(host._reveal.decideMs)), 'decideMs present (ms|null)');
    check(!('eliminations' in host._reveal), 'reveal has NO legacy eliminations');
    check(host._reveal.result.rankings.every(r => 'name' in r && 'slotId' in r && 'rank' in r && 'escapeMs' in r), 'rankings entries have name/slotId/rank/escapeMs');
    check(!('seed' in host._reveal) && !('timeline' in host._reveal), 'reveal has NO seed/timeline');
    check(hsel === 'HOST' || hsel === 'GUEST', 'selected is a participant (' + hsel + ')');
    const hostSlot = host._reveal.slots.find(s => s.name === 'HOST');
    const guestSlot = host._reveal.slots.find(s => s.name === 'GUEST');
    check(hostSlot && hostSlot.skinId === 'crimson' && guestSlot && guestSlot.skinId === 'azure', 'selected skins applied to slots');
  }

  // ── 엣지 3: playing 중 selectSkin → 거부 ──
  const gErrBefore = guest._errors.length;
  guest.emit('spin-arena:selectSkin', { skinId: 'emerald' });
  await wait(500);
  check(guest._errors.length > gErrBefore, 'edge3 selectSkin during playing rejected');

  // gameEnd 대기: COUNTDOWN 4000 + durationMs(가변, 최대 30000) + RESULT_HOLD 2200 = reveal 후 최대 ~36.2s
  // (결판 압축으로 더 빨리 끝날 수 있음 — 예산 42s는 그대로 유지)
  console.log('waiting for gameEnd (up to ~36.2s after reveal)...');
  while (Date.now() - revealAt < 42000 && (!host._gameEnd || !guest._gameEnd)) await wait(1000);
  if (!host._gameEnd) fail('HOST no gameEnd'); else console.log('HOST gameEnd selected=' + host._gameEnd.selected + ' round=' + host._gameEnd.round);
  if (!guest._gameEnd) fail('GUEST no gameEnd'); else console.log('GUEST gameEnd selected=' + guest._gameEnd.selected);
  if (host._gameEnd && guest._gameEnd) {
    check(host._gameEnd.selected === host._reveal.result.selected, 'gameEnd selected matches reveal');
    check(host._gameEnd.selected === guest._gameEnd.selected, 'gameEnd selected identical across clients');
    check(Array.isArray(host._gameEnd.rankings) && host._gameEnd.rankings.length === 2, 'gameEnd rankings length 2');
    check(typeof host._gameEnd.round === 'number', 'gameEnd has round');
  }

  console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
  host.close(); guest.close(); obs.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(2); });
