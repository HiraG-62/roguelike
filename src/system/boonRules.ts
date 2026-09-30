import { MIN_INCREASED_MUL, moreMulFor, productMore } from "../core/damage";
import { type Enemy, type GameState, type Projectile, allocId } from "../core/state";
import { type Vec, scale, sub } from "../core/vec";
import { BOON, PLAYER } from "../data/tuning";
import { meleeScaling } from "../data/weapons";
import { stoneInSlot } from "../skills/persistence";
import type { SkillResource } from "../skills/types";
import { boonGradeMul } from "./boonGrade";
import { hasBoon } from "./boons";
import { damageEnemy, rollOutgoing } from "./combat";
import { addFloatingText } from "./effects";
import { scaled } from "./attributes";
import { estimateModifiers } from "./modifiers";
import { circlesOverlap } from "./physics";
import { isAllied } from "./rules";
import { ROAMING_ROOM } from "./spawner";

/**
 * 統一ルール文法（BoonDef.rules / modifiers）で書けない祝福の効果（docs/ideas/boon-impl.md 2-6）。
 * 祝福内部の状態（すり抜けた敵・撃った順）を持つものと、Rule 効果が使う共通の計算（slashBase・衝撃波・徘徊の判定）を置く。
 * 札の定義（src/system/boonDefs/*.ts）から「旧フック」として名指しされているものだけが残る:
 * 抜き胴（updateDashThrough）/ 四重奏（trackEclipse）
 */

const TEXT_SCALE = 1.1;
const TEXT_LIFE = 0.6;
/** 四重奏の窓が開いたときの浮き文字（札の名前と同じ） */
const ECLIPSE_TEXT = "四重奏";

/** 拡張ルールのラン内の作業領域（BoonRunState.rules） */
export interface BoonRuleState {
  /** 抜き胴: 今のダッシュで既にすり抜けた敵 */
  dashHits: number[];
  /** 四重奏: 払った気力が戻る窓の残り秒 */
  eclipseTimer: number;
  /** 四重奏: 窓の外で撃ったスロットの並び（装着数まで） */
  castSeq: number[];
  /** 倒れた徘徊の敵 id → 覚えておく残り秒（条件 targetRoamer。撃破の照合は敵が配列から消えた後に起きる） */
  roamerKills: Map<number, number>;
}

export function createBoonRuleState(): BoonRuleState {
  return {
    dashHits: [],
    eclipseTimer: 0,
    castSeq: [],
    roamerKills: new Map(),
  };
}

function rules(state: GameState): BoonRuleState {
  return state.boonRun.rules;
}

// -----------------------------------------------------------------------------
// 共通
// -----------------------------------------------------------------------------

/** 近接 1 段目の装備・ステータス込みダメージ（祝福の威力は装備 stat に比例させる） */
export function slashBase(state: GameState): number {
  const s = state.stats;
  const base = scaled(s, meleeScaling(PLAYER.melee[0]!.scaling));
  // 相手を選ばない Modifier（得意武器など）も威力に含める（得意武器の倍が stats.more にあった頃と同じ値）
  const mods = estimateModifiers(state, "melee");
  const increased = Math.max(MIN_INCREASED_MUL, 1 + s.increased.melee + mods.increased);
  return Math.round((base + s.meleeDamageFlat) * increased * moreMulFor(s.more, "melee") * productMore(mods.more));
}

function hitProc(state: GameState, e: Enemy, base: number, from: Vec, poise = 0): void {
  const out = rollOutgoing(state, e, base, "proc");
  damageEnemy(state, e, out.amount, sub(e.body.pos, from), 0, { hitstopSteps: 0, poise: poise * state.stats.poiseDamageMul });
}

/** 衝撃波（Rule 効果 wave）。プレイヤーの位置から dir へ飛ぶ近接扱いの貫通弾 */
export function spawnBoonWave(state: GameState, dir: Vec, damage: number): void {
  const p = state.player;
  const pr: Projectile = {
    id: allocId(state),
    owner: "player",
    pos: { ...p.body.pos },
    vel: scale(dir, BOON.waveSpeed),
    radius: BOON.waveRadius,
    damage,
    life: BOON.waveLife,
    color: BOON.waveColor,
    kind: "melee",
    hitIds: new Set(),
    pierceLeft: BOON.wavePierce,
  };
  state.projectiles.push(pr);
}

// -----------------------------------------------------------------------------
// 毎ステップ（boons.ts の updateBoons から）
// -----------------------------------------------------------------------------

export function updateBoonRules(state: GameState, dt: number): void {
  const r = rules(state);
  r.eclipseTimer = Math.max(0, r.eclipseTimer - dt);
  tickMap(r.roamerKills, dt);
  updateDashThrough(state);
}

