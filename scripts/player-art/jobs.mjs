// ジョブごとの衣装。B は Builder（body.mjs）。色は [色相, 彩度, 明度]
import { Z, add, capsule, ellipse, subtract } from "./body.mjs";
import { BASE_JOB } from "./jobs-base.mjs";
import { MORE_JOBS, SKIN, common } from "./jobs2.mjs";

/** 見習い（ジョブなし）: 深層へ降りる駆け出しの探索者。旅装・頭巾つきの短い外套・腰の角灯・短剣 */
function none(B) {
  common(B, SKIN.fair);
  B.colors({
    shirt: [38, 0.22, 0.6],
    cloak: [30, 0.14, 0.36],
    pants: [215, 0.14, 0.3],
    boots: [26, 0.3, 0.27],
    wrap: [36, 0.2, 0.5],
    strap: [26, 0.38, 0.33],
    hair: [24, 0.3, 0.26],
    lamp: { hsl: [36, 0.95, 0.6], opts: { step: 0.1 } },
    brass: [42, 0.5, 0.46],
  });
  const { S, fig } = B;
  B.cape("cloak", fig.torso * 0.95 + fig.pelvis, { ragged: true });
  B.body({ top: "shirt", bottom: "pants", boots: "boots", sleeve: "shirt", glove: "wrap", gloveLen: 0.35, bootH: 0.5, bootCuff: "wrap" });
  B.hair("short", "hair");
  // 頭巾は下ろして肩に掛けている（首回りの布）
  B.add("hoodDown", ellipse(add(S.neckBase, { x: -1.5, y: 0.2 }), fig.chestR + 0.8, 2.6, -S.lean), "cloak", Z.neck + 2, { group: "hoodG", R: 2.5 });
  // 襷掛けの鞄の紐
  const s0 = add(S.neckBase, { x: 1.5, y: 1 });
  const s1 = add(S.waist, { x: -fig.waistR, y: 0 });
  B.add("strap", subtract(capsule(s0, s1, 0.8), subtract(ellipse(S.chest, 99, 99), B.torsoF)), "strap", Z.chestOver, { group: "strapG", noLine: true });
  B.belt("strap", 1.3, { buckle: B.mats.brass[3] });
  // 腰の角灯
  const lampC = add(S.waist, { x: -fig.waistR - 0.5, y: 3.5 + Math.sin(S.phase * Math.PI * 2) * 0.6 * S.speed });
  B.add("lampFrame", capsule(add(lampC, { x: 0, y: -2.4 }), add(lampC, { x: 0, y: 2 }), 1.7), "brass", Z.belt + 1, { group: "lampG" });
  B.add("lampGlass", ellipse(lampC, 0.9, 1.3), "lamp", Z.belt + 1.5, { group: "lampG", emissive: true, emissiveLevel: 4, noLine: true });
  // 短剣
  B.blade({ len: 11, w: 1.2, grip: 3, guard: 1.8, taper: 3 });
}

export const JOBS = [
  BASE_JOB,
  { key: "none", name: "見習い", concept: "深層へ降りる駆け出しの探索者。旅装と頭巾つきの短い外套、腰に角灯、短剣", draw: none },
  ...MORE_JOBS,
];
