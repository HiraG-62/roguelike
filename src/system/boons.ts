import type { FrameInput } from "../core/input";
import type { KeywordProfile } from "../core/keywords";
import { type Enemy, type GameState, type Projectile, type RoomState, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, length, scale } from "../core/vec";
import { VIEW_W } from "../core/view";
import { BOON, FEEL, MANA, PLAYER, STATUS } from "../data/tuning";
import { ATTR_KEYS, type AttrKey, type Attributes, type PlayerStats } from "../loot/types";
import { SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { SkillResource, SkillTag } from "../skills/types";
import type { JobKey } from "../data/jobs";
import { MOVESETS, type MovesetKey, type ShotKey, usesProjectiles } from "../data/weapons";
import { BOONS, BOON_KEYS, type BoonDef, type BoonKey, type BoonLoadout, type BoonTag } from "./boonDefs";
import {
  type BoonRuleState,
  boonRuleAttackManaMul,
  boonRuleCostMul,
  createBoonRuleState,
  onBoonComboHitRules,
  onBoonCritRules,
  onBoonDashEndRules,
  onBoonDashRules,
  onBoonJustRules,
  onBoonJustSteal,
  onBoonKillRules,
  onBoonMeleeHitRules,
  onBoonRoomClearRules,
  onBoonRoomLockRules,
  onBoonSkillCastRules,
  onBoonSkillHitRules,
  onBoonSwingRules,
  onBoonWaveStart,
  resetBoonRulesForFloor,
  tightropePenalty,
  updateBoonRules,
} from "./boonRules";
import { cancelAttack } from "./combat";
import { addFloatingText, spawnBurst, spawnRing } from "./effects";
import { isEngaged } from "./engagement";
import { STATUS_BOON_TAGS, affinity, buildProfile, statsBoonTags } from "./keywords";
import { gainMana } from "./mana";
import { applyStats, dashTime } from "./player";
import { applyStatus, enemiesInRadius, findStatus } from "./statusEffects";

/**
 * ラン内限定の祝福 3 択。docs/ideas/run-structure.md「祝福 3 択（Boon）」。
 * 数値盛りではなく「ルール変更」を中心にし、装備のタグ（burn / dash / just など）に反応して出やすさが変わる。
 * 各システムは hasBoon で分岐し、数値系は foldBoonStats（applyStats 内）で stats に畳み込む。
 */

export {
  BOONS,
  BOON_KEYS,
  LINEAGE_LABEL,
  type BoonDef,
  type BoonKey,
  type BoonRarity,
  type BoonLoadout,
  type BoonTag,
  type LineageKey,
} from "./boonDefs";
export { onBoonWaveStart } from "./boonRules";

export function boonDef(key: BoonKey): BoonDef {
  return BOONS[key];
}

// -----------------------------------------------------------------------------
// 状態
// -----------------------------------------------------------------------------

export interface BoonChoice {
  options: BoonKey[];
  /** マウスが乗っているカード（-1 = なし）。入力から決まるので決定的 */
  hover: number;
  /** マウスが「呪いを受けて 4 択」の札に乗っているか */
  curseHover: boolean;
  /** 提示からの経過（実時間秒）。inputDelay までは入力を無視 */
  timer: number;
  /** 呪いを受けて 4 択にした（1 回の提示につき 1 回まで） */
  curseTaken: boolean;
  /** 受けた呪い付き祝福（表示用）。受けていなければ null */
  curse: BoonKey | null;
}

/** 祝福のラン内の作業領域 */
export interface BoonRunState {
  /** applyStats に渡された装備由来の stats（祝福を畳み込む前）。未設定なら null */
  baseStats: PlayerStats | null;
  reviveUsed: boolean;
  /** eliteVault: 次の階に宝物庫を確定させる */
  vaultNext: boolean;
  heartBurnTimer: number;
  /** dashGuard: ガードの残り秒 */
  guardTimer: number;
  /** glassJust: ダッシュ後も JUST が取れる残り秒 */
  justExtendTimer: number;
  /** crumble: 前ステップまでに脆弱を付けた「怯み中の敵」の id。怯み 1 回につき 1 度だけ付ける */
  crumbled: number[];
  /** circulation: 直近の発動 1 回で既に戻したマナ。発動ごとに 0 へ戻す（多段ヒットの過剰還元を防ぐ） */
  circulationGained: number;
  /** 拡張の祝福（system/boonRules.ts）の作業領域 */
  rules: BoonRuleState;
}

export function createBoonRunState(): BoonRunState {
  return {
    baseStats: null,
    reviveUsed: false,
    vaultNext: false,
    heartBurnTimer: 0,
    guardTimer: 0,
    justExtendTimer: 0,
    crumbled: [],
    circulationGained: 0,
    rules: createBoonRuleState(),
  };
}

export function hasBoon(state: GameState, key: BoonKey): boolean {
  return state.boons.includes(key);
}

// -----------------------------------------------------------------------------
// 装備タグと抽選
// -----------------------------------------------------------------------------

/**
 * 装備（stats）から祝福タグを読む。keystones / triggers / 状態異常の有無に反応する。
 * 推論の表は共通語彙と共有している（system/keywords.ts の statsBoonTags）
 */
export function equipmentTags(stats: Readonly<PlayerStats>): Set<BoonTag> {
  return statsBoonTags(stats);
}

/** スキル石のタグ → 祝福タグ（範囲・強化・詠唱は対応する祝福の系統が無いので読まない） */
const SKILL_TAG_TO_BOON: Readonly<Partial<Record<SkillTag, BoonTag>>> = {
  melee: "melee",
  projectile: "ranged",
  movement: "dash",
  defense: "counter",
  placed: "placed",
  fire: "burn",
  cold: "chill",
  lightning: "shock",
};

/** 装着中のスキル石から祝福タグを読む（タグ・資源・命中で付ける状態異常） */
export function skillStoneTags(state: GameState): Set<BoonTag> {
  const tags = new Set<BoonTag>();
  const rs = state.skills;
  for (let i = 0; i < rs.slots.length; i++) {
    const stone = stoneInSlot(rs.profile, i);
    if (!stone) continue;
    const def = SKILL_DEFS[stone.skillKey];
    tags.add("skill");
    if (def.resource === "mana") tags.add("mana");
    for (const t of def.tags) {
      const tag = SKILL_TAG_TO_BOON[t];
      if (tag) tags.add(tag);
    }
    for (const a of def.applies ?? []) {
      for (const tag of STATUS_BOON_TAGS[a.kind] ?? []) tags.add(tag);
    }
  }
  return tags;
}

/** 取得済みの祝福が「出す」タグ */
export function boonGivenTags(boons: readonly BoonKey[]): Set<BoonTag> {
  const tags = new Set<BoonTag>();
  for (const key of boons) for (const t of BOONS[key].gives ?? []) tags.add(t);
  return tags;
}

/** 今の武器種・射撃の型・ジョブ（BoonDef.loadout の照合に使う） */
export interface LoadoutNow {
  moveset: MovesetKey;
  shot: ShotKey;
  job: JobKey;
}

/** 抽選に使うタグ。owned = 装備 + スキル石（requires はこちらだけを見る）、gives = 取得済み祝福が出すもの */
export interface BuildTags {
  owned: ReadonlySet<BoonTag>;
  gives: ReadonlySet<BoonTag>;
  loadout?: LoadoutNow;
}

export function buildTags(state: GameState): BuildTags {
  // 祝福を畳み込む前の装備 stats で判定する（triggerHappy の射撃速度 x2 などを「装備のタグ」と誤認しない）
  const base = state.boonRun.baseStats ?? state.stats;
  const owned = equipmentTags(base);
  // 指輪・首飾りの射撃性質だけでは撃てない（弾を出せない武器種なら装備由来の ranged タグを外す）。
  // スキル石由来の ranged（遠距離スキル石）は後で足すので、ここで消しても残らないようにする
  if (!usesProjectiles(MOVESETS[base.moveset])) owned.delete("ranged");
  for (const t of skillStoneTags(state)) owned.add(t);
  return { owned, gives: boonGivenTags(state.boons), loadout: { moveset: base.moveset, shot: base.shot, job: state.job } };
}

/** loadout の列を持つなら、今の武器種・射撃の型・ジョブがその列に入っているか。now が無ければ（テストの直接呼び出し）通す */
export function loadoutMatches(want: BoonLoadout | undefined, now: LoadoutNow | undefined): boolean {
  if (want === undefined || now === undefined) return true;
  if (want.movesets && !want.movesets.includes(now.moveset)) return false;
  if (want.shots && !want.shots.includes(now.shot)) return false;
  if (want.jobs && !want.jobs.includes(now.job)) return false;
  return true;
}

const NO_TAGS: ReadonlySet<BoonTag> = new Set();

/**
 * 候補の重み。取得済み / requires を満たさない / 系譜の前段が無い / 結びの片方が無いなら 0。
 * 装備・スキル石のタグの一致で大きく、取得済み祝福の「出す」タグの一致で小さく上がる（同じタグは二重に数えない）。
 * 系譜の次段と結びは、条件を満たした時点で出やすくする
 */
export function boonWeight(
  def: BoonDef,
  tags: ReadonlySet<BoonTag>,
  owned: readonly BoonKey[],
  gives: ReadonlySet<BoonTag> = NO_TAGS,
  loadout?: LoadoutNow,
): number {
  if (owned.includes(def.key)) return 0;
  if (!loadoutMatches(def.loadout, loadout)) return 0;
  if (def.requires && !tags.has(def.requires)) return 0;
  if (def.after && !owned.includes(def.after)) return 0;
  if (def.duo && !def.duo.every((k) => owned.includes(k))) return 0;
  const matches = def.tags.filter((t) => tags.has(t)).length;
  const fed = def.tags.filter((t) => gives.has(t) && !tags.has(t)).length;
  let weight = BOON.rarityWeight[def.rarity] * (1 + BOON.tagBonus * matches + BOON.givesTagBonus * fed);
  if (def.after) weight *= BOON.lineageWeightMul;
  if (def.duo) weight *= BOON.duoWeightMul;
  return weight;
}

/**
 * 共通語彙の相性による重み倍率。候補が今のビルドの飢え（食うのに誰も出さない語）を 1 つでも埋めるなら上げる。
 * 0 の重み（出ない候補）は 0 のまま
 */
export function boonAffinityMul(def: BoonDef, build: Readonly<KeywordProfile>): number {
  return affinity(def.keywords, build).fills.length > 0 ? BOON.affinityWeightMul : 1;
}

/** 重み付きで 1 つ取り出す（pool から除く）。全て 0 なら null */
function takeWeighted(state: GameState, pool: BoonDef[], tags: BuildTags, build: Readonly<KeywordProfile>): BoonDef | null {
  const weights = pool.map((d) => boonWeight(d, tags.owned, state.boons, tags.gives, tags.loadout) * boonAffinityMul(d, build));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return null;
  let roll = state.rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll > 0) continue;
    const [picked] = pool.splice(i, 1);
    return picked ?? null;
  }
  return pool.pop() ?? null;
}

