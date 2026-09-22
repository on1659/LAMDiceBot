# SpriteMake 의뢰: 데구리 야식 7종 (marble_balloon)

작성일: 2026-09-23 · 요청자: LAMDiceBot (docs/goal/applied/marble-balloon-accessory.md) · batch `output/marble-run-balloon-yasik-2026-09-23/`
받기 경로: `assets/marble/accessories/balloon-{chicken,pizza,tteokbokki,jokbal,gimbap,burger,tangsuyuk}.png`
모델: gpt-image-2 고정.
**주의 — 동물 시트 의뢰서(9차 §3 프레임 규칙)를 따르지 않는다.** 애니 스트립이 아니라 **낱장 1프레임**이고 규격도 다르다. 아래 §계약이 전부다.

현재 저장소에 같은 이름의 임시본(PIL 도형 생성, `AutoTest/spritemake/make-balloons.py`)이 들어 있다. 이번 결과물로 **덮어쓰기만** 하면 되고 코드·카탈로그는 손대지 않는다.

## 실행 (이 문서만 보고 바로 시작할 수 있게)

> **SpriteMake 워크스페이스에서 작업한다면** 이 문서와 레퍼런스가 거기엔 없다(다른 저장소다).
> 복사본을 `/Users/radar/Work/SpriteMake/incoming/lamdice-marble-balloon-yasik-2026-09-23/` 에 두었다 —
> `BRIEF.md`(이 문서) + `references/` 2장 + `README.md`(거기서 할 일/안 할 일). 그쪽 세션은 그 폴더만 보면 된다.
> 이 문서의 §인수 절은 SpriteMake 가 아니라 **LAMDiceBot 세션**에서 실행한다.

레퍼런스 두 장이 `docs/spritemake-request/ref/` 에 있다.
- `ref/style-creatures.png` — 맞춰야 할 화풍(토끼·판다·고슴도치 서기 프레임 2배 확대). 외곽선 색·굵기, 면 그라데이션, 광택 위치를 여기서 가져온다.
- `ref/current-placeholder.png` — 교체 대상인 현재 임시본 7종(3배 확대). 실루엣 구성은 이대로 가되 그림 질을 올리는 것이 목표다.

**두 장을 배치의 `source/references/` 에 복사하고 프롬프트에서 style reference 로 지목할 것.** 텍스트 설명만으로는 화풍이 안 맞는다 — 2026-09-22 스킨 배치들도 기본 시트를 edit target, K 비교본을 style reference 로 넘겨서 맞췄다. 이번 건은 고칠 원본이 없으므로 **edit target 없이 style reference 둘만** 쓴다.

배치 생성 (SpriteMake 워크스페이스는 `/Users/radar/Work/SpriteMake`):
```bash
cd /Users/radar/Work/SpriteMake
node tools/runner/request-batch.js "<이 문서의 §7종 + §계약을 풀어 쓴 요청문>"
```
로컬 SpriteMake 서버가 떠 있어야 한다(안 떠 있으면 사용자에게 `start-symphony-gui.bat` 실행 요청). 배치 폴더와 `PROMPT.md` 경로가 응답에 나온다. 생성 시도는 `generated/`, QA·사람 검토를 통과한 것만 `final/` 로 간다.
7장을 한 배치로 묶을지 한 장씩 나눌지는 작업자 판단 — 한 장씩이 반려·재시도가 쉽다.

`/spritemake-pickup` 커맨드는 vehicle-backgrounds 기준으로 쓰여 있고 경로가 옛 Windows 표기라 **이 건에는 그대로 쓰지 말 것.** 인수 절차는 아래 §인수를 따른다.

## 쓰이는 곳

데구리(구슬 굴리기) 동물 머리 위에 **줄로 매달려 따라다니는 장식**. 동물 10종 전부에 같은 그림이 붙는다(스킨과 달리 동물을 안 가린다). 서 있을 때·구를 때·걸을 때·잠잘 때 전부 같은 낱장 한 장을 쓴다.

