// QA (일회성 라이브 검증): 경마 탈것 통계 모달 + 랭킹 시즌 우승 탈것 섹션 — 실브라우저 2탭
//
// 검증 계약 (docs/goal/horse-vehicle-stats-ui.md):
//   M1: 방 생성/입장 2탭 — 양 탭 모두 "📊 탈것 통계" 버튼 노출 (선택 화면 헤더)
//   M2: 모달 열림 — 테이블(탈것/출전/선택률/1위/승률) 또는 빈 문구, 소켓 ack {ok:true, stats[]}
//   M3: 닫기 버튼 + 오버레이 배경 클릭 양쪽으로 닫힘 (+ 카드 내부 클릭은 유지)
//   M4: 빈 데이터 분기 — "아직 집계된 기록이 없습니다."
//   M8: 경기 회귀 — short 트랙 1회 완주, 결과 오버레이, horseSelectionReady 배지 경로 정상
//   M9: 모바일 375px — 모달 카드 화면 안 + 스크롤 가능, 헤더 버튼 줄바꿈 수용 (+ 오버플로 귀속 판정)
//   M5: 게이트 회귀 — 비-localhost 호스트네임에서 통계 버튼 보임 + 상점 버튼 숨김 / localhost에선 상점 버튼 보임
//   M6: 랭킹 free 모드(horse/dice) — 우승탈것 섹션 미표시(빈 박스 없음) + 렌더 정상
//   M7: 랭킹 서버 모드(시드 데이터, dice 페이지 크로스게임) — 🥇🥈🥉 3칩 + 정렬 + N승 표기
//   M10: 제품 코드 콘솔 에러 0
//
// 실행 순서 주의: 경기 회귀(M8)를 무거운 단계(제2 브라우저/랭킹 오버레이)보다 먼저 돌린다 —
// 테스트 환경 부하로 인한 컨텍스트 파괴 플레이크와 제품 회귀를 분리하기 위함.
//
// 전제: 로컬 서버(5173) + 로컬 PostgreSQL(M7 시드용). 실행: node AutoTest/qa-vehicle-stats-ui-browser-test.js
const { chromium } = require('playwright');
require('../config');
const { initPool, getPool } = require('../db/pool');

