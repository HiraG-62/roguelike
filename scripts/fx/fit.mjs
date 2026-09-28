// 武器種のモーションの絵を、今の当たり判定の大きさに合わせて描く縮尺（docs/ideas/fx-sprites.md 3.4）。
// 絵を縮尺 1 で描いて外縁（原点からの距離）を測り、その外縁が当たり判定の外縁に重なる縮尺で作業面を縮めて描く。
// 一覧の base は今の値に書き換えるので、実行時の fitScale は 1 になり、描き先で拡縮しない（ドットが崩れず、振りの原点から外縁までが当たり判定と揃う）
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Frame, cleanup } from "./raster.mjs";

/** 比がこれより 1 に近ければ描き直さない（丸めの誤差で絵を変えない） */
const SAME = 0.005;
/** 絵の 1 論理 px のドット数（FX_ART_SCALE） */
const DOTS_PER_PX = 2;
/** 外縁とみなす距離の分位（飛び散る粒・砂煙の数ドットで縮めすぎない） */
const EDGE_QUANTILE = 0.97;
/** 縮尺を 1 より大きくしない（小さく描いた絵を引き伸ばすと細部が崩れる。足りない分は実行時の fitScale に任せない＝絵のまま） */
const MAX_SCALE = 1;

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

/** 弾を出す派生（絵は飛ぶ弾を描いていて、近接の当たり判定の大きさとは関係ない） */
function firesShots(raw, motion) {
  if (!motion.startsWith("branch:")) return false;
  return !!raw.branches?.[motion.slice("branch:".length)]?.shots;
}

/** 当たり判定の外縁までの距離（論理 px）。self は体の中心（描くのは肩からなので数 px 前へずれる）、anchor は当たり判定の中心から */
function targetEdge(step, pivot) {
  const kind = step.shape?.kind ?? "box";
  if (pivot === "self") return kind === "box" || kind === "circle" ? step.reach + step.size / 2 : step.reach;
  if (pivot === "anchor") return kind === "box" || kind === "circle" ? step.size / 2 : step.reach / 2;
  return undefined;
}

/** 縮尺 1 で描いたときの絵の外縁（論理 px）。向き 0 の active のコマの不透明なドットの、原点からの距離の分位 */
function measuredEdge(sheet) {
  const dists = [];
  const frames = Math.max(1, Math.min(sheet.frames, sheet.active || sheet.frames));
  for (let f = 0; f < frames; f++) {
    const frame = new Frame(sheet.size, sheet.size, 0, 1);
    sheet.draw(frame, f, { dir: 0, angle: 0 });
    cleanup(frame);
    for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) if (frame.get(x, y)) dists.push(Math.hypot(x + 0.5 - frame.cx, y + 0.5 - frame.cy));
  }
  if (!dists.length) return undefined;
  dists.sort((a, b) => a - b);
  return (dists[Math.floor((dists.length - 1) * EDGE_QUANTILE)] ?? 0) / DOTS_PER_PX;
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
  const byKey = new Map(atlas.sheets.map((s) => [s.key, s]));
  const motions = {};
  for (const [key, m] of Object.entries(fx.motions)) {
    const step = stepOf(raw, key);
    if (firesShots(raw, key)) {
      // 絵は弾のまま（縮めない）。実行時にも比で拡縮しないよう base だけ今の値にする
      const now = step?.[m.measure];
      motions[key] = typeof now === "number" && now > 0 ? { ...m, base: now } : m;
      continue;
    }
    const actual = step?.[m.measure];
    const target = step ? targetEdge(step, m.pivot) : undefined;
    const sheet = byKey.get(m.sheet);
    const edge = sheet && target ? measuredEdge(sheet) : undefined;
    if (typeof actual !== "number" || actual <= 0 || !target || !edge) {
      motions[key] = m;
      continue;
    }
    const fit = Math.min(MAX_SCALE, target / edge);
    const scale = Math.abs(fit - 1) < SAME ? 1 : fit;
    for (const k of [m.sheet, m.ground].filter(Boolean)) {
      const prev = sheets.get(k);
      if (prev !== undefined && Math.abs(prev - scale) > 1e-9) throw new Error(`fx: ${k} を大きさの違うモーションが共有している（${prev} と ${scale}）`);
      sheets.set(k, scale);
    }
    // 絵は今の数値で描いたので、実行時は拡縮しない
    motions[key] = { ...m, base: actual };
  }
  return { sheets, fx: { ...fx, motions } };
}
