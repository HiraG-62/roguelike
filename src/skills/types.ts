import type { Element } from "../core/element";
import type { KeywordProfile } from "../core/keywords";
import type { Modifier, Rule } from "../core/rules";
import type { TimedMul } from "../core/state";
import type { StatusApply } from "../core/status";
import type { Vec } from "../core/vec";
import type { GameMap } from "../map/grid";
import type { MovesetDef, MovesetKey } from "../data/weapons";
import type { AttrRatio, Scaling } from "../loot/types";
import { ART_SKILL_KEYS } from "./arts/keys";
import type { ArtAct, ArtActsTransform, ArtPending } from "./arts/types";

/**
 * スキルシステムの共有型。docs/ideas/skills.md「6-1」「7. 最小実装の仕様」。
 * 永続（スキル石 / SkillProfile）とラン内（SkillRunState）を分ける。
 */

export const SKILL_TAGS = [
  "melee",
  "projectile",
  "area",
  "movement",
  "defense",
  "buff",
  "placed",
  "channel",
  "fire",
  "cold",
  "lightning",
  /** 連動体（自分では攻撃せず、プレイヤーの近接・射撃に合わせて動く） */
  "summon",
  /** 変身（一定秒だけ武器種が変わる。docs/ideas/skills-expansion.md 0 章） */
  "form",
] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

/** 最小実装からの 7（段取り 7c で行為の列で書けるものは技へ吸収した。docs/ideas/skills-7c-plan.md 3 章） */
export const BASE_SKILL_KEYS = ["parry", "bloodPact", "gravityWell", "mines", "haste", "chainHook", "frostField"] as const;

/** 大拡張（docs/ideas/skills-expansion.md 1 章）。実装は skills/actions.ts / shots.ts / summons.ts */
export const EXTRA_SKILL_KEYS = [
  "contagion",
  "unravel",
  "kindle",
  "powderKeg",
  "swordGrave",
  "iceBreaker",
  "bloodlet",
  "harvest",
  "discharge",
  "rout",
  "verdict",
  "exploit",
  "strip",
  "lastStand",
  "comboChain",
  "grudge",
  "backflow",
  "scarRoar",
  "manaSpring",
  "turret",
] as const;
export type ExtraSkillKey = (typeof EXTRA_SKILL_KEYS)[number];

/**
 * 第 2 弾（地形・新しい状態異常・属性・武器種・変身・空間）。定義は skills/defs2.ts、発動は skills/actions2.ts
 */
export const WAVE2_SKILL_KEYS = [
  "waterJar",
  "oilPot",
  "levelGround",
  "emberDraw",
  "brandSear",
  "brandBlast",
  "flashFreeze",
  "hueEtch",
  "hueRelease",
  "doomSentence",
  "shiftingEdge",
  "wardStake",
  // ---- 2026-09-24 第 4 弾（地形を作る。見送っていた泥沼）----
  "mire",
] as const;
export type Wave2SkillKey = (typeof WAVE2_SKILL_KEYS)[number];

/**
 * 第 3 弾: 左右クリックの動作そのものを差し替える変身（SkillRunState.shape を立てる）。
 * 定義は skills/defs3.ts、状態遷移と左右クリックの差し替えは skills/forms.ts
 */
export const WAVE3_SKILL_KEYS = ["wolfForm", "wraithForm", "siegeForm", "ironForm", "pyreForm"] as const;
export type Wave3SkillKey = (typeof WAVE3_SKILL_KEYS)[number];

/** 行為の列で書くスキル（技）より前のスキル。定義を個別に手で書いた石（相性表のテストはこの範囲を固定する） */
export const LEGACY_SKILL_KEYS = [...BASE_SKILL_KEYS, ...EXTRA_SKILL_KEYS, ...WAVE2_SKILL_KEYS, ...WAVE3_SKILL_KEYS] as const;
export type LegacySkillKey = (typeof LEGACY_SKILL_KEYS)[number];

