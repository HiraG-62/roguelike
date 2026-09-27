// 呪術師（hexer）の体: 紫黒のぼろのローブと深い頭巾、白い仮面（眼の穴）、骨の首飾りと呪符。裾は裂けてなびく。
// 彩度は毒の緑（呪符の文字・腰の小瓶・仮面の筋）だけを立て、ローブの紫は暗く落とす
import { capsule, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const ROBE = ["#21162e", "#3a2750", "#553a70", "#74518f"];
const ROBE_IN = ["#120e17", "#1d1624", "#2a2033", "#382b42"];
const MASK = ["#8f8778", "#d8d0bc", "#ece6d4", "#fbf8ee"];
const BONE = ["#6f6656", "#b8ae94", "#d9d0b6", "#f0ead6"];
const WRAP = ["#1b1719", "#2f2829", "#463c3a", "#5d514c"];
const PAPER = ["#7d7358", "#c9bd98", "#e2d8b6", "#f2ecd4"];
const POISON = ["#1f4a22", "#3f8a2e", "#78c63c", "#c2f070"];
const CORD = ["#2a1a14", "#4a2e20", "#6a4430", "#86583e"];
/** 腰の帯（毒に染みた緑の布） */
const SASH = ["#16301c", "#265a2a", "#3f8a2e", "#78c63c"];
const EYE = "#0f0b14";
const GLYPH = "#2f6b24";

/** 腕（実行時に描く）の色: 袖はローブ、手は黒ずんだ包帯 */
export const ARM_COLORS = { sleeve: [ROBE[0], ROBE[1], ROBE[2]], hand: [WRAP[1], WRAP[2], WRAP[3]] };

function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  // 包帯を巻いた細い脚と、布を巻いた足
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 2.4, 2.1), capsule(kn.x, kn.y, foot.x, foot.y - 2.5, 2.1, 2)), WRAP, { group: g, bias: dim });
  paint(frame, ellipse(foot.x + 1.3, foot.y - 1.4, 3.2, 1.7), WRAP, { group: g, bias: dim - 0.1 });
  // 巻き布の筋（脛に斜めの線）
  for (const t of [0.35, 0.6, 0.85]) {
    const p = mid(kn, foot, t);
    px(frame, p.x - 1, p.y, WRAP[0]);
    px(frame, p.x, p.y - 0.6, WRAP[0]);
    px(frame, p.x + 1, p.y - 1.2, WRAP[0]);
  }
}

/** 背中側のローブの裾（後ろへなびき、裂けた端） */
function robeBack(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const s = sk.ps.sway;
  const hemY = h.y + 9;
  paint(
    frame,
    polygon(
      [
        [c.x - 5, c.y - 4],
        [c.x + 2, c.y - 4],
        [h.x + 1, hemY - 2],
        [h.x - 2 - s * 2, hemY + 1],
        [h.x - 4 - s * 2.5, hemY - 1.5],
        [h.x - 6 - s * 3, hemY + 1.5],
        [h.x - 8 - s * 3.5, hemY - 1],
        [h.x - 10.5 - s * 4, hemY + 0.5],
        [h.x - 9 - s * 2.5, h.y - 1],
      ],
      { round: 2.5, tilt: { nx: -0.2, ny: 0.1 } },
    ),
    ROBE_IN,
  );
}

