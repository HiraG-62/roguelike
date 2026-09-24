import { describe, expect, it } from "vitest";
import { PALETTE, SPRITES } from "../data/sprites";
import { ENEMIES, spriteBaseKey } from "../data/enemies";
import { CANVAS_24, CANVAS_32, CANVAS_48, POSE_SUFFIXES, poseKey } from "../data/sprites/frameKit";
import { BEASTS_KEYS, BEASTS_SMALL_KEYS } from "../data/sprites/beasts";
import { BOSS_KEYS, BOSS_STATE_KEYS } from "../data/sprites/bosses";
import { CLOISTER_KEYS } from "../data/sprites/cloister";
import { HEAVY_KEYS } from "../data/sprites/heavy";
import { STILL_PLAIN, STILL_POSED } from "../data/sprites/still";
import { W3_BACK_KEYS } from "../data/sprites/w3back";
import { W3_FRONT_KEYS, W3_FRONT_STILL_KEYS } from "../data/sprites/w3front";
import { SHALLOWS_KEYS } from "../data/sprites/shallows";
import {
  SLASH_SPRITE,
  WEAPON_CANVAS,
  WEAPON_EDGE,
  WEAPON_FRAME,
  WEAPON_GRIPS,
  type WeaponFrame,
  mirrorAntiDiagonal,
  weaponSpriteKey,
} from "../data/sprites/weapons";
import { MOVESET_KEYS, type MovesetKey } from "../data/weapons";
import { type Sprite, enemySpriteKey, recolorFrames, spriteFrame, spriteSources } from "./sprites";

const TRANSPARENT = ".";
const TILE = 16;

/** renderer が既に参照しているキー（サイズ 16x16 を維持する）。slime / eye / boar は 24x24 に描き直した（下の「描き直した敵」）、player は 24x24（下の「プレイヤーと手に持つ武器」） */
const LEGACY_KEYS = ["heart", "floor", "wall", "stairs", "door"] as const;

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


