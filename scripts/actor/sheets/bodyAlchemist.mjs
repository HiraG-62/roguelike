// 錬金術師の体: 工房から深層へ降りてきた薬師。額に真鍮のゴーグル、革のエプロン、腰に薬のフラスコ、厚い手袋、くせ毛。
// 彩度は薬の緑だけを立て、茶と真鍮は落とす（深層の暗い世界観に合わせる）
import { capsule, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#8a4c3c", "#c27f5f", "#dfa27c", "#f0c49e"];
const HAIR = ["#261312", "#4a211f", "#6d342c", "#8e4c3a"];
const COAT = ["#211e1d", "#35302d", "#4d4540", "#675c54"];
const APRON = ["#3d2512", "#654225", "#8a5f3a", "#ad7d52"];
const GLOVES = ["#241612", "#3f281d", "#5c3c2b", "#7a553d"];
const PANTS = ["#1c1b22", "#2c2b35", "#3f3d4a", "#55525f"];
const BOOTS = ["#1c1517", "#382925", "#523c34", "#6b5143"];
const BRASS = ["#5c4726", "#8e733c", "#c2a153", "#e8d48e"];
const LENS = ["#10231d", "#1f4636", "#3b7a5a", "#9fd9b0"];
const POTION = ["#1b4a1f", "#338a2c", "#63c23f", "#c4f07a"];
const GLASS = "#d8efe4";
const CORK = ["#4a3320", "#6e5034", "#8e6c48", "#aa8a60"];
const EYE = "#1a1620";

/** 腕（実行時に描く）の色: 袖は上着、手は厚い革の手袋 */
export const ARM_COLORS = { sleeve: [COAT[0], COAT[1], COAT[2]], hand: [GLOVES[1], GLOVES[2], GLOVES[3]] };

function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 2.6, 2.3), capsule(kn.x, kn.y, foot.x, foot.y - 3, 2.3, 2.2)), PANTS, { group: g, bias: dim });
  // 作業用の長靴: 脛の中ほどまで、爪先は丸く厚い
  const shin = mid(kn, foot, 0.4);
  paint(frame, union(capsule(shin.x, shin.y, foot.x, foot.y - 2, 2.6, 2.8), ellipse(foot.x + 1.5, foot.y - 1.5, 3.7, 1.9)), BOOTS, { group: g, bias: dim });
  // 靴の締め帯（真鍮の小さな留め具）
  paint(frame, capsule(shin.x - 0.4, shin.y + 1.2, shin.x + 0.4, shin.y + 1.4, 2.9), GLOVES, { group: g, bias: dim + 0.1, maxShade: 2 });
  px(frame, shin.x + 2, shin.y + 1.3, BRASS[2]);
}

function coatBack(frame, sk) {
  const c = sk.chest;
  const s = sk.ps.sway;
  // 上着の後ろの裾（腿の中ほどまで。後ろへなびく）
  paint(
    frame,
    polygon(
      [
        [c.x - 5, c.y - 3],
        [c.x + 1, c.y - 3],
        [c.x + 1, sk.hip.y + 5],
        [c.x - 5 - s * 2.5, sk.hip.y + 6 + Math.abs(s) * 0.5],
        [c.x - 8 - s * 3, sk.hip.y + 3],
      ],
      { round: 2.5, tilt: { nx: -0.2, ny: 0.1 } },
    ),
    COAT,
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
    COAT,
    { group: g },
  );
  // 上着の高い襟（首の後ろに立つ）
  paint(frame, polygon([[c.x - 5, c.y - 4.5], [c.x - 1, c.y - 5.5], [c.x - 1.5, c.y - 8], [c.x - 5.5, c.y - 7]], { round: 1.5 }), COAT, { bias: 0.1 });
}

