/**
 * タイトル画面（案 A「門」。render/titleUi.ts）だけで使う絵: 旅人の背中（笠と藍の外套、16x24、密度 1）と炎。
 * atlas を通さず titleUi が 1 ドットずつ塗る（SPRITES に登録しない）。色は文字 → 色の表で当てる。
 */

/** 旅人の背中。待機は 0、歩きは脚の行を差し替えた 1・2 */
export const TRAVELER_BACK: readonly string[] = [
  "......kkkk......",
  "....kkyyyykk....",
  "..kkyyyyyyyykk..",
  ".kyyyyyyyyyyyyk.",
  "kyyyyYyyyyyYyyyk",
  "kYYYYYYYYYYYYYYk",
  ".kkkkkkkkkkkkkk.",
  ".....knnnnk..g..",
  "....krrrrrrkkgk.",
  "...klrrRRrrRcsk.",
  "..klcrrrrrrcCsk.",
  "..klccccccccCsk.",
  "..klcccccccCCsk.",
  "..klcccccccCCsk.",
  "..klccccccCCCk..",
  "..klcccccCCCCk..",
  "...kccccCCCCk...",
  "...klcccCCCCk...",
  "...kkcccCCCkk...",
  "....kpppppppk...",
  "....kppk.kppk...",
  "....kppk.kppk...",
  "....kffk.kffk...",
  "....kkkk.kkkk...",
];

export const TRAVELER_PALETTE: Readonly<Record<string, string>> = {
  k: "#14121a",
  y: "#c8a050",
  Y: "#8a6a30",
  n: "#a07050",
  r: "#c83a2a",
  R: "#8a2018",
  c: "#34405a",
  C: "#222a3e",
  l: "#4e5c7a",
  s: "#2a2026",
  g: "#e0c070",
  p: "#2a2630",
  f: "#1a1612",
};

/** 脚の行（下 4 行）の歩きの 2 枚。添字 0 = 左足を出す、1 = 右足を出す */
export const TRAVELER_STEP_LEGS: readonly (readonly [string, string, string, string])[] = [
  ["....kppk..kpk...", "....kppk..kpk...", "....kffk..kfk...", "....kkkk..kk...."],
  ["...kpk..kppk....", "...kpk..kppk....", "...kfk..kffk....", "...kk...kkkk...."],
];

/** 脚の行が始まる行 */
export const TRAVELER_LEGS_ROW = 20;

/** 炎（5x5）。ゆらぎは titleUi が 3 コマで回す */
export const FLAME_ROWS: readonly string[] = ["..y..", ".yYy.", ".YwY.", "yYwYy", ".yYy."];

export const FLAME_PALETTE: Readonly<Record<string, string>> = { y: "#c83a2a", Y: "#ff9a3a", w: "#fff0b0" };
