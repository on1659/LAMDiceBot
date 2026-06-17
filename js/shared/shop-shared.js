/*
 * shop-shared.js — 전 게임 공용 꾸미기 상점 셸 (코인 + 인증 + 서버 인벤토리)
 *
 * 전역 `ShopModule`. ready-shared.js / order-shared.js 의 uniform 모듈 패턴.
 * 게임별 어댑터(js/horse-shop.js, js/spin-shop.js)가 init(config)로 설정을 등록하고
 * connect(socket)으로 늦게 소켓을 주입한다(소켓은 connect 이벤트 시점에 들어옴).
 *
 * 책임(공통): 토큰 읽기(localStorage.userAuth), socket 인증(socket:authenticate),
 *   지갑 상태(wallet:get + wallet:updated), 카탈로그 로드+인덱스, 모달 셸(헤더/잔고/닫기/
 *   안내/탭바/그리드), 카드 렌더(미리보기는 hook 위임), 구매 확인 다이얼로그, 장착/해제,
 *   토스트, 전용 팝업 레이어, 잔고 증감 애니메이션.
 *
 * 게임별 분리(hook): buildPreview / itemState / onWalletSynced / onPurchased / onEquipApplied
 *   + noticeText. 게임 전역(getVehicleSVG 등)은 어댑터 hook 안에서만 접근한다.
 *
 * 보안: 지갑/구매/장착은 모두 서버(socket.authedUserId) 권위. 토큰 없는 게스트는 이용 불가.
 * 공정성: cosmetic 데이터는 결과/시뮬/emit에 진입하지 않는다. Math.random() 미사용.
 */
