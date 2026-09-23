import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import type { FloorKind, GameState, RoomKind } from "../core/state";
import { REACTION_KEYS, REACTION_LABEL, type ReactionKey, STATUS_KINDS, STATUS_LABEL, type StatusKind } from "../core/status";
import { ENEMIES, type EnemyDef } from "../data/enemies";
import { baseDef } from "../loot/bases";
import { UNIQUES, type UniqueDef } from "../loot/named";
import type { Item, Profile } from "../loot/types";
import { FLOOR_KINDS, floorKindLabel } from "../system/biomes";
import { BOONS, BOON_KEYS, type BoonDef } from "../system/boonDefs";
import { STATUS_KEYWORDS } from "../system/keywords";
import { ROOM_KIND_LABEL } from "../system/specialRooms";
import { SLOT_LABEL } from "../ui/inventoryLayout";

/**
 * 図鑑（docs/ideas/meta-and-weapons.md 4-2〜4-5、docs/ideas/synergy-web.md 5-a）。
 * ラン中は state.codexRun に軽い Set / Map で積むだけ（src/meta/runRecord.ts）。localStorage には触れず、
 * ラン終了時に main.ts が recordCodex で保存データへ畳む。未発見は「？」と片側だけのヒントで見せ、シナジー探しを促す
 */

export const CODEX_TABS = ["enemy", "relic", "boon", "reaction", "chain", "place"] as const;
export type CodexTab = (typeof CODEX_TABS)[number];

export const CODEX_TAB_LABEL: Readonly<Record<CodexTab, string>> = {
  enemy: "敵",
  relic: "遺物",
  boon: "祝福",
  reaction: "反応",
  chain: "連鎖",
  place: "場所",
};

/** 未発見の表示 */
export const UNKNOWN_NAME = "？？？";
const UNKNOWN_PART = "？";
/** 連鎖の保存 key の区切り（語の key は英字だけなので衝突しない） */
export const CHAIN_SEPARATOR = ">";
const CHAIN_ARROW = "→";

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

const STATUS_SET: ReadonlySet<string> = new Set(STATUS_KINDS);

function isKeyword(key: string): key is Keyword {
  return Object.hasOwn(KEYWORD_DEFS, key);
}

function isStatusKind(key: string): key is StatusKind {
  return STATUS_SET.has(key);
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
// 反応の構成（未発見のヒント「燃焼 + ？」と、常時の反応の検出に使う）
// -----------------------------------------------------------------------------

/** 状態異常以外の反応の材料 */
type ReactionExtraPart = "hit" | "hueMatch";
type ReactionPart = StatusKind | ReactionExtraPart;

const EXTRA_PART_LABEL: Readonly<Record<ReactionExtraPart, string>> = {
  hit: "射撃・スキルの命中",
  hueMatch: "色の合う状態異常",
};

export interface ReactionParts {
  /** [出す側, 食う側]（src/system/statusReactions.ts のコメントと同じ並び）。ヒントは 1 つ目だけ見せる */
  parts: readonly [ReactionPart, ReactionPart];
  /** 常時の反応（イベントを出さない）。両方が同時に付いたら起きたとみなす */
  constant?: boolean;
}

export const REACTION_PARTS: Readonly<Record<ReactionKey, ReactionParts>> = {
  vaporize: { parts: ["burn", "chill"] },
  steam: { parts: ["wet", "burn"] },
  quench: { parts: ["wet", "chill"] },
  conduct: { parts: ["wet", "shock"] },
  ignite: { parts: ["oiled", "burn"] },
  kindle: { parts: ["oiled", "shock"] },
  miasma: { parts: ["poison", "burn"] },
  shatterBleed: { parts: ["bleed", "freeze"] },
  cauterize: { parts: ["bleed", "burn"] },
  dissolve: { parts: ["corrode", "poison"], constant: true },
  lacerate: { parts: ["corrode", "bleed"], constant: true },
  collapse: { parts: ["broken", "stagger"], constant: true },
  exposeDoom: { parts: ["doom", "vulnerable"] },
  wither: { parts: ["weaken", "vulnerable"], constant: true },
  frostPoison: { parts: ["chill", "poison"], constant: true },
  panic: { parts: ["fear", "bleed"], constant: true },
  brandBurst: { parts: ["brand", "hit"] },
  thaw: { parts: ["encase", "burn"] },
  rage: { parts: ["stagger", "wrath"] },
  discharge: { parts: ["wet", "charged"] },
  iceArmor: { parts: ["harden", "chill"], constant: true },
  hueBurst: { parts: ["hue", "hueMatch"] },
  manaCut: { parts: ["siphon", "silence"], constant: true },
  rally: { parts: ["chill", "haste"] },
};

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

function partLabel(part: ReactionPart): string {
  if (isStatusKind(part)) return STATUS_LABEL[part];
  return EXTRA_PART_LABEL[part];
}

/** 反応のヒント。page（反応の頁）があれば両側を見せる */
export function reactionHint(key: ReactionKey, known: boolean, page: boolean): string {
  const [a, b] = REACTION_PARTS[key].parts;
  if (known) return `${partLabel(a)} + ${partLabel(b)} = ${REACTION_LABEL[key]}`;
  if (page) return `${partLabel(a)} + ${partLabel(b)} = ${UNKNOWN_PART}`;
  return `${partLabel(a)} + ${UNKNOWN_PART}`;
}

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
  floorKinds: string[];
  roomKinds: string[];
}

