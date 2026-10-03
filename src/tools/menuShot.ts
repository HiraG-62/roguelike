// 装備画面（装束と紋）と武器指南書の確認用の撮影。ゲーム本体からは import しない。
// クエリ: ?scene=attire|attire-swap|skills|skills-lift|cand-stone|cand-group|cand-slot|manual で場面を作って 1 回描き、window.__menuShotReady = true。
// manual は &weapon=<武器種>&move=<技の添字>&frames=<実演を進めるステップ数> で武器指南書の頁と実演の 1 コマ
// dojo は &enemy=<敵の key>&count=<数>&behavior=<動き>&frames=<ステップ数>&stand=<台の key> で稽古の間（手前の敵へ寄って殴り続ける）、dojo-board は稽古帳
// 実時間・Math.random は使わない（state.rng と固定の seed だけ）
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import { generateItem } from "../loot/generator";
import { basesForSlot } from "../loot/bases";
import { LOOT_SLOTS, type Item } from "../loot/types";
import { equipItem } from "../loot/profile";
import { createCraftSave } from "../loot/craftingStore";
import { stoneFromSeed } from "../skills/generator";
import { addStone, equipStone } from "../skills/persistence";
import { SKILL_KEYS } from "../skills/types";
import { Renderer } from "../render/renderer";
import { drawInventoryUi } from "../render/inventoryUi";
import { createInventoryUi } from "../ui/inventory";
import { candidatesFor, openMenu } from "../ui/menuActions";
import { applyEquipmentChange } from "../ui/menuActions";
import { fid } from "../ui/menuFocus";
import { HAND_SLOT, topView } from "../ui/menuState";
import { candidateEntries, entryFocusId } from "../ui/candidates";
import type { GameState } from "../core/state";
import { FIXED_DT } from "../core/loop";
import { MANUAL_KEYS } from "../meta/weaponManual";
import { stepManualDemo } from "../system/manualDemo";
import { createManualUi, stepManualUi, syncManualDemo } from "../ui/weaponManual";
import { drawWeaponManual } from "../render/weaponManualUi";
import { TEXT, textLineHeight, wrapText } from "../render/pixelText";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { VIEW_H, VIEW_W } from "../core/view";
import { createEmptyProfile } from "../loot/types";
import { createDefaultSkillProfile } from "../skills/persistence";
import { createDojo, dojoMeterView, stepDojo } from "../system/dojo";
import { DOJO_BEHAVIORS, defaultDojoConfig } from "../system/dojoConfig";
import { createDojoBoardUi, dojoBoardRowGap } from "../ui/dojoBoard";
import { DOJO_SPOT_KEYS } from "../map/dojoMap";
import { loadImageAtlas } from "../render/imageAtlas";
import { SHEETS, TILE_SPRITES } from "../data/tiles";
import { TILE_SIZE } from "../map/grid";
import { drawDojoBoard, drawDojoOverlay, drawDojoProps } from "../render/dojoUi";

declare global {
  interface Window {
    __menuShotReady?: boolean;
    __menuShotError?: string;
  }
}

const SEED = 7;
const STASH_PER_SLOT = 4;

function item(slot: (typeof LOOT_SLOTS)[number], n: number, depth: number): Item {
  const base = basesForSlot(slot, 99)[0];
  if (!base) throw new Error(`base missing: ${slot}`);
  return generateItem(createRng(100 + n), { baseKey: base.key, itemLevel: depth, foundDepth: depth, now: n });
}

function buildState(): GameState {
  const state = createGame(SEED);
  state.depth = 4;
  state.profile.stash = [];
  let n = 0;
  for (const slot of LOOT_SLOTS) {
    for (let i = 0; i < STASH_PER_SLOT; i++) state.profile.stash.push(item(slot, n++, 3 + i));
    const worn = item(slot, n++, 3);
    state.profile.stash.push(worn);
    equipItem(state.profile, worn.id);
  }
  applyEquipmentChange(state);
  const profile = state.skills.profile;
  profile.stones = [];
  profile.loadout = [null, null, null, null];
  SKILL_KEYS.slice(0, 9).forEach((skillKey, i) => addStone(profile, stoneFromSeed(30 + i, { skillKey, foundDepth: 2, now: i })));
  profile.stones.slice(0, 4).forEach((s, i) => equipStone(profile, s.id, i));
  addDupes(state);
  return state;
}

