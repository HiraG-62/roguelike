import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { FrameInput } from "../core/input";
import type { Keyword } from "../core/keywords";
import { createRng } from "../core/rng";
import { type GameState } from "../core/state";
import { AFFIXES, type AffixDef } from "../loot/affixes";
import { basesForSlot } from "../loot/bases";
import { createCraftSave } from "../loot/craftingStore";
import { generateItem } from "../loot/generator";
import { loadProfile } from "../loot/profile";
import { MILESTONES, findPendingBud } from "../loot/provenance";
import type { AffixRoll, Item, Slot } from "../loot/types";
import { MemoryStorage } from "../meta/testStorage";
import { setSaveStorage } from "../save/backend";
import { SKILL_DEFS } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { addStone, equipStone, stoneInSlot } from "../skills/persistence";
import { SKILL_KEYS } from "../skills/types";
import { RESONANCE_EXCLUDED } from "../system/resonance";
import { withInput } from "../system/testHelpers";
import { CANDIDATE_PAGE, CANDIDATES_VIEW, MINI_PART, MINI_PARTS, candidateEntries, entryFocusId, filterAvailable, nextFilter, sortedIds, subjectId, subjectKeywords } from "./candidates";
import { createInventoryUi, updateInventoryUi } from "./inventory";
import { candidatesFor } from "./menuActions";
import { fid } from "./menuFocus";
import { MENU_HOLD_SECONDS } from "./menuInput";
import { type InventoryUi, type MenuView, NO_FILTER, type ViewOf, topView } from "./menuState";
import { isUnseen } from "./seen";
import { tryOn, tryOnBase } from "./tryOn";

const DT = 1 / 60;
/** 合の並び 400 件の許容（16ms の目安の数倍。毎フレームではなく開いた 1 回だけの計算） */
const PERF_LIMIT_MS = 200;

beforeEach(() => {
  setSaveStorage(new MemoryStorage());
});
afterEach(() => {
  setSaveStorage(null);
});

function frame(state: GameState, ui: InventoryUi, input: Partial<FrameInput> = {}, confirmHeld = false): void {
  updateInventoryUi(state, ui, withInput(input), DT, { back: false, confirmHeld });
}

/** 装備画面を開いて、その部位の候補を積む */
function openCandidates(state: GameState, view: MenuView): InventoryUi {
  const ui = createInventoryUi(createCraftSave());
  frame(state, ui, { inventoryPressed: true });
  ui.stack.push(view);
  return ui;
}

function topCandidates(ui: InventoryUi): ViewOf<"candidates"> {
  const top = topView(ui);
  if (top?.kind !== "candidates") throw new Error("候補の頁が積まれていない");
  return top;
}

/** 部位 slot の素の遺物（性質なし）。id・foundAt などは付け直す */
function relic(slot: Slot, id: string, over: Partial<Item> = {}): Item {
  const base = basesForSlot(slot, 99)[0];
  if (!base) throw new Error(`base missing: ${slot}`);
  const item = generateItem(createRng(1), { baseKey: base.key, plain: true, itemLevel: 5, foundDepth: 5, now: 0 });
  return { ...item, id, name: id, foundAt: 1, foundDepth: 1, affixes: [], budOffer: null, ...over };
}

function withAffixes(slot: Slot, id: string, defs: readonly AffixDef[], over: Partial<Item> = {}): Item {
  return relic(slot, id, { affixes: defs.map((d) => ({ key: d.key, value: 1 })), ...over });
}

function plainState(): GameState {
  const state = createGame(1);
  state.profile.stash = [];
  state.profile.equipment = { mainHand: null, offHand: null, head: null, armor: null, boots: null, ring: null, amulet: null };
  state.profile.meta.seenAt = {};
  return state;
}

function ids(ui: InventoryUi, state: GameState): string[] {
  return candidateEntries(state, topCandidates(ui)).map(entryFocusId);
}

