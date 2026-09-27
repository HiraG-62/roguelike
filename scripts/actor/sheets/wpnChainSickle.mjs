// 鎖鎌: 木の柄の先に直角に付いた鋭い鎌（内側へ反る刃、黒鉄の峰と鋼の刃）。柄の尻の環から短い鎖が垂れ、先に分銅。
// 鎖の長い伸びはエフェクト（scripts/fx/sheets/chainSickle.mjs）が描くので、手の絵は鎖を短く垂らして回しても不自然にしない
import { capsule, ellipse, paint, polygon, subtract } from "../paint.mjs";
import { DARK_STEEL, GOLD, STEEL, WOOD, grip, shaft, weaponSheets } from "../weapon.mjs";

/** 鎖の輪の間隔（ドット） */
const LINK_STEP = 3.1;
/** 分銅の緒（紫紺の紐。鎌の鋼と木の茶に対する差し色） */
const CORD = ["#1e1830", "#3a2c58", "#584480", "#7a66a6"];

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

/** 折れ線 pts に沿った鎖。正面を向いた輪（穴あき）と横を向いた輪（細い棒）を交互に並べる */
function chain(frame, pts) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    segs.push({ ax, ay, bx, by, len, from: total });
    total += len;
  }
  let n = 0;
  for (let s = LINK_STEP / 2; s < total; s += LINK_STEP, n++) {
    const seg = segs.find((g) => s <= g.from + g.len) ?? segs[segs.length - 1];
    const t = (s - seg.from) / seg.len;
    const x = seg.ax + (seg.bx - seg.ax) * t;
    const y = seg.ay + (seg.by - seg.ay) * t;
    const a = Math.atan2(seg.by - seg.ay, seg.bx - seg.ax);
    if (n % 2 === 0) {
      paint(frame, subtract(rotEllipse(x, y, 2.4, 1.8, a), rotEllipse(x, y, 1.1, 0.7, a)), STEEL, { bias: -0.05 });
    } else {
      const dx = Math.cos(a) * 1.5;
      const dy = Math.sin(a) * 1.5;
      paint(frame, capsule(x - dx, y - dy, x + dx, y + dy, 0.85), DARK_STEEL, { bias: 0.2 });
    }
  }
}

function draw(frame) {
  // 鎖と分銅（柄の尻から下へ垂れる。柄より奥に描く）
  chain(frame, [[-7, 0], [-11, 1.6], [-15, 5]]);
  paint(frame, polygon([[-14.4, 3.4], [-17.4, 2.6], [-21, 6], [-20.2, 10], [-16.6, 10.8], [-14, 7.6]], { round: 1.6 }), DARK_STEEL);
  paint(frame, capsule(-15.6, 4.6, -18.4, 8.8, 1), GOLD, { rim: false });
  // 柄の尻の環
  paint(frame, subtract(ellipse(-5.4, 0, 2.3, 2.3), ellipse(-5.4, 0, 0.9, 0.9)), DARK_STEEL);
  // 柄: 木の芯、手元に紫紺の緒を巻き、黒鉄の輪
  shaft(frame, -4, 11, 1.6, WOOD, [-3.2]);
  grip(frame, -1.5, 4.5, 1.75, CORD);
  // 刃: 柄の先から直角に立ち、手元の側（-x）へ反って鋭い切っ先。外側（+x）が黒鉄の峰、内側が鋼の刃
  const outer = [
    [14.6, -1.6],
    [16.6, -5.4],
    [16.8, -10.4],
    [15, -15.4],
    [11.6, -19.4],
    [6.6, -22.2],
    [1.6, -23],
  ];
  const inner = [
    [5.8, -20.4],
    [9.4, -17],
    [11.2, -12.4],
    [11.8, -7.4],
    [11.4, -2.4],
  ];
  paint(frame, polygon([[10.2, -1.2], ...outer, ...inner], { round: 1.4, tilt: { nx: -0.15, ny: -0.1 } }), STEEL);
  // 峰の帯（外の縁に沿って 2 ドット幅）
  const spineIn = outer.map(([x, y]) => [x - 2.1 * Math.sign(x - 8) * (Math.abs(y) < 16 ? 1 : 0.5), y + (Math.abs(y) >= 16 ? 1.6 : 0)]);
  paint(frame, polygon([...outer.slice(0, 6), ...spineIn.slice(0, 6).reverse()]), DARK_STEEL, { rim: false, maxShade: 1 });
  // 刃の付け根の口金（金の帯）と目釘
  paint(frame, polygon([[9.2, -3], [14.6, -3.4], [15.2, 2.6], [9.2, 2.6]], { round: 1.2 }), GOLD);
  paint(frame, ellipse(12.2, -0.3, 1, 1), DARK_STEEL, { rim: false });
}

export const ATLAS = {
  key: "wpnChainSickle",
  sheets: weaponSheets("wpnChainSickle", draw, { size: 64, edge: true }),
  meta: { offGrip: null, stance: { grip: "one", body: "ready", restDeg: -65, restHand: [7, 7], restMirror: true, swayDeg: 3 } },
};
