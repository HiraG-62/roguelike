import { describe, expect, it } from "vitest";
import type { GameState, Jin, JinzuStroke } from "../core/state";
import { JINZU } from "../data/tuning";
import { arena, placeEnemy } from "../system/testHelpers";
import { jinHudTitle } from "./jinUi";
import { drawHonjinBanner, drawJinzu, drawMinimapHonjin } from "./jinzuUi";

/** 本陣の陣図の描画（render/jinzuUi.ts）。Canvas を使わず、描画命令の呼び出しを数えて「描いたか」を見る */

interface Counts {
  strokes: number;
  fills: number;
  arcs: number;
  rotates: number;
}

function countingCtx(): { ctx: CanvasRenderingContext2D; counts: Counts } {
  const counts: Counts = { strokes: 0, fills: 0, arcs: 0, rotates: 0 };
  const noop = (): void => {};
  const target: Record<string, unknown> = {
    stroke: () => counts.strokes++,
    fill: () => counts.fills++,
    fillRect: () => counts.fills++,
    arc: () => counts.arcs++,
    rotate: () => counts.rotates++,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  const ctx = new Proxy(target, {
    get: (t, key: string) => t[key] ?? noop,
    set: (t, key: string, value: unknown) => {
      t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, counts };
}

function stroke(state: JinzuStroke["state"], patch: Partial<JinzuStroke> = {}): JinzuStroke {
  const points = Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 10, y: 100 + Math.sin(i / 2) * 8 }));
  return { kind: "hook", points, squad: [], state, appearAt: 0, progress: 0, hit: false, jammed: false, finished: [], ...patch };
}

function honjinState(phase: NonNullable<Jin["jinzu"]>["phase"], strokes: JinzuStroke[]): GameState {
  const state = arena();
  const leader = placeEnemy(state, "eye", 60, 0);
  const jin: Jin = {
    id: 1,
    roomIndex: 1,
    formation: "craneWing",
    center: { x: 100, y: 100 },
    facing: { x: 1, y: 0 },
    leaderId: leader.id,
    hpMul: 1,
    morale: 8,
    moraleMax: 8,
    phase: "engaged",
    secondWaveAt: null,
    deathsTick: -1,
    deathsInTick: 0,
    honjin: true,
    jinzu: { phase, t: 0.3, strokeSec: JINZU.strokeSec, target: { x: 150, y: 100 }, origin: { x: 90, y: 100 }, strokes, surges: 1, readyAt: 0 },
  };
  leader.jinId = 1;
  leader.jinzuRun = { jin: 1, mode: "brush", stroke: -1, next: 1, delay: 0, time: 0, stuck: 0 };
  state.jins = [jin];
  return state;
}

describe("陣図の描画", () => {
  it("筆の間: 下絵の画・墨の画・的・軍配を描く", () => {
    const state = honjinState("brush", [stroke("ink"), stroke("sketch"), stroke("pending")]);
    const { ctx, counts } = countingCtx();
    drawJinzu(ctx, state);
    expect(counts.strokes, "線を引く").toBeGreaterThan(0);
    expect(counts.arcs, "的の円と軍配").toBeGreaterThan(0);
  });

  it("構え・総掛かり: 太い墨の画と矢じりを描き、走り終えた画は掠れて消える", () => {
    const hold = honjinState("hold", [stroke("ink"), stroke("ink")]);
    const a = countingCtx();
    drawJinzu(a.ctx, hold);
    expect(a.counts.strokes, "墨の画").toBeGreaterThan(0);
    expect(a.counts.fills, "矢じり").toBeGreaterThan(0);
    const done = honjinState("regroup", [stroke("done", { endedAt: hold.time })]);
    const fresh = countingCtx();
    drawJinzu(fresh.ctx, done);
    expect(fresh.counts.strokes, "走り終えた直後はまだ薄く残る").toBeGreaterThan(0);
    done.time += JINZU.draw.fadeSec + 1;
    const gone = countingCtx();
    drawJinzu(gone.ctx, done);
    expect(gone.counts.strokes, "掠れて消えたら描かない").toBe(0);
  });

  it("筆折れ: 消えた画は breakFadeSec の間だけ擦れて残り、過ぎたら描かない", () => {
    const state = honjinState("regroup", [stroke("erased", { endedAt: 0 })]);
    state.time = JINZU.draw.breakFadeSec / 2;
    const during = countingCtx();
    drawJinzu(during.ctx, state);
    expect(during.counts.strokes, "擦れの途中").toBeGreaterThan(0);
    state.time = JINZU.draw.breakFadeSec + 1;
    const after = countingCtx();
    drawJinzu(after.ctx, state);
    expect(after.counts.strokes, "消えた後").toBe(0);
  });

  it("陣図の無い陣・画の無い待ちでは何も描かない", () => {
    const state = honjinState("ready", []);
    const { ctx, counts } = countingCtx();
    drawJinzu(ctx, state);
    expect(counts.strokes + counts.fills + counts.arcs).toBe(0);
  });

  it("旗倒れ: 倒れる馬印と墨の波紋を描き、波紋が終われば描かない", () => {
    const state = honjinState("spent", []);
    const jin = state.jins[0]!;
    jin.flagFall = { pos: { x: 90, y: 100 }, at: 0 };
    state.time = JINZU.draw.flagFallSec / 2;
    const during = countingCtx();
    drawJinzu(during.ctx, state);
    expect(during.counts.rotates, "傾く").toBeGreaterThan(0);
    expect(during.counts.arcs, "波紋").toBeGreaterThan(0);
    state.time = JINZU.draw.rippleSec + JINZU.draw.flagFallSec * 3;
    const after = countingCtx();
    drawJinzu(after.ctx, state);
    expect(after.counts.arcs, "終われば描かない").toBe(0);
  });
});

describe("馬印とミニマップの印", () => {
  it("馬印は竿と旗を描く", () => {
    const { ctx, counts } = countingCtx();
    drawHonjinBanner(ctx, 50, 50);
    expect(counts.fills).toBeGreaterThan(5);
  });

  it("ミニマップには決着していない本陣だけ、探索の前から旗を打つ", () => {
    const state = honjinState("ready", []);
    const live = countingCtx();
    drawMinimapHonjin(live.ctx, state, 0, 0, 1);
    expect(live.counts.fills, "旗を打つ").toBeGreaterThan(0);
    state.jins[0]!.phase = "settled";
    const settled = countingCtx();
    drawMinimapHonjin(settled.ctx, state, 0, 0, 1);
    expect(settled.counts.fills, "決着したら出さない").toBe(0);
  });
});

describe("名札の見出し", () => {
  it("本陣は「鶴翼の本陣」、素の陣は「鶴翼の陣」", () => {
    expect(jinHudTitle({ formation: "craneWing", honjin: true })).toBe("鶴翼の本陣");
    expect(jinHudTitle({ formation: "craneWing" })).toBe("鶴翼の陣");
  });
});
