// 見習い（ジョブなし）の体: 深層へ潜る探索者。頭巾付きの短い外套、赤い襟巻き、革の胴着、長靴。
// 世界観（深層の遺跡・修道院・死神）に合わせ、彩度は襟巻きの赤だけを立てて他は落とす
import { capsule, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#8a4c3c", "#c27f5f", "#dfa27c", "#f0c49e"];
const HAIR = ["#2a1c1f", "#46302d", "#644437", "#7e5a45"];
const HOOD = ["#1c2a2e", "#2c4446", "#3f6061", "#577f7d"];
const TUNIC = ["#33221f", "#553729", "#77503a", "#946c4c"];
const SCARF = ["#4a1820", "#7c2830", "#a63d3c", "#c9614f"];
const PANTS = ["#1f1f2a", "#313245", "#46485e", "#5d6078"];
const BOOTS = ["#1c1517", "#382925", "#523c34", "#6b5143"];
const BRASS = ["#5c4726", "#8e733c", "#c2a153", "#e8d48e"];
const EYE = "#1a1620";

/** 腕（実行時に描く）の色: 袖 3 段・手 3 段 */
export const ARM_COLORS = { sleeve: [TUNIC[0], TUNIC[1], TUNIC[2]], hand: [BOOTS[1], BOOTS[2], BOOTS[3]] };

function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 2.5, 2.1), capsule(kn.x, kn.y, foot.x, foot.y - 3, 2.1, 2)), PANTS, { group: g, bias: dim });
  // 長靴: 脛の下半分から爪先まで
  const shin = mid(kn, foot, 0.35);
  paint(frame, union(capsule(shin.x, shin.y, foot.x, foot.y - 2, 2.6, 2.7), ellipse(foot.x + 1.6, foot.y - 1.4, 3.6, 1.8)), BOOTS, { group: g, bias: dim });
  // 折り返し
  paint(frame, capsule(shin.x - 0.3, shin.y, shin.x + 0.3, shin.y + 0.4, 3.1), BOOTS, { group: g, bias: dim + 0.2, maxShade: 2 });
}

function scarfTail(frame, sk) {
  const n = sk.neck;
  const s = sk.ps.sway;
  // 首の後ろから後ろへなびく 2 本の細い端（腕と見間違えない細さ・高さ）
  for (const [dy, len, r] of [
    [0, 9, 1.3],
    [1.8, 7, 1.1],
  ]) {
    const a = { x: n.x - 3, y: n.y + dy };
    const b = { x: a.x - len * 0.55, y: a.y + 1.5 - s * 1.2 };
    const c = { x: a.x - len - s * 2, y: a.y + 2.5 - s * 2.2 };
    paint(frame, union(capsule(a.x, a.y, b.x, b.y, r + 0.3, r), capsule(b.x, b.y, c.x, c.y, r, r * 0.7)), SCARF, { bias: -0.1, maxShade: 2 });
  }
}

function cloakBack(frame, sk) {
  const c = sk.chest;
  const s = sk.ps.sway;
  // 背中側に垂れる外套の裾（後ろへなびく）
  paint(
    frame,
    polygon(
      [
        [c.x - 5, c.y - 5],
        [c.x + 2, c.y - 5],
        [c.x + 1, sk.hip.y + 3],
        [c.x - 6 - s * 3, sk.hip.y + 4 + Math.abs(s)],
        [c.x - 9 - s * 3, sk.hip.y + 1],
      ],
      { round: 2.5, tilt: { nx: -0.2, ny: 0.1 } },
    ),
    HOOD,
    { bias: -0.2 },
  );
}

function torso(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const g = frame.newGroup();
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
    TUNIC,
    { group: g },
  );
  // 胴着の前合わせ（縫い目）
  for (let y = c.y - 3; y < h.y + 1; y += 1) px(frame, c.x + 2.5 + (y - c.y) * 0.08, y, TUNIC[0]);
  // 帯と真鍮の留め金
  paint(frame, capsule(h.x - 5, h.y - 1.5, h.x + 5.5, h.y - 1.5, 1.4), BOOTS, { group: g, bias: 0.1, maxShade: 2 });
  paint(frame, ellipse(h.x + 2.5, h.y - 1.5, 1.6, 1.6), BRASS, { rim: false });
  // 腰の小物入れ
  paint(frame, ellipse(h.x - 4, h.y + 0.5, 2.2, 2), TUNIC, { bias: 0.15 });
}

