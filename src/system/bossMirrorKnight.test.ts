import { describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, EnemyPhase, GameState, Projectile } from "../core/state";
import { BOSS } from "../data/tuning";
import { TILE_SIZE, rectCenterPx } from "../map/grid";
import { ART_SKILL_KEYS } from "../skills/arts/keys";
import { ART_DEFS } from "../skills/arts";
import type { ArtActKind } from "../skills/arts/types";
import type { SkillKey } from "../skills/types";
import { bossEnemy, bossTakenMul } from "./boss";
import { BOSS_THREATS } from "./bossKit";
import {
  MIRROR_BASH,
  MIRROR_COPY,
  MIRROR_LUNGE,
  MIRROR_WAVE,
  copiedStatuses,
  mirrorCopyForm,
  mirrorKnightTelegraph,
} from "./bossMirrorKnight";
import { damageEnemy } from "./combat";
import { deflectProjectile } from "./elites";
import { updateEnemies } from "./enemies";
import { findFreeSpot } from "./enemyTraits";
import { buildFloor } from "./floor";
import { updateHazards } from "./hazards";
import { isStaggered } from "./poise";
import { removeStatus, statusTimeLeft, updateStatusEffects } from "./statusEffects";

const HUGE_HP = 1_000_000;
const MAX_STEPS = 1200;
const MK = BOSS.mirrorKnight;
const MIRROR_KNIGHT_DEPTH = BOSS.interval * 4;
const NEAR_DX = -30;
/** 遠い間合い（farDist を超える）にするための左右のずれ */
const FAR_HALF_GAP = 95;
/** 写し身が戻るのを見届けるのに足りる秒 */
const REFORM_WAIT = MK.imageReform + 2;

/** 鏡の騎士の階を作り、部屋を封鎖してプレイヤーを騎士の横（dx）に置く */
function knightFloor(dx = -70, seed = 21): { state: GameState; boss: Enemy } {
  const state = createGame(seed);
  state.depth = MIRROR_KNIGHT_DEPTH;
  buildFloor(state);
  const boss = bossEnemy(state);
  const room = state.rooms[state.boss?.roomIndex ?? -1];
  if (!boss || !room || boss.defKey !== "mirrorKnight") throw new Error("no mirror knight");
  room.locked = true;
  state.player.maxHp = HUGE_HP;
  state.player.hp = HUGE_HP;
  placePlayer(state, boss, dx);
  return { state, boss };
}

/** 騎士を部屋の右、プレイヤーを左に置いて遠い間合いにする */
function farApart(state: GameState, boss: Enemy): void {
  const room = state.rooms[boss.roomIndex];
  if (!room) throw new Error("no room");
  const c = rectCenterPx(room.rect);
  boss.body.pos = { x: c.x + FAR_HALF_GAP, y: c.y };
  state.player.body.pos = { x: c.x - FAR_HALF_GAP, y: c.y };
}

function placePlayer(state: GameState, boss: Enemy, dx: number): void {
  const want = { x: boss.body.pos.x + dx, y: boss.body.pos.y };
  state.player.body.pos = findFreeSpot(state, want, state.player.body.radius, 80) ?? want;
}

function tick(state: GameState, n = 1): void {
  for (let i = 0; i < n; i++) {
    updateStatusEffects(state, FIXED_DT);
    updateEnemies(state, FIXED_DT);
    updateHazards(state, FIXED_DT);
    state.player.invulnTimer = 0;
  }
}

/** 代入で型が絞られた後も読み直せるよう関数にする */
function phaseOf(e: Enemy): EnemyPhase {
  return e.phase;
}

function tickUntil(state: GameState, done: () => boolean): void {
  for (let i = 0; i < MAX_STEPS && !done(); i++) tick(state);
}

/** 第 2 段階へ（HP で） */
function toCopyStage(state: GameState, boss: Enemy): void {
  boss.phase = "chase";
  boss.attackCooldown = 999;
  boss.hp = Math.floor(boss.maxHp * MK.phase2Ratio);
  tick(state);
}

/** 第 3 段階へ（HP で）。攻撃は止めておく */
function toImagesStage(state: GameState, boss: Enemy): void {
  toCopyStage(state, boss);
  boss.hp = Math.floor(boss.maxHp * MK.phase3Ratio);
  tick(state);
}

function setMove(boss: Enemy, move: number): void {
  if (boss.ai) boss.ai.move = move;
}