/** 追加はここへ（BASE / EXTRA / WAVE2 / WAVE3 のどれか、行為の列で書けるものは skills/arts/keys.ts） */
export const SKILL_KEYS = [...LEGACY_SKILL_KEYS, ...ART_SKILL_KEYS] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/**
 * 刻印符 30（段取り 7c。docs/ideas/skills-7c-plan.md 4 章）。数値の置き場で 3 つに分ける（balance.test.ts が JSON と突き合わせる）。
 * 変形（技の形を変える）: 数値は data/balance/skills/SKILL/modifier.json、定義は skills/modifiers.ts
 */
export const BASE_MODIFIER_KEYS = ["delay", "echo", "charge", "pierce", "tether", "focus", "ghost", "chain", "burst", "leyline"] as const;
export type BaseModifierKey = (typeof BASE_MODIFIER_KEYS)[number];

/** 循環（気力・再使用の回し方）: 数値は EXTRA_MODIFIER_TUNING.json、定義は skills/modifiers.ts */
export const EXTRA_MODIFIER_KEYS = [
  "bloodPrice",
  "spillover",
  "streak",
  "refund",
  "overheat",
  "patience",
  "sympathy",
  "desperate",
  "offering",
  "ledger",
] as const;
export type ExtraModifierKey = (typeof EXTRA_MODIFIER_KEYS)[number];

/**
 * 変形のうち行為の列・起点・発動の時機を変えるもの（技だけに付く 5 枚・起点の型替え 3 枚・連動 2 枚）:
 * 数値は WAVE2_MODIFIER_TUNING.json、定義は skills/modifiers2.ts
 */
export const WAVE2_MODIFIER_KEYS = [
  "split",
  "orbit",
  "tripleHit",
  "recall",
  "trail",
  "toTarget",
  "toNova",
  "linger",
  "autoFinisher",
  "autoRiposte",
] as const;
export type Wave2ModifierKey = (typeof WAVE2_MODIFIER_KEYS)[number];

export const MODIFIER_KEYS = [...BASE_MODIFIER_KEYS, ...EXTRA_MODIFIER_KEYS, ...WAVE2_MODIFIER_KEYS] as const;
export type ModifierKey = (typeof MODIFIER_KEYS)[number];

/**
 * 型替え符が差し替える発動の型（castSlot の入口で読む）。toThrown / toLobbed = 照準起点（近接 / 置くもの）、
 * toNova = 足元起点、toTrap = 据え置き
 */
export type ReshapeKey = "toThrown" | "toLobbed" | "toNova" | "toTrap";

/** 技の弾の動き（旋回 = 自分の周りを回る / 戻り刃 = 行って戻る）。skills/arts/engine.ts が弾を操る */
export type ShotPath = "orbit" | "recall";

/** 連携（docs/ideas/skills-expansion.md 4 章）。定義は skills/combos.ts */
export type ComboKey =
  | "hookWhirl"
  | "parryRail"
  | "diveQuake"
  | "contagionUnravel"
  | "frostBreaker"
  | "shadowExploit"
  | "reelStomp"
  // ---- 第 2 弾（skills/combos.ts） ----
  | "waterFreeze"
  | "oilScorch"
  | "brandChain"
  | "breakCollapse"
  | "hueBloom"
  | "formArt"
  | "levelMeteor";

/** rollOutgoing に渡す種別。none は与ダメを持たない（buff） */
export type SkillDamageKind = "melee" | "ranged" | "none";

export const VARIANT_AXES = [
  "areaVsDamage",
  "cooldownVsDamage",
  "speedVsDamage",
  "countVsDamage",
  "durationVsPotency",
  "cooldownVsPotency",
] as const;
export type VariantAxis = (typeof VARIANT_AXES)[number];

/** スキルの資源（docs/COMBAT_DESIGN.md B-4）。mana = マナ消費 / cooldown = 既存の CD とチャージ */
export type SkillResource = "mana" | "cooldown";

