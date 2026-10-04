import { type AttackProfile, attack } from "../core/element";
import { type KeywordProfile, kw } from "../core/keywords";
import { WEAPON } from "../data/tuning";
import { type BulletDef, type BulletFeature, MOVESETS, MOVESET_KEYS, type MovesetKey, hasBulletFeature, isRangedWeapon, movesetCasts, reviveBullet, shootsPrimary } from "../data/weapons";
import { BASES, type BaseItemDef, baseDef, baseFamily } from "./bases";
import type { PlayerStats } from "./types";

/**
 * 銃・投擲物のベースが撃つ弾（射撃の型の共有表は廃止し、弾は武器そのものが持つ）。
 * 数値は src/data/balance/weapons/ の WEAPON.bullets.<ベースの key>、語と素性（union 文字列）はここの表。
 * 弾を出す固有技（斧の投擲・魔弾・乱れ撃ち・撒き散らし）の弾は技の定義が持ち、ここで同じ表に並べて key で引けるようにする
 */

interface BulletProfile {
  readonly keywords: KeywordProfile;
  readonly attack: AttackProfile;
}

const PHYSICAL = attack("ranged", "physical");
const PLAIN = kw(["ranged", "bullet"]);
const RAPID = kw(["ranged", "bullet", "combo"], [], ["crit"]);
const SPREAD = kw(["ranged", "bullet", "stagger"], [], ["melee", "dash"]);
const PIERCE = kw(["ranged", "bullet", "stagger"], [], ["area"]);
const CHARGE = kw(["ranged", "bullet", "stagger"], ["still"]);
const MINE = kw(["ranged", "placed", "explode", "area"]);
const BOOMERANG = kw(["ranged", "bullet", "area"], [], ["still"]);
const LOB = kw(["ranged", "explode", "area"], ["still"]);
const HEAVY_THROW = kw(["ranged", "bullet", "stagger"], [], ["melee"]);

/** 弾を持つベース（baseHasBullet）ごとの弾の語と素性。キーは BASES の key（weapons.json の bullets と同じ集合。balance.test が検査する） */
const BULLET_PROFILES: Readonly<Record<string, BulletProfile>> = {
  twinPistols: { keywords: PLAIN, attack: PHYSICAL },
  twinRevolvers: { keywords: PLAIN, attack: PHYSICAL },
  pistol: { keywords: PLAIN, attack: PHYSICAL },
  revolver: { keywords: PLAIN, attack: PHYSICAL },
  smg: { keywords: RAPID, attack: PHYSICAL },
  burstRifle: { keywords: RAPID, attack: PHYSICAL },
  tripleCrossbow: { keywords: RAPID, attack: PHYSICAL },
  shotgun: { keywords: SPREAD, attack: PHYSICAL },
  blunderbuss: { keywords: SPREAD, attack: PHYSICAL },
  rifle: { keywords: PIERCE, attack: PHYSICAL },
  railgun: { keywords: PIERCE, attack: PHYSICAL },
  crossbow: { keywords: PIERCE, attack: PHYSICAL },
  matchlock: { keywords: CHARGE, attack: attack("ranged", "physical", "fire") },
  handCannon: { keywords: CHARGE, attack: attack("ranged", "physical", "fire") },
  mineLauncher: { keywords: MINE, attack: attack("ranged", "physical", "fire") },
  caltrops: { keywords: MINE, attack: attack("ranged", "physical", "fire") },
  mortar: { keywords: LOB, attack: PHYSICAL },
  grenadeLauncher: { keywords: LOB, attack: PHYSICAL },
  // 投擲物（左で投げる器）。クナイは単発で重い、戦輪の器は行って戻る
  kunai: { keywords: HEAVY_THROW, attack: PHYSICAL },
  ringBlades: { keywords: BOOMERANG, attack: PHYSICAL },
  fangRings: { keywords: BOOMERANG, attack: PHYSICAL },
};

