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
   │     └─ player → boons → statusEffects → terrain → enemies → projectiles → hazards
   │        → floor.updateRooms → reaper → combo → rules.resolveRules → effects → camera
   │            │  書く: GameState（全部ここ）
   │            │  積む: state.sfx（効果音名）、state.events（ゲームイベント、pushEvent）、state.log、state.texts / particles / shapes
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

戦闘再設計（`docs/COMBAT_DESIGN.md`）で入った主要システム: `system/attributes.ts`（ステータスの実効値・威力計算 `scaled`。`applyStats` から `deriveAttributes` として呼ぶ）、`system/mana.ts`（マナの増減。`core/game.ts` の `step` から `refillMana` / `tickMana` を直接呼ぶ）、`system/poise.ts`（怯みの蓄積・減衰・堅守・処刑・背面の一撃。`combat.ts` / `enemies.ts` / `elites.ts` / `statusEffects.ts` から呼ばれ、独立した `step` ステップは持たない）、`system/statusEffects.ts`（34 種の状態異常。`step` のパイプラインに `updateStatusEffects` として入っている）。

Wave 2（`docs/ideas/*-expansion.md`）で入ったシステム: `system/enemyTraits.ts`（死骸・取り巻き・マナ奪取・双子復活・臆病など敵に横断する仕組み）、`system/enemyBehaviors.ts`（新 behavior 1 つにつき関数 1 つの実装）、`system/bossTwins.ts` / `system/bossFrostGiant.ts`（ボス 2 体の専用ロジック。共通処理は `system/boss.ts`）、`system/boonDefs.ts`（祝福のデータ定義。系譜 `lineage`/`after`、結び `duo` を含む）、`system/boonRules.ts`（拡張分の祝福ルール `onBoonXxxRules`。`system/boons.ts` の既存フックから呼ぶ）、`system/statusReactions.ts`（状態異常や地形の層が出会ったときの反応 `ReactionKey`）、`core/terrain.ts` + `system/terrain.ts`（床の地形の層の型・一覧と効果。配置は `map/generator.ts` の `planTerrain`）、`system/traitHooks.ts`（装備の性質・トリガー文法拡張が読む倍率・フック）、`loot/traitContext.ts`（性質が装備全体や来歴など「自分の外」を読むための文脈）、`skills/{tuning,defs,modifiers,combos,actions,shots,summons,geom}.ts`（大拡張のスキル・刻印符・連携のデータと発動処理。`skills/data.ts` の `SKILL_DEFS`/`MODIFIERS` に混ぜ込む形）、`render/terrainUi.ts`（地形の層の描画）。

統一ルール文法（`docs/ideas/synergy-web.md` 3 章）: 各 system は起きたこと（近接命中・撃破・ダッシュ開始 / 終了・被弾・JUST・部屋のロック / 制圧・怯み・カウンター・反応・状態異常の付与・スキルの発動 / 命中・敵の予備動作・地形への進入…）を `core/events.ts` の `pushEvent` で `state.events` に積むだけ（`pushSfx` と同じ作法。既存のフック `onBoonKill` / `fireTrigger` などは残したまま隣で積む段階的移行）。`core/rules.ts` が `Rule`（when × if × then、chance、icd、scope、owner）の型、`system/rules.ts` の `resolveRules` が combo の後に 1 回だけ照合する。

- 照合順: イベントは積んだ順（前ステップからの持ち越しが先）。Rule は祝福の取得順（`BoonDef.rules`）→ スキルスロット順（`SkillDef.rules` / `ModifierDef.rules`、scope は自分のスロットに縛る）→ 対象の敵（`EnemyCombatDef.rules`、効果は予告付きハザードのみ）。装備の `tr:` は `fireTrigger` がその場で `ruleFromTrigger`（`loot/triggers.ts`）に読み替えて照合する（手触りと乱数の消費順を変えないため、resolveRules では集めない）
- 連鎖: 効果が起こしたイベントは深さ +1 で `state.pendingEvents` へ入り、次ステップで照合する（同ステップで再帰しない）。深さ `SYNERGY.maxDepth` 以上は照合せず、効果量は深さごとに × `SYNERGY.chainDecay`
- ICD の 3 層: Rule ごと（`state.ruleIcd`、id の昇順で進める）・語ごとの 1 秒あたり回数（`SYNERGY.keywordBudget`、`state.ruleRun.keywordUse`）・敵ごと（状態異常を入れる効果は `StatusBag.procIcd`）
- 乱数は Rule の照合順に `state.rng` から引く。確率 1 以上の Rule は引かない

