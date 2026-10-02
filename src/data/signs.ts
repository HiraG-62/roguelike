import { TELEGRAPH } from "./tuning";

/**
 * 符号表（docs/ideas/ink-telegraph-impl.md 段 0-b・下書き D01 の 2-3）。
 * 世界の層（地図・敵・弾・地面の物）の色は 1 つの意味しか持たない。予告の黄（下絵 = まだ止められる）と赤（墨入れ = もう止まらない）を、
 * 敵の体・怯みの印・血の粒などが横取りして「返せ」と「打て」を混ぜないように、表と検査（signs.test.ts）で縛る。
 * HUD の層（上部のバー・札・メニュー）は世界に重ならないので対象外
 */

/** 予約色。意味は 1 つ */
export const RESERVED_SIGNS = [
  { key: "ready", meaning: "下絵: 敵のまだ止められる意図", color: TELEGRAPH.readyColor },
  { key: "commit", meaning: "墨入れ: 必ず来る", color: TELEGRAPH.commitColor },
] as const;

/** 胡粉（墨の入っていない白）。怯みの印（星・ゲージ）と、星読みの眼の目盛りの地色。予告の黄と取り違えない */
export const GOFUN_COLOR = "#f0ece0";

/** 血の粒。予告の赤（#ff4040）と別の、暗い臙脂 */
export const BLOOD_COLOR = "#8a1c24";

/** 精鋭「号令の」の気（system/elites.ts の ELITE_COLOR）。黄の帯から外した藍寄りの白 */
export const COMMANDING_AURA_COLOR = "#c8d4ff";

/**
 * 予約色に近いまま残っている世界の層の色（既知の例外）。1 つ直すごとにここから消す。増やすとテストが落ちる。
 * key は検査が集める色の名前（signs.test.ts の collectWorldColors）
 */
const REASON = {
  enemy: "敵の種類の色（破片・命中の粒の色）。体の重ね色ではないので黄赤の予告とは別の層だが、乱戦で紛れうる。段 2 の棚卸し",
  status: "状態異常の色（頭上の字・体の色調・粒）。形が違う（字・粒）ので当面は残す。段 2 の棚卸し",
} as const;

export const KNOWN_EXCEPTIONS: readonly { key: string; reason: string }[] = [
  { key: "enemy.bannerBearer~ready", reason: REASON.enemy },
  { key: "enemy.banner~ready", reason: REASON.enemy },
  { key: "enemy.bellImp~ready", reason: REASON.enemy },
  { key: "enemy.boarDouble~commit", reason: REASON.enemy },
  { key: "enemy.broodEgg~ready", reason: REASON.enemy },
  { key: "enemy.curseEye~commit", reason: REASON.enemy },
  { key: "enemy.emberRat~commit", reason: REASON.enemy },
  { key: "enemy.enemyMine~commit", reason: REASON.enemy },
  { key: "enemy.forgeMaster~commit", reason: REASON.enemy },
  { key: "enemy.goldSlime~ready", reason: REASON.enemy },
  { key: "enemy.graveBell~ready", reason: REASON.enemy },
  { key: "enemy.laserEye~commit", reason: REASON.enemy },
  { key: "enemy.mineLayer~commit", reason: REASON.enemy },
  { key: "enemy.twinEye~ready", reason: REASON.enemy },
  { key: "status.blaze~commit", reason: REASON.status },
  { key: "status.bleed~commit", reason: REASON.status },
  { key: "status.brand~commit", reason: REASON.status },
  { key: "status.burn~commit", reason: REASON.status },
  { key: "status.exposed~commit", reason: REASON.status },
  { key: "status.fury~commit", reason: REASON.status },
  { key: "status.hemorrhage~commit", reason: REASON.status },
  { key: "status.scorch~commit", reason: REASON.status },
  { key: "status.wound~commit", reason: REASON.status },
  { key: "status.wrath~commit", reason: REASON.status },
];
