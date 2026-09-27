// 槍兵の体: 軽装の鎧の兵。羽飾り（赤）の付いた銀の兜、胸甲・肩当て・腰当て、赤い腰布、脛当て。
// 識別色は銀と赤の 2 系統だけ立て、下衣と革は暗く落とす（深層の暗い色調に合わせる）
import { capsule, clip, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#8a4c3c", "#c27f5f", "#dfa27c", "#f0c49e"];
const HAIR = ["#2a1c1f", "#46302d", "#644437", "#7e5a45"];
const SILVER = ["#40424f", "#6c7083", "#9fa5b8", "#d6dbe7"];
const SILVER_DARK = ["#2c2d37", "#4a4c5b", "#6c7083", "#9095a8"];
const RED = ["#4a1820", "#7c2830", "#a63d3c", "#c9614f"];
const PLUME = ["#561a22", "#8e2a32", "#bb4541", "#dc6f58"];
const PANTS = ["#1f1f2a", "#313245", "#46485e", "#5d6078"];
const LEATHER = ["#1c1517", "#382925", "#523c34", "#6b5143"];
const BRASS = ["#5c4726", "#8e733c", "#c2a153", "#e8d48e"];
const EYE = "#1a1620";

/** 腕（実行時に描く）の色: 袖は赤の下衣、手は革の手袋 */
export const ARM_COLORS = { sleeve: [RED[0], RED[1], RED[2]], hand: [LEATHER[1], LEATHER[2], LEATHER[3]] };

function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 2.6, 2.3), capsule(kn.x, kn.y, foot.x, foot.y - 3, 2.3, 2.2)), PANTS, { group: g, bias: dim });
  // 革の靴
  paint(frame, union(capsule(foot.x, foot.y - 3, foot.x, foot.y - 1.5, 2.4), ellipse(foot.x + 1.6, foot.y - 1.3, 3.5, 1.7)), LEATHER, { group: g, bias: dim });
  // 脛当て（膝の下から足首まで、前へ張った銀の板）
  const top = mid(kn, foot, 0.12);
  const bot = mid(kn, foot, 0.78);
  paint(frame, capsule(top.x + 0.6, top.y, bot.x + 0.5, bot.y, 2.2, 1.9), SILVER, { bias: dim - 0.15, maxShade: 2 });
  // 膝当て（丸い鋲の板）
  paint(frame, ellipse(kn.x + 0.9, kn.y - 0.2, 2, 1.8), SILVER, { bias: dim + 0.05 });
}

function plume(frame, sk, fx, fy) {
  const s = sk.ps.sway;
  // 兜の天辺から後ろへ流れる赤い羽飾り。頭の中心から上へ 12 ドット以内に収める
  const a = { x: fx - 1, y: fy - 9.5 };
  const b = { x: fx - 6 - s * 1.2, y: fy - 11 + s * 0.4 };
  const c = { x: fx - 11 - s * 2.2, y: fy - 7 + s * 1.4 };
  const d = { x: fx - 12 - s * 2.8, y: fy - 2 + s * 1.8 };
  paint(
    frame,
    union(capsule(a.x, a.y, b.x, b.y, 2.3, 2.6), capsule(b.x, b.y, c.x, c.y, 2.6, 2), capsule(c.x, c.y, d.x, d.y, 2, 0.9)),
    PLUME,
    { maxShade: 3 },
  );
  // 羽の筋（1 ドットの暗い線で毛の流れ）
  for (let t = 0.2; t < 0.95; t += 0.18) {
    const p = mid(b, c, t);
    px(frame, p.x + 0.5, p.y + 1, PLUME[0]);
  }
}

function capeBack(frame, sk) {
  const c = sk.chest;
  const s = sk.ps.sway;
  // 背中に垂れる短い赤の肩掛け（後ろへなびく）
  paint(
    frame,
    polygon(
      [
        [c.x - 4, c.y - 5],
        [c.x + 1, c.y - 5],
        [c.x - 1, sk.hip.y + 1],
        [c.x - 5 - s * 3, sk.hip.y + 3 + Math.abs(s)],
        [c.x - 8 - s * 3, sk.hip.y],
      ],
      { round: 2.5, tilt: { nx: -0.2, ny: 0.1 } },
    ),
    RED,
    { bias: -0.25 },
  );
}

