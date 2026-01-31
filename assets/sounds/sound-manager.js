/**
 * 사운드 설정 테이블(sound-config.json) 기반 공통 재생 유틸
 * .cursorrules 섹션 22: 키 형식 {gameType}_{effectName}, 경로는 JSON에서만 참조
 */
(function (global) {
    var configCache = null;
    var configUrl = '/assets/sounds/sound-config.json';
    var activeLoops = {};

    /**
     * sound-config.json 로드 및 캐시 (최초 1회)
     * @returns {Promise<Object>} 키-경로 맵
     */
    function loadConfig() {
        if (configCache) return Promise.resolve(configCache);
        return fetch(configUrl)
            .then(function (res) { return res.ok ? res.json() : {}; })
            .then(function (obj) {
                configCache = obj || {};
                return configCache;
            })
            .catch(function () {
                configCache = {};
                return configCache;
            });
    }

    /**
     * 사용자 제스처 후 AudioContext resume (한 번만 호출해도 됨)
     */
    function ensureContext() {
        if (global.AudioContext || global.webkitAudioContext) {
            var Ctx = global.AudioContext || global.webkitAudioContext;
            if (!ensureContext._ctx) ensureContext._ctx = new Ctx();
            var ctx = ensureContext._ctx;
            if (ctx.state === 'suspended') ctx.resume();
        }
    }

    /**
     * 탭이 포커스(visible + hasFocus)일 때만 재생. 백그라운드에서 트리거된 사운드는 무시.
     */
    function hasSoundFocus() {
        if (typeof document === 'undefined') return false;
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    /**
     * 키로 사운드 재생. enabled가 false면 스킵. 탭이 포커스가 아니면 스킵(백그라운드 무시).
     * @param {string} key - gameType_effectName (예: dice_roll, roulette_spin)
     * @param {boolean} [enabled=true] - 재생 여부 게이트
     */
    function playSound(key, enabled) {
        if (enabled === false) return;
        if (!hasSoundFocus()) return;
        loadConfig().then(function (cfg) {
            if (!hasSoundFocus()) return;
            var path = cfg[key];
            if (!path) return;
            var src = path.charAt(0) === '/' ? path : '/' + path;
            var audio = new Audio(src);
            audio.play().catch(function (e) { console.warn('[SoundManager] playSound failed:', key, e.message); });
        });
    }

    /**
     * 키로 루프 사운드 재생. 이미 같은 키가 재생 중이면 무시.
     * @param {string} key - gameType_effectName
     * @param {boolean} [enabled=true] - 재생 여부 게이트
     * @param {number} [volume=1.0] - 볼륨 (0.0 ~ 1.0)
     */
    function playLoop(key, enabled, volume) {
        if (enabled === false) return;
        if (!hasSoundFocus()) return;
        if (activeLoops[key]) return;
        loadConfig().then(function (cfg) {
            if (!hasSoundFocus()) return;
            if (activeLoops[key]) return;
            var path = cfg[key];
            if (!path) return;
            var src = path.charAt(0) === '/' ? path : '/' + path;
            var audio = new Audio(src);
            audio.loop = true;
            audio.volume = typeof volume === 'number' ? volume : 1.0;
            audio.play().catch(function (e) { console.warn('[SoundManager] playLoop failed:', key, e.message); });
            activeLoops[key] = audio;
        });
    }

    /**
     * 특정 루프 정지
     * @param {string} key
     */
    function stopLoop(key) {
        var audio = activeLoops[key];
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
            delete activeLoops[key];
        }
    }

    /**
     * 모든 루프 정지
     */
    function stopAll() {
        Object.keys(activeLoops).forEach(function (key) {
            stopLoop(key);
        });
    }

    /**
     * 루프 볼륨 조절
     * @param {string} key
     * @param {number} volume - 0.0 ~ 1.0
     */
    function setVolume(key, volume) {
        var audio = activeLoops[key];
        if (audio) {
            audio.volume = volume;
        }
    }

    global.SoundManager = {
        loadConfig: loadConfig,
        ensureContext: ensureContext,
        playSound: playSound,
        playLoop: playLoop,
        stopLoop: stopLoop,
        stopAll: stopAll,
        setVolume: setVolume,
        hasSoundFocus: hasSoundFocus
    };
})(typeof window !== 'undefined' ? window : this);
