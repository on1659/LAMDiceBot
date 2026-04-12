# Merge Review: feature/design-unification → main

> **Date**: 2026-04-12
> **Reviewer**: Claude Opus 4.6 전수 조사
> **Commits**: main 이후 40+ commits

---

## 1. 사용자 체감 변경 (브라우저에서 보이는 것)

### 1-1. 게임 시작 카운트다운 추가 (NEW)

| 게임 | 동작 | 호출 |
|------|------|------|
| 주사위 | 전체 화면 오버레이 3-2-1-START! | `showGameCountdown(null)` |
| 룰렛 | 룰렛 컨테이너 내부 오버레이 | `showGameCountdown('rouletteContainer', cb)` |
| 경마 | 트랙 내부 오버레이 (기존 인라인→공유모듈) | `showGameCountdown('raceTrackContainer')` |

- 색상: 3(빨강) → 2(노랑) → 1(초록) → START!(파랑)
- `countPop` 스케일 애니메이션 + 글로우 텍스트 섀도우
- 파일: `js/shared/countdown-shared.js` (56줄, 신규)
- **체감도: ★★★** — 게임 시작마다 보임

### 1-2. 룰렛 배경색 변경

| Before | After |
|--------|-------|
| `#8e99a4` (회색 그라디언트) | `#1a5c3a → #2d7a52` (딥그린 그라디언트) |

- 룰렛 포인터(화살표): `#ff1744` → `var(--roulette-pointer)` (동일 색상, 변수화)
- **체감도: ★★★** — 입장 즉시 분위기가 다름

### 1-3. 메인 페이지 (index.html) 리디자인

| 영역 | Before → After |
|------|----------------|
| 헤더 | 단색 배경 → 글래스모피즘 (`backdrop-filter: blur(12px)`) |
| 히어로 제목 | 2em → 2.5em, 모바일 1.5em → 1.8em |
| CTA 버튼 | 각진 14px → 필 모양 50px + `cta-pulse` 3초 주기 애니메이션 |
| 게임 카드 | 플랫 → 상단 게임별 컬러 강조선 + `card-in` 페이드인 |
| 콘텐츠 링크 | hover 배경만 → +`translateY(-2px)` 마이크로인터랙션 |

- **체감도: ★★☆** — 메인 페이지 방문자에게는 큼, 직접 게임 접속자는 안 봄

### 1-4. 게임 상태 바 통일 (3게임 동일)

| 상태 | 클래스 | 배경 | 글자색 |
|------|--------|------|--------|
| 대기 | `.waiting` | `--gray-100` | `--gray-700` |
| 주문 | `.ordering` | `--status-warning-bg` | `--status-warning-text` |
| 진행 | `.playing` | `--status-success-bg` | `--status-success-text` |

- 주사위 `font-weight: 600` → `bold` 통일
- **체감도: ★☆☆** — 3게임 번갈아 하는 사람만 느낌

### 1-5. 컨트롤바 공유 모듈 (control-bar-shared.js)

- 방 제목 + 호스트 뱃지 + 볼륨 슬라이더 + 나가기 버튼 → 동적 생성
- 볼륨 설정이 게임별 localStorage에 독립 저장
- 뮤트 토글 아이콘: 🔇 → 🔈 → 🔊 (볼륨 단계별)
- **체감도: ★★☆** — 볼륨 컨트롤이 전 게임 일관됨

### 1-6. 랭킹 시스템 강화

- 랭킹 CSS 하드코딩 → CSS 변수 전환
- **시즌 아카이브**: 호스트가 새 시즌 시작 가능 + 과거 시즌 열람
- 시즌 선택 드롭다운, 호스트 전용 "새 시즌" 버튼 + 확인 모달
- 경마 탈것 이름 매핑 4종 추가 (knight/dinosaur/ninja/crab)
- **체감도: ★★☆** — 랭킹 기능 사용자에게 의미 있음

### 1-7. 광고 배치 변경

| 위치 | 변경 |
|------|------|
| 게임중 하단 | 3게임 모두 `ad-container ad-game` 슬롯 **신규 추가** |
| 로비 | 룰렛/경마 `ad-lobby`를 접속자 목록 아래로 이동 |
| 페이지 하단 | SEO 섹션 앞 → footer 앞으로 이동 |

- **체감도: ★★☆** — 게임중 광고가 새로 보임

### 1-8. 히스토리 패널 통일

- 인라인 `font-family` 제거 → 상속
- `.history-section.visible` 토글 통일 (`body.game-active` 조건 제거)
- 타이틀 스타일 3게임 동일
- **체감도: ★☆☆** — 미세한 차이

### 1-9. 방 폭파 카운트다운 UI 개선

- 0초 도달 시 배경: 노란색 → 빨강 (`--status-danger-bg`)
- 텍스트: 빨강 (`--status-danger-text`)
- **체감도: ★☆☆** — 방 만료 직전에만 보임

### 1-10. 경마 말 선택 UI

- 준비 상태 변경 시 "선택 안 한 사람" 목록 실시간 갱신
- **체감도: ★☆☆** — UX 편의

---

## 2. 사용자 비체감 변경 (내부 구조)

### 2-1. CSS 변수 토큰화

- rgba 하드코딩 → `rgba(var(--dice-500-rgb), 0.3)` 패턴
- RGB 채널 변수 7개 (라이트/다크 모드)
- 파스텔 배경 토큰: `--dice-accent-bg`, `--roulette-accent-bg`, `--horse-accent-bg`
- 링크 색상 토큰: `--link-brand`, `--heading-brand`

