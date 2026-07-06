# applied: 경마 이름표(닉네임 라벨) 꾸미기

> 적용 기록 (goal 명세 없이 대화형 요청으로 진행 → 완료 후 기록). 2026-06-22.

## 한 줄 요약
경마 `bib` 슬롯을 **"마번(레인 번호 배지)"에서 "이름표(닉네임 라벨) 꾸미기"로 전환**하고, 장착한 이름표가 **모든 플레이어 화면에 broadcast**되도록 했다. 슬롯 내부 key `'bib'`·카탈로그 id `bib_*`·DB/장착 계약은 유지(소유 데이터 보존), 표시 텍스트와 렌더 대상만 변경.

## 배경
- 사용자가 게임 중 말 위에 뜨는 닉네임 라벨("⭐ 김영태")을 꾸미고 싶어 함. 기존 `bib` 꾸미기는 닉네임이 아니라 **레인 번호("3")를 색칠한 배지**였고, 닉네임 라벨은 꾸미기와 무관한 하드코딩(내 것=노란색)이었다.
- 결정(사용자 확인): ① bib을 이름표 꾸미기로 전환, 마번 숫자 배지 제거. ② 장착 이름표는 **모두에게 보이게**(기존 도색/트레일처럼 공개).

## 변경 파일
| 파일 | 변경 |
|------|------|
| `socket/horse.js` | `buildRaceCosmetics`에 `labelCosmetics[userName]=bibId`(DB equip + 게스트 ad-equip 병합) 수집 → `horseRaceStarted` payload에 추가(additive, 하위호환). 라벨 수집 루프는 인증 가드 밖(게스트 전용 방도 broadcast) |
| `js/horse-race.js` | 이름표 렌더 2곳(선택화면/경주중)에 `race-name-tag` 클래스 + `dataset.username` + `applyLabelCosmetic(nameTag, userName, isMe, useBroadcast)`. me 기본 스타일은 `ME_NAMETAG_CSS` 상수로 통일. `refreshMyNameTags()`(`window` 노출)로 상점 장착/해제 라이브 반영. `horseRaceStarted` 수신 시 `window._raceCosmetics.labels` 저장 |
| `js/horse-shop.js` | 마번 숫자 배지 렌더 제거(+ `.cosmetic-bib` stale 참조 제거), `getLabelStyle(bibId)`/`getMyEquippedLabel()` 신설·공개, 미리보기 '3'→내 닉네임(미인증 "이름"), SLOTS 탭 "🏷️ 이름표", 카탈로그 eager 로드, 훅 3개가 `refreshMyNameTags` 호출 |
| `config/horse/cosmetics.json` | `bib` 6종 name "…마번"→"…이름표"(id/price/adOnly/adPrice/색 유지). 광고 전용 3종 추가됨: `bib_ad_ruby`/`bib_ad_sapphire`/`bib_ad_carbon`(노란색 회피 — 사용자 본인 이름표가 노란색) |
| `css/horse-shop.css` | 데드코드 `.cosmetic-bib` 삭제, `.hshop-preview-bib` 가변폭(ellipsis) 재활용 |

## 동작
- **선택화면:** 내 이름표만 내 로컬 장착으로 미리보기(`useBroadcast=false`), 타인은 기본 스타일(broadcast 전이라 타인 최신 이름표 미지).
- **경주중:** `labelCosmetics` broadcast로 전원 이름표가 각자 장착 색으로 표시.
- **라이브:** 상점에서 장착/해제 시 `refreshMyNameTags()`가 내 라벨 즉시 갱신(해제 시 기본 금색 복귀).

## 공정성
- 이름표 꾸미기는 `color`/`bg`/`border`만 사용 — 결과/시뮬/승자 경로(`calculateHorseRaceResult`/`getWinnersByRule`) 무진입. `labelCosmetics`는 transient(gameState/leaveRoom 미오염). 클라 신규 `Math.random` 0.

## 리뷰에서 잡아 고친 것
- **H-1:** 다음 라운드 선택화면에서 타인 이름표가 직전 라운드 색으로 남던 stale 누수 → 선택화면 `useBroadcast=false` 게이팅으로 차단. (→ lesson `horse-race.md` 2026-06-22)
- **M-1:** 경주 중 이름표 해제 시 색이 기본으로 안 돌아오던 문제 + 닉네임을 CSS 셀렉터에 넣던 경로 → 라이브 갱신을 `horse-race.js refreshMyNameTags`로 이전(기본 복원 후 재적용, 셀렉터에 유저입력 미사용).

## 검증
- `node -c socket/horse.js js/horse-shop.js js/horse-race.js server.js` OK
- 회귀 가드: `AutoTest/horse-nametag-cosmetic-smoke.js` (11/11 PASS)
- 라이브 2탭 수동 QA 체크리스트는 QA 보고 참조(이름표 broadcast 동기화 / H-1 stale 차단 / M-1 unequip 복귀 / 게스트 광고 이름표).
