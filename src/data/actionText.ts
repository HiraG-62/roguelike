/**
 * ACTION（src/data/tuning.ts）の浮き文字。表示文字列（localizer の領分）なので
 * 数値・色と分けて TS に残す（docs/ideas/data-externalization.md 6.5）。
 * 数値・色は src/data/balance/combat/ の "ACTION"。tuning.ts の ACTION がここと合流する
 */
export const ACTION_TEXT = {
  /** カウンターヒット: 敵の windup 中に近接を当てる */
  counter: "カウンター！",
  /** ラストキル・スロー: ロック中の部屋で最後の敵を倒した瞬間 */
  lastKill: "殲滅",
  /** 見切り斬り（祝福 justSlash） */
  justCounter: "見切り斬り！",
  /** 弾返し（祝福 reflect） */
  reflect: "弾返し",
} as const;
