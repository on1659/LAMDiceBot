/* Local, deterministic examples; no physics or server results are simulated. */
(function () {
  'use strict';
  const CREATURES = [
    { id: 'hedgehog', name: '고슴도치' },
    { id: 'panda', name: '판다' },
    { id: 'rabbit', name: '토끼' },
    { id: 'hamster', name: '햄스터' },
    { id: 'turtle', name: '거북이' }
  ];
  const PREVIEW_MS = 4200;
  const READY_X = [24, 50, 76];
  const STAKES = [[25, 48], [70, 51], [36, 68], [62, 74]];
  const PATHS = [
    [[24, 9], [38, 29], [59, 47], [31, 67], [50, 86]],
    [[50, 9], [70, 27], [41, 52], [65, 73], [54, 90]],
    [[76, 9], [56, 34], [27, 56], [47, 79], [46, 93]]
  ];
  const TIMES = ['12.84', '13.27', '14.12'];
  const query = new URLSearchParams(location.search);
  let selected = CREATURES.some(c => c.id === query.get('animal')) ? query.get('animal') : 'hedgehog';
  let target = query.get('target') === 'first' ? 'first' : 'last';
  let cleanup = function () {};
  const M = window.GameMobileMock;
  const el = M.el;

  function pet(id, ball) {
    const item = el('span', 'dg-pet' + (ball ? ' ball' : ''));
    item.style.backgroundImage = "url('/assets/deguri/creatures/" + id + ".webp')";
    item.setAttribute('aria-hidden', 'true');
    return item;
  }

  function updateQuery() {
    const url = new URL(location.href);
    url.searchParams.set('animal', selected);
    url.searchParams.set('target', target);
    history.replaceState({}, '', url);
  }

  function creatures() {
    return [
      { name: '나', id: selected },
      { name: '민지', id: 'panda' },
      { name: '수빈', id: 'rabbit' }
    ];
  }

  function section(title, extra) {
    const item = el('section', 'dg-section');
    const head = el('div', 'section-head');
    head.append(el('h3', '', title));
    if (extra) head.append(el('small', 'muted', extra));
    item.append(head);
    return item;
  }

  function piece(board, id, className) {
    const img = el('img', className);
    img.src = '/assets/deguri/pieces/' + id + '.webp';
    img.alt = '';
    board.append(img);
    return img;
  }

  function makeBoard(stage) {
    const board = el('div', 'dg-board' + (stage === 'playing' ? ' playing' : ''));
    board.setAttribute('role', 'img');
    board.setAttribute('aria-label', stage === 'playing' ? '초원 장애물 사이로 내려가는 세 동물' : '초원 출발대에 모인 세 동물');
    board.append(el('div', 'dg-start'), el('div', 'dg-ramp'), el('div', 'dg-ramp right'));
    piece(board, 'windmill-rotor', 'dg-rotor');
    STAKES.forEach(pos => {
      const stake = piece(board, 'stake', 'dg-stake');
      stake.style.left = pos[0] + '%';
      stake.style.top = pos[1] + '%';
    });
    piece(board, 'goal-basket-back', 'dg-goal');
    ['left', 'right'].forEach(side => {
      const bush = el('img', 'dg-bush ' + side);
      bush.src = '/assets/deguri/stage/decor-bush-big.webp';
      bush.alt = '';
      board.append(bush);
    });
    const actors = creatures().map((c, i) => {
      const actor = el('div', 'dg-actor' + (i === 0 ? ' me' : ''));
      actor.append(pet(c.id, stage === 'playing'), el('span', 'dg-actor-label', c.name));
      actor.style.left = READY_X[i] + '%';
      actor.style.top = '9%';
      board.append(actor);
      return actor;
    });
    return { board, actors };
  }

  function ready(host) {
    const picker = el('section', 'dg-section dg-compact-picker');
    picker.setAttribute('aria-label', '내 동물');
    const grid = el('div', 'dg-picker');
    CREATURES.forEach(c => {
      const button = el('button', '', '');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(c.id === selected));
      button.append(pet(c.id), el('span', '', c.name));
      button.addEventListener('click', () => { selected = c.id; updateQuery(); M.setStage('ready'); });
      grid.append(button);
    });
    picker.append(grid);
    const track = el('section', 'dg-track-card');
    const trackHead = el('div', 'dg-track-head');
    trackHead.append(el('strong', '', '초원 산책'), el('small', '', '준비 3/3'));
    track.append(trackHead, makeBoard('ready').board);
    const people = el('div', 'dg-ready-people');
    creatures().concat([{ name: '준호', id: 'turtle', spectator: true }]).forEach(c => {
      const person = el('div', 'dg-ready-person');
      person.append(el('span', '', c.name), el('small', c.spectator ? '' : 'accent', c.spectator ? '관전' : '✓'));
      people.append(person);
    });
    track.append(people);
    const rule = el('section', 'dg-compact-rule');
    rule.setAttribute('aria-label', '당첨 순위');
    rule.append(el('h3', '', '당첨'));
    const votes = el('div', 'dg-votes');
    [['first', '1등'], ['last', '꼴등']].forEach(([id, label]) => {
      const button = el('button', 'dg-vote');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(target === id));
      button.append(el('span', '', target === id ? '✓' : '○'), document.createTextNode(label));
      button.addEventListener('click', () => { target = id; updateQuery(); M.setStage('ready'); });
      votes.append(button);
    });
    rule.append(votes);
    host.append(picker, rule, track);
  }

  function playing(host) {
    const status = el('div', 'card dg-status');
    const statusCopy = el('div', 'dg-status-copy');
    const creature = CREATURES.find(c => c.id === selected);
    statusCopy.append(el('strong', '', '나 · ' + creature.name), el('small', '', '현재 순위'));
    const rank = el('b', '', '3등');
    status.append(pet(selected), statusCopy, rank);
    const track = el('section', 'dg-track-card');
    const trackHead = el('div', 'dg-track-head');
    const title = el('strong', '', '데굴데굴');
    trackHead.append(title, el('small', '', '초원 산책'));
    const scene = makeBoard('playing');
    track.append(trackHead, scene.board);
    const tools = el('div', 'dg-preview');
    const play = el('button', '', '▶');
    play.type = 'button';
    play.setAttribute('aria-label', '굴리기 미리보기 재생');
    play.setAttribute('aria-pressed', 'false');
    const slider = el('input', '');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '53';
    slider.setAttribute('aria-label', '데구리 미리보기 진행률');
    const output = el('output', '', '53%');
    tools.append(play, slider, output);
    let progress = 53;
    let animation = 0;
    let running = false;
    function render() {
      scene.actors.forEach((actor, i) => {
        const value = Math.min(3.999, progress / 25);
        const segment = Math.floor(value);
        const ratio = value - segment;
        const a = PATHS[i][segment];
        const b = PATHS[i][segment + 1];
        actor.style.left = (a[0] + (b[0] - a[0]) * ratio) + '%';
        actor.style.top = (a[1] + (b[1] - a[1]) * ratio) + '%';
        actor.firstChild.style.transform = 'rotate(' + (progress * (i % 2 ? -5 : 5)) + 'deg)';
      });
      rank.textContent = progress < 23 ? '2등' : '3등';
      title.textContent = progress === 100 ? '모두 도착!' : '데굴데굴';
      slider.value = String(progress);
      output.textContent = Math.round(progress) + '%';
    }
    function pause() {
      running = false;
      cancelAnimationFrame(animation);
      play.textContent = '▶';
      play.setAttribute('aria-label', '굴리기 미리보기 재생');
      play.setAttribute('aria-pressed', 'false');
    }
    play.addEventListener('click', () => {
      if (running) { pause(); return; }
      if (progress === 100) progress = 0;
      running = true;
      play.textContent = 'Ⅱ';
      play.setAttribute('aria-label', '굴리기 미리보기 일시정지');
      play.setAttribute('aria-pressed', 'true');
      const initial = progress;
      const start = performance.now();
      function step(now) {
        progress = Math.min(100, initial + (now - start) * 100 / PREVIEW_MS);
        render();
        if (progress < 100) animation = requestAnimationFrame(step);
        else pause();
      }
      animation = requestAnimationFrame(step);
    });
    slider.addEventListener('input', () => { pause(); progress = Number(slider.value); render(); });
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', visibility);
    cleanup = () => { pause(); document.removeEventListener('visibilitychange', visibility); };
    render();
    host.append(status, track, tools);
  }

  function result(host) {
    const ordered = [creatures()[2], creatures()[1], creatures()[0]];
    const winner = target === 'first' ? ordered[0] : ordered[2];
    const creature = CREATURES.find(c => c.id === winner.id);
    const hero = el('section', 'winner-card dg-winner');
    const visual = el('div', 'winner-visual'); visual.append(pet(winner.id));
    const copy = el('div', 'winner-copy');
    copy.append(el('span', 'pill accent', (target === 'first' ? '1등' : '꼴등') + ' 당첨'), el('h3', '', winner.name), el('p', 'muted', creature.name + ' · ' + (target === 'first' ? TIMES[0] : TIMES[2]) + '초'));
    hero.append(visual, copy);
    const order = el('a', 'dg-order-link');
    order.href = M.link('deguri', 'orders');
    order.dataset.sharedPage = 'orders';
    order.append(el('span', '', '주문 정리표  →'), el('small', '', '총 3잔'));
    const ranks = section('도착 순위', '예시 기록');
    const list = el('div', 'card dg-result-list');
    ordered.forEach((c, i) => {
      const row = el('div', 'dg-rank' + (c === winner ? ' target' : ''));
      const text = el('div', 'dg-rank-copy');
      text.append(el('strong', '', c.name + (c === winner ? ' · 당첨' : '')), el('small', '', CREATURES.find(item => item.id === c.id).name));
      row.append(el('b', '', String(i + 1)), pet(c.id), text, el('time', '', TIMES[i] + '초'));
      list.append(row);
    });
    ranks.append(list);
    host.append(hero, order, ranks);
  }

  M.mount({
    id: 'deguri',
    name: '데구리',
    icon: '/mockups/assets/ic-paw.png',
    render(host, stage) {
      cleanup(); cleanup = function () {};
      const heading = el('div', 'page-head');
      heading.append(el('h2', '', { ready: '굴릴 준비', playing: '굴러가는 중', result: '데구리 결과' }[stage]), el('span', 'pill', stage === 'ready' ? '베타' : (target === 'first' ? '1등' : '꼴등') + ' 당첨'));
      host.append(heading);
      ({ ready, playing, result })[stage](host);
      host.append(el('div', 'ad', 'AD'));
    }
  });
}());
