/**
 * 手に持つ武器（docs/ideas/combat-feel-design.md C-1）と、当たり判定の形ごとの斬撃（C-3）。
 *
 * 武器: `weapon.<MovesetKey>` は 12x12 の 3 フレーム [横（右向き）, 斜め（右上向き）, 縦（上向き）]（片刃は 4 フレーム、下記）。
 * 拳（肌の 2x2）ごと描き、描画側は拳の中心（WEAPON_GRIPS）を手の位置に合わせて置く。
 * 8 方向は 3 枚と左右・上下の反転で作る（回転で描かない。renderMath.ts の weaponPose が選ぶ）。
 * 縦は横を 90 度回した絵（画素を並べ替えるだけなので崩れない）。光源は左上なので、横の上辺の明部は縦の左辺に来る。
 * 片刃・片頭の武器（WEAPON_EDGE）は 4 枚目 [斜め・刃が右下] を持つ。斜めの絵は反転では柄を保ったまま刃の側だけ
 * 入れ替えられないので、柄の線（反対角線）で写して作る（docs/ideas/weapon-redesign.md 7 章）
 */
import type { SpriteFrames } from "../sprites";
import type { MovesetKey } from "../weapons";
import type { Frame } from "./frameKit";

/** 武器スプライトの一辺 */
export const WEAPON_CANVAS = 12;

/** 武器のフレーム番号（横・斜め・縦・斜めで刃が右下）。diagonalOut は WEAPON_EDGE の武器だけが持つ */
export const WEAPON_FRAME = { side: 0, diagonal: 1, up: 2, diagonalOut: 3 } as const;
export type WeaponFrame = (typeof WEAPON_FRAME)[keyof typeof WEAPON_FRAME];

/** 拳の中心（画素の境目の座標。2x2 の肌の真ん中）。反転したら x → 12 - x / y → 12 - y */
export const WEAPON_GRIPS: Readonly<Record<WeaponFrame, { readonly x: number; readonly y: number }>> = {
  0: { x: 2, y: 7 },
  1: { x: 2, y: 10 },
  2: { x: 7, y: 10 },
  // 反対角線で写しても (2,10) は線の上にあるので動かない
  3: { x: 2, y: 10 },
};

/** 刃の側 */
export type WeaponEdge = "up" | "down";

/**
 * 片刃・片頭の武器が、横の絵（右向き）で刃・頭を持つ側。描画側（renderMath.ts の edgeView）はこれを見て
 * 構えでは刃を頭と反対側へ、振りでは振り抜く方向へ向ける。両刃・柄だけ・銃は載せない。
 * 刀は片刃だが絵が細く刃の側を見分けられないので外す。鉈は刃の幅が柄の上へ張り出しているので up
 */
export const WEAPON_EDGE: Readonly<Partial<Record<MovesetKey, WeaponEdge>>> = {
  scythe: "up",
  axe: "up",
  hammer: "up",
  chainSickle: "up",
  cleaver: "up",
  fan: "up",
};

export function weaponSpriteKey(moveset: MovesetKey): string {
  return `weapon.${moveset}`;
}

/** 右向きの絵を 90 度左へ回して上向きにする（new[y][x] = old[x][W-1-y]） */
function rotateUp(frame: Frame): Frame {
  const w = frame[0]?.length ?? 0;
  const out: string[] = [];
  for (let y = 0; y < w; y++) {
    let row = "";
    for (let x = 0; x < frame.length; x++) row += frame[x]?.[w - 1 - y] ?? ".";
    out.push(row);
  }
  return out;
}

/** 柄の線（拳 (2,10) を通る右上がりの反対角線）で写す（new[y][x] = old[W-1-x][W-1-y]）。刃の側だけが入れ替わる */
export function mirrorAntiDiagonal(frame: Frame): Frame {
  const w = frame.length;
  const out: string[] = [];
  for (let y = 0; y < w; y++) {
    let row = "";
    for (let x = 0; x < w; x++) row += frame[w - 1 - x]?.[w - 1 - y] ?? ".";
    out.push(row);
  }
  return out;
}

/** 写すと光が右下から当たるので、明暗の対を入れ替えて左上の光に戻す（金属・木・柄） */
const SHADE_SWAP: Readonly<Record<string, string>> = { "1": "S", S: "1", W: "w", w: "W", U: "X", X: "U" };
const SKIN = new Set(["t", "T"]);
const HOLLOW = new Set([".", "k"]);

/** 塊の中の画素か（1 画素だけの鎖の輪などは明暗を入れ替えない） */
function inMass(frame: Frame, x: number, y: number): boolean {
  const near = [frame[y]?.[x + 1], frame[y]?.[x - 1], frame[y + 1]?.[x], frame[y - 1]?.[x]];
  return near.some((c) => c !== undefined && !HOLLOW.has(c));
}

/** 斜めの絵から「刃が右下」の絵を作る。拳は上の段を明（t）、下の段を暗（T）に塗り直す */
function diagonalOutOf(diagonal: Frame): Frame {
  const mirrored = mirrorAntiDiagonal(diagonal);
  return mirrored.map((row, y) =>
    [...row]
      .map((c, x) => {
        if (SKIN.has(c)) return SKIN.has(mirrored[y - 1]?.[x] ?? ".") ? "T" : "t";
        const swapped = SHADE_SWAP[c];
        return swapped && inMass(mirrored, x, y) ? swapped : c;
      })
      .join(""),
  );
}

function held(side: Frame, diagonal: Frame, up: Frame = rotateUp(side)): SpriteFrames {
  return [side, diagonal, up];
}