### 2-2. 프로젝트 파일 구조 정리 (50+ 파일 이동)

| From | To |
|------|-----|
| `config.js` | `config/index.js` |
| `*-shared.js` (루트 8개) | `js/shared/` |
| `gif-recorder.js`, `gif.worker.js` | `js/` |
| `tagline-roller.js` | `js/` |
| `gemini-utils.js` | `utils/` |
| SEO HTML 18개 (루트) | `pages/` |
| `test-*.js` (루트) | `tests/` |

### 2-3. SEO 페이지 301 리다이렉트

- `routes/api.js`에 18개 구 URL → `/pages/` 영구 리다이렉트 추가
- `sitemap.xml` 전체 URL 업데이트

### 2-4. DB 확장 (시즌 아카이브)

- `servers` 테이블: `current_season INTEGER DEFAULT 1` 컬럼 추가
- `season_archives` 테이블 신규 생성 (`CREATE TABLE IF NOT EXISTS`)
- `db/ranking.js`: 4개 함수 추가 (기존 시그니처 변경 없음)
- `routes/server.js`: 4개 API 엔드포인트 추가

### 2-5. 문서 정리

- `docs/GameGuide/` 전면 재구성 (00~04 + 90-archive)
- 구 회의록/impl 대량 삭제 (100+ 파일)
- `AutoTest/` 전체 삭제 (재설계 예정)
- `summit-log.txt`, `update-log_old.md` 등 레거시 삭제

### 2-6. 크레인 게임 비공개 처리

- 참조 전체 제거, `crane-game-multiplayer.html` 최소화

### 2-7. 텔레그램 봇 코드 분리

- 게임 서버에서 제거 → LAMDice-Pilot 프로젝트로 이관

---

## 3. 발견된 이슈 및 조치

### 수정 완료

| # | 이슈 | 심각도 | 조치 |
|---|------|--------|------|
| 1 | `tutorial-shared.js` 경로 오류 (3개 HTML에서 404) | **CRITICAL** | `/js/shared/tutorial-shared.js`로 수정 (aacf2d0) |
| 2 | `update-log_old.md` fetch 참조 (삭제된 파일) | MEDIUM | fetch 제거, `update-log.md`만 로드 (aacf2d0) |
| 3 | `horse-app/dist/index.html` 구 경로 (공유 JS 4개 404) | **CRITICAL** | `/js/shared/` 경로로 수정 (이번 커밋) |
| 4 | `README.md` 삭제된 `DEVELOPMENT_GUIDE.md` 참조 | LOW | GameGuide 링크로 교체 (이번 커밋) |

### 잔존 이슈 (낮은 위험)

| # | 이슈 | 심각도 | 비고 |
|---|------|--------|------|
| 1 | `horse-app/dist`는 빌드 결과물 — 수동 수정은 임시, 정식은 `npm run build` | LOW | 소스(`horse-app/index.html`)는 이미 정상 |
| 2 | `.claude/commands/qa.md`에서 삭제된 `AutoTest/console-error-check.js` 참조 | LOW | Claude 내부 문서, 서비스 영향 없음 |
| 3 | `backdrop-filter` Firefox 제한적 지원 (메인 페이지) | LOW | Firefox 점유율 낮고 graceful degrade |

---

## 4. 위험도 평가

### 서비스 영향 체크리스트

| 항목 | 상태 | 비고 |
|------|------|------|
| 기존 게임 접속 (/dice, /roulette, /horse-race) | SAFE | 라우트 변경 없음 |
| 기존 API 호환성 | SAFE | 시그니처 변경 없음, 응답 필드 추가만 |
| DB 마이그레이션 | SAFE | `IF NOT EXISTS`, `EXCEPTION WHEN duplicate_column` |
| SEO 페이지 구 URL | SAFE | 301 리다이렉트 처리 |
| 공유 JS 모듈 로드 | SAFE | 경로 전체 수정 완료 |
| horse-app (React) | **CAUTION** | dist 수동 수정됨, 빌드 권장 |
| Socket 이벤트 | SAFE | 이벤트명/시그니처 변경 없음 |

### Breaking Changes

**없음.** 모든 변경은 추가 또는 내부 리팩터링.

---

## 5. 머지 전 권장 테스트

### P0 (필수)

- [ ] 주사위 게임: 방 생성 → 게임 시작 → **3-2-1 카운트다운 표시 확인** → 게임 진행
- [ ] 룰렛 게임: 방 생성 → 게임 시작 → **카운트다운 표시 확인** → 룰렛 회전
- [ ] 경마 게임: 방 생성 → 탈것 선택 → **카운트다운 표시 확인** → 레이스 진행
- [ ] 경마 (horse-app): `/horse-race` 접속 → 채팅/준비/주문 정상 작동 확인
- [ ] 랭킹 오버레이: 채팅 헤더 🏆 버튼 → 랭킹 표시/닫기

### P1 (권장)

- [ ] 메인 페이지: CTA 버튼 펄스 애니메이션, 게임 카드 페이드인
- [ ] 룰렛: 배경이 딥그린인지 확인
- [ ] 구 SEO URL (`/about-us.html`) → `/pages/about-us.html` 리다이렉트
- [ ] 볼륨 슬라이더: 조절 → 새로고침 후 유지
- [ ] 모바일: 게임 3개 + 메인 페이지 레이아웃

### P2 (선택)

- [ ] 시즌 아카이브: 호스트로 "새 시즌" 시작 → 과거 시즌 조회
- [ ] 다크 모드: 색상 변수가 정상 적용되는지
- [ ] 게임중 하단 광고 표시 여부
