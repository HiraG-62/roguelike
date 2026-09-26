// 剣: 両刃の長剣。幅のある刃に樋（溝）、張り出した金の鍔、革巻きの柄と柄頭
import { ellipse, paint, polygon } from "../paint.mjs";
import { GOLD, LEATHER, STEEL, blade, grip, pommel, weaponSheets } from "../weapon.mjs";

function draw(frame) {
  grip(frame, -4, 3, 1.6, LEATHER);
  pommel(frame, -5.5, 2.1, GOLD);
  blade(frame, 5, 33, 2.6, 2.1, 7, STEEL);
  // 樋: 刃の中央の細い溝（根元から 2/3 まで）
  paint(frame, polygon([[7, -0.5], [24, -0.4], [24, 0.4], [7, 0.5]]), STEEL, { maxShade: 1, minShade: 1, rim: false });
  // 鍔: 上下に張り出し、先がわずかに前へ反る
  paint(
    frame,
    polygon([[3.2, -6], [5.6, -6.8], [5.2, -2], [5.4, 2], [5.6, 6.8], [3.2, 6], [3.8, 0]], { round: 1.6 }),
    GOLD,
  );
  paint(frame, ellipse(4.4, 0, 1.4, 1.4), GOLD, { bias: 0.3 });
}

export const ATLAS = { key: "wpnSword", sheets: weaponSheets("wpnSword", draw, { size: 80 }), meta: { offGrip: null } };
