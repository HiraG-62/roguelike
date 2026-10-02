import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { createRng } from "../core/rng";
import { AFFIXES, type AffixDef } from "../loot/affixes";
import { basesForSlot } from "../loot/bases";
import { createCraftSave } from "../loot/craftingStore";
import { generateItem } from "../loot/generator";
import type { AffixRoll, Item, Slot } from "../loot/types";
import { stoneFromSeed } from "../skills/generator";
import { addStone, equipStone } from "../skills/persistence";
import { SKILL_KEYS } from "../skills/types";
import { candidateEntries, entryFocusId } from "../ui/candidates";
import { createInventoryUi } from "../ui/inventory";
import { candidatesFor, openMenu } from "../ui/menuActions";
import { budgetViolations, censusOfText } from "../ui/menuBudget";
import type { CandidateTarget, InventoryUi, MenuView } from "../ui/menuState";

/**
 * 候補の頁の描画テスト。Canvas は呼び出しを数えるだけの偽物にし、
 * 例外が出ないこと・fillText を直接使わないこと・候補の情報の予算（文の行 6・BODY 1・数 2・候補 5 枚以下）を確かめる
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

function relic(slot: Slot, id: string, defs: readonly AffixDef[], over: Partial<Item> = {}): Item {
  const base = basesForSlot(slot, 99)[0];
  if (!base) throw new Error(`base missing: ${slot}`);
  const item = generateItem(createRng(1), { baseKey: base.key, plain: true, itemLevel: 5, foundDepth: 5, now: 0 });
  return { ...item, id, name: `${id}の遺物`, foundAt: 1, affixes: defs.map((d) => ({ key: d.key, value: 1 })), budOffer: null, ...over };
}

const bud: AffixRoll = { key: "armorFlat", value: 3, nominal: 3, flux: 0, color: "gold", origin: "found" };

/** 右手・指輪・頭に性質つきの遺物を着せ、頭の倉庫に 7 つ並べた state（2 頁・芽・石を含む） */
function busyState(): GameState {
  const state = createGame(1);
  const ringDefs = AFFIXES.filter((d) => d.slots.includes("ring") && d.keywords !== undefined);
  state.profile.equipment.mainHand = relic("mainHand", "main", ringDefs.slice(0, 3));
  state.profile.equipment.ring = relic("ring", "ring", ringDefs.slice(1, 4));
  state.profile.equipment.head = relic("head", "worn-head", ringDefs.slice(0, 2), { budOffer: { milestone: "kills:50", options: [bud, bud] } });
  state.profile.stash = [];
  for (let i = 0; i < 7; i++) {
    state.profile.stash.push(relic("head", `h${i}`, ringDefs.slice(i, i + 3), { foundAt: 10 + i, namedKey: i === 0 ? "luckyCat" : undefined }));
  }
  state.pendingBud = { itemId: "worn-head", slot: "head", milestone: "kills:50", milestoneLabel: "撃破 50", options: [bud, bud] };
  const profile = state.skills.profile;
  profile.stones = [];
  profile.loadout = [null, null, null, null];
  SKILL_KEYS.slice(0, 4).forEach((skillKey, i) => addStone(profile, stoneFromSeed(30 + i, { skillKey, foundDepth: 1, now: i })));
  const first = profile.stones[0];
  if (first) equipStone(profile, first.id, 0);
  return state;
}

function viewsFor(ui: InventoryUi): MenuView[] {
  const stone: CandidateTarget = { kind: "stone", index: 0 };
  return [
    candidatesFor(ui, "head"),
    candidatesFor(ui, "ring"),
    candidatesFor(ui, "boots"),
    { ...candidatesFor(ui, "head"), target: stone },
    { ...candidatesFor(ui, "head"), target: { kind: "flow", keyword: "burn", verb: "produces" } },
    { ...candidatesFor(ui, "head"), sort: "new" },
    { ...candidatesFor(ui, "head"), sort: "name", offset: 5 },
  ];
}

describe("候補の頁の描画", () => {
  it("全ての札に焦点を置いて例外なく描き、fillText を直接使わない", async () => {
    const { drawInventoryUi } = await import("./inventoryUi");
    const state = busyState();
    const ui = createInventoryUi(createCraftSave());
    openMenu(state, ui, "attire");
    const { ctx, calls } = fakeContext();
    for (const view of viewsFor(ui)) {
      if (view.kind !== "candidates") continue;
      ui.stack = [{ kind: "attire", focus: null, anvil: null }, view];
      for (const entry of candidateEntries(state, view)) {
        view.focus = entryFocusId(entry);
        drawInventoryUi(ctx, state, ui);
      }
      view.focus = null;
      drawInventoryUi(ctx, state, ui);
    }
    expect(calls.get("fillRect") ?? 0, "何かを描いている").toBeGreaterThan(0);
    expect(calls.get("fillText") ?? 0, "fillText は直接使わない").toBe(0);
  });

  it("候補の予算: 文の行 6・BODY 1・数 2・候補 5 枚以下", async () => {
    const { captureMenuDraw, drawInventoryUi } = await import("./inventoryUi");
    const state = busyState();
    const ui = createInventoryUi(createCraftSave());
    openMenu(state, ui, "attire");
    const { ctx } = fakeContext();
    for (const view of viewsFor(ui)) {
      if (view.kind !== "candidates") continue;
      ui.stack = [{ kind: "attire", focus: null, anvil: null }, view];
      for (const entry of candidateEntries(state, view)) {
        view.focus = entryFocusId(entry);
        const drawn = captureMenuDraw(() => drawInventoryUi(ctx, state, ui));
        const census = censusOfText(drawn.runs);
        const shown = candidateEntries(state, view).slice(view.offset, view.offset + 5).length;
        const label = `${view.target.kind} ${view.focus}`;
        expect(budgetViolations({ ...census, candidates: shown }, "compare"), `${label} の予算`).toEqual([]);
        expect(census.bodyLines, `${label} の BODY の行`).toBeLessThanOrEqual(1);
        expect(census.numbers, `${label} の数`).toBeLessThanOrEqual(2);
      }
    }
  });
});
