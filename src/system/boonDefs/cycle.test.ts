import { describe, expect, it } from "vitest";
import type { EventKind, GameEvent } from "../../core/events";
import type { Enemy, GameState } from "../../core/state";
import { BOON_LINEAGE } from "../../data/tuning";
import { stoneFromSeed } from "../../skills/generator";
import type { SkillKey } from "../../skills/types";
import { BOON_ACTIONS, BOONS, type BoonDef } from "../boonDefs";
import { boonManaCostMul, foldBoonStats } from "../boons";
import { applyModifiers } from "../modifiers";
import { resolveRules } from "../rules";
import { castSlot, createSkillRunState, flowTurnMul, updateSkills } from "../skills";
import { arena, placeEnemy, withInput } from "../testHelpers";
import { BOONS_CYCLE, BOON_KEYS_CYCLE, CHANT_TALLY, FLOW_TURN_TALLY, RETURN_TALLY } from "./cycle";

/** 輪廻の 11 枚（docs/ideas/boon-impl.md 2-6）の構成と、各札の効果が 1 本ずつ起きることの検査 */

const C = BOON_LINEAGE.cycle;
const CARDS: readonly BoonDef[] = BOON_KEYS_CYCLE.map((k) => BOONS_CYCLE[k]);
const COOLDOWN = 10;

function cleanArena(seed = 5): GameState {
  const state = arena(seed);
  for (const r of state.rooms) r.locked = false;
  state.events = [];
  state.pendingEvents = [];
  return state;
}

/** スロット 0 に石を付けた状態 */
function withStone(skillKey: SkillKey, seed = 5): GameState {
  const state = cleanArena(seed);
  const stone = { ...stoneFromSeed(3, { foundDepth: 1, now: 0, skillKey }), variants: [], links: 0 };
  state.skills = createSkillRunState({ version: 1, loadout: [stone.id, null, null, null], stones: [stone] });
  updateSkills(state, withInput({}), 0);
  return state;
}

function eventOf(state: GameState, kind: EventKind, target?: Enemy, amount?: number): GameEvent {
  const pos = target === undefined ? { ...state.player.body.pos } : { ...target.body.pos };
  return {
    kind,
    actor: "player",
    pos,
    depth: 0,
    source: { kind: "player", key: "test" },
    ...(target ? { targetId: target.id } : {}),
    ...(amount !== undefined ? { amount } : {}),
  };
}

/** 札の Rule だけを 1 つのイベントに当てる */
function fireCard(state: GameState, def: BoonDef, ev: GameEvent): void {
  state.events.push(ev);
  resolveRules(state, 0, def.rules ?? []);
}

describe("輪廻の札の構成", () => {
  it("11 枚: 加護 5（行動ごとに 1 枚）・摂理 3・研鑽 2・真髄 1、全て輪廻", () => {
    expect(CARDS.length).toBe(11);
    const count = (card: string): number => CARDS.filter((d) => d.card === card).length;
    expect([count("grace"), count("law"), count("temper"), count("apex")], "札の種類の枚数").toEqual([5, 3, 2, 1]);
    const actions = CARDS.filter((d) => d.card === "grace").map((d) => d.action);
    expect([...actions].sort(), "加護は行動ごとに 1 枚").toEqual([...BOON_ACTIONS].sort());
    for (const d of CARDS) {
      expect(d.lineage, `${d.key} の系譜`).toBe("cycle");
      expect(d.changes, `${d.key} の変わるもの`).toBeDefined();
      expect(d.keywords, `${d.key} の語`).toBeDefined();
      expect(d.cursed, `${d.key} は呪いではない`).toBe(false);
      if (d.card !== "grace") expect(d.action, `${d.key} は行動を持たない`).toBeUndefined();
    }
  });

  it("研鑽は数え（tally）と per か temperStat を持つ", () => {
    for (const d of CARDS.filter((x) => x.card === "temper")) {
      const tallies = (d.rules ?? []).filter((r) => r.then.kind === "tally");
      expect(tallies.length, `${d.key} の数え`).toBeGreaterThan(0);
      const perTally = (d.modifiers ?? []).some((m) => m.per?.count.kind === "tally");
      expect(perTally || d.temperStat !== undefined, `${d.key} の読み手`).toBe(true);
    }
  });

  it("旧 月蝕の 4 種と循環・血の対価は旧 key のまま写し、BOONS がこちらの定義を引く", () => {
    for (const key of ["moonRead", "highTide", "newMoon", "eclipse", "circulation", "bloodMana"] as const) {
      expect(BOONS[key], `${key} は輪廻の定義`).toBe(BOONS_CYCLE[key]);
    }
    expect(BOONS.eclipse.name, "系譜名と重ならない").not.toBe("月蝕");
  });
});

