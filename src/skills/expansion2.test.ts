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
import { createSkillRunState, resolveSlot, slotComboReady, updateSkills } from "../system/skills";
import { applyStatus } from "../system/statusEffects";
import { placeTerrain, terrainAt } from "../system/terrain";
import { arena, placeEnemy, withInput } from "../system/testHelpers";
import { HUE_RELEASE_TRIGGER, SHIFT_CYCLE, levelGroundMul, shiftElement } from "./actions2";
import { COMBOS } from "./combos";
import { MODIFIERS, SKILL, SKILL_DEFS, canAttach } from "./data";
import { stoneFromSeed } from "./generator";
import { LEYLINE_TERRAIN } from "./hit";
import { type ModifierKey, type SkillKey, type SkillStone, WAVE2_MODIFIER_KEYS, WAVE2_SKILL_KEYS } from "./types";

/**
 * スキル第 2 弾（地形・新しい状態異常・属性・空間）と、その刻印符・型替え符・連携を
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

  it("全 13 種（第 4 弾の泥沼を含む）に定義がそろい、怯み値と最低間隔を持つ", () => {
    expect(WAVE2_SKILL_KEYS).toHaveLength(13);
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

  it("彩刻: 効果量が変わっても（捧げ）彩痕の色はずれない", () => {
    const state = skillArena([{ key: "hueEtch", links: 1, modifiers: ["offering"] }]);
    state.player.energy = state.player.maxEnergy;
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

describe("属性", () => {
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

describe("第 2 弾のスキルと刻印符", () => {
  it("地形化: 命中した位置に攻撃の属性の地形が湧く（光の裁きなら水たまり）", () => {
    const state = skillArena([{ key: "verdict", links: 1, modifiers: ["leyline"] }]);
    const e = tough(state, 20);
    const at = { ...e.body.pos };
    cast(state);
    run(state, 0.05);
    expect(terrainAt(state, at.x, at.y)).toBe(LEYLINE_TERRAIN.light);
  });

  it("足元起点: 水瓶が照準地点ではなく足元で割れる", () => {
    const state = skillArena([{ key: "waterJar", links: 2, modifiers: ["toNova"] }]);
    const me = { ...state.player.body.pos };
    const far = ahead(state, 90);
    cast(state, far);
    expect(terrainAt(state, me.x, me.y)).toBe("water");
    expect(terrainAt(state, far.x, far.y)).toBe("none");
  });

  it("据え置き: 旋風斬りは撃たずに罠を置き、敵が近づくと罠の位置で回る", () => {
    const state = skillArena([{ key: "commonWhirl", links: 2, modifiers: ["linger"] }]);
    const near = tough(state, 15);
    const at = ahead(state, 80);
    cast(state, at);
    expect(lost(near), "その場では回らない").toBe(0);
    expect(state.skills.traps).toHaveLength(1);
    run(state, SKILL.modifier.linger.arm + 0.05);
    const e = tough(state, 80);
    run(state, 0.5);
    expect(state.skills.traps).toHaveLength(0);
    expect(lost(e)).toBeGreaterThan(0);
  });

  it("行為の列・起点・連動の刻印符はすべて定義され、どれかのスキルに付く", () => {
    for (const mod of WAVE2_MODIFIER_KEYS) {
      expect(MODIFIERS[mod].key).toBe(mod);
      expect(Object.values(SKILL_DEFS).some((d) => canAttach(d, mod)), mod).toBe(true);
    }
    expect(canAttach(SKILL_DEFS.waterJar, "split"), "行為の列を持たない手書きには分裂は付かない").toBe(false);
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

  it("走り火: 油流しの後の炎の壁（技）は連携が成立して燃やす", () => {
    const state = skillArena([{ key: "oilPot" }, { key: "commonFireWall" }]);
    cast(state, ahead(state, -60, 60), 0);
    expect(slotComboReady(state, 1)?.key).toBe("oilScorch");
    cast(state, ahead(state, 100), 1);
    expect(state.skills.lastCast?.skillKey, "炎の壁を撃った").toBe("commonFireWall");
    expect(terrainAt(state, ahead(state, 30).x, ahead(state, 30).y), "前方が燃える").toBe("fire");
  });

  it("烙火連: 焼き印の直後の烙火は烙印を足してから起爆する", () => {
    const state = skillArena([{ key: "brandSear" }, { key: "brandBlast" }]);
    const e = tough(state, 25);
    cast(state, undefined, 0);
    expect(slotComboReady(state, 1)?.key).toBe("brandChain");
    cast(state, e.body.pos, 1);
    expect(has(e, "brand")).toBe(false);
  });

  it("崩し落とし・彩爆・地裂墜: 直前の発動で連携可になる（後が技の連携も）", () => {
    const cases: [SkillKey, SkillKey, string][] = [
      ["commonRisingSlash", "commonQuake", "breakCollapse"],
      ["hueEtch", "hueRelease", "hueBloom"],
      ["levelGround", "commonMeteorDive", "levelMeteor"],
    ];
    for (const [a, b, combo] of cases) {
      const state = skillArena([{ key: a }, { key: b }]);
      state.skills.lastCast = { skillKey: a, slot: 0, at: state.skills.clock, pos: { x: 0, y: 0 }, hitIds: new Set() };
      expect(slotComboReady(state, 1)?.key, combo).toBe(combo);
    }
  });

  it.each(["wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"] as const)("化身の極意: 変身 %s の最中の十字斬りで成立する（時間を見ない）", (form) => {
    const state = skillArena([{ key: form }, { key: "commonCrossCut" }]);
    expect(slotComboReady(state, 1), "変身前は成立しない").toBeNull();
    cast(state, undefined, 0);
    run(state, 0.5);
    expect(state.skills.shape?.key, "変身している").toBe(form);
    expect(slotComboReady(state, 1)?.key).toBe("formArt");
    expect(COMBOS.formArt.untimed).toBe(true);
  });
});

describe("第 2 弾の決定性", () => {
  it("同じ操作なら同じ結果（彩刻の色のくじも state.rng だけを使う）", () => {
    const play = (): number[] => {
      const state = skillArena([{ key: "hueEtch" }, { key: "shiftingEdge" }, { key: "waterJar" }]);
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
