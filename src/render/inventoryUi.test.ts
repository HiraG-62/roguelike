import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { MILESTONES } from "../loot/provenance";
import { createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import type { GameState } from "../core/state";
import { MENU_BUDGET } from "../data/tuning";
import { crestShape } from "../ui/crestShape";
import { createInventoryUi } from "../ui/inventory";
import { openMenu } from "../ui/menuActions";
import { budgetViolations, censusOfText } from "../ui/menuBudget";
import { fid } from "../ui/menuFocus";
import type { InventoryUi, MenuView } from "../ui/menuState";

/**
 * 描画のスモークテスト。Canvas は呼び出しを数えるだけの偽物にする。
 * 例外が出ないことと、文字を ctx.fillText で直接描いていない（pixelText 経由）こと、装束の情報の予算を確かめる
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

const melee: AffixRoll = { key: "damageVsStaggered", value: 30, nominal: 25, flux: 0.6, color: "crimson", origin: "found" };
const inverted: AffixRoll = { key: "lockdownFury", value: -5, nominal: 10, flux: -1.5, inverted: true, color: "umbra", origin: "found" };
const grown: AffixRoll = { key: "chainSource", value: 4, nominal: 4, flux: 0, color: "gold", origin: "bud" };

function makeItem(overrides: Partial<Item> = {}): Item {
  const milestone = MILESTONES[0]?.key ?? "kills:50";
  return {
    id: "item-1",
    seed: 1,
    baseKey: "longsword",
    slot: "mainHand",
    rarity: "unique",
    itemLevel: 10,
    name: "テストの剣",
    implicit: null,
    affixes: [melee, inverted, grown],
    foundDepth: 10,
    foundAt: 0,
    provenance: { ...createEmptyProvenance(), kills: 12, killsByEnemy: { slime: 12 } },
    margin: 1,
    marginMax: 2,
    milestones: [milestone],
    buds: [],
    budOffer: { milestone, options: [melee, grown] },
    inscription: "見切りのスライム喰らい",
    ...overrides,
  };
}

/** 印（部位・石・行動・系譜・丸印）の上限（docs/ideas/inventory-v2/E-merged.md 4 章。装束: 部位 6 + 石 4 + 系統の点 12 + 丸印 6） */
const ATTIRE_MARKS_MAX = 28;
/** 装束の UI が出す数（見出しの階だけ） */
const ATTIRE_NUMBERS_MAX = 1;

const burnProducer: AffixRoll = { key: "burn", value: 12, value2: 4, nominal: 12, flux: 0, color: "crimson", origin: "found" };

/** 6 部位に性質つきの遺物を着せ、倉庫に新着 1 つと芽を置いた state */
function dressedState(): GameState {
  const state = createGame(1);
  const slots = ["mainHand", "head", "armor", "boots", "ring", "amulet"] as const;
  slots.forEach((slot, i) => {
    state.profile.equipment[slot] = makeItem({ id: `worn-${slot}`, slot, foundAt: i, affixes: [melee, burnProducer, grown] });
  });
  addToStash(state.profile, makeItem({ id: "a", foundAt: 100 }));
  addToStash(state.profile, makeItem({ id: "b", slot: "ring", affixes: [], budOffer: null, inscription: undefined, foundAt: 101 }));
  state.pendingBud = { itemId: "worn-mainHand", slot: "mainHand", milestone: "kills:50", milestoneLabel: "撃破 50", options: [melee, grown] };
  return state;
}

function openUi(state: GameState): InventoryUi {
  const ui = createInventoryUi(createCraftSave());
  openMenu(state, ui, "attire");
  return ui;
}

/** 全ての頁の 1 つずつ（後の段の頁は空実装でも殻が描ける） */
function everyView(state: GameState): MenuView[] {
  const subject = { kind: "item" as const, itemId: "worn-mainHand" };
  return [
    { kind: "attire", focus: fid.part("mainHand"), anvil: null },
    { kind: "attire", focus: fid.part("mainHand"), anvil: { slot: "mainHand", forge: null, offset: 0 } },
    { kind: "crest", focus: null },
    { kind: "candidates", focus: null, target: { kind: "slot", slot: "mainHand" }, sort: "fit", offset: 0, order: null, pinnedId: null },
    { kind: "flow", focus: null, keyword: crestShape(state).rows[0]?.keyword ?? "melee" },
    { kind: "flowBoard", focus: null },
    { kind: "skills", focus: fid.stone(0), lift: null },
    { kind: "act", focus: null, action: "dash" },
    { kind: "sheet", focus: null, subject, page: 0, offset: 0, forge: null },
  ];
}

describe("装備画面の描画", () => {
  it("全ての頁を例外なく描き、fillText を直接使わない", async () => {
    const { drawInventoryUi } = await import("./inventoryUi");
    const { drawBudUi } = await import("./budUi");
    const state = dressedState();
    const ui = openUi(state);
    const { ctx, calls } = fakeContext();
    for (const view of everyView(state)) {
      ui.stack = view.kind === "attire" || view.kind === "crest" ? [view] : [{ kind: "attire", focus: null, anvil: null }, view];
      drawInventoryUi(ctx, state, ui);
    }
    const root = { kind: "attire" as const, focus: null as string | null, anvil: null };
    ui.stack = [root];
    const focuses = [fid.part("ring"), fid.part("offHand"), fid.body, fid.stone(0), fid.stone(3), null, ...crestShape(state).rows.map((r) => fid.mini(r.keyword))];
    for (const focus of focuses) {
      root.focus = focus;
      drawInventoryUi(ctx, state, ui);
    }
    ui.note = { text: "装備した", t: 1 };
    ui.hold = { id: fid.part("ring"), t: 0.3, by: "key" };
    root.focus = fid.part("ring");
    drawInventoryUi(ctx, state, ui);
    state.sandbox = true;
    drawInventoryUi(ctx, state, ui);

    state.sandbox = undefined;
    state.paused = false;
    drawBudUi(ctx, state);

    expect(calls.get("fillRect") ?? 0, "何かを描いている").toBeGreaterThan(0);
    expect(calls.get("fillText") ?? 0, "fillText は直接使わない").toBe(0);
  });

  it("装束の予算: 文の行 4・BODY 1・数 1・印 28 以下", async () => {
    const { captureMenuDraw, drawInventoryUi } = await import("./inventoryUi");
    const state = dressedState();
    const ui = openUi(state);
    const root = ui.stack[0];
    if (root?.kind !== "attire") throw new Error("装束で開いていない");
    const { ctx } = fakeContext();
    const focuses = [fid.part("mainHand"), fid.part("ring"), fid.body, fid.stone(0), ...crestShape(state).rows.map((r) => fid.mini(r.keyword))];
    for (const focus of focuses) {
      root.focus = focus;
      const drawn = captureMenuDraw(() => drawInventoryUi(ctx, state, ui));
      const census = censusOfText(drawn.runs);
      expect(budgetViolations(census), `${focus} の予算`).toEqual([]);
      expect(census.lines, `${focus} の文の行`).toBeLessThanOrEqual(MENU_BUDGET.textLines);
      expect(census.bodyLines, `${focus} の BODY の行（荷札の 1 行目だけ）`).toBe(MENU_BUDGET.bodyLines);
      expect(census.numbers, `${focus} の数`).toBeLessThanOrEqual(ATTIRE_NUMBERS_MAX);
      expect(drawn.marks, `${focus} の印`).toBeLessThanOrEqual(ATTIRE_MARKS_MAX);
      expect(drawn.marks, `${focus} は印を数えている`).toBeGreaterThan(0);
    }
  });
});

describe("祝福カードの語の行と連鎖の表示の描画", () => {
  it("例外なく描き、fillText を直接使わない", async () => {
    const { drawBoonChoice } = await import("./boonUi");
    const { drawChainHud } = await import("./chainUi");
    const state = createGame(1);
    state.boons = ["burnSpread"];
    state.boonChoice = { options: ["burnSpread", "burnSpread", "burnSpread"], hover: 1, curseHover: false, timer: 1, curseTaken: false, curse: null };
    state.chains = [
      { keyword: "burn", depth: 0, time: state.time },
      { keyword: "explode", depth: 1, time: state.time },
      { keyword: "burn", depth: 2, time: state.time },
    ];
    const { ctx, calls } = fakeContext();
    drawBoonChoice(ctx, state);
    drawChainHud(ctx, state);
    expect(calls.get("fillRect") ?? 0, "何かを描いている").toBeGreaterThan(0);
    expect(calls.get("fillText") ?? 0, "fillText は直接使わない").toBe(0);
  });
});