function imagesOf(state: GameState, boss: Enemy): Enemy[] {
  return state.enemies.filter((e) => e.hp > 0 && e.defKey === "mirrorImage" && e.leaderId === boss.id);
}

function panesOf(state: GameState, boss: Enemy): Enemy[] {
  return state.enemies.filter((e) => e.hp > 0 && e.defKey === "mirrorPane" && e.leaderId === boss.id);
}

function killAll(state: GameState, list: readonly Enemy[]): void {
  for (const e of list) damageEnemy(state, e, 999_999, { x: 1, y: 0 }, 0);
}

function castArt(state: GameState, key: SkillKey): void {
  state.skills.lastCast = { skillKey: key, slot: 0, at: 0, pos: { x: 0, y: 0 }, hitIds: new Set<number>() };
}

function artKeyOfKind(kind: ArtActKind): SkillKey {
  const key = ART_SKILL_KEYS.find((k) => ART_DEFS[k].acts[0]?.kind === kind);
  if (!key) throw new Error(`行為 ${kind} で始まる技が無い`);
  return key;
}

/** 突進を左の壁へ向けて激突させ、ダウンさせてから起こす（1 回分）。playerNear なら騎士の背後（右）の近くにプレイヤーを置く */
function slamIntoWall(state: GameState, boss: Enemy, playerNear = false): void {
  const room = state.rooms[boss.roomIndex];
  if (!room) throw new Error("no room");
  const c = rectCenterPx(room.rect);
  boss.body.pos = { x: room.rect.x * TILE_SIZE + boss.body.radius + 1, y: c.y };
  state.player.body.pos = { x: playerNear ? boss.body.pos.x + 30 : c.x + 120, y: c.y };
  boss.strikeDir = { x: -1, y: 0 };
  boss.facing = { x: -1, y: 0 };
  boss.phase = "strike";
  boss.phaseTimer = MK.lungeTime;
  setMove(boss, MIRROR_LUNGE);
  tickUntil(state, () => isStaggered(boss));
  expect(isStaggered(boss), "壁に激突してダウン").toBe(true);
  removeStatus(state, { kind: "enemy", enemy: boss }, "stagger");
}

describe("鏡の騎士: 共通", () => {
  it("正面から来た弾を跳ね返し、背後からの弾は通す", () => {
    const { state, boss } = knightFloor();
    boss.facing = { x: -1, y: 0 };
    const shot = (fromFront: boolean): Projectile => {
      const side = fromFront ? 1 : -1;
      return {
        id: state.nextId++,
        owner: "player",
        pos: { x: boss.body.pos.x + boss.facing.x * 20 * side, y: boss.body.pos.y },
        vel: { x: -boss.facing.x * 200 * side, y: 0 },
        radius: 2,
        damage: 5,
        life: 1,
        color: "#ffffff",
        kind: "ranged",
        hitIds: new Set(),
        pierceLeft: 0,
      };
    };
    const front = shot(true);
    expect(deflectProjectile(state, front, boss)).toBe(true);
    expect(front.owner).toBe("enemy");
    expect(deflectProjectile(state, shot(false), boss)).toBe(false);
  });

  it("写す状態異常はプレイヤーの装備の付与（無ければ出血）", () => {
    const state = createGame(3);
    expect(copiedStatuses(state)).toEqual(["bleed"]);
    state.stats = {
      ...state.stats,
      statusProcs: [
        { kind: "burn", chance: 0.2, stacks: 1, duration: 2, potency: 3, on: "any" },
        { kind: "burn", chance: 0.2, stacks: 1, duration: 2, potency: 3, on: "melee" },
        { kind: "chill", chance: 0.2, stacks: 1, duration: 2, potency: 0, on: "any" },
      ],
    };
    expect(copiedStatuses(state)).toEqual(["burn", "chill"]);
  });

  it("危ない間合いの表: 第 1 段階は遠い、第 2 段階は近い、第 3 段階は動く", () => {
    expect(BOSS_THREATS.mirrorKnight).toEqual(["far", "near", "moving"]);
  });
});

