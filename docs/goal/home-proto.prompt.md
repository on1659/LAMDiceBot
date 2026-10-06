# 홈 프로토타입 — 목업 10번을 실제로 돌아가게 만들기 (새 세션 실행용)

> **쓰는 법:** 새 세션(별도 worktree)에서 이 파일을 읽고 그대로 실행한다. 이 문서가 goal 명세다(`/autogoal` 따로 돌리지 않는다).
> 끝나면 `.claude/.goal-applied-queue`에 `docs/goal/home-proto.prompt.md` 한 줄을 붙인다.
> 작성: Claude, 2026-10-06. 사용자 결정: "코드 구조는 신경 쓰지 말고 **게임이 실제로 돌아가는 것**만 본다. 새 파일로 만든다."

---

## 0. 세션 준비 (다른 세션과 안 겹치게)

작업 폴더와 브랜치를 분리한다. 본 폴더(`/Users/radar/Work/LAMDiceBot`)에는 다른 세션의 미커밋 파일이 늘 있으니 **거기서 작업하지 않는다.**

```bash
git -C /Users/radar/Work/LAMDiceBot fetch origin
git -C /Users/radar/Work/LAMDiceBot worktree add ../LAMDiceBot-home -b feature/home-proto origin/feature/marble-run
```

- 이후 모든 작업은 `/Users/radar/Work/LAMDiceBot-home`에서. (이 앱에서 세션을 worktree 격리로 열었다면 이미 돼 있다.)
- 로컬 서버: `PORT=5174 node server.js` (`.claude/launch.json`의 `dev-5174`). 5173은 남의 프로세스일 수 있다. DB가 없어도 부팅은 되지만 서버(팀) 기능은 PostgreSQL이 필요하다. `.env`는 본 폴더 것을 복사.
- 소켓 코드를 바꾸지 않으므로 서버 재시작은 라우트 추가 때 한 번만.

## 1. 목표

사용자가 **폰에서 `/home`을 열어 게임 그림을 한 번 누르면 진짜 방이 생기고, 링크로 들어온 친구와 한 판을 끝까지 돌릴 수 있다.** 그게 전부다.

- 우선순위: 돌아간다 > 기준 수치 > 보기 좋다 > 코드 구조. 복붙·중복·전역 변수 전부 허용. 나중에 정리한다.
- 화면 구조는 `mockups/10.html`("그림 네 개")을 그대로 따른다. 테스트 서버 `https://lamtest.up.railway.app/10`에서 눌러 볼 수 있다.
- 기준(저장소 `DESIGN.md` 맨 위 "UX 원칙"): 폰 375×812 첫 화면 **글자 60자 이하 · 조작 요소 6개 이하 · 다시 온 사람은 방까지 1탭, 처음 온 사람은 이름 한 번 포함 2탭.** 꾸밈은 탭과 읽을 글을 늘리지 않는 곳에만.

## 2. 만드는 것 / 건드리지 않는 것

**새 파일만 만든다.**

| 파일 | 역할 |
|---|---|
| `home.html` | 홈 + 열린 방 목록 + 시트(이름·계정·서버). 화면은 전부 이 파일 안에서 전환 |
| `js/home.js` | 소켓·API 연결, 상태, 방 만들기 인계 |
| `css/home.css` | 토큰과 스타일. `mockups/10.html`의 CSS를 가져와서 시작 |
| `routes/api.js` | **한 블록만 추가:** `app.get('/home', …)` → `home.html`. `/`는 바꾸지 않는다 |

**건드리지 않는다:** `js/shared/server-select-shared.js`, `css/theme.css`, `dice-game-multiplayer.html`, `js/free.js`, `socket/*`, `db/*`, 게임 페이지 전부. 필요한 건 **읽고 베낀다.** 서버 쪽 이벤트는 새로 만들지 않는다(있는 걸로 다 된다).

주의: `routes/api.js`는 CRLF 파일이다. 줄 끝이 LF로 바뀌면 유령 diff가 난다. 편집 뒤 `git diff --stat routes/api.js`가 몇 줄 추가로만 나오는지 확인한다.

