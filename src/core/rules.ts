import type { DamageTag } from "./damage";
import type { Element } from "./element";
import type { EventActor, EventKind, EventSource } from "./events";
import type { FloorKind, RoomKind, VaultKind } from "./state";
import type { StatusKind } from "./status";
import type { TerrainKind } from "./terrain";
import type { JobKey } from "../data/jobs";
import type { BulletFeature, ButtonKey, MovesetKey } from "../data/weapons";
import type { FormKey } from "../data/weaponForms";
import type { TriggerCondition, TriggerEffectKind } from "../loot/types";
import type { SkillKey } from "../skills/types";
import type { LineageKey } from "../system/boonDefs";
import { SYNERGY } from "../data/tuning";

/**
 * 統一ルール文法（docs/ideas/synergy-web.md 3-1）。
 * Rule = いつ（when）× もし（if）× 何を（then）。装備の tr: は loot/triggers.ts の ruleFromTrigger でこの形に読み替える。
 * 祝福・スキル石・刻印符・敵は持ち主の定義に rules を置き、src/system/rules.ts の resolveRules が照合する。
 * ここは型と純関数だけ（ロジックは system 側）
 */

export type RuleCondition =
  /** 装備トリガーの条件（loot/types.ts の TriggerCondition）をそのまま使う */
  | { kind: "trigger"; condition: TriggerCondition }
  /** everyNthMeleeHit の読み替え: 近接命中の通算が every の倍数 */
  | { kind: "nthMeleeHit"; every: number }
  /** 対象の敵がこの状態異常を持つ（撃破時は倒れた瞬間の写しを見る） */
  | { kind: "targetHas"; status: StatusKind }
  /** 自分がこの状態異常を持つ */
  | { kind: "selfHas"; status: StatusKind }
  /** 直近 within 秒に event が起きた（今のイベントを含む） */
  | { kind: "recent"; event: EventKind; within: number }
  | { kind: "manaFull" }
  | { kind: "manaLow" }
  /** HP が SYNERGY.lowHpRatio 以下 */
  | { kind: "lowHp" }
  | { kind: "comboAbove"; count: number }
  /** 今の近接の振りが連撃の最終段（終撃）。ジョブ「剣士」が使う */
  | { kind: "finisher" }
  /** 今いる部屋が交戦中（封鎖中を含む。system/engagement.ts の isEngaged）。key は旧名のまま */
  | { kind: "roomLocked" }
  | { kind: "depthAtLeast"; depth: number }
  /** イベントの付随 key（反応の種類・地形の種類など）が一致 */
  | { kind: "eventTag"; tag: string }
  /** イベントを起こした側が一致 */
  | { kind: "actor"; actor: EventActor }
  // ---- 2026-09-24 追加（祝福 第 2 弾: 武器種・銃の弾・ジョブ・地形・属性・部屋） ----
  /** 中の条件を満たさない */
  | { kind: "not"; condition: RuleCondition }
  /** 今の武器種がどれか */
  | { kind: "moveset"; movesets: readonly MovesetKey[] }
  /** 今の弾がどれかの性質を持つ（設置弾・溜め撃ちなど。弾は銃のベースが持つ） */
  | { kind: "bullet"; has: readonly BulletFeature[] }
  /** 今の振りが武器種の段 atLeast 以上（0 始まり。双剣の 5 段目 = 4）。AttackState.step */
  | { kind: "swingStep"; atLeast: number }
  /** 今の振りの溜めの段が atLeast 以上（0 = 溜めなし） */
  | { kind: "chargedSwing"; atLeast: number }
  /** 近接の溜めの最中（大剣の長押し） */
  | { kind: "charging" }
  /** 今の振りがコンボ派生 */
  | { kind: "branchSwing" }
  | { kind: "job"; jobs: readonly JobKey[] }
  /** 今の武器種がジョブの得意 */
  | { kind: "favoredWeapon" }
  /** 自分が立つ地形。any = 地形の上ならどれでも */
  | { kind: "selfOnTerrain"; terrain: TerrainKind | "any" }
  /** イベントの位置（対象の敵の足元）の地形。撃破でも倒れた位置で見る */
  | { kind: "targetOnTerrain"; terrain: TerrainKind | "any" }
  /** 対象の敵が、via の攻撃（近接 = 武器種 / 射撃 = 銃の弾、属性の変換込み）を弱点 / 耐性で受ける */
  | { kind: "targetAffinity"; affinity: "weak" | "resist"; via: RuleAttackVia }
  /** via の攻撃の主な属性（変換の割合が最も大きいもの） */
  | { kind: "attackElement"; element: Element; via: RuleAttackVia }
  /** 交戦中の部屋の種類がどれか（巣窟・伏兵など） */
  | { kind: "engagedIn"; rooms: readonly RoomKind[] }
  /** 対象の敵が徘徊（どの部屋にも属さない）。撃破は倒れた瞬間の所属で見る */
  | { kind: "targetRoamer" }
  /** 今の階の種類（分岐路で選んだバイオーム）がどれか */
  | { kind: "floorKind"; kinds: readonly FloorKind[] }
  // ---- 2026-09-24 追加（既存の祝福のルール文法移行） ----
  /** イベントの出どころの種類（見切りのうち、受け流しのスキル〔skill〕ではなく回避で取ったもの = player） */
  | { kind: "from"; source: EventSource["kind"] }
  // ---- 2026-09-24 追加（祝福の移行 第 2 弾: コンボ加算・砕き・通常の振りの命中） ----
  /** イベントの量（コンボ加算なら加算後のコンボ数）が every の倍数（0 は数えない） */
  | { kind: "amountEvery"; every: number }
  /** イベントの付随 key がどれか（eventTag の複数版） */
  | { kind: "eventTagIn"; tags: readonly string[] }
  /** 必殺ゲージが満タン */
  | { kind: "energyFull" }
  /** 死神が出ている、または出現の予兆が出ている */
  | { kind: "reaperNear" }
  /** 今の振り（ダッシュ攻撃を除く）が当たり判定中で、対象の敵に当たっている（終撃で倒した、などの判定） */
  | { kind: "swingStruck" }
  /** 対象の敵が精鋭（撃破は倒れた瞬間の写しを見る） */
  | { kind: "targetElite" }
  // ---- 2026-09-25 追加（奥義と左右アクション。docs/ideas/ougi-and-dual-actions.md） ----
  /** 持続（sustain）の奥義の最中（Player.ultimate.active） */
  | { kind: "ultimateActive" }
  /** 今の振りのレーン（左 = primary / 右 = secondary。AttackState.lane） */
  | { kind: "lane"; lane: ButtonKey }
  // ---- 2026-09-30 追加（武器の型。docs/ideas/weapon-forms-impl.md 3-1） ----
  /** 今の武器種の型がどれか（個性で絞るなら moveset） */
  | { kind: "form"; forms: readonly FormKey[] }
  // ---- 2026-09-30 追加（銭。docs/ideas/economy-impl.md 2-10） ----
  /** 持ち金が amount 以上 */
  | { kind: "coinsAtLeast"; amount: number }
  // ---- 2026-09-30 追加（祝福の中身。docs/ideas/boon-impl.md 2-6） ----
  /** 対象（イベントの位置。Modifier なら殴っている敵）が自分から radius 以内（領域） */
  | { kind: "targetWithin"; radius: number }
  /** 「〜につき」の数（PerCounter）が atLeast 以上かつ atMost 以下（一念: 系譜が 1 つだけ = lineagesOwned atMost 1） */
  | { kind: "counter"; counter: PerCounter; atLeast?: number; atMost?: number };