게임은 이걸 **가로 24 × 세로 32 화면 픽셀**로 줄여 그린다. 옆에 서는 동물이 약 40px다.
→ **판정 기준은 확대본이 아니라 24px 축소본이다.** 잔 디테일은 전부 뭉개진다. 실루엣과 색 두 가지로만 구분돼야 한다.

## 계약 (어기면 인수 거부 — 자동 검사가 있다)

| 항목 | 값 |
|------|-----|
| 캔버스 | **96 × 128 px**, 낱장 1프레임 (시트/스트립 아님) |
| 배경 | 완전 투명 |
| 알파 | **하드 에지** — 0 또는 255만. 반투명 테두리·글로우·그림자 금지 |
| 외곽선 | **`#5A3D52`**, 굵기 4px, 형태 전체를 빙 두른다 (동물 시트와 같은 색·굵기) |
| 여백 | 실루엣이 캔버스 네 변에서 **5px 이상** 떨어질 것 (붙으면 외곽선이 잘린다) |
| 매듭 | 형태 아래쪽에 **줄이 묶인 꼭지**가 있고, 그 꼭지가 좌표 **(48, 106)** 을 덮을 것 |

**매듭 (48,106) 이 가장 중요하다.** 게임이 동물 머리에서 이 점까지 줄을 그린다. 여기가 비어 있으면 줄이 허공에 매달린다. 형태마다 몸이 끝나는 높이가 달라도, 아래로 가는 **가는 목**을 붙여 이 점까지 내려오게 한다 (목 굵기 7px 정도).

줄은 그리지 말 것 — 게임이 코드로 그린다.

## 화풍

기존 동물 스프라이트(`assets/marble/creatures/*.webp`)와 같은 세계. 둥글고 통통한 카툰, 굵은 어두운 외곽선, 면은 부드러운 그라데이션, 왼쪽 위에 흰 광택 한 점. 사실적 질감·사진풍·과한 디테일 금지.

**음식 모양 호일 풍선**으로 그린다 — 실제 음식이 아니라 음식 모양으로 부푼 풍선. 그래야 줄에 매달린 게 말이 된다. 살짝 부푼 느낌 + 광택이 핵심.
(실제 음식이 매달린 쪽이 좋으면 의뢰 전에 말할 것 — 그림이 전부 달라진다.)

## 7종

임시본을 만들며 24px에서 실패한 패턴을 같이 적는다. **괄호 안이 피해야 할 함정이다.**

1. **balloon-chicken — 치킨** 닭다리. 위는 통통한 황갈색 살(튀김옷 점 서넛), 아래로 좁아지며 짧은 흰 뼈 두 혹으로 이어진다. 매듭은 뼈 끝.
   (뼈를 길게 빼면 몸과 분리된 딴 물건으로 보인다 — 살에 바짝 붙일 것)
2. **balloon-pizza — 피자** 아래로 뾰족한 삼각 한 조각. 위 가장자리에 **얇은** 크러스트 띠, 면은 노란 치즈에 붉은 페퍼로니 셋.
   (크러스트를 두껍고 넓게 그리면 버섯처럼 보인다)
3. **balloon-tteokbokki — 떡볶이** 붉은 양념을 두른 **떡 두 가락**이 어긋나게 겹친 모습. 앞 가락 윗면에 크림색 단면이 살짝, 참깨 몇 알과 대파 두 조각.
   (한 가락만 세로로 세우고 위에 크림 단면을 크게 넣으면 음료가 든 유리컵으로 읽힌다)
4. **balloon-jokbal — 족발** 짙은 적갈색 윤기 나는 살덩이, 맨 아래에 **크림색 발굽 두 개가 확실히 갈라져** 있다. 치킨과 색으로 구분되므로 살은 어둡게, 굽은 밝게.
   (굽이 안 갈라지거나 살과 같은 색이면 치킨과 구별이 안 되는 통짜 덩어리가 된다. 갈라진 골이 살까지 올라가면 다리 두 개로 보인다 — 골은 굽 높이 안에서만)