function capelet(frame, sk) {
  const n = sk.neck;
  const s = sk.ps.sway;
  // 肩を覆う短い外套（頭巾から続く）。前は胸の上まで、後ろは肩甲骨まで
  paint(
    frame,
    polygon(
      [
        [n.x - 7, n.y - 1],
        [n.x + 5, n.y - 1],
        [n.x + 7, n.y + 4],
        [n.x + 4, n.y + 7],
        [n.x - 2, n.y + 7.5],
        [n.x - 8 - s, n.y + 6],
      ],
      { round: 3 },
    ),
    HOOD,
  );
  // 外套の縁取り（裾の 1 段暗い線）
  for (let x = -7; x <= 4; x++) px(frame, n.x + x, n.y + 6.5 + (x < -1 ? (x + 1) * -0.15 : (x + 1) * 0.1), HOOD[0]);
}

function head(frame, sk) {
  const h = sk.head;
  const g = frame.newGroup();
  // 頭巾の後ろ（頭より大きく、後ろへ尖る）
  paint(
    frame,
    union(ellipse(h.x - 0.4, h.y - 0.4, 7, 6.9), polygon([[h.x - 5, h.y - 4], [h.x - 9 - sk.ps.sway * 1.2, h.y + 1], [h.x - 4, h.y + 4]], { round: 1.8 })),
    HOOD,
    { group: g },
  );
  // 顔は画素の格子に揃えて置く（眼の形がフレームごとに崩れないように）
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  const face = frame.newGroup();
  paint(frame, faceShape(fx, fy), SKIN, { group: face });
  // 前髪: 頭の丸みで陰を付けた髪の塊から、毛束が額へ尖って下りる（平らな帯にしない）
  paint(
    frame,
    union(
      ellipse(fx - 0.7, fy - 3.8, 4.6, 1.9),
      polygon([[fx - 3.7, fy - 4.1], [fx - 2.6, fy - 0.4], [fx - 1.5, fy - 3.3]]),
      polygon([[fx - 1.8, fy - 3.7], [fx - 0.5, fy - 1.8], [fx + 0.7, fy - 3.6]]),
      polygon([[fx + 0.3, fy - 3.7], [fx + 1.8, fy - 1.6], [fx + 2.6, fy - 3.4]]),
      polygon([[fx + 2.1, fy - 3.6], [fx + 3.6, fy - 2.1], [fx + 3.8, fy - 3.8]]),
    ),
    HAIR,
    { group: face, bias: 0.15 },
  );
  // 髪の艶（左上の毛束に短い光の筋）
  px(frame, fx - 2, fy - 4, HAIR[3]);
  px(frame, fx - 1, fy - 4, HAIR[3]);
  // 頭巾の縁: 額の上と後ろ側だけ（顔の前を覆わない）
  paint(frame, hoodRim(fx, fy - 0.4), HOOD, { group: g, bias: 0.3 });
  // 眼: 縦長の小さな点を 2 つ（塊にすると眼鏡に見えるので、1 ドット幅で間を空ける）
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2, fy - 1, ["k", "k"], FACE_INK);
}

const FACE_INK = { k: EYE };

/**
 * 顔: ほぼ一色で塗り、頬に小さな明部、あごの縁にだけ影（光で顔の前が暗く沈まないように法線を使わない。
 * 明暗を面で分けると顔の上下で色がくっきり割れて見えるので、明部と影は数ドットに留める）
 */
function faceShape(cx, cy) {
  const rx = 4.5;
  const ry = 4.7;
  return (x, y) => {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const d = nx * nx + ny * ny;
    if (d > 1 || x < cx - 3.8) return null;
    if (ny > 0.55 && d > 0.72) return 0;
    if (Math.hypot(x - (cx - 2.1), y - (cy + 1.3)) < 0.7) return 2;
    return 1;
  };
}

/** 頭巾の縁（顔を囲む厚み）のうち、額の上と後ろ側 */
function hoodRim(cx, cy) {
  const outer = ellipse(cx - 0.3, cy, 6.1, 6.2);
  return (x, y) => {
    const nx = (x - cx) / 4.8;
    const ny = (y - cy) / 5.1;
    if (nx * nx + ny * ny <= 1) return null;
    if (y > cy - 2.5 && x > cx - 2.9) return null;
    return outer(x, y);
  };
}

function scarfWrap(frame, sk) {
  const n = sk.neck;
  paint(frame, union(ellipse(n.x + 0.5, n.y + 0.5, 5.5, 2.4), ellipse(n.x + 3.5, n.y + 2.5, 2, 2.6)), SCARF);
}

function draw(frame, sk) {
  leg(frame, sk, "B");
  scarfTail(frame, sk);
  cloakBack(frame, sk);
  torso(frame, sk);
  leg(frame, sk, "F");
  capelet(frame, sk);
  scarfWrap(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyNone",
  sheets: bodySheets("bodyNone", draw),
  meta: { arm: ARM_COLORS },
};
