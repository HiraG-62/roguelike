# 武器種 Wave 4: 爪・チェーンアレイ・チャクラム・扇子と、杖の魔法化（2026-09-25）

作成日: 2026-09-25
前提: `CLAUDE.md` / `docs/recipes/weapon.md` / `docs/COMBAT_DESIGN.md` A-7・A-8・A-10 / `docs/STATS_AND_SCALING.md` / `docs/ideas/ougi-and-dual-actions.md` / `docs/ideas/weapon-redesign.md` / `docs/GLOSSARY.md` を読み、`src/data/weapons.ts`（`MeleeStepDef` / `ActionStepDef` / `BranchDef` / `BulletDef` / `ThrowArtDef`）、`src/data/ultimates.ts`、`src/data/balance/weapons/WEAPON/movesets/*.json`（23 種）、`src/system/player.ts`（`emitVolley` / `resolveMeleeBullets`）、`src/system/weaponArts.ts`（`emitArtVolley` / `startLaneArt`）、`src/system/projectiles.ts`、`src/loot/bases.ts` / `bullets.ts` の実値を参照した。
今の実装の要点: 武器種は 23（近接 15 + 銃の家系 8）。左 = `steps: MeleeStepDef[]`（近接の振りだけ。弾は出せない）、右 = `steps2: ActionStepDef[]`（swing / hold / volley / charge / aim / recall）、段カウンタは左右共有、名前付き派生は 3 入力以上 × 4 本以上。弾は `BulletDef`（挙動ブロック sway / homing / bounce / charge / mine / burst / boomerang / lob）で、**弾は状態異常を付けられず、地形も残せない**（属性の親和 10% だけ）。近接の振りは祝福「弾返し」か性質「弾斬り」（`stats.bulletCut`）があるときだけ敵弾に触る。
凡例: コスト S = 数時間 / M = 1〜2 日 / L = 数日以上。面白さ ★1〜5。数値はすべて `src/data/balance/**/*.json` に置く（ロジックは `data/tuning.ts` 経由）。記法: 段は `windup/active/recover` 秒、`base+係数`、`poise`、形（箱 = box / 扇 = arc / 突き = thrust / 円 = circle）、`reach/size`、`kb` = knockback。L = 左、R = 右。

## 0. 結論（先に決めたこと）

| 項目 | 決定 | 理由 |
| --- | --- | --- |
| 「杖」の作り替え | **杖 = `wand`（持続奥義「詠唱」を持つ方）を魔法の武器種に作り替え、棍 = `staff` は変更しない**（統合役の訂正で確定） | GLOSSARY では 棍 = staff（近接・物理・気力回収の型）、杖 = wand（左 杖打ち + 右 魔弾）。今の wand が既に半分魔法で、右レーンの魔弾 3 段・派生「光条」を持つ。棍は「スキルを回す物理の型」として独立した役割があるので触らない |
| 新武器種 4 種の key と表示名 | 爪 `claws` / チェーンアレイ `flail` / チャクラム `ringBlades` / 扇子 `fan` | **表示名はユーザーの命名どおり**（統合役が確定。設計時の案「鎖鉄球 / 輪刃 / 鉄扇」から変更）。本文中の「鎖鉄球」「輪刃」「鉄扇」はそれぞれ「チェーンアレイ」「チャクラム」「扇子」と読み替える。key は据え置き（`chakram` は戦輪のベース「円月輪」の key と重なるため `ringBlades`）。ベース名（「鉄扇」など）は武器種名と別でよい |
| 周回する弾 | 1-5 の `orbit` は戦闘レーン（奥義「円環の理」）が `BulletDef.orbit: { radius, turnRate, laps }` として先に入れる。チャクラムはその型を流用し、1-5 の `turnsPerSec / duration / rehit` は同じ意味の既存フィールドへ写す | 同じ仕組みを 2 つ作らない |
| 家系 | 4 種とも **近接（`primary: "melee"`）**。杖も `melee` のまま（左の段が弾を出す仕組みを足す） | 銃の家系（左 = 押しっぱなしで撃つ）にすると「左右の組み合わせで魔法が変わる」が成立しない。左の段に弾を持たせる方が右レーン（volley 段）と対称で、既存の共有カウンタ・派生がそのまま魔法の選択になる |
| 新しい仕組み | 1 章の 6 つ（うち必須 3: 左の段の弾 `cast` / 弾の状態異常 `applies` / 弾の見た目 `look`。任意 3: 弾が残す地形 `leaves` / 周回する弾 `orbit` / 振りで敵弾を消す `cutsBullets`） | 4 武器種 + 杖のすべてを既存の行為（swing / hold / volley / charge / pull / nova …）で表し、足りない所だけ最小のフィールドで補う |

## 1. 共通の仕組み（Lane 0。型と処理。ここが終わると 2〜6 章はデータだけ）

