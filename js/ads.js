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

// 광고 미게재 슬롯 hide — 광고 게재 성공 판정: data-ad-status="filled" OR 실제 ins height > 10px
// AdSense가 unfilled 속성을 안 붙이는 경우(localhost/미승인/throttle/응답 지연 등)도 offsetHeight로 잡힘
function hideEmptyAds() {
  document.querySelectorAll('.ad-container').forEach(function(container) {
    var ins = container.querySelector('.adsbygoogle');
    if (!ins) {
      container.classList.add('ad-hidden');
      return;
    }
    var filled = ins.dataset.adStatus === 'filled' || ins.offsetHeight > 10;
    if (!filled) container.classList.add('ad-hidden');
  });
}

document.addEventListener('DOMContentLoaded', function() {
  // Future: fetch('/api/user/premium').then(...)
  initAds();
  setTimeout(hideEmptyAds, 3000);
});
