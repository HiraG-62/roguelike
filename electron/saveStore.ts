/**
 * セーブファイルの読み書き（main プロセス側）。fs と path だけに依存し Electron を import しない（vitest で直接試す）。
 * 書き込みは tmp → rename で原子的に置き換え、直前の版を .bak に 1 世代残す。読めない本体は .corrupt-<epoch> に改名して保全する
 */
import fs from "node:fs";
import path from "node:path";
import { decodeEnvelope, encodeEnvelope, fileForKey, SAVE_FILE_FORMAT, SAVE_FILES } from "../src/save/fileEnvelope";

export interface SaveStore {
  readAll(): Record<string, string>;
  write(key: string, value: string): void;
  remove(key: string): void;
  /** save/import.json を取り込み、写したキーを返す。無ければ [] */
  consumeImportFile(): string[];
}

const TMP_SUFFIX = ".tmp";
const BAK_SUFFIX = ".bak";
const CORRUPT_SUFFIX = ".corrupt-";
const IMPORT_FILE = "import.json";
const IMPORT_DONE_PREFIX = "import.done-";
/** ウイルス対策ソフトなどが一瞬ロックしているだけなら待てば通るので、諦める前に数回やり直す */
const RENAME_RETRIES = 3;
const RENAME_RETRY_MS = 20;
const RETRYABLE_CODES: ReadonlySet<string> = new Set(["EPERM", "EBUSY", "EACCES"]);

function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = (err as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** main プロセスの同期 IPC の中で使うので、イベントループを回さずに待つ */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = errorCode(err);
      if (attempt >= RENAME_RETRIES || code === undefined || !RETRYABLE_CODES.has(code)) throw err;
      sleepSync(RENAME_RETRY_MS);
    }
  }
}

function readTextOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** import.json の entries から既知キー・文字列値のものだけを取り出す。形式が違えば null */
function parseImportEntries(text: string): Array<[string, string]> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.format !== SAVE_FILE_FORMAT || !isRecord(parsed.entries)) return null;
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(parsed.entries)) {
    if (fileForKey(key) === null || typeof value !== "string") continue;
    out.push([key, value]);
  }
  return out;
}

export function createSaveStore(dir: string, app: string, now: () => number): SaveStore {
  const fileOf = (key: string): string => {
    const name = fileForKey(key);
    if (name === null) throw new Error(`unknown save key: ${key}`);
    return path.join(dir, name);
  };
  const ensureDir = (): void => {
    fs.mkdirSync(dir, { recursive: true });
  };

  /** 本体が読めなければ .corrupt に退避して .bak を試す。どちらも駄目なら null（ストア側が既定値に落とす） */
  const readKey = (key: string): string | null => {
    const file = fileOf(key);
    const text = readTextOrNull(file);
    if (text !== null) {
      const json = decodeEnvelope(text, key);
      if (json !== null) return json;
      renameWithRetry(file, `${file}${CORRUPT_SUFFIX}${now()}`);
    }
    const bak = readTextOrNull(file + BAK_SUFFIX);
    return bak === null ? null : decodeEnvelope(bak, key);
  };

  const write = (key: string, value: string): void => {
    const file = fileOf(key);
    ensureDir();
    const text = encodeEnvelope(key, value, now(), app);
    fs.writeFileSync(file + TMP_SUFFIX, text, "utf8");
    try {
      if (fs.existsSync(file)) renameWithRetry(file, file + BAK_SUFFIX);
      renameWithRetry(file + TMP_SUFFIX, file);
    } catch (err) {
      // .tmp は残す（中身は最新の完全な版なので、手で戻せる。データ消失にはしない）
      console.warn(`[save] ${key} の書き込みを確定できなかった`, err);
    }
  };

  const remove = (key: string): void => {
    const file = fileOf(key);
    if (!fs.existsSync(file)) return;
    // 消さずに .bak へ回す（誤操作でも 1 世代は戻せる）
    renameWithRetry(file, file + BAK_SUFFIX);
  };

  return {
    readAll() {
      ensureDir();
      const out: Record<string, string> = {};
      for (const key of Object.keys(SAVE_FILES)) {
        const json = readKey(key);
        if (json !== null) out[key] = json;
      }
      return out;
    },
    write,
    remove,
    consumeImportFile() {
      ensureDir();
      const file = path.join(dir, IMPORT_FILE);
      const text = readTextOrNull(file);
      if (text === null) return [];
      const entries = parseImportEntries(text);
      if (entries === null) {
        // 形式違いは取り込まず残す（ユーザーが直して再起動できる）
        console.warn(`[save] ${IMPORT_FILE} の形式が読めないので取り込まない`);
        return [];
      }
      const written: string[] = [];
      for (const [key, value] of entries) {
        try {
          write(key, value);
          written.push(key);
        } catch (err) {
          console.warn(`[save] ${IMPORT_FILE} の ${key} を取り込めなかった`, err);
        }
      }
      renameWithRetry(file, path.join(dir, `${IMPORT_DONE_PREFIX}${now()}.json`));
      return written;
    },
  };
}
