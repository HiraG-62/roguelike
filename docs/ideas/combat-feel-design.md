# 戦闘面の診断と設計（武器種・コンボ・爽快感）

作成日: 2026-09-24（architect）
前提: `memo/20260924-1.md`「いずれやりたい / 戦闘面」、`src/data/weapons.ts`、`src/data/tuning.ts`（PLAYER / FEEL / ACTION / WEAPON / LOOT_DROP / JOB / HUB）、`src/loot/bases.ts`、`src/loot/generator.ts`、`src/loot/stats.ts`、`src/data/jobs.ts`、`src/system/jobs.ts`、`src/system/player.ts`、`src/system/combat.ts`、`src/system/enemies.ts`、`src/system/camera.ts`、`src/system/effects.ts`、`src/system/hub.ts`、`src/map/hubMap.ts`、`src/meta/hub.ts`、`src/ui/hubFlow.ts`、`src/render/renderer.ts`、`src/render/renderMath.ts`、`src/render/hubUi.ts`、`src/data/sprites.ts`、`src/audio/sfxLayers.ts`、`src/skills/forms.ts`、`src/skills/actions2.ts`、`src/qa/report.md`、`docs/COMBAT_DESIGN.md` A-7、`docs/ideas/meta-and-weapons.md` 1〜2 章、`docs/ideas/hub-design.md` を読んだ。コードは編集していない。

## 1. 結論

**武器種 10・派生 22・段ごとの手触りは「データとしては」揃っているが、実プレイでは (a) 剣以外にほぼ触れず、(b) 触れても画面上で剣と区別がつかず、(c) 当てた手応えが数字として小さい。** この 3 つが「完了しているように見えない」の正体で、武器種を増やしても解消しない。

- (a) 導線: 最初の武器は「無し（= 剣の型）」。ジョブも拠点も武器を渡さない。ドロップは 6 スロット一様で武器は 1/6、しかも itemLevel 1〜2 で出る武器ベースは短剣・小剣（どちらも剣）だけ。QA では 1 ラン平均拾得 3.8〜11.6 個・depth 3 到達 62.8% なので、**1 ランで剣以外の武器種に触れる期待値は 0〜1 種**。
- (b) 見た目: プレイヤーのスプライトには剣が固定で描き込まれ、武器で変わらない。斬撃スプライトは `slash1〜3` の 3 枚を全武器種で共用（5 段の武器でも 2〜4 段目は同じ絵）。武器種ごとの違いは「薄い当たり判定の縁取り（α 0.35）」と「1〜4 px の軌跡」だけ。攻撃モーション（予備動作・振り・戻し）のフレームが無く、派生が成立しても名前も出ない。
- (c) 手触り: ヒットストップ軽 2 ステップ（33 ms）/ 重 5（83 ms）、揺れ 2〜5 px、怯んでいない敵へのノックバックは ×0.45 で減衰 12/s → 剣 1 段目で敵は約 5 px しか動かない。recover は先行入力でも短縮されず、カメラは追従のみ（攻撃方向のキックなし）。

**推奨（1 案）**: 「最初から武器を手に持たせ、武器が画面に見え、当てた瞬間が体に響く」を 4 レーンで入れる。A 導線（ジョブの初期武器・拠点の武器掛け・序盤ベースの解禁）→ B 武器種 6 + 射撃 3 + ジョブ固有の派生 → C 見た目（手に持つ武器・形ごとの斬撃絵・段のポーズ）→ D コンボの可視化と爽快感の数値パッケージ。B は A・C・D と独立に進められるが、**ユーザーの体感を変える順は A → D → C → B**。

---

## 2. 診断（根拠。行番号付き）

### 2-1. 手に入る経路（武器種は装備ベース経由だけ）

- 武器種の決定は `src/loot/stats.ts:259` の `stats.moveset = (weapon ? baseDef(weapon.baseKey)?.moveset : undefined) ?? DEFAULT_MOVESET`。武器スロットが空なら剣。射撃の型も同様（`:260`）。
- 初期装備は無い。`src/main.ts:183` の `loadProfile()` は空の装備で始まり、`src/core/game.ts:49` はそれをそのまま `computeStats` する。`src/system/jobs.ts:68-77` の `startJob` が渡すのは **スキル石だけ**（`starterSkill`）。ジョブの `favored`（`src/data/jobs.ts:41`）は `src/system/jobs.ts:46-47` で威力 ×1.1・攻撃速度 ×1.08 を掛けるだけで、武器を渡さない。
- 起点（`src/system/runSetup.ts:40-76`）にも武器を渡すものは無い（「素手」は逆に封印する）。
- 拠点の台は `src/map/hubMap.ts:5` の 9 種（井戸・掲示板・鍛冶場・図書館・祭壇・庭・記録室 3 台）で、武器を試す・持ち出す台は無い。祭壇の「試している誓約は拠点を出ると消える」（`src/system/hub.ts:270` の `setTrialKeystone`）が、武器掛けの雛形になる。
- ドロップのスロットは `src/loot/generator.ts:401-403` の `rollSlot` = `rng.pick(SLOTS)`（6 スロット一様）。ベースは `:405-409` の `rollBase` = `basesForSlot(slot, itemLevel)` から一様。`src/loot/bases.ts:26-50` の武器ベースの `minLevel` は 短剣 1 / 小剣 1 / 鉈 3 / 手甲 3 / 双短刀 3 / 棍 4 / 長剣 5 / 刺突剣 5 / 杖 5 / 小鎌 5 / 双剣 6 / 鞭 6 / 打刀 6 / 槍 7 / 鉄拳 8 / 錫杖 9 / 大剣 10 / 鎖鞭 10 / 大鎌 11 / 矛槍 11 / 水晶杖 11 / 斬馬刀 12 / 戦鎚 13。itemLevel は `depth + rng(0..2)`（`LOOT_DROP.itemLevelSpread`、`src/data/tuning.ts:929`）。
- QA（`src/qa/report.md:17-24, 124-133`）: 平均拾得 3.8（empty）〜 11.6 個 / run、depth 2 到達 96.7%・depth 3 62.8%・depth 4 22.8%。武器は 1/6 なので **1 ラン 0.6〜1.9 本**、そのうち itemLevel ≤ 4 で剣以外になり得るのは 鉈・手甲・双短刀・棍 のみ。大剣・大鎌・槍・鞭・杖は depth 4〜9 に届く 1〜2 割のランでしか候補に入らない。
- 変身スキル（`src/skills/actions2.ts:730-749` の `startForm` / `setMoveset`、`src/skills/forms.ts:110` の `shapeMoveset`）は武器種を一時的に差し替える既存の仕組みで、拠点の「試す」の実装パターンとしてそのまま使える。

### 2-2. 見た目（武器で見分けがつかない）

