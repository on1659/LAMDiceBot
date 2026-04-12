# 소켓 시스템

## 핸들러 모듈 상세

### `socket/rooms.js` — 방 관리

| 핸들러 | 기능 |
|--------|------|
| `getRooms` | 서버ID 기준 방 목록 (공개 방 최대 10개) |
| `getCurrentRoom` | 리다이렉트 후 방 복원 (IP 블록/소켓 마이그레이션) |
| `createRoom` | 방 생성 (게임 타입/만료/비밀번호/IP차단/터보) |
| `joinRoom` | 방 입장 (비밀번호/이름/IP 검증) |
| `leaveRoom` | 방 퇴장 (호스트 승계/유예 기간) |
| `kickPlayer` | 플레이어 추방 (호스트) |
| `transferHost` | 호스트 위임 |
| `delegateHost` | 호스트 위임 (확인 흐름) |
| `updateRoomName` | 방 이름 변경 (호스트) |
| `login` | 재접속 (소켓 ID 마이그레이션) |

### `socket/shared.js` — 공통 게임

| 핸들러 | 기능 |
|--------|------|
| `toggleReady` | 준비 상태 토글 (payload 없음) |
| `setUserReady` | 호스트가 다른 유저 준비 강제 설정 |
| `updateGameRules` | 규칙 문자열 저장 |
| `startOrder` / `endOrder` | 주문 시작/종료 |
| `updateOrder` | 주문 내용 저장 |
| `updateUserDiceSettings` | 개인 주사위 최대값 설정 |
| `updateRange` | 전역 주사위 범위 설정 (레거시) |
| `getFrequentMenus` | 자주 쓰는 메뉴 조회 |
| `addFrequentMenu` | 자주 쓰는 메뉴 추가 |
| `deleteFrequentMenu` | 자주 쓰는 메뉴 삭제 |

상세: `02-shared-systems/shared-modules.md` 참조

### `socket/chat.js` — 채팅

| 핸들러 | 기능 |
|--------|------|
| `sendMessage` | 채팅 전송 (`/주사위`, `/탈것`, `/날씨`, `/gemini` 명령어 포함) |
| `toggleReaction` | 이모지 반응 토글 |
| `sendImage` | 이미지 전송 (base64, 4MB 제한, PNG/JPG/GIF/WEBP) |
| `disconnect` | 유저 정리 (준비/플레이어 목록, 호스트 승계, 유예 기간) |

- 채팅 기록: 최대 100개, `@멘션` 지원
- 뱃지: 서버 내 게임별 상위 3명 표시

### `socket/board.js` — 건의 게시판

| 핸들러 | 기능 |
|--------|------|
| `getSuggestions` | 건의 목록 조회 |
| `createSuggestion` | 건의 작성 (제목/내용/비밀번호) |
| `deleteSuggestion` | 건의 삭제 (비밀번호 검증) |
| `geminiChat` | Gemini AI 채팅 |

### `socket/server.js` — 서버 관리

| 핸들러 | 기능 |
|--------|------|
| `createServer` | 서버 생성 (이름/설명/비밀번호) |
| `getServers` | 서버 목록 (방 수/멤버 상태 포함) |
| `joinServer` | 서버 가입 (비밀번호 검증 → 가입 대기/승인) |
| `leaveServer` | 서버 퇴장 (온라인 상태 정리) |
| `setServerId` | 세션 복원 (페이지 로드 후) |
| `getServerRecords` | 게임 기록 조회 (페이지네이션) |
| `disconnect` | 온라인 상태 정리 |

---

## 공통 이벤트와 게임 전용 이벤트

모든 게임이 공유하는 이벤트는 `socket/shared.js`에서 처리됩니다. 게임 전용 이벤트는 각 게임 모듈에서 처리됩니다.

### 공통 (`socket/shared.js`) — 모든 게임 타입에서 동일

| 이벤트 | 방향 | 설명 |
|--------|------|------|
| `toggleReady` | client → server | 준비 토글 (payload 없음) |
| `setUserReady` | client → server | 호스트가 강제 준비 설정 |
| `updateGameRules` | client → server | 규칙 문자열 저장 |
| `startOrder` / `endOrder` | client → server | 주문 시작/종료 |
| `updateOrder` | client → server | 주문 저장 |
| `updateUserDiceSettings` | client → server | 개인 주사위 최대값 설정 |
| `updateRange` | client → server | 전역 주사위 범위 (레거시) |
| `getFrequentMenus` | client → server | 자주 쓰는 메뉴 조회 |
| `addFrequentMenu` | client → server | 자주 쓰는 메뉴 추가 |
| `deleteFrequentMenu` | client → server | 자주 쓰는 메뉴 삭제 |
| `readyUsersUpdated` | server → client | 준비 목록 갱신 |
| `gameRulesUpdated` | server → client | 규칙 브로드캐스트 |
| `settingsUpdated` | server → client | 개인 주사위 설정 저장 결과 |

### 게임 전용 — 각 모듈에서만 처리

| 게임 | 모듈 | 주요 핸들러 | 상세 문서 |
|------|------|-------------|-----------|
| 주사위 | `socket/dice.js` | `startGame`, `endGame`, `clearGameData`, `requestRoll` | `03-games/dice.md` |
| 룰렛 | `socket/roulette.js` | `startRoulette`, `endRoulette`, `rouletteResult`, `updateTurboAnimation`, `selectRouletteColor`, `getUserColors` | `03-games/roulette.md` |
| 경마 | `socket/horse.js` | `startHorseRace`, `endHorseRace`, `setTrackLength`, `selectHorse`, `selectRandomHorse`, `raceAnimationComplete`, `clearHorseRaceData` | `03-games/horse-race.md` |

**핵심 원칙**: 준비/주문/규칙/메뉴 = `shared.js`, 게임 진행/결과 = 게임 전용 모듈.

---

## 방 라이프사이클

```
생성 → 입장 → 게임 진행 → 퇴장 → 유예 기간 → 삭제
         ↓                    ↓
    호스트 재접속          호스트 승계
    (소켓 ID 갱신)      (users[0] 승격)
```

- **유예 기간**: 마지막 유저 퇴장 후 `ROOM_GRACE_PERIOD` (기본 2분) 대기
- **만료**: 유예 타이머 만료 → `roomDeleted` 브로드캐스트 → rooms에서 제거
- **호스트 승계**: 호스트 퇴장 시 `users[0]`이 자동 승격, `hostChanged` 이벤트

---

## Rate Limiting

| 레벨 | 설정 |
|------|------|
| HTTP | 300 req/min (express-rate-limit) |
| Socket | 50 req/10sec (per-socket, `socket/index.js`) |
