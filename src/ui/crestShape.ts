import { KEYWORDS, KEYWORD_DEFS, type Keyword, type KeywordVerb, profileKeywords } from "../core/keywords";
import type { GameState } from "../core/state";
import { MENU_BUDGET, RESONANCE } from "../data/tuning";
import { SLOTS, type Item, type Slot } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { SKILL_KEYS, type SkillKey } from "../skills/types";
import { itemColor } from "../system/loot";
import { skillKeywords } from "../system/keywords";
import {
  RESONANCE_EXCLUDED,
  type KeywordResonance,
  type ResonanceBySource,
  type ResonanceOrigin,
  type ResonanceOriginKind,
  resonanceBySource,
} from "../system/resonance";
import { type BeadColumn, beadsOfBand, crestBands } from "./tryOn";
import { fid } from "./menuFocus";
import type { FocusId } from "./menuState";

/**
 * 紋の形（docs/ideas/inventory-v2/E-impl.md 4-3 E2）。帯 = 系統（段の立った系統 4 + 伏流 2）、珠 = 出どころ。
 * 帯の並びと珠の畳み方は段 1 の crestBands / beadsOfBand（ui/tryOn.ts）に任せ、ここでは画面が描く形
 * （珠の形・色・key・畳んだ数・伏流の「＋」の側）だけを足す。紋の面・紋の写し・3 択の写しが同じ形を読む
 */

/** 段の立った系統の帯の上限 / 伏流の帯の上限 / 1 本の珠の上限（予算は data/balance/feel/MENU_BUDGET.json） */
export const CREST_MAX_STEPPED = MENU_BUDGET.bands.stepped;
export const CREST_MAX_UNDER = MENU_BUDGET.bands.undercurrent;
export const BEAD_MAX: Readonly<Record<KeywordVerb, number>> = {
  produces: MENU_BUDGET.beads.source,
  consumes: MENU_BUDGET.beads.sink,
  amplifies: MENU_BUDGET.beads.amplifier,
};

/** 珠の形: 遺物 = 角 / スキル石 = 菱形 / 祝福 = 小札 / 流儀・型・改鋳・誓約 = 二重丸 */
export type CrestBeadShape = "relic" | "stone" | "boon" | "origin";

export interface CrestBead {
  source: ResonanceOrigin;
  /** 同じ出どころには同じ key（帯をまたいで同じ物を光らせる・焦点の id の最後の欄） */
  key: string;
  shape: CrestBeadShape;
  color: string;
}

export interface CrestRow {
  keyword: Keyword;
  step: number;
  undercurrent: boolean;
  produces: CrestBead[];
  consumes: CrestBead[];
  amplifies: CrestBead[];
  /** 畳んだ出どころの数（0 = 畳まない。畳んだ珠 1 つが列の最後に並ぶ） */
  overflow: Record<KeywordVerb, number>;
  /** 伏流の足りない側（溢れ = 源はあるが糧が足りない → 糧の側 / 枯れ = 糧はあるが源が足りない → 源の側） */
  plus: "produces" | "consumes" | null;
}

export interface CrestShape {
  rows: CrestRow[];
  /** 紋に描けない系統（5 本目以降の段の立った系統と 3 本目以降の伏流）。「系統を選ぶ」盤から開く */
  hidden: Keyword[];
}

/** 祝福の珠の色（系譜ごとの色はまだ無いので、祝福カードの系譜の見出しと同じ色） */
const BOON_BEAD_COLOR = "#ffb060";
/** 流儀・型・改鋳・誓約の珠の色 */
const ORIGIN_BEAD_COLOR = "#c8b48a";
/** 遺物・石が見つからない（試着の仮の出どころなど）ときの色 */
const UNKNOWN_BEAD_COLOR = "#9a948a";

const KEY_SEP = "|";

/** 出どころの key（種類 | 部位か枠 | 識別子）。fid.bead / fid.src の最後の欄に入る */
export function sourceKey(source: Readonly<ResonanceOrigin>): string {
  const place = source.slot ?? (source.index === undefined ? "" : String(source.index));
  return [source.kind, place, source.id].join(KEY_SEP);
}

const ORIGIN_KINDS: readonly ResonanceOriginKind[] = ["relic", "stone", "boon", "job", "form", "reforge", "keystone"];

function isOriginKind(v: string): v is ResonanceOriginKind {
  return (ORIGIN_KINDS as readonly string[]).includes(v);
}

function isSlot(v: string): v is Slot {
  return (SLOTS as readonly string[]).includes(v);
}

/** sourceKey の逆。読めない key は null */
export function originOfKey(key: string): ResonanceOrigin | null {
  const first = key.indexOf(KEY_SEP);
  const second = first < 0 ? -1 : key.indexOf(KEY_SEP, first + 1);
  if (second < 0) return null;
  const kind = key.slice(0, first);
  const place = key.slice(first + 1, second);
  const id = key.slice(second + 1);
  if (!isOriginKind(kind) || id === "") return null;
  const origin: ResonanceOrigin = { kind, id };
  if (kind === "relic") {
    if (!isSlot(place)) return null;
    origin.slot = place;
  } else if (kind === "stone") {
    const index = Number(place);
    if (place === "" || !Number.isInteger(index) || index < 0) return null;
    origin.index = index;
  }
  return origin;
}

function shapeOf(kind: ResonanceOriginKind): CrestBeadShape {
  if (kind === "relic" || kind === "stone" || kind === "boon") return kind;
  return "origin";
}

