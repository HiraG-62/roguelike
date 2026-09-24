import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { createRng } from "../core/rng";
import { BOSS, PLAYER, REAPER, STATUS } from "../data/tuning";
import { DEFAULT_GENERATOR_OPTIONS, generateRoomsAndCorridors } from "../map/generator";
import { TILE_SIZE, Tile, getTile, rectCenter } from "../map/grid";
import { bossEnemy, bossKeyForDepth, isBossDepth, showsBossBar } from "./boss";
import { damageEnemy } from "./combat";
import { enemyTelegraph, updateEnemies } from "./enemies";
import { updateHazards } from "./hazards";
import { applyStagger, isStaggered } from "./poise";
import { applyStatus, findStatus, hasStatus, updateStatusEffects } from "./statusEffects";
import { overlapsWall } from "./physics";
import { GIANT_MOVE_ICICLE } from "./bossFrostGiant";
import { enemyDef, isBossClass } from "../data/enemies";
import { enemyCombat } from "../data/enemyCombat";
import { buildFloor, updateRooms } from "./floor";
import { reaperAppearAfter, updateReaper } from "./reaper";
import type { Enemy, EnemyPhase, GameState } from "../core/state";

function bossFloor(depth: number, seed = 21): GameState {
  const state = createGame(seed);
  state.depth = depth;
  buildFloor(state);
  return state;
}

function stairsTile(state: GameState): number {
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!room) throw new Error("no boss room");
  const c = rectCenter(room.rect);
  return getTile(state.map, c.x, c.y);
}

