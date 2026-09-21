/*
 * marble-shop.js — 데구리 동물 스킨 상점 어댑터 (ShopModule 위 얇은 게임 어댑터)
 *
 * 전역 `MarbleShop`. 공통 셸(인증/지갑/모달/구매/장착/잔고연출)은 js/shared/shop-shared.js
 * (window.ShopModule)이 담당. 이 어댑터는 데구리 고유부만 보유:
 *   - 상점(구매)·옷장(장착) 분리: config.closet — 버튼 2개(openShop/openCloset), 공유 셸의 _view 가 카드 모양을 바꾼다
 *   - 스킨 미리보기(buildPreview hook) — 스킨 시트(creatures/{creature}-{skin}.png)의 idle 첫 칸을 캔버스에
 *   - 소유/구매 상태(itemState hook — tier/requires 없음)
 *   - 장착 = 방 단위(equipRequest hook → socket 'marble:equipSkin { cosmeticId }') — 계정 prefs 에 저장하지 않는다.
 *     서버가 소유를 확인해 그 방의 mb.skins 에만 기억하고, 방을 나가면 풀린다(재입장하면 다시 골라야 함 — 사용자 결정 2026-09-22).
 *     지갑 동기화(wallet:get)가 돌려주는 prefs.equipped.marble_skin 은 이 어댑터가 방 장착값으로 덮어 UI 가 서버(방)와 같게 보이게 한다.
 *   - 장착 스킨 조회(getEquippedSkin) — js/marble.js 가 선택 버튼 아이콘·배지에 쓴다
 *
 * 공정성: 스킨은 순수 외형. 서버(socket/marble.js)가 소유를 확인해 공에 얹고(시뮬 뒤), 클라는 id 만 보낸다.
 *   Math.random() 미사용. 명세: docs/goal/marble-skins-all-creatures.md
 *
 * CSS: 상점 모달(.hshop-*)은 horse-shop.css 공통 — marble.css 가 --horse-* 변수를 marble 색으로 alias.
 */
(function () {
    'use strict';

    var CATALOG_URL = '/config/marble/cosmetics.json';
    var SLOT = 'marble_skin';
    var ICON_PX = 56;
    var _socket = null;
    var _roomSkinId = null;   // 이 방에서 서버가 확인해 준 장착 id(marble_skin_none 포함) | null — 페이지 수명 = 방 수명(나가면 /game 으로 이동)

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

    // 방 장착값으로 지갑의 장착 맵을 맞춘다(ShopModule 은 _wallet 객체를 참조로 준다) — 카드 '장착중' 표시·getEquippedSkin 의 기준
    function applyRoomSkin(wallet) {
        var eq = (wallet || ShopModule.getWallet()).equipped;
        if (!eq) return;
        if (_roomSkinId) eq[SLOT] = _roomSkinId; else delete eq[SLOT];
    }
    // [장착]/[해제] 클릭 → 서버(방)에만 저장. done(equippedMap) 성공 / done(null) 실패
    function equipRequest(slot, id, done) {
        if (!_socket) return done(null);
        _socket.emit('marble:equipSkin', { cosmeticId: id }, function (res) {
            if (!res || !res.ok) return done(null);
            _roomSkinId = id || null;
            var eq = Object.assign({}, ShopModule.getWallet().equipped);
            if (_roomSkinId) eq[SLOT] = _roomSkinId; else delete eq[SLOT];
            done(eq);
        });
    }
    // 장착이 서버(방)에 반영된 뒤 — 선택 버튼 배지·아이콘 갱신(출발대는 서버가 stateUpdated 로 뿌린다)
    function onEquipApplied() {
        if (typeof window.onMarbleSkinChanged === 'function') window.onMarbleSkinChanged();
    }

    // ── ShopModule 설정 등록 ───────────────────────────────
    ShopModule.init({
        mountId: 'marbleShopMount',
        catalogUrl: CATALOG_URL,
        title: '스킨 상점',
        subtitle: '데구리 · 동물 스킨 구매',
        closet: true,                 // 상점(구매)·옷장(장착) 분리 — 데구리만(사용자 2026-09-22). 상점 카드에는 장착 버튼이 없고, 옷장은 소유 스킨만
        closetTitle: '옷장',
        closetSubtitle: '데구리 · 내 스킨 장착',
        slots: [{ key: SLOT, label: '동물 스킨' }],   // 단일 슬롯 → 탭바 미렌더
        coinShopOpen: true,   // 공통 COIN_SHOP_COMING_SOON 게이트를 데구리만 연다(사용자 2026-09-22) — 다른 게임 코인샵은 그대로 준비 중
        hooks: {
            noticeText: function (slot, view) {
                return view === 'closet'
                    ? '장착은 이 방에서만 유지돼요. 방을 나가면 다시 골라 주세요. 스킨의 동물을 골랐을 때 모두에게 보여요.'
                    : '동물 스킨은 경주 결과에 영향을 주지 않아요. 산 스킨은 옷장에서 장착해요.';
            },
            buildPreview: buildSkinPreview,
            itemState: itemState,
            equipRequest: equipRequest,
            onEquipApplied: onEquipApplied,
            onWalletSynced: applyRoomSkin,     // 인증 직후 wallet:get 이 준 계정 prefs 장착값 대신 방 장착값
            onWalletRefreshed: applyRoomSkin   // 상점/옷장을 열 때마다의 wallet:get 도 같은 규칙(안 하면 옷장에 '장착중'이 안 보임)
        }
    });

    // ── 공개 API ──────────────────────────────────────────
    window.MarbleShop = {
        connect: function (socket) { _socket = socket; ShopModule.connect(socket); },
        authenticate: function (token, done) { ShopModule.authenticate(token, done); },
        loadCatalog: function () { return ShopModule.loadCatalog(); },
        openShop: function () { ShopModule.openShop(); },
        openCloset: function () { ShopModule.openCloset(); },
        closeShop: function () { ShopModule.closeShop(); },
        isAuthed: function () { return ShopModule.isAuthed(); },
        // 서버가 requestState 응답에 실어 준 내 방 장착 id(새로고침 재입장 동기화). undefined 면 무시
        syncRoomSkin: function (id) {
            if (id === undefined) return;
            _roomSkinId = id || null;
            applyRoomSkin();
            if (typeof window.onMarbleSkinChanged === 'function') window.onMarbleSkinChanged();
        },
        // 장착 스킨 { creature, skin } | null (기본 모습·미장착·비로그인이면 null). 선택 버튼 아이콘/배지용 — 서버 판정과 무관한 미리보기.
        getEquippedSkin: function () {
            var id = _roomSkinId;
            if (!id) return null;
            var item = ShopModule.getCatalogItem(id);
            return (item && item.creature && item.skin) ? { creature: item.creature, skin: item.skin } : null;
        }
    };
})();
