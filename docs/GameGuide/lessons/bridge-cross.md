# Bridge-Cross — Lessons Learned

다리건너기 게임 작업 중 발견한 함정 / 실수 / 복구 케이스 누적.

> 공통 함정은 [`_common.md`](_common.md) 참조.

## 누적

### 2026-04-27 — v1 폐기 → main 기준 v2 재시작

**상황:** mockup base로 v1 통합 작업 (`feat/bridge-cross-integration` 브랜치, commit `fb10f2a` → `03d3fcd`). horse-race base 통째 재작성 + Reviewer 3라운드 + 14건 결함 처리 + 라이브 스모크 8/9 PASS까지 진행.

**함정/실수:** mockup의 IIFE/CSS/레이아웃 잔재가 그대로 남아 공통 시스템(Ready/Order/Chat/ControlBar/AdSense/passwordModal/historySection/resultOverlay/SoundManager) 통합이 **구조적으로** 어려워짐. 사용자 명시 지시는 "목업은 게임플레이만 가져오란거였지 그 외의 모든건 참고하면안됐어"였음.

**증상:** Phase 후반부에 공통 모듈 통합이 자꾸 깨짐. 14건 결함 중 일부는 mockup 패턴과 horse-race 패턴 충돌에서 기인.

**해결/예방:**
- 새 게임 base는 **반드시 `horse-race-multiplayer.html` 통째 복사**부터 시작 (mockup이나 prototype을 base로 쓰면 안 됨)
- mockup에서는 **캔버스 게임 코드 외에는 일체 참고 금지**
- 시작 시 `cp horse-race-multiplayer.html [game]-multiplayer.html` + `cp js/horse-race.js js/[game].js` 후 게임 마크업만 교체

**관련:**
- v1 보존: branch `feat/bridge-cross-integration` commit `03d3fcd`
- v2 핸드오프: `docs/etc/2026-04-27-bridge-cross-v2-handoff.md`
- v2 머지: main commit `36d9d4c`
- 이 lesson에서 도출된 절차: [`.claude/rules/new-game.md`](../../../.claude/rules/new-game.md) §0 ("권장 시작점 — horse-race 단순 복사")

---

## 추가 형식

```markdown
## YYYY-MM-DD — 한 줄 제목

**상황:** 작업 컨텍스트
**함정/실수:** 무엇이 잘못되었나
**증상:** 어떻게 발견했나
**해결/예방:** 다음에는 어떻게
**관련:** 파일/커밋/PR
```
