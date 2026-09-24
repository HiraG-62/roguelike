# CLAUDE.md（roguelike プロジェクト）

ブラウザで動くリアルタイム・トップダウンアクションローグライク（Hades / Nuclear Throne 系）。TypeScript + Vite + Vitest、Canvas 2D、**ランタイム依存なし**。手動操作（オート攻撃なし）、テレグラフを読んで避けて殴る。永続する装備ドロップ（ゴール装備を作らない設計）、永続のスキル石、ラン内の刻印符・祝福を持つ。趣味開発で「機能を足し続けて遊べる」ことが最優先。

- 現在の要素一覧・操作・次の候補: `IDEAS.md` の「現状」節（ここに重複して書かない）
- 応答・コメント・コミットは日本語（ユーザーのグローバル設定に従う）

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバ（Vite） |
| `npm run check` | tsc → vitest → vite build を順に実行。1 つでも失敗で非 0。**作業完了の判定はこれ** |
| `npm run test` | vitest run（QA シミュレーションは縮小版だけ走る） |
| `npm run qa:full` | `SIM_FULL=1` でフル QA（30 seed × 3 装備 × 60,000 step、数分）。`src/qa/report.md` を上書き。`-- --no-write` で書き出さない |
| `npm run build` | tsc --noEmit + vite build |
| `node scripts/bump.mjs <patch / minor / major>` | バージョンを上げてコミットとタグを作る（下の「バージョニング」） |

単体で回すとき: `npx vitest run src/system/boons.test.ts`、`npx tsc --noEmit`。

## アーキテクチャの地図

詳細は `docs/ARCHITECTURE.md`。

```
src/
  main.ts   ブラウザ側の配線（入力取得・ループ・画面遷移・永続化・効果音 drain・リプレイ記録）
  core/     決定的シミュレーションの核
  system/   ゲームロジック（state を読み書き）
  loot/     装備（生成・集計・クラフト・永続化）。純関数中心
  skills/   スキル石・刻印符のデータと型、設置物、スキル被弾処理
  map/      グリッド・部屋+通路生成・洞窟生成（純関数）
  render/   Canvas 描画（state を読むだけ）
  ui/       画面ロジック（DOM 非依存。タイトル・装備画面・設定・リプレイ保存）
  audio/    Web Audio 合成の効果音
  data/     tuning（手触り定数）/ enemies（敵定義）/ enemyCombat（怯み・状態異常の戦闘パラメータ）/ weapons（武器種・射撃の型）/ sprites（ピクセルマップ）
  meta/     図鑑・依頼・実績の定義と永続化（ラン中の記録は system 側が積むだけ）
  qa/       ヘッドレス bot とシミュレーション、report.md
```

### core
- `createGame(seed, seedText, profile, skillProfile)` → `GameState`。`step(state, input: FrameInput, dt)` が 1 固定ステップ
- 固定 60Hz（`core/loop.ts` の `FIXED_DT`）。ロジックは `FrameInput` と `dt` だけを見る
- 乱数は `state.rng`（mulberry32、`core/rng.ts`）だけ。`Math.random` は `audio/synth.ts` の音の揺らぎ以外で禁止
- `Date.now()` はアイテム / スキル石の `id` と `foundAt` を作る `now` 引数にだけ使う（ゲーム進行に影響させない）。`main.ts` の計時は別
- `core/replay.ts`: seed + FrameInput 列 + 装備スナップショット + 装備変更イベントで再現。`core/input.ts` / `gamepad.ts` が入力、`view.ts` が 480x270
- `core/status.ts`: 状態異常の型（`StatusKind` / `StatusEffect` / `StatusBag` / `StatusApply` / `StatusProc`）と一覧。ロジックは持たない（`system/statusEffects.ts` が読む）

