/**
 * 状態異常の型と一覧（docs/COMBAT_DESIGN.md E-1 / docs/ideas/status-and-terrain.md）。
 * プレイヤーと敵で共通の入れ物を使う。ロジックは src/system/statusEffects.ts（付与・時間経過）と
 * src/system/statusReactions.ts（反応・昇華）に置く
 */

export const STATUS_KINDS = [
  "burn",
  "chill",
  "freeze",
  "shock",
  "paralyze",
  "poison",
  "bleed",
  "vulnerable",
  "weaken",
  "fear",
  "silence",
  "stagger",
  "guarded",
  // ---- 以下は 2026-09-24 追加（docs/ideas/status-and-terrain.md 1・5 章） ----
  "wet",
  "oiled",
  "corrode",
  "brand",
  "broken",
  "doom",
  "siphon",
  "hue",
  // 昇華（元の状態に上乗せされる上位の状態）
  "scorch",
  "blaze",
  "venom",
  "hemorrhage",
  "encase",
  "exposed",
  "enfeeble",
  "soaked",
  // 良い状態（プレイヤーのバフ）
  "haste",
  "harden",
  "wrath",
  "fury",
  "charged",
] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/** 表示名（docs/GLOSSARY.md の表記）。describe や QA の集計が同じ名前を使えるようここに置く */
export const STATUS_LABEL: Readonly<Record<StatusKind, string>> = {
  burn: "燃焼",
  chill: "冷気",
  freeze: "凍結",
  shock: "感電",
  paralyze: "麻痺",
  poison: "毒",
  bleed: "出血",
  vulnerable: "脆弱",
  weaken: "弱体",
  fear: "恐怖",
  silence: "沈黙",
  stagger: "怯み",
  guarded: "堅守",
  wet: "濡れ",
  oiled: "油膜",
  corrode: "腐食",
  brand: "烙印",
  broken: "崩勢",
  doom: "宣告",
  siphon: "吸魔",
  hue: "彩痕",
  scorch: "灼熱",
  blaze: "炎上",
  venom: "猛毒",
  hemorrhage: "大出血",
  encase: "氷棺",
  exposed: "露呈",
  enfeeble: "無力",
  soaked: "浸水",
  haste: "加速",
  harden: "硬化",
  wrath: "怒気",
  fury: "激昂",
  charged: "帯電",
};

/** 良い状態（プレイヤーのバフ）。敵には付かず、異常数・総スタックにも数えない */
export const GOOD_STATUS_KINDS: ReadonlySet<StatusKind> = new Set<StatusKind>(["haste", "harden", "wrath", "fury", "charged"]);

/** 異常数・総スタックに数えない中立の状態（怯みと堅守は戦闘の区切りで、状態異常ビルドの成果ではない） */
export const NEUTRAL_STATUS_KINDS: ReadonlySet<StatusKind> = new Set<StatusKind>(["stagger", "guarded"]);

/**
 * 付けた側。player 由来だけが装備・祝福のフック（野火・氷砕など）を起こす。
 * self = 自傷（猪の壁激突・鎧が割れた隙など）。拘束上限を数えない唯一の付け元。env（地形・伝播・連結の紐）は上限に数える
 */
export type StatusSource = "player" | "enemy" | "env" | "self";

export interface StatusEffect {
  kind: StatusKind;
  stacks: number;
  /** 残り秒 */
  time: number;
  /** HUD の減り方用: 付与・延長時の持続 */
  maxTime: number;
  /**
   * 種類ごとに解釈（burn = dps、poison = 最大 HP 割合 / 秒、bleed = 10px あたりダメージ、
   * brand = 1 スタックの起爆ダメージ、hue = 色番号（TRAIT_COLORS の添字）、charged = 放電ダメージ …）
   */
  potency: number;
  source: StatusSource;
  /** DoT の端数（既存 BurnEffect.acc と同じ） */
  acc: number;
  /** 周期効果（感電の連鎖・灼熱の延焼など）のタイマー */
  tick: number;
  /** 付いている間に付け直された回数（脆弱 → 露呈、弱体 → 無力、凍結中の冷気 → 氷棺の昇華に使う） */
  reapplied?: number;
  /** 宣告: 付与した瞬間の HP（切れたときに減った量を数える） */
  hpMark?: number;
}

