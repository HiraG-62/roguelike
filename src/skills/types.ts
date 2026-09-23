import type { KeywordProfile } from "../core/keywords";
import type { Rule } from "../core/rules";
import type { TimedMul } from "../core/state";
import type { StatusApply } from "../core/status";
import type { Vec } from "../core/vec";

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
] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

/** 最小実装の 6 + 追加の 8 */
export const BASE_SKILL_KEYS = [
  "whirl",
  "lunge",
  "frag",
  "railshot",
  "parry",
  "bloodPact",
  "quake",
  "thunder",
  "gravityWell",
  "mines",
  "haste",
  "chainHook",
  "spiral",
  "frostField",
] as const;

/** 大拡張（docs/ideas/skills-expansion.md 1 章）。実装は skills/actions.ts / shots.ts / summons.ts */
export const EXTRA_SKILL_KEYS = [
  "contagion",
  "unravel",
  "kindle",
  "prismShard",
  "fullMoon",
  "dregsBlade",
  "shadowStep",
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
  "guillotine",
  "ricochet",
  "galeSlash",
  "scatterSigil",
  "stomp",
  "threadReel",
  "meteorDive",
  "swallowFlip",
  "boneRing",
  "backflow",
  "scarRoar",
  "manaSpring",
  "turret",
] as const;
export type ExtraSkillKey = (typeof EXTRA_SKILL_KEYS)[number];

/** 追加はここへ（BASE / EXTRA のどちらかに足す） */
export const SKILL_KEYS = [...BASE_SKILL_KEYS, ...EXTRA_SKILL_KEYS] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/** 最小実装の 4 + 追加の 7 */
export const BASE_MODIFIER_KEYS = [
  "multiCharge",
  "bloodPrice",
  "comboFuel",
  "echo",
  "pierce",
  "recoil",
  "chainReset",
  "curse",
  "delay",
  "expand",
  "charge",
] as const;

/** 大拡張の刻印符（docs/ideas/skills-expansion.md 2 章）と型替え符（3 章）。定義は skills/modifiers.ts */
export const EXTRA_MODIFIER_KEYS = [
  "deferred",
  "refund",
  "bloodTithe",
  "spillover",
  "dryFire",
  "bladeFeed",
  "timeLock",
  "fuelize",
  "overheat",
  "heavy",
  "feather",
  "repel",
  "tether",
  "linger",
  "spread",
  "followUp",
  "lastGasp",
  "sustain",
  "landing",
  "desperate",
  "attune",
  "cycle",
  "flank",
  "pointBlank",
  "longshot",
  // ---- 型替え符（リンク 2 本・1 スロットに 1 枚まで） ----
  "toThrown",
  "toLobbed",
  "toStaged",
] as const;
export type ExtraModifierKey = (typeof EXTRA_MODIFIER_KEYS)[number];

export const MODIFIER_KEYS = [...BASE_MODIFIER_KEYS, ...EXTRA_MODIFIER_KEYS] as const;
export type ModifierKey = (typeof MODIFIER_KEYS)[number];

/** 型替え符の種類。castSlot の入口で発動の「型」を差し替える */
export type ReshapeKey = "toThrown" | "toLobbed" | "toStaged";

/** 距離で威力が変わる刻印符（至近 / 遠当て） */
export type RangeBias = "pointBlank" | "longshot";

