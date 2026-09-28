// 拳: 両手にはめる鉄の籠手。原点 = 手の中心、+x = 拳（拳頭）の向き。
// 後ろに金縁の張り出した手甲（前腕の覆い）、握った指を鋼の小札で包み、拳頭に金の鋲打ちの当て金。
// 絵がそのまま手になる（腕の先に拳を描かないので、手首から拳頭までを描く）
import { capsule, ellipse, paint, polygon, px as dot } from "../paint.mjs";
import { DARK_STEEL, GOLD, LEATHER, STEEL, weaponSheets } from "../weapon.mjs";

/** 握った指の溝（甲から見た指の境目の y） */
const FINGER_GROOVES = [-0.4, 1.9];
/** 当て金から前へ突き出す棘の y */
const SPIKES = [-2.6, 0.2, 3];
/** 絵全体の拡大（形は 1 の大きさで書き、ここで太らせる） */
const K = 1.15;
const P = (pts) => pts.map(([x, y]) => [x * K, y * K]);
const px = (frame, x, y, c) => dot(frame, x * K, y * K, c);

function draw(frame) {
  // 手甲（前腕の覆い）: 手首から後ろへ大きく広がる。黒鉄の筒に金の縁と鋲
  paint(frame, polygon(P([[-10, -5], [-3, -3.2], [-3, 3.4], [-10, 5.2]]), { round: 1.8 }), DARK_STEEL);
  paint(frame, polygon(P([[-10.4, -5.2], [-8.8, -4.8], [-8.8, 5], [-10.4, 5.4]]), { round: 0.8 }), GOLD);
  px(frame, -6.2, -1.6, GOLD[2]);
  px(frame, -6.2, 1.8, GOLD[1]);
  // 手首の革の締め帯
  paint(frame, polygon(P([[-4, -3.4], [-2, -3.3], [-2, 3.5], [-4, 3.6]]), { round: 0.8 }), LEATHER);
  // 握った拳: 丸みのある鋼の塊（甲は上、指は下へ巻き込む）
  paint(frame, ellipse(1.8 * K, 0.3 * K, 4.6 * K, 4.5 * K), STEEL);
  // 握った指の溝
  for (const y of FINGER_GROOVES) {
    paint(frame, capsule(1.6 * K, y * K, 5 * K, y * K, 0.55), STEEL, { maxShade: 0, rim: false });
  }
  // 親指: 甲の上から前へ添える
  paint(frame, capsule(-1.2 * K, -3.2 * K, 3 * K, -3.6 * K, 1.4 * K, 1.2 * K), STEEL, { bias: 0.1 });
  // 拳頭の当て金（指の付け根に渡す金の帯）と、前へ突き出す鋼の棘
  paint(frame, capsule(5.6 * K, -3.8 * K, 5.6 * K, 4.2 * K, 1.6 * K), GOLD);
  for (const y of SPIKES) {
    paint(frame, polygon(P([[6.4, y - 1.3], [9.2, y], [6.4, y + 1.3]]), { round: 0.6 }), STEEL, { bias: 0.15 });
  }
}

export const ATLAS = {
  key: "wpnFists",
  sheets: weaponSheets("wpnFists", draw, { size: 32 }),
  meta: {
    offGrip: null,
    stance: { grip: "dual", body: "light", worn: true, punch: true, restDeg: -50, restHand: [6, 3], offHand: [4, 4], offDeg: -40, swayDeg: 5 },
  },
};
