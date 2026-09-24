import type { AttackProfile } from "../core/element";
import type { Rule } from "../core/rules";
import type { StatusApply } from "../core/status";
import type { AttrRatio, Scaling } from "../loot/types";
import { ULTIMATE } from "./tuning";
import {
  type ActionStepDef,
  type BulletNumbers,
  type MeleeStepDef,
  type MovesetKey,
  type ThrowArtDef,
  BURST_ATTACK,
  MOVESET_KEYS,
} from "./weapons";

/**
 * 奥義（F で奥義ゲージを使って出す技）の型と定義。docs/ideas/ougi-and-dual-actions.md 3 章。
 * 武器種ごとに 3 本（拠点の武器掛けで 1 本選ぶ）。数値は src/data/balance/ultimates.json の ULTIMATE。
 * 今は各武器種の 1 本目 = 旧バーストと同じ円月（nova）の仮定義だけ（Lane 0）。中身は Lane B が埋める
 */

export const ULTIMATE_KINDS = ["instant", "sustain"] as const;
export type UltimateKind = (typeof ULTIMATE_KINDS)[number];

/** 周囲攻撃。radius に burstRadiusMul、威力に burstDamageMul が掛かる */
export interface NovaAct {
  readonly kind: "nova";
  readonly radius: number;
  readonly scaling: Scaling;
  readonly poise: number;
  readonly poiseRatio?: AttrRatio;
  readonly knockback: number;
  readonly applies?: readonly StatusApply[];
  /** 多段（省略は 1） */
  readonly hits?: number;
  /** 範囲内の敵弾を消す */
  readonly clearsBullets?: boolean;
}

/** instant の 1 行為。列に並べて順に出す（照準方向・自分の位置は発動時に固定）。swing / lunge は列の最後にだけ置く */
export type UltimateAct =
  | NovaAct
  /** beginSwing に派生相当で渡す 1 振り（heavy・lunge・hits を使える） */
  | { readonly kind: "swing"; readonly step: MeleeStepDef }
  /** weaponArts の emitArtVolley で弾を出す */
  | { readonly kind: "volley"; readonly throw: ThrowArtDef }
  /** 照準方向へ distance 進みながら step で当てる */
  | { readonly kind: "lunge"; readonly distance: number; readonly step: MeleeStepDef; readonly invuln: number }
  /** 周囲の敵を toDistance まで引き寄せる */
  | { readonly kind: "pull"; readonly radius: number; readonly toDistance: number; readonly applies?: readonly StatusApply[] }
  | { readonly kind: "buff"; readonly damageMul?: number; readonly speedMul?: number; readonly duration: number; readonly invuln?: number; readonly heal?: number }
  /** 床の自分の設置弾を全部起爆 */
  | { readonly kind: "detonate" };

/** 持続（sustain）の奥義: ゲージが減る間の倍率・段の差し替え・弾の差し替え・命中付与・Rule の束 */
export interface SustainDef {
  /** 毎秒減るゲージ。0 になったら終わる。もう一度 F で早く終える（残りは保つ） */
  readonly drainPerSec: number;
  readonly minSec: number;
  readonly mul: {
    readonly damage?: number;
    readonly attackSpeed?: number;
    readonly fireRate?: number;
    readonly moveSpeed?: number;
    readonly poise?: number;
    readonly incoming?: number;
  };
  /** 段の差し替え（省略した側はそのまま）。銃は bullet で弾を差し替える */
  readonly steps?: { readonly primary?: readonly MeleeStepDef[]; readonly secondary?: readonly ActionStepDef[] };
  readonly bullet?: Partial<BulletNumbers>;
  /** 近接・射撃の命中で付ける状態異常 */
  readonly applies?: readonly StatusApply[];
  /** 自分の周りに毎 interval 秒ダメージ（radius は burstRadiusMul が掛かる） */
  readonly aura?: { readonly radius: number; readonly interval: number; readonly scaling: Scaling; readonly poise: number };
  /** 持続中だけ効く Rule（system/rules.ts の collectRules が Player.ultimate.active のとき集める） */
  readonly rules?: readonly Rule[];
  /** 終わりに出す行為 */
  readonly onEnd?: readonly UltimateAct[];
}

interface UltimateBase {
  /** `<武器種>.<名前>`（武器種をまたいで一意。Profile.ultimates の値） */
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  readonly moveset: MovesetKey;
  /** 素性（ジャンル・属性）。行為の威力はこれで受けさせる */
  readonly attack: AttackProfile;
}

export type UltimateDef =
  | (UltimateBase & { readonly kind: "instant"; readonly acts: readonly UltimateAct[]; readonly invuln: number })
  | (UltimateBase & { readonly kind: "sustain"; readonly sustain: SustainDef });

/** 武器種ごとの奥義（1 本以上。0 番目が既定）。Lane B が 3 本に揃える */
export type UltimateSet = readonly [UltimateDef, ...UltimateDef[]];

const FULL_MOON_NAME = "円月";
const FULL_MOON_DESC = "周囲をまとめて打ち払い、近くの敵弾を消す";

/** 円月（旧バースト）の周囲攻撃。数値は ULTIMATE.defs.fullMoon.nova */
function fullMoonNova(): NovaAct {
  const n = ULTIMATE.defs.fullMoon.nova;
  return { kind: "nova", radius: n.radius, scaling: n.scaling, poise: n.poise, poiseRatio: n.poiseRatio, knockback: n.knockback, clearsBullets: true };
}

/** 円月。旧バーストと同じ素性（範囲・魔法）・無敵 */
function fullMoon(moveset: MovesetKey): UltimateDef {
  return {
    key: `${moveset}.fullMoon`,
    name: FULL_MOON_NAME,
    desc: FULL_MOON_DESC,
    moveset,
    attack: BURST_ATTACK,
    kind: "instant",
    acts: [fullMoonNova()],
    invuln: ULTIMATE.common.invuln,
  };
}

/** 仮定義: どの武器種も 1 本目は円月（旧バーストの挙動のまま） */
function placeholderSet(moveset: MovesetKey): UltimateSet {
  return [fullMoon(moveset)];
}

export const ULTIMATES: Readonly<Record<MovesetKey, UltimateSet>> = Object.fromEntries(
  MOVESET_KEYS.map((k) => [k, placeholderSet(k)]),
) as Record<MovesetKey, UltimateSet>;

const BY_KEY: ReadonlyMap<string, UltimateDef> = new Map(MOVESET_KEYS.flatMap((k) => ULTIMATES[k].map((u) => [u.key, u] as const)));

/** key から奥義を引く。無ければ undefined */
export function ultimateDef(key: string): UltimateDef | undefined {
  return BY_KEY.get(key);
}

/** 武器種の既定の奥義（配列の 0 番目） */
export function defaultUltimate(moveset: MovesetKey): UltimateDef {
  return ULTIMATES[moveset][0];
}

/** 定義済みの奥義の key か（永続化・リプレイの sanitize 用） */
export function isUltimateKey(v: unknown): v is string {
  return typeof v === "string" && BY_KEY.has(v);
}
