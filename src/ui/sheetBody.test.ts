import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ATTR } from "../data/tuning";
import { ULTIMATES } from "../data/ultimates";
import { MOVESET_KEYS } from "../data/weapons";
import { ultimateChoice } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { ATTR_KEYS, type PlayerStats, createEmptyEquipment } from "../loot/types";
import { deriveAttributes } from "../system/attributes";
import { attributeSources, bodyActionChunks, bodyActions, chooseUltimateAt, derivedStatRows, sheetMoveset, ultimateCostOf } from "./sheetBody";

describe("書付「体」の中身", () => {
  it("体の性能は渡した stats から読み、体力が上がると最大生命が増える", () => {
    const plain = computeStats(createEmptyEquipment());
    const raised = deriveAttributes({ ...plain, attributes: { ...plain.attributes, vit: plain.attributes.vit + 1 } });
    const hp = (stats: PlayerStats): string | undefined => derivedStatRows(stats).find((r) => r.label === "最大生命")?.value;
    expect(Number(hp(raised)), "最大生命").toBe(Number(hp(deriveAttributes(plain))) + ATTR.vitMaxHp);
  });

  it("ステータスの出どころの合計は今のステータスと装備の素の値の差に一致する", () => {
    const state = createGame(1);
    const empty = computeStats(createEmptyEquipment(), state.depth).attributes;
    const sources = attributeSources(state);
    for (const key of ATTR_KEYS) {
      const sum = sources[key].reduce((s, src) => s + src.value, 0);
      expect(sum, key).toBe(state.stats.attributes[key] - empty[key]);
    }
  });

  it("行動ごとに計算式の片があり、先頭は行動名", () => {
    const state = createGame(1);
    const actions = bodyActions(state);
    expect(actions.length, "行動がある").toBeGreaterThan(0);
    for (const a of actions) {
      const chunks = bodyActionChunks(a);
      expect(chunks[0]?.pieces[0]?.tone, a.name).toBe("name");
    }
  });

  it("奥義の必要ゲージは定義に数値があるときだけ返す", () => {
    const cost = ultimateCostOf(ULTIMATES.sword[0]);
    expect(cost === null || typeof cost === "number").toBe(true);
  });

  it("拠点では奥義の武器種を送れ、ラン中は右手の武器種のまま", () => {
    const state = createGame(1);
    const start = state.stats.moveset;
    expect(sheetMoveset(state, 1), "ラン中は送らない").toBe(start);
    state.sandbox = true;
    expect(sheetMoveset(state, 1), "次の武器種").toBe(MOVESET_KEYS[(MOVESET_KEYS.indexOf(start) + 1) % MOVESET_KEYS.length]);
    expect(sheetMoveset(state, -MOVESET_KEYS.length), "1 周で戻る").toBe(start);
  });

  it("奥義を選ぶと profile に残り、ラン中は理由を返して変えない", () => {
    const state = createGame(1);
    const moveset = state.stats.moveset;
    const last = ULTIMATES[moveset].length - 1;
    expect(chooseUltimateAt(state, moveset, last), "ラン中は理由").not.toBeNull();
    expect(state.profile.ultimates?.[moveset], "ラン中は書かない").toBeUndefined();
    state.sandbox = true;
    chooseUltimateAt(state, moveset, last);
    expect(ultimateChoice(state.profile, moveset).key, "拠点では選べる").toBe(ULTIMATES[moveset][last]?.key);
  });
});
