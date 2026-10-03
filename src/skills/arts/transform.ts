import type { StatusApply } from "../../core/status";
import { BALANCE } from "../../data/balance";
import { FORM } from "../../data/tuning";
import { FORMS, FORM_KEYS, type FormKey } from "../../data/weaponForms";
import { ATTR_KEYS, type Scaling } from "../../loot/types";
import type { ArtAct, ArtActKind, ArtActsTransform, TransformNumbers } from "./types";

/**
 * 型の変形表（段取り 7c。docs/ideas/skills-7c-plan.md 5 章）。技は武器種の縛りを持たない代わりに、
 * 今の武器の型（data/weaponForms.ts の FormKey）で行為の列の形が変わる（重打なら広く重く、短銃なら振りが弾に …）。
 * 変形は純関数（state も rng も読まない。同じ入力に同じ出力）。数値は data/balance/skills/ART/TRANSFORM/<型>.json。
 * 発動の頭で skills/arts/engine.ts の castArt が引く
 */

export interface ArtTransform {
  readonly acts: ArtActsTransform;
  /** 攻撃の属性を装備の武器の属性にする（杖。武器が無属性なら威力の倍率 plainMul）。state を読むので engine.ts が畳む */
  readonly element?: "weapon";
  /** 石のツールチップの括弧の中（「範囲 ×1.3・段 −1」） */
  readonly label: (n: TransformNumbers) => string;
}

// ---------------------------------------------------------------------------
// 数値
// ---------------------------------------------------------------------------

type Raw = Readonly<Record<string, unknown>>;

function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** TRANSFORM/<型>.json を数値の表として読む（剣・書は数値を持たないのでファイルも無い = 空の表） */
function numbersOf(form: FormKey): TransformNumbers {
  const table: unknown = BALANCE.skills.ART;
  const all = isRaw(table) ? table.TRANSFORM : undefined;
  const raw = isRaw(all) ? all[form] : undefined;
  if (!isRaw(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "number") throw new Error(`skills/ART/TRANSFORM/${form}: ${k} が数値でない`);
    out[k] = v;
  }
  return out;
}

/** 型ごとの変形の数値（読み込み時に 1 回だけ作る） */
export const TRANSFORM_NUMBERS: Readonly<Record<FormKey, TransformNumbers>> = Object.fromEntries(FORM_KEYS.map((f) => [f, numbersOf(f)])) as Record<
  FormKey,
  TransformNumbers
>;

/** 変形の数値を引く。無ければ打ち間違いとして落とす（balance の打ち間違いを早く見つける） */
function need(n: TransformNumbers, key: string): number {
  const v = n[key];
  if (v === undefined) throw new Error(`skills/ART/TRANSFORM: 数値 ${key} が無い`);
  return v;
}

// ---------------------------------------------------------------------------
// 行為の書き換えの部品
// ---------------------------------------------------------------------------

const MIN_HITS = 1;
const MIN_COUNT = 1;

function scaleScaling(s: Scaling, mul: number): Scaling {
  const out: Scaling = { base: s.base * mul };
  for (const k of ATTR_KEYS) {
    const v = s[k];
    if (v !== undefined) out[k] = v * mul;
  }
  return out;
}

/** 与ダメを持つ行為の威力を倍にする（持たない行為はそのまま） */
function mulDamage(a: ArtAct, mul: number): ArtAct {
  if (!a.damage || mul === 1) return a;
  return { ...a, damage: scaleScaling(a.damage, mul) };
}

function isStrike(a: ArtAct): boolean {
  return a.damage !== undefined;
}

/** 扇・円・引き寄せ（範囲の倍率が効く形） */
const SWEEP_KINDS: ReadonlySet<ArtActKind> = new Set(["arc", "ring", "pull"]);
/** 敵弾を消す形にできる行為（扇・円） */
const GUARD_KINDS: ReadonlySet<ArtActKind> = new Set(["arc", "ring"]);
/** 鎖が引き寄せを前に挟む範囲の行為 */
const CHAIN_KINDS: ReadonlySet<ArtActKind> = new Set(["arc", "ring", "line"]);

function mulArea(a: ArtAct, mul: number): ArtAct {
  if (!SWEEP_KINDS.has(a.kind)) return a;
  return { ...a, reach: a.reach * mul, radius: a.radius * mul };
}

