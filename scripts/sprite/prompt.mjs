// Spriteloom に送る文の組み立て。CLI（spriteloom.mjs）とブラウザの作業台（src/tools/spriteGen.ts）の両方が読むので Node の API を使わない

/**
 * 見え方の型。Aseprite 拡張の GEN_TEMPLATES を下敷きに、横向きだけこのゲームの決まり（キャラは右向き）に合わせた。
 * %s に主題が入る。none は主題をそのまま送る
 */
export const VIEW_TEMPLATES = {
  side: "A %s, seen exactly from the side at eye level, in strict right-facing profile: its full side is shown in full color with clear detail and shading, not a black silhouette. A flat 2D game sprite. The camera does not look down at it.",
  "3/4": "A %s in classic three-quarter view game perspective, seen from slightly above, facing right.",
  front: "A %s, seen straight from the front at eye level, head-on, perfectly centered.",
  top: "A %s seen directly from above, flat top-down game view.",
  none: "%s",
};

export function assemblePrompt(view, subject, extra) {
  const tpl = VIEW_TEMPLATES[view];
  if (!tpl) throw new Error(`見え方は ${Object.keys(VIEW_TEMPLATES).join(" / ")}`);
  const text = tpl.replace("%s", subject);
  return extra ? `${text} ${extra}` : text;
}
