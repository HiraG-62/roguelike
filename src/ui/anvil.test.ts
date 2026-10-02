import { describe, expect, it } from "vitest";
import { EMPTY_INPUT } from "../core/input";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { MENU_BUDGET } from "../data/tuning";
import { ECHO_OPS, STIR_COST, type EchoWallet } from "../loot/crafting";
import { type CraftSave, createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { TRAIT_COLORS, createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import { applyStats } from "../system/player";
import { ANVIL_FOCUS, ANVIL_POT_FULL, ANVIL_VIEW, anvilRows, potLevel } from "./anvil";
import { ATTIRE_PART_RECTS, ATTIRE_SLOTS } from "./attire";
import { createInventoryUi, dispatchMenuAct, menuHits, updateInventoryUi } from "./inventory";
import { closeMenu, openMenu, switchFace } from "./menuActions";
import { fid } from "./menuFocus";
import { MENU_HOLD_SECONDS } from "./menuInput";
import type { AnvilState, InventoryUi, MenuAct, MenuHit, ViewOf } from "./menuState";

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

/** 装備中 1（worn）・倉庫に右手 2（stash-a / stash-b）と指輪 1（ring-a）を置き、鍛冶屋で開いた装備画面 */
function setup(echoes = 50): { state: GameState; ui: InventoryUi; craft: CraftSave } {
  const state = createGame(1);
  state.sandbox = true;
  state.profile.stash = [];
  state.profile.equipment.mainHand = makeItem({ id: "worn", name: "着ている剣" });
  applyStats(state, computeStats(state.profile.equipment, state.depth));
  addToStash(state.profile, makeItem({ id: "stash-a", name: "倉庫の剣 A" }));
  addToStash(state.profile, makeItem({ id: "stash-b", name: "倉庫の剣 B" }));
  addToStash(state.profile, makeItem({ id: "ring-a", name: "倉庫の指輪", slot: "ring", baseKey: "ring" }));
  const craft = createCraftSave();
  craft.echoes = wallet(echoes);
  const ui = createInventoryUi(craft);
  openMenu(state, ui, "anvil");
  return { state, ui, craft };
}

function anvilOf(ui: InventoryUi): AnvilState {
  const root = ui.stack[0];
  if (root?.kind !== "attire" || root.anvil === null) throw new Error("金床の構えで開いていない");
  return root.anvil;
}

function rootOf(ui: InventoryUi): ViewOf<"attire"> {
  const root = ui.stack[0];
  if (root?.kind !== "attire") throw new Error("装束で開いていない");
  return root;
}

function dispatch(state: GameState, ui: InventoryUi, act: MenuAct): void {
  dispatchMenuAct(state, ui, act);
}

function hitOf(state: GameState, ui: InventoryUi, id: string): MenuHit {
  const found = menuHits(state, ui).find((h) => h.id === id);
  if (found === undefined) throw new Error(`当たりが無い: ${id}`);
  return found;
}

/** 当たりの決定を押す（実際の入力と同じ経路ではなく、当たりの act を渡す） */
function press(state: GameState, ui: InventoryUi, id: string): void {
  const hit = hitOf(state, ui, id);
  if (hit.act === null) throw new Error(`決定が無い: ${id}`);
  dispatch(state, ui, hit.act);
}

function back(state: GameState, ui: InventoryUi): void {
  updateInventoryUi(state, ui, EMPTY_INPUT, 0.016, { back: true, confirmHeld: false });
}

describe("金床の構え", () => {
  it("鍛冶屋で開くと装束が金床の構えになる", () => {
    const { state, ui } = setup();
    expect(ui.stack.map((v) => v.kind), "装束の 1 段").toEqual(["attire"]);
    const anvil = anvilOf(ui);
    expect(anvil.slot, "部位はまだ選ばない").toBeNull();
    expect(anvil.forge, "手続きも無い").toBeNull();
    const ids = menuHits(state, ui).map((h) => h.id);
    for (const slot of ATTIRE_SLOTS) expect(ids, `部位 ${slot} の当たり`).toContain(fid.part(slot));
    for (const color of TRAIT_COLORS) expect(ids, `残響の壺 ${color} の当たり`).toContain(ANVIL_FOCUS.pot(color));
    expect(ids.some((id) => id.startsWith("op:")), "操作は部位を選んでから").toBe(false);
    expect(ids.some((id) => id.startsWith("stone:") || id === fid.body), "人影と腰の石は無い").toBe(false);
    const part = hitOf(state, ui, fid.part("ring"));
    const r = ATTIRE_PART_RECTS.ring;
    expect(part.rect.x, "部位の位置は装束と同じ").toBe(r.x - 1);
    expect(ANVIL_VIEW.header(state, ui, rootOf(ui)).crumbs, "見出しは鍛冶屋").toBe("鍛冶屋");
  });

  it("部位を選ぶと装備中の物とその部位の倉庫が並ぶ", () => {
    const { state, ui } = setup();
    press(state, ui, fid.part("mainHand"));
    expect(anvilOf(ui).slot, "選んだ部位").toBe("mainHand");
    const rows = anvilRows(state.profile, anvilOf(ui));
    expect(rows.map((r) => (r.kind === "subject" ? r.item.id : "?")), "装備中が先頭、次に同じ部位の倉庫（別の部位は含まない）").toEqual(["worn", "stash-a", "stash-b"]);
    const ids = menuHits(state, ui).map((h) => h.id);
    for (const id of ["worn", "stash-a", "stash-b"]) expect(ids, `${id} の札`).toContain(fid.tg(id));
    expect(ids, "別の部位の物は並ばない").not.toContain(fid.tg("ring-a"));
    const first = hitOf(state, ui, fid.tg("worn")).rect;
    const second = hitOf(state, ui, fid.tg("stash-a")).rect;
    expect([first.x, first.y, first.w, first.h], "札は x 266・y 36・200 × 21").toEqual([266, 36, 200, 21]);
    expect(second.y - first.y, "札の間隔は 24").toBe(24);
    expect(rootOf(ui).focus, "焦点は先頭の札（装備中の物）").toBe(fid.tg("worn"));
    expect(ANVIL_VIEW.header(state, ui, rootOf(ui)).crumbs, "見出しに部位").toContain("右手");
  });

  it("札を選ぶと操作 5 が出て、焦点は選べる最初の操作に移る", () => {
    const { state, ui } = setup();
    press(state, ui, fid.part("mainHand"));
    press(state, ui, fid.tg("stash-a"));
    const hits = menuHits(state, ui);
    ECHO_OPS.forEach((op, i) => {
      const hit = hits.find((h) => h.id === fid.op(op));
      expect(hit?.rect.x, `${op} の位置`).toBe(266 + i * 41);
      expect(hit?.rect.y, `${op} の y`).toBe(162);
    });
    expect(rootOf(ui).focus, "倉庫の物なら砕くから").toBe(fid.op("shatter"));
    press(state, ui, fid.tg("worn"));
    expect(rootOf(ui).focus, "装備中の物は砕けないので注ぎから").toBe(fid.op("pour"));
  });

  it("装備中の物では砕くを選べない", () => {
    const { state, ui } = setup();
    press(state, ui, fid.part("mainHand"));
    press(state, ui, fid.tg("worn"));
    press(state, ui, fid.op("shatter"));
    expect(anvilOf(ui).forge?.op, "操作は選ばれない").toBeNull();
    expect(ui.note?.text.length ?? 0, "理由を知らせる").toBeGreaterThan(0);
    expect(menuHits(state, ui).some((h) => h.id === fid.exec), "実行の札も出ない").toBe(false);
    press(state, ui, fid.op("stir"));
    expect(anvilOf(ui).forge?.op, "煽りは選べる").toBe("stir");
  });

  it("戻るで鍛冶の段を 1 つずつ戻す", () => {
    const { state, ui } = setup();
    press(state, ui, fid.part("mainHand"));
    press(state, ui, fid.tg("stash-a"));
    press(state, ui, fid.op("pour"));
    expect(anvilOf(ui).forge?.op, "注ぎを選んだ（相手を選ぶ段）").toBe("pour");
    press(state, ui, fid.partner("worn"));
    expect(anvilOf(ui).forge?.partnerId, "相手を選んだ（実行の段）").toBe("worn");

    back(state, ui);
    expect(anvilOf(ui).forge?.partnerId, "相手が外れる").toBeNull();
    expect(anvilOf(ui).forge?.op, "操作は残る").toBe("pour");
    back(state, ui);
    expect(anvilOf(ui).forge?.op, "操作が外れる").toBeNull();
    expect(anvilOf(ui).forge?.subjectId, "札は残る").toBe("stash-a");
    back(state, ui);
    expect(anvilOf(ui).forge, "札の段へ").toBeNull();
    expect(anvilOf(ui).slot, "部位は残る").toBe("mainHand");
    expect(rootOf(ui).focus, "焦点は選んでいた札").toBe(fid.tg("stash-a"));
    back(state, ui);
    expect(anvilOf(ui).slot, "部位の段へ").toBeNull();
    expect(rootOf(ui).focus, "焦点は選んでいた部位").toBe(fid.part("mainHand"));
    expect(ui.open, "ここまでは閉じない").toBe(true);
    back(state, ui);
    expect(ui.open, "部位の段で戻ると閉じる").toBe(false);
    expect(state.paused, "止まりも解く").toBe(false);
  });

  it("紋へ替えて戻っても金床の構えのまま", () => {
    const { state, ui } = setup();
    press(state, ui, fid.part("mainHand"));
    switchFace(state, ui, "crest");
    expect(ui.stack[0]?.kind, "紋の面").toBe("crest");
    switchFace(state, ui, "attire");
    expect(anvilOf(ui).slot, "戻ると構えは最初の段から").toBeNull();
    expect(ui.anvilSession, "鍛冶屋の入口のまま").toBe(true);
    closeMenu(state, ui);
    openMenu(state, ui, "attire");
    expect(rootOf(ui).anvil, "持ち物キーで開くと金床の構えにならない").toBeNull();
  });

  it("壺の水位は残響の量に比例し上限で止まる", () => {
    expect(potLevel(0), "空").toBe(0);
    expect(potLevel(ANVIL_POT_FULL / 2), "半分").toBeCloseTo(0.5, 5);
    expect(potLevel(ANVIL_POT_FULL), "満杯").toBe(1);
    expect(potLevel(ANVIL_POT_FULL * 10), "上限で止まる").toBe(1);
    expect(potLevel(-3), "負にならない").toBe(0);
    expect(potLevel(10) / potLevel(5), "量に比例").toBeCloseTo(2, 5);
  });
});

describe("金床の構えの鍛冶", () => {
  it("煽りは装備中の遺物を作り替え、結果を荷札の知らせに出す", () => {
    const { state, ui, craft } = setup();
    press(state, ui, fid.part("mainHand"));
    press(state, ui, fid.tg("worn"));
    press(state, ui, fid.op("stir"));
    expect(rootOf(ui).focus, "選ぶ行の先頭").toBe(fid.trait(0));
    const before = state.profile.equipment.mainHand;
    press(state, ui, fid.trait(1));
    expect(rootOf(ui).focus, "選んだら実行へ").toBe(fid.exec);
    press(state, ui, fid.exec);
    expect(state.profile.equipment.mainHand, "装備中の物が作り替わる").not.toBe(before);
    expect(craft.echoes.umbra, "冥響を払う").toBe(50 - STIR_COST);
    expect(ui.note?.text.length ?? 0, "結果の知らせ").toBeGreaterThan(0);
    expect(anvilOf(ui).forge?.op, "同じ操作のまま次を選べる").toBe("stir");
  });

  it("残響が足りないと実行せず知らせる", () => {
    const { state, ui, craft } = setup(0);
    press(state, ui, fid.part("mainHand"));
    press(state, ui, fid.tg("stash-a"));
    press(state, ui, fid.op("stir"));
    press(state, ui, fid.trait(0));
    press(state, ui, fid.exec);
    expect(craft.echoes.umbra, "残響は動かない").toBe(0);
    expect(ui.note?.text.length ?? 0, "足りない知らせ").toBeGreaterThan(0);
    expect(state.profile.stash.some((it) => it.id === "stash-a"), "物は残る").toBe(true);
  });

  it("注ぎは相手を選んでから実行し、捧げた物は札から消える", () => {
    const { state, ui } = setup();
    press(state, ui, fid.part("mainHand"));
    press(state, ui, fid.tg("stash-a"));
    press(state, ui, fid.op("pour"));
    expect(menuHits(state, ui).filter((h) => h.id.startsWith("partner:")).map((h) => h.id), "相手は装備中を先頭に同じ部位の倉庫").toEqual([fid.partner("worn"), fid.partner("stash-b")]);
    press(state, ui, fid.partner("worn"));
    press(state, ui, fid.exec);
    expect(state.profile.stash.some((it) => it.id === "stash-a"), "捧げた遺物は消える").toBe(false);
    expect(anvilOf(ui).forge?.subjectId, "鍛冶は受け手を見る").toBe("worn");
    expect(anvilRows(state.profile, anvilOf(ui)).map((r) => (r.kind === "subject" ? r.item.id : "?")), "札の並びも更新").toEqual(["worn", "stash-b"]);
  });

  it("砕くは長押しでだけ実行し、砕いたら札の段へ戻る", () => {
    const { state, ui } = setup();
    press(state, ui, fid.part("mainHand"));
    press(state, ui, fid.tg("stash-a"));
    press(state, ui, fid.op("shatter"));
    const exec = hitOf(state, ui, fid.exec);
    expect(exec.act, "決定では実行しない").toBeNull();
    expect(exec.hold?.kind, "長押しで実行").toBe("forgeExecute");
    rootOf(ui).focus = fid.exec;
    updateInventoryUi(state, ui, { ...EMPTY_INPUT, confirmPressed: true }, 0.016, { back: false, confirmHeld: true });
    updateInventoryUi(state, ui, EMPTY_INPUT, 0.016, { back: false, confirmHeld: false });
    expect(state.profile.stash.some((it) => it.id === "stash-a"), "短く押しただけでは残る").toBe(true);
    updateInventoryUi(state, ui, { ...EMPTY_INPUT, confirmPressed: true }, 0.016, { back: false, confirmHeld: true });
    updateInventoryUi(state, ui, EMPTY_INPUT, MENU_HOLD_SECONDS + 0.05, { back: false, confirmHeld: true });
    expect(state.profile.stash.some((it) => it.id === "stash-a"), "長押しで砕ける").toBe(false);
    expect(anvilOf(ui).forge, "砕いた物は無いので札の段へ").toBeNull();
    expect(ui.stack.length, "書付などは積まない").toBe(1);
  });

  it("札が 5 枚を超えると頁送りの札が出て、5 枚ずつ送る", () => {
    const { state, ui } = setup();
    for (let i = 0; i < 4; i++) addToStash(state.profile, makeItem({ id: `extra-${i}`, name: `余りの剣 ${i}`, foundAt: i + 1 }));
    press(state, ui, fid.part("mainHand"));
    const page = MENU_BUDGET.candidates;
    /** 装備中 1 + 倉庫の右手 2 + 余り 4 */
    const TOTAL = 7;
    let ids = menuHits(state, ui).map((h) => h.id);
    expect(ids.filter((id) => id.startsWith("tg:")).length, "1 頁は 5 枚").toBe(page);
    expect(ids, "次の頁の札が出る").toContain(ANVIL_FOCUS.next);
    expect(ids, "最初の頁に前の札は無い").not.toContain(ANVIL_FOCUS.prev);
    press(state, ui, ANVIL_FOCUS.next);
    expect(anvilOf(ui).offset, "次の 5 枚").toBe(page);
    ids = menuHits(state, ui).map((h) => h.id);
    expect(ids.filter((id) => id.startsWith("tg:")).length, "残りの札").toBe(TOTAL - page);
    expect(ids, "前の札が出る").toContain(ANVIL_FOCUS.prev);
    expect(ids, "最後の頁に次の札は無い").not.toContain(ANVIL_FOCUS.next);
    expect(ANVIL_VIEW.edge(state, ui, rootOf(ui), 0, -1), "ホイールの上で戻れる").toBe(true);
    expect(anvilOf(ui).offset, "最初の頁").toBe(0);
  });

  it("書付は焦点の札の遺物を開く", () => {
    const { state, ui } = setup();
    press(state, ui, fid.part("mainHand"));
    rootOf(ui).focus = fid.tg("stash-b");
    expect(ANVIL_VIEW.sheetFor(state, rootOf(ui)), "札の遺物").toEqual({ kind: "item", itemId: "stash-b" });
    rootOf(ui).focus = fid.part("mainHand");
    expect(ANVIL_VIEW.sheetFor(state, rootOf(ui)), "部位は装備中の物").toEqual({ kind: "item", itemId: "worn" });
  });
});