/** 片刃の武器: 4 枚目に刃が右下の斜めを足す（手描きがあれば out に渡す） */
function edged(side: Frame, diagonal: Frame, out: Frame = diagonalOutOf(diagonal)): SpriteFrames {
  return [side, diagonal, rotateUp(side), out];
}

// ---- 剣: 中くらいの刃と金の鍔 ----
const SWORD_SIDE: Frame = [
  "............",
  "............",
  "............",
  "............",
  "...k........",
  ".kkYkkkkkk..",
  "kttY1sssssk.",
  "kTTYSSSSSk..",
  ".kkYkkkkk...",
  "...k........",
  "............",
  "............",
];
const SWORD_DIAG: Frame = [
  "............",
  ".........kk.",
  "........k1Sk",
  ".......k1Sk.",
  "......k1Sk..",
  "..k..k1Sk...",
  "..kYk1Sk....",
  "...kYSk.....",
  ".kkUkYk.....",
  "kttk........",
  "kTTk........",
  ".kk.........",
];

// ---- 大剣: 太く長い刃 ----
const GREATSWORD_SIDE: Frame = [
  "............",
  "............",
  "............",
  "...k........",
  "..kYkkkkkkk.",
  ".kkY1111111k",
  "kttYssssssss",
  "kTTYSSSSSSSk",
  ".kkYkkkkkkk.",
  "..kk........",
  "............",
  "............",
];
const GREATSWORD_DIAG: Frame = [
  ".........kkk",
  "........k11k",
  ".......k1ssk",
  "......k1ssSk",
  ".....k1ssSk.",
  "....k1ssSk..",
  ".kk.k1sSk...",
  ".kYYksSk....",
  ".kkUYYk.....",
  "kttkkYk.....",
  "kTTk.k......",
  ".kk.........",
];

// ---- 双剣: 拳から 2 本の短い刃が開く ----
const TWIN_SIDE: Frame = [
  "............",
  "............",
  "............",
  ".......kk...",
  ".....kk1Sk..",
  ".kkYk1sSk...",
  "kttYkkkk....",
  "kTTYkkkk....",
  ".kkYk1sSk...",
  ".....kk1Sk..",
  ".......kk...",
  "............",
];
const TWIN_DIAG: Frame = [
  "............",
  "......kk....",
  ".....k1k..kk",
  ".....k1Sk1Sk",
  ".....k1Sk1k.",
  ".....kSk1Sk.",
  "....kkkSSk..",
  "...kYYkkk...",
  ".kkUYk......",
  "kttkk.......",
  "kTTk........",
  ".kk.........",
];

// ---- 槍: 長い柄と木の葉形の穂 ----
const SPEAR_SIDE: Frame = [
  "............",
  "............",
  "............",
  "............",
  "........kk..",
  ".kkkkkkk11k.",
  "kttWWWWWk11k",
  "kTTwwwwwkSk.",
  ".kkkkkkkkk..",
  "............",
  "............",
  "............",
];
const SPEAR_DIAG: Frame = [
  "........kkkk",
  "........k11k",
  "........k1Sk",
  ".......kkSkk",
  "......kWkk..",
  ".....kWwk...",
  "....kWwk....",
  "...kWwk.....",
  ".kkWwk......",
  "kttwk.......",
  "kTTk........",
  ".kk.........",
];

// ---- 大鎌: 柄の先で内へ曲がる刃 ----
const SCYTHE_SIDE: Frame = [
  "............",
  "....kkkkk...",
  "...k11sssk..",
  "....kkkkSSk.",
  "........kSk.",
  ".kkkkkkkkSk.",
  "kttWWWWWWWWk",
  "kTTwwwwwwwk.",
  ".kkkkkkkkk..",
  "............",
  "............",
  "............",
];
const SCYTHE_DIAG: Frame = [
  "..kkkkk.....",
  ".k11sssk....",
  "..kkkkSSkkk.",
  "......kSWwk.",
  "......kWwk..",
  ".....kWwk...",
  "....kWwk....",
  "...kWwk.....",
  ".kkWwk......",
  "kttwk.......",
  "kTTk........",
  ".kk.........",
];

// ---- 拳: 鋲を打った手甲（拳そのものが武器） ----
const FISTS_SIDE: Frame = [
  "............",
  "............",
  "............",
  "............",
  ".kkkkk......",
  "k11ssyk.....",
  "k1sssSyk....",
  "kssSSSyk....",
  "kSSSSyk.....",
  ".kkkkk......",
  "............",
  "............",
];
const FISTS_DIAG: Frame = [
  "............",
  "............",
  "............",
  "............",
  "............",
  "............",
  "..kkkk......",
  ".k11syk.....",
  "k1sssyk.....",
  "ksssSyk.....",
  "kSSSyk......",
  ".kkkk.......",
];

// ---- 鞭: 短い柄と巻いた縄 ----
const WHIP_SIDE: Frame = [
  "............",
  "............",
  "............",
  "......kkk...",
  ".....kWWwk..",
  ".kkkkWkkkWk.",
  "kttUUk...kWk",
  "kTTXXkk.kWk.",
  ".kkkkwWWwk..",
  "......kkk...",
  "............",
  "............",
];
const WHIP_DIAG: Frame = [
  "............",
  "......kkkk..",
  ".....kWWwwk.",
  "....kWk..kWk",
  "....kWk..kWk",
  "....kWk.kwk.",
  "...kUkwWwk..",
  "..kUXkkkk...",
  ".kkXk.......",
  "kttk........",
  "kTTk........",
  ".kk.........",
];

