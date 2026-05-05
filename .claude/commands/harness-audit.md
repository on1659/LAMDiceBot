---
description: ".claude/ 하네스 폴더를 6개 룰로 점검 (worktree/lock/orphan/reference/hook/stale-agent). 보고서 → 사용자 승인 → 일괄 처리."
---

# Harness Audit — 하네스 점검

LAMDiceBot의 이더(Ether) 하네스(`.claude/`)를 6개 룰로 점검한다. **메모리 폴더는 건드리지 않는다 — `/memory-audit`이 그 역할.**

자세한 룰 설명: [`docs/harness/harness-audit.html`](../../docs/harness/harness-audit.html)

## 절차

### Step 1: 폴더 스캔

```bash
ls "$CLAUDE_PROJECT_DIR/.claude/"
git worktree list
```

검사 대상: `.claude/agents/`, `.claude/rules/`, `.claude/skills/`, `.claude/commands/`, `.claude/hooks/`, `.claude/worktrees/`, `.claude/settings.json`, `.claude/*.lock`.
**제외**: `.claude/worktrees/` 하위는 worktree 자체가 검사 대상이지 내부 파일은 아님.

### Step 2: 6개 룰 적용

#### 룰 1: Stale Worktree

```bash
# 1) 모든 worktree 나열
git worktree list

# 2) 외부 worktree(.claude/worktrees/) 각각 dirty 검사
for wt in "$CLAUDE_PROJECT_DIR/.claude/worktrees/"*/; do
    cd "$wt" && status=$(git status --porcelain) && cd "$CLAUDE_PROJECT_DIR"
    if [ -z "$status" ]; then echo "CLEAN: $wt"
    else echo "DIRTY: $wt"; fi
done
```

- **Clean** → 즉시 `git worktree remove <path>` 안전
- **Dirty** → 보존 후 사용자 보고 (어떤 파일이 수정됐는지 함께)

#### 룰 2: Stale Lock

```bash
for lock in "$CLAUDE_PROJECT_DIR/.claude/"*.lock; do
    [ ! -f "$lock" ] && continue
    acquired=$(grep -oE '"acquiredAt":[0-9]+' "$lock" | grep -oE '[0-9]+')
    now=$(date +%s%3N)
    diff_h=$(( (now - acquired) / 3600000 ))
    [ $diff_h -gt 24 ] && echo "STALE LOCK ($diff_h h): $lock"
done
```

- **24h+** → 자동 삭제 안전 (단, pid가 살아있으면 보존)
- **1h~24h** → 보고만

#### 룰 3: Orphan Files

각 `.md` 파일명을 다른 모든 마크다운/코드 파일에서 grep. 0회 매칭이면 후보.

```bash
for f in "$CLAUDE_PROJECT_DIR/.claude/agents/"*.md \
         "$CLAUDE_PROJECT_DIR/.claude/rules/"*.md \
         "$CLAUDE_PROJECT_DIR/.claude/skills/"*.md; do
    [ ! -f "$f" ] && continue
    name=$(basename "$f" .md)
    refs=$(grep -rln "$name" --include="*.md" \
        "$CLAUDE_PROJECT_DIR/.claude/" \
        "$CLAUDE_PROJECT_DIR/docs/" \
        "$CLAUDE_PROJECT_DIR/CLAUDE.md" 2>/dev/null \
        | grep -v "^$f$" | wc -l)
    [ $refs -eq 0 ] && echo "ORPHAN: $f"
done
```

- **자동 삭제 금지** — 후보 목록만 제시

#### 룰 4: Broken References

마크다운 링크 `[text](path)`와 백틱 인용 `` `path/file.md` ``의 모든 로컬 경로 검증.

