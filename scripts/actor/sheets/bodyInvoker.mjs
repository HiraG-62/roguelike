// 術士（invoker）の体: 後ろへ折れた高い三角帽、深い青の長いローブに金のルーンの帯、胸の宝珠の首飾り、長い袖。
// 識別色は青と金（宝珠だけ淡い水色に光らせる）。他は落とす。骨組み・時間割は rig.mjs の共通のもの
import { capsule, clip, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#8a4c3c", "#c27f5f", "#dfa27c", "#f0c49e"];
const HAIR = ["#4a4a5c", "#76778c", "#a3a5b8", "#cfd1de"];
const ROBE = ["#17204a", "#23346e", "#334c94", "#5070b6"];
const ROBE_DARK = ["#0e1228", "#171f45", "#233266", "#344a8a"];
const HAT = ["#121634", "#1c2552", "#2a3a78", "#40569c"];
const GOLD = ["#5c4220", "#9a7330", "#d0a64a", "#f2dc8a"];
const ORB = ["#1d4a5c", "#2f8aa0", "#6fd2e0", "#d8fbff"];
const PANTS = ["#16162a", "#24243c", "#35364f", "#484a66"];
const BOOTS = ["#1c1517", "#382925", "#523c34", "#6b5143"];
const EYE = "#1a1620";
const RUNE = "#f2dc8a";

/** 腕（実行時に描く）の色: 袖はローブの青、手は素肌 */
export const ARM_COLORS = { sleeve: [ROBE[0], ROBE[1], ROBE[2]], hand: [SKIN[0], SKIN[1], SKIN[2]] };

/** ローブの裾の高さ（絵のドット、足元から上）。脛の下半分と靴は裾から出す */
const HEM_Y = -4.5;

function leg(frame, sk, side, belowHem) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  // 前の足は裾より下だけ描く（腿はローブの中）
  const cut = (fn) => (belowHem ? clip(fn, 0, -1, -(HEM_Y - 0.5)) : fn);
  paint(frame, cut(union(capsule(hip.x, hip.y, kn.x, kn.y, 2.4, 2.1), capsule(kn.x, kn.y, foot.x, foot.y - 3, 2.1, 2))), PANTS, { group: g, bias: dim });
  // 先の細い靴
  const shin = mid(kn, foot, 0.5);
  paint(frame, cut(union(capsule(shin.x, shin.y, foot.x, foot.y - 2, 2.3, 2.4), ellipse(foot.x + 1.8, foot.y - 1.3, 3.6, 1.6))), BOOTS, { group: g, bias: dim });
}

/** 背中の髪（肩へ流れる銀の長髪。後ろへなびく） */
function hairBack(frame, sk) {
  const h = sk.head;
  const s = sk.ps.sway;
  paint(
    frame,
    polygon(
      [
        [h.x - 5, h.y - 3],
        [h.x + 0.5, h.y - 1],
        [h.x - 1, h.y + 7],
        [h.x - 5 - s * 1.5, h.y + 10],
        [h.x - 8 - s * 2, h.y + 7],
        [h.x - 8, h.y + 1],
      ],
      { round: 2 },
    ),
    HAIR,
    { bias: -0.15, maxShade: 2 },
  );
}

/** ローブの後ろ身頃（背中側の裾が後ろへ流れる） */
function robeBack(frame, sk) {
  const c = sk.chest;
  const s = sk.ps.sway;
  const back = Math.min(sk.kneeB.x, sk.footB.x);
  paint(
    frame,
    polygon(
      [
        [c.x - 5, c.y - 4],
        [c.x + 1, c.y - 4],
        [c.x, HEM_Y],
        [back - 4 - s * 2, HEM_Y + 0.5],
        [back - 5 - s * 2.5, HEM_Y - 3],
        [c.x - 7, sk.hip.y],
      ],
      { round: 2.5, tilt: { nx: -0.2, ny: 0.1 } },
    ),
    ROBE_DARK,
    { bias: -0.1 },
  );
}

