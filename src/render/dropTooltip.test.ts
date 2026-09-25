import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { VIEW_H, VIEW_W } from "../core/view";
import type { AffixRoll, Item } from "../loot/types";
import { PICKUP } from "../data/tuning";
import type { TipLine } from "./lootUiParts";

/**
 * 床のドロップ品のポップアップ。位置の反転・行数の切り詰め・装備中との差を数値と key で確かめる。
 * 描画はスモークテスト（Canvas は呼び出しを数えるだけの偽物）
 */

function fakeContext(): { ctx: CanvasRenderingContext2D; calls: Map<string, number> } {
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

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "drop-1",
    seed: 1,
    baseKey: "longsword",
    slot: "mainHand",
    rarity: "magic",
    itemLevel: 3,
    name: "床の剣",
    implicit: null,
    affixes: [melee],
    foundDepth: 3,
    foundAt: 0,
    ...overrides,
  };
}

function line(text: string): TipLine {
  return { text, color: "#fff" };
}

describe("ポップアップの位置", () => {
  const W = 100;
  const H = 60;

  it("ふだんはカーソルの右下に置く", async () => {
    const { placeTooltip } = await import("./dropTooltip");
    const r = placeTooltip({ x: 50, y: 50 }, W, H);
    expect(r.x, "右").toBeGreaterThan(50);
    expect(r.y, "下").toBeGreaterThan(50);
  });

  it("右端を越えるなら左へ、下端を越えるなら上へ反転する", async () => {
    const { placeTooltip } = await import("./dropTooltip");
    const anchor = { x: VIEW_W - 20, y: VIEW_H - 20 };
    const r = placeTooltip(anchor, W, H);
    expect(r.x + r.w, "カーソルの左に収まる").toBeLessThanOrEqual(anchor.x);
    expect(r.y + r.h, "カーソルの上に収まる").toBeLessThanOrEqual(anchor.y);
  });

  it("どこに置いても 480x270 の中に収まる", async () => {
    const { placeTooltip } = await import("./dropTooltip");
    for (const anchor of [
      { x: 0, y: 0 },
      { x: VIEW_W, y: 0 },
      { x: 0, y: VIEW_H },
      { x: VIEW_W / 2, y: VIEW_H / 2 },
      { x: VIEW_W, y: VIEW_H },
    ]) {
      const r = placeTooltip(anchor, W, VIEW_H - 10);
      expect(r.x, `x (${anchor.x},${anchor.y})`).toBeGreaterThanOrEqual(0);
      expect(r.y, `y (${anchor.x},${anchor.y})`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, `右端 (${anchor.x},${anchor.y})`).toBeLessThanOrEqual(VIEW_W);
      expect(r.y + r.h, `下端 (${anchor.x},${anchor.y})`).toBeLessThanOrEqual(VIEW_H);
    }
  });
});

describe("行数の切り詰め", () => {
  it("入るならそのまま本文 + 末尾", async () => {
    const { fitTipLines } = await import("./dropTooltip");
    const out = fitTipLines([line("a"), line("b")], [line("c")], 5);
    expect(out.map((l) => l.text)).toEqual(["a", "b", "c"]);
  });

  it("入らなければ本文の後ろを削り、省略の行を挟んで末尾（装備中との差）を残す", async () => {
    const { fitTipLines } = await import("./dropTooltip");
    const body = Array.from({ length: 20 }, (_, i) => line(`b${i}`));
    const tail = [line("t0"), line("t1")];
    const out = fitTipLines(body, tail, 8);
    expect(out, "上限の行数").toHaveLength(8);
    expect(out.slice(-2).map((l) => l.text), "末尾は残る").toEqual(["t0", "t1"]);
    expect(out[0]?.text, "本文の先頭（名前）は残る").toBe("b0");
    expect(out[5]?.text, "省略の行").toBe("…");
  });

  it("画面の高さに入る行数を返す", async () => {
    const { maxTipLines } = await import("./dropTooltip");
    const lineH = 9;
    expect(maxTipLines(lineH) * lineH).toBeLessThanOrEqual(VIEW_H);
    expect(maxTipLines(lineH)).toBeGreaterThan(10);
  });
});

