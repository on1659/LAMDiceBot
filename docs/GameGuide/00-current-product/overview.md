# 서비스 개요

## LAMDiceBot

Express + Socket.IO 기반 멀티플레이어 게임 서버. 순수 HTML 클라이언트, PostgreSQL (파일 폴백).

### 운영 중인 게임

| 게임 | 진입 경로 | 클라이언트 파일 | 서버 핸들러 |
|------|-----------|----------------|-------------|
| 주사위 | `/game` | `dice-game-multiplayer.html` | `socket/dice.js` |
| 룰렛 | `/roulette` | `roulette-game-multiplayer.html` | `socket/roulette.js` |
| 경마 | `/horse-race` | `horse-race-multiplayer.html` | `socket/horse.js` |

### 부가 페이지

| 경로 | 파일 | 용도 |
|------|------|------|
| `/admin` | `admin.html` | 관리자 페이지 |
| `/pages/*.html` | `pages/` | SEO 정적 페이지 |

### 레거시 리다이렉트

`/dice-game-multiplayer.html` → `/game`
`/roulette-game-multiplayer.html` → `/roulette`
`/horse-race-multiplayer.html` → `/horse-race`

### 도메인

- 운영: `lamdice.com`
- 로컬: `localhost:3000`
