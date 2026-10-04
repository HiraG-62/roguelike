/**
 * 投げた武器の見た目。説明に「投げる」とある技の弾を、その武器の絵（data/sprites/weapons.ts の thrownWeapon.*）で飛ばす。
 * 弾の key・奥義の key・スキル（技）の key から「どの絵を、回すか / 進む向きへ向けるか」を引く表と、その描画。
 * state は読むだけ。回る角度は state.time と弾の id から決め、state.rng は使わない。
 * 武器の絵が付く弾は武器の絵が本体で、弾の専用スプライト（fxShots.ts）はその下の風切りの軌跡として重なる
 */
import type { GameState, Projectile } from "../core/state";
import type { Vec } from "../core/vec";
import { type MovesetKey, bulletArtKey } from "../data/weapons";
import { type ThrownShape, thrownSpriteKey } from "../data/sprites/weapons";
import type { EchoCast } from "../skills/types";
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
  /** 回る向きを進む向きで替えない（弧で行って戻る輪。折り返しや縦の弧で左右が入れ替わっても逆回しにならない） */
  readonly steady?: true;
  /**
   * 手に持つ武器の絵（プレイヤーの武器のアトラスのシート。例 `wpnRingBlades.held`）をそのまま回して飛ばす。
   * シートの印 muzzle（投げた物の中心）を弾の位置に合わせ、回す角は方向ごとに焼いたフレームで出す。読めていなければ sprite へ落ちる
   */
  readonly held?: string;
  /** この半径（px）までは等倍（無ければ LOOK_BASE_RADIUS）。弾の大きさに合わせて大きく描いた絵（大手裏剣）が拡大で粗くならないように */
  readonly baseRadius?: number;
}

/** 軽い物（輪・短刀・鉈）の回転 */
const SPIN_FAST = 16;
/** 重い物（斧・鎚・盾・鉄球）の回転。重さが伝わるように少し遅い */
const SPIN_HEAVY = 11;
/** 弾ごとに回転の位相をずらす（同時に投げた扇の刃が揃って回って見えないように） */
const SPIN_PHASE_PER_ID = 0.9;
/** この半径（px）までは等倍。大きい弾（断頭輪など）は半径に合わせて拡大する */
const LOOK_BASE_RADIUS = 4;
/** 投げる刃の放物線の高さ（px）。skillHud.ts の手続きの描画もこれを使い、同じ位置に重ねて描く */
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
// 戦輪は手に持つ輪の絵のまま飛ばす（docs/ideas/gun-bases-review.md 0-5「飛ぶ輪は手に持っている絵のまま」）
const RING_BLADES: ThrownLook = { ...spin("ringBlades"), steady: true, held: "wpnRingBlades.held" };
const KUNAI = point("kunai");
const SHURIKEN = spin("shuriken");
/** 大手裏剣の絵（論理 20px）が等倍になる弾の半径。連撃の 3 段目（半径 5）は等倍、大車輪（半径 10）は 2 倍 */
const BIG_SHURIKEN_BASE_RADIUS = 5;
const BIG_SHURIKEN: ThrownLook = { ...spin("bigShuriken"), baseRadius: BIG_SHURIKEN_BASE_RADIUS };

/**
 * 弾の key（BulletDef.key。右レーンの弾の段は `art.<段の key>`、銃の家系の左はベースの key）→ 見た目。
 * 派生の弾（二丁投げ・重ね輪・離れ投げ …）も同じ弾の key を撃つのでここで拾える。振りが撃つ弾は `cast.<cast の key>`
 */
export const BULLET_LOOK: Readonly<Record<string, ThrownLook>> = {
  // 斧の右「投擲」（と派生の二丁投げ）
  "art.axeThrow": AXE,
  // 戦輪の左（器の輪刃・牙輪）と、右の近投げ・強化投げ
  ringBlades: RING_BLADES,
  fangRings: RING_BLADES,
  "cast.ringToss": RING_BLADES,
  "cast.ringHurl": RING_BLADES,
  // クナイの左
  kunai: KUNAI,
  // 手裏剣の左右（3 段目は大手裏剣）
  "cast.starToss": SHURIKEN,
  "cast.starToss2": SHURIKEN,
  "cast.starFan": SHURIKEN,
  "cast.starFan2": SHURIKEN,
  "cast.bigStar": BIG_SHURIKEN,
};

