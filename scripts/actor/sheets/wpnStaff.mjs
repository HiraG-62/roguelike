// 棍: 両端に鉄の口金をはめた長い樫の棒。中ほどに赤い布の巻き、口金の手前に金の輪。両手で中ほどを握る
import { capsule, ellipse, paint, polygon, union } from "../paint.mjs";

/** 輪（x を中心に幅 w、太さ r の短い円柱。丸い端を付けない） */
function ring(x, w, r) {
  return (px, py) => (Math.abs(px - x) > w / 2 || Math.abs(py) > r ? null : { nx: 0, ny: (py / r) * 0.85 });
}
import { CLOTH_RED, DARK_STEEL, GOLD, STEEL, WOOD, grip, weaponSheets } from "../weapon.mjs";

/** 添える後ろの手（握りから尻の側へ） */
const OFF_GRIP = -12;
/** 先端・尻の x */
const TIP = 38;
const BUTT = -28;

/** 口金（端 x から内側へ len、向き s = 1 で先端側） */
function cap(frame, x, s) {
  const inner = x - s * 6;
  paint(frame, union(capsule(inner, 0, x - s * 1.5, 0, 2.1), ellipse(x - s * 1.2, 0, 2.3, 2.3)), DARK_STEEL);
  // 口金の帯（鋼の輪 2 本）
  for (const k of [1.2, 4]) paint(frame, ring(x - s * k, 1.3, 2.4), STEEL);
  // 金の輪（口金の手前）
  paint(frame, ring(inner - s * 1.2, 1.6, 2.1), GOLD);
  paint(frame, ring(inner - s * 3.4, 1, 1.9), GOLD);
}

function draw(frame) {
  paint(frame, capsule(BUTT + 1, 0, TIP - 1, 0, 1.6), WOOD);
  // 握りの間の赤い布巻き（両手の間）
  grip(frame, OFF_GRIP - 3, 3, 1.9, CLOTH_RED, 2);
  cap(frame, TIP, 1);
  cap(frame, BUTT, -1);
  // 先の口金から垂れる短い房
  paint(frame, polygon([[TIP - 8.5, 1.5], [TIP - 7, 1.5], [TIP - 6.8, 5.5], [TIP - 8, 6.5], [TIP - 9.4, 5]], { round: 1.2 }), CLOTH_RED);
}

export const ATLAS = { key: "wpnStaff", sheets: weaponSheets("wpnStaff", draw, { size: 84 }), meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "ready", restDeg: -14, restHand: [6, 9], swayDeg: 2, parry: { hand: [5, -3], deg: -28, contact: 12 } } } };
