import { describe, expect, it } from "vitest";
import { VIEW_W } from "../core/view";
import { arena } from "../system/testHelpers";
import { FLASK_CELLS_MAX, FLASK_CELL_GAP, FLASK_CELL_H, FLASK_CELL_W, drawFlaskHud, flaskCellCount, flaskCellFilled, flaskHudLayout } from "./flaskHud";
import { rectsOverlap } from "./renderMath";

/** renderer.ts の HUD: 気力バーの右端と、ダッシュのチャージの行（HUD_PIP_Y - 1） */
const BAR_RIGHT = 118;
const PIP_ROW_Y = 23;
/** ダッシュのチャージ（左寄せ。HUD_BAR_X から 1 つ 7px、外枠 1px ずつ）の見積り */
const PIP_X = 18;
const PIP_STEP = 7;
const PIP_H = 5;

describe("瓶の枡の数", () => {
  it("上限の数だけ。0 以下は 0、多すぎるなら FLASK_CELLS_MAX", () => {
    expect(flaskCellCount(2), "上限 2").toBe(2);
    expect(flaskCellCount(0), "上限 0").toBe(0);
    expect(flaskCellCount(-1), "負").toBe(0);
    expect(flaskCellCount(2.9), "小数は切り捨て").toBe(2);
    expect(flaskCellCount(99), "上限あり").toBe(FLASK_CELLS_MAX);
  });

  it("持っている本数ぶんだけ左から満ちる", () => {
    expect([0, 1, 2].map((i) => flaskCellFilled(1, i))).toEqual([true, false, false]);
    expect([0, 1].map((i) => flaskCellFilled(0, i)), "0 本は全部空").toEqual([false, false]);
  });
});

describe("瓶の枡の配置", () => {
  it("右端を right に揃え、枡は等間隔で重ならない", () => {
    const layout = flaskHudLayout(BAR_RIGHT, PIP_ROW_Y, 3);
    expect(layout.cells.length).toBe(3);
    const last = layout.cells[2];
    expect(last === undefined ? 0 : last.x + last.w, "右端").toBe(BAR_RIGHT);
    for (let i = 1; i < layout.cells.length; i++) {
      const a = layout.cells[i - 1];
      const b = layout.cells[i];
      if (!a || !b) continue;
      expect(b.x - (a.x + a.w), "間隔").toBe(FLASK_CELL_GAP);
    }
    expect(layout.bounds.w, "幅").toBe(3 * FLASK_CELL_W + 2 * FLASK_CELL_GAP);
    expect(layout.bounds.h, "高さ").toBe(FLASK_CELL_H);
  });

  it("枡が 0 個なら外接矩形も空", () => {
    const layout = flaskHudLayout(BAR_RIGHT, PIP_ROW_Y, 0);
    expect(layout.cells).toEqual([]);
    expect(layout.bounds.w).toBe(0);
    expect(layout.bounds.h).toBe(0);
  });

  it("上限いっぱい（8 枡）でも画面内に収まり、ダッシュのチャージ（最大 4 回）と重ならない", () => {
    const layout = flaskHudLayout(BAR_RIGHT, PIP_ROW_Y, FLASK_CELLS_MAX);
    expect(layout.bounds.x, "画面内").toBeGreaterThanOrEqual(0);
    expect(layout.bounds.x + layout.bounds.w, "画面内").toBeLessThanOrEqual(VIEW_W);
    const dashCharges = 4;
    const pips = { x: PIP_X - 1, y: PIP_ROW_Y, w: dashCharges * PIP_STEP, h: PIP_H };
    expect(rectsOverlap(layout.bounds, pips), "チャージの行と重ならない").toBe(false);
  });
});

describe("瓶の HUD の描画", () => {
  /** fillRect の呼び出しと色を記録するだけの ctx */
  function recorder(): { ctx: CanvasRenderingContext2D; fills: { color: string; x: number }[] } {
    const fills: { color: string; x: number }[] = [];
    const rec = {
      fillStyle: "",
      fillRect(x: number): void {
        fills.push({ color: rec.fillStyle, x });
      },
    };
    const ctx = rec as unknown as CanvasRenderingContext2D;
    return { ctx, fills };
  }

  it("上限の数だけ枡を塗り、持っている本数ぶんだけ色付き（中身の色の種類で数える）", () => {
    const state = arena(5);
    state.player.flasks = 1;
    const { ctx, fills } = recorder();
    drawFlaskHud(ctx, state, BAR_RIGHT, PIP_ROW_Y);
    // 1 枡につき 外枠 + 中身 の 2 回
    expect(fills.length, "枡の数 × 2").toBe(state.stats.flaskMax * 2);
    const inner = fills.filter((_, i) => i % 2 === 1).map((f) => f.color);
    expect(new Set(inner).size, "満ちた枡と空の枡で色が違う").toBe(2);
    expect(inner[0], "左が満ちる").not.toBe(inner[1]);
  });

  it("拠点（sandbox）では描かない", () => {
    const state = arena(5);
    state.sandbox = true;
    const { ctx, fills } = recorder();
    drawFlaskHud(ctx, state, BAR_RIGHT, PIP_ROW_Y);
    expect(fills.length).toBe(0);
  });

  it("描いても state.rng を使わず、本数も変えない（読むだけ）", () => {
    const state = arena(5);
    let draws = 0;
    const spy = (): number => {
      draws++;
      return 0;
    };
    state.rng = { next: spy, int: spy, chance: () => (spy(), false), pick: <T>(arr: readonly T[]) => (spy(), arr[0] as T) };
    const flasks = state.player.flasks;
    drawFlaskHud(recorder().ctx, state, BAR_RIGHT, PIP_ROW_Y);
    expect(draws, "乱数を引かない").toBe(0);
    expect(state.player.flasks, "本数は変わらない").toBe(flasks);
  });
});
