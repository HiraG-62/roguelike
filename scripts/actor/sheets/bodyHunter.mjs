// 狩人の体: 森の追跡者。深緑のとがったフード付きマント、革の胸当てと斜めの負い革、
// 背中の矢筒と羽根、腰の短刀、膝当て。識別色は深緑のマントと矢羽根の赤、残りは茶と灰に落とす
import { capsule, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#8a4c3c", "#c27f5f", "#dfa27c", "#f0c49e"];
const HAIR = ["#2a1a14", "#4a2e20", "#6a442c", "#86603e"];
const CLOAK = ["#16241a", "#23392a", "#34533b", "#4b7050"];
const TUNIC = ["#2a2a22", "#3e3d30", "#565443", "#6e6b56"];
const LEATHER = ["#3a2116", "#5e3822", "#86563a", "#a87852"];
const STRAP = ["#24160f", "#3e2719", "#5a3b26", "#6f4c33"];
const PANTS = ["#1c201f", "#2c3331", "#3f4845", "#555f5b"];
const BOOTS = ["#1a1310", "#33251d", "#4c382b", "#63493a"];
const QUIVER = ["#2e1a12", "#4f2e1d", "#724530", "#8f5d42"];
const SHAFT = ["#4a3a26", "#7a6340", "#a08658", "#c2aa78"];
const FLETCH = ["#4a1418", "#7c2228", "#a8383a", "#c85a50"];
const FLETCH_PALE = ["#5e5648", "#9a8f78", "#c8bda2", "#e6dcc2"];
const STEEL = ["#3a3e4a", "#626878", "#9098a8", "#c8d0dc"];
const BRASS = ["#5c4726", "#8e733c", "#c2a153", "#e8d48e"];
const EYE = "#1a1620";

/** 腕（実行時に描く）の色: 袖はマントの下の服・手は革の手袋 */
export const ARM_COLORS = { sleeve: [TUNIC[0], TUNIC[1], TUNIC[2]], hand: [LEATHER[0], LEATHER[1], LEATHER[2]] };

function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 2.6, 2.3), capsule(kn.x, kn.y, foot.x, foot.y - 3, 2.3, 2.1)), PANTS, { group: g, bias: dim });
  // 長靴（脛の中ほどまで、紐で縛る）
  const shin = mid(kn, foot, 0.4);
  paint(frame, union(capsule(shin.x, shin.y, foot.x, foot.y - 2, 2.5, 2.6), ellipse(foot.x + 1.6, foot.y - 1.4, 3.5, 1.8)), BOOTS, { group: g, bias: dim });
  const lace = mid(shin, foot, 0.4);
  px(frame, lace.x + 1, lace.y, STRAP[2]);
  px(frame, lace.x + 1, lace.y + 1.5, STRAP[2]);
  // 膝当て（革の丸い当て + 鋲）
  paint(frame, ellipse(kn.x + 0.9, kn.y, 2.2, 2), LEATHER, { bias: dim + 0.15 });
  if (side === "F") px(frame, kn.x + 1, kn.y, BRASS[2]);
}

/** 背中の矢筒: 後ろの肩から斜めに腰へ。口から矢羽根が肩の上へ覗く */
function quiver(frame, sk) {
  const c = sk.chest;
  const top = { x: c.x - 6.5, y: c.y - 5 };
  const bot = { x: c.x - 1.5, y: sk.hip.y + 1 };
  // 矢（口から 3 本、少しずつ角度を変える）
  const arrows = [
    { dx: -7.5, dy: -8.5, fl: FLETCH },
    { dx: -4, dy: -10.5, fl: FLETCH_PALE },
  ];
  for (const a of arrows) {
    const tip = { x: top.x + a.dx, y: top.y + a.dy };
    paint(frame, capsule(top.x + a.dx * 0.3, top.y + 1, tip.x, tip.y + 1.5, 0.6), SHAFT, { rim: false, maxShade: 2 });
    // 矢羽根: 軸の両側へ開く小さな三角
    // 矢羽根: 軸に沿った細長い羽根（軸の向きへ伸びる 2 枚）
    const ux = a.dx / Math.hypot(a.dx, a.dy);
    const uy = a.dy / Math.hypot(a.dx, a.dy);
    const bx = tip.x - ux * 5;
    const by = tip.y - uy * 5;
    paint(
      frame,
      union(
        polygon([[tip.x, tip.y], [bx - uy * 2.2, by + ux * 2.2], [bx, by]]),
        polygon([[tip.x, tip.y], [bx + uy * 2.2, by - ux * 2.2], [bx, by]]),
      ),
      a.fl,
      { bias: 0.1 },
    );
  }
  // 筒
  const g = frame.newGroup();
  paint(frame, capsule(top.x, top.y, bot.x, bot.y, 2.8, 2.4), QUIVER, { group: g });
  // 口の革の縁と底の金具
  paint(frame, capsule(top.x - 2.6, top.y + 0.6, top.x + 2.8, top.y - 0.2, 1), STRAP, { group: g, bias: 0.2, maxShade: 2 });
  const band = mid(top, bot, 0.55);
  paint(frame, capsule(band.x - 2.6, band.y + 0.4, band.x + 2.6, band.y - 0.4, 0.7), BRASS, { group: g, maxShade: 2 });
}

