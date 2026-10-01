import { kw } from "../core/keywords";
import { BALANCE } from "../data/balance";
import { ATTR_KEYS, type Scaling } from "../loot/types";
import { isArtKey } from "./arts";
import type { ArtAct, ArtActKind, ArtActsTransform } from "./arts/types";
import type { ModifierDef, ModifierKey, Wave2ModifierKey } from "./types";

/**
 * 刻印符の変形のうち、技の行為の列（分裂・旋回・重ね打ち・戻り刃・軌跡）・起点（照準起点・足元起点・据え置き）・
 * 発動の時機（終撃連動・応手連動）を変えるもの（段取り 7c。docs/ideas/skills-7c-plan.md 4 章）。data.ts の MODIFIERS に展開する。
 * transform は純関数（state も rng も読まない）。skills/arts/engine.ts の castArt が型の変形の後に付けた順で当てる。
 * 行為の列を持たない手書きのスキルには、型替え符（照準起点・足元起点・据え置き）の apply だけが効く
 */

const W = BALANCE.skills.WAVE2_MODIFIER_TUNING;

/** 型替え符（照準起点・足元起点・据え置き）が使うリンクの本数 */
export const RESHAPE_LINK_COST = W.reshapeLinkCost;

// ---------------------------------------------------------------------------
// 行為の書き換えの部品（skills/arts/transform.ts の型の変形と同じ作法の小さな写し）
// ---------------------------------------------------------------------------

function scaleScaling(s: Readonly<Scaling>, mul: number): Scaling {
  const out: Scaling = { base: s.base * mul };
  for (const k of ATTR_KEYS) {
    const v = s[k];
    if (v !== undefined) out[k] = v * mul;
  }
  return out;
}

function mulDamage(a: ArtAct, mul: number): ArtAct {
  if (!a.damage || mul === 1) return a;
  return { ...a, damage: scaleScaling(a.damage, mul) };
}

/** 照準起点へ移せる行為（自分の周りに出る範囲の行為。踏み込み・跳躍・弾・自己強化は自分から出るもの） */
const RELOCATABLE: ReadonlySet<ArtActKind> = new Set(["arc", "ring", "line", "pull", "chain"]);

/** 技にこの種類の行為が 1 つでもあるか */
function hasKind(acts: readonly ArtAct[], kinds: readonly ArtActKind[]): boolean {
  return acts.some((a) => kinds.includes(a.kind));
}

/** 分裂: 弾は数を countMul 倍（間隔が 0 の弾は spreadDeg で開く）、扇は隣り合う向きへ並べて countMul 個に。どれも威力 ×damageMul */
const split: ArtActsTransform = (acts) =>
  acts.flatMap((a) => {
    if (a.kind === "shot") {
      return [{ ...mulDamage(a, W.split.damageMul), count: a.count * W.split.countMul, spreadDeg: a.spreadDeg > 0 ? a.spreadDeg : W.split.spreadDeg }];
    }
    if (a.kind !== "arc") return [a];
    // 扇は幅ぶんずつ向きをずらして重ならないように並べる（1 体に何度も当てて倍を超えないため）
    const center = (W.split.countMul - 1) / 2;
    return Array.from({ length: W.split.countMul }, (_, i) => ({
      ...mulDamage(a, W.split.damageMul),
      name: `${a.name}Split${i}`,
      angleDeg: a.angleDeg + (i - center) * a.deg,
    }));
  });

/** 旋回: 弾が自分の周りを回る（動きは engine.ts の shotPath、ここは寿命と貫通） */
const orbit: ArtActsTransform = (acts) => acts.map((a) => (a.kind === "shot" ? { ...a, life: W.orbit.life, pierce: a.pierce + W.orbit.pierceAdd } : a));

/** 重ね打ち: 弾以外の与ダメの行為の段を hitsMul 倍にし、1 段を軽く */
const tripleHit: ArtActsTransform = (acts) =>
  acts.map((a) => (a.damage === undefined || a.kind === "shot" ? a : { ...mulDamage(a, W.tripleHit.damageMul), hits: a.hits * W.tripleHit.hitsMul }));

