// キャラと武器の 1 枚の絵（色の格子）を作る道具。docs/ideas/player-sprites.md 3 章
//
// エフェクト（scripts/fx/raster.mjs）は段の灰色で描いて実行時に配色するが、キャラと武器は素材ごとに色が違うので
// 色をそのまま持つ。形は「正準座標」で書く: 原点 = 絵の原点（体は足元の中心、武器は握り）、+x = 右（武器は切っ先の向き）、
// +y = 画面の下、単位は絵のドット（論理 0.5px）。方向のある絵（武器）は paint が回して塗る。
// 光は画面の左上から当てる（回した武器でも光は画面に固定）。陰は素材の 4 段（暗・基・明・艶）に量子化する

/** 画面の光の向き（左上・手前）。正規化済み */
const LIGHT = (() => {
  const v = [-0.55, -0.7, 0.55];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();
/** 光の強さ → 段（0 暗 / 1 基 / 2 明 / 3 艶）の境目 */
const SHADE_EDGES = [0.12, 0.52, 0.86];
/** 輪郭の色（graphics-style.md 2 章の k と同じ系統） */
export const OUTLINE = "#14121c";

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexRgba(hex) {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return (((n >> 16) & 255) << 24) | (((n >> 8) & 255) << 16) | ((n & 255) << 8) | 255;
}

/**
 * 1 枚の作業面。w x h の格子、原点は (ox, oy)。angle は方向（ラジアン、武器を回す角）。
 * 画素は RGBA（0 は透明）、塗った部品の番号と奥行き（後から塗るほど手前）も持つ
 */
export class ColorFrame {
  constructor(w, h, ox = w / 2, oy = h / 2, angle = 0, mirror = false) {
    this.w = w;
    /** 上下を写した絵（片刃の武器の刃を反対側へ向けた絵）。正準座標の y を反転して塗る */
    this.my = mirror ? -1 : 1;
    this.h = h;
    this.ox = ox;
    this.oy = oy;
    this.angle = angle;
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
    this.rgba = new Uint32Array(w * h);
    /** 部品の組（同じ組どうしは境目に線を引かない）。0 は未塗り */
    this.group = new Uint16Array(w * h);
    /** 境目の線の色（部品ごと。0 は線を引かない） */
    this.rimColor = new Uint32Array(w * h);
    this.z = new Uint16Array(w * h);
    this.nextZ = 1;
    this.nextGroup = 1;
    /** 位置の印（肩・頭・銃口など。実行時に腕や閃光を合わせる） */
    this.anchors = {};
  }

  toGrid(x, y0) {
    const y = y0 * this.my;
    return { x: this.ox + x * this.cos - y * this.sin, y: this.oy + x * this.sin + y * this.cos };
  }

  toCanon(gx, gy) {
    const dx = gx - this.ox;
    const dy = gy - this.oy;
    return { x: dx * this.cos + dy * this.sin, y: (-dx * this.sin + dy * this.cos) * this.my };
  }

  /** 正準座標の法線（nx, ny）を画面の向きへ回す */
  normalToScreen(nx, ny0) {
    const ny = ny0 * this.my;
    return { x: nx * this.cos - ny * this.sin, y: nx * this.sin + ny * this.cos };
  }

  inside(ix, iy) {
    return ix >= 0 && iy >= 0 && ix < this.w && iy < this.h;
  }

  get(ix, iy) {
    return this.inside(ix, iy) ? (this.rgba[iy * this.w + ix] ?? 0) : 0;
  }

  groupAt(ix, iy) {
    return this.inside(ix, iy) ? (this.group[iy * this.w + ix] ?? 0) : 0;
  }

  /** 新しい部品の組の番号（腕の袖と手など、境目に線を引かない部品を束ねる） */
  newGroup() {
    return this.nextGroup++;
  }

  /** 位置の印を正準座標で置く（格子座標にして原点からのずれで持つ） */
  anchor(name, x, y) {
    const g = this.toGrid(x, y);
    this.anchors[name] = [Math.round((g.x - this.ox) * 10) / 10, Math.round((g.y - this.oy) * 10) / 10];
  }
}

/** 光の強さ（-1..1）→ 素材の段 */
export function shadeOf(light, bias = 0) {
  const v = light + bias;
  let s = 0;
  for (const e of SHADE_EDGES) if (v >= e) s++;
  return s;
}

/** 画面の法線 (x, y, z) の光の強さ */
function lightOf(nx, ny, nz) {
  return nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
}

/**
 * 素材: 4 段の色（暗・基・明・艶）。色の文字列の配列で渡す。
 * opts: { bias（明るさの足し引き）, maxShade（艶を使わない面は 2）, rim（境目の線。既定は暗の色、false で引かない）,
 *         group（組の番号）, flat（法線を使わず一律の段）}
 */
function resolveColor(mat, shade) {
  const c = mat[Math.max(0, Math.min(mat.length - 1, shade))];
  return hexRgba(c);
}

/**
 * 形の関数 fn(x, y) を正準座標で超標本化して塗る。fn は外側なら null、内側なら法線 {nx, ny, nz?}（正準座標。
 * nz を省くと球の面として補う）か数値（その段に固定）を返す。標本の半分以上が内側のドットだけを塗る
 */
export function paint(frame, fn, mat, opts = {}) {
  const samples = opts.samples ?? 3;
  const need = (samples * samples) / 2;
  const inv = 1 / samples;
  const box = opts.bounds ? gridBox(frame, opts.bounds) : { x0: 0, y0: 0, x1: frame.w - 1, y1: frame.h - 1 };
  const group = opts.group ?? frame.newGroup();
  const z = frame.nextZ++;
  const rim = opts.rim === false ? 0 : hexRgba(opts.rim ?? mat[0]);
  const maxShade = opts.maxShade ?? 3;
  const minShade = opts.minShade ?? 0;
  for (let iy = box.y0; iy <= box.y1; iy++) {
    for (let ix = box.x0; ix <= box.x1; ix++) {
      let inside = 0;
      let lsum = 0;
      let fixed = -1;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const c = frame.toCanon(ix + (sx + 0.5) * inv, iy + (sy + 0.5) * inv);
          const r = fn(c.x, c.y);
          if (r === null || r === undefined || r === false) continue;
          inside++;
          if (typeof r === "number") {
            fixed = r;
            continue;
          }
          const n = frame.normalToScreen(r.nx, r.ny);
          const nz = r.nz ?? Math.sqrt(Math.max(0, 1 - n.x * n.x - n.y * n.y));
          lsum += lightOf(n.x, n.y, nz);
        }
      }
      if (inside < need) continue;
      const shade = fixed >= 0 ? fixed : Math.max(minShade, Math.min(maxShade, shadeOf(lsum / inside, opts.bias ?? 0)));
      const i = iy * frame.w + ix;
      frame.rgba[i] = resolveColor(mat, shade);
      frame.group[i] = group;
      frame.rimColor[i] = rim;
      frame.z[i] = z;
    }
  }
  return group;
}

