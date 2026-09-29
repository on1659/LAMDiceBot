# SpriteMake 의뢰: 데구리 스킨 — 수영복 6종 (너구리 3 · 판다 3)

작성일: 2026-09-29 · 요청자: LAMDiceBot · 배치 `output/marble-run-skin-{sheet}-2026-09-29/` 6개
받기 경로: `assets/marble/creatures/{sheet}{,-sleep,-scuffle}.webp` (`AutoTest/spritemake/pickup-skin.py`)
분업: GPT(Codex exec)는 **생성만**(`CODEX-BRIEF.md`), 리팩·QA 는 Claude 가 배치 `tools/creatures_skin_png.js`(닌자·레서판다 배치 도구에서 이름만 바꿈)로.
규격: 기존 스킨과 동일 — 160 셀, 발바닥선 y=150, 공 112(폭 ≤120), 서기 134×130·sleep 142×100·scuffle 150×130 시트당 배율 1개.

## 디자인 (등급 = 장식 수)

| 시트 | 상점 이름 | 등급·가격 | 추가되는 것 |
|---|---|---|---|
| raccoon-swimcap | 수영모 너구리 | rare 50 | 파란 수영모(귀는 밖으로) + 이마에 올린 물안경 |
| raccoon-tube | 튜브 너구리 | epic 100 | 노란 오리 튜브(허리) + 파랑·흰 줄무늬 원피스 수영복 |
| raccoon-aloha | 알로하 너구리 | legend 150 | 빨간 꽃무늬 하와이안 트렁크 + 꽃목걸이 레이 + 머리 위 선글라스 |
| panda-trunks | 수영바지 판다 | rare 50 | 파랑·흰 줄무늬 수영 반바지 |
| panda-snorkel | 스노클 판다 | epic 100 | 스노클 마스크(주황 대롱) + 노란 수영 반바지 |
| panda-lifeguard | 구조대 판다 | legend 150 | 빨간 반바지 + 호루라기 + 코 선크림 + 빨강·흰 구조 튜브(어깨에 사선) |

공통: 기본 포즈·표정 그대로(너구리 심드렁), 오른쪽 향함, 의상은 **모든 칸**(공 포함)에서 보일 것. 배경 #6EBE64 — 초록 의상 금지(스노클 반바지를 노랑으로 바꾼 이유).

## 진행 기록
- 2026-09-29 작성, Codex 6세션 병렬 생성.
- 2026-09-29 Codex 6세션이 시트마다 3번씩 그림(54장). 불합격 사유는 전부 오판: ① 투명 배경(참조 그림이 투명이라 편집 결과도 투명) → "검은 배경"으로 봄 ② 초록 배경 편차 5~9 → "그라데이션"으로 봄(리팩 허용치 Δ60). 채택은 Claude 가 원본을 직접 보고 다시 고름.
- 채택(main·sleep·scuffle): swimcap 3·3·2 / tube 1·3·2 / aloha 1·1·2 / trunks 1·3·2 / snorkel 1·2·2 / lifeguard 1·1·2 (Codex 선택본은 각 배치 `source/SOURCES.codex.json`).
- 리팩 `tools/creatures_skin_png.js` 전부 PASS. 예외: 알로하 halo 14/3px = 꽃목걸이 분홍 꽃 오탐, 스노클 main r4c0 = 충격선이 몸에 붙어 row4 안전 축소(0.568→0.544). verify-creature 초과 항목(r0c2 '!', r4c0 충격선)은 기본 판다와 같은 위성 예외.
- 인수: `pickup-skin.py` 18장 → manifest `skinRaccoonSwimcap` 등 6섹션, 카탈로그 6항목. `qa-marble-skin-shop-test.js` ALL PASS, 게임랩 프리뷰 렌더 확인.
