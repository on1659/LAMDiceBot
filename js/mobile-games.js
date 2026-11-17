// 모바일에 공개한 순서대로 표시한다. 키는 서버의 gameType이며, 경로와 저장 키는 각 게임의 실제 진입 계약을 따른다.
const MOBILE_GAMES = {
  'horse-race': {
    name: '경마', icon: 'ui-horse', path: '/horse-race',
    nameKey: 'horseRaceUserName', createKey: 'pendingHorseRaceRoom', joinKey: 'pendingHorseRaceJoin'
  },
  dice: { name: '주사위', icon: 'ui-dice', path: '/game' }, // 로비 소켓에서 생성·합류 후 diceActiveRoom으로 인계
  roulette: {
    name: '룰렛', icon: 'ui-target', path: '/roulette-game-multiplayer.html',
    nameKey: 'rouletteUserName', createKey: 'pendingRouletteRoom', joinKey: 'pendingRouletteJoin'
  },
  deguri: {
    name: '데구리', icon: 'ui-paw', path: '/deguri',
    nameKey: 'deguriUserName', createKey: 'pendingDeguriRoom', joinKey: 'pendingDeguriJoin'
  }
};
