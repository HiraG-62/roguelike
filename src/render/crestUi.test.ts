import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { MENU_BUDGET } from "../data/tuning";
import { createCraftSave } from "../loot/craftingStore";
import { generateItem } from "../loot/generator";
import type { AffixRoll } from "../loot/types";
import { generateSkillStone } from "../skills/generator";
import { addStone, equipStone } from "../skills/persistence";
import { BOON_KEYS } from "../system/boonDefs";
import { crestShape } from "../ui/crestShape";
import { createInventoryUi, menuHits } from "../ui/inventory";
import { openMenu } from "../ui/menuActions";
import { budgetViolations, censusOfText } from "../ui/menuBudget";
import { fid } from "../ui/menuFocus";
import type { InventoryUi, MenuView } from "../ui/menuState";

/**
 * 紋の面・系統の頁・系統を選ぶ盤の描画テスト。Canvas は呼び出しを数えるだけの偽物にする。
 * 例外が出ないことと fillText を直接使わないこと、情報の予算（文の行・数）を確かめる
 */

interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  calls: Map<string, number>;
}

function fakeContext(): FakeCtx {
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

const burn: AffixRoll = { key: "burn", value: 12, value2: 4, nominal: 12, flux: 0, color: "crimson", origin: "found" };

/** 遺物・石・祝福がそろった state（帯 4 + 伏流 2、畳んだ珠、描けない系統、加護・系譜・芯あり） */
function richState(): GameState {
  const state = createGame(1);
  state.profile.equipment.mainHand = { ...generateItem(createRng(7), { itemLevel: 1, foundDepth: 1, now: 100 }), id: "worn-main", slot: "mainHand", affixes: [burn], namedKey: undefined };
  const stone = generateSkillStone(createRng(9), { foundDepth: 4, now: 123 });
  addStone(state.skills.profile, stone);
  equipStone(state.skills.profile, stone.id, 1);
  state.boons = BOON_KEYS.slice(0, 60);
  return state;
}

function openWith(state: GameState, stack: MenuView[]): InventoryUi {
  const ui = createInventoryUi(createCraftSave());
  openMenu(state, ui, "attire");
  ui.stack = stack;
  return ui;
}

describe("紋の面の描画", () => {
  it("紋・系統の頁・系統を選ぶ盤を例外なく描き、fillText を直接使わない", async () => {
    const { drawInventoryUi } = await import("./inventoryUi");
    const { ctx, calls } = fakeContext();
    for (const state of [createGame(1), richState()]) {
      const rows = crestShape(state).rows;
      const crest = openWith(state, [{ kind: "crest", focus: null }]);
      for (const hit of menuHits(state, crest)) {
        const root = crest.stack[0];
        if (root === undefined) throw new Error("積み重ねが空");
        root.focus = hit.id;
        drawInventoryUi(ctx, state, crest);
      }
      for (const row of rows) {
        const flow: MenuView = { kind: "flow", focus: null, keyword: row.keyword };
        const ui = openWith(state, [{ kind: "crest", focus: fid.band(row.keyword) }, flow]);
        for (const hit of menuHits(state, ui)) {
          flow.focus = hit.id;
          drawInventoryUi(ctx, state, ui);
        }
      }
      const board: MenuView = { kind: "flowBoard", focus: null };
      const ui = openWith(state, [{ kind: "crest", focus: null }, board]);
      for (const hit of menuHits(state, ui)) {
        board.focus = hit.id;
        drawInventoryUi(ctx, state, ui);
      }
    }
    expect(calls.get("fillRect") ?? 0, "何かを描いている").toBeGreaterThan(0);
    expect(calls.get("fillText") ?? 0, "fillText は直接使わない").toBe(0);
  });

  it("紋の予算: 文の行 4・数 1 以下", async () => {
    const { captureMenuDraw, drawInventoryUi } = await import("./inventoryUi");
    const { ctx } = fakeContext();
    for (const state of [createGame(1), richState()]) {
      const ui = openWith(state, [{ kind: "crest", focus: null }]);
      const shape = crestShape(state);
      expect(shape.rows.filter((r) => !r.undercurrent).length, "段の立った帯").toBeLessThanOrEqual(MENU_BUDGET.bands.stepped);
      expect(shape.rows.filter((r) => r.undercurrent).length, "伏流の帯").toBeLessThanOrEqual(MENU_BUDGET.bands.undercurrent);
      for (const hit of menuHits(state, ui)) {
        const root = ui.stack[0];
        if (root === undefined) throw new Error("積み重ねが空");
        root.focus = hit.id;
        const census = censusOfText(captureMenuDraw(() => drawInventoryUi(ctx, state, ui)).runs);
        expect(budgetViolations(census), `${hit.id} の予算`).toEqual([]);
        expect(census.lines, `${hit.id} の文の行`).toBeLessThanOrEqual(MENU_BUDGET.textLines);
        expect(census.numbers, `${hit.id} の数`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("系統の頁の予算: 文の行 4・数 0", async () => {
    const { captureMenuDraw, drawInventoryUi } = await import("./inventoryUi");
    const { ctx } = fakeContext();
    for (const state of [createGame(1), richState()]) {
      for (const row of crestShape(state).rows) {
        const flow: MenuView = { kind: "flow", focus: null, keyword: row.keyword };
        const ui = openWith(state, [{ kind: "crest", focus: fid.band(row.keyword) }, flow]);
        for (const hit of menuHits(state, ui)) {
          flow.focus = hit.id;
          const census = censusOfText(captureMenuDraw(() => drawInventoryUi(ctx, state, ui)).runs);
          expect(budgetViolations(census), `${row.keyword} ${hit.id} の予算`).toEqual([]);
          expect(census.lines, `${row.keyword} ${hit.id} の文の行`).toBeLessThanOrEqual(MENU_BUDGET.textLines);
          expect(census.numbers, `${row.keyword} ${hit.id} の数`).toBe(0);
        }
      }
    }
  });
});
