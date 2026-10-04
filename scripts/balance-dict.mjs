/**
 * バランス数値の辞書（docs/BALANCE_DICTIONARY.md）を書き出す（`npm run balance:dict`）。
 * 組み立ては TS（src/data/balance/dictionary.ts）にあるので、BALANCE_DICT_WRITE=1 を付けて dictionary.test.ts を走らせて書かせる
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");
const DICT_TEST = "src/data/balance/dictionary.test.ts";

const child = spawn(process.execPath, [VITEST, "run", DICT_TEST], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, BALANCE_DICT_WRITE: "1" },
});
child.on("exit", (code) => {
  if (code === 0) console.log("[balance:dict] docs/BALANCE_DICTIONARY.md を書き出した");
  process.exit(code ?? 1);
});
