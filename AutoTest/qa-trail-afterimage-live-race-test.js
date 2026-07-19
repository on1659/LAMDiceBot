// QA (일회성 라이브 검증): 잔상(trail) 실루엣 재작업 — 실제 2인 레이스에서 스포너 동작 관찰.
//
// 검증 계약 (docs/goal/horse-trail-to-afterimage.md):
//   L1: 레이스 중 .cosmetic-afterimage 스폰 — 내부 svg + inline color/width/height
//   L2: 실루엣은 말 뒤(과거 위치) — ghost.left <= 현재 sprite.left (+4px 관용)
//   L3: 동시 존재 수 유계(누적 없음) — maxConcurrent <= 16 (fade 0.65s ÷ 130ms ≈ 5 + emoji + 여유)
//   L4: 진짜 정지(말 화면 정지 + 월드 스크롤 정지) 시 신규 스폰 0 (이동량 게이트)
//   L5: 레이스 종료 후 실루엣 전부 자기 제거(잔존 0)
//   L6: 라운드 재시작 후 스포너 재동작 (레지스트리/rAF 누수 없음)
//   L7: 제품 코드 콘솔 에러 0 (AdSense/리소스 노이즈 제외)
//
// 전제: 로컬 서버(5173). 실행: node AutoTest/qa-trail-afterimage-live-race-test.js
const { chromium } = require('playwright');
const URL = 'http://localhost:5173';
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    let pass = true;
    const check = (cond, label, detail) => {
        console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? '  [' + detail + ']' : ''));
        if (!cond) pass = false;
    };

    // 신규 QA 계정(호스트) — 소유 상태 오염 방지
    const hostName = 'qtrail' + Date.now().toString(36).slice(-7);
    const guestName = 'qguest' + Date.now().toString(36).slice(-7);
    const reg = await fetch(URL + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: hostName, pin: '1234' })
    }).then(r => r.json());
    if (!reg.token) { console.log('SETUP FAIL: register', JSON.stringify(reg)); process.exit(2); }
    console.log('QA host:', hostName, '/ guest:', guestName);

    const browser = await chromium.launch();
    const errs = [];
    const consoleTail = [];
    globalThis.__tail = consoleTail;
    const collect = (tag, page) => {
        page.on('console', m => {
            if (m.type() === 'error') errs.push('[' + tag + '] ' + m.text());
            consoleTail.push('[' + tag + '/' + m.type() + '] ' + m.text());
            if (consoleTail.length > 60) consoleTail.shift();
        });
        page.on('pageerror', e => errs.push('[' + tag + '] ' + String(e)));
        page.on('framenavigated', f => {
            if (f === page.mainFrame()) console.log('  [' + tag + ' NAV] ' + f.url());
        });
    };

    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const hostPage = await hostCtx.newPage();
    const guestPage = await guestCtx.newPage();
    collect('H', hostPage); collect('G', guestPage);

    // reducedMotion 가드는 스크립트 로드 시 1회 평가 — goto "이전"에 강제 해제
    await hostPage.emulateMedia({ reducedMotion: 'no-preference' });
    await guestPage.emulateMedia({ reducedMotion: 'no-preference' });

    // ── 1. 호스트 방 생성 (+ 광고지갑으로 trail_ad_fire 장착 상태 시드) ──
    await hostPage.addInitScript(args => {
        localStorage.setItem('tutorialSeen_horse-race', 'v1');
        localStorage.setItem('userAuth', JSON.stringify({ token: args.token, name: args.name }));
        localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
            userName: args.name, roomName: 'qa-trail-live', isPrivate: false,
            password: '', expiryHours: 1, blockIPPerUser: false
        }));
        sessionStorage.setItem('adWallet', JSON.stringify({
            coins: 0, owned: ['trail_ad_fire'], equipped: { trail: 'trail_ad_fire' }, lastWatch: 0
        }));
    }, { token: reg.token, name: hostName });
    await hostPage.goto(URL + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded' });
    // 방 생성 후 canonical 공유 URL(/free/horse/CODE)로 실제 네비게이션 발생 → 안착까지 대기
    await hostPage.waitForFunction(() => {
        return location.pathname.indexOf('/free/') === 0
            && typeof currentRoomId !== 'undefined' && !!currentRoomId
            && typeof socket !== 'undefined' && socket.connected;
    }, null, { timeout: 20000 });
    await wait(1800); // authenticate + reapplyAdEquips + catalog
    const roomId = await hostPage.evaluate(() => (typeof currentRoomId !== 'undefined') ? currentRoomId : null);
    check(!!roomId, 'L0a: 호스트 방 생성', 'roomId=' + roomId);
    if (!roomId) { await browser.close(); process.exit(1); }

    // 장착 사전 단언 — adWallet trail 이 로드됐는가
    const adTrail = await hostPage.evaluate(() => {
        const ad = (window.ShopModule && ShopModule.getAdWallet && ShopModule.getAdWallet().equipped) || {};
        return ad.trail || null;
    });
    check(adTrail === 'trail_ad_fire', 'L0b: 광고지갑 trail(trail_ad_fire) 장착 로드', 'ad.trail=' + adTrail);

    // ── 2. 게스트 입장 ──
    await guestPage.addInitScript(args => {
        localStorage.setItem('tutorialSeen_horse-race', 'v1');
        localStorage.setItem('userName', args.name);
        localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({
            roomId: args.roomId, userName: args.name, isPrivate: false
        }));
    }, { name: guestName, roomId: roomId });
    await guestPage.goto(URL + '/horse-race?joinRoom=true', { waitUntil: 'domcontentloaded' });
    const guestIn = await guestPage.waitForFunction(() => {
        return location.pathname.indexOf('/free/') === 0
            && typeof currentRoomId !== 'undefined' && !!currentRoomId
            && typeof socket !== 'undefined' && socket.connected;
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    check(guestIn, 'L0c: 게스트 입장(canonical URL 안착)');
    await wait(1500);

    // ── 3. 짧은 트랙 + 말 선택(자동 ready) ──
    await hostPage.evaluate(() => socket.emit('setTrackLength', { trackLength: 'short' }));
    const selOnce = (page, idx) => page.evaluate(i => new Promise(res => {
        const t = setTimeout(() => res(false), 8000);
        socket.once('horseSelectionUpdated', () => { clearTimeout(t); res(true); });
        socket.emit('selectHorse', { horseIndex: i });
    }), idx);
    const s1 = await selOnce(hostPage, 0);
    const s2 = await selOnce(guestPage, 1);
    check(s1 && s2, 'L0d: 양측 말 선택(0/1) + horseSelectionUpdated', 'host=' + s1 + ' guest=' + s2);

    // ── 4. 관찰 계측 설치 (레이스 시작 전) ──
    await hostPage.evaluate(() => {
        window.__qa = { total: 0, maxConcurrent: 0, firstGhost: null, raceEnded: false, spawnTimes: [] };
        socket.once('horseRaceEnded', () => { window.__qa.raceEnded = true; });
        const obs = new MutationObserver(muts => {
            for (const m of muts) for (const n of m.addedNodes) {
                if (n.nodeType === 1 && n.classList && n.classList.contains('cosmetic-afterimage')) {
                    window.__qa.total++;
                    if (window.__qa.spawnTimes.length < 2000) window.__qa.spawnTimes.push(performance.now());
                    if (!window.__qa.firstGhost) {
                        window.__qa.firstGhost = {
                            hasSvg: !!n.querySelector('svg'),
                            color: n.style.color || '',
                            w: n.style.width || '', h: n.style.height || '',
                            left: n.style.left || ''
                        };
                    }
                }
            }
            const cur = document.querySelectorAll('.cosmetic-afterimage').length;
            if (cur > window.__qa.maxConcurrent) window.__qa.maxConcurrent = cur;
        });
        obs.observe(document.body, { childList: true, subtree: true });
        window.__qaObs = obs;
    });

    // ── 5. 레이스 시작 (카운트다운 4s → horseRaceStarted) ──
    const started = await hostPage.evaluate(() => new Promise(res => {
        const t = setTimeout(() => res(false), 30000);
        socket.once('horseRaceStarted', () => { clearTimeout(t); res(true); });
        window._raceErrs = [];
        socket.on('horseRaceError', d => window._raceErrs.push(d));
        socket.emit('startHorseRace');
    }));
    if (!started) {
        const e = await hostPage.evaluate(() => window._raceErrs || []);
        check(false, 'L0e: horseRaceStarted 수신', JSON.stringify(e));
        await browser.close(); process.exit(1);
    }
    check(true, 'L0e: horseRaceStarted 수신 (short 트랙)');
    await hostPage.bringToFront();

    // ── 6. 레이스 중 샘플링 (500ms 간격, 최대 60s) ──
    //     myHorse 화면 x + .finish-line inline left(월드 스크롤 기준) + ghost 상태를 기록
    const samples = [];
    let stopSpawnCheck = null; // { totalAtStable, refAtStable } — 진짜 정지 감지 시점
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
        const s = await hostPage.evaluate(() => {
            const my = document.querySelector('.horse.my-horse');
            const sprite = my && my.querySelector('.vehicle-sprite');
            const fin = document.querySelector('.finish-line');
            const ghosts = document.querySelectorAll('.cosmetic-afterimage');
            let behind = null;
            if (sprite && ghosts.length) {
                const sr = sprite.getBoundingClientRect();
                const gr = ghosts[ghosts.length - 1].getBoundingClientRect();
                behind = gr.left <= sr.left + 4;
            }
            return {
                t: performance.now(),
                myLeft: sprite ? sprite.getBoundingClientRect().left : null,
                myRacing: my ? my.classList.contains('racing') : null,
                finLeft: fin ? parseFloat(fin.style.left || 'NaN') : null,
                concurrent: ghosts.length,
                total: window.__qa.total,
                maxConcurrent: window.__qa.maxConcurrent,
                behind: behind,
                raceEnded: window.__qa.raceEnded
            };
        });
        samples.push(s);
        // 진짜 정지 감지: 최근 5샘플(2s)에서 myLeft, finLeft 모두 변화 < 1px
        if (!stopSpawnCheck && samples.length >= 5) {
            const w = samples.slice(-5);
            const stable = w.every(x => x.myLeft != null && Math.abs(x.myLeft - w[0].myLeft) < 1)
                && w.every(x => (x.finLeft == null || isNaN(x.finLeft)) ? true : Math.abs(x.finLeft - w[0].finLeft) < 1);
            if (stable && s.total > 0) stopSpawnCheck = { totalAtStable: s.total, at: samples.length };
        }
        if (s.raceEnded) break;
        await wait(500);
    }
    const last = samples[samples.length - 1];
    const duringRace = samples.filter(s => !s.raceEnded);

    // L1: 스폰 + 구조
    const fg = await hostPage.evaluate(() => window.__qa.firstGhost);
    check(last.total >= 5, 'L1a: 레이스 중 실루엣 스폰 (총 ' + last.total + '개)', 'total=' + last.total);
    check(!!fg && fg.hasSvg, 'L1b: 실루엣 내부 svg 존재(스프라이트 사본)', JSON.stringify(fg));
    check(!!fg && !!fg.color && !!fg.w && !!fg.h, 'L1c: inline color/width/height 주입', fg ? 'color=' + fg.color + ' w=' + fg.w + ' h=' + fg.h : 'null');

    // L2: 말 뒤(과거 위치)
    const behindSamples = duringRace.filter(s => s.behind !== null);
    const behindOk = behindSamples.length > 0 && behindSamples.every(s => s.behind);
    check(behindOk, 'L2: 실루엣이 말 뒤(과거 위치) — 전 샘플 ghost.left <= sprite.left+4', behindSamples.length + '샘플 중 위반 ' + behindSamples.filter(s => !s.behind).length);

    // L3: 동시 존재 유계 (누적 없음)
    check(last.maxConcurrent > 0 && last.maxConcurrent <= 16, 'L3: 동시 실루엣 수 유계(0 < max <= 16)', 'maxConcurrent=' + last.maxConcurrent);

    // L4: 진짜 정지 시 신규 스폰 0 — 정지 감지 후 2s 뒤 total 동결 확인
    if (stopSpawnCheck) {
        await wait(2000);
        const after = await hostPage.evaluate(() => window.__qa.total);
        check(after === stopSpawnCheck.totalAtStable,
            'L4: 진짜 정지(말+월드 스크롤 정지) 후 신규 스폰 0',
            'stable시 total=' + stopSpawnCheck.totalAtStable + ' → 2s 후 ' + after);
    } else {
        console.log('SKIP — L4: 레이스 중 "진짜 정지" 창을 관찰하지 못함 (레이스가 끝까지 유동적) — 합성 B8d가 게이트 커버');
    }

    // L5: 종료 후 실루엣 전부 자기 제거
    await wait(1600); // fade 0.65s + LIFE 1s 여유
    const leftover = await hostPage.evaluate(() => document.querySelectorAll('.cosmetic-afterimage').length);
    check(leftover === 0, 'L5: 레이스 종료 후 실루엣 잔존 0 (자기 제거)', 'leftover=' + leftover);

    // ── 7. L6: 라운드 재시작 → 스포너 재동작 ──
    await wait(2500); // 결과 연출/리셋 대기
    const beforeR2 = await hostPage.evaluate(() => window.__qa.total);
    // 레이스 시작 시 readyUsers 리셋 → selectHorse 전 재-준비 필요 (toggleReady)
    const readyOnce = (page) => page.evaluate(() => new Promise(res => {
        const t = setTimeout(() => res(false), 6000);
        socket.once('readyUsersUpdated', () => { clearTimeout(t); res(true); });
        socket.emit('toggleReady');
    }));
    await readyOnce(hostPage);
    await readyOnce(guestPage);
    const r2s1 = await selOnce(hostPage, 0);
    const r2s2 = await selOnce(guestPage, 1);
    let round2 = false;
    if (r2s1 && r2s2) {
        round2 = await hostPage.evaluate(() => new Promise(res => {
            const t = setTimeout(() => res(false), 30000);
            socket.once('horseRaceStarted', () => { clearTimeout(t); res(true); });
            socket.emit('startHorseRace');
        }));
    }
    if (round2) {
        await hostPage.bringToFront();
        // 시작 후 8s 내 신규 스폰 발생?
        let grew = false;
        const t2 = Date.now();
        while (Date.now() - t2 < 12000) {
            const tot = await hostPage.evaluate(() => window.__qa.total);
            if (tot > beforeR2) { grew = true; break; }
            await wait(500);
        }
        check(grew, 'L6: 라운드 2 재시작 후 실루엣 스폰 재개 (레지스트리/rAF 누수 없음)', 'before=' + beforeR2);
    } else {
        check(false, 'L6: 라운드 2 시작 실패 (selectHorse=' + r2s1 + '/' + r2s2 + ', started=' + round2 + ')');
    }

    // L7: 콘솔 에러
    const realErrs = errs.filter(e => !/favicon|sound-config|\.mp3|ERR_|net::|Failed to load resource|AdSense|adsbygoogle|TagError|googlesyndication|pagead|report-only Content Security Policy/i.test(e));
    check(realErrs.length === 0, 'L7: 제품 코드 콘솔 에러 0', realErrs.slice(0, 3).join(' | ') || 'clean');

    // 스폰 간격 위생(참고 로그): 중앙 간격이 130ms 근처인지
    const gaps = await hostPage.evaluate(() => {
        const ts = window.__qa.spawnTimes;
        const g = []; for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
        g.sort((a, b) => a - b);
        return g.length ? { n: g.length, median: g[Math.floor(g.length / 2)] } : null;
    });
    if (gaps) console.log('INFO — 스폰 간격 중앙값: ' + Math.round(gaps.median) + 'ms (설계 130ms, 이모지 유령 동시스폰 포함이라 0ms 혼재 가능), n=' + gaps.n);

    await browser.close();
    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
    process.exit(pass ? 0 : 1);
})().catch(e => {
    console.error('TEST ERROR:', e);
    console.error('--- console tail ---');
    try { (globalThis.__tail || []).forEach(l => console.error(l)); } catch (_) {}
    process.exit(2);
});
