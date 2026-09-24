// QA — 데구리 구슬 뽑기 (docs/goal/marble-gacha.md)
//   1) 순수 추첨(drawGacha) 2만 번 → 등급 비율 60/30/10 ±2%p, 풀 구성(스킨 rarity·야식 rare·기본 제공 제외)
//   2) 소켓: 방 생성 → marble:gacha:pull 을 코인이 모자랄 때까지 → 매번 잔고 = 이전 − 60 (+30 중복), 새 항목은 owned 에, 등급 = 카탈로그 등급,
//      모자라면 insufficient(잔고 그대로), 뽑은 항목 장착(marble:equip) 성공, 방 밖 pull 거절
//   3) 전설 채팅 알림 — 소켓에서 전설을 강제로 뽑을 수 없어 서버 소스에서 호출 여부만 확인
//   5) 머문 시간 보상(accrueStay) — 5분마다 +10
//   4) 그림 에셋 + anchors json 존재 (lip 레이어는 잘못 오려져 2026-09-23 삭제, 섞기 3칸은 2026-09-24 코드로 굴리는 공으로 대체)
//   실행: node AutoTest/qa-marble-gacha-test.js [port]   (서버가 떠 있어야 함)
require('../config');
const marble = require('../socket/marble');
const io = require('socket.io-client');
const fs = require('fs'), path = require('path');
const catalog = require('../config/marble/cosmetics.json');

const PORT = process.argv[2] || 5174;
const URL = 'http://localhost:' + PORT;
const wait = ms => new Promise(r => setTimeout(r, ms));
function emitAck(sock, ev, data) { return new Promise(res => sock.emit(ev, data, res)); }
function once(sock, ev, timeout) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout ' + ev)), timeout || 8000);
        sock.once(ev, d => { clearTimeout(t); res(d); });
    });
}
const tierOf = id => {
    const s = catalog.marble_skin.find(i => i.id === id); if (s) return s.rarity;
    const b = catalog.marble_balloon.find(i => i.id === id); if (b) return 'rare';
    return null;
};