function torso(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  // 下衣（赤）: 胸甲の下から覗く
  paint(
    frame,
    polygon(
      [
        [c.x - 5.5, c.y - 5],
        [c.x + 5, c.y - 5],
        [c.x + 5.5, c.y + 1],
        [h.x + 5, h.y + 1.5],
        [h.x - 5, h.y + 1.5],
        [c.x - 6, c.y + 1],
      ],
      { round: 3 },
    ),
    RED,
    { bias: -0.1 },
  );
  // 胸甲: 胸の前へ膨らむ銀の板。中央の稜線と下端の反り
  const cuirass = polygon(
    [
      [c.x - 4.6, c.y - 5],
      [c.x + 4.4, c.y - 5],
      [c.x + 6, c.y - 1.5],
      [c.x + 5, c.y + 3.6],
      [c.x + 1, c.y + 4.6],
      [c.x - 5.2, c.y + 3.4],
    ],
    { round: 3.2 },
  );
  const g = frame.newGroup();
  paint(frame, cuirass, SILVER, { group: g });
  // 稜線（胸の中央を縦に走る艶と陰）
  for (let y = c.y - 4; y < c.y + 3.5; y += 1) {
    const x = c.x + 2 + (y - c.y) * 0.06;
    px(frame, x, y, SILVER[3]);
    px(frame, x + 1, y, SILVER[1]);
  }
  // 胸甲の下の縁の帯（赤い革帯と真鍮の留め金）
  paint(frame, capsule(h.x - 5, h.y - 1, h.x + 5.3, h.y - 1, 1.3), LEATHER, { bias: 0.1, maxShade: 2 });
  paint(frame, ellipse(h.x + 2.6, h.y - 1, 1.5, 1.4), BRASS, { rim: false });
}

function tassets(frame, sk) {
  const h = sk.hip;
  // 腰当て: 腰の横と後ろに 2 枚の銀の小札（前は腰布に譲る）
  const plates = [
    [h.x - 4.2, h.y + 0.2, -0.5],
    [h.x - 0.8, h.y + 0.5, 0],
  ];
  const g = frame.newGroup();
  for (const [x, y, lean] of plates) {
    paint(
      frame,
      polygon(
        [
          [x - 2, y],
          [x + 2, y],
          [x + 2.2 + lean, y + 4.4],
          [x - 1.8 + lean, y + 4.8],
        ],
        { round: 1.5, tilt: { nx: 0, ny: 0.25 } },
      ),
      SILVER_DARK,
      { group: g, bias: 0.1 },
    );
  }
}

function loincloth(frame, sk) {
  const h = sk.hip;
  const s = sk.ps.sway;
  // 前に垂らす赤い腰布（前足の上に重ね、揺れで裾が後ろへ流れる）
  paint(
    frame,
    polygon(
      [
        [h.x + 1.4, h.y - 0.4],
        [h.x + 5.2, h.y - 0.4],
        [h.x + 5 - s * 1.4, h.y + 8.5],
        [h.x + 3.2 - s * 1.8, h.y + 9.4],
        [h.x + 1.6 - s * 1.6, h.y + 8.2],
      ],
      { round: 1.4 },
    ),
    RED,
    { maxShade: 3 },
  );
  // 裾の縁取り（真鍮の糸）
  for (let x = 2; x <= 4; x++) px(frame, h.x + x - s * 1.6, h.y + 7.6 + (x === 3 ? 0.6 : 0), BRASS[1]);
}

function pauldron(frame, sk, side) {
  const sh = side === "F" ? sk.shoulderF : sk.shoulderB;
  const dim = side === "B" ? -0.3 : 0;
  // 肩当て: 重ねた 2 枚の丸い板。外へ少し張り出す
  const g = frame.newGroup();
  const upper = clip(ellipse(sh.x - 0.3, sh.y + 0.4, 3.6, 3.1), 0, 1, sh.y + 2.2);
  const lower = clip(ellipse(sh.x - 0.1, sh.y + 1.8, 3.3, 2.8), 0, 1, sh.y + 3.8);
  paint(frame, lower, SILVER, { group: g, bias: dim - 0.1 });
  paint(frame, upper, SILVER, { bias: dim + 0.05 });
  // 縁の赤い裏地と鋲
  if (side === "F") {
    for (let x = -2; x <= 1; x++) px(frame, sh.x + x, sh.y + 3.8, RED[2]);
    px(frame, sh.x + 1.5, sh.y - 0.5, BRASS[2]);
  }
}

function gorget(frame, sk) {
  const n = sk.neck;
  // 喉当て（首元の銀の輪）と赤い襟
  paint(frame, ellipse(n.x + 0.5, n.y + 0.6, 4.6, 2), RED, { bias: -0.05 });
  paint(frame, ellipse(n.x + 1, n.y + 1.4, 3.6, 1.6), SILVER, { bias: 0.05 });
}

