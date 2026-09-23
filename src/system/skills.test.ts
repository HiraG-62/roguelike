import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import type { FrameInput } from "../core/input";
import { codesForAction, mouseButtonCode, skillKeyLabel } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { StatusEffect } from "../core/status";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { KEYSTONE, MANA } from "../data/tuning";
import { SKILL } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { createDefaultSkillProfile } from "../skills/persistence";
import type { ModifierKey, SkillKey, SkillStone, VariantRoll } from "../skills/types";
import { updatePlayer } from "./player";
import {
  attachRune,
  beamEnd,
  chargeRatio,
  createSkillRunState,
  dropRune,
  frenzyMul,
  resolveSlot,
  skillLocksAttack,
  skillLocksDash,
  skillMoveMul,
  trackDamageDealt,
  updateSkills,
} from "./skills";
import { curseMul, skillHit, skillPower } from "../skills/hit";
import { arena, placeEnemy, withInput } from "./testHelpers";

const BIG_HP = 1000;

interface Loadout {
  key: SkillKey;
  links?: number;
  variants?: VariantRoll[];
  modifiers?: ModifierKey[];
}

let stoneSeed = 1;

function makeStone(l: Loadout): SkillStone {
  stoneSeed += 1;
  return {
    ...stoneFromSeed(stoneSeed, { foundDepth: 1, now: 0, skillKey: l.key }),
    variants: l.variants ?? [],
    links: l.links ?? 0,
  };
}

/** 敵のいない開始部屋で、指定のスキルをスロット 1 / 2 に付けた状態 */
function skillArena(slots: Loadout[], seed = 5, keystones: string[] = []): GameState {
  const state = arena(seed, { keystones });
  const stones = slots.map(makeStone);
  state.skills = createSkillRunState({ version: 1, loadout: stones.map((s) => s.id), stones });
  slots.forEach((l, i) => {
    const slot = state.skills.slots[i];
    if (slot) slot.modifiers = [...(l.modifiers ?? [])];
  });
  // 初回同期（部屋クリア・階層の検出を基準化）とチャージ補充
  updateSkills(state, withInput({}), 0);
  return state;
}

function tough(state: GameState, dx: number, dy = 0): ReturnType<typeof placeEnemy> {
  const e = placeEnemy(state, "golem", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  return e;
}

/** ワールド座標 → 画面内部座標（screenToWorld の逆） */
function toScreen(state: GameState, world: Vec): Vec {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  return { x: world.x + ox, y: world.y + oy };
}

function run(state: GameState, seconds: number, input: FrameInput = withInput({})): void {
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) updatePlayer(state, input, FIXED_DT);
}

type SlotIndex = 0 | 1 | 2 | 3;

function press(state: GameState, slot: SlotIndex, extra: Partial<FrameInput> = {}): void {
  updatePlayer(
    state,
    withInput({
      skill1Pressed: slot === 0,
      skill2Pressed: slot === 1,
      skill3Pressed: slot === 2,
      skill4Pressed: slot === 3,
      ...extra,
    }),
    FIXED_DT,
  );
}

/** 共通最低間隔とスロットの最低間隔が明けるまで待つ（連続発動のテスト用） */
function waitInterval(state: GameState, slot: number): void {
  run(state, Math.max(SKILL.gcd, resolveSlot(state, slot)?.interval ?? 0) + FIXED_DT);
}

function manaCost(state: GameState, slot: number): number {
  return resolveSlot(state, slot)?.cost ?? 0;
}

/** 指定秒だけ押しっぱなしにしてから離す（Charge 刻印符のテスト用） */
function holdAndRelease(state: GameState, slot: 0 | 1, seconds: number, extra: Partial<FrameInput> = {}): void {
  const steps = Math.max(1, Math.round(seconds / FIXED_DT));
  for (let i = 0; i < steps; i++) {
    const held = slot === 0 ? { skill1Held: true, skill1Pressed: i === 0 } : { skill2Held: true, skill2Pressed: i === 0 };
    updatePlayer(state, withInput({ ...held, ...extra }), FIXED_DT);
  }
  const released = slot === 0 ? { skill1Held: false } : { skill2Held: false };
  updatePlayer(state, withInput({ ...released, ...extra }), FIXED_DT);
}

describe("入力", () => {
  it("Digit1 / KeyC / マウス戻るがスロット 1、Digit2 / KeyV / マウス進むがスロット 2", () => {
    expect(codesForAction("skill1")).toEqual(expect.arrayContaining(["Digit1", "KeyC", "Mouse3"]));
    expect(codesForAction("skill2")).toEqual(expect.arrayContaining(["Digit2", "KeyV", "Mouse4"]));
    expect(mouseButtonCode(3)).toBe("Mouse3");
    expect(mouseButtonCode(4)).toBe("Mouse4");
  });

  it("Digit3 / KeyX がスロット 3、Digit4 / KeyZ がスロット 4。キー表記は「1 / C」の形", () => {
    expect(codesForAction("skill3")).toEqual(["Digit3", "KeyX"]);
    expect(codesForAction("skill4")).toEqual(["Digit4", "KeyZ"]);
    expect([0, 1, 2, 3].map(skillKeyLabel)).toEqual(["1 / C", "2 / V", "3 / X", "4 / Z"]);
  });

  it("スロット 3 / 4 の入力でそのスロットのスキルが出る", () => {
    const state = skillArena([{ key: "whirl" }, { key: "whirl" }, { key: "mines" }, { key: "frag" }]);
    expect(state.skills.slots, "スロットは 4 つ").toHaveLength(SKILL.slots);
    press(state, 2);
    expect(state.skills.mines, "スロット 3 = 地雷").toHaveLength(1);
    waitInterval(state, 3);
    press(state, 3, aimAt(state, 60));
    expect(state.skills.grenades, "スロット 4 = グレネード").toHaveLength(1);
  });
});

