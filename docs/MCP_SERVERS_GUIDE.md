# Cursor MCP 서버 가이드

## 개요
이 프로젝트에서 사용 중인 MCP (Model Context Protocol) 서버 목록과 설정 방법입니다.

## 설치된 MCP 서버 (총 7개)

### 1. Filesystem MCP
**기능**: 파일 읽기/쓰기, 디렉토리 관리
- 파일 읽기/쓰기
- 디렉토리 생성/목록/삭제
- 파일 이동/복사
- 파일 검색
- 메타데이터 조회

**설정 위치**: `%USERPROFILE%\.cursor\mcp.json`

### 2. Git MCP
**기능**: Git 버전 관리 자동화
- Git 상태 확인
- 커밋 생성 및 관리
- 브랜치 생성/전환
- 변경사항 검토
- Git 히스토리 조회

**설정**: 프로젝트 디렉토리 (`D:\Work\LAMDiceBot`)에서 자동으로 Git 작업 수행

### 3. Fetch MCP
**기능**: 웹 콘텐츠 가져오기 및 변환
- 웹 페이지 내용 가져오기
- HTML을 Markdown으로 변환
- 문서 요약 및 분석
- 웹 검색 결과 처리

**사용 예시**:
- "이 URL의 내용 가져와줘"
- "최신 기술 문서 검색해줘"

### 4. GitHub MCP (선택사항)
**기능**: GitHub 작업 자동화
- 이슈 생성 및 관리
- Pull Request 작업
- 레포지토리 정보 조회
- 코드 검색

**설정 필요**:
1. GitHub Personal Access Token 생성
   - GitHub > Settings > Developer settings > Personal access tokens
   - `repo`, `issues`, `pull_requests` 권한 선택
2. `mcp.json`의 `github` 섹션에 토큰 추가:
   ```json
   "env": {
     "GITHUB_PERSONAL_ACCESS_TOKEN": "your_token_here"
   }
   ```

### 5. PostgreSQL MCP (선택사항)
**기능**: PostgreSQL 데이터베이스 쿼리 및 스키마 조회
- 읽기 전용 SQL 쿼리 실행
- 자동 스키마 발견
- 테이블 스키마 정보 조회 (JSON 형식)
- 안전한 읽기 전용 트랜잭션

**설정 필요**:
1. PostgreSQL 연결 문자열 설정
   - `mcp.json`의 `postgres` 섹션에 연결 문자열 추가:
   ```json
   "env": {
     "POSTGRES_CONNECTION_STRING": "postgresql://user:password@host:port/database"
   }
   ```
2. 프로젝트에서 `DATABASE_URL` 환경변수 사용 시 동일한 값 사용 가능

**사용 예시**:
- "suggestions 테이블 스키마 보여줘"
- "최근 게시글 10개 조회해줘"
- "데이터베이스 테이블 목록 보여줘"

### 6. Playwright MCP (브라우저 자동화)
**기능**: 브라우저 자동화 및 웹 테스트
- 웹 페이지 자동화
- 브라우저 테스트 실행
- 스크린샷 캡처
- 웹 인터랙션 자동화

**사용 예시**:
- "게임 페이지 테스트해줘"
- "버튼 클릭 시뮬레이션해줘"
- "페이지 스크린샷 찍어줘"

**참고**: 프로젝트에서 Puppeteer를 사용 중이지만, Playwright MCP는 Cursor 내에서 직접 브라우저 테스트를 수행할 수 있습니다.

### 7. Memory MCP (지속적 메모리)
**기능**: 프로젝트 컨텍스트 및 지식 그래프 기억
- 프로젝트 관련 정보 기억
- 대화 컨텍스트 유지
- 지식 그래프 기반 메모리
- 장기간 프로젝트 컨텍스트 보존

**사용 예시**:
- 프로젝트 구조, 주요 기능, 이전 대화 내용 등을 기억
- "이전에 논의한 내용 기억해줘"
- "프로젝트 주요 기능 정리해줘"

## 사용 방법

1. **Cursor 재시작**: MCP 설정 변경 후 필수
2. **Composer에서 사용**: 
   - "Git 상태 확인해줘"
   - "이 파일 커밋해줘"
   - "웹에서 최신 정보 검색해줘"
   - "GitHub 이슈 목록 보여줘"

## 문제 해결

### MCP 서버가 작동하지 않는 경우
1. Cursor 재시작 확인
2. `mcp.json` 파일 경로 및 구문 확인
3. npm 패키지 설치 확인
4. Cursor 개발자 도구에서 로그 확인: `Help > Toggle Developer Tools > Console`

### GitHub MCP 토큰 오류
- Personal Access Token이 올바른지 확인
- 필요한 권한이 모두 포함되어 있는지 확인
- 토큰이 만료되지 않았는지 확인

## 참고 자료
- [MCP 공식 문서](https://modelcontextprotocol.io/)
- [Cursor MCP 가이드](https://cursor.com/docs/context/mcp)
- [MCP 서버 목록](https://cursormcp.dev/all)