describe("ボス階", () => {
  it("depth 3 の倍数がボス階で、9 体（スライム王 → 骸骨卿 → 双子の騎士 → 霜の巨人 → 油壺の王 → 群れの母 → 図書館の司書 → 鏡の騎士 → 盗賊王）が回る", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(isBossDepth)).toEqual([false, false, true, false, false, true, true]);
    const order = ["kingSlime", "boneLord", "twinBrother", "frostGiant", "oilKing", "broodMother", "librarian", "mirrorKnight", "thiefKing"];
    order.forEach((key, i) => expect(bossKeyForDepth((i + 1) * 3), `深度 ${(i + 1) * 3}`).toBe(key));
    expect(bossKeyForDepth(30), "9 体で 1 周して戻る").toBe("kingSlime");
  });

  it("generator の lastRoomMin で最後の部屋が大きくなる", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const map = generateRoomsAndCorridors(createRng(seed), {
        ...DEFAULT_GENERATOR_OPTIONS,
        lastRoomMin: { w: BOSS.roomMinW, h: BOSS.roomMinH },
      });
      const last = map.rooms[map.rooms.length - 1];
      expect(last?.w).toBeGreaterThanOrEqual(BOSS.roomMinW);
      expect(last?.h).toBeGreaterThanOrEqual(BOSS.roomMinH);
      expect(map.rooms.length).toBeGreaterThan(1);
    }
  });

  it("ボス部屋には階段がなく、ボスを倒すと階段とレアドロップ 2 個が出る", () => {
    const state = bossFloor(3);
    expect(state.boss).not.toBeNull();
    expect(stairsTile(state)).toBe(Tile.Floor);
    const boss = bossEnemy(state);
    expect(boss?.defKey).toBe("kingSlime");
    if (!boss) return;
    const items = state.floorItems.length;
    damageEnemy(state, boss, boss.hp, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    expect(stairsTile(state)).toBe(Tile.StairsDown);
    expect(state.boss?.defeated).toBe(true);
    const drops = state.floorItems.slice(items);
    expect(drops.filter((fi) => fi.item.rarity === "rare" || fi.item.rarity === "unique").length).toBeGreaterThanOrEqual(
      BOSS.rareDrops,
    );
    expect(state.slowmo).toBeGreaterThan(0);
  });

  it("ボス部屋に入るとロックされ BOSS 表示が出て、増援は湧かない", () => {
    const state = bossFloor(3);
    const b = state.boss;
    const room = state.rooms[b?.roomIndex ?? -1];
    if (!b || !room) throw new Error("no boss");
    const count = state.enemies.length;
    const c = rectCenter(room.rect);
    state.player.body.pos = { x: (c.x - 3) * 16, y: c.y * 16 };
    updateRooms(state, FIXED_DT);
    expect(room.locked).toBe(true);
    expect(b.introTimer).toBeGreaterThan(0);
    expect(state.enemies.length).toBe(count);
  });

  it("King Slime は HP 50% 以下で小スライム splitCount 体に分裂し高速化する", () => {
    const state = bossFloor(3);
    const boss = bossEnemy(state);
    if (!boss) throw new Error("no boss");
    boss.phase = "chase";
    const slimes = state.enemies.filter((e) => e.defKey === "slime" && e.roomIndex === boss.roomIndex).length;
    boss.hp = Math.floor(boss.maxHp * BOSS.kingSlime.phase2Ratio);
    updateEnemies(state, FIXED_DT);
    const after = state.enemies.filter((e) => e.defKey === "slime" && e.roomIndex === boss.roomIndex).length;
    expect(after - slimes).toBe(BOSS.kingSlime.splitCount);
    expect(boss.ai?.stage).toBe(2);
  });

  it("King Slime の第 2 段階の跳躍は、影が出てから素の移動速度で衝撃波の半径の外へ走り出せる長さがある", () => {
    const ks = BOSS.kingSlime;
    expect(ks.phase2JumpTime * PLAYER.speed, "空中時間 × 移動速度 ≥ 衝撃波の半径（ダッシュ無しでも読める）").toBeGreaterThanOrEqual(ks.shockRadius);
  });

  it("King Slime の第 2 段階の跳躍は phase2JumpTime だけ影（着地予告）を出す", () => {
    const state = bossFloor(3);
    const boss = bossEnemy(state);
    if (!boss?.ai) throw new Error("no boss");
    boss.phase = "chase";
    boss.ai.stage = 2;
    boss.attackCooldown = 0;
    const phaseOf = (): EnemyPhase => boss.phase;
    for (let i = 0; i < 600 && phaseOf() !== "strike"; i++) updateEnemies(state, FIXED_DT);
    expect(phaseOf()).toBe("strike");
    const shadow = state.hazards.find((h) => h.kind === "landing");
    expect(shadow?.time, "影の長さは第 2 段階の空中時間").toBeCloseTo(BOSS.kingSlime.phase2JumpTime, 5);
  });

  it("Bone Lord は HP 30% 以下でテレポートを繰り返す", () => {
    const state = bossFloor(6);
    const boss = bossEnemy(state);
    if (!boss) throw new Error("no boss");
    expect(boss.defKey).toBe("boneLord");
    boss.phase = "chase";
    boss.attackCooldown = 999;
    boss.hp = Math.floor(boss.maxHp * BOSS.boneLord.teleportRatio);
    const start = { ...boss.body.pos };
    const steps = Math.ceil((BOSS.boneLord.teleportInterval * 1.5) / FIXED_DT);
    for (let i = 0; i < steps; i++) updateEnemies(state, FIXED_DT);
    expect(boss.ai?.stage).toBe(2);
    const moved = Math.hypot(boss.body.pos.x - start.x, boss.body.pos.y - start.y);
    expect(moved).toBeGreaterThan(20);
  });
});

describe("Reaper", () => {
  it("猶予秒数（部屋数ボーナス込み）で出現し、フロアを移ると消える", () => {
    const state = createGame(4);
    state.floorTime = reaperAppearAfter(state) - 0.1;
    updateReaper(state, FIXED_DT);
    expect(state.reaper).toBeNull();
    for (let i = 0; i < 10; i++) updateReaper(state, FIXED_DT);
    expect(state.reaper).not.toBeNull();
    buildFloor(state);
    expect(state.reaper).toBeNull();
    expect(state.floorTime).toBe(0);
  });

  it("触れると大ダメージ", () => {
    const state = createGame(4);
    state.floorTime = reaperAppearAfter(state);
    updateReaper(state, FIXED_DT);
    const r = state.reaper;
    if (!r) throw new Error("no reaper");
    r.pos = { ...state.player.body.pos };
    const hp = state.player.hp;
    updateReaper(state, FIXED_DT);
    expect(hp - state.player.hp).toBeGreaterThanOrEqual(REAPER.damage * 0.5);
  });
});

