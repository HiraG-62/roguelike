import { VIEW_H, VIEW_W, screenToWorld } from "../core/view";
import type { Enemy, GameState, Hazard, Player, RoomKind, RoomState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { BOSS, ELITE, ENEMY_AI, REAPER, ROOM, ROOM_KIND, STATUS } from "../data/tuning";
import { bossEnemy } from "../system/boss";
import { ELITE_COLOR, eliteDisplayName, shieldLeft } from "../system/elites";
import { shockwaveRadius } from "../system/hazards";
import { reaperTimeLeft, reaperWarning } from "../system/reaper";
import { isKeystoneKey, keystoneConflicts, keystoneDef } from "../loot/affixes";
import { RARITY_COLOR, SLOTS, type Rarity } from "../loot/types";
import { TILE_SIZE, Tile, getTile, toIndex } from "../map/grid";
import { comboMultiplier } from "../system/combat";
import { isAttacking, isDashing, meleeBox, meleeStep } from "../system/player";
import { floorVariant, pulse, wallStyle } from "./renderMath";
import { type Sprite, type SpriteAtlas, TintCache, buildAtlas, getSprite, spriteFrame } from "./sprites";
import { FLOOR_KIND_LABEL, isDark } from "../system/roomTypes";
import { DarknessLayer } from "./darkness";
import { Minimap, type RoomLookup, buildRoomLookup } from "./minimap";

const FONT_SMALL = "bold 8px monospace";
const FONT_MED = "bold 12px monospace";
const FONT_BIG = "bold 20px monospace";

const COLOR_BG = "#08080c";
const COLOR_HP = "#e04848";
const COLOR_HP_BG = "#3a1010";
const COLOR_ENERGY = "#f8d848";
const COLOR_ENERGY_BG = "#3a3010";
const COLOR_ENERGY_READY = "#ffffff";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_TELEGRAPH = "#ff4040";
const COLOR_LOCK = "#ff8080";
const COLOR_WHITE = "#ffffff";
const COLOR_BLACK = "#000000";
const COLOR_KEYSTONE = "#d08cff";
const COLOR_WARN = "#ff6060";
const COLOR_DOOR_EDGE = "#ff3030";
const COLOR_SLOWMO = "#2040a0";
const COLOR_DESAT = "#808080";
const COLOR_AURA_DAMAGE = "#ff6040";
const COLOR_AURA_SPEED = "#60e0ff";
const COLOR_AURA_INVULN = "#ffe080";

/** スプライトキー */
const SPR = {
  player: "player",
  floor: "floor",
  wallTop: "wallTop",
  wallFace: "wallFace",
  stairs: "stairs",
  stairsGlow: "stairsGlow",
  door: "door",
  shadow: "shadow",
  heart: "heart",
  heartSmall: "heartSmall",
  bullet: "bullet",
  enemyBullet: "enemyBullet",
  itemDiamond: "itemDiamond",
  crosshair: "crosshair",
  spawnRing: "spawnRing",
  bomb: "bomb",
  laserBeam: "laserBeam",
  shieldIcon: "shieldIcon",
  eliteAura: "eliteAura",
  wisp: "wisp",
} as const;
const SLASH_KEYS = ["slash1", "slash2", "slash3"] as const;
/** 浮遊する敵（影を離して描き、上下に揺らす） */
const FLOATING_SPRITES: ReadonlySet<string> = new Set(["eye", "laserEye", "bat", "wisp"]);

/** 追加敵・ボス・地面攻撃 */
const ELITE_AURA_FRAME_TIME = 0.18;
const ELITE_AURA_DROP = 5;
const ELITE_BAR_H = 3;
const ELITE_NAME_OFFSET = 6;
const COLOR_SHIELD_BAR = "#60a0ff";
const SHIELD_ICON_OFFSET = 7;
const SHIELD_ICON_ALPHA = 0.9;
const SHIELD_FRAME_TIME = 0.2;
const LINK_ALPHA_MIN = 0.25;
const LINK_ALPHA_MAX = 0.7;
const LINK_SPEED = 5;
const LASER_THIN_ALPHA = 0.5;
const LASER_THICK_W = 3;
const LASER_FRAME_TIME = 0.05;
const BOMB_FRAME_TIME_SLOW = 0.3;
const BOMB_FRAME_TIME_FAST = 0.08;
/** 残り時間がこの割合を切ったら点滅を速める */
const BOMB_FAST_RATIO = 0.35;
const BOMB_CIRCLE_ALPHA = 0.25;
const BOMB_FILL_ALPHA = 0.18;
const SHOCKWAVE_ALPHA = 0.85;
const GOLEM_TELEGRAPH_ALPHA = 0.3;
const LANDING_ALPHA = 0.45;
const LANDING_MIN_SCALE = 0.35;
const LANDING_MAX_SCALE = 1.6;
const KING_JUMP_HEIGHT = 40;
const BONE_WALL_COLOR = "#e8e0c8";
const BONE_WALL_EDGE = "#8a8068";
/** ボスのスプライトフレーム: kingSlime = 通常/潰れ/伸び/ジャンプ準備、boneLord = 待機2/杖を掲げる2 */
const KING_FRAME = { idle: 0, squash: 1, stretch: 2, crouch: 3 } as const;
const BONE_FRAME_RAISE = 2;
const BONE_IDLE_FRAMES = 2;
const BOSS_BAR_W = 240;
const BOSS_BAR_H = 6;
const BOSS_BAR_Y = 50;
const BOSS_BANNER_Y = 90;
const COLOR_BOSS_BAR = "#c02828";
const COLOR_BOSS_BAR_BG = "#300808";
const COLOR_BOSS_NAME = "#ffd0d0";
const COLOR_BOSS_BANNER = "#ff4040";
const REAPER_SCALE = 2;
const REAPER_ALPHA_MIN = 0.55;
const REAPER_ALPHA_MAX = 0.9;
const REAPER_PULSE_SPEED = 4;
/** 右上 HUD の文字はミニマップの下に並べる（Minimap.bottom からの相対） */
const HUD_RIGHT_GAP = 10;
const HUD_RIGHT_LINE = 10;
const HUD_RIGHT_X_PAD = 8;
const HUD_REAPER_LINE = 3;
const HUD_CURSED_LINE = 4;
const REAPER_TINT = 0.7;
const BOSS_BANNER_FADE = 0.5;
const BOSS_BANNER_NAME_GAP = 16;
const ELITE_BAR_W = 20;
const SHIELD_BAR_H = 2;
/** boss.ts の STAGE_TWO と同じ（フェーズ 2） */
const KING_STAGE_TWO = 2;
const SHOCKWAVE_SPENT_ALPHA = 0.4;
const LANDING_RX = 0.5;
const LANDING_RY = 0.3;
const LANDING_RING_FADE = 0.6;

/** タイル */
const STAIRS_GLOW_SPEED = 3;
const STAIRS_GLOW_MIN = 0.35;
const STAIRS_GLOW_MAX = 0.85;
const STAIRS_GLOW_FRAME_TIME = 0.4;
const DOOR_EDGE_SPEED = 8;
const DOOR_EDGE_MIN = 0.25;
const DOOR_EDGE_MAX = 0.95;

/** 影 */
const SHADOW_ALPHA = 0.35;
const SHADOW_SMALL = 0.6;
const FLOAT_SHADOW_DROP = 4;
const FLOAT_BOB_SPEED = 4;
const FLOAT_BOB_AMOUNT = 1.5;

/** 床アイテムの光柱 */
const LOOT_PILLAR_HEIGHT = 24;
const LOOT_PILLAR_WIDTH = 3;
const LOOT_PILLAR_ALPHA = 0.5;
const LOOT_WOBBLE_SPEED = 5;
const LOOT_WOBBLE_AMOUNT = 0.15;
const LOOT_BOB_SPEED = 3;
const LOOT_BOB_AMOUNT = 1.5;
const LOOT_TINT_STRENGTH = 0.6;
const LOOT_LABEL_OFFSET = 4;
const SPARKLE_COUNT = 3;
const SPARKLE_SPEED = 1.7;
const SPARKLE_SPREAD_X = 6;
const SPARKLE_RISE = 16;
const SPARKLE_PHASE_STEP = 2.1;
const SPARKLE_BLINK = 3;
const SPARKLE_RARITIES: ReadonlySet<Rarity> = new Set<Rarity>(["rare", "unique"]);
const PICKUP_BOB_SPEED = 4;
const PICKUP_BOB_AMOUNT = 2;

/** 状態異常・被弾 */
const CHILL_TINT_ALPHA = 0.4;
const BURN_TINT_ALPHA = 0.35;
const BURN_FLICKER_SPEED = 20;
const SQUASH_X = 1.15;
const SQUASH_Y = 0.85;
const DASH_STRETCH_X = 1.2;
const DASH_STRETCH_Y = 0.85;
const DASH_GHOSTS = 2;
const DASH_GHOST_SPACING = 6;
const DASH_GHOST_ALPHA = 0.35;
/** windup の震え（決定性のためゲーム rng は使わない） */
const WINDUP_JITTER_SPEED = 60;
const WINDUP_JITTER_Y_RATIO = 1.3;
const WINDUP_BLINK_SPEED = 30;
const WINDUP_RED_ALPHA = 0.55;
const CHARGER_LINE_LEN = 120;
const CHARGER_LINE_ALPHA = 0.35;
const STAGGER_TILT = 0.25;
const STAGGER_WOBBLE_SPEED = 14;
const SPAWN_RING_GROW = 1;
const SPAWN_RING_MIN_ALPHA = 0.4;

/** 斬撃 */
const SLASH_MIN_ALPHA = 0.3;
const SLASH_AFTERIMAGE_T = 0.6;
const SLASH_AFTERIMAGE_ROT = -0.35;
const SLASH_AFTERIMAGE_ALPHA = 0.6;

/** 弾 */
const TRAIL_POINTS = 3;
const TRAIL_SPACING = 3;
const TRAIL_ALPHA = 0.5;
const BULLET_TINT_STRENGTH = 0.5;
const COLOR_PLAYER_BULLET_DEFAULT = "#a0e0ff";
/** enemyBullet スプライトの色に揃える */
const COLOR_ENEMY_TRAIL = "#e04848";

/** オーラ */
const AURA_RX = 11;
const AURA_RY = 13;
const AURA_SPEED = 6;
const AURA_MIN = 0.12;
const AURA_MAX = 0.3;
const AURA_ORBIT_DOTS = 4;
const AURA_ORBIT_SPEED = 3;

/** 画面全体 */
const VIGNETTE_ALPHA = 0.45;
const VIGNETTE_INNER = 0.35;
const VIGNETTE_OUTER = 0.85;
const LOW_HP_RATIO = 0.3;
const LOW_HP_SPEED = 6;
const LOW_HP_MIN = 0.4;
const LOW_HP_MAX = 1;
const EDGE_THICKNESS = 24;
const JUST_EDGE_FADE = 0.3;
const JUST_EDGE_SPEED = 10;
const LOCK_EDGE_SPEED = 4;
const LOCK_EDGE_MIN = 0.25;
const LOCK_EDGE_MAX = 0.6;
const SLOWMO_DESAT_ALPHA = 0.5;
const SLOWMO_TINT_ALPHA = 0.14;
const FLASH_WHITE_ALPHA = 0.6;
const FLASH_RED_ALPHA = 0.55;
const COLOR_FLASH_RED = "#ff2020";

/** 部屋の種類 */
const FOUNTAIN_STONE = "#50607a";
const FOUNTAIN_WATER = "#60c0ff";
const FOUNTAIN_DRY = "#3a4450";
const FOUNTAIN_INSET = 2;
const FOUNTAIN_WATER_INSET = 4;
const FOUNTAIN_SPEED = 3;
const FOUNTAIN_MIN = 0.55;
const FOUNTAIN_MAX = 1;
const FOUNTAIN_GLOW_R = 14;
const FOUNTAIN_GLOW_ALPHA = 0.18;
const AMBUSH_SHADE_ALPHA = 0.16;
const DOOR_MARK_SIZE = 4;
const DOOR_MARK_SPEED = 3;
const DOOR_MARK_MIN = 0.45;
const DOOR_MARK_MAX = 0.95;
/** 扉の手前に出す床マークの色。normal / ambush は出さない */
const DOOR_MARK_COLOR: Readonly<Partial<Record<RoomKind, string>>> = {
  treasure: ROOM_KIND.treasureCoinColor,
  challenge: ROOM_KIND.challengeColor,
  shrine: ROOM_KIND.shrineColor,
};

/** HUD */
const HUD_X = 8;
const HUD_HP_Y = 8;
const HUD_BAR_X = HUD_X + 10;
const HUD_BAR_W = 100;
const HUD_HP_H = 6;
const HUD_ENERGY_Y = 17;
const HUD_ENERGY_H = 4;
const HUD_TEXT_X = HUD_BAR_X + HUD_BAR_W + 4;
const HUD_PIP_Y = 24;
const HUD_KEYSTONE_Y = 36;
const HUD_WARN_Y = 45;
const HUD_BLINK_TICKS = 20;
const DASH_PIP_SIZE = 5;
const DASH_PIP_H = 3;
const DASH_PIP_GAP = 2;
const COLOR_DASH_PIP = "#80c0ff";
const COLOR_DASH_PIP_EMPTY = "#203040";
const COLOR_DASH_PIP_EDGE = "#406080";

/** クロスヘアの敵ホバー判定の余白 */
const CROSSHAIR_HOVER_MARGIN = 4;

/** 歩行アニメの切替間隔（秒） */
const WALK_FRAME_TIME = 0.12;
const ENEMY_FRAME_TIME = 0.15;
const PLAYER_SPRITE_LIFT = 2;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  return { canvas, ctx };
}