- プレイヤーは `src/render/renderer.ts:1779` で `SPR.player` 1 種を描く。`src/data/sprites.ts:1599-1616` の player フレームには右手の剣（列 13〜14 の `1` / `s` / `S`）が **描き込まれている**。武器種で差し替わらない。
- 攻撃中の絵は `src/render/renderer.ts:1870-1894` の `drawSlash`: `SLASH_KEYS = ["slash1","slash2","slash3"]`（`:131`）を `p.attack.combo`（`hookCombo` で 0 / 1 / 2 に丸めた値。`src/system/player.ts:228-231`）で選ぶ。つまり 4〜5 段の武器でも途中の段は全部 `slash2`。斬撃の絵は `src/data/sprites.ts:2135-2161` の 24x24 の三日月 1 種類で、突き・円・扇でも同じ形を回転して描く。
- 武器種ごとの違いは `drawMeleeShape`（`:1897-1928`。当たり判定の縁取り、α = `MELEE_SHAPE_ALPHA` 0.35 × 残り時間）と `drawSwingTrail`（`:1934-1969`。太さは `src/render/renderMath.ts:387-398` の `WEAPON_TRAIL_WIDTH` 1〜4 px、色は近接の属性色。tuning の `step.trail` の色は `spawnTrail`〔`src/system/player.ts:825-834`〕の線 1〜3 本にしか使われていない）。
- 攻撃のポーズが無い: `drawPlayer`（`:1776-1811`）はスプライトを windup / active / recover で変えない（被弾の squash と ダッシュの stretch だけ）。予備動作の「溜め」も振り切りの「伸び」も体に出ない。
- 派生: `startBranch`（`src/system/player.ts:694-699`）→ `beginSwing` は浮き文字も専用の効果音も出さない（音は段の `SLASH_SFX[combo]` と武器種の振り音のみ）。派生名（`BRANCH_NAMES`、`src/data/weapons.ts:200-223`）は装備画面の説明文にしか出ない。HUD にも「いま何段目か」「次に右を押すと何が出るか」は無い（`src/render/renderer.ts:2112-2119` のコンボ表示はヒット数と倍率だけ）。

### 2-3. 手触りの実数と、HADES 系との差

| 項目 | いまの値 | 根拠 | 差 |
| --- | --- | --- | --- |
| ヒットストップ | 軽 2 / 重 5 / 撃破 4 ステップ（33 / 83 / 67 ms）。`hitstop` は「最大値の上書き」で重ならない | `FEEL`（`src/data/tuning.ts:951-953`）、`src/system/effects.ts:155-157`、`src/system/combat.ts:242-244` | HADES は通常 ~50 ms、重撃 ~100〜150 ms。軽が短く、最終段と撃破の差が付いていない |
| 画面揺れ | 軽 2 / 重 5 px、減衰 22 px/s、方向なしの乱数 | `FEEL.shakeLight/Heavy`、`src/system/camera.ts:22-27` | 攻撃方向へのキック（camera kick）が無い。揺れが `state.rng` を消費している（`camera.ts:25-26`。決定性は保つが演出がゲーム乱数列を動かす） |
| ノックバック | 怯んでいない敵は ×0.45（`POISE.knockbackUnstaggered`、`:500`）、減衰 `KNOCK_DECAY = 12`（`src/system/enemies.ts:106`）。移動距離 ≈ 力 × 倍率 / 減衰 → 剣 1 段目 140 → **約 5 px**、3 段目 320（怯む）→ 約 27 px | `src/system/combat.ts:186-187`、`enemies.ts:428-440` | 1〜2 段目で敵が「押される」感触がほぼ無い。壁叩きつけ（`enemies.ts:452-464`）は heavy 段限定 |
| 敵の被弾表現 | 白点滅 0.09 s（`ENEMY_HIT_FLASH`、`combat.ts:31`）、粒 `LIGHT/HEAVY_PARTICLES`、数字 | `showHit`（`:233-246`） | 白点滅は十分。方向のある「弾き」の粒はあるが敵自身は動かない |
| 先行入力と振りの短縮 | active / recover 中に押すと `buffered = true`（`player.ts:609`）だが、次段は **recover が終わってから**（`updateAttack :751-765` → `endSwing :769`）。`PLAYER.bufferWindow`（`tuning.ts:37`）は **どこからも参照されていない** | `src/system/player.ts` | 連打しても振りの間隔が縮まらない。HADES / Nuclear Throne はリカバリーの後半を次段でキャンセルできる |
| キャンセル | ダッシュで攻撃・溜め・予約派生を即キャンセル（`tryDash :499-502`） | 良い。維持する | — |
| 踏み込み | `lunge` 3〜30 px（`applyLunge :804`）。剣の通常段は **0**（`PLAYER.melee` に lunge が無い） | `tuning.ts:29-33` | 基準線の剣に踏み込みが無いので、比較対象そのものが平坦 |
| 撃破 | 粒 18+6、`+score`、hitstop 4、shake 5、効果音 `kill`（440/660/880 のアルペジオ + ノイズ） | `killEnemy`（`combat.ts:254-278`）、`src/audio/sfx.ts:179` | 撃破の hitstop が最終段（5〜8）より軽い。死骸の演出は `spawnDeathFx` 9 種があり十分 |
| 効果音 | 段の `slash1〜3` + 武器種の振り音（`sfxLayers.ts:21-60`。peak 0.06〜0.41、40〜280 ms）+ `hit`（矩形波パルス + ノイズ）/ `hitHeavy`（85 Hz 240 ms） | `src/audio/sfxLayers.ts`、`src/audio/sfx.ts:337-369` | 命中音に低域の「ドン」が無い（`hitHeavy` にはある）。最終段・派生に固有の音が無い |
| カメラ | プレイヤー中心へ指数追従（`FOLLOW_RATE = 10`）のみ | `src/system/camera.ts:9-20` | 照準方向の先読みも攻撃方向のキックも無い |
| 最終段の演出 | 白い残像（`SLASH_AFTERIMAGE`）と hitstop 5〜8、shake 3〜5 | `renderer.ts:1886-1890` | 「終撃」を告げる音・文字・画面の一瞬の明滅が無い |

### 2-4. 基本攻撃はジョブで変わるか

- 変わらない。ジョブが触るのは `applyJobStats`（`src/system/jobs.ts:35-47`。ステータスの偏りと得意武器の倍率）と `rules`（`src/data/jobs.ts:100-110` など。命中・撃破・見切りの追加効果）。左右の役割・段・派生は武器ベースだけが決める（`MovesetDef.primary/secondary`、`src/data/weapons.ts:125-126`）。
- 「ジョブで基本攻撃が変わる」を武器種と両立させる最小の形は、**ジョブが (1) 初期武器を渡す、(2) どの武器種にも 1 本ずつ固有の派生（`BranchDef`）を足す** の 2 つ。`playerMoveset`（`src/system/player.ts:218-220`）が変身の型を装備より先に読む構造なので、ジョブの派生もここで合成できる。

