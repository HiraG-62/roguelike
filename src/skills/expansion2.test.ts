import { describe, expect, it } from "vitest";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { StatusKind } from "../core/status";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { STATUS } from "../data/tuning";
import { TRAIT_COLORS, type TraitColor, createEmptyResonance } from "../loot/types";
import { updatePlayer } from "../system/player";
import { createSkillRunState, resolveSlot, skillMoveMul, slotComboReady, updateSkills } from "../system/skills";
import { applyStatus } from "../system/statusEffects";
import { placeTerrain, terrainAt } from "../system/terrain";
import { arena, placeEnemy, withInput } from "../system/testHelpers";
import { FORM_MOVESET, HUE_RELEASE_TRIGGER, SHIFT_CYCLE, formDuration, levelGroundMul, shiftElement } from "./actions2";
import { COMBOS } from "./combos";
import { MODIFIERS, SKILL, SKILL_DEFS, canAttach, resolveCast } from "./data";
import { stoneFromSeed } from "./generator";
import { castAttack } from "./hit";
import { INFUSE_STATUS } from "./modifiers2";
import { FORM_TUNING, WEAPON_ART } from "./tuning2";
import { type ModifierKey, type SkillKey, type SkillStone, WAVE2_MODIFIER_KEYS, WAVE2_SKILL_KEYS } from "./types";

/**
 * スキル第 2 弾（地形・新しい状態異常・属性・武器種・変身・空間）と、その刻印符・型替え符・連携を
 * 実際の発動（updatePlayer → updateSkills → castSlot）を通して状態・数値で検証する
 */

const BIG_HP = 1000;

interface Loadout {
  key: SkillKey;
  links?: number;
  modifiers?: ModifierKey[];
}

let seed = 700;

function makeStone(l: Loadout): SkillStone {
  seed += 1;
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: 0, skillKey: l.key }), variants: [], links: l.links ?? 0 };
}

function skillArena(slots: Loadout[]): GameState {
  const state = arena(5);
  const stones = slots.map(makeStone);
  state.skills = createSkillRunState({ version: 1, loadout: stones.map((s) => s.id), stones });
  slots.forEach((l, i) => {
    const slot = state.skills.slots[i];
    if (slot) slot.runModifiers = [...(l.modifiers ?? [])];
  });
  updateSkills(state, withInput({}), 0);
  state.player.mana = state.stats.maxMana;
  return state;
}

function tough(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "golem", dx, dy);
  e.hp = BIG_HP;
  e.maxHp = BIG_HP;
  e.phase = "idle";
  return e;
}

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

function cast(state: GameState, at?: Vec, slot = 0): void {
  const aim = at ? { aimScreen: toScreen(state, at) } : {};
  const keys = { skill1Pressed: slot === 0, skill2Pressed: slot === 1, skill3Pressed: slot === 2, skill4Pressed: slot === 3 };
  updatePlayer(state, withInput({ ...keys, ...aim }), FIXED_DT);
}

function waitReady(state: GameState, slot = 0): void {
  run(state, (resolveSlot(state, slot)?.interval ?? 0) + FIXED_DT);
}

function has(e: Enemy, kind: StatusKind): boolean {
  return e.status.effects.some((s) => s.kind === kind && s.time > 0);
}

function stacks(e: Enemy, kind: StatusKind): number {
  return e.status.effects.find((s) => s.kind === kind && s.time > 0)?.stacks ?? 0;
}

function give(state: GameState, e: Enemy, kind: StatusKind, count = 1, potency = 0, duration = 5): void {
  applyStatus(state, { kind: "enemy", enemy: e }, { kind, stacks: count, duration, potency }, "player");
}

function lost(e: Enemy): number {
  return BIG_HP - e.hp;
}

/** 右へ dx の地点（照準・地形の確認用） */
function ahead(state: GameState, dx: number, dy = 0): Vec {
  return { x: state.player.body.pos.x + dx, y: state.player.body.pos.y + dy };
}

