// 경마 차량 lose state — 외부 SVG atlas 매핑
// 각 차량의 패배 자세 (당첨 등수 = 벌칙자) 스프라이트 (120x45 atlas, 2 frames horizontal)
// 의뢰서: docs/spritemake-request/2026-05-05-horse-lose-poses.md

const VEHICLE_LOSE_STATES = (function () {
    const ids = [
        'horse', 'rabbit', 'turtle', 'bird', 'boat',
        'bicycle', 'rocket', 'car', 'eagle', 'scooter',
        'helicopter', 'knight', 'dinosaur', 'ninja', 'crab'
    ];
    const map = {};
    ids.forEach((vid) => {
        map[vid] = {
            external: true,
            src: `/assets/horse-race/sprites/lose/${vid}-lose.svg`,
            atlasWidth: 120,
            atlasHeight: 45,
            cellWidth: 60,
            cellHeight: 45,
            frames: 2
        };
    });
    return map;
})();

// 노출
function getVehicleLoseState(vehicleId) {
    return VEHICLE_LOSE_STATES[vehicleId] || null;
}
