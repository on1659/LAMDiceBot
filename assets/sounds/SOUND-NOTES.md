# 사운드 시스템 노트

> 설정 파일: `assets/sounds/sound-config.json`
> 재생 유틸: `assets/sounds/sound-manager.js`
> 최종 업데이트: 2026-08-30

## 파일 상태 범례

| 표시 | 의미 |
|------|------|
| ✅ 실제 파일 | 실제 효과음이 들어있는 mp3 |
| ❌ 에셋 없음 | placeholder (무음 더미 8,340 bytes) — 실제 mp3로 교체 필요 |
| ⚠️ 파일 없음 | config에 등록되었으나 파일 자체가 없음 |
| 🔇 미사용 | 파일은 있으나 코드에서 호출하지 않음 |

> 2026-08-27 데드코드 정리: 미사용 파일 7개 삭제 및 config 키 5개 제거.
>
> 2026-08-30 되돌림: 그중 실제 오디오가 든 파일 5개(roulette spin/stop/winner,
> horse-race result, common button_click.wav)와 config 키 4개를 복원했다.
> 미연결 키는 데드코드가 아니라 나중에 실제 mp3로 바꿔 끼우려고 미리 걸어둔
> 자리표시자다. "코드에서 호출하지 않음"을 삭제 기준으로 삼지 않는다.
> nosound.mp3와 team/bgm.mp3는 무음 더미였고 gacha/charge.mp3·gacha/reveal.mp3로
> 이름이 바뀌어 내용은 그대로 남아 있다 (team/ 폴더는 사라짐).

> 2026-08-30 가챠 키 등록: 코드에서 호출하지만 config에 없던 gacha_charge/reveal/reveal_epic
> 3키 추가 + placeholder 생성 — 실제 mp3로 교체 필요.
> bridge-cross 3키는 사용자 결정으로 등록 보류 (아래 무음 no-op 섹션 참조).

---

## 주사위 (dice)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `dice_roll` | `assets/sounds/dice/roll.mp3` | 주사위 굴릴 때 | dice-game-multiplayer.html:7133 | ✅ 실제 파일 (44KB) |
| `dice_result` | `assets/sounds/dice/result.mp3` | 주사위 결과 표시 시 | dice-game-multiplayer.html:6571 | ❌ 에셋 없음 |
| `dice_win` | `assets/sounds/dice/win.mp3` | 게임 승리자 결정 시 | dice-game-multiplayer.html:6143 | ❌ 에셋 없음 |
| `dice_bgm` | `assets/sounds/dice/bgm.mp3` | 게임 시작~종료 (루프) | dice-game-multiplayer.html:5926,6169 | ❌ 에셋 없음 |

---

## 룰렛 (roulette)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `roulette_spin` | `assets/sounds/roulette/spin.mp3` | 룰렛 회전 시작 시 | 미연결 | 🔇 미사용 (3.7MB, 교체 대기) |
| `roulette_stop` | `assets/sounds/roulette/stop.mp3` | 룰렛 정지 시 | 미연결 | 🔇 미사용 (19KB, 교체 대기) |
| `roulette_winner` | `assets/sounds/roulette/winner.mp3` | 룰렛 당첨자 발표 시 | 미연결 | 🔇 미사용 (157KB, 교체 대기) |
| `roulette_bgm` | `assets/sounds/roulette/bgm.mp3` | 룰렛 회전 중 (루프) | roulette-game-multiplayer.html:4216,4237 | ✅ 실제 파일 (4.4MB) |

> 참고: 룰렛 효과음(회전/정지/당첨)은 `RouletteSound` 객체(Web Audio API)로 합성 재생.
> spin/stop/winner mp3는 등록만 되어 있고 코드가 부르지 않는다 — 합성음을 실제
> 파일로 바꾸고 싶어질 때를 위한 자리표시자.

---

## 경마 (horse-race)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `horse-race_countdown` | `assets/sounds/horse-race/countdown.mp3` | 카운트다운 (3,2,1) 시작 시 | js/horse-race.js:6958 | ❌ 에셋 없음 |
| `horse-race_gunshot` | `assets/sounds/horse-race/gunshot.mp3` | 레이스 출발 직후 (총소리) | js/horse-race.js:7037 | ✅ 실제 파일 (66KB) |
| `horse-race_crowd` | `assets/sounds/horse-race/crowd.mp3` | 레이스 중 관객 환호 (루프) | js/horse-race.js:6959,7119 | ✅ 실제 파일 (2.6MB) |
| `horse-race_bgm` | `assets/sounds/horse-race/bgm_insang.mp3` | 레이스 중 배경음악 (루프) | js/horse-race.js:7041,4878,7109 | ✅ 실제 파일 (2.5MB) |
| `horse-race_slowmo_cheer` | `assets/sounds/horse-race/slowmo.mp3` | 슬로우모션 중 환호성 (루프) | js/horse-race.js:3447 외 다수 | ✅ 실제 파일 (57KB) |
| `horse-race_cheer_burst` | `assets/sounds/horse-race/cheer_burst.mp3` | 골인 시 환호 (단발) | js/horse-race.js:3905,7112 | ✅ 실제 파일 (18KB) |
| `horse-race_finish` | `assets/sounds/horse-race/finish.mp3` | 1등 결승선 통과 시 팡파레 | js/horse-race.js:7111 | ❌ 에셋 없음 |
| `horse-race_result` | `assets/sounds/horse-race/result.mp3` | 결과 오버레이 표시 시 | 미연결 | 🔇 미사용 (157KB, roulette_winner와 동일 파일) |