/** 背中へ垂れるマントの裾（後ろへなびき、裾が 2 つに裂ける） */
function cloakBack(frame, sk) {
  const c = sk.chest;
  const s = sk.ps.sway;
  const hy = sk.hip.y;
  paint(
    frame,
    polygon(
      [
        [c.x - 5, c.y - 6],
        [c.x + 2, c.y - 6],
        [c.x + 1, hy + 4],
        [c.x - 4 - s * 2, hy + 6.5],
        [c.x - 6.5 - s * 3, hy + 4.5],
        [c.x - 9 - s * 3.5, hy + 6 + Math.abs(s)],
        [c.x - 10.5 - s * 3, hy + 1],
      ],
      { round: 2.5, tilt: { nx: -0.2, ny: 0.1 } },
    ),
    CLOAK,
    { bias: -0.2 },
  );
}

function torso(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const g = frame.newGroup();
  // 下の服（くすんだ緑灰）
  paint(
    frame,
    polygon(
      [
        [c.x - 5.5, c.y - 5],
        [c.x + 5, c.y - 5],
        [c.x + 6, c.y + 1],
        [h.x + 6, h.y + 2],
        [h.x - 5.5, h.y + 2],
        [c.x - 6, c.y + 1],
      ],
      { round: 3 },
    ),
    TUNIC,
    { group: g },
  );
  // 革の胸当て（胸から腹まで、前へ膨らむ）
  paint(
    frame,
    polygon(
      [
        [c.x - 4.5, c.y - 4],
        [c.x + 4.5, c.y - 4],
        [c.x + 5.8, c.y + 1],
        [c.x + 4.5, h.y - 1.5],
        [c.x - 4, h.y - 1.5],
        [c.x - 5, c.y + 1],
      ],
      { round: 2.5 },
    ),
    LEATHER,
  );
  // 胸当ての縫い目（縦に 1 本）と鋲
  px(frame, c.x + 3.5, c.y - 2.5, BRASS[2]);
  px(frame, c.x - 2.5, c.y - 2.5, BRASS[1]);
  // 斜めの負い革（前の肩から後ろの腰へ。矢筒を吊る）
  paint(frame, capsule(c.x + 4, c.y - 4, h.x - 4, h.y - 1, 1.3), STRAP, { bias: 0.1, maxShade: 2, rim: false });
  const buckle = mid({ x: c.x + 4, y: c.y - 4 }, { x: h.x - 4, y: h.y - 1 }, 0.35);
  stamp(frame, buckle.x - 1, buckle.y - 1, ["bb", "bB"], { b: BRASS[1], B: BRASS[3] });
  // 帯（太い革帯）
  paint(frame, capsule(h.x - 5.5, h.y - 0.5, h.x + 6, h.y - 0.5, 1.5), STRAP, { bias: 0.1, maxShade: 2 });
  paint(frame, ellipse(h.x + 2, h.y - 0.5, 1.5, 1.5), BRASS, { rim: false });
}

/** 腰の短刀: 前の腰に鞘ごと、柄を前上へ */
function dagger(frame, sk) {
  const h = sk.hip;
  // 鞘は前の腰から斜め後ろ下へ、柄は帯の上へ前向きに出す
  const a = { x: h.x + 3.5, y: h.y - 0.5 };
  const b = { x: h.x - 1, y: h.y + 5 };
  paint(frame, capsule(a.x, a.y, b.x, b.y, 1.4, 1), LEATHER, { bias: -0.15 });
  paint(frame, ellipse(b.x, b.y, 1.1, 1.1), BRASS, { maxShade: 2 });
  paint(frame, capsule(a.x - 1.2, a.y - 1.2, a.x + 1.4, a.y + 1, 0.8), STEEL);
  paint(frame, capsule(a.x + 0.8, a.y - 1, a.x + 3, a.y - 3.4, 0.9), STRAP, { maxShade: 2 });
  paint(frame, ellipse(a.x + 3.3, a.y - 3.7, 1, 1), STEEL);
}

