/**
 * 被弾の記録（死因の元。docs/ideas/meta-impl.md 2-1）。
 * loot/types.ts の履歴からも読むので core に置く。純粋で乱数を使わない
 */

/** 被弾の種類: 敵の一撃 / 射撃 / 爆発 / 余波 / 落下物 / 状態異常 / 地形 / 死神 / 長居の影 / ランイベント / 遅れて来る傷 */
export const HURT_KINDS = ["strike", "shot", "blast", "hazard", "fall", "status", "terrain", "reaper", "linger", "event", "deferred"] as const;
export type HurtKind = (typeof HURT_KINDS)[number];

/** 被弾の呼び元が渡す出どころ。省略時は attacker から推定する（system/deathCause.ts の noteHurt） */
export interface HurtCause {
  kind: HurtKind;
  key?: string;
}

export interface HurtRecord {
  kind: HurtKind;
  /** 敵の key / 状態異常 / 地形 / ランイベントの key。撃ち手の消えた敵弾・出どころ不明は "" */
  key: string;
  /** 敵のとき: 精鋭の修飾子（主 → 添え）。それ以外は [] */
  elites: string[];
  /** 仇が与えた */
  nemesis: boolean;
}

export interface HurtLog {
  /** 最後の被弾（何でも） */
  last: HurtRecord | null;
  /** 最後に仇になれる敵本人から受けた被弾（仇の種の代わり。状態異常やボスで倒れても最後に殴った並の敵が残る） */
  lastEnemy: HurtRecord | null;
}

export function createHurtLog(): HurtLog {
  return { last: null, lastEnemy: null };
}

export function isHurtKind(v: unknown): v is HurtKind {
  return typeof v === "string" && (HURT_KINDS as readonly string[]).includes(v);
}