/** 状態異常の重ねを足す（同じ種類の付与は 1 つにまとめて重ねる） */
function addApply(applies: readonly StatusApply[], add: StatusApply): StatusApply[] {
  const found = applies.find((s) => s.kind === add.kind);
  if (!found) return [...applies, add];
  return applies.map((s) => (s === found ? { ...s, stacks: s.stacks + add.stacks } : s));
}

/**
 * 振り（扇・帯）を弾に置き換える。多段は 1 発の威力へ畳む（弾は 1 体に 1 回しか当たらないので、単体への与ダメを保つ）。
 * 当てた範囲に残す地形・止めは弾が持てないので落ちる
 */
function toShot(a: ArtAct, shot: { count: number; spreadDeg: number; pierce: number; speed: number; life: number; radius: number }): ArtAct {
  return {
    ...mulDamage(a, a.hits),
    kind: "shot",
    hits: MIN_HITS,
    shot: "plain",
    count: shot.count,
    spreadDeg: shot.spreadDeg,
    pierce: shot.pierce,
    bounces: 0,
    speed: shot.speed,
    life: shot.life,
    bulletRadius: shot.radius,
    terrain: undefined,
    execute: undefined,
  };
}

/** 弾・扇・円を照準地点の円（砲撃）にする。弾の数は畳み率で 1 つの円の威力へ寄せる */
function toBombard(a: ArtAct, radius: number, delayAdd: number, countFold: number): ArtAct {
  const fold = a.kind === "shot" ? 1 + (Math.max(MIN_COUNT, a.count) - 1) * countFold : 1;
  return { ...mulDamage(a, fold), kind: "ring", anchor: "target", radius, delay: a.delay + delayAdd, count: MIN_COUNT };
}

/** 鎖の引き寄せ（与ダメを持たず、次の範囲の行為と同じ起点・同じ時機に出る） */
function pullBefore(a: ArtAct, n: TransformNumbers): ArtAct {
  return {
    ...a,
    kind: "pull",
    name: `${a.name}Pull`,
    damage: undefined,
    hits: MIN_HITS,
    heavy: false,
    execute: undefined,
    applies: [],
    vs: undefined,
    terrain: undefined,
    clearsBullets: false,
    knockback: 0,
    radius: need(n, "pullRadius"),
    toDistance: need(n, "pullTo"),
  };
}

// ---------------------------------------------------------------------------
// 型ごとの変形
// ---------------------------------------------------------------------------

const same: ArtActsTransform = (acts) => [...acts];

/** 連刃: 手数を増やして 1 撃を軽く */
const flurry: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    if (!isStrike(a)) return a;
    const light = mulDamage(a, need(n, "damageMul"));
    if (a.kind === "shot") return { ...light, count: a.count + need(n, "shotCountAdd") };
    return { ...light, hits: a.hits + need(n, "hitsAdd") };
  });

/** 重打: 広く重く、段は減る。踏み込みは短い */
const crusher: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    const wide = mulArea(a, need(n, "areaMul"));
    const moved = a.kind === "dash" ? { ...wide, distance: a.distance * need(n, "dashDistanceMul") } : wide;
    if (!isStrike(a)) return moved;
    return { ...moved, hits: Math.max(MIN_HITS, a.hits + need(n, "hitsAdd")), poiseMul: a.poiseMul * need(n, "poiseMul"), heavy: true };
  });

/** 刃斧: 当てると出血。出血を狙う行為はさらに強く */
const hewer: ArtActsTransform = (acts, n) => {
  const bleed: StatusApply = { kind: "bleed", stacks: need(n, "bleedStacks"), duration: need(n, "bleedDuration"), potency: need(n, "bleedPotency") };
  return acts.map((a) => {
    if (!isStrike(a)) return a;
    const cut = { ...mulDamage(a, need(n, "damageMul")), applies: addApply(a.applies, bleed) };
    if (a.vs?.status !== "bleed") return cut;
    return { ...cut, vs: { ...a.vs, mul: a.vs.mul * need(n, "vsMulMul") } };
  });
};

/** 長柄: 弧を突きに、帯と踏み込みを長く */
const polearm: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    if (a.kind === "arc") return { ...a, kind: "line", length: a.reach * need(n, "arcLineLengthMul"), width: need(n, "arcLineWidth") };
    if (a.kind === "line") return { ...a, length: a.length * need(n, "lengthMul") };
    if (a.kind === "dash") return { ...a, distance: a.distance * need(n, "dashDistanceMul") };
    return a;
  });

