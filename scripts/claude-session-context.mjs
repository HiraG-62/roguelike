/**
 * SessionStart hook（`.claude/settings.json`）。クラウドセッションのときだけ、
 * ユーザーの共通ルール（`.claude/global/PREFERENCES.md`）と自動メモリの索引
 * （`.claude/global/memory/MEMORY.md`）を標準出力へ出して文脈に載せる。
 *
 * ローカルでは何も出さない: `~/.claude/CLAUDE.md` と自動メモリを Claude Code が自分で読むので、
 * CLAUDE.md から @import すると同じ文面が毎セッション 2 回載ってしまう。
 *
 * 確認: `CLAUDE_CODE_REMOTE=true node scripts/claude-session-context.mjs`
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** クラウドセッション（Claude Code on the web）で "true" になる環境変数 */
const REMOTE_ENV = "CLAUDE_CODE_REMOTE";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL_DIR = join(ROOT, ".claude", "global");
/** 載せるファイルと見出し。本文のメモリは索引を見て必要な物だけ開かせる */
const SOURCES = [
  { path: join(GLOBAL_DIR, "PREFERENCES.md"), title: "ユーザーの共通ルール（.claude/global/PREFERENCES.md）" },
  { path: join(GLOBAL_DIR, "memory", "MEMORY.md"), title: "自動メモリの索引（本文は .claude/global/memory/<名前>.md）" },
];

if (process.env[REMOTE_ENV] !== "true") process.exit(0);

for (const { path, title } of SOURCES) {
  // 無いファイルは黙って飛ばす（hook の失敗でセッションの開始を邪魔しない）
  if (!existsSync(path)) continue;
  console.log(`## ${title}\n\n${readFileSync(path, "utf8").trim()}\n`);
}
