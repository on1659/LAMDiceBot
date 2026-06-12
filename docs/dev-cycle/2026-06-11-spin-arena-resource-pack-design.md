# Spin Arena 리소스 팩 + 꾸미기 상점 파이프라인 결정서

- 날짜: 2026-06-11
- 브랜치: `feature/spin-arena-rework`
- 입력:
  - `D:\Work\vibe\SpriteMake\output\spin-arena-resource-pack-20260611\GOAL_INPUT.md`
  - `C:\Users\user\.gstack\projects\on1659-LAMDiceBot\user-feature-spin-arena-resource-pack-design-20260611-220602.md`
  - `docs/goal/applied/spin-arena-juice-and-hit-feedback.md`
  - `docs/goal/spin-arena-spectator-camera-and-scaling.md`
  - `docs/meeting/impl/2026-06-07-horse-shop-impl.md`
- 검토 방식: gstack `/office-hours`는 AskUserQuestion 도구 부재로 정식 실행 불가. 기존 gstack Builder fallback 결정서를 기준 결정서로 채택하고 SpriteMake strict atlas QA로 보강.

## 0. 한 줄 결론

**Spin Arena 리소스는 `SpriteMake strict resource pack + QA gate` 방식으로 간다.**

현재 코드에 바로 영향 줄 수 있는 v1은 `players-base.png`뿐이다. 나머지 스킨/의상/무기/FX/상점 아이콘은 QA 통과 리소스 후보로 보관하되, LAMDiceBot에는 별도 manifest/loader/shop 검증이 들어간 뒤 연결한다. 모든 꾸미기 리소스는 visual-only이며 서버 시뮬, hitbox, 데미지, 칼 수, 순위, winner 저장 의미론에 절대 영향을 주지 않는다.

## 1. SpriteMake 산출물

배치 위치:

```text
D:\Work\vibe\SpriteMake\output\spin-arena-resource-pack-20260611
```

현재 산출물:

```text
generated/players-base.png
generated/players-skins-16-v1.png
generated/outfits-v1.png
generated/weapons-v1.png
generated/spin-fx-v1.png
generated/arena-floor-v1.png
generated/shop-icons-v1.png

final/players-base.png
final/players-skins-16-v1.png
final/outfits-v1.png
final/weapons-v1.png
final/spin-fx-v1.png
final/arena-floor-v1.png
final/shop-icons-v1.png
```

검수 자료:

```text
qa/spin-arena-resource-pack-qa.md
qa/spin-arena-resource-pack-qa.json
manifests/spin-arena-resource-pack.manifest.json
manifests/spin-arena-cosmetic-catalog.v1.json
tools/animation-preview.html
tools/generate_spin_arena_resources.py
```

주의: 이번 PNG는 `gpt-image-2` 산출물이 아니다. `tools/generate_spin_arena_resources.py`로 만든 로컬 procedural Pillow 리소스다. 장점은 캔버스/그리드/앵커가 정확하다는 점이고, 단점은 이미지 생성 모델 특유의 풍부한 일러스트 품질을 기대하는 자산은 아니라는 점이다.

## 2. 채택 범위

### v1: 현재 코드 즉시 호환

| Asset | Target | Contract | 판단 |
| --- | --- | --- | --- |
| `spin-character-base-v1` | `assets/spin-arena/sprites/players-base.png` | `512x128`, `4x1`, cell `128x128`, anchor `(64,64)`, source plane `y=64` | 현재 loader와 호환. 단 현재 파일과 같은 스타일의 baseline 후보라, 교체 전 visual diff 확인 필요 |

### v2: 코드/manifest/loader 필요

