// 데이터베이스 테이블 초기화
const { getPool, clearPool } = require('./pool');
const { loadVisitorStatsFromDB, loadPlayStatsFromDB } = require('./stats');

async function initDatabase() {
    const pool = getPool();
    if (!pool) {
        console.log('ℹ️  DATABASE_URL이 설정되지 않았습니다. 파일 시스템을 사용합니다.');
        return;
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS suggestions (
                id SERIAL PRIMARY KEY,
                user_name VARCHAR(50) NOT NULL,
                title VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                password VARCHAR(100) NOT NULL,
                date VARCHAR(10) NOT NULL,
                time VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_suggestions_created_at
            ON suggestions(created_at DESC)
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS visitor_total (
                id INT PRIMARY KEY DEFAULT 1,
                total_participations INT NOT NULL DEFAULT 0
            )
        `);
        await pool.query(`
            INSERT INTO visitor_total (id, total_participations) VALUES (1, 0)
            ON CONFLICT (id) DO NOTHING
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS visitor_today (
                event_date DATE NOT NULL,
                ip VARCHAR(45) NOT NULL,
                PRIMARY KEY (event_date, ip)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_records (
                id SERIAL PRIMARY KEY,
                game_type VARCHAR(20) NOT NULL,
                participant_count INT NOT NULL,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_game_records_played_at ON game_records(played_at DESC)
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS frequent_menus (
                id SERIAL PRIMARY KEY,
                server_id VARCHAR(50) NOT NULL DEFAULT 'default',
                menu_text VARCHAR(200) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(server_id, menu_text)
            )
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_frequent_menus_server ON frequent_menus(server_id)
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS emoji_config (
                id SERIAL PRIMARY KEY,
                server_id VARCHAR(50) NOT NULL DEFAULT 'default',
                emoji_key VARCHAR(20) NOT NULL,
                label VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(server_id, emoji_key)
            )
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_emoji_config_server ON emoji_config(server_id)
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS vehicle_stats (
                id SERIAL PRIMARY KEY,
                server_id VARCHAR(50) NOT NULL DEFAULT 'default',
                vehicle_id VARCHAR(20) NOT NULL,
                appearance_count INT NOT NULL DEFAULT 0,
                pick_count INT NOT NULL DEFAULT 0,
                rank_1 INT NOT NULL DEFAULT 0,
                rank_2 INT NOT NULL DEFAULT 0,
                rank_3 INT NOT NULL DEFAULT 0,
                rank_4 INT NOT NULL DEFAULT 0,
                rank_5 INT NOT NULL DEFAULT 0,
                rank_6 INT NOT NULL DEFAULT 0,
                UNIQUE(server_id, vehicle_id)
            )
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_vehicle_stats_server ON vehicle_stats(server_id)
        `);

        await loadVisitorStatsFromDB();
        await loadPlayStatsFromDB();

        console.log('✅ 데이터베이스 테이블 초기화 완료');
    } catch (error) {
        const msg = error && (error.message || String(error));
        console.warn('⚠️  Postgres 연결 실패 — 파일 시스템으로 진행합니다.', msg.includes('ECONNREFUSED') ? '(로컬에 DB 없음 또는 DATABASE_URL 확인)' : msg);
        clearPool();
    }
}

module.exports = { initDatabase };