/** 同じ 3 択に並べない組: 同じ系譜 / 結び同士 */
export function isSiblingBoon(a: BoonDef, b: BoonDef): boolean {
  if (a.lineage !== undefined && a.lineage === b.lineage) return true;
  return a.duo !== undefined && b.duo !== undefined;
}

function dropSiblings(pool: BoonDef[], picked: BoonDef): void {
  for (let i = pool.length - 1; i >= 0; i--) {
    const d = pool[i];
    if (d && isSiblingBoon(d, picked)) pool.splice(i, 1);
  }
}

/** 3 枚（重複なし）を抽選する。cursedChance で 1 枚が呪い付き祝福になる。同じ系譜・結びは 1 枚まで */
export function rollBoonOptions(state: GameState): BoonKey[] {
  const tags = buildTags(state);
  const build = buildProfile(state);
  const all = BOON_KEYS.map(boonDef);
  const normal = all.filter((d) => !d.cursed);
  const cursed = all.filter((d) => d.cursed);
  const picks: BoonDef[] = [];
  const take = (pool: BoonDef[]): BoonDef | null => {
    const picked = takeWeighted(state, pool, tags, build);
    if (!picked) return null;
    dropSiblings(normal, picked);
    dropSiblings(cursed, picked);
    picks.push(picked);
    return picked;
  };
  const wantCursed = state.rng.chance(BOON.cursedChance);
  if (wantCursed) take(cursed);
  while (picks.length < BOON.choiceCount) {
    if (!take(normal) && !take(cursed)) break;
  }
  // 呪い枠の位置もランダム（いつも左端だと読まれる）
  if (wantCursed && picks.length > 1) {
    const [first] = picks.splice(0, 1);
    if (first) picks.splice(state.rng.int(0, picks.length), 0, first);
  }
  return picks.map((d) => d.key);
}

