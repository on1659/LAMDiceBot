// QA: 경마 결승연출/트랙테마 발화 재현 — 사용자 버그("광고 결승연출 장착해도 안 터짐") 해소 검증.
//
// 핵심: 장착한 finish_fx 가 실제로 raceTrackContainer 에 .cosmetic-finish-fx(28조각)를 그리는가.
//   전체 레이스(30s+)는 brittle 하므로 "발화 경로 단위"를 직접 호출(window.HorseShop.playFinishFx/applyMyTrackTheme)로
//   재현 — 바로 이 함수가 in-race 콜백에서 호출되는 그 함수다(js/horse-race.js horseRaceStarted/playReplay).
//
// 전제: 로컬 서버(5173) + 로컬 DB (방장 코인 자동충전).
// 실행: node AutoTest/qa-horse-finish-fx-fire-test.js
const { chromium } = require('playwright');
const URL = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    let pass = true;
    const check = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label); if (!cond) pass = false; };

    // 신규 QA 계정 (소유 상태 오염 방지). 방장이면 로컬에서 코인 무한 → 코인 fx 구매/장착 가능.
    const qaName = 'qfx' + Date.now().toString(36).slice(-8);
    const reg = await fetch(URL + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: qaName, pin: '1234' })
    }).then(r => r.json());
    if (!reg.token) { console.log('FAIL: register 실패', JSON.stringify(reg)); process.exit(1); }
    console.log('QA 계정:', qaName);

    const browser = await chromium.launch();
    const errs = [];
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));

    // 광고 지갑(sessionStorage)에 광고 finish_fx + 광고 track_theme 를 미리 장착 상태로 심는다.
    //   roomCreated → reapplyAdEquips() → loadAdWallet() 가 이걸 _adWallet.equipped 로 로드한다.
    const ADWALLET = {
        coins: 9999,
        owned: ['fx_ad_party', 'theme_ad_galaxy'],
        equipped: { finish_fx: 'fx_ad_party', track_theme: 'theme_ad_galaxy' },
        lastWatch: 0
    };
    await page.addInitScript(args => {
        localStorage.setItem('tutorialSeen_horse-race', 'v1');
        localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: args.name, roomName: 'qa-fx-fire', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
        sessionStorage.setItem('adWallet', JSON.stringify(args.adwallet));
    }, { token: reg.token, name: qaName, adwallet: ADWALLET });

    await page.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const ar = sessionStorage.getItem('horseRaceActiveRoom');
        return ar && JSON.parse(ar).roomId;
    }, null, { timeout: 12000 });
    await wait(1800); // socket:authenticate + wallet 동기화 + catalog 로드 + reapplyAdEquips

    // ── 사전 단언: 광고 지갑 장착이 mergedEquipped 에 반영 (발화의 입력) ──
    const merged = await page.evaluate(() => {
        // mergedEquipped 는 비공개라 우회: HorseShop.getEquipped(DB) + adWallet.equipped 를 합쳐 본다.
        const ad = (window.ShopModule && ShopModule.getAdWallet && ShopModule.getAdWallet().equipped) || {};
        const db = (window.HorseShop && HorseShop.getEquipped && HorseShop.getEquipped()) || {};
        return { ad, db };
    });
    check(merged.ad.finish_fx === 'fx_ad_party', '광고 finish_fx(fx_ad_party) 가 adWallet.equipped 에 로드됨 (reapplyAdEquips→loadAdWallet): ' + JSON.stringify(merged.ad));
    check(merged.ad.track_theme === 'theme_ad_galaxy', '광고 track_theme(theme_ad_galaxy) 가 adWallet.equipped 에 로드됨');

    // raceTrackContainer 가 페이지에 존재하고 position:relative 인지 (낙하 클리핑/absolute 기준)
    const containerOk = await page.evaluate(() => {
        const c = document.getElementById('raceTrackContainer');
        if (!c) return { exists: false };
        const cs = getComputedStyle(c);
        return { exists: true, position: cs.position };
    });
    check(containerOk.exists, '#raceTrackContainer 존재');
    check(containerOk.position === 'relative' || containerOk.position === 'absolute', '#raceTrackContainer 가 positioned (자식 absolute 기준): ' + containerOk.position);

    // ── 기준1: 광고 결승연출 발화 ── playFinishFx() 직접 호출 → .cosmetic-finish-fx(28조각) 생성·가시 ──
    const adFx = await page.evaluate(() => {
        // 기존 레이어 제거 후 발화
        document.querySelectorAll('.cosmetic-finish-fx').forEach(n => n.remove());
        window.HorseShop.playFinishFx();
        const c = document.getElementById('raceTrackContainer');
        const layer = c && c.querySelector('.cosmetic-finish-fx');
        if (!layer) return { layer: false };
        const pieces = layer.querySelectorAll('.cosmetic-fx-piece');
        const cs = getComputedStyle(layer);
        const firstPieceText = pieces[0] ? pieces[0].textContent : '';
        // 가시성: layer display!=none, opacity!=0, z-index 높음, 조각이 이모지를 담음
        return {
            layer: true,
            inContainer: layer.parentElement === c,
            pieceCount: pieces.length,
            display: cs.display, visibility: cs.visibility, zIndex: cs.zIndex,
            emoji: firstPieceText
        };
    });
    check(adFx.layer, '기준1: playFinishFx() → .cosmetic-finish-fx 레이어 생성 (광고 fx 발화 — 사용자 버그 핵심)');
    check(adFx.inContainer, '기준1: 레이어가 #raceTrackContainer 직속에 생성');
    check(adFx.pieceCount === 28, '기준1: 낙하 조각 28개 (FINISH_FX_PIECES), got ' + adFx.pieceCount);
    check(adFx.display !== 'none' && adFx.visibility !== 'hidden', '기준1: 레이어 가시 (display=' + adFx.display + ', visibility=' + adFx.visibility + ')');
    check(parseInt(adFx.zIndex, 10) >= 100, '기준1: z-index 높음(트랙/말 위), got ' + adFx.zIndex);
    check(adFx.emoji === '🎊', '기준1: 조각 이모지 = fx_ad_party(🎊): "' + adFx.emoji + '"');

    // ── 기준3: 광고 트랙테마 발화 ── applyMyTrackTheme() → .cosmetic-track-theme(배경 틴트) ──
    const adTheme = await page.evaluate(() => {
        window.HorseShop.applyMyTrackTheme();
        const c = document.getElementById('raceTrackContainer');
        const ov = c && c.querySelector('.cosmetic-track-theme');
        if (!ov) return { overlay: false };
        const cs = getComputedStyle(ov);
        return { overlay: true, hasBg: !!ov.style.backgroundImage && ov.style.backgroundImage !== 'none', zIndex: cs.zIndex, opacity: cs.opacity, bgSnippet: (ov.style.backgroundImage || '').slice(0, 40) };
    });
    check(adTheme.overlay, '기준3: applyMyTrackTheme() → .cosmetic-track-theme 오버레이 생성 (광고 테마)');
    check(adTheme.hasBg, '기준3: 트랙테마 backgroundImage 적용: ' + adTheme.bgSnippet);
    check(parseInt(adTheme.zIndex, 10) === 0, '기준3: 트랙테마 z-index 0 (트랙/말 뒤 — 가독성), got ' + adTheme.zIndex);

    // ── 기준6: clearMyTrackTheme 이 결승 폭죽(.cosmetic-finish-fx)을 안 지운다 ──
    const clearTest = await page.evaluate(() => {
        // 폭죽 + 테마 둘 다 발화 상태에서 applyMyTrackTheme(내부에서 clearMyTrackTheme 호출)
        document.querySelectorAll('.cosmetic-finish-fx, .cosmetic-track-theme').forEach(n => n.remove());
        window.HorseShop.playFinishFx();        // 폭죽
        window.HorseShop.applyMyTrackTheme();    // 테마(clearMyTrackTheme 내부 호출 — 폭죽 보존해야)
        const c = document.getElementById('raceTrackContainer');
        return {
            fxAfter: c.querySelectorAll('.cosmetic-finish-fx').length,
            themeAfter: c.querySelectorAll('.cosmetic-track-theme').length
        };
    });
    check(clearTest.fxAfter === 1, '기준6: applyMyTrackTheme 후에도 결승 폭죽(.cosmetic-finish-fx) 보존 (clearMyTrackTheme 이 .cosmetic-track-theme 만 정리), fx=' + clearTest.fxAfter);
    check(clearTest.themeAfter === 1, '기준6: 트랙테마는 멱등 — 1개만 (재적용 시 중복 안 쌓임), theme=' + clearTest.themeAfter);

    // ── 기준2: 코인 결승연출 발화 ── 광고 지갑 비우고 DB 코인 fx 구매/장착 → playFinishFx ──
    // 광고 슬롯을 비워 mergedEquipped 가 DB(코인) fx 를 읽도록.
    const coinFx = await page.evaluate(async () => {
        const socket = window.socket;
        function emitAsync(ev, data) { return new Promise(res => socket.emit(ev, data, res)); }
        // 1) 광고 finish_fx 해제(adWallet)
        if (window.ShopModule && ShopModule.getAdWallet) {
            const aw = ShopModule.getAdWallet();
            delete aw.equipped.finish_fx;
            try { sessionStorage.setItem('adWallet', JSON.stringify(aw)); } catch (e) {}
        }
        // 2) 코인 fx(fx_firework) 구매 + 장착 (방장=로컬 코인 무한)
        const buy = await emitAsync('shop:buy', { cosmeticId: 'fx_firework' });
        const equip = await emitAsync('shop:equip', { slot: 'finish_fx', cosmeticId: 'fx_firework' });
        return { buy, equip };
    });
    // 셸 _wallet.equipped 동기화: openShop()이 refreshWallet(wallet:get)을 돌려 DB equip 을 셸 캐시로 반영.
    //   (직접 socket emit 은 셸 캐시를 안 건드림 — 실제 UI 장착은 셸 경로라 캐시 동기. 여기선 openShop 으로 동기화.)
    await page.evaluate(() => { if (window.HorseShop && HorseShop.openShop) HorseShop.openShop(); });
    await wait(800);
    await page.evaluate(() => { if (window.HorseShop && HorseShop.closeShop) HorseShop.closeShop(); });
    const coinFire = await page.evaluate(() => {
        const db = (window.HorseShop && HorseShop.getEquipped && HorseShop.getEquipped()) || {};
        document.querySelectorAll('.cosmetic-finish-fx').forEach(n => n.remove());
        window.HorseShop.playFinishFx();
        const c = document.getElementById('raceTrackContainer');
        const layer = c && c.querySelector('.cosmetic-finish-fx');
        const pieces = layer ? layer.querySelectorAll('.cosmetic-fx-piece') : [];
        return { dbFinishFx: db.finish_fx, layer: !!layer, pieceCount: pieces.length, emoji: pieces[0] ? pieces[0].textContent : '' };
    });
    check(coinFix(coinFx.buy) && coinFix(coinFx.equip), '기준2: 코인 fx(fx_firework) shop:buy + shop:equip 성공: buy=' + JSON.stringify(coinFx.buy && coinFx.buy.ok) + ' equip=' + JSON.stringify(coinFx.equip && coinFx.equip.ok));
    check(coinFire.dbFinishFx === 'fx_firework', '기준2: DB 장착 finish_fx=fx_firework (HorseShop.getEquipped 반영): ' + coinFire.dbFinishFx);
    check(coinFire.layer && coinFire.pieceCount === 28, '기준2: 코인 fx 발화 → .cosmetic-finish-fx 28조각, layer=' + coinFire.layer + ' pieces=' + coinFire.pieceCount);
    check(coinFire.emoji === '🎆', '기준2: 조각 이모지 = fx_firework(🎆): "' + coinFire.emoji + '"');

    function coinFix(r) { return r && r.ok === true; }

    // ── 엣지1: finish_fx 미장착 → 발화해도 레이어 0 (no-op, 빈 div leak 없음) ──
    await page.evaluate(async () => {
        const socket = window.socket;
        function emitAsync(ev, data) { return new Promise(res => socket.emit(ev, data, res)); }
        // 코인 + 광고 finish_fx 모두 해제
        await emitAsync('shop:equip', { slot: 'finish_fx', cosmeticId: null });
        if (window.ShopModule && ShopModule.getAdWallet) { delete ShopModule.getAdWallet().equipped.finish_fx; }
    });
    // 셸 캐시 동기화(DB 해제 반영)
    await page.evaluate(() => { if (window.HorseShop && HorseShop.openShop) HorseShop.openShop(); });
    await wait(800);
    await page.evaluate(() => { if (window.HorseShop && HorseShop.closeShop) HorseShop.closeShop(); });
    const noFx = await page.evaluate(() => {
        const db = (window.HorseShop && HorseShop.getEquipped && HorseShop.getEquipped()) || {};
        const ad = (window.ShopModule && ShopModule.getAdWallet && ShopModule.getAdWallet().equipped) || {};
        document.querySelectorAll('.cosmetic-finish-fx').forEach(n => n.remove());
        window.HorseShop.playFinishFx();
        // 검증: 양쪽 캐시 모두 finish_fx 비었는지 확인 후 레이어 수
        return { layers: document.querySelectorAll('.cosmetic-finish-fx').length, dbFx: db.finish_fx, adFx: ad.finish_fx };
    });
    check(noFx.dbFx == null && noFx.adFx == null, '엣지1-전제: finish_fx 양쪽 캐시 모두 해제됨 (db=' + noFx.dbFx + ', ad=' + noFx.adFx + ')');
    check(noFx.layers === 0, '엣지1: finish_fx 미장착 시 playFinishFx no-op (레이어 0), got ' + noFx.layers);

    // ── 엣지2: track_theme 미장착 → applyMyTrackTheme 이 기존 테마만 정리 (오버레이 0) ──
    const noTheme = await page.evaluate(() => {
        if (window.ShopModule && ShopModule.getAdWallet) { delete ShopModule.getAdWallet().equipped.track_theme; }
        window.HorseShop.applyMyTrackTheme();
        return document.querySelectorAll('.cosmetic-track-theme').length;
    });
    check(noTheme === 0, '엣지2: track_theme 미장착 시 applyMyTrackTheme 오버레이 0 (정리만), got ' + noTheme);

    // ── 엣지3: 연타 멱등 — playFinishFx 3회 → 레이어 3개(각자 5.5s 후 자동정리)지만 조각 누적 폭주 없음 ──
    //   (finish_fx 다시 장착 후) 레이어는 누적되나 각 28개로 일정, leak 타이머 존재 확인.
    await page.evaluate(async () => {
        const socket = window.socket;
        function emitAsync(ev, data) { return new Promise(res => socket.emit(ev, data, res)); }
        await emitAsync('shop:equip', { slot: 'finish_fx', cosmeticId: 'fx_firework' });
    });
    await page.evaluate(() => { if (window.HorseShop && HorseShop.openShop) HorseShop.openShop(); });
    await wait(800);
    await page.evaluate(() => { if (window.HorseShop && HorseShop.closeShop) HorseShop.closeShop(); });
    const repeat = await page.evaluate(() => {
        document.querySelectorAll('.cosmetic-finish-fx').forEach(n => n.remove());
        window.HorseShop.playFinishFx();
        window.HorseShop.playFinishFx();
        window.HorseShop.playFinishFx();
        const c = document.getElementById('raceTrackContainer');
        const layers = c.querySelectorAll('.cosmetic-finish-fx');
        const counts = Array.from(layers).map(l => l.querySelectorAll('.cosmetic-fx-piece').length);
        return { layers: layers.length, counts };
    });
    check(repeat.counts.every(c => c === 28), '엣지3: 연타 시 각 레이어 28조각 일정 (조각 폭주 없음): ' + JSON.stringify(repeat.counts));

    // ── 무회귀: 콘솔 에러 0 ──
    // 광고(AdSense) 관련 에러는 테스트 환경(미배포 도메인)에서 정상 — 제외.
    const realErrs = errs.filter(e => !/favicon|sound-config|\.mp3|ERR_|net::|Failed to load resource|AdSense|adsbygoogle|TagError|googlesyndication|pagead/i.test(e));
    check(realErrs.length === 0, '무회귀: 치명 콘솔 에러 0 (got ' + realErrs.length + ')' + (realErrs.length ? ' — ' + realErrs.slice(0, 3).join(' | ') : ''));

    await browser.close();
    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('TEST ERROR:', e); process.exit(2); });