### system（`step` の呼び出し順: loot.updateDropInteract〔拾得、ヒットストップ中も効く〕→ mana.tickMana → player → boons → statusEffects → terrain → enemies → projectiles → hazards → floor(updateRooms) → runEvents.updateRunEvents → reaper → combo → rules.resolveRules → effects → camera）
- `player.ts` 移動・ダッシュ・3 段コンボ・射撃・バースト・見切り・ダッシュ攻撃。`applyStats` で stats を反映（ステータスの派生・祝福の畳み込みもここ）
- `combat.ts` 与ダメ / 被ダメの唯一の入口（`damageEnemy` / `damagePlayer` / `healPlayer`）、コンボ倍率、armor 逓減、リゲイン、怯み値の加算呼び出し
- `attributes.ts` ステータスの実効値（`effectiveAttr`）・威力計算（`scaled`）・ラン内振り分けの畳み込み（`addRunAttributes` / `deriveAttributes`）
- `mana.ts` 気力の増減（`refillMana` / `tickMana` / `canAfford` / `spendMana`）。`core/game.ts` の `step` から直接呼ぶ
- `poise.ts` 怯みの蓄積・減衰・堅守・ダウン・処刑・背面の一撃（`addPoise` / `applyStagger` / `isStaggered` / `decayPoise` / `onStaggerEnd`）。独立した `step` ステップは持たず `combat.ts` / `enemies.ts` / `elites.ts` / `statusEffects.ts` から呼ばれる
- `enemies.ts` 敵 AI（phase: idle → chase → windup → strike → recover / spawning。怯みは `EnemyPhase` ではなく状態異常 `stagger` で表す）。behavior ごとの分岐。個別 behavior の実装は `enemyBehaviors.ts`（自爆・残像・沈黙・鐘・擬態・喰らう宝箱など 1 behavior 1 関数）、死骸・取り巻き・気力奪取・双子復活など横断的な仕組みは `enemyTraits.ts`
- `elites.ts` 精鋭修飾子 15 種 / `boss.ts` 階層ボス共通処理（ローテーション 4 体）。双子の騎士の専用ロジックは `bossTwins.ts`、霜の巨人は `bossFrostGiant.ts`、敵第 2 弾のボス 4 体（図書館主・鏡の騎士・油の王・巣母）の共通補助は `bossKit.ts`、専用ロジックは `bossLibrarian.ts` / `bossMirrorKnight.ts` / `bossOilKing.ts` / `bossBroodMother.ts` / `reaper.ts` 長居すると出る追跡者（ローテーション 5 体の専用ロジックは `reaperVariants.ts`）
- `projectiles.ts` 弾 / `hazards.ts` 地面に残る攻撃（爆弾・レーザー・衝撃波・着地・骨壁・プレイヤーの炎）と予告。敵第 2 弾の behavior は `enemyWave3.ts`、地形の層を絡めた攻撃は `enemyTerrain.ts`
- `floor.ts` フロア構築・部屋ロック・階段・`descend` / `roomTypes.ts` フロア種別と部屋種類 / `explore.ts` ミニマップ用探索 / `spawner.ts` 徘徊の目的地選びと増援の抽選（tuning の `ROAM`）/ `engagement.ts`「封鎖中 または 交戦中」の唯一の判定 / `map/pathing.ts` 視線判定と距離場ベースの経路（徘徊・敵の気付き・回り込み・QA bot が共有）
- `statusEffects.ts` 状態異常 34 種の付与・更新・相互作用（`applyStatus` / `hasStatus` / `updateStatusEffects`）。2 つの状態異常（か地形）が出会ったときの反応は `statusReactions.ts` / `triggers.ts` 装備トリガーの発火（起点・条件・効果の文法） / `traitHooks.ts` 性質由来の倍率・フック（`traitOutgoingMul` など）/ `keystones.ts` 誓約判定と日本語名
- `terrain.ts` 床の地形の層（水たまり・油・溶岩・毒沼・氷床・草むら・炎）の効果・延焼。型と一覧は `core/terrain.ts`、配置は `map/generator.ts` の `planTerrain`、描画は `render/terrainUi.ts`
- `boons.ts` 祝福 3 択（抽選・選択・呪いを受けて 4 択・既存フック）/ 定義データは `boonDefs.ts`（`BOON_KEYS` / `BOONS`。系譜・結びを含む）、拡張ルールの実装は `boonRules.ts`（`onBoonXxxRules`。`boons.ts` の各フックから呼ぶ）/ `skills.ts` スキル発動・気力 / 再使用時間・スロットごとの最低間隔・body 排他・刻印符の付け外し / `loot.ts` ドロップ・拾得
- `rules.ts` 統一ルール文法の照合（`resolveRules`。`core/rules.ts` の `Rule` 型を combo の後に 1 回だけ照合。詳細は `docs/ARCHITECTURE.md`）/ `runEvents.ts` 図鑑・依頼のラン中の数え上げ（`updateRunEvents` が `meta/runRecord.ts` の `noteRunEvents` を呼ぶだけ。ゲーム進行には効かない）
- `effects.ts` パーティクル・浮き文字・揺れ・ヒットストップ（見た目だけ）/ `camera.ts` / `physics.ts` 移動と壁判定

