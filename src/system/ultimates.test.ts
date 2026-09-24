import { describe, expect, it } from "vitest";
import { step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import { ULTIMATE } from "../data/tuning";
import { ULTIMATES, defaultUltimate, isUltimateKey, ultimateDef } from "../data/ultimates";
import { MOVESET_KEYS } from "../data/weapons";
import { ruleConditionsMet } from "./rules";
import { arena, placeEnemy, withInput } from "./testHelpers";
import { chosenUltimate, noteUltimateKill, tryUltimate, ultimateMoveset } from "./ultimates";
import { playerMoveset } from "./player";

describe("奥義の定義（Lane 0 の骨組み）", () => {
  it("すべての武器種が 1 本以上の奥義を持ち、0 番目が既定で、key から引き直せる", () => {
    for (const key of MOVESET_KEYS) {
      const set = ULTIMATES[key];
      expect(set.length, `${key} の奥義の数`).toBeGreaterThanOrEqual(1);
      expect(defaultUltimate(key), `${key} の既定`).toBe(set[0]);
      for (const u of set) {
        expect(u.moveset, `${u.key} の武器種`).toBe(key);
        expect(ultimateDef(u.key), `${u.key} を引き直せる`).toBe(u);
        expect(isUltimateKey(u.key), `${u.key} は定義済み`).toBe(true);
      }
    }
    expect(isUltimateKey("nope"), "未知の key").toBe(false);
    expect(isUltimateKey(3), "文字列でない").toBe(false);
  });
});

describe("奥義の発動（旧バーストと同じ挙動）", () => {
  it("奥義ゲージが足りなければ出ず、ゲージも減らない", () => {
    const state = arena();
    state.player.energy = ULTIMATE.common.cost - 1;
    expect(tryUltimate(state), "出ない").toBe(false);
    expect(state.player.energy).toBe(ULTIMATE.common.cost - 1);
  });

  it("満タンなら円月で周囲の敵に当て、ゲージを 0 にして onBurst を積む", () => {
    const state = arena();
    const e = placeEnemy(state, "slime", 20);
    const hp = e.hp;
    state.player.energy = ULTIMATE.common.cost;
    step(state, withInput({ specialPressed: true }), FIXED_DT);
    expect(state.player.energy, "ゲージを使い切る").toBe(0);
    expect(e.hp, "周囲の敵に当たる").toBeLessThan(hp);
    expect(state.player.invulnTimer, "発動後の無敵").toBeGreaterThan(0);
    expect(state.recent.onBurst?.count ?? 0, "onBurst を積む").toBeGreaterThan(0);
  });

  it("選んだ奥義が無い・未知・武器種違いなら武器種の 1 本目を使う", () => {
    const state = arena(5, { moveset: "spear" });
    expect(chosenUltimate(state).key, "選択なし").toBe(defaultUltimate("spear").key);
    state.profile.ultimates = { spear: "nope" };
    expect(chosenUltimate(state).key, "未知の key").toBe(defaultUltimate("spear").key);
    state.profile.ultimates = { spear: defaultUltimate("sword").key };
    expect(chosenUltimate(state).key, "武器種違い").toBe(defaultUltimate("spear").key);
  });

  it("持続の奥義が無い間は型を差し替えず、撃破も数えない", () => {
    const state = arena();
    const base = playerMoveset(state);
    expect(ultimateMoveset(state, base), "型はそのまま").toBe(base);
    noteUltimateKill(state);
    expect(state.player.ultimate.kills, "持続中でなければ数えない").toBe(0);
  });
});

describe("奥義と左右アクションの Rule 条件", () => {
  it("ultimateActive は持続の奥義の最中だけ、lane は今の振りのレーンで真", () => {
    const state = arena();
    const subject = { pos: { ...state.player.body.pos } };
    expect(ruleConditionsMet(state, [{ kind: "ultimateActive" }], subject), "持続中でない").toBe(false);
    state.player.ultimate.active = "x";
    expect(ruleConditionsMet(state, [{ kind: "ultimateActive" }], subject), "持続中").toBe(true);
    expect(ruleConditionsMet(state, [{ kind: "lane", lane: "primary" }], subject), "既定は左").toBe(true);
    state.player.attack.lane = "secondary";
    expect(ruleConditionsMet(state, [{ kind: "lane", lane: "primary" }], subject), "右の振り").toBe(false);
    expect(ruleConditionsMet(state, [{ kind: "lane", lane: "secondary" }], subject), "右の振り").toBe(true);
  });
});
