// QA: 경마 꾸미기 상점 — Feature 3 "📦 내 아이템" 인벤토리 메인탭 (브라우저, Playwright)
// 명세: docs/goal/horse-shop-session-gating-inventory.md Feature 3
// 전제: 로컬 서버(5173) + 로컬 DB (방장 코인 자동충전). register API 사용.
//
// 검증 항목 (합격 기준 / 정찰 엣지):
//   [F3-1] 메인탭 3개 노출(🎬 광고샵 / 🪙 코인샵 / 📦 내 아이템)
//   [F3-2] 빈 상태: 아무것도 없을 때 인벤토리 빈 안내문 + 큰 미리보기 DOM 존재
//   [F3-3] 광고 아이템 구매 → 인벤토리에 카테고리 섹션 + 카드 등장
//   [F3-4] 광고 아이템 장착 → 인벤토리 카드 ✓ 장착중 + onAdEquipApplied 반영
//   [F3-5] 같은 슬롯 코인+광고 동시 장착 → ✓ 장착중이 mergedEquipped 승자(광고) 1개에만
//   [F3-6] 광고 해제 → 같은 슬롯 코인 장착이 ✓로 자동 복귀(syncEquipBadge)
//   [F3-7] doEquip/adEquip 후 renderModal 재진입이 inventory 메인탭 유지(코인/광고샵 안 튕김)
//   [F3-8] 큰 미리보기 = mergedEquipped 합성(장착 paint filter가 sprite에 반영)
//   [F3-9] 회귀: spin-arena 상점엔 📦(메인탭) 미노출
//   [F3-10] 콘솔 에러 0
const { chromium } = require('playwright');
const URL = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));

// catalog 검증 아이템 (paint 슬롯에 코인 paint_dark + 광고 paint_ad_aqua 둘 다 존재 → 같은 슬롯 경쟁 테스트)
//   horse 코인 paint는 대부분 가챠 전용(directBuy 없음 → "🎲 뽑기로 획득" 잠금)이라 직접구매 불가.
//   직접구매 가능한 코인 paint 앵커(directBuy:true)는 paint_dark(다크 도색) 하나뿐 → 이걸로 구매/장착 검증.
const COIN_PAINT = 'paint_dark';     // price 50, directBuy:true (직접구매 가능한 코인 paint 앵커)
const COIN_PAINT_NAME = '다크 도색';
const AD_PAINT = 'paint_ad_aqua';    // adPrice 30, adOnly
const AD_BIB = 'bib_ad_ruby';        // 다른 슬롯 광고 아이템 (인벤토리 섹션 다중 확인)

