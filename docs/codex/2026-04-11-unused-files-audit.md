# 미사용 파일 점검

날짜: 2026-04-11
브랜치: `feature/design-unification`

## 점검 범위

이번 점검은 프로젝트 전체를 훑어보며 아래 기준으로 정리했습니다.

- 실제 서버 실행 경로
- HTML, JS, CSS의 참조 관계
- 테스트 및 자동화 폴더 상태
- 프로토타입, 목업, 로컬 도구 산출물

## 현재 실제 실행 경로

현재 운영 기준 진입점은 `server.js`와 `routes/api.js`입니다.

실제로 연결된 주요 파일:

- `dice-game-multiplayer.html`
- `roulette-game-multiplayer.html`
- `horse-race-multiplayer.html`
- `admin.html`
- `pages/*.html`

핵심 확인 사항:

- `/horse-race` 라우트는 아직 `horse-race-multiplayer.html`을 직접 서빙하고 있음
- `horse-app`은 존재하지만 현재 운영 라우트의 실제 대상은 아님

## 바로 정리해도 될 가능성이 큰 항목

아래는 실행 경로 기준으로 영향이 거의 없어 보이는 항목입니다.

- `.bkit/`
  - 로컬 도구 산출물
  - 현재 git 미추적 상태
- `AutoTest/node_modules/`
  - 생성물 폴더
  - `.gitignore`에도 제외 대상
- `horse-app/README.md`
  - 기본 Vite 템플릿 README
- `AutoTest/roulette/test-results.log`
  - 테스트 로그 산출물

## 삭제 전에 결정이 필요한 항목

실행 경로에는 직접 연결되지 않지만, 참고 자료나 향후 작업 자산일 수 있는 항목들입니다.

- `prototype/`
  - 목업, 실험, 프로토타입 HTML 다수 포함
  - 일부 문서에서 참고 자료로 사용 중
- `horse-app/`
  - 현재는 운영 경로 비사용
  - 테스트와 문서에서 계속 언급됨
- `horse-app/dist/`
  - 빌드 결과물은 있으나 현재 Express 라우트에서 사용하지 않음
- `pages/server-members.html`
  - 라우트 목록에는 남아 있음
  - 내부 링크는 약해서 사실상 고아 페이지일 가능성 있음
- `js/gif-recorder.js`
- `js/gif.worker.js`
  - 경마 HTML에서 관련 기능이 비활성화된 흔적이 있음
  - 다만 코드 참조가 일부 남아 있어 즉시 삭제는 보류 권장

## 단순 미사용보다 상태 정리가 필요한 항목

아래는 "안 쓰는 파일"보다는 "구조가 중간에 끊긴 상태"에 가깝습니다.

- `package.json`
  - `test-bot` 스크립트가 `dice-test-bot.js`를 가리키지만 실제 파일이 없음
- `AutoTest/`
  - 문서와 `CHANGELOG.md`에서 가리키는 파일 다수가 현재 없음
  - 누락된 참조 예시:
  - `AutoTest/dice/dice-test-bot.js`
  - `AutoTest/roulette/test-bot.js`
  - `AutoTest/console-error-check.js`
  - `AutoTest/horse.bat`
- 현재 `AutoTest` 폴더 실체는 대부분 아래 수준임
  - `horse-race/test-loser-slowmo.js`
  - `roulette/test-results.log`
  - `node_modules/`

## 유지 대상

아래는 미사용으로 보면 안 되는 항목입니다.

- `frequentMenus.json`
  - `db/menus.js`의 파일 폴백으로 사용
- `suggestions.json`
  - `db/suggestions.js`의 파일 폴백으로 사용
- `robots.txt`
- `sitemap.xml`
- `ads.txt`
- `js/ads.js`
- `js/tagline-roller.js`

## 권장 정리 순서

1. 로컬 산출물과 생성 파일부터 정리
2. `package.json` 및 테스트 문서의 깨진 참조 복구
3. `horse-app`을 유지 자산으로 볼지 폐기 대상으로 볼지 결정
4. `prototype/`을 계속 보관할지 별도 아카이브로 옮길지 결정
5. `pages/server-members.html` 같은 약한 연결 페이지 재검토

## 요약

현재 실제 운영 경로는 React 경마 앱보다 레거시 HTML + 공유 JS 구조에 더 가깝습니다.

정리 우선순위가 높은 쪽:

- 로컬 도구 산출물
- 테스트 로그/생성물
- 깨진 테스트 참조
- 오래된 프로토타입 자산

삭제 판단이 가장 조심스러운 쪽:

- `horse-app`
- 문서에서 참조하는 프로토타입 파일들
- 완전히 끊기지 않은 GIF/리플레이 관련 파일
