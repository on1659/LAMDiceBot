---
name: marble-skin
description: 데구리(marble) 동물 스킨 추가 — 디자인 확정 → 리컬러 또는 GPT(Codex exec) 생성 → 원본 직접 판정 → 리팩·검증(공 원형 포함) → 인수 → 카탈로그 → 테스트 → 커밋. "스킨 추가", "~ 스킨 만들어줘", "레어/에픽/전설 스킨" 요청에 쓴다.
user-invocable: true
---

# /marble-skin — 데구리 동물 스킨 추가

입력: `$ARGUMENTS` = 어떤 동물에 어떤 스킨을 몇 개(등급·컨셉). 비어 있으면 동물과 컨셉을 한 줄로 묻는다.

2026-09-29~30 수영복 6종·돼지 3종을 만들며 굳힌 절차다. 도구는 전부 `AutoTest/spritemake/`, 파이썬은 **`/opt/homebrew/bin/python3`**(시스템 python3 엔 PIL 없음).
SpriteMake 배치 폴더 쓰기·Codex 실행은 **샌드박스 해제**가 필요하다.

## 0. 규칙 (먼저 읽기)

| 항목 | 값 |
|---|---|
| 동물 id | hedgehog armadillo pillbug turtle panda hamster pufferfish raccoon rabbit **ribbonpig(=돼지)** |
| 시트 이름 | `{creature}-{skin}` (+ `-sleep`, `-scuffle`) → `assets/marble/creatures/*.webp` |
| 카탈로그 id | `marble_skin_{creature}_{skin}` (`config/marble/cosmetics.json` 의 `marble_skin` 배열 끝에) |
| 등급·가격 | common 30 · rare 50 · epic 100 · legend 150 (카탈로그 `rarity` 는 `common`/`rare`/`epic`/`legend`). 매기는 법은 아래 **등급 기준** |
| 이름 | `name` = 상점 카드(동물 이름 빼고 짧게: "닌자"), `displayName` = 게임 안 글자(비석·뽑기 결과·전설 공지, 동물 이름 포함: "닌자 너구리"). 다른 동물과 겹치면 `name` 에도 동물 이름을 둔다("황금 돼지") |
| 테마 | 세트로 만드는 스킨은 `"theme": "수영복"` 처럼 **테마 이름 글자를 그대로** 적는다(지금: 수영복 · 5090). 같은 글자를 쓴 스킨끼리 상점 [테마] 칩 하나로 묶이고, 처음 쓰는 글자면 칩이 새로 생긴다 — 따로 등록할 곳 없음. 칩 순서는 최근에 추가된 테마 먼저, 칩 아이콘은 그 테마의 첫 스킨. 세트가 아닌 단발 스킨은 `theme` 을 넣지 않는다 |
| 방식 | 색만 바뀌면 **리컬러**(토큰 0) — 단, 색만 바꾼 건 밋밋하다는 피드백(2026-09-30 레드 돼지)이라 레어도 리컬러 + 작은 특징(`--ref` 덧그리기)을 먼저 제안. 의상·변신이면 **GPT 생성** |
| 분업 | GPT 는 그림 생성만. 자르기·리팩·보정·판정은 Codex |
| 기존 스킨 | 카탈로그를 먼저 읽어 같은 동물의 기존 스킨과 겹치지 않게 |

- 디자인이 사용자 결정 사항이면(이름·등급 미지정 등) 짧게 확정하고 진행. 이름은 사용자가 쓴 표기를 따르되 오타 같으면 한 줄로 확인.
- 실제 게임·캐릭터를 참고하라고 하면 **원화를 이미지 입력으로 넣지 말고 말로만** 특징을 설명한다(베낀 그림 방지).
- 공은 늘 **원형**이어야 한다(링 반지름 60 소스 px). 의상 설명에 "공 칸에선 소품을 빼 공이 둥글게"를 넣는다.

### 등급 기준 (사용자 2026-10-04)

"레어는 단순 이미지 변경, 에픽은 뭔가 좀 더 달라야 하고, 전설은 보자마자 멋져야 한다." 컨셉이 재밌는지가 아니라 **얼마나 새로 그렸는지**로 매긴다. 조건을 채우는 가장 높은 등급을 준다.

