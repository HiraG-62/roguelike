import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { angle, dist, sub } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { ENEMY_AI, ENEMY_TEMPO, JIN, PLAYER, REACTION } from "../data/tuning";
import { behaviorOf } from "./behaviors/registry";
import { damageEnemy } from "./combat";
import { followUpOf, updateEnemies } from "./enemies";
import { playerExposed, reactSlotTarget } from "./enemyReactions";
import { arena, placeEnemy } from "./testHelpers";

const HUGE_HP = 1_000_000;
/** 攻撃を始めない間隔（反応だけを見たいとき） */
const NEVER_ATTACK = 999;
const MELEE = { kind: "melee" } as const;
const EPS = 1e-6;

/** 反応の検証用: 被弾で死なず、攻撃も受けない */
function reactionArena(depth = 1): GameState {
  const state = arena(5);
  state.depth = depth;
  state.player.maxHp = HUGE_HP;
  state.player.hp = HUGE_HP;
  state.player.invulnTimer = 999;
  return state;
}

/** 追跡中で当分攻撃しない敵を置く */
function chaseEnemy(state: GameState, key: string, dx: number, dy = 0): Enemy {
  const e = placeEnemy(state, key, dx, dy);
  e.phase = "chase";
  e.attackCooldown = NEVER_ATTACK;
  e.hp = HUGE_HP;
  e.maxHp = HUGE_HP;
  return e;
}

function tick(state: GameState, n = 1): void {
  for (let i = 0; i < n; i++) {
    state.player.invulnTimer = 999;
    updateEnemies(state, FIXED_DT);
  }
}

function hit(state: GameState, e: Enemy, times: number, opts: Parameters<typeof damageEnemy>[5] = MELEE): void {
  for (let i = 0; i < times; i++) damageEnemy(state, e, 1, { x: 1, y: 0 }, 0, opts);
}

describe("反応ルール: 間合い取り（onStruck）", () => {
  it("前衛は窓の中で 3 回殴られると 0.25 秒離れ、2 回では離れない", () => {
    const state = reactionArena();
    const e = chaseEnemy(state, "slime", 30);
    hit(state, e, REACTION.retreatHits.vanguard - 1);
    expect(e.ai?.retreat ?? 0, "閾値の手前では離れない").toBe(0);
    hit(state, e, 1);
    expect(e.ai?.retreat, "閾値に達したら間合い取り").toBe(REACTION.retreatSec);
    expect(e.ai?.hitCount, "離れたら数え直す").toBe(0);
  });

  it("離れる距離は retreatDist で、敵の速さに依らない（遅い敵も速い敵も同じ）", () => {
    for (const key of ["slime", "skeleton"]) {
      const state = reactionArena();
      const e = chaseEnemy(state, key, 30);
      hit(state, e, REACTION.retreatHits.vanguard);
      const before = dist(e.body.pos, state.player.body.pos);
      tick(state, Math.ceil(REACTION.retreatSec / FIXED_DT) + 2);
      const moved = dist(e.body.pos, state.player.body.pos) - before;
      expect(moved, `${key} は約 ${REACTION.retreatDist}px 離れる`).toBeGreaterThan(REACTION.retreatDist * 0.8);
      expect(moved, `${key} は離れすぎない`).toBeLessThan(REACTION.retreatDist * 1.2);
    }
  });

  it("窓が尽きると数え直す（1 秒空けた 1 発は 1 回目）", () => {
    const state = reactionArena();
    const e = chaseEnemy(state, "slime", 30);
    hit(state, e, REACTION.retreatHits.vanguard - 1);
    tick(state, Math.ceil((REACTION.hitWindowSec + 0.1) / FIXED_DT));
    hit(state, e, 1);
    expect(e.ai?.hitCount, "窓が切れた後は 1 から").toBe(1);
    expect(e.ai?.retreat ?? 0).toBe(0);
  });

  it("役割ごとの回数: 射手・妨害は 1 回、突撃は 2 回、爆発・群れは離れない", () => {
    const shooter = chaseEnemy(reactionArena(), "eye", 60);
    const shooterState = reactionArena();
    const eye = chaseEnemy(shooterState, "eye", 60);
    hit(shooterState, eye, 1);
    expect(eye.ai?.retreat, "射手は 1 発で離れる").toBe(REACTION.retreatSec);
    expect(shooter.ai?.retreat ?? 0).toBe(0);

    const chargeState = reactionArena();
    const boar = chaseEnemy(chargeState, "boar", 60);
    hit(chargeState, boar, 1);
    expect(boar.ai?.retreat ?? 0, "突撃は 1 発ではまだ").toBe(0);
    hit(chargeState, boar, 1);
    expect(boar.ai?.retreat, "突撃は 2 発で離れる").toBe(REACTION.retreatSec);

    const blastState = reactionArena();
    const bomb = chaseEnemy(blastState, "bomber", 60);
    hit(blastState, bomb, 10);
    expect(bomb.ai?.retreat ?? 0, "爆発役は離れない").toBe(0);

    const swarmState = reactionArena();
    const bat = chaseEnemy(swarmState, "bat", 60);
    hit(swarmState, bat, 10);
    expect(bat.ai?.retreat ?? 0, "群れは離れない").toBe(0);
  });

  it("攻撃が確定している間・継続ダメージ・ボス・設置物は間合い取りをしない", () => {
    const strikingState = reactionArena();
    const striking = chaseEnemy(strikingState, "slime", 30);
    striking.phase = "strike";
    hit(strikingState, striking, 5);
    expect(striking.ai?.retreat ?? 0, "攻撃中は離れない").toBe(0);

    const dotState = reactionArena();
    const dot = chaseEnemy(dotState, "slime", 30);
    hit(dotState, dot, 5, { kind: "melee", silent: true });
    hit(dotState, dot, 5, { kind: "proc" });
    expect(dot.ai?.hitCount ?? 0, "継続ダメージ・proc は数えない").toBe(0);

    const bossState = reactionArena();
    const boss = chaseEnemy(bossState, "frostGiant", 60);
    hit(bossState, boss, 10);
    expect(boss.ai?.hitCount ?? 0, "ボスは反応ルールの対象外").toBe(0);

    const turretState = reactionArena();
    const turret = chaseEnemy(turretState, "turret", 60);
    hit(turretState, turret, 10);
    expect(turret.ai?.retreat ?? 0, "動かない敵は離れない").toBe(0);
  });

  it("離れている間は攻撃を始めない", () => {
    const state = reactionArena();
    const e = chaseEnemy(state, "slime", 30);
    e.attackCooldown = 0;
    hit(state, e, REACTION.retreatHits.vanguard);
    tick(state, 3);
    expect(e.phase, "間合い取り中は予備動作に入らない").toBe("chase");
  });
});

