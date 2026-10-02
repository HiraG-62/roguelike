import { describe, expect, it } from "vitest";
import { grantBoon } from "./boons";
import { updateInteract } from "./interact";
import { createGame, step } from "../core/game";
import type { FrameInput } from "../core/input";
import { codesForAction, mouseButtonCode, skillKeyLabel } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { StatusEffect } from "../core/status";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { KEYSTONE } from "../data/tuning";
import { BODY_SKILL_KEYS, MODIFIERS, SKILL, SKILL_DEFS, canAttach } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { createDefaultSkillProfile, stoneInSlot } from "../skills/persistence";
import { MODIFIER_KEYS, SKILL_KEYS, type ModifierKey, type SkillKey, type SkillStone, type VariantRoll } from "../skills/types";
import { updatePlayer } from "./player";
import {
  addToHand,
  attachFromHand,
  attachRune,
  capManaCost,
  chargeRatio,
  createSkillRunState,
  detachToHand,
  dropRune,
  frenzyMul,
  moveRunModifier,
  removeRunModifier,
  resolveSlot,
  rollEnemyRuneDrop,
  skillLocksDash,
  skillMoveMul,
  slotModifierView,
  trackDamageDealt,
  updateSkills,
  usedLinks,
} from "./skills";
import { skillPower } from "../skills/hit";
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
    if (slot) slot.runModifiers = [...(l.modifiers ?? [])];
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

/** スロットの最低間隔が明けるまで待つ（連続発動のテスト用） */
function waitInterval(state: GameState, slot: number): void {
  run(state, (resolveSlot(state, slot)?.interval ?? 0) + FIXED_DT);
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
    const state = skillArena([{ key: "haste" }, { key: "bloodPact" }, { key: "mines" }, { key: "gravityWell" }]);
    expect(state.skills.slots, "スロットは 4 つ").toHaveLength(SKILL.slots);
    press(state, 2);
    expect(state.skills.mines, "スロット 3 = 地雷").toHaveLength(1);
    waitInterval(state, 3);
    press(state, 3, aimAt(state, 60));
    expect(state.skills.wells, "スロット 4 = 引力球").toHaveLength(1);
  });
});

