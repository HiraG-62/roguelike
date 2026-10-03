import { saveStorage } from "../save/backend";
import { STASH_CAPACITY } from "../data/tuning";
import { type UltimateDef, defaultUltimate, isUltimateKey, ultimateDef } from "../data/ultimates";
import { MOVESET_KEYS, type MovesetKey } from "../data/weapons";
import { migrateItem } from "./migrate";
import { isHurtKind } from "../core/hurt";
import {
  type AffixRoll,
  type BudChoice,
  type BudOffer,
  type Equipment,
  type Item,
  LOOT_SLOTS,
  type Profile,
  type ProfileMeta,
  type Provenance,
  type HistoryGrudge,
  type HistoryKiller,
  type RunHistoryEntry,
  type Slot,
  SLOTS,
  TRAIT_COLORS,
  type TraitColor,
  type TraitOrigin,
  createEmptyEquipment,
  createEmptyProfile,
  createEmptyProvenance,
  normalizeSlot,
} from "./types";

/** 保存のキー（Electron 版は SAVE_FILES でファイル名に写る）。バージョンが変わったら数値を上げる */
export const PROFILE_KEY = "roguelike.profile.v1";

/**
 * プロフィールの version は 1 のまま据え置く（キーも同じ）。
 * アイテム単位で旧形式（prefix / suffix / tier）を検出し、読み込み時に migrateItem で新形式へ変換する
 */
const CURRENT_VERSION = 1;
const TRAIT_ORIGINS: readonly TraitOrigin[] = ["found", "bud", "named", "innate"];
const BUD_OPTION_COUNT = 2;
/** ラン履歴の保持件数（最新が先頭） */
export const HISTORY_LIMIT = 20;