### その他
- loot（装備。響き・揺らぎ・来歴。`docs/LOOT_DESIGN.md`）: `types.ts`（Item / PlayerStats / Attributes / AttrKey / Profile / TraitColor）、`affixes.ts`（性質・変換・誓約・implicit）、`bases.ts`、`colors.ts`（性質の色・共鳴の重み）、`flux.ts`（期待値曲線・揺らぎ・反転）、`resonance.ts`（共鳴の判定と効果、`ATTR_LABEL`。三和音含む）、`provenance.ts`（来歴・節目・芽・目覚め）、`traitContext.ts`（性質が「自分の外」＝装備全体・来歴を読むための文脈）、`named.ts`（`UNIQUES` = 名のある遺物）、`names.ts`（命名・銘）、`generator.ts`（生成。`UNIQUES` は `named.ts` を re-export）、`triggers.ts`（トリガー文法）、`stats.ts`（`computeStats`、ソフトキャップ）、`describe.ts`（UI 向けの表示情報）、`crafting.ts`（残響・クラフト 7 操作）、`migrate.ts`（旧セーブの変換）、`profile.ts` / `craftingStore.ts`（永続化）
- skills: `types.ts`（`SKILL_KEYS` / `MODIFIER_KEYS`、`SkillDef` の `resource` / `manaCost` / `minInterval` / `poise` / `applies`）、`data.ts`（`SKILL_DEFS` / `MODIFIERS` / `SKILL` 定数 / `resolveCast`）、`tuning.ts`（大拡張分の数値。`data.ts` の `SKILL` に展開して読む）、`defs.ts`（大拡張のスキル定義）、`modifiers.ts`（大拡張の刻印符・型替え符の定義）、`combos.ts`（連携: スキル A の直後に手動で B を撃つと変化する組み合わせ）、`actions.ts` / `shots.ts` / `summons.ts`（発動処理の実体。近接型・弾型・設置/召喚型で分割）、`geom.ts`（当たり判定の幾何: 扇・線分・壁までの光線）、`generator.ts`、`placed.ts`（設置物）、`hit.ts`、`persistence.ts`
- ui（装備・クラフトの画面ロジック）: `inventory.ts`（タブと入力）、`inventoryLayout.ts`（レイアウト計算・`SLOT_LABEL`）、`echoTab.ts`（残響タブの状態機械）、`bud.ts`（芽モーダルの当たり判定）、`attributeAlloc.ts`（ラン内のステータス振り分け UI の状態）、`skillRunes.ts`（スキルタブの刻印符所持一覧の付け外し）、`synergyPanel.ts`（網タブの語一覧の状態）、`quests.ts`（起点直後の依頼 3 択の状態）
- render: `renderer.ts`（本体）、`inventoryUi` / `skillHud` / `boonUi` / `titleUi` / `minimap` / `darkness`、`terrainUi.ts`（地形の層の描画）、`budUi.ts`（芽のバナー・モーダル描画）、`echoTabUi.ts`（残響タブ描画）、`lootUiParts.ts`（装備 UI 共通部品: 色の配合バー・性質の行）、`attributeUi.ts`（ステータス画面）、`manaHud.ts`（気力バー）、`statusUi.ts`（状態異常の表示・怯みゲージ）、`sprites.ts`（アトラス）、`renderMath.ts`（テスト可能な描画計算）、`font.ts` / `pixelText.ts`、`dropTooltip.ts`（床のアイテム / スキル石に注目した時のツールチップ）、`skillRuneUi.ts`（刻印符所持一覧の描画）、`synergyUi.ts`（網タブの描画）、`chainUi.ts`（直近の連鎖の表示）、`questUi.ts`（依頼 3 択の描画）、`codexUi.ts`（図鑑・依頼一覧・実績の共通タブ画面の描画）
- audio: `sfxNames.ts`（`SFX_NAMES`）、`sfx.ts`（`SFX_DEFINITIONS`）、`synth.ts`
- meta（図鑑・依頼・実績。ラン中の記録はゲーム進行に効かない）: `codex.ts` / `codexStore.ts`（図鑑の定義・集計・永続化）、`quests.ts` / `questStore.ts`（依頼 28 種の定義・進行判定・永続化）、`achievements.ts`（実績 37 種と称号）、`runRecord.ts`（`state.codexRun` / `questRun` へラン中の出来事を積む記録係。`system/runEvents.ts` から呼ぶ）、`listScreen.ts` / `screens.ts`（図鑑・依頼一覧・実績の共通タブ画面の状態とレイアウト）、`lockedRelicKeys` などの補助関数

## 不変条件（破ったらレビューで差し戻す）

