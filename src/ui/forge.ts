import type { SfxName } from "../audio/sfxNames";
import { type GameState, pushSfx } from "../core/state";
import {
  ECHO_LABEL,
  RECALL_COST,
  STIR_COST,
  TRANSFER_COST,
  applyEchoResult,
  canRecallBud,
  craftEcho,
  type EchoCost,
  type EchoOp,
  type EchoRequest,
  type EchoResult,
  type TransferWhat,
} from "../loot/crafting";
import { saveCraft, type CraftSave } from "../loot/craftingStore";
import { isKeystoneKey, formatAffix } from "../loot/affixes";
import { describeTrait } from "../loot/describe";
import { saveProfile } from "../loot/profile";
import { isCarriedItem } from "../loot/runGear";
import { LOOT_SLOTS, TRAIT_COLORS, type Item, type Profile } from "../loot/types";
import { applyEquipmentChange } from "./menuActions";
import type { ForgePick, ForgeSession } from "./menuState";

/**
 * 鍛冶の手続き（残響の 5 操作。docs/ideas/inventory-v2/E-impl.md 2-4・4-3 E6）。書付の下端と金床の構え（段 7）が使う。
 * 段は 選ぶ（subject）→ 操作 → 相手（注ぎ・移し）→ 選ぶ行（煽り = 性質、呼び戻し = 芽、移し = 銘か芽吹いた性質）→ 実行。
 * 役割: 砕くは倉庫の遺物だけ。煽り・呼び戻しは装備中も作り替える。注ぎ・移しは subject が倉庫なら捧げる側、装備中なら受け手
 * （捧げる側はいつも倉庫）。借り物（武器掛け）は対象にしない（素の器を育てる抜け道を作らない）。
 * 装備中の物が変わったら applyEquipmentChange（applyStats）を通す。記録の captureLoadout と再生の applyEvent が
 * どちらも applyStats の後の値を見るので、ここで畳み直せば記録と再生が一致する（E-impl 5 章）
 */

export type ForgeStep = "op" | "partner" | "pick" | "ready";

/** 操作ごとの効果音（既存の名前を読み替えて使う。旧 ui/echoTab.ts の ECHO_SFX） */
export const FORGE_SFX: Readonly<Record<EchoOp, SfxName>> = {
  shatter: "dismantle",
  pour: "craftFuse",
  transfer: "craftFuse",
  recall: "craftReforge",
  stir: "craftCorrupt",
};

/** 段ごとの次の手（実行を押したのに足りないときの知らせ） */
export const FORGE_STEP_PROMPT: Readonly<Record<ForgeStep, string>> = {
  op: "操作を選ぶ",
  partner: "同じ部位の相手を選ぶ",
  pick: "性質・銘・芽の行を選ぶ",
  ready: "実行",
};

const LOANED_TEXT = "借り物は鍛えられない";
const EQUIPPED_SHATTER_TEXT = "装備中の遺物は砕けない（外してから）";
const MISSING_TEXT = "遺物が見つからない";
const CARRIED_TEXT = "持ち込んだ遺物は消せない";

/** 相手を取る操作（注ぎ・移し） */
export function forgeNeedsPartner(op: EchoOp): boolean {
  return op === "pour" || op === "transfer";
}

/** 選ぶ行が要る操作（煽り・呼び戻し・移し） */
export function forgeNeedsPick(op: EchoOp): boolean {
  return op === "stir" || op === "recall" || op === "transfer";
}

/** 操作の費用（砕く・注ぎは無料 = null）。荷札・下端の 1 行に出す */
export function forgeOpCost(op: EchoOp): EchoCost | null {
  switch (op) {
    case "shatter":
    case "pour":
      return null;
    case "stir":
      return { color: "umbra", amount: STIR_COST };
    case "transfer":
      return { color: "umbra", amount: TRANSFER_COST };
    case "recall":
      return { color: "umbra", amount: RECALL_COST };
  }
}

/** 「冥響 2」。無料は空文字 */
export function forgeCostText(op: EchoOp): string {
  const cost = forgeOpCost(op);
  return cost === null ? "" : `${ECHO_LABEL[cost.color]} ${cost.amount}`;
}

