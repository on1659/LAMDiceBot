/**
 * Horse Race — 신규 아이템(item_rocket/item_ice) E2E 테스트
 *
 * Phase A (--phase=parity, 순정 config):
 *   1. 2탭 (호스트+게스트) 레이스 1회
 *   2. 서버 horseRankings = 호스트 시각 순위 = 게스트 시각 순위
 *
 * Phase B (--phase=items, config에서 item_rocket/item_ice probability 상향 후 서버 재기동 상태):
 *   1. 레이스 중 MutationObserver로 기믹 이펙트 DOM 캡처
 *      - .gimmick-effect-item-rocket: 🚀✨ + 부모 filter brightness(1.6) + .speed-lines
 *      - .gimmick-effect-item-ice: ❄️ + 부모 .rest + iceShiver 애니메이션
 *   2. 레이스 종료 후 클린업 확인 (이펙트 제거 / filter·animation 클리어 / rest 복귀)
 *   3. 다시보기 1회 — 같은 말(horse_N)에서 같은 타입 이펙트 재현 (replay parity)
 *   4. 2탭 순위 일치 재확인 (신규 기믹 활성 상태의 sim/클라 패리티)
 *
 * Usage:
 *   node AutoTest/horse-race/test-new-items-e2e.js --phase=parity
 *   node AutoTest/horse-race/test-new-items-e2e.js --phase=items
 */

const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL   = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const PHASE = process.argv.find(a => a.startsWith('--phase='))?.split('=')[1] || 'parity';
const PAGE  = `${URL}/horse-race-multiplayer.html?createRoom=true`;

const R = { pass: 0, fail: 0, errors: [] };
function pass(msg)      { R.pass++; console.log(`  ✅ ${msg}`); }
function fail(msg, det) { R.fail++; R.errors.push(msg + (det ? ` (${det})` : '')); console.log(`  ❌ ${msg}${det ? ' — ' + det : ''}`); }
function info(msg)      { console.log(`  ℹ️  ${msg}`); }
function section(t)     { console.log(`\n${'─'.repeat(60)}\n ${t}\n${'─'.repeat(60)}`); }

async function waitEvent(page, event, timeoutMs = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout: ${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeoutMs });
}

async function loadPage(page, name) {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, null, { timeout: 15000 });
}

async function createRoom(page, userName) {
    return page.evaluate((u) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('createRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('createRoom', {
            userName: u, roomName: 'ItemTest' + Date.now(),
            isPrivate: false, password: '', gameType: 'horse-race', expiryHours: 1,
            blockIPPerUser: false, deviceId: 'test-' + Math.random().toString(36).slice(2),
            serverId: null, serverName: null, tabId: 'test-' + Math.random().toString(36).slice(2)
        });
    }), userName);
}

async function joinRoom(page, roomId, userName) {
    return page.evaluate(({ id, u }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('joinRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('joinRoom', {
            roomId: id, userName: u, isHost: false, password: '',
            deviceId: 'test-' + Math.random().toString(36).slice(2),
            tabId: 'test-' + Math.random().toString(36).slice(2)
        });
    }), { id: roomId, u: userName });
}

// MutationObserver 설치 — 기믹 이펙트 추가/제거 캡처 (phase: 'live' | 'replay')
async function installObserver(page, phaseLabel) {
    await page.evaluate((ph) => {
        if (!window._fxLog) window._fxLog = [];
        if (window._fxObserver) window._fxObserver.disconnect();
        window._fxPhase = ph;
        const CLASSES = ['gimmick-effect-item-rocket', 'gimmick-effect-item-ice'];
        window._fxObserver = new MutationObserver(muts => {
            muts.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    const cls = CLASSES.find(c => node.classList && node.classList.contains(c));
                    if (!cls) return;
                    const horse = node.parentElement;
                    window._fxLog.push({
                        phase: window._fxPhase,
                        kind: 'added',
                        cls,
                        text: node.textContent,
                        horseId: horse ? horse.id : null,
                        parentFilter: horse ? horse.style.filter : null,
                        parentAnimation: horse ? horse.style.animation : null,
                        parentRest: horse ? horse.classList.contains('rest') : null,
                        hasSpeedLines: horse ? !!horse.querySelector('.speed-lines') : null,
                        t: Date.now()
                    });
                });
                m.removedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    const cls = CLASSES.find(c => node.classList && node.classList.contains(c));
                    if (!cls) return;
                    const horse = m.target;
                    window._fxLog.push({
                        phase: window._fxPhase,
                        kind: 'removed',
                        cls,
                        horseId: horse && horse.id ? horse.id : null,
                        parentFilter: horse ? horse.style.filter : null,
                        parentAnimation: horse ? horse.style.animation : null,
                        parentRest: horse && horse.classList ? horse.classList.contains('rest') : null,
                        t: Date.now()
                    });
                });
            });
        });
        window._fxObserver.observe(document.body, { childList: true, subtree: true });
    }, phaseLabel);
}

