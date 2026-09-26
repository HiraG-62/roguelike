/**
 * 投げた武器の見た目。説明に「投げる」とある技の弾を、その武器の絵（data/sprites/weapons.ts の thrownWeapon.*）で飛ばす。
 * 弾の key・奥義の key・スキル（技）の key から「どの絵を、回すか / 進む向きへ向けるか」を引く表と、その描画。
 * state は読むだけ。回る角度は state.time と弾の id から決め、state.rng は使わない。
 * 弾の専用スプライト（fxShots.ts）より優先する（武器の絵が付く弾は武器の絵で描く）
 */
import type { GameState, Projectile } from "../core/state";
import type { Vec } from "../core/vec";
import type { MovesetKey } from "../data/weapons";
import { type ThrownShape, thrownSpriteKey } from "../data/sprites/weapons";
import type { EchoCast, Grenade } from "../skills/types";
import { shotBulletOf, ultimateShotOf } from "../system/effects";
import type { SpriteAtlas } from "./sprites";

/** spin = 飛びながら回る（斧・輪・盾）/ point = 切っ先を進む向きへ向ける（短刀・槍） */
export type ThrownMotion = "spin" | "point";

export interface ThrownLook {
  /** スプライトの key（SPRITES） */
  readonly sprite: string;
  readonly motion: ThrownMotion;
  /** spin の毎秒の回転（ラジアン） */
  readonly spin: number;
}

/** 軽い物（輪・短刀・鉈）の回転 */
const SPIN_FAST = 16;
/** 重い物（斧・鎚・盾・鉄球）の回転。重さが伝わるように少し遅い */
const SPIN_HEAVY = 11;
/** 弾ごとに回転の位相をずらす（同時に投げた扇の刃が揃って回って見えないように） */
const SPIN_PHASE_PER_ID = 0.9;
/** この半径（px）までは等倍。大きい弾（断頭輪など）は半径に合わせて拡大する */
const LOOK_BASE_RADIUS = 4;
/** 手榴弾の絵（既存の bomb） */
const GRENADE_SPRITE = "bomb";
/** 放物線の高さ（px）。skillHud.ts の手続きの描画もこれを使い、同じ位置に重ねて描く */
export const GRENADE_ARC_H = 18;
export const THROWN_ARC_H = 14;

function spin(shape: ThrownShape, rate = SPIN_FAST): ThrownLook {
  return { sprite: thrownSpriteKey(shape), motion: "spin", spin: rate };
}

function point(shape: ThrownShape): ThrownLook {
  return { sprite: thrownSpriteKey(shape), motion: "point", spin: 0 };
}

const KNIFE = point("knife");
const KNIFE_SPIN = spin("knife");
const AXE = spin("axe", SPIN_HEAVY);
const WAR_RING = spin("warRing");
const RING_BLADES = spin("ringBlades");

/**
 * 弾の key（BulletDef.key。右レーンの弾の段は `art.<段の key>`、銃の家系の左はベースの key）→ 見た目。
 * 派生の弾（二丁投げ・三本投げ・回し投げ・三連輪 …）も同じ弾の key を撃つのでここで拾える
 */
export const BULLET_LOOK: Readonly<Record<string, ThrownLook>> = {
  // 斧の右「投擲」（と派生の二丁投げ）
  "art.axeThrow": AXE,
  // チャクラムの右 4 段目「投輪」
  "art.ringLaunch": RING_BLADES,
  // 戦輪の右「輪投げ」「双輪」
  "art.ringThrow": WAR_RING,
  "art.twinRings": WAR_RING,
  // 投擲の左（投げ短剣）
  throwingKnives: KNIFE,
  // 戦輪の左（刃の輪を投げる）
  chakram: WAR_RING,
  returnChakram: WAR_RING,
  flyingBlade: WAR_RING,
};

