// QA Feature 2: free서버 코인샵 게이팅 — Playwright 브라우저 검증
// 명세: docs/goal/horse-shop-session-gating-inventory.md Feature 2
// 검증:
//   [F2-1] free서버(window.currentServerId==null) 코인샵 탭 → 카드 대신 정확한 안내 카피(텍스트만, 버튼 0)
//   [F2-2] 광고샵 탭은 게이팅 무영향 — 카드 렌더(coinShopLocked는 'coin' 한정)
//   [F2-3] currentServerId 값 주입 후 코인샵 재렌더 → 카드 복원(미인증이면 '로그인하세요' 잠금 보존)
//   [F2-4] 광고샵은 free서버에서도 정상(F2-2와 동일 상태로 확인)
//   [F2-회귀] spin-arena 상점 — 게이팅 없음(코인샵 단일 슬롯 정상, 콘솔 에러 0)
//   [공정성] 게이팅 경로에서 결과/시뮬 emit 없음(코드 정적 + DOM 상호작용으로 outcome emit 미발생)
//
//   양면 검증(2026-06 코인샵 "준비 중" 게이트 추가):
//     [F2-0] 플래그 ON(기본 COIN_SHOP_COMING_SOON=true) → 코인샵 탭 = "🛠️ 준비 중" 안내, 카드 0
//     이후 ShopModule.__setComingSoon(false)로 코인샵 활성화 → 아래 기존 free 게이팅 단언(F2-1~3) 수행
const { chromium } = require('playwright');
const URL = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));
const NOTICE = '여기서는 코인샵을 사용할 수 없어요. 서버를 새로 만들어 진행해 주세요.';
const COMING_SOON = '🛠️ 코인샵은 준비 중이에요. 추후 오픈 예정이니 조금만 기다려 주세요!';

