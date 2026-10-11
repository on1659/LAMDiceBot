// Jev 하이라이트(docs/goal/deguri-jev-highlight.md, 데구리 단독판 js/jev-highlight.js 아랫부분 역반영) — 서버가 고른 6초 장면(deguri:highlight { rid, source, arm, clip, facts, reason })을
// 같은 경주 기록(deguriState.reveal)으로 화면 밖 캔버스에 다시 그려 GIF 로 만들어 두고(경주 중), 결과 카드에서 순위 목록 자리와 바꿔 보여 준다.
// 장면 고르기·Jev 호출은 서버(socket/deguri.js pickHighlight)가 방당 한 번 — 이 파일은 그리기·카드 UI·반응(👍/👎·저장 → deguri:highlight:feedback)만. 보는 사람 화면 상태라 소켓으로 나가는 건 반응뿐.
// 저절로 한 번(사용자 2026-10-12): 결과 카드가 열리고 3초 뒤(GIF 가 덜 됐으면 다 되는 대로, 열린 뒤 10초까지) 하이라이트로 바꿔 처음부터 한 바퀴 보여 주고 순위로 돌아간다. 판마다 한 번, 뭘 누르면 그만둔다.
// 경주 결과·시뮬에는 아무 영향이 없다. GIF 는 어디로도 보내지 않는다.
(function () {
    'use strict';

    var CLIP_MS = 6000;         // 하이라이트 길이(재생 시각) — 서버 socket/deguri-highlight.js CLIP_MS 와 같다
    var FPS = 10, FRAME_MS = 1000 / FPS;
    var OUT_W = 360;            // GIF 폭 — 다시 보기 GIF(js/deguri-replay-gif.js MAX_SIDE)와 같은 크기
    var PREROLL_MS = 1000;      // 찍기 전에 이만큼 먼저 그려 카메라·구르기를 자리 잡게 한다
    var RENDER_GAP_MS = 40;     // 프레임 하나 그리고 쉬는 틈(최소) — 그리는 데 걸린 시간의 두 배는 쉰다. 화면의 경주 재생이 끊기지 않게
    var AUTO_DELAY_MS = 3000;   // 결과 카드가 열리고 이만큼 뒤에 하이라이트를 한 번 저절로 보여 준다
    var AUTO_WAIT_MS = 10000;   // 그때까지 GIF 가 덜 됐으면 카드가 열린 뒤 이만큼까지만 기다린다 — 한참 뒤에 갑자기 바뀌지 않게
    var AUTO_BACK_EXTRA_MS = 300;   // 한 바퀴(CLIP_MS) 뒤 순위로 돌아갈 때 여유
    var FILE_NAME = 'deguri-highlight.gif';
    var SHARE_TITLE = '데구리 하이라이트';
    var CREATURE_NAME = { hedgehog: '고슴도치', armadillo: '아르마딜로', pillbug: '공벌레', turtle: '거북이', panda: '판다', hamster: '햄스터', pufferfish: '복어', raccoon: '너구리', rabbit: '토끼', ribbonpig: '돼지' };
    // 이유 한 줄 — 서버 reason.key → 문장. {name} 은 그 공의 주인(참가자 이름, 화면에서만) 또는 동물 이름. 단독판 jev.reason.* 그대로
    var REASON = {
        turnLast: '{name} 여기서 꼴찌로', 'turnLastBy.eagleGrab': '{name} 독수리에 잡혀 꼴찌로', 'turnLastBy.pitFall': '{name} 구덩이에 빠져 꼴찌로', 'turnLastBy.mud': '{name} 진흙에 빠져 꼴찌로',
        'turnLastBy.trip': '{name} 넘어져 꼴찌로', 'turnLastBy.nap': '{name} 졸다가 꼴찌로', 'turnLastBy.scuffle': '{name} 몸싸움 끝에 꼴찌로',
        turnFirst: '{name} 여기서 1등으로', 'turnFirstBy.eagleGrab': '선두가 독수리에 잡혀 {name} 1등으로', 'turnFirstBy.pitFall': '선두가 구덩이에 빠져 {name} 1등으로', 'turnFirstBy.mud': '선두가 진흙에 빠져 {name} 1등으로',
        'turnFirstBy.trip': '선두가 넘어져 {name} 1등으로', 'turnFirstBy.nap': '선두가 졸아서 {name} 1등으로', 'turnFirstBy.scuffle': '몸싸움 틈에 {name} 1등으로',
        lastLate: '막판 {sec}초 꼴찌 {n}번 바뀜', lastSwaps: '꼴찌 {n}번 바뀜', lastSwap: '꼴찌 바뀜',
        leadLate: '막판 {sec}초 1등 {n}번 바뀜', leadSwaps: '1등 {n}번 바뀜', leadSwap: '1등 바뀜',
        lastClose: '꼴찌 다툼 {sec}초 차', firstClose: '1등 다툼 {sec}초 차', lastNeck: '꼴찌 다툼 {sec}초 접전', firstNeck: '1등 다툼 {sec}초 접전',
        eagleGrab: '독수리 납치', eagleDrop: '독수리가 떨어뜨림', eagleMiss: '독수리 헛발질', scuffle: '구멍 앞 몸싸움', trip: '{name} 넘어짐', pit: '{name} 구덩이 빠짐',
        lastDecided: '꼴찌 결정 순간', firstDecided: '1등 결정 순간'
    };
    var BUTTON_SHOW = '<i class="mi mi-play"></i> 하이라이트 보기', BUTTON_RANKING = '<i class="mi mi-list"></i> 순위 보기';   // 상수 문자열만 innerHTML(사용자 입력 없음)

    function $(id) { return document.getElementById(id); }

    var socket = null, opts = null, els = null;
    var cur = null;        // { rid, source, arm, clip, facts, reason, status:'rendering'|'ready'|'failed', blob, url, size, timer, enc, vote, saved, autoPlayed }
    var showing = false;   // 결과 카드가 지금 하이라이트를 보여 주는 중
    var auto = null;       // 저절로 보여 주기 { st, openedAt, timer, back }
    var lockedView = null; // 바꿀 때 재 둔 { ranksH, spriteH }

    function bind() {
        if (els) return els;
        var view = $('deguriHighlightView'), row = $('deguriHighlightButtons');
        if (!view || !row) return null;
        els = { view: view, row: row, gif: $('deguriHighlightGif'), making: $('deguriHighlightMaking'), note: $('deguriHighlightNote'), up: $('deguriHighlightUp'), down: $('deguriHighlightDown'),
            button: $('deguriHighlightButton'), save: $('deguriHighlightSave'), overlay: $('resultOverlay'), card: document.querySelector('#resultOverlay .deguri-result-card'), body: $('resultRankings') };
        els.button.addEventListener('click', function () { if (!cur || !cur.clip) return; stopAuto(); show(!showing); });
        els.save.addEventListener('click', function () {
            stopAuto();
            if (!cur || !cur.blob) return;
            if (!cur.saved) { cur.saved = true; report(cur); }   // 저장도 좋은 반응으로 친다
            window.DeguriReplayGif.saveGif(cur.blob, cur.url, FILE_NAME, SHARE_TITLE);
        });
        els.up.addEventListener('click', function () { vote(1); });
        els.down.addEventListener('click', function () { vote(-1); });
        return els;
    }
    function ready() { return !!(bind() && window.DeguriRender && window.DeguriReplayGif && typeof window.DeguriReplayGif.encoder === 'function' && typeof Worker !== 'undefined'); }
    function overlayOpen() { return !!(els && els.overlay && els.overlay.classList.contains('visible')); }
    function ranksEl() { return els && els.body ? els.body.querySelector('.deguri-result-ranks') : null; }

    // 반응 보내기 — rid·👍/👎·저장만. 사실·arm 은 서버가 제 기록에서 붙인다. 실패해도 화면은 그대로
    function report(st) {
        if (!socket) return;
        socket.emit('deguri:highlight:feedback', { rid: st.rid, vote: st.vote, saved: !!st.saved }, function () { /* 무시 */ });
    }
    function vote(v) {
        stopAuto();
        if (!cur || !cur.clip) return;
        cur.vote = cur.vote === v ? null : v;
        fill(cur);
        report(cur);
    }

    function cancel() {
        if (cur) {
            if (cur.timer) clearTimeout(cur.timer);
            if (cur.enc) cur.enc.cancel();
            if (cur.url) URL.revokeObjectURL(cur.url);
        }
        cur = null;
        stopAuto();
        show(false);
        sync();
    }

    // 서버 pick 으로 시작 — 경주 기록(reveal)이 있어야 그린다(늦게 들어와 reveal 을 못 받은 사람은 못 만든다)
    function start(h) {
        if (!ready() || !h || !h.clip || !opts.reveal()) return;
        if (cur && cur.rid === h.rid) return;
        cancel();
        cur = { rid: h.rid, source: h.source, arm: h.arm, clip: h.clip, facts: h.facts, reason: h.reason, status: 'rendering', blob: null, url: null, size: null, timer: null, enc: null, vote: null, saved: false, autoPlayed: false };
        render(cur);
        sync();
    }

    // 같은 경주를 화면 밖 캔버스에 그 6초만 다시 그려 찍는다 — 화면 카메라·손으로 옮긴 자리·탭 가림과 상관없이 장면 동물을 따라간다(R.frameBalls)
    function render(st) {
        var tl = opts.reveal();
        var canvas = document.createElement('canvas');
        var R;
        try {
            R = window.DeguriRender.create(canvas, { dpr: 1 });   // GIF 는 폭 360px — 폰의 2배 밀도로 그릴 까닭이 없다(그리기 4배)
            R.setTimeline(tl, null);   // 개인 강조 없음 — GIF 는 누구 화면도 아니다
            R.setHighlight(false);
            R.frameBalls(st.clip.ids);
            R.setPhase('play');        // idle 이면 HUD 가 '출발대 대기' 문구를 찍는다 — 화면과 같은 경주 HUD 로
        } catch (err) { fail(st); return; }
        var out = document.createElement('canvas');
        out.width = OUT_W; out.height = Math.max(2, Math.round(OUT_W * canvas.height / canvas.width));
        st.size = [out.width, out.height];
        var g = out.getContext('2d', { willReadFrequently: true });
        try { st.enc = window.DeguriReplayGif.encoder(out.width, out.height); } catch (err) { fail(st); return; }
        var t = Math.max(0, st.clip.start - PREROLL_MS);
        var step = function () {
            if (cur !== st) return;
            var began = performance.now();
            try { R.render(t, FRAME_MS / 1000); } catch (err) { fail(st); return; }
            if (t >= st.clip.start) {
                g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
                g.drawImage(canvas, 0, 0, out.width, out.height);
                st.enc.frame(g.getImageData(0, 0, out.width, out.height).data.buffer, FRAME_MS / 10);
            }
            t += FRAME_MS;
            if (t <= st.clip.end) { st.timer = setTimeout(step, Math.max(RENDER_GAP_MS, (performance.now() - began) * 2)); return; }
            st.timer = null;
            st.enc.finish().then(function (blob) {
                if (cur !== st) return;
                st.enc = null; st.blob = blob; st.url = URL.createObjectURL(blob); st.status = 'ready';
                if (showing) fill(st);
                sync();
                tryAuto();
            }, function () { if (cur === st) fail(st); });
        };
        step();
    }
    function fail(st) {
        st.status = 'failed';
        if (st.enc) { try { st.enc.cancel(); } catch (e) { /* 무음 */ } st.enc = null; }
        show(false);
        sync();
    }

    // 이유 한 줄 — 가장 큰 사실 하나만 짧게. {name} = 그 공의 주인(결과 카드 이름처럼 줄여서) 또는 동물 이름
    function reasonText(st) {
        var r = st.reason;
        if (!r || !REASON[r.key]) return '';
        var tl = opts.reveal(), b = null;
        if (r.ball != null && tl && tl.balls) for (var i = 0; i < tl.balls.length; i++) if (tl.balls[i].id === r.ball) { b = tl.balls[i]; break; }
        var params = {};
        Object.keys(r.params || {}).forEach(function (k) { params[k] = r.params[k]; });
        if (b && r.owner) params.name = opts.shortName(String(b.owner || ''));
        else if (b) params.name = CREATURE_NAME[b.creature] || b.creature;
        return REASON[r.key].replace(/\{(\w+)\}/g, function (m, k) { return params[k] != null ? String(params[k]) : ''; }).replace(/\s+/g, ' ').trim();
    }

    // 하이라이트 판 채우기 — 'Jev' 표(Jev 가 고른 때만)와 이유 한 줄, 다 만들었으면 GIF
    function fill(st) {
        els.note.textContent = '';
        if (st.source === 'jev') { var badge = document.createElement('span'); badge.className = 'deguri-highlight__badge'; badge.textContent = 'Jev'; els.note.appendChild(badge); }
        els.note.appendChild(document.createTextNode(reasonText(st)));
        var isReady = st.status === 'ready';
        if (isReady && String(els.gif.getAttribute('src') || '').split('#')[0] !== st.url) els.gif.setAttribute('src', st.url);
        els.gif.hidden = !isReady;
        els.making.hidden = isReady;
        els.save.disabled = !isReady;
        els.up.setAttribute('aria-pressed', st.vote === 1 ? 'true' : 'false');
        els.down.setAttribute('aria-pressed', st.vote === -1 ? 'true' : 'false');
    }

    // 순위 ↔ 하이라이트. 처음 바꿀 때 카드 높이를 지금 높이로 묶어 카드 크기가 그대로이고, 순위 목록 자리가 GIF 보다 좁으면 머리의 당첨 동물 그림을 접어(.is-compact) 그만큼 더 쓴다
    function show(on) {
        if (!els) return;
        showing = !!on && !!cur && !!cur.clip;
        var ranks = ranksEl();
        if (showing) {
            if (!els.card.style.height) els.card.style.height = els.card.getBoundingClientRect().height + 'px';
            if (!lockedView) {   // 순위 목록이 보일 때 한 번 잰다(숨긴 뒤엔 0) — 그 자리 크기가 GIF 판의 크기
                var sprite = els.body.querySelector('.deguri-result-sprite'), rr = ranks ? ranks.getBoundingClientRect() : null;
                lockedView = { ranksH: rr ? rr.height : 0, ranksW: rr ? rr.width : els.card.clientWidth, spriteH: sprite ? sprite.getBoundingClientRect().height + 6 : 0 };
            }
            var want = lockedView.ranksW * (cur.size ? cur.size[1] / cur.size[0] : 0.72) + 44;   // GIF 높이(판 폭 기준) + 이유 줄
            var compact = lockedView.spriteH > 0 && lockedView.ranksH < want * 0.9;
            els.card.classList.toggle('is-compact', compact);
            els.view.style.height = Math.max(120, Math.round(lockedView.ranksH + (compact ? lockedView.spriteH : 0))) + 'px';
        } else {
            els.card.classList.remove('is-compact');
            els.view.style.height = '';
        }
        if (ranks) ranks.hidden = showing;
        els.view.hidden = !showing;
        els.save.hidden = !showing;
        els.button.setAttribute('aria-pressed', showing ? 'true' : 'false');
        if (showing) fill(cur);
        sync();
    }

    // 버튼 줄 — 다 만들었거나 만드는 중이면 보이고, 못 만들었으면 숨긴다
    function sync() {
        if (!els) return;
        var on = !!(cur && cur.status !== 'failed');
        els.row.hidden = !on;
        if (on) els.button.innerHTML = showing ? BUTTON_RANKING : BUTTON_SHOW;
    }

    // 저절로 한 번 — 카드가 열리고 AUTO_DELAY_MS 뒤(GIF 가 덜 됐으면 다 되는 대로, 열린 뒤 AUTO_WAIT_MS 까지) 하이라이트로 바꿔 처음부터 한 바퀴 보여 주고 순위로.
    // 판마다 한 번(다시 보기 뒤 다시 열려도 또 하지 않는다). 그사이 하이라이트·저장·👍/👎를 누르거나 카드를 닫으면 그만둔다
    function stopAuto() {
        if (!auto) return;
        clearTimeout(auto.timer); clearTimeout(auto.back);
        auto = null;
    }
    function tryAuto() {
        var a = auto;
        if (!a || a.timer || a.back || cur !== a.st || !overlayOpen() || showing) return;
        if (Date.now() - a.openedAt > AUTO_WAIT_MS) { stopAuto(); return; }
        if (a.st.status !== 'ready' || !a.st.clip) return;
        a.st.autoPlayed = true;
        show(true);
        if (!showing) { stopAuto(); return; }
        els.gif.setAttribute('src', a.st.url + '#auto');   // 처음 장면부터 다시
        a.back = setTimeout(function () { if (auto === a) { auto = null; if (showing) show(false); } }, CLIP_MS + AUTO_BACK_EXTRA_MS);
    }
    function onResultOpen() {
        if (!bind()) return;
        lockedView = null;
        sync();
        if (!cur || cur.autoPlayed || auto) return;
        var a = auto = { st: cur, openedAt: Date.now(), timer: null, back: null };
        a.timer = setTimeout(function () { a.timer = null; tryAuto(); }, AUTO_DELAY_MS);
    }
    function onResultClose() {
        if (!bind()) return;
        stopAuto();
        show(false);
        els.card.style.height = '';
        lockedView = null;
    }

    window.DeguriHighlight = {
        // js/deguri.js 가 소켓을 만든 뒤 한 번. o = { reveal() → deguriState.reveal, me() → currentUser, shortName(name) }
        connect: function (sock, o) {
            socket = sock; opts = o;
            sock.on('deguri:highlight', function (h) { start(h); });
        },
        onReveal: function () { cancel(); },                       // 새 경주 — 지난 하이라이트는 버린다
        onGameEnd: function (data) { if (data && data.highlight && !cur) start(data.highlight); },   // 경주 중 못 받았으면 결과 뒤에라도
        cancel: cancel,
        onResultOpen: onResultOpen,
        onResultClose: onResultClose,
        sync: sync,
        debug: function () { return cur ? { rid: cur.rid, source: cur.source, arm: cur.arm, status: cur.status, size: cur.size, bytes: cur.blob ? cur.blob.size : 0, showing: showing, auto: !!auto, autoPlayed: cur.autoPlayed, vote: cur.vote, saved: cur.saved, clip: cur.clip } : null; }   // 테스트용(읽기 전용)
    };
})();
