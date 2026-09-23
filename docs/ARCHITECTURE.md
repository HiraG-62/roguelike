# アーキテクチャ

入口は `src/main.ts`。ゲームの中身は「決定的シミュレーション（core + system）」と「それを読むだけの描画（render）」に分かれる。

## データフロー

```
[DOM イベント] ──┐
[Gamepad API] ───┼─> core/input.ts PlayerInput.snapshot() ──> FrameInput（1 フレームの入力）
                 │        （replay 再生時は core/replay.ts の stepReplay が FrameInput を供給）
                 │
main.ts ── core/loop.ts startLoop（固定 60Hz, FIXED_DT）
   │
   ├─ update(dt): core/game.ts step(state, input, dt)
   │     ├─ 一時停止 / 死亡 / 祝福 3 択中 / ヒットストップ中は早期 return
   │     └─ player → boons → statusEffects → enemies → projectiles → hazards
   │        → floor.updateRooms → reaper → combo → effects → camera
   │            │  書く: GameState（全部ここ）
   │            │  積む: state.sfx（効果音名）、state.log、state.texts / particles / shapes
   │            └─ 拾ったアイテムは即 state.profile へ → main.ts が saveProfile
   │
   ├─ main.ts: state.sfx を drain → audio/sfx.ts SfxPlayer.play(name)
   ├─ main.ts: ReplayRecorder に FrameInput を記録（ui/replayStore に保存）
   │
   └─ render(): render/renderer.ts Renderer.render(state, aimScreen)
         └─ inventoryUi / skillHud / boonUi / titleUi / minimap / darkness
            （state を読むだけ。state.rng を使わない）
```

画面遷移（タイトル・ポーズ・設定・履歴・死亡サマリー）のロジックは `src/ui/title.ts`、装備 / スキル / クラフト画面は `src/ui/inventory.ts`。どちらも DOM 非依存でテストされる。

戦闘再設計（`docs/COMBAT_DESIGN.md`）で入った主要システム: `system/attributes.ts`（ステータスの実効値・威力計算 `scaled`。`applyStats` から `deriveAttributes` として呼ぶ）、`system/mana.ts`（マナの増減。`core/game.ts` の `step` から `refillMana` / `tickMana` を直接呼ぶ）、`system/poise.ts`（怯みの蓄積・減衰・堅守。`combat.ts` / `enemies.ts` / `elites.ts` / `statusEffects.ts` から呼ばれ、独立した `step` ステップは持たない）、`system/statusEffects.ts`（13 種の状態異常。`step` のパイプラインに `updateStatusEffects` として入っている）。

## ディレクトリの責務

| ディレクトリ | 責務 | 依存してよい先 |
| --- | --- | --- |
| `core/` | state 型、`createGame` / `step`、入力、ループ、rng、vec、リプレイ | system / loot / skills / map / data |
| `system/` | ゲームロジック。state を読み書きする | core / loot / skills / map / data / audio の名前（`sfxNames`） |
| `loot/` | 装備の型・生成・集計・クラフト・永続化。ほぼ純関数 | core（rng / vec）、data/tuning |
| `skills/` | スキル石・刻印符のデータ・型・生成・永続化・設置物 | core、loot、data。`hit.ts` / `placed.ts` は system（combat / effects / physics …）も使う |
| `map/` | グリッドと生成器（純関数） | core/rng |
| `render/` | Canvas 描画。state を読むだけ | すべて（読み取りのみ） |
| `ui/` | 画面ロジック・設定・リプレイ保存 | core / loot / skills、system/player（applyStats） |
| `audio/` | Web Audio 合成。ロジックからは名前だけ参照される | なし |
| `data/` | tuning（手触り定数）、敵定義、スプライトのピクセルマップ | なし |
| `qa/` | ヘッドレス bot・シミュレーション・report.md | すべて |

## 主要な型の関係

