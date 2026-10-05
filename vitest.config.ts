import { configDefaults, defineConfig, type Plugin } from "vitest/config";

/**
 * テスト全体を並列で回すと、マップを生成してステップを回す重めのテスト（リプレイ・ランイベント・生成）が
 * 既定の 5 秒を超えて見かけ上失敗する（単体では通る）。毎階の主と敵の増量（2026-09-26）で目立つようになったので広げる
 */
const TEST_TIMEOUT_MS = 20_000;

/**
 * モジュールの状態（フォントの読み込み・語の推論の表など）を他のテストと共有すると結果が変わるファイル。
 * ここだけファイルごとに分離して回す。描画のテストはフォントの 1 つだけの実体を作る順で結果が変わるので丸ごと分離する。
 * 増やすときは「分離しないと実行順で落ちる」ことを確かめてから
 */
const ISOLATED_FILES = ["src/loot/describe.test.ts", "src/render/**/*.test.ts"];

/** 並列レーンの作業ツリー（.claude/worktrees）の中のテストを拾わない */
const IGNORED = [".claude/**"];

/** `pnpm run check:fast`（scripts/check.mjs が VITEST_FAST=1 を渡す）で省く重いテスト。projects には CLI の --exclude が効かないのでここで外す */
const FAST_EXCLUDE = process.env.VITEST_FAST === "1" ? ["src/qa/simulation.test.ts"] : [];

/**
 * `pnpm run test:perturb`（scripts/test-perturb.mjs が BALANCE_PERTURB=<倍率> を渡す）で、バランス JSON の小数をすべて倍率で動かして読む。
 * 数値を少し変えただけで落ちるテスト（数値の写し・指紋）を見つけるため（docs/TESTING.md）。整数は個数・フレーム数が多いので動かさない。
 * BALANCE_PERTURB_JITTER=1 では項目ごとに 1 ±（倍率 − 1）の範囲でばらばらに動かす（一律だと速さと寿命のような比が保たれ、相対の前提を見逃す）
 */
const PERTURB = Number(process.env.BALANCE_PERTURB ?? "");
const JITTER = process.env.BALANCE_PERTURB_JITTER === "1";
const BALANCE_JSON = /[\\/]src[\\/]data[\\/]balance[\\/].*\.json$/;
const PERTURB_DIGITS = 6;

/** 文字列から [0, 1) の決定的な値（FNV-1a）。jitter の倍率を項目の場所で決め、回すたびに同じにする */
function unitHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h / 0x100000000;
}

function multiplierAt(path: string): number {
  if (!JITTER) return PERTURB;
  const spread = Math.abs(PERTURB - 1);
  return 1 + spread * (unitHash(path) * 2 - 1);
}

function perturbValue(value: unknown, key: string, path: string): unknown {
  if (key.startsWith("_")) return value;
  if (Array.isArray(value)) return value.map((item, i) => perturbValue(item, "", `${path}[${i}]`));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, perturbValue(v, k, `${path}.${k}`)]));
  }
  if (typeof value === "number" && !Number.isInteger(value)) return Number((value * multiplierAt(path)).toFixed(PERTURB_DIGITS));
  return value;
}

function balancePerturbPlugin(): Plugin {
  return {
    name: "balance-perturb",
    enforce: "pre",
    transform(code, id) {
      if (!BALANCE_JSON.test(id)) return null;
      return { code: JSON.stringify(perturbValue(JSON.parse(code), "", id.replace(/^.*[\\/]src[\\/]data[\\/]balance[\\/]/, ""))), map: null };
    },
  };
}

export default defineConfig({
  plugins: Number.isFinite(PERTURB) && PERTURB > 0 ? [balancePerturbPlugin()] : [],
  test: {
    testTimeout: TEST_TIMEOUT_MS,
    // 変換結果のファイルキャッシュ（fsModuleCache）は使わない。消したファイルを指す古い結果が残って落ちることがあり、縮むのも 1 割未満だった（2026-09-30）
    projects: [
      {
        extends: true,
        // テストファイルごとの分離をやめると、モジュールの読み込みが 1 回で済み全体がほぼ半分の時間になる（2026-09-30 の実測 154 秒 → 79 秒）
        test: { name: "shared", isolate: false, exclude: [...configDefaults.exclude, ...IGNORED, ...ISOLATED_FILES, ...FAST_EXCLUDE] },
      },
      { extends: true, test: { name: "isolated", include: ISOLATED_FILES, exclude: [...configDefaults.exclude, ...IGNORED] } },
    ],
  },
});
