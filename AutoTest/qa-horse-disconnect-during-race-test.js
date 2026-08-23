/**
 * QA — 경주 중 이탈 시 베팅 유지 / horseSelectionCancelled 미전송 (트랙 렌더 정지 사고 회귀 방지)
 *
 * 배경(2026-08-23 사고): 경주 중 유저가 이탈하면 disconnect 정리(socket/chat.js)가 베팅을 지우고
 * horseSelectionCancelled를 방 전체에 broadcast → 전 클라이언트가 renderHorseSelection()을 돌려
 * 진행 중인 트랙 DOM을 선택 미리보기로 갈아엎어 **전원 렌더링 정지**. 물리/결과는 계속 진행되어
 * "뒤는 진행되는데 말만 멈춘" 증상이 된다.
 *
 * 수동 재현은 DISCONNECT_WAIT_REDIRECT(15초) 타이밍에 의존해 애매하다 —
 * 이 테스트는 소켓 직결로 그 창을 결정적으로 만든다(애니메이션 완료 신호를 우리가 쥐고 있으므로
 * pendingRaceResult가 정리 시점까지 확실히 살아 있다).
 *
 * 시나리오:
 *  S1  경주 중 이탈 → 남은 소켓이 horseSelectionCancelled를 **받지 않는다** (핵심 회귀 가드)
 *  S2  경주 중 이탈자가 결과 정산에 **포함**된다 (베팅=시작 스냅샷, 접속 여부 무관)
 *  S3  선택 단계 이탈 → 기존대로 cancelled 전송 (정상 정리 경로 회귀 확인)
 *
 * 주의: C-24 (create/join 시 자동 ready — toggleReady 불필요/금지)
 * 사용법: node AutoTest/qa-horse-disconnect-during-race-test.js   (서버 기동 필요)
 */
const { io } = require('socket.io-client');
const path = require('path');
// .env의 PORT를 config보다 먼저 로드 (미로드 시 기본 3000으로 잡혀 접속 실패)
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { PORT, DISCONNECT_WAIT_REDIRECT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = `http://127.0.0.1:${PORT}`;
const TAG = Date.now().toString(36).slice(-4);
const HOST = `QA방장_${TAG}`;
const GUEST = `QA손님_${TAG}`;
const LEAVER = `QA이탈_${TAG}`;
// 정리 타이머(15초) + 서버 처리 여유
const CLEANUP_WAIT = DISCONNECT_WAIT_REDIRECT + 3000;

const R = { pass: 0, fail: 0, errors: [] };
const pass = m => { R.pass++; console.log(`  PASS ${m}`); };
const fail = (m, d) => { R.fail++; R.errors.push(m + (d ? ' — ' + d : '')); console.log(`  FAIL ${m}${d ? ' — ' + d : ''}`); };
const info = m => console.log(`  .... ${m}`);
const section = t => console.log(`\n${'-'.repeat(64)}\n ${t}\n${'-'.repeat(64)}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect() {
    return new Promise((ok, no) => {
        const s = io(URL, { transports: ['websocket'], reconnection: false, timeout: 8000 });
        s.on('connect', () => ok(s));
        s.on('connect_error', e => no(new Error(`connect_error: ${e.message} (서버가 ${URL}에 떠 있는지 확인)`)));
        setTimeout(() => no(new Error('connect timeout')), 9000);
    });
}
function once(s, ev, ms = 15000) {
    return new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout:${ev}`)), ms);
        s.once(ev, d => { clearTimeout(t); ok(d); });
    });
}
const ids = () => ({
    deviceId: `dev_${Math.random().toString(36).slice(2, 8)}`,
    tabId: `tab_${Math.random().toString(36).slice(2, 8)}`
});

// 이 소켓이 받은 horseSelectionCancelled를 전부 수집 (경주 중엔 0건이어야 한다)
function watchCancelled(s) {
    const got = [];
    s.on('horseSelectionCancelled', d => got.push((d && d.userName) || '(이름없음)'));
    return got;
}

async function setupRoom() {
    const host = await connect();
    const guest = await connect();
    const leaver = await connect();

    const createdP = once(host, 'roomCreated', 10000).catch(() => null);
    const hostReadyP = once(host, 'horseSelectionReady', 12000);
    host.emit('createRoom', {
        userName: HOST, roomName: `qa-disc-${TAG}`, isPrivate: false, password: '',
        gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false,
        serverId: null, serverName: null, ...ids()
    });
    const created = await Promise.race([createdP, once(host, 'roomJoined', 10000)]);
    const roomId = (created && (created.roomId || (created.room && created.room.roomId)));
    if (!roomId) throw new Error('roomId를 얻지 못함: ' + JSON.stringify(created).slice(0, 200));

    for (const [s, name] of [[guest, GUEST], [leaver, LEAVER]]) {
        const jp = once(s, 'roomJoined', 10000);
        s.emit('joinRoom', { roomId, userName: name, isHost: false, password: '', ...ids() });
        await jp;
    }
    const sel = await hostReadyP;
    const horses = sel.availableHorses || [];
    if (horses.length < 2) throw new Error('availableHorses 부족: ' + JSON.stringify(horses));
    return { host, guest, leaver, roomId, horses };
}

