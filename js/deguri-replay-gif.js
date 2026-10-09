// 다시 보기 GIF 녹화 (데구리 단독판 3a8c02e js/replay-gif.js 역반영) — 조작줄의 [GIF 녹화] → 캔버스에서 녹화할 곳을 끌어 고르기 → 이동 막대에서 시작·끝 구간 고르기 → [녹화 시작]이면
// 시작점으로 옮겨 재생하며 보이는 그대로(카메라 끌기·확대 포함) 실시간으로 찍고, 끝점에 닿으면 멈춰 GIF 를 만든다. 내 화면의 다시 보기만 찍는다 — 소켓으로 나가는 것 없음.
// 인코딩은 워커(js/deguri-gif-worker.js)가 프레임을 받는 대로 한다. 녹화 중 멈추면 찍기도 쉰다 — 프레임 간격은 벽시계가 아니라 재생 시각 차이라 GIF 는 원래 빠르기로 돈다.
// 저장: PC(마우스)는 내려받기, 폰은 공유 시트(파일) → 안 되면 내려받기, 그래도 안 되면 미리보기를 길게 눌러 저장.
// 재생 제어는 js/deguri.js 가 넘겨 준다: { time, duration, seekTo, pause, resume }. deguri.js 는 다시 보기가 끝나거나 끊길 때(그만 보기·새 판·리셋) stop() 을 부른다
(function () {
    'use strict';

    var FPS = 10;
    var MAX_SIDE = 360;        // GIF 긴 변(px) 상한 — 풀밭 무늬가 잘 안 눌려 크기가 픽셀 수에 비례한다(480 이면 5초 8MB, 단독판 2026-09-29 측정)
    var MAX_MS = 10000;        // 구간 최대 길이
    var MIN_MS = 500;          // 구간 최소 길이
    var DEFAULT_MS = 5000;     // 처음 잡아 주는 구간
    var MIN_AREA_PX = 24;      // 이보다 작게 끌면 영역으로 치지 않는다
    var FILE_NAME = 'deguri-replay.gif';
    var SHARE_TITLE = '데구리 다시 보기';
    var WORKER_URL = '/js/deguri-gif-worker.js?v=1';   // 절대 경로 — /deguri/CODE 같은 하위 주소에서도 같은 파일
    var DESKTOP = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

    function $(id) { return document.getElementById(id); }
    function secText(ms) { return (Math.max(0, ms) / 1000).toFixed(1) + '초'; }

    function create(ctl) {
        var bar = $('deguriReplayBar'), canvas = $('deguriCanvas');
        var button = $('deguriGifButton'), cancelButton = $('deguriGifCancel'), status = $('deguriGifStatus');
        var areaLayer = $('deguriGifArea'), areaRect = $('deguriGifAreaRect'), fullButton = $('deguriGifAreaFull');
        var rangeBox = $('deguriGifRange'), rangeStart = $('deguriGifRangeStart'), rangeEnd = $('deguriGifRangeEnd'), rangeFill = $('deguriGifRangeFill');
        var dialog = $('deguriGifDialog'), info = $('deguriGifInfo'), preview = $('deguriGifPreview'), saveButton = $('deguriGifSave'), closeButton = $('deguriGifClose');
        if (!bar || !canvas || !button || !areaLayer || !rangeBox || !dialog || typeof Worker === 'undefined') {
            if (button) button.hidden = true;
            return { stop: function () {} };
        }

        var state = '';            // '' | 'area'(영역 고르기) | 'range'(구간 고르기) | 'rec'(녹화 중)
        var area = null;           // 캔버스 CSS px 기준 { x, y, w, h }
        var drag = null;
        var rec = null;            // { worker, timer, out, g, start, end, pending, sentCs, frames }
        var gifBlob = null, gifUrl = null;

        function setState(next) {
            state = next;
            if (next) bar.setAttribute('data-gif', next); else bar.removeAttribute('data-gif');
            button.hidden = next === 'area';
            button.classList.toggle('is-armed', next === 'range');
            button.classList.toggle('is-recording', next === 'rec');
            button.lastChild.textContent = next === 'range' ? '녹화 시작' : next === 'rec' ? '녹화 끝' : 'GIF 녹화';
            cancelButton.hidden = !next;
            rangeBox.hidden = next !== 'range';
            areaLayer.hidden = !next;
            areaLayer.classList.toggle('is-picking', next === 'area');
            if (!next) { area = null; areaRect.hidden = true; status.textContent = ''; }
            if (next === 'area') status.textContent = '';
        }

        // ── 1. 영역 고르기 ──
        function canvasPoint(e) {
            var r = canvas.getBoundingClientRect();
            return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
        }
        function showRect(a) {
            areaRect.hidden = false;
            areaRect.style.left = a.x + 'px'; areaRect.style.top = a.y + 'px'; areaRect.style.width = a.w + 'px'; areaRect.style.height = a.h + 'px';
        }
        function rectFrom(p, q) { return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(p.x - q.x), h: Math.abs(p.y - q.y) }; }
        areaLayer.addEventListener('pointerdown', function (e) {
            if (state !== 'area' || e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
            drag = { id: e.pointerId, from: canvasPoint(e) };
            try { areaLayer.setPointerCapture(e.pointerId); } catch (err) { /* 무음 */ }
            e.preventDefault();
        });
        areaLayer.addEventListener('pointermove', function (e) {
            if (!drag || drag.id !== e.pointerId) return;
            showRect(rectFrom(drag.from, canvasPoint(e)));
            e.preventDefault();
        });
        function endDrag(e) {
            if (!drag || drag.id !== e.pointerId) return;
            var a = rectFrom(drag.from, canvasPoint(e));
            drag = null;
            if (a.w < MIN_AREA_PX || a.h < MIN_AREA_PX) { areaRect.hidden = true; return; }   // 톡 누른 건 영역이 아니다 — 다시 끌게
            pickArea(a);
        }
        areaLayer.addEventListener('pointerup', endDrag);
        areaLayer.addEventListener('pointercancel', function () { drag = null; areaRect.hidden = true; });
        fullButton.addEventListener('click', function () {
            var r = canvas.getBoundingClientRect();
            pickArea({ x: 0, y: 0, w: r.width, h: r.height });
        });

        // ── 2. 구간 고르기 ── 손잡이를 움직이면 그 시각 장면을 보여 준다(멈춘 채)
        function pickArea(a) {
            area = a; showRect(a);
            var dur = ctl.duration();
            var start = Math.max(0, Math.min(ctl.time(), dur - MIN_MS));
            var end = Math.min(dur, start + DEFAULT_MS);
            if (end - start < DEFAULT_MS) start = Math.max(0, end - DEFAULT_MS);
            [rangeStart, rangeEnd].forEach(function (input) { input.min = 0; input.max = Math.round(dur); input.step = 100; });
            rangeStart.value = Math.round(start); rangeEnd.value = Math.round(end);
            setState('range');
            updateRange();
            ctl.seekTo(Number(rangeStart.value));
        }
        function updateRange() {
            var max = Number(rangeStart.max) || 1, a = Number(rangeStart.value), b = Number(rangeEnd.value);
            rangeFill.style.left = (a / max * 100) + '%'; rangeFill.style.width = ((b - a) / max * 100) + '%';
            status.textContent = '구간 ' + secText(b - a);
        }
        function onRangeInput(moved) {
            var max = Number(rangeStart.max), a = Number(rangeStart.value), b = Number(rangeEnd.value);
            if (moved === rangeStart) {   // 시작 손잡이가 끝을 밀거나 끌고 간다
                if (b - a < MIN_MS) b = Math.min(max, a + MIN_MS);
                if (b - a > MAX_MS) b = a + MAX_MS;
                if (b - a < MIN_MS) a = b - MIN_MS;
            } else {
                if (b - a < MIN_MS) a = Math.max(0, b - MIN_MS);
                if (b - a > MAX_MS) a = b - MAX_MS;
                if (b - a < MIN_MS) b = a + MIN_MS;
            }
            rangeStart.value = a; rangeEnd.value = b;
            updateRange();
            ctl.seekTo(Number(moved.value));
        }
        rangeStart.addEventListener('input', function () { onRangeInput(rangeStart); });
        rangeEnd.addEventListener('input', function () { onRangeInput(rangeEnd); });

        // ── 3. 녹화 ──
        function startRec() {
            var start = Number(rangeStart.value), end = Number(rangeEnd.value);
            var scale = Math.min(canvas.width / canvas.clientWidth, MAX_SIDE / Math.max(area.w, area.h));
            var out = document.createElement('canvas');
            out.width = Math.max(2, Math.round(area.w * scale)); out.height = Math.max(2, Math.round(area.h * scale));
            var worker;
            try { worker = new Worker(WORKER_URL); } catch (err) { status.textContent = '이 브라우저에서는 GIF 를 만들 수 없어요'; return; }
            worker.postMessage({ type: 'start', w: out.width, h: out.height });
            rec = { worker: worker, out: out, g: out.getContext('2d', { willReadFrequently: true }), start: start, end: end, pending: null, sentCs: 0, frames: 0 };
            setState('rec');
            ctl.seekTo(start);
            ctl.resume();
            capture();
            rec.timer = setInterval(capture, 1000 / FPS);
        }
        function capture() {
            if (!rec) return;
            var t = Math.min(ctl.time(), rec.end);
            if (rec.pending && t <= rec.pending.t) return;   // 멈춤 중 — 같은 장면을 또 찍지 않는다
            var r = canvas.width / canvas.clientWidth;
            rec.g.imageSmoothingEnabled = true; rec.g.imageSmoothingQuality = 'high';
            rec.g.drawImage(canvas, area.x * r, area.y * r, area.w * r, area.h * r, 0, 0, rec.out.width, rec.out.height);
            var buf = rec.g.getImageData(0, 0, rec.out.width, rec.out.height).data.buffer;
            flush(rec, t);
            rec.pending = { buf: buf, t: t };
            status.textContent = '● ' + secText(t - rec.start) + ' / ' + secText(rec.end - rec.start);
            if (t >= rec.end) finishRec(true);
        }
        // 앞 프레임을 보낸다 — 지연은 다음 프레임까지 흐른 재생 시각(누적 반올림, 1/100초)
        function flush(r, t) {
            var p = r.pending; if (!p) return;
            var cs = Math.round((t - r.start) / 10) - r.sentCs;
            if (cs < 2) cs = 2;
            r.sentCs += cs;
            r.worker.postMessage({ type: 'frame', buf: p.buf, delay: cs }, [p.buf]);
            r.frames += 1;
            r.pending = null;
        }
        function finishRec(atEnd) {
            if (!rec) return;
            var r = rec; rec = null;
            clearInterval(r.timer);
            if (atEnd) ctl.pause();
            if (r.pending) flush(r, r.pending.t + 1000 / FPS);   // 마지막 프레임은 한 칸 길이
            setState('');
            if (r.frames < 2) { r.worker.terminate(); return; }   // 한 장뿐이면 GIF 가 아니다(녹화 시작 직후 끊김 등)
            openDialog(r.frames);
            r.worker.onmessage = function (e) {
                if (e.data.type === 'progress') return;
                if (e.data.type === 'done') { r.worker.terminate(); showGif(e.data.blob); }
            };
            r.worker.onerror = function () { r.worker.terminate(); info.textContent = 'GIF 를 만들지 못했어요.'; };
            r.worker.postMessage({ type: 'finish' });
        }
        function cancel() {
            if (rec) { clearInterval(rec.timer); rec.worker.terminate(); rec = null; }
            drag = null;
            setState('');
        }

        // ── 4. 결과 ──
        function openDialog(frames) {
            if (gifUrl) { URL.revokeObjectURL(gifUrl); gifUrl = null; }
            gifBlob = null;
            preview.hidden = true; preview.removeAttribute('src');
            saveButton.disabled = true;
            info.textContent = 'GIF 만드는 중… (' + frames + '장)';
            if (!dialog.open) { try { dialog.showModal(); } catch (err) { dialog.setAttribute('open', ''); } }
        }
        function showGif(blob) {
            gifBlob = blob; gifUrl = URL.createObjectURL(blob);
            preview.src = gifUrl; preview.hidden = false;
            saveButton.disabled = false;
            info.textContent = Math.max(1, Math.round(blob.size / 1024)) + 'KB' + (DESKTOP ? '' : ' · 저장이 안 되면 그림을 길게 눌러 저장하세요');
        }
        function download() {
            var a = document.createElement('a');
            a.href = gifUrl; a.download = FILE_NAME; a.style.display = 'none';
            document.body.appendChild(a); a.click(); a.remove();
        }
        saveButton.addEventListener('click', function () {
            if (!gifBlob) return;
            if (DESKTOP) { download(); return; }
            var file = null;
            try { file = new File([gifBlob], FILE_NAME, { type: 'image/gif' }); } catch (err) { file = null; }
            var canShare = false;
            try { canShare = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (err) { canShare = false; }
            if (!canShare) { download(); return; }
            navigator.share({ files: [file], title: SHARE_TITLE }).then(null, function (err) {
                if (err && err.name === 'AbortError') return;   // 사용자가 공유 시트를 닫았다
                download();
            });
        });
        closeButton.addEventListener('click', function () { dialog.close(); });

        button.addEventListener('click', function () {
            if (state === '') { ctl.pause(); setState('area'); }
            else if (state === 'range') startRec();
            else if (state === 'rec') finishRec(false);
        });
        cancelButton.addEventListener('click', cancel);

        // 다시 보기가 끝나거나 끊겼다 — 녹화 중이면 찍은 데까지 GIF 로, 고르는 중이면 걷는다
        return { stop: function () { if (state === 'rec') finishRec(false); else if (state) cancel(); } };
    }

    window.DeguriReplayGif = { create: create };
})();
