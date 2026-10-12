(() => {
  'use strict';
  const DEMO = [{ name: '나', fraction: .19, avatar: 'dinosaur' }, { name: '민지', fraction: .86, avatar: 'ninja' }, { name: '수빈', fraction: .54, avatar: 'rabbit' }];
  const RULES = [{ id: 'high', name: '하이', hint: '낮으면 걸림' }, { id: 'low', name: '로우', hint: '높으면 걸림' }, { id: 'near', name: '니어', hint: '가까우면 걸림' }];
  const MAX_VALUES = [6, 100, 1000];
  const DEFAULT_MAX = 100;
  const MAX_TARGET = 100000;
  const state = { rule: 'high', max: DEFAULT_MAX, target: 50, rolled: false };
  const ui = window.GameMobileMock;
  const el = ui.el;
  const img = (src, className = '') => { const node = el('img', className); node.src = src; node.alt = ''; return node; };
  const score = person => Math.max(1, Math.round(person.fraction * (person.name === '나' ? state.max : DEFAULT_MAX)));
  const currentRule = () => RULES.find(rule => rule.id === state.rule);
  const ruleCaption = () => state.rule === 'near' ? `${state.target}에 가장 가까운 사람이 걸려요` : state.rule === 'high' ? '가장 낮은 사람이 걸려요' : '가장 높은 사람이 걸려요';
  const winner = () => [...DEMO].sort((a, b) => state.rule === 'near' ? Math.abs(score(a) - state.target) - Math.abs(score(b) - state.target) : state.rule === 'high' ? score(a) - score(b) : score(b) - score(a))[0];
  function heading(host, title, badge) { const head = el('div', 'page-head'); head.append(el('h2', '', title), el('span', 'pill', badge)); host.append(head); }
  function ad(host) { host.append(el('div', 'ad', 'AD')); }
  function scoreRows(host, result) {
    const list = el('div', 'dice-score-list');
    DEMO.forEach((person, index) => {
      const selected = result && winner().name === person.name;
      const row = el('div', `dice-score-row${selected ? ' is-winner' : ''}`);
      row.append(img(`/mockups/assets/veh-${person.avatar}-1.webp`), el('span', 'score-name', person.name));
      if (selected) row.append(el('span', 'pill', '당첨'));
      row.append(el('span', 'score-value', !result && index === 0 && !state.rolled ? '—' : String(score(person)))); list.append(row);
    }); host.append(list);
  }
  function render(host, stage) {
    if (stage === 'ready') {
      state.rolled = false;
      heading(host, '주사위 준비', '3 / 3 준비');
      const card = el('section', 'card');
      const art = el('div', 'dice-stack'); art.setAttribute('aria-hidden', 'true'); art.append(el('div', 'dice-cube', '⚄'), el('div', 'dice-cube', '⚂')); card.append(art);
      const title = el('div', 'section-head'); title.append(el('h3', '', '게임 규칙')); card.append(title);
      const rules = el('div', 'dice-rules');
      RULES.forEach(rule => { const button = el('button', 'dice-rule'); button.type = 'button'; button.setAttribute('aria-pressed', String(rule.id === state.rule)); button.append(el('strong', '', rule.name), el('small', '', rule.hint)); button.addEventListener('click', () => { state.rule = rule.id; ui.setStage('ready'); }); rules.append(button); }); card.append(rules);
      const range = el('label', 'dice-settings'); range.append(el('span', '', '내 주사위 범위')); const select = el('select'); select.setAttribute('aria-label', '내 주사위 범위'); MAX_VALUES.forEach(max => { const option = el('option', '', `1 – ${max}`); option.value = max; option.selected = state.max === max; select.append(option); }); select.addEventListener('change', () => { state.max = Number(select.value); if (state.rule === 'near') ui.setStage('ready'); }); range.append(select); card.append(range);
      if (state.rule === 'near') { const near = el('label', 'dice-settings'); near.append(el('span', '', '목표 숫자')); const input = el('input'); input.type = 'number'; input.min = 1; input.max = MAX_TARGET; input.value = state.target; input.setAttribute('aria-label', '니어 목표 숫자'); input.addEventListener('change', () => { state.target = Math.min(MAX_TARGET, Math.max(1, Number(input.value) || 1)); input.value = state.target; }); near.append(input); card.append(near); }
      host.append(card); const people = el('div', 'dice-people'); DEMO.forEach(person => { const item = el('div', 'dice-person'); item.append(img(`/mockups/assets/veh-${person.avatar}-1.webp`), el('span', 'name', person.name), el('span', 'status', '준비 완료')); people.append(item); }); host.append(people); ad(host);
      ui.setAction('주사위 시작', () => { state.rolled = false; ui.setStage('playing'); });
    } else if (stage === 'playing') {
      heading(host, '주사위 굴리기', state.rolled ? '3 / 3 완료' : '2 / 3 완료');
      const panel = el('section', `dice-roll-panel${state.rolled ? ' rolled' : ''}`); panel.append(img('/mockups/assets/ic-dice.png', 'dice-mini'), el('p', 'muted', state.rolled ? '내 주사위' : '내 차례예요'), el('strong', `dice-value${state.rolled ? '' : ' pending'}`, state.rolled ? String(score(DEMO[0])) : '?'), el('span', 'pill', `1 – ${state.max}`)); host.append(panel);
      host.append(el('p', 'dice-rule-caption', ruleCaption())); scoreRows(host, false); ad(host);
      ui.setAction(state.rolled ? '결과 보기' : '주사위 굴리기', () => { if (state.rolled) ui.setStage('result'); else { state.rolled = true; ui.setStage('playing'); } });
    } else {
      heading(host, '주사위 결과', currentRule().name);
      const selected = winner(); const hero = el('section', 'winner-card'); const visual = el('div', 'winner-visual'); visual.append(el('div', 'dice-winner-number', String(score(selected)))); const copy = el('div', 'winner-copy'); copy.append(el('span', 'accent', '당첨'), el('h3', '', selected.name), el('p', 'muted', ruleCaption())); hero.append(visual, copy); host.append(hero);
      const order = el('a', 'dice-order-link'); order.href = ui.link('dice', 'orders'); order.append(el('span', '', '주문 정리표'), el('span', 'muted', '총 3잔  ›')); host.append(order);
      const title = el('div', 'section-head'); title.append(el('h3', '', '주사위 기록'), el('span', 'muted', '예시 기록')); host.append(title); scoreRows(host, true); ad(host); ui.setAction('다시 준비', () => ui.setStage('ready'));
    }
  }
  ui.mount({ id: 'dice', name: '주사위', icon: '/mockups/assets/ic-dice.png', render });
})();
