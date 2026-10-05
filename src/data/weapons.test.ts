import { describe, expect, it } from "vitest";
import { profileKeywords } from "../core/keywords";
import { BASES } from "../loot/bases";
import { DEFAULT_STATS } from "../loot/types";
import { scaled } from "../system/attributes";
import { BULLETS } from "../loot/bullets";
import { ACTION, MANA, PLAYER, WEAPON } from "./tuning";
import {
  type ButtonKey,
  type MovesetKey,
  GUN_MOVESETS,
  MOVESETS,
  THROWING_MOVESETS,
  WEAPON_GROUPS,
  MOVESET_KEYS,
  STEP2_NAMES,
  WEAPON_WEIGHTS,
  reviveWeight,
  type MeleeStepDef,
  actionLane,
  branchHints,
  laneLength,
  laneStep,
  laneSwing,
  chargeButton,
  chargeLevelAt,
  firesByHand,
  isGun,
  isRangedWeapon,
  isThrowingWeapon,
  matchBranch,
  meleeChargeOf,
  movesetRules,
  releaseBranchIndex,
  shootsPrimary,
  usesProjectiles,
  weaponGroup,
  withExtraBranch,
} from "./weapons";
import { JOB_BRANCHES, JOB_BRANCH_SEQUENCE } from "./jobs";
import { formOf } from "./weaponForms";
import { bulletDef } from "../loot/bullets";

/** 連刃の 3 武器種の段数（docs/ideas/weapon-forms-impl.md 3-9。左右とも同数で、右の最終段は乱舞） */
const FLURRY_STEPS = { twinBlades: 6, fists: 6, claws: 8 } as const;
/** 名前付き派生（構えを離した振りを除く）の本数と入力数（docs/ideas/ougi-and-dual-actions.md 4.3） */
const MIN_BRANCHES = 4;
const MIN_BRANCH_INPUTS = 3;
/**
 * 名前付き派生が 4 本に満たない武器種（docs/ideas/gun-bases-review.md 4-3 の 4）。
 * 手裏剣は左右とも投げで、左右を混ぜるほど本数が増える連撃そのものが派生の役を持つので 0 本。クナイは影留め・離れ投げの 2 本
 */
const FEW_BRANCHES: Readonly<Partial<Record<MovesetKey, number>>> = { kunai: 2, shuriken: 0, gunner: 0 };
/** 左右の同じ段番号の秒間威力（基礎値）の比の許容（右は重い・広い寄りなので目安から ±40%） */
const LANE_DPS_TOLERANCE = 0.4;
/** 基礎値のステータスで係数表を評価する */
const atBase = (s: Parameters<typeof scaled>[1]): number => scaled(DEFAULT_STATS, s);

/**
 * 振りの速さの段（docs/ideas/weapon-tempo.md。2026-10-02）: 速い順。
 * 速い武器は当てやすいぶん 1 撃が軽く、遅い武器は 1 撃が重く終撃が跳ね上がる
 */
const TEMPO_TIERS: readonly { name: string; keys: readonly MovesetKey[] }[] = [
  { name: "最速", keys: ["fists", "claws", "shuriken"] },
  { name: "速", keys: ["twinBlades", "chainSickle", "katana", "fan"] },
  { name: "中", keys: ["sword", "spear", "staff", "whip", "handbell", "book", "wand", "shield"] },
  { name: "重", keys: ["scythe", "axe", "cleaver", "flail"] },
  { name: "最重", keys: ["greatsword", "hammer"] },
];

/** 右レーンの振りの段 */
function rightSwings(key: MovesetKey): MeleeStepDef[] {
  return MOVESETS[key].steps2.flatMap((s) => (s.kind === "swing" ? [s.step] : []));
}

/** 名前付き派生（構えを離した振りを除く） */
function namedBranches(key: MovesetKey) {
  return MOVESETS[key].branches.filter((b) => b.art !== "release");
}

/** 1 振りの秒間威力（基礎値。多段ヒットは回数ぶん） */
function dpsAtBase(s: MeleeStepDef): number {
  return (atBase(s.scaling) * (s.hits ?? 1)) / (s.windup + s.active + s.recover);
}