(async () => {
    let pass = true;
    const check = (c, label, extra) => { console.log((c ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : '')); if (!c) pass = false; };
    let sock = null;
    try {
        // ── 1) 순수 추첨 ──
        const pool = marble.gachaPool();
        const buyableSkins = catalog.marble_skin.filter(i => i.creature && Number.isInteger(i.price) && !i.defaultOwned);
        const buyableBalloons = catalog.marble_balloon.filter(i => i.sprite && Number.isInteger(i.price) && !i.defaultOwned);
        check(pool.rare.length + pool.epic.length + pool.legend.length === buyableSkins.length + buyableBalloons.length,
            '풀 = 살 수 있는 스킨 ' + buyableSkins.length + ' + 야식 ' + buyableBalloons.length, JSON.stringify({ rare: pool.rare.length, epic: pool.epic.length, legend: pool.legend.length }));
        check(['rare', 'epic', 'legend'].every(t => pool[t].every(p => tierOf(p.id) === t)), '풀 등급 = 카탈로그 등급(야식은 레어)');
        check(!Object.values(pool).flat().some(p => /_none$/.test(p.id)), '기본 모습/없음 항목은 풀에 없음');
        const N = 20000, cnt = { rare: 0, epic: 0, legend: 0 };
        let s = 12345; const rng = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };   // 결정론 — 테스트 재현용
        for (let i = 0; i < N; i++) cnt[marble.drawGacha(pool, rng).tier]++;
        const pct = t => cnt[t] / N * 100;
        check(Math.abs(pct('rare') - 60) <= 2 && Math.abs(pct('epic') - 30) <= 2 && Math.abs(pct('legend') - 10) <= 2,
            '등급 비율 60/30/10 ±2%p', ['rare', 'epic', 'legend'].map(t => t + ' ' + pct(t).toFixed(1)).join(' · '));
        check(marble.drawGacha({ rare: [], epic: [], legend: [] }, rng) === null, '빈 풀 → null');
        check(marble.drawGacha({ rare: [], epic: [{ id: 'e', tier: 'epic' }], legend: [] }, () => 0.99).tier === 'epic', '빈 등급은 가중치에서 빠짐');
        check(marble.GACHA_PRICE === 60 && marble.GACHA_REFUND === 30, '가격 60 · 중복 환급 30');
        // 머문 시간 보상 — 입장 시각부터 5분마다 +10, 남은 조각은 다음으로(사용자 2026-09-23)
        const M = marble.STAY_COIN_MS, J = 1000000;
        const sw = { balance: 200, owned: [] };
        marble.accrueStay(sw, { joinTime: new Date(J) }, J + M - 1);
        const s1 = sw.balance;
        marble.accrueStay(sw, { joinTime: new Date(J) }, J + M);
        const s2 = sw.balance;
        marble.accrueStay(sw, { joinTime: new Date(J) }, J + 3 * M + 1000);
        check(s1 === 200 && s2 === 200 + marble.STAY_COIN && sw.balance === 200 + 3 * marble.STAY_COIN && sw.stayFrom === J + 3 * M,
            '머문 시간 보상: 5분 전 0 → 5분 +10 → 15분 누적 +30, 기준은 입장 시각', [s1, s2, sw.balance].join(' → '));
        check(marble.STAY_COIN === 10 && M === 5 * 60 * 1000, '5분마다 10코인');
        const src = fs.readFileSync(path.join(__dirname, '..', 'socket', 'marble.js'), 'utf8');
        check(/tier === 'legend'[\s\S]{0,200}gachaNotice\(/.test(src), '전설이면 방 채팅 알림(gachaNotice) 호출');

        // ── 4) 에셋 ──
        const G = path.join(__dirname, '..', 'assets', 'marble', 'gacha');
        const files = ['machine/gacha-machine', 'machine/gacha-globe-empty', 'machine/gacha-globe-balls', 'machine/gacha-machine-rail-front', 'machine/gacha-machine-lamp', 'machine/gacha-crank', 'fx/gacha-sparkle',
            ...['rare', 'epic', 'legend'].flatMap(t => ['capsule/capsule-' + t, 'capsule/capsule-' + t + '-open', 'fx/gacha-rays-' + t])].map(f => f + '.webp');
        const miss = files.filter(f => !fs.existsSync(path.join(G, f)));
        check(miss.length === 0 && fs.existsSync(path.join(G, 'gacha-anchors.json')), '뽑기 그림 ' + files.length + '장 + anchors json', miss.join(','));

        // ── 2) 소켓 ──
        const uniq = Date.now().toString(36);
        const host = 'qa뽑기' + uniq;
        sock = io(URL, { transports: ['websocket'] });
        await once(sock, 'connect');
        sock.on('rateLimitError', m => { console.error('FAIL — rate limit: ' + m); pass = false; });
        const outside = await emitAck(sock, 'marble:gacha:pull', {});
        check(outside && outside.ok === false && outside.reason === 'room', '방 밖 pull 거절(room)');
        sock.emit('createRoom', { userName: host, roomName: 'qa뽑기방' + uniq, isPrivate: false, gameType: 'marble', expiryHours: 1, deviceId: 'qa-dev-' + uniq, tabId: 'qa-tab-' + uniq });
        await once(sock, 'roomCreated');
        let w = await emitAck(sock, 'marble:shop:get', {});
        let bal = w.balance, owned = w.owned.slice(), pulls = 0, firstNew = null, math = true, tiers = true, own = true;
        while (bal >= marble.GACHA_PRICE && pulls < 20) {
            const r = await emitAck(sock, 'marble:gacha:pull', {});
            if (!r || !r.ok) { check(false, 'pull 실패', JSON.stringify(r)); break; }
            pulls++;
            const expect = bal - marble.GACHA_PRICE + (r.dupe ? marble.GACHA_REFUND : 0);
            if (r.balance !== expect || r.refund !== (r.dupe ? marble.GACHA_REFUND : 0)) math = false;
            if (tierOf(r.cosmeticId) !== r.tier) tiers = false;
            if (r.dupe !== owned.includes(r.cosmeticId) || !r.owned.includes(r.cosmeticId)) own = false;
            if (!r.dupe && !firstNew) firstNew = r;
            bal = r.balance; owned = r.owned.slice();
        }
        check(pulls >= 3, '입장 코인으로 ' + pulls + '번 뽑음');
        check(math, '잔고 = 이전 − 60 (+30 중복)');
        check(tiers, '응답 tier = 카탈로그 등급');
        check(own, '새 항목은 owned 에 추가, 중복은 dupe=true');
        if (bal < marble.GACHA_PRICE) {   // 내부 테스트 서버는 입장 코인이 200만이라 20번 뽑아도 안 모자란다
            const poor = await emitAck(sock, 'marble:gacha:pull', {});
            check(poor && poor.ok === false && poor.reason === 'insufficient' && poor.balance === bal, '코인 부족 → insufficient, 잔고 그대로', JSON.stringify(poor));
        } else console.log('SKIP: 코인 부족 거절 — 잔고 ' + bal + '(내부 테스트)');
        if (firstNew) {
            const eq = await emitAck(sock, 'marble:equip', { slot: firstNew.slot, cosmeticId: firstNew.cosmeticId });
            const e = eq && eq.equipped && eq.equipped[firstNew.slot];
            check(eq && eq.ok && (Array.isArray(e) ? e.includes(firstNew.cosmeticId) : e === firstNew.cosmeticId), '뽑은 항목 장착(marble:equip)', JSON.stringify(eq));
        }
        const w2 = await emitAck(sock, 'marble:shop:get', {});
        check(w2 && w2.balance === bal && w2.owned.length === owned.length, '상점 지갑(marble:shop:get)에 뽑기 결과가 그대로 보인다');
    } catch (e) {
        console.error('FAIL — 예외:', e && e.message); pass = false;
    } finally {
        try { if (sock) { sock.emit('leaveRoom'); await wait(300); sock.close(); } } catch (e) {}
        console.log(pass ? '\n✅ ALL PASS' : '\n❌ FAIL');
        process.exit(pass ? 0 : 1);
    }
})();