1. **ロジックと描画の分離**: system は state を読み書きし、render は state を読むだけ。描画から state を書き換えない
2. **描画で `state.rng` を消費しない**。見た目のばらつきは `renderMath.ts` の `tileHash` など座標ハッシュを使う
3. **決定性**: 同じ seed + 同じ FrameInput 列 → 同じ結果。`Math.random` や実時間に依存しない。リプレイテスト（`core/replay.test.ts`）を壊さない
4. **手触り・バランスの数値は `src/data/tuning.ts`**（スキルは `skills/data.ts` の `SKILL`、祝福は tuning の `BOON`）。ロジック中に数値を直書きしない
5. **フォント**: UI 文字は **すべて** `render/pixelText.ts` の `drawText` / `textWidth` / `wrapText` / `truncateText`（DotGothic16 のドット風描画、サイズは `TEXT.SMALL/BODY/TITLE/BIG`）で描く。`ctx.fillText` / `measureText` / `ctx.font` の直接使用は禁止（`uiFont` はフォント未ロード時のフォールバック専用）。**等幅前提の文字数計算は禁止**、行高は `Math.max(定数, textLineHeight())`
6. **座標は 480x270 の論理座標**（`core/view.ts` の `VIEW_W` / `VIEW_H`）。DPR 拡大は Renderer の transform が担う
7. **効果音**: ロジックは `pushSfx(state, name)` で名前を積むだけ。再生は main.ts が `audio/sfx.ts` で行う
8. **永続化**: localStorage は loot/profile・craftingStore・skills/persistence・ui/settings・ui/replayStore・meta/{codexStore,questStore,achievements} 経由のみ。step の中では触らない（拾得やイベントの保存は main.ts が行う）。壊れたデータは黙ってデフォルトへ落とす。キーの形式を変えるなら `v2` を切る
9. **型**: `any` 禁止。`noUncheckedIndexedAccess` 有効なので配列 / Record の添字結果は undefined を扱う
10. **コード作法**: マジックナンバーは定数化、早期リターンでネストを浅く、関数は単一責任。コメントは日本語で「なぜ」を書く
11. **テスト**: Vitest。`it` / `describe` の名前とアサーションメッセージは日本語。新しい仕組みには必ずテストを付ける
12. **UI の方針**: 単一指標（DPS・アイテムスコア）を出さない。ツールチップは「何ができるか」を語る（`docs/DESIGN_PRINCIPLES.md`）
13. **用語**: 表示文字列は `docs/GLOSSARY.md` の表記に揃える。内部 key（英語）は変えない
   - 気力（旧マナ）・生命（旧 HP）・再使用時間（旧 CD）・見切り（旧ジャスト回避）・精鋭（旧エリート）などの世界観語は `docs/GLOSSARY.md` の「世界観語の対応表」を正とする。表示に英字略語を出さない

## 要素の足し方（レシピ）

各レシピの最後は `npm run check`。サブエージェントに任せるときは `/add-enemy` などの skill を使う。

### 敵
1. `src/data/enemies.ts`: `EnemyBehavior` に追加（既存 behavior の流用なら不要）、`ENEMIES` に `EnemyDef`（`name` は日本語、`minDepth` / `weight` / `windup` はテレグラフが読める長さ）。既存の敵の色替え + 挙動 1 つの追加なら新規 behavior を作らず `EnemyDef.recolor`（元のスプライトと behavior を流用し、色と 1 挙動だけ差し替える）
2. `src/system/enemies.ts`: `STRIKE_SPEED_MUL` / `WINDUP_MOVE_MUL`（`Record<EnemyBehavior, number>` なので追加漏れは型エラー）と behavior の分岐。AI の数値は tuning の `ENEMY_AI`。個別 behavior の処理は `enemyBehaviors.ts`、死骸・取り巻き・気力奪取などの横断的な仕組みは `enemyTraits.ts`
3. `src/data/sprites.ts`: `SPRITES[def.sprite]` を追加（下記スプライト）。`render/sprites.test.ts` が全敵のスプライト存在を検査する
4. 必要なら `render/renderer.ts` に専用の予告表現、`audio` に効果音
5. テスト: `system/enemies.test.ts` に「windup → strike で当たる」「予告中は無害」など

### 武器種（近接の型）/ 射撃の型
- `src/data/weapons.ts`: 近接は `MOVESET_KEYS` に key を足し `MOVESETS` に `MovesetDef`（3 段コンボ各段の `MeleeStepDef`: windup / active / recover / `Scaling` / 怯み値 / 当たり判定の形 `HitShape` / 手触りの任意項目）、射撃は `SHOT_KEYS` に key を足し `SHOT_TYPES` に `ShotDef`。数値は tuning の `WEAPON`
- ベースへの紐付け: `src/loot/bases.ts` の `BASES` で武器スロットのベースに `moveset`、銃スロットのベースに `shot` を指定（`PlayerStats.moveset` / `shot` へ流れる）
- 呼び出し側: `system/player.ts` が `stats.moveset` で `MOVESETS` を、`stats.shot` で `SHOT_TYPES` を引いて発動処理を分岐
- テスト: `data/weapons.test.ts`

