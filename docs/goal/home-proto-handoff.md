# 홈 프로토타입(/home) 인계서 — Claude → GPT

> 작성 2026-10-07. 이 문서 하나만 읽고 이어서 작업할 수 있게 썼다.
> 더 자세한 근거: 원 명세 `docs/goal/applied/home-proto.prompt.md`, 결과 보고서 `docs/goal/home-proto-report.md`.

---

## 1. 한 줄 요약

새 홈 화면 `/home`(목업 10번 "그림 네 개")을 **실제로 돌아가게** 만들었고, 테스트 서버에 올렸다.
폰에서 그림을 한 번 누르면 진짜 방이 생기고, 링크로 들어온 친구와 한 판을 끝까지 돌릴 수 있다. 남은 일은 주사위 1탭화와 잔손질이다.

## 2. 지금 상태

| 항목 | 값 |
|---|---|
| 테스트 서버 | https://lamtest.up.railway.app/home (열림, 콘솔 오류 없음) |
| 실서버(`main`) | **안 올라감.** `/`는 예전 그대로 |
| 작업 브랜치 | `feature/home-proto` — 커밋 `e6bb67f0` (origin 에 푸시됨) |
| 테스트 서버 브랜치 | `feature/marble-run` — 머지 커밋 `04da5459` 로 홈이 합쳐짐 (`e6bb67f0` 포함) |
| 작업 폴더 | `/Users/radar/Work/LAMDiceBot-home` (git worktree, 깨끗함) |
| 본 폴더 | `/Users/radar/Work/LAMDiceBot` — **다른 세션의 미커밋 파일이 많다. 여기서 작업·커밋하지 말 것.** 본 폴더의 로컬 `feature/marble-run` 은 origin 보다 1커밋 뒤(머지 커밋) |

첫 화면 수치(폰 375×812): 처음 **35자/조작 6개**, 단골 **34자/6개**, 로그인 **41자/7개**(서버 칩 포함, 7개까지 허용). 기준은 60자·6개.

## 3. 만든 파일 (전부 새 파일 + 라우트 한 블록)

| 파일 | 역할 |
|---|---|
| `home.html` | 홈·열린 방 목록 두 화면 + 시트 3개(이름 `#nameSheet`, 계정 `#acctSheet`, 서버 `#srvSheet`). 화면 전환은 이 파일 안에서만 |
| `js/home.js` (408줄) | 소켓·API 연결, 세 상태, 방 만들기·합류 인계. IIFE 하나, 맨 위 `GAMES` 표가 게임별 인계 정보 |
| `css/home.css` | 종이·잉크 토큰(`:root`)과 스타일. `mockups/10.html` CSS 에서 시작. 라이트만 |
| `routes/api.js` | `app.get('/home', …)` 한 블록(+8줄). `/`는 그대로. **CRLF 파일** |
| `mockups/measure.js` | `--url`·`--ls` 옵션 추가(떠 있는 서버를 상태별로 측정) |
| `AutoTest/qa-home-proto-e2e.js` | 두 브라우저 E2E: 게임별 방 만들기 → 링크 합류 → 한 판 완주. `--regular`, `--via list` |
| `AutoTest/qa-home-proto-dice-e2e.js` | 주사위 1차 방식 + 열린 방 합류 |
| `AutoTest/qa-home-proto-server-e2e.js` | 로그인 → 새 서버 → 가입 신청·승인 → 서버 방 → 링크 복귀 (로컬 DB 에 계정·서버를 만든다) |

**건드리지 않은 것:** `socket/*`, `db/*`, `js/shared/*`, `css/theme.css`, `js/free.js`, 게임 페이지 전부. 서버 이벤트는 하나도 새로 만들지 않았다.

## 4. 어떻게 돌아가나 (핵심 계약)

### 세 상태
| 상태 | 판정 | 화면 |
|---|---|---|
| 처음 | `localStorage.freeUserName` 없음 + 로그인 아님 | 계정 버튼 "로그인" |
| 단골 | `freeUserName` 있음 + 로그인 아님 | 계정 버튼에 이름 |
| 로그인 | `localStorage.userAuth.token` 있고 서버 인증 OK | 제목 위 서버 칩. 지난 서버(`lamdice_lastServer`) 자동 선택 |

### 그림 = 방 만들기 (홈은 "할 일"만 적고 이동, 방은 게임 페이지가 만든다)
| 게임 | 만들기 | 합류 |
|---|---|---|
| 경마 | `pendingHorseRaceRoom` → `/horse-race?createRoom=true` | `pendingHorseRaceJoin` → `/horse-race?joinRoom=true` |
| 룰렛 | `pendingRouletteRoom` → `/roulette-game-multiplayer.html?createRoom=true` | `pendingRouletteJoin` → `…?joinRoom=true` |
| 데구리 | `pendingDeguriRoom` → `/deguri?createRoom=true` | `pendingDeguriJoin` → `/deguri?joinRoom=true` |
| 주사위 | **1차 방식:** `diceSession` 맞추고 `/free`(자유) 또는 `/game`(서버) 기존 로비로 보냄 → 로비에서 한 번 더 눌러야 함 | `diceSession` + `sessionStorage.diceActiveRoom` → `/game` 에서 바로 앉음 |

