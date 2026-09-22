# 이미지 에셋 최적화

`assets/` 에 이미지를 **추가하거나 교체할 때는 커밋 전에 반드시 최적화**한다.
SpriteMake·생성 도구가 뱉는 PNG 는 8-bit RGBA 무손실 원본이라 필요 크기의 3~5배다.
express.static 은 `max-age=0` 이라 재방문도 매번 재검증 요청이 나가고, 데구리처럼
시트를 일괄 로드하는 게임은 첫 진입에서 폴더 전체를 받는다.

> 2026-09-22 데구리: 137장 22MB → 7.2MB (67%↓). 화질 차이 없음. 그 전까진 아무 최적화도 없었다.

## 규칙

| 이미지 종류 | 방법 | 기대 절감 |
|------------|------|----------|
| 알파 있는 스프라이트/시트/아틀라스 (대부분) | `pngquant` 256색 팔레트 | 60~75% |
| 데구리 시트 전부 (`assets/marble/**`, ramp.png 제외) | pngquant → `cwebp -lossless -z 9` (**.webp**, 픽셀 동일) | pngquant 대비 −20% 추가 |
| 알파 없는 큰 배경 (RGB, 1000px 이상) | WebP 손실 `q 92` | 85~95% |
| 이미 팔레트 PNG (`file` 이 `8-bit colormap`) | 손댈 것 없음 | — |
| OG 이미지 | JPEG 그대로 | — |

- **pngquant 는 파일명·확장자를 유지**하므로 코드 변경이 없다. WebP 는 경로가 바뀌니 참조하는 JS/CSS 와 `?v=` 캐시 버전을 같이 올린다.
- 파일 하나가 **200KB 를 넘으면** 최적화 안 된 것으로 의심한다 (시트 640×800 RGBA 원본 ≈ 400~600KB → 팔레트 ≈ 130~200KB).
- 색이 많은 그라데(무지개·이펙트)는 `--quality 80-100` 이 실패(exit 99)한다. `60-100` 으로 내려도 2~3배 확대해서 차이가 안 보이면 채택.
- 색 프로파일(gAMA/iCCP) 없는 파일만 `--strip`. 있으면 브라우저 색이 바뀔 수 있으니 chunk 를 먼저 확인.

## 도구

```bash
brew install pngquant webp
```

```bash
# 스프라이트/시트 — 제자리 덮어쓰기 (품질 하한 못 맞추면 exit 99, 원본 유지)
pngquant --quality 80-100 --speed 1 --strip --force --ext .png assets/{game}/**/*.png

# 알파 없는 배경 — WebP
cwebp -q 92 -m 6 in.png -o out.webp
```

## 검증 (커밋 전)

1. 크기 — `du -sh assets/{game}` 전/후, 개별 파일 200KB 초과 목록.
2. 화질 — 원본과 결과를 2~3배 확대해 나란히 놓고 본다. 수치는 "RGB 평균 diff ≤ 5/255, alpha 0↔비0 뒤집힌 픽셀이 수십 이하" 면 안전.
3. **알파 임계값을 읽는 코드** — 데구리 `standHeight` 는 시트 row0 의 `alpha ≥ 8` 최상단 행을 잰다. 양자화가 반투명 가장자리를 바꿀 수 있으니 이런 판정이 있는 시트는 전/후 결과가 같은지 확인.
4. 타일링 배경(seamless) — 손실 압축 후 좌우/상하 끝 열 차이가 원본과 같은 수준인지 (WebP q92 에서 `meadow-tile` 은 동일했다).
5. 브라우저 — 로컬 서버에서 해당 게임 페이지 로드, `performance.getEntriesByType('resource')` 로 404 없음 + 총량 확인.

## 데구리 에셋 캐시 (`?v=`)

`routes/api.js` 가 `assets/marble/**` 에 `Cache-Control: public, max-age=7일` 을 준다(다른 경로는 기본 `max-age=0` 재검증).
그래서 데구리 에셋 URL 은 `js/marble-render.js` 의 `ASSET_VER`(`?v=N`) 이 붙는다. **같은 이름으로 파일을 교체하면 `ASSET_VER` 을 올려라** —
안 올리면 최대 7일 옛 그림. 새 이름 추가는 올릴 필요 없음. `pickup-skin.py` 가 끝날 때 이걸 상기시킨다.

## 배포 주의

Railway `watchPatterns` = `["**", "!assets/**", "!docs/**"]`. **에셋만 바뀐 커밋은 배포가 SKIPPED** 된다.
JS/HTML 이 같이 바뀌지 않으면 `summit-log.txt` 에 한 줄 넣어 트리거하고, 배포 후
`curl -sI https://lamdice.com/assets/.../x.png | grep content-length` 로 로컬 크기와 대조한다.

## 현황 (2026-09-22)

| 경로 | 상태 |
|------|------|
| `assets/marble/**` | 완료 — 전부 pngquant→WebP 무손실(스킨 45장은 필요할 때만 로드 `ensureSkin`), 배경 2장 WebP q92, 미도착 자리표시 4개(gravestone·gap-mark·lane-dirt·suck-swirl) ASSETS 에서 제거, 7일 캐시+`?v=`. 진입 시 약 2.9MB/91요청. `pieces/ramp.png` 는 미참조(삭제 후보) |
| `assets/ui/icons.png` | 완료 — pngquant 1.18MB → 309KB (`?v=2`, 셀 128px 를 15~40px 로 쓰니 차이 없음) |
| `assets/bridge-cross/**` 6.2MB | **미완** — `background-void-v2.png` 1.8MB (RGB → WebP 126KB), players 7장(각 ~420KB → ~165KB)·glass-fx·stage |
| `assets/cosmetics/aura-atlas.png` 830KB | **미완** — pngquant 60-100 시 236KB (반투명 글로우라 확대 검증 필요) |
| `assets/backgrounds/*.png` | 차량 스트립 15장은 작음(10~34KB). `forest/space/road/beach/sky.png` 1.3MB 는 코드 참조 없음(삭제 후보) |
| `assets/og/*.jpg` | 완료 (25~40KB) |

새 시트를 `/spritemake-pickup` 으로 받으면 그 시트도 이 절차를 거친다. 데구리 시트는 `AutoTest/spritemake/pickup-skin.py` 가 pngquant→WebP 를 자동으로 한다(리컬러 `recolor-creature.py` 도 .webp 입출력).
