import { describe, expect, it } from "vitest";
import {
  ECHO_OPS,
  ECHO_OP_HINT,
  ECHO_OP_LABEL,
  RECALL_COST,
  STIR_COST,
  TRANSFER_COST,
  applyEchoResult,
  convertLegacyWallet,
  craftEcho,
  createEchoWallet,
  echoCost,
  shatterYield,
  type EchoCraftState,
  type EchoRequest,
  type EchoWallet,
} from "./crafting";
import { CRAFT_KEY, createCraftSave, loadCraft, saveCraft } from "./craftingStore";
import { createEmptyProfile, createEmptyProvenance, type AffixRoll, type Item } from "./types";

const RICH = 100;
const MANY = 300;

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function richEchoes(): EchoWallet {
  return { crimson: RICH, azure: RICH, jade: RICH, gold: RICH, umbra: RICH };
}

function state(echoes: EchoWallet = richEchoes()): EchoCraftState {
  return { echoes, counter: 0 };
}

const melee: AffixRoll = { key: "damageVsStaggered", value: 30, nominal: 25, flux: 0.2, color: "crimson", origin: "found" };
const life: AffixRoll = { key: "attr_str", value: 20, nominal: 20, flux: 0, color: "jade", origin: "found" };
const invertedSpeed: AffixRoll = {
  key: "attr_vit",
  value: -5,
  nominal: 10,
  flux: -1.5,
  inverted: true,
  color: "umbra",
  origin: "found",
};
const grown: AffixRoll = { key: "attr_dex", value: 4, nominal: 4, flux: 0, color: "gold", origin: "bud" };

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "longsword",
    slot: "mainHand",
    rarity: "magic",
    itemLevel: 15,
    name: "test",
    implicit: null,
    affixes: [melee, life, invertedSpeed],
    foundDepth: 15,
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

function okItem(result: ReturnType<typeof craftEcho>): Item {
  if (!result.ok || result.item === null) throw new Error(`craft failed: ${result.message}`);
  return result.item;
}

describe("残響の操作", () => {
  it("操作は砕く・注ぎ・移し・呼び戻し・煽りの 5 つ（この順）", () => {
    expect([...ECHO_OPS], "5 つに絞る").toEqual(["shatter", "pour", "transfer", "recall", "stir"]);
  });

  it("どの操作にも表示名と説明があり、費用は砕く・注ぎが無料、他は冥響", () => {
    for (const op of ECHO_OPS) {
      expect(ECHO_OP_LABEL[op].length, `${op} の表示名`).toBeGreaterThan(0);
      expect(ECHO_OP_HINT[op].length, `${op} の説明`).toBeGreaterThan(0);
    }
    const item = makeItem();
    expect(echoCost({ op: "shatter", item })).toBeNull();
    expect(echoCost({ op: "pour", item, target: item })).toBeNull();
    expect(echoCost({ op: "transfer", item, target: item, what: { kind: "inscription" } })).toEqual({ color: "umbra", amount: TRANSFER_COST });
    expect(echoCost({ op: "recall", item, budIndex: 0 })).toEqual({ color: "umbra", amount: RECALL_COST });
    expect(echoCost({ op: "stir", item, traitIndex: 0 })).toEqual({ color: "umbra", amount: STIR_COST });
  });
});

describe("砕く", () => {
  it("性質の色ごとに残響を得る。性質が無ければベースの傾きの色を 1", () => {
    expect(shatterYield(makeItem())).toEqual({ ...createEchoWallet(), crimson: 1, jade: 1, umbra: 1 });
    expect(shatterYield(makeItem({ affixes: [], baseKey: "pistol", slot: "mainHand" }))).toEqual({ ...createEchoWallet(), azure: 1 });
  });

  it("craftEcho で残響が増え、applyEchoResult で stash から消える", () => {
    const profile = createEmptyProfile();
    const item = makeItem();
    profile.stash.push(item);
    const s = state(createEchoWallet());
    const result = craftEcho(s, { op: "shatter", item });
    expect(result.ok).toBe(true);
    expect(s.echoes.crimson).toBe(1);
    expect(s.counter).toBe(1);
    expect(applyEchoResult(profile, result)).toBe(true);
    expect(profile.stash).toEqual([]);
  });
});

