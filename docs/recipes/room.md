# レシピ: 部屋種類

- `core/state.ts` の `RoomKind` → `system/roomTypes.ts`（`assignRoomKinds` / 開始時処理）→ tuning の `ROOM_KIND` → 描画（`renderer.ts`、`minimap.ts`）→ `system/roomTypes.test.ts`
- フロア種別は `FloorKind` と `chooseFloorKind`、tuning の `FLOOR_KIND`
- **封鎖するかどうか（`locks`）**: 洞窟基本の開放型フロアでは、部屋に入っても既定では封鎖しない。封鎖する種類だけ tuning の `ROOM_KIND.locks`（`Record<RoomKind, boolean>` なので追加漏れは型エラー）に `true` を足す。`system/roomTypes.ts` の `ROOM_LOCKS` がそれを re-export し、`floor.ts` が入室時に見る。封鎖しない種類は代わりに「交戦中」（`system/engagement.ts`）で判定し、部屋の敵が全滅すると制圧扱いになる（封鎖と同じ報酬・フックを通す）

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
