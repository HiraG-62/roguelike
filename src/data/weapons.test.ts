import { describe, expect, it } from "vitest";
import { profileKeywords } from "../core/keywords";
import { BASES } from "../loot/bases";
import { DEFAULT_STATS } from "../loot/types";
import { scaled } from "../system/attributes";
import { ACTION, MANA, PLAYER } from "./tuning";
import {
  type ButtonKey,
  type MovesetKey,
  GUN_MOVESETS,
  MOVESETS,
  MOVESET_KEYS,
  ART_NAMES,
  branchHints,
  chargeButton,
  chargeLevelAt,
  isGun,
  matchBranch,
  meleeButton,
  meleeChargeOf,
  movesetRules,
  releaseBranchIndex,
  shotButton,
  shotButtons,
  usesProjectiles,
  withExtraBranch,
} from "./weapons";
import { JOB_BRANCHES, JOB_BRANCH_SEQUENCE } from "./jobs";
import { bulletDef } from "../loot/bullets";

/** 剣以外の武器種の段数（ユーザーメモ: 3 段固定ではなく 4〜5 段）。剣は QA で調整済みの基準線として 3 段のまま */
const MIN_STEPS = 4;
const MAX_STEPS = 5;
/** 派生 + 固有技（strike は派生に混ざる。それ以外の技も 1 本と数える）の本数 */
const MIN_BRANCHES = 2;
const MAX_BRANCHES = 4;
/** 基礎値（各 5）での現行の威力（docs/COMBAT_DESIGN.md A-6。attributes.test.ts の固定値と同じ） */
const SWORD_PINNED = [7.8, 7.8, 15.6];
const DASH_PINNED = 11.2;

