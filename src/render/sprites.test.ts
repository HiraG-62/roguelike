import { describe, expect, it } from "vitest";
import { PALETTE, SPRITES } from "../data/sprites";
import { ENEMIES, spriteBaseKey } from "../data/enemies";
import { type Sprite, recolorFrames, spriteFrame, spriteSources } from "./sprites";

const TRANSPARENT = ".";
const TILE = 16;

/** renderer が既に参照しているキー（サイズ 16x16 を維持する） */
const LEGACY_KEYS = ["player", "slime", "eye", "boar", "heart", "floor", "wall", "stairs", "door"] as const;

const ADDED_KEYS = [
  "wallTop",
  "wallFace",
  "shadow",
  "slash1",
  "slash2",
  "slash3",
  "bullet",
  "enemyBullet",
  "heartSmall",
  "coin",
  "itemDiamond",
  "stairsGlow",
  "spawnRing",
  "crosshair",
  "bomb",
  "laserBeam",
  "shieldIcon",
  "eliteAura",
  "fountain",
] as const;

const MIN_FRAMES: Partial<Record<string, number>> = {
  player: 4,
  slime: 3,
  eye: 3,
  boar: 3,
  floor: 4,
  coin: 6,
  spawnRing: 3,
  fountain: 2,
};

describe("SPRITES", () => {
  const entries = Object.entries(SPRITES);

  it.each(entries)("%s: 全フレームが同じ幅・高さ", (_key, frames) => {
    expect(frames.length).toBeGreaterThan(0);
    const h = frames[0]?.length ?? 0;
    const w = frames[0]?.[0]?.length ?? 0;
    expect(h).toBeGreaterThan(0);
    expect(w).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame.length).toBe(h);
      for (const row of frame) expect(row.length).toBe(w);
    }
  });

  it.each(entries)("%s: PALETTE に無い文字を使っていない", (_key, frames) => {
    const unknown = new Set<string>();
    for (const frame of frames) {
      for (const row of frame) {
        for (const ch of row) {
          if (ch !== TRANSPARENT && !(ch in PALETTE)) unknown.add(ch);
        }
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it.each(entries)("%s: 完全に透明なフレームが無い", (_key, frames) => {
    for (const frame of frames) {
      expect(frame.some((row) => [...row].some((ch) => ch !== TRANSPARENT))).toBe(true);
    }
  });

  it.each(LEGACY_KEYS)("既存キー %s が 16x16 で残っている", (key) => {
    const frames = SPRITES[key];
    expect(frames).toBeDefined();
    expect(frames?.[0]?.length).toBe(TILE);
    expect(frames?.[0]?.[0]?.length).toBe(TILE);
  });

  it.each(ADDED_KEYS)("追加キー %s が存在する", (key) => {
    expect(SPRITES[key]).toBeDefined();
  });

  it.each(Object.entries(MIN_FRAMES))("%s は %i フレーム以上", (key, min) => {
    expect(SPRITES[key]?.length ?? 0).toBeGreaterThanOrEqual(min ?? 1);
  });

  it("fountain は 16x16", () => {
    expect(SPRITES.fountain?.[0]?.length).toBe(TILE);
    expect(SPRITES.fountain?.[0]?.[0]?.length).toBe(TILE);
  });

  it("全ての敵定義のスプライトが存在する（再配色種はアトラスの元で作られる）", () => {
    const sources = spriteSources();
    for (const def of ENEMIES) expect(sources[def.sprite], def.sprite).toBeDefined();
  });

  it("タイル系は透明ピクセルを持たない", () => {
    for (const key of ["floor", "wall", "wallTop", "wallFace"]) {
      for (const frame of SPRITES[key] ?? []) {
        for (const row of frame) expect(row.includes(TRANSPARENT)).toBe(false);
      }
    }
  });
});

describe("PALETTE", () => {
  it("キーは 1 文字で、色は #rrggbb", () => {
    for (const [ch, color] of Object.entries(PALETTE)) {
      expect(ch.length).toBe(1);
      expect(ch).not.toBe(TRANSPARENT);
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("spriteFrame", () => {
  const fake = (n: number): Pick<Sprite, "frames"> => ({
    frames: Array.from({ length: n }, () => ({}) as HTMLCanvasElement),
  });

  it("frameTime ごとに進み、フレーム数で循環する", () => {
    expect(spriteFrame(fake(4), 0, 0.3)).toBe(0);
    expect(spriteFrame(fake(4), 0.31, 0.3)).toBe(1);
    expect(spriteFrame(fake(4), 1.25, 0.3)).toBe(0);
  });

  it("1 フレームや frameTime<=0 は 0", () => {
    expect(spriteFrame(fake(1), 5, 0.1)).toBe(0);
    expect(spriteFrame(fake(3), 5, 0)).toBe(0);
  });

  it("負の時間でも範囲内", () => {
    expect(spriteFrame(fake(3), -0.1, 0.1)).toBe(2);
  });
});

describe("再配色種（EnemyDef.recolor）", () => {
  const recolored = ENEMIES.filter((d) => d.recolor);

  it("再配色種は 8 種以上ある", () => {
    expect(recolored.length).toBeGreaterThanOrEqual(8);
  });

  it("recolorFrames はパレット文字だけを差し替え、寸法と透明を保つ", () => {
    const frames = [[".gG.", "hg.k"]];
    expect(recolorFrames(frames, { g: "p", G: "P" })).toEqual([[".pP.", "hp.k"]]);
  });

  it.each(recolored.map((d) => [d.key, d] as const))("%s: 元の絵があり、差し替え先がパレットにあり、元の絵と違う", (_key, def) => {
    const r = def.recolor;
    if (!r) throw new Error("no recolor");
    const base = SPRITES[r.base];
    expect(base, r.base).toBeDefined();
    for (const [from, to] of Object.entries(r.swap)) {
      expect(from in PALETTE, `差し替え元 ${from}`).toBe(true);
      expect(to in PALETTE, `差し替え先 ${to}`).toBe(true);
    }
    const made = spriteSources()[def.sprite];
    expect(made?.length).toBe(base?.length);
    expect(made?.[0]?.length).toBe(base?.[0]?.length);
    expect(made, "色が変わっている").not.toEqual(base);
    // 見た目の元（浮遊・影の扱い）は元の敵に揃う
    expect(spriteBaseKey(def)).toBe(r.base);
  });

  it("再配色種の sprite は元の絵のキーと衝突しない", () => {
    for (const def of recolored) expect(SPRITES[def.sprite], def.sprite).toBeUndefined();
  });
});

describe("量産した敵のスプライト寸法", () => {
  const SIZE: Readonly<Record<string, number>> = {
    rat: 16,
    wolf: 16,
    skeleton: 16,
    beetle: 16,
    mite: 16,
    hooded: 16,
    leech: 16,
    ghoul: 16,
    bell: 16,
    shade: 16,
    icePillar: 16,
    mimic: 24,
    hollowArmor: 24,
    twinBrother: 32,
    twinSister: 32,
    frostGiant: 32,
  };

  it.each(Object.entries(SIZE))("%s は %i px 四方で 4 フレーム", (key, size) => {
    const frames = SPRITES[key];
    expect(frames?.length).toBe(4);
    expect(frames?.[0]?.length).toBe(size);
    expect(frames?.[0]?.[0]?.length).toBe(size);
  });
});