---

## 3. 設計（推奨 1 案）

### 3-1. 方針

1. **武器は最初から手にある**: ジョブを選んだ瞬間に得意武器 1 本が手に入る（未所持のときだけ。`starterSkill` と同じ運用）。拠点の武器掛けで全武器種・全射撃の型を木人で試せ、「借りて」出撃できる（性質なしの素の器。ランが終わると消え、倉庫を膨らませない）。序盤の itemLevel でも各武器種に 1 つはベースが出る。
2. **武器は画面に見える**: プレイヤーの手に武器種ごとのスプライトが乗り、段（windup / active / recover）でポーズが変わる。斬撃の絵は形（箱・扇・突き・円）ごとに分け、最終段は一回り大きい。
3. **当てた瞬間が響く**: ヒットストップ・揺れ・ノックバックの基準値を上げ、攻撃方向へのカメラのキック、リカバリー後半の次段キャンセル、最終段・派生の固有の音と文字を入れる。数値はすべて tuning。
4. **コンボは読める**: HUD に「武器名 / 段のピップ / 次に押すと出る派生」を出し、派生が成立した瞬間に名前を浮かせる。
5. **武器種の固有効果は統一ルール文法で書く**: `MovesetDef.rules?: readonly Rule[]` を足し、ジョブの `rules` と同じ経路（`collectRules`）で合流させる。新武器の「戦鎚は最終段で衝撃波」「斧は出血中の敵に怯み値」などをロジック分岐なしで書ける。

### 3-2. 却下した案（1 行ずつ）

- ドロップのスロット重みで武器を厚くする: `rollSlot` の乱数消費が変わって seed 依存テストが全部ずれる上、ドロップ数は別レーンで調査中（HANDOFF 2 章）。初期武器と武器掛けで足りる。
- 武器掛けから永続の武器を持ち出す: 倉庫が無料の器で膨らみ、「永続装備は拾ったものだけ」の設計を崩す。借り物（ラン終了で消える）にする。
- ジョブが左右の役割そのものを差し替える: 武器種と二重の定義になり、装備画面の説明が嘘になる。ジョブは武器を渡し、派生を 1 本足すに留める。
- 弓を武器スロットの武器種にする: 溜めの遠距離は銃スロットの `charge` 型（火縄銃・手砲）が既に担う。射撃の型を増やす方が安い。
- カメラのズーム: `Renderer` の transform（DPR）に手が入り、ミニマップ・HUD の座標系まで波及する。キック（数 px の平行移動）で足りる。
- 攻撃フレームを描画側の変形（squash / stretch）だけで済ませる: 剣を持った 1 枚絵を伸縮しても「振っている」ようには見えない。ポーズ 2 枚は pixel-artist に頼む価値がある。

---

## 4. レーン A: 武器を体感できる導線（implementer: Sonnet、ドット絵不要）

### 所有ファイル
- 変更: `src/data/jobs.ts`、`src/system/jobs.ts`、`src/system/jobs.test.ts`、`src/loot/bases.ts`、`src/loot/bases.test.ts`（無ければ新規）、`src/loot/generator.ts`、`src/loot/generator.test.ts`、`src/system/hub.ts`、`src/system/hub.test.ts`、`src/map/hubMap.ts`、`src/meta/hub.ts`、`src/meta/hub.test.ts`、`src/ui/hubFlow.ts`、`src/ui/hubFlow.test.ts`、`src/render/hubUi.ts`
- 最小 Edit のみ: `src/loot/types.ts`（Item に 1 フィールド）、`src/loot/profile.ts`（借り物を保存しない 1 行）、`src/main.ts`（武器掛けの画面。祭壇の写し）、`src/data/tuning.ts`（`JOB` / `HUB` に定数）、`docs/GLOSSARY.md`（武器掛け・借り物）

### A-1. ジョブの初期武器
- `src/data/jobs.ts`: `JobDef.starterWeapon: string | null`（`BASES` の key）。割り当て（得意武器の先頭に合わせる。剣は「無し」で得られるので剣士だけ打刀）:
  剣士 `katana` / 狩人 `whip` / 拳闘士 `gauntlets` / 盾持ち `machete` / 呪術師 `sickle` / 槍兵 `spear` / 術士 `wand` / 影 `twinDaggers` / 錬金術師 `staff` / 見習い `null`
- `src/system/jobs.ts`:
  ```ts
  /** そのベースの武器を 1 つでも持っているか（装着中・倉庫を問わない） */
  export function ownsWeaponBase(profile: Readonly<Profile>, baseKey: string): boolean;
  /** ジョブの初期武器を渡す。未所持のときだけ。武器スロットが空なら装着し、空でなければ倉庫へ（満杯なら渡さない） */
  export function startJobWeapon(state: GameState): void;
  ```
  種は `startJob` と同じく `state.seed ^ (WEAPON_SALT + JOB_KEYS.indexOf(job))`（`state.rng` を消費しない。他の乱数列をずらさない）。生成は `generateItem(createRng(seed), { slot: "weapon", baseKey, plain: true, itemLevel: 1, foundDepth: 1, now: Date.now() })`。
- `src/core/game.ts` は触らない代わりに、`startJob` の中から `startJobWeapon` を呼ぶ。**装着した場合は `applyStats(state, computeStats(profile.equipment))` を呼び直す**（`createGame` は `applyStats` の後に `startJob` を呼ぶ〔`src/core/game.ts:120, 126`〕ため）。リプレイのスナップショットは `beginRun` の `fromStartedGame` が `createGame` の後に取る（`docs/ideas/hub-design.md` 2 章）ので、装着済みの状態が記録される。
- `src/loot/generator.ts`: `GenerateOptions` に `baseKey?: string`（指定時は `rollBase` を呼ばない）と `plain?: boolean`（性質 0・余白は `rollMargin(rng, 0)`、implicit はベースの個性なので残す）。**省略時の乱数の引き方は一切変えない**（既存の `generator.test.ts` の固定値が守る）。
- tuning: `JOB.starterWeaponLevel: 1`。
- テスト（`src/system/jobs.test.ts`）:
  - 「ジョブの初期武器は得意な武器種のベースを指す」
  - 「初期武器は武器スロットが空なら装着され、stats.moveset がその武器種になる」
  - 「同じベースの武器を持っていれば初期武器を渡さない」
  - 「初期武器は state.rng を消費しない（渡す前後で rng の次の値が同じ）」
  - `src/loot/generator.test.ts`:「baseKey と plain を指定すると性質 0 でそのベースになる」「省略時の生成結果は従来と同じ」

### A-2. 序盤のベース解禁（`src/loot/bases.ts` の `minLevel` だけ）
- 目標: **すべての武器種・射撃の型に `minLevel ≤ 3` のベースが 1 つある**。
  手甲 3→1、鉈 3→2、双短刀 3→2、棍 4→2、小鎌 5→3、鞭 6→3、杖 5→3、刺突剣 5→3、大剣 10→4（斬馬刀は 12 のまま）。銃: 吹き矢 6→3、跳ね銃 5→3、喇叭銃 6→3、火縄銃 9→4、撒き菱筒 7→4。
