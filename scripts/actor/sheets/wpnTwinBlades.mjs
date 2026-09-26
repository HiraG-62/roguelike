// 双剣: 前へ反った片刃の短剣 2 本（両手に 1 本ずつ）。黒鉄の峰に鋼の刃、短い鍔、赤い柄巻き
import { paint, polygon } from "../paint.mjs";
import { CLOTH_RED, DARK_STEEL, GOLD, STEEL, grip, pommel, weaponSheets } from "../weapon.mjs";

function draw(frame) {
  grip(frame, -4, 3, 1.5, CLOTH_RED);
  pommel(frame, -5.2, 1.7, GOLD);
  // 刃: 根元から先へ前（上）へ反り、切っ先は鋭く上へ跳ねる
  const edge = [
    [4, -2.2],
    [10, -2.8],
    [16, -3.6],
    [21, -5],
    [25.5, -7.2],
    [23.5, -3.4],
    [19, -0.4],
    [13, 1.2],
    [7, 1.6],
    [4, 1.6],
  ];
  paint(frame, polygon(edge, { round: 1.2, tilt: { nx: 0, ny: -0.2 } }), STEEL);
  // 峰: 下の縁に黒鉄の帯
  paint(frame, polygon([[4, 0.4], [9, 0.6], [14, 0.2], [19, -1.2], [19, -0.3], [13, 1.2], [7, 1.6], [4, 1.6]]), DARK_STEEL, { rim: false });
  // 短い鍔
  paint(frame, polygon([[3, -4.2], [4.6, -4.4], [4.6, 3.6], [3, 3.4]], { round: 1 }), GOLD);
}

export const ATLAS = { key: "wpnTwinBlades", sheets: weaponSheets("wpnTwinBlades", draw, { size: 64, edge: true }), meta: { offGrip: null } };
