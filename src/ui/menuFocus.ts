import type { BoonAction } from "../core/build";
import type { Keyword, KeywordVerb } from "../core/keywords";
import type { Vec } from "../core/vec";
import type { EchoOp } from "../loot/crafting";
import type { Slot } from "../loot/types";
import type { ModifierKey } from "../skills/types";
import type { BoonKey, LineageKey } from "../system/boonDefs";
import type { CandidateSort, FocusId, MenuFace, MenuHit } from "./menuState";
import { pointInRect } from "./inventoryLayout";

/**
 * 装備画面の焦点（docs/ideas/inventory-v2/E-impl.md 1-2・1-3）。
 * 方向キーは「その向きでいちばん近い当たり」へ移る（見本 E.html の navigate と同じ採点）。
 * 焦点の id は fid.* で作り、区切りは「:」（出どころの key は最後の欄なので「:」を含んでもよい）
 */

const SEP = ":";

function join(...parts: readonly (string | number)[]): FocusId {
  return parts.join(SEP);
}

/** 焦点の id の作り方（E-impl 1-3 の表） */
export const fid = {
  part: (slot: Slot): FocusId => join("part", slot),
  stone: (i: number): FocusId => join("stone", i),
  body: "body" as FocusId,
  mini: (kw: Keyword): FocusId => join("mini", kw),
  face: (f: MenuFace): FocusId => join("face", f),
  band: (kw: Keyword): FocusId => join("band", kw),
  bead: (kw: Keyword, verb: KeywordVerb, srcKey: string): FocusId => join("bead", kw, verb, srcKey),
  more: (kw: Keyword, verb: KeywordVerb): FocusId => join("more", kw, verb),
  plus: (kw: Keyword, verb: KeywordVerb): FocusId => join("plus", kw, verb),
  daiPart: (slot: Slot): FocusId => join("dai", "part", slot),
  daiAct: (a: BoonAction): FocusId => join("dai", "act", a),
  daiLineage: (l: LineageKey): FocusId => join("dai", "lineage", l),
  daiCore: "dai:core" as FocusId,
  board: "board" as FocusId,
  fold: (kw: Keyword): FocusId => join("fold", kw),
  src: (srcKey: string, verb: KeywordVerb): FocusId => join("src", srcKey, verb),
  kw: (kw: Keyword): FocusId => join("kw", kw),
  sort: (s: CandidateSort): FocusId => join("sort", s),
  cand: (id: string): FocusId => join("c", id),
  bud: (n: number): FocusId => join("bud", n),
  clear: "clear" as FocusId,
  rune: (i: number, key: ModifierKey): FocusId => join("rune", i, key),
  col: (i: number): FocusId => join("col", i),
  loose: (i: number, key: ModifierKey): FocusId => join("loose", i, key),
  action: (a: BoonAction): FocusId => join("action", a),
  grace: (key: BoonKey): FocusId => join("grace", key),
  relic: (slot: Slot): FocusId => join("relic", slot),
  page: (n: number): FocusId => join("page", n),
  ult: (n: number): FocusId => join("ult", n),
  moveset: (dir: -1 | 1): FocusId => join("moveset", dir),
  op: (op: EchoOp): FocusId => join("op", op),
  trait: (n: number): FocusId => join("trait", n),
  partner: (id: string): FocusId => join("partner", id),
  tg: (id: string): FocusId => join("tg", id),
  exec: "exec" as FocusId,
  row: (n: number): FocusId => join("row", n),
} as const;

/**
 * id の頭が prefix なら残りの欄を返す（無ければ null）。count を渡すと、最後の欄に残りを全部まとめる
 * （fid.bead の出どころの key のように「:」を含みうる欄を最後に置くため）
 */
export function fidArgs(id: FocusId | null, prefix: string, count?: number): string[] | null {
  if (id === null) return null;
  const head = `${prefix}${SEP}`;
  if (!id.startsWith(head)) return null;
  const parts = id.slice(head.length).split(SEP);
  if (count === undefined || parts.length <= count) return parts;
  return [...parts.slice(0, count - 1), parts.slice(count - 1).join(SEP)];
}

/** 当たりを中心で比べる */
function centerOf(hit: Readonly<MenuHit>): Vec {
  return { x: hit.rect.x + hit.rect.w / 2, y: hit.rect.y + hit.rect.h / 2 };
}

/** 進む向きの距離がこれ以下の当たりは「その向き」とみなさない（同じ列の隣の行へ横で飛ばない） */
const MIN_ALONG = 2;
/** 横のずれの重み（まっすぐ先の当たりを、斜めの近い当たりより優先する） */
const ACROSS_WEIGHT = 2.2;

/**
 * 方向の移動。焦点が当たりに無ければ先頭の当たり（nav のもの）、その向きに当たりが無ければ null。
 * 得点 = 進む距離 + 横のずれ × 2.2 の小さい当たり（見本 E.html の navigate と同じ）
 */
export function nearestInDirection(hits: readonly MenuHit[], current: FocusId | null, dx: number, dy: number): FocusId | null {
  const navs = hits.filter((h) => h.nav);
  const first = navs[0];
  if (first === undefined) return null;
  const cur = navs.find((h) => h.id === current);
  if (cur === undefined) return first.id;
  const c = centerOf(cur);
  let best: MenuHit | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const h of navs) {
    if (h === cur) continue;
    const p = centerOf(h);
    const along = dx !== 0 ? (p.x - c.x) * dx : (p.y - c.y) * dy;
    if (along <= MIN_ALONG) continue;
    const across = dx !== 0 ? Math.abs(p.y - c.y) : Math.abs(p.x - c.x);
    const score = along + across * ACROSS_WEIGHT;
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best?.id ?? null;
}

/** 点の上の当たり（後から足した当たりを優先する。重なりは上に描いた物） */
export function hitAt(hits: readonly MenuHit[], p: Vec | null): MenuHit | null {
  if (p === null) return null;
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (h !== undefined && pointInRect(p, h.rect)) return h;
  }
  return null;
}

/** 焦点の id の当たり */
export function focusedHit(hits: readonly MenuHit[], id: FocusId | null): MenuHit | null {
  if (id === null) return null;
  return hits.find((h) => h.id === id) ?? null;
}