// -----------------------------------------------------------------------------
// 双子の騎士 / 霜の巨人（docs/ideas/enemies.md B2 / B7）
// -----------------------------------------------------------------------------

function kill(state: GameState, e: Enemy): void {
  damageEnemy(state, e, 999_999, { x: 1, y: 0 }, 0);
  updateEnemies(state, FIXED_DT);
}

describe("双子の騎士", () => {
  it("兄と妹が並んで出て、ボスの名前は「双子の騎士」", () => {
    const state = bossFloor(9);
    const brother = bossEnemy(state);
    expect(brother?.defKey).toBe("twinBrother");
    expect(state.boss?.name).toBe("双子の騎士");
    const sister = state.enemies.find((e) => e.defKey === "twinSister");
    expect(sister?.leaderId).toBe(brother?.id);
    expect(brother?.leaderId).toBe(sister?.id);
  });

  it("兄を先に倒すとボスの座が妹へ移り、妹を倒して初めて撃破になる", () => {
    const state = bossFloor(9);
    const brother = bossEnemy(state);
    const sister = state.enemies.find((e) => e.defKey === "twinSister");
    if (!brother || !sister) throw new Error("no twins");
    kill(state, brother);
    expect(state.boss?.defeated).toBe(false);
    expect(state.boss?.enemyId).toBe(sister.id);
    expect(stairsTile(state)).toBe(Tile.Floor);
    kill(state, sister);
    expect(state.boss?.defeated).toBe(true);
    expect(stairsTile(state)).toBe(Tile.StairsDown);
  });

  it("相方が倒れると形見を拾って第 2 段階になり、自分の技と相方の技を交互に使う", () => {
    const state = bossFloor(9);
    const brother = bossEnemy(state);
    const sister = state.enemies.find((e) => e.defKey === "twinSister");
    if (!brother || !sister) throw new Error("no twins");
    brother.phase = "chase";
    kill(state, sister);
    updateEnemies(state, FIXED_DT);
    expect(brother.ai?.stage).toBe(2);
    expect(state.boss?.defeated).toBe(false);
    // 兄が弓も使う: 攻撃を回すと敵弾が出る
    state.player.body.pos = { x: brother.body.pos.x + 60, y: brother.body.pos.y };
    for (let i = 0; i < 900 && !state.projectiles.some((p) => p.owner === "enemy"); i++) {
      state.player.hp = state.player.maxHp;
      updateEnemies(state, FIXED_DT);
    }
    expect(state.projectiles.some((p) => p.owner === "enemy"), "形見の弓").toBe(true);
  });

  it("HP が rageRatio を切ると第 3 段階（激昂）になる", () => {
    const state = bossFloor(9);
    const brother = bossEnemy(state);
    const sister = state.enemies.find((e) => e.defKey === "twinSister");
    if (!brother || !sister) throw new Error("no twins");
    brother.phase = "chase";
    kill(state, sister);
    updateEnemies(state, FIXED_DT);
    brother.hp = Math.floor(brother.maxHp * BOSS.twinKnights.rageRatio);
    updateEnemies(state, FIXED_DT);
    expect(brother.ai?.stage).toBe(3);
  });

  it("頭上の HP バー: 妹は兄が健在なら頭上に出し、ボスの座を継いだ後は上部バーだけ", () => {
    const state = bossFloor(9);
    const brother = bossEnemy(state);
    const sister = state.enemies.find((e) => e.defKey === "twinSister");
    if (!brother || !sister) throw new Error("no twins");
    expect(showsBossBar(state, brother)).toBe(true);
    expect(showsBossBar(state, sister), "継ぐ前は頭上のバー").toBe(false);
    kill(state, brother);
    expect(showsBossBar(state, sister), "継いだ後は上部バーだけ").toBe(true);
  });

  it("妹は状態異常の扱いがボスと同じ（麻痺は短く、昇華しない）", () => {
    const state = bossFloor(9);
    const sister = state.enemies.find((e) => e.defKey === "twinSister");
    if (!sister) throw new Error("no sister");
    expect(isBossClass(enemyDef("twinSister"))).toBe(true);
    const target = { kind: "enemy" as const, enemy: sister };
    applyStatus(state, target, { kind: "paralyze", stacks: 1, duration: 5, potency: 0 }, "player");
    expect(findStatus(sister.status, "paralyze")?.time).toBe(STATUS.paralyze.bossDuration);
    applyStatus(state, target, { kind: "poison", stacks: STATUS.poison.maxStacks, duration: 5, potency: 0 }, "player");
    expect(hasStatus(sister.status, "venom"), "猛毒へ昇華しない").toBe(false);
  });

  it("妹は弓を引く予備動作中に怯み値が多く入る（強靭 > 1 が窓）", () => {
    expect(enemyCombat("twinSister").superArmorMul).toBeGreaterThan(1);
  });
});

