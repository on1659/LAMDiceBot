# PostgreSQL 빠른 설정 가이드

## 🚀 빠른 시작 (Railway 추천)

### 1. Railway에서 PostgreSQL 생성
1. [Railway](https://railway.app/) 접속 및 로그인
2. "New Project" → "Provision PostgreSQL" 선택
3. PostgreSQL 서비스 클릭 → "Variables" 탭
4. `DATABASE_URL` 복사

### 2. 로컬 환경 변수 설정

프로젝트 루트에 `.env` 파일 생성:

```env
DATABASE_URL=postgresql://postgres:password@host:port/railway
```

### 3. 서버 실행

```bash
npm start
```

서버 로그에서 다음 메시지 확인:
```
✅ 데이터베이스 테이블 초기화 완료 (서버 시스템 포함)
```

---

## 💻 로컬 PostgreSQL 설정

### Windows
1. [PostgreSQL 다운로드](https://www.postgresql.org/download/windows/)
2. 설치 후 비밀번호 설정
3. 데이터베이스 생성:
   ```sql
   CREATE DATABASE lamdicebot;
   ```
4. `.env` 파일에 추가:
   ```env
   DATABASE_URL=postgresql://postgres:your_password@localhost:5432/lamdicebot
   ```

### Mac
```bash
brew install postgresql@14
brew services start postgresql@14
createdb lamdicebot
```

`.env` 파일:
```env
DATABASE_URL=postgresql://$(whoami)@localhost:5432/lamdicebot
```

---

## 📝 .env 파일 예시

프로젝트 루트에 `.env` 파일을 만들고:

```env
# PostgreSQL 연결 URL
DATABASE_URL=postgresql://사용자명:비밀번호@호스트:포트/데이터베이스명

# 예시 (로컬)
DATABASE_URL=postgresql://postgres:mypassword@localhost:5432/lamdicebot

# 예시 (Railway)
DATABASE_URL=postgresql://postgres:xxx@xxx.railway.app:5432/railway

# 관리자 페이지 접근 패스워드 (선택사항, 기본값: admin123)
ADMIN_PASSWORD=your_admin_password
```

**⚠️ 중요:** `.env` 파일은 Git에 커밋하지 마세요! (이미 `.gitignore`에 추가됨)

---

## ✅ 확인 방법

서버 실행 후 다음 메시지가 보이면 성공:

```
✅ 데이터베이스 테이블 초기화 완료 (서버 시스템 포함)
```

에러가 나면:
```
ℹ️  DATABASE_URL이 설정되지 않았습니다. 파일 시스템을 사용합니다.
```

이 경우 `.env` 파일의 `DATABASE_URL`을 확인하세요.

---

## 🔧 문제 해결

### 연결 오류
- PostgreSQL이 실행 중인지 확인
- `DATABASE_URL` 형식이 올바른지 확인
- 방화벽 설정 확인 (포트 5432)

### 테이블이 생성되지 않음
서버를 재시작하면 자동으로 생성됩니다. 수동 생성이 필요하면:

```bash
psql -U postgres -d lamdicebot -f database-schema.sql
```

---

더 자세한 내용은 `docs/postgresql-setup.md`를 참고하세요.
