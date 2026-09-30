import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { telegraphDiagram } from "./telegraphDiagram";
import { BOSS_THREATS } from "./bossKit";
import { ENEMY_TEMPO } from "../data/tuning";
import { enemyDef } from "../data/enemies";
import { CODEX_ENEMIES } from "../meta/codex";
import { drawTelegraphDiagram } from "../render/telegraphDiagramUi";

/** 呼び出しを数えるだけの偽の Canvas（render の他のテストと同じ作り） */
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

describe("予告の図解（敵データから導く）", () => {
  it("図鑑に載る全ての敵の図解が作れ、秒は有限で、赤の始まりは予備動作の中", () => {
    for (const def of CODEX_ENEMIES) {
      const d = telegraphDiagram(def);
      for (const sec of [d.windup, d.commitFrom, d.strike, d.recover]) {
        expect(Number.isFinite(sec), `${def.key} の秒が有限`).toBe(true);
      }
      expect(d.commitFrom, `${def.key} の赤の始まりは 0 以上`).toBeGreaterThanOrEqual(0);
      expect(d.commitFrom, `${def.key} の赤の始まりは予備動作の中`).toBeLessThanOrEqual(d.windup);
      expect(d.windup, `${def.key} の予備動作は敵の定義のまま`).toBe(def.windup);
      expect(d.commitFrom, `${def.key} の赤の始まりは commitRatio から`).toBeCloseTo(def.windup * (1 - ENEMY_TEMPO.commitRatio), 9);
    }
  });

  it("突進の敵は線、ゴーレムは輪、風の精は扇、射手は弾の扇、自爆は輪、山なりは影", () => {
    const kind = (key: string): string => telegraphDiagram(enemyDef(key)).shape.kind;
    expect(kind("boar"), "猪の突進").toBe("line");
    expect(kind("golem"), "ゴーレム").toBe("ring");
    expect(kind("windSprite"), "風の精").toBe("cone");
    expect(kind("twinEye"), "2 連射の目").toBe("volley");
    expect(kind("eye"), "1 発の射手も弾").toBe("volley");
    expect(kind("fuseRat"), "自爆").toBe("ring");
    expect(kind("toad"), "山なりの玉").toBe("landing");
    expect(kind("triLaser"), "3 本のレーザー").toBe("laser");
    expect(kind("crossGolem"), "十字").toBe("cross");
    expect(kind("bomber"), "爆弾は影").toBe("landing");
  });

  it("形の大きさは敵のデータから取る（自爆の輪は explode の半径、扇は風の精の射程と半角）", () => {
    const fuse = telegraphDiagram(enemyDef("fuseRat")).shape;
    expect(fuse.kind === "ring" ? fuse.radius : -1, "自爆の輪").toBe(enemyDef("fuseRat").explode?.radius);
    const wind = telegraphDiagram(enemyDef("windSprite")).shape;
    expect(wind.kind === "cone" && wind.range > 0 && wind.halfDeg > 0, "扇の射程と半角").toBe(true);
    const tri = telegraphDiagram(enemyDef("triLaser")).shape;
    expect(tri.kind === "laser" ? tri.count : 0, "レーザーの本数").toBe(enemyDef("triLaser").laserBeams?.count);
  });

  it("線の長さは突進で届く距離（正で有限）", () => {
    for (const def of CODEX_ENEMIES) {
      const s = telegraphDiagram(def).shape;
      if (s.kind !== "line") continue;
      expect(s.length, `${def.key} の線の長さ`).toBeGreaterThan(0);
      expect(Number.isFinite(s.length), `${def.key} の線の長さが有限`).toBe(true);
    }
  });

  it("安全な場所は形ごとに決まり、形の無い敵だけ空", () => {
    for (const def of CODEX_ENEMIES) {
      const d = telegraphDiagram(def);
      expect(d.safe === "", `${def.key} の安全な場所は形が無いときだけ空`).toBe(d.shape.kind === "none");
    }
  });

  it("ボスは段階 3 つの危ない間合いを持ち、ボス以外は持たない", () => {
    for (const key of Object.keys(BOSS_THREATS)) {
      const d = telegraphDiagram(enemyDef(key));
      expect(d.threats?.length, `${key} の段階`).toBe(3);
      expect(d.threats, `${key} は BOSS_THREATS の並び`).toEqual(BOSS_THREATS[key]);
    }
    expect(telegraphDiagram(enemyDef("slime")).threats, "並の敵").toBeUndefined();
  });

  it("同じ敵からは同じ図解が作れる（乱数も状態も使わない）", () => {
    for (const def of CODEX_ENEMIES) {
      expect(telegraphDiagram(def), `${def.key}`).toEqual(telegraphDiagram(def));
    }
  });
});

describe("予告の図解の描画", () => {
  it("図鑑の全ての敵で、ダミーの ctx に例外なく描き終える", () => {
    for (const def of CODEX_ENEMIES) {
      const { ctx, calls } = fakeContext();
      expect(() => drawTelegraphDiagram(ctx, def, telegraphDiagram(def)), `${def.key} の描画`).not.toThrow();
      expect(calls.size, `${def.key} は何かを描く`).toBeGreaterThan(0);
    }
  });

  it("絵が無くても描ける（当たりの円で代える）", () => {
    const def = enemyDef("golem");
    const { ctx, calls } = fakeContext();
    drawTelegraphDiagram(ctx, def, telegraphDiagram(def), undefined);
    expect(calls.get("arc") ?? 0, "敵の円と輪").toBeGreaterThan(1);
  });
});