describe("武器種の定義", () => {
  it("すべての武器種が表示名・説明・語を持ち、射撃専用以外は段数が型の幅（FORM.<型>.stepsMin/Max）に入る", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      expect(def.key, key).toBe(key);
      expect(def.name.length, `${key} の表示名`).toBeGreaterThan(0);
      expect(def.desc.length, `${key} の説明`).toBeGreaterThan(0);
      expect(profileKeywords(def.keywords).length, `${key} が語を持つ`).toBeGreaterThan(0);
      if (shootsPrimary(def)) continue;
      const { min, max } = formOf(def).steps;
      expect(def.steps.length, `${key} の段数（型 ${def.form} の下限 ${min}）`).toBeGreaterThanOrEqual(min);
      expect(def.steps.length, `${key} の段数（型 ${def.form} の上限 ${max}）`).toBeLessThanOrEqual(max);
    }
  });

  it("連刃の武器種は段数が双剣 6・拳 6・爪 8 で、右の最終段だけが乱舞（frenzy）", () => {
    for (const [key, count] of Object.entries(FLURRY_STEPS) as [keyof typeof FLURRY_STEPS, number][]) {
      const def = MOVESETS[key];
      expect(def.form, `${key} は連刃`).toBe("flurry");
      expect(def.steps.length, `${key} の左の段数`).toBe(count);
      expect(def.steps2.length, `${key} の右の段数`).toBe(count);
      expect(def.steps2.map((s) => s.key).indexOf("frenzy"), `${key} の乱舞は右の最終段`).toBe(count - 1);
      expect(def.steps2[count - 1]?.name, `${key} の乱舞の表示名`).toBe(STEP2_NAMES.frenzy);
      for (const b of def.branches) expect(b.next ?? 0, `${key}.${b.key} の続き`).toBeLessThan(count);
    }
  });

  it("すべての武器種が名前付き派生を 4 本以上持ち、入力列・続きの段が妥当", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      const named = namedBranches(key);
      // 二丁拳銃は派生を持たない（左右を交互に撃つ拍と、同じ手を続けた技が入力を使い切る。docs/ideas/gun-bases-review.md 4-3 の 4）
      expect(named.length, `${key} の名前付き派生`).toBeGreaterThanOrEqual(FEW_BRANCHES[key] ?? MIN_BRANCHES);
      const sequences = new Set<string>();
      for (const b of def.branches) {
        expect(b.name.length, `${key}.${b.key} の表示名`).toBeGreaterThan(0);
        expect(b.name, `${key}.${b.key} の表示名が登録済み`).not.toBe(b.key);
        expect(b.sequence.length, `${key}.${b.key} の入力列`).toBeGreaterThan(0);
        if (b.next !== undefined) expect(b.next, `${key}.${b.key} の続き`).toBeLessThan(Math.max(def.steps.length, def.steps2.length));
        sequences.add(b.sequence.join(","));
      }
      expect(sequences.size, `${key} の入力列は重複しない`).toBe(def.branches.length);
    }
  });

  it("名前付き派生は 3 入力以上で、長い列が先に一致する（右左左 → 踏み込み斬り）", () => {
    for (const key of MOVESET_KEYS) {
      for (const b of namedBranches(key)) {
        expect(b.sequence.length, `${key}.${b.key} は 3 入力以上`).toBeGreaterThanOrEqual(MIN_BRANCH_INPUTS);
        // 同じボタンの繰り返し（左左左 / 右右右）は派生にしない（共有の段カウンタでそのまま段が進む）
        expect(new Set(b.sequence).size, `${key}.${b.key} は左右を混ぜる`).toBe(2);
      }
      const lengths = MOVESETS[key].branches.map((b) => b.sequence.length);
      expect([...lengths].sort((a, b) => b - a), `${key} は長い列が先`).toEqual(lengths);
    }
    const sword = MOVESETS.sword;
    const at = (inputs: ButtonKey[]): string | undefined => {
      const i = matchBranch(sword, inputs);
      return i === undefined ? undefined : sword.branches[i]?.key;
    };
    expect(at(["secondary", "primary", "primary"]), "右左左").toBe("steppingCut");
    expect(at(["primary", "secondary", "primary", "primary"]), "末尾で照合する").toBe("steppingCut");
    expect(at(["secondary", "primary"]), "2 入力では出ない").toBeUndefined();
    expect(at(["secondary", "secondary", "secondary"]), "右右右は派生にしない").toBeUndefined();
    const twin = MOVESETS.twinBlades;
    const i = matchBranch(twin, ["primary", "primary", "primary", "secondary"]);
    expect(i === undefined ? undefined : twin.branches[i]?.key, "左左左右は左左右より長い列が先").toBe("crossing");
  });

  it("左で振る武器種は steps2 が steps と同じ長さ、左で撃つ武器種は型の段数の幅（戦輪は 4 段）", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      if (!shootsPrimary(def)) {
        expect(def.steps2.length, `${key} の右レーンの段数`).toBe(def.steps.length);
        continue;
      }
      // 二丁は右の手の連撃 2 段に空の手の銃把打ちを足した 3 段（左の手の連撃の段数と型の幅は 2）
      if (def.primary === "hands") {
        expect(def.steps2.length, `${key} の右レーンの段数`).toBe(def.steps.length + 1);
        continue;
      }
      const { min, max } = formOf(def).steps;
      expect(def.steps2.length, `${key} の右レーンの段数（型 ${def.form} の下限 ${min}）`).toBeGreaterThanOrEqual(min);
      expect(def.steps2.length, `${key} の右レーンの段数（型 ${def.form} の上限 ${max}）`).toBeLessThanOrEqual(max);
    }
    expect(MOVESETS.ringBlades.steps2.length, "戦輪は 4 段").toBe(4);
  });

  it("右レーンの段は key と名前が登録済みで、弾の段の弾は武器種をまたいで重ならない", () => {
    const bulletKeys = new Set<string>();
    for (const key of MOVESET_KEYS) {
      MOVESETS[key].steps2.forEach((s, i) => {
        expect(s.key, `${key} の右 ${i + 1} 段目の key`).toBeDefined();
        expect(s.name, `${key} の右 ${i + 1} 段目の名前`).toBe(STEP2_NAMES[s.key ?? ""]);
        if (s.kind !== "volley") return;
        expect(bulletKeys.has(s.throw.bullet.key), `${s.throw.bullet.key} が重ならない`).toBe(false);
        bulletKeys.add(s.throw.bullet.key);
        expect(BULLETS[s.throw.bullet.key], `${s.throw.bullet.key} を弾の表から引ける`).toBe(s.throw.bullet);
      });
    }
  });

  it("左右の同じ段番号は秒間威力の目安がそろい、右の recover は左以上", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      if (shootsPrimary(def)) continue;
      def.steps2.forEach((s, i) => {
        const l = def.steps[i];
        // 右 1 段目は旧固有技（数値据え置き）なので見ない
        if (i === 0 || s.kind !== "swing" || !l) return;
        const ratio = dpsAtBase(s.step) / dpsAtBase(l);
        expect(ratio, `${key} の ${i + 1} 段目: 右 / 左 の秒間威力`).toBeGreaterThan(1 - LANE_DPS_TOLERANCE);
        expect(ratio, `${key} の ${i + 1} 段目: 右 / 左 の秒間威力`).toBeLessThan(1 + LANE_DPS_TOLERANCE);
        expect(s.step.recover, `${key} の ${i + 1} 段目の recover`).toBeGreaterThanOrEqual(l.recover);
      });
    }
  });

  it("派生の照合は入力列の末尾で、右 1 手だけでは派生にならない", () => {
    const gs = MOVESETS.greatsword;
    const at = (inputs: ButtonKey[]): string | undefined => {
      const i = matchBranch(gs, inputs);
      return i === undefined ? undefined : gs.branches[i]?.key;
    };
    expect(at(["secondary"]), "右 1 手は右レーンの 1 段目（薙ぎ払い）").toBeUndefined();
    expect(at(["primary", "primary", "secondary"]), "左左右は兜割り").toBe("helmSplitter");
    expect(at(["secondary", "secondary", "primary"]), "右右左は横一文字").toBe("gsHorizon");
    expect(at(["primary", "primary"])).toBeUndefined();
  });

  it("ボタンの役割: 近接の武器種は撃てず、右は固有技。左で撃つのは銃と一部の投擲物", () => {
    expect(MOVESETS.sword.primary).toBe("melee");
    expect(MOVESETS.sword.steps2[0].kind, "剣の右は受け流し").toBe("hold");
    expect(shootsPrimary(MOVESETS.sword), "剣は撃てない").toBe(false);
    expect(shootsPrimary(MOVESETS.greatsword), "大剣は撃てない").toBe(false);
    expect(MOVESETS.wand.primary, "杖は左で打つ").toBe("melee");
    expect(MOVESETS.wand.steps2[0].kind, "杖の右は氷槍").toBe("volley");
    for (const key of GUN_MOVESETS) expect(shootsPrimary(MOVESETS[key]), `${key} は左で撃つ`).toBe(true);
  });

  it("多段ヒット・踏み込み・揺れの数値が正", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      const all = [...def.steps, def.dashAttack, ...def.branches.map((b) => b.step), ...rightSwings(key)];
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
      for (const step of [...def.steps, def.dashAttack, ...rightSwings(key), ...def.branches.map((b) => b.step)]) {
        expect(step.active, `${key} の active`).toBeGreaterThan(0);
        expect(step.recover, `${key} の recover`).toBeGreaterThan(0);
        expect(atBase(step.scaling), `${key} の威力`).toBeGreaterThan(0);
        // 当たり判定の大きさ 0 は純粋な詠唱・投げ（書の左・手裏剣・戦輪の近投げ。弾だけが当たる）。怯み値と形の検査は判定を持つ段だけ
        if (step.cast !== undefined && step.size === 0) continue;
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
        expect(atBase(step.scaling), `${i + 1} 段目の威力`).toBeCloseTo(atBase(PLAYER.melee[i]!.scaling) * WEAPON.meleeDamageScale);
      expect(step.poise, `${i + 1} 段目の怯み値`).toBe(PLAYER.melee[i]?.poise);
      expect(step.reach, `${i + 1} 段目のリーチ`).toBe(PLAYER.melee[i]?.reach);
      expect(step.mana, `${i + 1} 段目のマナ`).toBe(MANA.onMelee[i] ?? 0);
      expect(step.shape.kind, "剣は箱の判定").toBe("box");
    });
      expect(atBase(sword.dashAttack.scaling), "ダッシュ攻撃の威力").toBeCloseTo(atBase(ACTION.dashAttack.scaling) * WEAPON.meleeDamageScale);
    expect(sword.dashAttack.reach).toBe(ACTION.dashAttack.reach);
    expect(sword.dashAttack.mana).toBe(MANA.onDashAttack);
    expect(sword.attackMoveMul).toBe(PLAYER.attackMoveMul);
  });

  it("近接の溜めは溜めの役割のボタンを持つ武器種だけが持ち、段の時間と倍率が単調に増える", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      const charge = meleeChargeOf(def);
      // 短銃の狙い撃ちは右の構えの経路なので、近接の溜めのボタンを持たない
      if (chargeButton(def) === undefined) {
        expect(charge, `${key} は溜めを持たない`).toBeUndefined();
        continue;
      }
      expect(charge, `${key} は溜めの役割があるので溜めを持つ`).toBeDefined();
      expect(charge?.levels.length ?? 0, `${key} の段数`).toBeGreaterThanOrEqual(2);
      const levels = charge?.levels ?? [];
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i]!.time).toBeGreaterThan(levels[i - 1]!.time);
        expect(levels[i]!.damageMul).toBeGreaterThan(levels[i - 1]!.damageMul);
        expect(levels[i]!.poiseMul).toBeGreaterThan(levels[i - 1]!.poiseMul);
      }
    }
  });

  it("双剣は 6 段、先端判定は突きの武器種（槍・鞭）だけ", () => {
    expect(MOVESETS.twinBlades.steps.length).toBe(FLURRY_STEPS.twinBlades);
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

  it("単一最強を作らない: 攻撃中の移動・リーチ・威力のどれかで剣より劣る（左右のレーンの最大値で比べる）", () => {
    const laneDps = (steps: readonly MeleeStepDef[]): number => {
      const damage = steps.reduce((sum, s) => sum + atBase(s.scaling), 0);
      const time = steps.reduce((sum, s) => sum + s.windup + s.active + s.recover, 0);
      return time > 0 ? damage / time : 0;
    };
    const bestDps = (key: MovesetKey): number => Math.max(laneDps(MOVESETS[key].steps), laneDps(rightSwings(key)));
    const bestReach = (key: MovesetKey): number => Math.max(...[...MOVESETS[key].steps, ...rightSwings(key)].map((s) => s.reach + s.size / 2));
    const sword = MOVESETS.sword;
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      if (key === "sword" || shootsPrimary(def)) continue;
      const worseMove = def.attackMoveMul < sword.attackMoveMul;
      const worseReach = bestReach(key) < bestReach("sword");
      const worseDps = bestDps(key) < bestDps("sword");
      expect(worseMove || worseReach || worseDps, `${key} に不得意がある`).toBe(true);
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
  it("すべての武器種に対応するベースがある", () => {
    for (const key of MOVESET_KEYS) {
      expect(BASES.some((b) => b.moveset === key), `武器種 ${key} のベース`).toBe(true);
    }
  });
});

describe("branchHints（docs/ideas/combat-feel-design.md D-1）", () => {
  it("剣で左左の後は右に十字断ちが出る", () => {
    const hints = branchHints(MOVESETS.sword, ["primary", "primary"]);
    expect(hints).toContainEqual({ button: "secondary", name: "十字断ち" });
  });

  it("右左の後は左に踏み込み斬りが出る", () => {
    const hints = branchHints(MOVESETS.sword, ["secondary", "primary"]);
    expect(hints).toContainEqual({ button: "primary", name: "踏み込み斬り" });
  });

  it("一致する派生が無ければ空", () => {
    expect(branchHints(MOVESETS.sword, [])).toEqual([]);
    expect(branchHints(MOVESETS.sword, ["secondary"]), "右 1 手だけでは 3 入力の派生に届かない").toEqual([]);
  });
});

describe("武器種の拡張（docs/ideas/combat-feel-design.md レーン B）", () => {
  const NEW_MOVESETS = ["katana", "axe", "shield", "chainSickle", "hammer", "gunner"] as const;
  /** 固有効果（rules）を持つ新しい武器種（二丁拳銃の遠距離の命中の Rule は消した。gun-bases-review 0-2） */
  const RULED_MOVESETS = NEW_MOVESETS.filter((k) => k !== "gunner");
  /** 序盤（itemLevel 3）で拾える器があること */
  const EARLY_LEVEL = 3;

  it("新しい武器種 6 種が登録されている", () => {
    for (const key of NEW_MOVESETS) expect(MOVESET_KEYS, key).toContain(key);
  });

  it("新しい武器種のそれぞれに itemLevel 3 以下の器がある", () => {
    for (const key of NEW_MOVESETS) {
      expect(BASES.some((b) => b.moveset === key && b.minLevel <= EARLY_LEVEL), `武器種 ${key} の序盤の器`).toBe(true);
    }
  });

  it("ボタンの役割: 刀は右が居合、戦鎚は左が溜め、二丁拳銃は左右の手で撃つ", () => {
    expect(chargeButton(MOVESETS.katana), "刀の溜めは右").toBe("secondary");
    expect(MOVESETS.katana.primary, "刀の連撃は左").toBe("melee");
    expect(chargeButton(MOVESETS.hammer), "戦鎚の溜めは左").toBe("primary");
    expect(chargeButton(MOVESETS.greatsword), "大剣の溜めは左のまま").toBe("primary");
    expect(chargeButton(MOVESETS.sword), "剣は溜めを持たない").toBeUndefined();
    expect(shootsPrimary(MOVESETS.gunner), "二丁拳銃は左で撃つ").toBe(true);
    expect(MOVESETS.gunner.primary, "二丁拳銃は左右のクリックが左手・右手の銃").toBe("hands");
    expect(firesByHand(MOVESETS.gunner), "二丁拳銃は手で撃つ").toBe(true);
    expect(firesByHand(MOVESETS.sidearm), "短銃は押しっぱなしで撃つ").toBe(false);
    expect(shootsPrimary(MOVESETS.sword), "剣は撃たない").toBe(false);
  });

  it("武器種の固有効果（rules）は持ち主の武器種ごとに id が分かれ、持たない武器種は空", () => {
    expect(movesetRules("sword"), "剣は固有効果を持たない").toEqual([]);
    const ids = new Set<string>();
    for (const key of RULED_MOVESETS) {
      const rules = movesetRules(key);
      expect(rules.length, `${key} は固有効果を持つ`).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.owner.key, `${key} の持ち主`).toBe(`moveset.${key}`);
        ids.add(r.id);
      }
    }
    const total = RULED_MOVESETS.reduce((n, k) => n + movesetRules(k).length, 0);
    expect(ids.size, "id は重ならない").toBe(total);
  });

  it("段の applies: 斧の最終段は出血、鎖鎌の分銅は崩勢を付ける", () => {
    const axeLast = MOVESETS.axe.steps[MOVESETS.axe.steps.length - 1];
    // 刃斧の左の段はどれも傷を 1 つ刻む（data/weaponForms.ts の刃斧）
    expect(axeLast?.applies?.map((a) => a.kind)).toEqual(["bleed", "wound"]);
    const first = MOVESETS.chainSickle.steps2[0];
    const weight = first.kind === "swing" ? first.step : undefined;
    expect(first.key, "鎖鎌の右 1 段目は分銅").toBe("chainWeight");
    expect(weight?.applies?.map((a) => a.kind)).toEqual(["broken"]);
    expect(weight?.pull, "分銅は引き寄せる").toBe(true);
  });

  it("弾: 三点は 3 発、戦輪の輪は弧で飛んで上下 2 枚、曲射は炸裂の半径を持つ", () => {
    expect(bulletDef("burstRifle").burst?.count).toBe(3);
    expect(bulletDef("ringBlades").arc?.catchRadius ?? 0, "手元で収まる距離").toBeGreaterThan(0);
    expect(bulletDef("ringBlades").pair?.offset ?? 0, "体の上下から 2 枚").toBeGreaterThan(0);
    expect(bulletDef("mortar").lob?.blastRadius ?? 0).toBeGreaterThan(0);
  });
});

