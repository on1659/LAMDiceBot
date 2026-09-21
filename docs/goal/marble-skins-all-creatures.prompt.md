# /autogoal 프롬프트 — 데구리 동물 10종 스킨 1~2개씩 + 상점 등록 + 코인 경제 조정 (무인 야간 작업)

> 새 세션에서 `/autogoal` 뒤에 이 파일 내용을 그대로 붙여 넣는다. 사용자는 자러 간다 — **질문 금지, 아래 기본값으로 결정하고 끝까지 간다.** 미결 사항은 summit-log 에 적어 두면 아침에 본다.

---

/autogoal 데구리(마블런) 동물 10종 전부에 상점 스킨을 1~2개씩 만들어 적용하고, 코인 경제를 조정한 뒤 `/summit` 으로 커밋·푸시까지 끝내라. main 병합은 하지 않는다(feature/marble-run 만). 사용자는 자는 중 — AskUserQuestion 을 쓰지 말고 이 문서의 기본값으로 결정해라. 목적은 **오직 스킨 추가 + 상점 등록 + 코인 수치 조정**이다. 다른 개선·리팩터 금지.

## 0. 먼저 읽을 것 (순서대로)
1. 메모리 `project_marble_skin_shop.md` — 스킨 시스템 구조(marble_skin 슬롯, `{creature}-{skin}` 시트 규칙, 서버 attachSkins, 테스트)
2. 메모리 `project_spritemake_codex_exec_pipeline.md` — Codex exec 로 시트 뽑는 명령·함정 12개. **반드시 전부 읽을 것**
3. `docs/goal/applied/marble-creature-skins-shop.md` — 스킨 상점 명세(이미 구현·커밋됨)
4. `AutoTest/spritemake/verify-creature.py`(독립 검증) · `AutoTest/spritemake/update-creature.py`(교체 인수) · `AutoTest/spritemake/pickup-new-creature.example.py`(신규 인수 예시 — species/manifest 섹션만 바꿔 씀)
5. `AutoTest/qa-marble-skin-shop-test.js` — 소켓 통합 테스트(스킨 id 하나 검증). 새 스킨 전부 돌도록 확장해라
6. 참고 시트: `assets/marble/creatures/ribbonpig-scarf*.png` = 완성된 스킨 1개(배치 L). `config/marble/cosmetics.json` = 카탈로그

## 1. 확정 결정 (바꾸지 말 것)
- **퀄리티 우선 원칙**: 몸·표정이 바뀌는 스킨은 **전체 시트 3장**(main 640×800·sleep 640×160·scuffle 640×320)으로 새로 생성한다. 색만 바뀌는 스킨은 **기본 시트를 결정론적으로 리컬러**(스크립트, 픽셀 정렬 100%)한다 — 생성보다 퀄리티가 확실하고 빠르다. 레이어(오버레이) 방식은 이번 밤엔 쓰지 않는다.
- 시트 이름 `{creature}-{skin}.png` / `-sleep.png` / `-scuffle.png`, 카탈로그 id `marble_skin_{creature}_{skin}`, 항목에 `creature`·`skin`·`rarity`·`price`·`emoji`·`name`(평이한 한국어)·`desc`.
- **가격: 모든 스킨 80코인** (기존 스카프 리본돼지 90 → 80 으로 내림). rarity 는 rare 통일.
- **코인 경제**: 
  - 신규 지갑 시드 `db/coins.js` `SEED_COINS` 100 → **150** (※ 사용자 원문 "돈지급을 매 게임당 150원만 주고"는 "처음 150" 으로 해석했다. 원문이 정말 "게임당 150" 이면 아래 게임당 10 과 모순이므로 150 = 초기 지급으로 간다. summit-log 에 이 해석을 명시)
  - **데구리 한 판 참여 시 +10코인** — `socket/horse.js` `awardRaceCoins`(raceJoin 10, 멱등 coinRef, 인증 유저만, `wallet:updated` emit) 패턴을 `socket/marble.js` 게임 종료 시점에 그대로 이식. 승리 보너스 없음. 상수는 `config/marble/` 또는 파일 상단 const. 이중 적립 방지(레이스당 1회 결정론 ref).
