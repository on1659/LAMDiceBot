# 추가 MCP 서버 설정 가이드

## 새로 추가된 MCP 서버

### 1. PostgreSQL MCP

**설치**: 자동 (npx 사용)

**설정 방법**:
1. `%USERPROFILE%\.cursor\mcp.json` 파일에서 `postgres` 섹션 확인
2. PostgreSQL 연결 문자열 설정:
   ```json
   "postgres": {
     "command": "npx",
     "args": ["-y", "@modelcontextprotocol/server-postgres"],
     "env": {
       "POSTGRES_CONNECTION_STRING": "postgresql://user:password@host:port/database"
     }
   }
   ```

**연결 문자열 예시**:
- 로컬: `postgresql://postgres:password@localhost:5432/lamdicebot`
- Railway: `postgresql://user:password@host.railway.app:5432/railway`
- 환경변수 사용: `process.env.DATABASE_URL` 값과 동일하게 설정

**기능**:
- ✅ 읽기 전용 SQL 쿼리 실행
- ✅ 자동 스키마 발견
- ✅ 테이블 스키마 정보 조회
- ✅ 안전한 읽기 전용 접근

**사용 예시**:
- "suggestions 테이블 구조 보여줘"
- "최근 게시글 5개 조회해줘"
- "데이터베이스에 어떤 테이블이 있어?"

---

### 2. Playwright MCP (브라우저 자동화)

**설치**: 자동 (npx 사용)

**설정**: 추가 설정 불필요 (기본 설정으로 작동)

**기능**:
- ✅ 웹 페이지 자동화
- ✅ 브라우저 테스트 실행
- ✅ 스크린샷 캡처
- ✅ 웹 인터랙션 시뮬레이션

**사용 예시**:
- "게임 페이지 열고 스크린샷 찍어줘"
- "주사위 굴리기 버튼 클릭 시뮬레이션해줘"
- "룰렛 게임 페이지 테스트해줘"

**참고**:
- 프로젝트에서 Puppeteer를 사용 중이지만, Playwright MCP는 Cursor 내에서 직접 브라우저 테스트를 수행할 수 있습니다
- 실제 브라우저를 열어서 테스트할 수 있습니다

---

### 3. Memory MCP (지속적 메모리)

**설치**: 자동 (npx 사용)

**설정**: 추가 설정 불필요 (기본 설정으로 작동)

**기능**:
- ✅ 프로젝트 관련 정보 기억
- ✅ 대화 컨텍스트 유지
- ✅ 지식 그래프 기반 메모리
- ✅ 장기간 프로젝트 컨텍스트 보존

**사용 예시**:
- 프로젝트 구조, 주요 기능, 이전 대화 내용 등을 자동으로 기억
- "이전에 논의한 내용 기억해줘"
- "프로젝트 주요 기능 정리해줘"
- "이 프로젝트의 기술 스택 기억해줘"

**장점**:
- 여러 세션에 걸쳐 프로젝트 컨텍스트 유지
- 반복적인 설명 없이도 프로젝트 이해 가능
- 프로젝트별 지식 축적

---

## 전체 MCP 서버 목록

1. **Filesystem MCP** - 파일 관리
2. **Git MCP** - 버전 관리
3. **Fetch MCP** - 웹 콘텐츠 가져오기
4. **GitHub MCP** - GitHub 작업 (토큰 필요)
5. **PostgreSQL MCP** - 데이터베이스 쿼리 (연결 문자열 필요)
6. **Playwright MCP** - 브라우저 자동화
7. **Memory MCP** - 지속적 메모리

---

## 설정 확인

모든 MCP 서버는 `%USERPROFILE%\.cursor\mcp.json` 파일에 설정되어 있습니다.

**설정 파일 위치**: `C:\Users\user\.cursor\mcp.json`

**확인 방법**:
1. Cursor 재시작
2. Composer에서 MCP 도구 사용 시도
3. 문제가 있으면 Cursor 개발자 도구에서 로그 확인: `Help > Toggle Developer Tools > Console`

---

## 문제 해결

### PostgreSQL MCP 연결 오류
- 연결 문자열 형식 확인
- 데이터베이스 접근 권한 확인
- 방화벽 설정 확인 (원격 DB인 경우)

### Playwright MCP 작동 안 함
- Node.js 버전 확인 (18 이상 필요)
- 브라우저 드라이버 자동 설치 확인
- Cursor 재시작

### Memory MCP가 기억하지 못함
- Cursor 재시작
- 명시적으로 정보 저장 요청: "이 정보 기억해줘"

---

## 참고

- 모든 MCP 서버는 **모든 프로젝트**에 적용됩니다 (전역 설정)
- 프로젝트별 설정이 필요하면 `.cursor/mcp.json` 파일을 프로젝트 루트에 생성
- 자세한 내용은 `docs/MCP_SERVERS_GUIDE.md` 참조
