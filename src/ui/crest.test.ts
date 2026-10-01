import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { FrameInput } from "../core/input";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { createCraftSave } from "../loot/craftingStore";
import { generateItem } from "../loot/generator";
import type { AffixRoll, Item } from "../loot/types";
import { generateSkillStone } from "../skills/generator";
import { addStone, equipStone } from "../skills/persistence";
import { BOONS, BOON_KEYS } from "../system/boonDefs";
import { withInput } from "../system/testHelpers";
import { CREST_VIEW, ownedLineages, removalLine, removalDeltas } from "./crest";
import { crestShape } from "./crestShape";
import { createInventoryUi, menuHits, updateInventoryUi } from "./inventory";
import { openMenu } from "./menuActions";
import { fid } from "./menuFocus";
import { type InventoryUi, type MenuHit, type MenuView, topView } from "./menuState";

const burn: AffixRoll = { key: "burn", value: 12, value2: 4, nominal: 12, flux: 0, color: "crimson", origin: "found" };
const melee: AffixRoll = { key: "damageVsStaggered", value: 30, nominal: 25, flux: 0.6, color: "crimson", origin: "found" };

function wornRelic(): Item {
  return { ...generateItem(createRng(7), { itemLevel: 1, foundDepth: 1, now: 100 }), id: "worn-main", slot: "mainHand", affixes: [burn, melee], namedKey: undefined };
}

/** 遺物・石・祝福がそろった state（帯 4 + 伏流 2、描けない系統あり） */
function richState(): GameState {
  const state = createGame(1);
  state.profile.equipment.mainHand = wornRelic();
  const stone = generateSkillStone(createRng(9), { foundDepth: 4, now: 123 });
  addStone(state.skills.profile, stone);
  equipStone(state.skills.profile, stone.id, 1);
  state.boons = BOON_KEYS.slice(0, 60);
  return state;
}

function openCrest(state: GameState): InventoryUi {
  const ui = createInventoryUi(createCraftSave());
  openMenu(state, ui, "attire");
  ui.stack = [{ kind: "crest", focus: null }];
  return ui;
}

function frame(state: GameState, ui: InventoryUi, input: Partial<FrameInput>): void {
  updateInventoryUi(state, ui, withInput(input), 1 / 60);
}

/** 紋の面（1 段目）の焦点を置いて決定する */
function confirmOn(state: GameState, ui: InventoryUi, focus: string): void {
  const top = topView(ui);
  if (top === null) throw new Error("開いていない");
  top.focus = focus;
  frame(state, ui, { confirmPressed: true });
}

function top(ui: InventoryUi): MenuView {
  const v = topView(ui);
  if (v === null) throw new Error("頁が無い");
  return v;
}

function jumpHit(hits: readonly MenuHit[], kind: string): MenuHit {
  const hit = hits.find((h) => h.act?.kind === "jump" && h.act.source.kind === kind);
  if (hit === undefined) throw new Error(`${kind} の珠が無い`);
  return hit;
}

