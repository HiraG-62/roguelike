import { type Keyword, KEYWORDS, kw } from "../../core/keywords";
import { GOOD_STATUS_KINDS, STATUS_KINDS, type StatusApply, type StatusKind } from "../../core/status";
import type { Element } from "../../core/element";
import { BALANCE } from "../../data/balance";
import { ATTR_KEYS, type AttrKey, type AttrRatio, type Scaling } from "../../loot/types";
import { cooldownSkill, manaSkill } from "../resource";
import type { SkillDef, SkillTag, VariantAxis } from "../types";
import type { ArtAct, ArtActKind, ArtActSpec, ArtDef, ArtSpec } from "./types";

/**
 * 技の組み立て: TS の形（ArtSpec）と JSON の数値（BALANCE.skills.ART.<武器種 | common>.<key>）を合わせて
 * SkillDef（スキル石としての定義）と ArtDef（行為の列）を作る。数値の欠け・打ち間違いは読み込み時に throw する
 * （balance の打ち間違いを早く落とす。data/ultimates.ts と同じ方針）
 */

type Raw = Readonly<Record<string, unknown>>;

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(where: string, msg: string): never {
  throw new Error(`skills/ART ${where}: ${msg}`);
}

function num(r: Raw, k: string, where: string): number {
  const v = r[k];
  if (typeof v !== "number") fail(where, `数値 ${k} が無い`);
  return v;
}

function optNum(r: Raw, k: string): number | undefined {
  const v = r[k];
  return typeof v === "number" ? v : undefined;
}

function isAttrKey(k: string): k is AttrKey {
  return (ATTR_KEYS as readonly string[]).includes(k);
}

function attrTable(r: Raw, where: string): Partial<Record<AttrKey, number>> {
  const out: Partial<Record<AttrKey, number>> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "base") continue;
    if (!isAttrKey(k) || typeof v !== "number") fail(where, `不正な係数 ${k}`);
    out[k] = v;
  }
  return out;
}

function scalingOf(v: unknown, where: string): Scaling | undefined {
  if (v === undefined) return undefined;
  if (!isRaw(v)) fail(where, "damage は { base, 係数… } の形");
  return { base: num(v, "base", where), ...attrTable(v, where) };
}

function ratioOf(v: unknown, where: string): AttrRatio | undefined {
  if (v === undefined) return undefined;
  if (!isRaw(v)) fail(where, "poiseRatio は { 係数… } の形");
  return attrTable(v, where);
}

function isStatusKind(k: string): k is StatusKind {
  return (STATUS_KINDS as readonly string[]).includes(k);
}

function applyOf(kind: StatusKind, v: unknown, where: string): StatusApply {
  if (!isRaw(v)) fail(where, `${kind} は { stacks, duration, potency } の形`);
  const ratio = v.ratio === undefined ? undefined : ratioOf(v.ratio, where);
  return { kind, stacks: num(v, "stacks", where), duration: num(v, "duration", where), potency: num(v, "potency", where), ...(ratio ? { ratio } : {}) };
}

/** 行為の数値ブロックに置ける項目（これ以外と状態異常の名前は打ち間違いとして落とす） */
const ACT_FIELDS: ReadonlySet<string> = new Set([
  "delay",
  "ahead",
  "side",
  "angleDeg",
  "damage",
  "knockback",
  "hits",
  "heavy",
  "poise",
  "execute",
  "vsMul",
  "terrainRadius",
  "terrainTime",
  "reach",
  "deg",
  "radius",
  "length",
  "width",
  "distance",
  "invuln",
  "count",
  "spreadDeg",
  "speed",
  "life",
  "bulletRadius",
  "pierce",
  "bounces",
  "range",
  "jumps",
  "jumpRange",
  "toDistance",
  "duration",
  "damageMul",
  "speedMul",
  "heal",
  "mana",
  "self",
]);

