// QA: 2-client(+관전) socket 통합 테스트 — 전원 참가 2스테이지(최후의 4인) 게이트.
// 검증:
//   - HOST/GUEST/OBS가 받는 reveal이 byte-identical(frames/chars/blades/geom/roulette/result)
//   - 페이로드 sanity: frames stride n×3, durationMs % sampleMs, 등수 1..n 완전, targetRank↔targetSlot 정합
//   - 벌칙 대상은 정확히 한 명이고 그 등수의 슬롯과 일치
//   - 2스테이지 계약(twoStage/stage1EndMs/finaleStartMs/finalists) — 인원 ≤4면 단일 단계
//   - 등수 투표 브로드캐스트(maxRank=4), 재클릭 취소
//   - 재진입 마스킹: roomJoined에 timeline/result/seed 없음(phase/skins/chars/rankVotes/round/history만)
//   - 폐기된 브래킷 필드 부재(bracket/slots/successionList/result.selected)
//   - gameEnd가 reveal 결과와 일치
// 주의: 이 서버는 방 입장 시 자동 준비(rooms.js joinRoom) — 테스트는 그 사양을 전제.
//       실행 전 dev 서버 재기동 필수(socket/* 무리로드 없음).  PORT=5173 node server.js
const { io } = require('socket.io-client');
const URL = 'http://localhost:5173';