/** 正準座標の矩形を回した外接矩形（格子の整数範囲） */
function gridBox(frame, b) {
  const pts = [frame.toGrid(b.x0, b.y0), frame.toGrid(b.x1, b.y0), frame.toGrid(b.x0, b.y1), frame.toGrid(b.x1, b.y1)];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs)) - 1),
    y0: Math.max(0, Math.floor(Math.min(...ys)) - 1),
    x1: Math.min(frame.w - 1, Math.ceil(Math.max(...xs)) + 1),
    y1: Math.min(frame.h - 1, Math.ceil(Math.max(...ys)) + 1),
  };
}

/** 画面に揃った 1 ドット（眼・艶の点・縫い目）。正準座標の位置を格子に丸めて置く。色は文字列 */
export function px(frame, x, y, color) {
  const g = frame.toGrid(x, y);
  const ix = Math.floor(g.x);
  const iy = Math.floor(g.y);
  if (!frame.inside(ix, iy)) return;
  const i = iy * frame.w + ix;
  frame.rgba[i] = hexRgba(color);
  if (!frame.group[i]) frame.group[i] = frame.newGroup();
  frame.rimColor[i] = 0;
}

/** 塗ってあるドットだけ色を変える（模様・縫い目。透明なところには塗らない） */
export function tint(frame, x, y, color) {
  const g = frame.toGrid(x, y);
  const ix = Math.floor(g.x);
  const iy = Math.floor(g.y);
  if (!frame.get(ix, iy)) return;
  frame.rgba[iy * frame.w + ix] = hexRgba(color);
}

/** 画面に揃った小さな模様を押す。rows は文字列、map は文字 → 色。(x, y) は模様の左上（正準座標） */
export function stamp(frame, x, y, rows, map) {
  const g = frame.toGrid(x, y);
  const ox = Math.round(g.x);
  const oy = Math.round(g.y);
  const group = frame.newGroup();
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const color = map[ch];
      if (!color) return;
      const ix = ox + c;
      const iy = oy + r;
      if (!frame.inside(ix, iy)) return;
      const i = iy * frame.w + ix;
      frame.rgba[i] = hexRgba(color);
      frame.group[i] = group;
      frame.rimColor[i] = 0;
      frame.z[i] = frame.nextZ;
    });
  });
  frame.nextZ++;
}

