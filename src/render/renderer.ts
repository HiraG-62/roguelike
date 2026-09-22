import { VIEW_H, VIEW_W } from "../core/view";
import type { Enemy, GameState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { PLAYER } from "../data/tuning";
import { TILE_SIZE, Tile, getTile, toIndex } from "../map/grid";
import { comboMultiplier } from "../system/combat";
import { isAttacking, isDashing, meleeBox } from "../system/player";
import { type Sprite, type SpriteAtlas, buildAtlas, getSprite } from "./sprites";

const FONT_SMALL = "bold 8px monospace";
const FONT_MED = "bold 12px monospace";
const FONT_BIG = "bold 20px monospace";

const COLOR_HP = "#e04848";
const COLOR_HP_BG = "#3a1010";
const COLOR_ENERGY = "#f8d848";
const COLOR_ENERGY_BG = "#3a3010";
const COLOR_ENERGY_READY = "#ffffff";
const COLOR_TEXT = "#e0e0e0";
const COLOR_TELEGRAPH = "#ff4040";
const COLOR_SLASH = "#ffffff";
const COLOR_LOCK = "#ff8080";

/** 歩行アニメの切替間隔（秒） */
const WALK_FRAME_TIME = 0.12;
const ENEMY_FRAME_TIME = 0.3;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlas: SpriteAtlas;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.atlas = buildAtlas();
    this.fitToWindow();
    window.addEventListener("resize", () => this.fitToWindow());
  }

  /** 整数倍で拡大してドットを崩さない */
  private fitToWindow(): void {
    const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H)));
    this.canvas.style.width = `${VIEW_W * scale}px`;
    this.canvas.style.height = `${VIEW_H * scale}px`;
  }

  render(state: GameState, aimScreen: { x: number; y: number } | null = null): void {
    const { ctx } = this;
    ctx.fillStyle = "#08080c";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    const cam = state.camera;
    const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
    const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);

    ctx.save();
    ctx.translate(ox, oy);
    this.drawTiles(state, -ox, -oy);
    this.drawPickups(state);
    this.drawEnemies(state);
    this.drawProjectiles(state);
    this.drawPlayer(state);
    this.drawParticles(state);
    this.drawTexts(state);
    ctx.restore();

    this.drawOverlays(state);
    this.drawHud(state);
    if (aimScreen && state.status === "playing") this.drawCrosshair(aimScreen.x, aimScreen.y);
    if (state.status === "dead") this.drawDeath(state);
  }

  private drawCrosshair(x: number, y: number): void {
    const { ctx } = this;
    const cx = Math.round(x);
    const cy = Math.round(y);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cx, cy, 1, 1);
    ctx.globalAlpha = 1;
  }

  private drawTiles(state: GameState, viewX: number, viewY: number): void {
    const { map } = state;
    const x0 = Math.max(0, Math.floor(viewX / TILE_SIZE));
    const y0 = Math.max(0, Math.floor(viewY / TILE_SIZE));
    const x1 = Math.min(map.width - 1, Math.ceil((viewX + VIEW_W) / TILE_SIZE));
    const y1 = Math.min(map.height - 1, Math.ceil((viewY + VIEW_H) / TILE_SIZE));
    const floor = getSprite(this.atlas, "floor");
    const wall = getSprite(this.atlas, "wall");
    const stairs = getSprite(this.atlas, "stairs");
    const door = getSprite(this.atlas, "door");

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = getTile(map, x, y);
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        if (tile === Tile.Wall) {
          // 床に接している壁だけ描く（内部の壁は真っ暗のまま）
          if (this.touchesFloor(state, x, y)) this.blit(wall, 0, px, py);
          continue;
        }
        const variant = (x * 7 + y * 13) % floor.frames.length;
        this.blit(floor, variant, px, py);
        if (tile === Tile.StairsDown) this.blit(stairs, 0, px, py);
        if (state.lockedTiles.has(toIndex(map, x, y))) this.blit(door, 0, px, py);
      }
    }
  }

  private touchesFloor(state: GameState, x: number, y: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (getTile(state.map, x + dx, y + dy) !== Tile.Wall) return true;
      }
    }
    return false;
  }

  private blit(sprite: Sprite, frame: number, x: number, y: number, flip = false, white = false): void {
    const img = (white ? sprite.white : sprite.frames)[frame % sprite.frames.length];
    if (!img) return;
    const { ctx } = this;
    if (!flip) {
      ctx.drawImage(img, Math.round(x), Math.round(y));
      return;
    }
    ctx.save();
    ctx.translate(Math.round(x) + sprite.w, Math.round(y));
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  private drawPickups(state: GameState): void {
    const heart = getSprite(this.atlas, "heart");
    for (const pk of state.pickups) {
      const bob = Math.sin(pk.bobTime * 4) * 2;
      this.blit(heart, 0, pk.pos.x - heart.w / 2, pk.pos.y - heart.h / 2 + bob);
    }
  }

  private drawEnemies(state: GameState): void {
    for (const e of state.enemies) this.drawEnemy(state, e);
  }

  private drawEnemy(state: GameState, e: Enemy): void {
    const { ctx } = this;
    const def = enemyDef(e.defKey);
    const sprite = getSprite(this.atlas, def.sprite);
    const frame = Math.floor(e.animTime / ENEMY_FRAME_TIME);
    let x = e.body.pos.x - sprite.w / 2;
    let y = e.body.pos.y - sprite.h / 2;

    if (e.phase === "spawning") {
      // 出現予告リング
      const t = 1 - e.phaseTimer / 0.7;
      ctx.strokeStyle = COLOR_TELEGRAPH;
      ctx.globalAlpha = 0.4 + t * 0.6;
      ctx.beginPath();
      ctx.arc(e.body.pos.x, e.body.pos.y, 10 * (1 - t) + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    if (e.phase === "windup") {
      // 予備動作: 小刻みに震える + 赤いマーク
      x += (state.rng.next() - 0.5) * 2;
      y += (state.rng.next() - 0.5) * 2;
      ctx.fillStyle = COLOR_TELEGRAPH;
      ctx.font = FONT_SMALL;
      ctx.textAlign = "center";
      ctx.fillText("!", e.body.pos.x, e.body.pos.y - sprite.h / 2 - 2);
      if (def.behavior === "charger") {
        // 突進方向の予告線
        ctx.strokeStyle = COLOR_TELEGRAPH;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(e.body.pos.x, e.body.pos.y);
        ctx.lineTo(e.body.pos.x + e.strikeDir.x * 120, e.body.pos.y + e.strikeDir.y * 120);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    const flip = e.facing.x < 0;
    const white = e.hitFlash > 0;
    this.blit(sprite, frame, x, y, flip, white);

    if (e.phase === "stagger") {
      ctx.fillStyle = COLOR_ENERGY;
      ctx.font = FONT_SMALL;
      ctx.textAlign = "center";
      ctx.fillText("*", e.body.pos.x, e.body.pos.y - sprite.h / 2 - 2);
    }
    if (e.hp < e.maxHp) this.drawBar(e.body.pos.x - 8, e.body.pos.y + sprite.h / 2 - 2, 16, 2, e.hp / e.maxHp, COLOR_HP, COLOR_HP_BG);
  }

  private drawProjectiles(state: GameState): void {
    const { ctx } = this;
    for (const pr of state.projectiles) {
      ctx.fillStyle = pr.color;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(pr.pos.x, pr.pos.y, pr.radius + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(pr.pos.x, pr.pos.y, pr.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPlayer(state: GameState): void {
    const { ctx } = this;
    const p = state.player;
    if (state.status === "dead") return;
    this.drawAimGuide(state);
    const sprite = getSprite(this.atlas, "player");
    const moving = p.body.vel.x !== 0 || p.body.vel.y !== 0;
    const frame = moving ? Math.floor(p.walkTime / WALK_FRAME_TIME) : 0;
    const flip = p.facing.x < 0;
    // 被弾無敵中は点滅（ダッシュ無敵は点滅させない）
    const blink = p.invulnTimer > 0 && !isDashing(p) && p.hitFlash <= 0 && state.tick % 6 < 3;
    if (!blink) {
      const squash = isDashing(p) ? 1 : 1;
      ctx.save();
      ctx.translate(Math.round(p.body.pos.x), Math.round(p.body.pos.y));
      ctx.scale(squash, 1);
      this.blit(sprite, frame, -sprite.w / 2, -sprite.h / 2 - 2, flip, p.hitFlash > 0);
      ctx.restore();
    }

    if (isAttacking(p) && p.attack.phase === "active") {
      const step = PLAYER.melee[p.attack.combo];
      if (step) {
        const box = meleeBox(p, step.reach, step.size);
        this.drawSlash(box.x + box.w / 2, box.y + box.h / 2, step.size / 2, p.attack.dir, p.attack.combo);
      }
    }
  }

  /** 向いている方向を示す小さな三角。マウス照準の手応え用 */
  private drawAimGuide(state: GameState): void {
    const { ctx } = this;
    const p = state.player;
    const d = p.facing;
    const base = { x: p.body.pos.x + d.x * 11, y: p.body.pos.y + d.y * 11 };
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(base.x + d.x * 3, base.y + d.y * 3);
    ctx.lineTo(base.x - d.y * 2, base.y + d.x * 2);
    ctx.lineTo(base.x + d.y * 2, base.y - d.x * 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** 斬撃の弧。矩形判定の中心に、向きに合わせた円弧を描く */
  private drawSlash(cx: number, cy: number, r: number, dir: { x: number; y: number }, combo: number): void {
    const { ctx } = this;
    const a = Math.atan2(dir.y, dir.x);
    const spread = combo === 2 ? Math.PI * 0.9 : Math.PI * 0.6;
    ctx.strokeStyle = COLOR_SLASH;
    ctx.lineWidth = combo === 2 ? 3 : 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a - spread / 2, a + spread / 2);
    ctx.stroke();
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.6, a - spread / 2, a + spread / 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  private drawParticles(state: GameState): void {
    const { ctx } = this;
    for (const p of state.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      const s = p.size;
      ctx.fillRect(Math.round(p.pos.x - s / 2), Math.round(p.pos.y - s / 2), Math.ceil(s), Math.ceil(s));
    }
    ctx.globalAlpha = 1;
  }

  private drawTexts(state: GameState): void {
    const { ctx } = this;
    ctx.textAlign = "center";
    for (const t of state.texts) {
      const fade = Math.min(1, (t.life / t.maxLife) * 2);
      ctx.globalAlpha = fade;
      ctx.font = `bold ${Math.round(8 * t.scale)}px monospace`;
      ctx.fillStyle = "#000000";
      ctx.fillText(t.text, Math.round(t.pos.x) + 1, Math.round(t.pos.y) + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, Math.round(t.pos.x), Math.round(t.pos.y));
    }
    ctx.globalAlpha = 1;
  }

  private drawOverlays(state: GameState): void {
    const { ctx } = this;
    if (state.slowmo > 0 && state.status === "playing") {
      ctx.fillStyle = "#2040a0";
      ctx.globalAlpha = 0.18;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (state.flash > 0) {
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = state.flash * 0.6;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    const p = state.player;
    if (p.hp <= p.maxHp * 0.3 && state.status === "playing") {
      // 瀕死ビネット
      const pulse = 0.15 + Math.sin(state.time * 6) * 0.08;
      const grad = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.4, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.8);
      grad.addColorStop(0, "rgba(200,0,0,0)");
      grad.addColorStop(1, `rgba(200,0,0,${pulse})`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(state: GameState): void {
    const { ctx } = this;
    const p = state.player;
    ctx.textAlign = "left";

    this.drawBar(8, 8, 100, 6, p.hp / p.maxHp, COLOR_HP, COLOR_HP_BG);
    ctx.font = FONT_SMALL;
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(`${p.hp}/${p.maxHp}`, 112, 14);

    const ready = p.energy >= p.maxEnergy;
    const energyColor = ready && state.tick % 20 < 10 ? COLOR_ENERGY_READY : COLOR_ENERGY;
    this.drawBar(8, 17, 100, 4, p.energy / p.maxEnergy, energyColor, COLOR_ENERGY_BG);
    if (ready) ctx.fillText("F: BURST", 112, 22);

    ctx.textAlign = "right";
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(`DEPTH ${state.depth}`, VIEW_W - 8, 14);
    ctx.fillText(`SCORE ${state.score}`, VIEW_W - 8, 24);
    ctx.fillStyle = "#808080";
    ctx.fillText(`seed ${state.seedText}`, VIEW_W - 8, 34);

    if (state.combo.count > 1) {
      const pop = 1 + state.combo.popTimer * 3;
      ctx.textAlign = "center";
      ctx.font = `bold ${Math.round(14 * pop)}px monospace`;
      const fading = state.combo.timer < 0.6;
      ctx.fillStyle = fading && state.tick % 8 < 4 ? "#808080" : COLOR_ENERGY;
      ctx.fillText(`${state.combo.count} HIT`, VIEW_W / 2, 22);
      ctx.font = FONT_SMALL;
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillText(`x${comboMultiplier(state.combo.count).toFixed(1)}`, VIEW_W / 2, 32);
    }

    const locked = state.rooms.some((r) => r.locked);
    if (locked) {
      ctx.textAlign = "center";
      ctx.font = FONT_SMALL;
      ctx.fillStyle = COLOR_LOCK;
      ctx.fillText("- ROOM LOCKED -", VIEW_W / 2, VIEW_H - 8);
    }

    const last = state.log[state.log.length - 1];
    if (last && state.time - last.time < 4) {
      ctx.textAlign = "left";
      ctx.font = FONT_SMALL;
      ctx.fillStyle = last.color;
      ctx.fillText(last.text, 8, VIEW_H - 8);
    }
  }

  private drawBar(x: number, y: number, w: number, h: number, ratio: number, color: string, bg: string): void {
    const { ctx } = this;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, ratio))), h);
  }

  private drawDeath(state: GameState): void {
    const { ctx } = this;
    const alpha = Math.min(0.75, state.deathTimer * 0.8);
    ctx.fillStyle = "#000000";
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
    if (state.deathTimer < 0.6) return;
    ctx.textAlign = "center";
    ctx.font = FONT_BIG;
    ctx.fillStyle = COLOR_HP;
    ctx.fillText("YOU DIED", VIEW_W / 2, VIEW_H / 2 - 24);
    ctx.font = FONT_MED;
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(`depth ${state.depth}  ·  ${state.kills} kills  ·  best combo ${state.combo.best}`, VIEW_W / 2, VIEW_H / 2);
    ctx.fillText(`score ${state.score}`, VIEW_W / 2, VIEW_H / 2 + 16);
    ctx.font = FONT_SMALL;
    ctx.fillStyle = "#a0a0a0";
    ctx.fillText("Enter: retry same seed   R: new seed", VIEW_W / 2, VIEW_H / 2 + 40);
  }
}
