// QA: 2-client socket 통합 테스트 — 2단계 재단순화(2026-06-17 lowest-damage). 2인 게임 = 단일 단계 경로 검증.
// 주의: 이 서버는 방 입장 시 자동 준비(rooms.js joinRoom) — 테스트는 그 사양을 전제로 한다.
// 검증: 동일 reveal payload(frames/hpFrames/bladeFrames byte-identical), slots.length === 참가자 수, frames 길이 = durationMs/sampleMs+1 · 폭 n×3,
//       twoStage=false(n=2) + round1EndMs=null + finalists 빈 배열 + decideMs=40000(STAGE1_MS),
//       제거된 레거시 필드 부재(rule/monsterFrames/escapes/downs/staggers/monsterKills/monsters/bladeUps/eliminations),
//       result.successionList(worst→best, [0]=selected) 동일, requestSkins → skinsUpdated(skins만), gameEnd 동일 당첨자, 엣지 3종
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
    check(Number.isInteger(dur) && dur > 0 && dur <= 70000 && dur % 100 === 0, 'durationMs valid (0<d<=70000, 100배수), got ' + dur);
    check(host._reveal.frames.length === dur / smp + 1, 'frames length === durationMs/sampleMs+1 (' + (dur / smp + 1) + '), got ' + host._reveal.frames.length);
    check(host._reveal.frames.every(f => f.length === n * 3), 'every frame width === n*3 (' + (n * 3) + ')');
    // hpFrames (additive 형제 배열, stride 1) — 결승 HP바. 단일 단계에도 존재(길이/폭 동일, 값=HP_MAX 불변).
    const hpF = host._reveal.hpFrames;
    check(Array.isArray(hpF) && hpF.length === host._reveal.frames.length && hpF.every(f => f.length === n), 'hpFrames present (length===frames.length, width n)');
    check(Number.isInteger(host._reveal.hpMax) && host._reveal.hpMax > 0, 'hpMax present (' + host._reveal.hpMax + ')');
    check(JSON.stringify(host._reveal.hpFrames) === JSON.stringify(guest._reveal.hpFrames), 'hpFrames identical across HOST/GUEST');
    if (obs._reveal) check(JSON.stringify(host._reveal.hpFrames) === JSON.stringify(obs._reveal.hpFrames), 'hpFrames identical for OBS spectator');
    // bladeFrames (feel-v5 S1, additive 형제 배열, stride 1) — per-slot/per-time 칼날 수(base 1 + 칼추가 아이템). n=2 단일 단계도 존재(정수 배열, 비어있지 않음).
    const blF = host._reveal.bladeFrames;
    check(Array.isArray(blF) && blF.length === host._reveal.frames.length && blF.every(f => f.length === n), 'bladeFrames present (length===frames.length, width n, non-empty)');
    check(JSON.stringify(host._reveal.bladeFrames) === JSON.stringify(guest._reveal.bladeFrames), 'bladeFrames identical across HOST/GUEST');
    if (obs._reveal) check(JSON.stringify(host._reveal.bladeFrames) === JSON.stringify(obs._reveal.bladeFrames), 'bladeFrames identical for OBS spectator');
    // items/pickups (B5, additive — reveal/timeline 전용. 마스킹 화이트리스트 변경 없음 → 재진입 마스크 검사 유지).
    check(Array.isArray(host._reveal.items) && Array.isArray(host._reveal.pickups), 'items/pickups present (arrays)');
    check(JSON.stringify(host._reveal.items) === JSON.stringify(guest._reveal.items), 'items identical across HOST/GUEST');
    check(JSON.stringify(host._reveal.pickups) === JSON.stringify(guest._reveal.pickups), 'pickups identical across HOST/GUEST');
    if (obs._reveal) check(JSON.stringify(host._reveal.items) === JSON.stringify(obs._reveal.items), 'items identical for OBS spectator');
    if (obs._reveal) check(JSON.stringify(host._reveal.pickups) === JSON.stringify(obs._reveal.pickups), 'pickups identical for OBS spectator');
    // 2단계 분기 + 결승 메타 (n=2 → 단일 단계)
    console.log('twoStage:', host._reveal.twoStage, '| round1EndMs:', host._reveal.round1EndMs, '| finalists:', JSON.stringify(host._reveal.finalists), '| decideMs:', host._reveal.decideMs);
    check(host._reveal.twoStage === false, 'n=2 twoStage === false (단일 단계), got ' + host._reveal.twoStage);
    check(host._reveal.round1EndMs === null, '단일 단계 round1EndMs === null');
    check(Array.isArray(host._reveal.finalists) && host._reveal.finalists.length === 0, '단일 단계 finalists empty');
    check(Number.isInteger(host._reveal.decideMs) && host._reveal.decideMs === 40000, '단일 단계 decideMs === 40000 (STAGE1_MS), got ' + host._reveal.decideMs);
    // 제거된 레거시 필드 부재 (몬스터/탈출/부활/경직/듀얼룰)
    check(!('rule' in host._reveal), 'reveal has NO legacy rule (twoStage로 대체)');
    check(!('monsterFrames' in host._reveal) && !('escapes' in host._reveal) && !('downs' in host._reveal), 'reveal has NO monsterFrames/escapes/downs');
    check(!('staggers' in host._reveal) && !('monsterKills' in host._reveal) && !('monsters' in host._reveal), 'reveal has NO staggers/monsterKills/monsters');
    check(!('bladeUps' in host._reveal) && !('eliminations' in host._reveal), 'reveal has NO legacy bladeUps/eliminations');
    // result.successionList (이탈자 대체용, worst→best, [0]=selected)
    const succ = host._reveal.result.successionList;
    check(Array.isArray(succ) && succ.length >= 1, 'result.successionList present');
    check(JSON.stringify(succ) === JSON.stringify(guest._reveal.result.successionList), 'successionList identical across clients');
    check(succ[0] === hsel, 'successionList[0] === selected (당첨자)');
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

  // gameEnd 대기: COUNTDOWN 4000 + durationMs + RESULT_HOLD 2200.
  // 단일 단계 n=2 = decideMs 40000 → dur 42000 → reveal 후 ~48.2s. 예산 58s.
  console.log('waiting for gameEnd (up to ~48s after reveal)...');
  while (Date.now() - revealAt < 58000 && (!host._gameEnd || !guest._gameEnd)) await wait(1000);
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
