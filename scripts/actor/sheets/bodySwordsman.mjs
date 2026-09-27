// 剣士の体: 剣客。藍の羽織に白い着物、灰藍の袴、黒漆の鞘を腰に差し、鉢金を締めて髪を後ろで結う。
// 彩度は羽織の藍と、鉢金の紐・羽織紐・下げ緒の赤だけを立てる（白は灰を帯びさせて落とす）
import { capsule, clip, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#8a4c3c", "#c27f5f", "#dfa27c", "#f0c49e"];
const HAIR = ["#1a1824", "#2d2939", "#443e54", "#615a73"];
const INDIGO = ["#131a2d", "#22304f", "#334873", "#4a6495"];
const KIMONO = ["#5e5a66", "#9a96a0", "#c6c2c4", "#e6e2dc"];
const HAKAMA = ["#232534", "#3b4058", "#555b77", "#727995"];
const RED = ["#4a1519", "#80232a", "#ad3a36", "#d05c49"];
const OBI = ["#141219", "#26212d", "#393243", "#4f465b"];
const LACQUER = ["#0f0c12", "#221b25", "#3a2e3a", "#5a4757"];
const STEEL = ["#3a3e4b", "#6b7181", "#a2a9b7", "#dde2ea"];
const BRASS = ["#5c4726", "#8e733c", "#c2a153", "#e8d48e"];
const SANDAL = ["#1c1517", "#382925", "#523c34", "#6b5143"];
const EYE = "#1a1620";

/** 腕（実行時に描く）の色: 袖は羽織の藍、手は素肌 */
export const ARM_COLORS = { sleeve: [INDIGO[0], INDIGO[1], INDIGO[2]], hand: [SKIN[0], SKIN[1], SKIN[2]] };

/** 袴の脚: 腿から裾へ広がる。裾は足の甲にかかり、足袋と草履が覗く */
function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  // 足袋（白）と草履（焦げ茶の底）
  paint(frame, ellipse(foot.x + 2.2, foot.y - 1.6, 3.3, 1.7), KIMONO, { group: g, bias: dim - 0.1, maxShade: 2 });
  paint(frame, capsule(foot.x - 1.4, foot.y - 0.3, foot.x + 4.6, foot.y - 0.3, 0.8), SANDAL, { bias: dim, maxShade: 1 });
  // 袴: 腿は細め、脛から裾へ大きく広がる
  const hem = { x: foot.x + 0.4, y: foot.y - 3.4 };
  const k = frame.newGroup();
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 3, 3.2), capsule(kn.x, kn.y, hem.x, hem.y, 3.2, 4)), HAKAMA, { group: k, bias: dim });
  // 襞（ひだ）: 膝から裾へ 2 本の暗い筋
  for (const off of [-1.2, 1.4]) {
    for (let t = 0.2; t <= 1; t += 0.2) {
      const p = mid(kn, hem, t);
      px(frame, p.x + off * (0.8 + t * 0.5), p.y, HAKAMA[0]);
    }
  }
}

/** 腰の刀の鞘（奥の左腰に差す）: 柄が帯の前へ覗き、鞘尻が後ろへ下がって突き出す */
function saya(frame, sk) {
  const h = sk.hip;
  const s = sk.ps.sway;
  const hilt = { x: h.x + 10, y: h.y - 5.6 };
  const guard = { x: h.x + 3.2, y: h.y - 3 };
  const end = { x: h.x - 15 - s * 0.6, y: h.y + 2.6 + s * 0.4 };
  paint(frame, capsule(guard.x, guard.y, end.x, end.y, 1.3, 1.15), LACQUER, { bias: 0.1 });
  // 鞘尻の金具
  paint(frame, capsule(end.x + 1.2, end.y - 0.3, end.x, end.y, 1.3), BRASS, { maxShade: 2 });
  // 柄（白い柄巻に黒の菱）と鍔
  paint(frame, capsule(guard.x + 0.8, guard.y - 0.25, hilt.x, hilt.y, 1.15), OBI, { bias: 0.3 });
  for (let t = 0.25; t < 1; t += 0.3) px(frame, guard.x + (hilt.x - guard.x) * t, guard.y + (hilt.y - guard.y) * t, KIMONO[1]);
  paint(frame, ellipse(guard.x + 0.3, guard.y - 0.1, 0.9, 2), BRASS, { maxShade: 2 });
  // 下げ緒（赤い紐）が鞘から垂れる
  const cord = { x: guard.x - 2.5, y: guard.y + 1 };
  paint(frame, union(capsule(cord.x, cord.y, cord.x - 2 - s, cord.y + 3, 0.6), capsule(cord.x - 2 - s, cord.y + 3, cord.x - 4 - s * 1.6, cord.y + 2.5, 0.6)), RED, { maxShade: 2, rim: false });
}