### 性質（旧アフィックス）/ 変換 / 誓約 / 名のある遺物 / ベース
- 性質: `src/loot/affixes.ts` の `AFFIXES` に `AffixDef`（`curve` = 深度ごとの期待値の点列、`slots`、`tags`、`color`〔省略時は `colors.ts` の `colorFromTags` が tags から決める〕、`apply`）。prefix / suffix / tier の区別は無い。値は表示単位（+25% なら 25）。新しい stat が要るなら `loot/types.ts` の `PlayerStats` と `DEFAULT_STATS` に追加し、system 側で読む。強いものほどトレードオフを付ける。装備全体や来歴など「自分の外」を読む性質は `loot/traitContext.ts` の文脈を通す
- 変換: `CONVERSION_AFFIXES`（key は `cv_`）。誓約（旧キーストーン、表示名は「誓約」）: `KEYSTONES`（key は `ks_`、`group` で排他）+ `system/keystones.ts` の `KS` / `KEYSTONE_NAME`
- 名のある遺物（旧ユニーク）: `src/loot/named.ts` の `UNIQUES`（`baseKey` / 固定の性質 / 任意で誓約。`generator.ts` が re-export）。未知 key は生成時に throw するのでテストで気付ける
- ベース: `src/loot/bases.ts` の `BASES` + `affixes.ts` の `IMPLICITS`
- テスト: `loot/affixes.test.ts` / `generator.test.ts` / `stats.test.ts`

### スキル / 刻印符
- スキル石: `skills/types.ts` の `SKILL_KEYS` → `skills/data.ts` の `SKILL_DEFS`（大拡張分は `skills/defs.ts` に書いて `SKILL_DEFS` に混ぜる）
  - `resource: "mana" | "cooldown"` を選ぶ。気力型は `manaCost` を消費（`cooldown` は 0、チャージは常に 1）、再使用型は `manaCost` 0 で既存の `cooldown` / `charges` を使う。どちらも `minInterval`（スロットごとの連打下限）がかかる。全スロット共通の待ち（旧 GCD）は無く、同じステップに押した複数スロットは 1→4 の順にすべて発動する。本動作（`active`）を持つ近接・移動系は `exclusiveGroup: "body"` で互いに排他、それ以外（設置・強化・射撃の一部）は本動作中でも並行して撃てる
  - 威力は `Scaling`（`{ base, str?, dex?, vit?, mnd?, spi? }`）で書く。`base` はステータス基礎値（各 5）のとき現行の威力と一致するよう逆算する（`docs/COMBAT_DESIGN.md` A-6）。呼び出し側で `system/attributes.ts` の `scaled(stats, scaling)` を通す
  - `poise`（1 ヒットの基礎怯み値。最終値は × `poiseDamageMul`）を必ず入れる。状態異常を付けるなら `applies?: readonly StatusApply[]`（下記「状態異常」）
  - `SKILL` 定数（共通パラメータ）→ `system/skills.ts` の `castSlot` に発動処理（設置物なら `skills/placed.ts`）。発動処理の実体は近接型 `skills/actions.ts` / 弾型 `skills/shots.ts` / 設置・召喚型 `skills/summons.ts`、当たり判定の幾何は `skills/geom.ts`。数値は `skills/tuning.ts` に置き `SKILL.<key>` 経由で読む → `render/skillHud.ts` / `render/manaHud.ts` / `renderer.ts` の表現
  - 直前に撃った別のスキルを受けて効果が変わる「連携」を足すなら `skills/combos.ts` の `COMBOS`（発動元 → 受け側のキーで引く。受付秒は `SkillRunState.lastCast`）
- 刻印符: `MODIFIER_KEYS` → `MODIFIERS`（大拡張分は `skills/modifiers.ts`。`canAttach` の条件）→ `resolveCast` に効果。`CastParams.burdenMul`（旧 `cooldownMul`）は気力型ならコスト、再使用型なら再使用時間に掛かる。発動の「型」自体を変える型替え符は `ModifierDef.reshape`（リンク 2 本、1 スロット 1 枚まで）
- **相性表**: `skills/skills.test.ts` の `FORBIDDEN` を必ず更新（全組み合わせをテストで固定している）