## 3. 화면 명세 (10번 + 검토에서 받은 수정 4가지)

세 상태를 구분한다.

| 상태 | 판정 | 첫 화면 |
|---|---|---|
| 처음 | `localStorage.freeUserName` 없음, 로그인 아님 | 제목 + 그림 4개 + 열린 방 줄 + 계정 버튼("로그인") |
| 단골 | `freeUserName` 있음, 로그인 아님 | 같음. 계정 버튼에 이름 |
| 로그인 | `localStorage.userAuth`에 token 있고 서버가 인증 OK | 제목 위에 서버 칩 "LAMDice :) ▾". 지난번 서버(`lamdice_lastServer`)가 있으면 자동 선택 |

홈 구성(위에서 아래): 헤더(로고 · 계정 버튼) → [로그인이면 서버 칩] → **"방 만들기"** 머리말(3글자, 검토 지적 반영) → 제목 "뭘로 정할까?" → 그림 버튼 4개(경마·주사위·룰렛·데구리. 사다리는 넣지 않는다) → "열린 방 N ›" 한 줄.

- **그림 = 방 만들기.** 누르면 이름이 있을 때 바로 방 생성 절차(5절). 이름이 없으면 이름 시트(제안 이름이 채워진 입력 한 칸 + 들어가기) 한 번 뒤 같은 절차. 시트는 **누른 게임과 목적지(새 방인지, 어느 열린 방인지)를 기억**했다가 그대로 이어간다(검토에서 잡힌 버그).
- 방 이름은 `"{이름}님의 {게임}"` 자동. 비공개·방 이름 수정은 만들지 않는다(게임 페이지의 기존 기능으로 충분). 걸 것(커피/점심) 기능은 만들지 않는다.
- **열린 방 목록:** 줄 전체가 버튼. 그림 · 방 이름 · `n/최대` · 진행 중 표시. 누르면 합류(5절).
- **계정 버튼:** 처음·단골 → 로그인 시트(이름 + 숫자 암호코드 4~6자리 + 로그인 / "처음이면 회원가입" 토글). 로그인 상태 → 로그아웃.
- **서버 칩 → 서버 시트:** 줄마다 서버 이름 + 상태(지금 · 참여 가능 · 참여코드 · 승인 대기). 참여 가능은 누르면 가입 신청, 참여코드는 코드 입력칸 한 줄이 펼쳐짐, 승인 대기는 눌러도 안내만. 맨 아래 "자유 방(기록 없음)" 과 "새 서버"(이름 한 칸 + 참여코드 선택). **내 서버 관리(멤버 승인·강퇴)는 만들지 않는다** — 기존 `/`의 서버 선택 화면이 아직 살아 있으니 그걸로 한다.
- 그림이 5개 이상이 되면 2열로 줄을 늘린다(폰에서 6개까지 한 화면). 지금은 4개.
- 이모지 금지. 그림은 `mockups/assets/`(아이콘 PNG, 탈것 2프레임 webp, 데구리 4프레임 스트립) 또는 공용 아틀라스 `css/ui-icons.css`의 `<i class="ui ui-dice">`를 쓴다.

## 4. 실제 연결 계약 (전부 지금 코드에 있는 것)

소켓은 `<script src="/socket.io/socket.io.js"></script>` 뒤 `const socket = io();`. 아래 이벤트는 `socket/rooms.js`, `socket/server.js`, `js/shared/server-select-shared.js`에서 확인한 것이다. 모양이 다르면 **코드가 맞다.**

