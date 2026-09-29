import { ENEMY_TEMPO } from "../data/tuning";

/**
 * 章で技を覚える段（docs/ideas/jin-impl.md 2-4、encounter-core.md 4-3）。
 * ENEMY_TEMPO.depthStages[敵の定義 key] は minDepth の昇順の段の列。深度が minDepth 以上の段が全部効き、
 * 同じ語彙（連撃・離脱・後退射撃）を複数の段が持てば後の段が上書きする（深い章ほど技が育つ）。
 * 深度だけで決まるので乱数を引かない（決定的）
 */

/** 連続攻撃（連撃）の定義 */
export interface FollowUpDef {
  /** この連撃を覚えた段の深度 */
  minDepth: number;
  /** 1 撃目のあとに追加で続ける撃数 */
  count: number;
  /** 2 撃目以降の予備動作の基準（秒） */
  windup: number;
  /** 壁に激突したときだけ続ける（猪） */
  onWallOnly: boolean;
}

/** 段の 1 行（JSON の形） */
export interface DepthStage {
  minDepth: number;
  /** 連撃 */
  followUp?: { count: number; windup: number; onWallOnly: boolean };
  /** 離脱: 攻撃の後の隙の間に離れる速さ（歩く速さに対する倍率）。REACTION.retreatAfterStrike・behavior 既定より優先 */
  retreatMul?: number;
  /** 予備動作中の移動倍率。負は後退射撃（プレイヤーから離れながら構える）。behavior 既定より優先 */
  windupMoveMul?: number;
}

const STAGES: Readonly<Record<string, readonly DepthStage[] | undefined>> = ENEMY_TEMPO.depthStages;

/** 連撃の定義は段ごとに 1 度だけ作る（毎ステップ呼ばれるので割り当てない） */
const FOLLOW_UPS: ReadonlyMap<DepthStage, FollowUpDef> = buildFollowUps();

function buildFollowUps(): Map<DepthStage, FollowUpDef> {
  const out = new Map<DepthStage, FollowUpDef>();
  for (const list of Object.values(STAGES)) {
    for (const s of list ?? []) {
      if (s.followUp) out.set(s, Object.freeze({ minDepth: s.minDepth, ...s.followUp }));
    }
  }
  return out;
}

/** 段の列のうち深度で有効な段（minDepth 以下）で、pick が値を返す最後の段の値。後の段が前の段を上書きする */
export function latestStageValue<T>(list: readonly DepthStage[], depth: number, pick: (s: DepthStage) => T | undefined): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (!s || depth < s.minDepth) continue;
    const v = pick(s);
    if (v !== undefined) return v;
  }
  return undefined;
}

function latest<T>(key: string, depth: number, pick: (s: DepthStage) => T | undefined): T | undefined {
  const list = STAGES[key];
  return list ? latestStageValue(list, depth, pick) : undefined;
}

/** その深度で使える連続攻撃。無ければ undefined */
export function followUpOf(key: string, depth: number): FollowUpDef | undefined {
  return latest(key, depth, (s) => FOLLOW_UPS.get(s));
}

/** その深度で覚えている離脱の倍率。覚えていなければ undefined（REACTION・behavior 既定に任せる） */
export function learnedRetreatMul(key: string, depth: number): number | undefined {
  return latest(key, depth, (s) => s.retreatMul);
}

/** その深度で覚えている予備動作中の移動倍率。覚えていなければ undefined（behavior 既定に任せる） */
export function learnedWindupMoveMul(key: string, depth: number): number | undefined {
  return latest(key, depth, (s) => s.windupMoveMul);
}

/** 段を持つ敵の定義 key の一覧（テスト・検査用） */
export function stagedEnemyKeys(): readonly string[] {
  return Object.keys(STAGES);
}

/** その敵の段の列（テスト・検査用） */
export function depthStagesOf(key: string): readonly DepthStage[] {
  return STAGES[key] ?? [];
}