```
Profile（永続: roguelike.profile.v1）
  ├─ equipment: Record<Slot, Item | null>     Slot = weapon / gun / armor / boots / ring / amulet
  ├─ stash: Item[]                            上限 STASH_CAPACITY
  └─ meta（runs・bestDepth・totalKills・bestScore・history?: RunHistoryEntry[]）

Item ─ base / rarity / implicit / affixes: AffixRoll[]（key + value、トリガーやキーストーンも AffixRoll で表す）
  └─ computeStats(equipment) ──> PlayerStats（倍率・flat・attributes・keystones・triggers・statusProcs …）
                                     └─ addRunAttributes（ラン内振り分け）── deriveAttributes（実効値・派生を畳み込む）
                                          └─ foldBoonStats（祝福の数値ぶん）── applyStats(state) ──> Player

SkillProfile（永続: roguelike.skills.v1）─ stones: SkillStone[]、loadout（4 スロットごとの石 id）
  └─ createSkillRunState ──> SkillRunState（ラン内: マナ型のコスト / CD 型の CD、GCD、刻印符、設置物、発動中）

GameState
  ├─ player: Player（body、hp、mana、status: StatusBag、攻撃 / ダッシュ / JUST / リゲインのタイマー、buffs）
  ├─ stats: PlayerStats（attributes / attributesEff を含む。ロジックは必ずこれを通す）
  ├─ runAttributes: { alloc: Attributes; unspent: number }（ラン内のステータス振り分け）
  ├─ enemies: Enemy[]（defKey → data/enemies.ts の EnemyDef、phase、status: StatusBag、poise: PoiseState、elite、ai）
  ├─ rooms: RoomState[]（kind、locked、cleared、wave …）、floorKind、map、lockedTiles
  ├─ projectiles / hazards / pickups / floorItems
  ├─ skills: SkillRunState
  ├─ boons: BoonKey[]、boonChoice、boonRun
  ├─ boss、reaper
  └─ rng、tick、time、sfx、log、texts、particles、shapes、camera（演出系）
```

型の定義元: `core/state.ts`（GameState / Player / Enemy / RoomState / PoiseState）、`loot/types.ts`（Item / PlayerStats / Attributes / AttrKey / Profile / TriggeredEffect）、`core/status.ts`（StatusEffect / StatusBag / StatusApply / StatusProc / StatusKind）、`skills/types.ts`（SkillStone / SkillRunState）、`system/boons.ts`（BoonKey / BoonDef）、`data/enemies.ts`（EnemyDef）、`data/enemyCombat.ts`（EnemyCombatDef）。

## 決定性とリプレイ

- `step` は固定 dt（1/60 秒）で呼ばれ、ロジックが見る外部入力は `FrameInput` だけ
- 乱数は `state.rng`（mulberry32）のみ。生成系（loot / skills / map）は rng を引数に取る純関数
- `Date.now()` は生成物の `id` / `foundAt` に使うだけで、挙動には影響しない
- 描画は `state.rng` を消費しない（見た目のばらつきは `render/renderMath.ts` の座標ハッシュ）
- スローモーションは `gdt = dt * slowmoScale` で内部時間だけ縮め、ステップ数は変えない
- リプレイ（`core/replay.ts`）: seed + 開始時の装備 / スキルのスナップショット（`captureLoadout`）+ FrameInput 列（ランレングス圧縮、照準は差分）+ ラン中の装備変更イベント（何フレーム目の前か）
- 再生中は `guardStorageWrites` で永続キーへの書き込みを止め、再生がプロフィールを汚さない
- デイリーシード: `dailySeedText(new Date())` の文字列を `hashSeed` で seed にする
- 決定性は `core/game.test.ts` と `core/replay.test.ts` がテストで固定している

## 永続化キー（localStorage）

| キー | 中身 | 読み書き |
| --- | --- | --- |
| `roguelike.profile.v1` | 装備・stash・メタ（ラン数・履歴 20 件） | `loot/profile.ts` |
| `roguelike.skills.v1` | スキル石とスロット | `skills/persistence.ts` |
| `roguelike.craft.v1` | クラフト通貨とクラフト回数 | `loot/craftingStore.ts` |
| `roguelike.settings.v1` | ミュート・音量・画面揺れ・キー設定（`keybinds`。アクション → KeyboardEvent.code / "MouseN" の配列。読込は `core/input.ts` の `sanitizeKeybinds` を通し、欠けたら既定。追加フィールドなので v1 のまま） | `ui/settings.ts` |
| `roguelike.replays.v1` | リプレイ最新 10 件 | `ui/replayStore.ts` |

共通ルール: 例外（容量超過・プライベートモード）を握りつぶし、壊れたデータはデフォルトへ落とす。形式を非互換に変えるときはキーの版を上げる。

## テストの配置

- 各モジュールの隣に `*.test.ts`（Vitest、名前は日本語）
- `system/testHelpers.ts` はテスト専用
- `qa/simulation.test.ts`: 既定は縮小版（5 seed × 20,000 step）で例外・NaN・壁めり込み・id 重複を検査。`npm run qa:full` でフル版を回し `qa/report.md` を更新
