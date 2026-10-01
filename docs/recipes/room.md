# レシピ: 部屋種類

- `core/state.ts` の `RoomKind` → `system/roomTypes.ts`（`assignRoomKinds` / 開始時処理）→ tuning の `ROOM_KIND` → 描画（`renderer.ts`、`minimap.ts`）→ `system/roomTypes.test.ts`
- フロア種別は `FloorKind` と `chooseFloorKind`、tuning の `FLOOR_KIND`
- **解放制（段取り 9）**: 追加の部屋の種類（`ROOM_KIND.extra` の key）を足したら `src/meta/unlocks.ts` の `ROOM_UNLOCKS`（`Record<ExtraRoomKind, UnlockCondition>`。`start` / `chapterBoss(n)` / `quest(key)`）に **必ず 1 行**足す（無いと tsc が落ちる）。最初から出すなら `START`、章の主を倒すと開くなら `chapterBoss(章)`。封じた種類は `assignExtraRoomKinds` の頭で候補から外れ、乱数も引かない（`state.runMeta.lockedRooms`）。ランイベントは専用のレシピが無いので同じ作法で `EVENT_UNLOCKS`（`Record<RunEventKey, UnlockCondition>`）に 1 行（封じたイベントは抽選にも占いの先読みにも出ない）。図鑑の「場所」の頁の未踏の部屋は開く条件が出る（`meta/screens.ts`）
- **封鎖するかどうか（`locks`）**: 洞窟基本の開放型フロアでは、部屋に入っても既定では封鎖しない。封鎖する種類だけ tuning の `ROOM_KIND.locks`（`Record<RoomKind, boolean>` なので追加漏れは型エラー）に `true` を足す。`system/roomTypes.ts` の `ROOM_LOCKS` がそれを re-export し、`floor.ts` が入室時に見る。封鎖しない種類は代わりに「交戦中」（`system/engagement.ts`）で判定し、部屋の敵が全滅すると制圧扱いになる（封鎖と同じ報酬・フックを通す）。通路の徘徊（`ROAMING_ROOM`）に気付かれて近く（`ROAM.engageLeash`）で戦っている間も交戦中

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
- 隠し部屋が開くと、ポケットに闇市が立つ（`system/merchants.ts` の `placeBlackMarket`。5 の倍数の階は隠し部屋が無いので闇市も無い）。章の境の休符の開始部屋には寄進の祠（`floor.ts` から `placeDonationShrine`。開始部屋は `setupSpecialRoom` を通らないための例外）