describe("マナと最低間隔", () => {
  it("マナ型は発動でコストを払い、チャージと CD は使わない", () => {
    const state = skillArena([{ key: "gravityWell" }]);
    const before = state.player.mana;
    press(state, 0, aimAt(state, 60));
    expect(state.skills.wells).toHaveLength(1);
    expect(state.player.mana, "コスト分だけ減る").toBeCloseTo(before - SKILL.gravityWell.cost);
    expect(state.skills.slots[0]?.chargesLeft, "チャージは減らない").toBe(1);
    expect(state.skills.slots[0]?.cooldownLeft, "CD は立たない").toBe(0);
  });

  it("マナ不足は不発: 何も消費しない（マナ・HP・コンボ・最低間隔）。点滅と効果音が出て、先行入力も残らない", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["spillover"] }]);
    const p = state.player;
    p.mana = manaCost(state, 0) - 1;
    state.combo.count = 5;
    const mana = p.mana;
    const hp = p.hp;
    state.sfx.length = 0;
    press(state, 0, aimAt(state, 60));
    expect(state.skills.wells, "発動しない").toHaveLength(0);
    expect(p.mana, "マナは減らない").toBe(mana);
    expect(p.hp, "HP も払わない").toBe(hp);
    expect(state.combo.count, "コンボも減らない").toBe(5);
    expect(state.skills.slots[0]?.intervalLeft, "最低間隔も立たない").toBe(0);
    expect(state.skills.manaFlash, "マナバーの点滅").toBeGreaterThan(0);
    expect(state.sfx, "不発の効果音").toContain("manaEmpty");
    expect(state.skills.pendingSlot, "先行入力は破棄").toBe(-1);
    expect(state.texts.some((t) => t.text === "気力不足")).toBe(true);
    run(state, SKILL.manaFlashTime + FIXED_DT);
    expect(state.skills.manaFlash, "点滅は時間で消える").toBe(0);
  });

  it("過負荷（ks_overdraw）ならマナ 0 でも不足分を HP で払って発動する。無ければ不発", () => {
    const state = skillArena([{ key: "gravityWell" }], 5, ["ks_overdraw"]);
    const p = state.player;
    p.mana = 0;
    const hp = p.hp;
    press(state, 0, aimAt(state, 60));
    expect(state.skills.wells, "発動する").toHaveLength(1);
    expect(p.mana).toBe(0);
    expect(p.hp, "不足分 × 0.5 の HP を払う").toBeCloseTo(hp - SKILL.gravityWell.cost * KEYSTONE.overdrawHpPerMana);

    const plain = skillArena([{ key: "gravityWell" }]);
    plain.player.mana = 0;
    press(plain, 0, aimAt(plain, 60));
    expect(plain.skills.wells, "誓約なしは不発").toHaveLength(0);
    expect(plain.player.hp).toBe(plain.player.maxHp);
  });

  it("沈黙・怯み中のプレイヤーはスキルを撃てない（何も消費しない）", () => {
    for (const kind of ["silence", "stagger"] as const) {
      const state = skillArena([{ key: "gravityWell" }]);
      const mana = state.player.mana;
      state.player.status.effects.push({ kind, stacks: 1, time: 1, maxTime: 1, potency: 0, source: "enemy", acc: 0, tick: 0 });
      press(state, 0, aimAt(state, 60));
      expect(state.skills.wells, `${kind} 中に発動した`).toHaveLength(0);
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

  it("共通最低間隔は無い: 1 つ撃った直後の次のステップに別スロットが撃てる", () => {
    const state = skillArena([{ key: "gravityWell" }, { key: "mines" }]);
    press(state, 0, aimAt(state, 60));
    expect(state.skills.wells, "1 つ目").toHaveLength(1);
    press(state, 1);
    expect(state.skills.mines, "直後の別スロットがすぐ出る").toHaveLength(1);
    expect(state.skills.pendingSlot, "先行入力に回らない").toBe(-1);
    expect(state.skills.slots[1]?.intervalLeft, "最低間隔は撃ったスロットだけ").toBeCloseTo(SKILL.mines.minInterval);
  });

  it("同じステップに押した複数スロットはすべて 1→4 の順で発動する", () => {
    const state = skillArena([{ key: "gravityWell" }, { key: "mines" }, { key: "haste" }, { key: "bloodPact" }]);
    press(state, 0, { ...aimAt(state, 60), skill2Pressed: true, skill3Pressed: true, skill4Pressed: true });
    expect(state.skills.wells, "スロット 1").toHaveLength(1);
    expect(state.skills.mines, "スロット 2").toHaveLength(1);
    expect(state.skills.haste.time, "スロット 3").toBeGreaterThan(0);
    expect(state.skills.frenzy.time, "スロット 4").toBeGreaterThan(0);
    expect(state.skills.recentSlots, "発動の履歴は 4 → 3 の順（新しい順）で、押した順が 1→4").toEqual([3, 2]);
  });

  it("本動作（body）同士は排他: 鎖鎌の最中にパリィは出ず、何も払わない", () => {
    const state = skillArena([{ key: "chainHook" }, { key: "parry" }]);
    press(state, 0);
    expect(state.skills.active?.skillKey, "鎖鎌が発動中").toBe("chainHook");
    press(state, 1);
    expect(state.skills.active?.skillKey, "本動作は中断されない").toBe("chainHook");
    expect(state.skills.slots[1]?.chargesLeft, "パリィのチャージは減らない").toBe(1);
  });

  it("同じステップに本動作を 2 つ押すと、先のスロットだけが出る", () => {
    const state = skillArena([{ key: "parry" }, { key: "chainHook" }]);
    const mana = state.player.mana;
    press(state, 0, { skill2Pressed: true });
    expect(state.skills.active?.skillKey).toBe("parry");
    expect(state.player.mana, "鎖鎌のマナは払わない").toBe(mana);
  });

  it("本動作の最中でも設置・強化（body 以外）は並行して撃て、本動作は続く", () => {
    const state = skillArena([{ key: "chainHook" }, { key: "gravityWell" }, { key: "haste" }]);
    press(state, 0);
    press(state, 1, aimAt(state, 60));
    press(state, 2);
    expect(state.skills.active?.skillKey, "鎖鎌は続いている").toBe("chainHook");
    expect(state.skills.wells, "引力球が出る").toHaveLength(1);
    expect(state.skills.haste.time, "加速が掛かる").toBeGreaterThan(0);
  });

  it("本動作の排他で弾かれた入力は先行入力に残り、本動作が終わったら出る", () => {
    const state = skillArena([{ key: "chainHook" }, { key: "parry" }]);
    press(state, 0);
    state.skills.pendingSlot = 1;
    state.skills.pendingTimer = SKILL.inputBuffer;
    const active = state.skills.active;
    if (!active) throw new Error("active");
    active.phase = "recover";
    active.timer = FIXED_DT / 2;
    run(state, FIXED_DT * 2);
    expect(state.skills.slots[1]?.chargesLeft, "本動作の後にパリィが出た").toBe(0);
  });

  it("スキル固有の最低間隔: 同じスロットは間隔が明けるまで撃てない", () => {
    const state = skillArena([{ key: "gravityWell" }]);
    const full = state.player.mana;
    press(state, 0, aimAt(state, 60));
    expect(state.skills.slots[0]?.intervalLeft).toBeCloseTo(SKILL.gravityWell.minInterval);
    run(state, FIXED_DT * 2);
    press(state, 0, aimAt(state, 60));
    run(state, SKILL.inputBuffer + FIXED_DT);
    expect(state.player.mana, "間隔の中では 1 回ぶんしか払っていない（先行入力も切れる）").toBeCloseTo(full - SKILL.gravityWell.cost);
    run(state, SKILL.gravityWell.minInterval);
    press(state, 0, aimAt(state, 60));
    expect(state.player.mana, "間隔が明ければ撃てる").toBeCloseTo(full - SKILL.gravityWell.cost * 2);
  });

  it("先行入力中にマナが足りればそのまま発動する", () => {
    const state = skillArena([{ key: "mines" }]);
    const dash = FIXED_DT * 3;
    state.player.dashTimer = dash;
    state.player.mana = 0;
    press(state, 0);
    expect(state.skills.pendingSlot, "ダッシュ中なので先行入力").toBe(0);
    state.player.mana = SKILL.mines.cost;
    run(state, dash + FIXED_DT);
    expect(state.skills.mines).toHaveLength(1);
    expect(state.player.mana).toBeCloseTo(0);
  });

  it("威力はステータスの係数で伸び、基礎値では旧来の固定値", () => {
    const state = skillArena([{ key: "chainHook" }]);
    const params = resolveSlot(state, 0)?.params;
    if (!params) throw new Error("params");
    const d = SKILL.chainHook.damage;
    const BASE_ATTR = 5;
    const DEX_UP = 10;
    // 基礎値（各 5）での威力は base + 係数 × 5 の合計
    expect(skillPower(state, d, params)).toBeCloseTo(d.base + (d.str + d.dex) * BASE_ATTR);
    state.stats = { ...state.stats, attributesEff: { ...state.stats.attributesEff, dex: BASE_ATTR + DEX_UP } };
    expect(skillPower(state, d, params), "技巧 +10 で係数 × 10 伸びる").toBeCloseTo(d.base + (d.str + d.dex) * BASE_ATTR + d.dex * DEX_UP);
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
    // 吸収は戦闘中の回復の上限（最大 HP の HEAL.sustainCapRatio / 秒）を受けるので、上限未満に収まる与ダメで見る
    const dealt = 40;
    e.hp -= dealt;
    trackDamageDealt(state);
    expect(p.hp).toBeCloseTo(hp + dealt * SKILL.bloodPact.lifesteal);
  });

  it("HP コストで 1 未満にならない", () => {
    const state = skillArena([{ key: "bloodPact" }]);
    state.player.hp = 1;
    press(state, 0);
    expect(state.player.hp).toBe(1);
  });
});

describe("チャージと CD（CD 型）", () => {
  it("CD 中は発動できず（再使用待ち）、CD 経過で回復する", () => {
    const state = skillArena([{ key: "haste" }]);
    press(state, 0);
    expect(state.skills.slots[0]?.chargesLeft).toBe(0);
    waitInterval(state, 0);
    state.skills.haste.time = 0;
    press(state, 0);
    expect(state.skills.haste.time, "再使用待ちの間は発動しない").toBe(0);
    const cd = resolveSlot(state, 0)?.cooldown ?? 0;
    expect(cd).toBeCloseTo(SKILL.haste.cooldown);
    run(state, cd);
    expect(state.skills.slots[0]?.chargesLeft).toBe(1);
  });

  it("石の links は負担に効かない（マナ型のコストは基本のまま）", () => {
    const state = skillArena([{ key: "gravityWell", links: 0 }, { key: "gravityWell", links: 3 }]);
    const a = manaCost(state, 0);
    const b = manaCost(state, 1);
    expect(a).toBeCloseTo(SKILL.gravityWell.cost);
    expect(b).toBeCloseTo(a);
  });
});

describe("修飾子", () => {
  it("反響: 少し後に弱く再発動し、反響の反響は起きない", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["echo"] }]);
    press(state, 0);
    expect(state.skills.echoes).toHaveLength(1);
    run(state, SKILL.modifier.echo.delay);
    const echoed = state.skills.wells.find((g) => g.params.echo === null);
    expect(echoed?.params.damageMul).toBeCloseTo(SKILL.modifier.echo.damageMul);
    expect(state.skills.echoes).toHaveLength(0);
    run(state, SKILL.modifier.echo.delay * 2);
    expect(state.skills.echoes).toHaveLength(0);
  });
});

