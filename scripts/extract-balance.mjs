/**
 * tuning.ts / data/enemies.ts などの数値ブロックを src/data/balance/*.json へ書き出す(移行専用ツール)。
 * Vite の module runner で TS を評価し、値をそのまま JSON にする(依存追加なし)。
 * 既存ファイルの `_note` はキーごとに引き継ぐ(この道具が数値を上書きしても手で書いた「なぜ」は消さない)。
 *
 * 使い方: node scripts/extract-balance.mjs combat|enemies
 * 移行が終わったブロックから対応を増やす。移行が全部終わったらこのファイルごと削除してよい
 * (docs/ideas/data-externalization.md 6.0)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));

/** 段ごとに「どのモジュールの何を出すか」を書く */
const STEPS = {
  combat: {
    async pick(runner) {
      const tuning = await runner.import("/src/data/tuning.ts");
      return { MANA: tuning.MANA };
    },
    out: "src/data/balance/combat.json",
  },
  enemies: {
    async pick(runner) {
      const tuning = await runner.import("/src/data/tuning.ts");
      const enemiesMod = await runner.import("/src/data/enemies.ts");
      const combatMod = await runner.import("/src/data/enemyCombat.ts");
      const defenseMod = await runner.import("/src/data/enemyDefense.ts");
      // stats/combat/defense は data/enemies.ts 側が BALANCE.enemies.stats などを spread するだけの表に
      // なっているため、ここでは「今の enemies.json をそのまま読み直す」形になる(自己回帰チェック用)。
      // ENEMIES の並び順を保つため、キー順は enemies.json 側を正とする
      const balance = (await runner.import("/src/data/balance/index.ts")).BALANCE;
      void enemiesMod;
      void combatMod;
      void defenseMod;
      return {
        ENEMY_AI: tuning.ENEMY_AI,
        ENEMY_TEMPO: tuning.ENEMY_TEMPO,
        ELITE: tuning.ELITE,
        ELITE_GREEDY: tuning.ELITE_GREEDY,
        DOUBLE_CHARGE: tuning.DOUBLE_CHARGE,
        BOSS: tuning.BOSS,
        REAPER: tuning.REAPER,
        stats: balance.enemies.stats,
        combat: balance.enemies.combat,
        defense: balance.enemies.defense,
      };
    },
    out: "src/data/balance/enemies.json",
  },
  jobs: {
    async pick(runner) {
      const tuning = await runner.import("/src/data/tuning.ts");
      const jobsMod = await runner.import("/src/data/jobs.ts");
      // attributes / weakness.mul だけを JSON へ抜く。"none"(見習い)は空 / null なので TS 側に残す
      const attributes = {};
      const weakness = {};
      for (const key of jobsMod.JOB_KEYS) {
        if (key === "none") continue;
        const def = jobsMod.JOBS[key];
        attributes[key] = def.attributes;
        if (def.weakness) weakness[key] = def.weakness.mul;
      }
      return { JOB: tuning.JOB, attributes, weakness };
    },
    out: "src/data/balance/jobs.json",
  },
  weapons: {
    async pick(runner) {
      const tuning = await runner.import("/src/data/tuning.ts");
      return { WEAPON: tuning.WEAPON, PLAYER_MELEE: tuning.PLAYER.melee, ACTION_DASH_ATTACK: tuning.ACTION.dashAttack };
    },
    out: "src/data/balance/weapons.json",
  },
};

/** 既存 JSON の `_note`(キーごと)を新しい値へ引き継ぐ。配列はそのまま新しい値を使う */
function mergeNotes(prev, next) {
  if (Array.isArray(next)) return next;
  if (next !== null && typeof next === "object") {
    const out = {};
    if (prev && typeof prev === "object" && !Array.isArray(prev) && "_note" in prev) out._note = prev._note;
    for (const [key, value] of Object.entries(next)) {
      const prevChild = prev && typeof prev === "object" ? prev[key] : undefined;
      out[key] = mergeNotes(prevChild, value);
    }
    return out;
  }
  return next;
}

async function main() {
  const stepName = process.argv[2];
  const spec = stepName ? STEPS[stepName] : undefined;
  if (!spec) {
    console.error(`使い方: node scripts/extract-balance.mjs ${Object.keys(STEPS).join("|")}`);
    process.exit(1);
  }

  const viteEntry = require.resolve("vite");
  const { createServer, createServerModuleRunner } = await import(pathToFileURL(viteEntry).href);
  const server = await createServer({ root: ROOT, server: { middlewareMode: true }, logLevel: "error" });
  const runner = createServerModuleRunner(server.environments.ssr);

  const picked = await spec.pick(runner);
  const outPath = path.join(ROOT, spec.out);
  const prev = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : {};
  const merged = mergeNotes(prev, picked);
  writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`[extract-balance] wrote ${spec.out}`);

  await server.close();
  process.exit(0);
}

await main();
