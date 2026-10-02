import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { createCraftSave } from "../loot/craftingStore";
import { generateItem } from "../loot/generator";
import type { AffixRoll } from "../loot/types";
import { BOON_KEYS, BOONS } from "../system/boonDefs";
import { grantBoon } from "../system/boons";
import { createInventoryUi } from "../ui/inventory";
import { openMenu } from "../ui/menuActions";
import { budgetViolations, censusOfText } from "../ui/menuBudget";
import { fid } from "../ui/menuFocus";
import { HAND_SLOT, type InventoryUi, type MenuView } from "../ui/menuState";

/**
 * スキルの頁・加護の頁の描画のスモーク。Canvas は呼び出しを数えるだけの偽物にする。
 * 例外が出ないことと、文字を ctx.fillText で直接描かないこと、情報の予算（文の行 4・数 0）を確かめる
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

/** 石 0 に反響と収束、手持ちに符、ダッシュの加護とダッシュ系の長靴を持つ state */
function preparedState(): GameState {
  const state = createGame(1);
  const first = state.skills.slots[0];
  const last = state.skills.slots[3];
  if (!first || !last) throw new Error("スロットが無い");
  first.runModifiers = ["echo", "focus"];
  last.runModifiers = [];
  state.skills.hand = ["echo", "echo", "focus", "bloodPrice"];
  const grace = BOON_KEYS.find((k) => BOONS[k].card === "grace" && BOONS[k].action === "dash");
  if (grace === undefined) throw new Error("ダッシュの加護が無い");
  grantBoon(state, grace);
  const roll: AffixRoll = { key: "frostTrail", value: 2, value2: 10, nominal: 2, flux: 0, color: "azure", origin: "found" };
  const base = generateItem(createRng(3), { itemLevel: 1, foundDepth: 1, now: 1 });
  state.profile.equipment.boots = { ...base, id: "dash-boots", slot: "boots", affixes: [roll], namedKey: undefined };
  return state;
}

function openUi(state: GameState): InventoryUi {
  const ui = createInventoryUi(createCraftSave());
  openMenu(state, ui, "attire");
  return ui;
}

/** 焦点ごとの描画の入口（頁を積んで焦点だけ替える） */
function drawWith(view: MenuView, state: GameState, ui: InventoryUi, drawInventoryUi: (ctx: CanvasRenderingContext2D, state: GameState, ui: InventoryUi) => void, ctx: CanvasRenderingContext2D): void {
  ui.stack = [{ kind: "attire", focus: null, anvil: null }, view];
  drawInventoryUi(ctx, state, ui);
}

const SKILL_FOCUSES = [fid.stone(0), fid.stone(3), fid.rune(0, "echo"), fid.hand("echo"), fid.handOpt("sort"), fid.handOpt("keyword"), null];
const ACT_FOCUSES = [fid.grace("burnSpread"), fid.relic("boots"), "empty:1", fid.action("dash"), null];

describe("スキルの頁・加護の頁の描画", () => {
  it("例外なく描き、fillText を直接使わない", async () => {
    const { drawInventoryUi } = await import("./inventoryUi");
    const state = preparedState();
    const ui = openUi(state);
    const { ctx, calls } = fakeContext();
    for (const focus of SKILL_FOCUSES) drawWith({ kind: "skills", focus, lift: null }, state, ui, drawInventoryUi, ctx);
    drawWith({ kind: "skills", focus: fid.col(1), lift: { slot: 0, key: "echo" } }, state, ui, drawInventoryUi, ctx);
    drawWith({ kind: "skills", focus: fid.col(3), lift: { slot: 3, key: "echo" } }, state, ui, drawInventoryUi, ctx);
    drawWith({ kind: "skills", focus: fid.col(1), lift: { slot: HAND_SLOT, key: "echo" } }, state, ui, drawInventoryUi, ctx);
    drawWith({ kind: "skills", focus: fid.hand("focus"), lift: null, hand: { sort: "kind", kind: "shape", keyword: "mana", fitOnly: true } }, state, ui, drawInventoryUi, ctx);
    drawWith({ kind: "skills", focus: null, lift: null, hand: { sort: "name", kind: "reshape", keyword: null, fitOnly: false } }, state, ui, drawInventoryUi, ctx);
    ui.hold = { id: fid.rune(0, "focus"), t: 0.3, by: "key" };
    drawWith({ kind: "skills", focus: fid.rune(0, "focus"), lift: null }, state, ui, drawInventoryUi, ctx);
    ui.hold = null;
    for (const action of ["primary", "secondary", "dash", "skill", "ultimate"] as const) {
      for (const focus of ACT_FOCUSES) drawWith({ kind: "act", focus, action }, state, ui, drawInventoryUi, ctx);
    }
    expect(calls.get("fillRect") ?? 0, "何かを描いている").toBeGreaterThan(0);
    expect(calls.get("fillText") ?? 0, "fillText は直接使わない").toBe(0);
  });

  it("スキルの頁と加護の頁の予算: 文の行 4・数 0", async () => {
    const { captureMenuDraw, drawInventoryUi } = await import("./inventoryUi");
    const state = preparedState();
    const ui = openUi(state);
    const { ctx } = fakeContext();
    const views: { name: string; view: MenuView }[] = [
      ...SKILL_FOCUSES.map((focus) => ({ name: `スキル ${focus}`, view: { kind: "skills", focus, lift: null } as MenuView })),
      { name: "スキル 持ち上げ中", view: { kind: "skills", focus: fid.col(1), lift: { slot: 0, key: "echo" } } },
      { name: "スキル 手持ちを持ち上げ中", view: { kind: "skills", focus: fid.col(1), lift: { slot: HAND_SLOT, key: "echo" } } },
      ...ACT_FOCUSES.map((focus) => ({ name: `加護 ${focus}`, view: { kind: "act", focus, action: "dash" } as MenuView })),
    ];
    for (const { name, view } of views) {
      ui.stack = [{ kind: "attire", focus: null, anvil: null }, view];
      const drawn = captureMenuDraw(() => drawInventoryUi(ctx, state, ui));
      const census = censusOfText(drawn.runs);
      expect(budgetViolations(census), `${name} の予算`).toEqual([]);
      expect(census.numbers, `${name} の数`).toBe(0);
      expect(census.lines, `${name} の文の行`).toBeLessThanOrEqual(4);
      expect(drawn.marks, `${name} は印を数えている`).toBeGreaterThan(0);
    }
  });
});
