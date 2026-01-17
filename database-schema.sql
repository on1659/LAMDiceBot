-- 서버 개념 도입을 위한 데이터베이스 스키마

-- 1. 서버 테이블
CREATE TABLE IF NOT EXISTS servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    host_id VARCHAR(255) NOT NULL, -- Socket.IO socket.id
    host_name VARCHAR(50) NOT NULL,
    password VARCHAR(20) DEFAULT '', -- 서버 패스워드 (빈 문자열이면 공개 서버)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

-- 2. 사용자-서버 관계 테이블 (멤버십)
CREATE TABLE IF NOT EXISTS server_members (
    id SERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_name VARCHAR(50) NOT NULL,
    socket_id VARCHAR(255), -- 현재 연결된 socket.id (nullable)
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, user_name)
);

-- 3. 서버별 게임 기록 테이블
CREATE TABLE IF NOT EXISTS server_game_records (
    id SERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_name VARCHAR(50) NOT NULL,
    result INTEGER NOT NULL,
    game_rules VARCHAR(200), -- 게임 룰 (하이/로우/니어 등)
    game_type VARCHAR(20) NOT NULL, -- 'dice' 또는 'roulette'
    is_winner BOOLEAN DEFAULT false, -- 해당 게임에서 승리했는지
    game_session_id VARCHAR(100), -- 같은 게임 세션을 구분하기 위한 ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    range_min INTEGER DEFAULT 1,
    range_max INTEGER DEFAULT 100
);

-- 4. 게임 세션 테이블 (한 게임의 전체 정보)
CREATE TABLE IF NOT EXISTS game_sessions (
    id SERIAL PRIMARY KEY,
    server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    game_type VARCHAR(20) NOT NULL, -- 'dice' 또는 'roulette'
    game_rules VARCHAR(200),
    winner_name VARCHAR(50),
    winner_result INTEGER,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    participant_count INTEGER DEFAULT 0
);

-- 인덱스 생성 (조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_servers_host_id ON servers(host_id);
CREATE INDEX IF NOT EXISTS idx_servers_created_at ON servers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_server_members_server_id ON server_members(server_id);
CREATE INDEX IF NOT EXISTS idx_server_members_user_name ON server_members(user_name);
CREATE INDEX IF NOT EXISTS idx_game_records_server_id ON server_game_records(server_id);
CREATE INDEX IF NOT EXISTS idx_game_records_user_name ON server_game_records(user_name);
CREATE INDEX IF NOT EXISTS idx_game_records_session_id ON server_game_records(game_session_id);
CREATE INDEX IF NOT EXISTS idx_game_records_created_at ON server_game_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_server_id ON game_sessions(server_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_session_id ON game_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_created_at ON game_sessions(created_at DESC);