/** 戻り刃: 弾の寿命を伸ばし（行きは元の寿命、残りが帰り）、帰りにも当たるよう貫通を足す */
const recall: ArtActsTransform = (acts) =>
  acts.map((a) => (a.kind === "shot" ? { ...a, life: a.life * W.recall.lifeMul, pierce: a.pierce + W.recall.pierceAdd } : a));

/** 照準起点: 自分の周りに出る範囲の行為を照準地点へ */
const toTarget: ArtActsTransform = (acts) => acts.map((a) => (a.anchor === "self" && RELOCATABLE.has(a.kind) ? { ...a, anchor: "target" } : a));

/** 足元起点: 照準地点に出る行為を自分の足元へ（跳躍は行き先そのものなので変えない） */
const toNova: ArtActsTransform = (acts) => acts.map((a) => (a.anchor === "target" && a.kind !== "blink" ? { ...a, anchor: "self" } : a));

/** 技の行為の列に transform を足す（付けた順に当てる） */
function withTransform(p: { artTransforms: readonly ModifierKey[] }, key: ModifierKey): readonly ModifierKey[] {
  return [...p.artTransforms, key];
}

/** 連動は変身の切り替え・構えの維持（もう一度撃つと解ける）とは噛み合わない */
const AUTO_CAST_EXCLUDES = ["form", "channel"] as const;

