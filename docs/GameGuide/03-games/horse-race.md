# 경마 게임

## 개요

경마 게임은 탈것 선택 단계와 레이스 애니메이션 단계를 분리한 멀티플레이 게임입니다.

- 클라이언트: `horse-race-multiplayer.html`, `js/horse-race.js`
- 공개 경로: `/horse-race`
- 레거시 경로: `/horse-race-multiplayer.html` -> `/horse-race` 301 리다이렉트
- 전용 서버 핸들러: `socket/horse.js`
- 공통 이벤트 처리: `socket/shared.js`
- 설정 파일: `config/horse/race.json`

방 생성 시 유효한 게임 타입은 `horse-race`입니다. 문서나 과거 코드에 남아 있는 `horse` 표기는 현재 방 타입 기준으로는 사용하지 않습니다.

## 게임 흐름

1. 호스트가 `gameType: 'horse-race'` 방을 생성합니다.
2. 플레이어가 입장하고 준비 상태를 켭니다.
3. 호스트가 규칙을 저장하면 `horseRaceMode`가 `first` 또는 `last`로 정리됩니다.
4. 호스트가 `startHorseRace`를 보내면 서버가 선택 가능한 탈것과 라운드 정보를 준비합니다.
5. 서버가 `horseSelectionReady`를 보내고, 각 사용자는 `selectHorse` 또는 `selectRandomHorse`로 선택합니다.
6. 선택 과정에서는 `horseSelectionUpdated`, `randomHorseSelected`, `horseSelectionCancelled` 같은 보조 이벤트가 갱신됩니다.
7. 모든 선택이 끝나면 서버가 `horseRaceCountdown`을 보낸 뒤 `horseRaceStarted`를 전송합니다.
8. 클라이언트는 애니메이션을 재생하고 끝나면 `raceAnimationComplete`를 보냅니다.
9. 서버는 `horseRaceResult`와 `horseRaceEnded`를 통해 결과와 기록을 확정합니다.

## 재경주 처리

현재 구현은 별도 `requestReraceReady`나 `startRerace` 이벤트를 쓰지 않습니다.

- 동점이 나면 서버가 `raceRound`를 증가시킵니다.
- 다음 라운드용 `horseSelectionReady`를 다시 보냅니다.
- 남은 참가자 기준으로 선택 단계가 반복됩니다.

즉, 재경주는 "별도 이벤트 세트"가 아니라 "다음 선택 라운드"로 모델링되어 있습니다.

## 전용 서버 이벤트 (`socket/horse.js`)

| 이벤트 | 설명 |
|--------|------|
| `setTrackLength` | 트랙 길이 설정. 호스트 전용 |
| `startHorseRace` | 선택 단계 및 레이스 시작 준비 |
| `selectHorse` | 탈것 선택 또는 선택 취소 |
| `selectRandomHorse` | 랜덤 선택 |
| `raceAnimationComplete` | 클라이언트 애니메이션 종료 알림 |
| `endHorseRace` | 현재 경마 세션 리셋 |
| `clearHorseRaceData` | 경마 기록 초기화 |

## 공통 이벤트 (`socket/shared.js`)

| 이벤트 | 방향 | 설명 |
|--------|------|------|
| `updateGameRules` | client -> server | 호스트가 규칙 문자열 저장 |
| `toggleReady` | client -> server | 준비 상태 토글 |
| `gameRulesUpdated` | server -> client | 현재 규칙 브로드캐스트 |
| `readyUsersUpdated` | server -> client | 준비 사용자 목록 갱신 |

서버 기준 공식 계약은 `updateGameRules({ rules })`입니다. `js/horse-race.js`에는 모드 전용 payload를 보내는 흔적이 남아 있지만, 운영 문서 기준 계약은 `rules` 문자열을 기준으로 봅니다.

## 이벤트 계약

### client -> server