- テスト（新規 `src/loot/bases.test.ts`）:「すべての武器種に minLevel 3 以下のベースがある」「すべての射撃の型に minLevel 4 以下のベースがある」「`basesForSlot("weapon", 3)` に 4 種類以上の武器種が含まれる」
- 注意: `rollBase` の候補配列が変わるので **seed 固定の生成テスト（`generator.test.ts` / `replay.test.ts` の装備スナップショット）がずれる可能性がある**。落ちたら期待値の更新ではなく、テストの意図（「同じ seed で同じ結果」）を守る形で直す。

### A-3. 拠点の武器掛け（試す + 借りる）
- `src/map/hubMap.ts`: `HUB_SPOT_KEYS` に `"rack"`、ASCII に `K`（木人 `D` の列の左、`#..K.............D...D...D...#` のように木人の近く）。`Record<HubSpotKey, …>` が型エラーで漏れを教える。
- `src/meta/hub.ts`: `FACILITY_KEYS` に `"rack"`（名前「武器掛け」）、`FACILITY_OF_SPOT.rack = "rack"`、`STARTER_FACILITIES` に加える（最初から建っている）。
- `src/system/hub.ts`:
  ```ts
  export interface HubRun { …; trialMoveset: MovesetKey | null; trialShot: ShotKey | null; }
  /** 試す武器種・射撃の型を差し替える（拠点を出ると消える）。null で装備のものに戻す */
  export function setTrialWeapon(session: HubSession, moveset: MovesetKey | null, shot: ShotKey | null): void;
  ```
  差し替えは `src/skills/actions2.ts:743-749` の `setMoveset` と同じ「`state.stats = { ...prev, moveset, shot }`」で、`stepHub` の先頭で毎ステップ `state.stats.moveset === trial` を確かめて差し直す（装備画面を開いて `applyStats` が走っても戻らないように。`updateForm :755-763` と同じ考え）。
  借りる:
  ```ts
  /** 素の器を借りて武器スロットに装着する。元の武器は倉庫へ（満杯なら断る）。借り物はランが終わると消える */
  export function borrowWeapon(profile: Profile, moveset: MovesetKey, now: number): Item | null;
  export function borrowGun(profile: Profile, shot: ShotKey, now: number): Item | null;
  ```
  ベースはその武器種の `minLevel` が最小のもの。`generateItem(createRng(HUB.seed ^ index), { …, plain: true, baseKey })`。
- `src/loot/types.ts`（最小 Edit）: `Item.loaned?: true`。`src/loot/profile.ts` の `saveProfile` は `loaned` の品を **書かない**（装備からも倉庫からも除いて保存。読み込みで自然に消える）。`src/main.ts` の `endRun`（`:745` 付近）で装備・倉庫から `loaned` を外す。装備画面の表示名に「（借り物）」を足すのは `src/loot/describe.ts` の 1 行。
- `src/ui/hubFlow.ts`: `HubOpen` に `{ kind: "rack" }`、`rackTabs(trialMoveset, trialShot): ListTab[]`（タブ「武器種」= `MOVESET_KEYS` を `name` / `desc` / 派生名で並べ、試しているものに `marked`。タブ「射撃の型」= `SHOT_KEYS`）。行の key は `moveset:<key>` / `shot:<key>`、`rackEntryOf(key)` で戻す。決定 = 試す、`借りる` は決定の長押し（`HUB.departHold` と同じ `latchedHold`）か別キー（`interactPressed`）。
- `src/render/hubUi.ts`: `SPOT_ACTION.rack = "武器を試す"`。出撃ゲージの横に「試し中: 大剣 / 散弾」「借り物: 大剣」を出す。
- `src/main.ts`: `screen` に `"rack"`。`openRack` / `updateRackFrame` は `openAltar`（`:640-666`）の写し。
- tuning: `HUB.rackBorrowHold: 0.6`。
- テスト:
  - `src/system/hub.test.ts`:「setTrialWeapon で stats.moveset / shot が差し替わり、null で装備のものに戻る」「装備画面を経由して applyStats が走っても試し中の武器種が保たれる」「borrowWeapon は素の器を装着し、元の武器を倉庫へ移す」「倉庫が満杯なら borrowWeapon は null を返し装備を変えない」
  - `src/loot/profile.test.ts`:「loaned の品は saveProfile で書かれない」
  - `src/ui/hubFlow.test.ts`:「武器掛けの一覧は全武器種と全射撃の型を並べ、試しているものに印を付ける」「rackEntryOf は moveset と shot の行を見分ける」
  - `src/meta/hub.test.ts`:「武器掛けは最初から建っている」

### 完了条件
- `npm run check` 通過。`src/core/replay.test.ts` が通る（初期武器は `state.rng` を使わず、拠点の借り物はスナップショットに入る）。
- ブラウザ: 剣士で出撃すると打刀を持って始まる。拠点の武器掛けで大剣を試すと木人への振りが大剣になり、借りて出撃 → 死亡後に拠点へ戻ると大剣が消えている。

---

## 5. レーン B: 武器種 6 種・射撃の型 3 種・ジョブ固有の派生（implementer: Sonnet。数値は balance-tuner が後で触る前提で仮置き）

### 所有ファイル
- 変更: `src/data/weapons.ts`、`src/data/weapons.test.ts`、`src/loot/bases.ts`（ベース追加行のみ。A-2 と同じファイルなので **A の後に着手**）、`src/loot/affixes.ts`（`IMPLICITS` 追加）、`src/system/player.ts`、`src/system/projectiles.ts`、`src/system/rules.ts`（`collectRules` に武器種の rules を合流）、`src/data/jobs.ts`（`branch`）、`src/render/renderMath.ts`（`WEAPON_TRAIL_WIDTH` に追加。`Record` なので必須）、`src/system/effects.ts`（`SWING_SFX` / `SHOT_SFX` に追加。`Record` なので必須）、`src/audio/sfxLayers.ts`（振り音 6・発射音 3）、`src/audio/sfxNames.ts`
- 最小 Edit のみ: `src/data/tuning.ts`（`WEAPON.movesets` / `WEAPON.shots` に節を足す）、`src/core/state.ts`（`Player.shotBurst` 1 フィールド、`Projectile` に `returning?` 1 フィールド）、`docs/GLOSSARY.md`。`src/system/boonDefsWave2.ts` は触らない（武器種の祝福は後続）

