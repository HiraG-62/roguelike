// 影の体: 黒装束の隠密。頭と口元を黒布で覆って目元だけを見せ、長い暗赤の襟巻きを後ろへなびかせる。
// 脛は灰の脚絆、腰に暗赤の帯と背の小太刀。彩度は襟巻きと帯の暗い赤だけを立て、残りは黒と灰に落とす
import { capsule, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#7a4436", "#b07058", "#cf9172", "#e6b391"];
/** 黒装束（床の暗い石に沈まないよう、真っ黒ではなく青みの炭色） */
const GARB = ["#15141c", "#24232e", "#363545", "#4d4a5e"];
/** 頭巾・覆面（装束より一段暗く、目元の肌を際立たせる） */
const HOOD = ["#111017", "#1d1c26", "#2d2b39", "#433f52"];
/** 脚絆・手甲の灰の布 */
const WRAP = ["#2e2e39", "#454552", "#5e5e6c", "#7c7c8a"];
const RED = ["#3a0f15", "#621a22", "#8a2a2e", "#aa4240"];
const SHOE = ["#0f0e14", "#1c1b24", "#2b2a36", "#3d3b4a"];
const STEEL = ["#4a4d5a", "#7b8090", "#aab0bf", "#dde2ec"];
const EYE = "#140f16";

/** 腕（実行時に描く）の色: 袖は装束、手は灰の手甲 */
export const ARM_COLORS = { sleeve: [GARB[0], GARB[1], GARB[2]], hand: [WRAP[0], WRAP[1], WRAP[2]] };

function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  // 太腿はゆとりのある袴状（膝で絞る）
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 2.9, 2.3), capsule(kn.x, kn.y, foot.x, foot.y - 3, 2.2, 2)), GARB, { group: g, bias: dim });
  // 脚絆: 脛の上から足首まで灰の布を巻く
  const shin = mid(kn, foot, 0.2);
  paint(frame, capsule(shin.x, shin.y, foot.x, foot.y - 2.2, 2.4, 2.2), WRAP, { group: g, bias: dim - 0.1, maxShade: 2 });
  // 巻きの筋（斜めの 1 ドットの線）
  for (const t of [0.3, 0.6]) {
    const p = mid(shin, { x: foot.x, y: foot.y - 2.2 }, t);
    px(frame, p.x - 1, p.y, WRAP[0]);
    px(frame, p.x, p.y + 0.6, WRAP[0]);
    px(frame, p.x + 1, p.y + 1.1, WRAP[0]);
  }
  // 足袋: 細く低い黒の履物
  paint(frame, union(ellipse(foot.x + 1.4, foot.y - 1.3, 3.2, 1.6), capsule(foot.x, foot.y - 2, foot.x + 0.5, foot.y - 1, 2)), SHOE, { group: g, bias: dim });
}

/** 長い襟巻き: 首の後ろから 2 本の帯が大きくなびき、先が細く尖る */
function scarfTail(frame, sk) {
  const n = sk.neck;
  const s = sk.ps.sway;
  // 腕と見間違えないよう、肩の後ろから斜め下へ流れてから先が風で跳ねる
  for (const [dy, len, r, lag] of [
    [-0.5, 19, 1.6, 0],
    [1.2, 14, 1.2, 1],
  ]) {
    const a = { x: n.x - 2.5, y: n.y + dy };
    const b = { x: a.x - len * 0.35, y: a.y + 3.5 + lag - s * 1.2 };
    const c = { x: a.x - len * 0.7 - s * 1.2, y: a.y + 6 + lag * 1.5 - s * 2.4 };
    const d = { x: a.x - len - s * 2.2, y: c.y - 0.5 - s * 1.8 + lag * 0.5 };
    paint(
      frame,
      union(capsule(a.x, a.y, b.x, b.y, r + 0.2, r), capsule(b.x, b.y, c.x, c.y, r, r * 0.85), capsule(c.x, c.y, d.x, d.y, r * 0.85, 0.45)),
      RED,
      { bias: -0.1 - lag * 0.2, maxShade: 2 },
    );
  }
}

/** 背の小太刀（腰の後ろに横へ差す）。鞘は黒、鍔と柄頭に鋼 */
function backBlade(frame, sk) {
  const h = sk.hip;
  const a = { x: h.x + 2, y: h.y - 4 };
  const b = { x: h.x - 9, y: h.y + 0.5 };
  paint(frame, capsule(a.x, a.y, b.x, b.y, 1.2, 1), SHOE, { bias: 0.1 });
  const hilt = { x: a.x + 3, y: a.y - 1.3 };
  paint(frame, capsule(a.x + 0.6, a.y - 0.2, hilt.x, hilt.y, 0.9), WRAP, { maxShade: 2 });
  paint(frame, ellipse(a.x + 0.4, a.y - 0.1, 0.9, 1.6), STEEL, { maxShade: 2 });
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
        [c.x + 5.5, c.y + 1],
        [h.x + 5, h.y + 1.5],
        [h.x - 5, h.y + 1.5],
        [c.x - 5.5, c.y + 1],
      ],
      { round: 3 },
    ),
    GARB,
    { group: g },
  );
  // 前合わせ: 左の襟が右へ斜めに重なる（1 段明るい縁と暗い影の 2 本の線）
  for (let y = c.y - 4; y < h.y - 2; y += 1) {
    const t = (y - (c.y - 4)) / Math.max(1, h.y - 2 - (c.y - 4));
    const x = c.x - 2 + t * 5;
    px(frame, x, y, GARB[3]);
    px(frame, x + 1, y, GARB[0]);
  }
  // 帯: 暗赤の太い帯と前の結び目、結びの端が下へ垂れる
  paint(frame, capsule(h.x - 5, h.y - 1.8, h.x + 5.2, h.y - 1.8, 1.7), RED, { group: g, bias: 0.05, maxShade: 2 });
  const s = sk.ps.sway;
  paint(frame, union(ellipse(h.x + 3, h.y - 1.8, 1.5, 1.5), capsule(h.x + 3, h.y - 1, h.x + 3.8 - s * 0.6, h.y + 3.2, 0.8, 0.6)), RED, { bias: 0.2, maxShade: 2 });
  // 腰の後ろに垂れる帯の端
  paint(frame, capsule(h.x - 4.5, h.y - 1.5, h.x - 7 - s * 1.2, h.y + 3, 0.9, 0.6), RED, { bias: -0.15, maxShade: 2 });
}

