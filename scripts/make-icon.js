// Генератор иконки Godji (кольцо cyan -> magenta) в чистом Node, без зависимостей.
// Запуск: npm run icon  ->  создаёт assets/icon.ico (256x256)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// ---- CRC32 (для PNG-чанков) ----
const crcTable = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// ---- PNG (RGBA) ----
function makePng(rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const rowLen = SIZE * 4;
  const raw = Buffer.alloc((rowLen + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (rowLen + 1)] = 0; // filter: none
    rgba.copy(raw, y * (rowLen + 1) + 1, y * rowLen, y * rowLen + rowLen);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- рисуем кольцо ----
const rgba = Buffer.alloc(SIZE * SIZE * 4);
const cx = SIZE / 2, cy = SIZE / 2;
const R_OUT = 118, R_IN = 76;
const lerp = (a, b, t) => a + (b - a) * t;
const stops = [[0, 229, 255], [0, 119, 255], [255, 0, 212], [0, 229, 255]]; // cyan -> blue -> magenta -> cyan

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx + 0.5, dy = y - cy + 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const idx = (y * SIZE + x) * 4;
    let r = 0, g = 0, b = 0, a = 0;
    if (dist <= R_OUT + 1 && dist >= R_IN - 1) {
      const ang = (Math.atan2(dy, dx) / (2 * Math.PI) + 1) % 1; // 0..1
      const seg = ang * 3; const i = Math.floor(seg); const t = seg - i;
      const s0 = stops[i], s1 = stops[i + 1];
      r = lerp(s0[0], s1[0], t); g = lerp(s0[1], s1[1], t); b = lerp(s0[2], s1[2], t); a = 255;
      if (dist > R_OUT - 1) a = Math.round(255 * Math.max(0, R_OUT + 1 - dist));      // сглаживание внешнего края
      if (dist < R_IN + 1) a = Math.round(Math.min(a, 255 * Math.max(0, dist - (R_IN - 1)))); // внутреннего
    } else if (dist < R_IN - 1) {
      r = 15; g = 15; b = 26; a = 255; // тёмный центр
    }
    rgba[idx] = r; rgba[idx + 1] = g; rgba[idx + 2] = b; rgba[idx + 3] = a;
  }
}

const png = makePng(rgba);

// ---- ICO-контейнер (один PNG 256x256) ----
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0);          // reserved
ico.writeUInt16LE(1, 2);          // type: icon
ico.writeUInt16LE(1, 4);          // count
ico[6] = 0; ico[7] = 0;           // width/height 0 => 256
ico[8] = 0; ico[9] = 0;           // color count / reserved
ico.writeUInt16LE(1, 10);         // planes
ico.writeUInt16LE(32, 12);        // bit count
ico.writeUInt32LE(png.length, 14);// bytes in resource
ico.writeUInt32LE(22, 18);        // image offset

const outDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.ico');
fs.writeFileSync(outPath, Buffer.concat([ico, png]));
console.log('✅ Иконка создана:', outPath);