export interface SkillDef {
  key: SkillKey;
  name: string;
  /** HUD の 1 文字アイコン */
  icon: string;
  /** ツールチップ先頭の動詞 1 行 */
  verb: string;
  tags: readonly SkillTag[];
  damageKind: SkillDamageKind;
  cooldown: number;
  charges: number;
  /** この石にロールされうる変異軸（得失が意味を持つものだけ） */
  axes: readonly VariantAxis[];
  // ---- 戦闘再設計（docs/COMBAT_DESIGN.md B-4）。マナ型は cooldown 0・charges 1 ----
  resource: SkillResource;
  /** マナ型のコスト（CD 型は 0） */
  manaCost: number;
  /** このスロットだけの連打下限（秒） */
  minInterval: number;
  /** 1 ヒットの怯み値（ステータスが基礎値のとき。最終値は係数の上乗せ後に × poiseDamageMul） */
  poise: number;
  /** 怯み値のステータス係数（docs/COMBAT_DESIGN.md A-10）。省略はステータスで伸びない */
  poiseRatio?: AttrRatio;
  /** 強化系スキル（血の契約・加速）の効果量の倍率。ステータスが基礎値のとき 1 になる Scaling。省略は 1 固定 */
  buffScaling?: Scaling;
  /** 命中した敵に付ける状態異常（効果量の係数は StatusApply.ratio） */
  applies?: readonly StatusApply[];
  /** 連携: このスキルが「後」になる組み合わせ（skills/combos.ts の COMBOS の key） */
  combos?: readonly ComboKey[];
  /** 統一ルール（src/core/rules.ts）。scope が any ならこの石のスロットの発動が起こしたイベントだけを食う */
  rules?: readonly Rule[];
  /** 常時の増・倍（Modifier）。スロットに入っている間だけ効く（system/modifiers.ts） */
  modifiers?: readonly Modifier[];
  /** 共通語彙（docs/ideas/synergy-web.md 1 章）。命中で付ける状態異常とマナ消費は system/keywords.ts が足す */
  keywords: KeywordProfile;
  /**
   * 同時発動の排他グループ（docs/COMBAT_DESIGN.md B-9）。body = 体を使う本動作（近接・移動・照準）。
   * body 同士は同時に発動できない（発動中の本動作 SkillRunState.active は 1 つだけなので）。
   * 省略したスキル（設置・射撃・強化）は本動作の最中でも並行して撃てる
   */
  exclusiveGroup?: SkillExclusiveGroup;
  /** 武器技: この武器種を装備しているときだけ撃てる（docs/ideas/weapon-skills.md）。省略はどの武器種でも撃てる */
  moveset?: MovesetKey;
}

/** 同時発動の排他グループ。今は本動作（body）の 1 種だけ */
export type SkillExclusiveGroup = "body";

