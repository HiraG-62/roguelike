// 書: 開いた魔導書。頁を顔へ向けて胸の前で開いて持ち（読んでいる姿）、外からは表紙の側が見える。
// 左の術の段は本を持ったまま後ろの手を突き出して放ち（playerRig の castOff）、右の段は本を照準へ突き出す（構えの braced）。
// 外から見た見開き: 牛血色の表紙 2 枚が背（金の帯 2 本）で折れて浅い V に開き、上に頁の天（生成りの小口）が扇に覗く。
// 背がいちばん手前なので上下の縁は真ん中ほど下がる。光の当たる左の表紙に淡い紫の印、4 隅に金の角。
// 原点（手のひら）は背の下端で、拳が背の下に重なり下から支える。
// 本は回さず常に同じ面を見せるので向き 1（rigWeapon は dirs 1 なら向き 0 を描き、左向きは組み立てた絵ごと反転する）。
// 小さい本は形の関数で塗ると背と頁の線が潰れるので、1 ドットずつ模様（stamp）で置く。
// 振りの間（wpnBook.swing）は頁の間と表紙の縁から光が漏れ、印が明るく光る。文字の弾・刃はエフェクト（fx レーン）が描く
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

/** 本の左端（正準座標）。幅 16 の真ん中（背の 2 ドットの境）が原点の x、最下段（背の下端）が原点のすぐ上 */
const LEFT = -8;
/** 頁の間の光（術の出る所）: 背の上、頁の天が谷になる所（原点から上へ） */
const MUZZLE_Y = -9;

/**
 * 待機: 外から見た開いた本（幅 16 × 高さ 10。輪郭を足して 18 × 12）。上 2〜3 行が頁の天（左は明るい s・r、右は陰の r・q）、
 * その下が表紙（左 c・d、右 b・a）。背は x7（明）/ x8（暗）で金の帯 2 本。背が手前なので上下の縁は真ん中が 1 段下がる
 */
const HELD = [
  "ssss........rrrr",
  "rrrrssssrrrrqqqq",
  "idddrrrrqqqqccch",
  "dcccddddacccbbba",
  "dccccccihbbbbbba",
  "dccocccdabbbbbba",
  "dcnwnccdabbbbbba",
  "dccmcccdabbbbbba",
  "gbbbcccihbbbaaag",
  "....bbbcaaaa....",
];

/** 振りの間: 頁の間と表紙の縁から術の光が漏れ、印が明るく光る（上に光の粒） */
const SWING = [
  "....w.......o...",
  ".o.....w........",
  ".......o..w.....",
  "wwww........oooo",
  "oooowwwwwwwwnnnn",
  "idddooowwoooccch",
  "occcddddacccbbbn",
  "occccccihbbbbbbn",
  "occwcccdabbbbbbn",
  "ocowoccdabbbbbbn",
  "occocccdabbbbbbn",
  "gbbbcccihbbbaaag",
  "....bbbcaaaa....",
];

/** 模様の行を原点の上へ置く */
function drawRows(rows) {
  return (frame) => {
    stamp(frame, LEFT, -rows.length, rows, INK);
    // 術の弾（頁飛ばしの頁）の出る所: 頁の間（背の上の谷）
    frame.anchor("muzzle", 0, MUZZLE_Y);
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
  meta: { offGrip: null, stance: { grip: "one", body: "light", restDeg: 0, restHand: [-3, 9], swayDeg: 2, braced: true, parry: { hand: [10, 3], deg: -35, off: [11, 4], contact: 9, barrier: "#7fd4ff" } } },
};