/** 肩の短い覆い布（頭巾から続く）。黒い塊で肩の線を出す */
function shoulderCloth(frame, sk) {
  const n = sk.neck;
  paint(
    frame,
    polygon(
      [
        [n.x - 6.5, n.y - 0.5],
        [n.x + 5, n.y - 0.5],
        [n.x + 6.5, n.y + 3.5],
        [n.x + 3, n.y + 5.5],
        [n.x - 3, n.y + 6],
        [n.x - 7, n.y + 4.5],
      ],
      { round: 3 },
    ),
    HOOD,
    { bias: 0.1 },
  );
}

function head(frame, sk) {
  const h = sk.head;
  const g = frame.newGroup();
  // 頭巾: 頭をぴったり包み、後ろに結び目の小さな端が 2 本
  const s = sk.ps.sway;
  paint(
    frame,
    union(
      ellipse(h.x - 0.3, h.y - 0.3, 8, 8),
      capsule(h.x - 6.5, h.y - 1, h.x - 10.5 - s * 1.2, h.y - 2.5 + s, 1.1, 0.5),
      capsule(h.x - 6.5, h.y, h.x - 10 - s * 1.5, h.y + 2 - s * 0.5, 1, 0.5),
    ),
    HOOD,
    { group: g },
  );
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  // 目元: 頭巾の隙間に細い帯の肌だけを見せる（ほぼ一色、頬の明部は 1 ドット）
  paint(frame, eyeSlit(fx, fy), SKIN, { group: frame.newGroup() });
  // 眼: 1 ドット幅 × 2 の縦長の点を 2 つ（間を空ける）
  stamp(frame, fx - 0.5, fy - 2, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy - 2, ["k", "k"], FACE_INK);
  // 覆面: 鼻から下を覆う布（下へふくらみ、あごの下で首へ続く）
  paint(frame, maskShape(fx, fy), GARB, { group: frame.newGroup(), bias: 0.2 });
  // 覆面の上端の折り返し（1 段明るい線）と鼻の稜線
  for (let x = -2; x <= 4; x++) px(frame, fx + x, fy + 0.5, GARB[3]);
  px(frame, fx + 3, fy + 1.5, GARB[2]);
  // 頭巾の艶（左上に短い光の筋）
  px(frame, h.x - 4.5, h.y - 5.5, HOOD[3]);
  px(frame, h.x - 3.5, h.y - 6.2, HOOD[3]);
}

const FACE_INK = { k: EYE };

/** 目元の帯（額の下から鼻の上まで）。顔の前だけ（後ろは頭巾） */
function eyeSlit(cx, cy) {
  return (x, y) => {
    if (y < cy - 3.2 || y > cy + 0.5) return null;
    if (x < cx - 2.6 || x > cx + 4.9) return null;
    const ny = (y - cy) / 5.6;
    const nx = (x - cx) / 5.2;
    if (nx * nx + ny * ny > 1) return null;
    if (Math.hypot(x - (cx - 1.4), y - (cy - 0.1)) < 0.6) return 2;
    return 1;
  };
}

/** 覆面（鼻から下）。顔の輪郭よりわずかに前へふくらむ */
function maskShape(cx, cy) {
  const base = ellipse(cx + 0.6, cy + 1.8, 5.4, 4.2);
  return (x, y) => {
    if (y < cy + 0.5 || x < cx - 3) return null;
    return base(x, y);
  };
}

/** 首に巻いた襟巻き（前へ少し垂れる結び目） */
function scarfWrap(frame, sk) {
  const n = sk.neck;
  paint(frame, union(ellipse(n.x + 0.3, n.y + 0.2, 5.4, 2.1), ellipse(n.x + 3.6, n.y + 2.2, 1.5, 1.9)), RED);
  // 巻きの重なりの影
  px(frame, n.x - 1, n.y + 1, RED[0]);
}

function draw(frame, sk) {
  leg(frame, sk, "B");
  scarfTail(frame, sk);
  backBlade(frame, sk);
  torso(frame, sk);
  leg(frame, sk, "F");
  shoulderCloth(frame, sk);
  scarfWrap(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyShadow",
  sheets: bodySheets("bodyShadow", draw),
  meta: { arm: ARM_COLORS },
};
