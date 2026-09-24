import { BALANCE } from "./balance";

/** プレイヤーの手触りに関わる定数。ここをいじって調整する */
export const PLAYER = {
  radius: 5,
  maxHp: 100,
  speed: 120,
  /** 攻撃中の移動速度倍率 */
  attackMoveMul: 0.35,
  /** 怯み（被弾硬直）中の移動速度倍率。攻撃・射撃・ダッシュ・バーストは出せない（docs/COMBAT_DESIGN.md D-5） */
  staggerMoveMul: 0.3,
  dash: {
    time: 0.16,
    speed: 400,
    /** 連打で無敵を繋げないよう、無敵（invulnTime）より十分長くする（docs/COMBAT_DESIGN.md C-1） */
    cooldown: 0.45,
    /** ダッシュ後に少しだけ残る無敵（回避猶予）。無効化手段を絞るため 0 */
    graceInvuln: 0,
    /** ダッシュ開始からの無敵秒（docs/COMBAT_DESIGN.md C-1）。ダッシュの後半は被弾する */
    invulnTime: 0.1,
  },
  /** 被弾後の無敵時間（docs/COMBAT_DESIGN.md C-1: 0.7 → 0.5） */
  hurtInvuln: 0.5,
  hurtKnockback: 220,
  /**
   * 近接 3 段。scaling は威力の係数（docs/COMBAT_DESIGN.md A-6。基礎値で 7.8 / 7.8 / 15.6）、
   * poise は基礎怯み値（D-2）、heavy は重いヒットストップと壁叩きつけを起こす段
   * base は 6 / 6 / 12 → ×0.8（QA 2026-09-23: スキル由来与ダメ比率 30.8%＜目標 55〜65%、
   * 通常攻撃の威力を落として相対的にスキル比率を上げる。docs/COMBAT_DESIGN.md B-7 段階 3）
   */
  // 速さは docs/ideas/weapon-redesign.md 8 章（旧 0.05 / 0.1 / 0.16・0.08 / 0.12 / 0.3 → 旧双剣より少し遅い程度）。定義元は balance/weapons.json の PLAYER_MELEE
  melee: BALANCE.weapons.PLAYER_MELEE,
  /** コンボ最終段の後、次の 1 段目まで待たせる時間 */
  comboLockout: 0.18,
  /**
   * recover の残りがこの割合を切ったら、先行入力（次段・派生の予約）で振りを前倒しに終える
   * （docs/ideas/combat-feel-design.md D-4）。段ごとに変えたい場合は MeleeStepDef.cancel で上書きできる
   */
  recoverCancel: 0.5,
  shoot: {
    cooldown: 0.17,
    speed: 300,
    /** 1 発の威力（基礎値で 4.3）と怯み値。base 3.5 → ×0.8（QA 2026-09-23、B-7 段階 3） */
    scaling: { base: 2.8, dex: 0.3 },
    poise: 2,
    life: 0.9,
    radius: 2,
    /** 発射時に少しだけ後ろに下がる反動 */
    recoil: 30,
  },
  special: {
    cost: 100,
    /** 威力（基礎値で 34）と怯み値 */
    scaling: { base: 24, mnd: 1, spi: 1 },
    poise: 60,
    radius: 64,
    knockback: 380,
    /** 発動後の無敵（秒）。弾消しは維持するので短め（docs/COMBAT_DESIGN.md C-1 の 10） */
    invuln: 0.15,
  },
  maxEnergy: 100,
  /** 近接ヒット 1 回あたりの必殺ゲージ */
  energyPerHit: 12,
  /** 複数弾の扇の間隔（度） */
  projectileSpreadDeg: 8,
  /** クリティカル時に足すヒットストップ（ステップ） */
  critHitstopBonus: 1,
  critTextScale: 1.6,
  critColor: "#ffe040",
  /** ks_overclock: 1 振り / 3 発ごとの HP コスト */
  overclockHpCost: 1,
  /** ks_overclock: 射撃はこの発数ごとに overclockHpCost を消費する（近接は 1 振りごと） */
  overclockShootInterval: 3,
} as const;

/**
 * 回復の上限と条件（docs/COMBAT_DESIGN.md「回復の設計」。system/combat.ts）。
 * memo 2026-09-24: 回復手段が豊富すぎて死ににくいので、戦闘中の回復を 1 つの上限に束ねる
 */
