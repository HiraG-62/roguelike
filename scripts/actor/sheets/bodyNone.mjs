// 見習い（ジョブなし）の体: 深層へ潜る探索者。尖った頭巾と肩掛け、裾の割れた長い外套、長い赤い襟巻き、革の胴着、膝までの長靴。
// 世界観（深層の遺跡・修道院・死神）に合わせ、彩度は襟巻きの赤だけを立てて他は落とす。
// 外套の裾と襟巻きは姿勢の flow（動きの勢い）で後ろへなびき、sway でゆっくり揺れる
import { capsule, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#8a4c3c", "#c27f5f", "#dfa27c", "#f0c49e"];
const HAIR = ["#2a1c1f", "#46302d", "#644437", "#7e5a45"];
const HOOD = ["#1c2a2e", "#2c4446", "#3f6061", "#577f7d"];
const COAT = ["#18242a", "#26393d", "#375457", "#4d7170"];
const TUNIC = ["#33221f", "#553729", "#77503a", "#946c4c"];
const SCARF = ["#4a1820", "#7c2830", "#a63d3c", "#c9614f"];
const PANTS = ["#1f1f2a", "#313245", "#46485e", "#5d6078"];
const BOOTS = ["#1c1517", "#382925", "#523c34", "#6b5143"];
const BRASS = ["#5c4726", "#8e733c", "#c2a153", "#e8d48e"];
const EYE = "#1a1620";

/** 腕（実行時に描く）の色: 袖 3 段・手 3 段。袖は外套の色 */
export const ARM_COLORS = { sleeve: [COAT[0], COAT[1], COAT[2]], hand: [BOOTS[1], BOOTS[2], BOOTS[3]] };

function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.3 : 0;
  const g = frame.newGroup();
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 2.3, 1.9), capsule(kn.x, kn.y, foot.x, foot.y - 3, 1.9, 1.7)), PANTS, { group: g, bias: dim });
  // 膝下までの長靴（膝の少し下から爪先まで。爪先は細く尖らせる）
  const top = mid(kn, foot, 0.18);
  const toe = polygon(
    [
      [foot.x - 2, foot.y - 3.2],
      [foot.x + 4.8, foot.y - 1],
      [foot.x + 4, foot.y + 0.3],
      [foot.x - 2.4, foot.y + 0.3],
    ],
    { round: 1.2 },
  );
  paint(frame, union(capsule(top.x, top.y, foot.x, foot.y - 2, 2.3, 2.1), toe), BOOTS, { group: g, bias: dim });
  // 折り返し
  paint(frame, capsule(top.x - 0.2, top.y, top.x + 0.2, top.y + 0.3, 2.8), BOOTS, { group: g, bias: dim + 0.25, maxShade: 2 });
}

/** 外套の後ろ身頃: 肩から膝まで。裾は二つに割れて後ろへなびく */
function coatBack(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const f = sk.ps.flow;
  const s = sk.ps.sway;
  const hemY = h.y + 13 - f * 3;
  paint(
    frame,
    polygon(
      [
        [c.x - 5, c.y - 4],
        [c.x + 2, c.y - 4],
        [h.x + 3, h.y + 2],
        [h.x + 1 - f * 2, hemY + 1],
        [h.x - 3 - f * 5 - s, hemY - 1.5],
        [h.x - 5 - f * 7 - s * 1.5, hemY + 1.5 - f],
        [h.x - 7 - f * 7 - s * 2, hemY - 3 - f * 2],
        [c.x - 7, c.y + 3],
      ],
      { round: 2, tilt: { nx: -0.25, ny: 0.1 } },
    ),
    COAT,
    { bias: -0.15 },
  );
}

/**
 * 長い襟巻きの端: 首の後ろから 2 本。止まっていれば背中へ垂れ、動きの勢い（flow）で後ろへ水平に流れる。
 * 2 節で少し波打たせ、先ほど細くする
 */
function scarfTail(frame, sk) {
  const n = sk.neck;
  const s = sk.ps.sway;
  const f = sk.ps.flow;
  const deg = Math.PI / 180;
  const ang = (100 + Math.min(1.5, Math.max(-0.5, f)) * 65) * deg;
  for (const [dy, len, r, lag] of [
    [0, 13, 1.3, 0],
    [1.6, 10, 1.1, 8],
  ]) {
    const a = { x: n.x - 3, y: n.y + dy };
    const a1 = ang + (-8 + s * 6 + lag) * deg;
    const a2 = ang + (10 - s * 8 + lag) * deg;
    const b = { x: a.x + Math.cos(a1) * len * 0.5, y: a.y + Math.sin(a1) * len * 0.5 };
    const c = { x: b.x + Math.cos(a2) * len * 0.5, y: b.y + Math.sin(a2) * len * 0.5 };
    paint(frame, union(capsule(a.x, a.y, b.x, b.y, r + 0.3, r), capsule(b.x, b.y, c.x, c.y, r, r * 0.6)), SCARF, { bias: -0.1, maxShade: 2 });
  }
}