/** 属性・弱点の条件がどの攻撃の素性を見るか */
export type RuleAttackVia = "melee" | "ranged";

/**
 * 効果の種類。装備トリガーの効果をすべて含み、統一文法で増えたものを足す。
 * spreadStatus = 対象が持っていた状態異常を周囲へ広げる（野火・疫病の形）
 * hazardBomb = 予告付きの爆発（敵の Rule はこれ以外を持てない。テレグラフ原則を型で強制する）
 */
export type RuleEffectKind =
  | TriggerEffectKind
  | "spreadStatus"
  | "hazardBomb"
  // ---- 2026-09-24 追加（祝福 第 2 弾） ----
  /** イベントの位置に地形を置く（terrain / radius / duration） */
  | "placeTerrain"
  /** イベントの位置の油・草に火をつけ、氷を溶かす（radius） */
  | "igniteTerrain"
  /** イベントの位置の地形を半径 radius に広げる（地形の無い所では何もしない） */
  | "spreadTerrain"
  /** 自分に状態異常を付ける（status / count = スタック / duration / magnitude = 強さ）。呪いの代償にも使う */
  | "selfStatus"
  /** 対象の敵へ追撃（素性なしの proc ダメージ = magnitude） */
  | "strike"
  /** 照準方向へ貫通する衝撃波（祝福の断裂波と同じ弾。magnitude = ダメージ） */
  | "wave"
  /** ダッシュの回数を count だけ戻す（fill なら全部） */
  | "refillDash"
  // ---- 2026-09-24 追加（既存の祝福のルール文法移行） ----
  /** 戦闘中の回復の上限（HEAL.sustainCapRatio）を通さない回復（制圧の報酬など。heal は上限つき） */
  | "healDirect"
  /** 上限なしの無敵（duration 秒。invuln は TRIGGER.invulnMax で切る。制圧の報酬など長い加護用） */
  | "ward"
  /** イベントの位置から全方位へ氷の破片（count 発、magnitude = ダメージ。速さ・寿命・色は BOON.shatter*） */
  | "shards"
  /**
   * 対象の敵（生きていれば）へ状態異常をそのまま付ける（status / duration / count = スタック / magnitude = 強さ）。
   * inflict と違い、対象がいなくても周囲へは付けず、持続を切り詰めず、敵ごとの procIcd も見ない（旧フックの付け方）
   */
  | "afflict"
  // ---- 2026-09-24 追加（祝福の移行 第 2 弾） ----
  /** イベントの位置に刻印符を落とす */
  | "dropRune"
  /** イベントの位置に装備を落とす */
  | "dropItem"
  /** 祝福の 3 択を提示する */
  | "offerBoons"
  /**
   * 部屋の敵すべて（room: event = イベントの部屋〔無ければ交戦中の部屋〕/ roaming = 徘徊の敵）へ
   * 状態異常（status / duration / count / magnitude = 強さ）、status が無ければ怯み値 magnitude
   */
  | "roomEnemies"
  /**
   * イベントの位置から半径 radius の敵すべて（対象の敵は除く）へ状態異常（status …）、
   * status が無ければ素性なしのダメージ magnitude。onlyWith / skipBoss で相手を絞る
   */
  | "nearbyEnemies"
  /** 回避の無敵時間（invulnTimer）を duration 秒まで延ばす（被弾の無敵 invuln とは別。見切りの判定に乗る） */
  | "iframes"
  /** リゲイン（被弾で失って取り戻せる分）を全て回復する */
  | "reclaim"
  /** コンボを 0 に戻す */
  | "resetCombo"
  /** 半径 radius の敵の status を起爆し、残りの効果（強さ × 残り秒 × magnitude）を即時に与える */
  | "detonate"
  /** 対象が持っていた status を、残り時間ごと半径 radius 内の最も近い敵へ移す */
  | "passStatus"
  /** 次の階の宝物庫を予約する（予約済みなら何もしない） */
  | "reserveVault"
  // ---- 2026-09-30 追加（銭。docs/ideas/economy-impl.md 2-10） ----
  /** 銭を magnitude（四捨五入）得る */
  | "gainCoins"
  /** 銭を magnitude（四捨五入）払う。足りなければ何もしない */
  | "spendCoins"
  /** 持ち金の magnitude（割合 0..1）をイベントの位置へ撒く（拾い直しは稼ぎに数えない） */
  | "scatterCoins"
  // ---- 2026-09-30 追加（祝福の中身。docs/ideas/boon-impl.md 2-6 末尾の新しい効果の種類） ----
  /**
   * 研鑽の数え: boonRun.tallies[key] に magnitude（scaleBy 込み）を足す。mode: max なら大きい方を残す（最長記録）。
   * 格は掛けず、連鎖にも語の上限にも数えない（数えるだけで何も起こさない）
   */
  | "tally"
  /** 全スロットの再使用時間を全長の magnitude（割合 0..1）だけ戻し、最低間隔の残りも同じ割合で縮める。fill なら全部 */
  | "refreshSkills"
  /** 直前に撃ったスキル（SkillRunState.lastCast）を自分の位置からもう一度撃つ。気力・再使用は払わない。威力 × magnitude */
  | "echoLast"
  /** 従魔・召喚・設置物の狙いを対象の敵へ向ける（duration 秒。boonRun.focus に置き、狙う側が focusTarget で読む） */
  | "retarget"
  /** イベントの位置に最も近い設置物を count 個（既定 1）消し、その位置で爆発（半径 radius、ダメージ magnitude） */
  | "detonatePlaced"
  /**
   * 敵を duration 秒だけ味方にする（Enemy.allyUntil）。radius があれば半径内の敵（onlyWith で絞る。近い順）、無ければ対象の敵。
   * count = 同時に従える上限（既定 1）。ボス級・変身する敵は従えない
   */
  | "tameEnemy"
  /** 銭を count（share があれば持ち金の割合）払い、照準へ銭の弾を撃つ。威力 = 払った額 × magnitude。払えなければ不発 */
  | "coinShot"
  /** 対象の敵の溜め（Enemy.vault。種類 vault が合うときだけ）を magnitude 倍のダメージで一度に出し、溜めを空にする */
  | "releaseVault"
  // ---- 2026-09-30 追加（遺物。docs/ideas/relics-7d-plan.md 2-1 T10） ----
  /** 戦意を magnitude（scaleBy 込み）足す。戦意の上限で切り、溜まりの倍は掛けない。導出の型（溜め・傷・鎖…）では何もしない */
  | "gainMorale";

