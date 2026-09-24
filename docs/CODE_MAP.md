# コードの地図（層ごとのファイル一覧）

CLAUDE.md から分けた、層ごとのファイルの役割の一覧。**ファイルを足したらここに 1 行、消したら行を消す**（`npm run audit:docs` が src の本体ファイルの網羅と「（`XXX`、N 種）」の件数を検査する）。データフローや型の関係は `docs/ARCHITECTURE.md`、設計の理由は `docs/ideas/*.md`。

詳細は `docs/ARCHITECTURE.md`。

```
src/
  main.ts   ブラウザ側の配線（入力取得・ループ・画面遷移・永続化・効果音 drain・リプレイ記録）。拠点の台から画面を開く流れは ui/hubFlow.ts
  core/     決定的シミュレーションの核
  system/   ゲームロジック（state を読み書き）
  loot/     装備（生成・集計・クラフト・永続化）。純関数中心
  skills/   スキル石・刻印符のデータと型、設置物、スキル被弾処理
  map/      グリッド（grid）・部屋+通路生成（generator。地形の配置 planTerrain も）・洞窟生成（cave）・拠点の 1 部屋（hubMap）・視線と距離場（pathing / sightBlock）。純関数
  render/   Canvas 描画（state を読むだけ）
  ui/       画面ロジック（DOM 非依存。タイトル・起点・拠点・装備画面・設定・リプレイ保存）
  audio/    Web Audio 合成の効果音と音楽
  data/     balance/*.json（バランス数値。読み込みと _note の剥ぎ取りは balance/index.ts、実行時の形の検査は balance/validate.ts。tuning が再 export）/ tiles（外部 PNG 素材の取り込み表）/ enemies・enemiesWave3（敵定義）/ enemyCombat・enemyCombatWave3（怯み・状態異常の戦闘パラメータ）/ enemyDefense（防御・耐性）/ weapons（武器種の型定義）/ jobs / actionText（浮き文字の表示文字列）/ sprites と sprites/<family>.ts（ピクセルマップ。家族は beasts / bosses / cloister / heavy / player / shallows / still / w3back / w3front / weapons、共通の小道具は frameKit）
  meta/     図鑑・依頼・実績・連携の発見・拠点の既読の定義と永続化（ラン中の記録は system 側が積むだけ）
  save/     保存先の唯一の入口（backend。ブラウザは localStorage、Electron は fileStorage がファイルへ遅延書き込み。ファイルの封筒は fileEnvelope、preload との契約は bridge）。bootstrap が起動時に差し替える
  qa/       ヘッドレス bot とシミュレーション、report.md
  version.ts 表示用の版と RELEASE_PHASE（scripts/bump.mjs が書き換える）
  テスト専用ヘルパー（本体からは import しない）: system/testHelpers.ts（arena / placeEnemy / withInput）、meta/testStorage.ts、audio/testAudioMock.ts
electron/   Electron 版の main / preload / IPC / セーブファイル（src とは別ツリー。src/save/bridge.ts の契約で繋がる）
```

## core
- `createGame(seed, seedText, profile, skillProfile)` → `GameState`。`step(state, input: FrameInput, dt)` が 1 固定ステップ
- 固定 60Hz（`core/loop.ts` の `FIXED_DT`）。ロジックは `FrameInput` と `dt` だけを見る
- 乱数は `state.rng`（mulberry32、`core/rng.ts`）だけ。`Math.random` は `audio/synth.ts` の音の揺らぎ以外で禁止
- `Date.now()` はアイテム / スキル石の `id` と `foundAt` を作る `now` 引数にだけ使う（ゲーム進行に影響させない）。`main.ts` の計時は別
- `core/replay.ts`: seed + FrameInput 列 + 装備スナップショット + 装備変更イベントで再現。`core/input.ts` / `gamepad.ts` が入力、`view.ts` が 480x270
- `core/status.ts`: 状態異常の型（`StatusKind` / `StatusEffect` / `StatusBag` / `StatusApply` / `StatusProc`）と一覧。ロジックは持たない（`system/statusEffects.ts` が読む）
- `core/rules.ts` 統一ルール文法の `Rule` 型 / `core/events.ts` ゲームイベント（各 system は `pushEvent` で積むだけ。`system/rules.ts` が照合）/ `core/keywords.ts` 共通語彙「語」の型（推論・集計は `system/keywords.ts`）/ `core/element.ts` 属性とジャンル / `core/terrain.ts` 地形の層の型 / `core/vec.ts` ベクトル / `core/units.ts` 表示単位（`formatMeters`）

