// QA: 2-client(+관전) socket 통합 테스트 — 토너먼트 rework Slice 2 게이트.
// 검증:
//   - HOST/GUEST/OBS가 받는 reveal의 bracket이 byte-identical(JSON.stringify deep-equal), slots/geom/result.selected 동일
//   - bracket 구조 sanity: rounds[].duels[] 필드(frames stride 6, decideMs/durationMs, loserSlot/winnerSlot, bladeA/bladeB), 풀이 1로 수렴, 정확히 1 finalLoser
//   - durationMs = SEQUENTIAL 브로드캐스트(오버뷰 + 라운드인트로 + 듀얼인트로/아웃트로/암전 + bye비트), GAME_MS(340000) 캡, 100 배수, frames hp 채널 ≤ HP_MAX
//   - 재진입 마스킹: roomJoined payload에 bracket/timeline/result/seed 없음(phase/skins/round/history만)
//   - 제거된 레거시 reveal 필드 부재(frames/hpFrames/bladeFrames/items/pickups/twoStage/round1EndMs/finalists/decideMs at top-level / rule/monsterFrames)
//   - result.successionList(worst→best, [0]=selected) 동일, gameEnd selected 동일·reveal과 일치, 엣지 3종
// 주의: 이 서버는 방 입장 시 자동 준비(rooms.js joinRoom) — 테스트는 그 사양을 전제. 실행 전 dev 서버 재기동(socket/* 무리로드).
const { io } = require('socket.io-client');
const URL = 'http://localhost:5173';
const GAME_MS = 340000;           // 서버/클라 미러 — durationMs 하드 캡(SEQUENTIAL 브로드캐스트)
const HP_MAX = 100;               // 듀얼 HP 분모(frames hp 채널 상한)
// 연출 비트(SEQUENTIAL 브로드캐스트) — 서버 socket/spin-arena.js 미러.
//   durationMs = BRACKET_OVERVIEW_MS + Σ_rounds[ ROUND_INTRO_MS + Σ_duels(DUEL_INTRO_MS + dur + DUEL_OUTRO_MS + DUEL_BLACKOUT_MS) + #byes×BYE_BEAT_MS ]
const BRACKET_OVERVIEW_MS = 3500;
const ROUND_INTRO_MS = 2000;
const DUEL_INTRO_MS = 1500;
const DUEL_OUTRO_MS = 1500;
const DUEL_BLACKOUT_MS = 700;
const BYE_BEAT_MS = 1500;

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

  // ── 제3 클라이언트 입장(자동 준비됨 → 명시 해제) + requestSkins 동기화 + 재진입 마스킹 ──
  const obs = mkClient('OBS');
  await once(obs, 'connect');
  const obsJoined = once(obs, 'roomJoined');
  obs.emit('joinRoom', { roomId, userName: 'OBS', isHost: false, password: '', deviceId: 'devObs', tabId: 'tabObs' });
  const obsJoinData = await obsJoined;
  await wait(500);
  // roomJoined payload에 server-only 데이터 누출 없는지 (공정성 — bracket/timeline/result/seed 절대 비노출)
  const joinSA = obsJoinData && (obsJoinData.gameState ? obsJoinData.gameState.spinArena : obsJoinData.spinArena);
  if (joinSA) {
    check(!('timeline' in joinSA) && !('result' in joinSA) && !('seed' in joinSA) && !('bracket' in joinSA),
      'roomJoined spinArena masked (no timeline/result/seed/bracket)');
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
    const R = host._reveal, G = guest._reveal;

    // ── byte-identical bracket / slots / geom / result across clients (공정성 핵심 게이트) ──
    check(JSON.stringify(R.bracket) === JSON.stringify(G.bracket), 'bracket byte-identical HOST==GUEST');
    if (obs._reveal) check(JSON.stringify(R.bracket) === JSON.stringify(obs._reveal.bracket), 'bracket byte-identical for OBS spectator');
    check(JSON.stringify(R.slots) === JSON.stringify(G.slots), 'slots identical HOST==GUEST');
    check(JSON.stringify(R.geom) === JSON.stringify(G.geom), 'geom identical HOST==GUEST');
    const hsel = R.result.selected, gsel = G.result.selected;
    check(hsel === gsel, 'result.selected identical (HOST=' + hsel + ' GUEST=' + gsel + ')');
    if (obs._reveal) check(obs._reveal.result.selected === hsel, 'result.selected identical for OBS');

    // ── slots ──
    const n = R.slots.length;
    check(n === 2, 'slots.length === 2 (ready participants only), got ' + n);
    check(!R.slots.some(s => s.name === 'OBS'), 'edge2 non-ready user excluded from slots');
    const hostSlot = R.slots.find(s => s.name === 'HOST');
    const guestSlot = R.slots.find(s => s.name === 'GUEST');
    check(hostSlot && hostSlot.skinId === 'crimson' && guestSlot && guestSlot.skinId === 'azure', 'selected skins applied to slots');
    check(R.slots.every(s => 'id' in s && 'name' in s && 'color' in s && 'blade' in s && 'tier' in s), 'slots have id/name/color/blade/tier');

    // ── bracket 구조 sanity ──
    const br = R.bracket;
    check(br && Array.isArray(br.rounds) && br.rounds.length >= 1, 'bracket.rounds present');
    check(Array.isArray(br.poolOrder) && br.poolOrder.length === n, 'bracket.poolOrder length === n');
    check(Number.isInteger(br.finalLoser), 'bracket.finalLoser is a slotId (' + br.finalLoser + ')');
    check(br.loserDepth && typeof br.loserDepth === 'object', 'bracket.loserDepth map present');
    // finalLoser 이름 == result.selected
    const finalLoserName = (R.slots.find(s => s.id === br.finalLoser) || {}).name;
    check(finalLoserName === hsel, 'bracket.finalLoser name === result.selected (' + finalLoserName + ')');

    // 풀이 1로 수렴(꼴찌전): 라운드별 LOSER 수가 절반씩 → 마지막 라운드는 듀얼 1개
    let okHalving = true, okDuels = true;
    // SEQUENTIAL 브로드캐스트 durationMs = BRACKET_OVERVIEW_MS
    //   + Σ_rounds[ ROUND_INTRO_MS + Σ_duels(DUEL_INTRO_MS + dur + DUEL_OUTRO_MS + DUEL_BLACKOUT_MS) + #byes×BYE_BEAT_MS ] (rounds.length>0 가드)
    let computedDur = 0;
    for (let ri = 0; ri < br.rounds.length; ri++) {
      const rd = br.rounds[ri];
      if (!Array.isArray(rd.duels)) { okDuels = false; continue; }
      for (const d of rd.duels) {
        computedDur += DUEL_INTRO_MS + d.durationMs + DUEL_OUTRO_MS + DUEL_BLACKOUT_MS;
        // 듀얼 필드 + frames stride 6 + 결판
        const okFields = Number.isInteger(d.duelId) && Number.isInteger(d.slotA) && Number.isInteger(d.slotB)
          && Array.isArray(d.frames) && d.frames.length % 6 === 0
          && Number.isInteger(d.durationMs) && d.durationMs > 0
          && Number.isInteger(d.decideMs)
          && (d.loserSlot === d.slotA || d.loserSlot === d.slotB)
          && (d.winnerSlot === d.slotA || d.winnerSlot === d.slotB)
          && d.loserSlot !== d.winnerSlot
          && d.bladeA && d.bladeB
          && Number.isFinite(d.bladeA.baseAngle) && Number.isFinite(d.bladeA.spinSpeed)
          && (d.bladeA.spinDir === 1 || d.bladeA.spinDir === -1);
        if (!okFields) { okDuels = false; console.log('  bad duel:', JSON.stringify({ duelId: d.duelId, framesLen: (d.frames||[]).length, decideMs: d.decideMs, loserSlot: d.loserSlot, winnerSlot: d.winnerSlot })); }
        // frames hp 채널(인덱스 2,5)이 0..HP_MAX 범위
        for (let fi = 0; fi < d.frames.length; fi += 6) {
          if (d.frames[fi + 2] < 0 || d.frames[fi + 2] > HP_MAX || d.frames[fi + 5] < 0 || d.frames[fi + 5] > HP_MAX) { okDuels = false; break; }
        }
        // frames 길이 == durationMs/100 + 1
        if (d.frames.length / 6 !== d.durationMs / R.sampleMs + 1) { okDuels = false; console.log('  duel frames len mismatch:', d.frames.length / 6, 'vs', d.durationMs / R.sampleMs + 1); }
      }
      computedDur += ROUND_INTRO_MS;
      computedDur += (Array.isArray(rd.byes) ? rd.byes.length : 0) * BYE_BEAT_MS;
    }
    if (br.rounds.length > 0) computedDur += BRACKET_OVERVIEW_MS;
    // poolSize 라이트 sanity: 각 라운드 poolSize 정수 + round0 == n
    check(br.rounds.every(r => Number.isInteger(r.poolSize)), 'every round has integer poolSize');
    check(br.rounds[0].poolSize === n, 'bracket.rounds[0].poolSize === n (' + br.rounds[0].poolSize + ')');
    check(okDuels, 'every duel: fields ok, frames stride6, hp in [0,HP_MAX], len==dur/sampleMs+1, decideMs!=null');
    check(br.rounds[br.rounds.length - 1].duels.length === 1, 'last round has exactly 1 duel (풀→1 수렴)');
    void okHalving;

    // ── durationMs: SEQUENTIAL 브로드캐스트(오버뷰 + 라운드인트로 + 듀얼인트로/아웃트로/암전 + bye비트), GAME_MS 캡, 100 배수 ──
    const dur = R.durationMs;
    check(Number.isInteger(dur) && dur > 0 && dur <= GAME_MS && dur % 100 === 0, 'durationMs valid (0<d<=GAME_MS, 100배수), got ' + dur);
    check(dur === Math.min(GAME_MS, computedDur), 'durationMs === min(GAME_MS, 브로드캐스트 비트 합) (computed=' + computedDur + ')');
    check(dur === G.durationMs, 'durationMs identical HOST==GUEST');

    // ── result.successionList (worst→best, [0]=selected) ──
    const succ = R.result.successionList;
    check(Array.isArray(succ) && succ.length >= 1, 'result.successionList present');
    check(JSON.stringify(succ) === JSON.stringify(G.result.successionList), 'successionList identical across clients');
    check(succ[0] === hsel, 'successionList[0] === selected (당첨자)');
    check(R.result.rankings.every(r => 'name' in r && 'slotId' in r && 'rank' in r), 'rankings entries have name/slotId/rank');
    check(R.result.rankings.length === n, 'rankings covers all participants');

    // ── 제거된 레거시 필드 부재(이전 lowest-damage/2단계/몬스터 모델) ──
    check(!('frames' in R) && !('hpFrames' in R) && !('bladeFrames' in R), 'reveal has NO top-level frames/hpFrames/bladeFrames (브래킷 내부로 이동)');
    check(!('twoStage' in R) && !('round1EndMs' in R) && !('finalists' in R) && !('decideMs' in R), 'reveal has NO top-level twoStage/round1EndMs/finalists/decideMs');
    check(!('items' in R) && !('pickups' in R), 'reveal has NO items/pickups (to너먼트 아이템 OFF)');
    check(!('rule' in R) && !('monsterFrames' in R) && !('escapes' in R) && !('monsters' in R), 'reveal has NO legacy rule/monsterFrames/escapes/monsters');
    check(!('seed' in R) && !('timeline' in R), 'reveal has NO seed/timeline (server-only)');
    check(hsel === 'HOST' || hsel === 'GUEST', 'selected is a participant (' + hsel + ')');
  }

  // ── 엣지 3: playing 중 selectSkin → 거부 ──
  const gErrBefore = guest._errors.length;
  guest.emit('spin-arena:selectSkin', { skinId: 'emerald' });
  await wait(500);
  check(guest._errors.length > gErrBefore, 'edge3 selectSkin during playing rejected');

  // gameEnd 대기: COUNTDOWN 4000 + durationMs + RESULT_HOLD 2200. n=2 = 1 라운드(전환 없음).
  const budget = (host._reveal ? host._reveal.durationMs : GAME_MS) + 4000 + 2200 + 8000;
  console.log('waiting for gameEnd (up to ~' + Math.round(budget / 1000) + 's after reveal)...');
  while (Date.now() - revealAt < budget && (!host._gameEnd || !guest._gameEnd)) await wait(1000);
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
