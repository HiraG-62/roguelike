import type { GameState } from "../core/state";
import { REACTION_KEYS } from "../core/status";
import { DISCOVERY } from "../data/tuning";
import { COMBOS, comboAfter } from "../skills/combos";
import { stoneInSlot } from "../skills/persistence";
import type { SkillKey } from "../skills/types";
import { type KeywordHolder, STATUS_KEYWORDS, buildProfile } from "../system/keywords";
import { REACTION_PARTS, type ReactionPart, isStatusKind } from "./linkParts";
import { type LinkHint, comboTargets, isComboKey, linkId, linkParts, parseLinkId } from "./links";

/**
 * 手がかり枠（docs/ideas/synergy-web.md 5-d）。いま持っている要素（装備の語・祝福・スキル石）で成立し得るが
 * 未発見の連携を 1 件だけ選ぶ。表示専用でゲーム進行には効かない。
 * 決定性: state.rng を使わず、シードと階のハッシュで候補の添字を決める（同じ階・同じビルドなら同じ手がかり）
 */

/** 候補。shown = 見せる材料（both = 両方見せて結果だけ伏せる / first・second = 片側だけ見せる） */
export interface LinkHintCandidate {
  id: string;
  shown: LinkHint["shown"];
}

/** 手がかりの計算に要る state の部分（テストで組み立てやすいように絞る） */
export type LinkHintSource = KeywordHolder & Pick<GameState, "seed" | "depth">;

const UNKNOWN_PART = "？";
/** ハッシュの種（シードの並びをゲームの乱数列から離す） */
const HINT_SALT = 0x6c1a7;

/** 装着中のスキル石の key（スロット順） */
function equippedSkills(state: Pick<KeywordHolder, "skills">): Set<SkillKey> {
  const out = new Set<SkillKey>();
  const rs = state.skills;
  for (let i = 0; i < rs.slots.length; i++) {
    const stone = stoneInSlot(rs.profile, i);
    if (stone) out.add(stone.skillKey);
  }
  return out;
}

/** スキルの連携の候補。後に撃つ石を持っていれば候補、先に撃つ石もあれば両方見せる */
function comboCandidates(skills: ReadonlySet<SkillKey>, known: ReadonlySet<string>): LinkHintCandidate[] {
  const out: LinkHintCandidate[] = [];
  for (const key of Object.keys(COMBOS)) {
    if (!isComboKey(key)) continue;
    const id = linkId("combo", key);
    if (known.has(id)) continue;
    if (!comboTargets(key).some((s) => skills.has(s))) continue;
    const hasAfter = comboAfter(COMBOS[key]).some((s) => skills.has(s));
    out.push({ id, shown: hasAfter ? "both" : "second" });
  }
  return out;
}

/** 反応の材料をビルドが出せるか。命中・色の一致は材料の種類を問わないので常に出せるとみなす */
function partAvailable(part: ReactionPart, produced: ReadonlySet<string>): boolean {
  if (!isStatusKind(part)) return true;
  return STATUS_KEYWORDS[part].some((k) => produced.has(k));
}

/** 反応の候補。両方の材料を出せれば両方見せ、片方だけなら出せる側だけを見せる */
function reactionCandidates(produced: ReadonlySet<string>, known: ReadonlySet<string>): LinkHintCandidate[] {
  const out: LinkHintCandidate[] = [];
  for (const key of REACTION_KEYS) {
    const id = linkId("reaction", key);
    if (known.has(id)) continue;
    const [a, b] = REACTION_PARTS[key].parts;
    const hasA = partAvailable(a, produced);
    const hasB = partAvailable(b, produced);
    if (hasA && hasB) out.push({ id, shown: "both" });
    else if (hasA) out.push({ id, shown: "first" });
    else if (hasB) out.push({ id, shown: "second" });
  }
  return out;
}

/** 候補の一覧（連携 → 反応の定義順。連鎖は組み合わせが開いているので出さない） */
export function linkHintCandidates(state: Readonly<KeywordHolder>, known: ReadonlySet<string>): LinkHintCandidate[] {
  const produced = new Set<string>(buildProfile(state).produces);
  return [...comboCandidates(equippedSkills(state), known), ...reactionCandidates(produced, known)];
}

/** シードと階から添字を作る（整数の混ぜ合わせ。乱数列は消費しない） */
export function hintHash(seed: number, depth: number): number {
  let h = (seed ^ HINT_SALT) >>> 0;
  h = Math.imul(h ^ (depth + 1), 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** 両方を見せられる候補を優先し、無ければ片側だけの候補から 1 件。候補が無ければ null */
export function pickLinkHint(candidates: readonly LinkHintCandidate[], seed: number, depth: number): LinkHintCandidate | null {
  const full = candidates.filter((c) => c.shown === "both");
  const pool = full.length > 0 ? full : candidates;
  if (pool.length === 0) return null;
  return pool[hintHash(seed, depth) % pool.length] ?? null;
}

/** 手がかりの候補を左右するビルドの key（装備の stats は参照で別に比べる） */
function hintBasisKey(state: LinkHintSource, knownCount: number): string {
  const rs = state.skills;
  const slots = rs.slots.map((slot, i) => `${stoneInSlot(rs.profile, i)?.skillKey ?? ""}+${slot.modifiers.join(".")}`);
  return [state.depth, knownCount, state.boons.join(","), slots.join(",")].join("|");
}

/**
 * 手がかりを見直す（src/meta/runRecord.ts の noteRunEvents から毎ステップ呼ぶ）。
 * 階が変わったとき・DISCOVERY.hintRefreshTicks ごとに見て、ビルド（装備・祝福・スキル石・既知の数・階）が
 * 変わっていたときだけ候補を作り直す。選び直した結果が同じなら since は動かさない
 */
export function updateLinkHint(state: LinkHintSource & Pick<GameState, "tick" | "time" | "codexRun">): void {
  const links = state.codexRun.links;
  const floorChanged = links.hint !== null && links.hint.depth !== state.depth;
  if (!floorChanged && state.tick % DISCOVERY.hintRefreshTicks !== 0) return;
  const stats = state.boonRun.baseStats ?? state.stats;
  const key = hintBasisKey(state, links.known.size);
  if (links.hintBasis !== null && links.hintBasis.stats === stats && links.hintBasis.key === key) return;
  links.hintBasis = { stats, key };
  const picked = pickLinkHint(linkHintCandidates(state, links.known), state.seed, state.depth);
  if (picked === null) {
    links.hint = null;
    return;
  }
  const prev = links.hint;
  if (prev !== null && prev.id === picked.id && prev.shown === picked.shown && prev.depth === state.depth) return;
  links.hint = { ...picked, depth: state.depth, since: state.time };
}

/**
 * 手がかりの文面。反応は「油膜 + 燃焼 → ？」「燃焼 + ？」、スキルの連携は撃つ順があるので「油流し → 焼き払い = ？」。
 * 材料が引けなければ空文字
 */
export function linkHintText(hint: Pick<LinkHint, "id" | "shown">): string {
  const parts = linkParts(hint.id);
  if (parts === null) return "";
  const [a, b] = parts;
  const combo = parseLinkId(hint.id)?.kind === "combo";
  const join = combo ? " → " : " + ";
  const result = combo ? " = " : " → ";
  switch (hint.shown) {
    case "both":
      return `${a}${join}${b}${result}${UNKNOWN_PART}`;
    case "first":
      return `${a}${join}${UNKNOWN_PART}`;
    case "second":
      return `${UNKNOWN_PART}${join}${b}`;
  }
}