export const WAVE2_MODIFIERS: Record<Wave2ModifierKey, ModifierDef> = {
  split: {
    key: "split",
    name: "分裂",
    verb: `弾と扇を${W.split.countMul}つに分ける（1つ x${W.split.damageMul}）`,
    color: "#80ff60",
    family: "shape",
    keywords: kw(["bullet"], [], ["area"]),
    excludesTags: [],
    transform: split,
    fitsArt: (acts) => acts.some((a) => a.damage !== undefined && (a.kind === "shot" || a.kind === "arc")),
    apply: (p) => ({ ...p, artTransforms: withTransform(p, "split") }),
  },
  orbit: {
    key: "orbit",
    name: "旋回",
    verb: `弾が自分の周りを${W.orbit.life}秒回り、近くの敵に何度も当たる`,
    color: "#a0e0ff",
    family: "shape",
    keywords: kw(["bullet", "area"]),
    excludesTags: [],
    excludesModifiers: ["recall"],
    transform: orbit,
    fitsArt: (acts) => hasKind(acts, ["shot"]),
    apply: (p) => ({ ...p, artTransforms: withTransform(p, "orbit"), shotPath: "orbit" }),
  },
  tripleHit: {
    key: "tripleHit",
    name: "重ね打ち",
    verb: `1撃を${W.tripleHit.hitsMul}段に分ける（1段 x${W.tripleHit.damageMul}）`,
    color: "#ffe0a0",
    family: "shape",
    keywords: kw(["combo"]),
    excludesTags: [],
    transform: tripleHit,
    fitsArt: (acts) => acts.some((a) => a.damage !== undefined && a.kind !== "shot"),
    apply: (p) => ({ ...p, artTransforms: withTransform(p, "tripleHit") }),
  },
  recall: {
    key: "recall",
    name: "戻り刃",
    verb: `弾が行って戻る（帰りにも当たる。貫通 +${W.recall.pierceAdd}）`,
    color: "#d0c0ff",
    family: "shape",
    keywords: kw(["bullet"]),
    excludesTags: [],
    transform: recall,
    fitsArt: (acts) => hasKind(acts, ["shot"]),
    apply: (p) => ({ ...p, artTransforms: withTransform(p, "recall"), shotPath: "recall" }),
  },
  trail: {
    key: "trail",
    name: "軌跡",
    verb: `踏み込み・跳躍の通り道に攻撃の属性の地形を残す（${W.trail.time}秒）`,
    color: "#c0e080",
    family: "shape",
    keywords: kw(["placed"], ["dash"]),
    excludesTags: [],
    // 通り道は撃った瞬間の壁で決まるので行為の列ではなく旗で持ち、engine.ts の踏み込み・跳躍が読む
    fitsArt: (acts) => hasKind(acts, ["dash", "blink"]),
    apply: (p) => ({ ...p, trail: true }),
  },
  toTarget: {
    key: "toTarget",
    name: "照準起点",
    verb: `自分の周りに出る攻撃を照準地点で起こす（手書きの近接は刃が飛んで着いた所で、置くものは投げ込んで着いた瞬間に）`,
    color: "#ffd0ff",
    family: "shape",
    keywords: kw(["ranged"], ["melee"]),
    // 手書きのスキルの相性（技は行為の列で決める）。恨み返しは自分が受けたダメージを返す技なので離れた所では意味が無い
    excludesTags: ["movement", "defense", "buff"],
    requiresTags: ["melee", "placed"],
    excludesSkills: ["grudge"],
    linkCost: RESHAPE_LINK_COST,
    reshape: true,
    transform: toTarget,
    apply: (p, def) => {
      if (isArtKey(def.key)) return { ...p, artTransforms: withTransform(p, "toTarget") };
      if (def.tags.includes("melee")) return { ...p, reshape: "toThrown", knockbackMul: p.knockbackMul * W.toTarget.thrown.knockbackMul };
      const l = W.toTarget.lobbed;
      return { ...p, reshape: "toLobbed", durationMul: p.durationMul * l.durationMul, timeMul: p.timeMul * l.timeMul, damageMul: p.damageMul * l.damageMul };
    },
  },
  toNova: {
    key: "toNova",
    name: "足元起点",
    verb: `照準地点ではなく自分の足元で発動する。範囲 x${W.toNova.areaMul}`,
    color: "#fff0c0",
    family: "shape",
    keywords: kw(["area"], [], ["placed"]),
    excludesTags: ["movement"],
    requiresTags: ["placed"],
    // 地雷・湧き石はもともと足元に置く
    excludesSkills: ["mines", "manaSpring"],
    linkCost: RESHAPE_LINK_COST,
    reshape: true,
    transform: toNova,
    apply: (p, def) => {
      const areaMul = p.areaMul * W.toNova.areaMul;
      if (isArtKey(def.key)) return { ...p, areaMul, artTransforms: withTransform(p, "toNova") };
      return { ...p, areaMul, reshape: "toNova" };
    },
  },
  linger: {
    key: "linger",
    name: "据え置き",
    verb: `撃たずに照準地点へ置く（最大${W.linger.maxAlive}）。敵が近付くとその位置から最寄りの敵へ向けて発動（ダメージ x${W.linger.damageMul}）`,
    color: "#c0a0ff",
    family: "shape",
    keywords: kw(["placed"], [], ["area"]),
    excludesTags: ["placed", "movement", "defense", "buff", "form", "channel"],
    requiresTags: ["melee", "projectile"],
    excludesSkills: ["grudge"],
    linkCost: RESHAPE_LINK_COST,
    reshape: true,
    apply: (p) => ({ ...p, reshape: "toTrap", damageMul: p.damageMul * W.linger.damageMul }),
  },
  autoFinisher: {
    key: "autoFinisher",
    name: "終撃連動",
    verb: "武器の終撃が当たると同時にこのスキルを撃つ（気力・再使用は払う）",
    color: "#ffb060",
    family: "shape",
    keywords: kw([], ["finisher"]),
    excludesTags: AUTO_CAST_EXCLUDES,
    autoCast: "finisher",
    apply: (p) => p,
  },
  autoRiposte: {
    key: "autoRiposte",
    name: "応手連動",
    verb: "応手と同時にこのスキルを撃つ（気力・再使用は払う）",
    color: "#60d0ff",
    family: "shape",
    keywords: kw([], ["counter"]),
    excludesTags: AUTO_CAST_EXCLUDES,
    autoCast: "riposte",
    apply: (p) => p,
  },
};
