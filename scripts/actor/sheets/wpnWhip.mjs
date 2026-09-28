// 鞭: 金具の付いた革巻きの柄の先に、編んだ生革の鞭を輪にまとめて巻いて持つ。巻きから短い先端が垂れ、先に赤い房。
// 振りの長い線はエフェクト（scripts/fx/sheets/whip.mjs）が描くので、手の絵は「巻いた束」にして回しても不自然にしない。
// 振りの間は束を解いた絵（wpnWhip.swing: 柄と口金から出る鞭の根元だけ）に替え、エフェクトのしなる線を鞭そのものに見せる
import { capsule, ellipse, paint, polygon, px } from "../paint.mjs";
import { CLOTH_RED, DARK_STEEL, GOLD, LEATHER, grip, pommel, weaponSheets } from "../weapon.mjs";

/** 編んだ生革（黄土の明るい革。エフェクトの軌跡 #d0a060 と同じ系統） */
const RAWHIDE = ["#3e2a1c", "#7a5534", "#a87c4c", "#d0a468"];

/**
 * 楕円の輪（管の太さ r）。中心 (cx, cy)、半径 a（+x）・b（+y）、tilt は輪の傾き（rad）。
 * from / to は輪の一部だけ塗る角の範囲（rad、省けば一周）
 */
function loop(cx, cy, a, b, r, tilt = 0, from = -Math.PI, to = Math.PI) {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return (x, y) => {
    const dx0 = x - cx;
    const dy0 = y - cy;
    const dx = dx0 * c + dy0 * s;
    const dy = -dx0 * s + dy0 * c;
    const th = Math.atan2(dy / b, dx / a);
    if (th < from || th > to) return null;
    const ex = a * Math.cos(th);
    const ey = b * Math.sin(th);
    const ox = dx - ex;
    const oy = dy - ey;
    const d = Math.hypot(ox, oy);
    if (d > r) return null;
    const k = d / r;
    const lx = ((ox / (d || 1)) * c - (oy / (d || 1)) * s) * k;
    const ly = ((ox / (d || 1)) * s + (oy / (d || 1)) * c) * k;
    return { nx: lx, ny: ly, nz: Math.sqrt(1 - k * k) };
  };
}

/** 編み目: 輪に沿って暗い点を刻む（1 ドットの線で編んだ革に見せる） */
function braid(frame, cx, cy, a, b, tilt, n, phase = 0) {
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  for (let i = 0; i < n; i++) {
    const th = phase + (i / n) * Math.PI * 2;
    const ex = a * Math.cos(th);
    const ey = b * Math.sin(th);
    px(frame, cx + ex * c - ey * s, cy + ex * s + ey * c, RAWHIDE[0]);
  }
}

/** 柄: 革巻き、尻に金の柄頭 */
function handle(frame) {
  grip(frame, -4, 7, 1.7, LEATHER);
  pommel(frame, -5.6, 2.2, GOLD);
}

/** 振りの間の絵: 束を解き、口金から鞭の根元が細って伸びる（その先はエフェクトの線が続ける） */
function drawSwing(frame) {
  handle(frame);
  paint(frame, capsule(8.5, 0, 17, 0, 1.2, 0.9), RAWHIDE);
  braid(frame, 12.5, 0, 4, 0.4, 0, 6, 0);
  paint(frame, capsule(6.8, 0, 9.2, 0, 2.2, 1.9), GOLD);
}

function draw(frame) {
  // 柄: 革巻き、尻に金の柄頭、先に金の口金
  handle(frame);
  // 巻いた束（奥の輪 → 手前の輪。口金の先に下がる）
  const coil = [
    [17.6, -0.4, 9.4, 6.4, -0.28],
    [15.4, 2.2, 7.4, 6.6, 0.3],
    [16.6, 0.9, 8.4, 5.4, 0.02],
  ];
  for (const [cx, cy, a, b, t] of coil) {
    paint(frame, loop(cx, cy, a, b, 0.95, t), RAWHIDE, { bias: 0.05 });
    braid(frame, cx, cy, a, b, t, 16, t * 3);
  }
  // 束を締める黒鉄の輪帯
  paint(frame, polygon([[8.2, -3.2], [10.6, -3.8], [11.2, 3.6], [8.8, 4]], { round: 1 }), DARK_STEEL);
  // 口金（柄の先。束の根元を締める）
  paint(frame, capsule(6.8, 0, 9.2, 0, 2.2, 1.9), GOLD);
  // 垂れた先端: 束の下から外へ細って伸び、先に赤い房
  paint(frame, capsule(21, 6.4, 27, 8.6, 1.1, 0.8), RAWHIDE);
  paint(frame, capsule(27, 8.4, 30.5, 8, 0.8, 0.6), RAWHIDE);
  paint(frame, polygon([[30, 7], [34.5, 6.2], [35, 8], [34, 10.2], [30.2, 9]], { round: 1.2 }), CLOTH_RED);
  paint(frame, ellipse(30.2, 8, 1.1, 1.1), GOLD);
}

export const ATLAS = {
  key: "wpnWhip",
  sheets: [
    ...weaponSheets("wpnWhip", draw, { size: 80 }),
    // 振りの間だけ使う解いた絵（実行時の renderer.ts が `<武器>.swing` があれば振りの間に替える）
    ...weaponSheets("wpnWhip", drawSwing, { size: 48 }).map((sheet) => ({ ...sheet, key: "wpnWhip.swing" })),
  ],
  // rope: 戻しで垂れて巻き戻る縄（実行時の render/whipRope.ts）の革の色（暗・基・明）・先の房の色と、握りから縄の出る所（解いた絵の根元の先）
  meta: { offGrip: null, stance: { grip: "one", body: "light", restDeg: 40, restHand: [7, 8], swayDeg: 4 }, rope: { colors: RAWHIDE.slice(0, 3), tip: CLOTH_RED[1], from: 17 } },
};