/** 肩を覆うマント（フードから続く）。前は胸の上まで、留め具は葉の形 */
function mantle(frame, sk) {
  const n = sk.neck;
  const s = sk.ps.sway;
  paint(
    frame,
    polygon(
      [
        [n.x - 7.5, n.y - 1.5],
        [n.x + 5, n.y - 1.5],
        [n.x + 7, n.y + 2.5],
        [n.x + 4, n.y + 3.5],
        [n.x + 1, n.y + 3],
        [n.x - 2, n.y + 6.5],
        [n.x - 5, n.y + 6],
        [n.x - 9 - s, n.y + 7.5],
      ],
      { round: 3 },
    ),
    CLOAK,
  );
  // 裾の縁（ギザギザの切れ込み）
  // 留め具（葉の形の真鍮）
  stamp(frame, n.x + 3, n.y, [".B", "Bb", "b."], { B: BRASS[3], b: BRASS[1] });
}

function head(frame, sk) {
  const h = sk.head;
  const s = sk.ps.sway;
  const g = frame.newGroup();
  // フードの後ろ: 頭より大きく、後ろ上へ長く尖る（狩人の目印）
  paint(
    frame,
    union(
      ellipse(h.x - 0.5, h.y - 0.5, 8.6, 8.4),
      polygon([[h.x - 5, h.y - 7], [h.x - 13 - s * 1.5, h.y - 3 + s], [h.x - 11 - s, h.y + 1], [h.x - 5, h.y + 5]], { round: 2 }),
    ),
    CLOAK,
    { group: g },
  );
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  const face = frame.newGroup();
  paint(frame, faceShape(fx, fy), SKIN, { group: face });
  // 前髪: 毛束が額と頬へ流れる
  paint(
    frame,
    union(
      ellipse(fx - 0.8, fy - 4.6, 5.6, 2.2),
      polygon([[fx - 4.5, fy - 5], [fx - 3.6, fy + 0.5], [fx - 2, fy - 4]]),
      polygon([[fx - 2.4, fy - 4.5], [fx - 1.2, fy - 1.8], [fx + 0.6, fy - 4.4]]),
      polygon([[fx + 0.2, fy - 4.5], [fx + 1.8, fy - 2.4], [fx + 3, fy - 4.2]]),
      polygon([[fx + 2.4, fy - 4.4], [fx + 4.6, fy - 3], [fx + 4.6, fy - 4.8]]),
    ),
    HAIR,
    { group: face, bias: 0.15 },
  );
  px(frame, fx - 2.5, fy - 5, HAIR[3]);
  px(frame, fx - 1.5, fy - 5, HAIR[3]);
  // フードの縁: 額の上へ深く張り出す（目深にかぶる）
  paint(frame, hoodRim(fx, fy - 0.5), CLOAK, { group: g, bias: 0.3 });
  // 眼: 縦長の点を 2 つ
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy - 1, ["k", "k"], FACE_INK);
  // 頬の擦り傷の化粧（狩りの印。小さな 2 本線）
  px(frame, fx - 2, fy + 1, SKIN[0]);
  px(frame, fx - 2, fy + 2, SKIN[0]);
  px(frame, fx + 1, fy + 3, SKIN[0]);
}

const FACE_INK = { k: EYE };

/** 顔: ほぼ一色、頬の明部とあごの縁の影だけ（bodyNone と同じ決まり） */
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

/** フードの縁のうち額の上と後ろ側。見習いより額を深く覆う */
function hoodRim(cx, cy) {
  const outer = ellipse(cx - 0.2, cy - 0.3, 7.6, 7.8);
  return (x, y) => {
    const nx = (x - cx) / 5.8;
    const ny = (y - cy) / 6.2;
    if (nx * nx + ny * ny <= 1 && !(y < cy - 4.3 && x < cx + 4)) return null;
    if (y > cy - 3 && x > cx - 3.5) return null;
    return outer(x, y);
  };
}

function draw(frame, sk) {
  leg(frame, sk, "B");
  cloakBack(frame, sk);
  quiver(frame, sk);
  torso(frame, sk);
  leg(frame, sk, "F");
  dagger(frame, sk);
  mantle(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyHunter",
  sheets: bodySheets("bodyHunter", draw),
  meta: { arm: ARM_COLORS },
};
