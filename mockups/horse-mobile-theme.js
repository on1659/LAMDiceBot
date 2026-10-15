/* 경마 모바일 목업 전용. 실제 게임의 테마 저장값은 변경하지 않는다. */
(function () {
  'use strict';
  const STORAGE_KEY = 'lamdiceHorseMockupSkin';
  const SKINS = {light:'라이트',dark:'다크',black:'블랙',midnight:'미드나잇',mocha:'모카',purple:'퍼플'};
  const PAGES = {ready:'/mockups/horse-ready-mobile.html',orders:'/mockups/horse-orders-mobile.html',chat:'/mockups/horse-chat-mobile.html',menu:'/mockups/horse-menu-mobile.html',racing:'/mockups/horse-racing-mobile.html',result:'/mockups/horse-result-mobile.html'};
  const VEHICLES = ['ninja','crab','dinosaur','turtle','rabbit'];
  const INFO_PAGES = {주문:'orders',채팅:'chat',메뉴:'menu'};
  const root = document.documentElement;
  const query = new URLSearchParams(location.search);
  const GAMES = {dice:'주사위',roulette:'룰렛',deguri:'데구리'};
  const game = Object.hasOwn(GAMES,query.get('game')) ? query.get('game') : null;
  const stage = ['ready','playing','result'].includes(query.get('stage')) ? query.get('stage') : 'ready';
  let stored;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (_) { /* 저장을 막아도 목업은 표시한다. */ }
  const requested = query.get('skin') || query.get('theme');
  let skin = Object.hasOwn(SKINS,requested) ? requested : Object.hasOwn(SKINS,stored) ? stored : 'dark';

  function apply() {
    root.dataset.theme = skin === 'light' ? 'light' : 'dark';
    root.dataset.skin = skin;
  }
  function href(page) {
    const params = new URLSearchParams({skin});
    if (game) {
      if (['ready','racing','result'].includes(page)) {
        params.set('stage',page === 'ready' ? stage : page === 'racing' ? 'playing' : 'result');
        return '/mockups/' + game + '-mobile.html?' + params;
      }
      params.set('game',game);
      params.set('stage',stage);
    }
    if (page === 'racing' || page === 'result') {
      const current = new URLSearchParams(location.search);
      const rank = current.get('rank'), vehicle = current.get('vehicle');
      if (/^[1-5]$/.test(rank)) params.set('rank',rank);
      if (VEHICLES.includes(vehicle)) params.set('vehicle',vehicle);
    }
    return PAGES[page] + '?' + params;
  }
  function syncLinks() {
    document.querySelectorAll('[data-mock-page]').forEach(link => {
      if (Object.hasOwn(PAGES,link.dataset.mockPage) && link.tagName === 'A') link.href = href(link.dataset.mockPage);
    });
  }
  apply();

  document.addEventListener('DOMContentLoaded',() => {
    if (game) {
      const status = document.querySelector('.identity small');
      if (status) status.textContent = GAMES[game] + ' · ' + (location.pathname.includes('orders') ? '주문 받는 중' : {ready:'준비 중',playing:'진행 중',result:'종료'}[stage]);
    }
    const placeholder = document.getElementById('themeToggle');
    if (placeholder) {
      const select = document.createElement('select');
      select.id = 'mockThemeSelect';
      select.dataset.mockSkin = '';
      select.setAttribute('aria-label','화면 테마');
      Object.entries(SKINS).forEach(([id,label]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        select.append(option);
      });
      placeholder.replaceWith(select);
    }
    const selectors = [...document.querySelectorAll('[data-mock-skin]')];
    selectors.forEach(select => {
      select.value = skin;
      select.addEventListener('change',() => {
        if (!Object.hasOwn(SKINS,select.value)) return;
        skin = select.value;
        apply();
        selectors.forEach(control => control.value = skin);
        try { localStorage.setItem(STORAGE_KEY,skin); } catch (_) { /* 페이지 내 테마 변경은 유지한다. */ }
        const url = new URL(location.href);
        url.searchParams.delete('theme');
        url.searchParams.set('skin',skin);
        history.replaceState(null,'',url);
        syncLinks();
        document.dispatchEvent(new CustomEvent('mockskinchange',{detail:{skin}}));
      });
    });
    syncLinks();
  });

  document.addEventListener('click',event => {
    const target = event.target.closest('[data-mock-page], [data-info]');
    if (!target) return;
    const page = target.dataset.mockPage || INFO_PAGES[target.dataset.info];
    if (!Object.hasOwn(PAGES,page)) return;
    // 링크는 기본 동작을 유지해 새 탭에서도 같은 스킨으로 열린다.
    if (target.tagName === 'A') { target.href = href(page); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    location.href = href(page);
  },true);
  window.HorseMobileMockContext = Object.freeze({game,name:game ? GAMES[game] : '경마',stage,href});
})();
