# Design System — LAMDice

`/design-consultation`(2026-09-28~29) 결과. 홈·로비 리뉴얼의 기준안이다.
**상태: 기준안(목업 2번 "종이 위 내기 전단지") 확정 전.** `mockups/` 9종(`/main`, `/1`~`/9`)을 비교 중이며,
방향이 바뀌면 이 문서를 먼저 고친다. 게임 플레이 화면(주사위·룰렛·경마·데구리 인게임)은 이 문서 범위 밖이다.

## Product Context
- **What this is:** 친구랑 링크 하나로 즉석에서 "오늘 누가 쏠지"를 정하는 무료 웹 내기 게임. 주사위·룰렛·경마·데구리(베타).
- **Who it's for:** 한국 직장인·친구 모임. 대부분 카톡 링크로 모바일 진입. 가입 없이 이름만 적고 시작.
- **Space/industry:** 파티 웹게임(skribbl.io, Gartic Phone)과 랜덤 결정 도구(네이버 사다리, wheelofnames, 마블룰렛, Playcloud8) 사이.
- **Project type:** 게임 앱 입구 + 랜딩(홈), 로비, 순수 HTML/CSS/JS, 라이트·다크 스킨 선택, AdSense 수익.
- **기억될 한 가지:** "30초면 누가 쏘는지 정해진다."

## Aesthetic Direction
- **Direction:** 종이 위 내기 전단지 — 밝은 감열지 톤 종이, 굵은 잉크 선, 도장 한 개, 그 위에 풀컬러 픽셀 스티커(탈것·동물).
- **Decoration level:** intentional — 종이 결·절취선·도장만. 그라디언트·블러 그림자·장식 블롭 없음. 카드는 2px 잉크 외곽선 + 오프셋 그림자.
- **Mood:** 점심값 내기를 전단지 위에 올린 듯한 빠르고 유쾌한 승부감. 광고 옆에서도 싸 보이지 않는 종이 물성.
- **Reference sites:** skribbl.io, garticphone.com(카테고리 관례), playcloud8.com(목적 프리셋 칩), lazygyu.github.io/roulette(데구리 경쟁), jackboxgames.com, boardgamearena.com.
- **첫 원칙 통찰:** 카테고리는 전부 "무슨 게임?"을 먼저 묻지만 이 사용자는 "누가 쏠지"를 정하러 온다. 첫 행동은 **걸 것 + 이름 → 방 만들기**, 게임은 시트에서 고른다(기본값 경마).

## Typography
- **Display/Hero:** Bagel Fat One (Google Fonts) — 굵고 둥근 한글 포스터체. 제목·게임 이름·방 제목에만.
- **Body:** Pretendard (jsdelivr `orioncactus/pretendard` static dynamic-subset) — 본문·버튼·입력. 목업 아티팩트에서는 CSP 때문에 Noto Sans KR로 대신 렌더.
- **UI/Labels:** Pretendard 700.
- **Data/Tables:** Galmuri11 (눈누, OFL 비트맵 한글) — 티켓·영수증 줄·숫자·상태 pill·작은 라벨. `font-variant-numeric: tabular-nums`. 픽셀 에셋과 같은 격자.
- **Code:** Galmuri11.
- **Loading:** Bagel Fat One은 Google Fonts `<link>`, Pretendard는 jsdelivr CSS, Galmuri11은 서브셋 woff self-host(`mockups/assets/galmuri11-sub.woff` 참고).
- **Scale:** 13 / 15 / 17 / 22 / 28 / 40 / 56px (히어로 제목은 `clamp(42px, 6vw, 68px)`). 본문 line-height 1.6, 제목 1.02~1.1.

## Color
- **Approach:** restrained — 종이·잉크·도장 하나. 게임별 색은 칩·썸네일·인게임에서만 "스티커"로.
- **Paper (surface):** `#FBF8F1` — 감열지. 카드 안쪽 흰색은 `#FFFFFF`, 움푹한 곳 `#F3EEE2`.
- **Counter (page ground):** `#ECE6D8` — 종이 밖 바닥. 광고는 여기에만.
- **Ink (primary text, 외곽선, 기본 버튼):** `#14110F`. 보조 글자 `#6B6455`, 흐린 글자 `#9A9283`, 선 `#D9D2C2`.
- **Stamp (accent):** `#C8281A` — 도장·진행 중·결제 강조. 종이 대비 5.2:1. 연한 배경 `#F8DDD8`.
- **Pen (secondary):** `#1F5FE0` — 링크·정보·대기 중. 연한 배경 `#DCE6FB`.
- **Game stickers:** 주사위 `#667EEA`/`#E9ECFC`, 룰렛 `#1F7A4D`/`#DFF3E7`, 경마 `#B4551C`/`#F8E6D8`, 데구리 `#3FA65B`/`#E1F5E6`, 사다리 `#D9890A`/`#FBEFD6`. (`css/theme.css`의 게임 토큰과 맞춘다.)
- **Semantic:** success = pen `#1F5FE0`(대기·참여 가능), warning = ladder `#D9890A`, error/live = stamp `#C8281A`, info = pen.
- **Dark mode:** 있음(2026-10-01). 스킨은 라이트·다크 2종, 각 페이지 상단 버튼으로 고른다. 고른 적 없으면 기기 설정을 따른다. `js/shared/theme-shared.js`가 `<html data-theme>`을 정하고, 색은 `css/theme.css`의 `[data-theme="dark"]` 토큰이 뒤집는다. 게임 그림(트랙·맵·룰렛 판·스프라이트)은 스킨과 무관하게 그대로. **이 문서의 종이 전단지 기준안은 라이트 값만 정의돼 있다 — 리뉴얼을 적용할 때 종이·잉크·도장의 다크 값을 같이 정해야 한다.**