describe("輪廻の札の効果", () => {
  it("満気: 気力が満タンで左の命中なら気の波、満タンでなければ出ない", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "slime", 20);
    state.player.attack.lane = "primary";
    state.player.mana = 0;
    const before = state.projectiles.length;
    fireCard(state, BOONS_CYCLE.fullMana, eventOf(state, "onSwingHit", e));
    expect(state.projectiles.length, "満タンでない").toBe(before);
    state.player.mana = state.stats.maxMana;
    state.time += 1;
    fireCard(state, BOONS_CYCLE.fullMana, eventOf(state, "onSwingHit", e));
    expect(state.projectiles.length, "気の波").toBe(before + 1);
  });

  it("月読: 応手で気力が最大の割合だけ戻り、再使用時間が戻る", () => {
    const state = withStone("whirl");
    const slot = state.skills.slots[0];
    if (!slot) throw new Error("スロットが無い");
    slot.cooldownTotal = COOLDOWN;
    slot.cooldownLeft = COOLDOWN;
    state.player.mana = 0;
    fireCard(state, BOONS_CYCLE.moonRead, eventOf(state, "onRiposte"));
    expect(state.player.mana, "最大気力 × manaRatio").toBeCloseTo(state.stats.maxMana * C.moonRead.manaRatio * state.stats.manaGainMul);
    expect(slot.cooldownLeft, "全長 × refresh 戻す").toBeCloseTo(COOLDOWN * (1 - C.moonRead.refresh));
  });

  it("新月: ダッシュの終わりに直前のスキルを写しで撃ち直す", () => {
    const state = withStone("whirl");
    state.skills.lastCast = { skillKey: "whirl", slot: 0, at: state.skills.clock, pos: { ...state.player.body.pos }, hitIds: new Set() };
    fireCard(state, BOONS_CYCLE.newMoon, eventOf(state, "onDashEnd"));
    expect(state.skills.echoes.length, "写しを積む").toBe(1);
    expect(state.skills.echoes[0]?.params.manaPaid, "気力を払わない").toBe(0);
  });

  it("木霊: 全スロットに刻印符「反響」を足す札", () => {
    expect(BOONS_CYCLE.echoCall.grantsModifier).toBe("echo");
  });

  it("満ち潮: 奥義で全スロットの再使用時間が戻り、気力が満タン", () => {
    const state = withStone("whirl");
    const slot = state.skills.slots[0];
    if (!slot) throw new Error("スロットが無い");
    slot.cooldownTotal = COOLDOWN;
    slot.cooldownLeft = COOLDOWN;
    state.player.mana = 0;
    fireCard(state, BOONS_CYCLE.highTide, eventOf(state, "onBurst"));
    expect(slot.cooldownLeft).toBe(0);
    expect(state.player.mana).toBe(state.stats.maxMana);
  });

  it("循環: スキルの命中で気力が戻り、ICD の中では戻らない", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "slime", 20);
    state.player.mana = 0;
    fireCard(state, BOONS_CYCLE.circulation, eventOf(state, "onSkillHit", e));
    const once = state.player.mana;
    expect(once, "1 回ぶん").toBeCloseTo(C.circulation.mana * state.stats.manaGainMul);
    fireCard(state, BOONS_CYCLE.circulation, eventOf(state, "onSkillHit", e));
    expect(state.player.mana, "ICD の中").toBe(once);
  });

  it("血の対価: 生命が減った間だけ気力コストの倍率が下がる（既存の分岐）", () => {
    const state = cleanArena();
    state.boons.push("bloodMana");
    expect(boonManaCostMul(state), "満タンの生命").toBe(1);
    state.player.hp = 1;
    expect(boonManaCostMul(state), "生命が減った").toBeLessThan(1);
  });

  it("詠: スキルを撃つたび数え、every 回ごとに最大気力 +per", () => {
    const state = cleanArena();
    for (let i = 0; i < C.chantTally.every; i++) fireCard(state, BOONS_CYCLE.chantTally, eventOf(state, "onSkillCast"));
    expect(state.boonRun.tallies[CHANT_TALLY]).toBe(C.chantTally.every);
    const base = foldBoonStats(state.stats, [], state.boonRun).maxMana;
    const grown = foldBoonStats(state.stats, ["chantTally"], state.boonRun).maxMana;
    expect(grown - base, "1 段").toBe(C.chantTally.per);
  });

  it("還: スキルの命中を数え、every につきスキルの与ダメの増", () => {
    const state = cleanArena();
    const e = placeEnemy(state, "slime", 20);
    fireCard(state, BOONS_CYCLE.returnTally, eventOf(state, "onSkillHit", e));
    expect(state.boonRun.tallies[RETURN_TALLY], "命中 1").toBe(1);
    state.boonRun.tallies[RETURN_TALLY] = C.returnTally.every * 2;
    const out = applyModifiers(state, { tags: new Set(["skill"]) }, null, BOONS_CYCLE.returnTally.modifiers);
    expect(out.increased, "2 段").toBeCloseTo(C.returnTally.amount * 2);
    const melee = applyModifiers(state, { tags: new Set(["melee"]) }, null, BOONS_CYCLE.returnTally.modifiers);
    expect(melee.increased, "スキル以外には効かない").toBe(0);
  });

  it("流転: 前の発動で払った気力 ÷ 最大気力が次の発動の倍になり、持っていなければ 1", () => {
    const state = cleanArena();
    expect(flowTurnMul(state, state.stats.maxMana), "持っていない").toBe(1);
    expect(state.boonRun.tallies[FLOW_TURN_TALLY], "数えに触れない").toBeUndefined();
    state.boons.push("flowTurn");
    const half = state.stats.maxMana / 2;
    expect(flowTurnMul(state, half), "1 回目は前の分が無い").toBe(1);
    expect(flowTurnMul(state, 0), "半分払った次は ×(1 + 0.5 × ratio)").toBeCloseTo(1 + 0.5 * C.flowTurn.ratio);
    expect(flowTurnMul(state, 0), "払わなければ次は 1").toBe(1);
    flowTurnMul(state, state.stats.maxMana * 10);
    expect(state.boonRun.tallies[FLOW_TURN_TALLY], "上限 cap").toBe(C.flowTurn.cap);
  });

  it("流転: castSlot の発動が払った気力を次の分として残す", () => {
    const state = cleanArena();
    state.boons.push("flowTurn");
    state.player.mana = state.stats.maxMana;
    expect(castSlot(state, 0, withInput({})), "初期スロットが撃てる").toBe(true);
    const paid = state.stats.maxMana - state.player.mana;
    expect(state.boonRun.tallies[FLOW_TURN_TALLY]).toBeCloseTo(Math.min(C.flowTurn.cap, (paid / state.stats.maxMana) * C.flowTurn.ratio));
  });
});

describe("輪廻の決定性", () => {
  it("同じ seed で同じ札を同じ順に流すと同じ結果", () => {
    const run = (): { mana: number; tallies: Record<string, number>; rng: number } => {
      const state = withStone("whirl", 9);
      const e = placeEnemy(state, "slime", 20);
      state.player.mana = 0;
      for (const key of BOON_KEYS_CYCLE) {
        for (const kind of ["onRiposte", "onSkillHit", "onSkillCast", "onBurst"] as const) fireCard(state, BOONS_CYCLE[key], eventOf(state, kind, e));
      }
      return { mana: state.player.mana, tallies: { ...state.boonRun.tallies }, rng: state.rng.next() };
    };
    expect(run()).toEqual(run());
  });
});
