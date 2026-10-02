// 墨の予告の見本（ゲームのコードではない。見本の絵を作るためだけの描画）
"use strict";

const LW = 480;
const LH = 270;
const LS = 4;

// ---------------------------------------------------------------- 乱数・ノイズ
function hash(i, seed) {
  let h = Math.imul((i | 0) ^ Math.imul(seed | 0, 374761393), 668265263);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash2(x, y, seed) {
  return hash(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663), seed);
}
function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u;
}
function noise2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};

// ---------------------------------------------------------------- 床
function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function makeFloor(seed) {
  const c = document.createElement("canvas");
  c.width = LW;
  c.height = LH;
  const x = c.getContext("2d");
  const img = x.createImageData(LW, LH);
  const CELL = 9;
  const pts = new Map();
  const pt = (gx, gy) => {
    const k = gx + "," + gy;
    let p = pts.get(k);
    if (!p) {
      p = { x: (gx + 0.15 + hash2(gx, gy, seed) * 0.7) * CELL, y: (gy + 0.15 + hash2(gx, gy, seed + 1) * 0.7) * CELL, t: hash2(gx, gy, seed + 2) };
      pts.set(k, p);
    }
    return p;
  };
  const stones = ["#323a3a", "#30382f", "#2e3434", "#363d38", "#2b3130"].map(hexRgb);
  const mossStones = ["#384a2c", "#3c502e", "#344628"].map(hexRgb);
  const brightMoss = ["#46622e", "#4c6a30"].map(hexRgb);
  for (let py = 0; py < LH; py++) {
    for (let px = 0; px < LW; px++) {
      const gx = Math.floor(px / CELL);
      const gy = Math.floor(py / CELL);
      let d1 = 1e9;
      let d2 = 1e9;
      let best = null;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const p = pt(gx + ox, gy + oy);
          const d = Math.hypot(px + 0.5 - p.x, py + 0.5 - p.y);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = p;
          } else if (d < d2) d2 = d;
        }
      const edge = d2 - d1;
      const m = noise2(px / 38, py / 38, seed + 9) * 0.7 + noise2(px / 13, py / 13, seed + 11) * 0.3;
      let col;
      if (edge < 1.0) col = m > 0.61 ? hexRgb("#26331f") : hexRgb("#1f2420");
      else if (m > 0.71) col = brightMoss[Math.floor(best.t * 2)];
      else if (m > 0.61) col = mossStones[Math.floor(best.t * 3)];
      else {
        col = stones[Math.floor(best.t * 5)];
        if (edge < 2.0 && py + 0.5 < best.y - 1) col = hexRgb("#3c443e");
        else if (edge < 2.0 && py + 0.5 > best.y + 1) col = hexRgb("#282e2a");
      }
      const o = (py * LW + px) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}
function drawFloor(ctx, floor) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(floor, 0, 0, LW * LS, LH * LS);
  const g = ctx.createRadialGradient(960, 540, 400, 960, 540, 1150);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1920, 1080);
  ctx.restore();
}