export const HEAL = BALANCE.combat.HEAL;

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
 * 数値は src/data/balance/combat.json の "MANA"（変更したい場合はそこを編集する。_note に調整の経緯）
 */
export const MANA = BALANCE.combat.MANA;

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
 * 精鋭修飾子「強欲の」/ 二度突きの猪。数値は src/data/balance/enemies.json の同名ブロック
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

export const FEEL = BALANCE.feel.FEEL;

export const ROOM = BALANCE.world.ROOM;

/**
 * 追加敵の行動パラメータ・敵の攻撃テンポ・エリート修飾子。数値は src/data/balance/enemies.json の同名ブロック
 * (system/enemies.ts / elites.ts / enemyBehaviors.ts / enemyTerrain.ts / enemyWave3.ts が読む)
 */
export const ENEMY_AI = BALANCE.enemies.ENEMY_AI;
export const ENEMY_TEMPO = BALANCE.enemies.ENEMY_TEMPO;
export const ELITE = BALANCE.enemies.ELITE;

/** ボス共通 + 個体別パラメータ。数値は src/data/balance/enemies.json の "BOSS"（各 src/system/boss<Name>.ts が読む） */
export const BOSS = BALANCE.enemies.BOSS;

/** 追跡者（Reaper）。数値は src/data/balance/enemies.json の "REAPER"（src/system/reaper.ts / reaperVariants.ts が読む） */
export const REAPER = BALANCE.enemies.REAPER;

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

/** 開放型フロアの徘徊と増援（src/system/spawner.ts）。塊に置いた敵の一部が塊の間を歩き回り、時間で少しずつ増える */
export const ROAM = BALANCE.world.ROAM;

/** ランイベント（src/system/runEvents.ts。docs/ideas/run-expansion.md 3 章）。すべて予告してから始まる */
export const RUN_EVENT = BALANCE.world.RUN_EVENT;

/** 長居の代償（死神以外。src/system/linger.ts。docs/ideas/run-expansion.md 5 章） */
export const LINGER = BALANCE.world.LINGER;

/** 起点（ラン開始時の選択。src/system/runSetup.ts） */
export const ORIGIN = BALANCE.world.ORIGIN;

/** ジョブ（src/data/jobs.ts / src/system/jobs.ts。docs/COMBAT_DESIGN.md A-9） */
/** ジョブ固有の数値（docs/COMBAT_DESIGN.md A-9）。定義元は src/data/balance/jobs.json の JOB */
export const JOB = BALANCE.jobs.JOB;

/** メタ進行（図鑑・依頼・実績。src/meta/）。ゲーム進行には効かない */
export const META = BALANCE.world.META;

/** ラン修飾子（縛り）。点の合計が位階（src/system/runSetup.ts） */
/** 契約者・契約・欠片（src/system/contractors.ts。docs/ideas/run-expansion.md 0 章・6 章） */
export const CONTRACT = BALANCE.world.CONTRACT;

export const RUN_MOD = BALANCE.world.RUN_MOD;

/** ミニマップ */
export const MINIMAP = BALANCE.feel.MINIMAP;

