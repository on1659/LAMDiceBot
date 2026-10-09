# 홈 프로토타입 보고서 — `/home` (목업 10번 "그림 네 개"를 실제로 연결)

> 명세: `docs/goal/applied/home-proto.prompt.md` (2026-10-06). 브랜치 `feature/home-proto`, 작업 폴더 `/Users/radar/Work/LAMDiceBot-home`.
> 범위: 폰에서 `/home`을 열어 그림 한 번 → 진짜 방 → 링크로 들어온 친구와 한 판 끝까지. 코드 구조보다 "돌아간다"를 우선했다(사용자 결정).

## 1. 돌아간 것 (전부 로컬 서버 + 로컬 PostgreSQL 에서 두 브라우저 컨텍스트로 확인)

| 완료 기준 | 결과 | 확인 방법 |
|---|---|---|
| 폰 375×812 첫 화면 글자 60자 이하·조작 6개 이하·가로 스크롤 없음 | 처음 **35자/6개**, 단골 **34자/6개**, 로그인 **41자/7개**(서버 칩 포함, 명세가 7개까지 허용) | `node mockups/measure.js --url http://localhost:5175/home [--ls freeUserName=라온] [--ls userAuth=…]` |
| 단골: 경마·룰렛·데구리 그림 1탭 → 방 → 링크 복사(실제) → 다른 브라우저 합류 → 한 판 완주 | 세 게임 다 통과. 경마 41.6s, 룰렛 8.3s, 데구리 61.6s 에 종료 이벤트 수신 | `node AutoTest/qa-home-proto-e2e.js --game horse-race\|roulette\|deguri --regular` |
| 처음: 그림 → 이름 한 칸(제안 이름 채워짐) → 위와 같음(2탭) | 통과 (경마) | 같은 스크립트, `--regular` 없이 |
| 열린 방 줄 → 합류 | 통과 (경마, 주사위). 처음 온 손님은 이름 시트 한 번 뒤 **누른 그 방**으로 이어진다 | `--via list`, `qa-home-proto-dice-e2e.js` |
| 로그인 → 서버 선택 → 서버 방 생성·합류, 가입 신청 흐름, 서버 방 링크 복귀 | 통과. 새 서버 → 칩이 서버 이름 → 경마 그림 → `/horse-race/CODE` 서버 방. 다른 계정 "참여 가능" → 신청 → "승인 대기" → 승인 뒤 줄이 바뀜 → 입장 → 열린 방이 그 서버 것만 → 합류. 로그아웃 상태로 서버 방 링크 → `/game` 로그인 요구 → `/home`에서 로그인 → 그 방으로 복귀 | `node AutoTest/qa-home-proto-server-e2e.js` |
| `/`와 기존 로비·게임은 그대로 | `git diff --stat`: `routes/api.js` +8줄(한 블록), `mockups/measure.js` +13/−5(`--url`·`--ls` 옵션). 나머지는 전부 새 파일 | 기존 서버(5173)에서 `/home`은 404, 새 서버에서 `/`는 전과 같음 |

링크 복사는 게임 페이지의 기존 초대 바(`js/shared/free-invite.js`)가 한다 — 클립보드 내용이 링크와 같은지까지 확인했다. 홈은 복사 UI를 따로 만들지 않았다.

## 2. 안 돌아간 것 / 미룬 것

- **주사위는 1차 방식.** 그림을 누르면 `diceSession`을 맞추고 `/free`(자유) 또는 `/game`(서버)의 기존 로비로 보낸다. 로비에서 한 번 더 "방 만들기"를 눌러야 한다(2탭, 주사위만). 열린 주사위 방 합류는 `diceActiveRoom`으로 `/game`에 들어가 바로 앉는다(확인됨). 홈에서 직접 `createRoom` 하는 2차 방식은 시도하지 않았다.
- **서버 멤버 승인·강퇴 UI 없음**(명세대로). 기존 `/` 화면의 내 서버 관리 또는 `POST /api/server/:id/members/:name/approve`로 한다. 테스트는 REST 로 승인했다.
- **가입 신청은 참여코드가 맞아도 방장 승인이 필요하다**(기존 서버 규칙). 홈 시트는 "참여코드" 줄 → 코드 입력 → "신청" → "승인 대기"로 표시한다. 자동 입장이 아니다.
- **에셋 두 개가 `mockups/`에 의존한다**: 숫자 서체 `Galmuri11`(`/mockups/assets/galmuri11-sub.woff`)만. 실서버는 `/mockups/`가 404 라 서체만 기본 고정폭으로 떨어진다(테스트 서버는 DEV_GAMES=1 이라 보임). 경마 말·데구리 고슴도치·아이콘은 실제 게임 에셋(`assets/horse-race/vehicles/horse/`, `assets/deguri/creatures/hedgehog.webp` 0행, `css/ui-icons.css`)을 써서 실서버에서도 보인다. 실서버 전환 때 서체만 옮기면 된다.
- **라이트만.** 종이·잉크 토큰은 `css/home.css` `:root`에 두었고(`css/theme.css` 안 건드림, 명세대로) 다크 값은 없다. DESIGN.md 도 "다크 값은 리뉴얼 적용 때 정한다"로 되어 있다.
- **광고 없음**(명세대로).
- 게임 페이지에서 나는 `W` 페이지 오류는 홈과 무관하다 — `/game`·`/horse-race`를 홈 없이 열어도 똑같이 난다(광고 스크립트로 보임). `/home` 자체는 JS 오류 0.
- 열린 방 목록에는 방장이 나간 직후의 방(0명, 유예 300초)이 기존 로비와 똑같이 잠깐 보인다. 서버 규칙이라 홈에서 숨기지 않았다.
- 계정 버튼은 로그인 상태에서 누르면 **확인 없이 바로 로그아웃**한다(목업 10번 그대로). 실수 탭이 걱정되면 확인 한 번을 넣는다.
- 인원 표기는 `n명`(진행 중이면 `n명 진행`, 비공개면 `비공개`). 명세의 `n/최대`는 서버에 게임별 최대 인원이 없어(공통 50) 뺐다.

