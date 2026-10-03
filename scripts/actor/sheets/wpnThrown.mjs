// 投擲: 指の間に投げ短剣（苦無）を 3 本挟んで構える。真ん中の 1 本が長く、左右の 2 本は扇に開いて少し短い。
// 刃は稜線で上下の面を割り、尻に金の輪、柄に赤い紐。弾（投げ短剣）は真ん中の切っ先の印から出る
import { capsule, ellipse, paint, polygon, subtract } from "../paint.mjs";
import { CLOTH_RED, DARK_STEEL, GOLD, STEEL, blade, weaponSheets } from "../weapon.mjs";

const DEG = Math.PI / 180;
/** 左右の短剣の開き（度）と長さの比 */
const FAN_DEG = 26;
const SIDE_SCALE = 0.8;
/** 左右の短剣の尻を真ん中からずらす（指 1 本ぶん） */
const FAN_OFFSET = 3;

/** 1 本の苦無を、原点の周りに角 a・倍率 s で置いて描く */
function kunai(frame, a, s, ox = 0, oy = 0) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  // 正準座標の点を回して倍する（形の関数は逆に回して引く）
  const inv = (fn) => (x0, y0) => {
    const x = x0 - ox;
    const y = y0 - oy;
    return fn((x * c + y * sn) / s, (-x * sn + y * c) / s);
  };
  const P = (pts) => pts.map(([x, y]) => [(x * c - y * sn) * s + ox, (x * sn + y * c) * s + oy]);
  // 尻の輪
  paint(frame, inv(subtract(ellipse(-5.5, 0, 2.6, 2.6), ellipse(-5.5, 0, 1.1, 1.1))), GOLD);
  // 柄（赤い紐を巻く）
  paint(frame, inv(capsule(-3.2, 0, 3.2, 0, 1.25)), CLOTH_RED);
  for (let x = -2.4; x <= 2.6; x += 1.7) paint(frame, polygon(P([[x, -1.3], [x + 0.7, -1.3], [x + 0.1, 1.3], [x - 0.6, 1.3]])), CLOTH_RED, { maxShade: 0, minShade: 0, rim: false });
  // 鍔の金具
  paint(frame, inv(capsule(3.4, 0, 4.4, 0, 1.9)), DARK_STEEL);
  // 刃: 根元で膨らむ木の葉形。上下の面を稜線で割る
  paint(
    frame,
    inv((x, y) => {
      const t = (x - 4.2) / 13;
      if (t < 0 || t > 1) return null;
      const w = t < 0.28 ? 1.6 + t * 6.5 : 3.4 * Math.pow(1 - (t - 0.28) / 0.72, 0.85) + 0.15;
      if (Math.abs(y) > w) return null;
      return y < 0 ? { nx: 0.2 * c - -0.8 * sn, ny: 0.2 * sn + -0.8 * c } : { nx: 0.2 * c - 0.6 * sn, ny: 0.2 * sn + 0.6 * c };
    }),
    STEEL,
  );
  // 稜線の艶
  paint(frame, polygon(P([[5, -0.3], [15.5, -0.1], [15.5, 0.25], [5, 0.3]])), STEEL, { minShade: 3, maxShade: 3, rim: false });
}

function draw(frame) {
  // 奥の 2 本を先に（真ん中を手前に重ねる）
  kunai(frame, FAN_DEG * DEG, SIDE_SCALE, -1.5, FAN_OFFSET);
  kunai(frame, -FAN_DEG * DEG, SIDE_SCALE, -1.5, -FAN_OFFSET);
  kunai(frame, 0, 1.15);
  frame.anchor("muzzle", 17.2 * 1.15, 0);
}

export const ATLAS = {
  key: "wpnThrown",
  sheets: weaponSheets("wpnThrown", draw, { size: 48 }),
  meta: { offGrip: null, stance: { grip: "one", body: "light", restDeg: -20, restHand: [7, 5], swayDeg: 3, parry: { hand: [9, 3], deg: -40, contact: 7 } } },
};