const atBase = (s: Parameters<typeof scaled>[1]): number => scaled(DEFAULT_STATS, s);

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

  it("すべての近接の武器種が「派生 + 固有技」で 2〜4 本を持ち、入力列・続きの段が妥当", () => {
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      if (isGun(def)) {
        expect(def.branches.every((b) => b.art !== undefined), `${key} は銃の家系なので技から作った派生だけ`).toBe(true);
        continue;
      }
      // strike の技は既に branches に入っている。それ以外（構え・投擲・居合）は技を 1 本と数える
      const total = def.branches.filter((b) => b.art !== "release").length + (def.art.kind === "strike" ? 0 : 1);
      expect(total, `${key} の派生 + 技`).toBeGreaterThanOrEqual(MIN_BRANCHES);
      expect(total, `${key} の派生 + 技`).toBeLessThanOrEqual(MAX_BRANCHES);
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

  it("ボタンの役割: 近接の武器種は撃てず、右は固有技。銃の家系だけ左で撃つ", () => {
    expect(MOVESETS.sword.primary).toBe("melee");
    expect(MOVESETS.sword.art.kind, "剣の右は受け流し").toBe("hold");
    expect(shotButton(MOVESETS.sword), "剣は撃てない").toBeUndefined();
    expect(shotButton(MOVESETS.greatsword), "大剣は撃てない").toBeUndefined();
    expect(meleeButton(MOVESETS.greatsword)).toBe("primary");
    expect(meleeButton(MOVESETS.wand), "杖は左で打つ").toBe("primary");
    expect(MOVESETS.wand.art.kind, "杖の右は魔弾").toBe("throw");
    for (const key of GUN_MOVESETS) expect(shotButton(MOVESETS[key]), `${key} は左で撃つ`).toBe("primary");
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
      // 短銃の狙い撃ちは右の溜めだが近接の溜めではない
      if (def.art.kind === "charge" && def.art.aim) continue;
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

  it("単一最強を作らない: 攻撃中の移動・リーチ・威力のどれかで剣より劣る", () => {
    const sword = MOVESETS.sword;
    const swordReach = Math.max(...sword.steps.map((s) => s.reach + s.size / 2));
    const swordDamage = sword.steps.reduce((sum, s) => sum + atBase(s.scaling), 0);
    for (const key of MOVESET_KEYS) {
      const def = MOVESETS[key];
      if (key === "sword" || isGun(def)) continue;
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

  it("右の後は左に踏み込み斬りが出る", () => {
    const hints = branchHints(MOVESETS.sword, ["secondary"]);
    expect(hints).toContainEqual({ button: "primary", name: "踏み込み斬り" });
  });

  it("一致する派生が無ければ空", () => {
    expect(branchHints(MOVESETS.sword, [])).toEqual([]);
    expect(branchHints(MOVESETS.sword, ["primary"])).toEqual([]);
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
    expect(meleeButton(MOVESETS.katana), "刀の連撃は左").toBe("primary");
    expect(chargeButton(MOVESETS.hammer), "戦鎚の溜めは左").toBe("primary");
    expect(chargeButton(MOVESETS.greatsword), "大剣の溜めは左のまま").toBe("primary");
    expect(chargeButton(MOVESETS.sword), "剣は溜めを持たない").toBeUndefined();
    expect(shotButtons(MOVESETS.gunner), "二丁拳銃は左で撃つ").toEqual(["primary"]);
    expect(meleeButton(MOVESETS.gunner), "二丁拳銃は近接の連撃ボタンを持たない").toBeUndefined();
    expect(isGun(MOVESETS.gunner)).toBe(true);
    expect(shotButtons(MOVESETS.sword), "剣は撃たない").toEqual([]);
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
    const weight = MOVESETS.chainSickle.branches.find((b) => b.key === "chainWeight");
    expect(weight?.step.applies?.map((a) => a.kind)).toEqual(["broken"]);
    expect(weight?.step.pull, "分銅は引き寄せる").toBe(true);
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

describe("右クリックの固有技（docs/ideas/weapon-redesign.md 3 章）", () => {
  const EXPECTED_ART: Readonly<Record<MovesetKey, string>> = {
    sword: "hold",
    greatsword: "strike",
    twinBlades: "strike",
    spear: "strike",
    scythe: "strike",
    fists: "strike",
    whip: "strike",
    cleaver: "strike",
    staff: "strike",
    wand: "throw",
    katana: "charge",
    axe: "throw",
    shield: "hold",
    chainSickle: "strike",
    hammer: "strike",
    gunner: "throw",
    sidearm: "charge",
    longarm: "strike",
    cannon: "strike",
    thrown: "recall",
    grenade: "strike",
    trapper: "throw",
    warRing: "strike",
  };

  it("すべての武器種が固有技を持ち、名前が登録済みで種類が設計どおり", () => {
    for (const key of MOVESET_KEYS) {
      const art = MOVESETS[key].art;
      expect(art.kind, `${key} の技の種類`).toBe(EXPECTED_ART[key]);
      expect(art.name, `${key} の技の名前`).toBe(ART_NAMES[art.key]);
      expect(art.desc.length, `${key} の技の説明`).toBeGreaterThan(0);
      expect(art.cooldown, `${key} の再使用`).toBeGreaterThanOrEqual(0);
    }
  });

  it("strike の技は右単独の派生として branches に混ざり、長い列の派生が先に一致する（左左右 → 兜割り）", () => {
    const gs = MOVESETS.greatsword;
    const at = (inputs: ButtonKey[]): string | undefined => {
      const i = matchBranch(gs, inputs);
      return i === undefined ? undefined : gs.branches[i]?.key;
    };
    expect(at(["secondary"]), "右だけなら薙ぎ払い").toBe("sweep");
    expect(gs.branches.find((b) => b.key === "sweep")?.art, "技から作った派生の印").toBe("strike");
    expect(at(["primary", "primary", "secondary"]), "左左右は兜割り").toBe("helmSplitter");
    const lengths = gs.branches.map((b) => b.sequence.length);
    expect([...lengths].sort((a, b) => b - a), "長い列が先").toEqual(lengths);
  });

  it("盾の構えを離した盾押しは派生に入るが、右を押した瞬間には照合しない", () => {
    const shield = MOVESETS.shield;
    const index = releaseBranchIndex(shield);
    expect(index, "盾押しの派生がある").toBeDefined();
    expect(shield.branches[index ?? -1]?.name).toBe("盾押し");
    expect(matchBranch(shield, ["secondary"]), "右の押下は構え（派生にしない）").toBeUndefined();
    expect(branchHints(shield, []).some((h) => h.name === "盾押し"), "案内にも出さない").toBe(false);
  });

  it("技に昇格させた右→左の派生は消え、追い打ちとして残す派生はそのまま（剣の踏み込み斬り・斧の回転斬り）", () => {
    expect(MOVESETS.spear.branches.some((b) => b.key === "divingThrust"), "槍の飛び込み突きは突進突きへ").toBe(false);
    expect(MOVESETS.fists.branches.some((b) => b.key === "steppingFist"), "拳の踏み込み拳は消す").toBe(false);
    expect(MOVESETS.sword.branches.find((b) => b.key === "steppingCut")?.sequence).toEqual(["secondary", "primary"]);
    expect(MOVESETS.axe.branches.find((b) => b.key === "axeSpin")?.sequence).toEqual(["secondary", "primary"]);
  });

  it("銃の家系は 8 つで、弾を出す武器種の判定は銃と投げる技を持つ近接", () => {
    expect([...GUN_MOVESETS].sort()).toEqual(["cannon", "grenade", "gunner", "longarm", "sidearm", "thrown", "trapper", "warRing"]);
    for (const key of MOVESET_KEYS) expect(isGun(MOVESETS[key]), key).toBe(GUN_MOVESETS.includes(key));
    expect(usesProjectiles(MOVESETS.axe), "斧は投擲するので弾を出す").toBe(true);
    expect(usesProjectiles(MOVESETS.wand), "杖は魔弾").toBe(true);
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
      for (const s of [...def.steps, def.dashAttack, ...def.branches.map((b) => b.step)]) {
        expect(s.windup, `${key} の windup は 2 ステップ以上`).toBeGreaterThanOrEqual(0.02);
      }
    }
  });
});
