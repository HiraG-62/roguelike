// 陰陽師（onmyoji）の体: 黒漆の立烏帽子、白の狩衣（丸い襟と広い袖、後ろ身頃は膝まで垂れる）、紫の指貫（裾を足首で括った袴）、
// 黒の浅沓。狩衣の袖括りと襟の縁に淡い水色、胸に藍の五芒星。彩度は指貫の紫だけを立て、他は白と黒で締める
import { capsule, ellipse, paint, polygon, px, stamp, union } from "../paint.mjs";
import { bodySheets, mid } from "../rig.mjs";

const SKIN = ["#8a4c3c", "#c27f5f", "#dfa27c", "#f0c49e"];
const HAIR = ["#141219", "#221f2a", "#34303e", "#4a4456"];
/** 狩衣（白。影は青みの灰で落とす） */
const KARI = ["#5e6378", "#a9aec2", "#d6d9e4", "#f4f5fa"];
/** 狩衣の裏地・袖括り・襟の縁（淡い水色） */
const LINING = ["#2a4866", "#3f6f98", "#6fa2c8", "#a8d0ea"];
/** 指貫（紫の袴） */
const SASHI = ["#2c1f4a", "#4a3680", "#6a52b0", "#9480d4"];
/** 烏帽子と浅沓（黒漆） */
const LACQUER = ["#0c0b12", "#1a1824", "#2c2a3a", "#4c4862"];
const EYE = "#1a1620";
/** 胸の五芒星の藍 */
const SEAL = "#2c3d80";

/** 腕（実行時に描く）の色: 袖は狩衣の白、手は素肌 */
export const ARM_COLORS = { sleeve: [KARI[0], KARI[1], KARI[2]], hand: [SKIN[0], SKIN[1], SKIN[2]] };

/** 指貫: 腿から脛まで膨らんだ袴を足首で括り、黒の浅沓を履く */
function leg(frame, sk, side) {
  const hip = side === "F" ? sk.hipF : sk.hipB;
  const kn = side === "F" ? sk.kneeF : sk.kneeB;
  const foot = side === "F" ? sk.footF : sk.footB;
  const dim = side === "B" ? -0.25 : 0;
  const g = frame.newGroup();
  const shin = mid(kn, foot, 0.55);
  paint(frame, union(capsule(hip.x, hip.y, kn.x, kn.y, 3.3, 3.5), capsule(kn.x, kn.y, shin.x, shin.y, 3.5, 3.4), capsule(shin.x, shin.y, foot.x, foot.y - 3.2, 3.4, 2)), SASHI, { group: g, bias: dim });
  // 藤の丸の地紋（明るい 1 ドットを散らす）
  for (const t of [0.3, 0.75]) {
    const p = mid(hip, kn, t);
    px(frame, p.x + 0.5, p.y + 0.5, SASHI[2]);
  }
  const p = mid(kn, foot, 0.3);
  px(frame, p.x - 0.5, p.y, SASHI[2]);
  // 足首の括り（膨らみの下で締めた紐）
  px(frame, foot.x - 1, foot.y - 3.2, SASHI[0]);
  px(frame, foot.x, foot.y - 3.2, SASHI[0]);
  px(frame, foot.x + 1, foot.y - 3.2, SASHI[0]);
  // 浅沓（先の丸い黒漆の沓）
  paint(frame, union(ellipse(foot.x + 1.2, foot.y - 1.5, 3.8, 1.7), ellipse(foot.x - 0.2, foot.y - 2.2, 2.4, 1.4)), LACQUER, { group: g, bias: dim + 0.1 });
}

/** 後ろ身頃: 背中から膝の上まで垂れる長い裾（前身頃より長い。後ろへ流れる） */
function backPanel(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const s = sk.ps.sway;
  paint(
    frame,
    polygon(
      [
        [c.x - 5, c.y - 4],
        [c.x + 1, c.y - 4],
        [h.x - 1, h.y + 3],
        [h.x - 2 - s, h.y + 6.5],
        [h.x - 6 - s * 2, h.y + 6],
        [c.x - 7, h.y - 1],
      ],
      { round: 2.5, tilt: { nx: -0.2, ny: 0.1 } },
    ),
    KARI,
    { bias: -0.2 },
  );
  // 裏地の縁（裾の返しに淡い水色）
  for (let k = 0; k <= 1; k += 0.25) px(frame, h.x - 2.5 - s + (-3 - s) * k, h.y + 5.7 - k * 0.4, LINING[1]);
}

