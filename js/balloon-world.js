// 풍선 타기(balloon) 세계 — 서버 시뮬(socket/balloon-sim.js)과 클라 렌더러(js/balloon-render.js)가 같이 읽는 한 벌.
// 수치·구간 9종·장애물 위치(시각 t 만의 함수)·통로 벽 모양이 여기 하나뿐이다 — 데구리처럼 양쪽에 복사해 두면 어긋난다.
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
        reInflMin: 1.0, reInflMax: 2.0, riseMin: 128, riseMax: 150, riseWobble: 0.22, catchUp: 0.9,
        wanderAmp: 34, wanderWMin: 0.45, wanderWMax: 0.9, balTilt: 0.12, homeK: 0.9, kickV: 110, safeDur: 1.2, popBoost: 0.07, popBoostMax: 0.35, kickDecay: 1.3,
        popStop: 0.25, dropDur: 0.3, dropG: 900, chuteV: 300, chuteEase: 4, chuteSway: 26, landDur: 0.3,
        startYard: 240, topYard: 280, middleMin: 3500, middleMax: 4400, funnel: 120, wallPad: 16, thornPad: 4, spikeR: 13, balloonR: 15, spikeClear: 130,
        gustMin: 5, gustMax: 8, gustDur: 1.5, gustPush: 80, gustSlow: 0.55, windEase: 3,
        eagleFirst: 8, eagleMin: 7, eagleMax: 10, eagleWarn: 0.9, eagleFly: 1.1, eagleHitP: 0.4, eagleFromH: 0.12, eagleTopGap: 150, eagleMissDy: 46,
        flapOpen: 1.25, flapEase: 14, flapHold: 0.3, solidP: 0.35, solidReach: 220, finalZone: 220, finalSlow: 0.5,
        inflate: 3, hitStop: 0.25, hitSlow: 0.35, resultDelay: 1.6, shakeDur: 0.3, camEase: 3
    };
    // 구간 장치 — 위치는 시각 t(초) 만의 함수
    const Z = {
        bladeLen: 100, bladeHub: 14, bladePeriod: 6, pendLen: 150, pendAmp: 0.8, pendPeriod: 2.8, pendR: 19,
        boltPeriod: 3.6, boltWarn: 0.7, boltDur: 0.25, boltW: 70, boltLen: 280, fanPeriod: 3, fanOn: 1.4, fanPush: 150, fanBand: 120,
        beePeriod: 3.4, beeDur: 1.6, beeSpan: 280, beeDrop: 240, beeR: 24, shutPeriod: 3, shutSlide: 0.4, shutSteer: 2.2, shutReach: 260, upBoost: 1.9
    };

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerpPts = (pts, y) => {
        for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]); }
        return pts[pts.length - 1][1];
    };

    // ── 구간 9종 — 좌표는 구간 아래가 0, x 0~360(반전 전). rng 는 맵 시드 ──
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
        updraft: rng => {
            const ux = rng() < 0.5 ? 100 : 260;
            return { h: 640, label: '상승 기류', spikes: [[360 - ux, 260], [180, 450]], plats: [[300, 180, 80], [60, 360, 80], [180, 560, 80]],
                hz: [{ type: 'up', x: ux, y: 60, w: 70, h: 520, s: 1 }] };
        }
    };
    const SECTION_NAMES = Object.keys(SECTIONS);
    const SECTION_H = { chestnut: 700, zigzag: 900, windmill: 720, pendulum: 760, storm: 760, fans: 720, bees: 660, shutter: 540, updraft: 640 };
    // 움직이는 장애물 구간 — 판마다 최소 GIMMICK_MIN 개(밤송이·셔터·기류만 나오면 밋밋하다)
    const GIMMICK_NAMES = ['windmill', 'pendulum', 'storm', 'fans', 'bees'];
    const GIMMICK_MIN = 2;

    // 한 판의 구간을 덱에서 꺼낸다 → { order, deck }. 데구리 drawOrder(socket/deguri-sim.js)와 같은 규칙:
    // 덱 = 섞어 둔 9종 한 벌, 방마다 판을 넘어 이어 쓴다. 방금 나온 구간은 새 벌의 뒤로. 높이 MIN 을 채울 때까지, MAX 를 넘는 건 덱에 남긴다
    function drawOrder(deck, rng, prev) {
        deck = (deck || []).filter(n => SECTION_H[n]);
        const order = [];
        let sum = 0;
        const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
        const recent = n => order.includes(n) || (prev || []).includes(n);
        const refill = () => { deck = deck.concat(shuffle(SECTION_NAMES.slice()).sort((a, b) => recent(a) - recent(b))); };
        const take = i => { const n = deck.splice(i, 1)[0]; order.push(n); sum += SECTION_H[n]; };
        while (order.filter(n => GIMMICK_NAMES.includes(n)).length < GIMMICK_MIN) {
            const i = deck.findIndex(n => GIMMICK_NAMES.includes(n) && !order.includes(n));
            if (i < 0) refill(); else take(i);
        }
        for (let i = 0, refilled = false; sum < R.middleMin;) {
            if (i >= deck.length) { if (refilled) break; refill(); refilled = true; continue; }
            if (order.includes(deck[i]) || sum + SECTION_H[deck[i]] > R.middleMax) i++; else take(i);
        }
        return { order: shuffle(order), deck };
    }

    // 구간을 쌓아 맵을 만든다(좌우 반전은 구간마다 0.5). 반환은 JSON 그대로 클라로 간다
    // { worldH, sections:[{name,label,y0,y1,mirror,corr,thorn}], plats:[{x,y,w,solid}], spikes:[{x,y}], hazards:[{type,x,y,s,phase,w?,h?}] }
    function buildMap(order, rng) {
        const sections = [], plats = [], hazards = [];
        let spikes = [], y0 = R.startYard;
        for (const name of order) {
            const sec = SECTIONS[name](rng), m = rng() < 0.5, X = x => m ? WORLD_W - x : x;
            sections.push({ name, label: sec.label, y0, y1: y0 + sec.h, mirror: m, corr: sec.corr || null, thorn: !!sec.thorn });
            sec.spikes.forEach(([x, y]) => spikes.push({ x: X(x), y: y0 + y }));
            sec.plats.forEach(([x, y, w]) => plats.push({ x: X(x), y: y0 + y, w, solid: rng() < R.solidP }));   // solid = 안 열리는 들보(밑에서 오면 비켜 간다)
            (sec.hz || []).forEach(h => hazards.push(Object.assign({}, h, { x: X(h.x), y: y0 + h.y, s: m ? -h.s : h.s })));
            y0 += sec.h;
        }
        // 발판 바로 위 가시는 뺀다 — 풍선 달고 뜨자마자 또 터지는 반복 방지
        spikes = spikes.filter(q => !plats.some(p => q.y > p.y && q.y - p.y < R.spikeClear && Math.abs(q.x - p.x) < p.w / 2 + 30));
        const r1 = v => Math.round(v * 10) / 10;   // JSON 크기만 줄인다 — 시뮬·그림이 같은 값을 읽으므로 결과와 무관
        spikes.forEach(q => { q.x = r1(q.x); q.y = r1(q.y); });
        plats.forEach(q => { q.x = r1(q.x); });
        return { worldH: y0 + R.topYard, sections, plats, spikes, hazards };
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
    function swarmAt(h, t) {
        const c = cyc(h, t, Z.beePeriod); if (c > Z.beeDur) return null;
        const k = c / Z.beeDur, a = Math.sin(k * Math.PI);
        return [h.x + h.s * Z.beeSpan * a, h.y - Z.beeDrop * a - 50 * Math.sin(2 * Math.PI * k)];
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
        WORLD_W, BODY, BAL_OFF, R, Z, SECTIONS, SECTION_NAMES, SECTION_H, GIMMICK_NAMES, GIMMICK_MIN,
        clamp, drawOrder, buildMap, sectionAt, sectionBounds, boundsAt,
        bladeAng, pendBall, boltState, fanOn, swarmAt, shutOpen, cyc, simTimeAt, realDuration
    };
});
