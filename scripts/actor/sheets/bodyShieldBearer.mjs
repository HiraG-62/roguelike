// 盾持ちの体: 重装の騎士。面頬付きの兜（顔は覗き穴から眼だけ）、紺のサーコートに金の紋章、厚い肩当て、板金の脚。
// 識別色は紺と金。鋼は武器の鋼（weapon.mjs の STEEL）より一段暗く青みに寄せ、手に持つ武器と見分けられるようにする
import { capsule, clip, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const ARMOR = ["#2b2f3d", "#4f5870", "#8390aa", "#c3cde0"];
const DARK = ["#1b1b24", "#303241", "#4a4d60", "#686c82"];
const NAVY = ["#121830", "#1d2750", "#2d3b72", "#465893"];
const GOLD = ["#5a4424", "#8f7239", "#c6a452", "#efe0a0"];
const PLUME = ["#3a1420", "#62202e", "#8a3440", "#a8504f"];
/** 覗き穴の奥（面頬の隙間）と、その奥に光る眼 */
const SLIT = "#0e0d14";
const EYE_GLINT = "#b8ab86";

/** 腕（実行時に描く）の色: 袖 = 鋼の腕甲、手 = 暗い籠手 */
export const ARM_COLORS = { sleeve: [ARMOR[0], ARMOR[1], ARMOR[2]], hand: [DARK[1], DARK[2], DARK[3]] };

function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  // 腿は板金の腿当て（一段暗く）、脛は板金の脛当て
  paint(frame, capsule(hip.x, hip.y, kn.x, kn.y, 2.8, 2.5), ARMOR, { group: g, bias: dim - 0.2 });
  const greave = frame.newGroup();
  paint(frame, union(capsule(kn.x, kn.y + 0.5, foot.x, foot.y - 2.5, 2.7, 2.5), ellipse(foot.x + 1.8, foot.y - 1.5, 3.9, 1.9)), ARMOR, {
    group: greave,
    bias: dim,
  });
  // 鉄靴の甲の継ぎ目
  px(frame, foot.x + 1, foot.y - 2.5, ARMOR[0]);
  px(frame, foot.x + 2, foot.y - 2, ARMOR[0]);
  // 膝当て（丸い板と金の鋲）
  paint(frame, ellipse(kn.x + 0.6, kn.y, 2.7, 2.4), ARMOR, { bias: dim + 0.15 });
  px(frame, kn.x + 1, kn.y, side === "F" ? GOLD[2] : GOLD[1]);
}

function capeBack(frame, sk) {
  const c = sk.chest;
  const s = sk.ps.sway;
  // 背中に垂れる紺の短いマント（肩から腰の下まで、後ろへなびく）
  paint(
    frame,
    polygon(
      [
        [c.x - 5, c.y - 6],
        [c.x + 1, c.y - 6],
        [c.x, sk.hip.y + 4],
        [c.x - 6 - s * 3, sk.hip.y + 5 + Math.abs(s)],
        [c.x - 9.5 - s * 3, sk.hip.y + 2],
      ],
      { round: 2.5, tilt: { nx: -0.2, ny: 0.1 } },
    ),
    NAVY,
    { bias: -0.25 },
  );
}

function pauldron(frame, sk, side) {
  const sh = side === "F" ? sk.shoulderF : sk.shoulderB;
  const dim = side === "B" ? -0.3 : 0;
  const dx = side === "F" ? 0.8 : -0.8;
  const g = frame.newGroup();
  // 2 枚重ねの厚い肩当て（上の大きな板 + 下にのぞく小板）
  paint(frame, ellipse(sh.x + dx, sh.y + 2.4, 3.8, 2.3), ARMOR, { group: g, bias: dim - 0.1 });
  paint(frame, ellipse(sh.x + dx * 0.5, sh.y + 0.2, 4.4, 3.2), ARMOR, { bias: dim + 0.05 });
  // 縁の金の帯（下縁に沿う 1 ドットの線）
  if (side === "F") {
    for (let x = -3; x <= 3; x++) px(frame, sh.x + dx * 0.5 + x, sh.y + 2.9 - Math.abs(x) * 0.35, GOLD[1]);
    px(frame, sh.x + dx * 0.5 - 1.5, sh.y - 1.5, ARMOR[3]);
  }
}

function torso(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const g = frame.newGroup();
  // 胴: 胸は鋼の胸甲、その上から紺のサーコート（胸から腿の上まで）
  paint(
    frame,
    polygon(
      [
        [c.x - 5.5, c.y - 5.5],
        [c.x + 5.5, c.y - 5.5],
        [c.x + 6.5, c.y + 1],
        [h.x + 6, h.y + 1.5],
        [h.x - 5.5, h.y + 1.5],
        [c.x - 6.5, c.y + 1],
      ],
      { round: 3 },
    ),
    ARMOR,
    { group: g },
  );
  const coat = frame.newGroup();
  paint(
    frame,
    polygon(
      [
        [c.x - 5, c.y - 3],
        [c.x + 5, c.y - 3],
        [c.x + 6, c.y + 1],
        [h.x + 6.2, h.y + 4.5],
        [h.x + 1, h.y + 5.5],
        [h.x - 4, h.y + 4.5],
        [c.x - 6, c.y + 1],
      ],
      { round: 2.5 },
    ),
    NAVY,
    { group: coat },
  );
  // サーコートの裾の金の縁取り
  for (let x = -4; x <= 6; x++) {
    const y = x < 1 ? h.y + 4.5 + (x + 4) * 0.2 : h.y + 5.5 - (x - 1) * 0.2;
    px(frame, h.x + x, y, GOLD[1]);
  }
  // 襟ぐりの縁取り
  for (let x = -4; x <= 4; x++) px(frame, c.x + x, c.y - 3, GOLD[x < 0 ? 2 : 1]);
  // 帯と大きな金の留め金
  paint(frame, capsule(h.x - 5, h.y - 1.2, h.x + 6, h.y - 1.2, 1.3), DARK, { group: coat, bias: 0.1, maxShade: 2 });
  paint(frame, polygon([[h.x + 1.5, h.y - 2.8], [h.x + 4.5, h.y - 2.8], [h.x + 4.5, h.y + 0.4], [h.x + 1.5, h.y + 0.4]]), GOLD, { rim: GOLD[0] });
  crest(frame, Math.round(c.x) - 1, Math.round(c.y) + 1);
}

