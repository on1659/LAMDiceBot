/*
 * spin-shop.js — 회전 칼날 꾸미기 상점 (코인 + 인증 + 서버 인벤토리)
 *
 * 전역 `SpinShop`. 자기완결 모듈 — js/horse-shop.js 미러(게임별 독립 파일 관례).
 *
 * 보안: 지갑/구매/장착은 모두 서버(socket.authedUserId) 권위. 이 모듈은
 *   socket:authenticate(token) → wallet:get → shop:buy/shop:equip 로만 동작한다.
 *   토큰 없는 게스트는 상점 이용 불가(구매/장착 없음).
 *
 * 공정성: cosmetic 데이터는 결과 계산이나 게임 emit(시뮬 입력)에 진입하지 않는다.
 *   장착 반영은 spin-arena.js의 spinShopSync 훅 → spin-arena:selectSkin 한정(서버가 소유 재검증).
 *   Math.random() 미사용.
 *
 * CSS: 경마 상점(css/horse-shop.css)의 .hshop-* 클래스 재사용 — spin-arena.css가
 *   --horse-* 변수를 spin 색으로 alias하므로 자동으로 게임 색이 입혀진다.
 */
(function () {
    'use strict';

    var CATALOG_URL = '/config/spin-arena/cosmetics.json';
    var SLOT = 'spin_skin';
    var COSMETIC_PREFIX = 'spin_skin_';

    var RARITY_LABEL = { common: '일반', rare: '레어', epic: '에픽', legend: '전설' };

    var catalog = null;          // { spin_skin: [...] }
    var catalogLoading = null;
    var catalogIndex = {};       // id -> item

    var socketRef = null;
    var socketWired = false;

    // 서버 권위 지갑 상태
    var wallet = { authed: false, balance: 0, owned: [], equipped: {} };

    // ── 유틸 ──────────────────────────────────────────────

    function getMount() { return document.getElementById('spinShopMount'); }

    function getToken() {
        try {
            var auth = JSON.parse(localStorage.getItem('userAuth') || 'null');
            return (auth && auth.token) ? auth.token : null;
        } catch (e) { return null; }
    }

    function owns(id) { return wallet.owned.indexOf(id) !== -1; }

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
            window.spinShopSync(cosmeticToSkinId(wallet.equipped[SLOT] || ''), !!force);
        }
        refreshGamePicker();
    }

    // ── 카탈로그 로드 ──────────────────────────────────────

    function loadCatalog() {
        if (catalog) return Promise.resolve(catalog);
        if (catalogLoading) return catalogLoading;
        catalogLoading = fetch(CATALOG_URL)
            .then(function (res) {
                if (!res.ok) throw new Error('catalog load failed: ' + res.status);
                return res.json();
            })
            .then(function (json) {
                catalog = json;
                catalogIndex = {};
                (json[SLOT] || []).forEach(function (item) {
                    if (item && item.id) catalogIndex[item.id] = item;
                });
                catalogLoading = null;
                return catalog;
            })
            .catch(function (err) {
                catalogLoading = null;
                console.warn('[SpinShop] 카탈로그 로드 실패:', err.message);
                throw err;
            });
        return catalogLoading;
    }

    // ── 소켓 연결/인증 ─────────────────────────────────────

    // spin-arena.js가 socket 정의 후 connect 시 호출 (멱등)
    function connect(socket) {
        socketRef = socket;
        if (socketWired || !socket) return;
        socketWired = true;
        socket.on('wallet:updated', function (data) {
            if (data && typeof data.balance === 'number') {
                wallet.balance = data.balance;
                updateBalanceLabel();
            }
        });
    }

    // 토큰으로 socket 인증 → 성공 시 지갑 동기화. 매 connect마다 호출 가능(멱등).
    function authenticate(token, done) {
        if (!socketRef || !token) { if (done) done(false); return; }
        socketRef.emit('socket:authenticate', { token: token }, function (res) {
            if (res && res.ok) {
                wallet.authed = true;
                wallet.balance = (typeof res.balance === 'number') ? res.balance : 0;
                refreshWallet(function () {
                    // 카탈로그를 미리 받아 피커 잠금/장착 동기화 (실패해도 게임 진행 무영향)
                    loadCatalog().then(function () { syncEquippedToGame(false); })
                        .catch(function () { syncEquippedToGame(false); });
                    if (done) done(true);
                });
            } else {
                wallet.authed = false;
                if (done) done(false);
            }
        });
    }

    // 지갑 상세(잔고+소유+장착) 동기화
    function refreshWallet(done) {
        if (!socketRef || !wallet.authed) { if (done) done(); return; }
        socketRef.emit('wallet:get', {}, function (res) {
            if (res && res.ok) {
                wallet.balance = res.balance || 0;
                wallet.owned = Array.isArray(res.owned) ? res.owned : [];
                wallet.equipped = res.equipped || {};
            }
            if (done) done();
        });
    }

    // ── 잔고 표시 ──────────────────────────────────────────

    function updateBalanceLabel() {
        var el = document.getElementById('sshopBalance');
        if (el) el.textContent = '🪙 ' + wallet.balance;
    }

    // ── 상점 전용 팝업 레이어 (확인/토스트 — hshop 레이어 패턴 미러) ──

    function getShopLayer() {
        var layer = document.getElementById('sshopLayer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'sshopLayer';
            layer.className = 'hshop-layer';
            document.body.appendChild(layer);
        }
        return layer;
    }

    function clearShopLayer() {
        var layer = document.getElementById('sshopLayer');
        if (layer) layer.remove();
    }

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

    // 스킨 미리보기 점 (피커 .spin-skin-dot와 동일 문법 — 카탈로그 상수 색만 사용)
    function buildSkinPreview(item) {
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

    function renderCard(item) {
        var card = document.createElement('div');
        card.className = 'hshop-card';

        var rarity = item.rarity || 'common';

        var thumb = document.createElement('div');
        thumb.className = 'hshop-thumb hshop-thumb--' + rarity;
        var badge = document.createElement('span');
        badge.className = 'hshop-rarity hshop-rarity--' + rarity;
        badge.textContent = RARITY_LABEL[rarity] || rarity;
        thumb.appendChild(badge);
        thumb.appendChild(buildSkinPreview(item));

        var nm = document.createElement('div');
        nm.className = 'hshop-name';
        nm.textContent = item.name;

        var btn = document.createElement('button');
        btn.type = 'button';

        var isDefault = !!item.defaultOwned;
        var owned = isDefault || owns(item.id);
        var isEquipped = wallet.equipped[SLOT] === item.id;
        // 선행 조건(스킨업): requires 미충족이면 구매 잠금
        var reqItem = item.requires ? catalogIndex[item.requires] : null;
        var reqMet = !item.requires || (reqItem && reqItem.defaultOwned) || owns(item.requires);

        var price = null;
        if (!owned && Number.isFinite(item.price)) {
            price = document.createElement('div');
            price.className = 'hshop-price';
            price.textContent = '🪙 ' + item.price;
        }

        if (!owned) {
            btn.className = 'hshop-buy';
            if (!reqMet) {
                btn.textContent = '선행 스킨 필요';
                btn.disabled = true;
            } else {
                btn.textContent = '구매 (' + item.price + ')';
                btn.addEventListener('click', function () { requestBuy(item, btn); });
            }
        } else {
            btn.className = 'hshop-equip' + (isEquipped ? ' is-equipped' : '');
            btn.textContent = isEquipped ? '✓ 장착중' : '장착';
            btn.addEventListener('click', function () { doEquip(isEquipped ? null : item.id); });
        }

        card.appendChild(thumb);
        card.appendChild(nm);
        if (price) card.appendChild(price);
        card.appendChild(btn);
        return card;
    }

    function renderModal() {
        var mount = getMount();
        if (!mount || !catalog) return;
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
        titleWrap.innerHTML = '꾸미기 상점<small>회전 칼날 · 내 스킨</small>';
        var bal = document.createElement('div');
        bal.className = 'hshop-balance';
        bal.id = 'sshopBalance';
        bal.textContent = '🪙 ' + wallet.balance;
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
        notice.textContent = '스킨은 게임 결과에 영향을 주지 않아요. 스킨업(Ⅱ)은 같은 색의 강화 비주얼 — 먼저 그 색 스킨을 가지고 있어야 해요.';

        var grid = document.createElement('div');
        grid.className = 'hshop-grid';
        var list = catalog[SLOT] || [];
        if (list.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'hshop-empty';
            empty.textContent = '준비 중이에요.';
            grid.appendChild(empty);
        } else {
            list.forEach(function (item) { grid.appendChild(renderCard(item)); });
        }

        panel.appendChild(header);
        panel.appendChild(notice);
        panel.appendChild(grid);
        overlay.appendChild(panel);
        mount.appendChild(overlay);
    }

    // ── 구매 / 장착 ────────────────────────────────────────

    function requestBuy(item, btn) {
        if (!socketRef || !wallet.authed) return;
        showShopConfirm(item, function () { doBuy(item.id, btn); });
    }

    function doBuy(id, btn) {
        if (!socketRef || !wallet.authed) return;
        if (btn) { btn.disabled = true; btn.textContent = '구매 중…'; }
        socketRef.emit('shop:buy', { cosmeticId: id }, function (res) {
            if (res && res.ok) {
                wallet.balance = res.balance;
                wallet.owned = Array.isArray(res.owned) ? res.owned : wallet.owned;
                renderModal();
                updateBalanceLabel();
                refreshGamePicker();   // 피커 잠금 해제 반영
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

    function doEquip(id) {
        if (!socketRef || !wallet.authed) return;
        socketRef.emit('shop:equip', { slot: SLOT, cosmeticId: id }, function (res) {
            if (res && res.ok) {
                wallet.equipped = res.equipped || {};
                renderModal();
                syncEquippedToGame(true);   // 장착 액션 — 현재 선택을 장착 스킨으로 덮음
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
            if (wallet.authed) {
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

    // ── 공개 API ───────────────────────────────────────────

    window.SpinShop = {
        connect: connect,
        authenticate: authenticate,
        loadCatalog: loadCatalog,
        openShop: openShop,
        closeShop: closeShop,
        // 소유한 게임 skinId 배열 ('crimson_t2' 형태) — 피커 잠금 판단용
        getOwnedSkinIds: function () {
            var out = [];
            for (var i = 0; i < wallet.owned.length; i++) {
                var sid = cosmeticToSkinId(wallet.owned[i]);
                if (sid) out.push(sid);
            }
            return out;
        },
        getEquippedSkinId: function () { return cosmeticToSkinId(wallet.equipped[SLOT] || ''); },
        isAuthed: function () { return wallet.authed; }
    };
})();
