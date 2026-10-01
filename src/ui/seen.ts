import type { Item, Profile, ProfileMeta, Slot } from "../loot/types";

/**
 * 新着（docs/ideas/inventory-v2/E-impl.md 5 章）。部位ごとに「最後に候補を見たときの拾った時刻」を
 * profile.meta.seenAt に持ち、それより後に拾った倉庫の遺物を新着とみなす。
 * Item に印を足さないのは、拾う処理が step の中にあり、旧セーブと記録のスナップショットにも混ざるため。
 * 欠けていれば 0 なので、初回は全部が新着になる
 */

export function isUnseen(item: Readonly<Item>, meta: Readonly<ProfileMeta>): boolean {
  return item.foundAt > (meta.seenAt?.[item.slot] ?? 0);
}

/** その部位の倉庫に新着があるか（装束の部位の角の白い点） */
export function slotHasUnseen(profile: Readonly<Profile>, slot: Slot): boolean {
  return profile.stash.some((it) => it.slot === slot && isUnseen(it, profile.meta));
}

/**
 * その部位の倉庫を見たことにする（候補の頁を離れるとき）。変わったら true（保存は呼び出し側）。
 * 時刻は実時間ではなく倉庫の遺物の foundAt の最大を使う（UI から Date.now を読まない）
 */
export function markSlotSeen(profile: Profile, slot: Slot): boolean {
  const before = profile.meta.seenAt?.[slot] ?? 0;
  let latest = before;
  for (const it of profile.stash) if (it.slot === slot && it.foundAt > latest) latest = it.foundAt;
  if (latest === before) return false;
  profile.meta.seenAt = { ...profile.meta.seenAt, [slot]: latest };
  return true;
}