/** 種類ごとに必ず要る数値 */
const REQUIRED: Readonly<Record<ArtActKind, readonly string[]>> = {
  arc: ["reach", "deg"],
  ring: ["radius"],
  line: ["length", "width"],
  dash: ["distance"],
  blink: [],
  shot: ["count", "spreadDeg", "speed", "life", "bulletRadius"],
  chain: ["range", "jumps", "jumpRange"],
  pull: ["radius", "toDistance"],
  buff: ["duration"],
  detonate: [],
};

/** 与ダメを持てる行為（buff・detonate・blink 以外） */
const STRIKE_KINDS: ReadonlySet<ArtActKind> = new Set(["arc", "ring", "line", "dash", "shot", "chain", "pull"]);

/** 技の数値ブロックの技側の項目（行為のブロック以外） */
const SKILL_FIELDS: ReadonlySet<string> = new Set(["cost", "cooldown", "minInterval", "poise", "poiseRatio", "range"]);

const ZERO = 0;
const ONE_HIT = 1;

function selfApplies(v: unknown, where: string): StatusApply[] {
  if (v === undefined) return [];
  if (!isRaw(v)) fail(where, "self は { 状態異常: {…} } の形");
  return Object.entries(v).map(([k, a]) => {
    if (!isStatusKind(k) || !GOOD_STATUS_KINDS.has(k)) fail(where, `self に置けない状態異常 ${k}`);
    return applyOf(k, a, where);
  });
}

function buildAct(spec: ArtActSpec, r: Raw, where: string): ArtAct {
  const applies: StatusApply[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (ACT_FIELDS.has(k)) continue;
    if (!isStatusKind(k)) fail(where, `知らない項目 ${k}`);
    applies.push(applyOf(k, v, where));
  }
  for (const k of REQUIRED[spec.kind]) num(r, k, where);
  const damage = scalingOf(r.damage, where);
  if (damage && !STRIKE_KINDS.has(spec.kind)) fail(where, `${spec.kind} は damage を持てない`);
  if (spec.vs && optNum(r, "vsMul") === undefined) fail(where, "vs には vsMul が要る");
  if (spec.terrain && optNum(r, "terrainRadius") === undefined) fail(where, "terrain には terrainRadius が要る");
  const terrainTime = optNum(r, "terrainTime");
  return {
    kind: spec.kind,
    name: spec.n,
    anchor: spec.anchor ?? "self",
    delay: optNum(r, "delay") ?? ZERO,
    ahead: optNum(r, "ahead") ?? ZERO,
    side: optNum(r, "side") ?? ZERO,
    angleDeg: optNum(r, "angleDeg") ?? ZERO,
    damage,
    knockback: optNum(r, "knockback") ?? ZERO,
    hits: optNum(r, "hits") ?? ONE_HIT,
    heavy: r.heavy === true,
    poise: optNum(r, "poise"),
    execute: optNum(r, "execute"),
    applies,
    vs: spec.vs ? { status: spec.vs, mul: num(r, "vsMul", where), consume: spec.consume === true } : undefined,
    terrain: spec.terrain
      ? { kind: spec.terrain, radius: num(r, "terrainRadius", where), ...(terrainTime === undefined ? {} : { duration: terrainTime }) }
      : undefined,
    clearsBullets: spec.clearsBullets === true,
    reach: optNum(r, "reach") ?? ZERO,
    deg: optNum(r, "deg") ?? ZERO,
    radius: optNum(r, "radius") ?? ZERO,
    length: optNum(r, "length") ?? ZERO,
    width: optNum(r, "width") ?? ZERO,
    distance: optNum(r, "distance") ?? ZERO,
    invuln: optNum(r, "invuln") ?? ZERO,
    shot: spec.shot ?? "plain",
    count: optNum(r, "count") ?? ONE_HIT,
    spreadDeg: optNum(r, "spreadDeg") ?? ZERO,
    speed: optNum(r, "speed") ?? ZERO,
    life: optNum(r, "life") ?? ZERO,
    bulletRadius: optNum(r, "bulletRadius") ?? ZERO,
    pierce: optNum(r, "pierce") ?? ZERO,
    bounces: optNum(r, "bounces") ?? ZERO,
    range: optNum(r, "range") ?? ZERO,
    jumps: optNum(r, "jumps") ?? ZERO,
    jumpRange: optNum(r, "jumpRange") ?? ZERO,
    toDistance: optNum(r, "toDistance") ?? ZERO,
    duration: optNum(r, "duration") ?? ZERO,
    damageMul: optNum(r, "damageMul"),
    speedMul: optNum(r, "speedMul"),
    heal: optNum(r, "heal"),
    mana: optNum(r, "mana"),
    self: selfApplies(r.self, where),
  };
}

