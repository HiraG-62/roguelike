// 素材シート（docs/example/Graphics/Character/player/sample.png）から右向きのコマを抜き出し、
// 2 倍密度の格子（絵の 1 ドット = ゲームの 0.5px）へ縮めて、共通の色数に丸め、輪郭を引き直す。
// node scripts/player-art/extract.mjs [--scale 6]  → art/player-hires/sample/ に確認用 PNG と frames.json
import { mkdirSync, writeFileSync } from "node:fs";
import { encodePng } from "../fx/png.mjs";
import { hexToRgb } from "./engine.mjs";
import { bgColor, loadSample } from "./segment.mjs";

const OUT = "art/player-hires/sample";
const CANVAS = { w: 96, h: 80, anchorX: 44, ground: 76 };

/**
 * コマの定義。box は素材上の範囲（影を含まない程度に下を詰める）、height は仕上がりの高さ（ドット）、
 * flip は左右反転（素材が左向きのコマ）、fx は消す演出の種類
 */
export const FRAMES = [
  { key: "idle", box: [496, 90, 96, 228], height: 56 },
  { key: "walk0", box: [758, 368, 72, 94], height: 50 },
  { key: "walk1", box: [845, 367, 80, 95], height: 50 },
  { key: "walk2", box: [946, 367, 74, 95], height: 50 },
  { key: "walk3", box: [1039, 367, 76, 97], height: 50 },
  { key: "walk4", box: [1135, 367, 70, 95], height: 50 },
  { key: "windup", box: [25, 533, 140, 152], height: 57, fx: ["blade"] },
  { key: "strike", box: [608, 566, 175, 118], height: 44, flip: true, fx: ["blade"] },
  { key: "dash", box: [555, 805, 215, 100], height: 40, fx: ["smoke", "speed", "blade"] },
  { key: "hurt", box: [1058, 800, 140, 132], height: 54, fx: ["spark"] },
];

// ---------------------------------------------------------------------------
// 色の道具
// ---------------------------------------------------------------------------

function toHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

const dist2 = (a, b) => {
  // 明るさの差を重く（暗い色の階調を潰さない）
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db + 0.5 * (dr * dr + dg * dg + db * db) / 3;
};

// ---------------------------------------------------------------------------
// 1 コマの切り出し
// ---------------------------------------------------------------------------

/** 前景（人物）の判定。背景との差・影・演出を除く */
function classify(img, bg, x, y, fx) {
  const k = (y * img.width + x) * 4;
  const r = img.rgba[k];
  const g = img.rgba[k + 1];
  const b = img.rgba[k + 2];
  const d = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
  const [h, s, l] = toHsl(r, g, b);
  // 床の影: 背景より少し暗い無彩色
  const bgL = (bg[0] + bg[1] + bg[2]) / 765;
  if (d < 34 && l < bgL + 0.02) return 0;
  if (d < 30) return 0;
  // 演出: 明るい赤い光・土煙・速度線
  if (fx.includes("smoke") && s < 0.25 && l > 0.42 && h > 15 && h < 60) return 0;
  if ((fx.includes("speed") || fx.includes("spark")) && h > 330 && s > 0.55 && l > 0.5) return 0;
  return { rgb: [r, g, b], light: l, sat: s };
}

/** 細い構造（刃・速度線）を落とすための開き（収縮→膨張） */
function open(mask, W, H, r) {
  const er = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let ok = 1;
      for (let dy = -r; dy <= r && ok; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H || !mask[yy * W + xx]) {
            ok = 0;
            break;
          }
        }
      er[y * W + x] = ok;
    }
  const di = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!er[y * W + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) di[yy * W + xx] = 1;
        }
    }
  return di;
}

/** 素材の範囲 → 前景の画素（色 or null）の格子 */
function cutout(img, bg, def) {
  const [bx, by, bw, bh] = def.box;
  const fx = def.fx ?? [];
  const px = new Array(bw * bh).fill(null);
  const mask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const c = classify(img, bg, bx + x, by + y, fx);
      if (!c) continue;
      px[y * bw + x] = c;
      mask[y * bw + x] = 1;
    }
  if (fx.includes("blade") || fx.includes("speed")) {
    // 明るい無彩色で、細い（開きで消える）画素 = 刃・速度線
    const core = open(mask, bw, bh, 3);
    for (let i = 0; i < px.length; i++) {
      const c = px[i];
      if (!c || core[i]) continue;
      if (c.light > 0.45 || (c.sat > 0.5 && c.light > 0.4)) {
        px[i] = null;
        mask[i] = 0;
      }
    }
  }
  // 最大の連結成分だけ残す（離れたちり・火花を捨てる）
  keepLargest(px, mask, bw, bh);
  return { px, w: bw, h: bh };
}

