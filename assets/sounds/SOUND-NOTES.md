# 사운드 시스템 노트

> 설정 파일: `assets/sounds/sound-config.json`
> 재생 유틸: `assets/sounds/sound-manager.js`
> 최종 업데이트: 2026-02-03 20:15

## 파일 상태 범례

| 표시 | 의미 |
|------|------|
| ✅ 실제 파일 | 실제 효과음이 들어있는 mp3 |
| ❌ 에셋 없음 | placeholder (무음 더미 8,340 bytes) — 실제 mp3로 교체 필요 |
| 🔇 미사용 | 파일은 있으나 코드에서 호출하지 않음 |

---

## 주사위 (dice)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `dice_roll` | `assets/sounds/dice/roll.mp3` | 주사위 굴릴 때 | dice-game-multiplayer.html:5661 | ✅ 실제 파일 (44KB) |
| `dice_result` | `assets/sounds/dice/result.mp3` | 주사위 결과 표시 시 | dice-game-multiplayer.html:5100 | ❌ 에셋 없음 |
| `dice_win` | `assets/sounds/dice/win.mp3` | 게임 승리자 결정 시 | dice-game-multiplayer.html:4699 | ❌ 에셋 없음 |
| `dice_bgm` | `assets/sounds/dice/bgm.mp3` | 게임 시작~종료 (루프) | dice-game-multiplayer.html:4485,4723 | ❌ 에셋 없음 |

---

## 룰렛 (roulette)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `roulette_spin` | `assets/sounds/roulette/spin.mp3` | 룰렛 회전 시작 시 | 미연결 | 🔇 미사용 (3.7MB) |
| `roulette_stop` | `assets/sounds/roulette/stop.mp3` | 룰렛 정지 시 | 미연결 | 🔇 미사용 (19KB) |
| `roulette_winner` | `assets/sounds/roulette/winner.mp3` | 룰렛 당첨자 발표 시 | 미연결 | 🔇 미사용 (157KB) |
| `roulette_bgm` | `assets/sounds/roulette/bgm.mp3` | 룰렛 회전 중 (루프) | roulette-game-multiplayer.html:3422,3401 | ✅ 실제 파일 (4.2MB) |

> 참고: 룰렛은 실제로 `RouletteSound` 객체(Web Audio API)로 효과음을 합성 재생 중.
> spin/stop/winner mp3 파일은 config에 등록되어 있으나 코드에서 직접 사용하지 않음.

---

## 경마 (horse-race)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `horse-race_countdown` | `assets/sounds/horse-race/countdown.mp3` | 카운트다운 (3,2,1) 시작 시 | horse-race-multiplayer.html:5986 | ❌ 에셋 없음 |
| `horse-race_gunshot` | `assets/sounds/horse-race/gunshot.mp3` | 레이스 출발 직후 (총소리) | horse-race-multiplayer.html:6049 | ❌ 에셋 없음 |
| `horse-race_crowd` | `assets/sounds/horse-race/crowd.mp3` | 레이스 중 관객 환호 (루프) | horse-race-multiplayer.html:6051,6102 | ✅ 실제 파일 (4.0MB) |
| `horse-race_bgm` | `assets/sounds/horse-race/bgm.mp3` | 레이스 중 배경음악 (루프) | horse-race-multiplayer.html:6052 | ✅ 실제 파일 (1.9MB) |
| `horse-race_slowmo_cheer` | `assets/sounds/horse-race/crowd.mp3` | 슬로우모션 중 환호성 (루프, 볼륨 0.9) | horse-race-multiplayer.html:3481,3572 | ✅ 실제 파일 (crowd 공유) |
| `horse-race_cheer_burst` | `assets/sounds/horse-race/crowd.mp3` | 골인 시 환호 (단발) | horse-race-multiplayer.html:3551,6651 | ✅ 실제 파일 (crowd 공유) |
| `horse-race_finish` | `assets/sounds/horse-race/finish.mp3` | 1등 결승선 통과 시 팡파레 | horse-race-multiplayer.html:6649 | ❌ 에셋 없음 |
| `horse-race_result` | `assets/sounds/horse-race/result.mp3` | 결과 오버레이 표시 시 | 미연결 | ❌ 에셋 없음 |

---

## 팀전 (team)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `team_bgm` | `assets/sounds/team/bgm.mp3` | 미연결 | 미연결 | ❌ 에셋 없음 |

> 참고: 팀전은 즉시 결과 방식이라 BGM 트리거 시점 미정

---

## 공통 (common)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `common_button` | `assets/sounds/common/button_click.mp3` | 버튼 클릭 시 | 미연결 | 🔇 미사용 (11KB) |
| `common_countdown` | `assets/sounds/common/countdown.mp3` | 범용 카운트다운 | 미연결 | ❌ 에셋 없음 |
| `common_notification` | `assets/sounds/common/notification.mp3` | 방 입장/퇴장 알림 | dice:5212, horse:6169, roulette:3168, team:1694 | ❌ 에셋 없음 |

---

## 요약

| 구분 | 개수 | 비고 |
|------|------|------|
| 전체 키 | 20 | sound-config.json 등록 |
| ✅ 실제 에셋 | 7 | dice_roll, roulette_bgm, horse-race_crowd, horse-race_bgm, horse-race_slowmo_cheer, horse-race_cheer_burst |
| 🔇 미사용 (에셋 있음) | 4 | roulette_spin, roulette_stop, roulette_winner, common_button |
| ❌ 교체 필요 | 9 | placeholder 상태 |

### 코드 연결 현황

| 상태 | 개수 | 키 목록 |
|------|------|---------|
| 코드 연결됨 | 12 | dice_roll, dice_result, dice_win, dice_bgm, roulette_bgm, horse-race_countdown, horse-race_gunshot, horse-race_crowd, horse-race_bgm, horse-race_slowmo_cheer, horse-race_finish, common_notification |
| 미연결 | 7 | roulette_spin, roulette_stop, roulette_winner, horse-race_result, team_bgm, common_button, common_countdown |

---

## 우선 교체 대상 (코드 연결됨 + 에셋 없음)

| 우선순위 | 키 | 게임 | 트리거 |
|----------|-----|------|--------|
| 1 | `horse-race_countdown` | 경마 | 카운트다운 시작 |
| 2 | `horse-race_gunshot` | 경마 | 레이스 출발 |
| 3 | `horse-race_finish` | 경마 | 1등 골인 |
| 4 | `dice_result` | 주사위 | 결과 표시 |
| 5 | `dice_win` | 주사위 | 승리자 결정 |
| 6 | `common_notification` | 공통 | 입장/퇴장 알림 |
| 7 | `dice_bgm` | 주사위 | 게임 중 BGM |

---

## 참고

- placeholder 파일은 `0xFF 0xFB` MP3 헤더만 있는 무음 더미 (8,340 bytes)
- 실제 효과음 mp3를 같은 경로에 덮어쓰면 즉시 적용됨
- 추천 소싱: freesound.org, pixabay.com (CC0/상업무료)
