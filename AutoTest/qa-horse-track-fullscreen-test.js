/**
 * QA — 경마 트랙 전체화면(최대화) 자동화 검증 (goal: horse-race-track-fullscreen)
 *
 * 구조: `.race-fs-stage`(전체화면 요소/CSS 오버레이) > `#raceFsScaleRoot`(고정폭, transform) > 래퍼.
 * 진입 경로 3종(API 성공 / API reject / API 미지원)과 종료 경로(버튼·브라우저·PiP 진입)를 모두 검증한다.
 *
 * 헤드리스 특성: Chromium 헤드리스는 requestFullscreen을 실제로 지원하고 resolve까지 된다(실측).
 * → API 경로도 자동 검증 가능. 폴백 경로는 init 스크립트로 API를 제거/거부/동기throw 시켜 강제한다.
 * 실기에서만 가능한 것(아이폰 사파리 실제 화면, 안드로이드 가로 lock, 브라우저 크롬 숨김)은 수동 QA.
 *
 * 검증 트랙:
 *   [F1] 버튼 상시 노출 / 행 순서 [전체화면][PiP][카메라] / 초기 상태
 *   [F2] API 경로 진입 — 스테이지·스케일 루트·transform·paddingTop·라벨
 *   [F3] 기하 불변식 — rowTop = paddingTop − 32k ≥ 0, bottom = paddingTop + k·natH ≤ innerHeight
 *   [F4] 버튼 종료 — 전부 제거 + 래퍼 원위치 + 인라인 잔존 0 + body overflow 원복
 *   [F5] 브라우저 자체 종료(Escape 등가) — fullscreenchange 수렴
 *   [F6] 이식 재앵커 + 종료 sweep 순서 보존
 *   [F7] 멱등성 (중복 enter/exit)
 *   [F8] PiP 상호배타 — attach 중 버튼 숨김·진입 차단 / 전체화면 중 PiP open → 선종료
 *   [F9] 레이스 중 진입·종료 — 애니메이션 지속 + 정상 완주
 *   [G]  폴백 3경로 (미지원 / reject / 동기 throw) + 4개 뷰포트 기하 스윕
 *
 * Usage: node AutoTest/qa-horse-track-fullscreen-test.js [--headed] [--url=...]
 */

const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const PAGE = `${URL}/horse-race-multiplayer.html?createRoom=true`;

const LABEL_FS_IDLE = '전체화면';
const LABEL_FS_ON = '전체화면 종료';
const OVERHANG = 32; // RACE_TRACK_BTN_ROW_OVERHANG_PX — css .track-top-btn-row{top:-32px}와 짝

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

// 방 준비 + 선택 단계 트랙 렌더까지 (전체화면 검증은 대부분 이 단계에서 수행)
async function setupRoom(browser, errors, tag, initScript) {
    const hCtx = await browser.newContext();
    const gCtx = await browser.newContext();
    for (const c of [hCtx, gCtx]) {
        await c.route('**googlesyndication**', r => r.abort());
        await c.route('**doubleclick**', r => r.abort());
    }
    const h = await hCtx.newPage();
    const g = await gCtx.newPage();
    // 첫 방문 튜토리얼의 .tutorial-click-blocker가 버튼 클릭을 가로챈다 — 페이지 스크립트보다 먼저 완료 플래그 주입
    // (tutorial-shared.js: STORAGE_PREFIX 'tutorialSeen_' + gameType, VERSION 'v1')
    for (const pg of [h, g]) {
        await pg.addInitScript(() => {
            try { localStorage.setItem('tutorialSeen_horse', 'v1'); } catch (e) {}
        });
    }
    if (initScript) await h.addInitScript(initScript);
    h.on('pageerror', e => errors.push(`[${tag}-PAGEERR] ` + e.message));
    h.on('console', m => { if (m.type() === 'error') errors.push(`[${tag}-CON] ` + m.text()); });
    g.on('pageerror', e => errors.push(`[${tag}-G-PAGEERR] ` + e.message));

    await loadPage(h, 'FsHost');
    await loadPage(g, 'FsGuest');
    const room = await createRoom(h, 'FsHost', `FsQA-${tag}방`);
    await joinRoom(g, room.roomId, 'FsGuest');
    await h.waitForTimeout(800);
    // 트랙 미리보기 렌더 (availableHorses 초기화) — 선택 단계 유지를 위해 호스트만 선택
    await h.evaluate(() => socket.emit('selectHorse', { horseIndex: 0 }));
    await h.waitForFunction(() => {
        const w = document.getElementById('raceTrackWrapper');
        return w && (w.checkVisibility ? w.checkVisibility() : w.offsetParent !== null);
    }, null, { timeout: 15000 });
    return { hCtx, gCtx, h, g, room };
}

