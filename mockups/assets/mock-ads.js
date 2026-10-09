/* 목업 22·23 공용 광고 층. 사용:
 *   <link rel="stylesheet" href="/mockups/assets/mock-ads.css">
 *   <script src="/mockups/assets/mock-ads.js"></script>
 *   MockAds.init({ sticky: true|false })   // 게임 페이지만 sticky:true
 *   본문 배너: <div class="mock-ad" data-format="auto|horizontal"></div>
 *   목업 바 켜기/끄기 버튼: <button type="button" data-mock-ads-toggle aria-pressed="true">광고</button>
 *   경주 중: MockAds.setRaceRunning(true|false)   // 실서버처럼 하단 고정 광고를 숨긴다
 * 화면 아래 고정 광고가 차지하는 높이를 --mock-ad-bottom 으로 알려 준다.
 * 목업의 고정 버튼·도구 줄은 bottom: var(--mock-ad-bottom) 로 그 위에 선다. */
(function () {
  var ANCHOR_H = 338, ANCHOR_TAB = 25; // lamdice.com 375×812 실측 (2026-10-06)
  var root = document.documentElement;
  var anchor, sticky, mqPhone = window.matchMedia('(max-width:720px)');

  function el(tag, cls, html) { var e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; }

  function sizeText(box) {
    var r = box.getBoundingClientRect();
    box.textContent = '광고 ' + Math.round(r.width) + '×' + Math.round(r.height);
  }

  function refresh() {
    var off = root.classList.contains('mock-ads-off');
    var h = 0;
    if (!off && anchor && mqPhone.matches) h = Math.max(h, anchor.classList.contains('is-folded') ? ANCHOR_TAB : ANCHOR_H + ANCHOR_TAB);
    if (!off && sticky && !sticky.classList.contains('is-closed') && !root.classList.contains('mock-race-running')) h = Math.max(h, sticky.offsetHeight);
    root.style.setProperty('--mock-ad-bottom', h + 'px');
    document.querySelectorAll('.mock-ad-box, .mock-sticky-box').forEach(function (b) { if (b.offsetParent) sizeText(b); });
    document.querySelectorAll('[data-mock-ads-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', off ? 'false' : 'true'); });
  }

  function init(opts) {
    opts = opts || {};
    document.querySelectorAll('.mock-ad').forEach(function (ad) {
      if (!ad.querySelector('.mock-ad-box')) { ad.appendChild(el('span', 'mock-ad-label', 'AD')); ad.appendChild(el('div', 'mock-ad-box')); }
    });
    anchor = el('div', 'mock-anchor', '<button type="button" class="mock-anchor-fold" aria-label="자동광고 접기"><span>∨</span></button><div class="mock-anchor-box">구글 자동광고 앵커 375×338</div>');
    anchor.querySelector('.mock-anchor-fold').addEventListener('click', function () { anchor.classList.toggle('is-folded'); refresh(); });
    document.body.appendChild(anchor);
    if (opts.sticky) {
      sticky = el('div', 'mock-sticky', '<span class="mock-sticky-label">AD</span><button type="button" class="mock-sticky-close" aria-label="광고 닫기">✕</button><div class="mock-sticky-box"></div>');
      sticky.querySelector('.mock-sticky-close').addEventListener('click', function () { sticky.classList.add('is-closed'); refresh(); });
      document.body.appendChild(sticky);
    }
    document.querySelectorAll('[data-mock-ads-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var turningOn = root.classList.contains('mock-ads-off');
        root.classList.toggle('mock-ads-off', !turningOn);
        if (turningOn) { anchor.classList.remove('is-folded'); if (sticky) sticky.classList.remove('is-closed'); }
        refresh();
      });
    });
    if (mqPhone.addEventListener) mqPhone.addEventListener('change', refresh);
    window.addEventListener('resize', refresh);
    // 숨겨져 있던 화면(예: 입장 → 로비)이 열려 칸 크기가 생기면 크기 표시를 다시 쓴다
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function (entries) { entries.forEach(function (en) { if (en.contentRect.width) sizeText(en.target); }); });
      document.querySelectorAll('.mock-ad-box, .mock-sticky-box').forEach(function (b) { ro.observe(b); });
      if (sticky) new ResizeObserver(refresh).observe(sticky);
    }
    refresh();
  }

  function setRaceRunning(on) { root.classList.toggle('mock-race-running', !!on); refresh(); }

  window.MockAds = { init: init, refresh: refresh, setRaceRunning: setRaceRunning };
})();