| 등급 | 기준 | 예 |
|---|---|---|
| common 30 | 색만 바꿈. 새로 그린 선이 없다(1-A 리컬러 그대로) | 벚꽃 고슴도치, 파란 복어 |
| rare 50 | 색·무늬 + 작은 장식 1~2개. 장식을 가리면 색 다른 기본 동물 | 고추장불고기, 쿠키 햄스터, 닌자 너구리, 기사 고슴도치 |
| epic 100 | 새로 그린 것이 3개 이상 / 몸통을 다 덮는 옷 / 몸만 한 소품 — 셋 중 하나 | 알로하 너구리, 튜브 너구리, 강철 돼지 |
| legend 150 | epic 조건 + 셋 중 둘: 자세·표정·몸 구조가 기본과 다름 · 몸 전체가 새 그림 · 공이 됐을 때 볼거리 | 빨간 마후라, 5090, 꿀곰 |

- 무늬만 바꾼 것(수박·쿠키·무지개)은 공이 그 물건으로 보여도 rare.
- 스킨을 제안할 때 등급 옆에 근거 한 줄을 적는다("무늬 + 꽃 하나", "옷·모자·보따리 세 개").

## 1-A. 리컬러 (색만 바뀌는 스킨)

```bash
/opt/homebrew/bin/python3 AutoTest/spritemake/recolor-creature.py analyze <creature>     # 몸 색 hue·sat·val 분포
# PRESETS[<creature>][<skin>] 추가 (기존 프리셋 형식 그대로 — 보호 규칙 먼저, 바꿀 규칙 뒤)
/opt/homebrew/bin/python3 AutoTest/spritemake/recolor-creature.py make <creature> <skin>  # webp 3장 바로 생성(알파 100% 동일 assert)
/opt/homebrew/bin/python3 AutoTest/spritemake/recolor-creature.py compare <creature> <skin> <scratch>/cmp.png
```

- **진흙 얼룩·발굽·흰 하이라이트·노란 마크·볼터치**가 같이 물들지 않았는지 공 칸(r2c2 진흙)까지 눈으로 본다. 물들었으면 그 색을 샘플링해(PIL + colorsys) 보호 규칙을 추가.
- 리컬러 스킨은 manifest 섹션이 없다(기존 관례). 끝나면 3단계로.

## 1-B. GPT 생성 (의상·변신)

1. **토큰 확인**: 메모리 feedback_no_gpt_image_tokens.md — 토큰 없다고 한 뒤 다시 들어왔다는 말이 없으면 사용자에게 확인.
2. **스캐폴드** (스킨마다):
   ```bash
   /opt/homebrew/bin/python3 AutoTest/spritemake/scaffold-skin-batch.py <creature> <skin> "<costume EN>" "<ball note EN>" [YYYY-MM-DD] [--ref=<기존 시트>]
   ```
   - 브리프는 **main 을 먼저 고르고, sleep·scuffle 은 그 main 을 두 번째 입력 그림으로** 넣어 의상을 똑같이 그리게 한다(강철 돼지: 따로 그렸더니 세 시트 갑옷이 제각각).
   - `--ref=<시트>`: 기존 스킨 위에 덧그리기(예: 리컬러 `ribbonpig-red` 에 불꽃 추가). 같은 시트 이름을 교체하게 되면 7단계 주의.
   - 템플릿이 없는 동물이면 스크립트의 `TEMPLATE`(그 동물의 기존 **생성** 스킨 배치 — `ls /Users/radar/Work/SpriteMake/output | grep marble-run-skin-<creature>`)와 `ROWS`(칸 순서 문장 — 그 배치의 prompts/ 참고)를 추가한다. 없으면 기본 동물 배치(`marble-run-creatures-*`)의 도구를 쓰되 칸 규칙(r3c0 공 여부)을 확인.