/** 3 択を提示する（階段で降りた直後。depth 2 以降） */
export function offerBoons(state: GameState): void {
  if (state.depth < 2) return;
  const options = rollBoonOptions(state);
  if (options.length === 0) return;
  state.boonChoice = { options, hover: -1, curseHover: false, timer: 0, curseTaken: false, curse: null };
  pushSfx(state, "lootRare");
  pushSfx(state, "boonOffer");
}

// -----------------------------------------------------------------------------
// 呪いを受けて 4 択（docs/ideas/boons-expansion.md 4-5）
// -----------------------------------------------------------------------------

/** 表の候補と並べられない / 取得済みでない、呪いなしの候補 */
function extraPool(shown: readonly BoonKey[]): BoonDef[] {
  const shownDefs = shown.map(boonDef);
  return BOON_KEYS.map(boonDef).filter(
    (d) => !d.cursed && !shown.includes(d.key) && !shownDefs.some((s) => isSiblingBoon(d, s)),
  );
}

/** いま呪いを受けて 4 択にできるか（未使用・受けられる呪いと 4 枚目の候補がある） */
export function canTakeCurse(state: GameState): boolean {
  const c = state.boonChoice;
  if (!c || c.curseTaken || c.options.length >= BOON.choiceCountWithCurse) return false;
  const tags = buildTags(state);
  const owned = [...state.boons, ...c.options];
  const hasCurse = BOON_KEYS.some((k) => BOONS[k].cursed && boonWeight(BOONS[k], tags.owned, owned, tags.gives, tags.loadout) > 0);
  const hasExtra = extraPool(c.options).some((d) => boonWeight(d, tags.owned, state.boons, tags.gives, tags.loadout) > 0);
  return hasCurse && hasExtra;
}

/**
 * 呪い付き祝福を 1 つ強制で受け、4 枚目の候補を足す。呪いは「罰」ではなく「選択肢を買う通貨」。
 * 呪いで結びの条件が揃うこともあるので、4 枚目は受けた後の持ち物で抽選する
 */
export function takeCurse(state: GameState): boolean {
  const c = state.boonChoice;
  if (!c || !canTakeCurse(state)) return false;
  const cursedPool = BOON_KEYS.map(boonDef).filter((d) => d.cursed && !c.options.includes(d.key));
  const curse = takeWeighted(state, cursedPool, buildTags(state), buildProfile(state));
  if (!curse) return false;
  grantBoon(state, curse.key);
  c.curseTaken = true;
  c.curse = curse.key;
  const extra = takeWeighted(state, extraPool(c.options), buildTags(state), buildProfile(state));
  if (extra) c.options.push(extra.key);
  return true;
}