/** 弾を持つベースの弾の語と素性のキー一覧（テスト用） */
export const BULLET_PROFILE_KEYS: readonly string[] = Object.keys(BULLET_PROFILES);

const RAW = WEAPON.bullets as Readonly<Record<string, unknown>>;

/**
 * 器が自分の弾を持つか: 近接でない群（銃・投擲物）で、左で撃つ武器種の器。
 * 手裏剣は左右とも振りが撃つ弾（cast）なので器は弾を持たない
 */
export function baseHasBullet(base: BaseItemDef): boolean {
  const family = baseFamily(base);
  if (family === undefined || family === "melee" || base.moveset === undefined) return false;
  return shootsPrimary(MOVESETS[base.moveset]);
}

function baseBullets(): BulletDef[] {
  const out: BulletDef[] = [];
  for (const base of BASES) {
    if (!baseHasBullet(base)) continue;
    const profile = BULLET_PROFILES[base.key];
    if (!profile) throw new Error(`弾を持つベース ${base.key} に弾の語と素性が無い`);
    out.push(reviveBullet(RAW[base.key], base.key, base.name, profile.keywords, profile.attack));
  }
  return out;
}

/** 固有技の弾: 右レーンの弾の段（`art.<段の key>`）と、振りが撃つ cast（`cast.<cast の key>`） */
function artBullets(): BulletDef[] {
  const out: BulletDef[] = [];
  for (const key of MOVESET_KEYS) {
    for (const s of MOVESETS[key].steps2) {
      if (s.kind === "volley") out.push(s.throw.bullet);
    }
    for (const c of movesetCasts(MOVESETS[key])) {
      out.push(c.throw.bullet);
      if (c.releaseThrow) out.push(c.releaseThrow.bullet);
    }
  }
  return out;
}

/** すべての弾（弾を持つベース + 弾を出す固有技）。キーは BulletDef.key */
export const BULLETS: Readonly<Record<string, BulletDef>> = Object.fromEntries([...baseBullets(), ...artBullets()].map((b) => [b.key, b]));

/** 銃を持たないときの弾（近接の武器種は左で撃たないので、射撃の既定の素性を引くときだけ使う） */
export const DEFAULT_BULLET = "pistol";

export function bulletDef(key: string): BulletDef {
  const def = BULLETS[key] ?? BULLETS[DEFAULT_BULLET];
  if (!def) throw new Error(`既定の弾 ${DEFAULT_BULLET} が無い`);
  return def;
}

/**
 * 銃・投擲物の武器種の器（右手のベース）。一番早く出る順（同じ深さはベースの表の順）。近接の武器種は空。
 * 同じ武器種でも器ごとに弾の性質（溜め撃ち・三点・追尾…）が違うので、拠点の武器掛けは器を選ばせる
 */
export function rangedBasesOf(moveset: MovesetKey): BaseItemDef[] {
  if (!isRangedWeapon(MOVESETS[moveset])) return [];
  const bases = BASES.filter((b) => b.slot === "mainHand" && b.moveset === moveset);
  return bases
    .map((b, i) => ({ b, i }))
    .sort((x, y) => x.b.minLevel - y.b.minLevel || x.i - y.i)
    .map((x) => x.b);
}

/** 右手のベースの弾。弾を持つ器でなければ既定 */
export function bulletOfBase(baseKey: string | undefined): string {
  if (baseKey === undefined) return DEFAULT_BULLET;
  const base = baseDef(baseKey);
  return base && BULLETS[base.key] ? base.key : DEFAULT_BULLET;
}

/** 今の弾 */
export function currentBullet(stats: Readonly<Pick<PlayerStats, "bullet">>): BulletDef {
  return bulletDef(stats.bullet);
}

/** 今の弾がその性質を持つか（祝福の出現条件・統一ルール・性質の効き先） */
export function statsBulletHas(stats: Readonly<Pick<PlayerStats, "bullet">>, feature: BulletFeature): boolean {
  return hasBulletFeature(currentBullet(stats), feature);
}