| # | 案 | 中身 | なぜ面白いか | コスト | 面白さ | 触るファイル |
| --- | --- | --- | --- | --- | --- | --- |
| 1-1 | **左の段が弾を出す `cast`** | `MeleeStepDef.cast?: CastDef`（`{ key, name, throw: ThrowArtDef }`）。振りの active に入った瞬間に `emitArtVolley(state, cast.throw)` を 1 回呼ぶ（`onLaneSwingStart` / `onBranchStart` と同じ経路。ダッシュ攻撃・派生・奥義の swing でも効く）。段自身の当たり判定は size 0 でもよい（= 純粋な詠唱）。弾の key は `cast.<key>`、`loot/bullets.ts` の `artBullets` が `steps` / `branches` / `dashAttack` の cast も拾う | 杖の「左右の組み合わせ = 魔法の種類」が既存の共有カウンタ + 派生でそのまま成立する。左 4 段 × 右 4 段 × 派生 6 本 = 14 の魔法を追加コードなしにデータで持てる | M | ★5 | `src/data/weapons.ts`（型・`reviveStep` に `cast`）、`src/system/player.ts`（`startSwing` の active 開始で emit）、`src/system/weaponArts.ts`（`emitArtVolley` を流用）、`src/loot/bullets.ts`（`artBullets`）、`src/data/weapons.test.ts` |
| 1-2 | **弾が状態異常を付ける `applies`** | `ThrowArtDef.applies?: readonly StatusApply[]` → `VolleyOverride.applies` → `Projectile.applies?`。`projectiles.ts` の `hitEnemies` と `detonateMine`（曲射・設置弾の炸裂）で `damageEnemy` の直後に `applyStatus(state, e, apply, "player")`（`player.ts` の `applyStepStatus` と同じ関数を export して使う）。近接の `MeleeStepDef.applies` と同じ JSON 形 | 魔法弾の「副次効果」の土台。斧の投擲に出血、撒き散らしに燃焼など既存の弾の段にも後から足せる | S | ★4 | `src/data/weapons.ts`（`ThrowArtDef.applies`、`reviveThrow` で `statusApply`）、`src/core/state.ts`（`Projectile.applies?` 最小 Edit）、`src/system/player.ts`（`emitVolley` に渡す）、`src/system/projectiles.ts`、`src/system/projectiles.test.ts` |
| 1-3 | **弾の見た目 `look`** | `BulletDef.look?: { color: string; trail?: string; particles?: number; glow?: boolean }`。`volleySpec` の色は `mine.color ?? lob.color ?? look.color ?? BULLET_COLOR` の順。`renderer.ts` の弾の描画で `look.trail` があれば残像の線（`renderMath` の座標ハッシュでばらつかせる）、`particles` は `emitVolley` の `spawnBurst` の数。`state.rng` は使わない | 火は橙で尾を引き、氷は水色で粒が散る。魔法 9 種を色だけで見分けられる | S | ★3 | `src/data/weapons.ts`（`BulletDef.look`）、`src/system/player.ts`（`volleySpec`）、`src/render/renderer.ts`（最小 Edit） |
| 1-4 | 弾が地形を残す `leaves`（任意） | `BulletDef.leaves?: { terrain: TerrainKind; radius: number; duration: number }`。命中で消える瞬間・炸裂の位置に `placeTerrain`（`system/terrain.ts` の既存関数）。曲射・設置弾は炸裂点、通常弾は最後に当たった位置 | 爆炎球が床に火を残し、毒霧が毒沼になる。鉄扇の「風で広げる」（Rule `spreadTerrain`）と噛む | S | ★4 | `src/data/weapons.ts`、`src/system/projectiles.ts`、`src/system/terrain.ts`（呼ぶだけ） |
| 1-5 | 周回する弾 `orbit`（任意。輪刃） | `BulletDef.orbit?: { radius: number; turnsPerSec: number; duration: number; rehit: number }`。`steerShot` で位置を「自分の位置 + radius × (cos θ, sin θ)」に置き直す（θ は `ShotRuntime.orbitAngle` を `turnsPerSec × 2π × dt` 進める。撃った角度を初期値にする）。`rehit` 秒ごとに `hitIds` を空にして同じ敵にまた当たる。`duration` で消える。貫通は 99。壁は無視（自分の周りなので `hitWallByShot` を通さない）。`bulletFeatures` に `"orbit"` を足す（`BulletFeature` の union に 1 語） | 「輪を自分の周りに回しておいて、その間に斬る」という、戦輪（投げて戻る）とも投擲（手元返し）とも違う輪の遊び | M | ★4 | `src/data/weapons.ts`（`BULLET_FEATURES` / `BulletDef.orbit` / `ShotRuntime.orbitAngle`）、`src/system/projectiles.ts`（`steerShot` / `updateProjectiles` の壁判定を飛ばす分岐）、`src/system/effects.ts`（`SHOT_SFX.orbit` = `shotRapid` を流用）、`src/system/projectiles.test.ts` |
| 1-6 | 振りで敵弾を消す `cutsBullets`（任意。鉄扇） | `MeleeStepDef.cutsBullets?: boolean`。`player.ts` の `resolveMeleeBullets` の早期リターン条件を `!reflect && stats.bulletCut <= 0 && !step.cutsBullets` にするだけ（弾返しがあれば撃ち返しが優先、無ければ `cutProjectile`） | 「扇で敵弾を払う」が性質なしでも武器種の個性として出る。既存 3 行の変更で済む | S | ★3 | `src/data/weapons.ts`、`src/system/player.ts`（`MeleeStep` に写す + 条件 1 行）、`src/system/player.test.ts` |
| 1-7 | 溜め中の周期ヒット `spinning`（任意。鎖鉄球） | `MeleeChargeDef.spinning?: { interval: number; step: MeleeStepDef }`。溜め（`attack.charging`）の間、`interval` 秒ごとに `step` の当たり判定を 1 回出す（`resolveMeleeHits` を呼ぶだけ。押し続けている限りなので「常に操作していたい」の範囲。オート攻撃ではない）。無ければ普通の溜め | 鉄球を回し続けている間も周りを打ち、離すと溜め段の一撃。溜めの「待ち」を「操作」に変える | M | ★4 | `src/data/weapons.ts`（`reviveCharge`）、`src/system/player.ts`（`updateCharge` に周期）、`src/system/player.test.ts` |

- 型の追加まとめ（要追加）: `MeleeStepDef.cast` / `MeleeStepDef.cutsBullets` / `ThrowArtDef.applies` / `BulletDef.look` / `BulletDef.leaves` / `BulletDef.orbit` / `ShotRuntime.orbitAngle` / `MeleeChargeDef.spinning` / `Projectile.applies` / `BulletFeature` に `"orbit"` / `CastDef`（新規）
- 弾の key の流儀: 右レーンの volley は `art.<段の key>`（既存）、左の段・派生・ダッシュ攻撃の cast は `cast.<cast.key>`。`balance.test.ts` の「弾の key 集合」検査は `BULLETS` から拾うので追随する
- 統一ルールの条件 `{ kind: "bullet", has: ["orbit"] }` が自然に使えるようになる（祝福「周回の輪が敵を引く」などは後日）
- HUD（`render/comboUi.ts`）: 左の段の案内は今「n 段目」。`cast` があれば `cast.name`（「左: 火矢 / 右: 氷槍」）を出す（1 行）

## 2. 爪（`claws`）

**手触り**: 最速の多段。全段に踏み込み（`lunge`）があり、殴りながら詰める。1 ヒットは軽く、出血を重ねて削る。双剣（技巧・5 段・影踏み）との差は「全段 2 ヒット + 常に前へ出る + 右の 3 段目で跳び退く（`selfKnock`）」で、詰める / 離れるを右で選べること。拳（体力・投げ）とは出血とリーチ 12 で違う。
**家系 / 素性**: 近接 `melee`、`attack("melee", "physical")`。参照は技巧（刃の鋭さ・手数）主、最終段と噛みつきに体力（体を張る）。`attackMoveMul` 0.85（拳 1.0 / 双剣 0.7 の間）。「単一最強を作らない」検査はリーチ 12（剣 22 未満）で通す。
**表示名**: 爪。ベース（`src/loot/bases.ts` + `src/data/balance/loot/bases.json`）: 鉤爪 `hookClaws`（深度 2、implicit なし）/ 鉄爪 `ironClaws`（深度 7、implicit: 出血の効果量 +）/ 獣爪 `beastClaws`（深度 13、implicit: 踏み込み中の被ダメ −）。implicit の key は `implicit.ironClaws` / `implicit.beastClaws`（`loot/affixes.ts` に 2 件）。
**語**: `kw(["melee", "combo", "bleed"], ["bleed"], ["crit", "dash"])`。

左の連撃 `steps`（5 段。`src/data/balance/weapons/WEAPON/movesets/claws.json`、新規）:

| 段 | 時間 | 威力 | poise（ratio） | 形 / reach / size | kb | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.02/0.05/0.07 | 1.2 + dex 0.22 | 3 | 箱 12 / 20 | 50 | hits 2、lunge 5、mana 1.2、hitstop 1、trail `#ffd0d0` |
| 2 | 同上 | 同上 | 3 | 同上 | 50 | 同上 |
| 3 | 0.02/0.08/0.07 | 0.9 + dex 0.18 | 2 | 箱 12 / 22 | 40 | hits 3（三連の引っ掻き）、mana 1 |
| 4 | 0.02/0.05/0.07 | 1.2 + dex 0.22 | 3 | 箱 12 / 20 | 50 | hits 2、lunge 8 |
| 5 | 0.04/0.08/0.16 | 4.2 + dex 0.5 + vit 0.2 | 10（dex 0.3） | 箱 14 / 26 | 180 | heavy、hits 2、lunge 10、mana 3、trail `#ffffff`、applies 出血 2 / 4 秒 / potency 1.5 / ratio dex 0.045 |

