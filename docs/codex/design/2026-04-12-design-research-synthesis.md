# 디자인 GitHub 조사 통합본

날짜: 2026-04-12
대상 프로젝트: LAMDiceBot

## 목적

`awesome-design-md`를 시작점으로 비슷하게 참고할 만한 GitHub 저장소들을 조사하고, 각 저장소가 LAMDiceBot에 어떤 방식으로 도움이 되는지 정리한다.

## 요약 결론

이번 조사에서 가장 중요한 결론은 "어떤 예쁜 스타일을 복제할 것인가"보다 "프로젝트 루트에 `DESIGN.md`를 두고 AI와 사람이 함께 지킬 디자인 규칙을 고정할 것인가"였다.

LAMDiceBot는 이미 [css/theme.css](../../../css/theme.css), [docs/renewal/design-unification-summary.md](../../../docs/renewal/design-unification-summary.md), 각 게임 HTML, `js/shared/*` 공용 모듈을 가지고 있다. 즉 디자인 자산이 없는 상태가 아니라 규칙이 여러 곳에 흩어져 있는 상태에 가깝다. 그래서 지금 필요한 것은 새로운 미감 수입보다 규칙 정리다.

## 가장 직접적으로 도움이 되는 저장소

### 1. `VoltAgent/awesome-design-md`

역할:

- 공개 서비스들의 `DESIGN.md` 예시를 모아둔 레퍼런스 저장소

LAMDiceBot에 유효한 포인트:

- `DESIGN.md`가 색상, 타이포, 컴포넌트, 레이아웃, 반응형, 금지 패턴, 프롬프트 가이드까지 한 문서에 담는다는 점
- AI가 UI를 수정할 때 스타일 일관성을 유지시키는 운영 방식

적용 판단:

- 가장 먼저 참고할 저장소
- 단, 특정 브랜드를 그대로 따라가기보다 문서 구조와 운영 방식을 가져오는 편이 적합

### 2. `google-labs-code/stitch-skills`

역할:

- Stitch 기반 디자인 스킬 모음
- `stitch-design`, `design-md` 같은 스킬이 `DESIGN.md` 생성과 디자인 시스템 문서화를 직접 다룸

LAMDiceBot에 유효한 포인트:

- 디자인 시스템을 "문서"로 남기는 흐름이 명확함
- 단일 화면 생성보다 디자인 문맥 축적에 강함

적용 판단:

- 루트 `DESIGN.md`를 만들 때 구조와 범위를 잡는 참고 자료로 적합

### 3. `Khalidabdi1/design-ai`

역할:

- 인기 서비스들의 `DESIGN.md`를 모아둔 컬렉션

LAMDiceBot에 유효한 포인트:

- 한 저장소 안에서 문서 형식이 일정해 비교가 쉬움
- Notion, GitHub, Linear, PlayStation, Xbox 등 서로 다른 제품 톤을 비교하기 좋음

적용 판단:

- "우리 문서/가이드 화면은 어떤 결이 맞는가" 같은 비교용 자료로 좋음
- 실무적으로는 디자인 복제용보다 벤치마크용이 더 적합

### 4. `pbakaus/impeccable`

역할:

- 프런트엔드 디자인 품질을 끌어올리기 위한 스킬, 명령, 안티패턴 모음

LAMDiceBot에 유효한 포인트:

- AI가 자주 만드는 나쁜 패턴을 명시적으로 피하게 함
- 폰트, 컬러, 대비, 공간, 모션, 인터랙션, UX writing을 따로 다룸

특히 유효했던 관점:

- 보라 그라디언트와 흰 카드 조합의 남용 경계
- 카드 안에 카드를 계속 중첩하는 습관 경계
- 회색 텍스트, 밋밋한 상태 피드백, 기본 alert/confirm UX 경계

적용 판단:

- LAMDiceBot 현재 화면을 감성적으로 재해석하기보다 "어떤 패턴을 피해야 하는가"를 정리하는 데 강함

### 5. `anthropics/skills`의 `frontend-design`

역할:

- AI가 고품질 프런트엔드를 만들 때 참고하는 공식 스킬

LAMDiceBot에 유효한 포인트:

- 의도 없는 평균적인 UI를 경계함
- 폰트, 색, 배경, 모션, 레이아웃에서 명확한 방향성을 요구함

적용 판단:

- 새 랜딩이나 새 관리 화면을 만들 때 기본 미감 체크리스트로 적합
- 다만 현재 프로젝트는 먼저 구조 정리가 필요하므로 단독 해법은 아님