describe("反応ルール: 隙を狙う（attackCooldownRate）", () => {
  const slime = enemyDef("slime");

  it("隙の条件: 終撃の硬直・ダッシュの再使用中・受け流しの外し。どれでもなければ隙ではない", () => {
    const state = reactionArena();
    state.player.dashChargesLeft = 1;
    expect(playerExposed(state), "通常時").toBe(false);
    state.player.dashChargesLeft = 0;
    expect(playerExposed(state), "ダッシュの再使用中").toBe(true);
    state.player.dashChargesLeft = 1;
    state.player.parry.recover = 0.3;
    expect(playerExposed(state), "受け流しの外し").toBe(true);
    state.player.parry.recover = 0;
    state.player.attack.phase = "recover";
    state.player.attack.combo = 0;
    expect(playerExposed(state), "1 段目の硬直は隙ではない").toBe(false);
    state.player.attack.combo = PLAYER.melee.length - 1;
    expect(playerExposed(state), "終撃の硬直").toBe(true);
  });

  it("前衛・突撃は隙で時計が 1 + punishBias 倍の速さで進み、射手・群れ・ボスは変わらない", () => {
    const state = reactionArena();
    state.player.dashChargesLeft = 0;
    const rateOf = (key: string): number => {
      const e = chaseEnemy(state, key, 90);
      return behaviorOf(enemyDef(key)).attackCooldownRate(state, e, enemyDef(key));
    };
    expect(rateOf("slime")).toBeCloseTo(1 + REACTION.punishBias, 9);
    expect(rateOf("boar"), "突撃").toBeCloseTo(1 + REACTION.punishBias, 9);
    expect(rateOf("eye"), "射手").toBe(1);
    expect(rateOf("bat"), "群れ").toBe(1);
    expect(rateOf("frostGiant"), "ボス").toBe(1);
    state.player.dashChargesLeft = 1;
    expect(rateOf("slime"), "隙でなければ通常").toBe(1);
  });

  it("隙の間は攻撃間隔の残りがその倍率で縮む", () => {
    const state = reactionArena();
    state.player.dashChargesLeft = 0;
    const e = chaseEnemy(state, "slime", 200);
    e.attackCooldown = 1;
    tick(state);
    expect(1 - e.attackCooldown).toBeCloseTo(FIXED_DT * (1 + REACTION.punishBias), 6);
    state.player.dashChargesLeft = 1;
    const before = e.attackCooldown;
    tick(state);
    expect(before - e.attackCooldown, "隙でなければ dt そのまま").toBeCloseTo(FIXED_DT, 6);
    expect(slime.attackInterval, "前提: 検証の敵は攻撃間隔を持つ").toBeGreaterThan(0);
  });
});

