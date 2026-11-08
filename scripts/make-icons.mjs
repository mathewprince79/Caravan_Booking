// Generates the PWA icons as PNGs using only Node built-ins.
// Run with: npm run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/icons');

const TEAL = [15, 118, 110];
const WHITE = [255, 255, 255];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(size, sample) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = sample(x, y);
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inRoundedRect(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(y, y0 + radius), y1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

function inCircle(x, y, cx, cy, radius) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

/** Colour at a normalized point. `scale` < 1 shrinks the drawing (maskable safe zone). */
function shade(nx, ny, scale) {
  const x = 0.5 + (nx - 0.5) / scale;
  const y = 0.5 + (ny - 0.5) / scale;

  if (inRoundedRect(x, y, 0.21, 0.34, 0.79, 0.62, 0.055)) {
    // window
    if (inRoundedRect(x, y, 0.52, 0.4, 0.7, 0.5, 0.025)) return TEAL;
    return WHITE;
  }
  // tow bar
  if (inRoundedRect(x, y, 0.12, 0.46, 0.22, 0.5, 0.02)) return WHITE;
  // wheels
  if (inCircle(x, y, 0.33, 0.665, 0.085) || inCircle(x, y, 0.67, 0.665, 0.085)) {
    const inner = inCircle(x, y, 0.33, 0.665, 0.032) || inCircle(x, y, 0.67, 0.665, 0.032);
    return inner ? TEAL : WHITE;
  }
  return TEAL;
}

function makeIcon(size, scale = 1) {
  return encodePng(size, (px, py) => {
    // 2x2 supersampling for smooth edges.
    let r = 0;
    let g = 0;
    let b = 0;
    const samples = [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ];
    for (const [dx, dy] of samples) {
      const [rr, gg, bb] = shade((px + dx) / size, (py + dy) / size, scale);
      r += rr;
      g += gg;
      b += bb;
    }
    return [Math.round(r / 4), Math.round(g / 4), Math.round(b / 4)];
  });
}

mkdirSync(outDir, { recursive: true });
for (const [name, size, scale] of [
  ['icon-180.png', 180, 1],
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['maskable-512.png', 512, 0.78],
]) {
  writeFileSync(resolve(outDir, name), makeIcon(size, scale));
  console.log(`wrote public/icons/${name}`);
}
