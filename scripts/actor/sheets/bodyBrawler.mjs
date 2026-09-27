// 拳闘士の体: 袖なしの胴着に腹のさらし、太い黒帯、赤い鉢巻、短髪。腕は包帯を巻いた素肌（実行時に引く）。
// がっしり見せるため、胴を見本より少し広げ、肩に素肌の三角筋の盛り上がりを置く。彩度は鉢巻の赤だけを立てる
import { capsule, ellipse, paint, polygon, px, stamp, tint, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#7e4534", "#b87458", "#d99a74", "#eebd94"];
const HAIR = ["#1a1416", "#2e2224", "#473432", "#5e4640"];
/** 胴着: くすんだ生成り（真っ白にせず灰に寄せて暗い世界になじませる） */
const GI = ["#4d4846", "#7a736e", "#a29a91", "#c4bcb0"];
/** さらし・包帯: 胴着より少し明るく黄みの布 */
const WRAP = ["#6e665a", "#a59b88", "#cbc2ac", "#e4dcc6"];
const BELT = ["#141218", "#25222c", "#3a3644", "#524d5c"];
const BAND = ["#4a1820", "#7c2830", "#a63d3c", "#c9614f"];
const PANTS = ["#1e1f2a", "#2f3144", "#44475c", "#5a5e76"];
const EYE = "#1a1620";

/** 腕（実行時に描く）の色: 素肌の二の腕、明部は包帯の色で巻いた前腕の布に見せる。手は包帯を巻いた拳 */
export const ARM_COLORS = { sleeve: [SKIN[0], SKIN[1], WRAP[2]], hand: [WRAP[0], WRAP[1], WRAP[2]] };

function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  // ゆったりした道着の下穿き（太腿は太め）
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 3.1, 2.7), capsule(kn.x, kn.y, foot.x, foot.y - 3, 2.6, 2.3)), PANTS, { group: g, bias: dim });
  // 脛の巻き布（脚絆）と素足
  const shin = mid(kn, foot, 0.4);
  const w = frame.newGroup();
  paint(frame, capsule(shin.x, shin.y, foot.x, foot.y - 2.2, 2.6, 2.3), WRAP, { group: w, bias: dim - 0.1, maxShade: 2 });
  for (let t = 0.2; t < 0.9; t += 0.3) {
    const p = mid(shin, { x: foot.x, y: foot.y - 2.2 }, t);
    px(frame, p.x - 1.5, p.y, WRAP[0]);
    px(frame, p.x - 0.5, p.y + 0.5, WRAP[0]);
  }
  paint(frame, ellipse(foot.x + 1.4, foot.y - 1.2, 3.4, 1.7), SKIN, { bias: dim - 0.1, maxShade: 2 });
}

function headbandTails(frame, sk) {
  const h = sk.head;
  const s = sk.ps.sway;
  // 鉢巻の結び目から後ろへなびく 2 本の端（腕と見間違えない細さ）
  const a = { x: h.x - 6.5, y: h.y - 3 };
  for (const [dy, len, r] of [
    [0, 8, 1.1],
    [1.6, 6, 0.95],
  ]) {
    const b = { x: a.x - len * 0.55, y: a.y + dy + 0.8 - s * 1.2 };
    const c = { x: a.x - len - s * 2, y: a.y + dy + 2 - s * 2.4 };
    paint(frame, union(capsule(a.x, a.y + dy * 0.5, b.x, b.y, r + 0.2, r), capsule(b.x, b.y, c.x, c.y, r, r * 0.7)), BAND, { bias: -0.1, maxShade: 2 });
  }
}

/** 肩の素肌（三角筋）。実行時の腕の付け根とつながる */
function shoulder(frame, sk, side) {
  const p = side === "F" ? sk.shoulderF : sk.shoulderB;
  paint(frame, ellipse(p.x + (side === "F" ? 0.4 : -0.4), p.y + 0.8, 3.6, 3.3), SKIN, { bias: side === "B" ? -0.3 : 0 });
}

