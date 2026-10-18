# 풍선 타기 그림 — 동물 포즈 3종 × 10 + 소품

작성일: 2026-10-18 · 요청자: LAMDiceBot(사용자 "목업 디자인 그대로라 밤티, spritemaker 써서 제대로") · 받기 경로: `assets/balloon/`
기획서: `docs/goal/balloon-climb.md` §6-2 · 배치: `SpriteMake/output/balloon-{hang,blow,fall,props}-2026-10-18/` · 도구: `AutoTest/spritemake/balloon-sheet.py`
분업: GPT(Codex exec)는 그리기만. 배경 제거·덩어리 배정·배율·정렬·검증·인수는 `balloon-sheet.py`(배경 제거·인수 함수는 `walk-sheet.py` 그대로), 채택 판정은 원본을 눈으로.

## 규격

### 동물 시트 — `creatures/{동물}-{kind}.webp` (기본 10종)

| 항목 | 값 |
|---|---|
| 캔버스 | 640×160, 4×1, 칸 160, 오른쪽 향함, 알파 0/255 |
| 크기 | 몸 넓이 = 기본 시트(`assets/deguri/creatures/{동물}.webp`) row 0 서기 칸 넓이의 중앙값(시트당 배율 1개). 매달림만 하한 0.78배(세로로 늘어져 칸 키에 먼저 닿는다) |
| hang | 두 앞발을 머리 위로 올려 풍선 끈 끝을 쥐고 둥실. 끈 토막 꼭대기 = 칸 (80, 4) — 렌더러 `HANG_ANCHOR`, 풍선 줄·낙하산 줄이 여기 붙는다. 리팩 때 끈 토막은 아래 30%만 남긴다(몸이 작아지지 않게). c0 가만 · c1 다리 앞으로 · c2 가만 · c3 다리 뒤로. 낙하산도 이 그림 |
| blow | 땅에 서서 앞발로 분홍 풍선 꼭지를 입에 대고 분다(풍선은 안 그림). 발바닥선 y=150, 윗몸 무게중심 x = 서기. c0 들이쉼 · c1 볼 빵빵 · c2 들이쉼 · c3 더 빵빵. 꼭지 끝(입) 좌표는 `balloon-sheet.py mouth` 로 재서 렌더러 `MOUTH` 표에 |
| fall | 풍선이 터진 뒤. c0 깜짝 놀람(터지는 순간·꼴등 피날레 놀람) · c1~c3 허우적 낙하. 몸 bbox 가운데 = (80, 82) |

### 소품 — `props/*.webp`

| 파일 | 칸 | 내용 |
|---|---|---|
| balloon.webp | 96×120 × 4열 × 8행 | 행 = 색(렌더러 `BALLOON` 순서), c0 풍선(매듭 아래 끝 48,116) · c1~c3 터짐. 그린 건 빨강 한 줄, 나머지 7색은 `hue_set` 으로 색상·채도만 바꿈(외곽선·하이라이트 유지) |
| chute.webp | 160×112 × 4열 | 낙하산 캐노피 c0 접힘 → c3 펼침, 아랫단 가운데 (80, 108). 줄은 렌더러가 그린다 |
| chestnut 64×64 · storm / storm-flash 192×128 · gravestone 96×128(아래 정렬, 글자 없음) · bolt 72×288 · plank 192×32 · thorn 32×96 · shutter 192×32 | | 밤송이 · 먹구름(평소/번쩍) · 비석 · 번개 · 여닫이 나무 판(반쪽씩 씀) · 가시 덩굴(바람 골목 벽) · 셔터 문 |

데구리 그림을 그대로 쓰는 것: 풍차 날개(`pieces/windmill-rotor.webp`), 흔들 통나무, 선풍기, 벌집·벌 떼, 바람, 먼지, 깃발, 잔디·나무, 독수리, 들보(`start-platform-mid`), 어질어질 앉은 자세(동물 시트 row 4 c3 — 비석 앞).

## 채택 기록

