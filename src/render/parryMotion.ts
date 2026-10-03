/**
 * 受け流しの動きの時間割（docs/ideas/parry-motion.md）。state の受け流しの窓・硬直と、決まった印（parry の mark）の
 * 経過から、受けの構えへ寄せる割合・受け止めた衝撃・外した崩れを決める純関数。描くのは renderer.ts（drawRiggedPlayer）。
 * 見た目だけで、state は読むだけ
 */
import { PARRY_POSE } from "../data/tuning";
import type { GuardMotion } from "./playerRig";
import { clamp01, easeOutCubic } from "./renderMath";

const DEG = Math.PI / 180;

export interface ParryMotionInput {
  /** 受けの構えを取ってからの秒（共通の受け流しの窓・剣の構えの受け流しを押している間）。構えていなければ null */
  readonly raised: number | null;
  /** 受け流しが決まってからの秒（いちばん新しい parry の印）。無ければ null */
  readonly impactAge: number | null;
  /** 外した硬直の進み（0 → 1）。硬直でなければ null */
  readonly slack: number | null;
}

export interface ParryMotion extends GuardMotion {
  /** 体のコマ（受けの構え / 受け止めた衝撃）。null なら今までの体のコマ */
  readonly body: { readonly impact: boolean } | null;
}

function smooth(t: number): number {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}

/** 受け止めた衝撃の残り（1 → 0。頭で速く戻る 2 乗の減衰） */
export function parryJar(age: number): number {
  const u = 1 - clamp01(age / PARRY_POSE.jarSec);
  return u * u;
}

/** 受けの構えの動き。構え・決まった直後・外した硬直のどれでもなければ undefined（今までの構え） */
export function parryMotion(i: ParryMotionInput): ParryMotion | undefined {
  if (i.raised !== null) return held(easeOutCubic(clamp01(i.raised / PARRY_POSE.raiseSec)), 0, 0);
  if (i.impactAge !== null && i.impactAge < PARRY_POSE.impactSec) return impact(i.impactAge);
  if (i.slack !== null) return slack(clamp01(i.slack));
  return undefined;
}

function held(blend: number, jar: number, sag: number): ParryMotion {
  const body = blend >= PARRY_POSE.bodyMin ? { impact: jar >= PARRY_POSE.impactFrameMin } : null;
  return { blend, push: PARRY_POSE.pushDots * jar, tilt: PARRY_POSE.tiltDeg * DEG * jar, sag, body };
}

/** 決まった直後: 受け止めた形のまま押され（jar）、settleFrom を過ぎたら待機の構えへ戻す */
function impact(age: number): ParryMotion {
  const u = age / PARRY_POSE.impactSec;
  const release = smooth((u - PARRY_POSE.settleFrom) / (1 - PARRY_POSE.settleFrom));
  return held(1 - release, parryJar(age), 0);
}

/** 外した硬直: 構えが崩れて手が下がり、slackHold を過ぎたら待機の構えへ戻す */
function slack(u: number): ParryMotion {
  const sag = PARRY_POSE.sagDots * easeOutCubic(clamp01(u / PARRY_POSE.slackHold));
  const release = smooth((u - PARRY_POSE.slackHold) / (1 - PARRY_POSE.slackHold));
  return held(1 - release, 0, sag);
}
