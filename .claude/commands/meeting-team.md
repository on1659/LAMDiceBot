# /meeting-team - 지속 팀원 기반 멀티에이전트 회의

## 개요
`.claude/meeting-team-profiles.md`에 정의된 팀원 프로필과
`.claude/skills/` 의 역할별 전문 스킬을 함께 로드해
각 팀원의 성격·전문성·방법론을 가진 독립 서브에이전트로 병렬 실행.

`/meeting-multi`와 달리 역할이 아닌 **사람**으로 동작함.
스킬 파일 덕분에 각 역할별 전문 프레임워크와 체크리스트를 적용해 분석.

---

## Step 1: 프로필 + 스킬 로드 및 회의 설정

1. 다음 파일들을 Read 도구로 동시에 읽어오세요:
   - `.claude/meeting-team-profiles.md` (팀원 프로필)
   - `.claude/skills/skill-pd.md`
   - `.claude/skills/skill-planner-research.md`
   - `.claude/skills/skill-planner-strategy.md`
   - `.claude/skills/skill-backend.md`
   - `.claude/skills/skill-frontend.md`
   - `.claude/skills/skill-qa.md`
   - `.claude/skills/skill-ui.md`
   - `.claude/skills/skill-ux.md`

2. AskUserQuestion 도구로 다음을 확인하세요:

**질문 1 - 회의 주제:**
- $ARGUMENTS 가 있으면 그걸 주제로 사용
- 비어있으면 주제 입력 요청

**질문 2 - 참여 팀원:**
- 기본값: 전원 참여 (지민, 현우, 소연, 태준, 미래, 윤서, 다은, 승호)
- 특정 팀원만 참여시키고 싶으면 이름 입력 가능
- 예시: `지민, 태준, 윤서` (PD + 백엔드 + QA만)

---

## Step 2: 팀원 서브에이전트 병렬 실행

선택된 팀원 수만큼 **Agent 도구를 동시에(한 번에) 실행**하세요.

각 팀원에 해당하는 스킬 파일 매핑:
- 지민 (PD) → `skill-pd.md`
- 현우 (기획자①) → `skill-planner-research.md`
- 소연 (기획자②) → `skill-planner-strategy.md`
- 태준 (개발자① BE) → `skill-backend.md`
- 미래 (개발자② FE) → `skill-frontend.md`
- 윤서 (QA) → `skill-qa.md`
- 다은 (UI) → `skill-ui.md`
- 승호 (UX) → `skill-ux.md`

각 팀원 에이전트 프롬프트 구조:
```
당신은 [이름]입니다. 다음은 당신의 프로필입니다:
[해당 팀원의 프로필 전체 내용]

## 당신의 전문 스킬셋
[해당 역할의 스킬 파일 전체 내용]

## 프로젝트 컨텍스트
LAMDiceBot - Express + Socket.IO 기반 멀티플레이어 게임 플랫폼
게임 4종: 주사위, 룰렛, 경마, 크레인 게임
핵심 가치: 100% 공정성 (서버 측 난수 생성)
기술: Node.js + Express + Socket.IO + PostgreSQL
프론트엔드: 순수 HTML/CSS/JS (프레임워크 없음)

회의 주제: [주제]

위 프로필의 성격과 말투 그대로, 전문 스킬셋의 프레임워크를 활용해서 다음을 작성하세요:
1. 이 주제에 대한 당신의 핵심 의견 (스킬셋의 판단 기준 적용)
2. 우려사항 또는 리스크 (당신 전문성 관점에서, 구체적 수치나 체크리스트 활용)
3. 제안하는 방향 (실행 가능한 수준으로 구체적으로)
4. 다른 팀원에게 묻고 싶은 것 (1가지, 당신 역할에서 가장 중요한 미결 사항)

반드시 프로필에 정의된 말투와 성격으로 답변하세요.
다른 팀원의 의견은 모르는 상태입니다.
```

---

## Step 3: 결과 종합

모든 팀원 결과를 받은 후:

```
## 🏁 [주제] — 팀 회의 결과

### 팀원별 의견
**[이름] (역할)**
[의견 요약 + 특징적인 말투 반영]

### 주요 합의점
[여러 팀원이 동의한 방향]

### 주요 충돌 지점
[팀원 간 의견 차이 — 이름 명시]

### 서로에게 던진 질문들
[각 팀원이 묻고 싶었던 것들 — 다음 회의 아젠다 힌트]

### 권장 다음 액션
[구체적 실행 항목 3가지 이내, 담당자 제안 포함]
```

---

## Step 4: 회의록 저장

`docs/meeting/plan/multi/YYYY-MM-DD-HHmm-{topic-summary}.md`에 저장.

### Git 인코딩 설정 (커밋 시)
```bash
git config --local i18n.commitEncoding utf-8
git config --local i18n.logOutputEncoding utf-8
```

---

## Step 5: 구현문서(impl) 생성

채택 항목을 **영문 구현문서**로 분리 생성.

**파일명**: `docs/meeting/impl/{회의록 파일명}-impl.md`

**규칙**:
- impl이 구현의 **source of truth**
- 회의록은 역사 기록이므로 변경하지 않음
- 피드백으로 구현 내용이 바뀌면 impl만 수정
- 구현 완료 시: impl → `docs/meeting/applied/`로 이동

---

## Step 6: 자동 커밋 & 푸시

`/summitdocs` 실행하여 docs 폴더 커밋 & 푸시.

---

## 팀원 수정 방법

- `.claude/meeting-team-profiles.md` — 팀원 프로필 (이름, 경력, 말투)
- `.claude/skills/skill-[역할].md` — 역할별 전문 방법론 (프레임워크, 체크리스트)

두 파일을 함께 수정해야 완전한 팀원 업그레이드가 됩니다.
