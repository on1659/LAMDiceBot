/**
 * QA — 경마 트랙 PiP(작은 창) 모드 버그픽스 검증
 *
 * 대상 수정 (2026-08-23):
 *   [1] 스케일 루트 폭 = 인페이지 자연폭 (창 폭 아님) — attach/detach 시 카메라 좌표계 보존
 *   [2] 루트 높이 변화(룰렛 배너 삽입) 시 ResizeObserver로 재fit — 창 하단 잘림 방지
 *   [3] 룰렛 tick을 PiP 창에 예약 (메인 탭 숨김 1초 스로틀 회피) + 창 전환 시 이관
 *   [4] PiP 카운트다운 tick도 PiP 창 예약 + 창 닫힘 시 잔존 검은 막 제거
 *   [5] horseRaceDataCleared 가 래퍼를 숨기기 전에 본 화면으로 복귀 (빈 창 + 버튼 소실 방지)
 *   [6] SoundManager 포커스 게이트 우회 등록 (창 클릭만으로 모든 신규 사운드가 죽던 문제)
 *   [7] doc-aware 조회 정리 (선택화면 레인 높이 / rankVote 섹션)
 *   [8] showToast(미정의) → showCustomAlert
 *
 * 헤드리스 한계: 실제 requestWindow는 사용자 제스처 + 크로뮴 창 UI 필요 → mock PiP 창을 주입한다
 * (qa-horse-track-pip-test.js와 같은 기법. 여기서는 ResizeObserver/setTimeout 스파이를 추가한 mock).
 *
 * Usage: node AutoTest/qa-horse-pip-bugfix-test.js [--headed] [--url=...]
 */

const { chromium } = require('playwright');
const path = require('path');
const { PORT } = require(path.join(__dirname, '..', 'config', 'index.js'));

const URL = process.argv.find(a => a.startsWith('--url='))?.split('=')[1] || `http://127.0.0.1:${PORT}`;
const HEADED = process.argv.includes('--headed');
const PAGE = `${URL}/horse-race-multiplayer.html?createRoom=true`;

const R = { pass: 0, fail: 0, errors: [] };
function pass(msg) { R.pass++; console.log(`  PASS ${msg}`); }
function fail(msg, det) { R.fail++; R.errors.push(msg + (det ? ` (${det})` : '')); console.log(`  FAIL ${msg}${det ? ' — ' + det : ''}`); }
function info(msg) { console.log(`  info ${msg}`); }
function section(t) { console.log(`\n${'-'.repeat(60)}\n ${t}\n${'-'.repeat(60)}`); }

async function loadPage(page, name) {
    await page.addInitScript(() => {
        try { localStorage.setItem('tutorialSeen_horse', 'v1'); } catch (e) {}
    });
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.evaluate(n => {
        localStorage.setItem('userName', n);
        localStorage.setItem('userAuth', JSON.stringify({ name: n }));
    }, name);
    await page.waitForFunction(() => typeof socket !== 'undefined' && socket.connected, { timeout: 15000 });
}

// 스파이 mock PiP 창 — 실제 창 대신 주입한다.
//  · setTimeout/clearTimeout: 호출 카운트를 남겨 "어느 창에 예약됐는가"를 관측 (수정 [3][4])
//  · ResizeObserver: observe 대상과 콜백을 노출해 수동 발화 가능 (수정 [2])
//  · scaleRoot는 일부러 안 만든다 — racePipAttachTrack의 방어 재생성 분기 폭 계산을 검증 (수정 [1])
const INJECT_MOCK = () => {
    const doc = document.implementation.createHTMLDocument('mock-pip');
    const stats = { setTimeout: 0, clearTimeout: 0, roCallbacks: [], roTargets: [] };
    window.__pipStats = stats;
    window.__mockPip = {
        closed: false,
        document: doc,
        innerWidth: 800,
        innerHeight: 600,
        close() { this.closed = true; },
        addEventListener() {},
        requestAnimationFrame: window.requestAnimationFrame.bind(window),
        cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
        setTimeout(fn, ms) { stats.setTimeout++; return window.setTimeout(fn, ms); },
        clearTimeout(id) { stats.clearTimeout++; return window.clearTimeout(id); },
        ResizeObserver: function (cb) {
            stats.roCallbacks.push(cb);
            return { observe(t) { stats.roTargets.push(t && t.id); }, disconnect() {} };
        }
    };
    window._racePipWin = window.__mockPip;
    return true;
};

