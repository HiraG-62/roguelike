import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Projectile } from "../core/state";
import { dist } from "../core/vec";
import { ENEMIES, enemyDef } from "../data/enemies";
import { enemyCombat } from "../data/enemyCombat";
import { BOSS, ENEMY_AI } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { damageEnemy } from "./combat";
import { enemyTelegraph, updateEnemies } from "./enemies";
import { makeElite } from "./elites";
import { terrainSpeedMul } from "./enemyTerrain";
import { BASILISK_BITE, HOOK_SLAM, SCRIBE_BLASTS, SCRIBE_BULLETS, SCRIBE_DASH, SCRIBE_RING, forgeEnraged, scribeMoveOf, stolenStatus } from "./enemyWave3";
import { blastEnemies, chipBoneWallsByShots, damageBoneWalls, spawnBoneWall, updateHazards } from "./hazards";
import { gainAttackMana } from "./mana";
import { isStaggered } from "./poise";
import { updateProjectiles } from "./projectiles";
import { applyStatus, hasStatus, updateStatusEffects } from "./statusEffects";
import { placeTerrain, smokeAt, terrainAt } from "./terrain";
import type { TerrainKind } from "../core/terrain";
import { arena, placeEnemy } from "./testHelpers";

/** 敵まわりの更新を n ステップ（状態異常 → 敵 → 弾 → 地面の攻撃） */
function tickEnemies(state: GameState, n = 1): void {
  for (let i = 0; i < n; i++) {
    updateStatusEffects(state, FIXED_DT);
    updateEnemies(state, FIXED_DT);
    updateProjectiles(state, FIXED_DT);
    updateHazards(state, FIXED_DT);
    state.player.invulnTimer = Math.max(0, state.player.invulnTimer - FIXED_DT);
  }
}

function readyEnemy(state: GameState, key: string, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.phase = "chase";
  e.attackCooldown = 0;
  return e;
}

function runWindup(state: GameState, e: Enemy, limit = 600): void {
  for (let i = 0; i < limit && e.phase === "windup"; i++) tickEnemies(state);
}

function kill(state: GameState, e: Enemy): void {
  e.hidden = false;
  damageEnemy(state, e, 999_999, { x: 1, y: 0 }, 0);
  updateEnemies(state, FIXED_DT);
}

function secs(s: number): number {
  return Math.ceil(s / FIXED_DT) + 2;
}

/** 動かず攻撃もしない的（巻き込まれるかを見る） */
function dummy(state: GameState, dx: number, dy = 0): Enemy {
  return placeEnemy(state, "icePillar", dx, dy);
}

function playerShot(state: GameState, x: number, y: number, vx: number, vy: number, damage = 5): Projectile {
  const pr: Projectile = {
    id: state.nextId++,
    owner: "player",
    pos: { x, y },
    vel: { x: vx, y: vy },
    radius: 2,
    damage,
    life: 2,
    color: "#ffffff",
    kind: "ranged",
    hitIds: new Set(),
    pierceLeft: 0,
  };
  state.projectiles.push(pr);
  return pr;
}

const WAVE3_NEW_BEHAVIOR = [
  "toad",
  "oiler",
  "flameEater",
  "windSprite",
  "mineLayer",
  "bellImp",
  "bannerBearer",
  "burrower",
  "dropper",
  "absorber",
  "homunculus",
  "scribeImp",
  "crossGolem",
  "chainWarden",
  "hollow",
];
const WAVE3_RECOLORS = ["iceBoar", "sootBomber", "mossGolem", "swampWisp", "frostToad", "magmaToad", "oilSlime", "stormEye", "emberRat"];
const WAVE3_LAIRS = ["giantToad", "forgeMaster", "turretMaster", "basilisk", "shadowStalker"];