function withResonance(state: GameState, color: TraitColor): void {
  state.stats = { ...state.stats, resonance: { ...createEmptyResonance(), kind: "dominant", colors: [color] } };
}

/** 消費系は食う相手を用意してから撃つ */
function prepare(state: GameState, key: SkillKey, e: Enemy): void {
  if (key === "brandBlast") give(state, e, "brand", 2);
  if (key === "hueRelease") give(state, e, "hue", 1, 0);
  if (key === "flashFreeze") give(state, e, "wet", 2);
}

describe("第 2 弾: 全スキルの発動", () => {
  it.each(WAVE2_SKILL_KEYS.filter((k) => k !== "wardStake"))("%s: 撃つと資源を払い、近くの敵に当たる", (key) => {
    const state = skillArena([{ key }]);
    const e = tough(state, 30);
    prepare(state, key, e);
    const mana = state.player.mana;
    cast(state, e.body.pos);
    const slot = state.skills.slots[0];
    const paid = SKILL_DEFS[key].resource === "mana" ? state.player.mana < mana : (slot?.chargesLeft ?? 1) === 0;
    expect(paid, "払った").toBe(true);
    run(state, 0.6);
    expect(lost(e), "当たった").toBeGreaterThan(0);
  });

  it("全 23 種に定義がそろい、怯み値と最低間隔を持つ", () => {
    expect(WAVE2_SKILL_KEYS).toHaveLength(23);
    for (const key of WAVE2_SKILL_KEYS) {
      const def = SKILL_DEFS[key];
      expect(def.key, key).toBe(key);
      expect(def.poise, `${key} の怯み値`).toBeGreaterThanOrEqual(0);
      expect(def.minInterval, `${key} の最低間隔`).toBeGreaterThan(0);
    }
  });
});

describe("地形を作る・壊す・燃やす", () => {
  it("水瓶: 照準地点に水たまりができ、敵が濡れる。炎の床は水で消える", () => {
    const state = skillArena([{ key: "waterJar" }]);
    const at = ahead(state, 60);
    placeTerrain(state, at.x, at.y, "fire", 0, 5);
    const e = tough(state, 60);
    cast(state, at);
    expect(terrainAt(state, at.x, at.y)).toBe("water");
    expect(stacks(e, "wet")).toBe(SKILL.waterJar.wetStacks);
  });

  it("油流し: 油の床と油膜", () => {
    const state = skillArena([{ key: "oilPot" }]);
    const e = tough(state, 60);
    cast(state, e.body.pos);
    expect(terrainAt(state, e.body.pos.x, e.body.pos.y)).toBe("oil");
    expect(has(e, "oiled")).toBe(true);
  });

  it("焼き払い: 前方の床が燃え、自分の足元は燃えない", () => {
    const state = skillArena([{ key: "scorchLine" }]);
    const me = { ...state.player.body.pos };
    cast(state, ahead(state, 60));
    expect(terrainAt(state, me.x + 40, me.y)).toBe("fire");
    expect(terrainAt(state, me.x, me.y), "足元").toBe("none");
  });

  it("凍て道: カーソル方向へ滑り、通った床が氷床になる", () => {
    const state = skillArena([{ key: "iceSlide" }]);
    const from = { ...state.player.body.pos };
    cast(state, ahead(state, 80));
    expect(state.skills.active?.skillKey).toBe("iceSlide");
    run(state, SKILL.iceSlide.time + 0.05);
    expect(state.player.body.pos.x - from.x, "動いた").toBeGreaterThan(SKILL.iceSlide.distance / 2);
    expect(terrainAt(state, from.x + 30, from.y)).toBe("ice");
  });

  it("地均し: 前方の地形を砕いて消し、砕いた数だけ強い。溶岩は砕けない", () => {
    const plain = skillArena([{ key: "levelGround" }]);
    const a = tough(plain, 60);
    cast(plain);
    const rich = skillArena([{ key: "levelGround" }]);
    for (let dx = 20; dx <= 90; dx += 16) placeTerrain(rich, rich.player.body.pos.x + dx, rich.player.body.pos.y, "oil", 0, 0);
    const lavaAt = ahead(rich, 36);
    placeTerrain(rich, lavaAt.x, lavaAt.y, "lava", 0, 0);
    const b = tough(rich, 60);
    cast(rich);
    expect(terrainAt(rich, rich.player.body.pos.x + 84, rich.player.body.pos.y), "砕けた").toBe("none");
    expect(terrainAt(rich, lavaAt.x, lavaAt.y), "溶岩は残る").toBe("lava");
    expect(lost(b)).toBeGreaterThan(lost(a));
    expect(levelGroundMul(1000), "上限").toBeCloseTo(1 + SKILL.levelGround.maxBonus);
  });

  it("火吸い: 周りの炎の床を吸って消し、吸うほど大きな火球になる", () => {
    const state = skillArena([{ key: "emberDraw" }]);
    const me = state.player.body.pos;
    placeTerrain(state, me.x, me.y + 20, "fire", 16, 5);
    cast(state);
    expect(terrainAt(state, me.x, me.y + 20), "吸われた").toBe("none");
    const shot = state.skills.shots[0];
    expect(shot?.radius ?? 0).toBeGreaterThan(SKILL.emberDraw.radius);
  });

  it("火吸い: 自分の燃焼も吸う", () => {
    const state = skillArena([{ key: "emberDraw" }]);
    applyStatus(state, { kind: "player" }, { kind: "burn", stacks: 1, duration: 3, potency: 2 }, "enemy");
    cast(state);
    expect(state.player.status.effects.some((s) => s.kind === "burn" && s.time > 0)).toBe(false);
  });

  it("沼呼び: 照準地点に毒沼", () => {
    const state = skillArena([{ key: "bogCall" }]);
    const at = ahead(state, 60);
    cast(state, at);
    expect(terrainAt(state, at.x, at.y)).toBe("bog");
  });
});

