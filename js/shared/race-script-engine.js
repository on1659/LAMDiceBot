// Race Script 평가 엔진 — 서버 검증기와 클라 재생기가 공유하는 단일 SSOT.
//
// 포맷 명세: docs/goal/horse-race-script-format.md
//
// 이 모듈이 UMD인 이유: 기존 js/shared/* 는 브라우저 전용 IIFE지만, 이 모듈은
// 서버(socket/horse.js 검증)와 클라(재생기)가 **같은 코드**를 돌려야 한다.
// 두 벌로 나뉘는 순간 현행 dual-sim 표류가 규모만 줄어 재생산된다.
//
// 핵심 계약: 위치는 누적이 아니라 pos(t) 직접 샘플링 → 드리프트 0, seek 공짜.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.RaceScriptEngine = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var FORMAT_VERSION = 1;

    // ─── 세그먼트 조회 ────────────────────────────────────────────────

    // segments는 t 오름차순. tSim을 담는 세그먼트 인덱스를 이진 탐색.
    function findSegmentIndex(segments, tSim) {
        var lo = 0, hi = segments.length - 1;
        if (tSim <= segments[0].t) return 0;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (segments[mid].t <= tSim) lo = mid; else hi = mid - 1;
        }
        return lo;
    }

    // 세그먼트 i의 끝 시각 (다음 세그먼트 시작, 마지막이면 스크립트 끝)
    function segmentEnd(horse, i, simDurationMs) {
        return (i + 1 < horse.segments.length) ? horse.segments[i + 1].t : simDurationMs;
    }

    /**
     * 시뮬시각 tSim에서 말의 위치(px, 탈것 왼쪽 끝).
     * 구간 속도가 v0→v1로 선형 보간되므로 위치는 닫힌 형태로 적분된다:
     *   pos = p + v0*dt + (v1-v0)*dt^2 / (2*span)
     */
    function sampleHorsePosition(horse, tSim, simDurationMs) {
        var segs = horse.segments;
        if (!segs || !segs.length) return 0;
        if (tSim <= segs[0].t) return segs[0].p;

        var i = findSegmentIndex(segs, tSim);
        var seg = segs[i];
        var end = segmentEnd(horse, i, simDurationMs);
        var span = end - seg.t;
        var dt = tSim - seg.t;
        if (span <= 0) return seg.p;
        if (dt > span) dt = span;

        return seg.p + seg.v0 * dt + (seg.v1 - seg.v0) * dt * dt / (2 * span);
    }

    /** 시뮬시각 tSim에서의 속도(px/ms). 연출(먼지 방향 등) 판단용. */
    function sampleHorseSpeed(horse, tSim, simDurationMs) {
        var segs = horse.segments;
        if (!segs || !segs.length) return 0;
        var i = findSegmentIndex(segs, tSim);
        var seg = segs[i];
        var end = segmentEnd(horse, i, simDurationMs);
        var span = end - seg.t;
        if (span <= 0) return seg.v1;
        var dt = Math.max(0, Math.min(tSim - seg.t, span));
        return seg.v0 + (seg.v1 - seg.v0) * dt / span;
    }

    // ─── 시뮬시간 ↔ 벽시계 시간 (timeScale) ──────────────────────────

    // wallAt[] 을 1회 계산해 스크립트에 캐시한다 (비열거 속성 — 직렬화 오염 방지).
    function wallIndex(script) {
        if (script.__wallIndex) return script.__wallIndex;
        var ts = script.timeScale && script.timeScale.length
            ? script.timeScale
            : [{ t: 0, scale: 1 }];
        var wallAt = new Array(ts.length);
        wallAt[0] = 0;
        for (var i = 1; i < ts.length; i++) {
            var span = ts[i].t - ts[i - 1].t;
            var scale = ts[i - 1].scale || 1;
            wallAt[i] = wallAt[i - 1] + span / scale;
        }
        var idx = { ts: ts, wallAt: wallAt };
        try {
            Object.defineProperty(script, '__wallIndex', { value: idx, enumerable: false, configurable: true });
        } catch (e) { script.__wallIndex = idx; }
        return idx;
    }

    function timeScaleIndexAt(ts, tSim) {
        var lo = 0, hi = ts.length - 1;
        if (tSim <= ts[0].t) return 0;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (ts[mid].t <= tSim) lo = mid; else hi = mid - 1;
        }
        return lo;
    }

    /** 시뮬시각 → 벽시계 경과(ms) */
    function simToWall(script, tSim) {
        var idx = wallIndex(script);
        var i = timeScaleIndexAt(idx.ts, tSim);
        var scale = idx.ts[i].scale || 1;
        return idx.wallAt[i] + (tSim - idx.ts[i].t) / scale;
    }

    /** 벽시계 경과 → 시뮬시각. 재생기가 매 프레임 호출하는 진입점. */
    function wallToSim(script, wallMs) {
        var idx = wallIndex(script);
        var wallAt = idx.wallAt, ts = idx.ts;
        var lo = 0, hi = ts.length - 1;
        if (wallMs <= 0) return ts[0].t;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (wallAt[mid] <= wallMs) lo = mid; else hi = mid - 1;
        }
        var scale = ts[lo].scale || 1;
        return ts[lo].t + (wallMs - wallAt[lo]) * scale;
    }

    /** 현재 재생 배율 (비네트 등 슬로모 연출 판정용) */
    function timeScaleAt(script, tSim) {
        var idx = wallIndex(script);
        return idx.ts[timeScaleIndexAt(idx.ts, tSim)].scale || 1;
    }

    /** 스크립트 전체의 벽시계 길이 — 워치독·complete 타이밍 가드의 canonical 값 */
    function wallDuration(script) {
        return simToWall(script, script.simDurationMs);
    }

    // ─── 마커 ────────────────────────────────────────────────────────

    /**
     * tSim 시점에 활성인 상태형 마커들.
     * 임의 시점 합류(관전 catch-up · 탭 복귀 · 다시보기 seek)에서 화면을 재구성할 때 쓴다.
     */
    function activeStateMarkers(script, tSim) {
        var out = [];
        var ms = script.markers || [];
        for (var i = 0; i < ms.length; i++) {
            var m = ms[i];
            if (m.kind !== 'state') continue;
            if (m.t <= tSim && tSim < m.t + (m.dur || 0)) out.push(m);
        }
        return out;
    }

    /**
     * (tFrom, tTo] 사이에 발화해야 할 이벤트형 마커들.
     * 재생기는 매 프레임 직전 시각과 현재 시각으로 호출한다.
     * seek/catch-up으로 큰 폭을 건너뛰었으면 호출하지 말 것 — 이벤트형은 스킵이 규칙.
     */
    function eventMarkersBetween(script, tFrom, tTo) {
        var out = [];
        var ms = script.markers || [];
        for (var i = 0; i < ms.length; i++) {
            var m = ms[i];
            if (m.kind !== 'event') continue;
            if (m.t > tFrom && m.t <= tTo) out.push(m);
        }
        return out;
    }

    /** 상태형 마커의 시작/끝 전이 — 프레임 간 diff로 연출 진입/해제를 구동 */
    function diffStateMarkers(prevActive, nextActive) {
        var prevIds = {}, nextIds = {};
        var i;
        for (i = 0; i < prevActive.length; i++) prevIds[prevActive[i].id] = prevActive[i];
        for (i = 0; i < nextActive.length; i++) nextIds[nextActive[i].id] = nextActive[i];
        var entered = [], exited = [];
        for (i = 0; i < nextActive.length; i++) if (!prevIds[nextActive[i].id]) entered.push(nextActive[i]);
        for (i = 0; i < prevActive.length; i++) if (!nextIds[prevActive[i].id]) exited.push(prevActive[i]);
        return { entered: entered, exited: exited };
    }

    // ─── 완주 판정 ───────────────────────────────────────────────────

    /**
     * 2단계 완주 상태 (현행 세만틱 유지):
     *   judged   = 오른쪽 끝(pos + visualWidth)이 결승선 통과 → 순위 확정
     *   finished = 왼쪽 끝(pos)이 결승선 통과 → 완전 정지
     * 스크립트가 시각을 미리 담고 있으므로 비교만 한다.
     */
    function finishStateOf(horse, tSim) {
        return {
            judged: horse.finishJudgedSimMs != null && tSim >= horse.finishJudgedSimMs,
            finished: horse.finishSimMs != null && tSim >= horse.finishSimMs
        };
    }

    /** tSim 시점의 순위표 (러너만, 앞선 순). 라이브 순위 HUD·경계 HUD용. */
    function standingsAt(script, tSim) {
        var runners = script.horses.filter(function (h) { return h.runner !== false; });
        return runners
            .map(function (h) {
                return {
                    horseIndex: h.horseIndex,
                    pos: sampleHorsePosition(h, tSim, script.simDurationMs),
                    rank: h.rank
                };
            })
            .sort(function (a, b) { return b.pos - a.pos; });
    }

    /** stakeRank 경계의 두 말과 격차(px) — 경계 HUD·카메라 타깃 산출 */
    function stakeBoundaryAt(script, tSim) {
        var st = standingsAt(script, tSim);
        var k = script.stakeRank;
        if (!k || k < 1 || st.length < 2) return null;
        var insideIdx = Math.min(k - 1, st.length - 1);
        var inside = st[insideIdx];
        var outside = st[insideIdx + 1] || st[insideIdx - 1];
        return {
            inside: inside,
            outside: outside,
            gapPx: Math.abs(inside.pos - outside.pos),
            group: st.slice(Math.max(0, insideIdx - 1), insideIdx + 2)
        };
    }

    // ─── 검증 (서버 전용, 클라도 로드하지만 호출하지 않음) ───────────

    var DEFAULT_LIMITS = {
        maxSpeedPxPerMs: 3.0,       // 순간이동 방지 상한
        posEpsilonPx: 0.5,          // p 누적값 정합 허용 오차
        noCauseDeltaThreshold: 0.25, // 원인 마커 없이 허용되는 속도 변화 비율
        noCauseWindowMs: 400,        // 그 변화를 감싸는 마커 탐색 창
        slowMoBudgetWallMs: 6000,    // 판당 슬로모 벽시계 총합 상한
        minLeadChanges: 1,           // 선두 교체 최소 횟수 (runner >= 2)
        gapCapProgress: 0.75,        // L0 격차 상한을 적용할 진행률 구간 끝
        gapCapPx: 900,               // 그 구간의 stakeRank 경계 격차 상한
        sampleStepMs: 100            // 제약 검사 샘플링 간격
    };

    function validate(script, limits) {
        var L = Object.assign({}, DEFAULT_LIMITS, limits || {});
        var errors = [];
        var i, j;

        function fail(code, detail) { errors.push({ code: code, detail: detail }); }

        if (script.v !== FORMAT_VERSION) fail('VERSION', 'v=' + script.v);
        if (!script.horses || !script.horses.length) {
            fail('NO_HORSES', '');
            return { ok: false, errors: errors };
        }

        var simEnd = script.simDurationMs;

        // 1) 세그먼트 연속성 + p 누적 정합 + 속도 상한 + 시작선 하한
        for (i = 0; i < script.horses.length; i++) {
            var h = script.horses[i];
            var segs = h.segments || [];
            if (!segs.length) { fail('SEGMENT_GAP', 'horse ' + h.horseIndex + ' empty'); continue; }
            if (segs[0].t !== 0) fail('SEGMENT_GAP', 'horse ' + h.horseIndex + ' does not start at t=0');

            for (j = 0; j < segs.length; j++) {
                if (j > 0 && segs[j].t <= segs[j - 1].t) {
                    fail('SEGMENT_GAP', 'horse ' + h.horseIndex + ' seg ' + j + ' not ascending');
                }
                if (Math.abs(segs[j].v0) > L.maxSpeedPxPerMs || Math.abs(segs[j].v1) > L.maxSpeedPxPerMs) {
                    fail('TELEPORT', 'horse ' + h.horseIndex + ' seg ' + j);
                }
                // p 누적 정합: 이전 세그먼트를 끝까지 적분한 값과 일치해야 한다
                if (j > 0) {
                    var prev = segs[j - 1];
                    var span = segs[j].t - prev.t;
                    var expected = prev.p + prev.v0 * span + (prev.v1 - prev.v0) * span / 2;
                    if (Math.abs(expected - segs[j].p) > L.posEpsilonPx) {
                        fail('SEGMENT_GAP', 'horse ' + h.horseIndex + ' seg ' + j +
                            ' p mismatch (expected ' + expected.toFixed(2) + ', got ' + segs[j].p + ')');
                    }
                }
                if (segs[j].p < script.startPosition - L.posEpsilonPx) {
                    fail('BEHIND_START', 'horse ' + h.horseIndex + ' seg ' + j);
                }
            }
        }

        // 2) 순위 == finishJudged 순서, 미완주 러너 없음
        var runners = script.horses.filter(function (x) { return x.runner !== false; });
        var byJudged = runners.slice().sort(function (a, b) {
            return (a.finishJudgedSimMs || Infinity) - (b.finishJudgedSimMs || Infinity);
        });
        for (i = 0; i < byJudged.length; i++) {
            if (byJudged[i].finishJudgedSimMs == null) {
                fail('FINISH_ORDER', 'horse ' + byJudged[i].horseIndex + ' never judged');
                continue;
            }
            if (byJudged[i].rank !== i + 1) {
                fail('RANK_MISMATCH', 'horse ' + byJudged[i].horseIndex +
                    ' rank=' + byJudged[i].rank + ' but judged order=' + (i + 1));
            }
            if (byJudged[i].finishSimMs != null && byJudged[i].finishSimMs < byJudged[i].finishJudgedSimMs) {
                fail('FINISH_ORDER', 'horse ' + byJudged[i].horseIndex + ' finished before judged');
            }
        }

        // 3) 무원인 속도 변화 — 임계 이상 변화에 원인 마커가 붙어야 한다
        var markers = script.markers || [];
        for (i = 0; i < script.horses.length; i++) {
            var hh = script.horses[i];
            if (hh.runner === false) continue;
            var ss = hh.segments || [];
            for (j = 1; j < ss.length; j++) {
                var before = ss[j - 1].v1;
                var after = ss[j].v0;
                var ref = Math.max(Math.abs(before), 0.001);
                if (Math.abs(after - before) / ref < L.noCauseDeltaThreshold) continue;
                var tEdge = ss[j].t;
                var covered = markers.some(function (m) {
                    if (m.horse !== hh.horseIndex) return false;
                    var mEnd = m.t + (m.dur || 0);
                    return tEdge >= m.t - L.noCauseWindowMs && tEdge <= mEnd + L.noCauseWindowMs;
                });
                if (!covered) {
                    fail('NO_CAUSE_DELTA', 'horse ' + hh.horseIndex + ' at t=' + tEdge);
                }
            }
        }

        // 4) 슬로모 예산 — timeScale < 1 구간의 벽시계 총합
        var idx = wallIndex(script);
        var slowWall = 0;
        for (i = 0; i < idx.ts.length; i++) {
            var scale = idx.ts[i].scale || 1;
            if (scale >= 1) continue;
            var segEndT = (i + 1 < idx.ts.length) ? idx.ts[i + 1].t : simEnd;
            slowWall += (segEndT - idx.ts[i].t) / scale;
        }
        if (slowWall > L.slowMoBudgetWallMs) {
            fail('SLOWMO_BUDGET', Math.round(slowWall) + 'ms > ' + L.slowMoBudgetWallMs + 'ms');
        }

        // 5) L0 계약 — 경계 격차 상한 + 선두 교체 (독주 판은 면제)
        if (!script.soloShow && runners.length >= 2) {
            var leadChanges = 0;
            var prevLeader = null;
            var gapViolationMs = 0;
            var totalDist = script.finishLine - script.startPosition;

            for (var t = 0; t <= simEnd; t += L.sampleStepMs) {
                var st = standingsAt(script, t);
                if (!st.length) break;
                if (prevLeader !== null && st[0].horseIndex !== prevLeader) leadChanges++;
                prevLeader = st[0].horseIndex;

                var progress = (st[0].pos - script.startPosition) / totalDist;
                if (progress <= L.gapCapProgress) {
                    var b = stakeBoundaryAt(script, t);
                    if (b && b.gapPx > L.gapCapPx) gapViolationMs += L.sampleStepMs;
                }
            }
            if (leadChanges < L.minLeadChanges) {
                fail('L0_LEAD_CHANGE', 'leadChanges=' + leadChanges);
            }
            if (gapViolationMs > 0) {
                fail('L0_GAP_CAP', 'boundary gap over cap for ' + gapViolationMs + 'ms');
            }
        }

        // 6) 선언된 wallDurationMs 정합
        var wall = wallDuration(script);
        if (script.wallDurationMs != null && Math.abs(script.wallDurationMs - wall) > 1) {
            fail('WALL_DURATION', 'declared ' + script.wallDurationMs + ' vs computed ' + Math.round(wall));
        }

        return { ok: errors.length === 0, errors: errors, wallDurationMs: wall };
    }

    // ─── 저작 보조 ───────────────────────────────────────────────────

    /**
     * 속도 세그먼트 배열에 누적 위치 p를 채운다 (저작기가 v0/v1/t만 만들면 됨).
     * segments를 제자리에서 수정하고 최종 위치를 반환한다.
     */
    function fillCumulativePositions(segments, startPosition, simDurationMs) {
        var pos = startPosition;
        for (var i = 0; i < segments.length; i++) {
            segments[i].p = pos;
            var end = (i + 1 < segments.length) ? segments[i + 1].t : simDurationMs;
            var span = end - segments[i].t;
            pos += segments[i].v0 * span + (segments[i].v1 - segments[i].v0) * span / 2;
        }
        return pos;
    }

    /** 오른쪽 끝/왼쪽 끝이 결승선을 넘는 시각을 이분 탐색으로 구한다 */
    function solveFinishTimes(horse, finishLine, simDurationMs) {
        function crossTime(offsetPx) {
            var lo = 0, hi = simDurationMs;
            if (sampleHorsePosition(horse, hi, simDurationMs) + offsetPx < finishLine) return null;
            for (var k = 0; k < 40; k++) {
                var mid = (lo + hi) / 2;
                if (sampleHorsePosition(horse, mid, simDurationMs) + offsetPx >= finishLine) hi = mid;
                else lo = mid;
            }
            return hi;
        }
        return {
            finishJudgedSimMs: crossTime(horse.visualWidth || 60),
            finishSimMs: crossTime(0)
        };
    }

    return {
        FORMAT_VERSION: FORMAT_VERSION,
        DEFAULT_LIMITS: DEFAULT_LIMITS,
        // 샘플링
        sampleHorsePosition: sampleHorsePosition,
        sampleHorseSpeed: sampleHorseSpeed,
        standingsAt: standingsAt,
        stakeBoundaryAt: stakeBoundaryAt,
        finishStateOf: finishStateOf,
        // 시간
        simToWall: simToWall,
        wallToSim: wallToSim,
        timeScaleAt: timeScaleAt,
        wallDuration: wallDuration,
        // 마커
        activeStateMarkers: activeStateMarkers,
        eventMarkersBetween: eventMarkersBetween,
        diffStateMarkers: diffStateMarkers,
        // 검증 · 저작
        validate: validate,
        fillCumulativePositions: fillCumulativePositions,
        solveFinishTimes: solveFinishTimes
    };
});
