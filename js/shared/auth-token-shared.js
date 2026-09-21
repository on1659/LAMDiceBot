/*
 * auth-token-shared.js — 로그인 토큰 자동 연장 (전역 AuthToken)
 *
 * 화면의 "로그인됨"은 localStorage.userAuth 존재로 켜지지만, 상점/지갑은 그 안의 token 이
 * 서버 서명 검증(7일 만료)을 통과해야 한다. 둘이 어긋나면 로그인된 것처럼 보이는데 상점만
 * "로그인 후 이용" 이 뜬다. 이 모듈은 socket:authenticate 가 auth 로 실패했을 때 유저가
 * 아무것도 안 해도 되도록 토큰을 다시 받아 userAuth 에 저장한다(사용자 결정 2026-09-22).
 *
 *   - token 있음 → POST /api/auth/refresh { token }  (서명 유효 + 유예 기간 내 → 새 토큰)
 *   - token 없음(2026-06 토큰 도입 전 로그인) → POST /api/auth/token { name, id }  (구세대 부트스트랩)
 *   - 둘 다 실패(유예 기간 초과·계정 없음) → null → 호출부가 기존 재로그인 흐름을 탄다
 *
 * 호출부: js/shared/shop-shared.js(게임 페이지 상점 인증), js/shared/server-select-shared.js(로비 검증).
 */
(function () {
    'use strict';

    var REFRESH_URL = '/api/auth/refresh';
    var BOOTSTRAP_URL = '/api/auth/token';

    function readAuth() {
        try { return JSON.parse(localStorage.getItem('userAuth') || 'null'); } catch (e) { return null; }
    }

    function post(url, body) {
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
    }

    // 새 토큰을 userAuth 에 저장. 서버가 돌려준 정규화 이름/id 도 함께 맞춘다.
    function store(auth, result) {
        var next = Object.assign({}, auth, result.user || {}, { token: result.token });
        try { localStorage.setItem('userAuth', JSON.stringify(next)); } catch (e) {}
        return result.token;
    }

    // 토큰 재발급 시도 → done(newToken | null). userAuth 자체가 없으면 즉시 null.
    function renew(done) {
        var auth = readAuth();
        if (!auth || !auth.name) { done(null); return; }
        var req = auth.token
            ? post(REFRESH_URL, { token: auth.token })
            : post(BOOTSTRAP_URL, { name: auth.name, id: auth.id });
        req.then(function (result) {
            done((result && result.token) ? store(auth, result) : null);
        });
    }

    window.AuthToken = { renew: renew };
})();
