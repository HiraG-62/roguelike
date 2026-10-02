import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { type Keyword, type KeywordProfile, type KeywordVerb, kw } from "../core/keywords";
import { type OriginProfile, type ResonanceOrigin, resonanceBySourceOf } from "../system/resonance";
import { BEAD_MAX, CREST_MAX_STEPPED, CREST_MAX_UNDER, type CrestShape, beadFocusFor, crestShape, originOfKey, sourceKey } from "./crestShape";

let serial = 0;

function relic(profile: KeywordProfile): OriginProfile {
  serial += 1;
  const origin: ResonanceOrigin = { kind: "relic", id: `r${serial}`, slot: "ring" };
  return { origin, profile };
}

function shapeOf(sources: readonly OriginProfile[]): CrestShape {
  return crestShape(createGame(1), resonanceBySourceOf(sources));
}

function rowOf(shape: CrestShape, k: Keyword) {
  const row = shape.rows.find((r) => r.keyword === k);
  if (row === undefined) throw new Error(`${k} の帯が無い`);
  return row;
}

const STEPPED: Keyword[] = ["melee", "dash", "combo", "finisher", "burn", "chill"];
const UNDER: Keyword[] = ["shock", "stagger", "kill"];

describe("紋の形", () => {
  it("段の立った系統は 4 本、伏流は 2 本まで", () => {
    const sources = [relic(kw(STEPPED)), relic(kw(STEPPED)), relic(kw([], STEPPED)), relic(kw([], STEPPED)), relic(kw(UNDER))];
    const shape = shapeOf(sources);
    const stepped = shape.rows.filter((r) => !r.undercurrent);
    const under = shape.rows.filter((r) => r.undercurrent);
    expect(stepped, "段の立った帯").toHaveLength(CREST_MAX_STEPPED);
    expect(under, "伏流の帯").toHaveLength(CREST_MAX_UNDER);
    expect(stepped.every((r) => r.step > 0), "段の立った帯は段 1 以上").toBe(true);
    expect(shape.hidden, "描けない系統は盤へ").toHaveLength(STEPPED.length - CREST_MAX_STEPPED + UNDER.length - CREST_MAX_UNDER);
  });

  it("珠は源 4・糧 4・強め 2 を超えた分を畳む", () => {
    const sources = [
      ...Array.from({ length: 6 }, () => relic(kw(["burn"]))),
      ...Array.from({ length: 5 }, () => relic(kw([], ["burn"]))),
      ...Array.from({ length: 3 }, () => relic(kw([], [], ["burn"]))),
    ];
    const row = rowOf(shapeOf(sources), "burn");
    const totals: Record<KeywordVerb, number> = { produces: 6, consumes: 5, amplifies: 3 };
    for (const verb of ["produces", "consumes", "amplifies"] as const) {
      const shown = row[verb].length + (row.overflow[verb] > 0 ? 1 : 0);
      expect(shown, `${verb} の見た目の数`).toBeLessThanOrEqual(BEAD_MAX[verb]);
      expect(row[verb].length + row.overflow[verb], `${verb} の出どころは数え漏れない`).toBe(totals[verb]);
      expect(row.overflow[verb], `${verb} は畳む`).toBeGreaterThan(0);
    }
  });

  it("溢れの伏流は糧の側に＋、枯れの伏流は源の側に＋", () => {
    const shape = shapeOf([relic(kw(["burn"])), relic(kw(["burn"])), relic(kw([], ["chill"]))]);
    expect(rowOf(shape, "burn").plus, "源だけある（溢れ）→ 糧を足す").toBe("consumes");
    expect(rowOf(shape, "chill").plus, "糧だけある（枯れ）→ 源を足す").toBe("produces");
    expect(rowOf(shape, "burn").undercurrent, "伏流").toBe(true);
  });

  it("同じ出どころには同じ key", () => {
    const both = relic(kw(["burn"], ["melee"]));
    const shape = shapeOf([both, relic(kw(["melee"]))]);
    const key = sourceKey(both.origin);
    expect(rowOf(shape, "burn").produces.map((b) => b.key), "燃焼の源").toEqual([key]);
    expect(rowOf(shape, "melee").consumes.map((b) => b.key), "近接の糧").toEqual([key]);
    expect(originOfKey(key), "key から出どころへ戻せる").toEqual(both.origin);
    expect(beadFocusFor(shape, key), "最初に見つかった帯の珠").toContain(key);
    expect(originOfKey("relic|nowhere|x"), "読めない部位は null").toBeNull();
  });
});