/** 羽織の後ろの裾（腿まで。歩くと後ろへなびく） */
function haoriTail(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const s = sk.ps.sway;
  paint(
    frame,
    polygon(
      [
        [c.x - 6, c.y - 3],
        [c.x + 1, c.y],
        [h.x + 1, h.y + 5],
        [h.x - 5 - s * 2.5, h.y + 6.5],
        [h.x - 8 - s * 3.5, h.y + 3],
      ],
      { round: 2.5, tilt: { nx: -0.2, ny: 0.1 } },
    ),
    INDIGO,
    { bias: -0.2 },
  );
}

function torso(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const n = sk.neck;
  const g = frame.newGroup();
  // 着物（白）: 胴全体
  paint(
    frame,
    polygon(
      [
        [c.x - 5.5, c.y - 5],
        [c.x + 5, c.y - 5],
        [c.x + 6, c.y + 1],
        [h.x + 5.5, h.y + 1.5],
        [h.x - 5, h.y + 1.5],
        [c.x - 6, c.y + 1],
      ],
      { round: 3 },
    ),
    KIMONO,
    { group: g, maxShade: 2 },
  );
  // 着物の衿の合わせ（首元から斜めに下りる線）
  for (let t = 0; t <= 1; t += 0.2) px(frame, n.x + 4.5 - t * 1.5, n.y + 1 + t * 5, KIMONO[0]);
  // 帯（黒に近い藍）と赤い帯締め
  paint(frame, capsule(h.x - 5.2, h.y - 1.6, h.x + 5.8, h.y - 1.6, 1.9), OBI, { group: g, maxShade: 2 });
  for (let x = -4; x <= 5; x++) px(frame, h.x + x, h.y - 1.6, RED[1]);
  // 羽織: 背中側から胸の前の端までを覆い、前は開いて着物と帯が覗く
  const front = c.x + 2.2;
  const hg = frame.newGroup();
  paint(
    frame,
    polygon(
      [
        [c.x - 6.2, c.y - 5.5],
        [front + 1.5, c.y - 5.5],
        [front, c.y + 1],
        [h.x + 1.6, h.y + 4],
        [h.x - 5.6, h.y + 4.5],
        [c.x - 6.8, c.y + 1],
      ],
      { round: 3 },
    ),
    INDIGO,
    { group: hg },
  );
  // 羽織の衿（前の縁の明るい帯）
  for (let t = 0; t <= 1.001; t += 0.125) {
    const x = lerpN(front + 1.2, h.x + 1.3, t);
    const y = lerpN(c.y - 5, h.y + 3.5, t);
    px(frame, x, y, INDIGO[2]);
  }
  // 背の家紋（白い小さな輪）
  stamp(frame, Math.round(c.x - 4), Math.round(c.y - 3), [".w.", "w.w", ".w."], { w: KIMONO[2] });
  // 羽織紐（赤い房）
  stamp(frame, Math.round(front + 1), Math.round(c.y - 1), ["rr", ".r", ".R"], { r: RED[2], R: RED[1] });
}

function lerpN(a, b, t) {
  return a + (b - a) * t;
}

/** 結った髪（後頭部から後ろへなびくポニーテール） */
function ponytail(frame, sk) {
  const h = sk.head;
  const s = sk.ps.sway;
  const root = { x: h.x - 5, y: h.y - 5.5 };
  const a = { x: root.x - 3.5 - s * 0.6, y: root.y + 0.4 - s * 0.4 };
  const b = { x: a.x - 3 - s * 1.6, y: a.y + 3.8 - s * 1.2 };
  const tip = { x: b.x - 1.2 - s * 2.2, y: b.y + 5 - s * 1.2 };
  paint(frame, union(capsule(root.x, root.y, a.x, a.y, 1.9, 1.8), capsule(a.x, a.y, b.x, b.y, 1.8, 1.3), capsule(b.x, b.y, tip.x, tip.y, 1.3, 0.5)), HAIR, { bias: 0.1 });
  // 毛の流れの艶
  px(frame, a.x + 1, a.y - 1, HAIR[3]);
  px(frame, a.x, a.y - 0.8, HAIR[2]);
  // 元結い（赤）
  paint(frame, ellipse(root.x - 0.6, root.y + 0.2, 1.1, 1.9), RED, { maxShade: 2 });
}

