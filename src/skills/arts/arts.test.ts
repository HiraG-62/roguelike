import { describe, expect, it } from "vitest";
import type { FrameInput } from "../../core/input";
import { FIXED_DT } from "../../core/loop";
import type { Enemy, GameState } from "../../core/state";
import type { Vec } from "../../core/vec";
import { VIEW_H, VIEW_W } from "../../core/view";
import { MOVESETS, MOVESET_KEYS, type MovesetKey } from "../../data/weapons";
import { updatePlayer } from "../../system/player";
import { createSkillRunState, updateSkills } from "../../system/skills";
import { arena, placeEnemy, withInput } from "../../system/testHelpers";
import { SKILL_DEFS, canAttach } from "../data";
import { stoneFromSeed, skillWeight } from "../generator";
import { MODIFIER_KEYS, type ModifierKey, type SkillKey, type SkillStone } from "../types";
import { ART_DEFS, ART_SPECS, artMoveset } from "./index";
import { ART_SKILL_KEYS, COMMON_ART_KEYS, WEAPON_ART_KEYS, WEAPON_ART_MOVESETS, type ArtSkillKey } from "./keys";

/**
 * 技（skills/arts/）: 共通技と武器技の定義の形と、実際の発動（updatePlayer → updateSkills → castSlot → engine）。
 * 全技を 1 回ずつ撃って例外・NaN が出ないことも見る（数値や形を足したときの壊れを早く落とす）
 */

const BIG_HP = 5000;
const MIN_PER_MOVESET = 10;
let seed = 9100;

function makeStone(key: SkillKey, links = 0): SkillStone {
  seed += 1;
  return { ...stoneFromSeed(seed, { foundDepth: 1, now: 0, skillKey: key }), variants: [], links };
}

