// 長銃（両手で構える。添え手は前の先台の下 meta.offGrip）: 木の銃床と先台、黒鉄の機関部に真鍮の槓桿と照準鏡、
// 長い銃身を真鍮の帯で先台に留め、銃口の下に背のまっすぐな片刃の銃剣。銃口の位置を印で渡す
import { capsule, ellipse, paint, polygon, px } from "../paint.mjs";
import { DARK_STEEL, GOLD, LEATHER, STEEL, WOOD, weaponSheets } from "../weapon.mjs";

/** 銃身の高さ（握りの線から上へ） */
const BARREL_Y = -3.6;
/** 銃口（銃身の先） */
const MUZZLE_X = 33;
/** 添える後ろの手（先台の下） */
const OFF_GRIP = 13;

function draw(frame) {
  // 銃床: 握りの手首から後ろへ広がる。下の縁は踵へ向けて下がる
  paint(
    frame,
    polygon([[2, -2.6], [-4, -3.2], [-18.5, -3.6], [-19.5, 4.8], [-15, 4.4], [-6, 1.8], [-1, 3.8], [2.2, 2.6]], { round: 2 }),
    WOOD,
  );
  // 床尾板
  paint(frame, polygon([[-21, -4], [-18.6, -3.8], [-19.6, 5], [-21.8, 5]], { round: 0.8 }), DARK_STEEL);
  // 頬当ての革
  paint(frame, polygon([[-15, -3.3], [-8, -3.1], [-8.6, -0.6], [-14.6, -0.2]], { round: 1 }), LEATHER);
  px(frame, -13.4, -1.8, "#9c7b5e");
  px(frame, -10, -1.8, "#9c7b5e");
  // 用心鉄と引き金
  paint(frame, capsule(1.6, 2.4, 6, 2.4, 0.8), DARK_STEEL, { rim: false });
  paint(frame, polygon([[3, 0], [3.9, 0], [3.6, 2], [3, 1.8]]), GOLD, { rim: false });
  // 先台（銃身の下の木。先で細る）
  paint(frame, polygon([[6, -3.4], [24, -3.2], [25, -1], [23, 0.8], [7, 1.6]], { round: 1.4 }), WOOD);
  // 太い銃身と上の帯、銃口の太い口輪
  paint(frame, capsule(4, BARREL_Y, MUZZLE_X, BARREL_Y, 1.7, 1.5), STEEL);
  paint(frame, capsule(8, BARREL_Y - 1.6, MUZZLE_X - 1.5, BARREL_Y - 1.6, 0.55), DARK_STEEL, { rim: false });
  paint(frame, capsule(MUZZLE_X - 1.6, BARREL_Y, MUZZLE_X + 0.2, BARREL_Y, 2.1), DARK_STEEL);
  // 機関部（黒鉄の箱）
  paint(frame, polygon([[-4.5, -6.6], [8.5, -6.6], [9.2, -1.2], [-4.5, -0.4]], { round: 1.3 }), DARK_STEEL, { bias: 0.06 });
  // 照準鏡（真鍮の筒輪で留めた黒鉄の筒。前後の玻璃は光る）
  paint(frame, capsule(-2.5, -9.4, 9.5, -9.4, 1.5), DARK_STEEL, { bias: 0.1 });
  paint(frame, capsule(9.5, -9.4, 11.5, -9.4, 2), DARK_STEEL);
  for (const rx of [0.5, 6.5]) paint(frame, polygon([[rx - 0.8, -11], [rx + 0.8, -11], [rx + 0.8, -6.4], [rx - 0.8, -6.4]], { round: 0.5 }), GOLD);
  px(frame, 11.9, -10.2, "#a8d8e8");
  px(frame, 11.9, -9.2, "#4a7890");
  // 機関部の真鍮の縁と槓桿（玉は下へ）
  paint(frame, polygon([[-3.6, -2.4], [8.4, -2.4], [8.4, -1.7], [-3.6, -1.7]]), GOLD, { rim: false, minShade: 1 });
  paint(frame, capsule(1.5, -3.8, 2.8, 0.8, 0.6), STEEL, { rim: false });
  paint(frame, ellipse(3, 1.3, 1.3, 1.3), GOLD);
  // 真鍮の帯（先台と銃身を留める）
  for (const bx of [14.5, 22.5]) paint(frame, polygon([[bx - 1, -5.8], [bx + 1, -5.8], [bx + 1, 1.4], [bx - 1, 1.4]], { round: 0.6 }), GOLD);
  // 負い紐の環
  paint(frame, ellipse(18.5, 2.4, 1, 1), DARK_STEEL, { rim: false });
  // 照門・照星
  paint(frame, polygon([[MUZZLE_X - 3.6, -7.2], [MUZZLE_X - 2.2, -7.2], [MUZZLE_X - 2.2, -5.2], [MUZZLE_X - 3.6, -5.2]]), GOLD, { rim: false });
  // 銃剣: 銃口の下の着剣の輪から前へ。背（上）はまっすぐ、刃（下）は切っ先へ上がる片刃
  paint(frame, capsule(MUZZLE_X - 4, -0.8, MUZZLE_X - 0.5, -0.8, 1.3), DARK_STEEL);
  paint(
    frame,
    (x, y) => {
      if (x < MUZZLE_X - 0.5 || x > MUZZLE_X + 12) return null;
      const t = (x - (MUZZLE_X - 0.5)) / 12.5;
      const top = -2.2;
      const bot = t < 0.55 ? 1.4 : 1.4 - ((t - 0.55) / 0.45) * 3.6;
      if (y < top || y > bot) return null;
      return y < -0.6 ? { nx: 0.15, ny: -0.75 } : { nx: 0.15, ny: 0.55 };
    },
    STEEL,
  );
  frame.anchor("muzzle", MUZZLE_X + 0.8, BARREL_Y);
}

export const ATLAS = {
  key: "wpnLongarm",
  sheets: weaponSheets("wpnLongarm", draw, { size: 96 }),
  meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "aim", restDeg: 0, restHand: [8, 4], swayDeg: 1, recoil: 1.5, parry: { hand: [2, 7], deg: -25, grip: -7, contact: 14 } } },
};
