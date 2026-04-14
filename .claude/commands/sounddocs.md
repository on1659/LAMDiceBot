---
description: "Update SOUND-NOTES.md to latest state. Syncs with config and actual files."
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# /sounddocs — 사운드 문서 최신화

SOUND-NOTES.md를 현재 상태와 동기화한다.

---

## 수집할 정보

### 1. sound-config.json 읽기
- 등록된 모든 키와 경로

### 2. 실제 파일 존재 여부 확인
```bash
ls -la assets/sounds/*/
```
- 파일 존재 + 8,340 bytes = placeholder (❌ 에셋 없음)
- 파일 존재 + 8,340 bytes 초과 = 실제 파일 (✅ 실제 파일)
- 파일 미존재 = 누락 (⚠️ 파일 없음)

### 3. 코드에서 사용 여부 확인
```bash
grep -r "SoundManager.playSound\|SoundManager.playLoop" *.html
```
- 각 키가 실제로 코드에서 호출되는지 확인
- 트리거 위치 (파일:라인) 기록

### 4. 게임별 사운드 활성화 함수 확인
- `getDiceSoundEnabled()`
- `getRouletteSoundEnabled()`
- `getHorseSoundEnabled()`
- 등

---

## SOUND-NOTES.md 업데이트 형식

```markdown
# 사운드 시스템 노트

> 설정 파일: `assets/sounds/sound-config.json`
> 재생 유틸: `assets/sounds/sound-manager.js`
> 최종 업데이트: {YYYY-MM-DD HH:mm}

## 파일 상태 범례

| 표시 | 의미 |
|------|------|
| ✅ 실제 파일 | 실제 효과음이 들어있는 mp3 |
| ❌ 에셋 없음 | placeholder (무음 더미 ~8KB) — 실제 mp3로 교체 필요 |
| ⚠️ 파일 없음 | config에 등록되었으나 파일 자체가 없음 |
| 🔇 미사용 | 파일은 있으나 코드에서 호출하지 않음 |

---

## 주사위 (dice)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `dice_roll` | `assets/sounds/dice/roll.mp3` | {트리거 설명} | {파일:라인} | ✅/❌ |
...

## 룰렛 (roulette)
...

## 경마 (horse-race)
...

## 팀전 (team)
...

## 공통 (common)
...

---

## 요약

- 전체 {n}개 키 중 **실제 에셋: {n}개**, **교체 필요: {n}개**, **미사용: {n}개**
- placeholder 파일은 `0xFF 0xFB` MP3 헤더만 있는 무음 더미 (~8KB)
- 실제 효과음 mp3를 같은 경로에 덮어쓰면 즉시 적용됨
```

---

## 실행 절차

1. **sound-config.json 파싱**
   - 모든 키-경로 쌍 추출

2. **파일 상태 확인**
   - 각 경로에 대해 파일 존재 및 용량 체크
   - 8,340 bytes (또는 ~8KB) = placeholder

3. **코드 사용 여부 검색**
   - `*.html` 파일에서 `SoundManager.playSound('{key}')` 또는 `playLoop('{key}')` 검색
   - 트리거 위치와 주변 컨텍스트로 "재생 시점" 추론

4. **게임별 그룹화**
   - 키 prefix로 분류: dice_, roulette_, horse-race_, team_, common_

5. **SOUND-NOTES.md 덮어쓰기**
   - 위 형식으로 전체 재작성
   - 최종 업데이트 타임스탬프 추가

6. **완료 리포트**
   ```
   ## /sounddocs 완료

   - 전체 키: {n}개
   - ✅ 실제 에셋: {n}개
   - ❌ placeholder: {n}개
   - ⚠️ 파일 없음: {n}개
   - 🔇 미사용: {n}개

   SOUND-NOTES.md 업데이트 완료
   ```

---

## 규칙

1. 기존 SOUND-NOTES.md를 완전히 덮어쓴다 (백업 불필요)
2. 트리거 설명은 코드 컨텍스트에서 최대한 추론 (예: "주사위 굴릴 때", "레이스 시작 시")
3. 추론 불가능한 경우 "미연결" 표시
4. 한국어로 작성