---

## 사다리 (ladder) — 전 키 미연결

| 키 | 파일 경로 | 상태 |
|----|-----------|------|
| `ladder_pick` / `ladder_erase` / `ladder_draw` | `assets/sounds/common/button_click.mp3` | 🔇 미연결 |
| `ladder_descend` | `assets/sounds/common/countdown.mp3` | 🔇 미연결 + ❌ placeholder |
| `ladder_result` | `assets/sounds/common/notification.mp3` | 🔇 미연결 + ❌ placeholder |

---

## 스핀 아레나 (spin-arena)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `spin-arena_bgm` | `assets/sounds/horse-race/bgm.mp3` | 스핀 중 (루프) | js/spin-arena.js:2294,201 | ❌ 에셋 없음 (placeholder → 사실상 무음) |
| `spin-arena_start` / `_hit` / `_result` / `_round1_stop` / `_finalist_tick` | common 파일 공유 | — | 미연결 | 🔇 미연결 |

---

## 가챠 (gacha) — 상점 공유 모듈 (사다리/경마/스핀아레나에서 사용)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `gacha_charge` | `assets/sounds/gacha/charge.mp3` | 가챠 빌드업 시작 시 | js/shared/shop-shared.js:1292 | ❌ 에셋 없음 |
| `gacha_reveal` | `assets/sounds/gacha/reveal.mp3` | 결과 공개 (일반/레어) | js/shared/shop-shared.js:1288 | ❌ 에셋 없음 |
| `gacha_reveal_epic` | `assets/sounds/gacha/reveal_epic.mp3` | 결과 공개 (에픽) | js/shared/shop-shared.js:1288 | ❌ 에셋 없음 |

---

## 해적 룰렛 (pirate) — 전 키 미연결

`pirate_claim`, `pirate_tick`, `pirate_pop`, `pirate_win`, `pirate_lose` 모두 config에는
있으나 js/pirate.js에서 호출하지 않음. 🔇 미연결 (파일은 common 공유).

---

## 공통 (common)

| 키 | 파일 경로 | 재생 시점 | 코드 위치 | 상태 |
|----|-----------|-----------|-----------|------|
| `common_button` | `assets/sounds/common/button_click.mp3` | 버튼 클릭 시 | 미연결 | 🔇 미사용 (11KB 실제 파일) |
| `common_countdown` | `assets/sounds/common/countdown.mp3` | 범용 카운트다운 | 미연결 | ❌ 에셋 없음 |
| `common_notification` | `assets/sounds/common/notification.mp3` | 방 입장/퇴장 알림 | dice:6685, js/horse-race.js:7264, roulette:3990 | ❌ 에셋 없음 |

---

## ⚠️ 코드에서 호출하지만 config에 없는 키 (무음 no-op)

| 키 | 호출 위치 | 비고 |
|----|-----------|------|
| `bridge-cross_safe` | js/bridge-cross.js:2422 | 다리건너기는 현재 소리가 전혀 없음 — 등록 보류 (2026-08-30 사용자 결정) |
| `bridge-cross_break` | js/bridge-cross.js:2435 | 〃 |
| `bridge-cross_fall` | js/bridge-cross.js:2436 | 〃 |

---

## 요약

| 구분 | 개수 | 비고 |
|------|------|------|
| 전체 키 | 38 | sound-config.json 등록 (2026-08-30 삭제분 4키 복원 반영) |
| ✅ 실제 에셋 + 코드 연결 | 7 | dice_roll, roulette_bgm, horse-race_gunshot/crowd/bgm/slowmo_cheer/cheer_burst |
| ❌ placeholder + 코드 연결 (교체 필요) | 10 | dice_result, dice_win, dice_bgm, horse-race_countdown, horse-race_finish, common_notification, spin-arena_bgm, gacha_charge/reveal/reveal_epic |
| 🔇 미연결 | 21 | ladder 5, spin-arena 5, pirate 5, common_button, common_countdown, roulette_spin/stop/winner, horse-race_result (뒤 4개는 실제 오디오 보유) |

---

## 우선 교체 대상 (코드 연결됨 + 에셋 없음)

| 우선순위 | 키 | 게임 | 트리거 |
|----------|-----|------|--------|
| 1 | `horse-race_countdown` | 경마 | 카운트다운 시작 |
| 2 | `horse-race_finish` | 경마 | 1등 골인 |
| 3 | `spin-arena_bgm` | 스핀 아레나 | 스핀 BGM (현재 무음) |
| 4 | `dice_result` | 주사위 | 결과 표시 |
| 5 | `dice_win` | 주사위 | 승리자 결정 |
| 6 | `common_notification` | 공통 | 입장/퇴장 알림 |
| 7 | `dice_bgm` | 주사위 | 게임 중 BGM |
| 8 | `gacha_charge` / `gacha_reveal` / `gacha_reveal_epic` | 가챠 (상점 공유) | 빌드업 / 결과 공개 |

---

## 참고

- placeholder 파일은 `0xFF 0xFB` MP3 헤더만 있는 무음 더미 (8,340 bytes)
- 실제 효과음 mp3를 같은 경로에 덮어쓰면 즉시 적용됨
- 추천 소싱: freesound.org, pixabay.com (CC0/상업무료)
