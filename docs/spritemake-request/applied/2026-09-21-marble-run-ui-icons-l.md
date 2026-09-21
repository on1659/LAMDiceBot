# SpriteMake 의뢰: 데구리(마블런) 10차 — UI 아이콘 아틀라스 1장 (이모지 전면 교체)

작성일: 2026-09-21
요청자: LAMDiceBot 프로젝트 (사용자 지시: "데구리에서 이모지 되어 있는 거 싹 다 제거하고 스프라이트 직접 만들자")
SpriteMake batch: `output/marble-run-ui-icons-l-2026-09-21/`
받기 경로: `/Users/radar/Work/LAMDiceBot/assets/marble/ui/icons.png` (새 폴더 `ui/`)
모델: gpt-image-2 고정. Codex 직접 생성은 unverified 후보로 `generated/`에만.
규칙: 2차 의뢰서 §3(검증은 alpha≥8 bbox·md5, cp -p 금지) + 9차 §4 리팩 규칙 중 배경 제거·despill·QA 부분. **기존 creatures/pieces/fx/stage final 파일은 절대 건드리지 않는다.**

> 게임·스타일: `applied/2026-09-19-marble-run-game-overview.md` (봄 초원, 4x 소스, 치비 픽셀아트)
> 스타일 레퍼런스(같은 화풍·외곽선 톤·광택): `assets/marble/creatures/{hedgehog,panda,rabbit}.png`, `assets/marble/fx/{impact-star,cheer,mole-alert}.png`, `assets/marble/pieces/{flag,goal-basket-front}.png`
> 도구 레퍼런스: 9차 배치 `output/marble-run-creatures-i-2026-09-21/tools/*_creatures_i.py` (flood-fill 배경 제거 + 컴포넌트 셀 배정 + 림 despill). 아이콘은 셀마다 독립이라 시트 단일 배율 규칙은 쓰지 않는다(§4).

---

## 1. 왜 10차인가

데구리 페이지(`marble-multiplayer.html`, `js/marble.js`, 캔버스 `js/marble-render.js`)는 제목·버튼·상태줄·결과판·캔버스 라벨에 OS 이모지(🐾 🎯 🥇 🐢 🍔 …)를 33곳 쓰고 있다. 플랫폼마다 모양이 달라 게임 화풍과 따로 놀고, 캔버스에서는 폰트 렌더라 픽셀아트와 섞이지 않는다. **전부 우리 스프라이트로 바꾼다.** 아틀라스 1장을 CSS `background-position`(UI)과 `drawImage`(캔버스) 양쪽에서 읽는다.

## 2. 에셋 — 시트 1장 (투명 PNG-32, 4x 소스, 셀 128×128, 거터·바깥 패딩 없음)

| 파일 | 캔버스 / 그리드 | 표시 크기 | 앵커 |
|---|---|---|---|
| ui/icons.png | 768×768 / 6×6 (row-major, index = row×6+col) | UI 18~24px, 캔버스 12~24px, 로딩 화면 80px | 셀 중심 (64,64). 아이콘 본체는 **104×104 안**(사방 여백 ≥12px), 시각 중심을 셀 중심에 |

### 셀 배치 (33개 + 빈 셀 3)

| row | col0 | col1 | col2 | col3 | col4 | col5 |
|---|---|---|---|---|---|---|
| 0 | `paw` | `target` | `medal` | `snail` | `trophy` | `burger` |
| 1 | `list` | `memo` | `people` | `bulb` | `check` | `hourglass` |
| 2 | `clock` | `flask` | `expand` | `replay` | `play` | `stop` |
| 3 | `refresh` | `chat` | `scroll` | `lock` | `crown` | `person` |
| 4 | `warn` | `info` | `book` | `home` | `flag` | `sun` |
| 5 | `hole` | `dash` | `x` | — | — | — |

### 아이콘 명세 (대체 이모지 → 그림)

