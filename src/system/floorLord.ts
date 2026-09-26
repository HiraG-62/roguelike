import type { GameState } from "../core/state";
import { type EnemyBehavior, type EnemyDef, enemiesForDepth, enemyDef } from "../data/enemies";
import { FLOOR_LORD } from "../data/tuning";
import { rectCenter, rectCenterPx, setTile, Tile } from "../map/grid";
import { biomeEnemyWeight } from "./biomes";
import { createEnemy } from "./enemies";
import { eliteKindsFor, makeElite } from "./elites";

/**
 * 毎階の最後の部屋に出る「階の主」（内部 key floorLord。表示は「階の主」）。
 * 部屋主（lairMaster）を優先して選び、外れたら通常敵を 1 体格上げして「〜の長」にする。
 * 5 の倍数の階は今までどおり boss.ts の階層ボス（BOSS_ROTATION）が出る（buildFloor が振り分ける）
 */

/**
 * 部屋の主にふさわしくない behavior。喰らう宝箱・鎧の中身は専用の部屋演出（罠・変身）が要るので
 * 部屋主の候補から外す。鐘・据え置きはその場から動かず、格上げしても戦いにならないので通常敵の候補から外す
 */
const LORD_EXCLUDED_BEHAVIORS: ReadonlySet<EnemyBehavior> = new Set<EnemyBehavior>(["mimic", "hollowArmor", "graveBell", "inert", "mine", "egg"]);

/** 自爆で消える敵（爆弾持ち・鬼火など）は、主が自分で死んで階段が出てしまうので主にしない */
function selfDestructs(d: EnemyDef): boolean {
  return d.explode !== undefined;
}

export interface FloorLordPick {
  def: EnemyDef;
  /** 部屋主（lairMaster）をそのまま使ったか（false は通常敵を格上げした） */
  lair: boolean;
}

function lordCandidates(depth: number): EnemyDef[] {
  return enemiesForDepth(depth).filter((d) => d.lairMaster === true && !LORD_EXCLUDED_BEHAVIORS.has(d.behavior) && !selfDestructs(d));
}

function championCandidates(depth: number): EnemyDef[] {
  return enemiesForDepth(depth).filter(
    (d) => !d.lairMaster && !d.swarm && !d.timid && d.weight > 0 && !LORD_EXCLUDED_BEHAVIORS.has(d.behavior) && !selfDestructs(d),
  );
}

/** floor.ts の pickEnemy と同じ重み付き抽選（バイオームの重みを掛ける） */
function pickWeighted(state: GameState, defs: readonly EnemyDef[]): EnemyDef {
  const weight = (d: EnemyDef): number => biomeEnemyWeight(d, state.floorKind);
  const total = defs.reduce((sum, d) => sum + weight(d), 0);
  let roll = state.rng.next() * total;
  for (const def of defs) {
    roll -= weight(def);
    if (roll <= 0) return def;
  }
  return defs[defs.length - 1] ?? defs[0]!;
}

/** この階の「階の主」を選ぶ。部屋主が候補にいれば優先し、無ければ通常敵を格上げする */
export function pickFloorLordDef(state: GameState): FloorLordPick {
  const lairs = lordCandidates(state.depth);
  if (lairs.length > 0 && state.rng.chance(FLOOR_LORD.lairChance)) {
    return { def: state.rng.pick(lairs), lair: true };
  }
  const champions = championCandidates(state.depth);
  if (champions.length === 0) return { def: enemyDef("slime"), lair: false };
  return { def: pickWeighted(state, champions), lair: false };
}

/** 部屋主はそのままの名前、格上げした通常敵は「〜の長」 */
function lordName(def: EnemyDef, lair: boolean): string {
  return lair ? def.name : `${def.name}の長`;
}

/** 最後の部屋を「階の主」の部屋にする: 階段を隠して主を置き、必ず精鋭修飾子を 1 つ付ける */
export function setupFloorLordRoom(state: GameState, roomIndex: number): void {
  const room = state.rooms[roomIndex];
  if (!room) return;
  const c = rectCenter(room.rect);
  setTile(state.map, c.x, c.y, Tile.Floor);
  const { def, lair } = pickFloorLordDef(state);
  const e = createEnemy(state, def, rectCenterPx(room.rect), roomIndex, false);
  e.maxHp = Math.round(e.maxHp * (lair ? FLOOR_LORD.hpMulLair : FLOOR_LORD.hpMulChampion));
  e.hp = e.maxHp;
  e.poise.max *= FLOOR_LORD.poiseMul;
  makeElite(e, state.rng.pick(eliteKindsFor(def)));
  state.enemies.push(e);
  state.boss = { enemyId: e.id, name: lordName(def, lair), roomIndex, introTimer: 0, defeated: false, major: false };
}

/** この階の主（major を問わない）の部屋が封鎖中か */
export function bossRoomLocked(state: GameState): boolean {
  return state.boss !== null && state.rooms[state.boss.roomIndex]?.locked === true;
}