describe("反応ルール: 囲む（slotTarget）", () => {
  /** プレイヤーの右 150px に、少しずつずらして n 体並べる（ほぼ同じ側） */
  function pack(state: GameState, key: string, n: number): Enemy[] {
    return Array.from({ length: n }, (_, i) => chaseEnemy(state, key, 150, (i - (n - 1) / 2) * 12));
  }

  it("仲間が 2 体以上いれば、最小 id の敵は真っ直ぐ、残りは左右逆向きに輪の上の点へ回り込む", () => {
    const state = reactionArena();
    const list = pack(state, "slime", 3);
    const def = enemyDef("slime");
    const player = state.player.body.pos;
    const ring = Math.max(REACTION.slotRadius, def.engageRange + REACTION.slotMargin);
    const [first, second, third] = list;
    if (!first || !second || !third) throw new Error("敵が置かれていない");
    expect(reactSlotTarget(state, first, def), "最小 id の敵は今いる側が持ち場なので真っ直ぐ").toBeUndefined();
    const leads: number[] = [];
    for (const e of [second, third]) {
      const target = reactSlotTarget(state, e, def);
      expect(target, "残りは回り込む").toBeDefined();
      if (!target) continue;
      expect(dist(target, player), "目標は攻撃距離のすぐ外の輪の上").toBeCloseTo(ring, 6);
      const lead = angle(sub(target, player)) - angle(sub(e.body.pos, player));
      leads.push(Math.atan2(Math.sin(lead), Math.cos(lead)));
    }
    expect(leads[0]! * leads[1]!, "2 体は逆向きに回る（挟み撃ち）").toBeLessThan(0);
    expect(Math.abs(leads[0]!), "1 ステップの回り込みは slotLead").toBeCloseTo(REACTION.slotLead, 6);
  });

  it("持ち場の角度に着いた敵は回り込まず真っ直ぐ殴りに行く", () => {
    const state = reactionArena();
    const def = enemyDef("slime");
    const third = (Math.PI * 2) / 3;
    const placed = [0, 1, 2].map((k) => chaseEnemy(state, "slime", Math.cos(k * third) * 150, Math.sin(k * third) * 150));
    for (const e of placed) expect(reactSlotTarget(state, e, def), "3 体が等間隔なら全員が持ち場").toBeUndefined();
  });

  it("仲間が足りない・役割が違う・別の陣・すでに内側・持ち場に着いているときは囲まない", () => {
    const def = enemyDef("slime");
    const two = reactionArena();
    const [a] = pack(two, "slime", 2);
    expect(a && reactSlotTarget(two, a, def), "仲間が 1 体だけなら囲まない").toBeUndefined();

    const charge = reactionArena();
    const boars = pack(charge, "boar", 3);
    expect(boars[0] && reactSlotTarget(charge, boars[0], enemyDef("boar")), "突撃は囲まない").toBeUndefined();

    const jins = reactionArena();
    const mixed = pack(jins, "slime", 3);
    mixed[0]!.jinId = 1;
    mixed[1]!.jinId = 2;
    mixed[2]!.jinId = 3;
    expect(reactSlotTarget(jins, mixed[1]!, def), "陣が違えば仲間に数えない").toBeUndefined();
    mixed[1]!.jinId = 1;
    mixed[2]!.jinId = 1;
    expect(reactSlotTarget(jins, mixed[1]!, def), "同じ陣なら囲む").toBeDefined();

    const far = reactionArena();
    const distant = [chaseEnemy(far, "slime", 150), chaseEnemy(far, "slime", 150, 200), chaseEnemy(far, "slime", 150, -200)];
    expect(reactSlotTarget(far, distant[0]!, def), "slotRange の外の敵は仲間に数えない").toBeUndefined();
  });

  it("3 体が同じ側から来ても、近づくうちにプレイヤーの周りへ散らばる", () => {
    const state = reactionArena();
    const list = pack(state, "slime", 3);
    const player = state.player.body.pos;
    const engage = enemyDef("slime").engageRange;
    const arrivedAt = new Map<number, number>();
    for (let i = 0; i < 400 && arrivedAt.size < list.length; i++) {
      tick(state);
      for (const e of list) {
        if (arrivedAt.has(e.id) || dist(e.body.pos, player) > engage + 4) continue;
        arrivedAt.set(e.id, angle(sub(e.body.pos, player)));
      }
    }
    expect(arrivedAt.size, "3 体とも近づく").toBe(3);
    const spread = Math.max(...arrivedAt.values()) - Math.min(...arrivedAt.values());
    // 囲まなければ 12px ずつずれた 3 体は ±0.1rad 以内に着く
    expect(spread, "囲まなければほぼ同じ角度に着く。回り込んで散らばる").toBeGreaterThan(0.8);
  });

  it("同じ配置なら同じ動き（乱数を使わない）", () => {
    const run = (): string => {
      const state = reactionArena();
      const list = pack(state, "slime", 4);
      tick(state, 120);
      return list.map((e) => `${e.body.pos.x.toFixed(6)},${e.body.pos.y.toFixed(6)}`).join("|");
    };
    expect(run()).toBe(run());
  });
});

