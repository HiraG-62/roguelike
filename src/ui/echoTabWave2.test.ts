import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { ECHO_OPS, RECALL_COST, type EchoOp, type EchoWallet } from "../loot/crafting";
import { createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import { ECHO_BUTTON_COLUMNS, type EchoUi, createEchoUi, echoStep, layoutEcho, updateEchoTab } from "./echoTab";
import { CONTENT_BOTTOM, type Rect } from "./inventoryLayout";

/** 残響タブの第 2 弾の操作（脱色・呼び戻し・注ぎ・鍛え直し・張り）の画面の流れ */

type State = ReturnType<typeof createGame>;

const RICH = 50;
const budA: AffixRoll = { key: "meleeDamagePct", value: 10, nominal: 10, flux: 0, color: "crimson", origin: "bud" };
const budB: AffixRoll = { key: "maxLife", value: 10, nominal: 10, flux: 0, color: "jade", origin: "bud" };
const crushing: AffixRoll = { key: "crushing", value: 40, value2: 10, nominal: 40, nominal2: 10, flux: 0, origin: "found" };

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "longsword",
    slot: "mainHand",
    rarity: "magic",
    itemLevel: 10,
    name: "test",
    implicit: null,
    affixes: [crushing, budA],
    foundDepth: 10,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 2,
    marginMax: 2,
    milestones: [],
    buds: [{ milestone: "kills:50", options: [budA, budB], chosen: 0 }],
    budOffer: null,
    ...overrides,
  };
}

function wallet(amount: number): EchoWallet {
  return { crimson: amount, azure: amount, jade: amount, gold: amount, umbra: amount };
}

function setup(items: Item[]): { state: State; ui: EchoUi } {
  const state = createGame(1);
  state.profile.stash = [];
  for (const item of items) addToStash(state.profile, item);
  const save = createCraftSave();
  save.echoes = wallet(RICH);
  return { state, ui: createEchoUi(save) };
}

function click(state: State, ui: EchoUi, rect: Rect | undefined | null): void {
  if (!rect) throw new Error("rect missing");
  const input: FrameInput = { ...EMPTY_INPUT, clickPressed: true, aimScreen: { x: rect.x + 1, y: rect.y + 1 } };
  updateEchoTab(state, ui, input);
}

function clickRow(state: State, ui: EchoUi, id: string): void {
  click(state, ui, layoutEcho(state, ui).stash.rows.find((r) => r.item.id === id)?.rect);
}

function clickOp(state: State, ui: EchoUi, op: EchoOp): void {
  click(state, ui, layoutEcho(state, ui).buttons.find((b) => b.op === op)?.rect);
}

function stashItem(state: State, id: string): Item | undefined {
  return state.profile.stash.find((it) => it.id === id);
}

describe("操作ボタンの配置", () => {
  it(`${ECHO_OPS.length} 操作が ${ECHO_BUTTON_COLUMNS} 列に収まり、実行ボタンが内容の下端より上にある`, () => {
    const { state, ui } = setup([makeItem()]);
    const layout = layoutEcho(state, ui);
    expect(layout.buttons.length).toBe(ECHO_OPS.length);
    for (const op of ["bleach", "recall", "pour", "reforge", "tension"] as const) {
      expect(layout.buttons.some((b) => b.op === op), op).toBe(true);
    }
    expect(layout.execute.y + layout.execute.h).toBeLessThan(CONTENT_BOTTOM);
  });
});

describe("呼び戻し", () => {
  it("対象 → 呼び戻し → 過去の芽 → 実行で入れ替わり、冥響を払う", () => {
    const { state, ui } = setup([makeItem()]);
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "recall");
    expect(echoStep(state, ui)).toBe("bud");
    const layout = layoutEcho(state, ui);
    expect(layout.traitRows.length, "呼び戻し中は性質の行を出さない").toBe(0);
    click(state, ui, layout.budRows[0]?.rect);
    expect(echoStep(state, ui)).toBe("ready");
    click(state, ui, layoutEcho(state, ui).execute);
    const after = stashItem(state, "item-1");
    expect(after?.affixes.map((r) => r.key)).toEqual(["crushing", "maxLife"]);
    expect(after?.buds?.[0]?.recalled).toBe(true);
    expect(ui.save.echoes.umbra).toBe(RICH - RECALL_COST);
    expect(ui.pick, "選び直してもらう").toBeNull();
  });
});

describe("注ぎ", () => {
  it("対象 → 注ぎ → 受け取る遺物 → 実行で来歴が移り、捧げた遺物は消える", () => {
    const source = makeItem({ id: "src", provenance: { ...createEmptyProvenance(), kills: 40 } });
    const target = makeItem({ id: "dst", buds: [] });
    const ring = makeItem({ id: "ring", slot: "ring", baseKey: "ironRing", buds: [] });
    const { state, ui } = setup([source, target, ring]);
    clickRow(state, ui, "src");
    clickOp(state, ui, "pour");
    expect(echoStep(state, ui)).toBe("destination");
    clickRow(state, ui, "ring");
    expect(ui.targetId, "部位が違う遺物は注ぎ先にならず、対象が変わる").toBe("ring");
    clickRow(state, ui, "src");
    clickRow(state, ui, "dst");
    expect(echoStep(state, ui)).toBe("ready");
    click(state, ui, layoutEcho(state, ui).execute);
    expect(stashItem(state, "src")).toBeUndefined();
    expect(stashItem(state, "dst")?.provenance?.kills).toBe(20);
    expect(ui.targetId, "受け手が新しい対象になる").toBe("dst");
  });
});

describe("張り・脱色", () => {
  it("張り: 代償付きの性質を選んで実行", () => {
    const { state, ui } = setup([makeItem()]);
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "tension");
    click(state, ui, layoutEcho(state, ui).traitRows[0]?.rect);
    click(state, ui, layoutEcho(state, ui).execute);
    expect(stashItem(state, "item-1")?.affixes[0]?.tensed).toBe(true);
  });

  it("脱色: 性質が無色になる", () => {
    const { state, ui } = setup([makeItem()]);
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "bleach");
    click(state, ui, layoutEcho(state, ui).traitRows[1]?.rect);
    click(state, ui, layoutEcho(state, ui).execute);
    expect(stashItem(state, "item-1")?.affixes[1]?.colorless).toBe(true);
  });
});