function mkClient(name) {
  const s = io(URL, { reconnection: false, transports: ['websocket'] });
  s._name = name;
  s._reveal = null;
  s._gameEnd = null;
  s._votes = [];
  s._disps = [];
  s._errors = [];
  s.on('spin-arena:reveal', d => { s._reveal = d; });
  s.on('spin-arena:gameEnd', d => { s._gameEnd = d; });
  s.on('spin-arena:rankVotesUpdated', d => { s._votes.push(d); });
  s.on('spin-arena:dispositionsUpdated', d => { s._disps.push(d); });
  s.on('spin-arena:error', m => { s._errors.push(m); });
  s.on('readyUsersUpdated', u => { s._ready = u; });
  return s;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
function once(s, ev) { return new Promise(res => s.once(ev, res)); }
async function setReady(s, name, want) {
  for (let i = 0; i < 3; i++) {
    if (((s._ready || []).includes(name)) === want) return true;
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

  const created = once(host, 'roomCreated');
  host.emit('createRoom', { userName: 'HOST', roomName: 'qa-spin', isPrivate: false, password: '', gameType: 'spin-arena', expiryHours: 1, deviceId: 'devHost', tabId: 'tabHost' });
  const roomId = (await created).roomId;
  console.log('room created:', roomId);

  const joined = once(guest, 'roomJoined');
  guest.emit('joinRoom', { roomId, userName: 'GUEST', isHost: false, password: '', deviceId: 'devGuest', tabId: 'tabGuest' });
  await joined;
  await wait(800);

  // ── 엣지: 준비 2명 미만이면 시작 거부 ──
  check(await setReady(guest, 'GUEST', false), 'guest unready toggled');
  const errBefore = host._errors.length;
  host.emit('spin-arena:start');
  await wait(600);
  check(host._errors.length > errBefore && !host._reveal, '준비 2명 미만 시작 거부');
  check(await setReady(guest, 'GUEST', true), 'guest re-ready toggled');

  // ── 성향 선택 브로드캐스트 ──
  host.emit('spin-arena:selectDisposition', { cat: 'atk' });
  guest.emit('spin-arena:selectDisposition', { cat: 'def' });
  await wait(500);
  const lastDisp = host._disps[host._disps.length - 1];
  check(lastDisp && lastDisp.dispositions.HOST === 'atk' && lastDisp.dispositions.GUEST === 'def',
        'selectDisposition 브로드캐스트가 양쪽 성향을 반영');
  const dispBad = host._errors.length;
  host.emit('spin-arena:selectDisposition', { cat: 'nope' });
  await wait(400);
  check(host._errors.length > dispBad, '없는 성향 거부');

  // ── 등수 투표 브로드캐스트 + 재클릭 취소 ──
  host.emit('spin-arena:voteRank', { rank: 2 });
  guest.emit('spin-arena:voteRank', { rank: 2 });
  await wait(500);
  let lastVotes = host._votes[host._votes.length - 1];
  check(lastVotes && lastVotes.rankVotes.HOST === 2 && lastVotes.rankVotes.GUEST === 2 && lastVotes.maxRank === 4,
        'voteRank 브로드캐스트가 양쪽 표를 반영 (maxRank=4)');
  guest.emit('spin-arena:voteRank', { rank: 2 });   // 같은 등수 재클릭 = 취소
  await wait(500);
  lastVotes = host._votes[host._votes.length - 1];
  check(lastVotes && lastVotes.rankVotes.GUEST === undefined, '같은 등수 재클릭 = 취소');

  // ── 제3 클라이언트 입장 + 재진입 마스킹 ──
  const obs = mkClient('OBS');
  await once(obs, 'connect');
  const obsJoined = once(obs, 'roomJoined');
  obs.emit('joinRoom', { roomId, userName: 'OBS', isHost: false, password: '', deviceId: 'devObs', tabId: 'tabObs' });
  const obsJoinData = await obsJoined;
  await wait(500);
  // joinRoom 경로(socket/rooms.js:1043)는 명시적 허용목록이라 spinArena를 아예 싣지 않는다 —
  // server-only(timeline/result/seed)가 구조적으로 누출될 수 없다. 빌드 상태 복원은 requestSkins가 담당한다.
  const joinGS = (obsJoinData && obsJoinData.gameState) || {};
  check(!('spinArena' in joinGS) && !('timeline' in joinGS) && !('result' in joinGS) && !('seed' in joinGS),
        'roomJoined에 spinArena server-only 누출 없음');
  obs._votes = [];
  obs.emit('spin-arena:requestSkins');
  await wait(700);
  const rsVotes = obs._votes[obs._votes.length - 1];
  check(!!rsVotes && rsVotes.maxRank === 4 && rsVotes.rankVotes.HOST === 2,
        '재진입 requestSkins → rankVotesUpdated로 투표 복원');
  check(await setReady(obs, 'OBS', false), 'obs unready toggled');

  // ── 시작 ──
  host.emit('spin-arena:start');
  await wait(2000);
  if (!host._reveal) fail('HOST reveal 없음');
  if (!guest._reveal) fail('GUEST reveal 없음');
  check(!!obs._reveal, 'OBS(비참가 관전자)도 reveal 수신');

  if (host._reveal && guest._reveal) {
    const R = host._reveal, G = guest._reveal;
    const n = R.players.length;

    // 모든 탭이 같은 것을 본다 (공정성 핵심 게이트)
    for (const k of ['frames', 'players', 'blades', 'geom', 'roulette', 'result', 'finalists']) {
      check(JSON.stringify(R[k]) === JSON.stringify(G[k]), `${k} byte-identical HOST==GUEST`);
      if (obs._reveal) check(JSON.stringify(R[k]) === JSON.stringify(obs._reveal[k]), `${k} byte-identical OBS`);
    }

    // 전원 참가 — 준비한 사람이 그대로 슬롯이 된다(고르는 것 없음)
    check(n === 2, `준비 2명 전원 참가 (${n}명)`);
    const names = R.players.map(p => p.name).sort();
    check(JSON.stringify(names) === JSON.stringify(['GUEST', 'HOST']), '참가자 = 준비자 전원');

    const samples = Math.floor(R.durationMs / R.sampleMs) + 1;
    check(R.frames.length === samples * n * 3, `frames === (dur/sample+1)×n×3 (${R.frames.length}/${samples * n * 3})`);
    check(R.durationMs % R.sampleMs === 0, 'durationMs가 sampleMs 배수');
    const ranks = R.result.rankings.map(x => x.rank).sort((a, b) => a - b);
    check(JSON.stringify(ranks) === JSON.stringify(Array.from({ length: n }, (_, i) => i + 1)), `등수 1..${n} 완전`);

    // 2스테이지 계약 — 2명이라 단일 단계여야 한다
    check(R.twoStage === false && R.stage1EndMs === null, '2명 방 = 단일 단계(전환 없음)');
    check(Array.isArray(R.finalists) && R.finalists.length === n, '단일 단계는 전원이 결승');

    // 벌칙 대상 / 1등
    const tgt = R.result.rankings.find(x => x.rank === R.result.targetRank);
    const champ = R.result.rankings.find(x => x.rank === 1);
    const nameBySlot = {}; R.players.forEach(p => { nameBySlot[p.slotId] = p.name; });
    check(R.result.targetRank >= 1 && R.result.targetRank <= Math.min(4, n), `벌칙 등수 1~${Math.min(4, n)} (${R.result.targetRank}등)`);
    check(tgt && nameBySlot[tgt.slotId] === R.result.targetName, `벌칙 대상 = ${R.result.targetName} (정확히 한 명)`);
    check(champ && nameBySlot[champ.slotId] === R.result.championName, `1등 = ${R.result.championName}`);
    check(R.roulette.winningRank === R.result.targetRank, 'roulette.winningRank === targetRank');
    check(R.roulette.rankOrder.indexOf(R.result.targetRank) >= 0, 'rankOrder에 벌칙 등수 포함');

    // 성향이 슬롯 메타에 실려 오는가 — 세부 성향은 서버가 굴린다
    check(R.players.every(pl => pl.dispCat === 'atk' || pl.dispCat === 'def'), '슬롯마다 성향 카테고리');
    check(R.players.every(pl => !!pl.dispSub), '슬롯마다 서버가 굴린 세부 성향');
    const hostPl = R.players.find(pl => pl.name === 'HOST');
    check(hostPl && hostPl.dispCat === 'atk', 'HOST가 고른 공격형이 그대로 반영');

    // 폐기된 필드가 남아 있지 않은가
    for (const k of ['bracket', 'slots', 'chars', 'charCount']) {
      check(!(k in R), `폐기 필드 ${k} 부재`);
    }
    check(!('winners' in R.result) && !('targetChar' in R.result), '폐기 필드 result.winners/targetChar 부재');
    check(!('seed' in R) && !('timeline' in R), 'reveal에 seed/timeline 누출 없음');

    // ── gameEnd 대기 ──
    const waitMs = 5500 + 1200 + 4000 + R.durationMs + 2200 + 3000;
    console.log(`gameEnd 대기 ${Math.round(waitMs / 1000)}초...`);
    await wait(waitMs);
    check(!!host._gameEnd, 'gameEnd 수신');
    if (host._gameEnd) {
      check(host._gameEnd.targetName === R.result.targetName, 'gameEnd.targetName === reveal');
      check(host._gameEnd.championName === R.result.championName, 'gameEnd.championName === reveal');
      check(host._gameEnd.targetRank === R.result.targetRank, 'gameEnd.targetRank === reveal');
      check(JSON.stringify(guest._gameEnd) === JSON.stringify(host._gameEnd), 'gameEnd byte-identical HOST==GUEST');
    }
  }

  host.close(); guest.close(); obs.close();
  console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(2); });