- 소품 3장 모두 첫 시도 채택. 풍선 터짐 2·3칸은 조각이 풍선보다 넓게 흩어져 칸에 맞춰 따로 줄임.
- hang: 햄스터·판다·고슴도치·아르마딜로·공벌레·거북이·토끼·돼지 첫 시도, 복어 2번(끈이 가운데). **너구리는 이미지 도구 안전 검사에 3번 막힘** — "밧줄에 매달림(hang from a rope)" 표현 탓으로 보고 "풍선 끈을 쥐고 둥실 떠 있음"으로 바꿔 재의뢰(`_blocked-raccoon/` 보관). 이후 hang 문구는 전부 이 표현.
- blow: 전부 첫 시도(햄스터·고슴도치·아르마딜로·판다·공벌레·거북이·복어·너구리·토끼), 돼지는 꼬리가 둘(머리 뒤에도 말린 꼬리)이라 "꼬리 하나, 엉덩이에만" 을 덧붙여 재의뢰(`ribbonpig-r2/` 2번 채택). 아르마딜로·너구리는 투명 대신 체크무늬를 그렸지만 배경 제거(Δ60 flood)로 지워짐.
- fall: 공벌레 3번, 토끼 2번, 나머지 첫 시도.
- 너구리 hang 은 "풍선 끈을 쥐고 둥실" 표현으로도 두 번 더 막혀(자해 필터) **끈 없이 두 팔 만세 자세**로 그렸다(`_blocked-raccoon-2/` 보관). 끈 토막이 없으니 앞발 꼭대기가 기준점 — `balloon-sheet.py NO_ROPE`.
- 기본 10종 × 3 = 30장을 서기 칸과 나란히 4칸씩 확대해 확인한 뒤(크기·얼굴·색 일관, 섞인 칸 없음) 스킨의 기준 그림으로 삼았다.

## 겪은 것

- 원본 끈 토막이 칸 키의 ~25%를 먹어 몸 넓이가 서기의 0.64~0.68배로 나왔다 → 리팩 때 끈을 아래 30%만 남겨 0.82~0.96배.
## 스킨 — deguri_skin 69종 × 3포즈 (사용자 2026-10-18: "스킨이 없으면 매달려 올라가는 동안 스킨이 벗겨져 보인다")

받기 경로 `assets/balloon/creatures/{동물}-{스킨}-{kind}.webp`, 렌더러 `poseSheet` 가 먼저 찾고 없으면 기본 동물 것. 갈래는 `balloon-sheet.py skin-kind` 가 정한다:

| 갈래 | 방법 | look |
|---|---|---|
| recolor (6) | `recolor-creature.py` PRESETS — GPT 없음 | hedgehog-cherry armadillo-gold pufferfish-blue rabbit-black turtle-ocean hamster-grey |
| remap (20) | 프리셋은 없지만 기본 시트와 **알파가 100% 같고** 색 대응 편차 < 5 인 색 스킨 — 기본 main ↔ 스킨 main 같은 자리 픽셀로 "기본 색 → 스킨 색" 표를 만들어 포즈 시트에 입힘(가까운 기본 색 + 원래 음영 차). GPT 없음 | hedgehog-lemon/blueberry, armadillo-silver/rose, pillbug-tangerine/matcha, turtle-lavender/coral, panda-brown/strawberry, hamster-choco/snow, pufferfish-peach/kiwi, raccoon-white/sunset, rabbit-cheese/sky, ribbonpig-jeju/mintchoco |
| pixelate (2) | `pixelate-creature.py` 방식 — GPT 없음 | panda-dot hamster-dot |
| dress (41) | GPT 옷 입히기: 1번 입력 = 기본 동물 포즈 시트, 2번 입력 = 스킨 main 시트. 포즈 그대로, 의상은 스킨 시트와 같은 디자인, 기본 동물에 없는 색·무늬만 | 나머지 전부(ribbonpig-red 포함 — PRESETS 에 있지만 서기 시트에 머리 위 불꽃 장식이 있어 색만 바꾸면 장식이 빠진다, 걷기 시트 때도 옷 입히기) |