## 3. 베낀 코드 위치 (서버 쪽 이벤트는 새로 만들지 않았다)

| 홈 코드 | 원본 |
|---|---|
| `js/home.js` 인증 복원·토큰 갱신 `validateToken`/`expireLogin` | `js/shared/server-select-shared.js` 370~400행 `_authRestore`/`_validateToken` + `js/shared/auth-token-shared.js` |
| 로그인·회원가입 응답 처리(`userAuth` 저장 → `socket:authenticate`), `takeReturnLink` | `server-select-shared.js` 1030~1070행 `_authModal.doApiCall`, 1113~1122행 `_takeReturnLink` |
| 로그아웃(`userAuth`만 삭제) | 같은 파일 973행 |
| 방 만들기 인계 `pending{Game}Room` → `?createRoom=true` | `dice-game-multiplayer.html` 4405~4436행 (`expiryHours` 3·`blockIPPerUser` false 는 4379·4383행 기본값) |
| 합류 인계 `pending{Game}Join` → `?joinRoom=true` | 같은 파일 4570~4594행 |
| 주사위 자유 합류 `diceSession` + `diceActiveRoom` → `/game` | `js/free.js` 425~480행 `joinExistingRoom` |
| 서버 선택 저장 `diceSession` + `lamdice_lastServer` | dice 로비 2480~2487·2636~2641행, `server-select-shared.js` 310~320행 `serverJoined` |
| 서버 목록·가입·생성 이벤트와 상태 필드(`is_member`·`is_pending`·`is_private`) | `socket/server.js` 19~215행, `db/servers.js getServers` |
| 방 목록 필드·`setServerId` 뒤 `serverId` 재필터 | `socket/index.js buildRoomsList`/`filterRoomsForSocket`, `socket/server.js setServerId` |
| 이름 규칙(자유=`freeUserName`, 서버=`userAuth.name`) | `js/free.js` 1013~1030행 주석 |
| `home.html`·`css/home.css` 화면·토큰 | `mockups/10.html` (목업 바 제거, "방 만들기" 머리말 추가, 방 화면은 게임 페이지가 맡으므로 삭제) |

## 4. 다음에 정리할 중복

- `js/home.js`의 인증 복원·로그인 처리·`_takeReturnLink`는 `server-select-shared.js`와 같은 코드다. 홈이 `/`를 대체할 때 한쪽으로 모은다.
- 게임별 인계 표(`GAMES`: 이름 키·pending 키·경로)는 dice 로비·`js/free.js`(`GAME_PATH_BY_TYPE`·`PENDING_KEY_BY_TYPE`)·`free-invite.js`(`SLUG_TO_GAME_PATH`)에 네 벌 있다. `js/shared/`로 한 벌.
- 종이·잉크 색 토큰이 `css/home.css`와 `mockups/*.html` 23벌에 흩어져 있다. 리뉴얼 확정 때 `css/theme.css` 토큰 그룹으로(다크 값 포함).
- `mockups/measure.js --url`은 저장소 파일 측정 코드와 분기가 섞였다. 목업 비교가 끝나면 live 측정만 남긴다.
- 주사위 2차 방식(홈에서 직접 `createRoom` → `diceActiveRoom` → `/game` 재입장 경로)을 넣으면 주사위도 1탭이 된다.

## 5. 실행·검증 방법

```bash
# 서버 (worktree 에서) — 5173/5174 는 다른 세션이 쓰고 있을 수 있다
cd /Users/radar/Work/LAMDiceBot-home && PORT=5175 node server.js
# 첫 화면 수치 (세 상태)
node mockups/measure.js --url http://localhost:5175/home
node mockups/measure.js --url http://localhost:5175/home --ls freeUserName=라온
node mockups/measure.js --url http://localhost:5175/home --ls 'userAuth={"name":"…","token":"…"}'
# 2인 E2E
node AutoTest/qa-home-proto-e2e.js --game horse-race            # 처음(2탭) + 링크 합류 + 완주
node AutoTest/qa-home-proto-e2e.js --game roulette --regular    # 단골(1탭)
node AutoTest/qa-home-proto-e2e.js --game deguri --regular
node AutoTest/qa-home-proto-e2e.js --game horse-race --regular --via list   # 열린 방 줄로 합류
node AutoTest/qa-home-proto-dice-e2e.js                          # 주사위 1차 방식 + 목록 합류
node AutoTest/qa-home-proto-server-e2e.js                        # 로그인·새 서버·가입 신청·승인·서버 방·링크 복귀 (로컬 DB 에 계정·서버 생성)
```
마지막 화면은 `AutoTest/.shots/home-e2e-*.png`(git 제외)에 남는다.