### 攻撃ジャンル・属性
- ジャンル（範囲軸 × 質軸）は `core/element.ts` の `ATTACK_RANGES` / `ATTACK_QUALITIES` に型がある。新しい攻撃を追加するときは既存の 3×3 から選び、`AttackProfile`（`{ genre, element }`）を武器種（`data/weapons.ts` の `MOVESETS` / `SHOT_TYPES`）かスキル（`skills/data.ts` の `SKILL_ATTACK`）に渡す。参照ステータスの既定表は `system/attributes.ts` の `GENRE_ATTRS`
- 属性を増やすなら `core/element.ts` の `ELEMENTS` に足し、`ELEMENT_LABEL` に日本語名、`data/tuning.ts` の `ELEMENT`（弱点 / 耐性の倍率・関連する状態異常）、`data/enemyDefense.ts` の各敵に耐性値を追加（`Record` なので漏れは型エラー）。プレイヤー側は `loot/affixes.ts` に属性の変換（`cv_infuse*`）・耐性（`res_*`）の性質を足す
- 敵の防御・魔防・耐性・弱点は `data/enemyDefense.ts` の `ENEMY_DEFENSE`（`d(body, resist, attack, stages?)`。ボスは `stages` で段階ごとに上書き）。計算は `system/elementCombat.ts`、表示は `render/elementUi.ts`（弱点の頭上の印は倒すまで「？」）
- テスト: `system/elementCombat.test.ts` / `data/genre.test.ts`

### ジョブ
1. `src/data/jobs.ts`: `JOB_KEYS` に key を足し、`JOBS` に `JobDef`（ステータスの偏り、得意な武器種 `favored`、固有ルール 2 つは統一ルール文法で `rules`、初期スキル石 `starterSkill`、弱点 `weakness`。合計 0 になるようにする）
2. `src/system/jobs.ts`: `applyJobStats` がステータスの偏りと得意武器の上乗せを畳み込む（`system/runSetup.ts` の `applyRunStats` から呼ばれる）。`jobRules` が `collectRules` に合流し、`startJob`（`createGame` が呼ぶ）が未所持のときだけ初期スキル石を倉庫へ入れる
3. 依頼の報酬でジョブを解放するなら `meta/quests.ts` の `QuestReward` に `job` を指定
4. テスト: `system/jobs.test.ts`

### 契約者
1. `src/system/contractors.ts`: `CONTRACTOR_KEYS` に key を足し、`CONTRACTORS` に定義（`name` は日本語、台座の種類は `OfferKind`、効果は関数）。取引の代価は欠片（`state.shards`）か生命
2. 契約（灰の公証人）を増やすなら `PACT_KEYS` に足し、失敗判定はその場、達成判定は `onContractsFloorReached`（次の階に着いたとき）
3. 鍛冶・属性の祭壇など「通常攻撃に属性を乗せる」系は `ensureContractStats` が `applyStats` の結果に後から足す
4. テスト: `system/contractors.test.ts`

### 状態異常
- 種類を増やすなら `src/core/status.ts` の `STATUS_KINDS` に追加し、`src/system/statusEffects.ts` に効果・持続・スタック規則・相互作用を実装、`src/render/statusUi.ts` の `STATUS_GLYPH` / `STATUS_COLOR` に表示を足す
- 既存 34 種に新しい付与経路を足すだけなら型を増やさず、以下のどちらかで `StatusApply`（kind / stacks / duration / potency）を渡す
  - スキルの命中: `SkillDef.applies`（上の「スキル」参照）。命中した敵に `applyStatus` で入る
  - 敵の攻撃: `src/data/enemyCombat.ts` の `EnemyCombatDef.inflicts`（`EnemyInflict[]`。`on` でどの攻撃種類か、`minDepth` で深度条件を絞れる）
- 装備の性質から確率で付与するなら `PlayerStats.statusProcs: StatusProc[]`（`chance` / `on: "melee" | "ranged" | "skill" | "any"` / `requiresCrit?`）を `loot/affixes.ts` の `apply` で足す。判定は on-hit の内部 CD（`StatusBag.procIcd`、`STATUS.onHitIcd`）で敵ごとに絞られる
- 2 つの状態異常（か地形の層）が出会ったときの追加効果（反応）を足すなら `src/core/status.ts` の `REACTION_KEYS` + `src/system/statusReactions.ts` に実装
- 床の地形の層を増やすなら `src/core/terrain.ts` の `TERRAIN_KINDS` + `src/system/terrain.ts` に効果、配置は `src/map/generator.ts` の `planTerrain`、描画は `src/render/terrainUi.ts`
- テスト: `system/statusEffects.test.ts`（相互作用・拘束上限・免疫）。敵の付与は `system/enemies.test.ts` に追加

