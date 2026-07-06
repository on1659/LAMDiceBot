# 신규 게임모드: 사다리타기 (ladder 🪜) — 구현 명세

> Source of truth. 구현 세션은 이 문서만 읽는다.

## 1. 컨셉 선정

LAMDiceBot은 "여럿이 모여 벌칙/순위를 정하는" 짧은 멀티플레이 게임 모음(주사위/룰렛/경마/다리건너기)이다.
후보 비교:

| 후보 | 운 | 선택 | 짧음 | 즉시이해 | 기존 중복 | 판정 |
|------|----|----|------|----------|-----------|------|
| 사다리타기 | ✅ 숨은 가로줄 | ✅ 레인 선택 | ✅ 1회 추적 | ✅ 꽝 도달자 | 없음 | **채택** |
| 폭탄돌리기 | ✅ | ❌ 약함 | ✅ | ✅ | bridge와 유사 | 탈락 |
| 상자열기 | ✅ | ✅ | ✅ | ✅ | bridge 패널선택과 중복 | 탈락 |
| 가위바위보 | ❌ 약함 | ✅ | ✅ | ✅ | - | 탈락 |

사다리타기 채택: 한국에서 가장 보편적인 "정하기" 게임이며 기존 4종과 메커니즘이 겹치지 않는다.

## 2. 룰 요약

- 호스트가 시작 → 준비한 인원(N) 수만큼 레인 생성. 바닥에 꽝 1칸(위치 공개), 가로줄(rungs)은 **숨김**.
- 각 플레이어는 상단 레인 1개를 **선택**(중복 불가). → 선택 요소.
- 전원 선택 시(또는 호스트가 "결과 공개") 사다리 가로줄이 공개되고 토큰이 내려간다. → 운 요소(숨은 줄).
- 꽝 바닥칸에 도착한 1명이 패자(벌칙). 즉시 결과 표시 → 히스토리 누적 → 다음 판.

게임성: 꽝 위치는 보이지만 가로줄이 숨겨져 "안전해 보이는 레인"을 고르는 심리전 + 추적 애니메이션 긴장 + 매판 새 사다리로 반복 플레이.

## 3. 공정성

- 사다리 구조(rungs, 꽝 위치, laneToBottom)는 **서버에서만 `Math.random`으로 생성**. reveal 전까지 클라에 전송 안 함.
- 재진입 응답에서 `ladder` 마스킹(rooms.js).
- 클라 `Math.random`은 deviceId/tabId 생성에만.

## 4. 신규 파일 (4)

- `ladder-multiplayer.html` — bridge HTML base, 토큰 치환 + 게임 마크업 교체
- `js/ladder.js` — 부트스트랩(bridge 패턴) + 사다리 로직(선택 UI + canvas 추적 + ladder:* 핸들러)
- `css/ladder.css` — `--ladder-*` 토큰 + `--horse-*` alias + `.container 800px` + `.game-section block` + 게임 스타일
- `socket/ladder.js` — 핸들러(start/pick/reveal/disconnect) + DB 기록

## 5. 등록 (편집)

| 파일 | 변경 |
|------|------|
| `socket/index.js` | require + register |
| `socket/rooms.js` | allowlist `'ladder'`, leaveRoom cleanup(userLanes), 재진입 마스킹 `ladder: undefined` |
| `utils/room-helpers.js` | `ladder` gameState 초기화 |
| `routes/api.js` | `/ladder` 라우트 + 301 + FREE_GAME_SLUGS + SERVER_ROOM_DIRECT_PATHS + isGameActive |
| `dice-game-multiplayer.html` | 5 hunk (CSS / 라디오 / colorMap / 방카드 / redirect 3곳, horse-race 패턴=gating 없음) |
| `css/theme.css` | `--ladder-*` light + game-type + dark |
| `js/shared/tutorial-shared.js` | `ladder: 64` |
| `js/shared/server-select-shared.js` | `ladderUserName` 동기화 |

## 6. 색상

amber/gold (기존 게임과 비충돌). light: 500 `#f59e0b` / 600 `#d97706` / accent `#b45309` / rgb `245,158,11`. dark: 500 `#fbbf24` / 600 `#f59e0b` / accent `#fcd34d`.

## 7. 사운드 (신규 0)

`common_button`(선택), `common_countdown`(추적 긴장), `common_notification`(결과) 재사용. 신규 mp3 없음.

## 8. 소켓 이벤트 계약

서버 수신: `ladder:start`(host), `ladder:pick`{lane}, `ladder:reveal`(host force)
서버 송신: `ladder:selectStart`{numLanes,kkwangBottom,participants}, `ladder:picksUpdated`{picks}, `ladder:reveal`{rungs,rows,numLanes,kkwangBottom,userLanes,laneToBottom,loser}, `ladder:gameEnd`{loser,rankings,round}, `ladder:error`, `ladder:gameAborted`{reason}

## 9. 테스트

`tests/test-ladder.js` — Playwright. 2탭: 로비 라디오 선택 → 방 생성/입장 → 시작 → 레인 선택 → 추적 → 결과 도달 + 콘솔 에러 0. 기존 대표(horse-race) 선택/시작 가능 확인.

## 10. update-log.md

`## 🎮 최신 업데이트 (2026-06-02)` 블록에 `**🪜 사다리타기 게임 추가**` 항목.