describe("候補の頁", () => {
  it("部位の倉庫だけを 5 枚ずつ並べ、端で送ると次の 5 枚", () => {
    const state = plainState();
    for (let i = 0; i < 7; i++) state.profile.stash.push(relic("head", `h${i}`, { foundAt: 10 + i }));
    state.profile.stash.push(relic("ring", "r0"));
    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "head"));
    const view = topCandidates(ui);
    const hits = CANDIDATES_VIEW.layout(state, ui, view);
    const cards = hits.filter((h) => h.id.startsWith("c:"));
    expect(cards, "1 頁は 5 枚").toHaveLength(CANDIDATE_PAGE);
    expect(ids(ui, state).some((id) => id === fid.cand("r0")), "ほかの部位の物は並ばない").toBe(false);
    expect(ids(ui, state), "頭の倉庫 7 つ").toHaveLength(7);

    const last = cards[cards.length - 1];
    if (!last) throw new Error("札が無い");
    view.focus = last.id;
    frame(state, ui, { move: { x: 0, y: 1 } });
    expect(view.offset, "端で下へ押すと次の 5 枚").toBe(CANDIDATE_PAGE);
    const next = CANDIDATES_VIEW.layout(state, ui, view).filter((h) => h.id.startsWith("c:"));
    expect(next, "次の頁は残りの 2 枚").toHaveLength(2);
    expect(view.focus, "新しい頁の先頭の札に焦点").toBe(next[0]?.id);

    frame(state, ui, { move: { x: 0, y: 0 } });
    frame(state, ui, { move: { x: 0, y: -1 } });
    expect(view.offset, "上へ押すと前の 5 枚").toBe(0);
  });

  it("合は失う系統が少ない順、同じなら新しく立つ系統が多い順", () => {
    const state = plainState();
    const def = (key: string): AffixDef => {
      const found = AFFIXES.find((d) => d.key === key);
      if (!found) throw new Error(`性質が無い: ${key}`);
      return found;
    };
    // 怯み系: 源 = 頭・首飾り（firstMove）、糧 = 右手・指輪（damageVsStaggered）。燃焼系: 右手・指輪の煽りの残り火で 1 段
    state.profile.equipment.mainHand = withAffixes("mainHand", "main", [def("damageVsStaggered"), def("emberTrail")]);
    state.profile.equipment.ring = withAffixes("ring", "ring", [def("damageVsStaggered"), def("emberTrail")]);
    state.profile.equipment.amulet = withAffixes("amulet", "amulet", [def("firstMove")]);
    state.profile.equipment.head = withAffixes("head", "worn", [def("firstMove")]);
    const stash = [
      withAffixes("head", "keep", [def("firstMove")], { foundAt: 100 }),
      withAffixes("head", "keep-newer", [def("firstMove")], { foundAt: 300 }),
      withAffixes("head", "boost", [def("firstMove"), def("burnStack")], { foundAt: 200 }),
      withAffixes("head", "swap", [def("burnStack")], { foundAt: 400 }),
      relic("head", "bare", { foundAt: 500 }),
    ];
    state.profile.stash = stash;

    const base = tryOnBase(state);
    const summary = (id: string) => {
      const item = stash.find((it) => it.id === id);
      if (!item) throw new Error(id);
      return tryOn(base, { kind: "relic", slot: "head", item }).summary;
    };
    expect(summary("keep").lost, "同じ性質なら失わない").toBe(0);
    expect(summary("bare").lost, "性質の無い頭は怯み系を失う").toBeGreaterThan(0);
    expect(summary("boost").gained, "煽りの強めで燃焼系が太る").toBeGreaterThan(summary("keep").gained);

    const order = sortedIds(state, { kind: "slot", slot: "head" }, "fit");
    const position = (id: string): number => order.indexOf(id);
    expect(position("boost"), "失わず太る物が最初").toBeLessThan(position("keep-newer"));
    expect(position("keep-newer"), "同じ集計は新しい物が先").toBeLessThan(position("keep"));
    expect(position("keep"), "失わない物は失う物より先").toBeLessThan(position("swap"));
    expect(position("keep"), "失わない物は失う物より先").toBeLessThan(position("bare"));
    expect(position("swap"), "同じだけ失うなら新しく太る物が先").toBeLessThan(position("bare"));
  });

  it("新は新着を先に、次に深い順", () => {
    const state = plainState();
    state.profile.meta.seenAt = { head: 100 };
    state.profile.stash = [
      relic("head", "old-deep", { foundAt: 50, foundDepth: 9 }),
      relic("head", "old-shallow", { foundAt: 60, foundDepth: 2 }),
      relic("head", "new-shallow", { foundAt: 200, foundDepth: 3 }),
      relic("head", "new-deep", { foundAt: 210, foundDepth: 8 }),
    ];
    const order = sortedIds(state, { kind: "slot", slot: "head" }, "new");
    expect(order, "新着が先、その中は深い順、次に見た物の深い順").toEqual(["new-deep", "new-shallow", "old-deep", "old-shallow"]);
    const items = state.profile.stash;
    expect(items.filter((it) => isUnseen(it, state.profile.meta)).map((it) => it.id).sort(), "新着は 2 つ").toEqual(["new-deep", "new-shallow"]);
  });

  it("名は名のある遺物・銘・芽のある物を先に", () => {
    const state = plainState();
    const offer: AffixRoll = { key: "armorFlat", value: 1, nominal: 1, flux: 0, color: "gold", origin: "found" };
    state.profile.stash = [
      relic("head", "plain-new", { foundAt: 500 }),
      relic("head", "named", { foundAt: 10, namedKey: "luckyCat" }),
      relic("head", "inscribed", { foundAt: 20, inscription: "銘" }),
      relic("head", "budding", { foundAt: 30, budOffer: { milestone: "kills:50", options: [offer, offer] } }),
      relic("head", "plain-old", { foundAt: 5 }),
    ];
    const order = sortedIds(state, { kind: "slot", slot: "head" }, "name");
    expect(order.slice(0, 3).sort(), "名・銘・芽の 3 つが先頭").toEqual(["budding", "inscribed", "named"]);
    expect(order.slice(3), "残りは新しい順").toEqual(["plain-new", "plain-old"]);
  });

  it("決定で付け替え、外した物は一覧の先頭に出て焦点が移る", () => {
    const state = plainState();
    state.profile.equipment.head = relic("head", "worn");
    state.profile.stash = [relic("head", "a", { foundAt: 5 }), relic("head", "b", { foundAt: 4 }), relic("head", "c", { foundAt: 3 })];
    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "head"));
    const view = topCandidates(ui);
    view.focus = fid.cand("b");
    frame(state, ui, { confirmPressed: true });
    expect(state.profile.equipment.head?.id, "b を付けた").toBe("b");
    expect(state.profile.stash.map((it) => it.id), "外した物は倉庫の末尾（変えない）").toEqual(["a", "c", "worn"]);
    expect(candidateEntries(state, view).map(entryFocusId).slice(0, 2), "装備中の札の次に、外した物").toEqual([fid.worn, fid.cand("worn")]);
    expect(view.focus, "焦点は外した物").toBe(fid.cand("worn"));
    expect(view.offset, "頁は先頭").toBe(0);
  });

  it("付け替えで能力が畳み直され、保存される", () => {
    const state = plainState();
    const heavy = generateItem(createRng(7), { baseKey: "plate", plain: true, itemLevel: 40, foundDepth: 40, now: 0 });
    state.profile.stash = [{ ...heavy, id: "heavy", slot: "armor" }];
    const before = state.stats.armor;
    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "armor"));
    topCandidates(ui).focus = fid.cand("heavy");
    frame(state, ui, { confirmPressed: true });
    expect(state.stats.armor, "防御力が畳み直される").toBeGreaterThan(before);
    const saved = loadProfile();
    expect(saved.equipment.armor?.id, "保存された装備").toBe("heavy");
  });

  it("系統から来た候補は全部位から、その系統の源 / 糧を持つ遺物だけ", () => {
    const state = plainState();
    const usable = AFFIXES.filter((d) => d.keywords !== undefined && d.keywords.produces.length > 0);
    const excluded = new Set<Keyword>(RESONANCE_EXCLUDED);
    const def = usable.find((d) => d.keywords?.produces.some((k) => !excluded.has(k)));
    const keyword = def?.keywords?.produces.find((k) => !excluded.has(k));
    if (def === undefined || keyword === undefined) throw new Error("源になる性質が無い");
    const sinkDef = AFFIXES.find((d) => d.keywords?.consumes.includes(keyword) === true && d.keywords.produces.includes(keyword) === false);
    const otherDef = AFFIXES.find((d) => d.keywords !== undefined && !d.keywords.produces.includes(keyword) && !d.keywords.consumes.includes(keyword) && !d.keywords.amplifies.includes(keyword));
    state.profile.stash = [
      withAffixes("head", "src-head", [def]),
      withAffixes("ring", "src-ring", [def]),
      withAffixes("boots", "plain-boots", otherDef === undefined ? [] : [otherDef]),
      relic("armor", "bare-armor"),
    ];
    if (sinkDef !== undefined) state.profile.stash.push(withAffixes("amulet", "sink-amulet", [sinkDef]));
    const view = { ...candidatesFor(createInventoryUi(createCraftSave()), "head"), target: { kind: "flow" as const, keyword, verb: "produces" as const } };
    const ui = openCandidates(state, view);
    const got = ids(ui, state).sort();
    expect(got, "その系統の源を持つ頭と指輪だけ").toEqual([fid.cand("src-head"), fid.cand("src-ring")].sort());
  });

  it("石の候補で腰の石を付け替え、長押しで分解する", () => {
    const state = plainState();
    const profile = state.skills.profile;
    profile.stones = [];
    profile.loadout = [null, null, null, null];
    const keys = SKILL_KEYS.slice(0, 3);
    const stones = keys.map((skillKey, i) => stoneFromSeed(10 + i, { skillKey, foundDepth: 1, now: i }));
    for (const s of stones) addStone(profile, s);
    const [first, second, third] = stones;
    if (!first || !second || !third) throw new Error("石が足りない");
    equipStone(profile, first.id, 1);

    const ui = openCandidates(state, { ...candidatesFor(createInventoryUi(createCraftSave()), "head"), target: { kind: "stone", index: 1 } });
    const view = topCandidates(ui);
    const entries = candidateEntries(state, view).map(entryFocusId);
    expect(entries, "その枠の石以外の石と空ける").toEqual(expect.arrayContaining([fid.cand(second.id), fid.cand(third.id), fid.clear]));
    expect(entries, "枠の石は並ばない").not.toContain(fid.cand(first.id));

    view.focus = fid.cand(second.id);
    // 石の札は長押しを持つので、押して離すと決定になる
    frame(state, ui, { confirmPressed: true }, true);
    frame(state, ui, {}, false);
    expect(stoneInSlot(profile, 1)?.id, "石を付け替えた").toBe(second.id);
    expect(view.focus, "外した石に焦点").toBe(fid.cand(first.id));

    // 長押しで分解（0.6 秒押し続ける）
    view.focus = fid.cand(third.id);
    frame(state, ui, { confirmPressed: true }, true);
    expect(profile.stones.some((s) => s.id === third.id), "押した瞬間は分解しない").toBe(true);
    for (let t = 0; t < MENU_HOLD_SECONDS + 0.1; t += DT) frame(state, ui, {}, true);
    expect(profile.stones.some((s) => s.id === third.id), "長押しで分解した").toBe(false);
  });

  it("同じスキルの石は 1 枚の束にまとまり、決定でその束の頁へ入る（1 個だけのスキルは石の札のまま）", () => {
    const state = plainState();
    const profile = state.skills.profile;
    profile.stones = [];
    profile.loadout = [null, null, null, null];
    const [keyA, keyB, keyC] = SKILL_KEYS;
    if (!keyA || !keyB || !keyC) throw new Error("スキルが足りない");
    const dupes = [0, 1, 2].map((i) => stoneFromSeed(20 + i, { skillKey: keyB, foundDepth: 1, now: i }));
    const lone = stoneFromSeed(30, { skillKey: keyC, foundDepth: 1, now: 9 });
    const worn = stoneFromSeed(31, { skillKey: keyA, foundDepth: 1, now: 10 });
    for (const st of [...dupes, lone, worn]) addStone(profile, st);
    equipStone(profile, worn.id, 1);

    const ui = openCandidates(state, { ...candidatesFor(createInventoryUi(createCraftSave()), "head"), target: { kind: "stone", index: 1 } });
    const view = topCandidates(ui);
    const entries = candidateEntries(state, view);
    const group = entries.find((e) => e.kind === "group");
    expect(group?.kind === "group" ? group.stones.length : 0, "同じスキルの 3 個が 1 束").toBe(3);
    expect(entries.map(entryFocusId)).toContain(fid.cand(lone.id));
    expect(entries.filter((e) => e.kind === "subject" && e.subject.kind === "stone" && e.subject.stone.skillKey === keyB), "束の石は一覧に直接並ばない").toHaveLength(0);

    view.focus = fid.group(keyB);
    frame(state, ui, { confirmPressed: true }, true);
    frame(state, ui, {}, false);
    const inner = topCandidates(ui);
    expect(inner.target, "束の頁").toEqual({ kind: "stone", index: 1, group: keyB });
    const innerIds = candidateEntries(state, inner).map(entryFocusId);
    expect(innerIds).toEqual(expect.arrayContaining(dupes.map((d) => fid.cand(d.id))));
    expect(innerIds, "束の頁にはそのスキルの石だけ").not.toContain(fid.cand(lone.id));
  });

  it("同じスキルを付けているとき、石の処分は使い込みを注いで冥響を得る。束の長押しは宿り符の石を残してまとめて注ぐ", () => {
    const state = plainState();
    const profile = state.skills.profile;
    profile.stones = [];
    profile.loadout = [null, null, null, null];
    const key = SKILL_KEYS.find((k) => SKILL_DEFS[k].axes.length > 0);
    if (!key) throw new Error("スキルが無い");
    const worn = { ...stoneFromSeed(40, { skillKey: key, foundDepth: 1, now: 0 }), wear: { casts: 0, hits: 0, buds: [] } };
    const grown = { ...stoneFromSeed(41, { skillKey: key, foundDepth: 1, now: 1 }), wear: { casts: 300, hits: 0, buds: [] } };
    const fresh = stoneFromSeed(42, { skillKey: key, foundDepth: 1, now: 2 });
    const rare = { ...stoneFromSeed(43, { skillKey: key, foundDepth: 1, now: 3 }), dwell: "echo" as const };
    const extra = { ...stoneFromSeed(44, { skillKey: key, foundDepth: 1, now: 4 }), wear: { casts: 100, hits: 0, buds: [] } };
    for (const st of [worn, grown, fresh, rare, extra]) addStone(profile, st);
    equipStone(profile, worn.id, 0);

    const ui = openCandidates(state, { ...candidatesFor(createInventoryUi(createCraftSave()), "head"), target: { kind: "stone", index: 0, group: key } });
    const view = topCandidates(ui);
    view.focus = fid.cand(grown.id);
    frame(state, ui, { confirmPressed: true }, true);
    for (let t = 0; t < MENU_HOLD_SECONDS + 0.1; t += DT) frame(state, ui, {}, true);
    frame(state, ui, {}, false);
    expect(profile.stones.some((st) => st.id === grown.id), "処分した").toBe(false);
    expect(worn.wear.casts, "発動の半分が注がれる").toBe(150);
    expect(ui.craft.echoes.umbra, "冥響を得る").toBe(1);

    ui.stack.pop();
    const top = openCandidates(state, { ...candidatesFor(createInventoryUi(createCraftSave()), "head"), target: { kind: "stone", index: 0 } });
    const list = topCandidates(top);
    list.focus = fid.group(key);
    frame(state, top, { confirmPressed: true }, true);
    for (let t = 0; t < MENU_HOLD_SECONDS + 0.1; t += DT) frame(state, top, {}, true);
    frame(state, top, {}, false);
    expect(profile.stones.map((st) => st.id).sort(), "付けている石と宿り符の石だけ残る").toEqual([worn.id, rare.id].sort());
    expect(worn.wear.casts, "まとめて注いだ分も足される").toBe(200);
  });

  it("芽のある部位は先頭に芽吹きの札 2 枚が出て、決定で芽吹く", () => {
    const state = plainState();
    const offerA: AffixRoll = { key: "armorFlat", value: 3, nominal: 3, flux: 0, color: "gold", origin: "found" };
    const offerB: AffixRoll = { key: "armorFlat", value: 4, nominal: 4, flux: 0, color: "gold", origin: "found" };
    const milestone = MILESTONES[0]?.key ?? "kills:50";
    state.profile.equipment.head = relic("head", "budded", { margin: 2, marginMax: 2, budOffer: { milestone, options: [offerA, offerB] } });
    state.profile.stash = [relic("head", "stash-head")];
    state.pendingBud = findPendingBud(state.profile);
    if (state.pendingBud === null) throw new Error("芽が提示されない");

    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "head"));
    const view = topCandidates(ui);
    const entries = candidateEntries(state, view).map(entryFocusId);
    expect(entries.slice(0, 3), "装備中の札の次に芽吹きの札 2 枚").toEqual([fid.worn, fid.bud(0), fid.bud(1)]);
    expect(entries[3], "その次に倉庫の物").toBe(fid.cand("stash-head"));

    view.focus = fid.bud(1);
    frame(state, ui, { confirmPressed: true });
    const worn = state.profile.equipment.head;
    expect(worn?.affixes.some((a) => a.origin === "bud" && a.value === 4), "選んだ方が芽吹いた").toBe(true);
    expect(worn?.budOffer ?? null, "提示は消える").toBeNull();
    expect(candidateEntries(state, view).map(entryFocusId)[1], "芽吹きの札は無くなる").toBe(fid.cand("stash-head"));
  });

  it("複数の装備に芽があるとき、2 つ目の部位の頁にも札が出て、選ぶとその遺物だけ芽吹く", () => {
    const state = plainState();
    const milestone = MILESTONES[0]?.key ?? "kills:50";
    const roll = (value: number): AffixRoll => ({ key: "armorFlat", value, nominal: value, flux: 0, color: "gold", origin: "found" });
    state.profile.equipment.head = relic("head", "budded-head", { margin: 2, marginMax: 2, budOffer: { milestone, options: [roll(1), roll(2)] } });
    state.profile.equipment.boots = relic("boots", "budded-boots", { margin: 2, marginMax: 2, budOffer: { milestone, options: [roll(5), roll(6)] } });
    state.pendingBud = findPendingBud(state.profile);
    expect(state.pendingBud?.slot, "pendingBud は SLOTS 順で先頭の 1 つだけ").not.toBe("boots");

    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "boots"));
    const view = topCandidates(ui);
    expect(candidateEntries(state, view).map(entryFocusId).slice(1, 3), "pendingBud でない部位にも芽吹きの札").toEqual([fid.bud(0), fid.bud(1)]);
    expect(CANDIDATES_VIEW.sheetFor(state, { ...view, focus: fid.bud(0) })?.kind, "芽の札の書付は開いた部位の遺物").toBe("item");

    view.focus = fid.bud(1);
    frame(state, ui, { confirmPressed: true });
    const boots = state.profile.equipment.boots;
    expect(boots?.affixes.some((a) => a.origin === "bud" && a.value === 6), "選んだ方が靴の遺物に付いた").toBe(true);
    expect(boots?.budOffer ?? null, "靴の提示は消える").toBeNull();
    const head = state.profile.equipment.head;
    expect(head?.budOffer ?? null, "頭の芽は残る").not.toBeNull();
    expect(head?.affixes.some((a) => a.origin === "bud"), "頭には付かない").toBe(false);
    expect(state.pendingBud?.slot, "残った芽が pendingBud になる").toBe("head");
  });

  it("候補の頁の左の部位のマスをクリックすると、その部位の候補の頁に替わる（通過では焦点を奪わない）", () => {
    const state = plainState();
    state.profile.stash = [relic("head", "n1", { foundAt: 500 }), relic("boots", "b1", { foundAt: 10 })];
    const fresh = state.profile.stash.find((it) => it.id === "n1");
    if (fresh === undefined) throw new Error("遺物が無い");
    expect(isUnseen(fresh, state.profile.meta), "最初は新着").toBe(true);
    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "head"));
    const view = topCandidates(ui);
    view.focus = fid.cand("n1");
    const boots = MINI_PARTS.boots;
    const aim = { x: boots.x + MINI_PART / 2, y: boots.y + MINI_PART / 2 };

    frame(state, ui, { aimScreen: { x: 300, y: 200 } });
    frame(state, ui, { aimScreen: aim });
    expect(view.focus, "マウスが部位の上を通るだけでは焦点は札のまま").toBe(fid.cand("n1"));
    expect(topCandidates(ui), "頁も替わらない").toBe(view);

    frame(state, ui, { aimScreen: aim, clickPressed: true });
    const next = topCandidates(ui);
    expect(next.target, "靴の候補の頁").toEqual({ kind: "slot", slot: "boots" });
    expect(ui.stack.map((v) => v.kind), "積み重ねは装束 → 候補のまま").toEqual(["attire", "candidates"]);
    expect(ui.stack[0]?.focus, "装束の頁の焦点も靴").toBe(fid.part("boots"));
    expect(isUnseen(fresh, state.profile.meta), "外れた頭の頁の新着は見たことになる").toBe(false);
    const hitIds = CANDIDATES_VIEW.layout(state, ui, next).map((h) => h.id);
    expect(hitIds, "今の部位のマスは当たりに出ない").not.toContain(fid.part("boots"));
    expect(hitIds, "元の部位のマスが当たりに出る").toContain(fid.part("head"));
  });

  it("候補の頁で ← を押すと札から左の部位へ移れて、決定でその部位の候補の頁に替わる", () => {
    const state = plainState();
    for (let i = 0; i < 5; i++) state.profile.stash.push(relic("head", `h${i}`, { foundAt: 10 + i }));
    state.profile.stash.push(relic("armor", "a1"));
    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "head"));
    const view = topCandidates(ui);
    view.focus = candidateEntries(state, view).map(entryFocusId)[3] ?? null;
    frame(state, ui, { move: { x: -1, y: 0 } });
    expect(view.focus?.startsWith("part:"), "札から部位のマスへ移った").toBe(true);
    const slot = view.focus?.slice("part:".length);

    frame(state, ui, { move: { x: 0, y: 0 } });
    frame(state, ui, { confirmPressed: true });
    expect(topCandidates(ui).target, "決定で、その部位の候補の頁").toEqual({ kind: "slot", slot });
    expect(ui.stack[0]?.focus, "装束の頁の焦点も合う").toBe(fid.part(slot as Slot));
  });

  it("候補の頁を離れるとその部位の新着が消える", () => {
    const state = plainState();
    state.profile.stash = [relic("head", "n1", { foundAt: 500 }), relic("ring", "n2", { foundAt: 600 })];
    const fresh = (slot: Slot): boolean => state.profile.stash.some((it) => it.slot === slot && isUnseen(it, state.profile.meta));
    expect(fresh("head"), "最初は新着").toBe(true);
    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "head"));
    frame(state, ui, { move: { x: 0, y: 0 } });
    updateInventoryUi(state, ui, withInput({}), DT, { back: true, confirmHeld: false });
    expect(ui.stack.map((v) => v.kind), "装束へ戻った").toEqual(["attire"]);
    expect(fresh("head"), "頭の新着は消える").toBe(false);
    expect(fresh("ring"), "見ていない指輪は新着のまま").toBe(true);
    expect(loadProfile().meta.seenAt?.head, "保存される").toBe(500);
  });

  it("空けるで部位を外す", () => {
    const state = plainState();
    state.profile.equipment.boots = relic("boots", "worn-boots");
    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "boots"));
    const view = topCandidates(ui);
    expect(candidateEntries(state, view).map(entryFocusId), "装備中の札と、埋まっていれば末尾に空ける").toEqual([fid.worn, fid.clear]);
    view.focus = fid.clear;
    frame(state, ui, { confirmPressed: true });
    expect(state.profile.equipment.boots, "外れた").toBeNull();
    expect(state.profile.stash.map((it) => it.id), "倉庫へ戻った").toEqual(["worn-boots"]);
    expect(candidateEntries(state, view).map(entryFocusId), "空いた部位に空けるは出ない").toEqual([fid.cand("worn-boots")]);
    expect(view.focus, "外した物に焦点").toBe(fid.cand("worn-boots"));
  });
});

