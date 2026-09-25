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
  MOVESET_KEYS,
  STEP2_NAMES,
  type MeleeStepDef,
  actionLane,
  branchHints,
  laneLength,
  laneStep,
  laneSwing,
  chargeButton,
  chargeLevelAt,
  isGun,
  matchBranch,
  meleeChargeOf,
  movesetRules,
  releaseBranchIndex,
  usesProjectiles,
  withExtraBranch,
} from "./weapons";
import { JOB_BRANCHES, JOB_BRANCH_SEQUENCE } from "./jobs";
import { bulletDef } from "../loot/bullets";

/** 剣以外の武器種の段数（ユーザーメモ: 3 段固定ではなく 4〜5 段）。剣は QA で調整済みの基準線として 3 段のまま */
const MIN_STEPS = 4;
const MAX_STEPS = 5;
/** 名前付き派生（構えを離した振りを除く）の本数と入力数（docs/ideas/ougi-and-dual-actions.md 4.3） */
const MIN_BRANCHES = 4;
const MIN_BRANCH_INPUTS = 3;
/** 銃の家系の右レーンの段数 */
const GUN_LANE_STEPS = 3;
/** 左右の同じ段番号の秒間威力（基礎値）の比の許容（右は重い・広い寄りなので目安から ±40%） */
const LANE_DPS_TOLERANCE = 0.4;
/**
 * 基礎値（各 5）での現行の威力（docs/COMBAT_DESIGN.md A-6。attributes.test.ts の固定値と同じ）。
 * 近接の段は復元時に WEAPON.meleeDamageScale が掛かるので、係数表の値に同じ倍率を掛けたもの
 */
const SWORD_PINNED = [7.8, 7.8, 15.6].map((v) => v * WEAPON.meleeDamageScale);
const DASH_PINNED = 11.2 * WEAPON.meleeDamageScale;