### B-0. 文法の拡張（先にやる。既存 10 種の挙動は変えない）
1. `MovesetDef.rules?: readonly Rule[]`（`src/data/weapons.ts`）。`src/system/rules.ts` の `collectRules` に `movesetRules(state)` を合流（`jobRules` と同じ場所。owner は `{ kind: "player", key: "moveset.<key>" }`、id は `ruleId(owner, index)`）。テスト:「武器種の rules は持っている武器種のものだけが集まる」。
2. `MeleeStepDef.applies?: readonly StatusApply[]`（`SkillDef.applies` と同じ型）。`meleeHitEnemy`（`src/system/player.ts:933`）の末尾で `applyStatus`。テスト:「applies を持つ段の命中で状態異常が付く」。
3. 溜めのボタンを役割から引く: `chargeButton(moveset): ButtonKey | undefined`（`primary` / `secondary` のうち `"charge"` の方）。`updateCharge`（`player.ts:640`）と近接入力の `charge` 判定を `meleeButton` から `chargeButton` に替える（既存の大剣は primary なので結果は同じ）。テスト:「右クリックが charge の武器種は右の長押しで溜まり、左は連撃」。
4. 両方 `shot` の武器種: `shotButtonHeld`（`player.ts:375-378`）を「`primary` / `secondary` のどちらかが shot でその押しっぱなし」に。`meleeButton` は undefined のまま。`weapons.test.ts` の「剣以外は 4〜5 段」を「近接の段を持つ武器種は 4〜5 段（steps が空なら射撃専用）」に緩める。
5. `JobDef.branch?: BranchDef`（`src/data/jobs.ts`）。`playerMoveset`（`player.ts:218`）で装備の型にジョブの派生を 1 本足した型を返す。毎ステップ新しいオブジェクトを作らないよう `Map<MovesetKey, MovesetDef>` をジョブごとに持つ（決定性に影響なし）。入力列は武器種の派生と重ならないよう **ジョブは 4 手（例: 左左左右）** に限定し、`branchesOf` と同じく長い列から照合。テスト:「ジョブの派生は装備の武器種の派生と衝突せず、長い列が先に一致する」。

### B-1. 武器種 6 種（役割が既存 10 種と被らないもの）

| key | 表示名 | ベース（slot weapon、minLevel） | 左 / 右 | 段 | 派生 | rules / applies | 何が新しいか |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `katana` | 刀 | `katana` 打刀（既存。moveset を sword → katana に付け替え）、新 `tachi` 太刀 8 | melee / **charge** | 箱 3 段の速い斬り（lunge 6/6/10）+ 4 段目 突き | 右長押し = 居合（`charge.step`: thrust reach 60 幅 14、levels 2 段 0.35 / 0.7 秒、damageMul 1.6 / 2.6、poiseMul 2 / 3）。派生: 左左右 燕返し（箱 hits 2）/ 右左 抜き打ち（→ 2 段目） | `onCounter → damageBuff 20% 2 秒`（居合をカウンターで当てる導線） | 「構えて一閃」。大剣の溜めが範囲なのに対し刀は線と見切り |
| `axe` | 斧 | 新 `handAxe` 手斧 2、`battleAxe` 戦斧 9 | melee / melee | 扇 120° 4 段（heavy は 4 段目だけ。knockback 220〜380） | 右 = 回転斬り（circle 50、hits 2、next 2）/ 左左右 = 断ち割り（箱 heavy） | 4 段目 `applies: [{ kind: "bleed", stacks: 2, duration: 4 }]`、`onMeleeHit if targetHas bleed → addPoise 10` | 「出血させて崩す」。鉈（壁）・大鎌（引き寄せ）と役割が分かれる |
| `shield` | 大盾 | 新 `towerShield` 大盾 3、`kiteShield` 騎士盾 10 | melee / melee | 箱 4 段（威力低・poise 12/12/14/24・knockback 大） | 右 = 盾押し（`["secondary"]`、lunge 26、heavy、next 1）/ 左左右 = 叩きつけ（circle） | `onMeleeHit → invuln 0.12 秒（icd 0.5）`（打ち込むと身が固まる） | 「押して壁へ、当てて堅く」。盾持ちの職と噛み合う |
| `chainSickle` | 鎖鎌 | 新 `kusarigama` 鎖鎌 3、`weightedChain` 分銅鎖 9 | melee / melee | 扇 100° 4 段の短い鎌（速い。attackMoveMul 0.6） | 右 = 分銅（`["secondary"]`、thrust reach 64 幅 10、`pull: true`、next 1）/ 左左右 = 巻き取り（circle、pull、hits 2） | `onMeleeHit if swingStep 0 and recent onMeleeHit within 0.5 → addPoise 8`（引いてから斬ると崩す。`recent` 条件は既存の `{ kind: "recent", event, within }`） | 「遠くから引いて、近くで刻む」。大鎌の引き寄せを「射程」に振った型 |
| `hammer` | 戦鎚 | `warpick` 戦鎚（既存。cleaver → hammer に付け替え）、新 `maul` 大槌 12 | charge / melee | 円 2 段 + 箱 heavy 2 段の 4 段（遅い。attackMoveMul 0.2） | 右 = 薙ぎ（arc 200、next 2）/ 左左右 = 地砕き（circle 60 heavy） | `onMeleeHit if finisher → shockwave（magnitude 0.6, scaleBy slashBase）`、`onMeleeHit if targetGuarded → addPoise 20` | 「怯ませる担当」。衝撃波は rules の既存効果で書ける |
| `gunner` | 二丁拳銃 | 新 `twinPistols` 二丁拳銃 4（slot weapon）、`twinRevolvers` 双回転式 11 | **shot / shot** | steps 空（射撃専用）。ダッシュ攻撃 = 反転撃ち（circle 36、hits 1） | 派生なし（branches 空）。左右は交互に撃ち、銃口の左右オフセット ±3 px を「最後に撃ったボタン」で交互に | `onRangedHit if nthRangedHit every 6 → energy 10`（手数で必殺。`nthRangedHit` が無ければ `nthMeleeHit` に倣って条件を 1 つ足す） | 「左右クリック両方で撃つ」。左近接・右射撃の縛りを外す最初の武器 |

- 数値は `WEAPON.movesets.<key>` に節を足す（既存と同じ形。`hits` / `hitstop` / `shake` / `lunge` / `trail` を全段に書く）。
- `desc` は「何ができるか」の 1 行（単一指標を出さない）。`keywords` は `kw(出す, 食う, 強める)` を必ず入れる（`weapons.test.ts:37` が検査）。
- `attack`: 刀 physical / 斧 physical / 大盾 physical / 鎖鎌 physical / 戦鎚 physical / 二丁拳銃 `attack("ranged", "physical")`。
- `weapons.test.ts:158-171` の「剣に劣るものが 1 つある」を新武器も通す（二丁拳銃は `steps` 空なので判定から除外する分岐を足す）。
- `IMPLICITS`: 太刀「居合の威力 +%」、戦斧「出血の持続 +」、騎士盾「防御 +」、分銅鎖「引き寄せ距離 +」、大槌「衝撃波の半径 +」、双回転式「6 発目が会心」（`PlayerStats` に新 stat が要るものは `loot/types.ts` の `DEFAULT_STATS` に追加。無理なら既存 stat の流用で可）。
- 既存ベースの付け替え（打刀 → 刀、戦鎚 → 戦鎚の型）は旧セーブの挙動を変えるが、`baseKey` は同じなので `migrate.ts` は不要。

