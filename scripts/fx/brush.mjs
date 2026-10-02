// 墨の筆の部品（docs/ideas/fx-sprites.md 10.2）。スキル石・技のエフェクトを「筆で書いた線」で描くための形。
// 単位は絵のドット（正準座標。+x が向き）。段は配色の段（1〜7）で、墨の配色では
//   無属性（steel）: 段 7 ほど濃墨、段 1〜2 は淡墨（薄い灰）
//   属性つき     : 段 1〜5 は濃墨、段 6〜7 だけ属性のくすんだ差し色
// になる（src/data/fxRamps.json）。だから「筆の芯」は段 6〜7、「かすれた縁・淡い滲み」は段 2〜4 で描く。
// 太い線には生成器が掠れ・毛羽・飛沫の仕上げ（ink.mjs）を掛けるので、ここでは形と筆圧と掠れの大枠だけを作る。
// ばらつきは座標ハッシュだけ（決定的）
import { clamp01, dot, hash1, hash2, paint, smoothstep, valueNoise } from "./raster.mjs";

const TAU = Math.PI * 2;

/** 段 → paint が返す明るさ（raster.mjs の LEVEL_EDGES の各段の真ん中） */
const LEVEL_MID = [0, 0.05, 0.15, 0.26, 0.39, 0.54, 0.71, 0.9];
export function lv(level) {
  return LEVEL_MID[Math.max(1, Math.min(7, Math.round(level)))] ?? 0.9;
}

/** 折れ線の区間ごとの長さの累積（u = 始点からの距離 / 全長 を出す） */
function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return cum;
}

/** 点から折れ線への最寄り: 道のりの距離 s と、線を横切る符号付きの距離 n */
function nearest(pts, cum, x, y) {
  let best = Infinity;
  let s = 0;
  let n = 0;
  let out = false;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-6;
    const raw = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    const t = Math.max(0, Math.min(1, raw));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best) {
      best = d;
      const len = Math.sqrt(len2);
      s = cum[i - 1] + len * t;
      n = ((x - a.x) * dy - (y - a.y) * dx) / len;
      out = (i === 1 && raw < 0) || (i === pts.length - 1 && raw > 1);
    }
  }
  return { d: best, s, n, out };
}

/** 筆圧の既定: 入り（起筆）で押して太く、送りで少し細り、払い（終筆）で尖る */
export function pressure(u, o = {}) {
  const press = o.press ?? 0.12;
  const tail = o.tail ?? 0.35;
  const head = smoothstep(0, press, u);
  const end = 1 - smoothstep(1 - tail, 1, u) * (o.sharp ?? 0.92);
  return (0.55 + 0.45 * head) * end * (1 + (o.swell ?? 0.15) * Math.exp(-((u - press) ** 2) / 0.004));
}

/**
 * 一筆。o.pts（正準座標の折れ線）に沿って、太さ width × 筆圧の帯を塗る。
 * - grow（0..1）: 書き進んだ所まで（筆が走る途中のコマ）。書き先は少し膨らむ（墨だまり）
 * - dry（0..1）: 掠れの強さ。終筆へ向けて毛筋の隙間が増える（飛白）。fade（0..1）で全体が擦れて消える
 * - core / body / edge: 芯の筋・本体・縁の明るさ（lv(段)）。既定は芯 段 7・本体 段 5・縁 段 4。coreWidth は芯の筋の幅（線の半幅に対する割合）
 * - profile(u): 筆圧（既定 pressure）
 * - flat: 端を丸めずに切る（beam の 1 区間）
 */
export function brushStroke(frame, o) {
  const pts = o.pts;
  if (!pts || pts.length < 2) return;
  const cum = measure(pts);
  const total = cum[cum.length - 1] || 1;
  const grow = o.grow ?? 1;
  const dry = o.dry ?? 0.3;
  const fade = o.fade ?? 0;
  const width = o.width ?? 6;
  const seed = o.seed ?? 1;
  // 段: 芯の細い筋（core。属性つきは差し色）・墨の本体（body）・縁（edge）。墨の配色では body と edge は濃墨
  const core = o.core ?? lv(7);
  const body = o.body ?? lv(5);
  const edge = o.edge ?? lv(4);
  const coreWidth = o.coreWidth ?? 0.28;
  const profile = o.profile ?? ((u) => pressure(u, o));
  const pitch = o.pitch ?? 1.1;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const pad = width * 1.4 + 3;
  paint(
    frame,
    (x, y) => {
      const { d, s, n, out } = nearest(pts, cum, x, y);
      // 平らな端（beam の区間を並べたとき継ぎ目に丸い瘤を作らない）
      if (o.flat && out) return -1;
      const u = s / total;
      if (u > grow) return -1;
      // 筆の縁の揺れ（毛先のばらつき）
      const wob = 1 + 0.16 * (valueNoise(s, n > 0 ? 3 : 9, 5, seed) - 0.5) * 2;
      let w = width * profile(u) * wob;
      // 書き先の墨だまり（筆が今ある所は少し太い）
      if (grow < 1) w *= 1 + 0.25 * Math.exp(-(((u - grow) * total) ** 2) / 30);
      if (w <= 0.3 || d > w) return -1;
      // 掠れ: 線を横切る位置で毛筋を決め、終筆へ向けて・fade で隙間を増やす
      const strand = Math.floor((n + w * 2) / pitch);
      const gapChance = dry * smoothstep(0.25, 1, u) + fade;
      const along = Math.floor(s / (o.breakLen ?? 24) + hash1(strand, seed + 11));
      if (gapChance > 0 && hash2(strand, along, seed) < gapChance && Math.abs(n) > w * 0.15) return -1;
      if (fade > 0 && hash2(Math.floor(x * 2), Math.floor(y * 2), seed + 7) < fade * 0.8) return -1;
      const t = d / w;
      if (t < coreWidth) return core;
      return t > 0.82 ? edge : body;
    },
    { bounds: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }, dither: 0.03 },
  );
}

