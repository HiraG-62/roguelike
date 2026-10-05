import { describe, expect, it } from "vitest";
import type { FrameInput } from "../../core/input";
import { FIXED_DT } from "../../core/loop";
import type { Enemy, GameState } from "../../core/state";
import type { Vec } from "../../core/vec";
import { VIEW_H, VIEW_W } from "../../core/view";
import type { MovesetKey } from "../../data/weapons";
import { updatePlayer } from "../../system/player";
import { createSkillRunState, updateSkills } from "../../system/skills";
import { arena, placeEnemy, withInput } from "../../system/testHelpers";
import { SKILL_DEFS, canAttach } from "../data";
import { stoneFromSeed, skillWeight } from "../generator";
import { LEGACY_SKILL_MAP, migrateSkillKey } from "../legacyKeys";
import { MODIFIER_KEYS, SKILL_KEYS, type ModifierKey, type SkillKey, type SkillStone } from "../types";
import { ART_DEFS, ART_SPECS, artMoveset, isArtKey } from "./index";
import { ART_SKILL_KEYS, COMMON_ART_KEYS, type ArtSkillKey } from "./keys";

/**
 * 技（skills/arts/）: 共通技 60 の定義の形と旧 key の写し、実際の発動（updatePlayer → updateSkills → castSlot → engine）。
 * 全技を 1 回ずつ撃って例外・NaN が出ないことも見る（数値や形を足したときの壊れを早く落とす）
 */

const BIG_HP = 5000;
/** 共通技の数（今の 24 + 束ねた 36。docs/ideas/skills-7c-plan.md 1 章） */
const COMMON_ART_COUNT = 60;
/** 束ねた武器技の数（2 章。全部に写し先がある） */
const WEAPON_ART_COUNT = 298;
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
  it("技は共通技 60 だけで、key は common で始まる", () => {
    expect(ART_SKILL_KEYS.length).toBe(COMMON_ART_COUNT);
    for (const key of COMMON_ART_KEYS) expect(key.startsWith("common"), key).toBe(true);
  });

  it("武器種の縛りを持たない（ArtSpec.moveset は全て null、SkillDef.moveset も無い）", () => {
    for (const spec of ART_SPECS) {
      expect(spec.moveset, spec.key).toBeNull();
      expect(artMoveset(spec.key), spec.key).toBeNull();
      expect(SKILL_DEFS[spec.key].moveset, spec.key).toBeUndefined();
    }
  });

  it("定義は key ごとにちょうど 1 つ", () => {
    expect(ART_SPECS.map((s) => s.key).sort()).toEqual([...ART_SKILL_KEYS].sort());
  });

  it("名前は空でなく重複しない。アイコンは 1 文字で、60 種の中で重複しない", () => {
    const names = ART_SKILL_KEYS.map((k) => SKILL_DEFS[k].name);
    for (const n of names) expect(n.length, "名前").toBeGreaterThan(0);
    expect(new Set(names).size, "名前の重複").toBe(names.length);
    const icons = ART_SKILL_KEYS.map((k) => SKILL_DEFS[k].icon);
    for (const icon of icons) expect([...icon], `${icon} のアイコン`).toHaveLength(1);
    expect(new Set(icons).size, "アイコンの重複").toBe(icons.length);
  });

  it("どの技にも付く刻印符が 3 つ以上ある", () => {
    for (const key of ART_SKILL_KEYS) {
      expect(MODIFIER_KEYS.filter((m) => canAttach(SKILL_DEFS[key], m)).length, key).toBeGreaterThanOrEqual(3);
    }
  });

  it("抽選の重みは武器種に依らない", () => {
    for (const key of ART_SKILL_KEYS) expect(skillWeight(key, "sword"), key).toBe(skillWeight(key, "cannon"));
    expect(skillWeight("commonFireball", "sword")).toBeGreaterThan(0);
  });
});

describe("旧 key の写し（skills/legacyKeys.ts）", () => {
  const keySet = new Set<string>(SKILL_KEYS);
  const isSkillKey = (k: string): boolean => keySet.has(k);

  it("写し先は全て今の SKILL_KEYS にあり、写しで消える石は無い（null の行が無い）", () => {
    for (const [from, to] of Object.entries(LEGACY_SKILL_MAP)) {
      expect(to, `${from} の写し先`).not.toBeNull();
      expect(isSkillKey(to ?? ""), `${from} → ${to}`).toBe(true);
    }
  });

  it("旧 key は今の key と重ならない（今の石を写してしまわない）", () => {
    for (const from of Object.keys(LEGACY_SKILL_MAP)) expect(isSkillKey(from), from).toBe(false);
  });

  it("束ねた武器技 298 を全部写す（技の写しの行の数）", () => {
    const toArts = Object.values(LEGACY_SKILL_MAP).filter((to) => to !== null && isArtKey(to));
    expect(toArts.length).toBeGreaterThanOrEqual(WEAPON_ART_COUNT);
  });

  it("旧 武器技の石は読み込みで共通技へ写る", () => {
    expect(migrateSkillKey("swordWhirlwind")).toBe("commonWhirl");
    expect(migrateSkillKey("cannonDetonate")).toBe("commonDetonate");
    expect(migrateSkillKey("commonWhirl"), "今の key はそのまま").toBe("commonWhirl");
  });
});

describe("技の発動", () => {
  it("十字斬りの 2 手目は遅れて当たる", () => {
    const state = artArena("commonCrossCut", "sword");
    const e = tough(state, 24);
    cast(state, ahead(state, 24));
    const afterFirst = e.hp;
    expect(afterFirst, "1 手目").toBeLessThan(BIG_HP);
    run(state, 0.3);
    expect(e.hp, "2 手目").toBeLessThan(afterFirst);
  });

  it("共通技はどの武器種でも撃てる", () => {
    for (const m of ["sword", "cannon", "fan", "spear", "book"] as const) {
      const state = artArena("commonShockwave", m);
      const e = tough(state, 20);
      cast(state, ahead(state, 20));
      run(state, 0.5);
      expect(e.hp, m).toBeLessThan(BIG_HP);
    }
  });

  it("照準地点に落ちる技はカーソルの位置に当たり、自分の周りには当たらない", () => {
    const state = artArena("commonThunderclap");
    const near = tough(state, -20);
    const far = tough(state, 30);
    cast(state, ahead(state, 30));
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
    const state = artArena("commonExecution");
    const e = tough(state, 20);
    e.hp = BIG_HP * 0.1;
    cast(state, ahead(state, 20));
    expect(e.hp).toBeLessThanOrEqual(0);
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
    const state = artArena("commonThousandCuts");
    cast(state, ahead(state, 60));
    expect(state.skills.artQueue?.length ?? 0).toBeGreaterThan(0);
    state.depth += 1;
    updateSkills(state, withInput({}), FIXED_DT);
    expect(state.skills.artQueue).toEqual([]);
  });
});

describe("全技の発動（壊れの検出）", () => {
  it.each([...ART_SKILL_KEYS])("%s: 撃って 2 秒進めても例外・NaN が出ない", (key: ArtSkillKey) => {
    const state = artArena(key, "sword");
    const enemies = [tough(state, 24), tough(state, 50, 20), tough(state, 90, -10)];
    cast(state, ahead(state, key === "commonBackstab" ? 24 : 60));
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
