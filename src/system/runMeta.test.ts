import { describe, expect, it } from "vitest";
import { CONTRACTOR_KEYS } from "./contractors";
import { RUN_EVENT_KEYS } from "./runEvents";
import { RUN_META_CONTRACTOR_KEYS, RUN_META_EVENT_KEYS, emptyRunMeta, isEmptyRunMeta, sanitizeRunMeta } from "./runMeta";

describe("runMeta（ランの外から持ち込む中身）", () => {
  it("契約者・ランイベントの key の一覧は contractors.ts / runEvents.ts と一致する", () => {
    expect([...RUN_META_CONTRACTOR_KEYS].sort()).toEqual([...CONTRACTOR_KEYS].sort());
    expect([...RUN_META_EVENT_KEYS].sort()).toEqual([...RUN_EVENT_KEYS].sort());
  });

  it("空の runMeta は空と判定し、何か 1 つあれば空でない", () => {
    expect(isEmptyRunMeta(emptyRunMeta())).toBe(true);
    expect(isEmptyRunMeta({ ...emptyRunMeta(), perks: ["exit"] })).toBe(false);
    expect(isEmptyRunMeta({ ...emptyRunMeta(), nemesis: { key: "wolf", elites: [], depth: 4 } })).toBe(false);
  });

  it("壊れた値・未知の key は黙って捨て、重複は 1 つにする", () => {
    const clean = sanitizeRunMeta({
      nemesis: { key: "wolf", elites: ["hasted", "nope", "hasted", "shielded", "explosive"], depth: 6.7 },
      lockedRooms: ["library", "library", "normal", "nope", 3],
      lockedContractors: ["ferryman", "nope"],
      lockedEvents: ["fog", "fog", "nope"],
      perks: ["market", "nope", "market"],
    });
    expect(clean).toEqual({
      nemesis: { key: "wolf", elites: ["hasted", "shielded"], depth: 6 },
      lockedRooms: ["library"],
      lockedContractors: ["ferryman"],
      lockedEvents: ["fog"],
      perks: ["market"],
    });
    for (const broken of [null, 3, "x", [], { nemesis: { key: "kingSlime", elites: [], depth: 5 } }, { nemesis: { key: "wolf", depth: -1 } }]) {
      expect(isEmptyRunMeta(sanitizeRunMeta(broken)), `壊れた値 ${JSON.stringify(broken)} は空`).toBe(true);
    }
  });
});