ダッシュ攻撃「飛びかかり」: 0.02/0.09/0.12、4.5 + dex 0.6 + vit 0.2、poise 8（dex 0.24）、箱 14 / 24、lunge 20、kb 100、mana 2。

右の連撃 `steps2`（5 段。`STEP2_NAMES` / `STEP2_DESC` に追加）:

| 段 | kind / key / 名前 | 中身 |
| --- | --- | --- |
| 右 1 | swing `fangBite` 獣噛み | 0.03/0.07/0.14、4 + dex 0.4 + vit 0.3、poise 9（dex 0.14 vit 0.14）、箱 12 / 22、kb 160、heavy、lunge 14、applies 出血 1 / 4 秒 / 1.5（dex 0.045）。desc「踏み込んで噛みつき、出血させる」 |
| 右 2 | swing `rake` 引っ掻き | 0.02/0.06/0.084、1.3 + dex 0.24、poise 3、扇 140° / 18、kb 60、hits 2 |
| 右 3 | swing `leapBack` 跳び退き | 0.02/0.06/0.084、2.8 + dex 0.45、poise 4、箱 12 / 22、kb 120、`selfKnock` 260（当てて離れる） |
| 右 4 | swing `clawFlurry` 乱れ爪 | 0.03/0.16/0.1、0.8 + dex 0.16、poise 2、円 0 / 40、kb 40、hits 4 |
| 右 5 | swing `throatSlit` 喉裂き | 0.04/0.08/0.19、4.6 + dex 0.55 + vit 0.2、poise 11（dex 0.33）、箱 14 / 24、kb 200、heavy、lunge 10、applies 出血 3 / 4 秒 / 1.5（dex 0.045） |

派生 `branches`（`BRANCH_NAMES` に追加）:

| 入力 | key / 名前 | 中身 |
| --- | --- | --- |
| LLR | `fangRush` 牙駆け | 0.02/0.08/0.1、2.4 + dex 0.4、poise 5、突き 30 / 16、lunge 34、hits 2、invuln 0.06、`next: 2` |
| RRL | `lacerationDance` 裂傷舞 | 0.03/0.2/0.16、1.1 + dex 0.2、poise 2、円 0 / 44、hits 3、applies 出血 1 / 4 秒 / 1.5 |
| LRL | `crossClaw` 十字爪 | 0.03/0.07/0.15、2.6 + dex 0.4 + vit 0.15、poise 7（dex 0.2）、箱 14 / 26、kb 160、heavy、hits 2 |
| RLL | `pounce` 跳び食らい | 0.03/0.08/0.14、4.4 + dex 0.55、poise 10（dex 0.3）、箱 14 / 24、kb 220、heavy、lunge 26、`next: 3` |

**固有効果**（`MovesetDef.rules`、数値は `WEAPON.movesetRules`）: `onMeleeHit` + `targetHas: bleed` → `restoreMana` 1（quiet、ICD 0.15 秒）。「血の匂い」= 出血中の敵を刻むほど気力が戻る（`clawsBleedMana` / `clawsBleedManaIcd`）。

**奥義**（`src/data/ultimates.ts` `clawsSet` + `src/data/balance/ultimates/ULTIMATE/defs/claws.json` 新規）:

| 名前 / key | 種類 | 中身（既存の行為で表現） |
| --- | --- | --- |
| 爪嵐 `clawStorm`（既定） | 一撃 | nova radius 40、hits 6、9 + dex 0.9 + vit 0.5、poise 6（dex 0.2）、kb 60、applies 出血 2 / 5 秒。素性 area / physical |
| 首狩り跳び `neckLeap` | 一撃 | lunge distance 90、step 箱 0 / 30 heavy、45 + dex 2 + vit 1、poise 40（dex 1.2）、kb 300、applies 出血 3 / 5 秒。invuln 0.25 |
| 血の疾走 `bloodRun` | 持続 | drain 12.5 / minSec 1、mul attackSpeed 1.3 moveSpeed 1.25、applies 出血 1 / 4 秒、vsStatus bleed ×1.3、patch trail `#ff6060` |

## 3. 鎖鉄球（`flail`）

**手触り**: 鎖の先の鉄球を振り回す、長い間合いの円運動。全段が扇 200° 以上か円で、周りをまとめて殴る。右 1 段目の「回し」は長押しの溜めで、回している間も周りを打ち続け（1-7）、離すと勢いのついた一撃。戦鎚（円・衝撃波・堅守崩し）より遅くなく広い、大剣（扇 150〜240°・3 段溜め）より「回し続ける」ことに寄せた。鎖鎌（引き寄せて刻む）とは「重い」で分ける。
**家系 / 素性**: 近接 `melee`、`attack("melee", "physical")`。参照は筋力（重さ）主 + 体力（振り回す体幹）、回しに精神（溜め）。`attackMoveMul` 0.3。怯み値は高め。
**表示名**: 鎖鉄球。ベース: 鎖鉄球 `flail`（深度 5、implicit なし）/ 星球 `morningStar`（深度 10、implicit: 怯み値 +）/ 大鎖球 `greatFlail`（深度 16、implicit: 溜め中の移動速度 +）。
**語**: `kw(["melee", "stagger", "area", "wall"], ["still"], ["elite"])`。

左の連撃（4 段。`flail.json`）:

| 段 | 時間 | 威力 | poise（ratio） | 形 / reach / size | kb | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.12/0.12/0.26 | 6.5 + str 0.8 + vit 0.3 | 15（str 0.3 vit 0.15） | 扇 200° / 36 | 260 | mana 3、hitstop 4、shake 2、trail `#c8c8c8` |
| 2 | 同上 | 同上 | 15 | 扇 220° / 36 | 260 | 逆回り |
| 3 | 0.12/0.14/0.28 | 6 + str 0.7 + vit 0.4 | 14（str 0.28 vit 0.14） | 円 0 / 76 | 220 | 一周、mana 3 |
| 4 | 0.18/0.14/0.44 | 13 + str 1.3 + vit 0.8 | 30（str 0.6 vit 0.3） | 箱 30 / 32 | 420 | heavy、hitstop 7、shake 4、mana 5、trail `#ffffff`、applies 崩勢 1 / 1.5 秒 |

ダッシュ攻撃「回し当て」: 0.05/0.14/0.26、7 + str 0.7 + vit 0.4、poise 18（str 0.36 vit 0.18）、円 0 / 64、kb 260、mana 3。

右の連撃（4 段）:

| 段 | kind / key / 名前 | 中身 |
| --- | --- | --- |
| 右 1 | charge `whirl` 回し | `charge`: moveMul 0.5、step 0.06/0.16/0.4、9 + str 0.9 + vit 0.6 + mnd 0.2、poise 24（str 0.5 vit 0.22）、扇 360° / 42（円ではなく扇 360° にして `reachMul` を効かせる）、kb 320、heavy、hitstop 7、shake 4、trail `#ffd75f`。levels: 0.4 秒 → ×1.3 / ×1.4 / reach ×1.1、0.8 秒 → ×1.8 / ×2.0 / ×1.25、1.2 秒 → ×2.6 / ×3.0 / ×1.4。**spinning**（1-7）: interval 0.25、step 扇 360° / 40、2.5 + str 0.3 + vit 0.15、poise 4、kb 120、mana 1。desc「押している間、鉄球を回して周りを打ち続ける。離すと勢いのついた一撃」。1-7 を入れない場合は spinning を省くだけ |
| 右 2 | swing `chainSwing` 振り回し | 0.12/0.14/0.31、7 + str 0.85 + vit 0.35、poise 16（str 0.32 vit 0.16）、扇 270° / 38、kb 280 |
| 右 3 | swing `ballDrop` 鉄球落とし | 0.14/0.12/0.34、9.5 + str 1 + vit 0.5、poise 22（str 0.44 vit 0.22）、箱 34 / 28、kb 300、heavy |
| 右 4 | swing `chainWrap` 鎖巻き | 0.12/0.12/0.4、7 + str 0.6 + vit 0.5、poise 14（str 0.28 vit 0.14）、突き 56 / 14、`pull: true`、kb 200、applies 崩勢 1 / 1.5 秒 |