/** 記録された run の結果。recordRun の入力 */
export interface RunResult {
  depth: number;
  kills: number;
  score: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isColor(v: unknown): v is TraitColor {
  return typeof v === "string" && (TRAIT_COLORS as readonly string[]).includes(v);
}

function isOrigin(v: unknown): v is TraitOrigin {
  return typeof v === "string" && (TRAIT_ORIGINS as readonly string[]).includes(v);
}

function optionalNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function nonNegativeInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** AffixRoll として成立しているかを検証し、既知のフィールドだけのコピーを返す。壊れていたら null */
function sanitizeRoll(v: unknown): AffixRoll | null {
  if (!isRecord(v)) return null;
  if (typeof v.key !== "string") return null;
  if (typeof v.value !== "number") return null;
  if (v.value2 !== undefined && typeof v.value2 !== "number") return null;
  const roll: AffixRoll = { key: v.key, value: v.value };
  if (typeof v.value2 === "number") roll.value2 = v.value2;
  // 旧形式の kind / tier は migrateItem が tier → 揺らぎの換算に使う
  if (v.kind === "prefix" || v.kind === "suffix") roll.kind = v.kind;
  const tier = optionalNumber(v.tier);
  if (tier !== undefined) roll.tier = tier;
  if (isColor(v.color)) roll.color = v.color;
  const nominal = optionalNumber(v.nominal);
  if (nominal !== undefined) roll.nominal = nominal;
  const nominal2 = optionalNumber(v.nominal2);
  if (nominal2 !== undefined) roll.nominal2 = nominal2;
  const flux = optionalNumber(v.flux);
  if (flux !== undefined) roll.flux = flux;
  if (v.inverted === true) roll.inverted = true;
  if (isOrigin(v.origin)) roll.origin = v.origin;
  // 2026-09 第 2 弾の残響の操作（脱色・張り）。旧セーブには無い
  if (v.colorless === true) roll.colorless = true;
  if (v.tensed === true) roll.tensed = true;
  return roll;
}

function sanitizeProvenance(v: unknown): Provenance | undefined {
  if (!isRecord(v)) return undefined;
  const p = createEmptyProvenance();
  p.kills = nonNegativeInt(v.kills);
  p.justDodges = nonNegativeInt(v.justDodges);
  p.hurtTaken = nonNegativeInt(v.hurtTaken);
  p.bosses = nonNegativeInt(v.bosses);
  p.roomsCleared = nonNegativeInt(v.roomsCleared);
  p.floorsCleared = nonNegativeInt(v.floorsCleared);
  p.deepest = nonNegativeInt(v.deepest);
  // 2026-09 追加の来歴。旧セーブには無いので 0 になる
  p.staggers = nonNegativeInt(v.staggers);
  p.counters = nonNegativeInt(v.counters);
  p.skillCasts = nonNegativeInt(v.skillCasts);
  p.eliteKills = nonNegativeInt(v.eliteKills);
  p.lastKills = nonNegativeInt(v.lastKills);
  // 2026-09 第 2 弾の来歴
  p.weakHits = nonNegativeInt(v.weakHits);
  p.resistedHits = nonNegativeInt(v.resistedHits);
  p.terrainKills = nonNegativeInt(v.terrainKills);
  p.favoredKills = nonNegativeInt(v.favoredKills);
  p.chargedHits = nonNegativeInt(v.chargedHits);
  p.branchHits = nonNegativeInt(v.branchHits);
  // 2026-09-24 第 4 弾の来歴（帰還）
  p.returns = nonNegativeInt(v.returns);
  if (isRecord(v.killsByEnemy)) {
    for (const [key, n] of Object.entries(v.killsByEnemy)) p.killsByEnemy[key] = nonNegativeInt(n);
  }
  return p;
}

function sanitizeOptions(v: unknown): [AffixRoll, AffixRoll] | null {
  if (!Array.isArray(v) || v.length !== BUD_OPTION_COUNT) return null;
  const a = sanitizeRoll(v[0]);
  const b = sanitizeRoll(v[1]);
  return a === null || b === null ? null : [a, b];
}

function sanitizeBudOffer(v: unknown): BudOffer | null {
  if (!isRecord(v) || typeof v.milestone !== "string") return null;
  const options = sanitizeOptions(v.options);
  return options === null ? null : { milestone: v.milestone, options };
}

function sanitizeBuds(v: unknown): BudChoice[] {
  if (!Array.isArray(v)) return [];
  const out: BudChoice[] = [];
  for (const raw of v) {
    const offer = sanitizeBudOffer(raw);
    if (offer === null || !isRecord(raw)) continue;
    const bud: BudChoice = { ...offer, chosen: raw.chosen === 1 ? 1 : 0 };
    if (raw.recalled === true) bud.recalled = true;
    out.push(bud);
  }
  return out;
}

function sanitizeStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 新形式の成長フィールド（来歴・余白・芽・銘）。provenance が無ければ旧形式なので何もしない */
function copyGrowthFields(item: Item, v: Record<string, unknown>): void {
  const provenance = sanitizeProvenance(v.provenance);
  if (provenance === undefined) return;
  item.provenance = provenance;
  item.margin = nonNegativeInt(v.margin);
  item.marginMax = Math.max(item.margin, nonNegativeInt(v.marginMax));
  item.milestones = sanitizeStrings(v.milestones);
  item.buds = sanitizeBuds(v.buds);
  item.budOffer = sanitizeBudOffer(v.budOffer);
  if (typeof v.inscription === "string" && v.inscription.length > 0) item.inscription = v.inscription;
  if (typeof v.namedKey === "string") item.namedKey = v.namedKey;
  const reforged = nonNegativeInt(v.reforged);
  if (reforged > 0) item.reforged = reforged;
}

/** 地金。無ければ undefined（migrateItem が空で補う）。壊れた行だけ捨てる（地金は抽選し直せないので遺物ごとは捨てない） */
function sanitizeInnate(v: unknown): AffixRoll[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map(sanitizeRoll).filter((r): r is AffixRoll => r !== null);
}

/**
 * 消した器（docs/ideas/gun-bases-review.md 0-1。投擲・旧戦輪の器を武器種ごと消した）。
 * 開発段階なので移行は作らず、この器の遺物は読み込みで捨てる
 */
export const REMOVED_BASE_KEYS: ReadonlySet<string> = new Set([
  "throwingKnives",
  "blowgun",
  "ricochetGun",
  "seekerOrb",
  "chakram",
  "returnChakram",
  "flyingBlade",
]);

/** Item として最低限成立しているかを検証し、新形式へ移行して返す。壊れていたら・消した器なら null */
function sanitizeItem(v: unknown): Item | null {
  if (!isRecord(v)) return null;
  const { id, seed, baseKey, slot, rarity, itemLevel, name, implicit, affixes, foundDepth, foundAt } = v;
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof seed !== "number") return null;
  if (typeof baseKey !== "string" || baseKey.length === 0) return null;
  if (REMOVED_BASE_KEYS.has(baseKey)) return null;
  // 旧セーブの weapon / gun スロットは右手（mainHand）へ読み替える（冪等: 新形式にも通る）
  const normalizedSlot = normalizeSlot(slot);
  if (normalizedSlot === null) return null;
  if (rarity !== "normal" && rarity !== "magic" && rarity !== "rare" && rarity !== "unique") return null;
  if (typeof itemLevel !== "number") return null;
  if (typeof name !== "string") return null;
  const implicitRoll = implicit === null ? null : sanitizeRoll(implicit);
  if (implicit !== null && implicitRoll === null) return null;
  if (!Array.isArray(affixes)) return null;
  const rolls = affixes.map(sanitizeRoll);
  if (rolls.some((r) => r === null)) return null;
  if (typeof foundDepth !== "number") return null;
  if (typeof foundAt !== "number") return null;
  const item: Item = {
    id,
    seed,
    baseKey,
    slot: normalizedSlot,
    rarity,
    itemLevel,
    name,
    implicit: implicitRoll,
    affixes: rolls.filter((r): r is AffixRoll => r !== null),
    foundDepth,
    foundAt,
  };
  const innate = sanitizeInnate(v.innate);
  if (innate !== undefined) item.innate = innate;
  // 地金の上振れ。壊れていれば捨て、migrateItem が行から復元する
  const innateLuck = optionalNumber(v.innateLuck);
  if (innateLuck !== undefined && innateLuck >= 0) item.innateLuck = innateLuck;
  copyGrowthFields(item, v);
  return migrateItem(item);
}

