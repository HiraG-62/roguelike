// 砲（肩に担ぐ重い大筒。両手で持ち、添え手は筒の下の前の握り meta.offGrip）: 黒鉄の太い筒に真鍮の帯を締め、
// 先は喇叭のように開いた口、尻は丸い砲尾の玉。担ぐ所に革を巻く。握りの下に木の銃把。銃口の位置を印で渡す
import { capsule, ellipse, paint, polygon, px, union } from "../paint.mjs";
import { DARK_STEEL, GOLD, LEATHER, WOOD, weaponSheets } from "../weapon.mjs";

/** 筒の芯の高さ（握りの線から上へ）と太さ */
const TUBE_Y = -6.5;
const TUBE_R = 4.2;
/** 筒の尻と口 */
const TUBE_BACK = -20;
const TUBE_FRONT = 22;
/** 喇叭の口の先 */
const MOUTH_X = 28;
/** 添える後ろの手（筒の下の前の握り） */
const OFF_GRIP = 11;
/** 黒鉄の筒（鋼より青みを抜いた鋳鉄の色） */
const IRON = ["#221f26", "#3d3a44", "#5f5b68", "#8e8898"];
/** 口の奥の暗がり */
const BORE = "#0c0b10";

function draw(frame) {
  // 木の銃把（握り）と前の握り
  paint(frame, polygon([[-2.4, -3], [2.6, -3], [1.6, 5.6], [-3.2, 5.2]], { round: 1.5 }), WOOD);
  paint(frame, polygon([[OFF_GRIP - 1.8, -3], [OFF_GRIP + 2, -3], [OFF_GRIP + 1.4, 4.2], [OFF_GRIP - 1.8, 4.2]], { round: 1.4 }), WOOD);
  // 用心鉄と引き金
  paint(frame, capsule(2.4, 1.6, 6, 1.6, 0.8), DARK_STEEL, { rim: false });
  paint(frame, capsule(6, -1.8, 6, 1.6, 0.8), DARK_STEEL, { rim: false });
  paint(frame, polygon([[3.2, -1.6], [4, -1.6], [3.8, 0.8], [3.2, 0.6]]), GOLD, { rim: false });
  // 筒（口へ向けてわずかに太る）
  paint(frame, capsule(TUBE_BACK, TUBE_Y, TUBE_FRONT, TUBE_Y, TUBE_R, TUBE_R + 0.4), IRON, { bias: 0.04 });
  // 喇叭の口（筒の先で開く）
  paint(
    frame,
    (x, y) => {
      if (x < TUBE_FRONT - 1 || x > MOUTH_X) return null;
      const t = (x - (TUBE_FRONT - 1)) / (MOUTH_X - TUBE_FRONT + 1);
      const r = TUBE_R + 0.4 + t * t * 3.2;
      const dy = y - TUBE_Y;
      if (Math.abs(dy) > r) return null;
      return { nx: 0.35 * t, ny: (dy / r) * 0.85 };
    },
    IRON,
  );
  // 口の縁の真鍮と奥の暗がり
  paint(frame, capsule(MOUTH_X - 0.6, TUBE_Y - 7.2, MOUTH_X - 0.6, TUBE_Y + 7.2, 1), GOLD);
  paint(frame, ellipse(MOUTH_X - 0.2, TUBE_Y, 0.9, 4.6), [BORE, BORE, BORE, BORE], { rim: false });
  // 砲尾の玉と尻の輪
  paint(frame, union(ellipse(TUBE_BACK - 2.2, TUBE_Y, 2.4, 2.8)), GOLD);
  paint(frame, capsule(TUBE_BACK + 0.2, TUBE_Y - TUBE_R - 0.6, TUBE_BACK + 0.2, TUBE_Y + TUBE_R + 0.6, 1.1), DARK_STEEL);
  // 担ぐ所の革巻き（巻きの筋）
  paint(frame, capsule(-13.5, TUBE_Y, -5.5, TUBE_Y, TUBE_R + 0.5), LEATHER);
  for (let x = -12.5; x < -5.5; x += 2) paint(frame, polygon([[x, TUBE_Y - TUBE_R - 0.5], [x + 0.8, TUBE_Y - TUBE_R - 0.5], [x + 0.3, TUBE_Y + TUBE_R + 0.5], [x - 0.5, TUBE_Y + TUBE_R + 0.5]]), LEATHER, { maxShade: 0, rim: false });
  // 真鍮の帯
  for (const bx of [-3, 7.5, 18]) paint(frame, capsule(bx, TUBE_Y - TUBE_R - 0.5, bx, TUBE_Y + TUBE_R + 0.5, 1.1), GOLD);
  // 帯の鋲
  for (const bx of [-3, 7.5, 18]) px(frame, bx, TUBE_Y - 1.5, "#efe0a0");
  // 上の照準（真鍮の小さな象限儀）
  paint(frame, polygon([[12, TUBE_Y - TUBE_R - 3.2], [14.4, TUBE_Y - TUBE_R - 3.2], [15, TUBE_Y - TUBE_R + 0.2], [11.6, TUBE_Y - TUBE_R + 0.2]], { round: 0.7 }), GOLD);
  // 導火の口
  paint(frame, ellipse(-17.5, TUBE_Y - TUBE_R - 0.4, 1.1, 1.1), DARK_STEEL);
  frame.anchor("muzzle", MOUTH_X + 0.6, TUBE_Y);
}

export const ATLAS = {
  key: "wpnCannon",
  sheets: weaponSheets("wpnCannon", draw, { size: 72 }),
  meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "heavy", restDeg: 0, restHand: [8, 4], swayDeg: 1, recoil: 1.8, parry: { hand: [2, 6], deg: -25, grip: -6, contact: 15 } } },
};