describe("装備中との差", () => {
  it("空いた部位なら、付けたときに上がる能力値を ▲ で良い色にして並べる", async () => {
    const { compareLines, MARK_UP } = await import("./dropTooltip");
    const state = createGame(1);
    state.profile.equipment.mainHand = null;
    const lines = compareLines(state, makeItem());
    const ups = lines.filter((l) => l.mark === MARK_UP);
    expect(ups.length, "上がる行がある").toBeGreaterThan(0);
    for (const l of ups) expect(l.markColor, "上がる行は印と本文が同じ良い色").toBe(l.color);
  });

  it("同じ遺物を装備中なら差は無い（差の行が出ない）", async () => {
    const { compareLines, MARK_UP, MARK_DOWN } = await import("./dropTooltip");
    const state = createGame(1);
    const item = makeItem();
    state.profile.equipment.mainHand = item;
    const lines = compareLines(state, makeItem({ id: "drop-2" }));
    expect(lines.filter((l) => l.mark === MARK_UP || l.mark === MARK_DOWN)).toHaveLength(0);
    expect(lines).toHaveLength(2);
  });

  it("装備中より弱い遺物は ▼ を出し、上がるときと違う色にする", async () => {
    const { compareLines, MARK_UP, MARK_DOWN } = await import("./dropTooltip");
    const state = createGame(1);
    state.profile.equipment.mainHand = null;
    const up = compareLines(state, makeItem()).find((l) => l.mark === MARK_UP);
    state.profile.equipment.mainHand = makeItem({ id: "worn" });
    const down = compareLines(state, makeItem({ id: "weak", affixes: [] })).find((l) => l.mark === MARK_DOWN);
    expect(down, "下がる行がある").toBeDefined();
    expect(down?.color, "色が違う").not.toBe(up?.color);
  });
});

describe("注目の描画", () => {
  it("注目中の遺物・スキル石に環と性能を描き、fillText を直接使わない", async () => {
    const { drawDropFocus } = await import("./dropTooltip");
    const { dropItem, dropSkillStone } = await import("../system/loot");
    const state = createGame(1);
    const p = state.player.body.pos;
    dropItem(state, p);
    const fi = state.floorItems[state.floorItems.length - 1]!;
    fi.pos = { x: p.x + 10, y: p.y };
    const { ctx, calls } = fakeContext();
    // 照準が無い（パッド）ときは手の届く最寄りを注目する
    drawDropFocus(ctx, state, null, 0, 0);
    expect(calls.get("arc") ?? 0, "環を描く").toBeGreaterThan(0);
    expect(calls.get("fillText") ?? 0, "fillText を直接使わない").toBe(0);

    state.floorItems = [];
    dropSkillStone(state, p);
    const fs = state.skills.floorStones[state.skills.floorStones.length - 1]!;
    fs.pos = { x: p.x + PICKUP.reach / 2, y: p.y };
    const stone = fakeContext();
    drawDropFocus(stone.ctx, state, null, 0, 0);
    expect(stone.calls.get("arc") ?? 0, "スキル石にも環を描く").toBeGreaterThan(0);
  });

  it("showTooltip: false では環だけ描き、性能ポップアップ（fillRect）は描かない", async () => {
    const { drawDropFocus } = await import("./dropTooltip");
    const { dropItem } = await import("../system/loot");
    const state = createGame(1);
    const p = state.player.body.pos;
    dropItem(state, p);
    const fi = state.floorItems[state.floorItems.length - 1]!;
    fi.pos = { x: p.x + 10, y: p.y };
    const { ctx, calls } = fakeContext();
    drawDropFocus(ctx, state, null, 0, 0, false);
    expect(calls.get("arc") ?? 0, "環は描く").toBeGreaterThan(0);
    expect(calls.get("fillRect") ?? 0, "ポップアップの矩形は描かない").toBe(0);
  });

  it("注目するものが無ければ何も描かない", async () => {
    const { drawDropFocus } = await import("./dropTooltip");
    const state = createGame(1);
    state.floorItems = [];
    state.skills.floorStones = [];
    const { ctx, calls } = fakeContext();
    drawDropFocus(ctx, state, { x: 10, y: 10 }, 0, 0);
    expect(calls.size).toBe(0);
  });
});

describe("床のツールチップの種類の行", () => {
  it("刀のベースは名前の下の行が武器種名『刀』で始まり、ベース名は詳しくの行に残る", async () => {
    const { dropTipContent } = await import("./dropTooltip");
    const state = createGame(1);
    const item = makeItem({ baseKey: "katana", slot: "mainHand" });
    const { body } = dropTipContent(state, { kind: "item", id: 1, item, pos: { x: 0, y: 0 }, inReach: true });
    const texts = body.map((l) => l.text);
    expect(texts.some((t) => t.startsWith("刀・")), texts.join(" / ")).toBe(true);
    expect(texts.some((t) => t.startsWith("打刀・")), "ベース名の種類の行は出さない").toBe(false);
    expect(texts, "ベース名").toContain("ベース: 打刀");
  });
});