- **스킨 유지 범위 = 그 게임방 안에서만**: 장착(`prefs.equipped.marble_skin`)은 계정에 영구 저장하지 않는다 → 방에 들어와 상점에서 "장착"하면 그 방의 `mb.skins[name]` 에만 기억되고, 방을 나가거나 방이 사라지면 초기화된다. **소유(구매)는 영구.** 구현: `shop:equip` 은 그대로 두되 데구리 어댑터는 서버에 `marble:equipSkin { cosmeticId|null }` 을 보내고 서버가 소유 검증 후 `mb.skins` 에만 저장(prefs 저장 X). `resolveSkin` 의 prefs 조회 경로를 이 방 메모리로 대체. 재입장 시엔 다시 골라야 함(의도). 카탈로그 `marble_skin_none` 은 "해제". 테스트도 이 규칙으로 갱신.
- **스킨은 이름도 바꾼다**: 카탈로그 항목에 `displayName`(평이한 한국어) 을 두고, 서버가 공에 `skin` 과 함께 `skinName` 을 얹는다(preview·reveal balls, 카탈로그 `displayName` 그대로). 렌더러의 모든 이름 표시(HUD 후보 목록·이름표 "OO 님의 XX N번"·응원석·비석 라벨·결과 오버레이의 동물 이름)는 `b.skinName || CREATURE_NAMES[b.creature]`. 상점 카드 이름도 displayName. **선택 버튼·"N명" 카운팅·안 고른 사람 목록은 기본 동물 기준 그대로**(picks 는 creatureId — 스킨을 껴도 남에겐 "돼지 고른 사람"이고 게임 화면에서만 리본돼지).
- **돼지가 기본, 리본은 스킨**: 현재 `ribbonpig` 기본 시트(머리 리본이 그려진 v2 3장)는 **스킨 `ribbon`(displayName "리본돼지")** 으로 옮기고(파일명 `ribbonpig-ribbon{,-sleep,-scuffle}.png`, manifest 갱신), 기본 시트 `ribbonpig{,-sleep,-scuffle}.png` 는 **리본 없는 그냥 돼지**를 새로 생성해 넣는다(v2 와 같은 화풍·색·포즈, 머리에 아무것도 없음, 눈은 v2 처럼 점 눈). 동물 이름 `CREATURE_NAMES.ribbonpig` = **"돼지"**, `marble-multiplayer.html` 선택 버튼 라벨 "돼지", `AutoTest/devtools.html` 이름표도. **내부 id `ribbonpig` 는 바꾸지 않는다**(코드·에셋·manifest 전반 리네임은 범위 밖). 스카프 스킨 displayName = "스카프 리본돼지". 이 돼지 기본 시트 생성이 **첫 번째 배치**다(다른 스킨보다 먼저 — 기본 모습이 바뀌는 일이라 아침에 사용자가 제일 먼저 볼 것).
- 서버는 오른쪽 향함 시트만 받는다(코드 반전). 시트 규격은 K 도구 규칙(시트당 단일 배율, 서기 ≤134×130, 공 112, 림 <1%, 조각 0).

