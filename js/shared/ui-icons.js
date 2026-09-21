/**
 * 공용 UI 아이콘 — OS 이모지 대체 (assets/ui/icons.png, 10×10 셀 128px)
 * 의뢰서: docs/spritemake-request/2026-09-22-ui-icons-shared-m.md
 *
 * 마크업:  <i class="ui ui-dice"></i>  (css/ui-icons.css, 글자 크기를 따라감 1.2em)
 * 문자열:  UIIcons.tag('dice')            → '<i class="ui ui-dice"></i>'  (innerHTML 템플릿 안에서)
 * 노드:    UIIcons.el('dice')             → <i> Element
 * 텍스트:  UIIcons.setIconText(el, '🎲 ' + name)
 *            — 알려진 이모지만 <i> 로 바꾸고 나머지는 텍스트 노드로 넣는다. innerHTML 을 쓰지 않으므로
 *              유저 이름 같은 문자열이 섞여도 HTML 로 해석되지 않는다. `el.textContent = '🎲 ' + name` 의 안전한 대체.
 * 조각:    UIIcons.textToNodes(text)      → DocumentFragment (채팅 시스템 메시지 등)
 * 확장:    UIIcons.register('🐰', function () { return element })  — 페이지별 추가 매핑(경마 탈것 SVG 썸 등)
 * 캔버스:  UIIcons.draw(ctx, 'swords', x, y, size)  — 아틀라스에서 drawImage (중심 기준). UI_ICON_CELL / UI_ICON_COLS 직접 사용도 가능.
 *
 * 셀 순서는 의뢰서 §2 표와 css/ui-icons.css 가 같은 배열을 본다 — 옮기면 세 곳 다 고칠 것.
 */