describe("霜の巨人", () => {
  it("第 2 段階でつららの影を落とし、影の間は無害で、落ちると当たる", () => {
    const state = bossFloor(12);
    const giant = bossEnemy(state);
    if (!giant?.ai) throw new Error("no giant");
    expect(giant.defKey).toBe("frostGiant");
    giant.phase = "chase";
    giant.hp = Math.floor(giant.maxHp * BOSS.frostGiant.phase2Ratio);
    giant.attackCooldown = 99;
    updateEnemies(state, FIXED_DT);
    expect(giant.ai.stage).toBe(2);
    giant.ai.move = GIANT_MOVE_ICICLE;
    giant.attackCooldown = 0;
    state.player.body.pos = { x: giant.body.pos.x + 60, y: giant.body.pos.y };
    updateEnemies(state, FIXED_DT);
    expect(giant.phase).toBe("windup");
    expect(state.hazards.filter((h) => h.kind === "landing").length).toBeGreaterThan(1);
    const hp = state.player.hp;
    // phase は updateEnemies の中で変わるので、読み出しを関数にして型の絞り込みを切る
    const phaseOf = (): EnemyPhase => giant.phase;
    while (phaseOf() === "windup") {
      expect(state.player.hp, "影の間は無害").toBe(hp);
      updateEnemies(state, FIXED_DT);
      updateHazards(state, FIXED_DT);
    }
    expect(state.player.hp, "足元のつららが当たる").toBeLessThan(hp);
  });

  it("第 3 段階で氷柱を立てて氷の鎧をまとい、柱を全部割ると鎧が砕けてダウンする", () => {
    const state = bossFloor(12);
    const giant = bossEnemy(state);
    if (!giant) throw new Error("no giant");
    giant.phase = "chase";
    giant.hp = Math.floor(giant.maxHp * BOSS.frostGiant.phase2Ratio);
    updateEnemies(state, FIXED_DT);
    giant.hp = Math.floor(giant.maxHp * BOSS.frostGiant.phase3Ratio);
    updateEnemies(state, FIXED_DT);
    expect(giant.ai?.stage).toBe(3);
    const pillars = state.enemies.filter((e) => e.defKey === "icePillar" && e.leaderId === giant.id);
    expect(pillars.length).toBe(BOSS.frostGiant.pillarCount);
    const hp = giant.hp;
    damageEnemy(state, giant, 50, { x: 1, y: 0 }, 0);
    expect(giant.hp, "鎧の間は無効").toBe(hp);
    for (const p of pillars) damageEnemy(state, p, 999_999, { x: 1, y: 0 }, 0);
    updateEnemies(state, FIXED_DT);
    updateEnemies(state, FIXED_DT);
    expect(isStaggered(giant), "鎧が砕けてダウン").toBe(true);
    damageEnemy(state, giant, 50, { x: 1, y: 0 }, 0);
    expect(giant.hp).toBeLessThan(hp);
  });

  it("壁際で氷の鎧をまとっても、氷柱は壁に埋まらない（割れない柱で詰まない）", () => {
    const state = bossFloor(12);
    const giant = bossEnemy(state);
    const room = state.rooms[state.boss?.roomIndex ?? -1];
    if (!giant || !room) throw new Error("no giant");
    // 部屋の左上の角に寄せる（4 本のうち 3 本の向きが壁に掛かる）
    giant.body.pos = { x: room.rect.x * TILE_SIZE + giant.body.radius + 1, y: room.rect.y * TILE_SIZE + giant.body.radius + 1 };
    giant.phase = "chase";
    giant.hp = Math.floor(giant.maxHp * BOSS.frostGiant.phase2Ratio);
    updateEnemies(state, FIXED_DT);
    giant.hp = Math.floor(giant.maxHp * BOSS.frostGiant.phase3Ratio);
    updateEnemies(state, FIXED_DT);
    const pillars = state.enemies.filter((e) => e.defKey === "icePillar" && e.leaderId === giant.id);
    expect(pillars.length).toBe(BOSS.frostGiant.pillarCount);
    for (const p of pillars) expect(overlapsWall(state, p.body.pos.x, p.body.pos.y, p.body.radius), `氷柱 ${p.id}`).toBe(false);
  });

  it("つららの予備動作が麻痺で止まっても、影は落ちるまで残る（予告なしで落ちない）", () => {
    const state = bossFloor(12);
    const giant = bossEnemy(state);
    if (!giant?.ai) throw new Error("no giant");
    giant.phase = "chase";
    giant.hp = Math.floor(giant.maxHp * BOSS.frostGiant.phase2Ratio);
    giant.attackCooldown = 99;
    updateEnemies(state, FIXED_DT);
    giant.ai.move = GIANT_MOVE_ICICLE;
    giant.attackCooldown = 0;
    state.player.body.pos = { x: giant.body.pos.x + 60, y: giant.body.pos.y };
    updateEnemies(state, FIXED_DT);
    expect(giant.phase).toBe("windup");
    applyStatus(state, { kind: "enemy", enemy: giant }, { kind: "paralyze", stacks: 1, duration: 5, potency: 0 }, "player");
    expect(hasStatus(giant.status, "paralyze")).toBe(true);
    const phaseOf = (): EnemyPhase => giant.phase;
    for (let i = 0; i < 600 && phaseOf() === "windup"; i++) {
      expect(state.hazards.some((h) => h.kind === "landing"), `${i} ステップ目: 予備動作の間は影がある`).toBe(true);
      updateStatusEffects(state, FIXED_DT);
      updateEnemies(state, FIXED_DT);
      updateHazards(state, FIXED_DT);
    }
    expect(phaseOf(), "最後は落ちる").not.toBe("windup");
    expect(state.hazards.some((h) => h.kind === "landing"), "落ちたら影は消える").toBe(false);
  });

  it("つららの予備動作が怯みで取り消されたら、影も消える（落ちない予告を残さない）", () => {
    const state = bossFloor(12);
    const giant = bossEnemy(state);
    if (!giant?.ai) throw new Error("no giant");
    giant.phase = "chase";
    giant.hp = Math.floor(giant.maxHp * BOSS.frostGiant.phase2Ratio);
    giant.attackCooldown = 99;
    updateEnemies(state, FIXED_DT);
    giant.ai.move = GIANT_MOVE_ICICLE;
    giant.attackCooldown = 0;
    state.player.body.pos = { x: giant.body.pos.x + 60, y: giant.body.pos.y };
    updateEnemies(state, FIXED_DT);
    expect(state.hazards.some((h) => h.kind === "landing")).toBe(true);
    applyStagger(state, giant, 1);
    updateHazards(state, FIXED_DT);
    expect(state.hazards.some((h) => h.kind === "landing")).toBe(false);
  });

  it("叩きつけの予備動作は輪で予告する", () => {
    const state = bossFloor(12);
    const giant = bossEnemy(state);
    if (!giant) throw new Error("no giant");
    expect(enemyTelegraph(giant, enemyDef("frostGiant"))).toEqual({ kind: "ring", radius: BOSS.frostGiant.slamRadius });
  });
});
