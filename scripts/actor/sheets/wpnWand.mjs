// 杖: 黒檀の柄に金の帯を巻いた短い錫杖。先に金の爪で紫の宝珠を抱える。魔法は宝珠から出る（muzzle の印）
import { capsule, ellipse, paint, polygon, px } from "../paint.mjs";
import { GOLD, LEATHER, weaponSheets } from "../weapon.mjs";

/** 黒檀（柄） */
const EBONY = ["#1c1620", "#302633", "#4a3b4c", "#6a5868"];
/** 宝珠（識別色の紫） */
const GEM = ["#2e1650", "#5b31a3", "#9868e6", "#ecdcff"];
/** 宝珠の中心 */
const ORB_X = 22;
const ORB_R = 4.6;

function draw(frame) {
  // 柄（革巻き）と柄頭
  paint(frame, capsule(-5, 0, 3, 0, 1.4), LEATHER);
  paint(frame, ellipse(-6, 0, 1.8, 1.8), GOLD);
  // 黒檀の柄: 先へ少し太る
  paint(frame, capsule(3, 0, ORB_X - 3, 0, 1.5, 2), EBONY);
  // 金の帯
  for (const x of [3.6, 8.5, 12]) paint(frame, (px_, py) => (Math.abs(px_ - x) > 0.7 || Math.abs(py) > 2.3 ? null : { nx: 0, ny: (py / 2.3) * 0.85 }), GOLD);
  // 爪の台座
  paint(frame, polygon([[ORB_X - 6, -1.8], [ORB_X - 3, -3.2], [ORB_X - 2, 0], [ORB_X - 3, 3.2], [ORB_X - 6, 1.8]], { round: 1.2 }), GOLD);
  // 宝珠
  paint(frame, ellipse(ORB_X, 0, ORB_R, ORB_R), GEM);
  // 宝珠を抱える金の爪（上下の 2 本が前へ回り込み、先に鋼の穂）
  const R = ORB_R;
  for (const s of [-1, 1]) {
    paint(frame, polygon([[ORB_X - R, s * (R * 0.55)], [ORB_X - R * 0.3, s * (R + 1.1)], [ORB_X + R * 0.7, s * (R + 0.9)], [ORB_X + R + 0.6, s * (R * 0.6)], [ORB_X + R * 0.5, s * (R * 0.75)], [ORB_X - R * 0.2, s * (R * 0.8)]]), GOLD);
  }
  paint(frame, polygon([[ORB_X + R - 1, -1.1], [ORB_X + R + 4, 0], [ORB_X + R - 1, 1.1]]), GOLD, { bias: 0.2 });
  // 宝珠の芯の光（画面に揃えた 1 ドット）
  px(frame, ORB_X - 1.4, -1.4, GEM[3]);
  frame.anchor("muzzle", ORB_X + ORB_R + 4, 0);
}

export const ATLAS = { key: "wpnWand", sheets: weaponSheets("wpnWand", draw, { size: 68 }), meta: { offGrip: null, stance: { grip: "one", body: "ready", restDeg: -55, restHand: [7, 6], swayDeg: 3, parry: { hand: [10, 1], deg: -74, off: [10, 4], contact: 14 } } } };