// -----------------------------------------------------------------------------
// 選択 UI のレイアウトと入力
// -----------------------------------------------------------------------------

export const BOON_CARD = {
  w: 128,
  /** 4 択（呪いを受けた後）のときの幅と間隔。480 px に 4 枚収める */
  narrowW: 108,
  h: 150,
  gap: 12,
  narrowGap: 8,
  y: 60,
  /** ホバーで浮く量（px） */
  hoverLift: 4,
  /** 「呪いを受けて 4 択」の札（カードの下） */
  curseW: 200,
  curseH: 14,
  curseGap: 8,
} as const;

export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** index 番目のカード矩形（画面座標）。描画と当たり判定で共有する */
export function boonCardRect(index: number, count: number): CardRect {
  const narrow = count > BOON.choiceCount;
  const w = narrow ? BOON_CARD.narrowW : BOON_CARD.w;
  const gap = narrow ? BOON_CARD.narrowGap : BOON_CARD.gap;
  const total = count * w + (count - 1) * gap;
  const x0 = Math.round((VIEW_W - total) / 2);
  return { x: x0 + index * (w + gap), y: BOON_CARD.y, w, h: BOON_CARD.h };
}

/** 「呪いを受けて 4 択」の札の矩形 */
export function boonCurseRect(): CardRect {
  const w = BOON_CARD.curseW;
  return { x: Math.round((VIEW_W - w) / 2), y: BOON_CARD.y + BOON_CARD.h + BOON_CARD.curseGap, w, h: BOON_CARD.curseH };
}

function inRect(point: Vec, r: CardRect): boolean {
  return point.x >= r.x && point.x < r.x + r.w && point.y >= r.y && point.y < r.y + r.h;
}

export function cardIndexAt(point: Vec, count: number): number {
  for (let i = 0; i < count; i++) {
    const r = boonCardRect(i, count);
    if (inRect(point, { ...r, y: r.y - BOON_CARD.hoverLift, h: r.h + BOON_CARD.hoverLift })) return i;
  }
  return -1;
}

/**
 * 入力から選んだカード。クリックはカード上のみ。E（attack）は 3 枚目、4（skill4）は 4 枚目。無ければ -1
 * パッドの A は attackPressed も同時に立つが、ここでは confirm 扱いで 1 枚目にする
 * （3 枚目は attackPressed かつ padConfirmPressed でないときだけ＝RT 単独のときのみ）
 */
function selectedIndex(input: FrameInput, hover: number): number {
  if (input.skill1Pressed || input.padConfirmPressed) return 0;
  if (input.skill2Pressed) return 1;
  if (input.skill4Pressed) return 3;
  // クリックと attackPressed は同じ元なので、クリックならカード判定だけを使う
  if (input.clickPressed) return hover;
  if (input.attackPressed && !input.padConfirmPressed) return 2;
  return -1;
}

/** 呪いの札を押したか（3 / X か、札のクリック） */
function curseRequested(input: FrameInput, curseHover: boolean): boolean {
  return input.skill3Pressed || (input.clickPressed && curseHover);
}

/** 選択中の 1 ステップ（step から呼ぶ。他の更新は止まっている） */
export function updateBoonChoice(state: GameState, input: FrameInput, dt: number): void {
  const c = state.boonChoice;
  if (!c) return;
  c.timer += dt;
  c.hover = input.aimScreen ? cardIndexAt(input.aimScreen, c.options.length) : -1;
  c.curseHover = input.aimScreen !== null && inRect(input.aimScreen, boonCurseRect());
  if (c.timer < BOON.inputDelay) return;
  if (curseRequested(input, c.curseHover)) {
    takeCurse(state);
    return;
  }
  const index = selectedIndex(input, c.hover);
  if (index < 0 || index >= c.options.length) return;
  chooseBoon(state, index);
}

export function chooseBoon(state: GameState, index: number): void {
  const key = state.boonChoice?.options[index];
  state.boonChoice = null;
  if (!key) return;
  grantBoon(state, key);
}

/** 祝福を得る（テストからも直接使う） */
export function grantBoon(state: GameState, key: BoonKey): void {
  if (hasBoon(state, key)) return;
  state.boons.push(key);
  applyBoonsToStats(state);
  // 祝福は階に着いた後で選ぶので、この階に配置済みの敵（ボス含む）にも遡って掛ける
  if (key === "giantSlayer") applyGiantSlayerToExisting(state);
  const def = boonDef(key);
  const color = def.cursed ? BOON.cursedColor : BOON.rarityColor[def.rarity];
  addFloatingText(state, state.player.body.pos, def.name, color, 1.4, 1.2);
  pushLog(state, `祝福: ${def.name} - ${def.desc}`, color);
  pushSfx(state, "lootRare");
  pushSfx(state, def.cursed ? "boonSelectCursed" : "boonSelect");
}

// -----------------------------------------------------------------------------
// 数値系: stats への畳み込み
// -----------------------------------------------------------------------------

