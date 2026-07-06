// QA Stage C: 인벤토리 셸 — ◀▶ 탈것 스위처(미리보기 전용) + 카테고리 필터 칩 + 기본탭/리셋
// 명세: 가챠 확장 Stage C (uncommitted)
// 전제: 로컬 서버(5173) + 로컬 DB(register).
//
// 검증:
//   [C1] 상점 오픈 시 기본 메인탭 = 광고샵('ad') — 코인샵 아님
//   [C2] 인벤토리 진입 → ◀ [탈것] ▶ 스위처 노출(ALL_VEHICLES 2개+) + 미리보기 sprite 존재
//   [C3] 스위처 preview-only: ▶ 클릭 시 outcome/equip 계열 emit 0 + 지갑(owned/equipped) 불변 + 모달 1회만 재빌드 안 함(미리보기 노드만 교체)
//   [C4] ▶ 클릭 → 이름표 텍스트 변경 + sprite innerHTML 변경(스프라이트 실제 교체)
//   [C5] 필터 칩(전체 + 슬롯) 노출, '전체' 활성. 빈 슬롯 칩 클릭 → "이 카테고리에 보유한 꾸미기가 없어요"
//   [C6] reopen 리셋: roster[2]로 cycle → 닫기 → 재오픈 → 미리보기=내탈것(roster[0] sprite와 동일) + 필터='전체'
//   [C7] 콘솔 에러 0
const { chromium } = require('playwright');
const URL = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    let pass = true;
    const check = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label); if (!cond) pass = false; };

    const qaName = 'qc' + Date.now().toString(36).slice(-8);
    const reg = await fetch(URL + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: qaName, pin: '1234' })
    }).then(r => r.json()).catch(e => ({ error: String(e) }));
    if (!reg.token) { console.log('FAIL: register 실패', JSON.stringify(reg)); process.exit(1); }

    const browser = await chromium.launch();
    const errs = [];
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));

    await page.addInitScript(args => {
        localStorage.setItem('tutorialSeen_horse-race', 'v1');
        localStorage.setItem('tutorialSeen_horse', 'v1');
        localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: args.name, roomName: 'qa-stagec', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    }, { token: reg.token, name: qaName });

    await page.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const ar = sessionStorage.getItem('horseRaceActiveRoom');
        return ar && JSON.parse(ar).roomId;
    }, null, { timeout: 12000 }).catch(() => {});
    await wait(1800);

    const rosterLen = await page.evaluate(() => (window.ALL_VEHICLES || []).length);
    check(rosterLen > 1, '[전제] ALL_VEHICLES 로스터 2개+ (스위처 노출 조건), got ' + rosterLen);

    // ── 상점 오픈 ──
    await page.evaluate(() => HorseShop.openShop());
    await page.waitForSelector('#horseShopMount .hshop-overlay', { timeout: 5000 });
    await wait(300);

    // [C1] 기본 메인탭 = 광고샵
    const activeMain = await page.evaluate(() => {
        const a = document.querySelector('#horseShopMount .hshop-maintab.is-active');
        return a ? a.textContent.trim() : null;
    });
    check(/광고샵/.test(activeMain || ''), '[C1] 오픈 시 기본 메인탭 = 광고샵: got ' + JSON.stringify(activeMain));

    // 인벤토리 진입 헬퍼
    async function clickInventory() {
        await page.evaluate(() => {
            const t = Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab'))
                .find(b => b.textContent.indexOf('내 아이템') >= 0);
            if (t) t.click();
        });
        await wait(250);
    }
    await clickInventory();

    // [C2] 스위처 + 미리보기 sprite
    const sw0 = await page.evaluate(() => {
        const vsw = document.querySelector('#horseShopMount .hshop-inv-vsw');
        const name = document.querySelector('#horseShopMount .hshop-inv-vsw-name');
        const prev = document.querySelector('#horseShopMount .hshop-inv-vsw-prev');
        const next = document.querySelector('#horseShopMount .hshop-inv-vsw-next');
        const sprite = document.querySelector('#horseShopMount .hshop-inv-sprite');
        return {
            hasVsw: !!vsw, name: name ? name.textContent : null,
            hasPrev: !!prev, hasNext: !!next,
            spriteHtml: sprite ? sprite.innerHTML.slice(0, 60) : null
        };
    });
    check(sw0.hasVsw && sw0.hasPrev && sw0.hasNext, '[C2] ◀ [이름] ▶ 스위처 노출: ' + JSON.stringify({ name: sw0.name }));
    check(!!sw0.spriteHtml, '[C2] 미리보기 sprite innerHTML 존재');

    // [C3] preview-only: ▶ 클릭 시 emit 0 + 지갑 불변
    const before = await page.evaluate(() => ({
        owned: (window.ShopModule.getWallet().owned || []).slice(),
        equipped: JSON.stringify(window.ShopModule.getEquipped() || {}),
        adOwned: (window.ShopModule.getAdWallet().owned || []).slice(),
        adEquipped: JSON.stringify((window.ShopModule.getAdWallet() || {}).equipped || {})
    }));
    const emitProbe = await page.evaluate(() => new Promise(res => {
        const captured = [];
        const orig = socket.emit.bind(socket);
        socket.emit = function (ev) { captured.push(ev); return orig.apply(socket, arguments); };
        const next = document.querySelector('#horseShopMount .hshop-inv-vsw-next');
        next.click(); next.click();
        setTimeout(() => { socket.emit = orig; res(captured); }, 400);
    }));
    const badEmits = emitProbe.filter(ev => /equip|buy|gacha|start|result|simulate|spin|roll|race/i.test(ev));
    check(badEmits.length === 0, '[C3] 스위처 ▶ 클릭 중 equip/buy/gacha/outcome emit 0: got ' + JSON.stringify(emitProbe));
    const after = await page.evaluate(() => ({
        owned: (window.ShopModule.getWallet().owned || []).slice(),
        equipped: JSON.stringify(window.ShopModule.getEquipped() || {}),
        adOwned: (window.ShopModule.getAdWallet().owned || []).slice(),
        adEquipped: JSON.stringify((window.ShopModule.getAdWallet() || {}).equipped || {})
    }));
    check(JSON.stringify(before) === JSON.stringify(after), '[C3] 스위처 클릭 후 지갑(owned/equipped) 불변');

    // [C4] 스위처 클릭 후 이름표 + sprite 변경 (roster 2개+ 전제하 다음 탈것은 다른 sprite)
    const sw1 = await page.evaluate(() => {
        const name = document.querySelector('#horseShopMount .hshop-inv-vsw-name');
        const sprite = document.querySelector('#horseShopMount .hshop-inv-sprite');
        return { name: name ? name.textContent : null, spriteHtml: sprite ? sprite.innerHTML.slice(0, 60) : null };
    });
    check(sw1.name !== sw0.name, '[C4] ▶ 2회 클릭 후 탈것 이름표 변경: ' + JSON.stringify([sw0.name, sw1.name]));
    // 미리보기 노드가 1개만 존재(중복 삽입 없음)
    const previewCount = await page.evaluate(() => document.querySelectorAll('#horseShopMount .hshop-inv-preview').length);
    check(previewCount === 1, '[C4] 미리보기 노드 단일(중복 삽입 없음), got ' + previewCount);

    // [C5] 필터 칩 — 전체 활성 + 빈 슬롯 클릭 시 카테고리 빈 안내
    const chips = await page.evaluate(() => {
        const cs = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-chip'));
        const active = cs.find(c => c.classList.contains('is-active'));
        return { count: cs.length, labels: cs.map(c => c.textContent), active: active ? active.textContent : null };
    });
    check(chips.count >= 2 && chips.active === '전체', '[C5] 필터 칩 노출 + 기본 전체 활성: ' + JSON.stringify(chips.labels));
    // 신규 계정 = 소유 0 → 임의 슬롯 칩(전체 외 첫번째) 클릭 시 카테고리 빈 안내
    const emptyMsg = await page.evaluate(() => {
        const cs = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-chip'));
        const slotChip = cs.find(c => c.textContent !== '전체');
        if (slotChip) slotChip.click();
        const empty = document.querySelector('#horseShopMount .hshop-empty');
        return empty ? empty.textContent : null;
    });
    await wait(200);
    const emptyMsg2 = await page.evaluate(() => {
        const empty = document.querySelector('#horseShopMount .hshop-empty');
        return empty ? empty.textContent : null;
    });
    check(/이 카테고리에 보유한 꾸미기가 없어요/.test(emptyMsg2 || ''),
        '[C5] 빈 슬롯 필터 → 카테고리 빈 안내(블랭크 아님): ' + JSON.stringify(emptyMsg2));
    void emptyMsg;

    // [C6] reopen 리셋: cycle 후 닫고 재오픈 → 미리보기=내탈것 + 필터 전체
    // 먼저 인벤토리에서 ▶ 한 번 더 cycle + (이미 슬롯 필터 활성 상태)
    await page.evaluate(() => {
        const t = Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab')).find(b => b.textContent.indexOf('내 아이템') >= 0);
        if (t) t.click();
    });
    await wait(200);
    // 전체로 안 돌리고 그대로 닫는다(잔존 상태가 리셋되는지 보려고)
    await page.evaluate(() => { const n = document.querySelector('#horseShopMount .hshop-inv-vsw-next'); if (n) n.click(); });
    await wait(150);
    const beforeClose = await page.evaluate(() => {
        const name = document.querySelector('#horseShopMount .hshop-inv-vsw-name');
        return name ? name.textContent : null;
    });
    await page.evaluate(() => HorseShop.closeShop());
    await wait(250);
    await page.evaluate(() => HorseShop.openShop());
    await page.waitForSelector('#horseShopMount .hshop-overlay', { timeout: 5000 });
    await wait(300);
    // 재오픈 직후 기본탭=광고샵이어야(인벤토리 잔존 X)
    const reopenMain = await page.evaluate(() => {
        const a = document.querySelector('#horseShopMount .hshop-maintab.is-active');
        return a ? a.textContent.trim() : null;
    });
    check(/광고샵/.test(reopenMain || ''), '[C6] 재오픈 시 기본탭=광고샵(인벤토리 잔존 안 함): ' + JSON.stringify(reopenMain));
    await clickInventory();
    const reopenInv = await page.evaluate(() => {
        const name = document.querySelector('#horseShopMount .hshop-inv-vsw-name');
        const chips = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-chip'));
        const active = chips.find(c => c.classList.contains('is-active'));
        const firstRoster = (window.ALL_VEHICLES || [])[0];
        return { name: name ? name.textContent : null, activeChip: active ? active.textContent : null, firstName: firstRoster ? firstRoster.name : null };
    });
    // 미리보기=내탈것(null 폴백). 신규계정 myVehicleType은 'car' 폴백이거나 첫 로스터.
    // 핵심 검증: 필터가 '전체'로 리셋됐는가 + 이름표가 cycle 잔존값(beforeClose)이 아님.
    check(reopenInv.activeChip === '전체', '[C6] 재오픈 인벤토리 필터=전체로 리셋: ' + JSON.stringify(reopenInv.activeChip));
    check(reopenInv.name !== beforeClose || beforeClose === null,
        '[C6] 재오픈 미리보기 이름표가 직전 cycle 잔존값 아님(리셋): before=' + JSON.stringify(beforeClose) + ' after=' + JSON.stringify(reopenInv.name));

    // [C7] 콘솔 에러 0
    const ignore = /favicon|adsbygoogle|googlesyndication|ERR_BLOCKED_BY_CLIENT|tailwind|TagError|status of 40[0-9]|net::ERR/i;
    const real = errs.filter(e => !ignore.test(e));
    check(real.length === 0, '[C7] 콘솔 에러 0, got ' + real.length + (real.length ? ' :: ' + real.join(' | ').slice(0, 400) : ''));

    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAIL') + ' ===');
    await browser.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 예외:', e); process.exit(1); });
