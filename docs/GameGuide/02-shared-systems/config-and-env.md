# 설정 및 환경변수

## 서버 설정 (`config/index.js`)

`.env` 파일에서 읽음:

| 변수 | 기본값 | 용도 |
|------|--------|------|
| `PORT` | 3000 | 서버 포트 |
| `BASE_URL` | `http://localhost:PORT` | 기본 URL |
| `ROOM_GRACE_PERIOD` | 120000ms (2분) | 빈 방 유예 시간 |
| `DISCONNECT_WAIT_REDIRECT` | 15000ms | 리다이렉트 연결 해제 대기 |
| `DISCONNECT_WAIT_DEFAULT` | 5000ms | 기본 연결 해제 대기 |

## 클라이언트 설정 (`config/client-config.js`)

프론트엔드 상수:

| 상수 | 값 | 용도 |
|------|-----|------|
| `SS_MEMBERS_REFRESH_INTERVAL` | 5000ms | 멤버 목록 갱신 주기 |
| `SS_JOIN_TIMEOUT` | 10000ms | 서버 가입 응답 대기 |
| `SS_TOAST_DURATION` | 2000ms | 토스트 표시 시간 |
| `SS_TOAST_FADE_MS` | 300ms | 토스트 페이드 아웃 |
| `SS_MEMBERS_DOT_DELAY` | 300ms | 온라인 표시 딜레이 |
| `TAGLINE_INTERVAL_MS` | 7000ms | 태그라인 전환 주기 |
| `TAGLINE_TRANSITION_MS` | 700ms | 태그라인 애니메이션 |
| `TAGLINE_ERASE_STEP_MS` | 80ms | 글자 지우기 딜레이 |
| `TAGLINE_TYPE_STEP_MS` | 50ms | 글자 타이핑 딜레이 |

## 경마 설정 (`config/horse/race.json`)

| 키 | 내용 |
|----|------|
| `pixelsPerMeter` | 10 |
| `trackPresets` | short=500m, medium=700m, long=1000m (speed 85~95) |
| `slowMotion` | 리더/패자 슬로모 설정 |
| `gimmicks` | 10종 기믹 확률/지속시간/속도배율 |
| `photoFinish` | 1~2% 동시 도착 판정 |
| `weather` | 4종 (sunny/rain/wind/fog) + 탈것별 보정 |

## 환경변수 (`.env`)

| 변수 | 필수 | 용도 |
|------|------|------|
| `DATABASE_URL` | N | PostgreSQL 연결 (없으면 파일 폴백) |
| `OPENAI_API_KEY` | N | GPT 커스텀 룰 판정 |
| `PORT` | N | 서버 포트 |
| `BASE_URL` | N | 기본 URL |

## DB 폴백 파일

`DATABASE_URL` 미설정 시 자동 전환:

| DB 기능 | 폴백 파일 |
|---------|-----------|
| 통계 | `stats.json` |
| 건의 | `suggestions.json` |
| 자주 메뉴 | `frequentMenus.json` |
