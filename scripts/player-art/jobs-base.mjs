// 素材（docs/example/Graphics/Character/player/sample.png）の主人公を土台にした基本の見た目。
// ジョブはこの上に特徴を足す（肩当て・帽子・武器など）。色は素材から拾った値に寄せてある
import { Z, add, capsule, ellipse, intersect, grow, mid, poly, pt, union } from "./body.mjs";
import { common } from "./jobs2.mjs";

/** 素材の色（HSL）。暗い黒コートは明度の刻みを小さくして、黒の中の階調で形を見せる */
export const BASE_COLORS = {
  coat: ["#121118", "#1c1c26", "#2a2a36", "#3a3a4a", "#4e4c5e"],
  lining: ["#3e0e1a", "#5e1624", "#86202e", "#a8344a", "#c85468"],
  shirt: ["#6e6468", "#9a8e90", "#c4b8b8", "#e0d6d4", "#f4eeea"],
  pants: ["#0e0c14", "#17151f", "#22202c", "#2e2c3a", "#3c3a4a"],
  boots: ["#0c0b10", "#16151c", "#232230", "#33323f", "#4a4858"],
  glove: ["#0e0d13", "#18171f", "#24232e", "#32313e", "#44424f"],
  leather: ["#2a1410", "#3e2018", "#5a3024", "#74432f", "#8e5a40"],
  silver: ["#4a4c58", "#707482", "#9a9eaa", "#c4c8d0", "#eceef2"],
  hair: ["#0e0a10", "#19141c", "#262028", "#342c36", "#463c48"],
};
const SKIN_WARM = ["#8a4c44", "#b8705a", "#dea07a", "#f0c09a", "#f8dcc0"];

