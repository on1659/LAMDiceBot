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

## 3차 소품 (사용자 2026-10-18 — goal 문서 §12)

| 파일 | 칸 | 내용 | 배치 |
|---|---|---|---|
| props/beaver-hammer.webp | 96×96 × 4(아래 정렬) | 망치 든 비버 — 걷기 2 · 망치 들기 · 내려치기(세이브 다리 놓기). 데구리 `beaver-v2` 를 캐릭터 참조로 | `balloon-props3-2026-10-18` (`props3-repack`) |
| props/cloud-happy.webp | 192×128 × 2 | 하얀 웃는 구름(^ ^ 눈) — 가만 · 숨쉬기. 먹구름(`storm.webp`)과 같은 실루엣·크기라 제자리에서 바꿔 그린다 | 같음 |

- 비버: 1번은 망치 머리가 통나무만 해서 2번(작은 나무망치) 채택. 구름: 첫 시도 채택. 둘 다 `ref/` 한 장만 입력.

## 4차 소품·벽 (사용자 2026-10-18 — goal 문서 §13)

| 파일 | 칸 | 내용 | 배치 |
|---|---|---|---|
| props/mystery-box.webp | 64×64 × 2 | `?` 상자(보라·주황 나무 상자, 흰 물음표) — 가만 · 반짝. 선물 상자(`item-box`)를 화풍 참조로 | `balloon-props4-2026-10-18` (`props4-repack`, 4×1 한 장에서 칸 고르기) |
| props/weight.webp · bomb.webp | 64×64 | 쇳덩이 추(무거운 풍선) · 도화선 붙은 폭탄(깜짝 폭탄) | 같음 |
| props/rock.webp | 256×256 이음매 없는 타일 | 양옆 벽 바위 절벽 질감(둥근 사암 + 이끼). 데구리 `meadow-tile` 을 화풍 참조로, 2×2 로 이어 붙여 이음매 확인 | `balloon-wall-2026-10-18` (1번 채택, 손실 webp q85) |

- 모두 첫 시도 채택(벽은 2번도 이음매 없었지만 1번의 둥근 돌이 다른 그림과 더 맞음).
- 벽 배치는 진행 중에 Codex 작업이 꺼져(사고 — 메모리 feedback_never_pkill_short_pattern) 한 번 다시 돌렸다.

## 5차 찌르기 포즈·효과 (사용자 2026-10-19 — 남의 풍선 터트리기)

규칙(사거리·확률)은 모든 동물이 같고 그림만 다르다. 이쑤시개는 공벌레만(사용자 "이쑤시개는 한 명만, 최대한 다른 거").

| 파일 | 칸 | 내용 | 배치 |
|---|---|---|---|
| creatures/{동물}-poke.webp | **224×160** × 4 (오른쪽 향함) | 매달린 채 찌르기 — c0 슬쩍 옆눈 · c1 준비 · c2 콕(가장 멀리) · c3 거두며 뿌듯. 줄 토막 꼭대기 = 칸 **(112, 4)**(`POKE_X`). 뻗는 칸이 기준점 좌우로 ~100px 라 매달림(160)보다 넓다. 배율은 매달림과 같은 방식(서기 넓이 중앙값) | `balloon-poke-2026-10-19/{동물}` (`scaffold <c> poke`, 2번 입력 = 매달림 시트) |
| props/poke-fx.webp | 96×96 × 8 | 0 해바라기씨 · 1 물줄기(가로로 늘려 씀) · 2 물 튀김 · 3 콕 번쩍 · 4 콧김 · 5 발톱 휙 · 6 가시 번쩍 · 7 히히 반짝. 칸마다 따로 맞춤 | `balloon-props5-2026-10-19` (`props5-repack`) |

동물별 공격(`balloon-sheet.py ATTACK`): 고슴도치 가시 세우기 · 복어 뿍 부풀기 · 리본돼지 코로 툭 · 거북이 입으로 물대포 · 햄스터 해바라기씨 던지기 · 판다 대나무 · 너구리 포크 · 토끼 당근 · 아르마딜로 발톱 · 공벌레 이쑤시개 창.