/** 胸の紋章: 金の十字（縦長）と横木の先の点。画素の格子に揃えて押す */
function crest(frame, x, y) {
  stamp(frame, x - 2, y - 2, [".a.", ".a.", "aba", ".a.", ".a.", ".c."], { a: GOLD[2], b: GOLD[3], c: GOLD[1] });
}

function plume(frame, sk) {
  const h = sk.head;
  const s = sk.ps.sway;
  // 兜の天辺から後ろへ流れる短い房（深い赤。頭の中心から上へ 11 ドットまで）
  const a = { x: h.x - 1, y: h.y - 9.5 };
  const b = { x: h.x - 6 - s * 1.5, y: h.y - 10.5 + s };
  const c = { x: h.x - 10 - s * 2.5, y: h.y - 6.5 + s * 1.5 };
  paint(frame, union(capsule(a.x, a.y, b.x, b.y, 1.9, 2.1), capsule(b.x, b.y, c.x, c.y, 2.1, 1)), PLUME, { bias: -0.05, maxShade: 2 });
}

function head(frame, sk) {
  const h = sk.head;
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  const g = frame.newGroup();
  // 兜の鉢（丸い）と、首を守る後ろの垂れ（しころ）
  paint(frame, union(ellipse(h.x - 0.3, h.y - 0.8, 7.8, 8), polygon([[h.x - 7.5, h.y], [h.x - 2, h.y + 1], [h.x - 3, h.y + 7], [h.x - 8.5, h.y + 5]], { round: 2 })), ARMOR, {
    group: g,
  });
  // 面頬: 顔の前を覆う板（前へ少し尖る）
  const visor = frame.newGroup();
  paint(
    frame,
    polygon(
      [
        [fx - 3, fy - 4],
        [fx + 4.2, fy - 3.5],
        [fx + 6, fy + 0.5],
        [fx + 4.5, fy + 5],
        [fx - 2, fy + 6],
        [fx - 3.5, fy + 1],
      ],
      { round: 2.2, tilt: { nx: 0.15, ny: 0 } },
    ),
    ARMOR,
    { group: visor, bias: 0.05 },
  );
  // 眉庇の金の帯（覗き穴の上）
  for (let x = -5; x <= 4; x++) px(frame, fx + x, fy - 3.5 + (x < -2 ? 0 : 0), GOLD[x < 0 ? 2 : 1]);
  // 天辺の稜（前後に走る鶏冠状の筋）
  for (let x = -4; x <= 3; x++) px(frame, h.x + x, h.y - 8.2 + Math.abs(x + 0.5) * 0.18, x < 0 ? ARMOR[3] : ARMOR[2]);
  // 覗き穴: 横長の暗い隙間。眼は奥で光る縦長の点を 2 つ（間を空ける）
  stamp(frame, fx - 1, fy - 2, ["kkkkkk", "kkkkk."], { k: SLIT });
  stamp(frame, fx + 1, fy - 2, ["e..e", "e..e"], { e: EYE_GLINT });
  // 面頬の下半分の通気孔（1 ドットの点の列）
  for (const [x, y] of [
    [2, 2],
    [4, 2],
    [2, 4],
    [4, 3.5],
  ])
    px(frame, fx + x, fy + y, DARK[0]);
  // 鉢の艶（左上に小さく）
  px(frame, h.x - 3.5, h.y - 5.5, ARMOR[3]);
  px(frame, h.x - 2.5, h.y - 6.5, ARMOR[3]);
}

function gorget(frame, sk) {
  const n = sk.neck;
  // 喉当て（首回りの鋼の輪）
  paint(frame, clip(ellipse(n.x + 0.8, n.y + 0.4, 5.2, 2.4), 0, 1, 3), ARMOR, { bias: -0.05 });
}

function draw(frame, sk) {
  leg(frame, sk, "B");
  plume(frame, sk);
  capeBack(frame, sk);
  pauldron(frame, sk, "B");
  torso(frame, sk);
  leg(frame, sk, "F");
  // 前の脚の付け根をサーコートの裾で覆う（重装の腰の垂れ）
  faulds(frame, sk);
  gorget(frame, sk);
  head(frame, sk);
  pauldron(frame, sk, "F");
}

function faulds(frame, sk) {
  const h = sk.hip;
  const f = mid(sk.hipF, sk.kneeF, 0.35);
  // 腿の上に掛かる板の垂れ（前の脚の上端だけを隠す）
  paint(frame, polygon([[h.x - 1, h.y + 1], [h.x + 6, h.y + 1], [f.x + 3.5, f.y + 2.5], [f.x - 2.5, f.y + 2.5]], { round: 1.5 }), ARMOR, { bias: -0.05 });
  for (let x = -2; x <= 3; x++) px(frame, f.x + x, f.y + 2, GOLD[1]);
}

export const ATLAS = {
  key: "bodyShieldBearer",
  sheets: bodySheets("bodyShieldBearer", draw),
  meta: { arm: ARM_COLORS },
};
