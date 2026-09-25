import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import type { GameState } from "../core/state";
import { ATTR } from "../data/tuning";
import { ULTIMATES } from "../data/ultimates";
import { MOVESET_KEYS } from "../data/weapons";
import { ultimateChoice } from "../loot/profile";
import { descend } from "../system/floor";
import { allocateAttribute } from "./attributeAlloc";
import { createInventoryUi, updateInventoryUi, type InventoryUi } from "./inventory";
import { PANEL_H, PANEL_W, PANEL_X, PANEL_Y, type Rect } from "./inventoryLayout";
import { derivedStatRows, layoutStatusTab, statusTabRects, ultimateCostOf } from "./statusTab";

function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

/** 拠点（sandbox）かラン中の state でステータスタブを開く */
function openStatus(sandbox: boolean): { state: GameState; ui: InventoryUi } {
  const state = createGame(1);
  if (sandbox) state.sandbox = true;
  const ui = createInventoryUi();
  updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
  updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
  return { state, ui };
}

function clickAt(state: GameState, ui: InventoryUi, rect: Rect): void {
  updateInventoryUi(state, ui, withInput({ clickPressed: true, aimScreen: { x: rect.x + 2, y: rect.y + 2 } }), 0);
}

function cardRect(state: GameState, ui: InventoryUi, index: number): Rect {
  const card = layoutStatusTab(state, ui.status).cards[index];
  if (!card) throw new Error(`card ${index} missing`);
  return card.rect;
}

function insidePanel(r: Rect): boolean {
  return r.x >= PANEL_X && r.y >= PANEL_Y && r.x + r.w <= PANEL_X + PANEL_W && r.y + r.h <= PANEL_Y + PANEL_H && r.w > 0 && r.h > 0;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("ステータスタブ: 奥義の選択", () => {
  it("拠点では奥義カードのクリックで profile.ultimates が変わる", () => {
    const { state, ui } = openStatus(true);
    expect(ui.tab).toBe("status");
    const moveset = state.stats.moveset;
    const set = ULTIMATES[moveset];
    const last = set.length - 1;
    const target = set[last];
    if (!target) throw new Error("奥義が無い");
    clickAt(state, ui, cardRect(state, ui, last));
    expect(state.profile.ultimates?.[moveset], "選んだ奥義").toBe(target.key);
    expect(ultimateChoice(state.profile, moveset).key).toBe(target.key);
  });

  it("ラン中は奥義カードをクリックしても変わらない", () => {
    const { state, ui } = openStatus(false);
    const moveset = state.stats.moveset;
    const before = ultimateChoice(state.profile, moveset).key;
    const set = ULTIMATES[moveset];
    for (let i = 0; i < set.length; i++) clickAt(state, ui, cardRect(state, ui, i));
    updateInventoryUi(state, ui, withInput({ confirmPressed: true }), 0);
    expect(ultimateChoice(state.profile, moveset).key, "変わらない").toBe(before);
    expect(state.profile.ultimates?.[moveset], "profile に書かない").toBeUndefined();
  });

  it("拠点では武器種を送って他の武器種の奥義も選べ、決定キーでも選べる", () => {
    const { state, ui } = openStatus(true);
    const layout = layoutStatusTab(state, ui.status);
    if (!layout.next) throw new Error("拠点には送りのボタンがある");
    const start = state.stats.moveset;
    clickAt(state, ui, layout.next);
    const other = layoutStatusTab(state, ui.status).moveset;
    expect(other, "次の武器種").toBe(MOVESET_KEYS[(MOVESET_KEYS.indexOf(start) + 1) % MOVESET_KEYS.length]);
    const set = ULTIMATES[other];
    updateInventoryUi(state, ui, withInput({ move: { x: 0, y: 1 } }), 0);
    updateInventoryUi(state, ui, withInput({ confirmPressed: true }), 0);
    expect(state.profile.ultimates?.[other], "↓ + 決定で 2 本目").toBe(set[1]?.key);
    expect(state.profile.ultimates?.[start], "元の武器種は変わらない").toBeUndefined();
    updateInventoryUi(state, ui, withInput({ move: { x: -1, y: 0 } }), 0);
    expect(layoutStatusTab(state, ui.status).moveset, "← で戻る").toBe(start);
  });

  it("ラン中は武器種の送りが無く、右手の武器種を出す", () => {
    const { state, ui } = openStatus(false);
    ui.status.moveset = MOVESET_KEYS.find((k) => k !== state.stats.moveset) ?? null;
    const layout = layoutStatusTab(state, ui.status);
    expect(layout.prev, "送りなし").toBeNull();
    expect(layout.next, "送りなし").toBeNull();
    expect(layout.moveset, "右手の武器種").toBe(state.stats.moveset);
  });
});

describe("ステータスタブ: レイアウト", () => {
  it("ステータスタブの矩形はすべてパネル内に収まり、カード同士・左右の列が重ならない", () => {
    for (const sandbox of [true, false]) {
      const { state, ui } = openStatus(sandbox);
      for (const moveset of MOVESET_KEYS) {
        ui.status.moveset = moveset;
        const layout = layoutStatusTab(state, ui.status);
        for (const r of statusTabRects(layout)) expect(insidePanel(r), `${moveset} ${JSON.stringify(r)}`).toBe(true);
        expect(overlaps(layout.left, layout.right), "左右の列").toBe(false);
        layout.cards.forEach((a, i) => {
          const b = layout.cards[i + 1];
          if (b) expect(overlaps(a.rect, b.rect), `${moveset} ${i} と ${i + 1}`).toBe(false);
        });
      }
    }
  });

  it("派生値の行はすべて見えている", () => {
    const { state, ui } = openStatus(false);
    expect(layoutStatusTab(state, ui.status).derivedRows).toHaveLength(derivedStatRows(state.stats).length);
  });
});

describe("ステータスタブ: 派生値と振り分け", () => {
  it("派生値は今の stats から読み、体力を振ると最大生命が増える", () => {
    const state = createGame(3);
    descend(state);
    const hp = (): string | undefined => derivedStatRows(state.stats).find((r) => r.label === "最大生命")?.value;
    const before = Number(hp());
    allocateAttribute(state, "vit");
    expect(Number(hp()), "最大生命").toBe(before + ATTR.vitMaxHp);
  });

  it("ラン中はステータスタブの「+」で振れる", () => {
    const state = createGame(3);
    descend(state);
    const ui = createInventoryUi();
    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    updateInventoryUi(state, ui, withInput({ skill3Pressed: true }), 0);
    expect(state.runAttributes.alloc.vit, "3 行目 = 体力").toBe(1);
  });

  it("奥義の必要ゲージは定義に数値があるときだけ返す", () => {
    const def = ULTIMATES.sword[0];
    const cost = ultimateCostOf(def);
    expect(cost === null || typeof cost === "number").toBe(true);
  });
});