/** 1 回の発動の最終パラメータ。変異・リンク・修飾子を畳み込んだ結果 */
export interface CastParams {
  damageMul: number;
  /** buff 系の効果量倍率 */
  potencyMul: number;
  areaMul: number;
  /** 予備動作・持続（旋風の回転・照準・導火線）の時間倍率 */
  timeMul: number;
  /** buff の持続倍率 */
  durationMul: number;
  /** 負担（docs/COMBAT_DESIGN.md B-5）。マナ型ならコスト、CD 型なら CD に掛かる倍率（旧 cooldownMul） */
  burdenMul: number;
  charges: number;
  /** 回数 / 弾数の加算 */
  countBonus: number;
  echo: { delay: number; damageMul: number } | null;
  /** 分身: 撃った時の自分の位置から、この秒数後に同じスキルをもう一度（反響と同じ写しの仕組み） */
  ghost: { delay: number; damageMul: number } | null;
  /** 貫通数（弾・鎖が追加で抜ける敵の数） */
  pierce: number;
  /** 遅延: この秒数後に発動地点で発動する */
  delay: { time: number; damageMul: number } | null;
  /** 発動したスロット。resolveCast の時点では -1 */
  slot: number;
  /** 最低間隔の倍率 */
  intervalMul: number;
  /** どのスキルの発動か（怯み値・付与の状態異常を引くため。反響・遅延でも同じ値が残る） */
  skillKey: SkillKey;
  /** この発動で実際に払ったマナ（巡りの返却の基準）。resolveCast の時点では 0 */
  manaPaid: number;
  /**
   * この発動で払い戻せるマナの残り（上限 = manaPaid）。反響・遅延・設置物の写しと同じ参照を共有し、
   * 払った以上に戻らないようにする。castSlot が発動ごとに新しく作る
   */
  refundPool: { left: number };
  /** 実際に使う資源（def.resource の写し） */
  resource: SkillResource;
  /** 負担の基準値。マナ型ならコスト、CD 型なら CD */
  baseCost: number;
  baseCooldown: number;
  /** 怯み値の倍率 */
  poiseMul: number;
  /** ノックバックの倍率。負なら発動地点へ引く（手繰り） */
  knockbackMul: number;
  /** 付与する状態異常の持続倍率 */
  statusDurationMul: number;
  /** 巡り: 命中 1 回ごとに払ったコストのこの割合を返す（0 なら無し） */
  refundPerHit: number;
  /** 巡りの上限（払ったコストのうち返せる残り）。発動ごとに castSlot が作る */
  hitRefundPool: { left: number };
  /** 血の代償: 気力が足りなくても撃て、不足分を生命で払う */
  bloodPrice: boolean;
  /** 状態で変わる刻印符（溢れ撃ち / 刻み撃ち / 過熱 / 蓄え / 呼応 / 背水 / 捧げ / 帳）。発動時に system/skills.ts が読む */
  spillover: boolean;
  streak: boolean;
  overheat: boolean;
  patience: boolean;
  sympathy: boolean;
  desperate: boolean;
  offering: boolean;
  ledger: boolean;
  /** 型替え符 */
  reshape: ReshapeKey | null;
  /** 成立した連携（反響・遅延の写しにも残る） */
  combo: ComboKey | null;
  /** 発動した位置。resolveCast の時点では原点 */
  origin: Vec;
  /** この発動で命中した敵 id（連携の「直前の発動」が読む）。castSlot が発動ごとに作る */
  hitLog: Set<number>;
  /** 属性の差し替え（杖の型・移ろい刃）。null なら SKILL_ATTACK のまま */
  element: Element | null;
  /** 地形化: 命中した位置に属性の地形を置く。残り回数は発動 1 回ぶんで共有 */
  leyline: boolean;
  leyPool: { left: number };
  /** 連鎖: 命中点から次の敵へ跳ぶ。残り回数は発動 1 回ぶんで共有 */
  chain: boolean;
  chainPool: { left: number };
  /** 爆ぜ: 命中点で小爆発。残り回数は発動 1 回ぶんで共有 */
  burst: boolean;
  burstPool: { left: number };
  /** 技の行為の列を作り替える刻印符（付けた順。ModifierDef.transform を持つ符）。skills/arts/engine.ts が型の変形の後に当てる */
  artTransforms: readonly ModifierKey[];
  /** 技の弾の動き（旋回 / 戻り刃）。null なら真っ直ぐ */
  shotPath: ShotPath | null;
  /** 軌跡: 技の踏み込み・跳躍の通り道に攻撃の属性の地形 */
  trail: boolean;
}

/** 刻印符の表示上の区分 */
export type ModifierFamily = "shape" | "cycle";

/** 連動の起点。finisher = 武器の終撃 / riposte = 応手 */
export type AutoCastTrigger = "finisher" | "riposte";

