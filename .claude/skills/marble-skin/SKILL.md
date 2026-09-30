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
| 등급·가격 | rare 50 · epic 100 · legend 150 (카탈로그 `rarity` 는 `rare`/`epic`/`legend`) |
| 방식 | 색만 바뀌면 **리컬러**(레어 기본, 토큰 0). 의상·변신이면 **GPT 생성** |
| 분업 | GPT 는 그림 생성만. 자르기·리팩·보정·판정은 Claude |
| 기존 스킨 | 카탈로그를 먼저 읽어 같은 동물의 기존 스킨과 겹치지 않게 |

- 디자인이 사용자 결정 사항이면(이름·등급 미지정 등) 짧게 확정하고 진행. 이름은 사용자가 쓴 표기를 따르되 오타 같으면 한 줄로 확인.
- 실제 게임·캐릭터를 참고하라고 하면 **원화를 이미지 입력으로 넣지 말고 말로만** 특징을 설명한다(베낀 그림 방지).
- 공은 늘 **원형**이어야 한다(링 반지름 60 소스 px). 의상 설명에 "공 칸에선 소품을 빼 공이 둥글게"를 넣는다.

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
   /opt/homebrew/bin/python3 AutoTest/spritemake/scaffold-skin-batch.py <creature> <skin> "<costume EN>" "<ball note EN>" [YYYY-MM-DD]
   ```
   - 템플릿이 없는 동물이면 스크립트의 `TEMPLATE`(그 동물의 기존 **생성** 스킨 배치 — `ls /Users/radar/Work/SpriteMake/output | grep marble-run-skin-<creature>`)와 `ROWS`(칸 순서 문장 — 그 배치의 prompts/ 참고)를 추가한다. 없으면 기본 동물 배치(`marble-run-creatures-*`)의 도구를 쓰되 칸 규칙(r3c0 공 여부)을 확인.
3. **Codex 병렬 실행** — 스캐폴드가 출력한 `run:` 명령을 스킨마다 `( ... ) &` 로 묶고 `wait`, **run_in_background + 샌드박스 해제**. 시트 3장에 10~40분. 완료 알림을 기다린다(폴링 금지).
4. **원본 직접 판정** — Codex 의 선택·불합격 사유를 믿지 말 것. 투명 배경은 좋은 것(Codex 가 "검은 배경"으로 오판), 배경 톤 편차도 무관(리팩 Δ60 flood).
   - attempt 전부를 한 장에 붙여(PIL, 투명은 회색 바탕) 보고 고른다: 칸 수·순서, 오른쪽 향함, 모든 칸 의상, 공 칸이 공인지·둥근지, 진흙·별 위성, 이웃 칸 번짐, 테두리 번짐(어두운 halo).
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
7. **인수**:
   ```bash
   /opt/homebrew/bin/python3 AutoTest/spritemake/pickup-skin.py <batch> <sheet> skin<Creature><Skin> "<note: 채택 attempt·예외·보정>" docs/spritemake-request/applied/<date>-marble-skin-<topic>.md
   ```
   pngquant `--nofs` + 알파 마스크 불변 확인, 배치 QA 불합격이면 거부한다(오탐만 `--allow-fail`). 기존 파일 덮어쓰기 거부 — 같은 이름 교체는 옛 파일을 먼저 치우고 **`js/marble-render.js` ASSET_VER 을 올린다**(assets 7일 캐시).

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
{"id": "marble_skin_<creature>_<skin>", "name": "<이름>", "displayName": "<이름>", "rarity": "rare|epic|legend", "emoji": "<이모지 1개>", "price": 50|100|150, "creature": "<creature>", "skin": "<skin>", "desc": "<평이한 한국어 한두 문장>. <동물>를 고르면 적용돼요."}
```

- 상점·뽑기는 카탈로그에서 자동으로 뽑는다(코드 수정 없음). 뽑기 등급은 `rarity`.
- 데구리 상점은 `js/marble-shop.js` `coinShopOpen: true` 로 **실서버에서 열려 있다**(공통 `COIN_SHOP_COMING_SOON` 은 다른 게임만 닫음).

## 4. 동작 확인

1. 카탈로그 → 시트 존재: `node -e` 로 `marble_skin` 의 creature/skin 마다 webp 3장 존재 확인.
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
