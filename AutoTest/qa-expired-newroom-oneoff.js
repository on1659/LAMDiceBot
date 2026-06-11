// QA 일회성 검증 v2 (2026-06-11 spin-arena/ladder 다이렉트 링크 최종 QA)
// 실행: node AutoTest/qa-expired-newroom-oneoff.js
// 전제: node server.js 가 5173 포트로 떠 있어야 함
//
// v1 → v2 교정:
//  - /free/{game} 단독 경로는 서버 미서빙(404) — /free 메인 카드 클릭으로 교체 (routes/api.js 확인)
//  - pageerror "Y" = AdSense adsbygoogle.js TagError (전 페이지 기존 발생, 외부 스크립트)
//    → window error 리스너 + filename 기반으로 앱(localhost) 출처 에러만 판정
//
// 검증 항목:
//  [A] 만료 모달 "새 방 만들기" 신규 경로 (socket/free.js GAME_TYPE_BY_SLUG 이더 반영분)
//  [B] horse-race 회귀: /free 카드 → 생성 → 초대 바 → 게스트 다이렉트 링크 합류
//  [C] dice: /game HTTP 200 + /free 카드 생성 흐름
//  [D] spin-arena 방 생성(dice 로비 redirect 계약)~초대 바까지 앱 콘솔 에러 0

const { chromium } = require('playwright');
const http = require('http');

const BASE = 'http://localhost:5173';
const results = { pass: [], fail: [] };