describe("Wave 3 の敵: 全体", () => {
  it("新しい behavior の敵が 12 種以上、再配色種が 8 種以上、部屋主が 4 種以上ある", () => {
    for (const key of [...WAVE3_NEW_BEHAVIOR, ...WAVE3_RECOLORS, ...WAVE3_LAIRS]) expect(enemyDef(key).key).toBe(key);
    expect(WAVE3_NEW_BEHAVIOR.length).toBeGreaterThanOrEqual(12);
    expect(WAVE3_RECOLORS.every((k) => enemyDef(k).recolor !== undefined), "再配色種は元の絵を持つ").toBe(true);
    expect(WAVE3_LAIRS.every((k) => enemyDef(k).lairMaster === true), "部屋主の印").toBe(true);
  });

  it("すべての敵が戦闘パラメータの表に載り、語を持つ", () => {
    for (const def of ENEMIES) {
      const combat = enemyCombat(def.key);
      expect(combat.keywords.produces.length + combat.keywords.consumes.length, def.key).toBeGreaterThan(0);
    }
  });
});

describe("地形を作る敵（敵の地形は敵にも効く）", () => {
  it("泥人形は倒れると影の予告の後に地形（deathTerrain）を残す", () => {
    const state = arena();
    const m = placeEnemy(state, "mudman", 40);
    const kind = enemyDef("mudman").deathTerrain?.kind ?? "none";
    expect(kind, "倒れた跡に地形を残す").not.toBe("none");
    const pos = { ...m.body.pos };
    kill(state, m);
    expect(state.hazards.some((h) => h.kind === "landing"), "予告の影").toBe(true);
    expect(hasGround(state, pos, kind), "予告中はまだ無い").toBe(false);
    tickEnemies(state, secs(ENEMY_AI.terrainSeed.delay));
    expect(hasGround(state, pos, kind)).toBe(true);
  });

  it("毒吐き蛙は着弾点に影を出し、炸裂で毒沼を残す。炸裂は近くの敵にも当たる", () => {
    const state = arena();
    const t = readyEnemy(state, "toad", 100);
    const pillar = dummy(state, 0, 0);
    tickEnemies(state);
    expect(t.phase).toBe("windup");
    expect(state.hazards.some((h) => h.kind === "landing"), "着弾点の影").toBe(true);
    const target = { ...(t.ai?.target ?? state.player.body.pos) };
    expect(terrainAt(state, target.x, target.y), "予告中は無害").toBe("none");
    runWindup(state, t);
    expect(terrainAt(state, target.x, target.y)).toBe("bog");
    expect(pillar.hp, "巻き込まれた敵も削れる").toBeLessThan(pillar.maxHp);
  });

  it("油壺運びは走りながら予告の後に油を撒く", () => {
    const state = arena();
    readyEnemy(state, "oiler", 90);
    tickEnemies(state);
    const seed = state.terrainSeeds?.[0];
    expect(seed?.kind).toBe("oil");
    if (!seed) return;
    const pos = { ...seed.pos };
    tickEnemies(state, secs(ENEMY_AI.terrainSeed.delay));
    expect(terrainAt(state, pos.x, pos.y)).toBe("oil");
  });

  it("火種鼠の自爆は近くの敵も巻き込み、跡に炎を残す", () => {
    const state = arena();
    const r = readyEnemy(state, "emberRat", 20);
    const pillar = dummy(state, 30);
    tickEnemies(state);
    expect(r.phase).toBe("windup");
    const pos = { ...r.body.pos };
    runWindup(state, r);
    expect(r.hp).toBe(0);
    expect(pillar.hp).toBeLessThan(pillar.maxHp);
    expect(terrainAt(state, pos.x, pos.y)).toBe("fire");
  });

  it("霜蛙は氷床、熔岩蛙は溶岩を残す", () => {
    for (const [key, kind] of [
      ["frostToad", "ice"],
      ["magmaToad", "lava"],
    ] as const) {
      const state = arena();
      const t = readyEnemy(state, key, 100);
      tickEnemies(state);
      const target = { ...(t.ai?.target ?? state.player.body.pos) };
      runWindup(state, t);
      expect(terrainAt(state, target.x, target.y), key).toBe(kind);
    }
  });

  it("氷猪の突進の跡は氷床になる", () => {
    const state = arena();
    const b = placeEnemy(state, "iceBoar", 40);
    const start = { ...b.body.pos };
    b.phase = "strike";
    b.phaseTimer = 0.2;
    b.strikeDir = { x: -1, y: 0 };
    updateEnemies(state, FIXED_DT);
    expect(terrainAt(state, start.x, start.y)).toBe("ice");
  });

  it("煤ゴブリンの爆弾は爆ぜた後に地形（bombTerrain）を残す", () => {
    const state = arena();
    const kind = enemyDef("sootBomber").bombTerrain?.kind ?? "none";
    expect(kind, "爆弾の跡に地形を残す").not.toBe("none");
    const s = readyEnemy(state, "sootBomber", 60);
    tickEnemies(state);
    runWindup(state, s);
    const bomb = state.hazards.find((h) => h.kind === "bomb");
    expect(bomb).toBeDefined();
    if (!bomb) return;
    const pos = { ...bomb.pos };
    tickEnemies(state, secs(ENEMY_AI.bomber.fuse));
    expect(hasGround(state, pos, kind)).toBe(true);
  });

  it("苔ゴーレムは被弾すると足元に胞子（毒沼）を出す。間隔の内は出さない", () => {
    const state = arena();
    const g = placeEnemy(state, "mossGolem", 60);
    g.phase = "chase";
    g.attackCooldown = 99;
    damageEnemy(state, g, 3, { x: 1, y: 0 }, 0);
    tickEnemies(state);
    expect(state.terrainSeeds?.filter((s) => s.kind === "bog").length).toBe(1);
    damageEnemy(state, g, 3, { x: 1, y: 0 }, 0);
    tickEnemies(state);
    expect(state.terrainSeeds?.filter((s) => s.kind === "bog").length ?? 0, "間隔の内").toBeLessThanOrEqual(1);
  });

  it("沼鬼火は水たまり・毒沼の上で足が速い", () => {
    const state = arena();
    const w = placeEnemy(state, "swampWisp", 40);
    const def = enemyDef("swampWisp");
    expect(terrainSpeedMul(state, w, def)).toBe(1);
    placeTerrain(state, w.body.pos.x, w.body.pos.y, "water", 8);
    expect(terrainSpeedMul(state, w, def)).toBe(def.terrainSpeed?.mul);
  });

  it("火喰いは燃える床を食べて回復し、燃焼が効かない", () => {
    const state = arena();
    const f = placeEnemy(state, "flameEater", 40);
    f.phase = "chase";
    f.attackCooldown = 99;
    f.hp = Math.round(f.maxHp / 2);
    const before = f.hp;
    placeTerrain(state, f.body.pos.x, f.body.pos.y, "fire", 4);
    tickEnemies(state);
    expect(f.hp).toBeGreaterThan(before);
    expect(terrainAt(state, f.body.pos.x, f.body.pos.y), "食べた炎は消える").not.toBe("fire");
    applyStatus(state, { kind: "enemy", enemy: f }, { kind: "burn", stacks: 1, duration: 3, potency: 4 }, "player");
    expect(hasStatus(f.status, "burn")).toBe(false);
  });
});

