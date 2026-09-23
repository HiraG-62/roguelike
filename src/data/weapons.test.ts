import { describe, expect, it } from "vitest";
import { profileKeywords } from "../core/keywords";
import { BASES } from "../loot/bases";
import { DEFAULT_STATS } from "../loot/types";
import { scaled } from "../system/attributes";
import { ACTION, MANA, PLAYER } from "./tuning";
import {
  type ButtonKey,
  MOVESETS,
  MOVESET_KEYS,
  SHOT_KEYS,
  SHOT_TYPES,
  chargeLevelAt,
  matchBranch,
  meleeButton,
  shotButton,
} from "./weapons";

/** 剣以外の武器種の段数（ユーザーメモ: 3 段固定ではなく 4〜5 段）。剣は QA で調整済みの基準線として 3 段のまま */
const MIN_STEPS = 4;
const MAX_STEPS = 5;
const MIN_BRANCHES = 2;
const MAX_BRANCHES = 3;
/** 基礎値（各 5）での現行の威力（docs/COMBAT_DESIGN.md A-6。attributes.test.ts の固定値と同じ） */
const SWORD_PINNED = [7.8, 7.8, 15.6];
const DASH_PINNED = 11.2;

const atBase = (s: Parameters<typeof scaled>[1]): number => scaled(DEFAULT_STATS, s);

