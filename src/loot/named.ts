import type { BoonAction, BuildChange } from "../core/build";
import type { DamageTag } from "../core/damage";
import type { EventKind, EventSource } from "../core/events";
import { type KeywordProfile, kw } from "../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import { RELIC } from "../data/tuning";
import { baseDef } from "./bases";
import { type Equipment, type PlayerStats, type Slot, SLOTS } from "./types";

/**
 * 名のある遺物（旧 unique）。18 個すべてが固有の Rule / Modifier / apply / engine の分岐（system/namedRelics.ts）を持つ。
 * 性質は固定（値は小さく揺らぐ）。docs/LOOT_DESIGN.md「名のある遺物」、docs/ideas/relics-7d-plan.md 3 章
 */

export interface UniqueAffixSpec {
  key: string;
}

export interface UniqueDef {
  key: string;
  name: string;
  baseKey: string;
  minLevel: number;
  affixes: readonly UniqueAffixSpec[];
  /** 固定の誓約（KEYSTONES の key） */
  keystone?: string;
  /** フレーバー 1 行 */
  flavor?: string;
  // ---- 段取り 7d（docs/ideas/relics-7d-plan.md 3 章）。畳み方は applyNamedRelics ----
  /** 固有の「〜時: 〜」（owner は { kind: "item", key: この key }）。stats.rules へ装備スロット順に積む */
  rules?: readonly Rule[];
  /** 固有の常時の増・倍。stats.modifiers へ装備スロット順に積む */
  modifiers?: readonly Modifier[];
  /** Rule / Modifier で書けない固有の数値（stats を直接書き換える） */
  apply?: (stats: PlayerStats) => void;
  /** 共鳴の数えに使う語（遺物 1 つの出どころに足す。system/resonance.ts） */
  keywords?: KeywordProfile;
  /** 柱 7 の審査: この遺物で何が変わるか */
  changes?: BuildChange;
  /** 加護の枠を 1 つ開く行動（3 枠目。stats.graceSlotBonus に +1） */
  graceSlot?: BoonAction;
  /** 生成時の余白（省略は名のある遺物の既定） */
  margin?: number;
}

/** 名のある遺物の数え（boonRun.tallies の key。ラン内で消える）。Rule の tally と Modifier の per が同じ key を読む */
export function relicTallyKey(key: string): string {
  return `relic:${key}`;
}

/** 名のある遺物の Rule / Modifier の持ち主（出どころの表示・ICD の鍵） */
function relicOwner(key: string): EventSource {
  return { kind: "item", key };
}

/** Rule の書きかけ（id・持ち主・既定の確率 / ICD / scope は relicRules が埋める） */
interface RelicRuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

function relicRules(key: string, specs: readonly RelicRuleSpec[]): Rule[] {
  const owner = relicOwner(key);
  return specs.map((s, i) => ({ id: ruleId(owner, i), when: s.when, if: s.if ?? [], then: s.then, chance: 1, icd: s.icd ?? 0, scope: SCOPE_ANY, owner }));
}

type RelicModifierSpec = Omit<Modifier, "id" | "owner" | "label" | "if"> & { if?: readonly RuleCondition[] };

/** Modifier の id は Rule と分けて "m" を付ける（倍の出所 "mod:<id>" が Rule の id と重ならない） */
function relicModifiers(key: string, label: string, specs: readonly RelicModifierSpec[]): Modifier[] {
  const owner = relicOwner(key);
  return specs.map((s, i) => ({ ...s, id: `${ruleId(owner, i)}m`, if: s.if ?? [], owner, label }));
}

/** 数え key を 0 に戻す Rule の効果（magnitude −1 × 今の数え） */
function resetTally(tally: string): RuleEffect {
  return { kind: "tally", magnitude: -1, scaleBy: "counter", counter: { kind: "tally", key: tally }, key: tally };
}

function addTallyEffect(tally: string): RuleEffect {
  return { kind: "tally", magnitude: 1, key: tally };
}

/** 数えが lo..hi の間（賽の目・1 階 1 回） */
function tallyBetween(tally: string, atLeast?: number, atMost?: number): RuleCondition {
  return {
    kind: "counter",
    counter: { kind: "tally", key: tally },
    ...(atLeast === undefined ? {} : { atLeast }),
    ...(atMost === undefined ? {} : { atMost }),
  };
}