describe("支援・鼓舞", () => {
  it("呼び鈴小鬼の鐘で周りの敵が急かされ、攻撃間隔が速く進む", () => {
    const state = arena();
    const bell = readyEnemy(state, "bellImp", 80);
    const ally = placeEnemy(state, "golem", 60, 20);
    ally.phase = "chase";
    ally.attackCooldown = 5;
    tickEnemies(state);
    runWindup(state, bell);
    expect(ally.rally?.kind).toBe("hastened");
    const cd = ally.attackCooldown;
    tickEnemies(state, 10);
    expect(cd - ally.attackCooldown, "倍速で減る").toBeGreaterThan(10 * FIXED_DT * 1.5);
  });

  it("旗持ちは旗を立て、旗の周りの敵は受けるダメージが減る", () => {
    const state = arena();
    const bearer = readyEnemy(state, "bannerBearer", 30);
    tickEnemies(state);
    runWindup(state, bearer);
    const banner = state.enemies.find((e) => e.defKey === "banner");
    expect(banner?.leaderId).toBe(bearer.id);
    if (!banner) return;
    tickEnemies(state, secs(0.7));
    const ally = placeEnemy(state, "golem", banner.body.pos.x - state.player.body.pos.x + 20, banner.body.pos.y - state.player.body.pos.y);
    tickEnemies(state);
    expect(ally.rally?.kind).toBe("warded");
    const hp = ally.hp;
    damageEnemy(state, ally, 50, { x: 1, y: 0 }, 0);
    expect(hp - ally.hp).toBe(Math.round(50 * ENEMY_AI.banner.takenMul));
  });

  it("雷鬼火が倒れると周りが帯電し、帯電した敵が倒れると連鎖雷が隣の敵へ走る", () => {
    const state = arena();
    const wisp = placeEnemy(state, "thunderWisp", 60);
    const charged = placeEnemy(state, "golem", 80);
    const next = placeEnemy(state, "golem", 100);
    kill(state, wisp);
    expect(charged.rally?.kind).toBe("charged");
    kill(state, charged);
    expect(next.hp).toBeLessThan(next.maxHp);
  });
});

