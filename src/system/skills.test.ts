import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import type { FrameInput } from "../core/input";
import { codesForAction, mouseButtonCode } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { SKILL } from "../skills/data";
import { stoneFromSeed } from "../skills/generator";
import { createDefaultSkillProfile } from "../skills/persistence";
import type { ModifierKey, SkillKey, SkillStone, VariantRoll } from "../skills/types";
import { updatePlayer } from "./player";
import {
  attachRune,
  beamEnd,
  createSkillRunState,
  dropRune,
  frenzyMul,
  resolveSlot,
  skillLocksDash,
  trackDamageDealt,
  updateSkills,
} from "./skills";
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

function press(state: GameState, slot: 0 | 1, extra: Partial<FrameInput> = {}): void {
  updatePlayer(state, withInput({ skill1Pressed: slot === 0, skill2Pressed: slot === 1, ...extra }), FIXED_DT);
}

describe("入力", () => {
  it("Digit1 / KeyC / マウス戻るがスロット 1、Digit2 / KeyV / マウス進むがスロット 2", () => {
    expect(codesForAction("skill1")).toEqual(expect.arrayContaining(["Digit1", "KeyC", "Mouse3"]));
    expect(codesForAction("skill2")).toEqual(expect.arrayContaining(["Digit2", "KeyV", "Mouse4"]));
    expect(mouseButtonCode(3)).toBe("Mouse3");
    expect(mouseButtonCode(4)).toBe("Mouse4");
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

  it("ダッシュでキャンセルでき、CD は消費済み", () => {
    const state = skillArena([{ key: "whirl" }]);
    press(state, 0);
    expect(state.skills.active?.skillKey).toBe("whirl");
    updatePlayer(state, withInput({ dashPressed: true }), FIXED_DT);
    expect(state.skills.active).toBeNull();
    expect(state.skills.slots[0]?.chargesLeft).toBe(0);
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
    expect(e.phase).toBe("stagger");
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

  it("照準中のダッシュキャンセルで CD を半分返す", () => {
    const state = skillArena([{ key: "railshot" }]);
    press(state, 0);
    const slot = state.skills.slots[0];
    if (!slot) throw new Error("slot");
    const before = slot.cooldownLeft;
    updatePlayer(state, withInput({ dashPressed: true }), FIXED_DT);
    expect(state.skills.active).toBeNull();
    expect(slot.cooldownLeft).toBeLessThan(before * SKILL.railshot.cancelRefund + FIXED_DT);
  });
});

describe("パリィ", () => {
  it("構え中の敵弾を無効化して JUST 扱い、CD が 0 に戻る", () => {
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
    expect(state.skills.slots[0]?.chargesLeft).toBe(1);
    expect(state.skills.slots[0]?.cooldownLeft).toBe(0);
    expect(state.texts.some((t) => t.text === "PARRY!")).toBe(true);
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

describe("チャージと CD", () => {
  it("CD 中は発動できず、CD 経過で回復する", () => {
    const state = skillArena([{ key: "frag" }]);
    press(state, 0);
    expect(state.skills.grenades).toHaveLength(1);
    press(state, 0);
    expect(state.skills.grenades).toHaveLength(1);
    const cd = resolveSlot(state, 0)?.cooldown ?? 0;
    expect(cd).toBeCloseTo(SKILL.frag.cooldown);
    run(state, cd);
    expect(state.skills.slots[0]?.chargesLeft).toBe(1);
  });

  it("多重付きで 3 回連続発動でき、4 回目は失敗。CD 経過で 1 回ずつ回復", () => {
    const state = skillArena([{ key: "frag", links: 1, modifiers: ["multiCharge"] }]);
    // 途中で付いた多重は 1 回ぶん即時、残りは CD で溜まる
    run(state, (resolveSlot(state, 0)?.cooldown ?? 0) * 2 + FIXED_DT);
    expect(state.skills.slots[0]?.chargesLeft).toBe(3);
    for (let i = 0; i < 4; i++) press(state, 0);
    expect(state.skills.slots[0]?.chargesLeft).toBe(0);
    const cd = resolveSlot(state, 0)?.cooldown ?? 0;
    run(state, cd + FIXED_DT);
    expect(state.skills.slots[0]?.chargesLeft).toBe(1);
  });

  it("リンクが多い石ほど CD が長い", () => {
    const state = skillArena([{ key: "whirl", links: 0 }, { key: "whirl", links: 3 }]);
    const a = resolveSlot(state, 0)?.cooldown ?? 0;
    const b = resolveSlot(state, 1)?.cooldown ?? 0;
    expect(b).toBeCloseTo(a * (1 + SKILL.linkCooldownPenalty * 3));
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
