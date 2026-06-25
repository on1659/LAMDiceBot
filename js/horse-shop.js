/*
 * horse-shop.js — 경마 꾸미기 상점 어댑터 (ShopModule 위에 얇은 게임 어댑터)
 *
 * 전역 `HorseShop`. 공통 셸(인증/지갑/모달/구매/장착/잔고연출)은 js/shared/shop-shared.js
 * (window.ShopModule)이 담당. 이 어댑터는 경마 고유부만 보유:
 *   - 차량 SVG 미리보기(buildPreview hook, getVehicleSVG 의존)
 *   - 내 탈것에 장착 적용(applyToHorse / applyEquippedToHorse / applyToActiveHorses)
 *   - 개인 연출(track_theme 틴트 applyMyTrackTheme, finish_fx playFinishFx) — 본인 장착을 본인 화면에서만
 *
 * 공개 API(window.HorseShop.*)는 기존 그대로 유지(호출부: js/horse-race.js, HTML onclick).
 *
 * 공정성: cosmetic 데이터는 결과 계산이나 게임 emit에 진입하지 않는다.
 *   도색 필터는 .vehicle-sprite 에만(이벤트 연출이 .horse filter 점유).
 *   Math.random()은 결승연출(playFinishFxInto) 조각의 외형(위치/딜레이/크기) 산개에만 사용 — 결과 무관.
 */
