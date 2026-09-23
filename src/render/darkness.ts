import type { GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { ENEMY_AI, FLOOR_KIND, REAPER, STATUS } from "../data/tuning";
import { hasStatus } from "../system/statusEffects";

/**
 * 暗闇フロアのマスク。プレイヤー周り（半径 darkLightRadius）だけ明るく、それ以外は黒で覆う。
 * 敵の弾と燃焼（燃えている敵・プレイヤーの炎）はマスクの上から発光として描き直す
 */

const FULL_CIRCLE = Math.PI * 2;
const GLOW_PAD = 4;
const GLOW_ALPHA = 0.55;
const CORE_ALPHA = 1;
const BURN_GLOW_RADIUS = 9;
const BURN_FLICKER_SPEED = 18;
const BURN_FLICKER_AMOUNT = 0.25;
const PLAYER_BURN_ALPHA = 0.35;
const COLOR_ENEMY_BULLET = "#ff6060";
/** 光の外から撃たれるレーザーと、壁抜けで迫る Reaper は暗闇でも見えるようにする（見えない即死級を作らない） */
const LASER_WINDUP_ALPHA = 0.35;
const LASER_WINDUP_WIDTH = 1;
const LASER_FIRE_ALPHA = 0.8;
const REAPER_GLOW_PAD = 6;
const LASER_EYE_KEY = "laserEye";

function buildHole(r: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const size = Math.ceil(r * 2);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(1 - FLOOR_KIND.darkFeather, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, FULL_CIRCLE);
  ctx.fill();
  return canvas;
}

export class DarknessLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  /** 光の穴（放射グラデーション）。半径は定数なので一度だけ作る */
  private readonly hole: HTMLCanvasElement;

  constructor(width: number, height: number) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.hole = buildHole(FLOOR_KIND.darkLightRadius);
  }

  /** ox, oy はワールド → 画面の平行移動量 */
  draw(target: CanvasRenderingContext2D, state: GameState, ox: number, oy: number): void {
    this.drawMask(state, ox, oy);
    target.globalAlpha = 1;
    target.drawImage(this.canvas, 0, 0);
    this.drawGlows(target, state, ox, oy);
  }

  private drawMask(state: GameState, ox: number, oy: number): void {
    const { ctx, canvas } = this;
    const px = state.player.body.pos.x + ox;
    const py = state.player.body.pos.y + oy;
    const r = FLOOR_KIND.darkLightRadius;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `rgba(0,0,0,${FLOOR_KIND.darkAlpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(this.hole, Math.round(px - r), Math.round(py - r));
    ctx.globalCompositeOperation = "source-over";
  }

  private drawGlows(target: CanvasRenderingContext2D, state: GameState, ox: number, oy: number): void {
    target.save();
    target.translate(ox, oy);
    target.globalCompositeOperation = "lighter";
    for (const pr of state.projectiles) {
      if (pr.owner !== "enemy") continue;
      this.glow(target, pr.pos.x, pr.pos.y, pr.radius + GLOW_PAD, COLOR_ENEMY_BULLET, GLOW_ALPHA);
      this.glow(target, pr.pos.x, pr.pos.y, pr.radius, COLOR_ENEMY_BULLET, CORE_ALPHA);
    }
    const flicker = 1 - BURN_FLICKER_AMOUNT + Math.sin(state.time * BURN_FLICKER_SPEED) * BURN_FLICKER_AMOUNT;
    for (const e of state.enemies) {
      if (e.hp <= 0 || !hasStatus(e.status, "burn")) continue;
      this.glow(target, e.body.pos.x, e.body.pos.y, BURN_GLOW_RADIUS, STATUS.burnColor, GLOW_ALPHA * flicker);
    }
    for (const h of state.hazards) {
      if (h.kind === "laser") this.beam(target, h.pos, h.to, h.radius * 2, LASER_FIRE_ALPHA);
    }
    // プレイヤーの炎は状態異常「燃焼」で持つ（旧 playerBurn ハザードの置き換え）
    const p = state.player;
    if (hasStatus(p.status, "burn")) {
      this.glow(target, p.body.pos.x, p.body.pos.y, BURN_GLOW_RADIUS, STATUS.burnColor, PLAYER_BURN_ALPHA * flicker);
    }
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.phase !== "windup" || e.defKey !== LASER_EYE_KEY || !e.ai) continue;
      this.beam(target, e.body.pos, e.ai.target, LASER_WINDUP_WIDTH, LASER_WINDUP_ALPHA);
    }
    const r = state.reaper;
    if (r) {
      this.glow(target, r.pos.x, r.pos.y, r.radius + REAPER_GLOW_PAD, REAPER.color, GLOW_ALPHA * flicker);
      this.glow(target, r.pos.x, r.pos.y, r.radius, REAPER.color, GLOW_ALPHA);
    }
    target.restore();
  }

  private beam(target: CanvasRenderingContext2D, from: Vec, to: Vec, width: number, alpha: number): void {
    target.globalAlpha = alpha;
    target.strokeStyle = ENEMY_AI.laser.color;
    target.lineWidth = width;
    target.beginPath();
    target.moveTo(from.x, from.y);
    target.lineTo(to.x, to.y);
    target.stroke();
  }

  private glow(target: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
    target.globalAlpha = alpha;
    target.fillStyle = color;
    target.beginPath();
    target.arc(x, y, r, 0, FULL_CIRCLE);
    target.fill();
  }
}
