/**
 * QA — 경마 트랙 Document PiP 자동화 검증 (goal: horse-race-track-pip + Amendment 3 "상시 attach")
 *
 * 개정3 수명주기: 단일 규칙 — 열면 래퍼가 PiP로 들어가고(모든 단계 유효), 닫으면(X/토글/unload) 나온다.
 * 대기 모드 폐기(레이스 종료/리셋은 창·래퍼를 건드리지 않음), #pipScaleRoot가 transform 소유,
 * 이식 UI(룰렛/투표/배너)는 placeholder 프로토콜로 래퍼를 따라 왕복, 닫기 시 루트 자식 전수 sweep.
 *
 * 헤드리스 한계: 실제 requestWindow는 사용자 제스처 + 크로뮴 창 UI 필요 → 실 PiP 창은 못 연다.
 * 3-트랙 검증:
 *   [A] 지원 환경 실측 — 버튼 상시 노출(+[PiP][카메라] flex row), 풀 레이스 무회귀 (창 미개방 경로)
 *   [B] mock PiP 창 수명주기 — createHTMLDocument 기반 가짜 창을 _racePipWin에 주입:
 *       선택 단계 즉시 attach/닫기 → 이식-선행 open 재앵커 → PiP 카운트다운 → 레이스 →
 *       종료 후 래퍼 PiP 잔류(무-teardown) → 리셋 시 이식 UI 메인 복원 → attach 중 직접 이식 →
 *       2차 레이스 연속 → X 닫기 전수 sweep
 *   [C] 미지원 경로(API 삭제 = Firefox/모바일 등가) — 버튼 미노출, toggle 무해, 헬퍼 항등
 *
 * 주의: AdSense가 localhost에서 스택 없는 "Y" pageerror를 던진다(사전 존재 확인) → 광고 도메인 차단.
 *
 * Usage: node AutoTest/qa-horse-track-pip-test.js [--headed] [--url=...]
 */

const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const PAGE = `${URL}/horse-race-multiplayer.html?createRoom=true`;

const LABEL_IDLE = '작은 창으로';
const LABEL_ATTACHED = '원래 화면으로';

const R = { pass: 0, fail: 0, errors: [] };
function pass(msg) { R.pass++; console.log(`  PASS ${msg}`); }
function fail(msg, det) { R.fail++; R.errors.push(msg + (det ? ` (${det})` : '')); console.log(`  FAIL ${msg}${det ? ' — ' + det : ''}`); }
function info(msg) { console.log(`  info ${msg}`); }
function section(t) { console.log(`\n${'-'.repeat(60)}\n ${t}\n${'-'.repeat(60)}`); }

async function waitEvent(page, event, timeoutMs = 15000) {
    return page.evaluate(({ ev, ms }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error(`timeout: ${ev}`)), ms);
        socket.once(ev, d => { clearTimeout(t); ok(d); });
    }), { ev: event, ms: timeoutMs });
}

async function createRoom(page, userName, roomName) {
    return page.evaluate(({ u, r }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('createRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('createRoom', {
            userName: u, roomName: r, isPrivate: false, password: '',
            gameType: 'horse-race', expiryHours: 1, blockIPPerUser: false,
            deviceId: 'test-device-' + Math.random().toString(36).slice(2),
            serverId: null, serverName: null,
            tabId: 'test-tab-' + Math.random().toString(36).slice(2)
        });
    }), { u: userName, r: roomName });
}

async function joinRoom(page, roomId, userName) {
    return page.evaluate(({ id, u }) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('joinRoom timeout')), 10000);
        socket.once('roomJoined', d => { clearTimeout(t); ok(d); });
        socket.emit('joinRoom', {
            roomId: id, userName: u, isHost: false, password: '',
            deviceId: 'test-device-' + Math.random().toString(36).slice(2),
            tabId: 'test-tab-' + Math.random().toString(36).slice(2)
        });
    }), { id: roomId, u: userName });
}

async function loadPage(page, name) {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 15000 });
}

// mock PiP 창 주입 — createHTMLDocument 기반. rAF는 메인 창으로 위임 (드라이버 이관 경로 검증용).
// innerWidth/Height: fit-to-window 스케일 검증용. detached 문서라 offsetWidth=0→nat=1이므로
// 800x600이면 k=min(784,552,1.25)=1.25(캡)로 결정적. scaleRoot는 일부러 안 만든다 —
// racePipAttachTrack의 방어 재생성 분기가 만들게 하여 그 분기도 함께 검증.
const INJECT_MOCK = () => {
    const doc = document.implementation.createHTMLDocument('mock-pip');
    window.__mockPip = {
        closed: false,
        document: doc,
        innerWidth: 800,
        innerHeight: 600,
        close() { this.closed = true; window.__mockPipClosed = true; },
        addEventListener() {},
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
    };
    window._racePipWin = window.__mockPip;
    return true;
};