function head(frame, sk) {
  const h = sk.head;
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  plume(frame, sk, fx, fy);
  // 後ろ髪（兜の下から首筋へ少し）
  paint(frame, ellipse(fx - 5.5, fy + 2.5, 3, 3.2), HAIR, { bias: -0.1 });
  // 顔（ほぼ一色）
  const face = frame.newGroup();
  paint(frame, faceShape(fx, fy), SKIN, { group: face });
  // 兜: 丸い鉢 + 後ろの錏（首を覆う）+ 頬当て。顔の前は開けておく
  const g = frame.newGroup();
  const bowl = clip(ellipse(fx - 0.8, fy - 1.6, 7.6, 7.2), 0, 1, fy - 1.4);
  const neckGuard = polygon(
    [
      [fx - 8.2, fy - 2.5],
      [fx - 3, fy - 2.5],
      [fx - 3.4, fy + 3.5],
      [fx - 6.6, fy + 5.2],
      [fx - 9, fy + 3.2],
    ],
    { round: 2, tilt: { nx: -0.3, ny: 0.2 } },
  );
  paint(frame, union(bowl, neckGuard), SILVER, { group: g });
  // 頬当て（顔の横を下りる板。眼の後ろ側）
  paint(
    frame,
    polygon(
      [
        [fx - 3.4, fy - 2],
        [fx - 0.9, fy - 2],
        [fx - 1.2, fy + 3.4],
        [fx - 3.2, fy + 4.4],
      ],
      { round: 1.2 },
    ),
    SILVER,
    { group: g, bias: -0.1 },
  );
  // 鉢の縁の帯（眉庇）: 額の上を前へ少し張り出す
  paint(frame, capsule(fx - 7.2, fy - 2, fx + 5.4, fy - 2.4, 1.15), SILVER_DARK, { bias: 0.2 });
  // 鉢の天辺の稜（羽飾りの受け）と真鍮の飾り
  paint(frame, capsule(fx - 5, fy - 8.2, fx + 2, fy - 7.6, 1.1), SILVER_DARK, { bias: 0.3, maxShade: 3 });
  paint(frame, ellipse(fx - 1, fy - 9, 1.4, 1.3), BRASS, { rim: false });
  // 鉢の艶と鋲
  px(frame, fx - 4, fy - 6, SILVER[3]);
  px(frame, fx - 3, fy - 6.5, SILVER[3]);
  px(frame, fx - 5, fy - 5, SILVER[3]);
  px(frame, fx - 6, fy - 0.5, BRASS[2]);
  // 前髪: 眉庇の下から覗く毛束
  paint(
    frame,
    union(
      polygon([[fx - 1, fy - 1.3], [fx + 0.2, fy + 0.6], [fx + 1.4, fy - 1.3]]),
      polygon([[fx + 1.6, fy - 1.3], [fx + 3, fy + 0.2], [fx + 4, fy - 1.3]]),
    ),
    HAIR,
    { group: face, bias: 0.1 },
  );
  // 眼: 1 ドット幅 × 2 の縦長の点を 2 つ
  stamp(frame, fx - 0.5, fy, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy, ["k", "k"], FACE_INK);
  px(frame, fx + 1, fy + 3.5, SKIN[0]);
}

const FACE_INK = { k: EYE };

/** 顔: ほぼ一色。頬に 2 ドットの明部、あごの縁にだけ影 */
function faceShape(cx, cy) {
  const rx = 5.4;
  const ry = 5.6;
  return (x, y) => {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const d = nx * nx + ny * ny;
    if (d > 1 || x < cx - 4.6) return null;
    if (ny > 0.55 && d > 0.72) return 0;
    if (Math.hypot(x - (cx - 2.6), y - (cy + 1.8)) < 0.75) return 2;
    return 1;
  };
}

function draw(frame, sk) {
  leg(frame, sk, "B");
  capeBack(frame, sk);
  pauldron(frame, sk, "B");
  torso(frame, sk);
  tassets(frame, sk);
  leg(frame, sk, "F");
  loincloth(frame, sk);
  gorget(frame, sk);
  head(frame, sk);
  pauldron(frame, sk, "F");
}

export const ATLAS = {
  key: "bodyLancer",
  sheets: bodySheets("bodyLancer", draw),
  meta: { arm: ARM_COLORS },
};

