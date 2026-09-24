import type { Keyword } from "../core/keywords";
import type { FloorKind, GameState, RoomKind } from "../core/state";
import { REACTION_KEYS, type ReactionKey, type StatusKind } from "../core/status";
import { ENEMIES, type EnemyDef } from "../data/enemies";
import { baseDef } from "../loot/bases";
import { UNIQUES, type UniqueDef } from "../loot/named";
import type { Item, Profile } from "../loot/types";
import { FLOOR_KINDS, floorKindLabel } from "../system/biomes";
import { BOONS, BOON_KEYS, type BoonDef } from "../system/boonDefs";
import { STATUS_KEYWORDS } from "../system/keywords";
import { ROOM_KIND_LABEL } from "../system/specialRooms";
import { COMBOS } from "../skills/combos";
import { SLOT_LABEL } from "../ui/inventoryLayout";
import { CHAIN_SEPARATOR, REACTION_PARTS, chainLabel, isChainKey, isKeyword, isStatusKind, reactionHint } from "./linkParts";
import {
  LINK_KIND_LABEL,
  type LinkRun,
  comboPartLabels,
  createLinkRun,
  isComboKey,
  isLinkId,
  linkId,
  linkName,
} from "./links";

// 連鎖・反応の構成は src/meta/linkParts.ts へ移した（連携の 3 系統をまとめるため）。既存の import 先を保つ
export { CHAIN_SEPARATOR, REACTION_PARTS, type ReactionParts, chainLabel, isChainKey, reactionHint } from "./linkParts";

/**
 * 図鑑（docs/ideas/meta-and-weapons.md 4-2〜4-5、docs/ideas/synergy-web.md 5-a）。
 * ラン中は state.codexRun に軽い Set / Map で積むだけ（src/meta/runRecord.ts）。localStorage には触れず、
 * ラン終了時に main.ts が recordCodex で保存データへ畳む。未発見は「？」と片側だけのヒントで見せ、シナジー探しを促す
 */

export const CODEX_TABS = ["enemy", "relic", "boon", "link", "place"] as const;
export type CodexTab = (typeof CODEX_TABS)[number];

export const CODEX_TAB_LABEL: Readonly<Record<CodexTab, string>> = {
  enemy: "敵",
  relic: "遺物",
  boon: "祝福",
  link: "連携",
  place: "場所",
};

/** 未発見の表示 */
export const UNKNOWN_NAME = "？？？";
const UNKNOWN_PART = "？";

// -----------------------------------------------------------------------------
// ラン中の記録（state.codexRun）
// -----------------------------------------------------------------------------

export interface CodexRun {
  /** 見た敵（攻撃の予兆・命中・被弾で関わった敵の種類） */
  seen: Set<string>;
  /** 倒した敵の種類 → 回数 */
  killed: Map<string, number>;
  /** 起こした反応 → 回数（常時の反応は同時に付いた回数） */
  reactions: Map<string, number>;
  /** 成立した連鎖（語の並びの key）→ 回数 */
  chains: Map<string, number>;
  /** 成立したスキルの連携 → 回数 */
  combos: Map<string, number>;
  /** 連携の発見（3 系統の初成立の階・手がかり枠。src/meta/links.ts） */
  links: LinkRun;
  floorKinds: Set<string>;
  roomKinds: Set<string>;
  /** 組み立て中の連鎖（src/render/chainUi.ts の toSequences と同じ区切り: 深さが増える間は 1 本） */
  seq: { words: Keyword[]; lastDepth: number } | null;
}

