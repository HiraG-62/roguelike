// 大鎌: 死神の長柄の鎌。黒い木の長柄に鉄の帯金、先の口金から刃が振りの向き（-y）へ張り出し、切っ先は握りの側へ鉤に巻き込む。
// 刃は黒鉄の峰（外の凸側）と鋼の刃（内の凹側）の二色で、刃の縁に艶。口金に赤い布を結び、柄の尻に鉄の石突。
// エフェクト（scripts/fx/sheets/scythe.mjs）の「外縁の弧 + 内へ巻く鉤」と同じ読みになるよう、刃は浅い弧に沿わせる
import { capsule, ellipse, paint, polygon, px, union } from "../paint.mjs";
import { CLOTH_RED, DARK_STEEL, GOLD, STEEL, shaft, weaponSheets } from "../weapon.mjs";

/** 黒く焼いた柄の木（死神の暗い色。WOOD より彩度を落とす） */
const DARK_WOOD = ["#1c1619", "#33282a", "#4b3b3a", "#64504b"];
/** 添える後ろの手（握りから柄の尻の側へ） */
const OFF_GRIP = -14;
/** 柄の先（口金の中心）と刃の弧の中心・半径 */
const HEAD_X = 40;
/** 刃の弧は大きな半径で浅く反らせる（小さな半径で深く巻くと鉤に見えすぎる） */
const ARC_CX = -12;
const ARC_CY = 4.5;
const ARC_R = 56;

/** 弧の上の点（中心 ARC、半径 r、角 a 度。0 = +x、-90 = -y） */
function arcPt(r, a) {
  const t = (a * Math.PI) / 180;
  return [ARC_CX + Math.cos(t) * r, ARC_CY + Math.sin(t) * r];
}

/** 刃の外形: 口金から -y へ弧に沿い、先で内へ鉤に巻き込む。外（峰）の半径 rOut、内（刃）の半径 rIn を角ごとに細らせる */
function bladeOutline() {
  const outer = [];
  const inner = [];
  const A0 = -6;
  const A1 = -52;
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const a = A0 + (A1 - A0) * u;
    // 峰の半径: 先へ行くほど内へ巻き込む（鉤）
    const rOut = ARC_R - 3 * Math.pow(u, 2.4);
    // 刃の幅: 根元で太く、先で尖る
    const w = 9.5 * Math.pow(1 - u, 0.75) + 0.3;
    outer.push(arcPt(rOut, a));
    inner.push(arcPt(rOut - w, a));
  }
  return { outer, inner };
}

function draw(frame) {
  // 長柄と帯金
  shaft(frame, -26, HEAD_X - 1, 1.6, DARK_WOOD, [-18, -4, 8, 24], DARK_STEEL);
  // 石突（尖った鉄の石突）
  paint(frame, polygon([[-25, -2.2], [-30, -1], [-33, 0], [-30, 1], [-25, 2.2]], { round: 1.2 }), DARK_STEEL);
  // 手の添える場所の巻き革（握りと添え手）
  paint(frame, capsule(-2.5, 0, 3, 0, 2), DARK_STEEL, { minShade: 0, maxShade: 1 });
  paint(frame, capsule(OFF_GRIP - 2.5, 0, OFF_GRIP + 3, 0, 2), DARK_STEEL, { minShade: 0, maxShade: 1 });

  // 刃（峰の黒鉄 → 刃の鋼の二色）
  const { outer, inner } = bladeOutline();
  const whole = [...outer, ...inner.slice().reverse()];
  paint(frame, polygon(whole, { round: 1.4, tilt: { nx: 0.1, ny: -0.25 } }), STEEL);
  // 峰の帯（外の凸側の半分を黒鉄に）
  const spine = outer.map((p, i) => {
    const q = inner[i] ?? p;
    const k = 0.42;
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  });
  paint(frame, polygon([...outer.slice(0, -2), ...spine.slice(0, -2).reverse()], { round: 1, tilt: { nx: 0.2, ny: -0.3 } }), DARK_STEEL, { rim: false, maxShade: 1, bias: -0.1 });
  // 刃の縁の艶（内の凹側に沿う 1 本の線）
  for (let i = 1; i < inner.length - 3; i++) {
    const p = inner[i];
    const q = inner[i + 1];
    if (!p || !q) continue;
    for (let s = 0; s < 3; s++) {
      const t = s / 3;
      const x = p[0] + (q[0] - p[0]) * t;
      const y = p[1] + (q[1] - p[1]) * t;
      // 刃の中へ半ドット寄せる（輪郭の上に乗せない）
      const dx = x - ARC_CX;
      const dy = y - ARC_CY;
      const d = Math.hypot(dx, dy) || 1;
      px(frame, x + (dx / d) * 1.1, y + (dy / d) * 1.1, STEEL[3]);
    }
  }

  // 刃の付け根の黒鉄の座金と鋲
  paint(frame, polygon([[HEAD_X - 6, -4.5], [HEAD_X + 3.5, -5.5], [HEAD_X + 4.5, 3], [HEAD_X - 5, 3]], { round: 1.3 }), DARK_STEEL);
  // 口金（金の輪 2 本）
  paint(frame, union(capsule(HEAD_X - 8.5, 0, HEAD_X - 6.5, 0, 2.6)), GOLD);
  paint(frame, ellipse(HEAD_X - 0.5, -0.5, 1.3, 1.3), GOLD, { bias: 0.2 });
  // 柄の先の飾り（頭の上の尖り）
  paint(frame, polygon([[HEAD_X + 3.5, -2.5], [HEAD_X + 8.5, 0], [HEAD_X + 3.5, 2.5]], { round: 1 }), DARK_STEEL);
  // 口金に結んだ赤い布（柄に沿って後ろへ垂れる）
  paint(frame, polygon([[HEAD_X - 11, 1.5], [HEAD_X - 9, 1.5], [HEAD_X - 12, 7], [HEAD_X - 16, 8.5], [HEAD_X - 14.5, 5]], { round: 1.3 }), CLOTH_RED);
  paint(frame, polygon([[HEAD_X - 10.5, 1.5], [HEAD_X - 9, 1.5], [HEAD_X - 8, 6.5], [HEAD_X - 10, 7.5]], { round: 1 }), CLOTH_RED, { bias: -0.15 });
}

export const ATLAS = {
  key: "wpnScythe",
  sheets: weaponSheets("wpnScythe", draw, { size: 104, edge: true }),
  meta: { offGrip: OFF_GRIP, stance: { grip: "two", body: "heavy", restDeg: -68, restHand: [7, 8], restMirror: true, swayDeg: 2 } },
};
