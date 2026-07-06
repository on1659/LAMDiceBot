# 사다리타기 유저 빌드 맵 — 구현 명세

> Source of truth. feature/goal-game-mode 브랜치.

## 1. 변경 개요

기존: 호스트 시작 → 서버가 막대기 전부 난수 생성 → 레인 선택(꽝 보임) → 공개.
신규: **로비에서 준비한 참가자가 막대기를 1개씩 직접 배치**(가시) + 서버 숨은 기본 막대기 → 호스트 시작 → 레인 선택(꽝 숨김) → 공개(전체 사다리 추적).

## 2. 핵심 규칙 / 결정 (막힘 기준 위임분 포함)

- **빌드 단계 = 로비(phase 'idle')**. 준비(ready)한 사용자만 막대기 배치 가능. 1인 1개.
- **컬럼 수 N = readyUsers.length** (동적). **행 수 ROWS = 12 고정**(컬럼 변동에도 막대기 행 위치 유지).
- 막대기 위치: 유저가 `(r, c)` 선택 — 행 r(0..ROWS-1), 인접 두 열 사이 c(0..N-2). **같은 행 인접 막대기 금지** 서버 검증.
- 저장: `gameState.ladder.userRungs = { [userName]: { r, c } }`. 모두에게 표시(`ladder:rungsUpdated`).
- **준비 취소/퇴장/연결해제 → 본인 막대기 삭제**. 또한 N 축소 시 범위 초과(c > N-2) 막대기 트림.
- **꽝 + 서버 숨은 막대기**: reveal 전까지 클라 전송 금지. selectStart는 numLanes/userRungs만. 재진입 마스킹(`ladder: undefined`) 유지.
- 호스트 시작(ladder:start): N=준비자 수 잠금 → 숨은 기본 막대기 생성(유저 막대기와 인접/중복 회피, 목표 개수 ≈ N) → 꽝 바닥칸 random 선정(숨김) → 최종 매핑/패배레인 계산 → phase 'selecting'.
- 레인 선택(ladder:pick): 기존과 동일하되 **꽝 미표시**. 전원 선택 → 자동 공개(또는 호스트 강제).
- 공개(ladder:reveal emit): 전체 막대기(유저+기본) + 꽝 + 매핑 + 패자 전송 → 클라 추적 애니. 결과는 서버 결정.
- 컬럼=참가자 수 → 바닥 bijection → 꽝에 도달하는 레인 정확히 1개 → 패자 1명 보장.

## 3. 소켓 계약 (신규/변경)

서버 수신:
- `ladder:addRung { r, c }` — 준비자만, phase 'idle', 1인1개(재배치=이동), 범위/인접/중복 검증.
- `ladder:removeRung` — 본인 막대기 제거.
- (기존) `ladder:start`(host), `ladder:pick`{lane}, `ladder:reveal`(host)

서버 송신:
- `ladder:rungsUpdated { userRungs, numLanes, rows }` — 배치/제거/준비변동 시.
- `ladder:selectStart { numLanes, participants }` — **kkwangBottom 제거**.
- (기존) `ladder:reveal`(전체 rungs+kkwang+매핑+loser), `ladder:gameEnd`, `ladder:roundReset`, `ladder:gameAborted`, `ladder:error`

## 4. 파일 변경

| 파일 | 변경 |
|------|------|
| `utils/room-helpers.js` | ladder gameState에 `userRungs:{}`, `rows: 12`, `baseRungs:[]` 추가 |
| `socket/ladder.js` | buildLadder→유저막대기+기본막대기 결합 빌드, addRung/removeRung 핸들러, selectStart kkwang 제거, reveal는 전체 전송, 트림 헬퍼 export 불필요(인라인) |
| `socket/shared.js` | toggleReady/setUserReady 준비취소 ladder 분기: userRungs 정리+트림+rungsUpdated emit |
| `socket/rooms.js` | leaveRoom cleanup에 userRungs 삭제+트림 추가 (이미 userLanes 삭제 있음) |
| `js/ladder.js` | 빌드 캔버스(인터랙티브 막대기 클릭), rungsUpdated 핸들러, selectStart 꽝 미표시, reveal 전체 추적 |
| `css/ladder.css` | 빌드 캔버스/막대기 슬롯 스타일 |
| `ladder-multiplayer.html` | 빌드 영역 마크업, 튜토리얼 "막대기 놓기" 단계 추가 |
| `tests/test-ladder.js` | 빌드 배치/동기화/준비취소 제거/레인선택/공개 흐름으로 갱신 |
| `update-log.md` | 항목 추가 |

## 5. 공정성

- 유저 막대기만 가시. 기본 막대기/꽝/매핑은 reveal에서만. 재진입 마스킹 유지.
- 결과는 서버 RNG(기본 막대기·꽝)로만. 클라 Math.random = deviceId/tabId만.
- 클라 추적(buildPath)과 서버 매핑 동일 알고리즘.

## 6. 상수

`LADDER_ROWS = 12`, `LADDER_BASE_RUNG_TARGET(N) ≈ N`, 기존 MIN_PLAYERS=2/MAX=8 유지.
