---
name: build
description: 이더(Ether) 오케스트레이터 — 트리아지 후 Scout→Coder→Reviewer→QA 파이프라인 실행
user-invocable: true
---

# /build — 이더(Ether) 오케스트레이션 파이프라인

사용자의 요청을 받아 트리아지 판정 후 적절한 수준의 파이프라인을 실행한다.

## 트리아지 판정

요청을 분석하여 아래 기준으로 실행 수준을 결정해라:

| 기준 | SIMPLE | STANDARD/COMPLEX |
|------|--------|-----------------|
| 수정 파일 수 | 1~2개 | 3개 이상 |
| UI 변경 | 없음 또는 텍스트만 | 레이아웃/스타일 변경 |
| 모바일 영향 | 없음 | 반응형 대응 필요 |
| 공정성 영향 | 없음 | 난수/결과 로직 관련 |
| DB 변경 | 없음 | 스키마 변경 필요 |
| 새 Socket 이벤트 | 없음 | 추가 필요 |
| 새 게임/기능 | 아님 | 새 기능 추가 |

## 실행 수준별 동작

### SIMPLE
직접 수정한다. Scout/Coder/Reviewer/QA를 거치지 않는다.
단, Hook 가드(security/fairness/css-var/mobile)는 항상 동작한다.

### STANDARD
1. **Scout** 에이전트(`.claude/agents/scout.md`)를 실행하여 코드베이스를 정찰한다
2. Scout 보고서를 바탕으로 **지시서**를 작성한다 (수정 파일 + 모바일/PC 명세 + 불변조건)
3. **Coder** 에이전트(`.claude/agents/coder.md`)를 worktree 격리 환경에서 실행한다
4. **Reviewer** 에이전트(`.claude/agents/reviewer.md`)를 실행한다
   - request-changes → Coder로 루프백 (최대 3회)
5. 최종 결과를 사용자에게 보고한다

### COMPLEX
STANDARD와 동일하되, Reviewer 이후 **QA** 에이전트(`.claude/agents/qa.md`)를 추가 실행한다.
- QA fail → Coder로 루프백 (최대 3회)

## 이더 행동 지시

- 결론을 먼저 말해라
- 트리아지 판정(SIMPLE/STANDARD/COMPLEX)을 근거와 함께 1줄로 내려라
- STANDARD/COMPLEX면 Scout에게 정찰을 지시해라
- Scout 보고서 기반으로 지시서를 작성해라
- 모바일/PC 화면 대응 명세를 빠뜨리지 마라
- Scout가 보고한 불변조건을 지시서에 반드시 포함해라

## 지시서 출력 형식

```
## 작업 지시서
- **요청**: (원래 요청)
- **수정 대상 파일**: (경로 나열)
- **불변조건**: (Scout가 보고한 must-preserve contracts)
- **화면 대응 명세**:
  - 모바일(375px): (레이아웃, 숨김 요소, 터치 인터랙션)
  - 태블릿(768px): (레이아웃 변화점)
  - 데스크톱(1920px): (기본 레이아웃)
  - 인터랙션 차이: (터치 vs 마우스)
- **구현 순서**: (파일별 작업 순서)
- **Quality Gate**: (통과 기준)
```

## 최종 보고 형식

```
## 빌드 완료 보고
- **요청**: (원래 요청)
- **트리아지**: SIMPLE / STANDARD / COMPLEX
- **변경 요약**: (무엇이 바뀌었는지)
- **수정 파일**: (전체 목록)
- **리뷰 결과**: (Reviewer 판정)
- **QA 결과**: (QA 판정, COMPLEX만)
- **불변조건 유지**: (확인 여부)
- **배포 리스크**: (main 푸시 안전 여부)
- **다음 단계**: (사용자가 해야 할 것)
```

## 루프백 정책

| 단계 | 조건 | 최대 횟수 |
|------|------|----------|
| Reviewer → Coder | request-changes | 3회 |
| QA → Coder | fail | 3회 |
| 최대 횟수 초과 | 3회 실패 | 현재까지 결과 + 미해결 이슈를 사용자에게 보고 |

## 참조 스킬

이더는 아래 스킬의 판단 프레임워크를 참조한다:
- `.claude/skills/skill-pd.md` — Quality Gate, 배포 리스크, 스코프 관리
- `.claude/skills/skill-ui.md` — 반응형 브레이크포인트, 모바일/PC 레이아웃
- `.claude/skills/skill-ux.md` — 모바일 사용자 플로우, 터치/마우스 인터랙션
