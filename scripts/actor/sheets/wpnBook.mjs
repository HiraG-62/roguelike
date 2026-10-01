// 書: 開いた魔導書。胸の前で見開きを開いて持ち、攻撃では照準へ突き出す（構えの braced。docs/ideas/tome-rework.md 1 章）。
// 斜め上から見た浅い V 字の 2 頁: 牛血色の表紙の縁が見開きを囲み、4 隅に金の角、下の縁に頁の束の厚み、
// 頁の中央（綴じ目の上）に淡い紫の印。原点（手のひら）は背の下端の中央で、拳が本の下縁に重なり下から支える。
// 本は回さず常に頁を見せるので向き 1（rigWeapon は dirs 1 なら向き 0 を描き、左向きは組み立てた絵ごと反転する）。
// 小さい見開きは形の関数で塗ると綴じ目と頁の線が潰れるので、1 ドットずつ模様（stamp）で置く。
// 振りの間（wpnBook.swing）は頁が浮き上がり、中央の印が明るく光る。頁から出る文字の刃はエフェクト（fx レーン）が描く
import { stamp } from "../paint.mjs";
import { GOLD } from "../weapon.mjs";

/** 表紙の革（牛血色。暗・基・明・艶） */
const COVER = ["#34121c", "#5a1e2c", "#80303c", "#a44c52"];
/** 頁（生成り） */
const PAGES = ["#6e6250", "#b8a888", "#ddd0b0", "#f4ecd6"];
/** 印（術の識別色の淡い紫） */
const GEM = ["#3a2466", "#6a48b0", "#a88ae8", "#ece0ff"];

/** 模様の文字 → 色（a〜d 表紙、p〜s 頁、g〜j 金、m〜o・w 印） */
const INK = {
  a: COVER[0], b: COVER[1], c: COVER[2], d: COVER[3],
  p: PAGES[0], q: PAGES[1], r: PAGES[2], s: PAGES[3],
  g: GOLD[0], h: GOLD[1], i: GOLD[2], j: GOLD[3],
  m: GEM[0], n: GEM[1], o: GEM[2], w: GEM[3],
};

/** 見開きの左端（正準座標）。幅 16 の真ん中（綴じ目の境）が原点の x、最下段が原点のすぐ上 */
const LEFT = -8;

/** 待機の見開き（幅 16 × 高さ 10。輪郭を足して 18 × 12） */
const HELD = [
  "icc..........cci",
  "cssccc....cccssb",
  "crrssscbbcsssrrb",
  "crqqqrrqsrrqqqrb",
  "crrrrrrornrrrrrb",
  "cqqqrrowonrrqqqb",
  "crrrrrrnmrrrrrrb",
  "cqqqrrrqsrrrqqqb",
  "ibbbqqqpqqqqbbbh",
  "....bbbaabbb....",
];

/** 振りの間: 頁が浮き上がって反り、印が明るく光る（綴じ目から光が立ち、2 枚の頁が舞い上がる） */
const SWING = [
  "..ss...........w",
  ".srrq.....ss....",
  "..qq.....srrq...",
  "...........q....",
  "icc....oo....cci",
  "csscccowwocccssb",
  "crrsssowwosssrrb",
  "crqqqowwwwoqqqrb",
  "crrrrowwwwnrrrrb",
  "cqqqrronnnrrqqqb",
  "crrrrrrnmrrrrrrb",
  "cqqqrrrqsrrrqqqb",
  "ibbbqqqpqqqqbbbh",
  "....bbbaabbb....",
];

/** 模様の行を原点の上へ置く */
function drawRows(rows) {
  return (frame) => {
    stamp(frame, LEFT, -rows.length, rows, INK);
    // 頁から出る弾（頁飛ばし）の出る所: 中央の印
    frame.anchor("muzzle", 0, -5);
  };
}

/** 作業面の一辺（ドット） */
const SHEET_SIZE = 32;

/** 向き 1 の手に持つ絵（回さず、光は絵に固定） */
function bookSheet(key, rows) {
  const half = SHEET_SIZE / 2;
  return { key, frames: 1, dirs: 1, w: SHEET_SIZE, h: SHEET_SIZE, ox: half, oy: half, localLight: true, draw: drawRows(rows) };
}

export const ATLAS = {
  key: "wpnBook",
  sheets: [
    bookSheet("wpnBook.held", HELD),
    // 振りの間だけ使う絵（実行時の renderer.ts が `<武器>.swing` があれば振りの間に替える）
    bookSheet("wpnBook.swing", SWING),
  ],
  meta: { offGrip: null, stance: { grip: "one", body: "light", restDeg: 0, restHand: [6, 5], swayDeg: 2, braced: true } },
};