/**
 * 効果量の基準。flat = magnitude そのまま / slashBase = 近接 1 段目の威力 × magnitude /
 * maxHp = 最大生命 × magnitude / eventAmount = イベントの量（振りの威力など GameEvent.amount）× magnitude
 */
export type RuleMagnitudeBase =
  | "flat"
  | "slashBase"
  | "maxHp"
  | "eventAmount"
  /** 必殺ゲージの最大 × magnitude */
  | "maxEnergy"
  /** 今のコンボ数 × magnitude */
  | "combo"
  /** 対象の敵の status の強さ × magnitude（撃破は倒れた瞬間の写し） */
  | "targetPotency"
  // ---- 2026-09-30 追加（祝福の中身） ----
  /** 今の持ち金 × magnitude（散財。払う効果より前に並べる） */
  | "coins"
  /** effect.counter（「〜につき」の数え方）の今の数 × magnitude（従えた数・連鎖の長さを数えに積むなど） */
  | "counter";

/** 効果量の下限に使う装備の値（祝福の雷・炎は「装備の方が強ければそちら」） */
export type RuleStatFloor = "shockDamage" | "burnDps";

export interface RuleEffect {
  kind: RuleEffectKind;
  /** 効果量（ダメージ・回復量・% など効果ごとに解釈。spreadStatus は元の強さに掛ける倍率） */
  magnitude: number;
  scaleBy?: RuleMagnitudeBase;
  duration?: number;
  count?: number;
  status?: StatusKind;
  /** spreadStatus / hazardBomb / 地形の効果の半径 */
  radius?: number;
  /** placeTerrain の地形 */
  terrain?: TerrainKind;
  /** 効果の浮き文字・輪を出さない（旧フックが黙って回復・回収していた祝福の見た目を保つ） */
  quiet?: boolean;
  /** restoreMana / refillDash: 量ではなく上限まで満たす（気力は回収量の倍率 manaGainMul を通さない補充） */
  fill?: boolean;
  /** spreadStatus: 元のスタック数と付与前の強さ（霊力の倍率を割り戻した値）をそのまま引き継ぐ（疫病の形） */
  inherit?: boolean;
  /** 効果の後に自分の頭上へ出す浮き文字（旧フックの「湧水」「結界」など） */
  text?: string;
  /** text の色 / spreadStatus の輪の色（省略時は効果の既定） */
  color?: string;
  /** afflict の相手。target = イベントの対象（既定）/ source = イベントを起こした敵（見切った攻撃の主） */
  on?: "target" | "source";
  // ---- 2026-09-24 追加（祝福の移行 第 2 弾） ----
  /** explode / chainLightning: 対象の敵を巻き込まない（対象から広がる爆発・連鎖雷） */
  excludeTarget?: boolean;
  /** energy: 回収量の倍率（energyGainMul）を通さず足す */
  raw?: boolean;
  /** roomEnemies の相手 */
  room?: "event" | "roaming";
  /** nearbyEnemies: この状態異常を持つ敵だけ */
  onlyWith?: StatusKind;
  /** nearbyEnemies: ボス（EnemyDef.boss）を除く（ボスを凍結させない効果など。ボスの片割れは含める） */
  skipBoss?: boolean;
  /** 効果量をこの装備の値以上にする（scaleBy で求めた値と比べて大きい方） */
  statFloor?: RuleStatFloor;
  /** 連鎖係数（0..1）。この効果が起こしたイベントの次の Rule の確率に掛かる。省略時は種類の既定（procCoefficientOf） */
  procCoefficient?: number;
  // ---- 2026-09-30 追加（祝福の中身） ----
  /** tally: 数えの key（boonRun.tallies の key。Modifier の per { kind: "tally", key } と TemperStat.tally が読む） */
  key?: string;
  /** tally: add = 足す（既定）/ max = 最高記録を残す */
  mode?: "add" | "max";
  /** coinShot: 持ち金のこの割合（0..1）を払う。count より優先 */
  share?: number;
  /** scaleBy: "counter" の数え方 */
  counter?: PerCounter;
  /** releaseVault: 出す溜めの種類 */
  vault?: VaultKind;
  /** tameEnemy: 1 体従えるごとに払う銭（払えなければ従えない。買収） */
  cost?: number;
}