### B-2. 射撃の型 3 種

| key | 表示名 | ベース（slot gun） | 中身 | 実装の要点 |
| --- | --- | --- | --- | --- |
| `burst` | 三点 | 新 `burstRifle` 三連銃 5 | 1 押しで 3 発を 3 ステップおきに撃つ。cooldownMul 1.8、damageMul 0.7 | `Player.shotBurst: { left: number; timer: number }`（`core/state.ts` 最小 Edit）。`tryShoot` が押した瞬間に left = 3 を立て、射撃の更新が timer ごとに 1 発ずつ出す。押しっぱなしでは次のバーストまで待つ |
| `boomerang` | 回転刃 | 新 `chakramReturn` 返しの円月輪 7（既存の円月輪は跳弾のまま） | 弾が射程の端で反転して手元へ戻り、行きと帰りで当たる。pierceBonus 99、lifeMul 1.4 | `Projectile.returning?: true`。`updateProjectiles` で life が半分を切ったら速度をプレイヤー方向へ毎ステップ寄せ、プレイヤーに触れたら消す（当てた敵の記録は反転時に空にして帰りでもう一度当てる） |
| `lob` | 曲射 | 新 `mortar` 曲射筒 6 | 照準の距離まで山なりに飛び、着弾で爆発（`spawnBomb` を流用、fuse 0）。cooldownMul 2.2、damageMul 2 | 射程は照準までの距離（`input.aimScreen` → 世界座標。無ければ `PLAYER.shoot.life × speed`）。弾は描画用に `pr.arcHeight` を持ち、当たり判定は着弾時だけ（飛行中は敵に当たらない） |

- `SHOT_TYPES` に `keywords` / `attack`（すべて ranged physical）を付ける。`effects.ts` の `SHOT_SFX` と `sfxLayers.ts` に発射音 3 つ（`shotBurst` / `shotBoomerang` / `shotLob`）。
- テスト（`src/data/weapons.test.ts` / `src/system/projectiles.test.ts`）:「三点は 1 押しで 3 発が 3 ステップおきに出る」「回転刃は寿命の半分で反転して手元へ戻り、行きと帰りで同じ敵に当たる」「曲射は照準の距離で爆発し、飛行中は敵に当たらない」

### B-3. ジョブ固有の派生（B-0 の 5 を使う）
剣士 左左左右「燕返し」（箱 hits 2 heavy）/ 狩人 左左左右「射抜き」（thrust reach 50）/ 拳闘士 左左左右「猛連打」（hits 5）/ 盾持ち 左左左右「盾殴り」（heavy knockback 380）/ 呪術師 左左左右「呪い刃」（`applies: weaken`）/ 槍兵 左左左右「穂先返し」（thrust、tip 倍率）/ 術士 左左左右「魔力放出」（circle 48）/ 影 左左左右「影縫い」（`applies: vulnerable`）/ 錬金術師 左左左右「反応刃」（circle、`applies: burn` 弱）。数値は `JOB.branches.<job>`。テスト:「すべてのジョブ（見習い以外）が固有の派生を持ち、表示名が登録済み」。

### 完了条件
- `npm run check` 通過。`skills.test.ts` の `FORBIDDEN` は触らない（武器種はスキルの相性表に関与しない）。
- `docs/COMBAT_DESIGN.md` A-7 の表に 6 種・3 型を追記（implementer が同じ PR で）。

---

## 6. レーン C: 武器ごとの見た目（pixel-artist: Opus でスプライト、implementer: Sonnet で描画）

### 所有ファイル
- pixel-artist: `src/data/sprites.ts`（`SPRITES` に追加。**player フレームの剣の画素（列 13〜14 の `1` / `s` / `S`）を消す**）、`src/render/sprites.test.ts`
- implementer: `src/render/renderMath.ts`、`src/render/renderMath.test.ts`、新規 `src/render/weaponUi.ts`
- 最小 Edit のみ: `src/render/renderer.ts`（`drawPlayer` から `drawHeldWeapon` を呼ぶ 2 行、`drawSlash` の `SLASH_KEYS` を形ごとの表に差し替え）、`src/render/sprites.ts`（アトラス登録が必要なら）

### C-1. 手に持つ武器のスプライト
- `SPRITES.weapon_<MovesetKey>`（16 種。既存 10 + B の 6）。**12x12、右向き、持ち手を左下 (2, 9) に置く**（回転の軸）。刀 = 細く長い、大剣 = 太く長い、双剣 = 2 本の短い刃、槍 = 12 px いっぱいの穂、大鎌 = 曲がった刃、拳 = 手甲（小さい）、鞭 = 巻いた縄、鉈 = 幅広、棍 = 棒、杖 = 先端に珠、斧 = 片刃、大盾 = 盾板（正面）、鎖鎌 = 小鎌 + 分銅、戦鎚 = 頭の大きい槌、二丁拳銃 = 2 挺の拳銃。
- `SPRITES.slashArc`（32x32 の広い三日月）、`slashThrust`（24x8 の線）、`slashRing`（32x32 の環）。既存 `slash1〜3` は箱用として残す。
- `render/sprites.test.ts` に「全武器種の weapon_ スプライトがあり 12x12」「形ごとの斬撃スプライトがある」。

### C-2. 段のポーズ（`src/render/renderMath.ts`、純関数でテスト可能）
```ts
export type SwingPhase = "idle" | "windup" | "active" | "recover";
export interface WeaponPose { angle: number; dx: number; dy: number; scale: number }
/**
 * 手に持つ武器の向きと位置。idle は肩に構える。windup は攻撃方向の逆へ引く（予備動作）、
 * active は形ごとに振る（arc: from→to の弧、thrust: 前へ突き出す、box: 上から下へ、circle: 一周）、recover は前で止まってから戻る
 */
export function weaponPose(phase: SwingPhase, t: number, shape: HitShape["kind"], facing: Vec, combo: number): WeaponPose;
```
- `t` は各 phase の進み（0→1）。`combo % 2` で弧の向きを交互に（`drawSwingTrail :1957` と同じ規則）。
- テスト:「windup は攻撃方向の逆へ引き、active の終わりで攻撃方向を向く」「arc は段が偶数と奇数で振る向きが反転する」「thrust は active で前へ伸び recover で戻る」。
- `src/render/weaponUi.ts`: `drawHeldWeapon(ctx, state, sprites, cx, cy, flip)`。`drawPlayer` の本体の直後（斬撃の前）に呼ぶ。二丁拳銃は左右に 1 挺ずつ。溜め中（`p.attack.charging`）は windup の姿勢で止め、段が上がるごとに `WEAPON.chargeRingColors` で刃を染める。

