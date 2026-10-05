import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import type { FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { angle, normalize } from "../core/vec";
import { FORM, WEAPON } from "../data/tuning";
import { MOVESETS, type MovesetKey } from "../data/weapons";
import type { PlayerStats } from "../loot/types";
import { BULLETS } from "../loot/bullets";
import { playerMoveset, shotDamage } from "./player";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { TILE_SIZE, Tile, setTile } from "../map/grid";

/**
 * 弾の資源と射撃の形（docs/ideas/gun-bases-review.md 0-2・0-3）。
 * 遠距離の資源: 自分の弾の命中・炸裂では気力も奥義ゲージも増えない / P2 派生の弾は普段の射撃を count 回 /
 * P3 撃つ溜めの最中は連撃の入力窓が減らない / P4 三点の 2・3 本目も同じ射撃 / P7 放出の弾は揺れない
 */

const TOUGH_HP = 1_000_000;
const NO_ATTACK_COOLDOWN = 99;
/** 弾が飛んで当たるまで回す上限のステップ数 */
const MAX_FLIGHT_STEPS = 240;
/** 近接の 1 振りを振り切るまでのステップ数 */
const SWING_STEPS = 30;
/** 自分の弾の先へ的を置く距離（振りの詠唱でも、振りそのものは届かない） */
const SHOT_LEAD = 50;
/** 敵を置く距離（近接の振りが届かない） */
const FAR = 70;
/** 近接の振りが届く距離 */
const NEAR = 16;
const DEG_TO_RAD = Math.PI / 180;
const EPS = 1e-6;

const stepsFor = (sec: number): number => Math.ceil(sec / FIXED_DT);

function press(state: GameState, input: Partial<FrameInput> = {}, n = 1): void {
  for (let i = 0; i < n; i++) step(state, withInput(input), FIXED_DT);
}

/** 自然回復を止め、気力と奥義ゲージを 0 にした稽古場（増えた分だけが命中の分） */
function emptyArena(stats: Partial<PlayerStats>): GameState {
  const state = arena(5, { manaRegen: 0, ...stats });
  const px = Math.floor(state.player.body.pos.x / TILE_SIZE);
  const py = Math.floor(state.player.body.pos.y / TILE_SIZE);
  for (let ty = py - 7; ty <= py + 7; ty++) {
    for (let tx = px - 12; tx <= px + 12; tx++) setTile(state.map, tx, ty, Tile.Floor);
  }
  state.player.mana = 0;
  state.player.energy = 0;
  return state;
}

function tough(state: GameState, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, "golem", dx, dy);
  e.hp = TOUGH_HP;
  e.maxHp = TOUGH_HP;
  e.attackCooldown = NO_ATTACK_COOLDOWN;
  return e;
}

function playerShots(state: GameState): Projectile[] {
  return state.projectiles.filter((pr) => pr.owner === "player" && pr.life > 0);
}

/** 飛行中に消える短命の弾も、発射された瞬間の状態で集める。 */
function collectShots(state: GameState, seconds: number): Projectile[] {
  const shots = new Map<number, Projectile>();
  for (const shot of playerShots(state)) shots.set(shot.id, shot);
  for (let i = 0; i < stepsFor(seconds); i++) {
    press(state);
    for (const shot of playerShots(state)) shots.set(shot.id, shot);
  }
  return [...shots.values()];
}

/** 自分の最初の弾の進む先（弧の輪は折り返す点）に的を置き、当たるまで進める（設置弾は近づいた的で炸裂する） */
function hitWithFirstShot(state: GameState, e: Enemy): void {
  const shot = playerShots(state)[0];
  if (!shot) throw new Error("弾が出ていない");
  const dir = normalize(shot.vel);
  // 弧の輪は折り返す点（カーソル）を必ず通るので、そこに置く
  const arcTo = shot.shot?.arc?.to;
  e.body.pos = arcTo ? { ...arcTo } : { x: shot.pos.x + dir.x * SHOT_LEAD, y: shot.pos.y + dir.y * SHOT_LEAD };
  for (let i = 0; i < MAX_FLIGHT_STEPS && e.hp === TOUGH_HP; i++) press(state);
}

