/* 모바일 디자인 목업 전용. 서버 및 실제 게임 저장값과 연결하지 않는다. */
(function () {
  'use strict';
  const STORAGE_KEY = 'lamdiceHorseMockupSkin';
  const SKINS = {light:'라이트',dark:'다크',black:'블랙',midnight:'미드나잇',mocha:'모카',purple:'퍼플'};
  const STAGES = {ready:'준비',playing:'진행',result:'결과'};
  const GAMES = {'dice':'주사위','roulette':'룰렛','horse':'경마','deguri':'데구리'};
  const query = new URLSearchParams(location.search);
  let saved;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) { /* 저장 없이도 동작 */ }
  let skin = Object.hasOwn(SKINS,query.get('skin')) ? query.get('skin') : Object.hasOwn(SKINS,saved) ? saved : 'dark';
  let stage = Object.hasOwn(STAGES,query.get('stage')) ? query.get('stage') : 'ready';
  let config, main, primary, stageButtons = [], action;
  function applySkin() { document.documentElement.dataset.theme = skin === 'light' ? 'light' : 'dark'; document.documentElement.dataset.skin = skin; }
  applySkin();
  function el(tag,cls,text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
  function link(game,screen = 'ready') { const params = new URLSearchParams({skin}); if (['orders','chat','menu'].includes(screen)) { params.set('game',game); params.set('stage',stage); return '/mockups/horse-' + screen + '-mobile.html?' + params; } if (game === 'horse') return '/mockups/horse-' + ({ready:'ready',playing:'racing',result:'result'}[screen] || 'ready') + '-mobile.html?' + params; params.set('stage',Object.hasOwn(STAGES,screen) ? screen : 'ready'); return '/mockups/' + (Object.hasOwn(GAMES,game) ? game : 'dice') + '-mobile.html?' + params; }
  function sharedLink(page) { return '/mockups/horse-' + page + '-mobile.html?' + new URLSearchParams({skin,game:config.id,stage}); }
  function icon(name) { const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns,'svg'); svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('aria-hidden','true'); svg.classList.add('icon'); const shapes = {back:'m14 6-6 6 6 6',people:'M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5M6 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0',chat:'M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0ZM7 11h.01M11 11h.01M15 11h.01',cup:'M5 8h12v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4ZM17 9h2a3 3 0 0 1 0 6h-2M8 3v2m4-3v3m4-2v2',menu:'M4 6h16M4 12h16M4 18h16',close:'m6 6 12 12M18 6 6 18'}; const path = document.createElementNS(ns,'path'); path.setAttribute('d',shapes[name] || shapes.menu); svg.append(path); return svg; }
  function setAction(label,callback) { primary.textContent = label; primary.disabled = false; action = callback; }
  function updateLinks() { document.querySelectorAll('[data-shared-page]').forEach(a => a.href = sharedLink(a.dataset.sharedPage)); document.querySelectorAll('[data-game-link]').forEach(a => a.href = link(a.dataset.gameLink,a.dataset.gameStage)); document.getElementById('galleryLink').href = '/mockups/games-mobile.html?skin=' + skin; document.querySelectorAll('a[href]').forEach(a => { const u = new URL(a.href,location.href); if (u.origin === location.origin && u.pathname.startsWith('/mockups/')) { u.searchParams.set('skin',skin); a.href = u.href; } }); }
  function render() {
    const labels = {ready:config.name + ' 시작',playing:'결과 보기',result:'다시 준비'};
    setAction(labels[stage],() => setStage(({ready:'playing',playing:'result',result:'ready'})[stage]));
    main.replaceChildren(); main.scrollTop = 0;
    document.getElementById('stageLabel').textContent = config.name + ' · ' + ({ready:'준비 중',playing:'진행 중',result:'종료'})[stage];
    stageButtons.forEach(button => button.setAttribute('aria-pressed',String(button.dataset.stage === stage)));
    config.render(main,stage); updateLinks();
  }
  function setStage(next) { if (!Object.hasOwn(STAGES,next)) return; if (config.cleanup) config.cleanup(); stage = next; const url = new URL(location.href); url.searchParams.set('stage',stage); url.searchParams.set('skin',skin); history.replaceState(null,'',url); render(); }
  function mount(options) {
    config = options;
    const bar = el('div'); bar.id = 'mockBar'; bar.append(el('span','mock-label','목업'));
    Object.entries(STAGES).forEach(([id,label]) => { const b = el('button','',label); b.type = 'button'; b.dataset.stage = id; b.addEventListener('click',() => setStage(id)); stageButtons.push(b); bar.append(b); });
    const select = el('select'); select.id = 'mockThemeSelect'; select.setAttribute('aria-label','화면 테마'); Object.entries(SKINS).forEach(([id,label]) => { const option = el('option','',label); option.value = id; select.append(option); }); select.value = skin;
    select.addEventListener('change',() => { skin = select.value; applySkin(); try { localStorage.setItem(STORAGE_KEY,skin); } catch (_) {} const url = new URL(location.href); url.searchParams.set('skin',skin); history.replaceState(null,'',url); updateLinks(); document.dispatchEvent(new CustomEvent('mockskinchange',{detail:{skin}})); }); bar.append(select);
    const app = el('div','prototype'), head = el('header','room-head'), back = el('a','icon-button'); back.id = 'galleryLink'; back.setAttribute('aria-label','모든 게임 목업'); back.append(icon('back'));
    const identity = el('div','identity'), status = el('small'); status.id = 'stageLabel'; identity.append(status,el('h1','','점심 먹고 한 판'));
    const people = el('button','icon-button people-button'); people.type = 'button'; people.setAttribute('aria-label','참여자 4명 보기'); people.append(icon('people'),document.createTextNode('4')); head.append(back,identity,people);
    main = el('main','content'); main.id = 'gameContent';
    const footer = el('footer','footer'); primary = el('button','primary-action'); primary.id = 'primaryAction'; primary.type = 'button'; primary.addEventListener('click',() => action());
    const dock = el('nav','dock'); dock.setAttribute('aria-label','방 메뉴'); const gameTab = el('button'); gameTab.type = 'button'; gameTab.setAttribute('aria-current','page'); const image = el('img'); image.src = config.icon; image.alt = ''; gameTab.append(image,el('span','','게임')); gameTab.addEventListener('click',() => main.scrollTop = 0); dock.append(gameTab);
    [['orders','주문','cup'],['chat','채팅','chat'],['menu','메뉴','menu']].forEach(([page,label,symbol]) => { const a = el('a'); a.dataset.sharedPage = page; a.append(icon(symbol),el('span','',label)); dock.append(a); }); footer.append(primary,dock); app.append(head,main,footer);
    const dialog = el('dialog'); dialog.id = 'peopleDialog'; dialog.setAttribute('aria-labelledby','peopleTitle'); const dh = el('div','dialog-head'), title = el('h2','','참여자 4'); title.id = 'peopleTitle'; const close = el('button','icon-button'); close.type = 'button'; close.setAttribute('aria-label','닫기'); close.append(icon('close')); close.addEventListener('click',() => dialog.close()); dh.append(title,close); dialog.append(dh);
    ['나','민지','수빈','준호'].forEach((name,i) => { const row = el('div','person-row'); const img = el('img'); img.src = '/mockups/assets/' + ['mb-hamster-0.webp','mb-panda-0.webp','mb-hedgehog-0.webp','veh-crab-1.webp'][i]; img.alt = ''; row.append(img,el('strong','',name),el('small','muted',i === 3 ? '관전자' : '참여자')); dialog.append(row); }); people.addEventListener('click',() => dialog.showModal()); dialog.addEventListener('click',e => { if (e.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); });
    document.body.append(bar,app,dialog); render();
  }
  window.GameMobileMock = Object.freeze({mount,el,icon,setAction,setStage,link,getStage:() => stage});
})();
