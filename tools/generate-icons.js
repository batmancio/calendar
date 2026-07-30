#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * Dependency-free PNG icon generator for the Chronos/Planner PWA.
 * Uses ONLY Node built-ins: fs, zlib, Buffer/Uint8Array.
 *
 * Reproduces the brand glyph currently embedded as an inline SVG data-URI
 * in manifest.json:
 *   - dark rounded-rect "calendar" body (fill #111827, stroke indigo #6366f1)
 *   - two short vertical indigo "ring" ticks near the top
 *   - three colored dots in a row (red #ff4757, orange #ffa502, green #2ed573)
 *
 * Outputs:
 *   icons/icon-192.png              (192x192, ~70% centered glyph)
 *   icons/icon-512.png              (512x512, ~70% centered glyph)
 *   icons/icon-maskable-512.png     (512x512, glyph fit inside 80%-diameter
 *                                    safe-zone circle, background edge-to-edge)
 *
 * No npm packages are used (no canvas/sharp/pngjs/etc). PNG encoding is
 * hand-rolled: raw RGBA scanlines (filter type 0 per row) are compressed
 * once with zlib.deflateSync() to form the single IDAT chunk, and a
 * table-based CRC32 is implemented from scratch for chunk checksums.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// Brand palette
// ---------------------------------------------------------------------------

const COLOR_BG = [0x11, 0x18, 0x27, 255];      // #111827
const COLOR_INDIGO = [0x63, 0x66, 0xf1, 255];  // #6366f1
const COLOR_RED = [0xff, 0x47, 0x57, 255];     // #ff4757
const COLOR_ORANGE = [0xff, 0xa5, 0x02, 255];  // #ffa502
const COLOR_GREEN = [0x2e, 0xd5, 0x73, 255];   // #2ed573

// ---------------------------------------------------------------------------
// Glyph geometry, expressed in the same 24x24 local coordinate space as the
// original inline SVG (viewBox="0 0 24 24"):
//   <rect x=3 y=4 width=18 height=18 rx=4 stroke-width=2 />   (calendar body)
//   <line x1=16 y1=2 x2=16 y2=6 stroke-width=2 />             (ticks)
//   <line x1=8  y1=2 x2=8  y2=6 stroke-width=2 />
//   <circle cx=8  cy=14 r=1.5 fill red />
//   <circle cx=12 cy=14 r=1.5 fill orange />
//   <circle cx=16 cy=14 r=1.5 fill green />
// ---------------------------------------------------------------------------

const VB = 24;          // local viewBox size
const VB_CENTER = 12;   // local viewBox center (x and y)

// Calendar body: rendered as a ~2-unit wide indigo stroke (outer minus inner
// rounded rect), since the original rect's fill (#111827) is identical to
// the background and would otherwise be invisible.
const BODY_OUTER = { x: 2, y: 3, w: 20, h: 20, r: 5 }; // original rect expanded by half stroke-width (1)
const BODY_INNER = { x: 4, y: 5, w: 16, h: 16, r: 3 }; // original rect inset by half stroke-width (1)

// Ticks (calendar "rings"), stroke-width 2 rectangles from y=2 to y=6.
const TICKS = [
  { x: 7, y: 2, w: 2, h: 4 },  // centered at x=8
  { x: 15, y: 2, w: 2, h: 4 }, // centered at x=16
];

// Three dots.
const DOTS = [
  { cx: 8, cy: 14, r: 1.5, color: COLOR_RED },
  { cx: 12, cy: 14, r: 1.5, color: COLOR_ORANGE },
  { cx: 16, cy: 14, r: 1.5, color: COLOR_GREEN },
];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Rounded-rect containment test. Rect spans [x, x+w] x [y, y+h] with corner
 * radius `r`. Point (px, py) is inside if, after clamping to the rect's
 * "core cross" region, the residual distance to the nearest edge/corner
 * center is within `r`.
 */
function inRoundedRect(px, py, rect) {
  const { x, y, w, h, r } = rect;
  const dx = Math.max((x + r) - px, 0, px - (x + w - r));
  const dy = Math.max((y + r) - py, 0, py - (y + h - r));
  return (dx * dx + dy * dy) <= r * r;
}

/** Axis-aligned rectangle containment test (used for the tick marks). */
function inRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/** Circle containment test. */
function inCircle(px, py, cx, cy, r) {
  const dx = px - cx;
  const dy = py - cy;
  return (dx * dx + dy * dy) <= r * r;
}

/**
 * Returns the color (RGBA array) for a point expressed in local 24x24
 * viewBox coordinates, or null if the point falls on the background.
 */
function glyphColorAt(lx, ly) {
  // Calendar body stroke: inside outer rounded rect but not inside inner one.
  if (inRoundedRect(lx, ly, BODY_OUTER) && !inRoundedRect(lx, ly, BODY_INNER)) {
    return COLOR_INDIGO;
  }
  // Ticks.
  for (const tick of TICKS) {
    if (inRect(lx, ly, tick)) return COLOR_INDIGO;
  }
  // Dots.
  for (const dot of DOTS) {
    if (inCircle(lx, ly, dot.cx, dot.cy, dot.r)) return dot.color;
  }
  return null;
}

/**
 * Computes the farthest distance (in local viewBox units) from the viewBox
 * center to any point on the glyph's outline, by sampling the extremal
 * points of each shape. Used to size the glyph for the maskable icon so it
 * fits entirely inside the platform's circular safe zone.
 */
function computeContentRadius() {
  const points = [];

  // Outer rounded-rect corners (worst case for a rounded rect is the
  // straight corner point itself, which is a safe over-estimate of the
  // true rounded corner).
  const { x, y, w, h } = BODY_OUTER;
  points.push([x, y], [x + w, y], [x, y + h], [x + w, y + h]);

  // Tick corners.
  for (const tick of TICKS) {
    points.push([tick.x, tick.y], [tick.x + tick.w, tick.y]);
    points.push([tick.x, tick.y + tick.h], [tick.x + tick.w, tick.y + tick.h]);
  }

  // Dot extents.
  for (const dot of DOTS) {
    points.push([dot.cx - dot.r, dot.cy - dot.r], [dot.cx + dot.r, dot.cy + dot.r]);
    points.push([dot.cx + dot.r, dot.cy - dot.r], [dot.cx - dot.r, dot.cy + dot.r]);
  }

  let maxDist = 0;
  for (const [px, py] of points) {
    const dx = px - VB_CENTER;
    const dy = py - VB_CENTER;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) maxDist = dist;
  }
  return maxDist;
}

// ---------------------------------------------------------------------------
// Raster generation
// ---------------------------------------------------------------------------

/**
 * Renders one icon variant into a fresh RGBA buffer.
 *
 * @param {number} size    canvas size N (square, N x N)
 * @param {number} scale   local-viewBox-units -> canvas-pixel scale factor
 * @returns {Uint8Array}   RGBA pixel buffer, length size*size*4
 */
function renderIcon(size, scale) {
  const pixels = new Uint8Array(size * size * 4);
  const center = size / 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Map canvas pixel (sampled at its center) back into local viewBox
      // coordinates.
      const lx = VB_CENTER + ((px + 0.5) - center) / scale;
      const ly = VB_CENTER + ((py + 0.5) - center) / scale;

      const glyph = glyphColorAt(lx, ly);
      const color = glyph || COLOR_BG;

      const offset = (py * size + px) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }

  return pixels;
}