describe("刻印符（ラン内だけの物）", () => {
  const mods = (state: GameState, i: number): ModifierKey[] => state.skills.slots[i]?.modifiers ?? [];

  it("自動で付くときは空きのあるスロットの先頭から。スロットのリンクを使い切ったら次のスロットへ", () => {
    const state = skillArena([{ key: "gravityWell" }, { key: "gravityWell" }]);
    const picks: ModifierKey[] = ["focus", "bloodPrice", "spillover", "echo"];
    for (const key of picks) expect(attachRune(state, key), key).toBe(0);
    expect(mods(state, 0), "スロット 1 のリンクは 4 本").toEqual(picks);
    expect(attachRune(state, "streak"), "5 枚目は空きのあるスロット 2").toBe(1);
    expect(mods(state, 1)).toEqual(["streak"]);
  });

  it("全スロットのリンクが埋まっていると、最初の候補の最古の符を押し出す", () => {
    const state = skillArena([{ key: "gravityWell" }]);
    for (const key of ["focus", "bloodPrice", "spillover", "echo"] as const) attachRune(state, key);
    expect(attachRune(state, "streak")).toBe(0);
    expect(mods(state, 0), "最古の収束が押し出される").toEqual(["bloodPrice", "spillover", "echo", "streak"]);
  });

  it("床の刻印符は触れると手持ちへ入る（スキルへは付かない。所持品もセーブも経由しない）", () => {
    const state = skillArena([{ key: "parry" }, { key: "gravityWell" }]);
    dropRune(state, state.player.body.pos, "echo");
    run(state, SKILL.drop.pickupDelay + FIXED_DT);
    expect(state.skills.runes, "床から消える").toHaveLength(0);
    expect(state.skills.hand, "手持ちへ入る").toEqual(["echo"]);
    expect(state.skills.slots.every((s) => s.runModifiers.length === 0), "どのスキルにも付かない").toBe(true);
    expect("runes" in state.skills.profile, "プロフィールに符を持たない").toBe(false);
    expect(state.log.some((l) => l.text.includes("手持ち")), "ログに手持ち").toBe(true);
  });

  it("付けられるスキルが無い符でも拾えて手持ちに残る（付ける先は後から選ぶ）", () => {
    const state = skillArena([{ key: "parry" }]);
    dropRune(state, state.player.body.pos, "echo");
    run(state, SKILL.drop.pickupDelay + FIXED_DT);
    expect(state.skills.runes, "床には残らない").toHaveLength(0);
    expect(state.skills.hand).toEqual(["echo"]);
  });

  it("手持ちの符を付けるとスロットへ移り、外すと手持ちへ戻る（手持ちに上限はない）", () => {
    const state = skillArena([{ key: "parry" }, { key: "gravityWell" }]);
    for (let i = 0; i < 12; i++) addToHand(state, "echo");
    expect(state.skills.hand, "12 枚持てる").toHaveLength(12);
    expect(attachFromHand(state, 0, "echo"), "相性表で付かないスキル").toBe("notFit");
    expect(state.skills.hand, "付けられなければ手持ちは減らない").toHaveLength(12);
    expect(attachFromHand(state, 1, "echo")).toBe("ok");
    expect(state.skills.hand, "手持ちから 1 枚減る").toHaveLength(11);
    expect(state.skills.slots[1]?.runModifiers).toEqual(["echo"]);
    expect(attachFromHand(state, 1, "echo"), "同じ符は 1 スキルに 1 枚").toBe("duplicate");
    expect(attachFromHand(state, 1, "streak"), "手持ちに無い符").toBe("missing");
    expect(detachToHand(state, 1, "echo")).toBe(true);
    expect(state.skills.hand, "外した符は手持ちへ戻る").toHaveLength(12);
    expect(state.skills.slots[1]?.runModifiers).toEqual([]);
    expect(detachToHand(state, 1, "echo"), "付いていない符は外せない").toBe(false);
  });

  it("型替え符は 1 スロット 1 枚。付かなかった符は手持ちに残る", () => {
    const state = skillArena([{ key: "gravityWell" }]);
    const stone = stoneInSlot(state.skills.profile, 0);
    if (!stone) throw new Error("石が無い");
    const reshapes = MODIFIER_KEYS.filter((k) => MODIFIERS[k].reshape && canAttach(SKILL_DEFS[stone.skillKey], k));
    const [a, b] = reshapes;
    expect(a !== undefined && b !== undefined, "型替え符が 2 種以上ある").toBe(true);
    if (a === undefined || b === undefined) return;
    addToHand(state, a);
    addToHand(state, b);
    expect(attachFromHand(state, 0, a)).toBe("ok");
    expect(attachFromHand(state, 0, b), "型替え符 2 枚目").toBe("reshape");
    expect(state.skills.hand, "付かなかった符は手持ちに残る").toEqual([b]);
  });

  it("リンクはスロットごとに固定: スロット 4 は 2 本まで。3 枚目の符は効かない", () => {
    const state = skillArena([{ key: "gravityWell" }, { key: "gravityWell" }, { key: "gravityWell" }, { key: "gravityWell", modifiers: ["bloodPrice", "spillover", "echo"] }]);
    const view = slotModifierView(state, 3);
    expect(view.map((v) => [v.key, v.active]), "2 本ぶんだけ効く").toEqual([
      ["bloodPrice", true],
      ["spillover", true],
      ["echo", false],
    ]);
    expect(view.every((v) => v.run), "拾った符").toBe(true);
    expect(usedLinks(state.skills, 3)).toBe(3);
  });

  it("石の links はどんな値でも効き方を変えない（リンクはスロットの物）", () => {
    const state = skillArena([{ key: "gravityWell", links: 0, modifiers: ["bloodPrice", "spillover"] }]);
    expect(state.skills.profile.stones[0]?.links).toBe(0);
    expect(slotModifierView(state, 0).every((v) => v.active), "links 0 でも効く").toBe(true);
  });

  it("祝福が足した符は run = false で、拾った符の後ろに並ぶ", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["bloodPrice"] }]);
    grantBoon(state, "echoCall");
    const view = slotModifierView(state, 0);
    expect(view.map((v) => [v.key, v.run])).toEqual([
      ["bloodPrice", true],
      ["echo", false],
    ]);
  });
});

