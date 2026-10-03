// 手鈴（神楽鈴）: 朱塗りの柄に金の口金、芯の棒に金の小鈴を 3 段（下ほど広い 5・4・3 個）と頂の鈴 1 つ。
// 柄尻から五色の布（緑・黄・赤・白）が後ろへなびく。振りの鈴の音の輪はエフェクト（fx レーン）が描く。
// 外縁は近接の当たり判定（data/meleeReach.test.ts）に揃え、握りから頂の鈴まで 33 ドット（論理 16.5px）
import { capsule, ellipse, paint, px } from "../paint.mjs";
import { GOLD, grip, pommel, weaponSheets } from "../weapon.mjs";

/** 朱塗りの柄 */
const LACQUER = ["#3c1219", "#6e1f28", "#9c3036", "#c65446"];
/** 柄巻きの白い布 */
const WRAP = ["#6e6a78", "#b8b4c0", "#dedae4", "#f6f4fa"];
/** 五色の布（柄尻から後ろへ。緑・黄・赤・白） */
const STREAMERS = [
  ["#1c3a24", "#2e6a3a", "#4a9a52", "#7cc47a"],
  ["#5a4a18", "#a88a28", "#dcbc48", "#f4e08a"],
  ["#4a1820", "#8a2830", "#c0403c", "#e0705c"],
  ["#6e6a78", "#b8b4c0", "#dedae4", "#f6f4fa"],
];
/** 鈴の段（芯の上の x と、並べる鈴の y） */
const TIERS = [
  { x: 16.5, ys: [-7.2, -3.6, 0, 3.6, 7.2] },
  { x: 22.5, ys: [-5.4, -1.8, 1.8, 5.4] },
  { x: 28, ys: [-3.6, 0, 3.6] },
];
const BELL_R = 1.9;
/** 頂の鈴 */
const TOP_X = 31.8;
const TOP_R = 2;

function bell(frame, x, y, r) {
  paint(frame, ellipse(x, y, r, r), GOLD);
  // 鈴の口（下の割れ目）: 暗い 1 ドット
  px(frame, x + r * 0.35, y + r * 0.4, GOLD[0]);
}

function draw(frame) {
  // 五色の布（柄尻から後ろへ扇に開き、ゆるく波打つ。奥の白から手前の緑へ重ねる）
  [...STREAMERS].reverse().forEach((mat, j) => {
    const i = STREAMERS.length - 1 - j;
    const s = (i - 1.5) * 1.6;
    const a = { x: -6, y: s * 0.35 };
    const b = { x: -11, y: s * 1.2 + 0.9 };
    const c = { x: -17 + Math.abs(s) * 0.6, y: s * 1.9 - 0.3 };
    paint(frame, capsule(a.x, a.y, b.x, b.y, 1.2, 1.1), mat, { maxShade: 2, bias: 0.1 });
    paint(frame, capsule(b.x, b.y, c.x, c.y, 1.1, 0.8), mat, { maxShade: 2, bias: 0.1 });
  });
  // 芯の棒と、段ごとの鈴を吊る金の輪（横から見て縦の線）
  paint(frame, capsule(11, 0, TOP_X - 1, 0, 0.8), GOLD, { bias: 0.1 });
  for (const t of TIERS) {
    const top = t.ys[0] ?? 0;
    const bot = t.ys[t.ys.length - 1] ?? 0;
    paint(frame, capsule(t.x - 1.6, top, t.x - 1.6, bot, 0.6), GOLD, { maxShade: 1, rim: false });
  }
  // 鈴（下の段から）
  for (const t of TIERS) for (const y of t.ys) bell(frame, t.x, y, BELL_R);
  bell(frame, TOP_X, 0, TOP_R);
  // 柄: 朱塗りに白布の巻き、金の口金と柄頭
  paint(frame, capsule(-4.5, 0, 10.5, 0, 1.6, 1.8), LACQUER);
  grip(frame, -3, 5, 1.9, WRAP, 2);
  paint(frame, capsule(9.5, 0, 11.6, 0, 2.4, 2.1), GOLD);
  pommel(frame, -5.6, 2.1, GOLD);
}

export const ATLAS = {
  key: "wpnHandbell",
  sheets: weaponSheets("wpnHandbell", draw, { size: 80 }),
  meta: { offGrip: null, stance: { grip: "one", body: "ready", restDeg: -68, restHand: [6, 5], swayDeg: 5, parry: { hand: [10, -1], deg: -50, off: [11, 3], contact: 12, barrier: "#ffe08a" } } },
};