- 만들기 값: `{ userName, roomName: "{이름}님의 {게임}", isPrivate: false, password: '', expiryHours: 3, blockIPPerUser: false, serverId, serverName }` (자유 방이면 serverId/serverName = null)
- 이름이 없으면 이름 시트를 한 번 띄운다. 시트는 **누른 게임과 목적지(새 방/어느 열린 방)를 기억**했다가 그대로 이어간다(`pending` 변수).
- 링크 복사 UI는 홈에 없다. 게임 페이지의 기존 초대 바(`js/shared/free-invite.js`)가 한다.

### 이름 규칙 (섞으면 사고 난다)
- 자유 방 = `localStorage.freeUserName`, 서버 방 = `userAuth.name`. 서로 덮어쓰지 않는다.

### 로그인·서버
- `POST /api/auth/login` / `POST /api/auth/register`, 본문 `{ name, pin }` → 성공 시 `localStorage.userAuth` 저장 → `socket.emit('socket:authenticate', { token })`.
- 로그아웃 = `localStorage.removeItem('userAuth')` 만(이름 키는 지우지 않는다). 지금은 확인 없이 바로 로그아웃.
- 서버 목록 `getServers` → `serversList`. 가입 `joinServer` → `serverJoined`/`serverJoinRequested`/`serverError`. 생성 `createServer` → `serverCreated`. 갱신 알림 `serversUpdated`·`memberUpdated`.
- 서버를 고르면 **두 키를 함께** 쓴다(게임 페이지들이 읽음): `sessionStorage.diceSession`, `localStorage.lamdice_lastServer` = `{ serverId, serverName, hostName }`. 자유 방이면 `diceSession` 값을 전부 null.
- 방 목록: 서버 모드면 `setServerId` 다음 `getRooms`. **`setServerId` 는 비동기라 먼저 온 `roomsList` 가 자유 방 것일 수 있다** → `onRooms` 에서 `room.serverId` 로 다시 거른다. 목록에서 `bridge`·`pirate`·`spin-arena`·`ladder` 는 숨긴다.
- 서버 방 링크로 왔다가 로그인하러 온 경우: `sessionStorage.lamdice_returnAfterLogin` 을 로그인 성공 직후 한 번 읽고 지운 뒤 그 주소로 보낸다(`/`로 시작하고 `//`가 아닌 것만). 빼먹으면 서버 방 초대 링크가 끊긴다.
- 멤버 승인·강퇴 UI는 홈에 없다(명세대로). 기존 `/`의 내 서버 관리로 한다.

## 5. 남은 일 (추천 순서)

1. **주사위 1탭화(2차 방식).** 홈에서 직접 `socket.emit('createRoom', {…, gameType: 'dice'})` → `roomCreated` 를 받으면 `sessionStorage.diceActiveRoom` 을 dice 로비가 쓰는 모양 그대로 쓰고 `/game` 으로 보낸다 → 로비의 재입장 경로를 타는지 확인. 참고: `dice-game-multiplayer.html` 에서 `diceActiveRoom` 을 쓰는 곳(방 생성 성공 처리)과 읽는 곳(재입장)을 grep 해서 모양을 맞춘다. 안 되면 1차 방식으로 둔다.
2. **경마 말 첫 로드 깜빡임.** `.veh` 가 `base-run-1/2.webp` 두 장을 CSS 애니메이션으로 바꾸는데, 둘째 장을 미리 받지 않아 처음 열 때 잠깐 빈 칸이 된다. 둘째 장을 미리 받게 하면 된다(예: `<link rel="preload" as="image">` 또는 숨긴 이미지).
3. **숫자 서체 의존.** `Galmuri11` 만 `/mockups/assets/galmuri11-sub.woff` 를 쓴다. 실서버는 `/mockups/` 가 404 라서 기본 서체로 떨어진다(테스트 서버는 보임). 실서버에 올리기 전에 정식 에셋 경로로 옮긴다.
4. **로그아웃 확인.** 로그인 상태에서 계정 버튼을 누르면 바로 로그아웃된다. 실수로 눌릴 걱정이 있으면 확인을 한 번 넣는다.
5. **다크 모드 없음.** 토큰이 `css/home.css` `:root` 에 라이트 값만 있다. 리뉴얼을 확정할 때 `css/theme.css` 토큰 그룹으로 옮기고 다크 값을 정한다.
6. **중복 정리(실서버 전환 때).** 인증·로그인·`_takeReturnLink` 는 `js/shared/server-select-shared.js` 와 같은 코드다. 게임별 인계 표는 네 벌(dice 로비, `js/free.js`, `js/shared/free-invite.js`, `js/home.js`)이다.
7. 실서버 `/` 를 홈으로 바꾸는 건 **이 작업 범위 밖이다.** 사용자가 정한다.