/** ローブの胴と裾。裾は足の開きに合わせて広がる。前合わせに金のルーンの帯 */
function robe(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const s = sk.ps.sway;
  const front = Math.max(sk.kneeF.x, sk.footF.x);
  const back = Math.min(sk.kneeB.x, sk.footB.x);
  const hemF = front + 3.5;
  const hemB = back - 3 - s;
  const g = frame.newGroup();
  const body = polygon(
    [
      [c.x - 5.5, c.y - 5],
      [c.x + 5, c.y - 5],
      [c.x + 5.5, c.y + 1],
      [h.x + 5, h.y - 1],
      [hemF, HEM_Y],
      [hemB, HEM_Y],
      [h.x - 5.5, h.y - 1],
      [c.x - 6, c.y + 1],
    ],
    { round: 3 },
  );
  paint(frame, body, ROBE, { group: g });
  // 裾の襞（膝から裾へ 1 ドットの暗い線）
  for (const t of [0.3, 0.7]) {
    const top = { x: h.x - 3 + t * 6, y: h.y + 2 };
    const bot = { x: hemB + (hemF - hemB) * t, y: HEM_Y - 1 };
    for (let k = 0; k <= 1; k += 0.25) px(frame, top.x + (bot.x - top.x) * k, top.y + (bot.y - top.y) * k, ROBE[0]);
  }
  // 裾の金の縁取り
  paint(frame, polygon([[hemB + 0.2, HEM_Y - 1.4], [hemF - 0.2, HEM_Y - 1.4], [hemF, HEM_Y], [hemB, HEM_Y]]), GOLD, { group: g, flat: true, maxShade: 1, minShade: 1, rim: false });
  // 前合わせのルーンの帯: 胸から裾まで金の帯、帯の上に 1 ドットの印を等間隔に
  const bandX = (y) => c.x + 2 + (y - c.y) * (0.12 + Math.max(0, hemF - h.x - 9) * 0.02);
  for (let y = Math.round(c.y) - 3; y <= HEM_Y - 1.5; y++) {
    const x = Math.round(bandX(y));
    px(frame, x - 1, y, GOLD[2]);
    px(frame, x, y, GOLD[2]);
    px(frame, x + 1, y, GOLD[1]);
  }
  // ルーン: 帯の上に 3 ドットおきの暗い刻み（横棒と点を交互に）
  for (let y = Math.round(c.y) + 1, k = 0; y < HEM_Y - 2; y += 3, k++) {
    const x = Math.round(bandX(y));
    px(frame, x, y, ROBE[1]);
    if (k % 2 === 0) px(frame, x - 1, y, ROBE[1]);
    else px(frame, x, y + 1, ROBE[1]);
  }
  // 腰帯（暗い布に金の結び目）
  paint(frame, capsule(h.x - 5.5, h.y - 2.5, h.x + 5.2, h.y - 2.5, 1.3), ROBE_DARK, { group: g, bias: 0.15, maxShade: 2 });
  paint(frame, ellipse(h.x + 2, h.y - 2.5, 1.4, 1.4), GOLD, { rim: false });
  // 腰から下がる帯の端
  paint(frame, capsule(h.x + 1.2, h.y - 1.5, h.x + 0.2 - s * 0.6, h.y + 4, 0.9, 0.7), ROBE_DARK, { bias: 0.1, maxShade: 2 });
}

/** 肩を覆う短い肩掛け（ローブより暗い青、縁に金） */
function mantle(frame, sk) {
  const n = sk.neck;
  const s = sk.ps.sway;
  const pts = [
    [n.x - 7, n.y - 1],
    [n.x + 5, n.y - 1],
    [n.x + 7, n.y + 3.5],
    [n.x + 4, n.y + 6],
    [n.x - 2, n.y + 6.5],
    [n.x - 8.5 - s, n.y + 5],
  ];
  paint(frame, polygon(pts, { round: 3 }), ROBE_DARK, { bias: 0.25 });
  // 縁の金の線
  for (let x = -7; x <= 4; x++) px(frame, n.x + x, n.y + 5.8 + (x < -1 ? (x + 1) * -0.15 : (x + 1) * 0.1), GOLD[1]);
  // 立ち襟
  paint(frame, union(ellipse(n.x + 0.5, n.y - 0.3, 4.6, 2), ellipse(n.x - 2, n.y - 1.2, 2.5, 2)), ROBE, { bias: 0.1 });
}

/** 宝珠の首飾り: 金の鎖と、胸で光る淡い水色の珠 */
function amulet(frame, sk) {
  const n = sk.neck;
  const cx = Math.round(n.x + 3);
  const cy = Math.round(n.y + 4);
  for (const [dx, dy] of [
    [-3, -3],
    [-2, -2],
    [-1, -1],
    [2, -3],
    [1.6, -2],
  ])
    px(frame, cx + dx, cy + dy, GOLD[2]);
  paint(frame, ellipse(cx + 0.5, cy + 0.5, 2.1, 2.1), GOLD, { bias: 0.1, maxShade: 2 });
  paint(frame, ellipse(cx + 0.5, cy + 0.5, 1.4, 1.4), ORB, { bias: 0.3, rim: false });
  px(frame, cx, cy, ORB[3]);
}

