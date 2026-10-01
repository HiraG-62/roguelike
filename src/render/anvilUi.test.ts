import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { MENU_BUDGET } from "../data/tuning";
import { createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import { ANVIL_FOCUS } from "../ui/anvil";
import { createInventoryUi, dispatchMenuAct, menuHits } from "../ui/inventory";
import { openMenu } from "../ui/menuActions";
import { budgetViolations, censusOfText } from "../ui/menuBudget";
import { fid } from "../ui/menuFocus";
import type { InventoryUi, MenuAct, ViewOf } from "../ui/menuState";

/**
 * 金床の構えの描画のスモークテスト。Canvas は呼び出しを数えるだけの偽物にする。
 * 例外が出ないことと、文字を ctx.fillText で直接描いていない（pixelText 経由）こと、情報の予算を確かめる
 */

function fakeContext(): { ctx: CanvasRenderingContext2D; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const target: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === "measureText") return () => ({ width: 8 });
      if (prop === "getTransform") return () => ({ a: 1, d: 1, e: 0, f: 0 });
      if (prop === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      return (..._args: unknown[]) => {
        const name = String(prop);
        calls.set(name, (calls.get(name) ?? 0) + 1);
      };
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext().ctx }),
    fonts: { check: () => true, load: () => Promise.resolve([]) },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const melee: AffixRoll = { key: "damageVsStaggered", value: 30, nominal: 25, flux: 0.6, color: "crimson", origin: "found" };
const str: AffixRoll = { key: "attr_str", value: 20, nominal: 20, flux: 0.2, color: "jade", origin: "found" };

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

/** 6 部位に着せ、倉庫に右手 7 つ（頁送りが出る）を置いた鍛冶屋の画面 */
function anvilScene(): { state: GameState; ui: InventoryUi; root: ViewOf<"attire"> } {
  const state = createGame(1);
  state.sandbox = true;
  state.profile.stash = [];
  for (const slot of ["mainHand", "head", "armor", "boots", "ring", "amulet"] as const) {
    state.profile.equipment[slot] = makeItem({ id: `worn-${slot}`, slot, name: `着ている ${slot}` });
  }
  for (let i = 0; i < 7; i++) addToStash(state.profile, makeItem({ id: `s-${i}`, name: `倉庫の剣 ${i}`, foundAt: i }));
  const ui = createInventoryUi(createCraftSave());
  ui.craft.echoes = { crimson: 12, azure: 0, jade: 99, gold: 3, umbra: 30 };
  openMenu(state, ui, "anvil");
  const root = ui.stack[0];
  if (root?.kind !== "attire") throw new Error("装束で開いていない");
  return { state, ui, root };
}

function act(state: GameState, ui: InventoryUi, id: string): void {
  const hit = menuHits(state, ui).find((h) => h.id === id);
  const a: MenuAct | null | undefined = hit?.act;
  if (a === null || a === undefined) throw new Error(`決定が無い: ${id}`);
  dispatchMenuAct(state, ui, a);
}

describe("金床の構えの描画", () => {
  it("全ての段を例外なく描き、fillText を直接使わない", async () => {
    const { drawInventoryUi } = await import("./inventoryUi");
    const { state, ui, root } = anvilScene();
    const { ctx, calls } = fakeContext();
    const draw = (): void => drawInventoryUi(ctx, state, ui);
    draw();
    root.focus = fid.part("ring");
    draw();
    act(state, ui, fid.part("mainHand"));
    draw();
    act(state, ui, fid.tg("s-1"));
    draw();
    act(state, ui, fid.op("pour"));
    draw();
    act(state, ui, fid.partner("worn-mainHand"));
    draw();
    act(state, ui, fid.op("shatter"));
    root.focus = fid.exec;
    ui.hold = { id: fid.exec, t: 0.3, by: "key" };
    draw();
    ui.note = { text: "砕いた", t: 1 };
    draw();
    expect(calls.get("fillRect") ?? 0, "何かを描いている").toBeGreaterThan(0);
    expect(calls.get("fillText") ?? 0, "fillText は直接使わない").toBe(0);
  });

  it("金床の予算: 文の行 4・数 1 以下", async () => {
    const { captureMenuDraw, drawInventoryUi } = await import("./inventoryUi");
    const { state, ui, root } = anvilScene();
    const { ctx } = fakeContext();
    const check = (label: string): void => {
      const drawn = captureMenuDraw(() => drawInventoryUi(ctx, state, ui));
      const census = censusOfText(drawn.runs);
      expect(budgetViolations(census), `${label} の予算`).toEqual([]);
      expect(census.lines, `${label} の文の行`).toBeLessThanOrEqual(MENU_BUDGET.textLines);
      expect(census.numbers, `${label} の数`).toBeLessThanOrEqual(1);
    };
    for (const focus of [fid.part("mainHand"), fid.part("head"), ANVIL_FOCUS.pot("jade"), ANVIL_FOCUS.pot("azure")]) {
      root.focus = focus;
      check(`部位の段 ${focus}`);
    }
    act(state, ui, fid.part("mainHand"));
    check("札の段");
    root.focus = ANVIL_FOCUS.next;
    check("頁送り");
    act(state, ui, fid.tg("worn-mainHand"));
    for (const op of ["pour", "transfer", "recall", "stir"] as const) {
      root.focus = fid.op(op);
      check(`操作 ${op}`);
    }
    act(state, ui, fid.op("pour"));
    check("相手の段");
    act(state, ui, fid.partner("s-0"));
    check("実行の段");
    act(state, ui, fid.op("stir"));
    check("選ぶ行の段");
    act(state, ui, fid.trait(0));
    check("煽りの実行の段");
    ui.note = { text: "煽り  性質の揺らぎ 中 → 上", t: 1 };
    check("結果の知らせ");
  });
});