// ---------------------------------------------------------------- スプライト
const SPR = {};
async function loadSprites(map) {
  for (const [k, url] of Object.entries(map)) {
    const im = new Image();
    im.src = url;
    await im.decode();
    SPR[k] = im;
  }
}
/** スプライトに 1 ドットの暗い縁を付けて置く（ゲームの見た目に寄せる） */
function drawSprite(ctx, key, cx, cy, flip = false) {
  const im = SPR[key];
  if (!im) return;
  const w = im.width;
  const h = im.height;
  ctx.save();
  ctx.setTransform(LS, 0, 0, LS, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  // 影
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(cx, y0 + h - 2, w * 0.32, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  if (flip) {
    ctx.translate(cx * 2, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(im, x0, y0);
  ctx.restore();
}

// ---------------------------------------------------------------- 形（論理座標の筆の道）
function resample(raw, step = 0.4) {
  const out = [];
  let s = 0;
  out.push({ x: raw[0][0], y: raw[0][1], s: 0 });
  let carry = 0;
  for (let i = 1; i < raw.length; i++) {
    const [ax, ay] = raw[i - 1];
    const [bx, by] = raw[i];
    const d = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= d) {
      const k = t / d;
      s += step;
      out.push({ x: ax + (bx - ax) * k, y: ay + (by - ay) * k, s });
      t += step;
    }
    carry = d - (t - step);
  }
  // 法線は前後 ±W 点の接線（折れ角でなめらかに回す）
  const W = 4;
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - W)];
    const b = out[Math.min(out.length - 1, i + W)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    out[i].tx = tx;
    out[i].ty = ty;
    out[i].nx = -ty;
    out[i].ny = tx;
  }
  return { pts: out, L: s };
}
function shapeLine(x0, y0, x1, y1) {
  return { kind: "line", ...resample([[x0, y0], [x1, y1]]) };
}
function shapeRing(cx, cy, r, a0, sweep = Math.PI * 2 * 1.03) {
  const raw = [];
  const n = Math.ceil((r * sweep) / 1.0);
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    raw.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return { kind: "ring", cx, cy, r, ...resample(raw) };
}
function shapeFan(cx, cy, r, dir, half, r0 = 7) {
  const a1 = dir - half;
  const a2 = dir + half;
  const raw = [];
  for (let k = 0; k <= 10; k++) {
    const rr = r0 + ((r - r0) * k) / 10;
    raw.push([cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr]);
  }
  const n = Math.ceil((r * (a2 - a1)) / 1.0);
  for (let i = 1; i <= n; i++) {
    const a = a1 + ((a2 - a1) * i) / n;
    raw.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  for (let k = 1; k <= 10; k++) {
    const rr = r - ((r - r0) * k) / 10;
    raw.push([cx + Math.cos(a2) * rr, cy + Math.sin(a2) * rr]);
  }
  return { kind: "fan", cx, cy, r, dir, half, ...resample(raw) };
}

/** 筆圧の形: 入りで押さえて墨溜まり → 胴 → 抜きで払う */
function profile(s, L, seed, o = {}) {
  const pool = o.pool ?? 0.4;
  const entry = 0.55 + 0.45 * smooth(0, 3, s) + pool * Math.exp(-(((s - 3) / 2.6) ** 2));
  const T = Math.min(o.tail ?? 26, L * 0.32);
  const k = clamp01((s - (L - T)) / T);
  const tail = 1 - (o.tailDrop ?? 0.82) * k * k * (3 - 2 * k);
  return entry * tail * (1 + 0.08 * Math.sin(s * 0.13 + seed));
}
function at(shape, s) {
  const pts = shape.pts;
  const i = Math.max(0, Math.min(pts.length - 1, Math.round(s / 0.4)));
  return pts[i];
}

// ---------------------------------------------------------------- 筆の部品
/**
 * 毛の束で引く（掠れ）。毛ごとに墨の量が減り、尽きたところが掠れる
 * o: W 太さ, K 本数, colors, dry, noise, overlap, u0,u1 横の範囲, sEnd 描く長さ, sFrom, alpha, wobble, prof
 */
function bristles(ctx, shape, o) {
  const r = rng(o.seed * 31 + 7);
  const L = shape.L;
  const sEnd = Math.min(L, o.sEnd ?? L);
  const sFrom = o.sFrom ?? 0;
  const K = o.K;
  const u0 = o.u0 ?? -0.5;
  const u1 = o.u1 ?? 0.5;
  const prof = o.prof ?? ((s) => profile(s, L, o.seed));
  ctx.lineCap = "round";
  ctx.globalAlpha = o.alpha ?? 1;
  for (let k = 0; k < K; k++) {
    const u = u0 + ((u1 - u0) * (k + 0.5)) / K + (r() - 0.5) * ((u1 - u0) / K) * 0.6;
    const edge = Math.abs(u - (u0 + u1) / 2) / ((u1 - u0) / 2);
    const dryK = (o.dry ?? 0.5) * (0.45 + 1.4 * edge * edge) * (0.7 + 0.6 * r());
    ctx.strokeStyle = o.colors[Math.floor(r() * o.colors.length)];
    const bw = ((o.W / K) * (o.overlap ?? 2)) / (o.thinOuter ? 1 + edge : 1);
    let prev = null;
    for (const p of shape.pts) {
      if (p.s < sFrom || p.s > sEnd) {
        prev = null;
        continue;
      }
      const t = p.s / L;
      const ink = 1 - dryK * t ** 1.5 + (noise1(p.s * (o.noiseFreq ?? 0.3) + k * 17.3, o.seed + k) - 0.5) * (o.noise ?? 0.6);
      if (ink < 0.45) {
        prev = null;
        continue;
      }
      const w = o.W * prof(p.s);
      const wob = (noise1(p.s * 0.15 + k * 5.1, o.seed + 77) - 0.5) * (o.wobble ?? 0.4);
      const x = p.x + p.nx * (u * w + wob);
      const y = p.y + p.ny * (u * w + wob);
      if (prev) {
        ctx.lineWidth = Math.max(0.25, bw * Math.min(1.2, prof(p.s)));
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prev = [x, y];
    }
  }
  ctx.globalAlpha = 1;
}
/** 円の判子を道に沿って並べた和の塗り（滲み・下敷き）。blurPx はデバイス px */
function dabs(ctx, shape, o) {
  const L = shape.L;
  const sEnd = Math.min(L, o.sEnd ?? L);
  const prof = o.prof ?? ((s) => profile(s, L, o.seed));
  ctx.save();
  if (o.blur) ctx.filter = `blur(${o.blur}px)`;
  ctx.globalAlpha = o.alpha;
  ctx.fillStyle = o.color;
  ctx.beginPath();
  const step = o.step ?? 1.2;
  for (let s = o.sFrom ?? 0; s <= sEnd; s += step) {
    const p = at(shape, s);
    const off = (o.offset ?? 0) * o.W * prof(s) + (noise1(s * 0.12, o.seed + 41) - 0.5) * (o.wobble ?? 0);
    const rr = o.R * o.W * prof(s) * (1 + (noise1(s * 0.4, o.seed + 13) - 0.5) * (o.rough ?? 0.3));
    const x = p.x + p.nx * off;
    const y = p.y + p.ny * off;
    ctx.moveTo(x + rr, y);
    ctx.arc(x, y, Math.max(0.2, rr), 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}
/** 和紙に滲む毛羽（縁から外へ伸びる細い筋） */
function fibers(ctx, shape, o) {
  const r = rng(o.seed * 13 + 5);
  const L = shape.L;
  const sEnd = Math.min(L, o.sEnd ?? L);
  ctx.strokeStyle = o.color;
  ctx.lineWidth = o.lw ?? 0.3;
  ctx.lineCap = "round";
  for (let s = 0; s <= sEnd; s += o.every ?? 0.8) {
    const p = at(shape, s);
    const w = o.W * profile(s, L, o.seed);
    const side = r() < 0.5 ? -1 : 1;
    const base = (w * o.R) / 1;
    const len = (0.4 + r() * r() * 2.2) * (o.len ?? 1);
    const ang = (r() - 0.5) * 1.6;
    const nx = p.nx * side;
    const ny = p.ny * side;
    const dx = nx * Math.cos(ang) - ny * Math.sin(ang);
    const dy = nx * Math.sin(ang) + ny * Math.cos(ang);
    const x = p.x + nx * base;
    const y = p.y + ny * base;
    ctx.globalAlpha = (o.alpha ?? 0.5) * (0.5 + r() * 0.5);
    ctx.beginPath();
    ctx.moveTo(x - dx * 0.6, y - dy * 0.6);
    ctx.lineTo(x + dx * len, y + dy * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
/** 飛沫（入りの打ち込み・払いの先） */
function splatter(ctx, x, y, dx, dy, o) {
  const r = rng(o.seed * 7 + 3);
  ctx.fillStyle = o.color;
  ctx.globalAlpha = o.alpha ?? 1;
  for (let i = 0; i < o.n; i++) {
    const d = (0.4 + r() * r() * 1.6) * o.spread;
    const a = Math.atan2(dy, dx) + (r() - 0.5) * (o.cone ?? 2.4);
    const rad = (0.15 + r() * r() * 0.85) * (o.size ?? 1);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
/** いびつな墨の玉（朱の点・滴） */
function blob(ctx, x, y, R, color, seed, alpha = 1, rough = 0.28) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = R * (1 + (noise1(i * 0.9, seed) - 0.5) * 2 * rough);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}
function tipOf(shape, sEnd) {
  const p = at(shape, Math.min(shape.L, sEnd));
  return p;
}

// ---------------------------------------------------------------- 案 A: 色は今のまま・墨の質を強める
const SUMI_A = ["#0a0810", "#1d1a22"];
const GOLD = ["#b8862a", "#d4a238", "#e8bc50", "#f6d470", "#ffe7a0"];
function drawA(ctx, shape, stage, t) {
  const L = shape.L;
  const seed = t.seed;
  const sEnd = L * (t.progress ?? 1);
  if (stage === "sketch") {
    const W = 3.6;
    dabs(ctx, shape, { W, R: 0.75, color: "#050408", alpha: 0.55, blur: 5, seed, sEnd });
    bristles(ctx, shape, { W, K: 10, colors: GOLD, dry: 1.05, noise: 1.0, noiseFreq: 0.45, overlap: 1.6, seed, sEnd, wobble: 0.5 });
    // 金泥の粒
    const r = rng(seed + 99);
    ctx.fillStyle = "#fff4cc";
    for (let s = 2; s < sEnd; s += 2.5) {
      if (r() > 0.45) continue;
      const p = at(shape, s);
      const off = (r() - 0.5) * W * profile(s, L, seed);
      ctx.fillRect(p.x + p.nx * off - 0.25, p.y + p.ny * off - 0.25, 0.5, 0.5);
    }
    const tip = tipOf(shape, sEnd);
    if ((t.progress ?? 1) < 1) blob(ctx, tip.x, tip.y, 1.6, "#e8bc50", seed, 0.9);
    return;
  }
  const W = 7.5;
  dabs(ctx, shape, { W, R: 0.85, color: "#000", alpha: 0.5, blur: 7, seed, sEnd });
  bristles(ctx, shape, { W, K: 20, colors: ["#0a0810", "#141218", "#0a0810", "#1d1a22"], dry: 0.6, noise: 0.5, overlap: 2.4, seed, sEnd });
  // 朱の芯（一筆の中に差した朱。入りで太く、払いの手前で尽きる。毛の筋で途切れる）
  const coreEnd = Math.min(sEnd, L * 0.75);
  const hot = t.imminent ? ["#ff6a44", "#ff8a5a", "#ffb080"] : ["#d8341c", "#f04a2a", "#ff6640"];
  const coreProf = (s) => profile(s, L, seed) * (1 - 0.55 * (s / L));
  bristles(ctx, shape, { W, K: 6, u0: -0.22, u1: 0.22, colors: hot, dry: 0.95, noise: 1.2, noiseFreq: 0.5, overlap: 1.3, seed: seed + 5, sEnd: coreEnd, prof: coreProf });
  // 朱の上を走る墨の毛の筋（朱が均一な管に見えないように）
  bristles(ctx, shape, { W, K: 4, u0: -0.15, u1: 0.15, colors: SUMI_A, dry: 0.8, noise: 1.4, noiseFreq: 0.35, overlap: 0.45, seed: seed + 9, sEnd: coreEnd, prof: coreProf, wobble: 0.6 });
  const p0 = at(shape, 0.5);
  splatter(ctx, p0.x, p0.y, -p0.tx, -p0.ty, { seed, n: 14, spread: 6, color: "#0a0810", size: 1 });
  splatter(ctx, p0.x, p0.y, -p0.tx, -p0.ty, { seed: seed + 1, n: 5, spread: 4, color: "#f04a2a", size: 0.7 });
  const pe = tipOf(shape, sEnd);
  splatter(ctx, pe.x, pe.y, pe.tx, pe.ty, { seed: seed + 2, n: 8, spread: 5, color: "#0a0810", size: 0.7, cone: 1.0 });
}

// ---------------------------------------------------------------- 案 B: 薄墨と濃墨 + 朱
const SUMI = ["#0b0a0e", "#121016", "#0b0a0e", "#1a1820"];
const GOFUN = "#efe7d2";
const SHU = "#e4462c";
function drawB(ctx, shape, stage, t, scaleDev = LS) {
  const L = shape.L;
  const seed = t.seed;
  const sEnd = L * (t.progress ?? 1);
  const bl = (px) => (px * scaleDev) / LS;
  if (stage === "sketch") {
    const W = 5.6;
    // 薄墨: 淡い滲み（ぼかし）+ 水の多い筆の淡い掠れ + ゆらぎ。縁を線にしない（光る管に見えるので）
    dabs(ctx, shape, { W, R: 1.0, color: "#b9b2a0", alpha: 0.22, blur: bl(10), seed, sEnd, wobble: 1.4, rough: 0.6 });
    bristles(ctx, shape, { W, K: 9, colors: ["#a8a294", "#bdb6a6", "#9a948a", "#cfc8b8"], alpha: 0.38, dry: 0.5, noise: 1.1, noiseFreq: 0.12, overlap: 1.4, seed, sEnd, wobble: 1.3 });
    // 水溜まりのむら（ところどころ濃い）
    dabs(ctx, shape, { W, R: 0.35, color: "#d2cbba", alpha: 0.16, blur: bl(4), seed: seed + 3, sEnd, wobble: 2.2, rough: 0.9, step: 3.1 });
    const tip = tipOf(shape, sEnd);
    if ((t.progress ?? 1) < 1) blob(ctx, tip.x, tip.y, 2.2, "#ddd6c4", seed, 0.45, 0.4);
    return;
  }
  const W = 5.6;
  const haloA = t.imminent ? 0.75 : 0.52;
  // （朱の内側の滲みは床の緑と混ざって濁るのでやめた）
  dabs(ctx, shape, { W, R: 1.15, color: GOFUN, alpha: haloA, blur: bl(6), seed, sEnd, rough: 0.4 });
  fibers(ctx, shape, { W, R: 0.9, color: GOFUN, alpha: 0.55, seed, sEnd, every: 0.7, len: 1.1 });
  bristles(ctx, shape, { W, K: 18, colors: SUMI, dry: 0.65, noise: 0.5, overlap: 2.4, seed, sEnd });
  const p0 = at(shape, 0.5);
  splatter(ctx, p0.x, p0.y, -p0.tx, -p0.ty, { seed, n: 12, spread: 6, color: "#0b0a0e", size: 1 });
  // 朱: 入りの点。輪・扇は内側へ朱が薄く滲む（どちら側が危ないか。線にはしない）
  if (shape.kind !== "line") {
    // 朱は胡粉の下に先に敷いてある
  } else {
    const pe = tipOf(shape, sEnd);
    blob(ctx, pe.x, pe.y, 1.5, SHU, seed + 4, 1);
  }
  const ps = at(shape, 2.8);
  blob(ctx, ps.x, ps.y, 2.3, SHU, seed + 2, 1, 0.22);
  blob(ctx, ps.x - 0.5, ps.y - 0.6, 1.0, "#ff8a5a", seed + 3, 0.8, 0.3);
}

// ---------------------------------------------------------------- 量子化（論理 1px = 2 ドット、Bayer のディザ）
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const QPAL = ["#0b0a0e", "#1e1c24", "#8c877c", "#b3ad9c", "#d8d1bd", "#efe7d2", "#c63a24", "#e4462c", "#ff8a5a", "#5a5650"].map(hexRgb);
function quantize(c) {
  const x = c.getContext("2d");
  const im = x.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  for (let y = 0; y < c.height; y++)
    for (let xx = 0; xx < c.width; xx++) {
      const o = (y * c.width + xx) * 4;
      const a = smooth(0.14, 0.95, d[o + 3] / 255);
      const th = (BAYER[(y & 3) * 4 + (xx & 3)] + 0.5) / 16;
      if (a < th * 0.92 + 0.04) {
        d[o + 3] = 0;
        continue;
      }
      let best = QPAL[0];
      let bd = 1e9;
      for (const p of QPAL) {
        const dd = (p[0] - d[o]) ** 2 * 0.3 + (p[1] - d[o + 1]) ** 2 * 0.59 + (p[2] - d[o + 2]) ** 2 * 0.11;
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      d[o] = best[0];
      d[o + 1] = best[1];
      d[o + 2] = best[2];
      d[o + 3] = 255;
    }
  x.putImageData(im, 0, 0);
}
/** 量子化の板（960x540）に描いてから 2 倍で置く */
function withQuant(ctx, fn) {
  const c = document.createElement("canvas");
  c.width = LW * 2;
  c.height = LH * 2;
  const q = c.getContext("2d");
  q.setTransform(2, 0, 0, 2, 0, 0);
  fn(q);
  quantize(c);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, 0, 0, LW * LS, LH * LS);
  ctx.restore();
}

// ---------------------------------------------------------------- 案 D: 墨の滴（止められる）→ 一筆で結ぶ（止まらない）+ 朱の導火
function drawD(ctx, shape, stage, t, scaleDev = 2) {
  const L = shape.L;
  const seed = t.seed;
  const sEnd = L * (t.progress ?? 1);
  const bl = (px) => (px * scaleDev) / LS;
  if (stage === "sketch") {
    // 滴の間隔。怯み値が溜まるほど滴が落ちる（今の欠けの仕組みをそのまま滴の数で見せる）
    const gap = t.gap ?? 0;
    const STEP = 8;
    // 道の淡いしみ（形をつなぐ）
    dabs(ctx, shape, { W: 3.6, R: 0.7, color: "#bdb6a4", alpha: 0.16, blur: bl(4), seed, sEnd, wobble: 1.0 });
    let i = 0;
    for (let s = 1.5; s <= sEnd; s += STEP, i++) {
      if (i > 0 && hash(i, seed + 61) < gap) continue;
      const p = at(shape, s);
      // 1 つの滴 = 落ちた墨の染み（いびつな円 + 淡い滲みの輪 + 進む向きへ少し流れる）
      const R = 1.9 + hash(i, seed + 3) * 0.7 + (i === 0 ? 0.6 : 0);
      const jx = (hash(i, seed + 5) - 0.5) * 0.9;
      const jy = (hash(i, seed + 6) - 0.5) * 0.9;
      ctx.save();
      ctx.filter = "blur(" + bl(4) + "px)";
      blob(ctx, p.x + jx, p.y + jy, R + 1.6, "#bdb6a4", seed + i + 30, 0.45, 0.4);
      ctx.restore();
      blob(ctx, p.x + jx, p.y + jy, R, "#c9c2b0", seed + i, 0.92, 0.38);
      blob(ctx, p.x + jx + p.tx * R * 0.7, p.y + jy + p.ty * R * 0.7, R * 0.55, "#c9c2b0", seed + i + 70, 0.92, 0.3);
      blob(ctx, p.x + jx - 0.4, p.y + jy - 0.4, R * 0.45, "#ddd6c4", seed + i + 90, 0.8, 0.4);
      // 小さな跳ね
      if (hash(i, seed + 8) < 0.35) {
        const a = hash(i, seed + 9) * Math.PI * 2;
        blob(ctx, p.x + Math.cos(a) * 2.6, p.y + Math.sin(a) * 2.6, 0.5, "#d8d1bd", seed + i + 9, 0.9);
      }
    }
    return;
  }
  const W = 5.2;
  const haloA = t.imminent ? 0.7 : 0.5;
  // 範囲の内側へ朱が薄く滲む（どちら側が当たるか）。胡粉の下に敷き、縁から離れたところにだけ見せる
  if (shape.kind !== "line") {
    // （朱の内側の滲みは濁るのでやめた）
  }
  dabs(ctx, shape, { W, R: 1.15, color: GOFUN, alpha: haloA, blur: bl(5), seed, sEnd, rough: 0.4 });
  fibers(ctx, shape, { W, R: 0.9, color: GOFUN, alpha: 0.6, seed, sEnd, every: 0.9, len: 1.2, lw: 0.5 });
  bristles(ctx, shape, { W, K: 12, colors: SUMI, dry: 0.6, noise: 0.5, overlap: 2.4, seed, sEnd });
  // 朱の導火: 入りから先へ細い朱が走り、先端に届くと攻撃が出る（残り時間を線の上で読む）
  const fuse = t.fuse ?? 0.5;
  bristles(ctx, shape, { W, K: 1, u0: -0.05, u1: 0.05, colors: [SHU], dry: 0, noise: 0, overlap: 0.22, seed: seed + 6, sEnd: Math.min(sEnd, L * fuse), wobble: 0 });
  const pf = tipOf(shape, Math.min(sEnd, L * fuse));
  blob(ctx, pf.x, pf.y, 1.1, "#ff8a5a", seed + 7, 1);
  const p0 = at(shape, 0.5);
  splatter(ctx, p0.x, p0.y, -p0.tx, -p0.ty, { seed, n: 10, spread: 6, color: "#0b0a0e", size: 1.1 });
  const ps = at(shape, 2.8);
  blob(ctx, ps.x, ps.y, 2.4, SHU, seed + 2, 1, 0.22);
}

// ---------------------------------------------------------------- 場面
/** 1 つの予告: 形・段・持ち主 */
function telegraphs(scene) {
  if (scene === "main") {
    const out = [];
    const rows = [
      { y: 72, stage: "sketch" },
      { y: 202, stage: "ink" },
    ];
    rows.forEach((row, ri) => {
      const sd = 100 + ri * 50;
      out.push({ who: "boar", ex: 52, ey: row.y, shape: shapeLine(66, row.y + 2, 186, row.y - 8), stage: row.stage, seed: sd + 1, flip: false });
      out.push({ who: "golem", ex: 262, ey: row.y - 2, shape: shapeRing(262, row.y, 42, -2.2), stage: row.stage, seed: sd + 2 });
      out.push({ who: "skeleton", ex: 352, ey: row.y, shape: shapeFan(352, row.y, 76, -0.05, 0.55), stage: row.stage, seed: sd + 3 });
    });
    return out;
  }
  if (scene === "crowd") {
    const px = 236;
    const py = 138;
    const list = [
      ["boar", 120, 70, "line", "ink"],
      ["boar", 352, 66, "line", "sketch"],
      ["wolf", 110, 200, "line", "sketch"],
      ["wolf", 372, 210, "line", "ink"],
      ["golem", 190, 120, "ring", "sketch"],
      ["golem", 300, 165, "ring", "ink"],
      ["skeleton", 170, 196, "fan", "ink"],
      ["skeleton", 312, 98, "fan", "sketch"],
      ["eye", 236, 46, "line", "ink"],
      ["eye", 56, 132, "line", "sketch"],
      ["laserEye", 420, 130, "line", "ink"],
      ["slime", 250, 228, "fan", "sketch"],
    ];
    return list.map(([who, ex, ey, kind, stage], i) => {
      const dx = px - ex;
      const dy = py - ey;
      const d = Math.hypot(dx, dy);
      const ux = dx / d;
      const uy = dy / d;
      let shape;
      if (kind === "line") {
        const len = who.includes("ye") ? 200 : 150;
        shape = shapeLine(ex + ux * 12, ey + uy * 12, ex + ux * len, ey + uy * len);
      } else if (kind === "ring") shape = shapeRing(ex, ey, 46, i * 1.3);
      else shape = shapeFan(ex, ey, 74, Math.atan2(dy, dx), 0.5);
      return { who, ex, ey, shape, stage, seed: 300 + i * 11, flip: dx < 0 };
    });
  }
  return [];
}

function drawScheme(ctx, scheme, items, scaleNote) {
  const fn = { A: drawA, B: drawB, C: drawB, D: drawD }[scheme];
  const sketches = items.filter((it) => it.stage === "sketch");
  const inks = items.filter((it) => it.stage === "ink");
  const paint = (c) => {
    // 下絵 → 墨入れの順（止まらない段が上）
    for (const it of sketches) fn(c, it.shape, "sketch", it, scheme === "C" || scheme === "D" ? 2 : LS);
    for (const it of inks) fn(c, it.shape, "ink", it, scheme === "C" || scheme === "D" ? 2 : LS);
  };
  if (scheme === "C" || scheme === "D") withQuant(ctx, paint);
  else {
    ctx.save();
    ctx.setTransform(LS, 0, 0, LS, 0, 0);
    paint(ctx);
    ctx.restore();
  }
}

function label(ctx, text, x, y, size = 30, color = "#fff") {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `bold ${size}px "Yu Gothic UI", "Meiryo", sans-serif`;
  const w = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(x - 8, y - size, w + 16, size + 12);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const TITLES = {
  A: "案 A 色は今のまま・墨の質（金泥の掠れ → 濃墨に朱の芯）",
  B: "案 B 薄墨 → 濃墨 + 朱（胡粉の滲みを下に敷く）",
  C: "案 C 案 B をドット絵に（論理 1px = 2 ドット・ディザ）",
  D: "案 D 墨の滴 → 一筆で結ぶ + 朱の導火（ドット 2）",
};

function renderScene(canvas, scheme, scene, floor) {
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawFloor(ctx, floor);
  const items = telegraphs(scene);
  for (const it of items) {
    it.fuse = 0.6;
    it.gap = 0.15;
  }
  if (scene === "crowd") drawSprite(ctx, "player", 236, 138);
  for (const it of items) drawSprite(ctx, it.who, it.ex, it.ey, it.flip);
  drawScheme(ctx, scheme, items);
  if (scene === "main") {
    drawSprite(ctx, "player", 446, 140);
    label(ctx, TITLES[scheme], 24, 44, 30);
    label(ctx, "止められる", 24, 250, 26, "#ddd");
    label(ctx, "止まらない", 24, 770, 26, "#ddd");
  } else label(ctx, TITLES[scheme] + "（乱戦）", 24, 44, 26);
}

/** 時間の進み: 4 コマ（下絵の書き始め / 下絵の書き終わり / 墨入れ / 攻撃の直前） */
function renderTime(canvas, scheme, floor) {
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 1920, 1080);
  const frames = [
    { stage: "sketch", progress: 0.45, name: "1 下絵の書き始め" },
    { stage: "sketch", progress: 1, name: "2 下絵の書き終わり（まだ止められる）" },
    { stage: "ink", progress: 1, fuse: 0.15, name: "3 墨入れ（もう止まらない）" },
    { stage: "ink", progress: 1, fuse: 0.95, imminent: true, name: "4 攻撃の直前" },
  ];
  frames.forEach((f, i) => {
    const ox = (i % 2) * 960;
    const oy = Math.floor(i / 2) * 540;
    const sub = document.createElement("canvas");
    sub.width = 1920;
    sub.height = 1080;
    const sc = sub.getContext("2d");
    drawFloor(sc, floor);
    // 1 コマは論理 240x135。左上に寄せて描いた絵の左上 960x540 を切り出す
    const items = [
      { who: "boar", ex: 26, ey: 34, shape: shapeLine(40, 36, 200, 30), seed: 11 },
      { who: "golem", ex: 62, ey: 96, shape: shapeRing(62, 98, 30, -2.2), seed: 12 },
      { who: "skeleton", ex: 136, ey: 98, shape: shapeFan(136, 98, 66, 0, 0.5), seed: 13 },
    ];
    for (const it of items) {
      it.stage = f.stage;
      it.progress = f.progress;
      it.fuse = f.fuse;
      it.imminent = f.imminent;
      it.gap = 0;
    }
    for (const it of items) drawSprite(sc, it.who, it.ex, it.ey);
    drawScheme(sc, scheme, items);
    ctx.drawImage(sub, 0, 0, 960, 540, ox, oy, 960, 540);
    label(ctx, f.name, ox + 16, oy + 40, 24);
  });
  ctx.fillStyle = "#000";
  ctx.fillRect(958, 0, 4, 1080);
  ctx.fillRect(0, 538, 1920, 4);
  label(ctx, "案 " + scheme, 1840, 1066, 26);
}

window.MOCK = { makeFloor, loadSprites, renderScene, renderTime };