describe("紋の面", () => {
  it("珠で決定すると装束のその部位へ跳ぶ", () => {
    const state = richState();
    const ui = openCrest(state);
    const hit = jumpHit(menuHits(state, ui), "relic");
    confirmOn(state, ui, hit.id);
    expect(ui.stack.map((v) => v.kind), "装束へ").toEqual(["attire"]);
    expect(top(ui).focus, "右手に焦点").toBe(fid.part("mainHand"));
  });

  it("石の珠はスキルの頁、加護の祝福は加護の頁、流儀・型は書付「体」へ跳ぶ", () => {
    const state = richState();
    const ui = openCrest(state);
    const hits = menuHits(state, ui);

    confirmOn(state, ui, jumpHit(hits, "stone").id);
    expect(ui.stack.map((v) => v.kind), "石 → スキルの頁").toEqual(["attire", "skills"]);

    const graceHit = hits.find((h) => h.act?.kind === "jump" && h.act.source.kind === "boon" && BOONS[h.act.source.id as keyof typeof BOONS].action !== undefined);
    if (graceHit === undefined) throw new Error("加護の珠が無い");
    ui.stack = [{ kind: "crest", focus: null }];
    confirmOn(state, ui, graceHit.id);
    expect(ui.stack.map((v) => v.kind), "加護 → 加護の頁").toEqual(["crest", "act"]);

    // 祝福が多いと流儀・型の珠は畳まれるので、素の state で見る
    const plain = createGame(1);
    const plainUi = openCrest(plain);
    const bodyHit = menuHits(plain, plainUi).find((h) => h.act?.kind === "jump" && (h.act.source.kind === "job" || h.act.source.kind === "form" || h.act.source.kind === "reforge"));
    if (bodyHit === undefined) throw new Error("流儀・型の珠が無い");
    confirmOn(plain, plainUi, bodyHit.id);
    const sheet = top(plainUi);
    expect(sheet.kind === "sheet" ? sheet.subject.kind : null, "流儀・型 → 書付「体」").toBe("body");
  });

  it("帯で決定すると系統の頁が開く", () => {
    const state = richState();
    const ui = openCrest(state);
    const row = crestShape(state).rows[0];
    if (row === undefined) throw new Error("帯が無い");
    confirmOn(state, ui, fid.band(row.keyword));
    const view = top(ui);
    expect(ui.stack.map((v) => v.kind), "紋の上に系統の頁").toEqual(["crest", "flow"]);
    expect(view.kind === "flow" ? view.keyword : null, "その系統").toBe(row.keyword);
  });

  it("伏流の＋で系統で絞った候補が積まれる", () => {
    const state = createGame(1);
    const ui = openCrest(state);
    const under = crestShape(state).rows.find((r) => r.undercurrent && r.plus !== null);
    if (under === undefined || under.plus === null) throw new Error("＋のある伏流が無い");
    confirmOn(state, ui, fid.plus(under.keyword, under.plus));
    const view = top(ui);
    expect(view.kind, "候補の頁").toBe("candidates");
    expect(view.kind === "candidates" ? view.target : null, "その系統の足りない側").toEqual({ kind: "flow", keyword: under.keyword, verb: under.plus });
  });

  it("台の身で装束のその部位、加護の帯で加護の頁、系譜で書付「系譜」", () => {
    const state = richState();
    const ui = openCrest(state);
    confirmOn(state, ui, fid.daiPart("head"));
    expect(ui.stack.map((v) => v.kind), "身 → 装束").toEqual(["attire"]);
    expect(top(ui).focus, "頭に焦点").toBe(fid.part("head"));

    ui.stack = [{ kind: "crest", focus: null }];
    confirmOn(state, ui, fid.daiAct("dash"));
    const act = top(ui);
    expect(act.kind === "act" ? act.action : null, "ダッシュの加護の頁").toBe("dash");

    ui.stack = [{ kind: "crest", focus: null }];
    const lineage = ownedLineages(state)[0];
    if (lineage === undefined) throw new Error("系譜が無い");
    confirmOn(state, ui, fid.daiLineage(lineage.lineage));
    const sheet = top(ui);
    expect(sheet.kind === "sheet" ? sheet.subject : null, "書付「系譜」").toEqual({ kind: "lineage", lineage: lineage.lineage });
  });

  it("5 本目以降の系統は系統を選ぶ盤から開ける", () => {
    const state = richState();
    const hidden = crestShape(state).hidden;
    const first = hidden[0];
    if (first === undefined) throw new Error("描けない系統が無い");
    const ui = openCrest(state);
    expect(menuHits(state, ui).some((h) => h.id === fid.board), "盤の入口がある").toBe(true);
    confirmOn(state, ui, fid.board);
    const board = top(ui);
    expect(board.kind, "盤").toBe("flowBoard");
    expect(board.focus, "描けない系統の先頭に焦点").toBe(fid.kw(first));
    const ids = menuHits(state, ui).map((h) => h.id);
    for (const k of hidden) expect(ids, `${k} は盤から選べる`).toContain(fid.kw(k));
    confirmOn(state, ui, fid.kw(first));
    const flow = top(ui);
    expect(flow.kind === "flow" ? flow.keyword : null, "その系統の頁").toBe(first);
    expect(ui.stack.map((v) => v.kind), "盤は系統の頁に替わる").toEqual(["crest", "flow"]);
  });

  it("描けない系統が無ければ盤の入口は出ない", () => {
    const state = createGame(1);
    state.boons = [];
    state.job = "none";
    const ui = openCrest(state);
    const hidden = crestShape(state).hidden;
    expect(menuHits(state, ui).some((h) => h.id === fid.board), "入口は hidden の有無に従う").toBe(hidden.length > 0);
  });

  it("最初の焦点は先頭の帯で、書付は珠の物を開く", () => {
    const state = richState();
    const ui = openCrest(state);
    frame(state, ui, {});
    expect(top(ui).focus, "先頭の帯").toBe(fid.band(crestShape(state).rows[0]?.keyword ?? "melee"));
    const hit = jumpHit(menuHits(state, ui), "relic");
    const view = top(ui);
    if (view.kind !== "crest") throw new Error("紋ではない");
    view.focus = hit.id;
    expect(CREST_VIEW.sheetFor(state, view), "遺物の珠の書付は 1 品").toEqual({ kind: "item", itemId: "worn-main" });
  });

  it("外すと細る系統は荷札の 2 行目に出る", () => {
    const relic = { kind: "relic" as const, id: "worn-main", slot: "mainHand" as const };
    const boon = { kind: "boon" as const, id: BOON_KEYS[0] ?? "" };
    const cracked = [{ keyword: "burn" as const, from: 2, to: 1, change: "crack" as const }];
    expect(removalLine(relic, []), "細らなければその旨").toBe("細る系統はない");
    expect(removalLine(relic, cracked), "遺物は外すと").toBe("外すと 燃焼系 が細る");
    expect(removalLine(boon, cracked), "祝福は無ければ").toBe("無ければ 燃焼系 が細る");
    const state = richState();
    for (const d of removalDeltas(state, relic)) expect(["crack", "gone"], "細る帯だけを返す").toContain(d.change);
  });
});