async function runOneRace(h, g) {
    const allSel = waitEvent(h, 'allHorsesSelected', 15000);
    await h.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
    await g.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
    await allSel;

    await h.evaluate(() => { window.lastActualFinishOrder = null; });
    await g.evaluate(() => { window.lastActualFinishOrder = null; });

    const started      = waitEvent(h, 'horseRaceStarted', 30000);
    const guestStarted = waitEvent(g, 'horseRaceStarted', 30000);
    await h.waitForTimeout(200);
    await h.evaluate(() => socket.emit('startHorseRace'));
    const [raceData] = await Promise.all([started, guestStarted]);

    // 두 탭 애니메이션 완료 대기
    const finishOf = (p) => p.waitForFunction(
        () => Array.isArray(window.lastActualFinishOrder) && window.lastActualFinishOrder.length > 0,
        null,
        { timeout: 120000 }
    ).then(() => p.evaluate(() => window.lastActualFinishOrder));
    const [hostFinish, guestFinish] = await Promise.all([finishOf(h), finishOf(g)]);

    return { raceData, hostFinish, guestFinish };
}

function checkParity(raceData, hostFinish, guestFinish) {
    const server = raceData.horseRankings;
    info(`서버 선언 순위:   [${server}]`);
    info(`호스트 시각 순위: [${hostFinish}]`);
    info(`게스트 시각 순위: [${guestFinish}]`);
    hostFinish.every((v, i) => v === guestFinish[i])
        ? pass('두 탭 시각 결승 순서 동일')
        : fail('두 탭 시각 결승 순서 불일치', `h=[${hostFinish}] g=[${guestFinish}]`);
    server.every((v, i) => v === hostFinish[i])
        ? pass('시각 순서 = 서버 선언 순위')
        : fail('시각 순서 ≠ 서버 선언 순위', `server=[${server}] visual=[${hostFinish}]`);
}

