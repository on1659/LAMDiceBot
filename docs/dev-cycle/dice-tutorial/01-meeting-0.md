# 팀 회의 결과: dice-tutorial (사이클 #0)

╔══════════════════════════════════════════╗
║  개발 사이클: dice-tutorial               ║
║  현재 단계: 팀 회의 완료                   ║
║  반복: 0/3                               ║
╚══════════════════════════════════════════╝

---

## 팀원별 의견

### 지민 (PD · senior 10년)
**Go.** 단일 파일 수정, DB/Socket 변경 없음. 경마 패턴 재사용으로 리스크 최소. 우선순위 2순위(접근성/UX 향상)에 부합.
- 선행 필요: FLAG_BITS 키 확인, DOM 셀렉터 매핑
- Quality Gate: 기존 게임 영향 없음 / 모바일+데스크톱 / 공정성 미영향

### 현우 (기획자① · mid 5년)
MoSCoW 분류: **Could** (튜토리얼). 링크로 진입하는 참여자에게 8스텝 강제 노출 시 이탈 위험. 선택형 진입(토스트) 제안.
- 실시간 충돌 우려: 튜토리얼 중 다른 유저가 게임 시작하면?
- 호스트/참여자 분기 content 문구 별도 필요

### 소연 (기획자② · senior 8년)
**ICE = 10×8×8 = 640 → 즉시 실행.** 가장 트래픽 높은 게임에 적용, 신규 유저 진입 마찰 감소 → 리텐션 직결.
- 8스텝 과잉 여부 재검토 제안 (UI 복잡도 대비)
- 완료율/D1 리텐션 측정 지표 설정 권장

### 태준 (BE · mid 6년)
**서버 변경 없음.** FLAG_BITS.dice=2 등록 완료. getUserFlags/setGuideComplete 소켓 이벤트 정상. DB guide_flags 테이블 존재.
- userName 빈 문자열 시 localStorage 전용 동작 → 의도된 동작인지 확인 필요
- setFlag는 bitwise OR upsert → 멱등성 보장

### 미래 (FE · junior 3년)
**구현 난이도: 낮음.** 경마 코드 복사+치환 수준. `</body>` 전 script 블록 1개 추가.
- `#rankingBtn` DOM 존재 시점 확인 필요 (ChatModule.init() 타이밍)
- `.users-title` flex 전환 시 `#dragHint` 레이아웃 영향 확인
- var + function 사용 (const/화살표 금지)

### 윤서 (QA · mid 5년)
**공정성 영향 없음.** 클라이언트 오버레이 전용. 회귀 범위: 단일 HTML 파일.
- HP 5건 + EC 7건 = 12 테스트 시나리오 도출
- 1500ms 딜레이 충분성 검증 필요 (MutationObserver 대안 제안)
- DoD: HP 전건 통과 + DB flag 저장/조회 + 경마 회귀 확인

### 다은 (UI · mid 4년)
**추가 CSS 불필요.** Shadow DOM 자동 생성. ? 버튼 스타일 경마와 완벽 일치.
- border-bottom 충돌 가능 (dice .users-title에 border-bottom 존재)
- Step 5 `#diceIdleEmoji` (28px) highlight가 타이트하게 붙는 문제
- 다크모드에서 dice 테마색과 highlight 보라색 근접

### 승호 (UX · mid 7년)
**8스텝 구성 적절.** 단, Step 4 비호스트 처리가 핵심 이슈.
- Step 4: 비호스트에게 fallbackTarget + 분기 content 필요 (경마 v2 패턴)
- Step 5 문구: "게임이 시작된 후에 클릭하세요!" → 금지 표현 제거
- Step 6 문구: 두 행동(주문+메뉴관리) 분리 → 메뉴관리 언급 제거

---

## 주요 합의점

1. **Go** — ICE 640, 리스크 최소, 경마 패턴 재사용
2. **서버/DB 변경 없음** — 인프라 이미 준비 완료
3. **수정 파일 1개** — `dice-game-multiplayer.html`만
4. **경마 패턴 그대로** — setUser, ? 버튼, window.load, var 선언
5. **추가 CSS 불필요** — tutorial-shared.js Shadow DOM 자동 생성

---

## 주요 충돌 지점

| 이슈 | 의견A | 의견B | 판단 |
|------|-------|-------|------|
| Step 4 비호스트 처리 | 자동 스킵만 (현 문서) | fallbackTarget + content 함수 분기 (승호·현우) | **B 채택 권장** — UX 개선 |
| 튜토리얼 진입 방식 | 자동 시작 (현 문서, 경마 동일) | 선택형 토스트 (현우) | **A 유지** — 경마와 일관성 |
| 1500ms vs 1000ms | 1500ms (현 문서) | 1000ms (경마 동일) | **확인 후 결정** — readySection 타이밍 |
| 8스텝 수 | 8스텝 유지 (전원) | 과잉 가능성 (소연) | **8스텝 유지** — 설명해야 할 것 다 포함 |

---

## 역할별 작업 항목 정리

| 담당자 | 역할 | 작업 항목 | 선행 작업 |
|--------|------|---------|---------|
| 지민 | PD | Quality Gate 승인, 스텝 내용 검수, 배포 타이밍 결정 | 구현 완료 후 |
| 현우 | 기획 | 스텝별 문구 작성, 호스트/비호스트 분기 문구, 엣지케이스 정의 | — |
| 소연 | 기획 | 효과 측정 지표(완료율, D1 리텐션), ICE 스코어 기록 | — |
| 태준 | BE | 없음 (인프라 준비 완료) | — |
| 미래 | FE | dice-game-multiplayer.html 코드 삽입 | 문구 확정 후 |
| 윤서 | QA | HP 5건 + EC 7건 테스트, 경마 회귀 확인 | 구현 완료 후 |
| 다은 | UI | border-bottom 충돌 확인, Step 5 highlight 확인, 다크모드 확인 | 구현 완료 후 |
| 승호 | UX | Step 4 fallback 설계, 문구 개선안 최종 확정 | — |

---

## 서로에게 던진 질문들

| 질문자 | 대상 | 질문 | 답변 |
|--------|------|------|------|
| 지민 | QA | 경마 QA 체크리스트 재사용 가능? | 재사용 + 주사위 전용 EC 추가 |
| 현우 | 개발 | 튜토리얼 중 게임 시작 시 오버레이 처리? | tutorial-shared.js blocker가 클릭 차단, 게임은 진행됨 |
| 소연 | 개발 | 신규 유저 입장까지 클릭 수? | 닉네임 입력 → 방 참여 = 2클릭 |
| 태준 | FE | userName 빈 문자열 시 동작? | localStorage 전용 (의도됨) |
| 미래 | BE | ChatModule.init() #rankingBtn 삽입 시점? | roomJoined 핸들러 내 동기 실행 → 1500ms 내 보장 |
| 윤서 | 개발 | 1500ms 딜레이 충분? | readySection은 동기적 표시, 1500ms 충분 |
| 다은 | 개발 | #diceIdleEmoji 게임 전에도 보이는지? | 항상 보임 (채팅 입력 옆 고정) |
| 승호 | 개발 | Step 4 fallbackTarget + content 함수 기술적 난이도? | 낮음 — tutorial-shared.js 이미 지원 |

---

## 기술 의존성

```
문구 확정 (기획+UX)
    ↓
코드 삽입 (FE)
    ↓
QA 검증 + UI 확인 (QA+UI)
    ↓
Quality Gate (PD)
    ↓
main 머지
```

**병목 없음** — 모든 선행 작업(FLAG_BITS, 셀렉터 매핑)이 이미 dice-tutorial.md에 완료.
