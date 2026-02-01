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

function initPool() {
    if (process.env.DATABASE_URL && Pool) {
        try {
            const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
            pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: isLocal ? false : { rejectUnauthorized: false }
            });
        } catch (error) {
            console.error('Postgres 연결 오류:', error);
            pool = null;
        }
    }
}

function getPool() {
    return pool;
}

function clearPool() {
    pool = null;
}

module.exports = { initPool, getPool, clearPool };