describe("刻印符の移す・外す（装備画面）", () => {
  it("別のスロットへ移せる。反映は次のステップの同期で、移した符は移し先の最新になる", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["bloodPrice", "echo"] }, { key: "gravityWell", modifiers: ["spillover"] }]);
    expect(moveRunModifier(state.skills, 0, 1, "echo")).toBe("ok");
    expect(state.skills.slots[0]?.runModifiers).toEqual(["bloodPrice"]);
    expect(state.skills.slots[1]?.runModifiers).toEqual(["spillover", "echo"]);
    expect(state.skills.slots[0]?.modifiers, "同期前はまだ古いまま").toEqual(["bloodPrice", "echo"]);
    run(state, FIXED_DT);
    expect(state.skills.slots[0]?.modifiers).toEqual(["bloodPrice"]);
    expect(state.skills.slots[1]?.modifiers).toEqual(["spillover", "echo"]);
  });

  it("移せない理由: 石が無い・相性・重複・リンク不足・元に無い・同じスロット", () => {
    const state = skillArena([
      { key: "gravityWell", modifiers: ["echo"] },
      { key: "parry", modifiers: ["bloodPrice"] },
      { key: "gravityWell", modifiers: ["echo"] },
      { key: "gravityWell", modifiers: ["spillover", "streak"] },
    ]);
    const rs = state.skills;
    expect(moveRunModifier(rs, 0, 1, "echo"), "パリィには反響が付かない").toBe("notFit");
    expect(moveRunModifier(rs, 0, 2, "echo"), "同じ符は 2 枚付けない").toBe("duplicate");
    expect(moveRunModifier(rs, 0, 3, "echo"), "スロット 4 のリンク 2 本は埋まっている").toBe("noLinks");
    expect(moveRunModifier(rs, 0, 0, "echo"), "同じスロットへは動かさない").toBe("missing");
    expect(moveRunModifier(rs, 2, 3, "streak"), "元のスロットに無い符").toBe("missing");
    const empty = skillArena([{ key: "gravityWell", modifiers: ["echo"] }]);
    expect(moveRunModifier(empty.skills, 0, 2, "echo"), "石の無いスロット").toBe("noStone");
    expect(rs.slots[0]?.runModifiers, "失敗したら動かない").toEqual(["echo"]);
  });

  it("型替え符は 1 枚まで", () => {
    const state = skillArena([{ key: "commonWhirl", modifiers: ["toTarget"] }, { key: "commonWhirl", modifiers: ["linger"] }]);
    expect(moveRunModifier(state.skills, 1, 0, "linger"), "リンクは足りるが型替え符は 1 枚まで").toBe("reshape");
  });

  it("外すと符は消え、次のステップで効かなくなる。無い符は外せない", () => {
    const state = skillArena([{ key: "gravityWell", modifiers: ["bloodPrice", "echo"] }]);
    expect(removeRunModifier(state.skills, 0, "echo")).toBe(true);
    expect(removeRunModifier(state.skills, 0, "echo"), "2 回目は無い").toBe(false);
    expect(state.skills.slots[0]?.runModifiers).toEqual(["bloodPrice"]);
    run(state, FIXED_DT);
    expect(state.skills.slots[0]?.modifiers).toEqual(["bloodPrice"]);
  });

  it("同じ seed・同じ操作なら同じ結果（決定性）", () => {
    const play = (): ModifierKey[][] => {
      const state = skillArena([{ key: "gravityWell" }, { key: "gravityWell" }], 9);
      for (const key of ["echo", "bloodPrice", "spillover"] as const) attachRune(state, key);
      moveRunModifier(state.skills, 0, 1, "echo");
      run(state, FIXED_DT * 3);
      return state.skills.slots.map((s) => s.modifiers);
    };
    expect(play()).toEqual(play());
  });
});