/** 円弧の折れ線（中心 cx, cy・半径 r・角 a0 から sweep〔正は時計回り = 画面の y 下向き〕） */
export function arcPoints(cx, cy, r, a0, sweep, steps = 48, wobble = 0, seed = 1) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    const rr = r * (1 + wobble * (hash1(i, seed) - 0.5));
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return pts;
}

/**
 * 円相（一筆の円）。半径 r の円を a0 から sweep だけ一筆で書く。閉じきらない隙間と、終筆の掠れが墨らしさ。
 * grow で書き進み、fade で擦れて消える
 */
export function enso(frame, o) {
  const r = o.radius;
  const pts = arcPoints(o.ox ?? 0, o.oy ?? 0, r, o.a0 ?? -Math.PI / 2, o.sweep ?? TAU * 0.92, o.steps ?? 64, o.wobble ?? 0.04, o.seed ?? 1);
  brushStroke(frame, { ...o, pts, tail: o.tail ?? 0.45, dry: o.dry ?? 0.55 });
}

/**
 * 墨の飛沫。中心から外へ飛ぶ墨の粒（大きい粒は丸く、尾を引く）。age はコマ（0 から）。
 * spawn(i, r) → { x, y, vx, vy, size（ドット）, life（コマ）, born?（出るコマ）, level?（段）}
 */
export function splatter(frame, frameAge, count, seed, spawn) {
  for (let i = 0; i < count; i++) {
    const r = (k) => hash1(i * 13 + k, seed);
    const s = spawn(i, r);
    const age = frameAge - (s.born ?? 0);
    if (age < 0 || age > s.life) continue;
    const k = 1 - Math.pow(0.72, age);
    const x = s.x + s.vx * k * 3.2;
    const y = s.y + s.vy * k * 3.2;
    const size = Math.max(0.6, s.size * (1 - (0.5 * age) / (s.life + 1)));
    const level = s.level ?? 5;
    // 粒（丸）
    for (let dy = -size; dy <= size; dy += 0.5) for (let dx = -size; dx <= size; dx += 0.5) if (dx * dx + dy * dy <= size * size) dot(frame, x + dx, y + dy, level);
    // 尾（飛んできた向きへ細く）
    const sp = Math.hypot(s.vx, s.vy) || 1;
    if (age < s.life * 0.6) for (let t = 1; t < size * 3; t += 0.5) dot(frame, x - (s.vx / sp) * t, y - (s.vy / sp) * t, Math.max(2, level - 2));
  }
}

/** 墨の点（打ち込んだ一点の墨だまり）。縁がにじんでぎざぎざ */
export function inkBlot(frame, o) {
  const r = o.radius;
  const seed = o.seed ?? 1;
  paint(
    frame,
    (x, y) => {
      const dx = x - (o.x ?? 0);
      const dy = y - (o.y ?? 0);
      const a = Math.atan2(dy, dx);
      const edge = r * (0.85 + 0.3 * valueNoise(Math.cos(a) * 6 + 9, Math.sin(a) * 6 + 9, 3, seed));
      const d = Math.hypot(dx, dy);
      if (d > edge) return -1;
      // 真ん中だけ芯の段（属性つきは差し色）、まわりは墨
      return d / edge < (o.coreWidth ?? 0.35) ? (o.core ?? lv(7)) : (o.body ?? lv(5));
    },
    { bounds: { x0: (o.x ?? 0) - r * 1.3, y0: (o.y ?? 0) - r * 1.3, x1: (o.x ?? 0) + r * 1.3, y1: (o.y ?? 0) + r * 1.3 } },
  );
}

/**
 * 墨の滲み（場の床）。半径 radius の範囲に、縁が濃い墨だまり（rimWidth ドット）と、内側の淡いむら（間引いて床を見せる）。
 * reach（0..1）で中心から滲み広がり、縁は細かいぎざぎざ（紙の繊維に沿って滲む）。
 * tint: 内側のむらの段（属性の差し色を見せたいなら 6、淡墨なら 2〜3）。density: 内側を塗る割合（0..1）
 */
export function inkWash(frame, o) {
  const R = o.radius;
  const reach = o.reach ?? 1;
  const seed = o.seed ?? 1;
  const rimW = o.rimWidth ?? 3;
  const tint = o.tint ?? 3;
  const density = o.density ?? 0.3;
  const rimLevel = o.rimLevel ?? 6;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      // 滲みの縁: 低い周波数の揺れ + 細かい繊維
      const big = valueNoise(Math.cos(a) * 3 + 20, Math.sin(a) * 3 + 20, 1.3, seed);
      const fine = hash1(Math.floor(((a + Math.PI) / TAU) * 220), seed + 3);
      const edgeR = R * reach * (0.9 + 0.14 * big) + (fine - 0.5) * 3 * reach;
      if (r > edgeR) return -1;
      const rim = edgeR - r;
      if (rim < rimW) return lv(rimLevel);
      // 縁のすぐ内側は少し薄くなる（墨が縁へ寄る）
      if (rim < rimW + 2) return -1;
      const m = valueNoise(x, y, o.cell ?? 9, seed + 5);
      const keep = m < density + 0.15 * (1 - r / R);
      if (!keep) return -1;
      // 間引き: 市松に 1 つおき（床と中の敵が見える）
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      if (((ix + iy) & 1) === 1) return -1;
      return lv(tint);
    },
    { bounds: { x0: -R - 6, y0: -R - 6, x1: R + 6, y1: R + 6 }, dither: 0 },
  );
}
