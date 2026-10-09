// GIF 인코더 워커 — 다시 보기 GIF 녹화(js/deguri-replay-gif.js)가 new Worker() 로 쓴다. 의존성 없음. 데구리 단독판 3a8c02e js/gif-worker.js 를 그대로 옮겼다(인코딩 로직 동일).
// 프레임(RGBA)을 받는 대로 바로 인코딩해 조각으로 쌓아 두고(메모리에 원본 프레임을 모아 두지 않게), finish 에서 Blob 하나로 돌려준다.
// 색은 프레임마다 256색 — 채널당 5비트(32768칸) 히스토그램을 median cut 으로 나누고, 칸 → 팔레트 번호 표로 한 번에 바꾼다(디더링 없음 — 픽셀 그림이라 깔끔).
// 둘째 프레임부터는 앞 프레임과 똑같은 픽셀을 투명(255번)으로 두고 앞 그림을 남긴다 — 카메라가 멈춘 장면(결승·비석·스탠드)이 크게 준다. 풀밭 무늬 때문에 움직이는 장면은 픽셀 수만큼 커진다
// 메시지: { type:'start', w, h } → { type:'frame', buf(ArrayBuffer RGBA), delay(1/100초) } … → { type:'finish' } ⇒ { type:'done', blob }
'use strict';

var width = 0, height = 0, chunks = [], prev = null;
var CLEAR_INDEX = 255;   // 둘째 프레임부터 '앞 그림 그대로' 칸

function u16(n) { return [n & 255, (n >> 8) & 255]; }

function header(w, h) {
  var out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]   // GIF89a
    .concat(u16(w), u16(h), [0x70, 0, 0]);          // 전역 색표 없음(프레임마다 지역 색표)
  // NETSCAPE2.0 — 무한 반복
  out = out.concat([0x21, 0xFF, 0x0B], Array.from('NETSCAPE2.0').map(function (c) { return c.charCodeAt(0); }), [3, 1, 0, 0, 0]);
  return new Uint8Array(out);
}

// median cut — 쓰인 칸들을 상자로 나눠 팔레트(maxColors 이하)와 칸 → 번호 표(lut)를 만든다. same[i] 인 픽셀은 세지 않고 CLEAR_INDEX 로
function quantize(px, same, maxColors) {
  var n = px.length >> 2;
  var count = new Uint32Array(32768), sumR = new Float64Array(32768), sumG = new Float64Array(32768), sumB = new Float64Array(32768);
  var keys = new Uint16Array(n);
  for (var i = 0, p = 0; i < n; i++, p += 4) {
    if (same && same[i]) continue;
    var r = px[p], g = px[p + 1], b = px[p + 2];
    var k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    keys[i] = k; count[k]++; sumR[k] += r; sumG[k] += g; sumB[k] += b;
  }
  var used = [];
  for (var c = 0; c < 32768; c++) if (count[c]) used.push(c);
  var boxes = [{ bins: used }];
  function measure(box) {
    var lo = [31, 31, 31], hi = [0, 0, 0], total = 0;
    box.bins.forEach(function (k) {
      var v = [k >> 10, (k >> 5) & 31, k & 31];
      for (var ch = 0; ch < 3; ch++) { if (v[ch] < lo[ch]) lo[ch] = v[ch]; if (v[ch] > hi[ch]) hi[ch] = v[ch]; }
      total += count[k];
    });
    var span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    box.axis = span[0] >= span[1] && span[0] >= span[2] ? 0 : span[1] >= span[2] ? 1 : 2;
    box.score = box.bins.length > 1 ? total * (span[box.axis] + 1) : -1;
    box.total = total;
  }
  measure(boxes[0]);
  while (boxes.length < maxColors) {
    var best = -1;
    for (var bi = 0; bi < boxes.length; bi++) if (boxes[bi].score > 0 && (best < 0 || boxes[bi].score > boxes[best].score)) best = bi;
    if (best < 0) break;
    var box = boxes[best], shift = box.axis === 0 ? 10 : box.axis === 1 ? 5 : 0;
    box.bins.sort(function (a, b) { return ((a >> shift) & 31) - ((b >> shift) & 31); });
    var half = box.total / 2, acc = 0, cut = 1;
    for (var j = 0; j < box.bins.length - 1; j++) { acc += count[box.bins[j]]; if (acc >= half) { cut = j + 1; break; } cut = j + 1; }
    var a = { bins: box.bins.slice(0, cut) }, b2 = { bins: box.bins.slice(cut) };
    measure(a); measure(b2);
    boxes.splice(best, 1, a, b2);
  }
  var palette = new Uint8Array(256 * 3), lut = new Uint8Array(32768);
  boxes.forEach(function (box, idx) {
    var r = 0, g = 0, b = 0, t = 0;
    box.bins.forEach(function (k) { r += sumR[k]; g += sumG[k]; b += sumB[k]; t += count[k]; lut[k] = idx; });
    if (!t) return;   // 바뀐 픽셀이 하나도 없는 프레임
    palette[idx * 3] = Math.round(r / t); palette[idx * 3 + 1] = Math.round(g / t); palette[idx * 3 + 2] = Math.round(b / t);
  });
  var indices = new Uint8Array(n);
  for (var q = 0; q < n; q++) indices[q] = same && same[q] ? CLEAR_INDEX : lut[keys[q]];
  return { palette: palette, indices: indices };
}

