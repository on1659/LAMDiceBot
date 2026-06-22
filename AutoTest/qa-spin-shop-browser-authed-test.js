// QA: 스핀 아레나 상점 — 로그인 상태 UI happy path (구매→장착→피커 해제→선택 반영)
// 전제: 로컬 서버(5173) + 로컬 DB (방장 코인 자동충전).
const { chromium } = require('playwright');
const URL = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    let pass = true;
    const check = (cond, label) => { console.log(label + ':', cond ? 'PASS' : 'FAIL'); if (!cond) pass = false; };

    // 신규 QA 계정 (소유 상태 오염 방지)
    const qaName = 'qb' + Date.now().toString(36).slice(-8);
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

    await page.addInitScript(args => {
        localStorage.setItem('tutorialSeen_spin-arena', 'v1');
        localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
        localStorage.setItem('pendingSpinArenaRoom', JSON.stringify({
            userName: args.name, roomName: 'qa-shop-authed', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    }, { token: reg.token, name: qaName });
    await page.goto(URL + '/spin-arena?createRoom=true', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const ar = sessionStorage.getItem('spinArenaActiveRoom');
        return ar && JSON.parse(ar).roomId;
    }, null, { timeout: 10000 });
    await wait(1500); // socket:authenticate + wallet 동기화

    const authed = await page.evaluate(() => window.SpinShop && SpinShop.isAuthed());
    check(authed === true, '페이지 로드 시 자동 socket 인증(SpinShop.isAuthed)');

    // 상점 열기 → 모달 오픈
    await page.evaluate(() => SpinShop.openShop());
    await page.waitForSelector('#spinShopMount .hshop-overlay', { timeout: 5000 });
    const cards = await page.evaluate(() => document.querySelectorAll('#spinShopMount .hshop-card').length);
    check(cards === 48, '상점 모달 카드 48종(24색×t1/t2), got ' + cards);

    // 시안(t1, 80코인) 구매: 카드의 구매 버튼 클릭 → 확인 모달 → 구매
    const buyClicked = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#spinShopMount .hshop-card'));
        const cyan = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === '시안');
        const btn = cyan && cyan.querySelector('button.hshop-buy');
        if (!btn || btn.disabled) return false;
        btn.click(); return true;
    });
    check(buyClicked, '시안 t1 구매 버튼 클릭');
    await page.waitForSelector('#shopLayer .hshop-confirm-ok', { timeout: 3000 });
    await page.click('#shopLayer .hshop-confirm-ok');
    await wait(1200);
    const ownedCyan = await page.evaluate(() => SpinShop.getOwnedSkinIds());
    check(ownedCyan.indexOf('cyan') >= 0, '구매 후 소유 목록에 cyan: ' + JSON.stringify(ownedCyan));

    // 시안 Ⅱ(t2, requires 충족) 구매
    const buyT2 = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#spinShopMount .hshop-card'));
        const t2 = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === '시안 Ⅱ');
        const btn = t2 && t2.querySelector('button.hshop-buy');
        if (!btn || btn.disabled) return { ok: false, text: btn ? btn.textContent : 'no-btn' };
        btn.click(); return { ok: true };
    });
    check(buyT2.ok, '시안 Ⅱ(스킨업) 구매 버튼 활성(requires 충족): ' + JSON.stringify(buyT2));
    await page.waitForSelector('#shopLayer .hshop-confirm-ok', { timeout: 3000 });
    await page.click('#shopLayer .hshop-confirm-ok');
    await wait(1200);
    const ownedT2 = await page.evaluate(() => SpinShop.getOwnedSkinIds());
    check(ownedT2.indexOf('cyan_t2') >= 0, '스킨업 구매 후 소유 목록에 cyan_t2: ' + JSON.stringify(ownedT2));

    // 미충족 t2(라임 Ⅱ)는 잠금 상태
    const limeT2 = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#spinShopMount .hshop-card'));
        const t2 = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === '라임 Ⅱ');
        const btn = t2 && t2.querySelector('button');
        return btn ? { disabled: btn.disabled, text: btn.textContent.trim() } : null;
    });
    check(limeT2 && limeT2.disabled && /선행/.test(limeT2.text), '라임 Ⅱ(선행 미소유) 구매 잠금: ' + JSON.stringify(limeT2));

    // 시안 Ⅱ 장착 → 모달 닫기 → 피커 반영
    const equipped = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#spinShopMount .hshop-card'));
        const t2 = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === '시안 Ⅱ');
        const btn = t2 && t2.querySelector('button.hshop-equip');
        if (!btn) return false;
        btn.click(); return true;
    });
    check(equipped, '시안 Ⅱ 장착 버튼 클릭');
    await wait(1200);
    const eqId = await page.evaluate(() => SpinShop.getEquippedSkinId());
    check(eqId === 'cyan_t2', '장착 상태 = cyan_t2, got ' + eqId);
    await page.evaluate(() => SpinShop.closeShop());
    await wait(500);

    // 피커 설계(spin-arena.js renderSkinPicker): 유료색은 소유해도 피커에서 잠금 유지 —
    // 클릭하면 상점이 열리고, 장착은 상점에서만(소유 포함). 소유가 피커에 주는 반영은 Ⅱ 배지뿐.
    // 실제 장착 영속은 아래 서버 prefs.equipped 확인이 담당한다.
    const picker = await page.evaluate(() => {
        const swatches = Array.from(document.querySelectorAll('#spinSkinPicker .spin-skin-swatch'));
        const cyan = swatches.find(s => s.querySelector('.spin-skin-name') && s.querySelector('.spin-skin-name').textContent.indexOf('시안') === 0);
        return cyan ? {
            locked: cyan.classList.contains('locked'),
            dataSkin: cyan.getAttribute('data-skin'),
            tierBadge: !!cyan.querySelector('.spin-skin-tier'),
            lockedTotal: document.querySelectorAll('#spinSkinPicker .spin-skin-swatch.locked').length
        } : null;
    });
    check(picker && picker.locked && picker.tierBadge,
        '피커 시안: 유료색 잠금 유지 + cyan_t2 소유 → Ⅱ 배지 표시: ' + JSON.stringify(picker));
    check(picker && picker.lockedTotal === 18, '잠금 스와치 18 유지 (유료색은 소유해도 피커 잠금), got ' + (picker && picker.lockedTotal));

    // 인원 1명이라 준비 게이트(rc<2)로 selectSkin 자동 반영은 불가 — 서버 권위 prefs 확인으로 대체
    const wallet = await page.evaluate(() => new Promise(res => {
        socket.emit('wallet:get', {}, r => res(r));
    }));
    check(wallet && wallet.ok && wallet.equipped && wallet.equipped.spin_skin === 'spin_skin_cyan_t2',
        '서버 prefs.equipped.spin_skin = spin_skin_cyan_t2 (영속 장착)');

    const ignore = /favicon|adsbygoogle|googlesyndication|TagError|status of 403|tailwind/i;
    const real = errs.filter(e => !ignore.test(e));
    check(real.length === 0, '콘솔 에러 0, got ' + real.length + (real.length ? ' :: ' + real.join(' | ').slice(0, 300) : ''));

    console.log(pass ? '\n=== ALL PASS ===' : '\n=== FAIL ===');
    await browser.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 예외:', e); process.exit(1); });
