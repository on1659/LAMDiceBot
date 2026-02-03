// 탈것 통계 저장/조회 (경마)
const fs = require('fs');
const path = require('path');
const { getPool } = require('./pool');

const STATS_FILE = path.join(__dirname, '..', 'config', 'vehicle-stats.json');

function loadStatsFromFile() {
    try {
        if (fs.existsSync(STATS_FILE)) {
            const data = fs.readFileSync(STATS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            return parsed && typeof parsed === 'object' ? parsed : {};
        }
    } catch (error) {
        console.error('탈것 통계 파일 읽기 오류:', error);
    }
    return {};
}

function saveStatsToFile(stats) {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
    } catch (error) {
        console.error('탈것 통계 파일 쓰기 오류:', error);
    }
}

/**
 * 경기 종료 시 탈것 통계 저장
 * @param {string} serverId - 서버 ID
 * @param {Array} rankings - [{horseIndex, rank, ...}]
 * @param {Array} selectedVehicleTypes - horseIndex별 vehicleId 배열
 * @param {Object} userHorseBets - {playerName: horseIndex}
 * @param {Array} availableHorses - 경기에 참여한 horseIndex 배열
 */
async function recordVehicleRaceResult(serverId, rankings, selectedVehicleTypes, userHorseBets, availableHorses) {
    const sid = serverId || 'default';

    // 각 탈것별 선택 횟수 계산
    const pickCounts = {};
    if (userHorseBets) {
        Object.values(userHorseBets).forEach(horseIndex => {
            const vid = selectedVehicleTypes[horseIndex];
            if (vid) pickCounts[vid] = (pickCounts[vid] || 0) + 1;
        });
    }

    const pool = getPool();
    if (pool) {
        try {
            for (const r of rankings) {
                const vid = selectedVehicleTypes[r.horseIndex];
                if (!vid) continue;
                const rankCol = r.rank >= 1 && r.rank <= 6 ? `rank_${r.rank}` : null;
                const picks = pickCounts[vid] || 0;

                await pool.query(
                    `INSERT INTO vehicle_stats (server_id, vehicle_id, appearance_count, pick_count${rankCol ? `, ${rankCol}` : ''})
                     VALUES ($1, $2, 1, $3${rankCol ? ', 1' : ''})
                     ON CONFLICT (server_id, vehicle_id) DO UPDATE SET
                       appearance_count = vehicle_stats.appearance_count + 1,
                       pick_count = vehicle_stats.pick_count + $3
                       ${rankCol ? `, ${rankCol} = vehicle_stats.${rankCol} + 1` : ''}`,
                    [sid, vid, picks]
                );
            }
            return;
        } catch (e) {
            console.warn('vehicle_stats DB 저장 실패, 파일로 fallback:', e.message);
        }
    }

    // 파일 기반 fallback
    const stats = loadStatsFromFile();
    if (!stats[sid]) stats[sid] = {};

    for (const r of rankings) {
        const vid = selectedVehicleTypes[r.horseIndex];
        if (!vid) continue;
        if (!stats[sid][vid]) {
            stats[sid][vid] = { appearance_count: 0, pick_count: 0, rank_1: 0, rank_2: 0, rank_3: 0, rank_4: 0, rank_5: 0, rank_6: 0 };
        }
        const s = stats[sid][vid];
        s.appearance_count += 1;
        s.pick_count += (pickCounts[vid] || 0);
        if (r.rank >= 1 && r.rank <= 6) {
            s[`rank_${r.rank}`] += 1;
        }
    }

    saveStatsToFile(stats);
}

/**
 * 서버별 탈것 통계 조회
 * @param {string} serverId
 * @returns {Array} [{vehicle_id, appearance_count, pick_count, rank_1..rank_6, pick_rate}]
 */
async function getVehicleStats(serverId) {
    const sid = serverId || 'default';
    const pool = getPool();

    if (pool) {
        try {
            const res = await pool.query(
                'SELECT vehicle_id, appearance_count, pick_count, rank_1, rank_2, rank_3, rank_4, rank_5, rank_6 FROM vehicle_stats WHERE server_id = $1',
                [sid]
            );
            return (res.rows || []).map(r => ({
                ...r,
                pick_rate: r.appearance_count > 0 ? r.pick_count / r.appearance_count : 0
            }));
        } catch (e) {
            console.warn('vehicle_stats DB 조회 실패:', e.message);
        }
    }

    // 파일 fallback
    const stats = loadStatsFromFile();
    const serverStats = stats[sid] || {};
    return Object.entries(serverStats).map(([vehicle_id, s]) => ({
        vehicle_id,
        ...s,
        pick_rate: s.appearance_count > 0 ? s.pick_count / s.appearance_count : 0
    }));
}

/**
 * 인기말 vehicle_id 목록 반환 (pick_rate 상위, 최소 등장 5회)
 * @param {string} serverId
 * @param {number} topN - 상위 몇 개 (기본 2)
 * @returns {Array} ['rocket', 'car']
 */
async function getPopularVehicles(serverId, topN = 2) {
    const allStats = await getVehicleStats(serverId);
    const qualified = allStats.filter(s => s.appearance_count >= 5);
    qualified.sort((a, b) => b.pick_rate - a.pick_rate);
    return qualified.slice(0, topN).map(s => s.vehicle_id);
}

module.exports = {
    recordVehicleRaceResult,
    getVehicleStats,
    getPopularVehicles
};
