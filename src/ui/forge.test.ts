import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { ECHO_OPS, STIR_COST, type EchoWallet } from "../loot/crafting";
import { type CraftSave, createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import { applyStats } from "../system/player";
import { canForgeOp, executeForge, forgePartners, forgeRequest, forgeStep, newForgeSession } from "./forge";
import { createInventoryUi, dispatchMenuAct, menuHits, updateInventoryUi } from "./inventory";
import { openMenu } from "./menuActions";
import { fid } from "./menuFocus";
import { MENU_HOLD_SECONDS } from "./menuInput";
import { EMPTY_INPUT } from "../core/input";
import type { InventoryUi } from "./menuState";

const RICH = 50;
const str: AffixRoll = { key: "attr_str", value: 20, nominal: 20, flux: 0.2, color: "jade", origin: "found" };
const melee: AffixRoll = { key: "damageVsStaggered", value: 30, nominal: 25, flux: 0.4, color: "crimson", origin: "found" };

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "longsword",
    slot: "mainHand",
    rarity: "magic",
    itemLevel: 10,
    name: "試しの剣",
    implicit: null,
    affixes: [melee, str],
    foundDepth: 10,
    foundAt: 0,
    provenance: { ...createEmptyProvenance(), kills: 40 },
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

/** 装備中 1（worn）と倉庫 2（stash-a / stash-b、同じ部位）の state */
function setup(echoes = RICH): { state: GameState; craft: CraftSave } {
  const state = createGame(1);
  state.profile.stash = [];
  state.profile.equipment.mainHand = makeItem({ id: "worn", name: "着ている剣" });
  applyStats(state, computeStats(state.profile.equipment, state.depth));
  addToStash(state.profile, makeItem({ id: "stash-a", name: "倉庫の剣 A" }));
  addToStash(state.profile, makeItem({ id: "stash-b", name: "倉庫の剣 B" }));
  const craft = createCraftSave();
  craft.echoes = wallet(echoes);
  return { state, craft };
}

describe("鍛冶の手続き（forge）", () => {
  it("倉庫の遺物は 5 操作すべての対象になる", () => {
    const { state } = setup();
    for (const op of ECHO_OPS) expect(canForgeOp(state.profile, "stash-a", op), op).toBe(true);
    const partners = forgePartners(state.profile, newForgeSession("stash-a", "pour")).map((it) => it.id);
    expect(partners, "受け手は装備中を先頭に、同じ部位の倉庫").toEqual(["worn", "stash-b"]);
  });

  it("装備中の遺物は煽り・呼び戻しの対象、注ぎ・移しの受け手になり、砕けない", () => {
    const { state } = setup();
    expect(canForgeOp(state.profile, "worn", "shatter"), "砕く").toBe(false);
    for (const op of ["stir", "recall", "pour", "transfer"] as const) expect(canForgeOp(state.profile, "worn", op), op).toBe(true);
    const partners = forgePartners(state.profile, newForgeSession("worn", "transfer")).map((it) => it.id);
    expect(partners, "相手（捧げる側）は倉庫だけ").toEqual(["stash-a", "stash-b"]);
    const session = newForgeSession("worn", "shatter");
    expect(forgeStep(state.profile, session), "砕くは操作の段に戻る").toBe("op");
    expect(forgeRequest(state.profile, session), "依頼にならない").toBeNull();
  });

  it("装備中を受け手にした注ぎは倉庫の遺物を捧げる", () => {
    const { state, craft } = setup();
    const session = newForgeSession("worn", "pour");
    expect(forgeStep(state.profile, session), "相手を選ぶ段").toBe("partner");
    session.partnerId = "stash-a";
    const req = forgeRequest(state.profile, session);
    expect(req?.op === "pour" ? [req.item.id, req.target.id] : null, "捧げる側 → 受け手").toEqual(["stash-a", "worn"]);
    const before = state.profile.equipment.mainHand?.provenance?.kills ?? 0;
    const result = executeForge(state, craft, session);
    expect(result.ok, result.message).toBe(true);
    expect(state.profile.stash.some((it) => it.id === "stash-a"), "捧げた遺物は消える").toBe(false);
    expect(state.profile.equipment.mainHand?.id, "受け手は装備中のまま").toBe("worn");
    expect(state.profile.equipment.mainHand?.provenance?.kills ?? 0, "来歴が注がれる").toBeGreaterThan(before);
    expect(session.partnerId, "相手は外れる").toBeNull();
  });

  it("装備中の遺物を作り替えると能力が畳み直される", () => {
    const { state, craft } = setup();
    const session = newForgeSession("worn", "stir");
    session.pick = { kind: "trait", index: 1 };
    const beforeItem = state.profile.equipment.mainHand;
    const result = executeForge(state, craft, session);
    expect(result.ok, result.message).toBe(true);
    expect(state.profile.equipment.mainHand, "装備中の物が作り替わる").not.toBe(beforeItem);
    expect(craft.echoes.umbra, "冥響を払う").toBe(RICH - STIR_COST);
    // 畳み直し済みなら、今の装備からもう一度畳んでも能力は変わらない（記録の captureLoadout と再生の applyEvent が同じ値を見る）
    const after = JSON.stringify(state.stats);
    applyStats(state, computeStats(state.profile.equipment, state.depth));
    expect(JSON.stringify(state.stats), "装備の変化が能力に畳まれている").toBe(after);
  });

  it("残響が足りないと実行せず知らせを返す", () => {
    const { state, craft } = setup(0);
    const session = newForgeSession("stash-a", "stir");
    session.pick = { kind: "trait", index: 0 };
    const before = JSON.stringify(state.profile);
    const result = executeForge(state, craft, session);
    expect(result.ok, "実行しない").toBe(false);
    expect(result.message.length, "知らせ").toBeGreaterThan(0);
    expect(JSON.stringify(state.profile), "何も変わらない").toBe(before);
    expect(craft.counter, "回数も進まない").toBe(0);
  });

  it("砕くは長押しでだけ実行される", () => {
    const { state, craft } = setup();
    const ui: InventoryUi = createInventoryUi(craft);
    openMenu(state, ui, "attire");
    dispatchMenuAct(state, ui, { kind: "push", view: { kind: "sheet", focus: null, subject: { kind: "item", itemId: "stash-a" }, page: 0, offset: 0, forge: null } });
    dispatchMenuAct(state, ui, { kind: "forgeOp", op: "shatter" });
    const exec = menuHits(state, ui).find((h) => h.id === fid.exec);
    expect(exec?.act, "決定では実行しない").toBeNull();
    expect(exec?.hold?.kind, "長押しで実行").toBe("forgeExecute");
    // 決定を押してすぐ離す → 砕かない
    const top = ui.stack[ui.stack.length - 1];
    if (top === undefined) throw new Error("頁が無い");
    top.focus = fid.exec;
    updateInventoryUi(state, ui, { ...EMPTY_INPUT, confirmPressed: true }, 0.016, { back: false, confirmHeld: true });
    updateInventoryUi(state, ui, EMPTY_INPUT, 0.016, { back: false, confirmHeld: false });
    expect(state.profile.stash.some((it) => it.id === "stash-a"), "短く押しただけでは残る").toBe(true);
    // 押し続ける → 砕く
    updateInventoryUi(state, ui, { ...EMPTY_INPUT, confirmPressed: true }, 0.016, { back: false, confirmHeld: true });
    updateInventoryUi(state, ui, EMPTY_INPUT, MENU_HOLD_SECONDS + 0.05, { back: false, confirmHeld: true });
    expect(state.profile.stash.some((it) => it.id === "stash-a"), "長押しで砕ける").toBe(false);
    expect(ui.stack.some((v) => v.kind === "sheet"), "砕いた物の書付は閉じる").toBe(false);
  });
});
