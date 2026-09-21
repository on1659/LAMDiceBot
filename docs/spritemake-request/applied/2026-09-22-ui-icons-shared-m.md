# SpriteMake 의뢰: 공용 UI 아이콘 아틀라스 M — 전 게임 이모지 교체 (11차)

작성일: 2026-09-22
요청자: LAMDiceBot 프로젝트 (사용자 지시: "데구리뿐만 아니라 경마·주사위·룰렛 등 모든 곳에서 사용하는 이모지 스프라이트로 만들자")
SpriteMake batch: `output/ui-icons-shared-m-2026-09-22/`
받기 경로: `/Users/radar/Work/LAMDiceBot/assets/ui/icons.png` (저장소 공용, 새 폴더 `assets/ui/`)
모델: gpt-image-2 고정. Codex 직접 생성은 unverified 후보로 `generated/`에만.
규칙: 10차(L) 의뢰서 `applied/2026-09-21-marble-run-ui-icons-l.md` §2 공통 화풍 + §3 리팩·QA 규칙을 그대로 상속. **L 최종본 `output/marble-run-ui-icons-l-2026-09-21/final/ui/icons.png`의 33셀은 재생성하지 않고 픽셀 그대로 복사**한다. 기존 creatures/pieces/fx/stage final 파일은 절대 건드리지 않는다.

> 화풍 레퍼런스(같은 화풍·외곽선 톤·광택): L 최종본 `qa/cells-labeled.png` — 치비 픽셀아트, 각 색의 어두운 톤 외곽선, 평면 채움 + 하이라이트 1점. 새 64종은 이 33종 옆에 놓여도 한 벌로 보여야 한다.
> 도구 레퍼런스: L 배치 `tools/{repack,qa,finalize}_ui_icons_l.py` (마젠타 flood-fill 배경 제거 + 8-연결 컴포넌트 셀 배정 + 셀별 104×104 정규화 + 림 despill + 20/32px 대조 시트). 격자만 10×10 으로 바꿔 복사해 쓴다.

---

## 1. 왜 11차인가

10차에서 데구리 페이지의 이모지 33곳을 아틀라스 1장으로 바꿨다. 나머지 게임 페이지(주사위·룰렛·경마·사다리·다리건너기·해적 룰렛·회전 칼날)와 로비(index·free), 그리고 전 게임이 공유하는 모듈(`js/shared/` control-bar·chat·free-invite·order·ranking·server-select·shop)은 아직 OS 이모지를 165종·약 1,000곳에서 쓴다. 플랫폼마다 모양이 다르고 데구리와도 따로 논다. **저장소 공용 아틀라스 1장으로 통합**한다 — 데구리 33종을 그대로 품고, 다른 게임에 필요한 64종을 더해 97셀. 데구리도 이 공용 파일로 이관하고 `assets/marble/ui/icons.png`는 삭제한다.

이번 범위 밖(이모지 유지): 채팅 유저 리액션(❤️👍😢🎉🔥 + DB 등록 커스텀), 유저가 직접 친 채팅 본문, `<title>`·og 메타(텍스트만 남기고 이모지 삭제), 디버그 로그·admin 페이지·`pages/*.html` 정적 SEO 문서. 경마 탈것(🐎🐢🚀…)은 이미 있는 인라인 SVG 탈것 스프라이트 썸네일로 바꾸므로 셀을 만들지 않는다. 다리건너기 색 칸(🟥🟧🟨🟩🟦🟪)은 CSS 색 사각형으로.

## 2. 에셋 — 시트 1장 (투명 PNG-32, 4x 소스, 셀 128×128, 거터·바깥 패딩 없음)

| 파일 | 캔버스 / 그리드 | 표시 크기 | 앵커 |
|---|---|---|---|
| ui/icons.png | **1280×1280 / 10×10** (row-major, index = row×10+col) | UI 16~24px, 캔버스 12~24px, 로딩·빈 상태 48~80px | 셀 중심 (64,64). 본체는 **104×104 안**(사방 여백 ≥12px), 시각 중심을 셀 중심에 |