/** 鉢金の紐の端: 後頭部の結び目から 2 本なびく */
function bandTails(frame, sk, fx, fy) {
  const s = sk.ps.sway;
  const knot = { x: fx - 9, y: fy - 3.2 };
  for (const [dy, len, r] of [
    [0, 7.5, 0.9],
    [1.4, 6, 0.8],
  ]) {
    const a = { x: knot.x, y: knot.y + dy };
    const b = { x: a.x - len * 0.5, y: a.y + 1.3 - s * 1.1 };
    const c = { x: a.x - len - s * 1.6, y: a.y + 2.4 - s * 2 };
    paint(frame, union(capsule(a.x, a.y, b.x, b.y, r + 0.2, r), capsule(b.x, b.y, c.x, c.y, r, r * 0.7)), RED, { maxShade: 2 });
  }
}

function head(frame, sk) {
  const h = sk.head;
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  bandTails(frame, sk, fx, fy);
  const g = frame.newGroup();
  // 頭（黒髪の丸み）
  paint(frame, ellipse(h.x - 0.8, h.y - 0.8, 7.4, 7.4), HAIR, { group: g, bias: -0.15, maxShade: 2 });
  // 顔（格子に揃える）
  const face = frame.newGroup();
  paint(frame, faceShape(fx, fy), SKIN, { group: face });
  // 前髪: 鉢金の下から額へ尖った毛束が下りる
  paint(
    frame,
    union(
      ellipse(fx - 1, fy - 4.8, 5.4, 1.8),
      polygon([[fx - 4.6, fy - 5], [fx - 3.4, fy - 0.2], [fx - 2, fy - 4]]),
      polygon([[fx - 2.2, fy - 4.4], [fx - 1, fy - 2.4], [fx + 0.6, fy - 4.4]]),
      polygon([[fx + 1.8, fy - 4.4], [fx + 3.6, fy - 2.2], [fx + 4.6, fy - 4.4]]),
    ),
    HAIR,
    { group: face, bias: 0.15 },
  );
  // 揉み上げ（顔の後ろの縁）
  paint(frame, polygon([[fx - 4.8, fy - 3], [fx - 3.4, fy - 3], [fx - 3.6, fy + 2.2], [fx - 4.8, fy + 1]]), HAIR, { group: face });
  // 鉢金: 頭を一巡りする紺の鉢巻（額の上の帯）と、額の前の鋼の板
  paint(frame, clip(clip(ellipse(h.x - 0.8, h.y - 0.8, 7.9, 7.9), 0, 1, fy - 3.6), 0, -1, -(fy - 6.2)), RED, { maxShade: 2 });
  paint(frame, polygon([[fx - 0.4, fy - 6.4], [fx + 5, fy - 6.4], [fx + 5.2, fy - 3.2], [fx - 0.4, fy - 3.2]], { round: 1.2 }), STEEL, { bias: 0.1 });
  // 板の鋲と艶
  px(frame, fx + 0.5, fy - 4.5, STEEL[0]);
  px(frame, fx + 4, fy - 4.5, STEEL[0]);
  px(frame, fx + 1.5, fy - 5.5, STEEL[3]);
  px(frame, fx + 2.5, fy - 5.5, STEEL[3]);
  // 頭頂の髪の艶
  px(frame, h.x - 3.5, h.y - 7, HAIR[3]);
  px(frame, h.x - 2.5, h.y - 7.2, HAIR[3]);
  px(frame, h.x - 4.5, h.y - 6, HAIR[2]);
  // 眼: 1 ドット幅 × 2 の縦長の点を 2 つ（凛とした細め。間を 2 ドット空ける）
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy - 1, ["k", "k"], FACE_INK);
  // 口元の影
  px(frame, fx + 1, fy + 3, SKIN[0]);
}

const FACE_INK = { k: EYE };

/** 顔: ほぼ一色、頬に小さな明部、あごの縁にだけ影（bodyNone と同じ決まり） */
function faceShape(cx, cy) {
  const rx = 5.4;
  const ry = 5.6;
  return (x, y) => {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const d = nx * nx + ny * ny;
    if (d > 1 || x < cx - 4.6) return null;
    if (ny > 0.55 && d > 0.72) return 0;
    if (Math.hypot(x - (cx - 2.6), y - (cy + 1.6)) < 0.75) return 2;
    return 1;
  };
}

function draw(frame, sk) {
  leg(frame, sk, "B");
  saya(frame, sk);
  haoriTail(frame, sk);
  leg(frame, sk, "F");
  torso(frame, sk);
  ponytail(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodySwordsman",
  sheets: bodySheets("bodySwordsman", draw),
  meta: { arm: ARM_COLORS },
};
