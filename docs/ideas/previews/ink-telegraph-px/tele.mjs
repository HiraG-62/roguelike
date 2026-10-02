// 予告の線をドット絵の墨で描く見本。全部「絵のドット」（論理 0.5px = 画面 2 画素）で計算する
import { readFileSync, writeFileSync } from "node:fs";
import { Canvas, Frame, RAMPS, clamp01, decodePng, encodePng, fxFrame, hash2, hex, inkify, paint, tile, valueNoise } from "./lib.mjs";
const SHOTS = "/tmp/claude-0/shots/";
const TELE = JSON.parse(readFileSync("/home/user/roguelike/src/data/balance/feel/TELEGRAPH.json", "utf8"));
const SUMI_RAMP = ["#8a8f9c", "#5f6472", "#363b4a", "#1c1e26", "#0c0d10", "#000000", "#000000"]; // 1 の B 案と同じ（刃と同じ墨）
const GOFUN = TELE.gofunColor, SHU = hex(TELE.shuColor), SHU_L = hex(TELE.shuLightColor);

/** 折れ線（絵のドット座標）の点列と累積長 */
function pathOf(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
/** 点から折れ線への最短距離と、その位置の弧長 s */
function nearest(p, x, y) {
  let best = 1e9, bs = 0;
  for (let i = 1; i < p.pts.length; i++) {
    const [ax, ay] = p.pts[i - 1], [bx, by] = p.pts[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? clamp01(((x - ax) * dx + (y - ay) * dy) / l2) : 0;
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) { best = d; bs = p.cum[i - 1] + Math.sqrt(l2) * t; }
  }
  return { d: best, s: bs };
}
/** 筆の半幅（入りの押さえ → 墨溜まり → 胴 → 抜き）。s は弧長、len は全長、w は太さ（ドット） */
function brushHalf(s, len, w, seed) {
  const entry = 6; // 入り 3 論理 px
  const tail = Math.min(52, len * 0.32);
  let k = 1;
  if (s < entry) k = 0.55 + 0.45 * (s / entry);
  else if (s < entry + 6) k = 1 + 0.4 * Math.sin(((s - entry) / 6) * Math.PI); // 墨溜まり
  if (s > len - tail) k *= 1 - 0.82 * ((s - (len - tail)) / tail);
  // 筆圧のゆらぎ（座標ハッシュのノイズ）
  k *= 0.9 + 0.2 * valueNoise(s, seed & 1023, 18, seed);
  return (w / 2) * k;
}
/** 筆の一筆を作業面へ（段 1..7）。core = 芯の段の明るさ（1 で段 7） */
function stroke(fr, pts, w, seed, opt = {}) {
  const p = pathOf(pts);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const pad = w + 4;
  const b = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
  paint(fr, (x, y) => {
    const n = nearest(p, x, y);
    const h = brushHalf(n.s, p.len, w, seed);
    if (n.d > h) return -1;
    const across = n.d / Math.max(h, 0.01);
    // 芯ほど濃い（段が高い = 墨の配色では黒）。抜きの先は墨が尽きて淡く
    const dry = n.s > p.len * 0.75 ? (n.s - p.len * 0.75) / (p.len * 0.25) : 0;
    return clamp01((opt.core ?? 1) * (1 - (opt.fall ?? 0.35) * Math.pow(across, 1.6)) - 0.35 * dry);
  }, { bounds: b, samples: 3 });
  return p;
}
/** 下絵: 同じ筆の形を淡墨で。市松のディザで透かし、線に沿って掠れて途切れる（段は低い = 淡墨） */
function sketch(fr, pts, w, seed, gap) {
  const p = pathOf(pts);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const pad = w + 4;
  const b = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
  const lv = new Frame(fr.w, fr.h, 0, 1); lv.cx = 0; lv.cy = 0;
  paint(lv, (x, y) => {
    const n = nearest(p, x, y);
    const h = brushHalf(n.s, p.len, w, seed);
    if (n.d > h) return -1;
    const across = n.d / Math.max(h, 0.01);
    // 掠れ: 線を横切る筋（3 本）ごとに、線に沿う区切りで抜く
    const lane = Math.floor(across * 3);
    const seg = Math.floor((n.s + hash2(lane, 3, seed) * 10) / 10);
    if (hash2(lane, seg, seed) < gap) return -1;
    return across > 0.72 ? 0.05 : 0.15;
  }, { bounds: b, samples: 3 });
  // 市松に間引いて半透明に見せる（縁は残す）
  for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
    const l = lv.get(x, y); if (!l) continue;
    const edge = !lv.get(x - 1, y) || !lv.get(x + 1, y) || !lv.get(x, y - 1) || !lv.get(x, y + 1);
    if (!edge && ((x + y) & 1)) continue;
    fr.raise(x, y, l);
  }
}
/** 朱の点（円。照りを左上に 1 ドット） */
function shuDot(c, x, y, r) {
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
    if (dx * dx + dy * dy > r * r + 0.5) continue;
    c.dot(Math.round(x + dx), Math.round(y + dy), SHU);
  }
  c.dot(Math.round(x - r * 0.4), Math.round(y - r * 0.4), SHU_L);
}
function arcPts(cx, cy, r, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

const VARIANTS = {
  // A: 刃と同じ墨（縁が淡墨・芯が真っ黒・掠れ・毛羽・飛沫）+ 胡粉の 1 ドットの滲み
  A: { halo: { color: GOFUN, alpha: 0.3, r: 1 }, w: 12, fall: 0.75, sketchAlpha: 0.9, ink: true },
  // B: A と同じ筆致で、胡粉の縁を 2 ドットのくっきりした輪郭にする（暗い床で読みやすく）
  B: { halo: { color: GOFUN, alpha: 0.55, r: 2, flat: true }, w: 12, fall: 0.75, sketchAlpha: 0.9, ink: true },
  // C: 真っ黒な一筆（濃淡を付けない）+ 縁の毛羽・飛沫。滲みなし
  C: { halo: null, w: 12, fall: 0.2, sketchAlpha: 0.9, ink: true },
};

/** 1 枚を描く。bg に、墨入れ（線・扇・輪）と下絵（線・扇）、比較用の剣の振りを置く */
async function render(bgName, v) {
  const c = new Canvas(decodePng(readFileSync(SHOTS + bgName + ".png")));
  // 甲虫の絵（d3-cave の (930,35)〜(995,95)）を発生源へ写す（洞窟だけ）
  const SRC = { x: 925, y: 290, w: 75, h: 60 };
  const origins = { line: [330, 200], sketch: [330, 330], fan: [660, 150], ring: [720, 380], sketchFan: [180, 110] };
  if (bgName === "d3-cave") for (const [x, y] of Object.values(origins)) c.copy(SRC.x, SRC.y, SRC.w, SRC.h, x * 2 - 37, y * 2 - 35);
  const ink = new Frame(960, 540, 0, 1); ink.cx = 0; ink.cy = 0;
  const sk = new Frame(960, 540, 0, 1); sk.cx = 0; sk.cy = 0;
  const P = [482, 262]; // 自分
  const shuMarks = [];
  // 1. 墨入れの線: 甲虫 → 自分の方へ 70 論理 px
  {
    const [ox, oy] = origins.line; const a = Math.atan2(P[1] - oy, P[0] - ox); const L = 140;
    const s = [ox + Math.cos(a) * 10, oy + Math.sin(a) * 10];
    stroke(ink, [s, [s[0] + Math.cos(a) * L, s[1] + Math.sin(a) * L]], v.w, 11, v);
    shuMarks.push([s[0] + Math.cos(a) * 5.6, s[1] + Math.sin(a) * 5.6, 2.3 * 2], [s[0] + Math.cos(a) * L, s[1] + Math.sin(a) * L, 1.5 * 2]);
  }
  // 2. 下絵の線
  {
    const [ox, oy] = origins.sketch; const a = Math.atan2(P[1] - oy, P[0] - ox) + 0.15; const L = 140;
    const s = [ox + Math.cos(a) * 10, oy + Math.sin(a) * 10];
    sketch(sk, [s, [s[0] + Math.cos(a) * L, s[1] + Math.sin(a) * L]], v.w, 23, 0.25);
  }
  // 3. 墨入れの扇（要 → 左の辺 → 弧 → 右の辺）: 射程 45 論理 px・半角 35°
  {
    const [ox, oy] = origins.fan; const base = Math.atan2(P[1] - oy, P[0] - ox); const R = 90, half = (35 * Math.PI) / 180;
    const pts = [[ox, oy], ...arcPts(ox, oy, R, base - half, base + half, 24), [ox, oy]];
    stroke(ink, pts, Math.min(v.w, R * 0.2 * 1), 37, v);
    shuMarks.push([ox + Math.cos(base - half) * 6, oy + Math.sin(base - half) * 6, 2.3 * 2]);
  }
  // 4. 墨入れの輪: 半径 32 論理 px
  {
    const [ox, oy] = origins.ring; const R = 64;
    stroke(ink, arcPts(ox, oy, R, -2.2, -2.2 + Math.PI * 2 * 0.97, 60), Math.min(v.w, R * 0.2), 51, v);
    shuMarks.push([ox + Math.cos(-2.2) * R, oy + Math.sin(-2.2) * R, 2.3 * 2]);
  }
  // 5. 下絵の扇
  {
    const [ox, oy] = origins.sketchFan; const base = Math.atan2(P[1] - oy, P[0] - ox); const R = 90, half = (30 * Math.PI) / 180;
    sketch(sk, [[ox, oy], ...arcPts(ox, oy, R, base - half, base + half, 24), [ox, oy]], Math.min(v.w, 18), 61, 0.25);
  }
  if (v.ink) inkify(ink, 0x51ed, 7);
  c.frame(sk, 0, 0, SUMI_RAMP, null, v.sketchAlpha);
  c.frame(ink, 0, 0, SUMI_RAMP, v.halo);
  for (const [x, y, r] of shuMarks) shuDot(c, x, y, r);
  // 比較: 自分の剣の 3 段目（1 の B 案の黒）
  const fr = await fxFrame("sword", "sword.l3", 12, 3);
  c.fx(fr, 440, 262, SUMI_RAMP, RAMPS._halo.steel);
  return c;
}

const outs = {};
for (const [vk, v] of Object.entries(VARIANTS)) {
  for (const bg of ["d3-cave", "d13-glacier"]) outs[vk + bg] = await render(bg, v);
  const cave = outs[vk + "d3-cave"], gl = outs[vk + "d13-glacier"];
  const t = tile([[cave.zoom(240, 120, 1260, 720, 1)], [cave.zoom(560, 300, 630, 360, 2)]]);
  writeFileSync(`tele-${vk}.png`, encodePng(t.w, t.h, t.px));
  const t2 = tile([[gl.zoom(240, 120, 1260, 720, 1)]]);
  writeFileSync(`tele-${vk}-glacier.png`, encodePng(t2.w, t2.h, t2.px));
  console.log(vk);
}