// ---------------------------------------------------------------------------
// CRC32 (hand-rolled, polynomial 0xEDB88320, table-based)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function buildChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii'); // 4 ASCII bytes
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function buildIHDR(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;  // bit depth
  data[9] = 6;  // color type: RGBA (truecolor + alpha)
  data[10] = 0; // compression method
  data[11] = 0; // filter method
  data[12] = 0; // interlace method
  return buildChunk('IHDR', data);
}

/**
 * Encodes an RGBA pixel buffer as a complete PNG file buffer.
 * @param {Uint8Array} pixels RGBA buffer, length width*height*4
 */
function encodePNG(width, height, pixels) {
  // Raw scanlines: each row is prefixed with a filter-type byte (0 = none).
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row++) {
    const srcStart = row * rowBytes;
    const dstStart = row * (rowBytes + 1);
    raw[dstStart] = 0; // filter type: none
    Buffer.from(pixels.buffer, pixels.byteOffset + srcStart, rowBytes)
      .copy(raw, dstStart + 1);
  }

  const compressed = zlib.deflateSync(raw);

  const ihdr = buildIHDR(width, height);
  const idat = buildChunk('IDAT', compressed);
  const iend = buildChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}

// ---------------------------------------------------------------------------
// Structural verification (round-trips the PNG we just wrote: parses IHDR,
// re-inflates IDAT, checks the decompressed scanline byte count).
// ---------------------------------------------------------------------------

