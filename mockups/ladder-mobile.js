/* 독립 목업: 고정 사다리 경로를 보여 주며 실제 게임과 연결하지 않는다. */
(() => {
  'use strict';
  const M = window.GameMobileMock;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LANES = 6;
  const TARGET = 0;
  const TOP = 16;
  const BOTTOM = 238;
  const X_START = 25;
  const X_STEP = 50;
  const RUNGS = [[0,44],[2,78],[1,112],[3,146],[2,180],[4,214]];
  const PEOPLE = [
    { name: '나', lane: 1, image: '/mockups/assets/veh-dinosaur-1.webp' },
    { name: '민지', lane: 0, image: '/mockups/assets/veh-ninja-1.webp' },
    { name: '수빈', lane: 4, image: '/mockups/assets/veh-rabbit-1.webp' }
  ];
  let selected = 1;
  let activeHost;
  let activeStage;
  const x = lane => X_START + lane * X_STEP;
  function trace(start) {
    let lane = start;
    const points = [[x(lane),TOP]];
    RUNGS.forEach(([left,y]) => {
      if (lane === left || lane === left + 1) {
        points.push([x(lane),y]);
        lane = lane === left ? left + 1 : left;
        points.push([x(lane),y]);
      }
    });
    points.push([x(lane),BOTTOM]);
    return { lane, d: points.map((p,i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ') };
  }
  function svgNode(tag,attrs) {
    const node = document.createElementNS(SVG_NS,tag);
    Object.entries(attrs).forEach(([name,value]) => node.setAttribute(name,String(value)));
    return node;
  }
  function drawBoard(host,stage) {
    const card = M.el('section',`card ladder-board${stage === 'result' ? ' ladder-result' : ''}`);
    const header = M.el('div','section-head');
    header.append(M.el('strong','',stage === 'ready' ? '내려갈 칸' : '사다리'));
    header.append(M.el('span','muted',stage === 'playing' ? '경로 확인 중' : stage === 'result' ? '도착 완료' : '6칸 중 하나'));
    card.append(header);
    const lanes = M.el('div','ladder-lanes');
    for (let i = 0; i < LANES; i += 1) {
      const button = M.el('button','ladder-lane');
      button.type = 'button';
      button.setAttribute('aria-label',`${i + 1}번 칸 선택`);
      button.setAttribute('aria-pressed',String(selected === i));
      button.disabled = stage !== 'ready';
      button.append(M.el('span','',String(i + 1)));
      const names = PEOPLE.filter(p => (p.name === '나' ? selected : p.lane) === i).map(p => p.name).join('·');
      button.append(M.el('small','',names));
      button.addEventListener('click',() => { selected = i; activeHost.replaceChildren(); render(activeHost,activeStage); });
      lanes.append(button);
    }
    card.append(lanes);
    const svg = svgNode('svg',{viewBox:'0 0 300 254',preserveAspectRatio:'none',class:'ladder-lines',role:'img','aria-label': stage === 'ready' ? '6개 세로 기둥과 가로 막대기로 연결된 사다리' : `${selected + 1}번에서 ${trace(selected).lane + 1}번으로 이어지는 내 경로`});
    for (let i = 0; i < LANES; i += 1) svg.append(svgNode('line',{x1:x(i),y1:TOP,x2:x(i),y2:BOTTOM,class:'ladder-rail'}));
    RUNGS.forEach(([left,y]) => svg.append(svgNode('line',{x1:x(left),y1:y,x2:x(left + 1),y2:y,class:'ladder-rung'})));
    if (stage !== 'ready') {
      PEOPLE.filter(p => p.name !== '나').forEach(p => svg.append(svgNode('path',{d:trace(p.lane).d,class:'ladder-route-other'})));
      svg.append(svgNode('path',{d:trace(selected).d,class:`ladder-route${stage === 'playing' ? ' ladder-tracing' : ''}`}));
      svg.append(svgNode('circle',{cx:x(selected),cy:TOP,r:7,class:'ladder-token'}));
      if (stage === 'result') svg.append(svgNode('circle',{cx:x(trace(selected).lane),cy:BOTTOM,r:7,class:'ladder-token'}));
    }
    card.append(svg);
    const landings = M.el('div','ladder-landings');
    for (let i = 0; i < LANES; i += 1) landings.append(M.el('div',`ladder-end${i === TARGET ? ' target' : ''}`,i === TARGET ? '당첨' : '통과'));
    card.append(landings);
    host.append(card);
  }
  function render(host,stage) {
    activeHost = host;
    activeStage = stage;
    const head = M.el('div','page-head');
    head.append(M.el('h2','',stage === 'ready' ? '사다리 준비' : stage === 'playing' ? '내려가는 중' : '사다리 결과'));
    head.append(M.el('span','pill',stage === 'ready' ? '3명 준비' : '1라운드'));
    host.append(head);
    if (stage === 'result') {
      const winners = PEOPLE.filter(p => trace(p.name === '나' ? selected : p.lane).lane === TARGET).map(p => p.name);
      const hero = M.el('section','card winner-card');
      const visual = M.el('div','ladder-winner-visual');
      const image = M.el('img'); image.src = '/mockups/assets/ic-ladder.png'; image.alt = ''; visual.append(image);
      const copy = M.el('div','winner-copy');
      copy.append(M.el('small','accent','당첨'),M.el('h3','',winners.join(', ') || '당첨자 없음'),M.el('p','muted',winners.length ? '1번 칸에 도착했어요' : '선택한 사람이 없어요'));
      hero.append(visual,copy); host.append(hero);
      const order = M.el('a','card ladder-order'); order.dataset.sharedPage = 'orders'; order.href = M.link('ladder','orders');
      order.append(M.el('span','','주문 정리표'),M.el('span','','총 3잔 ›')); host.append(order);
    } else {
      const mine = M.el('div','card ladder-selection');
      const copy = M.el('div'); copy.append(M.el('small','','내가 고른 칸'),M.el('strong','','나'));
      mine.append(copy,M.el('span','selected-number',`${selected + 1}`)); host.append(mine);
    }
    drawBoard(host,stage);
    if (stage !== 'result') {
      const people = M.el('div','card ladder-people');
      PEOPLE.forEach(p => {
        const entry = M.el('div','ladder-person');
        const image = M.el('img'); image.src = p.image; image.alt = '';
        entry.append(image,M.el('span','',p.name),M.el('small','',`${(p.name === '나' ? selected : p.lane) + 1}번`)); people.append(entry);
      }); host.append(people);
    }
    host.append(M.el('div','ad','AD'));
  }
  M.mount({id:'ladder',name:'사다리',icon:'/mockups/assets/ic-ladder.png',render});
})();
