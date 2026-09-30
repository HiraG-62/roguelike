// 書: 帯に吊るす写本（girdle book）。握りは革の結び目で、編んだ細い革紐の先の金の環に牛血色の革の本を吊る。
// 表紙に金の角金具と中央の留め鋲（淡い紫の宝石）、背は握りの側、先の小口と下の縁に頁の束の厚み。
// 振りの頁の舞いはエフェクト（fx レーン）が描く。
// 外縁は近接の当たり判定（data/meleeReach.test.ts。書の外縁は最大 24px）に揃え、握りから小口まで 32 ドット（論理 16px）
import { capsule, ellipse, paint, polygon, px, subtract } from "../paint.mjs";
import { GOLD, weaponSheets } from "../weapon.mjs";

/** 表紙の革（牛血色） */
const COVER = ["#34121c", "#5a1e2c", "#80303c", "#a44c52"];
/** 覆いと結び目の革（表紙より褪せた茶） */
const STRAP = ["#2a1a18", "#4a2e28", "#6a4436", "#86604a"];
/** 頁の束（生成り） */
const PAGES = ["#6e6250", "#b8a888", "#ddd0b0", "#f4ecd6"];
/** 留め鋲の宝石（術の識別色の淡い紫） */
const GEM = ["#3a2466", "#6a48b0", "#a88ae8", "#ece0ff"];

/** 本の範囲（背 = 握りの側、先 = 小口）と半幅 */
const BOOK_X0 = 14.5;
const BOOK_X1 = 30;
const HALF = 6.5;
/** 頁の束が小口から出る先 */
const PAGE_X1 = 32.2;
/** 頁の束が下の縁から出る厚み */
const PAGE_DEPTH = 1.6;
/** 革紐と環 */
const CORD_R = 0.9;
const RING_X = 12.6;

function draw(frame) {
  // 頁の束（小口と下の縁。表紙の裏から厚みとして覗く）
  paint(frame, polygon([[BOOK_X0 + 2, -HALF + 1], [PAGE_X1, -HALF + 1.3], [PAGE_X1, HALF + PAGE_DEPTH - 0.4], [BOOK_X0 + 2, HALF + PAGE_DEPTH]], { round: 0.6 }), PAGES, { maxShade: 2, bias: 0.1 });
  for (const y of [-3.5, -0.5, 2.5, 5]) for (let x = BOOK_X1 + 0.5; x < PAGE_X1 - 0.3; x++) px(frame, x, y, PAGES[1]);
  for (let x = BOOK_X0 + 3; x < BOOK_X1; x += 2) px(frame, x, HALF + PAGE_DEPTH - 0.6, PAGES[1]);
  // 編んだ革紐（結び目から環へ。1 ドットおきに暗い編み目）
  paint(frame, capsule(1, 0, RING_X - 1, 0, CORD_R), STRAP, { bias: 0.1 });
  for (let x = 2; x < RING_X - 1; x += 2) px(frame, x, x % 4 === 0 ? -0.5 : 0.5, STRAP[0]);
  // 表紙
  paint(frame, polygon([[BOOK_X0, -HALF], [BOOK_X1, -HALF], [BOOK_X1, HALF], [BOOK_X0, HALF]], { round: 1.6 }), COVER);
  // 背（握りの側の丸い背と、背の帯の筋）
  paint(frame, capsule(BOOK_X0 + 0.8, -HALF + 0.6, BOOK_X0 + 0.8, HALF - 0.6, 1.4), COVER, { bias: -0.15 });
  for (const y of [-3, 0, 3]) px(frame, BOOK_X0 + 1, y, COVER[3]);
  // 表紙の縁の型押し（内側の暗い枠）
  for (let x = BOOK_X0 + 3.5; x <= BOOK_X1 - 2; x++) {
    px(frame, x, -HALF + 2, COVER[0]);
    px(frame, x, HALF - 2, COVER[0]);
  }
  for (let y = -HALF + 2; y <= HALF - 2; y++) {
    px(frame, BOOK_X0 + 3.5, y, COVER[0]);
    px(frame, BOOK_X1 - 2.5, y, COVER[0]);
  }
  // 小口側の角金具（2 隅の金の三角）
  for (const sy of [-1, 1]) {
    paint(frame, polygon([[BOOK_X1, sy * HALF], [BOOK_X1 - 4, sy * HALF], [BOOK_X1, sy * (HALF - 4)]]), GOLD, { rim: false, bias: 0.1 });
  }
  // 中央の留め鋲: 金の台座に淡い紫の宝石
  const mx = (BOOK_X0 + 2 + BOOK_X1) / 2;
  paint(frame, ellipse(mx, 0, 2.9, 2.9), GOLD);
  paint(frame, ellipse(mx, 0, 1.8, 1.8), GEM, { rim: false, bias: 0.2 });
  px(frame, mx - 0.8, -0.8, GEM[3]);
  // 小口の留め具（表紙から頁の束へ掛かる金の帯）
  paint(frame, polygon([[BOOK_X1 - 2.5, -1.2], [PAGE_X1 + 0.2, -1], [PAGE_X1 + 0.2, 1], [BOOK_X1 - 2.5, 1.2]], { round: 0.6 }), GOLD, { bias: 0.1 });
  // 背の金の環（革紐を通す）
  paint(frame, subtract(ellipse(RING_X, 0, 2, 2), ellipse(RING_X, 0, 0.8, 0.8)), GOLD, { bias: 0.1 });
  // 結び目（握り）: 革の玉と、締めた筋
  paint(frame, ellipse(-0.5, 0, 2.6, 2.4), STRAP, { bias: 0.1 });
  px(frame, -0.5, -1, STRAP[0]);
  px(frame, 0, 1, STRAP[0]);
  frame.anchor("muzzle", PAGE_X1 + 1, 0);
}

export const ATLAS = {
  key: "wpnBook",
  sheets: weaponSheets("wpnBook", draw, { size: 76 }),
  meta: { offGrip: null, stance: { grip: "one", body: "ready", restDeg: -30, restHand: [7, 6], swayDeg: 4 } },
};