function keepLargest(px, mask, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  const sizes = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    const st = [s];
    lab[s] = id;
    while (st.length) {
      const p = st.pop();
      n++;
      const x = p % W;
      const y = (p - x) / W;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (mask[q] && lab[q] < 0) {
          lab[q] = id;
          st.push(q);
        }
      }
    }
    sizes.push(n);
  }
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  for (let i = 0; i < px.length; i++) if (mask[i] && lab[i] !== best) {
    px[i] = null;
    mask[i] = 0;
  }
}

/** 前景の縦の範囲に合わせて縮める（面積の平均。覆いが半分以上のドットだけ残す） */
function resample(cut, height, flip) {
  const { px, w, h } = cut;
  let top = h;
  let bot = 0;
  let left = w;
  let right = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[y * w + x]) {
        top = Math.min(top, y);
        bot = Math.max(bot, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
  const s = (bot - top + 1) / height;
  const ow = Math.ceil((right - left + 1) / s);
  const oh = height;
  const out = new Array(ow * oh).fill(null);
  for (let oy = 0; oy < oh; oy++)
    for (let ox = 0; ox < ow; ox++) {
      const sx0 = left + ox * s;
      const sy0 = top + oy * s;
      let cov = 0;
      let tot = 0;
      const acc = [0, 0, 0];
      const samples = [];
      for (let yy = Math.floor(sy0); yy < Math.ceil(sy0 + s); yy++)
        for (let xx = Math.floor(sx0); xx < Math.ceil(sx0 + s); xx++) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          tot++;
          const c = px[yy * w + xx];
          if (!c) continue;
          cov++;
          samples.push(c.rgb);
          acc[0] += c.rgb[0];
          acc[1] += c.rgb[1];
          acc[2] += c.rgb[2];
        }
      if (!tot || cov / tot < 0.45) continue;
      // 平均に最も近い実在の画素（ぼけた中間色を作りにくい）
      const avg = [acc[0] / cov, acc[1] / cov, acc[2] / cov];
      let best = samples[0];
      let bd = Infinity;
      for (const c of samples) {
        const d = dist2(c, avg);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      const blend = [0.5 * best[0] + 0.5 * avg[0], 0.5 * best[1] + 0.5 * avg[1], 0.5 * best[2] + 0.5 * avg[2]];
      const tx = flip ? ow - 1 - ox : ox;
      out[oy * ow + tx] = blend;
    }
  return { px: out, w: ow, h: oh };
}

// ---------------------------------------------------------------------------
// 共通の色（k 平均）
// ---------------------------------------------------------------------------

function kmeans(colors, k, iters = 24) {
  // 明るさで並べて均等に初期値を取る
  const sorted = [...colors].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let cents = [];
  for (let i = 0; i < k; i++) cents.push([...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]]);
  for (let it = 0; it < iters; it++) {
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (const c of colors) {
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < cents.length; i++) {
        const d = dist2(c, cents[i]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      const s = sum[bi];
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
      s[3]++;
    }
    cents = cents.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  return cents.map((c) => c.map(Math.round));
}

const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;

function nearest(c, pal) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const d = dist2(c, pal[i]);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
}

// ---------------------------------------------------------------------------
// 仕上げ（輪郭・孤立点）
// ---------------------------------------------------------------------------

/** 添字の格子の孤立点を周りの多数に合わせる（輪郭は除く） */
function despeckle(idx, w, h) {
  const cur = idx.slice();
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      const v = cur[k];
      if (v < 0) continue;
      const nb = [cur[k - 1], cur[k + 1], cur[k - w], cur[k + w]];
      if (nb.some((n) => n < 0)) continue;
      if (nb.includes(v)) continue;
      const cnt = new Map();
      for (const n of nb) cnt.set(n, (cnt.get(n) ?? 0) + 1);
      let best = v;
      let bc = 1;
      for (const [n, c] of cnt) if (c > bc) [best, bc] = [n, c];
      idx[k] = best;
    }
}

