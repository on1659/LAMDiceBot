/*
 * spin-shop.js — 회전 칼날 꾸미기 상점 어댑터 (ShopModule 위에 얇은 게임 어댑터)
 *
 * 전역 `SpinShop`. 공통 셸(인증/지갑/모달/구매/장착/잔고연출)은 js/shared/shop-shared.js
 * (window.ShopModule)이 담당. 이 어댑터는 회전 칼날 고유부만 보유:
 *   - 스킨 점(dot) 미리보기(buildPreview hook)
 *   - 스킨업(tier 2) 선행조건 잠금(itemState hook, requires)
 *   - 피커 잠금 동기화(window.spinShopSync / window.renderSkinPicker — spin-arena.js 정의)
 *   - cosmeticId ↔ 게임 skinId 매핑(getOwnedSkinIds / getEquippedSkinId)
 *
 * 공개 API(window.SpinShop.*)는 기존 그대로 유지(호출부: js/spin-arena.js, HTML onclick).
 *
 * 공정성: cosmetic 데이터는 결과/시뮬 입력에 진입하지 않는다. 장착 반영은 spin-arena.js의
 *   spinShopSync 훅 → spin-arena:selectSkin 한정(서버가 소유 재검증). Math.random() 미사용.
 *
 * CSS: 경마 상점(css/horse-shop.css)의 .hshop-* 클래스 재사용 — spin-arena.css가
 *   --horse-* 변수를 spin 색으로 alias하므로 자동으로 게임 색이 입혀진다.
 */
(function () {
    'use strict';

    var CATALOG_URL = '/config/spin-arena/cosmetics.json';
    var SLOT = 'spin_skin';
    var COSMETIC_PREFIX = 'spin_skin_';

    // 'spin_skin_crimson_t2' → 'crimson_t2' (게임 skinId 매핑)
    function cosmeticToSkinId(id) {
        return (typeof id === 'string' && id.indexOf(COSMETIC_PREFIX) === 0)
            ? id.slice(COSMETIC_PREFIX.length) : null;
    }

    // ── 게임(spin-arena.js) 연동 훅 ────────────────────────

    // 피커 잠금 상태 갱신 (renderSkinPicker는 spin-arena.js 전역 함수)
    function refreshGamePicker() {
        if (typeof window.renderSkinPicker === 'function') window.renderSkinPicker();
    }

    // 장착 스킨을 게임 선택에 반영. force=true는 사용자 장착 액션(현재 선택을 덮음),
    // false는 로그인 동기화(이번 라운드 수동 선택 존중). 검증/적용 조건은 spin-arena.js가 판단.
    function syncEquippedToGame(force) {
        if (typeof window.spinShopSync === 'function') {
            window.spinShopSync(cosmeticToSkinId(ShopModule.getEquipped()[SLOT] || ''), !!force);
        }
        refreshGamePicker();
    }

    // ── 미리보기 빌더 (스킨 점) ────────────────────────────

    // 스킨 미리보기 점 (피커 .spin-skin-dot와 동일 문법 — 카탈로그 상수 색만 사용)
    function buildSkinPreview(slot, item) {
        var box = document.createElement('div');
        box.className = 'sshop-preview';
        box.setAttribute('aria-hidden', 'true');
        var dot = document.createElement('span');
        dot.className = 'sshop-dot' + (item.tier === 2 ? ' t2' : '');
        dot.style.background = item.color || '#9aa3ad';
        dot.style.boxShadow = '0 0 0 3px ' + (item.blade || '#c2c8cf') +
            (item.tier === 2 ? ', 0 0 14px ' + (item.blade || '#c2c8cf') : '');
        box.appendChild(dot);
        if (item.tier === 2) {
            var tb = document.createElement('span');
            tb.className = 'sshop-tier-badge';
            tb.textContent = '스킨업 Ⅱ';
            box.appendChild(tb);
        }
        return box;
    }

    // 소유/잠금 상태: defaultOwned 또는 소유면 owned. 선행조건(requires) 미충족이면 구매 잠금.
    function itemState(item) {
        var wallet = ShopModule.getWallet();
        var isDefault = !!item.defaultOwned;
        var owned = isDefault || wallet.owned.indexOf(item.id) !== -1;
        if (owned) return { owned: true, buyable: true };

        var reqItem = item.requires ? ShopModule.getCatalogItem(item.requires) : null;
        var reqMet = !item.requires
            || (reqItem && reqItem.defaultOwned)
            || wallet.owned.indexOf(item.requires) !== -1;
        return reqMet
            ? { owned: false, buyable: true }
            : { owned: false, buyable: false, lockLabel: '선행 스킨 필요' };
    }

    // ── ShopModule 설정 등록 ───────────────────────────────

    ShopModule.init({
        mountId: 'spinShopMount',
        catalogUrl: CATALOG_URL,
        title: '꾸미기 상점',
        subtitle: '회전 칼날 · 내 스킨',
        slots: [{ key: SLOT, label: '스킨' }],   // 단일 슬롯 → 탭바 미렌더
        noticeText: '스킨은 게임 결과에 영향을 주지 않아요. 스킨업(Ⅱ)은 같은 색의 강화 비주얼 — 먼저 그 색 스킨을 가지고 있어야 해요.',
        hooks: {
            buildPreview: buildSkinPreview,
            itemState: itemState,
            // 인증/지갑 동기화 직후 — 카탈로그 미리 받아 피커 잠금/장착 동기화(수동 선택 존중).
            // 카탈로그 로드 실패해도 동기화는 진행(게임 진행 무영향 — 기존 동작 유지).
            onWalletSynced: function () {
                ShopModule.loadCatalog()
                    .then(function () { syncEquippedToGame(false); })
                    .catch(function () { syncEquippedToGame(false); });
            },
            // 구매 직후 — 피커 잠금 해제 반영
            onPurchased: function () { refreshGamePicker(); },
            // 장착/해제 직후 — 게임 선택에 반영(force=true: 현재 선택 덮음)
            onEquipApplied: function (equipped, force) { syncEquippedToGame(force); }
        }
    });

    // ── 공개 API (기존 시그니처 유지) ──────────────────────

    window.SpinShop = {
        connect: function (socket) { ShopModule.connect(socket); },
        authenticate: function (token, done) { ShopModule.authenticate(token, done); },
        loadCatalog: function () { return ShopModule.loadCatalog(); },
        openShop: function () { ShopModule.openShop(); },
        closeShop: function () { ShopModule.closeShop(); },
        // 소유한 게임 skinId 배열 ('crimson_t2' 형태) — 피커 잠금 판단용
        getOwnedSkinIds: function () {
            var owned = ShopModule.getWallet().owned;
            var out = [];
            for (var i = 0; i < owned.length; i++) {
                var sid = cosmeticToSkinId(owned[i]);
                if (sid) out.push(sid);
            }
            return out;
        },
        getEquippedSkinId: function () { return cosmeticToSkinId(ShopModule.getEquipped()[SLOT] || ''); },
        isAuthed: function () { return ShopModule.isAuthed(); }
    };
})();
