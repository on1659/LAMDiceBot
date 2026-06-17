/*
 * horse-shop.js — 경마 꾸미기 상점 어댑터 (ShopModule 위에 얇은 게임 어댑터)
 *
 * 전역 `HorseShop`. 공통 셸(인증/지갑/모달/구매/장착/잔고연출)은 js/shared/shop-shared.js
 * (window.ShopModule)이 담당. 이 어댑터는 경마 고유부만 보유:
 *   - 차량 SVG 미리보기(buildPreview hook, getVehicleSVG 의존)
 *   - 내 탈것에 장착 적용(applyToHorse / applyEquippedToHorse / applyToActiveHorses)
 *   - 방 연출(track_theme 틴트 applyRoomCosmetics, finish_fx playFinishFx)
 *
 * 공개 API(window.HorseShop.*)는 기존 그대로 유지(호출부: js/horse-race.js, HTML onclick).
 *
 * 공정성: cosmetic 데이터는 결과 계산이나 게임 emit에 진입하지 않는다.
 *   도색 필터는 .vehicle-sprite 에만(이벤트 연출이 .horse filter 점유). Math.random() 미사용.
 */
(function () {
    'use strict';

    var CATALOG_URL = '/config/horse/cosmetics.json';
    // 상점 탭(슬롯). track_theme/finish_fx는 방장 장착분만 방 전체 적용(개인은 소유/장착만).
    var SLOTS = [
        { key: 'paint', label: '🎨 도색' },
        { key: 'trail', label: '✨ 트레일' },
        { key: 'accessory', label: '👑 액세서리' },
        { key: 'bib', label: '🔢 마번' },
        { key: 'track_theme', label: '🏞️ 트랙테마' },
        { key: 'finish_fx', label: '🎆 결승연출' }
    ];

    // 카드 썸네일에 실제 탈것을 그려 꾸미기 적용 모습을 미리보기로 보여줄 슬롯
    var HORSE_PREVIEW_SLOTS = ['paint', 'trail', 'accessory', 'bib'];
    var PREVIEW_VEHICLE = 'car'; // 미리보기 샘플 탈것 (getVehicleSVG, horse-race-sprites.js)

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
            tr.textContent = item.emoji + item.emoji;
            box.appendChild(tr);
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
            bb.textContent = '3';
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

    // 결승연출 미리보기: 큰 이모지 펄스 + 작은 조각 낙하 루프.
    function buildFinishFxPreview(item) {
        var emoji = (item && item.emoji) ? item.emoji : '🎆';
        var box = document.createElement('div');
        box.className = 'hshop-fx-mini';
        box.setAttribute('aria-hidden', 'true');

        var burst = document.createElement('span');
        burst.className = 'hshop-fx-burst';
        burst.textContent = emoji;
        box.appendChild(burst);

        for (var i = 0; i < 4; i++) {
            var p = document.createElement('span');
            p.className = 'hshop-fx-confetti';
            p.textContent = emoji;
            p.style.left = (18 + i * 20) + '%';
            p.style.animationDelay = (i * 0.3) + 's';
            box.appendChild(p);
        }
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
        var stale = horseEl.querySelectorAll('.cosmetic-accessory, .cosmetic-trail, .cosmetic-bib');
        for (var i = 0; i < stale.length; i++) stale[i].remove();

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
            trailEl.textContent = trail.emoji + trail.emoji + trail.emoji;
            horseEl.appendChild(trailEl);
        }

        // accessory → 오버레이
        var acc = findItem('accessory', equipped.accessory);
        if (acc && acc.emoji) {
            var accEl = document.createElement('span');
            accEl.className = 'cosmetic-accessory';
            accEl.setAttribute('aria-hidden', 'true');
            accEl.textContent = acc.emoji;
            horseEl.appendChild(accEl);
        }

        // bib → 마번 배지 (탈것 번호 = horseIndex+1, 카탈로그 색상)
        var bib = findItem('bib', equipped.bib);
        if (bib) {
            var num = '#';
            var m = (horseEl.id || '').match(/horse_(\d+)/);
            if (m) num = String(parseInt(m[1], 10) + 1);
            var bibEl = document.createElement('span');
            bibEl.className = 'cosmetic-bib';
            bibEl.setAttribute('aria-hidden', 'true');
            bibEl.textContent = num;
            if (bib.color) bibEl.style.color = bib.color;
            if (bib.bg) bibEl.style.background = bib.bg;
            if (bib.border) bibEl.style.borderColor = bib.border;
            horseEl.appendChild(bibEl);
        }
    }

    // 내 장착(서버 권위)을 .horse 에 적용.
    function applyToHorse(horseEl) {
        if (!horseEl) return;
        if (!getCatalog()) {
            ShopModule.loadCatalog().then(function () { applyToHorse(horseEl); }).catch(function () {});
            return;
        }
        applyEquippedToHorse(horseEl, getEquipped());
    }

    function applyToActiveHorses() {
        var horses = document.querySelectorAll('.horse.my-horse');
        for (var i = 0; i < horses.length; i++) applyToHorse(horses[i]);
    }

    // ── 방 연출 (track_theme / finish_fx) ──────────────────

    // 방장 roomCosmetics 적용 (track_theme 배경 틴트). 멱등: 먼저 정리.
    function applyRoomCosmetics(roomCosmetics) {
        clearRoomCosmetics();
        if (!roomCosmetics) return;
        var container = document.getElementById('raceTrackContainer');
        if (container && roomCosmetics.track_theme) {
            var theme = getCatalogItem(roomCosmetics.track_theme);
            if (theme && theme.bg) {
                var ov = document.createElement('div');
                ov.className = 'cosmetic-track-theme';
                ov.setAttribute('aria-hidden', 'true');
                ov.style.backgroundImage = theme.bg;
                container.appendChild(ov);
            }
        }
    }

    function clearRoomCosmetics() {
        var prev = document.querySelectorAll('.cosmetic-track-theme, .cosmetic-finish-fx');
        for (var i = 0; i < prev.length; i++) prev[i].remove();
    }

    // 결승 이펙트(폭죽/색종이) 1회 재생.
    function playFinishFx(roomCosmetics) {
        if (!roomCosmetics || !roomCosmetics.finish_fx) return;
        var fx = getCatalogItem(roomCosmetics.finish_fx);
        if (!fx || !fx.emoji) return;
        var container = document.getElementById('raceTrackContainer');
        if (!container) return;
        var layer = document.createElement('div');
        layer.className = 'cosmetic-finish-fx';
        layer.setAttribute('aria-hidden', 'true');
        // 이모지 12개 낙하 (위치/딜레이는 결정적 — Math.random 미사용)
        for (var i = 0; i < 12; i++) {
            var p = document.createElement('span');
            p.className = 'cosmetic-fx-piece';
            p.textContent = fx.emoji;
            p.style.left = (5 + i * 8) + '%';
            p.style.animationDelay = (i * 0.12) + 's';
            layer.appendChild(p);
        }
        container.appendChild(layer);
        setTimeout(function () { if (layer && layer.parentNode) layer.remove(); }, 3500);
    }

    // ── ShopModule 설정 등록 ───────────────────────────────

    ShopModule.init({
        mountId: 'horseShopMount',
        catalogUrl: CATALOG_URL,
        title: '꾸미기 상점',
        subtitle: '경마 · 내 탈것',
        slots: SLOTS,
        hooks: {
            buildPreview: buildPreview,
            // horse는 잠금/선행조건 없음 — 소유=owns(id), 항상 구매가능.
            itemState: function (item) {
                var owned = ShopModule.getWallet().owned.indexOf(item.id) !== -1;
                return { owned: owned, buyable: true };
            },
            noticeText: function (activeSlot) {
                return (activeSlot === 'track_theme' || activeSlot === 'finish_fx')
                    ? '연출 꾸미기는 방장이 장착하면 방 전체에 적용돼요. 게임 결과엔 영향 없어요.'
                    : '꾸미기는 게임 결과에 영향을 주지 않아요. 코인으로 구매 후 장착하세요.';
            },
            // 인증/지갑 동기화 직후 — 내 활성 말에 장착 반영
            onWalletSynced: function () { applyToActiveHorses(); },
            // 장착/해제 직후 — 내 활성 말에 장착 반영 (force 무관)
            onEquipApplied: function () { applyToActiveHorses(); }
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
        applyRoomCosmetics: applyRoomCosmetics,
        clearRoomCosmetics: clearRoomCosmetics,
        playFinishFx: playFinishFx,
        getEquipped: getEquipped,
        getCatalogItem: getCatalogItem,
        isAuthed: function () { return ShopModule.isAuthed(); }
    };
})();
