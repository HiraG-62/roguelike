// クナイ（逆手に持つ黒鉄の短い刃）: 握り（拳）から刃が小指の側（+y）へ下がり、親指の側（−y）に輪の柄頭が出る。
// 逆手なので刃は武器の向き（+x）に直交し、少し後ろ（−x）へ倒す。刃は木の葉の形の両刃で、真ん中に稜線。
// 柄は藍の布巻き。左で投げるクナイは拳から出る（銃口の印 = 拳の前）
import { capsule, ellipse, paint, polygon, subtract } from "../paint.mjs";
import { DARK_STEEL, weaponSheets } from "../weapon.mjs";

const DEG = Math.PI / 180;
/** 刃の向き（武器の向き +x から、+y 側へ。90 = 真下、それより大きいと後ろへ倒れる） */
const BLADE_DEG = 104;
/** 柄の端（拳から刃の向きへ、ドット。負は輪の側）と刃の根元・切っ先 */
const HANDLE_BACK = -4.5;
const BLADE_ROOT = 3.5;
const BLADE_TIP = 17;
/** 刃のいちばん広い所（根元からの位置と半幅） */
const BLADE_WIDE_AT = 7.5;
const BLADE_HALF = 2.7;
/** 輪の柄頭（中心・外径・内径） */
const RING_AT = -7.8;
const RING_R = 3;
const RING_HOLE = 1.5;
/** 柄の太さ */
const HANDLE_R = 1.4;
/** 黒鉄の刃（鋼より暗く青みを抜く） */
const KUROGANE = ["#1b1a22", "#3a3b48", "#646879", "#a4aabd"];
/** 柄の藍の布（暗・基・明・艶） */
const CLOTH_INDIGO = ["#121524", "#222840", "#363e5e", "#525c82"];

const d = [Math.cos(BLADE_DEG * DEG), Math.sin(BLADE_DEG * DEG)];
const n = [-d[1], d[0]];
/** 刃の軸の座標（u = 刃の向き、v = 横）→ 正準座標 */
const P = (u, v) => [d[0] * u + n[0] * v, d[1] * u + n[1] * v];

function draw(frame) {
  // 刃: 根元は細く、広がってから切っ先へ鋭く細る両刃。稜線の両側で光を割る
  const edge = (side) => [P(BLADE_ROOT, side * 1.2), P(BLADE_WIDE_AT, side * BLADE_HALF), P(BLADE_TIP - 4, side * 1.6), P(BLADE_TIP, 0)];
  const left = edge(-1);
  const right = edge(1).reverse();
  paint(frame, polygon([...left, ...right], { round: 0.9 }), KUROGANE, { bias: 0.05 });
  // 稜線（切っ先へ向かう 1 本の明るい線）と、片面の陰
  paint(frame, polygon([P(BLADE_ROOT + 0.5, 0), P(BLADE_WIDE_AT, -0.5), P(BLADE_TIP - 1.5, 0), P(BLADE_WIDE_AT, 0.4)]), KUROGANE, { minShade: 2, maxShade: 3, rim: false });
  paint(frame, polygon([P(BLADE_ROOT + 1, 0.4), P(BLADE_WIDE_AT, BLADE_HALF - 0.6), P(BLADE_TIP - 3.5, 1.1), P(BLADE_WIDE_AT + 1, 0.6)]), KUROGANE, { minShade: 0, maxShade: 0, rim: false });
  // 柄: 刃の根元から輪の手前まで、藍の布を巻く（巻きの筋）
  const [hx0, hy0] = P(HANDLE_BACK, 0);
  const [hx1, hy1] = P(BLADE_ROOT, 0);
  paint(frame, capsule(hx0, hy0, hx1, hy1, HANDLE_R), CLOTH_INDIGO);
  for (let u = HANDLE_BACK + 1; u < BLADE_ROOT; u += 1.8) {
    paint(frame, polygon([P(u, -HANDLE_R), P(u + 0.8, -HANDLE_R), P(u + 0.2, HANDLE_R), P(u - 0.6, HANDLE_R)]), CLOTH_INDIGO, { maxShade: 0, rim: false });
  }
  // 刃の根元の黒鉄の口金
  const [cx0, cy0] = P(BLADE_ROOT - 0.6, 0);
  paint(frame, ellipse(cx0, cy0, 1.6, 1.6), DARK_STEEL, { rim: false });
  // 輪の柄頭（穴が抜ける）
  const [rx, ry] = P(RING_AT, 0);
  paint(frame, subtract(ellipse(rx, ry, RING_R, RING_R), ellipse(rx, ry, RING_HOLE, RING_HOLE)), KUROGANE, { bias: 0.1 });
  // 投げたクナイは拳の前から出る
  frame.anchor("muzzle", 3, 0);
}

export const ATLAS = {
  key: "wpnKunai",
  sheets: weaponSheets("wpnKunai", draw, { size: 48 }),
  meta: {
    offGrip: null,
    stance: { grip: "one", body: "light", restDeg: -15, restHand: [7, 6], swayDeg: 3, parry: { hand: [8, 1], deg: 160, contact: 9 } },
  },
};
