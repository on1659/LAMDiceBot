# LAMDiceBot 모바일 앱화 — 설계 · 견적 (Android 우선)

> 상태: **설계/견적 단계** (구현 착수 전). 각 Phase는 확정 후 `/autogoal`로 개별 진입하여 구현한다.
> 작성 근거: 2026-07-21 코드베이스 실측.

## 0. 한 줄 요약

클라이언트가 순수 웹(모든 소켓이 `io()` 상대 연결, API가 `/api/...` 상대 경로)이라 **WebView로 감싸면 통신 코드 수정 0줄로 동작**한다. 앱화 자체는 유리하다. 단 하나의 큰 작업량은 **AdSense → AdMob 이전**(실측 광고 슬롯 124개)이고, 하나의 큰 리스크는 **시뮬레이션 도박 콘텐츠 등급**이다. 권장 경로는 **PWA(Phase 0) → Capacitor Android(Phase 1) → Capacitor iOS(Phase 2)** 단계 진행.

## 1. 목표 / 범위

- LAMDiceBot(주사위·룰렛·경마·사다리 등 멀티플레이어 랜덤 게임)을 Android/iOS 네이티브 앱으로 배포.
- **Android 우선**, iOS는 후행.
- 서버(Express + Socket.IO + Postgres)는 그대로 두고, 클라이언트를 앱으로 패키징하는 것이 범위. 서버 재작성은 범위 밖.

## 2. 현 구조 진단 (견적의 근거)

### 유리한 점 (앱화를 쉽게 만드는 요소)

| 사실 | 확인 위치 | 의미 |
|------|-----------|------|
| 모든 소켓이 `io()` 인자 없음 | `D:\Work\LAMDiceBot\js\horse-race.js`, `js\ladder.js`, `js\pirate.js`, `js\spin-arena.js`, `js\bridge-cross.js`, `roulette-game-multiplayer.html`, `dice-game-multiplayer.html` | 서빙 origin에 자동 연결 → WebView가 `https://lamdice.com`을 로드하면 소켓 그대로 붙음 |
| API 전부 `/api/...` 상대 경로 | `CLAUDE.md` 계약, `routes/api.js` | 절대 URL 하드코딩 없음 → mixed-content·CORS 이슈 없음 |
| 게임 판정 100% 서버 권위 | `socket/*` | 클라이언트는 시각화만 → 앱이든 웹이든 로직 동일, 공정성 유지 |
| HTTPS 배포 운영 중 | `https://lamdice.com` (`index.html` canonical) | PWA·TWA·App Store의 HTTPS 전제 충족 |

### 걸림돌 (작업량·리스크를 만드는 요소)

| 사실 | 확인 위치 | 의미 |
|------|-----------|------|
| AdSense 광고 슬롯 **124개** | `<ins class="adsbygoogle">` × 24개 파일 (게임 페이지당 8, 정적 페이지당 4) | 앱/WebView 내 AdSense 게재는 구글 정책 위반 → **AdMob 이전 또는 앱 내 광고 제거 필수** |
| PWA 인프라 **전무** | `manifest`/`theme-color`/`apple-touch-icon`/`apple-mobile-web-app`/`viewport-fit` 검색 결과 0건 | Phase 0을 맨바닥부터 구축 |
| 앱 아이콘 에셋 없음 | `assets/` 내 192/512 아이콘 없음 | 아이콘·스플래시 에셋 제작 필요 |
| 콘텐츠 성격 = 주사위·룰렛·경마 | 게임 목록 | 스토어 자동심사에서 **시뮬레이션 도박**으로 분류될 수 있음 → 등급·심사 대응 필요 |
| 게임 HTML 대용량·잦은 변경 | `dice-game-multiplayer.html` 385KB 등 | 서비스워커가 HTML을 캐시하면 stale 위험 → 캐시 전략 주의 |

## 3. 경로 선택

| 방식 | 내용 | 스토어 | AdSense | 판정 |
|------|------|--------|---------|------|
| PWA | manifest+SW+아이콘, "홈 화면에 추가" | 불필요 | 유지 가능 | ✅ Phase 0 채택 |
| WebView 래핑 (Capacitor) | 네이티브 셸이 사이트 로드, 플러그인 확장 가능 | Play/App Store | AdMob 이전 필요 | ✅ Phase 1·2 채택 |
| WebView 래핑 (TWA) | Chrome 기반 얇은 래퍼, PWA 필수 | Play만 | AdMob 이전 필요 | △ Capacitor 대비 확장성 낮아 보류 |
| 네이티브 재작성 (RN/Flutter) | UI 전면 재개발 | 스토어 | — | ✗ 서버 권위 구조라 이득 대비 과투자 |

