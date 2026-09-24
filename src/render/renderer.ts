import { actionKeyLabel } from "../core/input";
import { VIEW_H, VIEW_W, screenToWorld } from "../core/view";
import type { BossState, Enemy, FloorKind, GameState, Hazard, Player, Projectile, RoomKind, RoomState } from "../core/state";
import type { GameMap } from "../map/grid";
import { enemyDef, spriteBaseKey } from "../data/enemies";
import { type EnemyTelegraph, enemyActiveArea, enemyTelegraph } from "../system/enemies";
import { reaperBodyVisible } from "../system/reaperVariants";
import { BOSS, ELITE, ENEMY_AI, FLOOR_KIND, REAPER, ROOM, ROOM_KIND, STATUS, WEAPON } from "../data/tuning";
import { bossEnemy, showsBossBar } from "../system/boss";
import { ELITE_COLOR, chainPartners, eliteDisplayName, shieldLeft } from "../system/elites";
import { shockwaveRadius } from "../system/hazards";
import { reaperTimeLeft, reaperWarning } from "../system/reaper";
import { isKeystoneKey, keystoneConflicts, keystoneDef } from "../loot/affixes";
import { describeResonance } from "../loot/describe";
import { RARITY_COLOR, SLOTS, type Rarity } from "../loot/types";
import { TILE_SIZE, Tile, getTile, toIndex } from "../map/grid";
import { comboMultiplier } from "../system/combat";
import {
  type MeleeStep,
  currentMeleeStep,
  isAttacking,
  isDashing,
  meleeAnchor,
  meleeChargeLevel,
  playerMoveset,
  shotChargeLevel,
} from "../system/player";
import {
  LOOT_PILLAR_HEIGHTS,
  bombBlinkFrameTime,
  bombStyle,
  bossIntroPhase,
  bossPhaseThreshold,
  clamp01,
  damageTextStyle,
  easeOutCubic,
  floorVariant,
  floorWipeCover,
  computeViewScale,
  lerp,
  pulse,
  spriteFeetY,
  wallMask,
  wallStyle,
} from "./renderMath";
import { TEXT, baselineOffset, drawText, drawTextShadow, pixelText, textWidth, updateTextSizes } from "./pixelText";
import { type Sprite, type SpriteAtlas, TintCache, buildAtlas, enemySpriteKey, getSprite, mergeAtlas, spriteFrame } from "./sprites";
import { expandTileAtlas } from "./tileAtlas";
import { tileBiome } from "../data/tiles";
import { isDark } from "../system/roomTypes";
import { DarknessLayer } from "./darkness";
import { Minimap, type RoomLookup, buildRoomLookup } from "./minimap";
import { drawBoonChoice, drawBoonHud } from "./boonUi";
import { drawChainHud } from "./chainUi";
import { drawDropFocus } from "./dropTooltip";
import { isStaggered } from "../system/poise";
import { hasStatus } from "../system/statusEffects";
import { drawBossPoiseGauge, drawEnemyStatus, drawEnemyStatusFx, drawPlayerStatusRow, drawPoiseGauge, statusTint } from "./statusUi";
import { type FxSprites, critFlashActive, drawAirMarks, drawDeathFx, drawFloorCard, drawGroundMarks, drawPlayerAuras, drawScreenMarks } from "./effectsUi";
import { ELEMENT_FX_COLOR, hitElement, itemTraitColor } from "../system/effects";
import { EFFECTS } from "../data/tuning";
import { type HitShape, MOVESETS, SHOT_TYPES, isShotOnly, lobHeight } from "../data/weapons";
import { type Item, TRAIT_COLOR_HEX } from "../loot/types";
import {
  type SwingPhase,
  type WeaponPose,
  WEAPON_TRAIL_WIDTH,
  offhandOffset,
  phaseProgress,
  playerBodyPose,
  slashVisual,
  slashWeight,
  swingSign,
  weaponGrip,
  weaponPose,
} from "./renderMath";
import { weaponSpriteKey } from "../data/sprites/weapons";
import { poseKey } from "../data/sprites/frameKit";
import { drawWeaknessMark } from "./elementUi";
import { drawUnspentHud } from "./attributeUi";
import { drawManaBar } from "./manaHud";
import { drawComboHud } from "./comboUi";
import { drawSmokeLayer, drawTerrainLayer } from "./terrainUi";
import { drawDoubleChargeLine } from "./chargeLineUi";
import { doorMarkDone, drawBiomeTint, drawRunHud, drawRunOverlay, drawRunSetupHud, drawRunWorld, specialDoorColor } from "./runUi";
import { FLOOR_KIND_LABEL } from "../system/roomTypes";

/** コンボ表示（論理 px・y 座標） */
const COMBO_TEXT_PX = 14;
const COMBO_TEXT_Y = 22;
const COMBO_MULT_GAP = 10;
/** 死亡画面のレイアウト */
const DEATH_TITLE_RISE = 24;
const DEATH_STAT_LINE = 16;
const DEATH_HINT_GAP = 24;
const COLOR_DEATH_HINT = "#a0a0a0";
/** 浮遊文字のドット倍率の上限（クリティカルの弾みで巨大化しすぎないように） */
const FLOAT_TEXT_MAX_M = 3;

/** HUD の階層表示用（system/roomTypes.ts の FLOOR_KIND_LABEL は英語のまま別用途で使われるため、表示専用にここで持つ） */
const FLOOR_KIND_LABEL_JA: Readonly<Record<FloorKind, string>> = {
  ...FLOOR_KIND_LABEL,
  rooms: "通常",
};

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
  fountain: "fountain",
} as const;
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
const LASER_THICK_W = 3;
const LASER_FRAME_TIME = 0.05;
const BOMB_FRAME_TIME_SLOW = 0.3;
const BOMB_FRAME_TIME_FAST = 0.08;
const BOMB_CIRCLE_ALPHA = 0.25;
const BOMB_FILL_ALPHA = 0.18;
const SHOCKWAVE_ALPHA = 0.85;
const GOLEM_TELEGRAPH_ALPHA = 0.3;
/** Wave 3 の予告: 扇（風・睨み）の塗りの濃さ（予備動作中 / 攻撃中）と、十字の線・鎖縛のの鎖の濃さ */
const CONE_WINDUP_ALPHA = 0.18;
const CONE_ACTIVE_ALPHA = 0.28;
const CROSS_LINE_ALPHA = 0.5;
const ELITE_CHAIN_ALPHA = 0.55;
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
/** 共鳴の種類（describeResonance の 1 行目）。発現中だけ出す */
const HUD_RESONANCE_LINE = 5;
/** 起点と位階（放浪者で縛りなしなら出さない） */
const HUD_RUN_SETUP_LINE = 6;
const REAPER_TINT = 0.7;
const BOSS_BANNER_NAME_GAP = 16;
const ELITE_BAR_W = 20;
const SHIELD_BAR_H = 2;
/** boss.ts の STAGE_TWO と同じ（フェーズ 2） */
const KING_STAGE_TWO = 2;
const SHOCKWAVE_SPENT_ALPHA = 0.4;
const LANDING_RX = 0.5;
const LANDING_RY = 0.3;
const LANDING_RING_FADE = 0.6;

/** 第 2 弾: ボス演出 */
const BOSS_BAR_SEGMENTS = 10;
const BOSS_BAR_FRAME = 1;
const COLOR_BOSS_TRAIL = "#ffb0a0";
const COLOR_BOSS_BAR_HI = "#ff6a5a";
const COLOR_BOSS_TICK = "rgba(0,0,0,0.55)";
const COLOR_BOSS_PHASE_TICK = "#ffd75f";
/** HP バーの遅れて減る部分の速度（割合/秒） */
const BOSS_TRAIL_SPEED = 0.35;
const BOSS_PHASE_FLASH_TIME = 0.35;
const BOSS_LETTERBOX_H = 16;
const BOSS_BAND_H = 34;
const BOSS_BAND_ALPHA = 0.75;
const BOSS_LABEL_GAP = 12;
const BOSS_NAME_SHADOW = 2;
const BOSS_DEATH_TIME = 1.4;
const BOSS_DEATH_GROW = 1.8;
const BOSS_DEATH_RINGS = 3;
const BOSS_DEATH_RING_R = 70;
const BOSS_DEATH_RING_DELAY = 0.15;
const BOSS_LABEL = "― ボス ―";
/** 階層移動ワイプ: map が変わった瞬間の flash がこれ以上ならワイプにする */
const WIPE_TRIGGER_FLASH = 0.7;
const WIPE_EDGE_ALPHA = 0.6;
/** 新敵 */
const BAT_SHADOW_SCALE = 0.5;
const BAT_SHADOW_DROP = 7;
const WISP_FLICKER_SPEED_X = 11;
const WISP_FLICKER_SPEED_Y = 7;
const WISP_FLICKER_X = 0.08;
const WISP_FLICKER_Y = 0.12;
const WISP_GLOW_R = 12;
const WISP_GLOW_ALPHA = 0.35;
const WISP_GLOW_FLICKER = 0.3;
const KNIGHT_BLOCK_KNOCK_MIN = 15;
const KNIGHT_BLOCK_GLOW_R = 10;
const KNIGHT_BLOCK_SCALE = 1.3;
const LASER_TELEGRAPH_MIN_ALPHA = 0.35;
const LASER_DOT_R = 3;
const LASER_DOT_GLOW_R = 8;
const LASER_DOT_SPEED = 25;
const LASER_END_GLOW_R = 12;
const LASER_END_CORE_R = 4;
const LASER_OUTER_W = 4;
const LASER_OUTER_ALPHA = 0.25;
const SHOCKWAVE_FILL_ALPHA = 0.08;
const SHOCKWAVE_OUTER_PAD = 4;
const SHOCKWAVE_OUTER_ALPHA = 0.25;
const SHOCKWAVE_CORE_ALPHA = 0.9;
const WISP_DEATH_ALPHA = 0.9;
const WISP_DEATH_FILL_ALPHA = 0.15;
const ELITE_BOMB_RING_W = 2;
const ELITE_BOMB_SPEED = 18;
const BOMB_SPARK_R = 5;
const BOMB_SPARK_ALPHA = 0.7;
const BOMB_SPARK_Y = 4;
/** エリート */
const LINK_DOT_COUNT = 3;
const LINK_DOT_SPEED = 0.8;
const LINK_DOT_SIZE = 2;
const SHIELD_BAR_ICON_GAP = 1;
const SHIELD_BAR_ICON_SCALE = 0.75;
const ELITE_AURA_PULSE_SPEED = 3;
const ELITE_AURA_PULSE_MIN = 0.75;
/** Reaper */
const REAPER_WARN_TEXT = "何かが近づいている";
const REAPER_WARN_Y = 44;
const REAPER_EDGE_MIN = 0.15;
const REAPER_EDGE_MAX = 0.85;
const REAPER_EDGE_SPEED_MIN = 2;
const REAPER_EDGE_SPEED_MAX = 9;
const REAPER_TRAIL_LEN = 10;
const REAPER_TRAIL_STEP = 0.05;
const REAPER_TRAIL_ALPHA = 0.35;
const REAPER_TRAIL_SHRINK = 0.5;
/** ダメージ数字 */
const TEXT_BASE_SIZE = 8;
const CRIT_SHAKE_SPEED = 45;
const CRIT_SHAKE_AMP = 1.5;
const CRIT_POP_TIME = 0.15;
const CRIT_POP_SCALE = 0.5;
/** HUD 右上の視認性 */
const HUD_PANEL_ALPHA = 0.55;
const HUD_PANEL_PAD = 3;
const HUD_PANEL_ASCENT = 7;
const COLOR_HUD_SEED = "#a0a0b0";
const COLOR_HUD_SCORE = "#ffd75f";
/** 泉のアニメ */
const FOUNTAIN_FRAME_TIME = 0.45;
const FOUNTAIN_DRY_TINT = 0.7;

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

