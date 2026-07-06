// spin-arena + ladder 다이렉트 링크 배선 검증 (2026-06-11 이더 지시서)
// 실행: node AutoTest/spin-ladder-direct-link-test.js
// 전제: node server.js 가 5173 포트로 떠 있어야 함
//
// 시나리오 (게임당):
//   1. 호스트 — dice 로비 redirect 계약 재현(localStorage pending{Game}Room + /{game}?createRoom=true)
//      → roomCreated → FreeInvite.init → URL이 /free/{slug}/CODE 로 교체 + #freeInviteBar 표시
//   2. 게스트B — 초대 바 URL(/free/{slug}/CODE) 직접 진입 → 같은 방 합류 (양쪽 usersCount 2)
//   3. 게스트C — 서버 방 URL 형식(/{game}/CODE) 직접 진입 → 같은 방 합류 (usersCount 3)
//   4. 존재하지 않는 코드 /{game}/ZZZZ → expired 모달
//
// 참고: serverId=null(자유 방) 기준이라 초대 바 URL은 /free/{slug}/CODE 형식.
//       실서버 serverId 보유 방(/{game}/CODE 바 표기 + 멤버십 게이트)은 DB 서버 픽스처가
//       필요해 수동 QA로 남김. GAME_PATH_TO_SLUG 배선은 시나리오 3이 검증.

const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';

const GAMES = [
    {
        label: 'spin-arena',
        path: '/spin-arena',
        slug: 'spin-arena',
        pendingRoomKey: 'pendingSpinArenaRoom',
        userNameKey: 'spinArenaUserName',
        roomName: '회전칼날 테스트방'
    },
    {
        label: 'ladder',
        path: '/ladder',
        slug: 'ladder',
        pendingRoomKey: 'pendingLadderRoom',
        userNameKey: 'ladderUserName',
        roomName: '사다리 테스트방'
    }
];

const results = { pass: [], fail: [] };
function record(name, ok, detail) {
    (ok ? results.pass : results.fail).push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function getUsersCount(page) {
    return page.evaluate(() => {
        const el = document.getElementById('usersCount');
        return el ? el.textContent.trim() : null;
    });
}

async function testGame(browser, g) {
    const tag = `[${g.label}]`;

    // ─── 1. 호스트: dice 로비 redirect 계약 재현 ───
    const ctxHost = await browser.newContext();
    const pageHost = await ctxHost.newPage();
    await pageHost.addInitScript(({ pendingRoomKey, userNameKey, roomName }) => {
        localStorage.setItem(userNameKey, '호스트A');
        localStorage.setItem(pendingRoomKey, JSON.stringify({
            userName: '호스트A',
            roomName: roomName,
            isPrivate: false,
            password: '',
            expiryHours: 12,
            blockIPPerUser: false,
            serverId: null,
            serverName: null
        }));
    }, { pendingRoomKey: g.pendingRoomKey, userNameKey: g.userNameKey, roomName: g.roomName });

    await pageHost.goto(`${BASE}${g.path}?createRoom=true`);
    const freeUrlRe = new RegExp(`/free/${g.slug}/[A-Z0-9]{4,6}$`);
    await pageHost.waitForURL(freeUrlRe, { timeout: 15000 });
    const hostUrl = pageHost.url();
    const shortcode = hostUrl.split('/').pop();
    record(`${tag} 1a: 호스트 방 생성 + URL /free/${g.slug}/CODE 교체`,
        /^[A-Z0-9]{4,6}$/.test(shortcode), `shortcode=${shortcode}`);

    // 초대 바 표시 + URL 텍스트 일치
    await pageHost.waitForFunction(() => !!document.getElementById('freeInviteBar'), { timeout: 10000 }).catch(() => {});
    const barInfo = await pageHost.evaluate(() => {
        const bar = document.getElementById('freeInviteBar');
        if (!bar) return null;
        const urlSpan = bar.querySelector('.fi-bar-url');
        return urlSpan ? urlSpan.textContent : '';
    });
    record(`${tag} 1b: #freeInviteBar 표시 + URL 텍스트`,
        !!barInfo && barInfo === hostUrl, `bar="${barInfo}"`);

    await pageHost.waitForTimeout(1000);
    record(`${tag} 1c: 호스트 usersCount=1`, (await getUsersCount(pageHost)) === '1',
        `count=${await getUsersCount(pageHost)}`);

    // ─── 2. 게스트B: 초대 바 URL 직접 진입 ───
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.addInitScript(() => {
        localStorage.setItem('freeUserName', '게스트B');
    });
    await pageB.goto(hostUrl);
    // 이름 토스트 3초 카운트다운 → resolve → /{game}?joinRoom=true 경유 → 재교체
    await pageB.waitForFunction(() => {
        const el = document.getElementById('usersCount');
        return el && el.textContent.trim() === '2';
    }, { timeout: 25000 }).catch(() => {});
    record(`${tag} 2a: 게스트B 다이렉트 링크 합류 (게스트 usersCount=2)`,
        (await getUsersCount(pageB)) === '2', `url=${pageB.url()}`);

    await pageHost.waitForFunction(() => {
        const el = document.getElementById('usersCount');
        return el && el.textContent.trim() === '2';
    }, { timeout: 10000 }).catch(() => {});
    record(`${tag} 2b: 호스트 화면 동기화 (호스트 usersCount=2)`,
        (await getUsersCount(pageHost)) === '2');

    const hostText = await pageHost.evaluate(() => document.body.innerText);
    record(`${tag} 2c: 호스트 화면에 게스트B 표시`, hostText.includes('게스트B'));

    // ─── 3. 게스트C: 서버 방 URL 형식(/{game}/CODE) 진입 ───
    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await pageC.addInitScript(() => {
        localStorage.setItem('freeUserName', '게스트C');
    });
    await pageC.goto(`${BASE}${g.path}/${shortcode}`);
    await pageC.waitForFunction(() => {
        const el = document.getElementById('usersCount');
        return el && el.textContent.trim() === '3';
    }, { timeout: 25000 }).catch(() => {});
    record(`${tag} 3: 게스트C /${g.slug}/CODE 형식 진입 합류 (usersCount=3)`,
        (await getUsersCount(pageC)) === '3', `url=${pageC.url()}`);

    // ─── 4. 존재하지 않는 코드 → expired 모달 ───
    const ctxD = await browser.newContext();
    const pageD = await ctxD.newPage();
    await pageD.goto(`${BASE}${g.path}/ZZZZ`);
    await pageD.waitForFunction(() => {
        const m = document.getElementById('expiredModal');
        return m && getComputedStyle(m).display !== 'none';
    }, { timeout: 10000 }).catch(() => {});
    const expiredVisible = await pageD.evaluate(() => {
        const m = document.getElementById('expiredModal');
        return !!m && getComputedStyle(m).display !== 'none';
    });
    record(`${tag} 4: /${g.slug}/ZZZZ → expired 모달`, expiredVisible, `url=${pageD.url()}`);

    await ctxD.close();
    await ctxC.close();
    await ctxB.close();
    await ctxHost.close();
}

(async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const g of GAMES) {
            console.log(`\n──── ${g.label} ────`);
            await testGame(browser, g);
        }
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
        console.log('\n✅ spin-arena + ladder 다이렉트 링크 전 시나리오 통과');
        process.exit(0);
    }
})();