/** アクション手触り（docs/ideas/action-feel.md「まず入れるべき 5 つ」+ 壁叩きつけ・ダッシュ攻撃） */
export const ACTION = {
  /** カウンターヒット: 敵の windup 中に近接を当てる */
  counter: {
    damageMul: 1.5,
    /** 怯み値の倍率。確定の怯みではなく、敵の強靭（攻撃中 ×0.5）と相殺して等倍になる値 */
    poiseMul: 2,
    /** 通常の hitstop に足すステップ */
    hitstopBonus: 2,
    text: "カウンター！",
    color: "#ff9040",
    textScale: 1.6,
    textLife: 0.7,
    particles: 12,
  },
  /** ラストキル・スロー: ロック中の部屋で最後の敵を倒した瞬間 */
  lastKill: {
    /** スローモーション（実時間秒） */
    slowmo: 0.5,
    flash: 0.85,
    text: "殲滅",
    color: "#ffffff",
    textScale: 2.6,
    textLife: 1.2,
    /** テキストを倒した敵の少し上に出す（px） */
    textOffsetY: 14,
    ringRadius: 60,
    ringLife: 0.45,
    particles: 30,
  },
  /** リゲイン: 被弾後しばらく近接ヒットで HP を取り戻す */
  regain: {
    /** 取り戻せる猶予（秒） */
    window: 3,
    /** 近接 1 ヒットで戻る量（被ダメに対する割合）。0.15 → 0.1（memo 2026-09-24） */
    perHitRatio: 0.1,
    /** 取り戻せる合計（被ダメに対する割合）。C-1 で 0.6 → 0.5、memo 2026-09-24 で 0.5 → 0.3 */
    poolRatio: 0.3,
    color: "#b0ffb0",
    particles: 4,
  },
  /** 見切り斬り（祝福 justSlash）: JUST 回避直後に攻撃で回避した敵へ瞬間移動斬り */
  justCounter: {
    /** JUST 回避後に攻撃を受け付ける秒数 */
    window: 0.4,
    /** 近接 3 段目のダメージに掛ける倍率 */
    damageMul: 1.5,
    /** 基礎怯み値（docs/COMBAT_DESIGN.md D-2） */
    poise: 60,
    /** この距離より遠い敵へは飛ばない（px） */
    maxRange: 160,
    /** 敵の縁からこの距離だけ手前で止まる（px） */
    gap: 2,
    hitstopBonus: 3,
    text: "見切り斬り！",
    color: "#60e0ff",
    textScale: 1.7,
    textLife: 0.8,
    lineLife: 0.2,
    particles: 16,
  },
  /** 弾返し（祝福 reflect）: 近接の active で敵弾を斬るとプレイヤー弾として反射 */
  reflect: {
    speedMul: 1.3,
    damageMul: 2,
    energy: 8,
    /** 反射弾の貫通数 */
    pierce: 2,
    /** 反射弾の残り寿命の下限（秒） */
    minLife: 1,
    text: "弾返し",
    color: "#ffe080",
    textScale: 1.2,
    textLife: 0.5,
    particles: 8,
  },
  /** 壁叩きつけ: 近接 3 段目などで吹き飛んだ敵が壁に激突 */
  wallSplat: {
    damage: 10,
    /** 基礎怯み値（強靭を無視する。docs/COMBAT_DESIGN.md D-2） */
    poise: 20,
    color: "#c0c0c0",
    particles: 12,
    hitstop: 3,
  },
  /**
   * ダッシュ攻撃: ダッシュ中に攻撃 → ダッシュ終了と同時に前方へ長い一閃（1 段目と 2 段目の間の性能）。
   * 威力（基礎値で 11.2）と怯み値。base 9 → ×0.8（QA 2026-09-23、B-7 段階 3）。定義元は balance/weapons.json の ACTION_DASH_ATTACK
   */
  dashAttack: BALANCE.weapons.ACTION_DASH_ATTACK,
  /** 弾斬り（性質 bulletCut）: 近接の active で敵弾を消す */
  bulletCut: {
    color: "#c0e0ff",
    particles: 4,
  },
} as const;

/** ラン内限定の祝福 3 択（src/system/boons.ts）。docs/ideas/run-structure.md「祝福 3 択」 */
export const BOON = BALANCE.boons.BOON;

/**
 * 武器種（src/data/weapons.ts）と射撃の型の数値。docs/COMBAT_DESIGN.md「武器種」/ docs/ideas/meta-and-weapons.md 1〜2 章。
 * 剣（sword）と単発（single）の威力・形は PLAYER.melee / ACTION.dashAttack / PLAYER.shoot をそのまま使う。
 * 威力の scaling は基礎値（各 5）で剣の秒間期待値から大きく離れないよう揃え、
 * 差は「形・リーチ・怯み値・マナ回収・移動」で付ける（単一最強を作らない）。
 * 定義元は src/data/balance/weapons.json の WEAPON（shape.kind / art.throw.shot は union 文字列なので
 * src/data/weapons.ts の hitShape() / shotKeyOf() で絞る。docs/ideas/data-externalization.md 6.6）
 */
export const WEAPON = BALANCE.weapons.WEAPON;

/**
 * 攻撃ジャンル（docs/COMBAT_DESIGN.md A-8）。範囲軸 × 質軸。参照ステータスの既定表は system/attributes.ts の GENRE_ATTRS
 */
export const GENRE = BALANCE.combat.GENRE;

/**
 * 属性（docs/COMBAT_DESIGN.md A-8）。耐性は %、正で軽減・負で弱点。
 * プレイヤーの耐性は resistKnee を超えた分を resistSlope で鈍らせ、resistMax で止める（ソフトキャップ）。
 * 数値・色は src/data/balance/combat.json の "ELEMENT"。表示文字列（localizer の領分）だけ TS に残す
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
