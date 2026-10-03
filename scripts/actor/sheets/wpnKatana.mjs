// 刀: 細身で反りのある片刃。刃（-y の縁）に白い刃文、黒鉄の峰、金の鎺（はばき）、黒鉄と金の丸い鍔、
// 白い鮫皮に黒い柄巻きの菱の目、金の柄頭。両手で持つ。
// 鞘（`wpnKatana.sheath`）: 黒漆に金の鯉口と鐺、栗形。原点 = 鯉口、+x = 鐺の向き。刀身と同じ反りで、納めた刀（写しの絵）の刃を覆う。
// 腰に刃を上にして差すので、写しの絵（刃が上の側）と揃えて写しで描く
import { capsule, ellipse, paint, polygon, union } from "../paint.mjs";
import { DARK_STEEL, GOLD, STEEL, WEAPON_DIRS, weaponSheets } from "../weapon.mjs";

/** 添える後ろの手（握りから柄頭の側へ） */
const OFF_GRIP = -5.5;
/** 刃の始まり・切っ先（ドット） */
const BLADE_X0 = 6.5;
const BLADE_X1 = 43;
/** 反りの深さ（切っ先で峰の側 +y へ寄る量） */
const SORI = 3;
/** 刃の半幅と切っ先の長さ */
const HALF_W = 1.35;
const TIP = 5;
/** 柄巻き・鮫皮の色 */
const ITO = ["#15141c", "#23222e", "#34323f", "#474455"];
const SAME = ["#6b6a70", "#a6a3a0", "#cfcbc3", "#ece8de"];
/** 鞘の黒漆 */
const URUSHI = ["#1b1420", "#382a3e", "#584260", "#8c7494"];
/** 鯉口の位置（握りから刃の向きへ、ドット。鍔のすぐ先）。実行時の構えの meta.sheath と同じ値 */
const MOUTH_X = 6;
/** 鞘の長さ（鯉口から鐺まで）と半幅（鯉口・鐺の側） */
const SHEATH_LEN = 39;
const SHEATH_HALF0 = 2.3;
const SHEATH_HALF1 = 1.9;

/** 反りの中心線（x での y） */
function spineY(x) {
  const t = Math.max(0, (x - BLADE_X0) / (BLADE_X1 - BLADE_X0));
  return SORI * t * t;
}

/** 刃の半幅（切っ先は峰の側から刃の側へ斜めに落とす: 帽子） */
function bladeFn(x, y) {
  if (x < BLADE_X0 || x > BLADE_X1) return null;
  const c = spineY(x);
  const top = x > BLADE_X1 - TIP ? c - HALF_W * Math.pow((BLADE_X1 - x) / TIP, 0.6) : c - HALF_W;
  const bot = c + HALF_W * (x > BLADE_X1 - TIP * 0.4 ? (BLADE_X1 - x) / (TIP * 0.4) : 1);
  if (y < top || y > bot) return null;
  return y < c ? { nx: 0.1, ny: -0.8 } : { nx: 0.1, ny: 0.6 };
}

