import { describe, expect, it } from "vitest";
import { PALETTE, SPRITES } from "../data/sprites";
import { ENEMIES, spriteBaseKey } from "../data/enemies";
import { CANVAS_24, CANVAS_32, POSE_SUFFIXES, poseKey } from "../data/sprites/frameKit";
import { BEASTS_KEYS, BEASTS_SMALL_KEYS } from "../data/sprites/beasts";
import { CLOISTER_KEYS } from "../data/sprites/cloister";
import { HEAVY_KEYS } from "../data/sprites/heavy";
import { W3_FRONT_KEYS, W3_FRONT_STILL_KEYS } from "../data/sprites/w3front";
import { SHALLOWS_KEYS } from "../data/sprites/shallows";
import { type Sprite, enemySpriteKey, recolorFrames, spriteFrame, spriteSources } from "./sprites";

const TRANSPARENT = ".";
const TILE = 16;

/** renderer が既に参照しているキー（サイズ 16x16 を維持する）。slime / eye / boar は 24x24 に描き直した（下の「描き直した敵」） */
const LEGACY_KEYS = ["player", "heart", "floor", "wall", "stairs", "door"] as const;

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
    icePillar: 16,
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

describe("描き直した敵（docs/ideas/graphics-style.md）", () => {
  /** 頭上のラベル・「!」のために空ける行数 */
  const HEAD_ROOM = 2;
  const isEmptyRow = (row: string | undefined): boolean => (row ?? "").split("").every((ch) => ch === TRANSPARENT);
  /** 原画 4 枚で描き直したキーとキャンバスの一辺 */
  const CANVAS_OF: Readonly<Record<string, number>> = Object.fromEntries([
    ...[...SHALLOWS_KEYS, ...BEASTS_KEYS, ...CLOISTER_KEYS, ...W3_FRONT_KEYS].map((k) => [k, CANVAS_24] as const),
    ...HEAVY_KEYS.map((k) => [k, CANVAS_32] as const),
  ]);
  const REDRAWN: readonly string[] = Object.keys(CANVAS_OF);
  const sizeOf = (key: string): number => CANVAS_OF[key] ?? CANVAS_24;
  const SMALL: readonly string[] = [...BEASTS_SMALL_KEYS];
  /** 動かず予備動作を持たないキー（旗・台座など）と一辺 */
  const STILL: readonly (readonly [string, number])[] = W3_FRONT_STILL_KEYS.map((k) => [k, CANVAS_24] as const);

  it.each(STILL)("据え置きの %s は %i px 四方で 4 フレーム、最下段に接地している", (key, size) => {
    const frames = SPRITES[key] ?? [];
    expect(frames.length).toBe(4);
    for (const frame of frames) {
      expect(frame.length).toBe(size);
      expect(frame[0]?.length).toBe(size);
      expect(isEmptyRow(frame[size - 1])).toBe(false);
    }
  });
  /** 小型のキャンバス（様式書 1 章） */
  const SMALL_CANVAS = 16;

  it.each(SMALL)("小型 %s は 16x16 で 4 フレーム", (key) => {
    const frames = SPRITES[key];
    expect(frames?.length).toBe(4);
    for (const frame of frames ?? []) {
      expect(frame.length).toBe(SMALL_CANVAS);
      expect(frame[0]?.length).toBe(SMALL_CANVAS);
    }
  });

  it.each(REDRAWN)("%s は様式書のキャンバス（24 / 32）で歩行 4 フレーム", (key) => {
    const frames = SPRITES[key];
    expect(frames?.length).toBe(4);
    for (const frame of frames ?? []) {
      expect(frame.length).toBe(sizeOf(key));
      expect(frame[0]?.length).toBe(sizeOf(key));
    }
  });

  it.each(REDRAWN)("%s は予備動作と攻撃の原画を歩きと同じ寸法の 1 フレームで持つ", (key) => {
    for (const pose of POSE_SUFFIXES) {
      const frames = SPRITES[poseKey(key, pose)];
      expect(frames?.length, pose).toBe(1);
      expect(frames?.[0]?.length, pose).toBe(sizeOf(key));
      expect(frames?.[0]?.[0]?.length, pose).toBe(sizeOf(key));
    }
  });

  it.each(REDRAWN)("%s の予備動作は歩きと形が違う（テレグラフが形で読める）", (key) => {
    const walk = SPRITES[key]?.[0];
    const windup = SPRITES[poseKey(key, "windup")]?.[0];
    const strike = SPRITES[poseKey(key, "strike")]?.[0];
    expect(windup).not.toEqual(walk);
    expect(strike).not.toEqual(walk);
    expect(strike).not.toEqual(windup);
  });

  it.each(REDRAWN)("%s は頭上 2 行を空け、歩き原画の足が最下段にある", (key) => {
    const frames = SPRITES[key] ?? [];
    // 原画（歩き A / B と各ポーズ）を見る。lift した 1・3 枚目は 1 段上がってよい
    const all = [frames[0] ?? [], frames[2] ?? [], ...POSE_SUFFIXES.map((pose) => SPRITES[poseKey(key, pose)]?.[0] ?? [])];
    for (const frame of all) {
      for (let y = 0; y < HEAD_ROOM; y++) expect(isEmptyRow(frame[y]), `${y} 行目`).toBe(true);
    }
    // 歩き A / B（lift していない 0 と 2）は足元の基準を揃える
    for (const i of [0, 2]) expect(isEmptyRow(frames[i]?.[sizeOf(key) - 1]), `フレーム ${i}`).toBe(false);
  });

  it("描き直した原画を元にする再配色種は、swap 元の文字が新原画に残っている", () => {
    const targets = ENEMIES.filter((d) => d.recolor && REDRAWN.includes(d.recolor.base));
    expect(targets.length).toBeGreaterThan(0);
    for (const def of targets) {
      const r = def.recolor;
      if (!r) continue;
      const used = new Set((SPRITES[r.base] ?? []).flatMap((f) => f.flatMap((row) => [...row])));
      for (const from of Object.keys(r.swap)) expect(used.has(from), `${def.key}: ${from}`).toBe(true);
    }
  });
});

describe("予備動作・攻撃の原画の選び方", () => {
  const has = (k: string): boolean => k in spriteSources();

  it("予備動作・攻撃の phase では原画のキーを返す", () => {
    expect(enemySpriteKey("slime", "windup", has)).toBe("slime.windup");
    expect(enemySpriteKey("slime", "strike", has)).toBe("slime.strike");
  });

  it("それ以外の phase は歩きのキーのまま", () => {
    for (const phase of ["idle", "chase", "recover", "spawning"] as const) {
      expect(enemySpriteKey("slime", phase, has), phase).toBe("slime");
    }
  });

  it("原画が無い敵は予備動作でも歩きのキーにフォールバックする", () => {
    expect(enemySpriteKey("kingSlime", "windup", has)).toBe("kingSlime");
  });

  it("再配色種は元のポーズから同じ差し替えで予備動作・攻撃を作る", () => {
    const sources = spriteSources();
    const posed = ENEMIES.filter((d) => d.recolor && SPRITES[poseKey(d.recolor.base, "windup")]);
    expect(posed.length).toBeGreaterThan(0);
    for (const def of posed) {
      const r = def.recolor;
      if (!r) continue;
      for (const pose of POSE_SUFFIXES) {
        const base = SPRITES[poseKey(r.base, pose)];
        expect(sources[poseKey(def.sprite, pose)], `${def.key}.${pose}`).toEqual(base && recolorFrames(base, r.swap));
      }
    }
  });
});
