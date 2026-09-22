import { type Direction, type GameState, emit, entityAt, getPlayer, tryMove } from "./state";
import { type Entity, isAlive } from "../entity/entity";
import { applyAttack } from "../system/combat";
import { decideMonsterAction } from "../system/ai";

/** 1 行動に必要なエネルギー。speed 100 なら毎ティック 1 行動 */
export const ACTION_COST = 100;

/**
 * エネルギー方式のターン処理。
 * プレイヤーが 1 行動を消費したあと、プレイヤーのエネルギーが溜まるまでモンスターを動かす。
 */
export function runMonsterTurns(state: GameState): void {
  const player = getPlayer(state);
  player.energy -= ACTION_COST;

  while (player.energy < ACTION_COST && isAlive(player)) {
    for (const e of state.entities) {
      e.energy += e.speed;
    }
    // 行動中に死亡して配列が変わっても安全なようにスナップショットを回す
    for (const e of [...state.entities]) {
      if (e.kind === "player" || !isAlive(e)) continue;
      while (e.energy >= ACTION_COST && isAlive(player)) {
        e.energy -= ACTION_COST;
        monsterAct(state, e, player);
      }
    }
  }
  state.turn += 1;
}

function monsterAct(state: GameState, self: Entity, player: Entity): void {
  const action = decideMonsterAction(state, self, player);
  switch (action.type) {
    case "wait":
      return;
    case "move":
      tryMove(state, self, action.dir);
      return;
    case "attack":
      attack(state, self, player);
      return;
  }
}

/** 攻撃を実行し、イベントを発行する。死亡処理まで含む */
export function attack(state: GameState, attacker: Entity, defender: Entity): void {
  const result = applyAttack(attacker, defender, state.rng);
  emit(state, {
    type: "attack",
    attackerName: attacker.name,
    defenderName: defender.name,
    damage: result.damage,
  });
  if (!result.killed) return;

  emit(state, { type: "death", name: defender.name, isPlayer: defender.kind === "player" });
  if (defender.kind === "player") {
    state.status = "dead";
    return;
  }
  state.entities = state.entities.filter((e) => e.id !== defender.id);
}

/** プレイヤーの移動 or 隣接攻撃。ターンを消費したら true */
export function playerMoveOrAttack(state: GameState, dir: Direction): boolean {
  const player = getPlayer(state);
  const target = entityAt(state, player.pos.x + dir.dx, player.pos.y + dir.dy);
  if (target && target.kind === "monster") {
    attack(state, player, target);
    return true;
  }
  return tryMove(state, player, dir);
}
