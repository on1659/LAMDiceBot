// P0-2 (다이렉트 링크 합류) + P0-6 (방 삭제 후 expired) 멀티탭 검증
// 실행: node AutoTest/free-multitab-test.js
// 전제: node server.js 가 5173 포트로 떠 있어야 함

const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';
const GAME = 'horse';        // horse-race는 진입 흐름 가장 안정적
const PATH = '/horse-race';

(async () => {
    const browser = await chromium.launch({ headless: true });
    const results = { pass: [], fail: [] };

    function record(name, ok, detail) {
        (ok ? results.pass : results.fail).push(`${name}${detail ? ' — ' + detail : ''}`);
        console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
    }

    try {
        // ─── P0-2: 호스트 + 게스트 합류 ───
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        await pageA.addInitScript(() => {
            localStorage.setItem('freeUserName', '호스트A');
        });
        await pageA.goto(`${BASE}/free/${GAME}`);
        await pageA.waitForURL(/\/free\/horse\/[A-Z0-9]+$/, { timeout: 15000 });
        const hostUrl = pageA.url();
        const shortcode = hostUrl.split('/').pop();
        record('P0-2a: 호스트 /free/horse 진입 + URL 자동 교체', /^[A-Z0-9]{4,6}$/.test(shortcode), `shortcode=${shortcode}`);

        // 호스트가 방에 진입했는지 — 방 컨텐츠 일부 확인
        await pageA.waitForTimeout(2000);
        const hostTitle = await pageA.title();
        record('P0-2b: 호스트 방 진입 확인', /경마|horse|LAM/i.test(hostTitle), `title="${hostTitle}"`);

        // 호스트의 FAB 확인
        const fabA = await pageA.evaluate(() => !!document.getElementById('freeInviteFab'));
        record('P0-2c: 호스트 FAB mount', fabA);

        // 게스트 컨텍스트 (시크릿)
        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();
        await pageB.addInitScript(() => {
            localStorage.setItem('freeUserName', '게스트B');
        });
        await pageB.goto(hostUrl);  // 다이렉트 링크 진입
        await pageB.waitForURL(/\/(horse-race|free\/horse)/, { timeout: 15000 });
        // 게스트 roomJoined 후 FreeInvite.init이 트리거될 때까지 명시적 대기
        await pageB.waitForFunction(
            () => !!document.getElementById('freeInviteFab') ||
                  document.body.innerText.includes('호스트A'),
            { timeout: 15000 }
        ).catch(() => {});
        await pageB.waitForTimeout(2000);

        // resolve API가 정상 응답해서 game 페이지에 도달
        const guestUrlNow = pageB.url();
        record('P0-2d: 게스트 다이렉트 링크 → game 페이지', /horse-race|\/free\/horse\//.test(guestUrlNow), guestUrlNow);

        // 게스트의 FAB도 mount되는지 (명시적 대기)
        const fabB = await pageB.evaluate(() => !!document.getElementById('freeInviteFab'));
        record('P0-2e: 게스트 FAB mount', fabB);

        // 게스트 화면에 호스트 이름 보이는지 (둘 다 같은 방)
        await pageB.waitForTimeout(2000);
        const guestPageText = await pageB.evaluate(() => document.body.innerText);
        record('P0-2f: 게스트 화면에 호스트A 이름 표시', guestPageText.includes('호스트A'),
               `host name visible: ${guestPageText.includes('호스트A')}`);

        // 호스트 화면에서 게스트B 보이는지 (멤버 동기화)
        await pageA.waitForTimeout(1500);
        const hostPageText = await pageA.evaluate(() => document.body.innerText);
        record('P0-2g: 호스트 화면에 게스트B 동기화', hostPageText.includes('게스트B'),
               `guest name visible: ${hostPageText.includes('게스트B')}`);

        // ─── P0-6: 방 삭제 후 expired ───
        // 호스트 + 게스트 양쪽 닫기 → 방 자연 삭제 또는 grace 만료
        await ctxA.close();
        await ctxB.close();

        // 방 cleanup 대기 — env ROOM_GRACE_PERIOD=2s + DISCONNECT_WAIT=1s 가정
        // 짧은 grace로 서버 재기동된 경우만 통과. 운영 grace(120s)는 e2e로 매번 못 검증.
        console.log('⏳ 방 cleanup 대기 (8초, 짧은 grace 환경)...');
        await new Promise(r => setTimeout(r, 8000));

        // 새 컨텍스트로 같은 shortcode 진입
        const ctxC = await browser.newContext();
        const pageC = await ctxC.newPage();
        await pageC.goto(`${BASE}/free/${GAME}/${shortcode}`);
        await pageC.waitForURL(/\/free\/horse\?expired=true/, { timeout: 10000 }).catch(() => {});
        const finalUrl = pageC.url();
        record('P0-6: 방 사라진 후 → /free/horse?expired=true', /expired=true/.test(finalUrl), finalUrl);

        // expired 모달 표시 확인
        await pageC.waitForTimeout(1500);
        const expiredModalVisible = await pageC.evaluate(() => {
            const m = document.getElementById('expiredModal');
            return m && getComputedStyle(m).display !== 'none';
        });
        record('P0-6b: expired 모달 표시', expiredModalVisible);

        await ctxC.close();
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
        console.log('\n✅ 모든 P0 멀티탭 시나리오 통과');
        process.exit(0);
    }
})();