/** 弾の向き（facing からのずれ、度） */
function shotDeg(state: GameState, pr: Projectile): number {
  return (angle(pr.vel) - angle(state.player.facing)) / DEG_TO_RAD;
}

describe("遠距離の資源: 自分の弾が当たっても気力も奥義ゲージも増えない", () => {
  const cases: { name: string; stats: Partial<PlayerStats>; fire: (state: GameState) => void }[] = [
    { name: "銃（短銃の拳銃）", stats: { moveset: "sidearm", bullet: "pistol" }, fire: (s) => press(s, { attackPressed: true, attackHeld: true }) },
    { name: "投擲物（クナイ）", stats: { moveset: "kunai", bullet: "kunai" }, fire: (s) => press(s, { attackPressed: true, attackHeld: true }) },
    { name: "投擲物（戦輪の輪刃）", stats: { moveset: "ringBlades", bullet: "ringBlades" }, fire: (s) => press(s, { attackPressed: true, attackHeld: true }) },
    {
      name: "振りが投げる弾（手裏剣の左）",
      stats: { moveset: "shuriken" },
      fire: (s) => {
        press(s, { attackPressed: true });
        for (let i = 0; i < SWING_STEPS && playerShots(s).length === 0; i++) press(s);
      },
    },
    { name: "右レーンの弾（斧の投擲）", stats: { moveset: "axe" }, fire: (s) => press(s, { shootHeld: true }) },
    {
      name: "杖の魔弾（左の振りの詠唱）",
      stats: { moveset: "wand" },
      fire: (s) => {
        press(s, { attackPressed: true });
        for (let i = 0; i < SWING_STEPS && playerShots(s).length === 0; i++) press(s);
      },
    },
    { name: "設置弾の炸裂（仕掛けの地雷）", stats: { moveset: "trapper", bullet: "mineLauncher" }, fire: (s) => press(s, { attackPressed: true, attackHeld: true }) },
  ];
  for (const c of cases) {
    it(`${c.name}の命中では気力も奥義ゲージも増えない`, () => {
      const state = emptyArena(c.stats);
      const e = tough(state, FAR, 60);
      c.fire(state);
      hitWithFirstShot(state, e);
      expect(e.hp, "弾が当たった").toBeLessThan(TOUGH_HP);
      expect(state.player.mana, "気力").toBe(0);
      expect(state.player.energy, "奥義ゲージ").toBe(0);
    });
  }
});

describe("近接の振りの命中では今までどおり気力と奥義ゲージが増える", () => {
  const cases: { name: string; moveset: MovesetKey; input: Partial<FrameInput> }[] = [
    { name: "剣の左", moveset: "sword", input: { attackPressed: true } },
    // 銃剣は武器のジャンルが ranged でも近接の振りなので戻る（弾の命中かで切る）
    { name: "長銃の銃剣（右）", moveset: "longarm", input: { shootHeld: true } },
  ];
  for (const c of cases) {
    it(`${c.name}の命中で気力と奥義ゲージが増える`, () => {
      const state = emptyArena({ moveset: c.moveset });
      const e = tough(state, NEAR);
      press(state, c.input);
      for (let i = 0; i < SWING_STEPS && e.hp === TOUGH_HP; i++) press(state);
      expect(e.hp, "振りが当たった").toBeLessThan(TOUGH_HP);
      expect(state.player.mana, "気力").toBeGreaterThan(0);
      expect(state.player.energy, "奥義ゲージ").toBeGreaterThan(0);
    });
  }
});