// ---- 鉈: 幅広の四角い刃 ----
const CLEAVER_SIDE: Frame = [
  "............",
  "............",
  "....kkkkkk..",
  "...k111sssk.",
  "...k1ssssSk.",
  ".kkk1ssssSk.",
  "kttUsssssSk.",
  "kTTXSSSSSSk.",
  ".kkkkkkkkkk.",
  "............",
  "............",
  "............",
];
// 横の絵と同じく、刃の幅は柄の線の左上へ張り出す（刃の向きの規則が効くように）
const CLEAVER_DIAG: Frame = [
  ".....kk.....",
  "....k11k....",
  "...k11ssk...",
  "..k11ssSSk..",
  ".k11ssSSk...",
  "k11ssSSk....",
  ".kssSSk.....",
  "..kSSk......",
  ".kkUXk......",
  "kttkk.......",
  "kTTk........",
  ".kk.........",
];

// ---- 棍: 両端に金具を巻いた長い棒 ----
const STAFF_SIDE: Frame = [
  "............",
  "............",
  "............",
  "............",
  "............",
  ".kkkkkkkkkk.",
  "kttUUUUUUyYk",
  "kTTXXXXXXYYk",
  ".kkkkkkkkkk.",
  "............",
  "............",
  "............",
];
const STAFF_DIAG: Frame = [
  "........kkk.",
  ".......kyYk.",
  "......kYYk..",
  ".....kUXk...",
  "....kUXk....",
  "...kUXk.....",
  "..kUXk......",
  "..kXk.......",
  ".kkk........",
  "kttk........",
  "kTTk........",
  ".kk.........",
];

// ---- 杖: 短い柄の先に青い珠 ----
const WAND_SIDE: Frame = [
  "............",
  "............",
  "............",
  "........kkk.",
  ".......kc11k",
  ".kkkkkkcc1ck",
  "kttUUUkcccCk",
  "kTTXXXkCcCCk",
  ".kkkkkkkCCk.",
  "........kk..",
  "............",
  "............",
];
const WAND_DIAG: Frame = [
  "........kkk.",
  ".......kc11k",
  "......kcc1ck",
  "......kcccCk",
  ".....kUkCCk.",
  "....kUXkkk..",
  "...kUXk.....",
  "..kUXk......",
  ".kkXk.......",
  "kttk........",
  "kTTk........",
  ".kk.........",
];

// ---- 刀: 細く反った長い刃と丸い鍔 ----
const KATANA_SIDE: Frame = [
  "............",
  "............",
  "............",
  "............",
  "...k......k.",
  ".kkYkkkkkk1k",
  "kttY1sssssk.",
  "kTTYkkkkkk..",
  ".kkk........",
  "............",
  "............",
  "............",
];
const KATANA_DIAG: Frame = [
  "..........kk",
  ".........k1k",
  "........k1k.",
  "........k1k.",
  ".......k1k..",
  "......k1k...",
  ".....k1k....",
  "..kkksk.....",
  ".kkYYk......",
  "kttkk.......",
  "kTTk........",
  ".kk.........",
];

// ---- 斧: 柄の先に片刃 ----
const AXE_SIDE: Frame = [
  "............",
  "......kkk...",
  ".....k11sk..",
  ".....k1ssSk.",
  "......kssSk.",
  ".kkkkkkksSk.",
  "kttUUUUUUUUk",
  "kTTXXXXXXXk.",
  ".kkkkkkkkk..",
  "............",
  "............",
  "............",
];
const AXE_DIAG: Frame = [
  "....kkk.....",
  "...k11sk....",
  "...k1ssSkkk.",
  "....kssSkUk.",
  ".....kkkUXk.",
  "......kUXk..",
  ".....kUXk...",
  "....kUXk....",
  ".kkkUXk.....",
  "kttkXk......",
  "kTTkk.......",
  ".kk.........",
];

// ---- 大盾: 正面の盾板と金の鋲 ----
const SHIELD_SIDE: Frame = [
  "...kkkkkk...",
  "..ks111sSk..",
  "..k1bbbbSk..",
  "..k1bbbbSk..",
  "..k1bYYbSk..",
  ".kk1byybSk..",
  "kttsbbYbSk..",
  "kTTsbbbBSk..",
  ".kksbbbBSk..",
  "..kSbbBBSk..",
  "...kSSSSk...",
  "....kkkk....",
];
const SHIELD_UP: Frame = [
  "..kkkkkkkk..",
  ".ks111111Sk.",
  ".k1bbbbbbSk.",
  ".k1bbYYbbSk.",
  ".k1bYyyYbSk.",
  ".k1bbYYbBSk.",
  ".ksbbbbBBSk.",
  "..kSbbBBSk..",
  "...kSSSSk...",
  ".....kttk...",
  ".....kTTk...",
  "......kk....",
];
const SHIELD_DIAG: Frame = [
  "......kkkk..",
  ".....ks11Sk.",
  "....ks1bbbSk",
  "...ks1bbbBSk",
  "...k1bYYbBSk",
  "..k1bbyybBSk",
  "..ksbbYbBSk.",
  "..ksbbbBSk..",
  ".kkSbbBSk...",
  "kttkSSSk....",
  "kTTkkkk.....",
  ".kk.........",
];

// ---- 鎖鎌: 小さな鎌と、鎖の先の分銅 ----
const CHAIN_SIDE: Frame = [
  "............",
  ".....kkk....",
  "....k11sk...",
  "....kkkSk...",
  "......kSk...",
  ".kkkkkkSk...",
  "kttUUUUk....",
  "kTTXXXkS....",
  ".kkkkk..S...",
  "........kkk.",
  "........kssk",
  "........kSSk",
];
const CHAIN_DIAG: Frame = [
  "...kkkk.....",
  "..k11ssk....",
  "...kkkSSk...",
  "......kSk...",
  ".....kUk....",
  "....kUXk....",
  "...kUXk.....",
  "..kUXk......",
  ".kkXk.S.....",
  "kttk...S.kk.",
  "kTTk....kssk",
  ".kk......kk.",
];