async function run() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(` 경마 PiP(작은 창) 버그픽스 — QA 검증`);
    console.log(` 서버: ${URL} / 모드: ${HEADED ? 'headed' : 'headless'}`);
    console.log('='.repeat(60));

    const browser = await chromium.launch({ headless: !HEADED });
    const consoleErrors = [];

    try {
        const ctx = await browser.newContext();
        await ctx.route('**googlesyndication**', r => r.abort());
        await ctx.route('**doubleclick**', r => r.abort());
        const p = await ctx.newPage();
        p.on('pageerror', e => consoleErrors.push('[PAGEERR] ' + e.message));
        p.on('console', m => { if (m.type() === 'error') consoleErrors.push('[CON] ' + m.text()); });

        await loadPage(p, 'PipFixQA');

        // ════════════ A. 전역 배선 (수정 [3][6][8]) ════════════
        section('A. 전역 배선 — 새 헬퍼 노출 / 사운드 우회 등록 / showToast 제거');

        const a = await p.evaluate(() => ({
            hasClearTick: typeof clearRouletteTick === 'function',
            hasMigrate: typeof migrateRouletteTimer === 'function',
            hasTrackToast: typeof showTrackToast === 'function',
            hasSetFocusBypass: !!(window.SoundManager && typeof SoundManager.setFocusBypass === 'function'),
            // PiP 미attach → 우회는 false → 기존 포커스 정책 그대로여야 한다
            focusNow: window.SoundManager ? SoundManager.hasSoundFocus() : null,
            attached: racePipAttached(),
            rouletteWinInit: window.rouletteAnimWin === undefined ? 'undef' : String(window.rouletteAnimWin),
        }));
        a.hasClearTick ? pass('clearRouletteTick 정의') : fail('clearRouletteTick 미정의');
        a.hasMigrate ? pass('migrateRouletteTimer 정의') : fail('migrateRouletteTimer 미정의');
        a.hasTrackToast ? pass('showTrackToast 정의 (PiP 안 무음 실패 대체)') : fail('showTrackToast 미정의');
        a.hasSetFocusBypass ? pass('SoundManager.setFocusBypass API 존재') : fail('setFocusBypass 미노출');
        a.attached === false ? pass('초기 미attach') : fail('초기 attach 상태 이상');
        a.focusNow === true ? pass('PiP 미사용 시 포커스 게이트 기존 동작 (visible+focus → true)') : fail('포커스 게이트 회귀', String(a.focusNow));

        // showToast 잔존 여부 — 정의되지 않은 함수를 호출하던 자리가 남았는지 소스로 확인
        const srcHasShowToast = await p.evaluate(async () => {
            const t = await fetch('/js/horse-race.js').then(r => r.text());
            return /(^|[^.\w])showToast\s*\(/m.test(t);
        });
        srcHasShowToast === false ? pass('showToast 호출 잔존 0 (ReferenceError 무음 실패 제거)') : fail('showToast 호출 잔존');

        // ════════════ B. attach — 스케일 루트 폭 / ResizeObserver (수정 [1][2]) ════════════
        section('B. attach — 스케일 루트 자연폭 고정 + 루트 높이 변화 재fit');

        const b = await p.evaluate((injectSrc) => {
            // 선택 화면 트랙을 띄워 래퍼에 실폭이 잡히게 한다 (게임 섹션이 숨어 있으면 offsetWidth=0)
            const gs = document.getElementById('gameSection');
            if (gs) gs.style.display = 'block';
            availableHorses = [0, 1, 2, 3];
            renderTrackForSelection();
            const wrapper = document.getElementById('raceTrackWrapper');
            wrapper.style.display = 'block';
            const natW = wrapper.offsetWidth;
            const natTrackH = document.getElementById('raceTrackContainer').offsetHeight;

            eval('(' + injectSrc + ')()');   // mock 주입
            racePipAttachTrack();

            const root = window.__mockPip.document.getElementById('pipScaleRoot');
            return {
                natW,
                natTrackH,
                attached: racePipAttached(),
                rootWidth: root ? root.style.width : null,
                mockInnerW: window.__mockPip.innerWidth,
                roTargets: window.__pipStats.roTargets.slice(),
                roCount: window.__pipStats.roCallbacks.length,
                wrapperInPip: window.__mockPip.document.getElementById('raceTrackWrapper') !== null,
            };
        }, INJECT_MOCK.toString());

        info(`인페이지 자연폭=${b.natW}px / mock 창 폭=${b.mockInnerW}px / 스케일 루트 폭=${b.rootWidth}`);
        b.attached ? pass('mock 창으로 attach 성공') : fail('attach 실패');
        b.wrapperInPip ? pass('래퍼가 PiP 문서로 이동') : fail('래퍼 이동 실패');
        b.rootWidth === b.natW + 'px'
            ? pass(`스케일 루트 폭 = 인페이지 자연폭 (${b.natW}px) — 창 폭 아님`)
            : fail('스케일 루트 폭이 자연폭과 불일치', `${b.rootWidth} vs ${b.natW}px`);
        b.rootWidth !== (b.mockInnerW - 16) + 'px'
            ? pass('구 동작(창 폭-16) 미사용 확인 — attach/detach 간 trackWidth 보존')
            : fail('여전히 창 폭 기준');
        b.roCount === 1 && b.roTargets[0] === 'pipScaleRoot'
            ? pass('ResizeObserver가 #pipScaleRoot 1개 관측 (창당 1회)')
            : fail('ResizeObserver 등록 이상', `count=${b.roCount} targets=${JSON.stringify(b.roTargets)}`);

        // 루트 높이를 키운 뒤 observer 콜백 발화 → 재fit 되는지 (룰렛 배너 삽입 시나리오)
        const bs = await p.evaluate(() => {
            const root = window.__mockPip.document.getElementById('pipScaleRoot');
            const before = root.style.transform || '';
            // detached 문서는 레이아웃이 없어 offsetHeight=0 → racePipApplyScale의 분기만 관측한다.
            // 콜백이 실제로 racePipApplyScale을 부르는지 스파이로 확인.
            let called = 0;
            const orig = window.racePipApplyScale;
            window.racePipApplyScale = function () { called++; return orig.apply(this, arguments); };
            window.__pipStats.roCallbacks.forEach(cb => { try { cb([]); } catch (e) {} });
            window.racePipApplyScale = orig;
            return { before, called };
        });
        bs.called >= 1
            ? pass(`ResizeObserver 콜백 → racePipApplyScale 재호출 (${bs.called}회)`)
            : fail('ResizeObserver 콜백이 재fit을 안 부름');

        // ════════════ C. 룰렛 tick 창 예약 + 이관 (수정 [3]) ════════════
        section('C. 룰렛 tick — PiP 창 예약 / 창 전환 시 이관');

        const c1 = await p.evaluate(() => {
            window.__pipStats.setTimeout = 0;
            // 막대는 실제 투표가 있어야 그려진다 — 룰렛 순회 대상 확보
            userRankVotes = { A: 1, B: 2, C: 3, D: 4 };
            // 룰렛 시각화는 readyUsers/isRaceActive 무관하게 강제 표시된다
            moveResultUiToCanvas();                       // 투표 섹션을 PiP로 이식
            playRouletteAnimation({ winningRank: 2, animDurationMs: 4000, runningHorseCount: 4 });
            return {
                winIsPip: rouletteAnimWin === window.__mockPip,
                pending: rouletteAnimFrameId != null,
                pipSetTimeouts: window.__pipStats.setTimeout,
                hasReschedule: typeof _rouletteReschedule === 'function',
            };
        });
        c1.pending ? pass('룰렛 tick 진행 중 (예약 존재)') : fail('룰렛이 시작되지 않음');
        c1.winIsPip ? pass('룰렛 tick이 PiP 창에 예약됨 (숨김 탭 1초 스로틀 회피)') : fail('룰렛 tick이 여전히 메인 창 예약');
        c1.pipSetTimeouts > 0 ? pass(`mock 창 setTimeout 호출 ${c1.pipSetTimeouts}회`) : fail('mock 창에 예약 흔적 없음');
        c1.hasReschedule ? pass('_rouletteReschedule 통로 등록 (창 이관 가능)') : fail('_rouletteReschedule 미등록');

        // 창 닫기 → 메인으로 이관되고 tick이 이어져야 한다 (이관 없으면 룰렛이 영구 동결)
        const c2 = await p.evaluate(() => {
            const clearsBefore = window.__pipStats.clearTimeout;
            racePipReattach();               // 사용자 X / 토글과 같은 경로
            return {
                winIsMain: rouletteAnimWin === window,
                stillPending: rouletteAnimFrameId != null,
                pipClearCalled: window.__pipStats.clearTimeout > clearsBefore,
                attached: racePipAttached(),
                wrapperBackInMain: !!document.getElementById('raceTrackWrapper'),
            };
        });
        c2.attached === false ? pass('창 닫기 → 미attach') : fail('닫기 후에도 attach');
        c2.wrapperBackInMain ? pass('래퍼 메인 복귀') : fail('래퍼 복귀 실패');
        c2.pipClearCalled ? pass('예약했던 창(PiP)에서 취소 — 창별 id 오취소 방지') : fail('PiP 창에서 취소 안 함');
        c2.winIsMain ? pass('룰렛 tick 드라이버가 메인 창으로 이관') : fail('룰렛 드라이버 이관 실패');
        c2.stillPending ? pass('이관 후 tick 재예약됨 (룰렛 동결 없음)') : fail('이관 후 재예약 누락 — 룰렛이 얼어붙는다');

        await p.evaluate(() => { clearRouletteTick(); });

        // ════════════ D. 카운트다운 잔존 검은 막 제거 (수정 [4]) ════════════
        section('D. PiP 카운트다운 — 창 닫힘 시 검은 막 잔존 제거');

        const d = await p.evaluate((injectSrc) => {
            eval('(' + injectSrc + ')()');
            racePipAttachTrack();
            const container = raceDoc().getElementById('raceTrackContainer');
            showPipCountdown(container);
            const madeInPip = !!raceDoc().getElementById('countdownOverlay');
            const scheduledOnPip = window.__pipStats.setTimeout > 0;
            racePipReattach();               // 카운트다운 도중 창 닫기
            return {
                madeInPip,
                scheduledOnPip,
                leftoverInMain: !!document.querySelector('#raceTrackWrapper #countdownOverlay'),
            };
        }, INJECT_MOCK.toString());
        d.madeInPip ? pass('PiP 문서에 카운트다운 오버레이 렌더') : fail('PiP 카운트다운 렌더 실패');
        d.scheduledOnPip ? pass('카운트다운 tick이 PiP 창에 예약됨') : fail('카운트다운 tick이 메인 창 예약');
        d.leftoverInMain === false
            ? pass('창 닫기 후 검은 막 잔존 0 (복귀 시 정리)')
            : fail('복귀한 트랙 위에 불투명 검은 막이 영구 잔존');

        // ════════════ E. 데이터 삭제 시 빈 창 방지 (수정 [5]) ════════════
        section('E. 이전 게임 데이터 삭제 — 빈 창 + 되돌리기 버튼 소실 방지');

        const e = await p.evaluate((injectSrc) => {
            eval('(' + injectSrc + ')()');
            racePipAttachTrack();
            const before = racePipAttached();
            socket.emit('__noop_never');           // (no-op) 소켓 계약 무변경 확인용 자리
            // 서버 broadcast 대신 핸들러를 직접 발화 — 소켓 계약은 건드리지 않는다
            socket.emit === socket.emit;
            const listeners = socket._callbacks && socket._callbacks['$horseRaceDataCleared'];
            if (listeners && listeners.length) listeners.forEach(fn => fn({}));
            return {
                before,
                attachedAfter: racePipAttached(),
                wrapperInMain: !!document.getElementById('raceTrackWrapper'),
                wrapperHidden: (document.getElementById('raceTrackWrapper') || {}).style?.display === 'none',
                pipBtnReachable: !!document.getElementById('racePipBtn'),
                fired: !!(listeners && listeners.length),
            };
        }, INJECT_MOCK.toString());
        e.fired ? pass('horseRaceDataCleared 핸들러 발화') : fail('핸들러를 찾지 못함 (테스트 한계)');
        if (e.fired) {
            e.before ? pass('삭제 전 attach 상태') : fail('삭제 전 attach 실패');
            e.attachedAfter === false ? pass('삭제 시 자동 복귀 (빈 창 방지)') : fail('삭제 후에도 트랙이 PiP에 남음');
            e.wrapperInMain ? pass('래퍼 메인 복귀') : fail('래퍼 유실');
            e.wrapperHidden ? pass('복귀 후 래퍼 숨김 (기존 의도 유지)') : fail('래퍼가 숨겨지지 않음');
            e.pipBtnReachable ? pass('작은 창 토글 버튼이 메인에서 다시 조회 가능') : fail('토글 버튼 유실');
        }

        // ════════════ F. doc-aware 조회 (수정 [7]) ════════════
        section('F. doc-aware 조회 — 선택화면 레인 높이 / rankVote 섹션');

        const f = await p.evaluate((injectSrc) => {
            const wrapper = document.getElementById('raceTrackWrapper');
            wrapper.style.display = 'block';
            eval('(' + injectSrc + ')()');
            racePipAttachTrack();
            // attach 중이면 메인 문서에는 트랙 컨테이너가 없어야 한다 (구 코드가 null을 받던 조건)
            const mainHasContainer = !!document.getElementById('raceTrackContainer');
            const pipHasContainer = !!raceDoc().getElementById('raceTrackContainer');
            let threw = null;
            try { renderTrackForSelection(); } catch (err) { threw = String(err && err.message); }
            const lanes = raceDoc().querySelectorAll('#raceTrack .horse').length;
            // rankVote: 이식 상태에서 재렌더가 조기 return 하지 않아야 한다
            moveResultUiToCanvas();
            const voteInPip = !!raceDoc().getElementById('rankVoteSection');
            let voteThrew = null;
            try { renderRankVoteSection(); } catch (err) { voteThrew = String(err && err.message); }
            const boxes = (raceDoc().getElementById('rankVoteBoxes') || { children: [] }).children.length;
            racePipReattach();
            return { mainHasContainer, pipHasContainer, threw, lanes, voteInPip, voteThrew, boxes };
        }, INJECT_MOCK.toString());
        f.mainHasContainer === false && f.pipHasContainer
            ? pass('attach 중 메인 문서엔 트랙 컨테이너 부재 (구 버그 발생 조건 성립)')
            : fail('전제 미성립', `main=${f.mainHasContainer} pip=${f.pipHasContainer}`);
        f.threw === null ? pass('attach 상태에서 renderTrackForSelection 무예외') : fail('renderTrackForSelection 예외', f.threw);
        f.lanes > 0 ? pass(`선택화면 트랙이 PiP 문서에 렌더 (탈것 ${f.lanes}개)`) : fail('PiP 문서에 트랙 미렌더');
        f.voteInPip ? pass('rankVoteSection이 PiP로 이식됨') : fail('rankVote 이식 실패');
        f.voteThrew === null ? pass('이식 상태에서 renderRankVoteSection 무예외') : fail('renderRankVoteSection 예외', f.voteThrew);
        f.boxes > 0 ? pass(`이식 상태에서도 투표 막대 재생성 (${f.boxes}개) — 조기 return 없음`) : fail('이식 상태에서 조기 return (낡은 막대 잔존)');

        // ════════════ G. 사운드 우회 (수정 [6]) ════════════
        section('G. 사운드 — attach 중 포커스 게이트 우회 / 복귀 시 원복');

        const g = await p.evaluate((injectSrc) => {
            const SM = window.SoundManager;
            const before = SM.hasSoundFocus();
            eval('(' + injectSrc + ')()');
            racePipAttachTrack();
            const duringAttach = SM.hasSoundFocus();
            const bypassActive = racePipAttached();
            racePipReattach();
            const after = SM.hasSoundFocus();
            return { before, duringAttach, bypassActive, after };
        }, INJECT_MOCK.toString());
        g.bypassActive ? pass('attach 상태에서 우회 판정 true') : fail('attach 판정 실패');
        g.duringAttach === true ? pass('attach 중 hasSoundFocus() 통과 (창 클릭/탭 숨김에도 사운드 유지)') : fail('attach 중에도 게이트 차단');
        g.after === g.before ? pass('복귀 후 기존 포커스 정책 원복') : fail('복귀 후 정책 미원복', `${g.before} → ${g.after}`);

        // ════════════ H. 순위 발표 요약 + 유령 스케일 (수정 [9][10]) ════════════
        section('H. 작은 창 결과 요약 / 유령(👻) 크기 보정');

        const h = await p.evaluate((injectSrc) => {
            eval('(' + injectSrc + ')()');
            racePipAttachTrack();
            racePipApplyScale();
            const k = window._racePipScaleK;

            // 결과 요약 — 유저 입력 이스케이프 확인용으로 태그 문자열을 이름에 섞는다
            showPipResultBanner(3, ['홍길동', '<img src=x onerror=alert(1)>']);
            const doc = raceDoc();
            const banner = doc.getElementById('pipResultBanner');
            const out = {
                k,
                inPip: !!banner,
                inMain: !!document.getElementById('pipResultBanner'),
                text: banner ? banner.textContent : '',
                injectedNodes: banner ? banner.querySelectorAll('img,script').length : -1,
                hasTarget: banner ? banner.textContent.includes('3등을 찾아라') : false,
            };

            // 유령 크기 보정 — PiP body 직속 fixed 오버레이라 루트 transform을 못 받는다
            const track = doc.getElementById('raceTrack');
            const fake = doc.createElement('div');
            fake.className = 'horse';
            fake.style.cssText = 'position:absolute;left:10px;top:10px;width:60px;height:45px;';
            if (track) track.appendChild(fake);
            try {
                showDeathAnimation(fake, 99, 5, function () {});
                const soul = doc.querySelector('.death-effect.soul-only');
                out.soulExists = !!soul;
                out.soulScale = soul ? (soul.style.scale || '') : null;
                out.soulOrigin = soul ? (soul.style.transformOrigin || '') : null;
            } catch (e) {
                out.soulThrew = String(e && e.message);
            }

            // 정리 훅 — 선택 화면 렌더가 지난 판 요약을 지우는가
            availableHorses = [0, 1, 2];
            renderTrackForSelection();
            out.clearedBySelection = !raceDoc().getElementById('pipResultBanner');

            // 창 닫기 시 메인으로 딸려오지 않는가
            showPipResultBanner(1, ['A']);
            racePipReattach();
            out.notCarriedToMain = !document.getElementById('pipResultBanner');
            return out;
        }, INJECT_MOCK.toString());

        info(`fit 배율 k=${h.k}`);
        h.inPip ? pass('결과 요약이 PiP 문서에 렌더') : fail('결과 요약 미렌더');
        h.inMain === false ? pass('메인 문서엔 미생성 (기존 #resultOverlay와 중복 아님)') : fail('메인에 중복 생성');
        h.hasTarget ? pass('타깃 등수 표기 ("3등을 찾아라!")') : fail('타깃 등수 표기 누락');
        h.injectedNodes === 0
            ? pass('당첨자 이름 이스케이프 — 태그 주입 0개 (escapeHtmlText 경유)')
            : fail('XSS: 이름에서 태그가 생성됨', String(h.injectedNodes));
        h.text.includes('<img src=x onerror=alert(1)>')
            ? pass('이름이 텍스트로 그대로 표시됨')
            : fail('이름 표시 이상', h.text.slice(0, 80));
        if (h.soulThrew) {
            fail('showDeathAnimation 예외', h.soulThrew);
        } else {
            h.soulExists ? pass('유령(👻) 오버레이 생성') : fail('유령 미생성');
            h.soulScale === String(h.k)
                ? pass(`유령에 fit 배율 적용 (scale=${h.soulScale}) — 트랙/비석과 비율 일치`)
                : fail('유령 배율 미적용', `scale="${h.soulScale}" vs k=${h.k}`);
            // 브라우저가 'top center' → 'center top'으로 정규화한다
            /^(top center|center top)$/.test(h.soulOrigin)
                ? pass(`유령 transform-origin 상단 중앙 (${h.soulOrigin})`)
                : fail('origin 이상', h.soulOrigin);
        }
        h.clearedBySelection ? pass('다음 라운드 선택 렌더 시 요약 자동 정리') : fail('지난 판 요약 잔존');
        h.notCarriedToMain ? pass('창 닫기 시 요약이 메인으로 딸려오지 않음') : fail('요약이 메인 트랙에 잔존');

        // ════════════ 에러 집계 ════════════
        section('콘솔/페이지 에러 집계');
        const noise = /adsbygoogle|TagError|Failed to load resource|net::ERR|^\[CON\] Y$/i;
        const real = consoleErrors.filter(e => !noise.test(e));
        real.length === 0
            ? pass(`JS 에러 0건 (네트워크/광고 잡음 ${consoleErrors.length - real.length}건 제외)`)
            : fail(`JS 에러 ${real.length}건`, real.slice(0, 5).join(' | '));

        await ctx.close();
    } catch (err) {
        fail('테스트 실행 중 예외', err && err.message);
        console.error(err);
    } finally {
        await browser.close();
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(` 결과: PASS ${R.pass} / FAIL ${R.fail}`);
    if (R.errors.length) R.errors.forEach(e => console.log('  · ' + e));
    console.log('='.repeat(60));
    process.exit(R.fail ? 1 : 0);
}

run();
