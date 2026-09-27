// 刀: 細身で反りのある片刃。刃（-y の縁）に白い刃文、黒鉄の峰、金の鎺（はばき）、黒鉄と金の丸い鍔、
// 白い鮫皮に黒い柄巻きの菱の目、金の柄頭。両手で持つ
import { capsule, ellipse, paint, polygon, union } from "../paint.mjs";
import { DARK_STEEL, GOLD, STEEL, weaponSheets } from "../weapon.mjs";

/** 添える後ろの手（握りから柄頭の側へ） */
const OFF_GRIP = -5.5;
/** 刃の始まり・切っ先（ドット） */
const BLADE_X0 = 6.5;
const BLADE_X1 = 43;
/** 反りの深さ（切っ先で峰の側 +y へ寄る量） */
const SORI = 3;
/** 刃の半幅と切っ先の長さ */
const HALF_W = 2.1;
const TIP = 5;
/** 柄巻き・鮫皮の色 */
const ITO = ["#15141c", "#23222e", "#34323f", "#474455"];
const SAME = ["#6b6a70", "#a6a3a0", "#cfcbc3", "#ece8de"];

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
  paint(frame, (x, y) => (bladeFn(x, y) && y > spineY(x) + HALF_W - 0.9 ? { nx: 0.1, ny: 0.6 } : null), DARK_STEEL, { rim: false });
  // 刃文: 刃の縁（-y）に沿った白い帯。峰の側の境目を波打たせる
  paint(
    frame,
    (x, y) => {
      if (!bladeFn(x, y) || x > BLADE_X1 - 1.5) return null;
      const edge = spineY(x) - HALF_W;
      const band = 0.9 + (Math.sin(x * 0.85) > 0.3 ? 0.5 : 0);
      return y < edge + band ? 3 : null;
    },
    STEEL,
    { rim: false },
  );
  // 鎬筋（中の稜線）: 峰寄りに暗い細線
  paint(frame, (x, y) => (x > BLADE_X0 + 2 && x < BLADE_X1 - TIP && Math.abs(y - spineY(x) - 0.25) < 0.3 ? 1 : null), STEEL, { rim: false });
  // 鎺
  paint(frame, polygon([[BLADE_X0 - 1.2, -2.3], [BLADE_X0 + 2.2, -2.2], [BLADE_X0 + 2.2, 2.2], [BLADE_X0 - 1.2, 2.3]], { round: 1 }), GOLD);
  // 鍔: 黒鉄の丸い板（中を一段明るく）
  paint(frame, ellipse(4, 0, 1.9, 5.8), DARK_STEEL);
  paint(frame, ellipse(4, 0, 0.9, 4.2), DARK_STEEL, { rim: false, minShade: 2, maxShade: 2 });
  // 縁（ふち、柄の鍔側の金具）
  paint(frame, capsule(1.2, 0, 2.2, 0, 2.1), GOLD);
}

export const ATLAS = {
  key: "wpnKatana",
  sheets: weaponSheets("wpnKatana", draw, { size: 96, edge: true }),
  meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "ready", restDeg: -22, restHand: [8, 7], swayDeg: 2, restMirror: true } },
};
