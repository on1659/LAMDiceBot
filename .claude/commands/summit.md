---
description: "Write update logs and commit/push. Summarizes changes for users (update-log.txt) and detailed internal changes (summit-log.txt), then commits and pushes."
---

# Summit - Update Log & Deploy

Git 변경사항을 분석하여 업데이트 로그를 작성하고 커밋 + 푸시하는 스킬.

## Step 1: 변경사항 분석

```bash
git diff --name-only
git diff --cached --name-only
git log --oneline -10
```

변경된 파일과 최근 커밋을 확인하여 어떤 작업이 진행되었는지 파악한다.

## Step 2: update-log.txt 작성 (유저 공개용)

update-log.txt 파일 **최상단**에 새 업데이트 내역을 추가한다.

### 작성 규칙:
- **유저가 볼 수 있는 내용만** 작성
- 내부 로직, 서버 구현 상세, DB 스키마 변경 등 민감한 정보 절대 금지
- UI 변경, 새 기능, 버그 수정 등 체감 가능한 변경만 기재
- 기존 형식(HTML 태그 + 이모지) 유지

### 형식:
```
<b style="color: #667eea;">🎮 최신 업데이트</b> <span style="color: #999; font-size: 12px; font-weight: normal;">(날짜)</span>

<b>카테고리 이모지 카테고리명</b>
• 변경사항 1
• 변경사항 2

---
```

- 기존 "최신 업데이트" → "이전 업데이트"로 변경

## Step 3: summit-log.txt 작성 (내부 상세 로그)

summit-log.txt 파일 **최상단**에 상세 변경 내역을 추가한다.

### 작성 규칙:
- 내부 로직 변경, 리팩토링, DB 변경, 서버 로직 등 **모든 것** 기재
- 변경된 파일명, 함수명, 구체적인 구현 내용 포함
- 왜 변경했는지 이유도 포함

### 형식:
```
========================================
📋 Summit Log - [날짜]
========================================

## 변경 파일
- file1.js: 설명
- file2.html: 설명

## 상세 변경 내역

### [카테고리]
- 구체적인 변경 내용
- 변경 이유
- 영향 범위

========================================
```

## Step 4: 커밋 & 푸시

1. 변경된 모든 파일 스테이징 (update-log.txt, summit-log.txt, 코드 파일들)
2. 커밋 메시지 형식: 간결한 한국어 요약
3. `git push` 실행

### 인자 사용법:
- `/summit` - 기본: 변경사항 분석 → 로그 작성 → 커밋 → 푸시
- `/summit --no-push` - 푸시 없이 커밋만
- `/summit --dry-run` - 로그만 작성하고 커밋하지 않음
