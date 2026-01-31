# 맨 다이스 사운드 계획 (LAM Dice Sound Plan)

## 1. 폴더 구조

프로젝트 루트 기준:

```
assets/
  sounds/
    common/     # 버튼 등 공통 사운드
    dice/
    roulette/
    horse-race/
```

## 2. sound-config.json

- **경로**: `assets/sounds/sound-config.json`
- **스키마**: 키–값 쌍. 키는 `{gameType}_{effectName}` 형식, 값은 해당 사운드 파일 경로.
- **키 규칙**:
  - 게임별: `dice_roll`, `roulette_spin`, `roulette_stop`, `roulette_winner`, `horse-race_start` 등
  - 공통: `common_{effectName}` (예: `common_button`)
- **경로**: 프로젝트 내 기준으로 통일 (예: `assets/sounds/dice/roll.mp3`). 클라이언트는 이 JSON을 fetch하여 경로를 읽고, `Audio` 재생 시 사용. 파일이 없으면 무음/스킵 처리.

### 게임별 사용 키 예시

| 게임   | 키 예시 |
|--------|---------|
| 주사위 | `dice_roll` |
| 룰렛   | `roulette_spin`, `roulette_stop`, `roulette_winner` |
| 경마   | `horse-race_start`, `horse-race_finish` 등 (필요 시) |
| 공통   | `common_button` |

## 3. 사운드 옵션 노출 위치

- **로비**: 각 게임 페이지 로비에 사운드 체크박스 유지.
- **게임 섹션**: 주사위/룰렛/경마 게임 화면(room-header 근처)에 사운드 체크박스 추가. 로비와 동일한 `localStorage` 키로 동기화.
- **방 생성 섹션**: 방 만들기 화면의 사운드 체크박스는 **제거**. 연결됨(● 연결됨) 표시만 유지.

## 4. 게임별 enabled 플래그 및 localStorage 키

| 게임   | localStorage 키       | 게이트 함수 |
|--------|------------------------|-------------|
| 주사위 | `diceSoundEnabled`     | `getDiceSoundEnabled()` |
| 룰렛   | `rouletteSoundEnabled` | `getRouletteSoundEnabled()` |
| 경마   | `horseSoundEnabled`    | `getHorseSoundEnabled()` |

- 체크 시 `'true'`, 해제 시 `'false'` 저장. 기본값은 끔(off).
- 로비 체크박스와 게임 섹션 체크박스는 같은 키를 읽고 쓰므로 동기화됨.

## 5. 공통 사운드 재생 유틸 (SoundManager)

- **위치**: `assets/sounds/sound-manager.js`
- **역할**:
  - `sound-config.json` fetch 및 캐시
  - `playSound(key, enabled)` — `enabled`가 false면 재생 스킵. 키 형식: `gameType_effectName`
  - `ensureContext()` — 사용자 제스처 후 AudioContext resume (한 번만 호출해도 됨)
- **파일 없음/실패**: 재생 시 404 또는 로드 실패 시 무시(catch). 룰렛은 기존 Web Audio fallback 유지 가능.

## 6. 데이터 흐름

```
sound-config.json → Fetch → Path cache by key
Lobby/Game sound checkbox ↔ localStorage (per game)
getXxxSoundEnabled() → true일 때만 Cache → Audio play (또는 Web Audio)
```

## 7. 참고

- 주사위: `socket.on('diceRolled')` 또는 결과 표시 시점에서 `getDiceSoundEnabled()`가 true일 때만 `dice_roll` 재생.
- 룰렛: 참가자도 소리 나도록 준비 버튼 클릭 또는 게임 섹션 진입 시 `ensureContext()` 호출. `getRouletteSoundEnabled()`로 재생 제어.
- 경마: 게임 섹션에 사운드 체크박스 추가, `getHorseSoundEnabled()` 사용. 필요 시 `horse-race_*` 키로 재생 시점 추가.
