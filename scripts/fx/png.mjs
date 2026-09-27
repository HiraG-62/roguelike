// PNG の書き出し・読み込みと寸法の読み取り（依存なし。Node 標準の zlib だけ）
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** IHDR: 8bit / RGBA（色の型 6）/ 圧縮 0 / フィルタ 0 / インターレースなし */
const BIT_DEPTH = 8;
const COLOR_RGBA = 6;
const CHANNELS = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * RGBA の画素列（width * height * 4）を PNG にする。行ごとのフィルタは「なし」で固定し、
 * 同じ入力から常に同じバイト列を出す（生成物の差分を安定させる）
 */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = BIT_DEPTH;
  ihdr[9] = COLOR_RGBA;
  const stride = width * CHANNELS;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/** PNG の寸法（IHDR）だけを読む。PNG でなければ null */
export function readPngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 色の型ごとの 1 画素あたりのサンプル数（PNG 仕様） */
const SAMPLES_OF = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const FILTER_NONE = 0;
const FILTER_SUB = 1;
const FILTER_UP = 2;
const FILTER_AVERAGE = 3;
const FILTER_PAETH = 4;

/** Paeth 予測（PNG 仕様 9.4） */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** チャンクを順に読む（種類と本体） */
function* chunks(buf) {
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    yield { type, data: buf.subarray(pos + 8, pos + 8 + len) };
    pos += 12 + len;
    if (type === "IEND") break;
  }
}

/**
 * PNG を RGBA の画素列に展開する（Aseprite / 画像編集ソフトの書き出しを読む用）。
 * 対応: 8bit、色の型 0 / 2 / 3 / 4 / 6（グレー・RGB・パレット・グレー+α・RGBA）、tRNS、インターレースなし。
 * それ以外は例外（16bit やインターレースの PNG は書き出し側で 8bit・非インターレースにする）
 */
export function decodePng(buf) {
  const size = readPngSize(buf);
  if (!size) throw new Error("PNG ではない");
  const depth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  const samples = SAMPLES_OF[colorType];
  if (depth !== BIT_DEPTH || samples === undefined) throw new Error(`未対応の PNG（bit ${depth} / 色の型 ${colorType}）`);
  if (interlace !== 0) throw new Error("インターレースの PNG は未対応");

  const idat = [];
  let plte = null;
  let trns = null;
  for (const c of chunks(buf)) {
    if (c.type === "IDAT") idat.push(c.data);
    else if (c.type === "PLTE") plte = c.data;
    else if (c.type === "tRNS") trns = c.data;
  }
  const { width, height } = size;
  const stride = width * samples;
  const raw = inflateSync(Buffer.concat(idat));
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  const rgba = new Uint8Array(width * height * CHANNELS);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= samples ? line[i - samples] : 0;
      const b = prev[i];
      const c = i >= samples ? prev[i - samples] : 0;
      let v = src[i];
      if (filter === FILTER_SUB) v += a;
      else if (filter === FILTER_UP) v += b;
      else if (filter === FILTER_AVERAGE) v += (a + b) >> 1;
      else if (filter === FILTER_PAETH) v += paeth(a, b, c);
      else if (filter !== FILTER_NONE) throw new Error(`未知のフィルタ ${filter}`);
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * CHANNELS;
      const s = x * samples;
      if (colorType === 6) {
        rgba.set(line.subarray(s, s + 4), o);
      } else if (colorType === 2) {
        rgba[o] = line[s];
        rgba[o + 1] = line[s + 1];
        rgba[o + 2] = line[s + 2];
        const transparentKey = trns && trns.length >= 6 && line[s] === trns[1] && line[s + 1] === trns[3] && line[s + 2] === trns[5];
        rgba[o + 3] = transparentKey ? 0 : 255;
      } else if (colorType === 3) {
        const idx = line[s];
        if (!plte) throw new Error("PLTE の無いパレット PNG");
        rgba[o] = plte[idx * 3];
        rgba[o + 1] = plte[idx * 3 + 1];
        rgba[o + 2] = plte[idx * 3 + 2];
        rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else {
        // グレー（0 / 4）
        rgba[o] = rgba[o + 1] = rgba[o + 2] = line[s];
        rgba[o + 3] = colorType === 4 ? line[s + 1] : 255;
      }
    }
    line.copy(prev);
  }
  return { width, height, rgba };
}