describe("潜行する敵（描かれず当たらない → 影の予告 → 飛び出す）", () => {
  it("土潜りは潜っている間は当たらず、飛び出すと姿を晒し、隙の後にまた潜る", () => {
    const state = arena();
    const b = readyEnemy(state, "burrower", 20);
    expect(b.hidden).toBe(true);
    damageEnemy(state, b, 5, { x: 1, y: 0 }, 0);
    expect(b.hp, "潜行中は当たらない").toBe(b.maxHp);
    tickEnemies(state);
    expect(b.phase).toBe("windup");
    runWindup(state, b);
    expect(b.hidden).toBe(false);
    damageEnemy(state, b, 5, { x: 1, y: 0 }, 0);
    expect(b.hp).toBeLessThan(b.maxHp);
    tickEnemies(state, secs(ENEMY_AI.burrower.exposeTime));
    expect(b.hidden, "潜り直す").toBe(true);
  });

  it("天井吊りは頭上に影を出してから落ちてきて、落ちた後は姿を見せる", () => {
    const state = arena();
    const d = readyEnemy(state, "dropper", 30);
    tickEnemies(state);
    expect(d.phase).toBe("windup");
    expect(state.hazards.some((h) => h.kind === "landing")).toBe(true);
    const target = { ...(d.ai?.target ?? state.player.body.pos) };
    runWindup(state, d);
    expect(d.hidden).toBe(false);
    expect(dist(d.body.pos, target)).toBeLessThan(ENEMY_AI.dropper.radius);
  });

  it("影踏みは影に潜ってプレイヤーの背後に影を出し、そこから斬りかかる", () => {
    const state = arena();
    state.player.facing = { x: 1, y: 0 };
    const s = readyEnemy(state, "shadowStalker", 80);
    tickEnemies(state);
    expect(s.phase).toBe("windup");
    expect(s.hidden).toBe(true);
    const target = { ...(s.ai?.target ?? s.body.pos) };
    expect(target.x, "背後（向きの反対側）").toBeLessThan(state.player.body.pos.x);
    const hp = state.player.hp;
    runWindup(state, s);
    expect(s.hidden).toBe(false);
    expect(dist(s.body.pos, target)).toBeLessThan(1);
    expect(state.player.hp).toBeLessThan(hp);
  });
});

