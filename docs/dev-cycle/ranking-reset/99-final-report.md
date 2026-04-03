# 개발 사이클 최종 보고서: ranking-reset

╔══════════════════════════════════════════╗
║  ✅ 개발 사이클 완료                       ║
║  기능: ranking-reset                      ║
║  총 반복: 1회                             ║
╚══════════════════════════════════════════╝

## 사이클 이력

| 반복 | 회의 | 개발 | QA 통과율 | 버그 수정 | 결과 |
|------|------|------|---------|---------|------|
| #0 | 8인 병렬 (전원 Go) | BE 2파일 + FE 5파일 | 100% (33/33) | MAJOR 2건 수정 | CONDITIONAL_PASS → 개선 사이클 |
| #1 | 경량 (MINOR 포커스) | MINOR 2건 수정 | - | m-1 문구 + m-2 TS 타입 | PASS |

## 전체 변경 파일 목록

| 파일 | 변경 유형 | 관련 사이클 | 설명 |
|------|---------|-----------|------|
| `db/ranking.js` | 함수 추가 | #0 | `resetRanking(serverId)` — DELETE 쿼리 |
| `routes/server.js` | API 추가 | #0 | `DELETE /api/ranking/:serverId` — 호스트 검증 + broadcast |
| `ranking-shared.js` | 기능 추가 | #0, #1 | setHost, 🗑️ 버튼, 확인바, doReset, onRankingReset |
| `dice-game-multiplayer.html` | 이벤트 추가 | #0 | setHost + rankingReset 리스너 |
| `roulette-game-multiplayer.html` | 이벤트 추가 | #0 | setHost + rankingReset 리스너 |
| `js/horse-race.js` | 이벤트 추가 | #0 | setHost + rankingReset 리스너 |
| `crane-game-multiplayer.html` | 이벤트+init 추가 | #0, #1 | setHost + rankingReset + RankingModule.init 누락 수정 |
| `horse-app/src/utils/externalModules.ts` | 타입 추가 | #1 | setHost, onRankingReset, forceHide 타입 정의 |

## 잔여 개선 사항

| ID | 설명 | 우선순위 | 비고 |
|----|------|---------|------|
| v2-1 | game_sessions 동기 삭제 | 낮음 | 현재 직접 참조 없어 안전 |
| v2-2 | 초기화 이력 로깅 (DB 테이블) | 낮음 | console.log로 서버 로그에는 기록됨 |
| v2-3 | 시즌 아카이브 (삭제 전 스냅샷) | 중간 | 시즌제 운영 시 필요 |
| v2-4 | 게임별 부분 초기화 | 낮음 | 사용자 니즈 확인 후 |

## 수동 QA 체크리스트 (배포 전)

- [ ] 사설 서버 호스트로 입장 → 랭킹 열기 → 헤더 우측 🗑️ 버튼 보임
- [ ] 비호스트로 입장 → 랭킹 열기 → 🗑️ 버튼 안 보임
- [ ] 자유 플레이 방 → 랭킹 열기 → 🗑️ 버튼 안 보임
- [ ] 🗑️ 클릭 → "게임 기록을 초기화할까요?" 확인바 표시
- [ ] [취소] 클릭 → 확인바 닫힘
- [ ] 3초 방치 → 확인바 자동 닫힘
- [ ] [초기화] 클릭 → "랭킹이 초기화되었습니다" 피드백 + 빈 랭킹
- [ ] 초기화 후 주문통계/탈것통계 유지 확인
- [ ] 다른 탭 접속자 → rankingReset 소켓으로 자동 갱신
- [ ] 호스트 위임 후 → 새 호스트에게 버튼 표시, 이전 호스트에게 미표시
- [ ] 크레인 게임에서 랭킹 정상 동작 (init 수정 확인)
- [ ] 4개 게임 모두 동일 동작 확인

## 회고

### 잘된 점
- 8인 병렬 회의로 다각적 관점에서 리스크 사전 도출 (권한 우회, 캐시 무효화, free play 제외)
- BE/FE 병렬 개발로 구현 속도 향상
- QA에서 crane-game init 누락 기존 버그 발견 → 이번 사이클에서 함께 수정

### 개선할 점
- crane-game의 RankingModule.init() 누락은 기존 버그 — 코드 리뷰 시 공유 모듈 호출 패턴 체크리스트 필요
- horse-app TS 타입이 ranking-shared.js 변경과 동기화되지 않는 문제 → 변경 시 자동 체크 필요

### 다음에 적용할 것
- 공유 모듈(*-shared.js) 변경 시 모든 게임 HTML + horse-app 타입 동시 확인
- 비가역 API 추가 시 free play(serverId=null) 가드 패턴 표준화
