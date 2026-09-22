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
 * 공정성: cosmetic 데이터는 결과/시뮬/emit에 진입하지 않는다. 뽑기 결과는 서버 RNG(shop:gacha)가
 *   결정하고 클라는 받은 결과만 연출한다 — 클라 Math.random()은 리빌 파티클 jitter(외관)에만 사용.
 */
(function () {
    'use strict';

    // 한 페이지 1인스턴스 — 내부 DOM id는 단일 상수로 통일(CSS는 .hshop-* 클래스 기반이라 무해).
    var BALANCE_ID = 'shopBalance';
    var AD_BALANCE_ID = 'shopAdBalance';
    var LAYER_ID = 'shopLayer';

    var RARITY_LABEL = { common: '일반', rare: '레어', epic: '에픽', legend: '전설' };

    // ── 뽑기(가챠) 상수 — 서버(socket/shop.js)의 GACHA_* 와 표시상 일치(비용/확률 안내용) ──
    // 결과 추첨은 서버 권위. 여기 값은 라벨/선검사(잔고)용 — 서버가 최종 판정한다.
    var GACHA_COIN_COST = 100;
    var GACHA_AD_COST = 40;
    var GACHA_RARITY_WEIGHTS = { common: 0, rare: 70, epic: 30 }; // 확률 표시 동적 생성용

    // ── 임시 게이트: 코인샵 탭만 "준비 중 / 추후 오픈 예정" ──
    // 코인샵은 로그인(서버 인증) 필요한데 보안 로그인이 아직 준비 안 됨 → 코인샵 탭만 안내문으로 막는다.
    // 광고샵/인벤토리는 정상. 준비되면 false → 코인샵 그대로 열림(코드 전부 보존).
    // 어댑터가 init({ coinShopOpen: true })로 자기 게임만 먼저 열 수 있다 (데구리 동물 스킨, 사용자 2026-09-22 — 다른 게임은 그대로 잠금).
    var COIN_SHOP_COMING_SOON = true;

    // ── 광고 보상 티어 상수 (튜닝 가능 — v1 단순화: 실제 광고 SDK 없음) ──
    var AD_WALLET_KEY = 'adWallet';   // sessionStorage 키 (일반 userAuth 지갑과 별개, 탭 세션 한정)
    var AD_COIN_GRANT = 48;           // 광고 1회 시청당 지급 광고코인 (뽑기 비용 40 기준 → 광고 1회당 1.2뽑기)
    var AD_COOLDOWN_MS = 10 * 1000;   // 광고 재시청 쿨다운 (가짜 광고 v1: 10초 — 실제 SDK 붙으면 상향)
    var AD_WATCH_MS = 3 * 1000;       // 광고 자리표시(승인 대기) 시청 시간 — 끝까지 봐야 코인 지급
    // 자리표시 러너: 우리 게임의 달리는 것들(공용 아이콘 id, css/ui-icons.css). Date 기반 회전 = 매 클릭 다른 탈것(Math.random 미사용).
    var AD_RUNNERS = ['horse', 'rocket'];

    // 로컬(개발)에서는 광고코인 무제한 — 테스트 편의. 실서버(lamdice.com)는 정상 경제 그대로.
    // 프로젝트 공통 isLocalhost 규약(localhost / 127.0.0.1 / 빈 호스트(file://))과 동일.
    var IS_LOCAL = (function () {
        try {
            var h = window.location.hostname;
            return h === 'localhost' || h === '127.0.0.1' || h === '';
        } catch (e) { return false; }
    })();
    // 광고코인 잔고(선검사용). 로컬이면 무한 → 모든 잔고 검사를 통과(차감은 그대로 일어나도 무시됨).
    function adBalance() { return IS_LOCAL ? Infinity : _adWallet.coins; }

    // ── 상태 ──────────────────────────────────────────────
    var _config = null;
    var _socket = null;
    var _socketWired = false;

    var _catalog = null;          // slot -> items[]
    var _catalogLoading = null;
    var _catalogIndex = {};       // id -> { slot, item }
    var _activeTab = null;        // 현재 서브탭(카테고리 슬롯 key)
    // 메인샵: 'ad'(광고샵) | 'coin'(코인샵). 기본 'coin'(게임 코인 상점).
    // 카탈로그에 adOnly 아이템이 있을 때만 메인탭 노출(없으면 코인샵 단독 — 기존 동작 보존).
    var _activeMainShop = 'coin';
    // 상점/옷장 분리(어댑터 config.closet: true — 데구리, 사용자 2026-09-22). 'shop' = 구매 전용(소유 아이템은 '보유 중' 표시, 장착 버튼 없음),
    // 'closet' = 장착 전용(소유 아이템만, 가격 없음). closet 미설정 게임(경마·사다리·회전)은 항상 'shop' 이고 기존 통합 카드 그대로.
    var _view = 'shop';
    function closetMode() { return !!(_config && _config.closet); }
    // 그룹 필터 칩(분리 모드, 어댑터 hooks.groups() → [{key,label}], hooks.itemGroup(item) → key|null). 데구리: 동물별(전체/고슴도치/돼지…).
    // 그룹이 없는 아이템(기본 모습)은 어느 필터에서도 보인다. 상점/옷장 두 뷰가 같은 필터를 공유하고, 팝업을 열 때 '전체'로 리셋.
    var _groupFilter = 'all';
    function hasGroups() { return closetMode() && !!(_config.hooks && _config.hooks.groups && _config.hooks.itemGroup); }
    function passesGroup(item) {
        if (!hasGroups() || _groupFilter === 'all') return true;
        var g = _config.hooks.itemGroup(item);
        return g == null || g === _groupFilter;
    }
    function renderGroupChips() {
        var chips = document.createElement('div');
        chips.className = 'hshop-inv-chips hshop-groupchips';
        [{ key: 'all', label: '전체' }].concat(_config.hooks.groups() || []).forEach(function (cd) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'hshop-inv-chip hshop-groupchip' + (_groupFilter === cd.key ? ' is-active' : '');
            // 어댑터가 그룹 아이콘(동물 얼굴 캔버스)을 주면 이름 앞에 — 글자만 있는 칩보다 한눈에 고르기 쉽다. 칩은 줄바꿈으로 전부 보인다(가로 스크롤 X)
            var icon = null;
            if (cd.key !== 'all' && _config.hooks.groupIcon) { try { icon = _config.hooks.groupIcon(cd.key); } catch (e) { icon = null; } }
            if (icon) chip.appendChild(icon);
            var lb = document.createElement('span'); lb.textContent = cd.label; chip.appendChild(lb);
            chip.addEventListener('click', function () { if (_groupFilter === cd.key) return; _groupFilter = cd.key; renderModal(); });
            chips.appendChild(chip);
        });
        return chips;
    }
    var _invPreviewVehicle = null; // 인벤토리 미리보기 탈것 id(null=어댑터 폴백: 내 탈것 또는 'car')
    var _invFilter = 'all';        // 인벤토리 카테고리 필터(슬롯 key 또는 'all')

    // 서버 권위 지갑 상태
    var _wallet = { authed: false, balance: 0, owned: [], equipped: {} };

    // 광고 지갑(클라 sessionStorage 권위 — 탭 세션 한정) — 일반 _wallet과 별개 객체(혼동 방지).
    // 위변조 가능하나 cosmetic-only라 수용(무한 광고코인이 최대 악용 — 게임플레이 무관).
    var _adWallet = { coins: 0, owned: [], equipped: {}, lastWatch: 0 };

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

    // ── 뽑기(가챠) 게이트 / 게임 토큰 ──────────────────────
    // 게임 토큰: catalogUrl(/config/<game>/cosmetics.json)에서 <game> 추출. 서버 화이트리스트와
    // 동일 디렉터리명. emit({game}) 한 곳에서만 산출(어댑터 비대칭 회피). 못 뽑으면 null.
    function gameToken() {
        var url = (_config && _config.catalogUrl) || '';
        var m = /\/config\/([^/]+)\/cosmetics\.json/.exec(url);
        return m ? m[1] : null;
    }

    // 크로스게임 방어: 현재 카탈로그에 directBuy:true 아이템이 1개라도 있으면 가챠 게임.
    // directBuy 플래그가 전무한 게임(spin)은 gameHasGacha()=false → 가챠 로직 전부 OFF,
    // 모든 아이템이 기존 직접구매 그대로(회귀 방지). itemState 훅이 아니라 카탈로그 플래그로 판정.
    function gameHasGacha() {
        if (!_catalog) return false;
        var slots = Object.keys(_catalog);
        for (var i = 0; i < slots.length; i++) {
            var list = _catalog[slots[i]] || [];
            for (var j = 0; j < list.length; j++) {
                if (list[j] && list[j].directBuy === true) return true;
            }
        }
        return false;
    }

    // 가챠 전용 아이템 = 가챠 게임 && 직접구매 앵커 아님 && 기본제공 아님.
    // 셸이 카탈로그 플래그로 직접 판정(horse/spin 어댑터 비대칭 회피).
    function isGachaOnly(item) {
        return gameHasGacha() && item && item.directBuy !== true && item.defaultOwned !== true;
    }

    // 주어진 경제(coin/ad)의 가챠 풀 id 목록(전체 — 소유 포함). 풀 크기/비활성 판정·라벨용(클라 표시).
    // 실제 추첨 후보는 서버가 다시 계산(서버 권위) — 여기는 표시 일치를 위한 동일 규칙 미러.
    // ⚠️ 중복환급 전환: 소유 self-exclude 제거(전체 풀 카운트). 풀이 0개(전부 directBuy/
    //   defaultOwned/requires-미충족)일 때만 가챠 버튼 비활성.
    function gachaPoolIds(economy) {
        if (!_catalog || !gameHasGacha()) return [];
        var ids = [];
        var slots = Object.keys(_catalog);
        for (var i = 0; i < slots.length; i++) {
            var list = _catalog[slots[i]] || [];
            for (var j = 0; j < list.length; j++) {
                var item = list[j];
                if (!item || !item.id) continue;
                var isAd = isAdItem(item);
                if (economy === 'coin' && isAd) continue;
                if (economy === 'ad' && !isAd) continue;
                if (item.directBuy === true) continue;
                if (item.defaultOwned === true) continue;
                // (소유 self-exclude 없음 — 전체 풀, 중복은 50% 환급)
                ids.push(item.id);
            }
        }
        return ids;
    }

    // 확률 안내 문구("확률: rare 70% · epic 30%"). GACHA_RARITY_WEIGHTS에서 동적 생성(규제 위생).
    function gachaOddsText() {
        var entries = [];
        var total = 0;
        Object.keys(GACHA_RARITY_WEIGHTS).forEach(function (k) {
            var w = GACHA_RARITY_WEIGHTS[k];
            if (w > 0) { entries.push({ k: k, w: w }); total += w; }
        });
        if (!total) return '';
        var parts = entries.map(function (e) {
            var pct = Math.round((e.w / total) * 100);
            return (RARITY_LABEL[e.k] || e.k) + ' ' + pct + '%';
        });
        return '확률: ' + parts.join(' · ');
    }

    // ── 광고 지갑 (sessionStorage 권위 — 게스트/미인증도 사용, 탭 세션 한정) ──

    function loadAdWallet() {
        // 의미가 "탭 세션 한정"으로 바뀌었으므로 옛 영구(localStorage) 잔재를 1회 청소.
        try { localStorage.removeItem(AD_WALLET_KEY); } catch (e) {}
        try {
            var raw = JSON.parse(sessionStorage.getItem(AD_WALLET_KEY) || 'null');
            if (raw && typeof raw === 'object') {
                _adWallet.coins = (typeof raw.coins === 'number' && raw.coins >= 0) ? raw.coins : 0;
                _adWallet.owned = Array.isArray(raw.owned) ? raw.owned : [];
                _adWallet.equipped = (raw.equipped && typeof raw.equipped === 'object') ? raw.equipped : {};
                _adWallet.lastWatch = (typeof raw.lastWatch === 'number') ? raw.lastWatch : 0;
            }
        } catch (e) { /* 손상 시 기본값 유지 */ }
        return _adWallet;
    }

    function saveAdWallet() {
        try { sessionStorage.setItem(AD_WALLET_KEY, JSON.stringify(_adWallet)); } catch (e) {}
    }

    function adOwns(id) { return _adWallet.owned.indexOf(id) !== -1; }

    // 광고 아이템 여부(서버와 동일 판정 — 클라 카탈로그도 같은 파일이라 일치).
    function isAdItem(item) { return !!(item && item.adOnly === true); }

    // 광고 쿨다운 잔여(ms). 0이면 시청 가능.
    function adCooldownRemaining() {
        var elapsed = Date.now() - (_adWallet.lastWatch || 0);
        return elapsed >= AD_COOLDOWN_MS ? 0 : (AD_COOLDOWN_MS - elapsed);
    }

    function activeSlots() {
        return (_config && Array.isArray(_config.slots)) ? _config.slots : [];
    }

    // ── 메인샵(광고샵/코인샵) 2단 탭 헬퍼 ──────────────────
    // 메인샵 타입에 해당하는 아이템 여부: 광고샵='ad'=adOnly만, 코인샵='coin'=비-adOnly만.
    function itemMatchesMainShop(item, mainShop) {
        return mainShop === 'ad' ? isAdItem(item) : !isAdItem(item);
    }

    // 카탈로그에 adOnly 아이템이 하나라도 있으면 true(메인탭 노출 조건).
    // false면(스핀처럼 ad 아이템 없음) 메인탭 미렌더 + 코인샵 단독 동작(기존 동작 보존).
    function hasAdItems() {
        if (!_catalog) return false;
        var slots = Object.keys(_catalog);
        for (var i = 0; i < slots.length; i++) {
            var list = _catalog[slots[i]] || [];
            for (var j = 0; j < list.length; j++) if (isAdItem(list[j])) return true;
        }
        return false;
    }

    // 현재(또는 지정) 메인샵 타입에서 length>0 인 카테고리 슬롯만 반환(서브탭 후보).
    function slotsForMainShop(mainShop) {
        return activeSlots().filter(function (slot) {
            var list = (_catalog && _catalog[slot.key]) || [];
            for (var k = 0; k < list.length; k++) if (itemMatchesMainShop(list[k], mainShop)) return true;
            return false;
        });
    }

    // 인벤토리 미리보기 탈것 로스터(어댑터 hook). 없으면 'car' 단일 폴백(spin/미구현 안전).
    function inventoryVehicleRoster() {
        if (_config && _config.hooks && _config.hooks.inventoryVehicles) {
            try {
                var list = _config.hooks.inventoryVehicles();
                if (Array.isArray(list) && list.length) return list;
            } catch (e) {}
        }
        return [{ id: 'car', name: '자동차' }];
    }

    // 활성 서브탭이 현재 메인샵에 없으면 첫 번째 가능한 카테고리로 리셋(없으면 null).
    // 인벤토리는 서브탭이 없는 그룹 스크롤이라 _activeTab을 건드리지 않는다(코인/광고 복귀 시 위치 보존).
    function ensureActiveTabForMainShop() {
        if (_activeMainShop === 'inventory') return;
        var slots = slotsForMainShop(_activeMainShop);
        var stillValid = slots.some(function (s) { return s.key === _activeTab; });
        if (!stillValid) _activeTab = slots.length ? slots[0].key : null;
    }

    // 단일 탭바 미렌더 여부 — 현재 메인샵의 서브탭이 1개 이하면 탭바 숨김.
    // 인벤토리는 서브탭 자체가 없으므로 항상 숨김(true).
    function isSingleSlot() {
        if (_activeMainShop === 'inventory') return true;
        if (hasAdItems()) return slotsForMainShop(_activeMainShop).length <= 1;
        return activeSlots().length <= 1;
    }

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
    // 토큰이 없거나(구세대 userAuth) 서버가 auth 로 거부하면(만료) AuthToken.renew 로 새 토큰을
    // 받아 1회 재시도 — 유저가 재로그인 없이 상점을 바로 쓰게(사용자 결정 2026-09-22).
    function authenticate(token, done, isRetry) {
        if (!_socket) { if (done) done(false); return; }
        if (!token) {
            if (!isRetry) return renewAndRetry(done);
            if (done) done(false);
            return;
        }
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
            } else if (res && res.reason === 'auth' && !isRetry) {
                renewAndRetry(done);
            } else {
                _wallet.authed = false;
                if (done) done(false);
            }
        });
    }

    // 토큰 재발급(js/shared/auth-token-shared.js) 후 재인증. 모듈 미로드/실패면 미인증 확정.
    function renewAndRetry(done) {
        if (!window.AuthToken) { _wallet.authed = false; if (done) done(false); return; }
        window.AuthToken.renew(function (newToken) {
            if (newToken) authenticate(newToken, done, true);
            else { _wallet.authed = false; if (done) done(false); }
        });
    }

    // 지갑 상세(잔고+소유+장착) 동기화
    function refreshWallet(done) {
        // 방 지갑 모드(config.roomWallet + hooks.walletRequest — 데구리): 계정 지갑 대신 어댑터가 방 지갑을 가져온다. 로그인 불필요(손님 포함)
        if (_config && _config.roomWallet && _config.hooks && _config.hooks.walletRequest) {
            _config.hooks.walletRequest(function (res) {
                if (res && res.ok) {
                    _wallet.authed = true;
                    _wallet.balance = res.balance || 0;
                    _wallet.owned = Array.isArray(res.owned) ? res.owned : [];
                    _wallet.equipped = res.equipped || {};
                    if (_config.hooks.onWalletRefreshed) _config.hooks.onWalletRefreshed(_wallet);
                }
                if (done) done(!!(res && res.ok));
            });
            return;
        }
        if (!_socket || !_wallet.authed) { if (done) done(); return; }
        _socket.emit('wallet:get', {}, function (res) {
            if (res && res.ok) {
                _wallet.balance = res.balance || 0;
                _wallet.owned = Array.isArray(res.owned) ? res.owned : [];
                _wallet.equipped = res.equipped || {};
                // 어댑터가 서버 prefs 장착값을 덧쓸 기회(데구리: 방 단위 장착값으로 덮음 — 모달을 다시 열 때마다 여기로 온다)
                if (_config && _config.hooks && _config.hooks.onWalletRefreshed) _config.hooks.onWalletRefreshed(_wallet);
            }
            if (done) done();
        });
    }

    // ── 잔고 표시 / 증감 애니메이션 ──────────────────────────

    // 잔고/가격 배지를 [아이콘 노드][' ' + 값 텍스트 노드] 로 채운다. 값은 텍스트 노드라 HTML 로 해석되지 않는다.
    // 카운트 애니메이션(countBalanceTo)은 뒤의 텍스트 노드(el.lastChild)만 갱신한다.
    function setIconValue(el, iconId, value) {
        el.replaceChildren(UIIcons.el(iconId), ' ' + value);
    }

    function updateBalanceLabel() {
        var el = document.getElementById(BALANCE_ID);
        if (el) setIconValue(el, 'coin', _wallet.balance);
    }

    function updateAdBalanceLabel() {
        var el = document.getElementById(AD_BALANCE_ID);
        if (el) setIconValue(el, 'clapper', IS_LOCAL ? '∞' : _adWallet.coins);
    }

    function animateEnabled() {
        return !(_config && _config.animateBalance === false);
    }

    // 잔고 숫자를 from→to 로 부드럽게 카운트(easeOutCubic). 최종값은 to 로 수렴(서버 권위).
    function countBalanceTo(el, from, to) {
        var DURATION = 480;
        var startTs = null;
        setIconValue(el, 'coin', from);
        var num = el.lastChild; // 숫자 텍스트 노드 — 프레임마다 이것만 갱신(아이콘 노드는 유지)
        function step(ts) {
            if (startTs === null) startTs = ts;
            var p = Math.min(1, (ts - startTs) / DURATION);
            var eased = 1 - Math.pow(1 - p, 3);
            num.data = ' ' + Math.round(from + (to - from) * eased);
            if (p < 1) requestAnimationFrame(step);
            else num.data = ' ' + to;
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
        if (!animateEnabled()) { setIconValue(el, 'coin', next); return; }
        if (prev === next) { setIconValue(el, 'coin', next); return; }
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
        setIconValue(pr, 'coin', item.price);
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
                lockLabel: st.lockLabel || null,
                onLockedClick: (typeof st.onLockedClick === 'function') ? st.onLockedClick : null
            };
        }
        return { owned: owns(item.id), buyable: true, lockLabel: null, onLockedClick: null };
    }

    function renderCard(slot, item) {
        var card = document.createElement('div');
        card.className = 'hshop-card';

        var rarity = item.rarity || 'common';

        var thumb = document.createElement('div');
        thumb.className = 'hshop-thumb hshop-thumb--' + rarity;
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
            if (item.emoji) glyph.textContent = item.emoji; // 상품 자체 아이콘 데이터 — 그대로
            else glyph.appendChild(UIIcons.el('gift'));
            thumb.appendChild(glyph);
        }

        // 광고 전용 아이템 배지(썸네일 우상단)
        if (isAdItem(item)) {
            var adBadge = document.createElement('span');
            adBadge.className = 'hshop-ad-badge';
            adBadge.replaceChildren(UIIcons.el('clapper'), ' 광고');
            thumb.appendChild(adBadge);
        }

        var nm = document.createElement('div');
        nm.className = 'hshop-name';
        nm.textContent = item.name;

        card.appendChild(thumb);
        card.appendChild(nm);
        // 분리 모드: 가격을 이름 줄 오른쪽에(카드 세로 길이 절약, 사용자 2026-09-22) — 아래 가격 노드는 만들지 않는다
        var priceInline = false;
        if (closetMode() && !isAdItem(item)) {
            var st0 = itemStateFor(item);
            if (_view === 'shop' && !st0.owned && Number.isFinite(item.price)) {
                var namerow = document.createElement('div');
                namerow.className = 'hshop-namerow';
                var pr = document.createElement('span');
                pr.className = 'hshop-price hshop-price--inline';
                setIconValue(pr, 'coin', item.price);
                card.replaceChild(namerow, nm); namerow.appendChild(nm); namerow.appendChild(pr);
                priceInline = true;
            }
        }

        // 광고 아이템은 ad-wallet(클라) 기준 — 별도 경로(서버 shop:buy/equip 미진입)
        if (isAdItem(item)) {
            renderAdCardBody(card, slot, item);
            return card;
        }

        var state = itemStateFor(item);
        var isEquipped = _wallet.equipped[slot] === item.id;

        // 가챠 전용(코인) + 미소유: 가격/구매 버튼 대신 "뽑기로 획득" 잠금 노드. 클릭 불가(가챠 버튼으로 유도).
        // directBuy 앵커·소유 아이템·비-가챠 게임(spin)은 이 분기 미진입 → 기존 직접구매/장착 그대로.
        if (isGachaOnly(item) && !state.owned) {
            var lock = document.createElement('div');
            lock.className = 'hshop-gacha-lock';
            lock.replaceChildren(UIIcons.el('dice'), ' 뽑기로 획득');
            card.appendChild(lock);
            return card;
        }

        // 상점/옷장 분리 모드 + 상점 뷰 + 소유: 장착 버튼 대신 '보유 중'(비활성) — 장착은 옷장에서
        if (closetMode() && _view === 'shop' && state.owned) {
            var ownedTag = document.createElement('button');
            ownedTag.type = 'button'; ownedTag.className = 'hshop-equip hshop-owned'; ownedTag.disabled = true;
            ownedTag.textContent = item.defaultOwned ? '기본 제공' : '보유 중';
            card.appendChild(ownedTag);
            return card;
        }
        // 가격 노드는 미소유 + price가 유한할 때만 (D6: spin defaultOwned 무가격 대응)
        var price = null;
        if (!priceInline && !state.owned && Number.isFinite(item.price)) {
            price = document.createElement('div');
            price.className = 'hshop-price';
            setIconValue(price, 'coin', item.price);
        }

        var btn = document.createElement('button');
        btn.type = 'button';

        if (!state.owned) {
            btn.className = 'hshop-buy';
            if (!state.buyable) {
                btn.className = 'hshop-buy hshop-locked';
                btn.textContent = state.lockLabel || '구매 불가';
                // 잠금(미인증)은 클릭 가능 — 로그인 유도(어댑터가 onLockedClick 제공 시)
                if (typeof state.onLockedClick === 'function') {
                    btn.addEventListener('click', state.onLockedClick);
                } else {
                    btn.disabled = true;
                }
            } else {
                btn.textContent = (Number.isFinite(item.price) && !priceInline) ? '구매 (' + item.price + ')' : '구매';   // 가격이 이름 줄에 있으면 버튼은 '구매'만
                btn.addEventListener('click', function () { requestBuy(item, btn); });
            }
        } else {
            btn.className = 'hshop-equip' + (isEquipped ? ' is-equipped' : '');
            btn.textContent = isEquipped ? '✓ 장착중' : '장착';
            btn.addEventListener('click', function () { doEquip(slot, isEquipped ? null : item.id); });
        }

        if (price) card.appendChild(price);
        card.appendChild(btn);
        return card;
    }

    // 광고 아이템 카드 본문(가격/구매/장착) — ad-wallet 기준, 서버 미진입.
    function renderAdCardBody(card, slot, item) {
        var owned = adOwns(item.id);
        var isEquipped = _adWallet.equipped[slot] === item.id;
        var adPrice = Number.isFinite(item.adPrice) ? item.adPrice : 0;

        // 가챠 전용(광고) + 미소유: 광고코인 구매 버튼 대신 "뽑기로 획득" 잠금 노드.
        // directBuy 광고 앵커는 이 분기 미진입 → 기존 광고코인 직접구매 그대로.
        if (isGachaOnly(item) && !owned) {
            var lock = document.createElement('div');
            lock.className = 'hshop-gacha-lock hshop-gacha-lock--ad';
            lock.replaceChildren(UIIcons.el('clapper'), ' 뽑기로 획득');
            card.appendChild(lock);
            return;
        }

        var btn = document.createElement('button');
        btn.type = 'button';

        if (!owned) {
            var price = document.createElement('div');
            price.className = 'hshop-price hshop-price--ad';
            setIconValue(price, 'clapper', adPrice);
            card.appendChild(price);

            btn.className = 'hshop-buy hshop-buy--ad';
            btn.textContent = '광고코인 구매 (' + adPrice + ')';
            btn.addEventListener('click', function () { adBuy(item, btn); });
        } else {
            btn.className = 'hshop-equip' + (isEquipped ? ' is-equipped' : '');
            btn.textContent = isEquipped ? '✓ 장착중' : '장착';
            btn.addEventListener('click', function () { adEquip(slot, isEquipped ? null : item.id); });
        }
        card.appendChild(btn);
    }

    // ── 뽑기(가챠) 버튼 영역 ────────────────────────────────
    // panel 직속(grid 직전). 메인샵별 1개 버튼 + 확률 안내. gameHasGacha() 가드 — spin은 미렌더.
    //   coin: 코인샵('coin')에서만 + COIN_SHOP_COMING_SOON/coinShopLocked 잠금이 풀렸을 때만.
    //         (잠금 시 비노출 — 잠금 region과 동일 조건으로 게이트해 코인샵이 잠겨 있으면 버튼·카드 모두 숨김.)
    //   ad:   광고샵('ad')에서. live. 잔고 부족/풀 0이면 비활성.
    function buildGachaArea(economy, coinLocked) {
        if (!gameHasGacha()) return null;
        if (economy === 'coin' && coinLocked) return null; // 코인샵 잠금 뒤에 대기(우회 금지)

        var poolSize = gachaPoolIds(economy).length; // 전체 풀(소유 포함)
        var isAd = (economy === 'ad');
        var cost = isAd ? GACHA_AD_COST : GACHA_COIN_COST;

        var wrap = document.createElement('div');
        wrap.className = 'hshop-gacha-area' + (isAd ? ' hshop-gacha-area--ad' : ' hshop-gacha-area--coin');

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hshop-gacha-btn' + (isAd ? ' hshop-gacha-btn--ad' : ' hshop-gacha-btn--coin');

        // 전체 풀 추첨 + 중복환급 → "다 모았어요" 폐기. 풀 0개(전부 directBuy/defaultOwned)일 때만 비활성.
        var disabled = false;
        if (poolSize === 0) {
            btn.replaceChildren(UIIcons.el('gift'), ' 준비 중');
            disabled = true;
        } else if (isAd) {
            btn.replaceChildren(UIIcons.el('clapper'), ' 광고 뽑기 · ' + cost + '광고코인 · ' + poolSize + '종');
            if (adBalance() < cost) disabled = true; // 잔고 부족 비활성(선검사·로컬 무제한)
        } else {
            btn.replaceChildren(UIIcons.el('dice'), ' 코인 뽑기 · ' + cost + '코인 · ' + poolSize + '종');
            if (_wallet.balance < cost) disabled = true;
        }
        btn.disabled = disabled;
        if (!disabled) {
            btn.addEventListener('click', function () { isAd ? doAdGacha(btn) : doCoinGacha(btn); });
        }
        wrap.appendChild(btn);

        // 확률 안내(규제 위생) — 동적 생성.
        var odds = gachaOddsText();
        if (odds) {
            var oddsEl = document.createElement('div');
            oddsEl.className = 'hshop-gacha-odds';
            oddsEl.textContent = odds;
            wrap.appendChild(oddsEl);
        }
        return wrap;
    }

    // 서브탭(카테고리) 바. 메인탭 활성 시 현재 메인샵에 아이템이 있는 슬롯만 노출.
    function renderTabBar() {
        var bar = document.createElement('div');
        bar.className = 'hshop-tabs';
        var slots = hasAdItems() ? slotsForMainShop(_activeMainShop) : activeSlots();
        slots.forEach(function (slot) {
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'hshop-tab' + (_activeTab === slot.key ? ' is-active' : '');
            UIIcons.setIconText(tab, slot.label || slot.key);   // 게임 어댑터 슬롯 라벨('🎨 도색' 등)의 이모지 → 스프라이트
            tab.addEventListener('click', function () { _activeTab = slot.key; renderModal(); });
            bar.appendChild(tab);
        });
        return bar;
    }

    // 메인탭(🎬 광고샵 / 🪙 코인샵) 바. hasAdItems()일 때만 렌더.
    function renderMainTabBar() {
        var bar = document.createElement('div');
        bar.className = 'hshop-maintabs';
        var tabs = [
            { type: 'ad',        icon: 'clapper', text: '광고샵' },
            { type: 'coin',      icon: 'coin',    text: '코인샵' },
            { type: 'inventory', icon: 'box',     text: '내 아이템' }
        ];
        tabs.forEach(function (t) {
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'hshop-maintab' + (_activeMainShop === t.type ? ' is-active' : '');
            tab.replaceChildren(UIIcons.el(t.icon), ' ' + t.text);
            tab.addEventListener('click', function () {
                if (_activeMainShop === t.type) return;
                _activeMainShop = t.type;
                ensureActiveTabForMainShop(); // 서브탭 첫 항목으로 리셋
                renderModal();
            });
            bar.appendChild(tab);
        });
        return bar;
    }

    function noticeFor(slot) {
        // 메인탭(광고샵/코인샵) 활성 시: 메인샵별 안내 문구.
        if (hasAdItems()) {
            return _activeMainShop === 'ad'
                ? '광고 보고 모은 광고코인으로 한정 아이템을 사세요.'
                : '게임하며 모은 코인으로 구매 후 장착하세요.';
        }
        // 메인탭 없을 때: 기존 동작(어댑터 noticeText hook).
        if (_config && _config.hooks && _config.hooks.noticeText) {
            return _config.hooks.noticeText(slot, _view);   // 2번째 인자 = 뷰('shop'|'closet') — 기존 어댑터는 무시
        }
        return _config.noticeText || '꾸미기는 게임 결과에 영향을 주지 않아요. 코인으로 구매 후 장착하세요.';
    }

    // ── 인벤토리('내 아이템') 전용 렌더 ──────────────────────
    // 소유 판정: 코인 소유 || 광고 소유 || defaultOwned(서버가 소유로 취급 — 미래 안전).
    function ownsForInventory(item) {
        return owns(item.id) || adOwns(item.id) || item.defaultOwned === true;
    }

    // 인벤토리 본문(큰 미리보기 + 슬롯별 소유 섹션). 기존 grid 가정(_catalog[_activeTab] 단일 슬롯)에
    // 의존하지 않고 소유 기반으로 직접 필터·렌더. 빈 상태도 여기서 처리.
    function buildInventoryBody() {
        var body = document.createElement('div');
        body.className = 'hshop-inv-body';

        // 탈것 로스터 + 현재 선택 인덱스(초기: 어댑터 폴백(내 탈것 — _invPreviewVehicle=null)).
        var roster = inventoryVehicleRoster();
        var curIdx = 0;
        if (_invPreviewVehicle != null) {
            for (var ri = 0; ri < roster.length; ri++) { if (roster[ri].id === _invPreviewVehicle) { curIdx = ri; break; } }
        }
        var curVehicle = roster[curIdx] || roster[0];

        // 상단: 어댑터의 큰 합성 미리보기. 선택 탈것 id를 넘긴다(null이면 어댑터가 내 탈것 폴백).
        if (_config && _config.hooks && _config.hooks.buildInventoryPreview) {
            var pwrap = document.createElement('div');
            pwrap.className = 'hshop-inv-preview-wrap';
            appendInventoryPreviewNode(pwrap);

            // ◀ [탈것이름] ▶ 스위처 — 로스터 2개+ 일 때만(단일이면 바꿀 게 없음).
            if (roster.length > 1) {
                var sw = document.createElement('div');
                sw.className = 'hshop-inv-vsw';

                var prev = document.createElement('button');
                prev.type = 'button';
                prev.className = 'hshop-inv-vsw-btn hshop-inv-vsw-prev';
                prev.setAttribute('aria-label', '이전 탈것');
                prev.textContent = '◀';

                var nameEl = document.createElement('span');
                nameEl.className = 'hshop-inv-vsw-name';
                nameEl.textContent = (curVehicle && curVehicle.name) || '탈것';

                var next = document.createElement('button');
                next.type = 'button';
                next.className = 'hshop-inv-vsw-btn hshop-inv-vsw-next';
                next.setAttribute('aria-label', '다음 탈것');
                next.textContent = '▶';

                // ◀▶ → 인덱스 ±1(로스터 길이 wrap) → 미리보기 노드만 교체(전체 모달 재렌더 지양).
                //   장착/소유/DB 무변경 — equip emit 없음(미리보기 스프라이트만).
                function cycle(delta) {
                    var n = roster.length;
                    var ni = ((curIdx + delta) % n + n) % n;
                    _invPreviewVehicle = roster[ni].id;
                    curIdx = ni;
                    curVehicle = roster[ni];
                    nameEl.textContent = (curVehicle && curVehicle.name) || '탈것';
                    // 미리보기 노드만 재빌드(장착 cosmetic은 mergedEquipped 그대로 — 탈것만 교체)
                    appendInventoryPreviewNode(pwrap);
                }
                prev.addEventListener('click', function () { cycle(-1); });
                next.addEventListener('click', function () { cycle(1); });

                sw.appendChild(prev);
                sw.appendChild(nameEl);
                sw.appendChild(next);
                pwrap.appendChild(sw);
            }
            body.appendChild(pwrap);
        }

        // 카테고리 필터 칩(전체 + 각 슬롯). 클릭 → _invFilter 갱신 → 인벤토리 본문 re-render.
        var chips = document.createElement('div');
        chips.className = 'hshop-inv-chips';
        var chipDefs = [{ key: 'all', label: '전체' }].concat(activeSlots().map(function (s) {
            return { key: s.key, label: s.label || s.key };
        }));
        chipDefs.forEach(function (cd) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'hshop-inv-chip' + (_invFilter === cd.key ? ' is-active' : '');
            UIIcons.setIconText(chip, cd.label);
            chip.addEventListener('click', function () {
                if (_invFilter === cd.key) return;
                _invFilter = cd.key;
                renderModal(); // 인벤토리 본문 re-render(필터 반영)
            });
            chips.appendChild(chip);
        });
        body.appendChild(chips);

        // 본문: 슬롯 순서대로 소유 아이템을 섹션으로. 필터 활성 시 해당 슬롯만.
        var merged = (_config && _config.hooks && _config.hooks.mergedEquipped)
            ? _config.hooks.mergedEquipped() : null;
        var anyOwned = false;

        activeSlots().forEach(function (slot) {
            if (_invFilter !== 'all' && slot.key !== _invFilter) return; // 필터 skip
            var list = (_catalog[slot.key] || []).filter(ownsForInventory);
            if (list.length === 0) return;
            anyOwned = true;

            var section = document.createElement('div');
            section.className = 'hshop-inv-section';
            var head = document.createElement('div');
            head.className = 'hshop-inv-section-head';
            UIIcons.setIconText(head, slot.label || slot.key);
            section.appendChild(head);

            var grid = document.createElement('div');
            grid.className = 'hshop-grid hshop-inv-grid';
            list.forEach(function (item) {
                var card = renderCard(slot.key, item);
                // 장착표시는 mergedEquipped 기준으로 일관화(코인+광고가 같은 슬롯에 둘 다 장착돼도
                // 실제 탈것엔 광고 우선 1개만 보이므로, ✓도 그 1개에만). renderCard 본문 동작은 미변경 —
                // 인벤토리에서만 사후 보정.
                if (merged) syncEquipBadge(card, slot.key, item.id, merged);
                grid.appendChild(card);
            });
            section.appendChild(grid);
            body.appendChild(section);
        });

        if (!anyOwned) {
            var empty = document.createElement('div');
            empty.className = 'hshop-empty';
            // 필터로 인해 빈 경우와 정말 0개인 경우를 구분(필터는 "이 카테고리" 안내).
            empty.textContent = (_invFilter === 'all')
                ? '아직 보유한 꾸미기가 없어요.'
                : '이 카테고리에 보유한 꾸미기가 없어요.';
            body.appendChild(empty);
        }

        return body;
    }

    // 미리보기 노드(어댑터 buildInventoryPreview)를 wrap의 첫 자식으로 (재)삽입.
    // 기존 미리보기 노드(.hshop-inv-preview)만 교체하고 스위처(.hshop-inv-vsw)는 보존.
    // 장착 cosmetic은 어댑터가 mergedEquipped로 매번 합성 — 탈것 스프라이트만 바뀐다.
    function appendInventoryPreviewNode(pwrap) {
        var oldPreview = pwrap.querySelector('.hshop-inv-preview');
        if (oldPreview) oldPreview.remove();
        var preview = null;
        try { preview = _config.hooks.buildInventoryPreview(_invPreviewVehicle); } catch (e) { preview = null; }
        if (!preview) return;
        // 스위처가 이미 있으면 그 앞에, 없으면 맨 끝(첫 진입)에 둔다 → 미리보기가 항상 스위처 위.
        var sw = pwrap.querySelector('.hshop-inv-vsw');
        if (sw) pwrap.insertBefore(preview, sw);
        else pwrap.appendChild(preview);
    }

    // 카드의 장착 배지를 mergedEquipped 승자 기준으로 보정. 이 아이템이 슬롯 승자가 아니면
    // '장착중' 표시를 '장착'으로 되돌린다(클릭 핸들러는 renderCard가 단 그대로 유지).
    function syncEquipBadge(card, slot, id, merged) {
        var btn = card.querySelector('.hshop-equip');
        if (!btn) return;
        var isEquipped = merged[slot] === id;
        if (isEquipped) {
            if (!btn.classList.contains('is-equipped')) {
                btn.classList.add('is-equipped');
                btn.textContent = '✓ 장착중';
            }
        } else {
            if (btn.classList.contains('is-equipped')) {
                btn.classList.remove('is-equipped');
                btn.textContent = '장착';
            }
        }
    }

    // 분리 모드 탭바 [상점 | 옷장] — 같은 팝업에서 뷰만 바꾼다(사용자 2026-09-22: 팝업 하나에 탭)
    function renderViewTabs() {
        var bar = document.createElement('div');
        bar.className = 'hshop-tabs hshop-viewtabs';
        [['shop', '🛍 ' + (_config.shopTabLabel || '상점')], ['closet', '👗 ' + (_config.closetTabLabel || _config.closetTitle || '옷장')]].forEach(function (t) {
            var tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'hshop-tab' + (_view === t[0] ? ' is-active' : '');
            tab.textContent = t[1];
            tab.addEventListener('click', function () { if (_view === t[0]) return; _view = t[0]; renderModal(); });
            bar.appendChild(tab);
        });
        return bar;
    }
    // 옷장 본문 — 슬롯 순서대로 소유(defaultOwned 포함) 아이템 카드. 하나도 없으면 빈 상태 + [상점 가기]
    function buildClosetBody() {
        var body = document.createElement('div');
        body.className = 'hshop-inv-body';
        var slots = activeSlots(); var anyOwned = false; var anyBought = false;   // anyBought = defaultOwned 아닌 소유(산 것)
        slots.forEach(function (slot) {
            var ownedAll = (_catalog[slot.key] || []).filter(ownsForInventory);
            if (ownedAll.some(function (it) { return !it.defaultOwned; })) anyBought = true;
            var list = ownedAll.filter(passesGroup);
            if (list.length === 0) return;
            anyOwned = true;
            var section = document.createElement('div');
            section.className = 'hshop-inv-section';
            if (slots.length > 1) {   // 슬롯 하나면 제목 생략
                var head = document.createElement('div');
                head.className = 'hshop-inv-section-head';
                UIIcons.setIconText(head, slot.label || slot.key);
                section.appendChild(head);
            }
            var grid = document.createElement('div');
            grid.className = 'hshop-grid hshop-inv-grid';
            list.forEach(function (item) { grid.appendChild(renderCard(slot.key, item)); });
            section.appendChild(grid);
            body.appendChild(section);
        });
        if (!anyBought) {   // 기본 제공만 있으면(=산 게 없으면) 카드 아래에 안내 + [상점 가기]
            var empty = document.createElement('div');
            empty.className = 'hshop-empty';
            empty.textContent = anyOwned ? '아직 산 꾸미기가 없어요. 상점에서 골라 보세요.' : '아직 산 꾸미기가 없어요.';
            var go = document.createElement('button');
            go.type = 'button'; go.className = 'hshop-equip hshop-goto-shop'; go.textContent = '상점 가기';
            go.addEventListener('click', function () { _view = 'shop'; renderModal(); });
            empty.appendChild(document.createElement('br')); empty.appendChild(go);
            body.appendChild(empty);
        }
        return body;
    }

    function renderModal() {
        var mount = getMount();
        if (!mount || !_catalog) return;
        mount.innerHTML = '';

        var showMainTabs = hasAdItems();
        // 메인탭 활성 시 활성 서브탭이 현재 메인샵에 유효한지 보장(첫 렌더/전환 안전망).
        if (showMainTabs) ensureActiveTabForMainShop();

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
        var inCloset = closetMode() && _view === 'closet';
        titleWrap.textContent = inCloset ? (_config.closetTitle || '옷장') : (_config.title || '꾸미기 상점');
        var subtitle = inCloset ? (_config.closetSubtitle || _config.subtitle) : _config.subtitle;
        if (subtitle) {
            var small = document.createElement('small');
            small.textContent = subtitle;
            titleWrap.appendChild(small);
        }
        header.appendChild(titleWrap);
        // 일반 코인 잔고는 인증 시에만(게스트는 일반 경제 미접근)
        if (_wallet.authed) {
            var bal = document.createElement('div');
            bal.className = 'hshop-balance';
            bal.id = BALANCE_ID;
            setIconValue(bal, 'coin', _wallet.balance);
            header.appendChild(bal);
        }
        // 광고코인 잔고는 광고 아이템이 있는 게임(=광고샵 존재)에서만 표시. 스핀 등엔 미노출.
        if (hasAdItems()) {
            var adBal = document.createElement('div');
            adBal.className = 'hshop-balance hshop-balance--ad';
            adBal.id = AD_BALANCE_ID;
            setIconValue(adBal, 'clapper', IS_LOCAL ? '∞' : _adWallet.coins);
            header.appendChild(adBal);
        }
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'hshop-close';
        closeBtn.setAttribute('aria-label', '닫기');
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', closeShop);
        header.appendChild(closeBtn);

        // 인벤토리('내 아이템') 전용 경로 — 서브탭 바/코인 notice/광고행/일반 grid 미사용.
        // 헤더 + 메인탭바는 유지하고, 그 아래에 큰 미리보기 + 슬롯별 소유 섹션을 그린다.
        // (메인탭 게이트 안에서만 도달 — showMainTabs=hasAdItems()=true일 때만 inventory 진입 가능.)
        if (showMainTabs && _activeMainShop === 'inventory') {
            panel.appendChild(header);
            panel.appendChild(renderMainTabBar());
            panel.appendChild(buildInventoryBody());
            overlay.appendChild(panel);
            mount.appendChild(overlay);
            return;
        }
        // 옷장 뷰(분리 모드) — 소유 아이템만 슬롯별로, 장착 버튼. 메인탭·가챠·광고행 없음.
        if (inCloset) {
            var cnoticeText = noticeFor(_activeTab);   // 어댑터가 '' 를 주면 안내 상자 자체를 안 그린다(데구리)
            panel.appendChild(header);
            panel.appendChild(renderViewTabs());
            if (hasGroups()) panel.appendChild(renderGroupChips());
            if (cnoticeText) { var cnotice = document.createElement('div'); cnotice.className = 'hshop-notice'; cnotice.textContent = cnoticeText; panel.appendChild(cnotice); }
            panel.appendChild(buildClosetBody());
            overlay.appendChild(panel);
            mount.appendChild(overlay);
            return;
        }

        // 광고 보기 행 (광고코인 적립) — 광고샵(메인탭 'ad')일 때만. 광고 아이템 없는 게임(스핀)엔 미노출.
        var showAdRow = showMainTabs && _activeMainShop === 'ad';
        var adRow = null;
        if (showAdRow) {
            adRow = document.createElement('div');
            adRow.className = 'hshop-ad-row';
            var adInfo = document.createElement('span');
            adInfo.className = 'hshop-ad-info';
            adInfo.textContent = '광고를 보고 광고코인을 모아 한정 꾸미기를 받으세요.';
            var adBtn = document.createElement('button');
            adBtn.type = 'button';
            adBtn.className = 'hshop-watch-ad';
            adBtn.replaceChildren(UIIcons.el('clapper'), ' 광고 보고 코인 받기');
            adBtn.addEventListener('click', function () { watchAd(); });
            adRow.appendChild(adInfo);
            adRow.appendChild(adBtn);
        }

        var notice = document.createElement('div');
        notice.className = 'hshop-notice';
        notice.textContent = noticeFor(_activeTab);

        var grid = document.createElement('div');
        grid.className = 'hshop-grid';
        // 코인샵 게이팅: 코인샵('coin')에서만, 카드 대신 안내문 노드 1개만 그린다(서브탭도 숨김). 광고샵엔 무영향.
        //  ① COIN_SHOP_COMING_SOON(임시 "준비 중") 우선 → 로그인 준비 전까지 코인샵 전체 잠금.
        //  ② 아니면 어댑터 coinShopLocked hook(예: free 서버는 코인 경제 미가동).
        var coinLockMsg = null;
        if (_activeMainShop === 'coin') {
            if (COIN_SHOP_COMING_SOON && !(_config && _config.coinShopOpen)) {
                coinLockMsg = '🛠️ 코인샵은 준비 중이에요. 추후 오픈 예정이니 조금만 기다려 주세요!';
            } else if (_config.hooks && _config.hooks.coinShopLocked) {
                coinLockMsg = _config.hooks.coinShopLocked();
            }
        }
        if (coinLockMsg) {
            var note = document.createElement('div');
            note.className = 'hshop-empty';       // 전체폭 중앙 빈상태 스타일 재사용
            UIIcons.setIconText(note, coinLockMsg); // 텍스트 노드 + 아이콘 노드(innerHTML 미사용) — XSS 안전. hook 문자열(평문)도 그대로
            grid.appendChild(note);
        } else {
            // 그리드 아이템: 메인탭 활성 시 현재 메인샵 타입으로 필터(광고샵=adOnly만/코인샵=비-adOnly만).
            var list = (_catalog[_activeTab] || []);
            if (showMainTabs) {
                list = list.filter(function (item) { return itemMatchesMainShop(item, _activeMainShop); });
            }
            list = list.filter(passesGroup);
            if (list.length === 0) {
                var empty = document.createElement('div');
                empty.className = 'hshop-empty';
                empty.textContent = (hasGroups() && _groupFilter !== 'all') ? '이 동물의 스킨은 아직 없어요.' : '준비 중인 카테고리예요.';
                grid.appendChild(empty);
            } else {
                list.forEach(function (item) { grid.appendChild(renderCard(_activeTab, item)); });
            }
        }

        // 가챠 버튼 영역(grid 직전): 현재 메인샵(coin/ad) 기준 1개. spin(가챠 없음)·잠긴 코인샵엔 미렌더.
        // coinLockMsg가 truthy면 코인샵이 잠긴 상태 → coinLocked=true로 코인 가챠도 숨김(우회 금지).
        var gachaArea = buildGachaArea(_activeMainShop, !!coinLockMsg);

        panel.appendChild(header);
        if (closetMode()) panel.appendChild(renderViewTabs());
        if (hasGroups()) panel.appendChild(renderGroupChips());
        if (showMainTabs) panel.appendChild(renderMainTabBar());
        if (adRow) panel.appendChild(adRow);
        if (notice.textContent) panel.appendChild(notice);   // 어댑터 noticeText 가 '' 면 안내 상자 생략
        if (!isSingleSlot() && !coinLockMsg) panel.appendChild(renderTabBar());
        if (gachaArea) panel.appendChild(gachaArea);
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
        // 방 지갑 모드면 어댑터의 구매 경로(데구리 marble:shop:buy) — 응답 형식은 shop:buy 와 같다 { ok, balance, owned, reason }
        var send = (_config && _config.roomWallet && _config.hooks && _config.hooks.buyRequest)
            ? function (cb) { _config.hooks.buyRequest(id, cb); }
            : function (cb) { _socket.emit('shop:buy', { cosmeticId: id }, cb); };
        send(function (res) {
            if (res && res.ok) {
                var prev = _wallet.balance;
                _wallet.balance = res.balance;
                _wallet.owned = Array.isArray(res.owned) ? res.owned : _wallet.owned;
                renderModal(); // 잔고 배지 재생성 후 연출
                animateBalanceDelta(prev, res.balance);
                if (_config && _config.hooks && _config.hooks.onPurchased) {
                    _config.hooks.onPurchased(_wallet);
                }
                showShopToast(closetMode() ? '구매했어요 — 옷장에서 장착하세요' : '구매했습니다', 'success');
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
        // 어댑터가 장착 경로를 바꿀 수 있다(데구리 js/marble-shop.js: 방 단위 장착 marble:equipSkin — 계정 prefs 에 저장하지 않음).
        // hook(slot, id, done) → done(equippedMap) 성공 / done(null) 실패. 다른 게임(경마·사다리·회전)은 hook 이 없어 아래 shop:equip 그대로.
        if (_config && _config.hooks && _config.hooks.equipRequest) {
            _config.hooks.equipRequest(slot, id, function (equipped, reason) {
                if (!equipped) {   // reason = 서버 ack 의 reason — 새로고침으로 풀리는 상태(방 끊김·인증 만료)는 그렇게 안내
                    var msg = (reason === 'room' || reason === 'auth') ? '연결이 끊겼어요. 새로고침 후 다시 장착해 주세요.'
                        : reason === 'unowned' ? '아직 사지 않은 스킨이에요.' : '장착에 실패했어요. 잠시 후 다시 시도해 주세요.';
                    showShopToast(msg, 'error'); return;
                }
                _wallet.equipped = equipped;
                renderModal();
                if (_config.hooks.onEquipApplied) _config.hooks.onEquipApplied(_wallet.equipped, true);
            });
            return;
        }
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

    // ── 뽑기(가챠) emit + 리빌 ─────────────────────────────

    // 코인 뽑기: 서버 추첨·DB 차감/적립. 더블클릭 가드(doBuy 패턴) → shop:gacha emit.
    function doCoinGacha(btn) {
        if (!_socket || !_wallet.authed) return;
        if (btn) { btn.disabled = true; }
        var game = gameToken();
        _socket.emit('shop:gacha', { economy: 'coin', game: game }, function (res) {
            if (res && res.ok) {
                // 서버 balance가 환급까지 반영해 옴(신규=순차감, 중복=차감-환급) → 그대로 반영.
                var prev = _wallet.balance;
                _wallet.balance = (typeof res.balance === 'number') ? res.balance : _wallet.balance;
                _wallet.owned = Array.isArray(res.owned) ? res.owned : _wallet.owned;
                var item = getCatalogItem(res.drawnId);
                var slot = res.slot;
                renderModal();                         // 잔고/카드 갱신 후
                animateBalanceDelta(prev, _wallet.balance);
                if (item) playReveal(slot, item, item.rarity || 'common', function () {
                    doEquip(slot, res.drawnId);        // 코인 장착 경로(신규일 때만 CTA 노출)
                }, { isDupe: !!res.isDupe, refunded: res.refunded || 0 });
            } else {
                var reason = res && res.reason;
                var msg = (reason === 'insufficient') ? '코인이 부족해요.'
                        : (reason === 'empty') ? '아직 뽑을 수 있는 꾸미기가 없어요.'
                        : (reason === 'auth') ? '로그인 후 이용할 수 있어요.'
                        : (reason === 'locked') ? '코인샵은 준비 중이에요. 추후 오픈 예정이에요.'
                        : (reason === 'busy') ? '뽑기를 처리 중이에요. 잠시만요.'
                        : '뽑기에 실패했어요.';
                showShopToast(msg, 'error');
                renderModal(); // 가챠 버튼 재생성 → disabled 복구(잔고·풀 기준 재평가)
            }
        });
    }

    // 광고 뽑기: 서버 추첨(DB 미진입) + 클라 adWallet 차감/적립. 잔고 선검사 후 emit.
    function doAdGacha(btn) {
        if (!_socket) return;
        if (adBalance() < GACHA_AD_COST) {
            showShopToast('광고코인이 부족해요. 광고를 보고 모아보세요.', 'error');
            return;
        }
        if (btn) { btn.disabled = true; }
        var game = gameToken();
        // 클라 권위 차감(기존 adBuy 모델): emit 전 선차감, 실패면 롤백. 서버는 결과만 결정.
        _adWallet.coins -= GACHA_AD_COST;
        saveAdWallet();
        var badge = document.getElementById(AD_BALANCE_ID);
        if (badge) spawnBalanceDelta(badge, -GACHA_AD_COST);
        _socket.emit('shop:gacha', { economy: 'ad', game: game, ownedAdIds: _adWallet.owned.slice() }, function (res) {
            if (res && res.ok) {
                var adRefund = 0;
                if (res.isDupe) {
                    // 중복: 지급 없이 50% 환급(owned 추가 X). 서버 판정(res.isDupe) 신뢰.
                    adRefund = Math.floor(GACHA_AD_COST / 2);
                    _adWallet.coins += adRefund;
                } else {
                    // 신규: owned 적립.
                    if (_adWallet.owned.indexOf(res.drawnId) === -1) _adWallet.owned.push(res.drawnId);
                }
                saveAdWallet();
                var item = getCatalogItem(res.drawnId);
                var slot = res.slot;
                renderModal();
                if (item) playReveal(slot, item, item.rarity || 'common', function () {
                    adEquip(slot, res.drawnId);        // 광고 장착 경로(신규일 때만 CTA 노출)
                }, { isDupe: !!res.isDupe, refunded: adRefund });
            } else {
                // 실패: 선차감 롤백(무료 손실 방지).
                _adWallet.coins += GACHA_AD_COST;
                saveAdWallet();
                var reason = res && res.reason;
                var msg = (reason === 'empty') ? '아직 뽑을 수 있는 꾸미기가 없어요.'
                        : (reason === 'busy') ? '뽑기를 처리 중이에요. 잠시만요.'
                        : '뽑기에 실패했어요.';
                showShopToast(msg, 'error');
                renderModal(); // 가챠 버튼 재생성 → disabled 복구(잔고·풀 기준 재평가)
            }
        });
    }

    // 리빌 오버레이: 빌드업→버스트→리빌(rarity 차등) + 장착/닫기 CTA. 탭 시 스킵.
    // 아트는 어댑터 buildPreview(slot, item) 재사용. getShopLayer() 위(z-index 12600+).
    // 파티클 위치/지연은 Math.random(외관 한정 — 결과는 이미 서버가 결정).
    // opts.isDupe=true면 중복 변형(♻️ 모티프, 더 짧게, 환급 안내, 장착 CTA 없이 닫기만).
    //   rarity 단계 색은 유지하되 dim 처리. opts.refunded = 환급된 통화량(코인/광고코인).
    function playReveal(slot, item, rarity, onEquip, opts) {
        rarity = (rarity === 'epic' || rarity === 'legend') ? 'epic' : (rarity || 'common');
        opts = opts || {};
        var isDupe = !!opts.isDupe;
        var refunded = opts.refunded || 0;

        var soundOn = (typeof SoundManager !== 'undefined' && SoundManager.playSound);

        var ov = document.createElement('div');
        ov.className = 'hshop-reveal-overlay rarity-' + rarity + (isDupe ? ' is-dupe' : '');
        ov.setAttribute('role', 'dialog');

        var stage = document.createElement('div');
        stage.className = 'hshop-reveal-stage';

        // 빌드업 캡슐(흔들림). 중복은 ♻️ 모티프.
        var capsule = document.createElement('div');
        capsule.className = 'hshop-reveal-capsule';
        capsule.replaceChildren(UIIcons.el(isDupe ? 'recycle' : 'gift'));
        stage.appendChild(capsule);

        // 버스트(라디얼 라이트) + 파티클 레이어
        var burst = document.createElement('div');
        burst.className = 'hshop-reveal-burst';
        stage.appendChild(burst);

        var particles = document.createElement('div');
        particles.className = 'hshop-reveal-particles';
        // 중복은 연출을 더 짧고 가볍게(파티클 수 축소).
        var pCount = isDupe ? 6 : ((rarity === 'epic') ? 18 : 10);
        for (var i = 0; i < pCount; i++) {
            var p = document.createElement('span');
            p.className = 'hshop-reveal-particle';
            // 외관 jitter — 결과 무관(공정성: 서버가 이미 결정)
            var ang = Math.random() * Math.PI * 2;
            var dist = 40 + Math.random() * 80;
            p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
            p.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
            p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
            particles.appendChild(p);
        }
        stage.appendChild(particles);

        // 리빌 카드(아이템 아트 + 이름 + 등급 배지)
        var revealCard = document.createElement('div');
        revealCard.className = 'hshop-reveal-card';

        var art = document.createElement('div');
        art.className = 'hshop-reveal-art hshop-thumb--' + rarity;
        var preview = null;
        if (_config && _config.hooks && _config.hooks.buildPreview) {
            try { preview = _config.hooks.buildPreview(slot, item); } catch (e) { preview = null; }
        }
        if (preview) art.appendChild(preview);
        else {
            var glyph = document.createElement('span');
            glyph.className = 'hshop-glyph';
            if (item.emoji) glyph.textContent = item.emoji; // 상품 자체 아이콘 데이터 — 그대로
            else glyph.appendChild(UIIcons.el('gift'));
            art.appendChild(glyph);
        }
        revealCard.appendChild(art);

        var badge = document.createElement('span');
        badge.className = 'hshop-rarity hshop-rarity--' + rarity + ' hshop-reveal-badge';
        badge.textContent = RARITY_LABEL[rarity] || rarity;
        revealCard.appendChild(badge);

        var nm = document.createElement('div');
        nm.className = 'hshop-reveal-name';
        nm.textContent = item.name;          // 카탈로그 상수(유저입력 아님)
        revealCard.appendChild(nm);

        // 중복: 환급 안내(이미 소유 → 50% 환급). 신규: 안내 없음.
        if (isDupe) {
            var dupeMsg = document.createElement('div');
            dupeMsg.className = 'hshop-reveal-dupe-msg';
            dupeMsg.textContent = '이미 가진 꾸미기 · 50% 환급 (+' + refunded + ')';
            revealCard.appendChild(dupeMsg);
        }

        var ctas = document.createElement('div');
        ctas.className = 'hshop-reveal-ctas';
        var equipBtn = document.createElement('button');
        equipBtn.type = 'button';
        equipBtn.className = 'hshop-reveal-equip';
        equipBtn.textContent = '장착하기';
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'hshop-reveal-close';
        closeBtn.textContent = '닫기';
        // 중복은 이미 소유 → 장착 CTA 없이 닫기만. 신규는 장착하기 + 닫기.
        if (!isDupe) ctas.appendChild(equipBtn);
        ctas.appendChild(closeBtn);
        revealCard.appendChild(ctas);

        stage.appendChild(revealCard);
        ov.appendChild(stage);
        getShopLayer().appendChild(ov);

        function close() { if (ov.parentNode) ov.remove(); }

        // 단계 진행: buildup → reveal. 탭(빈 공간) 시 buildup 스킵 → 즉시 reveal.
        var revealed = false;
        function toReveal() {
            if (revealed) return;
            revealed = true;
            ov.classList.add('is-revealed');
            // 사운드 키는 sound-config.json에 미정의면 무해하게 무시(playSound가 path 없으면 no-op).
            if (soundOn) {
                try { SoundManager.playSound(rarity === 'epic' ? 'gacha_reveal_epic' : 'gacha_reveal'); } catch (e) {}
            }
        }
        if (soundOn) {
            try { SoundManager.playSound('gacha_charge'); } catch (e) {}
        }
        // 중복은 더 짧게(이미 소유 — 빠르게 결과만). 신규는 rarity 차등.
        var timer = setTimeout(toReveal, isDupe ? 700 : (rarity === 'epic' ? 1400 : 1100));

        equipBtn.addEventListener('click', function () { close(); if (onEquip) onEquip(); });
        closeBtn.addEventListener('click', close);
        // 빈 공간 탭 = 빌드업 스킵(리빌 전) 또는 닫기(리빌 후)
        ov.addEventListener('click', function (e) {
            if (e.target !== ov && e.target !== stage) return;
            if (!revealed) { clearTimeout(timer); toReveal(); }
            else close();
        });
    }

    // ── 광고 보상 티어: 시청 / 구매 / 장착 (전부 클라 sessionStorage — 서버 미진입) ──

    // "광고 보기" — 쿨다운 체크 후, 자리표시 재생(승인 대기 안내 + 자체 애니)을 AD_WATCH_MS만큼
    // 보여준 뒤 광고코인 지급. 실제 광고 SDK 승인 전까지의 placeholder다.
    // ⚠️ 이건 애드센스 광고가 아니라 우리 자체 애니메이션이다 → 광고 클릭/시청 유도 정책과 무관.
    function watchAd() {
        var remain = adCooldownRemaining();
        if (remain > 0) {
            showShopToast('잠시 후 다시 볼 수 있어요 (' + Math.ceil(remain / 1000) + '초)', 'error');
            return;
        }
        if (document.getElementById('shopAdPlay')) return; // 이미 재생 중
        playAdPlaceholder(function () {
            _adWallet.coins += AD_COIN_GRANT;
            _adWallet.lastWatch = Date.now();
            saveAdWallet();
            renderModal(); // ad-잔고 배지 재생성 후 연출
            var badge = document.getElementById(AD_BALANCE_ID);
            if (badge) spawnBalanceDelta(badge, AD_COIN_GRANT);
            showShopToast('광고코인 +' + AD_COIN_GRANT, 'success');
        });
    }

    // 광고 자리표시 재생: "승인 대기 중" 안내 + 말이 달리는 애니 + N초 카운트다운/진행바.
    // 끝까지 보면 onReward() 호출. 중간에 ✕로 닫으면 보상 없음(쿨다운도 소비 안 함).
    // Math.random 미사용(애니는 CSS 결정론). 동적 텍스트는 전부 상수 → textContent.
    function playAdPlaceholder(onReward) {
        var secs = Math.round(AD_WATCH_MS / 1000);

        var ov = document.createElement('div');
        ov.id = 'shopAdPlay';
        ov.className = 'shop-adplay-overlay';

        var card = document.createElement('div');
        card.className = 'shop-adplay-card';

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'shop-adplay-close';
        close.textContent = '✕';
        close.setAttribute('aria-label', '닫기 (보상 없음)');

        var title = document.createElement('div');
        title.className = 'shop-adplay-title';
        title.replaceChildren(UIIcons.el('clapper'), ' 광고 준비 중 (승인 대기)');

        var sub = document.createElement('div');
        sub.className = 'shop-adplay-sub';
        sub.textContent = '지금은 미리보기예요. 잠깐 보면 광고코인을 드려요!';

        var track = document.createElement('div');
        track.className = 'shop-adplay-track';
        var runner = document.createElement('span');
        runner.className = 'shop-adplay-runner';
        runner.setAttribute('aria-hidden', 'true');
        runner.replaceChildren(UIIcons.el(AD_RUNNERS[Date.now() % AD_RUNNERS.length])); // 매 클릭 다른 탈것
        track.appendChild(runner);

        var barWrap = document.createElement('div');
        barWrap.className = 'shop-adplay-barwrap';
        var bar = document.createElement('div');
        bar.className = 'shop-adplay-bar';
        bar.style.animationDuration = AD_WATCH_MS + 'ms'; // 진행바를 정확히 시청시간만큼 채움
        barWrap.appendChild(bar);

        var count = document.createElement('div');
        count.className = 'shop-adplay-count';
        count.textContent = secs + '초';

        card.appendChild(close);
        card.appendChild(title);
        card.appendChild(sub);
        card.appendChild(track);
        card.appendChild(barWrap);
        card.appendChild(count);
        ov.appendChild(card);
        getShopLayer().appendChild(ov);

        var done = false;
        var tick = null;
        var timer = null;
        function cleanup() {
            if (tick) { clearInterval(tick); tick = null; }
            if (timer) { clearTimeout(timer); timer = null; }
            if (ov.parentNode) ov.remove();
        }

        var left = secs;
        tick = setInterval(function () {
            left -= 1;
            if (left <= 0) { count.textContent = '완료!'; clearInterval(tick); tick = null; }
            else count.textContent = left + '초';
        }, 1000);

        timer = setTimeout(function () {
            done = true;
            cleanup();
            if (onReward) onReward();
        }, AD_WATCH_MS);

        close.addEventListener('click', function () {
            if (done) return;
            cleanup();
            showShopToast('끝까지 봐야 코인을 받아요.', 'error');
        });
    }

    // 광고코인으로 ad-아이템 구매 (shop:buy emit 없음 — ad-wallet 차감).
    function adBuy(item, btn) {
        if (!item || !isAdItem(item)) return;
        if (adOwns(item.id)) return;
        var adPrice = Number.isFinite(item.adPrice) ? item.adPrice : 0;
        if (adBalance() < adPrice) {
            showShopToast('광고코인이 부족해요. 광고를 보고 모아보세요.', 'error');
            return;
        }
        var prev = _adWallet.coins;
        _adWallet.coins -= adPrice;
        _adWallet.owned.push(item.id);
        saveAdWallet();
        renderModal();
        var badge = document.getElementById(AD_BALANCE_ID);
        if (badge) spawnBalanceDelta(badge, -adPrice);
        showShopToast('광고코인으로 받았어요', 'success');
    }

    // ad-아이템 장착/해제 — transient 소켓 채널로 방 broadcast(인증 불필요).
    function adEquip(slot, id) {
        if (id === null || id === undefined) {
            delete _adWallet.equipped[slot];
        } else {
            _adWallet.equipped[slot] = id;
        }
        saveAdWallet();
        // 서버 transient 채널(게스트 허용 — _wallet.authed 가드 우회)
        if (_socket) _socket.emit('shop:adEquip', { slot: slot, cosmeticId: (id === undefined ? null : id) });
        renderModal();
        // 내 화면에 즉시 반영 (어댑터 hook)
        if (_config && _config.hooks && _config.hooks.onAdEquipApplied) {
            _config.hooks.onAdEquipApplied(_adWallet.equipped, true);
        }
    }

    // 방 (재)입장 시 호출 — 서버 transient(room.adCosmetics[socket.id])는 leave/disconnect로
    // 정리되므로, sessionStorage의 장착 상태로 채워(load) 각 슬롯을 shop:adEquip 으로 재emit해
    // 서버를 다시 채운다. DB 미진입·새 채널 미신설(기존 adEquip emit 재사용). socket/장착 없으면 no-op.
    function reapplyAdEquips() {
        loadAdWallet();
        if (!_socket) return;
        var eq = _adWallet.equipped || {};
        Object.keys(eq).forEach(function (slot) {
            var id = eq[slot];
            if (!id) return;
            _socket.emit('shop:adEquip', { slot: slot, cosmeticId: id });
        });
    }

    // ── 모달 열기/닫기 ─────────────────────────────────────

    // 미인증(게스트/만료토큰) 게스트 진입 허용 여부 — 어댑터 config로 결정.
    // true(경마 v1): ad-티어 모달을 연다. false(기본/스핀): 기존 동작(로그인 안내 후 미오픈).
    function allowsGuestShop() {
        return !!(_config && _config.allowGuestShop);
    }

    // 미인증인데 게스트 진입 불가일 때의 기존 동작: 로그인 안내 후 모달 미오픈.
    function denyGuest() {
        if (typeof showCustomAlert === 'function') showCustomAlert('로그인 후 이용할 수 있어요.');
    }

    // 상점 열기. 인증되면 전체 상점. 미인증/만료토큰은 allowGuestShop에 따라 분기:
    //   - 허용(경마 v1): ad-티어만 구매 가능, 일반 상품은 잠금('로그인하세요').
    //   - 불허(스핀 등): 모달을 열지 않고 로그인 안내(기존 토큰-필수 동작 유지).
    function openShop() { openView('shop'); }
    // 옷장(장착 전용) — config.closet 이 없는 게임은 상점과 같다
    function openCloset() { openView(closetMode() ? 'closet' : 'shop'); }
    function openView(view) {
        _view = view; _groupFilter = 'all';
        loadAdWallet();
        var token = getToken();
        loadCatalog().then(function () {
            function openWithModal() {
                // 상점 열 때 메인샵 정규화: 광고 아이템이 있으면 광고샵을 기본 탭으로(decision #1),
                // 없으면(spin 등) 코인샵 단독 폴백. 'inventory'였던 잔존 상태도 매 오픈 시 리셋.
                _activeMainShop = hasAdItems() ? 'ad' : 'coin';
                // 인벤토리 미리보기/필터 상태도 매 오픈 시 초기화: 직전 세션의 탈것 선택
                // (_invPreviewVehicle)이 새 로스터에 없으면 이름표↔스프라이트 불일치가 나므로
                // null(어댑터 폴백=내 탈것)로, 필터는 '전체'로 되돌린다.
                _invPreviewVehicle = null;
                _invFilter = 'all';
                if (hasAdItems()) ensureActiveTabForMainShop();
                renderModal();
                document.body.classList.add('hshop-open');
            }
            if (_config && _config.roomWallet) {
                // 방 지갑: 인증 없이 방 지갑만 받아서 연다. 못 받으면(방 밖) 안내
                refreshWallet(function (ok) { if (ok) openWithModal(); else if (typeof showCustomAlert === 'function') showCustomAlert('방에 들어온 뒤에 열 수 있어요.'); });
            } else if (_wallet.authed) {
                refreshWallet(openWithModal);
            } else {
                // 토큰 없음/만료는 authenticate 안에서 자동 연장 1회 시도. 그래도 실패면
                // 게스트 허용 시 ad-티어로 dead-end 방지, 아니면 로그인 안내.
                authenticate(token, function (ok) {
                    if (ok) { openWithModal(); return; }
                    if (allowsGuestShop()) openWithModal();
                    else denyGuest();
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
        openCloset: openCloset,
        closeShop: closeShop,
        reapplyAdEquips: reapplyAdEquips,
        isAuthed: function () { return _wallet.authed; },
        // 어댑터가 게임별 메서드(applyToHorse 등) 구현에 쓰는 읽기 getter
        getWallet: function () { return _wallet; },
        getAdWallet: function () { return _adWallet; },
        getEquipped: function () { return _wallet.equipped; },
        getCatalog: function () { return _catalog; },
        getCatalogItem: getCatalogItem,
        findItem: findItem
    };
})();