/** 奥義の key（`<武器種>.<id>`）→ 見た目。弾の key より優先する（大投擲は返し輪の弾で斧を投げる） */
export const ULTIMATE_LOOK: Readonly<Record<string, ThrownLook>> = {
  "axe.greatThrow": AXE,
  "thrown.thousandHands": KNIFE,
  "thrown.pinpoint": KNIFE,
  "warRing.ringDance": WAR_RING,
  "warRing.headsman": WAR_RING,
};

/** 技・スキル石の key（CastParams.skillKey）→ 見た目。技の弾（state.skills.shots）に使う */
export const SKILL_LOOK: Readonly<Record<string, ThrownLook>> = {
  // 斧・戦鎚・大盾
  axeHatchet: AXE,
  axeStorm: AXE,
  hammerThrow: spin("hammer", SPIN_HEAVY),
  shieldThrow: spin("shield", SPIN_HEAVY),
  // チャクラム
  ringBladesThrow: RING_BLADES,
  ringBladesRebound: RING_BLADES,
  // 槍・鎖鎌・チェーンアレイ
  spearHurl: point("spear"),
  chainSickleWeight: spin("weight"),
  flailHurl: spin("ironBall", SPIN_HEAVY),
  // 双剣・鉈
  twinBladesCrossThrow: KNIFE_SPIN,
  cleaverThrow: spin("cleaver"),
  // 共通技
  commonKnifeFan: KNIFE,
  commonIceLance: point("iceSpear"),
  // 投擲
  thrownFan: KNIFE,
  thrownPoison: KNIFE,
  thrownRicochet: KNIFE_SPIN,
  thrownVolley: KNIFE,
  thrownPin: KNIFE,
  thrownDagger: KNIFE,
  thrownBola: spin("bola"),
  // 戦輪
  warRingThrow: WAR_RING,
  warRingRicochet: WAR_RING,
  warRingFan: WAR_RING,
  warRingEcho: WAR_RING,
  // スキル石「追い討ち」（短刀を 3 本投げる）
  rout: KNIFE,
};

/** スキル石「極意」の弾（武器種で形が変わる）。投げ散らし・乱れ輪 */
export const WEAPON_ART_LOOK: Readonly<Partial<Record<MovesetKey, ThrownLook>>> = {
  thrown: KNIFE,
  warRing: WAR_RING,
};

const WEAPON_ART_SKILL = "weaponArt";

/** スキル石「グレネード」の飛んでいる手榴弾 */
export const GRENADE_LOOK: ThrownLook = { sprite: GRENADE_SPRITE, motion: "spin", spin: SPIN_HEAVY };
/** 型替え符「投げ刃」で飛んでいる刃 */
export const THROWN_ECHO_LOOK: ThrownLook = KNIFE_SPIN;

/** プレイヤーの弾の見た目（奥義 → 弾の key の順）。敵の弾・表に無い弾は undefined */
export function projectileLook(pr: Projectile): ThrownLook | undefined {
  if (pr.owner !== "player") return undefined;
  const ult = ultimateShotOf(pr);
  const byUlt = ult ? ULTIMATE_LOOK[ult.key] : undefined;
  if (byUlt) return byUlt;
  const key = shotBulletOf(pr);
  return key === undefined ? undefined : BULLET_LOOK[key];
}

/** 技の弾の見た目（key は弾を出したスキルの CastParams.skillKey）。極意は今の武器種で引く */
export function skillShotLook(key: string, moveset: MovesetKey): ThrownLook | undefined {
  if (key === WEAPON_ART_SKILL) return WEAPON_ART_LOOK[moveset];
  return SKILL_LOOK[key];
}

/**
 * 描く角度。spin は時刻で回し（左へ飛ぶものは逆回し）、point は進む向き。
 * 速度 0 の弾（止まった瞬間）は右向き
 */