describe("同時発動と排他グループ", () => {
  it("発動中の本動作（active）を立てるスキルは必ず排他グループ body（active は 1 つだけ）", () => {
    for (const key of SKILL_KEYS) {
      const state = skillArena([{ key, links: 0 }]);
      tough(state, 30);
      state.player.mana = state.stats.maxMana;
      press(state, 0, aimAt(state, 30));
      if (state.skills.active === null) continue;
      expect(BODY_SKILL_KEYS.includes(key), `${key} は active を使うので body に入れる`).toBe(true);
    }
  });
});

describe("撃破時の刻印符ドロップ", () => {
  it("ボス・エリートの撃破は出どころ付きで抽選し、落ちれば床に置く", () => {
    const state = skillArena([{ key: "gravityWell", links: 1 }]);
    const seen: number[] = [];
    state.rng = { ...state.rng, chance: (p: number) => (seen.push(p), true) };
    const e = tough(state, 30);
    e.elite = "hasted";
    rollEnemyRuneDrop(state, e);
    expect(state.skills.runes, "床に落ちる").toHaveLength(1);
    expect(seen[0], "エリートの確率").toBeCloseTo(SKILL.drop.runeOnKill.elite);
  });
});

describe("ドロップ", () => {
  it("部屋クリアで刻印符、階層到達でスキル石が落ちる（確率を 1 にして確認）", () => {
    const state = skillArena([{ key: "gravityWell", links: 1 }]);
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
    expect(state.skills.floorStones, "触れただけでは拾わない（注目 + 拾うキー）").toHaveLength(1);
    // 照準なし（パッドの右スティック中立）なら手の届く最寄りを拾う
    updateInteract(state, withInput({ interactPressed: true }));
    expect(state.skills.profile.stones.length).toBe(before + 1);
    expect(state.skills.floorStones).toHaveLength(0);
  });

  it("上り階段で戻った階・降り直した階では、階層到達のスキル石が落ちない", () => {
    const state = skillArena([{ key: "gravityWell", links: 1 }]);
    state.rng = { ...state.rng, chance: () => true };
    updateSkills(state, withInput({}), FIXED_DT);
    state.depth -= 1;
    state.runEvents.strata.fresh = false;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.floorStones, "戻った階").toHaveLength(0);
    state.depth += 1;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.floorStones, "降り直した階").toHaveLength(0);
    state.depth += 1;
    state.runEvents.strata.fresh = true;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.floorStones, "初めての階").toHaveLength(1);
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
      return [p.body.pos.x.toFixed(3), p.body.pos.y.toFixed(3), p.hp, state.score, state.skills.artQueue?.length ?? 0, state.nextId].join("|");
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
  it("分身: 撃った位置から少し後に弱い写しが出て、写しからは写しが出ない", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["ghost"] }]);
    press(state, 0, aimAt(state, 60));
    expect(state.skills.echoes, "写しの予約").toHaveLength(1);
    run(state, SKILL.modifier.ghost.delay + FIXED_DT);
    const copy = state.skills.wells.find((g) => g.params.ghost === null);
    expect(copy?.params.damageMul).toBeCloseTo(SKILL.modifier.ghost.damageMul);
    run(state, SKILL.modifier.ghost.delay * 2);
    expect(state.skills.echoes).toHaveLength(0);
    expect(state.skills.wells, "本体と写しの 2 つだけ").toHaveLength(2);
  });

  it("遅延: その場では何も起きず、少し後に発動地点で強化して発動", () => {
    const state = skillArena([{ key: "commonQuake", links: 1, modifiers: ["delay"] }]);
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

  it("収束: 範囲が狭く威力が高い", () => {
    const state = skillArena([{ key: "frostField", links: 1, modifiers: ["focus"] }]);
    press(state, 0, aimAt(state, 50));
    expect(state.skills.fields[0]?.params.areaMul).toBeCloseTo(SKILL.modifier.focus.areaMul);
    expect(state.skills.fields[0]?.params.damageMul).toBeCloseTo(SKILL.modifier.focus.damageMul);
  });

  it("階層を移ると設置物は消える", () => {
    const state = skillArena([{ key: "mines" }, { key: "frostField" }]);
    press(state, 0);
    waitInterval(state, 1);
    press(state, 1, aimAt(state, 30));
    expect(state.skills.fields, "前提: 氷結地帯が出ている").toHaveLength(1);
    state.depth += 1;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.mines).toHaveLength(0);
    expect(state.skills.fields).toHaveLength(0);
  });

  it("階層を移ると結界杭と罠は消え、変身は続く", () => {
    const state = skillArena([{ key: "wardStake" }, { key: "wolfForm" }, { key: "commonWhirl", links: 2, modifiers: ["linger"] }]);
    state.player.mana = state.stats.maxMana;
    press(state, 0, aimAt(state, 30));
    press(state, 2, aimAt(state, 60));
    // 狼化は変身中に他のスキルを封じるので最後に撃つ
    press(state, 1);
    expect(state.skills.stakes, "前提: 杭").toHaveLength(1);
    expect(state.skills.traps, "前提: 罠").toHaveLength(1);
    state.depth += 1;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.stakes).toHaveLength(0);
    expect(state.skills.traps).toHaveLength(0);
    expect(state.skills.shape?.key).toBe("wolfForm");
  });
});