## system（`step` の呼び出し順: loot.updateDropInteract〔拾得、ヒットストップ中も効く〕→ mana.tickMana → player → boons → statusEffects → terrain → enemies → projectiles → hazards → floor(updateRooms) → runEvents.updateRunEvents → reaper → combo → rules.resolveRules → effects → camera）
- `player.ts` 移動・ダッシュ・3 段コンボ・射撃・バースト・見切り・ダッシュ攻撃。`applyStats` で stats を反映（ステータスの派生・祝福の畳み込みもここ）/ `weaponArts.ts` 右クリックの固有技（受け流し・構え・弾を出す・弾を戻す・狙い撃ち。派生の技は `player.ts` の `tryBranch`）
- `combat.ts` 与ダメ / 被ダメの唯一の入口（`damageEnemy` / `damagePlayer` / `healPlayer`）、コンボ倍率、armor 逓減、リゲイン、怯み値の加算呼び出し
- `attributes.ts` ステータスの実効値（`effectiveAttr`）・威力計算（`scaled`）・ラン内振り分けの畳み込み（`addRunAttributes` / `deriveAttributes`）
- `mana.ts` 気力の増減（`refillMana` / `tickMana` / `canAfford` / `spendMana`）。`core/game.ts` の `step` から直接呼ぶ
- `poise.ts` 怯みの蓄積・減衰・堅守・ダウン・処刑・背面の一撃（`addPoise` / `applyStagger` / `isStaggered` / `decayPoise` / `onStaggerEnd`）。独立した `step` ステップは持たず `combat.ts` / `enemies.ts` / `elites.ts` / `statusEffects.ts` から呼ばれる
- `enemies.ts` 敵 AI（phase: idle → chase → windup → strike → recover / spawning。怯みは `EnemyPhase` ではなく状態異常 `stagger` で表す）。behavior ごとの分岐。個別 behavior の実装は `enemyBehaviors.ts`（自爆・残像・沈黙・鐘・擬態・喰らう宝箱など 1 behavior 1 関数）、死骸・取り巻き・気力奪取・双子復活など横断的な仕組みは `enemyTraits.ts`
- `elites.ts` 精鋭修飾子（`ELITE_KINDS`、21 種）/ `boss.ts` 階層ボス共通処理（`BOSS_ROTATION`、9 体）。双子の騎士の専用ロジックは `bossTwins.ts`、霜の巨人は `bossFrostGiant.ts`、敵第 2 弾のボス 4 体（図書館主・鏡の騎士・油の王・巣母）の共通補助は `bossKit.ts`、専用ロジックは `bossLibrarian.ts` / `bossMirrorKnight.ts` / `bossOilKing.ts` / `bossBroodMother.ts`、逃げるボス「盗賊王」は `bossThiefKing.ts` / `reaper.ts` 長居すると出る追跡者（ローテーション 5 体の専用ロジックは `reaperVariants.ts`）
- `projectiles.ts` 弾 / `hazards.ts` 地面に残る攻撃（爆弾・レーザー・衝撃波・着地・骨壁・プレイヤーの炎）と予告。敵第 2 弾の behavior は `enemyWave3.ts`、地形の層を絡めた攻撃は `enemyTerrain.ts`
- `floor.ts` フロア構築・部屋ロック・階段・`descend` / `roomTypes.ts` 部屋種類 / `biomes.ts` フロア種別 × テーマ（`FLOOR_KINDS`。地形の配置・出やすい敵・色調）/ `specialRooms.ts` 台座の部屋（祭壇・図書館・賭博など。触れて選ぶのでモーダルを出さない）と戦う部屋（闘技場・護衛・逃走など）と分岐路 / `linger.ts` 長居の代償（死神より先に始まるフロアごとの悪化: 影の自分・崩落・潮）/ `impacts.ts` 予告つきの落下物（敵にも当たる）/ `hub.ts` 拠点の 1 部屋を歩く小さなセッション（`createHub` / `stepHub`。ランの `step` とは別）/ `contractors.ts` 契約者（台座での取引。レシピ「契約者」）/ `jobs.ts` ジョブ / `runSetup.ts` ラン開始時のステータス畳み込み / `explore.ts` ミニマップ用探索 / `spawner.ts` 徘徊の目的地選びと増援の抽選（tuning の `ROAM`）/ `engagement.ts`「封鎖中 または 交戦中」の唯一の判定 / `map/pathing.ts` 視線判定と距離場ベースの経路（徘徊・敵の気付き・回り込み・QA bot が共有）
- `statusEffects.ts` 状態異常（`STATUS_KINDS`、34 種）の付与・更新・相互作用（`applyStatus` / `hasStatus` / `updateStatusEffects`）。2 つの状態異常（か地形）が出会ったときの反応は `statusReactions.ts` / `triggers.ts` 装備トリガーの発火（起点・条件・効果の文法） / `traitHooks.ts` 性質由来の倍率・フック（`traitOutgoingMul` など）/ `keystones.ts` 誓約判定と日本語名
- `terrain.ts` 床の地形の層（水たまり・油・溶岩・毒沼・氷床・草むら・炎）の効果・延焼。型と一覧は `core/terrain.ts`、配置は `map/generator.ts` の `planTerrain`、描画は `render/terrainUi.ts`
- `boons.ts` 祝福 3 択（抽選・選択・呪いを受けて 4 択・既存フック）/ 定義データは `boonDefs.ts`（`BOON_KEYS` / `BOONS`。系譜・結びを含む。第 2 弾は `boonDefsWave2.ts` に置いて混ぜる）、拡張ルールの実装は `boonRules.ts`（`onBoonXxxRules`。`boons.ts` の各フックから呼ぶ）/ `skills.ts` スキル発動・気力 / 再使用時間・スロットごとの最低間隔・body 排他・刻印符の付け外し / `loot.ts` ドロップ・拾得
- `rules.ts` 統一ルール文法の照合（`resolveRules`。`core/rules.ts` の `Rule` 型を combo の後に 1 回だけ照合。詳細は `docs/ARCHITECTURE.md`）/ `keywords.ts` 語の推論と集計（装備の stats から語と祝福タグを出す 1 つの表。UI にスコアは出さない）/ `elementCombat.ts` 属性・ジャンルの与ダメ計算 / `runEvents.ts` 図鑑・依頼のラン中の数え上げ（`updateRunEvents` が `meta/runRecord.ts` の `noteRunEvents` を呼ぶだけ。ゲーム進行には効かない）
- `effects.ts` パーティクル・浮き文字・揺れ・ヒットストップ（見た目だけ）/ `camera.ts` / `physics.ts` 移動と壁判定

