import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { STIR_COST, TRANSFER_COST, type EchoOp, type EchoWallet } from "../loot/crafting";
import { createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import {
  ECHO_RESULT_SECONDS,
  type EchoUi,
  createEchoUi,
  echoStep,
  layoutEcho,
  tickEchoUi,
  updateEchoTab,
} from "./echoTab";
import type { Rect } from "./inventoryLayout";

type State = ReturnType<typeof createGame>;

const RICH = 50;

const melee: AffixRoll = { key: "damageVsStaggered", value: 30, nominal: 25, flux: 0.4, color: "crimson", origin: "found" };
const life: AffixRoll = { key: "attr_str", value: 20, nominal: 20, flux: 0.2, color: "jade", origin: "found" };
const grown: AffixRoll = { key: "attr_dex", value: 4, nominal: 4, flux: 0, color: "gold", origin: "bud" };

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
    affixes: [melee, life],
    foundDepth: 10,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 2,
    marginMax: 2,
    milestones: [],
    buds: [],
    budOffer: null,
    ...overrides,
  };
}

function wallet(amount: number): EchoWallet {
  return { crimson: amount, azure: amount, jade: amount, gold: amount, umbra: amount };
}

function setup(items: Item[], echoes: EchoWallet = wallet(RICH)): { state: State; ui: EchoUi } {
  const state = createGame(1);
  state.profile.stash = [];
  for (const item of items) addToStash(state.profile, item);
  const save = createCraftSave();
  save.echoes = echoes;
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

function clickTrait(state: State, ui: EchoUi, index: number): void {
  click(state, ui, layoutEcho(state, ui).traitRows.find((r) => r.index === index)?.rect);
}

function clickExecute(state: State, ui: EchoUi): void {
  click(state, ui, layoutEcho(state, ui).execute);
}

function stashItem(state: State, id: string): Item | undefined {
  return state.profile.stash.find((it) => it.id === id);
}

describe("残響タブ: 状態機械", () => {
  it("対象 → 操作 → 性質 → 実行（煽り）: 冥響を払い、回数が進む", () => {
    const { state, ui } = setup([makeItem()]);
    expect(echoStep(state, ui), "最初は対象").toBe("target");
    clickRow(state, ui, "item-1");
    expect(echoStep(state, ui), "次は操作").toBe("op");
    clickOp(state, ui, "stir");
    expect(echoStep(state, ui), "次は性質").toBe("trait");
    clickTrait(state, ui, 0);
    expect(echoStep(state, ui), "揃った").toBe("ready");
    clickExecute(state, ui);

    expect(ui.resultOk, ui.result).toBe(true);
    expect(ui.save.echoes.umbra, "冥響を払う").toBe(RICH - STIR_COST);
    expect(ui.save.counter, "回数が進む").toBe(1);
    expect(ui.resultTimer, "結果は 2 秒出す").toBe(ECHO_RESULT_SECONDS);
  });

  it("残響が足りなければ拒否し、何も消費しない", () => {
    const { state, ui } = setup([makeItem()], wallet(0));
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "stir");
    clickTrait(state, ui, 0);
    clickExecute(state, ui);
    expect(ui.resultOk, "拒否").toBe(false);
    expect(stashItem(state, "item-1")?.affixes[0], "性質は変わらない").toEqual(melee);
    expect(ui.save.echoes, "残響は減らない").toEqual(wallet(0));
    expect(ui.save.counter, "回数も進まない").toBe(0);
  });

  it("選択が足りないまま実行を押すと、次の手順を出すだけ", () => {
    const { state, ui } = setup([makeItem()]);
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "stir");
    clickExecute(state, ui);
    expect(ui.resultOk).toBe(false);
    expect(stashItem(state, "item-1")?.affixes, "性質は変わらない").toHaveLength(2);
  });

  it("砕く: 対象と操作だけで実行でき、遺物が消えて残響を得る", () => {
    const { state, ui } = setup([makeItem()], wallet(0));
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "shatter");
    expect(echoStep(state, ui)).toBe("ready");
    clickExecute(state, ui);
    expect(stashItem(state, "item-1"), "倉庫から消える").toBeUndefined();
    expect(ui.save.echoes.crimson).toBe(1);
    expect(ui.save.echoes.jade).toBe(1);
    expect(ui.targetId, "対象は外れる").toBeNull();
  });

  it("移し: 芽吹いた性質 → 同じ部位の移し先 → 実行。元は消え、受け手が次の対象になる", () => {
    const source = makeItem({ id: "src", affixes: [melee, grown], foundAt: 2 });
    const dest = makeItem({ id: "dst", affixes: [life], foundAt: 1 });
    const gun = makeItem({ id: "gun", slot: "ring", baseKey: "pistol", foundAt: 0 });
    const { state, ui } = setup([source, dest, gun]);
    clickRow(state, ui, "src");
    clickOp(state, ui, "transfer");
    clickTrait(state, ui, 0);
    expect(echoStep(state, ui), "芽でない性質は移せない").toBe("trait");
    clickTrait(state, ui, 1);
    expect(echoStep(state, ui), "移し先を待つ").toBe("destination");
    clickRow(state, ui, "gun");
    expect(ui.targetId, "別の部位を押すと対象の選び直し").toBe("gun");

    clickRow(state, ui, "src");
    clickTrait(state, ui, 1);
    clickRow(state, ui, "dst");
    expect(echoStep(state, ui)).toBe("ready");
    clickExecute(state, ui);

    expect(ui.resultOk, ui.result).toBe(true);
    expect(stashItem(state, "src"), "元は消える").toBeUndefined();
    expect(stashItem(state, "dst")?.affixes.map((r) => r.key)).toEqual([life.key, grown.key]);
    expect(ui.save.echoes.umbra).toBe(RICH - TRANSFER_COST);
    expect(ui.targetId, "受け手が対象になる").toBe("dst");
  });

  it("装備中の遺物は一覧に出ない（対象にできない）", () => {
    const { state, ui } = setup([makeItem({ id: "stash" })]);
    state.profile.equipment.mainHand = makeItem({ id: "worn" });
    const ids = layoutEcho(state, ui).stash.rows.map((r) => r.item.id);
    expect(ids).toEqual(["stash"]);
  });

  it("操作を押し直すと解除され、結果メッセージは 2 秒で消える", () => {
    const { state, ui } = setup([makeItem()]);
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "stir");
    clickOp(state, ui, "stir");
    expect(ui.op, "もう一度で解除").toBeNull();
    clickExecute(state, ui);
    expect(ui.result.length).toBeGreaterThan(0);
    tickEchoUi(ui, ECHO_RESULT_SECONDS);
    expect(ui.result, "2 秒で消える").toBe("");
  });
});
