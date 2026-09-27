// Aseprite の CLI を呼ぶ（.aseprite の作成と、.aseprite からの横一列 PNG の書き出し）。
// 場所は環境変数 ASEPRITE_PATH → PATH → Windows の定番の置き場所の順に探す
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TO_ASEPRITE_LUA = resolve(HERE, "toAseprite.lua");
/** Steam のライブラリを置きがちなドライブ */
const STEAM_DRIVES = ["C", "D", "E", "F", "G", "H"];

function candidates() {
  const list = ["C:/Program Files/Aseprite/Aseprite.exe", "C:/Program Files (x86)/Steam/steamapps/common/Aseprite/Aseprite.exe"];
  for (const d of STEAM_DRIVES) list.push(`${d}:/SteamLibrary/steamapps/common/Aseprite/Aseprite.exe`);
  return list;
}

/** Aseprite の実行ファイル。見つからなければ null */
export function findAseprite() {
  const env = process.env.ASEPRITE_PATH;
  if (env && existsSync(env)) return env;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["aseprite"], { encoding: "utf8" });
  const fromPath = which.status === 0 ? which.stdout.split(/\r?\n/).find((l) => l.trim()) : undefined;
  if (fromPath) return fromPath.trim();
  return candidates().find((p) => existsSync(p)) ?? null;
}

function run(args) {
  const exe = findAseprite();
  if (!exe) throw new Error("Aseprite が見つからない。環境変数 ASEPRITE_PATH に Aseprite.exe のパスを入れる");
  const res = spawnSync(exe, ["--batch", ...args], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`Aseprite が失敗した（${res.status}）:\n${res.stdout}\n${res.stderr}`);
  return res.stdout;
}

/** 横一列の PNG（1 セル = frameW x frameH）を、フレームに分けた .aseprite にする。パレットは .gpl */
export function buildAseprite({ strip, frameW, frameH, gpl, out }) {
  return run([
    "--script-param", `src=${resolve(strip)}`,
    "--script-param", `w=${frameW}`,
    "--script-param", `h=${frameH}`,
    "--script-param", `pal=${resolve(gpl)}`,
    "--script-param", `out=${resolve(out)}`,
    "--script", TO_ASEPRITE_LUA,
  ]);
}

/** .aseprite の全フレームを横一列の PNG に書き出す（レイヤーは合成、余白なし） */
export function exportStrip(aseFile, outPng) {
  return run([resolve(aseFile), "--sheet-type", "horizontal", "--sheet", resolve(outPng)]);
}
