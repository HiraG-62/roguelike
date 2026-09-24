import type { Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { REACTION_KEYS, REACTION_LABEL, type ReactionKey } from "../core/status";
import { DISCOVERY } from "../data/tuning";
import { COMBOS, comboAfter } from "../skills/combos";
import { SKILL_DEFS } from "../skills/data";
import type { ComboKey, SkillKey } from "../skills/types";
import type { CodexSave } from "./codex";
import { CHAIN_SEPARATOR, REACTION_PARTS, chainLabel, isChainKey, reactionPartLabel } from "./linkParts";

export {
  CHAIN_SEPARATOR,
  REACTION_PARTS,
  type ReactionExtraPart,
  type ReactionPart,
  type ReactionParts,
  chainLabel,
  isChainKey,
  isKeyword,
  isStatusKind,
  reactionHint,
  reactionPartLabel,
} from "./linkParts";

/**
 * 連携（docs/ideas/synergy-web.md 5 章）: スキルの連携（skills/combos.ts）・状態異常の反応（core/status.ts）・
 * 統一ルールの連鎖（2 語以上）の 3 系統を 1 つの「発見」として扱う。
 * 保存・表示の id は「系統:key」。ラン中は state.codexRun.links に積み、ラン終了時に recordCodex が図鑑へ畳む。
 * どれもゲーム進行には効かない（手がかり・初発見の表示だけ）
 */

export const LINK_KINDS = ["combo", "reaction", "chain"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_KIND_LABEL: Readonly<Record<LinkKind, string>> = {
  combo: "スキルの連携",
  reaction: "反応",
  chain: "連鎖",
};

const ID_SEPARATOR = ":";
const REACTION_SET: ReadonlySet<string> = new Set(REACTION_KEYS);

export function isComboKey(key: string): key is ComboKey {
  return Object.hasOwn(COMBOS, key);
}

export function isReactionKey(key: string): key is ReactionKey {
  return REACTION_SET.has(key);
}

// -----------------------------------------------------------------------------
// スキルの連携の構成
// -----------------------------------------------------------------------------

let comboTargetMap: ReadonlyMap<ComboKey, readonly SkillKey[]> | null = null;

/** 連携の「後」になるスキル（SkillDef.combos にその連携を持つ石） */
export function comboTargets(key: ComboKey): readonly SkillKey[] {
  if (comboTargetMap === null || comboTargetMap.size === 0) {
    const map = new Map<ComboKey, SkillKey[]>();
    // SKILL_KEYS ではなく定義の側を回す（キーだけ先に足された石があっても落ちないように）
    for (const def of Object.values(SKILL_DEFS)) {
      for (const combo of def.combos ?? []) map.set(combo, [...(map.get(combo) ?? []), def.key]);
    }
    comboTargetMap = map;
  }
  return comboTargetMap.get(key) ?? [];
}

function skillNames(keys: readonly SkillKey[]): string {
  return keys.map((k) => SKILL_DEFS[k].name).join("・");
}

/** 連携の [先に撃つ石, 後に撃つ石] の名前 */
export function comboPartLabels(key: ComboKey): readonly [string, string] {
  return [skillNames(comboAfter(COMBOS[key])), skillNames(comboTargets(key))];
}

/** 連携の成立を知らされた時点の「直前の発動」（まだ今撃った石は記録されていない） */
export interface PendingCombo {
  after: SkillKey | null;
  /** 直前の発動の時刻（SkillRunState.clock） */
  afterAt: number | null;
  /** 知らされた時点の SkillRunState.clock（受付秒の判定に使う） */
  clock: number;
}

/**
 * 成立した連携を「直前の発動」と「今撃った石（lastCast。照準地点つき）」から引き直す。
 * skills/combos.ts の findCombo と同じ順・同じ条件で def.combos を見る（連携の key を記録側へ渡す経路が無いため、
 * SkillRunState.lastCast を読むだけで済ませる）
 */
export function inferCombo(state: GameState, pending: Readonly<PendingCombo>, cast: SkillKey, target: Vec): ComboKey | null {
  for (const key of SKILL_DEFS[cast].combos ?? []) {
    const c = COMBOS[key];
    if (!c.untimed && !afterMatched(c.key, pending)) continue;
    if (c.requires && !c.requires(state)) continue;
    if (c.requiresAt && !c.requiresAt(state, target)) continue;
    return key;
  }
  return null;
}

function afterMatched(key: ComboKey, pending: Readonly<PendingCombo>): boolean {
  const c = COMBOS[key];
  if (pending.after === null || pending.afterAt === null) return false;
  if (!comboAfter(c).includes(pending.after)) return false;
  return pending.clock - pending.afterAt <= c.window;
}

// -----------------------------------------------------------------------------
// 名のある連鎖（連鎖の先頭 2 語で引く。docs/ideas/synergy-web.md 2-2 の環の入口）
// -----------------------------------------------------------------------------

export interface NamedChain {
  words: readonly [Keyword, Keyword];
  name: string;
}

export const NAMED_CHAINS: readonly NamedChain[] = [
  { words: ["burn", "burn"], name: "延焼" },
  { words: ["poison", "poison"], name: "毒の連なり" },
  { words: ["chill", "chill"], name: "霜の連なり" },
  { words: ["shock", "shock"], name: "雷の連なり" },
  { words: ["bleed", "bleed"], name: "血の連なり" },
  { words: ["explode", "explode"], name: "誘爆" },
  { words: ["shock", "chill"], name: "霜雷の兆し" },
  { words: ["burn", "chill"], name: "蒸気の兆し" },
  { words: ["chill", "burn"], name: "蒸気の兆し" },
  { words: ["dash", "shock"], name: "雷走り" },
  { words: ["stagger", "vulnerable"], name: "崩れの連なり" },
  { words: ["mana", "placed"], name: "設置の循環" },
];

/** 連鎖の並び（語の配列）の名前。名の無い並びは null */
export function chainNameOfWords(words: readonly string[]): string | null {
  const [a, b] = words;
  if (a === undefined || b === undefined) return null;
  return NAMED_CHAINS.find((n) => n.words[0] === a && n.words[1] === b)?.name ?? null;
}

export function chainName(chainKey: string): string | null {
  return chainNameOfWords(chainKey.split(CHAIN_SEPARATOR));
}

// -----------------------------------------------------------------------------
// id（系統:key）
// -----------------------------------------------------------------------------

export interface LinkRef {
  kind: LinkKind;
  key: string;
}

export function linkId(kind: LinkKind, key: string): string {
  return `${kind}${ID_SEPARATOR}${key}`;
}

function isLinkKind(v: string): v is LinkKind {
  return (LINK_KINDS as readonly string[]).includes(v);
}

export function parseLinkId(id: string): LinkRef | null {
  const at = id.indexOf(ID_SEPARATOR);
  if (at < 0) return null;
  const kind = id.slice(0, at);
  if (!isLinkKind(kind)) return null;
  return { kind, key: id.slice(at + 1) };
}

/** 今の定義で成り立つ id か（消えた連携・壊れた key は落とす） */
export function isLinkId(id: string): boolean {
  const ref = parseLinkId(id);
  if (ref === null) return false;
  switch (ref.kind) {
    case "combo":
      return isComboKey(ref.key);
    case "reaction":
      return isReactionKey(ref.key);
    case "chain":
      return isChainKey(ref.key);
  }
}

/** 連携の名前（名の無い連鎖は語の並び） */
export function linkName(id: string): string {
  const ref = parseLinkId(id);
  if (ref === null) return id;
  if (ref.kind === "combo" && isComboKey(ref.key)) return COMBOS[ref.key].name;
  if (ref.kind === "reaction" && isReactionKey(ref.key)) return REACTION_LABEL[ref.key];
  if (ref.kind === "chain") return chainName(ref.key) ?? chainLabel(ref.key);
  return id;
}

/** 連携の 2 つの材料の表示名。連鎖は先頭の語と残りの並び */
export function linkParts(id: string): readonly [string, string] | null {
  const ref = parseLinkId(id);
  if (ref === null) return null;
  if (ref.kind === "combo" && isComboKey(ref.key)) return comboPartLabels(ref.key);
  if (ref.kind === "reaction" && isReactionKey(ref.key)) {
    const [a, b] = REACTION_PARTS[ref.key].parts;
    return [reactionPartLabel(a), reactionPartLabel(b)];
  }
  if (ref.kind === "chain" && isChainKey(ref.key)) {
    const [head, ...rest] = ref.key.split(CHAIN_SEPARATOR);
    return [chainLabel(head ?? ""), chainLabel(rest.join(CHAIN_SEPARATOR))];
  }
  return null;
}

// -----------------------------------------------------------------------------
// ラン中の記録（state.codexRun.links）
// -----------------------------------------------------------------------------

/** 手がかり枠（src/meta/linkHint.ts が選ぶ）。shown は見せる材料（both = 結果だけ伏せる） */
export interface LinkHint {
  id: string;
  shown: "both" | "first" | "second";
  /** 選んだ階（階が変わったら選び直す） */
  depth: number;
  /** この手がかりになった state.time（HUD に出しておく時間の起点） */
  since: number;
}

export interface LinkRun {
  /** 図鑑の既知の連携（ラン開始時に main.ts が seedKnownLinks で写す）+ このランで初めて見つけたもの */
  known: Set<string>;
  /** このランで成立した連携 → 初めて成立した階 */
  firstDepth: Map<string, number>;
  /** 直近に初めて見つけた連携（HUD の「新たな連携」） */
  fresh: { id: string; time: number } | null;
  hint: LinkHint | null;
  /**
   * 連携の成立を知らされた時点の「直前の発動」（まだ今撃った石が記録されていない）。
   * 同じステップの後で lastCast が今撃った石になってから inferCombo で引き直す。未解決が無ければ null
   */
  pendingCombo: PendingCombo | null;
  /**
   * 手がかりを最後に選んだときのビルドの写し（装備の stats の参照と、祝福・スキル石・既知の数の key）。
   * 変わっていなければ語の推論を回し直さない（語の推論は重く、毎秒回すと 1 ステップが目に見えて遅くなる）
   */
  hintBasis: { stats: object; key: string } | null;
}

export function createLinkRun(): LinkRun {
  return { known: new Set(), firstDepth: new Map(), fresh: null, hint: null, pendingCombo: null, hintBasis: null };
}

/**
 * 連携の成立を記録する。戻り値は図鑑に無かった（初めて見つけた）か。
 * 既知の集合はラン開始時の図鑑の写しなので、ゲーム進行には効かない（表示と依頼だけが読む）
 */
export function noteLink(run: LinkRun, id: string, depth: number, time: number): boolean {
  if (!run.firstDepth.has(id)) run.firstDepth.set(id, depth);
  if (run.known.has(id)) return false;
  run.known.add(id);
  run.fresh = { id, time };
  return true;
}

// -----------------------------------------------------------------------------
// 保存データから読むもの（発見数・節目）
// -----------------------------------------------------------------------------

/** 図鑑が知っている連携の id（ラン開始時の写しと、発見数に使う） */
export function knownLinkIds(save: Readonly<CodexSave>): Set<string> {
  const out = new Set<string>();
  for (const [key, n] of Object.entries(save.combos)) if (n > 0 && isComboKey(key)) out.add(linkId("combo", key));
  for (const [key, n] of Object.entries(save.reactions)) if (n > 0 && isReactionKey(key)) out.add(linkId("reaction", key));
  for (const [key, n] of Object.entries(save.chains)) if (n > 0 && isChainKey(key)) out.add(linkId("chain", key));
  return out;
}

/** ラン開始時に図鑑の既知を写す（main.ts が createGame の直後に 1 回） */
export function seedKnownLinks(run: LinkRun, save: Readonly<CodexSave>): void {
  for (const id of knownLinkIds(save)) run.known.add(id);
}

/** 発見した連携の数（3 系統の合計） */
export function discoveryCount(save: Readonly<CodexSave>): number {
  return knownLinkIds(save).size;
}

/** 系統ごとの発見数 */
export function discoveryCountOf(save: Readonly<CodexSave>, kind: LinkKind): number {
  return [...knownLinkIds(save)].filter((id) => parseLinkId(id)?.kind === kind).length;
}

export type LinkMilestoneReward = { kind: "page" } | { kind: "title"; achievement: string };

export interface LinkMilestone {
  count: number;
  reward: LinkMilestoneReward;
}

/** 発見数の節目。数値の強さは配らない（図鑑の頁と称号だけ。依頼の報酬と同じ方針） */
export function linkMilestones(): readonly LinkMilestone[] {
  return [
    { count: DISCOVERY.milestonePage, reward: { kind: "page" } },
    { count: DISCOVERY.milestoneTitle, reward: { kind: "title", achievement: "link15" } },
    { count: DISCOVERY.milestoneGrand, reward: { kind: "title", achievement: "link30" } },
  ];
}

/** まだ届いていない最初の節目（すべて越えたら null） */
export function nextLinkMilestone(count: number): LinkMilestone | null {
  return linkMilestones().find((m) => count < m.count) ?? null;
}

/** 節目の頁「連携」が開いているか */
export function hasLinkPage(save: Readonly<CodexSave>): boolean {
  return discoveryCount(save) >= DISCOVERY.milestonePage;
}