const atBase = (s: Parameters<typeof scaled>[1]): number => scaled(DEFAULT_STATS, s);

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
  it("すべての武器種が表示名・説明・語を持ち、剣と射撃専用以外は 4〜5 段ある", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      expect(def.key, key).toBe(key);
      expect(def.name.length, `${key} の表示名`).toBeGreaterThan(0);
      expect(def.desc.length, `${key} の説明`).toBeGreaterThan(0);
      expect(profileKeywords(def.keywords).length, `${key} が語を持つ`).toBeGreaterThan(0);
      if (key === "sword" || isGun(def)) continue;
      expect(def.steps.length, `${key} の段数`).toBeGreaterThanOrEqual(MIN_STEPS);
      expect(def.steps.length, `${key} の段数`).toBeLessThanOrEqual(MAX_STEPS);
    }
  });

  it("すべての武器種が名前付き派生を 4 本以上持ち、入力列・続きの段が妥当", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      const named = namedBranches(key);
      expect(named.length, `${key} の名前付き派生`).toBeGreaterThanOrEqual(MIN_BRANCHES);
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

  it("近接の武器種は steps2 が steps と同じ長さ、銃は 3 段", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      expect(def.steps2.length, `${key} の右レーンの段数`).toBe(isGun(def) ? GUN_LANE_STEPS : def.steps.length);
    }
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
      if (isGun(def)) continue;
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

  it("ボタンの役割: 近接の武器種は撃てず、右は固有技。銃の家系だけ左で撃つ", () => {
    expect(MOVESETS.sword.primary).toBe("melee");
    expect(MOVESETS.sword.steps2[0].kind, "剣の右は受け流し").toBe("hold");
    expect(isGun(MOVESETS.sword), "剣は撃てない").toBe(false);
    expect(isGun(MOVESETS.greatsword), "大剣は撃てない").toBe(false);
    expect(MOVESETS.wand.primary, "杖は左で打つ").toBe("melee");
    expect(MOVESETS.wand.steps2[0].kind, "杖の右は氷槍").toBe("volley");
    for (const key of GUN_MOVESETS) expect(isGun(MOVESETS[key]), `${key} は左で撃つ`).toBe(true);
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
      expect(step.mana, `${i + 1} 段目のマナ`).toBe(MANA.onMelee[i] ?? 0);
      expect(step.shape.kind, "剣は箱の判定").toBe("box");
    });
    expect(atBase(sword.dashAttack.scaling), "ダッシュ攻撃の威力").toBeCloseTo(DASH_PINNED);
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
      if (key === "sword" || isGun(def)) continue;
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

  it("ボタンの役割: 刀は右が居合、戦鎚は左が溜め、二丁拳銃は左だけで撃つ", () => {
    expect(chargeButton(MOVESETS.katana), "刀の溜めは右").toBe("secondary");
    expect(MOVESETS.katana.primary, "刀の連撃は左").toBe("melee");
    expect(chargeButton(MOVESETS.hammer), "戦鎚の溜めは左").toBe("primary");
    expect(chargeButton(MOVESETS.greatsword), "大剣の溜めは左のまま").toBe("primary");
    expect(chargeButton(MOVESETS.sword), "剣は溜めを持たない").toBeUndefined();
    expect(isGun(MOVESETS.gunner), "二丁拳銃は左で撃つ").toBe(true);
    expect(MOVESETS.gunner.primary, "二丁拳銃は近接の連撃ボタンを持たない").toBe("shot");
    expect(isGun(MOVESETS.sword), "剣は撃たない").toBe(false);
  });

  it("武器種の固有効果（rules）は持ち主の武器種ごとに id が分かれ、持たない武器種は空", () => {
    expect(movesetRules("sword"), "剣は固有効果を持たない").toEqual([]);
    const ids = new Set<string>();
    for (const key of NEW_MOVESETS) {
      const rules = movesetRules(key);
      expect(rules.length, `${key} は固有効果を持つ`).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.owner.key, `${key} の持ち主`).toBe(`moveset.${key}`);
        ids.add(r.id);
      }
    }
    const total = NEW_MOVESETS.reduce((n, k) => n + movesetRules(k).length, 0);
    expect(ids.size, "id は重ならない").toBe(total);
  });

  it("段の applies: 斧の最終段は出血、鎖鎌の分銅は崩勢を付ける", () => {
    const axeLast = MOVESETS.axe.steps[MOVESETS.axe.steps.length - 1];
    expect(axeLast?.applies?.map((a) => a.kind)).toEqual(["bleed"]);
    const first = MOVESETS.chainSickle.steps2[0];
    const weight = first.kind === "swing" ? first.step : undefined;
    expect(first.key, "鎖鎌の右 1 段目は分銅").toBe("chainWeight");
    expect(weight?.applies?.map((a) => a.kind)).toEqual(["broken"]);
    expect(weight?.pull, "分銅は引き寄せる").toBe(true);
  });

  it("弾: 三点は 3 発、回転刃は折り返す、曲射は炸裂の半径を持つ", () => {
    expect(bulletDef("burstRifle").burst?.count).toBe(3);
    expect(bulletDef("returnChakram").boomerang?.returnAt ?? 0).toBeGreaterThan(0);
    expect(bulletDef("returnChakram").boomerang?.returnAt ?? 1).toBeLessThan(1);
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
    gunner: "volley",
    sidearm: "aim",
    longarm: "swing",
    cannon: "swing",
    thrown: "recall",
    grenade: "swing",
    trapper: "volley",
    warRing: "swing",
    claws: "swing",
    flail: "charge",
    ringBlades: "volley",
    fan: "hold",
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

  it("銃の家系は 8 つで、弾を出す武器種の判定は銃と投げる技を持つ近接", () => {
    expect([...GUN_MOVESETS].sort()).toEqual(["cannon", "grenade", "gunner", "longarm", "sidearm", "thrown", "trapper", "warRing"]);
    for (const key of MOVESET_KEYS) expect(isGun(MOVESETS[key]), key).toBe(GUN_MOVESETS.includes(key));
    expect(usesProjectiles(MOVESETS.axe), "斧は投擲するので弾を出す").toBe(true);
    expect(usesProjectiles(MOVESETS.wand), "杖は魔法を撃つ").toBe(true);
    expect(usesProjectiles(MOVESETS.sword), "剣は弾を出さない").toBe(false);
    expect(usesProjectiles(MOVESETS.sidearm)).toBe(true);
  });

  it("振りの速さ: 剣の 1 段は旧双剣（0.19 秒）より少し遅い程度、重量武器は据え置き", () => {
    const total = (s: { windup: number; active: number; recover: number }): number => s.windup + s.active + s.recover;
    const sword1 = total(MOVESETS.sword.steps[0]!);
    expect(sword1, "剣 1 段").toBeCloseTo(0.215, 3);
    expect(sword1).toBeGreaterThan(total(MOVESETS.twinBlades.steps[0]!));
    expect(total(MOVESETS.greatsword.steps[0]!), "大剣は据え置き").toBeCloseTo(0.56, 3);
    expect(total(MOVESETS.hammer.steps[3]!), "戦鎚の最終段は据え置き").toBeCloseTo(0.86, 3);
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      for (const s of [...def.steps, def.dashAttack, ...def.branches.map((b) => b.step), ...rightSwings(key)]) {
        expect(s.windup, `${key} の windup は 2 ステップ以上`).toBeGreaterThanOrEqual(0.02);
      }
    }
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

  it("4 武器種が登録され、どれも近接で固有効果を持ち、器（ベース）が 2 つ以上ある", () => {
    for (const key of WAVE4) {
      expect(MOVESET_KEYS, key).toContain(key);
      expect(isGun(MOVESETS[key]), `${key} は近接`).toBe(false);
      expect(movesetRules(key).length, `${key} の固有効果`).toBeGreaterThan(0);
      const bases = BASES.filter((b) => b.moveset === key);
      expect(bases.length, `${key} の器`).toBeGreaterThanOrEqual(2);
      for (const b of bases) expect(b.slot, `${b.key} は右手`).toBe("mainHand");
    }
  });

  it("爪は左の全段が多段ヒットで、最終段と右の喉裂きが出血を付ける", () => {
    const claws = MOVESETS.claws;
    for (const s of claws.steps) expect(s.hits ?? 1, "爪の左の段は 2 回以上当たる").toBeGreaterThanOrEqual(2);
    expect(claws.steps[claws.steps.length - 1]?.applies?.map((a) => a.kind)).toEqual(["bleed"]);
    const last = claws.steps2[claws.steps2.length - 1];
    expect(last?.kind === "swing" ? last.step.applies?.map((a) => a.kind) : undefined, "喉裂き").toEqual(["bleed"]);
    const leap = claws.steps2.find((s) => s.key === "leapBack");
    expect(leap?.kind === "swing" ? (leap.extras?.selfKnock ?? 0) : 0, "跳び退きは自分を後ろへ押す").toBeGreaterThan(0);
  });

  it("チェーンアレイの右 1 段目は溜め（回し）で、溜め中の周期ヒットを持つ", () => {
    const flail = MOVESETS.flail;
    expect(flail.steps2[0].kind).toBe("charge");
    expect(chargeButton(flail), "溜めは右").toBe("secondary");
    expect(meleeChargeOf(flail)?.spinning?.interval ?? 0, "回しの周期").toBeGreaterThan(0);
  });

  it("チャクラムの右 1 段目は周回の弾、4 段目は戻る弾、派生の重ね輪は周回の弾をもう 1 枚出す", () => {
    const ring = MOVESETS.ringBlades;
    const first = ring.steps2[0];
    expect(first.kind === "volley" ? first.throw.bullet.orbit : undefined, "周回").toBeDefined();
    const launch = ring.steps2[3];
    expect(launch?.kind === "volley" ? launch.throw.bullet.boomerang : undefined, "投輪は戻る").toBeDefined();
    expect(ring.branches.find((b) => b.key === "stackedRings")?.shots?.from, "重ね輪は右レーンの弾").toBe("lane");
    expect(usesProjectiles(ring), "チャクラムは弾を出す").toBe(true);
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
