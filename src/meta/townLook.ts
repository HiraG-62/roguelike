/**
 * 門前町の景色の材料（docs/ideas/hub-town-impl.md 5 章）。既存の保存データ（図鑑・実績・プロファイル・寄進・ボスの間）から導く純関数。
 * 新しい保存キーは持たない。描画（render/townScene.ts・townArt.ts）はこれを読むだけ
 */
import { ENEMIES } from "../data/enemies";
import { ARC, HUB_DECOR } from "../data/tuning";
import { hallBossKeys, hallDepthOf } from "../system/bossHallKeys";
import { chapterOf } from "../system/chapters";
import { currentTitleLabel } from "./achievements";
import { type FacilityKey, type HubProgressSource, builtFacilities, shelfCount } from "./hub";
import { donatedOf, type HubSave } from "./hubStore";
import { createQuestSave } from "./quests";
import { bestClearTierOf, hasCleared } from "./tierRewards";

export interface TownLook {
  /** 見た目が変わる材料をつないだ鍵。同じなら同じ絵（描画側の canvas の作り直しの判断に使う） */
  key: string;
  /** 建っている設備（建物の絵・提灯・暖簾） */
  built: ReadonlySet<FacilityKey>;
  /** 参道に立つ灯籠の数（HubLayout.lanternSlots の前から） */
  lanterns: number;
  /** 井戸の段（0〜3。寄進の総額で育つ） */
  wellTier: number;
  /** 御堂の前の幟の章（倒したボス 1 体につき 1 本。値は章 1〜4 の色の番号） */
  trophies: readonly number[];
  /** 御堂の篝火（ボスの間で勝ったことがある） */
  hallLit: boolean;
  /** 記録の蔵の窓の灯の数（0〜5。書架の段） */
  archiveLights: number;
  /** 踏破の碑の位階（0 は碑が無い） */
  stele: number;
  /** 最深の章（1〜4。深み以降は 4）。石段の奥の灯の色 */
  deepestChapter: number;
  /** 賑わいの段（0〜4。ランの回数） */
  bustle: number;
  /** 高札に掲げる称号（名乗っていなければ null） */
  title: string | null;
}

/** 景色の材料の入力。bestDepth は profile.meta.bestDepth の写し（省略は 0） */
export interface TownSource extends HubProgressSource {
  bestDepth?: number;
}

/** 境目の配列のうち、値が届いているものの数（段の数）。境目は昇順 */
function stageOf(value: number, bounds: readonly number[]): number {
  return bounds.filter((b) => value >= b).length;
}

function lanternCount(clears: number): number {
  return Math.min(HUB_DECOR.lanternMax, HUB_DECOR.lanternBase + HUB_DECOR.lanternPerClear * Math.max(0, clears));
}

/** 踏破の碑の段。踏破したことがなければ 0（碑なし）、踏破したら 1 から位階の境目ごとに 1 段 */
function steleTier(src: TownSource): number {
  const meta = { clears: src.clears, bestClearTier: src.bestClearTier };
  if (!hasCleared(meta)) return 0;
  return 1 + stageOf(bestClearTierOf(meta), HUB_DECOR.steleClearBounds);
}

/** ボスの章（幟の色の番号）。ボスの間の候補は階から、深みの回転のボスは最後の章 */
function bossChapter(key: string): number {
  const depth = hallDepthOf(key);
  return depth === null ? ARC.maxChapter : chapterOf(depth);
}

/** 倒したボスの幟の章。章の若い順、同じ章は ENEMIES の並び順。最大数で打ち切る（双子の片割れ bossPart は数えない） */
function trophyChapters(src: TownSource): number[] {
  const chapters: number[] = [];
  for (const def of ENEMIES) {
    if (def.boss !== true) continue;
    if ((src.codex.enemyKills[def.key] ?? 0) <= 0) continue;
    chapters.push(bossChapter(def.key));
  }
  return chapters.sort((a, b) => a - b).slice(0, HUB_DECOR.trophyMax);
}

function hallWon(save: HubSave): boolean {
  const known = new Set(hallBossKeys());
  return Object.entries(save.hall ?? {}).some(([key, record]) => known.has(key) && record.wins > 0);
}

/** 見た目の材料をつないだ鍵。段・数・有無だけを並べ、同じ見え方なら同じ文字列になる */
function lookKey(look: Omit<TownLook, "key">): string {
  const built = [...look.built].sort().join(",");
  const parts = [
    `b:${built}`,
    `l:${look.lanterns}`,
    `w:${look.wellTier}`,
    `t:${look.trophies.join("")}`,
    `h:${look.hallLit ? 1 : 0}`,
    `a:${look.archiveLights}`,
    `s:${look.stele}`,
    `c:${look.deepestChapter}`,
    `u:${look.bustle}`,
    `n:${look.title ?? ""}`,
  ];
  return parts.join("|");
}

/** 既存の保存データから門前町の景色を導く純関数（新しい保存キーは持たない） */
export function townLook(src: TownSource, save: HubSave): TownLook {
  const look: Omit<TownLook, "key"> = {
    built: new Set<FacilityKey>(builtFacilities(src)),
    lanterns: lanternCount(src.clears ?? 0),
    wellTier: stageOf(donatedOf(save), HUB_DECOR.wellDonationBounds),
    trophies: trophyChapters(src),
    hallLit: hallWon(save),
    archiveLights: shelfCount(src.codex),
    stele: steleTier(src),
    deepestChapter: chapterOf(src.bestDepth ?? 0),
    bustle: stageOf(src.runs, HUB_DECOR.bustleRunBounds),
    title: currentTitleLabel(src.achievements, src.quests ?? createQuestSave()),
  };
  return { key: lookKey(look), ...look };
}