채택(dress): 스킨 서기 4칸 | hang | blow | fall 을 한 줄로 놓고 확대해서 본다(동시 실행 섞임·기본 동물 특징 잔존 확인). GPT 가 hang 의 끈 토막을 빼먹은 시트는 그림 꼭대기(앞발)가 기준점이 되므로 그대로 받는다(검사는 참고 표시).
- ribbonpig-ribbon · ribbonpig-scarf(매달림에도 시큰둥한 반눈 유지 확인) · hamster-cookie · hedgehog-knight · panda-red(배·팔다리 짙은 색 확인) · pillbug-rainbow · rabbit-tophat · turtle-melon — 첫 시도 또는 Codex 가 다시 그린 마지막 시도 채택
- armadillo-cowboy · armadillo-gpu · hamster-bee · hamster-hachi · hamster-nyang · hedgehog-apple · panda-bamboo · panda-honey · panda-lifeguard · panda-malang · panda-mochi · panda-snorkel · panda-trunks · pillbug-gpu · pillbug-ladybug · pufferfish-crown · rabbit-ura · rabbit-yaho · ribbonpig-angry · ribbonpig-gold · ribbonpig-iron · ribbonpig-pilot · ribbonpig-zhu · turtle-garden · turtle-gpu — 같은 방법으로 확인해 채택
- 마지막 묶음: rabbit-wreath · ribbonpig-chef · ribbonpig-red(머리 위 불꽃 유지 확인) · raccoon-ninja · raccoon-swimcap · raccoon-tube · raccoon-beanie · raccoon-aloha
- 스킨 쪽에서 겪은 것: panda-honey blow 가 투명 대신 회색 체크무늬를 그렸는데 Δ60 flood 로 안 지워짐 → `remove_checker()`(밝은 회색 두 톤이 칸 단위로 번갈아 나오는 바탕을 먼저 지움). 너구리 스킨 hang 은 기본 너구리와 같은 문구(끈 없이 두 팔 만세)로 미리 바꿔서 돌려 막힘 없음. raccoon-aloha fall 은 Codex 가 그림을 받고 저장에 실패해 한 번 더 돌림.

## 2차 소품·배경 (사용자 2026-10-18 플레이 피드백 — goal 문서 §11)

| 파일 | 칸 | 내용 | 배치 |
|---|---|---|---|
| props/item-box.webp | 64×64 × 2 | 아이템 상자(무지개 선물 상자·별) — 가만 · 반짝 | `balloon-props2-2026-10-18` (`scaffold-props2`, 4×2 한 장) |
| props/super-balloon.webp | 96×120 × 2 | 슈퍼 풍선(금색 별 풍선, 매듭 아래 끝 48,116) — 풍선 · 무지개 꼬리(꼭대기를 첫 칸에 맞추고 꼬리는 칸 밑에서 자름) | 같음 |
| props/shield.webp | 128×128 × 2 | 방패 비눗방울(속 비움) · 깨짐 | 같음 |
| props/cloud.webp | 192×96 × 2 | 구름 쿠션 · 눌림(아래 정렬) | 같음 |
| bg/sky-mid · sky-high · sky-top.webp | 512×768(top 은 위 62%만 512×476) | 먼 배경 — 구름 위 낮 · 노을 · 밤하늘. 가운데 띠는 비우고 양옆에 섬·열기구·달. 데구리 `stage/sky-far.webp` 를 화풍 참조로 | `balloon-sky-2026-10-18` (수동 스캐폴드, 그림 1장씩) |

- 소품 2차는 첫 시도 채택. 4×2 를 반으로 자르니 슈퍼 풍선 무지개 꼬리가 아래 줄 구름 칸에 넘어가 구름이 작게 배율됨 → 두 줄 사이 가장 빈 가로줄에서 자르게 고침(`props2_repack`).
- 하늘 3장 첫 시도 채택(밤하늘은 Codex 가 한 번 더 그렸지만 1번이 구름이 더 많아 1번). 밤하늘 아래쪽에 언덕이 그려져 있어 위 62%만 쓴다(높은 하늘에 땅이 보이면 안 됨). 그림체가 부드러운 평면 채색이라 webp 손실 압축(q80) — 장당 9KB.
- 세이브 다리 비버·하수구 파이프는 데구리 `pieces/beaver-v2.webp` · `pieces/warp-pipe.webp` 를 그대로 쓴다(새 그림 없음).
