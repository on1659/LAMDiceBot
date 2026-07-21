// QA — ranking-popup-vehicle-stats (docs/goal/ranking-popup-vehicle-stats.md)
//   랭킹 오버레이 PC 카드화 + 경마 탭 탈것 통계 통합 + 구 탈것 통계 모달 제거 검증.
//   실행: PORT 3177 에 새 서버가 떠 있어야 함 → node AutoTest/qa-ranking-popup-card-test.js
//   공정성: 결과 경로 미접근 — 표시/닫기/소켓 계약만 단언.
//   lessons: C-29(hide 후 1초+ 안착 대기), C-28(tutorialSeen_horse + blocker 부재 단언), C-24(자동 ready).
const { chromium } = require('playwright');

const BASE = 'http://localhost:3177';
const SETTLE = 1300; // C-29: hide 애니메이션(250ms) + 여유

let passCount = 0, failCount = 0;
const failures = [];
function check(cond, label, extra) {
  const line = (cond ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : '');
  console.log(line);
  if (cond) passCount++; else { failCount++; failures.push(label + (extra ? ' [' + extra + ']' : '')); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 페이지별 에러 수집 (favicon/사운드/광고 등 무관 404는 필터)
// TagError = AdSense(adsbygoogle) 로컬 환경 노이즈 — 이번 변경과 무관 (실서버 광고 슬롯 없음)
function attachErrorCollectors(page, store) {
  page.on('pageerror', e => {
    const s = String(e);
    if (/TagError/.test(s)) return;
    store.push('pageerror: ' + s);
  });
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (/favicon|adsbygoogle|googlesyndication|net::ERR_|404.*(mp3|png|ico)|Failed to load resource|Content Security Policy|frame-ancestors/i.test(t)) return;
    store.push('console.error: ' + t);
  });
}

async function overlayGone(page) {
  return page.evaluate(() => !document.getElementById('ranking-overlay'));
}

