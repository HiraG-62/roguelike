import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState, Hazard } from "../core/state";
import { dist } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { roleOf } from "../data/enemyRoles";
import { ENEMY_AI } from "../data/tuning";
import { TILE_SIZE, Tile, setTile } from "../map/grid";
import { lineOfSight } from "../map/pathing";
import { behaviorOf } from "./behaviors/registry";
import { damageEnemy } from "./combat";
import { enemyTelegraph, updateEnemies } from "./enemies";
import { landingDamage, planLeap } from "./enemyLeap";
import { updateHazards } from "./hazards";
import { overlapsWall } from "./physics";
import { applyStagger } from "./poise";
import { arena, placeEnemy } from "./testHelpers";

/** 跳躍の敵（毒スライム） */
const LEAPER = "poisonSlime";
const HUGE_HP = 1_000_000;
const MAX_STEPS = 600;
/** 着地点のずれの許容（px） */
const POS_EPS = 0.5;
/** maxLeap より遠くに置く分（px） */
const FAR_EXTRA = 40;
/** 置く位置が壁から離れている余裕（px） */
const WALL_MARGIN = 12;
const OPEN_DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2]];

function leapArena(depth = 2): GameState {
  const state = arena(11);
  state.depth = depth;
  return state;
}

/** すぐ跳べる、倒れない跳躍の敵を置く */
function readyLeaper(state: GameState, dx: number): Enemy {
  const e = placeEnemy(state, LEAPER, dx);
  e.hp = HUGE_HP;
  e.maxHp = HUGE_HP;
  e.phase = "chase";
  e.attackCooldown = 0;
  return e;
}

/** 壁の角のすれすれ（px）: 中心の線は壁の外、体の半径は壁に掛かる */
const CORNER_GRAZE = 3;
/** 敵とプレイヤーの間のタイル数（真ん中の 1 枚を壁にする） */
const GRAZE_TILES = 4;

/**
 * 中心の視線は通るが、体の幅が壁の角を削る配置: プレイヤーと敵を同じ高さに置き、
 * 間のタイル 1 枚を壁にして、その上端から CORNER_GRAZE だけ上を通す
 */
function grazingLeap(state: GameState): { e: Enemy; wallTile: { x: number; y: number } } {
  const p = state.player.body;
  const ptx = Math.floor(p.pos.x / TILE_SIZE);
  const pty = Math.floor(p.pos.y / TILE_SIZE);
  p.pos = { x: ptx * TILE_SIZE + TILE_SIZE / 2, y: (pty + 1) * TILE_SIZE - CORNER_GRAZE };
  const e = readyLeaper(state, GRAZE_TILES * TILE_SIZE);
  expect(overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius), "前提: 敵は床の上").toBe(false);
  const wallTile = { x: ptx + GRAZE_TILES / 2, y: pty + 1 };
  setTile(state.map, wallTile.x, wallTile.y, Tile.Wall);
  expect(lineOfSight(state.map, e.body.pos, p.pos), "前提: 中心の視線は通る").toBe(true);
  expect(overlapsWall(state, (wallTile.x + 0.5) * TILE_SIZE, p.pos.y, e.body.radius), "前提: 体の幅は壁に掛かる").toBe(true);
  return { e, wallTile };
}

/** from → to を刻んで、半径 r の体がどこかで壁に掛かるか */
function pathHitsWall(state: GameState, from: { x: number; y: number }, to: { x: number; y: number }, r: number): boolean {
  const n = Math.ceil(dist(from, to));
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 1 : i / n;
    if (overlapsWall(state, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, r)) return true;
  }
  return false;
}

function tick(state: GameState): void {
  updateEnemies(state, FIXED_DT);
  updateHazards(state, FIXED_DT);
}

/** その敵の影（landing） */
function shadowOf(state: GameState, e: Enemy): Hazard | undefined {
  return state.hazards.find((h) => h.kind === "landing" && h.sourceId === e.id && h.time > 0);
}

/** 予備動作に入るまで進める */
function untilWindup(state: GameState, e: Enemy): void {
  for (let i = 0; i < MAX_STEPS && e.phase !== "windup"; i++) tick(state);
  expect(e.phase, "予備動作に入った").toBe("windup");
}