/** 胴と前のローブ（膝の下まで、裾は裂けてぎざぎざ） */
function robeFront(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const s = sk.ps.sway;
  const kn = mid(sk.kneeF, sk.kneeB);
  const hemY = Math.max(h.y + 8, kn.y + 2.5);
  // 裾の広がりは足の開きに合わせる（歩き・構えで脚を覆いすぎない）
  const fx = Math.max(h.x + 5.5, sk.kneeF.x + 2.5);
  const bx = Math.min(h.x - 6, sk.kneeB.x - 2.5);
  const g = frame.newGroup();
  const hem = [];
  const teeth = 6;
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    const x = fx + (bx - fx) * t - s * t * 1.5;
    // 裂けた端: 長短を交互に（決まった並びで、フレームごとにちらつかない）
    const drop = [1.5, -0.8, 2.2, -0.5, 1.2, -1, 2][i] ?? 0;
    hem.push([x, hemY + drop]);
  }
  paint(
    frame,
    polygon(
      [
        [c.x - 5.5, c.y - 5],
        [c.x + 5, c.y - 5],
        [c.x + 6, c.y + 1],
        [h.x + 5.5, h.y + 1],
        ...hem,
        [h.x - 5.5, h.y + 1],
        [c.x - 6, c.y + 1],
      ],
      { round: 3 },
    ),
    ROBE,
    { group: g },
  );
  // 前合わせの影と、裾の裂け目の線
  for (let y = c.y - 3; y < hemY; y += 1) px(frame, c.x + 2 + (y - c.y) * 0.1, y, ROBE[0]);
  px(frame, fx + (bx - fx) * 0.25, hemY - 1, ROBE[0]);
  px(frame, fx + (bx - fx) * 0.25, hemY - 2, ROBE[0]);
  px(frame, fx + (bx - fx) * 0.62, hemY - 1, ROBE[0]);
  // 毒に染みた緑の帯と、垂れる端
  paint(frame, capsule(h.x - 5.5, h.y - 1.5, h.x + 5.5, h.y - 1.5, 1.2), SASH, { group: g, bias: 0.1, maxShade: 2 });
  paint(frame, capsule(h.x + 1.5, h.y - 1, h.x + 0.5 - s * 0.8, h.y + 5, 0.9, 0.7), SASH, { bias: 0.05, maxShade: 2 });
}

/** 帯から下がる呪符（紙に緑の文字）と毒の小瓶 */
function charms(frame, sk) {
  const h = sk.hip;
  const s = sk.ps.sway;
  const tx = Math.round(h.x - 3 - s * 0.6);
  const ty = Math.round(h.y - 0.5);
  paint(frame, polygon([[tx - 1.2, ty], [tx + 1.8, ty], [tx + 1.8 - s * 0.6, ty + 6], [tx - 1.2 - s * 0.6, ty + 6.5]]), PAPER, { maxShade: 2, bias: 0.2 });
  stamp(frame, tx - 0.2, ty + 1, ["g", "", "gg", "g"], { g: GLYPH });
  // 小瓶（毒の緑）
  const vx = h.x + 4;
  const vy = h.y + 1.5;
  paint(frame, ellipse(vx, vy + 0.5, 1.6, 1.9), POISON);
  px(frame, vx, vy - 1.6, CORD[2]);
}

/** 肩を覆うぼろの肩掛け（頭巾から続く。端が裂けて垂れる） */
function shawl(frame, sk) {
  const n = sk.neck;
  const s = sk.ps.sway;
  paint(
    frame,
    polygon(
      [
        [n.x - 7, n.y - 1],
        [n.x + 5, n.y - 1],
        [n.x + 7, n.y + 4],
        [n.x + 5, n.y + 7],
        [n.x + 3, n.y + 5.5],
        [n.x + 1, n.y + 8],
        [n.x - 2, n.y + 6],
        [n.x - 4.5, n.y + 8.5],
        [n.x - 6 - s, n.y + 6],
        [n.x - 9 - s * 1.5, n.y + 7.5],
      ],
      { round: 3 },
    ),
    ROBE,
    { bias: 0.1 },
  );
}