describe("プレイヤーの攻撃を読む敵", () => {
  it("吸い込み蟲は近くのプレイヤーの弾を吸い、吸った数だけ吐き返す", () => {
    const state = arena();
    const a = placeEnemy(state, "absorber", 60);
    a.phase = "chase";
    a.attackCooldown = 99;
    const pr = playerShot(state, a.body.pos.x - 20, a.body.pos.y, 100, 0);
    tickEnemies(state);
    expect(pr.life).toBe(0);
    expect(a.ai?.counter).toBe(1);
    a.attackCooldown = 0;
    tickEnemies(state);
    runWindup(state, a);
    expect(state.projectiles.filter((p) => p.owner === "enemy").length).toBe(1);
  });

  it("ホムンクルスはプレイヤーの状態異常を吸い取り、炸裂に乗せて返す（巻き込まれた敵にも付く）", () => {
    const state = arena();
    const h = readyEnemy(state, "homunculus", 100);
    const pillar = dummy(state, 0, 0);
    applyStatus(state, { kind: "player" }, { kind: "poison", stacks: 2, duration: 5, potency: 0 }, "enemy");
    tickEnemies(state);
    expect(h.phase).toBe("windup");
    expect(hasStatus(state.player.status, "poison"), "吸い取られた").toBe(false);
    expect(stolenStatus(h)).toBe("poison");
    runWindup(state, h);
    expect(hasStatus(state.player.status, "poison"), "返された").toBe(true);
    expect(hasStatus(pillar.status, "poison"), "巻き込まれた敵にも").toBe(true);
  });

  it("写本の小悪魔はスキル石の種類を写しの技に読み替える", () => {
    expect(scribeMoveOf("railshot")).toBe(SCRIBE_BULLETS);
    expect(scribeMoveOf("quake")).toBe(SCRIBE_RING);
    expect(scribeMoveOf("mines")).toBe(SCRIBE_BLASTS);
    expect(scribeMoveOf("lunge")).toBe(SCRIBE_DASH);
  });

  it("写本の小悪魔はプレイヤーのスキル発動を見て写し、置く技なら着弾点の影を出す", () => {
    const state = arena();
    const s = readyEnemy(state, "scribeImp", 120);
    s.attackCooldown = 99;
    state.events.push({ kind: "onSkillCast", actor: "player", pos: { ...state.player.body.pos }, depth: 0, source: { kind: "skill", key: "mines" } });
    tickEnemies(state);
    expect(s.ai?.move).toBe(SCRIBE_BLASTS);
    state.events = [];
    s.attackCooldown = 0;
    tickEnemies(state);
    expect(s.phase).toBe("windup");
    expect(state.hazards.filter((h) => h.kind === "landing").length).toBe(ENEMY_AI.scribeImp.blastCount);
  });

  it("虚ろは照準を向けられている間は固まり、背を向けると寄ってくる", () => {
    const state = arena();
    const h = placeEnemy(state, "hollow", 80);
    h.phase = "chase";
    h.attackCooldown = 99;
    state.player.facing = { x: 1, y: 0 };
    const start = { ...h.body.pos };
    tickEnemies(state, 30);
    expect(dist(h.body.pos, start), "固まる").toBeLessThan(0.5);
    state.player.facing = { x: -1, y: 0 };
    tickEnemies(state, 30);
    expect(dist(h.body.pos, state.player.body.pos)).toBeLessThan(dist(start, state.player.body.pos));
  });
});

describe("線と扇の攻撃", () => {
  it("十字ゴーレムは 4 本の線を予告して撃ち、次は斜めの十字になる", () => {
    const state = arena();
    const g = readyEnemy(state, "crossGolem", 50);
    tickEnemies(state);
    expect(enemyTelegraph(g, enemyDef("crossGolem"))?.kind).toBe("cross");
    expect(g.ai?.points?.length).toBe(4);
    runWindup(state, g);
    expect(state.hazards.filter((h) => h.kind === "laser").length).toBe(4);
    expect(g.ai?.move).toBe(1);
  });

  it("風吹きの風はプレイヤーと敵を押し流し、流された敵は壁叩きつけの状態になる", () => {
    const state = arena();
    const w = readyEnemy(state, "windSprite", 60);
    const victim = placeEnemy(state, "golem", 30);
    victim.phase = "chase";
    victim.attackCooldown = 99;
    tickEnemies(state);
    expect(enemyTelegraph(w, enemyDef("windSprite"))?.kind).toBe("cone");
    runWindup(state, w);
    tickEnemies(state, 5);
    expect(state.player.knock.x, "風下（-x）へ").toBeLessThan(0);
    expect(victim.wallSplat).toBe(true);
  });

  it("鎖の番人は鎖が当たると引き寄せ、続けて叩きつけの輪を予告する", () => {
    const state = arena();
    const c = readyEnemy(state, "chainWarden", 100);
    tickEnemies(state);
    expect(enemyTelegraph(c, enemyDef("chainWarden"))?.kind).toBe("laser");
    const hp = state.player.hp;
    runWindup(state, c);
    expect(state.player.hp).toBeLessThan(hp);
    expect(state.player.knock.x, "番人（+x）へ引かれる").toBeGreaterThan(0);
    for (let i = 0; i < 60 && c.phase !== "windup"; i++) tickEnemies(state);
    expect(c.ai?.move).toBe(HOOK_SLAM);
    expect(enemyTelegraph(c, enemyDef("chainWarden"))?.kind).toBe("ring");
  });
});