function findItem(state: Readonly<GameState>, id: string): Item | null {
  for (const slot of SLOTS) {
    const it = state.profile.equipment[slot];
    if (it?.id === id) return it;
  }
  return state.profile.stash.find((it) => it.id === id) ?? null;
}

function isSkillKey(v: string): v is SkillKey {
  return (SKILL_KEYS as readonly string[]).includes(v);
}

/** スキル石の顔の色 = 石の最初の系統の色 */
export function stoneFaceColor(skillKey: SkillKey): string {
  const first = profileKeywords(skillKeywords(SKILL_DEFS[skillKey]))[0];
  return first === undefined ? UNKNOWN_BEAD_COLOR : KEYWORD_DEFS[first].color;
}

function beadColor(state: Readonly<GameState>, source: Readonly<ResonanceOrigin>): string {
  switch (source.kind) {
    case "relic": {
      const item = findItem(state, source.id);
      return item === null ? UNKNOWN_BEAD_COLOR : itemColor(item);
    }
    case "stone":
      return isSkillKey(source.id) ? stoneFaceColor(source.id) : UNKNOWN_BEAD_COLOR;
    case "boon":
      return BOON_BEAD_COLOR;
    default:
      return ORIGIN_BEAD_COLOR;
  }
}

function beadOf(state: Readonly<GameState>, source: Readonly<ResonanceOrigin>): CrestBead {
  return { source: { ...source }, key: sourceKey(source), shape: shapeOf(source.kind), color: beadColor(state, source) };
}

function beads(state: Readonly<GameState>, column: Readonly<BeadColumn>): CrestBead[] {
  return column.shown.map((o) => beadOf(state, o));
}

/** 伏流の「＋」の側。足りない数の多い側（同じなら源の側） */
function plusSide(r: Readonly<KeywordResonance>): "produces" | "consumes" {
  const shortSources = Math.max(0, RESONANCE.minSources - r.produces.length);
  const shortSinks = Math.max(0, RESONANCE.minSinks - r.consumes.length);
  return shortSinks > shortSources ? "consumes" : "produces";
}

const EXCLUDED: ReadonlySet<Keyword> = new Set(RESONANCE_EXCLUDED);

/** 段が立っているか、源か糧を 1 つ以上持つ系統（紋に描けるもの） */
function isDrawable(r: Readonly<KeywordResonance>): boolean {
  return r.step > 0 || r.produces.length > 0 || r.consumes.length > 0;
}

/** 今のビルド（by を渡せばその数え）の紋の形。state は遺物・石の色を読むだけ */
export function crestShape(state: Readonly<GameState>, sources: Readonly<ResonanceBySource> = resonanceBySource(state)): CrestShape {
  const bands = crestBands(sources);
  const rows = bands.map((band): CrestRow => {
    const folded = beadsOfBand(band);
    return {
      keyword: band.keyword,
      step: band.step,
      undercurrent: band.undercurrent,
      produces: beads(state, folded.source),
      consumes: beads(state, folded.sink),
      amplifies: beads(state, folded.amplifier),
      overflow: { produces: folded.source.folded, consumes: folded.sink.folded, amplifies: folded.amplifier.folded },
      plus: band.undercurrent ? plusSide(sources[band.keyword]) : null,
    };
  });
  const shown = new Set(rows.map((r) => r.keyword));
  const hidden = KEYWORDS.filter((k) => !EXCLUDED.has(k) && !shown.has(k) && isDrawable(sources[k]));
  return { rows, hidden };
}

const VERBS: readonly KeywordVerb[] = ["produces", "consumes", "amplifies"];

/** その出どころの珠の焦点（最初に見つかった帯の珠）。畳まれていて見えなければ null */
export function beadFocusFor(shape: Readonly<CrestShape>, key: string): FocusId | null {
  for (const row of shape.rows) {
    for (const verb of VERBS) {
      if (row[verb].some((b) => b.key === key)) return fid.bead(row.keyword, verb, key);
    }
  }
  return null;
}

/** 紋の写しの帯 1 本の置き場（ui の当たりと render の描画で共有する） */
export interface MiniCrestRow {
  row: CrestRow;
  /** 帯の当たり（▼ / 消 の印の幅を除いた右側） */
  rect: { x: number; y: number; w: number; h: number };
  /** 帯の中心の y */
  cy: number;
}

/** 紋の写しの行の高さ（段の立った帯 / 伏流）と、帯の中心のずれ */
const MINI_STEPPED_H = 32;
const MINI_UNDER_H = 18;
const MINI_STEPPED_CY = 12;
const MINI_UNDER_CY = 8;
/** 行の左の ▼ / 消 の印の幅（当たりに含めない） */
const MINI_MARK_W = 6;

/** 紋の写しの行を上から積む（見本 E.html の miniCrest と同じ寸法） */
export function miniCrestRows(shape: Readonly<CrestShape>, area: { x: number; y: number; w: number }): MiniCrestRow[] {
  let y = area.y;
  return shape.rows.map((row) => {
    const h = row.undercurrent ? MINI_UNDER_H : MINI_STEPPED_H;
    const out: MiniCrestRow = { row, rect: { x: area.x + MINI_MARK_W, y, w: area.w - MINI_MARK_W, h }, cy: y + (row.undercurrent ? MINI_UNDER_CY : MINI_STEPPED_CY) };
    y += h;
    return out;
  });
}