/** 骨の首飾り: 紐に小さな骨の珠と、胸元に牙 */
function boneNecklace(frame, sk) {
  const n = sk.neck;
  const beads = [
    [-3.5, 3],
    [-1.5, 4.2],
    [2.5, 4.4],
    [4.5, 3.2],
  ];
  for (let x = -4; x <= 5; x++) px(frame, n.x + x, n.y + 3 + (1.4 - Math.abs(x - 0.5) * 0.28), CORD[1]);
  for (const [dx, dy] of beads) paint(frame, ellipse(n.x + dx, n.y + dy, 1.1, 1.1), BONE, { rim: false, maxShade: 2 });
  // 胸元の牙（下へ尖る）
  const fx = Math.round(n.x + 0.5);
  const fy = Math.round(n.y + 4);
  stamp(frame, fx - 1, fy, ["bbb", "ab", "a"], { a: BONE[1], b: BONE[2] });
}

function head(frame, sk) {
  const h = sk.head;
  const s = sk.ps.sway;
  const g = frame.newGroup();
  // 深い頭巾: 頭より大きく、先が後ろへ垂れて尖る（上へは伸ばしすぎない）
  paint(
    frame,
    union(
      ellipse(h.x - 0.5, h.y - 0.8, 8.8, 8.6),
      polygon([[h.x - 5, h.y - 6], [h.x - 12 - s * 2, h.y + 3], [h.x - 10 - s * 1.5, h.y + 4], [h.x - 5, h.y + 5]], { round: 2 }),
    ),
    ROBE,
    { group: g },
  );
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  // 頭巾の内側の闇（仮面の周りを沈める）
  paint(frame, ellipse(fx + 0.2, fy + 0.2, 6, 6.4), ROBE_IN, { group: g, flat: true, maxShade: 0 });
  // 仮面: ほぼ一色の白。頬に明部 2 ドット、あごの縁にだけ影
  const mask = frame.newGroup();
  paint(frame, maskShape(fx, fy), MASK, { group: mask });
  // 頭巾の縁（額の上を覆い、仮面を奥に見せる）
  paint(frame, hoodRim(fx, fy - 0.5), ROBE, { group: g, bias: 0.35 });
  // 眼の穴: 1 ドット幅 × 2 の縦長の点を 2 つ（間を空ける）
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy - 1, ["k", "k"], FACE_INK);
  // 仮面の呪いの筋（左の眼の下に 1 ドット空けて毒の緑の線。眼とつなげると眼が縦に伸びて見える）。口は描かない（仮面なので）
  px(frame, fx, fy + 2, POISON[1]);
  px(frame, fx, fy + 3, POISON[1]);
}

const FACE_INK = { k: EYE };

/** 仮面: 顔と同じ大きさの楕円を一色で。前へ少しだけ張り出し、あごは細くする */
function maskShape(cx, cy) {
  const rx = 5;
  const ry = 5.4;
  return (x, y) => {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const narrow = ny > 0.3 ? 1 + (ny - 0.3) * 0.6 : 1;
    const d = nx * nx * narrow * narrow + ny * ny;
    if (d > 1 || x < cx - 4) return null;
    if (ny > 0.55 && d > 0.7) return 0;
    if (Math.hypot(x - (cx - 2.4), y - (cy + 1.4)) < 0.75) return 2;
    return 1;
  };
}

/** 頭巾の縁（仮面を囲む厚み）のうち、額の上と後ろ側 */
function hoodRim(cx, cy) {
  const outer = ellipse(cx - 0.4, cy, 7.6, 7.8);
  return (x, y) => {
    const nx = (x - cx) / 5.6;
    const ny = (y - cy) / 6;
    if (nx * nx + ny * ny <= 1) return null;
    if (y > cy - 2.5 && x > cx - 3.5) return null;
    return outer(x, y);
  };
}

function draw(frame, sk) {
  leg(frame, sk, "B");
  robeBack(frame, sk);
  leg(frame, sk, "F");
  robeFront(frame, sk);
  charms(frame, sk);
  shawl(frame, sk);
  boneNecklace(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyHexer",
  sheets: bodySheets("bodyHexer", draw),
  meta: { arm: ARM_COLORS },
};
