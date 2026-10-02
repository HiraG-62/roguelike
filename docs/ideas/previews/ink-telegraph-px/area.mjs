// 範囲の予告を墨で塗る見本（A 案の筆致 + 面の塗り）
import { readFileSync, writeFileSync } from "node:fs";
import { Canvas, Frame, clamp01, decodePng, encodePng, hash2, hex, inkify, paint, tile, valueNoise } from "./lib.mjs";
const SHOTS = "/tmp/claude-0/shots/";
const TELE = JSON.parse(readFileSync("/home/user/roguelike/src/data/balance/feel/TELEGRAPH.json", "utf8"));
const SUMI = ["#8a8f9c", "#5f6472", "#363b4a", "#1c1e26", "#0c0d10", "#000000", "#000000"];
const GOFUN = TELE.gofunColor, SHU = hex(TELE.shuColor), SHU_L = hex(TELE.shuLightColor);
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

function pathOf(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum, len: cum[cum.length - 1] }; }
function nearest(p, x, y) {
  let best = 1e9, bs = 0;
  for (let i = 1; i < p.pts.length; i++) {
    const [ax, ay] = p.pts[i - 1], [bx, by] = p.pts[i]; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? clamp01(((x - ax) * dx + (y - ay) * dy) / l2) : 0; const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) { best = d; bs = p.cum[i - 1] + Math.sqrt(l2) * t; }
  }
  return { d: best, s: bs };
}
function brushHalf(s, len, w, seed) {
  const entry = 6, tail = Math.min(52, len * 0.32); let k = 1;
  if (s < entry) k = 0.55 + 0.45 * (s / entry); else if (s < entry + 6) k = 1 + 0.4 * Math.sin(((s - entry) / 6) * Math.PI);
  if (s > len - tail) k *= 1 - 0.82 * ((s - (len - tail)) / tail);
  return (w / 2) * k * (0.9 + 0.2 * valueNoise(s, seed & 1023, 18, seed));
}
function bounds(pts, pad) { const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]); return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad }; }
function stroke(fr, pts, w, seed) {
  const p = pathOf(pts);
  paint(fr, (x, y) => { const n = nearest(p, x, y); const h = brushHalf(n.s, p.len, w, seed); if (n.d > h) return -1; const a = n.d / Math.max(h, 0.01); const dry = n.s > p.len * 0.75 ? (n.s - p.len * 0.75) / (p.len * 0.25) : 0; return clamp01(1 - 0.75 * Math.pow(a, 1.6) - 0.35 * dry); }, { bounds: bounds(pts, w + 4), samples: 3 });
}
function sketchStroke(fr, pts, w, seed) {
  const p = pathOf(pts); const lv = new Frame(fr.w, fr.h, 0, 1); lv.cx = 0; lv.cy = 0;
  paint(lv, (x, y) => { const n = nearest(p, x, y); const h = brushHalf(n.s, p.len, w, seed); if (n.d > h) return -1; const a = n.d / Math.max(h, 0.01); const lane = Math.floor(a * 3); const seg = Math.floor((n.s + hash2(lane, 3, seed) * 10) / 10); if (hash2(lane, seg, seed) < 0.25) return -1; return a > 0.72 ? 0.05 : 0.15; }, { bounds: bounds(pts, w + 4), samples: 3 });
  checker(lv, fr);
}
function checker(lv, fr) { for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) { const l = lv.get(x, y); if (!l) continue; const edge = !lv.get(x - 1, y) || !lv.get(x + 1, y) || !lv.get(x, y - 1) || !lv.get(x, y + 1); if (!edge && ((x + y) & 1)) continue; fr.raise(x, y, l); } }
function arcPts(cx, cy, r, a0, a1, n) { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; }
function shuDot(c, x, y, r) { for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r + 0.5) c.dot(Math.round(x + dx), Math.round(y + dy), SHU); c.dot(Math.round(x - r * 0.4), Math.round(y - r * 0.4), SHU_L); }

