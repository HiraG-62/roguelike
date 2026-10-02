import type { Enemy, GameState } from "../core/state";
import { VIEW_W } from "../core/view";
import { enemyDef } from "../data/enemies";
import { NARIMONO } from "../data/tuning";
import { isBossDriven } from "../system/boss";
import { NEVER_TIME } from "../system/readTiming";
import { threatensPlayer } from "../system/threat";
import type { SfxName } from "./sfxNames";

/**
 * 鳴物帳（docs/ideas/ink-telegraph-impl.md 段 3）。予告まわりの音を「家（音色の系統）1 つに意味 1 つ」で持つ表と、
 * main.ts が state を読んで鳴らす・替える規則。ロジック（system/）は音を知らないので、sim は触らず、drain のときにここを通す。
 * 画面と音が同じ言葉で言う（黄 = 下絵は無音、赤に入る = 柝頭、読みが当たる = 附打）ための表で、新しい音を足すときは先にこの表を読む
 */

export interface NarimonoEntry {
  name: SfxName;
  /** 音色の系統。同じ家に別の意味を載せない */
  house: string;
  /** その音が言う 1 つの意味 */
  meaning: string;
}

export const NARIMONO_TABLE: readonly NarimonoEntry[] = [
  { name: "commitClack", house: "拍子木（高く乾いた木）", meaning: "自分に掛かる攻撃が赤に入った" },
  { name: "tsukeHeavy", house: "板を打つ（低く強い）", meaning: "受け流しが当たった（読みの成功）" },
  { name: "sketchErase", house: "紙を擦る", meaning: "下絵を崩した" },
  { name: "enemyWindup", house: "上り調子の唸り", meaning: "精鋭とボスの予備動作の始まり" },
];

/** 立ち上がりを「新しい」とみなす秒数（drain が数フレーム遅れても拾う） */
const FRESH_SEC = 0.1;

/** 受け流しの成功の目印（演出の「parry」の印）が新しいとみなす秒数 */
const PARRY_MARK_FRESH_SEC = 0.1;

export interface Clack {
  pan: number;
  volume: number;
}

function isElite(e: Enemy): boolean {
  return e.elite !== undefined;
}

function isBossFoe(state: GameState, e: Enemy): boolean {
  return state.boss?.enemyId === e.id || isBossDriven(enemyDef(e.defKey));
}

export class Narimono {
  private owner: GameState | null = null;
  /** 敵 id → 前に見た committedAt（赤への立ち上がりの検出） */
  private committed = new Map<number, number>();
  /** 敵 id → 数え済みの windupAt（予備動作の始まりを 1 回だけ数える） */
  private windups = new Map<number, number>();
  private parriesSeen = new WeakSet<object>();
  private lastClack = Number.NEGATIVE_INFINITY;
  private lastTsuke = Number.NEGATIVE_INFINITY;

  private reset(state: GameState): void {
    this.owner = state;
    this.committed = new Map();
    this.windups = new Map();
    this.parriesSeen = new WeakSet();
    this.lastClack = Number.NEGATIVE_INFINITY;
    this.lastTsuke = Number.NEGATIVE_INFINITY;
  }

  private own(state: GameState): void {
    if (this.owner !== state) this.reset(state);
  }

  /**
   * drain で積まれた名前を鳴物帳に合わせて替える。
   * - 受け流しの成功の `counter` は、出端の `counter` と別の音（附打 `tsukeHeavy`）にする。同じ附打は tsukeGapSec 以内に重ねない
   * - 並の敵の予備動作の唸り `enemyWindup` は止める（始まりは目が持つ）。精鋭とボスの予備動作の始まりは残す。
   *   他の積み元（ボスの技・鐘・死神など）は、同じ drain に並の敵の新しい予備動作が無ければそのまま
   */
  arrange(state: GameState, names: readonly SfxName[]): SfxName[] {
    this.own(state);
    const parried = this.takeFreshParry(state);
    const quietWindup = this.onlyPlainWindups(state);
    const out: SfxName[] = [];
    let converted = false;
    for (const name of names) {
      if (name === "counter" && parried && !converted) {
        converted = true;
        if (state.time - this.lastTsuke >= NARIMONO.tsukeGapSec) {
          this.lastTsuke = state.time;
          out.push("tsukeHeavy");
        }
        continue;
      }
      if (name === "enemyWindup" && quietWindup) continue;
      out.push(name);
    }
    return out;
  }

  /** 新しい受け流しの印があれば消費して true */
  private takeFreshParry(state: GameState): boolean {
    const marks = state.effects?.marks ?? [];
    let found = false;
    for (const m of marks) {
      if (m.kind !== "parry" || m.age > PARRY_MARK_FRESH_SEC || this.parriesSeen.has(m)) continue;
      this.parriesSeen.add(m);
      found = true;
    }
    return found;
  }

  /** このフレームに新しく始まった予備動作が、並の敵のものだけか（1 体でも精鋭かボスなら false） */
  private onlyPlainWindups(state: GameState): boolean {
    const next = new Map<number, number>();
    let fresh = 0;
    let special = false;
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.phase !== "windup") continue;
      const at = e.windupAt ?? NEVER_TIME;
      next.set(e.id, at);
      if (this.windups.get(e.id) === at || state.time - at > FRESH_SEC) continue;
      fresh += 1;
      if (isElite(e) || isBossFoe(state, e)) special = true;
    }
    this.windups = next;
    return fresh > 0 && !special;
  }

  /**
   * 柝頭: 敵の攻撃が赤（墨入れ）に入った瞬間、自分に掛かる物のうち一番早く当たる 1 体だけ、前の柝頭から clackGapSec 以上空けて、
   * 敵の画面上の横位置で左右に振って鳴らす。掛からない赤・遠すぎる敵の赤は鳴らさない（鳴り続ける合図は合図にならない）
   */
  clack(state: GameState): Clack | null {
    this.own(state);
    const next = new Map<number, number>();
    const risen: Enemy[] = [];
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      const c = e.committedAt ?? NEVER_TIME;
      next.set(e.id, c);
      const red = c > NEVER_TIME && c >= (e.windupAt ?? NEVER_TIME);
      if (!red || this.committed.get(e.id) === c) continue;
      // 初めて見る敵は、赤になって間もないときだけ立ち上がりに数える（途中から見えた敵を鳴らさない）
      if (!this.committed.has(e.id) && state.time - c > FRESH_SEC) continue;
      risen.push(e);
    }
    this.committed = next;
    if (state.time - this.lastClack < NARIMONO.clackGapSec) return null;
    const p = state.player.body.pos;
    let best: Enemy | null = null;
    for (const e of risen) {
      if (Math.hypot(e.body.pos.x - p.x, e.body.pos.y - p.y) > NARIMONO.clackMaxDist) continue;
      if (!threatensPlayer(state, e)) continue;
      if (!best || e.phaseTimer < best.phaseTimer) best = e;
    }
    if (!best) return null;
    this.lastClack = state.time;
    const side = (best.body.pos.x - state.camera.pos.x) / (VIEW_W / 2);
    return { pan: Math.max(-1, Math.min(1, side)) * NARIMONO.clackPanMax, volume: NARIMONO.clackVolume };
  }
}
