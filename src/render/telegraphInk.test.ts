import { describe, expect, it } from "vitest";
import { RENDER_SCALE, VIEW_H, VIEW_W } from "../core/view";
import { ENEMIES } from "../data/enemies";
import { ENEMY_TEMPO, TELEGRAPH, TELEGRAPH_POSE } from "../data/tuning";
import { applyStagger, attackCommitted } from "../system/poise";
import { arena, placeEnemy } from "../system/testHelpers";
import { INK_RAMP } from "./inkStroke";
import { INK_LAYER, InkSurface } from "./inkSurface";
import { segLength, sketchGap, telegraphStage } from "./telegraphInk";
import { TelegraphLayer, type TelegraphHelpers, veered } from "./telegraphLayer";
import { telegraphPose, yellowProgress } from "./telegraphPose";

function windupEnemy(key: string, timerRatio: number) {
  const state = arena();
  const e = placeEnemy(state, key, 100);
  e.phase = "windup";
  e.windupTotal = 1;
  e.phaseTimer = timerRatio;
  e.strikeDir = { x: 1, y: 0 };
  return { state, e };
}

/** 色の代入を集める偽の ctx（メソッドは何もしない）。作業面へ置いた色は作業面の recordColors が集める。
 * 平行移動は自分を画面の中央に置くカメラ（renderer.ts と同じ式）を返す */
function recordingCtx(state?: ReturnType<typeof arena>): { ctx: CanvasRenderingContext2D; colors: Set<string> } {
  const colors = new Set<string>();
  const p = state?.player.body.pos ?? { x: 0, y: 0 };
  const transform = { e: Math.round(VIEW_W / 2 - p.x) * RENDER_SCALE, f: Math.round(VIEW_H / 2 - p.y) * RENDER_SCALE };
  const store: Record<string, unknown> = { getTransform: () => transform };
  const ctx = new Proxy(store, {
    get: (target, key: string) => (key in target ? target[key] : () => undefined),
    set: (target, key: string, value) => {
      if ((key === "strokeStyle" || key === "fillStyle") && typeof value === "string") colors.add(value.toLowerCase());
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, colors };
}

/** 置いた色を集める作業面と、その色と ctx の色を合わせた集合で予告を描く */
function drawColors(state: ReturnType<typeof arena>): Set<string> {
  const surf = new InkSurface();
  surf.recordColors = new Set();
  const { ctx, colors } = recordingCtx(state);
  new TelegraphLayer(surf).draw(ctx, state, HELPERS);
  return new Set([...colors, ...surf.recordColors]);
}

const hex = (rgb: number): string => {
  const r = rgb & 255;
  const g = (rgb >>> 8) & 255;
  const b = (rgb >>> 16) & 255;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
};
/** 墨の段の色（段 1 = 淡墨 … 段 7 = 真っ黒） */
const rampHex = (level: number): string => hex(INK_RAMP[level - 1] ?? 0);

const HELPERS: TelegraphHelpers = { headTop: (e) => e.body.pos.y - 10, glow: () => undefined };

describe("下絵と墨入れの段", () => {
  it("段は attackCommitted と一致する（予備動作の 0.6 の境・攻撃中）", () => {
    const ratio = ENEMY_TEMPO.commitRatio;
    for (const t of [1, ratio + 0.01, ratio, ratio - 0.01, 0.1]) {
      const { e } = windupEnemy("slime", t);
      expect(telegraphStage(e), `残り ${t}`).toBe(attackCommitted(e) ? "ink" : "sketch");
    }
    const { e } = windupEnemy("slime", 0.5);
    e.phase = "strike";
    expect(telegraphStage(e), "攻撃中").toBe("ink");
  });

  it("連撃の続きは最初から墨入れ", () => {
    const { e } = windupEnemy("slime", 1);
    e.chainWindup = true;
    expect(telegraphStage(e)).toBe("ink");
  });
});

describe("下絵の欠け", () => {
  it("欠けの割合は怯み値の割合で増え、上限で丸まる", () => {
    expect(sketchGap(0)).toBe(TELEGRAPH.sketchGapBase);
    expect(sketchGap(1)).toBeLessThanOrEqual(TELEGRAPH.sketchGapMax);
    expect(sketchGap(0.5)).toBeGreaterThan(sketchGap(0.1));
  });
});

describe("筆先が逸れる", () => {
  const seg = { x0: 0, y0: 0, x1: 100, y1: 0 };

  it("筆先が逸れても根元と長さは変わらない", () => {
    const v = veered(seg, 0.4);
    expect(v.x0).toBe(0);
    expect(segLength(v)).toBeCloseTo(100, 5);
    expect(v.y1).not.toBe(0);
  });
});

describe("溜めと張り", () => {
  it("下絵の間は攻撃の逆へのけぞり縦に縮み、進むほど深い", () => {
    const early = windupEnemy("slime", 0.95);
    const late = windupEnemy("slime", ENEMY_TEMPO.commitRatio + 0.01);
    const a = telegraphPose(early.e, 0, { x: 1, y: 0 });
    const b = telegraphPose(late.e, 0, { x: 1, y: 0 });
    expect(a.dx, "攻撃の逆").toBeLessThan(0);
    expect(b.dx).toBeLessThan(a.dx);
    expect(b.sy).toBeLessThan(a.sy);
    expect(b.sy).toBeGreaterThanOrEqual(1 - TELEGRAPH_POSE.squashMax);
  });

  it("墨入れに入った直後だけ攻撃の向きへ伸び、張りの長さを過ぎたら元に戻る", () => {
    const { e } = windupEnemy("slime", ENEMY_TEMPO.commitRatio - 0.05);
    e.committedAt = 10;
    const p = telegraphPose(e, 10, { x: 1, y: 0 });
    expect(p.dx, "攻撃の向き").toBeGreaterThan(0);
    expect(telegraphPose(e, 10 + TELEGRAPH_POSE.stretchSec + 0.01, { x: 1, y: 0 })).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1 });
  });

  it("下絵の進みは 0 から 1、予備動作でなければ動かない", () => {
    const { e } = windupEnemy("slime", 1);
    expect(yellowProgress(e)).toBe(0);
    e.phaseTimer = ENEMY_TEMPO.commitRatio;
    expect(yellowProgress(e)).toBeCloseTo(1, 5);
    e.phase = "chase";
    expect(telegraphPose(e, 0, { x: 1, y: 0 })).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1 });
  });
});

