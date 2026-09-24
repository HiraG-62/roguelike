/**
 * 手に持つ武器（docs/ideas/combat-feel-design.md C-1）と、当たり判定の形ごとの斬撃（C-3）。
 *
 * 武器: `weapon.<MovesetKey>` は 12x12 の 3 フレーム [横（右向き）, 斜め（右上向き）, 縦（上向き）]。
 * 拳（肌の 2x2）ごと描き、描画側は拳の中心（WEAPON_GRIPS）を手の位置に合わせて置く。
 * 8 方向は 3 枚と左右・上下の反転で作る（回転で描かない。renderMath.ts の weaponPose が選ぶ）。
 * 縦は横を 90 度回した絵（画素を並べ替えるだけなので崩れない）。光源は左上なので、横の上辺の明部は縦の左辺に来る
 */
import type { SpriteFrames } from "../sprites";
import type { MovesetKey } from "../weapons";
import type { Frame } from "./frameKit";

/** 武器スプライトの一辺 */
export const WEAPON_CANVAS = 12;

/** 武器のフレーム番号（横・斜め・縦） */
export const WEAPON_FRAME = { side: 0, diagonal: 1, up: 2 } as const;
export type WeaponFrame = (typeof WEAPON_FRAME)[keyof typeof WEAPON_FRAME];

/** 拳の中心（画素の境目の座標。2x2 の肌の真ん中）。反転したら x → 12 - x / y → 12 - y */
export const WEAPON_GRIPS: Readonly<Record<WeaponFrame, { readonly x: number; readonly y: number }>> = {
  0: { x: 2, y: 7 },
  1: { x: 2, y: 10 },
  2: { x: 7, y: 10 },
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

function held(side: Frame, diagonal: Frame, up: Frame = rotateUp(side)): SpriteFrames {
  return [side, diagonal, up];
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
const CLEAVER_DIAG: Frame = [
  "............",
  ".......kk...",
  "......k11k..",
  ".....k1sssk.",
  "....k1sssSSk",
  "...k1sssSSk.",
  "...kssSSSk..",
  "...kUSSSk...",
  ".kkUkkkk....",
  "kttk........",
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
  ".kkUXk......",
  "kttkk.S.....",
  "kTTk...S.kk.",
  ".kk.....kssk",
  ".........kk.",
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

/** 武器種ごとの持ち手（`weapon.<MovesetKey>`）。Record なので武器種を足すと型エラーで気付ける */
const HELD: Readonly<Record<MovesetKey, SpriteFrames>> = {
  sword: held(SWORD_SIDE, SWORD_DIAG),
  greatsword: held(GREATSWORD_SIDE, GREATSWORD_DIAG),
  twinBlades: held(TWIN_SIDE, TWIN_DIAG),
  spear: held(SPEAR_SIDE, SPEAR_DIAG),
  scythe: held(SCYTHE_SIDE, SCYTHE_DIAG),
  fists: held(FISTS_SIDE, FISTS_DIAG),
  whip: held(WHIP_SIDE, WHIP_DIAG),
  cleaver: held(CLEAVER_SIDE, CLEAVER_DIAG),
  staff: held(STAFF_SIDE, STAFF_DIAG),
  wand: held(WAND_SIDE, WAND_DIAG),
  katana: held(KATANA_SIDE, KATANA_DIAG),
  axe: held(AXE_SIDE, AXE_DIAG),
  // 盾は回すと板が寝るので、上向きも正面の板で描く
  shield: held(SHIELD_SIDE, SHIELD_DIAG, SHIELD_UP),
  chainSickle: held(CHAIN_SIDE, CHAIN_DIAG),
  hammer: held(HAMMER_SIDE, HAMMER_DIAG),
  gunner: held(GUN_SIDE, GUN_DIAG),
};

export const WEAPON_SPRITES: Record<string, SpriteFrames> = Object.fromEntries(
  Object.entries(HELD).map(([key, frames]) => [weaponSpriteKey(key as MovesetKey), frames]),
);

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
