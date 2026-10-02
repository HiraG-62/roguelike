import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { FEEL } from "../data/tuning";
import { FORM_KEYS, FORMS } from "../data/weaponForms";
import { MOVESET_KEYS } from "../data/weapons";
import { damageEnemy } from "./combat";
import { parrySucceed } from "./parry";
import { arena, placeEnemy, withInput } from "./testHelpers";

/** 読み合いの手直し レーン B: 撃破の止め・ヒットストップ中の押下・受け流しの応手（docs/ideas/reading-core-impl.md 2-6〜2-8） */

const FAR = 120;
const HUGE = 9999;

function kill(state: GameState, e: Enemy): number {
  state.hitstop = 0;
  e.hp = 1;
  damageEnemy(state, e, HUGE, { x: 1, y: 0 }, 0, { kind: "melee", hitstopSteps: 0 });
  return state.hitstop;
}

describe("撃破の止め", () => {
  it("普通の撃破は短く（hitstopKill）、精鋭・ボスと同じではない", () => {
    expect(FEEL.hitstopKill, "普通の撃破は節目より短い").toBeLessThan(FEEL.hitstopKillMark);
    const state = arena();
    const e = placeEnemy(state, "slime", FAR);
    expect(kill(state, e)).toBe(FEEL.hitstopKill);
  });

  it("精鋭の撃破は節目の止め", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", FAR);
    e.elite = "reflective";
    expect(kill(state, e)).toBe(FEEL.hitstopKillMark);
  });

  it("陣の最後の 1 体だけが節目の止めで、残りがいるうちは普通の止め", () => {
    const state = arena();
    const a = placeEnemy(state, "slime", FAR);
    const b = placeEnemy(state, "slime", FAR + 20);
    a.jinId = 99;
    b.jinId = 99;
    expect(kill(state, a), "まだ仲間がいる").toBe(FEEL.hitstopKill);
    expect(kill(state, b), "最後の 1 体").toBe(FEEL.hitstopKillMark);
  });

  it("陣に属さない普通の敵は最後の 1 体でも普通の止め", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", FAR);
    expect(kill(state, e)).toBe(FEEL.hitstopKill);
  });
});

/** 止めを n ステップ入れ、その間の 1 ステップ目だけ press を押し、止めが明けた最初のステップまで進める */
function pressDuringStop(state: GameState, press: Parameters<typeof withInput>[0], stopSteps = 3, after = {}): void {
  state.hitstop = stopSteps;
  step(state, withInput(press), FIXED_DT);
  for (let i = 1; i < stopSteps; i++) step(state, withInput({}), FIXED_DT);
  expect(state.hitstop, "止めが明けた").toBe(0);
  step(state, withInput(after), FIXED_DT);
}

describe("ヒットストップ中の押下", () => {
  it("止めの中で押した受け流しは、明けた最初のステップで窓が開く", () => {
    const state = arena();
    pressDuringStop(state, { parryPressed: true });
    expect(state.player.parry.window, "窓が開いた").toBeGreaterThan(0);
    expect(state.player.guardBuffer, "席は空に戻る").toBeUndefined();
  });

  it("止めの中で押したダッシュは、押した時の移動入力の向きで出る", () => {
    const state = arena();
    pressDuringStop(state, { dashPressed: true, move: { x: 0, y: 1 } }, 3, { move: { x: 1, y: 0 } });
    expect(state.player.dashTimer, "ダッシュ中").toBeGreaterThan(0);
    expect(state.player.dashDir.y, "押した時の向き").toBeGreaterThan(0.9);
  });

  it("止めの中で押した攻撃は、明けた最初のステップで振り始める", () => {
    const state = arena();
    pressDuringStop(state, { attackPressed: true, attackHeld: true }, 3, { attackHeld: true });
    expect(state.player.attack.phase, "振りが始まった").not.toBe("none");
  });

  it("後から押した方だけが残る（受け流し → 攻撃なら攻撃だけ）", () => {
    const state = arena();
    state.hitstop = 3;
    step(state, withInput({ parryPressed: true }), FIXED_DT);
    expect(state.player.guardBuffer?.kind, "受け流しを覚えた").toBe("parry");
    step(state, withInput({ attackPressed: true, attackHeld: true }), FIXED_DT);
    expect(state.player.guardBuffer, "守りの席は消える").toBeUndefined();
    expect(state.player.frozenAttack, "攻撃が残る").toBe("primary");
    step(state, withInput({ dashPressed: true }), FIXED_DT);
    expect(state.player.guardBuffer?.kind, "ダッシュに替わる").toBe("dash");
    expect(state.player.frozenAttack, "攻撃は消える").toBeUndefined();
  });

  it("止めの中で右を押しっぱなしにしても、後から押した受け流しが残る（右は押した瞬間の 1 回だけ覚える）", () => {
    const state = arena();
    state.hitstop = 4;
    step(state, withInput({ shootHeld: true }), FIXED_DT);
    expect(state.player.frozenAttack, "右を押した瞬間を覚えた").toBe("secondary");
    step(state, withInput({ shootHeld: true, parryPressed: true }), FIXED_DT);
    expect(state.player.guardBuffer?.kind, "受け流しに替わる").toBe("parry");
    step(state, withInput({ shootHeld: true }), FIXED_DT);
    expect(state.player.guardBuffer?.kind, "押しっぱなしの右で受け流しを消さない").toBe("parry");
    expect(state.player.frozenAttack, "右は覚え直さない").toBeUndefined();
  });

  it("外した受け流しの硬直中の押下は捨てる", () => {
    const state = arena();
    state.player.parry.recover = 0.3;
    pressDuringStop(state, { parryPressed: true });
    expect(state.player.parry.window, "窓は開かない").toBe(0);
  });

  it("止まっていない通常のステップの押下は席を使わない", () => {
    const state = arena();
    step(state, withInput({ parryPressed: true }), FIXED_DT);
    expect(state.player.guardBuffer).toBeUndefined();
    expect(state.player.parry.window).toBeGreaterThan(0);
  });
});

describe("総浚: 受け流しは全ての型の応手", () => {
  it("全ての型の応手の一覧に受け流しが入っている", () => {
    for (const form of FORM_KEYS) expect(FORMS[form].riposte, `${form} の応手`).toContain("parry");
  });

  it("全ての武器種で受け流しの成功が応手の出来事になる", () => {
    for (const moveset of MOVESET_KEYS) {
      const state = arena(5, { moveset });
      state.events.length = 0;
      parrySucceed(state, undefined, 0);
      const riposte = state.events.filter((ev) => ev.kind === "onRiposte" && ev.tag === "parry");
      expect(riposte, `${moveset} の応手`).toHaveLength(1);
    }
  });
});
