// 武器種のモーションの絵を、今の当たり判定の大きさに合わせて描く縮尺（docs/ideas/fx-sprites.md 3.4）。
// シートの base（絵を作ったときの当たり判定の値）と、balance の JSON の今の値の比で作業面を縮めて描き、
// 一覧の base を今の値に書き換える。実行時の fitScale はほぼ 1 になり、絵を描き先で拡縮しない（ドットが崩れず、振りの原点から外縁までが当たり判定と揃う）
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** 比がこれより 1 に近ければ描き直さない（丸めの誤差で絵を変えない） */
const SAME = 0.005;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** 武器種の段（JSON のまま）。剣の左の段とダッシュ攻撃は PLAYER_MELEE / ACTION_DASH_ATTACK が元（data/weapons.ts の swordSteps と同じ） */
function movesetRaw(root, moveset) {
  const dir = join(root, "src/data/balance/weapons");
  const file = join(dir, "WEAPON/movesets", `${moveset}.json`);
  if (!existsSync(file)) return undefined;
  const raw = readJson(file);
  if (moveset !== "sword") return raw;
  return { ...raw, steps: readJson(join(dir, "PLAYER_MELEE.json")), dashAttack: readJson(join(dir, "ACTION_DASH_ATTACK.json")) };
}

/** 右の段（key で引く）の振り。振り・溜め・構えを離した振り */
function laneStep(raw, key) {
  const s = (raw.steps2 ?? []).find((x) => x.key === key);
  if (!s) return undefined;
  if (s.kind === "swing") return s.step;
  if (s.kind === "charge") return s.charge?.step;
  if (s.kind === "hold") return s.hold?.release;
  return undefined;
}

/** モーションの key（render/fxMotions.ts の motionKey）→ 段 */
function stepOf(raw, motion) {
  if (motion === "dash") return raw.dashAttack;
  if (motion === "charge") return raw.charge?.step ?? (raw.steps2 ?? []).find((x) => x.kind === "charge")?.charge?.step;
  const [kind, key] = [motion.slice(0, motion.indexOf(":")), motion.slice(motion.indexOf(":") + 1)];
  if (kind === "l") return raw.steps?.[Number(key)];
  if (kind === "r") return laneStep(raw, key);
  if (kind === "branch") return key.endsWith(".release") ? laneStep(raw, key.slice(0, -".release".length)) : raw.branches?.[key]?.step;
  return undefined;
}

/**
 * アトラスの縮尺: sheets（シートの key → 縮尺。地面の層も同じ）と、base を今の値に書き換えた fx の表。
 * 1 つのシートを大きさの違う複数のモーションが使うと描き分けられないので止める
 */
export function fitAtlas(root, atlas) {
  const fx = atlas.fx;
  const sheets = new Map();
  if (!fx?.moveset || !fx.motions) return { sheets, fx };
  const raw = movesetRaw(root, fx.moveset);
  if (!raw) return { sheets, fx };
  const motions = {};
  for (const [key, m] of Object.entries(fx.motions)) {
    const step = stepOf(raw, key);
    const actual = step?.[m.measure];
    if (typeof actual !== "number" || actual <= 0 || !(m.base > 0)) {
      motions[key] = m;
      continue;
    }
    const scale = Math.abs(actual / m.base - 1) < SAME ? 1 : actual / m.base;
    for (const sheet of [m.sheet, m.ground].filter(Boolean)) {
      const prev = sheets.get(sheet);
      if (prev !== undefined && Math.abs(prev - scale) > 1e-9) throw new Error(`fx: ${sheet} を大きさの違うモーションが共有している（${prev} と ${scale}）`);
      sheets.set(sheet, scale);
    }
    motions[key] = scale === 1 ? m : { ...m, base: actual };
  }
  return { sheets, fx: { ...fx, motions } };
}
