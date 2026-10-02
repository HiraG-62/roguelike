// スキル石: 設置物・場（docs/ideas/fx-sprites.md 10 章）。単位は絵のドット（論理 0.5px）。場は向きを持たない（dirs 1）
//
// 氷結地帯（frostField）: 「地面を凍らせ、中の敵を凍結させながら継続ダメージを与える（自分も遅くなる）」。半径 40px・3 秒
// 墨の主題: 床に墨を一滴落とすと、氷のように冷えた墨が紙へ滲み広がる。滲みの縁は墨だまり、内側は氷の差し色のむら、
//   その上を細い筆の氷の割れ目（六角に折れる）が走る
// - 凍りつく（cast）: 中心に墨が落ちて跳ね（空中）、滲みが縁まで広がりながら割れ目の筆が中心から外へ走る（地面）
// - 凍った床（placed の地面）: 墨だまりの縁と、氷のむら・割れ目。むらはゆっくり流れる（冷気が床を這う）
// - 冷気（placed の空中）: 小さな六花（墨で描いた雪の結晶）が立ち昇る
// - 割れる（end）: 割れ目に沿って滲みが砕け、墨の欠片が外へ跳ねて掠れて消える
import { brushStroke, inkBlot, inkWash, lv, splatter } from "../brush.mjs";
import { clamp01, dot, hash1, paint, smoothstep, stamp } from "../raster.mjs";

const TAU = Math.PI * 2;
const FROST = {
  /** 半径（px）。SKILL.frostField.radius */
  radiusPx: 40,
  seed: 6101,
};
const R = FROST.radiusPx * 2;

/** 氷の割れ目の筆: 中心から外へ、折れながら伸びる 7 本（六角の氷に見えるよう 60° 前後で折れる） */
function crackPaths() {
  const paths = [];
  for (let i = 0; i < 7; i++) {
    const r = (k) => hash1(i * 17 + k, FROST.seed + 40);
    let a = (i / 7) * TAU + r(1) * 0.4;
    let x = Math.cos(a) * 6;
    let y = Math.sin(a) * 6;
    const pts = [{ x, y }];
    let len = 0;
    const total = R * (0.75 + 0.2 * r(2));
    let k = 0;
    while (len < total) {
      const seg = 10 + 10 * r(3 + k);
      a += (r(10 + k) > 0.5 ? 1 : -1) * (0.12 + 0.2 * r(20 + k));
      x += Math.cos(a) * seg;
      y += Math.sin(a) * seg;
      len += seg;
      pts.push({ x, y });
      k++;
    }
    paths.push(pts);
  }
  return paths;
}
const CRACKS = crackPaths();

/** 割れ目を描く（grow で中心から伸び、width は細い筆、level は芯の段） */
function cracks(frame, grow, fade, core) {
  CRACKS.forEach((pts, i) => brushStroke(frame, { pts, width: 1.8, grow, fade, dry: 0.2, core, edge: lv(5), press: 0.05, tail: 0.6, seed: FROST.seed + 50 + i }));
}

/** 凍りつく（地面）: 滲みが広がり、割れ目の筆が中心から走る */
function spread(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const reach = smoothstep(0, 0.7, p);
  inkWash(frame, { radius: R, reach, seed: FROST.seed, rimWidth: 3 + 2 * (1 - p), rimLevel: 5, tint: 6, density: 0.1, cell: 6 });
  cracks(frame, smoothstep(0.1, 0.9, p), 0, lv(7));
}

/** 凍りつく（空中）: 中心に墨が一滴落ちて、外へ跳ねる */
function spreadAir(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  if (p < 0.35) inkBlot(frame, { radius: 9 - 10 * p, seed: FROST.seed + 3, core: lv(6) });
  splatter(frame, f, 16, FROST.seed + 12, (i, r) => {
    const a = r(1) * TAU;
    return { x: Math.cos(a) * 4, y: Math.sin(a) * 4, vx: Math.cos(a) * (3 + 5 * r(2)), vy: Math.sin(a) * (3 + 5 * r(2)), size: r(3) > 0.55 ? 1.8 : 1, life: 5, level: r(4) > 0.5 ? 7 : 5 };
  });
}

const PLACED_FRAMES = 8;