describe("共通: 決定性・通貨・拒否", () => {
  it("同じ item.id / counter なら同じ結果", () => {
    const req: EchoRequest = { op: "stir", item: makeItem(), traitIndex: 0 };
    expect(okItem(craftEcho(state(), req))).toEqual(okItem(craftEcho(state(), req)));
  });

  it("通貨不足は拒否し、何も消費しない", () => {
    const s = state(createEchoWallet());
    const result = craftEcho(s, { op: "stir", item: makeItem(), traitIndex: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("insufficient");
    expect(s.counter).toBe(0);
    expect(s.echoes).toEqual(createEchoWallet());
  });

  it("成立しない操作は invalid で、通貨も counter も変わらない", () => {
    const s = state();
    const keystone = makeItem({ affixes: [{ key: "ks_blink", value: 0, color: "umbra" }] });
    const result = craftEcho(s, { op: "stir", item: keystone, traitIndex: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
    expect(s.echoes).toEqual(richEchoes());
    expect(s.counter).toBe(0);
  });
});

describe("煽り", () => {
  it(`冥響 ${STIR_COST} で揺らぎを引き直す。浅い遺物でも反転し得る`, () => {
    const s = state({ ...richEchoes(), umbra: RICH * MANY });
    let inverted = 0;
    let item = makeItem({ foundDepth: 1, itemLevel: 5 });
    for (let i = 0; i < MANY; i++) {
      item = okItem(craftEcho(s, { op: "stir", item, traitIndex: 0 }));
      if (item.affixes[0]?.inverted === true) inverted++;
    }
    expect(inverted).toBeGreaterThan(0);
    expect(s.echoes.umbra).toBe(RICH * MANY - STIR_COST * MANY);
  });

  it("誓約は揺らがない", () => {
    const item = makeItem({ affixes: [{ key: "ks_blink", value: 0, color: "umbra" }] });
    expect(craftEcho(state(), { op: "stir", item, traitIndex: 0 }).ok).toBe(false);
  });
});

describe("移し", () => {
  it(`冥響 ${TRANSFER_COST} で芽吹いた性質を同じ部位の別の遺物へ。元は失われ、受け手の余白を 1 使う`, () => {
    const profile = createEmptyProfile();
    const source = makeItem({ id: "src", affixes: [melee, grown] });
    const target = makeItem({ id: "dst", affixes: [life] });
    profile.stash.push(source, target);
    const s = state();
    const result = craftEcho(s, { op: "transfer", item: source, target, what: { kind: "bud", traitIndex: 1 } });
    const after = okItem(result);
    expect(after.id).toBe("dst");
    expect(after.affixes.map((r) => r.key)).toEqual(["attr_str", "attr_dex"]);
    expect(after.margin).toBe(1);
    expect(s.echoes.umbra).toBe(RICH - TRANSFER_COST);
    expect(applyEchoResult(profile, result)).toBe(true);
    expect(profile.stash.map((it) => it.id)).toEqual(["dst"]);
  });

  it("銘を無銘の遺物へ移せる", () => {
    const source = makeItem({ id: "src", inscription: "見切り", name: "見切り" });
    const target = makeItem({ id: "dst" });
    const after = okItem(craftEcho(state(), { op: "transfer", item: source, target, what: { kind: "inscription" } }));
    expect(after.inscription).toBe("見切り");
    expect(after.name).toBe("見切り");
  });

  it("別の部位・芽でない性質・銘のある受け手は拒否", () => {
    const source = makeItem({ id: "src", affixes: [melee, grown], inscription: "銘" });
    const s = state();
    expect(craftEcho(s, { op: "transfer", item: source, target: makeItem({ id: "g", slot: "ring" }), what: { kind: "bud", traitIndex: 1 } }).ok).toBe(false);
    expect(craftEcho(s, { op: "transfer", item: source, target: makeItem({ id: "d" }), what: { kind: "bud", traitIndex: 0 } }).ok).toBe(false);
    expect(craftEcho(s, { op: "transfer", item: source, target: makeItem({ id: "d", inscription: "既" }), what: { kind: "inscription" } }).ok).toBe(false);
    expect(s.echoes.umbra).toBe(RICH);
  });
});

describe("保存（roguelike.craft.v1）", () => {
  it("round-trip", () => {
    const storage = new MemoryStorage();
    const save = createCraftSave();
    save.echoes.gold = 7;
    save.counter = 3;
    saveCraft(save, storage);
    expect(loadCraft(storage)).toEqual(save);
  });

  it("旧形式（version 1 の dust / shard / essence / relic）は残響へ換算する", () => {
    const storage = new MemoryStorage();
    storage.setItem(CRAFT_KEY, JSON.stringify({ version: 1, wallet: { dust: 3, shard: 1, essence: 1, relic: 1 }, counter: 5 }));
    const loaded = loadCraft(storage);
    // 3*1 + 2 + 4 + 8 = 17 点 → 各色 3、余り 2 は紅・蒼へ
    expect(loaded.echoes).toEqual({ crimson: 4, azure: 4, jade: 3, gold: 3, umbra: 3 });
    expect(loaded).not.toHaveProperty("wallet");
    expect(loaded.counter).toBe(5);
    expect(convertLegacyWallet({ dust: 0, shard: 0, essence: 0, relic: 0 })).toEqual(createEchoWallet());
  });

  it("壊れたデータは空に戻す（負数や非数は 0）", () => {
    const storage = new MemoryStorage();
    storage.setItem(CRAFT_KEY, JSON.stringify({ version: 2, echoes: { crimson: -3, azure: "x" }, counter: Number.NaN }));
    expect(loadCraft(storage)).toEqual(createCraftSave());
    storage.setItem(CRAFT_KEY, "{broken");
    expect(loadCraft(storage)).toEqual(createCraftSave());
  });
});