export interface ModifierDef {
  key: ModifierKey;
  name: string;
  verb: string;
  /** HUD のドット色 */
  color: string;
  /** このタグを 1 つでも持つスキルには付けられない */
  excludesTags: readonly SkillTag[];
  /** 指定があれば、このタグを 1 つ以上持つスキルにだけ付けられる */
  requiresTags?: readonly SkillTag[];
  /** 個別に付けられないスキル（効果が既に内蔵されているもの） */
  excludesSkills?: readonly SkillKey[];
  /** マナ型スキルでの効果の説明。無ければ verb と同じ（docs/COMBAT_DESIGN.md B-5 で読み替えるものだけ持つ） */
  manaVerb?: string;
  /** 指定があれば、この資源のスキルにだけ付けられる */
  requiresResource?: SkillResource;
  /** 同じスロットで同時に効かない刻印符（古い方が効き、後から刺した方は無効） */
  excludesModifiers?: readonly ModifierKey[];
  /** true なら与ダメを持つスキル（damageKind が none でない）にだけ付けられる */
  requiresDamage?: boolean;
  /** 使うリンクの本数（既定 1。型替え符は 2） */
  linkCost?: number;
  /** 型替え符か（起点・発動の型を差し替える。1 スロットに 1 枚まで） */
  reshape?: boolean;
  /** 表示用の区分（変形 = shape / 循環 = cycle）。効き方は変えない（docs/ideas/skills-7c-plan.md 4-1） */
  family?: ModifierFamily;
  /** 技の行為の列を作り替える純関数。transform か fitsArt を持つ符は技（ArtSkillKey）にだけ付く（型替え符は手書きにも付き、手書きには apply だけが効く） */
  transform?: ArtActsTransform;
  /** 技に付けられるか（行為の列で判定する。弾が無い技に旋回を付けない など）。省略は transform を当てて列が変わるか */
  fitsArt?: (acts: readonly ArtAct[]) => boolean;
  /** 指定があれば、その出来事（武器の終撃 / 応手）と同時にこのスキルを撃つ */
  autoCast?: AutoCastTrigger;
  /** def はマナ型 / CD 型で効果を読み替えるために渡す */
  apply(p: Readonly<CastParams>, def: Readonly<SkillDef>): CastParams;
  /** 統一ルール（src/core/rules.ts）。scope が any なら刺したスロットの発動が起こしたイベントだけを食う */
  rules?: readonly Rule[];
  /** 共通語彙（docs/ideas/synergy-web.md 1 章） */
  keywords: KeywordProfile;
}

// ---- 永続（スキル石） ----

export interface VariantRoll {
  axis: VariantAxis;
  /** -1..1。正で前者（範囲・CD 短縮・速度・回数・持続）を伸ばし、威力 / 効果量を削る */
  value: number;
}

export interface SkillStone {
  id: string;
  seed: number;
  skillKey: SkillKey;
  variants: VariantRoll[];
  /**
   * 読まない（リンクはスロットごとに固定の SKILL.slotLinks）。旧セーブ・リプレイ・テストの石の形を保つためだけに残し、生成は 0
   */
  links: number;
  foundDepth: number;
  /** epoch ms */
  foundAt: number;
  /** 使い込み（docs/ideas/skills-expansion.md 5 章）。旧セーブ・未使用の石には無いので省略可 */
  wear?: StoneWear;
}

/** 使い込みの芽。威力・効果量 +（skills/tuning2.ts の WEAR_TUNING）。旧セーブの「枠」の芽は読み込み時にこれへ写す */
export type WearBud = "power";

export interface StoneWear {
  /** 手動で撃った回数 */
  casts: number;
  /** この石のスキルが敵に当たった回数（反響・遅延・設置物の命中も含む） */
  hits: number;
  /** 出た芽（古い順）。節目の数まで */
  buds: WearBud[];
}

/** 永続するのは石と装着だけ。刻印符はラン内（SkillSlotState.runModifiers）で、セーブには持たない */
export interface SkillProfile {
  version: 1;
  /** スキルスロット i に装着した石の id */
  loadout: (string | null)[];
  stones: SkillStone[];
}

// ---- ラン内 ----