describe("マナと最低間隔", () => {
  it("マナ型は発動でコストを払い、チャージと CD は使わない", () => {
    const state = skillArena([{ key: "frag" }]);
    const before = state.player.mana;
    press(state, 0, aimAt(state, 60));
    expect(state.skills.grenades).toHaveLength(1);
    expect(state.player.mana, "コスト分だけ減る").toBeCloseTo(before - SKILL.frag.cost);
    expect(state.skills.slots[0]?.chargesLeft, "チャージは減らない").toBe(1);
    expect(state.skills.slots[0]?.cooldownLeft, "CD は立たない").toBe(0);
  });

  it("マナ不足は不発: 何も消費しない（マナ・HP・コンボ・最低間隔）。点滅と効果音が出て、先行入力も残らない", () => {
    const state = skillArena([{ key: "frag", links: 2, modifiers: ["bloodPrice", "comboFuel"] }]);
    const p = state.player;
    p.mana = manaCost(state, 0) - 1;
    state.combo.count = 5;
    const mana = p.mana;
    const hp = p.hp;
    state.sfx.length = 0;
    press(state, 0, aimAt(state, 60));
    expect(state.skills.grenades, "発動しない").toHaveLength(0);
    expect(p.mana, "マナは減らない").toBe(mana);
    expect(p.hp, "血の代償の HP も払わない").toBe(hp);
    expect(state.combo.count, "コンボ燃料も消費しない").toBe(5);
    expect(state.skills.gcd, "共通最低間隔も立たない").toBe(0);
    expect(state.skills.slots[0]?.intervalLeft, "最低間隔も立たない").toBe(0);
    expect(state.skills.manaFlash, "マナバーの点滅").toBeGreaterThan(0);
    expect(state.sfx, "不発の効果音").toContain("manaEmpty");
    expect(state.skills.pendingSlot, "先行入力は破棄").toBe(-1);
    expect(state.texts.some((t) => t.text === "マナ不足")).toBe(true);
    run(state, SKILL.manaFlashTime + FIXED_DT);
    expect(state.skills.manaFlash, "点滅は時間で消える").toBe(0);
  });

  it("過負荷（ks_overdraw）ならマナ 0 でも不足分を HP で払って発動する。無ければ不発", () => {
    const state = skillArena([{ key: "frag" }], 5, ["ks_overdraw"]);
    const p = state.player;
    p.mana = 0;
    const hp = p.hp;
    press(state, 0, aimAt(state, 60));
    expect(state.skills.grenades, "発動する").toHaveLength(1);
    expect(p.mana).toBe(0);
    expect(p.hp, "不足分 × 0.5 の HP を払う").toBeCloseTo(hp - SKILL.frag.cost * KEYSTONE.overdrawHpPerMana);

    const plain = skillArena([{ key: "frag" }]);
    plain.player.mana = 0;
    press(plain, 0, aimAt(plain, 60));
    expect(plain.skills.grenades, "誓約なしは不発").toHaveLength(0);
    expect(plain.player.hp).toBe(plain.player.maxHp);
  });

  it("沈黙・怯み中のプレイヤーはスキルを撃てない（何も消費しない）", () => {
    for (const kind of ["silence", "stagger"] as const) {
      const state = skillArena([{ key: "frag" }]);
      const mana = state.player.mana;
      state.player.status.effects.push({ kind, stacks: 1, time: 1, maxTime: 1, potency: 0, source: "enemy", acc: 0, tick: 0 });
      press(state, 0, aimAt(state, 60));
      expect(state.skills.grenades, `${kind} 中に発動した`).toHaveLength(0);
      expect(state.player.mana, `${kind} 中にマナが減った`).toBe(mana);
    }
  });

  it("CD 型はマナを使わない（マナ 0 でも撃てる）", () => {
    const state = skillArena([{ key: "haste" }]);
    state.player.mana = 0;
    press(state, 0);
    expect(state.skills.haste.time).toBeGreaterThan(0);
    expect(state.player.mana).toBe(0);
    expect(state.skills.slots[0]?.chargesLeft).toBe(0);
  });

  it("共通最低間隔 0.15 秒の間は別スロットも発動せず、明けたら先行入力で出る", () => {
    const state = skillArena([{ key: "frag" }, { key: "mines" }]);
    press(state, 0, aimAt(state, 60));
    expect(state.skills.gcd).toBeCloseTo(SKILL.gcd);
    press(state, 1);
    const steps = Math.floor(SKILL.gcd / FIXED_DT) - 2;
    for (let i = 0; i < steps; i++) {
      expect(state.skills.mines, `GCD 中の ${i} フレーム目に発動した`).toHaveLength(0);
      updatePlayer(state, withInput({}), FIXED_DT);
    }
    run(state, SKILL.gcd);
    expect(state.skills.mines, "GCD 明けに先行入力で発動").toHaveLength(1);
  });

  it("スキル固有の最低間隔: 同じスロットは間隔が明けるまで撃てない", () => {
    const state = skillArena([{ key: "frag" }]);
    const full = state.player.mana;
    press(state, 0, aimAt(state, 60));
    expect(state.skills.slots[0]?.intervalLeft).toBeCloseTo(SKILL.frag.minInterval);
    run(state, SKILL.gcd + FIXED_DT * 2);
    press(state, 0, aimAt(state, 60));
    run(state, SKILL.inputBuffer + FIXED_DT);
    expect(state.player.mana, "間隔の中では 1 回ぶんしか払っていない（先行入力も切れる）").toBeCloseTo(full - SKILL.frag.cost);
    run(state, SKILL.frag.minInterval);
    press(state, 0, aimAt(state, 60));
    expect(state.player.mana, "間隔が明ければ撃てる").toBeCloseTo(full - SKILL.frag.cost * 2);
  });

  it("先行入力中にマナが足りればそのまま発動する", () => {
    const state = skillArena([{ key: "frag" }, { key: "mines" }]);
    press(state, 0, aimAt(state, 60));
    state.player.mana = 0;
    press(state, 1);
    expect(state.skills.pendingSlot, "GCD 中なので先行入力").toBe(1);
    state.player.mana = SKILL.mines.cost;
    run(state, SKILL.gcd);
    expect(state.skills.mines).toHaveLength(1);
    expect(state.player.mana).toBeCloseTo(0);
  });

  it("威力はステータスの係数で伸び、基礎値では旧来の固定値", () => {
    const state = skillArena([{ key: "frag" }]);
    const params = resolveSlot(state, 0)?.params;
    if (!params) throw new Error("params");
    expect(skillPower(state, SKILL.frag.damage, params)).toBeCloseTo(26);
    state.stats = { ...state.stats, attributesEff: { ...state.stats.attributesEff, dex: 15 } };
    expect(skillPower(state, SKILL.frag.damage, params), "技巧 +10 で 1.4 × 10 伸びる").toBeCloseTo(40);
  });
});

describe("旋風斬り", () => {
  it("周囲の敵を多段で斬り、範囲外には当たらない", () => {
    const state = skillArena([{ key: "whirl" }]);
    const near = tough(state, 16);
    const far = tough(state, 0, 60);
    press(state, 0);
    run(state, SKILL.whirl.duration + SKILL.whirl.recover + FIXED_DT * 2);
    expect(near.hp).toBeLessThan(BIG_HP);
    expect(state.combo.best).toBeGreaterThanOrEqual(SKILL.whirl.hits);
    expect(far.hp).toBe(BIG_HP);
    expect(state.skills.active).toBeNull();
  });

  it("ダッシュでキャンセルでき、マナは消費済み", () => {
    const state = skillArena([{ key: "whirl" }]);
    const before = state.player.mana;
    press(state, 0);
    expect(state.skills.active?.skillKey).toBe("whirl");
    updatePlayer(state, withInput({ dashPressed: true }), FIXED_DT);
    expect(state.skills.active).toBeNull();
    expect(state.player.mana).toBeCloseTo(before - SKILL.whirl.cost);
  });

  it("ks_pacifist でもスキルの近接は使える（キーストーンはアクションスロットだけ）", () => {
    const state = skillArena([{ key: "whirl" }], 5, ["ks_pacifist"]);
    const e = tough(state, 16);
    press(state, 0);
    run(state, SKILL.whirl.duration);
    expect(e.hp).toBeLessThan(BIG_HP);
  });
});

