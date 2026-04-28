# Bridge-Cross 재작성 작업 핸드오프 (2026-04-27)

다음 세션에서 바로 이어 진행하기 위한 정리. PR #12는 이미 1차 통합이 머지 대기 중이고, 사용자가 "기본 레이아웃은 다른 게임과 동일해야 한다"고 지적해서 horse-race base 통째 재작성으로 방향 전환한 시점에서 새 세션으로 넘김.

## 1. 현재 상태

### 완료
- PR #12 https://github.com/on1659/LAMDiceBot/pull/12 — 브랜치 `feat/bridge-cross-integration`
- 1차 통합 commit `fb10f2a` (61파일 +4228/-14): bridge-cross-multiplayer.html, socket/bridge-cross.js, socket/index.js, socket/rooms.js, utils/room-helpers.js, routes/api.js, index.html, sound-config.json, impl 문서, assets/bridge-cross/ 52개 에셋
- 라운드 1~3 (Reviewer + ReviewerCodex APPROVE): 표준 수직 스택 변환 + showCustomAlert 모달 이식 + .game-status phase 토글 + @keyframes 추가

### 사용자 지적 (재작성 트리거)
1. "방생성 어디감?" — `/game(dice-game-multiplayer.html)` createRoomSection 라디오에서 게임 종류 선택 흐름인데 bridge-cross 미등록
2. "신규게임추가하는 가이드 안봄?" — `.claude/rules/new-game.md` 가이드는 봤지만 가이드 자체가 핵심 시스템(자동준비/메뉴/방폭파/컨트롤바/비밀번호/AdSense/결과오버레이/historySection/tutorial/DB기록/통계/랭킹/CSS변수) 누락
3. "자동준비나 메뉴고르기등 왜없음? ux ui도 다른디" — bridge-cross가 mockup base라 공통 UX 시스템과 단절
4. "목업은 메인게임만이고 나머지는 똑같아야지" — **horse-race-multiplayer.html base로 통째 재작성, 게임 영역(canvas + 베팅 UI)만 mockup에서 이식**

### 사용자 결정 사항
- ✅ **이름 규칙**: 짧은 이름 `'bridge'` 사용 (gameKey, FLAG_BITS, recordGamePlay, ControlBar 등)
- ❓ **방 만들기**: 사용자가 "방만들기는없어"라고 했는데 의미 불명확 — 다음 세션에서 확인 필요. dice-game-multiplayer.html line 1533, 2003 코드 확인 결과 createRoomSection + ServerSelectModule.init + showCreateRoomPage() 흐름은 실존하고 동작 중. 사용자 의도가 (a) 등록 작업 자체 불필요인지, (b) 다른 진입 흐름인지 확인 필요.

## 2. 정찰 결과 요약 (Scout + ScoutCodex)

### 빠뜨리면 안 되는 의존성 (현재 invisible 상태)

| 영역 | 파일 | 작업 |
|------|------|------|
| **DB 기록 (가장 결정적)** | `socket/bridge-cross.js` | `recordGamePlay('bridge', n, serverId)` 호출 추가. 현재 0건 → 통계/랭킹 invisible |
| DB 기본값 | `db/stats.js:43` | `DEFAULT_GAME_STATS`에 `'bridge'` 추가 (crane도 누락된 채) |
| 통계 API | `routes/api.js:176` | `defaultGameStats`에 `'bridge'` 추가 |
| 랭킹 매핑 | `db/ranking.js` | bridge 매핑 추가 (line 95, 285, 333 패턴) — 노출 여부 정책 결정 필요 |
| **dice-game 진입점 (7곳)** | `dice-game-multiplayer.html` | 라디오 / colorMap / room-item border CSS / 방카드 매핑 / joinRoomDirectly / finalizeRoomCreation / joinSelectedRoom / localStorage `bridgeCrossUserName` |
| **CSS 변수** | `css/theme.css` | `--bridge-500`, `--game-type-bridge`, `--bridge-accent`, RGB 변수, light/dark 양쪽 |
| **Tutorial flag** | `js/shared/tutorial-shared.js:10-16` | `FLAG_BITS.bridge = 32` 추가 |
| **localStorage 동기화** | `js/shared/server-select-shared.js:822-825` | `bridgeCrossUserName` (또는 정책 결정: 동기화 제외) |

### horse-race-multiplayer.html 복제 가이드 (line 단위)

**그대로 복사**:
- 1-253 (head + 로딩 + controlBar + roomExpiry + users + ready + AdSense ad-lobby)
- 186-252 (orders 자주쓰는메뉴 포함 + gameStatus)
- 298-349 (chat + AdSense ad-game + history + result + password)
- 365-697 (showCustomAlert + showCustomConfirm + 호스트 위임 + leaveRoom 함수들)
- 710-745 (SEO + footer)

**삭제할 horse-race 고유**:
- 155-169 (horseSelectionSection 탈것 선택 — bridge-cross는 베팅)
- 254-296 (raceTrackWrapper 트랙 + 미니맵 + replay)
- 360-363 (horse-race-* 스크립트 4개)
- 565, 685 (horse-race.js 참조 주석)
- 749-933 (HORSE_RACE_TUTORIAL_STEPS — 튜토리얼 정책에 따라)

**bridge-cross에서 이식**:
- (현재) 30-322 (CSS — `css/bridge-cross.css`로 분리 권장)
- (현재) 649-663 (bettingSection 마크업)
- (현재) 693-776 (canvas + zoom-ui + debug-panel + ticker + ranking)
- (현재) 794-871 + 1024-1102 (베팅 함수 + Socket 핸들러 + joinRoomOnLoad)
- (현재) 1104-2581 (캔버스 게임 루프 — `js/bridge-cross.js`로 분리 권장)

