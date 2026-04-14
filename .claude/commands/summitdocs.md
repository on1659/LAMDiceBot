---
description: "Commit and push only docs/ folder changes. Auto-generates commit message based on changed documents."
---

# SummitDocs - 문서 전용 커밋 & 푸시

docs/ 폴더의 변경사항만 커밋하고 푸시하는 스킬.

## Step 0: Git 인코딩 설정 (Windows 한글 깨짐 방지)

```bash
# 세션 시작 시 UTF-8 설정 (한글 커밋 메시지/로그 깨짐 방지)
git config --local i18n.commitEncoding utf-8
git config --local i18n.logOutputEncoding utf-8
```

## Step 1: docs 변경사항 확인

```bash
git status docs/
git diff --name-only docs/
git diff --cached --name-only docs/
git log --oneline --encoding=utf-8 -5 docs/
```

docs/ 폴더 내 변경된 파일만 확인한다.

## Step 2: 변경사항 분석

변경된 문서 파일들을 분석하여:
- 새로 추가된 문서
- 수정된 문서
- 삭제된 문서

각각 분류한다.

## Step 3: 커밋 메시지 자동 생성

### 커밋 메시지 규칙:
- prefix: `docs:`
- 변경된 문서가 1개면: `docs: {파일명} 업데이트`
- 변경된 문서가 여러 개면: `docs: {주요내용} 문서 업데이트 ({n}개 파일)`
- 회의록이면: `docs: {주제} 회의록 추가/업데이트`

### 예시:
```
docs: server-concept 회의록 업데이트
docs: API 설계 문서 추가 (3개 파일)
docs: 게임 가이드 문서 정리
```

## Step 4: 스테이징 & 커밋 & 푸시

```bash
git add docs/
git commit -m "커밋메시지

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
git push
```

### 충돌 처리:
- push 실패 시 `git stash && git pull --rebase && git push && git stash pop` 시도
- 그래도 실패하면 사용자에게 알림

## 인자 사용법:
- `/summitdocs` - 기본: docs/ 변경사항 커밋 → 푸시
- `/summitdocs --no-push` - 푸시 없이 커밋만
- `/summitdocs --dry-run` - 변경사항 확인만, 커밋하지 않음

## 주의사항:
- docs/ 폴더에 변경사항이 없으면 "변경사항 없음" 메시지 출력
- docs/ 외 다른 파일 변경사항은 무시됨 (스테이징하지 않음)
