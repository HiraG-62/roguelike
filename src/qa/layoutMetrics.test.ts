import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ROAMING_ROOM } from "../core/state";
import { Tile } from "../map/grid";
import { withFixedLayout } from "../map/layout/select";
import { invalidatePathing } from "../map/pathing";
import { LAYOUT_KINDS } from "../map/layout/types";
import { countCombatants } from "./jinMetrics";
import { type LayoutFloorRecord, buildLayoutSection, createLayoutRecorder, stepsToStairs } from "./layoutMetrics";

const SEED = 4;
const STEP_MS = 0.5;
const GEN_MS = 30;
const SECONDS = 12;

function record(partial: Partial<LayoutFloorRecord>): LayoutFloorRecord {
  return {
    layout: "cavern",
    depth: 2,
    stairsSteps: 100,
    enemies: 100,
    roomJins: 7,
    seconds: 60,
    steps: 10,
    stepMsTotal: 5,
    genMs: GEN_MS,
    outcome: "descended",
    deathCause: null,
    ...partial,
  };
}

describe("階の型ごとの計測", () => {
  it("着いた階の型・階段までの歩数・生成直後の敵と陣・step の重さ・離れた理由を 1 件にまとめる", () => {
    const state = withFixedLayout("river", () => createGame(SEED));
    const recorder = createLayoutRecorder();
    recorder.beginFloor(state, GEN_MS);
    recorder.noteStep(STEP_MS);
    recorder.noteStep(STEP_MS);
    state.time += SECONDS;
    recorder.endFloor(state, "died", "slime");
    const [r] = recorder.records;
    expect(recorder.records, "1 階で 1 件").toHaveLength(1);
    expect(r?.layout, "実際に使った型").toBe(state.floorLayout);
    expect(r?.stairsSteps, "階段まで歩いて届く").toBeGreaterThan(0);
    expect(r?.enemies, "商人・壺を除いた数").toBe(countCombatants(state.enemies));
    expect(r?.roomJins, "部屋の陣だけ").toBe(state.jins.filter((j) => j.roomIndex !== ROAMING_ROOM).length);
    expect(r?.steps).toBe(2);
    expect(r?.stepMsTotal).toBeCloseTo(STEP_MS * 2);
    expect(r?.seconds).toBeCloseTo(SECONDS);
    expect(r?.outcome).toBe("died");
    expect(r?.deathCause).toBe("slime");
  });

  it("数えない階（skipFloor の後）の step と離脱は記録しない", () => {
    const state = withFixedLayout("court", () => createGame(SEED));
    const recorder = createLayoutRecorder();
    recorder.skipFloor();
    recorder.noteStep(STEP_MS);
    recorder.endFloor(state, "descended");
    expect(recorder.records, "記録なし").toHaveLength(0);
  });

  it("階段がまだ無い階は最後の部屋の中心までの歩数を数える", () => {
    const state = withFixedLayout("cavern", () => createGame(SEED));
    const withStairs = stepsToStairs(state);
    expect(withStairs, "前提: 階段まで届く").not.toBeNull();
    state.map.tiles = state.map.tiles.map((t) => (t === Tile.StairsDown ? Tile.Floor : t));
    invalidatePathing(state.map);
    expect(stepsToStairs(state), "最後の部屋の中心まで").not.toBeNull();
  });

  it("表は 8 型とボス階の行を出し、旧生成は出たときだけ行を足す。観測が無くても NaN を出さない", () => {
    const md = buildLayoutSection([
      record({ layout: "river", outcome: "died", deathCause: "slime" }),
      record({ layout: "river", outcome: "died", deathCause: "slime" }),
      record({ layout: "river", outcome: "died", deathCause: "bat" }),
      record({ layout: "river", outcome: "descended", genMs: null }),
    ]).join("\n");
    for (const kind of LAYOUT_KINDS) expect(md, `${kind} の行`).toContain(`| ${kind} |`);
    expect(md, "ボス階の行").toContain("| lordHall |");
    expect(md, "旧生成は出なければ省く").not.toContain("| legacy |");
    expect(md, "死因は多い順").toContain("3（slime 2 / bat 1）");
    expect(md, "最初の階（生成 ms なし）は生成の平均から除く").toContain(`| ${GEN_MS.toFixed(1)} / ${GEN_MS.toFixed(1)} |`);
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(buildLayoutSection([record({ layout: "legacy" })]).join("\n"), "旧生成へ落ちた階があれば行を出す").toContain("| legacy |");
  });
});
