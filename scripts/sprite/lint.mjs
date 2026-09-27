// キャラのドット絵を様式書（docs/ideas/graphics-style.md）の決まりで点検する。
// テスト（render/sprites.test.ts）が落とす項目ではなく、描いている途中に目で確かめたい癖を数字にする
// ブラウザの作業台（src/tools/spriteGen.ts）からも読むので、Node の API を引く raster.mjs には依存しない

const TRANSPARENT = ".";
const OUTLINE = "k";
const WHITE = "1";
/** 頭上に空ける論理行数（論理キャンバスが 24 以上のとき）。密度 dots なら実際は HEAD_ROOM * dots 行 */
const HEAD_ROOM = 2;
const HEAD_ROOM_MIN_CANVAS = 24;
/** 艶の白は点と眼に使う（眼 2 つで 8〜12px、論理 px^2）。これを超えたら塗りに使っている疑い。密度 dots なら dots^2 倍する */
const WHITE_MAX_PX = 12;
/** 見た目の芯を寄せる中央の論理幅（様式書 1 章: 24 なら col 6〜17）。密度 dots なら CORE_WIDTH * dots */
const CORE_WIDTH = 12;
/** 芯の外にある画素の割合がこれを超えたら警告 */
const CORE_OUTSIDE_MAX = 0.35;
/** 48 論理px 以上、または密度 2 以上のキーは PALETTE_RAMPS の 5 段で塗る前提に切り替える */
const RAMP_MIN_LOGICAL_SIZE = 48;
const RAMP_MIN_DOTS = 2;
/** 3 段 / 5 段の崩れ注意を出す最低画素数 */
const SHADE_MIN_PX = 8;

function at(frame, x, y) {
  if (y < 0 || y >= frame.length) return TRANSPARENT;
  return frame[y]?.[x] ?? TRANSPARENT;
}

/** 透明に接する不透明画素のうち輪郭色でないもの */
function outlineGaps(frame) {
  const gaps = [];
  for (let y = 0; y < frame.length; y++) {
    const row = frame[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === TRANSPARENT || ch === OUTLINE) continue;
      const exposed = [at(frame, x - 1, y), at(frame, x + 1, y), at(frame, x, y - 1), at(frame, x, y + 1)].some((n) => n === TRANSPARENT);
      if (exposed) gaps.push(`(${x},${y})${ch}`);
    }
  }
  return gaps;
}

function countChars(frame) {
  const counts = new Map();
  for (const row of frame) for (const ch of row) if (ch !== TRANSPARENT) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return counts;
}

function isEmptyRow(row) {
  return [...(row ?? "")].every((ch) => ch === TRANSPARENT);
}

/** 不透明画素の外接矩形と、中央帯の外にある画素の割合 */
function bounds(frame, coreWidth) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = -1;
  let total = 0;
  let outside = 0;
  const w = frame[0]?.length ?? 0;
  const coreL = Math.floor((w - coreWidth) / 2);
  const coreR = coreL + coreWidth - 1;
  for (let y = 0; y < frame.length; y++) {
    const row = frame[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      if (row[x] === TRANSPARENT) continue;
      total++;
      if (x < coreL || x > coreR) outside++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY, total, outsideRatio: total ? outside / total : 0 };
}

/**
 * 陰影の崩れ（塗りが 1 段だけで陰影が付いていない）を注意の文字列にして返す。
 * 48 論理px 以上・密度 2 以上（useRamps）は `PALETTE_RAMPS` の 5 段（同じ系統のどれか 2 段以上を使っていれば崩れと見なさない）、
 * それ以外は従来の 3 段（小文字の基本色に大文字の暗部が対で無ければ崩れ）で判定する
 */