/** 反応（2 つの状態異常が出会ったときの追加効果。docs/ideas/status-and-terrain.md 2 章） */
export const REACTION_KEYS = [
  "vaporize",
  "steam",
  "quench",
  "conduct",
  "ignite",
  "kindle",
  "miasma",
  "shatterBleed",
  "cauterize",
  "dissolve",
  "lacerate",
  "collapse",
  "exposeDoom",
  "wither",
  "frostPoison",
  "panic",
  "brandBurst",
  "thaw",
  "rage",
  "discharge",
  "iceArmor",
  "hueBurst",
  "manaCut",
  "rally",
] as const;
export type ReactionKey = (typeof REACTION_KEYS)[number];

export const REACTION_LABEL: Readonly<Record<ReactionKey, string>> = {
  vaporize: "蒸発",
  steam: "蒸気",
  quench: "急冷",
  conduct: "拡散",
  ignite: "炎上",
  kindle: "引火",
  miasma: "毒霧",
  shatterBleed: "砕血",
  cauterize: "焼灼",
  dissolve: "溶解",
  lacerate: "裂傷",
  collapse: "崩落",
  exposeDoom: "暴露",
  wither: "萎縮",
  frostPoison: "凍毒",
  panic: "恐慌",
  brandBurst: "烙爆",
  thaw: "融解",
  rage: "逆上",
  discharge: "放電",
  iceArmor: "氷鎧",
  hueBurst: "色爆",
  manaCut: "魔断",
  rally: "奮起",
};

/** 状態異常が消えた理由。時間切れ / 外から外された（砕きなど）/ 反応で消費された */
export type StatusEndCause = "expire" | "remove" | "consume";

export interface StatusEnded {
  kind: StatusKind;
  cause: StatusEndCause;
  /** 消えた瞬間の state.tick */
  tick: number;
}

export interface StatusBag {
  effects: StatusEffect[];
  /** 種類 → 免疫の残り秒 */
  immune: Partial<Record<StatusKind, number>>;
  /** on-hit 付与の内部 CD（既存 EnemyEffects.onHitCooldown） */
  procIcd: number;
  /** 拘束上限: 直近 ccWindow 秒に入った行動停止の合計秒 */
  ccSpent: number;
  ccWindowLeft: number;
  /** 出血の移動距離を測る基準点（前ステップの位置）。出血中だけ持つ */
  bleedFrom?: { x: number; y: number };
  /** 反応ごとの内部 CD の残り秒（同じ反応を連打で起こし続けない） */
  reactionIcd?: Partial<Record<ReactionKey, number>>;
  /** 直前に消えた状態異常（語彙「直前に消えた状態異常」） */
  lastEnded?: StatusEnded;
  /** 直前に起きた反応（語彙・演出用） */
  lastReaction?: { key: ReactionKey; tick: number };
  /** on-hit・砕きの最中に起きた反応ダメージ。撃破の二重処理を避けるため次のステップで与える */
  queued?: { amount: number; poise: number }[];
}

export interface StatusApply {
  kind: StatusKind;
  stacks: number;
  duration: number;
  potency: number;
}

/** 装備の性質が持つ on-hit 付与（docs/COMBAT_DESIGN.md E-5） */
export interface StatusProc {
  kind: StatusKind;
  /** 0..1 */
  chance: number;
  stacks: number;
  duration: number;
  potency: number;
  /** どの攻撃で判定するか */
  on: "melee" | "ranged" | "skill" | "any";
  /** crit: 会心時のみ */
  requiresCrit?: boolean;
}

export function createStatusBag(): StatusBag {
  return { effects: [], immune: {}, procIcd: 0, ccSpent: 0, ccWindowLeft: 0 };
}