describe("鏡の騎士: 第 1 段階（盾）", () => {
  it("近いと盾打ち（扇の予告）、遠いと突進", () => {
    const near = knightFloor(NEAR_DX);
    near.boss.phase = "recover";
    near.boss.phaseTimer = 0;
    tick(near.state);
    expect(near.boss.ai?.move).toBe(MIRROR_BASH);
    near.boss.attackCooldown = 0;
    tickUntil(near.state, () => phaseOf(near.boss) === "windup");
    expect(mirrorKnightTelegraph(near.boss)).toEqual({ kind: "cone", range: MK.bashRange, halfDeg: MK.bashHalfDeg });

    const far = knightFloor();
    farApart(far.state, far.boss);
    far.boss.phase = "recover";
    far.boss.phaseTimer = 0;
    tick(far.state);
    expect(far.boss.ai?.move).toBe(MIRROR_LUNGE);
  });

  it("盾打ちは扇の中にいれば当たり、予備動作の間に外へ出れば当たらない", () => {
    const hit = knightFloor(NEAR_DX);
    setMove(hit.boss, MIRROR_BASH);
    hit.boss.phase = "chase";
    hit.boss.attackCooldown = 0;
    const hp = hit.state.player.hp;
    tickUntil(hit.state, () => phaseOf(hit.boss) === "strike");
    expect(hit.state.player.hp, "扇の中は当たる").toBeLessThan(hp);

    const miss = knightFloor(NEAR_DX);
    setMove(miss.boss, MIRROR_BASH);
    miss.boss.phase = "chase";
    miss.boss.attackCooldown = 0;
    tickUntil(miss.state, () => phaseOf(miss.boss) === "windup");
    // 狙いは予備動作の始まりに固定される。反対側へ回り込めば外れる
    miss.state.player.body.pos = { x: miss.boss.body.pos.x - NEAR_DX, y: miss.boss.body.pos.y };
    const missHp = miss.state.player.hp;
    tickUntil(miss.state, () => phaseOf(miss.boss) === "strike");
    expect(miss.state.player.hp, "扇の外は当たらない").toBe(missHp);
  });

  it("壁激突が slamsToCrack 回で HP に関わらず第 2 段階へ進む（盾割れ）", () => {
    const { state, boss } = knightFloor();
    boss.phase = "chase";
    boss.attackCooldown = 999;
    for (let i = 0; i < MK.slamsToCrack; i++) {
      expect(boss.ai?.stage, `${i} 回目まではまだ第 1 段階`).toBe(1);
      slamIntoWall(state, boss);
      boss.phase = "chase";
      boss.attackCooldown = 999;
    }
    expect(state.boss?.selfDowns, "激突はダウンとして数える").toBe(MK.slamsToCrack);
    expect(state.texts.some((t) => t.text === "盾割れ")).toBe(true);
    tick(state);
    expect(boss.hp, "HP は削れていない").toBe(boss.maxHp);
    expect(boss.ai?.stage).toBe(2);
  });

  it("壁激突の後は同じ技を繰り返さず、読みで選び直す", () => {
    const { state, boss } = knightFloor();
    boss.phase = "chase";
    boss.attackCooldown = 999;
    slamIntoWall(state, boss, true);
    expect(boss.ai?.move, "近くにいるなら突進の繰り返しでなく盾打ち").toBe(MIRROR_BASH);
  });
});

