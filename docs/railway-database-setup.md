# Railway 데이터베이스 설정 가이드

## 🚀 Railway에서 PostgreSQL 설정하기

### 1단계: PostgreSQL 서비스 추가

1. **Railway 대시보드 접속**
   - https://railway.app 접속
   - 프로젝트 선택

2. **PostgreSQL 추가**
   - 프로젝트 화면에서 **"+ New"** 또는 **"+ Add Service"** 클릭
   - **"Database"** → **"Add PostgreSQL"** 선택
   - 자동으로 PostgreSQL 인스턴스 생성됨 (약 1분 소요)

### 2단계: DATABASE_URL 복사

1. **PostgreSQL 서비스 클릭**
   - 생성된 PostgreSQL 서비스를 클릭

2. **Variables 탭 이동**
   - 상단 메뉴에서 **"Variables"** 탭 클릭

3. **DATABASE_URL 복사**
   - `DATABASE_URL` 변수를 찾아서 **값을 그대로 복사**
   - ⚠️ **중요**: Railway가 자동으로 생성한 값을 **그대로** 사용하세요
   - 직접 만들거나 수정할 필요 **없습니다**
   - 형식: `postgresql://postgres:비밀번호@호스트:포트/railway`
   - 예시: `postgresql://postgres:abc123@containers-us-west-123.railway.app:5432/railway`
   - ✅ **다른 곳과 맞춰야 할 설정 없음** - Railway가 생성한 값을 그대로 사용하면 됩니다

### 3단계: 애플리케이션에 DATABASE_URL 설정

1. **애플리케이션 서비스로 이동**
   - 프로젝트 화면에서 웹 애플리케이션 서비스 클릭

2. **Variables 탭 이동**
   - 상단 메뉴에서 **"Variables"** 탭 클릭

3. **새 변수 추가**
   - **"+ New Variable"** 또는 **"Add Variable"** 버튼 클릭

4. **변수 입력**
   - **Name**: `DATABASE_URL` (정확히 이대로 입력)
   - **Value**: 2단계에서 복사한 `DATABASE_URL` 값을 **그대로** 붙여넣기
     - ⚠️ **주의**: 값을 수정하거나 편집하지 마세요
     - Railway가 생성한 값을 **그대로** 사용하세요
     - ✅ **다른 곳과 맞춰야 할 설정 없음**
   - **"Add"** 또는 **"Save"** 클릭

### 4단계: ADMIN_PASSWORD 설정 (선택사항)

관리자 페이지를 사용하려면:

1. **같은 Variables 탭에서**
2. **"+ New Variable"** 클릭
3. **변수 입력**:
   - **Name**: `ADMIN_PASSWORD`
   - **Value**: 원하는 관리자 패스워드 (예: `mySecurePassword123`)
   - **"Add"** 클릭

### 5단계: 재배포

변수 추가 후 자동으로 재배포됩니다. 또는:

1. **Deployments 탭**에서
2. **"Redeploy"** 버튼 클릭

## ✅ 확인 방법

배포 완료 후 Railway 로그에서 확인:

```
✅ 데이터베이스 테이블 초기화 완료 (서버 시스템 포함)
```

이 메시지가 보이면 성공!

## 🔍 문제 해결

### DATABASE_URL을 찾을 수 없어요
- PostgreSQL 서비스의 **Variables** 탭을 확인하세요
- PostgreSQL 서비스가 생성되었는지 확인하세요

### 연결 오류가 발생해요
1. `DATABASE_URL` 값이 올바른지 확인
2. PostgreSQL 서비스가 실행 중인지 확인 (Active 상태)
3. Railway 로그에서 오류 메시지 확인

### 변수가 저장되지 않아요
- 변수 이름이 정확한지 확인 (`DATABASE_URL` 대소문자 구분)
- 값에 따옴표나 공백이 없는지 확인
- 저장 후 재배포되었는지 확인

## 📝 변수 설정 예시

Railway Variables 탭에서 다음과 같이 설정:

| Name | Value |
|------|-------|
| `DATABASE_URL` | `postgresql://postgres:비밀번호@호스트:포트/railway` |
| `ADMIN_PASSWORD` | `your_admin_password` |
| `NODE_ENV` | `production` (선택사항) |

## 💡 팁

- **같은 프로젝트 내**에 PostgreSQL이 있으면 Railway가 자동으로 연결해줄 수도 있습니다
- PostgreSQL 서비스와 애플리케이션 서비스가 **같은 프로젝트**에 있어야 합니다
- 변수는 **재배포 후** 적용됩니다