### 祝福
1. `src/system/boonDefs.ts`: `BOON_KEYS` と `BOONS`（name / desc は日本語、`tags`、`cursed`、必要なら `requires`）。同じ主から出る多段の祝福なら `lineage` / `after`（系譜。4 段目は装備 / スキル石のタグを要求する奥義）、特定 2 祝福の合体なら `duo`（結び）
2. 効果: 数値なら `foldBoonStats`（`boons.ts`）、ルール変更なら `boons.ts` の既存フック（`onBoonMeleeHit` / `onBoonKill` / `onBoonDash` …）から `boonRules.ts` の `onBoonXxxRules` を呼ぶ（大拡張分はここに実装を足す）か、呼び出し側 system で `hasBoon` 分岐。数値は tuning の `BOON`
3. 原則: **数値盛りではなくルール変更**。装備タグと掛け算になる形にする
4. テスト: `system/boons.test.ts`（定義・抽選）/ `system/boonRules.test.ts`（拡張ルールの効果）

### 依頼 / 実績
- 依頼: `src/meta/quests.ts` の `QUEST_KEYS` に key を足し、`QUESTS` に `QuestDef`（`name` / `desc` は日本語、`goal`、`measure: (s: QuestSnapshot) => number`、`reward`）。`measure` が読める数え上げが無ければ `QuestCounters`（同ファイル）にフィールドを足し、`system/runEvents.ts` から呼ぶ `meta/runRecord.ts` の `noteRunEvents` で加算する。`QuestReward` は起点の解放 / 名のある遺物の抽選から外す / 図鑑の頁 / 称号のどれかで、数値の強さは配らない
- 実績: `src/meta/achievements.ts` の `ACHIEVEMENTS` に `AchievementDef`（`key` / `name` / `desc` / `check: (ctx: AchievementContext) => boolean`）。`AchievementContext` は図鑑（`CodexSave`）・依頼（`QuestSave`）・メタ統計（`ProfileMeta`）を読むだけ。実績名がそのまま称号として名乗れる
- どちらも一覧画面は `meta/listScreen.ts` / `meta/screens.ts`（タブ状態）→ `render/codexUi.ts`（描画）で共通化されている。新しいタブを増やすのでなければ画面側は触らなくてよい
- テスト: `meta/quests.test.ts` / `meta/achievements.test.ts`

### 部屋種類
- `core/state.ts` の `RoomKind` → `system/roomTypes.ts`（`assignRoomKinds` / 開始時処理）→ tuning の `ROOM_KIND` → 描画（`renderer.ts`、`minimap.ts`）→ `system/roomTypes.test.ts`
- フロア種別は `FloorKind` と `chooseFloorKind`、tuning の `FLOOR_KIND`
- **封鎖するかどうか（`locks`）**: 洞窟基本の開放型フロアでは、部屋に入っても既定では封鎖しない。封鎖する種類だけ tuning の `ROOM_KIND.locks`（`Record<RoomKind, boolean>` なので追加漏れは型エラー）に `true` を足す。`system/roomTypes.ts` の `ROOM_LOCKS` がそれを re-export し、`floor.ts` が入室時に見る。封鎖しない種類は代わりに「交戦中」（`system/engagement.ts`）で判定し、部屋の敵が全滅すると制圧扱いになる（封鎖と同じ報酬・フックを通す）

### 効果音・音楽
- `audio/sfxNames.ts` の `SFX_NAMES` に名前を足す → 実装は 2 通り。**層を並べるだけで作れるなら** `audio/sfxLayers.ts` の `LAYERED_SFX` に `Layer`（`noise` / `tone` / `sweep` / `chord` など、`audio/layers.ts` の型）の配列を書く（新しい効果音はまずこちらを検討する）。個別の合成が要るときだけ `audio/sfx.ts` の `SFX_DEFINITIONS` に関数を書く（`Record<SfxName, …>` なので両方から漏れは型エラー）→ ロジックから `pushSfx`
- BGM を増やす・変えるなら `audio/music.ts` の `TRACKS`（`TrackKey = FloorKind | "boss"`。`TrackDef` は和音・リズム・打楽器の入り方）。曲の選択は `pickTrack`（フロア種別・交戦中・ボスで切り替え）、`main.ts` の `updateMusic` が state を読んで `musicCue` に渡す。ロジック（`system/`）は音楽を知らない
- テスト: `audio/sfx.test.ts` / `audio/music.test.ts`

