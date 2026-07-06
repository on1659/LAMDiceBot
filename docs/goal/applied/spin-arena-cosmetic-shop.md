# 스핀 아레나 꾸미기 상점 (스킨 구매·장착·업그레이드) — Goal

스핀 아레나에 꾸미기 상점을 붙인다. 사용자가 스킨을 구매/장착하고, 같은 스킨의 상위 단계로 올리는 "스킨업" 개념까지 포함한다. 브랜치는 `feature/spin-arena-rework` 계열(또는 후속 브랜치). 경마 상점 선례(서버 권위 카탈로그 + owned/equipped 검증)를 그대로 따른다.

> 전제/baseline: 칼날 탈출+부활 재설계(`docs/dev-cycle/2026-06-12-spin-arena-blade-escape-design.md`) 적용 후 진행. 리소스는 SpriteMake v2 배치(`D:\Work\vibe\SpriteMake\output\spin-arena-resource-pack-v2-20260611`)에 후보 보관 중 — **QA 통과 후 final/에 있는 것만** 게임 `assets/`로 들인다(`/spritemake-pickup`).

## 한 줄 요약

① 서버 권위 꾸미기 카탈로그(스킨 16종 기반) ② 구매/장착 + 소유 검증 ③ 스킨업(티어/업그레이드) 개념 ④ 리소스는 QA 통과분만 단계 도입

## 핵심 규칙 (번호 절)

1. **서버 권위 카탈로그**: 카탈로그(아이템 ID/가격/티어)는 서버에만 정의. 초안은 `D:\Work\vibe\SpriteMake\output\spin-arena-resource-pack-20260611\manifests\spin-arena-cosmetic-catalog.v1.json` (skins: `skin_crimson`~`skin_obsidian` 16종). 클라이언트가 보내는 아이템 ID는 항상 서버 카탈로그로 검증.
2. **구매/장착 흐름**: 경마 상점 impl(`docs/meeting/impl/2026-06-07-horse-shop-impl.md`)의 보안 선례 준수 — 인증된 사용자 ID 기준, owned 검증 후 equipped 반영. 기존 6인 기본 스킨 계열은 `defaultOwned: true`.
3. **스킨업(업그레이드)**: 같은 스킨의 상위 티어 개념. 티어 수·재화·강화 비주얼(트림/이펙트 추가 등) 세부는 막힘 기준 위임 — 단 어떤 티어든 **비주얼 전용**이다.
4. **통합 순서**(리소스 팩 결정서 5절 승계): catalog/ownership/equip 검증 코드 먼저 → 에셋 복사는 그 다음. 미검증 generated/ PNG를 게임 `assets/`에 넣지 않는다.
5. **상점 UI**: 위치(방 내부/로비)와 형태는 경마 상점 UI를 1차 참조하되 세부 위임. 모바일 우선.

## 공정성 (절대 불변)

- 결과는 서버에서만 결정, 클라는 시각화. 클라 Math.random은 deviceId/tabId 외 0회.
- **꾸미기 ID가 다음 경로에 절대 진입 금지**: 서버 시뮬 입력, collision/hitbox/ring, damage/blade count, `frames`/`escapes`/`downs`/`bladeUps`/`decideMs`, rank/winner 계산, DB winner 시맨틱.
- reveal 전 server-only 정보 비노출, 재진입 마스킹 유지.
- 통합 후 fairness grep 실행: `rg -n "skin_|outfit_|weapon_|fx_|cosmetic|equipped" socket js server.js utils` + 결과 경로 무영향 확인.

## 기존 통합 유지 (스킵 금지)

- 통계/랭킹/튜토리얼/사운드/다시보기/주문(Order)이 계속 동작.
- cosmetics on/off가 result payload와 ranking을 바꾸지 않는지 2탭으로 확인.

## 작업 방식

- 먼저 조사: `docs/meeting/impl/2026-06-07-horse-shop-impl.md`(DB 스키마·검증 흐름), `js/spin-arena.js` 스킨 틴팅 경로, `socket/spin-arena.js` reveal 페이로드, 카탈로그 초안 JSON.
- DB 테이블/스키마 변경이 필요하면 impl 문서 먼저 만들지 확인(파일 3개+ & DB 변경 = COMPLEX).
- 모바일·PC 양쪽 대응을 계획 단계부터.

## 테스트

- 2탭: A가 스킨 장착 → B 화면에 반영, 결과/순위는 양쪽 동일.
- 비소유 아이템 장착 시도(클라 조작 가정) → 서버 거부.
- 기존 대표 게임(경마) 상점 미파손 확인.
- `node -c socket/spin-arena.js server.js` 등 문법 체크.

## 완료 기준 (하나라도 미완이면 완료 아님)

- 서버 권위 카탈로그 + owned/equipped 검증 동작.
- 구매→장착→게임 화면 반영(상대에게도 보임) 동작.
- 스킨업 1단계 이상 동작(티어 수는 위임 결정에 따름).
- fairness grep + 2탭 결과 불변 확인 통과.
- update-log.md 기록. 새 리소스 여부(어떤 final/ 파일을 들였는지) 명시.
- 마지막 보고에 변경 요약·파일·테스트 명령/결과·자체 평가·남은 이슈 포함.

## 막힘 기준

- 재화(기존 포인트 재사용 vs 신규), 가격, 티어 수, 강화 비주얼 표현이 불명확하면: 경마 상점 구조 조사 후 근거와 함께 합리적으로 선택하고 보고.
- v2 리소스가 아직 QA 미통과면: 기존 6인 스킨 + 카탈로그/검증 골격만으로 1차 완성(에셋은 후속 도입 가능 구조).
- 테스트 불가 시 구현은 완료하되 어디서 막혔는지 구체 보고.

## 참고

- `docs/dev-cycle/2026-06-11-spin-arena-resource-pack-design.md` — v1/v2 에셋 경계, 통합 순서, fairness grep
- `docs/meeting/impl/2026-06-07-horse-shop-impl.md` — 상점 보안 선례
- `D:\Work\vibe\SpriteMake\output\spin-arena-resource-pack-v2-20260611\` — 리소스 후보 (REQUESTS.md, generated/)
- `.claude/rules/harness.md`, `docs/GameGuide/lessons/_common.md`