/** 残響の量「紅響 3・蒼響 0・…」（数字は荷札と書付の下端だけ） */
export function echoWalletText(craft: Readonly<CraftSave>): string {
  return TRAIT_COLORS.map((c) => `${ECHO_LABEL[c]} ${craft.echoes[c]}`).join("・");
}

// -----------------------------------------------------------------------------
// 物の引き当て
// -----------------------------------------------------------------------------

function findItem(profile: Readonly<Profile>, id: string): Item | null {
  const inStash = profile.stash.find((it) => it.id === id);
  if (inStash !== undefined) return inStash;
  for (const slot of LOOT_SLOTS) {
    const eq = profile.equipment[slot];
    if (eq?.id === id) return eq;
  }
  return null;
}

/** 鍛えられる物（倉庫か装備中。借り物と、見つからない物は null） */
export function forgeItem(profile: Readonly<Profile>, id: string | null): Item | null {
  if (id === null) return null;
  const item = findItem(profile, id);
  return item === null || item.loaned === true ? null : item;
}

/** 装備中の物か（倉庫の物・見つからない物は false） */
export function isEquippedItem(profile: Readonly<Profile>, id: string): boolean {
  return LOOT_SLOTS.some((slot) => profile.equipment[slot]?.id === id);
}

/** その操作で subject が消えるか（砕く・倉庫の物を捧げる側にする注ぎ・移し） */
function consumesSubject(profile: Readonly<Profile>, subjectId: string, op: EchoOp): boolean {
  if (op === "shatter") return true;
  return forgeNeedsPartner(op) && !isEquippedItem(profile, subjectId);
}

/** その操作を選べない理由（選べるなら null）。2-4 の役割表 */
export function forgeOpBlock(profile: Readonly<Profile>, subjectId: string, op: EchoOp): string | null {
  const item = findItem(profile, subjectId);
  if (item === null) return MISSING_TEXT;
  if (item.loaned === true) return LOANED_TEXT;
  if (op === "shatter" && isEquippedItem(profile, subjectId)) return EQUIPPED_SHATTER_TEXT;
  // ラン中は拠点から持ち込んだ遺物を消せない（拠点の装備に残っている物なので、消すと残響だけ増える）
  if (isCarriedItem(profile, subjectId) && consumesSubject(profile, subjectId, op)) return CARRIED_TEXT;
  return null;
}

/** その物でその操作を選べるか（役割表だけを見る。性質の有無などは実行のときに crafting が断る） */
export function canForgeOp(profile: Readonly<Profile>, subjectId: string, op: EchoOp): boolean {
  return forgeOpBlock(profile, subjectId, op) === null;
}

/** 新しい手続き（操作を選んだところから） */
export function newForgeSession(subjectId: string, op: EchoOp | null = null): ForgeSession {
  return { subjectId, op, partnerId: null, pick: null };
}

/**
 * 相手の候補（注ぎ・移しだけ）。subject が倉庫なら同じ部位の受け手（装備中を先頭に、倉庫の他の物）、
 * subject が装備中なら同じ部位の倉庫の捧げる側。借り物は除く
 */
export function forgePartners(profile: Readonly<Profile>, session: Readonly<ForgeSession>): Item[] {
  if (session.op === null || !forgeNeedsPartner(session.op)) return [];
  const subject = forgeItem(profile, session.subjectId);
  if (subject === null) return [];
  const sameSlot = profile.stash.filter((it) => it.slot === subject.slot && it.id !== subject.id && it.loaned !== true);
  // 装備中の subject の相手は捧げる側（消える）なので、拠点から持ち込んだ遺物は並べない
  if (isEquippedItem(profile, subject.id)) return sameSlot.filter((it) => !isCarriedItem(profile, it.id));
  const worn = profile.equipment[subject.slot];
  return worn && worn.loaned !== true ? [worn, ...sameSlot] : sameSlot;
}