/** 中心は透明、外周に向かって rgb が濃くなる */
function buildVignette(rgb: string, maxAlpha: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(VIEW_W, VIEW_H);
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;
  const grad = ctx.createRadialGradient(cx, cy, VIEW_H * VIGNETTE_INNER, cx, cy, VIEW_W * VIGNETTE_OUTER * 0.6);
  grad.addColorStop(0, `rgba(${rgb},0)`);
  grad.addColorStop(1, `rgba(${rgb},${maxAlpha})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  return canvas;
}

/** 画面の四辺から内側へ減衰する帯 */
function buildEdgeGlow(rgb: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(VIEW_W, VIEW_H);
  const t = EDGE_THICKNESS;
  const solid = `rgba(${rgb},1)`;
  const clear = `rgba(${rgb},0)`;
  const edges: [number, number, number, number, number, number, number, number][] = [
    [0, 0, 0, t, 0, 0, VIEW_W, t],
    [0, VIEW_H, 0, VIEW_H - t, 0, VIEW_H - t, VIEW_W, t],
    [0, 0, t, 0, 0, 0, t, VIEW_H],
    [VIEW_W, 0, VIEW_W - t, 0, VIEW_W - t, 0, t, VIEW_H],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, solid);
    grad.addColorStop(1, clear);
    ctx.fillStyle = grad;
    ctx.fillRect(rx, ry, rw, rh);
  }
  return canvas;
}

function buildPillar(color: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(LOOT_PILLAR_WIDTH, LOOT_PILLAR_HEIGHT);
  const grad = ctx.createLinearGradient(0, 0, 0, LOOT_PILLAR_HEIGHT);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, LOOT_PILLAR_WIDTH, LOOT_PILLAR_HEIGHT);
  return canvas;
}

function pick<T>(arr: readonly T[], i: number): T | undefined {
  return arr[i % arr.length];
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly atlas: SpriteAtlas;
  private readonly tints = new TintCache();
  private readonly vignette: HTMLCanvasElement;
  private readonly lowHpVignette: HTMLCanvasElement;
  private readonly edgeBlue: HTMLCanvasElement;
  private readonly edgeRed: HTMLCanvasElement;
  private readonly pillars = new Map<string, HTMLCanvasElement>();
  /** 階段の光は隣のタイルに被るので、タイル描画の後にまとめて描く */
  private readonly stairsBuf: number[] = [];
  /** HUD のキーストーン表示（装備が変わったときだけ作り直す） */
  private hudKeyCache = "";
  private hudKeystoneText = "";
  private hudConflictText = "";
  private readonly minimap = new Minimap();
  private readonly darkness = new DarknessLayer(VIEW_W, VIEW_H);
  /** 部屋のタイル所属表（フロアが変わったときだけ作り直す） */
  private lookup: RoomLookup | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.atlas = buildAtlas();
    this.vignette = buildVignette("0,0,0", VIGNETTE_ALPHA);
    this.lowHpVignette = buildVignette("200,0,0", 0.3);
    this.edgeBlue = buildEdgeGlow("80,160,255");
    this.edgeRed = buildEdgeGlow("255,40,40");
    this.fitToWindow();
    window.addEventListener("resize", () => this.fitToWindow());
  }

  /** 整数倍で拡大してドットを崩さない */
  private fitToWindow(): void {
    const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H)));
    this.canvas.style.width = `${VIEW_W * scale}px`;
    this.canvas.style.height = `${VIEW_H * scale}px`;
  }

  /** オーバーレイ UI（装備画面など）が同じ描画先に描くための公開 */
  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  render(state: GameState, aimScreen: { x: number; y: number } | null = null): void {
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (this.lookup?.map !== state.map) this.lookup = buildRoomLookup(state);
    const cam = state.camera;
    const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
    const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);

    ctx.save();
    ctx.translate(ox, oy);
    this.drawTiles(state, -ox, -oy);
    this.drawPickups(state);
    this.drawFloorItems(state);
    this.drawGroundHazards(state);
    this.drawLinks(state);
    this.drawEnemies(state);
    this.drawProjectiles(state);
    this.drawLasers(state);
    this.drawPlayer(state);
    this.drawReaper(state);
    this.drawShapes(state);
    this.drawParticles(state);
    this.drawTexts(state);
    ctx.restore();

    if (isDark(state)) this.darkness.draw(ctx, state, ox, oy);
    this.drawOverlays(state);
    this.drawHud(state);
    if (aimScreen && state.status === "playing") this.drawCrosshair(state, aimScreen.x, aimScreen.y);
    if (state.status === "dead") this.drawDeath(state);
  }

  // ---------------------------------------------------------------------------
  // 描画プリミティブ
  // ---------------------------------------------------------------------------

  private sprite(key: string): Sprite {
    return getSprite(this.atlas, key);
  }

  private tinted(key: string, color: string, strength = 1): HTMLCanvasElement[] {
    return this.tints.get(this.sprite(key), key, color, strength);
  }

  private blit(sprite: Sprite, frame: number, x: number, y: number): void {
    const img = pick(sprite.frames, frame);
    if (img) this.ctx.drawImage(img, Math.round(x), Math.round(y));
  }

  /**
   * 足元 (cx, bottom) を基準に拡縮・回転・反転して描く。変形が無ければ save/restore を使わない。
   */
  private drawAnchored(
    img: HTMLCanvasElement | undefined,
    cx: number,
    bottom: number,
    sx = 1,
    sy = 1,
    rot = 0,
    flip = false,
  ): void {
    if (!img) return;
    const { ctx } = this;
    if (sx === 1 && sy === 1 && rot === 0 && !flip) {
      ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(bottom - img.height));
      return;
    }
    ctx.save();
    ctx.translate(Math.round(cx), Math.round(bottom));
    if (rot !== 0) ctx.rotate(rot);
    ctx.scale(flip ? -sx : sx, sy);
    ctx.drawImage(img, -img.width / 2, -img.height);
    ctx.restore();
  }

  /** 中心基準で回転・拡大して描く */
  private drawRotated(img: HTMLCanvasElement | undefined, cx: number, cy: number, rot: number, scale: number): void {
    if (!img) return;
    const { ctx } = this;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }

  private drawShadow(cx: number, cy: number, scale = 1): void {
    const img = this.sprite(SPR.shadow).frames[0];
    if (!img) return;
    const w = Math.round(img.width * scale);
    const h = Math.max(2, Math.round(img.height * scale));
    const { ctx } = this;
    ctx.globalAlpha = SHADOW_ALPHA;
    ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // タイル
  // ---------------------------------------------------------------------------

  private drawTiles(state: GameState, viewX: number, viewY: number): void {
    const { map } = state;
    const { ctx } = this;
    const x0 = Math.max(0, Math.floor(viewX / TILE_SIZE));
    const y0 = Math.max(0, Math.floor(viewY / TILE_SIZE));
    const x1 = Math.min(map.width - 1, Math.ceil((viewX + VIEW_W) / TILE_SIZE));
    const y1 = Math.min(map.height - 1, Math.ceil((viewY + VIEW_H) / TILE_SIZE));
    const floor = this.sprite(SPR.floor);
    const wallFace = this.sprite(SPR.wallFace);
    const wallTop = this.sprite(SPR.wallTop);
    const stairs = this.sprite(SPR.stairs);
    const door = this.sprite(SPR.door);
    const doorEdgeAlpha = pulse(state.time, DOOR_EDGE_SPEED, DOOR_EDGE_MIN, DOOR_EDGE_MAX);
    this.stairsBuf.length = 0;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = getTile(map, x, y);
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        if (tile === Tile.Wall) {
          const style = wallStyle(map, x, y);
          if (style === "face") this.blit(wallFace, 0, px, py);
          else if (style === "top") this.blit(wallTop, 0, px, py);
          continue;
        }
        this.blit(floor, floorVariant(x, y, floor.frames.length), px, py);
        this.drawRoomFloor(state, toIndex(map, x, y), tile, px, py);
        if (tile === Tile.StairsDown) {
          this.blit(stairs, 0, px, py);
          this.stairsBuf.push(px, py);
        }
        if (state.lockedTiles.has(toIndex(map, x, y))) {
          this.blit(door, 0, px, py);
          ctx.globalAlpha = doorEdgeAlpha;
          ctx.strokeStyle = COLOR_DOOR_EDGE;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
          ctx.globalAlpha = 1;
        }
      }
    }
    this.drawStairsGlow(state);
  }

  /** 部屋の種類ごとの床表現: 伏兵の暗い床、泉、扉の手前のマーク */
  private drawRoomFloor(state: GameState, index: number, tile: Tile, px: number, py: number): void {
    const lookup = this.lookup;
    if (!lookup) return;
    const room = state.rooms[lookup.roomOf[index] ?? -1];
    if (room?.kind === "ambush" && !room.cleared && !room.locked) {
      this.ctx.globalAlpha = AMBUSH_SHADE_ALPHA;
      this.ctx.fillStyle = COLOR_BLACK;
      this.ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      this.ctx.globalAlpha = 1;
    }
    if (tile === Tile.Fountain) this.drawFountain(state, room, px, py);
    const doorRoom = lookup.doorOf.get(index);
    if (doorRoom !== undefined) this.drawDoorMark(state, state.rooms[doorRoom], px, py);
  }

  private drawFountain(state: GameState, room: RoomState | undefined, px: number, py: number): void {
    const { ctx } = this;
    const used = room?.used ?? false;
    const inner = TILE_SIZE - FOUNTAIN_INSET * 2;
    ctx.fillStyle = FOUNTAIN_STONE;
    ctx.fillRect(px + FOUNTAIN_INSET, py + FOUNTAIN_INSET, inner, inner);
    const water = TILE_SIZE - FOUNTAIN_WATER_INSET * 2;
    const glow = pulse(state.time, FOUNTAIN_SPEED, FOUNTAIN_MIN, FOUNTAIN_MAX);
    ctx.globalAlpha = used ? 1 : glow;
    ctx.fillStyle = used ? FOUNTAIN_DRY : FOUNTAIN_WATER;
    ctx.fillRect(px + FOUNTAIN_WATER_INSET, py + FOUNTAIN_WATER_INSET, water, water);
    if (!used) {
      ctx.globalAlpha = FOUNTAIN_GLOW_ALPHA * glow;
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, FOUNTAIN_GLOW_R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** 特別な部屋の入口に小さな菱形。用が済んだら消す */
  private drawDoorMark(state: GameState, room: RoomState | undefined, px: number, py: number): void {
    if (!room || room.locked) return;
    const color = DOOR_MARK_COLOR[room.kind];
    if (!color) return;
    const done = room.kind === "shrine" ? room.used : room.cleared;
    if (done) return;
    const { ctx } = this;
    const cx = px + TILE_SIZE / 2;
    const cy = py + TILE_SIZE / 2;
    const h = DOOR_MARK_SIZE / 2;
    ctx.globalAlpha = pulse(state.time, DOOR_MARK_SPEED, DOOR_MARK_MIN, DOOR_MARK_MAX);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + h, cy);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - h, cy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawStairsGlow(state: GameState): void {
    if (this.stairsBuf.length === 0) return;
    const glow = this.sprite(SPR.stairsGlow);
    const img = pick(glow.frames, spriteFrame(glow, state.time, STAIRS_GLOW_FRAME_TIME));
    if (!img) return;
    const { ctx } = this;
    ctx.globalAlpha = pulse(state.time, STAIRS_GLOW_SPEED, STAIRS_GLOW_MIN, STAIRS_GLOW_MAX);
    const half = TILE_SIZE / 2;
    for (let i = 0; i < this.stairsBuf.length; i += 2) {
      const cx = (this.stairsBuf[i] ?? 0) + half;
      const cy = (this.stairsBuf[i + 1] ?? 0) + half;
      ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy - img.height / 2));
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // 拾えるもの
  // ---------------------------------------------------------------------------

  private drawPickups(state: GameState): void {
    const heart = this.sprite(SPR.heart);
    for (const pk of state.pickups) {
      const bob = Math.sin(pk.bobTime * PICKUP_BOB_SPEED) * PICKUP_BOB_AMOUNT;
      this.drawShadow(pk.pos.x, pk.pos.y + heart.h / 2, SHADOW_SMALL);
      this.blit(heart, 0, pk.pos.x - heart.w / 2, pk.pos.y - heart.h / 2 + bob);
    }
  }

  private pillar(color: string): HTMLCanvasElement {
    const hit = this.pillars.get(color);
    if (hit) return hit;
    const made = buildPillar(color);
    this.pillars.set(color, made);
    return made;
  }

  /** レアリティ色の光柱 + 色付き菱形 + 名前（magic 以上）+ rare/unique のきらめき */
  private drawFloorItems(state: GameState): void {
    const { ctx } = this;
    const diamond = this.sprite(SPR.itemDiamond);
    for (const fi of state.floorItems) {
      const { rarity } = fi.item;
      const color = RARITY_COLOR[rarity];
      const x = Math.round(fi.pos.x);
      const y = Math.round(fi.pos.y);
      const wobble = 1 + Math.sin(fi.bobTime * LOOT_WOBBLE_SPEED) * LOOT_WOBBLE_AMOUNT;
      const h = Math.round(LOOT_PILLAR_HEIGHT * wobble);
      const bob = Math.round(Math.sin(fi.bobTime * LOOT_BOB_SPEED) * LOOT_BOB_AMOUNT);

      this.drawShadow(x, y + diamond.h / 2, SHADOW_SMALL);
      ctx.globalAlpha = LOOT_PILLAR_ALPHA * wobble;
      ctx.drawImage(this.pillar(color), x - Math.floor(LOOT_PILLAR_WIDTH / 2), y - h, LOOT_PILLAR_WIDTH, h);
      ctx.globalAlpha = 1;
      const img = this.tinted(SPR.itemDiamond, color, LOOT_TINT_STRENGTH)[0];
      if (img) ctx.drawImage(img, x - Math.floor(img.width / 2), y - Math.floor(img.height / 2) + bob);

      if (SPARKLE_RARITIES.has(rarity)) this.drawSparkles(x, y, fi.bobTime, color);
    }
    this.drawFloorItemLabels(state);
  }

  /** 時間ベースの疑似粒子。上へ昇りながら明滅する十字 */
  private drawSparkles(x: number, y: number, time: number, color: string): void {
    const { ctx } = this;
    ctx.fillStyle = color;
    for (let i = 0; i < SPARKLE_COUNT; i++) {
      const phase = time * SPARKLE_SPEED + i * SPARKLE_PHASE_STEP;
      const rise = (phase * SPARKLE_RISE) % SPARKLE_RISE;
      const sx = Math.round(x + Math.sin(phase * 1.3 + i) * SPARKLE_SPREAD_X);
      const sy = Math.round(y - 2 - rise);
      ctx.globalAlpha = Math.max(0, Math.sin(phase * SPARKLE_BLINK)) * (1 - rise / SPARKLE_RISE);
      ctx.fillRect(sx - 1, sy, 3, 1);
      ctx.fillRect(sx, sy - 1, 1, 3);
    }
    ctx.globalAlpha = 1;
  }

  /** ラベルはまとめて描き、font / align の切替を 1 回にする */
  private drawFloorItemLabels(state: GameState): void {
    const { ctx } = this;
    ctx.textAlign = "center";
    ctx.font = FONT_SMALL;
    for (const fi of state.floorItems) {
      if (fi.item.rarity === "normal") continue;
      const x = Math.round(fi.pos.x);
      const wobble = 1 + Math.sin(fi.bobTime * LOOT_WOBBLE_SPEED) * LOOT_WOBBLE_AMOUNT;
      const ly = Math.round(fi.pos.y - LOOT_PILLAR_HEIGHT * wobble - LOOT_LABEL_OFFSET);
      ctx.fillStyle = COLOR_BLACK;
      ctx.fillText(fi.item.name, x + 1, ly + 1);
      ctx.fillStyle = RARITY_COLOR[fi.item.rarity];
      ctx.fillText(fi.item.name, x, ly);
    }
  }

  // ---------------------------------------------------------------------------
  // 演出図形・粒子・文字
  // ---------------------------------------------------------------------------

  /** 衝撃波リングと連鎖雷 */
  private drawShapes(state: GameState): void {
    const { ctx } = this;
    for (const s of state.shapes) {
      const t = Math.max(0, s.life / s.maxLife);
      ctx.globalAlpha = t;
      ctx.strokeStyle = s.color;
      if (s.kind === "ring") {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.pos.x, s.pos.y, s.radius * (1 - t * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.pos.x, s.pos.y);
        // 中間点を少しずらしてギザギザに
        const mx = (s.pos.x + s.to.x) / 2 + Math.sin(s.life * 90) * 4;
        const my = (s.pos.y + s.to.y) / 2 + Math.cos(s.life * 90) * 4;
        ctx.lineTo(mx, my);
        ctx.lineTo(s.to.x, s.to.y);
        ctx.stroke();
      }
    }
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
      ctx.fillStyle = COLOR_BLACK;
      ctx.fillText(t.text, Math.round(t.pos.x) + 1, Math.round(t.pos.y) + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, Math.round(t.pos.x), Math.round(t.pos.y));
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // 敵
  // ---------------------------------------------------------------------------

  private drawEnemies(state: GameState): void {
    for (const e of state.enemies) this.drawEnemy(state, e);
  }

  private drawEnemy(state: GameState, e: Enemy): void {
    const { ctx } = this;
    const def = enemyDef(e.defKey);
    const key = def.sprite;
    const sprite = this.sprite(key);
    const cx = e.body.pos.x;
    const cy = e.body.pos.y;

    if (e.phase === "spawning") {
      this.drawSpawnRing(cx, cy, e.phaseTimer);
      return;
    }

    const floating = FLOATING_SPRITES.has(key);
    const feetY = cy + sprite.h / 2;
    const shadowScale = Math.max(1, sprite.w / TILE_SIZE);
    this.drawShadow(cx, feetY + (floating ? FLOAT_SHADOW_DROP : -1), shadowScale);
    if (e.elite) this.drawEliteAura(state, e, cx, feetY);

    const frame = this.enemyFrame(e, sprite);
    let x = cx;
    let bottom = feetY - this.jumpLift(e);
    if (floating) bottom += Math.sin(e.animTime * FLOAT_BOB_SPEED + e.id) * FLOAT_BOB_AMOUNT;
    if (e.phase === "windup") {
      x += Math.sin(state.time * WINDUP_JITTER_SPEED + e.id);
      bottom += Math.cos(state.time * WINDUP_JITTER_SPEED * WINDUP_JITTER_Y_RATIO + e.id);
    }
    const flip = e.facing.x < 0;
    const hit = e.hitFlash > 0;
    const sx = hit ? SQUASH_X : 1;
    const sy = hit ? SQUASH_Y : 1;
    const rot =
      e.phase === "stagger"
        ? (flip ? STAGGER_TILT : -STAGGER_TILT) * (0.7 + 0.3 * Math.sin(state.time * STAGGER_WOBBLE_SPEED))
        : 0;

    const base = hit ? sprite.white : sprite.frames;
    this.drawAnchored(pick(base, frame), x, bottom, sx, sy, rot, flip);

    // 状態の重ね描き（同じ変形のシルエットを半透明で）
    if (e.phase === "windup" && Math.sin(state.time * WINDUP_BLINK_SPEED) > 0) {
      ctx.globalAlpha = WINDUP_RED_ALPHA;
      this.drawAnchored(pick(this.tinted(key, COLOR_TELEGRAPH), frame), x, bottom, sx, sy, rot, flip);
    }
    if (e.effects.chill.time > 0) {
      ctx.globalAlpha = CHILL_TINT_ALPHA;
      this.drawAnchored(pick(this.tinted(key, STATUS.chillColor), frame), x, bottom, sx, sy, rot, flip);
    }
    if (e.effects.burn.time > 0) {
      ctx.globalAlpha = BURN_TINT_ALPHA * (0.6 + 0.4 * Math.sin(state.time * BURN_FLICKER_SPEED + e.id));
      this.drawAnchored(pick(this.tinted(key, STATUS.burnColor), frame), x, bottom, sx, sy, rot, flip);
    }
    ctx.globalAlpha = 1;
    if (def.behavior === "knight") this.drawKnightShield(state, e, cx, cy);

    const top = cy - sprite.h / 2 - 2;
    if (e.phase === "windup") {
      ctx.fillStyle = COLOR_TELEGRAPH;
      ctx.font = FONT_SMALL;
      ctx.textAlign = "center";
      ctx.fillText("!", cx, top);
      if (def.behavior === "charger") this.drawChargeLine(e);
      if (def.behavior === "laser") this.drawLaserTelegraph(e, def.windup);
      if (def.behavior === "golem") this.drawRingTelegraph(cx, cy, ENEMY_AI.golem.ringRadius);
    }
    if (e.phase === "stagger") {
      ctx.fillStyle = COLOR_ENERGY;
      ctx.font = FONT_SMALL;
      ctx.textAlign = "center";
      ctx.fillText("*", cx, top);
    }
    if (def.boss) return;
    if (e.elite) {
      this.drawEliteBars(e, cx, cy + sprite.h / 2 - 2);
      this.drawEliteName(e, cx, top - ELITE_NAME_OFFSET);
      return;
    }
    if (e.hp < e.maxHp) this.drawBar(cx - 8, cy + sprite.h / 2 - 2, 16, 2, e.hp / e.maxHp, COLOR_HP, COLOR_HP_BG);
  }

  /** ボスは行動に合わせてフレームを選ぶ。他は時間で回す */
  private enemyFrame(e: Enemy, sprite: Sprite): number {
    const def = enemyDef(e.defKey);
    if (def.behavior === "kingSlime") {
      if (e.phase === "windup") return KING_FRAME.crouch;
      if (e.phase === "strike") return KING_FRAME.stretch;
      if (e.phase === "recover") return KING_FRAME.squash;
      return Math.floor(e.animTime / (ENEMY_FRAME_TIME * 2)) % 2 === 0 ? KING_FRAME.idle : KING_FRAME.squash;
    }
    if (def.behavior === "boneLord") {
      const raise = e.phase === "windup" || e.phase === "strike";
      const sub = Math.floor(e.animTime / ENEMY_FRAME_TIME) % BONE_IDLE_FRAMES;
      return (raise ? BONE_FRAME_RAISE : 0) + sub;
    }
    return spriteFrame(sprite, e.animTime, ENEMY_FRAME_TIME);
  }

  /** King Slime の跳躍中の高さ */
  private jumpLift(e: Enemy): number {
    if (e.defKey !== "kingSlime" || e.phase !== "strike") return 0;
    const total = e.ai?.stage === KING_STAGE_TWO ? BOSS.kingSlime.phase2JumpTime : BOSS.kingSlime.jumpTime;
    const t = Math.min(1, Math.max(0, 1 - e.phaseTimer / total));
    return Math.sin(t * Math.PI) * KING_JUMP_HEIGHT;
  }

  private drawEliteAura(state: GameState, e: Enemy, cx: number, feetY: number): void {
    if (!e.elite) return;
    const aura = this.sprite(SPR.eliteAura);
    const frames = this.tinted(SPR.eliteAura, ELITE_COLOR[e.elite]);
    const frame = spriteFrame(aura, state.time + e.id, ELITE_AURA_FRAME_TIME);
    this.ctx.globalAlpha = ELITE.auraAlpha;
    this.drawAnchored(pick(frames, frame), cx, feetY + ELITE_AURA_DROP);
    this.ctx.globalAlpha = 1;
  }

  /** エリートは太い HP バーを常に出す。シールドは青で上に重ねる */
  private drawEliteBars(e: Enemy, cx: number, y: number): void {
    const w = ELITE_BAR_W;
    const shield = shieldLeft(e);
    const base = e.maxHp - (e.shieldMax ?? 0);
    this.drawBar(cx - w / 2, y, w, ELITE_BAR_H, Math.min(e.hp, base) / base, COLOR_HP, COLOR_HP_BG);
    if (shield <= 0 || !e.shieldMax) return;
    const { ctx } = this;
    ctx.fillStyle = COLOR_SHIELD_BAR;
    ctx.fillRect(Math.round(cx - w / 2), y - SHIELD_BAR_H, Math.round(w * (shield / e.shieldMax)), SHIELD_BAR_H);
  }

  private drawEliteName(e: Enemy, cx: number, y: number): void {
    if (!e.elite) return;
    const { ctx } = this;
    const name = eliteDisplayName(e);
    ctx.font = FONT_SMALL;
    ctx.textAlign = "center";
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillText(name, Math.round(cx) + 1, Math.round(y) + 1);
    ctx.fillStyle = ELITE_COLOR[e.elite];
    ctx.fillText(name, Math.round(cx), Math.round(y));
  }

  /** 盾を正面に構える。怯み中は下ろす */
  private drawKnightShield(state: GameState, e: Enemy, cx: number, cy: number): void {
    if (e.phase === "stagger") return;
    const icon = this.sprite(SPR.shieldIcon);
    const img = pick(icon.frames, spriteFrame(icon, state.time, SHIELD_FRAME_TIME));
    if (!img) return;
    const sx = cx + e.facing.x * SHIELD_ICON_OFFSET;
    const sy = cy + e.facing.y * SHIELD_ICON_OFFSET;
    this.ctx.globalAlpha = SHIELD_ICON_ALPHA;
    this.ctx.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height / 2));
    this.ctx.globalAlpha = 1;
  }

  /** レーザーのチャージ: 前半は細い予告線、後半は太い赤線 */
  private drawLaserTelegraph(e: Enemy, windup: number): void {
    const target = e.ai?.target;
    if (!target) return;
    const { ctx } = this;
    const t = windup > 0 ? 1 - e.phaseTimer / windup : 1;
    const thick = t >= ENEMY_AI.laser.thinRatio;
    ctx.strokeStyle = ENEMY_AI.laser.color;
    ctx.globalAlpha = thick ? 1 : LASER_THIN_ALPHA;
    ctx.lineWidth = thick ? LASER_THICK_W : 1;
    ctx.beginPath();
    ctx.moveTo(e.body.pos.x, e.body.pos.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  private drawRingTelegraph(cx: number, cy: number, radius: number): void {
    const { ctx } = this;
    ctx.strokeStyle = COLOR_TELEGRAPH;
    ctx.globalAlpha = GOLEM_TELEGRAPH_ALPHA;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** 同じ部屋の Linked を線で結ぶ */
  private drawLinks(state: GameState): void {
    const linked = state.enemies.filter((e) => e.elite === "linked" && e.hp > 0 && e.phase !== "spawning");
    if (linked.length < 2) return;
    const { ctx } = this;
    ctx.strokeStyle = ELITE.linkColor;
    ctx.globalAlpha = pulse(state.time, LINK_SPEED, LINK_ALPHA_MIN, LINK_ALPHA_MAX);
    ctx.beginPath();
    for (let i = 0; i < linked.length; i++) {
      const a = linked[i];
      if (!a) continue;
      for (let j = i + 1; j < linked.length; j++) {
        const b = linked[j];
        if (!b || b.roomIndex !== a.roomIndex) continue;
        ctx.moveTo(a.body.pos.x, a.body.pos.y);
        ctx.lineTo(b.body.pos.x, b.body.pos.y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // 地面の攻撃（爆弾・衝撃波・着地予告・骨の壁）とレーザー
  // ---------------------------------------------------------------------------

  private drawGroundHazards(state: GameState): void {
    for (const h of state.hazards) {
      switch (h.kind) {
        case "bomb":
          this.drawBomb(state, h);
          break;
        case "shockwave":
          this.drawShockwave(h);
          break;
        case "landing":
          this.drawLanding(h);
          break;
        case "boneWall":
          this.drawBoneWall(h);
          break;
        default:
          break;
      }
    }
  }

  /** 赤い予告円（残り時間で内側が満ちる）+ 点滅する爆弾 */
  private drawBomb(state: GameState, h: Hazard): void {
    const { ctx } = this;
    const t = h.maxTime > 0 ? 1 - h.time / h.maxTime : 1;
    ctx.fillStyle = ENEMY_AI.bomber.color;
    ctx.globalAlpha = BOMB_FILL_ALPHA;
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, h.radius * t, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ENEMY_AI.bomber.color;
    ctx.globalAlpha = BOMB_CIRCLE_ALPHA + t * (1 - BOMB_CIRCLE_ALPHA);
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, h.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const bomb = this.sprite(SPR.bomb);
    const fast = h.time < h.maxTime * BOMB_FAST_RATIO;
    const frame = spriteFrame(bomb, state.time, fast ? BOMB_FRAME_TIME_FAST : BOMB_FRAME_TIME_SLOW);
    this.blit(bomb, frame, h.pos.x - bomb.w / 2, h.pos.y - bomb.h / 2);
  }

  /** 広がる衝撃波の縁（判定のある幅で描く） */
  private drawShockwave(h: Hazard): void {
    const { ctx } = this;
    const r = shockwaveRadius(h);
    ctx.strokeStyle = ENEMY_AI.golem.color;
    ctx.globalAlpha = SHOCKWAVE_ALPHA * (h.spent ? SHOCKWAVE_SPENT_ALPHA : 1);
    ctx.lineWidth = ENEMY_AI.golem.ringThickness;
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, Math.max(1, r), 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }

  /** 着地予告: 最終半径の赤い輪 + 縮んでいく影 */
  private drawLanding(h: Hazard): void {
    const { ctx } = this;
    const t = h.maxTime > 0 ? h.time / h.maxTime : 0;
    const scale = LANDING_MIN_SCALE + (LANDING_MAX_SCALE - LANDING_MIN_SCALE) * t;
    ctx.fillStyle = COLOR_BLACK;
    ctx.globalAlpha = LANDING_ALPHA;
    ctx.beginPath();
    ctx.ellipse(h.pos.x, h.pos.y, h.radius * scale * LANDING_RX, h.radius * scale * LANDING_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLOR_TELEGRAPH;
    ctx.globalAlpha = 1 - t * LANDING_RING_FADE;
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, h.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawBoneWall(h: Hazard): void {
    const { ctx } = this;
    const half = TILE_SIZE / 2;
    const x = Math.round(h.pos.x - half);
    const y = Math.round(h.pos.y - half);
    ctx.fillStyle = BONE_WALL_EDGE;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = BONE_WALL_COLOR;
    ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    ctx.fillStyle = BONE_WALL_EDGE;
    ctx.fillRect(x + 4, y + half - 1, TILE_SIZE - 8, 2);
  }

  /** レーザー: laserBeam スプライトを線分に沿って並べる */
  private drawLasers(state: GameState): void {
    const beam = this.sprite(SPR.laserBeam);
    const { ctx } = this;
    for (const h of state.hazards) {
      if (h.kind !== "laser") continue;
      const dx = h.to.x - h.pos.x;
      const dy = h.to.y - h.pos.y;
      const len = Math.hypot(dx, dy);
      if (len <= 0) continue;
      const img = pick(beam.frames, spriteFrame(beam, state.time, LASER_FRAME_TIME));
      if (!img) continue;
      ctx.save();
      ctx.translate(h.pos.x, h.pos.y);
      ctx.rotate(Math.atan2(dy, dx));
      for (let d = 0; d < len; d += beam.w) {
        const w = Math.min(beam.w, len - d);
        ctx.drawImage(img, 0, 0, w, beam.h, d, -beam.h / 2, w, beam.h);
      }
      ctx.restore();
    }
  }

  /** 追跡者: 大きな紫の wisp。半透明で脈打つ */
  private drawReaper(state: GameState): void {
    const r = state.reaper;
    if (!r) return;
    const wisp = this.sprite(SPR.wisp);
    const frames = this.tinted(SPR.wisp, REAPER.color, REAPER_TINT);
    const img = pick(frames, spriteFrame(wisp, r.animTime, ENEMY_FRAME_TIME));
    this.ctx.globalAlpha = pulse(state.time, REAPER_PULSE_SPEED, REAPER_ALPHA_MIN, REAPER_ALPHA_MAX);
    const bob = Math.sin(r.animTime * FLOAT_BOB_SPEED) * FLOAT_BOB_AMOUNT;
    this.drawRotated(img, r.pos.x, r.pos.y + bob, 0, REAPER_SCALE);
    this.ctx.globalAlpha = 1;
  }


  /** 突進方向の予告線 */
  private drawChargeLine(e: Enemy): void {
    const { ctx } = this;
    ctx.strokeStyle = COLOR_TELEGRAPH;
    ctx.globalAlpha = CHARGER_LINE_ALPHA;
    ctx.beginPath();
    ctx.moveTo(e.body.pos.x, e.body.pos.y);
    ctx.lineTo(e.body.pos.x + e.strikeDir.x * CHARGER_LINE_LEN, e.body.pos.y + e.strikeDir.y * CHARGER_LINE_LEN);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** 出現予告: 収縮しながら濃くなる魔法陣 */
  private drawSpawnRing(cx: number, cy: number, phaseTimer: number): void {
    const ring = this.sprite(SPR.spawnRing);
    const t = Math.min(1, Math.max(0, 1 - phaseTimer / ROOM.spawnTelegraph));
    const frame = Math.min(ring.frames.length - 1, Math.floor(t * ring.frames.length));
    const { ctx } = this;
    ctx.globalAlpha = SPAWN_RING_MIN_ALPHA + t * (1 - SPAWN_RING_MIN_ALPHA);
    this.drawRotated(pick(ring.frames, frame), cx, cy, 0, 1 + (1 - t) * SPAWN_RING_GROW);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // 弾
  // ---------------------------------------------------------------------------

  private drawProjectiles(state: GameState): void {
    const { ctx } = this;
    for (const pr of state.projectiles) {
      const speed = Math.hypot(pr.vel.x, pr.vel.y);
      const dx = speed > 0 ? pr.vel.x / speed : 1;
      const dy = speed > 0 ? pr.vel.y / speed : 0;

      const isPlayer = pr.owner === "player";
      // 位置履歴が無いので速度の逆方向に残像を置く
      ctx.fillStyle = isPlayer ? pr.color : COLOR_ENEMY_TRAIL;
      for (let i = 1; i <= TRAIL_POINTS; i++) {
        const size = Math.max(1, Math.round(pr.radius * 2 * (1 - i / (TRAIL_POINTS + 1))));
        ctx.globalAlpha = TRAIL_ALPHA * (1 - i / (TRAIL_POINTS + 1));
        const tx = pr.pos.x - dx * TRAIL_SPACING * i;
        const ty = pr.pos.y - dy * TRAIL_SPACING * i;
        ctx.fillRect(Math.round(tx - size / 2), Math.round(ty - size / 2), size, size);
      }
      ctx.globalAlpha = 1;

      const key = isPlayer ? SPR.bullet : SPR.enemyBullet;
      const sprite = this.sprite(key);
      const frames =
        isPlayer && pr.color !== COLOR_PLAYER_BULLET_DEFAULT
          ? this.tinted(key, pr.color, BULLET_TINT_STRENGTH)
          : sprite.frames;
      const scale = Math.max(1, (pr.radius * 2) / sprite.w);
      this.drawRotated(frames[0], pr.pos.x, pr.pos.y, Math.atan2(dy, dx), scale);
    }
  }

  // ---------------------------------------------------------------------------
  // プレイヤー
  // ---------------------------------------------------------------------------

  private drawPlayer(state: GameState): void {
    const p = state.player;
    if (state.status === "dead") return;
    const sprite = this.sprite(SPR.player);
    const cx = p.body.pos.x;
    const bottom = p.body.pos.y + sprite.h / 2 - PLAYER_SPRITE_LIFT;

    this.drawBuffAura(state, p);
    this.drawShadow(cx, bottom - 1);
    this.drawAimGuide(state);

    const moving = p.body.vel.x !== 0 || p.body.vel.y !== 0;
    const frame = moving ? spriteFrame(sprite, p.walkTime, WALK_FRAME_TIME) : 0;
    const flip = p.facing.x < 0;
    const dashing = isDashing(p);
    if (dashing) this.drawDashGhosts(p, sprite, frame, cx, bottom, flip);

    // 被弾無敵中は点滅（ダッシュ無敵は点滅させない）
    const blink = p.invulnTimer > 0 && !dashing && p.hitFlash <= 0 && state.tick % 6 < 3;
    if (!blink) {
      const hit = p.hitFlash > 0;
      let sx = 1;
      let sy = 1;
      if (hit) {
        sx = SQUASH_X;
        sy = SQUASH_Y;
      } else if (dashing) {
        sx = DASH_STRETCH_X;
        sy = DASH_STRETCH_Y;
      }
      this.drawAnchored(pick(hit ? sprite.white : sprite.frames, frame), cx, bottom, sx, sy, 0, flip);
    }

    if (isAttacking(p) && p.attack.phase === "active") this.drawSlash(state, p);
  }

  private drawDashGhosts(p: Player, sprite: Sprite, frame: number, cx: number, bottom: number, flip: boolean): void {
    const { ctx } = this;
    const img = pick(sprite.white, frame);
    for (let i = DASH_GHOSTS; i >= 1; i--) {
      ctx.globalAlpha = DASH_GHOST_ALPHA * (1 - (i - 1) / DASH_GHOSTS);
      const gx = cx - p.dashDir.x * DASH_GHOST_SPACING * i;
      const gy = bottom - p.dashDir.y * DASH_GHOST_SPACING * i;
      this.drawAnchored(img, gx, gy, 1, 1, 0, flip);
    }
    ctx.globalAlpha = 1;
  }

  /** バフ中は足元に色付きの楕円と周回する光点 */
  private drawBuffAura(state: GameState, p: Player): void {
    const { buffs } = p;
    const color =
      buffs.invuln > 0
        ? COLOR_AURA_INVULN
        : buffs.damage.time > 0
          ? COLOR_AURA_DAMAGE
          : buffs.speed.time > 0
            ? COLOR_AURA_SPEED
            : null;
    if (!color) return;
    const { ctx } = this;
    const cx = p.body.pos.x;
    const cy = p.body.pos.y;
    ctx.fillStyle = color;
    ctx.globalAlpha = pulse(state.time, AURA_SPEED, AURA_MIN, AURA_MAX);
    ctx.beginPath();
    ctx.ellipse(cx, cy, AURA_RX, AURA_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    for (let i = 0; i < AURA_ORBIT_DOTS; i++) {
      const a = state.time * AURA_ORBIT_SPEED + (i / AURA_ORBIT_DOTS) * Math.PI * 2;
      ctx.fillRect(Math.round(cx + Math.cos(a) * AURA_RX), Math.round(cy + Math.sin(a) * AURA_RY * 0.5 + 4), 1, 1);
    }
  }

  /** 向いている方向を示す小さな三角。マウス照準の手応え用 */
  private drawAimGuide(state: GameState): void {
    const { ctx } = this;
    const p = state.player;
    const d = p.facing;
    const base = { x: p.body.pos.x + d.x * 11, y: p.body.pos.y + d.y * 11 };
    ctx.fillStyle = COLOR_WHITE;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(base.x + d.x * 3, base.y + d.y * 3);
    ctx.lineTo(base.x - d.y * 2, base.y + d.x * 2);
    ctx.lineTo(base.x + d.y * 2, base.y - d.x * 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** 斬撃スプライトを攻撃方向へ回転し、active の残り時間でフェードする */
  private drawSlash(state: GameState, p: Player): void {
    const combo = p.attack.combo;
    const step = meleeStep(state.stats, combo);
    if (!step) return;
    const box = meleeBox(p, step.reach, step.size);
    const key = SLASH_KEYS[Math.min(combo, SLASH_KEYS.length - 1)] ?? SLASH_KEYS[0];
    const sprite = this.sprite(key);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const angle = Math.atan2(p.attack.dir.y, p.attack.dir.x);
    const scale = step.size / sprite.w;
    const t = step.active > 0 ? Math.min(1, Math.max(0, p.attack.timer / step.active)) : 0;
    const { ctx } = this;

    const finisher = combo >= SLASH_KEYS.length - 1;
    if (finisher && t > SLASH_AFTERIMAGE_T) {
      ctx.globalAlpha = SLASH_AFTERIMAGE_ALPHA;
      this.drawRotated(sprite.white[0], cx, cy, angle + SLASH_AFTERIMAGE_ROT, scale);
    }
    ctx.globalAlpha = SLASH_MIN_ALPHA + (1 - SLASH_MIN_ALPHA) * t;
    this.drawRotated(sprite.frames[0], cx, cy, angle, scale);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // 画面全体
  // ---------------------------------------------------------------------------

  private drawOverlays(state: GameState): void {
    const { ctx } = this;
    const p = state.player;
    const playing = state.status === "playing";

    if (state.slowmo > 0 && playing) {
      // 彩度を落として青に寄せる
      ctx.globalCompositeOperation = "saturation";
      ctx.globalAlpha = SLOWMO_DESAT_ALPHA;
      ctx.fillStyle = COLOR_DESAT;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = SLOWMO_TINT_ALPHA;
      ctx.fillStyle = COLOR_SLOWMO;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0);

    if (playing && p.hp <= p.maxHp * LOW_HP_RATIO) {
      ctx.globalAlpha = pulse(state.time, LOW_HP_SPEED, LOW_HP_MIN, LOW_HP_MAX);
      ctx.drawImage(this.lowHpVignette, 0, 0);
    }
    if (playing && p.justTimer > 0) {
      const fade = Math.min(1, p.justTimer / JUST_EDGE_FADE);
      ctx.globalAlpha = fade * pulse(state.time, JUST_EDGE_SPEED, 0.5, 0.9);
      ctx.drawImage(this.edgeBlue, 0, 0);
    }
    if (playing && state.rooms.some((r) => r.locked)) {
      ctx.globalAlpha = pulse(state.time, LOCK_EDGE_SPEED, LOCK_EDGE_MIN, LOCK_EDGE_MAX);
      ctx.drawImage(this.edgeRed, 0, 0);
      ctx.strokeStyle = COLOR_DOOR_EDGE;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, VIEW_W - 1, VIEW_H - 1);
    }
    if (state.flash > 0) {
      // 被弾中の flash は赤、それ以外（JUST・階層移動など）は白
      const hurt = p.hitFlash > 0;
      ctx.fillStyle = hurt ? COLOR_FLASH_RED : COLOR_WHITE;
      ctx.globalAlpha = state.flash * (hurt ? FLASH_RED_ALPHA : FLASH_WHITE_ALPHA);
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.globalAlpha = 1;
  }

  private drawCrosshair(state: GameState, x: number, y: number): void {
    const world = screenToWorld(state.camera, { x, y });
    const hovering = state.enemies.some(
      (e) =>
        e.phase !== "spawning" &&
        Math.hypot(e.body.pos.x - world.x, e.body.pos.y - world.y) <= e.body.radius + CROSSHAIR_HOVER_MARGIN,
    );
    const sprite = this.sprite(SPR.crosshair);
    const img = hovering ? this.tinted(SPR.crosshair, COLOR_TELEGRAPH)[0] : sprite.frames[0];
    if (!img) return;
    this.ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------

  private drawHud(state: GameState): void {
    const { ctx } = this;
    const p = state.player;
    ctx.textAlign = "left";

    this.blit(this.sprite(SPR.heartSmall), 0, HUD_X, HUD_HP_Y - 1);
    this.drawBar(HUD_BAR_X, HUD_HP_Y, HUD_BAR_W, HUD_HP_H, p.hp / p.maxHp, COLOR_HP, COLOR_HP_BG);
    ctx.font = FONT_SMALL;
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(`${Math.ceil(p.hp)}/${p.maxHp}`, HUD_TEXT_X, HUD_HP_Y + HUD_HP_H);

    const ready = p.energy >= p.maxEnergy;
    const blinkOn = state.tick % HUD_BLINK_TICKS < HUD_BLINK_TICKS / 2;
    const energyColor = ready && blinkOn ? COLOR_ENERGY_READY : COLOR_ENERGY;
    this.drawBar(HUD_BAR_X, HUD_ENERGY_Y, HUD_BAR_W, HUD_ENERGY_H, p.energy / p.maxEnergy, energyColor, COLOR_ENERGY_BG);
    if (ready) {
      ctx.strokeStyle = blinkOn ? COLOR_ENERGY : COLOR_ENERGY_READY;
      ctx.strokeRect(HUD_BAR_X - 0.5, HUD_ENERGY_Y - 0.5, HUD_BAR_W + 1, HUD_ENERGY_H + 1);
      ctx.fillStyle = energyColor;
      ctx.fillText("F: BURST", HUD_TEXT_X, HUD_ENERGY_Y + HUD_ENERGY_H + 1);
    }
    this.drawDashPips(state);
    this.drawKeystoneHud(state);

    if (this.lookup) this.minimap.draw(ctx, state, this.lookup, VIEW_W);
    const rightY = this.hudRightY(state);
    const rightX = VIEW_W - HUD_RIGHT_X_PAD;
    ctx.textAlign = "right";
    ctx.font = FONT_SMALL;
    ctx.fillStyle = COLOR_TEXT;
    ctx.fillText(`DEPTH ${state.depth} · ${FLOOR_KIND_LABEL[state.floorKind]}`, rightX, rightY);
    ctx.fillText(`SCORE ${state.score}`, rightX, rightY + HUD_RIGHT_LINE);
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText(`seed ${state.seedText}`, rightX, rightY + HUD_RIGHT_LINE * 2);
    if (state.cursed) {
      ctx.fillStyle = ROOM_KIND.cursedColor;
      ctx.fillText("CURSED: next room elites x2", rightX, rightY + HUD_RIGHT_LINE * HUD_CURSED_LINE);
    }

    if (state.combo.count > 1) {
      const pop = 1 + state.combo.popTimer * 3;
      ctx.textAlign = "center";
      ctx.font = `bold ${Math.round(14 * pop)}px monospace`;
      const fading = state.combo.timer < 0.6;
      ctx.fillStyle = fading && state.tick % 8 < 4 ? COLOR_DIM : COLOR_ENERGY;
      ctx.fillText(`${state.combo.count} HIT`, VIEW_W / 2, 22);
      ctx.font = FONT_SMALL;
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillText(`x${comboMultiplier(state.combo.count).toFixed(1)}`, VIEW_W / 2, 32);
    }

    this.drawBossHud(state);
    this.drawReaperHud(state);

    if (state.rooms.some((r) => r.locked)) {
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

  /** ボス戦中は画面上部に名前付きの HP バー。ロック直後は大きな "BOSS" 表示 */
  private drawBossHud(state: GameState): void {
    const b = state.boss;
    if (!b || b.defeated) return;
    const boss = bossEnemy(state);
    const room = state.rooms[b.roomIndex];
    if (!boss || !room?.locked) return;
    const { ctx } = this;
    const x = Math.round((VIEW_W - BOSS_BAR_W) / 2);
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(x - 1, BOSS_BAR_Y - 1, BOSS_BAR_W + 2, BOSS_BAR_H + 2);
    this.drawBar(x, BOSS_BAR_Y, BOSS_BAR_W, BOSS_BAR_H, boss.hp / boss.maxHp, COLOR_BOSS_BAR, COLOR_BOSS_BAR_BG);
    ctx.textAlign = "center";
    ctx.font = FONT_SMALL;
    ctx.fillStyle = COLOR_BOSS_NAME;
    ctx.fillText(b.name, VIEW_W / 2, BOSS_BAR_Y - 3);

    if (b.introTimer <= 0) return;
    const fade = Math.min(1, b.introTimer / BOSS_BANNER_FADE);
    ctx.globalAlpha = fade;
    ctx.font = FONT_BIG;
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillText("BOSS", VIEW_W / 2 + 2, BOSS_BANNER_Y + 2);
    ctx.fillStyle = COLOR_BOSS_BANNER;
    ctx.fillText("BOSS", VIEW_W / 2, BOSS_BANNER_Y);
    ctx.font = FONT_MED;
    ctx.fillStyle = COLOR_BOSS_NAME;
    ctx.fillText(b.name, VIEW_W / 2, BOSS_BANNER_Y + BOSS_BANNER_NAME_GAP);
    ctx.globalAlpha = 1;
  }

  /** 右上 HUD の 1 行目（ミニマップの下） */
  private hudRightY(state: GameState): number {
    return Minimap.bottom(state) + HUD_RIGHT_GAP;
  }

  /** Reaper 出現までの残り秒（警告時間以降）と、出現中の警告 */
  private drawReaperHud(state: GameState): void {
    const { ctx } = this;
    const reaperY = this.hudRightY(state) + HUD_RIGHT_LINE * HUD_REAPER_LINE;
    ctx.textAlign = "right";
    ctx.font = FONT_SMALL;
    if (state.reaper) {
      ctx.fillStyle = state.tick % HUD_BLINK_TICKS < HUD_BLINK_TICKS / 2 ? REAPER.color : COLOR_WARN;
      ctx.fillText("REAPER! find the stairs", VIEW_W - HUD_RIGHT_X_PAD, reaperY);
      return;
    }
    if (!reaperWarning(state)) return;
    ctx.fillStyle = REAPER.color;
    ctx.fillText(`reaper in ${Math.ceil(reaperTimeLeft(state))}s`, VIEW_W - HUD_RIGHT_X_PAD, reaperY);
  }

  /** ダッシュのチャージ数 */
  private drawDashPips(state: GameState): void {
    const { ctx } = this;
    const max = state.stats.dashCharges;
    for (let i = 0; i < max; i++) {
      const x = HUD_BAR_X + i * (DASH_PIP_SIZE + DASH_PIP_GAP);
      ctx.fillStyle = COLOR_DASH_PIP_EDGE;
      ctx.fillRect(x - 1, HUD_PIP_Y - 1, DASH_PIP_SIZE + 2, DASH_PIP_H + 2);
      ctx.fillStyle = i < state.player.dashChargesLeft ? COLOR_DASH_PIP : COLOR_DASH_PIP_EMPTY;
      ctx.fillRect(x, HUD_PIP_Y, DASH_PIP_SIZE, DASH_PIP_H);
    }
  }

  /** 有効なキーストーン名と、装備内の排他衝突（負けて無効になっているもの）の警告 */
  private drawKeystoneHud(state: GameState): void {
    this.refreshKeystoneHud(state);
    const { ctx } = this;
    ctx.textAlign = "left";
    ctx.font = FONT_SMALL;
    if (this.hudKeystoneText) {
      ctx.fillStyle = COLOR_KEYSTONE;
      ctx.fillText(this.hudKeystoneText, HUD_X, HUD_KEYSTONE_Y);
    }
    if (this.hudConflictText) {
      ctx.fillStyle = state.tick % HUD_BLINK_TICKS < HUD_BLINK_TICKS / 2 ? COLOR_WARN : COLOR_DIM;
      ctx.fillText(this.hudConflictText, HUD_X, HUD_WARN_Y);
    }
  }

  private refreshKeystoneHud(state: GameState): void {
    const eq = state.profile.equipment;
    let cacheKey = state.stats.keystones.join(",");
    for (const slot of SLOTS) cacheKey += `|${eq[slot]?.id ?? ""}`;
    if (cacheKey === this.hudKeyCache) return;
    this.hudKeyCache = cacheKey;

    this.hudKeystoneText = state.stats.keystones.map((k) => keystoneDef(k)?.name ?? k).join(" / ");

    const keys: string[] = [];
    for (const slot of SLOTS) {
      const item = eq[slot];
      if (!item) continue;
      for (const roll of item.affixes) if (isKeystoneKey(roll.key)) keys.push(roll.key);
      if (item.implicit && isKeystoneKey(item.implicit.key)) keys.push(item.implicit.key);
    }
    const inactive = keystoneConflicts(keys)
      .flat()
      .filter((d) => !state.stats.keystones.includes(d.key))
      .map((d) => d.name);
    this.hudConflictText = inactive.length > 0 ? `! CONFLICT: ${inactive.join(", ")} inactive` : "";
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
    ctx.fillStyle = COLOR_BLACK;
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