## その他
- loot（装備。響き・揺らぎ・来歴。`docs/LOOT_DESIGN.md`）: `bullets.ts`（銃のベースごとの弾 `BULLETS`）、`types.ts`（Item / PlayerStats / Attributes / AttrKey / Profile / TraitColor）、`affixes.ts`（性質・変換・誓約・implicit）、`bases.ts`、`colors.ts`（性質の色・共鳴の重み）、`flux.ts`（期待値曲線・揺らぎ・反転）、`resonance.ts`（共鳴の判定と効果、`ATTR_LABEL`。三和音含む）、`provenance.ts`（来歴・節目・芽・目覚め）、`traitContext.ts`（性質が「自分の外」＝装備全体・来歴を読むための文脈）、`named.ts`（`UNIQUES` = 名のある遺物）、`names.ts`（命名・銘）、`generator.ts`（生成。`UNIQUES` は `named.ts` を re-export）、`triggers.ts`（トリガー文法）、`stats.ts`（`computeStats`、ソフトキャップ）、`describe.ts`（UI 向けの表示情報）、`crafting.ts`（残響・クラフト 7 操作）、`migrate.ts`（旧セーブの変換）、`profile.ts` / `craftingStore.ts`（永続化）
- skills: `types.ts`（`SKILL_KEYS` / `MODIFIER_KEYS`、`SkillDef` の `resource` / `manaCost` / `minInterval` / `poise` / `applies`）、`data.ts`（`SKILL_DEFS` / `MODIFIERS` / `SKILL` 定数 / `resolveCast`）、`defs.ts` / `modifiers.ts`（大拡張のスキル石・刻印符・型替え符の定義）、`defs2.ts` / `actions2.ts` / `modifiers2.ts`（第 2 弾: 地形・新しい状態異常・属性・武器種・空間）、`defs3.ts` / `forms.ts`（第 3 弾: 左右クリックを差し替える変身。変身 8 種の共通規則は `forms.ts`）、`tuning.ts` / `tuning2.ts` / `tuning3.ts`（`data/balance/skills.json` を `SKILL` に流すだけの薄いファイル）、`reshapes.ts`（union 文字列を含むため TS に残す数値表）、`wear.ts`（スキル石の使い込み: 発動回数の節目で芽が出る）、`combos.ts`（連携: スキル A の直後に手動で B を撃つと変化する組み合わせ）、`actions.ts` / `shots.ts` / `summons.ts`（発動処理の実体。近接型・弾型・設置/召喚型で分割）、`geom.ts`（当たり判定の幾何: 扇・線分・壁までの光線）、`generator.ts`、`placed.ts`（設置物）、`hit.ts`、`persistence.ts`
- ui（画面ロジック）: `origin.ts`（起点画面: ジョブ → 起点・縛り → ラン開始）、`hubFlow.ts`（拠点の台 → 開く画面の対応表）、`scalingText.ts`（計算式「威力 18 = 10 ＋ 筋力×1.3」の組み立て。純関数）、`title.ts` / `settings.ts` / `replayStore.ts`、装備・クラフト画面は `inventory.ts`（タブと入力）、`inventoryLayout.ts`（枠・一覧・詳細欄の位置の定数・`SLOT_LABEL`）、`equipmentLayout.ts`（装備タブの部位の枠・帯・芽のバナー・ステータスの位置）、`echoTab.ts`（残響タブの状態機械）、`bud.ts`（芽モーダルの当たり判定）、`attributeAlloc.ts`（ラン内のステータス振り分け UI の状態）、`skillRunes.ts`（スキルタブの刻印符所持一覧の付け外し）、`synergyPanel.ts`（流れタブの一覧の状態）、`quests.ts`（起点直後の依頼 3 択の状態）、`stashFilter.ts`（倉庫の部位タブ・並べ替え・絞り込みの仕組みとボタンの折り返し配置）、`stashFacets.ts`（並び・絞り込みの軸の定義表。描画は `render/stashToolbarUi.ts`）
- render: `renderer.ts`（本体）、`inventoryUi` / `skillHud` / `boonUi` / `titleUi` / `minimap` / `darkness`、`runUi.ts`（ラン構造: バイオームの色調・台座・契約者・長居の代償・分岐路など）、`hubUi.ts`（拠点の重ね描き）、`originUi.ts`（起点画面）、`comboUi.ts`（コンボ HUD: 武器名・段・次の派生）、`effectsUi.ts`（演出。`state.effects` を読む）、`chargeLineUi.ts`（二度突きの予告線）、`elementUi.ts`（弱点の印）、`imageAtlas.ts` / `tileAtlas.ts` / `imageLut.ts`（PNG アトラスの読み込み・バイオームの再配色。読み込み時に 1 回だけ合成）、`terrainUi.ts`（地形の層の描画）、`budUi.ts`（芽のバナー・モーダル描画）、`echoTabUi.ts`（残響タブ描画）、`lootUiParts.ts`（装備 UI 共通部品: 色の配合バー・性質の行）、`attributeUi.ts`（ステータス画面）、`manaHud.ts`（気力バー）、`statusUi.ts`（状態異常の表示・怯みゲージ）、`sprites.ts`（アトラス）、`renderMath.ts`（テスト可能な描画計算）、`font.ts` / `pixelText.ts`、`dropTooltip.ts`（床のアイテム / スキル石に注目した時のツールチップ）、`skillRuneUi.ts`（刻印符所持一覧の描画）、`synergyUi.ts`（流れタブの描画）、`chainUi.ts`（直近の連鎖の表示）、`questUi.ts`（依頼 3 択の描画）、`codexUi.ts`（図鑑・依頼一覧・実績の共通タブ画面の描画）、`detailPane.ts`（装備画面の右の固定の詳細欄。要点 / 詳しく / 操作）、`inventoryHelp.ts`（装備画面の ？ のヘルプ。操作説明・仕組みの説明はここに置き、画面に常時出さない）
- audio: `sfxNames.ts`（`SFX_NAMES`）、`sfxLayers.ts`（層を並べて作る効果音 `LAYERED_SFX`。`layers.ts` が鳴らす）、`sfx.ts`（個別合成 `SFX_DEFINITIONS`）、`synth.ts`、`music.ts`（曲の表 `TRACKS`・`pickTrack`）、`cues.ts`（main.ts が state の変わり目を拾って鳴らす効果音。依頼の達成など）
- meta（図鑑・依頼・実績。ラン中の記録はゲーム進行に効かない）: `codex.ts` / `codexStore.ts`（図鑑の定義・集計・永続化）、`quests.ts` / `questStore.ts`（依頼（`QUEST_KEYS`、32 種）の定義・進行判定・永続化）、`achievements.ts`（実績（`ACHIEVEMENTS`、41 種）と称号）、`runRecord.ts`（`state.codexRun` / `questRun` へラン中の出来事を積む記録係。`system/runEvents.ts` から呼ぶ）、`listScreen.ts` / `screens.ts`（図鑑・依頼一覧・実績の共通タブ画面の状態とレイアウト）、`links.ts` / `linkParts.ts` / `linkHint.ts`（連携の発見と手がかり枠。スキルの連携・状態異常の反応・ルールの連鎖を 1 つの「発見」として扱う）、`hub.ts`（拠点の成長: 建っている設備と飾りを既存の保存データから導く）、`hubStore.ts`（拠点の既読）、`storage.ts`（メタ進行の保存の共通部分）、`lockedRelicKeys` などの補助関数