/**
 * equipment を読み込む。旧セーブの weapon スロットは空いていれば右手へ、埋まっていれば倉庫へ。
 * 旧セーブの gun スロットは常に倉庫へ（借り物なら捨てる）。overflow（stash）の先頭に積む
 */
function sanitizeEquipment(v: unknown, overflow: Item[]): Equipment {
  const out = createEmptyEquipment();
  if (!isRecord(v)) return out;
  for (const slot of SLOTS) {
    const item = sanitizeItem(v[slot]);
    if (item && item.slot === slot) out[slot] = item;
  }
  const legacyWeapon = sanitizeItem(v.weapon);
  if (legacyWeapon && legacyWeapon.slot === "mainHand") {
    if (out.mainHand === null) out.mainHand = legacyWeapon;
    else overflow.unshift(legacyWeapon);
  }
  const legacyGun = sanitizeItem(v.gun);
  if (legacyGun && legacyGun.slot === "mainHand" && legacyGun.loaned !== true) {
    overflow.unshift(legacyGun);
  }
  return out;
}

function sanitizeStash(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  const out: Item[] = [];
  for (const raw of v) {
    const item = sanitizeItem(raw);
    if (item) out.push(item);
  }
  return out;
}

/** RunHistoryEntry として最低限成立しているかを検証する。壊れていたら null */
function sanitizeHistoryEntry(v: unknown): RunHistoryEntry | null {
  if (!isRecord(v)) return null;
  const { date, seedText, depth, kills, score, bestCombo, durationSec, cause } = v;
  if (typeof date !== "number") return null;
  if (typeof seedText !== "string") return null;
  if (typeof depth !== "number") return null;
  if (typeof kills !== "number") return null;
  if (typeof score !== "number") return null;
  if (typeof bestCombo !== "number") return null;
  if (typeof durationSec !== "number") return null;
  if (cause !== undefined && typeof cause !== "string") return null;
  const entry: RunHistoryEntry = { date, seedText, depth, kills, score, bestCombo, durationSec };
  if (typeof cause === "string") entry.cause = cause;
  return { ...entry, ...sanitizeHistoryExtras(v) };
}

/** 履歴に残す修飾子の上限（主 + 添え） */
const HISTORY_ELITES_MAX = 2;
/** 見習い（既定のジョブ）は書かない */
const DEFAULT_JOB = "none";
type HistoryExtras = Pick<RunHistoryEntry, "killer" | "grudge" | "avenged" | "tier" | "job" | "hurts" | "justDodges" | "counters" | "noHurtFloors">;