派生:

| 入力 | key / 名前 | 中身 |
| --- | --- | --- |
| LLR | `starCrush` 星砕き | 0.16/0.2/0.44、5.5 + str 0.7 + vit 0.4、poise 16（str 0.32 vit 0.16）、円 0 / 80、hits 2、kb 300、heavy、shake 4 |
| RRL | `swingDown` 振り落とし | 0.18/0.14/0.44、14 + str 1.4 + vit 0.8、poise 34（str 0.68 vit 0.34）、箱 32 / 34、kb 440、heavy |
| LRL | `chainSweep` 鎖払い | 0.14/0.14/0.3、6 + str 0.7 + vit 0.3、poise 14（str 0.28 vit 0.14）、扇 300° / 40、kb 360 |
| RLL | `dragCrush` 引き砕き | 0.12/0.12/0.26、5 + str 0.5 + vit 0.4、poise 12（str 0.24 vit 0.12）、突き 56 / 14、`pull: true`、kb 200、`next: 3`（引いてから叩きつけ） |

**固有効果**: `onMeleeHit` + `{ kind: "swingStep", atLeast: 2 }` → `addPoise` 8（ICD 0）「勢いが乗る」（3 段目以降と回しの命中は怯み値 +8。`flailMomentumPoise`）。

**奥義**（`flailSet` + `defs/flail.json`）:

| 名前 / key | 種類 | 中身 |
| --- | --- | --- |
| 流星錘 `meteorBall`（既定） | 一撃 | nova radius 60、34 + str 1.8 + vit 1.2、poise 60（str 1.2 vit 0.6）、kb 420、heavy、applies 崩勢 1 / 2 秒。素性 area / physical |
| 鉄球嵐 `ironStorm` | 一撃 | nova radius 54、hits 5、9 + str 0.9 + vit 0.6、poise 12（str 0.24 vit 0.12）、kb 200 |
| 遠心の律 `centrifuge` | 持続 | drain 12.5 / minSec 1、mul poise 1.5、patch reachMul 1.3 chargeTimeMul 0.6 attackMoveMul 0.6 trail `#ffd75f` |

## 4. 輪刃（`ringBlades`）

**手触り**: 両手の刃の輪で速く広く斬る近接。右 1 段目「周回」で輪を 1 枚、自分の周りに回らせ（1-5）、その間に手の輪で斬ると怯ませやすい。右 4 段目でだけ輪を投げる（戻る）。戦輪（銃の家系。左で投げ、右で払う）の鏡像で、「投げる」より「回す・斬る」が主。双剣より広く（扇 160°・円）、鎖鎌より短い。
**家系 / 素性**: 近接 `melee`、`attack("melee", "physical")`。参照は技巧主、最終段に筋力。`attackMoveMul` 0.65。
**表示名**: 輪刃。ベース: 輪刃 `ringBlades`（深度 4、implicit なし）/ 牙輪 `fangRings`（深度 12、implicit: 弾の命中で気力 +）。2 本で足りる（後で 3 本目「月牙輪」を足すなら深度 18）。
**語**: `kw(["melee", "ranged", "combo", "area"], [], ["bullet", "crit"])`。`usesProjectiles` は右 1・右 4 の volley で真。

左の連撃（4 段。`ringBlades.json`）:

| 段 | 時間 | 威力 | poise（ratio） | 形 / reach / size | kb | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.03/0.07/0.1 | 3.4 + dex 0.45 | 6（dex 0.18） | 扇 160° / 22 | 120 | mana 2.5、hitstop 2、trail `#e0f8ff` |
| 2 | 同上 | 同上 | 6 | 扇 160° / 22 | 120 | 逆回り |
| 3 | 0.03/0.09/0.1 | 1.8 + dex 0.3 | 3 | 円 0 / 46 | 80 | hits 2、mana 1.5 |
| 4 | 0.05/0.09/0.22 | 7 + dex 0.7 + str 0.2 | 15（dex 0.45） | 扇 220° / 26 | 240 | heavy、lunge 8、mana 4、trail `#ffffff` |

ダッシュ攻撃「輪走り」: 0.02/0.1/0.14、4.5 + dex 0.6、poise 8（dex 0.24）、円 0 / 48、kb 140、mana 2。

右の連撃（4 段）:

| 段 | kind / key / 名前 | 中身 |
| --- | --- | --- |
| 右 1 | volley `orbitRing` 周回（cooldown 2.0） | throw: 弾 `{ cooldownMul 1, damageMul 1, speedMul 0.6, lifeMul 2, radius 3, poiseMul 1, recoilMul 0, pellets 0, spreadDeg 0, pierceBonus 99, orbit: { radius 34, turnsPerSec 1.2, duration 2.4, rehit 0.5 }, look: { color "#c0f0ff", trail "#80c0ff" } }`、scaling 2.2 + dex 0.3、poise 3、count 1。`STEP2_VOLLEY`: `attack("ranged", "physical")`。desc「輪を自分の周りに回らせる。回っている間、近くの敵に何度も当たる」。1-5 を入れない場合の代替: boomerang `{ returnAt 0.3, catchRadius 6 }` + lifeMul 0.8（短く投げてすぐ戻る） |
| 右 2 | swing `ringCut` 輪断ち | 0.03/0.07/0.12、3.8 + dex 0.5、poise 7（dex 0.2）、箱 18 / 26、kb 130 |
| 右 3 | swing `twinRingCut` 二輪断ち | 0.03/0.09/0.12、2 + dex 0.32、poise 4、円 0 / 50、hits 2、kb 90 |
| 右 4 | volley `ringLaunch` 投輪（cooldown 1.2） | throw: 弾 `{ cooldownMul 1.6, damageMul 0.9, speedMul 1.1, lifeMul 1.2, radius 3, poiseMul 1, recoilMul 0.5, pellets 0, spreadDeg 14, pierceBonus 99, boomerang: { returnAt 0.45, catchRadius 4 }, look: { color "#e0f8ff" } }`、scaling 6 + dex 0.7、poise 12（dex 0.36）、count 1、sprite `weapon.ringBlades`（斧と同じく武器の絵を回す） |

派生:

| 入力 | key / 名前 | 中身 |
| --- | --- | --- |
| LLR | `moonCut` 月輪斬り | 0.05/0.14/0.22、3.6 + dex 0.5、poise 8（dex 0.24）、扇 360° / 30、hits 2、kb 200、heavy |
| RRL | `stackedRings` 重ね輪 | 0.03/0.07/0.12、3.9 + dex 0.55、poise 8（dex 0.24）、箱 18 / 26、kb 130、`shots: { from: "lane", count: 1, damageMul: 1 }`（周回をもう 1 枚） |
| LRL | `ringDash` 輪駆け | 0.02/0.08/0.1、2.2 + dex 0.35、poise 4、突き 30 / 14、lunge 30、hits 2、invuln 0.06、`next: 3` |
| RLL | `doubleSever` 双断ち | 0.04/0.08/0.16、3.6 + dex 0.5、poise 8（dex 0.24）、箱 20 / 28、hits 2、kb 220、heavy |

**固有効果**: `onMeleeHit` + `{ kind: "recent", event: "onRangedHit", within: 1.0 }` → `addPoise` 8（ICD 0）「輪が当たった直後の斬りは怯ませやすい」（`ringRecentPoise` / `ringRecentSec`）。

**奥義**（`ringBladesSet` + `defs/ringBlades.json`）:

| 名前 / key | 種類 | 中身 |
| --- | --- | --- |
| 環の陣 `ringFormation`（既定） | 一撃 | volley: 周回の弾 × 4（count 4、spreadDeg 90、orbit duration 5）、6 + dex 0.8、poise 8（dex 0.24）。素性 ranged / physical。1-5 なしなら boomerang × 4 |
| 乱輪 `wildRings` | 一撃 | nova radius 44、hits 6、5 + dex 0.6、poise 6（dex 0.18）、kb 80 |
| 輪の舞 `ringDance` | 持続 | drain 12.5 / minSec 1、mul attackSpeed 1.15、critAdd 0.1、patch hitsAdd 1 sizeMul 1.2 trail `#c0f0ff` |

## 5. 鉄扇（`fan`）

**手触り**: 舞うように動きながら振る（`attackMoveMul` 1.0、拳と同じ）。威力は低いがノックバックが大きく、風で敵弾を払い（1-6）、床の炎・煙・毒沼を広げる（Rule `spreadTerrain`。既存の効果種）。右 1 段目「扇ぎ」は構え（`hold.guard`）で、離すと突風で押し返す。鞭（先端・恐怖・引き寄せ）や棍（気力回収）とは「押す・払う・広げる」で分ける。
**家系 / 素性**: 近接 `melee`、`attack("melee", "hybrid")`（無属性。風の属性は無いので混成にして魔防と防御の平均で受けさせる）。参照は精神（呼吸・間合いの読み）と技巧（手さばき）。
**表示名**: 鉄扇。ベース: 鉄扇 `ironFan`（深度 3、implicit なし）/ 舞扇 `danceFan`（深度 8、implicit: 攻撃中の移動速度 +）/ 軍扇 `warFan`（深度 14、implicit: ノックバック +）。
**語**: `kw(["melee", "area", "wall"], [], ["burn", "poison", "dash"])`（地形を広げるので燃焼・毒を強める側）。

左の連撃（4 段。`fan.json`）:

| 段 | 時間 | 威力 | poise（ratio） | 形 / reach / size | kb | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.04/0.08/0.12 | 3.6 + mnd 0.3 + dex 0.3 | 7（mnd 0.1 dex 0.1） | 扇 150° / 24 | 200 | mana 3.5、hitstop 2、trail `#ffe8f0` |
| 2 | 同上 | 同上 | 7 | 扇 150° / 24 | 200 | 逆回り |
| 3 | 0.04/0.1/0.13 | 2 + mnd 0.2 + dex 0.2 | 4 | 扇 200° / 26 | 140 | hits 2、mana 2 |
| 4 | 0.06/0.1/0.24 | 6.5 + mnd 0.5 + dex 0.4 | 14（mnd 0.21 dex 0.21） | 扇 180° / 30 | 380 | `cutsBullets: true`、mana 5、trail `#ffffff`（heavy ではない。軽い得物なので壁叩きつけは持たない） |

ダッシュ攻撃「舞い抜け」: 0.02/0.1/0.12、4 + mnd 0.4 + dex 0.4、poise 8（mnd 0.12 dex 0.12）、円 0 / 52、kb 220、invuln 0.08、mana 2。

右の連撃（4 段）:

| 段 | kind / key / 名前 | 中身 |
| --- | --- | --- |
| 右 1 | hold `fanning` 扇ぎ（cooldown 0.4） | `hold: { moveMul 0.7, maxSec 1.5, guard: { arcDeg 150, damageMul 0.6, energyGain 2 }, releaseNext 1, release: 突風 }`。突風 `fanning.release`: 0.04/0.1/0.16、3 + mnd 0.35 + dex 0.2、poise 8（mnd 0.12 dex 0.12）、扇 120° / 44、kb 460、`cutsBullets: true`。desc「押している間、前からの被弾を減らす。離すと突風で押し返し、敵弾を払う」 |
| 右 2 | swing `fanSnap` 扇打ち | 0.04/0.08/0.144、3.9 + mnd 0.35 + dex 0.3、poise 8（mnd 0.12 dex 0.12）、箱 16 / 24、kb 200 |
| 右 3 | swing `petalWhirl` 花舞 | 0.04/0.1/0.156、2.2 + mnd 0.22 + dex 0.22、poise 4、円 0 / 56、hits 2、kb 140、invuln 0.06 |
| 右 4 | volley `windCutter` 風刃（cooldown 0.8） | throw: 弾 `{ cooldownMul 1, damageMul 1, speedMul 1.3, lifeMul 0.9, radius 3, poiseMul 1, recoilMul 0, pellets 0, spreadDeg 0, pierceBonus 2, look: { color "#f0fff8", trail "#c0ffe0" } }`、scaling 5.5 + mnd 0.4 + dex 0.3、poise 10（mnd 0.15 dex 0.15）、count 1。`STEP2_VOLLEY`: `attack("ranged", "hybrid")` |

派生:

| 入力 | key / 名前 | 中身 |
| --- | --- | --- |
| LLR | `butterflyDance` 蝶舞 | 0.05/0.24/0.2、1.8 + mnd 0.2 + dex 0.2、poise 3、円 0 / 60、hits 3、kb 160、invuln 0.1 |
| RRL | `downdraft` 颪 | 0.06/0.1/0.24、6.8 + mnd 0.5 + dex 0.45、poise 16（mnd 0.24 dex 0.24）、扇 160° / 30、kb 420、heavy、`cutsBullets: true` |
| LRL | `galeCut` 烈風 | 0.05/0.08/0.16、4.5 + mnd 0.4 + dex 0.35、poise 9（mnd 0.13 dex 0.13）、突き 40 / 14、kb 300、`shots: { from: "lane", count: 2, damageMul: 0.7, spreadDeg: 14 }`（風刃を 2 本） |
| RLL | `petalStorm` 花吹雪 | 0.05/0.28/0.22、1.4 + mnd 0.15 + dex 0.15、poise 2、円 0 / 64、hits 4、kb 120 |

**固有効果**: (1) `onSwing` → `spreadTerrain` radius 28（ICD 0.4 秒）「風が床の炎・煙・毒沼を広げる」（`fanSpreadRadius` / `fanSpreadIcd`）。(2) `onMeleeHit` + `{ kind: "targetOnTerrain", terrain: "fire" }` → `addPoise` 6「炎の上の敵を煽ると崩れやすい」（`fanEmberPoise`）。

**奥義**（`fanSet` + `defs/fan.json`）:

| 名前 / key | 種類 | 中身 |
| --- | --- | --- |
| 大旋風 `greatGale`（既定） | 一撃 | nova radius 60、hits 3、8 + mnd 0.6 + dex 0.6、poise 12（mnd 0.18 dex 0.18）、kb 500、`clearsBullets: true`。素性 area / hybrid |
| 胡蝶の舞 `butterflyStep` | 一撃 | buff duration 3、speedMul 1.4、invuln 1.0 → nova radius 40、10 + mnd 0.8 + dex 0.6、poise 10、kb 300 |
| 風纏い `windVeil` | 持続 | drain 12.5 / minSec 1、mul moveSpeed 1.2、guard { arcDeg 360, mul 0.7 }、patch sizeMul 1.3 reachMul 1.2 trail `#e0fff0` |

## 6. 杖（`wand`）の作り替え: 左右の組み合わせで魔法が変わる

**方針**: `wand` の key・表示名「杖」・ベース（杖 `wand` 深度 1 / 水晶杖 `crystalWand` 深度 11）・語・素性（`attack("melee", "arcane", "light")` は近接部分に残す）は据え置き。左の 4 段は **杖打ち → 詠唱（`cast`）** に差し替え、右の 4 段は魔弾 3 + 杖突き → **氷の系統の 4 段**に、派生 4 本（魔力撃 / 杖払い / 光条 / 魔力破）は **混合属性の魔法 6 本** に置き換える。棍（`staff`）は触らない。
**遊び**: 左 = 炎の系統（火矢 → 爆炎球）、右 = 氷の系統（氷槍 → 吹雪）。左右を混ぜた 3 手で雷・毒・光・闇・渦。同じ敵に「火矢で燃やして → 氷槍で急冷」「濡れ → 稲妻」のように既存の反応（`REACTION_KEYS`: vaporize / quench / conduct / frostPoison …）を左右の順番で起こすのが杖の上手さ。魔法はすべて **射撃扱い**（`onRangedHit` / 射撃の性質が乗る。近接の性質は渦・ダッシュ攻撃・杖先の小さな判定にだけ乗る）。
**左の段の当たり判定**: 左 1〜3 段は杖先の小さな箱（reach 14 / size 16、威力 1.5 + mnd 0.15）を残す（近接の性質と「近接の命中」系の祝福を殺さないため。8 章で確認）。左 4 段と派生は size 0（純粋な詠唱）。

魔法の表（弾は `cast.<key>` / 右レーンは `art.<key>`。素性はすべて `ranged / arcane`。詠唱の時間は段の windup/active/recover）:

| 入力 | 名前 / key | 弾の挙動 | 威力 / poise | 副次効果（`applies` / `leaves`） | 見た目（`look`） | 詠唱 |
| --- | --- | --- | --- | --- | --- | --- |
| L1 / L2 | 火矢 `fireDart` / `fireDart2` | まっすぐ。speedMul 1.2、lifeMul 1、radius 3、pierce 0 | 3.6 + mnd 0.25 + spi 0.35 / 4 | 燃焼 1 / 3 秒 / potency 2 / ratio spi 0.06 | 橙 `#ff8040`、trail `#ff5020`、particles 2 | 0.04/0.05/0.12 |
| L3 | 二連火矢 `fireDartTwin` | count 2、spreadDeg 10 | 2.8 + mnd 0.2 + spi 0.28 / 3（1 本あたり） | 燃焼 1 / 3 秒 / 2 | 同上 | 0.04/0.06/0.13 |
| L4 | 爆炎球 `blastOrb` | 曲射 `lob: { blastRadius 34, minRange 0, peak 6, color "#ff6030" }`、speedMul 0.8、lifeMul 1（照準の地点で炸裂。距離減衰 A-8b が掛かる） | 7.5 + mnd 0.4 + spi 0.7 / 14（mnd 0.2 spi 0.2） | 燃焼 2 / 3 秒 / 2.5、`leaves: { terrain: "fire", radius 22, duration 2.5 }` | 橙、glow | 0.08/0.08/0.3、mana 6 |
| R1 / R2 | 氷槍 `iceLance` / `iceLance2`（volley、cooldown 0.3） | speedMul 1.5、radius 3、pierceBonus 2 | 4 + mnd 0.3 + spi 0.3 / 6 | 冷気 1 / 3 秒（potency は `combat/STATUS/chill.json` の既定） | 水色 `#a0e0ff`、trail `#e0f8ff` | — |
| R3 | 長氷槍 `iceLanceLong`（cooldown 0.4） | pierceBonus 4、lifeMul 1.3 | 4.6 + mnd 0.35 + spi 0.35 / 8 | 冷気 1 / 3 秒 | 同上 | — |
| R4 | 吹雪 `blizzard`（cooldown 0.9） | 散弾 pellets 4（計 5）、spreadDeg 12、lifeMul 0.45、damageMul 0.5、speedMul 1 | 5 + mnd 0.35 + spi 0.5 / 4（1 発あたり） | 冷気 2 / 3 秒（2 重ねで凍結の反応に届く） | 白青 `#d0f0ff`、particles 4 | — |
| LLR | 稲妻 `lightningBolt` | speedMul 2.2、radius 2、lifeMul 0.6、pierceBonus 99 | 6 + mnd 0.3 + spi 0.6 / 12（mnd 0.18 spi 0.18） | 感電 1 / 4 秒 / 2 / ratio spi 0.06。素性 lightning | 黄 `#ffe050`、trail `#ffffff` | 0.06/0.04/0.2 |
| RRL | 毒霧 `venomMist` | 設置弾 `mine: { fuse 0.6, drag 8, blastRadius 36, triggerRadius 12, color "#80e040" }`、speedMul 0.7 | 4 + mnd 0.2 + spi 0.6 / 2 | 毒 2 / 5 秒（potency は `STATUS/poison.json` の既定）、`leaves: { terrain: "bog", radius 30, duration 4 }`。素性 area / arcane / poison | 緑、glow | 0.06/0.06/0.24 |
| LRL | 渦 `vortex`（弾ではなく振り） | 円 0 / 96、`pull: true`、kb 260、hits 2 | 1.5 + mnd 0.2 + spi 0.2 / 2 | 引き寄せ 2 回。素性は武器種の近接（arcane / light） | trail `#c0d0ff`、shake 1.5 | 0.06/0.12/0.22 |
| RLL | 閃光 `flash` | speedMul 2.5、radius 2、lifeMul 0.5、pierceBonus 99 | 5 + mnd 0.5 + spi 0.3 / 10（mnd 0.3） | 脆弱 1 / 4 秒。素性 light | 白 `#ffffff`、glow | 0.04/0.04/0.16 |
| LRR | 闇手 `darkHand` | 追尾 `homing: { turnRate 6, range 140 }`、speedMul 0.7、lifeMul 1.6、radius 4 | 5.5 + mnd 0.2 + spi 0.7 / 6 | 弱体 1 / 4 秒 + 吸魔 1 / 4 秒（potency は `STATUS/siphon.json` の既定）。素性 dark | 紫 `#a060e0`、trail `#603090` | 0.06/0.06/0.2 |
| RLR | 跳ね雷 `arcLightning` | 跳弾 `bounce: { count 3, mul 1.15 }`、speedMul 1.6、lifeMul 1.4 | 4.5 + mnd 0.3 + spi 0.45 / 6 | 感電 1 / 4 秒 / 2。素性 lightning | 黄、trail | 0.05/0.05/0.18 |