describe("ジョブ固有の派生", () => {
  it("すべてのジョブ（見習い以外）が固有の派生を持ち、表示名が登録済みで入力は左左左右", () => {
    for (const [job, branch] of Object.entries(JOB_BRANCHES)) {
      expect(branch.name.length, `${job} の表示名`).toBeGreaterThan(0);
      expect(branch.name, `${job} の表示名が key のままでない`).not.toBe(branch.key);
      expect(branch.sequence, `${job} の入力`).toEqual(JOB_BRANCH_SEQUENCE);
      expect(branch.next, `${job} の派生はフィニッシュ`).toBeUndefined();
      expect(atBase(branch.step.scaling), `${job} の威力`).toBeGreaterThan(0);
    }
  });

  it("ジョブの派生は装備の武器種の派生と衝突せず、長い列が先に一致する", () => {
    const extra = JOB_BRANCHES.swordsman;
    for (const key of MOVESET_KEYS) {
      const merged = withExtraBranch(MOVESETS[key], extra);
      const seqs = merged.branches.map((b) => b.sequence.join(","));
      expect(new Set(seqs).size, `${key}: 入力列が重ならない`).toBe(seqs.length);
      for (let i = 1; i < merged.branches.length; i++) {
        expect(merged.branches[i - 1]!.sequence.length, `${key}: 長い列が先`).toBeGreaterThanOrEqual(merged.branches[i]!.sequence.length);
      }
    }
    // 剣: 左左左右はジョブの派生、左左右は十字断ちのまま
    const sword = withExtraBranch(MOVESETS.sword, extra);
    const at = (inputs: ButtonKey[]): string | undefined => {
      const i = matchBranch(sword, inputs);
      return i === undefined ? undefined : sword.branches[i]?.key;
    };
    expect(at(["primary", "primary", "primary", "secondary"])).toBe(extra.key);
    expect(at(["primary", "primary", "secondary"])).toBe("crossCut");
    // 双剣は同じ列（交差斬り）を持つので武器種が優先され、ジョブの派生は足されない
    const twin = withExtraBranch(MOVESETS.twinBlades, extra);
    expect(twin.branches.length, "双剣の派生数は変わらない").toBe(MOVESETS.twinBlades.branches.length);
  });
});

