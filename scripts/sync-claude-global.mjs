/**
 * ローカルの Claude Code グローバル設定（~/.claude 配下）のうち、クラウドセッションでも
 * 同じ前提で開発するために必要なものをリポジトリ内 `.claude/global/` へ写す。
 *
 * 写すもの:
 * - ~/.claude/CLAUDE.md                              → .claude/global/PREFERENCES.md（ユーザーの全プロジェクト共通ルール）
 * - ~/.claude/hooks/court-guard-context.txt          → PREFERENCES.md の末尾に「毎プロンプトの注意」として追記
 * - ~/.claude/projects/<このリポジトリ>/memory/*.md → .claude/global/memory/（自動メモリ。MEMORY.md が索引）
 *
 * 使い方: `npm run sync:claude`。ローカルで memory やグローバル CLAUDE.md を変えたあとに実行してコミットする。
 * クラウド側は `CLAUDE.md` が `.claude/global/` を @import で読むので、これだけで同じ文脈が載る。
 *
 * オプション:
 *   --check   書き換えず、差分があるファイル名だけ表示して非 0 で終わる
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
const OUT_DIR = join(ROOT, ".claude", "global");
const OUT_MEMORY_DIR = join(OUT_DIR, "memory");
const CHECK_ONLY = process.argv.includes("--check");

// Claude Code は memory をプロジェクトの絶対パスの区切りを "-" に置換した名前で保存する
// （例: E:\dev\roguelike → E--dev-roguelike）。
function projectMemoryDir() {
  const slug = ROOT.replace(/[\\/:]/g, "-");
  return join(CLAUDE_HOME, "projects", slug, "memory");
}

function readUtf8(path) {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const changed = [];

function emit(relPath, content) {
  const abs = join(OUT_DIR, relPath);
  const before = existsSync(abs) ? readUtf8(abs) : null;
  if (before === content) return;
  changed.push(relPath);
  if (CHECK_ONLY) return;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function buildPreferences() {
  const src = join(CLAUDE_HOME, "CLAUDE.md");
  if (!existsSync(src)) throw new Error(`グローバル CLAUDE.md が見つからない: ${src}`);
  const header = [
    "<!-- 自動生成: scripts/sync-claude-global.mjs が ~/.claude/CLAUDE.md から写す。手で直さず、元を直して npm run sync:claude -->",
    "",
    "",
  ].join("\n");
  const guardPath = join(CLAUDE_HOME, "hooks", "court-guard-context.txt");
  const guard = existsSync(guardPath) ? readUtf8(guardPath).trim() : "";
  const guardSection = guard
    ? ["", "# 毎プロンプトの注意（ローカルでは UserPromptSubmit hook が注入している文面）", "", guard, ""].join("\n")
    : "";
  return header + readUtf8(src).trimEnd() + "\n" + guardSection;
}

function syncMemory() {
  const dir = projectMemoryDir();
  if (!existsSync(dir)) throw new Error(`memory ディレクトリが見つからない: ${dir}`);
  const names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  for (const name of names) emit(join("memory", name), readUtf8(join(dir, name)));
  // 元で消えたメモリはこちらでも消す
  if (existsSync(OUT_MEMORY_DIR)) {
    for (const name of readdirSync(OUT_MEMORY_DIR)) {
      if (names.includes(name)) continue;
      changed.push(join("memory", name) + "（削除）");
      if (!CHECK_ONLY) rmSync(join(OUT_MEMORY_DIR, name));
    }
  }
}

emit("PREFERENCES.md", buildPreferences());
syncMemory();

if (changed.length === 0) {
  console.log("差分なし: .claude/global はグローバル設定と一致している");
} else {
  console.log((CHECK_ONLY ? "差分あり:" : "更新:") + "\n" + changed.map((c) => "  " + c).join("\n"));
  if (CHECK_ONLY) process.exit(1);
}