describe("跳躍（leaper）", () => {
  it("毒スライムは跳躍の突撃役。共通の突進の線は出さず、影で予告する", () => {
    const def = enemyDef(LEAPER);
    expect(def.behavior).toBe("leaper");
    expect(roleOf(def)).toBe("charge");
    expect(behaviorOf(def).strikeSpeedMul, "共通の突進は使わない").toBe(0);
    const state = leapArena();
    const e = readyLeaper(state, 60);
    untilWindup(state, e);
    expect(enemyTelegraph(e, def), "線の予告は出さない").toBeNull();
  });

  it("予備動作の始まりに、そのときのプレイヤーの位置へ着地の影が出る（予備動作 + 滞空の長さ）", () => {
    const state = leapArena();
    const def = enemyDef(LEAPER);
    const e = readyLeaper(state, 60);
    untilWindup(state, e);
    const shadow = shadowOf(state, e);
    expect(shadow, "影が出た").toBeDefined();
    expect(dist(shadow?.pos ?? { x: 0, y: 0 }, state.player.body.pos)).toBeLessThan(POS_EPS);
    expect(shadow?.radius).toBe(ENEMY_AI.leaper.radius);
    expect(shadow?.airTime).toBe(def.strikeTime);
    expect(shadow?.maxTime ?? 0, "予備動作と滞空の間ずっと出る").toBeCloseTo(e.windupTotal + def.strikeTime, 6);
  });

  it("遠いプレイヤーへは maxLeap までしか跳ばない", () => {
    const state = leapArena();
    const far = ENEMY_AI.leaper.maxLeap + FAR_EXTRA;
    // 部屋の中で、プレイヤーとの間に壁が無い向きに置く（着地点が壁にかかってずれないように）
    const spot = OPEN_DIRS.map(([x, y]) => ({ x: x * far, y: y * far })).find((d) => {
      const pos = { x: state.player.body.pos.x + d.x, y: state.player.body.pos.y + d.y };
      return !overlapsWall(state, pos.x, pos.y, WALL_MARGIN) && lineOfSight(state.map, pos, state.player.body.pos);
    });
    expect(spot, "壁の無い向きがある").toBeDefined();
    const e = placeEnemy(state, LEAPER, spot?.x ?? 0, spot?.y ?? 0);
    planLeap(state, e, enemyDef(LEAPER));
    expect(dist(e.ai?.target ?? e.body.pos, e.body.pos)).toBeCloseTo(ENEMY_AI.leaper.maxLeap, 3);
  });

  it("中心の視線が通っても、体の幅が壁の角に掛かる道筋は壁の手前で着地する", () => {
    const state = leapArena();
    const { e, wallTile } = grazingLeap(state);
    planLeap(state, e, enemyDef(LEAPER));
    const target = e.ai?.target ?? e.body.pos;
    expect(pathHitsWall(state, e.body.pos, target, e.body.radius), "着地点までの道筋は壁に掛からない").toBe(false);
    expect(target.x, "壁のタイルを越えない").toBeGreaterThan((wallTile.x + 1) * TILE_SIZE);
  });

  it("跳躍の間ずっと壁にめり込まない（壁の角すれすれの配置でも）", () => {
    const state = leapArena();
    const { e } = grazingLeap(state);
    untilWindup(state, e);
    let sawStrike = false;
    for (let i = 0; i < MAX_STEPS && e.phase !== "recover"; i++) {
      tick(state);
      if (e.phase === "strike") sawStrike = true;
      expect(overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius), `${e.phase} で壁にめり込まない`).toBe(false);
    }
    expect(sawStrike, "跳んだ").toBe(true);
  });

  it("予備動作と空中では当たらず、影は着地まで残り、着地で円の中のプレイヤーに当たる", () => {
    const state = leapArena();
    const def = enemyDef(LEAPER);
    const e = readyLeaper(state, 60);
    untilWindup(state, e);
    const target = { ...(e.ai?.target ?? e.body.pos) };
    const hp = state.player.hp;
    let sawStrike = false;
    for (let i = 0; i < MAX_STEPS && e.phase !== "recover"; i++) {
      const before = e.phase;
      tick(state);
      if (e.phase === "strike") sawStrike = true;
      if (e.phase === "windup" || e.phase === "strike") {
        expect(state.player.hp, `${before} の間は当たらない`).toBe(hp);
        expect(shadowOf(state, e), "影は着地まで残る").toBeDefined();
      }
    }
    expect(sawStrike, "跳んだ").toBe(true);
    expect(e.phase, "着地の後は隙").toBe("recover");
    expect(dist(e.body.pos, target), "影の上に着地する").toBeLessThan(POS_EPS);
    expect(hp - state.player.hp, "着地で当たる").toBe(landingDamage(state, e, def));
    updateHazards(state, FIXED_DT);
    expect(shadowOf(state, e), "着地で影が消える").toBeUndefined();
  });

  it("跳んでいる間も無敵にならない（殴れる）", () => {
    const state = leapArena();
    const e = readyLeaper(state, 60);
    untilWindup(state, e);
    for (let i = 0; i < MAX_STEPS && e.phase !== "strike"; i++) tick(state);
    expect(e.phase).toBe("strike");
    expect(e.hidden ?? false, "姿を隠さない").toBe(false);
    const before = e.hp;
    damageEnemy(state, e, 5, { x: 1, y: 0 }, 0);
    expect(e.hp, "空中でも殴れる").toBeLessThan(before);
  });

  it("着地点は予備動作の始まりで固定: 影から出れば当たらない", () => {
    const state = leapArena();
    const e = readyLeaper(state, 60);
    untilWindup(state, e);
    const target = { ...(e.ai?.target ?? e.body.pos) };
    state.player.body.pos = { x: state.player.body.pos.x - 60, y: state.player.body.pos.y };
    const hp = state.player.hp;
    for (let i = 0; i < MAX_STEPS && e.phase !== "recover"; i++) tick(state);
    expect(e.phase).toBe("recover");
    expect(dist(e.body.pos, target), "元の影の上に降りる").toBeLessThan(POS_EPS);
    expect(state.player.hp, "影の外にいれば当たらない").toBe(hp);
  });

  it("怯みで予備動作が取り消されると影も消える（フェイントにならない）", () => {
    const state = leapArena();
    const e = readyLeaper(state, 60);
    untilWindup(state, e);
    expect(shadowOf(state, e)).toBeDefined();
    applyStagger(state, e, 0.5);
    updateHazards(state, FIXED_DT);
    expect(shadowOf(state, e), "取り消された跳躍の影は残らない").toBeUndefined();
  });

  it("着地した影は、続けて次の予備動作に入っても残らない", () => {
    const state = leapArena();
    const e = readyLeaper(state, 60);
    untilWindup(state, e);
    const first = shadowOf(state, e);
    for (let i = 0; i < MAX_STEPS && e.phase !== "recover"; i++) tick(state);
    // 連撃で次の予備動作に入った状態を作る（前の影が予備動作に同期して生き返らないこと）
    e.phase = "windup";
    e.phaseTimer = 0.5;
    updateHazards(state, FIXED_DT);
    expect(state.hazards.includes(first as Hazard), "前の影は消えた").toBe(false);
  });
});
