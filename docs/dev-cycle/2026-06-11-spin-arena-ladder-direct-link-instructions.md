# spin-arena + ladder 다이렉트 링크 배선 — 이더 지시서

- 요청: "spin-arena 다이렉트 링크 빠짐" — 방 초대 shortcode URL(`/{game}/CODE`) 기능이 spin-arena에 없음
- 정찰 결론: 서버(routes/api.js, socket/rooms.js, socket/server.js, utils/shortcode.js)는 **수정 0건** — 전부 게임 무관으로 이미 동작. 빠진 것은 클라이언트 4계층.
- **ladder도 동일 결함** (출시 시점부터 다이렉트 링크 사망 — git log 근거: f27adc6이 api.js만 등록). 같은 수정으로 함께 배선한다.
- 범위 제외 (보고에 언급만): bridge 절반 구멍(맵은 있고 페이지 로드/init만 없음), socket/free.js GAME_TYPE_BY_SLUG(/free 즉석 생성 — 카드 메인 폐기됨), 비공개 방 링크 미지원·게임 중 난입 UX·중복 닉네임 리네임(전 게임 공통 기존 한계).

## 수정 파일 (6개)

### 1. `D:\Work\LAMDiceBot\js\free.js` — 맵 8종에 ladder/spin-arena 추가 (키 추가만, 기존 키 변경 금지)

| 맵 (정찰 시점 줄) | 추가 값 |
|---|---|
| `GAME_LABELS` (L32) | `ladder: '사다리타기'`, `'spin-arena': '회전 칼날'` |
| `GAME_EMOJI` (L39) | `ladder: '🪜'`, `'spin-arena': '⚔️'` |
| `GAME_GRADIENT` (L47) | 기존 항목 형식 그대로 — ladder는 css/theme.css `--ladder-*`, spin-arena는 `--spin-arena-*`/css/spin-arena.css 그라데이션 색을 hex로 |
| `GAME_PATH_BY_TYPE` (L55) | `'ladder': '/ladder'`, `'spin-arena': '/spin-arena'` |
| `PENDING_KEY_BY_TYPE` (L61) | `'ladder': 'pendingLadderJoin'`, `'spin-arena': 'pendingSpinArenaJoin'` (게임 IIFE·dice 로비가 이미 쓰는 키 — 정확히 이 문자열) |
| `USERNAME_KEY_BY_TYPE` (L67) | `'ladder': 'ladderUserName'`, `'spin-arena': 'spinArenaUserName'` |
| `SESSION_KEY_BY_TYPE` (L75) | `'ladder': 'ladderActiveRoom'`, `'spin-arena': 'spinArenaActiveRoom'` (없으면 새로고침/뒤로가기 fast-path rejoin이 /free dead-end) |
| `GAME_PATH_TO_SLUG` (L145) | `'ladder': 'ladder'`, `'spin-arena': 'spin-arena'` |

- ladder/spin-arena는 슬러그 == gameType — horse(`horse`↔`horse-race`) 같은 이중 표기 없음.

### 2. `D:\Work\LAMDiceBot\js\shared\free-invite.js` — 맵 2종 추가

- `PATH_TO_SLUG` (L18~25): `'/ladder': 'ladder'`, `'/spin-arena': 'spin-arena'`
- `SLUG_TO_GAME_PATH` (L28~33): `'ladder': '/ladder'`, `'spin-arena': '/spin-arena'`
- 공유 모듈 — 키 추가 외 일절 변경 금지 (dice/roulette/horse가 로드 중).

### 3. `D:\Work\LAMDiceBot\spin-arena-multiplayer.html` — `<script src="/js/shared/free-invite.js"></script>` 추가

- 위치는 horse-race-multiplayer.html L395 패턴과 동일 (page-history-shared.js 부근, 게임 JS보다 앞).
- `js/spin-arena.js` 로드 쿼리 `?v=3` → `?v=4` 상향 (이번에 파일 변경되므로).
- free-invite.js 로드에 기존 페이지들이 버전 쿼리를 쓰면 동일하게 맞춘다 (dice/horse/roulette HTML의 태그 형식 확인 후 동일 형식).