/** 連携（docs/ideas/skills-expansion.md 4 章）。定義は skills/combos.ts */
export type ComboKey =
  | "wellThunder"
  | "hookWhirl"
  | "parryRail"
  | "diveQuake"
  | "contagionUnravel"
  | "pactWhirl"
  | "frostBreaker"
  | "shadowExploit"
  | "hasteSpiral"
  | "reelStomp";

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
  /** 1 ヒットの基礎怯み値（最終値は × poiseDamageMul） */
  poise: number;
  /** 命中した敵に付ける状態異常 */
  applies?: readonly StatusApply[];
  /**
   * マナの特殊な払い方。full = 満タンのときだけ撃て全量を払う（満月の砲）、
   * low = 最大の一定割合未満のときだけ撃てコスト 0（枯渇の刃）
   */
  manaRule?: "full" | "low";
  /** 連携: このスキルが「後」になる組み合わせ（skills/combos.ts の COMBOS の key） */
  combos?: readonly ComboKey[];
  /** 統一ルール（src/core/rules.ts）。scope が any ならこの石のスロットの発動が起こしたイベントだけを食う */
  rules?: readonly Rule[];
  /** 共通語彙（docs/ideas/synergy-web.md 1 章）。命中で付ける状態異常とマナ消費は system/keywords.ts が足す */
  keywords: KeywordProfile;
  /**
   * 同時発動の排他グループ（docs/COMBAT_DESIGN.md B-9）。body = 体を使う本動作（近接・移動・照準）。
   * body 同士は同時に発動できない（発動中の本動作 SkillRunState.active は 1 つだけなので）。
   * 省略したスキル（設置・射撃・強化）は本動作の最中でも並行して撃てる
   */
  exclusiveGroup?: SkillExclusiveGroup;
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
  /** 発動時に払う最大 HP 割合（0 なら無し） */
  hpCostFraction: number;
  comboFuel: { perStack: number; cap: number; emptyMul: number } | null;
  echo: { delay: number; damageMul: number } | null;
  /** 貫通数（弾・鎖が追加で抜ける敵の数） */
  pierce: number;
  /** 反動: 発動時に照準の逆へ跳ぶ速度（0 なら無し） */
  recoil: number;
  /** 連鎖: このスキルで敵を倒すとチャージ +1 */
  killRefund: boolean;
  /** 呪い: ヒットした敵に刻印。刻印中の敵へのスキル被ダメ倍率 */
  curse: { duration: number; bonus: number } | null;
  /** 遅延: この秒数後に発動地点で発動する */
  delay: { time: number; damageMul: number } | null;
  /** 発動したスロット（連鎖の返却先）。resolveCast の時点では -1 */
  slot: number;
  /** マナ型の最低間隔倍率（多重） */
  intervalMul: number;
  /** 連鎖（マナ型）: 撃破でコストのこの割合を返す。0 なら無し */
  killManaRefund: number;
  /** どのスキルの発動か（怯み値・付与の状態異常を引くため。反響・遅延でも同じ値が残る） */
  skillKey: SkillKey;
  /** この発動で実際に払ったマナ（連鎖の返却・撃ち抜きのキャンセル返却の基準）。resolveCast の時点では 0 */
  manaPaid: number;
  /**
   * この発動で払い戻せるマナの残り（上限 = manaPaid）。反響・遅延・設置物の写しと同じ参照を共有し、
   * 複数撃破や反響の撃破で払った以上に戻らないようにする。castSlot が発動ごとに新しく作る
   */
  refundPool: { left: number };
  // ---- 大拡張（docs/ideas/skills-expansion.md 2〜4 章） ----
  /** 実際に使う資源。定刻（mana → cooldown）・燃料化（cooldown → mana）で def.resource と変わる */
  resource: SkillResource;
  /** 負担の基準値。マナ型ならコスト、CD 型なら CD（定刻・燃料化で差し替わる） */
  baseCost: number;
  baseCooldown: number;
  /** 怯み値の倍率（重撃 / 軽打） */
  poiseMul: number;
  /** ノックバックの倍率。負なら発動地点へ引く（手繰り） */
  knockbackMul: number;
  /** 突き放し: 怯んでいない敵への押し出しの軽減を打ち消し、壁叩きつけを狙える */
  repel: boolean;
  /** 付与する状態異常の持続倍率（延命） */
  statusDurationMul: number;
  /** 伝播: 付与した状態異常が近くの 1 体にも付く */
  spread: boolean;
  /** 返金: 命中 1 回ごとに払ったコストのこの割合を返す（0 なら無し） */
  refundPerHit: number;
  /** 返金の上限（払ったコストのうち返せる残り）。発動ごとに castSlot が作る */
  hitRefundPool: { left: number };
  /** 追撃: 命中した敵に印。印中の近接で追加ヒット */
  followUp: boolean;
  /** 散り際: このスキルで倒した敵の位置で、この倍率の同じスキルが起きる（null なら無し） */
  lastGasp: number | null;
  /** 着地衝撃: 移動スキルの終点で小さな衝撃波 */
  landing: boolean;
  /** 背面: 敵の背後から当てると強い（正面は弱い） */
  flank: boolean;
  /** 至近 / 遠当て */
  rangeBias: RangeBias | null;
  /** 同調: 金の支配共鳴のとき会心の一撃だけ伸びる */
  attuneCrit: boolean;
  /** 後払い: 発動時は払わず、少し後にコスト × この倍率を払う（0 なら無し） */
  deferredMul: number;
  /** 血の肩代わり: マナ不足でも撃て、不足分を HP で払う */
  bloodTithe: boolean;
  /** 状態で変わる刻印符（溢れ / 渇き撃ち / 刃の給油 / 過熱 / 背水 / 同調 / 巡り）。発動時に system/skills.ts が読む */
  spillover: boolean;
  dryFire: boolean;
  bladeFeed: boolean;
  overheat: boolean;
  desperate: boolean;
  attune: boolean;
  cycle: boolean;
  /** 型替え符 */
  reshape: ReshapeKey | null;
  /** 成立した連携（反響・遅延の写しにも残る） */
  combo: ComboKey | null;
  /** 発動した位置（至近 / 遠当ての距離の基準）。resolveCast の時点では原点 */
  origin: Vec;
  /** この発動で命中した敵 id（連携の「直前の発動」が読む）。castSlot が発動ごとに作る */
  hitLog: Set<number>;
  /** 散り際の残り回数（発動 1 回ぶんで共有） */
  gaspPool: { left: number };
}

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
  /** true なら SkillDef.applies を持つスキルにだけ付けられる */
  requiresApplies?: boolean;
  /** 同じスロットで同時に効かない刻印符（古い方が効き、後から刺した方は無効） */
  excludesModifiers?: readonly ModifierKey[];
  /** 使うリンクの本数（既定 1。型替え符は 2） */
  linkCost?: number;
  /** 型替え符か（1 スロットに 1 枚まで） */
  reshape?: ReshapeKey;
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
  /** 刻印符を差せる数。多いほど負担（マナ型はコスト、CD 型は CD）が重い */
  links: number;
  foundDepth: number;
  /** epoch ms */
  foundAt: number;
  /**
   * この石に付けた刻印符（古い順）。石と一緒に動くのでスロットを入れ替えても付いたまま。
   * 旧セーブ・リプレイの石には無いので省略可（無ければ空）
   */
  runes?: RuneItem[];
}

