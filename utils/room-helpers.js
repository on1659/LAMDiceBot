// 방 관리 유틸리티
const crypto = require('crypto');
const { loadFrequentMenus } = require('../db/menus');
const { releaseShortcode } = require('./shortcode');

function generateRoomId() {
    return crypto.randomBytes(4).toString('hex');
}

function createRoomGameState() {
    return {
        users: [],
        isGameActive: false,
        isOrderActive: false,
        orderAutoTriggered: false,
        diceMax: 100,
        history: [],
        rolledUsers: [],
        gamePlayers: [],
        everPlayedUsers: [],
        readyUsers: [],
        userDiceSettings: {},
        userOrders: {},
        userDefaultOrders: {},   // { [userName]: { menuText, mode } } — joinRoom 시 DB에서 로드된 디폴트 캐시 (비공개 서버 전용)
        gameRules: '',
        frequentMenus: loadFrequentMenus(),
        allPlayersRolledMessageSent: false,
        chatHistory: [],
        rouletteHistory: [],
        isRouletteSpinning: false,
        userColors: {},
        horseRaceHistory: [],
        isHorseRaceActive: false,
        availableHorses: [],
        userHorseBets: {},
        userRankVotes: {},        // { [userName]: 1-based rank } — N등 찾기 투표
        targetRank: null,         // 룰렛 결정 결과 등수. null = 'last' fallback
        rouletteResult: null,     // { segments, winningRank, animDurationMs } — 클라 애니용
        horseRankings: [],
        horseRaceMode: 'last',
        craneGameHistory: [],
        isCraneGameActive: false,
        bridgeCross: {
            // history-v1 (오징어게임 방식 + 병렬진행, 2026-04-30) — feat/bridge-cross-history-v1 복원
            phase: 'idle',
            userColorBets: {},
            activeColors: [],
            safeRows: [],
            scenarios: [],
            bettingDeadline: 0,
            bettingTimeout: null,
            endTimeout: null,
            isBridgeCrossActive: false,
            bridgeCrossHistory: [],
            raceRound: 0,
            winnerColor: null,
            passingColors: [],
            winners: []
        },
        ladder: {
            phase: 'idle',          // idle(로비/빌드) | selecting | revealing | finished
            numLanes: 0,
            userRungs: {},          // { [userName]: [{ id, c, y, slant, points }] } — 유저가 직접 놓은 막대기 배열(인당 ≤3, 가시)
            baseRungs: [],          // 가시 [{ id, c, y, slant }] — 빌드 오픈 시 1회 생성, rungsUpdated로 공개
            baseRungsGenerated: false, // base 막대기 1회 생성 가드 (멱등)
            colorIndex: {},         // { [userName]: int } — drawer 색 인덱스(서버 권위, 결정적). 라운드마다 재배정
            rungSeq: 0,             // 막대기 id 단조 카운터(서버 권위) — Math.random/timestamp 금지
            rungs: [],              // server-only [{ id, c, y, slant, points, user, owner }] — 스크램블 후 final(y정렬, reveal 시 전송)
            erased: [],             // server-only — 스크램블이 지운 막대기 (reveal 연출용)
            added: [],              // server-only — 스크램블이 추가한 막대기 (reveal 연출용)
            kkwangBottom: -1,
            laneToBottom: [],       // server-only
            losingLane: -1,         // server-only
            userLanes: {},          // { [userName]: laneIndex }
            participants: [],
            revealOrder: [],        // reveal 시 서버가 셔플한 하강 순서 (시각 효과, 결과 무관)
            loser: null,
            ladderHistory: [],
            round: 0,
            isLadderActive: false,
            revealTimeout: null,
            endTimeout: null,
            resetTimeout: null
        },
        spinArena: {
            phase: 'idle',          // idle | playing | finished
            skins: {},              // { userName: skinId }
            participants: [],       // 시작 시점 사람 참가자 이름
            timeline: null,         // server-only: 토너먼트 브래킷 { slots, bracket:{ poolOrder, rounds[{roundIdx,durationMs,duels[{duelId,slotA,slotB,frames,durationMs,decideMs,loserSlot,winnerSlot,bladeA,bladeB}],byes}], finalLoser, loserDepth }, geom, sampleMs, durationMs } (재진입 마스킹 대상 — bracket은 timeline에만, reveal 1회 외 비노출)
            result: null,           // server-only: { selected, rankings, successionList } (selected = finalLoser = 당첨)
            seed: 0,                // server-only
            round: 0,
            history: [],
            isActive: false,
            playTimeout: null,
            endTimeout: null,
            resetTimeout: null
        },
        pirate: {
            phase: 'idle',          // idle | selecting | finished
            claims: {},             // { [holeIndex]: userName }
            triggerHole: null,      // server-only: 걸리는 구멍 (reveal 전 미노출)
            seed: 0,                // server-only: 감사용 시드
            timeLimitSec: 30,       // 호스트 설정 선택 제한시간(10~60)
            deadlineTs: 0,          // 서버 권위 데드라인(epoch ms) — 클라 시계 재동기용
            participants: [],       // 시작 시점 사람 참가자 이름
            holeCount: 0,           // 이번 판 구멍 수 (= 참가자 수)
            round: 0,
            history: [],
            isActive: false,
            deadlineTimeout: null,
            resetTimeout: null
        },
    };
}

// 방 삭제 헬퍼 — shortcode cleanup 포함
// 모든 `delete rooms[roomId]` 호출 지점에서 이 헬퍼를 사용해야
// /free 발급 shortcode 메모리 누수를 막을 수 있다.
function deleteRoom(rooms, roomId) {
    if (!rooms || !roomId) return;
    const room = rooms[roomId];
    if (room && room.shortcode) {
        releaseShortcode(room.shortcode);
    }
    delete rooms[roomId];
}

module.exports = { generateRoomId, createRoomGameState, deleteRoom };