export function createCodexSave(): CodexSave {
  return { version: 1, enemiesSeen: [], enemyKills: {}, relics: [], boons: [], reactions: {}, chains: {}, floorKinds: [], roomKinds: [] };
}

/** 図鑑に載せない敵（設置物・動かない氷柱。図鑑を埋め切れるように） */
const HIDDEN_BEHAVIORS: ReadonlySet<EnemyDef["behavior"]> = new Set<EnemyDef["behavior"]>(["inert", "mine"]);
export const CODEX_ENEMIES: readonly EnemyDef[] = ENEMIES.filter((d) => !HIDDEN_BEHAVIORS.has(d.behavior)).sort(
  (a, b) => a.minDepth - b.minDepth,
);

export const ROOM_KINDS: readonly RoomKind[] = Object.keys(ROOM_KIND_LABEL).filter((k): k is RoomKind => Object.hasOwn(ROOM_KIND_LABEL, k));

const ENEMY_KEYS: ReadonlySet<string> = new Set(ENEMIES.map((d) => d.key));
const RELIC_KEYS: ReadonlySet<string> = new Set(UNIQUES.map((u) => u.key));
const BOON_KEY_SET: ReadonlySet<string> = new Set(BOON_KEYS);
const REACTION_KEY_SET: ReadonlySet<string> = new Set(REACTION_KEYS);
const FLOOR_KIND_SET: ReadonlySet<string> = new Set(FLOOR_KINDS);
const ROOM_KIND_SET: ReadonlySet<string> = new Set(ROOM_KINDS);

export const isEnemyKey = (k: string): boolean => ENEMY_KEYS.has(k);
export const isRelicKey = (k: string): boolean => RELIC_KEYS.has(k);
export const isBoonKeyString = (k: string): boolean => BOON_KEY_SET.has(k);
export const isReactionKeyString = (k: string): boolean => REACTION_KEY_SET.has(k);
export const isFloorKindString = (k: string): boolean => FLOOR_KIND_SET.has(k);
export const isRoomKindString = (k: string): boolean => ROOM_KIND_SET.has(k);

/** 連鎖の key として成り立つか（既知の語が 2 つ以上） */
export function isChainKey(k: string): boolean {
  const words = k.split(CHAIN_SEPARATOR);
  return words.length >= 2 && words.every(isKeyword);
}

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

/** 記録の元（GameState の一部。テストで組み立てやすいように） */
export type CodexSource = Pick<GameState, "codexRun" | "boons" | "profile">;

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

function reactionEntries(save: CodexSave, page: boolean): CodexEntry[] {
  return REACTION_KEYS.map((key) => {
    const count = save.reactions[key] ?? 0;
    const known = count > 0;
    const name = known ? REACTION_LABEL[key] : UNKNOWN_NAME;
    const info = known ? `${count} 回` : "";
    return { key, known, name, info, detail: reactionHint(key, known, page) };
  });
}

/** 連鎖の並びの表示（語の名前を矢印でつなぐ） */
export function chainLabel(chainKey: string): string {
  return chainKey
    .split(CHAIN_SEPARATOR)
    .map((w) => (isKeyword(w) ? KEYWORD_DEFS[w].label : w))
    .join(CHAIN_ARROW);
}

/** 連鎖は組み合わせが開いているので、見つけたものだけを回数の多い順に並べる */
function chainEntries(save: CodexSave): CodexEntry[] {
  return Object.entries(save.chains)
    .filter(([key]) => isChainKey(key))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => {
      const words = key.split(CHAIN_SEPARATOR).length;
      return { key, known: true, name: chainLabel(key), info: `${count} 回`, detail: `${words} 語の連鎖。${count} 回つないだ。` };
    });
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
  const roomEntries = ROOM_KINDS.map((kind): CodexEntry => {
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
    case "reaction":
      return reactionEntries(save, page);
    case "chain":
      return chainEntries(save);
    case "place":
      return placeEntries(save, page);
  }
}

/** タブの見出しの「発見数 / 総数」。連鎖は総数が無いので null */
export function codexTabCount(save: CodexSave, tab: CodexTab): { known: number; total: number | null } {
  const entries = codexEntries(save, tab);
  const known = entries.filter((e) => e.known).length;
  return { known, total: tab === "chain" ? null : entries.length };
}