/** 胴: 肩を張り腰を絞った胴着、帯と留め金、腰の小物入れ */
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
        [c.x + 5, c.y + 1],
        [h.x + 3.8, h.y - 1],
        [h.x + 4.2, h.y + 2],
        [h.x - 4, h.y + 2],
        [h.x - 3.6, h.y - 1],
        [c.x - 5.5, c.y + 1],
      ],
      { round: 2.5 },
    ),
    TUNIC,
    { group: g },
  );
  // 胴着の前合わせ（縫い目）
  for (let y = c.y - 3; y < h.y - 1; y += 1) px(frame, c.x + 2.5 + (y - c.y) * 0.1, y, TUNIC[0]);
  // 帯（斜めに締める）と真鍮の留め金
  paint(frame, capsule(h.x - 4.2, h.y - 1.2, h.x + 4.5, h.y - 2, 1.3), BOOTS, { group: g, bias: 0.1, maxShade: 2 });
  paint(frame, ellipse(h.x + 2, h.y - 1.7, 1.4, 1.4), BRASS, { rim: false });
  paint(frame, ellipse(h.x - 3.6, h.y + 1, 1.9, 1.8), TUNIC, { bias: 0.15 });
}

/** 外套の前身頃（開いた前立て）。前の肩から裾へ、胴着の前を縁取る */
function coatFront(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const f = sk.ps.flow;
  paint(
    frame,
    polygon(
      [
        [c.x + 2.5, c.y - 5],
        [c.x + 5.5, c.y - 4],
        [c.x + 5, c.y + 2],
        [h.x + 4.8, h.y + 3],
        [h.x + 3.5 - f * 2, h.y + 8 - f * 1.5],
        [h.x + 1.5 - f * 2.5, h.y + 7 - f * 1.5],
        [h.x + 2.6, h.y + 1],
        [c.x + 3, c.y],
      ],
      { round: 1.5 },
    ),
    COAT,
  );
}

/** 肩掛け（頭巾から続く短い肩の覆い） */
function mantle(frame, sk) {
  const n = sk.neck;
  const s = sk.ps.sway;
  paint(
    frame,
    polygon(
      [
        [n.x - 6, n.y],
        [n.x + 4, n.y],
        [n.x + 6.5, n.y + 3.5],
        [n.x + 4, n.y + 6],
        [n.x - 2, n.y + 6.5],
        [n.x - 7.5 - s, n.y + 5],
      ],
      { round: 2.5 },
    ),
    HOOD,
  );
}

function scarfWrap(frame, sk) {
  const n = sk.neck;
  paint(frame, union(ellipse(n.x + 0.5, n.y + 0.8, 4.6, 2.1), ellipse(n.x + 3, n.y + 2.6, 1.7, 2.3)), SCARF);
}

function head(frame, sk) {
  const h = sk.head;
  const g = frame.newGroup();
  // 頭巾（頭より一回り大きく、後ろへ長く尖る。動きで先がなびく）
  const f = sk.ps.flow;
  paint(
    frame,
    union(
      ellipse(h.x - 0.4, h.y - 0.3, 6.2, 6),
      polygon(
        [
          [h.x - 4.5, h.y - 4],
          [h.x - 10 - f * 2 - sk.ps.sway, h.y - 1 + f],
          [h.x - 3.5, h.y + 3],
        ],
        { round: 1.5 },
      ),
    ),
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
      ellipse(fx - 0.6, fy - 3.4, 4.1, 1.7),
      polygon([[fx - 3.3, fy - 3.7], [fx - 2.4, fy - 0.5], [fx - 1.3, fy - 3]]),
      polygon([[fx - 1.6, fy - 3.3], [fx - 0.4, fy - 1.6], [fx + 0.7, fy - 3.2]]),
      polygon([[fx + 0.3, fy - 3.3], [fx + 1.6, fy - 1.5], [fx + 2.4, fy - 3.1]]),
    ),
    HAIR,
    { group: face, bias: 0.15 },
  );
  px(frame, fx - 1.5, fy - 4, HAIR[3]);
  // 頭巾の縁: 額の上と後ろ側だけ（顔の前を覆わない）
  paint(frame, hoodRim(fx, fy - 0.4), HOOD, { group: g, bias: 0.3 });
  // 眼: 縦長の小さな点を 2 つ（塊にすると眼鏡に見えるので、1 ドット幅で間を空ける）
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 1.5, fy - 1, ["k", "k"], FACE_INK);
}

const FACE_INK = { k: EYE };

/**
 * 顔: ほぼ一色で塗り、頬に小さな明部、あごの縁にだけ影（光で顔の前が暗く沈まないように法線を使わない。
 * 明暗を面で分けると顔の上下で色がくっきり割れて見えるので、明部と影は数ドットに留める）
 */
function faceShape(cx, cy) {
  const rx = 3.9;
  const ry = 4.3;
  return (x, y) => {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const d = nx * nx + ny * ny;
    if (d > 1 || x < cx - 3.3) return null;
    if (ny > 0.55 && d > 0.72) return 0;
    if (Math.hypot(x - (cx - 1.8), y - (cy + 1.2)) < 0.7) return 2;
    return 1;
  };
}

/** 頭巾の縁（顔を囲む厚み）のうち、額の上と後ろ側 */
function hoodRim(cx, cy) {
  const outer = ellipse(cx - 0.3, cy, 5.4, 5.6);
  return (x, y) => {
    const nx = (x - cx) / 4.2;
    const ny = (y - cy) / 4.6;
    if (nx * nx + ny * ny <= 1) return null;
    if (y > cy - 2.2 && x > cx - 2.5) return null;
    return outer(x, y);
  };
}

function draw(frame, sk) {
  coatBack(frame, sk);
  scarfTail(frame, sk);
  leg(frame, sk, "B");
  torso(frame, sk);
  leg(frame, sk, "F");
  coatFront(frame, sk);
  mantle(frame, sk);
  scarfWrap(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyNone",
  sheets: bodySheets("bodyNone", draw),
  meta: { arm: ARM_COLORS },
};
