import { describe, expect, it } from "vitest";
import { BULLETS } from "../loot/bullets";
import { DEFAULT_STATS, ATTR_KEYS, type PlayerStats, type Scaling } from "../loot/types";
import { scaled } from "../system/attributes";
import { isFavoredWeapon } from "../system/jobs";
import { depthHpScale, enemyDef } from "./enemies";
import { ACTION, ENEMY_SCALE, PLAYER, WEAPON } from "./tuning";
import { MOVESETS, MOVESET_KEYS, type MeleeStepDef } from "./weapons";

/**
 * 近接の段の威力の係数（WEAPON.meleeDamageScale）と銃の弾の係数（docs/STATS_AND_SCALING.md 3 章）。
 * 近接は base と全係数を同率で下げるので、序盤の威力だけが下がり、ステータスを上げたときの伸び率は変わらない
 */

const SCALE = WEAPON.meleeDamageScale;
/** 設置弾（地雷・撒き菱）は仕掛けなのでステータスを参照しない（STATS_AND_SCALING.md 2 章の例外） */
const PLACED_BULLETS = ["mineLauncher", "caltrops"];
/** 銃の弾 1 発の基礎値（各 5）での威力と Σ係数（PLAYER.shoot.scaling と同じ） */
const SHOT_AT_BASE = 4.3;
const SHOT_RATIO_SUM = 0.3;
/** 「剣の左 1 段目で 3〜4 発」の要望の幅 */
const MIN_HITS = 3;
const MAX_HITS = 4;
const FIRST_DEPTH = 1;

const atBase = (s: Readonly<Scaling>): number => scaled(DEFAULT_STATS, s);

function ratioSum(s: Readonly<Scaling>): number {
  return ATTR_KEYS.reduce((sum, k) => sum + (s[k] ?? 0), 0);
}

/** 1 つのステータスを 1 点上げた stats */
function withOneMore(attr: (typeof ATTR_KEYS)[number]): PlayerStats {
  return { ...DEFAULT_STATS, attributesEff: { ...DEFAULT_STATS.attributesEff, [attr]: DEFAULT_STATS.attributesEff[attr] + 1 } };
}

/** JSON の段（係数を掛ける前）と復元後の段の組。剣の基本 3 段は PLAYER.melee が元 */
function stepPairs(): { label: string; raw: Scaling; step: MeleeStepDef }[] {
  const out: { label: string; raw: Scaling; step: MeleeStepDef }[] = [];
  MOVESETS.sword.steps.forEach((step, i) => {
    const raw = PLAYER.melee[i]?.scaling;
    if (raw) out.push({ label: `sword ${i + 1} 段目`, raw, step });
  });
  for (const key of MOVESET_KEYS) {
    if (key === "sword") continue;
    const rawSteps = (WEAPON.movesets[key] as { readonly steps?: readonly { readonly scaling: Scaling }[] }).steps ?? [];
    MOVESETS[key].steps.forEach((step, i) => {
      const raw = rawSteps[i]?.scaling;
      if (raw) out.push({ label: `${key} ${i + 1} 段目`, raw, step });
    });
  }
  return out;
}