(function () {
    'use strict';

    var CATALOG_URL = '/config/horse/cosmetics.json';
    // 상점 탭(슬롯). track_theme/finish_fx는 개인 연출 — 내가 장착하면 내 화면에만 적용(방장·우승 무관).
    var SLOTS = [
        { key: 'paint', label: '🎨 도색' },
        { key: 'trail', label: '✨ 트레일' },
        { key: 'accessory', label: '👑 액세서리' },
        { key: 'bib', label: '🏷️ 이름표' },
        { key: 'aura', label: '🌟 오라' },
        { key: 'track_theme', label: '🏞️ 트랙테마' },
        { key: 'finish_fx', label: '🎆 결승연출' }
    ];

    // 카드 썸네일에 실제 탈것을 그려 꾸미기 적용 모습을 미리보기로 보여줄 슬롯
    var HORSE_PREVIEW_SLOTS = ['paint', 'trail', 'accessory', 'bib', 'aura'];
    var PREVIEW_VEHICLE = 'car'; // 미리보기 샘플 탈것 (getVehicleSVG, horse-race-sprites.js)

    // 액세서리(머리 장식) 탈것별 앵커 — 외관 보정용(공정성 무관, Math.random 미사용).
    //   .cosmetic-accessory 의 offset parent 는 .horse(80×80). 스프라이트(60×45)는 flex 중앙정렬이라
    //   왼쪽 inset 10px, 위쪽 inset 17.5px. SVG viewBox(0..60, 0..45) head 좌표(vbX,vbY) →
    //   left = 10 + vbX, top = 17.5 + vbY (px, .horse 기준). 장식은 머리 바로 위에 얹히도록 y를 살짝 띄움.
    //   x = 머리의 가로 중심(화면 기준, helicopter 는 좌우반전 후 좌표). scale 은 폭 좁은 탈것에서 축소.
    //   탈것 추가(addvehicle) 시 항목 없으면 ACC_ANCHOR_DEFAULT 로 안전 폴백(클리핑 방지).
    var ACC_ANCHOR_DEFAULT = { x: 30, y: 6, scale: 1 };
    var ACC_ANCHOR = {
        car:        { x: 29, y: 8,  scale: 1 },   // 캐빈/앞유리 위, 중앙
        rocket:     { x: 50, y: 10, scale: 1 },   // 노즈콘 우측 상단
        bird:       { x: 48, y: 13, scale: 0.9 }, // 머리(원 cx48) 위, 우향
        boat:       { x: 30, y: 6,  scale: 1 },   // 돛/마스트 꼭대기, 중앙
        bicycle:    { x: 35, y: 7,  scale: 0.9 }, // 라이더 머리(cx35) 위
        rabbit:     { x: 45, y: 1,  scale: 0.85 },// 귀 끝(y~3)보다 위, 우향
        turtle:     { x: 30, y: 8,  scale: 1 },   // 등껍질 정수리
        eagle:      { x: 48, y: 13, scale: 0.9 }, // 머리(원 cx48) 위, 우향
        scooter:    { x: 25, y: 13, scale: 0.9 }, // 라이더 머리(cx25) 위
        helicopter: { x: 20, y: 8,  scale: 0.9 }, // 좌우반전 → 화면상 콕핏 x~20
        horse:      { x: 46, y: 8,  scale: 1 },   // 우측 머리(cx46-48, 귀끝 y~9) 위 — 말은 우향
        knight:     { x: 30, y: 2,  scale: 0.9 }, // 깃털 장식(y~4-5)보다 위, 중앙
        dinosaur:   { x: 41, y: 12, scale: 1 },   // 머리(x34-48) 위, 우중앙
        ninja:      { x: 31, y: 9,  scale: 0.85 },// 머리/머리띠(y~11) 위, 폭 좁음
        crab:       { x: 30, y: 16, scale: 1 }    // 눈자루(y~18) 위, 정면
    };

    // ── 미리보기 빌더 (getVehicleSVG 등 게임 전역 접근은 이 어댑터 안에서만) ──

    // 샘플 탈것 SVG 1프레임 HTML (없으면 빈 문자열)
    function sampleVehicleHTML() {
        if (typeof getVehicleSVG !== 'function') return '';
        try {
            var svgs = getVehicleSVG(PREVIEW_VEHICLE);
            if (!svgs) return '';
            var data = svgs.idle || svgs.run || svgs.rest || svgs;
            return (data && data.frame1) ? data.frame1 : (svgs.frame1 || '');
        } catch (e) { return ''; }
    }

    // (slot, item)을 실제 탈것에 입힌 미리보기 노드. paint=필터, trail/accessory/bib=오버레이.
    function buildItemPreview(slot, item) {
        var box = document.createElement('div');
        box.className = 'hshop-preview';

        if (slot === 'trail' && item.emoji) {
            var tr = document.createElement('span');
            tr.className = 'hshop-preview-trail';
            tr.setAttribute('aria-hidden', 'true');
            tr.textContent = item.emoji + item.emoji + item.emoji + item.emoji;
            box.appendChild(tr);
        }

        // aura → 스프라이트 뒤(z-index 낮음) 글로우. 색은 인라인(item.color), CSS가 box-shadow/링 형태.
        if (slot === 'aura' && item.color) {
            var au = document.createElement('span');
            au.className = 'hshop-preview-aura';
            au.setAttribute('aria-hidden', 'true');
            au.style.color = item.color; // currentColor 기반 box-shadow (CSS)
            box.appendChild(au);
        }

        var sprite = document.createElement('div');
        sprite.className = 'hshop-preview-sprite';
        sprite.innerHTML = sampleVehicleHTML(); // 상수 SVG (유저입력 없음)
        if (slot === 'paint' && item.filter) sprite.style.filter = item.filter;
        box.appendChild(sprite);

        if (slot === 'accessory' && item.emoji) {
            var ac = document.createElement('span');
            ac.className = 'hshop-preview-acc';
            ac.setAttribute('aria-hidden', 'true');
            ac.textContent = item.emoji;
            box.appendChild(ac);
        }
        if (slot === 'bib') {
            var bb = document.createElement('span');
            bb.className = 'hshop-preview-bib';
            bb.setAttribute('aria-hidden', 'true');
            var _nm = '이름';
            try { var _a = JSON.parse(localStorage.getItem('userAuth') || 'null'); if (_a && _a.name) _nm = _a.name; } catch (e) {}
            bb.textContent = _nm;   // 사용자 입력 → textContent (안전)
            if (item.color) bb.style.color = item.color;
            if (item.bg) bb.style.background = item.bg;
            if (item.border) bb.style.borderColor = item.border;
            box.appendChild(bb);
        }
        return box;
    }

    // 트랙테마 미니 썸네일: (그라데이션은 thumb 배경이 이미 깔림) 지평선 + 달리는 탈것 실루엣.
    function buildTrackThemePreview(item) {
        var box = document.createElement('div');
        box.className = 'hshop-track-mini';
        box.setAttribute('aria-hidden', 'true');

        var ground = document.createElement('div');
        ground.className = 'hshop-track-ground';
        if (item && item.accent) ground.style.borderTopColor = item.accent;
        box.appendChild(ground);

        var svg = sampleVehicleHTML(); // 상수 SVG (유저입력 없음)
        if (svg) {
            var runner = document.createElement('div');
            runner.className = 'hshop-track-runner';
            runner.innerHTML = svg;
            box.appendChild(runner);
        }
        return box;
    }

    // 결승연출 미리보기: 큰 이모지 펄스 + 작은 조각 낙하 루프 + "▶ 미리보기"(실제 승리 연출 재생).
    //   미리보기 버튼 클릭 시 playFinishFxInto(stage, emoji)로 실제 in-race 결승 연출을 stage에 1회 재생.
    //   stage는 position:relative + overflow:hidden(CSS)이라 낙하가 카드 안에 클리핑된다.
    function buildFinishFxPreview(item) {
        var emoji = (item && item.emoji) ? item.emoji : '🎆';
        var box = document.createElement('div');
        box.className = 'hshop-fx-mini';

        var burst = document.createElement('span');
        burst.className = 'hshop-fx-burst';
        burst.setAttribute('aria-hidden', 'true');
        burst.textContent = emoji;
        box.appendChild(burst);

        for (var i = 0; i < 4; i++) {
            var p = document.createElement('span');
            p.className = 'hshop-fx-confetti';
            p.setAttribute('aria-hidden', 'true');
            p.textContent = emoji;
            p.style.left = (18 + i * 20) + '%';
            p.style.animationDelay = (i * 0.3) + 's';
            box.appendChild(p);
        }

        // 실제 결승 연출이 재생될 무대(빈 div). 낙하 클리핑은 CSS(.hshop-fx-stage)에서 보장.
        var stage = document.createElement('div');
        stage.className = 'hshop-fx-stage';
        stage.setAttribute('aria-hidden', 'true');
        box.appendChild(stage);

        // "▶ 미리보기" 버튼 — 클릭 시 실제 승리 연출 1회 재생(재생 중 disable, ~3500ms 후 해제).
        var playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'hshop-fx-preview-btn';
        playBtn.textContent = '▶ 미리보기';
        playBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (playBtn.disabled) return;
            playBtn.disabled = true;
            playFinishFxInto(stage, emoji);
            setTimeout(function () { playBtn.disabled = false; }, 3500);
        });
        box.appendChild(playBtn);

        return box;
    }

    // ShopModule이 카드 썸네일에 부를 미리보기 hook (slot별 분기). null이면 셸이 글리프 fallback.
    function buildPreview(slot, item) {
        if (slot === 'track_theme') return buildTrackThemePreview(item);
        if (slot === 'finish_fx') return buildFinishFxPreview(item);
        if (HORSE_PREVIEW_SLOTS.indexOf(slot) !== -1 && typeof getVehicleSVG === 'function') {
            return buildItemPreview(slot, item);
        }
        return null;
    }

    // ── 인벤토리 큰 미리보기 (내 탈것 + 현재 장착 전부 합성) ──

    // 인벤토리 미리보기 탈것 로스터(셸 ◀▶ 스위처용). ALL_VEHICLES(js/horse-race.js)에서
    // id/name만 추려 노출. 아직 미로드/비었으면 'car' 단일 폴백(상점은 로스터 로드 전에도 열림).
    function inventoryVehicles() {
        var roster = (window.ALL_VEHICLES || []).map(function (v) { return { id: v.id, name: v.name }; });
        return roster.length ? roster : [{ id: 'car', name: '자동차' }];
    }

    // 내가 고른 탈것을 알면 그걸, 모르면 'car'(상점은 탈것 선택 전에도 열림). 전역은 가드하며 읽음.
    function myVehicleType() {
        try {
            var sel = window.selectedVehicleTypes;
            var bets = window.userHorseBets;
            var me = window.currentUser;
            if (sel && bets && me != null) {
                var idx = bets[me];
                if (idx != null && sel[idx]) return sel[idx];
            }
        } catch (e) {}
        return PREVIEW_VEHICLE;
    }

    // 지정 탈것 SVG 1프레임 HTML (없으면 빈 문자열) — sampleVehicleHTML의 vehicle 가변 버전.
    function vehicleHTML(vehicleType) {
        if (typeof getVehicleSVG !== 'function') return '';
        try {
            var svgs = getVehicleSVG(vehicleType);
            if (!svgs) return '';
            var data = svgs.idle || svgs.run || svgs.rest || svgs;
            return (data && data.frame1) ? data.frame1 : (svgs.frame1 || '');
        } catch (e) { return ''; }
    }

    // 인벤토리 상단 큰 미리보기 노드. mergedEquipped() 기준(실제 탈것에 보이는 것과 동일).
    // paint=sprite filter, trail/accessory=오버레이, bib=이름 라벨. 장착 0개면 빈 탈것이 안전하게 나옴.
    function buildInventoryPreview(vehicleId) {
        var eq = mergedEquipped();
        var vt = vehicleId || myVehicleType();

        var box = document.createElement('div');
        box.className = 'hshop-inv-preview';

        if (eq.trail) {
            var trail = findItem('trail', eq.trail);
            if (trail && trail.emoji) {
                var tr = document.createElement('span');
                tr.className = 'hshop-inv-trail';
                tr.setAttribute('aria-hidden', 'true');
                tr.textContent = trail.emoji + trail.emoji + trail.emoji + trail.emoji + trail.emoji;
                box.appendChild(tr);
            }
        }

        var sprite = document.createElement('div');
        sprite.className = 'hshop-inv-sprite';
        sprite.innerHTML = vehicleHTML(vt); // 상수 SVG (유저입력 없음)
        var paint = eq.paint ? findItem('paint', eq.paint) : null;
        if (paint && paint.filter) sprite.style.filter = paint.filter;
        box.appendChild(sprite);

        if (eq.accessory) {
            var acc = findItem('accessory', eq.accessory);
            if (acc && acc.emoji) {
                var ac = document.createElement('span');
                ac.className = 'hshop-inv-acc';
                ac.setAttribute('aria-hidden', 'true');
                ac.textContent = acc.emoji;
                // 인벤토리 스프라이트는 120px(=60px 의 2배) 렌더 → 앵커 px 도 2배. 중앙(left:50%) 기준 가로 오프셋만 적용.
                var ia = ACC_ANCHOR[vt] || ACC_ANCHOR_DEFAULT;
                ac.style.setProperty('--acc-dx', ((ia.x - 30) * 2) + 'px'); // 스프라이트 가로중심(x=30) 대비 오프셋
                ac.style.setProperty('--acc-y', (ia.y * 2) + 'px');         // 스프라이트 상단부터 머리까지(2배)
                ac.style.setProperty('--acc-scale', ia.scale);
                box.appendChild(ac);
            }
        }

        var bb = document.createElement('span');
        bb.className = 'hshop-inv-bib';
        var _nm = '이름';
        try { var _a = JSON.parse(localStorage.getItem('userAuth') || 'null'); if (_a && _a.name) _nm = _a.name; } catch (e) {}
        bb.textContent = _nm;   // 사용자 입력 → textContent (안전)
        var bib = eq.bib ? findItem('bib', eq.bib) : null;
        if (bib) {
            if (bib.color) bb.style.color = bib.color;
            if (bib.bg) bb.style.background = bib.bg;
            if (bib.border) bb.style.borderColor = bib.border;
        }
        box.appendChild(bb);

        return box;
    }

    // ── 카탈로그 헬퍼 (ShopModule getter 위임) ──────────────

    function getCatalog() { return ShopModule.getCatalog(); }
    function getEquipped() { return ShopModule.getEquipped(); }
    function findItem(slot, id) { return ShopModule.findItem(slot, id); }
    function getCatalogItem(id) { return ShopModule.getCatalogItem(id); }

    // ── 탈것 꾸미기 적용 (경마 고유) ───────────────────────

    // 주어진 .horse 에 명시적 equipped 객체를 적용(멱등). catalog 필요.
    function applyEquippedToHorse(horseEl, equipped) {
        if (!horseEl || !getCatalog()) return;
        equipped = equipped || {};

        // 멱등: 이전 cosmetic-* 자식 제거
        var stale = horseEl.querySelectorAll('.cosmetic-accessory, .cosmetic-trail, .cosmetic-aura');
        for (var i = 0; i < stale.length; i++) stale[i].remove();

        // aura → 탈것 뒤 글로우(별도 노드, z-index 낮게 — paint의 .vehicle-sprite filter와 무간섭)
        var aura = findItem('aura', equipped.aura);
        if (aura && aura.color) {
            var auraEl = document.createElement('span');
            auraEl.className = 'cosmetic-aura';
            auraEl.setAttribute('aria-hidden', 'true');
            auraEl.style.color = aura.color; // currentColor 기반 box-shadow (CSS)
            horseEl.appendChild(auraEl);
        }

        // paint → .vehicle-sprite filter (.horse가 아니라: 이벤트 연출이 .horse filter 점유)
        var sprite = horseEl.querySelector('.vehicle-sprite');
        if (sprite) {
            var paint = findItem('paint', equipped.paint);
            sprite.style.filter = (paint && paint.filter) ? paint.filter : '';
        }

        // trail → 스프라이트 뒤 잔상
        var trail = findItem('trail', equipped.trail);
        if (trail && trail.emoji) {
            var trailEl = document.createElement('span');
            trailEl.className = 'cosmetic-trail';
            trailEl.setAttribute('aria-hidden', 'true');
            // 5연 이모지로 잔상 질량 강화(크게·또렷하게). 유저입력 아님(카탈로그 상수) → textContent 유지.
            trailEl.textContent = trail.emoji + trail.emoji + trail.emoji + trail.emoji + trail.emoji;
            horseEl.appendChild(trailEl);
        }

        // accessory → 머리 위 오버레이 (탈것별 앵커로 위치/크기 보정 — 외관만)
        var acc = findItem('accessory', equipped.accessory);
        if (acc && acc.emoji) {
            var accEl = document.createElement('span');
            accEl.className = 'cosmetic-accessory';
            accEl.setAttribute('aria-hidden', 'true');
            accEl.textContent = acc.emoji;
            var vid = horseEl.dataset ? horseEl.dataset.vehicleId : null;
            var a = (vid && ACC_ANCHOR[vid]) || ACC_ANCHOR_DEFAULT;
            // CSS 커스텀 프로퍼티로 전달 → .cosmetic-accessory 가 left/top/scale 소비 (px = .horse 기준).
            accEl.style.setProperty('--acc-x', (10 + a.x) + 'px');
            accEl.style.setProperty('--acc-y', (17.5 + a.y) + 'px');
            accEl.style.setProperty('--acc-scale', a.scale);
            horseEl.appendChild(accEl);
        }

        // bib(이름표)는 .horse가 아니라 닉네임 라벨(.race-name-tag)에 적용 — getLabelStyle 참조.
    }

    // bibId → 이름표 라벨 스타일. 카탈로그 미로드/미존재 시 null.
    function getLabelStyle(bibId) {
        var item = bibId ? findItem('bib', bibId) : null;
        if (!item) return null;
        return { color: item.color || null, bg: item.bg || null, border: item.border || null };
    }

    // 내가 현재 장착한 이름표 id (선택화면 자기 미리보기용). 없으면 null.
    function getMyEquippedLabel() { return mergedEquipped().bib || null; }
    // 내 이름표 라벨의 라이브 재색칠 책임은 horse-race.js(window.refreshMyNameTags)로 일원화 —
    // 스타일 소유권을 렌더 쪽에 두고, 셀렉터에 유저입력(닉네임)을 넣지 않기 위함.

    // 미인증 시 일반 상품 클릭 → 로그인 모달 유도(셸은 게임 중립이라 typeof 가드 필수).
    function promptLogin() {
        if (typeof ServerSelectModule !== 'undefined' && ServerSelectModule.showLoginModal) {
            ServerSelectModule.showLoginModal();
        } else if (typeof showCustomAlert === 'function') {
            showCustomAlert('로그인 후 이용할 수 있어요.');
        }
    }

    // 내 DB 장착 + 광고 장착(슬롯 단위로 광고가 우선)을 병합. 광고는 서버 broadcast와 동일 의미.
    function mergedEquipped() {
        var merged = {};
        var dbEq = getEquipped() || {};
        Object.keys(dbEq).forEach(function (slot) { merged[slot] = dbEq[slot]; });
        var adEq = (ShopModule.getAdWallet && ShopModule.getAdWallet().equipped) || {};
        Object.keys(adEq).forEach(function (slot) { merged[slot] = adEq[slot]; });
        return merged;
    }

    // 내 장착(서버 권위 + 광고 transient)을 .horse 에 적용.
    function applyToHorse(horseEl) {
        if (!horseEl) return;
        if (!getCatalog()) {
            ShopModule.loadCatalog().then(function () { applyToHorse(horseEl); }).catch(function () {});
            return;
        }
        applyEquippedToHorse(horseEl, mergedEquipped());
    }

    function applyToActiveHorses() {
        var horses = document.querySelectorAll('.horse.my-horse');
        for (var i = 0; i < horses.length; i++) applyToHorse(horses[i]);
    }

    // ── 개인 연출 (track_theme / finish_fx) ────────────────
    //   둘 다 "개인 꾸미기": 각 플레이어가 본인 장착(코인 DB + 광고 transient)을 본인 화면에서 본다.
    //   방장 무관·우승 무관. playFinishFx가 이미 이 모델(mergedEquipped) — track_theme도 동일하게.

    // 트랙테마 오버레이만 정리(멱등). 결승 폭죽 레이어(.cosmetic-finish-fx)는 자체 타이머(5.5s)로
    //   정리되므로 건드리지 않는다 — 트랙테마 재적용이 진행 중인 결승 연출을 지우지 않게.
    function clearMyTrackTheme() {
        var prev = document.querySelectorAll('.cosmetic-track-theme');
        for (var i = 0; i < prev.length; i++) prev[i].remove();
    }

    // 내가 장착한 트랙테마(mergedEquipped().track_theme) 배경 틴트를 라이브 트랙에 적용. 멱등(먼저 정리).
    //   라이브 트랙(raceTrackContainer)이 없으면 no-op(상점에서 장착만 했을 땐 적용 대상 없음).
    function applyMyTrackTheme() {
        clearMyTrackTheme();
        if (!getCatalog()) return;
        var container = document.getElementById('raceTrackContainer');
        if (!container) return;
        var themeId = mergedEquipped().track_theme;
        if (!themeId) return;
        var theme = getCatalogItem(themeId);
        if (theme && theme.bg) {
            var ov = document.createElement('div');
            ov.className = 'cosmetic-track-theme';
            ov.setAttribute('aria-hidden', 'true');
            ov.style.backgroundImage = theme.bg;
            container.appendChild(ov);
        }
    }

    // 공개 API 호환 래퍼(호출부: js/horse-race.js horseRaceStarted). 인자(roomCosmetics)는 기존
    //   시그니처 호환용으로 받기만 하고 무시한다 — 트랙테마는 방장 broadcast가 아니라 본인 장착 기준.
    function applyRoomCosmetics(_roomCosmetics) {
        applyMyTrackTheme();
    }

    function clearRoomCosmetics() {
        var prev = document.querySelectorAll('.cosmetic-track-theme, .cosmetic-finish-fx');
        for (var i = 0; i < prev.length; i++) prev[i].remove();
    }

    // 결승 이펙트 1회 재생을 임의 컨테이너에 그리는 헬퍼(in-race·상점 미리보기 공용).
    //   이모지 28개 낙하(화면 전폭 커버 + 크기/딜레이 jitter). Math.random은 외형(위치/딜레이/크기)
    //   전용 — 게임 결과·시뮬과 무관(공정성 영향 0). ~5500ms 후 자동 정리(레이어 leak 방지, 멱등).
    //   containerEl은 position:relative + overflow:hidden 이어야 낙하가 그 안에 클리핑된다.
    var FINISH_FX_PIECES = 28;       // 강화: 12 → 28 (질량 ↑)
    var FINISH_FX_LIFETIME = 5500;   // CSS hshopFxFall 3.6s + 최대 delay ~1.5s 보다 길게
    function playFinishFxInto(containerEl, emoji) {
        if (!containerEl || !emoji) return;
        var layer = document.createElement('div');
        layer.className = 'cosmetic-finish-fx';
        layer.setAttribute('aria-hidden', 'true');
        for (var i = 0; i < FINISH_FX_PIECES; i++) {
            var p = document.createElement('span');
            p.className = 'cosmetic-fx-piece';
            p.textContent = emoji;
            // 전폭 균등 분포(1.5~98.5%) + 가로 jitter (외형 전용 random — 공정성 무관)
            var base = 1.5 + (i / (FINISH_FX_PIECES - 1)) * 97;
            p.style.left = Math.max(0, Math.min(99, base + (Math.random() - 0.5) * 6)) + '%';
            p.style.animationDelay = (Math.random() * 1.5).toFixed(2) + 's'; // 0~1.5s 산개
            p.style.fontSize = (24 + Math.random() * 18).toFixed(0) + 'px';  // 24~42px 크기 변주
            layer.appendChild(p);
        }
        containerEl.appendChild(layer);
        setTimeout(function () { if (layer && layer.parentNode) layer.remove(); }, FINISH_FX_LIFETIME);
    }

    // 결승 이펙트(폭죽/색종이) 1회 재생 — 본인이 장착한 finish_fx 기준(개인 꾸미기, 방장 무관).
    //   인자(roomCosmetics)는 기존 호출부 시그니처 호환용으로 유지하되 더 이상 사용하지 않는다.
    //   mergedEquipped()로 본인 DB 장착 + 광고 장착(우선)을 읽어 모든 플레이어가 자기 화면에서 자기 연출을 본다.
    function playFinishFx(_roomCosmetics) {
        var id = mergedEquipped().finish_fx;
        if (!id) return;
        var fx = getCatalogItem(id);
        if (!fx || !fx.emoji) return;
        playFinishFxInto(document.getElementById('raceTrackContainer'), fx.emoji);
    }

    // ── ShopModule 설정 등록 ───────────────────────────────

    ShopModule.init({
        mountId: 'horseShopMount',
        catalogUrl: CATALOG_URL,
        title: '꾸미기 상점',
        subtitle: '경마 · 내 탈것',
        slots: SLOTS,
        // 미인증(게스트/만료토큰)도 ad-티어로 상점 진입 허용 (v1 경마 한정). 스핀은 이 플래그 없음 → 토큰 필수.
        allowGuestShop: true,
        hooks: {
            buildPreview: buildPreview,
            // 인벤토리('내 아이템') 메인탭 상단 큰 미리보기 — mergedEquipped 합성을 어댑터에서 빌드.
            buildInventoryPreview: buildInventoryPreview,
            // 인벤토리 ◀▶ 스위처용 탈것 로스터(id/name). ALL_VEHICLES에서 추림.
            inventoryVehicles: inventoryVehicles,
            // 인벤토리 카드 장착표시를 "실제 탈것에 보이는 것"과 일치시키기 위한 현재 장착(슬롯→id) 조회.
            // 광고>코인(같은 슬롯 광고 우선). 셸은 이 단일 진실로 ✓를 1개에만 표시.
            mergedEquipped: mergedEquipped,
            // 일반(비-광고) 아이템 상태. ad 아이템은 셸이 ad-wallet 기준으로 별도 처리(여기 미진입).
            // 미인증(게스트/만료토큰)이면 일반 상품은 잠금 → 클릭 시 로그인 유도.
            itemState: function (item) {
                if (!ShopModule.isAuthed()) {
                    return { owned: false, buyable: false, lockLabel: '로그인하세요', onLockedClick: promptLogin };
                }
                var owned = ShopModule.getWallet().owned.indexOf(item.id) !== -1;
                return { owned: owned, buyable: true };
            },
            noticeText: function (activeSlot) {
                return (activeSlot === 'track_theme' || activeSlot === 'finish_fx')
                    ? '결승연출·트랙테마는 내가 장착하면 내 화면에 보여요. 게임 결과엔 영향 없어요.'
                    : '꾸미기는 게임 결과에 영향을 주지 않아요. 코인으로 구매 후 장착하세요.';
            },
            // free 서버(자유플레이·로그인 없음 → currentServerId === null)에서는 코인 경제가
            // 실제로 돌지 않으므로 코인샵 카드 대신 안내문만 보여준다. 잠금이면 안내 카피 반환,
            // 정규 서버면 null → 셸 기본 카드 렌더. 광고샵('ad')엔 영향 없음(셸이 'coin' 한정 호출).
            coinShopLocked: function () {
                return (window.currentServerId == null)
                    ? '여기서는 코인샵을 사용할 수 없어요. 서버를 새로 만들어 진행해 주세요.'
                    : null;
            },
            // 인증/지갑 동기화 직후 — 내 활성 말 + 이름표 라벨 + 라이브 트랙테마에 장착 반영
            onWalletSynced: function () { applyToActiveHorses(); applyMyTrackTheme(); if (window.refreshMyNameTags) window.refreshMyNameTags(); },
            // 장착/해제 직후 — 내 활성 말 + 이름표 라벨 + 라이브 트랙테마 즉시 반영 (force 무관)
            //   applyMyTrackTheme은 라이브 트랙(raceTrackContainer) 없으면 no-op — 상점에서 장착만 했을 땐 무해.
            onEquipApplied: function () { applyToActiveHorses(); applyMyTrackTheme(); if (window.refreshMyNameTags) window.refreshMyNameTags(); },
            // 광고 코스메틱 장착/해제 직후 — 내 활성 말 + 이름표 라벨 + 라이브 트랙테마 즉시 반영
            onAdEquipApplied: function () { applyToActiveHorses(); applyMyTrackTheme(); if (window.refreshMyNameTags) window.refreshMyNameTags(); }
            // onPurchased: no-op (구매만으로 외관 변화 없음 — 장착 시 반영)
        }
    });

    // ── 공개 API (기존 시그니처 유지) ──────────────────────

    window.HorseShop = {
        connect: function (socket) { ShopModule.connect(socket); },
        authenticate: function (token, done) { ShopModule.authenticate(token, done); },
        loadCatalog: function () { return ShopModule.loadCatalog(); },
        openShop: function () { ShopModule.openShop(); },
        closeShop: function () { ShopModule.closeShop(); },
        applyToHorse: applyToHorse,
        applyEquippedToHorse: applyEquippedToHorse,
        applyToActiveHorses: applyToActiveHorses,
        applyRoomCosmetics: applyRoomCosmetics, // 호환 래퍼(인자 무시) → applyMyTrackTheme
        applyMyTrackTheme: applyMyTrackTheme,
        clearRoomCosmetics: clearRoomCosmetics,
        playFinishFx: playFinishFx,
        getEquipped: getEquipped,
        getCatalogItem: getCatalogItem,
        getLabelStyle: getLabelStyle,
        getMyEquippedLabel: getMyEquippedLabel,
        isAuthed: function () { return ShopModule.isAuthed(); }
    };

    // 이름표 색 해석은 카탈로그가 로드돼야 한다. 레이스 전에 미리 캐시(멱등 — 중복 무해).
    ShopModule.loadCatalog().catch(function () {});
})();
