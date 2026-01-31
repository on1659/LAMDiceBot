# 사운드 시스템 노트

> 설정 파일: `assets/sounds/sound-config.json`
> 재생 유틸: `assets/sounds/sound-manager.js`

## 파일 상태 범례

| 표시 | 의미 |
|------|------|
| ✅ 실제 파일 | 실제 효과음이 들어있는 mp3 |
| ❌ 에셋 없음 | placeholder (무음 더미 8,340bytes) — 실제 mp3로 교체 필요 |

---

## 주사위 (dice)

| 키 | 파일 경로 | 재생 시점 | 상태 |
|----|-----------|-----------|------|
| `dice_roll` | `assets/sounds/dice/roll.mp3` | 주사위 굴릴 때 | ✅ 실제 파일 |
| `dice_result` | `assets/sounds/dice/result.mp3` | 주사위 애니메이션 완료 후 결과 확정 시 | ❌ 에셋 없음 |
| `dice_win` | `assets/sounds/dice/win.mp3` | 게임 승리자 결정 시 | ❌ 에셋 없음 |
| `dice_bgm` | `assets/sounds/dice/bgm.mp3` | 게임 진행 중 배경음악 (루프) — gameStarted~gameEnded | ❌ 에셋 없음 |

## 룰렛 (roulette)

| 키 | 파일 경로 | 재생 시점 | 상태 |
|----|-----------|-----------|------|
| `roulette_spin` | `assets/sounds/roulette/spin.mp3` | 룰렛 회전 시작 시 | ✅ 실제 파일 |
| `roulette_stop` | `assets/sounds/roulette/stop.mp3` | 룰렛 정지 시 | ✅ 실제 파일 |
| `roulette_winner` | `assets/sounds/roulette/winner.mp3` | 룰렛 당첨자 발표 시 | ✅ 실제 파일 |
| `roulette_bgm` | `assets/sounds/roulette/bgm.mp3` | 룰렛 회전 중 배경음악 (루프) — rouletteStarted~결과 표시 | ❌ 에셋 없음 |

> 참고: 룰렛은 실제로 `RouletteSound` 객체(Web Audio API)로 소리를 합성 재생 중.
> 위 mp3 파일은 config에 등록만 되어 있고, 코드에서 직접 사용하지 않음.

## 경마 (horse-race)

| 키 | 파일 경로 | 재생 시점 | 상태 |
|----|-----------|-----------|------|
| `horse-race_countdown` | `assets/sounds/horse-race/countdown.mp3` | 카운트다운 (3, 2, 1) 시작 시 | ❌ 에셋 없음 |
| `horse-race_gunshot` | `assets/sounds/horse-race/gunshot.mp3` | 레이스 출발 직후 (총소리) | ❌ 에셋 없음 |

| `horse-race_crowd` | `assets/sounds/horse-race/crowd.mp3` | 레이스 중 관객 환호 (루프 재생) — 모든 탈것에 공통 사용 가능 | ❌ 에셋 없음 |
| `horse-race_finish` | `assets/sounds/horse-race/finish.mp3` | 1등 결승선 통과 시 팡파레 | ❌ 에셋 없음 |
| `horse-race_result` | `assets/sounds/horse-race/result.mp3` | 결과 오버레이 표시 시 | ❌ 에셋 없음 |
| `horse-race_bgm` | `assets/sounds/horse-race/bgm.mp3` | 레이스 중 배경음악 (루프) — horseRaceStarted~horseRaceEnded | ❌ 에셋 없음 |

## 팀전 (team)

| 키 | 파일 경로 | 재생 시점 | 상태 |
|----|-----------|-----------|------|
| `team_bgm` | `assets/sounds/team/bgm.mp3` | 미연결 — 팀전은 즉시 결과 방식이라 BGM 트리거 시점 미정 | ❌ 에셋 없음 |

## 공통 (common)

| 키 | 파일 경로 | 재생 시점 | 상태 |
|----|-----------|-----------|------|
| `common_button` | `assets/sounds/common/button_click.mp3` | 버튼 클릭 시 | ✅ 실제 파일 |
| `common_countdown` | `assets/sounds/common/countdown.mp3` | 범용 카운트다운 (미사용) | ❌ 에셋 없음 |
| `common_notification` | `assets/sounds/common/notification.mp3` | 방 입장/퇴장 알림 (updateUsers) | ❌ 에셋 없음 |

---

## 요약

- 전체 18개 키 중 **실제 에셋: 5개**, **교체 필요: 13개**
- placeholder 파일은 `0xFF 0xFB` MP3 헤더만 있는 무음 더미 (8,340 bytes)
- 실제 효과음 mp3를 같은 경로에 덮어쓰면 즉시 적용됨