describe("下絵の間は朱・胡粉を使わない（全部の敵）", () => {
  function colorsFor(ratio: number): Set<string> {
    const state = arena();
    ENEMIES.forEach((def, i) => {
      const e = placeEnemy(state, def.key, 20 + (i % 10) * 12, Math.floor(i / 10) * 12 - 60);
      e.phase = "windup";
      e.windupTotal = 1;
      e.phaseTimer = ratio;
      e.strikeDir = { x: 1, y: 0 };
    });
    return drawColors(state);
  }

  it("下絵の間の予告は淡墨の段と薄墨の印を使い、朱と胡粉と真っ黒を使わない（線・範囲・折れ線・頭上の印のすべて）", () => {
    const colors = colorsFor(1);
    expect(colors.has(rampHex(1)), "淡墨の段 1").toBe(true);
    expect(colors.has(TELEGRAPH.usuzumiLightColor.toLowerCase()), "頭上の ○ の薄墨").toBe(true);
    expect(colors.has(TELEGRAPH.shuColor.toLowerCase()), "朱は使わない").toBe(false);
    expect(colors.has(TELEGRAPH.gofunColor.toLowerCase()), "胡粉は使わない").toBe(false);
    expect(colors.has(rampHex(7)), "芯の真っ黒は使わない").toBe(false);
  });

  it("墨入れの間の予告は真っ黒の芯・朱・胡粉を使い、頭上の ○ の薄墨を使わない", () => {
    const colors = colorsFor(ENEMY_TEMPO.commitRatio - 0.1);
    expect(colors.has(rampHex(7)), "芯の真っ黒").toBe(true);
    expect(colors.has(TELEGRAPH.shuColor.toLowerCase()), "朱").toBe(true);
    expect(colors.has(TELEGRAPH.gofunColor.toLowerCase()), "胡粉").toBe(true);
    expect(colors.has(TELEGRAPH.usuzumiLightColor.toLowerCase()), "頭上の ○ の薄墨は使わない").toBe(false);
  });

  it("予告の色に旧い黄・赤（#ffd040 / #ff4040）を使わない", () => {
    for (const ratio of [1, ENEMY_TEMPO.commitRatio - 0.1]) {
      const colors = colorsFor(ratio);
      expect(colors.has("#ffd040"), `残り ${ratio} の黄`).toBe(false);
      expect(colors.has("#ff4040"), `残り ${ratio} の赤`).toBe(false);
    }
  });

  it("下絵の代表の色（符号表の薄墨）は墨の段 1 と同じ", () => {
    expect(TELEGRAPH.usuzumiColor.toLowerCase()).toBe(rampHex(1));
  });
});