(function () {
    'use strict';

    // 한 페이지 1인스턴스 — 내부 DOM id는 단일 상수로 통일(CSS는 .hshop-* 클래스 기반이라 무해).
    var BALANCE_ID = 'shopBalance';
    var LAYER_ID = 'shopLayer';

    var RARITY_LABEL = { common: '일반', rare: '레어', epic: '에픽', legend: '전설' };

    // ── 상태 ──────────────────────────────────────────────
    var _config = null;
    var _socket = null;
    var _socketWired = false;

    var _catalog = null;          // slot -> items[]
    var _catalogLoading = null;
    var _catalogIndex = {};       // id -> { slot, item }
    var _activeTab = null;        // 현재 탭(슬롯 key); slots[0]로 초기화

    // 서버 권위 지갑 상태
    var _wallet = { authed: false, balance: 0, owned: [], equipped: {} };

    // ── 유틸 ──────────────────────────────────────────────

    function getMount() { return document.getElementById(_config.mountId); }

    function getToken() {
        try {
            var auth = JSON.parse(localStorage.getItem('userAuth') || 'null');
            return (auth && auth.token) ? auth.token : null;
        } catch (e) { return null; }
    }

    function findItem(slot, id) {
        if (!_catalog || !id) return null;
        var list = _catalog[slot] || [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function getCatalogItem(id) {
        return _catalogIndex[id] ? _catalogIndex[id].item : null;
    }

    function owns(id) { return _wallet.owned.indexOf(id) !== -1; }

    function activeSlots() {
        return (_config && Array.isArray(_config.slots)) ? _config.slots : [];
    }

    // 단일 탭바 미렌더 여부
    function isSingleSlot() { return activeSlots().length <= 1; }

    // ── 카탈로그 로드 ──────────────────────────────────────

    function loadCatalog() {
        if (_catalog) return Promise.resolve(_catalog);
        if (_catalogLoading) return _catalogLoading;
        _catalogLoading = fetch(_config.catalogUrl)
            .then(function (res) {
                if (!res.ok) throw new Error('catalog load failed: ' + res.status);
                return res.json();
            })
            .then(function (json) {
                _catalog = json;
                _catalogIndex = {};
                Object.keys(json).forEach(function (slot) {
                    (json[slot] || []).forEach(function (item) {
                        if (item && item.id) _catalogIndex[item.id] = { slot: slot, item: item };
                    });
                });
                _catalogLoading = null;
                return _catalog;
            })
            .catch(function (err) {
                _catalogLoading = null;
                console.warn('[ShopModule] 카탈로그 로드 실패:', err.message);
                throw err;
            });
        return _catalogLoading;
    }

    // ── 소켓 연결/인증 ─────────────────────────────────────

    // 어댑터가 socket 정의 후 1회 호출 (멱등).
    function connect(socket) {
        _socket = socket;
        if (_socketWired || !socket) return;
        _socketWired = true;
        socket.on('wallet:updated', function (data) {
            if (data && typeof data.balance === 'number') {
                var prev = _wallet.balance;
                _wallet.balance = data.balance;
                if (document.getElementById(BALANCE_ID)) animateBalanceDelta(prev, data.balance);
                else updateBalanceLabel();
            }
        });
    }

    // 토큰으로 socket 인증 → 성공 시 지갑 동기화. 매 connect마다 호출 가능(멱등).
    function authenticate(token, done) {
        if (!_socket || !token) { if (done) done(false); return; }
        _socket.emit('socket:authenticate', { token: token }, function (res) {
            if (res && res.ok) {
                _wallet.authed = true;
                _wallet.balance = (typeof res.balance === 'number') ? res.balance : 0;
                refreshWallet(function () {
                    if (_config && _config.hooks && _config.hooks.onWalletSynced) {
                        _config.hooks.onWalletSynced(_wallet);
                    }
                    if (done) done(true);
                });
            } else {
                _wallet.authed = false;
                if (done) done(false);
            }
        });
    }

    // 지갑 상세(잔고+소유+장착) 동기화
    function refreshWallet(done) {
        if (!_socket || !_wallet.authed) { if (done) done(); return; }
        _socket.emit('wallet:get', {}, function (res) {
            if (res && res.ok) {
                _wallet.balance = res.balance || 0;
                _wallet.owned = Array.isArray(res.owned) ? res.owned : [];
                _wallet.equipped = res.equipped || {};
            }
            if (done) done();
        });
    }

    // ── 잔고 표시 / 증감 애니메이션 ──────────────────────────

    function updateBalanceLabel() {
        var el = document.getElementById(BALANCE_ID);
        if (el) el.textContent = '🪙 ' + _wallet.balance;
    }

    function animateEnabled() {
        return !(_config && _config.animateBalance === false);
    }

    // 잔고 숫자를 from→to 로 부드럽게 카운트(easeOutCubic). 최종값은 to 로 수렴(서버 권위).
    function countBalanceTo(el, from, to) {
        var DURATION = 480;
        var startTs = null;
        function step(ts) {
            if (startTs === null) startTs = ts;
            var p = Math.min(1, (ts - startTs) / DURATION);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = '🪙 ' + Math.round(from + (to - from) * eased);
            if (p < 1) requestAnimationFrame(step);
            else el.textContent = '🪙 ' + to;
        }
        requestAnimationFrame(step);
    }

    // 잔고 배지 근처에 떠오르며 사라지는 ±금액 (차감=빨강 −, 적립=초록 +).
    function spawnBalanceDelta(badgeEl, delta) {
        var rect = badgeEl.getBoundingClientRect();
        var f = document.createElement('div');
        f.className = 'hshop-delta ' + (delta < 0 ? 'is-spend' : 'is-earn');
        f.textContent = (delta < 0 ? '−' : '+') + Math.abs(delta);
        f.style.left = (rect.left + rect.width / 2) + 'px';
        f.style.top = rect.top + 'px';
        getShopLayer().appendChild(f);
        setTimeout(function () { if (f.parentNode) f.remove(); }, 1100);
    }

    // 차감/적립 연출: ±금액 플로팅 + 잔고 카운트 + 짧은 플래시. 순수 시각, 값은 to 로 수렴.
    function animateBalanceDelta(prev, next) {
        var el = document.getElementById(BALANCE_ID);
        if (!el) { updateBalanceLabel(); return; }
        if (!animateEnabled()) { el.textContent = '🪙 ' + next; return; }
        if (prev === next) { el.textContent = '🪙 ' + next; return; }
        var dir = next < prev ? 'spend' : 'earn';
        spawnBalanceDelta(el, next - prev);
        el.classList.remove('hshop-balance--spend', 'hshop-balance--earn');
        void el.offsetWidth; // reflow → 플래시 애니메이션 재시작
        el.classList.add('hshop-balance--' + dir);
        setTimeout(function () { el.classList.remove('hshop-balance--' + dir); }, 600);
        countBalanceTo(el, prev, next);
    }

    // ── 상점 전용 팝업 레이어 (확인/토스트) ───────────────────
    // 전역 showCustomAlert(z-index 10000)는 상점(.hshop-overlay 12000) 뒤에 가려지므로,
    // 상점 위(12500+) 전용 레이어를 둔다. 전역 함수 미수정 → 크로스게임 회귀 없음.

    function getShopLayer() {
        var layer = document.getElementById(LAYER_ID);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = LAYER_ID;
            layer.className = 'hshop-layer';
            document.body.appendChild(layer);
        }
        return layer;
    }

    function clearShopLayer() {
        var layer = document.getElementById(LAYER_ID);
        if (layer) layer.remove();
    }

    // 구매 확인 다이얼로그 (아이템명·가격). 확인 시에만 onConfirm 실행.
    function showShopConfirm(item, onConfirm) {
        var ov = document.createElement('div');
        ov.className = 'hshop-confirm-overlay';

        var card = document.createElement('div');
        card.className = 'hshop-confirm';

        var title = document.createElement('div');
        title.className = 'hshop-confirm-title';
        title.textContent = '정말로 구매하실래요?';

        var line = document.createElement('div');
        line.className = 'hshop-confirm-item';
        var nm = document.createElement('span');
        nm.className = 'hshop-confirm-name';
        nm.textContent = item.name;
        var pr = document.createElement('span');
        pr.className = 'hshop-confirm-price';
        pr.textContent = '🪙 ' + item.price;
        line.appendChild(nm);
        line.appendChild(pr);

        var btns = document.createElement('div');
        btns.className = 'hshop-confirm-btns';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'hshop-confirm-cancel';
        cancel.textContent = '취소';
        var ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'hshop-confirm-ok';
        ok.textContent = '구매';

        function close() { if (ov.parentNode) ov.remove(); }
        cancel.addEventListener('click', close);
        ok.addEventListener('click', function () { close(); if (onConfirm) onConfirm(); });
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

        btns.appendChild(cancel);
        btns.appendChild(ok);
        card.appendChild(title);
        card.appendChild(line);
        card.appendChild(btns);
        ov.appendChild(card);
        getShopLayer().appendChild(ov);
    }

    // 상점 위 토스트 (성공/실패). kind: 'success' | 'error'
    function showShopToast(message, kind) {
        var toast = document.createElement('div');
        toast.className = 'hshop-toast' + (kind ? ' hshop-toast--' + kind : '');
        toast.textContent = message;
        getShopLayer().appendChild(toast);
        requestAnimationFrame(function () { toast.classList.add('is-visible'); });
        setTimeout(function () {
            toast.classList.remove('is-visible');
            setTimeout(function () { if (toast.parentNode) toast.remove(); }, 250);
        }, 1800);
    }

    // ── 모달 렌더 ──────────────────────────────────────────

    // 게임별 itemState hook 결과(없으면 horse 기본: 소유=owns(id), 구매가능, 잠금없음).
    function itemStateFor(item) {
        if (_config && _config.hooks && _config.hooks.itemState) {
            var st = _config.hooks.itemState(item) || {};
            return {
                owned: !!st.owned,
                buyable: st.buyable !== false,
                lockLabel: st.lockLabel || null
            };
        }
        return { owned: owns(item.id), buyable: true, lockLabel: null };
    }

    function renderCard(slot, item) {
        var card = document.createElement('div');
        card.className = 'hshop-card';

        var rarity = item.rarity || 'common';

        var thumb = document.createElement('div');
        thumb.className = 'hshop-thumb hshop-thumb--' + rarity;
        // 트랙테마 등 그라데이션 썸네일 배경(어댑터가 item.bg를 줄 때만)
        if (slot === 'track_theme' && item.bg) thumb.style.backgroundImage = item.bg;
        var badge = document.createElement('span');
        badge.className = 'hshop-rarity hshop-rarity--' + rarity;
        badge.textContent = RARITY_LABEL[rarity] || rarity;
        thumb.appendChild(badge);

        // 미리보기는 어댑터 hook 위임 (게임 전역 접근은 여기서만 일어남)
        var preview = null;
        if (_config && _config.hooks && _config.hooks.buildPreview) {
            try { preview = _config.hooks.buildPreview(slot, item); } catch (e) { preview = null; }
        }
        if (preview) {
            thumb.appendChild(preview);
        } else {
            var glyph = document.createElement('span');
            glyph.className = 'hshop-glyph';
            glyph.textContent = item.emoji || '🎁';
            thumb.appendChild(glyph);
        }

        var nm = document.createElement('div');
        nm.className = 'hshop-name';
        nm.textContent = item.name;

        var state = itemStateFor(item);
        var isEquipped = _wallet.equipped[slot] === item.id;

        // 가격 노드는 미소유 + price가 유한할 때만 (D6: spin defaultOwned 무가격 대응)
        var price = null;
        if (!state.owned && Number.isFinite(item.price)) {
            price = document.createElement('div');
            price.className = 'hshop-price';
            price.textContent = '🪙 ' + item.price;
        }

        var btn = document.createElement('button');
        btn.type = 'button';

        if (!state.owned) {
            btn.className = 'hshop-buy';
            if (!state.buyable) {
                btn.textContent = state.lockLabel || '구매 불가';
                btn.disabled = true;
            } else {
                btn.textContent = Number.isFinite(item.price) ? '구매 (' + item.price + ')' : '구매';
                btn.addEventListener('click', function () { requestBuy(item, btn); });
            }
        } else {
            btn.className = 'hshop-equip' + (isEquipped ? ' is-equipped' : '');
            btn.textContent = isEquipped ? '✓ 장착중' : '장착';
            btn.addEventListener('click', function () { doEquip(slot, isEquipped ? null : item.id); });
        }

        card.appendChild(thumb);
        card.appendChild(nm);
        if (price) card.appendChild(price);
        card.appendChild(btn);
        return card;
    }

    function renderTabBar() {
        var bar = document.createElement('div');
        bar.className = 'hshop-tabs';
        activeSlots().forEach(function (slot) {
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'hshop-tab' + (_activeTab === slot.key ? ' is-active' : '');
            tab.textContent = slot.label || slot.key;
            tab.addEventListener('click', function () { _activeTab = slot.key; renderModal(); });
            bar.appendChild(tab);
        });
        return bar;
    }

    function noticeFor(slot) {
        if (_config && _config.hooks && _config.hooks.noticeText) {
            return _config.hooks.noticeText(slot);
        }
        return _config.noticeText || '꾸미기는 게임 결과에 영향을 주지 않아요. 코인으로 구매 후 장착하세요.';
    }

    function renderModal() {
        var mount = getMount();
        if (!mount || !_catalog) return;
        mount.innerHTML = '';

        var overlay = document.createElement('div');
        overlay.className = 'hshop-overlay';
        overlay.addEventListener('click', function (e) { if (e.target === overlay) closeShop(); });

        var panel = document.createElement('div');
        panel.className = 'hshop-panel';

        // 헤더 (제목 + 잔고 + 닫기)
        var header = document.createElement('div');
        header.className = 'hshop-header';
        var titleWrap = document.createElement('div');
        titleWrap.className = 'hshop-title';
        // 제목/부제는 상수(어댑터 config) — 유저 입력 아님. textContent로 분리 구성.
        titleWrap.textContent = _config.title || '꾸미기 상점';
        if (_config.subtitle) {
            var small = document.createElement('small');
            small.textContent = _config.subtitle;
            titleWrap.appendChild(small);
        }
        var bal = document.createElement('div');
        bal.className = 'hshop-balance';
        bal.id = BALANCE_ID;
        bal.textContent = '🪙 ' + _wallet.balance;
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'hshop-close';
        closeBtn.setAttribute('aria-label', '닫기');
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', closeShop);
        header.appendChild(titleWrap);
        header.appendChild(bal);
        header.appendChild(closeBtn);

        var notice = document.createElement('div');
        notice.className = 'hshop-notice';
        notice.textContent = noticeFor(_activeTab);

        var grid = document.createElement('div');
        grid.className = 'hshop-grid';
        var list = _catalog[_activeTab] || [];
        if (list.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'hshop-empty';
            empty.textContent = '준비 중인 카테고리예요.';
            grid.appendChild(empty);
        } else {
            list.forEach(function (item) { grid.appendChild(renderCard(_activeTab, item)); });
        }

        panel.appendChild(header);
        panel.appendChild(notice);
        if (!isSingleSlot()) panel.appendChild(renderTabBar());
        panel.appendChild(grid);
        overlay.appendChild(panel);
        mount.appendChild(overlay);
    }

    // ── 구매 / 장착 ────────────────────────────────────────

    // 구매 버튼 → 확인 팝업 → 확인 시에만 emit
    function requestBuy(item, btn) {
        if (!_socket || !_wallet.authed) return;
        showShopConfirm(item, function () { doBuy(item.id, btn); });
    }

    function doBuy(id, btn) {
        if (!_socket || !_wallet.authed) return;
        if (btn) { btn.disabled = true; btn.textContent = '구매 중…'; }
        _socket.emit('shop:buy', { cosmeticId: id }, function (res) {
            if (res && res.ok) {
                var prev = _wallet.balance;
                _wallet.balance = res.balance;
                _wallet.owned = Array.isArray(res.owned) ? res.owned : _wallet.owned;
                renderModal(); // 잔고 배지 재생성 후 연출
                animateBalanceDelta(prev, res.balance);
                if (_config && _config.hooks && _config.hooks.onPurchased) {
                    _config.hooks.onPurchased(_wallet);
                }
                showShopToast('구매했습니다', 'success');
            } else {
                var msg = (res && res.reason === 'insufficient') ? '코인이 부족해요.'
                        : (res && res.reason === 'owned') ? '이미 가지고 있어요.'
                        : (res && res.reason === 'requires') ? '먼저 그 색 스킨을 구매해야 해요.'
                        : '구매에 실패했어요.';
                showShopToast(msg, 'error');
                renderModal();
            }
        });
    }

    function doEquip(slot, id) {
        if (!_socket || !_wallet.authed) return;
        _socket.emit('shop:equip', { slot: slot, cosmeticId: id }, function (res) {
            if (res && res.ok) {
                _wallet.equipped = res.equipped || {};
                renderModal();
                // force=true: 장착 액션(현재 선택을 덮음)
                if (_config && _config.hooks && _config.hooks.onEquipApplied) {
                    _config.hooks.onEquipApplied(_wallet.equipped, true);
                }
            } else {
                showShopToast('장착에 실패했어요.', 'error');
            }
        });
    }

    // ── 모달 열기/닫기 ─────────────────────────────────────

    function openShop() {
        var token = getToken();
        if (!token) {
            if (typeof showCustomAlert === 'function') showCustomAlert('상점은 로그인 후 이용할 수 있어요.');
            else alert('상점은 로그인 후 이용할 수 있어요.');
            return;
        }
        loadCatalog().then(function () {
            if (_wallet.authed) {
                refreshWallet(function () { renderModal(); document.body.classList.add('hshop-open'); });
            } else {
                authenticate(token, function (ok) {
                    if (!ok) {
                        if (typeof showCustomAlert === 'function') showCustomAlert('인증에 실패했어요. 다시 로그인해 주세요.');
                        return;
                    }
                    renderModal();
                    document.body.classList.add('hshop-open');
                });
            }
        }).catch(function () {
            if (typeof showCustomAlert === 'function') showCustomAlert('상점 정보를 불러오지 못했어요.');
        });
    }

    function closeShop() {
        var mount = getMount();
        if (mount) mount.innerHTML = '';
        clearShopLayer();
        document.body.classList.remove('hshop-open');
    }

    // ── 초기화 ─────────────────────────────────────────────

    // init(config) 또는 init(socket, config). socket nullable — connect()로 늦게 주입 가능.
    function init(socketOrConfig, maybeConfig) {
        var socket = null, config = null;
        if (maybeConfig === undefined) {
            config = socketOrConfig;
        } else {
            socket = socketOrConfig;
            config = maybeConfig;
        }
        _config = config || {};
        var slots = activeSlots();
        _activeTab = slots.length ? slots[0].key : null;
        if (socket) connect(socket);
    }

    // ── 공개 API ───────────────────────────────────────────

    window.ShopModule = {
        init: init,
        connect: connect,
        authenticate: authenticate,
        loadCatalog: loadCatalog,
        openShop: openShop,
        closeShop: closeShop,
        isAuthed: function () { return _wallet.authed; },
        // 어댑터가 게임별 메서드(applyToHorse 등) 구현에 쓰는 읽기 getter
        getWallet: function () { return _wallet; },
        getEquipped: function () { return _wallet.equipped; },
        getCatalog: function () { return _catalog; },
        getCatalogItem: getCatalogItem,
        findItem: findItem
    };
})();
