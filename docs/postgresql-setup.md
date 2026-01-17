# PostgreSQL 설정 가이드

## 방법 1: 로컬 PostgreSQL 설치 및 설정

### 1. PostgreSQL 설치

#### Windows
1. [PostgreSQL 공식 사이트](https://www.postgresql.org/download/windows/)에서 다운로드
2. 설치 시 비밀번호 설정 (기억해두세요!)
3. 기본 포트: 5432

#### Mac
```bash
# Homebrew 사용
brew install postgresql@14
brew services start postgresql@14
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 2. 데이터베이스 생성

PostgreSQL 설치 후 터미널에서:

```bash
# PostgreSQL 접속 (Windows는 psql 명령어를 PATH에 추가하거나 pgAdmin 사용)
psql -U postgres

# 또는 설치된 PostgreSQL의 bin 폴더에서 실행
# 예: C:\Program Files\PostgreSQL\14\bin\psql.exe -U postgres
```

PostgreSQL 콘솔에서:

```sql
-- 데이터베이스 생성
CREATE DATABASE lamdicebot;

-- 사용자 생성 (선택사항)
CREATE USER lamdiceuser WITH PASSWORD 'your_password';

-- 권한 부여
GRANT ALL PRIVILEGES ON DATABASE lamdicebot TO lamdiceuser;

-- 종료
\q
```

### 3. 환경 변수 설정

**⚠️ 중요: 시스템 환경 변수는 설정할 필요 없습니다! `.env` 파일만 사용하세요.**

#### 방법 1: .env 파일 사용 (권장 ✅)

프로젝트 루트 폴더에 `.env` 파일을 생성하세요:

**Windows:**
1. 프로젝트 폴더에서 새 파일 생성: `.env`
2. 다음 내용 입력:
```env
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/lamdicebot
PORT=3000
```

**Mac/Linux:**
```bash
# 프로젝트 루트에서 실행
echo 'DATABASE_URL=postgresql://postgres:your_password@localhost:5432/lamdicebot' > .env
echo 'PORT=3000' >> .env
```

**이 방법이 가장 간단하고 권장됩니다!** ✅

#### 방법 2: 시스템 환경 변수 (선택사항, 비권장)

시스템 환경 변수는 설정할 필요 없지만, 원한다면:

**Windows (PowerShell):**
```powershell
# 임시 설정 (현재 세션만)
$env:DATABASE_URL="postgresql://postgres:your_password@localhost:5432/lamdicebot"

# 영구 설정 (시스템 환경 변수) - 비권장
[System.Environment]::SetEnvironmentVariable('DATABASE_URL', 'postgresql://postgres:your_password@localhost:5432/lamdicebot', 'User')
```

**Windows (CMD):**
```cmd
set DATABASE_URL=postgresql://postgres:your_password@localhost:5432/lamdicebot
```

**Mac/Linux:**
```bash
export DATABASE_URL="postgresql://postgres:your_password@localhost:5432/lamdicebot"
```

### 4. DATABASE_URL 형식

```
postgresql://[사용자명]:[비밀번호]@[호스트]:[포트]/[데이터베이스명]
```

예시:
```
postgresql://postgres:mypassword@localhost:5432/lamdicebot
```

---

## 방법 2: Railway (클라우드 PostgreSQL) - 추천

### 1. Railway 계정 생성
1. [Railway](https://railway.app/) 접속
2. GitHub 계정으로 로그인

### 2. PostgreSQL 프로젝트 생성
1. "New Project" 클릭
2. "Provision PostgreSQL" 선택
3. 자동으로 PostgreSQL 인스턴스 생성

### 3. DATABASE_URL 복사
1. PostgreSQL 서비스 클릭
2. "Variables" 탭에서 `DATABASE_URL` 복사
3. 형식: `postgresql://postgres:password@host:port/railway`

### 4. 로컬 환경 변수 설정
```bash
# .env 파일에 추가
DATABASE_URL=postgresql://postgres:password@host:port/railway
```

---

## 방법 3: 다른 클라우드 서비스

### Supabase (무료 티어 제공)
1. [Supabase](https://supabase.com/) 접속
2. 프로젝트 생성
3. Settings > Database > Connection String 복사

### Neon (무료 티어 제공)
1. [Neon](https://neon.tech/) 접속
2. 프로젝트 생성
3. Connection String 복사

---

## 테이블 자동 생성 확인

서버를 실행하면 자동으로 테이블이 생성됩니다:

```bash
npm start
```

서버 로그에서 다음 메시지를 확인하세요:
```
✅ 데이터베이스 테이블 초기화 완료 (서버 시스템 포함)
```

생성되는 테이블:
- `servers` - 서버 정보
- `server_members` - 서버 멤버십
- `server_game_records` - 게임 기록
- `game_sessions` - 게임 세션
- `suggestions` - 게시판 (기존)

---

## 문제 해결

### 연결 오류
```
❌ 데이터베이스 초기화 오류: ...
```

**해결 방법:**
1. PostgreSQL이 실행 중인지 확인
2. DATABASE_URL이 올바른지 확인
3. 방화벽 설정 확인 (포트 5432)
4. 사용자 권한 확인

### 테이블이 생성되지 않음
```sql
-- PostgreSQL에 직접 접속하여 확인
psql -U postgres -d lamdicebot

-- 테이블 목록 확인
\dt

-- 수동으로 테이블 생성 (필요시)
\i database-schema.sql
```

### Windows에서 psql 명령어를 찾을 수 없음
1. PostgreSQL 설치 경로 확인
   - 기본: `C:\Program Files\PostgreSQL\14\bin\`
2. PATH 환경 변수에 추가
3. 또는 pgAdmin 사용 (GUI 도구)

---

## .env 파일 사용 (권장 ✅)

**시스템 환경 변수는 설정할 필요 없습니다!** `.env` 파일만 사용하세요.

프로젝트 루트에 `.env` 파일 생성:

```env
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/lamdicebot
PORT=3000
```

**주의:** 
- `.env` 파일은 `.gitignore`에 이미 추가되어 있어 Git에 커밋되지 않습니다.
- 실제 비밀번호를 입력하세요 (`your_password` 부분을 실제 비밀번호로 변경).
- Railway를 사용하는 경우, Railway에서 제공하는 `DATABASE_URL`을 그대로 복사해서 사용하세요.

---

## 빠른 테스트

```bash
# 1. PostgreSQL 실행 확인
psql -U postgres -c "SELECT version();"

# 2. 데이터베이스 목록 확인
psql -U postgres -c "\l"

# 3. 서버 실행
npm start

# 4. 브라우저에서 http://localhost:5173 접속
# 5. 서버 생성 시도
```

---

## 다음 단계

PostgreSQL 설정이 완료되면:
1. 서버 재시작: `npm start`
2. 리액트 앱 실행: `npm run dev`
3. 브라우저에서 서버 생성 테스트