// ---- 戦鎚: 頭の大きい槌 ----
const HAMMER_SIDE: Frame = [
  "............",
  "......kkkkkk",
  "......k11ssk",
  "......k1sssk",
  "......k1sSSk",
  ".kkkkkkssSSk",
  "kttUUUUsssSk",
  "kTTXXXXsSSSk",
  ".kkkkkkSSSSk",
  "......kSSSSk",
  "......kkkkkk",
  "............",
];
const HAMMER_DIAG: Frame = [
  "....kkk.....",
  "...k11sk....",
  "..k1sssSk...",
  "..kssssSSk..",
  "...kssSSSkk.",
  "....kSSSkUk.",
  ".....kkUXk..",
  ".....kUXk...",
  ".kkkUXk.....",
  "kttkXk......",
  "kTTkk.......",
  ".kk.........",
];
// 写した絵は頭の暗部が広く、明暗を入れ替えるだけだと白が塊になるので手で塗り直す（形は写したまま）
const HAMMER_OUT: Frame = [
  "............",
  "......kk....",
  ".....kUkk...",
  "....kUk1sk..",
  "....UX1sssk.",
  "...kXk1sssSk",
  "..kUkksssSSk",
  ".kUX..kssSSk",
  ".kkk...kSSk.",
  "kttk....kk..",
  "kTTk........",
  ".kk.........",
];

// ---- 二丁拳銃: 1 挺の拳銃（描画側が左右の手に 1 挺ずつ置く） ----
const GUN_SIDE: Frame = [
  "............",
  "............",
  "............",
  ".kkkkkkkkk..",
  "kSs11sssSSk.",
  "kKKKKKKKKKk.",
  "kttkKk......",
  "kTTkk.......",
  ".kk.........",
  "............",
  "............",
  "............",
];
const GUN_DIAG: Frame = [
  "............",
  "............",
  ".........kk.",
  "........kSsk",
  ".......kSsKk",
  "......kSsKk.",
  ".....kSsKk..",
  "....kSsKk...",
  ".kkkKKKk....",
  "kttkkk......",
  "kTTk........",
  ".kk.........",
];

// ---- 長銃: 細く長い銃身と木の銃床 ----
const LONGARM_SIDE: Frame = [
  "............",
  "............",
  "............",
  "............",
  ".kkkkkkkkkkk",
  "kSs11ssssssk",
  "kttUUUUUkkkk",
  "kTTXXXXXk...",
  ".kkkkkkkk...",
  "............",
  "............",
  "............",
];
const LONGARM_DIAG: Frame = [
  "..........kk",
  ".........k1k",
  "........ksSk",
  ".......ksSk.",
  "......ksSk..",
  ".....ksSk...",
  "....kUXk....",
  "...kUXk.....",
  ".kkUXk......",
  "kttXk.......",
  "kTTk........",
  ".kk.........",
];

// ---- 砲: 太い筒と真鍮の口金 ----
const CANNON_SIDE: Frame = [
  "............",
  "............",
  "............",
  "..kkkkkkkkk.",
  ".k11sssssyYk",
  ".kssssssSyYk",
  "kttSSSSSSyYk",
  "kTTKKKKKKyYk",
  ".kkkkkkkkkk.",
  "............",
  "............",
  "............",
];
const CANNON_DIAG: Frame = [
  ".......kk...",
  "......kyyk..",
  ".....k1sYYk.",
  "....k1ssSYYk",
  "...k1ssSSKk.",
  "..k1ssSSKk..",
  ".k1ssSSKk...",
  ".kssSSKk....",
  ".kkSSKk.....",
  "kttkKk......",
  "kTTkk.......",
  ".kk.........",
];

// ---- 投擲: 指に掛けた円月輪（真ん中が抜けた輪） ----
const THROWN_SIDE: Frame = [
  "............",
  "............",
  ".....kkkk...",
  "....k11ssk..",
  "...k111sssk.",
  ".kk11kkkkSSk",
  "ktt11k..kSSk",
  "kTTsskkkkSSk",
  ".kkkssSSSSk.",
  "....kSSSSk..",
  ".....kkkk...",
  "............",
];
const THROWN_DIAG: Frame = [
  "............",
  "....kkkk....",
  "...k11ssk...",
  "..k111sssk..",
  ".k111kksSSk.",
  ".k11k..kSSk.",
  ".kssk..kSSk.",
  ".kssskkSSSk.",
  ".kksSSSSSk..",
  "kttkSSSSk...",
  "kTTkkkkk....",
  ".kk.........",
];

// ---- 擲弾: 砲より太く短い筒。口から丸い砲弾が覗く ----
const GRENADE_SIDE: Frame = [
  "............",
  "............",
  "..kkkkkkkk..",
  ".k11sssyYkk.",
  ".k1ssssyY1sk",
  ".kssssSyYsSk",
  "kttSSSSyYSKk",
  "kTTKKKKyYKKk",
  ".kKKKKKyYkk.",
  "..kkkkkkkk..",
  "............",
  "............",
];
const GRENADE_DIAG: Frame = [
  "............",
  "............",
  ".......kkk..",
  ".....kk1sSk.",
  "....kyYsSKk.",
  "...k1syYKk..",
  "..k1sssYYk..",
  ".k1sssSKk...",
  ".ksssSKk....",
  "kttsSKk.....",
  "kTTkkk......",
  ".kk.........",
];