describe("突進斬り", () => {
  it("照準方向へ移動し、経路上の敵をスタガーさせる。直後の近接は 2 段目から", () => {
    const state = skillArena([{ key: "lunge" }]);
    const e = tough(state, 30);
    const startX = state.player.body.pos.x;
    press(state, 0);
    run(state, SKILL.lunge.time + FIXED_DT);
    expect(state.player.body.pos.x).toBeGreaterThan(startX + 10);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(e.poise.damage, "経路上の敵に怯み値が溜まる").toBeGreaterThan(0);
    updatePlayer(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.combo).toBe(1);
  });
});

describe("グレネード", () => {
  it("導火線の後に爆発し、円内の敵に当たる。離れていれば自分は無傷", () => {
    const state = skillArena([{ key: "frag" }]);
    const target = { x: state.player.body.pos.x + 50, y: state.player.body.pos.y };
    const e = tough(state, 50);
    const hp = state.player.hp;
    press(state, 0, { aimScreen: toScreen(state, target) });
    run(state, SKILL.frag.flight + SKILL.frag.fuse / 2);
    expect(e.hp).toBe(BIG_HP);
    run(state, SKILL.frag.fuse);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(state.player.hp).toBe(hp);
  });

  it("円内の非無敵プレイヤーは最大 HP の 10% を受け、無敵中は無効", () => {
    const state = skillArena([{ key: "frag", modifiers: [] }]);
    const p = state.player;
    const target = { x: p.body.pos.x + 5, y: p.body.pos.y };
    press(state, 0, { aimScreen: toScreen(state, target) });
    run(state, SKILL.frag.flight + SKILL.frag.fuse + FIXED_DT);
    expect(p.hp).toBe(p.maxHp - Math.round(p.maxHp * SKILL.frag.selfDamageFraction));

    const safe = skillArena([{ key: "frag" }]);
    const sp = safe.player;
    press(safe, 0, { aimScreen: toScreen(safe, { x: sp.body.pos.x + 5, y: sp.body.pos.y }) });
    sp.buffs.invuln = 5;
    run(safe, SKILL.frag.flight + SKILL.frag.fuse + FIXED_DT);
    expect(sp.hp).toBe(sp.maxHp);
  });
});

describe("撃ち抜き", () => {
  it("照準の後に貫通光線。線上の敵は全員、壁の向こうは当たらない", () => {
    const state = skillArena([{ key: "railshot" }], 5, ["ks_bladeOath"]);
    const p = state.player;
    const end = beamEnd(state, p.body.pos, { x: 1, y: 0 });
    const reach = end.x - p.body.pos.x;
    const a = tough(state, 20);
    const b = tough(state, Math.max(30, reach - 10));
    const behind = tough(state, reach + 30);
    press(state, 0);
    run(state, SKILL.railshot.aim / 2);
    expect(a.hp).toBe(BIG_HP);
    run(state, SKILL.railshot.aim);
    expect(a.hp).toBeLessThan(BIG_HP);
    expect(b.hp).toBeLessThan(BIG_HP);
    expect(behind.hp).toBe(BIG_HP);
  });

  it("照準中のダッシュキャンセルで払ったマナを半分返す", () => {
    const state = skillArena([{ key: "railshot" }]);
    const before = state.player.mana;
    press(state, 0);
    expect(state.player.mana).toBeCloseTo(before - SKILL.railshot.cost);
    updatePlayer(state, withInput({ dashPressed: true }), FIXED_DT);
    expect(state.skills.active).toBeNull();
    expect(state.player.mana).toBeCloseTo(before - SKILL.railshot.cost * (1 - SKILL.railshot.cancelRefund));
  });
});