(function (global) {
    'use strict';

    var ATLAS_URL = '/assets/ui/icons.png?v=1';
    var UI_ICON_COLS = 10;
    var UI_ICON_PX = 128;

    // index = 배열 위치 (row×10+col). 0~32 는 데구리 10차(L) 순서 그대로.
    var UI_ICON_IDS = [
        'paw', 'target', 'medal', 'snail', 'trophy', 'burger', 'list', 'memo', 'people', 'bulb',
        'check', 'hourglass', 'clock', 'flask', 'expand', 'replay', 'play', 'stop', 'refresh', 'chat',
        'scroll', 'lock', 'crown', 'person', 'warn', 'info', 'book', 'home', 'flag', 'sun',
        'hole', 'dash', 'x', 'dice', 'slot', 'horse', 'bridge', 'ladder', 'swords', 'pirate',
        'gamepad', 'confetti', 'party', 'silver', 'bronze', 'checker', 'sparkle', 'star', 'skull', 'rain',
        'fog', 'cloudsun', 'coin', 'gift', 'recycle', 'box', 'bag', 'cart', 'palette', 'tag',
        'clapper', 'camera', 'tv', 'sound', 'soundlow', 'mute', 'pencil', 'door', 'link', 'mail',
        'pin', 'key', 'chart', 'calendar', 'wave', 'eye', 'grad', 'question', 'pc', 'phone',
        'apple', 'fire', 'rocket', 'dizzy', 'carrot', 'banana', 'snow', 'barrier', 'ghost', 'tomb',
        'bolt', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'
    ];
    var UI_ICON_CELL = {};
    UI_ICON_IDS.forEach(function (id, i) { UI_ICON_CELL[id] = i; });

    // 이모지 → 아이콘 id. 변형 선택자(U+FE0F)는 조회 전에 떼므로 여기엔 넣지 않는다.
    // 같은 뜻의 다른 이모지는 한 셀로 모은다(🏅→medal, 🏴→flag, ⏱→clock …).
    var EMOJI_TO_ICON = {
        '🐾': 'paw', '🎯': 'target', '🥇': 'medal', '🏅': 'medal', '🐌': 'snail', '🏆': 'trophy', '🍔': 'burger', '🍜': 'burger',
        '📋': 'list', '📰': 'list', '📝': 'memo', '👥': 'people', '💡': 'bulb', '✅': 'check', '😌': 'check', '⏳': 'hourglass', '🛠': 'hourglass',
        '⏰': 'clock', '⏱': 'clock', '🧪': 'flask', '⛶': 'expand', '↺': 'replay', '🔄': 'refresh', '💬': 'chat', '📜': 'scroll',
        '🔒': 'lock', '🔐': 'lock', '👑': 'crown', '👤': 'person', '⚠': 'warn', 'ℹ': 'info', '📚': 'book', '📖': 'book', '🏠': 'home',
        '🚩': 'flag', '🏴': 'flag', '☀': 'sun', '🕳': 'hole', '💨': 'dash', '🏃': 'dash', '❌': 'x', '⛔': 'x',
        '🎲': 'dice', '🎰': 'slot', '🐎': 'horse', '🐴': 'horse', '🎠': 'horse', '🏇': 'horse', '🌉': 'bridge', '🪜': 'ladder',
        '⚔': 'swords', '🌀': 'swords', '🏴‍☠': 'pirate', '☠': 'pirate', '🎮': 'gamepad',
        '🎊': 'confetti', '🎆': 'confetti', '🎉': 'party', '🥈': 'silver', '🥉': 'bronze', '🏁': 'checker', '✨': 'sparkle', '🌟': 'sparkle',
        '⭐': 'star', '★': 'star', '💀': 'skull', '🌧': 'rain', '🌫': 'fog', '🌤': 'cloudsun',
        '🪙': 'coin', '🎁': 'gift', '♻': 'recycle', '📦': 'box', '🛍': 'bag', '🛒': 'cart', '🎨': 'palette', '🏷': 'tag',
        '🎬': 'clapper', '📷': 'camera', '📺': 'tv', '🔊': 'sound', '🔈': 'soundlow', '🔇': 'mute', '✏': 'pencil', '🖊': 'pencil',
        '🚪': 'door', '🔗': 'link', '📨': 'mail', '📌': 'pin', '🔑': 'key', '📊': 'chart', '📅': 'calendar', '👋': 'wave',
        '👁': 'eye', '👀': 'eye', '🎓': 'grad', '❓': 'question', '💻': 'pc', '🖥': 'pc', '📱': 'phone', '🍎': 'apple',
        '🔥': 'fire', '🚀': 'rocket', '💫': 'dizzy', '🥕': 'carrot', '🍌': 'banana', '❄': 'snow', '🚧': 'barrier', '👻': 'ghost',
        '🪦': 'tomb', '⚡': 'bolt', '⚀': 'd1', '⚁': 'd2', '⚂': 'd3', '⚃': 'd4', '⚄': 'd5', '⚅': 'd6'
    };

    var VS_RE = /️/g;
    var factories = {};   // 정규화된 이모지 → Element 팩토리 (register 로 페이지가 덮을 수 있음)
    Object.keys(EMOJI_TO_ICON).forEach(function (emoji) {
        factories[emoji] = (function (id) { return function () { return el(id); }; })(EMOJI_TO_ICON[emoji]);
    });
    var matcher = null;   // 등록 키 전체를 잇는 정규식 — 긴 키(🏴‍☠) 먼저
    function rebuildMatcher() {
        var keys = Object.keys(factories).sort(function (a, b) { return b.length - a.length; });
        matcher = new RegExp(keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g');
    }
    rebuildMatcher();

    function tag(id) { return '<i class="ui ui-' + id + '"></i>'; }
    function el(id) {
        var i = document.createElement('i');
        i.className = 'ui ui-' + id;
        return i;
    }
    function textToNodes(text) {
        var frag = document.createDocumentFragment();
        var s = String(text == null ? '' : text).replace(VS_RE, '');
        var last = 0, m;
        matcher.lastIndex = 0;
        while ((m = matcher.exec(s)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
            frag.appendChild(factories[m[0]]());
            last = m.index + m[0].length;
        }
        if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
        return frag;
    }
    function setIconText(node, text) {
        if (!node) return;
        node.textContent = '';
        node.appendChild(textToNodes(text));
    }
    function register(emoji, factory) {
        factories[String(emoji).replace(VS_RE, '')] = factory;
        rebuildMatcher();
    }
    function iconIdFor(emoji) { return EMOJI_TO_ICON[String(emoji).replace(VS_RE, '')] || null; }

    var atlasImg = null;
    function image() {
        if (!atlasImg) { atlasImg = new Image(); atlasImg.src = ATLAS_URL; }
        return atlasImg;
    }
    function draw(ctx, id, x, y, size) {
        var i = UI_ICON_CELL[id], im = image();
        if (i == null || !im.complete || !im.naturalWidth) return false;
        var sx = (i % UI_ICON_COLS) * UI_ICON_PX, sy = Math.floor(i / UI_ICON_COLS) * UI_ICON_PX;
        ctx.drawImage(im, sx, sy, UI_ICON_PX, UI_ICON_PX, x - size / 2, y - size / 2, size, size);
        return true;
    }

    global.UI_ICON_IDS = UI_ICON_IDS;
    global.UI_ICON_CELL = UI_ICON_CELL;
    global.UI_ICON_COLS = UI_ICON_COLS;
    global.UI_ICON_PX = UI_ICON_PX;
    global.UI_ICON_ATLAS_URL = ATLAS_URL;
    global.UIIcons = { tag: tag, el: el, textToNodes: textToNodes, setIconText: setIconText, register: register, iconIdFor: iconIdFor, image: image, draw: draw, EMOJI_TO_ICON: EMOJI_TO_ICON };
})(typeof window !== 'undefined' ? window : this);