/** 腰の帯と、帯に下げたフラスコ（背中側。前はエプロンが覆う） */
function beltAndFlasks(frame, sk) {
  const h = sk.hip;
  const s = sk.ps.sway;
  paint(frame, capsule(h.x - 5.2, h.y - 1.5, h.x + 5.6, h.y - 1.5, 1.4), GLOVES, { bias: 0.1, maxShade: 2 });
  // 丸いフラスコ: 帯の後ろに吊る（歩きで少し揺れる）
  const fx = h.x - 4.6 - s * 0.6;
  const fy = h.y + 2.4;
  paint(frame, capsule(fx, fy - 3.4, fx, fy - 2.2, 0.9), GLASS_MAT, { maxShade: 2 });
  paint(frame, ellipse(fx, fy - 4, 1.1, 0.8), CORK, { maxShade: 2 });
  paint(frame, ellipse(fx, fy, 2.4, 2.4), POTION);
  px(frame, fx - 1, fy - 1, GLASS);
  // 細い試験管: 帯に差す
  const vx = h.x - 1.6;
  paint(frame, capsule(vx, h.y - 3.4, vx - s * 0.3, h.y + 2.2, 0.95), POTION, { bias: 0.2 });
  paint(frame, ellipse(vx, h.y - 3.6, 0.9, 0.7), CORK, { maxShade: 2 });
  px(frame, vx - 0.5, h.y - 0.5, GLASS);
}

const GLASS_MAT = ["#5f7a70", "#9ab8ac", "#c6e0d6", GLASS];

/** 革のエプロン: 胸当てから膝まで。前の脚の上に重ねる */
function apron(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const s = sk.ps.sway;
  const k = sk.kneeF;
  const g = frame.newGroup();
  const hemY = Math.max(k.y + 0.5, h.y + 5.5);
  paint(
    frame,
    polygon(
      [
        [c.x - 0.5, c.y - 4],
        [c.x + 5, c.y - 4],
        [c.x + 6.2, c.y + 1],
        [h.x + 6.4, h.y + 1],
        [k.x + 3.5 - s, hemY],
        [h.x - 2.5 - s * 1.2, hemY + 0.5],
        [h.x - 3, h.y + 1],
        [c.x - 1.5, c.y + 1],
      ],
      { round: 2.5 },
    ),
    APRON,
    { group: g },
  );
  // 首掛けの紐
  paint(frame, capsule(c.x + 0.2, c.y - 4, sk.neck.x - 0.5, sk.neck.y + 0.5, 0.7), GLOVES, { maxShade: 2 });
  // 胸当ての鋲（真鍮）と前の物入れ
  px(frame, c.x + 0.6, c.y - 3.3, BRASS[3]);
  px(frame, c.x + 4.4, c.y - 3.3, BRASS[2]);
  paint(frame, polygon([[h.x - 0.5, h.y + 1.5], [h.x + 4.5, h.y + 1.5], [h.x + 4.2, h.y + 4.6], [h.x - 0.2, h.y + 4.6]], { round: 1 }), APRON, { bias: 0.15, maxShade: 2 });
  // 物入れから覗く試験管の栓（緑）
  px(frame, h.x + 1, h.y + 1, POTION[2]);
  px(frame, h.x + 1, h.y + 0, POTION[3]);
  // エプロンの薬の染み（緑の点）と縫い目
  px(frame, h.x + 3.5, hemY - 2.5, POTION[1]);
  px(frame, h.x + 4.5, hemY - 2, POTION[0]);
  for (let x = h.x - 2; x <= k.x + 2.5; x += 2) px(frame, x, hemY - 0.8, APRON[0]);
  // 帯の真鍮の留め金（エプロンの上から締める）
  paint(frame, capsule(c.x - 0.5, h.y - 1.5, h.x + 6, h.y - 1.5, 1.2), GLOVES, { bias: 0.1, maxShade: 2 });
  paint(frame, ellipse(h.x + 2.5, h.y - 1.5, 1.5, 1.5), BRASS, { rim: false });
}