describe("パリィ", () => {
  it("構え中の敵弾を無効化して JUST 扱い、CD が半分戻る", () => {
    const state = skillArena([{ key: "parry" }]);
    const p = state.player;
    press(state, 0);
    state.projectiles.push({
      id: 999,
      owner: "enemy",
      pos: { x: p.body.pos.x + 3, y: p.body.pos.y },
      vel: { x: -100, y: 0 },
      radius: 3,
      damage: 10,
      life: 1,
      color: "#fff",
      kind: "proc",
      hitIds: new Set(),
      pierceLeft: 0,
    });
    updatePlayer(state, withInput({}), FIXED_DT);
    expect(p.hp).toBe(p.maxHp);
    // JUST と同じご褒美（ゲージ・コンボ）
    expect(p.energy).toBeGreaterThan(0);
    expect(state.combo.count).toBeGreaterThan(0);
    expect(state.projectiles[0]?.life).toBe(0);
    const cd = resolveSlot(state, 0)?.cooldown ?? 0;
    expect(cd).toBeCloseTo(SKILL.parry.cooldown);
    expect(state.skills.slots[0]?.cooldownLeft, "成功で CD の 50% を戻す").toBeCloseTo(cd * (1 - SKILL.parry.successRefund) - FIXED_DT, 5);
    expect(state.texts.some((t) => t.text === "パリィ！")).toBe(true);
  });

  it("空振りすると行動不能（ダッシュも不可）", () => {
    const state = skillArena([{ key: "parry" }]);
    press(state, 0);
    run(state, SKILL.parry.window + FIXED_DT);
    expect(state.skills.parryFailTimer).toBeGreaterThan(0);
    expect(skillLocksDash(state)).toBe(true);
    const x = state.player.body.pos.x;
    updatePlayer(state, withInput({ dashPressed: true, move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.player.dashTimer).toBe(0);
    expect(state.player.body.pos.x).toBe(x);
  });
});

describe("血の契約", () => {
  it("最大 HP の 12% を払い、攻撃速度と吸収が付く", () => {
    const state = skillArena([{ key: "bloodPact" }]);
    const p = state.player;
    press(state, 0);
    expect(p.hp).toBeCloseTo(p.maxHp * (1 - SKILL.bloodPact.hpFraction));
    expect(frenzyMul(state)).toBeCloseTo(SKILL.bloodPact.speedMul);
    const e = tough(state, 60);
    trackDamageDealt(state);
    const hp = p.hp;
    e.hp -= 100;
    trackDamageDealt(state);
    expect(p.hp).toBeCloseTo(hp + 100 * SKILL.bloodPact.lifesteal);
  });

  it("HP コストで 1 未満にならない（血の代償付き）", () => {
    const state = skillArena([{ key: "bloodPact", links: 1, modifiers: ["bloodPrice"] }]);
    state.player.hp = 1;
    press(state, 0);
    expect(state.player.hp).toBe(1);
  });
});

describe("チャージと CD（CD 型）", () => {
  it("CD 中は発動できず（冷却中）、CD 経過で回復する", () => {
    const state = skillArena([{ key: "haste" }]);
    press(state, 0);
    expect(state.skills.slots[0]?.chargesLeft).toBe(0);
    waitInterval(state, 0);
    state.skills.haste.time = 0;
    press(state, 0);
    expect(state.skills.haste.time, "冷却中は発動しない").toBe(0);
    const cd = resolveSlot(state, 0)?.cooldown ?? 0;
    expect(cd).toBeCloseTo(SKILL.haste.cooldown);
    run(state, cd);
    expect(state.skills.slots[0]?.chargesLeft).toBe(1);
  });

  it("多重付きで 3 回連続発動でき、4 回目は失敗。CD 経過で 1 回ずつ回復", () => {
    const state = skillArena([{ key: "haste", links: 1, modifiers: ["multiCharge"] }]);
    // 途中で付いた多重は 1 回ぶん即時、残りは CD で溜まる
    run(state, (resolveSlot(state, 0)?.cooldown ?? 0) * 2 + FIXED_DT);
    expect(state.skills.slots[0]?.chargesLeft).toBe(3);
    for (let i = 0; i < 4; i++) {
      press(state, 0);
      waitInterval(state, 0);
    }
    expect(state.skills.slots[0]?.chargesLeft).toBe(0);
    const cd = resolveSlot(state, 0)?.cooldown ?? 0;
    run(state, cd);
    expect(state.skills.slots[0]?.chargesLeft).toBe(1);
  });

  it("リンクが多い石ほど負担が重い（マナ型はコスト）", () => {
    const state = skillArena([{ key: "whirl", links: 0 }, { key: "whirl", links: 3 }]);
    const a = manaCost(state, 0);
    const b = manaCost(state, 1);
    expect(a).toBeCloseTo(SKILL.whirl.cost);
    expect(b).toBeCloseTo(a * (1 + SKILL.linkBurdenPenalty * 3));
  });
});

describe("修飾子", () => {
  it("コンボ燃料: コンボ 10 で威力 x1.4、発動後コンボ 0。コンボ 0 なら x0.8", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["comboFuel"] }]);
    state.combo.count = 10;
    press(state, 0);
    expect(state.skills.grenades[0]?.params.damageMul).toBeCloseTo(1.4);
    expect(state.combo.count).toBe(0);

    const empty = skillArena([{ key: "frag", links: 1, modifiers: ["comboFuel"] }]);
    press(empty, 0);
    expect(empty.skills.grenades[0]?.params.damageMul).toBeCloseTo(SKILL.modifier.comboFuel.emptyMul);
  });

  it("反響: 0.8 秒後に 50% で再発動し、反響の反響は起きない", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["echo"] }]);
    press(state, 0);
    expect(state.skills.echoes).toHaveLength(1);
    run(state, SKILL.modifier.echo.delay);
    const echoed = state.skills.grenades.find((g) => g.params.echo === null);
    expect(echoed?.params.damageMul).toBeCloseTo(SKILL.modifier.echo.damageMul);
    expect(state.skills.echoes).toHaveLength(0);
    run(state, SKILL.modifier.echo.delay * 2);
    expect(state.skills.echoes).toHaveLength(0);
  });

  it("旋風斬りの反響は発動地点に残像が回る", () => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: ["echo"] }]);
    press(state, 0);
    run(state, SKILL.modifier.echo.delay);
    expect(state.skills.ghosts.some((g) => g.skillKey === "whirl")).toBe(true);
  });
});

describe("刻印符", () => {
  it("空きのあるリンク枠に自動で刺さり、満杯なら最古を押し出す", () => {
    const state = skillArena([{ key: "whirl", links: 1 }, { key: "frag", links: 2 }]);
    const mods = (i: number): ModifierKey[] => state.skills.slots[i]?.modifiers ?? [];
    expect(attachRune(state, "multiCharge")).toBe(0);
    expect(attachRune(state, "bloodPrice")).toBe(1);
    expect(attachRune(state, "comboFuel")).toBe(1);
    expect(mods(0)).toEqual(["multiCharge"]);
    expect(mods(1)).toEqual(["bloodPrice", "comboFuel"]);
    // 空きなし: 最初の候補（スロット 1 = index 0）の最古を押し出す
    expect(attachRune(state, "echo")).toBe(0);
    expect(mods(0)).toEqual(["echo"]);
  });

  it("付けられる枠が無ければ床に残る。触れると装着されて消える", () => {
    const state = skillArena([{ key: "parry", links: 0 }, { key: "whirl", links: 1 }]);
    const p = state.player.body.pos;
    dropRune(state, p, "echo");
    run(state, SKILL.drop.pickupDelay + FIXED_DT);
    expect(state.skills.runes).toHaveLength(0);
    expect(state.skills.slots[1]?.modifiers).toEqual(["echo"]);

    const none = skillArena([{ key: "parry", links: 2 }]);
    dropRune(none, none.player.body.pos, "echo");
    run(none, SKILL.drop.pickupDelay + FIXED_DT);
    expect(none.skills.runes).toHaveLength(1);
  });
});

describe("ドロップ", () => {
  it("部屋クリアで刻印符、階層到達でスキル石が落ちる（確率を 1 にして確認）", () => {
    const state = skillArena([{ key: "whirl", links: 1 }]);
    state.rng = { ...state.rng, chance: () => true };
    const room = state.rooms.find((r) => !r.cleared);
    if (!room) throw new Error("no room");
    room.cleared = true;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.runes).toHaveLength(1);

    state.depth += 1;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.runes).toHaveLength(0);
    expect(state.skills.floorStones).toHaveLength(1);
    const before = state.skills.profile.stones.length;
    const fs = state.skills.floorStones[0];
    if (!fs) throw new Error("no stone");
    fs.pos = { ...state.player.body.pos };
    run(state, SKILL.drop.pickupDelay + FIXED_DT);
    expect(state.skills.profile.stones.length).toBe(before + 1);
    expect(state.skills.floorStones).toHaveLength(0);
  });
});

