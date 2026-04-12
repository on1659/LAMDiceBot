# GameGuide

LAMDiceBot의 현재 런타임 구조를 기준으로 다시 정리한 기술 문서입니다.

이 폴더는 "지금 코드가 어떻게 동작하는지"를 설명하는 운영 문서와, 과거 구조를 보관하는 아카이브를 분리하는 것을 목표로 합니다.

## 문서 구조

### 현재 운영 문서

| 디렉터리 | 설명 |
|----------|------|
| `00-current-product/` | 서비스 개요, 주요 진입 경로, 현재 제품 상태 |
| `01-architecture/` | 서버 부팅, 소켓 등록, 방 상태, 데이터 구조 |
| `02-shared-systems/` | 채팅, 준비 상태, 주문, 랭킹, 사운드, 공통 모듈 |
| `03-games/` | 게임별 규칙, 전용 소켓 이벤트, 구현 참고 포인트 |
| `04-ops/` | 로컬 실행, QA, 배포/운영 체크 |

### 보관 문서

| 디렉터리 | 설명 |
|----------|------|
| `90-archive/proposals/` | 기능 제안 문서 |
| `90-archive/old-plans/` | 과거 계획 문서 |
| `90-archive/legacy-guides/` | 예전 구조 기준 가이드 |

## 읽는 순서

1. `00-current-product/overview.md`
2. `01-architecture/server-bootstrap.md`
3. `01-architecture/socket-system.md`
4. `01-architecture/data-model.md`
5. 작업 대상 게임의 `03-games/*.md`

## 작성 원칙

- 라우트는 현재 공개 경로 기준으로 적습니다.
- 소켓 이벤트는 실제 emit/on 이름 기준으로 적습니다.
- 공통 이벤트는 `socket/shared.js`, 게임 전용 이벤트는 각 게임 모듈 기준으로 나눠 설명합니다.
- 과거 설계나 삭제된 구조는 현재 문서에 섞지 않고 `90-archive/`로 보냅니다.