describe("右レーンの 1 段目（旧固有技。docs/ideas/weapon-redesign.md 3 章）", () => {
  const EXPECTED_ART: Readonly<Record<MovesetKey, string>> = {
    sword: "hold",
    greatsword: "swing",
    twinBlades: "swing",
    spear: "swing",
    scythe: "swing",
    fists: "swing",
    whip: "swing",
    cleaver: "swing",
    staff: "swing",
    wand: "volley",
    katana: "charge",
    axe: "volley",
    shield: "hold",
    chainSickle: "swing",
    hammer: "swing",
    gunner: "swing",
    sidearm: "swing",
    longarm: "swing",
    cannon: "swing",
    grenade: "swing",
    trapper: "volley",
    claws: "swing",
    flail: "charge",
    ringBlades: "swing",
    fan: "hold",
    book: "swing",
    handbell: "swing",
    kunai: "swing",
    shuriken: "swing",
  };

  it("すべての武器種が右 1 段目の技を持ち、名前が登録済みで種類が設計どおり", () => {
    for (const key of MOVESET_KEYS) {
      const art = MOVESETS[key].steps2[0];
      expect(art.kind, `${key} の技の種類`).toBe(EXPECTED_ART[key]);
      expect(art.name, `${key} の技の名前`).toBe(STEP2_NAMES[art.key ?? ""]);
      expect(art.desc?.length ?? 0, `${key} の技の説明`).toBeGreaterThan(0);
      expect(art.cooldown, `${key} の再使用`).toBeGreaterThanOrEqual(0);
    }
  });

  it("右 1 段目の振りは派生ではなく右レーンの段で、左左右は派生（兜割り）", () => {
    const gs = MOVESETS.greatsword;
    expect(gs.branches.some((b) => b.key === "sweep"), "薙ぎ払いは派生に混ざらない").toBe(false);
    expect(gs.steps2[0].key, "右 1 段目は薙ぎ払い").toBe("sweep");
    const i = matchBranch(gs, ["primary", "primary", "secondary"]);
    expect(i === undefined ? undefined : gs.branches[i]?.key, "左左右は兜割り").toBe("helmSplitter");
  });

  it("盾の構えを離した盾押しは派生に入るが、右を押した瞬間には照合しない", () => {
    const shield = MOVESETS.shield;
    const index = releaseBranchIndex(shield);
    expect(index, "盾押しの派生がある").toBeDefined();
    expect(shield.branches[index ?? -1]?.name).toBe("盾押し");
    expect(matchBranch(shield, ["secondary"]), "右の押下は構え（派生にしない）").toBeUndefined();
    expect(branchHints(shield, []).some((h) => h.name === "盾押し"), "案内にも出さない").toBe(false);
  });

  it("2 入力だった派生は 3 入力に伸ばした（踏み込み斬り・抜き打ち・回転斬りは右左左）", () => {
    const seqOf = (key: MovesetKey, branch: string) => MOVESETS[key].branches.find((b) => b.key === branch)?.sequence;
    expect(seqOf("sword", "steppingCut")).toEqual(["secondary", "primary", "primary"]);
    expect(seqOf("katana", "quickDraw")).toEqual(["secondary", "primary", "primary"]);
    expect(seqOf("axe", "axeSpin")).toEqual(["secondary", "primary", "primary"]);
  });

  it("武器種は群を 1 つ持ち、銃は 6 種（cannon・grenade・gunner・longarm・sidearm・trapper）", () => {
    for (const key of MOVESET_KEYS) expect(WEAPON_GROUPS, `${key} の群`).toContain(weaponGroup(MOVESETS[key]));
    expect([...GUN_MOVESETS].sort(), "銃の群").toEqual(["cannon", "grenade", "gunner", "longarm", "sidearm", "trapper"]);
    for (const key of MOVESET_KEYS) {
      const group = weaponGroup(MOVESETS[key]);
      expect(GUN_MOVESETS.includes(key), `${key} は銃の一覧に群どおり入る`).toBe(group === "gun");
      expect(THROWING_MOVESETS.includes(key), `${key} は投擲物の一覧に群どおり入る`).toBe(group === "throwing");
      expect(isThrowingWeapon(MOVESETS[key]), `${key} の投擲物の判定`).toBe(group === "throwing");
      expect(isRangedWeapon(MOVESETS[key]), `${key} の近接でない群の判定`).toBe(group !== "melee");
    }
  });

  it("isGun は銃の群だけ。左で撃つかは shootsPrimary で別に判定する", () => {
    for (const key of MOVESET_KEYS) expect(isGun(MOVESETS[key]), key).toBe(weaponGroup(MOVESETS[key]) === "gun");
    expect(isGun(MOVESETS.kunai), "クナイは銃ではない").toBe(false);
    expect(shootsPrimary(MOVESETS.kunai), "クナイは左で投げる").toBe(true);
    expect(isGun(MOVESETS.ringBlades), "戦輪は銃ではない").toBe(false);
    expect(shootsPrimary(MOVESETS.ringBlades), "戦輪は左で投げる").toBe(true);
    expect(shootsPrimary(MOVESETS.shuriken), "手裏剣は左も振りが撃つ弾（器の弾を撃たない）").toBe(false);
    for (const key of GUN_MOVESETS) expect(shootsPrimary(MOVESETS[key]), `${key} は左で撃つ`).toBe(true);
  });

  it("二丁拳銃は遠距離の命中で奥義ゲージを得ない（Rule が無い）", () => {
    expect(movesetRules("gunner"), "二丁拳銃の固有効果").toEqual([]);
    const ranged = MOVESET_KEYS.flatMap((k) => movesetRules(k)).filter((r) => r.when === "onRangedHit" && r.then.kind === "energy");
    expect(ranged.map((r) => r.id), "遠距離の命中で奥義ゲージを得る武器種の Rule").toEqual([]);
  });

  it("弾を出す武器種の判定は左で撃つ武器種と投げる技を持つ近接", () => {
    for (const key of MOVESET_KEYS) if (shootsPrimary(MOVESETS[key])) expect(usesProjectiles(MOVESETS[key]), key).toBe(true);
    expect(usesProjectiles(MOVESETS.axe), "斧は投擲するので弾を出す").toBe(true);
    expect(usesProjectiles(MOVESETS.wand), "杖は魔法を撃つ").toBe(true);
    expect(usesProjectiles(MOVESETS.sword), "剣は弾を出さない").toBe(false);
    expect(usesProjectiles(MOVESETS.sidearm)).toBe(true);
  });

  it("振りの速さの段（docs/ideas/weapon-tempo.md）: 遅い段ほど予備動作が長く、1 撃と終撃が重い", () => {
    const hit = (s: MeleeStepDef): number => atBase(s.scaling) * (s.hits ?? 1);
    const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    let prev: { windup: number; first: number; finisher: number } | undefined;
    for (const tier of TEMPO_TIERS) {
      const windup = mean(tier.keys.map((key) => MOVESETS[key].steps[0]!.windup));
      // 詠唱で撃つ武器種（書・杖）は弾が威力を持つので、振りの重さの比べから外す
      const swung = tier.keys.filter((k) => !MOVESETS[k].steps.some((s) => s.cast !== undefined));
      const first = mean(swung.map((k) => hit(MOVESETS[k].steps[0]!)));
      const finisher = mean(swung.map((k) => hit(MOVESETS[k].steps[MOVESETS[k].steps.length - 1]!)));
      if (prev) {
        expect(windup, `${tier.name} の予備動作は前の段より長い`).toBeGreaterThan(prev.windup);
        expect(first, `${tier.name} の 1 段目の 1 撃は前の段より重い`).toBeGreaterThan(prev.first);
        expect(finisher, `${tier.name} の終撃は前の段より重い`).toBeGreaterThan(prev.finisher);
      }
      prev = { windup, first, finisher };
    }
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      for (const s of [...def.steps, def.dashAttack, ...def.branches.map((b) => b.step), ...rightSwings(key)]) {
          expect(s.windup, `weapons.WEAPON.movesets.${key} の windup は 2 ステップ以上`).toBeGreaterThanOrEqual(0.02);
      }
    }
  });

  it("振りの速さの段に左で振る武器種がすべて入っている（左で撃つ武器種は外す）", () => {
    const listed = TEMPO_TIERS.flatMap((t) => t.keys);
    const melee = MOVESET_KEYS.filter((k) => !shootsPrimary(MOVESETS[k]));
    expect([...listed].sort()).toEqual([...melee].sort());
  });
});