describe("近接の段の威力の係数（meleeDamageScale）", () => {
  it("近接の段の威力に meleeDamageScale が掛かり、弾には掛からない", () => {
    expect(SCALE, "係数は 0.6").toBe(0.6);
    const pairs = stepPairs();
    expect(pairs.length, "照合する段がある").toBeGreaterThan(MOVESET_KEYS.length);
    for (const { label, raw, step } of pairs) {
      expect(step.scaling.base, `${label} の base`).toBeCloseTo(raw.base * SCALE);
      for (const k of ATTR_KEYS) expect(step.scaling[k] ?? 0, `${label} の ${k}`).toBeCloseTo((raw[k] ?? 0) * SCALE);
    }
    expect(atBase(MOVESETS.sword.dashAttack.scaling), "剣のダッシュ攻撃").toBeCloseTo(atBase(ACTION.dashAttack.scaling) * SCALE);
    expect(atBase(MOVESETS.greatsword.dashAttack.scaling), "大剣のダッシュ攻撃").toBeCloseTo(atBase(WEAPON.movesets.greatsword.dashAttack.scaling) * SCALE);
    // 右レーンの弾の段（throw.scaling）は JSON のまま
    for (const key of MOVESET_KEYS) {
      const rawLane = (WEAPON.movesets[key] as { readonly steps2?: readonly { readonly kind: string; readonly throw?: { readonly scaling: Scaling } }[] }).steps2 ?? [];
      MOVESETS[key].steps2.forEach((art, i) => {
        if (art.kind !== "volley") return;
        expect(art.throw.scaling, `${key} の右 ${i + 1} 段目の弾`).toEqual(rawLane[i]?.throw?.scaling);
      });
    }
    // 銃の弾も JSON のまま
    for (const [key, raw] of Object.entries(WEAPON.bullets)) {
      expect(BULLETS[key]?.scaling, `${key} の弾`).toEqual((raw as { readonly scaling?: Scaling }).scaling);
    }
  });

  it("剣の左 1 段目（基礎値）で深度 1 のスライムは 3〜4 発", () => {
    const first = MOVESETS.sword.steps[0];
    if (!first) throw new Error("剣の 1 段目が無い");
    // 実ダメージは rollOutgoing の最後に丸める（装備なし・会心なしなら倍率 1）
    const damage = Math.round(atBase(first.scaling));
    const hp = enemyDef("slime").hp * depthHpScale(FIRST_DEPTH);
    const hits = Math.ceil(hp / damage);
    expect(hits, `1 発 ${damage}・HP ${hp}`).toBeGreaterThanOrEqual(MIN_HITS);
    expect(hits, `1 発 ${damage}・HP ${hp}`).toBeLessThanOrEqual(MAX_HITS);
  });

  it("ステータス 1 点あたりの伸び率は係数を掛ける前と同じ", () => {
    for (const { label, raw, step } of stepPairs()) {
      for (const k of ATTR_KEYS) {
        const up = withOneMore(k);
        const before = scaled(up, raw) / atBase(raw);
        const after = scaled(up, step.scaling) / atBase(step.scaling);
        expect(after, `${label} の ${k} 1 点の伸び率`).toBeCloseTo(before, 9);
      }
    }
  });
});

describe("銃の弾の係数", () => {
  it("すべての銃の弾が scaling を持ち、基礎値で 4.3・係数の合計は 0.3 以上（設置弾は 0）", () => {
    const keys = Object.keys(WEAPON.bullets);
    expect(keys.length, "弾の種類").toBeGreaterThanOrEqual(25);
    for (const key of keys) {
      const s = BULLETS[key]?.scaling;
      if (!s) throw new Error(`${key} に scaling が無い`);
      expect(atBase(s), `${key} の基礎値での威力`).toBeCloseTo(SHOT_AT_BASE);
      if (PLACED_BULLETS.includes(key)) expect(ratioSum(s), `${key} は設置弾なので係数なし`).toBe(0);
      else expect(ratioSum(s), `${key} の係数の合計`).toBeGreaterThanOrEqual(SHOT_RATIO_SUM - 1e-9);
    }
  });
});

describe("素手とジョブの得意", () => {
  it("拳闘士は素手で得意補正を取らない", () => {
    const unarmed: PlayerStats = { ...DEFAULT_STATS, moveset: "fists", unarmed: true };
    const gauntlets: PlayerStats = { ...DEFAULT_STATS, moveset: "fists", unarmed: false };
    expect(isFavoredWeapon(unarmed, "brawler"), "素手は得意に数えない").toBe(false);
    expect(isFavoredWeapon(gauntlets, "brawler"), "手甲（拳）は得意").toBe(true);
  });
});

describe("敵の HP の深度倍率", () => {
  it("深度 1 で等倍、1 つ深くなるごとに ENEMY_SCALE.hpPerDepth ずつ増える", () => {
    expect(ENEMY_SCALE.hpPerDepth, "外部化前の値のまま").toBe(0.18);
    expect(depthHpScale(1)).toBe(1);
    expect(depthHpScale(4)).toBeCloseTo(1 + 3 * ENEMY_SCALE.hpPerDepth);
  });
});