async function run() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(` Horse Race 신규 아이템 E2E — phase=${PHASE}`);
    console.log(` 서버: ${URL}`);
    console.log('='.repeat(60));

    const browser = await chromium.launch({ headless: true });
    try {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const h = await ctx1.newPage();
        const g = await ctx2.newPage();

        await loadPage(h, 'ItemHost');
        await loadPage(g, 'ItemGuest');

        const roomData = await createRoom(h, 'ItemHost');
        info(`방 생성: ${roomData.roomId}`);
        await joinRoom(g, roomData.roomId, 'ItemGuest');
        await h.waitForTimeout(800);

        if (PHASE === 'parity') {
            section('Phase A — 2탭 순위 일치 (순정 config)');
            const { raceData, hostFinish, guestFinish } = await runOneRace(h, g);
            checkParity(raceData, hostFinish, guestFinish);
        } else {
            section('Phase B — 신규 아이템 비주얼 + 클린업 + 리플레이 패리티');

            // 게임 종료/준비 목록 추적 리스너
            for (const p of [h, g]) {
                await p.evaluate(() => {
                    window._gameEnded = null;
                    socket.on('horseRaceEnded', d => { window._gameEnded = d; });
                    window._readyList = null;
                    socket.on('readyUsersUpdated', list => { window._readyList = list; });
                    window._hrErrors = [];
                    ['horseRaceError', 'readyError', 'roomError'].forEach(ev =>
                        socket.on(ev, m => window._hrErrors.push(ev + ': ' + JSON.stringify(m))));
                });
            }

            // 라운드 반복: 단독 당첨(게임 종료)이 나올 때까지 (최대 6라운드)
            // — 당첨자 없으면 서버가 자동 준비 후 다음 라운드 진행 (실제 게임 규칙)
            const allRocket = [], allIce = [];
            let lastLiveRocket = [], lastLiveIce = [], gameEnded = null;
            const MAX_ROUNDS = 6;

            for (let round = 1; round <= MAX_ROUNDS; round++) {
                if (round > 1) {
                    // 무당첨 라운드 후: 서버가 최상위 베팅자만 자동 준비 → 나머지는 직접 ready
                    await h.waitForTimeout(2500); // 자동 준비 브로드캐스트 안착
                    for (const [p, name] of [[h, 'ItemHost'], [g, 'ItemGuest']]) {
                        await p.evaluate((n) => {
                            const list = window._readyList || [];
                            if (!list.includes(n)) socket.emit('toggleReady');
                        }, name);
                    }
                    await h.waitForTimeout(800);
                    const readyNow = await h.evaluate(() => window._readyList);
                    info(`[R${round}] 준비 목록: [${readyNow}]`);
                }

                await h.evaluate(() => { window._fxLog = []; window._gameEnded = null; });
                await installObserver(h, 'live');

                const { raceData, hostFinish, guestFinish } = await runOneRace(h, g);

                const expected = { rocket: [], ice: [] };
                const unbetted = new Set();
                Object.entries(raceData.gimmicks || {}).forEach(([hi, arr]) => {
                    (arr || []).forEach(gm => {
                        if (gm.type === 'item_rocket') expected.rocket.push(`horse_${hi}`);
                        if (gm.type === 'item_ice') expected.ice.push(`horse_${hi}`);
                        if (gm.type === 'unbetted_stop') unbetted.add(`horse_${hi}`);
                    });
                });
                info(`[R${round}] 서버 생성 rocket=${expected.rocket.length} [${expected.rocket}] / ice=${expected.ice.length} [${expected.ice}] / 미베팅 rest 유지=[${[...unbetted]}]`);

                checkParity(raceData, hostFinish, guestFinish);

                await h.waitForTimeout(1500); // 클린업 안착

                const liveLog = await h.evaluate(() => window._fxLog.filter(x => x.phase === 'live'));
                lastLiveRocket = liveLog.filter(x => x.kind === 'added' && x.cls === 'gimmick-effect-item-rocket');
                lastLiveIce    = liveLog.filter(x => x.kind === 'added' && x.cls === 'gimmick-effect-item-ice');
                allRocket.push(...lastLiveRocket);
                allIce.push(...lastLiveIce);

                // ── 클린업 (레이스 종료 후 DOM) — 미베팅 말은 rest 유지가 설계 (unbetted_stop) ──
                const cleanup = await h.evaluate(() => {
                    const horses = [...document.querySelectorAll('[id^="horse_"]')].filter(el => !el.id.includes('preview'));
                    return {
                        remainingFx: document.querySelectorAll('.gimmick-effect-item-rocket, .gimmick-effect-item-ice').length,
                        remainingSpeedLines: document.querySelectorAll('.speed-lines').length,
                        horsesWithFilter: horses.filter(el => el.style.filter && (el.style.filter.includes('brightness(1.6)') || el.style.filter.includes('saturate(0.2)'))).map(el => el.id),
                        horsesWithShiver: horses.filter(el => el.style.animation && el.style.animation.includes('iceShiver')).map(el => el.id),
                        restHorses: horses.filter(el => el.classList.contains('rest')).map(el => el.id)
                    };
                });
                const badRest = cleanup.restHorses.filter(id => !unbetted.has(id));
                cleanup.remainingFx === 0 ? pass(`[R${round}] 종료 후 이펙트 요소 0개`) : fail(`[R${round}] 종료 후 이펙트 요소 잔존`, `${cleanup.remainingFx}개`);
                cleanup.remainingSpeedLines === 0 ? pass(`[R${round}] 종료 후 speed-lines 0개`) : fail(`[R${round}] speed-lines 잔존`, `${cleanup.remainingSpeedLines}개`);
                cleanup.horsesWithFilter.length === 0 ? pass(`[R${round}] 신규 아이템 filter 클리어`) : fail(`[R${round}] filter 잔존`, JSON.stringify(cleanup.horsesWithFilter));
                cleanup.horsesWithShiver.length === 0 ? pass(`[R${round}] iceShiver 클리어`) : fail(`[R${round}] iceShiver 잔존`, JSON.stringify(cleanup.horsesWithShiver));
                badRest.length === 0 ? pass(`[R${round}] 베팅 말 rest 복귀 (미베팅 rest 유지=설계)`) : fail(`[R${round}] 베팅 말 rest 잔존`, JSON.stringify(badRest));

                // 게임 종료 여부 (단독 당첨) — raceAnimationComplete → 서버 처리 → horseRaceEnded 대기
                await h.waitForFunction(() => window._gameEnded !== null, null, { timeout: 25000 }).catch(() => {});
                gameEnded = await h.evaluate(() => window._gameEnded);
                if (gameEnded && gameEnded.finalWinner) {
                    info(`[R${round}] 단독 당첨(${gameEnded.finalWinner}) — 게임 종료, 다시보기 검증으로 진행`);
                    break;
                }
                info(`[R${round}] 당첨자 없음 — 다음 라운드 자동 진행`);
            }

            // ── 누적 비주얼 검증 ──
            section('신규 아이템 비주얼 (전 라운드 누적)');
            if (allRocket.length > 0) {
                pass(`item_rocket 이펙트 등장 ${allRocket.length}회 [${allRocket.map(x => x.horseId)}]`);
                allRocket.every(x => x.text === '🚀✨')
                    ? pass('로켓 textContent 🚀✨') : fail('로켓 textContent 불일치', JSON.stringify(allRocket.map(x => x.text)));
                allRocket.every(x => x.parentFilter && x.parentFilter.includes('brightness(1.6)'))
                    ? pass('로켓 filter brightness(1.6) 적용') : fail('로켓 filter 미적용', JSON.stringify(allRocket.map(x => x.parentFilter)));
                allRocket.every(x => x.hasSpeedLines)
                    ? pass('로켓 .speed-lines 존재') : fail('로켓 .speed-lines 없음');
            } else {
                fail('item_rocket 이펙트 미등장 (전 라운드에서 한 번도 관측 안 됨)');
            }

            if (allIce.length > 0) {
                pass(`item_ice 이펙트 등장 ${allIce.length}회 [${allIce.map(x => x.horseId)}]`);
                allIce.every(x => x.text === '❄️')
                    ? pass('얼음 textContent ❄️') : fail('얼음 textContent 불일치', JSON.stringify(allIce.map(x => x.text)));
                allIce.every(x => x.parentRest === true)
                    ? pass('얼음 시 .rest 클래스 적용') : fail('얼음 .rest 미적용');
                allIce.every(x => x.parentAnimation && x.parentAnimation.includes('iceShiver'))
                    ? pass('얼음 iceShiver 애니메이션 적용') : fail('얼음 iceShiver 미적용', JSON.stringify(allIce.map(x => x.parentAnimation)));
                allIce.every(x => x.parentFilter && x.parentFilter.includes('saturate(0.2)'))
                    ? pass('얼음 filter saturate(0.2) 적용') : fail('얼음 filter 미적용');
            } else {
                fail('item_ice 이펙트 미등장 (전 라운드에서 한 번도 관측 안 됨)');
            }

            // ── 리플레이 패리티 (마지막 레이스 다시보기) ──
            section('다시보기 재현 검증');
            if (!gameEnded || !gameEnded.finalWinner) {
                fail(`${MAX_ROUNDS}라운드 내 단독 당첨 미발생 — 다시보기 검증 불가 (재실행 필요)`);
            } else {
                await installObserver(h, 'replay');
                await h.evaluate(() => playLastReplay());
                await h.waitForFunction(() => window.isReplayActive === true, null, { timeout: 15000 }).catch(() => {});
                const replayActive = await h.evaluate(() => window.isReplayActive);
                replayActive ? pass('다시보기 시작됨') : fail('다시보기 시작 실패');
                await h.waitForFunction(() => window.isReplayActive === false, null, { timeout: 180000 });
                await h.waitForTimeout(1000);

                const replayLog = await h.evaluate(() => window._fxLog.filter(x => x.phase === 'replay' && x.kind === 'added'));
                const sig = arr => arr.map(x => `${x.horseId}:${x.cls.replace('gimmick-effect-', '')}`).sort().join(',');
                const liveSig = sig([...lastLiveRocket, ...lastLiveIce]);
                const replaySig = sig(replayLog);
                info(`라이브(마지막 R) 시그니처: ${liveSig}`);
                info(`리플레이       시그니처: ${replaySig}`);
                liveSig === replaySig
                    ? pass('리플레이 = 라이브 동일 말·동일 타입 재현')
                    : fail('리플레이 기믹 재현 불일치', `live=[${liveSig}] replay=[${replaySig}]`);
            }
        }

        await ctx1.close();
        await ctx2.close();
    } catch (err) {
        console.error('\n💥 오류:', err.message);
        R.fail++;
        R.errors.push(err.message);
        try {
            for (const ctx of browser.contexts()) {
                for (const p of ctx.pages()) {
                    const e = await p.evaluate(() => window._hrErrors || []).catch(() => []);
                    if (e.length) console.log('  서버 에러 응답:', JSON.stringify(e));
                }
            }
        } catch {}
    } finally {
        await browser.close();
    }

    console.log(`\n${'='.repeat(60)}`);
    const total = R.pass + R.fail;
    if (R.fail === 0) console.log(` ✅ ALL PASS — ${R.pass}/${total}`);
    else {
        console.log(` ❌ FAIL — ${R.pass} passed, ${R.fail} failed`);
        R.errors.forEach(e => console.log(`    - ${e}`));
    }
    console.log('='.repeat(60));
    process.exit(R.fail === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
