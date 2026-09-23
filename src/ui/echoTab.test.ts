import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { traitColorOf } from "../loot/colors";
import { CALM_COST, DYE_COST, PARE_COST, STIR_COST, TRANSFER_COST, type EchoOp, type EchoWallet } from "../loot/crafting";
import { createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { createEmptyProvenance, type AffixRoll, type Item, type TraitColor } from "../loot/types";
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

const melee: AffixRoll = { key: "meleeDamagePct", value: 30, nominal: 25, flux: 0.4, color: "crimson", origin: "found" };
const life: AffixRoll = { key: "maxLife", value: 20, nominal: 20, flux: 0.2, color: "jade", origin: "found" };
const grown: AffixRoll = { key: "critChance", value: 4, nominal: 4, flux: 0, color: "gold", origin: "bud" };

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "longsword",
    slot: "weapon",
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

function clickColor(state: State, ui: EchoUi, color: TraitColor): void {
  click(state, ui, layoutEcho(state, ui).colorChips.find((c) => c.color === color)?.rect);
}

function clickExecute(state: State, ui: EchoUi): void {
  click(state, ui, layoutEcho(state, ui).execute);
}

function stashItem(state: State, id: string): Item | undefined {
  return state.profile.stash.find((it) => it.id === id);
}

describe("残響タブ: 状態機械", () => {
  it("対象 → 操作 → 性質 → 実行（鎮め）: 性質の色の残響を払い、揺らぎが半分になる", () => {
    const { state, ui } = setup([makeItem()]);
    expect(echoStep(state, ui), "最初は対象").toBe("target");
    clickRow(state, ui, "item-1");
    expect(echoStep(state, ui), "次は操作").toBe("op");
    clickOp(state, ui, "calm");
    expect(echoStep(state, ui), "次は性質").toBe("trait");
    clickTrait(state, ui, 0);
    expect(echoStep(state, ui), "揃った").toBe("ready");
    clickExecute(state, ui);

    expect(ui.resultOk, ui.result).toBe(true);
    expect(ui.save.echoes.crimson, "紅響を払う").toBe(RICH - CALM_COST);
    const after = stashItem(state, "item-1");
    expect(after?.affixes[0]?.flux, "揺らぎが半分").toBeCloseTo(0.2);
    expect(after?.margin, "余白 -1").toBe(1);
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
    clickOp(state, ui, "pare");
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

  it("染め: 性質のあとに色を選び、その色の残響 3 で置き換える", () => {
    const { state, ui } = setup([makeItem()]);
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "dye");
    clickTrait(state, ui, 0);
    expect(echoStep(state, ui), "色を待つ").toBe("color");
    expect(layoutEcho(state, ui).colorChips, "5 色の選択肢").toHaveLength(5);
    clickColor(state, ui, "azure");
    expect(echoStep(state, ui)).toBe("ready");
    clickExecute(state, ui);
    expect(ui.resultOk, ui.result).toBe(true);
    const dyed = stashItem(state, "item-1")?.affixes[0];
    expect(dyed && traitColorOf(dyed), "蒼に染まる").toBe("azure");
    expect(ui.save.echoes.azure).toBe(RICH - DYE_COST);
  });

  it("削ぎ: 性質が 1 つ消え、選択は外れる", () => {
    const { state, ui } = setup([makeItem()]);
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "pare");
    clickTrait(state, ui, 1);
    clickExecute(state, ui);
    expect(stashItem(state, "item-1")?.affixes.map((r) => r.key)).toEqual([melee.key]);
    expect(ui.save.echoes.jade).toBe(RICH - PARE_COST);
    expect(ui.pick).toBeNull();
  });

  it("煽り: 冥響 2 を払って揺らぎを引き直す", () => {
    const { state, ui } = setup([makeItem()]);
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "stir");
    clickTrait(state, ui, 0);
    clickExecute(state, ui);
    expect(ui.resultOk, ui.result).toBe(true);
    expect(ui.save.echoes.umbra).toBe(RICH - STIR_COST);
    expect(ui.save.counter).toBe(1);
  });

  it("移し: 芽吹いた性質 → 同じ部位の移し先 → 実行。元は消え、受け手が次の対象になる", () => {
    const source = makeItem({ id: "src", affixes: [melee, grown], foundAt: 2 });
    const dest = makeItem({ id: "dst", affixes: [life], foundAt: 1 });
    const gun = makeItem({ id: "gun", slot: "gun", baseKey: "pistol", foundAt: 0 });
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
    state.profile.equipment.weapon = makeItem({ id: "worn" });
    const ids = layoutEcho(state, ui).stash.rows.map((r) => r.item.id);
    expect(ids).toEqual(["stash"]);
  });

  it("操作を押し直すと解除され、結果メッセージは 2 秒で消える", () => {
    const { state, ui } = setup([makeItem()]);
    clickRow(state, ui, "item-1");
    clickOp(state, ui, "calm");
    clickOp(state, ui, "calm");
    expect(ui.op, "もう一度で解除").toBeNull();
    clickExecute(state, ui);
    expect(ui.result.length).toBeGreaterThan(0);
    tickEchoUi(ui, ECHO_RESULT_SECONDS);
    expect(ui.result, "2 秒で消える").toBe("");
  });
});
