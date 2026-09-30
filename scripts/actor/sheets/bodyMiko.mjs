// 巫女（miko）の体: 白衣（広い袖の白い小袖）と緋袴、襟元に赤の掛襟、長い黒髪を背で丈長（白い和紙）と紅白の水引で束ねる。
// 足元は白足袋に草履。彩度は袴の緋だけを立て、他は白と黒で締める。骨組み・時間割は rig.mjs の共通のもの
import { capsule, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#8a4c3c", "#c27f5f", "#dfa27c", "#f0c49e"];
const HAIR = ["#141219", "#231f2b", "#363041", "#4e4659"];
/** 白衣（暖かい白。影は灰で落とす） */
const WHITE = ["#6e6668", "#b8b0b0", "#e0dad6", "#faf7f2"];
/** 緋袴 */
const HAKAMA = ["#4a0e18", "#8a1a24", "#bc2c2e", "#e05a48"];
/** 丈長（和紙） */
const PAPER = ["#8a8272", "#d0c8b4", "#ece6d6", "#fcfaf2"];
/** 草履の台 */
const ZORI = ["#2a1a14", "#4a3024", "#6a4832", "#8a6444"];
const EYE = "#1a1620";

/** 腕（実行時に描く）の色: 袖は白衣、手は素肌 */
export const ARM_COLORS = { sleeve: [WHITE[0], WHITE[1], WHITE[2]], hand: [SKIN[0], SKIN[1], SKIN[2]] };

/** 袴の裾の高さ（絵のドット、足元から上）。足袋と草履だけを裾から出す */
const HEM_Y = -3;

/** 袴の片脚: 腰から足先へ広がる筒（行灯のように裾が開く）。裾から白足袋と草履を出す */
function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.3 : 0;
  const g = frame.newGroup();
  // 足袋と草履（裾より下）
  paint(frame, union(ellipse(foot.x + 1.2, foot.y - 1.6, 3.2, 1.6), capsule(foot.x - 0.4, foot.y - 3.5, foot.x - 0.2, foot.y - 1.5, 1.8)), WHITE, { group: g, bias: dim + 0.1, maxShade: 2 });
  paint(frame, capsule(foot.x - 1.8, foot.y - 0.5, foot.x + 4, foot.y - 0.5, 0.6), ZORI, { group: g, bias: dim, maxShade: 2 });
  // 袴の筒: 腰で細く、裾で広い
  const hem = foot.y + HEM_Y;
  const dx = foot.x - hip.x;
  const lean = dx * 0.08;
  paint(
    frame,
    polygon(
      [
        [hip.x - 3.2, hip.y - 1],
        [hip.x + 3.2, hip.y - 1],
        [foot.x + 4.6 + lean, hem],
        [foot.x - 4.4 + lean, hem + 0.3],
      ],
      { round: 2.2 },
    ),
    HAKAMA,
    { group: frame.newGroup(), bias: dim },
  );
  // 襞（腰から裾へ 1 本の筋。裾の近くだけ濃く）
  const top = { x: hip.x + 0.5, y: hip.y + 2 };
  const bot = { x: foot.x + 0.8 + lean, y: hem - 1 };
  for (let k = 0; k <= 1; k += 0.2) px(frame, top.x + (bot.x - top.x) * k, top.y + (bot.y - top.y) * k, k > 0.5 ? HAKAMA[0] : HAKAMA[1]);
}

/** 背の黒髪: 首の後ろで束ねて腰まで垂らす。束ねた所に丈長と水引 */
function hairBack(frame, sk) {
  const h = sk.head;
  const s = sk.ps.sway;
  const tie = { x: h.x - 5.5, y: h.y + 5.5 };
  const tail = { x: h.x - 7.5 - s * 2, y: sk.hip.y + 1 };
  paint(
    frame,
    polygon(
      [
        [h.x - 6.5, h.y - 2],
        [h.x - 2.5, h.y + 1],
        [tie.x + 2, tie.y + 1],
        [tail.x + 2.2, tail.y - 1],
        [tail.x + 0.5, tail.y + 1.5],
        [tail.x - 1.8, tail.y],
        [tie.x - 1.8, tie.y + 1],
        [h.x - 8, h.y + 2],
      ],
      { round: 2 },
    ),
    HAIR,
    { bias: -0.1 },
  );
  // 丈長（束ねた所に巻いた白い和紙）と紅白の水引
  paint(frame, polygon([[tie.x - 2.2, tie.y + 0.5], [tie.x + 2.4, tie.y + 0.2], [tie.x + 2.4, tie.y + 3], [tie.x - 2, tie.y + 3.2]], { round: 0.8 }), PAPER, { maxShade: 2 });
  px(frame, tie.x - 1, tie.y + 3.6, HAKAMA[2]);
  px(frame, tie.x + 0.5, tie.y + 3.6, WHITE[3]);
  px(frame, tie.x + 1.5, tie.y + 3.6, HAKAMA[2]);
  // 髪の艶（束の上に短い光の筋）
  px(frame, tie.x - 0.5, tie.y + 6, HAIR[3]);
  px(frame, tie.x - 0.8, tie.y + 7, HAIR[2]);
}

