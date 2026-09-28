// スキル石: 設置物・場（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。場は向きを持たない（dirs 1）
//
// 氷結地帯（frostField）: 「地面を凍らせ、中の敵を凍結させながら継続ダメージを与える（自分も遅くなる）」。半径 40px・3 秒
// - 凍りつく（cast）: 中心から氷が放射に走り、縁が霜の刃のようにぎざぎざに広がる。縁から氷片が跳ねる
// - 凍った床（placed の地面）: 床は透けたまま、霜の結晶の網目（割れた氷の面の縁）と、縁の白い氷の輪と外向きの氷柱。
//   面の一部が順にきらめく。範囲がはっきり見えるよう縁は明るく
// - 冷気（placed の空中）: 氷の粒と小さな雪の結晶がゆっくり立ち昇ってきらめく
// - 割れる（end）: 網目に沿って氷が割れ、板状の氷片が外へ跳ねて消える
import { ring, shards } from "../shapes.mjs";
import { clamp01, dot, glint, hash1, hash2, paint, smoothstep, stamp } from "../raster.mjs";

const TAU = Math.PI * 2;
const FROST = {
  /** 半径（px）。SKILL.frostField.radius */
  radiusPx: 40,
  seed: 6101,
  /** 結晶の網目のセルの大きさ（ドット） */
  cell: 18,
};
const R = FROST.radiusPx * 2;

/** 縁のぎざぎざ（角ごとの半径の揺れ）。霜の刃のように尖らせる */
function edgeRadius(a, radius, seed) {
  const k = (a / TAU + 1) * 28;
  const i = Math.floor(k);
  const t = k - i;
  const h0 = hash1(i % 28, seed);
  const h1 = hash1((i + 1) % 28, seed);
  // 三角波で尖りを作る
  const spike = 1 - Math.abs(t - 0.5) * 2;
  return radius * (0.93 + 0.05 * (h0 * (1 - t) + h1 * t)) + spike * 3.5 * (0.5 + h0);
}

/** 結晶の網目: ずらした格子点のうち最寄り 2 点の距離の差（小さいほどセルの境＝氷の割れ目） */
function crystal(x, y, cell, seed) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  let d1 = Infinity;
  let d2 = Infinity;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = (gx + i + 0.15 + 0.7 * hash2(gx + i, gy + j, seed)) * cell;
      const cy = (gy + j + 0.15 + 0.7 * hash2(gx + i, gy + j, seed + 1)) * cell;
      const d = Math.hypot(x - cx, y - cy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = (gx + i) * 131 + (gy + j);
      } else if (d < d2) d2 = d;
    }
  }
  return { edge: d2 - d1, id };
}

/** 凍った床の本体。reach（0..1）まで氷が広がった状態、twinkle でどの面がきらめくか、crack で割れの強さ */
function frozenFloor(frame, o) {
  const reach = o.reach ?? 1;
  const seed = FROST.seed;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      const edgeR = edgeRadius(a, R * reach, seed);
      if (r > edgeR) return -1;
      const rim = edgeR - r;
      // 縁: 白い氷の輪（2 ドット）と、その内側の青い帯
      if (rim < 2) return 0.95;
      if (rim < 5) return 0.6;
      const c = crystal(x, y, FROST.cell, seed + 3);
      // 割れ目（網目の線）
      if (c.edge < 1.1) return clamp01(0.62 + 0.25 * (1 - r / R) + (o.crack ?? 0) * 0.3);
      // きらめく面: 面ごとに順番に明るくなる
      const tw = hash1(c.id, seed + 5);
      if (o.twinkle !== undefined && Math.abs(((tw + o.twinkle) % 1) - 0.5) < 0.06 && c.edge > 3) return 0.72;
      // 面は透けた霜: 4 ドットに 1 つだけ塗って床と中の敵を見せる（0.5px の点なので画面では薄い膜に見える）
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      if ((ix & 1) === 1 || (iy & 1) === 1) return -1;
      return clamp01(0.3 + 0.12 * (1 - r / R));
    },
    { bounds: { x0: -R - 6, y0: -R - 6, x1: R + 6, y1: R + 6 }, dither: 0 },
  );
  // 縁の氷柱: 外向きの短い棘
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU + hash1(i, seed + 7) * 0.2;
    const base = edgeRadius(a, R * reach, seed) - 1;
    const len = (3 + 5 * hash1(i, seed + 8)) * reach;
    for (let t = 0; t < len; t += 0.5) {
      const w = (1 - t / len) * 1.2;
      for (let s = -w; s <= w; s += 0.5) dot(frame, Math.cos(a) * (base + t) - Math.sin(a) * s, Math.sin(a) * (base + t) + Math.cos(a) * s, t < 1.5 ? 7 : 5);
    }
  }
}

