# LAMDiceBot UI/UX 개선 여지 분석

날짜: 2026-04-12
대상 프로젝트: LAMDiceBot

## 목적

외부 레퍼런스 조사를 바탕으로, 현재 LAMDiceBot에서 실제로 수정할 가치가 있는 UI/UX 지점을 정리한다.

이번 문서는 "멋진 레퍼런스" 소개보다 "지금 무엇을 고치면 체감이 큰가"에 초점을 둔다.

## 한 줄 결론

지금 LAMDiceBot는 전면 리디자인보다 "실제 진입 흐름 정리 + 공통 셸 추출 + 상호작용 패턴 개선"이 먼저다.

## 확인한 핵심 사실

### 1. 실제 첫 화면과 정적 랜딩이 다르다

실제 `/` 라우트는 [routes/api.js](../../../routes/api.js)에서 `/game`으로 리다이렉트된다.

- `/` → `/game`: [routes/api.js](../../../routes/api.js)
- `/game`은 [dice-game-multiplayer.html](../../../dice-game-multiplayer.html)
- 정적 랜딩으로 보이는 [index.html](../../../index.html)은 실제 첫 진입 화면이 아니다

의미:

- `index.html`을 많이 다듬어도 현재 사용자 체감과 직접 연결되지 않을 수 있다
- "메인 랜딩"과 "실제 입장 로비"를 분리해서 생각해야 한다

### 2. 디자인 토큰은 있지만 화면 구조가 토큰 위에서 움직이지 않는다

현재 공용 토큰은 [css/theme.css](../../../css/theme.css)에 잘 모여 있다. 하지만 실제 화면 구현은 여전히 대형 HTML 파일과 inline style 비중이 높다.

빠르게 확인한 결과:

- `pages/*.html`의 `style=` 사용 수: 약 441개
- 핵심 화면 파일의 `style=` 사용 수: 약 421개

의미:

- 디자인 시스템이 없는 것은 아니다
- 디자인 시스템이 컴포넌트와 셸로 올라오지 못한 상태다

### 3. 화면군이 섞여 있다

현재 프로젝트 안에는 성격이 다른 화면이 함께 있다.

- 진입/로비 화면
- 실시간 게임 화면
- 문서/가이드/SEO 화면
- 통계/운영/관리 화면

문제는 이 화면군이 서로 다른 목적을 가지는데도 공통 기준 문서가 없다.

## 현재 화면군별 판단

### A. 진입 화면

관련 파일:

- [routes/api.js](../../../routes/api.js)
- [dice-game-multiplayer.html](../../../dice-game-multiplayer.html)
- [index.html](../../../index.html)

상태 판단:

- 실제 첫 진입은 `index.html`이 아니라 게임 로비 쪽이다
- "서비스 소개", "빠른 플레이", "로그인/회원가입", "서버 참여"가 한 흐름으로 정리돼 있지 않다
- 결과적으로 첫인상과 실제 행동 유도가 분리되어 있다

개선 여지:

- `/`를 진짜 랜딩으로 쓸지, "빠른 입장 로비"로 유지할지 먼저 결정
- 첫 화면 목적을 하나로 정리
  - 랜딩이면 소개와 CTA 중심
  - 로비면 빠른 입장과 상태 확인 중심
- [index.html](../../../index.html)과 실제 `/game` 진입 경험 사이의 역할 충돌 해소

추천 방향:

- 지금은 `index.html` 개선보다 실제 `/game` 진입 UX 재정의가 우선

### B. 게임 화면

관련 파일:

- [dice-game-multiplayer.html](../../../dice-game-multiplayer.html)
- [roulette-game-multiplayer.html](../../../roulette-game-multiplayer.html)
- [horse-race-multiplayer.html](../../../horse-race-multiplayer.html)
- `js/shared/*`

좋은 점:

- 게임별 색상 정체성이 비교적 살아 있다
- 공용 모듈을 분리하려는 흔적이 이미 있다
- 기능은 많고 실제 서비스성도 있다

문제점:

- 레이아웃, 버튼, 패널, 상태 표시, 오버레이가 큰 HTML 파일 안에 강하게 결합되어 있다
- inline style 비중이 높아 공통 수정이 어렵다
- 디버그 패널, 비밀번호 모달, 결과 오버레이 등 상호작용 패턴이 제각각이다

예시 지점:

- 룰렛 컨테이너 구조: [roulette-game-multiplayer.html](../../../roulette-game-multiplayer.html)
- 게임 활성화 시 레이아웃 전환: [roulette-game-multiplayer.html](../../../roulette-game-multiplayer.html)
- 비밀번호 모달과 결과 오버레이: [horse-race-multiplayer.html](../../../horse-race-multiplayer.html)
- 디버그 로그 패널: [horse-race-multiplayer.html](../../../horse-race-multiplayer.html)

개선 여지:

- 공용 패턴을 추출하기
  - game shell
  - section header
  - status chip
  - host action group
  - modal / overlay
  - empty state
- "게임별 색상"과 "공용 구조"를 분리해서 유지하기

추천 방향:

- 새 미감 도입보다 공용 구조 추출이 먼저

### C. 문서/가이드/SEO 페이지

관련 파일:

- [pages/statistics.html](../../../pages/statistics.html)
- [pages/probability-analysis.html](../../../pages/probability-analysis.html)
- [pages/roulette-guide.html](../../../pages/roulette-guide.html)
- 기타 `pages/*.html`

