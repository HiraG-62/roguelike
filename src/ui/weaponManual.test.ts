import { describe, expect, it } from "vitest";
import { MANUAL_KEYS } from "../meta/weaponManual";
import { MANUAL_LAYOUT, type ManualInput, createManualUi, manualDocRows, selectedMove, stepManualUi, syncManualDemo } from "./weaponManual";

const LINE_H = 10;
/** 1 字 = 8px として折る（描画の文字幅の代わり） */
const wrap = (t: string, w: number): string[] => {
  const per = Math.max(1, Math.floor(w / 8));
  const out: string[] = [];
  for (let i = 0; i < t.length; i += per) out.push(t.slice(i, i + per));
  return out;
};
const NONE: ManualInput = { navX: 0, navY: 0, wheel: 0, aim: null, click: false, confirm: false };

describe("武器指南書の画面", () => {
  it("←→ で武器種を替えると技は先頭に戻り、端で回る", () => {
    const ui = createManualUi("sword");
    stepManualUi(ui, { ...NONE, navY: 1 }, wrap, LINE_H);
    expect(stepManualUi(ui, { ...NONE, navX: 1 }, wrap, LINE_H)).toBe("weapon");
    expect(ui.page.key).toBe(MANUAL_KEYS[1]);
    expect(ui.move).toBe(0);
    stepManualUi(ui, { ...NONE, navX: -1 }, wrap, LINE_H);
    stepManualUi(ui, { ...NONE, navX: -1 }, wrap, LINE_H);
    expect(ui.page.key).toBe(MANUAL_KEYS[MANUAL_KEYS.length - 1]);
  });

  it("↓ で技を進め、選んだ技の行が頁の窓に入るよう送る", () => {
    const ui = createManualUi("twinBlades");
    const n = ui.page.moves.length;
    for (let i = 0; i < n + 3; i++) stepManualUi(ui, { ...NONE, navY: 1 }, wrap, LINE_H);
    expect(ui.move).toBe(n - 1);
    const doc = manualDocRows(ui, wrap, LINE_H);
    const row = doc.rows.find((r) => r.kind === "move" && r.index === ui.move);
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.y).toBeGreaterThanOrEqual(ui.docScroll);
    expect(row.y + row.h).toBeLessThanOrEqual(ui.docScroll + MANUAL_LAYOUT.doc.h);
  });

  it("頁の行は名前・特色・型と戦意の後に、技の一覧の見出しと技の行が並ぶ", () => {
    const ui = createManualUi("sword");
    const doc = manualDocRows(ui, wrap, LINE_H);
    expect(doc.rows[0]?.kind).toBe("name");
    expect(doc.rows.filter((r) => r.kind === "move").length).toBe(ui.page.moves.length);
    expect(doc.rows.some((r) => r.kind === "group" && r.text === "コンボ派生")).toBe(true);
  });

  it("技の行をクリックするとその技を選ぶ", () => {
    const ui = createManualUi("sword");
    const doc = manualDocRows(ui, wrap, LINE_H);
    const row = doc.rows.find((r) => r.kind === "move" && r.index === 2);
    if (row === undefined) throw new Error("技の行が無い");
    const aim = { x: MANUAL_LAYOUT.doc.x + 10, y: MANUAL_LAYOUT.doc.y + row.y + row.h / 2 };
    expect(stepManualUi(ui, { ...NONE, aim, click: true }, wrap, LINE_H)).toBe("move");
    expect(ui.move).toBe(2);
  });

  it("武器種の一覧をクリックするとその武器種の頁を開く", () => {
    const ui = createManualUi("sword");
    const aim = { x: MANUAL_LAYOUT.list.x + 4, y: MANUAL_LAYOUT.list.y + MANUAL_LAYOUT.minRowGap * 3 + 2 };
    expect(stepManualUi(ui, { ...NONE, aim, click: true }, wrap, LINE_H)).toBe("weapon");
    expect(ui.page.key).toBe(MANUAL_KEYS[3]);
  });

  it("実演は選んだ技が変わったときだけ作り直し、木人の距離は技ごとに 1 回だけ合わせ込む", () => {
    const ui = createManualUi("sword");
    const first = syncManualDemo(ui, 1);
    expect(syncManualDemo(ui, 1)).toBe(first);
    stepManualUi(ui, { ...NONE, navY: 1 }, wrap, LINE_H);
    const second = syncManualDemo(ui, 1);
    expect(second).not.toBe(first);
    expect(ui.foeDistances.size).toBe(2);
    expect(second?.state.map).toBe(first?.state.map);
    expect(selectedMove(ui)?.key).toBe(ui.page.moves[1]?.key);
  });
});