/** 鎖: 最初に当てる範囲の行為の前に、同じ起点で引き寄せを挟む */
const chain: ArtActsTransform = (acts, n) => {
  const first = acts.findIndex((a) => isStrike(a) && CHAIN_KINDS.has(a.kind));
  const out = acts.map((a) => mulDamage(a, need(n, "damageMul")));
  const at = acts[first];
  if (!at) return out;
  return [...out.slice(0, first), pullBefore(at, n), ...out.slice(first)];
};

/** 盾: 扇・円が敵弾を消し、押し返しが強い。踏み込み・構えの無敵が伸びる */
const bulwark: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    const guard = GUARD_KINDS.has(a.kind) ? { ...a, clearsBullets: true } : a;
    const safe = a.kind === "dash" || a.kind === "buff" ? { ...guard, invuln: a.invuln + need(n, "invulnAdd") } : guard;
    if (!isStrike(a)) return safe;
    return { ...mulDamage(safe, need(n, "damageMul")), knockback: a.knockback * need(n, "knockbackMul") };
  });

/** 扇: 突風（扇・円が敵弾を消して強く押し返す）。弾は数を増やして軽く */
const warfan: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    const guard = GUARD_KINDS.has(a.kind) ? { ...a, clearsBullets: true, knockback: a.knockback * need(n, "knockbackMul") } : a;
    if (a.kind !== "shot") return guard;
    const spread = a.spreadDeg > 0 ? a.spreadDeg : need(n, "shotSpreadDeg");
    return { ...mulDamage(guard, need(n, "damageMul")), count: a.count + need(n, "shotCountAdd"), spreadDeg: spread };
  });

/** 杖: 付ける状態異常を重ね、弾は大きく遅い（属性は element で engine.ts が畳む） */
const rod: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    const add = need(n, "statusStacksAdd");
    const deep = a.applies.length > 0 ? { ...a, applies: a.applies.map((s) => ({ ...s, stacks: s.stacks + add })) } : a;
    if (a.kind !== "shot") return deep;
    return { ...deep, bulletRadius: a.bulletRadius * need(n, "shotRadiusMul"), speed: a.speed * need(n, "shotSpeedMul") };
  });

/** 投具: 弧は刃 3 本、帯は貫く刃 1 本に */
const thrower: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    const base = { speed: need(n, "shotSpeed"), life: need(n, "shotLife"), radius: need(n, "shotRadius") };
    const light = mulDamage(a, need(n, "damageMul"));
    if (a.kind === "arc") return toShot(light, { ...base, count: need(n, "arcShotCount"), spreadDeg: need(n, "arcShotSpreadDeg"), pierce: need(n, "arcShotPierce") });
    if (a.kind === "line") return toShot(light, { ...base, count: MIN_COUNT, spreadDeg: 0, pierce: need(n, "lineShotPierce") });
    return light;
  });

/** 短銃: 振りを弾に（弧は 3 発、帯は 2 発） */
const pistol: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    const base = { speed: need(n, "shotSpeed"), life: need(n, "shotLife"), radius: need(n, "shotRadius"), pierce: 0 };
    const light = mulDamage(a, need(n, "damageMul"));
    if (a.kind === "arc") return toShot(light, { ...base, count: need(n, "arcShotCount"), spreadDeg: need(n, "arcShotSpreadDeg") });
    if (a.kind === "line") return toShot(light, { ...base, count: need(n, "lineShotCount"), spreadDeg: need(n, "lineShotSpreadDeg") });
    return light;
  });

/** 長銃: 振りを貫く 1 発に。元からの弾は貫いて速く */
const rifle: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    const heavy = mulDamage(a, need(n, "damageMul"));
    if (a.kind === "arc" || a.kind === "line") {
      return toShot(heavy, { count: MIN_COUNT, spreadDeg: 0, pierce: need(n, "shotPierce"), speed: need(n, "shotSpeed"), life: need(n, "shotLife"), radius: need(n, "shotRadius") });
    }
    if (a.kind === "shot") return { ...heavy, pierce: a.pierce + need(n, "shotPierceAdd"), speed: a.speed * need(n, "shotSpeedMul") };
    return heavy;
  });