function head(frame, sk) {
  const h = sk.head;
  const s = sk.ps.sway;
  const g = frame.newGroup();
  // くせ毛の塊: 丸い毛束を寄せて外形を波打たせる（後ろへ少し跳ねる）
  paint(
    frame,
    union(
      ellipse(h.x - 0.8, h.y - 0.8, 7.4, 7.2),
      ellipse(h.x - 6, h.y + 1.5 - s * 0.3, 2.6, 2.8),
      ellipse(h.x - 6.5, h.y - 3, 2.6, 2.6),
      ellipse(h.x - 3.5, h.y - 6.5, 3, 2.6),
      ellipse(h.x + 1.2, h.y - 7.2, 3, 2.4),
      ellipse(h.x - 4.2, h.y + 4.6, 2.2, 2.2),
      ellipse(h.x - 7.8 - s * 0.6, h.y - 0.4, 1.6, 1.8),
    ),
    HAIR,
    { group: g },
  );
  // 毛束の巻きの影（1 ドットの弧）
  for (const [dx, dy] of [
    [-5, -2],
    [-4, -1],
    [-6, 2],
    [-2, -5],
    [-3, 3],
  ])
    px(frame, h.x + dx, h.y + dy, HAIR[0]);
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  const face = frame.newGroup();
  paint(frame, faceShape(fx, fy), SKIN, { group: face });
  // 前髪: 巻いた毛束が額へ垂れる（丸い先の房）
  paint(
    frame,
    union(
      ellipse(fx - 1, fy - 4.6, 5.4, 2),
      polygon([[fx - 4.6, fy - 5], [fx - 3.6, fy - 0.6], [fx - 1.8, fy - 3.6]]),
      ellipse(fx - 0.2, fy - 3, 1.5, 1.4),
      ellipse(fx + 2.8, fy - 3.3, 1.4, 1.2),
      polygon([[fx + 3.4, fy - 4.6], [fx + 4.8, fy - 2.4], [fx + 4.6, fy - 4.8]]),
    ),
    HAIR,
    { group: face, bias: 0.15 },
  );
  px(frame, fx - 2.5, fy - 5, HAIR[3]);
  px(frame, fx - 1.5, fy - 5, HAIR[3]);
  px(frame, fx + 2.5, fy - 4, HAIR[2]);
  goggles(frame, fx, fy);
  // 眼: 縦長の小さな点を 2 つ
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy - 1, ["k", "k"], FACE_INK);
  px(frame, fx + 1, fy + 3, SKIN[0]);
}

/** 額に上げたゴーグル: 頭を回る革の帯と、真鍮の枠に緑がかった硝子の 2 つの眼鏡 */
function goggles(frame, fx, fy) {
  const gy = fy - 6;
  // 帯: 前の眼鏡から頭の後ろへ回る
  paint(frame, capsule(fx - 9.5, gy + 2.8, fx - 1, gy + 0.2, 1.1, 1), GLOVES, { maxShade: 2 });
  for (const [cx, r] of [
    [fx - 0.9, 2.8],
    [fx + 3.6, 2.5],
  ]) {
    paint(frame, ellipse(cx, gy, r, r * 0.95), BRASS);
    paint(frame, ellipse(cx, gy, r - 1.05, r - 1.1), LENS, { rim: false });
    px(frame, cx - 0.5, gy - 0.5, LENS[3]);
  }
  // 眼鏡をつなぐ鼻当て
  px(frame, fx + 1.4, gy, BRASS[1]);
}

const FACE_INK = { k: EYE };

/** 顔: ほぼ一色、頬に小さな明部、あごの縁にだけ影（見本 bodyNone と同じ作り） */
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
  coatBack(frame, sk);
  torso(frame, sk);
  beltAndFlasks(frame, sk);
  leg(frame, sk, "F");
  apron(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyAlchemist",
  sheets: bodySheets("bodyAlchemist", draw),
  meta: { arm: ARM_COLORS },
};