describe("第 2 弾・第 3 弾の同時発動", () => {
  it("変身・設置（杭）は本動作の最中でも並行して撃てる", () => {
    const state = skillArena([{ key: "chainHook" }, { key: "pyreForm" }, { key: "wardStake" }]);
    state.player.mana = state.stats.maxMana;
    press(state, 0);
    expect(state.skills.active?.skillKey, "前提: 鎖鎌の最中").toBe("chainHook");
    press(state, 1);
    press(state, 2, aimAt(state, 40));
    expect(state.skills.shape?.key, "業火の化身は他のスキルを封じない").toBe("pyreForm");
    expect(state.skills.stakes).toHaveLength(1);
  });
});

describe("溜め（Charge 刻印符）", () => {
  it("held の検出: 押している間 charging が true、離すと消費される", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["charge"] }]);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true, ...aimAt(state, 60) }), FIXED_DT);
    expect(state.skills.slots[0]?.charging).toBe(true);
    expect(state.skills.wells).toHaveLength(0);
    updatePlayer(state, withInput({ skill1Held: false, ...aimAt(state, 60) }), FIXED_DT);
    expect(state.skills.slots[0]?.charging).toBe(false);
    expect(state.skills.wells).toHaveLength(1);
  });

  it("溜め中は移動速度が 60%", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["charge"] }]);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true }), FIXED_DT);
    expect(skillMoveMul(state)).toBeCloseTo(SKILL.modifier.charge.moveMul);
  });

  it("0.15 秒未満で離すと通常発動（倍率 x1）", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["charge"] }]);
    holdAndRelease(state, 0, SKILL.modifier.charge.minTime / 2, aimAt(state, 60));
    expect(state.skills.wells).toHaveLength(1);
    expect(state.skills.wells[0]?.params.damageMul).toBeCloseTo(1);
    expect(state.skills.wells[0]?.params.areaMul).toBeCloseTo(1);
  });

  it("溜めた秒数に応じて威力・範囲が倍率付きで発動する", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["charge"] }]);
    const half = SKILL.modifier.charge.maxTime / 2;
    holdAndRelease(state, 0, half, aimAt(state, 60));
    const c = SKILL.modifier.charge;
    const ratio = half / c.maxTime;
    expect(state.skills.wells[0]?.params.damageMul).toBeCloseTo(1 + (c.maxDamageMul - 1) * ratio, 1);
    expect(state.skills.wells[0]?.params.areaMul).toBeCloseTo(1 + (c.maxAreaMul - 1) * ratio, 1);
  });

  it("上限（1.2 秒）で頭打ち。それ以上溜めても倍率は変わらない", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["charge"] }]);
    holdAndRelease(state, 0, SKILL.modifier.charge.maxTime + 1, aimAt(state, 60));
    const c = SKILL.modifier.charge;
    expect(state.skills.wells[0]?.params.damageMul).toBeCloseTo(c.maxDamageMul);
    expect(state.skills.wells[0]?.params.areaMul).toBeCloseTo(c.maxAreaMul);
  });

  it("チャージ中は chargeRatio が 0..1 を返し、離すと null に戻る", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["charge"] }]);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true }), FIXED_DT);
    const r = chargeRatio(state, 0);
    expect(r).not.toBeNull();
    expect(r ?? -1).toBeGreaterThan(0);
    expect(r ?? 2).toBeLessThanOrEqual(1);
    updatePlayer(state, withInput({ skill1Held: false }), FIXED_DT);
    expect(chargeRatio(state, 0)).toBeNull();
  });

  it("マナ型の溜め: 押した時点ではマナを払わず、離した瞬間に払う", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["charge"] }]);
    const before = state.player.mana;
    const cost = manaCost(state, 0);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true, ...aimAt(state, 60) }), FIXED_DT);
    run(state, SKILL.modifier.charge.minTime, withInput({ skill1Held: true, ...aimAt(state, 60) }));
    expect(state.skills.slots[0]?.charging).toBe(true);
    expect(state.player.mana, "溜め中は払わない").toBe(before);
    updatePlayer(state, withInput({ skill1Held: false, ...aimAt(state, 60) }), FIXED_DT);
    expect(state.skills.wells).toHaveLength(1);
    expect(state.player.mana, "離した瞬間に払う").toBeCloseTo(before - cost);
  });

  it("マナ型の溜め: 押した時点で足りなければ溜めずに不発", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["charge"] }]);
    state.player.mana = manaCost(state, 0) - 1;
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true }), FIXED_DT);
    expect(state.skills.slots[0]?.charging).toBe(false);
    expect(state.skills.manaFlash).toBeGreaterThan(0);
  });

  it("マナ型の溜め: 離した時点で足りなければ不発（何も消費しない）", () => {
    const state = skillArena([{ key: "gravityWell", links: 1, modifiers: ["charge"] }]);
    updatePlayer(state, withInput({ skill1Held: true, skill1Pressed: true, ...aimAt(state, 60) }), FIXED_DT);
    run(state, SKILL.modifier.charge.minTime, withInput({ skill1Held: true, ...aimAt(state, 60) }));
    state.player.mana = 1;
    updatePlayer(state, withInput({ skill1Held: false, ...aimAt(state, 60) }), FIXED_DT);
    expect(state.skills.wells).toHaveLength(0);
    expect(state.player.mana).toBe(1);
    expect(state.skills.manaFlash).toBeGreaterThan(0);
  });

  it("Charge は付けられない: パリィ / 血の契約 / 加速 / 砲身化（channel）", () => {
    for (const key of ["parry", "bloodPact", "haste", "siegeForm"] as const) {
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
      const a = stoneFromSeed(31, { foundDepth: 1, now: 0, skillKey: "commonThunderclap" });
      const b = stoneFromSeed(32, { foundDepth: 1, now: 0, skillKey: "commonBarrage" });
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
      return [p.body.pos.x.toFixed(3), p.body.pos.y.toFixed(3), p.hp, state.score, state.projectiles.length, state.nextId].join("|");
    };
    expect(play()).toBe(play());
  });
});

