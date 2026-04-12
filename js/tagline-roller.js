// 태그라인 롤링 모듈 — 메인 화면 헤더 문구 자동 전환
// 상수: config/client-config.js 참조

const TaglineRoller = (function () {
    let _taglines = ['오늘 커피는 누가 쏠까?'];
    let _timer = null;
    let _loaded = false;

    const _outFx = ['sl','sr','su','sd','fade','scale','blur','eraseL','eraseR'];
    const _inFx = ['sl','sr','su','sd','fade','scale','type','drop','rise','pop','flip'];

    const CSS = `
        .ss-tagline {
            overflow: hidden; height: 1.3em; position: relative; margin: 0;
            color: #888; font-size: 0.95em;
        }
        .ss-tagline span {
            display: inline-block; transition: all 0.7s ease;
            transform-origin: center;
        }
        .ss-tagline .out-sl { opacity: 0; transform: translateX(-30px); }
        .ss-tagline .wait-sl { opacity: 0; transform: translateX(30px); }
        .ss-tagline .out-sr { opacity: 0; transform: translateX(30px); }
        .ss-tagline .wait-sr { opacity: 0; transform: translateX(-30px); }
        .ss-tagline .out-su { opacity: 0; transform: translateY(-20px); }
        .ss-tagline .wait-su { opacity: 0; transform: translateY(20px); }
        .ss-tagline .out-sd { opacity: 0; transform: translateY(20px); }
        .ss-tagline .wait-sd { opacity: 0; transform: translateY(-20px); }
        .ss-tagline .out-fade { opacity: 0; }
        .ss-tagline .wait-fade { opacity: 0; }
        .ss-tagline .out-scale { opacity: 0; transform: scale(0.6); }
        .ss-tagline .wait-scale { opacity: 0; transform: scale(1.3); }
        .ss-tagline .out-blur { opacity: 0; filter: blur(8px); }
        .ss-tagline .wait-blur { opacity: 0; filter: blur(8px); }
        .ss-tagline .wait-drop { opacity: 0; transform: translateY(-25px) scale(0.95); }
        .ss-tagline .wait-rise { opacity: 0; transform: translateY(25px) scale(0.95); }
        .ss-tagline .wait-pop { opacity: 0; transform: scale(0.3); }
        .ss-tagline .wait-flip { opacity: 0; transform: rotateX(90deg); perspective: 200px; }
    `;

    function _injectCSS() {
        if (document.getElementById('tagline-roller-css')) return;
        const style = document.createElement('style');
        style.id = 'tagline-roller-css';
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function _loadTaglines() {
        if (_loaded) return;
        _loaded = true;
        fetch('/api/taglines')
            .then(r => r.json())
            .then(data => { if (Array.isArray(data) && data.length) _taglines = data; })
            .catch(() => {});
    }

    function _eraseOut(el, fromLeft, onDone) {
        const text = el.textContent;
        let i = text.length;
        const step = () => {
            if (i <= 0) { el.textContent = ''; onDone(); return; }
            i--;
            el.textContent = fromLeft ? text.slice(i) : text.slice(0, i);
            setTimeout(step, TAGLINE_ERASE_STEP_MS);
        };
        step();
    }

    function _typeIn(el, text) {
        el.textContent = '';
        el.className = '';
        let i = 0;
        const step = () => {
            if (i < text.length) { el.textContent += text[i++]; setTimeout(step, TAGLINE_TYPE_STEP_MS); }
        };
        step();
    }

    function start() {
        _injectCSS();
        _loadTaglines();
        if (_timer) clearInterval(_timer);
        _timer = setInterval(() => {
            const el = document.getElementById('ss-tagline-text');
            if (!el) { clearInterval(_timer); _timer = null; return; }
            const text = _taglines[Math.floor(Math.random() * _taglines.length)];
            const inFx = _inFx[Math.floor(Math.random() * _inFx.length)];
            const outFx = inFx === 'type' ? 'fade' : _outFx[Math.floor(Math.random() * _outFx.length)];

            const applyIn = () => {
                if (inFx === 'type') {
                    _typeIn(el, text);
                } else {
                    el.textContent = text;
                    el.className = 'wait-' + inFx;
                    requestAnimationFrame(() => requestAnimationFrame(() => el.className = ''));
                }
            };

            if (outFx === 'eraseL' || outFx === 'eraseR') {
                _eraseOut(el, outFx === 'eraseL', applyIn);
            } else {
                el.className = 'out-' + outFx;
                setTimeout(applyIn, TAGLINE_TRANSITION_MS);
            }
        }, TAGLINE_INTERVAL_MS);
    }

    function stop() {
        if (_timer) { clearInterval(_timer); _timer = null; }
    }

    return { start, stop };
})();