describe("候補の並びの計算", () => {
  it("並びは頁を開いて最初に 1 回だけ数え、view.order に入れる", () => {
    const state = plainState();
    for (let i = 0; i < 6; i++) state.profile.stash.push(relic("head", `h${i}`, { foundAt: i }));
    const view = candidatesFor(createInventoryUi(createCraftSave()), "head");
    expect(view.order, "開く前は未計算").toBeNull();
    candidateEntries(state, view);
    const first = view.order;
    expect(first, "数えて入れた").toHaveLength(6);
    candidateEntries(state, view);
    expect(view.order, "2 回目は同じ配列を使い回す").toBe(first);
  });

  it("倉庫が最大でも並びの計算が 1 フレームに収まる", () => {
    const state = plainState();
    state.profile.equipment.ring = relic("ring", "now");
    const defs = AFFIXES.filter((d) => d.slots.includes("ring") && d.keywords !== undefined);
    for (let i = 0; i < 400; i++) state.profile.stash.push(withAffixes("ring", `r${i}`, defs.slice(i % 7, (i % 7) + 3), { foundAt: i }));
    const t0 = performance.now();
    const order = sortedIds(state, { kind: "slot", slot: "ring" }, "fit");
    const ms = performance.now() - t0;
    expect(order, "400 件が並ぶ").toHaveLength(400);
    expect(ms, `400 件の合の並び ${ms.toFixed(1)}ms`).toBeLessThan(PERF_LIMIT_MS);
  });
});