// ---- 仕掛け: 箱型の筒。側面の窓と口に黄橙の設置弾が見える ----
const TRAPPER_SIDE: Frame = [
  "............",
  "............",
  ".kkkkkkkkkk.",
  ".k11ssssSyk.",
  ".k1kkkkkSyKk",
  ".kskqookSyok",
  "kttkoOOkSyOk",
  "kTTkkkkkSyKk",
  ".kSSSSSSSyk.",
  "..kkkkkkkkk.",
  "............",
  "............",
];
const TRAPPER_DIAG: Frame = [
  "............",
  "............",
  "......kkk...",
  ".....k1yok..",
  "....k1ssyKk.",
  "...k1qosSYk.",
  "..k1soOSKk..",
  ".k1sssSKk...",
  ".ksssSKk....",
  "kttsSKk.....",
  "kTTkkk......",
  ".kk.........",
];

// ---- 戦輪: 刃の外周と真鍮の内輪を持つ大きな輪（投擲の円月輪より大きく、歯が立つ） ----
const WAR_RING_SIDE: Frame = [
  "........k...",
  "....kkkk1k..",
  "...k111sssk.",
  "..k11yyyyssk",
  "..k1ykkkkYSk",
  ".kk1yk..kYSk",
  "ktt1yk..kYSk",
  "kTT1ykkkkYSk",
  ".kkssYYYYSSk",
  "...ksSSSSSSk",
  "....kkkkkkSk",
  "..........k.",
];
const WAR_RING_DIAG: Frame = [
  ".....kkk.k..",
  "...kk111ksk.",
  "..k111yyssk.",
  "..k1yykyysk.",
  ".k11yk.kYSSk",
  ".k1yk...kYSk",
  ".k11yk.kYSSk",
  "..ksyYkYYSk.",
  ".kkssSYSSSSk",
  "kttssSSSkkk.",
  "kTTkkkkk....",
  ".kk.........",
];

// ---- Wave 4（docs/ideas/weapons-wave4.md 7 章 Lane B）。MovesetKey が入ったら HELD に 1 行ずつ登録する ----

// ---- 爪: 手甲から先が鉤に曲がった 3 本の爪（両刃扱い）。拳の手甲（fists）と違い、爪が拳より前へ伸びる ----
export const CLAWS_SIDE: Frame = [
  "............",
  "............",
  "............",
  "..kkk.......",
  "..k1skkkkk..",
  ".kk1s1111sk.",
  "kttsskkkkkSk",
  "kTTsS11sssk.",
  ".kksSkkkkkSk",
  "..kSSsssSSk.",
  "..kkkkkkkkSk",
  "..........k.",
];
// 斜めは 3 本を柄の線に沿って平行に並べる（鉤を曲げると隣の爪とつながるので真っ直ぐ）
export const CLAWS_DIAG: Frame = [
  "............",
  ".........k..",
  "......k.ksk.",
  ".....ksk1k..",
  "....k1k1kSk.",
  "...k1k1ksk..",
  "..ksksksk...",
  "..k1sksk....",
  ".kksSSk.....",
  "kttkkk......",
  "kTTk........",
  ".kk.........",
];

// ---- チェーンアレイ: 短い木の柄と真鍮の口金、鎖の先に棘のある鉄球（球なので刃の向きは無い） ----
export const FLAIL_SIDE: Frame = [
  "............",
  "............",
  "............",
  "............",
  "............",
  ".kkkkk......",
  "kttUUyk..k..",
  "kTTXXYk.ksk.",
  ".kkkkkSk1ssk",
  ".......SssSs",
  ".......ksSSk",
  "........kSk.",
];
export const FLAIL_DIAG: Frame = [
  "........ksk.",
  ".......k1ssk",
  "......kssSSs",
  ".......ksSSk",
  ".......Sksk.",
  "....kkS..k..",
  "...kyYk.....",
  "..kUXk......",
  ".kkXk.......",
  "kttk........",
  "kTTk........",
  ".kk.........",
];

// ---- チャクラム: 革を巻いた握りを持つ鋼の輪。外周に渦の向きへ反った刃が 3 つ（戦輪の真鍮の内輪・歯と見分ける） ----
export const RING_BLADES_SIDE: Frame = [
  ".........k..",
  "........k1k.",
  ".....kk11k..",
  "....k111sk..",
  "...k1ssssSk.",
  ".kkW1skkssSk",
  "kttWsk..ksSk",
  "kTTwsk..kSSk",
  ".kkwsSkkSSSS",
  "...ksSSSSSkS",
  "....kSSSSk.k",
  "...kSSkkk...",
];
export const RING_BLADES_DIAG: Frame = [
  "......kk1k..",
  "....kk11k...",
  "...k1111k...",
  "..k1ssssSk..",
  ".k1sskkssSk.",
  ".k1sk..ksSk.",
  ".kssk..kSSSk",
  ".kWWskkSSSSk",
  ".kkwwSSSSkk.",
  "kttkSSSSSk..",
  "kTTkkkkkkSk.",
  ".kk......k..",
];

