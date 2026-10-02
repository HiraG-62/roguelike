import { describe, expect, it, vi } from "vitest";
import * as combat from "./combat";
import { updateEnemies } from "./enemies";
import { applyStagger, isStaggered } from "./poise";
import { arena, placeEnemy } from "./testHelpers";

/**
 * 受け流し（レーン C）は damagePlayer の最中に攻撃側の敵を直接怯ませる。
 * strike() がその後 endStrike の recover で怯みを上書きしないことを、damagePlayer を差し替えて確かめる
 */
describe("接触した攻撃が受け流されて怯んだ敵（strike のガード）", () => {
  it("touchPlayer の最中に怯んだ敵は、endStrike の recover に上書きされず chase のまま怯み続ける", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 1);
    e.hp = 100000;
    e.maxHp = 100000;
    e.phase = "strike";
    e.phaseTimer = 0.5;
    // 動かずその場で接触させる（壁判定で endStrike に進む経路を避ける）
    e.strikeDir = { x: 0, y: 0 };
    const spy = vi.spyOn(combat, "damagePlayer").mockImplementationOnce((s, _amount, _from, attacker) => {
      if (attacker) applyStagger(s, attacker, 0.6);
      return "dodged";
    });
    updateEnemies(state, 0.016);
    expect(spy, "接触で damagePlayer が呼ばれた").toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(isStaggered(e), "怯んでいる").toBe(true);
    expect(e.phase, "recover ではなく chase").toBe("chase");
    expect(e.attackCooldown, "攻撃間隔が入っている").toBeGreaterThan(0);
  });
});