## フロアと部屋（開放型。2026-09-24）

- 形: `system/biomes.ts` の `MAP_SHAPE` がフロア種別ごとに `cave`（`map/cave.ts` のセルオートマトン。既定）か `rooms`（`map/generator.ts` の部屋 + 通路。回廊・骨の墓所・油の坑道とボス階）を決める。洞窟の数値は tuning の `CAVE`（`base` + バイオームごとの上書き `biome`。`floor.ts` の `generatorOptions` が `GeneratorOptions.cave` に渡す）。洞窟では「開けた領域の塊」が 1 部屋（`RoomState.tiles`）で、`rect` は塊に内接する正方形（中心・台座の置き場の目安）
- 封鎖: 入ると封鎖するのは `ROOM_KIND.locks` が true の種類（試練・闘技場・巣・巣窟・伏兵・護衛・鏡）とボス部屋だけ（`roomTypes.ts` の `roomLocks`）。それ以外は入っても扉を閉じない
- 交戦と制圧: 封鎖しない部屋は、入る・部屋の敵が気付く（idle から抜ける）のどちらかで `RoomState.engaged` になり、部屋の敵をまとめて起こし、封鎖と同じフック（`onBoonRoomLock` / イベント `onRoomLock` / `runEvents.onRoomLocked` / 呪い）を通す。部屋の敵（`roomIndex` がその部屋）が全滅したら 1 回だけ制圧（`clearRoom`: 報酬・`onRoomClear` トリガー・祝福の `onBoonRoomClear`・来歴）。報酬はプレイヤーが部屋の外なら足元に置く
- 徘徊と増援（`system/spawner.ts`、tuning の `ROAM`）: 生成時に置いた敵の一部を徘徊（`roomIndex = ROAMING_ROOM`（-1）、`EnemyAi.roam` が目的地）にする。idle の間だけ `updateRoamers` が塊の中心への距離場（マップから作る派生データ。WeakMap に覚える）を下って歩かせ、気付いたら `enemies.ts` の chase に任せる。`floorTime` が `reinforceDelay` を過ぎると `reinforceInterval` ごとに画面外へ徘徊を 1 抽選ぶん湧かせる（上限 `roamCap`、ボス階は無し）。徘徊はどの部屋にも属さないので制圧を妨げない
- 視線と回り込み（`map/pathing.ts`、純関数 + マップごとの距離場キャッシュ）: 敵は壁越しには気付かない（`enemies.ts` の idle で `lineOfSight`）。追跡中に壁で遮られたら距離場の次の点へ向かう（`chaseHeading`）。徘徊の歩行（`nextWaypoint`）と QA bot の交戦相手の選択も同じ視線判定を使う
- 呼び出し順: すべて `floor.ts` の `updateRooms` の中（部屋ごとの封鎖 / 交戦 / 制圧 → `updateRoamers` → 増援 → 泉 → 特別な部屋 → …）。乱数は `state.rng` だけで、この順に引く
- マナの自然回復（`mana.ts` の `tickMana`）は「封鎖中」ではなく「封鎖中か、`MANA.combatRadius` 内に生きた敵がいる」間を戦闘中とみなして遅くする

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
  └─ createSkillRunState ──> SkillRunState（ラン内: マナ型のコスト / CD 型の CD、スロットごとの最低間隔、ラン内の刻印符、設置物、発動中）