function tickMap(map: Map<number, number>, dt: number): void {
  for (const [id, t] of map) {
    if (t - dt <= 0) map.delete(id);
    else map.set(id, t - dt);
  }
}

/** 抜き胴: ダッシュ中に重なった敵へ 1 回ずつ */
function updateDashThrough(state: GameState): void {
  const p = state.player;
  if (!hasBoon(state, "passCut") || p.dashTimer <= 0) return;
  const r = rules(state);
  for (const e of state.enemies) {
    // 従魔（眷属）は斬らない。時間切れで敵に戻った後は斬る（allyUntil が残っていても isAllied は偽）
    if (e.hp <= 0 || e.phase === "spawning" || isAllied(state, e) || r.dashHits.includes(e.id)) continue;
    const reach = p.body.radius + BOON.passCutReach;
    if (!circlesOverlap(p.body.pos.x, p.body.pos.y, reach, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    r.dashHits.push(e.id);
    hitProc(state, e, slashBase(state) * BOON.passCutRatio * boonGradeMul(state, "passCut"), p.body.pos, BOON.passCutPoise);
  }
}

/** 新しい階: 階ごとのもの（徘徊の撃破の記録）を捨てる */
export function resetBoonRulesForFloor(state: GameState): void {
  rules(state).roamerKills.clear();
}

// -----------------------------------------------------------------------------
// フック（boons.ts から）
// -----------------------------------------------------------------------------

/** ダッシュ開始: すり抜けの記録を空にする */
export function onBoonDashRules(state: GameState): void {
  rules(state).dashHits = [];
}

/** 撃破時: 徘徊の敵の撃破を覚える（条件 targetRoamer） */
export function onBoonKillRules(state: GameState, enemy: Enemy): void {
  if (enemy.roomIndex === ROAMING_ROOM) rules(state).roamerKills.set(enemy.id, BOON.roamerKillMemory);
}

/** スキル発動（払った後）: 四重奏。窓の中なら払った気力を戻し、窓の外なら撃った順を数える。resource は今は読まない（呼び出しの形を保つ） */
export function onBoonSkillCastRules(state: GameState, slot: number, _resource: SkillResource | null, manaPaid: number): void {
  if (!hasBoon(state, "eclipse")) return;
  const r = rules(state);
  const p = state.player;
  if (r.eclipseTimer > 0) {
    if (manaPaid > 0) p.mana = Math.min(state.stats.maxMana, p.mana + manaPaid);
    return;
  }
  if (slot >= 0) trackEclipse(state, slot);
}

/**
 * 四重奏: 装着中のスキルを重複なく続けて全部撃ったら窓を開く。
 * 窓の中の（無料の）発動は数えない。数えると 2 スロットを交互に撃つだけで窓が開き直し、気力を払わず撃ち続けられる
 */
function trackEclipse(state: GameState, slot: number): void {
  const r = rules(state);
  const equipped = equippedSlotCount(state);
  r.castSeq.push(slot);
  if (r.castSeq.length > equipped) r.castSeq.shift();
  if (equipped < BOON.eclipseMinSlots || r.castSeq.length < equipped) return;
  if (new Set(r.castSeq).size !== equipped) return;
  r.castSeq = [];
  r.eclipseTimer = BOON.eclipseWindow;
  addFloatingText(state, state.player.body.pos, ECLIPSE_TEXT, BOON.cardColor.law, TEXT_SCALE, TEXT_LIFE);
}

export function equippedSlotCount(state: GameState): number {
  const rs = state.skills;
  let n = 0;
  for (let i = 0; i < rs.slots.length; i++) if (stoneInSlot(rs.profile, i)) n += 1;
  return n;
}

/**
 * 条件 targetRoamer: 敵 id が徘徊か。生きていれば今の所属、倒れた後は撃破の記録
 * （撃破の照合は敵が配列から消えた後に起きるので、BOON.roamerKillMemory 秒の間だけ覚えている）
 */
export function isRoamerTarget(state: GameState, id: number): boolean {
  const live = state.enemies.find((e) => e.id === id && e.hp > 0);
  if (live !== undefined) return live.roomIndex === ROAMING_ROOM;
  return rules(state).roamerKills.has(id);
}

/** 徘徊の敵か（どの部屋にも属さない。rules.ts の roomEnemies が読む。spawner を rules.ts から直に読むと初期化順の循環を起こす） */
export function isRoamingEnemy(e: Enemy): boolean {
  return e.roomIndex === ROAMING_ROOM;
}