- 채택: 고슴도치 2번(1번은 가시가 등 쪽으로만 섬), 나머지 1번. 거북이(3번)·햄스터(3번)·너구리(2번)는 Codex 가 더 그렸지만 1번이 가장 나음.
- 너구리는 매달림 때처럼 끈 없이 "한 팔 만세" 문구로 손으로 쓴 프롬프트 — 막힘 없음.
- 처음엔 160 칸에 넣었다가 c2 가 칸 밖으로 밀려 기준점이 어긋남(공벌레·거북이·판다·햄스터·복어) → 칸 224·기준점 112 로 넓힘.
- 공벌레 c0·거북이 c2·리본돼지 c2 는 "끈 토막이 얇지 않음(폭 13~15)" 경고 — 앞발이 꼭대기 4px 안에 들어온 것, 그림은 정상이라 `--allow-fail` 로 받음.
- 복어는 찌를 때 몸을 옆으로 돌려 끈이 입(오른쪽)에 붙는다 — 매달림보다 몸이 ~40px 왼쪽. 렌더러에서 바뀌는 순간을 볼 것.
- 스킨 69종 찌르기: 도구 28종(`recolor|remap|pixelate <c> <skin> poke` — 도트는 224 칸을 240 정사각으로 패딩해 바꾼 뒤 잘라 냄) + 옷 입히기 41종(`scaffold-skin <c> <skin> poke`, Codex 6개 병렬 ~50분). ribbonpig-red 는 `skin-kind` 가 recolor 라 해도 머리 위 불꽃 때문에 옷 입히기.
  - 너구리 스킨 5종은 프롬프트의 "string stub" 문구를 "한 팔 만세 · 포크로 콕" 으로 바꿔 돌림 — 막힘 없음.
  - 채택: 판다 말랑 2번(1번에 원래 없는 갈색 무늬), 리본돼지 앵그리·셰프·아이언·파일럿·스카프·저팔계·레드 2번(1번은 앞발을 안 들고 누운 자세 — 기본 돼지 찌르기와 다름), 나머지 1번. GPT 가 끈 토막을 빼먹은 칸은 그림 꼭대기(앞발)가 기준점이라 그대로 받음.

## 6차 단독판 스킨 11종 × 4포즈 (2026-10-19 — cd382672 에 들어온 데구리 스킨)

대상: armadillo-finshell(상어딜로) · armadillo-mummy(미라딜로) · hamster-hoppang(호빵햄) · hedgehog-meringue(머랭도치) · hedgehog-sharkhood(부캉도치) · pillbug-goguma(고구마공) · pufferfish-bukang(부캉복) · pufferfish-lantern(유등복) · rabbit-butter(버터토끼) · rabbit-maple(단풍토끼) · turtle-chococrack(초코부기). `skin-kind` 가 11종 모두 dress → `scaffold-skin <c> <skin> <kind> 2026-10-19` 44배치(`balloon-{hang,blow,fall,poke}-2026-10-19/<look>/`), Codex 6개 병렬 ~1시간.

- 채택: 상어딜로 blow·poke 2번(1번은 꼭지가 칸 경계를 넘음 / 끈 쥔 앞발이 빠짐), 고구마공 hang·poke 2번 · 버터토끼 poke 2번 · 단풍토끼 poke 2번(1번은 끈 쥔 앞발이 빠짐), 부캉복 fall 2번(1번은 노란 기본 복어 그대로), 호빵햄 poke 3번(1·2번은 끈 쥔 앞발이 빠짐), 유등복 blow 1번(Codex 가 "기본보다 덜 기울었다"고 3번까지 그렸지만 유등 스킨은 원래 둥글게 서 있어 1번이 가장 깔끔), 나머지 첫 시도.
- 확인: 스킨 서기 4칸 | 기본 포즈 | 스킨 포즈를 줄마다 놓고 확대해 봄 — 호빵 꼬다리·딸기·상어 후드·고구마 김·유등 술·버터·단풍잎·초코 금이 모든 칸에 있음, 고구마공 다리 회청색은 스킨 서기 그대로. 끈 토막 경고(c0 폭 13~32)는 앞발이 꼭대기에 닿은 것 — 참고만.
- 렌더러는 파일 이름으로 찾기만 해서(`poseSheet`) 코드·`ASSET_VER` 변경 없음(새 파일이라 캐시 무관).

## 7차 안 열리는 들보 (사용자 2026-10-19 "길만 막는 나무 발판이 뭔지 모르겠다 — 절대 안 움직이는 느낌으로")

| 파일 | 칸 | 내용 | 배치 |
|---|---|---|---|
| props/beam.webp | 256×72 × 4줄 | 쇠띠·리벳·양 끝 쇠 걸쇠로 박힌 두꺼운 원목 — r0 멀쩡 · r1 금 · r2 크게 갈라짐 · r3 두 동강(줄 = HP 단계). 양 끝 걸쇠 36px 는 그대로, 가운데 나무만 늘려 들보 길이에 맞춘다(나무 윗선 17·아랫선 55) | `balloon-props6-2026-10-19` (`props6-repack`, 2번 입력 = 여닫이 판 plank 로 "이것과 다르게") |

- 1번 채택(2번도 좋았지만 1번이 금 가는 단계가 더 또렷). 옛 들보(데구리 start-platform-mid)는 출발 계단·세이브 다리에 그대로 쓴다.
