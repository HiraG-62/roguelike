import { TELEGRAPH } from "./tuning";

/**
 * 符号表（docs/ideas/ink-telegraph-impl.md 段 0-b・案 B）。
 * 世界の層（地図・敵・弾・地面の物）の色は 1 つの意味しか持たない。予告の 4 色（薄墨 = 下絵・まだ止められる、濃墨 = 墨入れ・もう止まらない、
 * 朱 = 墨入れの入りと印、胡粉 = 墨の下敷き）を、敵の体・血の粒などが横取りして「返せ」と「打て」を混ぜないように、表と検査（signs.test.ts）で縛る。
 * HUD の層（上部のバー・札・メニュー）は世界に重ならないので対象外
 */

/**
 * 予約色。意味は 1 つ。exclusive = 世界の層の色に使わせない（検査する）。
 * 薄墨・胡粉は石・骨・鋼・雪の灰と白を世界から取り上げられないので独占しない。代わりに形（淡い帯・滲み・必ず濃墨と組む）で分け、
 * 色味の無さと明暗の差を検査で縛る。独占するのは濃墨と朱（予告の芯）
 */
export const RESERVED_SIGNS = [
  { key: "usuzumi", meaning: "下絵: 敵のまだ止められる意図（明るく淡い掠れた帯・頭上の ○）", color: TELEGRAPH.usuzumiColor, exclusive: false },
  { key: "sumi", meaning: "墨入れ: 必ず来る（真っ黒な一筆・頭上の ● の地）", color: TELEGRAPH.sumiColor, exclusive: true },
  { key: "shu", meaning: "朱: 墨入れの入りの墨溜まり・線の先端・頭上の ● の芯・止まらない段の体の点滅", color: TELEGRAPH.shuColor, exclusive: true },
  { key: "gofun", meaning: "胡粉: 濃墨の下に敷く白い滲み（暗い床で墨を浮かせる）", color: TELEGRAPH.gofunColor, exclusive: false },
] as const;

/**
 * 胡粉（墨の入っていない白）。予告の胡粉と同じ色で、怯みの印（星・ゲージ）と星読みの眼の目盛りの地色も兼ねる
 * （「墨の入っていない紙」の 1 つの意味。怯みの印は星・帯の形で分かれ、滲みは必ず濃墨の線と組む）
 */
export const GOFUN_COLOR = TELEGRAPH.gofunColor;

/** 血の粒。予告の朱と別の、暗い臙脂 */
export const BLOOD_COLOR = "#8a1c24";

/** 精鋭「号令の」の気（system/elites.ts の ELITE_COLOR）。予告の色から外した藍寄りの白 */
export const COMMANDING_AURA_COLOR = "#c8d4ff";

/**
 * 予約色に近いまま残っている世界の層の色（既知の例外）。1 つ直すごとにここから消す。増やすとテストが落ちる。
 * key は検査が集める色の名前（signs.test.ts の collectWorldColors）
 */
const REASON = {
  enemy: "敵の種類の色（破片・命中の粒の色）。体の重ね色ではないので予告の筆とは別の層だが、乱戦で紛れうる。棚卸しの候補",
  status: "状態異常の色（頭上の字・体の色調・粒）。形が違う（字・粒）ので当面は残す。棚卸しの候補",
  elite: "精鋭の気・名札の色（体の周りの輪と字）。朱の点と形は違うが、体の点滅と同じ場所に出るので紛れうる。棚卸しの候補",
} as const;

export const KNOWN_EXCEPTIONS: readonly { key: string; reason: string }[] = [
  { key: "elite.devouring~shu", reason: REASON.elite },
  { key: "enemy.boarDouble~shu", reason: REASON.enemy },
  { key: "enemy.boar~shu", reason: REASON.enemy },
  { key: "enemy.curseEye~shu", reason: REASON.enemy },
  { key: "enemy.emberRat~shu", reason: REASON.enemy },
  { key: "enemy.enemyMine~shu", reason: REASON.enemy },
  { key: "enemy.laserEye~shu", reason: REASON.enemy },
  { key: "enemy.mineLayer~shu", reason: REASON.enemy },
  { key: "enemy.pot~shu", reason: REASON.enemy },
  { key: "status.blaze~shu", reason: REASON.status },
  { key: "status.bleed~shu", reason: REASON.status },
  { key: "status.brand~shu", reason: REASON.status },
  { key: "status.fury~shu", reason: REASON.status },
  { key: "status.hemorrhage~shu", reason: REASON.status },
  { key: "status.scorch~shu", reason: REASON.status },
  { key: "status.wound~shu", reason: REASON.status },
  { key: "status.wrath~shu", reason: REASON.status },
];