/** 敵の Rule が持てる効果（予告付きハザードのみ） */
export interface HazardRuleEffect extends RuleEffect {
  kind: "hazardBomb";
  /** 予告の秒（爆弾の導火線） */
  duration: number;
  radius: number;
}

/** どのイベントを食うか。スキル石・刻印符の Rule は自分の発動が起こしたイベントだけを食う */
export type RuleScope = { kind: "any" } | { kind: "skill"; key: SkillKey } | { kind: "slot"; slot: number };

export const SCOPE_ANY: RuleScope = { kind: "any" };

export interface Rule {
  /** ICD のキー。持ち主 + 添字で決める（決定性） */
  id: string;
  when: EventKind;
  /** すべて満たすときだけ発動（空 = 常に） */
  if: readonly RuleCondition[];
  then: RuleEffect;
  /** 発動確率 0..1。1 以上なら乱数を引かない */
  chance: number;
  /** Rule ごとの内部 CD（秒） */
  icd: number;
  scope: RuleScope;
  owner: EventSource;
  /** 語ごとの回数上限に数える語。省略時は効果の種類から決める（effectKeyword） */
  keyword?: string;
  /**
   * 直接の効果（旧フックから移した祝福）。フックだった頃は system が直接起こした出来事と同じ扱いだったので、
   * 移しても数値・回数を変えないよう連鎖に数えない: 深さを進めない・減衰なし・語の回数上限に数えない・
   * 深さの上限に達したイベントでも照合する・連鎖の記録（state.chains）に残さない
   */
  direct?: boolean;
  /** 同じ group の Rule は 1 つのイベントにつき 1 回だけ起きる（断裂波と連撃波を同じ振りで 2 本出さない） */
  group?: string;
  /** ICD を共有する鍵（省略時は id）。同じ鍵の Rule は発動のたびに互いの ICD を埋める（過充填と臨界の爆発） */
  icdKey?: string;
}

