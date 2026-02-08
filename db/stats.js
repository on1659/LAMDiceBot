// 방문자/플레이 통계
const { getPool } = require('./pool');
const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, '..', 'stats.json');

function loadStatsFromFile() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        }
    } catch (e) {
        console.warn('stats.json 로드 실패:', e.message);
    }
    return null;
}

async function saveStatsToFile() {
    try {
        const data = {
            visitorTotalCount,
            playTotalCount,
            gameStatsByType,
            recentPlaysList
        };
        await fs.promises.writeFile(STATS_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.warn('stats.json 저장 실패:', e.message);
    }
}

// 방문자 통계
let visitorTodayDate = '';
let visitorTodayIPs = new Set();
let visitorTodayParticipantIds = new Set();
let visitorTotalCount = 0;

// 플레이 통계
let playTodayDate = '';
let playTodayCount = 0;
let playTotalCount = 0;
const DEFAULT_GAME_STATS = () => ({ dice: { count: 0, totalParticipants: 0 }, roulette: { count: 0, totalParticipants: 0 }, 'horse-race': { count: 0, totalParticipants: 0 }, team: { count: 0, totalParticipants: 0 } });
let gameStatsByType = DEFAULT_GAME_STATS();
const RECENT_PLAYS_MAX = 50;
let recentPlaysList = [];

async function loadVisitorStatsFromDB() {
    const pool = getPool();
    if (!pool) {
        // DB 없으면 파일에서 로드
        const saved = loadStatsFromFile();
        if (saved) {
            visitorTotalCount = saved.visitorTotalCount || 0;
            console.log(`ℹ️  파일에서 방문자 통계 로드: 총 ${visitorTotalCount}`);
        }
        return;
    }
    try {
        const totalRes = await pool.query('SELECT total_participations FROM visitor_total WHERE id = 1');
        if (totalRes.rows[0]) visitorTotalCount = parseInt(totalRes.rows[0].total_participations, 10) || 0;
        const today = new Date().toISOString().split('T')[0];
        visitorTodayDate = today;
        visitorTodayIPs = new Set();
        const todayRes = await pool.query('SELECT ip FROM visitor_today WHERE event_date = $1::date', [today]);
        todayRes.rows.forEach(row => visitorTodayIPs.add(row.ip));
    } catch (e) {
        console.warn('방문자 통계 DB 로드 실패:', e.message);
    }
}

async function loadPlayStatsFromDB() {
    const pool = getPool();
    if (!pool) {
        // DB 없으면 파일에서 로드
        const saved = loadStatsFromFile();
        if (saved) {
            playTotalCount = saved.playTotalCount || 0;
            gameStatsByType = saved.gameStatsByType || DEFAULT_GAME_STATS();
            recentPlaysList = saved.recentPlaysList || [];
            console.log(`ℹ️  파일에서 플레이 통계 로드: 총 ${playTotalCount}회`);
        }
        return;
    }
    try {
        const today = new Date().toISOString().split('T')[0];
        const totalRes = await pool.query('SELECT COUNT(*) AS cnt FROM game_records');
        const todayRes = await pool.query('SELECT COUNT(*) AS cnt FROM game_records WHERE played_at::date = $1::date', [today]);
        playTotalCount = parseInt(totalRes.rows[0]?.cnt, 10) || 0;
        playTodayCount = parseInt(todayRes.rows[0]?.cnt, 10) || 0;
        playTodayDate = today;
    } catch (e) {
        console.warn('플레이 통계 DB 로드 실패:', e.message);
    }
}

function getVisitorStats() {
    const today = new Date().toISOString().split('T')[0];
    if (visitorTodayDate !== today) {
        visitorTodayDate = today;
        visitorTodayIPs = new Set();
        visitorTodayParticipantIds = new Set();
    }
    const todayVisitors = visitorTodayParticipantIds.size > 0 ? visitorTodayParticipantIds.size : visitorTodayIPs.size;
    if (playTodayDate !== today) {
        playTodayDate = today;
        playTodayCount = 0;
    }
    return { todayVisitors, todayPlays: playTodayCount, totalPlays: playTotalCount };
}

function recordVisitor(ip, source, participantId) {
    const pool = getPool();
    const today = new Date().toISOString().split('T')[0];
    if (visitorTodayDate !== today) {
        visitorTodayDate = today;
        visitorTodayIPs = new Set();
        visitorTodayParticipantIds = new Set();
    }
    visitorTodayIPs.add(ip);
    if (participantId != null && participantId !== '') visitorTodayParticipantIds.add(participantId);
    visitorTotalCount++;
    if (!pool) {
        saveStatsToFile();
    }
    if (pool) {
        pool.query(
            'INSERT INTO visitor_today (event_date, ip) VALUES ($1::date, $2) ON CONFLICT (event_date, ip) DO NOTHING',
            [today, ip]
        ).catch(e => console.warn('visitor_today insert:', e.message));
        pool.query('UPDATE visitor_total SET total_participations = total_participations + 1 WHERE id = 1')
            .catch(e => console.warn('visitor_total update:', e.message));
    }
    return getVisitorStats();
}

function recordParticipantVisitor(io, socketId) {
    const sock = io.sockets.sockets.get(socketId);
    if (sock && sock.clientIP) recordVisitor(sock.clientIP, 'gameStart', sock.id);
}

function recordGamePlay(gameType, participantCount) {
    const pool = getPool();
    if (!gameType || participantCount < 1) return;
    const key = String(gameType);
    const today = new Date().toISOString().split('T')[0];
    if (playTodayDate !== today) {
        playTodayDate = today;
        playTodayCount = 0;
    }
    playTodayCount++;
    playTotalCount++;
    if (pool) {
        pool.query(
            'INSERT INTO game_records (game_type, participant_count) VALUES ($1, $2)',
            [key, Math.max(1, participantCount)]
        ).catch(e => console.warn('game_records insert:', e.message));
    } else {
        if (!gameStatsByType[key]) gameStatsByType[key] = { count: 0, totalParticipants: 0 };
        gameStatsByType[key].count += 1;
        gameStatsByType[key].totalParticipants += Math.max(1, participantCount);
        recentPlaysList.unshift({ gameType: key, participantCount: Math.max(1, participantCount), playedAt: new Date().toISOString() });
        recentPlaysList = recentPlaysList.slice(0, RECENT_PLAYS_MAX);
        saveStatsToFile();
    }
}

function getGameStatsByType() { return gameStatsByType; }
function getRecentPlaysList() { return recentPlaysList; }

module.exports = {
    loadVisitorStatsFromDB, loadPlayStatsFromDB,
    getVisitorStats, recordVisitor, recordParticipantVisitor, recordGamePlay,
    getGameStatsByType, getRecentPlaysList
};