### 셀 배치 (97개 + 빈 셀 3)

index 0~32 = L 의 0~32 **그대로 복사**(L 은 6열이라 좌표만 바뀐다: L index i → M index i). 33부터 새 아이콘.

| row | c0 | c1 | c2 | c3 | c4 | c5 | c6 | c7 | c8 | c9 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | paw | target | medal | snail | trophy | burger | list | memo | people | bulb |
| 1 | check | hourglass | clock | flask | expand | replay | play | stop | refresh | chat |
| 2 | scroll | lock | crown | person | warn | info | book | home | flag | sun |
| 3 | hole | dash | x | **dice** | **slot** | **horse** | **bridge** | **ladder** | **swords** | **pirate** |
| 4 | gamepad | confetti | party | silver | bronze | checker | sparkle | star | skull | rain |
| 5 | fog | cloudsun | coin | gift | recycle | box | bag | cart | palette | tag |
| 6 | clapper | camera | tv | sound | soundlow | mute | pencil | door | link | mail |
| 7 | pin | key | chart | calendar | wave | eye | grad | question | pc | phone |
| 8 | apple | fire | rocket | dizzy | carrot | banana | snow | barrier | ghost | tomb |
| 9 | bolt | d1 | d2 | d3 | d4 | d5 | d6 | — | — | — |

### 새 아이콘 명세 64종 (대체 이모지 → 그림)

**게임 아이콘** (로비 카드·게임 타입 선택·랭킹 탭·시작 버튼·로딩 화면 80px)

| id | 대체 | 그림 |
|---|---|---|
| dice | 🎲 | 흰 정육면체 주사위 1개, 보이는 면 3개(아이소), 검은 눈. 눈 개수는 5·2·3 처럼 다르게 |
| slot | 🎰 | 슬롯머신 — 빨간 몸통, 릴 창 3칸(과일·별 같은 작은 기호), 오른쪽 레버 |
| horse | 🐎 | 말 머리 옆모습(오른쪽 향함) — 갈색 + 검은 갈기 |
| bridge | 🌉 | 낮의 아치 돌다리 + 아래 파란 물 (밤·별 금지) |
| ladder | 🪜 | 나무 사다리 세로, 가로대 4개 |
| swords | ⚔️ | 교차한 검 2자루 — 은빛 날 + 갈색 손잡이 |
| pirate | 🏴‍☠️ | 깃대에 걸린 검은 깃발 + 흰 해골·뼈 |
| gamepad | 🎮 | 게임패드 — 회색 몸통, 왼쪽 십자키, 오른쪽 색 버튼 4개 |

**축하·순위** (결과판 제목·순위 목록·당첨 표시)

| id | 대체 | 그림 |
|---|---|---|
| confetti | 🎊 | 색종이 폭죽 공 — 빨강/파랑 공에서 여러 색 색종이가 흩날림 |
| party | 🎉 | 파티 폭죽 콘(빨강·노랑 줄무늬) + 튀어나오는 색종이 |
| silver | 🥈 | 은메달 — medal 과 같은 리본 형태, 원판 은색, 안에 별 1개(숫자 금지) |
| bronze | 🥉 | 동메달 — 같은 형태, 원판 구리색, 별 1개 |
| checker | 🏁 | 체크무늬 깃발(흑백) + 회색 깃대 |
| sparkle | ✨ | 노란 반짝이 별 3개 — 큰 것 1 + 작은 것 2 |
| star | ⭐ | 노란 5각 별 1개 (하이라이트 1점) |
| skull | 💀 | 회백색 해골 얼굴 (뼈 없이) |

**날씨** (경마 배너·채팅 날씨 메시지)

| id | 대체 | 그림 |
|---|---|---|
| rain | 🌧️ | 회색 구름 + 파란 빗줄기 3~4개 |
| fog | 🌫️ | 회색 안개 띠 3겹(위 짧고 아래 길게) |
| cloudsun | 🌤️ | 노란 해 뒤에 작은 흰 구름 |