## 2. 스킨 목록 (동물당 1~2개, 총 15개 목표 — 시간 부족하면 ★만 우선, ★★는 필수)
| 동물 | 스킨 id | 이름 | 방식 | 컨셉 |
|---|---|---|---|---|
| hedgehog | cherry ★ | 벚꽃 고슴도치 | 리컬러 | 갈색 가시→연분홍, 얼굴 크림 유지, 볼 진분홍 |
| hedgehog | knight | 기사 고슴도치 | 생성 | 작은 은색 투구+가슴 갑옷, 가시는 투구 위로 |
| armadillo | gold ★ | 황금 아르마딜로 | 리컬러 | 갑옷 띠→금색, 배는 크림 |
| pillbug | rainbow ★ | 무지개 공벌레 | 생성 | 등판 마디마다 무지개 색 띠(공이 되면 무지개 공) |
| turtle | melon ★ | 수박 거북이 | 생성 | 등딱지 = 수박 무늬(진초록 줄+검은 씨), 공은 수박 |
| turtle | ocean | 바다 거북이 | 리컬러 | 초록→청록/파랑 |
| panda | red ★ | 레서판다 | 생성 | 적갈색 털·흰 얼굴 무늬·줄무늬 꼬리(너구리와 구분: 붉은 톤+귀 흰 테두리) |
| hamster | cookie ★ | 쿠키 햄스터 | 생성 | 갈색 얼룩(초코칩) 박힌 크림색 햄스터 |
| pufferfish | blue ★ | 파란 복어 | 리컬러 | 노랑→하늘색, 점무늬 남색 |
| raccoon | ninja ★ | 닌자 너구리 | 생성 | 이마 붉은 머리띠(뒤로 꼬리 2가닥), 검은 복면은 X(눈가면과 겹침), 표정은 그대로 심드렁 |
| rabbit | black ★ | 검정 토끼 | 리컬러 | 흰→진회색/검정, 귀 안쪽·코 분홍 유지, 외곽선 더 어둡게 |
| rabbit | tophat | 신사 토끼 | 생성 | 작은 검정 실크햇 + 나비넥타이, 눈은 그대로 |
| ribbonpig | (기본) ★★ | 돼지 | 생성 | 리본 없는 그냥 돼지 — 현 v2 시트에서 머리 리본만 없앤 모습. **맨 먼저** |
| ribbonpig | ribbon ★ | 리본돼지 | 파일 이동 | 현 v2 3장을 `ribbonpig-ribbon*` 로 옮김(생성 없음), 80코인 |
| ribbonpig | scarf (있음) | 스카프 리본돼지 | 기존 | 가격만 80, displayName 추가 |
| (여유 시) hamster | grey | 회색 햄스터 | 리컬러 | 주황→회색, 볼 크림 유지 |

리컬러 규칙(스크립트 `AutoTest/spritemake/recolor-creature.py` 를 새로 만들어라): HSV 에서 "몸 색 범위"만 골라 hue 회전/채도·명도 조정, alpha·외곽선(어두운 픽셀)·눈(검정)·볼/코(분홍은 유지 대상이면 마스크 제외) 보존. 결과 3장은 verify-creature.py 통과 + 28px 대조 이미지로 기본과 구분되는지 눈검사(Read 로 이미지 열어 볼 것). 리컬러는 SpriteMake 배치 없이 로컬에서 만들고 manifest 에 `creaturesR`(리컬러) 섹션으로 기록.

생성 스킨은 동물 1종당 SpriteMake 배치 1개(`marble-run-skin-{creature}-{skin}-2026-09-22`), **한 번에 하나씩 순차**(Codex 세션 동시 실행 금지). 의뢰서는 `docs/spritemake-request/2026-09-22-marble-skin-{creature}-{skin}.md` 로 짧게(§2 디자인·§3 프레임·§4 규칙은 9차 의뢰서 참조로 대체). 브리프에는 메모리 12개 함정을 전부 반영(K 도구 복사, 배경 = 팔레트와 먼 단색, r4c2 위에서 본 포즈 허용, "떨어진 마크·얼룩 개수·반대쪽 눈·브라우저 QA" 로 반려 금지, Codex 가 다 반려하면 원본을 직접 열어 재판정 후 오버라이드). 각 배치 끝나면 verify-creature.py 로 독립 검증 → 인수(신규 파일이므로 pickup 예시 스크립트 변형) → `js/marble-render.js` ASSETS 3맵에 항목 추가(또는 카탈로그에서 자동 생성하도록 loadAll 확장 — 후자가 낫다: 카탈로그의 creature/skin 조합으로 URL 을 만들어 로드) → 카탈로그 항목 → 커밋. **스킨 하나 끝날 때마다 커밋**(밤중 어디서 끊겨도 남게).