### 로그인·인증
- 로그인 판정과 토큰 갱신은 `js/shared/server-select-shared.js`의 `_authRestore`/`socket:authenticate` 부분(약 370~400행)과 `js/shared/auth-token-shared.js`(AuthToken)를 그대로 베낀다. 저장소는 `localStorage.userAuth` = `{ name, token, … }`.
- 로그인·회원가입 API: `POST /api/auth/login`, `POST /api/auth/register`, 본문 `{ name, pin }` (JSON). 응답 처리는 `server-select-shared.js` `_authModal`(1030~1070행: 성공 시 `localStorage.userAuth`에 응답 저장, 그 다음 `socket.emit('socket:authenticate', { token }, cb)`)을 그대로 베낀다. 서버 쪽 정의 파일: `grep -rn "api/auth" --include=*.js . | grep -v node_modules` 로 찾는다.
- 로그아웃: `localStorage.removeItem('userAuth')` (이름 키는 지우지 않는다). 973행 참고.
- 서버 방 링크로 들어왔다가 로그인이 필요해 되돌아온 경우: `js/free.js`가 `sessionStorage.lamdice_returnAfterLogin`에 경로를 저장한다. 홈은 로그인 성공 직후 이 값을 읽고(한 번 읽으면 지운다, `/`로 시작하고 `//`가 아닌 것만 인정) 그 주소로 보낸다(`_takeReturnLink`, 1113~1122행 그대로). **이걸 빼먹으면 서버 방 초대 링크가 끊긴다.**

### 이름 규칙 (섞으면 사고)
- 자유 방 이름 = `localStorage.freeUserName`. 서버 방 이름 = `userAuth.name`. 서로 되쓰지 않는다. (`js/free.js` 1013~1030행의 주석이 사고 기록이다.)

### 서버(팀) 목록·가입·생성
| 보내기 | 받기 |
|---|---|
| `socket.emit('getServers', { userName })` | `socket.on('serversList', (servers, { freeRoomCount }) => …)` 서버 항목: `id, name, host_name, description, room_count, …`(가입 상태 필드는 `db/servers.js getServers` 확인) |
| `socket.emit('joinServer', { serverId, userName, password })` (코드 없으면 생략) | `serverJoined` `{ id, name, hostName, description, alreadyMember, pendingCount }` / `serverJoinRequested` / `serverError` / 나중에 `serverApproved`·`serverRejected`·`serverKicked` |
| `socket.emit('createServer', { name, description, hostName, password })` | `serverCreated` |
| 목록 갱신 알림 | `serversUpdated`, `memberUpdated` → 다시 `getServers` |

서버를 고르면 **반드시** 둘 다 저장한다(게임 페이지들이 읽는다):
```js
sessionStorage.setItem('diceSession', JSON.stringify({ serverId, serverName, hostName }));
localStorage.setItem('lamdice_lastServer', JSON.stringify({ serverId, serverName, hostName }));
```
자유 방을 고르면 `diceSession = { serverId: null, serverName: null, hostName: null }` (dice 로비 2636~2641행과 동일).

### 방 목록
- 서버 모드면 먼저 `socket.emit('setServerId', { serverId, userName })` 를 보내고 나서 `socket.emit('getRooms')`. 응답 `socket.on('roomsList', rooms)`. `setServerId`는 비동기라 **응답 전에 `getRooms`를 보내면 자유 방 목록이 온다**(메모리에 있는 경쟁 조건). 콜백이 없으니 `roomsList`를 받은 뒤 `room.serverId`로 한 번 더 걸러라.
- 항목 필드: `roomId, roomName, gameType, hostName, isPrivate, serverId, shortcode, createdAt, expiryHours, players/playerCount, maxPlayers, gameStarted`류 — 정확한 이름은 `socket/rooms.js` `sendRoomsList`(약 450~530행)에서 복사.
- `gameType` 값: `'dice' | 'roulette' | 'horse-race' | 'deguri' | 'ladder'`. 나머지(`bridge`·`pirate`·`spin-arena`)는 **목록에서 숨긴다.**

### 링크
- 자유 방: `/free/{slug}/{shortcode}`. slug는 `dice, roulette, horse, deguri, ladder` (**경마는 `horse`**, gameType과 다르다. `js/free.js` 156~165행 표 참고).
- 서버 방: `/{game}/{shortcode}` (`routes/api.js` 165행 근처). `shortcode`는 `roomCreated`/`roomsList`에 들어 있다.
- "링크 복사됨"은 **실제 복사가 성공한 뒤에만** 띄운다. `navigator.clipboard.writeText` 실패하면 링크를 글자로 보여주고 길게 눌러 복사하게 둔다.