// LZW(최소 코드 8비트) → 255바이트 이하 하위 블록으로 쪼갠 이미지 데이터
function lzw(indices) {
  var MIN = 8, CLEAR = 1 << MIN, EOI = CLEAR + 1;
  var bytes = [], cur = 0, shift = 0, size = MIN + 1, next = EOI + 1, table = new Map();
  function emit(code) { cur |= code << shift; shift += size; while (shift >= 8) { bytes.push(cur & 255); cur >>>= 8; shift -= 8; } }
  emit(CLEAR);
  var prefix = indices[0];
  for (var i = 1; i < indices.length; i++) {
    var k = indices[i], key = (prefix << 8) | k, code = table.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (next === 4096) { emit(CLEAR); table.clear(); next = EOI + 1; size = MIN + 1; }
    else { if (next >= (1 << size)) size++; table.set(key, next++); }
    prefix = k;
  }
  emit(prefix);
  emit(EOI);
  if (shift > 0) bytes.push(cur & 255);
  var out = new Uint8Array(1 + bytes.length + Math.ceil(bytes.length / 255) + 1);
  var o = 0;
  out[o++] = MIN;
  for (var s = 0; s < bytes.length; s += 255) {
    var len = Math.min(255, bytes.length - s);
    out[o++] = len;
    for (var m = 0; m < len; m++) out[o++] = bytes[s + m];
  }
  out[o++] = 0;
  return out.subarray(0, o);
}

function frame(px, delay) {
  var same = null;
  if (prev) {
    same = new Uint8Array(px.length >> 2);
    for (var i = 0, p = 0; i < same.length; i++, p += 4) same[i] = px[p] === prev[p] && px[p + 1] === prev[p + 1] && px[p + 2] === prev[p + 2] ? 1 : 0;
  }
  prev = px;
  var q = quantize(px, same, same ? CLEAR_INDEX : 256);
  var head = new Uint8Array([0x21, 0xF9, 4, same ? 0x05 : 0x04].concat(u16(Math.max(2, delay)), [same ? CLEAR_INDEX : 0, 0],   // 그래픽 제어: 앞 그림 남김(+투명), 지연
    [0x2C], u16(0), u16(0), u16(width), u16(height), [0x87]));                         // 이미지 서술자: 지역 색표 256색
  chunks.push(head, q.palette, lzw(q.indices));
}

self.onmessage = function (e) {
  var m = e.data;
  if (m.type === 'start') { width = m.w; height = m.h; chunks = [header(width, height)]; prev = null; }
  else if (m.type === 'frame') { frame(new Uint8Array(m.buf), m.delay); self.postMessage({ type: 'progress' }); }
  else if (m.type === 'finish') { chunks.push(new Uint8Array([0x3B])); self.postMessage({ type: 'done', blob: new Blob(chunks, { type: 'image/gif' }) }); chunks = []; prev = null; }
};
