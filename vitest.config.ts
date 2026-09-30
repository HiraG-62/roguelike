import { configDefaults, defineConfig } from "vitest/config";

/**
 * テスト全体を並列で回すと、マップを生成してステップを回す重めのテスト（リプレイ・ランイベント・生成）が
 * 既定の 5 秒を超えて見かけ上失敗する（単体では通る）。毎階の主と敵の増量（2026-09-26）で目立つようになったので広げる
 */
const TEST_TIMEOUT_MS = 20_000;

/**
 * モジュールの状態（フォントの読み込み・語の推論の表など）を他のテストと共有すると結果が変わるファイル。
 * ここだけファイルごとに分離して回す。増やすときは「分離しないと落ちる」ことを確かめてから
 */
const ISOLATED_FILES = ["src/loot/describe.test.ts", "src/render/reforgeUi.test.ts"];

/** `npm run check:fast`（scripts/check.mjs が VITEST_FAST=1 を渡す）で省く重いテスト。projects には CLI の --exclude が効かないのでここで外す */
const FAST_EXCLUDE = process.env.VITEST_FAST === "1" ? ["src/qa/simulation.test.ts"] : [];

export default defineConfig({
  test: {
    testTimeout: TEST_TIMEOUT_MS,
    // 変換結果をファイルに残し、次の実行で使い回す（node_modules/.vitest-cache）
    fsModuleCache: true,
    projects: [
      {
        extends: true,
        // テストファイルごとの分離をやめると、モジュールの読み込みが 1 回で済み全体がほぼ半分の時間になる（2026-09-30 の実測 154 秒 → 79 秒）
        test: { name: "shared", isolate: false, exclude: [...configDefaults.exclude, ...ISOLATED_FILES, ...FAST_EXCLUDE] },
      },
      { extends: true, test: { name: "isolated", include: ISOLATED_FILES } },
    ],
  },
});
