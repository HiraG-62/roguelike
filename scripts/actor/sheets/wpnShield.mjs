// 大盾: 紺地に金の十字を掲げた縦長の塔盾。握り（原点）の前に盾を立て、面を +x（照準の向き）へ向ける。
// 面は前へふくらんだ弓なりで、手前（画面の上）へ少し傾けて塗り、真横からでも紋章と盾心が見える。鋼の縁と金の鋲
import { capsule, ellipse, paint, polygon, px } from "../paint.mjs";
import { DARK_STEEL, GOLD, LEATHER, STEEL, weaponSheets } from "../weapon.mjs";

/** 紺の塗り（識別色） */
const NAVY = ["#161a33", "#27305a", "#3f4d86", "#6b7db8"];
/** 盾の半分の高さ（y 方向） */
const H = 16.5;
/** 盾の面の手前（中央、x） */
const FRONT = 11;
/** 盾の板の厚み（奥行きの見え） */
const DEPTH = 9.5;
/** 弓なりの深さ（端ほど後ろへ下がる） */
const BOW = 2.5;

/** 前の面の x（y の位置で） */
function frontX(y) {
  const t = y / H;
  return FRONT - BOW * t * t;
}

/** 盾の外形（上下の端は角を落とす） */
function inShield(x, y, inset = 0) {
  const a = Math.abs(y);
  if (a > H - inset) return false;
  const f = frontX(y) - inset;
  const b = f - DEPTH + inset;
  // 上下の端の角を斜めに落とす
  const corner = Math.max(0, a - (H - 3.5));
  return x <= f - corner * 0.6 && x >= b + corner * 0.6;
}

/** 面の法線: 前（+x）へ向きつつ、弓なりで上下へ振れ、手前へ少し起こす */
function faceNormal(y) {
  const t = y / H;
  return { nx: 0.45, ny: t * 0.7, nz: 0.65 };
}

function draw(frame) {
  // 握り（盾の裏の革帯。手の中）
  paint(frame, capsule(-1, 0, 2.5, 0, 1.3), LEATHER);
  // 盾の本体（鋼の縁の帯）
  paint(frame, (x, y) => (inShield(x, y) ? faceNormal(y) : null), STEEL);
  // 紺の地（縁の内側）
  paint(frame, (x, y) => (inShield(x, y, 1.6) ? faceNormal(y) : null), NAVY, { rim: false });
  // 金の十字（縦の帯と、盾心を通る横の帯）
  const g = frame.newGroup();
  paint(frame, (x, y) => (inShield(x, y, 2.6) && Math.abs(x - (frontX(y) - DEPTH / 2)) < 1.3 ? faceNormal(y) : null), GOLD, { group: g, rim: false });
  paint(frame, (x, y) => (inShield(x, y, 1.6) && Math.abs(y) < 1.3 ? faceNormal(y) : null), GOLD, { group: g, rim: false });
  // 盾心（前へ突き出た金の半球と鋼の鋲）
  paint(frame, ellipse(FRONT - DEPTH / 2 + 1, 0, 3.4, 3.8), GOLD);
  paint(frame, capsule(FRONT - DEPTH / 2 + 3, 0, FRONT - DEPTH / 2 + 5.6, 0, 1.3, 0.5), STEEL);
  // 縁の鋲（1 ドットの金の点）
  for (const y of [-13, -8, 8, 13]) for (const dx of [0.9, DEPTH - 1.1]) px(frame, frontX(y) - dx, y, GOLD[3]);
  // 奥の縁（厚みの暗い面）
  paint(frame, (x, y) => (inShield(x, y) && x < frontX(y) - DEPTH + 1.2 ? { nx: -0.6, ny: 0, nz: 0.4 } : null), DARK_STEEL, { rim: false });
  // 上下の端の鋼の口金
  for (const s of [-1, 1]) paint(frame, polygon([[FRONT - BOW - DEPTH + 1.5, s * (H - 0.5)], [FRONT - BOW - 0.5, s * (H - 0.5)], [FRONT - BOW - 2, s * (H + 1.6)], [FRONT - BOW - DEPTH + 3, s * (H + 1.6)]], { round: 1 }), STEEL);
}

export const ATLAS = { key: "wpnShield", sheets: weaponSheets("wpnShield", draw, { size: 48 }), meta: { offGrip: null, stance: { grip: "one", body: "heavy", restDeg: 0, restHand: [6, 8], swayDeg: 1.5, braced: true } } };
