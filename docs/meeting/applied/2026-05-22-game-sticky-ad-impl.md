# Impl: 게임 페이지 스티키 하단 광고 (레버 1)

작성: 2026-05-22 · 트리아지: COMPLEX · 출처: office-hours 광고 배치 세션

## 목표

4개 게임 페이지(dice / roulette / horse-race / bridge-cross)에 화면 하단 고정 스티키 광고를 추가한다. 로비·ready 화면에서 노출하고, 레이스(게임 결과 애니메이션) 진행 중에는 숨긴다.

## 배경

게임이 반복 플레이된다(누적 331 horse-race 라운드). 매 라운드 플레이어가 보는 ready 화면에 스티키 광고를 두어 노출을 확보한다. "게임 진행 중 무광고" 원칙은 유지 — 레이스 중에는 숨긴다.

## 수정 대상 (5파일)

- `dice-game-multiplayer.html`
- `roulette-game-multiplayer.html`
- `horse-race-multiplayer.html`
- `bridge-cross-multiplayer.html`
- `css/theme.css`

`js/ads.js`는 수정 불필요 — `initAds()`가 `.ad-container`를 자동 순회한다.

## 명세

### 1. 스티키 광고 마크업 (4개 게임 HTML 각각)

각 게임 HTML에 아래 블록을 추가한다. `position:fixed`라 DOM 위치는 무관하나, 일관되게 기존 footer 광고 블록 근처에 둔다.

```html
<!-- ⚠️ AdSense 블록 — 삭제 금지 -->
<!-- Ad: Sticky Bottom Banner -->
<div class="ad-container ad-sticky">
  <span class="ad-label">AD</span>
  <ins class="adsbygoogle"
       style="display:block"
       data-ad-client="ca-pub-1608259764663412"
       data-ad-slot="STICKY_SLOT_ID"
       data-ad-format="horizontal"
       data-full-width-responsive="true"></ins>
</div>
```

- `data-ad-slot="STICKY_SLOT_ID"`는 placeholder. 사용자가 AdSense 대시보드에서 신규 디스플레이 단위를 만든 뒤 실제 ID로 치환한다.
- `.ad-container` 클래스 유지 필수 — `initAds()` 자동 픽업 + `body.premium` 자동 숨김 상속.

### 2. css/theme.css 신규 규칙

```css
/* 게임 페이지 스티키 하단 광고 */
.ad-container.ad-sticky {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  margin: 0;
  min-height: 0;
  padding: 4px 8px;
  z-index: 900;                 /* 모달(1000) 미만 — 결과/비번 모달이 위를 덮음 */
  box-shadow: 0 -2px 8px rgba(0,0,0,0.12);
}
body.race-running .ad-container.ad-sticky {
  display: none;
}
@media (max-width: 480px) {
  .ad-container.ad-sticky { padding: 2px 4px; }
}
```

- 배경색은 기존 테마 토큰(`var(--bg-*)`)을 사용해 광고가 게임 화면 위에서 읽히게 한다 — Coder가 기존 토큰 확인 후 적용.
- 기존 `.ad-container { margin:20px auto; min-height:90px }`가 스티키에 적용되면 깨지므로 위 override 필수.
- `body.premium .ad-container { display:none !important }`(theme.css 기존)는 자동 상속 — 별도 작업 없음.

### 3. 콘텐츠 가림 방지

스티키가 `position:fixed`로 화면 하단을 덮으므로, 각 게임 페이지에서 스크롤 최하단 요소(채팅 입력창 등)가 가려지지 않도록 본문 하단에 광고 높이만큼 여백을 확보한다. 적용 방법(`body` 또는 메인 컨테이너 `padding-bottom`)은 Coder가 각 게임 레이아웃에 맞게 결정한다.

### 4. body.race-running 토글 (4개 게임 JS)

레이스(결과 애니메이션) 진행 동안 `document.body`에 `race-running` 클래스를 추가/제거한다.

- **추가 시점**: 결과 애니메이션 시작 순간 — 주사위 굴림 / 룰렛 스핀 / 경마 레이스 / 다리건너기 시퀀스 시작.
- **제거 시점**: 결과가 확정돼 결과 오버레이가 뜨는 순간, 또는 ready 화면으로 복귀하는 순간.
- 결과 오버레이(모달, z-index 1000)가 스티키(900)를 덮으므로, 제거 시점이 결과 오버레이 등장과 겹쳐도 시각적 문제 없다.
- Coder는 각 게임의 정확한 hook(파일·함수·소켓 이벤트)을 찾아 적용하고, **사용한 hook을 보고서에 명시**한다.

게임별 구조 (Scout 정찰 결과):
- `dice`: 인라인 JS. `game-active` 양방향 토글 존재. `resultOverlay` 없음(동적 오버레이 사용).
- `roulette`: 인라인 JS. `resultOverlay` 보유.
- `horse-race`: `js/horse-race.js`. `resultOverlay` `classList.add('visible')` ≈ L3954.
- `bridge-cross`: `js/bridge-cross.js`. `.game-active` 클래스 자체가 없음 — race 신호를 시퀀스/결과 hook에 직접 단다.

`.game-active`는 "방 입장"을 뜻하지 "레이스 중"이 아니므로 race 토글 신호로 쓰지 않는다.

## 불변조건 (must-preserve)

- 기존 `<!-- ⚠️ AdSense 블록 — 삭제 금지 -->` 광고 블록 3종(lobby/game/footer)을 삭제·이동하지 않는다. 스티키는 추가만.
- `data-ad-client="ca-pub-1608259764663412"` 값 변경 금지.
- 스티키는 반드시 `.ad-container` 클래스를 포함한다.
- z-index < 1000 — `passwordModal`·`resultOverlay` 위에 뜨면 안 된다.
- 상단 `controlBarMount`·하단 `chatInput`을 가리지 않는다.
- 기존 게임 동작 회귀 0. 4게임 모두 적용 — 한 게임도 누락 금지.

## 검증 (수동 QA — 4게임 각각)

로컬 5173 + 2탭:
1. ready 화면에서 스티키 광고 영역이 화면 하단에 보인다.
2. 레이스 시작하면 스티키가 사라진다.
3. 레이스 종료/결과 후 ready 복귀 시 스티키가 다시 보인다.
4. 결과 모달이 스티키 위를 덮는다(z-index).
5. 채팅 입력창이 스티키에 가려지지 않는다.
6. 모바일 폭(≤480px)에서 레이아웃이 깨지지 않는다.
7. 브라우저 콘솔 에러 0.

## 후속 (이번 스코프 아님)

- `STICKY_SLOT_ID` → 실제 AdSense 단위 ID 치환 (사용자 대시보드 작업).
- 중복 슬롯 ID `3774585551`(ad-game ↔ footer) 정리.
- 레버 2: 결과 화면 de-modal + 광고.
