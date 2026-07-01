/**
 * QA — 사다리타기 pick-elimination(신 룰) 프로토콜 레벨 socket 회귀.
 * socket.io-client 직결로 socket/ladder.js 신규 프로토콜(pickTop/myRungs/rungsUpdated/reveal/
 * tournamentRound/gameEnd/tournamentEnd/roundReset)을 검증한다. 페이지 JS 미의존.
 *
 * 검증 항목:
 *  T1  create/join, updateUsers, currentRoomInfo 마스킹(C-20)
 *  T2  winSlot 모든 탭 동일(시작부터 공개)
 *  T3  숨김 막대기 가시성 — A가 3개 그리면 A는 myRungs 3, B는 publicRungs에서 A owner 1개만
 *  T4  6택1 pick — 유효/무효 top 게이트
 *  T5  reveal payload — server-only(landings/mutationScript/initialRungs) 존재 + landings 전단사
 *  T6  발표 loser ≡ landings winSlot 착지 (단일 소스 불변, N회 반복 불일치 0)
 *  T7  토너먼트 — 전원 같은 top(degenerate) → sub-round 수렴(무한루프 없음, 정확히 1 최종 꼴등)
 *  T8  재진입 마스킹(C-20) — revealing 중 새 탭 currentRoomInfo에 server-only 부재
 *  T9  phase 게이트 — 시작 후 재start 거부, idle 아닐 때 pickTop 거부
 *  T10 3경로 정리 일부 — idle에서 leaveRoom 시 그 유저 top/색 정리(rungsUpdated 반영)
 *
 * 사용법: PORT=5199 node AutoTest/qa-ladder-pick-elimination-test.js
 *   (신 코드 테스트 인스턴스 포트 지정. 미지정 시 config PORT.)
 */
const { io } = require('socket.io-client');
const path = require('path');
let PORT = process.env.PORT;
if (!PORT) { try { PORT = require(path.join(__dirname, '..', 'config', 'index.js')).PORT; } catch (_) { PORT = 5173; } }
const URL = `http://127.0.0.1:${PORT}`;

const R = { pass: 0, fail: 0, errors: [] };
function pass(m) { R.pass++; console.log(`  PASS ${m}`); }
function fail(m, d) { R.fail++; R.errors.push(m + (d ? ' — ' + d : '')); console.log(`  FAIL ${m}${d ? ' — ' + d : ''}`); }
function info(m) { console.log(`  .... ${m}`); }