describe("決定性", () => {
  it("同 seed + スキル入力を含む同じ入力列なら同じ結果", () => {
    const play = (): string => {
      const state = createGame(11, "11", undefined, createDefaultSkillProfile());
      for (let i = 0; i < 600; i++) {
        const input = withInput({
          move: { x: i % 120 < 60 ? 1 : -1, y: 0 },
          skill1Pressed: i % 90 === 0,
          skill2Pressed: i % 150 === 5,
          attackPressed: i % 7 === 0,
          aimScreen: { x: VIEW_W / 2 + 40, y: VIEW_H / 2 },
        });
        step(state, input, FIXED_DT);
      }
      const p = state.player;
      return [p.body.pos.x.toFixed(3), p.body.pos.y.toFixed(3), p.hp, state.score, state.skills.grenades.length, state.nextId].join("|");
    };
    expect(play()).toBe(play());
  });
});

// ---------------------------------------------------------------------------
// 追加スキル（8 種）
// ---------------------------------------------------------------------------

function aimAt(state: GameState, dx: number, dy = 0): Partial<FrameInput> {
  const p = state.player.body.pos;
  return { aimScreen: toScreen(state, { x: p.x + dx, y: p.y + dy }) };
}

/** 統一状態異常（docs/COMBAT_DESIGN.md E）の冷気 */
function chillOf(e: Enemy): StatusEffect | undefined {
  return e.status.effects.find((s) => s.kind === "chill");
}