## 5. 방 만들기·합류 인계 (게임별, 지금 로비가 하는 그대로)

주사위를 빼면 **방은 게임 페이지가 직접 만든다.** 홈은 `localStorage`에 "할 일"을 적고 주소만 바꾼다.

| 게임 | gameType | 이름 키 | 만들기: 저장할 키 → 이동 | 합류: 저장할 키 → 이동 |
|---|---|---|---|---|
| 경마 | `horse-race` | `horseRaceUserName` | `pendingHorseRaceRoom` → `/horse-race?createRoom=true` | `pendingHorseRaceJoin` → `/horse-race?joinRoom=true` |
| 룰렛 | `roulette` | `rouletteUserName` | `pendingRouletteRoom` → `/roulette-game-multiplayer.html?createRoom=true` | `pendingRouletteJoin` → `/roulette-game-multiplayer.html?joinRoom=true` |
| 데구리 | `deguri` | `deguriUserName` | `pendingDeguriRoom` → `/deguri?createRoom=true` | `pendingDeguriJoin` → `/deguri?joinRoom=true` |
| 주사위 | `dice` | (`globalUserNameInput`) | 아래 별도 | 아래 별도 |

저장 값(dice 로비 4421~4436행에서 복사):
```js
// 만들기
localStorage.setItem('pendingHorseRaceRoom', JSON.stringify({
  userName, roomName, isPrivate: false, password: '', expiryHours: 3, blockIPPerUser: false,
  serverId, serverName            // 자유 방이면 null, null
}));
// 합류 (4580~4594행)
localStorage.setItem('pendingHorseRaceJoin', JSON.stringify({ roomId, userName, isPrivate: room.isPrivate, serverId, serverName }));
```
`expiryHours`·`blockIPPerUser` 기본값은 dice 로비의 기본값을 찾아 맞춘다. 게임 페이지는 성공(`roomCreated`/`roomJoined`) 시점에 pending을 지우고 `{game}ActiveRoom`을 쓴다 — 홈이 할 일은 없다.

**주사위:** 로비와 게임이 한 페이지(`dice-game-multiplayer.html`)라 pending 인계가 없다. 1차에서는 주사위 그림을 누르면 `diceSession`을 맞춰 두고 `/game`(서버) 또는 `/free`(자유)로 보내 기존 로비에서 만들게 한다. 경마·룰렛·데구리가 다 돌아간 뒤에 시간이 남으면, 홈에서 `socket.emit('createRoom', {...gameType:'dice'...})` → `roomCreated` 받고 `sessionStorage.diceActiveRoom`을 로비 4749~4758행과 같은 모양으로 쓴 뒤 `/game`으로 보내서 재입장 경로(2608행)를 타는지 시험한다. 안 되면 1차 방식으로 둔다.

## 6. 작업 순서 (각 단계는 두 탭으로 확인하고 넘어간다)

