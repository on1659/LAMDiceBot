// 재밍라이더(jamming) 세계 — 서버 시뮬(socket/jamming-sim.js)과 클라 렌더러(js/jamming-render.js)가 같이 읽는 한 벌.
// 수치·코스 놓기·바람 기둥 박자(시각 t 만의 함수)·재생 시각 변환이 여기 하나뿐이다 — 양쪽에 복사해 두면 어긋난다.
// 원본은 mockups/sunset-glide-v7.html(2026-11-19, 7판). 자체 난수는 없다(코스는 넘겨받은 시드 rng 로만).
// 서버: require('../js/jamming-world') / 브라우저: window.JammingWorld
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.JammingWorld = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ── 세계: 옆에서 본 바다. x = 왼쪽(출발 절벽) → 오른쪽(착지 섬), a = 바다 위 높이(0 = 바다)
    const DT = 1 / 60;   // 내부 스텝 — 수치가 이 간격에 맞춰 다듬어져 있다(바꾸면 길이·봉우리 높이가 달라진다, 기획서 §4-3)
    // 절벽 높이 · 줄 맨 앞 자리 · 간격 · 섬 왼끝 · 착지 구역 오른끝(여기 안에 내려야 순위) · 섬 오른끝(긴 모래사장) · 착지 과녁 · 섬 땅 높이
    const CLIFF = 430, LINE0 = -40, LINE_GAP = 28, ISL0 = 12200, ZONE_R = ISL0 + 520, ISL1 = ISL0 + 1750, TGT = ISL0 + 280, GA = 50;
    const R = {
        launchRun: 120, launchVar: 0.15, hop: 150, openDur: 0.55,                             // 날개를 든 채 뛰는 빠르기 · 박찰 때 위로 · 엎드려 자리 잡는 시간
        fly: 285, wobble: 0.1, wobbleEvery: [0.8, 1.6],                                       // 나는 빠르기(가로)
        swoopEvery: [1.6, 3.4], swoopWant: 0.55, swoopMin: 300, swoopDur: [0.5, 0.9], swoopMul: 1.3, swoopDive: 250,   // 급강하: 높이 있을 때 가끔 내리꽂으며 빨라진다
        sink: 62, altK: 2.2, climb: 210, dive: 280, vaEase: 4.5, altTop: 670,                 // 행글라이더: 늘 이만큼 가라앉는다(혼자선 못 오른다) · 내려가기는 마음대로 · 자석만 끌어올린다
        // 바람 기둥(원신 바람장처럼 바다 구멍에서 위로 쌩): 간격 · 반폭 · 바람이 닿는 꼭대기 · 밀어 올리는 빠르기 · 바람 속 가로 배율 · 붙는 빠르기 · 벗어난 뒤 솟던 힘이 빠지는 빠르기
        thermGap: [650, 1000], thermHW: [55, 75], thermTop: [300, 480], thermLift: [430, 540], thermV: 0.7, thermEase: 12, coastEase: 1.4,
        gust: 0.3, gustBig: 0.75, windBig: 0.35, bigHW: [70, 90], bigTop: [540, 620], bigLift: [900, 1050], softTop: 610,   // 센 바람(셋 중 하나쯤) · 받은 순간부터 끝까지 미는 시간 · 이 높이 위에선 솟던 힘이 빨리 빠진다
        windOn: [1.2, 2.0], windOff: [0.3, 1.0],                                              // 바람은 이만큼 불고 → 이만큼 멎는다(기둥마다 박자가 다르다)
        // 중간 섬: 간격 · 폭 · 땅 높이 · 섬 뒤 바람 확률 · 쉬는 시간 · 내릴 확률 · 다음 바람에 닿을 때 남아야 하는 높이
        isleGap: [1350, 2000], isleW: [260, 420], isleH: [40, 90], isleTherm: 0.75, isleRest: 0.8, isleWant: 0.9, isleMargin: 70,
        look: 340, rockLook: 460, notice: { rock: 0.86, storm: 0.6, eagle: 0.65 }, itemWant: 0.7,   // 앞을 보는 거리 · 알아채고 피할 확률 · 아이템을 노릴 확률
        packSpan: 900, packBoost: 0.06, packDrag: 0.025, chaseGap: 450, chaseSpan: 800, chaseBoost: 0.16,   // 무리 가운데보다 뒤면 조금 빠르게 · 바로 앞과 벌어지면 따라붙기
        itemGap: [480, 700], itemRow: [2, 4], itemR: 34, itemRespawn: 0.6, wingY: 80, zap1Gap: 6,   // 상자 줄 간격 · 한 줄 상자 수 · 먹는 거리 · 다시 생기는 시간 · 날개 높이(발에서) · 1등 번개 쉼
        // 아이템표 [앞, 가운데, 뒤] 무게 — 1등과 벌어진 거리(itemSpread 를 넘으면 맨 뒤 표)로 섞는다
        itemSpread: 900, itemTable: { balloon: [4, 3, 1], mine: [4, 2, 0.5], shield: [3, 2, 1], boost: [3, 3, 2], missile: [1, 3, 3], ink: [0.5, 2, 2],
            magnet: [0, 2, 3], zap1: [0, 1, 2.5], zapAll: [0, 0.1, 0.8], angel: [0, 0.5, 2], rocket: [0, 0.2, 2] },
        useDelay: [0.3, 1.1], holdMax: 3.5,                                                    // 먹고 나서 쓰기까지 · 노릴 상대가 없어도 이만큼 들면 그냥 쓴다
        boostDur: 2.2, boostMul: 1.75, shieldDur: 9,
        missileSpeed: 720, missileRange: 900, missileLife: 2.6, balloonSpeed: 620, balloonRange: 650, balloonAlt: 70, bubbleDur: 1.3,
        mineLife: 9, mineR: 26, mineBehind: 320, zapWarn: 1, zapAllDur: 2.2, zapAllMul: 0.72, zapAllSink: 70, inkDur: 3, inkRange: 900,
        magnetDur: 2.6, magnetMax: 0.6, rocketDur: 3, rocketMul: 2.1, rocketAlt: 370, angelDur: 3.2, angelMul: 1.2, bumpR: 30,
        tumbleDur: 0.9, grav: 420, seaDur: 1.1, moundDur: 0.7, moundH: 46, blastDur: 1.0, blastTo: [170, 240],
        rockN: 2, rockH: [110, 180], stormN: 4, stormHW: 150, stormHH: 62, stormPull: 320, stormSlow: 0.85, boltRate: 0.7,
        eagleEvery: [5, 8], eagleAhead: 560, eagleSpeed: 230, eagleSee: 320, eagleR: 26,
        approach: 1100, aimJit: 150, landDur: 0.6, walk: 90, runBack: 170, tossDur: 1.1,
        itemCap: 3, rollDur: 0.7,                                                              // 아이템은 한 번에 3명까지 · 먹으면 머리 위 룰렛이 도는 시간
        maxTime: 150,                                                                          // 하드 캡(초) — 넘으면 과녁까지 거리 순위로 정산
        // 판정 순간 연출(재생 속도만 — 결과와 무관): 목업 hitStop 0.6s 동안 0.2배속 → resultDelay 1.8s 에 결과
        hitStop: 0.6, hitSlow: 0.2, resultDelay: 1.8
    };
    const ITEMS = ['balloon', 'mine', 'shield', 'boost', 'missile', 'ink', 'magnet', 'zap1', 'zapAll', 'angel', 'rocket'];   // 프레임 아이템 코드 = 인덱스 + 1
    const STATES = ['line', 'run', 'jump', 'fly', 'bubble', 'tumble', 'sea', 'toss', 'mound', 'blast', 'isle', 'runback', 'done'];   // 프레임 상태 코드 = 인덱스
    const FX = { boost: 1, shield: 2, small: 4, inked: 8, magnet: 16, rocket: 32, angel: 64, th: 128, big: 256, swoop: 512, over: 1024, roll: 2048 };   // 프레임 효과 비트(아이템 코드는 << 12)
    const OBJ = { missile: 1, balloon: 2, mine: 3, eagle: 4 };   // 프레임 뒤에 붙는 움직이는 물체 종류

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, k) => a + (b - a) * k;

    // ── 코스 놓기(시드 결정): 중간 섬 → 섬 뒤 바람 → 첫 바람 → 바다 위 바람 → 마지막 바람 → 바위 → 먹구름 → 상자 줄 → 섬 앞 부스터 방울.
    //    rnd 호출 순서가 목업 buildCourse 와 같다(같은 시드면 목업과 같은 코스 — 길이 대조용)
    function buildCourse(rnd) {
        const range = (a, b) => a + (b - a) * rnd();
        const rocks = [], storms = [], items = [], isles = [], therms = [];
        const far = (x, list, d) => list.every(o => Math.abs(o.x - x) > d);
        const mkTherm = x => { const on = range(R.windOn[0], R.windOn[1]), off = range(R.windOff[0], R.windOff[1]), big = rnd() < R.windBig, pick = (a, b) => range(big ? b[0] : a[0], big ? b[1] : a[1]); therms.push({ x, big, hw: pick(R.thermHW, R.bigHW), top: pick(R.thermTop, R.bigTop), lift: pick(R.thermLift, R.bigLift), on, off, ph: range(0, on + off) }); };
        for (let x = range(1500, 2000); x < ISL0 - 1500; x += range(R.isleGap[0], R.isleGap[1])) {
            const w = range(R.isleW[0], R.isleW[1]); isles.push({ x, x1: x + w, h: range(R.isleH[0], R.isleH[1]) });
            if (rnd() < R.isleTherm) mkTherm(x + w + range(90, 260));
        }
        mkTherm(range(700, 950));   // 절벽에서 뛰어내려 처음 만나는 바람(늘 있다)
        for (let x = 900; x < ISL0 - 1400; x += 150) {
            const prev = therms.reduce((m, o) => o.x < x + 1 && o.x > m ? o.x : m, -1e9);
            if (x - prev > range(R.thermGap[0], R.thermGap[1]) && far(x, isles.map(i => ({ x: (i.x + i.x1) / 2 })), 260)) mkTherm(x);
        }
        mkTherm(ISL0 - range(1050, 1300)); { const lt = therms[therms.length - 1], tp = range(380, 440); if (!lt.big) lt.top = tp; }   // 도착 섬 앞 마지막 바람(늘 있다)
        therms.sort((a, b) => a.x - b.x);
        for (let k = 0, n = 0; k < R.rockN && n < 300; n++) {
            const x = range(1300, ISL0 - 1500); if (!far(x, rocks, 900) || isles.some(i => x > i.x - 250 && x < i.x1 + 250) || !far(x, therms, 220)) continue;
            const lh = k === 0, h = lh ? range(150, 180) : range(R.rockH[0], R.rockH[1]);
            rocks.push({ x, h, hw: range(34, 50), top: h + (lh ? 74 : 0), lh }); k++;
        }
        for (let k = 0, n = 0; k < R.stormN && n < 300; n++) {
            const x = range(1800, ISL0 - 1300); if (!far(x, storms, 1300) || !far(x, rocks, 320)) continue;
            storms.push({ x, a: range(470, 560), hw: R.stormHW, hh: R.stormHH }); k++;
        }
        for (let x = 800; x < ISL0 - 900; x += range(R.itemGap[0], R.itemGap[1])) {
            if (!far(x, rocks, 150) || !far(x, storms, 260)) continue;
            const k = Math.floor(range(R.itemRow[0], R.itemRow[1] + 0.99)), row = [];
            for (let i = 0; i < k; i++) { const a = range(110, 560); if (row.some(r => Math.abs(r - a) < 90)) continue; row.push(a); items.push({ x: x + range(-20, 20), a, kind: 'box' }); }
        }
        const lx = ISL0 - range(420, 560);   // 섬 바로 앞: 부스터 방울(고정) — 먹으면 못 내려가 섬을 지나친다
        [range(150, 260), range(320, 430)].forEach((a, i) => items.push({ x: lx + i * 30, a, kind: i ? 'box' : 'boost' }));
        items.sort((a, b) => a.x - b.x);
        return { rocks, storms, items, isles, therms };
    }

    // 바람 기둥 박자(시뮬 시각 초 t 만의 함수 — 서버·클라가 같은 식)
    const windOn = (c, t) => (t + c.ph) % (c.on + c.off) < c.on;
    const windK = (c, t) => { const u = (t + c.ph) % (c.on + c.off); return u < c.on ? Math.min(1, u / 0.12, (c.on - u) / 0.2) : 0; };   // 그림용 세기(켜지고 꺼질 때 부드럽게)

    // 재생 시각 ↔ 시뮬 시각 — slow = [{ startMs, endMs, rate, holdMs? }] (둥둥라이더 BalloonWorld 와 같은 계약)
    function simTimeAt(realMs, slow) {
        let r = 0, s = 0;
        for (const g of slow || []) {
            const pre = g.startMs - s;
            if (realMs < r + pre) return s + (realMs - r);
            r += pre; s = g.startMs;
            const hold = g.holdMs || 0;
            if (realMs < r + hold) return s;
            r += hold;
            const span = (g.endMs - g.startMs) / g.rate;
            if (realMs < r + span) return s + (realMs - r) * g.rate;
            r += span; s = g.endMs;
        }
        return s + (realMs - r);
    }
    function realDuration(simMs, slow) {
        let r = 0, s = 0;
        for (const g of slow || []) {
            if (g.startMs >= simMs) break;
            r += g.startMs - s + (g.holdMs || 0) + (Math.min(simMs, g.endMs) - g.startMs) / g.rate;
            s = Math.min(simMs, g.endMs);
        }
        return r + (simMs - s);
    }

    return { DT, CLIFF, LINE0, LINE_GAP, ISL0, ZONE_R, ISL1, TGT, GA, R, ITEMS, STATES, FX, OBJ, clamp, lerp, buildCourse, windOn, windK, simTimeAt, realDuration };
});