**상점·경제** (코인 잔고·뽑기·카테고리 탭)

| id | 대체 | 그림 |
|---|---|---|
| coin | 🪙 | 금화 1개 정면 — 테두리 링 + 안에 별 1개(숫자·글자 금지) |
| gift | 🎁 | 빨간 선물 상자 + 노란 리본 |
| recycle | ♻️ | 초록 화살표 3개가 도는 삼각 |
| box | 📦 | 갈색 골판지 상자(닫힘) + 테이프 |
| bag | 🛍️ | 쇼핑백 — 분홍 몸통 + 손잡이 |
| cart | 🛒 | 쇼핑 카트 — 회색 바구니 + 바퀴 2개 |
| palette | 🎨 | 나무 팔레트 + 물감 점 4색 |
| tag | 🏷️ | 노란 이름표 태그 + 구멍·끈 |

**조작·미디어·내비** (버튼·헤더·링크)

| id | 대체 | 그림 |
|---|---|---|
| clapper | 🎬 | 영화 슬레이트 — 검은 판 + 흰/검 사선 줄무늬 상단 (다시보기·광고, 가장 많이 쓰임) |
| camera | 📷 | 카메라 — 회색 몸통 + 큰 렌즈 + 플래시 |
| tv | 📺 | 텔레비전 — 갈색 몸통 + 하늘색 화면 + 안테나 |
| sound | 🔊 | 회색 스피커 + 음파 3개 |
| soundlow | 🔈 | 같은 스피커 + 음파 1개 |
| mute | 🔇 | 같은 스피커 + 빨간 사선/X |
| pencil | ✏️ | 노란 연필 대각선, 분홍 지우개 |
| door | 🚪 | 열린 갈색 문 + 밖으로 나가는 초록 화살표 |
| link | 🔗 | 사슬 고리 2개 대각선 (회색/파랑) |
| mail | 📨 | 흰 봉투 + 파란 테두리, 날아가는 선 |
| pin | 📌 | 빨간 압정 (대각선) |
| key | 🔑 | 금 열쇠 대각선 |
| chart | 📊 | 막대 그래프 3개(파랑·초록·빨강, 높이 다름) |
| calendar | 📅 | 달력 — 빨간 머리 + 흰 몸통 격자(숫자 금지) |
| wave | 👋 | 흔드는 손(노란 손바닥) + 움직임 선 2개 |
| eye | 👁️ | 눈 1개 — 흰자 + 파란 홍채 + 검은 동공 |
| grad | 🎓 | 검은 학사모 + 노란 술 |
| question | ❓ | 빨간 물음표(굵게) |

**기기** (채팅 이름 옆 기기 표시)

| id | 대체 | 그림 |
|---|---|---|
| pc | 💻 🖥️ | 열린 노트북 — 회색 + 하늘색 화면 |
| phone | 📱 | 스마트폰 세로 — 검은 테두리 + 하늘색 화면 |
| apple | 🍎 | 빨간 사과 + 초록 잎 (iOS 표시) |

**상태·경마 연출** (경주 중 말 위에 뜨는 효과·상태 라벨)

| id | 대체 | 그림 |
|---|---|---|
| fire | 🔥 | 불꽃 — 빨강 바깥 + 노랑 속 |
| rocket | 🚀 | 로켓 오른쪽 위 대각선 + 뒤 불꽃 |
| dizzy | 💫 | 노란 별 + 주위를 도는 궤적 링 |
| carrot | 🥕 | 주황 당근 + 초록 잎 |
| banana | 🍌 | 노란 바나나 (껍질 벗겨진 채, 미끄럼 함정) |
| snow | ❄️ | 하늘색 눈 결정 6갈래 |
| barrier | 🚧 | 공사 바리케이드 — 노랑/검정 사선 판 + 다리 2개 |
| ghost | 👻 | 흰 유령 — 물결 아랫단, 검은 눈 2개 |
| tomb | 🪦 | 회색 묘비(둥근 위) + 아래 초록 풀 |
| bolt | ⚡ | 노란 번개 |

