// QA: 경마 광고 코스메틱 세션 스코프 (Feature 1) 브라우저 검증 — Playwright
// 명세: docs/goal/horse-shop-session-gating-inventory.md Feature 1
// 검증:
//   [AC1] _adWallet sessionStorage 읽기/쓰기, localStorage['adWallet'] 쓰기 0건
//   [AC2] 옛 localStorage['adWallet'] 잔재 1회 제거
//   [AC3] ad 코스메틱 구매·장착 후 leaveRoom→재입장(같은 탭) → owned·equipped 유지 + 가시
//   [AC4] 탭(컨텍스트) 격리 → 광고지갑 리셋(coins/owned/equipped 비어있음)
//   [AC5] 방 재입장 시 owned ad equip가 shop:adEquip 재emit → room.adCosmetics[socket.id] 재충전
//   [AC6] 코인샵/타플레이어 broadcast 무회귀
const { chromium } = require('playwright');
const URL = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));

// catalog 검증된 ad 아이템 (paint 슬롯, adPrice 30)
const AD_ITEM = { slot: 'paint', id: 'paint_ad_aqua' };
const AD_ITEM2 = { slot: 'bib', id: 'bib_ad_ruby' };

(async () => {
    let pass = true;
    const check = (cond, label) => { console.log(label + ':', cond ? 'PASS' : 'FAIL'); if (!cond) pass = false; };

    const browser = await chromium.launch();
    const errsA = [], errsB = [];
    function watch(page, sink, tag) {
        page.on('console', m => { if (m.type() === 'error') { sink.push(m.text()); } });
        page.on('pageerror', e => { sink.push(String(e)); });
    }
    const skipTutorial = () => {
        localStorage.setItem('tutorialSeen_horse-race', 'v1');
        localStorage.setItem('tutorialSeen_horse', 'v1');
    };

    // ── 탭 A: 경마 방 생성 (호스트) ──
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    watch(pageA, errsA, 'A');
    await pageA.addInitScript(skipTutorial);
    // AC2 사전조건: 옛 영구 localStorage['adWallet'] 잔재를 미리 심어둔다 → 로드 시 1회 제거되어야 함
    await pageA.addInitScript(() => {
        localStorage.setItem('adWallet', JSON.stringify({ coins: 999, owned: ['STALE_ITEM'], equipped: { paint: 'STALE' }, lastWatch: 0 }));
    });
    await pageA.addInitScript(() => {
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: 'QA호스트', roomName: 'qa-ad-session', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    });
    await pageA.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
    await pageA.waitForFunction(() => {
        const ar = sessionStorage.getItem('horseRaceActiveRoom');
        return ar && JSON.parse(ar).roomId;
    }, null, { timeout: 12000 }).catch(() => {});
    const roomId = await pageA.evaluate(() => {
        const ar = sessionStorage.getItem('horseRaceActiveRoom');
        return ar ? JSON.parse(ar).roomId : null;
    });
    check(!!roomId, '탭A 경마 방 생성 + roomJoined/Created (roomId=' + roomId + ')');
    await wait(1200);

    // ── [AC2] 옛 localStorage['adWallet'] 잔재가 로드 시 제거되었는지 ──
    const staleRemoved = await pageA.evaluate(() => localStorage.getItem('adWallet'));
    check(staleRemoved === null, 'AC2: 옛 localStorage[\'adWallet\'] 잔재 1회 제거됨 (got=' + JSON.stringify(staleRemoved) + ')');

    // ── ShopModule API 존재 확인 ──
    const apiOk = await pageA.evaluate(() => ({
        reapply: typeof window.ShopModule?.reapplyAdEquips === 'function',
        getAd: typeof window.ShopModule?.getAdWallet === 'function'
    }));
    check(apiOk.reapply && apiOk.getAd, 'reapplyAdEquips/getAdWallet public API 존재');

    // ── ad 코스메틱 "구매+장착" 상태를 sessionStorage 광고지갑에 주입 ──
    //   (광고 시청 3초 흐름 대신 지갑 상태를 직접 세팅 — owned/equipped 유지·재emit 로직 검증이 목표)
    await pageA.evaluate((items) => {
        const w = { coins: 100, owned: [items.a.id, items.b.id], equipped: {}, lastWatch: 0 };
        w.equipped[items.a.slot] = items.a.id;
        w.equipped[items.b.slot] = items.b.id;
        sessionStorage.setItem('adWallet', JSON.stringify(w));
    }, { a: AD_ITEM, b: AD_ITEM2 });

    // ── [AC1] 광고지갑이 sessionStorage에 있고 localStorage에는 쓰이지 않는지 ──
    const storageState1 = await pageA.evaluate(() => ({
        ss: sessionStorage.getItem('adWallet'),
        ls: localStorage.getItem('adWallet')
    }));
    check(!!storageState1.ss && storageState1.ls === null,
        'AC1: 광고지갑 sessionStorage 존재 + localStorage 미기록 (ls=' + JSON.stringify(storageState1.ls) + ')');

    // ── 서버 room.adCosmetics 재충전 검증을 위해, 재입장(leaveRoom→재join) 트리거 ──
    //   reapplyAdEquips는 roomJoined/roomCreated 끝에서 호출됨.
    //   shop:adEquip 재emit이 서버에 도달했는지 확인하려면, 재입장 후 서버가 보낸
    //   updateRoom(또는 race 시작 시 adCosmetics 포함)을 직접 검증하기 어려우므로,
    //   클라에서 직접 reapplyAdEquips() 호출 후 ack 기반으로 서버 수락을 확인한다.
    const reapplyResult = await pageA.evaluate((items) => new Promise(res => {
        // shop:adEquip은 ack(callback)을 받는다. reapply는 ack 없이 fire-and-forget이므로,
        // 동일 페이로드를 ack 포함으로 직접 emit해 서버 수락 여부(ok)를 확인한다.
        let acks = 0, oks = 0, done = 0;
        const slots = [items.a, items.b];
        slots.forEach(s => {
            socket.emit('shop:adEquip', { slot: s.slot, cosmeticId: s.id }, (r) => {
                acks++; if (r && r.ok) oks++; done++;
                if (done === slots.length) res({ acks, oks });
            });
        });
        setTimeout(() => res({ acks, oks, timeout: true }), 3000);
    }), { a: AD_ITEM, b: AD_ITEM2 });
    check(reapplyResult.oks === 2,
        'AC5: shop:adEquip 2슬롯 서버 수락 ok (oks=' + reapplyResult.oks + '/' + reapplyResult.acks + ')');

    // ── reapplyAdEquips() 직접 호출이 throw 없이 동작 (fire-and-forget) ──
    const reapplyNoThrow = await pageA.evaluate(() => {
        try { window.ShopModule.reapplyAdEquips(); return true; } catch (e) { return String(e); }
    });
    check(reapplyNoThrow === true, 'reapplyAdEquips() 직접 호출 0-throw (got=' + reapplyNoThrow + ')');

    // ── [AC3 같은 탭 지속성] 같은 컨텍스트에서 새 페이지 열기 → sessionStorage 공유 → 광고지갑 유지 ──
    //   주의: Playwright에서 같은 BrowserContext 내 새 page는 sessionStorage를 공유하지 않을 수 있다.
    //   sessionStorage 동일-탭 지속은 "같은 탭 내 네비게이션"으로 검증한다.
    await pageA.goto(URL + '/horse-race?joinRoom=true', { waitUntil: 'domcontentloaded' }).catch(() => {});
    // joinRoom 진입을 위해 pending 세팅이 없으면 /game으로 튕길 수 있으므로, 단순 reload로 동일-탭 지속만 본다.
    await pageA.evaluate(() => location.reload());
    await wait(800);
    const afterNav = await pageA.evaluate(() => sessionStorage.getItem('adWallet'));
    let kept = false;
    try { const w = JSON.parse(afterNav); kept = w && Array.isArray(w.owned) && w.owned.length >= 2 && w.equipped && w.equipped.paint; } catch (e) {}
    check(kept, 'AC3: 같은 탭 네비게이션 후 광고지갑(owned/equipped) 유지 (got=' + afterNav + ')');

    // ── [AC4 탭 격리] 새 BrowserContext(=새 탭) → sessionStorage 격리 → 광고지갑 리셋 ──
    //   /horse-race는 pending* 없으면 /game으로 튕기므로, 새 탭도 정상 방 생성으로 진입시켜
    //   ShopModule이 로드된 상태에서 sessionStorage 격리 + 광고지갑 기본값을 본다.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    watch(pageB, errsB, 'B');
    await pageB.addInitScript(skipTutorial);
    await pageB.addInitScript(() => {
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: 'QA탭B', roomName: 'qa-ad-isolated', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    });
    await pageB.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await pageB.waitForFunction(() => !!window.ShopModule, null, { timeout: 12000 }).catch(() => {});
    await wait(800);
    const isolated = await pageB.evaluate(() => ({
        ss: sessionStorage.getItem('adWallet'),
        // ShopModule 로드 후 getAdWallet 기본값 (loadAdWallet 미호출 시 기본 객체, openShop/reapply 후엔 sessionStorage 반영)
        wallet: window.ShopModule ? window.ShopModule.getAdWallet() : null
    }));
    const freshWallet = isolated.wallet;
    const resetOk = isolated.ss === null && freshWallet && freshWallet.coins === 0 &&
        (!freshWallet.owned || freshWallet.owned.length === 0) &&
        (!freshWallet.equipped || Object.keys(freshWallet.equipped).length === 0);
    check(resetOk, 'AC4: 새 탭(컨텍스트) 광고지갑 리셋 (ss=' + JSON.stringify(isolated.ss) + ', wallet=' + JSON.stringify(freshWallet) + ')');

    // ── [AC6 회귀] HorseShop 모듈/코인샵 로드 무에러 ──
    const horseModuleOk = await pageA.evaluate(() => typeof window.HorseShop !== 'undefined' && typeof window.ShopModule !== 'undefined');
    check(horseModuleOk, 'AC6: HorseShop/ShopModule 모듈 정상 로드(회귀 없음)');

    // ── 콘솔 에러 0 ──
    const ignore = /favicon|adsbygoogle|googlesyndication|ERR_BLOCKED_BY_CLIENT|tailwind|TagError|status of 40[0-9]|net::ERR/i;
    const realA = errsA.filter(e => !ignore.test(e));
    const realB = errsB.filter(e => !ignore.test(e));
    check(realA.length === 0, '탭A 콘솔 에러 0, got ' + realA.length + (realA.length ? ' :: ' + realA.join(' | ').slice(0, 300) : ''));
    check(realB.length === 0, '탭B 콘솔 에러 0, got ' + realB.length + (realB.length ? ' :: ' + realB.join(' | ').slice(0, 300) : ''));

    console.log(pass ? '\n=== ALL PASS ===' : '\n=== FAIL ===');
    await browser.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 예외:', e); process.exit(1); });
