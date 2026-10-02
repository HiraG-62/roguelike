import { CARRY } from "../data/tuning";
import { addToStash } from "./profile";
import { type Item, LOOT_SLOTS, type Profile, type Slot, createEmptyEquipment } from "./types";

/**
 * ランへの装備の持ち込みと、ランの終わりの持ち帰り（docs/ideas/run-arc.md 2 章。2026-09-28 / 10-02 のユーザーの決定）。
 * - 持ち込み: 拠点の装備のうち、右手（CARRY.weaponFree なら常に）と「持ち込み」の印の部位（CARRY.carrySlots まで）だけでランを始める
 * - 袋: ラン用のプロフィールの stash。ラン中に拾った遺物はここへ入り、拠点の倉庫には入らない（ラン用のプロフィールは保存しない）
 * - 持ち帰り: ランの終わりに袋と装備中のラン内の遺物から枠（死亡 CARRY.keepOnDeath・踏破 CARRY.keepOnClear）の数だけ選ぶ。残りは消える
 * 持ち込んだ遺物は拠点と同じオブジェクトなので、来歴・芽はそのまま拠点の側に積もる（残響で作り替えた物は settleRun が戻す）
 */

/** 右手。CARRY.weaponFree なら印に関わらず持ち込む */
const WEAPON_SLOT: Slot = "mainHand";

function weaponFree(): boolean {
  return CARRY.weaponFree;
}

/** 印を付け外しできる部位（右手が枠の外なら右手を除く） */
export function carryableSlots(): Slot[] {
  return weaponFree() ? LOOT_SLOTS.filter((s) => s !== WEAPON_SLOT) : [...LOOT_SLOTS];
}

/** 印の既定（未設定のとき）: 装備している部位を部位の並び順に枠の数まで */
function defaultMarks(profile: Readonly<Pick<Profile, "equipment">>): Slot[] {
  return carryableSlots()
    .filter((s) => profile.equipment[s] !== null)
    .slice(0, CARRY.carrySlots);
}

/** 今の印（未設定なら既定。枠を超えた分・印を付けられない部位は切る） */
export function carryMarks(profile: Readonly<Pick<Profile, "equipment" | "carry">>): Slot[] {
  if (profile.carry === undefined) return defaultMarks(profile);
  const allowed = carryableSlots();
  return profile.carry.filter((s) => allowed.includes(s)).slice(0, CARRY.carrySlots);
}

/** ランへ持ち込む部位（右手が枠の外なら右手を先頭に足す）。部位の並び順 */
export function carriedSlots(profile: Readonly<Pick<Profile, "equipment" | "carry">>): Slot[] {
  const marks = carryMarks(profile);
  return LOOT_SLOTS.filter((s) => marks.includes(s) || (weaponFree() && s === WEAPON_SLOT));
}

/** その部位が持ち込みか（右手が枠の外なら右手は常に true） */
export function isCarriedSlot(profile: Readonly<Pick<Profile, "equipment" | "carry">>, slot: Slot): boolean {
  return carriedSlots(profile).includes(slot);
}

/** 印を付け外しできる部位か（右手が枠の外なら右手は常に持ち込みなので不可） */
export function canMarkCarry(slot: Slot): boolean {
  return carryableSlots().includes(slot);
}

/** 印の付け外しの結果。full = 枠が埋まっていて付けられない、fixed = 付け外しできない部位 */
export type CarryToggle = "on" | "off" | "full" | "fixed";

/** 部位の「持ち込み」の印を付け外しする（拠点の装備画面）。保存は呼び出し側 */
export function toggleCarry(profile: Profile, slot: Slot): CarryToggle {
  if (!canMarkCarry(slot)) return "fixed";
  const marks = carryMarks(profile);
  if (marks.includes(slot)) {
    profile.carry = marks.filter((s) => s !== slot);
    return "off";
  }
  if (marks.length >= CARRY.carrySlots) return "full";
  profile.carry = carryableSlots().filter((s) => s === slot || marks.includes(s));
  return "on";
}