5. **balloon-gimbap — 김밥** 썰어 놓은 단면 정면. 검은 김 테두리 → 흰 밥 → 가운데 속 재료(노란 단무지, 주황 당근, 초록 시금치). 7종 중 가장 잘 읽히는 형태다.
6. **balloon-burger — 햄버거** 옆에서 본 층 구조. 참깨빵(돔은 **낮게**) / 노란 치즈가 빵보다 **옆으로 삐져나오게** / 갈색 패티 / 초록 양상추 / 아랫빵.
   (윗빵 돔을 높이면 빵만 보이고 층이 안 읽힌다. 치즈가 빵 폭 안에 들어가면 24px에서 사라진다)
7. **balloon-tangsuyuk — 탕수육** 울퉁불퉁한 튀김 덩어리에 붉은 소스가 **위에서 옆·아래로 흘러내린** 모습. 오이 초록 조각, 파인애플 노란 조각.
   (소스를 덩어리 위쪽에만 얹으면 모자 쓴 것처럼 보인다. 덩어리를 매끈하게 그리면 치킨과 실루엣이 겹친다 — 울퉁불퉁하게)

실루엣이 서로 달라야 한다: 물방울+뼈 / 삼각 / 세로 두 가락 / 두 갈래 굽 / 원 / 넓적한 층 / 울퉁불퉁한 덩어리.

## 인수

```bash
python3 AutoTest/spritemake/make-balloons.py --verify <받은폴더>
```
캔버스·알파·매듭·여백·외곽선 5항목을 검사한다. **7/7 통과해야 인수한다.**
(임시본 3장이 외곽선 잘린 채 나간 적이 있다 — 그때는 이 검사에 외곽선 항목이 없었다. 2026-09-23 추가)

통과하면 아래를 그대로 실행한다 (accessories 전용 pickup 스크립트는 없다 — `pickup-skin.py` 는 동물 시트 3장 전용이라 못 쓴다):
```bash
cd /Users/radar/Work/LAMDiceBot
SRC=<받은폴더>   # final/ PNG 7장이 있는 곳
for n in chicken pizza tteokbokki jokbal gimbap burger tangsuyuk; do
  pngquant --force --quality 65-95 --speed 1 --output /tmp/q-$n.png "$SRC/balloon-$n.png"
  cwebp -quiet -lossless -z 9 /tmp/q-$n.png -o assets/marble/accessories/balloon-$n.webp
done
python3 AutoTest/spritemake/make-balloons.py --verify assets/marble/accessories   # 변환 후 한 번 더
```
그다음:
- `assets/marble/marble-run.manifest.json` 의 `balloonsPlaceholder` 섹션을 실물 배치 정보로 교체 — 키 이름도 `balloonsPlaceholder` → `balloonsYasik` 등으로 바꾸고, `status`/`generator`/`note` 를 실제 배치로 고치고 md5 7개 갱신.
- `js/marble-render.js` 의 `ASSET_VER` 를 올린다 (`'?v=1'` → `'?v=2'`). **필수** — 파일명이 같고 `assets/marble` 은 7일 캐시라 이걸 안 올리면 기존 사용자에게 옛 그림이 계속 나간다.
- `AutoTest/spritemake/make-balloons.py` 는 지우지 말 것. `--verify` 가 앞으로도 인수 검사에 쓰이고, 임시본 재생성 이력이 남아 있어야 한다.

카탈로그(`config/marble/cosmetics.json`)·게임 코드는 수정할 것이 없다. 검증은 `node AutoTest/qa-marble-skin-shop-test.js <port>` (스프라이트 파일 존재를 확인하는 항목이 있다).

## 진행 기록
- 2026-09-23 작성. 기능·카탈로그·임시본은 `feature/marble-run` 에 커밋 872a3f2 로 들어가 테스트 서버에 올라가 있다(실서버 main 아님).
  이 의뢰는 **그림 7장만 교체**하는 건이다 — 코드·카탈로그는 이미 완성이라 손댈 것이 없다.
- 미결 1건: **음식 모양 풍선이냐 실제 음식이냐.** 지금 문서는 "음식 모양 호일 풍선" 기준으로 쓰여 있다.
  실제 음식(봉지에 담긴 치킨 등)을 원하면 §화풍·§7종을 다시 써야 하므로 **생성 시작 전에 사용자에게 확인할 것.**
