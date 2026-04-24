# 서비스 개요

## LAMDiceBot

Express + Socket.IO 기반 멀티플레이어 게임 서버. 순수 HTML 클라이언트, PostgreSQL (파일 폴백).

### 서비스 목적

LAMDiceBot은 사람들이 각자 자리에서 같은 방에 접속해, 조작 실력이나 반응 속도 같은 피지컬 부담 없이, 결과를 운과 서버 공정성에 맡기며 함께 즐기는 무료 소셜 보드게임 서비스다.

핵심 경험은 빠르게 모이고, 규칙은 단순하게 이해하고, 승패는 플레이어의 손기술이 아니라 주사위/룰렛/경마 시뮬레이션 같은 운 기반 결과에 맡기는 것이다.

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