## 구현 체계 참고용 저장소

### 1. `primer/react`

역할:

- GitHub의 Primer Design System React 구현체

LAMDiceBot에 유효한 포인트:

- 통계, 관리자, 표, 배지, 패널처럼 정보 밀도가 높은 화면의 정리 방식
- 문서형 화면과 운영형 화면의 단정한 구조

적용 판단:

- `pages/statistics.html`, `admin.html`, 랭킹/멤버 관리 UI 같은 곳에 잘 맞음

### 2. `radix-ui/primitives`

역할:

- 접근성과 커스터마이징 중심의 low-level UI primitives

LAMDiceBot에 유효한 포인트:

- 다이얼로그, 드롭다운, 토스트, 오버레이 같은 상호작용 품질 기준

적용 판단:

- 디자인 복제용이 아니라 상호작용 구조 개선용
- 현재 `alert`, `confirm`, 임시 overlay를 정리할 때 좋은 참고축

### 3. `style-dictionary/style-dictionary`

역할:

- 디자인 토큰을 여러 플랫폼 형식으로 빌드하는 도구

LAMDiceBot에 유효한 포인트:

- `theme.css`의 토큰을 장기적으로 체계화하는 방향

적용 판단:

- 당장 도입 우선순위는 높지 않음
- 현재는 토큰 부재보다 "토큰이 inline style과 거대한 HTML 파일에 흩어진 문제"가 더 큼

## 화면군별 추천 참고처

### 메인 랜딩

참고 우선순위:

- `frontend-design`
- `impeccable`
- `design-ai`의 Vercel, GitHub, PlayStation 계열

가져올 포인트:

- 명확한 첫인상
- CTA 우선순위
- 감정선은 살리되 과한 AI풍을 피하는 구성

### 게임 화면

참고 우선순위:

- `awesome-design-md`
- `design-ai`의 Discord, Xbox, PlayStation, Twitch 계열
- `radix-ui/primitives`

가져올 포인트:

- 게임별 대표색 유지
- 공용 패널, 오버레이, 버튼, 상태 UI의 구조 통일
- 실시간 상호작용에 맞는 빠른 피드백

### 문서/가이드/SEO 페이지

참고 우선순위:

- `design-ai`의 Notion, GitHub, Linear, Mintlify 계열 감각
- `primer/react`

가져올 포인트:

- 긴 글 가독성
- 일관된 상단/하단 셸
- 덜 산만한 정보 흐름

### 운영/통계/관리 화면

참고 우선순위:

- `primer/react`
- `radix-ui/primitives`
- `impeccable`

가져올 포인트:

- 표와 카드의 정보 밀도 정리
- 기본 브라우저 상호작용 대체
- 빈 상태, 경고, 삭제 흐름 정리

## LAMDiceBot에 대한 최종 판단

외부 저장소 조사 기준으로 보면, 지금 LAMDiceBot에 가장 필요한 것은 다음 네 가지다.

1. 루트 `DESIGN.md` 초안 작성
2. 화면군 구분 문서화
3. 공용 UI 셸과 패턴 추출
4. 실제 런타임 기준으로 손볼 화면 우선순위 재정의

반대로, 지금 시점에 우선순위가 낮은 것은 다음과 같다.

- 특정 브랜드 디자인을 그대로 차용하는 작업
- 토큰 빌드 파이프라인 도입
- 전면 리브랜딩

## 추천 액션

- `DESIGN.md` 초안 만들기
- 메인 진입 화면, 게임 화면, 문서 페이지, 운영 페이지를 서로 다른 화면군으로 정의하기
- 공용 패턴 후보를 추출하기
  - top nav
  - footer
  - page container
  - stat card
  - table shell
  - modal / dialog
  - toast / notice
- 이후에만 개별 레퍼런스의 시각 언어를 부분 차용하기

## 참고 소스

- `awesome-design-md`: <https://github.com/VoltAgent/awesome-design-md>
- `stitch-skills`: <https://github.com/google-labs-code/stitch-skills>
- `design-ai`: <https://github.com/Khalidabdi1/design-ai>
- `impeccable`: <https://github.com/pbakaus/impeccable>
- `frontend-design`: <https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md>
- `primer/react`: <https://github.com/primer/react>
- `radix-ui/primitives`: <https://github.com/radix-ui/primitives>
- `style-dictionary`: <https://github.com/style-dictionary/style-dictionary>