export function createCodexRun(): CodexRun {
  return {
    seen: new Set(),
    killed: new Map(),
    reactions: new Map(),
    chains: new Map(),
    combos: new Map(),
    links: createLinkRun(),
    floorKinds: new Set(),
    roomKinds: new Set(),
    seq: null,
  };
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

export function noteEnemySeen(run: CodexRun, key: string | undefined): void {
  if (key !== undefined && key !== "") run.seen.add(key);
}

export function noteEnemyKilled(run: CodexRun, key: string): void {
  run.seen.add(key);
  bump(run.killed, key);
}

export function noteReaction(run: CodexRun, key: string): void {
  bump(run.reactions, key);
}

export function noteCombo(run: CodexRun, key: string): void {
  bump(run.combos, key);
}

/** 連鎖の記録の key（語・状態異常・効果の種類）を語へ寄せる。語にならない効果は null（render/chainUi.ts の chainWord と同じ規則） */
export function chainWordOf(key: string): Keyword | null {
  if (isKeyword(key)) return key;
  if (isStatusKind(key)) return STATUS_KEYWORDS[key][0] ?? null;
  return null;
}

/**
 * 連鎖の 1 段（system/rules.ts の recordChain と同じ順で呼ばれる）。深さが増えている間は同じ連鎖に語を足し、
 * 2 語以上になったらその並びを記録する。戻り値は今つながった語の数（連鎖にならなければ 0）
 */
export function noteChainStep(run: CodexRun, keyword: string, depth: number): number {
  const word = chainWordOf(keyword);
  if (word === null) return 0;
  const cur = run.seq;
  if (cur === null || depth <= cur.lastDepth) {
    run.seq = { words: [word], lastDepth: depth };
    return 0;
  }
  cur.words.push(word);
  cur.lastDepth = depth;
  bump(run.chains, cur.words.join(CHAIN_SEPARATOR));
  return cur.words.length;
}

// -----------------------------------------------------------------------------
// 常時の反応（イベントを出さない反応の検出）
// -----------------------------------------------------------------------------

export interface ConstantReaction {
  key: ReactionKey;
  a: StatusKind;
  b: StatusKind;
}

/** 常時の反応の一覧（状態異常 2 つの組）。runRecord が付与のたびに照合する */
export const CONSTANT_REACTIONS: readonly ConstantReaction[] = REACTION_KEYS.flatMap((key): ConstantReaction[] => {
  const def = REACTION_PARTS[key];
  const [a, b] = def.parts;
  if (!def.constant || !isStatusKind(a) || !isStatusKind(b)) return [];
  return [{ key, a, b }];
});

// -----------------------------------------------------------------------------
// 保存データ（src/meta/codexStore.ts が読み書き）
// -----------------------------------------------------------------------------

export interface CodexSave {
  version: 1;
  enemiesSeen: string[];
  enemyKills: Record<string, number>;
  relics: string[];
  boons: string[];
  reactions: Record<string, number>;
  chains: Record<string, number>;
  /** スキルの連携 → 回数（2026-09-24 追加。旧データには無く、読むときに {} で補う） */
  combos: Record<string, number>;
  /** 連携の id（src/meta/links.ts）→ 初めて成立したラン（階とシード）。旧データには無く {} で補う */
  firstSeen: Record<string, LinkFirstSeen>;
  floorKinds: string[];
  roomKinds: string[];
}

export interface LinkFirstSeen {
  depth: number;
  seed: string;
}

export function createCodexSave(): CodexSave {
  return {
    version: 1,
    enemiesSeen: [],
    enemyKills: {},
    relics: [],
    boons: [],
    reactions: {},
    chains: {},
    combos: {},
    firstSeen: {},
    floorKinds: [],
    roomKinds: [],
  };
}

/** 図鑑に載せない敵（設置物・動かない氷柱。図鑑を埋め切れるように） */
const HIDDEN_BEHAVIORS: ReadonlySet<EnemyDef["behavior"]> = new Set<EnemyDef["behavior"]>(["inert", "mine"]);
export const CODEX_ENEMIES: readonly EnemyDef[] = ENEMIES.filter((d) => !HIDDEN_BEHAVIORS.has(d.behavior)).sort(
  (a, b) => a.minDepth - b.minDepth,
);

/** 図鑑に載せる部屋の種類。specialRooms が循環 import の途中で読まれても空にならないよう、呼び出し時に作る */
export function codexRoomKinds(): RoomKind[] {
  return Object.keys(ROOM_KIND_LABEL).filter((k): k is RoomKind => Object.hasOwn(ROOM_KIND_LABEL, k));
}

const ENEMY_KEYS: ReadonlySet<string> = new Set(ENEMIES.map((d) => d.key));
const RELIC_KEYS: ReadonlySet<string> = new Set(UNIQUES.map((u) => u.key));
const BOON_KEY_SET: ReadonlySet<string> = new Set(BOON_KEYS);
const REACTION_KEY_SET: ReadonlySet<string> = new Set(REACTION_KEYS);
// フロア種別と部屋種類は循環 import（biomes → floor → … → codex）の途中で読まれることがあり、
// トップレベルで Set にすると空になる。初回の呼び出しで作る
let floorKindSet: ReadonlySet<string> | null = null;
let roomKindSet: ReadonlySet<string> | null = null;
function floorKinds(): ReadonlySet<string> {
  if (floorKindSet === null || floorKindSet.size === 0) floorKindSet = new Set(FLOOR_KINDS);
  return floorKindSet;
}
function roomKinds(): ReadonlySet<string> {
  if (roomKindSet === null || roomKindSet.size === 0) roomKindSet = new Set(codexRoomKinds());
  return roomKindSet;
}

export const isEnemyKey = (k: string): boolean => ENEMY_KEYS.has(k);
export const isRelicKey = (k: string): boolean => RELIC_KEYS.has(k);
export const isBoonKeyString = (k: string): boolean => BOON_KEY_SET.has(k);
export const isReactionKeyString = (k: string): boolean => REACTION_KEY_SET.has(k);
export const isComboKeyString = (k: string): boolean => isComboKey(k);
export const isFloorKindString = (k: string): boolean => floorKinds().has(k);
export const isRoomKindString = (k: string): boolean => roomKinds().has(k);

function addAll(list: string[], keys: Iterable<string>): number {
  const have = new Set(list);
  let added = 0;
  for (const key of keys) {
    if (have.has(key)) continue;
    have.add(key);
    list.push(key);
    added += 1;
  }
  return added;
}

function addCounts(target: Record<string, number>, source: Iterable<readonly [string, number]>): number {
  let added = 0;
  for (const [key, n] of source) {
    if (target[key] === undefined) added += 1;
    target[key] = (target[key] ?? 0) + n;
  }
  return added;
}

function filteredEntries(map: ReadonlyMap<string, number>, allowed: (k: string) => boolean): [string, number][] {
  return [...map].filter(([k]) => allowed(k));
}

/** プロフィールが持つ名のある遺物（倉庫 + 装備）。拾ったものは即プロフィールに入るので、ラン終了時にここから拾う */
export function ownedRelicKeys(profile: Pick<Profile, "stash" | "equipment">): string[] {
  const equipped = Object.values(profile.equipment).filter((it): it is Item => it !== null);
  const keys: string[] = [];
  for (const item of [...profile.stash, ...equipped]) {
    if (item.namedKey !== undefined) keys.push(item.namedKey);
  }
  return keys;
}

/** 記録の元（GameState の一部。テストで組み立てやすいように）。seedText は連携の初発見の記録に使う */
export type CodexSource = Pick<GameState, "codexRun" | "boons" | "profile"> & Partial<Pick<GameState, "seedText">>;

/** 初発見の記録に残すシードの長さの上限（壊れたデータで保存が膨らまないように） */
export const FIRST_SEEN_SEED_MAX = 64;

/** 連携の初成立を保存データへ（既に記録があれば上書きしない）。戻り値は新しく載った数 */
function addFirstSeen(save: CodexSave, firstDepth: ReadonlyMap<string, number>, seed: string): number {
  let added = 0;
  for (const [id, depth] of firstDepth) {
    if (save.firstSeen[id] !== undefined || !isLinkId(id)) continue;
    save.firstSeen[id] = { depth, seed: seed.slice(0, FIRST_SEEN_SEED_MAX) };
    added += 1;
  }
  return added;
}

/**
 * ラン 1 回ぶんの記録を保存データへ畳む（保存データを書き換える）。戻り値は初めて載った項目の数。
 * 未知の key（消えた敵など）は載せない
 */
export function recordCodex(source: CodexSource, save: CodexSave): number {
  const run = source.codexRun;
  let added = 0;
  added += addAll(save.enemiesSeen, [...run.seen].filter(isEnemyKey));
  added += addCounts(save.enemyKills, filteredEntries(run.killed, isEnemyKey));
  added += addAll(save.relics, ownedRelicKeys(source.profile).filter(isRelicKey));
  added += addAll(save.boons, source.boons.filter(isBoonKeyString));
  added += addCounts(save.reactions, filteredEntries(run.reactions, isReactionKeyString));
  added += addCounts(save.chains, filteredEntries(run.chains, isChainKey));
  added += addCounts(save.combos, filteredEntries(run.combos, isComboKeyString));
  // 初発見の階は件数に数えない（反応・連鎖・連携の回数の側で既に 1 件と数えている）
  addFirstSeen(save, run.links.firstDepth, source.seedText ?? "");
  added += addAll(save.floorKinds, [...run.floorKinds].filter(isFloorKindString));
  added += addAll(save.roomKinds, [...run.roomKinds].filter(isRoomKindString));
  return added;
}

// -----------------------------------------------------------------------------
// 画面に出す項目（src/render/codexUi.ts が描く。DOM 非依存）
// -----------------------------------------------------------------------------

export interface CodexEntry {
  key: string;
  known: boolean;
  /** 一覧の名前。未発見は「？？？」（頁があれば手がかり付き） */
  name: string;
  /** 一覧の右側の短い情報（撃破数・回数など） */
  info: string;
  /** 下の説明欄（ヒントか説明） */
  detail: string;
}

/** 図鑑の頁（依頼の報酬）。持っているタブは未発見のヒントが 1 段詳しくなる */
export type CodexPages = ReadonlySet<CodexTab>;

function enemyEntries(save: CodexSave, page: boolean): CodexEntry[] {
  const seen = new Set(save.enemiesSeen);
  return CODEX_ENEMIES.map((d) => {
    const kills = save.enemyKills[d.key] ?? 0;
    const known = seen.has(d.key) || kills > 0;
    const role = d.boss ? "ボス" : d.lairMaster ? "部屋主" : "";
    const where = `地下 ${d.minDepth} 階から`;
    if (!known) {
      const name = page ? `${[...d.name][0] ?? ""}${UNKNOWN_PART}${UNKNOWN_PART}` : UNKNOWN_NAME;
      return { key: d.key, known, name, info: role, detail: `${where}現れる。` };
    }
    const info = kills > 0 ? `撃破 ${kills}` : "未撃破";
    return { key: d.key, known, name: d.name, info, detail: [role, where, info].filter((s) => s !== "").join(" / ") };
  });
}

function relicSlotLabel(u: UniqueDef): string {
  const base = baseDef(u.baseKey);
  return base ? `${SLOT_LABEL[base.slot]}（${base.name}）` : "";
}

function relicEntries(save: CodexSave, page: boolean): CodexEntry[] {
  const found = new Set(save.relics);
  return UNIQUES.map((u) => {
    const known = found.has(u.key);
    const slot = relicSlotLabel(u);
    if (known) return { key: u.key, known, name: u.name, info: slot, detail: u.flavor ?? slot };
    const hint = page && u.flavor ? u.flavor : `${slot}の遺物。`;
    return { key: u.key, known, name: UNKNOWN_NAME, info: slot, detail: hint };
  });
}

const BOON_RARITY_LABEL: Readonly<Record<BoonDef["rarity"], string>> = {
  common: "通常",
  rare: "希少",
  epic: "極稀",
};

function boonEntries(save: CodexSave, page: boolean): CodexEntry[] {
  const taken = new Set(save.boons);
  return BOON_KEYS.map((key) => {
    const def = BOONS[key];
    const known = taken.has(key);
    const info = `${BOON_RARITY_LABEL[def.rarity]}${def.cursed ? "・呪い" : ""}`;
    if (known) return { key, known, name: def.name, info, detail: def.desc };
    const detail = page ? def.desc : "まだ受けたことのない祝福。";
    return { key, known, name: UNKNOWN_NAME, info, detail };
  });
}

function firstSeenText(save: CodexSave, id: string): string {
  const first = save.firstSeen[id];
  return first === undefined ? "" : ` 初めて見たのは地下 ${first.depth} 階。`;
}

function comboEntries(save: CodexSave, page: boolean): CodexEntry[] {
  const keys = Object.keys(COMBOS).filter(isComboKey);
  return keys.map((key) => {
    const id = linkId("combo", key);
    const count = save.combos[key] ?? 0;
    const known = count > 0;
    const [after, target] = comboPartLabels(key);
    const kindLabel = LINK_KIND_LABEL.combo;
    if (known) {
      const detail = `${after} → ${target}: ${COMBOS[key].verb}。${firstSeenText(save, id)}`;
      return { key: id, known, name: COMBOS[key].name, info: `${kindLabel} ${count} 回`, detail };
    }
    const hint = page ? `${after} → ${target} = ${UNKNOWN_PART}` : `${after} の後に ${UNKNOWN_PART}`;
    return { key: id, known, name: UNKNOWN_NAME, info: kindLabel, detail: hint };
  });
}

function reactionEntries(save: CodexSave, page: boolean): CodexEntry[] {
  return REACTION_KEYS.map((key) => {
    const id = linkId("reaction", key);
    const count = save.reactions[key] ?? 0;
    const known = count > 0;
    const kindLabel = LINK_KIND_LABEL.reaction;
    const info = known ? `${kindLabel} ${count} 回` : kindLabel;
    const detail = `${reactionHint(key, known, page)}${known ? `。${firstSeenText(save, id)}` : ""}`;
    return { key: id, known, name: known ? linkName(id) : UNKNOWN_NAME, info, detail };
  });
}

/** 連鎖は組み合わせが開いているので、見つけたものだけを回数の多い順に並べる */
function chainEntries(save: CodexSave): CodexEntry[] {
  return Object.entries(save.chains)
    .filter(([key]) => isChainKey(key))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => {
      const id = linkId("chain", key);
      const words = key.split(CHAIN_SEPARATOR).length;
      const detail = `${chainLabel(key)}（${words} 語の連鎖）。${count} 回つないだ。${firstSeenText(save, id)}`;
      return { key: id, known: true, name: linkName(id), info: `${LINK_KIND_LABEL.chain} ${count} 回`, detail };
    });
}