describe("新しい状態異常を出す・食う", () => {
  it("焼き印: 烙印 2 を刻む", () => {
    const state = skillArena([{ key: "brandSear" }]);
    const e = tough(state, 25);
    cast(state);
    expect(stacks(e, "brand")).toBe(SKILL.brandSear.brandStacks);
  });

  it("烙火: 烙印を倍にしてから起爆する（烙印は消え、烙印の無い敵より強く当たる）", () => {
    const state = skillArena([{ key: "brandBlast" }]);
    const branded = tough(state, 60);
    const plain = tough(state, 60, 30);
    give(state, branded, "brand", 2);
    cast(state, branded.body.pos);
    expect(has(branded, "brand"), "起爆した").toBe(false);
    expect(lost(branded)).toBeGreaterThan(lost(plain) * 2);
  });

  it("烙火: 烙印が無ければ撃てず、何も払わない", () => {
    const state = skillArena([{ key: "brandBlast" }]);
    const e = tough(state, 60);
    cast(state, e.body.pos);
    expect(state.player.mana).toBe(state.stats.maxMana);
  });

  it("崩し蹴り: 崩勢を付け、崩勢中の敵は壁へ叩きつけられる", () => {
    const state = skillArena([{ key: "breakKick" }]);
    const e = tough(state, 20);
    cast(state);
    expect(has(e, "broken")).toBe(true);
    const again = skillArena([{ key: "breakKick" }]);
    const f = tough(again, 20);
    give(again, f, "broken");
    cast(again);
    expect(f.wallSplat).toBe(true);
  });

  it("崩落槌: 崩勢中の敵はその場で怯む", () => {
    const state = skillArena([{ key: "collapseHammer" }]);
    const e = tough(state, 25);
    e.poise.max = BIG_HP;
    give(state, e, "broken");
    cast(state);
    expect(has(e, "stagger")).toBe(true);
    const plain = skillArena([{ key: "collapseHammer" }]);
    const f = tough(plain, 25);
    f.poise.max = BIG_HP;
    cast(plain);
    expect(has(f, "stagger"), "崩勢でなければ怯み値まかせ").toBe(false);
  });

  it("水刃: 飛ぶ斬撃で濡らす", () => {
    const state = skillArena([{ key: "tideSlash" }]);
    const e = tough(state, 50);
    cast(state);
    run(state, 0.3);
    expect(stacks(e, "wet")).toBe(SKILL.tideSlash.wetStacks);
  });

  it("瞬凍: 濡れた敵を凍らせ、水たまりを氷床に変える。濡れも水も無ければ撃てない", () => {
    const state = skillArena([{ key: "flashFreeze" }]);
    const e = tough(state, 30);
    give(state, e, "wet", 3);
    const puddle = ahead(state, -30);
    placeTerrain(state, puddle.x, puddle.y, "water", 0, 5);
    cast(state);
    expect(has(e, "freeze")).toBe(true);
    expect(has(e, "wet"), "濡れは凍結に変わる").toBe(false);
    expect(terrainAt(state, puddle.x, puddle.y)).toBe("ice");
    const dry = skillArena([{ key: "flashFreeze" }]);
    tough(dry, 30);
    cast(dry);
    expect(dry.player.mana).toBe(dry.stats.maxMana);
  });

  it("彩刻: 共鳴の色の彩痕を刻む", () => {
    const state = skillArena([{ key: "hueEtch" }]);
    withResonance(state, "azure");
    const e = tough(state, 25);
    cast(state);
    const hue = e.status.effects.find((s) => s.kind === "hue");
    expect(hue?.potency).toBe(TRAIT_COLORS.indexOf("azure"));
  });

  it("彩刻: 効果量が変わっても（血の代償）彩痕の色はずれない", () => {
    const state = skillArena([{ key: "hueEtch", links: 1, modifiers: ["bloodPrice"] }]);
    withResonance(state, "umbra");
    const e = tough(state, 25);
    cast(state);
    expect(e.status.effects.find((s) => s.kind === "hue")?.potency).toBe(TRAIT_COLORS.indexOf("umbra"));
  });

  it.each(TRAIT_COLORS)("色解き: %s の彩痕は色に合う状態異常で弾ける（色爆で彩痕が消える）", (color) => {
    const state = skillArena([{ key: "hueRelease" }]);
    const e = tough(state, 60);
    give(state, e, "hue", 1, TRAIT_COLORS.indexOf(color));
    cast(state, e.body.pos);
    expect(has(e, "hue"), "色爆").toBe(false);
    expect(HUE_RELEASE_TRIGGER[color].kind).toBeDefined();
  });

  it("吸魔の印: 吸魔を付け、その敵への命中で気力が戻る", () => {
    const state = skillArena([{ key: "siphonMark" }]);
    const e = tough(state, 50);
    cast(state);
    run(state, 0.3);
    expect(has(e, "siphon")).toBe(true);
  });

  it("宣告: 照準の敵とその周りに宣告。対象がいなければ撃てない", () => {
    const state = skillArena([{ key: "doomSentence" }]);
    const e = tough(state, 60);
    const near = tough(state, 60, 12);
    cast(state, e.body.pos);
    expect(has(e, "doom")).toBe(true);
    expect(has(near, "doom")).toBe(true);
    const empty = skillArena([{ key: "doomSentence" }]);
    cast(empty, ahead(empty, 60));
    expect(empty.player.mana).toBe(empty.stats.maxMana);
  });
});

