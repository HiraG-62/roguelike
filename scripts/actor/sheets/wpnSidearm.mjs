// 片手銃（後ろの手を銃把の下に添えて構える。meta.offGrip）: 真鍮の輪胴を持つ重い回転式拳銃。長めの銃身・照星・木の銃把。銃口の位置を印で渡す
//
// 空いた手の逆手の短刀（`wpnSidearm.dagger`。右の段「短刀斬り」daggerCut で後ろの手に持つ）: 原点 = 握り。
// 逆手なので刃は武器の向き（+x）に直交して小指の側（+y）へ下がり、少し後ろへ倒す。片刃で刃は前（+x）の側、峰は後ろ。
// 黒の柄巻きに真鍮の小さな鍔と柄頭。どの段で何の絵を使うかは meta.stepArt（描画側の配線は段 7 の報告）
import { capsule, ellipse, paint, polygon } from "../paint.mjs";
import { DARK_STEEL, GOLD, LEATHER, STEEL, WOOD, weaponSheets } from "../weapon.mjs";

const K = 1.3;
const P = (pts) => pts.map(([x, y]) => [x * K, y * K]);

function draw(frame) {
  // 銃把（手の中から下後ろへ）
  paint(frame, polygon(P([[-1.5, -2], [2.5, -2], [1.5, 3], [-0.5, 5.5], [-3.5, 5], [-2.5, 1]]), { round: 1.5 }), WOOD);
  // 用心鉄
  paint(frame, capsule(2 * K, 1.8 * K, 4.8 * K, 1.8 * K, 0.8), DARK_STEEL, { rim: false });
  // 機関部
  paint(frame, polygon(P([[-2.5, -4.8], [6, -4.8], [6, -0.8], [-1.5, -0.8]]), { round: 1.2 }), DARK_STEEL);
  // 撃鉄
  paint(frame, polygon(P([[-3.8, -6.2], [-1.8, -6], [-1.2, -4.4], [-2.6, -4.4]])), DARK_STEEL);
  // 真鍮の輪胴
  paint(frame, ellipse(3.5 * K, -2.9 * K, 2.6 * K, 2.2 * K), GOLD);
  // 銃身と上の帯
  paint(frame, capsule(5.5 * K, -3.2 * K, 16 * K, -3.2 * K, 1.35 * K), STEEL);
  paint(frame, capsule(5.5 * K, -4.6 * K, 15 * K, -4.6 * K, 0.6), DARK_STEEL, { rim: false });
  // 照星
  paint(frame, polygon(P([[14.5, -5.9], [15.8, -5.9], [15.8, -4.4], [14.5, -4.4]])), GOLD, { rim: false });
  frame.anchor("muzzle", 17 * K, -3.2 * K);
}

const DEG = Math.PI / 180;
/** 短刀の刃の向き（+x から +y 側へ。90 = 真下、大きいほど後ろへ倒れる） */
const DAGGER_DEG = 100;
const DAGGER_ROOT = 3.8;
const DAGGER_TIP = 18;
/** 柄の尻（拳から輪の側へ） */
const DAGGER_BACK = -5.5;

function drawDagger(frame) {
  const d = [Math.cos(DAGGER_DEG * DEG), Math.sin(DAGGER_DEG * DEG)];
  // v の正は刃の向きから見て +x（前）の側 = 刃、負は峰
  const n = [d[1], -d[0]];
  const P = (u, v) => [d[0] * u + n[0] * v, d[1] * u + n[1] * v];
  // 刃: 峰はまっすぐ、刃の側は切っ先へ反り上がる片刃
  paint(
    frame,
    polygon([P(DAGGER_ROOT, -1.3), P(DAGGER_TIP - 3, -1.3), P(DAGGER_TIP, -0.4), P(DAGGER_TIP - 2.5, 1), P(DAGGER_ROOT + 5, 1.9), P(DAGGER_ROOT, 1.9)], { round: 0.8 }),
    STEEL,
    { bias: 0.05 },
  );
  // 刃文（刃の側の縁の明るい筋）
  paint(frame, polygon([P(DAGGER_ROOT + 1, 1), P(DAGGER_ROOT + 5, 1.2), P(DAGGER_TIP - 2.6, 0.5), P(DAGGER_TIP - 2.6, 0), P(DAGGER_ROOT + 1, 0.3)]), STEEL, { minShade: 3, maxShade: 3, rim: false });
  // 柄（黒の巻き）と鍔・柄頭
  const [a0, b0] = P(DAGGER_BACK, 0);
  const [a1, b1] = P(DAGGER_ROOT - 0.5, 0);
  paint(frame, capsule(a0, b0, a1, b1, 1.4), LEATHER);
  for (let u = DAGGER_BACK + 1; u < DAGGER_ROOT - 1; u += 1.8) paint(frame, polygon([P(u, -1.4), P(u + 0.8, -1.4), P(u + 0.2, 1.4), P(u - 0.6, 1.4)]), LEATHER, { maxShade: 0, rim: false });
  const [tx, ty] = P(DAGGER_ROOT - 0.2, 0.2);
  paint(frame, ellipse(tx, ty, 2.4, 2.4), GOLD);
  const [kx, ky] = P(DAGGER_BACK - 0.6, 0);
  paint(frame, ellipse(kx, ky, 1.7, 1.7), GOLD);
}

export const ATLAS = {
  key: "wpnSidearm",
  sheets: [...weaponSheets("wpnSidearm", draw, { size: 56 }), ...weaponSheets("wpnSidearm", drawDagger, { size: 48 }).map((s) => ({ ...s, key: "wpnSidearm.dagger" }))],
  meta: {
    offGrip: -1.5,
    stance: { grip: "two", body: "aim", restDeg: 0, restHand: [8, 4], swayDeg: 1, parry: { hand: [9, 3], deg: -70, off: [10, 4], contact: 8 } },
    // 右の段の間だけ持ち替える絵（シートの接尾辞と、持つ手。off = 空いた後ろの手）
    stepArt: { daggerCut: { sheet: "dagger", hand: "off" } },
  },
};
