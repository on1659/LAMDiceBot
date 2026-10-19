// 풍선 타기(balloon) 세계 — 서버 시뮬(socket/balloon-sim.js)과 클라 렌더러(js/balloon-render.js)가 같이 읽는 한 벌.
// 수치·구간 10종·장애물 위치(시각 t 만의 함수)·통로 벽 모양이 여기 하나뿐이다 — 데구리처럼 양쪽에 복사해 두면 어긋난다.
// 원본은 mockups/balloon-climb.html(2026-10-18). 자체 난수는 없다(맵 지터는 넘겨받은 시드 rng 로만).
// 서버: require('../js/balloon-world') / 브라우저: window.BalloonWorld
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.BalloonWorld = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // 세계 좌표(화면 크기와 무관). y = 발 높이, 위로 갈수록 큼
    const WORLD_W = 360, BODY = 44, BAL_OFF = 76;
    const R = {
        reInflMin: 0.5, reInflMax: 1.0, riseMin: 185, riseMax: 215, riseWobble: 0.22, catchUp: 0.9,
        wanderAmp: 34, wanderWMin: 0.45, wanderWMax: 0.9, balTilt: 0.12, homeK: 0.9, kickV: 110, safeDur: 1.2, popBoost: 0.07, popBoostMax: 0.35, kickDecay: 1.3,
        popStop: 0.08, popHop: 60, dropDur: 0.55, dropG: 900, chuteV: 170, chuteEase: 3, chuteSway: 26, landDur: 0.3,
        startYard: 240, topYard: 280, middleMin: 5900, middleMax: 7100, funnel: 120, wallPad: 16, thornPad: 4, spikeR: 13, spikeHit: 34, balloonR: 15, spikeClear: 130,
        gustMin: 5, gustMax: 8, gustDur: 1.5, gustPush: 80, gustSlow: 0.55, windEase: 3,
        eagleFirst: 8, eagleMin: 7, eagleMax: 10, eagleWarn: 0.9, eagleFly: 1.1, eagleHitP: 0.4, eagleFromH: 0.12, eagleTopGap: 150, eagleMissDy: 46,
        flapOpen: 1.25, flapEase: 14, flapHold: 0.3, solidP: 0.35, solidReach: 220, finalZone: 220, finalSlow: 0.5,
        inflate: 3, hitStop: 0.25, hitSlow: 0.35, resultDelay: 1.6, shakeDur: 0.3, camEase: 3,
        // 꼴등 피날레(사용자 2026-10-18): N-1 명이 도착하면 남은 한 명이 놀라고(finaleShock) → 풍선 펑 → 낙하산 없이 떨어져(종단 finaleVMax)
        // 처음 닿는 발판·땅에 착지 → 그 자리에 비석(graveDrop 동안 떨어져 박힘) → graveHold 뒤 결과
        finaleShock: 0.5, finaleSlow: 0.55, finaleVMax: 700, finaleFallMax: 8, graveDrop: 0.45, graveHold: 1.6,
        // 2차(docs/goal/balloon-climb.md §11, 사용자 2026-10-18)
        bridgeLead: 40, bridgeBuild: 1.6, bridgePoof: 0.35,                 // 세이브 다리 — 꼴등 발이 경계 + bridgeLead 를 넘으면 비버가 망치질하며 bridgeBuild 초 동안 놓고(그 뒤부터 착지 가능), bridgePoof 초에 펑 사라진다
        itemR: 16, itemRespawn: 6, superDur: 2.5, superMul: 1.9, superPMin: 0.3, superPSpan: 0.5, shieldDur: 12, shieldSafe: 0.6,   // 아이템 상자
        itemClear: 70, itemHzClear: 120,                                    // 상자 자리 — 가시·발판(itemClear)·움직이는 장치 축(itemHzClear)에서 이만큼 떨어진 곳
        warpH: 56, warpMouthW: 48, warpBodyW: 40, warpSuck: 36, warpGapMin: 800, warpGapMax: 1600, warpHide: 0.5, warpCool: 3, warpPop: 200, warpPlatMin: 80,   // 하수구 — 발판 위 파이프 높이·입 폭, 숨는 시간, 다시 들어가기까지, 나올 때 위로 튀는 속도
        cloudP: 0.3, cloudW: 90, cloudInflMin: 0.25, cloudInflMax: 0.4,      // 구름 쿠션
        bumpKick: 70, bumpDy: 40, bumpCool: 0.5,                            // 동물끼리 튕김
        beamHP: 3, beamKnock: 160, beamHitCool: 0.5,                        // 안 열리는 들보 — HP · 부딪힌 동물을 아래로 튕기는 속도 · 같은 동물이 다시 깎기까지(초)
        bodyCY: 20, bodyR: 16, fenceBodyR: 12,                              // 풍선 ↔ 남의 몸 충돌 — 몸 원 중심(발 위 높이)·반지름(사용자 2026-10-19 "풍선이 몸을 뚫고 지나간다") · fenceBodyR = 울타리에 쓰는 몸 반지름(조금 작게 — 걸린 몸이 비탈 끝으로 빨리 빠져나온다)
        // 남의 풍선 콕 찌르기(docs/goal/balloon-poke.md, 사용자 2026-10-19) — 모든 동물 같은 규칙. 막힘: 맞닿음 pokeStuck 초 + 아래 풍선 상승 < 제 속도·pokeBlock → 아래가 위 pokeLow · 나머지는 위가 아래(맞찌르기는 없앰)
        // 지나가며 툭: 맞닿기 시작할 때 아래가 pokePassDv 이상 빨리 오르면 pokePassP. 준비 pokeWind 초 뒤 풍선 사이가 pokeReach 안이면 펑(아니면 헛찌르기)
        pokeStuck: 1, pokeBlock: 0.6, pokeLow: 0.7, pokePassP: 0.1, pokePassDv: 20, pokeWind: 0.3, pokeReach: 50, pokeCool: 6, pokePairCool: 10, pokeBodyP: 0.25, pokeBodyPassP: 0.04, pokeVictimCool: 8,   // 몸 맞닿음(위 동물만 찌름) 막힘·지나가며 확률 · 찔린 동물은 이만큼 다시 안 찔린다(뒤처진 동물 연달아 찔림 방지)
       
        fenceHold: 0.25, gateKnock: 320, gateHoldMax: 3,   // gateKnock = 내려오는 눈 문짝에 맞은 풍선을 아래로 쳐내는 속도                                                    // 울타리에 닿은 뒤 제자리 찾기를 끄는 시간(§12-11) · gateHoldMax = 눈 꼭대기 문이 지나가는 동물을 기다리는 최대 초
        // 풍선만 터지는 원인 — 낙하산 없이 잠깐 떨어지다 공중에서 다시 불고 오른다(§13-12). 나머지(번개·풍차·통나무)는 몸까지 맞아 낙하산 → 착지
        airCauses: ['eagle', 'bee', 'spike', 'thorn', 'bomb', 'meteor', 'poke'], airDropDur: 0.45, airInflMin: 0.5, airInflMax: 0.8, airInflFallV: 70, airInflEase: 5,
        riseAccel: 3, sideAccel: 4, blockSlow: 70,                          // 관성(사용자 2026-10-18) — 상승·옆 속도가 목표를 따라가는 빠르기(/초), 막힘 감속을 시작하는 거리
        laneFar: [0.62, 0.88],                                              // 터진 자리 반대쪽 길(통로 폭 비율) — 같은 자리 반복 금지(§13-15)
        startRowsMax: 4, startRowGap: 50, startColGap: 44, boostDur: 0.6, boostJitter: 0.9,   // 출발 좌석 — 최대 4층, 층 사이 높이 · 옆 간격 · 부스터 한 번 길이 · 출발 뒤 부스터가 터지는 순간(0~boostJitter, 동물마다 제각각 — 그림 전용)
        pivotW: 48, pivotTop: 16,                                           // 흔들 통나무 축 받침 발판 — 폭 · 축 위 높이(받침 그림 윗면)
        itemStackMax: 6, mysteryP: 0.5, mysteryGood: 0.55, slowShare: 0.6, slowDur: 3, slowMul: 0.5   // ? 상자(§13-1) — 상자 중 ? 비율 · 좋은 것 확률 · 나쁜 것 중 무거운 풍선 비율(나머지 폭탄) · 무거운 풍선 시간·상승 배율
    };
    // 구간 장치 — 위치는 시각 t(초) 만의 함수
    const Z = {
        bladeLen: 60, bladeHub: 10, bladePeriod: 6, pendLen: 150, pendAmp: 0.8, pendPeriod: 2.8, pendR: 19,
        boltPeriod: 3.6, boltWarn: 0.7, boltDur: 0.25, boltW: 70, boltLen: 280, fanPeriod: 3, fanOn: 1.4, fanPush: 150, fanBand: 120,
        beePeriod: 3.4, beeOut: 110, beeSway: 24, beeDrop: 240, beeR: 24, gatePeriod: 4, gateOpen: 1.5, gateSlide: 0.35, gateSwing: Math.PI - Math.atan2(75, 36),   // 문짝이 경첩 쪽 비탈(가로 36·세로 75)에 딱 붙을 때까지 접힌다 — 덜 접히면 문짝·비탈 사이 구석에 풍선이 갇힌다
        meteorPeriod: 2.2, meteorWarn: 0.7, meteorFall: 0.55, meteorFade: 0.35, meteorR: 12, meteorLanes: 3, meteorDrop: 120, finishGateGap: 70, shutPeriod: 3, shutSlide: 0.4, shutSteer: 2.2, shutReach: 260, upBoost: 1.9
    };

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    // 점(px, py) ↔ 선분 거리 · 가장 가까운 점
    const segClosest = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, k = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1); return [ax + dx * k, ay + dy * k]; };
    const segDist = (px, py, ax, ay, bx, by) => { const c = segClosest(px, py, ax, ay, bx, by); return Math.hypot(px - c[0], py - c[1]); };
    const lerpPts = (pts, y) => {
        for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]); }
        return pts[pts.length - 1][1];
    };

    // ── 구간 10종 — 좌표는 구간 아래가 0, x 0~360(반전 전). rng 는 맵 시드 ──
    // corr = 통로: { pts: [[y, 가운데 x]…], half } | { lo, hi }. 없으면 벽 없음
    const ZIG_PTS = [[0, 180], [200, 115], [450, 245], [700, 115], [900, 180]];
    const zx = y => lerpPts(ZIG_PTS, y);
    const SECTIONS = {
        chestnut: rng => {
            const range = (a, b) => a + (b - a) * rng();
            const spikes = [];
            [120, 260, 400, 540].forEach((y, r) => (r % 2 ? [125, 235] : [70, 180, 290]).forEach(x => spikes.push([x + range(-15, 15), y + range(-20, 20)])));
            return { h: 700, label: '밤송이 숲', spikes, plats: [[45, 190, 90], [315, 330, 90], [180, 470, 90], [55, 620, 100]] };
        },
        zigzag: () => ({ h: 900, label: '지그재그 굴', corr: { pts: ZIG_PTS, half: 85 },
            spikes: [[zx(220) + 55, 220], [zx(470) - 55, 470], [zx(720) + 55, 720]],
            plats: [[zx(130) - 45, 130, 70], [zx(340) + 45, 340, 70], [zx(590) - 45, 590, 70], [zx(810) + 45, 810, 70]] }),
        windmill: rng => ({ h: 720, label: '풍차', spikes: [], plats: [[50, 140, 90], [310, 140, 90], [35, 380, 70], [325, 380, 70], [180, 620, 90]],
            hz: [{ type: 'blade', x: 180, y: 370, s: 1, phase: 6.28 * rng() }] }),
        pendulum: () => ({ h: 760, label: '흔들 통나무', spikes: [], plats: [[55, 110, 90], [305, 250, 90], [55, 480, 90], [305, 620, 90]],
            hz: [{ type: 'pend', x: 180, y: 360, s: 1, phase: 0 }, { type: 'pend', x: 180, y: 720, s: 1, phase: Math.PI }] }),
        storm: () => ({ h: 760, label: '먹구름', spikes: [], plats: [[300, 130, 90], [60, 300, 90], [300, 470, 90], [180, 640, 80]],
            hz: [{ type: 'bolt', x: 95, y: 330, s: 1, phase: 0 }, { type: 'bolt', x: 265, y: 540, s: 1, phase: 1.2 }, { type: 'bolt', x: 150, y: 740, s: 1, phase: 2.4 }] }),
        fans: () => ({ h: 720, label: '바람 골목', thorn: true, corr: { lo: 62, hi: 298 }, spikes: [],
            plats: [[100, 120, 70], [260, 300, 70], [100, 480, 70], [260, 640, 70]],
            hz: [{ type: 'fan', x: 62, y: 210, s: -1, phase: 0 }, { type: 'fan', x: 298, y: 400, s: 1, phase: 1 }, { type: 'fan', x: 62, y: 590, s: -1, phase: 2 }] }),
        bees: () => ({ h: 660, label: '벌집', spikes: [[250, 200]], plats: [[300, 110, 90], [60, 300, 90], [300, 460, 90]],
            hz: [{ type: 'bee', x: 40, y: 600, s: 1, phase: 0 }] }),
        shutter: rng => ({ h: 540, label: '셔터', spikes: [], plats: [[180, 120, 100], [60, 440, 90], [300, 440, 90]],
            hz: [{ type: 'shutter', x: 0, y: 320, s: rng() < 0.5 ? 1 : -1, phase: 0 }] }),
        // 웃는 얼굴(§12-11, 데구리 '그릇' 울타리 ^ ^ + 입) — fences = 울타리 선분 [x1, y1, x2, y2](구간 아래 기준). 풍선만 부딪혀 비탈을 따라 미끄러진다
        smile: () => {
            const fences = [], cx = 180, cy = 330, r = 115, gap = 12;   // 입: 아래 반원(-170°~-10°), 맨 아래 ±gap° 틈(폭 ≈ 46)
            const arc = [];
            for (let a = -170; a <= -10; a += 20) arc.push(a);
            const pt = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
            for (let i = 0; i + 1 < arc.length; i++) {
                let a0 = arc[i], a1 = arc[i + 1];
                if (a1 > -90 - gap && a0 < -90 + gap) { if (a0 < -90 - gap) a1 = -90 - gap; else if (a1 > -90 + gap) a0 = -90 + gap; else continue; }
                fences.push(pt(a0).concat(pt(a1)));
            }
            [95, 265].forEach((ex, i) => {   // 눈: ^ 두 비탈 + 꼭대기 문(5번째 값 = 문 위상 — 두 눈이 반 주기 어긋나 번갈아 열린다)
                fences.push([ex - 58, 450, ex - 22, 525], [ex + 22, 525, ex + 58, 450], [ex - 22, 525, ex + 22, 525, i * Z.gatePeriod / 2]);
            });
            return { h: 720, label: '웃는 얼굴', spikes: [], fences, plats: [[55, 110, 80], [305, 110, 80], [180, 640, 90]] };
        },
        updraft: rng => {
            const ux = rng() < 0.5 ? 100 : 260;
            return { h: 640, label: '상승 기류', spikes: [[360 - ux, 260], [180, 450]], plats: [[300, 180, 80], [60, 360, 80], [180, 560, 80]],
                hz: [{ type: 'up', x: ux, y: 60, w: 70, h: 520, s: 1 }] };
        }
    };
    const SECTION_NAMES = Object.keys(SECTIONS);
    const SECTION_H = { chestnut: 700, zigzag: 900, windmill: 720, pendulum: 760, storm: 760, fans: 720, bees: 660, shutter: 540, updraft: 640, smile: 720 };
    // 움직이는 장애물 구간 — 판마다 최소 GIMMICK_MIN 개(밤송이·셔터·기류만 나오면 밋밋하다)
    const GIMMICK_NAMES = ['windmill', 'pendulum', 'storm', 'fans', 'bees'];
    const GIMMICK_MIN = 2;
    const FINALE_SECTION = 'smile';   // 웃는 얼굴은 덱에 안 넣고 판마다 맨 위(도착 바로 아래)에 붙인다 — 데구리 마지막 '그릇'처럼(사용자 2026-10-18)
    const DECK_NAMES = SECTION_NAMES.filter(n => n !== FINALE_SECTION);

    // 한 판의 구간을 덱에서 꺼낸다 → { order, deck }. 데구리 drawOrder(socket/deguri-sim.js)와 같은 규칙:
    // 덱 = 섞어 둔 9종 한 벌(웃는 얼굴 제외 — 늘 맨 위에 붙는다), 방마다 판을 넘어 이어 쓴다. 방금 나온 구간은 새 벌의 뒤로. 높이 MIN 을 채울 때까지, MAX 를 넘는 건 덱에 남긴다
    function drawOrder(deck, rng, prev) {
        deck = (deck || []).filter(n => SECTION_H[n] && n !== FINALE_SECTION);
        const lo = R.middleMin - SECTION_H[FINALE_SECTION], hi = R.middleMax - SECTION_H[FINALE_SECTION];   // 높이 예산 = 맨 위 웃는 얼굴 몫을 뺀 나머지
        const order = [];
        let sum = 0;
        const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
        const recent = n => order.includes(n) || (prev || []).includes(n);
        const refill = () => { deck = deck.concat(shuffle(DECK_NAMES.slice()).sort((a, b) => recent(a) - recent(b))); };
        const take = i => { const n = deck.splice(i, 1)[0]; order.push(n); sum += SECTION_H[n]; };
        while (order.filter(n => GIMMICK_NAMES.includes(n)).length < GIMMICK_MIN) {
            const i = deck.findIndex(n => GIMMICK_NAMES.includes(n) && !order.includes(n));
            if (i < 0) refill(); else take(i);
        }
        for (let i = 0, refilled = false; sum < lo;) {
            if (i >= deck.length) { if (refilled) break; refill(); refilled = true; continue; }
            if (order.includes(deck[i]) || sum + SECTION_H[deck[i]] > hi) i++; else take(i);
        }
        return { order: shuffle(order).concat(FINALE_SECTION), deck };
    }

    // 구간을 쌓아 맵을 만든다(좌우 반전은 구간마다 0.5). 반환은 JSON 그대로 클라로 간다
    // { worldH, sections:[{name,label,y0,y1,mirror,corr,thorn}], plats:[{x,y,w,solid,kind?:'cloud'|'pivot'}], spikes:[{x,y}], hazards:[{type,x,y,s,phase,w?,h?}],
    //   bridges:[{y,idx}](세이브 다리 자리), items:[{x,y,idx,kind:'gift'|'mystery'}](아이템 상자), warps:[{x,y,top,pair,idx}](하수구 — 발판 y 위에 top 까지 선 파이프), fences:[{x1,y1,x2,y2,gate?}](울타리 — 풍선만 부딪힌다. gate = 문 위상, gateOpen 동안 열림) }
    function buildMap(order, rng) {
        const sections = [], plats = [], hazards = [], fences = [];
        let spikes = [], y0 = R.startYard;
        for (const name of order) {
            const sec = SECTIONS[name](rng), m = rng() < 0.5, X = x => m ? WORLD_W - x : x;
            sections.push({ name, label: sec.label, y0, y1: y0 + sec.h, mirror: m, corr: sec.corr || null, thorn: !!sec.thorn });
            sec.spikes.forEach(([x, y]) => spikes.push({ x: X(x), y: y0 + y }));
            sec.plats.forEach(([x, y, w]) => plats.push({ x: X(x), y: y0 + y, w, solid: rng() < R.solidP }));   // solid = 안 열리는 들보(밑에서 오면 비켜 간다)
            (sec.hz || []).forEach(h => {
                hazards.push(Object.assign({}, h, { x: X(h.x), y: y0 + h.y, s: m ? -h.s : h.s }));
                if (h.type === 'pend') plats.push({ x: X(h.x), y: y0 + h.y + R.pivotTop, w: R.pivotW, solid: true, kind: 'pivot' });   // 흔들 통나무 축 받침 위 — 착지할 수 있다(사용자 2026-10-18). 그림은 장치 쪽(pendulum-pivot)
            });
            (sec.fences || []).forEach(f => fences.push(Object.assign({ x1: X(f[0]), y1: y0 + f[1], x2: X(f[2]), y2: y0 + f[3] }, f[4] != null ? { gate: f[4] } : {})));
            y0 += sec.h;
        }
        // 발판 바로 위 가시는 뺀다 — 풍선 달고 뜨자마자 또 터지는 반복 방지
        spikes = spikes.filter(q => !plats.some(p => q.y > p.y && q.y - p.y < R.spikeClear && Math.abs(q.x - p.x) < p.w / 2 + 30));
        // ── 2차 장치(§11) — 기존 구간 rng 를 다 쓴 뒤에 뽑는다(발판·가시·장치 자리는 그대로) ──
        const bridges = sections.slice(1).map((q, i) => ({ y: q.y0, idx: i }));   // 구간 경계마다 세이브 다리
        const nearHz = (x, y, pad) => hazards.some(h => h.type === 'bolt' ? Math.abs(x - h.x) < Z.boltW / 2 + 20 && y < h.y + 40 && y > h.y - Z.boltLen - 40
            : h.type === 'shutter' ? Math.abs(y - h.y) < 60 : h.type === 'up' ? false
            : h.type === 'bee' ? Math.abs(x - (h.x + h.s * Z.beeOut)) < pad && y < h.y + pad && y > h.y - Z.beeDrop - pad   // 벌 떼가 오가는 세로 띠
            : Math.hypot(x - h.x, y - h.y) < pad + (h.type === 'blade' ? Z.bladeLen : h.type === 'pend' ? Z.pendLen : 0));
        const freeAt = (x, y, halfW) => {
            const q = sectionAt({ sections }, y), b = q && q.corr ? sectionBounds(q, y - q.y0) : FULL;
            return x - halfW > b[0] + R.wallPad && x + halfW < b[1] - R.wallPad && !nearHz(x, y, R.itemHzClear) && !fences.some(f => segDist(x, y, f.x1, f.y1, f.x2, f.y2) < halfW + 30)
                && !spikes.some(k => Math.hypot(k.x - x, k.y - y) < R.itemClear + halfW * 0.5) && !plats.some(p => Math.abs(p.y - y) < R.itemClear && Math.abs(p.x - x) < p.w / 2 + halfW + 20);
        };
        const pick = cands => cands.length ? cands[Math.floor(rng() * cands.length)] : null;
        const items = [], clouds = [];
        sections.forEach(q => {
            if (fences.some(f => f.y1 >= q.y0 && f.y1 < q.y1)) return;   // 웃는 얼굴 구간엔 상자·구름을 안 놓는다(얼굴이 가려진다)
            const h = q.y1 - q.y0, spots = [];
            [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].forEach(fy => [70, 125, 180, 235, 290].forEach(x => spots.push([x, q.y0 + h * fy])));
            const it = pick(spots.filter(([x, y]) => freeAt(x, y, R.itemR)));
            if (it) items.push({ x: it[0], y: Math.round(it[1]), idx: items.length, kind: rng() < R.mysteryP ? 'mystery' : 'gift' });   // 선물 상자(좋은 것만) / ? 상자(나쁜 것도, §13-1)
            if (rng() < R.cloudP) {
                const c = pick(spots.filter(([x, y]) => freeAt(x, y, R.cloudW / 2) && !(it && Math.hypot(it[0] - x, it[1] - y) < 90)));
                if (c) clouds.push({ x: c[0], y: Math.round(c[1]), w: R.cloudW, solid: false, kind: 'cloud' });
            }
        });
        // 하수구 짝 — 아래 절반 구간의 넓은 발판 하나 ↔ 위 절반 구간의 넓은 발판 하나(그 발판은 늘 solid). 구간 4개 이상이면 2쌍
        const warps = [], half = Math.floor(sections.length / 2), used = new Set();
        const wide = (lo, hi) => plats.filter(p => !used.has(p) && p.w >= R.warpPlatMin && p.y >= sections[lo].y0 && p.y < sections[hi - 1].y1 && !sections.some(q => q.y0 > p.y && q.y0 < p.y + R.warpH + 30));   // 파이프 머리가 위 구간 경계(세이브 다리)에 닿지 않게
        for (let k = 0; half >= 1 && k < (sections.length >= 4 ? 2 : 1); k++) {   // 구간이 하나뿐인 맵(프리뷰에서 구간 지정)엔 짝을 못 놓는다
            const a = pick(wide(0, half)), up = a ? wide(half, sections.length) : [];
            const near = up.filter(q => q.y - a.y >= R.warpGapMin && q.y - a.y <= R.warpGapMax);   // 짝 사이가 너무 멀면 한 번에 판이 끝난다(바닥 → 꼭대기)
            const b = a && (near.length ? pick(near) : up.slice().sort((p, q) => Math.abs(p.y - a.y - R.warpGapMax) - Math.abs(q.y - a.y - R.warpGapMax))[0]);
            if (!a || !b) break;
            [a, b].forEach(p => { used.add(p); p.solid = true; });
            const ia = warps.length;
            warps.push({ x: a.x, y: a.y, top: a.y + R.warpH, pair: ia + 1, idx: ia }, { x: b.x, y: b.y, top: b.y + R.warpH, pair: ia, idx: ia + 1 });
        }
        clouds.forEach(c => plats.push(c));
        // 막판 스퍼트(§13-16) — 맨 위 빈 구간(topYard): 별똥별 비 3줄 + 도착선 바로 밑 결승 문(셔터)
        const top = y0 + R.topYard;
        for (let l = 0; l < Z.meteorLanes; l++) hazards.push({ type: 'meteor', x: 180, y: top + 40, len: R.topYard + 40 + Z.meteorDrop, s: 1, phase: l * Z.meteorPeriod / Z.meteorLanes, lane: l });
        hazards.push({ type: 'shutter', x: 0, y: top - Z.finishGateGap, s: rng() < 0.5 ? 1 : -1, phase: 0, finish: true });
        const r1 = v => Math.round(v * 10) / 10;   // JSON 크기만 줄인다 — 시뮬·그림이 같은 값을 읽으므로 결과와 무관
        spikes.forEach(q => { q.x = r1(q.x); q.y = r1(q.y); });
        plats.forEach(q => { q.x = r1(q.x); });
        warps.forEach(q => { q.x = r1(q.x); });
        fences.forEach(f => { f.x1 = r1(f.x1); f.y1 = r1(f.y1); f.x2 = r1(f.x2); f.y2 = r1(f.y2); });
        return { worldH: y0 + R.topYard, sections, plats, spikes, hazards, bridges, items, warps, fences };
    }

    function sectionAt(map, y) {
        const s = map.sections;
        for (let i = 0; i < s.length; i++) if (y >= s[i].y0 && y < s[i].y1) return s[i];
        return null;
    }
    // 통로 벽 [왼, 오] — 들어오고 나가는 funnel 안에서 넓은 하늘 ↔ 통로로 이어진다
    function sectionBounds(sec, ly) {
        const c = sec.corr, h = sec.y1 - sec.y0;
        const cx = c.pts ? lerpPts(c.pts, ly) : 0;
        const c0 = c.pts ? cx - c.half : c.lo, c1 = c.pts ? cx + c.half : c.hi;
        const f = clamp(Math.min(ly, h - ly) / R.funnel, 0, 1), e = f * f * (3 - 2 * f);
        const a = c0 * e, z = WORLD_W - (WORLD_W - c1) * e;
        return sec.mirror ? [WORLD_W - z, WORLD_W - a] : [a, z];
    }
    const FULL = [0, WORLD_W];
    function boundsAt(map, y) { const q = sectionAt(map, y); return q && q.corr ? sectionBounds(q, y - q.y0) : FULL; }

    // ── 장애물 상태(시각 t 초) ──
    const cyc = (h, t, period) => (((t + h.phase) % period) + period) % period;
    const bladeAng = (h, t) => h.s * 2 * Math.PI * t / Z.bladePeriod + h.phase;
    function pendBall(h, t) { const th = h.s * Z.pendAmp * Math.sin(2 * Math.PI * t / Z.pendPeriod + h.phase); return [h.x + Z.pendLen * Math.sin(th), h.y - Z.pendLen * Math.cos(th)]; }
    function boltState(h, t) { const c = cyc(h, t, Z.boltPeriod); return c < Z.boltPeriod - Z.boltWarn - Z.boltDur ? 0 : c < Z.boltPeriod - Z.boltDur ? 1 : 2; }   // 0 쉼 · 1 번쩍 경고 · 2 내리침
    const fanOn = (h, t) => cyc(h, t, Z.fanPeriod) < Z.fanOn;
    // 벌 떼 — 늘 나와서 벌집 앞(beeOut)을 위아래로 오간다(사용자 2026-10-18 §12-2). 가로로 살짝 흔들린다
    function swarmAt(h, t) {
        const k = cyc(h, t, Z.beePeriod) / Z.beePeriod;
        return [h.x + h.s * (Z.beeOut + Z.beeSway * Math.sin(4 * Math.PI * k)), h.y - Z.beeDrop * (0.5 - 0.5 * Math.cos(2 * Math.PI * k))];
    }
    // 별똥별 — 주기마다 경고(떨어질 x 반짝) → 위(h.y)에서 h.len 아래까지 떨어진다. x 는 주기 번호·줄 번호의 정수식(난수 없음). → { x, y(머리) | null, warn } | null
    function meteorAt(h, t) {
        const c = cyc(h, t, Z.meteorPeriod), n = Math.floor((t + h.phase) / Z.meteorPeriod);
        if (c >= Z.meteorWarn + Z.meteorFall) return null;
        const x = 40 + ((n * 131 + h.lane * 71) % 280);
        if (c < Z.meteorWarn) return { x, y: null, warn: c / Z.meteorWarn };
        const k = (c - Z.meteorWarn) / Z.meteorFall;
        return { x: x + 24 * k, y: h.y - h.len * k, warn: 1, k };
    }
    // 떨어지기가 끝난 뒤 meteorFade 초 동안 — 같은 길로 계속 내려가며 흐려진다(그림 전용, 충돌 없음 — 시뮬은 meteorAt 만 본다. 사용자 2026-10-19 "그냥 사라진다"). → { x, y, a(불투명도) } | null
    function meteorFadeAt(h, t) {
        const c = cyc(h, t, Z.meteorPeriod), c0 = Z.meteorWarn + Z.meteorFall;
        if (c < c0 || c >= c0 + Z.meteorFade) return null;
        const n = Math.floor((t + h.phase) / Z.meteorPeriod), x = 40 + ((n * 131 + h.lane * 71) % 280), k = (c - Z.meteorWarn) / Z.meteorFall;
        return { x: x + 24 * k, y: h.y - h.len * k, a: 1 - (c - c0) / Z.meteorFade };
    }
    // 출발 좌석 k → { x, y, row } — 1층을 먼저 꽉 채운다(한 층 SEAT_PER_ROW 칸, 가운데부터 바깥으로), 다 차면 2층·3층·4층(사용자 2026-10-18 "밑에 8~9마리 꽉 채우고 그다음 위로").
    // 좌석은 서버가 이름마다 한 번 정해 그대로 둔다(socket/balloon.js ensureSeats). 위치가 결과를 안 바꾸게 시뮬이 출발 부스터로 높이를 맞춘다(R.boostDur)
    const SEAT_PER_ROW = 8, SEAT_COLS = [-0.5, 0.5, -1.5, 1.5, -2.5, 2.5, -3.5, 3.5];
    function seatPos(k) {
        const row = Math.floor(k / SEAT_PER_ROW) % R.startRowsMax, col = SEAT_COLS[k % SEAT_PER_ROW];
        return { x: WORLD_W / 2 + col * R.startColGap, y: row * R.startRowGap, row };
    }
    const gateOpen = (f, t) => cyc({ phase: f.gate }, t, Z.gatePeriod) < Z.gateOpen;   // 웃는 얼굴 눈 꼭대기 문 — 열려 있는 동안
    // 울타리 선분의 지금 자리 — 눈 꼭대기 문은 첫 점(경첩)을 축으로 아래로 젖혀지며(gateSwing rad) 밑에 모인 풍선을 아래로 밀어낸다(사용자 2026-10-18 "아래로 열리면 밀려야").
    // 다 열리면 아래로 늘어진 문짝 옆으로 빠져나간다. 열림 정도는 gateSlide 초에 걸쳐 0 → 1, 닫히는 시각에 맞춰 1 → 0
    const gateSwinging = (f, t) => cyc({ phase: f.gate }, t, Z.gatePeriod) < Z.gateSlide;   // 문짝이 아래로 내려오는 중(열리는 0.35초)
    function fenceSeg(f, t) {
        if (f.gate == null) return f;
        const c = cyc({ phase: f.gate }, t, Z.gatePeriod), e = c < Z.gateOpen ? Math.min(1, c / Z.gateSlide, (Z.gateOpen - c) / Z.gateSlide) : 0;
        if (e <= 0) return f;
        const dx = f.x2 - f.x1, dy = f.y2 - f.y1, L = Math.hypot(dx, dy), a = Math.atan2(dy, dx) + (dx >= 0 ? -1 : 1) * e * Z.gateSwing;
        return { x1: f.x1, y1: f.y1, x2: f.x1 + Math.cos(a) * L, y2: f.y1 + Math.sin(a) * L, gate: f.gate };
    }
    const shutOpen = (h, t) => (Math.floor((t + h.phase) / Z.shutPeriod) % 2 ? -h.s : h.s);   // 1 = 오른쪽 반이 열림, -1 = 왼쪽 반

    // ── 재생 시각: 실제 경과(ms) → 시뮬 시각(ms). slow = [{ startMs, endMs, rate, holdMs? }] 시뮬 시각 순, 겹치지 않음.
    //    holdMs = 그 순간 멈춘 채로 보내는 실제 시간(판정 순간 정지). 서버 durationMs·클라 재생이 같은 식을 쓴다 → 2탭 동기
    function simTimeAt(realMs, slow) {
        let r = 0, s = 0;
        for (const g of slow || []) {
            const gap = g.startMs - s;
            if (realMs <= r + gap) return s + (realMs - r);
            r += gap; s = g.startMs;
            if (g.holdMs) { if (realMs <= r + g.holdMs) return s; r += g.holdMs; }
            const len = (g.endMs - g.startMs) / g.rate;
            if (realMs <= r + len) return s + (realMs - r) * g.rate;
            r += len; s = g.endMs;
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

    return {
        WORLD_W, BODY, BAL_OFF, R, Z, SECTIONS, SECTION_NAMES, SECTION_H, GIMMICK_NAMES, GIMMICK_MIN, FINALE_SECTION,
        clamp, segClosest, segDist, drawOrder, buildMap, sectionAt, sectionBounds, boundsAt,
        bladeAng, pendBall, boltState, fanOn, swarmAt, shutOpen, seatPos, gateOpen, gateSwinging, fenceSeg, meteorAt, meteorFadeAt, cyc, simTimeAt, realDuration
    };
});
