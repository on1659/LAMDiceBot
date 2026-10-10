# 모바일 실제 UI 검증 — 2026-10-10

대상은 격리된 로컬 서버 `http://127.0.0.1:43113`과 테스트 DB
`lamdice_mobile_ui_20261010`이다. 운영 서버에는 요청하지 않았다.

## 재현

```sh
NODE_PATH=/Users/radar/Work/LAMDiceBot/node_modules node AutoTest/qa-mobile-live-ui.js
NODE_PATH=/Users/radar/Work/LAMDiceBot/node_modules node AutoTest/qa-mobile-live-ui.js --smoke --out /tmp/mobile-live-ui-smoke
NODE_PATH=/Users/radar/Work/LAMDiceBot/node_modules node AutoTest/qa-mobile-live-ui.js --auth --out /tmp/mobile-live-ui-auth
```

`--game horse-race|dice|roulette|deguri`로 게임을 제한할 수 있다.
`--auth`는 로컬 DB에 고유한 테스트 계정 두 개와 서버 한 개를 생성한다.
스키마 변경은 없으며, 결과를 위조하거나 소켓 응답을 대체하지 않는다.

## 확인한 결과

| 범위 | 결과 | 증거 |
|---|---|---|
| 경마·주사위·룰렛·데구리 실제 라운드 | 모두 양쪽 브라우저의 서버 결과 일치 | `/tmp/mobile-live-ui-qa/report.json`의 `identical authoritative result` 항목 |
| 최신 화면의 4게임 생성·목록 합류 | 통과 | `/tmp/mobile-live-ui-final-smoke-v2/report.json` |
| 320/375/390px, 라이트·다크, 하단 버튼 | 네 게임 모두 가로 넘침과 도구 겹침 검사 통과 | 같은 보고서의 geometry 항목 및 PNG |
| 1280px | 모바일 클래스 제거·도구 숨김·모바일 복귀 통과 | 같은 보고서의 gate 항목 |
| 채팅·주문·참여자 | 실제 두 브라우저 전달과 네이티브 도구 접근 통과 | 같은 보고서 |
| 로그인·새 서버·가입 대기·승인·서버 방 합류 | 통과 | `/tmp/mobile-live-ui-auth-repeat/report.json` |
| 만료 토큰 | 로그인 삭제·자유 방 복귀·자유 별명 보존 통과 | 같은 auth 보고서 |
| 최종 데구리 전체 라운드 | 동물 버튼 클릭부터 서버 결과 비교까지 종료 코드 0 | `/tmp/mobile-live-ui-final-deguri/report.json` |
| 경마 선택 비공개 | 시작 전 다른 사용자의 선택이 수신 데이터에 없음 | 전체 라운드 보고서 |

전체 라운드 실행 당시에는 광고 폭과 출처 미분류 오류 때문에 실행 전체가 실패로
표시되었다. 각 게임의 서버 결과 비교 자체는 통과했다. 이후 UI 수정에 대한 최신
스모크 실행은 종료 코드 0으로 통과했다. 스모크 실행은 라운드 완료를 명시적으로
건너뛰므로 위 두 증거를 구분한다.

## 발견 후 재검증

- 로컬 디버그 패널의 고정 폭과 하단 클릭 차단: 담당자가 모바일 범위에서 숨김 처리.
- 고정 광고의 하단 도구 가림: 광고를 일반 흐름으로 옮기고 잔여 z-index 제거.
- 375→320px 변경 시 광고 iframe 폭 유지: 광고 컨테이너 내부 스크롤로 문서 넘침 방지.
- 데구리 리사이즈 지연 중 캔버스 폭 유지: 전체화면 밖 최대 폭 제한.
- 최종 스모크에서 위 항목을 모두 다시 확인했다.

Playwright가 `W`로 전달한 오류는 브라우저의 실제 `error` 이벤트에서
`pagead2.googlesyndication.com/.../adsbygoogle.js`의 중복
`enable_page_level_ads` TagError와 대응했다. 스크립트는 문구만으로 무시하지 않고
동일 컨텍스트·발생 시각·스크립트 URL을 대조한 오류만 `externalErrors`에 별도
보존한다. 앱 자체 오류와 미분류 오류는 여전히 실패 처리한다. 테스트용 저장소
초기화는 최상위 localhost 문서에서만 실행하여 광고 iframe에 접근하지 않는다.

## 범위와 남은 제한

- 루트 별도 검증: 수정 전 서버와 네 게임의 1280px 주요 계산 스타일 동일,
  경마 네이티브 전체화면 진입/종료 시 도구 숨김/복원, 비공개 주사위 오답 암호 거부,
  정상 입장 후 연속 5회 새로고침과 확인 후 로비 복귀를 통과했다.
- 연속 QA 요청으로 기존 `/api`의 100회/15분 제한에 도달해 링크 재입장이 429로
  멈췄다. 제한 코드는 변경하지 않았으며 별도 새 로컬 검증 서버(43115)의 초기 상태에서
  5회 재입장을 확인했다. 실제 사용자 검토용 서버도 새로 시작한다.
- 새 모바일 로비는 불필요한 page-level 광고 설정 push를 제거했고, 최종 밀도 측정 시
  페이지 오류가 없었다. 기존 게임의 외부 광고 설정은 이번 범위에서 유지했다.
- 가입 승인 직후 목록 갱신이 한 번 지연되어 타임아웃했다. 같은 테스트의 최초 및
  재실행은 통과했으며 담당자에게 재현 정보(serverId 4)를 전달했다.
- 실제 광고의 외부 TagError는 유지되고 별도 기록된다.
- 헤드리스 Chromium 결과이며 실제 iOS Safari·스크린리더 사용성은 인증하지 않는다.