export interface SkillSlotState {
  /**
   * 実際に読む刻印符の並び（古い順）= runModifiers + 祝福が足す符。
   * system/skills.ts の syncSlotModifiers が作り直す（直接書き換えない）
   */
  modifiers: ModifierKey[];
  /**
   * ラン内だけの刻印符（拾った符・起点「詠み手」・図書館など。セーブしない）。石ではなくスロットに属する（古い順）。
   * 付け外しは system/skills.ts の attachRune / moveRunModifier / removeRunModifier
   */
  runModifiers: ModifierKey[];
  cooldownLeft: number;
  /** HUD のマスク用: 直近にセットした CD の長さ */
  cooldownTotal: number;
  chargesLeft: number;
  /** Charge 刻印符: 現在溜め中か */
  charging: boolean;
  /** Charge 刻印符: 溜め始めてからの経過秒（溜めていなければ 0） */
  chargeTime: number;
  /** 最低間隔の残り秒（docs/COMBAT_DESIGN.md B-2） */
  intervalLeft: number;
  /** 過熱: 続けて撃った回数と、途切れるまでの残り秒 */
  heat: number;
  heatTimer: number;
  /** 最後に撃った SkillRunState.clock（蓄え・呼応）。まだ撃っていなければ省略 */
  lastCastAt?: number;
  /** 刻み撃ち: このスロットを続けて撃った回数（他のスロットを撃つと 0） */
  streak?: number;
  /** 帳: 撃った数（every 発ごとに無料で撃って 0 に戻る） */
  ledger?: number;
  /** 移ろい刃: 次に撃つ属性の番号（撃つたびに進む） */
  elementStep: number;
}

export type ActiveSkillKey =
  | "parry"
  | "chainHook"
  // ---- 大拡張（skills/actions.ts が更新する） ----
  | "comboChain";

/** 発動中のスキル（同時に 1 つ） */
export interface ActiveCast {
  slot: number;
  skillKey: ActiveSkillKey;
  /** main: 本動作 / recover: 終わりの隙 */
  phase: "main" | "recover";
  timer: number;
  total: number;
  params: CastParams;
  dir: Vec;
  origin: Vec;
  hitIds: Set<number>;
  /** 鎖鎌の引き寄せ数 / 連環撃の突いた段数 */
  hitsDone: number;
  /** 鎖鎌: 鎖の先端の距離 */
  reach: number;
}

/** 反響の予約。timer が尽きたら同じ地点・向きで再発動 */
export interface EchoCast {
  timer: number;
  /**
   * echo: 反響・分身の再発動 / delay: 遅延の本発動（予兆の円を出す）/
   * thrown: 型替え符「照準起点」の近接の着弾（origin が着弾点）
   */
  kind: "echo" | "delay" | "thrown";
  total: number;
  skillKey: SkillKey;
  origin: Vec;
  dir: Vec;
  target: Vec;
  params: CastParams;
}

/** 引力球 */
export interface GravityWell {
  pos: Vec;
  timer: number;
  total: number;
  tick: number;
  params: CastParams;
}

/** 地雷。arm が 0 になると踏まれて爆発する */
export interface Mine {
  id: number;
  pos: Vec;
  arm: number;
  life: number;
  params: CastParams;
}

/** 泥沼の領域（skills/placed.ts）。床の泥は system/terrain.ts が持ち、ここは中の敵に怯み値を入れる周期だけを持つ */
export interface MireZone {
  pos: Vec;
  timer: number;
  tick: number;
  params: CastParams;
  /** 置いたフロアのマップ（階を移ったら捨てる。SkillRunState の作り直しを待たずに済む） */
  map: GameMap;
}

/** 氷結地帯 */
export interface FrostField {
  pos: Vec;
  timer: number;
  total: number;
  tick: number;
  params: CastParams;
}

/** 大拡張の射撃弾（skills/shots.ts）。種類ごとの命中効果は effect で分ける */
export type ShotEffect = "plain" | "unravel" | "harvest" | "rout" | "strip" | "ricochet" | "turret";

export interface SkillShot {
  id: number;
  effect: ShotEffect;
  pos: Vec;
  vel: Vec;
  life: number;
  radius: number;
  /** 命中 1 回の基礎威力（skillPower 済み） */
  power: number;
  knockback: number;
  color: string;
  params: CastParams;
  hitIds: Set<number>;
  pierceLeft: number;
  /** 跳弾: 残りの跳ね返り回数 */
  bouncesLeft: number;
  /** 付与の上書き（技の弾の付与）。undefined なら SkillDef.applies */
  applies?: readonly StatusApply[] | null;
}