function record(name, ok, detail) {
    (ok ? results.pass : results.fail).push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// window error 리스너 — filename으로 앱/외부 분류 (document별 초기화, 누적은 테스트에서 수집)
const ERROR_COLLECTOR = () => {
    window.__qaErrors = window.__qaErrors || [];
    window.addEventListener('error', e => {
        window.__qaErrors.push({
            message: String(e.message || ''),
            filename: String(e.filename || '')
        });
    }, true);
};

async function collectAppErrors(page) {
    // 현재 document의 에러 중 앱(localhost) 스크립트 출처만
    const errs = await page.evaluate(() => window.__qaErrors || []).catch(() => []);
    return errs.filter(e => e.filename && e.filename.includes('localhost'));
}

async function getUsersCount(page) {
    return page.evaluate(() => {
        const el = document.getElementById('usersCount');
        return el ? el.textContent.trim() : null;
    });
}

// ─── [A] 만료 모달 → 새 방 만들기 ───
async function testExpiredNewRoom(browser, g) {
    const tag = `[A:${g.slug}]`;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(ERROR_COLLECTOR);
    await page.addInitScript(() => {
        localStorage.setItem('freeUserName', '만료유저');
    });

    const appErrorsAcc = [];
    page.on('framenavigated', async () => {}); // placeholder — 수집은 단계별 호출

    await page.goto(`${BASE}${g.path}/ZZZZ`);
    await page.waitForFunction(() => {
        const m = document.getElementById('expiredModal');
        return m && !m.classList.contains('hidden');
    }, { timeout: 10000 }).catch(() => {});
    const modalUp = await page.evaluate(() => {
        const m = document.getElementById('expiredModal');
        return !!m && !m.classList.contains('hidden');
    });
    record(`${tag} expired 모달 표시`, modalUp);
    if (!modalUp) { await ctx.close(); return; }

    // free.html document의 앱 에러 수집 (navigation 전)
    appErrorsAcc.push(...await collectAppErrors(page));

    await page.click('#expiredNewRoomButton');
    const freeUrlRe = new RegExp(`/free/${g.slug}/[A-Z0-9]{4,6}$`);
    let urlOk = true;
    await page.waitForURL(freeUrlRe, { timeout: 25000 }).catch(() => { urlOk = false; });
    record(`${tag} 새 방 만들기 → 게임 페이지 + URL /free/${g.slug}/CODE`, urlOk, `url=${page.url()}`);

    if (urlOk) {
        await page.waitForFunction(() => {
            const el = document.getElementById('usersCount');
            return el && el.textContent.trim() === '1';
        }, { timeout: 15000 }).catch(() => {});
        const count = await getUsersCount(page);
        record(`${tag} 방 생성 완료 (usersCount=1)`, count === '1', `count=${count}`);

        const hostState = await page.evaluate(() => {
            const hc = document.getElementById('hostControls');
            const bar = document.getElementById('freeInviteBar');
            return {
                hostControlsVisible: !!hc && getComputedStyle(hc).display !== 'none',
                inviteBar: !!bar,
                crown: document.body.innerText.includes('👑')
            };
        });
        record(`${tag} 호스트 확인 (hostControls 표시 + 👑)`,
            hostState.hostControlsVisible && hostState.crown,
            JSON.stringify(hostState));
        record(`${tag} 초대 바(#freeInviteBar) 표시`, hostState.inviteBar);

        appErrorsAcc.push(...await collectAppErrors(page));
    }

    record(`${tag} 앱 스크립트 에러 0 (외부 광고 제외)`, appErrorsAcc.length === 0,
        appErrorsAcc.length ? JSON.stringify(appErrorsAcc) : '');

    await ctx.close();
}

// ─── [B] horse-race 회귀: dice 로비 redirect 계약 → 생성 → 초대 바 → 게스트 합류 ───
async function testHorseRegression(browser) {
    const tag = '[B:horse]';
    const ctxHost = await browser.newContext();
    const pageHost = await ctxHost.newPage();
    await pageHost.addInitScript(() => {
        localStorage.setItem('horseRaceUserName', '경마호스트');
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: '경마호스트',
            roomName: '경마 회귀검증방',
            isPrivate: false,
            password: '',
            expiryHours: 12,
            blockIPPerUser: false,
            serverId: null,
            serverName: null
        }));
    });

    await pageHost.goto(`${BASE}/horse-race?createRoom=true`);
    const freeUrlRe = /\/free\/horse\/[A-Z0-9]{4,6}$/;
    let urlOk = true;
    await pageHost.waitForURL(freeUrlRe, { timeout: 25000 }).catch(() => { urlOk = false; });
    record(`${tag} 방 생성 + URL /free/horse/CODE`, urlOk, `url=${pageHost.url()}`);
    if (!urlOk) { await ctxHost.close(); return; }

    const hostUrl = pageHost.url();
    await pageHost.waitForFunction(() => !!document.getElementById('freeInviteBar'), { timeout: 10000 }).catch(() => {});
    const barOk = await pageHost.evaluate(() => !!document.getElementById('freeInviteBar'));
    record(`${tag} 초대 바 표시`, barOk);

    const ctxGuest = await browser.newContext();
    const pageGuest = await ctxGuest.newPage();
    await pageGuest.addInitScript(() => {
        localStorage.setItem('freeUserName', '경마게스트');
    });
    await pageGuest.goto(hostUrl);
    await pageGuest.waitForFunction(() => {
        const el = document.getElementById('usersCount');
        return el && el.textContent.trim() === '2';
    }, { timeout: 25000 }).catch(() => {});
    record(`${tag} 게스트 다이렉트 링크 합류 (usersCount=2)`,
        (await getUsersCount(pageGuest)) === '2', `url=${pageGuest.url()}`);

    await pageHost.waitForFunction(() => {
        const el = document.getElementById('usersCount');
        return el && el.textContent.trim() === '2';
    }, { timeout: 10000 }).catch(() => {});
    record(`${tag} 호스트 화면 동기화 (usersCount=2)`, (await getUsersCount(pageHost)) === '2');

    await ctxGuest.close();
    await ctxHost.close();
}

// ─── [C] dice: HTTP 200 + /free 카드 생성 ───
function httpStatus(path) {
    return new Promise(resolve => {
        http.get(BASE + path, res => { res.resume(); resolve(res.statusCode); })
            .on('error', () => resolve(0));
    });
}