### C-3. 斬撃の絵を形と段で選ぶ（`renderer.ts` の `drawSlash` 最小 Edit）
- `SLASH_KEYS` を `slashKeyFor(shape, combo, finisher)`（`renderMath.ts`）に。箱 = `slash1/2/3`、扇 = `slashArc`、突き = `slashThrust`、円 = `slashRing`。最終段（`hookCombo === 2`）は scale ×1.3、既存の白い残像に加え **1 フレームだけ全体を白で描く**（`sprite.white`）。
- `drawSwingTrail` の色を `ELEMENT_FX_COLOR` から「`step.trail` があればそれ、無ければ属性色」に（tuning の色が初めて画面に出る）。

### C-4. プレイヤーの予備動作と伸び（`drawPlayer` 最小 Edit）
- windup: `sx 0.92 / sy 1.08` + 攻撃方向の逆へ 1 px。active: `sx 1.12 / sy 0.9`。recover: 補間で戻す。定数は `renderer.ts` の既存 `SQUASH_*` の並びに `SWING_*` を足す。
- 本命は pixel-artist の **攻撃ポーズ 2 フレーム**（`SPRITES.playerSwing`: 引き / 振り抜き）。あれば `drawPlayer` が phase で選ぶ。無くても C-2 の武器スプライトの回転だけで「振っている」ように見えるので、2 フレームは第 2 弾でよい。

### 完了条件
- `npm run check` 通過（`sprites.test.ts` の寸法・パレット検査）。
- ブラウザ: 武器掛けで 16 種を順に試し、持っている武器が手元で見分けられ、扇・突き・円で斬撃の絵が変わる。剣を外した player フレームで違和感が無い。

---

## 7. レーン D: コンボの可視化と爽快感パッケージ（implementer: Sonnet。数値は tuning に集約）

### 所有ファイル
- 変更: `src/data/weapons.ts`（`branchHints` 純関数）、`src/data/weapons.test.ts`、新規 `src/render/comboUi.ts`、新規 `src/render/comboUi.test.ts`（純関数は `renderMath` 側でも可）、`src/system/player.ts`、`src/system/actionFeel.test.ts`、`src/system/camera.ts`、`src/system/camera.test.ts`、`src/system/combat.ts`（`showHit` / `killEnemy` の hitstop・shake の参照先。共有ファイル扱いなので最小 Edit）、`src/system/enemies.ts`（`KNOCK_DECAY` を tuning へ）、`src/audio/sfxLayers.ts`、`src/audio/sfxNames.ts`
- 最小 Edit のみ: `src/data/tuning.ts`（`FEEL` / `PLAYER` / `POISE` / `ENEMY_AI`）、`src/core/state.ts`（`Camera.kick: Vec`、`Player.swingImpact: number`）、`src/render/renderer.ts`（`drawComboHud` の呼び出し 1 行、`drawPlayer` の impact 伸び 3 行）

### D-1. コンボの可視化
- `src/data/weapons.ts`:
  ```ts
  export interface BranchHint { button: ButtonKey; name: string }
  /** いまの入力列に 1 手足すと成立する派生（左右それぞれ最長一致）。HUD の「次に押すと」に使う */
  export function branchHints(moveset: MovesetDef, inputs: readonly ButtonKey[]): BranchHint[];
  ```
  テスト:「剣で左左の後は右に十字断ちが出る」「右の後は左に踏み込み斬りが出る」「一致する派生が無ければ空」。
- `src/render/comboUi.ts`: `drawComboHud(ctx, state)`。位置は画面下中央（スキル HUD の上）。内容 = 武器名（`MOVESETS[state.stats.moveset].name`）、段のピップ（`steps.length` 個。`p.attack.step` まで塗る、最終段は大きい点）、`branchHints` の「右: 十字断ち」を小さく。文字は `drawText`（`TEXT.SMALL`）。派生の名前は `p.attack.branch >= 0` の間、段のピップの代わりに派生名を出す。
- 派生成立の合図: `startBranch`（`player.ts:694`）で `addFloatingText(state, p.body.pos, branch.name, COLOR_BRANCH, FEEL.branchTextScale, FEEL.branchTextLife)` と `pushSfx(state, "branch")`（`sfxNames` / `sfxLayers` に追加: 短い上昇の 2 音）。最終段（フィニッシュ派生と武器種の最終段）の命中では `pushSfx("finisherHit")`（低域 55 Hz 0.16 s + 高域の刃音の 2 層）。
- tuning: `FEEL.branchTextScale: 1.2`、`FEEL.branchTextLife: 0.6`、色は `ACTION.counter.color` と被らない `#c0e8ff`。

### D-2. 爽快感の数値（すべて `src/data/tuning.ts`。変更前 → 後）
| 定数 | 前 | 後 | 理由 |
| --- | --- | --- | --- |
| `FEEL.hitstopLight` | 2 | 3 | 33 → 50 ms。1〜2 段目に「当たった」間を作る |
| `FEEL.hitstopHeavy` | 5 | 7 | 83 → 117 ms |
| `FEEL.hitstopKill` | 4 | 6 | 撃破が通常の重撃より軽かった |
| `FEEL.hitstopFinisher`（新） | — | 9 | 武器種の最終段・フィニッシュ派生の命中。`showHit` で `hookCombo === 2` のとき `max(base, hitstopFinisher)` |
| `FEEL.shakeLight` / `shakeHeavy` | 2 / 5 | 2.5 / 6 | 揺れは控えめに。キックで方向を出す |
| `FEEL.kickHeavy`（新） | — | 4 | 重撃・撃破で攻撃方向へカメラを 4 px 押し、`FEEL.kickDecay` 30/s で戻す（D-3） |
| `POISE.knockbackUnstaggered` | 0.45 | 0.7 | 1 段目で敵が 5 → 8 px 動く。密着崩しの副作用は QA の 1 対 1 被弾で見る |
| `ENEMY_AI.knockDecay`（新。`enemies.ts:106` の `KNOCK_DECAY` を移す） | 12 | 9 | 距離 = 力 × 倍率 / 減衰。剣 3 段目 320/9 ≈ 36 px（前 27） |
| `PLAYER.melee[*].lunge`（剣の基準線） | 無し | 4 / 4 / 8 | 剣だけ踏み込みが無く平坦だった。`weapons.test.ts` の固定値は威力のみなので影響なし |
| `PLAYER.recoverCancel`（`bufferWindow` を改名して使う） | 0.35（未使用） | 0.5 | recover の残り 50% を先行入力で次段にキャンセル（D-4） |
| `FEEL.swingImpact`（新） | — | 0.08 | 命中時にプレイヤーを攻撃方向へ伸ばす秒（D-5） |
- 変更は 1 度に入れず、**A と一緒に入れて実プレイで見る → balance-tuner が半分ずつ寄せる**。