/** 所持品としての刻印符（1 枚）。拾うと SkillProfile.runes に入り、装備画面で石に付け外しする */
export interface RuneItem {
  id: string;
  modifier: ModifierKey;
  /** epoch ms（表示と並び順だけ。決定性に影響しない） */
  foundAt: number;
}

export interface SkillProfile {
  version: 1;
  /** スキルスロット i に装着した石の id */
  loadout: (string | null)[];
  stones: SkillStone[];
  /** 石に付けていない所持刻印符。旧セーブ・リプレイには無いので省略可（skills/persistence.ts の ownedRunes で読む） */
  runes?: RuneItem[];
}

// ---- ラン内 ----

export interface SkillSlotState {
  /**
   * 実際に読む刻印符の並び（古い順）= スロットの石に付けた所持刻印符 + runModifiers。
   * system/skills.ts の syncSlotModifiers が作り直す（直接書き換えない）
   */
  modifiers: ModifierKey[];
  /** ラン内だけの刻印符（起点「詠み手」の開始時など）。石ではなくスロットに属する（古い順） */
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
}

export type ActiveSkillKey =
  | "whirl"
  | "lunge"
  | "railshot"
  | "parry"
  | "quake"
  | "chainHook"
  | "spiral"
  // ---- 大拡張（skills/actions.ts が更新する） ----
  | "dregsBlade"
  | "comboChain"
  | "guillotine"
  | "stomp"
  | "threadReel"
  | "meteorDive"
  | "swallowFlip";

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
  /** 旋風斬りの経過ヒット数 / 回転弾幕の発射数 / 鎖鎌の引き寄せ数 */
  hitsDone: number;
  /** 地裂き: 溜め開始時の HP（被弾で中断） */
  startHp: number;
  /** 鎖鎌: 鎖の先端の距離 */
  reach: number;
  /** 照準地点（墜星の落下点・手繰り糸の先端・燕返しの着地点） */
  target: Vec;
}

export interface Grenade {
  id: number;
  from: Vec;
  to: Vec;
  flight: number;
  flightTotal: number;
  fuse: number;
  fuseTotal: number;
  params: CastParams;
}

/** 反響の予約。timer が尽きたら同じ地点・向きで再発動 */
export interface EchoCast {
  timer: number;
  /**
   * echo: 反響の再発動 / delay: 遅延の本発動（予兆の円を出す）/
   * thrown: 型替え符「投げ刃」の着弾（origin が着弾点）/ gasp: 刻印符「散り際」
   */
  kind: "echo" | "delay" | "thrown" | "gasp";
  total: number;
  skillKey: SkillKey;
  origin: Vec;
  dir: Vec;
  target: Vec;
  params: CastParams;
}

/** 反響の残像（旋風斬り・突進斬り・回転弾幕）。プレイヤーは動かない */
export interface Ghost {
  skillKey: "whirl" | "lunge" | "spiral";
  timer: number;
  total: number;
  pos: Vec;
  dir: Vec;
  params: CastParams;
  hitIds: Set<number>;
  hitsDone: number;
}

