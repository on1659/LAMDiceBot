# /meeting-multi - 3인 멀티에이전트 팀 회의

Topic: $ARGUMENTS (default: "현재 단계에서 추가할 기능")

## 지시사항

LAMDiceBot 프로젝트의 3인 전문가를 **독립 에이전트로 병렬 실행**한다.
총 2라운드(독립 제안 + 교차검토) 진행.

---

## 3인 전문가 정의

- **A 기획자**: 전략적 방향, 비즈니스 가치, 사용자 경험, 게임 재미, 우선순위 판단
- **B 개발자**: 아키텍처, 실제 구현, Socket.IO 코드, 기술 부채, 확장성
- **C QA/UX**: 테스트 방법론, UI/UX, 사운드, 모바일 호환성, 품질 검증

---

## 프로젝트 컨텍스트 (에이전트에게 전달)

```
LAMDiceBot - 멀티플레이어 게임 플랫폼
- 게임: 주사위, 룰렛, 경마, 팀 배정
- 핵심 가치: 100% 공정성 (서버 난수 생성)
- 기술: Node.js + Express + Socket.IO (실시간 WebSocket)
- 보안: Rate Limiting, 입력값 검증, Host 권한 관리
- 주요 파일:
  - server.js (서버)
  - dice-game-multiplayer.html (주사위)
  - roulette-game-multiplayer.html (룰렛)
  - horse-race-multiplayer.html (경마)
  - team-game-multiplayer.html (팀 배정)
  - assets/sounds/ (사운드 리소스)
```

---

## 1단계: 현황 파악

- README.md, CHANGELOG.md 최근 항목만 확인
- 현황 요약 작성 (`statusSummary`) - 간략하게

---

## 2단계: 3 에이전트 병렬 독립 제안

**각 에이전트에게 `statusSummary`, topic, 프로젝트 컨텍스트를 전달한다.**

### Agent A: 기획자
- 전략 + 사용자 관점에서 3-5개 제안
- 각 항목: 기능명, 전략적 의의, 사용자 가치, 우선순위(상/중/하)

### Agent B: 개발자
- 기술 관점에서 3-5개 제안
- 각 항목: 기능명, 구현 방법, 영향 파일, 난이도(상/중/하)

### Agent C: QA/UX
- 품질 + UX 관점에서 3-5개 제안
- 각 항목: 기능명, 테스트 방법, UX 개선점, 리스크(상/중/하)

---

## 3단계: 3 에이전트 병렬 교차검토

- Agent A: 기획자가 B, C 제안에 비즈니스 가치 평가
- Agent B: 개발자가 A, C 제안에 구현 가능성 평가
- Agent C: QA/UX가 A, B 제안에 테스트 방법 + UX 영향 평가

---

## 4단계: 합의 도출

3개 역할의 의견을 종합하여:

- 2개 이상 역할이 긍정 평가 → 채택
- 2개 이상 역할이 부정 평가 → 기각
- 의견 충돌 → 명시적 기록 후 보류
- 최종 판정: 채택/보류/기각

---

## 5단계: 회의록 저장

`docs/meeting/plan/multi/YYYY-MM-DD-HHmm-{topic-summary}.md`에 저장.
(시간 포함으로 자동 정렬되도록)

### Git 인코딩 설정 (커밋 시)

```bash
# 커밋 전 UTF-8 설정 (한글 깨짐 방지)
git config --local i18n.commitEncoding utf-8
git config --local i18n.logOutputEncoding utf-8
```

---

## 6단계: 구현문서(impl) 생성

회의록 저장 후, 채택 항목을 **영문 구현문서**로 분리 생성한다.

**파일명**: `docs/meeting/impl/{회의록 파일명}-impl.md`

**규칙**:
- impl이 구현의 **source of truth** — 구현 세션에서는 impl만 읽는다
- 회의록은 역사 기록이므로 변경하지 않는다
- 피드백으로 구현 내용이 바뀌면 impl만 수정한다
- 회의록 5번 섹션에는 impl 링크만 남긴다

**impl 포함 내용**: 추천 모델, 수정 파일, 구현 상세 (코드/위치), 구현 순서, 검증 방법

**구현 완료 시**: impl 파일을 `docs/meeting/applied/`로 이동
**impl 하단에 반드시 포함**: `> **On completion**: move this file to \`docs/meeting/applied/\``

---

## 7단계: 자동 커밋 & 푸시

회의록과 impl 문서 생성 완료 후 **자동으로 `/summitdocs` 실행**:

```bash
# UTF-8 인코딩 설정
git config --local i18n.commitEncoding utf-8
git config --local i18n.logOutputEncoding utf-8

# docs 폴더 변경사항 스테이징
git add docs/

# 커밋 메시지 자동 생성 및 커밋
git commit -m "docs: {주제} 회의록 및 구현 문서 추가

{변경사항 요약}

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 원격 저장소에 푸시
git push
```

**자동 커밋 규칙**:
- 회의록과 impl 문서 생성 완료 후 즉시 실행
- 커밋 메시지는 주제 기반 자동 생성
- 푸시 실패 시 사용자에게 알림

---

## 출력 형식

```markdown
# LAMDiceBot 팀 회의록

**일시**: {날짜}
**주제**: {topic}
**참석자**: 기획자, 개발자, QA/UX
**회의 방식**: 3인 멀티에이전트 독립 분석 → 교차 검토 → 합의 도출

---

## 1. 현황 요약

{현재 상태 - 간략하게}

## 2. 독립 분석 결과

### 2-1. 기획자 (A)
{전략 + 사용자 중심 제안}

### 2-2. 개발자 (B)
{기술 중심 제안}

### 2-3. QA/UX (C)
{품질 + UX 제안}

## 3. 교차 검토 결과

### 3-1. 기획자 검토
{A의 B, C 제안 평가}

### 3-2. 개발자 검토
{B의 A, C 제안 평가}

### 3-3. QA/UX 검토
{C의 A, B 제안 평가}

## 4. 합의 도출

| 우선순위 | 기능 | 판정 | 기획 | 개발 | QA/UX | 근거 |
|---------|------|------|------|------|-------|------|

### 의견 충돌 사항

{충돌 목록 - 있을 경우}

## 5. 다음 단계 (Action Items)

> 구현 상세: [`{파일명}-impl.md`](../impl/{파일명}-impl.md)

- [ ] {채택 항목 요약 — 1줄씩}
```

---

## 규칙

1. 사용자에게 질문하지 않는다. README.md 기준으로 자율 판단.
2. 파일 전체를 읽지 말고 필요한 부분만 확인한다.
3. QA는 **"어떻게 테스트할 것인가"** 방법론에 집중한다.
4. 한국어로 응답한다.