// ---- 遺物ごとの固有（数値は balance/loot/RELIC.json。docs/ideas/relics-7d-plan.md 3 章） ----

const TWIN_SERPENT = "twinSerpent";
const TWIN_TALLY = relicTallyKey(TWIN_SERPENT);
const BELL_TONGUE = "bellTongue";
const BELL_TALLY = relicTallyKey(BELL_TONGUE);
const DRAGON_SCALE = "dragonScale";
/** 起死の鱗の 1 階 1 回の数え（階の到着で system/namedRelics.ts が 0 に戻す） */
export const DRAGON_SCALE_TALLY = relicTallyKey(DRAGON_SCALE);
const DICE_RING = "diceRing";
/** 賽の目の指輪の目（階の到着で system/namedRelics.ts が振る。0 = まだ振っていない） */
export const DICE_TALLY = relicTallyKey(DICE_RING);
const WANDER_SHOES = "wanderShoes";
/** 旅人の靴の歩いた距離（px。system/namedRelics.ts の relicStride が足す） */
export const STRIDE_TALLY = relicTallyKey(WANDER_SHOES);
const PLAIN_BLADE = "plainBlade";
/** 鐘の一掃の輪の色 / 起死の鱗の凍結の輪の色 */
const BELL_COLOR = "#ffe0a0";
const DRAGON_COLOR = "#a0e0ff";

/** 賽の目 1..5 のタグ（6 は全部） */
const DICE_TAGS: readonly DamageTag[] = ["melee", "ranged", "skill", "dot", "ultimate"];
/** 全部の目（6） */
const DICE_ALL_FACE = DICE_TAGS.length + 1;

function diceModifiers(): RelicModifierSpec[] {
  const faces: RelicModifierSpec[] = DICE_TAGS.map((tag, i) => ({ kind: "more", tag, amount: RELIC.diceRing.tagMul, if: [tallyBetween(DICE_TALLY, i + 1, i + 1)] }));
  faces.push({ kind: "more", tag: "all", amount: RELIC.diceRing.allMul, if: [tallyBetween(DICE_TALLY, DICE_ALL_FACE, DICE_ALL_FACE)] });
  return faces;
}

/** 起死の鱗: 生命が 3 割を切った被弾で（1 階に 1 回）。凍結 → 無敵 → 数え +1 の順（数えを先に進めると後の 2 つが外れる） */
const DRAGON_IF: readonly RuleCondition[] = [
  { kind: "counter", counter: { kind: "missingHpTenths" }, atLeast: RELIC.dragonScale.missingTenths },
  tallyBetween(DRAGON_SCALE_TALLY, undefined, 0),
];

/** 重ねの首飾り: 命中で付ける状態異常の確率を下げる（重ねは system/namedRelics.ts の relicStatusApply） */
function halveProcChances(s: PlayerStats): void {
  const mul = RELIC.layeredNecklace.chanceMul;
  s.burnChance *= mul;
  s.chillChance *= mul;
  s.shockChance *= mul;
  s.statusProcs = s.statusProcs.map((p) => ({ ...p, chance: p.chance * mul }));
}