문제점:

- 상단 nav, footer, ad container, 본문 래퍼 구조가 반복된다
- 많은 페이지가 개별 `<style>`과 inline style에 의존한다
- 문서형 페이지인데 게임 랜딩의 시각 어휘가 부분적으로 섞여 있다

특히 드러난 문제:

- [pages/statistics.html](../../../pages/statistics.html)은 정보 페이지인데 상단 셸, 본문, 광고, footer가 각각 따로 관리된다
- 문서형 페이지 전용 디자인 규칙이 없다

개선 여지:

- `page-shell`, `doc-nav`, `doc-footer`, `stat-card`, `cta-banner`를 공용화
- 문서 페이지는 "가독성 우선" 기준으로 통일
- 광고 블록도 공통 spacing 규칙 아래에 두기

추천 방향:

- Notion / GitHub / Primer 계열의 문서형 안정감을 참고
- 화려함보다 읽기 흐름을 우선

### D. 통계/운영/관리 화면

관련 파일:

- [pages/statistics.html](../../../pages/statistics.html)
- [admin.html](../../../admin.html)

현재 판단:

- 구조는 비교적 단순하고, 개선 효과가 빨리 나는 영역이다
- 기능보다 UX 디테일이 아쉬운 편이다

핵심 문제:

- `admin.html`은 아직 기본 `alert`, `confirm`에 크게 의존한다
- 삭제, 조회, 결과 피드백 흐름이 브라우저 기본 상호작용에 묶여 있다
- 카드, 표, 요약 수치, 경고 흐름의 정보 계층이 약하다

예시:

- 대량 삭제 확인: [admin.html](../../../admin.html)
- 삭제 결과 피드백: [admin.html](../../../admin.html)
- 멤버 보기 alert: [admin.html](../../../admin.html)

개선 여지:

- custom dialog 도입
- toast / inline feedback 도입
- summary card와 table hierarchy 정리
- 빈 상태와 에러 상태 명확화

추천 방향:

- `Primer React` 감각으로 정보 구조를 정리
- `Radix` 계열 관점으로 상호작용 패턴을 다듬기

## 우선순위 판단

### 1순위: 진입 흐름 재정의

이유:

- 실제 사용자 첫 경험과 연결됨
- 현재 `index.html`과 `/game`의 역할이 분리돼 있어 판단 비용이 큼

할 일:

- `/`의 역할 결정
- 첫 화면의 목적을 하나로 통일
- "랜딩"과 "로비"를 같은 화면에서 둘 다 하려는 구조 정리

### 2순위: 문서/운영 공통 셸 추출

이유:

- 반복 구조가 많아 투자 대비 효과가 큼
- `pages/*.html`, `admin.html`, `statistics.html` 정리가 쉬운 편

할 일:

- 공용 nav / footer / page container 추출
- stat card, table shell, callout 패턴 통일

### 3순위: 게임 화면 상호작용 패턴 통일

이유:

- 서비스 핵심이지만 규모가 큼
- 성급히 손대면 회귀 위험도 있음

할 일:

- 모달, 오버레이, 결과 패널, 상태 패널 공통화
- 게임별 accent는 유지하고 구조만 정리

### 4순위: 토큰/빌드 체계 정리

이유:

- 장기적으로 필요하지만 지금의 가장 큰 병목은 아님

할 일:

- `DESIGN.md` 작성
- 필요 시 이후 `Style Dictionary` 방향 검토

## 지금 당장 수정 가치가 높은 항목

- `/` 리다이렉트 구조 재검토
- 진입 화면 정보 구조 재정리
- `pages/*.html` 공통 셸 구성
- `admin.html`의 alert / confirm 대체
- 게임 화면 공통 오버레이와 액션 버튼 패턴 정리

## 제안하는 다음 단계

### 단계 1. 문서화

- 루트 `DESIGN.md` 초안 작성
- 화면군별 원칙 정의
  - entry
  - game
  - docs
  - ops

### 단계 2. 저위험 정리

- `pages/*.html` 공통 셸 정리
- `admin.html` 상호작용 개선

### 단계 3. 고효율 개선

- 실제 진입 UX 개편
- 게임 화면 공용 패턴 추출

## 최종 판단

LAMDiceBot는 "디자인이 아예 없는 프로젝트"가 아니다. 오히려 토큰, 색상 체계, 공용 모듈 의도가 이미 있다.

지금의 문제는 다음에 가깝다.

- 실제 런타임 진입 구조가 설계 의도와 어긋남
- 공용 규칙이 큰 HTML과 inline style 안에 묻혀 있음
- 화면군별 목적 차이가 문서화되지 않음

따라서 가장 맞는 접근은 다음 순서다.

1. `DESIGN.md`로 원칙 정리
2. 진입 흐름 재정의
3. 문서/운영 셸 공통화
4. 게임 화면 패턴 공통화

## 근거 파일

- [routes/api.js](../../../routes/api.js)
- [css/theme.css](../../../css/theme.css)
- [index.html](../../../index.html)
- [dice-game-multiplayer.html](../../../dice-game-multiplayer.html)
- [roulette-game-multiplayer.html](../../../roulette-game-multiplayer.html)
- [horse-race-multiplayer.html](../../../horse-race-multiplayer.html)
- [pages/statistics.html](../../../pages/statistics.html)
- [admin.html](../../../admin.html)
