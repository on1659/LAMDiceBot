# PD 보고서: dice-tutorial (사이클 #0)

╔══════════════════════════════════════════╗
║  개발 사이클: dice-tutorial               ║
║  현재 단계: PD 보고서                     ║
║  반복: 0/3                               ║
╚══════════════════════════════════════════╝

## Go/No-Go 판단

**GO.**

1. 수정 파일 1개 (`dice-game-multiplayer.html`), 서버/DB 변경 없음
2. 경마 튜토리얼에서 검증된 패턴 그대로 재사용 (tutorial-shared.js)
3. ICE 640 (Impact 10 × Confidence 8 × Ease 8) → 즉시 실행 기준 초과

---

## 작업 분해 (WBS)

| # | 담당자 | 작업 | 예상 공수 | 선행 작업 | 우선순위 |
|---|--------|-----|---------|---------|---------|
| 1 | 승호(UX) | Step 4 fallbackTarget + content 함수 설계 | 0.1일 | — | P0 |
| 2 | 현우(기획)+승호(UX) | 8스텝 최종 문구 확정 | 0.1일 | #1 | P0 |
| 3 | 미래(FE) | dice-game-multiplayer.html 코드 삽입 | 0.3일 | #2 | P0 |
| 4 | 다은(UI) | border-bottom 충돌 + Step 5 highlight 검증 | 0.1일 | #3 | P1 |
| 5 | 윤서(QA) | HP 5건 + EC 7건 테스트 + 경마 회귀 | 0.2일 | #3 | P0 |
| 6 | 지민(PD) | Quality Gate 최종 승인 | 0.1일 | #5 | P0 |

**총 예상 공수: 0.9일 (1일 이내 완료)**

---

## 개발 범위 확정

### 이번 사이클 포함
- 8스텝 튜토리얼 오버레이 (dice-game-multiplayer.html)
- ? 도움말 버튼 (.users-section .users-title 우측)
- setUser DB 플래그 동기화 (기존 인프라 활용)
- Step 4 비호스트 fallbackTarget + content 함수 분기
- Step 5/6 문구 개선 (UX 피드백 반영)

### 제외 (다음 사이클 또는 미정)
- 튜토리얼 완료 토스트 메시지 (tutorial-shared.js 수정 필요)
- ? 버튼 터치 타겟 확대 (24px → 36px, 전 게임 공통 변경)
- Shadow DOM tooltip ARIA 접근성 (tutorial-shared.js 수정 필요)
- 선택형 진입(토스트) 방식 변경 (경마와 일관성 유지)
- 효과 측정 지표 추적 (별도 analytics 작업)

---

## 리스크 매트릭스

| 리스크 | 확률 | 영향 | 대응 전략 |
|--------|------|------|---------|
| 1500ms 딜레이 부족 (readySection 미표시) | 하 | 중 | readySection은 동기적 표시, 1500ms 충분. 경마 1000ms도 문제없음 |
| #rankingBtn DOM 미존재 | 하 | 하 | ChatModule.init()이 roomJoined 내 동기 실행 → 1500ms 내 보장 |
| .users-title flex 전환 시 dragHint 레이아웃 깨짐 | 중 | 하 | dragHint는 평소 display:none. 호스트+표시 시에만 확인 |
| 기존 게임 영향 | 극히 낮 | 상 | 주사위 HTML 1개만 수정, 다른 게임 파일 미접촉 |

---

## 예상 사용 시나리오

### 개발 전 (As-Is)
처음 주사위 게임에 들어온 플레이어가 UI를 보고 "준비 버튼이 뭐지?", "주사위는 어떻게 굴리지?", "하이/로우가 뭐야?"를 스스로 파악해야 함. 호스트와 참여자의 역할 차이도 설명 없음.

### 개발 후 (To-Be)
첫 접속 시 8스텝 가이드가 자동 시작. 참여자 목록 → 게임 룰 → 준비 → 게임 시작 → 주사위 → 주문 → 채팅 → 랭킹 순서로 각 UI 요소를 하이라이트하며 설명. 비호스트는 "방장이 게임을 시작합니다" 안내를 받고 7스텝 완료. 완료 후 재노출 없음. ? 버튼으로 언제든 재학습 가능.