/** 石 4 つを装着し、倉庫に石 6 つ（資源の型・系統がばらつく）を置いた state */
function stoneState(): GameState {
  const state = plainState();
  const profile = state.skills.profile;
  profile.stones = [];
  profile.loadout = [null, null, null, null];
  SKILL_KEYS.slice(0, 10).forEach((skillKey, i) => addStone(profile, stoneFromSeed(50 + i, { skillKey, foundDepth: 1, now: i })));
  profile.stones.slice(0, 4).forEach((s, i) => equipStone(profile, s.id, i));
  return state;
}

describe("候補の頁: 絞り込み", () => {
  it("系統の札を決定するたびに次の語へ送り、その語に関わる石だけが並ぶ", () => {
    const state = stoneState();
    const ui = openCandidates(state, { kind: "candidates", focus: null, target: { kind: "stone", index: 0 }, sort: "fit", offset: 0, order: null, pinnedId: null });
    const view = topCandidates(ui);
    const all = ids(ui, state).filter((id) => id.startsWith("c:")).length;
    expect(CANDIDATES_VIEW.layout(state, ui, view).map((h) => h.id), "札がある").toContain(fid.filter("keyword"));

    view.focus = fid.filter("keyword");
    frame(state, ui, { confirmPressed: true });
    const keyword = view.filter?.keyword ?? null;
    expect(keyword, "最初の語に絞られる").not.toBeNull();
    const shown = candidateEntries(state, view).filter((e) => e.kind === "subject");
    expect(shown.length, "絞ると減る（または同じ）").toBeLessThanOrEqual(all);
    expect(shown.every((e) => e.kind === "subject" && subjectKeywords(e.subject).includes(keyword as Keyword)), "その語に関わる石だけ").toBe(true);
    expect(view.focus, "焦点は札に残る").toBe(fid.filter("keyword"));
    expect(view.offset, "頁の先頭へ").toBe(0);
  });

  it("型の札は気力型 → 再使用型 → 絞らない の順に送る", () => {
    const state = stoneState();
    const ui = openCandidates(state, { kind: "candidates", focus: null, target: { kind: "stone", index: 0 }, sort: "fit", offset: 0, order: null, pinnedId: null });
    const view = topCandidates(ui);
    view.focus = fid.filter("resource");
    frame(state, ui, { confirmPressed: true });
    expect(view.filter?.resource, "気力型").toBe("mana");
    expect(candidateEntries(state, view).filter((e) => e.kind === "subject").every((e) => e.kind === "subject" && e.subject.kind === "stone" && SKILL_DEFS[e.subject.stone.skillKey].resource === "mana"), "気力型の石だけ").toBe(true);
    frame(state, ui, {});
    frame(state, ui, { confirmPressed: true });
    expect(view.filter?.resource, "再使用型").toBe("cooldown");
    frame(state, ui, {});
    frame(state, ui, { confirmPressed: true });
    expect(view.filter?.resource, "一巡して絞らない").toBeNull();
  });

  it("遺物の候補には型の札が出ない（系統だけ）。系統の候補には絞り込みの札が出ない", () => {
    const state = plainState();
    expect(filterAvailable({ kind: "slot", slot: "head" }, "keyword")).toBe(true);
    expect(filterAvailable({ kind: "slot", slot: "head" }, "resource")).toBe(false);
    expect(filterAvailable({ kind: "stone", index: 0 }, "resource")).toBe(true);
    expect(filterAvailable({ kind: "flow", keyword: "burn", verb: "produces" }, "keyword")).toBe(false);
    const ui = openCandidates(state, candidatesFor(createInventoryUi(createCraftSave()), "head"));
    const hitIds = CANDIDATES_VIEW.layout(state, ui, topCandidates(ui)).map((h) => h.id);
    expect(hitIds).toContain(fid.filter("keyword"));
    expect(hitIds).not.toContain(fid.filter("resource"));
  });

  it("絞り込みの結果が空でも札は残り、送り直せる", () => {
    const state = stoneState();
    const view: ViewOf<"candidates"> = { kind: "candidates", focus: null, target: { kind: "stone", index: 0 }, sort: "fit", offset: 0, order: null, pinnedId: null, filter: { keyword: "elLight", resource: null } };
    const ui = openCandidates(state, view);
    expect(candidateEntries(state, view).filter((e) => e.kind === "subject"), "光属性の石は無い").toHaveLength(0);
    expect(CANDIDATES_VIEW.layout(state, ui, view).map((h) => h.id), "札は残る").toContain(fid.filter("keyword"));
    const next = nextFilter(state, view.target, view.filter ?? NO_FILTER, "keyword");
    expect(next.keyword, "手元の語に無い値からは先頭の「絞らない」へ").toBeNull();
  });
});