/** 範囲の内側の判定: { inside(x,y) → 0..1 の「縁からの深さ」（縁 0・奥 1）か -1, along(x,y) 掃き目の向きの座標, b 外接 } */
function ringArea(cx, cy, r) { return { b: { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }, depth: (x, y) => { const d = Math.hypot(x - cx, y - cy); return d > r ? -1 : (r - d) / r; }, across: (x, y) => Math.hypot(x - cx, y - cy), along: (x, y) => Math.atan2(y - cy, x - cx) * r }; }
function fanArea(cx, cy, r, base, half) { return { b: { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }, depth: (x, y) => { const d = Math.hypot(x - cx, y - cy); let a = Math.atan2(y - cy, x - cx) - base; a = Math.atan2(Math.sin(a), Math.cos(a)); if (d > r || Math.abs(a) > half) return -1; const edgeArc = (r - d) / r; const edgeSide = (Math.sin(half - Math.abs(a)) * d) / r; return Math.min(edgeArc, edgeSide * 2.2); }, across: (x, y) => Math.hypot(x - cx, y - cy), along: (x, y) => Math.atan2(y - cy, x - cx) * r }; }

/** 面の塗り方 3 案。level を返す（0 = 塗らない） */
const FILLS = {
  // 1. 墨の面（むら）: 内側を濃墨のむらで塗り、むらの薄い所だけ床が透ける
  mura: (x, y, a, seed) => {
    const n = valueNoise(x, y, 14, seed) * 0.6 + valueNoise(x, y, 5, seed ^ 7) * 0.4;
    const dens = 0.42 + 0.35 * n + 0.25 * (1 - Math.min(1, a.dep * 3)); // 縁ほど濃い
    if (bayer(x, y) > dens) return 0;
    return n > 0.55 ? 6 : n > 0.4 ? 5 : 4;
  },
  // 2. 掃き目: 面を太い筆で何度も掃いた掠れ。筋の間から床が見える
  hake: (x, y, a, seed) => {
    const lane = Math.floor((a.across + (valueNoise(x, y, 16, seed) - 0.5) * 6) / 3.2);
    const frac = ((a.across + (valueNoise(x, y, 16, seed) - 0.5) * 6) / 3.2) - lane;
    const seg = Math.floor((a.along + hash2(lane, 5, seed) * 14) / 14);
    const keep = hash2(lane, seg, seed);
    if (keep < 0.3 && a.dep > 0.12) return 0;
    if (frac > 0.72 && a.dep > 0.12) return 0;
    return keep > 0.75 ? 6 : keep > 0.5 ? 5 : 4;
  },
  // 3. 滲み: 縁に墨が溜まり、奥へ行くほどディザで薄くなる（縁は濃い・中は網）
  nijimi: (x, y, a, seed) => {
    const dens = 0.95 - 0.75 * Math.min(1, a.dep * 2.4) + (valueNoise(x, y, 8, seed) - 0.5) * 0.25;
    if (bayer(x, y) > dens) return 0;
    return dens > 0.7 ? 6 : dens > 0.45 ? 5 : 4;
  },
};

function fillArea(fr, area, kind, seed, sketch) {
  const { b } = area;
  for (let y = Math.floor(b.y0); y <= b.y1; y++) for (let x = Math.floor(b.x0); x <= b.x1; x++) {
    const dep = area.depth(x + 0.5, y + 0.5); if (dep < 0) continue;
    let l = FILLS[kind](x, y, { dep, across: area.across(x, y), along: area.along(x, y) }, seed);
    if (!l) continue;
    if (sketch) { if ((x + y) & 1) continue; l = l >= 6 ? 2 : 1; }
    fr.raise(x, y, l);
  }
}

