import { defineConfig } from "vitest/config";

/**
 * テスト全体を並列で回すと、マップを生成してステップを回す重めのテスト（リプレイ・ランイベント・生成）が
 * 既定の 5 秒を超えて見かけ上失敗する（単体では通る）。毎階の主と敵の増量（2026-09-26）で目立つようになったので広げる
 */
const TEST_TIMEOUT_MS = 20_000;

export default defineConfig({
  test: { testTimeout: TEST_TIMEOUT_MS },
});