/**
 * ラン用のプロフィールを作る。装備は持ち込む部位だけ（同じオブジェクトの参照）、倉庫は空の袋、
 * meta（ラン数・履歴）と奥義の選択は拠点と同じ参照。carriedIds を持つので保存されない（loot/profile.ts の saveProfile）
 */
export function makeRunProfile(hub: Profile, carry: readonly Slot[]): Profile {
  const equipment = createEmptyEquipment();
  const carriedIds: string[] = [];
  for (const slot of carry) {
    const item = hub.equipment[slot];
    if (!item) continue;
    equipment[slot] = item;
    carriedIds.push(item.id);
  }
  const run: Profile = { version: hub.version, equipment, stash: [], meta: hub.meta, carriedIds };
  if (hub.ultimates !== undefined) run.ultimates = hub.ultimates;
  return run;
}

/** 拠点から持ち込んだ遺物か（ラン用のプロフィールでなければ false） */
export function isCarriedItem(profile: Readonly<Pick<Profile, "carriedIds">>, id: string): boolean {
  return profile.carriedIds?.includes(id) === true;
}

/** ランの終わり方。踏破だけ持ち帰りの枠が広い */
export type RunEnd = "fallen" | "cleared";

/** 持ち帰れる数（荷車は後の段でここに足す） */
export function carryBackLimit(end: RunEnd): number {
  return Math.max(0, Math.floor(end === "cleared" ? CARRY.keepOnClear : CARRY.keepOnDeath));
}

function equippedItems(profile: Readonly<Profile>): Item[] {
  return LOOT_SLOTS.map((s) => profile.equipment[s]).filter((it): it is Item => it !== null);
}

/** 持ち帰りの候補: 装備中のラン内の遺物（部位の並び）→ 袋（拾った順）。持ち込んだ遺物と借り物は除く */
export function carryBackCandidates(run: Readonly<Profile>): Item[] {
  const own = (it: Item): boolean => it.loaned !== true && !isCarriedItem(run, it.id);
  return [...equippedItems(run).filter(own), ...run.stash.filter(own)];
}

/**
 * 持ち込んだ遺物が残響で作り替えられていたら（別のオブジェクトに置き換わる）、拠点の装備の同じ id の物を差し替える。
 * 芽・来歴は同じオブジェクトに積もるので何もしなくても残る
 */
function syncCarried(hub: Profile, run: Readonly<Profile>): void {
  const all = [...equippedItems(run), ...run.stash];
  for (const id of run.carriedIds ?? []) {
    const latest = all.find((it) => it.id === id);
    if (latest === undefined) continue;
    const slot = LOOT_SLOTS.find((s) => hub.equipment[s]?.id === id);
    if (slot !== undefined) hub.equipment[slot] = latest;
  }
}

/**
 * ランを畳む: 持ち帰りに選んだ遺物（keepIds。候補にある物だけ）を拠点の倉庫へ入れ、残りの袋は捨てる。
 * 持ち込んだ遺物の変化は拠点の装備へ戻す。戻り値は倉庫へ入った遺物（倉庫が満杯なら入らない）。保存は呼び出し側
 */
export function settleRun(hub: Profile, run: Profile, keepIds: readonly string[]): Item[] {
  syncCarried(hub, run);
  const kept: Item[] = [];
  for (const item of carryBackCandidates(run)) {
    if (!keepIds.includes(item.id)) continue;
    if (addToStash(hub, item)) kept.push(item);
  }
  // 2 度畳んでも倉庫へ二重に入らないよう、ラン内の遺物を手放す
  run.stash = [];
  for (const slot of LOOT_SLOTS) {
    const item = run.equipment[slot];
    if (item && !isCarriedItem(run, item.id)) run.equipment[slot] = null;
  }
  return kept;
}
