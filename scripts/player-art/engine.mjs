// プレイヤーの高密度ドット絵（2 倍密度）の描画エンジン。
// 形は SDF（符号付き距離）の部品で組み、左上光源の体積の陰影を段に丸め、輪郭・内側の線・落ち影を足す。
// 依存なし。出力は「色の 16 進 | null」の画素列。

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 形（SDF）。座標は絵のドット、y は下向き
// ---------------------------------------------------------------------------

function segDist(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const len2 = bax * bax + bay * bay || 1;
  const h = clamp((pax * bax + pay * bay) / len2, 0, 1);
  return [Math.hypot(pax - bax * h, pay - bay * h), h];
}

/** 太さが変わるカプセル（手足） */
export function capsule(a, b, ra, rb = ra) {
  return (x, y) => {
    const [d, h] = segDist(x, y, a.x, a.y, b.x, b.y);
    return d - lerp(ra, rb, h);
  };
}

/** 楕円（rot は度） */
export function ellipse(c, rx, ry, rot = 0) {
  const cs = Math.cos(-rot * DEG);
  const sn = Math.sin(-rot * DEG);
  return (x, y) => {
    const dx = x - c.x;
    const dy = y - c.y;
    const lx = dx * cs - dy * sn;
    const ly = dx * sn + dy * cs;
    const k = Math.hypot(lx / rx, ly / ry);
    return (k - 1) * Math.min(rx, ry);
  };
}

/** 多角形（点の配列 {x,y}） */
export function poly(pts) {
  return (x, y) => {
    let d = Infinity;
    let s = 1;
    const n = pts.length;
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const vi = pts[i];
      const vj = pts[j];
      const [dd] = segDist(x, y, vj.x, vj.y, vi.x, vi.y);
      d = Math.min(d, dd);
      const c1 = y >= vi.y;
      const c2 = y < vj.y;
      const c3 = (vj.x - vi.x) * (y - vi.y) > (vj.y - vi.y) * (x - vi.x);
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
    }
    return s * d;
  };
}

export const union = (...fs) => (x, y) => {
  let d = Infinity;
  for (const f of fs) d = Math.min(d, f(x, y));
  return d;
};
export const subtract = (f, cut) => (x, y) => Math.max(f(x, y), -cut(x, y));
export const intersect = (f, g) => (x, y) => Math.max(f(x, y), g(x, y));
export const grow = (f, r) => (x, y) => f(x, y) - r;

// ---------------------------------------------------------------------------
// 色
// ---------------------------------------------------------------------------

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const to = (v) => Math.round(v).toString(16).padStart(2, "0");
  return `#${to(lerp(A[0], B[0], t))}${to(lerp(A[1], B[1], t))}${to(lerp(A[2], B[2], t))}`;
}

/** 色相を目標へ最短で寄せる */
function hueToward(h, target, t) {
  let d = target - h;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return h + d * t;
}

/**
 * 5 段の色の段（0 最暗 → 4 艶）。暗部は青紫へ、明部は黄へ色相をずらす（ドット絵の定番の色相ずらし）。
 * opts: { step 明度の刻み, sat 彩度の倍率, shift 色相ずらしの強さ }
 */