function chosenPartner(profile: Readonly<Profile>, session: Readonly<ForgeSession>): Item | null {
  if (session.partnerId === null) return null;
  return forgePartners(profile, session).find((it) => it.id === session.partnerId) ?? null;
}

/** 捧げる側（注ぎ・移し）。倉庫の物。相手が決まるまで装備中の subject の捧げる側は null */
export function forgeDonor(profile: Readonly<Profile>, session: Readonly<ForgeSession>): Item | null {
  const subject = forgeItem(profile, session.subjectId);
  if (subject === null) return null;
  return isEquippedItem(profile, subject.id) ? chosenPartner(profile, session) : subject;
}

/** 受け手（注ぎ・移し）。装備中の subject はそのもの、倉庫の subject は選んだ相手 */
export function forgeReceiver(profile: Readonly<Profile>, session: Readonly<ForgeSession>): Item | null {
  const subject = forgeItem(profile, session.subjectId);
  if (subject === null) return null;
  return isEquippedItem(profile, subject.id) ? subject : chosenPartner(profile, session);
}

/** 選ぶ行を持つ物（煽り・呼び戻し = subject、移し = 捧げる側） */
function pickSource(profile: Readonly<Profile>, session: Readonly<ForgeSession>): Item | null {
  if (session.op === "transfer") return forgeDonor(profile, session);
  return forgeItem(profile, session.subjectId);
}

/**
 * 選べる行（煽り = 誓約でない性質、呼び戻し = 呼び戻せる芽、移し = 芽吹いた性質と銘）。
 * 並びは性質の順 → 銘（書付の行の並びと同じ）
 */
export function forgePickOptions(profile: Readonly<Profile>, session: Readonly<ForgeSession>): ForgePick[] {
  const item = pickSource(profile, session);
  if (item === null || session.op === null) return [];
  switch (session.op) {
    case "stir":
      return item.affixes.flatMap((r, index): ForgePick[] => (isKeystoneKey(r.key) ? [] : [{ kind: "trait", index }]));
    case "recall":
      return (item.buds ?? []).flatMap((_, index): ForgePick[] => (canRecallBud(item, index) ? [{ kind: "bud", index }] : []));
    case "transfer": {
      const grown = item.affixes.flatMap((r, index): ForgePick[] => (r.origin === "bud" ? [{ kind: "trait", index }] : []));
      return item.inscription === undefined ? grown : [...grown, { kind: "inscription" }];
    }
    default:
      return [];
  }
}

function samePick(a: Readonly<ForgePick>, b: Readonly<ForgePick>): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "inscription" || b.kind === "inscription") return true;
  return a.index === b.index;
}

/** 選んだ行が今も選べるか */
function validPick(profile: Readonly<Profile>, session: Readonly<ForgeSession>): ForgePick | null {
  const pick = session.pick;
  if (pick === null) return null;
  return forgePickOptions(profile, session).some((p) => samePick(p, pick)) ? pick : null;
}

/** 選ぶ行の 1 行の文（性質の全文・「芽 A ／ B」・銘） */
export function forgePickLabel(profile: Readonly<Profile>, session: Readonly<ForgeSession>, pick: Readonly<ForgePick>): string {
  const item = pickSource(profile, session);
  if (item === null) return "";
  switch (pick.kind) {
    case "trait": {
      const roll = item.affixes[pick.index];
      return roll === undefined ? "" : describeTrait(roll).text;
    }
    case "bud": {
      const bud = item.buds?.[pick.index];
      if (bud === undefined) return "";
      const other = bud.options[bud.chosen === 0 ? 1 : 0];
      return `${formatAffix(bud.options[bud.chosen])} → ${formatAffix(other)}`;
    }
    case "inscription":
      return item.inscription === undefined ? "" : `銘「${item.inscription}」`;
  }
}

/** 今の段。操作が役割表で選べなければ操作の段に戻す */
export function forgeStep(profile: Readonly<Profile>, session: Readonly<ForgeSession>): ForgeStep {
  const op = session.op;
  if (op === null || !canForgeOp(profile, session.subjectId, op)) return "op";
  if (forgeNeedsPartner(op) && chosenPartner(profile, session) === null) return "partner";
  if (forgeNeedsPick(op) && validPick(profile, session) === null) return "pick";
  return "ready";
}

