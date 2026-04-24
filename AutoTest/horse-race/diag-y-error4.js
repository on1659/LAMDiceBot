/**
 * 진단 4 - horse-race.js socket 접근 방법 찾기
 */
const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', '..', 'config', 'index.js'));

const URL = `http://127.0.0.1:${PORT}`;
const PAGE = `${URL}/horse-race-multiplayer.html`;

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext();
    const h = await ctx.newPage();

    await h.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await h.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, 'Host');
    await h.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 10000 });

    // io Manager를 통해 horse-race.js socket 찾기
    const socketSearch = await h.evaluate(() => {
        // socket.io v4 Manager: io.managers[key] 에서 socket namespace 접근
        // OR: io('/')가 cached socket 반환하는지 확인

        // Approach 1: io.managers의 실제 구조
        const mgrProto = Object.getPrototypeOf(io);
        const mgrConstructorName = mgrProto?.constructor?.name;

        // io 자체의 속성들
        const ioOwnKeys = Object.getOwnPropertyNames(io);
        const ioKeys = Object.keys(io);

        // io.managers가 비어있다면, io 호출이 새 socket을 만드는 방식
        // socket.io v4에서 io.managers는 connection URL → Manager 매핑
        // io({}) 호출 시 location.href 기준으로 key 생성
        const locationHref = location.href;

        return {
            mgrConstructorName,
            ioOwnKeys: ioOwnKeys.slice(0, 10),
            ioKeys: ioKeys.slice(0, 10),
            locationHref,
            // io.managers가 있는지 (v3/v4 차이)
            hasMgrs: 'managers' in io,
            ioBound: typeof io._managers !== 'undefined' ? true : false,
        };
    });
    console.log('io manager search:', JSON.stringify(socketSearch, null, 2));

    // io() 호출로 이미 존재하는 socket 가져오기 시도
    const socketReuse = await h.evaluate(() => {
        // io()를 option 없이 호출하면 같은 URL에 대해 기존 connection을 재사용
        // 여기서 isSame: false 였지만, io.Manager나 다른 경로로 접근 가능한지
        try {
            // socket.io v4 내부 구현에서 Manager 접근
            const mgr = socket.io; // socket.io는 Manager 인스턴스
            const mgrKeys = Object.keys(mgr);
            const mgrNsps = Object.keys(mgr.nsps || {});

            return {
                mgrConstructor: mgr?.constructor?.name,
                mgrKeys: mgrKeys.slice(0, 20),
                mgrNsps,
                // nsps에서 horse race events 있는 socket 찾기
                nspSocketInfo: mgrNsps.map(nsp => {
                    const s = mgr.nsps[nsp];
                    return {
                        nsp,
                        id: s?.id,
                        cbCount: Object.keys(s?._callbacks || {}).length,
                        hasHorse: Object.keys(s?._callbacks || {}).some(k => k.toLowerCase().includes('horse'))
                    };
                })
            };
        } catch(e) {
            return { error: e.message };
        }
    });
    console.log('socket.io Manager nsps:', JSON.stringify(socketReuse, null, 2));

    await browser.close();
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