// 진입 대기 — 로컬 환경에서 connect 직후 ~40ms transport close 플레이크가 있어
// (구 서버 코드에서도 재현 — 이번 변경과 무관, 사전 존재) 실패 UI가 뜨면 [다시 시도] 1~2회 경유.
// 이는 실사용자 복구 경로 그대로를 태우는 것.
async function waitEntry(page, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await Promise.race([
      page.waitForSelector('#rankingBtn', { state: 'attached', timeout: 14000 }).then(() => 'ok'),
      page.waitForSelector('#entryRetryBtn', { timeout: 14000 }).then(() => 'fail-ui')
    ]).catch(() => 'timeout');
    if (result === 'ok') return true;
    if (result === 'fail-ui') {
      console.log('INFO: ' + label + ' 진입 워치독 실패 UI → [다시 시도] 클릭 (환경 플레이크, 재시도 ' + (attempt + 1) + ')');
      await page.click('#entryRetryBtn');
      await sleep(500);
      continue;
    }
    return false;
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();

  // ═══════════ Part 1. 경마 페이지 — 방 생성 + 카드/테이블/닫기/소켓 ═══════════
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctxA.addInitScript(() => {
    localStorage.setItem('tutorialSeen_horse', 'v1'); // C-28: 정확한 키
    localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
      userName: 'QA호스트', roomName: 'QA랭킹방', isPrivate: false, password: '',
      expiryHours: 1, blockIPPerUser: false
    }));
    // 소켓 계측 — emit/수신 이벤트명 기록 (진입 실패 진단용)
    let _realIo;
    Object.defineProperty(window, 'io', {
      configurable: true,
      set(v) { _realIo = v; },
      get() {
        if (!_realIo) return _realIo;
        return function () {
          const s = _realIo.apply(this, arguments);
          window.__qaSocket = s;
          const oe = s.emit.bind(s);
          s.emit = function (ev) { (window.__emits = window.__emits || []).push(ev); return oe.apply(null, arguments); };
          if (s.onAny) s.onAny(ev => (window.__recv = window.__recv || []).push(ev));
          return s;
        };
      }
    });
  });
  const pageA = await ctxA.newPage();
  const errsA = [];
  attachErrorCollectors(pageA, errsA);

  try {
    await pageA.goto(BASE + '/horse-race?createRoom=true', { waitUntil: 'domcontentloaded', timeout: 20000 });
    // roomCreated 후 URL 이 /free/horse/{code} 로 replaceState 됨 — 존재(attached) 기준으로 대기
    const entered = await waitEntry(pageA, '호스트');
    if (!entered) throw new Error('경마 방 생성 실패 (재시도 포함)');
    check(true, '[1전제] 경마 방 생성 성공 (roomCreated → #rankingBtn 주입)');

    // C-28: 튜토리얼 blocker 가 실클릭을 막지 않는지
    const blockerVisible = await pageA.evaluate(() => {
      const b = document.querySelector('.tutorial-click-blocker');
      return !!(b && getComputedStyle(b).display !== 'none');
    });
    check(!blockerVisible, '[C-28] 튜토리얼 click-blocker 비활성');

    // ── 항목 6: 버튼/모달 제거 ──
    const removal = await pageA.evaluate(() => ({
      btn: !!document.querySelector('.vehicle-stats-open-btn'),
      overlay: !!document.getElementById('vehicleStatsOverlay'),
      fnOpen: typeof window.openVehicleStatsModal,
      fnClose: typeof window.closeVehicleStatsModal,
      fnRender: typeof window.renderVehicleStatsTable
    }));
    check(!removal.btn, '[6] .vehicle-stats-open-btn 부재');
    check(!removal.overlay, '[6] #vehicleStatsOverlay 부재');
    check(removal.fnOpen === 'undefined' && removal.fnClose === 'undefined' && removal.fnRender === 'undefined',
      '[6] 모달 함수 3종 undefined', JSON.stringify(removal));

    // ── 항목 1: PC 카드 ──
    // 실클릭 시도 → 뷰포트 밖/가림이면 JS click 폴백 (리스너는 addEventListener라 동일 경로)
    const btnBox = await pageA.locator('#rankingBtn').boundingBox().catch(() => null);
    if (btnBox) await pageA.click('#rankingBtn');
    else await pageA.evaluate(() => document.getElementById('rankingBtn').click());
    await pageA.waitForSelector('#ranking-overlay .rk-panel', { timeout: 8000 });
    await pageA.waitForSelector('.rk-vehicle-table', { timeout: 8000 }); // show('horse') → 경마 탭 즉시
    await sleep(700); // 테마 재렌더 안착

    const pc = await pageA.evaluate(() => {
      const ov = document.getElementById('ranking-overlay');
      const panel = ov.querySelector('.rk-panel');
      const ovCS = getComputedStyle(ov);
      const pCS = getComputedStyle(panel);
      const pr = panel.getBoundingClientRect();
      return {
        parentIsBody: ov.parentElement === document.body,
        bg: ovCS.backgroundColor,
        panelW: pr.width, panelH: pr.height,
        radius: pCS.borderRadius,
        visible: ov.classList.contains('rk-visible')
      };
    });
    check(pc.parentIsBody, '[1] #ranking-overlay 가 body 직속');
    check(pc.bg === 'rgba(0, 0, 0, 0.8)', '[1] 백드롭 rgba(0,0,0,0.8)', pc.bg);
    check(pc.panelW <= 640, '[1] 카드 폭 ≤ 640px', String(pc.panelW));
    check(pc.panelH < 800 * 0.86, '[1] 카드 높이 < 85vh (풀스크린 아님)', String(pc.panelH));
    check(pc.radius === '20px', '[1] 카드 border-radius 20px', pc.radius);
    check(pc.visible, '[1] rk-visible (표시 완료)');

    // ── 항목 5: 경마 탭 통합 테이블 (실데이터) ──
    const tbl = await pageA.evaluate(() => {
      const content = document.getElementById('ranking-content');
      const html = content.innerHTML;
      const scroll = content.querySelector('.rk-table-scroll');
      const table = content.querySelector('.rk-vehicle-table');
      const ths = table ? Array.from(table.querySelectorAll('thead th')).map(t => t.textContent.trim()) : [];
      const rows = table ? Array.from(table.querySelectorAll('tbody tr')).map(tr => {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
        return { label: tds[0], app: parseInt(tds[1], 10), pick: tds[2], win: parseInt(tds[3], 10), low: tr.classList.contains('rk-low-sample') };
      }) : [];
      return {
        hasNewTitle: html.includes('탈것 통계'),
        hasOldTitle: html.includes('탈것 등수 분포'),
        scrollWrapsTable: !!(scroll && scroll.contains(table)),
        ths, rows
      };
    });
    check(tbl.hasNewTitle, '[5] "탈것 통계" 섹션 제목 존재');
    check(!tbl.hasOldTitle, '[5] 구 "탈것 등수 분포" 제목 부재');
    check(tbl.scrollWrapsTable, '[5] .rk-table-scroll 이 테이블 래핑');
    check(tbl.ths.length === 10, '[5] 컬럼 10개 (탈것/출전/선택률/승률/1~6등)', tbl.ths.join('|'));
    check(tbl.ths[1] === '출전' && tbl.ths[2] === '선택률' && tbl.ths[3] === '승률', '[5] 신규 컬럼 헤더 순서', tbl.ths.slice(0, 4).join('|'));
    check(tbl.rows.length > 0, '[5] 데이터 행 존재', String(tbl.rows.length));
    let sorted = true;
    for (let i = 1; i < tbl.rows.length; i++) {
      if (tbl.rows[i].win > tbl.rows[i - 1].win) { sorted = false; break; }
    }
    check(sorted, '[5] 승률 내림차순 정렬 (서버 rank_1 순서 재정렬 확인)',
      tbl.rows.slice(0, 3).map(r => r.label + '=' + r.win + '%').join(', '));
    const anyLowMislabel = tbl.rows.some(r => (r.app >= 5) === /기록 부족/.test(r.label + r.win));
    check(tbl.rows.every(r => (r.app < 5) === r.low), '[5] 기록 부족(출전<5) 판정 일치', 'lowRows=' + tbl.rows.filter(r => r.low).length);
    check(tbl.rows.every(r => /%$/.test(r.pick)), '[5] 선택률 % 표기', tbl.rows[0] && tbl.rows[0].pick);

    // ── 항목 2: 백드롭 닫기 / 카드 내부 클릭 / 드래그 아웃 ──
    // 카드 내부 클릭 → 안 닫힘
    const headerBox = await pageA.locator('#ranking-overlay .rk-header-title').boundingBox();
    await pageA.mouse.click(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
    await sleep(500);
    check(!(await overlayGone(pageA)), '[2] 카드 내부 클릭 → 안 닫힘');

    // 드래그 아웃 (카드 안 mousedown → 백드롭 mouseup) → 안 닫힘
    await pageA.mouse.move(headerBox.x + 10, headerBox.y + 5);
    await pageA.mouse.down();
    await pageA.mouse.move(30, 400, { steps: 5 });
    await pageA.mouse.up();
    await sleep(500);
    check(!(await overlayGone(pageA)), '[2] 카드 내부→백드롭 드래그 아웃 → 안 닫힘');

    // 백드롭 클릭 → 닫힘
    await pageA.mouse.click(30, 400);
    await sleep(SETTLE);
    check(await overlayGone(pageA), '[2] 백드롭 클릭 → 닫힘');

    // ── 항목 3: 백드롭 더블클릭 안전 ──
    const urlBeforeDbl = await pageA.evaluate(() => location.pathname);
    await pageA.evaluate(() => { window.__qaAlive = true; RankingModule.show('horse'); });
    await pageA.waitForSelector('#ranking-overlay .rk-panel', { timeout: 8000 });
    await sleep(800);
    await pageA.mouse.dblclick(30, 400);
    await sleep(SETTLE);
    const afterDbl = await pageA.evaluate(() => ({
      gone: !document.getElementById('ranking-overlay'),
      alive: window.__qaAlive === true,
      url: location.pathname,
      inRoom: !!(document.getElementById('gameSection') && document.getElementById('gameSection').classList.contains('active'))
    }));
    check(afterDbl.gone, '[3] 더블클릭 → 1회만 닫힘 (오버레이 제거)');
    check(afterDbl.alive, '[3] 더블클릭 → 페이지 이탈/리로드 없음');
    check(afterDbl.url === urlBeforeDbl, '[3] URL 유지', afterDbl.url + ' vs ' + urlBeforeDbl);
    check(afterDbl.inRoom, '[3] 방 상태 유지 (gameSection active)');

    // ── AC-2b: 닫은 직후 250ms 안 재오픈 → 새 오버레이가 지워지지 않음 ──
    await pageA.evaluate(() => RankingModule.show('horse'));
    await sleep(600);
    await pageA.evaluate(() => RankingModule.hide());
    await sleep(100); // 250ms 타이머 안에 재오픈
    await pageA.evaluate(() => RankingModule.show('horse'));
    await sleep(700); // 구 타이머(250ms) 경과 후에도 새 오버레이 생존해야 함
    const rapid = await pageA.evaluate(() => {
      const ov = document.getElementById('ranking-overlay');
      return { exists: !!ov, visible: !!(ov && ov.classList.contains('rk-visible')) };
    });
    check(rapid.exists && rapid.visible, '[2b] 250ms 내 재오픈 → 새 오버레이 생존', JSON.stringify(rapid));
    await sleep(500);

    // ── 항목 4 + 리사이즈 라이브 전환: PC 카드 ↔ 모바일 풀스크린 ──
    await pageA.setViewportSize({ width: 375, height: 812 });
    await sleep(500);
    const mob = await pageA.evaluate(() => {
      const panel = document.querySelector('#ranking-overlay .rk-panel');
      const r = panel.getBoundingClientRect();
      return { w: r.width, h: r.height, radius: getComputedStyle(panel).borderRadius };
    });
    check(Math.round(mob.w) === 375 && Math.round(mob.h) === 812, '[4] 모바일 375x812 → 풀스크린 커버', JSON.stringify(mob));
    check(mob.radius === '0px', '[4] 모바일 border-radius 없음', mob.radius);
    await pageA.setViewportSize({ width: 1280, height: 800 });
    await sleep(500);
    const backToPc = await pageA.evaluate(() => {
      const panel = document.querySelector('#ranking-overlay .rk-panel');
      return panel.getBoundingClientRect().width;
    });
    check(backToPc <= 640, '[4] 라이브 리사이즈 복귀 → 다시 카드', String(backToPc));
    await pageA.evaluate(() => RankingModule.hide());
    await sleep(SETTLE);

    // ── 항목 7: socket 계약 ──
    const ackTest = await pageA.evaluate(() => new Promise(resolve => {
      let answered = false;
      window.socket && window.socket.emit('horse:requestVehicleStats', {}, () => { answered = true; });
      setTimeout(() => resolve({ answered, connected: !!(window.socket && window.socket.connected) }), 2500);
    }));
    check(ackTest.connected, '[7] 소켓 연결 유지');
    check(!ackTest.answered, '[7] horse:requestVehicleStats ack 미응답 (핸들러 제거 확인)');

    // ── 항목 7b: 2탭 → 게임 시작 → horseSelectionReady 에 vehicleStats 포함 ──
    const roomId = await pageA.evaluate(() => window.currentRoomId);
    check(!!roomId, '[7b전제] roomId 확보', String(roomId));
    if (roomId) {
      const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctxB.addInitScript((rid) => {
        localStorage.setItem('tutorialSeen_horse', 'v1');
        localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({ roomId: rid, userName: 'QA게스트', isPrivate: false }));
      }, roomId);
      const pageB = await ctxB.newPage();
      const errsB = [];
      attachErrorCollectors(pageB, errsB);
      await pageB.goto(BASE + '/horse-race?joinRoom=true', { waitUntil: 'domcontentloaded', timeout: 20000 });
      const joined = await waitEntry(pageB, '게스트');
      check(joined, '[7b전제] 2번 탭 방 입장 성공');

      // C-24: 생성/입장 자동 ready. 경마 방은 입장 시점에 서버가 horseSelectionReady 를 보내고
      // (서버 로그: "[새 사용자 입장] ...horseSelectionReady 전송"), 클라 핸들러가
      // vehicleStatsData = data.vehicleStats || [] 로 저장한다 (js/horse-race.js:5659).
      // → 게스트 페이지의 vehicleStatsData 가 배열이면 vehicleStats 필드 E2E 생존 증명.
      await pageB.waitForFunction(() => Array.isArray(window.vehicleStatsData), null, { timeout: 8000 }).catch(() => {});
      const sel = await pageB.evaluate(() => ({
        isArray: Array.isArray(window.vehicleStatsData),
        len: Array.isArray(window.vehicleStatsData) ? window.vehicleStatsData.length : -1,
        sample: Array.isArray(window.vehicleStatsData) && window.vehicleStatsData[0] ? Object.keys(window.vehicleStatsData[0]).join(',') : null
      }));
      check(sel.isArray, '[7b] 입장 시 horseSelectionReady.vehicleStats → 클라 vehicleStatsData 저장 (추천 배지 경로 생존)', JSON.stringify(sel));
      check(errsB.length === 0, '[9] 2번 탭 콘솔/페이지 에러 0', errsB.slice(0, 3).join(' | '));
      await ctxB.close();
    }

    check(errsA.length === 0, '[9] 경마 페이지 콘솔/페이지 에러 0', errsA.slice(0, 3).join(' | '));
  } catch (e) {
    check(false, 'Part 1 예외', String(e).slice(0, 300));
  }
  await ctxA.close();

  // ═══════════ Part 2. dice 로비 스팟체크 (PC 카드 + history.back 닫기) ═══════════
  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageD = await ctxD.newPage();
  const errsD = [];
  attachErrorCollectors(pageD, errsD);
  try {
    await pageD.goto(BASE + '/game', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await pageD.waitForFunction(() => typeof RankingModule !== 'undefined', null, { timeout: 10000 });
    // 로그인 후 로비 상태 시뮬레이션 — 실사용 로비는 replacePage('lobby') 상태에서 랭킹을 연다.
    // (미로그인 state=null 이면 back 타깃이 serverSelect 로 해석돼 reload — 이 변경과 무관한 기존 흐름)
    await pageD.evaluate(() => { history.replaceState({ page: 'lobby' }, ''); window.__qaAlive = true; RankingModule.show(); });
    await pageD.waitForSelector('#ranking-overlay .rk-panel', { timeout: 8000 });
    await sleep(800);
    const dicePc = await pageD.evaluate(() => {
      const ov = document.getElementById('ranking-overlay');
      const panel = ov.querySelector('.rk-panel');
      return {
        w: panel.getBoundingClientRect().width,
        radius: getComputedStyle(panel).borderRadius,
        histIsRanking: !!(history.state && history.state.page === 'ranking')
      };
    });
    check(dicePc.w <= 640 && dicePc.radius === '20px', '[8] dice 로비 PC 카드 표시', JSON.stringify(dicePc));
    check(dicePc.histIsRanking, '[8] dice: history.state.page === ranking (PageHistoryManager 경로)', String(dicePc.histIsRanking));

    // history.back 으로 닫힘 (dice 전용 AC)
    await pageD.evaluate(() => history.back());
    await sleep(SETTLE);
    const afterBack = await pageD.evaluate(() => ({
      gone: !document.getElementById('ranking-overlay'),
      alive: window.__qaAlive === true,
      url: location.pathname
    }));
    check(afterBack.gone, '[8] dice: history.back → 오버레이 닫힘');
    check(afterBack.alive && afterBack.url === '/game', '[8] dice: 페이지 이탈 없음', JSON.stringify(afterBack));

    // 백드롭 더블클릭 → 1회만 back (이중 back 이면 페이지 이탈/리로드)
    // 미로그인 로비의 서버선택 오버레이(z-index 10000+)가 랭킹(9999) 위에서 클릭을 삼킴 —
    // 실사용(로그인 후)에는 없는 요소이므로 숨김 처리 후 백드롭 클릭 검증
    await pageD.evaluate(() => {
      document.querySelectorAll('body > *').forEach(el => {
        if (el.id === 'ranking-overlay') return;
        const z = parseInt(getComputedStyle(el).zIndex, 10);
        if (!isNaN(z) && z >= 10000) el.style.display = 'none';
      });
      RankingModule.show();
    });
    await pageD.waitForSelector('#ranking-overlay .rk-panel', { timeout: 8000 });
    await sleep(800);
    const atPoint = await pageD.evaluate(() => {
      const el = document.elementFromPoint(30, 400);
      return el ? (el.id || el.className || el.tagName) : 'none';
    });
    check(atPoint === 'ranking-overlay', '[8] dice: (30,400) 최상위가 랭킹 백드롭', String(atPoint));
    await pageD.mouse.dblclick(30, 400);
    await sleep(SETTLE);
    const diceDbl = await pageD.evaluate(() => ({
      gone: !document.getElementById('ranking-overlay'),
      alive: window.__qaAlive === true,
      url: location.pathname,
      histRanking: !!(history.state && history.state.page === 'ranking')
    }));
    check(diceDbl.gone && diceDbl.alive && diceDbl.url === '/game', '[8] dice: 백드롭 더블클릭 → 1회만 닫힘/이탈 없음', JSON.stringify(diceDbl));
    check(!diceDbl.histRanking, '[8] dice: 더블클릭 후 history 정합 (ranking 상태 해소)');
    check(errsD.length === 0, '[9] dice 로비 콘솔/페이지 에러 0', errsD.slice(0, 3).join(' | '));
  } catch (e) {
    check(false, 'Part 2 예외', String(e).slice(0, 300));
  }
  await ctxD.close();

  // ═══════════ Part 3. renderHorse 분기 (fetch 스텁 — ladder 페이지에서 모듈 재사용) ═══════════
  async function stubbedHorseRender(stubPayload, label, assertFn) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    attachErrorCollectors(page, errs);
    try {
      await page.goto(BASE + '/ladder?createRoom=true', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForFunction(() => typeof RankingModule !== 'undefined', null, { timeout: 10000 });
      await page.evaluate((stub) => {
        const origFetch = window.fetch;
        window.fetch = function (url, opts) {
          if (typeof url === 'string' && url.startsWith('/api/ranking/free') && !url.includes('search')) {
            return Promise.resolve(new Response(JSON.stringify(stub), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return origFetch.apply(this, arguments);
        };
        RankingModule.show('horse');
      }, stubPayload);
      await page.waitForSelector('#ranking-overlay', { timeout: 8000 });
      await sleep(1000);
      const result = await page.evaluate(() => document.getElementById('ranking-content') ? document.getElementById('ranking-content').innerHTML : '');
      assertFn(result, errs);
    } catch (e) {
      check(false, label + ' 예외', String(e).slice(0, 200));
    }
    await ctx.close();
  }

  const baseStub = {
    serverType: 'public',
    overall: { mostPlayed: [], mostWins: [], winRate: [], avgRank: [] },
    dice: { winners: [], players: [] }, roulette: { winners: [], players: [] },
    ladder: { winners: [], players: [] }, 'spin-arena': { winners: [], players: [] },
    pirate: { winners: [], players: [] }, orders: null
  };

  // 3-1. 저표본(출전<5) → 기록 부족 라벨 + 딤 처리
  await stubbedHorseRender(
    Object.assign({}, baseStub, { horseRace: { winners: [], vehicles: [
      { id: 'car', appearances: 3, picks: 2, ranks: [1, 0, 1, 0, 1, 0] },
      { id: 'rocket', appearances: 20, picks: 15, ranks: [10, 3, 3, 2, 1, 1] }
    ] } }),
    '[5b] 저표본',
    (html, errs) => {
      check(html.includes('기록 부족'), '[5b] 출전<5 → "기록 부족" 라벨');
      check(html.includes('rk-low-sample'), '[5b] 저표본 행 딤 클래스');
      check(errs.length === 0, '[5b] 저표본 렌더 에러 0', errs.slice(0, 2).join(' | '));
    }
  );

  // 3-2. vehicles 빈 배열 → 테이블 없이 우아한 렌더 (DB-less 트레이드오프 수용 확인)
  await stubbedHorseRender(
    Object.assign({}, baseStub, { horseRace: { winners: [], vehicles: [] } }),
    '[5c] 빈 vehicles',
    (html, errs) => {
      check(!html.includes('rk-vehicle-table'), '[5c] 빈 vehicles → 테이블 미표시');
      check(errs.length === 0, '[5c] 빈 vehicles 렌더 에러 0', errs.slice(0, 2).join(' | '));
    }
  );

  // 3-3. horseRace 필드 자체 부재 (시즌 뷰 payload) → TypeError 없이 빈 안내
  await stubbedHorseRender(
    baseStub,
    '[5d] horseRace 부재',
    (html, errs) => {
      check(html.includes('아직 경마 기록이 없습니다'), '[5d] horseRace 부재 → 빈 안내 (if(!d) 가드)');
      check(errs.length === 0, '[5d] horseRace 부재 렌더 에러 0 (TypeError 가드)', errs.slice(0, 2).join(' | '));
    }
  );

  await browser.close();

  console.log('\n===== 결과: PASS ' + passCount + ' / FAIL ' + failCount + ' =====');
  if (failures.length) { console.log('실패 목록:'); failures.forEach(f => console.log(' - ' + f)); }
  process.exit(failCount > 0 ? 1 : 0);
})().catch(e => { console.error('테스트 러너 예외:', e); process.exit(2); });
