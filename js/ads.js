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
      try {
        (adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {
        // Ad blocker or load failure — hide empty container
        container.classList.add('ad-hidden');
      }
    }
  });
}

// AdSense는 광고 미게재 시 ins에 data-ad-status="unfilled"를 설정 — 응답 대기 후 빈 슬롯 컨테이너에 ad-hidden 적용해 reserved 공간(min-height 90px) collapse
function hideUnfilledAds() {
  document.querySelectorAll('.ad-container .adsbygoogle').forEach(function(ins) {
    if (ins.dataset.adStatus === 'unfilled') {
      var container = ins.closest('.ad-container');
      if (container) container.classList.add('ad-hidden');
    }
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // Future: fetch('/api/user/premium').then(...)
  initAds();
  setTimeout(hideUnfilledAds, 2000);
});