describe("武器種の定義", () => {
  it("すべての武器種が表示名・説明・語を持ち、剣以外は 4〜5 段ある", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      expect(def.key, key).toBe(key);
      expect(def.name.length, `${key} の表示名`).toBeGreaterThan(0);
      expect(def.desc.length, `${key} の説明`).toBeGreaterThan(0);
      expect(profileKeywords(def.keywords).length, `${key} が語を持つ`).toBeGreaterThan(0);
      if (key === "sword") continue;
      expect(def.steps.length, `${key} の段数`).toBeGreaterThanOrEqual(MIN_STEPS);
      expect(def.steps.length, `${key} の段数`).toBeLessThanOrEqual(MAX_STEPS);
    }
  });

  it("すべての武器種が 2〜3 本のコンボ派生を持ち、入力列・続きの段が妥当", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      expect(def.branches.length, `${key} の派生数`).toBeGreaterThanOrEqual(MIN_BRANCHES);
      expect(def.branches.length, `${key} の派生数`).toBeLessThanOrEqual(MAX_BRANCHES);
      const sequences = new Set<string>();
      for (const b of def.branches) {
        expect(b.name.length, `${key}.${b.key} の表示名`).toBeGreaterThan(0);
        expect(b.name, `${key}.${b.key} の表示名が登録済み`).not.toBe(b.key);
        expect(b.sequence.length, `${key}.${b.key} の入力列`).toBeGreaterThan(0);
        if (b.next !== undefined) expect(b.next, `${key}.${b.key} の続き`).toBeLessThan(def.steps.length);
        sequences.add(b.sequence.join(","));
      }
      expect(sequences.size, `${key} の入力列は重複しない`).toBe(def.branches.length);
    }
  });

  it("派生の照合は入力列の末尾で、長い列が先に一致する", () => {
    const gs = MOVESETS.greatsword;
    const at = (inputs: ButtonKey[]): string | undefined => {
      const i = matchBranch(gs, inputs);
      return i === undefined ? undefined : gs.branches[i]?.key;
    };
    expect(at(["secondary"])).toBe("sweep");
    expect(at(["primary", "primary", "secondary"]), "左左右は薙ぎ払いより兜割り").toBe("helmSplitter");
    expect(at(["primary", "primary"])).toBeUndefined();
  });

  it("ボタンの役割: 剣は左近接・右射撃のまま、大剣は右も近接、杖は左が射撃", () => {
    expect(MOVESETS.sword.primary).toBe("melee");
    expect(MOVESETS.sword.secondary).toBe("shot");
    expect(shotButton(MOVESETS.greatsword), "大剣は撃てない").toBeUndefined();
    expect(meleeButton(MOVESETS.greatsword)).toBe("primary");
    expect(shotButton(MOVESETS.wand)).toBe("primary");
    expect(meleeButton(MOVESETS.wand)).toBe("secondary");
  });

  it("多段ヒット・踏み込み・揺れの数値が正", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      const all = [...def.steps, def.dashAttack, ...def.branches.map((b) => b.step)];
      for (const step of all) {
        if (step.hits !== undefined) expect(step.hits, key).toBeGreaterThanOrEqual(1);
        if (step.lunge !== undefined) expect(step.lunge, key).toBeGreaterThan(0);
        if (step.shake !== undefined) expect(step.shake, key).toBeGreaterThan(0);
        if (step.hitstop !== undefined) expect(step.hitstop, key).toBeGreaterThan(0);
      }
    }
    expect(MOVESETS.twinBlades.steps.some((s) => (s.hits ?? 1) > 1), "双剣に多段ヒットの段がある").toBe(true);
    expect(MOVESETS.whip.steps.some((s) => (s.hits ?? 1) > 1), "鞭に多段ヒットの段がある").toBe(true);
  });

  it("各段の時間・威力・リーチが正で、形が妥当", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      for (const step of [...def.steps, def.dashAttack]) {
        expect(step.active, `${key} の active`).toBeGreaterThan(0);
        expect(step.recover, `${key} の recover`).toBeGreaterThan(0);
        expect(atBase(step.scaling), `${key} の威力`).toBeGreaterThan(0);
        expect(step.poise, `${key} の怯み値`).toBeGreaterThan(0);
        expect(step.size, `${key} の大きさ`).toBeGreaterThan(0);
        if (step.shape.kind === "arc") expect(step.shape.deg, `${key} の扇の角度`).toBeGreaterThan(0);
        if (step.shape.kind !== "circle") expect(step.reach, `${key} のリーチ`).toBeGreaterThan(0);
      }
    }
  });

  it("剣は現行の近接 3 段・ダッシュ攻撃・マナ回収をそのまま移植している", () => {
    const sword = MOVESETS.sword;
    expect(sword.steps.length).toBe(PLAYER.melee.length);
    sword.steps.forEach((step, i) => {
      expect(atBase(step.scaling), `${i + 1} 段目の威力`).toBeCloseTo(SWORD_PINNED[i] ?? 0);
      expect(step.poise, `${i + 1} 段目の怯み値`).toBe(PLAYER.melee[i]?.poise);
      expect(step.reach, `${i + 1} 段目のリーチ`).toBe(PLAYER.melee[i]?.reach);
      expect(step.mana, `${i + 1} 段目のマナ`).toBe(MANA.onMelee[i]);
      expect(step.shape.kind, "剣は箱の判定").toBe("box");
    });
    expect(atBase(sword.dashAttack.scaling), "ダッシュ攻撃の威力").toBeCloseTo(DASH_PINNED);
    expect(sword.dashAttack.reach).toBe(ACTION.dashAttack.reach);
    expect(sword.dashAttack.mana).toBe(MANA.onDashAttack);
    expect(sword.attackMoveMul).toBe(PLAYER.attackMoveMul);
  });

  it("溜めは大剣だけが持ち、段の時間と倍率が単調に増える", () => {
    for (const key of MOVESET_KEYS) {
      const charge = MOVESETS[key].charge;
      if (key !== "greatsword") {
        expect(charge, `${key} は溜めを持たない`).toBeUndefined();
        continue;
      }
      expect(charge?.levels.length, "大剣は 3 段階").toBe(3);
      const levels = charge?.levels ?? [];
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i]!.time).toBeGreaterThan(levels[i - 1]!.time);
        expect(levels[i]!.damageMul).toBeGreaterThan(levels[i - 1]!.damageMul);
        expect(levels[i]!.poiseMul).toBeGreaterThan(levels[i - 1]!.poiseMul);
      }
    }
  });

  it("双剣は 5 段、先端判定は突きの武器種（槍・鞭）だけ", () => {
    expect(MOVESETS.twinBlades.steps.length).toBe(5);
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      if (!def.tip) continue;
      expect(
        def.steps.some((s) => s.shape.kind === "thrust"),
        `${key} は先端判定を持つので突きの段がある`,
      ).toBe(true);
    }
    expect(MOVESETS.spear.tip?.poiseMul, "槍の穂先は怯み値 ×2").toBe(2);
  });

  it("単一最強を作らない: 攻撃中の移動・リーチ・威力のどれかで剣より劣る", () => {
    const sword = MOVESETS.sword;
    const swordReach = Math.max(...sword.steps.map((s) => s.reach + s.size / 2));
    const swordDamage = sword.steps.reduce((sum, s) => sum + atBase(s.scaling), 0);
    for (const key of MOVESET_KEYS) {
      if (key === "sword") continue;
      const def = MOVESETS[key];
      const reach = Math.max(...def.steps.map((s) => s.reach + s.size / 2));
      const damage = def.steps.reduce((sum, s) => sum + atBase(s.scaling), 0);
      const time = def.steps.reduce((sum, s) => sum + s.windup + s.active + s.recover, 0);
      const swordTime = sword.steps.reduce((sum, s) => sum + s.windup + s.active + s.recover, 0);
      const worseMove = def.attackMoveMul < sword.attackMoveMul;
      const worseReach = reach < swordReach;
      const worseDps = damage / time < swordDamage / swordTime;
      expect(worseMove || worseReach || worseDps, `${key} に不得意がある`).toBe(true);
    }
  });
});