3. **Codex 병렬 실행** — 스캐폴드가 출력한 `run:` 명령을 스킨마다 `( ... ) &` 로 묶고 `wait`, **run_in_background + 샌드박스 해제**. 시트 3장에 10~40분. 완료 알림을 기다린다(폴링 금지).
4. **원본 직접 판정** — Codex 의 선택·불합격 사유를 믿지 말 것. 투명 배경은 좋은 것(Codex 가 "검은 배경"으로 오판), 배경 톤 편차도 무관(리팩 Δ60 flood).
   - attempt 전부를 한 장에 붙여(PIL, 투명은 회색 바탕) 보고 고른다: 칸 수·순서, 오른쪽 향함, 모든 칸 의상, 공 칸이 공인지·둥근지, 진흙·별 위성, 이웃 칸 번짐, 테두리 번짐(어두운 halo).
   - **시트 간 의상 일관성**: main 첫 줄 · sleep · scuffle 첫 줄을 한 장에 세로로 붙여 같은 옷인지 본다(모양·부품·색). 다르면 그 시트만 main 완성본을 두 번째 입력으로 다시 그린다(강철 돼지 v2 브리프 형식: 배치의 `CODEX-BRIEF-v2.md`).
   - 고른 것으로 `source/SOURCES.json` 을 다시 쓴다(Codex 것은 `SOURCES.codex.json` 으로 보관).
5. **리팩·QA** (배치 폴더에서):
   ```bash
   node tools/creatures_skin_png.js repack && node tools/creatures_skin_png.js qa     # PASS / FRAGMENT-RUNS PASS / RIM PASS
   ```
   | 실패 | 대응 |
   |---|---|
   | `body would clip: rXcY` | 기준 칸이 아닌 칸은 스캐폴드가 이미 안전 축소(156×148). 기준 칸이면 그 시트의 cap 조정 검토 |
   | 소품(쇠스랑 등) 때문에 서 있는 몸이 기본보다 작음 | `verify-creature.py` 의 proportions `stand` 를 기본 시트와 비교 → 그 배치 tool 의 `const cap=main?[134,130]` 폭만 넓혀 같은 키로(저팔계 148) |
   | `haloPixels` > 0 | 분홍·자홍 의상이면 오탐(알로하 꽃). 눈으로 확인 후 인수 때 `--allow-fail=<assetId>` |
   | 이미지 문제(칸 누락·번짐) | 다른 attempt 로, 없으면 Codex `resume` 으로 그 시트만 재생성 |
6. **완성본 복사 + 독립 검증**:
   ```bash
   cp generated/<sheet>-main-candidate-unverified.png final/creatures/<sheet>.png   # -sleep, -scuffle 도
   /opt/homebrew/bin/python3 AutoTest/spritemake/verify-creature.py <batch>/final/creatures <sheet>
   /opt/homebrew/bin/python3 AutoTest/spritemake/ball-round.py check <batch>/final/creatures/<sheet>.png
   ```
   - verify FAIL 중 **기본 동물 시트에도 똑같이 있는 것**(돼지 r3c2 136, 판다 r0c2 '!' 마크, 위성 y-run)은 허용 — 기본 시트도 같은 스크립트로 돌려 비교.
   - `ROUND_FAIL` 이면: `ball-round.py fix <candidate> <candidate>` → **배치 qa 재실행**(md5 갱신 + 부스러기 검사) → final 로 다시 복사 → check 재확인.
     - 공 위·왼쪽에 소품(불꽃·모자 장식)이 튀어나와 몸통이 작고 치우친 경우엔 `fix ... --recenter`(소품 없는 오른쪽·아래 가장자리에 원을 맞춰 몸통 지름 112·중심 80,80, 소품은 링 밖). 이때 배치 QA `ballGeometry` 불합격은 의도된 예외 → 인수 때 `--allow-fail=<sheet>-main`.
     - 한두 픽셀짜리 halo(알파 한 자릿수 가장자리)는 그 픽셀만 지우고 qa 재실행.
7. **인수**:
   ```bash
   /opt/homebrew/bin/python3 AutoTest/spritemake/pickup-skin.py <batch> <sheet> skin<Creature><Skin> "<note: 채택 attempt·예외·보정>" docs/spritemake-request/applied/<date>-marble-skin-<topic>.md
   ```
   pngquant `--nofs` + 알파 마스크 불변 확인, 배치 QA 불합격이면 거부한다(오탐만 `--allow-fail`). 기존 파일 덮어쓰기 거부 — 같은 이름 교체는 옛 파일을 먼저 치우고 **`js/marble-render.js` ASSET_VER 을 올린다**(assets 7일 캐시).

## 1-C. 걷기 시트 (네 번째 시트 — 2026-10-02 부터 필수)