/** 凍った床（置いてある間の地面）: 縁の墨だまりと、ゆっくり流れる氷のむら、割れ目 */
function floor(frame, f) {
  const drift = f / PLACED_FRAMES;
  // むらの模様を少しずつずらす（冷気が床を這う）。seed を巡らせると模様が跳ぶので、雑音の中心を回す
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R - 6) return -1;
      const ox = Math.cos(drift * TAU) * 4;
      const oy = Math.sin(drift * TAU) * 4;
      const m = hash1(Math.floor((x + ox) / 2) * 131 + Math.floor((y + oy) / 2), FROST.seed + 9);
      if (m > 0.05) return -1;
      if (((Math.floor(x) + Math.floor(y)) & 1) === 1) return -1;
      return lv(7);
    },
    { bounds: { x0: -R, y0: -R, x1: R, y1: R }, dither: 0 },
  );
  inkWash(frame, { radius: R, reach: 1, seed: FROST.seed, rimWidth: 3, rimLevel: 5, tint: 6, density: 0.1, cell: 6 });
  cracks(frame, 1, 0, lv(6));
}

/** 墨の六花（小さな 6 本腕。芯は差し色、腕は墨） */
const FLAKE = ["..6..", "6.5.6", ".575.", "6.5.6", "..6.."];

/** 冷気: 六花と氷の粒がゆっくり立ち昇る（繰り返しの周期で上へ 1 巡） */
function mist(frame, f) {
  const seed = FROST.seed + 20;
  for (let i = 0; i < 10; i++) {
    const r = (k) => hash1(i * 9 + k, seed);
    const a = r(1) * TAU;
    const at = R * 0.8 * Math.sqrt(r(2));
    const phase = (f / PLACED_FRAMES + r(3)) % 1;
    if (phase > 0.85) continue;
    const x = Math.cos(a) * at + Math.sin(phase * TAU + i) * 2;
    const y = Math.sin(a) * at - phase * 20;
    if (i % 3 === 0) stamp(frame, x, y, FLAKE);
    else dot(frame, x, y, phase < 0.5 ? 7 : 6);
  }
}

/** 割れる: 割れ目が太く走って滲みが砕け、墨の欠片が外へ跳ねる。最後は掠れて消える */
function shatter(frame, f) {
  const frames = 8;
  const p = (f + 0.5) / frames;
  const fade = smoothstep(0.2, 1, p);
  // 砕けていく滲み: 縁から齧られる
  paint(
    frame,
    (x, y) => {
      const r = Math.hypot(x, y);
      if (r > R) return -1;
      const rim = R - r;
      if (rim > 4) return -1;
      if (hash1(Math.floor(Math.atan2(y, x) * 40), FROST.seed + 70) < fade * 1.2) return -1;
      return lv(5);
    },
    { bounds: { x0: -R - 4, y0: -R - 4, x1: R + 4, y1: R + 4 }, dither: 0 },
  );
  CRACKS.forEach((pts, i) => brushStroke(frame, { pts, width: 2.6 * (1 - 0.5 * p), fade, dry: 0.3, core: lv(7), edge: lv(5), press: 0.05, tail: 0.5, seed: FROST.seed + 80 + i }));
  splatter(frame, f, 24, FROST.seed + 13, (i, r) => {
    const a = r(1) * TAU;
    const at = R * Math.sqrt(r(2));
    return { x: Math.cos(a) * at, y: Math.sin(a) * at, vx: Math.cos(a) * (1.5 + 3 * r(3)), vy: Math.sin(a) * (1.5 + 3 * r(3)) - 1, size: r(4) > 0.5 ? 1.6 : 1, life: 4 + Math.floor(4 * r(5)), level: r(6) > 0.5 ? 7 : 5 };
  });
  void clamp01;
}

const SIZE = Math.ceil(R + 24) * 2;

const FX = {
  skills: {
    frostField: {
      ramp: "ice",
      cast: { sheet: "skillPlaced.frostSpreadAir", life: 0.4, base: FROST.radiusPx, ground: "skillPlaced.frostSpread" },
      placed: { sheet: "skillPlaced.frostMist", base: FROST.radiusPx, period: 1.6, ground: "skillPlaced.frostFloor" },
      end: { sheet: "skillPlaced.frostShatter", life: 0.4, base: FROST.radiusPx },
    },
  },
};

export const ATLAS = {
  key: "skillPlaced",
  fx: FX,
  sheets: [
    { key: "skillPlaced.frostSpread", dirs: 1, frames: 8, active: 0, size: SIZE, draw: spread },
    { key: "skillPlaced.frostSpreadAir", dirs: 1, frames: 8, active: 0, size: SIZE, draw: spreadAir },
    { key: "skillPlaced.frostFloor", dirs: 1, frames: PLACED_FRAMES, active: 0, size: SIZE, draw: floor },
    { key: "skillPlaced.frostMist", dirs: 1, frames: PLACED_FRAMES, active: 0, size: SIZE, draw: mist },
    { key: "skillPlaced.frostShatter", dirs: 1, frames: 8, active: 0, size: SIZE, draw: shatter },
  ],
};
