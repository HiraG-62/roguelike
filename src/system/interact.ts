import type { FrameInput } from "../core/input";
import type { GameState, Merchant, RoomState, Ware } from "../core/state";
import type { Vec } from "../core/vec";
import type { ContractOffer, Contractor } from "./contractors";
import { useOffer } from "./contractors";
import { type DropCandidate, type FocusedDrop, aimWorldOf, dropCandidates, isInPickupReach, pickFocus, pickUpDrop } from "./loot";
import { buyWare, merchantOpen } from "./merchants";
import { type PropKind, type RoomProp, isInteractProp, useProp } from "./specialRooms";

/**
 * 注目とインタラクト（照準を合わせて interact で使う物）。床の遺物・スキル石（system/loot.ts）に加え、
 * 商人の品・契約者の台座・部屋の台座も同じ注目の規則（loot.ts の pickFocus）で選ぶ。
 * 触れたら即使う仕様だと要らない品を誤って買う・選ぶため、注目 + 押下に揃えた。
 * 上り階段・地上への道は乗り続けて使い、床の瓶・銭・鍵・ハートは触れて拾うのでここに無い。
 * 注目は state に持たず、描画（render/dropTooltip.ts）と step の入口（updateInteract）が同じ純関数で求める
 */

/** 注目できる台座の中身 */
export type PedestalTarget =
  | { kind: "ware"; merchant: Merchant; ware: Ware }
  | { kind: "offer"; contractor: Contractor; offer: ContractOffer }
  | { kind: "prop"; room: RoomState; roomIndex: number; prop: RoomProp };

export type FocusedPedestal = { kind: "pedestal"; pos: Vec; inReach: boolean; target: PedestalTarget };

/** 注目中の物（床の遺物・スキル石・台座） */
export type InteractFocus = FocusedDrop | FocusedPedestal;

/** 台座の操作の種類（キー案内の動詞。表示文字列は render 側） */
export type PedestalVerb = "buy" | "choose" | "use" | "open";

/** 部屋の台座ごとの動詞。乗り続ける台座・護衛対象は注目しないが、型を網羅するため use にしておく */
const PROP_VERB: Readonly<Record<PropKind, PedestalVerb>> = {
  keystone: "choose",
  rune: "choose",
  element: "choose",
  exchange: "choose",
  curse: "choose",
  inverter: "choose",
  lever: "use",
  anvil: "use",
  bell: "use",
  vein: "use",
  donation: "use",
  chest: "open",
  lockedChest: "open",
  seal: "open",
  captive: "use",
  ascend: "use",
  surface: "use",
};

export function pedestalVerb(target: Readonly<PedestalTarget>): PedestalVerb {
  switch (target.kind) {
    case "ware":
      return "buy";
    case "offer":
      return "choose";
    case "prop":
      return PROP_VERB[target.prop.kind];
  }
}

type PedestalCandidate = { kind: "pedestal"; pos: Vec; target: PedestalTarget };

/** 台座の候補。並びは 商人（市に立った順）の品 → 契約者の台座 → 部屋の番号順の台座（同距離のときの決定性のため固定） */
function pedestalCandidates(state: GameState): PedestalCandidate[] {
  const out: PedestalCandidate[] = [];
  for (const merchant of state.economy.merchants) {
    if (!merchantOpen(merchant)) continue;
    for (const ware of merchant.wares) {
      if (!ware.used) out.push({ kind: "pedestal", pos: ware.pos, target: { kind: "ware", merchant, ware } });
    }
  }
  const contractor = state.contracts.contractor;
  for (const offer of contractor?.offers ?? []) {
    if (contractor && !offer.used) out.push({ kind: "pedestal", pos: offer.pos, target: { kind: "offer", contractor, offer } });
  }
  state.rooms.forEach((room, roomIndex) => {
    for (const prop of room.special?.props ?? []) {
      if (isInteractProp(prop)) out.push({ kind: "pedestal", pos: prop.pos, target: { kind: "prop", room, roomIndex, prop } });
    }
  });
  return out;
}

/**
 * 注目中の物。候補は 床の遺物 → スキル石 → 刻印符 → 台座 の順（同距離なら先の候補）。
 * 選び方は loot.ts の pickFocus（照準の近く → 照準への線の近くで手の届くもの → 照準が無ければ手の届く範囲で最も近いもの）
 */
export function focusedInteract(state: GameState, aimWorld: Vec | null): InteractFocus | null {
  const candidates: (DropCandidate | PedestalCandidate)[] = [...dropCandidates(state), ...pedestalCandidates(state)];
  const hit = pickFocus(state, candidates, aimWorld);
  if (hit === null) return null;
  return { ...hit, inReach: isInPickupReach(state, hit.pos) };
}

/** step から呼ぶ: インタラクトが押されていれば注目中の物を拾う / 使う（押下は 1 フレームの立ち上がりなので連打防止は要らない） */
export function updateInteract(state: GameState, input: FrameInput): void {
  if (!input.interactPressed) return;
  const focus = focusedInteract(state, aimWorldOf(state, input.aimScreen));
  if (focus === null || !focus.inReach) return;
  if (focus.kind === "pedestal") {
    usePedestal(state, focus.target);
    return;
  }
  pickUpDrop(state, focus);
}

function usePedestal(state: GameState, target: PedestalTarget): void {
  switch (target.kind) {
    case "ware":
      buyWare(state, target.merchant, target.ware);
      return;
    case "offer":
      useOffer(state, target.contractor, target.offer);
      return;
    case "prop":
      useProp(state, target.room, target.roomIndex, target.prop);
      return;
  }
}