/** 装備由来の stats に祝福を畳み込む（元の stats は変更しない） */
export function foldBoonStats(stats: Readonly<PlayerStats>, boons: readonly BoonKey[], run: Readonly<BoonRunState>): PlayerStats {
  const out: PlayerStats = { ...stats };
  if (boons.includes("clearHeal")) out.maxHp = Math.round(out.maxHp * BOON.clearHealMaxHpMul);
  if (boons.includes("deathRush")) out.maxHp = Math.max(1, Math.round(out.maxHp * BOON.deathRushMaxHpMul));
  if (boons.includes("glassJust")) out.maxHp = BOON.glassJustMaxHp;
  if (boons.includes("triggerHappy")) {
    out.fireRateMul *= BOON.triggerHappyFireMul;
    out.rangedDamageMul *= BOON.triggerHappyDamageMul;
  }
  if (boons.includes("oneWing")) out.dashCooldownMul += BOON.oneWingDashCooldownMul;
  if (boons.includes("comboClock")) out.comboWindowBonus -= FEEL.comboWindow * BOON.comboClockWindowMul;
  if (boons.includes("reaperCup")) out.manaRegen *= BOON.reaperCupRegenMul;
  if (boons.includes("heavenEarth")) out.manaRegen = 0;
  if (boons.includes("karmaFire")) out.burnDps *= BOON.karmaBurnMul;
  if (boons.includes("hollowVessel")) {
    out.manaCostMul *= BOON.hollowVesselCostMul;
    out.maxMana = Math.round(out.maxMana * BOON.hollowVesselMaxManaMul);
  }
  if (boons.includes("heartBurn") && run.heartBurnTimer > 0) {
    out.burnChance = Math.min(1, out.burnChance * BOON.heartBurnMul);
    out.burnDps *= BOON.heartBurnMul;
  }
  // 係数（実効値）を組み替える。派生（HP・移動など）は元のステータスで決まっているので触らない
  if (boons.includes("swapHands") || boons.includes("lopsided")) out.attributesEff = foldAttributeBoons(out.attributesEff, boons);
  // 最終段で下限を掛ける。0 だと capManaCost がコストを 0 に切り詰めて撃ち放題になる
  out.maxMana = Math.max(MANA.maxMin, out.maxMana);
  return out;
}

/** swapHands → lopsided の順に実効値を組み替える（入力は書き換えない） */
function foldAttributeBoons(eff: Readonly<Attributes>, boons: readonly BoonKey[]): Attributes {
  const out: Attributes = { ...eff };
  if (boons.includes("swapHands")) {
    out.str = eff.dex;
    out.dex = eff.str;
  }
  if (boons.includes("lopsided")) applyLopsided(out);
  return out;
}

/**
 * lopsided: 最も高いステータスの実効値 ×lopsidedHighMul、最も低いものを 0 に。
 * 同値なら ATTR_KEYS の先頭を最高、末尾を最低にする（決定的）。全部同じなら偏りが無いので何もしない
 */
function applyLopsided(eff: Attributes): void {
  let high: AttrKey = ATTR_KEYS[0];
  let low: AttrKey = ATTR_KEYS[0];
  for (const k of ATTR_KEYS) {
    if (eff[k] > eff[high]) high = k;
    if (eff[k] <= eff[low]) low = k;
  }
  if (eff[high] === eff[low]) return;
  eff[high] *= BOON.lopsidedHighMul;
  eff[low] = 0;
}

/** 装備の stats（祝福前）を覚えて、祝福を畳み込み直す。何度呼んでも同じ結果 */
export function applyBoonsToStats(state: GameState): void {
  const base = state.boonRun.baseStats ?? state.stats;
  applyStats(state, base);
}

// -----------------------------------------------------------------------------
// 毎ステップ
// -----------------------------------------------------------------------------

export function updateBoons(state: GameState, dt: number): void {
  const run = state.boonRun;
  run.guardTimer = Math.max(0, run.guardTimer - dt);
  run.justExtendTimer = Math.max(0, run.justExtendTimer - dt);
  updateCrumble(state);
  updateBoonRules(state, dt);
  if (run.heartBurnTimer <= 0) return;
  run.heartBurnTimer = Math.max(0, run.heartBurnTimer - dt);
  if (run.heartBurnTimer === 0) applyBoonsToStats(state);
}

/**
 * crumble: プレイヤー由来の怯みに入った敵へ脆弱を付ける（怯み 1 回につき 1 度）。
 * 怯みの付与元（poise.ts）に手を入れずに済むよう、毎ステップ新しく怯んだ敵を探す。
 * 自傷の怯み（猪の壁激突）は source が env なので対象外
 */
function updateCrumble(state: GameState): void {
  const run = state.boonRun;
  if (!hasBoon(state, "crumble")) {
    run.crumbled = [];
    return;
  }
  const seen = new Set(run.crumbled);
  const now: number[] = [];
  const v = STATUS.vulnerable;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const stagger = findStatus(e.status, "stagger");
    if (!stagger || stagger.source !== "player") continue;
    now.push(e.id);
    if (seen.has(e.id)) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "vulnerable", stacks: 1, duration: v.duration, potency: 0 }, "player");
    if (hasBoon(state, "totalCollapse")) spreadCollapse(state, e);
  }
  run.crumbled = now;
}

