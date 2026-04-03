# QA 보고서: ranking-reset (사이클 #0)

╔══════════════════════════════════════════╗
║  개발 사이클: ranking-reset               ║
║  현재 단계: QA 완료                       ║
║  반복: 0/3                               ║
╚══════════════════════════════════════════╝

## 테스트 요약

| 티어 | 테스트 수 | 통과 | 실패 | 통과율 |
|------|---------|------|------|-------|
| Tier 0 (구문 체크) | 4 | 4 | 0 | 100% |
| Tier 1 (Happy Path) | 19 | 19 | 0 | 100% |
| Tier 2 (엣지케이스) | 7 | 7 | 0 | 100% |
| Tier 3 (회귀) | 3 | 3 | 0 | 100% |
| **합계** | **33** | **33** | **0** | **100%** |

## 버그 리포트

### 🔴 CRITICAL
없음.

### 🟠 MAJOR

| ID | 설명 | 영향 범위 |
|----|------|---------|
| M-1 | ranking-shared.js에서 free play(serverId=null)일 때도 isHost=true면 🗑️ 버튼 노출. 클릭 시 /api/ranking/null → 404 에러. | free play 방 호스트 UX |
| M-2 | crane-game에서 RankingModule.init() 미호출 가능성 — 실제 코드에서 init 호출 유무 재확인 필요 | crane game 랭킹 기능 전체 |

### 🟡 MINOR

| ID | 설명 | 개선 제안 |
|----|------|---------|
| m-1 | order_stats/vehicle_stats 미삭제가 의도적 설계라면, 확인바에 "게임 기록만 초기화" 안내 추가 권장 | 확인바 문구 보완 |
| m-2 | horse-app TypeScript 타입에 setHost, onRankingReset 미정의 | 타입 추가 (런타임 영향 없음) |

### ⚪ COSMETIC
없음.

## QA 판정: CONDITIONAL_PASS
- CRITICAL 0건, MAJOR 2건 → M-1 수정 필수, M-2 확인 필요
