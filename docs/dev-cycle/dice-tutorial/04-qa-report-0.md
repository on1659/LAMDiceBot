# QA Report: dice-tutorial (Cycle #0)

╔══════════════════════════════════════════╗
║  개발 사이클: dice-tutorial               ║
║  현재 단계: QA 완료                       ║
║  반복: 0/3                               ║
╚══════════════════════════════════════════╝

## Test Summary
| Tier | Tests | Pass | Fail | Rate |
|------|-------|------|------|------|
| Tier 0: Server Load | 1 | 1 | 0 | 100% |
| Tier 1: Happy Path | 6 | 6 | 0 | 100% |
| Tier 2: Edge Cases | 7 | 6 | 1 | 86% |
| **Total** | **14** | **13** | **1** | **93%** |

## Tier 0: Server Load
- server.js 정상 로드 (dice-game-multiplayer.html 변경이 서버에 영향 없음). PASS.

## Tier 1: Happy Path (All PASS)
| Test | Result |
|------|--------|
| T1-1 gameType 'dice' = FLAG_BITS.dice (2) | PASS |
| T1-2 setUser 호출 패턴 (경마 동일) | PASS |
| T1-3 var 선언 사용 (const/let 미사용) | PASS |
| T1-4 화살표 함수 미사용 | PASS |
| T1-5 8스텝 셀렉터 존재 확인 | PASS |
| T1-6 script 순서 (tutorial → code → ads) | PASS |

## Tier 2: Edge Cases
| Test | Result | Severity |
|------|--------|----------|
| T2-1 roomJoined 중복 등록 | PASS | — |
| T2-2 .users-title flex 전환 영향 | WARNING | MINOR |
| T2-3 #diceIdleEmoji 초기 가시성 | PASS | — |
| T2-4 #rankingBtn DOM 존재 보장 | PASS | — |
| T2-5 fallbackTarget 동작 (비호스트) | PASS | — |
| T2-6 경마 튜토리얼 회귀 | PASS | — |
| T2-7 AdSense 스니펫 무변경 | PASS | — |

---

## Bug Report

### CRITICAL — 0건

### MAJOR — 0건

BUG-04 (ordersSection 항상 스킵): **FALSE POSITIVE**
- CSS `.orders-section { display: none }` 존재하나, roomJoined 시 JS가 `style.display = 'block'` 설정 (line 4262)
- 튜토리얼은 roomJoined 1500ms 후 시작 → 이미 visible 상태

### MINOR — 1건

**BUG-02: .users-title flex 전환 시 dragHint 레이아웃 변화 가능**
- **File**: `dice-game-multiplayer.html` line 7557
- **Symptom**: `titleEl.style.display = 'flex'` 적용 시, 내부 `#dragHint` span이 호스트+표시 상태에서 flex item으로 전환됨
- **Impact**: 모바일 좁은 뷰포트에서 ? 버튼 + dragHint 텍스트가 한 줄에 안 들어갈 수 있음
- **Fix**: `dragHint`는 평소 `display:none`이므로 대부분 환경에서 영향 없음. 모바일 실기기 확인 후 판단

### COSMETIC — 0건

---

## QA Verdict: PASS
- CRITICAL: 0건
- MAJOR: 0건 (FALSE POSITIVE 1건)
- MINOR: 1건 (모바일 실기기 확인 권장)
- 경마 회귀: 무변경 확인