describe("属性・武器種", () => {
  it("移ろい刃: 撃つたびに 炎 → 氷 → 雷 → 毒 と巡り、属性に合う状態異常を付ける", () => {
    const state = skillArena([{ key: "shiftingEdge" }]);
    const kinds: StatusKind[] = ["burn", "chill", "shock", "poison"];
    expect(SHIFT_CYCLE).toEqual(["fire", "ice", "lightning", "poison"]);
    kinds.forEach((kind, i) => {
      const e = tough(state, 25 + i);
      expect(shiftElement(state.skills.slots[0]?.elementStep ?? 0)).toBe(SHIFT_CYCLE[i]);
      cast(state);
      expect(has(e, kind), `${i + 1} 回目は ${kind}`).toBe(true);
      state.enemies = [];
      state.player.mana = state.stats.maxMana;
      waitReady(state);
    });
    expect(state.skills.slots[0]?.elementStep, "一巡して戻る").toBe(0);
  });

  it("極意: 武器種で形が変わる（槍は遠くまで突き、剣は届かない）", () => {
    const sword = skillArena([{ key: "weaponArt" }]);
    const a = tough(sword, 62);
    cast(sword);
    const spear = skillArena([{ key: "weaponArt" }]);
    spear.stats = { ...spear.stats, moveset: "spear" };
    const b = tough(spear, 62);
    cast(spear);
    expect(lost(a), "剣の十文字は届かない").toBe(0);
    expect(lost(b), "槍の槍衾は届く").toBeGreaterThan(0);
    expect(Object.keys(WEAPON_ART).length, "全武器種に形がある").toBe(10);
  });

  it("極意: 杖は魔弾を撃ち、属性は武器（光）に揃う", () => {
    const state = skillArena([{ key: "weaponArt" }]);
    state.stats = { ...state.stats, moveset: "wand" };
    cast(state);
    expect(state.skills.shots).toHaveLength(WEAPON_ART.wand.count);
    expect(state.skills.shots[0]?.params.element).toBe("light");
  });
});

