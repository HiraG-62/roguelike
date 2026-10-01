import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { COMBO_TUNING as C, EXTRA_SKILL_TUNING as T } from "./tuning";
import { WAVE2_COMBO_TUNING as C2 } from "./tuning2";
import type { CastParams, ComboKey, SkillDef, SkillKey } from "./types";

/**
 * 連携（docs/ideas/skills-expansion.md 4 章）: スキル A を撃ってから一定秒以内にスキル B を手動で撃つと B が変化する。
 * 「直前の発動」は SkillRunState.lastCast（castSlot が記録。パリィは成功した瞬間）。
 * B 側の SkillDef.combos（技は ArtSpec.combos）に key を並べ、ここに A・受付秒・変化（倍率なら apply、ルールなら CastParams.combo を各スキルが読む）を書く。
 * B が技の連携は倍率（apply）だけで書く（技は params.combo を読まない）。
 * 反響・遅延の写しにも CastParams.combo が残る。連携は両方を手動で撃ったときだけ起きる（写しから新たな連携は起きない）。
 * untimed の連携は「直前に撃ったか」を見ず、requires / requiresAt だけで成立する（変身中の十字斬り）。
 */

export interface ComboDef {
  key: ComboKey;
  /** 先に撃つスキル（どれか 1 つ） */
  after: SkillKey | readonly SkillKey[];
  /** true なら「直前に撃ったか」を見ず、requires / requiresAt だけで成立する（空間の連携・変身中） */
  untimed?: boolean;
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
  /** 照準地点で決まる成立条件（空間の連携）。照準地点が分からない問い合わせ（HUD）では成立しない */
  requiresAt?: (state: GameState, target: Vec) => boolean;
}

export const COMBOS: Record<ComboKey, ComboDef> = {
  hookWhirl: {
    key: "hookWhirl",
    after: "chainHook",
    window: C.hookWhirl.window,
    name: "引き回し",
    verb: "鎖鎌の直後の旋風斬りは、範囲が広く引き寄せた敵を押し出さない",
    apply: (p) => ({ ...p, areaMul: p.areaMul * C.hookWhirl.areaMul, knockbackMul: 0 }),
  },
  parryRail: {
    key: "parryRail",
    after: "parry",
    window: C.parryRail.window,
    name: "返し撃ち",
    verb: "パリィ成功の直後の撃ち抜きは威力が上がる",
    apply: (p) => ({ ...p, timeMul: p.timeMul * C.parryRail.aimMul, damageMul: p.damageMul * C.parryRail.damageMul }),
  },
  diveQuake: {
    key: "diveQuake",
    after: "commonMeteorDive",
    window: C.diveQuake.window,
    name: "落地裂",
    verb: "墜星の直後の地裂きは早く出て、範囲が広い",
    apply: (p) => ({ ...p, timeMul: p.timeMul * C.diveQuake.windupMul, areaMul: p.areaMul * C.diveQuake.areaMul }),
  },
  contagionUnravel: {
    key: "contagionUnravel",
    after: "contagion",
    window: C.contagionUnravel.window,
    name: "総解き",
    verb: "伝染の直後の綻びは、命中した敵の周りの敵もまとめて綻ばせる",
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
    after: "commonBackstab",
    window: C.shadowExploit.window,
    name: "影刺し",
    verb: "背取りの直後の刺し穿ちは、脆弱でなくても必ず会心になる",
  },
  reelStomp: {
    key: "reelStomp",
    after: "commonInhale",
    window: C.reelStomp.window,
    name: "手繰り踏み",
    verb: "吸い風の直後の衝撃波は、範囲が広く大きく怯ませる",
    apply: (p) => ({ ...p, areaMul: p.areaMul * C.reelStomp.areaMul, poiseMul: p.poiseMul * C.reelStomp.poiseMul }),
  },
  // ---- 第 2 弾 ----
  waterFreeze: {
    key: "waterFreeze",
    after: "waterJar",
    window: C2.waterFreeze.window,
    name: "瞬氷",
    verb: "水瓶の後の瞬凍は範囲が広く、長く凍らせる",
  },
  oilScorch: {
    key: "oilScorch",
    after: "oilPot",
    window: C2.oilScorch.window,
    name: "走り火",
    verb: "油流しの後の炎の壁は威力が上がる",
    apply: (p) => ({ ...p, damageMul: p.damageMul * C2.oilScorch.damageMul }),
  },
  brandChain: {
    key: "brandChain",
    after: "brandSear",
    window: C2.brandChain.window,
    name: "烙火連",
    verb: "焼き印の直後の烙火は、倍にした烙印にさらに烙印を足してから起爆する",
  },
  breakCollapse: {
    key: "breakCollapse",
    after: "commonRisingSlash",
    window: C2.breakCollapse.window,
    name: "崩し落とし",
    verb: "昇り斬りの直後の地裂きは範囲が広く、大きく怯ませる",
    apply: (p) => ({ ...p, areaMul: p.areaMul * C2.breakCollapse.areaMul, poiseMul: p.poiseMul * C2.breakCollapse.poiseMul }),
  },
  hueBloom: {
    key: "hueBloom",
    after: "hueEtch",
    window: C2.hueBloom.window,
    name: "彩爆",
    verb: "彩刻の後の色解きは範囲が広い",
  },
  formArt: {
    key: "formArt",
    // 変身（左右クリックを差し替える 5 種。SkillRunState.shape）の最中なら成立する
    after: ["wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"],
    untimed: true,
    window: C2.formArt.window,
    name: "化身の極意",
    verb: "変身中の十字斬りは威力が上がる",
    requires: (state) => state.skills.shape !== null,
    apply: (p) => ({ ...p, damageMul: p.damageMul * C2.formArt.damageMul }),
  },
  levelMeteor: {
    key: "levelMeteor",
    after: "levelGround",
    window: C2.levelMeteor.window,
    name: "地裂墜",
    verb: "地均しの後の墜星は落ちる範囲が広い",
    apply: (p) => ({ ...p, areaMul: p.areaMul * C2.levelMeteor.areaMul }),
  },
};

/** 先に撃つスキルの一覧（after が 1 つでも配列でも同じ形で読む） */
export function comboAfter(c: Readonly<ComboDef>): readonly SkillKey[] {
  return typeof c.after === "string" ? [c.after] : c.after;
}

/**
 * いま成立する連携（無ければ null）。def.combos を順に見て、最初に成立したもの。
 * target は照準地点（空間の連携が読む）。省略すると空間の連携は成立しない
 */
export function findCombo(state: GameState, def: Readonly<SkillDef>, target?: Vec): ComboDef | null {
  if (!def.combos) return null;
  for (const key of def.combos) {
    const c = COMBOS[key];
    if (!afterSatisfied(state, c)) continue;
    if (c.requires && !c.requires(state)) continue;
    if (c.requiresAt && (!target || !c.requiresAt(state, target))) continue;
    return c;
  }
  return null;
}

/** 先に撃つスキルを受付秒の内に手動で撃ったか（untimed の連携は常に満たす） */
function afterSatisfied(state: GameState, c: Readonly<ComboDef>): boolean {
  if (c.untimed) return true;
  const last = state.skills.lastCast;
  if (!last || !comboAfter(c).includes(last.skillKey)) return false;
  return state.skills.clock - last.at <= c.window;
}