동물은 걸을 때 `{sheet}-walk.webp`(4×1: 디딤 A · 넘김 A · 디딤 B · 넘김 B)를 쓴다. 없으면 서기 두 칸으로 걷는다(옷은 유지되지만 어색하다). 도구는 `AutoTest/spritemake/walk-sheet.py` 하나.

| 스킨 종류 | 명령 |
|---|---|
| 리컬러(1-A) | `walk-sheet.py recolor <creature> <skin>` — 기본 동물 걷기 시트에 같은 프리셋 |
| 도트(pixelate) | `walk-sheet.py pixelate <creature> <skin>` |
| GPT 생성(1-B) | `walk-sheet.py scaffold <sheet>` → 출력된 `run:` 명령(Codex, 샌드박스 해제·백그라운드) → `repack <sheet> <attempt>` → 눈으로 판정 → `pickup <sheet>` |

- 스킨은 **기본 동물의 걷기 시트를 첫 입력, 스킨 main 시트를 둘째 입력**으로 옷만 입힌다(자세는 그대로). main 3장을 인수한 뒤에 돌린다.
- 리팩이 몸 넓이·발바닥선(150)·윗몸 중심을 스킨 main 시트의 서기 칸에 맞춘다. `OK` 가 나와도 시도 전부를 서기 칸과 나란히 놓고 본다: 네 칸이 다 다른 걸음인지, 옷이 칸마다 같은지, 오른쪽을 보는지, 크기가 서기와 같은지.
- 소품이 큰 스킨(쇠스랑·튜브)은 넓이 기준 배율 때문에 몸이 작아질 수 있다 — 서기 칸과 머리 크기를 비교하고, 작으면 `repack` 뒤 수치(`area`)를 보고 소품을 뺀 몸 기준으로 다시 맞춘다.
- **걸음이 진짜 번갈아 나오는지 본다(2026-10-02 사고)**: 첫 판에서 고슴도치는 "서기 / 발차기" 2장을 두 번, 판다는 같은 다리만 반복해 그렸는데 전부 `OK` 로 통과했다. 이제 `verify` 가 다리 구역(몸 아래 35%)에서 디딤 A·B, 넘김 A·B 가 각각 20% 이상 다른지 잰다(`same legs twice`). 수치가 통과해도 4칸을 크게 확대해 "벌림 → 한 발 듦 → 반대로 벌림 → 다른 발 듦" 인지 눈으로 확인한다. 스킨은 의상을 다시 그리며 생긴 잡음으로 수치만 통과하는 일이 있다(판다 스킨들).
- 다리가 같은 색(판다: 둘 다 검정)이면 A·B 를 다리로 가를 수 없다 → 팔 흔들림과 다리 겹침(먼 발은 반쯤 가려지게)으로 가르라고 의뢰문에 쓴다.
- 깡충 뛰는 동물(토끼 — `GAIT_HOP`)은 4칸이 한 번 뜀(웅크림 · 박차기 · 공중 · 착지)이고 몸이 늘 낮고 수평이어야 한다. "두 번 뛰되 다른 자세로"라고 의뢰하면 엎드린 자세와 선 자세가 섞인다. 렌더러 쪽 목록은 `js/marble-render.js` `HOP_GAIT`.
- 새 **기본 동물**이면 `walk-sheet.py` 의 `BASES`·`FRAMES`(걸음 설명: 두 발 / 네 발 / 그 동물만의 이동)에 먼저 추가한다.

## 2. 인수 뒤 최종 검증 (게임 파일 기준)

```bash
# webp 를 풀어 다시 검증 — 양자화에서 생긴 문제는 여기서만 잡힌다
for k in "" -sleep -scuffle; do dwebp -quiet assets/marble/creatures/<sheet>$k.webp -o <scratch>/<sheet>$k.png; done
/opt/homebrew/bin/python3 AutoTest/spritemake/verify-creature.py <scratch> <sheet>
/opt/homebrew/bin/python3 AutoTest/spritemake/ball-round.py check assets/marble/creatures/<sheet>.webp
```

## 3. 카탈로그

`config/marble/cosmetics.json` `marble_skin` 배열 끝에 (한 줄 한 항목, 기존 형식 그대로):