/** 敵の Rule（src/data/enemyCombat.ts）。効果は予告付きハザードに限る */
export interface EnemyRule extends Rule {
  then: HazardRuleEffect;
}

/**
 * 効果の種類 → 語（docs/ideas/synergy-web.md 1-2 の対応表）。語の型は別レーン（共通語彙）が定めるので key の文字列で持つ。
 * 語にしない効果（バフなど）は種類名そのものを語として数える（同じ効果の重ねがけを同じ上限で絞る）
 */
const EFFECT_KEYWORD: Readonly<Partial<Record<RuleEffectKind, string>>> = {
  shockwave: "area",
  spawnBullets: "bullet",
  chainLightning: "shock",
  burnNearby: "burn",
  freezeNearby: "chill",
  explode: "explode",
  heal: "heal",
  energy: "energy",
  invuln: "ward",
  restoreMana: "mana",
  addPoise: "stagger",
  volley: "ranged",
  healMissing: "heal",
  hazardBomb: "explode",
  placeTerrain: "placed",
  igniteTerrain: "burn",
  spreadTerrain: "placed",
  strike: "melee",
  wave: "area",
  refillDash: "dash",
  healDirect: "heal",
  ward: "ward",
  shards: "bullet",
  iframes: "ward",
  reclaim: "heal",
  dropRune: "loot",
  dropItem: "loot",
  refreshSkills: "mana",
  echoLast: "mana",
  retarget: "placed",
  detonatePlaced: "explode",
  tameEnemy: "placed",
  coinShot: "bullet",
};

