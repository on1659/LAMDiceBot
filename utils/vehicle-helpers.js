const ALL_VEHICLE_IDS = ['car', 'rocket', 'bird', 'boat', 'bicycle', 'rabbit', 'turtle', 'eagle', 'scooter', 'helicopter', 'horse', 'knight', 'dinosaur', 'ninja', 'crab'];
const NEW_VEHICLE_IDS = ['knight', 'dinosaur', 'ninja', 'crab'];
const NEW_VEHICLE_WEIGHT = 2;
const VEHICLE_NAMES = {
    'car': '자동차', 'rocket': '로켓', 'bird': '새', 'boat': '보트', 'bicycle': '자전거',
    'rabbit': '토끼', 'turtle': '거북이', 'eagle': '독수리', 'scooter': '킥보드', 'helicopter': '헬리콥터', 'horse': '말',
    'knight': '기사', 'dinosaur': '공룡', 'ninja': '닌자', 'crab': '게'
};

// 신규 탈것 가중치 적용 셔플: 신규 탈것을 풀에 WEIGHT번 넣어 확률 증가
function weightedShuffleVehicles() {
    const pool = [];
    for (const id of ALL_VEHICLE_IDS) {
        const count = NEW_VEHICLE_IDS.includes(id) ? NEW_VEHICLE_WEIGHT : 1;
        for (let i = 0; i < count; i++) pool.push(id);
    }
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const seen = new Set();
    return pool.filter(id => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

module.exports = { ALL_VEHICLE_IDS, NEW_VEHICLE_IDS, NEW_VEHICLE_WEIGHT, VEHICLE_NAMES, weightedShuffleVehicles };
