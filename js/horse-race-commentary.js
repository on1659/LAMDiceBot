// 경마 실황 중계 텍스트 (경주 진행 중 gameStatus에 표시)
// 몇 초마다 랜덤으로 교체됨

const RACE_COMMENTARY = [
    // 실황 중계
    '앞다리에 힘을 주고 있습니다!',
    '추월 기회를 노리고 있습니다!',
    '코너를 돌아 직선 구간 진입!',
    '결승선이 보이기 시작합니다!',
    '선두 다툼이 치열합니다!',
    '뒤에서 무서운 속도로 치고 올라옵니다!',
    '관중석이 뜨거워지고 있습니다!',
    '숨 막히는 접전입니다!',
    '간격이 좁혀지고 있습니다!',
    '페이스를 올리기 시작합니다!',
    '체력 안배가 중요한 구간입니다!',
    '아직 승부는 알 수 없습니다!',
    '마지막 스퍼트를 준비하고 있습니다!',
    '역전의 드라마가 펼쳐질까?!',
    '이것은 명승부의 냄새...!',

    // 유머/밈
    '어? 1번 졸고있는데요?',
    '관중석에서 치킨 냄새가...',
    '지금 베팅 바꿀 수 있으면 좋겠다...',
    '화면 앞에서 응원하면 진짜 빨라집니다 (아님)',
    '심장이 쫄깃해지는 순간입니다',
    '내 말이 느린 게 아니라 트랙이 긴 거다',
    '방금 누가 기침했어요?',
    '이 속도면 택배보다 빠릅니다',
    '관중석 아저씨가 핫도그 떨어뜨렸습니다',
    '해설위원도 어디가 1등인지 모릅니다',
    '지금 화장실 가시면 안 됩니다!',
    '베팅은 이미 끝났습니다... 운명에 맡기세요',
    '카메라맨이 따라가기 힘들어합니다',
    '이건 실력이 아니라 운입니다 (사실 다 운임)',
    '꼴찌에게도 박수를!',
];

// 경주 중 인터벌 ID
let _raceCommentaryInterval = null;

function startRaceCommentary() {
    stopRaceCommentary();
    const gameStatus = document.getElementById('gameStatus');
    if (!gameStatus) return;

    // 즉시 첫 번째 텍스트 표시
    gameStatus.textContent = RACE_COMMENTARY[Math.floor(Math.random() * RACE_COMMENTARY.length)];

    // 3초마다 랜덤 교체
    let lastIndex = -1;
    _raceCommentaryInterval = setInterval(() => {
        let idx;
        do {
            idx = Math.floor(Math.random() * RACE_COMMENTARY.length);
        } while (idx === lastIndex && RACE_COMMENTARY.length > 1);
        lastIndex = idx;
        gameStatus.textContent = RACE_COMMENTARY[idx];
    }, 3000);
}

function stopRaceCommentary() {
    if (_raceCommentaryInterval) {
        clearInterval(_raceCommentaryInterval);
        _raceCommentaryInterval = null;
    }
}
