import { describe, expect, it } from "vitest";
import { profileKeywords } from "../core/keywords";
import { PLAYER } from "../data/tuning";
import { BULLET_FEATURES, type BulletFeature, GUN_MOVESETS, MOVESETS, bulletFeatures } from "../data/weapons";
import { BASES, baseFamily } from "./bases";
import { BULLETS, DEFAULT_BULLET, bulletDef, bulletOfBase } from "./bullets";

/** 弾は武器（銃のベース）ごとに持つ。共有の「射撃の型」は無い */

/** ベースごとに期待する弾の性質（何も無ければまっすぐ飛ぶだけ） */
const EXPECTED_FEATURES: Readonly<Record<string, readonly BulletFeature[]>> = {
  pistol: [],
  revolver: [],
  twinPistols: [],
  twinRevolvers: [],
  smg: ["rapid"],
  throwingKnives: ["rapid"],
  shotgun: ["spread"],
  blunderbuss: ["spread"],
  rifle: ["pierce"],
  railgun: ["pierce"],
  crossbow: ["pierce"],
  blowgun: ["homing"],
  seekerOrb: ["homing"],
  ricochetGun: ["ricochet"],
  chakram: ["ricochet"],
  matchlock: ["charge"],
  handCannon: ["charge"],
  mineLauncher: ["mine"],
  caltrops: ["mine"],
  burstRifle: ["burst"],
  tripleCrossbow: ["burst"],
  returnChakram: ["boomerang"],
  flyingBlade: ["boomerang"],
  mortar: ["lob"],
  grenadeLauncher: ["lob"],
};

describe("武器ごとの弾", () => {
  const gunBases = BASES.filter((b) => baseFamily(b) === "gun");

  it("銃の家系のベースはすべて自分の弾を持ち、名前はベース名", () => {
    for (const base of gunBases) {
      const bullet = BULLETS[base.key];
      expect(bullet, `${base.key} の弾`).toBeDefined();
      expect(bullet?.name, `${base.key} の弾の名前`).toBe(base.name);
      expect(profileKeywords(bullet?.keywords ?? { produces: [], consumes: [], amplifies: [] }).length, `${base.key} が語を持つ`).toBeGreaterThan(0);
      expect(bullet?.cooldownMul, `${base.key} の間隔`).toBeGreaterThan(0);
      expect(bullet?.damageMul, `${base.key} の威力`).toBeGreaterThan(0);
    }
  });

  it("近接のベースは弾を持たず、右手の弾は既定になる", () => {
    for (const base of BASES) {
      if (baseFamily(base) === "gun") continue;
      expect(BULLETS[base.key], `${base.key} は弾を持たない`).toBeUndefined();
    }
    expect(bulletOfBase("longsword"), "剣は既定の弾").toBe(DEFAULT_BULLET);
    expect(bulletOfBase(undefined), "素手は既定の弾").toBe(DEFAULT_BULLET);
    expect(bulletOfBase("mortar"), "曲射筒は自分の弾").toBe("mortar");
  });

  it("弾の性質は数値の挙動ブロックから決まり、ベースごとに設計どおり", () => {
    for (const base of gunBases) {
      expect(bulletFeatures(bulletDef(base.key)), base.key).toEqual(EXPECTED_FEATURES[base.key]);
    }
  });

  it("すべての性質に、それを撃つ器が 2 つ以上ある", () => {
    for (const f of BULLET_FEATURES) {
      const bases = gunBases.filter((b) => bulletFeatures(bulletDef(b.key)).includes(f));
      expect(bases.length, `${f} の器`).toBeGreaterThanOrEqual(2);
    }
  });

  it("拳銃の弾は射撃の共通値と同じ（倍率がすべて等倍）", () => {
    const pistol = bulletDef("pistol");
    expect(pistol.cooldownMul).toBe(1);
    expect(pistol.damageMul).toBe(1);
    expect(pistol.speedMul).toBe(1);
    expect(pistol.radius).toBe(PLAYER.shoot.radius);
    expect(pistol.spreadDeg).toBe(PLAYER.projectileSpreadDeg);
  });

  it("火縄銃の溜めの段は時間・威力が単調に増える", () => {
    const levels = bulletDef("matchlock").charge?.levels ?? [];
    expect(levels.length).toBe(3);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!.time).toBeGreaterThan(levels[i - 1]!.time);
      expect(levels[i]!.damageMul).toBeGreaterThan(levels[i - 1]!.damageMul);
    }
  });

  it("弾を出す固有技は技自身の弾を持ち、同じ表から key で引ける", () => {
    const throws = Object.values(MOVESETS).filter((m) => m.steps2[0].kind === "volley");
    expect(throws.length, "投擲・魔弾・乱れ撃ち・撒き散らし").toBeGreaterThanOrEqual(4);
    for (const m of throws) {
      const art = m.steps2[0];
      if (art.kind !== "volley") continue;
      const bullet = art.throw.bullet;
      expect(bullet.key, m.key).toBe(`art.${art.key}`);
      expect(BULLETS[bullet.key], m.key).toBe(bullet);
    }
    expect(MOVESETS.axe.steps2[0].kind === "volley" && bulletFeatures(MOVESETS.axe.steps2[0].throw.bullet), "斧は行って戻る").toEqual(["boomerang"]);
    expect(MOVESETS.trapper.steps2[0].kind === "volley" && bulletFeatures(MOVESETS.trapper.steps2[0].throw.bullet), "撒き散らしは設置弾").toEqual(["mine"]);
  });

  it("銃の家系はどれも一番早い器が撃てる弾を持つ（拠点で試すときの弾）", () => {
    for (const key of GUN_MOVESETS) {
      expect(gunBases.some((b) => b.moveset === key), key).toBe(true);
    }
  });
});
