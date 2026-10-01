import { KEYWORDS, type Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import { BOONS, type BoonAction } from "../system/boonDefs";
import type { BoonKey } from "../system/boonDefs";
import { type OriginProfile, resonanceBySourceOf, resonanceEaseOf, resonanceOrigins } from "../system/resonance";

/**
 * 祝福の 3 択の紋の写し（docs/ideas/inventory-v2/E-impl.md 4-3 E8a）。
 * 焦点の札を取ったら、どの系統の帯が太るか・どの行動に乗るかを、state を変えずに数えて返す。描画は render/boonUi.ts
 */

export interface BoonCrestHint {
  /** その札を足すと段が上がる系統（KEYWORDS 順。新しく段が立つ系統を含む） */
  rising: Keyword[];
  /** 加護の札が宿る行動（加護でなければ null） */
  action: BoonAction | null;
}

/** 行動の札の字（装備画面の加護の頁と同じ [左][右][駆][技][奥]） */
export const BOON_ACTION_GLYPH: Readonly<Record<BoonAction, string>> = {
  primary: "左",
  secondary: "右",
  dash: "駆",
  skill: "技",
  ultimate: "奥",
};

/**
 * 今の出どころに祝福 key を 1 つ足して数え直し、段が上がる系統と乗る行動を返す。
 * 段は resonanceBySourceOf（countProfiles → resonanceSteps）に任せ、規則を二重に持たない
 */
export function boonCrestHint(state: Readonly<GameState>, key: BoonKey): BoonCrestHint {
  const def = BOONS[key];
  const ease = resonanceEaseOf(state);
  const now = resonanceOrigins(state);
  const before = resonanceBySourceOf(now, ease);
  const added: OriginProfile = { origin: { kind: "boon", id: key }, profile: def.keywords };
  const after = resonanceBySourceOf([...now, added], ease);
  const rising = KEYWORDS.filter((k) => after[k].step > before[k].step);
  return { rising, action: def.card === "grace" ? (def.action ?? null) : null };
}