// ---- 扇子: 要（真鍮の留め具）を拳の側に置いた開いた扇。紙は明暗の 3 面で折り目を見せ、縁は朱（片側だけに開くので up） ----
export const FAN_SIDE: Frame = [
  "..krrrrk....",
  "..k111rrk...",
  "..k111ssrk..",
  "..k11ssssrk.",
  "..k11ssssrrk",
  ".kk1sss111rk",
  "kttUU11111rk",
  "kTTyX11111rk",
  ".kkkkkkkkkk.",
  "............",
  "............",
  "............",
];
// 斜めは柄の線（右上）から左上へ開く。左端で切れないよう開きを横より少し狭くした
export const FAN_DIAG: Frame = [
  "..kkkk......",
  ".krrrrkk....",
  "kr1ssrrrk...",
  "k11sss11rk..",
  "k11sss111k..",
  "k11ss111k...",
  ".k1ss11k....",
  "..kUU1k.....",
  ".kkyXk......",
  "kttkk.......",
  "kTTk........",
  ".kk.........",
];

/** 武器種ごとの持ち手（`weapon.<MovesetKey>`）。Record なので武器種を足すと型エラーで気付ける */
const HELD: Readonly<Record<MovesetKey, SpriteFrames>> = {
  sword: held(SWORD_SIDE, SWORD_DIAG),
  greatsword: held(GREATSWORD_SIDE, GREATSWORD_DIAG),
  twinBlades: held(TWIN_SIDE, TWIN_DIAG),
  spear: held(SPEAR_SIDE, SPEAR_DIAG),
  scythe: edged(SCYTHE_SIDE, SCYTHE_DIAG),
  fists: held(FISTS_SIDE, FISTS_DIAG),
  whip: held(WHIP_SIDE, WHIP_DIAG),
  cleaver: edged(CLEAVER_SIDE, CLEAVER_DIAG),
  staff: held(STAFF_SIDE, STAFF_DIAG),
  wand: held(WAND_SIDE, WAND_DIAG),
  katana: held(KATANA_SIDE, KATANA_DIAG),
  axe: edged(AXE_SIDE, AXE_DIAG),
  // 盾は回すと板が寝るので、上向きも正面の板で描く
  shield: held(SHIELD_SIDE, SHIELD_DIAG, SHIELD_UP),
  chainSickle: edged(CHAIN_SIDE, CHAIN_DIAG),
  hammer: edged(HAMMER_SIDE, HAMMER_DIAG, HAMMER_OUT),
  gunner: held(GUN_SIDE, GUN_DIAG),
  // 短銃は二丁拳銃の 1 挺と同じ拳銃（描画側が 1 挺だけ持つ）
  sidearm: held(GUN_SIDE, GUN_DIAG),
  longarm: held(LONGARM_SIDE, LONGARM_DIAG),
  cannon: held(CANNON_SIDE, CANNON_DIAG),
  thrown: held(THROWN_SIDE, THROWN_DIAG),
  grenade: held(GRENADE_SIDE, GRENADE_DIAG),
  trapper: held(TRAPPER_SIDE, TRAPPER_DIAG),
  warRing: held(WAR_RING_SIDE, WAR_RING_DIAG),
  claws: held(CLAWS_SIDE, CLAWS_DIAG),
  flail: held(FLAIL_SIDE, FLAIL_DIAG),
  ringBlades: held(RING_BLADES_SIDE, RING_BLADES_DIAG),
  fan: edged(FAN_SIDE, FAN_DIAG),
};

// -----------------------------------------------------------------------------
// 投げた武器（飛んでいる間の絵。render/thrownLook.ts が弾・技の key から引く）。
// 持ち手の横の絵（右向き）から拳を外して作る（持っている武器と同じ絵が飛んでいくように）。持ち手に無い小物だけ手で描く
// -----------------------------------------------------------------------------

/** 投げた武器の絵の種類。スプライトの key は thrownSpriteKey */
export const THROWN_SHAPES = [
  "knife",
  "axe",
  "hammer",
  "shield",
  "spear",
  "iceSpear",
  "cleaver",
  "warRing",
  "ringBlades",
  "weight",
  "ironBall",
  "bola",
] as const;
export type ThrownShape = (typeof THROWN_SHAPES)[number];

export function thrownSpriteKey(shape: ThrownShape): string {
  return `thrownWeapon.${shape}`;
}

const TRANSPARENT_PX = ".";
const OUTLINE_PX = "k";

/** 塗り（透明・輪郭・肌以外）の画素か */
function isFill(c: string | undefined): boolean {
  return c !== undefined && c !== TRANSPARENT_PX && c !== OUTLINE_PX && !SKIN.has(c);
}

function fillNear(frame: Frame, x: number, y: number): boolean {
  return [frame[y]?.[x + 1], frame[y]?.[x - 1], frame[y + 1]?.[x], frame[y - 1]?.[x]].some(isFill);
}

/** 透明の行・列を削る（回したときに絵の真ん中が回転の中心に来るように） */
function cropFrame(frame: Frame): Frame {
  const rows = frame.map((row, y) => ({ row, y })).filter(({ row }) => /[^.]/.test(row));
  const top = rows[0]?.y ?? 0;
  const bottom = rows[rows.length - 1]?.y ?? 0;
  const cols = frame.flatMap((row) => [...row].flatMap((c, x) => (c === TRANSPARENT_PX ? [] : [x])));
  const left = Math.min(...cols);
  const right = Math.max(...cols);
  return frame.slice(top, bottom + 1).map((row) => row.slice(left, right + 1));
}

/**
 * 持ち手の絵から拳を外す。塗りに接する肌は柄の端の輪郭に塗り替え（柄の端を閉じる）、残りの肌は透明にし、
 * 塗りに接しなくなった輪郭（拳の縁取り）も消す
 */
