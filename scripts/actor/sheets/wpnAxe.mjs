// 斧（ハルバード）: 長柄の先に三日月の大きな斧刃、反対に鉤爪、先端に槍穂。
// 斧刃は黒鉄の地に鋼の刃（二色）、付け根に金の口金と鋲、柄は鉄の帯金で巻き、尻に石突。
// 片頭なので写しの絵（heldM）も持つ。斧刃は正準の -y（上）側、鉤爪は +y 側
import { capsule, ellipse, paint, polygon, px, union } from "../paint.mjs";
import { DARK_STEEL, GOLD, STEEL, WOOD, shaft, weaponSheets } from "../weapon.mjs";

/** 添える後ろの手（握りから柄の尻の側へ） */
const OFF_GRIP = -13;
/** 斧頭の付け根（柄の上の口金の中心） */
const HEAD_X = 27;

/** 斧刃: 付け根は柄に沿ってくびれ、外へ扇形に開く。刃の縁は膨らんだ三日月で、前後の角が張り出す */
const AXE_BODY = [
  [HEAD_X - 3.5, -1.5],
  [HEAD_X + 4, -1.5],
  [HEAD_X + 3.5, -5],
  [HEAD_X + 6, -9.5],
  [HEAD_X + 11.5, -15.5],
  [HEAD_X + 6, -18.2],
  [HEAD_X, -19],
  [HEAD_X - 6, -18],
  [HEAD_X - 11, -15],
  [HEAD_X - 14, -10.5],
  [HEAD_X - 9, -10.8],
  [HEAD_X - 5.5, -8.5],
  [HEAD_X - 3, -5],
];
/** 刃の縁の帯（外周の三日月。鋼で明るく） */
const AXE_EDGE = [
  [HEAD_X + 9, -13],
  [HEAD_X + 11.5, -15.5],
  [HEAD_X + 6, -18.2],
  [HEAD_X, -19],
  [HEAD_X - 6, -18],
  [HEAD_X - 11, -15],
  [HEAD_X - 14, -10.5],
  [HEAD_X - 11, -11.6],
  [HEAD_X - 7, -14],
  [HEAD_X - 1, -15.2],
  [HEAD_X + 4.5, -14.6],
];
/** 鉤爪: 柄から反対へ出て、柄の尻の側へ鋭く曲がる */
const HOOK = [
  [HEAD_X - 2.5, 1.2],
  [HEAD_X + 3, 1.2],
  [HEAD_X + 2.5, 5],
  [HEAD_X, 8.5],
  [HEAD_X - 4, 11.5],
  [HEAD_X - 9.5, 13],
  [HEAD_X - 5.5, 9],
  [HEAD_X - 2.6, 5],
];

function draw(frame) {
  // 柄: 木の芯に鉄の帯金（握りの間は空ける）
  shaft(frame, -22, HEAD_X + 4, 1.5, WOOD, [-18, 16], DARK_STEEL);
  // 口金から柄を下る鉄の当て板（柄を斬り落とされないため）
  paint(frame, capsule(18, 0, HEAD_X, 0, 1.7), DARK_STEEL, { bias: 0.1 });
  px(frame, 20, -0.6, DARK_STEEL[3]);
  // 石突: 尖った鉄の尻
  paint(frame, union(capsule(-25, 0, -21, 0, 2, 1.7), polygon([[-25, -1.6], [-25, 1.6], [-29.5, 0]])), DARK_STEEL);
  // 鉤爪（奥の面を暗く）
  paint(frame, polygon(HOOK, { round: 1.2, tilt: { nx: 0, ny: 0.25 } }), DARK_STEEL);
  paint(frame, polygon([[HEAD_X + 0.5, 5], [HEAD_X + 2.2, 4.4], [HEAD_X - 1.5, 9.6], [HEAD_X - 7.5, 12.4], [HEAD_X - 4.5, 9.6]]), STEEL, { rim: false, maxShade: 2 });
  // 斧刃: 黒鉄の地に鋼の三日月の刃
  paint(frame, polygon(AXE_BODY, { round: 1.5, tilt: { nx: 0.1, ny: -0.25 } }), DARK_STEEL);
  paint(frame, polygon(AXE_EDGE, { round: 1.4, tilt: { nx: 0.05, ny: -0.45 } }), STEEL);
  // 刃の縁の艶（上縁の左寄り）
  paint(frame, polygon([[HEAD_X - 9, -15.6], [HEAD_X - 5, -17.4], [HEAD_X + 1, -18.2], [HEAD_X + 1, -17.2], [HEAD_X - 5, -16.4], [HEAD_X - 9, -14.6]]), STEEL, { minShade: 3, maxShade: 3, rim: false });
  // 斧刃の透かし（重さを抜く穴）
  paint(frame, ellipse(HEAD_X - 0.5, -9.5, 1.4, 1.4), DARK_STEEL, { minShade: 0, maxShade: 0, rim: false });
  // 口金: 金の筒に鋲 2 つ
  paint(frame, capsule(HEAD_X - 4.5, 0, HEAD_X + 4.5, 0, 2.6, 2.4), GOLD);
  paint(frame, capsule(HEAD_X - 4.5, 0, HEAD_X - 3.3, 0, 3), GOLD, { bias: -0.15 });
  px(frame, HEAD_X - 1.5, -0.8, GOLD[3]);
  px(frame, HEAD_X + 2, -0.8, GOLD[3]);
  // 槍穂: 口金の先に細長い菱形
  paint(
    frame,
    (x, y) => {
      const t = (x - (HEAD_X + 4)) / 14;
      if (t < 0 || t > 1) return null;
      const w = t < 0.25 ? 1.3 + t * 8 : 3.3 * Math.pow(1 - (t - 0.25) / 0.75, 1.1) + 0.1;
      if (Math.abs(y) > w) return null;
      return y < 0 ? { nx: 0.2, ny: -0.8 } : { nx: 0.2, ny: 0.6 };
    },
    STEEL,
  );
  paint(frame, polygon([[HEAD_X + 6, -0.35], [HEAD_X + 16, -0.2], [HEAD_X + 16, 0.2], [HEAD_X + 6, 0.35]]), STEEL, { minShade: 3, maxShade: 3, rim: false });
}

export const ATLAS = {
  key: "wpnAxe",
  sheets: weaponSheets("wpnAxe", draw, { size: 100, edge: true }),
  meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "heavy", restDeg: -62, restHand: [7, 9], swayDeg: 2, restMirror: true } },
};