/** 1 ドットだけ飛び出した画素・背景に 1 ドットだけ食い込んだ穴を整える */
function smoothSilhouette(idx, w, h) {
  for (let pass = 0; pass < 2; pass++) {
    const cur = idx.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        const on = (xx, yy) => xx >= 0 && yy >= 0 && xx < w && yy < h && cur[yy * w + xx] >= 0;
        const n4 = [on(x - 1, y), on(x + 1, y), on(x, y - 1), on(x, y + 1)].filter(Boolean).length;
        if (cur[k] >= 0 && n4 <= 1) idx[k] = -1;
        if (cur[k] < 0 && n4 >= 3) {
          // 周りの最も暗くない色で埋める
          const cand = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => on(a, b)).map(([a, b]) => cur[b * w + a]);
          idx[k] = cand[0];
        }
      }
  }
}

function main() {
  const img = loadSample();
  const bg = bgColor(img);
  const scale = Number(process.argv[process.argv.indexOf("--scale") + 1]) || 6;
  mkdirSync(OUT, { recursive: true });

  const frames = FRAMES.map((def) => ({ def, r: resample(cutout(img, bg, def), def.height, def.flip) }));

  // 共通の色: 全コマの前景色から k 平均（肌・白・赤は少数でも潰れないよう、別に足す）
  const all = [];
  for (const { r } of frames) for (const c of r.px) if (c) all.push(c);
  const K = 22;
  const pal = kmeans(all, K);
  // 輪郭色（最暗より更に暗く）
  const OUTLINE = [16, 12, 20];

  const results = frames.map(({ def, r }) => {
    const { w, h } = r;
    const idx = r.px.map((c) => (c ? nearest(c, pal) : -1));
    smoothSilhouette(idx, w, h);
    despeckle(idx, w, h);
    // キャンバスへ置く: 足元（最下段）を ground、胴の中心（上 2/3 の平均 x）を anchorX
    let sx = 0;
    let n = 0;
    for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.7); y++)
      for (let x = 0; x < w; x++)
        if (idx[y * w + x] >= 0) {
          sx += x;
          n++;
        }
    const cx = n ? sx / n : w / 2;
    const ox = Math.round(CANVAS.anchorX - cx);
    const oy = CANVAS.ground - h;
    const out = new Array(CANVAS.w * CANVAS.h).fill(null);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = idx[y * w + x];
        if (v < 0) continue;
        const X = x + ox;
        const Y = y + oy;
        if (X < 0 || Y < 0 || X >= CANVAS.w || Y >= CANVAS.h) continue;
        out[Y * CANVAS.w + X] = hex(pal[v]);
      }
    // 外側の輪郭を引き直す（4 近傍）
    const lined = out.slice();
    for (let y = 0; y < CANVAS.h; y++)
      for (let x = 0; x < CANVAS.w; x++) {
        const k = y * CANVAS.w + x;
        if (out[k]) continue;
        const nb = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ].some(([a, b]) => a >= 0 && b >= 0 && a < CANVAS.w && b < CANVAS.h && out[b * CANVAS.w + a]);
        if (nb) lined[k] = hex(OUTLINE);
      }
    return { key: def.key, px: lined };
  });

  // 確認用: 横一列（床色の背景・拡大）
  const W = CANVAS.w * results.length * scale;
  const H = CANVAS.h * scale;
  const rgba = new Uint8Array(W * H * 4);
  const floor = hexToRgb("#47424e");
  for (let i = 0; i < W * H; i++) rgba.set([...floor, 255], i * 4);
  results.forEach(({ px }, f) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < CANVAS.w * scale; x++) {
        const c = px[Math.floor(y / scale) * CANVAS.w + Math.floor(x / scale)];
        if (c) rgba.set([...hexToRgb(c), 255], (y * W + f * CANVAS.w * scale + x) * 4);
      }
  });
  writeFileSync(`${OUT}/strip.png`, encodePng(W, H, rgba));
  writeFileSync(`${OUT}/frames.json`, JSON.stringify({ canvas: CANVAS, palette: pal.map(hex), frames: results }));
  console.log(`${OUT}/strip.png（色 ${pal.length}）`);
}

main();