function verifyPNG(filePath, expectedWidth, expectedHeight) {
  const buf = fs.readFileSync(filePath);

  const sigOk = PNG_SIGNATURE.equals(buf.subarray(0, 8));
  if (!sigOk) {
    return { ok: false, reason: 'bad PNG signature' };
  }

  let offset = 8;
  let width = null;
  let height = null;
  const idatChunks = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = buf.subarray(dataStart, dataStart + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    }

    offset = dataStart + length + 4; // skip CRC
    if (type === 'IEND') break;
  }

  if (width !== expectedWidth || height !== expectedHeight) {
    return { ok: false, reason: `IHDR size mismatch: got ${width}x${height}, expected ${expectedWidth}x${expectedHeight}` };
  }

  const compressed = Buffer.concat(idatChunks);
  const raw = zlib.inflateSync(compressed);
  const expectedLength = height * (1 + width * 4);

  if (raw.length !== expectedLength) {
    return { ok: false, reason: `decompressed length mismatch: got ${raw.length}, expected ${expectedLength}` };
  }

  return { ok: true, width, height, decompressedLength: raw.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const iconsDir = path.join(__dirname, '..', 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });

  const contentRadius = computeContentRadius(); // local viewBox units

  const targets = [
    {
      name: 'icon-192.png',
      size: 192,
      // Glyph occupies the middle ~70% of the canvas, centered.
      scale: (192 * 0.7) / VB,
    },
    {
      name: 'icon-512.png',
      size: 512,
      scale: (512 * 0.7) / VB,
    },
    {
      name: 'icon-maskable-512.png',
      size: 512,
      // Maskable safe zone: entire glyph must fit inside a centered circle
      // of diameter 80% of the icon size (>= 10% padding on every side).
      // Background still fills the full canvas edge-to-edge.
      scale: (512 * 0.4) / contentRadius,
    },
  ];

  const results = [];

  for (const target of targets) {
    const pixels = renderIcon(target.size, target.scale);
    const png = encodePNG(target.size, target.size, pixels);
    const filePath = path.join(iconsDir, target.name);
    fs.writeFileSync(filePath, png);

    const verification = verifyPNG(filePath, target.size, target.size);
    const stat = fs.statSync(filePath);

    results.push({
      name: target.name,
      path: filePath,
      bytes: stat.size,
      verification,
    });
  }

  console.log('Generated PWA icons:\n');
  for (const r of results) {
    const status = r.verification.ok ? 'OK' : `FAILED (${r.verification.reason})`;
    console.log(`  ${r.name}: ${r.bytes} bytes -- structural verification: ${status}`);
  }

  const allOk = results.every((r) => r.verification.ok);
  if (!allOk) {
    process.exitCode = 1;
  }
}

main();