/** 連携の頁: スキルの連携・反応（未発見は「？」）→ 見つけた連鎖 */
function linkEntries(save: CodexSave, page: boolean): CodexEntry[] {
  return [...comboEntries(save, page), ...reactionEntries(save, page), ...chainEntries(save)];
}

function placeEntries(save: CodexSave, page: boolean): CodexEntry[] {
  const floors = new Set(save.floorKinds);
  const rooms = new Set(save.roomKinds);
  const floorEntries = FLOOR_KINDS.map((kind: FloorKind): CodexEntry => {
    const known = floors.has(kind);
    const label = floorKindLabel(kind);
    const name = known ? label : page ? `（未踏）${label}` : UNKNOWN_NAME;
    return { key: `floor:${kind}`, known, name, info: "階の種類", detail: known ? `${label}の階を歩いた。` : "まだ歩いていない階。" };
  });
  const roomEntries = codexRoomKinds().map((kind): CodexEntry => {
    const known = rooms.has(kind);
    const label = ROOM_KIND_LABEL[kind];
    const name = known ? label : page ? `（未踏）${label}` : UNKNOWN_NAME;
    return { key: `room:${kind}`, known, name, info: "部屋", detail: known ? `${label}に入った。` : "まだ入っていない部屋。" };
  });
  return [...floorEntries, ...roomEntries];
}

export function codexEntries(save: CodexSave, tab: CodexTab, pages: CodexPages = new Set()): CodexEntry[] {
  const page = pages.has(tab);
  switch (tab) {
    case "enemy":
      return enemyEntries(save, page);
    case "relic":
      return relicEntries(save, page);
    case "boon":
      return boonEntries(save, page);
    case "link":
      return linkEntries(save, page);
    case "place":
      return placeEntries(save, page);
  }
}

/** タブの見出しの「発見数 / 総数」。連携は連鎖の組み合わせが開いているので総数が無く null */
export function codexTabCount(save: CodexSave, tab: CodexTab): { known: number; total: number | null } {
  const entries = codexEntries(save, tab);
  const known = entries.filter((e) => e.known).length;
  return { known, total: tab === "link" ? null : entries.length };
}