## Spacing
- **Base unit:** 4px
- **Density:** comfortable
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64). 섹션 상하 40px(모바일 30px), 컨테이너 가로 28px(모바일 16px).

## Layout
- **Approach:** hybrid — 홈은 왼쪽 정렬 포스터(카피 왼쪽, 스프라이트가 오른쪽에서 균형), 로비·방은 규칙적 그리드.
- **Grid:** 데스크톱 히어로 2열(1.1fr / 1fr), 로비 본문+우측 레일(1fr / 300px), 720px 이하 1열.
- **Max content width:** 1080px (전단지 한 장). 광고는 종이 밖 카운터, 최대 728px.
- **Border radius:** sm 6px / md 10px / lg 16px, 칩·걸 것 버튼은 pill(999px). 카드는 각지게(0~10px).
- **Outline & shadow:** 카드·버튼·입력 모두 `2px solid ink` + `3px 3px 0 ink`(작은 것) 또는 `5px 5px 0 ink`(큰 것). 블러 그림자 금지.
- **홈 구조:** 헤더(로고·메뉴 4·무료 라벨·로그인) → 히어로(태그라인 + 도장 + 티켓: 걸 것 칩·이름·방 만들기) → 결정 방식 칩 한 줄 → 영수증 줄 통계 → 노는 법 3단계 + 결과 영수증 → 우리 팀 서버 → 종이 밖 광고 → 푸터.
- **로비 구조:** 같은 헤더 → 열린 방 N + 내 이름 → 필터 칩 + 새로고침·랭킹·방 만들기 → 방 카드(스티커 썸네일·제목·상태 pill·좌석·들어가기·링크 복사) + 우측 레일(초대·최근 판·통계). 모바일은 sticky 하단 "방 만들기".

## Motion
- **Approach:** intentional — 스프라이트 갈록 루프(2프레임, `steps(1)` 0.34s), 데구리 idle 4프레임 0.58s, 결과 도장 "찍힘" 한 번(`stampIn` 0.35s), 나머지는 상태 전환만.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out). 도장은 `cubic-bezier(.2,1.4,.4,1)`.
- **Duration:** micro(50-100ms) short(120-250ms) medium(250-400ms). 버튼 hover/active는 120ms 오프셋 이동.
- **Reduced motion:** 스프라이트·도장·점멸 전부 정지.

## Copy
- 유저 노출 문구는 평이한 한국어. "친구와 즐기는 다양한 게임" 류 금지. 첫 화면 메시지는 "오늘 (걸 것)은 누가 쏠까?" + "30초면 결정" 하나.
- 상태 문구: 대기 중 / 진행 중 / 참여 가능 / 준비 중 / 베타. 결제·계산서 은유는 결과 화면에서만.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-28 | 보라→파랑 그라디언트 히어로 폐기, 첫 화면 모달 게이트 폐기 | 카테고리 기본값(Gartic Phone과 동일)이라 얼굴이 없고, 사이트 최고 에셋(픽셀 스프라이트)이 홈에 안 보였음 |
| 2026-09-28 | 첫 행동 = 걸 것 + 이름 → 방 만들기, 게임은 시트에서(기본값 경마) | 사용자는 게임이 아니라 "누가 쏠지"를 정하러 옴. Codex 독립 제안과 일치 |
| 2026-09-28 | 기준안 = 종이 위 내기 전단지(Bagel Fat One / Pretendard / Galmuri11, 종이·잉크·도장) | 조사 7곳 + Codex + Claude 서브에이전트 세 의견의 교집합 위에 Codex 전단지안을 뼈대로, 영수증안은 결과 화면 장치로 축소 |
| 2026-09-28 | 광고는 종이 밖 카운터에만 | 화면 주도권 유지. 단 AdSense 자동광고는 코드로 안 꺼지므로 광고 콘솔 설정도 같이 봐야 함 |
| 2026-09-29 | 확정 보류, 목업 5종(`/1`~`/5`) 외부 비교 후 결정 | 사용자 요청. 이 문서는 2번 기준안 기준이며 비교 결과에 따라 갱신 |
| 2026-10-01 | 다크 스킨 도입 — 라이트·다크 2종 선택, 기본값은 기기 설정 | 사용자 요청(memradar 식 스킨 선택). "다크 모드 없음(의도적)" 결정을 뒤집음. 현 운영 화면(보라 그라디언트) 기준으로 적용, 게임 그림은 그대로 |
| 2026-10-01 | 구조가 다른 목업 4종(`/6`~`/9`) 비교에 추가 | 1~5번이 같은 흐름의 시각 변형이라는 피드백 반영. 로비 우선·한 화면 앱·놀이터 지도·결과 피드 방향을 시험하며 기준안은 아직 확정하지 않음 |