describe("自分の体の上を抜く", () => {
  it("自分を貫く墨入れの線でも、自分の体の円の中には墨を置かない", () => {
    const { state, e } = windupEnemy("boar", ENEMY_TEMPO.commitRatio - 0.1);
    state.player.body.pos = { x: e.body.pos.x + 40, y: e.body.pos.y };
    const surf = new InkSurface();
    const { ctx } = recordingCtx(state);
    let inside = -1;
    let onLine = -1;
    const flush = surf.flush.bind(surf);
    surf.flush = (c: CanvasRenderingContext2D): void => {
      const p = state.player.body;
      const y = Math.floor(surf.dotY(p.pos.y));
      inside = surf.layerAt(Math.floor(surf.dotX(p.pos.x)), y);
      onLine = surf.layerAt(Math.floor(surf.dotX(e.body.pos.x + 20)), y);
      flush(c);
    };
    new TelegraphLayer(surf).draw(ctx, state, HELPERS);
    expect(onLine, "体の外の線の上は墨").toBe(INK_LAYER.ink);
    expect(inside, "体の中心は空").toBe(0);
  });
});

describe("擦れと筆先の逸れ", () => {
  function effectsOf(layer: TelegraphLayer): { kind: string }[] {
    return (layer as unknown as { effects: { kind: string }[] }).effects;
  }

  it("下絵の敵が怯みに入ると線を覚えて散らし、時間が過ぎたら消える", () => {
    const { state, e } = windupEnemy("slime", 0.9);
    const layer = new TelegraphLayer();
    const { ctx } = recordingCtx();
    layer.draw(ctx, state, HELPERS);
    applyStagger(state, e, 1);
    layer.draw(ctx, state, HELPERS);
    expect(effectsOf(layer).length, "擦れが 1 つ").toBe(1);
    expect(effectsOf(layer)[0]?.kind).toBe("erase");
    state.time += TELEGRAPH.eraseSec + 0.01;
    layer.draw(ctx, state, HELPERS);
    expect(effectsOf(layer).length, "散り終わった").toBe(0);
  });

  it("墨入れの敵が怯みに入る（受け流し）と筆先が逸れる", () => {
    const { state, e } = windupEnemy("slime", 0.3);
    const layer = new TelegraphLayer();
    const { ctx } = recordingCtx();
    layer.draw(ctx, state, HELPERS);
    applyStagger(state, e, 1);
    layer.draw(ctx, state, HELPERS);
    expect(effectsOf(layer)[0]?.kind).toBe("veer");
  });

  it("怯みに入らずに線が消えても（攻撃を出し終えた）擦れは出ない", () => {
    const { state, e } = windupEnemy("slime", 0.9);
    const layer = new TelegraphLayer();
    const { ctx } = recordingCtx();
    layer.draw(ctx, state, HELPERS);
    e.phase = "recover";
    layer.draw(ctx, state, HELPERS);
    expect(effectsOf(layer).length).toBe(0);
  });
});