export function unheldFrame(frame: Frame): Frame {
  const capped = frame.map((row, y) =>
    [...row].map((c, x) => (SKIN.has(c) ? (fillNear(frame, x, y) ? OUTLINE_PX : TRANSPARENT_PX) : c)).join(""),
  );
  const trimmed = capped.map((row, y) =>
    [...row].map((c, x) => (c === OUTLINE_PX && !fillNear(capped, x, y) ? TRANSPARENT_PX : c)).join(""),
  );
  return cropFrame(trimmed);
}

/** 氷の投げ槍: 槍の金属と柄を氷の 3 段に塗り替える */
const ICE_SWAP: Readonly<Record<string, string>> = { "1": "2", s: "3", S: "4", W: "3", w: "4" };

function recolorFrame(frame: Frame, swap: Readonly<Record<string, string>>): Frame {
  return frame.map((row) => [...row].map((c) => swap[c] ?? c).join(""));
}

/** 短刀（右向き）: 木の握り・金の鍔・短い刃 */
const THROWN_KNIFE: Frame = [
  "...k.......",
  "kkkYkkkkkk.",
  "kUXY11sssSk",
  "kkkYSSSSSk.",
  "...kkkkkk..",
];

/** 分銅（鎖鎌の先の重り）: 上に鎖を通す輪 */
const THROWN_WEIGHT: Frame = [
  "..kk..",
  ".kSSk.",
  "..kk..",
  ".kssk.",
  "k1ssSk",
  "ksSSSk",
  ".kkkk.",
];

/** 鉄球（チェーンアレイの先の棘のある球） */
const THROWN_IRON_BALL: Frame = [
  "...k...",
  "..ksk..",
  ".k1ssk.",
  "ks1sSSk",
  ".ksSSk.",
  "..kSk..",
  "...k...",
];

/** 絡み紐: 紐でつないだ 2 つの重り */
const THROWN_BOLA: Frame = [
  ".kk......",
  "k1sk.....",
  "kSSk.....",
  ".kkW.....",
  "....W....",
  ".....W...",
  "......kk.",
  ".....k1sk",
  ".....kSSk",
  "......kk.",
];

const THROWN_FRAMES: Readonly<Record<ThrownShape, Frame>> = {
  knife: THROWN_KNIFE,
  axe: unheldFrame(AXE_SIDE),
  hammer: unheldFrame(HAMMER_SIDE),
  shield: unheldFrame(SHIELD_SIDE),
  spear: unheldFrame(SPEAR_SIDE),
  iceSpear: recolorFrame(unheldFrame(SPEAR_SIDE), ICE_SWAP),
  cleaver: unheldFrame(CLEAVER_SIDE),
  warRing: unheldFrame(WAR_RING_SIDE),
  ringBlades: unheldFrame(RING_BLADES_SIDE),
  weight: THROWN_WEIGHT,
  ironBall: THROWN_IRON_BALL,
  bola: THROWN_BOLA,
};

export const THROWN_SPRITES: Record<string, SpriteFrames> = Object.fromEntries(
  THROWN_SHAPES.map((shape) => [thrownSpriteKey(shape), [THROWN_FRAMES[shape]]]),
);

export const WEAPON_SPRITES: Record<string, SpriteFrames> = {
  ...Object.fromEntries(Object.entries(HELD).map(([key, frames]) => [weaponSpriteKey(key as MovesetKey), frames])),
  ...THROWN_SPRITES,
};

// -----------------------------------------------------------------------------
// 斬撃（docs/ideas/combat-feel-design.md C-3）。形ごとに別の絵、太さ 3 段 × 絵 3 種（A / B / 最終段）。
// 灰色の 3 段（外縁 1・中 s・内 S）で塗り、描画側が属性色で染める
// -----------------------------------------------------------------------------

/** 斬撃のキー。扇は開き角で 2 種（renderMath.ts の slashVisual が選ぶ） */
export const SLASH_SPRITE = {
  box: "slash.box",
  arc: "slash.arc",
  arcWide: "slash.arcWide",
  thrust: "slash.thrust",
  ring: "slash.ring",
} as const;

/** 絵の種類（フレーム内の並び） */
export const SLASH_VARIANT = { a: 0, b: 1, finisher: 2 } as const;
export type SlashVariant = (typeof SLASH_VARIANT)[keyof typeof SLASH_VARIANT];
/** 太さの段（0 細 / 1 中 / 2 太） */
export type SlashWeight = 0 | 1 | 2;
const SLASH_WEIGHTS: readonly SlashWeight[] = [0, 1, 2];
const SLASH_VARIANTS: readonly SlashVariant[] = [SLASH_VARIANT.a, SLASH_VARIANT.b, SLASH_VARIANT.finisher];

export function slashFrame(weight: SlashWeight, variant: SlashVariant): number {
  return weight * SLASH_VARIANTS.length + variant;
}

/** 1 画素の中心を受け取り、塗る文字（外なら undefined）を返す層。先に並べた層が勝つ */
type Layer = (x: number, y: number) => string | undefined;

function paint(w: number, h: number, layers: readonly Layer[]): Frame {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      let ch: string | undefined;
      for (const layer of layers) {
        ch = layer(x + 0.5, y + 0.5);
        if (ch) break;
      }
      row += ch ?? ".";
    }
    rows.push(row);
  }
  return rows;
}

/** 帯の断面（0 = 外縁 → 1 = 内縁）を明・中・暗の 3 段にする */
function shade(depth: number): string {
  if (depth < 0.34) return "1";
  if (depth < 0.7) return "s";
  return "S";
}

interface ArcSpec {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly thick: number;
  /** 半角（rad）。π 以上なら一周 */
  readonly half: number;
  /** 端へ向かって細くする（三日月） */
  readonly taper: boolean;
  /** 一周のうち描かない区間（環の B。角度を gap ずつに区切り、先頭 skip rad を抜く） */
  readonly gap?: { readonly every: number; readonly skip: number };
  /** 全部この文字で塗る（残像の細線） */
  readonly flat?: string;
}