(async () => {
    let pass = true;
    const check = (cond, label) => { console.log(label + ':', cond ? 'PASS' : 'FAIL'); if (!cond) pass = false; };

    // 신규 QA 계정 (소유 상태 오염 방지 — 코인 paint 소유 검증을 깨끗하게)
    const qaName = 'qi' + Date.now().toString(36).slice(-8);
    const reg = await fetch(URL + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: qaName, pin: '1234' })
    }).then(r => r.json()).catch(e => ({ error: String(e) }));
    if (!reg.token) { console.log('FAIL: register 실패', JSON.stringify(reg)); process.exit(1); }
    console.log('QA 계정:', qaName);

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
        // 방장이면 로컬DB가 코인 자동충전 → 코인 paint 구매 가능
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: args.name, roomName: 'qa-inventory', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    }, { token: reg.token, name: qaName });

    await page.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
        const ar = sessionStorage.getItem('horseRaceActiveRoom');
        return ar && JSON.parse(ar).roomId;
    }, null, { timeout: 12000 }).catch(() => {});
    await wait(1500); // socket:authenticate + wallet 동기화

    const authed = await page.evaluate(() => window.HorseShop && HorseShop.isAuthed());
    check(authed === true, '[전제] 페이지 로드 시 자동 socket 인증(HorseShop.isAuthed)');

    // 빠른방(free)로 생성하면 currentServerId=null → Feature 2로 코인샵이 게이팅된다(정상 동작).
    //   코인 경제(shop:buy/equip)는 socket.authedUserId 권위라 serverId와 무관하게 동작하므로,
    //   F3-5/6(코인+광고 같은 슬롯) 시나리오를 위해 클라 currentServerId만 정규값으로 주입해
    //   코인샵 카드 UI를 활성화한다(서버 권위 경제엔 영향 없음 — 순수 UI 게이트 해제).
    const freeServerId = await page.evaluate(() => window.currentServerId);
    check(freeServerId == null, '[전제·Feature2] 빠른방=free 서버(currentServerId=null) — 코인샵 게이팅 기준, got ' + freeServerId);

    // ── 상점 열기 ──
    await page.evaluate(() => HorseShop.openShop());
    await page.waitForSelector('#horseShopMount .hshop-overlay', { timeout: 5000 });
    await wait(300);

    // ── 코인샵 "준비 중" 게이트 해제(테스트 토글) — 코인 paint 구매/장착(F3-5/6) 경로 검증을 위해 ──
    //   기본 COIN_SHOP_COMING_SOON=true면 currentServerId를 올려도 코인샵 카드가 안 나온다(준비 중 우선).
    //   __setComingSoon(false)로 코인샵을 활성화해야 아래 free 게이팅(NOTICE)·코인 구매 경로가 살아난다.
    //   토글은 localhost 가드라 로컬 테스트에서만 동작(운영 무영향).
    const coinShopActivated = await page.evaluate(() => {
        const ok = !!(window.ShopModule && window.ShopModule.__setComingSoon);
        if (ok) window.ShopModule.__setComingSoon(false);
        return ok && window.ShopModule.__getComingSoon() === false;
    });
    check(coinShopActivated, '[전제] ShopModule.__setComingSoon(false) → 코인샵 활성화(준비 중 게이트 해제)');

    // ── [Feature2 회귀] free 서버에서 코인샵 탭 = 안내문(카드 0) ──
    const coinNotice = await page.evaluate(() => {
        const t = Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab'))
            .find(b => b.textContent.indexOf('코인샵') >= 0);
        if (t) t.click();
        return null;
    });
    await wait(250);
    const coinGated = await page.evaluate(() => {
        const note = document.querySelector('#horseShopMount .hshop-empty');
        const cards = document.querySelectorAll('#horseShopMount .hshop-card').length;
        return { noteText: note ? note.textContent : null, cards };
    });
    check(coinGated.cards === 0 && coinGated.noteText && coinGated.noteText.indexOf('코인샵을 사용할 수 없어요') >= 0,
        '[Feature2 회귀] free 서버 코인샵 = 안내문(카드 0): ' + JSON.stringify(coinGated));
    void coinNotice;

    // ── [F3-1] 메인탭 3개 ──
    const mainTabs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab')).map(b => b.textContent.trim()));
    check(mainTabs.length === 3, '[F3-1] 메인탭 3개, got ' + mainTabs.length + ' :: ' + JSON.stringify(mainTabs));
    check(mainTabs.some(t => t.indexOf('내 아이템') >= 0), '[F3-1] 📦 내 아이템 탭 라벨 존재');
    check(mainTabs.some(t => t.indexOf('광고샵') >= 0) && mainTabs.some(t => t.indexOf('코인샵') >= 0),
        '[F3-1] 🎬 광고샵 / 🪙 코인샵 탭 동반 존재');

    // ── 인벤토리 탭 클릭 헬퍼 ──
    async function clickInventory() {
        await page.evaluate(() => {
            const t = Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab'))
                .find(b => b.textContent.indexOf('내 아이템') >= 0);
            if (t) t.click();
        });
        await wait(250);
    }

    // ── [F3-2] 빈 상태(아무것도 안 산 신규 계정) ──
    await clickInventory();
    const emptyState = await page.evaluate(() => {
        const body = document.querySelector('#horseShopMount .hshop-inv-body');
        const empty = document.querySelector('#horseShopMount .hshop-empty');
        const previewWrap = document.querySelector('#horseShopMount .hshop-inv-preview-wrap');
        const preview = document.querySelector('#horseShopMount .hshop-inv-preview');
        const sprite = document.querySelector('#horseShopMount .hshop-inv-sprite');
        const sections = document.querySelectorAll('#horseShopMount .hshop-inv-section').length;
        return {
            hasBody: !!body, hasEmpty: !!empty,
            emptyText: empty ? empty.textContent : null,
            hasPreviewWrap: !!previewWrap, hasPreview: !!preview, hasSprite: !!sprite,
            sections
        };
    });
    check(emptyState.hasBody, '[F3-2] 인벤토리 본문(.hshop-inv-body) 렌더');
    check(emptyState.hasPreviewWrap && emptyState.hasPreview && emptyState.hasSprite,
        '[F3-2] 큰 미리보기 DOM 존재(wrap/preview/sprite)');
    check(emptyState.hasEmpty && emptyState.sections === 0,
        '[F3-2] 소유 0 → 빈 안내문 + 섹션 0개 (text=' + JSON.stringify(emptyState.emptyText) + ')');

    // ── 광고코인 충전(시청 3초 대신 ad-wallet 직접 세팅) + 광고 아이템 구매를 위해 sessionStorage 주입 ──
    //   광고 구매 경로(adBuy)는 ad-wallet 차감이라, 코인을 충분히 주고 UI 클릭으로 실제 구매를 태운다.
    await page.evaluate(() => {
        const w = { coins: 500, owned: [], equipped: {}, lastWatch: Date.now() };
        sessionStorage.setItem('adWallet', JSON.stringify(w));
    });
    // openShop이 loadAdWallet로 sessionStorage를 다시 읽도록 모달 닫고 재오픈
    await page.evaluate(() => HorseShop.closeShop());
    await wait(200);
    await page.evaluate(() => HorseShop.openShop());
    await page.waitForSelector('#horseShopMount .hshop-overlay', { timeout: 5000 });
    await wait(300);

    // ── [F3-3] 광고샵에서 광고 paint + 광고 bib 구매 ──
    async function gotoMain(label) {
        await page.evaluate(l => {
            const t = Array.from(document.querySelectorAll('#horseShopMount .hshop-maintab'))
                .find(b => b.textContent.indexOf(l) >= 0);
            if (t) t.click();
        }, label);
        await wait(250);
    }
    async function gotoSub(slotLabelPart) {
        await page.evaluate(p => {
            const t = Array.from(document.querySelectorAll('#horseShopMount .hshop-tab'))
                .find(b => b.textContent.indexOf(p) >= 0);
            if (t) t.click();
        }, slotLabelPart);
        await wait(200);
    }
    async function buyAdByName(name) {
        return await page.evaluate(nm => {
            const cards = Array.from(document.querySelectorAll('#horseShopMount .hshop-card'));
            const card = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === nm);
            const btn = card && card.querySelector('button.hshop-buy--ad');
            if (!btn) return { ok: false, reason: 'no ad-buy btn for ' + nm };
            btn.click(); return { ok: true };
        }, name);
    }

    await gotoMain('광고샵');
    await gotoSub('도색'); // paint 슬롯
    const buyAdPaint = await buyAdByName('아쿠아 도색'); // paint_ad_aqua
    check(buyAdPaint.ok, '[F3-3] 광고 paint(아쿠아 도색) 구매 클릭: ' + JSON.stringify(buyAdPaint));
    await wait(400);
    await gotoSub('이름표'); // bib 슬롯
    const buyAdBib = await buyAdByName('루비 이름표'); // bib_ad_ruby
    check(buyAdBib.ok, '[F3-3] 광고 bib(루비 이름표) 구매 클릭: ' + JSON.stringify(buyAdBib));
    await wait(400);

    const adOwned = await page.evaluate(() => (window.ShopModule.getAdWallet().owned || []).slice());
    check(adOwned.indexOf(AD_PAINT) >= 0 && adOwned.indexOf(AD_BIB) >= 0,
        '[F3-3] ad-wallet owned 반영: ' + JSON.stringify(adOwned));

    // ── 인벤토리로 → 광고 소유 아이템이 섹션으로 나오는지 ──
    await clickInventory();
    const invAfterAd = await page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-section'))
            .map(s => s.querySelector('.hshop-inv-section-head') ? s.querySelector('.hshop-inv-section-head').textContent : '?');
        const names = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-section .hshop-name')).map(n => n.textContent);
        const empty = !!document.querySelector('#horseShopMount .hshop-empty');
        return { sections, names, empty };
    });
    check(!invAfterAd.empty && invAfterAd.names.indexOf('아쿠아 도색') >= 0 && invAfterAd.names.indexOf('루비 이름표') >= 0,
        '[F3-3] 인벤토리에 광고 아이템 2개 섹션 등장: ' + JSON.stringify(invAfterAd.names));
    // [엣지] free 서버 인벤토리 = 광고분만 (코인 소유 0 → 코인 아이템 미노출)
    check(invAfterAd.names.length === 2,
        '[엣지·free서버] 인벤토리=광고 아이템만(코인 소유 없음), 항목수=' + invAfterAd.names.length);

    // ── [F3-4] 인벤토리에서 광고 paint 장착 → ✓ 장착중 ──
    async function clickInvCardBtn(name) {
        return await page.evaluate(nm => {
            const cards = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-section .hshop-card'));
            const card = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === nm);
            const btn = card && card.querySelector('button.hshop-equip');
            if (!btn) return { ok: false, reason: 'no equip btn' };
            const before = btn.textContent.trim();
            btn.click();
            return { ok: true, before };
        }, name);
    }
    const equipAdPaint = await clickInvCardBtn('아쿠아 도색');
    check(equipAdPaint.ok, '[F3-4] 인벤토리 광고 paint 장착 버튼 클릭: ' + JSON.stringify(equipAdPaint));
    await wait(400);

    // adEquip 후 renderModal 호출 → inventory 본문 유지돼야 함 (F3-7 핵심)
    const stillInvAfterAdEquip = await page.evaluate(() => ({
        invBody: !!document.querySelector('#horseShopMount .hshop-inv-body'),
        activeMain: (document.querySelector('#horseShopMount .hshop-maintab.is-active') || {}).textContent
    }));
    check(stillInvAfterAdEquip.invBody && /내 아이템/.test(stillInvAfterAdEquip.activeMain || ''),
        '[F3-7] adEquip 후 인벤토리 메인탭 유지(코인/광고샵 안 튕김): active=' + JSON.stringify(stillInvAfterAdEquip.activeMain));

    const adPaintEquipped = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-section .hshop-card'));
        const card = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === '아쿠아 도색');
        const btn = card && card.querySelector('button.hshop-equip');
        return btn ? { equipped: btn.classList.contains('is-equipped'), text: btn.textContent.trim() } : null;
    });
    check(adPaintEquipped && adPaintEquipped.equipped && /장착중/.test(adPaintEquipped.text),
        '[F3-4] 광고 paint 인벤토리 카드 ✓ 장착중: ' + JSON.stringify(adPaintEquipped));

    // ── [F3-8] 큰 미리보기 sprite filter = 장착 paint filter ──
    const previewFilter = await page.evaluate(() => {
        const sprite = document.querySelector('#horseShopMount .hshop-inv-sprite');
        return sprite ? sprite.style.filter : null;
    });
    check(previewFilter && previewFilter.length > 0,
        '[F3-8] 큰 미리보기 sprite에 장착 paint filter 반영(merged): filter="' + previewFilter + '"');

    // ── [F3-5] 같은 슬롯 코인 paint 구매+장착 → ✓는 광고(merged 승자) 1개에만 ──
    //   코인 paint_dark(다크 도색)을 코인샵에서 구매+장착. 같은 paint 슬롯에 코인+광고 둘 다 장착 상태가 된다.
    //   (황금 도색 등 대부분 코인 paint는 가챠 전용이라 직접구매 불가 → directBuy 앵커 paint_dark 사용.)
    //   빠른방(free)은 코인샵이 게이팅(준비 중/free)돼 카드가 안 나오므로, 코인 경제(서버 권위)는 그대로 두고
    //   ① __setComingSoon(false)(위에서 적용됨)로 준비 중 게이트 해제 + ② currentServerId 정규값 주입으로
    //   free 게이트도 풀어 코인샵 카드 UI를 활성화한다(순수 UI 게이트 해제 — 서버 권위 경제엔 영향 없음).
    await page.evaluate(() => { window.currentServerId = '__qa_unlock__'; });
    await gotoMain('코인샵');
    await gotoSub('도색');
    const buyCoinPaint = await page.evaluate((nm) => {
        const cards = Array.from(document.querySelectorAll('#horseShopMount .hshop-card'));
        const card = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === nm);
        const btn = card && card.querySelector('button.hshop-buy');
        if (!btn || btn.disabled) return { ok: false, text: btn ? btn.textContent : 'no-btn' };
        btn.click(); return { ok: true };
    }, COIN_PAINT_NAME);
    check(buyCoinPaint.ok, '[F3-5] 코인 paint(' + COIN_PAINT_NAME + ') 구매 버튼 클릭: ' + JSON.stringify(buyCoinPaint));
    await page.waitForSelector('#shopLayer .hshop-confirm-ok', { timeout: 3000 }).catch(() => {});
    await page.click('#shopLayer .hshop-confirm-ok').catch(() => {});
    await wait(1200);
    const coinOwned = await page.evaluate(() => (window.ShopModule.getWallet().owned || []).slice());
    check(coinOwned.indexOf(COIN_PAINT) >= 0, '[F3-5] 코인 paint 소유 반영: ' + JSON.stringify(coinOwned));

    // 코인 paint 장착 (코인샵 카드에서)
    await page.evaluate((nm) => {
        const cards = Array.from(document.querySelectorAll('#horseShopMount .hshop-card'));
        const card = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === nm);
        const btn = card && card.querySelector('button.hshop-equip');
        if (btn) btn.click();
    }, COIN_PAINT_NAME);
    await wait(800);

    // mergedEquipped: 같은 paint 슬롯에 코인+광고 둘 다 → 광고 우선
    const merged = await page.evaluate(() => window.HorseShop && window.ShopModule
        ? (window.ShopModule.getEquipped() ? null : null) : null);
    const mergedPaint = await page.evaluate(() => {
        // mergedEquipped는 어댑터 내부 함수 — hook 경유로만 접근. 대신 wallet/adWallet로 직접 계산.
        const db = window.ShopModule.getEquipped() || {};
        const ad = (window.ShopModule.getAdWallet() || {}).equipped || {};
        return { dbPaint: db.paint || null, adPaint: ad.paint || null };
    });
    check(mergedPaint.dbPaint === COIN_PAINT && mergedPaint.adPaint === AD_PAINT,
        '[F3-5] 같은 슬롯 코인+광고 둘 다 장착 상태: ' + JSON.stringify(mergedPaint));

    // 인벤토리에서 paint 섹션의 ✓ 장착중 개수 == 1 (광고 승자에만)
    await clickInventory();
    const paintBadges = await page.evaluate(() => {
        // paint 섹션 찾기 (헤더에 '도색' 포함)
        const sections = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-section'));
        const paintSec = sections.find(s => {
            const h = s.querySelector('.hshop-inv-section-head');
            return h && h.textContent.indexOf('도색') >= 0;
        });
        if (!paintSec) return null;
        const equippedCards = Array.from(paintSec.querySelectorAll('.hshop-card')).map(c => {
            const name = c.querySelector('.hshop-name') ? c.querySelector('.hshop-name').textContent : '?';
            const btn = c.querySelector('button.hshop-equip');
            return { name, equipped: btn ? btn.classList.contains('is-equipped') : false, text: btn ? btn.textContent.trim() : null };
        });
        const equippedCount = equippedCards.filter(c => c.equipped).length;
        const winner = equippedCards.filter(c => c.equipped).map(c => c.name);
        return { equippedCount, winner, all: equippedCards };
    });
    check(paintBadges && paintBadges.equippedCount === 1 && paintBadges.winner.indexOf('아쿠아 도색') >= 0,
        '[F3-5] paint 섹션 ✓ 장착중 == 1, 승자=광고(아쿠아 도색): ' + JSON.stringify(paintBadges));

    // ── [F3-6] 광고 paint 해제 → 코인 paint(다크 도색)이 ✓로 자동 복귀 ──
    const unequipAd = await clickInvCardBtn('아쿠아 도색'); // 장착중 → 클릭 시 해제(adEquip null)
    check(unequipAd.ok && /장착중/.test(unequipAd.before),
        '[F3-6] 광고 paint 해제 클릭(직전 상태 장착중): ' + JSON.stringify(unequipAd));
    await wait(600);
    await clickInventory(); // 재렌더 후 상태 재확인 (해제는 renderModal 자동 호출되지만 안전하게 한번 더)
    const afterUnequip = await page.evaluate(() => {
        const sections = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-section'));
        const paintSec = sections.find(s => {
            const h = s.querySelector('.hshop-inv-section-head');
            return h && h.textContent.indexOf('도색') >= 0;
        });
        if (!paintSec) return null;
        const cards = Array.from(paintSec.querySelectorAll('.hshop-card')).map(c => ({
            name: c.querySelector('.hshop-name') ? c.querySelector('.hshop-name').textContent : '?',
            equipped: c.querySelector('button.hshop-equip') ? c.querySelector('button.hshop-equip').classList.contains('is-equipped') : false
        }));
        const ad = (window.ShopModule.getAdWallet() || {}).equipped || {};
        return { adPaint: ad.paint || null, cards, winner: cards.filter(c => c.equipped).map(c => c.name) };
    });
    check(afterUnequip && afterUnequip.adPaint === null,
        '[F3-6] 광고 paint 해제됨(adWallet.equipped.paint=null): ' + JSON.stringify(afterUnequip && afterUnequip.adPaint));
    check(afterUnequip && afterUnequip.winner.length === 1 && afterUnequip.winner.indexOf(COIN_PAINT_NAME) >= 0,
        '[F3-6] 코인 paint(' + COIN_PAINT_NAME + ') ✓ 자동 복귀(syncEquipBadge): ' + JSON.stringify(afterUnequip && afterUnequip.winner));

    // ── [F3-7] doEquip(코인) 후에도 인벤토리 메인탭 유지 ──
    //   인벤토리 카드의 코인 장착 버튼을 눌러도 inventory에 머무는지 (doEquip → renderModal)
    await page.evaluate((nm) => {
        // 다크 도색(현재 장착중) 클릭 → 해제. doEquip 경유.
        const cards = Array.from(document.querySelectorAll('#horseShopMount .hshop-inv-section .hshop-card'));
        const card = cards.find(c => c.querySelector('.hshop-name') && c.querySelector('.hshop-name').textContent === nm);
        const btn = card && card.querySelector('button.hshop-equip');
        if (btn) btn.click();
    }, COIN_PAINT_NAME);
    await wait(800);
    const stillInvAfterCoinEquip = await page.evaluate(() => ({
        invBody: !!document.querySelector('#horseShopMount .hshop-inv-body'),
        activeMain: (document.querySelector('#horseShopMount .hshop-maintab.is-active') || {}).textContent
    }));
    check(stillInvAfterCoinEquip.invBody && /내 아이템/.test(stillInvAfterCoinEquip.activeMain || ''),
        '[F3-7] doEquip(코인) 후에도 인벤토리 메인탭 유지: active=' + JSON.stringify(stillInvAfterCoinEquip.activeMain));

    await page.evaluate(() => HorseShop.closeShop());
    await wait(300);

    // ── [F3-9] 회귀: spin-arena 상점엔 📦(메인탭) 미노출 ──
    const spinName = 'qs' + Date.now().toString(36).slice(-8);
    const spinReg = await fetch(URL + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: spinName, pin: '1234' })
    }).then(r => r.json()).catch(e => ({ error: String(e) }));
    const spinErrs = [];
    const spinPage = await (await browser.newContext()).newPage();
    spinPage.on('console', m => { if (m.type() === 'error') spinErrs.push(m.text()); });
    spinPage.on('pageerror', e => spinErrs.push(String(e)));
    await spinPage.addInitScript(args => {
        localStorage.setItem('tutorialSeen_spin-arena', 'v1');
        localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
        localStorage.setItem('pendingSpinArenaRoom', JSON.stringify({
            userName: args.name, roomName: 'qa-spin-noinv', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
    }, { token: spinReg.token, name: spinName });
    await spinPage.goto(URL + '/spin-arena?createRoom=true', { waitUntil: 'domcontentloaded' });
    await spinPage.waitForFunction(() => {
        const ar = sessionStorage.getItem('spinArenaActiveRoom');
        return ar && JSON.parse(ar).roomId;
    }, null, { timeout: 12000 }).catch(() => {});
    await wait(1500);
    await spinPage.evaluate(() => window.SpinShop && SpinShop.openShop());
    await spinPage.waitForSelector('#spinShopMount .hshop-overlay', { timeout: 5000 }).catch(() => {});
    await wait(300);
    const spinMainTabs = await spinPage.evaluate(() =>
        document.querySelectorAll('#spinShopMount .hshop-maintab').length);
    const spinInvTab = await spinPage.evaluate(() =>
        Array.from(document.querySelectorAll('#spinShopMount .hshop-maintab')).some(b => b.textContent.indexOf('내 아이템') >= 0));
    check(spinMainTabs === 0 && spinInvTab === false,
        '[F3-9] 회귀: spin-arena 상점 메인탭 0개 + 📦 미노출 (maintabs=' + spinMainTabs + ')');

    // ── [F3-10] 콘솔 에러 0 ──
    const ignore = /favicon|adsbygoogle|googlesyndication|ERR_BLOCKED_BY_CLIENT|tailwind|TagError|status of 40[0-9]|net::ERR/i;
    const real = errs.filter(e => !ignore.test(e));
    const realSpin = spinErrs.filter(e => !ignore.test(e));
    check(real.length === 0, '[F3-10] 경마 콘솔 에러 0, got ' + real.length + (real.length ? ' :: ' + real.join(' | ').slice(0, 400) : ''));
    check(realSpin.length === 0, '[F3-10] 스핀 콘솔 에러 0, got ' + realSpin.length + (realSpin.length ? ' :: ' + realSpin.join(' | ').slice(0, 300) : ''));

    console.log(pass ? '\n=== ALL PASS ===' : '\n=== FAIL ===');
    await browser.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('테스트 예외:', e); process.exit(1); });