function artArena(key: SkillKey, moveset: MovesetKey = "sword", modifiers: ModifierKey[] = []): GameState {
  const state = arena(5, { moveset });
  const stone = makeStone(key, modifiers.length);
  state.skills = createSkillRunState({ version: 1, loadout: [stone.id], stones: [stone] });
  const slot = state.skills.slots[0];
  if (slot) slot.runModifiers = [...modifiers];
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

function cast(state: GameState, at?: Vec): void {
  const aim = at ? { aimScreen: toScreen(state, at) } : {};
  updatePlayer(state, withInput({ skill1Pressed: true, ...aim }), FIXED_DT);
}

function ahead(state: GameState, dx: number): Vec {
  const p = state.player.body.pos;
  return { x: p.x + dx, y: p.y };
}

describe("技の定義", () => {
  it("どの武器種にも武器技が 10 種以上ある", () => {
    for (const m of MOVESET_KEYS) {
      const keys = (WEAPON_ART_KEYS as Partial<Record<MovesetKey, readonly string[]>>)[m] ?? [];
      expect(keys.length, `${MOVESETS[m].name}の武器技`).toBeGreaterThanOrEqual(MIN_PER_MOVESET);
    }
  });

  it("武器技の key は武器種の key で始まり、定義の武器種と一致する", () => {
    for (const m of WEAPON_ART_MOVESETS) {
      for (const key of WEAPON_ART_KEYS[m]) {
        expect(key.startsWith(m), key).toBe(true);
        expect(artMoveset(key), key).toBe(m);
        expect(SKILL_DEFS[key].moveset, key).toBe(m);
      }
    }
  });

  it("共通技は武器種を持たず、key は common で始まる", () => {
    for (const key of COMMON_ART_KEYS) {
      expect(key.startsWith("common"), key).toBe(true);
      expect(SKILL_DEFS[key].moveset, key).toBeUndefined();
    }
  });

  it("定義は key ごとにちょうど 1 つ", () => {
    expect(ART_SPECS.map((s) => s.key).sort()).toEqual([...ART_SKILL_KEYS].sort());
  });

  it("名前は空でなく重複しない。アイコンは 1 文字で、同じ武器種（共通技は共通技どうし）の中で重複しない", () => {
    const names = ART_SKILL_KEYS.map((k) => SKILL_DEFS[k].name);
    expect(new Set(names).size, "名前の重複").toBe(names.length);
    const groups = new Map<string, string[]>();
    for (const k of ART_SKILL_KEYS) {
      const icon = SKILL_DEFS[k].icon;
      expect([...icon], `${k} のアイコン`).toHaveLength(1);
      const g = artMoveset(k) ?? "common";
      groups.set(g, [...(groups.get(g) ?? []), icon]);
    }
    for (const [g, icons] of groups) expect(new Set(icons).size, `${g} のアイコンの重複`).toBe(icons.length);
  });

  it("どの技にも付く刻印符が 3 つ以上ある", () => {
    for (const key of ART_SKILL_KEYS) {
      expect(MODIFIER_KEYS.filter((m) => canAttach(SKILL_DEFS[key], m)).length, key).toBeGreaterThanOrEqual(3);
    }
  });

  it("抽選の重み: 装備中の武器種の武器技は厚く、ほかの武器種の武器技は薄い。共通技は武器種に依らない", () => {
    expect(skillWeight("swordCrossCut", "sword")).toBeGreaterThan(skillWeight("swordCrossCut", "spear"));
    expect(skillWeight("commonFireball", "sword")).toBe(skillWeight("commonFireball", "spear"));
    expect(skillWeight("whirl", "sword")).toBe(SKILL_DEFS.whirl ? skillWeight("whirl", undefined) : 0);
  });
});

describe("技の発動", () => {
  it("武器技は違う武器種では撃てず、気力も払わない", () => {
    const state = artArena("swordCrossCut", "spear");
    const e = tough(state, 24);
    const mana = state.player.mana;
    cast(state, ahead(state, 24));
    run(state, 0.5);
    expect(e.hp).toBe(BIG_HP);
    expect(state.player.mana).toBeLessThanOrEqual(mana);
    expect(state.player.mana).toBeGreaterThanOrEqual(mana - 1);
  });

  it("武器技は同じ武器種なら撃てる（十字斬りの 2 手目は遅れて当たる）", () => {
    const state = artArena("swordCrossCut", "sword");
    const e = tough(state, 24);
    cast(state, ahead(state, 24));
    const afterFirst = e.hp;
    expect(afterFirst, "1 手目").toBeLessThan(BIG_HP);
    run(state, 0.3);
    expect(e.hp, "2 手目").toBeLessThan(afterFirst);
  });

  it("共通技はどの武器種でも撃てる", () => {
    for (const m of ["sword", "cannon", "fan"] as const) {
      const state = artArena("commonShockwave", m);
      const e = tough(state, 20);
      cast(state, ahead(state, 20));
      expect(e.hp, m).toBeLessThan(BIG_HP);
    }
  });

  it("照準地点に落ちる技はカーソルの位置に当たり、自分の周りには当たらない", () => {
    const state = artArena("commonThunderclap");
    const near = tough(state, 16);
    const far = tough(state, 110);
    cast(state, ahead(state, 110));
    expect(far.hp).toBeLessThan(BIG_HP);
    expect(near.hp).toBe(BIG_HP);
  });

  it("瞬身はカーソル地点へ移る", () => {
    const state = artArena("commonBlink");
    const from = { ...state.player.body.pos };
    cast(state, ahead(state, 60));
    expect(state.player.body.pos.x - from.x).toBeGreaterThan(40);
  });

  it("飛び退きは照準と逆へ下がる", () => {
    const state = artArena("commonBackstep");
    const from = { ...state.player.body.pos };
    cast(state, ahead(state, 60));
    expect(state.player.body.pos.x).toBeLessThan(from.x - 20);
  });

  it("止めの行為は弱った敵を仕留める", () => {
    const state = artArena("swordFinisher");
    const e = tough(state, 20);
    e.hp = BIG_HP * 0.1;
    cast(state, ahead(state, 20));
    expect(e.hp).toBeLessThanOrEqual(0);
  });

  it("狙う状態異常を持つ敵には強く当たる（天割り × 怯み）", () => {
    const hit = (staggered: boolean): number => {
      const state = artArena("swordHeavenSplit");
      const e = tough(state, 30);
      if (staggered) e.status.effects.push({ kind: "stagger", stacks: 1, time: 5, potency: 0, source: "player" } as (typeof e.status.effects)[number]);
      cast(state, ahead(state, 30));
      return BIG_HP - e.hp;
    };
    expect(hit(true)).toBeGreaterThan(hit(false));
  });

  it("刻印符「反響」で技がもう一度起きる", () => {
    const once = artArena("commonShockwave");
    const e1 = tough(once, 20);
    cast(once, ahead(once, 20));
    run(once, 1.5);
    const echoed = artArena("commonShockwave", "sword", ["echo"]);
    const e2 = tough(echoed, 20);
    cast(echoed, ahead(echoed, 20));
    run(echoed, 1.5);
    expect(BIG_HP - e2.hp).toBeGreaterThan(BIG_HP - e1.hp);
  });

  it("階を移ると遅れて出る行為は捨てる", () => {
    const state = artArena("swordBladeStorm");
    cast(state, ahead(state, 60));
    expect(state.skills.artQueue?.length ?? 0).toBeGreaterThan(0);
    state.depth += 1;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.artQueue).toEqual([]);
  });
});

describe("全技の発動（壊れの検出）", () => {
  it.each([...ART_SKILL_KEYS])("%s: 撃って 2 秒進めても例外・NaN が出ない", (key: ArtSkillKey) => {
    const moveset = artMoveset(key) ?? "sword";
    const state = artArena(key, moveset);
    const enemies = [tough(state, 24), tough(state, 50, 20), tough(state, 90, -10)];
    cast(state, ahead(state, 60));
    run(state, 2);
    const p = state.player;
    expect(Number.isFinite(p.body.pos.x) && Number.isFinite(p.body.pos.y), "自分の位置").toBe(true);
    expect(Number.isFinite(p.hp) && Number.isFinite(p.mana), "生命・気力").toBe(true);
    for (const e of enemies) expect(Number.isFinite(e.hp) && Number.isFinite(e.body.pos.x), "敵").toBe(true);
    // 与ダメを持つ技は誰かに当たる（行為の数値が 0 や形の打ち間違いで空振りし続けないか）
    if (SKILL_DEFS[key].damageKind !== "none" && ART_DEFS[key].acts.some((a) => a.anchor === "self" && a.kind !== "shot" && a.damage)) {
      expect(enemies.some((e) => e.hp < BIG_HP), "誰にも当たらない").toBe(true);
    }
  });
});