function torso(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const g = frame.newGroup();
  // 胸板の素肌（胴着の合わせから見える）
  paint(frame, ellipse(c.x + 1.5, c.y - 2.5, 4.5, 4), SKIN, { group: g });
  // 袖なしの胴着: 肩から腰まで。胴は見本より広い（がっしり）
  const gi = frame.newGroup();
  paint(
    frame,
    polygon(
      [
        [c.x - 6.5, c.y - 5.5],
        [c.x - 1, c.y - 5.5],
        [c.x + 1.8, c.y + 0.5],
        [c.x + 4.5, c.y - 5.5],
        [c.x + 6.5, c.y - 5],
        [c.x + 7, c.y + 1],
        [h.x + 6, h.y + 1],
        [h.x - 5.5, h.y + 1],
        [c.x - 7, c.y + 1],
      ],
      { round: 3 },
    ),
    GI,
    { group: gi },
  );
  // 襟の合わせの縁（1 段暗い線）
  for (let t = 0; t <= 1; t += 0.2) {
    px(frame, c.x - 1 + 2.8 * t, c.y - 5.5 + 6 * t, GI[0]);
    px(frame, c.x + 4.5 - 2.7 * t, c.y - 5.5 + 6 * t, GI[0]);
  }
  // 腹のさらし: 胸の下から帯まで横に巻いた布
  paint(frame, polygon([[c.x - 6.2, c.y + 0.5], [c.x + 6.6, c.y + 0.5], [h.x + 6, h.y - 2], [h.x - 5.8, h.y - 2]], { round: 2.5 }), WRAP, { maxShade: 2 });
  // 巻いた布の重なり（横の細い線を 2 本）
  for (let x = -5; x <= 5; x += 1) {
    tint(frame, mid(c, h, 0.3).x + x, c.y + 2.2, WRAP[0]);
    tint(frame, mid(c, h, 0.6).x + x, c.y + 4.2, WRAP[0]);
  }
  // 太い帯と、前で結んだ端
  paint(frame, capsule(h.x - 5.8, h.y - 0.8, h.x + 6.2, h.y - 0.8, 1.9), BELT, { bias: 0.15, maxShade: 2 });
  const s = sk.ps.sway;
  paint(frame, union(capsule(h.x + 3.5, h.y - 0.5, h.x + 2.3 - s * 0.6, h.y + 4, 1.1, 0.9), capsule(h.x + 4.2, h.y - 0.5, h.x + 5.4 - s * 0.6, h.y + 3.5, 1.1, 0.9)), BELT, { bias: 0.2, maxShade: 2 });
  paint(frame, ellipse(h.x + 3.8, h.y - 0.8, 1.5, 1.4), BELT, { bias: 0.4 });
}

function head(frame, sk) {
  const h = sk.head;
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  // 後頭部の短髪（頭巾が無いので頭の丸みがそのまま外形）
  const g = frame.newGroup();
  paint(frame, union(ellipse(h.x - 1, h.y - 1.4, 6.4, 6.2), ellipse(h.x - 3.8, h.y + 1.5, 2.6, 2.6)), HAIR, { group: g });
  // 首（太め）
  paint(frame, capsule(sk.neck.x + 0.5, sk.neck.y + 1, h.x + 0.5, h.y + 3, 3), SKIN, { bias: -0.2, maxShade: 1 });
  const face = frame.newGroup();
  paint(frame, faceShape(fx, fy), SKIN, { group: face });
  // 耳
  paint(frame, ellipse(fx - 4.2, fy + 0.3, 1.3, 1.7), SKIN, { bias: -0.2, maxShade: 1 });
  // 短く逆立った髪: 頭頂の塊から上と前へ尖った毛束
  paint(
    frame,
    union(
      ellipse(fx - 1.6, fy - 5.2, 5.8, 2.6),
      polygon([[fx - 6.5, fy - 5], [fx - 5.5, fy - 9.5], [fx - 3.5, fy - 6.5]]),
      polygon([[fx - 4, fy - 6.5], [fx - 2, fy - 10.3], [fx - 0.8, fy - 6.8]]),
      polygon([[fx - 1.2, fy - 6.8], [fx + 1.6, fy - 10], [fx + 2.2, fy - 6]]),
      polygon([[fx + 1.5, fy - 6.2], [fx + 4.8, fy - 8], [fx + 4, fy - 4.2]]),
      polygon([[fx + 2.4, fy - 4.8], [fx + 4.6, fy - 3.4], [fx + 3.6, fy - 5.6]]),
    ),
    HAIR,
    { group: face, bias: 0.15 },
  );
  px(frame, fx - 2.5, fy - 7, HAIR[3]);
  px(frame, fx - 1.5, fy - 7.5, HAIR[3]);
  px(frame, fx - 4.5, fy - 6.5, HAIR[2]);
  // 鉢巻: 額を横切る赤い帯（前が少し下がる）と後ろの結び目
  paint(
    frame,
    polygon([[fx - 6.8, fy - 5.6], [fx + 4.4, fy - 4.8], [fx + 4.4, fy - 3.2], [fx - 6.8, fy - 3.4]], { round: 1.2 }),
    BAND,
    { bias: 0.1 },
  );
  paint(frame, ellipse(fx - 7, fy - 4.4, 1.7, 1.7), BAND, { bias: 0.2 });
  // 眼: 縦長の点を 2 つ、間を空ける
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy - 1, ["k", "k"], FACE_INK);
  // 口元（引き結んだ口）
  px(frame, fx + 1, fy + 3, SKIN[0]);
  px(frame, fx + 2, fy + 3, SKIN[0]);
}

const FACE_INK = { k: EYE };

/** 顔: ほぼ一色、頬に小さな明部、あごの縁だけ影（見本 bodyNone と同じ決まり。あごを少し張らせる） */
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
  headbandTails(frame, sk);
  shoulder(frame, sk, "B");
  torso(frame, sk);
  leg(frame, sk, "F");
  shoulder(frame, sk, "F");
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyBrawler",
  sheets: bodySheets("bodyBrawler", draw),
  meta: { arm: ARM_COLORS },
};