async function main() {
    console.log(`=== QA 경주 중 이탈 — 베팅 유지 / cancelled 미전송 (${URL}) ===`);
    console.log(`  정리 대기: ${DISCONNECT_WAIT_REDIRECT}ms (transport close) → 관찰 ${CLEANUP_WAIT}ms\n`);

    // ─────────────────────────────────────────────────────────────
    section('S1/S2. 경주 중 이탈 — cancelled 미전송 + 결과 정산 포함');
    {
        const { host, guest, leaver, horses } = await setupRoom();
        try {
            // 서로 다른 말에 베팅 (allSameBet 경로 회피)
            host.emit('selectHorse', { horseIndex: horses[0] });
            await sleep(250);
            guest.emit('selectHorse', { horseIndex: horses[0] });
            await sleep(250);
            leaver.emit('selectHorse', { horseIndex: horses[1] });
            await sleep(400);
            info(`베팅 완료 — ${HOST}/${GUEST}→말${horses[0]}, ${LEAVER}→말${horses[1]}`);

            const startedH = once(host, 'horseRaceStarted', 25000);
            const startedG = once(guest, 'horseRaceStarted', 25000);
            host.emit('startHorseRace');
            const raceData = await startedH;
            await startedG;
            const betsAtStart = raceData.userHorseBets || {};
            info(`경주 시작 — 시작 스냅샷 베팅자: ${Object.keys(betsAtStart).join(', ')}`);
            if (betsAtStart[LEAVER] !== undefined) pass('시작 스냅샷에 이탈 예정자의 베팅이 포함됨');
            else fail('시작 스냅샷에 이탈자 베팅 없음', JSON.stringify(betsAtStart));

            // 경주가 도는 동안(= pendingRaceResult 생존) 이탈시킨다.
            // raceAnimationComplete를 아직 안 보냈으므로 정리 시점에도 결과는 미소비 상태다.
            const seenHost = watchCancelled(host);
            const seenGuest = watchCancelled(guest);
            leaver.disconnect();
            info(`${LEAVER} 연결 해제 — 정리 타이머 발화까지 ${CLEANUP_WAIT}ms 대기`);

            await sleep(CLEANUP_WAIT);

            // ── S1 핵심 단언 ──
            if (seenHost.length === 0 && seenGuest.length === 0) {
                pass('경주 중 horseSelectionCancelled 0건 (트랙 렌더 보호 — 게이트 동작)');
            } else {
                fail('경주 중 horseSelectionCancelled 수신됨 → 전원 트랙 정지 회귀',
                    `host=[${seenHost}] guest=[${seenGuest}]`);
            }

            // ── S2: 결과 정산에 이탈자 포함 ──
            const endedP = once(host, 'horseRaceEnded', 20000).catch(e => ({ __timeout: e.message }));
            const msgs = [];
            host.on('newMessage', m => { if (m && m.message) msgs.push(m.message); });
            host.emit('raceAnimationComplete');
            const ended = await endedP;

            if (ended && ended.__timeout) {
                fail('horseRaceEnded 미수신', ended.__timeout);
            } else {
                const hist = (ended.horseRaceHistory || []).slice(-1)[0] || {};
                const recBets = hist.userHorseBets || {};
                if (recBets[LEAVER] !== undefined) pass('경주 기록(userHorseBets)에 이탈자 보존');
                else fail('경주 기록에서 이탈자 베팅 소실', JSON.stringify(recBets));

                const players = hist.players || [];
                if (players.includes(LEAVER)) pass('경주 기록 참가자 명단에 이탈자 포함');
                else fail('참가자 명단에서 이탈자 제외됨', JSON.stringify(players));

                const winners = hist.winners || [];
                info(`당첨자: ${winners.length ? winners.join(', ') : '(없음)'} / finalWinner=${ended.finalWinner || '-'}`);
                if (winners.includes(LEAVER)) {
                    pass('이탈자가 당첨자로 정산됨 (접속 무관 참가 — 강한 케이스)');
                } else {
                    info('이번 판은 이탈자가 당첨이 아님 — 정산 포함 여부는 위 두 단언으로 확인됨');
                }
            }
        } finally {
            host.disconnect(); guest.disconnect();
            try { leaver.disconnect(); } catch (e) {}
        }
    }

    // ─────────────────────────────────────────────────────────────
    section('S3. 선택 단계 이탈 — 기존 정리 경로 유지 (회귀 확인)');
    {
        const { host, guest, leaver } = await setupRoom();
        try {
            const sel = await once(host, 'horseSelectionUpdated', 8000).catch(() => null);
            const seenHost = watchCancelled(host);
            leaver.emit('selectHorse', { horseIndex: 0 });
            await sleep(500);

            leaver.disconnect();
            info(`${LEAVER} 선택 단계에서 연결 해제 — ${CLEANUP_WAIT}ms 대기`);
            await sleep(CLEANUP_WAIT);

            if (seenHost.includes(LEAVER)) {
                pass('선택 단계 이탈은 기존대로 cancelled 전송 (정리 경로 정상)');
            } else {
                fail('선택 단계 이탈에도 cancelled 미전송 — 유령 베팅으로 시작 게이트가 막힐 수 있음',
                    `수신=[${seenHost}]`);
            }
        } finally {
            host.disconnect(); guest.disconnect();
            try { leaver.disconnect(); } catch (e) {}
        }
    }

    // ─────────────────────────────────────────────────────────────
    console.log(`\n${'='.repeat(64)}`);
    console.log(` 결과: PASS ${R.pass} / FAIL ${R.fail}`);
    if (R.errors.length) {
        console.log(' 실패 항목:');
        R.errors.forEach(e => console.log(`   - ${e}`));
    }
    console.log(`${'='.repeat(64)}`);
    console.log('\n서버 터미널에서 다음 줄을 함께 확인하세요 (정리가 실제로 실행됐다는 증거):');
    console.log(`  [경마][이탈정리] ${LEAVER} — 경주중=true ... → 베팅/투표 유지 + cancelled 미전송 (게이트 발동)`);
    process.exit(R.fail > 0 ? 1 : 0);
}

main().catch(e => {
    console.error('\n테스트 실행 실패:', e.message);
    process.exit(1);
});