function transferWhat(pick: Readonly<ForgePick>): TransferWhat | null {
  if (pick.kind === "inscription") return { kind: "inscription" };
  return pick.kind === "trait" ? { kind: "bud", traitIndex: pick.index } : null;
}

/** 実行できる形の依頼（段が足りなければ null） */
export function forgeRequest(profile: Readonly<Profile>, session: Readonly<ForgeSession>): EchoRequest | null {
  if (forgeStep(profile, session) !== "ready") return null;
  const subject = forgeItem(profile, session.subjectId);
  const pick = validPick(profile, session);
  if (subject === null) return null;
  switch (session.op) {
    case "shatter":
      return { op: "shatter", item: subject };
    case "stir":
      return pick?.kind === "trait" ? { op: "stir", item: subject, traitIndex: pick.index } : null;
    case "recall":
      return pick?.kind === "bud" ? { op: "recall", item: subject, budIndex: pick.index } : null;
    case "pour":
    case "transfer":
      return partnerRequest(profile, session, pick);
    default:
      return null;
  }
}

function partnerRequest(profile: Readonly<Profile>, session: Readonly<ForgeSession>, pick: ForgePick | null): EchoRequest | null {
  const donor = forgeDonor(profile, session);
  const receiver = forgeReceiver(profile, session);
  if (donor === null || receiver === null) return null;
  if (session.op === "pour") return { op: "pour", item: donor, target: receiver };
  const what = pick === null ? null : transferWhat(pick);
  return what === null ? null : { op: "transfer", item: donor, target: receiver, what };
}

/** 結果が装備中の物に触れたか（作り替え・消えた物のどちらか） */
function touchesEquipment(profile: Readonly<Profile>, result: Extract<EchoResult, { ok: true }>): boolean {
  const ids = [...result.consumedIds, ...(result.item === null ? [] : [result.item.id])];
  return ids.some((id) => isEquippedItem(profile, id));
}

/**
 * 実行の後の手続き: subject が消えたら（砕く・倉庫の捧げる側）受け手を subject に替えて操作から選び直す。
 * 残るなら相手を外し、呼び戻し・移しの行も外す（行の意味が変わる）。煽りは同じ性質をすぐ煽り直せるよう行を残す
 */
function advanceSession(session: ForgeSession, result: Extract<EchoResult, { ok: true }>): void {
  session.partnerId = null;
  if (result.consumedIds.includes(session.subjectId)) {
    session.subjectId = result.item?.id ?? session.subjectId;
    session.op = null;
    session.pick = null;
    return;
  }
  if (result.op !== "stir") session.pick = null;
}

/**
 * 実行する。段が足りなければ次の手、残響が足りなければ理由を返して何も変えない。
 * 成功したら残響と profile を保存し、装備中の物が変わったら applyEquipmentChange（畳み直し・芽の付け直し・保存）。
 * session は次の段へ進める（advanceSession）
 */
export function executeForge(state: GameState, craft: CraftSave, session: ForgeSession): { ok: boolean; message: string } {
  const req = forgeRequest(state.profile, session);
  if (req === null) {
    const block = session.op === null ? null : forgeOpBlock(state.profile, session.subjectId, session.op);
    return { ok: false, message: block ?? FORGE_STEP_PROMPT[forgeStep(state.profile, session)] };
  }
  const result = craftEcho(craft, req);
  if (!result.ok) return { ok: false, message: result.message };
  // 反映の前に見る（砕いた物・捧げた物は反映すると消える）
  const equipmentTouched = touchesEquipment(state.profile, result);
  applyEchoResult(state.profile, result);
  saveCraft(craft);
  if (equipmentTouched) applyEquipmentChange(state);
  else saveProfile(state.profile);
  pushSfx(state, FORGE_SFX[result.op]);
  advanceSession(session, result);
  return { ok: true, message: result.message };
}