describe("変身", () => {
  it("剛の型: しばらく武器が大剣になり、切れたら戻って少し遅くなる", () => {
    const state = skillArena([{ key: "titanForm" }]);
    expect(state.stats.moveset).toBe("sword");
    cast(state);
    expect(state.stats.moveset).toBe("greatsword");
    expect(state.skills.form?.skillKey).toBe("titanForm");
    run(state, SKILL.titanForm.duration + 0.05);
    expect(state.skills.form).toBeNull();
    expect(state.stats.moveset, "戻る").toBe("sword");
    expect(skillMoveMul(state), "反動で遅い").toBeCloseTo(FORM_TUNING.recoverMoveMul);
    run(state, FORM_TUNING.recoverTime + 0.05);
    expect(skillMoveMul(state)).toBe(1);
  });

  it("変身中に装備を替えて stats が作り直されても変身の武器種に差し直し、切れたら新しい武器種へ戻る", () => {
    const state = skillArena([{ key: "swiftForm" }]);
    cast(state);
    state.stats = { ...state.stats, moveset: "spear" };
    run(state, FIXED_DT);
    expect(state.stats.moveset).toBe(FORM_MOVESET.swiftForm);
    run(state, SKILL.swiftForm.duration);
    expect(state.stats.moveset).toBe("spear");
  });

  it("変身先がジョブの得意な武器種なら長く続く", () => {
    const state = skillArena([{ key: "titanForm" }]);
    const params = resolveSlot(state, 0)?.params;
    if (!params) throw new Error("slot");
    const plain = formDuration(state, "titanForm", params);
    state.job = "swordsman";
    expect(formDuration(state, "titanForm", params)).toBeCloseTo(plain * FORM_TUNING.favoredDurationMul);
  });

  it("霊の型: 杖になり、変身の瞬間に周りを打つ", () => {
    const state = skillArena([{ key: "spiritForm" }]);
    const e = tough(state, 25);
    cast(state);
    expect(state.stats.moveset).toBe("wand");
    expect(lost(e)).toBeGreaterThan(0);
  });
});