function shadeWarnings(counts, palette, ramps, useRamps) {
  if (!useRamps || !ramps) {
    const msgs = [];
    // 3 段: 基本色（小文字）を使っていて暗部（大文字）が無い。輪郭 k の対 K は別用途なので除く
    for (const ch of counts.keys()) {
      const dark = ch.toUpperCase();
      if (ch === OUTLINE || ch !== ch.toLowerCase() || ch === dark || !(dark in palette)) continue;
      if (!counts.has(dark) && (counts.get(ch) ?? 0) >= SHADE_MIN_PX) {
        msgs.push(`'${ch}' を ${counts.get(ch)}px 塗っているが暗部 '${dark}' が無い（3 段にする）`);
      }
    }
    return msgs;
  }
  const msgs = [];
  for (const [name, chars] of Object.entries(ramps)) {
    const used = chars.filter((ch) => (counts.get(ch) ?? 0) > 0);
    const total = used.reduce((s, ch) => s + (counts.get(ch) ?? 0), 0);
    if (total < SHADE_MIN_PX || used.length >= 2) continue;
    msgs.push(`${name} 系統を '${used[0]}' の 1 段（${total}px）でしか塗っていない（ハイライト・明・暗・最暗のどれかも使って陰影を付ける）`);
  }
  return msgs;
}

/**
 * 1 キーの全フレームを点検して行の配列（表示用）を返す。warn は注意の件数。
 * dots はスプライトの密度（`spriteDots`）。頭上の行数・中央帯・白の目安を密度に合わせて広げる
 */
export function lintFrames(key, frames, palette, dots = 1, ramps) {
  const lines = [];
  let warn = 0;
  const size = frames[0]?.length ?? 0;
  const logicalSize = size / dots;
  const headRoom = HEAD_ROOM * dots;
  const coreWidth = CORE_WIDTH * dots;
  const whiteMax = WHITE_MAX_PX * dots * dots;
  const useRamps = Boolean(ramps) && (logicalSize >= RAMP_MIN_LOGICAL_SIZE || dots >= RAMP_MIN_DOTS);
  const note = (msg) => {
    lines.push(`  ! ${msg}`);
    warn++;
  };
  lines.push(`${key}: ${frames[0]?.[0]?.length ?? 0}x${size}、${frames.length} フレーム（密度 ${dots}）`);

  frames.forEach((frame, i) => {
    const gaps = outlineGaps(frame);
    const counts = countChars(frame);
    const b = bounds(frame, coreWidth);
    const used = [...counts.entries()].sort((p, q) => q[1] - p[1]).map(([ch, n]) => `${ch}${n}`).join(" ");
    lines.push(`  [${i}] 画素 ${b.total}、範囲 x${b.minX}-${b.maxX} y${b.minY}-${b.maxY}、色 ${used}`);

    if (gaps.length) note(`[${i}] 輪郭が閉じていない（透明に接する ${OUTLINE} 以外）: ${gaps.slice(0, 8).join(" ")}${gaps.length > 8 ? ` …計 ${gaps.length}` : ""}`);
    if (logicalSize >= HEAD_ROOM_MIN_CANVAS) {
      for (let y = 0; y < headRoom; y++) if (!isEmptyRow(frame[y])) note(`[${i}] 頭上 row ${y} に画素がある（ラベルと重なる）`);
    }
    if (isEmptyRow(frame[size - 1])) lines.push(`  - [${i}] 最下段が空（歩き原画なら足を最下段に。lift / 浮遊なら可）`);
    const white = counts.get(WHITE) ?? 0;
    if (white > whiteMax) note(`[${i}] 白 '${WHITE}' が ${white}px（艶の点と眼・牙だけに。密度 ${dots} の目安は ${whiteMax}px 以下）`);
    if (b.outsideRatio > CORE_OUTSIDE_MAX) note(`[${i}] 中央 ${coreWidth}px の外に ${Math.round(b.outsideRatio * 100)}%（芯を中央に寄せ、外側は薄い要素に）`);
    for (const msg of shadeWarnings(counts, palette, ramps, useRamps)) note(`[${i}] ${msg}`);
  });
  return { lines, warn };
}