describe("撃つ溜めと連撃の入力窓（P3）", () => {
  it("溜め撃ちの最中は連撃の入力窓が減らず、左→右→左の派生が出る", () => {
    const state = arena(5, { moveset: "longarm", bullet: "matchlock" });
    const a = state.player.attack;
    press(state, { attackPressed: true, attackHeld: true });
    expect(state.player.shotCharging, "左の押しっぱなしで溜めている").toBe(true);
    // 入力窓（chainWindow）より長く溜める
    press(state, { attackHeld: true }, stepsFor(WEAPON.chainWindow * 3));
    expect(a.inputs, "溜めの間も左が列に残る").toEqual(["primary"]);
    expect(a.inputTimer, "溜めの間は窓が減らない").toBeCloseTo(WEAPON.chainWindow, 5);
    const before = playerShots(state).length;
    press(state);
    expect(playerShots(state).length, "離すと撃つ").toBeGreaterThan(before);
    press(state, { shootHeld: true });
    expect(a.lane, "右は銃剣の振り").toBe("secondary");
    for (let i = 0; i < SWING_STEPS && a.phase !== "recover"; i++) press(state);
    press(state, { attackPressed: true });
    for (let i = 0; i < SWING_STEPS && a.branch < 0; i++) press(state);
    expect(playerMoveset(state).branches[a.branch]?.key, "左→右→左の派生").toBe("pierceShot");
  });
});

describe("三点の続き（P4）", () => {
  it("三点の 2・3 本目も放出の倍率を受け、終撃の印は 1 本目だけ", () => {
    const fire = (primed: boolean): Projectile[] => {
      const state = arena(5, { moveset: "longarm", bullet: "tripleCrossbow" });
      if (primed) {
        state.player.morale.value = FORM.rifle.max;
        state.player.morale.primed = true;
      }
      press(state, { attackPressed: true, attackHeld: true });
      return collectShots(state, 0.3);
    };
    const normal = fire(false);
    const released = fire(true);
    expect(released, "三点が 3 本").toHaveLength(3);
    const ratio = (released[0]?.damage ?? 0) / (normal[0]?.damage ?? 1);
    expect(ratio, "1 本目は放出の倍率").toBeGreaterThan(1);
    released.forEach((pr, i) => {
      expect(pr.damage / (normal[i]?.damage ?? 1), `${i + 1} 本目の放出の倍率`).toBeCloseTo(ratio, 5);
      expect(pr.pierceLeft, `${i + 1} 本目の放出の貫通`).toBe(released[0]?.pierceLeft);
    });
    expect(released[0]?.release, "1 本目は放出の弾（終撃）").toBeDefined();
    expect(released.slice(1).map((pr) => pr.release), "2・3 本目は終撃にしない").toEqual([undefined, undefined]);
  });

  it("三点の 2・3 本目も持続の奥義の弾の差し替えを受ける", () => {
    const fire = (sustain: boolean): Projectile[] => {
      const state = arena(5, { moveset: "sidearm", bullet: "burstRifle" });
      if (sustain) {
        state.player.ultimate.active = "sidearm.focus";
        state.player.energy = state.player.maxEnergy;
      }
      press(state, { attackPressed: true, attackHeld: true });
      return collectShots(state, 0.3);
    };
    const normal = fire(false);
    const focused = fire(true);
    expect(focused, "三点が 3 本").toHaveLength(3);
    focused.forEach((pr, i) => {
      expect(pr.pierceLeft - (normal[i]?.pierceLeft ?? 0), `${i + 1} 本目の貫通の上乗せ（集中の pierceAdd）`).toBe(1);
    });
  });
});

describe("放出の弾と揺れ（P7）", () => {
  /** 揺れが最大になる時刻（sin = 1） */
  function swayPeak(): number {
    const sway = BULLETS.smg?.sway;
    if (!sway) throw new Error("短機関銃に揺れが無い");
    return 1 / (4 * sway.freq);
  }

  function firstShotDeg(primed: boolean): number {
    // 揺れる弾（短機関銃）を長銃の型で撃つ。満ちた後の 1 発が放出の弾
    const state = arena(5, { moveset: "longarm", bullet: "smg" });
    if (primed) {
      state.player.morale.primed = true;
      state.player.morale.value = FORM.rifle.max;
    }
    state.time = swayPeak();
    press(state, { attackPressed: true, attackHeld: true });
    const pr = playerShots(state)[0];
    if (!pr) throw new Error("弾が出ていない");
    return shotDeg(state, pr);
  }

  it("放出の弾は揺れを受けず、狙った向きへまっすぐ飛ぶ", () => {
    expect(Math.abs(firstShotDeg(false)), "普段の連射は揺れる").toBeGreaterThan(1);
    expect(Math.abs(firstShotDeg(true)), "放出の弾は揺れない").toBeLessThan(EPS);
  });
});

