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

document.addEventListener('DOMContentLoaded', function() {
  // Future: fetch('/api/user/premium').then(...)
  initAds();
});