```json
{"id": "marble_skin_<creature>_<skin>", "name": "<짧은 이름>", "displayName": "<동물 이름 포함 이름>", "rarity": "common|rare|epic|legend", "emoji": "<이모지 1개>", "price": 30|50|100|150, "creature": "<creature>", "skin": "<skin>", "theme": "<테마 이름 — 세트일 때만>", "desc": "<평이한 한국어 한두 문장>. <동물>를 고르면 적용돼요."}
```

- 상점·뽑기는 카탈로그에서 자동으로 뽑는다(코드 수정 없음). 뽑기 등급은 `rarity`.
- 데구리 상점은 `js/marble-shop.js` `coinShopOpen: true` 로 **실서버에서 열려 있다**(공통 `COIN_SHOP_COMING_SOON` 은 다른 게임만 닫음).

## 4. 동작 확인

1. 카탈로그 → 시트 존재: `node -e` 로 `marble_skin` 의 creature/skin 마다 webp 4장(기본·`-sleep`·`-scuffle`·`-walk`) 존재 확인.
2. **서버 재시작 필요**(카탈로그는 `socket/marble.js` 가 시작 때 require) — preview_start `dev-5174` 로 새로 띄우고
   `node AutoTest/qa-marble-skin-shop-test.js 5174` → `✅ ALL PASS`.
3. 렌더러: `http://localhost:5174/game-lab/marble-preview.html` 에서 `data.balls` 의 creature/skin 을 바꿔 `R.setTimeline` → `R.render` 여러 번(카메라 안정) → 구르는 공 주변을 잘라 확대해 **링 안이 차는지**, network 에서 새 시트 `200` 확인.
4. 쇼케이스(시트 3장 + 28px 공) 한 장을 만들어 SendUserFile 로 사용자에게 보인다.

## 5. 커밋·배포

- 의뢰서: `docs/spritemake-request/applied/<date>-marble-skin-<topic>.md` (디자인 표 + 진행 기록: 채택 attempt, 예외, 보정).
- 커밋: 스킨(에셋·manifest·카탈로그·프리셋·의뢰서) 한 커밋, 한국어 메시지 + Co-Authored-By.
- `feature/marble-run` 푸시 = 테스트 서버(lamtest) 자동 배포. **main(실서버)은 사용자가 말할 때만.**
  main 에 넣을 땐 `git log origin/main..origin/feature/marble-run` 으로 **내 커밋 말고 main 미반영 커밋**(예: 확정 보류 목업)이 있는지 보고, 있으면 origin/main 에서 worktree 를 떠 내 커밋만 cherry-pick → `git push origin HEAD:main` → `curl` 로 실서버에 새 webp·카탈로그가 뜨는지 확인.
- 에셋만 바뀐 커밋은 실서버 배포가 SKIP 된다(Railway watchPatterns `!assets/**`) — 카탈로그(config/)가 같이 바뀌므로 보통 문제 없음.

## 함정 모음 (실제로 겪은 것)

- Codex 는 투명 배경을 "검은 배경"으로, 배경 톤 편차를 "그라데이션"으로 오판해 3번씩 다시 그렸다(토큰 낭비) → 스캐폴드 브리프가 금지함.
- pngquant 기본 디더링이 거의 투명한 픽셀을 불투명으로 만들어 발바닥선 151·공 복제 칸 불일치 → `--nofs`(pickup-skin.py 반영됨).
- 너구리 공은 타원(120×106)이라 구를 때 링 안에 틈 → `ball-round.py` (세로 늘림). 저팔계는 모자까지 112 로 맞춰져 공이 작음 → 같은 도구가 균등 확대.
- 보정 뒤 4px 부스러기가 남으면 배치 QA 불합격 — 보정 후엔 반드시 배치 qa 재실행.
- 리컬러가 진흙 얼룩까지 물들임 → 진흙 색 보호 규칙.
- 시트 3장을 따로 그리면 의상이 제각각(강철 돼지: 투구 두건 / 아르마딜로 판 / 어깨 견갑) → main 을 두 번째 입력으로.
- 레어라도 "색만 바뀐 것"은 밋밋하다는 피드백(레드 돼지) → 리컬러 위에 작은 특징(불꽃 꼬리 등)을 `--ref` 로 덧그리는 걸 기본 제안으로.