describe("派生の弾は普段の射撃を count 回撃つ（A 案）", () => {
  /** 左左右（装填撃ち・三連射）。左の押下は撃たずに列へ積み、右で派生を出す。出た弾（派生の分だけ）を返す */
  function branchShots(stats: Partial<PlayerStats>, expectKey: string): { state: GameState; shots: Projectile[] } {
    const state = arena(5, stats);
    press(state, { attackPressed: true });
    press(state, { attackPressed: true });
    state.projectiles.length = 0;
    press(state, { shootHeld: true });
    const a = state.player.attack;
    expect(playerMoveset(state).branches[a.branch]?.key, "左左右の派生").toBe(expectKey);
    return { state, shots: collectShots(state, 0.3) };
  }

  /** 弾を向き（度。小数 1 桁）ごとに数える */
  function countByDeg(state: GameState, shots: readonly Projectile[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const pr of shots) {
      const deg = Math.round(shotDeg(state, pr) * 10) / 10;
      out.set(deg, (out.get(deg) ?? 0) + 1);
    }
    return out;
  }

  it("散弾銃の装填撃ち = 3 粒 × 1 回（粒を捨てない）", () => {
    const { state, shots } = branchShots({ moveset: "cannon", bullet: "shotgun" }, "loadedShot");
    const shotgun = BULLETS.shotgun;
    const branch = MOVESETS.cannon.branches.find((b) => b.key === "loadedShot");
    if (!shotgun || !branch?.shots) throw new Error("散弾銃・装填撃ちが無い");
    expect(shots, "1 + 弾数 0 + 粒 2").toHaveLength(state.stats.projectileCount + shotgun.pellets);
    for (const pr of shots) expect(pr.damage, "1 粒の威力 = 射撃の基礎 × 弾 × 派生の倍率").toBeCloseTo(shotDamage(state.stats) * shotgun.damageMul * branch.shots.damageMul, 5);
  });

  it("三連銃の三連射 = 三点 × 3 回（回の向きごとに三点の続き）", () => {
    const { state, shots } = branchShots({ moveset: "sidearm", bullet: "burstRifle" }, "tripleShot");
    const burst = BULLETS.burstRifle?.burst;
    if (!burst) throw new Error("三連銃に三点が無い");
    expect(shots, "3 回 × 三点").toHaveLength(3 * burst.count);
    const byDeg = countByDeg(state, shots);
    expect(byDeg.size, "3 つの向き").toBe(3);
    for (const [deg, n] of byDeg) expect(n, `${deg} 度の向きに三点`).toBe(burst.count);
  });

  it("拳銃 + 弾数 +1 の三連射 = 2 発 × 3 回", () => {
    const { state, shots } = branchShots({ moveset: "sidearm", bullet: "pistol", projectileCount: 2 }, "tripleShot");
    expect(shots, "3 回 × 2 発").toHaveLength(6);
    // 各回は 2 発を弾の spreadDeg で散らし、回の中心を派生の spreadDeg ずつ扇にずらす
    const pistol = BULLETS.pistol;
    const branch = MOVESETS.sidearm.branches.find((b) => b.key === "tripleShot");
    if (!pistol || branch?.shots?.spreadDeg === undefined) throw new Error("拳銃・三連射が無い");
    const fan = branch.shots.spreadDeg;
    const half = pistol.spreadDeg / 2;
    const expected = [-fan, 0, fan].flatMap((center) => [center - half, center + half]).sort((x, y) => x - y);
    const degs = shots.map((pr) => shotDeg(state, pr)).sort((x, y) => x - y);
    degs.forEach((deg, i) => expect(deg, `${i + 1} 本目の向き`).toBeCloseTo(expected[i] ?? Number.NaN, 3));
  });
});
