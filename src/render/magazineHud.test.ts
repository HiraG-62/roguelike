import { describe, expect, it } from "vitest";
import type { MagazineView } from "../system/magazine";
import { magazineView, startReload, tickMagazine } from "../system/magazine";
import { arena, withInput } from "../system/testHelpers";
import { ROUND_BAR_W, ROUND_GAP, ROUND_PIPS_MAX, ROUND_SIZE, magazineHudLayout, quickWindowSpan, reloadFillWidth, roundOffset, roundsRowWidth } from "./magazineHud";

function view(partial: Partial<MagazineView>): MagazineView {
  return { active: true, hands: [], quickWindow: null, pack: { level: 0, max: 0, packing: false }, ...partial };
}

describe("弾倉の HUD の配置", () => {
  it("容量が少ない器は丸を並べ、多い器はバーの幅", () => {
    expect(roundsRowWidth(8), "丸 8 つ").toBe(8 * ROUND_SIZE + 7 * ROUND_GAP);
    expect(roundsRowWidth(ROUND_PIPS_MAX + 1), "多いとバー").toBe(ROUND_BAR_W);
    expect(roundsRowWidth(0), "空").toBe(0);
    expect(roundOffset(2), "3 つ目の丸").toBe(2 * (ROUND_SIZE + ROUND_GAP));
  });

  it("手は体の中央に揃えて下へ積み、二丁は 2 列、砲の詰めは 1 列目の右に並ぶ", () => {
    const hand = { rounds: 3, capacity: 6, busy: false, progress: 0 };
    const two = magazineHudLayout(view({ hands: [hand, hand] }), 100, 50);
    expect(two.hands, "2 列").toHaveLength(2);
    const [a, b] = two.hands;
    if (!a || !b) throw new Error("列が無い");
    expect(Math.abs(a.rounds.x + a.rounds.w / 2 - 100), "中央揃え（丸めで 1px 以内）").toBeLessThanOrEqual(1);
    expect(b.rounds.y, "下へ積む").toBeGreaterThan(a.reload.y);
    const cannon = magazineHudLayout(view({ hands: [hand], pack: { level: 1, max: 3, packing: true } }), 100, 50);
    expect(cannon.pack, "詰めの枡 3 つ").toHaveLength(3);
    expect(cannon.pack[0]?.x, "弾の列の右").toBeGreaterThan((cannon.hands[0]?.rounds.x ?? 0) + (cannon.hands[0]?.rounds.w ?? 0));
  });

  it("込めのバーと早込めの窓の印は進みの割合で決まる", () => {
    expect(reloadFillWidth(20, 0.5), "半分").toBe(10);
    expect(reloadFillWidth(20, 2), "1 を超えない").toBe(20);
    expect(quickWindowSpan(20, null), "窓なし").toBeNull();
    expect(quickWindowSpan(20, { from: 0.5, to: 0.6 }), "窓").toEqual({ x: 10, w: 2 });
  });
});

describe("弾倉の HUD の材料", () => {
  it("込めの最中は進みと早込めの窓を持ち、state を書き換えない", () => {
    const state = arena(5, { moveset: "sidearm", bullet: "pistol" });
    tickMagazine(state, withInput({}), 0);
    state.player.magazine.hands[0].rounds = 0;
    startReload(state, 0);
    const before = JSON.stringify(state.player.magazine);
    const v = magazineView(state);
    expect(v.active, "銃").toBe(true);
    expect(v.hands[0]?.busy, "込めている").toBe(true);
    expect(v.quickWindow, "窓").not.toBeNull();
    expect(JSON.stringify(state.player.magazine), "読むだけ").toBe(before);
  });
});
