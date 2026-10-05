import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { ULTIMATES } from "../data/ultimates";
import { MOVESETS, MOVESET_KEYS, isGun } from "../data/weapons";
import { chunksText } from "./scalingText";
import { formatAffix } from "../loot/affixes";
import { createCraftSave } from "../loot/craftingStore";
import { describeTrait } from "../loot/describe";
import { innateAt } from "../loot/innate";
import { addToStash, ultimateChoice } from "../loot/profile";
import { ATTR_KEYS, createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import { itemSheetLines } from "../render/sheetUi";
import { BOONS } from "../system/boonDefs";
import { BOON_GRADE_LABEL, boonGradeOf } from "../system/boonGrade";
import { lineageBoonRows } from "./effectsList";
import { createInventoryUi, dispatchMenuAct, menuHits } from "./inventory";
import { openMenu } from "./menuActions";
import { fid } from "./menuFocus";
import type { InventoryUi, SheetSubject, ViewOf } from "./menuState";
import { BODY_PAGES, BODY_PAGE_BREAKDOWN, BODY_PAGE_STATUS, BODY_PAGE_ULTIMATE, focusedActionIndex, focusedAttr, pairItems } from "./sheet";
import { attributeReferenceGroups, attributeSources, bodyActions, bodyModifierSection, derivedStatRows } from "./sheetBody";

const melee: AffixRoll = { key: "damageVsStaggered", value: 30, nominal: 25, flux: 0.4, color: "crimson", origin: "found" };
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
    innate: [{ key: "attr_str", value: 3, nominal: 3, flux: 0, origin: "found" }],
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

function lineText(line: unknown): string {
  return typeof line === "object" && line !== null && "text" in line && typeof line.text === "string" ? line.text : "";
}

/** 装束を開いて書付を積む */
function openSheet(state: GameState, subject: SheetSubject): { ui: InventoryUi; view: ViewOf<"sheet"> } {
  const ui = createInventoryUi(createCraftSave());
  openMenu(state, ui, "attire");
  const view: ViewOf<"sheet"> = { kind: "sheet", focus: null, subject, page: 0, offset: 0, forge: null };
  dispatchMenuAct(state, ui, { kind: "push", view });
  return { ui, view };
}

describe("書付", () => {
  it("1 品の書付に性質の全文と地金の数字が出る", () => {
    const state = createGame(1);
    // 地金は深度で決め直す。浅い階では点が 0 になりうるので深い階で見る
    state.depth = 30;
    const item = makeItem({ id: "worn", innateLuck: 1 });
    state.profile.equipment.mainHand = item;
    const lines = itemSheetLines(state, item);
    const texts = [...lines.left, ...lines.right].map((l) => lineText(l.line));
    for (const roll of item.affixes) expect(texts, `性質 ${roll.key}`).toContain(describeTrait(roll).text);
    const innate = innateAt(item, state.depth).map((r) => formatAffix(r));
    expect(innate.length, "地金がある").toBeGreaterThan(0);
    for (const text of innate) expect(texts.some((t) => t.includes(text)), `地金 ${text}`).toBe(true);
    const traitRows = lines.left.filter((l) => l.keywords !== undefined);
    expect(traitRows, "性質の行は系統の丸印つき").toHaveLength(item.affixes.length);
    const { ui } = openSheet(state, { kind: "item", itemId: "worn" });
    const ops = menuHits(state, ui).filter((h) => h.id.startsWith("op:"));
    expect(ops, "下端に鍛冶の操作 5").toHaveLength(5);
  });

  it("見開きは候補と今の 2 頁", () => {
    const state = createGame(1);
    state.profile.equipment.mainHand = makeItem({ id: "worn" });
    addToStash(state.profile, makeItem({ id: "cand" }));
    const pair = pairItems(state, { kind: "pair", itemId: "cand", slot: "mainHand" });
    expect([pair.candidate?.id, pair.current?.id], "左 = 候補、右 = 今").toEqual(["cand", "worn"]);
    const { ui } = openSheet(state, { kind: "pair", itemId: "cand", slot: "mainHand" });
    expect(menuHits(state, ui).filter((h) => h.id.startsWith("op:")), "見開きでは鍛冶をしない").toHaveLength(0);
  });

  it("書付「体」に 5 ステータス・体の性能・焦点の行動の計算式が出る", () => {
    const state = createGame(1);
    const { ui, view } = openSheet(state, { kind: "body" });
    const ids = menuHits(state, ui).map((h) => h.id);
    expect(ids, "頁の札").toEqual(expect.arrayContaining(BODY_PAGES.map((_, n) => fid.page(n))));
    expect(ids.filter((id) => id.startsWith("row:")).length, "行動の行").toBeGreaterThan(0);
    expect(Object.keys(attributeSources(state)), "ステータスの出どころ").toEqual(expect.arrayContaining(["str", "dex", "vit", "mnd", "spi"]));
    expect(derivedStatRows(state.stats).length, "体の性能").toBeGreaterThan(0);
    const second = bodyActions(state).length > 1 ? 1 : 0;
    view.focus = fid.row(second);
    expect(focusedActionIndex(state, view), "焦点の行動の計算式").toBe(second);
  });

  it("書付「体」の頁は 3 枚（体・内訳・奥義）で、札から送れる", () => {
    const state = createGame(1);
    expect(BODY_PAGES, "頁の並び").toEqual(["体", "内訳", "奥義"]);
    const { ui } = openSheet(state, { kind: "body" });
    const top = (): ViewOf<"sheet"> => {
      const v = ui.stack[ui.stack.length - 1];
      if (v?.kind !== "sheet") throw new Error("書付が積まれていない");
      return v;
    };
    expect(menuHits(state, ui).filter((h) => h.id.startsWith("page:")), "頁の札").toHaveLength(3);
    for (const page of [BODY_PAGE_BREAKDOWN, BODY_PAGE_ULTIMATE, BODY_PAGE_STATUS]) {
      dispatchMenuAct(state, ui, { kind: "sheetPage", page });
      expect(top().page, `頁 ${BODY_PAGES[page]} へ送れる`).toBe(page);
    }
  });

  it("内訳の頁はステータスごとの行を持ち、焦点のステータスが選ばれる", () => {
    const state = createGame(1);
    const { ui } = openSheet(state, { kind: "body" });
    dispatchMenuAct(state, ui, { kind: "sheetPage", page: BODY_PAGE_BREAKDOWN });
    const ids = menuHits(state, ui).map((h) => h.id);
    expect(ids.filter((id) => id.startsWith("row:")), "ステータスの行").toHaveLength(ATTR_KEYS.length);
    expect(ids, "体の頁の行動の行は出さない").not.toContain(fid.row(ATTR_KEYS.length));
    const view = ui.stack[ui.stack.length - 1];
    if (view?.kind !== "sheet") throw new Error("書付が積まれていない");
    expect(focusedAttr(view), "焦点が無ければ先頭").toBe(ATTR_KEYS[0]);
    ATTR_KEYS.forEach((key, i) => {
      view.focus = fid.row(i);
      expect(focusedAttr(view), `行 ${i}`).toBe(key);
    });
    view.focus = fid.row(99);
    expect(focusedAttr(view), "範囲外は先頭").toBe(ATTR_KEYS[0]);
  });

  it("内訳の頁の参照する行動は、そのステータスを係数で参照する行動の名前で、威力・怯み値・効果量ごとに分かれる", () => {
    const state = createGame(1);
    const groups = attributeReferenceGroups(state);
    expect(Object.keys(groups), "全ステータス").toEqual([...ATTR_KEYS]);
    const heads = new Set(Object.values(groups).flatMap((gs) => gs.map((g) => g.head)));
    expect([...heads].every((h) => ["威力", "怯み値", "効果量"].includes(h)), "量の見出し").toBe(true);
    expect(Object.values(groups).some((gs) => gs.length > 0), "どれかのステータスは行動を参照する").toBe(true);
    for (const gs of Object.values(groups)) for (const g of gs) expect(g.names.length, `${g.head} の名前`).toBeGreaterThan(0);
  });

  it("内訳の頁の増と倍は今の右手の攻撃に掛かるものだけで、積んだ増と倍が出る", () => {
    const state = createGame(1);
    expect(bodyModifierSection(state).rows.map((r) => chunksText(r)), "素手は素手の倍だけ").toEqual([`倍 素手 ×${state.stats.more.find((m) => m.source === "unarmed")?.mul}`]);
    state.stats = {
      ...state.stats,
      increased: { ...state.stats.increased, melee: 0.2, ranged: 0.5 },
      more: [
        { source: "keystone:ks_glassCannon", label: "硝子の砲", mul: 2, tags: ["melee", "ranged"] },
        { source: "boon:triggerHappy", label: "乱れ撃ち", mul: 0.6, tags: ["ranged"] },
      ],
    };
    const melee = bodyModifierSection(state);
    expect(melee.attack, "銃でなければ近接").toBe("melee");
    expect(melee.rows.map((r) => chunksText(r)), "近接の増と、近接に掛かる倍だけ").toEqual(["増 近接ダメージ +20%", "倍 硝子の砲 ×2"]);
    const gun = MOVESET_KEYS.find((k) => isGun(MOVESETS[k]));
    if (gun === undefined) throw new Error("銃の武器種が無い");
    state.stats = { ...state.stats, moveset: gun };
    const ranged = bodyModifierSection(state);
    expect(ranged.attack, "銃は射撃").toBe("ranged");
    expect(ranged.rows.map((r) => chunksText(r)), "射撃の増と、射撃に掛かる倍").toEqual(["増 射撃ダメージ +50%", "倍 硝子の砲 ×2・乱れ撃ち ×0.6"]);
  });

  it("奥義は拠点でだけ選べる", () => {
    const state = createGame(1);
    const moveset = state.stats.moveset;
    const last = ULTIMATES[moveset].length - 1;
    const run = openSheet(state, { kind: "body" });
    dispatchMenuAct(state, run.ui, { kind: "sheetPage", page: BODY_PAGE_ULTIMATE });
    expect(menuHits(state, run.ui).some((h) => h.id.startsWith("moveset:")), "ラン中は武器種を送らない").toBe(false);
    dispatchMenuAct(state, run.ui, { kind: "chooseUltimate", index: last });
    expect(state.profile.ultimates?.[moveset], "ラン中は変わらない").toBeUndefined();
    expect(run.ui.note, "理由を知らせる").not.toBeNull();

    state.sandbox = true;
    const hub = openSheet(state, { kind: "body" });
    dispatchMenuAct(state, hub.ui, { kind: "sheetPage", page: BODY_PAGE_ULTIMATE });
    expect(menuHits(state, hub.ui).some((h) => h.id === fid.moveset(1)), "拠点は武器種を送れる").toBe(true);
    dispatchMenuAct(state, hub.ui, { kind: "chooseUltimate", index: last });
    expect(ultimateChoice(state.profile, moveset).key, "拠点で選べる").toBe(ULTIMATES[moveset][last]?.key);
  });

  it("系譜の書付に研鑽の数えが出る", () => {
    const state = createGame(1);
    state.boons.push("ashBlaze");
    state.boonRun.tallies.ashBlaze = 7.9;
    const lineage = BOONS.ashBlaze.lineage;
    if (lineage === undefined) throw new Error("系譜が無い");
    const row = lineageBoonRows(state, lineage).find((r) => r.key === "boon:ashBlaze");
    expect(row?.info, "格・数え").toBe(`${BOON_GRADE_LABEL[boonGradeOf(state, "ashBlaze")]}・7`);
  });
});
