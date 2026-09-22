/*
 * marble-shop.js — 데구리 동물 스킨 상점 어댑터 (ShopModule 위 얇은 게임 어댑터)
 *
 * 전역 `MarbleShop`. 공통 셸(인증/지갑/모달/구매/장착/잔고연출)은 js/shared/shop-shared.js
 * (window.ShopModule)이 담당. 이 어댑터는 데구리 고유부만 보유:
 *   - 상점(구매)·옷장(장착) 분리: config.closet — 버튼 2개(openShop/openCloset), 공유 셸의 _view 가 카드 모양을 바꾼다
 *   - 스킨 미리보기(buildPreview hook) — 스킨 시트(creatures/{creature}-{skin}.png)의 idle 첫 칸을 캔버스에
 *   - 소유/구매 상태(itemState hook — tier/requires 없음)
 *   - 지갑·구매·장착 전부 방 단위(roomWallet: marble:shop:get / marble:shop:buy / marble:equipSkin) — 계정 DB 지갑·prefs 를 쓰지 않는다.
 *     방에 들어오면 200코인, 한 판 +10, 산 스킨·장착은 그 방에서만 유효하고 나가면 전부 사라진다(사용자 2026-09-22: 1회용). 손님도 동일.
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

    // 방 지갑(marble:shop:get) 조회 — 서버가 준 equipped 가 방 장착값의 권위. 로그인 불필요
    function walletRequest(done) {
        if (!_socket) return done(null);
        _socket.emit('marble:shop:get', {}, function (res) { done(res); });
    }
    // 구매 — 방 지갑에서 차감(marble:shop:buy). 응답 { ok, balance, owned } 은 shop:buy 와 같은 형식
    function buyRequest(id, done) {
        if (!_socket) return done(null);
        _socket.emit('marble:shop:buy', { cosmeticId: id }, function (res) { done(res); });
    }
    // 지갑을 받을 때마다 방 장착값을 서버 값으로 맞춘다(getEquippedSkin·선택 버튼 배지 기준)
    function applyRoomSkin(wallet) {
        var eq = (wallet || ShopModule.getWallet()).equipped || {};
        _roomSkinId = eq[SLOT] || null;
    }
    // [장착]/[해제] 클릭 → 서버(방)에만 저장. done(equippedMap) 성공 / done(null) 실패
    function equipRequest(slot, id, done) {
        if (!_socket) return done(null, 'room');
        _socket.emit('marble:equipSkin', { cosmeticId: id }, function (res) {
            if (!res || !res.ok) return done(null, res && res.reason);
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
        roomWallet: true,             // 방 단위 지갑(사용자 2026-09-22: 코인·스킨은 그 방에서 1회용) — 입장 200코인, 한 판 +10, 나가면 소멸. 로그인 없이(손님도) 사용
        closetTitle: '옷장',
        closetSubtitle: '데구리 · 내 스킨 장착',
        slots: [{ key: SLOT, label: '동물 스킨' }],   // 단일 슬롯 → 탭바 미렌더
        coinShopOpen: true,   // 공통 COIN_SHOP_COMING_SOON 게이트를 데구리만 연다(사용자 2026-09-22) — 다른 게임 코인샵은 그대로 준비 중
        hooks: {
            noticeText: function () { return ''; },   // 안내 상자 없음(사용자 2026-09-22: 설명 문구 제거) — 공유 셸이 '' 면 상자를 안 그린다
            // 동물별 필터 칩(전체/고슴도치/…): 순서는 선택 버튼 순서(MARBLE_CREATURES), 이름은 렌더러 CREATURE_NAMES(돼지 등)
            groups: function () {
                var names = (window.MarbleRender && MarbleRender.CREATURE_NAMES) || {};
                var order = (typeof window.MARBLE_CREATURES !== 'undefined' && window.MARBLE_CREATURES) || Object.keys(names);
                return order.map(function (c) { return { key: c, label: names[c] || c }; });
            },
            itemGroup: function (item) { return item.creature || null; },
            // 칩 아이콘 = 그 동물 기본 시트의 서 있는 얼굴(선택 버튼과 같은 그림) — 스킨과 무관하게 기본 모습
            groupIcon: function (creature) {
                var R = window.marbleRendererForShop;
                if (!R || typeof R.drawCreatureIcon !== 'function') return null;
                var cv = document.createElement('canvas'); cv.width = 40; cv.height = 40; cv.className = 'mshop-chip-icon';
                R.drawCreatureIcon(cv, creature, 0, null);
                return cv;
            },
            buildPreview: buildSkinPreview,
            itemState: itemState,
            walletRequest: walletRequest,
            buyRequest: buyRequest,
            equipRequest: equipRequest,
            onEquipApplied: onEquipApplied,
            onWalletRefreshed: applyRoomSkin   // 상점/옷장을 열 때마다 서버 방 장착값으로 동기화
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