/** totalCollapse: 崩しの脆弱を周囲の敵にも伝える */
function spreadCollapse(state: GameState, source: Enemy): void {
  const v = STATUS.vulnerable;
  for (const e of enemiesInRadius(state, source.body.pos, BOON.collapseSpreadRadius)) {
    if (e.id === source.id) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "vulnerable", stacks: 1, duration: v.duration, potency: 0 }, "player");
  }
  spawnRing(state, source.body.pos, BOON.collapseSpreadRadius, BOON.ruleTextColor, STATUS.fxLife);
}

// -----------------------------------------------------------------------------
// フック: player.ts
// -----------------------------------------------------------------------------

const LAST_COMBO = PLAYER.melee.length - 1;
const TEXT_SCALE = 1.1;
const TEXT_LIFE = 0.6;

/** finisherOnly: 近接は常に最終段から（ダッシュ攻撃は除く） */
export function boonSwingCombo(state: GameState, combo: number, dashStrike: boolean): number {
  if (dashStrike || !hasBoon(state, "finisherOnly")) return combo;
  return LAST_COMBO;
}

/** 振り始め: 片翼。断裂波・連撃波は BoonDef.rules（onSwing）へ移した */
export function onBoonSwing(state: GameState, combo: number, dashStrike: boolean): void {
  onBoonSwingRules(state, combo, dashStrike);
}

export function canShootWhileDashing(state: GameState): boolean {
  return hasBoon(state, "dashGun");
}

/** 射撃直後: 背面撃ち / 静止射撃 */
export function onBoonShoot(state: GameState, shots: readonly Projectile[]): void {
  const p = state.player;
  if (hasBoon(state, "standingSniper") && (length(p.body.vel) < BOON.standStillSpeed || stillDashing(state))) {
    for (const s of shots) {
      s.pierceLeft += BOON.standPierceBonus;
      s.vel = scale(s.vel, BOON.standSpeedMul);
    }
  }
  const first = shots[0];
  if (!first || !hasBoon(state, "rearGuard")) return;
  state.projectiles.push({
    ...first,
    id: allocId(state),
    pos: { ...p.body.pos },
    vel: scale(first.vel, -1),
    damage: first.damage * BOON.rearShotDamageMul,
    hitIds: new Set(),
  });
}

/** stillDash: ダッシュの残りが短い（終わり際）なら静止とみなす */
function stillDashing(state: GameState): boolean {
  const t = state.player.dashTimer;
  return hasBoon(state, "stillDash") && t > 0 && t <= BOON.stillDashWindow;
}

/** dashGuard: ダッシュの代わりにその場ガード。置き換えたら true */
export function tryDashGuard(state: GameState): boolean {
  if (!hasBoon(state, "dashGuard")) return false;
  const p = state.player;
  cancelAttack(state);
  state.boonRun.guardTimer = BOON.guardTime;
  p.invulnTimer = Math.max(p.invulnTimer, BOON.guardTime);
  p.dodgedThisDash = false;
  p.knock = { x: 0, y: 0 };
  spawnRing(state, p.body.pos, p.body.radius * 2, BOON.guardColor, BOON.guardTime);
  pushSfx(state, "dash");
  return true;
}

/** ダッシュ開始: glassJust の JUST 窓延長（帯電疾走の連鎖雷は BoonDef.rules の onDash） */
export function onBoonDash(state: GameState): void {
  const p = state.player;
  onBoonDashRules(state);
  if (!hasBoon(state, "glassJust")) return;
  const extended = dashTime(state.stats) * BOON.glassJustMul;
  state.boonRun.justExtendTimer = extended;
  p.invulnTimer = Math.max(p.invulnTimer, extended);
}

/**
 * ダッシュ終了（時間切れ / 壁）。爆走・雷爆走は BoonDef.rules（onDashEnd）へ移した。
 * 片翼（近接の代わりにダッシュの終わりで射撃の弾を扇状に出す）だけがここに残る
 */
export function onBoonDashEnd(state: GameState): void {
  onBoonDashEndRules(state);
}

/**
 * spiritBlade: 通常攻撃（近接 3 段・ダッシュ攻撃・射撃 1 発）の威力に足す値（霊力の実効値 × 係数）。
 * 祝福が無ければ 0。player.ts の近接・射撃の威力に加算する
 */
export function boonNormalAttackBonus(state: GameState): number {
  if (!hasBoon(state, "spiritBlade")) return 0;
  const hollow = hasBoon(state, "hollowBlade") && state.player.mana < 1 ? BOON.hollowBladeMul : 1;
  return BOON.spiritBladeSpi * state.stats.attributesEff.spi * hollow;
}

/** spiritBlade / hollowVessel: 通常攻撃の命中で戻るマナに掛ける倍率（keystones の attackManaMul と掛け合わせる） */
export function boonAttackManaMul(state: GameState): number {
  const spirit = hasBoon(state, "spiritBlade") ? BOON.spiritBladeManaMul : 1;
  const hollow = hasBoon(state, "hollowVessel") ? BOON.hollowVesselAttackManaMul : 1;
  return spirit * hollow * boonRuleAttackManaMul(state);
}

/**
 * bloodMana: HP が閾値以下の間だけのコスト倍率。HP で変わるので stats（manaCostMul）には畳めず、
 * skills.ts の effectiveManaCost が払う瞬間に読む（下限 MANA.costMulMin は向こうで掛かる）
 */