```bash
# 마크다운 링크에서 .md 경로 추출 후 존재 검증
grep -hoE '\]\([^)]+\.md\)' \
    "$CLAUDE_PROJECT_DIR/CLAUDE.md" \
    "$CLAUDE_PROJECT_DIR/.claude/rules/"*.md \
    "$CLAUDE_PROJECT_DIR/.claude/agents/"*.md 2>/dev/null \
    | sed 's/.*(\(.*\))/\1/' \
    | sort -u \
    | while read p; do
        # 절대 경로면 그대로, 상대면 프로젝트 루트 기준
        [[ "$p" =~ ^https?:// ]] && continue
        [[ "$p" =~ \{.*\} ]] && continue  # 템플릿 placeholder 제외 (예: {파일명}-impl.md)
        full="$CLAUDE_PROJECT_DIR/$p"
        [ ! -f "$full" ] && [ ! -f "$p" ] && echo "BROKEN: $p"
    done
```

- **파일 이름 비슷한 게 있음** → rename 후보 제시 (`find ... -name "*similar*"`)
- **완전 사라짐** → 참조 줄 갱신 또는 제거

#### 룰 5: Hook 무결성

```bash
# settings.json에서 hook 스크립트 추출
grep -oE '\.claude/hooks/[a-zA-Z0-9_-]+\.(sh|py)' \
    "$CLAUDE_PROJECT_DIR/.claude/settings.json" \
    | sort -u \
    | while read h; do
        full="$CLAUDE_PROJECT_DIR/$h"
        if [ ! -f "$full" ]; then
            echo "MISSING: $h"
        elif [ ! -x "$full" ]; then
            echo "NOT EXECUTABLE: $h"
        fi
    done
```

- **파일 없음** → settings.json 등록 제거 또는 hook 작성
- **실행 권한 없음** → `chmod +x <path>`

#### 룰 6: Stale Agent

```bash
find "$CLAUDE_PROJECT_DIR/.claude/agents" -name "*.md" -mtime +60 \
    -exec stat -c "%y %n" {} \;
```

- **60일+** → 후보 목록 + 마지막 수정일 보고만
- **자동 삭제 금지** — 사용자가 "아직 쓰는가?" 판단

### Step 3: 진단 보고서

표 형식으로 사용자에게 제시:

```
| # | 항목 | 룰 | 권장 액션 |
|---|------|-----|-----------|
| 1 | .claude/worktrees/agent-xxx | 1 (clean) | git worktree remove |
| 2 | .claude/worktrees/agent-yyy | 1 (dirty) | 사용자 결정 |
| 3 | .claude/scheduled_tasks.lock | 2 | 즉시 삭제 |
| 4 | .claude/agents/old.md | 6 | 사용자 검토 (90일+ 안 변경) |
```

각 후보에 **제거 / 보존 / 보고만 / 수동 검토** 중 권장 액션 명시.

### Step 4: 사용자 승인 → 일괄 처리

- **제거**: 해당 명령 실행 (worktree remove / rm / 등)
- **보존**: 변경 없음
- **보고만**: 사용자가 별도로 확인
- **수동 검토**: 추가 정보 출력 (해당 파일 본문 미리보기 등)

처리 후 결과 보고 (before/after worktree 수, 디스크 절약 등).

## 안전 가드

- **자동 삭제 금지**: 룰 1(dirty), 3(orphan), 6(stale agent) — 보고만
- **자동 삭제 안전**: 룰 1(clean), 룰 2(24h+ lock) — 단 pid 살아있으면 보존
- **자동 수정 금지**: 룰 4(broken ref), 룰 5(hook missing) — 사용자 확인 필수
- **메모리 폴더 안 건드림**: `~/.claude/projects/.../memory/`는 `/memory-audit` 영역
- **`.claude/worktrees/` 외부 파일 안 건드림**: worktree 자체만 검사 대상

## 트리거

- 수동: `/harness-audit` 입력
- 자동 알림: SessionStart 카운터(`audit-counter.sh`)가 10세션마다 안내. 메시지에 `/harness-audit`과 `/memory-audit` 모두 포함.

## 참고

- 자세 가이드: `docs/harness/harness-audit.html`
- 짝꿍: `.claude/commands/memory-audit.md`
- 하네스 룰 본체: `.claude/rules/harness.md`, `.claude/rules/workflow.md`