/** 爆薬樽（skills/summons.ts） */
export interface PowderKeg {
  id: number;
  pos: Vec;
  /** 叩かれて転がっているときの速度（0 なら静止） */
  vel: Vec;
  rollLeft: number;
  life: number;
  params: CastParams;
}

/** 剣の墓標 */
export interface GraveSword {
  id: number;
  pos: Vec;
  life: number;
  /** 回転斬りの表示用の残り秒 */
  spin: number;
  params: CastParams;
}

/** 砲台 */
export interface Turret {
  id: number;
  pos: Vec;
  life: number;
  total: number;
  params: CastParams;
}

/** 湧き石 */
export interface ManaSpring {
  pos: Vec;
  timer: number;
  total: number;
  params: CastParams;
}

/**
 * 第 3 弾の変身中（skills/forms.ts）。武器種は差し替えず、左右クリックの動作を forms.ts が差し替える。
 * total が 0 の変身（砲身化・業火の化身）は時間では切れない（ダッシュ・気力切れ・もう一度撃つと解ける）
 */
export interface ShapeFormState {
  key: Wave3SkillKey;
  slot: number;
  /** 変身してからの秒 */
  elapsed: number;
  /** 持続の秒（0 なら時間で切れない） */
  total: number;
  /** 解けた後の反動の秒 */
  recover: number;
  /** 発動時の最終パラメータ（噛みつき・砲撃・出血の強さはここから読む） */
  params: CastParams;
  /** 変身中だけの動作（遠吠え・砲撃）の再使用の残り秒 */
  actionLeft: number;
  /** 霊体化: すり抜けた敵 id */
  passed: Set<number>;
  /** 狼化・鉄塊化: 差し替えた近接の型（発動時の威力・怯み値の倍率を畳んである）。無ければ装備の武器種のまま */
  moveset: MovesetDef | null;
}

/** 結界杭 */
export interface WardStake {
  id: number;
  pos: Vec;
  life: number;
  total: number;
  params: CastParams;
}

/** 型替え符「据え置き」の罠。敵が近づくと元のスキルが罠の位置から発動する */
export interface SkillTrap {
  id: number;
  pos: Vec;
  arm: number;
  life: number;
  skillKey: SkillKey;
  params: CastParams;
}

/** 位置と HP の履歴（巻き戻し用）。一定間隔で記録する */
export interface SkillHistoryEntry {
  at: number;
  pos: Vec;
  hp: number;
}

/** 連携の「直前の発動」 */
export interface LastCast {
  skillKey: SkillKey;
  slot: number;
  /** SkillRunState.clock */
  at: number;
  /** 発動の照準地点 */
  pos: Vec;
  /** 命中した敵 id（発動中にも増える） */
  hitIds: Set<number>;
}

/** 連動の予約（終撃・応手の瞬間に積み、次の updateSkills が撃つ）。target は起点の敵の位置 */
export interface AutoCastRequest {
  slot: number;
  trigger: AutoCastTrigger;
  target: Vec;
}

/** 旋回・戻り刃の弾の操り（skills/arts/engine.ts）。弾本体は SkillRunState.shots にあり、id で引く */
export interface ShotSteer {
  shotId: number;
  path: ShotPath;
  /** 旋回: 自分から見た弾の角度（ラジアン） */
  angle: number;
  /** 旋回: 同じ敵にもう一度当たれるまでの残り秒 / 戻り刃: 折り返すまでの残り秒 */
  timer: number;
  /** 戻り刃: 折り返して自分へ戻っているか */
  returning: boolean;
}

export interface RuneTablet {
  id: number;
  modifier: ModifierKey;
  pos: Vec;
  bobTime: number;
  /** 付けられる枠が無いことを一度表示したか */
  warned: boolean;
}

export interface FloorStone {
  id: number;
  stone: SkillStone;
  pos: Vec;
  bobTime: number;
  /** stash 満杯を一度表示したか */
  warned: boolean;
}

