/* 화면 디자인용 고정 예시. 실제 경주 결과·주문·소켓과 연결하지 않는다. */
(function () {
  'use strict';
  const FINISH_ORDER = [
    {id:'rabbit',label:'토끼',rank:1,time:12.46},
    {id:'ninja',label:'닌자',rank:2,time:12.81},
    {id:'dinosaur',label:'공룡',rank:3,time:13.05},
    {id:'crab',label:'게',rank:4,time:13.42},
    {id:'turtle',label:'거북이',rank:5,time:14.08}
  ];
  const query = new URLSearchParams(location.search);
  const rank = Number(query.get('rank'));
  const targetRank = Number.isInteger(rank) && rank >= 1 && rank <= FINISH_ORDER.length ? rank : 3;
  const myVehicle = FINISH_ORDER.some(r => r.id === query.get('vehicle')) ? query.get('vehicle') : 'dinosaur';
  const people = [
    {name:'나',vehicle:myVehicle,role:'참여자',order:'아이스 아메리카노'},
    {name:'민지',vehicle:'ninja',role:'참여자',order:'아이스 아메리카노'},
    {name:'준호',vehicle:'crab',role:'관전자',order:'카페라떼'},
    {name:'수빈',vehicle:'rabbit',role:'참여자',order:''}
  ];
  const racers = FINISH_ORDER.map(r => ({...r,users:people.filter(p => p.role !== '관전자' && p.vehicle === r.id).map(p => p.name)}));
  const winningVehicle = racers.find(r => r.rank === targetRank);
  const winners = people.filter(p => winningVehicle.users.includes(p.name));
  window.HorseRaceMockData = Object.freeze({racers,people,targetRank,myVehicle,winners});
})();