| Asset | Target | Contract | 필요 작업 |
| --- | --- | --- | --- |
| `spin-fx-v1` | `assets/spin-arena/fx/spin-fx-v1.png` | `512x1024`, `4x8`, cell `128x128`, anchor `(64,64)` | hit/blade-up/escape/down/revive 렌더 큐와 FX loader |
| `spin-character-skins-16-v1` | `assets/spin-arena/sprites/players-skins-16-v1.png` | `512x2048`, `4x16`, cell `128x128`, anchor `(64,64)` | 10/16명 확장 전 색+마킹 식별성 테스트 |
| `spin-outfits-v1` | `assets/spin-arena/cosmetics/outfits-v1.png` | `512x1024`, `4x8`, overlay, anchor `(64,64)` | base 캐릭터 위 overlay 합성 경로 |
| `spin-weapons-v1` | `assets/spin-arena/cosmetics/weapons-v1.png` | `512x1024`, `4x8`, hub `(64,64)`, centerline `y=64` | 칼날 procedural 렌더와 asset 렌더 중 택1 또는 shop-only preview |
| `spin-arena-floor-v1` | `assets/spin-arena/stage/arena-floor-v1.png` | `480x480`, center `(240,240)` | 기존 procedural floor 아래/대체 렌더 실험 |
| `spin-shop-icons-v1` | `assets/spin-arena/shop/shop-icons-v1.png` | `768x384`, `8x4`, cell `96x96` | shop catalog UI가 생길 때 사용 |

## 3. 카탈로그 규칙

Draft catalog:

```text
D:\Work\vibe\SpriteMake\output\spin-arena-resource-pack-20260611\manifests\spin-arena-cosmetic-catalog.v1.json
```

ID 규칙:

- skins: `skin_crimson`, `skin_azure`, ..., `skin_obsidian`
- outfits: `outfit_hoodie`, `outfit_armor`, ..., `outfit_festival`
- weapons: `weapon_standard_blade`, `weapon_crescent_blade`, ..., `weapon_comet_blade`
- effects: `fx_hit_spark`, `fx_blade_up_flash`, ..., `fx_win_burst`

초기 무료/기본 지급:

- 기존 6인 skin 계열은 `defaultOwned: true`로 둘 수 있다.
- 핵심 판독 FX(`hit_spark`, `blade_up_flash`, `escape_burst`, `down_impact`, `revive_ring`)는 유료 꾸미기보다 기본 판독 자산에 가깝다.

## 4. 불변 조건

꾸미기 ID는 다음 경로에 들어가면 안 된다.

- 서버 시뮬 입력
- collision/hitbox/ring radius
- damage, blade count, escape count
- `frames`, `escapes`, `downs`, `bladeUps`, `decideMs`
- rank/winner 계산
- DB winner 저장 의미론

horse shop precedent처럼 서버 권위 catalog + owned/equipped 검증을 쓰되, Spin Arena 결과 계산은 cosmetic state를 모르는 상태로 유지한다.

## 5. 통합 순서

1. SpriteMake final 후보를 사람이 눈으로 확인한다.
2. `players-base.png`는 현재 asset과 visual diff 후 교체 여부를 정한다.
3. FX는 `spin-fx-v1`만 별도 loader로 붙여 hit/blade-up/escape/down/revive 연출을 먼저 테스트한다.
4. 10/16명 확장 전 `players-skins-16-v1`를 모바일 48px token scale로 확인한다.
5. shop은 asset copy보다 catalog/ownership/equip validation을 먼저 만든다.
6. cosmetic integration 후에는 fairness grep을 실행한다.

권장 fairness grep:

```powershell
rg -n "skin_|outfit_|weapon_|fx_|cosmetic|equipped" socket js server.js utils
rg -n "frames|escapes|downs|bladeUps|decideMs|rank|winner|isWinner" socket js server.js utils
```

검증 게이트:

```powershell
node --check js/spin-arena.js
node --check socket/spin-arena.js
```

브라우저 QA:

- 2탭 동일 시드 replay 동기화
- desktop 6명/10명/16명 시야 확인
- mobile 48px token scale 식별성 확인
- cosmetics on/off가 result payload와 ranking을 바꾸지 않는지 확인

