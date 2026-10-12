(() => {
  'use strict';
  const PEOPLE = [{ name: '나', avatar: 'dinosaur' }, { name: '민지', avatar: 'ninja' }, { name: '수빈', avatar: 'rabbit' }];
  const WINNER_INDEX = 1;
  const FINAL_ANGLE = 1980;
  const SPIN_MS = 2400;
  const WHEEL_SPRITE_SIZE = 46;
  const WHEEL_SPRITE_TOP = 36;
  const WHEEL_LABEL_OFFSET = 23;
  const TURBO_MS = 1600;
  const state = { turbo: true, spun: false, spinning: false, timer: null, angle: 0 };
  const ui = window.GameMobileMock;
  const el = ui.el;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const node = document.createElementNS(svgNS, tag); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); return node; };
  const image = (src, className = '') => { const node = el('img', className); node.src = src; node.alt = ''; return node; };
  function heading(host, title, badge) { const head = el('div', 'page-head'); head.append(el('h2', '', title), el('span', 'pill', badge)); host.append(head); }
  function wheel(host, stage) {
    const panel = el('section', `roulette-stage${stage === 'ready' ? ' roulette-ready-stage' : ''}`); const wrap = el('div', 'roulette-wheel'); wrap.setAttribute('aria-label', '나, 민지, 수빈이 같은 크기로 들어간 돌림판');
    const disc = svgEl('svg', { viewBox: '0 0 300 300', class: 'roulette-disc', 'aria-hidden': 'true' });
    const arcs = ['M150 150 L150 10 A140 140 0 0 1 271.24 220 Z', 'M150 150 L271.24 220 A140 140 0 0 1 28.76 220 Z', 'M150 150 L28.76 220 A140 140 0 0 1 150 10 Z'];
    const positions = [{ x: 225, y: 108 }, { x: 150, y: 235 }, { x: 75, y: 108 }];
    PEOPLE.forEach((person, index) => { disc.append(svgEl('path', { d: arcs[index], class: `roulette-segment-${index}` })); const sprite = svgEl('image', { href: `/mockups/assets/veh-${person.avatar}-1.webp`, x: positions[index].x - WHEEL_SPRITE_SIZE / 2, y: positions[index].y - WHEEL_SPRITE_TOP, width: WHEEL_SPRITE_SIZE, height: WHEEL_SPRITE_SIZE }); const label = svgEl('text', { x: positions[index].x, y: positions[index].y + WHEEL_LABEL_OFFSET, class: `roulette-label roulette-label-${index}` }); label.textContent = person.name; disc.append(sprite, label); });
    disc.append(svgEl('circle', { cx: 150, cy: 150, r: 144, class: 'roulette-outer-ring' }), svgEl('circle', { cx: 150, cy: 150, r: 25, class: 'roulette-center' }));
    const center = svgEl('text', { x: 150, y: 151, class: 'roulette-center-text' }); center.textContent = 'LAM'; disc.append(center);
    disc.style.setProperty('--wheel-angle', `${stage === 'playing' ? state.angle : 0}deg`); wrap.append(el('div', 'roulette-pointer'), disc); panel.append(wrap);
    panel.append(el('p', 'roulette-stage-caption', stage === 'ready' ? '세 사람, 같은 확률' : state.spun ? '민지 당첨!' : '돌림판을 돌려 주세요')); host.append(panel); return { disc, panel };
  }
  function render(host, stage) {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    state.spinning = false;
    if (stage === 'ready') {
      state.spun = false; state.angle = 0;
      heading(host, '룰렛 준비', '3 / 3 준비'); wheel(host, stage);
      const people = el('div', 'roulette-ready-list'); PEOPLE.forEach(person => { const item = el('div', 'roulette-person'); item.append(image(`/mockups/assets/veh-${person.avatar}-1.webp`), el('strong', '', person.name), el('span', '', '준비 완료')); people.append(item); }); host.append(people);
      const turbo = el('label', 'roulette-setting'); turbo.append(el('span', '', '터보 애니메이션')); const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = state.turbo; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', '터보 애니메이션'); toggle.addEventListener('change', () => { state.turbo = toggle.checked; }); turbo.append(toggle); host.append(turbo, el('div', 'ad', 'AD'));
      ui.setAction('룰렛 시작', () => { state.spun = false; state.angle = 0; ui.setStage('playing'); });
    } else if (stage === 'playing') {
      heading(host, state.spun ? '룰렛 완료' : '돌림판', state.turbo ? '터보' : '진행 중'); const { disc, panel } = wheel(host, stage);
      const info = el('div', 'roulette-picked'); info.append(el('span', 'muted', '참가자'), el('strong', '', '나 · 민지 · 수빈')); host.append(info, el('div', 'ad', 'AD'));
      function spin() {
        if (state.spinning) return;
        if (state.spun) { ui.setStage('result'); return; }
        state.spinning = true; const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : state.turbo ? TURBO_MS : SPIN_MS;
        disc.style.setProperty('--wheel-duration', `${duration}ms`); disc.classList.add('spinning');
        disc.getBoundingClientRect(); state.angle = FINAL_ANGLE; disc.style.setProperty('--wheel-angle', `${state.angle}deg`);
        panel.querySelector('.roulette-stage-caption').textContent = '돌아가는 중'; ui.setAction('돌아가는 중…', () => {});
        state.timer = setTimeout(() => { state.timer = null; state.spinning = false; state.spun = true; ui.setStage('playing'); }, duration);
      }
      ui.setAction(state.spun ? '결과 보기' : '돌림판 돌리기', spin);
    } else {
      heading(host, '룰렛 결과', '1라운드'); const selected = PEOPLE[WINNER_INDEX]; const hero = el('section', 'winner-card'); const visual = el('div', 'winner-visual'); visual.append(image(`/mockups/assets/veh-${selected.avatar}-1.webp`, 'roulette-winner-sprite')); const copy = el('div', 'winner-copy'); copy.append(el('span', 'accent', '오늘의 당첨'), el('h3', '', selected.name), el('p', 'muted', '아이스 아메리카노')); hero.append(visual, copy); host.append(hero);
      const orders = el('a', 'roulette-order-link'); orders.href = ui.link('roulette', 'orders'); orders.append(el('span', '', '주문 정리표'), el('span', 'muted', '총 3잔  ›')); host.append(orders);
      const title = el('div', 'section-head'); title.append(el('h3', '', '참가자'), el('span', 'muted', '예시 기록')); host.append(title); const list = el('div', 'roulette-records'); PEOPLE.forEach((person, index) => { const row = el('div', `roulette-record-row${index === WINNER_INDEX ? ' is-winner' : ''}`); row.append(image(`/mockups/assets/veh-${person.avatar}-1.webp`), el('strong', '', person.name), el('span', index === WINNER_INDEX ? 'pill' : 'muted', index === WINNER_INDEX ? '당첨' : '통과')); list.append(row); }); host.append(list);
      const replay = el('button', 'roulette-preview-button', '돌림판 다시 보기'); replay.type = 'button'; replay.addEventListener('click', () => { state.spun = false; state.angle = 0; ui.setStage('playing'); }); host.append(replay, el('div', 'ad', 'AD')); ui.setAction('다시 준비', () => ui.setStage('ready'));
    }
  }
  ui.mount({ id: 'roulette', name: '룰렛', icon: '/mockups/assets/ic-slot.png', render });
})();
