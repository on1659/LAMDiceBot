/*
 * marble-shop.js — 데구리 동물 스킨 상점 어댑터 (ShopModule 위 얇은 게임 어댑터)
 *
 * 전역 `MarbleShop`. 공통 셸(인증/지갑/모달/구매/장착/잔고연출)은 js/shared/shop-shared.js
 * (window.ShopModule)이 담당. 이 어댑터는 데구리 고유부만 보유:
 *   - 스킨 미리보기(buildPreview hook) — 스킨 시트(creatures/{creature}-{skin}.png)의 idle 첫 칸을 캔버스에
 *   - 소유/구매 상태(itemState hook — tier/requires 없음)
 *   - 장착 후 서버 동기화(onEquipApplied → socket 'marble:refreshSkin') — 서버가 prefs.equipped 를 직접 읽는다
 *   - 장착 스킨 조회(getEquippedSkin) — js/marble.js 가 선택 버튼 아이콘·배지에 쓴다
 *
 * 공정성: 스킨은 순수 외형. 서버(socket/marble.js)가 장착·소유를 읽어 공에 얹고(시뮬 뒤), 클라는 값을 보내지 않는다.
 *   Math.random() 미사용. 명세: docs/goal/marble-creature-skins-shop.md
 *
 * CSS: 상점 모달(.hshop-*)은 horse-shop.css 공통 — marble.css 가 --horse-* 변수를 marble 색으로 alias.
 */
(function () {
    'use strict';

    var CATALOG_URL = '/config/marble/cosmetics.json';
    var SLOT = 'marble_skin';
    var ICON_PX = 56;
    var _socket = null;

    // ── 미리보기 빌더 (스킨 시트 idle 첫 칸) ─────────────────
    function buildSkinPreview(slot, item) {
        var box = document.createElement('div');
        box.className = 'mshop-preview';
        box.setAttribute('aria-hidden', 'true');
        var R = window.marbleRendererForShop;   // js/marble.js 가 렌더러 생성 후 노출
        if (item.creature && R && typeof R.drawCreatureIcon === 'function') {
            var cv = document.createElement('canvas');
            cv.width = ICON_PX; cv.height = ICON_PX; cv.className = 'mshop-icon';
            R.drawCreatureIcon(cv, item.creature, 0, item.skin);   // 시트 미로드면 기본 시트/원 폴백(렌더러가 처리)
            box.appendChild(cv);
        } else {
            var glyph = document.createElement('span');
            glyph.className = 'mshop-glyph';
            glyph.textContent = item.emoji || '🐾';
            box.appendChild(glyph);
        }
        return box;
    }

    // 소유/구매 상태: defaultOwned 또는 소유면 owned. 선행조건 없음.
    function itemState(item) {
        var wallet = ShopModule.getWallet();
        var owned = !!item.defaultOwned || wallet.owned.indexOf(item.id) !== -1;
        return owned ? { owned: true, buyable: true } : { owned: false, buyable: true };
    }

    // 장착이 서버에 반영된 뒤 → 데구리 서버가 내 스킨을 다시 읽어 출발대에 뿌리게 한다(페이로드 없음)
    function onEquipApplied() {
        if (_socket) _socket.emit('marble:refreshSkin');
        if (typeof window.onMarbleSkinChanged === 'function') window.onMarbleSkinChanged();
    }

    // ── ShopModule 설정 등록 ───────────────────────────────
    ShopModule.init({
        mountId: 'marbleShopMount',
        catalogUrl: CATALOG_URL,
        title: '꾸미기 상점',
        subtitle: '데구리 · 동물 스킨',
        slots: [{ key: SLOT, label: '동물 스킨' }],   // 단일 슬롯 → 탭바 미렌더
        noticeText: '동물 스킨은 경주 결과에 영향을 주지 않아요. 스킨의 동물을 골랐을 때 모두에게 보여요.',
        hooks: {
            buildPreview: buildSkinPreview,
            itemState: itemState,
            onEquipApplied: onEquipApplied
        }
    });

    // ── 공개 API ──────────────────────────────────────────
    window.MarbleShop = {
        connect: function (socket) { _socket = socket; ShopModule.connect(socket); },
        authenticate: function (token, done) { ShopModule.authenticate(token, done); },
        loadCatalog: function () { return ShopModule.loadCatalog(); },
        openShop: function () { ShopModule.openShop(); },
        closeShop: function () { ShopModule.closeShop(); },
        isAuthed: function () { return ShopModule.isAuthed(); },
        // 장착 스킨 { creature, skin } | null (기본 모습·미장착·비로그인이면 null). 선택 버튼 아이콘/배지용 — 서버 판정과 무관한 미리보기.
        getEquippedSkin: function () {
            var id = ShopModule.getEquipped()[SLOT];
            if (!id) return null;
            var item = ShopModule.getCatalogItem(id);
            return (item && item.creature && item.skin) ? { creature: item.creature, skin: item.skin } : null;
        }
    };
})();