/** status を持てば語を status にする効果（状態異常を付ける・広げる・起爆する） */
const STATUS_KEYWORD_EFFECTS: ReadonlySet<RuleEffectKind> = new Set<RuleEffectKind>([
  "inflict",
  "spreadStatus",
  "selfStatus",
  "afflict",
  "roomEnemies",
  "nearbyEnemies",
  "detonate",
  "passStatus",
]);

export function effectKeyword(rule: Readonly<Rule>): string {
  if (rule.keyword !== undefined) return rule.keyword;
  const { kind, status } = rule.then;
  if (STATUS_KEYWORD_EFFECTS.has(kind) && status !== undefined) return status;
  if (kind === "nearbyEnemies") return "area";
  if (kind === "roomEnemies") return "stagger";
  return EFFECT_KEYWORD[kind] ?? kind;
}

/**
 * 効果の連鎖係数（0..1）。効果ごとの指定 → 種類の既定表（SYNERGY.procCoefficient）→ 1 の順。
 * 範囲の効果は 1 回で多くのイベントを起こすので、次の Rule の確率を下げて連鎖を自然に細らせる
 */
export function procCoefficientOf(effect: Readonly<RuleEffect>): number {
  if (effect.procCoefficient !== undefined) return effect.procCoefficient;
  const table: Readonly<Partial<Record<RuleEffectKind, number>>> = SYNERGY.procCoefficient;
  return table[effect.kind] ?? 1;
}

// -----------------------------------------------------------------------------
// 常時の増・倍（Modifier。docs/ideas/scaling-impl.md 2-8）。評価は system/modifiers.ts
// -----------------------------------------------------------------------------