describe("鏡の騎士: 第 2 段階（模写）", () => {
  it("2 回に 1 回だけ模写を選び、続けて模写しない", () => {
    const { state, boss } = knightFloor();
    farApart(state, boss);
    toCopyStage(state, boss);
    const picked: number[] = [];
    for (let i = 0; i < 8; i++) {
      boss.phase = "recover";
      boss.phaseTimer = 0;
      tick(state);
      picked.push(boss.ai?.move ?? -1);
    }
    const copies = picked.filter((m) => m === MIRROR_COPY).length;
    expect(copies, "半分").toBe(4);
    for (let i = 1; i < picked.length; i++) {
      expect(picked[i] === MIRROR_COPY && picked[i - 1] === MIRROR_COPY, "模写が続かない").toBe(false);
    }
    expect(picked.every((m) => m === MIRROR_COPY || m === MIRROR_WAVE), "遠いので他は剣の波").toBe(true);
  });

  it("近いと盾打ち、遠いと剣の波（模写の番でないとき）", () => {
    for (const [far, want] of [
      [false, MIRROR_BASH],
      [true, MIRROR_WAVE],
    ] as const) {
      const { state, boss } = knightFloor(NEAR_DX);
      if (far) farApart(state, boss);
      toCopyStage(state, boss);
      const picked = new Set<number>();
      for (let i = 0; i < 4; i++) {
        boss.phase = "recover";
        boss.phaseTimer = 0;
        tick(state);
        picked.add(boss.ai?.move ?? -1);
      }
      expect(picked.has(want), `${far ? "遠い" : "近い"}ときは ${want} を選ぶ`).toBe(true);
    }
  });

  it("模写は直前に撃ったスキルの最初の行為の形（輪・線・扇・突進）を写し、無ければ扇", () => {
    const { state } = knightFloor();
    expect(mirrorCopyForm(state), "撃っていなければ扇").toBe("fan");
    const cases: readonly (readonly [ArtActKind, string])[] = [
      ["ring", "ring"],
      ["line", "line"],
      ["arc", "fan"],
      ["dash", "lunge"],
    ];
    for (const [kind, form] of cases) {
      castArt(state, artKeyOfKind(kind));
      expect(mirrorCopyForm(state), `${kind} は ${form}`).toBe(form);
    }
    castArt(state, "wraithForm");
    expect(mirrorCopyForm(state), "技でないスキルは扇").toBe("fan");
  });

  it("模写の形ごとの予告と効果（輪 = 衝撃波、線 = 光線、扇 = 弾、突進 = 移動）", () => {
    const cases: readonly (readonly [ArtActKind, string])[] = [
      ["ring", "ring"],
      ["line", "laser"],
      ["arc", "cone"],
      ["dash", "line"],
    ];
    for (const [kind, teleKind] of cases) {
      const { state, boss } = knightFloor(-90);
      toCopyStage(state, boss);
      castArt(state, artKeyOfKind(kind));
      const ai = boss.ai;
      if (!ai) throw new Error("no ai");
      ai.move = MIRROR_COPY;
      boss.phase = "chase";
      boss.attackCooldown = 0;
      tickUntil(state, () => phaseOf(boss) === "windup");
      expect(mirrorKnightTelegraph(boss)?.kind, `${kind} の予告`).toBe(teleKind);
      const pos = { ...boss.body.pos };
      tickUntil(state, () => phaseOf(boss) === "strike");
      tick(state, 2);
      if (kind === "ring") expect(state.hazards.some((h) => h.kind === "shockwave" && h.radius === MK.copyRingRadius)).toBe(true);
      if (kind === "line") expect(state.hazards.some((h) => h.kind === "laser" && h.sourceId === boss.id)).toBe(true);
      if (kind === "arc") expect(state.projectiles.filter((p) => p.owner === "enemy").length).toBe(MK.waveCount);
      if (kind === "dash") expect(boss.body.pos, "突進で動いた").not.toEqual(pos);
    }
  });

  it("模写の後は copyRecoil 秒のダウン（反動）で、ダウンに数える", () => {
    const { state, boss } = knightFloor(-90);
    toCopyStage(state, boss);
    castArt(state, artKeyOfKind("ring"));
    const ai = boss.ai;
    if (!ai) throw new Error("no ai");
    ai.move = MIRROR_COPY;
    // 本番では COPY_EVERY 回目の選びで模写になる。その並びに合わせる
    ai.counter = 2;
    boss.phase = "chase";
    boss.attackCooldown = 0;
    tickUntil(state, () => isStaggered(boss));
    expect(isStaggered(boss)).toBe(true);
    expect(statusTimeLeft(boss.status, "stagger")).toBeGreaterThan(MK.copyRecoil - 0.2);
    expect(statusTimeLeft(boss.status, "stagger")).toBeLessThanOrEqual(MK.copyRecoil);
    expect(state.texts.some((t) => t.text === "反動")).toBe(true);
    expect(state.boss?.selfDowns).toBe(1);
    expect(ai.move, "同じ模写を繰り返さない").not.toBe(MIRROR_COPY);
  });
});