export function ramp(h, s, l, opts = {}) {
  const step = opts.step ?? 0.11;
  const satMul = opts.sat ?? 1;
  const shift = opts.shift ?? 0.22;
  const out = [];
  for (let i = 0; i < 5; i++) {
    const k = i - 2;
    const hue = k < 0 ? hueToward(h, 250, -k * shift * 0.5) : hueToward(h, 55, k * shift * 0.35);
    const sat = (s + (k < 0 ? -k * 0.04 : -k * 0.07)) * satMul;
    const lig = l + k * step * (k > 0 ? 0.9 : 1);
    out.push(hslToHex(hue, sat, lig));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

/**
 * part: { name, f: sdf, mat: 5 段の色, z, group, far: 奥の手足（1 段暗く）, R: 陰影の厚み,
 *         flat: 体積の陰影を弱める（布の面）, emissive: 光る（陰影なし）, spec: 艶の段を使う, noLine: 内側の線を引かない }
 * mark: { x, y, color } 陰影と輪郭の後に置く点
 */
export function render(parts, marks, style, w, h) {
  const sorted = [...parts].sort((a, b) => a.z - b.z);
  const n = w * h;
  const owner = new Int16Array(n).fill(-1);
  const sdfAt = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      for (let i = sorted.length - 1; i >= 0; i--) {
        const d = sorted[i].f(px, py);
        if (d <= (sorted[i].bias ?? 0)) {
          owner[y * w + x] = i;
          sdfAt[y * w + x] = d;
          break;
        }
      }
    }
  }
  // 部品ごとの厚み（内側の最大距離）
  const maxIn = new Float32Array(sorted.length).fill(0.5);
  for (let k = 0; k < n; k++) {
    const o = owner[k];
    if (o >= 0) maxIn[o] = Math.max(maxIn[o], -sdfAt[k]);
  }

  const L = style.light;
  const level = new Int8Array(n).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const o = owner[k];
      if (o < 0) continue;
      const p = sorted[o];
      if (p.emissive) {
        level[k] = p.emissiveLevel ?? 3;
        continue;
      }
      const px = x + 0.5;
      const py = y + 0.5;
      const e = 0.5;
      let gx = p.f(px + e, py) - p.f(px - e, py);
      let gy = p.f(px, py + e) - p.f(px, py - e);
      const gl = Math.hypot(gx, gy) || 1;
      gx /= gl;
      gy /= gl;
      const R = p.R ?? Math.max(1.5, maxIn[o]);
      const depth = clamp(-sdfAt[k] / R, 0, 1);
      const r = 1 - depth;
      const flat = p.flat ?? 0;
      const rr = r * (1 - flat);
      const nx = gx * rr;
      const ny = gy * rr;
      const nz = Math.sqrt(Math.max(0, 1 - rr * rr));
      let lum = nx * L[0] + ny * L[1] + nz * L[2];
      lum += p.lumBias ?? 0;
      const t = style.thresholds;
      let lv = lum < t[0] ? 0 : lum < t[1] ? 1 : lum < t[2] ? 2 : lum < t[3] ? 3 : 4;
      if (lv === 4 && !p.spec) lv = 3;
      if (p.far) lv = Math.max(0, lv - 1);
      level[k] = lv;
    }
  }

  // 落ち影: 左上の手前の部品に覆われている画素を 1 段暗く
  const shadowOffs = style.castShadow ?? [
    [-1, -1],
    [-1, -2],
    [0, -2],
  ];
  const lv2 = level.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const o = owner[k];
      if (o < 0 || sorted[o].emissive) continue;
      for (const [dx, dy] of shadowOffs) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = owner[yy * w + xx];
        if (q < 0 || q === o) continue;
        const Q = sorted[q];
        if (Q.z > sorted[o].z && Q.group !== sorted[o].group && !Q.noCast) {
          lv2[k] = Math.max(0, level[k] - 1);
          break;
        }
      }
    }
  }
  level.set(lv2);

  // 孤立した段の点を周りに合わせる（ピロー陰影のざらつき取り）
  for (let pass = 0; pass < 2; pass++) {
    const cur = level.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        const o = owner[k];
        if (o < 0) continue;
        const nb = [k - 1, k + 1, k - w, k + w].filter((j) => owner[j] === o);
        if (nb.length < 3) continue;
        const same = nb.filter((j) => cur[j] === cur[k]).length;
        if (same > 0) continue;
        // 最多の段へ
        const cnt = new Map();
        for (const j of nb) cnt.set(cur[j], (cnt.get(cur[j]) ?? 0) + 1);
        let best = cur[k];
        let bc = 0;
        for (const [v, c] of cnt) if (c > bc) [best, bc] = [v, c];
        level[k] = best;
      }
    }
  }

  const px = new Array(n).fill(null);
  for (let k = 0; k < n; k++) {
    const o = owner[k];
    if (o < 0) continue;
    px[k] = sorted[o].mat[level[k]];
  }

  // 内側の線: 奥の部品の画素のうち、手前の別の部品に接するものを暗く
  if (style.innerLine !== "none") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        const o = owner[k];
        if (o < 0) continue;
        const P = sorted[o];
        if (P.emissive) continue;
        const nbs = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];
        let hit = null;
        for (const [xx, yy] of nbs) {
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = owner[yy * w + xx];
          if (q < 0 || q === o) continue;
          const Q = sorted[q];
          if (Q.z <= P.z || Q.group === P.group || Q.noLine || P.noLineBehind) continue;
          hit = Q;
          break;
        }
        if (!hit) continue;
        px[k] = style.innerLine === "black" ? style.outline : mixHex(P.mat[0], style.outline, style.innerMix ?? 0.45);
      }
    }
  }

  // 外側の輪郭（4 近傍）
  const out = px.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (owner[k] >= 0) continue;
      let o = -1;
      for (const [xx, yy] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = owner[yy * w + xx];
        if (q >= 0 && (o < 0 || sorted[q].z > sorted[o].z)) o = q;
      }
      if (o < 0) continue;
      const P = sorted[o];
      if (style.outlineMode === "selout") {
        // 光の当たる側（左上）は部品の暗部、影の側は黒に近く
        const lit = x < w / 2 && y < h * 0.6;
        out[k] = mixHex(P.mat[0], style.outline, lit ? 0.35 : 0.7);
      } else {
        out[k] = style.outline;
      }
      if (P.emissive && style.glowOutline) out[k] = P.mat[1];
    }
  }

  // リムライト: 影の側（右）の縁に冷たい光
  if (style.rim) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w - 1; x++) {
        const k = y * w + x;
        const o = owner[k];
        if (o < 0 || sorted[o].emissive || sorted[o].far || sorted[o].noRim) continue;
        if (owner[k + 1] >= 0) continue;
        if (style.rimMaxY && y > style.rimMaxY) continue;
        // 右上を向いた縁だけ（上か右上が空いている）。縦の直線の帯にしない
        const upO = y > 0 ? owner[k - w] : -1;
        const upR = y > 0 ? owner[k - w + 1] : -1;
        if (upO >= 0 && upR >= 0) continue;
        if (upO >= 0 && !sorted[o].rimAll) continue;
        out[k] = mixHex(sorted[o].mat[2], style.rim, style.rimMix ?? 0.5);
      }
    }
  }

  for (const m of marks) {
    const x = Math.round(m.x);
    const y = Math.round(m.y);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const o = owner[y * w + x];
    if (m.onlyOn && o < 0) continue;
    // onPart: その部品の上だけに置く（しわ・髪の筋が他の部品へはみ出さない）
    if (m.onPart && (o < 0 || !m.onPart.includes(sorted[o].name))) continue;
    // darken: 置く色を決めずに、下の部品の段を 1 つ暗く / 明るく
    if (m.shift) {
      if (o < 0) continue;
      // 内側の線・縁の光で塗り替えた画素は触らない
      if (out[y * w + x] !== sorted[o].mat[level[y * w + x]]) continue;
      const lv = Math.max(0, Math.min(4, level[y * w + x] + m.shift));
      if (lv === 4 && !sorted[o].spec) continue;
      out[y * w + x] = sorted[o].mat[lv];
      continue;
    }
    out[y * w + x] = m.color;
  }
  return out;
}

/** 画素列 → RGBA（拡大と背景つき） */
export function toRgba(pixels, w, h, scale = 1, bg = null) {
  const W = w * scale;
  const H = h * scale;
  const rgba = new Uint8Array(W * H * 4);
  const bgc = bg ? hexToRgb(bg) : null;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = pixels[Math.floor(y / scale) * w + Math.floor(x / scale)];
      const k = (y * W + x) * 4;
      if (c) {
        const [r, g, b] = hexToRgb(c);
        rgba.set([r, g, b, 255], k);
      } else if (bgc) {
        rgba.set([...bgc, 255], k);
      }
    }
  }
  return rgba;
}
