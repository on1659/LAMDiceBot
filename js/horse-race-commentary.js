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

const EVOLUTION_COMMENTARY = {
    evolutionCharge: [
        '{subject} 주변이 번쩍입니다. 뭔가 옵니다.',
        '{subject}, 방금 분위기가 달라졌습니다. 예고 신호입니다.',
        '{subject} 쪽에서 이상한 빛이 올라옵니다.'
    ],
    evolutionBurst: [
        '{subject} 진화 발동! 해설석도 방금 눈 떴습니다.',
        '{subject}, Evolution! 지금부터 장르가 살짝 바뀝니다.',
        '{subject}가 각성합니다. 이 장면은 그냥 못 지나갑니다.'
    ],
    evolutionBoost: [
        '{subject} 각성 질주 시작! 지금부터 속도가 달라집니다.',
        '{subject}, 파워 모드 진입! 뒤쪽 계산이 복잡해집니다.',
        '{subject}가 부스터를 밟았습니다. 화면이 따라가기 바빠집니다.'
    ],
    evolutionLead: [
        '{subject}, 부스터로 선두까지 치고 올라옵니다!',
        '{subject}가 선두를 잡습니다. Evolution 효과가 제대로 터졌습니다.',
        '{subject}, 각성 질주로 판을 뒤집고 있습니다!'
    ],
    evolutionWin: [
        '{subject} 그대로 결승선 통과! Evolution이 판을 뒤집었습니다.',
        '{subject}, 각성 질주 끝에 1등입니다!',
        '{subject} 우승! 방금 Evolution이 하이라이트를 가져갔습니다.'
    ]
};

// 경주 중 인터벌 ID
let _raceCommentaryInterval = null;
let _raceCommentaryHoldUntil = 0;

function showRaceCommentaryOnce(text, holdMs = 3000) {
    const gameStatus = document.getElementById('gameStatus');
    if (!gameStatus || !text) return;

    gameStatus.textContent = text;
    _raceCommentaryHoldUntil = Date.now() + holdMs;
}

function announceEvolutionCommentary(stage, subject = '해당 말', holdMs = 3200) {
    const comments = EVOLUTION_COMMENTARY[stage] || [];
    if (comments.length === 0) return;

    const comment = comments[Math.floor(Math.random() * comments.length)]
        .replace(/\{subject\}/g, subject);
    showRaceCommentaryOnce(comment, holdMs);
}

function startRaceCommentary() {
    stopRaceCommentary();
    const gameStatus = document.getElementById('gameStatus');
    if (!gameStatus) return;

    // 즉시 첫 번째 텍스트 표시
    gameStatus.textContent = RACE_COMMENTARY[Math.floor(Math.random() * RACE_COMMENTARY.length)];

    // 3초마다 랜덤 교체
    let lastIndex = -1;
    _raceCommentaryInterval = setInterval(() => {
        if (Date.now() < _raceCommentaryHoldUntil) return;

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
    _raceCommentaryHoldUntil = 0;
}