export const UNIQUES: readonly UniqueDef[] = [
  // ---- 右手 4 ----
  {
    key: TWIN_SERPENT,
    name: "双頭の蛇",
    baseKey: "twinDaggers",
    minLevel: 6,
    flavor: "右の牙と左の牙。交互に噛むほど、毒は深く回る。",
    affixes: [{ key: "twinEdge" }],
    rules: relicRules(TWIN_SERPENT, [{ when: "onTwinStrike", then: addTallyEffect(TWIN_TALLY) }]),
    // 同じ側の命中で数えを 0 に戻すのは system/moments.ts の noteTwinStrike → namedRelics.ts の breakTwinSerpent
    modifiers: relicModifiers(TWIN_SERPENT, "双頭の蛇", [{ kind: "more", tag: "all", amount: RELIC.twinSerpent.step, per: { count: { kind: "tally", key: TWIN_TALLY }, cap: RELIC.twinSerpent.cap } }]),
    keywords: kw([], ["combo"]),
    changes: "press",
    graceSlot: "secondary",
  },
  {
    key: "emptyScabbard",
    name: "空の鞘",
    baseKey: "tachi",
    minLevel: 10,
    flavor: "刃は抜かれない。抜かれぬまま、通り過ぎたものを斬っている。",
    affixes: [],
    // 左右の振りが出ないのは system/player.ts の beginSwing → namedRelics.ts の relicBlocksSwing
    rules: relicRules("emptyScabbard", [
      { when: "onDash", then: { kind: "nearbyEnemies", magnitude: RELIC.emptyScabbard.mul, scaleBy: "slashBase", radius: RELIC.emptyScabbard.radius } },
    ]),
    keywords: kw([], ["dash"], ["dash"]),
    changes: "press",
    graceSlot: "dash",
  },
  {
    key: "mallet",
    name: "打ち出の小槌",
    baseKey: "mallet",
    minLevel: 5,
    flavor: "振れば出る。ただし、振り切ったときだけ。",
    affixes: [{ key: "finisherEdge" }],
    rules: relicRules("mallet", [{ when: "onFinisher", then: { kind: "gainCoins", magnitude: RELIC.mallet.coins }, icd: RELIC.mallet.icd }]),
    keywords: kw([], ["finisher"]),
    changes: "press",
  },
  {
    key: PLAIN_BLADE,
    name: "無地の刃",
    baseKey: "wakizashi",
    minLevel: 9,
    flavor: "何も刻まれていない。だから、何でも刻める。",
    affixes: [],
    margin: RELIC.plainBlade.margin,
    modifiers: relicModifiers(PLAIN_BLADE, "無地の刃", [{ kind: "more", tag: "all", amount: RELIC.plainBlade.step, per: { count: { kind: "gearMargin" } } }]),
    keywords: kw([]),
    changes: "watch",
    graceSlot: "primary",
  },
  // ---- 首飾り 5 ----
  {
    key: "reverseHourglass",
    name: "逆さ砂時計",
    baseKey: "onyxAmulet",
    minLevel: 10,
    flavor: "落ちる砂は止められない。ただ、順番を入れ替えるだけだ。",
    affixes: [],
    // 遅れて来る傷と撃破の帳消しは system/combat.ts → namedRelics.ts の relicDeferDelay / relicForgiveOnKill
    keywords: kw([], ["kill", "hurt"]),
    changes: "timing",
  },
  {
    key: "herdFlute",
    name: "群れ呼びの笛",
    baseKey: "fangNecklace",
    minLevel: 8,
    flavor: "群れの長が倒れたとき、群れは次の笛の音に従う。",
    affixes: [],
    rules: relicRules("herdFlute", [
      {
        when: "onExecute",
        then: { kind: "tameEnemy", magnitude: 0, radius: RELIC.herdFlute.radius, onlyWith: "stagger", count: RELIC.herdFlute.count, duration: RELIC.herdFlute.duration },
      },
    ]),
    keywords: kw(["placed"], ["stagger"]),
    changes: "target",
  },
  {
    key: "pilgrimBeads",
    name: "巡礼の数珠",
    baseKey: "rosary",
    minLevel: 6,
    flavor: "珠の一つひとつが、別の寺の名を覚えている。",
    affixes: [],
    modifiers: relicModifiers("pilgrimBeads", "巡礼の数珠", [{ kind: "more", tag: "all", amount: RELIC.pilgrimBeads.step, per: { count: { kind: "lineagesOwned" } } }]),
    keywords: kw([]),
    changes: "watch",
    graceSlot: "skill",
  },
  {
    key: "layeredNecklace",
    name: "重ねの首飾り",
    baseKey: "coralAmulet",
    minLevel: 12,
    flavor: "滅多に刺さらない。刺さったときは、三度刺さっている。",
    affixes: [{ key: "procPoison" }],
    // 1 回で 3 重ねは system/statusEffects.ts の applyStatus → namedRelics.ts の relicStatusApply
    apply: halveProcChances,
    keywords: kw([], [], ["burn", "poison", "bleed"]),
    changes: "watch",
  },
  {
    key: "sixCoins",
    name: "六文銭",
    baseKey: "duskAmulet",
    minLevel: 12,
    flavor: "渡し賃は足りている。今回は、戻りの舟に乗る。",
    affixes: [],
    // 蘇りは system/combat.ts の killPlayer → namedRelics.ts の relicRevive
    keywords: kw([]),
    changes: "watch",
  },
  // ---- 頭 3 ----
  {
    key: "starReader",
    name: "星読みの眼",
    baseKey: "circlet",
    minLevel: 6,
    flavor: "星の巡りに比べれば、振りかぶる腕などゆっくりだ。",
    affixes: [{ key: "readAhead" }],
    // 予告の線の目盛りは render/telegraphLineUi.ts（描画だけ）
    modifiers: relicModifiers("starReader", "星読みの眼", [
      { kind: "more", tag: "all", amount: RELIC.starReader.more, if: [{ kind: "trigger", condition: "targetInWindup" }] },
    ]),
    keywords: kw([], ["counter"]),
    changes: "timing",
  },
  {
    key: "jizo",
    name: "身代わり地蔵",
    baseKey: "sandogasa",
    minLevel: 5,
    flavor: "賽銭の分だけ、石が代わりに欠けてくれる。",
    affixes: [],
    // 被弾の半分を銭で受けるのは system/combat.ts → namedRelics.ts の relicPayWithCoins
    keywords: kw(["ward"], ["hurt"]),
    changes: "watch",
  },
  {
    key: "boneCrown",
    name: "骸の冠",
    baseKey: "hornedHelm",
    minLevel: 12,
    flavor: "死者は冠の主に道を譲る。踏まれると、弾けて。",
    affixes: [],
    // 死骸を踏むと爆ぜるのは system/player.ts → namedRelics.ts の tickNamedRelics
    keywords: kw(["explode"], ["kill"]),
    changes: "position",
  },
  // ---- 指輪 3 ----
  {
    key: BELL_TONGUE,
    name: "鐘の舌",
    baseKey: "blackIronRing",
    minLevel: 14,
    flavor: "九つまでは余韻。十で、鐘は割れるほど鳴る。",
    affixes: [{ key: "finisherEdge" }],
    // 並び順が効く: +1 → 一掃（数え ≥ every = この終撃が every 回目）→ 戻し。数えは同じイベントの中で即座に進む
    rules: relicRules(BELL_TONGUE, [
      { when: "onFinisher", then: addTallyEffect(BELL_TALLY) },
      {
        when: "onFinisher",
        if: [tallyBetween(BELL_TALLY, RELIC.bellTongue.every)],
        then: { kind: "nearbyEnemies", magnitude: RELIC.bellTongue.mul, scaleBy: "slashBase", radius: RELIC.bellTongue.radius, color: BELL_COLOR },
      },
      { when: "onFinisher", if: [tallyBetween(BELL_TALLY, RELIC.bellTongue.every)], then: resetTally(BELL_TALLY) },
    ]),
    keywords: kw(["area"], ["finisher"]),
    changes: "press",
    graceSlot: "ultimate",
  },
  {
    key: "luckyCat",
    name: "招き猫",
    baseKey: "goldRing",
    minLevel: 7,
    flavor: "右手で銭を招き、左手で落とし物を招く。",
    affixes: [{ key: "purse" }],
    apply: (s) => {
      s.coinMagnetMul *= RELIC.luckyCat.magnetMul;
      s.coinGainMul *= RELIC.luckyCat.gainMul;
      s.coinSpillMul *= RELIC.luckyCat.spillMul;
    },
    keywords: kw([]),
    changes: "position",
  },
  {
    key: DICE_RING,
    name: "賽の目の指輪",
    baseKey: "boneRing",
    minLevel: 8,
    flavor: "骨の賽は、階ごとに一度だけ転がる。",
    affixes: [],
    // 目は階の到着で振る（system/floor.ts → namedRelics.ts の onRelicFloorStart）
    modifiers: relicModifiers(DICE_RING, "賽の目の指輪", diceModifiers()),
    keywords: kw([]),
    changes: "watch",
  },
  // ---- 体 2 ----
  {
    key: DRAGON_SCALE,
    name: "起死の鱗",
    baseKey: "scale",
    minLevel: 12,
    flavor: "死の淵で、鱗は一枚だけ時を止める。",
    affixes: [],
    rules: relicRules(DRAGON_SCALE, [
      {
        when: "onHurt",
        if: DRAGON_IF,
        then: { kind: "nearbyEnemies", magnitude: 0, status: "freeze", duration: RELIC.dragonScale.freezeSec, radius: RELIC.dragonScale.radius, skipBoss: true, color: DRAGON_COLOR },
      },
      // 周りの凍結は対象（殴ってきた敵）を除くので、殴ってきた敵は別に凍らせる
      { when: "onHurt", if: DRAGON_IF, then: { kind: "afflict", magnitude: 0, status: "freeze", duration: RELIC.dragonScale.freezeSec } },
      { when: "onHurt", if: DRAGON_IF, then: { kind: "ward", magnitude: 0, duration: RELIC.dragonScale.wardSec } },
      { when: "onHurt", if: DRAGON_IF, then: addTallyEffect(DRAGON_SCALE_TALLY) },
    ]),
    keywords: kw(["ward"], ["lowHp"]),
    changes: "timing",
  },
  {
    key: "greedHide",
    name: "欲の皮",
    baseKey: "leather",
    minLevel: 6,
    flavor: "厚いのは財布だけではない。",
    affixes: [],
    // 持ち金で被ダメージを減らすのは system/combat.ts → namedRelics.ts の relicIncomingMul
    apply: (s) => {
      s.coinSpillMul *= RELIC.greedHide.spillMul;
    },
    keywords: kw(["ward"]),
    changes: "watch",
  },
  // ---- 足 1 ----
  {
    key: WANDER_SHOES,
    name: "旅人の靴",
    baseKey: "sandals",
    minLevel: 4,
    flavor: "道のりは靴底に溜まる。蹴り出す一歩のために。",
    affixes: [{ key: "firstStrikeEdge" }],
    // 距離を溜めるのは system/player.ts → namedRelics.ts の relicStride。当てた一撃（振り・弾）で使い切る
    rules: relicRules(WANDER_SHOES, [
      { when: "onSwingHit", then: resetTally(STRIDE_TALLY) },
      { when: "onRangedHit", then: resetTally(STRIDE_TALLY) },
    ]),
    modifiers: relicModifiers(WANDER_SHOES, "旅人の靴", [
      { kind: "more", tag: "all", amount: RELIC.wanderShoes.step, per: { count: { kind: "tally", key: STRIDE_TALLY }, every: RELIC.wanderShoes.every } },
    ]),
    keywords: kw([], ["dash"]),
    changes: "position",
  },
];