function draw(frame) {
  // 柄: 鮫皮の地に黒い柄巻き（菱の目が並ぶ）
  paint(frame, capsule(-11, 0, 2, 0, 1.8), SAME);
  for (let x = -10; x <= 0; x += 3) {
    paint(frame, polygon([[x - 1.6, -1.9], [x, -0.2], [x + 1.6, -1.9], [x + 1.6, -1.2], [x, 0.9], [x - 1.6, -1.2]]), ITO, { rim: false });
    paint(frame, polygon([[x - 1.6, 1.9], [x, 0.2], [x + 1.6, 1.9], [x + 1.6, 1.2], [x, -0.9], [x - 1.6, 1.2]]), ITO, { rim: false });
  }
  // 柄頭（頭）と縁
  paint(frame, union(capsule(-13, 0, -11.2, 0, 2.1)), GOLD);
  // 刃: 鋼の地、峰（+y の縁）は黒鉄
  paint(frame, bladeFn, STEEL, { maxShade: 2 });
  paint(frame, (x, y) => (bladeFn(x, y) && y > spineY(x) + HALF_W - 0.6 ? { nx: 0.1, ny: 0.6 } : null), DARK_STEEL, { rim: false });
  // 刃文: 刃の縁（-y）に沿った白い帯。峰の側の境目を波打たせる
  paint(
    frame,
    (x, y) => {
      if (!bladeFn(x, y) || x > BLADE_X1 - 1.5) return null;
      const edge = spineY(x) - HALF_W;
      const band = 0.6 + (Math.sin(x * 0.85) > 0.3 ? 0.35 : 0);
      return y < edge + band ? 3 : null;
    },
    STEEL,
    { rim: false },
  );
  // 鎺
  paint(frame, polygon([[BLADE_X0 - 1.2, -1.8], [BLADE_X0 + 2.2, -1.6], [BLADE_X0 + 2.2, 1.6], [BLADE_X0 - 1.2, 1.8]], { round: 1 }), GOLD);
  // 鍔: 黒鉄の丸い板（中を一段明るく）
  paint(frame, ellipse(4, 0, 1.9, 5.8), DARK_STEEL);
  paint(frame, ellipse(4, 0, 0.9, 4.2), DARK_STEEL, { rim: false, minShade: 2, maxShade: 2 });
  // 縁（ふち、柄の鍔側の金具）
  paint(frame, capsule(1.2, 0, 2.2, 0, 2.1), GOLD);
}

/** 鞘の中心線（鯉口からの x での y。刀身の反りと同じ） */
function sheathY(x) {
  return spineY(x + MOUTH_X);
}

function sheathFn(x, y) {
  if (x < 0 || x > SHEATH_LEN) return null;
  const c = sheathY(x);
  const half = SHEATH_HALF0 + (SHEATH_HALF1 - SHEATH_HALF0) * (x / SHEATH_LEN);
  // 鐺の角を丸める
  const end = SHEATH_LEN - x < 1 ? half * Math.sqrt(Math.max(0, SHEATH_LEN - x)) : half;
  if (y < c - end || y > c + end) return null;
  return y < c ? { nx: 0.1, ny: -0.8 } : { nx: 0.1, ny: 0.6 };
}

function drawSheath(frame) {
  paint(frame, sheathFn, URUSHI, { maxShade: 2 });
  // 漆の艶: 刃の側（-y）の縁に沿った細い光
  paint(frame, (x, y) => (sheathFn(x, y) && x > 2 && x < SHEATH_LEN - 3 && y < sheathY(x) - SHEATH_HALF1 + 0.7 ? 3 : null), URUSHI, { rim: false });
  // 鯉口（金の口金）と鐺（金の石突き）
  paint(frame, (x, y) => (x <= 1.4 && sheathFn(x, y) ? { nx: 0.1, ny: y < sheathY(x) ? -0.8 : 0.6 } : null), GOLD);
  paint(frame, (x, y) => (x >= SHEATH_LEN - 2.4 && sheathFn(x, y) ? { nx: 0.1, ny: y < sheathY(x) ? -0.8 : 0.6 } : null), GOLD);
  // 栗形（下緒を通す小さな突起。鯉口の近くの刃の側）
  paint(frame, ellipse(5.5, sheathY(5.5) - SHEATH_HALF0 - 0.4, 1.3, 1), DARK_STEEL);
}

export const ATLAS = {
  key: "wpnKatana",
  sheets: [
    ...weaponSheets("wpnKatana", draw, { size: 96, edge: true }),
    { frames: 1, dirs: WEAPON_DIRS, w: 96, h: 96, ox: 48, oy: 48, localLight: true, mirror: true, key: "wpnKatana.sheath", draw: (frame) => drawSheath(frame) },
  ],
  meta: {
    offGrip: OFF_GRIP,
    // sheath: 鯉口の位置（腰から、ドット）・鞘の向き（度）・納めた刀の握りから鯉口まで（ドット）。iai: 右の溜めを納刀の構えと抜き付けで描く
    stance: { grip: "two", body: "ready", restDeg: -22, restHand: [8, 7], swayDeg: 2, restMirror: true, restFront: true, sheath: [4, -2, 172, MOUTH_X], iai: true, parry: { hand: [4, 2], deg: -55, mirror: true, contact: 16 } },
  },
};