/** 後ろの袖: 奥の肩から垂れる広い白の袖（腕は実行時に描くので、垂れた袖の下だけ見せる） */
function sleeveBack(frame, sk) {
  const sh = sk.shoulderB;
  const s = sk.ps.sway;
  paint(frame, polygon([[sh.x - 1, sh.y - 1], [sh.x + 3, sh.y], [sh.x + 1.5 - s, sh.y + 11], [sh.x - 4 - s * 1.5, sh.y + 10.5], [sh.x - 4, sh.y + 3]], { round: 2.4 }), WHITE, { bias: -0.35 });
}

/** 白衣の胴と、胴を高く締める袴の腰（前の紐を蝶に結ぶ） */
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
        [c.x + 5.8, c.y + 1],
        [h.x + 5, h.y],
        [h.x - 5, h.y],
        [c.x - 6, c.y + 1],
      ],
      { round: 3 },
    ),
    WHITE,
    { group: g },
  );
  // 袴の腰（胸の下から。脚の筒とつながる）
  const waist = c.y + 3;
  paint(frame, polygon([[c.x - 5.8, waist], [c.x + 5.6, waist - 0.5], [h.x + 5.2, h.y + 1.5], [h.x - 5.4, h.y + 1.5]], { round: 2 }), HAKAMA, { bias: 0.05 });
  // 前紐（袴の上端を巻く明るい帯）と、前で結んだ垂れ
  for (let x = -5; x <= 5; x++) px(frame, c.x + x, waist + 0.6 - (x + 5) * 0.05, HAKAMA[3]);
  stamp(frame, Math.round(c.x + 2), Math.round(waist + 1.5), ["d.d", "d.d"], { d: HAKAMA[1] });
}

/** 前の袖: 手前の肩から垂れる白の袖の下 */
function sleeveFront(frame, sk) {
  const sh = sk.shoulderF;
  const s = sk.ps.sway;
  paint(frame, polygon([[sh.x - 3.5, sh.y - 0.5], [sh.x + 1, sh.y - 1], [sh.x + 1.5, sh.y + 3], [sh.x - 0.5 - s * 0.6, sh.y + 8.5], [sh.x - 5 - s, sh.y + 8], [sh.x - 5, sh.y + 3]], { round: 2.2 }), WHITE, { bias: 0.05 });
  // 袖の縫い目（裾の近くに 1 ドットの灰の線）
  for (let x = -4; x <= -1; x++) px(frame, sh.x + x - s * 0.8, sh.y + 7.2, WHITE[1]);
}

/** 襟: 白の襟を右前に合わせ、内に赤の掛襟を覗かせる */
function collar(frame, sk) {
  const n = sk.neck;
  paint(frame, union(ellipse(n.x + 0.5, n.y, 4.4, 1.9), ellipse(n.x - 2, n.y - 0.8, 2.4, 2)), WHITE, { bias: 0.2 });
  // 赤の掛襟（首の前から胸へ斜めに下りる帯）と、それを覆う白の襟の縁
  paint(frame, polygon([[n.x + 1.6, n.y + 0.6], [n.x + 4.8, n.y + 0.6], [n.x + 2.6, n.y + 5], [n.x + 1, n.y + 4.4]]), HAKAMA, { bias: 0.2, maxShade: 2, rim: false });
  for (let k = 0; k <= 4; k++) px(frame, n.x + 4.6 - k * 0.55, n.y + 1.6 + k, WHITE[2]);
}

function head(frame, sk) {
  const h = sk.head;
  const g = frame.newGroup();
  // 後ろ頭（黒髪）
  paint(frame, ellipse(h.x - 0.8, h.y - 0.4, 7.4, 7.4), HAIR, { group: g, bias: -0.05 });
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  const face = frame.newGroup();
  paint(frame, faceShape(fx, fy), SKIN, { group: face });
  // 前髪: 眉の上で切り揃えた前髪と、頬の横に垂らす横髪
  paint(
    frame,
    union(
      ellipse(fx - 0.5, fy - 4.6, 5.8, 2.4),
      polygon([[fx - 5, fy - 5], [fx + 4.8, fy - 5], [fx + 4.8, fy - 2.6], [fx - 5, fy - 2.4]]),
      polygon([[fx - 4.8, fy - 3], [fx - 2.6, fy - 3], [fx - 2.8, fy + 4.5], [fx - 4.8, fy + 4]]),
    ),
    HAIR,
    { group: face, bias: 0.15 },
  );
  // 天使の輪（頭頂の艶）
  for (const x of [-3.5, -2.5, -1.5]) px(frame, fx + x, fy - 6, HAIR[3]);
  px(frame, fx - 0.5, fy - 6, HAIR[2]);
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy - 1, ["k", "k"], FACE_INK);
  px(frame, fx + 1, fy + 3, SKIN[0]);
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
  hairBack(frame, sk);
  leg(frame, sk, "B");
  sleeveBack(frame, sk);
  torso(frame, sk);
  leg(frame, sk, "F");
  sleeveFront(frame, sk);
  collar(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyMiko",
  sheets: bodySheets("bodyMiko", draw),
  meta: { arm: ARM_COLORS },
};