describe("射撃の型の定義", () => {
  it("6 種以上あり、すべてが表示名・説明・語を持つ", () => {
    expect(SHOT_KEYS.length).toBeGreaterThanOrEqual(6);
    for (const key of SHOT_KEYS) {
      const def = SHOT_TYPES[key];
      expect(def.key).toBe(key);
      expect(def.name.length, `${key} の表示名`).toBeGreaterThan(0);
      expect(profileKeywords(def.keywords).length, `${key} が語を持つ`).toBeGreaterThan(0);
      expect(def.cooldownMul, `${key} の間隔`).toBeGreaterThan(0);
      expect(def.damageMul, `${key} の威力`).toBeGreaterThan(0);
    }
  });

  it("単発は現行の射撃と同じ（倍率がすべて等倍）", () => {
    const single = SHOT_TYPES.single;
    expect(single.cooldownMul).toBe(1);
    expect(single.damageMul).toBe(1);
    expect(single.speedMul).toBe(1);
    expect(single.radius).toBe(PLAYER.shoot.radius);
    expect(single.spreadDeg).toBe(PLAYER.projectileSpreadDeg);
    expect(single.pellets).toBe(0);
  });

  it("チャージの段は時間・威力が単調に増える", () => {
    const levels = SHOT_TYPES.charge.charge?.levels ?? [];
    expect(levels.length).toBe(3);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!.time).toBeGreaterThan(levels[i - 1]!.time);
      expect(levels[i]!.damageMul).toBeGreaterThan(levels[i - 1]!.damageMul);
    }
  });
});

describe("chargeLevelAt", () => {
  const levels = [{ time: 0.4 }, { time: 0.8 }, { time: 1.2 }];
  it("溜めた秒数から段を返す（届かなければ 0、上限で止まる）", () => {
    expect(chargeLevelAt(levels, 0)).toBe(0);
    expect(chargeLevelAt(levels, 0.39)).toBe(0);
    expect(chargeLevelAt(levels, 0.4)).toBe(1);
    expect(chargeLevelAt(levels, 0.9)).toBe(2);
    expect(chargeLevelAt(levels, 5)).toBe(3);
  });
});

describe("ベースとの結び付き", () => {
  it("すべての武器種・射撃の型に対応するベースがある", () => {
    for (const key of MOVESET_KEYS) {
      expect(BASES.some((b) => b.moveset === key), `武器種 ${key} のベース`).toBe(true);
    }
    for (const key of SHOT_KEYS) {
      expect(BASES.some((b) => b.shot === key), `射撃の型 ${key} のベース`).toBe(true);
    }
  });

  it("武器種は武器スロット、射撃の型は銃スロットのベースにだけ付く", () => {
    for (const base of BASES) {
      if (base.moveset) expect(base.slot, base.key).toBe("weapon");
      if (base.shot) expect(base.slot, base.key).toBe("gun");
    }
    for (const base of BASES.filter((b) => b.slot === "weapon")) expect(base.moveset, `${base.key} は武器種を持つ`).toBeDefined();
    for (const base of BASES.filter((b) => b.slot === "gun")) expect(base.shot, `${base.key} は射撃の型を持つ`).toBeDefined();
  });
});