describe("地雷撒きと地雷", () => {
  it("地雷撒きは逃げながら上限まで地雷を置く", () => {
    const state = arena();
    const l = placeEnemy(state, "mineLayer", 80);
    l.phase = "chase";
    tickEnemies(state, secs(ENEMY_AI.mineLayer.dropInterval * (ENEMY_AI.mineLayer.max + 2)));
    const mines = state.enemies.filter((e) => e.defKey === "enemyMine" && e.leaderId === l.id);
    expect(mines.length).toBe(ENEMY_AI.mineLayer.max);
  });

  it("地雷は敵が踏んでも予告の後に爆ぜ、踏んだ敵を巻き込む", () => {
    const state = arena();
    const l = placeEnemy(state, "mineLayer", 80);
    l.phase = "chase";
    tickEnemies(state);
    const mine = state.enemies.find((e) => e.defKey === "enemyMine");
    expect(mine).toBeDefined();
    if (!mine) return;
    // 撒いた本人を遠ざけてから、別の敵に踏ませる
    l.body.pos = { x: state.player.body.pos.x - 60, y: state.player.body.pos.y };
    const victim = placeEnemy(state, "icePillar", mine.body.pos.x - state.player.body.pos.x + 4, mine.body.pos.y - state.player.body.pos.y);
    tickEnemies(state);
    expect(mine.phase).toBe("windup");
    runWindup(state, mine);
    expect(mine.hp).toBe(0);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });
});

describe("部屋主（Wave 3）", () => {
  it("大蝦蟇は湧くと周りに浅瀬（水たまり）を作る", () => {
    const state = arena();
    const t = placeEnemy(state, "giantToad", 60);
    t.phase = "chase";
    t.attackCooldown = 99;
    tickEnemies(state);
    tickEnemies(state, secs(ENEMY_AI.terrainSeed.delay));
    expect(terrainAt(state, t.body.pos.x, t.body.pos.y)).toBe("water");
  });

  it("炎の鍛冶は金床を連れ、金床を壊されると怯んで怒る", () => {
    const state = arena();
    const f = placeEnemy(state, "forgeMaster", 80);
    f.phase = "chase";
    f.attackCooldown = 99;
    tickEnemies(state);
    const anvil = state.enemies.find((e) => e.defKey === "anvil" && e.leaderId === f.id);
    expect(anvil).toBeDefined();
    if (!anvil) return;
    kill(state, anvil);
    tickEnemies(state);
    expect(isStaggered(f)).toBe(true);
    expect(forgeEnraged(f)).toBe(true);
  });

  it("砲台長は四隅に砲台を置き、砲台が壊れるたびに怯む", () => {
    const state = arena();
    const m = placeEnemy(state, "turretMaster", 60);
    m.phase = "chase";
    m.attackCooldown = 99;
    tickEnemies(state);
    const turrets = state.enemies.filter((e) => e.defKey === "turret" && e.leaderId === m.id);
    expect(turrets.length).toBe(ENEMY_AI.turretMaster.turrets);
    const first = turrets[0];
    if (!first) return;
    kill(state, first);
    tickEnemies(state);
    expect(isStaggered(m)).toBe(true);
  });

  it("石化の蜥蜴の睨みは、扇の中で止まっているプレイヤーにだけ冷気を溜める", () => {
    for (const moving of [false, true]) {
      const state = arena();
      const b = readyEnemy(state, "basilisk", 60);
      if (b.ai) b.ai.move = BASILISK_BITE;
      tickEnemies(state);
      runWindup(state, b);
      for (let i = 0; i < 30; i++) {
        state.player.body.vel = moving ? { x: 0, y: 60 } : { x: 0, y: 0 };
        tickEnemies(state);
      }
      expect(hasStatus(state.player.status, "chill"), moving ? "動いていれば無害" : "止まると冷える").toBe(!moving);
    }
  });
});