function distTo(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("地裂き", () => {
  it("溜めの後に前方扇へ衝撃波。前の敵はスタガー、背後は無傷", () => {
    const state = skillArena([{ key: "quake" }]);
    const front = tough(state, 30);
    const back = tough(state, -30);
    press(state, 0);
    run(state, SKILL.quake.windup / 2);
    expect(front.hp).toBe(BIG_HP);
    run(state, SKILL.quake.windup);
    expect(front.hp).toBeLessThan(BIG_HP);
    expect(front.poise.damage, "前の敵に怯み値が溜まる").toBeGreaterThan(0);
    expect(back.hp).toBe(BIG_HP);
    run(state, SKILL.quake.recover + FIXED_DT);
    expect(state.skills.active).toBeNull();
  });

  it("溜め中に被弾すると中断し、マナは消費済み", () => {
    const state = skillArena([{ key: "quake" }]);
    const e = tough(state, 30);
    const before = state.player.mana;
    press(state, 0);
    state.player.hp -= 5;
    run(state, SKILL.quake.windup * 2);
    expect(e.hp).toBe(BIG_HP);
    expect(state.player.mana).toBeCloseTo(before - SKILL.quake.cost);
  });

  it("範囲の変異で届く距離が伸びる", () => {
    const state = skillArena([{ key: "quake", variants: [{ axis: "areaVsDamage", value: 1 }] }]);
    const e = tough(state, SKILL.quake.radius + 10);
    press(state, 0);
    run(state, SKILL.quake.windup + FIXED_DT * 2);
    expect(e.hp).toBeLessThan(BIG_HP);
  });
});

describe("雷撃", () => {
  it("照準地点に遅れて落ち、中心の敵に当たる", () => {
    const state = skillArena([{ key: "thunder" }]);
    const e = tough(state, 60);
    press(state, 0, aimAt(state, 60));
    expect(state.skills.strikes).toHaveLength(1);
    run(state, SKILL.thunder.delay / 2);
    expect(e.hp).toBe(BIG_HP);
    run(state, SKILL.thunder.delay);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(state.skills.strikes).toHaveLength(0);
  });

  it("回数の変異で落雷が増え、速度の変異で早く落ちる", () => {
    const more = skillArena([{ key: "thunder", variants: [{ axis: "countVsDamage", value: 1 }] }]);
    press(more, 0, aimAt(more, 50));
    expect(more.skills.strikes).toHaveLength(3);

    const fast = skillArena([{ key: "thunder", variants: [{ axis: "speedVsDamage", value: 1 }] }]);
    press(fast, 0, aimAt(fast, 50));
    expect(fast.skills.strikes[0]?.total ?? 0).toBeLessThan(SKILL.thunder.delay);
  });
});

describe("引力球", () => {
  it("範囲の敵を中心へ引き寄せ、終わりに弾けてダメージ", () => {
    const state = skillArena([{ key: "gravityWell" }]);
    const e = tough(state, 40, 30);
    press(state, 0, aimAt(state, 40));
    const center = state.skills.wells[0]?.pos;
    if (!center) throw new Error("no well");
    const before = distTo(e.body.pos, center);
    run(state, SKILL.gravityWell.duration / 2);
    expect(distTo(e.body.pos, center)).toBeLessThan(before);
    run(state, SKILL.gravityWell.duration);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(state.skills.wells).toHaveLength(0);
  });

  it("持続の変異: 長く続くが引きが弱い", () => {
    const state = skillArena([{ key: "gravityWell", variants: [{ axis: "durationVsPotency", value: 1 }] }]);
    press(state, 0, aimAt(state, 40));
    const w = state.skills.wells[0];
    expect(w?.total).toBeGreaterThan(SKILL.gravityWell.duration);
    expect(w?.params.potencyMul).toBeLessThan(1);
  });
});

describe("地雷", () => {
  it("起動前は踏んでも爆発せず、起動後に踏まれると爆発する", () => {
    const state = skillArena([{ key: "mines" }]);
    press(state, 0);
    const mine = state.skills.mines[0];
    if (!mine) throw new Error("no mine");
    const e = tough(state, 50);
    e.body.pos = { ...mine.pos };
    updatePlayer(state, withInput({}), FIXED_DT);
    expect(e.hp).toBe(BIG_HP);
    run(state, SKILL.mines.arm);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(state.skills.mines).toHaveLength(0);
  });

  it("同時設置は 3 個まで（古いものから消える）。回数の変異で上限が増える", () => {
    const state = skillArena([{ key: "mines" }]);
    for (let i = 0; i < 4; i++) {
      press(state, 0);
      waitInterval(state, 0);
    }
    expect(state.skills.mines).toHaveLength(SKILL.mines.maxAlive);

    const more = skillArena([{ key: "mines", variants: [{ axis: "countVsDamage", value: 1 }] }]);
    for (let i = 0; i < 6; i++) {
      press(more, 0);
      waitInterval(more, 0);
    }
    expect(more.skills.mines).toHaveLength(SKILL.mines.maxAlive + 2);
  });
});

describe("加速", () => {
  it("効果中はダッシュが減らず移動が速い。切れるとしばらくダッシュ不可", () => {
    const state = skillArena([{ key: "haste" }]);
    press(state, 0);
    expect(skillMoveMul(state)).toBeCloseTo(1 + SKILL.haste.moveBonus);
    state.player.dashChargesLeft = 0;
    updatePlayer(state, withInput({}), FIXED_DT);
    expect(state.player.dashChargesLeft).toBe(state.stats.dashCharges);
    run(state, SKILL.haste.duration);
    expect(state.skills.exhaustTimer).toBeGreaterThan(0);
    expect(skillLocksDash(state)).toBe(true);
    run(state, SKILL.haste.exhaust + FIXED_DT);
    expect(skillLocksDash(state)).toBe(false);
  });

  it("CD の変異: CD が短いほど移動ボーナスが小さい", () => {
    const state = skillArena([{ key: "haste", variants: [{ axis: "cooldownVsPotency", value: 1 }] }]);
    expect(resolveSlot(state, 0)?.cooldown).toBeLessThan(SKILL.haste.cooldown);
    press(state, 0);
    expect(skillMoveMul(state)).toBeLessThan(1 + SKILL.haste.moveBonus);
  });
});

describe("鎖鎌", () => {
  it("最初の敵を手元へ引き寄せてスタガー。射程外には届かない", () => {
    const state = skillArena([{ key: "chainHook" }]);
    const e = tough(state, 70);
    press(state, 0);
    run(state, SKILL.chainHook.extendTime + FIXED_DT);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(e.poise.damage, "引き寄せた敵に怯み値が溜まる").toBeGreaterThan(0);
    expect(distTo(e.body.pos, state.player.body.pos)).toBeLessThan(30);

    const far = skillArena([{ key: "chainHook", variants: [{ axis: "areaVsDamage", value: -1 }] }]);
    // 射程 x0.6 = 66px。golem の半径ぶんを足しても届かない距離
    const out = tough(far, SKILL.chainHook.range * 0.6 + 25);
    press(far, 0);
    run(far, SKILL.chainHook.extendTime + FIXED_DT);
    expect(out.hp).toBe(BIG_HP);
  });

  it("貫通の刻印符で後ろの敵も引き寄せる", () => {
    const state = skillArena([{ key: "chainHook", links: 1, modifiers: ["pierce"] }]);
    const a = tough(state, 40);
    const b = tough(state, 70);
    press(state, 0);
    run(state, SKILL.chainHook.extendTime + FIXED_DT);
    expect(a.hp).toBeLessThan(BIG_HP);
    expect(b.hp).toBeLessThan(BIG_HP);

    const plain = skillArena([{ key: "chainHook" }]);
    const c = tough(plain, 40);
    const d = tough(plain, 70);
    press(plain, 0);
    run(plain, SKILL.chainHook.extendTime + FIXED_DT);
    expect(c.hp).toBeLessThan(BIG_HP);
    expect(d.hp).toBe(BIG_HP);
  });
});

describe("回転弾幕", () => {
  it("螺旋状に弾を出して周囲の敵に当てる。発射中は移動 40%・近接不可", () => {
    const state = skillArena([{ key: "spiral" }]);
    const e = tough(state, 30);
    press(state, 0);
    expect(skillMoveMul(state)).toBeCloseTo(SKILL.spiral.moveMul);
    expect(skillLocksAttack(state)).toBe(true);
    run(state, SKILL.spiral.duration + SKILL.spiral.life);
    expect(state.skills.active).toBeNull();
    expect(e.hp).toBeLessThan(BIG_HP);
  });

  it("回数の変異で弾数が増える", () => {
    const count = (variants: VariantRoll[]): number => {
      const state = skillArena([{ key: "spiral", variants }]);
      press(state, 0);
      let emitted = 0;
      while (state.skills.active) {
        emitted = state.skills.active.hitsDone;
        updatePlayer(state, withInput({}), FIXED_DT);
      }
      return emitted;
    };
    expect(count([])).toBeLessThan(count([{ axis: "countVsDamage", value: 1 }]));
  });

  it("貫通の刻印符で弾が敵を抜ける", () => {
    const state = skillArena([{ key: "spiral", links: 1, modifiers: ["pierce"] }]);
    press(state, 0);
    expect(state.skills.bullets[0]?.pierceLeft).toBe(SKILL.modifier.pierce.count);
  });
});

describe("氷結地帯", () => {
  it("中の敵に chill と継続ダメージ。自分が中にいると遅くなる", () => {
    const state = skillArena([{ key: "frostField" }]);
    const e = tough(state, 50);
    press(state, 0, aimAt(state, 50));
    run(state, SKILL.frostField.tickEvery);
    expect(chillOf(e)?.time ?? 0, "冷気が付く").toBeGreaterThan(0);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(skillMoveMul(state)).toBe(1);

    const self = skillArena([{ key: "frostField" }]);
    press(self, 0, aimAt(self, 1));
    expect(skillMoveMul(self)).toBeCloseTo(SKILL.frostField.selfMoveMul);
  });

  it("持続の変異で長く、効果量（減速）は弱く", () => {
    const state = skillArena([{ key: "frostField", variants: [{ axis: "durationVsPotency", value: 1 }] }]);
    const e = tough(state, 50);
    press(state, 0, aimAt(state, 50));
    expect(state.skills.fields[0]?.total).toBeGreaterThan(SKILL.frostField.duration);
    run(state, FIXED_DT);
    expect(chillOf(e)?.potency ?? Infinity, "遅さの下限（potency）が弱い").toBeLessThan(SKILL.frostField.slow);
  });
});

// ---------------------------------------------------------------------------
// 追加の刻印符
// ---------------------------------------------------------------------------

describe("追加の刻印符", () => {
  it("反動: 発動時に照準の逆へ跳び、短い無敵", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["recoil"] }]);
    const x = state.player.body.pos.x;
    press(state, 0, aimAt(state, 60));
    expect(state.player.invulnTimer).toBeGreaterThan(0);
    run(state, 0.1);
    expect(state.player.body.pos.x).toBeLessThan(x);
  });

  it("連鎖（CD 型）: スキルで倒すとチャージが戻る", () => {
    const state = skillArena([{ key: "lunge", links: 1, modifiers: ["chainReset"] }]);
    const e = placeEnemy(state, "golem", 20);
    e.hp = 1;
    e.phase = "idle";
    press(state, 0);
    run(state, SKILL.lunge.time + FIXED_DT);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(state.skills.slots[0]?.chargesLeft).toBe(1);

    const plain = skillArena([{ key: "lunge" }]);
    const f = placeEnemy(plain, "golem", 20);
    f.hp = 1;
    f.phase = "idle";
    press(plain, 0);
    run(plain, SKILL.lunge.time + FIXED_DT);
    expect(plain.skills.slots[0]?.chargesLeft).toBe(0);
  });

  it("連鎖（マナ型）: スキルで倒すと払ったコストの 50% が戻る。倒さなければ戻らない", () => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: ["chainReset"] }]);
    const cost = manaCost(state, 0);
    expect(cost, "連鎖の負担 ×1.2").toBeCloseTo(SKILL.whirl.cost * (1 + SKILL.linkBurdenPenalty) * SKILL.modifier.chainReset.manaBurdenMul);
    const gained = (s: GameState): number => {
      const e = placeEnemy(s, "golem", 16);
      e.hp = 1;
      e.phase = "idle";
      const before = s.player.mana;
      const paid = manaCost(s, 0);
      press(s, 0);
      expect(e.hp).toBeLessThanOrEqual(0);
      return s.player.mana - (before - paid);
    };
    // 撃破そのもので増える分（MANA.onKill）は連鎖と無関係なので、連鎖なしの同条件と差を取る
    const control = gained(skillArena([{ key: "whirl", links: 1 }]));
    expect(gained(state) - control, "コストの 50% が戻る").toBeCloseTo(cost * SKILL.modifier.chainReset.manaRefund);

    const miss = skillArena([{ key: "whirl", links: 1, modifiers: ["chainReset"] }]);
    const m0 = miss.player.mana;
    press(miss, 0);
    run(miss, SKILL.whirl.duration);
    expect(miss.player.mana, "撃破が無ければ返らない").toBeCloseTo(m0 - manaCost(miss, 0));
  });

  it("連鎖（マナ型）: 1 回の発動で何体倒しても、戻るのは払ったマナまで", () => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: ["chainReset"] }]);
    // 撃破 1 体ぶんの返却はコストの 50%。4 体倒しても合計は払った額（100%）で止まる
    for (const [dx, dy] of [[14, 0], [-14, 0], [0, 14], [0, -14]] as const) {
      const e = placeEnemy(state, "golem", dx, dy);
      e.hp = 1;
      e.phase = "idle";
    }
    state.player.mana = state.stats.maxMana * 0.5;
    const before = state.player.mana;
    const cost = manaCost(state, 0);
    const killsBefore = state.kills;
    press(state, 0);
    run(state, SKILL.whirl.duration);
    const kills = state.kills - killsBefore;
    expect(kills, "複数体を倒している").toBeGreaterThanOrEqual(3);
    // 撃破そのもの（MANA.onKill）の回収を除いた返却分
    const refund = state.player.mana - (before - cost) - kills * MANA.onKill;
    expect(refund, "払った額を超えて戻らない").toBeLessThanOrEqual(cost + 1e-6);
    expect(refund, "払った額までは戻る").toBeCloseTo(cost);
  });

  it("連鎖（マナ型）: 過負荷で HP から払った分はマナとして返さない", () => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: ["chainReset"] }], 5, ["ks_overdraw"]);
    const e = placeEnemy(state, "golem", 16);
    e.hp = 1;
    e.phase = "idle";
    state.player.mana = 0;
    press(state, 0);
    run(state, SKILL.whirl.duration);
    expect(e.hp).toBeLessThanOrEqual(0);
    expect(state.player.mana, "戻るのは撃破の回収だけ").toBeCloseTo(MANA.onKill);
  });

  it("連鎖（マナ型）の返却は最大マナを超えない", () => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: ["chainReset"] }]);
    for (const dx of [14, -14, 0]) {
      const e = placeEnemy(state, "golem", dx, dx === 0 ? 14 : 0);
      e.hp = 1;
      e.phase = "idle";
    }
    state.player.mana = state.stats.maxMana;
    press(state, 0);
    expect(state.player.mana).toBeLessThanOrEqual(state.stats.maxMana);
  });

  it("呪い: 当てた敵に刻印、刻印中はスキル被ダメが増える", () => {
    const state = skillArena([{ key: "thunder", links: 1, modifiers: ["curse"] }]);
    const e = tough(state, 60);
    press(state, 0, aimAt(state, 60));
    run(state, SKILL.thunder.delay + FIXED_DT);
    expect(state.skills.curses.has(e.id)).toBe(true);
    expect(curseMul(state, e.id)).toBeCloseTo(1 + SKILL.modifier.curse.bonus);

    const params = resolveSlot(state, 0)?.params;
    if (!params) throw new Error("params");
    const target = tough(state, 0, 40);
    const base = 20;
    const spec = { base, kind: "ranged" as const, dir: { x: 1, y: 0 }, knockback: 0, stagger: false };
    state.combo.count = 0;
    let hp = target.hp;
    skillHit(state, target, { ...params, curse: null }, spec);
    const plainDamage = hp - target.hp;
    state.skills.curses.set(target.id, { time: SKILL.modifier.curse.duration, bonus: SKILL.modifier.curse.bonus });
    state.combo.count = 0;
    hp = target.hp;
    skillHit(state, target, { ...params, curse: null }, spec);
    expect(hp - target.hp).toBe(Math.round(plainDamage * (1 + SKILL.modifier.curse.bonus)));
    run(state, SKILL.modifier.curse.duration + 1);
    expect(state.skills.curses.has(target.id)).toBe(false);
  });

  it("遅延: その場では何も起きず、0.8 秒後に発動地点で強化して発動", () => {
    const state = skillArena([{ key: "quake", links: 1, modifiers: ["delay"] }]);
    const e = tough(state, 30);
    press(state, 0);
    expect(state.skills.active).toBeNull();
    expect(state.skills.echoes[0]?.kind).toBe("delay");
    expect(state.skills.echoes[0]?.params.damageMul).toBeCloseTo(SKILL.modifier.delay.damageMul);
    run(state, SKILL.modifier.delay.time / 2);
    expect(e.hp).toBe(BIG_HP);
    run(state, SKILL.modifier.delay.time);
    expect(e.hp).toBeLessThan(BIG_HP);
    expect(state.skills.echoes).toHaveLength(0);
  });

  it("遅延 + 反響: 本発動の後に反響が続く", () => {
    const state = skillArena([{ key: "mines", links: 2, modifiers: ["delay", "echo"] }]);
    press(state, 0);
    expect(state.skills.mines).toHaveLength(0);
    run(state, SKILL.modifier.delay.time + FIXED_DT);
    expect(state.skills.mines).toHaveLength(1);
    expect(state.skills.echoes.some((e) => e.kind === "echo")).toBe(true);
    run(state, SKILL.modifier.echo.delay + FIXED_DT);
    expect(state.skills.mines).toHaveLength(2);
  });

  it("拡大: 範囲 x1.5 でコストが重い", () => {
    const state = skillArena([{ key: "frostField", links: 1, modifiers: ["expand"] }]);
    press(state, 0, aimAt(state, 50));
    expect(state.skills.fields[0]?.params.areaMul).toBeCloseTo(SKILL.modifier.expand.areaMul);
    expect(manaCost(state, 0)).toBeCloseTo(SKILL.frostField.cost * (1 + SKILL.linkBurdenPenalty) * SKILL.modifier.expand.burdenMul);
  });

  it("反響は新スキルにも効く（回転弾幕は発動地点に残像）", () => {
    const state = skillArena([{ key: "spiral", links: 1, modifiers: ["echo"] }]);
    press(state, 0);
    run(state, SKILL.modifier.echo.delay);
    expect(state.skills.ghosts.some((g) => g.skillKey === "spiral")).toBe(true);
  });

  it("階層を移ると設置物と呪いは消える", () => {
    const state = skillArena([{ key: "mines" }, { key: "frostField" }]);
    press(state, 0);
    waitInterval(state, 1);
    press(state, 1, aimAt(state, 30));
    expect(state.skills.fields, "前提: 氷結地帯が出ている").toHaveLength(1);
    state.skills.curses.set(1, { time: 3, bonus: 0.3 });
    state.depth += 1;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.mines).toHaveLength(0);
    expect(state.skills.fields).toHaveLength(0);
    expect(state.skills.curses.size).toBe(0);
  });
});

