// 装備画面（装束と紋）の確認用の撮影。ゲーム本体からは import しない。
// クエリ: ?scene=attire|attire-swap|skills|skills-lift|cand-stone|cand-group|cand-slot で場面を作って 1 回描き、window.__menuShotReady = true。
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

async function main(): Promise<void> {
  const q = new URLSearchParams(window.location.search);
  const scene = q.get("scene") ?? "attire";
  const canvas = document.getElementById("game");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas#game がない");
  const renderer = new Renderer(canvas);
  await document.fonts.load('16px "DotGothic16"');
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