/** 雷撃の落雷予約。timer が尽きたら落ちる */
export interface ThunderStrike {
  pos: Vec;
  timer: number;
  total: number;
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

/** 氷結地帯 */
export interface FrostField {
  pos: Vec;
  timer: number;
  total: number;
  tick: number;
  params: CastParams;
}

/** 回転弾幕の弾（projectiles.ts を通さず、ここで当たり判定する） */
export interface SkillBullet {
  pos: Vec;
  vel: Vec;
  life: number;
  params: CastParams;
  hitIds: Set<number>;
  pierceLeft: number;
}

/** 大拡張の射撃弾（skills/shots.ts）。種類ごとの命中効果は effect で分ける */
export type ShotEffect =
  | "plain"
  | "unravel"
  | "harvest"
  | "rout"
  | "strip"
  | "ricochet"
  | "gale"
  | "scatter"
  | "prism"
  | "turret";

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
  /** 跳弾: 残りの跳ね返り回数と、跳ねた回数（威力が伸びる） */
  bouncesLeft: number;
  bounced: number;
  /** 付与の上書き（五彩の礫の色）。undefined なら SkillDef.applies */
  applies?: readonly StatusApply[] | null;
  /** 五彩の礫（翠）: 命中で回復する量 */
  heal: number;
  /** 散弾符: 同じ斉射の命中数（敵 id → 数） */
  volley?: Map<number, number>;
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

/** 骨片の輪（自分の周りを回り、敵弾を 1 発ずつ止める） */
export interface BoneRing {
  bones: number;
  timer: number;
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

/** 散り際の予約（skills/hit.ts が積み、system/skills.ts が発動する） */
export interface GaspRequest {
  pos: Vec;
  dir: Vec;
  params: CastParams;
}

/** 後払いの返済予約 */
export interface SkillDebt {
  slot: number;
  timer: number;
  amount: number;
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
  grenades: Grenade[];
  echoes: EchoCast[];
  ghosts: Ghost[];
  strikes: ThunderStrike[];
  wells: GravityWell[];
  mines: Mine[];
  fields: FrostField[];
  bullets: SkillBullet[];
  runes: RuneTablet[];
  floorStones: FloorStone[];
  frenzy: TimedMul;
  lifesteal: TimedMul;
  /** 加速: 移動倍率と残り秒。効果中はダッシュの CD が 0 */
  haste: TimedMul;
  /** 加速の反動: この間ダッシュ不可 */
  exhaustTimer: number;
  /** 呪い: 敵 id → 残り秒と倍率 */
  curses: Map<number, { time: number; bonus: number }>;
  parryTimer: number;
  parryFailTimer: number;
  /** 突進斬りの壁激突による行動不能 */
  stunTimer: number;
  /** 突進斬り後、この間の近接は 2 段目から */
  lungeComboTimer: number;
  notReadyTimer: number;
  /** 吸収用: 前回計測時の敵 HP */
  enemyHp: Map<number, number>;
  /** 部屋クリア・階層到達の検出用。depth が null なら未同期 */
  tracking: { depth: number | null; cleared: boolean[] };
  /** HUD: マナ不足の点滅の残り秒 */
  manaFlash: number;
  // ---- 大拡張 ----
  /** スキル側の経過秒（updateSkills が dt で進める）。連携・刃の給油・恨み返し・巻き戻しの時刻はこれで測る */
  clock: number;
  shots: SkillShot[];
  kegs: PowderKeg[];
  graves: GraveSword[];
  turrets: Turret[];
  boneRing: BoneRing | null;
  springs: ManaSpring[];
  /** 連携: 直前の手動発動（パリィは成功した瞬間） */
  lastCast: LastCast | null;
  /** 巡り: 直近の手動発動のスロット（新しい順、最大 2） */
  recentSlots: number[];
  /** 刃の給油: 最後に近接を当てた clock（まだなら null） */
  lastMeleeHitAt: number | null;
  /** 影渡り: この間の近接 1 回が背面ヒット（怯み値の上乗せ） */
  backstabTimer: number;
  /** 追撃の印: 敵 id → 残り秒と追加ヒットの威力 */
  marks: Map<number, { time: number; power: number }>;
  gasps: GaspRequest[];
  /** 後払いの返済予約 */
  debts: SkillDebt[];
  /**
   * 後払いの返済残（マナ量）。返済期限に HP が 1 まで削れても払いきれなかった分。
   * 0 でない間はマナの自然回復と通常攻撃のマナ回収が止まり、ほかのマナ回収（撃破など）は先にここへ充てる（system/mana.ts）
   */
  debtOwed: number;
  /** 巻き戻し用の履歴（古い順） */
  history: SkillHistoryEntry[];
  historyTimer: number;
  /** 恨み返し: 直近の被ダメ（古い順） */
  hurtLog: { at: number; amount: number }[];
  /** 被ダメ検出用: 前フレームの終わりの HP（null なら未同期） */
  lastHp: number | null;
}