/** 後ろの袖: 奥の肩から垂れる広い袖の袋（腕は実行時に描くので、垂れた袖の下だけ見せる） */
function sleeveBack(frame, sk) {
  const sh = sk.shoulderB;
  const s = sk.ps.sway;
  paint(
    frame,
    polygon([[sh.x - 1, sh.y - 1], [sh.x + 3, sh.y], [sh.x + 1.5 - s, sh.y + 11], [sh.x - 4 - s * 1.5, sh.y + 10], [sh.x - 4, sh.y + 3]], { round: 2.4 }),
    KARI,
    { bias: -0.3 },
  );
  paint(frame, capsule(sh.x - 3.4 - s * 1.5, sh.y + 10, sh.x + 1 - s, sh.y + 11, 0.8), LINING, { bias: -0.2, maxShade: 2, rim: false });
  // 袖の紋: 藍の五芒星（晴明桔梗）
  stamp(frame, Math.round(sh.x - 3 - s), Math.round(sh.y + 3), ["..s..", "sssss", ".sss.", ".s.s."], { s: SEAL });
}

/** 前身頃: 肩から腿の半ばまで。脇は開いて指貫が見える。当帯で締める */
function torso(frame, sk) {
  const c = sk.chest;
  const h = sk.hip;
  const s = sk.ps.sway;
  const g = frame.newGroup();
  const front = Math.max(sk.kneeF.x, h.x + 4);
  paint(
    frame,
    polygon(
      [
        [c.x - 5.5, c.y - 5],
        [c.x + 5, c.y - 5],
        [c.x + 6, c.y + 1],
        [h.x + 5.5, h.y],
        [front + 1.5 - s * 0.5, h.y + 3.5],
        [h.x - 1, h.y + 4],
        [h.x - 5.5, h.y + 1],
        [c.x - 6, c.y + 1],
      ],
      { round: 3 },
    ),
    KARI,
    { group: g },
  );
  // 前身頃の襞（腰から裾へ）
  for (let k = 0; k <= 1; k += 0.34) px(frame, h.x + 1.5 + k * (front - h.x - 1.5) * 0.5, h.y + 0.5 + k * 2.5, KARI[1]);
  // 当帯（身頃と同じ白の細い帯。締めた所だけ暗い筋）
  paint(frame, capsule(h.x - 5.4, h.y - 2.5, h.x + 5.4, h.y - 2.5, 1.1), KARI, { group: g, bias: -0.35, maxShade: 2 });
  px(frame, h.x + 2.5, h.y - 2.5, KARI[0]);
}

/** 前の袖: 手前の肩から垂れる袖の下。袖括りの水色の房が裾に下がる */
function sleeveFront(frame, sk) {
  const sh = sk.shoulderF;
  const s = sk.ps.sway;
  paint(
    frame,
    polygon([[sh.x - 3.5, sh.y - 0.5], [sh.x + 1, sh.y - 1], [sh.x + 1.5, sh.y + 3], [sh.x - 0.5 - s * 0.6, sh.y + 8.5], [sh.x - 5 - s, sh.y + 8], [sh.x - 5, sh.y + 3]], { round: 2.2 }),
    KARI,
    { bias: 0.05 },
  );
  // 袖括り（裾の縁の水色）
  paint(frame, capsule(sh.x - 4.6 - s, sh.y + 8, sh.x - 0.8 - s * 0.6, sh.y + 8.4, 0.75), LINING, { maxShade: 2, rim: false });
}