**주사위 눈** (주사위 페이지 대기 애니메이션)

| id | 대체 | 그림 |
|---|---|---|
| d1~d6 | ⚀~⚅ | 흰 정사각 주사위 정면 2D(둥근 모서리, 어두운 테두리) + 검은 눈 1~6 표준 배치 |

공통(L §2 그대로): **치비 픽셀아트, 4x 소스, 외곽선은 각 색의 어두운 톤(순검정 X, 단 warn·해골·슬레이트처럼 본래 검은 물체는 허용)**, 평면 채움 + 하이라이트 1점. 배경판·그림자·글자·숫자 금지. **흰 UI 패널·초록 잔디(#8fd07a)·어두운 배경(#1f2937) 셋에서 읽혀야 한다** → 흰색 위주 아이콘(ghost/skull/checker/mail/dice/d1~d6)은 어두운 외곽선 필수. 20px 로 줄였을 때 실루엣만으로 구분돼야 한다. **메달 3종(medal·silver·bronze)과 스피커 3종(sound·soundlow·mute)은 같은 실루엣에 색·부속만 달라야** 한 계열로 읽힌다.

## 3. 리팩·QA 규칙 (L §3 상속 + 변경점)

1. 새 64종은 **2장으로 생성**: 시트 A = index 33~68 (36종, 6×6 격자), 시트 B = index 69~96 (28종, 6×5 격자, 마지막 2칸 비움). 원본은 평평한 **마젠타(255,0,255)** 단색 배경 1024~2000px, 셀마다 아이콘 하나가 셀 중앙에 여백을 두고. 화풍·선 굵기는 두 장이 동일해야 하고 L 33종과도 같아야 한다 — 생성 프롬프트에 L `qa/cells-labeled.png`를 화풍 레퍼런스로 첨부.
2. 배경 제거·림 despill·컴포넌트 셀 배정·셀별 104×104 정규화는 L 과 동일(§3-2, 3-3). 여러 덩이 아이콘(sparkle 3개·rain 빗줄기·fog 3띠·recycle·wave 움직임 선·dizzy 링·mail 날림 선·d2~d6 눈)은 컴포넌트를 버리지 말 것.
3. **최종 합성**: 1280×1280 캔버스에 L 최종본 index 0~32 를 **셀 단위 복사**(L (i%6, i//6) → M (i%10, i//10)), 33~96 에 새 셀, 97~99 투명. L 복사 셀은 **셀별 md5 가 L 원본과 동일**해야 한다(재샘플·재인코딩 금지, 알파 포함).
4. 게이트: 97셀 alpha≥8 bbox 비어 있지 않음 + ≤104×104 + 중심 편차 ≤0.5px, 빈 셀 3개(index 97~99) 완전 투명, alpha 1~7 픽셀 0, 셀 밖 침범 0, 마젠타 잔류 0, 림 비율 <1%, 캔버스 1280×1280, L 33셀 md5 일치.
5. 대조 시트: 97종을 **20px·32px** 로 축소해 흰 / 잔디색(#8fd07a) / 어두운 배경(#1f2937) 3줄 → `qa/contact-sheet.png`. 안 읽히는 아이콘은 재생성. 메달 3종·스피커 3종은 나란히 놓고 계열 일관성 확인.
6. md5 기록. 파일명 ↔ 셀 index 대조표를 `MANIFEST.md` + `manifests/ui-icons-m.json`(id→index, bbox, 출처 attempt)에.

## 4. 코드 연결점 (구현 세션이 함 — 이 의뢰와 같은 세션에서 진행)

- `assets/ui/icons.png` + `assets/ui/icons.manifest.json`(배치·md5·셀 맵)
- `css/ui-icons.css` — `.ui { display:inline-block; width:1.2em; height:1.2em; vertical-align:-0.25em; background:url('/assets/ui/icons.png') no-repeat 0 0 / 1000% 1000%; }` + `.ui-{id} { background-position: (col×100/9)% (row×100/9)%; }` 97개. 모든 게임 페이지·index·free 가 `<link>`.
- `js/shared/ui-icons.js` — `UI_ICON_CELL`(id→index)·`UI_ICON_COLS=10`, `UIIcons.tag(id)`(문자열 `<i class="ui ui-{id}"></i>`), `UIIcons.el(id)`(Element), `UIIcons.textToNodes(text)`(알려진 이모지 → `<i>` + 텍스트 노드로 분해 — innerHTML 금지, XSS 안전), `UIIcons.register(emoji, factory)`(페이지별 추가 매핑 — 경마 탈것 SVG 썸). 캔버스 게임(marble-render·spin-arena)은 `UI_ICON_CELL`로 `drawImage`.
- `js/shared/chat-shared.js` — 시스템/게임 메시지(서버 발신 `🎊🎉 축하`, `🎮 시스템`, `🌤️ 날씨`)와 이름 옆 배지(👑 호스트·🥇🥈🥉·기기)는 `UIIcons.textToNodes`로 렌더. 유저 본문·리액션은 그대로.
- 게임 페이지 7종 + index/free + `js/{game}.js` + `js/shared/*` 이모지 → `<i class="ui ui-{id}">` (textContent 자리는 아이콘 노드 + 텍스트 노드, 유저 문자열은 escape 유지). `<title>`·og 는 이모지 삭제.
- 경마: 실시간 순위·미니맵·튜토리얼 샘플의 탈것 이모지 → `getVehicleSVGForResult()` 썸네일. 경주 연출(🔥💨🚀💫🥕🍌❄️🚧👻🪦⚡)은 `.ui` 아이콘 노드.
- 데구리 이관: `css/marble.css` `.mi` 블록 삭제, `mi mi-*` → `ui ui-*`, `js/marble-render.js` `ASSETS.ui.icons` → `/assets/ui/icons.png` + `ICON_CELL`/`ICON_COLS` → 공용, `assets/marble/ui/icons.png` 삭제, `marble-run.manifest.json uiIconsL` 에 이관 기록.

## 5. 진행 기록

- 2026-09-22 의뢰서 작성. codex exec 로 배치 생성 시작.
- 2026-09-22 00:15 인수 완료. Codex 1세션 — 시트 A(attempt-01, 36종)·B(attempt-02, 28종) + 단독 재생성 4회(attempt-03 slot·palette·silver·bronze, 04 ladder·speaker 계열, 05 sound, 06 grad 어두운 배경용) → 마젠타 제거·컴포넌트 배정·셀별 정규화·L 33셀 verbatim 복사. Claude 독립 검증 PASS(97셀 bbox ≤104 중심 ±0.5 여백 ≥12, alpha 1~7 = 0, 마젠타 0, L 셀 md5 33/33 일치, 97~99 투명, 20/32px 3배경 대조 시트). `assets/ui/icons.png` md5 `6a44aec375cc65fece23bf7654deaa50`, 1.18MB(PNG-32 무손실 유지 — palette/webp 는 픽셀 변형이라 보류, 크기 최적화는 후속). manifest `assets/ui/icons.manifest.json`. 관찰: fog(50)·dash(31)는 형태가 비슷하고 색(회색/흰-하늘)으로만 구분 — 용도가 달라 허용, 재생성 후보.
- 코드 연결(§4) 같은 세션에서 진행: 공용 `css/ui-icons.css`·`js/shared/ui-icons.js`, 10개 페이지 `<head>` 포함, chat-shared 시스템 메시지 `setIconText`, control-bar, 게임 페이지 7종·로비·공유 모듈 이모지 교체(에이전트 5개 병렬), 데구리는 아틀라스만 이관(`.mi`는 공용 셀 별칭 — 다른 세션이 marble 파일 편집 중이라 클래스 이름 변경은 보류).