function arcLayer(spec: ArcSpec): Layer {
  return (x, y) => {
    const dx = x - spec.cx;
    const dy = y - spec.cy;
    const a = Math.atan2(dy, dx);
    if (Math.abs(a) > spec.half) return undefined;
    if (spec.gap && ((a + Math.PI) % spec.gap.every) < spec.gap.skip) return undefined;
    const u = spec.half >= Math.PI ? 0 : Math.abs(a) / spec.half;
    const th = spec.thick * (spec.taper ? 1 - u * u : 1);
    if (th < 0.5) return undefined;
    const d = Math.hypot(dx, dy);
    if (d > spec.r || d < spec.r - th) return undefined;
    return spec.flat ?? shade((spec.r - d) / th);
  };
}

const DEG = Math.PI / 180;

/** 三日月（箱・扇）: A は 1 本、B は内側に残像の細線、最終段は太く外に細い閃き */
function crescentFrames(w: number, h: number, cx: number, cy: number, r: number, half: number, thicks: readonly number[]): Frame[] {
  const out: Frame[] = [];
  for (const weight of SLASH_WEIGHTS) {
    const thick = thicks[weight] ?? 2;
    const main: ArcSpec = { cx, cy, r, thick, half, taper: true };
    const echo: ArcSpec = { cx, cy, r: r - thick - 1.5, thick: 1, half: half * 0.7, taper: true, flat: "S" };
    const heavy: ArcSpec = { ...main, thick: thick * 1.6 };
    const glint: ArcSpec = { cx, cy, r: r + 0.1, thick: 1, half: half * 0.55, taper: false, flat: "1" };
    out.push(paint(w, h, [arcLayer(main)]));
    out.push(paint(w, h, [arcLayer(main), arcLayer(echo)]));
    out.push(paint(w, h, [arcLayer(glint), arcLayer({ ...heavy, r: r - 0.9 })]));
  }
  return out;
}

/** 環（円）: A は輪、B は途切れた輪、最終段は二重の輪 */
function ringFrames(size: number, thicks: readonly number[]): Frame[] {
  const c = size / 2;
  const r = c - 0.5;
  const out: Frame[] = [];
  for (const weight of SLASH_WEIGHTS) {
    const thick = thicks[weight] ?? 2;
    const ring: ArcSpec = { cx: c, cy: c, r, thick, half: Math.PI, taper: false };
    out.push(paint(size, size, [arcLayer(ring)]));
    out.push(paint(size, size, [arcLayer({ ...ring, gap: { every: 45 * DEG, skip: 14 * DEG } })]));
    const inner: ArcSpec = { cx: c, cy: c, r: r - thick - 2, thick: 1, half: Math.PI, taper: false, flat: "s" };
    out.push(paint(size, size, [arcLayer({ ...ring, thick: thick + 1 }), arcLayer(inner)]));
  }
  return out;
}

/** 突き: 根元から先端へ太り、先で尖る線。B は上下に速度線、最終段は太く先端が開く */
function thrustFrames(w: number, h: number, thicks: readonly number[]): Frame[] {
  const cy = h / 2;
  const start = 2;
  const grow = 6;
  const point = 5;
  const core = (maxTh: number, flare: number): Layer => (x, y) => {
    if (x < start) return undefined;
    const th = maxTh * Math.min(1, (x - start) / grow) * Math.min(1, (w - x) / point) + flare * Math.max(0, 1 - (w - x) / point);
    const depth = Math.abs(y - cy) / Math.max(0.5, th / 2);
    if (depth > 1) return undefined;
    if (depth < 0.4) return "1";
    return depth < 0.75 ? "s" : "S";
  };
  const speedLines: Layer = (x, y) => (x > 5 && x < w - 8 && (y < 1 || y > h - 1) ? "S" : undefined);
  const out: Frame[] = [];
  for (const weight of SLASH_WEIGHTS) {
    const thick = thicks[weight] ?? 2;
    out.push(paint(w, h, [core(thick, 0)]));
    out.push(paint(w, h, [core(thick, 0), speedLines]));
    out.push(paint(w, h, [core(Math.min(h, thick + 2), 2)]));
  }
  return out;
}

const SLASH_BOX_SIZE = 24;
const SLASH_ARC_SIZE = 32;
const SLASH_THRUST_W = 24;
const SLASH_THRUST_H = 8;

export const SLASH_SPRITES: Record<string, SpriteFrames> = {
  [SLASH_SPRITE.box]: crescentFrames(SLASH_BOX_SIZE, SLASH_BOX_SIZE, 2, 12, 19, 38 * DEG, [3, 4.5, 6]),
  // 扇の中心（自分）は絵の左から 1/4。描画側は reach / 2 先を中心に一辺 reach * 2 で置く
  [SLASH_SPRITE.arc]: crescentFrames(SLASH_ARC_SIZE, SLASH_ARC_SIZE, 8, 16, 15.5, 65 * DEG, [2.5, 4, 5.5]),
  [SLASH_SPRITE.arcWide]: crescentFrames(SLASH_ARC_SIZE, SLASH_ARC_SIZE, 8, 16, 15.5, 100 * DEG, [2.5, 4, 5.5]),
  [SLASH_SPRITE.thrust]: thrustFrames(SLASH_THRUST_W, SLASH_THRUST_H, [2, 4, 6]),
  [SLASH_SPRITE.ring]: ringFrames(SLASH_ARC_SIZE, [2, 3, 4.5]),
};
