import { type GameState, type UltimateState, pushSfx } from "../core/state";
import type { StatusApply } from "../core/status";
import { normalize, sub } from "../core/vec";
import { pushPlayerEvent } from "../core/events";
import { FEEL, ULTIMATE } from "../data/tuning";
import { type NovaAct, type UltimateAct, type UltimateDef, defaultUltimate, ultimateDef } from "../data/ultimates";
import { DEFAULT_MOVESET, MOVESETS, type MovesetDef, type MovesetKey } from "../data/weapons";
import type { PlayerStats, Scaling } from "../loot/types";
import { scaled, withRatio } from "./attributes";
import { onBoonBurstKills } from "./boons";
import { cancelAttack, damageEnemy, rollOutgoing } from "./combat";
import { addFloatingText, hitstop, shake, spawnBurst } from "./effects";
import { circlesOverlap } from "./physics";

/**
 * 奥義（F。docs/ideas/ougi-and-dual-actions.md 3.2）。奥義ゲージが満タンなら、選んだ奥義を出す。
 * 一撃（instant）は行為の列を順に出し、持続（sustain）はゲージが減る間 Player.ultimate.active に key を置く。
 * 今（Lane 0）は円月の周囲攻撃（旧バーストと同じ挙動）だけが動く。他の行為・持続の倍率と差し替えは Lane B が埋める
 */

/** 奥義を終えた理由（手動 = もう一度 F / 尽きた = ゲージ 0 / 変身 = 変身を撃った） */
export type UltimateEndReason = "manual" | "drained" | "form";

const NOT_READY_TEXT = "未充填";
const NOT_READY_COLOR = "#808080";
const NOT_READY_SCALE = 0.9;
const NOT_READY_LIFE = 0.4;
/** 発動の浮き文字（旧バーストの文言。表示名の置き換えは Lane C） */
const CAST_TEXT = "バースト！";
const CAST_TEXT_SCALE = 1.8;
const CAST_TEXT_LIFE = 0.8;
const FLASH_WHITE = "#ffffff";
const BURST_PARTICLES = 40;
const BURST_SPEED = 260;
const BURST_LIFE = 0.5;
const BURST_SIZE = 3;
const FLASH_PARTICLES = 20;
const FLASH_SPEED = 120;
const FLASH_LIFE = 0.3;
const FLASH_SIZE = 2;
const SCREEN_FLASH = 0.5;

export function createUltimateState(): UltimateState {
  return { active: null, elapsed: 0, kills: 0, auraTick: 0 };
}

/** 装備の武器種（変身中も変身前の武器種。武器なし・旧形式は既定） */
function equippedMoveset(state: GameState): MovesetKey {
  const key = state.stats.moveset;
  return MOVESETS[key] ? key : DEFAULT_MOVESET;
}

/** 今の武器種で選んでいる奥義。選択が無い・壊れている・武器種違いなら 1 本目 */
export function chosenUltimate(state: GameState): UltimateDef {
  const moveset = equippedMoveset(state);
  const key = state.profile.ultimates?.[moveset];
  const def = key === undefined ? undefined : ultimateDef(key);
  return def !== undefined && def.moveset === moveset ? def : defaultUltimate(moveset);
}

/** 持続中の奥義（無ければ undefined） */
function activeSustain(state: GameState): (UltimateDef & { kind: "sustain" }) | undefined {
  const key = state.player.ultimate.active;
  if (key === null) return undefined;
  const def = ultimateDef(key);
  return def?.kind === "sustain" ? def : undefined;
}

/** 奥義の行為の威力（係数表の評価 × burstDamageMul）。sustain 中の通常攻撃には掛けない */
export function ultimateDamage(stats: Readonly<PlayerStats>, scaling: Scaling): number {
  return scaled(stats, scaling) * stats.burstDamageMul;
}

/**
 * F の押下（player.ts の readActions から）。出した・終えたら true（呼び出し側がスキルをキャンセルする）。
 * 持続中に押したら終える（残りのゲージは保つ）
 */
export function tryUltimate(state: GameState): boolean {
  const p = state.player;
  if (p.ultimate.active !== null) {
    endUltimate(state, "manual");
    return true;
  }
  if (p.energy < ULTIMATE.common.cost) {
    addFloatingText(state, p.body.pos, NOT_READY_TEXT, NOT_READY_COLOR, NOT_READY_SCALE, NOT_READY_LIFE);
    return false;
  }
  const def = chosenUltimate(state);
  if (def.kind === "sustain") {
    startSustain(state, def);
    return true;
  }
  castInstant(state, def);
  return true;
}