/** 仕掛け・装薬・擲弾: 扇・自分の周りの円・弾を照準地点への砲撃（少し遅れて落ちる円）に（装薬・擲弾は仕掛けの写しで始め、数値は型ごと） */
const artillery: ArtActsTransform = (acts, n) =>
  acts.map((a) => {
    const heavy = mulDamage(a, need(n, "damageMul"));
    const delay = need(n, "delayAdd");
    const fold = need(n, "shotCountFold");
    if (a.kind === "arc") return toBombard(heavy, a.reach * need(n, "ringFromReachMul"), delay, fold);
    if (a.kind === "ring" && a.anchor === "self") return toBombard(heavy, a.radius * need(n, "ringFromReachMul"), delay, fold);
    if (a.kind === "shot") return toBombard(heavy, need(n, "shotRingRadius"), delay, fold);
    return heavy;
  });

/** 鈴: 当てる円の後に、遅れて鳴り返す弱い写しを足す */
const bell: ArtActsTransform = (acts, n) =>
  acts.flatMap((a) => {
    if (a.kind !== "ring" || !isStrike(a)) return [a];
    const echo = { ...mulDamage(a, need(n, "echoMul")), name: `${a.name}Echo`, delay: a.delay + need(n, "echoDelay") };
    return [a, echo];
  });

// ---------------------------------------------------------------------------
// 表
// ---------------------------------------------------------------------------

/** 表示の数値（1.30 → 1.3、負は −） */
function fmt(v: number): string {
  const s = String(Math.round(v * 100) / 100);
  return v < 0 ? `−${s.slice(1)}` : s;
}

function signed(v: number): string {
  return v < 0 ? fmt(v) : `+${fmt(v)}`;
}

export const ART_TRANSFORMS: Readonly<Record<FormKey, ArtTransform>> = {
  blade: { acts: same, label: () => "変形なし" },
  flurry: { acts: flurry, label: (n) => `段 ${signed(need(n, "hitsAdd"))}・1 撃 ×${fmt(need(n, "damageMul"))}` },
  crusher: { acts: crusher, label: (n) => `範囲 ×${fmt(need(n, "areaMul"))}・段 ${signed(need(n, "hitsAdd"))}` },
  hewer: { acts: hewer, label: () => "命中で出血" },
  polearm: { acts: polearm, label: (n) => `弧を突きに・長さ ×${fmt(need(n, "lengthMul"))}` },
  chain: { acts: chain, label: () => "当てる前に引き寄せ" },
  bulwark: { acts: bulwark, label: (n) => `敵弾を消す・押し返し ×${fmt(need(n, "knockbackMul"))}` },
  warfan: { acts: warfan, label: () => "突風（敵弾を消す）" },
  rod: { acts: rod, element: "weapon", label: () => "属性を武器に" },
  thrower: { acts: thrower, label: () => "振りを投げに" },
  pistol: { acts: pistol, label: () => "振りを弾に" },
  // 二丁は短銃の写し（ART/TRANSFORM/akimbo.json。二丁らしい変形は後で）
  akimbo: { acts: pistol, label: () => "振りを弾に" },
  rifle: { acts: rifle, label: () => "振りを貫く 1 発に" },
  artillery: { acts: artillery, label: () => "照準地点へ砲撃" },
  powder: { acts: artillery, label: () => "照準地点へ砲撃" },
  shell: { acts: artillery, label: () => "照準地点へ砲撃" },
  // 書は行為を変えず、再使用の倍率（system/tomeBell.ts の formSkillCooldownMul）を表示に出す
  tome: { acts: same, label: () => `再使用 ×${fmt(FORM.tome.skillCooldownMul)}` },
  bell: { acts: bell, label: () => "鳴り返し" },
};

/** 型で行為の列を作り替える（純関数） */
export function transformActs(form: FormKey, acts: readonly ArtAct[]): ArtAct[] {
  return ART_TRANSFORMS[form].acts(acts, TRANSFORM_NUMBERS[form]);
}

/** 石のツールチップの 1 行（「今の型: 重打（範囲 ×1.3・段 −1）」） */
export function formTransformLine(form: FormKey): string {
  return `今の型: ${FORMS[form].name}（${ART_TRANSFORMS[form].label(TRANSFORM_NUMBERS[form])}）`;
}
