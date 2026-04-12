# 배포

## 환경

- 호스팅: Railway
- 도메인: `lamdice.com`
- DB: PostgreSQL (Railway 제공)

## 필수 환경변수

| 변수 | 용도 |
|------|------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 |
| `PORT` | Railway 자동 할당 |
| `BASE_URL` | `https://lamdice.com` |
| `OPENAI_API_KEY` | GPT 커스텀 룰 판정 (선택) |

## 배포 흐름

```
git push origin main
    ↓
Railway 자동 감지 → npm install → node server.js
    ↓
DB 마이그레이션: initDatabase() 자동 실행 (테이블 없으면 생성)
```

## 릴리즈 전 체크리스트

- [ ] `node -c server.js` 문법 체크 통과
- [ ] 로컬에서 `node server.js` 부팅 확인
- [ ] 변경된 게임 브라우저 테스트 (2탭: 방 생성 + 입장)
- [ ] 공통 모듈 변경 시: 주사위/룰렛/경마 모두 테스트
- [ ] DB 스키마 변경 시: `db/init.js` 확인 (CREATE IF NOT EXISTS)
- [ ] 환경변수 추가 시: Railway 대시보드에 등록
