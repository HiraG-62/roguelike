import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { MILESTONES } from "../loot/provenance";
import { createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import { createEchoUi } from "../ui/echoTab";
import { createInventoryUi } from "../ui/inventory";

/**
 * 描画のスモークテスト。Canvas は呼び出しを数えるだけの偽物にする。
 * 例外が出ないことと、文字を ctx.fillText で直接描いていない（pixelText 経由）ことを確かめる
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

const melee: AffixRoll = { key: "meleeDamagePct", value: 30, nominal: 25, flux: 0.6, color: "crimson", origin: "found" };
const inverted: AffixRoll = { key: "attackSpeed", value: -5, nominal: 10, flux: -1.5, inverted: true, color: "umbra", origin: "found" };
const grown: AffixRoll = { key: "critChance", value: 4, nominal: 4, flux: 0, color: "gold", origin: "bud" };

function makeItem(overrides: Partial<Item> = {}): Item {
  const milestone = MILESTONES[0]?.key ?? "kills:50";
  return {
    id: "item-1",
    seed: 1,
    baseKey: "longsword",
    slot: "weapon",
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

describe("装備画面の描画", () => {
  it("3 タブ・ツールチップ・芽のモーダル・戦闘中の芽を例外なく描き、fillText を直接使わない", async () => {
    const { drawInventoryUi } = await import("./inventoryUi");
    const { drawBudUi } = await import("./budUi");
    const state = createGame(1);
    state.profile.equipment.weapon = makeItem({ id: "worn" });
    addToStash(state.profile, makeItem({ id: "a" }));
    addToStash(state.profile, makeItem({ id: "b", affixes: [], budOffer: null, inscription: undefined }));
    state.pendingBud = {
      itemId: "worn",
      slot: "weapon",
      milestone: "kills:50",
      milestoneLabel: "撃破 50",
      options: [melee, grown],
    };
    const ui = createInventoryUi();
    ui.echo = createEchoUi(createCraftSave());
    ui.open = true;
    const { ctx, calls } = fakeContext();

    ui.hoverItemId = "a";
    drawInventoryUi(ctx, state, ui);
    ui.hoverItemId = "worn";
    ui.hoverSlot = "weapon";
    drawInventoryUi(ctx, state, ui);
    ui.bud.open = true;
    drawInventoryUi(ctx, state, ui);
    ui.tab = "skills";
    drawInventoryUi(ctx, state, ui);
    ui.tab = "echo";
    ui.echo.targetId = "a";
    ui.echo.op = "dye";
    ui.echo.pick = { kind: "trait", index: 0 };
    drawInventoryUi(ctx, state, ui);
    ui.echo.op = "transfer";
    ui.echo.pick = { kind: "inscription" };
    drawInventoryUi(ctx, state, ui);
    state.boons = ["burnSpread"];
    ui.tab = "web";
    for (const cursor of [0, 14, 39]) {
      ui.web.cursor = cursor;
      drawInventoryUi(ctx, state, ui);
    }
    ui.tab = "skills";
    ui.hoverStoneId = state.skills.profile.loadout.find((id) => id !== null) ?? null;
    drawInventoryUi(ctx, state, ui);

    state.paused = false;
    drawBudUi(ctx, state);

    expect(calls.get("fillRect") ?? 0, "何かを描いている").toBeGreaterThan(0);
    expect(calls.get("fillText") ?? 0, "fillText は直接使わない").toBe(0);
  });
});

describe("遺物の「ここに噛む」行", () => {
  it("語が無ければ行を出さず、相手や穴があれば 2 行", async () => {
    const { synergyTipLines } = await import("./inventoryUi");
    const none = { produces: [], consumes: [], fills: [], feeds: [], partners: [] };
    expect(synergyTipLines(none), "語なし").toHaveLength(0);
    const alone = { produces: ["burn" as const], consumes: [], fills: [], feeds: [], partners: [] };
    expect(synergyTipLines(alone), "語はあるが噛む相手なし").toHaveLength(1);
    const meshed = { produces: ["burn" as const], consumes: [], fills: ["burn" as const], feeds: [], partners: ["野火"] };
    expect(synergyTipLines(meshed), "噛む相手と穴").toHaveLength(2);
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
