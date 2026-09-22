import { describe, expect, it } from "vitest";
import { createMap, setTile, Tile } from "../map/grid";
import { BOSS, ELITE, ENEMY_AI, PLAYER } from "../data/tuning";
import { RARITIES } from "../loot/types";
import {
  LOOT_PILLAR_HEIGHTS,
  bombBlinkFrameTime,
  bombStyle,
  bossIntroPhase,
  bossPhaseThreshold,
  damageTextStyle,
  fitTooltip,
  floorVariant,
  floorWipeCover,
  pulse,
  tileHash,
  wallStyle,
} from "./renderMath";

describe("floorVariant", () => {
  it("決定的で範囲内", () => {
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const v = floorVariant(x, y, 6);
        expect(v).toBe(floorVariant(x, y, 6));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(6);
      }
    }
  });

  it("全バリアントが出現する", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(floorVariant(i % 20, Math.floor(i / 20), 6));
    expect(seen.size).toBe(6);
  });

  it("負の座標でも符号なし", () => {
    expect(tileHash(-3, -7)).toBeGreaterThanOrEqual(0);
  });
});

describe("wallStyle", () => {
  it("下が床なら face、横だけ床なら top、埋まっていれば none", () => {
    const map = createMap(5, 5);
    setTile(map, 2, 2, Tile.Floor);
    expect(wallStyle(map, 2, 1)).toBe("face");
    expect(wallStyle(map, 1, 2)).toBe("top");
    expect(wallStyle(map, 2, 3)).toBe("top");
    expect(wallStyle(map, 0, 0)).toBe("none");
  });
});

describe("pulse", () => {
  it("min..max に収まる", () => {
    for (let t = 0; t < 10; t += 0.37) {
      const v = pulse(t, 3, 0.2, 0.8);
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(0.8);
    }
  });
});

describe("fitTooltip", () => {
  it("収まるなら通常行高で全行", () => {
    expect(fitTooltip(5, 8, 6, 12, 200, 4)).toEqual({ lineH: 8, small: false, shown: 5, height: 44 });
  });

  it("maxLines 超過なら小さい行高", () => {
    const fit = fitTooltip(14, 8, 6, 12, 200, 4);
    expect(fit.small).toBe(true);
    expect(fit.shown).toBe(14);
  });

  it("高さが足りなければ切り詰める", () => {
    const fit = fitTooltip(20, 8, 6, 12, 64, 4);
    expect(fit.shown).toBe(10);
    expect(fit.height).toBeLessThanOrEqual(64);
  });
});

describe("演出用の純関数", () => {
  it("bombStyle: 半径と導火線で出どころを見分ける", () => {
    const w = ENEMY_AI.wisp;
    expect(bombStyle({ radius: w.deathExplodeRadius, maxTime: w.deathExplodeFuse })).toBe("wispDeath");
    expect(bombStyle({ radius: ELITE.explodeRadius, maxTime: ELITE.explodeFuse })).toBe("eliteDeath");
    expect(bombStyle({ radius: ENEMY_AI.bomber.radius, maxTime: ENEMY_AI.bomber.fuse })).toBe("bomber");
  });

  it("bombBlinkFrameTime: 残りが減るほど間隔が短くなる", () => {
    const slow = 0.3;
    const fast = 0.08;
    expect(bombBlinkFrameTime(1, slow, fast)).toBeCloseTo(slow);
    expect(bombBlinkFrameTime(0, slow, fast)).toBeCloseTo(fast);
    expect(bombBlinkFrameTime(0.3, slow, fast)).toBeLessThan(bombBlinkFrameTime(0.7, slow, fast));
  });

  it("floorWipeCover: 閉じきってから開き、最後は全開", () => {
    expect(floorWipeCover(1)).toBeGreaterThan(0);
    expect(floorWipeCover(1)).toBeLessThan(1);
    expect(floorWipeCover(0.7)).toBe(1);
    expect(floorWipeCover(0)).toBeCloseTo(0);
    for (let f = 0.6; f > 0; f -= 0.05) expect(floorWipeCover(f - 0.05)).toBeLessThanOrEqual(floorWipeCover(f) + 1e-9);
  });

  it("bossIntroPhase: 帯が出て名前が中央へ滑り込み、最後に消える", () => {
    const total = 2;
    const start = bossIntroPhase(total, total);
    expect(start.bars).toBe(0);
    expect(start.slide).toBe(0);
    const mid = bossIntroPhase(total / 2, total);
    expect(mid.bars).toBe(1);
    expect(mid.slide).toBe(1);
    expect(mid.alpha).toBe(1);
    expect(bossIntroPhase(0.1, total).alpha).toBeLessThan(1);
    expect(bossIntroPhase(0, total).alpha).toBe(0);
  });

  it("LOOT_PILLAR_HEIGHTS: レアほど高い", () => {
    const hs = RARITIES.map((r) => LOOT_PILLAR_HEIGHTS[r]);
    for (let i = 1; i < hs.length; i++) expect(hs[i] ?? 0).toBeGreaterThan(hs[i - 1] ?? 0);
  });

  it("damageTextStyle: 数字だけ縁取り対象、crit 色は crit", () => {
    expect(damageTextStyle("12", PLAYER.critColor, 1.6).crit).toBe(true);
    expect(damageTextStyle("12", "#ffffff", 1).crit).toBe(false);
    expect(damageTextStyle("12", "#ffffff", 1).numeric).toBe(true);
    expect(damageTextStyle("BLOCK", PLAYER.critColor, 1).numeric).toBe(false);
    expect(damageTextStyle("12", "#ffffff", 1.4).outline).not.toBe(damageTextStyle("12", "#ffffff", 1).outline);
  });

  it("bossPhaseThreshold: ボスごとの境界、他は null", () => {
    expect(bossPhaseThreshold("kingSlime")).toBe(BOSS.kingSlime.phase2Ratio);
    expect(bossPhaseThreshold("boneLord")).toBe(BOSS.boneLord.teleportRatio);
    expect(bossPhaseThreshold("chaser")).toBeNull();
  });
});