// 전체화면 상태 스냅샷 (기하 포함)
const SNAP = () => {
    const stage = document.getElementById('raceFsStage');
    const root = document.getElementById('raceFsScaleRoot');
    const wrapper = document.getElementById('raceTrackWrapper');
    const btn = document.getElementById('raceFullscreenBtn');
    const parseK = t => {
        if (!t) return 1;
        const m = /scale\(([-\d.]+)\)/.exec(t);
        return m ? parseFloat(m[1]) : 1;
    };
    const k = root ? parseK(root.style.transform) : null;
    const padTop = stage ? parseFloat(stage.style.paddingTop || '0') : null;
    const natH = root ? root.offsetHeight : null;
    const natW = root ? root.offsetWidth : null;
    return {
        active: _raceFsActive,
        cssFallback: _raceFsCssFallback,
        stageExists: !!stage,
        stageClass: stage ? stage.className : null,
        rootExists: !!root,
        wrapperInRoot: !!(wrapper && root && wrapper.parentNode === root),
        rootInStage: !!(root && stage && root.parentNode === stage),
        fsElementIsStage: !!(document.fullscreenElement && stage && document.fullscreenElement === stage),
        fsElementTag: document.fullscreenElement ? document.fullscreenElement.id || document.fullscreenElement.tagName : null,
        label: btn ? btn.textContent : 'MISSING',
        btnDisplay: btn ? btn.style.display : 'MISSING',
        btnDisabled: btn ? !!btn.disabled : null,
        bodyOverflow: document.body.style.overflow,
        rootWidthInline: root ? root.style.width : null,
        k, padTop, natH, natW,
        innerW: window.innerWidth, innerH: window.innerHeight,
        // 기하 불변식
        rowTop: (padTop != null && k != null) ? padTop - 32 * k : null,
        bottom: (padTop != null && k != null && natH != null) ? padTop + k * natH : null
    };
};

// mock PiP 창 (PiP 스위트와 동일 패턴)
const INJECT_MOCK = () => {
    const doc = document.implementation.createHTMLDocument('mock-pip');
    window.__mockPip = {
        closed: false, document: doc, innerWidth: 800, innerHeight: 600,
        close() { this.closed = true; },
        addEventListener() {},
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window)
    };
    window._racePipWin = window.__mockPip;
    return true;
};

function assertGeometry(s, tag) {
    if (s.k == null || s.padTop == null || s.natH == null) { fail(`${tag}: 기하 측정 불가`); return; }
    info(`${tag}: 뷰포트 ${s.innerW}x${s.innerH} / k=${s.k.toFixed(3)} pad=${s.padTop} natW=${s.natW} natH=${s.natH}`);
    s.rowTop >= -0.5
        ? pass(`${tag}: 버튼 행 상단 수납 (rowTop=${s.rowTop.toFixed(2)} ≥ 0)`)
        : fail(`${tag}: 버튼 행이 화면 위로 잘림`, `rowTop=${s.rowTop.toFixed(2)}`);
    s.bottom <= s.innerH + 1
        ? pass(`${tag}: 트랙 하단 수납 (bottom=${s.bottom.toFixed(1)} ≤ ${s.innerH})`)
        : fail(`${tag}: 트랙 하단이 화면 밖`, `bottom=${s.bottom.toFixed(1)} > ${s.innerH}`);
    (s.k <= 2.0 + 1e-6)
        ? pass(`${tag}: 스케일 상한(2.0) 준수`)
        : fail(`${tag}: 스케일 상한 초과`, `k=${s.k}`);
    (s.natW && Math.abs(s.k * s.natW) <= s.innerW + 1)
        ? pass(`${tag}: 가로 수납 (k·natW=${(s.k * s.natW).toFixed(0)} ≤ ${s.innerW})`)
        : fail(`${tag}: 가로 넘침`, `k·natW=${(s.k * s.natW).toFixed(0)} > ${s.innerW}`);
}

