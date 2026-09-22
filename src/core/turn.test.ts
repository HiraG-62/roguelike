import { describe, expect, it } from "vitest";
import { createGame, getPlayer, spawnMonster } from "./state";
import { ACTION_COST, attack, playerMoveOrAttack, runMonsterTurns } from "./turn";
import { MONSTERS } from "../data/monsters";
import { Tile, setTile } from "../map/grid";

const RAT = MONSTERS[0]!;

/** プレイヤーの隣にモンスターを 1 体だけ置いた状態 */
function arenaWithAdjacentMonster() {
  const state = createGame(11);
  const player = getPlayer(state);
  state.entities = [player];
  const pos = { x: player.pos.x + 1, y: player.pos.y };
  setTile(state.map, pos.x, pos.y, Tile.Floor);
  const monster = spawnMonster(state, RAT, pos);
  return { state, player, monster };
}

describe("playerMoveOrAttack", () => {
  it("隣にモンスターがいれば移動せず攻撃する", () => {
    const { state, player, monster } = arenaWithAdjacentMonster();
    const before = { ...player.pos };
    const hpBefore = monster.stats.hp;
    player.stats.attack = 100;
    expect(playerMoveOrAttack(state, { dx: 1, dy: 0 })).toBe(true);
    expect(player.pos).toEqual(before);
    expect(monster.stats.hp).toBeLessThan(hpBefore);
  });

  it("倒したモンスターは entities から消える", () => {
    const { state, player, monster } = arenaWithAdjacentMonster();
    player.stats.attack = 100;
    attack(state, player, monster);
    expect(state.entities.find((e) => e.id === monster.id)).toBeUndefined();
    expect(state.events.some((ev) => ev.type === "death" && ev.name === "rat")).toBe(true);
  });
});

describe("runMonsterTurns", () => {
  it("速いモンスターはプレイヤー 1 ターンに複数回動ける", () => {
    const { state, player, monster } = arenaWithAdjacentMonster();
    monster.speed = ACTION_COST * 2;
    monster.stats.attack = 1;
    player.stats.defense = 0;
    player.stats.hp = 1000;
    player.stats.maxHp = 1000;
    player.energy = ACTION_COST;
    runMonsterTurns(state);
    const hits = state.events.filter((ev) => ev.type === "attack" && ev.attackerName === "rat");
    expect(hits.length).toBe(2);
  });

  it("プレイヤーが死ぬと status が dead になる", () => {
    const { state, player, monster } = arenaWithAdjacentMonster();
    monster.stats.attack = 100;
    player.energy = ACTION_COST;
    runMonsterTurns(state);
    expect(state.status).toBe("dead");
    expect(player.stats.hp).toBe(0);
  });
});