async function testDice(browser) {
    const tag = '[C:dice]';
    const status = await httpStatus('/game');
    record(`${tag} /game HTTP 200`, status === 200, `status=${status}`);

    // dice 로비 자유 모드 — /free 진입(자가 reload) → 이름 입력 → 방 만들기 → 방 생성하기
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/free`);
    await page.waitForSelector('#globalUserNameInput', { state: 'visible', timeout: 15000 });
    await page.fill('#globalUserNameInput', '주사위유저');
    await page.click('button.btn-create');
    await page.waitForSelector('#createRoomSection.active', { timeout: 10000 });
    // 기본 라디오가 horse-race(checked)이므로 dice 명시 선택
    await page.check('input[name="gameType"][value="dice"]');
    await page.click('text=방 생성하기');
    // dice 페이지는 id="userCount" (단수)
    await page.waitForFunction(() => {
        const el = document.getElementById('userCount');
        return el && el.textContent.trim() === '1';
    }, { timeout: 15000 }).catch(() => {});
    const count = await page.evaluate(() => {
        const el = document.getElementById('userCount');
        return el ? el.textContent.trim() : null;
    });
    const urlNow = page.url();
    record(`${tag} dice 로비 자유 모드 dice 방 생성 (userCount=1, /free/dice/CODE)`,
        count === '1' && /\/free\/dice\/[A-Z0-9]{4,6}$/.test(urlNow), `count=${count}, url=${urlNow}`);
    await ctx.close();
}

// ─── [D] spin-arena 정식 생성 경로(dice 로비 redirect 계약) 앱 에러 0 ───
async function testSpinArenaConsole(browser) {
    const tag = '[D:spin-arena 콘솔]';
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(ERROR_COLLECTOR);
    await page.addInitScript(() => {
        localStorage.setItem('spinArenaUserName', '콘솔체커');
        localStorage.setItem('pendingSpinArenaRoom', JSON.stringify({
            userName: '콘솔체커',
            roomName: '콘솔 검증방',
            isPrivate: false,
            password: '',
            expiryHours: 12,
            blockIPPerUser: false,
            serverId: null,
            serverName: null
        }));
    });
    await page.goto(`${BASE}/spin-arena?createRoom=true`);
    let urlOk = true;
    await page.waitForURL(/\/free\/spin-arena\/[A-Z0-9]{4,6}$/, { timeout: 20000 }).catch(() => { urlOk = false; });
    await page.waitForFunction(() => !!document.getElementById('freeInviteBar'), { timeout: 10000 }).catch(() => {});
    const barOk = await page.evaluate(() => !!document.getElementById('freeInviteBar'));
    record(`${tag} 방 생성 → 초대 바 표시`, urlOk && barOk, `url=${page.url()}`);

    await page.waitForTimeout(1500);
    const appErrors = await collectAppErrors(page);
    record(`${tag} 방 생성~초대 바 앱 스크립트 에러 0 (외부 광고 제외)`, appErrors.length === 0,
        appErrors.length ? JSON.stringify(appErrors) : '');

    await ctx.close();
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        console.log('──── [A] 만료 모달 → 새 방 만들기 ────');
        await testExpiredNewRoom(browser, { slug: 'spin-arena', path: '/spin-arena' });
        await testExpiredNewRoom(browser, { slug: 'ladder', path: '/ladder' });

        console.log('\n──── [B] horse-race 회귀 ────');
        await testHorseRegression(browser);

        console.log('\n──── [C] dice ────');
        await testDice(browser);

        console.log('\n──── [D] spin-arena 콘솔 에러 ────');
        await testSpinArenaConsole(browser);
    } catch (err) {
        console.error('테스트 중 예외:', err.message);
        results.fail.push('exception: ' + err.message);
    } finally {
        await browser.close();
    }

    console.log('\n=== 결과 ===');
    console.log(`Pass: ${results.pass.length}`);
    console.log(`Fail: ${results.fail.length}`);
    if (results.fail.length > 0) {
        console.log('\n실패 항목:');
        results.fail.forEach(f => console.log(`  - ${f}`));
        process.exit(1);
    } else {
        console.log('\n✅ 전 항목 통과');
        process.exit(0);
    }
})();