(async () => {
    let pass = true;
    const check = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label); if (!cond) pass = false; };

    const browser = await chromium.launch();
    const errsH = [], errsS = [];
    function watch(page, sink, tag) {
        page.on('console', m => { if (m.type() === 'error') { sink.push(m.text()); } });
        page.on('pageerror', e => { sink.push(String(e)); console.log(`[${tag} pageerror]`, String(e).slice(0, 200)); });
    }
    const skipTutorial = () => {
        localStorage.setItem('tutorialSeen_spin-arena', 'v1');
        localStorage.setItem('tutorialSeen_horse-race', 'v1');
        localStorage.setItem('tutorialSeen_horse', 'v1');
    };
    // 게스트(미인증)로 진행 — userAuth 미설정 (free서버 + 비로그인 = 가장 흔한 실사용 케이스)

    // ── 경마 방 생성 (free 서버 — serverId 없음) ──
    const ctxH = await browser.newContext();
    const pageH = await ctxH.newPage();
    watch(pageH, errsH, 'H');
    await pageH.addInitScript(skipTutorial);
    await pageH.addInitScript(() => {
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: 'QA게이팅', roomName: 'qa-coin-gating', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    });
    await pageH.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
    await wait(3500);

    const ctx0 = await pageH.evaluate(() => ({
        serverId: window.currentServerId === undefined ? '<undefined>' : window.currentServerId,
        hasShop: typeof window.HorseShop !== 'undefined',
        hasOpen: !!(window.HorseShop && window.HorseShop.openShop)
    }));
    console.log('초기 컨텍스트:', JSON.stringify(ctx0));
    check(ctx0.serverId === null, '[전제] free서버 → window.currentServerId === null (got ' + ctx0.serverId + ')');
    check(ctx0.hasShop, '[전제] HorseShop 모듈 로드');

    // 카탈로그 선로딩(렌더 안정화) 후 상점 열기
    await pageH.evaluate(() => window.HorseShop && window.HorseShop.loadCatalog && window.HorseShop.loadCatalog());
    await wait(800);
    await pageH.evaluate(() => window.HorseShop.openShop());
    await wait(1200);

    const overlayOpen = await pageH.evaluate(() => !!document.querySelector('#horseShopMount .hshop-overlay'));
    check(overlayOpen, '[전제] 게스트 상점 모달 오픈(allowGuestShop)');

    // 메인탭 존재 확인(경마는 adOnly 아이템 보유 → 광고샵/코인샵 2탭)
    const tabs = await pageH.evaluate(() => Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab')).map(b => b.textContent.trim()));
    console.log('메인탭:', JSON.stringify(tabs));
    check(tabs.some(t => t.indexOf('코인샵') >= 0) && tabs.some(t => t.indexOf('광고샵') >= 0), '[전제] 광고샵/코인샵 메인탭 노출');

    // 코인샵 탭 클릭 헬퍼 (재렌더마다 메인탭이 새로 생성되므로 클릭 시점에 매번 조회)
    //   renderMainTabBar는 이미 활성인 메인탭 재클릭 시 조기 반환(재렌더 안 함) → 광고샵을 경유해
    //   강제로 코인샵 재렌더를 유발(토글 OFF 반영 등 상태 변경 후 그리드 갱신 보장).
    async function clickCoinTab() {
        await pageH.evaluate(() => {
            function tab(name) { return Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab')).find(b => b.textContent.indexOf(name) >= 0); }
            const cur = document.querySelector('#horseShopMount .hshop-maintab.is-active');
            if (cur && cur.textContent.indexOf('코인샵') >= 0) { const ad = tab('광고샵'); if (ad) ad.click(); } // 경유
            const coin = tab('코인샵'); if (coin) coin.click();
        });
        await wait(600);
    }

    // 토글 훅 존재 + localhost 가드 동작 확인(테스트 전제)
    const toggleReady = await pageH.evaluate(() => ({
        hasSet: !!(window.ShopModule && window.ShopModule.__setComingSoon),
        hasGet: !!(window.ShopModule && window.ShopModule.__getComingSoon),
        initial: window.ShopModule && window.ShopModule.__getComingSoon && window.ShopModule.__getComingSoon()
    }));
    check(toggleReady.hasSet && toggleReady.hasGet, '[전제] ShopModule.__setComingSoon/__getComingSoon 토글 훅 노출');
    check(toggleReady.initial === true, '[전제] 기본 COIN_SHOP_COMING_SOON=true (운영 게이트 보존), got ' + toggleReady.initial);

    // 코인샵 탭 클릭
    await clickCoinTab();

    // ── F2-0: 플래그 ON(기본) → 코인샵 = "준비 중" 안내, 카드 0 ──
    const comingSoon = await pageH.evaluate(() => {
        const grid = document.querySelector('#horseShopMount .hshop-grid');
        const empties = grid ? Array.from(grid.querySelectorAll('.hshop-empty')) : [];
        const cards = grid ? grid.querySelectorAll('.hshop-card') : [];
        const gridButtons = grid ? grid.querySelectorAll('button') : [];
        return {
            emptyTexts: empties.map(e => e.textContent.trim()),
            cardCount: cards.length,
            gridButtonCount: gridButtons.length
        };
    });
    console.log('코인샵(준비 중) 그리드:', JSON.stringify(comingSoon));
    check(comingSoon.emptyTexts.length === 1 && comingSoon.emptyTexts[0] === COMING_SOON,
        '[F2-0] 코인샵 "준비 중" 안내 정확 일치(플래그 ON): "' + (comingSoon.emptyTexts[0] || '') + '"');
    check(comingSoon.cardCount === 0, '[F2-0] 준비 중 코인샵 카드 0개 (got ' + comingSoon.cardCount + ')');
    check(comingSoon.gridButtonCount === 0, '[F2-0] 준비 중 안내영역 버튼 0개 (got ' + comingSoon.gridButtonCount + ')');

    // ── 코인샵 활성화(플래그 OFF) → 보존된 free 게이팅 로직 검증으로 진입 ──
    const toggledOff = await pageH.evaluate(() => {
        window.ShopModule.__setComingSoon(false);
        return window.ShopModule.__getComingSoon();
    });
    check(toggledOff === false, '[전제] __setComingSoon(false) 적용 → 코인샵 활성화 (got ' + toggledOff + ')');
    await clickCoinTab(); // 코인샵 재렌더 (플래그 OFF 반영)

    // ── F2-1: free 코인샵 → 안내 카피만, 카드 0, 버튼 0 ──
    const coinFree = await pageH.evaluate(() => {
        const grid = document.querySelector('#horseShopMount .hshop-grid');
        const empties = grid ? Array.from(grid.querySelectorAll('.hshop-empty')) : [];
        const cards = grid ? grid.querySelectorAll('.hshop-card') : [];
        const gridButtons = grid ? grid.querySelectorAll('button') : [];
        return {
            emptyTexts: empties.map(e => e.textContent.trim()),
            emptyCount: empties.length,
            cardCount: cards.length,
            gridButtonCount: gridButtons.length,
            gridText: grid ? grid.textContent.trim() : null
        };
    });
    console.log('코인샵(free) 그리드:', JSON.stringify(coinFree));
    check(coinFree.emptyTexts.length === 1 && coinFree.emptyTexts[0] === NOTICE,
        '[F2-1] 코인샵 안내 카피 정확 일치(텍스트만): "' + (coinFree.emptyTexts[0] || '') + '"');
    check(coinFree.cardCount === 0, '[F2-1] 코인샵 카드 0개 (got ' + coinFree.cardCount + ')');
    check(coinFree.gridButtonCount === 0, '[F2-1] 안내영역 버튼 0개 (CTA 없음, got ' + coinFree.gridButtonCount + ')');

    // ── F2-2 / F2-4: 광고샵 탭 → 카드 렌더(게이팅 무영향) ──
    await pageH.evaluate(() => {
        const tab = Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab')).find(b => b.textContent.indexOf('광고샵') >= 0);
        if (tab) tab.click();
    });
    await wait(600);
    const adShop = await pageH.evaluate(() => {
        const grid = document.querySelector('#horseShopMount .hshop-grid');
        const cards = grid ? grid.querySelectorAll('.hshop-card') : [];
        const notice = grid ? grid.textContent.indexOf('코인샵을 사용할 수 없') >= 0 : false;
        const adRow = !!document.querySelector('#horseShopMount .hshop-watch-ad');
        return { cardCount: cards.length, hasGatingNotice: notice, adRow };
    });
    console.log('광고샵(free):', JSON.stringify(adShop));
    check(adShop.cardCount > 0, '[F2-2/F2-4] free서버 광고샵 카드 정상(' + adShop.cardCount + '개)');
    check(!adShop.hasGatingNotice, '[F2-2] 광고샵에 코인샵 게이팅 안내 미노출(coin 한정)');
    check(adShop.adRow, '[F2-4] free서버 광고샵 "광고 보기" 행 정상');

    // ── F2-3: currentServerId 주입 후 코인샵 재렌더 → 카드 복원 + 미인증 잠금 보존 ──
    await pageH.evaluate(() => { window.currentServerId = 'qa-server-1'; });
    await pageH.evaluate(() => {
        const tab = Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab')).find(b => b.textContent.indexOf('코인샵') >= 0);
        if (tab) tab.click();
    });
    await wait(600);
    const coinRegular = await pageH.evaluate(() => {
        const grid = document.querySelector('#horseShopMount .hshop-grid');
        const cards = grid ? grid.querySelectorAll('.hshop-card') : [];
        const gatingNotice = grid ? grid.textContent.indexOf('코인샵을 사용할 수 없') >= 0 : false;
        const lockBtns = grid ? Array.from(grid.querySelectorAll('button')).filter(b => b.textContent.indexOf('로그인하세요') >= 0) : [];
        return { cardCount: cards.length, gatingNotice, lockCount: lockBtns.length };
    });
    console.log('코인샵(정규서버, 미인증):', JSON.stringify(coinRegular));
    check(coinRegular.cardCount > 0, '[F2-3] 정규서버 코인샵 카드 복원(' + coinRegular.cardCount + '개)');
    check(!coinRegular.gatingNotice, '[F2-3] 정규서버 게이팅 안내 사라짐');
    check(coinRegular.lockCount > 0, '[F2-3] 미인증 "로그인하세요" 잠금 보존(' + coinRegular.lockCount + '개) — free 게이팅과 별개 상태 공존');

    // ── 공정성: 게이팅/탭전환 동안 결과/시뮬 emit 미발생 감시 ──
    const fairnessProbe = await pageH.evaluate(() => new Promise(res => {
        const captured = [];
        const orig = socket.emit.bind(socket);
        socket.emit = function (ev) { captured.push(ev); return orig.apply(socket, arguments); };
        // 코인샵 <-> 광고샵 왕복 (게이팅 렌더 재발생)
        function clickTab(name) {
            const tab = Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab')).find(b => b.textContent.indexOf(name) >= 0);
            if (tab) tab.click();
        }
        window.currentServerId = null;
        clickTab('코인샵'); clickTab('광고샵'); clickTab('코인샵');
        setTimeout(() => { socket.emit = orig; res(captured); }, 400);
    }));
    const outcomeEmits = fairnessProbe.filter(ev => /start|result|simulate|reveal|gameEnd|spin|roll|race/i.test(ev));
    console.log('탭전환 중 emit:', JSON.stringify(fairnessProbe), ' / outcome계열:', JSON.stringify(outcomeEmits));
    check(outcomeEmits.length === 0, '[공정성] 게이팅/탭전환 중 결과·시뮬 계열 emit 0 (got ' + JSON.stringify(outcomeEmits) + ')');

    // ── 토글 복원: 기본값(준비 중=true)으로 되돌림 → 코인샵이 다시 "준비 중" 게이트로 잠김 ──
    const restored = await pageH.evaluate(() => {
        window.ShopModule.__setComingSoon(true);
        return window.ShopModule.__getComingSoon();
    });
    check(restored === true, '[복원] __setComingSoon(true) → 운영 기본 게이트 복원 (got ' + restored + ')');

    // ── 회귀: spin-arena 상점 게이팅 없음 ──
    const ctxS = await browser.newContext();
    const pageS = await ctxS.newPage();
    watch(pageS, errsS, 'S');
    await pageS.addInitScript(skipTutorial);
    await pageS.addInitScript(() => {
        localStorage.setItem('pendingSpinArenaRoom', JSON.stringify({
            userName: 'QA스핀', roomName: 'qa-spin-regress', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    });
    await pageS.goto(URL + '/spin-arena?createRoom=true', { waitUntil: 'domcontentloaded' });
    await wait(3000);
    const spinShopLoaded = await pageS.evaluate(() => typeof window.SpinShop !== 'undefined');
    check(spinShopLoaded, '[회귀] SpinShop 모듈 로드');
    // spin은 미인증 게스트 → 상점 진입 불가(allowGuestShop 없음). 게스트 로그인 안내가 기존 동작.
    // 게이팅 hook 부재 확인: openShop 시 코인샵 게이팅 안내가 절대 안 뜸.
    const spinShopProbe = await pageS.evaluate(async () => {
        // 토큰 없는 게스트 → 로그인 안내(모달 미오픈)가 기존 spin 동작. 게이팅 카피는 어떤 경우에도 미노출.
        if (window.SpinShop && window.SpinShop.openShop) window.SpinShop.openShop();
        await new Promise(r => setTimeout(r, 700));
        const overlay = !!document.querySelector('#spinShopMount .hshop-overlay');
        const gating = document.body.innerText.indexOf('코인샵을 사용할 수 없') >= 0;
        return { overlay, gating };
    });
    console.log('spin 상점 probe:', JSON.stringify(spinShopProbe));
    check(!spinShopProbe.gating, '[회귀] spin-arena에 코인샵 게이팅 안내 절대 미노출(hook 없음 → 게이팅 없음)');

    // ── 콘솔 에러 0 ──
    const ignore = /favicon|adsbygoogle|googlesyndication|ERR_BLOCKED_BY_CLIENT|tailwind|TagError|status of 403|ERR_NAME_NOT_RESOLVED/i;
    const realH = errsH.filter(e => !ignore.test(e));
    const realS = errsS.filter(e => !ignore.test(e));
    check(realH.length === 0, '경마 콘솔 에러 0, got ' + realH.length + (realH.length ? ' :: ' + realH.join(' | ').slice(0, 300) : ''));
    check(realS.length === 0, 'spin 콘솔 에러 0, got ' + realS.length + (realS.length ? ' :: ' + realS.join(' | ').slice(0, 300) : ''));

    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAIL') + ' ===');
    await browser.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 예외:', e); process.exit(1); });
