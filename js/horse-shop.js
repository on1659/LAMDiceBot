/*
 * horse-shop.js — 경마 꾸미기 상점 (코인 + 인증 + 서버 인벤토리)
 *
 * 전역 `HorseShop`. 자기완결 모듈.
 *
 * 보안: 지갑/구매/장착은 모두 서버(socket.authedUserId) 권위. 이 모듈은
 *   socket:authenticate(token) → wallet:get → shop:buy/shop:equip 로만 동작한다.
 *   토큰 없는 게스트는 상점 이용 불가(구매/장착 없음).
 *
 * 공정성: cosmetic 데이터는 결과 계산이나 게임 emit에 진입하지 않는다.
 *   도색 필터는 .vehicle-sprite 에만(이벤트 연출이 .horse filter 점유).
 *   Math.random() 미사용.
 */
(function () {
    'use strict';

    var CATALOG_URL = '/config/horse/cosmetics.json';
    // 상점 탭(슬롯). track_theme/finish_fx는 방장 장착분만 방 전체 적용(개인은 소유/장착만).
    var SLOTS = ['paint', 'trail', 'accessory', 'bib', 'track_theme', 'finish_fx'];
    var TAB_LABELS = {
        paint: '🎨 도색', trail: '✨ 트레일', accessory: '👑 액세서리',
        bib: '🔢 마번', track_theme: '🏞️ 트랙테마', finish_fx: '🎆 결승연출'
    };

    var RARITY_LABEL = { common: '일반', rare: '레어', epic: '에픽', legend: '전설' };

    // 카드 썸네일에 실제 탈것을 그려 꾸미기 적용 모습을 미리보기로 보여줄 슬롯
    var HORSE_PREVIEW_SLOTS = ['paint', 'trail', 'accessory', 'bib'];
    var PREVIEW_VEHICLE = 'car'; // 미리보기 샘플 탈것 (getVehicleSVG, horse-race-sprites.js)

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

    var catalog = null;
    var catalogLoading = null;
    var catalogIndex = {};   // id -> { slot, item }
    var activeTab = 'paint';

    var socketRef = null;
    var socketWired = false;

    // 서버 권위 지갑 상태
    var wallet = { authed: false, balance: 0, owned: [], equipped: {} };

    // ── 유틸 ──────────────────────────────────────────────

    function getMount() { return document.getElementById('horseShopMount'); }

    function getToken() {
        try {
            var auth = JSON.parse(localStorage.getItem('userAuth') || 'null');
            return (auth && auth.token) ? auth.token : null;
        } catch (e) { return null; }
    }

    // 토큰이 있으면 그대로 반환. 없는데 로그인 상태(userAuth.name)면 PIN 없이
    // 토큰을 부트스트랩 발급받아 userAuth에 저장한다 — 상점 도입 전 로그인
    // 사용자의 재로그인 방지. 비로그인(name 없음)이면 null.
    // (발급 토큰은 플레이머니 전용 신뢰 등급 — 현금화는 별도 게이트)
    function ensureToken(done) {
        var existing = getToken();
        if (existing) { done(existing); return; }
        var name = null;
        try { var a = JSON.parse(localStorage.getItem('userAuth') || 'null'); name = a && a.name; } catch (e) {}
        if (!name) { done(null); return; }
        fetch('/api/auth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (res) {
            if (res && res.token) {
                try {
                    var a2 = JSON.parse(localStorage.getItem('userAuth') || '{}') || {};
                    a2.token = res.token;
                    if (res.user) { a2.id = res.user.id; a2.name = res.user.name; }
                    localStorage.setItem('userAuth', JSON.stringify(a2));
                } catch (e) {}
                done(res.token);
            } else { done(null); }
          }).catch(function () { done(null); });
    }

    function findItem(slot, id) {
        if (!catalog || !id) return null;
        var list = catalog[slot] || [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function getCatalogItem(id) {
        return catalogIndex[id] ? catalogIndex[id].item : null;
    }

    function owns(id) { return wallet.owned.indexOf(id) !== -1; }

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
                Object.keys(json).forEach(function (slot) {
                    (json[slot] || []).forEach(function (item) {
                        if (item && item.id) catalogIndex[item.id] = { slot: slot, item: item };
                    });
                });
                catalogLoading = null;
                return catalog;
            })
            .catch(function (err) {
                catalogLoading = null;
                console.warn('[HorseShop] 카탈로그 로드 실패:', err.message);
                throw err;
            });
        return catalogLoading;
    }

    // ── 소켓 연결/인증 ─────────────────────────────────────

    // horse-race.js가 socket 정의 후 1회 호출.
    function connect(socket) {
        socketRef = socket;
        if (socketWired || !socket) return;
        socketWired = true;
        socket.on('wallet:updated', function (data) {
            if (data && typeof data.balance === 'number') {
                var prev = wallet.balance;
                wallet.balance = data.balance;
                if (document.getElementById('hshopBalance')) animateBalanceDelta(prev, data.balance);
                else updateBalanceLabel();
            }
        });
    }

    // 토큰으로 socket 인증 → 성공 시 지갑 동기화. 매 connect마다 호출 가능(멱등).
    function authenticate(token, done) {
        if (!socketRef || !token) {
            console.log('[상점진단] authenticate 중단 — socketRef:', !!socketRef, '| token:', !!token);
            if (done) done(false); return;
        }
        socketRef.emit('socket:authenticate', { token: token }, function (res) {
            console.log('[상점진단] socket:authenticate 응답:', res);
            if (res && res.ok) {
                wallet.authed = true;
                wallet.balance = (typeof res.balance === 'number') ? res.balance : 0;
                refreshWallet(function () {
                    applyToActiveHorses();
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

    // ── 모달 렌더 ──────────────────────────────────────────

    function updateBalanceLabel() {
        var el = document.getElementById('hshopBalance');
        if (el) el.textContent = '🪙 ' + wallet.balance;
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
        var el = document.getElementById('hshopBalance');
        if (!el) { updateBalanceLabel(); return; }
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
        var layer = document.getElementById('hshopLayer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'hshopLayer';
            layer.className = 'hshop-layer';
            document.body.appendChild(layer);
        }
        return layer;
    }

    function clearShopLayer() {
        var layer = document.getElementById('hshopLayer');
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

    function renderCard(slot, item) {
        var card = document.createElement('div');
        card.className = 'hshop-card';

        var rarity = item.rarity || 'common';
        var preview = item.emoji || (slot === 'paint' ? '🎨' : slot === 'track_theme' ? '🏞️' : '🎁');

        var thumb = document.createElement('div');
        thumb.className = 'hshop-thumb hshop-thumb--' + rarity;
        // 트랙테마는 그라데이션이 썸네일 배경
        if (slot === 'track_theme' && item.bg) thumb.style.backgroundImage = item.bg;
        var badge = document.createElement('span');
        badge.className = 'hshop-rarity hshop-rarity--' + rarity;
        badge.textContent = RARITY_LABEL[rarity] || rarity;
        thumb.appendChild(badge);
        // 슬롯별 미리보기: 트랙테마=미니 트랙 / 결승연출=이펙트 루프 / 탈것 슬롯=실제 탈것 / 그 외=글리프
        if (slot === 'track_theme') {
            thumb.appendChild(buildTrackThemePreview(item));
        } else if (slot === 'finish_fx') {
            thumb.appendChild(buildFinishFxPreview(item));
        } else if (HORSE_PREVIEW_SLOTS.indexOf(slot) !== -1 && typeof getVehicleSVG === 'function') {
            thumb.appendChild(buildItemPreview(slot, item));
        } else {
            var glyph = document.createElement('span');
            glyph.className = 'hshop-glyph';
            glyph.textContent = preview;
            thumb.appendChild(glyph);
        }

        var nm = document.createElement('div');
        nm.className = 'hshop-name';
        nm.textContent = item.name;

        var price = document.createElement('div');
        price.className = 'hshop-price';
        price.textContent = '🪙 ' + item.price;

        var btn = document.createElement('button');
        btn.type = 'button';
        var owned = owns(item.id);
        var isEquipped = wallet.equipped[slot] === item.id;

        if (!owned) {
            btn.className = 'hshop-buy';
            btn.textContent = '구매 (' + item.price + ')';
            btn.addEventListener('click', function () { requestBuy(item, btn); });
        } else {
            btn.className = 'hshop-equip' + (isEquipped ? ' is-equipped' : '');
            btn.textContent = isEquipped ? '✓ 장착중' : '장착';
            btn.addEventListener('click', function () { doEquip(slot, isEquipped ? null : item.id); });
        }

        card.appendChild(thumb);
        card.appendChild(nm);
        if (!owned) card.appendChild(price);
        card.appendChild(btn);
        return card;
    }

    function renderTabBar() {
        var bar = document.createElement('div');
        bar.className = 'hshop-tabs';
        SLOTS.forEach(function (slot) {
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'hshop-tab' + (activeTab === slot ? ' is-active' : '');
            tab.textContent = TAB_LABELS[slot] || slot;
            tab.addEventListener('click', function () { activeTab = slot; renderModal(); });
            bar.appendChild(tab);
        });
        return bar;
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
        titleWrap.innerHTML = '꾸미기 상점<small>경마 · 내 탈것</small>';
        var bal = document.createElement('div');
        bal.className = 'hshop-balance';
        bal.id = 'hshopBalance';
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
        notice.textContent = (activeTab === 'track_theme' || activeTab === 'finish_fx')
            ? '연출 꾸미기는 방장이 장착하면 방 전체에 적용돼요. 게임 결과엔 영향 없어요.'
            : '꾸미기는 게임 결과에 영향을 주지 않아요. 코인으로 구매 후 장착하세요.';

        var tabBar = renderTabBar();

        var grid = document.createElement('div');
        grid.className = 'hshop-grid';
        var list = catalog[activeTab] || [];
        if (list.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'hshop-empty';
            empty.textContent = '준비 중인 카테고리예요.';
            grid.appendChild(empty);
        } else {
            list.forEach(function (item) { grid.appendChild(renderCard(activeTab, item)); });
        }

        panel.appendChild(header);
        panel.appendChild(notice);
        panel.appendChild(tabBar);
        panel.appendChild(grid);
        overlay.appendChild(panel);
        mount.appendChild(overlay);
    }

    // ── 구매 / 장착 ────────────────────────────────────────

    // 구매 버튼 → 확인 팝업 → 확인 시에만 emit
    function requestBuy(item, btn) {
        if (!socketRef || !wallet.authed) return;
        showShopConfirm(item, function () { doBuy(item.id, btn); });
    }

    function doBuy(id, btn) {
        if (!socketRef || !wallet.authed) return;
        if (btn) { btn.disabled = true; btn.textContent = '구매 중…'; }
        socketRef.emit('shop:buy', { cosmeticId: id }, function (res) {
            if (res && res.ok) {
                var prev = wallet.balance;
                wallet.balance = res.balance;
                wallet.owned = Array.isArray(res.owned) ? res.owned : wallet.owned;
                renderModal(); // #hshopBalance 재생성 후 연출
                animateBalanceDelta(prev, res.balance);
                showShopToast('구매했습니다', 'success');
            } else {
                var msg = (res && res.reason === 'insufficient') ? '코인이 부족해요.'
                        : (res && res.reason === 'owned') ? '이미 가지고 있어요.'
                        : '구매에 실패했어요.';
                showShopToast(msg, 'error');
                renderModal();
            }
        });
    }

    function doEquip(slot, id) {
        if (!socketRef || !wallet.authed) return;
        socketRef.emit('shop:equip', { slot: slot, cosmeticId: id }, function (res) {
            if (res && res.ok) {
                wallet.equipped = res.equipped || {};
                renderModal();
                applyToActiveHorses();
            } else {
                showShopToast('장착에 실패했어요.', 'error');
            }
        });
    }

    // ── 모달 열기/닫기 ─────────────────────────────────────

    function openShop() {
        // [임시 진단] 상점 인증 게이트 디버그 — 원인 확인 후 제거
        try {
            var _raw = localStorage.getItem('userAuth');
            var _a = null; try { _a = JSON.parse(_raw); } catch (e) {}
            console.log('[상점진단] userAuth 있음:', !!_raw,
                '| token 있음:', !!(_a && _a.token),
                '| token 앞부분:', (_a && _a.token) ? String(_a.token).slice(0, 20) + '...' : null,
                '| name:', _a && _a.name,
                '| id:', _a && _a.id,
                '| wallet.authed:', wallet.authed);
        } catch (e) { console.log('[상점진단] 예외:', e && e.message); }

        ensureToken(function (token) {
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
        });
    }

    function closeShop() {
        var mount = getMount();
        if (mount) mount.innerHTML = '';
        clearShopLayer();
        document.body.classList.remove('hshop-open');
    }

    // ── 탈것 꾸미기 적용 ───────────────────────────────────

    // 주어진 .horse 에 명시적 equipped 객체를 적용(멱등). catalog 필요.
    function applyEquippedToHorse(horseEl, equipped) {
        if (!horseEl || !catalog) return;
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
        if (!catalog) { loadCatalog().then(function () { applyToHorse(horseEl); }).catch(function () {}); return; }
        applyEquippedToHorse(horseEl, wallet.equipped);
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

    // ── 공개 API ───────────────────────────────────────────

    window.HorseShop = {
        connect: connect,
        authenticate: authenticate,
        loadCatalog: loadCatalog,
        openShop: openShop,
        closeShop: closeShop,
        applyToHorse: applyToHorse,
        applyEquippedToHorse: applyEquippedToHorse,
        applyToActiveHorses: applyToActiveHorses,
        applyRoomCosmetics: applyRoomCosmetics,
        clearRoomCosmetics: clearRoomCosmetics,
        playFinishFx: playFinishFx,
        getEquipped: function () { return wallet.equipped; },
        getCatalogItem: getCatalogItem,
        isAuthed: function () { return wallet.authed; }
    };
})();
