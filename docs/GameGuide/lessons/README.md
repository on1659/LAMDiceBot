# Game Lessons Learned

게임 추가/수정 작업 중 발견한 **함정, 실수, 복구한 케이스**를 게임별로 누적하는 폴더.

## 구조

| 파일 | 역할 |
|------|------|
| [_common.md](_common.md) | 모든 게임에 공통으로 적용되는 함정 (현 7개: Tailwind override, .game-section.active, updateUsers 형식, horse-race.css 의존, URL 진입 흐름, .game-active 의미, Playwright customAlert 정리) |
| [horse-race.md](horse-race.md) | 경마 작업 lesson |
| [bridge-cross.md](bridge-cross.md) | 다리건너기 작업 lesson |
| [dice.md](dice.md) | 주사위 작업 lesson |
| [roulette.md](roulette.md) | 룰렛 작업 lesson |
| [ladder.md](ladder.md) | 사다리타기 작업 lesson |

## 자동 트리거 (사용자가 수동으로 호출할 필요 없음)

### 조회 — Claude가 자동 수행
[`.claude/rules/harness.md`](../../../.claude/rules/harness.md)에 룰이 등록되어 있어 다음 상황에서 Claude가 자동으로 이 폴더를 읽는다:

- COMPLEX 트리아지 + 키워드: "새 게임", "게임 추가", "새 모드", "게임 모드"
- STANDARD 트리아지지만 수정 대상이 게임별 파일(`*-multiplayer.html`, `socket/{game}.js` 등)을 포함하는 경우

읽는 순서:
1. `_common.md` (모든 게임 공통)
2. 작업 대상 게임의 `{game}.md`
3. 비슷한 기존 게임 1~2개의 `{game}.md` (참고용)

### 추가 — Claude가 보고 시 능동 제안
작업 종료 시 Coder/Reviewer가 새로 발견한 함정이 있으면 보고서 마지막에:

> 💡 **이번 작업의 lesson 후보:**
> - (구체적 함정 1줄 요약)
> - 이 폴더(`docs/GameGuide/lessons/{game}.md`)에 추가할까요?

사용자가 OK하면 Claude가 직접 누적. 슬래시 커맨드 호출 불필요.

## 작성 형식 (각 lesson)

```markdown
## YYYY-MM-DD — 한 줄 제목

**상황:** 작업 컨텍스트 (어떤 작업 중이었는지)
**함정/실수:** 구체적으로 무엇이 잘못되었나
**증상:** 어떻게 발견했나 (브라우저 콘솔, Reviewer 지적, QA 발견 등)
**해결/예방:** 다음에는 어떻게 (코드 패턴, 검증 명령, 등)
**관련 파일/커밋:** 필요 시 git commit hash 또는 PR
```

## 작성 원칙

- **사실만**: "X를 깜빡했다" 식의 자책은 빼고, "X가 누락되면 Y가 발생" 같은 인과만
- **구체적**: 파일 경로, 줄 번호, 함수 이름까지
- **검증 가능**: "어떻게 감지하는가" 1줄 — grep, console 명령, 브라우저 확인 등
- **유효 기간**: 코드 구조가 바뀌어 더 이상 적용 안 되는 lesson은 git history로 archive (이 폴더는 현재 기준)

## 관련

- [`.claude/rules/new-game.md`](../../../.claude/rules/new-game.md) — 새 게임 추가 절차 (§4 함정 → 이 폴더로 이동)
- [`.claude/rules/harness.md`](../../../.claude/rules/harness.md) — 자동 조회 룰
- [`.claude/agents/coder.md`](../../../.claude/agents/coder.md) — 작업 종료 시 lesson 후보 제안 룰