/** 技ごとの数値ブロック（ART.<武器種 | common>.<key>） */
function artBlock(spec: ArtSpec): Raw {
  const table: unknown = BALANCE.skills.ART;
  if (!isRaw(table)) fail(spec.key, "ART が無い");
  const group = table[spec.moveset ?? "common"];
  if (!isRaw(group)) fail(spec.key, `ART.${spec.moveset ?? "common"} が無い`);
  const block = group[spec.key];
  if (!isRaw(block)) fail(spec.key, "数値ブロックが無い");
  return block;
}

function checkBlockKeys(spec: ArtSpec, block: Raw): void {
  const names = new Set(spec.acts.map((a) => a.n));
  if (names.size !== spec.acts.length) fail(spec.key, "行為の名前が重複している");
  for (const k of Object.keys(block)) {
    if (!SKILL_FIELDS.has(k) && !names.has(k)) fail(spec.key, `知らない項目 ${k}`);
  }
}

/** 行為の数値ブロック。必須の数値を持たない行為（blink / detonate）は省略できる（空オブジェクトは JSON の検査が禁じる） */
function actBlock(spec: ArtSpec, block: Raw, act: ArtActSpec): Raw {
  const r = block[act.n];
  if (r === undefined && REQUIRED[act.kind].length === 0) return {};
  if (!isRaw(r)) fail(spec.key, `行為 ${act.n} の数値ブロックが無い`);
  return r;
}

/** 照準地点を使う行為があれば射程（JSON の range）が要る */
function needsRange(acts: readonly ArtAct[]): boolean {
  return acts.some((a) => a.anchor === "target" || a.kind === "blink");
}

export function buildArtDef(spec: ArtSpec): ArtDef {
  const block = artBlock(spec);
  checkBlockKeys(spec, block);
  const acts = spec.acts.map((a) => buildAct(a, actBlock(spec, block, a), `${spec.key}.${a.n}`));
  if (acts.length === 0) fail(spec.key, "行為が 1 つも無い");
  const range = optNum(block, "range");
  if (needsRange(acts) && range === undefined) fail(spec.key, "照準地点を使う行為には range が要る");
  return { key: spec.key, moveset: spec.moveset, acts, castRange: needsRange(acts) ? range : undefined, minDepth: spec.minDepth ?? ONE_HIT };
}

// ---------------------------------------------------------------------------
// SkillDef（スキル石としての定義）
// ---------------------------------------------------------------------------

const AREA_KINDS: ReadonlySet<ArtActKind> = new Set(["arc", "ring", "line", "pull"]);

/** 変異軸の既定: 与ダメがあれば再使用 / 威力、範囲の行為があれば範囲 / 威力、弾なら数 / 威力、強化なら持続 / 効果量 */
function defaultAxes(acts: readonly ArtAct[], hasDamage: boolean): VariantAxis[] {
  const out: VariantAxis[] = [];
  if (hasDamage) out.push("cooldownVsDamage");
  if (hasDamage && acts.some((a) => AREA_KINDS.has(a.kind))) out.push("areaVsDamage");
  if (hasDamage && acts.some((a) => a.kind === "shot")) out.push("countVsDamage");
  if (acts.some((a) => a.kind === "buff")) out.push("durationVsPotency");
  return out.length > 0 ? out : ["cooldownVsPotency"];
}

const TAG_KEYWORD: Partial<Record<SkillTag, Keyword>> = {
  melee: "melee",
  projectile: "ranged",
  area: "area",
  movement: "dash",
  defense: "ward",
};