/** 奥義の key（`<武器種>.<id>`）→ 見た目。弾の key より優先する（大投擲は斧の投擲の弾で斧を投げる） */
export const ULTIMATE_LOOK: Readonly<Record<string, ThrownLook>> = {
  "axe.greatThrow": AXE,
  "ringBlades.headsman": RING_BLADES,
  "ringBlades.ringDance": RING_BLADES,
  "kunai.shadowStitch": KUNAI,
  "shuriken.eightfold": SHURIKEN,
  "shuriken.greatWheel": BIG_SHURIKEN,
};

/** 技・スキル石の key（CastParams.skillKey）→ 見た目。武器種に依らず同じ絵を飛ばすもの。技の弾（state.skills.shots）に使う */
export const SKILL_LOOK: Readonly<Record<string, ThrownLook>> = {
  // 共通技（投げる物が決まっている）
  commonKnifeFan: KNIFE,
  commonIceLance: point("iceSpear"),
  commonVenomDart: KNIFE,
  // スキル石「追い討ち」（短刀を 3 本投げる）
  rout: KNIFE,
};

/**
 * 装備の武器を投げる技（段取り 7c で武器技を束ねた共通技。跳弾は斧・盾・輪、気弾は分銅・短刀・戦輪 …）。
 * 絵は今の武器種で引き（MOVESET_THROWN_LOOK）、投げる絵を持たない武器種（剣・銃など）はふつうの弾のまま
 */
export const THROWN_ART_KEYS: ReadonlySet<string> = new Set(["commonRicochet", "commonKiBlast"]);

/** 武器種 → 投げたときの武器の絵（投げる技と、旧 武器技の絵を引き継ぐ） */
export const MOVESET_THROWN_LOOK: Readonly<Partial<Record<MovesetKey, ThrownLook>>> = {
  axe: AXE,
  hammer: spin("hammer", SPIN_HEAVY),
  shield: spin("shield", SPIN_HEAVY),
  ringBlades: RING_BLADES,
  spear: point("spear"),
  chainSickle: spin("weight"),
  flail: spin("ironBall", SPIN_HEAVY),
  twinBlades: KNIFE_SPIN,
  cleaver: spin("cleaver"),
  kunai: KUNAI,
  shuriken: SHURIKEN,
};

/** 型替え符「照準起点」で近接が飛ばす刃 */
export const THROWN_ECHO_LOOK: ThrownLook = KNIFE_SPIN;

/** プレイヤーの弾の見た目（奥義 → 弾の key の順）。敵の弾・表に無い弾は undefined */
export function projectileLook(pr: Projectile): ThrownLook | undefined {
  if (pr.owner !== "player") return undefined;
  const ult = ultimateShotOf(pr);
  const byUlt = ult ? ULTIMATE_LOOK[ult.key] : undefined;
  if (byUlt) return byUlt;
  const key = shotBulletOf(pr);
  return key === undefined ? undefined : BULLET_LOOK[bulletArtKey(key)];
}

/** 技の弾の見た目（key は弾を出したスキルの CastParams.skillKey）。武器を投げる技は今の武器種で引く */
export function skillShotLook(key: string, moveset: MovesetKey): ThrownLook | undefined {
  if (THROWN_ART_KEYS.has(key)) return MOVESET_THROWN_LOOK[moveset];
  return SKILL_LOOK[key];
}

/**
 * 描く角度。spin は時刻で回し（左へ飛ぶものは逆回し。steady は向きによらず同じ向きに回す）、point は進む向き。
 * 速度 0 の弾（止まった瞬間）は右向き
 */
export function thrownAngle(look: ThrownLook, time: number, id: number, vel: Vec): number {
  if (look.motion === "point") return vel.x === 0 && vel.y === 0 ? 0 : Math.atan2(vel.y, vel.x);
  const dir = look.steady === true || vel.x >= 0 ? 1 : -1;
  return dir * (time * look.spin + id * SPIN_PHASE_PER_ID);
}