/**
 * 段取り 9 の任意項目（死因・仇の種・位階・前回比の回数）。壊れた欄は黙って捨て、0・空は書かない（hurts だけは 0 も残す）。
 * 敵や修飾子の key の実在は読む側（meta/runMetaSetup.ts・meta/deathReport.ts）が確かめる
 */
function sanitizeHistoryExtras(v: Record<string, unknown>): HistoryExtras {
  const out: HistoryExtras = {};
  const killer = sanitizeKiller(v.killer);
  if (killer) out.killer = killer;
  const grudge = sanitizeGrudge(v.grudge);
  if (grudge) out.grudge = grudge;
  if (v.avenged === true) out.avenged = true;
  if (typeof v.job === "string" && v.job.length > 0 && v.job !== DEFAULT_JOB) out.job = v.job;
  for (const key of ["tier", "justDodges", "counters", "noHurtFloors"] as const) {
    const n = positiveCount(v[key]);
    if (n > 0) out[key] = n;
  }
  // 被弾の回数は 0 でも残す（前回比の相手になれる段取り 9 以降の行の印。meta/deathReport.ts の previousComparable）
  if (typeof v.hurts === "number" && Number.isFinite(v.hurts) && v.hurts >= 0) out.hurts = Math.floor(v.hurts);
  return out;
}

/** 0 以上の整数（壊れた値は 0） */
function positiveCount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function sanitizeEliteList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, HISTORY_ELITES_MAX);
}

function sanitizeKiller(v: unknown): HistoryKiller | null {
  if (!isRecord(v) || !isHurtKind(v.kind) || typeof v.key !== "string") return null;
  const killer: HistoryKiller = { kind: v.kind, key: v.key };
  const elites = sanitizeEliteList(v.elites);
  if (elites.length > 0) killer.elites = elites;
  if (v.nemesis === true) killer.nemesis = true;
  return killer;
}

function sanitizeGrudge(v: unknown): HistoryGrudge | null {
  if (!isRecord(v) || typeof v.key !== "string" || v.key.length === 0) return null;
  return { key: v.key, elites: sanitizeEliteList(v.elites) };
}

function sanitizeHistory(v: unknown): RunHistoryEntry[] {
  if (!Array.isArray(v)) return [];
  const out: RunHistoryEntry[] = [];
  for (const raw of v) {
    const entry = sanitizeHistoryEntry(raw);
    if (entry) out.push(entry);
  }
  return out.slice(0, HISTORY_LIMIT);
}

function sanitizeMeta(v: unknown): ProfileMeta {
  if (!isRecord(v)) return { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0, history: [] };
  const runs = typeof v.runs === "number" ? v.runs : 0;
  const bestDepth = typeof v.bestDepth === "number" ? v.bestDepth : 0;
  const totalKills = typeof v.totalKills === "number" ? v.totalKills : 0;
  const bestScore = typeof v.bestScore === "number" ? v.bestScore : 0;
  const history = sanitizeHistory(v.history);
  const meta: ProfileMeta = { runs, bestDepth, totalKills, bestScore, history };
  // 踏破の回数と最高位階（段取り 9 の任意項目。無し・壊れた値・0 は書かない）
  const clears = positiveCount(v.clears);
  if (clears > 0) meta.clears = clears;
  const bestClearTier = positiveCount(v.bestClearTier);
  if (clears > 0 && bestClearTier > 0) meta.bestClearTier = bestClearTier;
  const seenAt = sanitizeSeenAt(v.seenAt);
  if (seenAt !== undefined) meta.seenAt = seenAt;
  return meta;
}

/** 新着の判定の時刻（ui/seen.ts）。装備できる部位の key で、有限かつ 0 以上の数だけ通す。1 つも無ければ書かない */
function sanitizeSeenAt(v: unknown): Partial<Record<Slot, number>> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Partial<Record<Slot, number>> = {};
  let count = 0;
  for (const slot of LOOT_SLOTS) {
    const t = v[slot];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) continue;
    out[slot] = t;
    count += 1;
  }
  return count > 0 ? out : undefined;
}

function isMovesetKey(v: string): v is MovesetKey {
  return (MOVESET_KEYS as readonly string[]).includes(v);
}