async function render(bgName, kind, haloOn = true) {
  const c = new Canvas(decodePng(readFileSync(SHOTS + bgName + ".png")));
  const SRC = { x: 925, y: 290, w: 75, h: 60 };
  const O = { ring: [610, 360], fan: [330, 170], line: [250, 330], sRing: [700, 120], sFan: [560, 230] };
  if (bgName === "d3-cave") for (const [x, y] of Object.values(O)) c.copy(SRC.x, SRC.y, SRC.w, SRC.h, x * 2 - 37, y * 2 - 35);
  const P = [482, 262];
  const ink = new Frame(960, 540, 0, 1); ink.cx = 0; ink.cy = 0;
  const fill = new Frame(960, 540, 0, 1); fill.cx = 0; fill.cy = 0;
  const sk = new Frame(960, 540, 0, 1); sk.cx = 0; sk.cy = 0;
  const shu = [];
  // 墨入れの輪（自分を含む）: 半径 40 論理 px
  { const [ox, oy] = [P[0] + 60, P[1] + 40]; const R = 80; fillArea(fill, ringArea(ox, oy, R), kind, 11, false); stroke(ink, arcPts(ox, oy, R, -2.2, -2.2 + Math.PI * 2 * 0.97, 60), Math.min(12, R * 0.2), 51); shu.push([ox + Math.cos(-2.2) * R, oy + Math.sin(-2.2) * R, 4.6]); }
  // 墨入れの扇
  { const [ox, oy] = O.fan; const base = Math.atan2(P[1] - oy, P[0] - ox); const R = 110, half = (32 * Math.PI) / 180; fillArea(fill, fanArea(ox, oy, R, base, half), kind, 23, false); stroke(ink, [[ox, oy], ...arcPts(ox, oy, R, base - half, base + half, 24), [ox, oy]], Math.min(12, R * 0.2), 37); shu.push([ox + Math.cos(base - half) * 6, oy + Math.sin(base - half) * 6, 4.6]); }
  // 墨入れの線
  { const [ox, oy] = O.line; const a = -0.25; const L = 140; const s = [ox + Math.cos(a) * 10, oy + Math.sin(a) * 10]; stroke(ink, [s, [s[0] + Math.cos(a) * L, s[1] + Math.sin(a) * L]], 12, 11); shu.push([s[0] + Math.cos(a) * 5.6, s[1] + Math.sin(a) * 5.6, 4.6], [s[0] + Math.cos(a) * L, s[1] + Math.sin(a) * L, 3]); }
  // 下絵の輪・扇
  { const [ox, oy] = O.sRing; const R = 60; fillArea(sk, ringArea(ox, oy, R), kind, 31, true); sketchStroke(sk, arcPts(ox, oy, R, 0.3, 0.3 + Math.PI * 2 * 0.97, 60), 12, 41); }
  { const [ox, oy] = O.sFan; const base = Math.atan2(P[1] - oy, P[0] - ox) + 0.6; const R = 90, half = (28 * Math.PI) / 180; fillArea(sk, fanArea(ox, oy, R, base, half), kind, 43, true); sketchStroke(sk, [[ox, oy], ...arcPts(ox, oy, R, base - half, base + half, 24), [ox, oy]], 12, 47); }
  inkify(ink, 0x51ed, 7);
  // 自分の体の上は抜く（今の描画と同じ）
  for (const f of [ink, fill, sk]) for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) if (x * x + y * y <= 196) f.set(P[0] + x, P[1] + y - 4, 0);
  c.frame(sk, 0, 0, SUMI, null, 0.9);
  c.frame(fill, 0, 0, SUMI, null, 0.85);
  c.frame(ink, 0, 0, SUMI, haloOn ? { color: GOFUN, alpha: 0.3, r: 1 } : null);
  for (const [x, y, r] of shu) shuDot(c, x, y, r);
  return c;
}
for (const kind of Object.keys(FILLS)) {
  const cave = await render("d3-cave", kind), gl = await render("d13-glacier", kind);
  const t = tile([[cave.zoom(300, 120, 1260, 760, 1)], [gl.zoom(300, 120, 1260, 760, 1)]]);
  writeFileSync(`area-${kind}.png`, encodePng(t.w, t.h, t.px));
  const z = cave.zoom(820, 300, 640, 420, 2);
  writeFileSync(`area-${kind}-zoom.png`, encodePng(z.w, z.h, z.px));
  console.log(kind);
}