| 이벤트 | payload |
|--------|---------|
| `setTrackLength` | `{ trackLength: 'short' | 'medium' | 'long' }` |
| `startHorseRace` | 없음 |
| `selectHorse` | `{ horseIndex }` |
| `selectRandomHorse` | 없음 |
| `raceAnimationComplete` | 없음 |
| `endHorseRace` | 없음 |
| `clearHorseRaceData` | 없음 |
| `updateGameRules` | `{ rules }` |
| `toggleReady` | 없음 |

### server -> client

| 이벤트 | payload |
|--------|---------|
| `trackLengthChanged` | `{ trackLength, trackDistanceMeters, trackPresets }` |
| `horseSelectionReady` | `{ availableHorses, participants, players, userHorseBets, selectedUsers, selectedHorseIndices, canSelectDuplicate, horseRaceMode, raceRound, selectedVehicleTypes, trackPresets, popularVehicles, vehicleStats, trackLength?, trackDistanceMeters? }` |
| `horseSelectionUpdated` | `{ userHorseBets, selectedUsers, selectedHorseIndices, canSelectDuplicate }` |
| `randomHorseSelected` | `{ selectedUsers, canSelectDuplicate }` |
| `horseSelectionCancelled` | `{ userName }` |
| `horseRaceCountdown` | `{ duration, raceRound, userHorseBets, selectedUsers, selectedHorseIndices }` |
| `horseRaceStarted` | `{ availableHorses, players, raceRound, horseRaceMode, everPlayedUsers, rankings, horseRankings, speeds, gimmicks, weatherSchedule, winners, userHorseBets, selectedVehicleTypes, trackDistanceMeters, trackFinishLine, record, slowMotionConfig, weatherConfig, allSameBet }` |
| `horseRaceResult` | `{ rankings, userHorseBets, winners, raceRound, horseRaceMode, record }` |
| `horseRaceEnded` | `{ horseRaceHistory, finalWinner? , tieWinners? }` |
| `horseRaceGameReset` | `{ horseRaceHistory }` |

`horseSelected` 리스너는 클라이언트에 일부 남아 있지만, 현재 서버가 실제로 선택 단계에서 사용하는 이벤트는 `horseSelectionUpdated` 중심입니다.

## 핵심 상태 필드

공통 상태는 `utils/room-helpers.js`의 `createRoomGameState()`에서 시작하고, 경마에서 중요하게 쓰는 필드는 아래와 같습니다.

```javascript
{
  horseRaceHistory: [],
  isHorseRaceActive: false,
  availableHorses: [],
  userHorseBets: {},
  horseRankings: [],
  horseRaceMode: 'last',
  gamePlayers: [],
  readyUsers: [],
  everPlayedUsers: []
}
```

추가 필드로 `trackLength`, `raceRound`, `selectedVehicleTypes`, `pendingRaceResult`, 각종 timeout 핸들이 런타임 중 동적으로 붙습니다.

## 구현 메모

- 트랙 길이는 서버가 `data.trackLength`를 읽습니다.
- 선택 단계에서는 본인에게만 본인 선택 정보가 보이고, 전체 선택 완료 여부는 `selectedUsers`로 공유됩니다.
- 레이스 애니메이션이 끝나기 전까지 서버 결과 확정은 `raceAnimationComplete`를 기다립니다.
- 종료 결과는 `horseRaceResult`와 `horseRaceEnded`로 나뉘며, 후자는 기록 히스토리와 최종 승자 또는 동점 승자 목록을 담습니다.

## 참고 파일

| 파일 | 설명 |
|------|------|
| `horse-race-multiplayer.html` | 경마 페이지 진입 HTML |
| `js/horse-race.js` | 경마 클라이언트 로직 |
| `socket/horse.js` | 경마 전용 서버 로직 |
| `socket/shared.js` | 준비, 규칙 저장 같은 공통 이벤트 |
| `config/horse/race.json` | 트랙, 기믹, 날씨 설정 |
| `HORSE_GIMMICK_ANALYSIS.md` | 기믹 상세 분석 |
| `HORSE_RESOURCES.md` | 리소스 메모 |
