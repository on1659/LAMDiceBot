// PostgreSQL 연결 테스트 스크립트
require('dotenv').config();
const { Pool } = require('pg');

// DATABASE_URL 확인
if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL이 설정되지 않았습니다.');
    console.log('   .env 파일에 DATABASE_URL을 추가하세요.');
    process.exit(1);
}

console.log('🔍 DATABASE_URL 확인:', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

// 로컬인지 확인하여 SSL 설정
const isLocalhost = process.env.DATABASE_URL.includes('localhost') || 
                   process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalhost ? false : { rejectUnauthorized: false }
});

async function testConnection() {
    try {
        console.log('\n📡 데이터베이스 연결 시도...');
        
        // 연결 테스트
        const result = await pool.query('SELECT NOW() as current_time, version() as pg_version');
        console.log('✅ 데이터베이스 연결 성공!');
        console.log('   현재 시간:', result.rows[0].current_time);
        console.log('   PostgreSQL 버전:', result.rows[0].pg_version.split(',')[0]);
        
        // 테이블 목록 확인
        console.log('\n📋 테이블 목록 확인...');
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        if (tables.rows.length === 0) {
            console.log('   ⚠️  테이블이 없습니다. 서버를 실행하면 자동으로 생성됩니다.');
        } else {
            console.log(`   ✅ ${tables.rows.length}개의 테이블이 있습니다:`);
            tables.rows.forEach(row => {
                console.log(`      - ${row.table_name}`);
            });
        }
        
        // 필요한 테이블 확인
        const requiredTables = ['servers', 'server_members', 'server_game_records', 'game_sessions', 'suggestions'];
        const existingTables = tables.rows.map(r => r.table_name);
        const missingTables = requiredTables.filter(t => !existingTables.includes(t));
        
        if (missingTables.length > 0) {
            console.log('\n   ⚠️  다음 테이블이 없습니다:');
            missingTables.forEach(t => console.log(`      - ${t}`));
            console.log('   💡 서버를 실행하면 자동으로 생성됩니다.');
        } else {
            console.log('\n   ✅ 모든 필수 테이블이 존재합니다!');
        }
        
        // 각 테이블의 레코드 수 확인
        console.log('\n📊 테이블 데이터 확인...');
        for (const table of requiredTables) {
            if (existingTables.includes(table)) {
                try {
                    const count = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
                    console.log(`   ${table}: ${count.rows[0].count}개 레코드`);
                } catch (err) {
                    console.log(`   ${table}: 확인 실패`);
                }
            }
        }
        
        console.log('\n✅ 모든 테스트 통과! PostgreSQL이 정상적으로 작동합니다. 🎉');
        
    } catch (error) {
        console.error('\n❌ 연결 실패:', error.message);
        console.error('\n💡 해결 방법:');
        console.error('   1. PostgreSQL이 실행 중인지 확인');
        console.error('   2. DATABASE_URL이 올바른지 확인');
        console.error('   3. 데이터베이스가 생성되어 있는지 확인');
        console.error('   4. 사용자 권한이 올바른지 확인');
        process.exit(1);
    } finally {
        await pool.end();
    }
}

testConnection();
