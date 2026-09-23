import type { GameState } from "../core/state";
import { COMBO_TUNING as C, EXTRA_SKILL_TUNING as T } from "./tuning";
import type { CastParams, ComboKey, SkillDef, SkillKey } from "./types";

/**
 * 連携（docs/ideas/skills-expansion.md 4 章）: スキル A を撃ってから一定秒以内にスキル B を手動で撃つと B が変化する。
 * 「直前の発動」は SkillRunState.lastCast（castSlot が記録。パリィは成功した瞬間）。
 * B 側の SkillDef.combos に key を並べ、ここに A・受付秒・変化（倍率なら apply、ルールなら CastParams.combo を各スキルが読む）を書く。
 * 反響・遅延の写しにも CastParams.combo が残る。連携は両方を手動で撃ったときだけ起きる（写しから新たな連携は起きない）。
 */

export interface ComboDef {
  key: ComboKey;
  /** 先に撃つスキル */
  after: SkillKey;
  /** 受付秒（A の発動からの経過） */
  window: number;
  /** 浮き文字に出す連携名 */
  name: string;
  /** ツールチップ用: 何が変わるか */
  verb: string;
  /** 倍率の変化（ルールの変化は各スキルが params.combo を見て分岐する） */
  apply?: (p: CastParams) => CastParams;
  /** 時間以外の成立条件（引力球が場に残っているか など） */
  requires?: (state: GameState) => boolean;
}

export const COMBOS: Record<ComboKey, ComboDef> = {
  wellThunder: {
    key: "wellThunder",
    after: "gravityWell",
    window: C.wellThunder.window,
    name: "渦雷",
    verb: "引力球の後の雷撃は球の中心へ吸われ、球の中の敵すべてに落ちる（感電 +1）",
    requires: (state) => state.skills.wells.length > 0,
  },
  hookWhirl: {
    key: "hookWhirl",
    after: "chainHook",
    window: C.hookWhirl.window,
    name: "引き回し",
    verb: "鎖鎌の直後の旋風斬りは、引き寄せた敵を回転の中心に留める（押し出さない）",
    apply: (p) => ({ ...p, areaMul: p.areaMul * C.hookWhirl.areaMul, knockbackMul: 0 }),
  },
  parryRail: {
    key: "parryRail",
    after: "parry",
    window: C.parryRail.window,
    name: "返し撃ち",
    verb: "パリィ成功の直後の撃ち抜きは照準なしで撃ち、威力が上がる",
    apply: (p) => ({ ...p, timeMul: p.timeMul * C.parryRail.aimMul, damageMul: p.damageMul * C.parryRail.damageMul }),
  },
  diveQuake: {
    key: "diveQuake",
    after: "meteorDive",
    window: C.diveQuake.window,
    name: "落地裂",
    verb: "墜星の着地直後の地裂きは溜めなしで出て、範囲が広い",
    apply: (p) => ({ ...p, timeMul: p.timeMul * C.diveQuake.windupMul, areaMul: p.areaMul * C.diveQuake.areaMul }),
  },
  contagionUnravel: {
    key: "contagionUnravel",
    after: "contagion",
    window: C.contagionUnravel.window,
    name: "総解き",
    verb: "伝染の直後の綻びは、命中した敵の周りの敵もまとめて綻ばせる",
  },
  pactWhirl: {
    key: "pactWhirl",
    after: "bloodPact",
    window: C.pactWhirl.window,
    name: "血風",
    verb: "血の契約の後の旋風斬りは、当てるたびに出血を付ける",
  },
  frostBreaker: {
    key: "frostBreaker",
    after: "frostField",
    window: C.frostBreaker.window,
    name: "氷砕き",
    verb: "氷結地帯の後の砕氷槌は冷気を多く与え、範囲が広い",
    apply: (p) => ({ ...p, areaMul: p.areaMul * T.iceBreaker.comboAreaMul }),
  },
  shadowExploit: {
    key: "shadowExploit",
    after: "shadowStep",
    window: C.shadowExploit.window,
    name: "影刺し",
    verb: "影渡りの直後の刺し穿ちは、脆弱でなくても必ず会心になる",
  },
  hasteSpiral: {
    key: "hasteSpiral",
    after: "haste",
    window: C.hasteSpiral.window,
    name: "疾風弾幕",
    verb: "加速の後の回転弾幕は、撃っている間も遅くならない",
  },
  reelStomp: {
    key: "reelStomp",
    after: "threadReel",
    window: C.reelStomp.window,
    name: "手繰り踏み",
    verb: "手繰り糸の直後の震脚は、範囲が広く大きく怯ませる",
    apply: (p) => ({ ...p, areaMul: p.areaMul * T.stomp.comboAreaMul, poiseMul: p.poiseMul * T.stomp.comboPoiseMul }),
  },
};

/** いま成立する連携（無ければ null）。def.combos を順に見て、最初に成立したもの */
export function findCombo(state: GameState, def: Readonly<SkillDef>): ComboDef | null {
  const last = state.skills.lastCast;
  if (!last || !def.combos) return null;
  for (const key of def.combos) {
    const c = COMBOS[key];
    if (c.after !== last.skillKey) continue;
    if (state.skills.clock - last.at > c.window) continue;
    if (c.requires && !c.requires(state)) continue;
    return c;
  }
  return null;
}
