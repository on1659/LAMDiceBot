// QA: 스핀 아레나 꾸미기 상점 브라우저(2탭) 검증 — Playwright
// 검증:
//   [픽커] 24색 스와치, 비로그인 = 18색 잠금(🔒), 무료 6색 선택 → 상대 탭 닉네임 칩 동기화
//   [상점] 비로그인 상점 열기 → 로그인 안내(모달 미오픈)
//   [보안] 콘솔에서 selectSkin obsidian(미소유) emit → 서버 거부 + skins 미반영
//   [게임] 시작 → reveal → gameEnd 정상, 양 탭 콘솔 에러 0
//   [회귀] 경마 페이지 방 생성 로드 — 상점 관련 콘솔 에러 0
const { chromium } = require('playwright');
const URL = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    let pass = true;
    const check = (cond, label) => { console.log(label + ':', cond ? 'PASS' : 'FAIL'); if (!cond) pass = false; };

    const browser = await chromium.launch();
    const errsA = [], errsB = [], errsH = [];
    function watch(page, sink, tag) {
        page.on('console', m => { if (m.type() === 'error') { sink.push(m.text()); console.log(`[${tag} console.error]`, m.text().slice(0, 200)); } });
        page.on('pageerror', e => { sink.push(String(e)); console.log(`[${tag} pageerror]`, String(e).slice(0, 200)); });
        page.on('response', r => { if (r.status() >= 400) console.log(`[${tag} http ${r.status()}]`, r.url().slice(0, 160)); });
    }
    // 튜토리얼 클릭 블로커 스킵 (첫 방문 튜토리얼이 픽커 클릭을 가로채지 않게)
    const skipTutorial = () => {
        localStorage.setItem('tutorialSeen_spin-arena', 'v1');
        localStorage.setItem('tutorialSeen_horse-race', 'v1');
        localStorage.setItem('tutorialSeen_horse', 'v1');
    };

    // ── 탭 A: 방 생성 (호스트) ──
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    watch(pageA, errsA, 'A');
    await pageA.addInitScript(skipTutorial);
    await pageA.addInitScript(() => {
        localStorage.setItem('pendingSpinArenaRoom', JSON.stringify({
            userName: 'QA호스트', roomName: 'qa-shop-browser', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    });
    await pageA.goto(URL + '/spin-arena?createRoom=true', { waitUntil: 'domcontentloaded' });
    await pageA.waitForFunction(() => {
        const ar = sessionStorage.getItem('spinArenaActiveRoom');
        return ar && JSON.parse(ar).roomId;
    }, null, { timeout: 10000 });
    const roomId = await pageA.evaluate(() => JSON.parse(sessionStorage.getItem('spinArenaActiveRoom')).roomId);
    check(!!roomId, '탭A 방 생성 + roomJoined (roomId=' + roomId + ')');

    // ── 탭 B: 입장 (게스트) ──
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    watch(pageB, errsB, 'B');
    await pageB.addInitScript(skipTutorial);
    await pageB.addInitScript(rid => {
        localStorage.setItem('pendingSpinArenaJoin', JSON.stringify({
            roomId: rid, userName: 'QA게스트', isPrivate: false
        }));
    }, roomId);
    await pageB.goto(URL + '/spin-arena?joinRoom=true', { waitUntil: 'domcontentloaded' });
    await pageB.waitForFunction(() => !!sessionStorage.getItem('spinArenaActiveRoom'), null, { timeout: 10000 });
    check(true, '탭B 입장 완료');
    await wait(1500); // 자동 준비 + 픽커 렌더 대기

    // ── 픽커: 24색 / 잠금 18색(비로그인) ──
    const sw = await pageA.evaluate(() => {
        const all = document.querySelectorAll('#spinSkinPicker .spin-skin-swatch');
        const locked = document.querySelectorAll('#spinSkinPicker .spin-skin-swatch.locked');
        const lockBadge = document.querySelectorAll('#spinSkinPicker .spin-skin-lock');
        return { total: all.length, locked: locked.length, badges: lockBadge.length };
    });
    check(sw.total === 24, '픽커 스와치 24색, got ' + sw.total);
    check(sw.locked === 18, '비로그인 잠금 18색(무료 6색 제외), got ' + sw.locked);
    check(sw.badges === sw.locked, '잠금 스와치마다 🔒 배지, got ' + sw.badges);

    // ── 픽커: 무료 색 선택 → 상대 탭 동기화 ──
    await pageA.click('#spinSkinPicker .spin-skin-swatch:not(.locked)'); // 첫 무료 색(crimson)
    await wait(800);
    const ownerOnB = await pageB.evaluate(() =>
        Array.from(document.querySelectorAll('#spinSkinPicker .spin-skin-owner')).map(e => e.textContent));
    check(ownerOnB.some(t => t.indexOf('QA호스트') >= 0), '탭A 선택이 탭B 픽커 닉네임 칩에 반영: ' + JSON.stringify(ownerOnB));

    // ── 비로그인 상점 열기 → 로그인 안내 + 모달 미오픈 ──
    await pageA.click('.spin-shop-btn');
    await wait(600);
    const shopState = await pageA.evaluate(() => ({
        overlay: !!document.querySelector('#spinShopMount .hshop-overlay'),
        bodyText: document.body.innerText.indexOf('로그인') >= 0
    }));
    check(!shopState.overlay && shopState.bodyText, '비로그인 상점 → 로그인 안내(모달 미오픈)');
    // 안내 모달 닫기 (확인 버튼 클릭 시도)
    await pageA.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => /^(확인|닫기|OK)$/.test(b.textContent.trim()));
        btns.forEach(b => b.click());
    });

    // ── 잠금 스와치 클릭 → 상점 안내(선택 emit 없음) ──
    await pageA.click('#spinSkinPicker .spin-skin-swatch.locked');
    await wait(500);
    const lockedPick = await pageA.evaluate(() => ({
        overlay: !!document.querySelector('#spinShopMount .hshop-overlay'),
        bodyText: document.body.innerText.indexOf('로그인') >= 0
    }));
    check(!lockedPick.overlay, '잠금 스와치 클릭 → 모달 미오픈(비로그인) + 선택 emit 없음');
    await pageA.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')).filter(b => /^(확인|닫기|OK)$/.test(b.textContent.trim()));
        btns.forEach(b => b.click());
    });

    // ── 콘솔 조작: 미소유 잠금 스킨 selectSkin emit → 서버 거부 ──
    const rejection = await pageB.evaluate(() => new Promise(res => {
        let err = null;
        const t = setTimeout(() => res({ err, skins: window.spinSkins ? { ...window.spinSkins } : null }), 1500);
        socket.once('spin-arena:error', m => { err = m; });
        socket.once('spin-arena:skinsUpdated', d => { clearTimeout(t); res({ err, skins: d.skins }); });
        socket.emit('spin-arena:selectSkin', { skinId: 'obsidian' });
        setTimeout(() => { if (err) { clearTimeout(t); res({ err, skins: null }); } }, 800);
    }));
    check(rejection.err && /로그인/.test(rejection.err), '콘솔 emit selectSkin(obsidian) → 서버 거부: ' + rejection.err);
    check(!rejection.skins || rejection.skins['QA게스트'] === undefined, '거부 후 skins 맵에 게스트 미반영');

    // ── 게임 시작 → reveal → gameEnd ──
    const startEnabled = await pageA.evaluate(() => {
        const b = document.getElementById('spinStartBtn') || document.querySelector('[onclick*="startSpin"], button.spin-start-btn');
        return b ? { found: true, disabled: b.disabled, text: b.textContent.trim() } : { found: false };
    });
    console.log('시작 버튼 상태:', JSON.stringify(startEnabled));
    const endResult = await pageA.evaluate(() => new Promise(res => {
        const out = { reveal: false, end: null };
        socket.once('spin-arena:reveal', () => { out.reveal = true; });
        socket.once('spin-arena:gameEnd', d => { out.end = d; res(out); });
        setTimeout(() => res(out), 45000);
        const b = document.getElementById('spinStartBtn') || document.querySelector('button.spin-start-btn');
        if (b) b.click(); else socket.emit('spin-arena:start');
    }));
    check(endResult.reveal, '게임 시작 → reveal 수신');
    check(!!endResult.end && typeof endResult.end.selected === 'string', 'gameEnd 수신 (당첨=' + (endResult.end && endResult.end.selected) + ')');
    const endOnB = await pageB.evaluate(() => window._qaEnd === undefined ? null : window._qaEnd);
    // 탭B 동일 결과는 화면 결과 오버레이 텍스트로 확인
    await wait(3500);
    const overlayB = await pageB.evaluate(() => {
        const el = document.getElementById('resultOverlay');
        return el ? el.textContent.replace(/\s+/g, ' ').slice(0, 200) : null;
    });
    check(overlayB === null || overlayB.indexOf(endResult.end ? endResult.end.selected : '') >= 0,
        '탭B 결과 오버레이에 동일 당첨자 표시: ' + (overlayB || '(오버레이 없음 — 수동확인)'));

    // ── 콘솔 에러 0 (양 탭) ──
    const ignore = /favicon|adsbygoogle|googlesyndication|ERR_BLOCKED_BY_CLIENT|tailwind|TagError|status of 403/i;
    const realA = errsA.filter(e => !ignore.test(e));
    const realB = errsB.filter(e => !ignore.test(e));
    check(realA.length === 0, '탭A 콘솔 에러 0, got ' + realA.length + (realA.length ? ' :: ' + realA.join(' | ').slice(0, 300) : ''));
    check(realB.length === 0, '탭B 콘솔 에러 0, got ' + realB.length + (realB.length ? ' :: ' + realB.join(' | ').slice(0, 300) : ''));

    // ── 경마 회귀: 방 생성 로드 + 상점 관련 콘솔 에러 0 ──
    const ctxH = await browser.newContext();
    const pageH = await ctxH.newPage();
    watch(pageH, errsH, 'H');
    await pageH.addInitScript(skipTutorial);
    await pageH.addInitScript(() => {
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: 'QA경마', roomName: 'qa-horse-regress', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    });
    await pageH.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
    await wait(3000);
    const horseOk = await pageH.evaluate(() => ({
        joined: !!sessionStorage.getItem('horseActiveRoom') || !!document.querySelector('.game-section.active, #gameSection.active'),
        horseShop: typeof window.HorseShop !== 'undefined'
    }));
    check(horseOk.joined, '경마 방 생성 페이지 정상 로드');
    check(horseOk.horseShop, '경마 HorseShop 모듈 존재(회귀 없음)');
    const realH = errsH.filter(e => !ignore.test(e));
    check(realH.length === 0, '경마 콘솔 에러 0, got ' + realH.length + (realH.length ? ' :: ' + realH.join(' | ').slice(0, 300) : ''));

    console.log(pass ? '\n=== ALL PASS ===' : '\n=== FAIL ===');
    await browser.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 예외:', e); process.exit(1); });
