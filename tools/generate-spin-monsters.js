// Dev tool (NOT server code) — procedurally generate monsters-base.png for spin-arena.
// Mirrors players-base.png format: 512x128, grid 4x1, cell 128x128, anchor (64,64), baseline y~64.
// Fixed menacing dark/red monster (no runtime tint, unlike players). Built-in zlib only — no image deps.
// Run: node tools/generate-spin-monsters.js  → writes assets/spin-arena/sprites/monsters-base.png
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 512, H = 128, COLS = 4, CELL = 128;
const buf = new Uint8ClampedArray(W * H * 4); // RGBA, transparent

function px(x, y, r, g, b, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    const sa = a / 255, da = buf[i + 3] / 255, oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    buf[i]     = (r * sa + buf[i]     * da * (1 - sa)) / oa;
    buf[i + 1] = (g * sa + buf[i + 1] * da * (1 - sa)) / oa;
    buf[i + 2] = (b * sa + buf[i + 2] * da * (1 - sa)) / oa;
    buf[i + 3] = oa * 255;
}
function fillEllipse(cx, cy, rx, ry, col) {
    const [r, g, b, a] = col;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const nx = (x - cx) / rx, ny = (y - cy) / ry;
            const d = nx * nx + ny * ny;
            if (d <= 1) {
                // soft edge over outer 12%
                const edge = d > 0.88 ? (1 - d) / 0.12 : 1;
                px(x, y, r, g, b, a * Math.max(0, Math.min(1, edge)));
            }
        }
    }
}
function fillTri(ax, ay, bx, by, cx, cy, col) {
    const [r, g, b, a] = col;
    const minX = Math.floor(Math.min(ax, bx, cx)), maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy)), maxY = Math.ceil(Math.max(ay, by, cy));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area === 0) return;
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const w0 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / area;
            const w1 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 >= 0 && w1 >= 0 && w2 >= 0) px(x, y, r, g, b, a);
        }
    }
}

// palette (dark/red, menacing — distinct from blue-dominant players)
const OUTLINE = [26, 8, 14, 255];     // near-black maroon
const BODY    = [74, 18, 34, 255];    // dark maroon
const BELLY   = [120, 30, 50, 255];   // lighter belly
const HORN    = [40, 18, 28, 255];    // dark horn
const EYE_GLOW = [255, 120, 40, 230]; // orange glow
const EYE_CORE = [255, 235, 130, 255];// bright core
const TOOTH   = [235, 220, 210, 255];

function drawMonster(ox, frame) {
    // idle: subtle bob + eye pulse, no positional drift (anchor stable)
    const bob = [0, -1.5, 0, 1.5][frame];
    const glowA = [210, 255, 230, 200][frame];
    const cx = ox + 64;
    const bodyCy = 72 + bob;       // body center; feet baseline ~ y=64 anchor plane sits mid-lower
    // back spikes (silhouette menace)
    for (let k = -1; k <= 1; k++) {
        fillTri(cx + k * 18, bodyCy - 24, cx + k * 18 - 7, bodyCy - 6, cx + k * 18 + 7, bodyCy - 6, HORN);
    }
    // horns
    fillTri(cx - 22, bodyCy - 18, cx - 30, bodyCy - 44, cx - 12, bodyCy - 20, HORN);
    fillTri(cx + 22, bodyCy - 18, cx + 30, bodyCy - 44, cx + 12, bodyCy - 20, HORN);
    // outline (slightly bigger body behind)
    fillEllipse(cx, bodyCy, 38, 34, OUTLINE);
    // body
    fillEllipse(cx, bodyCy, 34, 30, BODY);
    // belly highlight
    fillEllipse(cx, bodyCy + 8, 22, 17, BELLY);
    // feet (two stubby)
    fillEllipse(cx - 16, bodyCy + 26, 10, 8, OUTLINE);
    fillEllipse(cx + 16, bodyCy + 26, 10, 8, OUTLINE);
    fillEllipse(cx - 16, bodyCy + 25, 8, 6, BODY);
    fillEllipse(cx + 16, bodyCy + 25, 8, 6, BODY);
    // eyes: glow then core (angry, slanted inward)
    fillEllipse(cx - 12, bodyCy - 4, 9, 7, [EYE_GLOW[0], EYE_GLOW[1], EYE_GLOW[2], glowA]);
    fillEllipse(cx + 12, bodyCy - 4, 9, 7, [EYE_GLOW[0], EYE_GLOW[1], EYE_GLOW[2], glowA]);
    fillEllipse(cx - 11, bodyCy - 3, 4.5, 4, EYE_CORE);
    fillEllipse(cx + 11, bodyCy - 3, 4.5, 4, EYE_CORE);
    // angry brows
    fillTri(cx - 20, bodyCy - 12, cx - 4, bodyCy - 6, cx - 20, bodyCy - 6, OUTLINE);
    fillTri(cx + 20, bodyCy - 12, cx + 4, bodyCy - 6, cx + 20, bodyCy - 6, OUTLINE);
    // jagged mouth with teeth
    fillEllipse(cx, bodyCy + 13, 14, 6, OUTLINE);
    for (let k = -2; k <= 2; k++) {
        fillTri(cx + k * 5, bodyCy + 10, cx + k * 5 - 2.5, bodyCy + 16, cx + k * 5 + 2.5, bodyCy + 16, TOOTH);
    }
}

for (let f = 0; f < COLS; f++) drawMonster(f * CELL, f);

// ---- minimal PNG encoder (RGBA, filter 0) ----
function crc32(b) {
    let c = ~0;
    for (let i = 0; i < b.length; i++) {
        c ^= b[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return ~c >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const body = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
// raw scanlines with filter byte 0
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    for (let x = 0; x < W * 4; x++) raw[y * (1 + W * 4) + 1 + x] = buf[y * W * 4 + x];
}
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
const out = path.join(__dirname, '..', 'assets', 'spin-arena', 'sprites', 'monsters-base.png');
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes', W + 'x' + H);