### dice-game-multiplayer.html 등록 7곳 (정확 line)

| # | line | 작업 |
|---|------|------|
| 1 | 143-144 | `.room-item.game-bridge { border-left-color: var(--bridge-500); }` 추가 |
| 2 | 1638-1646 | bridge 라디오 label 추가 (🌉 다리 건너기, value="bridge") |
| 3 | 1659 | colorMap에 `'bridge': 'var(--game-type-bridge)'` 추가 |
| 4 | 2786-2790 | 방 카드 분기에 `else if (room.gameType === 'bridge') { gameTypeIcon='🌉'; gameTypeLabel='다리건너기'; gameTypeColor='var(--bridge-500)'; }` |
| 5 | 2910-2933 | joinRoomDirectly redirect 분기 (horse-race 패턴 따라) |
| 6 | 3806-3821 | finalizeRoomCreation redirect 분기 |
| 7 | 3886-3897 | joinSelectedRoom redirect 분기 |
| + | 2897, 3774, 3859 | localStorage `bridgeUserName` 저장 |

⚠️ **주의**: socket/rooms.js gameType allowlist는 이미 `'bridge-cross'`(긴 이름)로 commit 완료. 짧은 이름 `'bridge'`로 가려면 socket/rooms.js, socket/bridge-cross.js, socket/index.js 다 변경 필요. 또는 라우트(`/bridge-cross`)/긴 이름은 그대로 두고 gameType 식별자만 `'bridge'`로 분리하는 방안 — 결정 필요.

### Socket 이벤트 (불변)
- `bridge-cross:bettingOpen`, `:select`, `:selectionConfirm`, `:selectionCount`, `:gameStart`, `:gameEnd`, `:gameAborted`, `:error`
- 서버 emit 형태: 단순 문자열 (객체 X)

### 가이드(.claude/rules/new-game.md) 갱신 필수 항목

1. db/stats.js DEFAULT_GAME_STATS 갱신
2. routes/api.js defaultGameStats 갱신
3. db/ranking.js 게임타입 매핑 (정책 결정 항목)
4. socket/[game].js 안에서 recordGamePlay() 호출 의무
5. dice-game-multiplayer.html 진입점 7곳
6. css/theme.css 색상 변수
7. tutorial-shared.js FLAG_BITS 비트 할당
8. server-select-shared.js localStorage 키 동기화
9. 짧은 이름 vs 긴 이름 명명 규칙 일관성
10. game_type VARCHAR(20) 컬럼 길이 제약

가장 깔끔한 가이드 갱신 방향: **"horse-race-multiplayer.html을 base로 복제 후 게임 영역만 교체"** 패턴을 §3에 명시.

## 3. 미결정 사항 (다음 세션에서 사용자에게 확인)

| # | 항목 | 옵션 | 비고 |
|---|------|------|------|
| 1 | "방만들기는없어" 의미 | (a) dice-game 7곳 등록 안 함 + 다른 진입 흐름 / (b) 등록 작업 불필요 알려준 것 | dice-game line 1533/2003 코드 보여주고 명확히 확인 |
| 2 | 입장 패턴 | A: localStorage + `?createRoom/joinRoom=true` (다른 게임 통일) / B: `?room=` 직접 (현재) | #1과 연동 |
| 3 | 랭킹 노출 | A: 노출 (db/ranking.js 추가) / B: 미노출 (crane 패턴) | |
| 4 | 게임 로직 분리 | A: 별도 `js/bridge-cross.js` (horse-race 패턴) / B: inline | |
| 5 | 튜토리얼 | A: 함께 (FLAG_BITS=32, TUTORIAL_STEPS) / B: 보류 | |
| 6 | 사운드 mp3 | A: 함께 / B: 보류 (placeholder 키만) | |
| 7 | PR | A: PR #12에 누적 commit / B: 새 PR | 추천 A |

## 4. 다음 세션 진행 절차

1. **이 문서 읽기** + PR #12 상태 확인 (`git checkout feat/bridge-cross-integration`)
2. 미결정 #1 (방만들기 의미) 사용자에게 짧게 확인
3. 결정 #2~#6 일괄 받기
4. SPEC 작성 (horse-race line 범위 + bridge-cross 이식 line 범위 + dice-game 7곳 + DB 4파일 + CSS + tutorial-shared + server-select-shared + 가이드)
5. Coder 호출 (Sonnet 추천 — line 단위 매핑 명확)
6. Reviewer + ReviewerCodex 병렬 검증
7. QA → commit → push (PR #12에 누적)

## 5. 참조 파일

- 핵심 base: `horse-race-multiplayer.html`
- 게임 영역 source: `bridge-cross-multiplayer.html` (현재 — mockup 기반)
- 진입점: `dice-game-multiplayer.html`
- 가이드 (갱신 대상): `.claude/rules/new-game.md`
- 서버 핸들러 (이미 작동): `socket/bridge-cross.js`
- 정찰 보고: 이전 대화의 Scout + ScoutCodex 결과 (이 문서 §2에 요약)
- impl 문서 (이미 commit): `docs/meeting/impl/2026-04-27-bridge-cross-integration-impl.md`
- 1차 PR: https://github.com/on1659/LAMDiceBot/pull/12

## 6. 트리아지

- **COMPLEX** (파일 4+ — bridge-cross HTML 통째 재작성 + dice-game 7곳 + DB 4파일 + theme.css + tutorial-shared + server-select-shared + 가이드)
- 공정성 영향 X (서버는 그대로)
- main = 실서버 — PR로 안전하게 진행