describe("動きの語彙: 離脱・後退射撃", () => {
  /** 隙の最初の 1 ステップで、プレイヤーから離れた距離 */
  function retreatedInRecover(key: string): number {
    const state = reactionArena();
    const e = chaseEnemy(state, key, 30);
    e.phase = "recover";
    e.phaseTimer = 1;
    const before = dist(e.body.pos, state.player.body.pos);
    tick(state, 5);
    return dist(e.body.pos, state.player.body.pos) - before;
  }

  it("狼・棘鼠・盗賊は攻撃の後の隙に、蝙蝠より速く離れる。骸骨兵・鬼火は離れない", () => {
    const expected = (key: string, mul: number): number => enemyDef(key).speed * mul * FIXED_DT * 5;
    expect(retreatedInRecover("wolf")).toBeCloseTo(expected("wolf", REACTION.retreatAfterStrike.wolf), 3);
    expect(retreatedInRecover("spikeRat"), "棘鼠は蝙蝠の behavior でも個別の倍率が優先").toBeCloseTo(expected("spikeRat", REACTION.retreatAfterStrike.spikeRat), 3);
    expect(retreatedInRecover("thief")).toBeCloseTo(expected("thief", REACTION.retreatAfterStrike.thief), 3);
    expect(retreatedInRecover("bat"), "蝙蝠は従来の倍率").toBeCloseTo(expected("bat", ENEMY_AI.bat.retreatMul), 3);
    expect(Math.abs(retreatedInRecover("skeleton"))).toBeLessThan(EPS);
    expect(Math.abs(retreatedInRecover("wisp")), "鬼火は蝙蝠と違い離れない").toBeLessThan(EPS);
  });

  it("射手は予備動作の間に後ろへ下がる。光線眼は下がらない", () => {
    expect(behaviorOf(enemyDef("eye")).windupMoveMul).toBeCloseTo(-REACTION.shooterBackstepMul, 9);
    expect(behaviorOf(enemyDef("laserEye")).windupMoveMul, "レーザーは据え置き").toBe(0);

    const state = reactionArena();
    const eye = chaseEnemy(state, "eye", 100);
    eye.phase = "windup";
    eye.phaseTimer = 0.5;
    eye.windupTotal = 0.5;
    const before = dist(eye.body.pos, state.player.body.pos);
    tick(state, 10);
    const moved = dist(eye.body.pos, state.player.body.pos) - before;
    expect(moved, "予備動作の間に離れる").toBeCloseTo(enemyDef("eye").speed * REACTION.shooterBackstepMul * FIXED_DT * 10, 3);

    const laser = chaseEnemy(state, "laserEye", -100);
    laser.phase = "windup";
    laser.phaseTimer = 0.5;
    laser.windupTotal = 0.5;
    const laserBefore = dist(laser.body.pos, state.player.body.pos);
    tick(state, 10);
    expect(dist(laser.body.pos, state.player.body.pos), "光線眼は動かない").toBeCloseTo(laserBefore, 6);
  });

  it("骸骨兵は深度 5 から 2 連撃（章で覚える段。2 撃目の予備動作は 1 撃目の半分以上）", () => {
    expect(followUpOf("skeleton", 4), "深度 4 はまだ覚えていない").toBeUndefined();
    const f = followUpOf("skeleton", 5);
    expect(f?.count).toBe(1);
    expect(f?.windup ?? 0, "2 撃目も読める長さ").toBeGreaterThanOrEqual(enemyDef("skeleton").windup / 2);
  });
});

