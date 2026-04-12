/**
 * control-bar-shared.js
 * 모든 게임에서 공유하는 컨트롤바 렌더링 + 볼륨 컨트롤
 *
 * 사용법 (각 게임 HTML):
 *   <div id="controlBarMount"></div>
 *   <script src="/control-bar-shared.js"></script>
 *   <script>
 *     ControlBar.init({
 *       gameKey: 'dice',              // localStorage 키 접두사
 *       onLeave: function() { logout(); },
 *       extraBadges: [                // 게임별 추가 뱃지 (옵션)
 *         { id: 'turboBadge', html: '🚀 터보', className: 'turbo-badge', style: '...' }
 *       ],
 *       onEditRoomName: function() { editRoomName(); }  // 방제 편집 콜백 (옵션)
 *     });
 *   </script>
 */
(function (global) {
    'use strict';

    var _config = null;
    var _masterVolume = 0;
    var _storedVolume = 0.5;

    function _soundKey() { return _config.soundKey || (_config.gameKey + '_sound_enabled'); }
    function _volumeKey() { return _config.volumeKey || (_config.gameKey + '_sound_volume'); }

    // --- Public API for game code ---
    function getSoundEnabled() { return _masterVolume > 0; }
    function getMasterVolume() { return _masterVolume; }

    function initVolumeFromStorage() {
        var storedMuted = localStorage.getItem(_soundKey());
        var storedVol = localStorage.getItem(_volumeKey());
        _storedVolume = storedVol ? parseFloat(storedVol) : 0.5;
        var isEnabled = storedMuted === 'true';
        _masterVolume = isEnabled ? _storedVolume : 0;
    }

    function updateVolumeUI() {
        var isMuted = _masterVolume === 0;
        var volumePercent = Math.round(_storedVolume * 100);
        var btn = document.getElementById('volumeBtn');
        var slider = document.getElementById('volumeSlider');
        if (btn) btn.textContent = isMuted ? '🔇' : (_masterVolume < 0.5 ? '🔈' : '🔊');
        if (slider) {
            slider.value = isMuted ? 0 : volumePercent;
            slider.classList.toggle('muted', isMuted);
        }
    }

    function toggleMute() {
        if (_masterVolume > 0) {
            _masterVolume = 0;
            localStorage.setItem(_soundKey(), 'false');
        } else {
            _masterVolume = _storedVolume;
            localStorage.setItem(_soundKey(), 'true');
        }
        updateVolumeUI();
        if (global.SoundManager) SoundManager.applyMasterVolume();
    }

    function setMasterVolume(volumePercent) {
        var vol = volumePercent / 100;
        _storedVolume = vol;
        _masterVolume = vol;
        localStorage.setItem(_volumeKey(), vol.toString());
        localStorage.setItem(_soundKey(), vol > 0 ? 'true' : 'false');
        updateVolumeUI();
        if (global.SoundManager) SoundManager.applyMasterVolume();
    }

    // --- Render ---
    function render(mountId) {
        var mount = document.getElementById(mountId || 'controlBarMount');
        if (!mount) return;

        var cfg = _config;
        var extraHtml = '';
        if (cfg.extraBadges) {
            cfg.extraBadges.forEach(function (b) {
                var style = b.style ? ' style="display: none; ' + b.style + '"' : ' style="display: none;"';
                var cls = b.className ? ' class="' + b.className + '"' : '';
                extraHtml += '<span id="' + b.id + '"' + cls + style + '>' + b.html + '</span>';
            });
        }

        var editIcon = cfg.onEditRoomName
            ? '<span class="edit-icon" id="editRoomNameButton" style="display: none;">✏️</span>'
            : '';

        mount.innerHTML =
            '<div class="room-control-bar">' +
                '<div class="control-bar-title" id="roomTitle">' +
                    '<span id="roomNameDisplay">' +
                        '<span id="roomNameText">방 제목</span>' +
                    '</span>' +
                    editIcon +
                    '<span class="host-badge" id="hostBadge" style="display: none;">👑 호스트</span>' +
                    extraHtml +
                '</div>' +
                '<div class="control-bar-meta">' +
                    '<span id="roomStatusIcons" style="display: none;"></span>' +
                    '<span class="username-display" id="usernameDisplay"></span>' +
                    '<div class="volume-control">' +
                        '<button class="volume-btn" id="volumeBtn" type="button">🔊</button>' +
                        '<input type="range" class="volume-slider" id="volumeSlider" min="0" max="100" value="100">' +
                    '</div>' +
                '</div>' +
                '<button id="leaveBtn" class="control-bar-btn leave-btn">🚪 나가기</button>' +
            '</div>';

        // Event listeners
        var volumeBtn = document.getElementById('volumeBtn');
        var volumeSlider = document.getElementById('volumeSlider');
        var leaveBtn = document.getElementById('leaveBtn');
        var editBtn = document.getElementById('editRoomNameButton');

        if (volumeBtn) volumeBtn.addEventListener('click', toggleMute);
        if (volumeSlider) volumeSlider.addEventListener('input', function () {
            setMasterVolume(parseInt(volumeSlider.value));
        });
        if (leaveBtn && cfg.onLeave) leaveBtn.addEventListener('click', cfg.onLeave);
        if (editBtn && cfg.onEditRoomName) editBtn.addEventListener('click', cfg.onEditRoomName);
    }

    // --- Init ---
    function init(config) {
        _config = config;
        initVolumeFromStorage();

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                render(config.mountId);
                updateVolumeUI();
                if (global.SoundManager) SoundManager.setMasterVolumeGetter(getMasterVolume);
            });
        } else {
            render(config.mountId);
            updateVolumeUI();
            if (global.SoundManager) SoundManager.setMasterVolumeGetter(getMasterVolume);
        }
    }

    global.ControlBar = {
        init: init,
        getSoundEnabled: getSoundEnabled,
        getMasterVolume: getMasterVolume,
        setMasterVolume: setMasterVolume,
        toggleMute: toggleMute,
        updateVolumeUI: updateVolumeUI
    };

})(window);
