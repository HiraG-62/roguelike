import { type GameState, type Reaper, type ReaperVariant, pushLog, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { REAPER } from "../data/tuning";
import { BOONS } from "./boonDefs";
import { boonReaperHalted, boonReaperJust, onBoonReaperDodged } from "./boonRules";
import { damagePlayer } from "./combat";
import { addFloatingText, spawnBurst, spawnLine, spawnRing } from "./effects";
import { createEnemy } from "./enemies";
import { findFreeSpot } from "./enemyTraits";
import { segmentCircleHit } from "./hazards";
import { circlesOverlap } from "./physics";
import { hasMod } from "./runSetup";

/**
 * 死神のバリアント（docs/ideas/enemies.md 6 章）。どれも「倒せない、長居するな」は変えず、逃げ方の問いを変える。
 * 鎖の死神（深層）/ 取り立て屋（呪い付きの祝福）/ 双子の死神（さらに深層）/ 影の死神（暗闇）/ 静かな死神（死神の友）。
 * 抽選は乱数を使わず、ランの状態で決まる（同じ条件なら同じ死神。起点・縛り・深度で読める）
 */

const V = REAPER.variants;
/** 影の死神の付き物 */
const SHADE_KEY = "reaperShade";
/** 部屋に属さない（部屋の制圧を止めない） */
const NO_ROOM = -1;
const FULL_CIRCLE = Math.PI * 2;
/** 取り立て屋の輪を光らせる間隔（tick） */
const OFFER_PULSE_TICKS = 20;

export const REAPER_VARIANT_LABEL: Readonly<Record<ReaperVariant, string>> = {
  default: "死神",
  chain: "鎖の死神",
  collector: "取り立て屋",
  twin: "双子の死神",
  shadow: "影の死神",
  silent: "静かな死神",
};

const VARIANT_LOG: Readonly<Record<ReaperVariant, string>> = {
  default: "長居しすぎた。死神が来る。",
  chain: "長居しすぎた。鎖の死神が来る。予告線を見て鎖を避けろ。",
  collector: "取り立て屋が来た。輪の中に留まれば、生命の一部と引き換えに去る。",
  twin: "長居しすぎた。死神が二手に分かれて来る。",
  shadow: "闇から影の群れが湧く。倒しても湧き直す。",
  silent: "静かな死神がついてくる。動いている間だけ近づく。",
};

/** 呪い付きの祝福を持っているか */
function hasCursedBoon(state: GameState): boolean {
  return state.boons.some((k) => BOONS[k].cursed);
}

/** このランの状態で出る死神（優先の高い順に判定する） */
export function chooseReaperVariant(state: GameState): ReaperVariant {
  if (hasCursedBoon(state)) return "collector";
  if (state.floorKind === "dark" || hasMod(state, "eternalNight")) return "shadow";
  if (state.origin === "reaperFriend") return "silent";
  if (state.depth >= V.twin.minDepth) return "twin";
  if (state.depth >= V.chain.minDepth) return "chain";
  return "default";
}

/** 出現直後の支度（双子の片割れ・鎖の間隔・影の群れ）とログ */
export function initReaperVariant(state: GameState, r: Reaper): void {
  const variant = chooseReaperVariant(state);
  r.variant = variant;
  r.timer = variant === "chain" ? V.chain.interval : variant === "shadow" ? V.shadow.respawn : 0;
  if (variant === "twin") r.twin = mirrorPoint(state, r.pos);
  if (variant === "shadow") topUpShades(state);
  pushLog(state, VARIANT_LOG[variant], REAPER.color);
}

/** プレイヤーを挟んで反対側の点 */
function mirrorPoint(state: GameState, pos: Vec): Vec {
  const p = state.player.body.pos;
  return add(p, scale(sub(p, pos), 1));
}

/** 本体を描くか（影の死神は本体が出ない。取り立て屋は去った後は消える） */
export function reaperBodyVisible(r: Reaper): boolean {
  return r.variant !== "shadow" && r.departed !== true;
}

/** 毎ステップ: 動きと接触（reaper.ts の updateReaper から） */
export function tickReaper(state: GameState, r: Reaper, baseSpeed: number, dt: number): void {
  if (r.departed) return;
  switch (r.variant) {
    case "shadow":
      tickShadow(state, r, dt);
      return;
    case "chain":
      tickChain(state, r, baseSpeed * V.chain.speedMul, dt);
      return;
    case "collector":
      tickCollector(state, r, baseSpeed * V.collector.speedMul, dt);
      return;
    case "twin":
      chaseWith(state, r.pos, baseSpeed * V.twin.speedMul, dt);
      if (r.twin) chaseWith(state, r.twin, baseSpeed * V.twin.speedMul, dt);
      touch(state, r.pos, r.radius);
      if (r.twin) touch(state, r.twin, r.radius);
      return;
    case "silent":
      // プレイヤーが止まっている間は近づかない（静止を選ぶ理由。逃げるには動くしかない）
      if (length(state.player.body.vel) > V.silent.moveThreshold) chaseWith(state, r.pos, baseSpeed, dt);
      touch(state, r.pos, r.radius);
      return;
    default:
      chaseWith(state, r.pos, baseSpeed, dt);
      touch(state, r.pos, r.radius);
      return;
  }
}

/** 壁を抜けてプレイヤーへ直進する（祝福で足が止まる間は止まる） */
function chaseWith(state: GameState, pos: Vec, speed: number, dt: number): void {
  const to = sub(state.player.body.pos, pos);
  if (length(to) <= 0 || boonReaperHalted(state)) return;
  const dir = normalize(to);
  pos.x += dir.x * speed * dt;
  pos.y += dir.y * speed * dt;
}

function touch(state: GameState, pos: Vec, radius: number): void {
  const p = state.player.body;
  if (!circlesOverlap(pos.x, pos.y, radius, p.pos.x, p.pos.y, p.radius)) return;
  // 死神は無敵で常に接触するため、ジャスト回避を成立させない（祝福で許されるときだけ）
  const result = damagePlayer(state, REAPER.damage, pos, undefined, { noJust: !boonReaperJust(state) });
  if (result === "dodged") onBoonReaperDodged(state);
}

/** 鎖の死神: interval ごとに charge 秒の予告線を出して止まり、鎖を投げる。当たると引き寄せる */
function tickChain(state: GameState, r: Reaper, speed: number, dt: number): void {
  const c = V.chain;
  if ((r.charging ?? 0) > 0) {
    r.charging = (r.charging ?? 0) - dt;
    if (r.charging <= 0) throwChain(state, r);
    touch(state, r.pos, r.radius);
    return;
  }
  chaseWith(state, r.pos, speed, dt);
  touch(state, r.pos, r.radius);
  r.timer = (r.timer ?? c.interval) - dt;
  if (r.timer > 0) return;
  r.charging = c.charge;
  r.aim = add(r.pos, scale(normalize(sub(state.player.body.pos, r.pos)), c.length));
  pushSfx(state, "laserCharge");
}

function throwChain(state: GameState, r: Reaper): void {
  const c = V.chain;
  const aim = r.aim ?? r.pos;
  r.aim = undefined;
  r.charging = 0;
  r.timer = c.interval;
  spawnLine(state, r.pos, aim, c.color, 0.3);
  pushSfx(state, "chainThrow");
  const p = state.player;
  if (!segmentCircleHit(r.pos, aim, c.width / 2, p.body.pos, p.body.radius)) return;
  if (damagePlayer(state, c.damage, r.pos, undefined, { noJust: !boonReaperJust(state) }) !== "hit") return;
  p.knock = scale(normalize(sub(r.pos, p.body.pos)), c.pull);
}

/**
 * 取り立て屋: 速いが、輪の距離まで来ると止まって待つ。輪の中に offerTime 秒留まると HP を取って去る。
 * 輪から出れば待ちは消え、また追ってくる（払うか、逃げ続けるかの選択）
 */
function tickCollector(state: GameState, r: Reaper, speed: number, dt: number): void {
  const c = V.collector;
  const d = dist(state.player.body.pos, r.pos);
  if (d > c.offerRadius) {
    r.timer = 0;
    chaseWith(state, r.pos, speed, dt);
    touch(state, r.pos, r.radius);
    return;
  }
  touch(state, r.pos, r.radius);
  r.timer = (r.timer ?? 0) + dt;
  if (state.tick % OFFER_PULSE_TICKS === 0) spawnRing(state, r.pos, c.offerRadius, c.color, 0.3);
  if (r.timer < c.offerTime) return;
  collectToll(state, r);
}

function collectToll(state: GameState, r: Reaper): void {
  const c = V.collector;
  const p = state.player;
  const toll = Math.floor(p.hp * c.tollRatio);
  p.hp = Math.max(1, p.hp - toll);
  r.departed = true;
  spawnBurst(state, r.pos, c.color, 24, 120, 0.6, 2.5);
  addFloatingText(state, { x: p.body.pos.x, y: p.body.pos.y - 16 }, `取り立て -${toll}`, c.color, 1.3, 1.4);
  pushLog(state, "取り立て屋は生命の一部を受け取り、去っていった。", c.color);
  pushSfx(state, "reaperAppear");
}

/** 影の死神: 本体は出ず、倒せる影が群れで追う。respawn 秒ごとに数を戻す */
function tickShadow(state: GameState, r: Reaper, dt: number): void {
  r.pos = { ...state.player.body.pos };
  r.timer = (r.timer ?? V.shadow.respawn) - dt;
  if (r.timer > 0) return;
  r.timer = V.shadow.respawn;
  topUpShades(state);
}

function topUpShades(state: GameState): void {
  const s = V.shadow;
  const alive = state.enemies.filter((e) => e.hp > 0 && e.defKey === SHADE_KEY).length;
  const def = enemyDef(SHADE_KEY);
  for (let i = alive; i < s.shades; i++) {
    const want = add(state.player.body.pos, scale(fromAngle((i / s.shades) * FULL_CIRCLE + state.tick), s.ring));
    const pos = findFreeSpot(state, want, def.radius) ?? want;
    const shade = createEnemy(state, def, pos, NO_ROOM, true);
    shade.revived = true;
    state.enemies.push(shade);
  }
}

/** 階が変わる前に影の群れを消す必要はない（敵は buildFloor で作り直される）。表示用の名前 */
export function reaperLabel(r: Reaper | null): string {
  return REAPER_VARIANT_LABEL[r?.variant ?? "default"];
}
