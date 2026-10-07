# 홈에서 이어지는 인게임 리뉴얼 결과

작성: 2026-10-07. 작업 폴더: `/Users/radar/Work/LAMDiceBot-home`, 브랜치: `feature/home-proto`.

## 적용 내용

- 경마·데구리·주사위·룰렛 실제 방에 종이·잉크 색, 제목 서체, 초대 링크와 주요 버튼 스타일 적용.
- 참가자·준비·시작을 앞에 두고 예약·주문·게임 규칙·꾸미기 등은 접어서 열도록 정리. 기존 기능과 방장 권한 유지.
- 경마·데구리 선택 목록을 작은 스크롤 영역으로 정리. 실제 트랙·캔버스 크기와 전체화면·작은 창 동작 유지.
- 주사위 홈 그림은 실제 방을 생성한 뒤 기존 재입장 경로로 이동. 중복 탭 방지와 연결 실패 안내 포함.
- 접힌 설정 안의 튜토리얼 대상은 안내 중 열고 종료 시 원래 상태로 복원.
- 새 색은 `css/theme.css` 공통 그룹에 라이트·다크 토큰으로 정의. 게임 결과와 서버 로직 변경 없음.

## 검증

| 항목 | 결과 |
|---|---|
| 경마·룰렛·데구리 2인 생성·초대 링크·합류·서버 결과 | 각 게임 E2E 통과 |
| 주사위 홈 1탭 생성·목록 합류·준비·시작·두 명 굴리기·결과·새로고침 | E2E 통과 |
| 계정·서버 생성·가입 승인·서버 방 합류·로그인 후 초대 복귀 | 기존 서버 E2E 통과 |
| 4게임 × 375/1280px × 라이트/다크 | 16개 화면 가로 넘침 없음 |
| 접이식 설정 키보드 Enter 열기·닫기 | 4게임 통과 |
| 경마 주문·주사위 규칙 튜토리얼 열기·원상 복원 | 실제 브라우저 통과 |
| 초대 링크 글자 대비 | 다크 14.39:1, 라이트도 4.5:1 이상 |
| 경마·데구리 투표 UI의 캔버스 이동·원래 부모 복원 | 독립 리뷰 Chromium 검사 통과 |
| HTML 인라인 JS, 변경 공백, theme.css CRLF | 통과 |

실행 명령:

```sh
node AutoTest/qa-home-ingame-ui.js
node AutoTest/qa-home-proto-dice-e2e.js
node AutoTest/qa-home-proto-e2e.js --game horse-race --regular
node AutoTest/qa-home-proto-e2e.js --game roulette --regular
node AutoTest/qa-home-proto-e2e.js --game deguri --regular
node AutoTest/qa-home-proto-server-e2e.js
```

스크린샷·측정값은 `AutoTest/.shots/ingame-*`에 생성된다. 실행 산출물은 커밋하지 않는다.

## 검증 범위와 남은 사항

- 로컬 광고 스크립트의 기존 오류(`enable_page_level_ads` 중복·폭 0 슬롯)를 확인했다. 게임 E2E에서는 광고 도메인 요청만 차단하고 실제 게임 API·Socket.IO를 사용한다. 광고 노출 자체의 검증은 포함하지 않는다.
- 전역 색 검사에는 기존 `css/home.css`와 `js/deguri-render.js`의 30개 리터럴이 남아 실패한다. 이번 수정 파일의 새 색 리터럴은 없다. 기준선은 바꾸지 않았다.
- 게임별 설정·상점·주문·기록의 모든 조합을 전수 검증한 것은 아니다. 인계 계약·권한 조건과 DOM ID는 유지했다.
- 실서버 `/` 전환과 `main` 배포는 하지 않는다.

## Lesson 후보

접힌 `details` 자식은 `getBoundingClientRect()` 크기가 있어도 화면에 보이지 않을 수 있다. 튜토리얼 대상을 접이식 메뉴로 옮기면 해당 안내가 메뉴를 열고 원래 상태를 복원하는지 실제 브라우저에서 확인해야 한다.
