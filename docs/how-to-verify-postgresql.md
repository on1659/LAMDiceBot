# PostgreSQL 연결 확인 방법

## 방법 1: 서버 로그 확인 (가장 간단 ✅)

### 1. 서버 실행
```bash
npm start
```

### 2. 성공 메시지 확인

**PostgreSQL 연결 성공 시:**
```
[dotenv@17.2.3] injecting env (1) from .env
✅ 데이터베이스 테이블 초기화 완료 (서버 시스템 포함)
=================================
🎲 주사위 게임 서버 시작!
포트: 3000
=================================
📋 게시판 데이터 로드 완료: X개 게시글 (Postgres)
```

**PostgreSQL 연결 실패 시:**
```
❌ 데이터베이스 초기화 오류: ...
⚠️  Postgres 연결 실패, 파일 시스템 사용
📋 게시판 데이터 로드 완료: X개 게시글 (파일 시스템)
```

---

## 방법 2: 데이터베이스 직접 확인

### Windows (psql 사용)

```bash
# PostgreSQL 접속
psql -U postgres -d lamdicebot

# 또는 PostgreSQL 설치 경로에서 직접 실행
"C:\Program Files\PostgreSQL\14\bin\psql.exe" -U postgres -d lamdicebot
```

PostgreSQL 콘솔에서:
```sql
-- 테이블 목록 확인
\dt

-- 특정 테이블 구조 확인
\d servers
\d server_members
\d server_game_records
\d game_sessions
\d suggestions

-- 테이블 데이터 확인
SELECT * FROM servers;
SELECT COUNT(*) FROM server_game_records;

-- 종료
\q
```

### Windows (pgAdmin 사용 - GUI)

1. **pgAdmin 실행** (PostgreSQL 설치 시 함께 설치됨)
2. 서버 연결 (비밀번호 입력)
3. `lamdicebot` 데이터베이스 선택
4. `Schemas` → `public` → `Tables` 확인

---

## 방법 3: React 앱에서 테스트

### 1. React 개발 서버 실행
```bash
npm run dev
```

### 2. 브라우저 접속
```
http://localhost:5173
```

### 3. 서버 생성 테스트
1. 사용자 이름 입력
2. "서버 생성" 클릭
3. 서버 이름, 설명 입력 후 생성
4. 서버 목록에 나타나면 성공!

### 4. 데이터베이스 확인
서버 생성 후 데이터베이스에서 확인:
```sql
SELECT * FROM servers;
SELECT * FROM server_members;
```

---

## 방법 4: 간단한 연결 테스트 스크립트

프로젝트 루트에 `test-db.js` 파일 생성:

```javascript
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function testConnection() {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('✅ 데이터베이스 연결 성공!');
        console.log('현재 시간:', result.rows[0].now);
        
        // 테이블 목록 확인
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log('\n📋 생성된 테이블:');
        tables.rows.forEach(row => console.log('  -', row.table_name));
        
    } catch (error) {
        console.error('❌ 연결 실패:', error.message);
    } finally {
        await pool.end();
    }
}

testConnection();
```

실행:
```bash
node test-db.js
```

---

## 문제 해결

### 연결 오류가 나는 경우

1. **PostgreSQL이 실행 중인지 확인**
   ```bash
   # Windows 서비스 확인
   services.msc
   # PostgreSQL 서비스가 "실행 중"인지 확인
   ```

2. **DATABASE_URL 확인**
   - `.env` 파일 열기
   - 형식 확인: `postgresql://사용자명:비밀번호@호스트:포트/데이터베이스명`
   - 비밀번호에 특수문자가 있으면 URL 인코딩 필요

3. **방화벽 확인**
   - 포트 5432가 열려있는지 확인

4. **데이터베이스 존재 확인**
   ```sql
   -- PostgreSQL 접속 후
   \l  -- 데이터베이스 목록 확인
   CREATE DATABASE lamdicebot;  -- 없으면 생성
   ```

---

## 빠른 체크리스트

- [ ] `.env` 파일이 프로젝트 루트에 있음
- [ ] `DATABASE_URL`이 올바른 형식임
- [ ] PostgreSQL 서비스가 실행 중임
- [ ] 데이터베이스가 생성되어 있음
- [ ] 서버 로그에 "✅ 데이터베이스 테이블 초기화 완료" 메시지가 보임
- [ ] React 앱에서 서버 생성이 가능함

---

모든 체크리스트가 완료되면 PostgreSQL이 정상적으로 작동하는 것입니다! 🎉
