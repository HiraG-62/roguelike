import { ACTION_TEXT } from "./actionText";
import { BALANCE } from "./balance";

/**
 * プレイヤーの手触りに関わる定数。数値は src/data/balance/combat/ の "PLAYER"
 * （変更したい場合はそこを編集する。_note に調整の経緯）。
 * melee（近接 3 段）は src/data/balance/weapons/ の PLAYER_MELEE をここで合流する
 * （速さは docs/ideas/weapon-redesign.md 8 章）
 */
export const PLAYER = {
  ...BALANCE.combat.PLAYER,
  melee: BALANCE.weapons.PLAYER_MELEE,
} as const;

/**
 * 回復の上限と条件（docs/COMBAT_DESIGN.md「回復の設計」。system/combat.ts）。
 * memo 2026-09-24: 回復手段が豊富すぎて死ににくいので、戦闘中の回復を 1 つの上限に束ねる
 */
export const HEAL = BALANCE.combat.HEAL;

/** 爆発の距離減衰（src/system/blast.ts）。爆心の近くほど重く、縁ほど軽い */
export const BLAST_FALLOFF = BALANCE.combat.BLAST_FALLOFF;

/** armor の被ダメ軽減（PoE 風の逓減式）。reduction = armor / (armor + ARMOR_K)、上限 ARMOR_MAX_REDUCTION */
export const ARMOR_K = BALANCE.loot.ARMOR_K;
export const ARMOR_MAX_REDUCTION = BALANCE.loot.ARMOR_MAX_REDUCTION;

/** 永続 stash（装備画面の倉庫）の上限アイテム数 */
export const STASH_CAPACITY = BALANCE.loot.STASH_CAPACITY;

/** 状態異常 */
export const STATUS = BALANCE.combat.STATUS;

/**
 * ステータス（docs/COMBAT_DESIGN.md A）。基礎値は全員 base。
 * 派生は「実効値 − base」の差分で既存の PlayerStats に畳み込むので、基礎値なら何も変わらない
 */
export const ATTR = BALANCE.combat.ATTR;

/** ステータスの入手（共鳴）とラン内の振り分け（docs/COMBAT_DESIGN.md A-3） */
export const ATTR_GAIN = BALANCE.combat.ATTR_GAIN;

/**
 * マナ（docs/COMBAT_DESIGN.md B-1）。スキルの資源。
 * 数値は src/data/balance/combat/ の "MANA"（変更したい場合はそこを編集する。_note に調整の経緯）
 */
export const MANA = BALANCE.combat.MANA;

/** 奥義ゲージの溜まり方（1 秒ぶんの振りで溜まる量・射撃の割合・見切り）。src/system/combat.ts の meleeHitEnergy / shotHitEnergy が読む */
export const ENERGY = BALANCE.combat.ENERGY;

/** 怯み（docs/COMBAT_DESIGN.md D-1）。段階 1 の L3 が読む */
export const POISE = BALANCE.combat.POISE;

/** 地形の層（docs/ideas/status-and-terrain.md 3 章）。src/system/terrain.ts と src/map/generator.ts の planTerrain が読む */
export const TERRAIN = BALANCE.combat.TERRAIN;

/**
 * 地形の層「泥」「煙」（docs/ideas/enemies.md E2 / V10）。src/system/terrain.ts・src/map/generator.ts の planTerrain が読む。
 * 既存の TERRAIN と分けて置く（並列作業で TERRAIN の行を取り合わないため）
 */
export const TERRAIN_MUD_SMOKE = BALANCE.combat.TERRAIN_MUD_SMOKE;

/**
 * 地形「崩れる床」（docs/ideas/status-and-terrain.md 3 章 #9・2-2。地裂きの刻印符「地崩れ」が作る）。
 * 敵が fallDelay 秒乗り続けると床が抜け、乗っている敵に落下ダメージと怯み。プレイヤーは落ちない（自分の技で自分を罰しない）
 */
export const TERRAIN_RUBBLE = BALANCE.combat.TERRAIN_RUBBLE;

/**
 * 精鋭修飾子「強欲の」/ 二度突きの猪。数値は src/data/balance/enemies/ の同名ブロック
 * (src/system/elites.ts / enemyBehaviors.ts が読む)
 */
export const ELITE_GREEDY = BALANCE.enemies.ELITE_GREEDY;
export const DOUBLE_CHARGE = BALANCE.enemies.DOUBLE_CHARGE;

/** トリガー効果 */
export const TRIGGER = BALANCE.loot.TRIGGER;

/**
 * 統一ルール文法とイベント（src/core/events.ts / src/core/rules.ts / src/system/rules.ts）。
 * docs/ideas/synergy-web.md 3 章・6 章 C7（世代減衰）
 */
export const SYNERGY = BALANCE.loot.SYNERGY;

/** キーストーンの数値 */
export const KEYSTONE = BALANCE.loot.KEYSTONE;

/**
 * 共鳴の拡張（docs/ideas/loot-expansion.md 9-2〜9-4。src/loot/resonance.ts）。
 * 陰画・拮抗は共鳴の変形、星座は 6 部位の主色の並びで成立する別の層
 */