/** 弾の半径に合わせた拡大率（小さい弾は等倍で、絵を縮めない）。base は絵ごとの等倍の半径（ThrownLook.baseRadius） */
export function thrownScale(radius: number, base = LOOK_BASE_RADIUS): number {
  return Math.max(1, radius / base);
}

/** 放物線の途中の位置（t は 0..1。見た目だけ持ち上げる） */
export function arcPoint(from: Vec, to: Vec, t: number, height: number): Vec {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * height };
}

/** 絵を中心に置いて回して描く。絵が無ければ（読み込み前・key 違い）false */
export function drawThrownLook(ctx: CanvasRenderingContext2D, atlas: SpriteAtlas, look: ThrownLook, x: number, y: number, angle: number, scale: number): boolean {
  const sprite = atlas[look.sprite];
  const img = sprite?.frames[0];
  if (!sprite || !img) return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (scale !== 1) ctx.scale(scale, scale);
  // 論理寸法（sprite.w / h）で描く。img.width（ドット数）で描くと、密度 2 の絵が 2 倍の大きさになる
  ctx.drawImage(img, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
  ctx.restore();
  return true;
}

/** 飛んでいる自分の弾を武器の絵で描く（x, y は描く位置。曲射は持ち上げた位置）。描けたら true */
export function drawThrownProjectile(ctx: CanvasRenderingContext2D, state: GameState, atlas: SpriteAtlas, pr: Projectile, x: number, y: number): boolean {
  const look = projectileLook(pr);
  if (!look) return false;
  return drawThrownLook(ctx, atlas, look, x, y, thrownAngle(look, state.time, pr.id, pr.vel), thrownScale(pr.radius, look.baseRadius));
}

/**
 * 技の弾・投げる刃を武器の絵で描く（skillHud.ts の drawSkillAir の後に重ねる）。
 * 位置は skillHud と同じ式で出すので、手続きの点の上にちょうど重なる
 */
export function drawThrownSkillAir(ctx: CanvasRenderingContext2D, state: GameState, atlas: SpriteAtlas): void {
  const moveset = state.stats.moveset;
  for (const s of state.skills.shots) {
    const look = skillShotLook(s.params.skillKey, moveset);
    if (look) drawThrownLook(ctx, atlas, look, s.pos.x, s.pos.y, thrownAngle(look, state.time, s.id, s.vel), thrownScale(s.radius, look.baseRadius));
  }
  for (const e of state.skills.echoes) drawThrownEcho(ctx, state, atlas, e);
}

function drawThrownEcho(ctx: CanvasRenderingContext2D, state: GameState, atlas: SpriteAtlas, e: EchoCast): void {
  if (e.kind !== "thrown") return;
  const t = e.total > 0 ? 1 - e.timer / e.total : 1;
  const from = state.player.body.pos;
  const at = arcPoint(from, e.origin, t, THROWN_ARC_H);
  // 投げる刃は id を持たないので、着弾点の座標で位相をずらす
  const phase = Math.round(e.origin.x + e.origin.y);
  drawThrownLook(ctx, atlas, THROWN_ECHO_LOOK, at.x, at.y, thrownAngle(THROWN_ECHO_LOOK, state.time, phase, { x: e.origin.x - from.x, y: 0 }), 1);
}

/** 手に持つ絵のセルを置く矩形（論理 px）。印 pivot（原点からのドット）を (x, y) に合わせ、scale 倍で描く */
export function heldThrownRect(
  cell: Readonly<{ w: number; h: number; ox: number; oy: number }>,
  pivot: Readonly<{ x: number; y: number }>,
  x: number,
  y: number,
  dotsPerPx: number,
  scale: number,
): { x: number; y: number; w: number; h: number } {
  const k = scale / dotsPerPx;
  return { x: x - (cell.ox + pivot.x) * k, y: y - (cell.oy + pivot.y) * k, w: cell.w * k, h: cell.h * k };
}