async function run() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(` 경마 트랙 전체화면 — QA 자동화 검증`);
    console.log(` 서버: ${URL} / 모드: ${HEADED ? 'headed' : 'headless'}`);
    console.log('='.repeat(60));

    const browser = await chromium.launch({ headless: !HEADED });
    const errors = [];

    try {
        // ═══════════ 컨텍스트 1: API 지원 환경 ═══════════
        const A = await setupRoom(browser, errors, 'API');
        const h = A.h;

        section('F1. 버튼 상시 노출 / 행 순서 / 초기 상태');
        const f1 = await h.evaluate(() => {
            const row = document.querySelector('.track-top-btn-row');
            const kids = row ? Array.from(row.children).map(el => el.id) : [];
            const btn = document.getElementById('raceFullscreenBtn');
            const vis = el => el ? (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null) : false;
            return {
                kids,
                firstIsFs: kids[0] === 'raceFullscreenBtn',
                visible: vis(btn),
                label: btn ? btn.textContent : 'MISSING',
                supported: typeof raceFsSupported === 'function' ? raceFsSupported() : null,
                active: _raceFsActive,
                stage: !!document.getElementById('raceFsStage'),
                root: !!document.getElementById('raceFsScaleRoot'),
                overhangConst: typeof RACE_TRACK_BTN_ROW_OVERHANG_PX !== 'undefined' ? RACE_TRACK_BTN_ROW_OVERHANG_PX : null,
                capConst: typeof RACE_FS_SCALE_MAX !== 'undefined' ? RACE_FS_SCALE_MAX : null
            };
        });
        info(`버튼 행: [${f1.kids.join(', ')}]`);
        f1.firstIsFs ? pass('전체화면 버튼이 행의 첫 아이템 (PiP·카메라 왼쪽)') : fail(`행 순서 이상: ${f1.kids.join(',')}`);
        f1.visible ? pass('버튼 상시 노출 (기능 감지로 숨기지 않음)') : fail('버튼 비가시');
        f1.label.includes(LABEL_FS_IDLE) && !f1.label.includes(LABEL_FS_ON) ? pass(`초기 라벨 "${f1.label.trim()}"`) : fail(`초기 라벨: ${f1.label}`);
        f1.active === false ? pass('_raceFsActive 초기 false') : fail('초기 활성 상태 이상');
        !f1.stage && !f1.root ? pass('초기 스테이지/스케일 루트 미생성 (미사용 시 DOM 무영향)') : fail('초기 컨테이너 잔존');
        f1.overhangConst === OVERHANG ? pass(`오버행 상수 ${OVERHANG}px (CSS top:-32px와 짝)`) : fail(`오버행 상수: ${f1.overhangConst}`);
        f1.capConst === 2.0 ? pass('스케일 상한 상수 2.0') : fail(`상한 상수: ${f1.capConst}`);
        info(`이 환경 raceFsSupported()=${f1.supported} (헤드리스 Chromium은 Fullscreen API 지원)`);

        section('F2. API 경로 진입');
        await h.click('#raceFullscreenBtn');
        await h.waitForTimeout(600);
        const f2 = await h.evaluate(SNAP);
        f2.active ? pass('_raceFsActive true') : fail('진입 실패');
        f2.stageExists && f2.rootExists ? pass('스테이지 + 스케일 루트 생성') : fail('컨테이너 미생성');
        f2.wrapperInRoot ? pass('래퍼가 스케일 루트 안') : fail('래퍼 루트 미소속');
        f2.rootInStage ? pass('스케일 루트가 스테이지 안 (2단 구조)') : fail('2단 구조 아님');
        if (f2.cssFallback) {
            info('이 실행은 CSS 폴백으로 전환됨 (API reject) — 폴백 어서션으로 대체 검증');
            f2.stageClass.includes('race-fs-css') ? pass('폴백 클래스 적용') : fail(`클래스: ${f2.stageClass}`);
        } else {
            f2.stageClass.includes('race-fs-api') ? pass('API 클래스(race-fs-api) 적용') : fail(`클래스: ${f2.stageClass}`);
            f2.fsElementIsStage ? pass('document.fullscreenElement === 스테이지 (래퍼 아님 — top layer 함정 회피)') : fail(`fullscreenElement: ${f2.fsElementTag}`);
            f2.bodyOverflow !== 'hidden' ? pass('API 경로: body 스크롤 잠금 미적용 (폴백 전용)') : fail('API 경로인데 body 잠금');
        }
        f2.rootWidthInline && /px$/.test(f2.rootWidthInline) ? pass(`스케일 루트 자연폭 고정 (${f2.rootWidthInline}) — 카메라 좌표계 보존`) : fail(`루트 width 인라인: ${f2.rootWidthInline}`);
        f2.padTop != null && f2.k != null && Math.abs(f2.padTop - Math.ceil(OVERHANG * f2.k)) < 0.6
            ? pass(`스테이지 paddingTop = ceil(32k) = ${f2.padTop}`) : fail(`paddingTop=${f2.padTop}, k=${f2.k}`);
        f2.label.includes(LABEL_FS_ON) ? pass(`라벨 전이 "${f2.label.trim()}"`) : fail(`라벨: ${f2.label}`);

        section('F3. 기하 불변식 (진입 뷰포트)');
        assertGeometry(f2, 'API경로');

        section('F4. 버튼 종료 — 전량 정리');
        await h.click('#raceFullscreenBtn');
        await h.waitForTimeout(600);
        const f4 = await h.evaluate(() => {
            const wrapper = document.getElementById('raceTrackWrapper');
            const target = document.getElementById('targetRankReason');
            const replay = document.getElementById('replaySection');
            let posOk = null;
            if (wrapper && target && replay) {
                posOk = (target.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING) > 0
                     && (wrapper.compareDocumentPosition(replay) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
            }
            const btn = document.getElementById('raceFullscreenBtn');
            return {
                active: _raceFsActive,
                stage: !!document.getElementById('raceFsStage'),
                root: !!document.getElementById('raceFsScaleRoot'),
                hint: !!document.getElementById('raceFsRotateHint'),
                wrapperInMain: !!wrapper, posOk,
                wrapperTransform: wrapper ? wrapper.style.transform : 'N/A',
                wrapperWidth: wrapper ? wrapper.style.width : 'N/A',
                bodyOverflow: document.body.style.overflow,
                fsElement: !!document.fullscreenElement,
                label: btn ? btn.textContent : 'MISSING'
            };
        });
        f4.active === false ? pass('_raceFsActive false') : fail('종료 후에도 활성');
        !f4.stage && !f4.root ? pass('스테이지 + 스케일 루트 DOM 제거') : fail(`잔존 stage=${f4.stage} root=${f4.root}`);
        !f4.hint ? pass('회전 힌트 잔존 없음') : fail('힌트 잔존');
        f4.wrapperInMain ? pass('래퍼 메인 문서 복귀') : fail('래퍼 유실');
        f4.posOk === true ? pass('래퍼 DOM 위치 계약 유지 (#targetRankReason 뒤 · #replaySection 앞)')
            : (f4.posOk === false ? fail('위치 계약 위반') : info('위치 앵커 미존재'));
        f4.wrapperTransform === '' && f4.wrapperWidth === '' ? pass('래퍼 인라인 transform/width 잔존 0') : fail(`래퍼 인라인: transform="${f4.wrapperTransform}" width="${f4.wrapperWidth}"`);
        f4.bodyOverflow !== 'hidden' ? pass('body 스크롤 잠금 해제') : fail('body overflow hidden 잔존');
        !f4.fsElement ? pass('document.fullscreenElement null (실제 전체화면 해제)') : fail('fullscreenElement 잔존');
        f4.label.includes(LABEL_FS_IDLE) && !f4.label.includes(LABEL_FS_ON) ? pass(`라벨 원복 "${f4.label.trim()}"`) : fail(`라벨: ${f4.label}`);

        section('F5. 브라우저 자체 종료(Escape 등가) → fullscreenchange 수렴');
        const f5 = await h.evaluate(async () => {
            const btn = document.getElementById('raceFullscreenBtn');
            btn.click(); // 진입
            await new Promise(r => setTimeout(r, 500));
            const entered = { active: _raceFsActive, css: _raceFsCssFallback, fsEl: !!document.fullscreenElement };
            // 브라우저 자체 종료 경로 (Escape와 동일하게 fullscreenchange 발화)
            if (document.fullscreenElement && document.exitFullscreen) {
                try { await document.exitFullscreen(); } catch (e) {}
            } else {
                document.dispatchEvent(new Event('fullscreenchange')); // API 미진입 환경 폴백 자극
            }
            await new Promise(r => setTimeout(r, 500));
            return {
                entered,
                active: _raceFsActive,
                stage: !!document.getElementById('raceFsStage'),
                root: !!document.getElementById('raceFsScaleRoot'),
                bodyOverflow: document.body.style.overflow,
                label: (document.getElementById('raceFullscreenBtn') || {}).textContent || 'MISSING'
            };
        });
        f5.entered.active ? pass('재진입 성공') : fail('재진입 실패');
        if (f5.entered.css) {
            info('CSS 폴백으로 진입한 실행 — fullscreenchange 경로는 API 전용이라 상태 유지가 정상');
            f5.active ? pass('폴백 상태에서 fullscreenchange 무시 (정상)') : info('폴백인데 종료됨');
            await h.evaluate(() => raceFsExit());
            await h.waitForTimeout(300);
        } else {
            f5.active === false ? pass('브라우저 종료 → raceFsExit 수렴') : fail('브라우저 종료 후에도 활성');
            !f5.stage && !f5.root ? pass('브라우저 종료: 컨테이너 정리') : fail('브라우저 종료 후 컨테이너 잔존');
            f5.bodyOverflow !== 'hidden' ? pass('브라우저 종료: body 잠금 없음') : fail('body 잠금 잔존');
            f5.label.includes(LABEL_FS_IDLE) && !f5.label.includes(LABEL_FS_ON) ? pass('브라우저 종료: 라벨 원복') : fail(`라벨: ${f5.label}`);
        }

        section('F6. 이식(룰렛/배너) 재앵커 + 종료 sweep 순서 보존');
        const f6 = await h.evaluate(async () => {
            moveResultUiToCanvas(); // 이식 발생 (메인, 래퍼 앞 형제)
            const beforeInMain = !!document.getElementById('canvasResultCenter');
            document.getElementById('raceFullscreenBtn').click();
            await new Promise(r => setTimeout(r, 500));
            const root = document.getElementById('raceFsScaleRoot');
            const center = document.getElementById('canvasResultCenter');
            const wrapper = document.getElementById('raceTrackWrapper');
            const mid = {
                centerInRoot: !!(center && root && center.parentNode === root),
                centerBeforeWrapper: !!(center && center.nextSibling === wrapper),
                rootChildren: root ? Array.from(root.children).map(e => e.id) : []
            };
            raceFsExit();
            await new Promise(r => setTimeout(r, 300));
            const c2 = document.getElementById('canvasResultCenter');
            const w2 = document.getElementById('raceTrackWrapper');
            return {
                beforeInMain, mid,
                afterCenterInMain: !!c2,
                afterOrder: !!(c2 && w2 && (c2.compareDocumentPosition(w2) & Node.DOCUMENT_POSITION_FOLLOWING) > 0),
                stageGone: !document.getElementById('raceFsStage')
            };
        });
        f6.beforeInMain ? pass('이식 UI(canvasResultCenter) 메인 생성') : fail('이식 UI 미생성 — 시나리오 무효');
        info(`전체화면 중 스케일 루트 자식: [${f6.mid.rootChildren.join(', ')}]`);
        f6.mid.centerInRoot ? pass('진입 시 center가 스케일 루트로 재앵커 (함께 스케일)') : fail('center 재앵커 실패');
        f6.mid.centerBeforeWrapper ? pass('center가 래퍼 앞 형제 (앵커 계약 유지)') : fail('center 위치 이상');
        f6.afterCenterInMain ? pass('종료 sweep: center 메인 복귀') : fail('center 유실');
        f6.afterOrder ? pass('종료 sweep: center → 래퍼 순서 보존') : fail('복귀 순서 뒤바뀜');
        f6.stageGone ? pass('종료 후 스테이지 제거') : fail('스테이지 잔존');

        section('F7. 멱등성 (중복 enter/exit)');
        const f7 = await h.evaluate(async () => {
            raceFsExit(); raceFsExit(); // 비활성 상태 중복 종료
            const afterDoubleExit = { active: _raceFsActive, stage: !!document.getElementById('raceFsStage') };
            raceFsEnter();
            await new Promise(r => setTimeout(r, 300));
            raceFsEnter(); // 중복 진입
            await new Promise(r => setTimeout(r, 300));
            const stages = document.querySelectorAll('.race-fs-stage').length;
            const roots = document.querySelectorAll('.race-fs-scale-root').length;
            const wrappers = document.querySelectorAll('#raceTrackWrapper').length;
            raceFsExit(); raceFsExit();
            await new Promise(r => setTimeout(r, 300));
            return {
                afterDoubleExit, stages, roots, wrappers,
                finalActive: _raceFsActive,
                finalStage: !!document.getElementById('raceFsStage'),
                finalWrappers: document.querySelectorAll('#raceTrackWrapper').length
            };
        });
        f7.afterDoubleExit.active === false && !f7.afterDoubleExit.stage ? pass('비활성 중복 종료 무해') : fail('중복 종료 부작용');
        f7.stages === 1 && f7.roots === 1 ? pass('중복 진입에도 스테이지/루트 각 1개') : fail(`중복 생성: stage=${f7.stages} root=${f7.roots}`);
        f7.wrappers === 1 ? pass('래퍼 중복 없음') : fail(`래퍼 ${f7.wrappers}개`);
        f7.finalActive === false && !f7.finalStage && f7.finalWrappers === 1 ? pass('중복 종료 후 상태 청정') : fail('종료 후 잔존');

        section('F8. PiP 상호배타');
        const f8a = await h.evaluate((inject) => {
            eval('(' + inject + ')()');
            racePipAttachTrack(); // PiP attach — attachTrack이 버튼 가용성 갱신
            const mock = window.__mockPip;
            const btnInPip = mock.document.getElementById('raceFullscreenBtn');
            const before = { display: btnInPip ? btnInPip.style.display : 'MISSING', disabled: btnInPip ? !!btnInPip.disabled : null };
            raceFsEnter(); // 차단돼야 함
            return {
                attached: racePipAttached(),
                btn: before,
                fsActive: _raceFsActive,
                stage: !!document.getElementById('raceFsStage') || !!mock.document.getElementById('raceFsStage')
            };
        }, INJECT_MOCK.toString());
        f8a.attached ? pass('mock PiP attach 성립') : fail('mock attach 실패');
        f8a.btn.display === 'none' && f8a.btn.disabled ? pass('PiP attach 중 전체화면 버튼 숨김 + disabled') : fail(`버튼 상태: ${JSON.stringify(f8a.btn)}`);
        f8a.fsActive === false && !f8a.stage ? pass('PiP attach 중 전체화면 진입 차단 (상호배타)') : fail('PiP 중 전체화면 진입됨');

        const f8b = await h.evaluate(() => {
            toggleRacePip(); // PiP 닫기 → 래퍼 복귀 + 버튼 재노출
            const btn = document.getElementById('raceFullscreenBtn');
            return { attached: racePipAttached(), display: btn ? btn.style.display : 'MISSING', disabled: btn ? !!btn.disabled : null };
        });
        !f8b.attached ? pass('PiP 닫기 → 미attach') : fail('PiP 닫기 실패');
        f8b.display !== 'none' && f8b.disabled === false ? pass('PiP 닫기 후 전체화면 버튼 재노출 + 활성') : fail(`버튼 상태: ${JSON.stringify(f8b)}`);

        const f8c = await h.evaluate(async () => {
            raceFsEnter();
            await new Promise(r => setTimeout(r, 400));
            const beforeOpen = { active: _raceFsActive, stage: !!document.getElementById('raceFsStage') };
            racePipOpen(); // 진입부에서 raceFsExit()가 동기 실행돼야 한다 (requestWindow는 헤드리스에서 미해결)
            const afterOpen = {
                active: _raceFsActive,
                stage: !!document.getElementById('raceFsStage'),
                wrapperInMain: !!document.getElementById('raceTrackWrapper'),
                bodyOverflow: document.body.style.overflow
            };
            raceFsExit();
            return { beforeOpen, afterOpen };
        });
        f8c.beforeOpen.active && f8c.beforeOpen.stage ? pass('전체화면 활성 상태 확보') : fail('전체화면 진입 실패');
        f8c.afterOpen.active === false ? pass('PiP open 진입부에서 전체화면 선종료 (동기)') : fail('PiP open 후에도 전체화면 활성');
        !f8c.afterOpen.stage && f8c.afterOpen.wrapperInMain ? pass('선종료로 스테이지 제거 + 래퍼 메인 유지') : fail('선종료 정리 미흡');
        f8c.afterOpen.bodyOverflow !== 'hidden' ? pass('선종료로 스크롤 잠금 해제') : fail('스크롤 잠금 잔존');

        section('F9. 레이스 중 진입 → 애니메이션 지속 → 중도 종료 → 정상 완주');
        {
            const allSel = waitEvent(h, 'allHorsesSelected', 15000);
            await A.g.evaluate(() => socket.emit('selectHorse', { horseIndex: 1 }));
            await allSel;
            const rp = waitEvent(h, 'horseRaceStarted', 50000);
            const rpg = waitEvent(A.g, 'horseRaceStarted', 50000);
            await h.waitForTimeout(200);
            await h.evaluate(() => socket.emit('startHorseRace'));
            await Promise.all([rp, rpg]);
            await h.waitForFunction(() => window._raceAnimFrameId != null, null, { timeout: 40000 });
            pass('레이스 구동 시작');

            const mid = await h.evaluate(async () => {
                raceFsEnter();
                await new Promise(r => setTimeout(r, 400));
                const horse = document.querySelector('#raceTrack [data-vehicle-id]') || document.querySelector('#raceTrack .race-horse');
                const p1 = horse ? (horse.style.left || horse.style.transform) : null;
                await new Promise(r => setTimeout(r, 700));
                const p2 = horse ? (horse.style.left || horse.style.transform) : null;
                const s = {
                    active: _raceFsActive,
                    wrapperInRoot: !!(document.getElementById('raceTrackWrapper')
                        && document.getElementById('raceFsScaleRoot')
                        && document.getElementById('raceTrackWrapper').parentNode === document.getElementById('raceFsScaleRoot')),
                    running: window._raceAnimFrameId != null,
                    animMain: window._raceAnimWin === window,
                    moved: !!(horse && p1 !== p2), found: !!horse
                };
                return s;
            });
            mid.active && mid.wrapperInRoot ? pass('레이스 중 전체화면 진입 (래퍼가 스케일 루트로 이동)') : fail('레이스 중 진입 실패');
            mid.running ? pass('레이스 중 진입 후에도 rAF 지속') : fail('진입이 레이스를 멈춤');
            mid.animMain ? pass('드라이버 창 메인 유지 (전체화면은 같은 문서)') : fail('드라이버 오염');
            mid.found ? (mid.moved ? pass('전체화면 중 말 위치 전진 (애니메이션 지속)') : fail('전체화면 중 말 정지')) : info('말 셀렉터 미매치 — 전진 검증 생략');

            await h.evaluate(() => raceFsExit());
            await h.waitForTimeout(400);
            const midExit = await h.evaluate(() => ({
                active: _raceFsActive,
                stage: !!document.getElementById('raceFsStage'),
                running: window._raceAnimFrameId != null,
                wrapperInMain: !!document.getElementById('raceTrackWrapper')
            }));
            !midExit.active && !midExit.stage ? pass('레이스 중 종료 정리') : fail('레이스 중 종료 실패');
            midExit.running ? pass('종료 후에도 레이스 지속') : fail('종료가 레이스를 멈춤');
            midExit.wrapperInMain ? pass('종료 후 래퍼 메인') : fail('래퍼 유실');

            await h.waitForFunction(() =>
                Array.isArray(window.lastActualFinishOrder) && window.lastActualFinishOrder.length > 0,
                null, { timeout: 90000 });
            pass('레이스 정상 완주 (전체화면 진입·종료 후 무회귀)');
            const hostOrder = await h.evaluate(() => window.lastActualFinishOrder);
            const guestOrder = await A.g.waitForFunction(() =>
                Array.isArray(window.lastActualFinishOrder) && window.lastActualFinishOrder.length > 0,
                null, { timeout: 90000 }).then(() => A.g.evaluate(() => window.lastActualFinishOrder));
            JSON.stringify(hostOrder) === JSON.stringify(guestOrder)
                ? pass(`호스트/게스트 완주 순서 동일: [${hostOrder}] (공정성 무영향)`)
                : fail('완주 순서 불일치', `host=[${hostOrder}] guest=[${guestOrder}]`);
            await h.waitForFunction(() => {
                const ro = document.getElementById('resultOverlay');
                return ro && ro.classList.contains('visible');
            }, null, { timeout: 30000 });
            pass('결과 오버레이 표시');
        }

        await A.hCtx.close();
        await A.gCtx.close();

        // ═══════════ [G] 폴백 3경로 + 뷰포트 기하 스윕 ═══════════
        const FALLBACKS = [
            {
                tag: '미지원',
                init: () => { delete Element.prototype.requestFullscreen; delete Document.prototype.exitFullscreen; },
                desc: 'requestFullscreen 부재 (아이폰 사파리 등가)'
            },
            {
                tag: 'reject',
                init: () => { Element.prototype.requestFullscreen = function () { return Promise.reject(new DOMException('denied', 'NotAllowedError')); }; },
                desc: 'requestFullscreen 거부 (권한/제스처 소실)'
            },
            {
                tag: '동기throw',
                init: () => { Element.prototype.requestFullscreen = function () { throw new TypeError('sync throw'); }; },
                desc: 'requestFullscreen 동기 throw (구형 구현)'
            }
        ];

        for (const fb of FALLBACKS) {
            section(`G. 폴백 경로 — ${fb.tag} (${fb.desc})`);
            const F = await setupRoom(browser, errors, fb.tag, fb.init);
            const p = F.h;
            const prevOverflow = await p.evaluate(() => document.body.style.overflow);
            await p.click('#raceFullscreenBtn');
            await p.waitForTimeout(700);
            const s = await p.evaluate(SNAP);
            s.active ? pass(`${fb.tag}: 진입 성공`) : fail(`${fb.tag}: 진입 실패`);
            s.cssFallback ? pass(`${fb.tag}: CSS 의사 전체화면으로 전환`) : fail(`${fb.tag}: 폴백 미전환 (cssFallback=false)`);
            s.stageClass && s.stageClass.includes('race-fs-css') ? pass(`${fb.tag}: .race-fs-css 적용`) : fail(`${fb.tag}: 클래스 ${s.stageClass}`);
            s.stageClass && !s.stageClass.includes('race-fs-api') ? pass(`${fb.tag}: race-fs-api 클래스 미잔존`) : fail(`${fb.tag}: api 클래스 잔존`);
            s.bodyOverflow === 'hidden' ? pass(`${fb.tag}: 페이지 스크롤 잠금`) : fail(`${fb.tag}: body overflow=${s.bodyOverflow}`);
            !s.fsElementIsStage ? pass(`${fb.tag}: 실제 전체화면 미진입 (폴백이므로 정상)`) : fail(`${fb.tag}: 예상 외 실제 전체화면`);
            s.wrapperInRoot && s.rootInStage ? pass(`${fb.tag}: 2단 구조 성립`) : fail(`${fb.tag}: 구조 이상`);
            s.label.includes(LABEL_FS_ON) ? pass(`${fb.tag}: 라벨 전이`) : fail(`${fb.tag}: 라벨 ${s.label}`);
            assertGeometry(s, fb.tag);

            if (fb.tag === '미지원') {
                // 뷰포트 스윕은 폴백 경로에서 (실제 전체화면이 뷰포트 변경에 간섭하지 않음)
                for (const vp of [{ w: 1920, h: 1080 }, { w: 1366, h: 768 }, { w: 390, h: 844 }, { w: 844, h: 390 }]) {
                    await p.setViewportSize({ width: vp.w, height: vp.h });
                    await p.waitForTimeout(400);
                    const sv = await p.evaluate(SNAP);
                    if (!sv.active) { fail(`뷰포트 ${vp.w}x${vp.h}: 전체화면이 풀림`); continue; }
                    assertGeometry(sv, `${vp.w}x${vp.h}`);
                }
                await p.setViewportSize({ width: 1280, height: 720 });
                await p.waitForTimeout(300);
            }

            // 종료 정리
            await p.click('#raceFullscreenBtn');
            await p.waitForTimeout(500);
            const e = await p.evaluate(() => ({
                active: _raceFsActive,
                cssFallback: _raceFsCssFallback,
                stage: !!document.getElementById('raceFsStage'),
                root: !!document.getElementById('raceFsScaleRoot'),
                bodyOverflow: document.body.style.overflow,
                wrapperInMain: !!document.getElementById('raceTrackWrapper'),
                label: (document.getElementById('raceFullscreenBtn') || {}).textContent || 'MISSING'
            }));
            !e.active && !e.cssFallback ? pass(`${fb.tag}: 종료 상태 플래그 청정`) : fail(`${fb.tag}: 플래그 잔존`);
            !e.stage && !e.root ? pass(`${fb.tag}: 컨테이너 제거`) : fail(`${fb.tag}: 컨테이너 잔존`);
            e.bodyOverflow === prevOverflow ? pass(`${fb.tag}: body overflow 원복 ("${prevOverflow}")`) : fail(`${fb.tag}: overflow "${e.bodyOverflow}" ≠ 원래 "${prevOverflow}"`);
            e.wrapperInMain ? pass(`${fb.tag}: 래퍼 메인 복귀`) : fail(`${fb.tag}: 래퍼 유실`);
            e.label.includes(LABEL_FS_IDLE) && !e.label.includes(LABEL_FS_ON) ? pass(`${fb.tag}: 라벨 원복`) : fail(`${fb.tag}: 라벨 ${e.label}`);

            await F.hCtx.close();
            await F.gCtx.close();
        }

        section('콘솔/페이지 에러 집계');
        const known = errors.filter(e => !/favicon|adsbygoogle|ERR_BLOCKED_BY|googlesyndication|google|net::/i.test(e));
        known.length === 0
            ? pass(`JS 에러 0건 (네트워크 잡음 ${errors.length - known.length}건 제외)`)
            : fail(`JS 에러 ${known.length}건`, known.slice(0, 6).join(' | '));

    } catch (e) {
        fail('테스트 실행 예외', e.message);
        if (errors.length) console.log('  콘솔 에러:', errors.slice(0, 10).join('\n  '));
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