describe("予告の見やすさの上限（telegraphCap）", () => {
  /** 予備動作に入って elapsed 秒の敵を置く */
  function windingUp(state: GameState, key: string, dx: number, dy: number, elapsed: number): Enemy {
    const e = placeEnemy(state, key, dx, dy);
    e.hp = HUGE_HP;
    e.maxHp = HUGE_HP;
    e.phase = "windup";
    e.windupTotal = 0.6;
    e.phaseTimer = e.windupTotal - elapsed;
    return e;
  }

  it("予告が出たばかりの敵が telegraphCap 体いれば、新しい予備動作は telegraphWindow 待つ", () => {
    const state = reactionArena();
    for (let i = 0; i < ENEMY_TEMPO.telegraphCap; i++) windingUp(state, "slime", 60, i * 12 - 12, 0.05);
    const next = placeEnemy(state, "slime", -30, 0);
    next.phase = "chase";
    next.attackCooldown = 0;
    tick(state);
    expect(next.phase, "上限に達しているので予備動作に入らない").toBe("chase");
    expect(next.attackCooldown, "次の窓まで待つ").toBeGreaterThan(0);
    expect(next.attackCooldown).toBeLessThanOrEqual(ENEMY_TEMPO.telegraphWindow);
  });

  it("窓を過ぎた予備動作・遠い敵・ボスは数えない（それぞれ 1 体でも入れる）", () => {
    const state = reactionArena();
    windingUp(state, "slime", 60, -12, ENEMY_TEMPO.telegraphWindow + 0.05);
    windingUp(state, "slime", ENEMY_TEMPO.telegraphRange + 100, 0, 0.05);
    windingUp(state, "frostGiant", 80, 20, 0.05);
    const next = placeEnemy(state, "slime", -30, 0);
    next.phase = "chase";
    next.attackCooldown = 0;
    tick(state);
    expect(next.phase, "数えるものが無いので入れる").toBe("windup");
  });

  it("上限未満なら予備動作に入る", () => {
    const state = reactionArena();
    for (let i = 0; i < ENEMY_TEMPO.telegraphCap - 1; i++) windingUp(state, "slime", 60, i * 12 - 12, 0.05);
    const next = placeEnemy(state, "slime", -30, 0);
    next.phase = "chase";
    next.attackCooldown = 0;
    tick(state);
    expect(next.phase).toBe("windup");
  });
});

describe("格「猛」の接触ダメージ（JIN.strong.damageMul）", () => {
  /** 攻撃中の敵が接触して受けたダメージ */
  function contactLoss(strong: boolean): number {
    const state = arena(5);
    state.player.maxHp = HUGE_HP;
    state.player.hp = HUGE_HP;
    state.player.invulnTimer = 0;
    const e = placeEnemy(state, "slime", 8);
    e.phase = "strike";
    e.phaseTimer = 0.2;
    e.strikeDir = { x: -1, y: 0 };
    if (strong) e.grade = "strong";
    updateEnemies(state, FIXED_DT);
    return HUGE_HP - state.player.hp;
  }

  it("猛は並より接触ダメージが重く、倍率は damageMul", () => {
    const normal = contactLoss(false);
    const strong = contactLoss(true);
    expect(normal, "前提: 並の接触は当たる").toBeGreaterThan(0);
    expect(strong, "猛は並より重い").toBeGreaterThan(normal);
    // 並の接触（深度の曲線と全体の倍率を掛けた後、丸める前）に猛の倍率を掛けて丸める。並も丸めた値なので 1 の差は丸めの違い
    expect(Math.abs(strong - normal * JIN.strong.damageMul)).toBeLessThanOrEqual(1);
  });
});