export function boonManaCostMul(state: GameState, slot = -1): number {
  const p = state.player;
  const blood = hasBoon(state, "bloodMana") && p.hp <= p.maxHp * BOON.bloodManaHpRatio ? BOON.bloodManaCostMul : 1;
  return blood * boonRuleCostMul(state, slot);
}

// -----------------------------------------------------------------------------
// フック: skills.ts / skills/hit.ts
// -----------------------------------------------------------------------------

/**
 * スキル発動（castSlot。払った後）: circulation の還元量を発動単位で数え直す。
 * slot / resource / manaPaid は拡張の祝福（月蝕・両輪・満月撃ちなど）が読む。省略はテストの直接呼び出し
 */
export function onBoonSkillCast(state: GameState, slot = -1, resource: SkillResource | null = null, manaPaid = 0): void {
  state.boonRun.circulationGained = 0;
  onBoonSkillCastRules(state, slot, resource, manaPaid);
}

/** スキル命中（skillHit）: circulation。1 回の発動で circulationCap まで */
export function onBoonSkillHit(state: GameState, e?: Enemy): void {
  onBoonSkillHitRules(state, e);
  if (!hasBoon(state, "circulation")) return;
  const run = state.boonRun;
  const room = BOON.circulationCap - run.circulationGained;
  if (room <= 0) return;
  // 上限に数えるのは基礎量（manaGainMul の前）。回収量の性質はそのまま掛け算で効かせる
  const base = Math.min(BOON.circulationPerHit, room);
  run.circulationGained += base;
  gainMana(state, base);
}

export function boonMoveMul(state: GameState): number {
  if (state.boonRun.guardTimer > 0) return 0;
  const burden = hasBoon(state, "burden") ? BOON.burdenMoveMul : 1;
  if (!hasBoon(state, "lockdown")) return burden;
  return burden * (isEngaged(state) ? BOON.lockdownFastMul : BOON.lockdownSlowMul);
}

/**
 * 近接ヒット: 拡張の祝福（counter = カウンターヒット。今は読む祝福が無いが呼び出しの形を保つ）。
 * 過充填・臨界は BoonDef.rules（onSwingHit）へ移した
 */
export function onBoonMeleeHit(state: GameState, e: Enemy, counter = false): void {
  onBoonMeleeHitRules(state, e, counter);
}

/**
 * バーストの後（kills = バーストで倒した数）。還元・臨界・焦土・換金は BoonDef.rules（onBurst。量 = 倒した数）へ移した。
 * 呼び出し（player.ts）はバーストに割り込む祝福を足すときの置き場として残す
 */
export function onBoonBurstKills(_state: GameState, _kills: number): void {}

// -----------------------------------------------------------------------------
// フック: combat.ts
// -----------------------------------------------------------------------------

/** コンボ加算の後: 雷神の鼓。刻限のコンボ（10 ごとにゲージ満タン）は BoonDef.rules（onComboHit）へ移した */
export function onBoonComboHit(state: GameState): void {
  onBoonComboHitRules(state);
}

/** 会心: 血裂き（ダメージの途中に割り込む）。会心雷撃は BoonDef.rules（onCrit。量 = 与えたダメージ）へ移した */
export function onBoonCrit(state: GameState, enemy: Enemy, _amount: number): void {
  onBoonCritRules(state, enemy);
}

/**
 * 撃破時: 拡張の祝福（饗宴の盃・力の簒奪・灰積もり、徘徊の撃破の記録）。
 * 野火・氷砕・血の饗宴・疫病・屠りの盃・宝物の鍵・精鋭の磁力・血霧は BoonDef.rules（onKill）へ移した
 * （撃破回復は rules でも HEAL.sustainCapRatio の下）
 */
export function onBoonKill(state: GameState, enemy: Enemy): void {
  onBoonKillRules(state, enemy);
}

/**
 * 凍結の砕き（combat.ts の shatterFreeze から）。霜貫き・砕氷の鐘は BoonDef.rules（onShatter）へ移した。
 * 呼び出しは砕きに割り込む祝福を足すときの置き場として残す
 */
export function onBoonShatter(_state: GameState, _enemy: Enemy): void {}

/** 無敵中に JUST 回避になる追加条件（ガード中 / glassJust の延長窓） */
export function boonJustEligible(state: GameState): boolean {
  const run = state.boonRun;
  return run.guardTimer > 0 || run.justExtendTimer > 0;
}

/** 被弾後のコンボ数。comboKeeper なら半分残す */
export function comboAfterHurt(state: GameState): number {
  // 綱渡りの追加ダメージはコンボが消える前の数で決まるので、ここで先に取る
  tightropePenalty(state);
  if (!hasBoon(state, "comboKeeper")) return 0;
  return Math.floor(state.combo.count / 2);
}

/** secondWind: HP 0 になったとき 1 回だけ復活。復活したら true */
export function tryRevive(state: GameState): boolean {
  const run = state.boonRun;
  if (run.reviveUsed || !hasBoon(state, "secondWind")) return false;
  const p = state.player;
  run.reviveUsed = true;
  p.hp = Math.max(1, Math.round(p.maxHp * BOON.reviveHpRatio));
  p.invulnTimer = Math.max(p.invulnTimer, BOON.reviveInvuln);
  state.flash = 1;
  addFloatingText(state, p.body.pos, "再起", BOON.rarityColor.epic, 1.6, 1.2);
  spawnBurst(state, p.body.pos, BOON.rarityColor.epic, 30, 180, 0.6, 2.5);
  pushLog(state, "再起！まだ終わらない。", BOON.rarityColor.epic);
  pushSfx(state, "heal");
  return true;
}