describe("結界杭", () => {
  it("2 本で線ができ、線に触れた敵を削る。3 本の内側の敵は脆くなる", () => {
    const state = skillArena([{ key: "wardStake" }]);
    const inside = tough(state, 55, -15);
    const onLine = tough(state, 40, -30);
    cast(state, ahead(state, 40, -60));
    waitReady(state);
    cast(state, ahead(state, 40, 0));
    waitReady(state);
    run(state, SKILL.wardStake.tickEvery + 0.05);
    expect(lost(onLine), "線の上").toBeGreaterThan(0);
    cast(state, ahead(state, 90, 30));
    run(state, SKILL.wardStake.tickEvery + 0.05);
    expect(state.skills.stakes).toHaveLength(3);
    expect(has(inside, "vulnerable"), "囲みの内側").toBe(true);
  });

  it("上限を超えると古い杭から消える", () => {
    const state = skillArena([{ key: "wardStake" }]);
    for (let i = 0; i < SKILL.wardStake.maxAlive + 1; i++) {
      cast(state, ahead(state, 30 + i * 10));
      state.player.mana = state.stats.maxMana;
      waitReady(state);
    }
    expect(state.skills.stakes).toHaveLength(SKILL.wardStake.maxAlive);
  });
});

describe("第 2 弾の刻印符", () => {
  it.each(["fireInfuse", "iceInfuse", "stormInfuse", "venomInfuse", "breakInfuse"] as const)("%s: 命中で状態異常を付ける", (mod) => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: [mod] }]);
    const e = tough(state, 15);
    cast(state);
    run(state, SKILL.whirl.duration);
    const kind = INFUSE_STATUS[mod][0]?.kind;
    if (!kind) throw new Error("付与が無い");
    expect(has(e, kind) || (kind === "chill" && has(e, "freeze"))).toBe(true);
  });

  it("属性の刻印符は発動の属性を差し替える（ジャンルはそのまま）", () => {
    const p = resolveCast(SKILL_DEFS.quake, makeStone({ key: "quake", links: 1 }), ["fireInfuse"]);
    expect(castAttack(p)?.element).toBe("fire");
    expect(castAttack(p)?.genre).toEqual(castAttack(resolveCast(SKILL_DEFS.quake, makeStone({ key: "quake" }), []))?.genre);
  });

  it("属性を差し替える刻印符同士は同時に効かない（古い方が効く）", () => {
    const p = resolveCast(SKILL_DEFS.quake, makeStone({ key: "quake", links: 2 }), ["iceInfuse", "fireInfuse"]);
    expect(p.element).toBe("ice");
  });

  it("彩り: 共鳴の色の彩痕を付ける。共鳴が無ければ付かない", () => {
    const state = skillArena([{ key: "whirl", links: 1, modifiers: ["hueInfuse"] }]);
    withResonance(state, "gold");
    const e = tough(state, 15);
    cast(state);
    run(state, SKILL.whirl.duration);
    expect(e.status.effects.find((s) => s.kind === "hue")?.potency).toBe(TRAIT_COLORS.indexOf("gold"));
    const none = skillArena([{ key: "whirl", links: 1, modifiers: ["hueInfuse"] }]);
    const f = tough(none, 15);
    cast(none);
    run(none, SKILL.whirl.duration);
    expect(has(f, "hue")).toBe(false);
  });

  it("地染め: 命中した位置に属性の地形が湧く（炎化なら炎）。1 回の発動で上限まで", () => {
    const state = skillArena([{ key: "quake", links: 2, modifiers: ["fireInfuse", "leyline"] }]);
    const e = tough(state, 30);
    const at = { ...e.body.pos };
    cast(state);
    run(state, SKILL.quake.windup + 0.05);
    expect(terrainAt(state, at.x, at.y)).toBe("fire");
  });

  it("心得: ジョブの得意な武器種なら強く、そうでなければ弱い", () => {
    const hit = (job: GameState["job"]): number => {
      const state = skillArena([{ key: "quake", links: 1, modifiers: ["jobMastery"] }]);
      state.job = job;
      cast(state);
      return state.skills.active?.params.damageMul ?? 0;
    };
    const m = SKILL.modifier.jobMastery;
    expect(hit("swordsman") / hit("hunter")).toBeCloseTo(m.favoredMul / m.otherMul, 1);
  });

  it("武器写し: 雷の鞭なら雷属性、無属性の剣なら素の冴えで強い", () => {
    const state = skillArena([{ key: "quake", links: 1, modifiers: ["weaponBond"] }]);
    state.stats = { ...state.stats, moveset: "whip" };
    const e = tough(state, 30);
    cast(state);
    expect(state.skills.active?.params.element).toBe("lightning");
    run(state, SKILL.quake.windup + 0.05);
    expect(lost(e)).toBeGreaterThan(0);
    const sword = skillArena([{ key: "quake", links: 1, modifiers: ["weaponBond"] }]);
    cast(sword);
    expect(sword.skills.active?.params.damageMul).toBeCloseTo(SKILL.modifier.weaponBond.plainMul);
  });

  it("化身: 変身中は強く、変身していなければ弱い", () => {
    const state = skillArena([{ key: "titanForm" }, { key: "quake", links: 1, modifiers: ["formSurge"] }]);
    cast(state, undefined, 1);
    const before = state.skills.active?.params.damageMul ?? 0;
    run(state, SKILL.quake.windup + SKILL.quake.recover + 0.1);
    state.player.mana = state.stats.maxMana;
    cast(state, undefined, 0);
    waitReady(state, 1);
    cast(state, undefined, 1);
    const after = state.skills.active?.params.damageMul ?? 0;
    const m = SKILL.modifier.formSurge;
    expect(after / before).toBeCloseTo(m.formMul / m.otherMul);
  });

  it("深化: 変身の持続と反動が伸びる", () => {
    const state = skillArena([{ key: "titanForm", links: 1, modifiers: ["formLinger"] }]);
    cast(state);
    expect(state.skills.form?.total).toBeCloseTo(SKILL.titanForm.duration * SKILL.modifier.formLinger.durationMul);
    expect(state.skills.form?.recover).toBeCloseTo(FORM_TUNING.recoverTime * SKILL.modifier.formLinger.recoverMul);
  });

  it("自己中心化: 水瓶が照準地点ではなく足元で割れる", () => {
    const state = skillArena([{ key: "waterJar", links: 2, modifiers: ["toNova"] }]);
    const me = { ...state.player.body.pos };
    const far = ahead(state, 90);
    cast(state, far);
    expect(terrainAt(state, me.x, me.y)).toBe("water");
    expect(terrainAt(state, far.x, far.y)).toBe("none");
  });

  it("罠化: 旋風斬りは撃たずに罠を置き、敵が近づくと罠の位置で回る", () => {
    const state = skillArena([{ key: "whirl", links: 2, modifiers: ["toTrap"] }]);
    const at = ahead(state, 80);
    cast(state, at);
    expect(state.skills.active, "その場では回らない").toBeNull();
    expect(state.skills.traps).toHaveLength(1);
    run(state, SKILL.modifier.toTrap.arm + 0.05);
    const e = tough(state, 80);
    run(state, SKILL.whirl.duration + 0.1);
    expect(state.skills.traps).toHaveLength(0);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("第 2 弾の刻印符はすべて定義され、どれかのスキルに付く", () => {
    for (const mod of WAVE2_MODIFIER_KEYS) {
      expect(MODIFIERS[mod].key).toBe(mod);
      expect(Object.values(SKILL_DEFS).some((d) => canAttach(d, mod)), mod).toBe(true);
    }
    expect(canAttach(SKILL_DEFS.haste, "fireInfuse"), "与ダメの無いスキルには属性が付かない").toBe(false);
    expect(canAttach(SKILL_DEFS.titanForm, "formLinger")).toBe(true);
    expect(canAttach(SKILL_DEFS.whirl, "formLinger"), "深化は変身だけ").toBe(false);
  });
});