export const RESONANCE = BALANCE.loot.RESONANCE;

/** 装備ドロップ */
export const LOOT_DROP = BALANCE.loot.LOOT_DROP;

/**
 * 床の遺物・スキル石をカーソルで注目してインタラクトで拾う（memo 2026-09-24）。
 * ハート・刻印符など消耗品系は従来どおり触れて拾う
 */
export const PICKUP = BALANCE.loot.PICKUP;

/** 地金（装備に既定で宿るステータス・防御力・耐性）の予算と配り方。抽選は loot/innate.ts */
export const INNATE = BALANCE.loot.INNATE;

export const FEEL = BALANCE.feel.FEEL;

export const ROOM = BALANCE.world.ROOM;

/**
 * 追加敵の行動パラメータ・敵の攻撃テンポ・エリート修飾子。数値は src/data/balance/enemies/ の同名ブロック
 * (system/enemies.ts / elites.ts / enemyBehaviors.ts / enemyTerrain.ts / enemyWave3.ts が読む)
 */
export const ENEMY_AI = BALANCE.enemies.ENEMY_AI;
export const ENEMY_TEMPO = BALANCE.enemies.ENEMY_TEMPO;
export const ELITE = BALANCE.enemies.ELITE;

/** ボス共通 + 個体別パラメータ。数値は src/data/balance/enemies/ の "BOSS"（各 src/system/boss<Name>.ts が読む） */
export const BOSS = BALANCE.enemies.BOSS;

/** 追跡者（Reaper）。数値は src/data/balance/enemies/ の "REAPER"（src/system/reaper.ts / reaperVariants.ts が読む） */
export const REAPER = BALANCE.enemies.REAPER;

/** 深度による敵の HP の伸び（src/data/enemies.ts の depthHpScale）。数値は src/data/balance/enemies/ENEMY_SCALE.json */
export const ENEMY_SCALE = BALANCE.enemies.ENEMY_SCALE;

/** 部屋の種類（src/system/roomTypes.ts） */
export const ROOM_KIND = BALANCE.world.ROOM_KIND;

/** フロア種別（src/system/roomTypes.ts の chooseFloorKind） */
export const FLOOR_KIND = BALANCE.world.FLOOR_KIND;

/**
 * 洞窟の生成（src/map/cave.ts）。base が既定、biome がフロア種別ごとの上書き（無い種別は base のまま）。
 * 塊の数 = minRooms〜maxRooms、塊の大きさ = openDist / minRoomTiles / roomGrow、通路の太さ = widen（細い所を削る回数）。
 * fillChance が低いほど開けて、高いほど細い道が増える
 */
export const CAVE = BALANCE.world.CAVE;
/** マップの大きさ（面積の倍率の抽選。src/map/generator.ts の scaleGeneratorOptions） */
export const MAP_SIZE = BALANCE.world.MAP_SIZE;

/** 開放型フロアの徘徊と増援（src/system/spawner.ts）。塊に置いた敵の一部が塊の間を歩き回り、時間で少しずつ増える */
export const ROAM = BALANCE.world.ROAM;

/** ランイベント（src/system/runEvents.ts。docs/ideas/run-expansion.md 3 章）。すべて予告してから始まる */
export const RUN_EVENT = BALANCE.world.RUN_EVENT;

/** 長居の代償（死神以外。src/system/linger.ts。docs/ideas/run-expansion.md 5 章） */
export const LINGER = BALANCE.world.LINGER;

/** 起点（ラン開始時の選択。src/system/runSetup.ts） */
export const ORIGIN = BALANCE.world.ORIGIN;

/** ジョブ（src/data/jobs.ts / src/system/jobs.ts。docs/COMBAT_DESIGN.md A-9） */
/** ジョブ固有の数値（docs/COMBAT_DESIGN.md A-9）。定義元は src/data/balance/jobs/ の JOB */
export const JOB = BALANCE.jobs.JOB;

/** メタ進行（図鑑・依頼・実績。src/meta/）。ゲーム進行には効かない */
export const META = BALANCE.world.META;

/** ラン修飾子（縛り）。点の合計が位階（src/system/runSetup.ts） */
/** 契約者・契約・欠片（src/system/contractors.ts。docs/ideas/run-expansion.md 0 章・6 章） */
export const CONTRACT = BALANCE.world.CONTRACT;

export const RUN_MOD = BALANCE.world.RUN_MOD;

/** ミニマップ */
export const MINIMAP = BALANCE.feel.MINIMAP;

/**
 * アクション手触り（docs/ideas/action-feel.md「まず入れるべき 5 つ」+ 壁叩きつけ・ダッシュ攻撃）。
 * 数値・色は src/data/balance/combat/ の "ACTION"、表示文言（浮き文字）は src/data/actionText.ts。
 * dashAttack（ダッシュ中に攻撃 → ダッシュ終了と同時に前方へ長い一閃）は balance/weapons/ の ACTION_DASH_ATTACK
 */
