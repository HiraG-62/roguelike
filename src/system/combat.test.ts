import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { type Entity, createPlayer } from "../entity/entity";
import { applyAttack, rollDamage } from "./combat";

function dummy(attack: number, defense: number, hp = 10): Entity {
  const e = createPlayer(99, { x: 0, y: 0 });
  e.stats = { hp, maxHp: hp, attack, defense };
  return e;
}

describe("rollDamage", () => {
  it("attack - defense ± 1 の範囲に収まり、負にならない", () => {
    const rng = createRng(1);
    const attacker = dummy(5, 0);
    const defender = dummy(0, 3);
    for (let i = 0; i < 200; i++) {
      const d = rollDamage(attacker, defender, rng);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(3);
    }
  });

  it("防御が攻撃を上回っても 0 で止まる", () => {
    const rng = createRng(1);
    const d = rollDamage(dummy(1, 0), dummy(0, 10), rng);
    expect(d).toBe(0);
  });
});

describe("applyAttack", () => {
  it("HP を減らし、0 以下で killed になる", () => {
    const rng = createRng(1);
    const attacker = dummy(10, 0);
    const defender = dummy(0, 0, 5);
    const result = applyAttack(attacker, defender, rng);
    expect(result.killed).toBe(true);
    expect(defender.stats.hp).toBe(0);
  });
});
