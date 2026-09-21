/**
 * AdSense Ad Initialization
 * - Central control for all ad slots
 * - Future: premium check before showing ads
 */
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

document.addEventListener('DOMContentLoaded', function() {
  // Future: fetch('/api/user/premium').then(...)
  initAds();

  // 스티키 광고 닫기 — ad-hidden으로 숨기면 body 하단 예약 패딩도 함께 해제됨 (theme.css :has 규칙)
  document.querySelectorAll('.ad-sticky .ad-close').forEach(function(btn) {
    btn.addEventListener('click', function() {
      btn.closest('.ad-sticky').classList.add('ad-hidden');
    });
  });
});