async function run() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(` 경마 트랙 PiP(개정3: 상시 attach) — QA 자동화 검증`);
    console.log(` 서버: ${URL} / 모드: ${HEADED ? 'headed' : 'headless'}`);
    console.log('='.repeat(60));

    const browser = await chromium.launch({ headless: !HEADED });
    const consoleErrors = [];

    try {
        // ═══════════ [A] 지원 환경 — 상시 버튼 + 풀 레이스 무회귀 (창 미개방) ═══════════
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        for (const c of [ctx1, ctx2]) {
            await c.route('**googlesyndication**', r => r.abort());
            await c.route('**doubleclick**', r => r.abort());
        }
        const h = await ctx1.newPage();
        const g = await ctx2.newPage();
        h.on('pageerror', e => consoleErrors.push('[HOST-PAGEERR] ' + e.message));
        g.on('pageerror', e => consoleErrors.push('[GUEST-PAGEERR] ' + e.message));
        h.on('console', m => { if (m.type() === 'error') consoleErrors.push('[HOST-CON] ' + m.text()); });
        g.on('console', m => { if (m.type() === 'error') consoleErrors.push('[GUEST-CON] ' + m.text()); });

        section('A1. 페이지 로드 / 전역 초기값 / 버튼 행([PiP][카메라] flex)');
        await loadPage(h, 'PipHost');
        await loadPage(g, 'PipGuest');

        const env = await h.evaluate(() => {
            const btn = document.getElementById('racePipBtn');
            const cam = document.getElementById('cameraSwitchBtn');
            const row = btn ? btn.parentElement : null;
            return {
                pipSupported: typeof pipSupported !== 'undefined' ? pipSupported : null,
                hasApi: 'documentPictureInPicture' in window,
                animWin: window._raceAnimWin === window,
                pipWin: window._racePipWin,
                attached: typeof racePipAttached === 'function' ? racePipAttached() : null,
                raceDocIsMain: typeof raceDoc === 'function' ? raceDoc() === document : null,
                raceAnimWinIsMain: typeof raceAnimWin === 'function' ? raceAnimWin() === window : null,
                btnStyle: btn ? btn.style.display : 'MISSING',
                btnVisible: btn ? (btn.checkVisibility ? btn.checkVisibility() : btn.offsetParent !== null) : null,
                btnLabel: btn ? btn.textContent : 'MISSING',
                rowClass: row ? row.className : 'MISSING',
                rowFlex: row ? getComputedStyle(row).display : 'MISSING',
                pipLeftOfCam: !!(btn && cam && btn.nextElementSibling === cam && btn.parentElement === cam.parentElement),
                deletedRefs: (typeof window.racePipTeardown === 'undefined')
                    && (typeof window.racePipShowWaiting === 'undefined')
                    && (typeof window.racePipClearWaiting === 'undefined')
                    && (typeof window.racePipRestoreWrapper === 'undefined')
            };
        });
        info(`documentPictureInPicture in window: ${env.hasApi} → pipSupported=${env.pipSupported}`);
        env.pipSupported === env.hasApi ? pass('pipSupported가 API 존재와 일치') : fail('pipSupported 불일치');
        env.animWin ? pass('_raceAnimWin 초기값 === window') : fail('_raceAnimWin 초기값 이상');
        env.pipWin === null ? pass('_racePipWin 초기값 null') : fail('_racePipWin 초기값 이상');
        env.attached === false ? pass('racePipAttached() 초기 false') : fail('racePipAttached() 초기 이상');
        env.raceDocIsMain ? pass('raceDoc() === document (미attach)') : fail('raceDoc() 항등성 실패');
        env.raceAnimWinIsMain ? pass('raceAnimWin() === window') : fail('raceAnimWin() 항등성 실패');
        env.deletedRefs ? pass('개정3: 삭제 함수(teardown/waiting/clearWaiting/restoreWrapper) 전역 잔존 0')
            : fail('삭제 함수가 전역에 잔존');
        env.rowClass.includes('track-top-btn-row') && env.rowFlex === 'flex'
            ? pass('버튼 행 .track-top-btn-row flex 배치') : fail(`버튼 행: ${env.rowClass}/${env.rowFlex}`);
        env.pipLeftOfCam ? pass('개정3: [PiP][카메라] 순서 — PiP 버튼이 카메라 버튼 왼쪽 밀착') : fail('버튼 순서/부모 불일치');
        if (env.pipSupported) {
            env.btnStyle === 'block' ? pass('버튼 style.display=block (상시 노출 준비)') : fail(`버튼 style: ${env.btnStyle}`);
            env.btnVisible === false ? pass('방 진입 전: 래퍼 숨김이라 실질 비노출 (checkVisibility false)') : fail(`방 진입 전 버튼 가시: ${env.btnVisible}`);
            env.btnLabel.includes(LABEL_IDLE) ? pass(`초기 라벨 "${env.btnLabel.trim()}"`) : fail(`초기 라벨: ${env.btnLabel}`);
        } else {
            info('이 환경은 PiP 미지원 — 지원 환경 어서션 생략 ([C]에서 미지원 경로 검증)');
        }

        section('A2. 방 생성 → 선택 단계: 버튼 노출 + 래퍼 메인 유지');
        const roomData = await createRoom(h, 'PipHost', 'PipQA-A방');
        pass(`방 생성: ${roomData.roomId}`);
        await joinRoom(g, roomData.roomId, 'PipGuest');
        pass('게스트 입장');
        await h.waitForTimeout(800);

        const loadingGone = await h.evaluate(() => {
            const ls = document.getElementById('loadingScreen');
            return !ls || getComputedStyle(ls).display === 'none';
        });
        loadingGone ? pass('로딩 스크린 닫힘') : fail('로딩 스크린 잔존');

        const sel = await h.evaluate(() => {
            const wrapper = document.getElementById('raceTrackWrapper');
            const btn = document.getElementById('racePipBtn');
            const vis = el => el ? (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null) : false;
            return {
                wrapperVisible: vis(wrapper),
                wrapperInMain: !!wrapper,
                btnVisible: vis(btn),
                attached: racePipAttached(),
                raceDocMain: raceDoc() === document,
                supported: pipSupported
            };
        });
        sel.wrapperInMain ? pass('선택 단계: 래퍼 메인 문서 잔존 (창 미개방)') : fail('선택 단계 래퍼 유실');
        sel.attached === false ? pass('선택 단계: racePipAttached() false') : fail('선택 단계 attached 오판');
        sel.raceDocMain ? pass('선택 단계: raceDoc() === document') : fail('선택 단계 raceDoc 이상');
        if (sel.supported) {
            if (sel.wrapperVisible) {
                sel.btnVisible ? pass('선택 단계(래퍼 가시)부터 버튼 실질 노출') : fail('선택 단계 래퍼 가시인데 버튼 비가시');
            } else {
                info('선택 단계 래퍼 아직 비가시 — 버튼 노출은 래퍼 표시 시점부터 (레이스 중 어서션으로 커버)');
            }
        }

        section('A3. 레이스 시작 → 레이스 중 상태 (창 미개방)');
        {
            const allSelectedPromise = waitEvent(h, 'allHorsesSelected', 10000);
            await h.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
            await g.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
            await allSelectedPromise;
            pass('말 선택 완료 (host:0 guest:1)');
            const hostRaceP = waitEvent(h, 'horseRaceStarted', 40000);
            const guestRaceP = waitEvent(g, 'horseRaceStarted', 40000);
            await h.waitForTimeout(200);
            await h.evaluate(() => socket.emit('startHorseRace'));
            await Promise.all([hostRaceP, guestRaceP]);
            pass('horseRaceStarted 양쪽 수신');
        }
        await h.waitForFunction(() => window._raceAnimFrameId != null, null, { timeout: 30000 });
        pass('레이스 애니메이션 구동 (_raceAnimFrameId 설정)');

        const midRace = await h.evaluate(() => {
            const b = document.getElementById('racePipBtn');
            return {
                display: b ? getComputedStyle(b).display : 'MISSING',
                label: b ? b.textContent : 'MISSING',
                supported: pipSupported,
                wrapperInMain: !!document.getElementById('raceTrackWrapper'),
                animWinIsMain: window._raceAnimWin === window,
                attached: racePipAttached()
            };
        });
        if (midRace.supported) {
            midRace.display === 'block' ? pass('레이스 중 버튼 노출') : fail(`레이스 중 버튼: ${midRace.display}`);
            midRace.label.includes(LABEL_IDLE) ? pass(`레이스 중(창 미개방) 라벨 "${midRace.label.trim()}"`) : fail(`레이스 중 라벨: ${midRace.label}`);
        }
        midRace.wrapperInMain ? pass('래퍼 메인 문서 잔존 (attach 미발동)') : fail('래퍼가 메인 문서에 없음');
        midRace.animWinIsMain ? pass('레이스 중 _raceAnimWin === window') : fail('_raceAnimWin 오염');
        midRace.attached === false ? pass('레이스 중 racePipAttached() false') : fail('attached 오판');

        section('A4. (헤드리스 시도) 실 버튼 클릭 → requestWindow 무해성');
        {
            try {
                await h.click('#racePipBtn', { timeout: 5000 }).catch(() =>
                    h.click('#racePipBtn', { force: true, timeout: 5000 }));
            } catch (e) { info('클릭 실패: ' + e.message); }
            await h.waitForTimeout(2500);
            const st = await h.evaluate(() => ({
                pipOpen: !!(window._racePipWin && !window._racePipWin.closed),
                attached: racePipAttached(),
                animMain: window._raceAnimWin === window,
                running: window._raceAnimFrameId != null,
                wrapperMain: !!document.getElementById('raceTrackWrapper')
            }));
            if (st.pipOpen) {
                info('헤드리스에서 requestWindow resolve — 실 attach 상태 검증');
                st.attached ? pass('클릭 → 즉시 attach') : fail('창 열림에도 미attach');
            } else {
                info('requestWindow 미해결(헤드리스 창 UI 한계) — 실 창 검증은 수동 QA + [B] mock으로 이관');
                (st.animMain && st.running && st.wrapperMain && !st.attached)
                    ? pass('클릭 실패 무해(graceful) — 상태 오염 없음, 레이스 지속')
                    : fail('클릭 실패 후 상태 오염', JSON.stringify(st));
            }
        }

        section('A5. 레이스 완주 → 결과 (창 미개방 무회귀)');
        await h.waitForFunction(() =>
            Array.isArray(window.lastActualFinishOrder) && window.lastActualFinishOrder.length > 0,
            null, { timeout: 90000 });
        pass('시각적 완주 순서 확정');

        const hostOrder = await h.evaluate(() => window.lastActualFinishOrder);
        const guestOrder = await g.waitForFunction(() =>
            Array.isArray(window.lastActualFinishOrder) && window.lastActualFinishOrder.length > 0,
            null, { timeout: 90000 }).then(() => g.evaluate(() => window.lastActualFinishOrder));
        JSON.stringify(hostOrder) === JSON.stringify(guestOrder)
            ? pass(`호스트/게스트 완주 순서 동일: [${hostOrder}]`)
            : fail('완주 순서 불일치', `host=[${hostOrder}] guest=[${guestOrder}]`);

        await h.waitForFunction(() => {
            const ro = document.getElementById('resultOverlay');
            return ro && ro.classList.contains('visible');
        }, null, { timeout: 30000 });
        pass('결과 오버레이 표시');

        const post = await h.evaluate(() => {
            const b = document.getElementById('racePipBtn');
            const wrapper = document.getElementById('raceTrackWrapper');
            const target = document.getElementById('targetRankReason');
            const replay = document.getElementById('replaySection');
            let posOk = null;
            if (wrapper && target && replay) {
                posOk = (target.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING) > 0
                     && (wrapper.compareDocumentPosition(replay) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
            }
            return {
                btnStyle: b ? b.style.display : 'MISSING',
                btnLabel: b ? b.textContent : 'MISSING',
                supported: pipSupported,
                pipWin: window._racePipWin,
                animWinIsMain: window._raceAnimWin === window,
                frameId: window._raceAnimFrameId,
                wrapperInMain: !!wrapper,
                posOk
            };
        });
        if (post.supported) {
            post.btnStyle === 'block' ? pass('종료 후에도 버튼 유지') : fail(`종료 후 버튼 style: ${post.btnStyle}`);
            post.btnLabel.includes(LABEL_IDLE) ? pass(`종료 후 라벨 "${post.btnLabel.trim()}"`) : fail(`종료 후 라벨: ${post.btnLabel}`);
        }
        post.pipWin === null ? pass('종료 후 _racePipWin null (창 미개방 유지)') : fail('종료 후 _racePipWin 이상');
        post.animWinIsMain ? pass('종료 후 _raceAnimWin === window') : fail('종료 후 _raceAnimWin 오염');
        post.frameId === null ? pass('종료 후 _raceAnimFrameId null (유령 루프 없음)') : fail(`종료 후 frameId 잔존: ${post.frameId}`);
        post.wrapperInMain ? pass('래퍼 메인 문서 위치') : fail('래퍼 유실');
        post.posOk === true ? pass('래퍼 DOM 위치 계약 유지 (#targetRankReason 뒤 · #replaySection 앞)')
            : post.posOk === false ? fail('래퍼 DOM 위치 계약 위반') : info('위치 계약 앵커 미존재');

        await ctx1.close();
        await ctx2.close();

        // ═══════════ [B] mock PiP 창 — 상시 attach 수명주기 ═══════════
        const ctx3 = await browser.newContext();
        const ctx4 = await browser.newContext();
        for (const c of [ctx3, ctx4]) {
            await c.route('**googlesyndication**', r => r.abort());
            await c.route('**doubleclick**', r => r.abort());
        }
        const h2 = await ctx3.newPage();
        const g2 = await ctx4.newPage();
        h2.on('pageerror', e => consoleErrors.push('[B-HOST-PAGEERR] ' + e.message));
        h2.on('console', m => { if (m.type() === 'error') consoleErrors.push('[B-HOST-CON] ' + m.text()); });
        g2.on('pageerror', e => consoleErrors.push('[B-GUEST-PAGEERR] ' + e.message));

        await loadPage(h2, 'PipHost');
        await loadPage(g2, 'PipGuest');

        const supported2 = await h2.evaluate(() => pipSupported);
        if (!supported2) {
            info('환경 미지원 — [B] mock 수명주기 생략');
        } else {
            const roomB = await createRoom(h2, 'PipHost', 'PipQA-B방');
            await joinRoom(g2, roomB.roomId, 'PipGuest');
            await h2.waitForTimeout(800);

            section('B1. 선택 단계 open 즉시 attach → 사용자 닫기(토글)');
            const b1 = await h2.evaluate((inject) => {
                eval('(' + inject + ')()');
                // racePipOpen resolve와 동일 시퀀스 (requestWindow만 mock으로 대체)
                racePipAttachTrack();
                if (racePipAttached()) racePipResumeIfPaused();
                updatePipButtonLabel();
                const mock = window.__mockPip;
                const root = mock.document.getElementById('pipScaleRoot');
                const w = mock.document.getElementById('raceTrackWrapper');
                const btn = mock.document.getElementById('racePipBtn');
                let phCount = 0;
                const it = document.createNodeIterator(document.body, NodeFilter.SHOW_COMMENT);
                let c; while ((c = it.nextNode())) if (c.textContent.includes('raceTrackWrapper-pip-placeholder')) phCount++;
                return {
                    rootCreated: !!root,
                    wrapperInRoot: !!(w && root && w.parentNode === root),
                    wrapperInMain: !!document.getElementById('raceTrackWrapper'),
                    attached: racePipAttached(),
                    raceDocIsMock: raceDoc() === mock.document,
                    label: btn ? btn.textContent : 'MISSING',
                    rootTransform: root ? root.style.transform : 'N/A',
                    phCount
                };
            }, INJECT_MOCK.toString());
            b1.rootCreated ? pass('#pipScaleRoot 생성 (attachTrack 방어 분기 경유)') : fail('scaleRoot 미생성');
            b1.wrapperInRoot && !b1.wrapperInMain ? pass('개정3: 선택 단계 open 즉시 attach — 래퍼가 스케일 루트 소속') : fail('선택 단계 attach 실패', JSON.stringify(b1));
            b1.attached ? pass('racePipAttached() true') : fail('attached false');
            b1.raceDocIsMock ? pass('raceDoc() === PiP 문서') : fail('raceDoc 미전환');
            b1.label.includes(LABEL_ATTACHED) ? pass(`attach 라벨 "${b1.label.trim()}"`) : fail(`라벨: ${b1.label}`);
            b1.rootTransform === 'scale(1.25)' ? pass('fit-to-window: 스케일 루트에 transform (캡 1.25)') : fail(`루트 transform: "${b1.rootTransform}"`);
            b1.phCount === 1 ? pass('attach 중 메인 placeholder 정확히 1개') : fail(`placeholder ${b1.phCount}개`);

            const b1c = await h2.evaluate(() => {
                toggleRacePip(); // attached → reattach (복귀 + 창 닫기)
                const wrapper = document.getElementById('raceTrackWrapper');
                const target = document.getElementById('targetRankReason');
                const replay = document.getElementById('replaySection');
                let posOk = null;
                if (wrapper && target && replay) {
                    posOk = (target.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING) > 0
                         && (wrapper.compareDocumentPosition(replay) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
                }
                const btn = document.getElementById('racePipBtn');
                let phCount = 0;
                const it = document.createNodeIterator(document.body, NodeFilter.SHOW_COMMENT);
                let c; while ((c = it.nextNode())) if (c.textContent.includes('raceTrackWrapper-pip-placeholder')) phCount++;
                return {
                    wrapperMain: !!wrapper, posOk,
                    mockClosed: window.__mockPip.closed,
                    pipNull: window._racePipWin === null,
                    animMain: window._raceAnimWin === window,
                    label: btn ? btn.textContent : 'MISSING',
                    phCount
                };
            });
            b1c.wrapperMain ? pass('토글 닫기: 래퍼 메인 복귀') : fail('토글 후 래퍼 미복귀');
            b1c.posOk === true ? pass('토글 닫기: 위치 계약 유지') : (b1c.posOk === false ? fail('위치 계약 위반') : info('위치 앵커 미존재'));
            b1c.mockClosed ? pass('토글 닫기: 창 close()') : fail('창 미닫힘');
            b1c.pipNull ? pass('토글 닫기: _racePipWin null') : fail('_racePipWin 잔존');
            b1c.animMain ? pass('토글 닫기: 드라이버 메인') : fail('드라이버 미복귀');
            b1c.label.includes(LABEL_IDLE) ? pass(`토글 닫기 후 라벨 원복 "${b1c.label.trim()}"`) : fail(`라벨: ${b1c.label}`);
            b1c.phCount === 0 ? pass('토글 닫기: placeholder 잔존 0') : fail(`placeholder ${b1c.phCount}개`);

            section('B2. 이식-선행 open 재앵커 → PiP 카운트다운 → 레이스 1');
            // reattach 계측 — 레이스 종료가 복귀를 유발하지 않아야 한다 (무-teardown)
            await h2.evaluate(() => {
                window.__reattachCalls = 0;
                const orig = racePipReattach;
                window.racePipReattach = function () { window.__reattachCalls++; return orig.apply(this, arguments); };
            });
            {
                const allSel = waitEvent(h2, 'allHorsesSelected', 10000);
                await h2.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
                await g2.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
                await allSel;
            }
            const cdP = waitEvent(h2, 'horseRaceCountdown', 40000);
            const rsP = waitEvent(h2, 'horseRaceStarted', 50000);
            const rsPg = waitEvent(g2, 'horseRaceStarted', 50000);
            await h2.waitForTimeout(200);
            await h2.evaluate(() => socket.emit('startHorseRace'));

            // 이식(룰렛/사유 카드)이 메인에서 먼저 발생 — canvasResultCenter 등장 대기
            await h2.waitForFunction(() => !!document.getElementById('canvasResultCenter'), null, { timeout: 20000 });
            pass('이식 UI(canvasResultCenter)가 메인에서 생성됨 (창 미개방 단계)');

            const b2a = await h2.evaluate((inject) => {
                eval('(' + inject + ')()');
                racePipAttachTrack();
                if (racePipAttached()) racePipResumeIfPaused();
                updatePipButtonLabel();
                const mock = window.__mockPip;
                const root = mock.document.getElementById('pipScaleRoot');
                const center = mock.document.getElementById('canvasResultCenter');
                return {
                    attached: racePipAttached(),
                    centerInRoot: !!(center && root && center.parentNode === root),
                    centerInMain: !!document.getElementById('canvasResultCenter'),
                    wrapperInRoot: !!(root && mock.document.getElementById('raceTrackWrapper')
                        && mock.document.getElementById('raceTrackWrapper').parentNode === root),
                    centerBeforeWrapper: !!(center && center.nextSibling === mock.document.getElementById('raceTrackWrapper'))
                };
            }, INJECT_MOCK.toString());
            b2a.attached ? pass('이식-선행 상태에서 open(attach) 성공') : fail('attach 실패');
            b2a.wrapperInRoot ? pass('래퍼 스케일 루트 소속') : fail('래퍼 루트 미소속');
            b2a.centerInRoot && !b2a.centerInMain ? pass('개정3: 재앵커 — canvasResultCenter가 스케일 루트로 합류 (메인 부재)') : fail('center 재앵커 실패', JSON.stringify(b2a));
            b2a.centerBeforeWrapper ? pass('center가 래퍼 앞 형제 (moveResultUiToCanvas 앵커 계약)') : fail('center 위치 이상');

            await cdP;
            const cd = await h2.evaluate(() => {
                const mock = window.__mockPip;
                return {
                    cdOverlay: !!mock.document.getElementById('countdownOverlay'),
                    kfCount: mock.document.querySelectorAll('#countdownSharedStyles').length,
                    wrapperInMock: !!mock.document.getElementById('raceTrackWrapper'),
                    frameId: window._raceAnimFrameId
                };
            });
            cd.cdOverlay ? pass('PiP 문서에 카운트다운 오버레이 렌더 (로컬 렌더러)') : fail('PiP 카운트다운 없음');
            cd.kfCount === 1 ? pass('countPop 키프레임 창당 1회 주입') : fail(`countPop 스타일 ${cd.kfCount}개`);
            cd.wrapperInMock ? pass('카운트다운 중 attach 유지') : fail('카운트다운 중 래퍼 이탈');
            cd.frameId == null ? pass('카운트다운은 레이스 kickoff 전') : info(`카운트다운 시점 frameId: ${cd.frameId}`);

            await Promise.all([rsP, rsPg]);
            await h2.waitForFunction(() => window._raceAnimFrameId != null, null, { timeout: 30000 });
            const att = await h2.evaluate(() => {
                const mock = window.__mockPip;
                return {
                    wrapperInMock: !!mock.document.getElementById('raceTrackWrapper'),
                    wrapperInMain: !!document.getElementById('raceTrackWrapper'),
                    reattachCalls: window.__reattachCalls,
                    attached: racePipAttached(),
                    animIsMock: window._raceAnimWin === mock,
                    raceDocIsMock: raceDoc() === mock.document
                };
            });
            att.wrapperInMock && !att.wrapperInMain ? pass('레이스 구동 중 attach 유지') : fail('레이스 중 attach 상실');
            att.reattachCalls === 0 ? pass('카운트다운→레이스 전이에서 복귀 0회 (깜빡임 없음)') : fail(`reattach ${att.reattachCalls}회`);
            att.attached ? pass('racePipAttached() true') : fail('attached false');
            att.animIsMock ? pass('_raceAnimWin === PiP 창 (드라이버 이관)') : fail('드라이버 미이관');
            att.raceDocIsMock ? pass('raceDoc() === PiP 문서') : fail('raceDoc 미전환');

            const move = await h2.evaluate(() => new Promise(ok => {
                const doc = window.__mockPip.document;
                const horse = doc.querySelector('[data-vehicle-id]') || doc.querySelector('.race-horse, .horse');
                const p1 = horse ? (horse.style.left || horse.style.transform) : null;
                setTimeout(() => {
                    const p2 = horse ? (horse.style.left || horse.style.transform) : null;
                    ok({ p1, p2, found: !!horse });
                }, 700);
            }));
            (move.found && move.p1 !== move.p2)
                ? pass('attach 상태로 레이스 진행 중 (말 위치 전진)')
                : (move.found ? fail('attach 후 말 위치 정지 — 드라이버 동결 의심', `${move.p1} == ${move.p2}`)
                               : info('말 요소 셀렉터 미매치 — 위치 전진 검증 생략'));

            section('B3. 레이스 1 종료 → 래퍼 PiP 잔류(무-teardown) → 리셋 이식 복원 → 라운드 2');
            await h2.waitForFunction(() =>
                Array.isArray(window.lastActualFinishOrder) && window.lastActualFinishOrder.length > 0,
                null, { timeout: 90000 });
            pass('1차 레이스 완주');

            const fin1 = await h2.evaluate(() => {
                const mock = window.__mockPip;
                return {
                    wrapperInMock: !!mock.document.getElementById('raceTrackWrapper'),
                    wrapperInMain: !!document.getElementById('raceTrackWrapper'),
                    reattachCalls: window.__reattachCalls,
                    mockOpen: !mock.closed,
                    pipKept: window._racePipWin === mock,
                    frameId: window._raceAnimFrameId,
                    animIsMock: window._raceAnimWin === mock
                };
            });
            fin1.wrapperInMock && !fin1.wrapperInMain ? pass('개정3: 종료 후에도 래퍼 PiP 잔류 (멈춘 트랙 그대로 창에)') : fail('종료 후 래퍼 위치 이상', JSON.stringify(fin1));
            fin1.reattachCalls === 0 ? pass('종료 시 복귀 미호출 (teardown 폐기 확인)') : fail(`종료 시 reattach ${fin1.reattachCalls}회`);
            fin1.mockOpen && fin1.pipKept ? pass('창 유지 + _racePipWin 참조 유지') : fail('창/참조 유실');
            fin1.frameId === null ? pass('종료 후 frameId null (유령 루프 없음)') : fail(`frameId 잔존: ${fin1.frameId}`);
            fin1.animIsMock ? pass('_raceAnimWin PiP 잔류 (attach 유지 중 — 설계)') : fail('_raceAnimWin 이상');

            await h2.waitForFunction(() => {
                const ro = document.getElementById('resultOverlay');
                return ro && ro.classList.contains('visible');
            }, null, { timeout: 30000 });
            pass('결과 오버레이는 메인에 표시 (래퍼 밖 UI 메인 유지)');

            // 게임 리셋 → 이식 UI 메인 복원 (moveResultUiOffCanvas, attach 유지 상태에서)
            {
                const resetP = waitEvent(h2, 'horseRaceGameReset', 10000);
                await h2.evaluate(() => socket.emit('endHorseRace', {}));
                await resetP;
            }
            await h2.waitForTimeout(900); // offCanvas 600ms 페이드 대기
            const reset1 = await h2.evaluate(() => {
                const mock = window.__mockPip;
                return {
                    centerInMock: !!mock.document.getElementById('canvasResultCenter'),
                    bannerInMain: !!document.getElementById('targetRankBanner'),
                    wrapperInMock: !!mock.document.getElementById('raceTrackWrapper'),
                    reattachCalls: window.__reattachCalls
                };
            });
            !reset1.centerInMock ? pass('리셋: 이식 UI(center)가 PiP에서 해체됨 (offCanvas)') : fail('리셋 후 center PiP 잔존');
            reset1.bannerInMain ? pass('리셋: 배너가 메인 placeholder로 복원') : fail('배너 메인 미복원');
            reset1.wrapperInMock ? pass('리셋: 래퍼는 PiP 유지 (리셋도 창을 건드리지 않음)') : fail('리셋이 래퍼를 복귀시킴');
            reset1.reattachCalls === 0 ? pass('리셋 경로 복귀 0회') : fail(`리셋 reattach ${reset1.reattachCalls}회`);

            // 라운드 2 — attach 유지 상태에서 이식이 PiP로 직접 발생
            await h2.evaluate(() => { window.lastActualFinishOrder = null; });
            await g2.evaluate(() => { window.lastActualFinishOrder = null; });
            await h2.evaluate(() => socket.emit('toggleReady'));
            await g2.evaluate(() => socket.emit('toggleReady'));
            await h2.waitForTimeout(500);
            {
                const allSel = waitEvent(h2, 'allHorsesSelected', 10000);
                await h2.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
                await g2.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
                await allSel;
            }
            const rs2P = waitEvent(h2, 'horseRaceStarted', 50000);
            const rs2Pg = waitEvent(g2, 'horseRaceStarted', 50000);
            await h2.waitForTimeout(200);
            await h2.evaluate(() => socket.emit('startHorseRace'));

            await h2.waitForFunction(() => {
                const mock = window.__mockPip;
                return !!mock.document.getElementById('canvasResultCenter');
            }, null, { timeout: 20000 });
            const b3t = await h2.evaluate(() => {
                const mock = window.__mockPip;
                const root = mock.document.getElementById('pipScaleRoot');
                const center = mock.document.getElementById('canvasResultCenter');
                return { inRoot: !!(center && root && center.parentNode === root), inMain: !!document.getElementById('canvasResultCenter') };
            });
            b3t.inRoot && !b3t.inMain ? pass('개정3: attach 중 이식 UI가 PiP 스케일 루트로 직접 이식') : fail('attach 중 직접 이식 실패', JSON.stringify(b3t));

            await Promise.all([rs2P, rs2Pg]);
            await h2.waitForFunction(() => window._raceAnimFrameId != null, null, { timeout: 30000 });
            await h2.waitForFunction(() =>
                Array.isArray(window.lastActualFinishOrder) && window.lastActualFinishOrder.length > 0,
                null, { timeout: 90000 });
            pass('2차 레이스 완주 (attach 연속)');
            const fin2 = await h2.evaluate(() => ({
                wrapperInMock: !!window.__mockPip.document.getElementById('raceTrackWrapper'),
                reattachCalls: window.__reattachCalls
            }));
            fin2.wrapperInMock ? pass('2차 종료 후에도 래퍼 PiP 잔류 (라운드 연속성)') : fail('2차 종료 후 래퍼 이탈');
            fin2.reattachCalls === 0 ? pass('2사이클 전 구간 복귀 0회 (창 수명 = 사용자 결정)') : fail(`reattach ${fin2.reattachCalls}회`);

            section('B4. X 닫기 — 스케일 루트 자식 전수 sweep 복귀');
            const sweep = await h2.evaluate(() => {
                const mock = window.__mockPip;
                const root = mock.document.getElementById('pipScaleRoot');
                const childIds = Array.from(root.children).map(el => el.id || el.tagName);
                toggleRacePip(); // attached → reattach: 루트 자식 전부 메인 복귀 + 창 닫기
                const wrapper = document.getElementById('raceTrackWrapper');
                const target = document.getElementById('targetRankReason');
                const replay = document.getElementById('replaySection');
                let posOk = null;
                if (wrapper && target && replay) {
                    posOk = (target.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING) > 0
                         && (wrapper.compareDocumentPosition(replay) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
                }
                let phCount = 0;
                const it = document.createNodeIterator(document.body, NodeFilter.SHOW_COMMENT);
                let c; while ((c = it.nextNode())) if (c.textContent.includes('raceTrackWrapper-pip-placeholder')) phCount++;
                const allInMain = childIds.every(id => !!document.getElementById(id));
                return {
                    childIds, allInMain,
                    rootEmpty: root.children.length === 0,
                    wrapperMain: !!wrapper, posOk,
                    mockClosed: mock.closed,
                    pipNull: window._racePipWin === null,
                    animMain: window._raceAnimWin === window,
                    phCount,
                    label: (document.getElementById('racePipBtn') || {}).textContent || 'MISSING'
                };
            });
            info(`sweep 대상 루트 자식: [${sweep.childIds.join(', ')}]`);
            sweep.childIds.length >= 1 ? pass(`sweep 전 루트 자식 ${sweep.childIds.length}개 확인`) : fail('sweep 대상 없음 — 시나리오 무효');
            sweep.allInMain ? pass('개정3: 루트 자식 전수(래퍼+이식 형제) 메인 복귀') : fail('sweep 누락', sweep.childIds.join(','));
            sweep.rootEmpty ? pass('sweep 후 스케일 루트 빈 상태') : fail('루트에 자식 잔존');
            sweep.wrapperMain ? pass('래퍼 메인 복귀') : fail('래퍼 미복귀');
            sweep.posOk === true ? pass('래퍼 위치 계약 유지') : (sweep.posOk === false ? fail('위치 계약 위반') : info('위치 앵커 미존재'));
            sweep.mockClosed ? pass('창 close() (닫힘 경로는 사용자/unload뿐)') : fail('창 미닫힘');
            sweep.pipNull ? pass('_racePipWin null') : fail('_racePipWin 잔존');
            sweep.animMain ? pass('드라이버 메인 복귀') : fail('드라이버 미복귀');
            sweep.phCount === 0 ? pass('placeholder 잔존 0') : fail(`placeholder ${sweep.phCount}개`);
            sweep.label.includes(LABEL_IDLE) ? pass(`라벨 원복 "${sweep.label.trim()}"`) : fail(`라벨: ${sweep.label}`);
        }
        await ctx3.close();
        await ctx4.close();

        // ═══════════ [C] 미지원 경로 (Firefox/모바일 등가) ═══════════
        section('C. 미지원 경로 — API 삭제 후 무회귀');
        const ctx5 = await browser.newContext();
        await ctx5.route('**googlesyndication**', r => r.abort());
        await ctx5.route('**doubleclick**', r => r.abort());
        const p5 = await ctx5.newPage();
        const errsC = [];
        p5.on('pageerror', e => errsC.push(e.message));
        await p5.addInitScript(() => { delete window.documentPictureInPicture; });
        await p5.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
        await p5.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 15000 });
        const unsup = await p5.evaluate(() => {
            const btn = document.getElementById('racePipBtn');
            const before = btn ? btn.style.display : 'MISSING';
            let toggleSafe = true;
            try { toggleRacePip(); } catch (e) { toggleSafe = false; }
            return {
                pipSupported: pipSupported,
                apiGone: !('documentPictureInPicture' in window),
                btnStyle: before, toggleSafe,
                attached: racePipAttached(),
                raceDocMain: raceDoc() === document,
                animWinMain: raceAnimWin() === window
            };
        });
        unsup.apiGone && unsup.pipSupported === false ? pass('API 삭제 → pipSupported=false') : fail('미지원 판정 실패');
        unsup.btnStyle === 'none' ? pass('미지원: 버튼 display:none 유지 (바인딩 IIFE 스킵)') : fail(`미지원 버튼: ${unsup.btnStyle}`);
        unsup.toggleSafe ? pass('미지원: toggleRacePip() 무해') : fail('미지원 toggle 예외');
        unsup.attached === false ? pass('미지원: racePipAttached() false') : fail('미지원 attached 오판');
        unsup.raceDocMain && unsup.animWinMain ? pass('미지원: raceDoc()/raceAnimWin() 항등') : fail('미지원 헬퍼 항등성 실패');
        errsC.length === 0 ? pass('미지원 경로 pageerror 0건') : fail(`미지원 경로 에러 ${errsC.length}건`, errsC.join(' | '));
        await ctx5.close();

        // ═══════════ 콘솔 에러 집계 ═══════════
        section('콘솔/페이지 에러 집계 (A+B)');
        const known = consoleErrors.filter(e => !/favicon|adsbygoogle|ERR_BLOCKED_BY|googlesyndication|google|net::/i.test(e));
        known.length === 0
            ? pass(`JS 에러 0건 (네트워크 잡음 ${consoleErrors.length - known.length}건 제외)`)
            : fail(`JS 에러 ${known.length}건`, known.slice(0, 5).join(' | '));

    } catch (e) {
        fail('테스트 실행 예외', e.message);
        if (consoleErrors.length) console.log('  콘솔 에러:', consoleErrors.slice(0, 10).join('\n  '));
    } finally {
        await browser.close();
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(` 결과: PASS ${R.pass} / FAIL ${R.fail}`);
    if (R.errors.length) R.errors.forEach(e => console.log(`   - ${e}`));
    console.log('='.repeat(60));
    process.exit(R.fail > 0 ? 1 : 0);
}

run();