1. **뼈대**: `mockups/10.html`을 `home.html`/`css/home.css`/`js/home.js`로 쪼개고 `/home` 라우트 추가. 목업 바는 없앤다. 서버 켜서 `/home`이 뜨는지.
2. **이름·상태**: `freeUserName`·`userAuth` 읽어 세 상태 표시. 이름 시트 → `freeUserName` 저장.
3. **경마 1탭**: 단골 상태에서 경마 그림 → `pendingHorseRaceRoom` → `/horse-race?createRoom=true` 도착 → 경마 방이 실제로 열림 → `roomCreated`의 shortcode로 링크. **검증:** 다른 브라우저(시크릿)에서 `/free/horse/{code}`로 들어가 합류 → 둘이 경주 한 판 끝까지.
4. **룰렛·데구리** 같은 방식. 데구리는 `/deguri`에서 열리는지, 룰렛은 `.html` 주소인지 주의.
5. **열린 방 목록**: `getRooms`/`roomsList` → 줄 누르면 `pending{Game}Join` 인계. **검증:** 다른 탭이 만든 방이 목록에 보이고 눌러서 합류.
6. **로그인·서버**: 로그인 시트 → `userAuth` → `socket:authenticate` → `getServers` → 서버 시트 → 선택 시 `diceSession`/`lamdice_lastServer` 저장 → `setServerId` → `roomsList`가 그 서버 것만. **검증:** 서버 방을 만들고(serverId 포함) 같은 서버 다른 계정으로 합류. 가입 신청 → 기존 `/` 화면의 내 서버 관리에서 승인 → 승인 뒤 들어가짐.
7. **링크 복귀**: 로그아웃 상태에서 서버 방 링크 → 로그인 요구 → 로그인 → 그 방으로 감.
8. **수치**: `node mockups/measure.js`는 저장소 파일만 재므로, `--url` 옵션(예: `http://localhost:5174/home`)을 `measure.js`에 추가해서 세 상태를 잰다(`mockups/` 안 파일은 고쳐도 된다). 목표 미달이면 글·버튼을 뺀다.
9. **주사위** (5절 끝부분). 시간이 없으면 1차 방식으로 두고 보고서에 적는다.

## 7. 규칙

- 유저가 보는 문구는 평이한 한국어. `fallback`·`default` 같은 말 노출 금지.
- 미사용 게임(다리건너기·해적룰렛·회전칼날)은 어디에도 안 보이게. 사다리는 안 넣는다(준비 중).
- 게임 결과·순서를 클라이언트에서 만들지 않는다(`Math.random` 금지).
- 사용자 입력은 `textContent`로만 DOM에 넣는다.
- 서버 코드(`socket/*`)는 수정하지 않는다. 꼭 필요하면 보고서에 적고 멈춘다.
- 광고 코드는 넣지 않는다(실서버 전환 때 따로).
- 커밋 메시지 한국어, 자기 파일만 스테이징, **`main`에 푸시 금지.**

## 8. 완료 기준

- [ ] 폰 폭에서 `/home` 첫 화면: 글자 60자 이하, 조작 6개 이하(로그인 상태는 서버 칩 포함 7개까지 허용), 가로 스크롤 없음
- [ ] 단골: 경마·룰렛·데구리 그림 1탭 → 진짜 방 열림 → 링크 복사(실제 성공) → 다른 브라우저가 링크로 합류 → 한 판 완주. 세 게임 다
- [ ] 처음: 그림 → 이름 한 칸 → 위와 같음(2탭)
- [ ] 열린 방 줄 → 합류됨
- [ ] 로그인 → 서버 선택 → 서버 방 생성·합류, 가입 신청 흐름, 서버 방 링크 복귀
- [ ] `/`와 기존 로비·게임은 전과 똑같이 동작(건드린 파일이 `routes/api.js` 한 블록뿐인지 `git diff --stat`으로 확인)
- [ ] 보고서: 돌아간 것 / 안 돌아간 것 / 베낀 코드 위치 / 다음에 정리할 중복 — `docs/goal/home-proto-report.md`

## 9. 합치기

작은 단위로 자주 `feature/marble-run`에 합친다. 그러면 테스트 서버 `lamtest.up.railway.app/home`에서 바로 볼 수 있다. 새 파일뿐이라 충돌은 `routes/api.js` 한 블록에서만 난다.

```bash
git -C /Users/radar/Work/LAMDiceBot-home fetch origin
git -C /Users/radar/Work/LAMDiceBot-home merge origin/feature/marble-run
git -C /Users/radar/Work/LAMDiceBot-home push -u origin feature/home-proto
```

`feature/marble-run`으로의 합치기는 사용자가 한다(또는 사용자가 시키면 `git push origin feature/home-proto:feature/marble-run`이 아니라 머지 커밋으로). 실서버 `/` 전환은 이 문서 범위 밖이다.
