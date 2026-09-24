import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { KEYWORDS, emptyProfile, kw, mergeProfiles } from "../core/keywords";
import { VIEW_H, VIEW_W } from "../core/view";
import type { SynergyBuild, SynergyElement } from "../loot/describe";
import { BOONS } from "../system/boonDefs";
import { CONTENT_BOTTOM, CONTENT_Y, PANEL_W, PANEL_X, type Rect } from "./inventoryLayout";
import {
  SYNERGY_COLS,
  createSynergyPanelUi,
  moveCursor,
  synergyBuild,
  synergyCellAt,
  synergyCellRect,
  synergyDetailRect,
  synergyGridRect,
  synergyLegendRect,
  synergyWords,
  updateSynergyPanel,
} from "./synergyPanel";

function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function buildOf(elements: SynergyElement[]): SynergyBuild {
  return { profile: mergeProfiles(emptyProfile(), ...elements.map((e) => e.keywords)), elements };
}

describe("網タブ: レイアウトと当たり判定", () => {
  it("40 語のセルは重ならず、グリッドと詳細欄はパネル（480x270）に収まる", () => {
    const rects = KEYWORDS.map((_, i) => synergyCellRect(i));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i] as Rect, rects[j] as Rect), `セル ${i} と ${j}`).toBe(false);
      }
    }
    const grid = synergyGridRect();
    const detail = synergyDetailRect();
    for (const [i, r] of rects.entries()) {
      expect(r.x + r.w, `セル ${i} の右端`).toBeLessThanOrEqual(grid.x + grid.w);
      expect(r.y + r.h, `セル ${i} の下端`).toBeLessThanOrEqual(CONTENT_BOTTOM);
    }
    expect(overlaps(grid, detail), "グリッドと詳細欄").toBe(false);
    expect(detail.x + detail.w, "詳細欄の右端").toBeLessThanOrEqual(PANEL_X + PANEL_W);
    expect(detail.y, "詳細欄の上端").toBeGreaterThanOrEqual(CONTENT_Y);
    expect(synergyLegendRect().h, "凡例の高さ").toBeGreaterThan(0);
    expect(PANEL_X + PANEL_W, "画面内").toBeLessThanOrEqual(VIEW_W);
    expect(CONTENT_BOTTOM, "画面内").toBeLessThanOrEqual(VIEW_H);
  });

  it("5 列で KEYWORDS の順に左上から並び、セルの中心で当たり、外は -1", () => {
    expect(synergyCellRect(1).x, "同じ行の次の列").toBeGreaterThan(synergyCellRect(0).x);
    expect(synergyCellRect(SYNERGY_COLS).y, "次の行").toBeGreaterThan(synergyCellRect(0).y);
    KEYWORDS.forEach((_, i) => expect(synergyCellAt(center(synergyCellRect(i))), `セル ${i}`).toBe(i));
    expect(synergyCellAt(center(synergyDetailRect())), "詳細欄はセルでない").toBe(-1);
    expect(synergyCellAt(null), "マウスなし").toBe(-1);
  });
});

describe("シナジータブ: キーワードごとの生む側 / 活かす側", () => {
  it("語の並びは KEYWORDS 順で固定", () => {
    const words = synergyWords(buildOf([]));
    expect(words.map((w) => w.key)).toEqual([...KEYWORDS]);
  });

  it("余り / 不足 / つながり / 無関係 を区別し、生む側 / 活かす側を列挙する", () => {
    const build = buildOf([
      { kind: "boon", name: "燃やす", keywords: kw(["burn", "dash"]) },
      { kind: "skill", name: "燃焼を食う", keywords: kw([], ["burn", "chill"]) },
    ]);
    const byKey = new Map(synergyWords(build).map((w) => [w.key, w]));
    expect(byKey.get("burn")?.state, "出す側と食う側がある").toBe("linked");
    expect(byKey.get("dash")?.state, "出すだけ").toBe("surplus");
    expect(byKey.get("chill")?.state, "食うだけ").toBe("hunger");
    expect(byKey.get("melee")?.state, "誰も関わらない").toBe("none");
    expect(byKey.get("burn")?.producers.map((e) => e.name), "燃焼を出す要素").toEqual(["燃やす"]);
    expect(byKey.get("burn")?.consumers.map((e) => e.name), "燃焼を食う要素").toEqual(["燃焼を食う"]);
  });

  it("synergyBuild は取得済み祝福を要素に含め、その語をビルドに入れる", () => {
    const state = createGame(1);
    state.boons = ["burnSpread"];
    const build = synergyBuild(state);
    const boon = build.elements.find((e) => e.kind === "boon");
    expect(boon?.name, "祝福の名前").toBe(BOONS.burnSpread.name);
    expect(build.profile.consumes, "野火は撃破を食う").toContain("kill");
  });

  it("除外したスキルスロットの石は要素に入らない", () => {
    const state = createGame(1);
    const all = synergyBuild(state).elements.filter((e) => e.kind === "skill").length;
    const without = synergyBuild(state, { skillSlot: 0 }).elements.filter((e) => e.kind === "skill").length;
    expect(without, "スロット 1 を除く").toBeLessThanOrEqual(all);
    if (all > 0) expect(without, "装着中の石が 1 つ減る").toBe(all - 1);
  });
});

describe("網タブ: 入力", () => {
  it("方向入力は押した瞬間に 1 マス動き、押しっぱなしでは動かない", () => {
    const ui = createSynergyPanelUi();
    updateSynergyPanel(ui, withInput({ move: { x: 1, y: 0 } }), 0);
    expect(ui.cursor, "右へ 1").toBe(1);
    updateSynergyPanel(ui, withInput({ move: { x: 1, y: 0 } }), 0);
    expect(ui.cursor, "押しっぱなし").toBe(1);
    updateSynergyPanel(ui, withInput({}), 0);
    updateSynergyPanel(ui, withInput({ move: { x: 0, y: 1 } }), 0);
    expect(ui.cursor, "下へ 1 行").toBe(1 + SYNERGY_COLS);
  });

  it("端では反対側へ回り込む", () => {
    expect(moveCursor(0, -1, 0), "左端から右端へ").toBe(SYNERGY_COLS - 1);
    // 語の数が列数で割り切れないとき最下行は欠ける。同じ列の最下行へ回る
    expect(moveCursor(0, 0, -1), "上端から最下行へ").toBe(Math.floor((KEYWORDS.length - 1) / SYNERGY_COLS) * SYNERGY_COLS);
    const last = KEYWORDS.length - 1;
    expect(moveCursor(last, 1, 1), "最後の語から右下へ: 次の列の最上行へ").toBe(((last % SYNERGY_COLS) + 1) % SYNERGY_COLS);
  });

  it("マウスは動いたときだけホバーの語を選ぶ（止まったマウスが方向入力を上書きしない）", () => {
    const ui = createSynergyPanelUi();
    const at = center(synergyCellRect(7));
    updateSynergyPanel(ui, withInput({ aimScreen: at }), 0);
    expect(ui.cursor, "ホバーした語").toBe(7);
    updateSynergyPanel(ui, withInput({ aimScreen: at, move: { x: 1, y: 0 } }), 0);
    expect(ui.cursor, "方向入力で動く").toBe(8);
    updateSynergyPanel(ui, withInput({ aimScreen: at }), 0);
    expect(ui.cursor, "マウスが止まっていれば戻さない").toBe(8);
  });

  it("点滅用の時計は dt で進む", () => {
    const ui = createSynergyPanelUi();
    updateSynergyPanel(ui, withInput({}), 0.5);
    expect(ui.time).toBeCloseTo(0.5);
  });
});
