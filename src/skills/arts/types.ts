import type { AttackProfile } from "../../core/element";
import type { KeywordProfile } from "../../core/keywords";
import type { StatusApply, StatusKind } from "../../core/status";
import type { TerrainKind } from "../../core/terrain";
import type { Vec } from "../../core/vec";
import type { MovesetKey } from "../../data/weapons";
import type { Scaling } from "../../loot/types";
import type { CastParams, ShotEffect, SkillTag, VariantAxis } from "../types";
import type { ArtSkillKey } from "./keys";

/**
 * 技（行為の列で書くスキル石）の型。docs/ideas/weapon-skills.md。
 * 共通技（どの武器種でも撃てる）と武器技（その武器種を装備しているときだけ撃てる）を同じ仕組みで書く。
 * 形・起点・付与する状態異常の種類などの union 文字列は TS（skills/arts/<群>.ts）、数値は
 * data/balance/skills/ART/<武器種 | common>.json の <技の key>.<行為の名前>
 */

/** 行為の種類。arc = 前方の扇 / ring = 円 / line = 帯 / dash = 踏み込み / blink = 照準地点へ跳ぶ / shot = 弾 / chain = 連鎖 / pull = 引き寄せ / buff = 自己強化 / detonate = 床の設置弾の起爆 */
export const ART_ACT_KINDS = ["arc", "ring", "line", "dash", "blink", "shot", "chain", "pull", "buff", "detonate"] as const;
export type ArtActKind = (typeof ART_ACT_KINDS)[number];

/** 行為の起点。self = 自分（遅れて出る行為は出る瞬間の自分）/ target = 照準地点（撃った瞬間に決まる） */
export type ArtAnchor = "self" | "target";

/** TS 側の行為の書き方（数値は JSON の n のブロック） */
export interface ArtActSpec {
  readonly kind: ArtActKind;
  /** JSON の数値ブロックの名前（技の中で一意） */
  readonly n: string;
  /** 省略は ring / pull / chain が self、それ以外も self（弾・扇・帯は自分から出る） */
  readonly anchor?: ArtAnchor;
  /** 弾の命中効果（shot だけ。省略は plain） */
  readonly shot?: ShotEffect;
  /** 当たった範囲に残す地形（ring / arc / line / dash の終点） */
  readonly terrain?: TerrainKind;
  /** この状態異常を持つ敵へは JSON の vsMul 倍（consume なら当てた後に消す） */
  readonly vs?: StatusKind;
  readonly consume?: boolean;
  /** 範囲内の敵弾を消す（ring / arc） */
  readonly clearsBullets?: boolean;
}

/** 行為（読み込み済み。数値は JSON から、形は TS から） */
export interface ArtAct {
  readonly kind: ArtActKind;
  readonly name: string;
  readonly anchor: ArtAnchor;
  /** 撃ってから出るまでの秒（0 は即時） */
  readonly delay: number;
  /** 照準方向へずらす距離と、照準方向の左右へずらす距離（px。起点の位置をずらす） */
  readonly ahead: number;
  readonly side: number;
  /** 照準方向からの角度のずれ（度。扇・帯・弾・踏み込みの向き） */
  readonly angleDeg: number;
  /** 威力（省略は与ダメを持たない行為。状態異常だけ付ける） */
  readonly damage?: Scaling;
  readonly knockback: number;
  /** 1 体に当てる回数 */
  readonly hits: number;
  readonly heavy: boolean;
  /** 1 ヒットの基礎怯み値の上書き（省略は技の poise） */
  readonly poise?: number;
  /** 生命がこの割合以下の敵（ボスを除く）を倒す */
  readonly execute?: number;
  readonly applies: readonly StatusApply[];
  readonly vs?: { readonly status: StatusKind; readonly mul: number; readonly consume: boolean };
  readonly terrain?: { readonly kind: TerrainKind; readonly radius: number; readonly duration?: number };
  readonly clearsBullets: boolean;
  // ---- 形の数値（種類ごとに使うものだけ読む） ----
  readonly reach: number;
  readonly deg: number;
  readonly radius: number;
  readonly length: number;
  readonly width: number;
  readonly distance: number;
  readonly invuln: number;
  // ---- 弾 ----
  readonly shot: ShotEffect;
  readonly count: number;
  readonly spreadDeg: number;
  readonly speed: number;
  readonly life: number;
  readonly bulletRadius: number;
  readonly pierce: number;
  readonly bounces: number;
  // ---- 連鎖 ----
  readonly range: number;
  readonly jumps: number;
  readonly jumpRange: number;
  // ---- 引き寄せ ----
  readonly toDistance: number;
  // ---- 自己強化 ----
  readonly duration: number;
  readonly damageMul?: number;
  readonly speedMul?: number;
  readonly heal?: number;
  readonly mana?: number;
  /** 自分に付ける良い状態異常（加速・硬化・怒気など） */
  readonly self: readonly StatusApply[];
}

/** TS 側の技の書き方 */
export interface ArtSpec {
  readonly key: ArtSkillKey;
  /** 武器技の武器種（null は共通技） */
  readonly moveset: MovesetKey | null;
  readonly name: string;
  /** HUD の 1 文字 */
  readonly icon: string;
  /** 何ができるかの 1 行 */
  readonly verb: string;
  readonly tags: readonly SkillTag[];
  /** 攻撃の素性（与ダメを持たない技は null） */
  readonly attack: AttackProfile | null;
  readonly acts: readonly ArtActSpec[];
  /** 省略は行為の種類から決める（skills/arts/build.ts の defaultAxes） */
  readonly axes?: readonly VariantAxis[];
  /** 省略はタグ・付与・属性から決める */
  readonly keywords?: KeywordProfile;
  /** 拾える最初の深度（省略 1） */
  readonly minDepth?: number;
}

/** 読み込み済みの技 */
export interface ArtDef {
  readonly key: ArtSkillKey;
  readonly moveset: MovesetKey | null;
  readonly acts: readonly ArtAct[];
  /** 照準地点を使う行為があるときの最大射程（無ければ undefined） */
  readonly castRange?: number;
  readonly minDepth: number;
}

/** 遅れて出る行為の予約（SkillRunState.artQueue） */
export interface ArtPending {
  timer: number;
  key: ArtSkillKey;
  act: number;
  params: CastParams;
  origin: Vec;
  dir: Vec;
  target: Vec;
  remote: boolean;
}
