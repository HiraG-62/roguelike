import type { HurtCause, HurtRecord } from "../core/hurt";
import type { Enemy, GameState } from "../core/state";
import { ENEMIES, type EnemyDef } from "../data/enemies";

/**
 * 被弾の出どころを覚える（死亡画面の死因と、次のランの仇の種。docs/ideas/meta-impl.md 2-1）。
 * 乱数を引かず、ゲーム進行にも効かない。import は core と data/enemies だけ（combat.ts から呼ぶので輪を作らない）
 */

const DEF_BY_KEY: ReadonlyMap<string, EnemyDef> = new Map(ENEMIES.map((d) => [d.key, d]));

/** 仇になれない振る舞い（設置物・動かない物・卵） */
const NEMESIS_EXCLUDED_BEHAVIORS: ReadonlySet<EnemyDef["behavior"]> = new Set<EnemyDef["behavior"]>(["inert", "mine", "egg"]);

/** 被弾を記録する（damagePlayer / damagePlayerDot が被ダメの確定後に呼ぶ。致命の一撃でも倒れる前に書く） */
export function noteHurt(state: GameState, attacker: Enemy | undefined, cause: HurtCause | undefined): void {
  const record: HurtRecord = {
    kind: cause?.kind ?? (attacker ? "strike" : "hazard"),
    key: cause?.key ?? attacker?.defKey ?? "",
    elites: elitesOf(attacker),
    nemesis: attacker?.nemesis === true,
  };
  state.hurt.last = record;
  // ボス・部屋主に倒されても仇の種が残るよう、仇になれる敵の被弾だけ覚える
  if (attacker && nemesisEligible(attacker.defKey)) state.hurt.lastEnemy = record;
}

function elitesOf(e: Enemy | undefined): string[] {
  if (!e) return [];
  const out: string[] = [];
  if (e.elite) out.push(e.elite);
  if (e.eliteExtra) out.push(e.eliteExtra);
  return out;
}

/** 力尽きたときの最後の被弾（status が "dead" でなければ null） */
export function killerOf(state: GameState): HurtRecord | null {
  if (state.status !== "dead") return null;
  return state.hurt.last;
}

/** 仇になれる敵か（ボス・片割れ・部屋主・weight 0・商人・入れ物・inert / mine / egg・timid は不可、未知の key も不可） */
export function nemesisEligible(key: string): boolean {
  const def = DEF_BY_KEY.get(key);
  if (!def) return false;
  if (def.boss === true || def.bossPart === true || def.lairMaster === true) return false;
  if (def.weight <= 0 || def.merchant === true || def.container !== undefined) return false;
  if (def.timid !== undefined) return false;
  return !NEMESIS_EXCLUDED_BEHAVIORS.has(def.behavior);
}

/** 仇の種: killer が敵で適格ならそれ、でなければ lastEnemy が適格ならそれ、無ければ null */
export function grudgeOf(state: GameState): { key: string; elites: string[] } | null {
  const killer = killerOf(state);
  if (!killer) return null;
  for (const record of [killer, state.hurt.lastEnemy]) {
    if (record && nemesisEligible(record.key)) return { key: record.key, elites: [...record.elites] };
  }
  return null;
}
