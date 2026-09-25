import type { GameState } from "../core/state";
import { SKILL } from "../skills/data";
import { boonHudTop } from "./boonUi";
import { TEXT, textLineHeight } from "./pixelText";
import { type HudLayout, hudLayout } from "./renderMath";

/**
 * 画面の描画の層（下から順に描く）。UI 同士が重なったとき、どちらが上に来るかをここで決める。
 * - world: マップ・床・敵・自分・弾・スキルの設置物・浮き文字（カメラの座標系）
 * - worldOverlay: ワールドにだけ掛ける画面効果（暗がり・霧・周辺減光・スロー・被弾の赤・白い閃光・撃破の光条・ボスの黒帯）。
 *   HUD は覆わず、フラッシュ中も体力やスキルが読める
 * - hud: 常に出す計器（体力・気力・ミニマップ・右上の欄・ボスの体力・コンボ・スキル枠・変身の行）
 * - hudOverlay: 一時的な知らせ（連鎖の表示）
 * - transition: 階層移動の黒帯と階層の名札（HUD ごと覆う）
 * - popup: 手前に出る選択・説明（祝福アイコンとそのツールチップ・床のアイテムのツールチップ・祝福 3 択・死亡画面）。
 *   祝福 3 択は黒帯を閉じたまま出すので transition より上
 * - cursor: 照準（常に最前面）
 *
 * main.ts が render の後に重ねる芽・装備画面・ポーズ・設定は popup より上（別キャンバスではなく後から描く）
 */
export const RENDER_LAYERS = ["world", "worldOverlay", "hud", "hudOverlay", "transition", "popup", "cursor"] as const;
export type RenderLayer = (typeof RENDER_LAYERS)[number];

/** 各層で描くもの（renderer.ts の描画関数名。並び順もこの通り）。資料とテストのための表 */
export const LAYER_CONTENTS: Readonly<Record<RenderLayer, readonly string[]>> = {
  world: [
    "drawTiles",
    "drawBiomeTint",
    "drawTerrainLayer",
    "drawGroundMarks",
    "drawPickups",
    "drawFloorItems",
    "drawGroundHazards",
    "drawSkillGround",
    "drawLinks",
    "drawEliteChains",
    "drawRunWorld",
    "drawEnemies",
    "drawDeathFx",
    "drawBossDeath",
    "drawProjectiles",
    "drawLasers",
    "drawPlayerAuras",
    "drawPlayer",
    "drawReaper",
    "drawSkillAir",
    "drawSmokeLayer",
    "drawShapes",
    "drawAirMarks",
    "drawParticles",
    "drawTexts",
  ],
  worldOverlay: ["darkness", "drawRunOverlay", "drawOverlays", "drawScreenMarks", "drawBossLetterbox"],
  hud: ["drawHud", "drawSkillSlots"],
  hudOverlay: ["drawChainHud"],
  transition: ["drawFloorWipe", "drawFloorCard"],
  popup: ["drawBoonHud", "drawDropFocus", "drawBoonChoice", "drawDeath"],
  cursor: ["drawCrosshair"],
};

/** 層の重なり順（大きいほど上） */
export function layerIndex(layer: RenderLayer): number {
  return RENDER_LAYERS.indexOf(layer);
}

/** 層ごとの描画を RENDER_LAYERS の順に呼ぶ（renderer.ts の render はこれだけで順を決める） */
export function drawInLayerOrder(handlers: Readonly<Record<RenderLayer, () => void>>): void {
  for (const layer of RENDER_LAYERS) handlers[layer]();
}

/** いまの state での画面下の HUD の配置（祝福の段数と文字の行高で決まる。祝福 0 個でも 1 段分を空けて位置を動かさない） */
export function hudLayoutFor(state: GameState, lineH: number = textLineHeight(TEXT.SMALL)): HudLayout {
  return hudLayout(boonHudTop(Math.max(1, state.boons.length)), lineH, SKILL.slots);
}