/** 捲った袖・紅の裏地の黒い長外套・白いシャツ・二重のベルト・革帯つきの長靴・無造作な黒髪 */
export function base(B, opts = {}) {
  common(B, SKIN_WARM);
  B.colors(BASE_COLORS);
  const { S, fig } = B;
  const silver = B.mats.silver;
  const lining = B.mats.lining;

  B.body({
    top: "coat",
    bottom: "pants",
    boots: "boots",
    sleeve: "coat",
    rolled: 0.5,
    cuff: "lining",
    glove: "glove",
    gloveLen: 0.32,
    bootH: 0.82,
    eye: "#1c1216",
  });
  B.hair("wild", "hair", { noStrands: false });

  // シャツの前（外套の合わせから覗く白）と紐タイ
  const nb = S.neckBase;
  const w = S.waist;
  const shirt = poly([add(nb, { x: 0.6, y: -1.2 }), add(nb, { x: fig.chestR + 2.5, y: -1.2 }), add(w, { x: fig.waistR + 2.5, y: 0 }), add(w, { x: fig.waistR - 1.8, y: 0 })]);
  B.over("shirt", "shirt", shirt, Z.torsoOver + 0.5, { group: "shirtG" });
  B.line(add(nb, { x: fig.chestR * 0.55, y: 0.5 }), add(w, { x: fig.waistR * 0.7, y: -1 }), B.mats.coat[0], "shirt", { from: 0.1 });
  // 合わせの紅い縁
  B.add("lapel", capsule(add(nb, { x: 0.8, y: -1 }), add(w, { x: fig.waistR - 1.6, y: 0 }), 0.75), "lining", Z.torsoOver + 0.7, { group: "shirtG", noLine: true });

  // 立ち襟（外は黒、内は紅）
  const collar = poly([add(nb, { x: -fig.neckR - 1.8, y: 1.2 }), add(nb, { x: -fig.neckR - 1.4, y: -fig.neck - 2.2 }), add(nb, { x: fig.neckR * 0.3, y: -fig.neck * 0.6 }), add(nb, { x: fig.neckR + 1.3, y: 1.4 })]);
  B.add("collar", collar, "coat", Z.neck + 1, { group: "collarG", R: 2 });
  B.add("collarIn", poly([add(nb, { x: -fig.neckR * 0.2, y: -fig.neck - 0.8 }), add(nb, { x: fig.neckR * 0.5, y: -fig.neck * 0.5 }), add(nb, { x: fig.neckR + 0.8, y: 1 }), add(nb, { x: -0.3, y: 0.6 })]), "lining", Z.neck + 1.2, { group: "collarG", noLine: true, flat: 0.6 });

  // 長い裾（前が割れて脚が見える）。紅の裏地・銀の縫い取り
  // 奥の身頃（奥の脚の後ろに垂れる）
  B.tails("coat", fig.thigh + fig.shin * 0.62, { name: "tailsBack", z: Z.legF - 1, group: "tailsBackG", frontX: -0.5, frontLen: 0.9, frontA: 2, flare: 2, trail: 16, noFolds: true, lining: "lining", liningW: 1.6 });
  const T = B.tails("coat", fig.thigh + fig.shin * 0.68, { frontX: fig.waistR * 0.15, slit: 0.05, flare: 3.5, trail: 12, frontLen: 0.92, frontA: -4, lining: "lining", liningW: 1.3 });
  const stitchA = mid(T.front0, T.back0, 0.6);
  const stitchB = mid(T.frontEnd, T.backEnd, 0.62);
  B.line(mid(stitchA, stitchB, 0.35), stitchB, B.mats.coat[3], "tails", { dash: 3, to: 0.92 });
  const yMark = mid(stitchA, stitchB, 0.78);
  B.line(yMark, add(yMark, { x: -1.5, y: 1.5 }), B.mats.coat[4], "tails");
  B.line(yMark, add(yMark, { x: 1.2, y: 1.6 }), B.mats.coat[4], "tails");

  // 腰のベルト（銀の四角い留め具）と、斜めに掛けた革帯と小袋
  B.belt("leather", 1.25, { buckle: silver[3], z: Z.tails + 1 });
  const bk = add(w, { x: fig.waistR + 0.3, y: 0.8 });
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
  ])
    B.mark(add(bk, { x: dx, y: dy }), silver[2]);
  const hipBelt = capsule(add(w, { x: fig.waistR + 0.5, y: 1.5 }), add(S.hip, { x: -fig.hipR - 0.5, y: 3.5 }), 0.8);
  B.add("hipBelt", intersect(hipBelt, grow(union(B.torsoF, B.pelvisF), 1.2)), "leather", Z.tails + 1.2, { group: "beltG" });
  B.add("pouch", ellipse(add(S.hip, { x: -fig.hipR + 0.5, y: 3.2 }), 1.6, 1.9), "leather", Z.tails + 1.4, { group: "pouchG", R: 1.6 });

  // 手前の袖の徽章と、肩の鋲
  const A = S.armN;
  const em = mid(A.sh, A.elbow, 0.38);
  B.add("emblem", ellipse(em, 1.35, 1.35), "silver", Z.armN + 1, { group: "armN", spec: true, noLine: true });
  B.mark(em, lining[2]);
  B.mark(add(A.sh, { x: 0.6, y: -1.4 }), silver[3]);
  B.mark(add(A.sh, { x: -1.0, y: -1.2 }), silver[2]);

  // 長靴の革帯（2 本）
  for (const [side, L] of [
    ["N", S.legN],
    ["F", S.legF],
  ]) {
    const d = { x: L.ankle.x - L.knee.x, y: L.ankle.y - L.knee.y };
    const len = Math.hypot(d.x, d.y) || 1;
    const n = { x: -d.y / len, y: d.x / len };
    for (const t of [0.42, 0.7]) {
      const c = mid(L.knee, L.ankle, t);
      B.line(add(c, n, -3), add(c, n, 3), side === "N" ? B.mats.leather[2] : B.mats.leather[1], `boot${side}`);
    }
    B.mark(add(mid(L.knee, L.ankle, 0.42), n, side === "N" ? 1 : 0), silver[2]);
  }

  const P = S.pose;
  // 鞘（納刀の行動だけ）: 腰の前から後ろ下へ
  if (P.scabbard) {
    const mouth = add(w, { x: fig.waistR * 0.6, y: 2.2 });
    const d = { x: Math.sin((-60 * Math.PI) / 180), y: Math.cos((-60 * Math.PI) / 180) };
    const tip = add(mouth, d, 18);
    B.add("scabbard", capsule(mouth, tip, 1.15, 0.9), "coat", Z.tails + 2, { group: "scabbardG", R: 1.2 });
    B.add("chape", capsule(add(tip, d, -2.2), tip, 1.05, 0.95), "silver", Z.tails + 2.2, { group: "scabbardG", spec: true });
    B.add("throat", capsule(mouth, add(mouth, d, 1.6), 1.3), "silver", Z.tails + 2.2, { group: "scabbardG", spec: true });
    if (P.hilt) {
      // 納めた柄: 鞘口から前上へ
      const u = { x: -d.x, y: -d.y };
      B.add("hiltGrip", capsule(add(mouth, u, 0.8), add(mouth, u, 4.2), 0.9), "leather", Z.tails + 2.4, { group: "scabbardG" });
      const n = { x: -u.y, y: u.x };
      B.add("hiltGuard", capsule(add(add(mouth, u, 0.8), n, -1.8), add(add(mouth, u, 0.8), n, 1.8), 0.8), "silver", Z.tails + 2.5, { group: "scabbardG", spec: true });
    }
  }
  // 手放した剣（倒れた姿勢）: 地面に横たわる
  if (P.dropWeapon && opts.weapon !== false) {
    const hand = pt(S.hip.x + P.dropWeapon.dx, B.groundY - 1.4);
    B.blade({ hand, a: P.dropWeapon.a, len: 17, w: 1.1, grip: 3.5, guard: 1.8, guardMat: "silver", taper: 5, mat: "silver" });
  }
  // 片手剣（素材の直刀）
  if (opts.weapon !== false && !P.noWeapon) {
    B.blade({ len: 17 * (P.bladeFrac ?? 1), w: 1.1, grip: 3.5, guard: 1.8, guardMat: "silver", taper: P.bladeFrac ? 0.5 : 5, mat: "silver" });
  }
}

export const BASE_JOB = { key: "base", name: "主人公（基本）", concept: "素材の主人公。捲った袖と紅の裏地の黒い長外套、白いシャツ、二重のベルト、革帯の長靴、無造作な黒髪", draw: base };
