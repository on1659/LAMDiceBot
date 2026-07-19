// QA 렌더 테스트 — horse-cosmetic-apply-fixes (finish_fx 개인화 / trail 강화 / accessory 탈것별 앵커)
//   실서버(5173)의 horse-race-multiplayer.html 을 Playwright 로 로드해 실제 CSS 와 함께 검증.
//   공정성: 결과 경로 미접근 — 이 테스트는 순수 외형 렌더만 단언(HorseShop.applyEquippedToHorse / playFinishFx).
//   실행: node AutoTest/qa-horse-cosmetic-apply-test.js   (서버가 5173 에서 떠 있어야 함)
const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';
const VEHICLES = ['car', 'rocket', 'bird', 'rabbit', 'helicopter', 'horse', 'crab', 'knight'];

(async () => {
  let pass = true;
  const check = (cond, label, extra) => {
    console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra ? '  [' + extra + ']' : ''));
    if (!cond) pass = false;
  };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  try {
    // 환경 고정: OS/CI 가 prefers-reduced-motion: reduce 를 강제하면 js/horse-shop.js 의
    // reducedMotion 가드(registerAfterimage no-op)로 B8 실루엣 스폰이 전부 막힌다.
    // 이 가드는 스크립트 로드 시점 1회 matchMedia 평가 → 반드시 goto "이전"에 걸어야 효력.
    // (Playwright 는 puppeteer 의 emulateMediaFeatures 가 아니라 emulateMedia 를 쓴다.)
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // 진입 IIFE(C-5): 파라미터 없으면 /game redirect. ?createRoom=true → fromDice=true 라
    // 두 redirect 분기를 모두 건너뛰고 페이지가 유지된다. createRoom emit 은 무응답이어도 무방
    // (HorseShop 정의·카탈로그 로드는 socket 응답과 무관 — cosmetic 렌더 테스트엔 충분).
    await page.goto(BASE + '/horse-race-multiplayer.html?createRoom=true', { waitUntil: 'domcontentloaded', timeout: 20000 });

    // HorseShop 공개 API + 카탈로그 로드 대기
    await page.waitForFunction(() => !!(window.HorseShop && window.HorseShop.loadCatalog), null, { timeout: 15000 });
    await page.evaluate(() => window.HorseShop.loadCatalog());
    await page.waitForFunction(() => !!(window.HorseShop.getCatalogItem('acc_crown')), null, { timeout: 10000 });

    check(true, '페이지 로드 + HorseShop 공개 API + 카탈로그 준비');

    // ── 테스트 하니스: #raceTrackContainer 안에 합성 .horse(.vehicle-sprite + data-vehicle-id) 생성 후 cosmetic 적용 ──
    const setup = await page.evaluate((vehicles) => {
      // accessory 측정용 sandbox: 실제 경주 트랙은 비-경주 화면에서 display:none(조상 포함)이라
      // 자식 레이아웃 박스가 없어 transform/geometry 측정 불가. 측정 가능한 가시 sandbox 를 body 에 직접 둔다.
      // (finish_fx 는 raceTrackContainer 에 그려야 하므로 그 검증은 별도 — playFinishFxInto 는 layout 불필요).
      var cont = document.getElementById('qa-acc-sandbox');
      if (cont) cont.remove();
      cont = document.createElement('div');
      cont.id = 'qa-acc-sandbox';
      cont.style.cssText = 'position:fixed; left:0; top:0; z-index:99999; background:#222; width:1100px; min-height:200px; overflow:visible;';
      document.body.appendChild(cont);

      var out = {};
      vehicles.forEach(function (vid, idx) {
        var wrap = document.createElement('div');
        wrap.className = 'qa-horse-wrap';
        wrap.style.position = 'relative';
        var horse = document.createElement('div');
        horse.className = 'horse my-horse racing';   // racing → trail opacity 발현 조건
        horse.style.position = 'relative';
        horse.style.width = '80px'; horse.style.height = '80px';
        horse.dataset.vehicleId = vid;
        // 가로로 배치(세로 stacking → overflow 클리핑 회피, 각 .horse 가 컨테이너 안에서 가시)
        wrap.style.display = 'inline-block';
        wrap.style.margin = '20px';
        var sprite = document.createElement('div');
        sprite.className = 'vehicle-sprite';
        sprite.style.width = '60px'; sprite.style.height = '45px';
        horse.appendChild(sprite);
        wrap.appendChild(horse);
        cont.appendChild(wrap);
        out[vid] = idx;
      });
      return out;
    }, VEHICLES);
    check(!!setup && Object.keys(setup).length === VEHICLES.length, '합성 .horse 노드 생성(' + VEHICLES.length + '종 탈것)');

    // ── A. accessory 탈것별 앵커: 각 탈것마다 .cosmetic-accessory 의 left/top 이 다르게 계산되고 컨테이너 안에 위치 ──
    const accResult = await page.evaluate((vehicles) => {
      var res = {};
      vehicles.forEach(function (vid) {
        var horse = document.querySelector('.qa-horse-wrap .horse[data-vehicle-id="' + vid + '"]');
        window.HorseShop.applyEquippedToHorse(horse, { accessory: 'acc_crown' });
        var el = horse.querySelector('.cosmetic-accessory');
        if (!el) { res[vid] = null; return; }
        void el.offsetHeight; // 강제 reflow → 이모지 글리프 레이아웃 확정 후 측정(transform 매트릭스 계산)
        var cs = getComputedStyle(el);
        var er = el.getBoundingClientRect();
        res[vid] = {
          text: el.textContent,
          // translate(-50%,-100%) scale 가 매트릭스로 계산됐는지(inline 요소면 transform 무시되지만 position:absolute → block)
          transformMatrix: /matrix/.test(cs.transform),
          leftPx: parseFloat(cs.left), topPx: parseFloat(cs.top),
          visible: er.width > 0 && er.height > 0
        };
      });
      return res;
    }, VEHICLES);

    var accAllPresent = VEHICLES.every(function (v) { return accResult[v] && accResult[v].text === '👑'; });
    check(accAllPresent, 'A1: 전 탈것에 .cosmetic-accessory(👑) 렌더');

    // 탈것별 left/top 이 ACC_ANCHOR 에 따라 달라야 함(car vs rocket vs helicopter 등 최소 3종 distinct)
    var leftSet = new Set(VEHICLES.map(function (v) { return accResult[v] && accResult[v].leftPx; }));
    var topSet = new Set(VEHICLES.map(function (v) { return accResult[v] && accResult[v].topPx; }));
    check(leftSet.size >= 3, 'A2: accessory left 가 탈것별로 보정(distinct ≥ 3)', 'distinctLeft=' + leftSet.size);
    check(topSet.size >= 2, 'A3: accessory top 이 탈것별로 보정(distinct ≥ 2)', 'distinctTop=' + topSet.size);

    // 앵커 px 검증: car = left 10+29=39px, top 17.5+8=25.5px ; rocket = left 60px, top 27.5px
    check(Math.abs(accResult.car.leftPx - 39) < 1.5 && Math.abs(accResult.car.topPx - 25.5) < 1.5,
      'A4: car 앵커 계산값(left≈39, top≈25.5)', 'car left=' + accResult.car.leftPx + ' top=' + accResult.car.topPx);
    check(Math.abs(accResult.rocket.leftPx - 60) < 1.5 && Math.abs(accResult.rocket.topPx - 27.5) < 1.5,
      'A5: rocket 앵커 계산값(left≈60, top≈27.5)', 'rocket left=' + accResult.rocket.leftPx + ' top=' + accResult.rocket.topPx);

    // translate(-50%,-100%) scale 가 매트릭스로 계산(앵커 보정 실제 발현) + 글리프 가시(클리핑 회피)
    check(VEHICLES.every(function (v) { return accResult[v].visible && accResult[v].transformMatrix; }),
      'A6: 전 탈것 accessory 가시 + transform 매트릭스 발현(앵커 보정 실동작)',
      VEHICLES.map(function (v) { return v + ':' + (accResult[v].transformMatrix ? 'T' : 'F') + '/' + (accResult[v].visible ? 'V' : 'x'); }).join(' '));

    // ── B. 잔상(trail) streak: 색 글로우 띠 + data-emoji 머리 + racing 시 opacity/stream 발현 ──
    const trailResult = await page.evaluate(function () {
      var horse = document.querySelector('.qa-horse-wrap .horse[data-vehicle-id="car"]');
      window.HorseShop.applyEquippedToHorse(horse, { trail: 'trail_flame' });
      var el = horse.querySelector('.cosmetic-trail');
      if (!el) return null;
      var cs = getComputedStyle(el);
      return {
        inlineColor: el.style.color,
        dataEmoji: el.getAttribute('data-emoji'),
        heightPx: parseFloat(cs.height),
        opacity: parseFloat(cs.opacity),
        animation: cs.animationName,
        bg: cs.backgroundImage
      };
    });
    check(!!trailResult, 'B0: .cosmetic-trail 렌더');
    check(!!trailResult.inlineColor, 'B1: 잔상 색 인라인 주입(카탈로그 color)', 'color=' + trailResult.inlineColor);
    check(trailResult.dataEmoji === '🔥', 'B2: data-emoji 머리(아이템 정체성)', 'emoji=' + trailResult.dataEmoji);
    check(trailResult.opacity >= 0.3, 'B3: racing 시 trail opacity ≥ 0.3(은은한 정적 띠 0.45)', 'opacity=' + trailResult.opacity);
    check(!/cosmeticTrailStream/.test(trailResult.animation), 'B4: racing 시 부착 띠 애니메이션 부재(부스터 맥동 제거)', 'anim=' + trailResult.animation);
    check(/gradient/.test(trailResult.bg), 'B5: 색 글로우 띠(linear-gradient) 존재', 'bg=' + trailResult.bg.slice(0, 40));

    // B5r: 인레이스 rainbow 띠 — 프리뷰와 규칙 분리 후에도 gradient 는 유지되되,
    //      white-hot/drop-shadow 글로우 제거 방침이 rainbow 에도 적용됐는지(부스터 오독 소거 계약 고정)
    const rainbowTrail = await page.evaluate(function () {
      var horse = document.querySelector('.qa-horse-wrap .horse[data-vehicle-id="rocket"]');
      window.HorseShop.applyEquippedToHorse(horse, { trail: 'trail_ad_rainbow' });
      var el = horse.querySelector('.cosmetic-trail');
      if (!el) return null;
      var cs = getComputedStyle(el);
      return { rainbow: el.classList.contains('rainbow'), filter: cs.filter, bg: cs.backgroundImage };
    });
    check(!!rainbowTrail && rainbowTrail.rainbow && /gradient/.test(rainbowTrail.bg) && !/drop-shadow/.test(rainbowTrail.filter),
      'B5r: 인레이스 rainbow 띠 — rainbow 클래스 + gradient 유지 + drop-shadow(글로우) 부재',
      rainbowTrail ? 'filter=' + rainbowTrail.filter : 'null');

    // 두 잔상 타입이 시각적으로 다른지 — 색이 다르면 명백히 다름(switch 가 보임)
    const trailSwitch = await page.evaluate(function () {
      var horse = document.querySelector('.qa-horse-wrap .horse[data-vehicle-id="car"]');
      window.HorseShop.applyEquippedToHorse(horse, { trail: 'trail_flame' });
      var a = horse.querySelector('.cosmetic-trail').style.color;
      window.HorseShop.applyEquippedToHorse(horse, { trail: 'trail_star' });
      var b = horse.querySelector('.cosmetic-trail').style.color;
      // 멱등 재적용: cosmetic-trail 이 정확히 1개여야 함(stale 제거)
      var count = horse.querySelectorAll('.cosmetic-trail').length;
      return { a: a, b: b, count: count };
    });
    check(trailSwitch.a !== trailSwitch.b, 'B6: 잔상 타입 전환 시 색이 다름(flame vs star)', trailSwitch.a + ' → ' + trailSwitch.b);
    check(trailSwitch.count === 1, 'B7: trail 멱등 재적용(stale 제거, .cosmetic-trail 1개)', 'count=' + trailSwitch.count);

    // ── B8. 실루엣 스포너 스모크: 실전 frame 구조(.vehicle-active-layer > .frame1/.frame2) 주입 후
    //    racing 유지 + "이동" → .cosmetic-afterimage(스프라이트 SVG 단색 사본)가 horse.parentElement 에 스폰.
    //    스포너는 rAF 기반 — racing 클래스 + fixture 가시(document 연결) 상태여야 스폰됨
    //    (#qa-acc-sandbox 는 body 직속 가시 컨테이너라 충족). 실루엣은 .horse 내부가 아니라
    //    horse.parentElement(.qa-horse-wrap)에 붙어 B7 등 horse 내부 노드 카운트 단언과 무충돌.
    //    이동량 게이트(월드 좌표 ≥6px): 합성 환경엔 .finish-line 이 없어 ref=null → worldX=화면x.
    //    실계약("움직이는 말만 잔상")에 맞춰 fixture 말을 rAF 마다 이동시키며 스폰을 검증한다.
    await page.evaluate(function () {
      var horse = document.querySelector('.qa-horse-wrap .horse[data-vehicle-id="car"]');
      var sprite = horse.querySelector('.vehicle-sprite');
      // 실전 DOM 구조 모사: 진짜 car run 프레임(getVehicleSVG, 페이지 전역)을 frame1/frame2 에 주입
      var v = getVehicleSVG('car');
      var d = (v && (v.run || v.idle)) || v;
      var layer = document.createElement('div');
      layer.className = 'vehicle-active-layer';
      var f1 = document.createElement('div'); f1.className = 'frame1'; f1.innerHTML = d.frame1;
      var f2 = document.createElement('div'); f2.className = 'frame2'; f2.innerHTML = d.frame2 || d.frame1;
      layer.appendChild(f1); layer.appendChild(f2);
      sprite.appendChild(layer);
      window.HorseShop.applyEquippedToHorse(horse, { trail: 'trail_flame' }); // 스포너 (재)등록
      // fixture 는 position:relative — left 로 시각 위치만 이동 (~150px/s, 스폰간격 130ms당 ≥6px 보장)
      var moved = 0;
      window.__qaB8Move = function () {
        moved += 2.5;
        horse.style.left = moved + 'px';
        window.__qaB8MoveRaf = requestAnimationFrame(window.__qaB8Move);
      };
      window.__qaB8MoveRaf = requestAnimationFrame(window.__qaB8Move);
    });
    // 스폰 대기(간격 130ms → ~600ms 면 수 개). C-9: waitForFunction 옵션은 반드시 3번째 인자.
    // 실루엣은 ~1s 내 자기 제거되므로 발견 시점에 정보를 함께 반환(별도 evaluate 재조회 race 회피).
    let ghostInfo = null;
    try {
      const gh = await page.waitForFunction(function () {
        var horse = document.querySelector('.qa-horse-wrap .horse[data-vehicle-id="car"]');
        var g = horse && horse.parentElement.querySelector('.cosmetic-afterimage');
        if (!g) return null;
        return {
          count: horse.parentElement.querySelectorAll('.cosmetic-afterimage').length,
          hasSvg: !!g.querySelector('svg'),
          color: g.style.color || ''
        };
      }, null, { timeout: 6000 });
      ghostInfo = await gh.jsonValue();
    } catch (e) { /* timeout → 미스폰, 아래 check 가 FAIL 보고 */ }
    check(!!ghostInfo && ghostInfo.count >= 1, 'B8a: 실루엣 스포너 — racing+이동 중 .cosmetic-afterimage ≥ 1 스폰', ghostInfo ? 'count=' + ghostInfo.count : 'timeout');
    check(!!ghostInfo && ghostInfo.hasSvg, 'B8b: 실루엣 내부 svg 존재(스프라이트 프레임 사본)');
    check(!!ghostInfo && !!ghostInfo.color, 'B8c: 실루엣 inline color 주입(아이템 색 → currentColor 단색)', ghostInfo ? 'color=' + ghostInfo.color : '');

    // B8d: 이동 정지 → 월드 이동량 게이트가 스폰을 멈추고 기존 실루엣은 자기 제거(≤1s)
    //      (완주해 정지한 말의 제자리 스폰 방지 계약 — racing 클래스는 그대로인데 잔상만 멎어야 함)
    let gateOk = false;
    try {
      await page.evaluate(function () { cancelAnimationFrame(window.__qaB8MoveRaf); });
      await page.waitForFunction(function () {
        var horse = document.querySelector('.qa-horse-wrap .horse[data-vehicle-id="car"]');
        return horse.parentElement.querySelectorAll('.cosmetic-afterimage').length === 0;
      }, null, { timeout: 4000 });
      await new Promise(function (res) { setTimeout(res, 300); }); // 정지 상태 300ms 추가 관찰
      gateOk = await page.evaluate(function () {
        var horse = document.querySelector('.qa-horse-wrap .horse[data-vehicle-id="car"]');
        return horse.parentElement.querySelectorAll('.cosmetic-afterimage').length === 0;
      });
    } catch (e) { /* 4s 내 0 미도달 = 정지 후에도 계속 스폰 → FAIL */ }
    check(gateOk, 'B8d: 정지 시 스폰 중단(이동량 게이트) — 실루엣 0 유지, racing 클래스 무관');

    // ── C. finish_fx 개인화: playFinishFx() 무인자 호출이 본인 장착 기준으로 raceTrackContainer 에 28조각 레이어 ──
    const fxResult = await page.evaluate(function () {
      var cont = document.getElementById('raceTrackContainer');
      cont.querySelectorAll('.cosmetic-finish-fx').forEach(function (n) { n.remove(); });
      // 내부 mergedEquipped() 는 ShopModule.getAdWallet().equipped 를 병합한다 → 광고 장착으로 본인 finish_fx 주입.
      // (비-방장도 "본인 장착 기준"으로 자기 화면에서 자기 연출을 본다는 것을 검증)
      var origAd = window.ShopModule.getAdWallet;
      window.ShopModule.getAdWallet = function () { return { equipped: { finish_fx: 'fx_confetti' } }; };
      window.HorseShop.playFinishFx();
      var layer = cont.querySelector('.cosmetic-finish-fx');
      var pieces = layer ? layer.querySelectorAll('.cosmetic-fx-piece') : [];
      // 조각들의 left% 분포(전폭 커버) + font-size 변주
      var lefts = [], sizes = [];
      for (var i = 0; i < pieces.length; i++) {
        var cs = getComputedStyle(pieces[i]);
        lefts.push(parseFloat(pieces[i].style.left));
        sizes.push(parseFloat(cs.fontSize));
      }
      window.ShopModule.getAdWallet = origAd;
      return {
        hasLayer: !!layer,
        count: pieces.length,
        text: pieces.length ? pieces[0].textContent : '',
        minLeft: Math.min.apply(null, lefts),
        maxLeft: Math.max.apply(null, lefts),
        sizeDistinct: new Set(sizes.map(function (s) { return Math.round(s); })).size
      };
    });
    check(fxResult.hasLayer, 'C0: playFinishFx() 무인자 → raceTrackContainer 에 finish-fx 레이어 생성');
    check(fxResult.count === 28, 'C1: finish_fx 28조각(12 → 28 강화)', 'count=' + fxResult.count);
    check(fxResult.text === '🎉', 'C2: 본인 장착(fx_confetti) 기준 — 방장 무관 개인화', 'emoji=' + fxResult.text);
    check(fxResult.minLeft < 15 && fxResult.maxLeft > 85, 'C3: 조각 전폭 분포(좌<15% ~ 우>85%)', 'min=' + fxResult.minLeft + ' max=' + fxResult.maxLeft);
    check(fxResult.sizeDistinct >= 3, 'C4: 조각 크기 변주(distinct ≥ 3)', 'distinct=' + fxResult.sizeDistinct);

    // C5: 미장착이면 연출 없음(0-throw, 레이어 미생성)
    const fxNone = await page.evaluate(function () {
      var cont = document.getElementById('raceTrackContainer');
      cont.querySelectorAll('.cosmetic-finish-fx').forEach(function (n) { n.remove(); });
      var origAd = window.ShopModule.getAdWallet;
      var origEq = window.ShopModule.getEquipped;
      window.ShopModule.getAdWallet = function () { return { equipped: {} }; };
      window.ShopModule.getEquipped = function () { return {}; };
      var err = null;
      try { window.HorseShop.playFinishFx(); } catch (e) { err = String(e); }
      window.ShopModule.getAdWallet = origAd;
      window.ShopModule.getEquipped = origEq;
      return { layer: !!cont.querySelector('.cosmetic-finish-fx'), err: err };
    });
    check(!fxNone.layer && !fxNone.err, 'C5: finish_fx 미장착 시 연출 없음 + 0-throw', fxNone.err || 'ok');

    // C6: 레거시 호환 — 구버전 호출부가 인자(roomCosmetics)를 넘겨도 무시(본인 장착 기준)되고 throw 없음
    const fxLegacy = await page.evaluate(function () {
      var cont = document.getElementById('raceTrackContainer');
      cont.querySelectorAll('.cosmetic-finish-fx').forEach(function (n) { n.remove(); });
      var origAd = window.ShopModule.getAdWallet;
      window.ShopModule.getAdWallet = function () { return { equipped: { finish_fx: 'fx_star' } }; };
      var err = null;
      try { window.HorseShop.playFinishFx({ finish_fx: 'fx_firework' }); } catch (e) { err = String(e); }
      var layer = cont.querySelector('.cosmetic-finish-fx');
      var first = layer && layer.querySelector('.cosmetic-fx-piece');
      var emoji = first ? first.textContent : '';
      window.ShopModule.getAdWallet = origAd;
      return { err: err, emoji: emoji };
    });
    check(!fxLegacy.err && fxLegacy.emoji === '⭐', 'C6: 레거시 인자 무시(본인 장착 fx_star 기준), 0-throw', fxLegacy.err || ('emoji=' + fxLegacy.emoji));

    // AdSense(show_ads_impl.js) 의 'TagError: Y' 는 서드파티 광고 스크립트 노이즈(로컬/헤드리스) — 제품 코드 무관.
    var appErrors = pageErrors.filter(function (e) { return !/TagError/.test(e); });
    check(appErrors.length === 0, 'Z: 제품 코드 콘솔 에러 0건(AdSense TagError 노이즈 제외)', appErrors.join(' | '));

  } catch (e) {
    check(false, '테스트 실행 중 예외: ' + e.message);
    if (pageErrors.length) console.log('pageErrors:', pageErrors.join(' | '));
  } finally {
    await browser.close();
  }

  console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
  process.exit(pass ? 0 : 1);
})();