function connect() {
    return new Promise((ok, no) => {
        const s = io(URL, { transports: ['websocket'], reconnection: false, timeout: 8000 });
        s.on('connect', () => ok(s));
        s.on('connect_error', e => no(e));
        setTimeout(() => no(new Error('connect timeout')), 9000);
    });
}
function once(s, ev, ms = 10000) {
    return new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        s.once(ev, d => { clearTimeout(t); ok(d); });
    });
}
// predicate 매칭(broadcast stale 회피 — ladder lesson 2026-07-01)
function waitForMatch(s, ev, pred, ms = 10000) {
    return new Promise((ok, no) => {
        const t = setTimeout(() => { s.off(ev, h); no(new Error(`timeout:${ev}(pred)`)); }, ms);
        function h(d) { if (pred(d)) { clearTimeout(t); s.off(ev, h); ok(d); } }
        s.on(ev, h);
    });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// physical descent 로컬 재현 — reveal payload가 전단사인지, loser가 winSlot 착지와 일치하는지 검증용.
function isBijection(map) {
    const seen = new Set();
    for (const v of map) { if (seen.has(v)) return false; seen.add(v); }
    return true;
}

async function makeRoom(host, tag) {
    const createdP = once(host, 'roomCreated', 8000);
    host.emit('createRoom', {
        userName: `H_${tag}`, roomName: `ladq-${tag}`, isPrivate: false, password: '',
        gameType: 'ladder', expiryHours: 1, blockIPPerUser: false,
        deviceId: `dev_h_${tag}`, tabId: `tab_h_${tag}`
    });
    return createdP;
}
async function joinRoom(guest, roomId, tag) {
    const joinedP = once(guest, 'roomJoined', 8000);
    guest.emit('joinRoom', { roomId, userName: `G_${tag}`, deviceId: `dev_g_${tag}`, tabId: `tab_g_${tag}` });
    return joinedP;
}

async function main() {
    console.log(`\n=== QA ladder pick-elimination @ ${URL} ===\n`);

    // ───────────── T1~T5: 기본 플로우 ─────────────
    console.log('── T1~T5 기본 플로우 ──');
    const host = await connect();
    const guest = await connect();
    // rungsUpdated는 roomCreated 직후 즉시 브로드캐스트되므로(rooms.js:606), createRoom emit 전에
    // 캡처 리스너를 걸어 레이스를 방지한다(once로 나중에 걸면 첫 브로드캐스트를 놓칠 수 있음).
    let hostFirstRU = null;
    host.on('ladder:rungsUpdated', d => { if (!hostFirstRU) hostFirstRU = d; });
    let created;
    try {
        created = await makeRoom(host, 'basic');
        pass(`T1 createRoom → roomCreated (roomId=${created.roomId}, gameType=${created.gameType || 'ladder'})`);
    } catch (e) { fail('T1 방 생성 실패', e.message); return finish([host, guest]); }
    const roomId = created.roomId;

    // 방 생성 직후 base/winSlot 브로드캐스트(rooms.js:606). 캡처분 우선, 없으면 대기.
    await sleep(300);
    const hostRU0 = hostFirstRU || await once(host, 'ladder:rungsUpdated', 4000).catch(() => null);
    if (hostRU0 && typeof hostRU0.winSlot === 'number' && hostRU0.winSlot >= 0 && hostRU0.winSlot < hostRU0.numColumns) {
        pass(`T2a winSlot 브로드캐스트(=${hostRU0.winSlot}), numColumns=${hostRU0.numColumns}`);
        if (hostRU0.numColumns !== 6) fail('T2a numColumns != 6', String(hostRU0.numColumns));
    } else fail('T2a 방 생성 후 winSlot 미수신');

    // guest join
    const guestRU0P = once(guest, 'ladder:rungsUpdated', 6000).catch(() => null);
    try { await joinRoom(guest, roomId, 'basic'); pass('T1 guest join → roomJoined'); }
    catch (e) { fail('T1 guest join 실패', e.message); }
    const guestRU0 = await guestRU0P;
    if (guestRU0 && hostRU0 && guestRU0.winSlot === hostRU0.winSlot) pass(`T2 winSlot 두 탭 동일(=${guestRU0.winSlot})`);
    else fail('T2 winSlot 두 탭 불일치', `host=${hostRU0 && hostRU0.winSlot} guest=${guestRU0 && guestRU0.winSlot}`);

    // T3 숨김 막대기 가시성 — host가 막대기 3개, guest는 rungsUpdated publicRungs에서 host owner 1개만.
    // host 본인 myRungs는 3개. (리스너를 addRung 이전에 등록해야 broadcast를 놓치지 않음.)
    let hostMyRungs = null;
    host.on('ladder:myRungs', d => { if (d.owner === 'H_basic') hostMyRungs = d.rungs; });
    // guest가 host owner public을 몇 개 보는지 — 마지막 수신 payload를 계속 갱신(broadcast 여러 번).
    let guestLastRU = null;
    guest.on('ladder:rungsUpdated', d => { guestLastRU = d; });
    for (let i = 0; i < 3; i++) {
        host.emit('ladder:addRung', { c: i, y: 0.2 + i * 0.2, slant: 0, points: [{ x: 0, y: 0.2 + i * 0.2 }, { x: 1, y: 0.2 + i * 0.2 }] });
        await sleep(150);
    }
    await sleep(600);
    // guest 쪽 host owner의 public rung 카운트 — public은 드로어당 정확히 1개여야(막대기 3개라도).
    const guestRU1 = (guestLastRU && (guestLastRU.publicRungs || []).some(r => r.owner === 'H_basic'))
        ? guestLastRU
        : await waitForMatch(guest, 'ladder:rungsUpdated',
            d => (d.publicRungs || []).filter(r => r.owner === 'H_basic').length >= 1, 4000).catch(() => guestLastRU);
    const hostPublicSeenByGuest = guestRU1 ? (guestRU1.publicRungs || []).filter(r => r.owner === 'H_basic').length : -1;
    if (hostMyRungs && hostMyRungs.length === 3) pass(`T3 drawer(host) 본인 막대기 3개 수신(myRungs)`);
    else fail('T3 host myRungs != 3', `got=${hostMyRungs && hostMyRungs.length}`);
    if (hostPublicSeenByGuest === 1) pass('T3 다른 탭(guest)엔 host 막대기 public 1개만 노출 (핵심 가시성)');
    else fail('T3 guest가 본 host public rung 수 != 1', `got=${hostPublicSeenByGuest}`);
    // guest rungsUpdated payload에 server-only 필드 부재
    if (guestRU1 && guestRU1.landings === undefined && guestRU1.mutationScript === undefined && guestRU1.initialRungs === undefined) {
        pass('T3 rungsUpdated에 landings/mutationScript/initialRungs 부재(누출 없음)');
    } else fail('T3 rungsUpdated가 server-only 필드 포함', JSON.stringify(Object.keys(guestRU1 || {})));

    // T4 pick — 무효 top 거부
    const errP = once(host, 'ladder:error', 3000).catch(() => null);
    host.emit('ladder:pickTop', { top: 9 });
    const err = await errP;
    if (err) pass(`T4 무효 top(9) 거부: "${err}"`);
    else fail('T4 무효 top이 거부되지 않음');

    // 유효 pick — host top0, guest top1. (주의: create/join 시 서버가 자동 ready 처리 →
    //  toggleReady를 호출하면 오히려 준비 취소가 되어 readyCount<2로 start가 거부된다. 호출하지 않는다.)
    host.emit('ladder:pickTop', { top: 0 });
    guest.emit('ladder:pickTop', { top: 1 });
    await sleep(300);

    // T5 start → reveal
    const revealP = once(host, 'ladder:reveal', 6000);
    host.emit('ladder:start');
    let reveal;
    try { reveal = await revealP; pass('T5 start → reveal 수신'); }
    catch (e) { fail('T5 reveal 미수신', e.message); return finish([host, guest]); }

    // reveal payload 검증
    const okServerOnly = Array.isArray(reveal.landings) && Array.isArray(reveal.mutationScript) && Array.isArray(reveal.initialRungs);
    if (okServerOnly) pass('T5 reveal에 landings/mutationScript/initialRungs 존재(연출 replay 재료)');
    else fail('T5 reveal server-only 필드 누락', JSON.stringify(Object.keys(reveal)));
    if (Array.isArray(reveal.landings) && reveal.landings.length === reveal.numColumns && isBijection(reveal.landings))
        pass(`T5 landings 전단사(len=${reveal.landings.length}) landings=[${reveal.landings.join(',')}]`);
    else fail('T5 landings 비전단사', JSON.stringify(reveal.landings));
    if (typeof reveal.winSlot === 'number') info(`T5 reveal winSlot=${reveal.winSlot}, loserTop=[${(reveal.loserTop || []).join(',')}]`);

    // gameEnd(연출 종료 후) — loser pool
    const gameEndP = once(host, 'ladder:gameEnd', 60000);
    let gameEnd;
    try { gameEnd = await gameEndP; }
    catch (e) { fail('T5 gameEnd 미수신(연출 타임아웃)', e.message); return finish([host, guest]); }
    pass(`T5 gameEnd 수신 loserPool=[${(gameEnd.loserPool || []).join(',')}] finished=${gameEnd.finished}`);

    // T6 발표 loser ≡ landings winSlot 착지 (단일 소스)
    // winSlot에 떨어지는 top = landings.indexOf(winSlot). 그 top을 고른 참가자가 loser여야.
    const winTop = reveal.landings.indexOf(reveal.winSlot);
    const userTops = reveal.userTops || {};
    // 참가자 중 top==winTop 인 사람들
    const expectLosers = Object.keys(userTops).filter(n => userTops[n] === winTop).sort();
    const actualLosers = (gameEnd.loserPool || []).slice().sort();
    if (JSON.stringify(expectLosers) === JSON.stringify(actualLosers) && actualLosers.length >= 1) {
        pass(`T6 발표 loser ≡ landings winSlot(${reveal.winSlot}) 착지 top(${winTop}) 일치: [${actualLosers.join(',')}]`);
    } else {
        fail('T6 발표 loser ≠ winSlot 착지', `expect=[${expectLosers.join(',')}] actual=[${actualLosers.join(',')}] winTop=${winTop}`);
    }

    finish([host, guest]);
    await sleep(300);

    // ───────────── T6b: 단일 소스 반복 검증 (다른 pick 조합, N회) ─────────────
    console.log('\n── T6b 단일 소스 반복 (loser ≡ 착지) N=6 ──');
    let mism = 0, rounds = 0;
    for (let r = 0; r < 6; r++) {
        const h = await connect(); const g1 = await connect(); const g2 = await connect();
        try {
            const cr = await makeRoom(h, `rep${r}`);
            const rid = cr.roomId;
            await once(h, 'ladder:rungsUpdated', 3000).catch(() => null);
            await joinRoom(g1, rid, `rep${r}a`);
            await joinRoom(g2, rid, `rep${r}b`);
            await sleep(200);
            // 서로 다른 top 분산: 0,1,2 회전 + 막대기 각자 2개
            const picks = [(r) % 6, (r + 2) % 6, (r + 4) % 6];
            [[h, 'H_rep' + r, picks[0]], [g1, 'G_rep' + r + 'a', picks[1]], [g2, 'G_rep' + r + 'b', picks[2]]]
                .forEach(([sock, , top], idx) => {
                    for (let k = 0; k < 2; k++) sock.emit('ladder:addRung', { c: (idx + k) % 5, y: 0.15 + k * 0.3 + idx * 0.05, slant: 0, points: [{ x: 0, y: 0.15 + k * 0.3 }, { x: 1, y: 0.15 + k * 0.3 }] });
                    sock.emit('ladder:pickTop', { top });
                });
            await sleep(300);
            // 자동 ready — toggleReady 호출 금지(취소가 됨).
            const rv = once(h, 'ladder:reveal', 6000);
            h.emit('ladder:start');
            const reveal2 = await rv;
            const ge = await once(h, 'ladder:gameEnd', 90000);
            const wTop = reveal2.landings.indexOf(reveal2.winSlot);
            const uts = reveal2.userTops || {};
            const exp = Object.keys(uts).filter(n => uts[n] === wTop).sort();
            const act = (ge.loserPool || []).slice().sort();
            rounds++;
            if (JSON.stringify(exp) !== JSON.stringify(act)) {
                mism++;
                info(`  round ${r}: MISMATCH winSlot=${reveal2.winSlot} winTop=${wTop} exp=[${exp}] act=[${act}] bij=${isBijection(reveal2.landings)}`);
            }
        } catch (e) { info(`  round ${r} 예외: ${e.message}`); }
        finish([h, g1, g2]); await sleep(200);
    }
    if (mism === 0 && rounds > 0) pass(`T6b 단일 소스 불일치 0/${rounds}회 (발표 loser ≡ 착지 항상 일치)`);
    else fail(`T6b 단일 소스 불일치 ${mism}/${rounds}회`);

    // ───────────── T7: 토너먼트 수렴 (degenerate: 전원 같은 top) ─────────────
    console.log('\n── T7 토너먼트 수렴 (전원 같은 top → sub-round) ──');
    {
        const h = await connect(); const g1 = await connect(); const g2 = await connect(); const g3 = await connect();
        try {
            const cr = await makeRoom(h, 'tour');
            const rid = cr.roomId;
            await once(h, 'ladder:rungsUpdated', 3000).catch(() => null);
            await joinRoom(g1, rid, 'toura');
            await joinRoom(g2, rid, 'tourb');
            await joinRoom(g3, rid, 'tourc');
            await sleep(250);
            const socks = [h, g1, g2, g3];
            // 전원 top 0 → 모두 같은 운명 → 반드시 sub-round(shrink)로 수렴해야.
            socks.forEach(s => s.emit('ladder:pickTop', { top: 0 }));
            await sleep(300);
            // 자동 ready — toggleReady 호출 금지.

            let finalLoser = null, subRounds = 0;
            const tEndP = once(h, 'ladder:tournamentEnd', 240000);
            // sub-round 진행 자동화: tournamentRound 오면 loserPool만 재pick + host가 재start.
            const nameToSock = { 'H_tour': h, 'G_toura': g1, 'G_tourb': g2, 'G_tourc': g3 };
            h.on('ladder:tournamentRound', async (tr) => {
                subRounds++;
                info(`  sub-round ${tr.round} loserPool=[${(tr.loserPool || []).join(',')}]`);
                // loserPool에 있는 소켓만 재pick. (서버가 readyUsers를 풀로 재설정함 — 자동 ready.)
                const pool = tr.loserPool || [];
                await sleep(300);
                pool.forEach(n => { const s = nameToSock[n]; if (s) s.emit('ladder:pickTop', { top: 0 }); });
                await sleep(300);
                // host(H_tour)는 풀에서 빠져도(생존) 방장으로 남아 다음 sub-round를 start한다(게임마스터 패턴).
                // ladder는 host만 start 가능 — 항상 host 소켓으로 start.
                h.emit('ladder:start');
            });
            // ── 첫 라운드 시작(누락 시 tournamentRound가 영영 안 옴) ──
            h.emit('ladder:start');
            const tEnd = await tEndP;
            finalLoser = tEnd.loser;
            if (finalLoser) pass(`T7 토너먼트 수렴 — 최종 꼴등=${finalLoser} (sub-round ${subRounds}회, 무한루프 없음)`);
            else fail('T7 최종 꼴등 null(수렴 실패)');
        } catch (e) { fail('T7 토너먼트 예외/타임아웃', e.message); }
        finish([h, g1, g2, g3]); await sleep(200);
    }

    // ───────────── T8: 재진입 마스킹 (revealing 중 새 탭) ─────────────
    console.log('\n── T8 재진입 마스킹 (revealing 중 currentRoomInfo) ──');
    {
        const h = await connect(); const g1 = await connect();
        try {
            const cr = await makeRoom(h, 'mask');
            const rid = cr.roomId;
            await once(h, 'ladder:rungsUpdated', 3000).catch(() => null);
            await joinRoom(g1, rid, 'maska');
            await sleep(200);
            h.emit('ladder:pickTop', { top: 0 }); g1.emit('ladder:pickTop', { top: 3 });
            for (let i = 0; i < 2; i++) h.emit('ladder:addRung', { c: i, y: 0.3 + i * 0.2, slant: 0, points: [{ x: 0, y: 0.3 + i * 0.2 }, { x: 1, y: 0.3 + i * 0.2 }] });
            await sleep(300);
            const rv = once(h, 'ladder:reveal', 6000);
            h.emit('ladder:start');
            await rv;  // 이제 phase=revealing
            await sleep(300);
            // 재진입 마스킹 경로 = getCurrentRoom(리다이렉트/새로고침 복구). 이미 방에 있는 유저(G_maska)가
            // revealing 중 상태를 다시 요청 → currentRoomInfo(getCurrentRoom 마스킹) 수신. joinRoom이 아님.
            const criP = once(g1, 'currentRoomInfo', 6000).catch(() => null);
            g1.emit('getCurrentRoom', { roomId: rid, userName: 'G_maska', deviceId: 'dev_g_maska' });
            const cri = await criP;
            if (!cri) { fail('T8 currentRoomInfo 미수신'); }
            else {
                const ld = cri.gameState && cri.gameState.ladder;
                if (!ld) { fail('T8 currentRoomInfo.gameState.ladder 부재'); }
                else {
                    const leaked = ['rungs', 'initialRungs', 'mutationScript', 'landings', 'laneToBottom', 'erased', 'added', 'loserTop', 'publicRungByDrawer', 'roundLoserNames', 'baseRungs']
                        .filter(k => ld[k] !== undefined);
                    if (leaked.length === 0) pass(`T8 revealing 재진입 payload에 server-only 부재 (keys=${Object.keys(ld).join(',')})`);
                    else fail('T8 server-only 필드 누출', leaked.join(','));
                    if (typeof ld.phase === 'string') info(`T8 노출 phase=${ld.phase} winSlot=${ld.winSlot}`);
                }
            }
            finish([h, g1]);
        } catch (e) { fail('T8 예외', e.message); finish([h, g1]); }
        await sleep(200);
    }

    // ───────────── T9: phase 게이트 (재start 거부 / revealing 중 pickTop 거부) ─────────────
    console.log('\n── T9 phase 게이트 ──');
    {
        const h = await connect(); const g1 = await connect();
        try {
            const cr = await makeRoom(h, 'gate');
            const rid = cr.roomId;
            await once(h, 'ladder:rungsUpdated', 3000).catch(() => null);
            await joinRoom(g1, rid, 'gatea');
            await sleep(200);
            h.emit('ladder:pickTop', { top: 0 }); g1.emit('ladder:pickTop', { top: 2 });
            await sleep(300);
            const rv = once(h, 'ladder:reveal', 6000);
            h.emit('ladder:start');
            await rv;  // revealing
            await sleep(200);
            // 재start → error
            const e1 = once(h, 'ladder:error', 3000).catch(() => null);
            h.emit('ladder:start');
            const err1 = await e1;
            if (err1 && /진행 중|이미/.test(err1)) pass(`T9 revealing 중 재start 거부: "${err1}"`);
            else fail('T9 재start 거부 안됨', String(err1));
            // revealing 중 pickTop → error
            const e2 = once(g1, 'ladder:error', 3000).catch(() => null);
            g1.emit('ladder:pickTop', { top: 4 });
            const err2 = await e2;
            if (err2 && /대기 중|고를/.test(err2)) pass(`T9 revealing 중 pickTop 거부: "${err2}"`);
            else fail('T9 pickTop 거부 안됨', String(err2));
        } catch (e) { fail('T9 예외', e.message); }
        finish([h, g1]); await sleep(200);
    }

    // ───────────── T10: 3경로 정리 (idle leaveRoom) ─────────────
    console.log('\n── T10 leaveRoom 정리 (idle) ──');
    {
        const h = await connect(); const g1 = await connect();
        try {
            const cr = await makeRoom(h, 'clean');
            const rid = cr.roomId;
            await once(h, 'ladder:rungsUpdated', 3000).catch(() => null);
            await joinRoom(g1, rid, 'cleana');
            await sleep(200);
            g1.emit('ladder:pickTop', { top: 5 });
            g1.emit('ladder:addRung', { c: 0, y: 0.4, slant: 0, points: [{ x: 0, y: 0.4 }, { x: 1, y: 0.4 }] });
            // host가 g1의 top/색이 실렸는지 확인
            const before = await waitForMatch(h, 'ladder:rungsUpdated', d => d.userTops && d.userTops['G_cleana'] === 5, 4000).catch(() => null);
            if (before) info('T10 leave 전: G_cleana top=5 rungsUpdated에 존재');
            // g1 leave
            g1.emit('leaveRoom');
            const after = await waitForMatch(h, 'ladder:rungsUpdated', d => !(d.userTops && d.userTops['G_cleana'] !== undefined), 4000).catch(() => null);
            if (after) pass('T10 leaveRoom(idle) → G_cleana top/색 정리됨(유령 점유 0)');
            else fail('T10 leave 후에도 G_cleana top 잔존(유령)');
        } catch (e) { fail('T10 예외', e.message); }
        finish([h, g1]); await sleep(200);
    }

    // 결과
    console.log(`\n=== 결과: ${R.pass} PASS / ${R.fail} FAIL ===`);
    if (R.fail) { console.log('실패:'); R.errors.forEach(e => console.log('  - ' + e)); }
    process.exit(R.fail ? 1 : 0);
}

function finish(socks) { socks.forEach(s => { try { s.close(); } catch (_) {} }); }

main().catch(e => { console.error('FATAL', e); process.exit(2); });
