// チェーンアレイ: 帯金を巻いた太い木の柄の先から短い鎖が垂れ、先に黒鉄のトゲ付き鉄球（金の帯と鋼のトゲ）。
// 振りの鉄球の軌跡はエフェクト（scripts/fx/sheets/flail.mjs）が描く。手の絵は鎖を短くして、回しても鉄球が手から離れすぎない
import { capsule, ellipse, paint, polygon, subtract } from "../paint.mjs";
import { CLOTH_RED, DARK_STEEL, GOLD, STEEL, WOOD, grip, pommel, shaft, weaponSheets } from "../weapon.mjs";

/** 鎖の輪の間隔（ドット） */
const LINK_STEP = 3.2;
/** 鉄球の中心と半径、トゲの数と長さ */
const BALL_X = 34;
const BALL_R = 6.8;
const SPIKES = 8;
const SPIKE_LEN = 3.8;

/** 傾けた楕円（中心 cx, cy、半径 rx, ry、傾き a） */
function rotEllipse(cx, cy, rx, ry, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e = ellipse(0, 0, rx, ry);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = e(dx * c + dy * s, -dx * s + dy * c);
    if (!r) return null;
    return { nx: r.nx * c - r.ny * s, ny: r.nx * s + r.ny * c, nz: r.nz };
  };
}

/** a → b の直線の鎖。正面を向いた輪（穴あき）と横を向いた輪（細い棒）を交互に並べる */
function chain(frame, ax, ay, bx, by) {
  const len = Math.hypot(bx - ax, by - ay);
  const a = Math.atan2(by - ay, bx - ax);
  let n = 0;
  for (let s = LINK_STEP / 2; s < len; s += LINK_STEP, n++) {
    const x = ax + Math.cos(a) * s;
    const y = ay + Math.sin(a) * s;
    if (n % 2 === 0) {
      paint(frame, subtract(rotEllipse(x, y, 2.6, 2, a), rotEllipse(x, y, 1.2, 0.75, a)), STEEL, { bias: -0.05 });
    } else {
      const dx = Math.cos(a) * 1.7;
      const dy = Math.sin(a) * 1.7;
      paint(frame, capsule(x - dx, y - dy, x + dx, y + dy, 0.95), DARK_STEEL, { bias: 0.2 });
    }
  }
}

/** トゲ（鉄球の中心から角 ang の向きに、根元の幅 w の三角） */
function spike(frame, ang, w) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const r0 = BALL_R - 1;
  const r1 = BALL_R + SPIKE_LEN;
  const pts = [
    [BALL_X + c * r0 - s * w, s * r0 + c * w],
    [BALL_X + c * r1, s * r1],
    [BALL_X + c * r0 + s * w, s * r0 - c * w],
  ];
  paint(frame, polygon(pts, { round: 0.9, tilt: { nx: c * 0.5, ny: s * 0.5 } }), STEEL);
}

function draw(frame) {
  // 鎖（柄の先の環から鉄球へ）
  chain(frame, 12.8, 0, BALL_X - BALL_R + 0.5, 0);
  // トゲ（奥の半分 → 鉄球 → 手前の半分。鉄球の縁から突き出す）
  for (let i = 0; i < SPIKES; i++) spike(frame, (i / SPIKES) * Math.PI * 2 + Math.PI / SPIKES, 1.7);
  paint(frame, ellipse(BALL_X, 0, BALL_R, BALL_R), DARK_STEEL);
  // 鉄球の金の帯（赤道）と鋲
  paint(frame, (x, y) => {
    const r = ellipse(BALL_X, 0, BALL_R, BALL_R)(x, y);
    if (!r) return null;
    return Math.abs(x - BALL_X + y * 0.35) < 1.1 ? r : null;
  }, GOLD, { rim: false });
  for (const [dx, dy] of [[-3.6, -3.2], [3.4, 3.4], [-3, 3.6], [3.8, -2.8]]) {
    paint(frame, ellipse(BALL_X + dx, dy, 0.9, 0.9), STEEL, { rim: false, bias: 0.2 });
  }
  // 手前のトゲ（正面を向いたトゲの頭）
  paint(frame, ellipse(BALL_X - 1.6, -1.4, 1.3, 1.3), STEEL, { bias: 0.3 });
  // 柄の先の環（鎖の付け根）
  paint(frame, subtract(ellipse(12.2, 0, 2.2, 2.2), ellipse(12.2, 0, 0.9, 0.9)), DARK_STEEL);
  // 柄: 太い木に黒鉄の帯金、赤い革の握り、金の柄頭と口金
  shaft(frame, -4, 10, 1.9, WOOD, [6.8]);
  grip(frame, -3, 5, 2, CLOTH_RED);
  pommel(frame, -5.6, 2.5, GOLD);
  paint(frame, capsule(9, 0, 10.6, 0, 2.5, 2.2), GOLD);
}

export const ATLAS = {
  key: "wpnFlail",
  sheets: weaponSheets("wpnFlail", draw, { size: 96 }),
  meta: { offGrip: null, stance: { grip: "one", body: "heavy", restDeg: 35, restHand: [7, 6], swayDeg: 4, parry: { hand: [9, 2], deg: -72, off: [10, 3], contact: 10 } } },
};