**선정: Capacitor 라인** — TWA보다 얇지 않지만, 이후 푸시 알림("네 차례!")·인앱결제·AdMob·iOS 확장을 한 프로젝트에서 처리할 수 있어 장기적으로 유리. Android/iOS 동일 코드베이스.

### WebView 콘텐츠 전략 (Phase 1에서 확정)

- **A. 원격 로드** (`server.url = https://lamdice.com`): 셸은 얇고 콘텐츠는 서버 최신본 즉시 반영(앱 재배포 불필요). 오프라인 불가. **v1 권장.**
- **B. 로컬 번들**: HTML/CSS/JS를 앱에 포함, 소켓·API만 서버로. `io()` → `io('https://lamdice.com')`, `/api` → 절대 URL 치환 필요. 첫 로딩 빠르고 더 "네이티브"하게 보이나 작업량 큼.
- 멀티플레이어는 본질상 온라인 전용이므로 v1은 **A(원격 로드)** 가 합리적.

## 4. Phase별 작업 · 견적

> 작업일은 **코드베이스에 익숙한 1인 개발자 기준 러프 추정**. 스토어 심사 대기(수 일)는 별도.

### Phase 0 — PWA (스토어·광고이전 없이 "앱처럼")

| 작업 | 산출물 | 난이도 | 추정 |
|------|--------|--------|------|
| `manifest.json` 작성 | name/icons/theme/display:standalone/start_url/orientation | 낮음 | 0.5d |
| 아이콘·스플래시 에셋 | 192·512·maskable·apple-touch(180)·favicon | 중 (디자인 필요) | 0.5~1d |
| `<head>` 스니펫 삽입 | theme-color, apple-mobile-web-app-*, viewport-fit=cover, manifest link — 게임 10 + index + `pages/*` = 약 24개 파일 | 중 (반복) | 0.5d |
| 서비스워커 | **HTML 비캐시(network-first)**, 정적 에셋만 캐시 → stale 방지 | 중 (주의 요) | 0.5~1d |
| 세이프에어리어 대응 | `env(safe-area-inset-*)` standalone 전체화면 노치 대응 | 낮음 | 0.5d |
| **소계** | | | **~2~3d** |

- 효과: Android(Chrome)·iOS(Safari 홈 화면 추가) 양쪽 즉시 전체화면 앱 경험. AdSense 그대로 합법.
- 주의: 서비스워커가 대용량 게임 HTML을 캐시하면 배포 후에도 구버전이 뜬다 → HTML은 network-first, 버전드 정적 에셋만 cache-first.

### Phase 1 — Android 앱 (Capacitor, Play Store)

| 작업 | 산출물 | 난이도 | 추정 |
|------|--------|--------|------|
| Capacitor 도입 | `@capacitor/core`,`cli`,`android`, `capacitor.config` (원격 로드) | 낮음 | 0.5d |
| 네이티브 셸 폴리시 | 하드웨어 back(히스토리/종료확인), 스플래시, 상태바, 외부링크는 시스템 브라우저로 | 중 | 1~2d |
| **AdMob 이전** | 앱 UA 감지 → 인라인 AdSense 숨김 + AdMob 앵커 배너 + 게임 종료 전면(interstitial). 124슬롯 1:1 아님, 배치 재설계 | **높음** | 2~4d |
| 딥링크(선택) | 방 공유 링크로 앱 열기 | 중 | 1d (선택) |
| 스토어 셋업 | Play Console($25), 리스팅, 스크린샷, 데이터 안전 폼, 콘텐츠 등급, AAB 서명·업로드 | 중 | 1~2d |
| **소계** | | | **~1~2주** (+심사 대기) |

- 개인정보처리방침 존재(`pages/privacy-policy.html`) → 데이터 안전 폼에 활용 가능 ✓
- ⚠️ 콘텐츠 등급: 주사위·룰렛·경마 → 자동심사가 "시뮬레이션 도박"으로 볼 수 있음. **실제 금전/현금성 보상 요소가 없음**을 전제로 올바른 등급(성인/17+ 상향 가능)만 매기면 게재 가능. §6 참조.

### Phase 2 — iOS 앱 (Capacitor, App Store)

