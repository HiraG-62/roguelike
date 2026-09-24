import { describe, expect, it } from "vitest";
import type { GameState } from "../core/state";
import type { StatusKind } from "../core/status";
import { REACTION_KEYS } from "../core/status";
import { DISCOVERY } from "../data/tuning";
import { COMBOS } from "../skills/combos";
import { stoneFromSeed } from "../skills/generator";
import type { SkillKey } from "../skills/types";
import { createSkillRunState } from "../system/skills";
import { arena } from "../system/testHelpers";
import { hintHash, linkHintCandidates, linkHintText, pickLinkHint, updateLinkHint } from "./linkHint";
import { comboTargets, isComboKey, linkId } from "./links";

/** 状態異常を出す装備（命中時に付ける）を持った arena */
function withProcs(kinds: readonly StatusKind[]): GameState {
  const state = arena(5, { statusProcs: kinds.map((kind) => ({ kind, chance: 1, stacks: 1, duration: 2, potency: 1, on: "any" as const })) });
  // ビルドの語は祝福を畳む前の stats（boonRun.baseStats）から読むので、そちらにも装備を反映する
  state.boonRun.baseStats = state.stats;
  return state;
}

function withSkills(state: GameState, keys: readonly SkillKey[]): void {
  const stones = keys.map((skillKey, i) => stoneFromSeed(200 + i, { foundDepth: 1, now: 0, skillKey }));
  state.skills = createSkillRunState({ version: 1, loadout: stones.map((s) => s.id), stones });
}

/** 反応をすべて既知にした集合（スキルの連携だけを候補に残す） */
function allReactionsKnown(): Set<string> {
  return new Set(REACTION_KEYS.map((k) => linkId("reaction", k)));
}

/** 連携をすべて既知にした集合（反応だけを候補に残す） */
function allCombosKnown(): Set<string> {
  return new Set(Object.keys(COMBOS).filter(isComboKey).map((k) => linkId("combo", k)));
}

function whirl(): SkillKey {
  const target = comboTargets("hookWhirl")[0];
  if (target === undefined) throw new Error("引き回しの後に撃つ石が無い");
  return target;
}

describe("手がかり枠: 候補", () => {
  it("燃焼と冷気を出す装備なら、未発見の蒸発が両側を見せる候補になる", () => {
    const state = withProcs(["burn", "chill"]);
    const cands = linkHintCandidates(state, allCombosKnown());
    expect(cands.find((c) => c.id === "reaction:vaporize")?.shown, "両側").toBe("both");
  });

  it("片方の材料しか出せない反応は、出せる側だけを見せる", () => {
    const state = withProcs(["burn"]);
    const cands = linkHintCandidates(state, allCombosKnown());
    expect(cands.find((c) => c.id === "reaction:vaporize")?.shown, "燃焼（出す側）だけ").toBe("first");
    expect(cands.find((c) => c.id === "reaction:steam")?.shown, "燃焼（食う側）だけ").toBe("second");
  });

  it("発見済みの連携は候補にしない", () => {
    const state = withProcs(["burn", "chill"]);
    const known = allCombosKnown();
    known.add("reaction:vaporize");
    expect(linkHintCandidates(state, known).some((c) => c.id === "reaction:vaporize"), "蒸発は既知").toBe(false);
  });

  it("スキルの連携は後に撃つ石があれば候補、先に撃つ石もあれば両側を見せる", () => {
    const state = arena();
    withSkills(state, [whirl()]);
    const only = linkHintCandidates(state, allReactionsKnown()).find((c) => c.id === "combo:hookWhirl");
    expect(only?.shown, "後の石だけ").toBe("second");
    withSkills(state, ["chainHook", whirl()]);
    const both = linkHintCandidates(state, allReactionsKnown()).find((c) => c.id === "combo:hookWhirl");
    expect(both?.shown, "両方の石").toBe("both");
  });
});

describe("手がかり枠: 選び方", () => {
  const cands = [
    { id: "reaction:vaporize", shown: "first" as const },
    { id: "reaction:steam", shown: "both" as const },
    { id: "reaction:quench", shown: "both" as const },
  ];

  it("両側を見せられる候補を優先し、シードと階が同じなら同じ 1 件を選ぶ", () => {
    const a = pickLinkHint(cands, 42, 3);
    expect(a?.shown, "両側の候補から").toBe("both");
    expect(pickLinkHint(cands, 42, 3), "決定的").toEqual(a);
    expect(hintHash(42, 3), "ハッシュも決定的").toBe(hintHash(42, 3));
    expect(pickLinkHint([], 42, 3), "候補が無ければ null").toBeNull();
  });

  it("階が変わると選び直し、見直しはゲームの乱数を動かさない", () => {
    const a = withProcs(["burn", "chill", "shock", "poison", "bleed"]);
    const b = withProcs(["burn", "chill", "shock", "poison", "bleed"]);
    a.tick = 0;
    updateLinkHint(a);
    const first = a.codexRun.links.hint;
    expect(first?.depth, "今の階で選ぶ").toBe(a.depth);
    a.depth += 1;
    a.tick = 1;
    a.time = 5;
    updateLinkHint(a);
    expect(a.codexRun.links.hint?.depth, "階が変わると選び直す").toBe(a.depth);
    expect(a.rng.next(), "乱数列がそろう").toBe(b.rng.next());
  });

  it("見直しの間隔の間は選び直さない", () => {
    const state = withProcs(["burn", "chill"]);
    state.tick = DISCOVERY.hintRefreshTicks;
    updateLinkHint(state);
    const hint = state.codexRun.links.hint;
    state.codexRun.links.known.add(hint?.id ?? "");
    state.tick += 1;
    updateLinkHint(state);
    expect(state.codexRun.links.hint, "間隔の途中は同じ").toBe(hint);
  });
});

describe("手がかり枠: 文面", () => {
  it("反応は材料を + でつなぎ、伏せた側を「？」にする", () => {
    expect(linkHintText({ id: "reaction:vaporize", shown: "both" }), "結果を伏せる").toBe("燃焼 + 冷気 → ？");
    expect(linkHintText({ id: "reaction:vaporize", shown: "first" }), "食う側を伏せる").toBe("燃焼 + ？");
    expect(linkHintText({ id: "reaction:noSuch", shown: "both" }), "引けなければ空").toBe("");
  });

  it("スキルの連携は撃つ順に → でつなぐ", () => {
    expect(linkHintText({ id: "combo:hookWhirl", shown: "second" }).startsWith("？ → "), "先の石を伏せる").toBe(true);
    expect(linkHintText({ id: "combo:hookWhirl", shown: "both" }).endsWith(" = ？"), "結果を伏せる").toBe(true);
  });
});