/**
 * 武器種ごとの奥義の選択を検証する。武器種の key・定義済みの奥義の key・その奥義がその武器種のもの、の
 * 3 つが揃う組だけを通す（壊れた組は黙って捨て、その武器種は既定 = 1 本目に落ちる）。1 組も無ければ undefined。
 * リプレイの sanitizeLoadout も同じ規則で通す
 */
export function sanitizeUltimateChoices(v: unknown): Partial<Record<MovesetKey, string>> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Partial<Record<MovesetKey, string>> = {};
  let count = 0;
  for (const [moveset, key] of Object.entries(v)) {
    if (!isMovesetKey(moveset) || !isUltimateKey(key)) continue;
    if (ultimateDef(key)?.moveset !== moveset) continue;
    out[moveset] = key;
    count += 1;
  }
  return count > 0 ? out : undefined;
}

/** 武器種で選んでいる奥義（選んでいない・壊れているなら 1 本目）。拠点の武器掛け・装備画面の表示用 */
export function ultimateChoice(profile: Readonly<Pick<Profile, "ultimates">>, moveset: MovesetKey): UltimateDef {
  const key = profile.ultimates?.[moveset];
  const def = key === undefined ? undefined : ultimateDef(key);
  return def !== undefined && def.moveset === moveset ? def : defaultUltimate(moveset);
}

/** 武器種の奥義を選ぶ（保存は呼び出し側が saveProfile）。その武器種の奥義でない key なら何もせず false */
export function chooseUltimate(profile: Profile, moveset: MovesetKey, key: string): boolean {
  if (ultimateDef(key)?.moveset !== moveset) return false;
  profile.ultimates = { ...profile.ultimates, [moveset]: key };
  return true;
}

/** 保存されたプロフィールを読み込む。無い/壊れている/version 不一致なら空プロフィール */
export function loadProfile(storage?: Storage): Profile {
  const target = storage ?? saveStorage();
  if (!target) return createEmptyProfile();

  let raw: string | null;
  try {
    raw = target.getItem(PROFILE_KEY);
  } catch {
    return createEmptyProfile();
  }
  if (!raw) return createEmptyProfile();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyProfile();
  }
  if (!isRecord(parsed) || parsed.version !== CURRENT_VERSION) return createEmptyProfile();

  const stash = sanitizeStash(parsed.stash);
  const equipment = sanitizeEquipment(parsed.equipment, stash);
  const profile: Profile = { version: CURRENT_VERSION, equipment, stash, meta: sanitizeMeta(parsed.meta) };
  const ultimates = sanitizeUltimateChoices(parsed.ultimates);
  if (ultimates !== undefined) profile.ultimates = ultimates;
  const carry = sanitizeCarry(parsed.carry);
  if (carry !== undefined) profile.carry = carry;
  return profile;
}

function isLootSlot(v: unknown): v is Slot {
  return typeof v === "string" && (LOOT_SLOTS as readonly string[]).includes(v);
}

/** 持ち込みの印。装備できる部位の key だけを重ねずに通す（数の上限は loot/runGear.ts が読むときに切る）。配列でなければ無し */
function sanitizeCarry(v: unknown): Slot[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Slot[] = [];
  for (const raw of v) if (isLootSlot(raw) && !out.includes(raw)) out.push(raw);
  return out;
}

/** ラン用のプロフィール（loot/runGear.ts の makeRunProfile。拠点から持ち込んだ遺物の id を持つ）か */
export function isRunProfile(profile: Readonly<Pick<Profile, "carriedIds">>): boolean {
  return profile.carriedIds !== undefined;
}

function isLoaned(item: Item | null | undefined): boolean {
  return item?.loaned === true;
}

/** 借り物を装備・倉庫から除いた写し（保存用）。借り物が無ければそのまま返す */
function withoutLoaned(profile: Profile): Profile {
  const equipped = SLOTS.some((slot) => isLoaned(profile.equipment[slot]));
  if (!equipped && !profile.stash.some(isLoaned)) return profile;
  const equipment = { ...profile.equipment };
  for (const slot of SLOTS) if (isLoaned(equipment[slot])) equipment[slot] = null;
  return { ...profile, equipment, stash: profile.stash.filter((it) => !isLoaned(it)) };
}