describe("溜め（Charge 刻印符）", () => {
  it("held の検出: 押している間 charging が true、離すと消費される", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["charge"] }]);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true, ...aimAt(state, 60) }), FIXED_DT);
    expect(state.skills.slots[0]?.charging).toBe(true);
    expect(state.skills.grenades).toHaveLength(0);
    updatePlayer(state, withInput({ skill1Held: false, ...aimAt(state, 60) }), FIXED_DT);
    expect(state.skills.slots[0]?.charging).toBe(false);
    expect(state.skills.grenades).toHaveLength(1);
  });

  it("溜め中は移動速度が 60%", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["charge"] }]);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true }), FIXED_DT);
    expect(skillMoveMul(state)).toBeCloseTo(SKILL.modifier.charge.moveMul);
  });

  it("0.15 秒未満で離すと通常発動（倍率 x1）", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["charge"] }]);
    holdAndRelease(state, 0, SKILL.modifier.charge.minTime / 2, aimAt(state, 60));
    expect(state.skills.grenades).toHaveLength(1);
    expect(state.skills.grenades[0]?.params.damageMul).toBeCloseTo(1);
    expect(state.skills.grenades[0]?.params.areaMul).toBeCloseTo(1);
  });

  it("溜めた秒数に応じて威力・範囲が倍率付きで発動する", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["charge"] }]);
    const half = SKILL.modifier.charge.maxTime / 2;
    holdAndRelease(state, 0, half, aimAt(state, 60));
    const c = SKILL.modifier.charge;
    const ratio = half / c.maxTime;
    expect(state.skills.grenades[0]?.params.damageMul).toBeCloseTo(1 + (c.maxDamageMul - 1) * ratio, 1);
    expect(state.skills.grenades[0]?.params.areaMul).toBeCloseTo(1 + (c.maxAreaMul - 1) * ratio, 1);
  });

  it("上限（1.2 秒）で頭打ち。それ以上溜めても倍率は変わらない", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["charge"] }]);
    holdAndRelease(state, 0, SKILL.modifier.charge.maxTime + 1, aimAt(state, 60));
    const c = SKILL.modifier.charge;
    expect(state.skills.grenades[0]?.params.damageMul).toBeCloseTo(c.maxDamageMul);
    expect(state.skills.grenades[0]?.params.areaMul).toBeCloseTo(c.maxAreaMul);
  });

  it("チャージ中は chargeRatio が 0..1 を返し、離すと null に戻る", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["charge"] }]);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true }), FIXED_DT);
    const r = chargeRatio(state, 0);
    expect(r).not.toBeNull();
    expect(r ?? -1).toBeGreaterThan(0);
    expect(r ?? 2).toBeLessThanOrEqual(1);
    updatePlayer(state, withInput({ skill1Held: false }), FIXED_DT);
    expect(chargeRatio(state, 0)).toBeNull();
  });

  it("マナ型の溜め: 押した時点ではマナを払わず、離した瞬間に払う", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["charge"] }]);
    const before = state.player.mana;
    const cost = manaCost(state, 0);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true, ...aimAt(state, 60) }), FIXED_DT);
    run(state, SKILL.modifier.charge.minTime, withInput({ skill1Held: true, ...aimAt(state, 60) }));
    expect(state.skills.slots[0]?.charging).toBe(true);
    expect(state.player.mana, "溜め中は払わない").toBe(before);
    updatePlayer(state, withInput({ skill1Held: false, ...aimAt(state, 60) }), FIXED_DT);
    expect(state.skills.grenades).toHaveLength(1);
    expect(state.player.mana, "離した瞬間に払う").toBeCloseTo(before - cost);
  });

  it("マナ型の溜め: 押した時点で足りなければ溜めずに不発", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["charge"] }]);
    state.player.mana = manaCost(state, 0) - 1;
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true }), FIXED_DT);
    expect(state.skills.slots[0]?.charging).toBe(false);
    expect(state.skills.manaFlash).toBeGreaterThan(0);
  });

  it("マナ型の溜め: 離した時点で足りなければ不発（何も消費しない）", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["charge"] }]);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true, ...aimAt(state, 60) }), FIXED_DT);
    run(state, SKILL.modifier.charge.minTime, withInput({ skill1Held: true, ...aimAt(state, 60) }));
    state.player.mana = 1;
    updatePlayer(state, withInput({ skill1Held: false, ...aimAt(state, 60) }), FIXED_DT);
    expect(state.skills.grenades).toHaveLength(0);
    expect(state.player.mana).toBe(1);
    expect(state.skills.manaFlash).toBeGreaterThan(0);
  });

  it("Charge は付けられない: パリィ / 血の契約 / 加速 / 回転弾幕", () => {
    for (const key of ["parry", "bloodPact", "haste", "spiral"] as const) {
      const state = skillArena([{ key, links: 1, modifiers: ["charge"] }]);
      updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true }), FIXED_DT);
      // 効かないので溜めは始まらず、通常どおり即時発動している
      expect(state.skills.slots[0]?.charging).toBe(false);
    }
  });
});

describe("追加スキルの決定性", () => {
  it("新スキルを装着したランも同じ入力列なら同じ結果", () => {
    const play = (): string => {
      const profile = createDefaultSkillProfile();
      const a = stoneFromSeed(31, { foundDepth: 1, now: 0, skillKey: "thunder" });
      const b = stoneFromSeed(32, { foundDepth: 1, now: 0, skillKey: "spiral" });
      profile.stones = [a, b];
      profile.loadout = [a.id, b.id];
      const state = createGame(12, "12", undefined, profile);
      for (let i = 0; i < 600; i++) {
        step(
          state,
          withInput({
            move: { x: i % 100 < 50 ? 1 : -1, y: 0 },
            skill1Pressed: i % 80 === 0,
            skill2Pressed: i % 130 === 7,
            aimScreen: { x: VIEW_W / 2 + 50, y: VIEW_H / 2 },
          }),
          FIXED_DT,
        );
      }
      const p = state.player;
      return [p.body.pos.x.toFixed(3), p.body.pos.y.toFixed(3), p.hp, state.score, state.skills.bullets.length, state.nextId].join("|");
    };
    expect(play()).toBe(play());
  });
});