// ---- 形（正準座標）。いずれも外側で null、内側で法線を返す ----

/** 楕円体（中心 cx, cy、半径 rx, ry）。丸い頭・胴・拳 */
export function ellipse(cx, cy, rx, ry) {
  return (x, y) => {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const d = nx * nx + ny * ny;
    if (d > 1) return null;
    return { nx, ny, nz: Math.sqrt(1 - d) };
  };
}

/** 太さ r の円柱（線分 a-b）。手足・柄 */
export function capsule(ax, ay, bx, by, ra, rb = ra) {
  return (x, y) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp01(((x - ax) * dx + (y - ay) * dy) / len2);
    const r = lerp(ra, rb, t);
    const ex = x - (ax + dx * t);
    const ey = y - (ay + dy * t);
    const d = Math.hypot(ex, ey);
    if (d > r) return null;
    const k = d / r;
    return { nx: (ex / (d || 1)) * k, ny: (ey / (d || 1)) * k, nz: Math.sqrt(1 - k * k) };
  };
}

/**
 * 凸でも凹でもよい多角形（点の列 [[x, y], ...]）。面の法線は既定で手前（平らな面）。
 * round を渡すと縁から round ドットの幅で外へ傾ける（板の角を丸めて見せる）
 */
export function polygon(points, opts = {}) {
  const tilt = opts.tilt ?? { nx: 0, ny: 0 };
  const round = opts.round ?? 0;
  return (x, y) => {
    if (!inPolygon(points, x, y)) return null;
    if (round <= 0) return { nx: tilt.nx, ny: tilt.ny };
    const e = nearestEdge(points, x, y);
    const k = clamp01(1 - e.d / round) * 0.8;
    return { nx: tilt.nx + e.nx * k, ny: tilt.ny + e.ny * k };
  };
}

function inPolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 点から一番近い辺までの距離と、その辺の外向きの法線 */
function nearestEdge(points, x, y) {
  let best = { d: Infinity, nx: 0, ny: 0 };
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j];
    const [bx, by] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp01(((x - ax) * dx + (y - ay) * dy) / len2);
    const ex = x - (ax + dx * t);
    const ey = y - (ay + dy * t);
    const d = Math.hypot(ex, ey);
    if (d < best.d) {
      const len = Math.sqrt(len2);
      // 辺の外向き（点の並びの向きによらず、点から離れる側）
      let nx = dy / len;
      let ny = -dx / len;
      if (nx * -ex + ny * -ey > 0) {
        nx = -nx;
        ny = -ny;
      }
      best = { d, nx: -nx, ny: -ny };
    }
  }
  return best;
}

/** 形の和（先に当たった方の法線） */
export function union(...fns) {
  return (x, y) => {
    for (const fn of fns) {
      const r = fn(x, y);
      if (r !== null && r !== undefined && r !== false) return r;
    }
    return null;
  };
}

/** 形 a から形 b をくり抜く */
export function subtract(a, b) {
  return (x, y) => (b(x, y) ? null : a(x, y));
}

/** 形を半平面で切る（nx * x + ny * y <= c の側を残す） */
export function clip(fn, nx, ny, c) {
  return (x, y) => (nx * x + ny * y <= c ? fn(x, y) : null);
}

/**
 * 仕上げ: 部品の境目の線（手前の部品の縁に、その部品の暗の色）と、外周の 1 ドットの輪郭。
 * 線は奥の部品と接する手前の側だけに引く（同じ組どうしは引かない）
 */
export function finish(frame, opts = {}) {
  const { w, h } = frame;
  const src = frame.rgba.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (src[y * w + x] ?? 0));
  const NEAR = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!src[i] || !frame.rimColor[i]) continue;
      for (const [dx, dy] of NEAR) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!src[j]) continue;
        if (frame.group[j] === frame.group[i] || frame.z[j] > frame.z[i]) continue;
        frame.rgba[i] = frame.rimColor[i];
        break;
      }
    }
  }
  if (opts.outline === false) return;
  const outline = hexRgba(opts.outlineColor ?? OUTLINE);
  const lined = frame.rgba.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y)) continue;
      if (NEAR.some(([dx, dy]) => at(x + dx, y + dy))) lined[y * w + x] = outline;
    }
  }
  frame.rgba.set(lined);
}

/** 不透明なドットの外接矩形。空なら null */
export function trimBox(frame) {
  let x0 = frame.w;
  let y0 = frame.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < frame.h; y++) {
    for (let x = 0; x < frame.w; x++) {
      if (!frame.rgba[y * frame.w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