## 3. 코드 변경 범위 (이것만)
- `db/coins.js` SEED_COINS, `socket/marble.js`(게임 종료 +10 적립, 방 단위 장착 `marble:equipSkin`, resolveSkin 교체), `js/marble-shop.js`(장착 → marble:equipSkin, 방 나가면 UI 초기화), `js/marble-render.js`(ASSETS 를 카탈로그 기반으로 확장, 이름 표시 `skinName` 우선, CREATURE_NAMES.ribbonpig='돼지'), `config/marble/cosmetics.json`(displayName 포함), `assets/marble/creatures/*` 신규 시트·리본 시트 이동, `marble-multiplayer.html`/`AutoTest/devtools.html` 돼지 라벨, `assets/marble/marble-run.manifest.json` 섹션, `AutoTest/qa-marble-skin-shop-test.js` 확장, `docs/spritemake-request/*`(→ applied/), update-log.md·summit-log.txt.
- `socket.on()` 추가 시 `ctx.checkRateLimit()`(rateOk) 필수. 게스트는 스킨 없음 유지.

## 4. 검증 (전부 통과해야 summit)
1. `node -c` 전체, `node AutoTest/marble-determinism-test.js` ALL PASS(스킨은 시뮬 입력 아님)
2. 새 시트마다 `verify-creature.py` ALL_OK(리컬러 포함)
3. `AutoTest/qa-marble-skin-shop-test.js` 확장본: 모든 스킨 id 에 대해 buy→equipSkin→pick→preview.skin·skinName 확인(스킨 껴도 picks[name] 은 기본 creatureId, 카운팅 불변), 방 나가면 해제, 게스트 없음, 게임 1판 후 +10 적립(멱등 2회 호출 시 1회만)
4. 서버 재기동 후 브라우저(launch.json `dev-5174`)에서 방 만들고 상점 카드 15개 미리보기(캔버스) 표시, 하나 사서 장착 → 출발대 반영 + 이름표에 스킨 이름(예: '리본돼지'), 선택 버튼은 '돼지 1명' 그대로. `game-lab/marble-preview.html` 에 타임라인 skin 주입해 굴러가는 모습 스크린샷 1장 남기기(Read 로 확인)
5. 모바일 375px 상점 모달 확인

## 5. 동시 세션 주의
다른 Claude 세션이 같은 작업 트리에서 작업 중일 수 있다(`git status` 로 내 것 아닌 WIP 확인). **git checkout/stash/reset 금지.** 커밋은 내 헝크만 골라서(`git diff -U0` → 키워드 필터 → `git apply --cached --unidiff-zero`, 인접 줄이 한 헝크로 묶이면 손으로 분리), 커밋 후 `git show HEAD:파일` 로 내 줄이 다 들어갔는지 확인. `socket/*` 바꾸면 로컬 서버 재기동(5173 은 남의 프로세스일 수 있으니 5174 사용). 5174 서버 로그로 오류 확인.

## 6. 끝내는 방법
- `/summit` — update-log.md(유저 문구: "데구리 동물마다 새 스킨이 왔어요 — 15종, 80코인. 한 판 뛰면 10코인, 첫 지갑 150코인" 톤) + summit-log.txt(스킨별 방식·배치·md5·해석한 가정·미결) + 커밋 + 푸시(feature/marble-run). main 병합 금지.
- 마지막 보고에 스킨 15개 표(이름/방식/커밋), 실패한 것과 이유, 아침에 사용자가 확인할 체크리스트.