export function thrownAngle(look: ThrownLook, time: number, id: number, vel: Vec): number {
  if (look.motion === "point") return vel.x === 0 && vel.y === 0 ? 0 : Math.atan2(vel.y, vel.x);
  const dir = vel.x < 0 ? -1 : 1;
  return dir * (time * look.spin + id * SPIN_PHASE_PER_ID);
}

/** 弾の半径に合わせた拡大率（小さい弾は等倍で、絵を縮めない） */
export function thrownScale(radius: number): number {
  return Math.max(1, radius / LOOK_BASE_RADIUS);
}

/** 放物線の途中の位置（t は 0..1。見た目だけ持ち上げる） */
export function arcPoint(from: Vec, to: Vec, t: number, height: number): Vec {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * height };
}

/** 絵を中心に置いて回して描く。絵が無ければ（読み込み前・key 違い）false */
export function drawThrownLook(ctx: CanvasRenderingContext2D, atlas: SpriteAtlas, look: ThrownLook, x: number, y: number, angle: number, scale: number): boolean {
  const img = atlas[look.sprite]?.frames[0];
  if (!img) return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (scale !== 1) ctx.scale(scale, scale);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
  return true;
}

/** 飛んでいる自分の弾を武器の絵で描く（x, y は描く位置。曲射は持ち上げた位置）。描けたら true */
export function drawThrownProjectile(ctx: CanvasRenderingContext2D, state: GameState, atlas: SpriteAtlas, pr: Projectile, x: number, y: number): boolean {
  const look = projectileLook(pr);
  if (!look) return false;
  return drawThrownLook(ctx, atlas, look, x, y, thrownAngle(look, state.time, pr.id, pr.vel), thrownScale(pr.radius));
}

/**
 * 技の弾・飛んでいる手榴弾・投げ刃を武器の絵で描く（skillHud.ts の drawSkillAir の後に重ねる）。
 * 位置は skillHud と同じ式で出すので、手続きの点の上にちょうど重なる
 */
export function drawThrownSkillAir(ctx: CanvasRenderingContext2D, state: GameState, atlas: SpriteAtlas): void {
  const moveset = state.stats.moveset;
  for (const s of state.skills.shots) {
    const look = skillShotLook(s.params.skillKey, moveset);
    if (look) drawThrownLook(ctx, atlas, look, s.pos.x, s.pos.y, thrownAngle(look, state.time, s.id, s.vel), thrownScale(s.radius));
  }
  for (const g of state.skills.grenades) drawGrenadeFlight(ctx, state, atlas, g);
  for (const e of state.skills.echoes) drawThrownEcho(ctx, state, atlas, e);
}

function drawGrenadeFlight(ctx: CanvasRenderingContext2D, state: GameState, atlas: SpriteAtlas, g: Grenade): void {
  if (g.flight <= 0) return;
  const t = g.flightTotal > 0 ? 1 - g.flight / g.flightTotal : 1;
  const at = arcPoint(g.from, g.to, t, GRENADE_ARC_H);
  drawThrownLook(ctx, atlas, GRENADE_LOOK, at.x, at.y, thrownAngle(GRENADE_LOOK, state.time, g.id, { x: g.to.x - g.from.x, y: 0 }), 1);
}

function drawThrownEcho(ctx: CanvasRenderingContext2D, state: GameState, atlas: SpriteAtlas, e: EchoCast): void {
  if (e.kind !== "thrown") return;
  const t = e.total > 0 ? 1 - e.timer / e.total : 1;
  const from = state.player.body.pos;
  const at = arcPoint(from, e.origin, t, THROWN_ARC_H);
  // 投げ刃は id を持たないので、着弾点の座標で位相をずらす
  const phase = Math.round(e.origin.x + e.origin.y);
  drawThrownLook(ctx, atlas, THROWN_ECHO_LOOK, at.x, at.y, thrownAngle(THROWN_ECHO_LOOK, state.time, phase, { x: e.origin.x - from.x, y: 0 }), 1);
}