describe("鏡の騎士: 第 3 段階（写し身と姿見）", () => {
  it("第 3 段階の始まりに姿見が panes 枚、中央から左右 paneOffset に立ち、写し身が守る", () => {
    const { state, boss } = knightFloor();
    toImagesStage(state, boss);
    expect(boss.ai?.stage).toBe(3);
    const panes = panesOf(state, boss);
    expect(panes.length).toBe(MK.panes);
    const room = state.rooms[boss.roomIndex];
    if (!room) throw new Error("no room");
    const c = rectCenterPx(room.rect);
    const offsets = panes.map((p) => Math.abs(p.body.pos.x - c.x)).sort((a, b) => a - b);
    for (const off of offsets) expect(off, "中央から paneOffset 前後（壁を避けて動くことはある）").toBeLessThanOrEqual(MK.paneOffset + TILE_SIZE);
    expect(imagesOf(state, boss).length).toBe(MK.images);
    expect(bossTakenMul(state, boss)).toBe(MK.imageGuardMul);
    killAll(state, imagesOf(state, boss));
    tick(state);
    expect(bossTakenMul(state, boss), "写し身がいなければ守られない").toBe(1);
  });

  it("姿見が残っている間は、倒した写し身が imageReform 秒後に戻る", () => {
    const { state, boss } = knightFloor();
    toImagesStage(state, boss);
    killAll(state, imagesOf(state, boss));
    tick(state, Math.floor((MK.imageReform - 1) / FIXED_DT));
    expect(imagesOf(state, boss).length, "戻る前").toBe(0);
    tick(state, Math.ceil((REFORM_WAIT - MK.imageReform + 1) / FIXED_DT));
    expect(imagesOf(state, boss).length, "戻った").toBeGreaterThan(0);
    tick(state, Math.ceil((REFORM_WAIT * MK.images) / FIXED_DT));
    expect(imagesOf(state, boss).length, "定数を超えて増えない").toBe(MK.images);
  });

  it("姿見を割ると騎士が paneDown 秒ダウンし（鏡割れ）、全部割ると写し身は戻らない", () => {
    const { state, boss } = knightFloor();
    toImagesStage(state, boss);
    const panes = panesOf(state, boss);
    const first = panes[0];
    if (!first) throw new Error("no pane");
    damageEnemy(state, first, 999_999, { x: 1, y: 0 }, 0);
    tick(state);
    expect(isStaggered(boss), "姿見を割るとダウン").toBe(true);
    expect(statusTimeLeft(boss.status, "stagger")).toBeGreaterThan(MK.paneDown - 0.2);
    expect(state.texts.some((t) => t.text === "鏡割れ")).toBe(true);
    expect(state.boss?.selfDowns).toBe(1);

    killAll(state, panesOf(state, boss));
    killAll(state, imagesOf(state, boss));
    removeStatus(state, { kind: "enemy", enemy: boss }, "stagger");
    boss.attackCooldown = 999;
    tick(state, Math.ceil((REFORM_WAIT * 2) / FIXED_DT));
    expect(panesOf(state, boss).length).toBe(0);
    expect(imagesOf(state, boss).length, "姿見が無ければ戻らない").toBe(0);
  });

  it("近いと盾打ちの後に突進が続く（連撃の 2 段目は最初からコミット）", () => {
    const { state, boss } = knightFloor(NEAR_DX);
    toImagesStage(state, boss);
    killAll(state, panesOf(state, boss));
    killAll(state, imagesOf(state, boss));
    tick(state);
    removeStatus(state, { kind: "enemy", enemy: boss }, "stagger");
    const ai = boss.ai;
    if (!ai) throw new Error("no ai");
    placePlayer(state, boss, NEAR_DX);
    ai.move = MIRROR_BASH;
    boss.phase = "chase";
    boss.attackCooldown = 0;
    tickUntil(state, () => phaseOf(boss) === "strike");
    tickUntil(state, () => phaseOf(boss) !== "strike");
    expect(boss.phase).toBe("windup");
    expect(ai.move).toBe(MIRROR_LUNGE);
    expect(boss.chainWindup, "最初からコミット").toBe(true);
  });
});

describe("鏡の騎士: 決定性", () => {
  it("技の選びで乱数を引かない（選ぶ回を挟んでも乱数の消費が変わらない）", () => {
    const consumed = (pick: boolean): number => {
      const { state, boss } = knightFloor();
      toCopyStage(state, boss);
      const spy = vi.spyOn(state.rng, "next");
      for (let i = 0; i < 4; i++) {
        if (pick) {
          boss.phase = "recover";
          boss.phaseTimer = 0;
        }
        tick(state);
      }
      return spy.mock.calls.length;
    };
    expect(consumed(true)).toBe(consumed(false));
  });

  it("同じ seed と入力なら同じ技の順・位置になる", () => {
    const run = (): string => {
      const { state, boss } = knightFloor(-90, 5);
      toImagesStage(state, boss);
      boss.phase = "chase";
      boss.attackCooldown = 0;
      const trace: string[] = [];
      for (let i = 0; i < 600; i++) {
        tick(state);
        if (i % 30 === 0) trace.push(`${boss.ai?.stage}:${boss.ai?.move}:${boss.phase}:${boss.body.pos.x.toFixed(2)}:${boss.hp}`);
      }
      return trace.join("|");
    };
    expect(run()).toBe(run());
  });
});