describe("候補の頁: 腰の石の切り替え", () => {
  it("石の候補の左下の石を決定すると、そのスキル枠の候補へ替わり、絞り込みを引き継ぐ", () => {
    const state = stoneState();
    const ui = openCandidates(state, { kind: "candidates", focus: null, target: { kind: "stone", index: 0 }, sort: "fit", offset: 0, order: null, pinnedId: null, filter: { keyword: null, resource: "mana" } });
    const view = topCandidates(ui);
    const hits = CANDIDATES_VIEW.layout(state, ui, view).map((h) => h.id);
    expect(hits, "ほかの 3 枠の石に当たり").toEqual(expect.arrayContaining([fid.gem(1), fid.gem(2), fid.gem(3)]));
    const here = CANDIDATES_VIEW.layout(state, ui, view).find((h) => h.id === fid.gem(0));
    expect(here?.act ?? null, "今の枠の石は決定では何も起きない（掴むだけ）").toBeNull();
    expect(here?.nav, "今の枠の石には方向で止まらない").toBe(false);

    view.focus = fid.gem(2);
    frame(state, ui, { confirmPressed: true });
    const next = topCandidates(ui);
    expect(next.target, "スキル 3 の候補").toEqual({ kind: "stone", index: 2 });
    expect(next.filter, "絞り込みを引き継ぐ").toEqual({ keyword: null, resource: "mana" });
    expect(ui.stack.map((v) => v.kind), "装束 → スキル → 候補の積み重ねのまま").toEqual(["attire", "skills", "candidates"]);
    expect(ui.stack[1]?.focus, "スキルの頁の焦点も新しい石").toBe(fid.stone(2));
    const worn = stoneInSlot(state.skills.profile, 2);
    expect(candidateEntries(state, next).some((e) => e.kind === "subject" && subjectId(e.subject) === worn?.id), "付けている石は並ばない").toBe(false);
  });

  it("左下の石は方向キーで移れる（部位のマスと同じ）", () => {
    const state = stoneState();
    const ui = openCandidates(state, { kind: "candidates", focus: null, target: { kind: "stone", index: 0 }, sort: "fit", offset: 0, order: null, pinnedId: null });
    const view = topCandidates(ui);
    const gems = CANDIDATES_VIEW.layout(state, ui, view).filter((h) => h.id.startsWith("gem:") && h.id !== fid.gem(0));
    expect(gems.every((h) => h.nav && h.hover === false), "方向で止まり、通るだけでは焦点を奪わない").toBe(true);
  });
});

describe("候補の頁: 並びの札の荷札", () => {
  it("絞り込み・並びの札に焦点があると、何をする札かを荷札で言う", () => {
    const state = stoneState();
    const ui = openCandidates(state, { kind: "candidates", focus: null, target: { kind: "stone", index: 0 }, sort: "fit", offset: 0, order: null, pinnedId: null });
    const view = topCandidates(ui);
    const hit = (id: string) => CANDIDATES_VIEW.layout(state, ui, view).find((h) => h.id === id) ?? null;
    expect(CANDIDATES_VIEW.tag(state, ui, view, hit(fid.filter("keyword"))).title).toContain("系統で絞る");
    expect(CANDIDATES_VIEW.tag(state, ui, view, hit(fid.filter("resource"))).title).toContain("型で絞る");
    expect(CANDIDATES_VIEW.tag(state, ui, view, hit(fid.sort("new"))).title).toContain("並び");
  });
});
