// 手に持つ武器のシートの作り方と、武器で共通の部品。docs/ideas/player-sprites.md 5 章
//
// 武器は「握り（主の手）」を原点に、+x = 切っ先・銃口の向きで描く。WEAPON_DIRS 方向を生成器が描き直す（回転で崩さない）。
// 片刃・片頭の武器は、刃を反対側へ向けた写しの絵（`<key>.heldM`）も持つ（実行時に振る向きで選ぶ）。
// 両手持ちの武器は、添える手（後ろの手）の位置を meta.offGrip（+x 方向のドット）で渡す
import { capsule, ellipse, paint, polygon, union } from "./paint.mjs";

/** 事前に描く方向の数（11.25 度刻み） */
export const WEAPON_DIRS = 32;

/** 共通の素材（4 段: 暗・基・明・艶） */
export const STEEL = ["#3a3f4e", "#69728a", "#a3adc2", "#eaf0f8"];
export const DARK_STEEL = ["#26262f", "#434453", "#666a7d", "#9aa0b5"];
export const GOLD = ["#5a4424", "#8f7239", "#c6a452", "#efe0a0"];
export const LEATHER = ["#261a18", "#44302a", "#62463a", "#7d5d4b"];
export const WOOD = ["#2e1f18", "#523626", "#74503a", "#946c50"];
export const CLOTH_RED = ["#4a1820", "#7c2830", "#a63d3c", "#c9614f"];

/**
 * 武器のシート一式。size は作業面の一辺（ドット）。edge が true なら写しの絵も作る。
 * draw(frame) は正準座標（原点 = 握り）で塗る
 */
export function weaponSheets(key, draw, opts = {}) {
  const size = opts.size ?? 96;
  const base = { frames: 1, dirs: WEAPON_DIRS, w: size, h: size, ox: size / 2, oy: size / 2, draw: (frame) => draw(frame) };
  const sheets = [{ ...base, key: `${key}.held` }];
  if (opts.edge) sheets.push({ ...base, key: `${key}.heldM`, mirror: true });
  return sheets;
}

/**
 * 刃（x0 → x1 へ伸びる、幅 w0 → w1 の板）。上下の面を別の傾きで塗り、稜線で光を割る。
 * tip は切っ先の長さ（そこから細る）。back が true なら下の縁を平ら（片刃の峰）にする
 */
export function blade(frame, x0, x1, w0, w1, tip, mat, opts = {}) {
  const topY = (x) => -halfAt(x, x0, x1, w0, w1, tip);
  const botY = (x) => (opts.back ? Math.min(halfAt(x, x0, x1, w0, w1, 0) * (opts.backRatio ?? 0.55), halfAt(x, x0, x1, w0, w1, tip)) : halfAt(x, x0, x1, w0, w1, tip));
  const g = frame.newGroup();
  const ridge = opts.ridge ?? 0;
  paint(
    frame,
    (x, y) => {
      if (x < x0 || x > x1) return null;
      const t = topY(x);
      const b = botY(x);
      if (y < t || y > b) return null;
      return y < ridge ? { nx: 0.15, ny: -0.75 } : { nx: 0.15, ny: 0.55 };
    },
    mat,
    { group: g, bias: opts.bias ?? 0 },
  );
  return g;
}

function halfAt(x, x0, x1, w0, w1, tip) {
  const len = x1 - x0;
  const t = Math.max(0, Math.min(1, (x - x0) / len));
  const w = w0 + (w1 - w0) * t;
  if (tip <= 0 || x < x1 - tip) return w;
  const k = (x1 - x) / tip;
  return w * Math.sqrt(Math.max(0, k));
}

/** 巻いた柄（x0 → x1、太さ r）。巻きの筋を暗の段で入れる */
export function grip(frame, x0, x1, r, mat = LEATHER, step = 2) {
  const g = frame.newGroup();
  paint(frame, capsule(x0, 0, x1, 0, r), mat, { group: g });
  for (let x = Math.min(x0, x1) + 1; x < Math.max(x0, x1); x += step) {
    paint(frame, polygon([[x, -r], [x + 0.9, -r], [x + 0.2, r], [x - 0.7, r]]), mat, { group: g, maxShade: 0, rim: false, minShade: 0 });
  }
  return g;
}

/** 柄頭の玉 */
export function pommel(frame, x, r, mat = GOLD) {
  return paint(frame, ellipse(x, 0, r, r), mat);
}

/** 長い柄（槍・斧・鎚）。木の芯に金具の輪を足す */
export function shaft(frame, x0, x1, r, mat = WOOD, rings = [], ringMat = DARK_STEEL) {
  const g = frame.newGroup();
  paint(frame, capsule(x0, 0, x1, 0, r), mat, { group: g });
  for (const rx of rings) paint(frame, union(capsule(rx - 0.8, 0, rx + 0.8, 0, r + 0.7)), ringMat);
  return g;
}