const ELEMENT_KEYWORD: Readonly<Record<Element, Keyword>> = {
  none: "elNone",
  fire: "elFire",
  ice: "elIce",
  lightning: "elLightning",
  poison: "elPoison",
  dark: "elDark",
  light: "elLight",
};

/** 自己強化の語: 回復 = 回復、気力 = 気力、無敵・硬化 = 守り、足 = ダッシュ、与ダメ・怒気 = 怯み（押し込む） */
function buffKeywords(a: ArtAct): Keyword[] {
  if (a.kind !== "buff") return [];
  const out: Keyword[] = [];
  if (a.heal !== undefined) out.push("heal");
  if (a.mana !== undefined) out.push("mana");
  if (a.invuln > 0 || a.self.some((s) => s.kind === "harden")) out.push("ward");
  if (a.speedMul !== undefined || a.self.some((s) => s.kind === "haste")) out.push("dash");
  if (a.damageMul !== undefined || a.self.some((s) => s.kind === "wrath" || s.kind === "fury")) out.push("stagger");
  return out;
}

function isKeyword(k: string): k is Keyword {
  return (KEYWORDS as readonly string[]).includes(k);
}

/** 語の既定: 出す = タグ・付ける状態異常・属性、食う = 狙う状態異常 */
function defaultKeywords(spec: ArtSpec, acts: readonly ArtAct[]) {
  const produces: Keyword[] = [];
  for (const t of spec.tags) {
    const k = TAG_KEYWORD[t];
    if (k) produces.push(k);
  }
  for (const a of acts) for (const s of a.applies) if (isKeyword(s.kind)) produces.push(s.kind);
  for (const a of acts) produces.push(...buffKeywords(a));
  if (spec.attack) produces.push(ELEMENT_KEYWORD[spec.attack.element]);
  const consumes: Keyword[] = [];
  for (const a of acts) if (a.vs && isKeyword(a.vs.status)) consumes.push(a.vs.status);
  return kw(produces, consumes);
}

/** 行為の付与をまとめる（同じ状態異常は最初のもの）。刻印符の「状態異常を付けるスキル」の判定と語に使う */
function unionApplies(acts: readonly ArtAct[]): StatusApply[] | undefined {
  const out: StatusApply[] = [];
  for (const a of acts) for (const s of a.applies) if (!out.some((o) => o.kind === s.kind)) out.push(s);
  return out.length > 0 ? out : undefined;
}

export function buildArtSkillDef(spec: ArtSpec, art: ArtDef): SkillDef {
  const block = artBlock(spec);
  const poise = num(block, "poise", spec.key);
  const poiseRatio = ratioOf(block.poiseRatio, spec.key);
  const minInterval = num(block, "minInterval", spec.key);
  const cost = optNum(block, "cost");
  const cooldown = optNum(block, "cooldown");
  if ((cost === undefined) === (cooldown === undefined)) fail(spec.key, "cost と cooldown のどちらか一方だけを置く");
  const resource = cost !== undefined ? manaSkill({ cost, minInterval, poise, poiseRatio }) : cooldownSkill({ cooldown: cooldown ?? ZERO, minInterval, poise, poiseRatio });
  const hasDamage = art.acts.some((a) => a.damage !== undefined);
  if (hasDamage && spec.attack === null) fail(spec.key, "与ダメを持つ技は attack が要る");
  const applies = unionApplies(art.acts);
  return {
    key: spec.key,
    name: spec.name,
    icon: spec.icon,
    verb: spec.verb,
    tags: spec.tags,
    keywords: spec.keywords ?? defaultKeywords(spec, art.acts),
    damageKind: !hasDamage ? "none" : spec.attack?.genre.range === "ranged" ? "ranged" : "melee",
    axes: spec.axes ?? defaultAxes(art.acts, hasDamage),
    ...resource,
    ...(applies ? { applies } : {}),
    ...(spec.moveset ? { moveset: spec.moveset } : {}),
  };
}