/** 「〜につき」の数え方。数は評価の瞬間に system/modifiers.ts の countPer が数える */
export type PerCounter =
  /** 今のコンボ数 */
  | { kind: "combo" }
  /** 対象の敵に付いている状態異常の種類数 */
  | { kind: "targetStatusKinds" }
  /** 対象の敵の status のスタック */
  | { kind: "targetStacks"; status: StatusKind }
  /** 自分に付いている状態異常の種類数 */
  | { kind: "selfStatusKinds" }
  /** 自分の周り radius の生きている敵の数 */
  | { kind: "nearbyEnemies"; radius: number }
  /** この連鎖で繋いだ敵の数（訪問の種類数。イベント経由の一撃だけ。それ以外は 0） */
  | { kind: "chainVisits" }
  /** 失った生命の 10% ごと */
  | { kind: "missingHpTenths" }
  /** 転じ（会心率 1% につき など。倍率系は (値 − 1) × 100、率は × 100） */
  | { kind: "stat"; stat: PerStat }
  /** このランの撃破数 */
  | { kind: "runKills" }
  /** 今の戦意（Player.morale.value。「戦意 10 につき」は every 10） */
  | { kind: "morale" }
  /** 今の持ち金（EconomyState.coins） */
  | { kind: "coins" }
  /** このランで稼いだ銭の総額（拾い直しを除く） */
  | { kind: "coinsEarned" }
  /** このランで使った銭の総額 */
  | { kind: "coinsSpent" }
  // ---- 2026-09-30 追加（祝福の中身。docs/ideas/boon-impl.md 2-6） ----
  /** 研鑽の数え（boonRun.tallies[key]。無ければ 0） */
  | { kind: "tally"; key: string }
  /** 従魔・召喚・設置物の数（設置物 + 味方にした敵。system/rules.ts の minionCount） */
  | { kind: "minions" }
  /** 持ち金の対数の段: base 未満 0、base 以上 1、以後 2 倍ごとに +1（50 → 1 / 100 → 2 / 200 → 3。黄金律） */
  | { kind: "coinsLog"; base: number }
  /** この系譜に数える札の枚数（融合は 2 系譜のどちらにも数える） */
  | { kind: "lineageCards"; lineage: LineageKey }
  /** 持っている札の系譜の種類数（一念・巡礼） */
  | { kind: "lineagesOwned" }
  /** 装備している遺物の空いた余白の合計（無地の刃。docs/ideas/relics-7d-plan.md 3 章 R18） */
  | { kind: "gearMargin" };

/**
 * 転じの数え方。率は %、倍率は 1 を超える分の %、個数・防御・最大値はそのまま、
 * comboWindow はコンボの猶予（FEEL.comboWindow + comboWindowBonus）の 0.1 秒ごとに 1
 */
export type PerStat = "critChance" | "moveSpeedMul" | "dashCharges" | "projectileCount" | "armor" | "maxMana" | "maxHp" | "comboWindow";

/** 「〜につき」。n = floor(数 / every)。効きは amount × n を cap で切る（増なら増の量、倍なら 1 を超える分） */
export interface ModifierPer {
  count: PerCounter;
  /** 何単位で 1 つと数えるか（コンボ 10 につき = 10）。省略 = 1 */
  every?: number;
  /** amount × n の上限（0.1 = 増 +10% / 倍 +0.1）。省略 = 上限なし */
  cap?: number;
}

/**
 * 常時の増・倍。イベントを待たず、与ダメ・怯み値の計算がその都度読む。
 * - 増: amount 0.1 = +10%（per があれば 1 単位あたり）。装備の増と足してから 1 回掛ける
 * - 倍: amount 1.2 = ×1.2。per があれば 1 + amount × n
 */
export interface Modifier {
  /** ruleId と同じ作り（owner + 添字）。倍の出所は "mod:" + id */
  id: string;
  kind: "increased" | "more";
  /** 何に掛かるか。与ダメのタグ（1 撃がそのタグを持つとき）/ "all" = 与ダメ全部 / "poise" = 怯み値だけ */
  tag: DamageTag | "all";
  amount: number;
  per?: ModifierPer;
  /** 全部満たすときだけ（空 = 常時）。対象の条件は今殴っている敵で見る */
  if: readonly RuleCondition[];
  owner: EventSource;
  /** 倍の内訳に出す名前（省略時は owner.key） */
  label?: string;
}

/** 持ち主と添字から Rule の id を作る（同じ定義は常に同じ id） */
export function ruleId(owner: EventSource, index: number): string {
  return `${owner.kind}:${owner.key}:${index}`;
}