/** 一撃の奥義: ゲージを 0 にし、振りを止めて行為の列を出す。発動時に onBurst（量 = 倒した数） */
function castInstant(state: GameState, def: UltimateDef & { kind: "instant" }): void {
  const p = state.player;
  p.energy = 0;
  cancelAttack(state);
  let kills = 0;
  for (const act of def.acts) kills += runAct(state, def, act);
  spawnBurst(state, p.body.pos, ULTIMATE.common.textColor, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  spawnBurst(state, p.body.pos, FLASH_WHITE, FLASH_PARTICLES, FLASH_SPEED, FLASH_LIFE, FLASH_SIZE);
  addFloatingText(state, p.body.pos, CAST_TEXT, ULTIMATE.common.textColor, CAST_TEXT_SCALE, CAST_TEXT_LIFE);
  hitstop(state, FEEL.hitstopHeavy);
  shake(state, FEEL.shakeSpecial);
  state.flash = Math.max(state.flash, SCREEN_FLASH);
  p.invulnTimer = Math.max(p.invulnTimer, def.invuln);
  pushSfx(state, "burst");
  onBoonBurstKills(state, kills);
  pushPlayerEvent(state, "onBurst", "burst", { amount: kills });
}

/** 行為を 1 つ出す。倒した数を返す。nova 以外は Lane B が埋める */
function runAct(state: GameState, def: UltimateDef, act: UltimateAct): number {
  switch (act.kind) {
    case "nova":
      return runNova(state, def, act);
    case "swing":
    case "volley":
    case "lunge":
    case "pull":
    case "buff":
    case "detonate":
      return 0;
  }
}

/** 周囲攻撃（円月）。半径に burstRadiusMul、威力に burstDamageMul。clearsBullets なら範囲内の敵弾を消す */
function runNova(state: GameState, def: UltimateDef, act: NovaAct): number {
  const p = state.player;
  const s = state.stats;
  const radius = act.radius * s.burstRadiusMul;
  const damage = ultimateDamage(s, act.scaling);
  const poise = withRatio(s, act.poise, act.poiseRatio) * s.poiseDamageMul;
  const knockback = act.knockback * s.knockbackMul;
  let kills = 0;
  for (const e of state.enemies) {
    if (!circlesOverlap(p.body.pos.x, p.body.pos.y, radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    const dir = normalize(sub(e.body.pos, p.body.pos));
    const out = rollOutgoing(state, e, damage, "proc", { attack: def.attack });
    if (damageEnemy(state, e, out.amount, dir, knockback, { poise, hitstopSteps: FEEL.hitstopHeavy })) kills += 1;
  }
  if (!act.clearsBullets) return kills;
  for (const pr of state.projectiles) {
    if (pr.owner === "enemy" && circlesOverlap(p.body.pos.x, p.body.pos.y, radius, pr.pos.x, pr.pos.y, pr.radius)) pr.life = 0;
  }
  return kills;
}

/** 持続の奥義を始める（ゲージはそのまま減り始める）。変身との排他・浮き文字は Lane B */
function startSustain(state: GameState, def: UltimateDef & { kind: "sustain" }): void {
  const u = state.player.ultimate;
  u.active = def.key;
  u.elapsed = 0;
  u.kills = 0;
  u.auraTick = 0;
  pushSfx(state, "burst");
}

/** 持続の奥義を終える。終了時に onBurst（量 = 持続中の撃破数）。持続中でなければ何もしない */
export function endUltimate(state: GameState, _reason: UltimateEndReason): void {
  const u = state.player.ultimate;
  if (u.active === null) return;
  const kills = u.kills;
  u.active = null;
  u.elapsed = 0;
  u.kills = 0;
  u.auraTick = 0;
  onBoonBurstKills(state, kills);
  pushPlayerEvent(state, "onBurst", "burst", { amount: kills });
}

/** 奥義の時間を進める（player.ts の updatePlayer で updateArt の直後）。持続中はゲージを減らし、尽きたら終える */
export function updateUltimate(state: GameState, dt: number): void {
  const def = activeSustain(state);
  if (!def) return;
  const p = state.player;
  p.ultimate.elapsed += dt;
  p.energy = Math.max(0, p.energy - def.sustain.drainPerSec * dt);
  if (p.energy <= 0 && p.ultimate.elapsed >= def.sustain.minSec) endUltimate(state, "drained");
}

/** 持続中の型の差し替え（player.ts の playerMoveset が変身の次に通す）。差し替えは Lane B。今はそのまま */
export function ultimateMoveset(_state: GameState, base: MovesetDef): MovesetDef {
  return base;
}

/** 持続中の与ダメの倍率（無ければ 1）。配線は Lane B（player.ts の actionStats） */
export function ultimateOutgoingMul(state: GameState): number {
  return activeSustain(state)?.sustain.mul.damage ?? 1;
}

/** 持続中の被ダメの倍率（無ければ 1）。配線は Lane B（combat.ts の damagePlayer） */
export function ultimateIncomingMul(state: GameState): number {
  return activeSustain(state)?.sustain.mul.incoming ?? 1;
}

/** 持続中の移動速度の倍率（無ければ 1）。配線は Lane B（player.ts の updateMovement） */
export function ultimateMoveMul(state: GameState): number {
  return activeSustain(state)?.sustain.mul.moveSpeed ?? 1;
}

/** 持続中の攻撃速度の倍率（無ければ 1）。配線は Lane B（player.ts の actionStats） */
export function ultimateSpeedMul(state: GameState): number {
  return activeSustain(state)?.sustain.mul.attackSpeed ?? 1;
}

const NO_APPLIES: readonly StatusApply[] = [];

/** 持続中に近接・射撃の命中で足す状態異常（無ければ空）。配線は Lane B（applyStepStatus と弾の命中） */
export function ultimateApplies(state: GameState): readonly StatusApply[] {
  return activeSustain(state)?.sustain.applies ?? NO_APPLIES;
}

/** 撃破を数える（持続中だけ。combat.ts の撃破分岐から。配線は Lane B） */
export function noteUltimateKill(state: GameState): void {
  const u = state.player.ultimate;
  if (u.active !== null) u.kills += 1;
}