function head(frame, sk) {
  const h = sk.head;
  const s = sk.ps.sway;
  const g = frame.newGroup();
  // 頭の後ろ（髪の塊）
  paint(frame, ellipse(h.x - 1, h.y - 0.5, 7.6, 7.6), HAIR, { group: g, bias: -0.1 });
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  const face = frame.newGroup();
  paint(frame, faceShape(fx, fy), SKIN, { group: face });
  // 前髪: 帽子の縁の下から毛束が額へ下りる。横髪は頬の後ろへ長く垂らす
  paint(
    frame,
    union(
      ellipse(fx - 1, fy - 4.2, 5.4, 1.8),
      polygon([[fx - 4.6, fy - 4.5], [fx - 3.4, fy + 3.5], [fx - 2, fy - 3.8]]),
      polygon([[fx - 2.4, fy - 4.4], [fx - 0.8, fy - 1.9], [fx + 0.6, fy - 4.2]]),
      polygon([[fx + 0.8, fy - 4.4], [fx + 2.6, fy - 2.2], [fx + 3.6, fy - 4.2]]),
      polygon([[fx + 3, fy - 4.4], [fx + 4.6, fy - 2.8], [fx + 4.8, fy - 4.6]]),
    ),
    HAIR,
    { group: face, bias: 0.1 },
  );
  px(frame, fx - 3.5, fy - 1, HAIR[3]);
  px(frame, fx - 3.5, fy, HAIR[2]);
  // 眼: 縦長の 1 ドット幅の点を 2 つ
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy - 1, ["k", "k"], FACE_INK);
  px(frame, fx + 1, fy + 3, SKIN[0]);
  hat(frame, h, fy, s);
}

/** 三角帽: 広い鍔と、途中で後ろへ折れる高い円錐（頭の中心から上へ 12 ドットまで）。金の帯と星の印 */
function hat(frame, h, fy, s) {
  const g = frame.newGroup();
  const by = fy - 5;
  const tip = { x: h.x - 9.5 - s * 1.5, y: h.y - 9.5 + s * 0.6 };
  // 円錐は頭の上で頂点を作り、上の三分の一が後ろへ折れて垂れる
  const cone = polygon(
    [
      [h.x - 5.8, by + 0.5],
      [h.x + 5.2, by + 0.5],
      [h.x + 2.6, h.y - 8],
      [h.x + 0.6, h.y - 11.2],
      [h.x - 1.8, h.y - 12],
      [h.x - 5, h.y - 11.4],
      [tip.x, tip.y - 0.4],
      [tip.x + 0.4, tip.y + 1.2],
      [h.x - 5.2, h.y - 8.6],
    ],
    { round: 2.2 },
  );
  paint(frame, cone, HAT, { group: g });
  // 帽子の帯（鍔のすぐ上の金の帯）と星の印
  paint(frame, polygon([[h.x - 5.6, by - 1.2], [h.x + 4.8, by - 1.2], [h.x + 4.6, by + 0.4], [h.x - 5.8, by + 0.4]]), GOLD, { group: g, bias: -0.1, maxShade: 2, rim: false });
  stamp(frame, Math.round(h.x) - 1, Math.round(h.y) - 8, [".g.", "gGg", ".g."], { g: GOLD[2], G: GOLD[3] });
  // 先端の金の房
  paint(frame, ellipse(tip.x + 0.3, tip.y + 0.8, 1.3, 1.3), GOLD, { maxShade: 2 });
  // 鍔（顔の上に影を落とす広い楕円の板）
  paint(
    frame,
    (x, y) => {
      const nx = (x - (h.x + 0.3)) / 10.2;
      const ny = (y - by) / 2.1;
      const d = nx * nx + ny * ny;
      if (d > 1) return null;
      return { nx: nx * 0.5, ny: ny * 0.8 - 0.2 };
    },
    HAT,
    { group: frame.newGroup(), bias: 0.15 },
  );
}

const FACE_INK = { k: EYE };

/** 顔: ほぼ一色、頬に小さな明部、あごの縁にだけ影（bodyNone と同じ作り） */
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
  leg(frame, sk, "B", false);
  hairBack(frame, sk);
  robeBack(frame, sk);
  robe(frame, sk);
  leg(frame, sk, "F", true);
  mantle(frame, sk);
  amulet(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyInvoker",
  sheets: bodySheets("bodyInvoker", draw),
  meta: { arm: ARM_COLORS },
};