const URL = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    let pass = true;
    const check = (cond, label, detail) => {
        console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? '  [' + detail + ']' : ''));
        if (!cond) pass = false;
    };

    // ── M7 시드: QA 서버 + 시즌 탈것 통계 (current_season=2) ──
    initPool();
    const pool = getPool();
    let seedSid = null;
    if (pool) {
        const sv = await pool.query(
            `INSERT INTO servers (name, host_id, host_name, current_season) VALUES ('QA탈것UI테스트', 'qa-vstats-ui-host', 'qa', 2) RETURNING id`);
        seedSid = sv.rows[0].id;
        await pool.query(
            `INSERT INTO vehicle_season_stats (server_id, season, vehicle_id, appearance_count, pick_count, rank_1) VALUES
             ($1, 2, 'rocket', 10, 12, 6), ($1, 2, 'turtle', 10, 5, 3), ($1, 2, 'crab', 8, 2, 1), ($1, 2, 'bird', 9, 1, 0)`,
            [seedSid]);
        console.log('M7 시드 서버 id:', seedSid);
    } else {
        console.log('로컬 DB 없음 — M7(서버 모드 우승탈것)은 SKIP');
    }

    const hostName = 'qvst' + Date.now().toString(36).slice(-6);
    const guestName = 'qvsg' + Date.now().toString(36).slice(-6);

    const browser = await chromium.launch();
    const errs = [];
    const collect = (tag, page) => {
        page.on('console', m => { if (m.type() === 'error') errs.push('[' + tag + '] ' + m.text()); });
        page.on('pageerror', e => errs.push('[' + tag + '] ' + String(e)));
        page.on('framenavigated', f => {
            if (f === page.mainFrame()) console.log('  [' + tag + ' NAV] ' + f.url());
        });
        page.on('load', () => console.log('  [' + tag + ' LOAD] 실제 문서 로드'));
        page.on('console', m => { if (/QAPROBE/.test(m.text())) console.log('  [' + tag + '] ' + m.text()); });
    };
    // 소켓 재연결 관찰 훅 (진단용)
    const socketProbe = (page) => page.addInitScript(() => {
        window.addEventListener('DOMContentLoaded', () => {
            const iv = setInterval(() => {
                if (typeof socket !== 'undefined' && socket) {
                    clearInterval(iv);
                    socket.on('connect', () => console.log('QAPROBE connect', socket.id));
                    socket.on('disconnect', r => console.log('QAPROBE disconnect', r));
                }
            }, 200);
        });
    });

    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const hostPage = await hostCtx.newPage();
    const guestPage = await guestCtx.newPage();
    collect('H', hostPage); collect('G', guestPage);

    // ── 1. 호스트 방 생성 (free 방) ──
    await socketProbe(hostPage);
    await hostPage.addInitScript(args => {
        localStorage.setItem('tutorialSeen_horse', 'v1');
        localStorage.setItem('userName', args.name);
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: args.name, roomName: 'qa-vstats-ui', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    }, { name: hostName });
    await hostPage.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
    await hostPage.waitForFunction(() => {
        return location.pathname.indexOf('/free/') === 0
            && typeof currentRoomId !== 'undefined' && !!currentRoomId
            && typeof socket !== 'undefined' && socket.connected;
    }, null, { timeout: 20000 });
    await wait(1200);
    const roomId = await hostPage.evaluate(() => (typeof currentRoomId !== 'undefined') ? currentRoomId : null);
    check(!!roomId, 'M0a: 호스트 방 생성', 'roomId=' + roomId);
    if (!roomId) { await browser.close(); process.exit(1); }

    // ── 2. 게스트 입장 ──
    await socketProbe(guestPage);
    await guestPage.addInitScript(args => {
        localStorage.setItem('tutorialSeen_horse', 'v1');
        localStorage.setItem('userName', args.name);
        localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({
            roomId: args.roomId, userName: args.name, isPrivate: false
        }));
    }, { name: guestName, roomId: roomId });
    await guestPage.goto(URL + '/horse-race?joinRoom=true', { waitUntil: 'domcontentloaded' });
    const guestIn = await guestPage.waitForFunction(() => {
        return location.pathname.indexOf('/free/') === 0
            && typeof currentRoomId !== 'undefined' && !!currentRoomId
            && typeof socket !== 'undefined' && socket.connected;
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    check(guestIn, 'M0b: 게스트 입장');
    await wait(1200);

    // ── M1: 양 탭 통계 버튼 노출 (선택 화면 헤더) ──
    const btnVisible = async (page) => page.evaluate(() => {
        const sec = document.getElementById('horseSelectionSection');
        const btn = document.querySelector('.vehicle-stats-open-btn');
        if (!sec || !btn) return { ok: false, why: 'missing' };
        const cs = getComputedStyle(btn);
        const box = btn.getBoundingClientRect();
        return {
            ok: sec.classList.contains('active') && cs.display !== 'none' && box.width > 0 && box.height > 0,
            secActive: sec.classList.contains('active'), display: cs.display, w: box.width
        };
    });
    const hb = await btnVisible(hostPage);
    const gb = await btnVisible(guestPage);
    check(hb.ok && gb.ok, 'M1: 양 탭 "📊 탈것 통계" 버튼 노출', JSON.stringify({ hb, gb }));

    // ── M2: 모달 열림 + 소켓 ack ──
    const ack = await hostPage.evaluate(() => new Promise(res => {
        const t = setTimeout(() => res({ timeout: true }), 8000);
        socket.emit('horse:requestVehicleStats', {}, r => { clearTimeout(t); res(r); });
    }));
    check(ack && ack.ok === true && Array.isArray(ack.stats),
        'M2a: horse:requestVehicleStats ack {ok:true, stats[]}', 'stats.length=' + (ack.stats ? ack.stats.length : 'n/a'));

    await hostPage.click('.vehicle-stats-open-btn');
    await wait(600); // ack 갱신 렌더 대기
    const modalState = await hostPage.evaluate(() => {
        const ov = document.getElementById('vehicleStatsOverlay');
        const body = document.getElementById('vehicleStatsBody');
        const table = body.querySelector('.vehicle-stats-table');
        const empty = body.querySelector('.vehicle-stats-empty');
        const heads = table ? [...table.querySelectorAll('th')].map(th => th.textContent) : [];
        return {
            visible: ov.classList.contains('visible'),
            hasTable: !!table, hasEmpty: !!empty,
            heads, rowCount: table ? table.querySelectorAll('tbody tr').length : 0,
            emptyText: empty ? empty.textContent : ''
        };
    });
    const headsOk = !modalState.hasTable || (modalState.heads.join(',') === '탈것,출전,선택률,1위,승률');
    check(modalState.visible && (modalState.hasTable || modalState.hasEmpty) && headsOk,
        'M2b: 모달 열림 + 테이블 컬럼(탈것/출전/선택률/1위/승률) 또는 빈 문구', JSON.stringify(modalState));
    // 데이터가 있으면 승률 내림차순 정렬 확인
    if (modalState.hasTable && modalState.rowCount >= 2) {
        const sortedOk = await hostPage.evaluate(() => {
            const rows = [...document.querySelectorAll('#vehicleStatsBody tbody tr')];
            const rates = rows.map(r => parseInt(r.cells[4].textContent));
            return rates.every((v, i) => i === 0 || rates[i - 1] >= v);
        });
        check(sortedOk, 'M2c: 승률 내림차순 정렬');
    } else {
        console.log('INFO — M2c: 데이터 행 <2 (로컬 통계 없음) — 정렬은 빈/단일 상태로 자연 통과');
    }
    // M2d: 저표본(<5 출전) 마킹 일관성 — 런타임 데이터 주입으로 양방향 검증
    const lowSample = await hostPage.evaluate(() => {
        const saved = vehicleStatsData;
        vehicleStatsData = [
            { vehicle_id: 'rocket', appearance_count: 10, pick_count: 3, rank_1: 5 },
            { vehicle_id: 'turtle', appearance_count: 4, pick_count: 1, rank_1: 4 }
        ];
        renderVehicleStatsTable();
        const rows = [...document.querySelectorAll('#vehicleStatsBody tbody tr')];
        const r = rows.map(tr => ({
            low: tr.classList.contains('vstats-low-sample'),
            label: !!tr.querySelector('.vstats-low-label'),
            first: tr.cells[0].textContent
        }));
        vehicleStatsData = saved;
        renderVehicleStatsTable();
        return r;
    });
    const turtleRow = lowSample.find(r => r.first.includes('거북이'));
    const rocketRow = lowSample.find(r => r.first.includes('로켓'));
    check(turtleRow && turtleRow.low && turtleRow.label && rocketRow && !rocketRow.low && !rocketRow.label,
        'M2d: 출전<5 행만 흐림+기록부족 마킹 (양방향)', JSON.stringify(lowSample));

    // ── M3: 닫기 버튼 → 재열기 → 배경 클릭 닫기 ──
    await hostPage.click('#vehicleStatsOverlay .vehicle-stats-card button');
    const closedByBtn = await hostPage.evaluate(() => !document.getElementById('vehicleStatsOverlay').classList.contains('visible'));
    await hostPage.click('.vehicle-stats-open-btn');
    await wait(300);
    // 배경(오버레이 자체) 클릭 — 카드 밖 좌상단 좌표
    await hostPage.mouse.click(15, 15);
    const closedByBg = await hostPage.evaluate(() => !document.getElementById('vehicleStatsOverlay').classList.contains('visible'));
    check(closedByBtn && closedByBg, 'M3: 닫기 버튼 + 배경 클릭 양쪽 닫힘', 'btn=' + closedByBtn + ' bg=' + closedByBg);
    // 카드 내부 클릭은 닫히지 않아야 함
    await hostPage.click('.vehicle-stats-open-btn');
    await wait(200);
    await hostPage.click('.vehicle-stats-card h2');
    const stillOpen = await hostPage.evaluate(() => document.getElementById('vehicleStatsOverlay').classList.contains('visible'));
    check(stillOpen, 'M3b: 카드 내부 클릭 시 닫히지 않음');
    await hostPage.evaluate(() => closeVehicleStatsModal());

    // ── M4: 빈 데이터 분기 (런타임 상태로 강제 — 코드 수정 아님) ──
    const emptyBranch = await hostPage.evaluate(() => {
        const saved = vehicleStatsData;
        vehicleStatsData = [];
        renderVehicleStatsTable();
        const txt = document.getElementById('vehicleStatsBody').textContent.trim();
        vehicleStatsData = saved;
        renderVehicleStatsTable();
        return txt;
    });
    check(emptyBranch === '아직 집계된 기록이 없습니다.', 'M4: 빈 데이터 문구', 'text="' + emptyBranch + '"');

    // ── M8: 경기 회귀 — short 트랙 1회 완주 (무거운 단계보다 먼저) ──
    await hostPage.evaluate(() => socket.emit('setTrackLength', { trackLength: 'short' }));
    const selOnce = (page, idx) => page.evaluate(i => new Promise(res => {
        const t = setTimeout(() => res(false), 8000);
        socket.once('horseSelectionUpdated', () => { clearTimeout(t); res(true); });
        socket.emit('selectHorse', { horseIndex: i });
    }), idx);
    const s1 = await selOnce(hostPage, 0);
    const s2 = await selOnce(guestPage, 1);
    check(s1 && s2, 'M8a: 양측 말 선택', 'host=' + s1 + ' guest=' + s2);

    const raceDone = await hostPage.evaluate(() => new Promise(res => {
        const t = setTimeout(() => res({ started: false, timeout: true, errs: window._raceErrs }), 45000);
        let started = false;
        window._raceErrs = [];
        socket.on('horseRaceError', d => window._raceErrs.push(d));
        socket.once('horseRaceStarted', () => { started = true; });
        socket.once('horseRaceEnded', () => { clearTimeout(t); res({ started, ended: true }); });
        socket.emit('startHorseRace');
        setTimeout(() => { if (!started) { clearTimeout(t); res({ started: false, errs: window._raceErrs }); } }, 15000);
    }));
    check(raceDone.started && raceDone.ended, 'M8b: short 트랙 레이스 시작→종료', JSON.stringify(raceDone));
    await wait(2500); // 결과 연출
    const postRace = await hostPage.evaluate(() => ({
        resultVisible: document.getElementById('resultOverlay').classList.contains('visible'),
        selectionRestored: document.getElementById('horseSelectionSection').classList.contains('active'),
        statsIsArray: Array.isArray(vehicleStatsData)
    }));
    check(postRace.resultVisible && postRace.statsIsArray,
        'M8c: 결과 오버레이 + vehicleStatsData 배열 유지(배지 경로)', JSON.stringify(postRace));

    // 레이스 후 모달 재열기 — 방금 경기 반영된 통계 요청 재확인
    await hostPage.evaluate(() => closeResultOverlay());
    const ack2 = await hostPage.evaluate(() => new Promise(res => {
        const t = setTimeout(() => res({ timeout: true }), 8000);
        socket.emit('horse:requestVehicleStats', {}, r => { clearTimeout(t); res(r); });
    }));
    check(ack2 && ack2.ok === true && Array.isArray(ack2.stats) && ack2.stats.length > 0,
        'M8d: 경기 후 통계 조회 — 기록 반영(stats.length>0)', 'len=' + (ack2.stats ? ack2.stats.length : 'n/a'));

    // ── M9: 모바일 375px ──
    await hostPage.setViewportSize({ width: 375, height: 812 });
    await wait(400);
    // 오버플로 귀속: 모달 열기 전 페이지 자체의 가로 오버플로 측정
    const preModal = await hostPage.evaluate(() => ({
        bodyNoHorizScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
        scrollW: document.documentElement.scrollWidth, vw: window.innerWidth
    }));
    await hostPage.evaluate(() => openVehicleStatsModal());
    await wait(600);
    const mobile = await hostPage.evaluate(() => {
        const card = document.querySelector('.vehicle-stats-card');
        const box = card.getBoundingClientRect();
        const header = document.querySelector('.horse-selection-header');
        return {
            cardLeft: box.left, cardRight: box.right, vw: window.innerWidth,
            cardInViewport: box.left >= 0 && box.right <= window.innerWidth + 0.5,
            cardScrollable: card.scrollHeight >= card.clientHeight, // overflow-y:auto 동작 가능
            headerNoHorizOverflow: header ? header.scrollWidth <= header.clientWidth + 1 : null,
            bodyNoHorizScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
            scrollW: document.documentElement.scrollWidth
        };
    });
    const modalCausedOverflow = preModal.bodyNoHorizScroll && !mobile.bodyNoHorizScroll;
    check(mobile.cardInViewport && mobile.headerNoHorizOverflow !== false && !modalCausedOverflow,
        'M9: 모바일 375px — 카드 화면 안 + 헤더 오버플로 없음 + 모달 유발 가로 오버플로 없음',
        JSON.stringify({ preModal, mobile }));
    if (!preModal.bodyNoHorizScroll) {
        // 기존 페이지 오버플로 원인 요소 추적 (이번 변경 귀속 판정용 정보)
        const culprit = await hostPage.evaluate(() => {
            let worst = null;
            document.querySelectorAll('body *').forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.right > window.innerWidth + 1 && (!worst || r.right > worst.right)) {
                    worst = { right: Math.round(r.right), tag: el.tagName, cls: String(el.className).slice(0, 60), id: el.id };
                }
            });
            return worst;
        });
        console.log('INFO — M9: 모달 열기 전부터 페이지 가로 오버플로 존재 (기존 이슈, 이번 변경 아님):', JSON.stringify(culprit));
    }
    await hostPage.evaluate(() => closeVehicleStatsModal());
    await hostPage.setViewportSize({ width: 1280, height: 800 });

    // ── M5: 게이트 회귀 ──
    // localhost: 상점 버튼 보임(isLocalhost 게이트) + 통계 버튼 보임
    const localGate = await hostPage.evaluate(() => {
        const shop = document.querySelector('.hshop-open-btn');
        const stats = document.querySelector('.vehicle-stats-open-btn');
        return {
            shopShown: shop && getComputedStyle(shop).display !== 'none',
            statsShown: stats && getComputedStyle(stats).display !== 'none'
        };
    });
    check(localGate.shopShown && localGate.statsShown, 'M5a: localhost — 상점 버튼 보임 + 통계 버튼 보임', JSON.stringify(localGate));

    // 비-localhost 호스트네임 (host-resolver-rules로 가짜 도메인 → 127.0.0.1)
    const nlBrowser = await chromium.launch({ args: ['--host-resolver-rules=MAP qa-nonlocal.test 127.0.0.1'] });
    const nlCtx = await nlBrowser.newContext({ viewport: { width: 1280, height: 800 } });
    const nlPage = await nlCtx.newPage();
    collect('NL', nlPage);
    const nlName = 'qvnl' + Date.now().toString(36).slice(-6);
    await nlPage.addInitScript(args => {
        localStorage.setItem('tutorialSeen_horse', 'v1');
        localStorage.setItem('userName', args.name);
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: args.name, roomName: 'qa-vstats-nl', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    }, { name: nlName });
    await nlPage.goto('http://qa-nonlocal.test:5173/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
    const nlIn = await nlPage.waitForFunction(() => {
        return typeof currentRoomId !== 'undefined' && !!currentRoomId
            && typeof socket !== 'undefined' && socket.connected;
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    if (nlIn) {
        await wait(1200);
        const nlGate = await nlPage.evaluate(() => {
            const shop = document.querySelector('.hshop-open-btn');
            const stats = document.querySelector('.vehicle-stats-open-btn');
            const sec = document.getElementById('horseSelectionSection');
            return {
                isLocal: typeof isLocalhost !== 'undefined' ? isLocalhost : null,
                secActive: sec && sec.classList.contains('active'),
                shopShown: shop && getComputedStyle(shop).display !== 'none',
                statsShown: stats && getComputedStyle(stats).display !== 'none'
            };
        });
        check(nlGate.isLocal === false && nlGate.secActive && nlGate.statsShown === true && !nlGate.shopShown,
            'M5b: 비-localhost — 통계 버튼 보임 + 상점 버튼 숨김', JSON.stringify(nlGate));
        // 비-localhost에서도 모달 정상 동작
        await nlPage.click('.vehicle-stats-open-btn');
        await wait(500);
        const nlModal = await nlPage.evaluate(() => {
            const ov = document.getElementById('vehicleStatsOverlay');
            const body = document.getElementById('vehicleStatsBody');
            return { visible: ov.classList.contains('visible'), hasContent: body.children.length > 0 };
        });
        check(nlModal.visible && nlModal.hasContent, 'M5c: 비-localhost 모달 열림+렌더', JSON.stringify(nlModal));
        await nlPage.evaluate(() => socket.emit('leaveRoom'));
    } else {
        check(false, 'M5b: 비-localhost 방 생성 실패 — 게이트 검증 불가');
    }
    await nlBrowser.close();

    // ── M6: 랭킹 free 모드 — 섹션 미표시 (horse 페이지) ──
    const freeChamps = await hostPage.evaluate(async () => {
        RankingModule.show();
        await new Promise(r => setTimeout(r, 1500));
        const slot = document.getElementById('ranking-vehicle-champs');
        const content = document.getElementById('ranking-content');
        const r = {
            slotExists: !!slot,
            slotEmpty: slot ? slot.innerHTML.trim() === '' : null,
            contentRendered: content ? content.children.length > 0 : false
        };
        RankingModule.hide(); // history 엔트리 정리 포함 (forceHide는 pushState 잔존)
        return r;
    });
    check(freeChamps.slotExists && freeChamps.slotEmpty === true && freeChamps.contentRendered,
        'M6a: horse free 랭킹 — 우승탈것 슬롯 빈 상태 + 본문 렌더 정상', JSON.stringify(freeChamps));
    await wait(1000); // hide()의 history.back() 트래버설 안착 대기 (연속 history 조작 레이스 방지)

    // dice 로비 페이지 크로스게임
    const dicePage = await hostCtx.newPage();
    collect('D', dicePage);
    await dicePage.goto(URL + '/game', { waitUntil: 'domcontentloaded' });
    await wait(1500);
    const diceFree = await dicePage.evaluate(async () => {
        if (typeof RankingModule === 'undefined') return { noModule: true };
        RankingModule.init(null, 'qa-dice-viewer');
        RankingModule.show();
        await new Promise(r => setTimeout(r, 1500));
        const slot = document.getElementById('ranking-vehicle-champs');
        const content = document.getElementById('ranking-content');
        const r = {
            slotExists: !!slot,
            slotEmpty: slot ? slot.innerHTML.trim() === '' : null,
            contentRendered: content ? content.children.length > 0 : false
        };
        RankingModule.hide();
        return r;
    });
    check(!diceFree.noModule && diceFree.slotExists && diceFree.slotEmpty === true && diceFree.contentRendered,
        'M6b: dice 페이지 free 랭킹 — 우승탈것 슬롯 빈 상태 + 본문 렌더 정상', JSON.stringify(diceFree));
    await wait(1000); // hide()의 history.back() 트래버설 안착 대기

    // ── M7: 랭킹 서버 모드 (시드) — dice 페이지에서 크로스게임 검증 ──
    if (seedSid) {
        const champs = await dicePage.evaluate(async (sid) => {
            RankingModule.init(sid, 'qa-dice-viewer');
            RankingModule.invalidateCache && RankingModule.invalidateCache();
            RankingModule.show();
            // 칩 렌더 대기 (최대 8s)
            const t0 = Date.now();
            let bar = null;
            while (Date.now() - t0 < 8000) {
                bar = document.querySelector('#ranking-vehicle-champs .rk-vchamp-bar');
                if (bar) break;
                await new Promise(r => setTimeout(r, 200));
            }
            if (!bar) { RankingModule.hide(); return { noBar: true }; }
            const chips = [...bar.querySelectorAll('.rk-vchamp-chip')].map(c => c.textContent.trim());
            const label = bar.querySelector('.rk-vchamp-label');
            const r = { chips, label: label ? label.textContent : '' };
            RankingModule.hide();
            return r;
        }, seedSid);
        const chipsOk = champs.chips && champs.chips.length === 3
            && champs.chips[0].includes('🥇') && champs.chips[0].includes('로켓') && champs.chips[0].includes('6승')
            && champs.chips[1].includes('🥈') && champs.chips[1].includes('거북이') && champs.chips[1].includes('3승')
            && champs.chips[2].includes('🥉') && champs.chips[2].includes('게') && champs.chips[2].includes('1승');
        check(!champs.noBar && chipsOk && champs.label === '시즌 우승 탈것',
            'M7: 서버 랭킹 — 🥇로켓6승/🥈거북이3승/🥉게1승 3칩 + 라벨 (dice 페이지)', JSON.stringify(champs));
    } else {
        console.log('SKIP — M7: 로컬 DB 없음');
    }
    await dicePage.close();

    // ── M10: 콘솔 에러 ──
    const realErrs = errs.filter(e => !/favicon|sound-config|\.mp3|ERR_|net::|Failed to load resource|AdSense|adsbygoogle|TagError|googlesyndication|pagead|report-only Content Security Policy/i.test(e));
    check(realErrs.length === 0, 'M10: 제품 코드 콘솔 에러 0', realErrs.slice(0, 5).join(' | ') || 'clean');

    await browser.close();

    // 시드 정리
    if (pool && seedSid) {
        await pool.query(`DELETE FROM servers WHERE id = $1`, [seedSid]).catch(() => {});
    }

    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
    process.exit(pass ? 0 : 1);
})().catch(e => {
    console.error('TEST ERROR:', e);
    process.exit(2);
});