/** 床アイテムの光柱（高さはレアリティ別: renderMath の LOOT_PILLAR_HEIGHTS。これは元画像の高さ） */
const LOOT_PILLAR_HEIGHT = 32;
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
/** drawEnemy が個別に色を重ねる状態（statusTint の汎用の色調とは二重に塗らない） */
const BUILTIN_TINT_KINDS: ReadonlySet<string> = new Set(["chill", "freeze", "burn"]);
const STATUS_TINT_SPEED = 6;
/** 溜めの段の目盛り（プレイヤーの頭上の点） */
const CHARGE_PIP_GAP = 4;
const CHARGE_PIP_Y = 16;
/** 振りの軌跡の半径（リーチに対する割合）、鎌の内側の弧、鞭のしなり */
const TRAIL_REACH_RATIO = 0.85;
const SCYTHE_INNER_RATIO = 0.8;
const WHIP_BEND = 10;
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
/** 武器種の当たり判定の縁取りの濃さ（active の残りで薄れる） */
const MELEE_SHAPE_ALPHA = 0.35;
/** 溜めの環の明滅 */
const CHARGE_RING_SPEED = 10;
const CHARGE_RING_MIN = 0.45;
const CHARGE_RING_MAX = 0.9;
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
const FOUNTAIN_WATER = "#60c0ff";
const FOUNTAIN_DRY = "#3a4450";
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

/** リゲイン表示 */
const COLOR_REGAIN = "#ffa040";
const REGAIN_ALPHA = 0.5;
/** 残りがこの秒数未満なら点滅 */
const REGAIN_BLINK_TIME = 1;

/** HUD */
const HUD_X = 8;
const HUD_HP_Y = 8;
const HUD_BAR_X = HUD_X + 10;
const HUD_BAR_W = 100;
const HUD_HP_H = 6;
/** マナバー: HP バーの直下（docs/COMBAT_DESIGN.md B-8） */
const HUD_MANA_Y = HUD_HP_Y + HUD_HP_H + 1;
const HUD_MANA_H = 2;
const HUD_ENERGY_Y = 17;
const HUD_ENERGY_H = 4;
const HUD_TEXT_X = HUD_BAR_X + HUD_BAR_W + 4;
/** HP の数値と未振り点の表示の間 */
const HUD_UNSPENT_GAP = 6;
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
/** 溜め中の武器を段の色で染める強さ */
const CHARGE_WEAPON_TINT = 0.55;
/** 斬撃を属性色（無ければ段の残像色）で染める強さ。外縁の白は少し残る */
const SLASH_TINT = 0.7;
/** 属性も段の残像色も無い斬撃の色 */
const SLASH_DEFAULT_COLOR = "#8ce0f0";
/** 近接の段を持たない武器種が持つ形（待機の姿勢にしか使わない） */
const SHAPE_ARC: HitShape = { kind: "arc", deg: 120 };
/** 二丁拳銃の左右 */
const GUN_SIDES = [1, -1] as const;
/** 曲射の弾の影（地面の位置に置く楕円の半径） */
const LOB_SHADOW_RX = 3;
const LOB_SHADOW_RY = 1.5;
const LOB_SHADOW_ALPHA = 0.35;

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