| id | 대체 | 그림 | 쓰이는 곳 |
|---|---|---|---|
| paw | 🐾 | **동물 발자국** 1개 — 큰 발바닥 + 발가락 4개. 따뜻한 갈색(#8b5a3c 계열) 채움, 밝은 하이라이트 1점. 이 게임의 브랜드 마크 — 가장 많이 쓰인다 | 제목·로딩·시작 버튼·마릿수 버튼·동물 고르기·상태줄·당첨자 |
| target | 🎯 | 과녁 — 빨강/흰 동심원 3겹 + 오른쪽 위에서 꽂힌 작은 다트 | 당첨 순위 투표 제목·"N등을 찾아라!" 배너·결과판 당첨 표시 |
| medal | 🥇 | 금메달 — 빨강·파랑 리본 + 금 원판, 원판 안에 **별 1개**(숫자 금지) | 1등 투표 칸·캔버스 "1등 확정" |
| snail | 🐢 | **달팽이**(거북이 아님 — 거북이는 이 게임의 동물이라 헷갈림) — 갈색 나선 껍데기 + 연두 몸, 더듬이 2개, 오른쪽 향함 | 꼴등 투표 칸·캔버스 굼벵이 표시 |
| trophy | 🏆 | 금 우승컵 — 양손잡이, 받침 | 이번 판 순위 제목 |
| burger | 🍔 | 햄버거 — 빵·상추·패티·치즈·빵 | 주문받기 제목·주문하러 가기 버튼 |
| list | 📋 | 클립보드 — 갈색 판 + 흰 종이 + 위 클립, 종이에 줄 3개(글자 아님) | 주문리스트 버튼·자주 쓰는 메뉴 |
| memo | 📝 | 연필이 얹힌 메모지 | 내 주문 |
| people | 👥 | 사람 실루엣 2명(머리+어깨, 앞뒤 겹침), 연한 파랑/남색 | 접속자 |
| bulb | 💡 | 노란 전구 + 회색 꼭지, 빛살 3개 | 드래그 안내 |
| check | ✅ | 초록 둥근 네모 안 흰 체크 | 준비한 사람·성공 알림 |
| hourglass | ⏳ | 모래시계 — 나무 틀 + 노란 모래 흐르는 중 | 동물 안 고른 사람·주문 안 한 사람 |
| clock | ⏰ | 빨간 자명종 — 종 2개, 시침·분침 | 예약 버튼·방 폭파 남은 시간·예약 모달 |
| flask | 🧪 | 시험관 — 유리 + 초록 액체, 거품 2개 | 베타 배지 |
| expand | ⛶ | 전체화면 — 네 모서리 꺾쇠 4개, 흰색에 어두운 외곽선 | 전체화면 버튼(캔버스 위) |
| replay | ↺ | 반시계 화살표 원 — 흰색 | "다시 보는 중" 배지 |
| play | ▶ | 오른쪽 삼각형 — 흰색 | 경주 다시 보기 버튼 |
| stop | ■ | 정사각형 — 흰색 | 그만 보기 버튼 |
| refresh | 🔄 | 화살표 2개가 도는 원 — 초록 | 다음 판 준비 |
| chat | 💬 | 말풍선 + 점 3개 | 채팅 제목 |
| scroll | 📜 | 두루마리 — 양끝 말린 누런 종이 | 게임 기록 |
| lock | 🔒 | 금 자물쇠(잠김) | 비공개 방·공정성 원리 링크 |
| crown | 👑 | 금 왕관 — 뾰족 3개 + 보석 | 방장 표시(이름 뒤) |
| person | 👤 | 사람 실루엣 1명(머리+어깨), 회색 | 플레이어 조작 모달 |
| warn | ⚠️ | 노란 삼각형 + 검은 느낌표 | 오류·경고 알림 |
| info | ℹ️ | 파란 원 + 흰 i | 안내 알림 |
| book | 📚 | 책 2~3권 세워 놓음 | 전체 게임 가이드 링크 |
| home | 🏠 | 집 — 빨간 지붕 + 문 | 홈으로 링크 |
| flag | 🚩 | 빨간 삼각 깃발 + 회색 깃대 | 캔버스 "꼴찌 후보" |
| sun | ☀ | 노란 해 + 빛살 8개 | 캔버스 "햇볕 잔디" 라벨 |
| hole | 🕳 | 땅 구멍 — 검은 타원 + 갈색 흙 테두리 | 캔버스 "골 구멍" 라벨 |
| dash | 💨 | 속도선 — 왼쪽으로 뻗는 흰/하늘색 선 3개(위 짧고 아래 길게) | 캔버스 빠른 놈 표시 |
| x | (예비) | 빨간 원 + 흰 X | 예비(닫기·취소) |

공통: **치비 픽셀아트, 4x 소스, 외곽선은 각 색의 어두운 톤(순검정 X, 단 warn 느낌표는 검정 허용)**, 평면 채움 + 하이라이트 1점. 배경판·그림자·글자·숫자 금지(medal 별, info의 i, warn의 ! 는 허용). **흰 UI 패널과 초록 잔디(#8fd07a) 양쪽에서 읽혀야 한다** → 흰색 위주 아이콘(expand/replay/play/stop/dash)은 어두운 외곽선 필수. 20px 로 줄였을 때 실루엣만으로 구분돼야 한다 — 세부 대신 굵은 형태.

## 3. 리팩·QA 규칙

1. 원본은 **평평한 단색 배경** 1024~2000px 로 생성. 배경색은 아이콘 팔레트와 먼 색 — **마젠타(255,0,255) 권장**(빨강·노랑·초록·파랑·갈색·흰색이 다 쓰이므로 초록 배경 금지). 생성 프롬프트에 6×6 격자를 명시하고 셀마다 아이콘 하나가 **셀 중앙에 여백을 두고** 놓이게 한다. 한 장에 36칸이 무리면 2장(6×3)으로 나눠 생성 후 합쳐도 된다 — 단 화풍·선 굵기 동일.
2. 배경 제거: 네 모서리 flood-fill(Δ≤60) + 마젠타 우세(r>g+60 & b>g+60) 픽셀 제거. 림 despill: 투명 인접 2px 띠에서 배경색과 ΔRGB≤60 픽셀은 안쪽 이웃 색으로 교체. 림 비율 <1%.
3. 셀 분할: 원본 격자를 6×6 으로 나눈 뒤 **8-연결 컴포넌트를 중심점으로 셀에 배정**(people=2덩이, dash=3덩이, bulb 빛살, sun 빛살처럼 아이콘 하나가 여러 컴포넌트일 수 있으니 컴포넌트를 버리지 말 것). 배정 후 셀별로 **개별** 균등 축소 — bbox 가 104×104 안에 들어가게, bbox 중심을 (64,64)에. (동물 시트의 "시트 단일 배율"은 적용하지 않는다.)
4. 게이트: 33셀 alpha≥8 bbox 비어 있지 않음, 빈 셀 3개(r5c3~c5) 완전 투명, alpha 1~7 픽셀 0, 셀 밖 침범 0, 캔버스 768×768.
5. 대조 시트: 33개 아이콘을 **20px·32px** 로 축소해 흰 배경 / 잔디색(#8fd07a) / 어두운 배경(#1f2937) 3줄로 나열한 PNG → `qa/contact-sheet.png`. 이 시트에서 안 읽히는 아이콘은 재생성.
6. md5 기록. 파일명 ↔ 셀 index 대조표를 `MANIFEST.md`에.

## 4. 코드 연결점 (구현 세션이 함 — 이 의뢰와 같은 세션에서 진행)

- `css/marble.css` `.mi` / `.mi-{id}` — `background-size: 600% 600%`, `background-position: (col×20)% (row×20)%`
- `marble-multiplayer.html` 이모지 → `<i class="mi mi-{id}"></i>`; `<title>`·og 는 이모지 삭제
- `js/marble.js` 문자열 이모지 → 같은 태그 (`textContent` 자리는 `innerHTML`)
- `js/marble-render.js` `ASSETS.ui.icons` + `ICON_CELL` + `icon()`/`iconLabel()` 헬퍼, 이모지 fallback 라벨 제거
- `assets/marble/marble-run.manifest.json` `uiIconsL`

## 5. 진행 기록

- 2026-09-21 의뢰서 작성. codex exec 로 배치 생성 시작.
- 2026-09-21 23:39 인수 완료. Codex 1세션(전체 시트 4회 + 시험관 단독 1회 → 최종은 attempt-04 + attempt-05 시험관), Claude 독립 검증 PASS(33셀 bbox ≤104 중심 ±0.5, alpha 1~7 = 0, 마젠타 잔류 0, 대조 시트 20/32px 3배경). `assets/marble/ui/icons.png` md5 `7c29535ebbe0aa049f9707e62ed4ec3d`, manifest `uiIconsL`. 코드 연결(§4) 같은 세션에서 완료. 공유 모듈(control-bar·free-invite·chat·order-shared)이 넣는 이모지(👑 호스트·🔗·🔇·🚪 나가기·★·🏆 랭킹·📌)는 크로스게임이라 이번 범위 밖 — 별도 결정.
