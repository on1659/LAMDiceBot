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
        // 예약 시작 발화 시각(epoch ms) 또는 null. 최상위 스칼라라 rooms.js의 gameState 전량 spread를
        // 그대로 통과한다 — 결과를 흘리지 않으므로 마스킹 대상이 아니다.
        // 타이머 핸들은 여기 두지 않는다(Node Timeout은 순환 참조 → 입장 페이로드 직렬화가 깨진다).
        scheduledStartAt: null,
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
            // "경마인데 과정이 사다리" — 레인 5개 고정(번호 1~5), 번호 중복 선택 허용, 바닥에 「당첨」 1칸.
            // 기준점 9f82a1c 복원 + 5레인/중복허용/당첨/재경기. 명세: docs/goal/ladder-horse-style-5lane.md
            phase: 'idle',          // idle(빌드) | selecting(전이) | revealing | finished
            numLanes: 0,            // 이번 판의 레인 수 — 시작 시 LADDER_LANES(5)로 확정
            userLanes: {},          // { [userName]: 0..4 } — 각자 고른 출발 번호. 중복 허용(여러 이름이 같은 값)
            userRungs: {},          // { [userName]: [{ id, c, y, slant, points }] } — 유저 막대기(인당 3개, 전원 가시)
            baseRungs: [],          // 가시 기본 막대기 — 빌드 오픈 시 1회 생성, rungsUpdated로 공개
            baseRungsGenerated: false, // base 막대기 1회 생성 가드 (멱등)
            colorIndex: {},         // { [userName]: int } — drawer 색(서버 권위, 결정적). 라운드마다 재배정
            rungSeq: 0,             // 막대기 id 단조 카운터(서버 권위) — Math.random/timestamp 금지
            rungs: [],              // server-only — 스크램블 후 최종 보드(reveal에서만 전송)
            erased: [],             // server-only — 스크램블이 지운 막대기(reveal 연출용)
            added: [],              // server-only — 스크램블이 추가한 막대기(reveal 연출용)
            laneToBottom: [],       // server-only — 레인 → 도착 바닥칸 매핑
            winLane: -1,            // server-only — 당첨 레인(사람이 고른 레인 중 균등 추첨)
            winBottom: -1,          // server-only — 당첨 바닥칸(= laneToBottom[winLane])
            winners: [],            // 당첨자 — winLane을 고른 사람 전원. 2명 이상이면 재경기
            revealOrder: [],        // 하강 순서(레인 인덱스) — 마지막 두 개는 같이 내려간다
            participants: [],       // 시작 시점 참가자 스냅샷
            revealStartAt: 0,       // server-only — reveal 브로드캐스트 벽시계 원점(재진입 seek용)
            revealPayload: null,    // server-only — reveal payload 보관(재진입 개인 재전송용)
            ladderHistory: [],
            round: 0,
            isLadderActive: false,
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
            claims: {},             // { [holeIndex]: userName } — 실시간 검 점유
            triggerHole: null,      // server-only: 걸리는 구멍 (reveal 전 미노출, isPop으로만 노출)
            seed: 0,                // server-only: 감사용 시드
            seq: 0,                 // server-only: 검 삽입 단조 카운터 (FIFO 순서 근거)
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
