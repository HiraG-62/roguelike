// 手裏剣（指に挟んだ四方の星形）: 拳の前（人差し指と中指の間）に黒鉄の四方手裏剣を 1 枚挟む。
// 4 本の尖りは少し傾けて回して見せ、真ん中に穴が抜ける。尖りの片側の面だけ明るくして刃の稜を出す。
// 投げた手裏剣は挟んだ星の中心から出る（銃口の印）
import { ellipse, paint, polygon, subtract } from "../paint.mjs";
import { weaponSheets } from "../weapon.mjs";

const DEG = Math.PI / 180;
/** 星の中心（拳の前、少し親指の側） */
const CX = 6.5;
const CY = -2.5;
/** 尖りの先・付け根の半径と、尖りの傾き（度） */
const R_TIP = 7.5;
const R_ROOT = 2.6;
const TILT = 18;
/** 真ん中の穴 */
const HOLE = 1.2;
/** 黒鉄（クナイと同じ） */
const KUROGANE = ["#1b1a22", "#3a3b48", "#646879", "#a4aabd"];

function at(r, deg) {
  return [CX + Math.cos(deg * DEG) * r, CY + Math.sin(deg * DEG) * r];
}

/** 4 本の尖りを持つ星（尖りの間は付け根の半径まで凹む） */
function starPoints() {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = TILT + i * 90;
    pts.push(at(R_TIP, a), at(R_ROOT, a + 45));
  }
  return pts;
}

function draw(frame) {
  paint(frame, subtract(polygon(starPoints(), { round: 1 }), ellipse(CX, CY, HOLE, HOLE)), KUROGANE, { bias: 0.05 });
  // 尖りの稜: 各尖りの前の半分（時計回りの側）だけ明るい面にする（回って見えるように片側だけ）
  for (let i = 0; i < 4; i++) {
    const a = TILT + i * 90;
    paint(frame, polygon([at(R_ROOT * 0.9, a), at(R_TIP - 0.6, a), at(R_ROOT, a + 40)]), KUROGANE, { minShade: 2, maxShade: 2, rim: false });
  }
  frame.anchor("muzzle", CX, CY);
}

export const ATLAS = {
  key: "wpnShuriken",
  sheets: weaponSheets("wpnShuriken", draw, { size: 40 }),
  meta: {
    offGrip: null,
    stance: { grip: "one", body: "light", restDeg: -25, restHand: [7, 6], swayDeg: 3, parry: { hand: [8, 2], deg: -60, contact: 7 } },
  },
};
