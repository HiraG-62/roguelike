// チャクラム（両手に 1 枚ずつ）: 握りを巻いた鋼の刃の輪。外周の前半分に炎の形の刃を 5 本立て、握りの両脇に短い鍔の棘。
// 輪の内側に黒鉄の帯と金の鋲、握りは青緑の布巻き（双剣の赤と見分ける）
import { capsule, ellipse, paint, polygon, subtract } from "../paint.mjs";
import { DARK_STEEL, GOLD, STEEL, weaponSheets } from "../weapon.mjs";

/** 輪の中心・外径・内径（握りは輪の手前の縁） */
const CX = 11;
const R_OUT = 10.5;
const R_IN = 7;
/** 黒鉄の内帯の外径 */
const R_BAND = 8.6;
const DEG = Math.PI / 180;
/** 刃の生える角（輪の中心から、+x = 0）と長さ */
const SPIKES = [-100, -50, 0, 50, 100];
const SPIKE_LEN = 5.5;
/** 握りの布（暗・基・明・艶） */
const CLOTH_TEAL = ["#15282e", "#1f4a52", "#2f6f73", "#4f9a92"];

function ring(ro, ri) {
  return subtract(ellipse(CX, 0, ro, ro), ellipse(CX, 0, ri, ri));
}

/** 輪の外周から外へ前（時計回り）へ反る炎の形の刃 */
function spike(deg) {
  const a = deg * DEG;
  const t = [Math.cos(a), Math.sin(a)];
  const n = [-Math.sin(a), Math.cos(a)];
  const P = (r, s) => [CX + t[0] * r + n[0] * s, t[1] * r + n[1] * s];
  return polygon([P(R_OUT - 1.5, -3.6), P(R_OUT + 1.5, -2.6), P(R_OUT + SPIKE_LEN, 1.8), P(R_OUT + 1.2, 1.8), P(R_OUT - 1.5, 2.4)], {
    round: 1.2,
  });
}

function draw(frame) {
  // 外周の刃
  for (const d of SPIKES) paint(frame, spike(d), STEEL, { bias: 0.1 });
  // 輪: 外の刃の面（鋼）と内の黒鉄の帯
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x - CX, y);
      if (r > R_OUT || r < R_BAND) return null;
      const k = (r - (R_OUT + R_BAND) / 2) / ((R_OUT - R_BAND) / 2);
      return { nx: ((x - CX) / r) * k * 0.7, ny: (y / r) * k * 0.7 };
    },
    STEEL,
  );
  paint(frame, ring(R_BAND, R_IN), DARK_STEEL, { maxShade: 2 });
  // 内帯の金の鋲（刃の根元ごと）
  for (const d of SPIKES) {
    const a = d * DEG;
    paint(frame, ellipse(CX + Math.cos(a) * 7.8, Math.sin(a) * 7.8, 0.85, 0.85), GOLD, { rim: false });
  }
  // 握りの両脇の短い鍔の棘（手を守る）
  for (const s of [-1, 1]) {
    paint(frame, polygon([[2.5, s * 5.5], [5, s * 7], [3, s * 10.5], [1, s * 7.5]], { round: 1 }), DARK_STEEL);
  }
  // 握り（輪の手前の縁を布で巻く）と金の口金
  paint(frame, capsule(0.5, -4.5, 0.5, 4.5, 2), CLOTH_TEAL);
  for (let y = -3.5; y <= 3.5; y += 2) paint(frame, capsule(-1.3, y, 2.3, y + 0.6, 0.35), CLOTH_TEAL, { minShade: 0, maxShade: 0, rim: false });
  for (const s of [-1, 1]) paint(frame, capsule(-0.3, s * 5.3, 1.8, s * 5.3, 1.1), GOLD);
  // 戦輪は左で輪を投げる（投擲物）。投げた輪は輪の中心から出る
  frame.anchor("muzzle", CX, 0);
}

export const ATLAS = {
  key: "wpnRingBlades",
  sheets: weaponSheets("wpnRingBlades", draw, { size: 64 }),
  meta: { offGrip: null, stance: { grip: "dual", body: "light", restDeg: -15, restHand: [7, 8], offHand: [-3, 9], offDeg: 160, swayDeg: 4, parry: { hand: [9, 2], deg: -25, off: [10, 5], offDeg: 25, contact: 20 } } },
};