describe("描き直した敵（docs/ideas/graphics-style.md）", () => {
  /** 頭上のラベル・「!」のために空ける行数 */
  const HEAD_ROOM = 2;
  const isEmptyRow = (row: string | undefined): boolean => (row ?? "").split("").every((ch) => ch === TRANSPARENT);
  /** 原画 4 枚で描き直したキーとキャンバスの一辺 */
  const CANVAS_OF: Readonly<Record<string, number>> = Object.fromEntries([
    ...[...SHALLOWS_KEYS, ...BEASTS_KEYS, ...CLOISTER_KEYS, ...W3_FRONT_KEYS, ...W3_BACK_KEYS].map((k) => [k, CANVAS_24] as const),
    ...HEAVY_KEYS.map((k) => [k, CANVAS_32] as const),
    ...BOSS_KEYS.map((k) => [k, CANVAS_48] as const),
    ...STILL_POSED,
  ]);
  const REDRAWN: readonly string[] = Object.keys(CANVAS_OF);
  const sizeOf = (key: string): number => CANVAS_OF[key] ?? CANVAS_24;
  const SMALL: readonly string[] = [...BEASTS_SMALL_KEYS];
  /** 動かず予備動作を持たないキー（旗・台座など）と一辺 */
  const STILL: readonly (readonly [string, number])[] = [
    ...W3_FRONT_STILL_KEYS.map((k) => [k, CANVAS_24] as const),
    // 状態フレームのボス（kingSlime の伸び・boneLord の杖）も同じ検査に載せる
    ...BOSS_STATE_KEYS.map((k) => [k, CANVAS_48] as const),
    ...STILL_PLAIN,
  ];

  it.each(STILL)("据え置き・状態フレームの %s は %i px 四方で 4 フレーム、最下段に接地している", (key, size) => {
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

  it.each(REDRAWN)("%s は様式書のキャンバス（16〜48）で 4 フレーム", (key) => {
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

describe("プレイヤーと手に持つ武器（docs/ideas/combat-feel-design.md C-1）", () => {
  const isEmptyRow = (row: string | undefined): boolean => (row ?? "").split("").every((ch) => ch === TRANSPARENT);
  const originals = (): (readonly string[])[] => [
    SPRITES.player?.[0] ?? [],
    SPRITES.player?.[2] ?? [],
    ...POSE_SUFFIXES.map((pose) => SPRITES[poseKey("player", pose)]?.[0] ?? []),
  ];

  it("player は 24x24 で歩き 4 フレーム、構えと振り抜きを 1 フレームずつ持つ", () => {
    expect(SPRITES.player?.length).toBe(4);
    for (const frame of originals()) {
      expect(frame.length).toBe(CANVAS_24);
      expect(frame[0]?.length).toBe(CANVAS_24);
    }
    for (const pose of POSE_SUFFIXES) expect(SPRITES[poseKey("player", pose)]?.length, pose).toBe(1);
  });

  it("player は頭上 2 行を空け、原画の足が最下段にある", () => {
    for (const frame of originals()) {
      expect(isEmptyRow(frame[0])).toBe(true);
      expect(isEmptyRow(frame[1])).toBe(true);
      expect(isEmptyRow(frame[CANVAS_24 - 1])).toBe(false);
    }
  });

  it("構え・振り抜きは歩きと形が違う", () => {
    const [walk, , windup, strike] = originals();
    expect(windup).not.toEqual(walk);
    expect(strike).not.toEqual(walk);
    expect(strike).not.toEqual(windup);
  });

  it("player の体に剣（刃の白）を描き込んでいない", () => {
    for (const frame of originals()) expect(frame.join("").includes("1s"), "刃の明部").toBe(false);
  });

  it.each([...MOVESET_KEYS])("武器種 %s の持ち手が 12x12 の 3 フレーム（横・斜め・縦。片刃は刃が右下の斜めを足して 4）である", (key) => {
    const frames = SPRITES[weaponSpriteKey(key)];
    expect(frames?.length).toBe(WEAPON_EDGE[key] ? 4 : 3);
    for (const frame of frames ?? []) {
      expect(frame.length).toBe(WEAPON_CANVAS);
      expect(frame[0]?.length).toBe(WEAPON_CANVAS);
    }
  });

  it.each([...MOVESET_KEYS])("武器種 %s の各フレームは拳の中心（WEAPON_GRIPS）に肌の色がある", (key) => {
    const frames = SPRITES[weaponSpriteKey(key)] ?? [];
    frames.forEach((frame, i) => {
      const grip = WEAPON_GRIPS[i as WeaponFrame];
      // 拳の中心は 2x2 の肌の境目。その左上の画素が肌（明 t / 暗 T）
      const ch = frame[grip.y - 1]?.[grip.x - 1];
      expect(ch === "t" || ch === "T" || key === "fists", `${key} フレーム ${i}: ${ch}`).toBe(true);
    });
  });

  /** 斜めの絵で、柄の線（画素の x + y = 11）の左上側と右下側にある刃・頭（金属の 3 段）の画素の数 */
  const METAL = new Set(["1", "s", "S"]);
  const sidesOfShaft = (frame: readonly string[]): { ul: number; dr: number } => {
    let ul = 0;
    let dr = 0;
    frame.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (!METAL.has(c)) return;
        if (x + y < WEAPON_CANVAS - 1) ul++;
        else if (x + y > WEAPON_CANVAS - 1) dr++;
      }),
    );
    return { ul, dr };
  };

  it.each(Object.keys(WEAPON_EDGE) as MovesetKey[])("片刃の %s は斜めの絵の刃が柄の左上側にあり、4 枚目は右下側にある", (key) => {
    const frames = SPRITES[weaponSpriteKey(key)] ?? [];
    const diag = sidesOfShaft(frames[WEAPON_FRAME.diagonal] ?? []);
    const out = sidesOfShaft(frames[WEAPON_FRAME.diagonalOut] ?? []);
    expect(diag.ul, "斜め: 左上側が多い").toBeGreaterThan(diag.dr);
    expect(out.dr, "4 枚目: 右下側が多い").toBeGreaterThan(out.ul);
  });

  it.each(Object.keys(WEAPON_EDGE) as MovesetKey[])("片刃の %s の 4 枚目は斜めの絵を柄の線で写した形（不透明画素の位置が一致）", (key) => {
    const frames = SPRITES[weaponSpriteKey(key)] ?? [];
    const mask = (f: readonly string[]) => f.map((r) => r.replace(/[^.]/g, "#"));
    expect(mask(frames[WEAPON_FRAME.diagonalOut] ?? [])).toEqual(mask(mirrorAntiDiagonal(frames[WEAPON_FRAME.diagonal] ?? [])));
  });

  it("mirrorAntiDiagonal を 2 回かけると元に戻り、拳 (2,10) の画素は動かない", () => {
    const frame = SPRITES[weaponSpriteKey("axe")]?.[WEAPON_FRAME.diagonal] ?? [];
    expect(mirrorAntiDiagonal(mirrorAntiDiagonal(frame))).toEqual(frame);
    const grip = WEAPON_GRIPS[WEAPON_FRAME.diagonalOut];
    expect(grip).toEqual(WEAPON_GRIPS[WEAPON_FRAME.diagonal]);
  });

  it("銃の家系（長銃・砲・投擲・擲弾・仕掛け・戦輪）は二丁拳銃の拳銃と別の絵を持つ", () => {
    const gun = SPRITES[weaponSpriteKey("gunner")]?.[WEAPON_FRAME.side];
    for (const key of ["longarm", "cannon", "thrown", "grenade", "trapper", "warRing"] as const) {
      expect(SPRITES[weaponSpriteKey(key)]?.[WEAPON_FRAME.side], key).not.toEqual(gun);
    }
  });
});

describe("斬撃の絵（docs/ideas/combat-feel-design.md C-3）", () => {
  it.each(Object.values(SLASH_SPRITE))("%s は太さ 3 段 × 絵 3 種の 9 フレーム", (key) => {
    expect(SPRITES[key]?.length).toBe(9);
  });

  it("同じ形の中で絵がすべて違う（段ごとに見分けられる）", () => {
    for (const key of Object.values(SLASH_SPRITE)) {
      const frames = (SPRITES[key] ?? []).map((f) => f.join("/"));
      expect(new Set(frames).size, key).toBe(frames.length);
    }
  });
});
