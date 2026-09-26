// 槍: 長い柄の先に大きく鋭い木の葉形の穂先。穂先の付け根に金の口金と赤い房、柄の尻に石突
import { capsule, ellipse, paint, polygon, union } from "../paint.mjs";
import { CLOTH_RED, DARK_STEEL, GOLD, STEEL, WOOD, shaft, weaponSheets } from "../weapon.mjs";

/** 添える後ろの手（握りから柄の尻の側へ） */
const OFF_GRIP = -13;

function draw(frame) {
  shaft(frame, -24, 30, 1.5, WOOD, [-8, 12]);
  // 石突
  paint(frame, union(capsule(-27, 0, -23, 0, 1.9, 1.6), ellipse(-27.5, 0, 1.4, 1.4)), DARK_STEEL);
  // 房（口金の下に垂れる）
  paint(frame, polygon([[29, 1], [31.5, 1], [30.5, 6.5], [28.5, 7.5], [27, 5.5]], { round: 1.5 }), CLOTH_RED);
  // 口金
  paint(frame, capsule(28.5, 0, 32.5, 0, 2.3, 2), GOLD);
  // 穂先: 根元がくびれ、中ほどで大きく膨らみ、長い切っ先へ細る。稜線で上下の面を割る
  const top = (x) => {
    const t = (x - 32) / 27;
    if (t < 0 || t > 1) return -1;
    const w = t < 0.16 ? 1.6 + t * 36 : 7.2 * Math.pow(1 - (t - 0.16) / 0.84, 0.9) + 0.1;
    return w;
  };
  paint(
    frame,
    (x, y) => {
      const w = top(x);
      if (w < 0 || Math.abs(y) > w) return null;
      return y < 0 ? { nx: 0.2, ny: -0.8 } : { nx: 0.2, ny: 0.6 };
    },
    STEEL,
  );
  // 稜線の艶
  paint(frame, polygon([[34, -0.4], [57, -0.2], [57, 0.25], [34, 0.35]]), STEEL, { minShade: 3, maxShade: 3, rim: false });
}

export const ATLAS = { key: "wpnSpear", sheets: weaponSheets("wpnSpear", draw, { size: 120 }), meta: { offGrip: OFF_GRIP } };
