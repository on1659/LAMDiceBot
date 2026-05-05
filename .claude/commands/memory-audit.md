---
description: "메모리 폴더 다이어트 진단. 6개 룰 적용해서 삭제/축소 후보를 보고서로 제시 후 사용자 승인 시 일괄 처리."
---

# Memory Audit — 메모리 다이어트 진단

`C:\Users\user\.claude\projects\d--Work-LAMDiceBot\memory\` 폴더의 개별 메모리 파일을 6개 룰로 검사하여 다이어트 후보를 제시한다. **MEMORY.md(인덱스)는 검사 대상이 아니다 — 결과 반영 시에만 갱신.**

## 절차

### Step 1: 폴더 스캔

```bash
ls -la "$HOME/.claude/projects/d--Work-LAMDiceBot/memory/"
```

`.audit-counter` 파일과 `MEMORY.md`는 제외, 나머지 `.md` 파일만 검사 대상.

### Step 2: 각 파일에 6개 룰 적용

각 파일을 읽고 다음 룰 결과를 표로 누적:

#### 룰 1: Stale (시스템 자동 표시)

시스템이 메모리 파일 읽을 때 부착하는 `"This memory is N days old"` 경고에서 N 추출.
- N ≥ 60: 강한 stale 후보
- 30 ≤ N < 60: 약한 stale 후보
- N < 30: stale 아님

#### 룰 2: Code derive 가능

파일 본문에서 코드 인용을 추출 (백틱으로 감싼 file path / function name / 변수명).
각 인용에 대해:
```bash
grep -r "<인용>" "d:/Work/LAMDiceBot/" --include="*.js" --include="*.html" --include="*.css" -l
```
매칭되면 "코드에서 직접 derive 가능" 플래그.

#### 룰 3: Git 완료 검사

파일 본문에 다음 키워드 있으면 git log 검색:
- `"진행 중"`, `"미완료"`, `"푸시 안 됨"`, `"TODO"`, `"이어서"`, `"다음 세션"`

```bash
git log --all --oneline --since="<파일 frontmatter 날짜>" | grep -iE "<관련 키워드>"
```
매칭되면 "이미 완료된 작업" 플래그.

#### 룰 4: CLAUDE.md / 룰 중복

`.claude/rules/*.md`와 본문 비교. 70%+ 텍스트 유사도면 중복 플래그.
간단 검사: 문장 단위로 grep, 5문장 이상 일치 → 중복.

#### 룰 5: 메모리 간 중복

다른 메모리 파일과 본문 비교. 70%+ 유사도면 중복 플래그.

#### 룰 6: Secret 누출 (보안)

다음 정규식 패턴 grep:
- 텔레그램 봇 토큰: `[0-9]{8,}:[A-Za-z0-9_-]{30,}`
- API 키: `(sk-|pk_)[A-Za-z0-9]{20,}`
- AWS 키: `AKIA[0-9A-Z]{16}`
- 일반 토큰 prefix: 20자+ 영숫자 + `:` + 30자+ 영숫자

매칭되면 **즉시 알림** (액션 = 토큰 제거 + .env 참조로 변경).

### Step 3: 진단 보고서 작성

표 형식으로 사용자에게 제시:

```
| # | 파일 | 크기 | 적용 룰 | 권장 액션 |
|---|------|------|---------|-----------|
| 1 | foo.md | 3KB | 룰 1, 3 | 삭제 |
| 2 | bar.md | 1.5KB | 룰 6 | 즉시 토큰 제거 |
| 3 | baz.md | 2KB | 룰 5 | qux.md와 통합 |
```

각 후보에 **삭제 / 축소 / 통합 / 보존** 중 권장 액션 명시.
정보 손실 위험이 있는 항목은 외부 보존 위치(git, docs/, .env 등) 명시.

### Step 4: 사용자 승인 → 일괄 처리

사용자에게 "전부 OK" / "개별 결정" 중 선택받음.

- **삭제**: 파일 제거 + MEMORY.md 인덱스에서 해당 줄 제거
- **축소**: 파일 본문을 한 줄~3줄로 압축 (frontmatter 유지)
- **통합**: 두 파일 내용 합쳐서 한 파일로
- **보존**: 변경 없음

처리 후 결과 보고:
- before/after 파일 수, 폴더 크기
- 삭제된 파일 목록 (rollback용으로 임시 출력)

## 안전 가드

- **MEMORY.md는 절대 자동 삭제하지 않음** (인덱스 보존)
- **`.audit-counter`는 검사 대상 아님**
- 룰 6 (Secret 누출) 발견 시 다른 룰보다 **우선 처리** — 사용자 다음 결정 기다리지 말고 즉시 알림
- 모든 액션은 사용자 승인 후 실행. 자동 삭제 금지.

## 트리거

- 수동: `/memory-audit` 입력
- 자동 알림: SessionStart 카운터(`audit-counter.sh`)가 10세션마다 안내 메시지 출력
- 카운터 위치: `~/.claude/projects/d--Work-LAMDiceBot/memory/.audit-counter`
- 카운터 리셋이 필요하면 해당 파일 삭제

## 참고

- 원칙: `~/.claude/CLAUDE.md` "auto memory" 섹션의 "What NOT to save"
- 다이어트 사례: 2026-05-04 세션에서 `MEMORY.md` 5,375자 → 1,400자 (-74%)