describe("右レーン（steps2）の補助関数（docs/ideas/ougi-and-dual-actions.md 4.1）", () => {
  it("laneLength は左右のレーンの段数を返す", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      expect(laneLength(def, "secondary"), `${key} の右レーン`).toBe(def.steps2.length);
      expect(laneLength(def, "primary"), `${key} の左レーン`).toBe(def.steps.length);
    }
  });

  it("laneStep / laneSwing はレーンごとに段を引き、右の振り以外の段は振りを返さない", () => {
    const gs = MOVESETS.greatsword;
    expect(laneStep(gs, "primary", 0), "左の 1 段目").toBe(gs.steps[0]);
    expect(laneStep(gs, "secondary", 0), "右の 1 段目").toBe(gs.steps2[0]);
    const first = gs.steps2[0];
    expect(laneSwing(gs, "secondary", 0), "薙ぎ払いは振り").toBe(first.kind === "swing" ? first.step : "振りではない");
    expect(laneSwing(MOVESETS.sword, "secondary", 0), "受け流しは振りではない").toBeUndefined();
    expect(laneStep(gs, "secondary", 99), "範囲外").toBeUndefined();
  });

  it("actionLane は空の右レーンを読み込み時に落とす", () => {
    expect(() => actionLane([]), "空は誤り").toThrow();
    expect(actionLane([MOVESETS.sword.steps2[0]])[0], "1 段なら通す").toBe(MOVESETS.sword.steps2[0]);
  });
});

