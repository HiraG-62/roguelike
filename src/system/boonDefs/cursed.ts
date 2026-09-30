/**
 * 呪い付きと芯の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key を使うと、こちらの定義が旧定義を上書きする（旧定義は 7b のレーン E が消す）。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）
 */

import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_CURSED = [] as const;

export const BOONS_CURSED: Readonly<Record<(typeof BOON_KEYS_CURSED)[number], BoonDef>> = {};