describe("第 2 弾の連携", () => {
  it("瞬氷: 水瓶の後の瞬凍は範囲が広く、長く凍らせる", () => {
    const state = skillArena([{ key: "waterJar" }, { key: "flashFreeze" }]);
    const e = tough(state, 70);
    cast(state, e.body.pos, 0);
    expect(slotComboReady(state, 1)?.key).toBe("waterFreeze");
    cast(state, undefined, 1);
    expect(has(e, "freeze"), "素の範囲の外でも凍る").toBe(true);
  });

  it("走り火: 油流しの後の焼き払いは炎の帯が長い", () => {
    const state = skillArena([{ key: "oilPot" }, { key: "scorchLine" }]);
    cast(state, ahead(state, -60, 60), 0);
    expect(slotComboReady(state, 1)?.key).toBe("oilScorch");
    const me = { ...state.player.body.pos };
    cast(state, ahead(state, 100), 1);
    expect(terrainAt(state, me.x + SKILL.scorchLine.length + 20, me.y), "素の長さの先まで燃える").toBe("fire");
  });

  it("烙火連: 焼き印の直後の烙火は烙印を足してから起爆する", () => {
    const state = skillArena([{ key: "brandSear" }, { key: "brandBlast" }]);
    const e = tough(state, 25);
    cast(state, undefined, 0);
    expect(slotComboReady(state, 1)?.key).toBe("brandChain");
    cast(state, e.body.pos, 1);
    expect(has(e, "brand")).toBe(false);
  });

  it("崩し落とし・彩爆・地裂墜: 直前の発動で連携可になる", () => {
    const cases: [SkillKey, SkillKey, string][] = [
      ["breakKick", "collapseHammer", "breakCollapse"],
      ["hueEtch", "hueRelease", "hueBloom"],
      ["levelGround", "meteorDive", "levelMeteor"],
    ];
    for (const [a, b, combo] of cases) {
      const state = skillArena([{ key: a }, { key: b }]);
      state.skills.lastCast = { skillKey: a, slot: 0, at: state.skills.clock, pos: { x: 0, y: 0 }, hitIds: new Set() };
      expect(slotComboReady(state, 1)?.key, combo).toBe(combo);
    }
  });

  it("渦爆（空間）: 引力球の中へ投げたグレネードは球の中心へ吸われる", () => {
    const state = skillArena([{ key: "gravityWell" }, { key: "frag" }]);
    const wellAt = ahead(state, 80);
    cast(state, wellAt, 0);
    cast(state, { x: wellAt.x + 20, y: wellAt.y + 20 }, 1);
    const g = state.skills.grenades[0];
    const well = state.skills.wells[0];
    expect(g && well && Math.hypot(g.to.x - well.pos.x, g.to.y - well.pos.y)).toBeLessThan(1);
  });

  it("氷雷（空間）: 氷結地帯の中へ落とした雷撃は地帯の中の敵すべてへ落ちる", () => {
    const state = skillArena([{ key: "frostField" }, { key: "thunder" }]);
    const at = ahead(state, 80);
    tough(state, 80, 20);
    tough(state, 80, -20);
    tough(state, 70, 0);
    cast(state, at, 0);
    cast(state, at, 1);
    expect(state.skills.strikes).toHaveLength(3);
  });

  it("化身の極意: 変身中の極意は威力が上がる（時間を見ない）", () => {
    const state = skillArena([{ key: "titanForm" }, { key: "weaponArt" }]);
    expect(slotComboReady(state, 1)).toBeNull();
    cast(state, undefined, 0);
    run(state, 3);
    expect(slotComboReady(state, 1)?.key).toBe("formArt");
    expect(COMBOS.formArt.untimed).toBe(true);
  });
});

describe("第 2 弾の決定性", () => {
  it("同じ操作なら同じ結果（彩刻の色のくじも state.rng だけを使う）", () => {
    const play = (): number[] => {
      const state = skillArena([{ key: "hueEtch" }, { key: "shiftingEdge" }, { key: "scorchLine" }]);
      state.stats = { ...state.stats, resonance: { ...createEmptyResonance(), kind: "scatter", colors: [] } };
      const e = tough(state, 25);
      cast(state, undefined, 0);
      waitReady(state, 0);
      cast(state, undefined, 1);
      cast(state, ahead(state, 60), 2);
      run(state, 0.5);
      return [e.hp, ...e.status.effects.map((s) => s.potency * 100 + s.stacks)];
    };
    expect(play()).toEqual(play());
    expect(STATUS.hue.duration).toBeGreaterThan(0);
  });
});