export interface SkillRunState {
  /** 永続。main.ts がラン間で同じオブジェクトを渡す */
  profile: SkillProfile;
  slots: SkillSlotState[];
  active: ActiveCast | null;
  /** ダッシュ中・近接中に押されたスロットの先行入力（-1 で無し） */
  pendingSlot: number;
  pendingTimer: number;
  echoes: EchoCast[];
  wells: GravityWell[];
  mines: Mine[];
  fields: FrostField[];
  /** 泥沼の領域。後から足した設置物なので省略可（最初に置いたときに作る。system/skills.ts の初期化に手を入れない） */
  mires?: MireZone[];
  runes: RuneTablet[];
  floorStones: FloorStone[];
  frenzy: TimedMul;
  lifesteal: TimedMul;
  /** 加速: 移動倍率と残り秒。効果中はダッシュの CD が 0 */
  haste: TimedMul;
  /** 加速の反動: この間ダッシュ不可 */
  exhaustTimer: number;
  parryTimer: number;
  parryFailTimer: number;
  notReadyTimer: number;
  /** 吸収用: 前回計測時の敵 HP */
  enemyHp: Map<number, number>;
  /** 部屋クリア・階層到達の検出用。depth が null なら未同期 */
  tracking: { depth: number | null; cleared: boolean[] };
  /** HUD: マナ不足の点滅の残り秒 */
  manaFlash: number;
  // ---- 大拡張 ----
  /** スキル側の経過秒（updateSkills が dt で進める）。連携・恨み返し・巻き戻し・蓄え・呼応の時刻はこれで測る */
  clock: number;
  shots: SkillShot[];
  kegs: PowderKeg[];
  graves: GraveSword[];
  turrets: Turret[];
  springs: ManaSpring[];
  /** 連携: 直前の手動発動（パリィは成功した瞬間） */
  lastCast: LastCast | null;
  /** 直近の発動のスロット（新しい順、最大 2。刻み撃ち・呼応が読む） */
  recentSlots: number[];
  /** 巻き戻し用の履歴（古い順） */
  history: SkillHistoryEntry[];
  historyTimer: number;
  /** 恨み返し: 直近の被ダメ（古い順） */
  hurtLog: { at: number; amount: number }[];
  /** 被ダメ検出用: 前フレームの終わりの HP（null なら未同期） */
  lastHp: number | null;
  /** 変身が解けた後の反動（移動が遅い）の残り秒 */
  formRecover: number;
  // ---- 第 3 弾（skills/forms.ts） ----
  /** 左右クリックを差し替える変身中（無ければ null） */
  shape: ShapeFormState | null;
  /** 変身 5 種の共有の待ちの残り秒（0 より大きい間はどの変身も撃てない）と、HUD 用の長さ */
  formWait: number;
  formWaitTotal: number;
  /** いまの変身（shape）が始まった clock。変身していなければ null */
  formSince: number | null;
  stakes: WardStake[];
  stakeTick: number;
  traps: SkillTrap[];
  /** 技の遅れて出る行為（skills/arts/engine.ts）。後から足したので省略可（最初に積んだときに作る） */
  artQueue?: ArtPending[];
  /** 旋回・戻り刃の弾の操り（skills/arts/engine.ts）。省略可 */
  steers?: ShotSteer[];
  /** 連動（終撃連動・応手連動）の予約と、起点ごとに最後に積んだ clock（1 回の終撃で 1 回だけ撃つため）。省略可 */
  autoCasts?: AutoCastRequest[];
  autoCastAt?: Partial<Record<AutoCastTrigger, number>>;
  // ---- 段取り 5d: 書・鈴の型（system/tomeBell.ts）。後から足したので省略可 ----
  /** 書の無詠唱: 次の気力のスキル 1 回の気力が 0 */
  freeCast?: boolean;
  /** 鈴の打ち鳴らし: 設置物・従魔の命中の威力の倍率と残り秒 */
  bellBuff?: TimedMul;
}