/**
 * ランが終わったら借り物を装備・倉庫から外す（main.ts の endRun が呼ぶ）。外したら true。
 * 借りたときに押し出した元の装備が倉庫に残っていれば、同じスロットへ戻す
 */
export function returnLoaned(profile: Profile): boolean {
  const replaced = SLOTS.map((slot) => ({ slot, id: profile.equipment[slot]?.loaned === true ? profile.equipment[slot]?.loanedReplaces : undefined }));
  const before = withoutLoaned(profile);
  if (before === profile) return false;
  profile.equipment = before.equipment;
  profile.stash = before.stash;
  for (const { slot, id } of replaced) {
    if (id === undefined) continue;
    const idx = profile.stash.findIndex((it) => it.id === id && it.slot === slot);
    const original = profile.stash[idx];
    if (!original || profile.equipment[slot]) continue;
    profile.stash.splice(idx, 1);
    profile.equipment[slot] = original;
  }
  return true;
}

/**
 * プロフィールを保存する。借り物は書かない。容量超過などの失敗は握りつぶす。保存先が無い環境では何もしない。
 * ラン用のプロフィール（isRunProfile）は何もしない: ラン中に拾った遺物（袋）は持ち帰りを選ぶまで拠点の物ではないので、
 * step の中の拾得・芽・ラン記録の保存がラン用のプロフィールで保存先を上書きしないようにする（拠点の側は main.ts が終わりに保存する）
 */
export function saveProfile(profile: Profile, storage?: Storage): void {
  if (isRunProfile(profile)) return;
  const target = storage ?? saveStorage();
  if (!target) return;
  try {
    target.setItem(PROFILE_KEY, JSON.stringify(withoutLoaned(profile)));
  } catch (err) {
    console.warn("saveProfile failed", err);
  }
}

/** stash にアイテムを追加する。STASH_CAPACITY を超える場合は追加せず false を返す */
export function addToStash(profile: Profile, item: Item): boolean {
  if (profile.stash.length >= STASH_CAPACITY) return false;
  profile.stash.push(item);
  return true;
}

/**
 * stash のアイテムを装備する。同スロットに装備済みがあれば入れ替えて stash へ戻す。
 * 戻り値は外した装備（無ければ null）。itemId が stash に無ければ何もせず null
 */
export function equipItem(profile: Profile, itemId: string): Item | null {
  const idx = profile.stash.findIndex((it) => it.id === itemId);
  if (idx < 0) return null;
  const item = profile.stash[idx];
  if (!item) return null;
  profile.stash.splice(idx, 1);

  const previous = profile.equipment[item.slot];
  profile.equipment[item.slot] = item;
  if (previous) profile.stash.push(previous);
  return previous;
}

/** 装備スロットを外して stash に戻す */
export function unequipItem(profile: Profile, slot: Slot): void {
  const item = profile.equipment[slot];
  if (!item) return;
  profile.equipment[slot] = null;
  profile.stash.push(item);
}

/** stash のアイテムを分解（削除）する。成功したら true */
export function salvageItem(profile: Profile, itemId: string): boolean {
  const idx = profile.stash.findIndex((it) => it.id === itemId);
  if (idx < 0) return false;
  profile.stash.splice(idx, 1);
  return true;
}

/** ラン終了時のメタ集計を更新する */
export function recordRun(profile: Profile, result: RunResult): void {
  const meta = profile.meta;
  meta.runs += 1;
  meta.bestDepth = Math.max(meta.bestDepth, result.depth);
  meta.totalKills += result.kills;
  meta.bestScore = Math.max(meta.bestScore, result.score);
}

/** 踏破を数え、踏破した最高位階を更新する（main.ts の endRun が status === "cleared" のとき 1 回） */
export function recordClear(profile: Profile, tier: number): void {
  const meta = profile.meta;
  meta.clears = (meta.clears ?? 0) + 1;
  const clean = positiveCount(tier);
  if (clean > (meta.bestClearTier ?? 0)) meta.bestClearTier = clean;
}

/** ラン履歴の先頭に 1 件追加し、最新 HISTORY_LIMIT 件だけ残す */
export function pushRunHistory(profile: Profile, entry: RunHistoryEntry): void {
  const history = profile.meta.history ?? [];
  history.unshift(entry);
  profile.meta.history = history.slice(0, HISTORY_LIMIT);
}
