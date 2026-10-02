/**
 * ACTION（src/data/tuning.ts）の浮き文字。表示文字列（localizer の領分）なので
 * 数値・色と分けて TS に残す（docs/ideas/data-externalization.md 6.5）。
 * 数値・色は src/data/balance/combat/ の "ACTION"。tuning.ts の ACTION がここと合流する
 */
export const ACTION_TEXT = {
  /** ラストキル・スロー: ロック中の部屋で最後の敵を倒した瞬間 */
  lastKill: "殲滅",
} as const;

/**
 * 陣（docs/ideas/jin-impl.md）の決着・進行の浮き文字。ロジック側はここを参照してリテラルを書かない。
 * どれも体言止め（system/floatingText.test.ts の方針）
 */
export const JIN_TEXT = {
  /** 陣の全滅（clearRoom の既存の「制圧」と同じ） */
  wipe: "制圧",
  /** 群勢が崩れて逃げ出した */
  rout: "敗走",
  /** 大将を倒した */
  leaderDown: "大将撃破",
  /** 第 2 波（残りの陣が遅れて動き出した） */
  secondWave: "後詰",
  /** 群勢が崩れても逃げずに踏みとどまった（攻めが速くなる） */
  hold: "背水",
  /** 逃げた敵が眠っている陣に合流して起こした（その陣がこちらへ向かってくる） */
  alarm: "急報",
} as const;