/** 凍りつく（地面）: 中心から放射の氷の筋が走り、氷が縁まで広がる */
function spread(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const reach = smoothstep(0, 0.75, p);
  frozenFloor(frame, { reach, crack: 1 - p });
  // 放射の筋: 中心から縁へ伸びる明るい線
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + hash1(i, FROST.seed + 11) * 0.3;
    const len = R * Math.min(1, p * 1.6);
    for (let t = 0; t < len; t += 0.5) {
      const wob = Math.sin(t * 0.3 + i) * 1.5;
      dot(frame, Math.cos(a) * t - Math.sin(a) * wob, Math.sin(a) * t + Math.cos(a) * wob, t > len - 4 ? 7 : 5);
    }
  }
}

/** 凍りつく（空中）: 縁から跳ねる氷片と中心の閃き */
function spreadAir(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  shards(frame, f, 14, FROST.seed + 12, (i, r) => {
    const a = r(1) * TAU;
    const at = R * (0.4 + 0.6 * r(2));
    return { x: Math.cos(a) * at, y: Math.sin(a) * at, vx: Math.cos(a) * (1.5 + 2 * r(3)), vy: Math.sin(a) * (1.5 + 2 * r(3)) - 1.5, life: 4 + Math.floor(3 * r(4)), size: r(5) > 0.4 ? 2 : 1 };
  });
  if (p < 0.35) glint(frame, 0, 0, 4);
}

const PLACED_FRAMES = 8;

/** 凍った床（置いてある間の地面）。面のきらめきがフレームごとに巡る */
function floor(frame, f) {
  frozenFloor(frame, { reach: 1, twinkle: f / PLACED_FRAMES });
}

/** 雪の結晶（小さな 6 本腕） */
const FLAKE = ["..5..", "5.6.5", ".676.", "5.6.5", "..5.."];

/** 冷気: 氷の粒と雪の結晶が立ち昇る（繰り返しの周期で上へ 1 巡） */
function mist(frame, f) {
  const seed = FROST.seed + 20;
  for (let i = 0; i < 12; i++) {
    const r = (k) => hash1(i * 9 + k, seed);
    const a = r(1) * TAU;
    const at = R * 0.85 * Math.sqrt(r(2));
    const phase = (f / PLACED_FRAMES + r(3)) % 1;
    const x = Math.cos(a) * at + Math.sin(phase * TAU + i) * 2;
    const y = Math.sin(a) * at - phase * 22;
    if (phase > 0.85) continue;
    if (i % 4 === 0) stamp(frame, x, y, FLAKE);
    else {
      dot(frame, x, y, phase < 0.5 ? 7 : 5);
      if (i % 2 === 0) dot(frame, x, y + 1, 4);
    }
  }
}

/** 割れる: 網目に沿って割れ目が明るく走り、板状の氷片が外へ跳ねる */
function shatter(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const seed = FROST.seed;
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      const edgeR = edgeRadius(Math.atan2(y, x), R, seed);
      if (r > edgeR) return -1;
      const c = crystal(x, y, FROST.cell, seed + 3);
      if (c.edge > 1.3) return -1;
      // 面ごとに順に崩れる
      if (hash1(c.id, seed + 9) < p * 1.3) return -1;
      return clamp01(0.9 - p * 0.5);
    },
    { bounds: { x0: -R - 6, y0: -R - 6, x1: R + 6, y1: R + 6 }, dither: 0 },
  );
  shards(frame, f, 22, seed + 13, (i, r) => {
    const a = r(1) * TAU;
    const at = R * Math.sqrt(r(2));
    return { x: Math.cos(a) * at, y: Math.sin(a) * at, vx: Math.cos(a) * (1 + 2.5 * r(3)), vy: Math.sin(a) * (1 + 2.5 * r(3)) - 1, life: 3 + Math.floor(4 * r(4)), size: 2 };
  });
  ring(frame, { radius: R * (0.95 + 0.2 * p), width: 3, bright: 0.6 * (1 - p), erosion: 0.3 + p * 0.6, seed: seed + 14 });
}

const SIZE = Math.ceil(R + 24) * 2;

const FX = {
  skills: {
    frostField: {
      ramp: "ice",
      cast: { sheet: "skillPlaced.frostSpreadAir", life: 0.4, base: FROST.radiusPx, ground: "skillPlaced.frostSpread" },
      placed: { sheet: "skillPlaced.frostMist", base: FROST.radiusPx, period: 1.6, ground: "skillPlaced.frostFloor" },
      end: { sheet: "skillPlaced.frostShatter", life: 0.4, base: FROST.radiusPx },
    },
  },
};

export const ATLAS = {
  key: "skillPlaced",
  fx: FX,
  sheets: [
    { key: "skillPlaced.frostSpread", dirs: 1, frames: 8, active: 0, size: SIZE, draw: spread },
    { key: "skillPlaced.frostSpreadAir", dirs: 1, frames: 8, active: 0, size: SIZE, draw: spreadAir },
    { key: "skillPlaced.frostFloor", dirs: 1, frames: PLACED_FRAMES, active: 0, size: SIZE, draw: floor },
    { key: "skillPlaced.frostMist", dirs: 1, frames: PLACED_FRAMES, active: 0, size: SIZE, draw: mist },
    { key: "skillPlaced.frostShatter", dirs: 1, frames: 8, active: 0, size: SIZE, draw: shatter },
  ],
};