### 4. `D:\Work\LAMDiceBot\ladder-multiplayer.html` — 동일 (free-invite.js 로드 + js/ladder.js 쿼리 상향)

### 5. `D:\Work\LAMDiceBot\js\spin-arena.js` — roomCreated/roomJoined 핸들러 끝에:

```javascript
if (window.FreeInvite && data.shortcode) {
    window.FreeInvite.init({ shortcode: data.shortcode, serverId: data.serverId });
}
```

- **opts 방식 필수** (js/horse-race.js L5023~5025 패턴 그대로). URL 쿼리 자동 추출 모드는 불가 — spin-arena IIFE가 DOMContentLoaded 직후 history.replaceState로 쿼리를 스트립한다(L212/L240).
- `#roomTitle` 존재 확인됨(HTML L368) — mountInviteBar 정상 동작.

### 6. `D:\Work\LAMDiceBot\js\ladder.js` — roomCreated(L1227~)/roomJoined(L1259~) 끝에 동일 호출

## 불변조건

1. 맵은 **키 추가만** — 기존 게임(dice/roulette/horse/bridge) 키·로직·형식 변경 금지.
2. shortcode 형식 `/^[A-Z0-9]{4,6}$/` 4곳(api.js×2, free-invite.js L55, free.js L163) 일치 유지 — 건드리지 않는다.
3. free.js의 보안 불변조건: `setServerId` 직접 emit 금지(L472 주석), resolve 응답 마스킹·rate limiter·만료 모달 흐름 유지.
4. roomCreated/roomJoined 페이로드 필드명(`shortcode`, `serverId`) 그대로 읽기만 — 서버 수정 0건.
5. 진입 IIFE 로직 변경 금지 — free.js가 `?joinRoom=true&from=free&shortcode=X`로 보내므로 기존 분기가 그대로 통과한다(정찰 확인).
6. spin-arena 직전 작업 불변조건 유지: 클라 Math.random 실호출 2회, 시뮬/페이로드 무변경.

## 테스트

1. `node --check` : js/free.js, js/shared/free-invite.js, js/spin-arena.js, js/ladder.js
2. dev 서버 재시작 불필요(서버 코드 무변경)이나, 켜져 있는 서버(5173)가 구버전이면 그대로 사용 가능. 정적 파일은 즉시 반영.
3. **다이렉트 링크 E2E** (Playwright — `AutoTest/free-multitab-test.js` 패턴 복제, GAME/PATH 상수 교체):
   - spin-arena: 호스트 dice 로비 → 회전 칼날 방 생성 → 호스트 화면에 초대 바(#freeInviteBar) 표시 + URL이 `/spin-arena/CODE`로 교체 → 게스트 탭이 그 URL 직접 진입 → 같은 방 합류 (양쪽 usersCount 2)
   - ladder: 동일 시나리오
   - 회귀: horse-race 기존 시나리오(원본 free-multitab-test.js) 깨지지 않는지 — 단 이 테스트가 `#freeInviteFab`을 찾는 구식 셀렉터일 가능성 있음(정찰 경고). 실행해 보고 테스트 자체가 현행 UI와 어긋나 있으면 **테스트를 고치지 말고 보고만** (기존 테스트 파일 수정은 범위 밖).
4. 만료 shortcode: 존재하지 않는 코드 `/spin-arena/ZZZZ` 진입 시 만료 모달 → /free 안내 (기존 흐름).
5. 수동 QA 체크리스트 제시 (모바일 포함).

## 보고 형식

변경 요약 / 파일 목록 / 테스트 결과(E2E 포함) / ladder 동시 수리 사실 명시 / 범위 제외 항목(bridge 절반 구멍 등) / 💡 lesson 후보 (ScoutCodex가 이미 제안: "다이렉트 링크 4계층 배선" — new-game.md 등록 절차에 추가할 가치).