/**
 * JUST 回避時: glassJust / 奪弾 → justWipe → 拡張の祝福。
 * 見切りの息・睨み・見切り返し・乾坤は BoonDef.rules（onJustDodge。回避した攻撃の主はイベントの sourceId）へ移した
 */
export function onBoonJust(state: GameState): void {
  const p = state.player;
  if (hasBoon(state, "glassJust")) {
    p.justTimer *= BOON.glassJustMul;
    p.justCounterTimer *= BOON.glassJustMul;
  }
  // 奪弾は一掃より先（奪った弾は自分の弾なので一掃で消えない）
  onBoonJustSteal(state);
  const wiped = hasBoon(state, "justWipe") ? wipeEnemyBullets(state) : 0;
  onBoonJustRules(state, wiped);
}

/** justWipe: 敵弾を全て消す。消した数を返す（燕渡りが読む） */
function wipeEnemyBullets(state: GameState): number {
  let wiped = 0;
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    pr.life = 0;
    wiped += 1;
    spawnBurst(state, pr.pos, pr.color, 3, 60, 0.2, 1.5);
  }
  return wiped;
}

// -----------------------------------------------------------------------------
// フック: floor.ts
// -----------------------------------------------------------------------------

/** eliteVault: 予約があれば、この階の空いている部屋を 1 つ宝物庫にする */
export function applyBoonFloorRules(state: GameState, reserved: ReadonlySet<number>): void {
  resetBoonRulesForFloor(state);
  const run = state.boonRun;
  if (!run.vaultNext) return;
  if (state.rooms.some((r) => r.kind === "treasure")) {
    run.vaultNext = false;
    return;
  }
  const index = state.rooms.findIndex((r, i) => !reserved.has(i) && r.kind === "normal");
  const room = state.rooms[index];
  if (!room) return;
  room.kind = "treasure";
  run.vaultNext = false;
}

/** giantSlayer: 通常敵の HP +25%（湧いた直後、エリート化の前に呼ぶ） */
export function onBoonEnemySpawned(state: GameState, e: Enemy): void {
  if (!hasBoon(state, "giantSlayer")) return;
  scaleHp(e, BOON.mobHpMul);
}

/** giantSlayer: ボスの HP -25% */
export function onBossSpawned(state: GameState): void {
  if (!state.boss || !hasBoon(state, "giantSlayer")) return;
  const id = state.boss.enemyId;
  const boss = state.enemies.find((e) => e.id === id);
  if (boss) scaleHp(boss, BOON.bossHpMul);
}

/** giantSlayer を取った時点で生きている敵に適用する（ボスは -25%、それ以外は +25%） */
function applyGiantSlayerToExisting(state: GameState): void {
  const bossId = state.boss?.enemyId;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    scaleHp(e, e.id === bossId ? BOON.bossHpMul : BOON.mobHpMul);
  }
}

function scaleHp(e: Enemy, mul: number): void {
  const hp = Math.max(1, Math.round(e.maxHp * mul));
  e.maxHp = hp;
  e.hp = hp;
  e.lastHp = hp;
}

/** eliteMagnet: エリート判定をもう 1 回振る */
export function extraEliteRoll(state: GameState, e: Enemy): boolean {
  return !e.elite && hasBoon(state, "eliteMagnet");
}

/** 部屋の封鎖: 持ち越しの終わりと巣窟の主。氷結封鎖は BoonDef.rules（onRoomLock。roomEnemies）へ移した */
export function onBoonRoomLock(state: GameState, index: number): void {
  onBoonRoomLockRules(state);
  // 封鎖で最初の波が始まる（巣窟・試練・闘技場）。2 波目以降は floor.ts の updateLockedRoom が onBoonWaveStart を呼ぶ
  const room = state.rooms[index];
  if (room?.locked) onBoonWaveStart(state, room);
}

/**
 * 部屋クリア: 拡張の祝福（時間稼ぎ・持ち越し）。room は呼び出しの形を保つために受ける。
 * 勝利の帳・血の代償・湧水・伏兵返し・試練の徒・狩場の王は BoonDef.rules（onRoomClear。部屋の種類はイベントの tag）へ移した
 */
export function onBoonRoomClear(state: GameState, _room?: RoomState): void {
  onBoonRoomClearRules(state);
}

export function boonHeartsAllowed(state: GameState): boolean {
  return !hasBoon(state, "bloodFeast");
}

/** heartBurn: ハートを拾うと burn が一定時間 2 倍 */
export function onBoonHeartPickup(state: GameState): void {
  if (!hasBoon(state, "heartBurn")) return;
  const wasActive = state.boonRun.heartBurnTimer > 0;
  state.boonRun.heartBurnTimer = BOON.heartBurnTime;
  if (!wasActive) applyBoonsToStats(state);
  addFloatingText(state, state.player.body.pos, "業火", STATUS.burnColor, TEXT_SCALE, TEXT_LIFE);
}