describe("武器 Wave 4 の武器種（docs/ideas/weapons-wave4.md 2〜5 章）", () => {
  const WAVE4 = ["claws", "flail", "ringBlades", "fan"] as const;

  it("4 武器種が登録され、どれも固有効果を持ち、器（ベース）が 2 つ以上ある。戦輪（チャクラムを統合）だけ左で投げる", () => {
    for (const key of WAVE4) {
      expect(MOVESET_KEYS, key).toContain(key);
      expect(shootsPrimary(MOVESETS[key]), `${key} は左で振る（戦輪は投げる）`).toBe(key === "ringBlades");
      expect(movesetRules(key).length, `${key} の固有効果`).toBeGreaterThan(0);
      const bases = BASES.filter((b) => b.moveset === key);
      expect(bases.length, `${key} の器`).toBeGreaterThanOrEqual(2);
      for (const b of bases) expect(b.slot, `${b.key} は右手`).toBe("mainHand");
    }
  });

  it("爪は左の全段が多段ヒットで、最終段と右の最終段（乱舞）が出血を付ける", () => {
    const claws = MOVESETS.claws;
    for (const s of claws.steps) expect(s.hits ?? 1, "爪の左の段は 2 回以上当たる").toBeGreaterThanOrEqual(2);
    expect(claws.steps[claws.steps.length - 1]?.applies?.map((a) => a.kind)).toEqual(["bleed"]);
    const last = claws.steps2[claws.steps2.length - 1];
    expect(last?.key, "右の最終段は乱舞").toBe("frenzy");
    expect(last?.kind === "swing" ? last.step.applies?.map((a) => a.kind) : undefined, "乱舞").toEqual(["bleed"]);
    const leap = claws.steps2.find((s) => s.key === "leapBack");
    expect(leap?.kind === "swing" ? (leap.extras?.selfKnock ?? 0) : 0, "跳び退きは自分を後ろへ押す").toBeGreaterThan(0);
  });

  it("チェーンアレイの右 1 段目は溜め（回し）で、溜め中の周期ヒットを持つ", () => {
    const flail = MOVESETS.flail;
    expect(flail.steps2[0].kind).toBe("charge");
    expect(chargeButton(flail), "溜めは右").toBe("secondary");
    expect(meleeChargeOf(flail)?.spinning?.interval ?? 0, "回しの周期").toBeGreaterThan(0);
  });

  it("戦輪は投擲物の群で左で投げ、右は輪払い・近投げ・輪払い・強化投げ。近投げと強化投げは戻る弾を撃ち、派生 4 本を残す", () => {
    const ring = MOVESETS.ringBlades;
    expect(ring.name).toBe("戦輪");
    expect(weaponGroup(ring), "投擲物の群").toBe("throwing");
    expect(ring.steps, "左に振りの段は無い").toEqual([]);
    expect(ring.steps2.map((s) => s.key)).toEqual(["ringSweep", "ringToss", "ringSweep2", "ringHurl"]);
    for (const key of ["ringToss", "ringHurl"]) {
      const s = ring.steps2.find((x) => x.key === key);
      const cast = s?.kind === "swing" ? s.step.cast : undefined;
      expect(cast?.throw.bullet.arc?.range ?? 0, `${key} は短い固定の射程の弧で戻る弾を撃つ`).toBeGreaterThan(0);
    }
    const arcRange = (key: string): number => {
      const s = ring.steps2.find((x) => x.key === key);
      return (s?.kind === "swing" ? s.step.cast?.throw.bullet.arc?.range : undefined) ?? 0;
    };
    expect(arcRange("ringHurl"), "強化投げは近投げより遠くへ").toBeGreaterThan(arcRange("ringToss"));
    const pairOf = (key: string): boolean => {
      const s = ring.steps2.find((x) => x.key === key);
      return s?.kind === "swing" && s.step.cast?.throw.bullet.pair !== undefined;
    };
    expect(pairOf("ringToss"), "近投げは 1 枚").toBe(false);
    expect(pairOf("ringHurl"), "強化投げは 2 枚").toBe(true);
    expect(ring.waitForReturn, "戻るまで次を投げられない").toBe(true);
    expect(ring.branches.map((b) => b.key).sort()).toEqual(["doubleSever", "moonCut", "ringDash", "stackedRings"]);
    expect(ring.branches.find((b) => b.key === "stackedRings")?.shots?.from, "重ね輪は器の輪を投げる").toBeUndefined();
    for (const b of BASES.filter((x) => x.moveset === "ringBlades")) expect(bulletDef(b.key).arc, `${b.key} の弾は弧で戻る`).toBeDefined();
    expect(bulletDef("fangRings").grind, "牙輪は食い込む").toBeDefined();
    expect(bulletDef("ringBlades").grind, "輪刃は食い込まない").toBeUndefined();
    // 射程は速さ × 寿命で決まる（寿命だけで比べると、速さで差を付ける調整で落ちる）
    const reachMul = (key: string): number => bulletDef(key).speedMul * bulletDef(key).lifeMul;
    expect(reachMul("fangRings"), "牙輪の射程は輪刃より短い").toBeLessThan(reachMul("ringBlades"));
  });

  it("クナイ・手裏剣は投擲物の群。クナイは左で器の弾を投げ、手裏剣は左右とも振りが弾を投げる", () => {
    expect(THROWING_MOVESETS, "投擲物の群").toEqual(["ringBlades", "kunai", "shuriken"]);
    expect(MOVESETS.kunai.steps2.map((s) => s.key)).toEqual(["kunaiCut", "kunaiReturn", "kunaiDrive"]);
    expect(MOVESETS.kunai.form).toBe("dart");
    expect(bulletDef("kunai").pierceBonus, "クナイは貫かない").toBe(0);
    const shuriken = MOVESETS.shuriken;
    expect(shuriken.form).toBe("star");
    expect(shuriken.steps.map((s) => (s.cast?.throw.count ?? 0) * (s.cast?.throw.bullet.burst?.count ?? 1)), "左は 3 連射 → 4 連射 → 大手裏剣").toEqual([3, 4, 1]);
    expect(shuriken.steps2.map((s) => (s.kind === "swing" ? s.step.cast?.throw.count : undefined)), "右は扇に 3 本 → 4 本 → 大手裏剣").toEqual([3, 4, 1]);
    for (const key of ["kunai", "shuriken"] as const) expect(BASES.filter((b) => b.moveset === key).map((b) => b.key), `${key} の器`).toEqual([key]);
  });

  it("扇子の右 1 段目は構えで、離した突風・左 4 段目・颪は敵弾を払う", () => {
    const fan = MOVESETS.fan;
    expect(fan.steps2[0].kind === "hold" ? fan.steps2[0].hold.guard : undefined, "扇ぎは構え").toBeDefined();
    const release = releaseBranchIndex(fan);
    expect(fan.branches[release ?? -1]?.name, "離すと突風").toBe("突風");
    expect(fan.branches[release ?? -1]?.step.cutsBullets, "突風は敵弾を払う").toBe(true);
    expect(fan.steps[3]?.cutsBullets, "左 4 段目").toBe(true);
    expect(fan.branches.find((b) => b.key === "downdraft")?.step.cutsBullets, "颪").toBe(true);
    expect(fan.attack.genre.quality, "扇子は混成").toBe("hybrid");
  });
});