## 6. 작업 시작하는 법

```bash
# 1) worktree 를 테스트 서버 브랜치 최신으로 (fast-forward 된다)
git -C /Users/radar/Work/LAMDiceBot-home fetch origin
git -C /Users/radar/Work/LAMDiceBot-home merge --ff-only origin/feature/marble-run

# 2) 로컬 서버 (5173·5174 는 다른 세션이 쓸 수 있다). .env 는 worktree 에 이미 있다
cd /Users/radar/Work/LAMDiceBot-home && PORT=5175 node server.js
# → http://localhost:5175/home   (서버/팀 기능은 로컬 PostgreSQL 필요)

# 3) 첫 화면 수치 (세 상태)
node mockups/measure.js --url http://localhost:5175/home
node mockups/measure.js --url http://localhost:5175/home --ls freeUserName=라온
node mockups/measure.js --url http://localhost:5175/home --ls 'userAuth={"name":"…","token":"…"}'

# 4) 두 브라우저 E2E
node AutoTest/qa-home-proto-e2e.js --game horse-race              # 처음(2탭) + 링크 합류 + 완주
node AutoTest/qa-home-proto-e2e.js --game roulette --regular      # 단골(1탭)
node AutoTest/qa-home-proto-e2e.js --game deguri --regular
node AutoTest/qa-home-proto-e2e.js --game horse-race --regular --via list
node AutoTest/qa-home-proto-dice-e2e.js
node AutoTest/qa-home-proto-server-e2e.js
```

- `socket/*` 를 바꾸면 서버를 재시작해야 한다(자동 리로드 없음). 홈 작업은 보통 해당 없음.
- 데구리 E2E 는 1등 룰 흐름(`c2128806`)이 들어오기 전에 통과했다. 머지 뒤 다시 돌려 볼 것.
- **테스트 서버 배포:** `feature/marble-run` 에 푸시하면 Railway 가 자동 배포한다(이번엔 약 105초). `assets/**`·`docs/**` 만 바뀐 커밋은 배포를 건너뛴다.
- 테스트 서버에 올릴 땐 본 폴더를 쓰지 말고, 임시 worktree 에서 `origin/feature/marble-run` 에 `feature/home-proto` 를 **머지 커밋**으로 합쳐 `git push origin HEAD:feature/marble-run`. 이번에도 그렇게 했다.

## 7. 이 저장소 규칙 (꼭 지킬 것)

- **`main` = 실서버.** 푸시하면 바로 배포된다. **`main` 에 푸시 금지.**
- 커밋 메시지·보고는 **한국어**. 자기 파일만 스테이징한다(`git add -A` 금지).
- `socket/*`·`db/*`·`js/shared/*`·`utils/room-helpers.js` 는 전 게임에 영향을 준다. 홈 작업에서는 고치지 않는다. 꼭 필요하면 멈추고 사용자에게 묻는다.
- **CRLF 파일**(`routes/api.js`, `socket/*`, `db/*`, `js/shared/*`, `css/theme.css` 등): 줄 끝이 LF 로 바뀌면 파일 전체가 diff 로 잡힌다. 편집 뒤 `git diff --stat` 이 바꾼 줄 수만 나오는지 확인.
- 게임 결과·순서는 **서버에서만** 정한다. 클라이언트 `Math.random()` 금지(홈의 이름 제안도 `Date.now() % n`).
- 사용자 입력은 `textContent` 로만 DOM 에 넣는다.
- 미사용 게임(다리건너기·해적룰렛·회전칼날)은 어디에도 보이면 안 된다. 사다리는 준비 중이라 홈에 넣지 않는다. 레퍼런스 게임은 경마.
- 이모지 금지. 그림은 실제 게임 에셋 또는 `css/ui-icons.css` 의 `<i class="ui ui-…">`.
- 유저가 보는 문구는 평이한 한국어(`fallback`·`default`·`legacy` 같은 말 노출 금지). "자산"이 아니라 "에셋".
- UI 기준은 `DESIGN.md` 맨 위 "UX 원칙": 첫 화면 글자 60자 이하 · 조작 6개 이하 · 다시 온 사람은 1탭. 꾸밈이 읽을 글이나 단계를 늘리면 뺀다. 바꾼 뒤 `measure.js` 로 수치를 다시 잰다.
- 광고 코드는 홈에 넣지 않는다(실서버 전환 때 따로).

## 8. 참고 문서

- `CLAUDE.md` — 저장소 전체 규칙
- `DESIGN.md` — 서체·색·간격·UX 원칙
- `docs/goal/applied/home-proto.prompt.md` — 원 명세(화면 명세·연결 계약 전체)
- `docs/goal/home-proto-report.md` — 결과 보고서(베낀 코드 위치 표 포함)
- `mockups/10.html` — 원본 목업(테스트 서버 `/10`)