- 左の段の JSON（`movesets/wand.json` の `steps[n]`）: `{"windup":0.04,"active":0.05,"recover":0.12,"scaling":{"base":1.5,"mnd":0.15},"poise":2,"reach":14,"size":16,"knockback":100,"heavy":false,"mana":2,"shape":{"kind":"box"},"cast":{"key":"fireDart","throw":{"bullet":{…},"scaling":{…},"poise":4,"count":1,"spreadDeg":0,"applies":[…]}}}`。`cast.name` は `STEP2_NAMES` と同じ流儀の表 `CAST_NAMES`（`data/weapons.ts`）に置く。弾の語は `ART_BULLET_KEYWORDS`、素性は `STEP2_VOLLEY` と同じ表を cast の key でも引く（表名を `VOLLEY_LOOK` に改名して両方で使う）
- ダッシュ攻撃「瞬き」は据え置き（円 0 / 40、4 + str 0.4 + spi 0.4）
- 気力: 魔法は射撃なので `MANA.onShot` × `shotVolleyCap`。杖の左の詠唱は `mana` 2〜6（杖先の判定の分）。右の volley 段は cooldown で連打を抑える（既存の魔弾と同じ）。詠唱の recover は先行入力で打ち切れる（`PLAYER.recoverCancel`）ので「撃ち続けないと枯渇する」ループはそのまま
- 派生の廃止: `arcaneStrike` 魔力撃 / `staffSweep` 杖払い / `lightRay` 光条 / `arcaneBurst` 魔力破 は消す（来歴 `branchHits` は key を持たないので影響なし。祝福「杖の灯」は `onRangedHit` なので魔法で生きる。`docs/GLOSSARY.md` の派生名の行と `STEP2_NAMES` の魔弾 3 件も外す）
- 固有効果（新規 1 つ）: `onRangedHit` + `{ kind: "targetHas", status: "burn" }` + `{ kind: "attackElement", element: "ice", via: "ranged" }` は反応 `quench` が既に起こすので Rule は足さない。代わりに `onReaction` 相当は無いため、`onRangedHit` → `restoreMana` 1（quiet、ICD 0.2 秒）「杖は魔法の命中で少し気力が戻る」（`wandCastMana` / `wandCastManaIcd`）を 1 本
- 奥義（`wandSet` の 3 本目だけ差し替え。`defs/wand.json` の `incantation` を書き換え）: 魔導砲 / 魔法陣は据え置き。**詠唱 `incantation`（持続）**: drain 12.5 / minSec 1、mul attackSpeed 1.3 moveSpeed 0.85、**cast の弾数 +1**（要追加: `SustainPatch.castCountAdd`。`ultimateMoveset` が `cast.throw.count` に足す）、applies なし。旧「振るたびに魔弾 3 発」の Rule `volley` は消す（Rule の volley は `stats.bullet`（銃なしは拳銃）を撃つので杖では不自然だった）

## 7. 実装の分割（並列レーン）

順序: **Lane 0 を先に 1 コミット** → A（データ）/ B（絵）/ C（奥義）を並列 → D（QA・資料）。共有ファイル（`core/state.ts` / `system/player.ts` / `render/renderer.ts`）は最小 Edit、全文 Write 禁止。数値はすべて JSON。

| Lane | 内容 | 所有（新規は「新規」） | 最小 Edit | テスト（it 名の例） | 完了条件 |
| --- | --- | --- | --- | --- | --- |
| 0 共通の仕組み（Opus implementer、半日〜1 日） | 1 章の 1-1 〜 1-6（1-7 は任意。入れるなら同じレーン） | `src/data/weapons.ts`（型 + revive + `CAST_NAMES` + `VOLLEY_LOOK`）、`src/system/projectiles.ts`、`src/system/weaponArts.ts`（`emitArtVolley` に applies）、`src/loot/bullets.ts`（`artBullets` が cast を拾う）、`src/data/weapons.test.ts` / `src/system/projectiles.test.ts` / `src/system/player.test.ts` | `src/core/state.ts`（`Projectile.applies?`、`ShotRuntime.orbitAngle`）、`src/system/player.ts`（cast の emit・`cutsBullets`・`spinning`・`volleySpec` の色）、`src/render/renderer.ts`（`look.trail` の線）、`src/render/comboUi.ts`（左の案内に `cast.name`） | 「左の段に cast があれば active の瞬間に弾が出て、弾の key は cast.<key>」「弾の applies は命中と炸裂で状態異常を付ける（付与元 player）」「leaves を持つ弾は消える位置に地形を置く」「orbit の弾は自分の周りを回り rehit ごとに同じ敵にまた当たる」「cutsBullets の振りは弾返しなしでも敵弾を消す」「spinning の溜めは interval ごとに周りを打つ」 | `npm run check` 緑。既存 23 種の挙動は不変（`weapons.test.ts` の固定値が通る） |
| A 武器種のデータ（Sonnet implementer。Lane 0 の後） | 2〜6 章の `MOVESETS` 5 件（新規 4 + wand 差し替え）・派生・右レーン・ベース・固有効果 | `src/data/balance/weapons/WEAPON/movesets/{claws,flail,ringBlades,fan}.json`（新規）+ `wand.json`（差し替え）+ `_index.json`（`_order` に 4 つ）、`src/data/balance/weapons/WEAPON/movesetRules.json`、`src/data/balance/loot/bases.json`（ベース 10 件の minLevel）、`src/data/weapons.ts`（`MOVESET_KEYS` / `MOVESETS` / `BRANCH_NAMES` / `STEP2_NAMES` / `STEP2_DESC` / `VOLLEY_LOOK` / `CAST_NAMES`）、`src/loot/bases.ts`（ベース 10 件）、`src/loot/affixes.ts`（implicit 6 件）、`src/data/weapons.test.ts`（`EXPECTED_ART` に 4 行）、`src/data/balance/validate.test.ts` が通ること | `src/system/effects.ts`（`SWING_SFX` 4 行: claws → `swingTwinBlades` / flail → `swingHammer` / ringBlades → `swingSword` / fan → `swingWhip` を流用）、`src/render/renderMath.ts`（`WEAPON_TRAIL_WIDTH` 4 行: 1 / 3 / 2 / 2）、`src/data/sprites/weapons.ts`（`HELD` 4 行は絵が来るまで既存の絵を流用: claws = FISTS、flail = CHAIN、ringBlades = WAR_RING、fan = WAND。Lane B が差し替える）、`docs/GLOSSARY.md`（武器種 4 行・ベース 10・派生 16・右の段 16・cast 名 12） | 「新しい 4 武器種は近接で、右レーンが左と同じ段数」「名前付き派生が 4 本以上で 3 入力以上」「杖の左右の段はすべて cast か volley を持ち、派生 6 本の弾の key が一意」「杖の LLR で稲妻、RRL で毒霧が出る」「新しい武器種の名前・派生名が既存の派生・右の段・奥義・スキル名と重ならない」「ベース 10 件が武器種を持ち、家系は melee」「単一最強を作らない検査を 4 種が通る（爪はリーチ、鎖鉄球・鉄扇・輪刃は移動か威力）」 | `npm run check` 緑。`docs/COMBAT_DESIGN.md` A-7 の表に 5 行（右レーン・派生・得意 / 不得意） |
| B ドット絵と弾の見た目（pixel-artist Opus。Lane 0 と並列可） | 持ち手の絵 4 種（横 / 斜め）と刃の向き、魔法弾の色と粒、輪刃の投輪の回転絵 | `src/data/sprites/weapons.ts`（`HELD` 4 件の本物の絵。`WEAPON_EDGE`: flail は無し〔球〕、fan は "up"〔要の側〕、claws / ringBlades は両刃扱い）、`src/render/sprites.test.ts` | `src/render/renderer.ts`（`look.glow` の描き方 1 か所） | 「4 武器種の持ち手の絵が横・斜めで揃い、拳の位置が (2,10)」「鉄扇の斜めの絵は要が柄の左上側」 | `npm run check` 緑。ブラウザで構え・振りを目視（`docs/recipes/sprite.md`） |
| C 奥義（Sonnet implementer。Lane 0 の後。A と同時可） | 2〜6 章の奥義 12 本 + 詠唱の差し替え | `src/data/ultimates.ts`（`clawsSet` / `flailSet` / `ringBladesSet` / `fanSet` + `SET_BUILDERS` 4 行 + `wandSet` の 3 本目）、`src/data/balance/ultimates/ULTIMATE/defs/{claws,flail,ringBlades,fan}.json`（新規）+ `wand.json`（`incantation`）+ `_index.json`、`src/data/ultimates.test.ts`、`src/system/ultimates.test.ts` | `src/system/ultimates.ts`（`SustainPatch.castCountAdd` を `ultimateMoveset` で畳む 1 か所）、`docs/GLOSSARY.md`「奥義の名前の一覧」に 4 行 + 詠唱の説明 | 「4 武器種が 3 本の奥義を持ち、一撃と持続を含む」「環の陣は周回の弾を 4 枚出す」「詠唱の持続中は cast の弾数が +1 になり、終わると戻る」 | `npm run check` 緑 |
| D QA と資料（Sonnet qa-runner。A・C の後） | bot の対応と資料 | `src/qa/bot.ts`（近接の列選びはそのまま。鎖鉄球の charge 段は刀の居合と同じ経路で 0.5 秒押す。鉄扇の hold は受け流しと同じく予備動作に合わせて押す）、`src/qa/bot.test.ts`、`docs/CODE_MAP.md`（`movesets/*.json` 4 件・`defs/*.json` 4 件）、`IDEAS.md`「現状」（武器種 27 種）、`docs/ideas/README.md` | `docs/COMBAT_DESIGN.md` A-7（Lane A の表と「左の段の弾 cast」の段落）、`docs/recipes/weapon.md`（cast / applies / look / leaves / orbit / cutsBullets の 1 行ずつ）、`scripts/audit-agent-docs.mjs` の「（`MOVESET_KEYS`、N 種）」の件数 | 「bot は杖で左右を混ぜて魔法を撃ち分ける」「bot は鎖鉄球の回しを離す」 | `npm run check` 緑 → 統合役が `npm run qa:full`（`src/qa/report.md` に 5 武器種の撃破数） |

