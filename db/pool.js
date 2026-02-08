// PostgreSQL 연결 풀 관리
let Pool = null;
try {
    const pg = require('pg');
    Pool = pg.Pool;
} catch (error) {
    console.log('ℹ️  pg 모듈이 설치되지 않았습니다. 파일 시스템을 사용합니다.');
    console.log('   Postgres를 사용하려면: npm install pg');
}

let pool = null;

async function initPool() {
    if (process.env.DATABASE_URL && Pool) {
        try {
            const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
            pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: isLocal ? false : { rejectUnauthorized: false },
                max: parseInt(process.env.DB_POOL_MAX) || (isLocal ? 10 : 15),
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000
            });
            // 실제 연결 테스트
            await pool.query('SELECT 1');
            console.log('✅ PostgreSQL 연결 성공');
        } catch (error) {
            console.error('❌ PostgreSQL 연결 실패:', error.message);
            console.error('   → 통계 데이터는 파일(stats.json)에 저장됩니다.');
            pool = null;
        }
    } else {
        if (!process.env.DATABASE_URL) console.log('ℹ️  DATABASE_URL 미설정 → 파일 기반 통계 저장');
        if (!Pool) console.log('ℹ️  pg 모듈 없음 → 파일 기반 통계 저장');
    }
}

function getPool() {
    return pool;
}

function clearPool() {
    pool = null;
}

module.exports = { initPool, getPool, clearPool };