/** 束と宿り符の見本: スキル 2 と同じスキルの石 3 個（1 個は宿り符）と、付けていないスキルの石 2 個 */
function addDupes(state: GameState): void {
  const profile = state.skills.profile;
  const wornKey = SKILL_KEYS[1];
  const looseKey = SKILL_KEYS[6];
  if (wornKey === undefined || looseKey === undefined) return;
  [0, 1, 2].forEach((i) => {
    const s = stoneFromSeed(60 + i, { skillKey: wornKey, foundDepth: 6, now: 20 + i });
    addStone(profile, i === 0 ? { ...s, dwell: "echo" } : s);
  });
  [0, 1].forEach((i) => addStone(profile, stoneFromSeed(70 + i, { skillKey: looseKey, foundDepth: 4, now: 30 + i })));
}

const MANUAL_DEFAULT_FRAMES = 30;
/** 絵（体・武器のアトラス）と稽古場の床が焼き上がるまで描き直す上限 */
const MANUAL_SETTLE_FRAMES = 240;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** 武器指南書の頁と実演の 1 コマ。実演は frames ステップ進めてから、絵が読めるまで同じコマを描き直す */
async function shootManual(renderer: Renderer, q: URLSearchParams): Promise<void> {
  const weapon = q.get("weapon") ?? "sword";
  const key = MANUAL_KEYS.find((k) => k === weapon) ?? "sword";
  const ui = createManualUi(key);
  const lineH = textLineHeight(TEXT.SMALL);
  const wrap = (t: string, w: number): string[] => wrapText(t, w, TEXT.SMALL);
  const move = Number(q.get("move") ?? 0);
  for (let i = 0; i < move; i++) stepManualUi(ui, { navX: 0, navY: 1, wheel: 0, aim: null, click: false, confirm: false }, wrap, lineH);
  const demo = syncManualDemo(ui, 1);
  const frames = Number(q.get("frames") ?? MANUAL_DEFAULT_FRAMES);
  if (demo !== null) for (let i = 0; i < frames; i++) stepManualDemo(demo, FIXED_DT);
  for (let i = 0; i < MANUAL_SETTLE_FRAMES; i++) {
    renderer.beginFrame();
    drawWeaponManual(renderer.context, renderer, { ui, hint: "↑↓ 技を選ぶ　←→ 武器種　Enter 最初から　Esc 戻る" });
    if (demo === null || (renderer.playerArtReady(demo.state) && i > 30)) break;
    await nextFrame();
  }
}

const DOJO_DEFAULT_FRAMES = 240;
/** 稽古の間の撮影で敵へ寄る距離（px）と、攻撃を押す間隔（ステップ） */
const DOJO_REACH = 26;
const DOJO_ATTACK_EVERY = 8;

/** 一番近い敵へ寄り、届いたら殴り続ける入力 */
function dojoBotInput(state: GameState, i: number): FrameInput {
  const p = state.player.body.pos;
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const e of state.enemies) {
    const d = Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y);
    if (e.hp > 0 && d < bestD) {
      best = e.body.pos;
      bestD = d;
    }
  }
  if (best === null) return EMPTY_INPUT;
  const cam = state.camera;
  const aimScreen = { x: best.x - cam.pos.x + VIEW_W / 2, y: best.y - cam.pos.y + VIEW_H / 2 };
  const far = bestD > DOJO_REACH;
  const move = far ? { x: (best.x - p.x) / bestD, y: (best.y - p.y) / bestD } : { x: 0, y: 0 };
  return { ...EMPTY_INPUT, move, aimScreen, attackPressed: !far && i % DOJO_ATTACK_EVERY === 0 };
}