/** 中心が明るく外へ抜ける放射状の光。色と半径ごとに一度だけ作る */
function buildGlow(color: string, r: number): HTMLCanvasElement {
  const size = Math.ceil(r * 2);
  const { canvas, ctx } = makeCanvas(size, size);
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function pick<T>(arr: readonly T[], i: number): T | undefined {
  return arr[i % arr.length];
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** PNG 取り込み（setAtlas）で差し替わるので readonly にしない */
  private atlas: SpriteAtlas;
  private readonly tints = new TintCache();
  private readonly vignette: HTMLCanvasElement;
  private readonly lowHpVignette: HTMLCanvasElement;
  private readonly edgeBlue: HTMLCanvasElement;
  private readonly edgeRed: HTMLCanvasElement;
  private readonly edgePurple: HTMLCanvasElement;
  private readonly glows = new Map<string, HTMLCanvasElement>();
  /** 描画側だけの演出トラッカー（state は読むだけ。state の差し替えでリセット） */
  private lastState: GameState | null = null;
  private lastMap: GameMap | null = null;
  private lastTime = 0;
  private wipeActive = false;
  private bossRef: BossState | null = null;
  private bossStage = 1;
  private bossPhaseFlashAt = Number.NEGATIVE_INFINITY;
  private bossTrail = 1;
  private bossDefeatAt: number | null = null;
  private bossSnap: { img: HTMLCanvasElement; x: number; bottom: number; flip: boolean } | null = null;
  private readonly reaperTrail: { x: number; y: number }[] = [];
  private reaperTrailAt = 0;
  private readonly pillars = new Map<string, HTMLCanvasElement>();
  /** 遺物の響きの色（光柱の色）。毎フレーム配合を数え直さないよう id で覚える。色なしは空文字 */
  private readonly itemColors = new Map<string, string>();
  /** 階層到達の名札を出し始めた時刻（state.time） */
  private floorCardAt = Number.NEGATIVE_INFINITY;
  /** 演出（effectsUi.ts）にスプライトを貸す窓口 */
  private readonly fxSprites: FxSprites = {
    enemy: (defKey, color) => {
      const key = enemyDef(defKey).sprite;
      return color ? this.tinted(key, color)[0] : this.sprite(key).frames[0];
    },
    player: (color) => this.tinted(SPR.player, color)[0],
    glow: (x, y, color, r, alpha) => this.drawGlow(x, y, color, r, alpha),
  };
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

  /** 論理 1px あたりの実ピクセル数。fitToWindow で更新する */
  private pixelRatio = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.atlas = buildAtlas();
    this.vignette = buildVignette("0,0,0", VIGNETTE_ALPHA);
    this.lowHpVignette = buildVignette("200,0,0", 0.3);
    this.edgeBlue = buildEdgeGlow("80,160,255");
    this.edgeRed = buildEdgeGlow("255,40,40");
    this.edgePurple = buildEdgeGlow("128,64,192");
    this.fitToWindow();
    window.addEventListener("resize", () => this.fitToWindow());
  }

  /**
   * CSS は整数倍で拡大してドットを崩さず、canvas の実ピクセルはデバイス解像度で持つ。
   * 論理座標（VIEW_W x VIEW_H）は beginFrame の transform で揃えるので描画コードは変えなくてよい
   */
  private fitToWindow(): void {
    const view = computeViewScale(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    this.canvas.style.width = `${VIEW_W * view.cssScale}px`;
    this.canvas.style.height = `${VIEW_H * view.cssScale}px`;
    this.pixelRatio = view.pixelRatio;
    pixelText().setScale(view.pixelRatio);
    if (this.canvas.width === view.canvasW && this.canvas.height === view.canvasH) return;
    // サイズ変更で context の状態（transform・smoothing）はリセットされる
    this.canvas.width = view.canvasW;
    this.canvas.height = view.canvasH;
    this.beginFrame();
  }

  /**
   * フレーム先頭で論理座標の transform を掛け直す。render を経由しない画面（タイトル等）も
   * 描く前に必ず呼ぶ
   */
  beginFrame(): void {
    const { ctx } = this;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // 文字倍率は表示倍率に依存するため毎フレーム再計算する（リサイズ直後のフレームから正しい大きさにする）
    pixelText().setScale(this.pixelRatio);
    updateTextSizes();
  }

  /** オーバーレイ UI（装備画面など）が同じ描画先に描くための公開 */
  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  render(state: GameState, aimScreen: { x: number; y: number } | null = null): void {
    const { ctx } = this;
    this.beginFrame();
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (this.lookup?.map !== state.map) this.lookup = buildRoomLookup(state);
    this.track(state);
    const cam = state.camera;
    const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
    const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);

    ctx.save();
    ctx.translate(ox, oy);
    this.drawTiles(state, -ox, -oy);
    drawBiomeTint(ctx, state, -ox, -oy, FLOOR_KIND.tintAlpha, `tile.${tileBiome(state.floorKind, state.sandbox === true)}.floor` in this.atlas);
    drawTerrainLayer(ctx, state, -ox, -oy, this.atlas);
    drawGroundMarks(ctx, state, this.fxSprites);
    this.drawPickups(state);
    this.drawFloorItems(state);
    this.drawGroundHazards(state);
    this.drawLinks(state);
    this.drawEliteChains(state);
    drawRunWorld(ctx, state, this.atlas);
    this.drawEnemies(state);
    drawDeathFx(ctx, state, this.fxSprites);
    this.drawBossDeath(state);
    this.drawProjectiles(state);
    this.drawLasers(state);
    drawPlayerAuras(ctx, state);
    this.drawPlayer(state);
    this.drawReaper(state);
    drawSmokeLayer(ctx, state, -ox, -oy);
    this.drawShapes(state);
    drawAirMarks(ctx, state, this.fxSprites);
    this.drawParticles(state);
    this.drawTexts(state);
    ctx.restore();

    if (isDark(state)) this.darkness.draw(ctx, state, ox, oy);
    drawRunOverlay(ctx, state, ox, oy);
    this.drawOverlays(state);
    drawScreenMarks(ctx, state, ox, oy);
    this.drawBossLetterbox(state);
    this.drawHud(state);
    this.drawFloorWipe(state);
    // 拠点（sandbox）は階層ではないのでフロアカードを出さない
    if (state.status === "playing" && !state.sandbox) drawFloorCard(ctx, `地下 ${state.depth} 階`, FLOOR_KIND_LABEL_JA[state.floorKind], state.time - this.floorCardAt);
    drawBoonHud(ctx, state, aimScreen);
    drawChainHud(ctx, state);
    drawDropFocus(ctx, state, aimScreen, ox, oy);
    drawBoonChoice(ctx, state);
    if (aimScreen && state.status === "playing") this.drawCrosshair(state, aimScreen.x, aimScreen.y);
    if (state.status === "dead") this.drawDeath(state);
  }

  // ---------------------------------------------------------------------------
  // 描画側の演出トラッカー（state の変化を見て描画用の時刻を覚えるだけ）
  // ---------------------------------------------------------------------------

  private track(state: GameState): void {
    if (state !== this.lastState) {
      this.lastState = state;
      this.lastMap = state.map;
      this.lastTime = state.time;
      this.wipeActive = false;
      this.bossRef = null;
      this.reaperTrail.length = 0;
      this.floorCardAt = state.time;
    }
    const dt = Math.max(0, state.time - this.lastTime);
    this.lastTime = state.time;
    if (state.map !== this.lastMap) {
      this.lastMap = state.map;
      this.wipeActive = state.flash >= WIPE_TRIGGER_FLASH;
      this.reaperTrail.length = 0;
      this.floorCardAt = state.time;
    }
    if (this.wipeActive && state.flash <= 0) this.wipeActive = false;
    this.trackBoss(state, dt);
    this.trackReaper(state);
  }

  private trackBoss(state: GameState, dt: number): void {
    const b = state.boss;
    if (b !== this.bossRef) {
      this.bossRef = b;
      this.bossStage = 1;
      this.bossPhaseFlashAt = Number.NEGATIVE_INFINITY;
      this.bossTrail = 1;
      this.bossDefeatAt = null;
      this.bossSnap = null;
    }
    if (!b) return;
    const e = bossEnemy(state);
    if (e) {
      const stage = e.ai?.stage ?? 1;
      if (stage !== this.bossStage) {
        this.bossStage = stage;
        this.bossPhaseFlashAt = state.time;
      }
      const ratio = e.maxHp > 0 ? clamp01(e.hp / e.maxHp) : 0;
      this.bossTrail = ratio >= this.bossTrail ? ratio : Math.max(ratio, this.bossTrail - BOSS_TRAIL_SPEED * dt);
      const sprite = this.sprite(enemyDef(e.defKey).sprite);
      const img = pick(sprite.white, this.enemyFrame(e, sprite));
      if (img) {
        const bottom = e.body.pos.y + sprite.h / 2 - this.jumpLift(e);
        this.bossSnap = { img, x: e.body.pos.x, bottom, flip: e.facing.x < 0 };
      }
    }
    if (b.defeated && this.bossDefeatAt === null) this.bossDefeatAt = state.time;
  }

  /** Reaper の残像用に一定間隔で位置を記録する */
  private trackReaper(state: GameState): void {
    const r = state.reaper;
    if (!r) {
      this.reaperTrail.length = 0;
      return;
    }
    if (state.time - this.reaperTrailAt < REAPER_TRAIL_STEP && this.reaperTrail.length > 0) return;
    this.reaperTrailAt = state.time;
    this.reaperTrail.unshift({ x: r.pos.x, y: r.pos.y });
    if (this.reaperTrail.length > REAPER_TRAIL_LEN) this.reaperTrail.length = REAPER_TRAIL_LEN;
  }

  // ---------------------------------------------------------------------------
  // 描画プリミティブ
  // ---------------------------------------------------------------------------

  private glowImg(color: string, r: number): HTMLCanvasElement {
    const key = `${color}|${r}`;
    const hit = this.glows.get(key);
    if (hit) return hit;
    const made = buildGlow(color, r);
    this.glows.set(key, made);
    return made;
  }

  /** 加算合成の丸い光（事前生成した画像を置くだけ） */
  private drawGlow(x: number, y: number, color: string, r: number, alpha: number): void {
    if (alpha <= 0) return;
    const { ctx } = this;
    const img = this.glowImg(color, r);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(img, Math.round(x - r), Math.round(y - r));
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  /** 1px の影付き文字 */
  private shadowText(text: string, x: number, y: number, color: string, m: number, align: "left" | "center" | "right" = "center"): void {
    drawTextShadow(this.ctx, text, x, y, m, color, COLOR_BLACK, align);
  }

  private sprite(key: string): Sprite {
    return getSprite(this.atlas, key);
  }

  /** 外から描く UI（拠点の設備など）が PNG 素材を引くための公開。無ければ undefined（呼び出し側がフォールバック） */
  atlasSprite(key: string): Sprite | undefined {
    return this.atlas[key];
  }

  /**
   * PNG から作ったアトラスを合流させる（読み込み完了後に main.ts が呼ぶ）。
   * ピクセルマップの上から同名キーだけ上書きするので、未ロード中はここまでの見た目のまま
   */
  setAtlas(over: SpriteAtlas): void {
    this.atlas = mergeAtlas(buildAtlas(), expandTileAtlas(over));
    this.tints.clear();
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
    const biome = tileBiome(state.floorKind, state.sandbox === true);
    // PNG 取り込みのバイオーム版（tile.<biome>.floor）があればそれを、無ければピクセルマップ
    const floor = this.atlas[`tile.${biome}.floor`] ?? this.sprite(SPR.floor);
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
          // 周囲 8 マスが壁の岩盤は、PNG の有無にかかわらず描かない（壁の模様で画面が埋まらないように）
          if (style === "none") continue;
          // PNG 取り込み（tile.<biome>.wall.<mask>）があればそれを、無ければ従来のピクセルマップにフォールバック
          const masked = this.atlas[`tile.${biome}.wall.${wallMask(map, x, y)}`];
          if (masked) {
            this.blit(masked, 0, px, py);
            continue;
          }
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

  /** 水面の反射が揺れる 2 フレームの泉。使用済みは灰色に沈める */
  private drawFountain(state: GameState, room: RoomState | undefined, px: number, py: number): void {
    const used = room?.used ?? false;
    const sprite = this.sprite(SPR.fountain);
    if (used) {
      const dry = this.tinted(SPR.fountain, FOUNTAIN_DRY, FOUNTAIN_DRY_TINT)[0];
      if (dry) this.ctx.drawImage(dry, px, py);
      return;
    }
    this.blit(sprite, spriteFrame(sprite, state.time, FOUNTAIN_FRAME_TIME), px, py);
    const glow = pulse(state.time, FOUNTAIN_SPEED, FOUNTAIN_MIN, FOUNTAIN_MAX);
    const half = TILE_SIZE / 2;
    this.drawGlow(px + half, py + half, FOUNTAIN_WATER, FOUNTAIN_GLOW_R, FOUNTAIN_GLOW_ALPHA * glow * 2);
  }

  /** 特別な部屋の入口に小さな菱形。用が済んだら消す */
  private drawDoorMark(state: GameState, room: RoomState | undefined, px: number, py: number): void {
    if (!room || room.locked) return;
    const color = DOOR_MARK_COLOR[room.kind] ?? specialDoorColor(room);
    if (!color) return;
    const done = doorMarkDone(room);
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

  /** 遺物の支配色（響き）。色を持たない遺物は undefined（レアリティ色で描く） */
  private itemColor(item: Item): string | undefined {
    const hit = this.itemColors.get(item.id);
    if (hit !== undefined) return hit === "" ? undefined : hit;
    const trait = itemTraitColor(item);
    const color = trait ? TRAIT_COLOR_HEX[trait] : "";
    this.itemColors.set(item.id, color);
    return color === "" ? undefined : color;
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
      const color = this.itemColor(fi.item) ?? RARITY_COLOR[rarity];
      const x = Math.round(fi.pos.x);
      const y = Math.round(fi.pos.y);
      const wobble = 1 + Math.sin(fi.bobTime * LOOT_WOBBLE_SPEED) * LOOT_WOBBLE_AMOUNT;
      const h = Math.round(LOOT_PILLAR_HEIGHTS[rarity] * wobble);
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
    for (const fi of state.floorItems) {
      if (fi.item.rarity === "normal") continue;
      const x = Math.round(fi.pos.x);
      const wobble = 1 + Math.sin(fi.bobTime * LOOT_WOBBLE_SPEED) * LOOT_WOBBLE_AMOUNT;
      const ly = Math.round(fi.pos.y - LOOT_PILLAR_HEIGHTS[fi.item.rarity] * wobble - LOOT_LABEL_OFFSET);
      this.shadowText(fi.item.name, x, ly, RARITY_COLOR[fi.item.rarity], TEXT.SMALL);
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

  /**
   * 浮遊文字。ダメージ数字は縁取り付き（重い一撃は茶、クリティカルは朱の縁）。
   * クリティカルは出た瞬間に大きく弾み、左右に揺れる
   */
  private drawTexts(state: GameState): void {
    const { ctx } = this;
    const pt = pixelText();
    const maxM = Math.max(FLOAT_TEXT_MAX_M, TEXT.SMALL);
    for (let i = 0; i < state.texts.length; i++) {
      const t = state.texts[i];
      if (!t) continue;
      const fade = Math.min(1, (t.life / t.maxLife) * 2);
      const style = damageTextStyle(t.text, t.color, t.scale, t.kind);
      const age = t.maxLife - t.life;
      let scale = t.scale;
      let x = Math.round(t.pos.x);
      const y = Math.round(t.pos.y);
      if (style.crit) {
        scale *= 1 + CRIT_POP_SCALE * (1 - clamp01(age / CRIT_POP_TIME));
        x += Math.round(Math.sin(state.time * CRIT_SHAKE_SPEED + i) * CRIT_SHAKE_AMP * fade);
      }
      ctx.globalAlpha = fade;
      // 連続的な scale をドット整数倍率へ量子化（ドットの粒を崩さない）
      const m = Math.min(maxM, pt.sizeFor(TEXT_BASE_SIZE * scale));
      if (style.numeric) {
        drawText(ctx, t.text, x - 1, y, m, style.outline, "center");
        drawText(ctx, t.text, x + 1, y, m, style.outline, "center");
        drawText(ctx, t.text, x, y - 1, m, style.outline, "center");
        drawText(ctx, t.text, x, y + 1, m, style.outline, "center");
        drawText(ctx, t.text, x, y, m, t.color, "center");
        continue;
      }
      this.shadowText(t.text, x, y, t.color, m);
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
    // 潜行中の敵（土潜り・天井吊り・影踏み）は描かない。居場所は土煙と影の予告だけで見せる
    if (e.hidden) return;
    const { ctx } = this;
    const def = enemyDef(e.defKey);
    // 予備動作・攻撃の原画があれば形でテレグラフを読ませる（無ければ歩きのまま）
    const key = enemySpriteKey(def.sprite, e.phase, (k) => k in this.atlas);
    const sprite = this.sprite(key);
    const cx = e.body.pos.x;
    const cy = e.body.pos.y;

    if (e.phase === "spawning") {
      this.drawSpawnRing(cx, cy, e.phaseTimer);
      return;
    }

    const floating = FLOATING_SPRITES.has(spriteBaseKey(def));
    const feetY = spriteFeetY(cy, e.body.radius);
    const isBat = def.behavior === "bat";
    const isWisp = def.behavior === "wisp";
    // 群れで来る bat は影を小さく（重なって床が黒く潰れないように）
    const shadowScale = isBat ? BAT_SHADOW_SCALE : Math.max(1, sprite.w / TILE_SIZE);
    const shadowDrop = isBat ? BAT_SHADOW_DROP : floating ? FLOAT_SHADOW_DROP : -1;
    this.drawShadow(cx, feetY + shadowDrop, shadowScale);
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
    let sx = hit ? SQUASH_X : 1;
    let sy = hit ? SQUASH_Y : 1;
    if (isWisp) {
      // 炎の揺らぎ: 横と縦を別周期で伸縮 + 背後の発光
      sx *= 1 + Math.sin(e.animTime * WISP_FLICKER_SPEED_X + e.id) * WISP_FLICKER_X;
      sy *= 1 + Math.sin(e.animTime * WISP_FLICKER_SPEED_Y + e.id * 2) * WISP_FLICKER_Y;
      const flicker = 1 - WISP_GLOW_FLICKER + Math.sin(e.animTime * WISP_FLICKER_SPEED_X) * WISP_GLOW_FLICKER;
      this.drawGlow(x, bottom - sprite.h / 2, ENEMY_AI.wisp.color, WISP_GLOW_R, WISP_GLOW_ALPHA * flicker);
    }
    const staggered = isStaggered(e);
    const rot =
      staggered
        ? (flip ? STAGGER_TILT : -STAGGER_TILT) * (0.7 + 0.3 * Math.sin(state.time * STAGGER_WOBBLE_SPEED))
        : 0;

    const base = hit ? sprite.white : sprite.frames;
    this.drawAnchored(pick(base, frame), x, bottom, sx, sy, rot, flip);

    // 状態の重ね描き（同じ変形のシルエットを半透明で）
    if (e.phase === "windup" && Math.sin(state.time * WINDUP_BLINK_SPEED) > 0) {
      ctx.globalAlpha = WINDUP_RED_ALPHA;
      this.drawAnchored(pick(this.tinted(key, COLOR_TELEGRAPH), frame), x, bottom, sx, sy, rot, flip);
    }
    if (hasStatus(e.status, "chill") || hasStatus(e.status, "freeze")) {
      ctx.globalAlpha = CHILL_TINT_ALPHA;
      this.drawAnchored(pick(this.tinted(key, STATUS.chillColor), frame), x, bottom, sx, sy, rot, flip);
    }
    if (hasStatus(e.status, "burn")) {
      ctx.globalAlpha = BURN_TINT_ALPHA * (0.6 + 0.4 * Math.sin(state.time * BURN_FLICKER_SPEED + e.id));
      this.drawAnchored(pick(this.tinted(key, STATUS.burnColor), frame), x, bottom, sx, sy, rot, flip);
    }
    this.drawStatusTint(state, e, key, frame, x, bottom, sx, sy, rot, flip);
    if (critFlashActive(state, e.id)) {
      // 会心の反転: 白いシルエットを差の合成で重ねて 1 瞬だけ色を反転する
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "difference";
      this.drawAnchored(pick(sprite.white, frame), x, bottom, sx, sy, rot, flip);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
    drawEnemyStatusFx(ctx, e, x, bottom, sprite.w, sprite.h, state.time);
    if (isWisp) this.drawSparkles(x, bottom - 2, e.animTime, ENEMY_AI.wisp.color);
    if (def.blocks) this.drawKnightShield(state, e, cx, cy);

    const top = cy - sprite.h / 2 - 2;
    if (e.phase === "windup") {
      drawText(ctx, "!", cx, top, TEXT.SMALL, COLOR_TELEGRAPH, "center");
      // 予告の種類は system 側（enemyTelegraph）が決める。影で見せるものは hazards の landing が描く
      const tele = enemyTelegraph(e, def);
      if (tele?.kind === "line") this.drawChargeLine(e);
      if (tele?.kind === "laser") this.drawLaserTelegraph(state, e, def.windup);
      if (tele?.kind === "ring") this.drawRingTelegraph(cx, cy, tele.radius);
      this.drawWave3Telegraph(e, tele, CONE_WINDUP_ALPHA);
    }
    this.drawWave3Telegraph(e, enemyActiveArea(e, def), CONE_ACTIVE_ALPHA);
    drawDoubleChargeLine(ctx, e);
    if (staggered) {
      drawText(ctx, "*", cx, top, TEXT.SMALL, COLOR_ENERGY, "center");
    }
    drawEnemyStatus(ctx, e, cx, e.elite ? top - ELITE_NAME_OFFSET : top);
    // 属性の弱点の印（docs/COMBAT_DESIGN.md A-8）
    drawWeaknessMark(ctx, state, e, cx + sprite.w / 2, top);
    // ボスの座にいる敵（双子の妹が兄から継いだ後も）は上部バーだけで見せる
    if (showsBossBar(state, e)) return;
    const barY = cy + sprite.h / 2 - 2;
    if (e.elite) {
      this.drawEliteBars(e, cx, barY);
      drawPoiseGauge(ctx, e, cx, barY + ELITE_BAR_H, ELITE_BAR_W);
      this.drawEliteName(e, cx, top - ELITE_NAME_OFFSET);
      return;
    }
    if (e.hp < e.maxHp) this.drawBar(cx - 8, barY, 16, 2, e.hp / e.maxHp, COLOR_HP, COLOR_HP_BG);
    drawPoiseGauge(ctx, e, cx, barY + 2, 16);
  }

  /** 冷気・凍結・燃焼（drawEnemy が個別に重ねる色）以外の状態異常の色調（毒の緑・濡れの青・宣告の紫 …） */
  private drawStatusTint(
    state: GameState,
    e: Enemy,
    key: string,
    frame: number,
    x: number,
    bottom: number,
    sx: number,
    sy: number,
    rot: number,
    flip: boolean,
  ): void {
    const tint = statusTint(e.status);
    if (!tint || BUILTIN_TINT_KINDS.has(tint.kind)) return;
    this.ctx.globalAlpha = EFFECTS.statusTintAlpha * (0.7 + 0.3 * Math.sin(state.time * STATUS_TINT_SPEED + e.id));
    this.drawAnchored(pick(this.tinted(key, tint.color), frame), x, bottom, sx, sy, rot, flip);
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
    this.ctx.globalAlpha = ELITE.auraAlpha * pulse(state.time + e.id, ELITE_AURA_PULSE_SPEED, ELITE_AURA_PULSE_MIN, 1);
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
    const left = Math.round(cx - w / 2);
    const sy = y - SHIELD_BAR_H;
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(left, sy, w, SHIELD_BAR_H);
    ctx.fillStyle = COLOR_SHIELD_BAR;
    ctx.fillRect(left, sy, Math.round(w * (shield / e.shieldMax)), SHIELD_BAR_H);
    // バーの左にシールドの印
    const icon = this.sprite(SPR.shieldIcon).frames[0];
    if (!icon) return;
    const iw = icon.width * SHIELD_BAR_ICON_SCALE;
    this.drawRotated(icon, left - SHIELD_BAR_ICON_GAP - iw / 2, sy + SHIELD_BAR_H / 2, 0, SHIELD_BAR_ICON_SCALE);
  }

  private drawEliteName(e: Enemy, cx: number, y: number): void {
    if (!e.elite) return;
    const name = eliteDisplayName(e);
    this.shadowText(name, Math.round(cx), Math.round(y), ELITE_COLOR[e.elite], TEXT.SMALL);
  }

  /**
   * 盾を正面に構える。怯み中は下ろす。
   * 防いだ直後（被弾フラッシュ無しで押し返されている間）は盾が白く光る
   */
  private drawKnightShield(state: GameState, e: Enemy, cx: number, cy: number): void {
    if (isStaggered(e)) return;
    const icon = this.sprite(SPR.shieldIcon);
    const sx = cx + e.facing.x * SHIELD_ICON_OFFSET;
    const sy = cy + e.facing.y * SHIELD_ICON_OFFSET;
    const blocking = e.hitFlash <= 0 && Math.hypot(e.knock.x, e.knock.y) > KNIGHT_BLOCK_KNOCK_MIN;
    if (blocking) {
      this.drawGlow(sx, sy, ENEMY_AI.knight.blockColor, KNIGHT_BLOCK_GLOW_R, 1);
      this.drawRotated(icon.white[0], sx, sy, 0, KNIGHT_BLOCK_SCALE);
      return;
    }
    const img = pick(icon.frames, spriteFrame(icon, state.time, SHIELD_FRAME_TIME));
    if (!img) return;
    this.ctx.globalAlpha = SHIELD_ICON_ALPHA;
    this.ctx.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height / 2));
    this.ctx.globalAlpha = 1;
  }

  /** レーザーのチャージ: 細い線が徐々に太く濃くなり、終点に光点。後半は脈打つ */
  private drawLaserTelegraph(state: GameState, e: Enemy, windup: number): void {
    const target = e.ai?.target;
    if (!target) return;
    const { ctx } = this;
    const t = windup > 0 ? clamp01(1 - e.phaseTimer / windup) : 1;
    const thick = t >= ENEMY_AI.laser.thinRatio;
    const color = ENEMY_AI.laser.color;
    ctx.strokeStyle = color;
    ctx.globalAlpha = lerp(LASER_TELEGRAPH_MIN_ALPHA, 1, t);
    ctx.lineWidth = Math.max(1, Math.round(lerp(1, LASER_THICK_W, t)));
    ctx.beginPath();
    ctx.moveTo(e.body.pos.x, e.body.pos.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    const blink = thick ? pulse(state.time, LASER_DOT_SPEED, 0.5, 1) : t;
    this.drawGlow(target.x, target.y, color, LASER_DOT_GLOW_R, blink);
    this.drawGlow(e.body.pos.x, e.body.pos.y, color, LASER_DOT_GLOW_R, t);
    ctx.fillStyle = COLOR_WHITE;
    ctx.globalAlpha = blink;
    const r = Math.max(1, Math.round(LASER_DOT_R * t));
    ctx.fillRect(Math.round(target.x - r / 2), Math.round(target.y - r / 2), r, r);
    ctx.globalAlpha = 1;
  }

  /** Wave 3 の予告の形: 十字（ai.points の各点へ）と扇（strikeDir を中心に） */
  private drawWave3Telegraph(e: Enemy, tele: EnemyTelegraph, coneAlpha: number): void {
    const { ctx } = this;
    if (tele?.kind === "cross") {
      ctx.strokeStyle = COLOR_TELEGRAPH;
      ctx.globalAlpha = CROSS_LINE_ALPHA;
      for (const p of e.ai?.points ?? []) {
        ctx.beginPath();
        ctx.moveTo(e.body.pos.x, e.body.pos.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (tele?.kind !== "cone") return;
    const base = Math.atan2(e.strikeDir.y, e.strikeDir.x);
    const half = (tele.halfDeg * Math.PI) / 180;
    ctx.fillStyle = COLOR_TELEGRAPH;
    ctx.globalAlpha = coneAlpha;
    ctx.beginPath();
    ctx.moveTo(e.body.pos.x, e.body.pos.y);
    ctx.arc(e.body.pos.x, e.body.pos.y, tele.range, base - half, base + half);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** 鎖縛の: 鎖でつながった敵を細い線で結ぶ（触れると冷える） */
  private drawEliteChains(state: GameState): void {
    const { ctx } = this;
    ctx.strokeStyle = ELITE_COLOR.chaining;
    ctx.globalAlpha = ELITE_CHAIN_ALPHA;
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      for (const o of chainPartners(state, e)) {
        ctx.beginPath();
        ctx.moveTo(e.body.pos.x, e.body.pos.y);
        ctx.lineTo(o.body.pos.x, o.body.pos.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
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

  /** 同じ部屋の Linked を脈動する線で結び、線上を光点が行き来する */
  private drawLinks(state: GameState): void {
    const linked = state.enemies.filter((e) => e.elite === "linked" && e.hp > 0 && e.phase !== "spawning");
    if (linked.length < 2) return;
    const { ctx } = this;
    const alpha = pulse(state.time, LINK_SPEED, LINK_ALPHA_MIN, LINK_ALPHA_MAX);
    ctx.strokeStyle = ELITE.linkColor;
    ctx.fillStyle = ELITE.linkColor;
    for (let i = 0; i < linked.length; i++) {
      const a = linked[i];
      if (!a) continue;
      for (let j = i + 1; j < linked.length; j++) {
        const b = linked[j];
        if (!b || b.roomIndex !== a.roomIndex) continue;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(a.body.pos.x, a.body.pos.y);
        ctx.lineTo(b.body.pos.x, b.body.pos.y);
        ctx.stroke();
        ctx.globalAlpha = Math.min(1, alpha + LINK_ALPHA_MIN);
        for (let k = 0; k < LINK_DOT_COUNT; k++) {
          const t = (state.time * LINK_DOT_SPEED + k / LINK_DOT_COUNT) % 1;
          const x = lerp(a.body.pos.x, b.body.pos.x, t);
          const y = lerp(a.body.pos.y, b.body.pos.y, t);
          ctx.fillRect(Math.round(x - LINK_DOT_SIZE / 2), Math.round(y - LINK_DOT_SIZE / 2), LINK_DOT_SIZE, LINK_DOT_SIZE);
        }
      }
    }
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

  /**
   * 爆弾ハザード。出どころで見た目を変える:
   * bomber = 赤い予告円 + 導火線が短くなるほど速く点滅する爆弾、
   * wisp の死亡爆発 = 白い縮む円、Explosive エリートの死亡爆発 = 橙の脈動円 + 縮む白輪
   */
  private drawBomb(state: GameState, h: Hazard): void {
    const style = bombStyle(h);
    if (style === "wispDeath") {
      this.drawShrinkingBlast(h, COLOR_WHITE, WISP_DEATH_ALPHA);
      return;
    }
    const { ctx } = this;
    const t = h.maxTime > 0 ? clamp01(1 - h.time / h.maxTime) : 1;
    const color = style === "eliteDeath" ? ELITE.explodeColor : ENEMY_AI.bomber.color;
    ctx.fillStyle = color;
    ctx.globalAlpha = BOMB_FILL_ALPHA;
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, h.radius * t, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = BOMB_CIRCLE_ALPHA + t * (1 - BOMB_CIRCLE_ALPHA);
    if (style === "eliteDeath") {
      ctx.globalAlpha *= pulse(state.time, ELITE_BOMB_SPEED, 0.5, 1);
      ctx.lineWidth = ELITE_BOMB_RING_W;
    }
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, h.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    if (style === "eliteDeath") {
      this.drawShrinkingBlast(h, COLOR_WHITE, 1);
      return;
    }
    const bomb = this.sprite(SPR.bomb);
    const left = h.maxTime > 0 ? h.time / h.maxTime : 0;
    const frameTime = bombBlinkFrameTime(left, BOMB_FRAME_TIME_SLOW, BOMB_FRAME_TIME_FAST);
    const frame = spriteFrame(bomb, state.time, frameTime);
    this.blit(bomb, frame, h.pos.x - bomb.w / 2, h.pos.y - bomb.h / 2);
    // 導火線の火花（赤く光るフレームで強く）
    this.drawGlow(h.pos.x, h.pos.y - BOMB_SPARK_Y, COLOR_ENERGY, BOMB_SPARK_R, BOMB_SPARK_ALPHA * (frame === 1 ? 1 : 0.5));
  }

  /** 爆発の予告: 爆心へ縮んでいく輪（0 になった瞬間に爆発）と、薄く満ちる爆発範囲 */
  private drawShrinkingBlast(h: Hazard, color: string, alpha: number): void {
    const { ctx } = this;
    const left = h.maxTime > 0 ? clamp01(h.time / h.maxTime) : 0;
    ctx.fillStyle = color;
    ctx.globalAlpha = WISP_DEATH_FILL_ALPHA;
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, h.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, Math.max(1, h.radius * left), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha * (1 - left);
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, h.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** 広がる衝撃波。判定のある縁は太く明るく、内側はごく薄く */
  private drawShockwave(h: Hazard): void {
    const { ctx } = this;
    const r = Math.max(1, shockwaveRadius(h));
    const color = ENEMY_AI.golem.color;
    const thick = ENEMY_AI.golem.ringThickness;
    const spent = h.spent ? SHOCKWAVE_SPENT_ALPHA : 1;
    ctx.fillStyle = color;
    ctx.globalAlpha = SHOCKWAVE_FILL_ALPHA * spent;
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, Math.max(1, r - thick / 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = SHOCKWAVE_OUTER_ALPHA * spent;
    ctx.lineWidth = thick + SHOCKWAVE_OUTER_PAD;
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = SHOCKWAVE_ALPHA * spent;
    ctx.lineWidth = thick;
    ctx.stroke();
    ctx.strokeStyle = COLOR_WHITE;
    ctx.globalAlpha = SHOCKWAVE_CORE_ALPHA * spent;
    ctx.lineWidth = 1;
    ctx.stroke();
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
      this.drawLaserGlow(h);
    }
  }

  /** 照射中のレーザー: 外側の薄い光と、両端の発光 */
  private drawLaserGlow(h: Hazard): void {
    const { ctx } = this;
    const color = ENEMY_AI.laser.color;
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = color;
    ctx.globalAlpha = LASER_OUTER_ALPHA;
    ctx.lineWidth = h.radius * 2 + LASER_OUTER_W;
    ctx.beginPath();
    ctx.moveTo(h.pos.x, h.pos.y);
    ctx.lineTo(h.to.x, h.to.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    this.drawGlow(h.pos.x, h.pos.y, color, LASER_END_GLOW_R, 1);
    this.drawGlow(h.to.x, h.to.y, color, LASER_END_GLOW_R, 1);
    this.drawGlow(h.to.x, h.to.y, COLOR_WHITE, LASER_END_CORE_R, 1);
  }

  /** 追跡者: 大きな紫の wisp。半透明で脈打ち、長い残像を引く */
  private drawReaper(state: GameState): void {
    const r = state.reaper;
    if (!r || !reaperBodyVisible(r)) return;
    this.drawReaperChain(r);
    const wisp = this.sprite(SPR.wisp);
    const frames = this.tinted(SPR.wisp, REAPER.color, REAPER_TINT);
    const img = pick(frames, spriteFrame(wisp, r.animTime, ENEMY_FRAME_TIME));
    const { ctx } = this;
    const n = this.reaperTrail.length;
    for (let i = n - 1; i >= 1; i--) {
      const p = this.reaperTrail[i];
      if (!p) continue;
      const k = 1 - i / n;
      ctx.globalAlpha = REAPER_TRAIL_ALPHA * k;
      this.drawRotated(img, p.x, p.y, 0, REAPER_SCALE * (1 - REAPER_TRAIL_SHRINK * (1 - k)));
    }
    this.drawGlow(r.pos.x, r.pos.y, REAPER.color, r.radius * REAPER_SCALE, REAPER_ALPHA_MIN);
    ctx.globalAlpha = pulse(state.time, REAPER_PULSE_SPEED, REAPER_ALPHA_MIN, REAPER_ALPHA_MAX);
    const bob = Math.sin(r.animTime * FLOAT_BOB_SPEED) * FLOAT_BOB_AMOUNT;
    this.drawRotated(img, r.pos.x, r.pos.y + bob, 0, REAPER_SCALE);
    // 双子の死神のもう 1 体
    if (r.twin) this.drawRotated(img, r.twin.x, r.twin.y - bob, 0, REAPER_SCALE);
    ctx.globalAlpha = 1;
  }

  /** 鎖の死神: 鎖を投げる前の予告線（溜めの間だけ） */
  private drawReaperChain(r: NonNullable<GameState["reaper"]>): void {
    if (!r.aim || (r.charging ?? 0) <= 0) return;
    const { ctx } = this;
    ctx.strokeStyle = REAPER.variants.chain.color;
    ctx.globalAlpha = CROSS_LINE_ALPHA;
    ctx.lineWidth = REAPER.variants.chain.width;
    ctx.beginPath();
    ctx.moveTo(r.pos.x, r.pos.y);
    ctx.lineTo(r.aim.x, r.aim.y);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
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
    // 射撃の属性で残像の色を変える（無属性は弾の色のまま）
    const rangedElement = state.projectiles.length > 0 ? hitElement(state, "ranged", false) : "none";
    const rangedTrail = rangedElement === "none" ? null : ELEMENT_FX_COLOR[rangedElement];
    for (const pr of state.projectiles) {
      const speed = Math.hypot(pr.vel.x, pr.vel.y);
      const dx = speed > 0 ? pr.vel.x / speed : 1;
      const dy = speed > 0 ? pr.vel.y / speed : 0;

      const isPlayer = pr.owner === "player";
      // 曲射は山なりに持ち上げて描き、地面の位置に影を落とす（当たり判定は着弾点だけ）
      const lift = this.lobLift(pr);
      if (lift > 0) this.drawLobShadow(pr.pos.x, pr.pos.y);
      const py = pr.pos.y - lift;
      // 位置履歴が無いので速度の逆方向に残像を置く
      ctx.fillStyle = isPlayer ? (rangedTrail ?? pr.color) : COLOR_ENEMY_TRAIL;
      for (let i = 1; i <= TRAIL_POINTS; i++) {
        const size = Math.max(1, Math.round(pr.radius * 2 * (1 - i / (TRAIL_POINTS + 1))));
        ctx.globalAlpha = TRAIL_ALPHA * (1 - i / (TRAIL_POINTS + 1));
        const tx = pr.pos.x - dx * TRAIL_SPACING * i;
        const ty = py - dy * TRAIL_SPACING * i;
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
      this.drawRotated(frames[0], pr.pos.x, py, Math.atan2(dy, dx), scale);
    }
  }

  /** 曲射の弾の見かけの高さ（px）。曲射以外は 0 */
  private lobLift(pr: Projectile): number {
    const runtime = pr.shot;
    const peak = runtime ? SHOT_TYPES[runtime.key].lob?.peak : undefined;
    if (!runtime || peak === undefined) return 0;
    return lobHeight(runtime, pr.life, peak);
  }

  private drawLobShadow(x: number, y: number): void {
    const { ctx } = this;
    ctx.fillStyle = COLOR_BLACK;
    ctx.globalAlpha = LOB_SHADOW_ALPHA;
    ctx.beginPath();
    ctx.ellipse(x, y, LOB_SHADOW_RX, LOB_SHADOW_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // プレイヤー
  // ---------------------------------------------------------------------------

  private drawPlayer(state: GameState): void {
    const p = state.player;
    if (state.status === "dead") return;
    const sprite = this.sprite(SPR.player);
    const cx = p.body.pos.x;
    const bottom = spriteFeetY(p.body.pos.y, p.body.radius) - PLAYER_SPRITE_LIFT;

    this.drawBuffAura(state, p);
    this.drawShadow(cx, bottom - 1);
    this.drawAimGuide(state);

    const moving = p.body.vel.x !== 0 || p.body.vel.y !== 0;
    const walkFrame = moving ? spriteFrame(sprite, p.walkTime, WALK_FRAME_TIME) : 0;
    const flip = p.facing.x < 0;
    const dashing = isDashing(p);
    if (dashing) this.drawDashGhosts(p, sprite, walkFrame, cx, bottom, flip);

    // 構え・振り抜きの原画（無ければ歩きのまま）。docs/ideas/combat-feel-design.md C-4
    const swing = this.playerSwing(state);
    const bodyPose = playerBodyPose(swing.phase, swing.t, p.attack.charging);
    const posed = bodyPose === "walk" ? undefined : this.atlas[poseKey(SPR.player, bodyPose)];
    const body = posed ?? sprite;
    const frame = posed ? 0 : walkFrame;
    const held = this.heldWeaponPose(state, swing);

    // 被弾無敵中は点滅（ダッシュ無敵は点滅させない）
    const blink = p.invulnTimer > 0 && !dashing && p.hitFlash <= 0 && state.tick % 6 < 3;
    if (!blink && held.behind) this.drawHeldWeapon(state, held);
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
      } else if (p.swingImpact > 0) {
        // 近接命中の直後、攻撃方向へ一瞬伸びる（docs/ideas/combat-feel-design.md D-5）
        sx = SQUASH_X;
        sy = SQUASH_Y;
      }
      this.drawAnchored(pick(hit ? body.white : body.frames, frame), cx, bottom, sx, sy, 0, flip);
    }
    if (!blink && !held.behind) this.drawHeldWeapon(state, held);

    if (isAttacking(p) && p.attack.phase === "active") this.drawSlash(state, p);
    this.drawChargeRing(state, p);
  }

  /** 今の振りの段階と進み・形。溜め中は予備動作の終わりで止める（C-2） */
  private playerSwing(state: GameState): { phase: SwingPhase; t: number; shape: HitShape; step: number } {
    const p = state.player;
    const moveset = playerMoveset(state);
    if (p.attack.charging) return { phase: "windup", t: 1, shape: moveset.charge?.step.shape ?? moveset.steps[0]?.shape ?? SHAPE_ARC, step: 0 };
    const step = currentMeleeStep(state);
    if (!step || !isAttacking(p)) return { phase: "none", t: 0, shape: moveset.steps[0]?.shape ?? SHAPE_ARC, step: 0 };
    return { phase: p.attack.phase, t: phaseProgress(p.attack.phase, p.attack.timer, step), shape: step.shape, step: p.attack.step };
  }

  private heldWeaponPose(state: GameState, swing: { phase: SwingPhase; t: number; shape: HitShape; step: number }): WeaponPose {
    const p = state.player;
    const aimVec = swing.phase === "none" ? p.facing : p.attack.dir;
    return weaponPose({
      phase: swing.phase,
      t: swing.t,
      shape: swing.shape.kind,
      deg: swing.shape.kind === "arc" ? swing.shape.deg : 0,
      aim: Math.atan2(aimVec.y, aimVec.x),
      step: swing.step,
      facingRight: p.facing.x >= 0,
      aimHeld: playerMoveset(state).primary === "shot",
    });
  }

  /** 手に持つ武器（docs/ideas/combat-feel-design.md C-1）。二丁拳銃は照準に直交して 2 挺並べる */
  private drawHeldWeapon(state: GameState, pose: WeaponPose): void {
    const p = state.player;
    const moveset = playerMoveset(state);
    const key = weaponSpriteKey(moveset.key);
    const sprite = this.atlas[key];
    if (!sprite) return;
    const level = p.attack.charging ? meleeChargeLevel(state) : 0;
    const frames = level > 0 ? this.tinted(key, WEAPON.chargeRingColors[level] ?? COLOR_WHITE, CHARGE_WEAPON_TINT) : sprite.frames;
    const img = frames[pose.frame];
    if (!img) return;
    const hx = p.body.pos.x + pose.dx;
    const hy = p.body.pos.y + pose.dy;
    if (!isShotOnly(moveset)) {
      this.drawWeaponImage(img, hx, hy, pose);
      return;
    }
    for (const side of GUN_SIDES) {
      const o = offhandOffset(pose.angle, WEAPON.movesets.gunner.muzzleOffset, side);
      this.drawWeaponImage(img, hx + o.x, hy + o.y, pose);
    }
  }

  /** 拳の中心を (hx, hy) に合わせ、反転だけで向きを作って描く（回転しないので画素が崩れない） */
  private drawWeaponImage(img: HTMLCanvasElement, hx: number, hy: number, pose: WeaponPose): void {
    const grip = weaponGrip(pose);
    const x = Math.round(hx - grip.x);
    const y = Math.round(hy - grip.y);
    const { ctx } = this;
    if (!pose.flipX && !pose.flipY) {
      ctx.drawImage(img, x, y);
      return;
    }
    ctx.save();
    ctx.translate(x + (pose.flipX ? img.width : 0), y + (pose.flipY ? img.height : 0));
    ctx.scale(pose.flipX ? -1 : 1, pose.flipY ? -1 : 1);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
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

  /**
   * 斬撃スプライトを攻撃方向へ回転し、active の残り時間でフェードする。
   * 絵は当たり判定の形と段で選び（renderMath.ts の slashVisual）、太さは武器種、色は属性（C-3）
   */
  private drawSlash(state: GameState, p: Player): void {
    const step = currentMeleeStep(state);
    if (!step) return;
    const moveset = playerMoveset(state);
    const anchor = meleeAnchor(p, step);
    const finalStep = p.attack.branch < 0 && !p.dashStrike && p.attack.step >= moveset.steps.length - 1;
    const finisher = finalStep || step.heavy || p.attack.chargeLevel > 0;
    const deg = step.shape.kind === "arc" ? step.shape.deg : 0;
    const visual = slashVisual(step.shape.kind, deg, p.attack.step, finisher, slashWeight(WEAPON_TRAIL_WIDTH[moveset.key]));
    const sprite = this.sprite(visual.key);
    const color = this.slashColor(state, step);
    const cx = anchor.pos.x;
    const cy = anchor.pos.y;
    const angle = Math.atan2(p.attack.dir.y, p.attack.dir.x);
    // 突きは長さを届く距離に、太さを当たり判定の幅に合わせる。他は一辺を当たり判定に合わせる
    const sx = anchor.size / sprite.w;
    const sy = (step.shape.kind === "thrust" ? step.size / sprite.h : sx) * (visual.flipY ? -1 : 1);
    const t = step.active > 0 ? Math.min(1, Math.max(0, p.attack.timer / step.active)) : 0;
    const { ctx } = this;
    this.drawMeleeShape(p, step, t);
    this.drawSwingTrail(state, p, step, t);

    if (finisher && t > SLASH_AFTERIMAGE_T) {
      ctx.globalAlpha = SLASH_AFTERIMAGE_ALPHA;
      this.drawRotatedScaled(sprite.white[visual.frame], cx, cy, angle + SLASH_AFTERIMAGE_ROT * Math.sign(sy), sx, sy);
    }
    ctx.globalAlpha = SLASH_MIN_ALPHA + (1 - SLASH_MIN_ALPHA) * t;
    this.drawRotatedScaled(this.tinted(visual.key, color, SLASH_TINT)[visual.frame], cx, cy, angle, sx, sy);
    ctx.globalAlpha = 1;
  }

  /** 斬撃と軌跡の色: 属性が乗っていれば属性色、無ければ段の残像色、どちらも無ければ既定 */
  private slashColor(state: GameState, step: MeleeStep): string {
    const element = hitElement(state, "melee", false);
    if (element !== "none") return ELEMENT_FX_COLOR[element];
    return step.trail ?? SLASH_DEFAULT_COLOR;
  }

  /** 中心基準で回転し、x / y を別々に拡縮して描く（負の倍率で反転） */
  private drawRotatedScaled(img: HTMLCanvasElement | undefined, cx: number, cy: number, rot: number, sx: number, sy: number): void {
    if (!img) return;
    const { ctx } = this;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
  }

  /** 武器種の当たり判定の形を薄く縁取る（扇・突き・円。箱は斬撃スプライトだけで足りる） */
  private drawMeleeShape(p: Player, step: MeleeStep, t: number): void {
    if (step.shape.kind === "box") return;
    const { ctx } = this;
    const o = p.body.pos;
    const dir = Math.atan2(p.attack.dir.y, p.attack.dir.x);
    ctx.strokeStyle = COLOR_WHITE;
    ctx.lineWidth = 1;
    ctx.globalAlpha = MELEE_SHAPE_ALPHA * t;
    ctx.beginPath();
    if (step.shape.kind === "arc") {
      const half = (step.shape.deg * Math.PI) / 360;
      ctx.moveTo(o.x, o.y);
      ctx.arc(o.x, o.y, step.reach, dir - half, dir + half);
      ctx.closePath();
    } else if (step.shape.kind === "thrust") {
      const nx = -p.attack.dir.y * (step.size / 2);
      const ny = p.attack.dir.x * (step.size / 2);
      const ex = o.x + p.attack.dir.x * step.reach;
      const ey = o.y + p.attack.dir.y * step.reach;
      ctx.moveTo(o.x + nx, o.y + ny);
      ctx.lineTo(ex + nx, ey + ny);
      ctx.lineTo(ex - nx, ey - ny);
      ctx.lineTo(o.x - nx, o.y - ny);
      ctx.closePath();
    } else {
      const cx = o.x + p.attack.dir.x * step.reach;
      const cy = o.y + p.attack.dir.y * step.reach;
      ctx.arc(cx, cy, step.size / 2, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * 武器種ごとの振りの軌跡（docs/ideas/meta-and-weapons.md 7-1）。太さは武器種、色は近接の属性（無ければ段の残像色）。
   * 大剣 = 太い弧、槍 = 細い突きの線、鞭 = しなる曲線、鎌 = 三日月（弧を 2 重）
   */
  private drawSwingTrail(state: GameState, p: Player, step: MeleeStep, t: number): void {
    const { ctx } = this;
    const moveset = state.stats.moveset;
    const progress = 1 - t;
    const o = p.body.pos;
    const d = p.attack.dir;
    ctx.strokeStyle = this.slashColor(state, step);
    ctx.lineWidth = WEAPON_TRAIL_WIDTH[moveset];
    ctx.globalAlpha = EFFECTS.trailAlpha * (0.4 + 0.6 * t);
    ctx.beginPath();
    if (moveset === "whip") {
      const ex = o.x + d.x * step.reach;
      const ey = o.y + d.y * step.reach;
      const bend = Math.sin(progress * Math.PI) * WHIP_BEND;
      ctx.moveTo(o.x, o.y);
      ctx.quadraticCurveTo((o.x + ex) / 2 - d.y * bend, (o.y + ey) / 2 + d.x * bend, ex, ey);
    } else if (step.shape.kind === "thrust") {
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x + d.x * step.reach * progress, o.y + d.y * step.reach * progress);
    } else if (step.shape.kind === "arc") {
      const dir = Math.atan2(d.y, d.x);
      const half = (step.shape.deg * Math.PI) / 360;
      // 段ごとに振る向きを変える（左右の往復に見せる。手に持つ武器の振りと同じ規則）
      const sign = swingSign(p.attack.step);
      const from = dir - sign * half;
      const to = from + sign * 2 * half * progress;
      const r = step.reach * TRAIL_REACH_RATIO;
      ctx.arc(o.x, o.y, r, Math.min(from, to), Math.max(from, to));
      if (moveset === "scythe") ctx.arc(o.x, o.y, r * SCYTHE_INNER_RATIO, Math.max(from, to), Math.min(from, to), true);
    } else {
      ctx.arc(o.x + d.x * step.reach, o.y + d.y * step.reach, (step.size / 2) * (0.6 + 0.4 * progress), 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  /** 溜めの段の目盛り: 頭上に段の数だけ点を並べ、届いた段を塗る */
  private drawChargePips(state: GameState, p: Player, level: number): void {
    const levels = p.attack.charging
      ? (MOVESETS[state.stats.moveset].charge?.levels.length ?? 0)
      : (SHOT_TYPES[state.stats.shot].charge?.levels.length ?? 0);
    if (levels <= 0) return;
    const { ctx } = this;
    const left = p.body.pos.x - ((levels - 1) * CHARGE_PIP_GAP) / 2;
    const y = Math.round(p.body.pos.y - CHARGE_PIP_Y);
    for (let i = 0; i < levels; i++) {
      const lit = i < level;
      ctx.fillStyle = lit ? (WEAPON.chargeRingColors[i + 1] ?? COLOR_WHITE) : COLOR_DIM;
      const size = lit ? 3 : 2;
      ctx.fillRect(Math.round(left + i * CHARGE_PIP_GAP) - 1, y - 1, size, size);
    }
  }

  /** 溜め攻撃・チャージ射撃の環。段が上がるほど大きく色が変わり、離す時を目で計れる */
  private drawChargeRing(state: GameState, p: Player): void {
    const charging = p.attack.charging || p.shotCharging;
    if (!charging) return;
    const level = Math.max(meleeChargeLevel(state), shotChargeLevel(state));
    const { ctx } = this;
    ctx.strokeStyle = WEAPON.chargeRingColors[level] ?? COLOR_WHITE;
    ctx.lineWidth = 1;
    ctx.globalAlpha = pulse(state.time, CHARGE_RING_SPEED, CHARGE_RING_MIN, CHARGE_RING_MAX);
    ctx.beginPath();
    ctx.arc(p.body.pos.x, p.body.pos.y, WEAPON.chargeRingRadius + level * WEAPON.chargeRingStep, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.drawChargePips(state, p, level);
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
    if (playing && reaperWarning(state)) {
      // 出現が近いほど速く濃く脈打つ
      const near = 1 - clamp01(reaperTimeLeft(state) / REAPER.warnMargin);
      const speed = lerp(REAPER_EDGE_SPEED_MIN, REAPER_EDGE_SPEED_MAX, near);
      ctx.globalAlpha = pulse(state.time, speed, REAPER_EDGE_MIN, lerp(REAPER_EDGE_MIN, REAPER_EDGE_MAX, near));
      ctx.drawImage(this.edgePurple, 0, 0);
    }
    if (state.flash > 0 && !this.wipeActive) {
      // 被弾中の flash は赤、それ以外（JUST・ボス撃破など）は白。階層移動は黒帯ワイプ（drawFloorWipe）
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

    this.blit(this.sprite(SPR.heartSmall), 0, HUD_X, HUD_HP_Y - 1);
    this.drawBar(HUD_BAR_X, HUD_HP_Y, HUD_BAR_W, HUD_HP_H, p.hp / p.maxHp, COLOR_HP, COLOR_HP_BG);
    this.drawRegain(state);
    // 状態異常の列は HP バーの真上（8×8 の枠が画面上端から HP バーまでに収まる）
    drawPlayerStatusRow(ctx, p.status, HUD_BAR_X, 0);
    drawManaBar(ctx, state, HUD_BAR_X, HUD_MANA_Y, HUD_BAR_W, HUD_MANA_H);
    const hpText = `${Math.ceil(p.hp)}/${p.maxHp}`;
    drawText(ctx, hpText, HUD_TEXT_X, HUD_HP_Y + HUD_HP_H, TEXT.SMALL, COLOR_TEXT);
    // 未振りの点はマナバーの横（HP の数値の右）に。振るのは装備画面（Tab）
    drawUnspentHud(ctx, state, HUD_TEXT_X + textWidth(hpText, TEXT.SMALL) + HUD_UNSPENT_GAP, HUD_HP_Y + HUD_HP_H);

    const ready = p.energy >= p.maxEnergy;
    const blinkOn = state.tick % HUD_BLINK_TICKS < HUD_BLINK_TICKS / 2;
    const energyColor = ready && blinkOn ? COLOR_ENERGY_READY : COLOR_ENERGY;
    this.drawBar(HUD_BAR_X, HUD_ENERGY_Y, HUD_BAR_W, HUD_ENERGY_H, p.energy / p.maxEnergy, energyColor, COLOR_ENERGY_BG);
    if (ready) {
      ctx.strokeStyle = blinkOn ? COLOR_ENERGY : COLOR_ENERGY_READY;
      ctx.strokeRect(HUD_BAR_X - 0.5, HUD_ENERGY_Y - 0.5, HUD_BAR_W + 1, HUD_ENERGY_H + 1);
      drawText(ctx, "F: バースト", HUD_TEXT_X, HUD_ENERGY_Y + HUD_ENERGY_H + 1, TEXT.SMALL, energyColor);
    }
    this.drawDashPips(state);
    this.drawKeystoneHud(state);

    // 拠点（sandbox）はミニマップと階層・スコア・シードの欄を出さない（右上は拠点の飾りが使う）
    if (this.lookup && !state.sandbox) this.minimap.draw(ctx, state, this.lookup, VIEW_W);
    const rightY = this.hudRightY(state);
    const rightX = VIEW_W - HUD_RIGHT_X_PAD;
    const line = this.hudRightLine();
    if (!state.sandbox) this.drawHudRightPanel(state, rightX, rightY, line);

    if (state.combo.count > 1) {
      const pop = 1 + state.combo.popTimer * 3;
      const fading = state.combo.timer < 0.6;
      const comboColor = fading && state.tick % 8 < 4 ? COLOR_DIM : COLOR_ENERGY;
      const comboM = Math.min(TEXT.BIG, pixelText().sizeFor(COMBO_TEXT_PX * pop));
      drawText(ctx, `${state.combo.count} ヒット`, VIEW_W / 2, COMBO_TEXT_Y, comboM, comboColor, "center");
      const multY = COMBO_TEXT_Y + Math.max(COMBO_MULT_GAP, this.textLine(TEXT.SMALL));
      drawText(ctx, `x${comboMultiplier(state.combo.count).toFixed(1)}`, VIEW_W / 2, multY, TEXT.SMALL, COLOR_TEXT, "center");
    }

    this.drawBossHud(state);
    this.drawReaperHud(state);
    drawRunHud(ctx, state);
    drawRunSetupHud(ctx, state, rightX, rightY + line * HUD_RUN_SETUP_LINE);
    drawComboHud(ctx, state);

    if (state.rooms.some((r) => r.locked)) {
      drawText(ctx, "― 封鎖中 ―", VIEW_W / 2, VIEW_H - 8, TEXT.SMALL, COLOR_LOCK, "center");
    }

    const last = state.log[state.log.length - 1];
    if (last && state.time - last.time < 4) {
      drawText(ctx, last.text, 8, VIEW_H - 8, TEXT.SMALL, last.color);
    }
  }

  /** 右上の階層・スコア・シード・呪い・共鳴の欄 */
  private drawHudRightPanel(state: GameState, rightX: number, rightY: number, line: number): void {
    const m = TEXT.SMALL;
    const { ctx } = this;
    const ascent = Math.max(HUD_PANEL_ASCENT, baselineOffset("alphabetic", m, this.pixelRatio));
    const depthText = `地下 ${state.depth} 階 · ${FLOOR_KIND_LABEL_JA[state.floorKind]}`;
    const scoreText = `スコア ${state.score}`;
    const seedText = `シード ${state.seedText}`;
    const panelW =
      Math.ceil(Math.max(textWidth(depthText, m), textWidth(scoreText, m), textWidth(seedText, m))) +
      HUD_PANEL_PAD * 2;
    ctx.globalAlpha = HUD_PANEL_ALPHA;
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(
      rightX - panelW + HUD_PANEL_PAD,
      rightY - ascent - HUD_PANEL_PAD,
      panelW,
      line * 2 + ascent + HUD_PANEL_PAD * 2,
    );
    ctx.globalAlpha = 1;
    this.shadowText(depthText, rightX, rightY, COLOR_TEXT, m, "right");
    this.shadowText(scoreText, rightX, rightY + line, COLOR_HUD_SCORE, m, "right");
    this.shadowText(seedText, rightX, rightY + line * 2, COLOR_HUD_SEED, m, "right");
    if (state.cursed) {
      this.shadowText("呪い: 次の部屋の精鋭 x2", rightX, rightY + line * HUD_CURSED_LINE, ROOM_KIND.cursedColor, m, "right");
    }
    if (state.stats.resonance.kind !== "none") {
      this.shadowText(describeResonance(state.stats.resonance)[0] ?? "", rightX, rightY + line * HUD_RESONANCE_LINE, COLOR_TEXT, m, "right");
    }
  }

  /** ボス戦中は画面上部にセグメント付きの HP バー。ロック直後は黒帯 + 名前のスライドイン */
  private drawBossHud(state: GameState): void {
    const b = state.boss;
    if (!b || b.defeated) return;
    const boss = bossEnemy(state);
    const room = state.rooms[b.roomIndex];
    if (!boss || !room?.locked) return;
    this.drawBossBar(state, b, boss);
    this.drawBossBanner(b);
  }

  /** 遅れて減る白っぽい帯・目盛り・フェーズ境界の印。フェーズ移行の瞬間は白く光る */
  private drawBossBar(state: GameState, b: BossState, boss: Enemy): void {
    const { ctx } = this;
    const x = Math.round((VIEW_W - BOSS_BAR_W) / 2);
    const y = BOSS_BAR_Y;
    const ratio = boss.maxHp > 0 ? clamp01(boss.hp / boss.maxHp) : 0;
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(x - BOSS_BAR_FRAME, y - BOSS_BAR_FRAME, BOSS_BAR_W + BOSS_BAR_FRAME * 2, BOSS_BAR_H + BOSS_BAR_FRAME * 2);
    ctx.fillStyle = COLOR_BOSS_BAR_BG;
    ctx.fillRect(x, y, BOSS_BAR_W, BOSS_BAR_H);
    ctx.fillStyle = COLOR_BOSS_TRAIL;
    ctx.fillRect(x, y, Math.round(BOSS_BAR_W * Math.max(ratio, this.bossTrail)), BOSS_BAR_H);
    const filled = Math.round(BOSS_BAR_W * ratio);
    ctx.fillStyle = COLOR_BOSS_BAR;
    ctx.fillRect(x, y, filled, BOSS_BAR_H);
    ctx.fillStyle = COLOR_BOSS_BAR_HI;
    ctx.fillRect(x, y, filled, 1);
    ctx.fillStyle = COLOR_BOSS_TICK;
    for (let i = 1; i < BOSS_BAR_SEGMENTS; i++) {
      ctx.fillRect(x + Math.round((BOSS_BAR_W * i) / BOSS_BAR_SEGMENTS), y, 1, BOSS_BAR_H);
    }
    const threshold = bossPhaseThreshold(enemyDef(boss.defKey).behavior);
    if (threshold !== null && this.bossStage === 1) {
      ctx.fillStyle = COLOR_BOSS_PHASE_TICK;
      ctx.fillRect(x + Math.round(BOSS_BAR_W * threshold), y - BOSS_BAR_FRAME, 1, BOSS_BAR_H + BOSS_BAR_FRAME * 2);
    }
    const since = state.time - this.bossPhaseFlashAt;
    if (since >= 0 && since < BOSS_PHASE_FLASH_TIME) {
      ctx.globalAlpha = 1 - since / BOSS_PHASE_FLASH_TIME;
      ctx.fillStyle = COLOR_WHITE;
      ctx.fillRect(x - BOSS_BAR_FRAME, y - BOSS_BAR_FRAME, BOSS_BAR_W + BOSS_BAR_FRAME * 2, BOSS_BAR_H + BOSS_BAR_FRAME * 2);
      ctx.globalAlpha = 1;
    }
    this.shadowText(b.name, VIEW_W / 2, y - 3, COLOR_BOSS_NAME, TEXT.SMALL);
    drawBossPoiseGauge(ctx, boss, x, y + BOSS_BAR_H + BOSS_BAR_FRAME, BOSS_BAR_W);
  }

  /** 登場時の上下の黒帯（HUD より奥に描く） */
  private drawBossLetterbox(state: GameState): void {
    const b = state.boss;
    if (!b || b.defeated || b.introTimer <= 0) return;
    const ph = bossIntroPhase(b.introTimer, BOSS.introTime);
    const h = Math.round(BOSS_LETTERBOX_H * ph.bars);
    if (h <= 0) return;
    const { ctx } = this;
    ctx.globalAlpha = ph.alpha;
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(0, 0, VIEW_W, h);
    ctx.fillRect(0, VIEW_H - h, VIEW_W, h);
    ctx.globalAlpha = 1;
  }

  /** 中央の黒帯に "- BOSS -" と名前が左右から滑り込む */
  private drawBossBanner(b: BossState): void {
    if (b.introTimer <= 0) return;
    const ph = bossIntroPhase(b.introTimer, BOSS.introTime);
    if (ph.alpha <= 0) return;
    const { ctx } = this;
    const bandH = Math.round(BOSS_BAND_H * ph.bars);
    const top = Math.round(BOSS_BANNER_Y - bandH / 2);
    ctx.globalAlpha = ph.alpha * BOSS_BAND_ALPHA;
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(0, top, VIEW_W, bandH);
    ctx.globalAlpha = ph.alpha;
    ctx.fillStyle = COLOR_BOSS_BANNER;
    ctx.fillRect(0, top, VIEW_W, 1);
    ctx.fillRect(0, top + bandH - 1, VIEW_W, 1);

    const center = VIEW_W / 2;
    const nameX = Math.round(lerp(-center, center, ph.slide));
    const labelX = Math.round(lerp(VIEW_W + center, center, ph.slide));
    this.shadowText(BOSS_LABEL, labelX, BOSS_BANNER_Y - BOSS_LABEL_GAP + BOSS_NAME_SHADOW, COLOR_BOSS_BANNER, TEXT.SMALL);
    const nameY = BOSS_BANNER_Y + BOSS_BANNER_NAME_GAP / 2;
    drawTextShadow(ctx, b.name, nameX, nameY, TEXT.BIG, COLOR_BOSS_NAME, COLOR_BLACK, "center", BOSS_NAME_SHADOW);
    ctx.globalAlpha = 1;
  }

  /** 撃破: 白いシルエットが膨らみながら消え、白い輪が時間差で広がる */
  private drawBossDeath(state: GameState): void {
    const at = this.bossDefeatAt;
    const snap = this.bossSnap;
    if (at === null || !snap) return;
    const t = (state.time - at) / BOSS_DEATH_TIME;
    if (t < 0 || t >= 1) return;
    const { ctx } = this;
    const grow = 1 + (BOSS_DEATH_GROW - 1) * easeOutCubic(t);
    ctx.globalAlpha = 1 - t;
    const cy = snap.bottom - snap.img.height / 2;
    ctx.save();
    ctx.translate(Math.round(snap.x), Math.round(cy));
    ctx.scale(snap.flip ? -grow : grow, grow);
    ctx.drawImage(snap.img, -snap.img.width / 2, -snap.img.height / 2);
    ctx.restore();
    ctx.strokeStyle = COLOR_WHITE;
    for (let i = 0; i < BOSS_DEATH_RINGS; i++) {
      const rt = (state.time - at - i * BOSS_DEATH_RING_DELAY) / BOSS_DEATH_TIME;
      if (rt <= 0 || rt >= 1) continue;
      ctx.globalAlpha = 1 - rt;
      ctx.lineWidth = BOSS_DEATH_RINGS - i;
      ctx.beginPath();
      ctx.arc(snap.x, cy, BOSS_DEATH_RING_R * easeOutCubic(rt), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    this.drawGlow(snap.x, cy, COLOR_WHITE, BOSS_DEATH_RING_R / 2, 1 - t);
  }

  /** 階層移動: 上下の黒帯が閉じて開く（時間は state.flash の減衰）。帯の縁に細い光 */
  private drawFloorWipe(state: GameState): void {
    if (!this.wipeActive) return;
    // 祝福 3 択の間は step が止まり flash が減衰しないので、閉じたまま待つ
    const cover = state.boonChoice ? 1 : floorWipeCover(state.flash);
    const h = Math.round((VIEW_H / 2) * cover);
    if (h <= 0) return;
    const { ctx } = this;
    ctx.fillStyle = COLOR_BLACK;
    ctx.fillRect(0, 0, VIEW_W, h);
    ctx.fillRect(0, VIEW_H - h, VIEW_W, h);
    if (cover >= 1) return;
    ctx.globalAlpha = WIPE_EDGE_ALPHA;
    ctx.fillStyle = COLOR_WHITE;
    ctx.fillRect(0, h, VIEW_W, 1);
    ctx.fillRect(0, VIEW_H - h - 1, VIEW_W, 1);
    ctx.globalAlpha = 1;
  }

  /** 右上 HUD の 1 行目（ミニマップの下） */
  private hudRightY(state: GameState): number {
    return Minimap.bottom(state) + HUD_RIGHT_GAP;
  }

  /** 右上 HUD の行送り（ドット文字の行高より詰めない） */
  private hudRightLine(): number {
    return Math.max(HUD_RIGHT_LINE, this.textLine(TEXT.SMALL));
  }

  private textLine(m: number): number {
    return pixelText().lineHeight(m, this.pixelRatio);
  }

  /** Reaper 出現までの残り秒（警告時間以降）と、出現中の警告 */
  private drawReaperHud(state: GameState): void {
    const { ctx } = this;
    const reaperY = this.hudRightY(state) + this.hudRightLine() * HUD_REAPER_LINE;
    const rightX = VIEW_W - HUD_RIGHT_X_PAD;
    if (state.reaper) {
      const color = state.tick % HUD_BLINK_TICKS < HUD_BLINK_TICKS / 2 ? REAPER.color : COLOR_WARN;
      drawText(ctx, "死神出現！ 階段へ急げ", rightX, reaperY, TEXT.SMALL, color, "right");
      return;
    }
    if (!reaperWarning(state)) return;
    this.shadowText(`死神まで ${Math.ceil(reaperTimeLeft(state))} 秒`, rightX, reaperY, REAPER.color, TEXT.SMALL, "right");
    if (state.status !== "playing") return;
    ctx.globalAlpha = pulse(state.time, REAPER_PULSE_SPEED, REAPER_ALPHA_MIN, 1);
    this.shadowText(REAPER_WARN_TEXT, VIEW_W / 2, REAPER_WARN_Y, REAPER.color, TEXT.TITLE);
    ctx.globalAlpha = 1;
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
    if (this.hudKeystoneText) {
      drawText(ctx, this.hudKeystoneText, HUD_X, HUD_KEYSTONE_Y, TEXT.SMALL, COLOR_KEYSTONE);
    }
    if (this.hudConflictText) {
      const color = state.tick % HUD_BLINK_TICKS < HUD_BLINK_TICKS / 2 ? COLOR_WARN : COLOR_DIM;
      const y = HUD_KEYSTONE_Y + Math.max(HUD_WARN_Y - HUD_KEYSTONE_Y, this.textLine(TEXT.SMALL));
      drawText(ctx, this.hudConflictText, HUD_X, y, TEXT.SMALL, color);
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
    this.hudConflictText = inactive.length > 0 ? `排他グループが競合: ${inactive.join("、")} は無効` : "";
  }

  /** リゲイン（取り戻せる HP）を現在 HP の右に薄いオレンジで。消える直前は点滅 */
  private drawRegain(state: GameState): void {
    const p = state.player;
    if (p.regainTimer <= 0 || p.regainPool <= 0 || p.maxHp <= 0) return;
    const blinking = p.regainTimer < REGAIN_BLINK_TIME;
    if (blinking && state.tick % HUD_BLINK_TICKS >= HUD_BLINK_TICKS / 2) return;
    const clamp = (v: number): number => Math.max(0, Math.min(1, v));
    const start = Math.round(HUD_BAR_W * clamp(p.hp / p.maxHp));
    const end = Math.round(HUD_BAR_W * clamp((p.hp + p.regainPool) / p.maxHp));
    if (end <= start) return;
    const { ctx } = this;
    ctx.globalAlpha = REGAIN_ALPHA;
    ctx.fillStyle = COLOR_REGAIN;
    ctx.fillRect(HUD_BAR_X + start, HUD_HP_Y, end - start, HUD_HP_H);
    ctx.globalAlpha = 1;
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
    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const statLine = Math.max(DEATH_STAT_LINE, this.textLine(TEXT.BODY));
    const summary = `地下 ${state.depth} 階 · 撃破 ${state.kills} · 最大コンボ ${state.combo.best}`;
    drawText(ctx, "力尽きた", cx, cy - DEATH_TITLE_RISE, TEXT.BIG, COLOR_HP, "center");
    drawText(ctx, summary, cx, cy, TEXT.BODY, COLOR_TEXT, "center");
    drawText(ctx, `スコア ${state.score}`, cx, cy + statLine, TEXT.BODY, COLOR_TEXT, "center");
    drawText(ctx, `Enter: 同じシードで再挑戦   ${actionKeyLabel("restart")}: 新しいシード`, cx, cy + statLine + DEATH_HINT_GAP, TEXT.SMALL, COLOR_DEATH_HINT, "center");
  }
}