describe("スキルのコストは最大マナで切り詰める", () => {
  const MAX_MANA = 100;
  const HEAVY_BURDEN = 3;

  it("最大マナ 100・負担 3 倍でもコストが 100 を超えない", () => {
    const capped = capManaCost(MAX_MANA * HEAVY_BURDEN, MAX_MANA);
    expect(capped.cost).toBeLessThanOrEqual(MAX_MANA);
    expect(capped.clamped, "切り詰めた印").toBe(true);
    expect(capManaCost(MAX_MANA / 2, MAX_MANA), "上限以下はそのまま").toEqual({ cost: MAX_MANA / 2, clamped: false });
  });

  it("最大マナを超えるコストのスキルも、満タンなら撃てる", () => {
    const state = skillArena([{ key: "gravityWell" }]);
    const max = SKILL.gravityWell.cost / 2;
    state.stats.maxMana = max;
    state.player.mana = max;
    expect(manaCost(state, 0), "コストは最大マナ").toBe(max);
    press(state, 0, aimAt(state, 60));
    expect(state.skills.wells, "発動する").toHaveLength(1);
    expect(state.player.mana, "マナを使い切る").toBe(0);
  });

  it("過負荷（ks_overdraw）は HP で払えるので切り詰めない", () => {
    const state = skillArena([{ key: "gravityWell" }], 5, ["ks_overdraw"]);
    state.stats.maxMana = SKILL.gravityWell.cost / 2;
    expect(manaCost(state, 0)).toBe(SKILL.gravityWell.cost);
  });
});
