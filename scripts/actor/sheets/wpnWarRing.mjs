// 戦輪（左で投げる輪。照準へ向けて構える）: 薄く平たい鋼の輪。外周は研いだ刃の艶、内側に金の象嵌の帯と点刻、
// 手前の縁に革を巻いて握り、赤い飾り紐を後ろへ垂らす。チャクラム（棘のある輪）と見分けるため外形は滑らかな円。
// 投げる輪の出る位置（輪の中心）を銃口の印で渡す
import { capsule, ellipse, paint, polygon, px } from "../paint.mjs";
import { CLOTH_RED, GOLD, LEATHER, STEEL, weaponSheets } from "../weapon.mjs";

const CX = 11.5;
const R_OUT = 12;
const R_EDGE = 10.4;
const R_INLAY_OUT = 9.4;
const R_INLAY_IN = 8.2;
const R_IN = 7;
/** 刃の輪の鋼（青みを足して手の鋼と分ける） */
const BLUE_STEEL = ["#2c3448", "#56647f", "#93a4c0", "#e4eefa"];

/** 輪の面: 外周へ向けて研いで傾ける（刃）、内は平ら */
function ringFace(x, y) {
  const dx = x - CX;
  const r = Math.hypot(dx, y);
  if (r > R_OUT || r < R_IN) return null;
  const k = r > R_EDGE ? 0.85 : r < R_IN + 0.9 ? -0.5 : 0;
  return { nx: (dx / r) * k, ny: (y / r) * k };
}

function draw(frame) {
  // 飾り紐（握りから後ろへ垂れて 2 本に割れる）
  paint(frame, polygon([[-1, 1], [0.5, 2.5], [-4, 8], [-6.5, 9.5], [-5, 6.5]], { round: 1 }), CLOTH_RED);
  paint(frame, polygon([[-1.5, 2], [-0.5, 3], [-2, 10.5], [-3.8, 11], [-3, 7]], { round: 1 }), CLOTH_RED, { bias: -0.1 });
  paint(frame, ringFace, BLUE_STEEL);
  // 金の象嵌の帯と点刻
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x - CX, y);
      return r <= R_INLAY_OUT && r >= R_INLAY_IN ? { nx: 0, ny: -0.2 } : null;
    },
    GOLD,
    { rim: false, maxShade: 2 },
  );
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    if (Math.cos(a) < -0.7) continue;
    px(frame, CX + Math.cos(a) * 10.2, Math.sin(a) * 10.2, GOLD[2]);
  }
  // 握り（手前の縁の革巻き）と金の口輪
  paint(frame, capsule(0.2, -4.2, 0.2, 4.2, 1.9), LEATHER);
  for (let y = -3; y <= 3; y += 2) paint(frame, capsule(-1.4, y - 0.3, 1.8, y + 0.4, 0.35), LEATHER, { minShade: 0, maxShade: 0, rim: false });
  for (const s of [-1, 1]) paint(frame, ellipse(0.4, s * 5, 1.6, 1.1), GOLD);
  frame.anchor("muzzle", CX, 0);
}

export const ATLAS = {
  key: "wpnWarRing",
  sheets: weaponSheets("wpnWarRing", draw, { size: 64 }),
  meta: { offGrip: null, stance: { grip: "one", body: "aim", restDeg: 0, restHand: [8, 4], swayDeg: 1, parry: { hand: [9, -3], deg: -20, contact: 22 } } },
};