### スプライト
- `src/data/sprites.ts` の `SPRITES` にフレーム配列（1 フレーム = 文字列の行配列）。`'.'` は透明、他は `PALETTE` の 1 文字。キャラは **右向き** で描く（左は描画側で反転）
- 通常 16x16、ボス 32x32、ゴーレム 24x24、小物 8x8 / 12x12。歩行は 4 フレーム。全フレーム同寸
- 新色は `PALETTE` に 1 文字キーで追加。テスト（`render/sprites.test.ts`）が寸法・パレット・空フレームを検査

## 並列開発の作法

詳細とプロンプト雛形は `docs/AI_WORKFLOW.md`。

- 機能を **ファイル所有** で分割し、Agent ごとに「所有ファイル / 編集禁止 / 先に読むもの / 完了条件 / 報告形式」を渡す（`/parallel`）
- 共有ファイル（`core/state.ts` / `core/game.ts` / `data/tuning.ts` / `render/renderer.ts` / `main.ts`）は **最小の Edit のみ**。全文 Write で書き換えない（他 Agent の変更を消す）
- Agent は **コミットしない**。統合側が `git add <所有ファイル>` で論理単位ごとにコミットする（`git add -A` 禁止）
- 一時ファイルはリポジトリに置かない（scratchpad を使う）
- 完了報告の形式:
  - 変更ファイル（新規 / 変更）
  - 追加した型フィールド・定数・公開関数
  - 統合手順（共有ファイルに入れるべき Edit があれば差分の形で）
  - テスト結果（`npm run check` の成否と件数。失敗が他 Agent 起因ならその旨）
- サブエージェント定義は `.claude/agents/`（implementer / reviewer / qa-runner / brainstormer / pixel-artist / localizer / balance-tuner）
- skill（`.claude/skills/`）: `/check` `/qa` `/add-enemy` `/add-affix` `/add-skill` `/add-boon` `/parallel` `/review` `/handoff-docs` `/release-notes` `/bump`

## バージョニング

- 形式はメジャー.マイナー.パッチ。版の定義元は `package.json` / `src/version.ts`（`APP_VERSION` 表示用、`APP_VERSION_SEMVER`、`RELEASE_PHASE`）/ `CHANGELOG.md`。手で書き換えず `scripts/bump.mjs` を使う（`/bump`）
- **メジャー**: 大規模アップデートのみ。**ユーザーの指示がない限り動かさない**（スクリプトも `--force-major` が無ければ拒否）
- **マイナー**: 機能追加・それなりに大きな変更
- **パッチ**: 小規模な追加・変更・バグ修正・整備作業
- **α 期間**: ある程度形になるまでは α 版。表示は「0.0.xxα」で、minor 相当の変更でもパッチ番号を上げる。package.json は semver（`0.0.1`）、git タグは `v0.0.1`、α は表示だけ。α を抜けるのもユーザーの指示があるときだけ（`--end-alpha`）
- 変更内容はコミットのたびに統合役が `CHANGELOG.md` の `[Unreleased]` へ日本語で追記する（並列の Agent は触らない）。bump がそれを新しい版の節へ移す
- 版を上げるタイミングは統合役が決める（まとまった変更を統合し、`npm run check` が通った後）

## コミット

- 形式 `<type>: <日本語の概要>`（feat / fix / refactor / docs / style / test / chore）。1 コミット = 1 論理変更
- ユーザーの指示があるまでコミットしない

## ドキュメント索引

| ファイル | 内容 |
| --- | --- |
| `docs/HANDOFF.md` | **セッション開始時に最初に読む**: 現在地・進行中のレーン・次にやる候補・ユーザーに聞くこと |
| `IDEAS.md` | 企画メモと「現状」（引き継ぎの起点） |
| `CHANGELOG.md` | 版ごとの変更履歴（Keep a Changelog 風） |
| `docs/ARCHITECTURE.md` | データフロー・型の関係・決定性とリプレイ・永続化キー |
| `docs/AI_WORKFLOW.md` | 設計 → 並列実装 → レビュー → QA → 統合の手順と Agent プロンプト雛形 |
| `docs/DESIGN_PRINCIPLES.md` | ゲームデザインの原則 |
| `docs/GLOSSARY.md` | 用語と日本語表記の統一 |
| `docs/LOOT_DESIGN.md` | 装備システムの設計 |
| `docs/ideas/README.md` | ブレスト一覧と実装済み / 未実装チェックリスト |
| `docs/ideas/*.md` | 手触り / ビルド多様性 / ラン構造 / スキル / 装備の独自性 のブレスト |
| `src/qa/report.md` | 最新のフル QA 結果 |

## 導入しないもの

- Prettier / ESLint は入れない（依存を増やさない方針）。書式は `.editorconfig`（LF・UTF-8・2 スペース）と既存コードに合わせる。整形の揺れが問題になったら Prettier を devDependency だけで入れる案を検討する
