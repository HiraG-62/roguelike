import { describe, expect, it } from "vitest";
import { PALETTE, SPRITES } from "../data/sprites";
import { ENEMIES } from "../data/enemies";
import { type Sprite, spriteFrame } from "./sprites";

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

  it("全ての敵定義のスプライトが存在する", () => {
    for (const def of ENEMIES) expect(SPRITES[def.sprite], def.sprite).toBeDefined();
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