| 작업 | 산출물 | 난이도 | 추정 |
|------|--------|--------|------|
| iOS 타깃 추가 | 동일 프로젝트 `npx cap add ios` | 낮음 | 0.5d |
| 빌드 환경 | **Mac + Xcode** 또는 클라우드 CI(Codemagic/EAS/Appflow) | 전제조건 | — |
| iOS 셸 대응 | 노치/다이내믹아일랜드 세이프에어리어, back 제스처, 스플래시, 상태바 | 중 | 1~2d |
| **4.2 최소기능 대응** | 순수 웹뷰 리젝 위험 → 푸시(APNs)·네이티브 공유·햅틱 등 "웹 이상 가치" 추가 | **높음** | 2~4d |
| AdMob iOS + ATT | iOS 광고 유닛 + App Tracking Transparency 동의 | 중 | 1~2d |
| 스토어 셋업 | Apple 개발자($99/년), 리스팅, 심사(엄격, 재제출 여지) | 중 | 2~3d + 재심사 |
| **소계** | | | **~1.5~2.5주** (+엄격 심사) |

- iOS는 Mac 의존 + 심사 4.2/4.7 문턱으로 Android보다 확실히 무겁다 → **후행 정당함**.

## 5. 비용 (하드 코스트)

| 항목 | 비용 | 성격 |
|------|------|------|
| Google Play Console | **$25** | 1회 |
| Apple Developer Program | **$99 / 년** | iOS 진행 시 연간 |
| Mac (iOS 빌드) 또는 클라우드 CI | Mac 보유 시 0 / 없으면 Codemagic·EAS 무료~유료 | Phase 2 전제 |
| 아이콘·스플래시 에셋 | 기존 로고 활용 시 최소 | 1회 |
| AdMob | 무료(수익쉐어) | — |

- 개발 공수 합계(러프): Phase 0 **~2~3일** / Phase 1 **~1~2주** / Phase 2 **~1.5~2.5주**.

## 6. 리스크 · 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| **AdSense 앱 내 게재 위반** | 계정 정지 | 앱 빌드에선 인라인 AdSense 숨기고 AdMob으로 대체 (웹은 AdSense 유지 → 광고 레이어 웹/앱 분기) |
| **시뮬레이션 도박 등급** | 심사 지연/거절 | 실제 금전·현금성 보상 부재 확인 → 정확한 콘텐츠 등급 신고, 필요 시 연령 상향. Apple 4.7(무료·17+·비현금) 준수 |
| Apple 4.2 최소기능 리젝 | iOS 출시 지연 | 푸시·공유·햅틱 등 네이티브 기능 선탑재로 "웹 이상 가치" 확보 |
| 서비스워커 stale HTML | 구버전 노출 | HTML network-first, 정적 에셋만 버전드 캐시 |
| 유지보수 이중화 | 운영 부담 | v1은 원격 로드로 콘텐츠 즉시 반영, 네이티브 셸 변경만 재배포 |

## 7. 확정 필요 결정 항목 (견적 → 착수 전환 전 사용자 결정)

1. **앱 내 광고**: (a) 앱에선 광고 제거 / (b) AdMob 배너+전면 도입 / — (AdSense 유지는 불가)
2. **WebView 콘텐츠**: A 원격 로드(권장) / B 로컬 번들
3. **iOS 빌드 환경**: Mac 보유 여부 / 클라우드 CI 사용 여부
4. **콘텐츠 등급 사실**: 게임에 실제 금전·현금성 보상 요소가 전혀 없는가? (없어야 안전)
5. **아이콘/스플래시**: 기존 로고로 파생 가능한가, 새 디자인이 필요한가

## 8. 관련 자산 메모

- `D:\Work\LAMDiceBot\horse-app\` = React 19 + Vite + TS + Tailwind4 + Zustand + socket.io-client SPA. 팀에 모던 빌드 툴체인이 이미 있음. **장기적으로** 게임 클라이언트를 이 스택으로 옮기면 Capacitor **로컬 번들** 전략과 궁합이 좋아짐(현재 385KB 모놀리식 HTML 대비). 단, 이번 앱화 범위와는 별개 트랙 — 참고용.

## 9. 다음 단계

1. §7 결정 항목 확정.
2. Phase 0(PWA)부터 `/autogoal`로 개별 진입 → 구현.
3. Phase 0 완료·검증 후 Phase 1(Android) 착수.
