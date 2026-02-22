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

        // ─── 서버 시스템 테이블 ───
        await pool.query(`
            CREATE TABLE IF NOT EXISTS servers (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                host_id VARCHAR(255) NOT NULL,
                host_name VARCHAR(50) NOT NULL,
                password_hash VARCHAR(255) DEFAULT '',
                host_code VARCHAR(10) DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true
            )
        `);
        // 기존 테이블에 누락된 컬럼 보정 (CREATE TABLE IF NOT EXISTS는 기존 테이블 미수정)
        await pool.query(`DO $$ BEGIN ALTER TABLE servers ADD COLUMN password_hash VARCHAR(255) DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE servers ADD COLUMN host_code VARCHAR(10) DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE servers ADD COLUMN is_active BOOLEAN DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_servers_host_id ON servers(host_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_servers_is_active ON servers(is_active)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS server_members (
                id SERIAL PRIMARY KEY,
                server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
                user_name VARCHAR(50) NOT NULL,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_approved BOOLEAN DEFAULT true,
                last_seen_at TIMESTAMP,
                UNIQUE(server_id, user_name)
            )
        `);
        // server_members 누락 컬럼 보정
        await pool.query(`DO $$ BEGIN ALTER TABLE server_members ADD COLUMN is_approved BOOLEAN DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE server_members ADD COLUMN last_seen_at TIMESTAMP; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_server_members_server_id ON server_members(server_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_server_members_user_name ON server_members(user_name)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS server_game_records (
                id SERIAL PRIMARY KEY,
                server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
                user_name VARCHAR(50) NOT NULL,
                result INTEGER NOT NULL,
                game_type VARCHAR(20) NOT NULL,
                is_winner BOOLEAN DEFAULT false,
                game_session_id VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sgr_server_id ON server_game_records(server_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sgr_user_name ON server_game_records(user_name)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sgr_created_at ON server_game_records(created_at)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_sgr_server_user ON server_game_records(server_id, user_name)`);

        // server_game_records 추가 컬럼 (범위, 룰, 등수)
        await pool.query(`DO $$ BEGIN ALTER TABLE server_game_records ADD COLUMN range_min INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE server_game_records ADD COLUMN range_max INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE server_game_records ADD COLUMN game_rules TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
        await pool.query(`DO $$ BEGIN ALTER TABLE server_game_records ADD COLUMN game_rank INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);

        // ─── 게임 세션 테이블 ───
        await pool.query(`
            CREATE TABLE IF NOT EXISTS game_sessions (
                id SERIAL PRIMARY KEY,
                server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
                session_id VARCHAR(100) UNIQUE NOT NULL,
                game_type VARCHAR(20) NOT NULL,
                game_rules TEXT,
                winner_name VARCHAR(50),
                winner_result INTEGER,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP,
                participant_count INTEGER DEFAULT 0
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_sessions_server_id ON game_sessions(server_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_sessions_session_id ON game_sessions(session_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_sessions_game_type ON game_sessions(game_type)`);

        // game_records에 server_id 컬럼 추가 (기존 데이터는 NULL)
        await pool.query(`
            DO $$ BEGIN
                ALTER TABLE game_records ADD COLUMN server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_column THEN NULL;
            END $$
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_records_server_id ON game_records(server_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_records_game_type ON game_records(game_type)`);

        // ─── 기존 테이블 ───
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

        // ─── 유저 인증 테이블 ───
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) UNIQUE NOT NULL,
                pin_hash VARCHAR(255) NOT NULL,
                is_admin BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login_at TIMESTAMP
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_name ON users(name)`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS flags INTEGER DEFAULT 0`);

        // ─── 주문 통계 테이블 (랭킹용) ───
        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_stats (
                id SERIAL PRIMARY KEY,
                server_id INTEGER NOT NULL DEFAULT 0,
                user_name VARCHAR(50) NOT NULL,
                menu_text VARCHAR(100) NOT NULL,
                order_count INTEGER DEFAULT 1,
                UNIQUE(server_id, user_name, menu_text)
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_order_stats_server ON order_stats(server_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_order_stats_user ON order_stats(server_id, user_name)`);

        // ─── 태그라인 테이블 ───
        await pool.query(`
            CREATE TABLE IF NOT EXISTS taglines (
                id SERIAL PRIMARY KEY,
                text VARCHAR(100) NOT NULL UNIQUE,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            ALTER TABLE taglines ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'tagline'
        `);

        // 기본 태그라인 시드 (테이블 비어있을 때만)
        const { rows: existing } = await pool.query("SELECT COUNT(*) FROM taglines WHERE type = 'tagline'");
        if (parseInt(existing[0].count) === 0) {
            const seeds = [
                '오늘 커피는 누가 쏠까?','누가 쏘는지 주사위에 맡겨','오늘도 누군가는 쏜다',
                '운빨로 승부하자','한 판에 모든 걸 건다','오늘의 운은 내 편일까?',
                '실력? 여기선 운이 전부야','변명 불가, 결과는 하나','누구도 피할 수 없는 한 판',
                '운에 맡기면 공평하잖아','이건 실력이 아니야, 운이야','오늘의 운명을 굴려보세요',
                '굴려라! 운명이 정해진다','지금 바로 한판 굴려','클릭 한 번에 승부 끝',
                '주사위는 거짓말 안 해','한번 굴리면 돌이킬 수 없다','시작은 가볍게, 결과는 잔인하게',
                '굴리기 전엔 다 자신만만','마지막에 웃는 자가 승자','결과에 승복하세요',
                '어차피 한 명은 쏜다'
            ];
            const values = seeds.map((t, i) => `($${i + 1}, 'tagline')`).join(',');
            await pool.query(`INSERT INTO taglines (text, type) VALUES ${values} ON CONFLICT (text) DO NOTHING`, seeds);
        }

        // free_sub 시드 (없을 때만)
        const { rows: existingFreeSub } = await pool.query("SELECT COUNT(*) FROM taglines WHERE type = 'free_sub'");
        if (parseInt(existingFreeSub[0].count) === 0) {
            const freeSubSeeds = [
                '회원가입 없이 바로 시작',
                '얼른 참여하세요 🔥',
                '지금 바로 한판 어때요?',
                '기다리는 방이 있어요!',
                '로그인 없이 5초 입장',
                '지금 가장 핫한 방 🎲',
                '자리 있을 때 들어오세요',
                '눈치 보지 말고 입장!',
                '빈 방 있어요, 먼저 잡아요',
                '방장 되면 규칙 내 마음대로',
            ];
            const freeSubValues = freeSubSeeds.map((t, i) => `($${i + 1}, 'free_sub')`).join(',');
            await pool.query(`INSERT INTO taglines (text, type) VALUES ${freeSubValues} ON CONFLICT (text) DO NOTHING`, freeSubSeeds);
        }

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
