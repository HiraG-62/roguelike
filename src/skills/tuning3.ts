/**
 * スキル第 3 弾（変身 5 種: 狼化・霊体化・砲身化・鉄塊化・業火の化身）の数値。
 * data.ts の SKILL に展開して読む（SKILL.wolfForm など）ので、ロジックからは SKILL 経由で参照する。
 *
 * 第 2 弾の変身（剛 / 迅 / 霊の型）は武器種の差し替えだったが、こちらは左右クリックの動作そのものを差し替える。
 * 噛みつき・重い振りは近接の段（src/data/weapons.ts の MeleeStepDef と同じ形）で書き、player.ts の近接の仕組みにそのまま流す。
 * scaling の base はステータス基礎値（各 5）のときの威力から逆算している（docs/COMBAT_DESIGN.md A-6）
 */

import { STATUS } from "../data/tuning";

export const WAVE3_SKILL_TUNING = {
  /**
   * 狼化（CD 型）: 左クリックが噛みつき突進（短く踏み込んで 1 段、出血）、右クリックが遠吠え（周りに恐怖）。
   * 変身中はほかのスキル石を使えない
   */
  wolfForm: {
    cooldown: 18,
    minInterval: 0.3,
    poise: 15,
    duration: 6,
    /** 解けた後の反動（移動が遅い）秒 */
    recover: 1,
    /** 噛みつき。基礎値で 4 + 0.8*5 + 0.8*5 = 12 */
    bite: {
      windup: 0.06,
      active: 0.1,
      recover: 0.16,
      scaling: { base: 4, str: 0.8, dex: 0.8 },
      poise: 15,
      reach: 24,
      size: 14,
      knockback: 80,
      heavy: false,
      mana: 3,
      shape: { kind: "thrust" },
      hitstop: 3,
      shake: 1,
      lunge: 30,
      trail: "#d0b090",
    },
    /** 噛みつき中の移動倍率（突進は lunge が担う） */
    attackMoveMul: 0.5,
    /** 噛みつきの出血（10px ごとに potency × スタック） */
    bleedStacks: 1,
    bleedPotency: 1,
    /** 遠吠え: 半径・変身中の再使用秒・恐怖の秒 */
    howlRadius: 56,
    howlCooldown: 2.5,
    fearDuration: STATUS.fear.duration,
  },
  /** 霊体化（CD 型）: 敵と敵弾をすり抜ける代わりに与ダメ ×0.3。解けたとき、すり抜けた敵全員に出血 */
  wraithForm: {
    cooldown: 15,
    minInterval: 0.3,
    poise: 0,
    duration: 4,
    recover: 1,
    outgoingMul: 0.3,
    /** 重なったとみなす距離の余白（px） */
    passPad: 2,
    bleedStacks: 3,
    bleedPotency: 1,
  },
  /**
   * 砲身化（気力型、1 発ごとに払う）: 構えると移動できず、右クリックが高威力の単発砲撃になる。
   * 構えた瞬間に 1 発撃つ（発動のコストがその 1 発ぶん）。ダッシュか、もう一度撃つと構えを解く
   */
  siegeForm: {
    cost: 8,
    minInterval: 0.3,
    poise: 30,
    recover: 0.5,
    /** 砲撃の間隔（連打の下限） */
    shellInterval: 0.45,
    /** 基礎値で 14 + 2.2*5 + 0.6*5 = 28 */
    damage: { base: 14, dex: 2.2, str: 0.6 },
    speed: 300,
    life: 0.9,
    radius: 4,
    knockback: 220,
    /** 撃つたびに後ろへ押される速さ */
    recoil: 40,
  },
  /** 鉄塊化（CD 型）: 被弾で怯まず（攻撃も止まらない）、近接が 1 段の重い振りになる。移動 ×0.7 */
  ironForm: {
    cooldown: 16,
    minInterval: 0.3,
    poise: 40,
    duration: 5,
    recover: 1,
    moveMul: 0.7,
    /** 重い振り。基礎値で 10 + 1.4*5 + 0.8*5 = 21 */
    swing: {
      windup: 0.28,
      active: 0.14,
      recover: 0.42,
      scaling: { base: 10, str: 1.4, vit: 0.8 },
      poise: 40,
      reach: 32,
      size: 32,
      knockback: 300,
      heavy: true,
      mana: 5,
      shape: { kind: "arc", deg: 180 },
      hitstop: 7,
      shake: 4,
      lunge: 6,
      trail: "#a0a8b8",
    },
    attackMoveMul: 0.3,
  },
  /**
   * 業火の化身（気力型、維持に毎秒払う）: 維持中は近接・射撃が燃焼を付ける。気力が尽きると自分に燃焼して解ける。
   * もう一度撃つと自分で解ける（自傷なし）
   */
  pyreForm: {
    cost: 6,
    minInterval: 0.3,
    poise: 0,
    recover: 0.5,
    /** 維持の毎秒の気力 */
    drainPerSec: 6,
    /** 命中で付ける燃焼（dps・秒） */
    burnPotency: 3,
    burnDuration: STATUS.burnDuration,
    /** 気力切れの自傷の燃焼（dps・秒） */
    selfBurnPotency: 3,
    selfBurnDuration: STATUS.burnDuration,
  },
} as const;

/** 変身の稼働率の上限（変身していた秒 ÷ 次に変身できるまでの秒） */
const UPTIME_CAP = 0.6;

/**
 * 変身の共通（第 2 弾の 3 種も含む 8 種すべて）。
 * 同時に 2 つは不可。1 つ使うと共有の待ち（その変身の再使用時間）に入り、ほかの変身も待つ。
 * さらに解けたとき「変身していた秒 × afterRatio」だけ待ちを伸ばし、どう積んでも稼働率が uptimeCap を超えないようにする
 */
export const SHAPE_TUNING = {
  uptimeCap: UPTIME_CAP,
  /** 変身していた秒に掛けて待ちへ足す割合（= 1 / uptimeCap − 1） */
  afterRatio: 1 / UPTIME_CAP - 1,
  /** 変身中・待ちの表示色 */
  color: "#ff90d0",
} as const;
