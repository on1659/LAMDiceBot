/*
 * ladder-shop.js — 사다리타기 하강 토큰 스킨 상점 어댑터 (ShopModule 위 얇은 게임 어댑터)
 *
 * 전역 `LadderShop`. 공통 셸(인증/지갑/모달/구매/장착/잔고연출)은 js/shared/shop-shared.js
 * (window.ShopModule)이 담당. 이 어댑터는 사다리 하강 토큰 스킨 고유부만 보유:
 *   - 스킨 이모지 미리보기(buildPreview hook)
 *   - 소유/구매 가능 상태(itemState hook — tier/requires 없음, 단순 소유 판정)
 *   - 장착 이모지 노출(getEquippedEmoji) — js/ladder.js의 tokenMarkerFor가 호출
 *
 * 공정성(잠긴 결정 — per-viewer 클라 렌더 전용):
 *   - 스킨은 "내 화면의 모든 하강 토큰"에만 적용되는 순수 외형. 서버는 스킨을 전혀 모른다.
 *   - 서버 동기화 0(찜/claim 없음). ladder:* 페이로드에 스킨 데이터가 들어가지 않는다.
 *   - 결과(perm/mapping/mutationScript/landings)에 어떤 경로로도 영향 0. Math.random() 미사용.
 *
 * CSS: 상점 모달(.hshop-*)은 horse-shop.css 공통 — ladder.css가 --horse-* 변수를 ladder 색으로
 *   alias하므로 자동으로 사다리 색이 입혀진다.
 */
(function () {
    'use strict';

    var CATALOG_URL = '/config/ladder/cosmetics.json';
    var SLOT = 'ladder_skin';

    // ── 미리보기 빌더 (스킨 이모지 글리프) ──────────────────
    function buildSkinPreview(slot, item) {
        var box = document.createElement('div');
        box.className = 'lshop-preview';
        box.setAttribute('aria-hidden', 'true');
        var glyph = document.createElement('span');
        glyph.className = 'lshop-glyph';
        glyph.textContent = item.emoji || '⬤';
        box.appendChild(glyph);
        return box;
    }

    // 소유/구매 상태: defaultOwned 또는 소유면 owned. 선행조건 없음 → 미소유는 항상 구매 가능.
    function itemState(item) {
        var wallet = ShopModule.getWallet();
        var owned = !!item.defaultOwned || wallet.owned.indexOf(item.id) !== -1;
        return owned ? { owned: true, buyable: true } : { owned: false, buyable: true };
    }

    // ── ShopModule 설정 등록 ───────────────────────────────
    ShopModule.init({
        mountId: 'ladderShopMount',
        catalogUrl: CATALOG_URL,
        title: '꾸미기 상점',
        subtitle: '사다리타기 · 내 토큰 스킨',
        slots: [{ key: SLOT, label: '토큰 스킨' }],   // 단일 슬롯 → 탭바 미렌더
        noticeText: '토큰 스킨은 게임 결과에 영향을 주지 않아요. 내가 장착한 스킨은 내 화면의 하강 토큰에만 보여요.',
        hooks: {
            buildPreview: buildSkinPreview,
            itemState: itemState
        }
    });

    // ── 공개 API ──────────────────────────────────────────
    window.LadderShop = {
        connect: function (socket) { ShopModule.connect(socket); },
        authenticate: function (token, done) { ShopModule.authenticate(token, done); },
        loadCatalog: function () { return ShopModule.loadCatalog(); },
        openShop: function () { ShopModule.openShop(); },
        closeShop: function () { ShopModule.closeShop(); },
        isAuthed: function () { return ShopModule.isAuthed(); },
        // 현재 장착 슬롯의 스킨 이모지를 반환. 미장착이거나 emoji 없는 항목(기본 토큰)이면 null.
        // null이면 ladder.js가 colorIndex 기반 색 원으로 폴백 → "기본 토큰" 장착도 기존 외형 보존.
        // js/ladder.js의 tokenMarkerFor가 매 토큰 렌더마다 호출 → per-viewer 외형(서버 무지).
        getEquippedEmoji: function () {
            var id = ShopModule.getEquipped()[SLOT];
            if (!id) return null;
            var item = ShopModule.getCatalogItem(id);
            return (item && item.emoji) ? item.emoji : null;
        }
    };
})();