describe("武器の重さ（docs/ideas/combat-core-impl.md 2-5）", () => {
  /** 攻撃中の移動倍率が重さの帯の外にあり、丸められる武器種（丸めた結果を手触りとして受け入れる。理由は割り当て表） */
  const EXPECTED_CLAMP: Readonly<Partial<Record<MovesetKey, string>>> = {
    claws: "0.85 → 軽の上限 0.8",
    fists: "1.0 → 軽の上限 0.8",
    fan: "1.0 → 軽の上限 0.8（暫定で軽。段取り 5 で見直す）",
    chainSickle: "0.6 → 中の上限 0.5",
    trapper: "0.7 → 中の上限 0.5",
    shield: "0.45 → 重の上限 0.3",
    longarm: "0.5 → 重の上限 0.3",
    cannon: "0.4 → 重の上限 0.3",
  };

  it("全武器種が WEAPON_WEIGHTS のどれかの weight を持つ", () => {
    for (const key of MOVESET_KEYS) {
      expect(WEAPON_WEIGHTS, `${key} の weight`).toContain(MOVESETS[key].weight);
    }
  });

  it("weightClass は全部の重さの係数を持ち、移動の帯が下限 <= 上限", () => {
    for (const w of WEAPON_WEIGHTS) {
      const c = WEAPON.weightClass[w];
      expect(c.moveMulMin, `${w} の帯`).toBeLessThanOrEqual(c.moveMulMax);
      expect(c.lockRecoverRatio, `${w} の硬直ロック割合`).toBeGreaterThanOrEqual(0);
      expect(c.lockRecoverRatio, `${w} の硬直ロック割合`).toBeLessThanOrEqual(1);
    }
  });

  it("重いほど硬直の前半を取り消せない・止まる（重さの順序）", () => {
    const { light, medium, heavy } = WEAPON.weightClass;
    expect(light.lockActive, "軽は持続中も切れる").toBe(false);
    expect(medium.lockActive && heavy.lockActive, "中・重は持続中は切れない").toBe(true);
    expect(heavy.lockRecoverRatio, "重は硬直の前半も切れない").toBeGreaterThan(medium.lockRecoverRatio);
    expect(heavy.moveMulMax, "重がいちばん遅い").toBeLessThanOrEqual(medium.moveMulMin);
    expect(medium.moveMulMax).toBeLessThanOrEqual(light.moveMulMax);
  });

  it("攻撃中・終撃でも足は完全には止まらない（遅くはしても 0 にしない）", () => {
    for (const w of WEAPON_WEIGHTS) {
      const c = WEAPON.weightClass[w];
      expect(c.moveMulMin, `${w} の帯の下限`).toBeGreaterThan(0);
      expect(c.finisherMoveMul === -1 || c.finisherMoveMul > 0, `${w} の終撃の足`).toBe(true);
    }
  });

  it("attackMoveMul が重さの帯の外の武器種は EXPECTED_CLAMP に理由付きで載っている（帯の中なら載せない）", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      const c = WEAPON.weightClass[def.weight];
      const outside = def.attackMoveMul < c.moveMulMin || def.attackMoveMul > c.moveMulMax;
      expect(EXPECTED_CLAMP[key] !== undefined, `${key} の帯外の扱い`).toBe(outside);
    }
  });

  it("銃の群は縛らない（軽・中・重のどれでもよい）", () => {
    for (const key of GUN_MOVESETS) {
      expect(WEAPON_WEIGHTS, `${key}`).toContain(MOVESETS[key].weight);
    }
  });

  it("reviveWeight は未知の値を落とす", () => {
    expect(reviveWeight("heavy")).toBe("heavy");
    expect(() => reviveWeight("huge")).toThrow();
    expect(() => reviveWeight(undefined)).toThrow();
  });
});
