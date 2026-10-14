/* 고정 예시 토너먼트: 민지와 수빈은 안전, 마지막 패자 '나'가 당첨. */
(() => {
  'use strict';
  const M = window.GameMobileMock;
  const SKINS = [{id:'azure',name:'애저'},{id:'emerald',name:'에메랄드'},{id:'crimson',name:'크림슨'}];
  const PEOPLE = [{name:'나',skin:'azure'},{name:'민지',skin:'crimson'},{name:'수빈',skin:'emerald'}];
  const POSITIONS = { ready: [[26,44],[72,37],[56,73]], playing: [[34,50],[70,50]] };
  const HP = [34,72];
  let skin = 'azure';
  let activeHost;
  let activeStage;
  function sprite(color) {
    const node = M.el('span',`arena-sprite ${color}`);
    node.setAttribute('aria-hidden','true');
    return node;
  }
  function fighter(person,position) {
    const color = person.name === '나' ? skin : person.skin;
    const node = M.el('div',`arena-fighter ${color}${person.name === '나' ? ' mine' : ''}`);
    node.style.left = `${position[0]}%`; node.style.top = `${position[1]}%`;
    const blades = M.el('span','arena-blades');
    blades.append(M.el('i','arena-blade'),M.el('i','arena-blade'));
    node.append(blades,sprite(color),M.el('small','',person.name));
    return node;
  }
  function drawArena(host,stage) {
    const card = M.el('section',`card arena-card${stage === 'ready' ? ' arena-ready' : ''}`);
    const header = M.el('div','section-head');
    header.append(M.el('strong','',stage === 'playing' ? '최종 결투' : '아레나'),M.el('span','muted',stage === 'playing' ? '나 vs 수빈' : '3명 준비 완료'));
    card.append(header);
    if (stage === 'playing') {
      const hud = M.el('div','arena-hud');
      [PEOPLE[0],PEOPLE[2]].forEach((p,i) => {
        if (i) hud.append(M.el('span','versus','VS'));
        const side = M.el('div'); side.append(M.el('strong','',p.name),M.el('small','',`${HP[i]} HP`));
        const health = M.el('progress',`arena-health${i === 0 ? ' low' : ''}`);
        health.max = 100; health.value = HP[i]; health.setAttribute('aria-label',`${p.name} 체력 ${HP[i]}`); side.append(health); hud.append(side);
      }); card.append(hud);
    }
    const floor = M.el('div',`arena-floor${stage === 'playing' ? ' arena-playing' : ''}`);
    floor.setAttribute('role','img'); floor.setAttribute('aria-label',stage === 'playing' ? '원형 링에서 나와 수빈이 회전하는 칼날로 겨루는 예시 장면' : '칼날을 단 참가자 세 명이 원형 링에 준비한 모습');
    floor.append(M.el('div','arena-cross'),M.el('div','arena-cross vertical'),M.el('div','arena-center',stage === 'playing' ? 'VS' : '3'));
    const players = stage === 'playing' ? [PEOPLE[0],PEOPLE[2]] : PEOPLE;
    players.forEach((p,i) => floor.append(fighter(p,POSITIONS[stage][i])));
    card.append(floor); host.append(card);
  }
  function result(host) {
    const hero = M.el('section','card winner-card');
    const visual = M.el('div','arena-result-picture'); visual.append(sprite(skin));
    const icon = M.el('img'); icon.src = '/mockups/assets/ic-swords.png'; icon.alt = ''; visual.append(icon);
    const copy = M.el('div','winner-copy'); copy.append(M.el('small','accent','당첨'),M.el('h3','','나'),M.el('p','muted','마지막 결투에서 패배했어요'));
    hero.append(visual,copy); host.append(hero);
    const order = M.el('a','orders-link'); order.dataset.sharedPage = 'orders'; order.href = M.link('spin-arena','orders');
    order.append(M.el('span','','주문 정리표'),M.el('small','','총 3잔 ›')); host.append(order);
    const list = M.el('ol','rank-list');
    [{name:'민지',skin:'crimson',status:'1라운드 안전'},{name:'수빈',skin:'emerald',status:'최종 결투 안전'},{name:'나',skin,status:'당첨'}].forEach(p => {
      const row = M.el('li',`rank-row arena-result-row${p.name === '나' ? ' target' : ''}`);
      row.append(sprite(p.skin),M.el('strong','',p.name),M.el('small','',p.status)); list.append(row);
    }); host.append(list);
    const bracket = M.el('section','card arena-bracket');
    const head = M.el('div','section-head'); head.append(M.el('strong','','결투 기록'),M.el('span','muted','예시')); bracket.append(head);
    [['1라운드','나 vs 민지','민지 안전'],['최종 결투','나 vs 수빈','수빈 안전']].forEach(([round,versus,status]) => {
      const row = M.el('div','arena-round'); row.append(M.el('span','',round),M.el('strong','',versus),M.el('b','',status)); bracket.append(row);
    }); host.append(bracket);
  }
  function render(host,stage) {
    activeHost = host; activeStage = stage;
    const head = M.el('div','page-head');
    head.append(M.el('h2','',stage === 'ready' ? '칼날 준비' : stage === 'playing' ? '칼날 대결' : '대결 결과'),M.el('span','pill',stage === 'playing' ? '최종 결투' : '1명 당첨')); host.append(head);
    if (stage === 'result') result(host);
    else {
      drawArena(host,stage);
      if (stage === 'ready') {
        const settings = M.el('section','card arena-skins');
        const heading = M.el('div','section-head'); heading.append(M.el('strong','','내 칼날'),M.el('span','muted','외형')); settings.append(heading);
        const choices = M.el('div','choice-grid');
        SKINS.forEach(s => {
          const button = M.el('button','choice'); button.type = 'button'; button.setAttribute('aria-pressed',String(skin === s.id)); button.setAttribute('aria-label',`${s.name} 스킨 선택`);
          button.append(sprite(s.id),M.el('span','',s.name));
          button.addEventListener('click',() => { skin = s.id; activeHost.replaceChildren(); render(activeHost,activeStage); }); choices.append(button);
        }); settings.append(choices); host.append(settings);
        const rule = M.el('div','card arena-rule'); rule.append(M.el('strong','','이기면 안전'),M.el('span','','끝까지 진 1명 당첨')); host.append(rule);
      } else {
        const safe = M.el('div','card arena-status'); safe.append(sprite('crimson'),M.el('strong','','민지'),M.el('span','','1라운드 안전')); host.append(safe);
      }
    }
    host.append(M.el('div','ad','AD'));
  }
  M.mount({id:'spin-arena',name:'회전 칼날',icon:'/mockups/assets/ic-swords.png',render});
})();