export const ACTION = {
  counter: { ...BALANCE.combat.ACTION.counter, text: ACTION_TEXT.counter },
  lastKill: { ...BALANCE.combat.ACTION.lastKill, text: ACTION_TEXT.lastKill },
  regain: BALANCE.combat.ACTION.regain,
  justCounter: { ...BALANCE.combat.ACTION.justCounter, text: ACTION_TEXT.justCounter },
  reflect: { ...BALANCE.combat.ACTION.reflect, text: ACTION_TEXT.reflect },
  wallSplat: BALANCE.combat.ACTION.wallSplat,
  dashAttack: BALANCE.weapons.ACTION_DASH_ATTACK,
  bulletCut: BALANCE.combat.ACTION.bulletCut,
} as const;

/** ラン内限定の祝福 3 択（src/system/boons.ts）。docs/ideas/run-structure.md「祝福 3 択」 */
export const BOON = BALANCE.boons.BOON;

/**
 * 武器種（src/data/weapons.ts）と銃の弾の数値。docs/COMBAT_DESIGN.md「武器種」/ docs/ideas/meta-and-weapons.md 1〜2 章。
 * 剣（sword）と単発（single）の威力・形は PLAYER.melee / ACTION.dashAttack / PLAYER.shoot をそのまま使う。
 * 威力の scaling は基礎値（各 5）で剣の秒間期待値から大きく離れないよう揃え、
 * 差は「形・リーチ・怯み値・マナ回収・移動」で付ける（単一最強を作らない）。
 * 定義元は src/data/balance/weapons/ の WEAPON（shape.kind / art.throw.shot は union 文字列なので
 * src/data/weapons.ts の hitShape() / shotKeyOf() で絞る。docs/ideas/data-externalization.md 6.6）
 */
export const WEAPON = BALANCE.weapons.WEAPON;

/**
 * 奥義（F。docs/ideas/ougi-and-dual-actions.md 3 章）の共通値と奥義ごとの行為の数値。
 * 定義元は src/data/balance/ultimates/ の ULTIMATE。組み立ては src/data/ultimates.ts
 */
export const ULTIMATE = BALANCE.ultimates.ULTIMATE;

/**
 * 攻撃ジャンル（docs/COMBAT_DESIGN.md A-8）。範囲軸 × 質軸。参照ステータスは縛らない（A-10。係数は技ごとに自由）
 */
export const GENRE = BALANCE.combat.GENRE;

/**
 * 属性（docs/COMBAT_DESIGN.md A-8）。耐性は %、正で軽減・負で弱点。
 * プレイヤーの耐性は resistKnee を超えた分を resistSlope で鈍らせ、resistMax で止める（ソフトキャップ）。
 * 数値・色は src/data/balance/combat/ の "ELEMENT"。表示文字列（localizer の領分）だけ TS に残す
 */
export const ELEMENT = {
  ...BALANCE.combat.ELEMENT,
  /** 弱点 / 耐性の浮き文字 */
  weakText: "弱点",
  resistText: "耐性",
  mark: {
    ...BALANCE.combat.ELEMENT.mark,
    unknownGlyph: "？",
  },
} as const;

/**
 * 演出（src/system/effects.ts / src/render/effectsUi.ts / src/render/statusUi.ts）。見た目だけで、ロジックの結果に影響しない。
 * 粒は演出専用の乱数を使うので、ここの数を変えてもゲームの乱数列は変わらない
 */
export const EFFECTS = BALANCE.feel.EFFECTS;

/**
 * 攻撃エフェクト（src/render/fxAttack.ts / fxMath.ts・system/effects.ts の spawnBlast）。
 * 見た目だけで、ロジックの結果に影響しない
 */
export const FX_ATTACK = BALANCE.feel.FX_ATTACK;

/** 音楽（src/audio/music.ts）。曲の中身（音階・旋律）は music.ts の表、ここは混ぜ方と時間 */
export const MUSIC = BALANCE.feel.MUSIC;

/**
 * 演出の第 3 弾（docs/ideas/meta-and-weapons.md 7-10 / 7-14 / 7-15 / 7-19 / 7-20 と 8-14 の鼓動）。
 * 見た目と音だけで、ロジックの結果に影響しない
 */
export const FX_WAVE3 = BALANCE.feel.FX_WAVE3;

/** 音の第 3 弾（docs/ideas/meta-and-weapons.md 8-15）。周波数は Hz、時間は秒 */
export const SFX_WAVE3 = BALANCE.feel.SFX_WAVE3;

/** 連携の発見（src/meta/links.ts / linkHint.ts。docs/ideas/synergy-web.md 5 章）。数値の強さは配らない */
export const DISCOVERY = BALANCE.world.DISCOVERY;

/** 拠点（src/system/hub.ts / src/meta/hub.ts） */
export const HUB = BALANCE.world.HUB;

/** 拠点の飾り（src/meta/hub.ts）。見た目だけで強さには触れない */
export const HUB_DECOR = BALANCE.world.HUB_DECOR;
