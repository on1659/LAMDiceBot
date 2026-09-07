/**
 * AdSense Ad Initialization
 * - Central control for all ad slots
 * - Future: premium check before showing ads
 */
var STICKY_COLLAPSE_KEY = 'adStickyCollapsed';

function initAds() {
  // Future: if (window.__USER_PREMIUM__) return;

  document.querySelectorAll('.ad-container').forEach(function(container) {
    var ins = container.querySelector('.adsbygoogle');
    if (ins && !ins.dataset.adsbygoogleStatus) {
      var slot = ins.getAttribute('data-ad-slot');
      // placeholder 슬롯(예: STICKY_SLOT_ID) — 숫자가 아니면 push() 시 AdSense TagError 발생, skip
      if (!/^\d+$/.test(slot || '')) return;
      try {
        (adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        // Ad blocker or load failure — hide empty container
        container.classList.add('ad-hidden');
      }
    }
  });
}

// 접힌 상태를 body 클래스로 반영 — CSS가 광고 바를 화면 밖으로 내리고 손잡이 탭만 남긴다
function applyStickyCollapsed(collapsed, btn) {
  document.body.classList.toggle('ad-sticky-collapsed', collapsed);
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  btn.setAttribute('aria-label', collapsed ? '광고 펼치기' : '광고 접기');
  btn.textContent = collapsed ? '▲' : '▼';
}

// 하단 스티키 광고에 접기/펼치기 손잡이를 주입 (게임 페이지에만 존재)
function initStickyAdToggle() {
  var sticky = document.querySelector('.ad-container.ad-sticky');
  if (!sticky || sticky.querySelector('.ad-sticky-toggle')) return;

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ad-sticky-toggle';
  sticky.insertBefore(btn, sticky.firstChild);

  var collapsed = false;
  // 세션 단위 기억 — 새로 방문하면 다시 펼친 상태로 시작
  try { collapsed = sessionStorage.getItem(STICKY_COLLAPSE_KEY) === '1'; } catch (e) {}
  applyStickyCollapsed(collapsed, btn);

  btn.addEventListener('click', function() {
    var next = !document.body.classList.contains('ad-sticky-collapsed');
    applyStickyCollapsed(next, btn);
    try { sessionStorage.setItem(STICKY_COLLAPSE_KEY, next ? '1' : '0'); } catch (e) {}
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // Future: fetch('/api/user/premium').then(...)
  initAds();
  initStickyAdToggle();
});