### D-3. カメラのキック（`src/system/camera.ts`）
- `Camera.kick: Vec`（`core/state.ts` 最小 Edit、初期値 `{0,0}`。`createGame` / `createHub` の生成箇所 2 か所）。`kick(state, dir, amount)` を `effects.ts` に足し、`showHit`（heavy）・`killEnemy`・`wallSplat` から呼ぶ。`updateCamera` で `cam.offset += cam.kick`、`cam.kick *= exp(-FEEL.kickDecay * dt)`。
- 同時に **揺れの乱数を `state.rng` から `fxRandom(state)`（`effects.ts:57`）に替える**。演出がゲームの乱数列を動かさなくなる。**seed 依存のテストがずれる可能性がある**（揺れの発生ステップで rng の消費が減る）。落ちたら意図を守る形で直す。
- テスト（`camera.test.ts`）:「キックは攻撃方向へ offset を動かし減衰で 0 に戻る」「揺れの間に state.rng の次の値が変わらない」。

### D-4. リカバリーのキャンセル（`src/system/player.ts`）
- `updateAttack`（`:734`）の recover 中: `a.buffered && next !== undefined && a.timer <= step.recover * PLAYER.recoverCancel` なら `endSwing` を前倒しで呼ぶ（次段へ）。派生の予約（`pendingBranch`）も同じ条件で前倒し。最終段（`next === undefined`）は前倒ししない（`comboLockout` を守る）。
- 段ごとに変えたければ `MeleeStepDef.cancel?: number`（省略は `PLAYER.recoverCancel`）。双剣・拳のように既に速い型は 0.3、大剣・鉈は 0.6 が目安。
- テスト:「recover の後半に先行入力があると次段が前倒しで始まる」「最終段の後は前倒しされず comboLockout が効く」「ダッシュはこれまでどおり任意のタイミングで攻撃を切る」。

### D-5. 命中の手応え（プレイヤー側）
- `Player.swingImpact: number`（`core/state.ts` 最小 Edit）。`meleeHitEnemy` で `FEEL.swingImpact` を立て、`tickTimers` で減らす。`drawPlayer` は `swingImpact > 0` の間、攻撃方向へ `sx 1.15`（`DASH_STRETCH_X` と同じ規則で向きを掛ける）。
- 撃破時: `killEnemy` の粒 `spawnBurst` に加えて `spawnDirectional(state, pos, dir, color, 8, 220)`（攻撃方向へ飛ぶ破片。`knockDir` を `damageEnemy` から `killEnemy` へ渡す引数を 1 つ足す）。
- 効果音: `hit` に低域の層を足す（`sfxLayers.ts` に `hitThump`: sine 70 Hz 0.07 s peak 0.3。`damageEnemy :195` で `hit` と一緒に積む）。`hitHeavy` はそのまま。

### 完了条件
- `npm run check` 通過。`replay.test.ts`、`actionFeel.test.ts` が通る。
- ブラウザ: 剣で 3 段を連打したときの間隔が明らかに縮まり、3 段目で敵が壁まで飛ぶ。HUD に「剣 ●●○ 右: 十字断ち」が出て、右を押すと「十字断ち」が浮く。

---

## 8. 不確かな点（確認方法つき）

1. **初期武器の保存経路**: `startJob` は `createGame` の中で倉庫へ石を入れるが、プロファイルの保存は `src/main.ts:387, 728` の `saveProfile`（拾得時・ラン終了時）。初期武器を装着しても、そのランで何も拾わずタブを閉じると保存されない可能性がある。→ `beginRun` の直後に `saveProfile(profile)` を 1 回呼ぶ最小 Edit を A に含めるか、ブラウザで「出撃 → 即リロード」で確かめる。
2. **借り物の装備画面の扱い**: 残響（クラフト）が借り物に性質を付けられると「素の器を育てる」抜け道になる。`src/ui/echoTab.ts` が `loaned` を弾くか（1 行）を A で入れる。
3. **A-2 の `minLevel` 変更と seed 固定テスト**: `rollBase` の候補が増えるので `generator.test.ts` / `replay.test.ts` の装備スナップショット・`qa/simulation.test.ts` の固定値がずれ得る。`npx vitest run src/loot/generator.test.ts src/core/replay.test.ts` で先に確かめる。
4. **`knockbackUnstaggered` の副作用**: 0.45 は QA 2026-09-23 で「密着を崩す」ために上げた値（`tuning.ts:498-500`）。0.7 にすると敵が射程外へ逃げ、近接の 2 段目が空振りしやすくなる懸念。`npm run qa:full` の「1 対 1 被弾」と「怯み発生回数」で見る。
5. **`fxRandom` への切り替えで揺れの見た目が変わるか**: 分布は同じ一様乱数なので変わらないはずだが、`fxState` の seed の初期化がラン間で固定なら「同じ seed で同じ揺れ」になる（問題なし）。`effects.ts:50-63` を implementer が確認する。
6. **武器掛けの「借りる」入力**: 一覧画面（`meta/listScreen.ts`）は "activate" しか返さない（hub-design 5 章）。長押し検出は `latchedHold` で main.ts 側に書けるが、パッドの決定ボタンでも同じか（`departHold` と衝突しないか）。ブラウザとパッドで確認。
7. **二丁拳銃（gunner）と変身・砲身化**: `shapeLocksShot`（`player.ts:376`）は変身中に射撃を止める。両方 shot の武器種で変身したときの左クリックの挙動を `skills/forms.test.ts` に 1 件足して確かめる。
8. **回転刃の「帰り」の当たり判定**: 当てた敵の記録を反転時に空にする案は、貫通弾（`pierceBonus`）の既存の数え方と干渉する可能性。`projectiles.test.ts` の貫通テストを先に読む。
9. **QA bot は武器種を切り替えない**（`src/qa/bot.ts:60, 590-605` は大剣・杖の押し方だけ）。新武器の QA は「装備パターン」に武器種を混ぜる必要がある（HANDOFF 4-1 の指摘と同じ）。

## 9. ブラウザで確かめること（統合後）

- 拠点 → 武器掛け → 16 種を順に試す: 木人への振りで形（箱・扇・突き・円）が見分けられるか、派生の浮き文字が読めるか、二丁拳銃の左右交互が分かるか。
- 剣士で出撃 → 打刀を持って始まるか → 死亡 → 拠点 → 借り物が消えているか。
- 剣 3 段の連打の間隔（D-4）と、3 段目で敵が壁に当たる頻度（D-2）。
- 揺れ・キック・ヒットストップが「うるさい」か「気持ちいい」か（数値を半分ずつ寄せる前提）。
- リプレイ: 借り物で出撃したランのリプレイが正しく再生される（装備スナップショットに借り物が入っている）。