/** 盤領（丸い襟）: 首を囲む白い輪と、水色の縁 */
function collar(frame, sk) {
  const n = sk.neck;
  paint(frame, union(ellipse(n.x + 0.5, n.y, 4.8, 2.1), ellipse(n.x - 2.2, n.y - 0.8, 2.6, 2.1)), KARI, { bias: 0.15 });
  for (let x = -3; x <= 4; x++) px(frame, n.x + x + 0.5, n.y + 1.8 - Math.abs(x - 0.5) * 0.12, LINING[1]);
  // 前の留め（蜻蛉頭の小さな結び）
  px(frame, n.x + 4, n.y + 0.5, LINING[2]);
}

function head(frame, sk) {
  const h = sk.head;
  const g = frame.newGroup();
  // 後ろ頭（髪を烏帽子の中へ結い上げた丸い頭）
  paint(frame, ellipse(h.x - 1.2, h.y + 0.3, 6.2, 6.2), HAIR, { group: g, bias: -0.1 });
  const fx = Math.round(h.x) + 2;
  const fy = Math.round(h.y) + 1;
  const face = frame.newGroup();
  paint(frame, faceShape(fx, fy), SKIN, { group: face });
  // 鬢（耳の前の髪）と、烏帽子の縁の下の短い前髪
  paint(
    frame,
    union(
      ellipse(fx - 1, fy - 4.4, 5.2, 1.5),
      polygon([[fx - 4.8, fy - 4.8], [fx - 3.2, fy + 2.5], [fx - 2, fy - 4]]),
      polygon([[fx - 1.4, fy - 4.4], [fx + 0.2, fy - 2.8], [fx + 1.4, fy - 4.4]]),
    ),
    HAIR,
    { group: face, bias: 0.15 },
  );
  px(frame, fx - 3.5, fy - 1, HAIR[3]);
  // 眼: 縦長の 1 ドット幅の点を 2 つ
  stamp(frame, fx - 0.5, fy - 1, ["k", "k"], FACE_INK);
  stamp(frame, fx + 2.5, fy - 1, ["k", "k"], FACE_INK);
  px(frame, fx + 1, fy + 3, SKIN[0]);
  eboshi(frame, h, fx, fy, sk.ps.sway);
}

/** 立烏帽子: 頭の上へ高く立つ黒漆の冠。頂は少し後ろへ倒れ、前の上端に招きの折れ。額の縁に紐 */
function eboshi(frame, h, fx, fy, s) {
  const g = frame.newGroup();
  const by = fy - 4;
  const top = h.y - 16;
  const lean = -2.5 - s * 0.4;
  paint(
    frame,
    polygon(
      [
        [h.x - 4.6, by + 0.6],
        [h.x + 3.6, by - 0.2],
        [h.x + 3.2 + lean * 0.4, h.y - 9],
        [h.x + 3 + lean, top + 2.6],
        [h.x + 1.4 + lean, top + 1.4],
        [h.x - 0.2 + lean, top],
        [h.x - 2.6 + lean, top + 0.4],
        [h.x - 4 + lean * 0.6, h.y - 9],
      ],
      { round: 2, tilt: { nx: -0.1, ny: 0 } },
    ),
    LACQUER,
    { group: g },
  );
  // 漆の艶（左上の縦の筋）と、招きの折れ目（暗い斜めの線）
  for (let y = top + 3; y <= h.y - 8; y += 1) px(frame, h.x - 2.2 + lean * ((h.y - 8 - y) / (h.y - 8 - top)) * 0.8, y, LACQUER[3]);
  for (let k = 0; k <= 1; k += 0.34) px(frame, h.x + 2.2 + lean - k * 1.5, top + 2.6 + k * 2.5, LACQUER[0]);
  // 額の縁の紐（紫の懸緒）
  for (let x = -4; x <= 3; x++) px(frame, h.x + x, by + 0.2 - (x + 4) * 0.1, SASHI[2]);
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
  leg(frame, sk, "B");
  sleeveBack(frame, sk);
  backPanel(frame, sk);
  leg(frame, sk, "F");
  torso(frame, sk);
  sleeveFront(frame, sk);
  collar(frame, sk);
  head(frame, sk);
}

export const ATLAS = {
  key: "bodyOnmyoji",
  sheets: bodySheets("bodyOnmyoji", draw),
  meta: { arm: ARM_COLORS },
};
