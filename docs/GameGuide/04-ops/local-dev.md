# 로컬 개발

## 실행

```bash
npm install
node server.js
# → http://localhost:3000
```

## 환경변수 (`.env`)

| 변수 | 필수 | 용도 |
|------|------|------|
| `PORT` | N | 서버 포트 (기본 3000) |
| `BASE_URL` | N | 기본 URL |
| `DATABASE_URL` | N | PostgreSQL 연결 문자열 (없으면 파일 폴백) |
| `OPENAI_API_KEY` | N | GPT 커스텀 룰 판정용 |

## DB 없이 개발

`DATABASE_URL` 미설정 시 자동으로 파일 폴백:
- `stats.json`, `suggestions.json`, `frequentMenus.json`

## 테스트

### 문법 체크
```bash
node -c server.js
```

### 브라우저 테스트
1. `http://localhost:3000` 접속
2. 탭 2개로 방 생성 + 입장
3. 콘솔 에러 없는지 확인

### 자동화 테스트
```bash
node AutoTest/horse-race/test-loser-slowmo.js
```

## 주요 디렉토리

```
server.js              서버 진입점
routes/                HTTP 라우트
socket/                소켓 핸들러 (게임별 분리)
config/                설정 (서버/클라이언트/경마)
db/                    데이터 계층
js/shared/             프론트 공통 모듈
assets/sounds/         사운드 시스템
pages/                 SEO 정적 페이지
```