/** slot に対応し depth で解禁済みの名のある遺物 */
export function uniquesFor(slot: Slot, depth: number): UniqueDef[] {
  return UNIQUES.filter((u) => u.minLevel <= depth && baseDef(u.baseKey)?.slot === slot);
}

export function uniqueDef(key: string): UniqueDef | undefined {
  return UNIQUES.find((u) => u.key === key);
}

/**
 * 装備している名のある遺物の固有を stats に畳む（computeStats が性質の適用の直後に呼ぶ）。
 * 決定性のため装備スロット順（SLOTS）。rules / modifiers は差し替えで足す（列は複数の stats で共有されうる）。
 * lookup は定義の引き方（テストで表に無い遺物を差し込むため。本体は uniqueDef）
 */
export function applyNamedRelics(
  stats: PlayerStats,
  equipment: Equipment,
  lookup: (key: string) => UniqueDef | undefined = uniqueDef,
): void {
  for (const slot of SLOTS) {
    const key = equipment[slot]?.namedKey;
    const def = key === undefined ? undefined : lookup(key);
    if (def === undefined) continue;
    applyNamedRelic(stats, def);
  }
}

function applyNamedRelic(stats: PlayerStats, def: UniqueDef): void {
  if (def.rules !== undefined && def.rules.length > 0) stats.rules = [...stats.rules, ...def.rules];
  if (def.modifiers !== undefined && def.modifiers.length > 0) stats.modifiers = [...stats.modifiers, ...def.modifiers];
  if (def.graceSlot !== undefined) {
    const action = def.graceSlot;
    stats.graceSlotBonus = { ...stats.graceSlotBonus, [action]: (stats.graceSlotBonus[action] ?? 0) + 1 };
  }
  def.apply?.(stats);
}
