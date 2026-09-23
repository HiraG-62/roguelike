/**
 * アプリのバージョン。scripts/bump.mjs が package.json・CHANGELOG.md と一緒に書き換える（手で編集しない）。
 * 形式はメジャー.マイナー.パッチ。α 期間は 0.0.xx で進め、表示にだけ「α」を付ける。
 */

export type ReleasePhase = "alpha" | "stable";

/** 表示用（タイトル画面など） */
export const APP_VERSION = "0.0.5α";
/** package.json の version と一致する semver */
export const APP_VERSION_SEMVER = "0.0.5";
export const RELEASE_PHASE: ReleasePhase = "alpha";