補足:
- `Record<MovesetKey, …>` を持つ場所（型エラーで漏れを教える）: `data/weapons.ts` `MOVESETS`、`data/sprites/weapons.ts` `HELD`、`data/ultimates.ts` `SET_BUILDERS`、`render/renderMath.ts` `WEAPON_TRAIL_WIDTH`、`system/effects.ts` `SWING_SFX`、`data/weapons.test.ts` `EXPECTED_ART`。拠点の武器掛け（`system/hub.ts`）と倉庫の絞り込み（`ui/stashFacets.ts`）は `MOVESET_KEYS` を回すので自動で追従する
- リプレイ: 右クリックの意味は変わらないので `REPLAY_VERSION` は据え置き。杖の旧派生が消えるぶん、杖のリプレイは再現が変わる（旧記録は version が同じでも「杖の入力列が別の魔法を出す」だけで壊れはしない）
- 決定性: orbit の角度・cast の発射はすべて `state.time` / `dt` だけで決まり `state.rng` を使わない
- 数値の目安（`data/weapons.test.ts` の ±40% 検査）: 右 n 段目は左 n 段目と同じ秒間威力、右は recover ×1.2。上の表は爪 = 双剣、鎖鉄球 = 大剣〜戦鎚、輪刃 = 剣〜鎖鎌、鉄扇 = 鞭〜棍、杖 = 旧魔弾（3.5 + mnd 0.2 + spi 0.3）の幅に収めた。balance-tuner が QA 後に `movesets/*.json` を詰める

## 8. 決め打ちした点（ユーザーに確認したいこと）

1. 作り替えの対象は **`wand`（杖）で、`staff`（棍）は変更しない**（確定済み。棍の JSON・奥義・派生には一切触れない）
2. 表示名: 爪 / 鎖鉄球 / 輪刃 / 鉄扇。「扇」は当たり判定の形の表記と重なるので「鉄扇」、「チャクラム」は戦輪のベース「円月輪」と紛れるので「輪刃」。別の語（例: 「双輪」「戦扇」）が好みなら key はそのまま名前だけ変える
3. 新しい仕組みのうち **周回する弾（1-5）と回し中の周期ヒット（1-7）** は無くても成立する（代替を各章に書いた）。入れるなら Lane 0 が M → L に伸びる。推奨は 1-5 は入れる（輪刃の個性がこれだけ）、1-7 は後回し
4. 杖の左 1〜3 段に **杖先の小さな近接判定を残す**（近接の性質・祝福を杖で殺さない）。純粋な魔法（size 0）にするなら、`loot/affixes.ts` の `family: "gun"` の射撃性質が杖のベースに出ない問題も同時に決める必要がある（案: `AffixDef.family` に `"caster"` を足すか、杖のベースを `baseFamily` で gun 扱いにする）
5. 杖の魔法は **射撃扱い**（`rangedDamage` / `onRangedHit` / 誓約「剣の誓い」で封じられる）。「魔法」を近接でも射撃でもない第 3 の種類にはしない（`DamageKind` を増やすと祝福・性質・Rule の条件が全部増える）
6. 杖の旧派生 4 本（魔力撃 / 杖払い / 光条 / 魔力破）と右の魔弾 3 段は **廃止**。残したいなら右 4 段目「吹雪」を「杖突き」に戻して魔法を 1 つ減らす
7. 魔法は 9 種（火矢 / 二連火矢 / 爆炎球 / 氷槍 / 長氷槍 / 吹雪 / 稲妻 / 毒霧 / 閃光 / 闇手 / 跳ね雷 + 渦）。多ければ RLR「跳ね雷」と LRR「闇手」のどちらかを落として派生 4〜5 本にする
8. 4 武器種のベースは 2〜3 本ずつ（計 10）で、implicit は後半の器にだけ付けた。性質（アフィックス）は要望どおり今回は足さない
9. 効果音は既存の振り音を流用（爪 = 双剣、鎖鉄球 = 戦鎚、輪刃 = 剣、鉄扇 = 鞭）。魔法弾の発射音は弾の性質（貫通 / 散弾 / 曲射 / 追尾 / 跳弾 / 設置）の音をそのまま使い、専用の音は足さない（`docs/recipes/audio.md` で後日）
10. 得意な武器（ジョブ `favored`）への追加は今回しない。足すなら 影 → 爪、拳闘士 → 鎖鉄球、術士 → 杖（既に持つ）、狩人 → 輪刃 が自然
