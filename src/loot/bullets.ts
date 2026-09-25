import { type AttackProfile, attack } from "../core/element";
import { type KeywordProfile, kw } from "../core/keywords";
import { WEAPON } from "../data/tuning";
import { type BulletDef, type BulletFeature, MOVESETS, MOVESET_KEYS, hasBulletFeature, movesetCasts, reviveBullet } from "../data/weapons";
import { BASES, baseDef, baseFamily } from "./bases";
import type { PlayerStats } from "./types";

/**
 * 銃のベースが撃つ弾（射撃の型の共有表は廃止し、弾は武器そのものが持つ）。
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
const HOMING = kw(["ranged", "bullet"], [], ["dash"]);
const RICOCHET = kw(["ranged", "bullet", "wall"]);
const CHARGE = kw(["ranged", "bullet", "stagger"], ["still"]);
const MINE = kw(["ranged", "placed", "explode", "area"]);
const BOOMERANG = kw(["ranged", "bullet", "area"], [], ["still"]);
const LOB = kw(["ranged", "explode", "area"], ["still"]);

/** 銃のベースごとの弾の語と素性。キーは BASES の key（weapons.json の bullets と同じ集合。balance.test が検査する） */
const BULLET_PROFILES: Readonly<Record<string, BulletProfile>> = {
  twinPistols: { keywords: PLAIN, attack: PHYSICAL },
  twinRevolvers: { keywords: PLAIN, attack: PHYSICAL },
  pistol: { keywords: PLAIN, attack: PHYSICAL },
  revolver: { keywords: PLAIN, attack: PHYSICAL },
  smg: { keywords: RAPID, attack: PHYSICAL },
  throwingKnives: { keywords: RAPID, attack: PHYSICAL },
  burstRifle: { keywords: RAPID, attack: PHYSICAL },
  tripleCrossbow: { keywords: RAPID, attack: PHYSICAL },
  shotgun: { keywords: SPREAD, attack: PHYSICAL },
  blunderbuss: { keywords: SPREAD, attack: PHYSICAL },
  rifle: { keywords: PIERCE, attack: PHYSICAL },
  railgun: { keywords: PIERCE, attack: PHYSICAL },
  crossbow: { keywords: PIERCE, attack: PHYSICAL },
  blowgun: { keywords: HOMING, attack: attack("ranged", "physical", "poison") },
  seekerOrb: { keywords: HOMING, attack: attack("ranged", "physical", "poison") },
  ricochetGun: { keywords: RICOCHET, attack: PHYSICAL },
  chakram: { keywords: RICOCHET, attack: PHYSICAL },
  matchlock: { keywords: CHARGE, attack: attack("ranged", "physical", "fire") },
  handCannon: { keywords: CHARGE, attack: attack("ranged", "physical", "fire") },
  mineLauncher: { keywords: MINE, attack: attack("ranged", "physical", "fire") },
  caltrops: { keywords: MINE, attack: attack("ranged", "physical", "fire") },
  returnChakram: { keywords: BOOMERANG, attack: PHYSICAL },
  flyingBlade: { keywords: BOOMERANG, attack: PHYSICAL },
  mortar: { keywords: LOB, attack: PHYSICAL },
  grenadeLauncher: { keywords: LOB, attack: PHYSICAL },
};

/** 銃のベースの弾の語と素性のキー一覧（テスト用） */
export const BULLET_PROFILE_KEYS: readonly string[] = Object.keys(BULLET_PROFILES);

const RAW = WEAPON.bullets as Readonly<Record<string, unknown>>;

function baseBullets(): BulletDef[] {
  const out: BulletDef[] = [];
  for (const base of BASES) {
    if (baseFamily(base) !== "gun") continue;
    const profile = BULLET_PROFILES[base.key];
    if (!profile) throw new Error(`銃のベース ${base.key} に弾の語と素性が無い`);
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
    for (const c of movesetCasts(MOVESETS[key])) out.push(c.throw.bullet);
  }
  return out;
}

/** すべての弾（銃のベース + 弾を出す固有技）。キーは BulletDef.key */
export const BULLETS: Readonly<Record<string, BulletDef>> = Object.fromEntries([...baseBullets(), ...artBullets()].map((b) => [b.key, b]));

/** 銃を持たないときの弾（近接の武器種は左で撃たないので、射撃の既定の素性を引くときだけ使う） */
export const DEFAULT_BULLET = "pistol";

export function bulletDef(key: string): BulletDef {
  const def = BULLETS[key] ?? BULLETS[DEFAULT_BULLET];
  if (!def) throw new Error(`既定の弾 ${DEFAULT_BULLET} が無い`);
  return def;
}

/** 右手のベースの弾。銃でなければ既定 */
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
