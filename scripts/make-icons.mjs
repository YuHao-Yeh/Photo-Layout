// Generates the app icons as PNG without any image library: a white sheet of
// paper holding three photo tiles on a blue background.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

// Rectangles in a 0..1 square: [x, y, w, h, rgb]
const SHAPES = [
  [0, 0, 1, 1, [0x1f, 0x6f, 0xeb]],
  [0.25, 0.18, 0.5, 0.64, [0xff, 0xff, 0xff]],
  [0.29, 0.22, 0.42, 0.3, [0xf5, 0xa5, 0x24]],
  [0.29, 0.54, 0.2, 0.24, [0x2b, 0xb6, 0x73]],
  [0.51, 0.54, 0.2, 0.24, [0xe5, 0x48, 0x4d]],
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function renderPng(size) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size); // filter byte 0 on each row
  for (const [x, y, w, h, rgb] of SHAPES) {
    const x0 = Math.round(x * size);
    const x1 = Math.round((x + w) * size);
    const y0 = Math.round(y * size);
    const y1 = Math.round((y + h) * size);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) raw.set(rgb, py * row + 1 + px * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderSvg() {
  const rects = SHAPES.map(([x, y, w, h, [r, g, b]], i) =>
    `<rect x="${x * 100}" y="${y * 100}" width="${w * 100}" height="${h * 100}"${i === 0 ? ' rx="22"' : ''} fill="rgb(${r},${g},${b})"/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${rects.join('')}</svg>\n`;
}

writeFileSync(join(outDir, 'icon-192.png'), renderPng(192));
writeFileSync(join(outDir, 'icon-512.png'), renderPng(512));
writeFileSync(join(outDir, 'apple-touch-icon.png'), renderPng(180));
writeFileSync(join(outDir, 'icon.svg'), renderSvg());
console.log(`Icons written to ${outDir}`);