GameState
  ├─ player: Player（body、hp、mana、status: StatusBag、攻撃 / ダッシュ / JUST / リゲインのタイマー、buffs、loot: LootRuntime〔性質の作業領域〕）
  ├─ stats: PlayerStats（attributes / attributesEff を含む。ロジックは必ずこれを通す）
  ├─ runAttributes: { alloc: Attributes; unspent: number }（ラン内のステータス振り分け）
  ├─ enemies: Enemy[]（defKey → data/enemies.ts の EnemyDef、phase、status: StatusBag、poise: PoiseState、elite、ai、leaderId?〔群れの長・双子の相方〕、stolenMana?、eliteWork?〔新エリート修飾子の作業領域〕）
  ├─ rooms: RoomState[]（kind、locked、cleared、wave …）、floorKind、map、lockedTiles
  ├─ terrain: TerrainLayer（床の地形の層。フロアが変わると作り直す）
  ├─ corpses: Corpse[]（敵の死骸。骨拾い・墓守の鐘・貪食のが使う）
  ├─ projectiles / hazards / pickups / floorItems
  ├─ skills: SkillRunState（lastCast: LastCast | null〔連携の受付〕を含む）
  ├─ boons: BoonKey[]、boonChoice、boonRun
  ├─ events / pendingEvents: GameEvent[]（今ステップのイベント / 効果が起こした次ステップ持ち越し）、recent（種類ごとの直近の発生時刻と回数）、ruleIcd: Map<ruleId, 残り秒>、chains（直近に成立した連鎖 8 件。連携表示の材料）、ruleRun（照合中の深さ・持ち主、語の窓、プレイヤーの足元の地形）
  ├─ boss、reaper
  └─ rng、tick、time、sfx、log、texts、particles、shapes、camera（演出系）
```

型の定義元: `core/state.ts`（GameState / Player / Enemy / RoomState / PoiseState / Corpse）、`loot/types.ts`（Item / PlayerStats / Attributes / AttrKey / Profile / TriggeredEffect）、`core/events.ts`（GameEvent / EventKind / EventSource / pushEvent）、`core/rules.ts`（Rule / RuleCondition / RuleEffect / EnemyRule）、`core/status.ts`（StatusEffect / StatusBag / StatusApply / StatusProc / StatusKind / ReactionKey）、`core/terrain.ts`（TerrainKind / TerrainLayer）、`skills/types.ts`（SkillStone / SkillRunState / LastCast / ComboKey）、`system/boonDefs.ts`（BoonKey / BoonDef）、`data/enemies.ts`（EnemyDef）、`data/enemyCombat.ts`（EnemyCombatDef）。

## 決定性とリプレイ

- `step` は固定 dt（1/60 秒）で呼ばれ、ロジックが見る外部入力は `FrameInput` だけ
- 床の遺物・スキル石の拾得は `FrameInput.interactPressed` + `aimScreen`。注目（`system/loot.ts` の `focusedDrop`）は state に持たず、step（拾得）と render（環・ポップアップ）が同じ純関数で求める。`interactPressed` は `BUTTON_BITS` の末尾
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
| `roguelike.codex.v1` | 図鑑（見た・倒した敵、名のある遺物、祝福、反応の回数、連鎖の並びの回数、階の種類・部屋の種類）。ラン終了時に `main.ts` の `endRun` が `recordCodex` で畳んで保存 | `meta/codexStore.ts` |
| `roguelike.quests.v1` | 依頼（達成した依頼と時刻、受けたまま未達成の依頼 `active`）。起点の解放・図鑑の頁・名のある遺物の抽選・称号はここから読む | `meta/questStore.ts` |
| `roguelike.achievements.v1` | 実績（解除した実績と時刻）と名乗っている称号 | `meta/achievements.ts` |

共通ルール: 例外（容量超過・プライベートモード）を握りつぶし、壊れたデータはデフォルトへ落とす。形式を非互換に変えるときはキーの版を上げる。

## テストの配置

- 各モジュールの隣に `*.test.ts`（Vitest、名前は日本語）
- `system/testHelpers.ts` はテスト専用
- `qa/simulation.test.ts`: 既定は縮小版（5 seed × 20,000 step）で例外・NaN・壁めり込み・id 重複を検査。`npm run qa:full` でフル版を回し `qa/report.md` を更新