describe("シナジーの穴 H6 / H8 / H10", () => {
  /** プレイヤーの 3 マス右に骨の壁を立てる */
  function boneWall(state: GameState) {
    const p = state.player.body.pos;
    const tx = Math.floor(p.x / TILE_SIZE) + 3;
    const ty = Math.floor(p.y / TILE_SIZE);
    const wall = spawnBoneWall(state, tx, ty);
    if (!wall) throw new Error("骨の壁を立てられない");
    return wall;
  }

  it("H6: 骨の壁は耐久を持ち、爆発で削れ、0 になると崩れる", () => {
    const state = arena();
    const wall = boneWall(state);
    expect(wall.hp).toBe(BOSS.boneLord.wallHp);
    blastEnemies(state, wall.pos, 20, 10);
    expect(wall.hp).toBe(BOSS.boneLord.wallHp - 10);
    damageBoneWalls(state, wall.pos, 0, BOSS.boneLord.wallHp);
    updateHazards(state, FIXED_DT);
    expect(state.hazards.includes(wall)).toBe(false);
    expect(state.lockedTiles.has(wall.tile)).toBe(false);
  });

  it("H6: プレイヤーの弾は骨の壁を削る", () => {
    const state = arena();
    const wall = boneWall(state);
    playerShot(state, wall.pos.x - TILE_SIZE, wall.pos.y, TILE_SIZE / FIXED_DT, 0, 7);
    chipBoneWallsByShots(state, FIXED_DT);
    expect(wall.hp).toBe(BOSS.boneLord.wallHp - 7);
  });

  it("H6: 壁叩きつけで骨の壁に飛ばされた敵は、壁ごと崩す", () => {
    const state = arena();
    const wall = boneWall(state);
    const e = placeEnemy(state, "golem", wall.pos.x - state.player.body.pos.x - TILE_SIZE, 0);
    e.phase = "chase";
    e.attackCooldown = 99;
    e.knock = { x: 400, y: 0 };
    e.wallSplat = true;
    for (let i = 0; i < 20; i++) updateEnemies(state, FIXED_DT);
    expect(wall.time).toBeLessThanOrEqual(0);
  });

  it("H8: 沈黙している間は通常攻撃のマナ回収が増える", () => {
    const state = arena();
    state.player.mana = 0;
    const normal = gainAttackMana(state, 2, 1);
    state.player.mana = 0;
    applyStatus(state, { kind: "player" }, { kind: "silence", stacks: 1, duration: 3, potency: 0 }, "enemy");
    const silenced = gainAttackMana(state, 2, 1);
    expect(silenced).toBeCloseTo(normal * ENEMY_AI.silencedAttackManaMul);
  });

  it("H10: 爆裂のエリートの死後の爆発は近くの敵にも当たる", () => {
    const state = arena();
    const e = placeEnemy(state, "golem", 40);
    makeElite(e, "explosive");
    const victim = dummy(state, 60);
    kill(state, e);
    expect(state.hazards.some((h) => h.kind === "bomb" && h.hitsEnemies === true)).toBe(true);
    for (let i = 0; i < 120; i++) updateHazards(state, FIXED_DT);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });
});

/** その地形が (pos) にあるか。煙は床の地形と重なる層なので smokeAt で見る（泥人形 = 泥・煤ゴブリン = 煙の切り替え前後で通る） */
function hasGround(state: GameState, pos: { x: number; y: number }, kind: TerrainKind): boolean {
  if (kind === "smoke") return smokeAt(state, pos.x, pos.y);
  return terrainAt(state, pos.x, pos.y) === kind;
}