/** 稽古の間を frames ステップ進めた 1 コマ（board = 稽古帳の画面） */
async function shootDojo(renderer: Renderer, q: URLSearchParams, board: boolean): Promise<void> {
  const config = defaultDojoConfig();
  config.enemy = q.get("enemy") ?? config.enemy;
  config.count = Number(q.get("count") ?? config.count);
  const behavior = DOJO_BEHAVIORS.find((b) => b === q.get("behavior"));
  if (behavior !== undefined) config.behavior = behavior;
  if (board) {
    renderer.beginFrame();
    drawDojoBoard(renderer.context, { ui: createDojoBoardUi(), config, rowGap: dojoBoardRowGap(textLineHeight(TEXT.SMALL)) });
    return;
  }
  // 台の絵は PNG の素材（部屋の台座）なので、ゲームと同じく読み込んでから描く
  renderer.setAtlas(await loadImageAtlas(TILE_SPRITES, SHEETS));
  const session = createDojo({ profile: createEmptyProfile(), skillProfile: createDefaultSkillProfile(), hitstopScale: 1, config, trialMoveset: null, trialKeystone: null });
  const frames = Number(q.get("frames") ?? DOJO_DEFAULT_FRAMES);
  for (let i = 0; i < frames; i++) stepDojo(session, dojoBotInput(session.state, i), FIXED_DT);
  // stand=<台の key> で、その台の前（東へ 1 マス）に立たせて近い台の案内を見る
  const stand = DOJO_SPOT_KEYS.find((k) => k === q.get("stand"));
  if (stand !== undefined) {
    const at = session.dojo.layout.spots[stand];
    session.state.player.body.pos = { x: at.x + TILE_SIZE, y: at.y };
    stepDojo(session, EMPTY_INPUT, FIXED_DT);
  }
  const d = session.dojo;
  renderer.settleMap(session.state);
  for (let i = 0; i < MANUAL_SETTLE_FRAMES; i++) {
    renderer.beginFrame();
    renderer.setWorldDecor((g, st) => drawDojoProps(g, st, d.layout, (key) => renderer.atlasSprite(key)));
    renderer.render(session.state, null, false);
    renderer.setWorldDecor(null);
    drawDojoOverlay(renderer.context, session.state, { meter: dojoMeterView(session), config: d.config, near: d.near, layout: d.layout });
    if (renderer.playerArtReady(session.state) && i > 30) break;
    await nextFrame();
  }
}

async function main(): Promise<void> {
  const q = new URLSearchParams(window.location.search);
  const scene = q.get("scene") ?? "attire";
  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas#game がない");
  const renderer = new Renderer(canvas);
  await document.fonts.load('16px "DotGothic16"');
  if (scene === "manual") {
    await shootManual(renderer, q);
    window.__menuShotReady = true;
    return;
  }
  if (scene === "dojo" || scene === "dojo-board") {
    await shootDojo(renderer, q, scene === "dojo-board");
    window.__menuShotReady = true;
    return;
  }
  const state = buildState();
  const slot = state.skills.slots[0];
  if (slot) slot.runModifiers = ["echo", "focus"];
  state.skills.hand = ["echo", "bloodPrice", "echo", "spillover", "streak", "echo", "focus"];
  const ui = createInventoryUi(createCraftSave());
  openMenu(state, ui, scene.startsWith("skills") || scene.startsWith("cand-stone") || scene === "cand-group" ? "skills" : "attire");
  if (scene === "attire-swap") ui.stack.push(candidatesFor(ui, "armor"));
  if (scene === "skills-lift") ui.stack.splice(0, ui.stack.length, ...ui.stack.filter((v) => v.kind === "attire" || v.kind === "skills"));
  if (scene === "cand-stone") ui.stack.push({ kind: "candidates", focus: null, target: { kind: "stone", index: 1 }, sort: "fit", offset: 0, order: null, pinnedId: null });
  const groupKey = SKILL_KEYS[1];
  if (scene === "cand-group" && groupKey !== undefined) {
    ui.stack.push({ kind: "candidates", focus: null, target: { kind: "stone", index: 1, group: groupKey }, sort: "fit", offset: 0, order: null, pinnedId: null });
  }
  if (scene === "cand-slot") ui.stack.push(candidatesFor(ui, "head"));
  const view = topView(ui);
  if (view !== null && scene === "skills") view.focus = fid.hand("bloodPrice");
  if (view?.kind === "skills" && scene === "skills-lift") {
    view.lift = { slot: HAND_SLOT, key: "echo" };
    view.focus = fid.col(1);
  }
  const focusAt = q.get("focus");
  if (view?.kind === "candidates" && focusAt !== null) {
    // first = 先頭の札、数字 = その番目（0 始まり）の札
    const at = focusAt === "first" ? 0 : Number(focusAt);
    const entry = Number.isInteger(at) ? candidateEntries(state, view)[at] : undefined;
    if (entry !== undefined) view.focus = entryFocusId(entry);
  }
  renderer.beginFrame();
  drawInventoryUi(renderer.context, state, ui);
  window.__menuShotReady = true;
}

main().catch((e: unknown) => {
  window.__menuShotError = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  window.__menuShotReady = true;
});
