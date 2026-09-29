# 戦闘の核の実装設計（段取り 2）

作成日: 2026-09-30
前提: `docs/ideas/core-synthesis.md` 9 章の段取り 2。architect の設計をそのまま置き、6 章の不確かな点は統合役が推奨で決めた（下の「決めたこと」）。

## 決めたこと（統合役、2026-09-30）

- 受け流しの既定キーは `R` と中クリック、パッドは RB。リスタートは `P` へ移す（6 章の 1。ユーザーが後で変えられるよう報告する）
- 扇子の重さは暫定で「軽」（6 章の 2。段取り 5 で扇の型を決めるときに見直す）
- 取り消せない相でのダッシュ入力は捨てる（6 章の 3。手触りで不満が出たら先行入力を足す）
- 銃の射撃中の移動は重さで縛らない（6 章の 4。段取り 5）

---


## 0. 結論

- 10 項目はすべて **既存の枝（`poise.ts` の蓄積、`weaponArts.ts` の構え、`MeleeStepDef`/`MovesetDef` のデータ駆動、`FrameInput` のビット列）に載せられる**。新規の仕組みは 3 つだけ: (a) 敵の「コミット窓」と「怯みの先送り」（`poise.ts`/`enemies.ts`）、(b) 武器の重さ `WeaponWeight` と重さ別係数 `WEAPON.weightClass`（`data/weapons.ts`/`player.ts`）、(c) 全武器共通の受け流し `system/parry.ts` と入力アクション `parry`
- **連撃の段数の拡張（6〜8 段）は段取り 5 に回す**。今の型は N 段を既に許す（`steps` は任意長、最終段の判定は `hookCombo` で長さから決まる）ので仕組み上の障害は無いが、右レーンを同じ段数にする規約・段ごとの絵（`fxMotions`）・HUD/詳細欄の収まりが「型の設計」と不可分
- `REPLAY_VERSION` は **12 → 13 を 1 回だけ**上げる（`parryPressed` のビット追加 + 進行が変わる更新の束）
- レーンは 4 本（A 敵のコミットと予告 / B プレイヤーの重さ・ダッシュ・ヒットストップ・カウンター / C 受け流し / D 回復・処刑の既定値）。共有ファイルへの最小 Edit を 3 章に列挙
- QA の物差しは既に `src/qa/combatProbe.ts` + `probe.md`（段取り 1 の成果）にある。基準値: slime 深度 1・連打 bot で 完遂率 12% / ヒットストップ 34% / 撃破 1.06 秒 / 被弾 7.0 回/60 秒（`src/qa/probe.md:18`）。改修後に `npm run qa:probe` で同じ表を出して 5 章のつまみで合わせる

---

## 1. 共通の前提（読んだ箇所と観察した事実）

| 事実 | 根拠 |
| --- | --- |
| 敵の予備動作は `startWindup` が `phaseTimer` に「深度・精鋭・祝福を掛けた秒」を入れるだけで、**総時間を保存していない**（残り割合が計算できない） | `/home/user/roguelike/src/system/enemies.ts:503-511` |
| 怯みは状態異常 `stagger`。付与の瞬間に `cancelEnemyAttack` が phase を `chase` に戻し攻撃を消す。`isHalted` で AI も止まる | `/home/user/roguelike/src/system/statusEffects.ts:445-448, 471-475, 115-117` |
| 怯み値の蓄積は `addPoise` → `cannotAccumulate` → `poiseTakenMul`（予備動作中 × `superArmorMul`、strike 中 × `strikeSuperArmorMul`）→ 耐性超えで `breakPoise` → 即 `applyStagger` | `/home/user/roguelike/src/system/poise.ts:99-120, 73-85, 152-164` |
| 非ボスの strike の出口は `endStrike` 1 か所（接触命中・時間切れ・壁）。壁激突の自傷怯みだけ `applyStagger` を直に呼ぶ | `enemies.ts:811-858, 903-919` |
| ボスは `isBossDriven` で状態機械を通らず、`bossKit.runBossCycle`（`bossKit.ts:32-59`）か個別 AI（`boss.ts:254-289`, `bossFrostGiant.ts:97/127`, `bossTwins.ts:113/123`）が `phase`/`phaseTimer` を直に書く |
| カウンター: `isCounterable = phase === "windup"`、威力 × `ACTION.counter.damageMul`(1.5)、怯み値 × `poiseMul`(2)、`guardBreak`、気力 ×2 | `/home/user/roguelike/src/system/player.ts:1246-1284, 1319-1326`、`src/data/balance/combat/ACTION.json` |
| 予告の線は `enemyTelegraph` が `{kind:"line"}` を返した敵だけ、固定長 120px・赤 `#ff4040` を `strikeDir` 方向に描く。chaser（スライム・狼・骸骨）・蝙蝠・騎士は線を持たない | `enemies.ts:1092-1115`、`/home/user/roguelike/src/render/renderer.ts:140, 400-401, 1469-1479, 1954-1963` |
| 狙いは `beginStrike` で `normalize(toPlayer)` に更新（`aimFixedAtWindup` の敵は固定） | `enemies.ts:625-630` |
| ヒットストップは世界停止（`game.ts:156-160`）。通常命中 `FEEL.hitstopLight`=3、重 7、撃破 6、終撃 9、被弾 7、会心 +1。段の JSON は `"hitstop"` を 1〜9 で **269 か所上書き**している（1:53, 2:65, 3:28, 4:53, 5:39, 6:16, 7:8, 8:6, 9:1）。`hitstopScale` は設定で 0〜2、リプレイに記録済み | `/home/user/roguelike/src/system/combat.ts:266-283, 323, 519`、`src/data/balance/feel/FEEL.json`、`src/ui/settings.ts:42-60`、`src/core/replay.ts:120, 570-575` |
| 今日の挑戦は `isDailySeedText(seedText)` で判定し、`beginRun` が `settings.hitstopScale` をそのまま `createGame` と記録器に渡す | `/home/user/roguelike/src/main.ts:221, 406-418, 277-284` |
| 攻撃中の移動は `MovesetDef.attackMoveMul`（武器種ごと 0.2〜1.0）1 本。ダッシュは **どの相でも** `tryDash` が `cancelAttack` して切る | `player.ts:745-753, 683-696` |
| ダッシュ: `PLAYER.dash` = time 0.16 / speed 400 / cooldown 0.45 / invulnTime 0.10、`stats.dashCharges`(既定 1)・`dashCooldownMul`・`dashDistanceMul` がビルドの口。**無敵時間を伸ばす stats は無い**（Rule `iframes` が `invulnTimer` を直接延ばす経路はある） | `src/data/balance/combat/PLAYER.json`、`player.ts:389-395, 670-712`、`/home/user/roguelike/src/loot/types.ts:372-374, 909-911`、`src/core/rules.ts:153-154` |
| 受け流しは剣の右 1 段目 `hold.parry`（窓 0.25 / 外し硬直 0.2 / 怯み値 40）。`damagePlayer` が無敵判定の直後に `tryParry` を呼ぶ。成功時は `addPoise(40, ignoreSuperArmor)` なので耐性 60 の猪は怯まない。別にスキル石「パリィ」もある | `/home/user/roguelike/src/system/weaponArts.ts:222-228, 277-295`、`combat.ts:498-499`、`src/data/balance/weapons/WEAPON/movesets/sword.json:4`、`src/system/skills.ts:1684-1746` |
| 入力: `ACTION_NAMES` 17 個、既定キーは `KeyR`=restart、`KeyF`=special、`Mouse1`（中）は未使用。リプレイは `BUTTON_BITS` の末尾追加で旧記録を 0 として読める | `/home/user/roguelike/src/core/input.ts:5-24, 67-87`、`src/core/replay.ts:184-206` |
| 処刑は `executeHpRatio` = **0.25 のまま**（encounter-core 3-3 の 40% 案は入っていない）。参照は `poise.ts:129` だけで、伸ばす性質・祝福は無い | `src/data/balance/combat/POISE.json`、`poise.ts:127-141` |
| 近接で敵弾を消すのは **既定で無し**（`MeleeStepDef.cutsBullets` 省略 = false、扇子の払いだけ true。性質 `bulletCut`・祝福 `reflect` が口） | `src/data/weapons.ts:123-124`、`player.ts:1335-1359` |
| 回復の既定: `lifeOnHit` / `lifeOnKill` は **既に 0**（ビルドだけ）。リゲインは `ACTION.regain`。降階 `HEAL.descendHealRatio`=0.35。ハート `ROOM.heartDropChance`=0.2・`heartHeal`=18、階の主 `FLOOR_LORD.heartChance`=0.5、試練は確定。泉は `ROOM_KIND.shrineDepths` の階に 1 回全快 + 呪い | `loot/types.ts:900-901`、`src/data/balance/combat/HEAL.json`、`src/data/balance/world/ROOM.json:19-20`、`/home/user/roguelike/src/system/floor.ts:834, 870-873, 886, 941-945`、`src/system/roomTypes.ts:110-131, 308-320` |
| QA の完遂率は `combatMetrics.ts` が phase の遷移（windup → strike/recover）で数える。怯みで chase へ戻ると完遂に入らない | `/home/user/roguelike/src/qa/combatMetrics.ts:102-133` |

---

## 2. 各項目の設計

### 2-1. 敵の攻撃のコミット（レーン A）

**今**: 予備動作の全期間で怯み値が溜まり、溜まり切った瞬間に攻撃が消える。連打していれば予告のたびに怯ませて完遂 12%。

**変更**（3 つの規則）
1. **予備動作のコミット窓**: 残り `phaseTimer <= windupTotal × ENEMY_TEMPO.commitRatio`（0.6）なら **怯み値が溜まらない**（`gained = 0`）。窓の前は今どおり溜まり、溜まり切れば即怯み（読んで潰す報酬は残す）
2. **strike 中は溜まるが先送り**: 耐性を超えたら `poise.pending = true` にして蓄積を満杯で止め、`endStrike` の冒頭（recover・連続攻撃・次の光線へ進む前）で `settlePendingStagger` が怯ませる。連続攻撃（`tryFollowUp`）の 2 撃目は出ない（1 撃目は約束どおり出し切った）
3. **受け流しだけがコミットを破る**（2-8。`PoiseHitOptions.ignoreCommit` と非ボスへの直接 `applyStagger`）

**ボスの扱い（推奨）**: ボスも同じ規則に乗せる。理由: 3-10 の「隙」設計（段取り 8）まで、ダウンは「技を出し切った後」で統一しておけばボス側の分岐を持たなくてよい。`runBossCycle` の windup 開始で `windupTotal` を記録（1 行）、strike → recover で settle（1 行）。個別 AI 3 ファイルは `windupTotal` の記録だけ足し、settle は `updateEnemies` 冒頭の安全網に任せる（pending のまま phase が strike でなくなった最初の step で怯む。1 step の遅れは長い技の後なので目立たない）。`windupTotal` が 0 の敵（記録が無い経路・テストで手で phase を置いた敵）はコミット窓なし = 今の挙動

**触る場所**
| ファイル | 関数（行） | 変更 |
| --- | --- | --- |
| `src/core/state.ts` | `Enemy`（187-）/ `PoiseState`（177-185） | `windupTotal: number`（予備動作の総秒。0 = 未記録）/ `pending: boolean` を追加（最小 Edit） |
| `src/system/statusEffects.ts` | `createPoiseState`（87-89） | `pending: false` を足す（1 行） |
| `src/system/enemies.ts` | `createEnemy`（151-177） | `windupTotal: 0` |
| 同 | `startWindup`（503-511） | `e.windupTotal = e.phaseTimer` |
| 同 | `updateEnemies`（186-195） | `isHalted` の前に `settlePendingStagger(state, e)`（phase が strike 以外で pending なら怯む。安全網） |
| 同 | `strike`（811-858） | `touchPlayer` の後に `if (e.phase !== "strike" || isStaggered(e)) return;` を足す（受け流しが直に怯ませた敵を `endStrike` が recover で上書きする既存の抜けを塞ぐ。2-8 の前提） |
| 同 | `endStrike`（903-919） | 冒頭で `if (settlePendingStagger(state, e)) return;` |
| `src/system/poise.ts` | 新規 `attackCommitted(e)` / `windupCommitted(e)` | `phase === "strike"` / `phase === "windup" && windupTotal > 0 && phaseTimer <= windupTotal × commitRatio`。render も読む純関数 |
| 同 | `cannotAccumulate`（99-101） | `|| e.poise.pending` |
| 同 | `addPoise`（107-120） | `hitOpts` の後に `if (!opts.ignoreCommit && windupCommitted(e)) return false;`。耐性超え時に `if (!opts.ignoreCommit && e.phase === "strike") { e.poise.damage = e.poise.max; e.poise.pending = true; return false; }`。`breakPoise` + `spreadStagger` を `triggerStagger(state, e, noSpread)` に括り出し、`settlePendingStagger` がそれを呼ぶ |
| 同 | `PoiseHitOptions`（53-66） | `ignoreCommit?: boolean` |
| 同 | `breakPoise`（152-164） | `e.poise.pending = false` を入れる |
| `src/system/bossKit.ts` | `runBossCycle`（37-39, 50-53） | windup 開始後 `e.windupTotal = e.phaseTimer`、strike → recover の直前で `settlePendingStagger` |
| `src/system/boss.ts:254-256` / `bossFrostGiant.ts:97` / `bossTwins.ts:113` | windup 開始 | `e.windupTotal = e.phaseTimer`（1 行ずつ。所有は A） |
| `src/qa/combatMetrics.ts` | `CombatBandTally` | 任意: `deferredStaggers` を数える（怯みが先送りされた回数。つまみ合わせの材料） |

**JSON**: `src/data/balance/enemies/ENEMY_TEMPO.json` に `"commitRatio": 0.6` と `"_fields": { "commitRatio": "予備動作の残りがこの割合を切ったら怯み値が溜まらず、攻撃は必ず出る（コミット）。割合(0..1)。0 で従来どおり、1 で予備動作中は一切怯まない。目安 0.5〜0.7" }`

**テスト**（`src/system/poise.test.ts` に追加、`describe("攻撃のコミット")`）
- 予備動作の前半（残り > 60%）に耐性ぶん当てると即怯み、phase が chase に戻る
- 残り 60% を切ってから当てると `poise.damage` が増えない
- strike 中に耐性を超えても phase は strike のまま。`endStrike`（時間切れ）後の step で `stagger` が付き、連続攻撃（knight の followUp）が出ない
- `ignoreCommit` は窓の中でも溜める
- `windupTotal` 0 の敵は従来どおり（既存テストの互換）
- ボス（`runBossCycle` の敵 1 体）: strike 中にダウン条件を満たしても技が終わるまでダウンしない

### 2-2. カウンターの怯み値 ×2 → ×1（レーン B）

- `src/data/balance/combat/ACTION.json` `counter.poiseMul` 2 → 1。`_note` の「poiseMul は敵の強靭と相殺」の文を「威力・盾無視・気力 ×2 は残し、怯み値は等倍（怯ませる手段は読みと受け流し。core-synthesis 3-7）」に直す
- コードは `counterPoise`（`player.ts:1319-1321`）のまま。気力 ×2 は `gainMeleeMana(…, counter)` のまま
- 壊れる: `src/system/actionFeel.test.ts:102`「カウンターは…怯み値が 2 倍」→ 等倍に書き直し、`ACTION.counter.damageMul` と `guardBreak` は残ることを確認する内容へ

### 2-3. 予告の線と色（レーン A。render は state を書かない）

**変更**
- `EnemyTelegraph` の `line` に長さを持たせる: `{ kind: "line"; length: number }`（`src/system/behaviors/base.ts:6-14`）。長さ = `def.speed × behaviorOf(def).strikeSpeedMulFor(e, def) × def.strikeTime` を `TELEGRAPH.minLength..maxLength` に丸める（例: slime 55×4.6×0.22≈56px、wolf≈80、boar 38×7.5×0.7≈200、bat 95×3.2×0.25=76）。精鋭の迅速・冷気は無視（近似。`enemySpeed` は state が要る）
- `enemyTelegraph`（`enemies.ts:1092-1115`）の default 分岐: Wave3・ボスが null で、`strikeSpeedMul > 0 && def.contactDamage > 0` の敵（chaser・knight・bat・wisp・hollow 系）に `line` を返す。`charger` の固定 120px も同じ計算に置き換える
- **線の向き**: `aimFixedAtWindup(e, def)` が false の敵は render が `normalize(player.pos − e.pos)` を向きに使う（`beginStrike` がその向きに更新するので「追従して見える」が、狙いの更新は今と同じ）。固定の敵は `e.strikeDir`
- **色**: `attackCommitted(e)`（2-1 の純関数）が false なら `TELEGRAPH.readyColor`（黄）、true なら `TELEGRAPH.commitColor`（赤）。頭上の `!`（`renderer.ts:1470`）も同じ色に
- 新規 `src/render/telegraphLineUi.ts`（`chargeLineUi.ts` と同じ作り）: `drawStrikeLine(ctx, state, e, tele)`。`renderer.ts:1473` の `if (tele?.kind === "line") this.drawChargeLine(e);` を差し替え、`drawChargeLine`（1954-1963）と `CHARGER_LINE_LEN/ALPHA`（400-401）を消す（renderer.ts は最小 Edit）。`chargeLineUi.ts`（二度突きの折れ線）も色だけコミット色に合わせる

**JSON**: 新規 `src/data/balance/feel/TELEGRAPH.json`（`feel/_index.json` の `_order` に追加、`npm run balance:gen`、`tuning.ts` に `export const TELEGRAPH = BALANCE.feel.TELEGRAPH`）
```json
{ "_note": "敵の予告の線（render/telegraphLineUi.ts）。見た目だけでロジックに効かない",
  "_fields": { "readyColor": "予備動作の前半（怯ませられる）の色", "commitColor": "コミット後（必ず出る）の色", "lineAlpha": "線の不透明度(0..1)", "lineWidth": "線の太さ px", "minLength": "線の最短 px", "maxLength": "線の最長 px" },
  "readyColor": "#ffd040", "commitColor": "#ff4040", "lineAlpha": 0.35, "lineWidth": 1, "minLength": 24, "maxLength": 200 }
```

**テスト**: `src/system/enemies.test.ts`（あれば）か新規 `telegraph.test.ts`: slime/boar の `enemyTelegraph` が `line` で長さが `speed×mul×strikeTime` の丸め、eye（shooter）は従来どおり null。`render/renderMath.test.ts` 系に「向き: 固定でない敵はプレイヤー方向」を純関数で 1 本

### 2-4. ヒットストップ（レーン B）

**変更**
- `src/data/balance/feel/FEEL.json` `hitstopLight` 3 → **1**（0 はつまみ）
- 段の JSON が上書きする `hitstop` 1〜9（269 か所）が支配的なので、個別に直さず **通常命中の上限**を 1 か所で掛ける: `combat.ts` `showHit`（266-283）に `if (!heavy && !opts.finisher && !opts.crit) steps = Math.min(steps, FEEL.hitstopNormalMax);` を足す（`FEEL.hitstopNormalMax: 1`）。重い命中（怯ませた）・終撃・撃破（`killEnemy:323`）・被弾（`damagePlayer:519`）・会心は今の量
- 武器の重さ別の通常命中（2-5 の `weightClass.hitstop`）: `meleeHitEnemy`（`player.ts:1253`）の `step.hitstop ?? (heavy ? FEEL.hitstopHeavy : FEEL.hitstopLight)` を `?? (heavy ? FEEL.hitstopHeavy : weightClass.hitstop)` に
- **記録を競うモードで固定**: `main.ts` `beginRun`（406-418）で `const daily = isDailySeedText(seedText)`、`startGame` に渡す強度と記録器の `hitstopScale` を `daily ? DEFAULT_HITSTOP_SCALE : settings.hitstopScale` に。`applyHitstopScale`（277-284）は `state && isDailySeedText(state.seedText)` なら state へ書き戻さない（設定の保存はする）。`startGame`（221）に引数を足す。設定画面には触らず、`meta/tips.ts` の設定の項に「今日の挑戦では既定値で固定」を 1 文
- `qa/combatProbe.ts` の `hitstopRate` がそのまま物差し

**テスト**: `src/system/combat.test.ts`「通常命中のヒットストップは hitstopNormalMax 以下、怯ませた命中・終撃・会心は上限を受けない」。`main.ts` は DOM 依存なのでロジックの固定は `core/game.test.ts` に「`createGame(..., hitstopScale)` は渡した値をそのまま持つ」だけ（既存）。デイリーの固定は手動確認（6 章）

### 2-5. 武器の重さ 3 段（レーン B）

**型**（`src/data/weapons.ts`）
```ts
export const WEAPON_WEIGHTS = ["light", "medium", "heavy"] as const;
export type WeaponWeight = (typeof WEAPON_WEIGHTS)[number];
// MovesetDef に必須で足す
readonly weight: WeaponWeight;
```
- JSON の `"weight": "medium"` は union 文字列なので `reviveWeight(raw)` で照合して読み込み時に落とす（`hitShape()` と同じ流儀。`docs/ideas/data-externalization.md` 6.6）
- 重さ別の係数は新規 `src/data/balance/weapons/WEAPON/weightClass.json`（`WEAPON/_index.json` の `_order` に追加・`_fields` に各項目、`balance:gen`）。参照は `WEAPON.weightClass[moveset.weight]`

```json
{ "light":  { "moveMulMin": 0.6, "moveMulMax": 0.8, "finisherMoveMul": -1, "lockActive": false, "lockRecoverRatio": 0,   "recoverMul": 1, "damageMul": 1, "poiseMul": 1, "hitstop": 0 },
  "medium": { "moveMulMin": 0.3, "moveMulMax": 0.5, "finisherMoveMul": 0,  "lockActive": true,  "lockRecoverRatio": 0,   "recoverMul": 1, "damageMul": 1, "poiseMul": 1, "hitstop": 1 },
  "heavy":  { "moveMulMin": 0,   "moveMulMax": 0,   "finisherMoveMul": 0,  "lockActive": true,  "lockRecoverRatio": 0.5, "recoverMul": 1, "damageMul": 1, "poiseMul": 1, "hitstop": 2 } }
```
`_fields`: moveMulMin/Max「攻撃中の移動倍率の帯。武器種の attackMoveMul をこの帯に丸める（1 = 等倍）」/ finisherMoveMul「終撃（最終段・フィニッシュ派生）の移動倍率。-1 は段と同じ（足を止めない）」/ lockActive「持続（active）中もダッシュで取り消せない」/ lockRecoverRatio「硬直（recover）の最初のこの割合はダッシュで取り消せない(0..1)。発生（windup）は全重さで取り消せない」/ recoverMul「硬直の倍率」/ damageMul・poiseMul「重さの補償（威力・怯み値）。初期 1、balance-tuner が動かす」/ hitstop「通常命中のヒットストップ（ステップ）」

**適用箇所**（`src/system/player.ts`）
| 関数（行） | 変更 |
| --- | --- |
| `scaleStep`（331-360） | `recover: base.recover × w.recoverMul / speed`、`damage × w.damageMul`、`poise × w.poiseMul`。`w = WEAPON.weightClass[moveset.weight]` |
| `updateMovement`（745-753） | `moveset.attackMoveMul` → `attackMoveMulOf(state, moveset, step)`: `clamp(attackMoveMul, min, max)`、`p.attack.combo === FINISHER_COMBO && finisherMoveMul >= 0` なら `finisherMoveMul`。溜め中（`chargeMul`）・構え中（`artMoveMul`）は今のまま |
| `tryDash`（683-712） | `dashChargesLeft -= 1` の **前**に `if (!canDashCancel(state)) return;`。`canDashCancel`: 振っていなければ true / windup は false / active は `!lockActive` / recover は `timer <= recover × (1 − lockRecoverRatio)`（残りがこの割合以下なら切れる）。溜め中・構え中・スキル中は今どおり切れる |
| `meleeHitEnemy`（1253） | 2-4 の `weightClass.hitstop` |

`isGun` の武器種: 重さは右レーンの振りとダッシュ取り消しに効く。左の射撃は `isAttacking` に含まれないので移動は今のまま（6 章に確認事項）

**27 武器種の割り当て案**（今の `attackMoveMul` を併記。帯から外れる値は丸められるので手触りが変わる）
| 重さ | 武器種（attackMoveMul） | 備考 |
| --- | --- | --- |
| 軽 | 双剣 twinBlades(0.7) / 爪 claws(0.85→0.8) / 拳 fists(1.0→0.8) / 扇子 fan(1.0→0.8) / 戦輪 ringBlades(0.65) / 短銃 sidearm(0.8) / 二丁拳銃 gunner(0.8) / 投擲 thrown(0.7) / 戦輪投げ warRing(0.7) | 3-2 の例では扇は中。今の「舞いながら振る」手触りを尊重して軽（6 章） |
| 中 | 剣 sword(0.35) / 刀 katana(0.4) / 槍 spear(0.35) / 大鎌 scythe(0.3) / 杖 staff(0.4) / 魔杖 wand(0.5) / 鞭 whip(0.5) / 鎖鎌 chainSickle(0.6→0.5) / 連接棍 flail(0.3) / 擲弾 grenade(0.5) / 仕掛け trapper(0.7→0.5) | 長柄・鎖・杖は 3-2 どおり。擲弾・仕掛けは「動きながら撒く」ので中 |
| 重 | 大剣 greatsword(0.2→0) / 戦鎚 hammer(0.2→0) / 大鉈 cleaver(0.25→0) / 斧 axe(0.3→0) / 盾 shield(0.45→0) / 長銃 longarm(0.5→0) / 砲 cannon(0.4→0) | 3-2 どおり「止まる」。補償（damageMul/poiseMul）は balance-tuner |

**テスト**（`src/data/weapons.test.ts`）: 全武器種が `weight` を持ち `WEAPON_WEIGHTS` の要素 / `attackMoveMul` が帯の中か帯へ丸められること（帯外の武器種は `EXPECTED_CLAMP` に理由付きで列挙）/ 銃の家系は軽か中か重のどれか（縛らない）。`src/system/player.test.ts`: 重い武器（大剣）は active 中にダッシュを押しても切れず `dashChargesLeft` が減らない / 軽い武器（双剣）は active 中に切れる / 中の終撃で移動 0、軽の終撃は動く / `recoverMul` が recover に掛かる。`actionFeel.test.ts:511`「ダッシュはこれまでどおり任意のタイミングで攻撃を切る」は「recover の後半でだけ切れる（重さ中）」に書き換え

### 2-6. 連撃の段数 → 段取り 5 へ（コード変更なし）

**調べた結果**: `MovesetDef.steps` は任意長（双剣・拳・爪は 5 段）。最終段は `hookCombo`（`player.ts:295-300`）が `laneLength − 1` で決めるので段数を増やしても終撃・祝福の判定はそのまま動く。`AttackState.step` は添字。段数の縛りはテストだけ（`src/data/weapons.test.ts:34-40, 77-78` の `MIN_STEPS`/`MAX_STEPS`、`:126` の「近接は右レーンも同じ段数」）。
**回す理由**: 6〜8 段にするには右レーンの段（`steps2` は同じ段数の規約。1 段ずつ名前 `STEP2_NAMES`）・段ごとのエフェクト（`render/fxMotions.ts` の `MOVESET_FX`。無い段は手続き描画）・計算式の頁の収まり（`render/detailPane.test.ts`）・派生の `next` の張り直しが要り、これは「13 の型 + 個性」の設計（段取り 5）と一体。**今の段で足すもの**: `weight` だけ。`MIN_STEPS` 3 はそのまま。敵の罰の窓「終撃の後の硬直」は段取り 3 の敵側で読む（`p.attack.phase === "recover" && combo === FINISHER_COMBO`。今の型で判定できる）

### 2-7. ダッシュ（レーン B）

- `src/data/balance/combat/PLAYER.json` `dash.cooldown` 0.45 → **1.2**、`dash.invulnTime` 0.10 → **0.12**。既定回数は `DEFAULT_STATS.dashCharges` = 1 のまま。`_note` の「dash.cooldown は…」の文を core-synthesis 3-3 の理由に差し替え
- **ビルドの口の整合**: 回数 `dashCharges`（性質 `loot/affixes.ts:651, 3469, 3980`、芯 `boonCores.ts:66`、Rule `dashCharges`〔`rules.ts:564-565`〕）/ 再使用 `dashCooldownMul`（性質、技巧 `attributes.ts:110`〔下限 `ATTR.dexDashCooldownMin`〕、片翼 `BOON.oneWingDashCooldownMul`、蜃気楼）/ 距離 `dashDistanceMul` は全部 `PLAYER.dash` に掛かる形なのでそのまま効く。**無敵時間だけ口が無い** → `PlayerStats.dashInvulnBonus: number`（秒の加算。既定 0）を `loot/types.ts:372-374, 909-911` と `loot/stats.ts:298-300`（表示名「ダッシュの無敵時間」style flat）に足し、`tryDash`（`player.ts:706`）を `Math.min(time, PLAYER.dash.invulnTime + stats.dashInvulnBonus)` に。性質・祝福で使うのは段取り 7
- 再使用 1.2 秒で技巧 1 点あたりの短縮率は同じ（比率）。`ATTR.dexDashCooldownMin` の下限が 0.45 基準で決めた値なら見直しは tuner
- 壊れる: `src/system/player.test.ts:110-130`（0.10 / 0.45 を名前と値に持つ）→ `PLAYER.dash.*` を読む形へ。`boonRules.test.ts:529`（見切り返し）・`:786`（返り血）・`:1720`（逃げ水）・`boons.test.ts:271` は「ダッシュ回数が戻る」を短い間隔の 2 回目のダッシュで確かめている可能性 → 落ちたら `dashChargesLeft` を直接読むか `state.stats.dashCharges` を 2 にして堅牢化（seed は変えない）
- QA bot（`qa/bot.ts:713-719`）は再使用 0.45 前提で毎回ダッシュで逃げる。1.2 秒では避けきれず被弾が増える（= 目標どおりの計測）。bot は変えず report の値で見る

### 2-8. 受け流しをいつでも（レーン C）

**判断**: 今は **全武器共通の 1 つの受け流し**でよい（剣以外の応手は段取り 5）。剣の右 1 段目 `hold.parry` は残すが、成功処理を共通の `parrySucceed` に通して「コミットを破る」効果を同じにする。スキル石「パリィ」（`skills.ts`）は別物のまま

**入力（推奨 1 案）**: 新アクション `parry`。既定キー `["KeyR", "Mouse1"]`（R は WASD の上で左手が届く。中クリックはマウス派の副）。**`restart` を `["KeyP"]` へ移す**（ラン中の再開は稀。死亡画面は `main.ts:1619-1620` で restart を読むので P に変わる）。パッドは `PAD_RB`（ダッシュの副 `RB` を外し、ダッシュは `B` だけ）。理由: 右クリックは右レーン 1 段目（武器種ごとの技）で塞がっており、G（拾う）との文脈切り替えは戦闘中の誤爆が怖い。**キー変更はユーザーに確認**（6 章）
- `src/core/input.ts`: `ACTION_NAMES`（5-24）と `REBINDABLE_ACTIONS`（36-53）に `"parry"`、`DEFAULT_KEYBINDS`（67-87）、`FrameInput.parryPressed`（`snapshot` 597-623 と `EMPTY_INPUT`）。`core/gamepad.ts`（41/75/253）に `parryPressed`、`core/padBinds.ts:120-132` に既定。設定画面のアクション表示名の表（`REBINDABLE_ACTIONS` を回す側）に 1 行
- `src/core/replay.ts`: `BUTTON_BITS`（184-206）の末尾に `"parryPressed"`、`REPLAY_VERSION` 12 → 13（コメントに「13 で受け流しの入力・コミット・重さ・ダッシュ 1.2 秒」）

**仕組み**（新規 `src/system/parry.ts`。数値は新規 `src/data/balance/combat/PARRY.json`、`tuning.ts` に `export const PARRY`）
- `Player.parry: { window: number; recover: number }` を `core/state.ts` `Player`（84-159）に追加。初期化は `player.ts` の生成部に 1 行（最小 Edit）
- `tryParry(state)`（押した瞬間）: `!isAttacking(p) && !isDashing(p) && !p.art.holding && !isPlayerStaggered(p) && p.parry.recover <= 0 && p.parry.window <= 0 && !skillLocksAttack(state)` なら `window = PARRY.windowSec`（0.2）、sfx `parry` は成功時だけ（押した音は `swing` 系の軽い音か無し）
- `tickParry(state, dt)`: window を減らし、0 になった瞬間に成功していなければ `recover = PARRY.recoverSec`（0.35）。recover 中は `artLocksActions`（`weaponArts.ts:119-121`。C 所有）が `|| p.parry.recover > 0` を返し、攻撃・技・射撃・スキルを塞ぐ（`player.ts:434` は既に `artLocksActions` を見ている）。ダッシュは `tryDash` が `artLocksActions` を見ていないので、`readActions`（432-437）のダッシュ条件に `!parryLocksDash(state)` を 1 か所足す（player.ts 最小 Edit）。移動は `artMoveMul`（266-271。C 所有）が recover 中 `PARRY.recoverMoveMul`（0）、窓中 `PARRY.windowMoveMul`（0.5）を返す
- `parryIncoming(state, attacker)`（`combat.ts:499` の `tryParry(state, attacker)` を `parryIncoming` に差し替え。中で剣の `weaponArts.tryParry` → 共通の窓 の順に試す。**最小 Edit 1 行**）: 窓の中なら `parrySucceed(state, attacker)` → `window = 0`、`invulnTimer = max(…, PARRY.invulnSec)`（0.3）、浮き文字「受け流し」（`artDefaults.parryText` を流用）、`addMark("parry")`、sfx `counter`、`pushEvent onCounter` + `onTraitCounter`（刀のルール・祝福がそのまま乗る）、気力 `PARRY.mana`
- **敵の止め方**: 非ボス → `applyStagger(state, e, enemyCombat(e.defKey).staggerTime)` を直接（コミット・強靭・堅守を無視、`poise.damage` は 0 に）。ボス（`isBossClass`）→ `addPoise(state, e, PARRY.bossPoise × stats.poiseDamageMul, { ignoreCommit: true, ignoreSuperArmor: true })`（ダウンのゲージに入る。毎回ダウンさせない）
- 弾: `PlayerHitResult` に `"parried"` を足す（`combat.ts:462`）。`projectiles.ts` `hitPlayer`（376-389）は `"ignored"` で弾を残すので、`parried` は `dodged` と同じく弾を消す。`enemies.ts` `touchPlayer`（869-880）は `parried` を `hit` 以外として返し、`strike` は 2-1 で足す `isStaggered` の早期 return で `endStrike` の上書きを避ける（A と C の接点。A が先に入れる）
- 向き: 全方位（`PARRY.arcDeg: 360`。前方だけにするつまみ）
- 剣の `hold.parry`（`weaponArts.ts:277-289`）: 成功時の `counterAttacker` を `parrySucceed` に置き換え（怯み値 40 → 直接怯み。`staggerPoise` はボス用の怯み値として読む）

**JSON** `combat/PARRY.json`: `{ "_note": "全武器共通の受け流し（system/parry.ts。core-synthesis 3-3/encounter-core 3-3）。コミットした攻撃を止められる唯一の手段", "_fields": {...}, "windowSec": 0.2, "recoverSec": 0.35, "invulnSec": 0.3, "windowMoveMul": 0.5, "recoverMoveMul": 0, "arcDeg": 360, "bossPoise": 40, "mana": 5, "color": "#c0f0ff", "particles": 12 }`

**bot**（`src/qa/bot.ts`。C 所有）: `tryParryInput`（768-775）を「次の右段が受け流しでなければ `parryPressed` を押す」形に広げる（`PARRY_CHANCE` は共用）。`freshInput` に `parryPressed: false`

**Tips / 用語**: `meta/tips.ts` の操作の項に「受け流し（`keyLabel("parry")`）: 振っていなければいつでも。窓 0.2 秒、外すと硬直」。GLOSSARY の「受け流し」行に「全武器共通の行動（2026-09-30）」を足す。浮き文字は既存「受け流し」（体言止め）

**テスト**（新規 `src/system/parry.test.ts` + `weaponArts.test.ts:118-148` の更新）: 窓内の接触が無効・敵が怯む（コミット中の strike でも）/ 窓外は通り硬直 0.35 で攻撃・ダッシュが出ない / 振り中は押せない / 弾は消える / ボスは怯まず怯み値が入る / 剣の構え受け流しも同じ `onCounter` を出す / `core/input.test.ts`（あれば）に既定キーの重複なし / `replay.test.ts` に `parryPressed` の往復

### 2-9. 処刑 25% 上限・敵弾は既定で消さない（レーン A の poise.ts + 確認のみ）

- 処刑: 今 `executeHpRatio` = 0.25（既に上限値）。`POISE.json` に `"executeHpRatioMax": 0.25` を足し、`tryExecute`（`poise.ts:129`）を `Math.min(POISE.executeHpRatio + executeBonus(state), POISE.executeHpRatioMax)` の形にして将来の性質・祝福の口を作る（`executeBonus` は今は 0 を返す）。`_fields` に「処刑の閾値の上限。ビルドで伸ばしてもこれを超えない（core-synthesis 3-7）」
- 敵弾: 既定は素通り（`cutsBullets` 省略 = false、`bulletCut`/`reflect` はビルド）。**変更なし**。`docs/COMBAT_DESIGN.md` C-1 に「近接で敵弾を消すのは既定にしない（応手とビルドだけ）」を 1 行

### 2-10. 回復を絞る（レーン D。JSON と docs だけ）

| 回復 | 今 | 変更 | 場所 |
| --- | --- | --- | --- |
| 撃破・命中 | `lifeOnHit`/`lifeOnKill` 既定 0 | **変更なし**（既にビルドだけ） | `loot/types.ts:900-901` |
| リゲイン | `ACTION.regain`（窓 3 秒・0.1/0.3） | 残す | — |
| 降階 | `descendHealRatio` 0.35 | **0.15** | `combat/HEAL.json`、`_fields` の文を更新 |
| ハート（制圧） | `heartDropChance` 0.2 | **0.1**（陣の決着への置き換えは段取り 3） | `world/ROOM.json` |
| ハート（階の主） | `FLOOR_LORD.heartChance` 0.5 | 0.3（tuner が決める。ここでは据え置きでもよい） | `enemies/FLOOR_LORD.json` |
| 泉 | `shrineDepths` の階に全快 + 呪い | **暫定で残す**（瓶は段取り 6。章の境の休符へ移すのもそのとき） | `world/ROOM_KIND/_index.json` |
| 戦闘中の上限 | `sustainCapRatio` 0.04 | 残す | — |
| 試練の確定ハート | 確定 | 残す（腕の報酬） | `floor.ts:829-832` |

壊れるテスト: 無し（`floorLord.test.ts:134` は定数を読む）。`docs/COMBAT_DESIGN.md` C-4「回復の設計」に表を追記し、`HEAL.json` の `_note` に理由（core-synthesis 3-5）

---

## 3. レーン分け（ファイル所有）

| レーン | 所有（自由に編集） | 最小 Edit のみ | 編集禁止 | 主な仕様 |
| --- | --- | --- | --- | --- |
| **A 敵のコミットと予告**（Sonnet。設計済み） | `system/poise.ts`、`system/enemies.ts`、`system/behaviors/base.ts`、`system/bossKit.ts`、`system/boss.ts`・`bossFrostGiant.ts`・`bossTwins.ts`（1 行ずつ）、新規 `render/telegraphLineUi.ts`、`render/chargeLineUi.ts`、`qa/combatMetrics.ts`、`balance/enemies/ENEMY_TEMPO.json`、`balance/combat/POISE.json`、新規 `balance/feel/TELEGRAPH.json`、`poise.test.ts`、新規 `telegraph.test.ts` | `core/state.ts`（`Enemy.windupTotal`、`PoiseState.pending`）/ `system/statusEffects.ts`（`createPoiseState` 1 行）/ `render/renderer.ts`（1473 の差し替え・1470 の色・1954-1963 と 400-401 の削除）/ `data/tuning.ts`（`TELEGRAPH`）/ `feel/_index.json` `_order` | `player.ts`、`weaponArts.ts`、`combat.ts`、`data/weapons.ts` | 2-1、2-3、2-9 |
| **B 重さ・ダッシュ・ヒットストップ・カウンター**（Sonnet） | `data/weapons.ts`、`balance/weapons/WEAPON/movesets/*.json`（`weight` 1 行ずつ）、`WEAPON/_index.json`、新規 `WEAPON/weightClass.json`、`system/player.ts`、`balance/combat/PLAYER.json`、`balance/combat/ACTION.json`、`balance/feel/FEEL.json`、`loot/stats.ts`、`weapons.test.ts`、`player.test.ts`、`actionFeel.test.ts`、`combat.test.ts`（ヒットストップの上限の 1 本） | `loot/types.ts`（`dashInvulnBonus` 2 行）/ `system/combat.ts`（`showHit` に上限 1 行）/ `main.ts`（`beginRun`・`applyHitstopScale`・`startGame` のデイリー固定）/ `meta/tips.ts`（1 文） | `enemies.ts`、`poise.ts`、`weaponArts.ts`、`parry.ts`、`core/input.ts` | 2-2、2-4、2-5、2-7 |
| **C 受け流し**（Sonnet） | 新規 `system/parry.ts` + `parry.test.ts`、`system/weaponArts.ts` + test、`core/input.ts`、`core/gamepad.ts`、`core/padBinds.ts`、`core/replay.ts`（`BUTTON_BITS`・`REPLAY_VERSION` 13）+ `replay.test.ts`、新規 `balance/combat/PARRY.json`、`qa/bot.ts`、設定画面のアクション名表 | `core/state.ts`（`Player.parry`）/ `system/player.ts`（初期値 1 行・`tickTimers` に `tickParry` 1 行・`readActions` に `tryParry` とダッシュ条件 各 1 行）/ `system/combat.ts`（499 の差し替え、`PlayerHitResult` に `"parried"`）/ `system/projectiles.ts`（385 を `parried` も消す 1 行）/ `data/tuning.ts`（`PARRY`）/ `meta/tips.ts`（操作 1 項） | `enemies.ts`（`touchPlayer` の `parried` 対応は A が入れる `isStaggered` ガードで足りるか C が確認し、必要なら統合役に依頼）、`data/weapons.ts` | 2-8 |
| **D 回復の既定**（統合役か Sonnet の短い作業） | `balance/combat/HEAL.json`、`balance/world/ROOM.json`、`balance/enemies/FLOOR_LORD.json`、`docs/COMBAT_DESIGN.md` C-1/C-4 の追記 | — | 上記以外 | 2-9 の敵弾の 1 行、2-10 |

- `core/state.ts` は A と C が別のインターフェースに 1〜2 行ずつ足す。`combat.ts` は B（`showHit`）と C（`damagePlayer`/`PlayerHitResult`）で行が離れている。統合前に `git diff` で両者が残っているか確認
- 順序: **A と C の接点**（`strike()` の `isStaggered` ガード）は A が先に入れる。B は独立。D はいつでも
- REPLAY_VERSION は C だけが上げる（他レーンは上げない）
- 統合役が `npm run balance:gen`（新規 JSON 3 つ: TELEGRAPH / weightClass / PARRY）と `npm run check`、`npm run qa:probe` で 5 章のつまみ合わせに入る

---

## 4. REPLAY_VERSION と壊れそうな既存テスト

- **`REPLAY_VERSION` 12 → 13 が必要**（`FrameInput.parryPressed` のビット追加 + コミット・ダッシュ 1.2 秒・重さで同じ入力列の進行が変わる）。`docs/ARCHITECTURE.md:136` の版の説明に「13 で受け流しの入力・攻撃のコミット・武器の重さ・ダッシュ 1.2 秒」を足す
- 壊れる（要更新）:
  - `src/system/actionFeel.test.ts:102`（カウンター怯み値 ×2）、`:511`（任意のタイミングでダッシュ取り消し）→ B
  - `src/system/player.test.ts:110-130`（無敵 0.10・CD 0.45 の名前と値）→ B
  - `src/system/weaponArts.test.ts:118, 135, 148`（剣の受け流しの成功処理が変わる。期待する状態異常 `stagger` は同じなら通る）→ C
  - `src/data/weapons.test.ts`（`weight` 必須化で `defineMoveset` の呼び出しが全部変わる。テスト自体は追加）→ B
  - `src/data/balance/balance.test.ts`（新 JSON の `_fields` 漏れ・`UNDOCUMENTED_BASELINE`。新しい数値には全部 `_fields` を付けるので基準は上がらない）→ 各レーン
- 落ちる可能性（seed 依存・時間依存）:
  - `src/system/poise.test.ts:104`「怯むと予備動作は取り消され…」: 手で `phase="windup"; phaseTimer=10` を置くので `windupTotal` 0 → 従来どおり通る見込み。`step` で `startWindup` を経る書き方なら予備動作の前半で当てる形へ
  - `src/system/boonRules.test.ts:529, 786, 1720`、`boons.test.ts:271`（ダッシュを短い間隔で 2 回する書き方なら 1.2 秒で 2 回目が出ない）→ `dashChargesLeft` を直接読む・`stats.dashCharges` を増やすで堅牢化（seed を変えない）
  - `src/qa/simulation.test.ts`: 決定性の比較だけなので通る。`qa/combatProbe.test.ts` は `strikes <= windups` などの整合だけ
  - 敵の窓に依存する QA bot の被弾数（report.md）は増える。目標値と照らして 5 章で合わせる（テストの閾値では縛っていない）

---

## 5. 数値の目標と調整つまみ

| 目標 | 物差し | つまみ（優先順） |
| --- | --- | --- |
| 完遂率 60〜80%（連打 bot、雑魚 1 対 1） | `probe.md` 完遂率（今 12%） | `ENEMY_TEMPO.commitRatio`（0.6。上げるほど完遂↑）→ 敵ごとの `combat/<敵>.json` `superArmorMul`（予備動作前半の溜まり）→ `poise`（耐性。encounter-core 3-2 の 45〜55 は段取り 4）→ `ACTION.counter.poiseMul`（1） |
| ヒットストップ 10% 以下 | `probe.md` ヒットストップ（今 29〜41%） | `FEEL.hitstopNormalMax`（1 → 0）→ `weightClass.*.hitstop`（0/1/2）→ `FEEL.hitstopLight`（1）→ `FEEL.hitstopHeavy`/`hitstopKill`/`hitstopFinisher`（7/6/9）→ `PLAYER.critHitstopBonus`（1） |
| 撃破 1.0〜1.5 秒（雑魚 1 体） | `probe.md` 撃破秒（今 1.06〜1.6） | `weightClass.*.damageMul`（重の補償）→ `WEAPON.meleeDamageScale`（0.6）→ 敵 `stats/<敵>.json` `hp`（段取り 4 の曲線と一緒に） |
| 1 対 1 の被弾 3〜6 回/60 秒（連打+ダッシュ bot） | `probe.md` 被弾/60秒（連打 7.0、ダッシュ 0.0） | `PLAYER.dash.cooldown`（1.2）・`invulnTime`（0.12）→ `commitRatio`（窓が長いほど避け遅れ↑）→ 敵 `windup`・`attackInterval` → `ENEMY_TEMPO.coordDelay`（0.2。段取り 3）→ `PARRY.windowSec`/`recoverSec`（受け流し bot を回すとき） |
| 重さの手触り（軽は動いて避ける、重は時機を読む） | 手動 + `probe.md` を武器種別に回す（`combatProbe` の武器種切り替えは要追加） | `weightClass.*.moveMulMin/Max`・`finisherMoveMul`・`lockActive`・`lockRecoverRatio`・`recoverMul`・`poiseMul` |
| 予告の読みやすさ | 手動 | `TELEGRAPH.readyColor/commitColor/lineAlpha/min/maxLength` |
| 回復の谷 | `report.md` 死因・到達深度 | `HEAL.descendHealRatio`（0.15）→ `ROOM.heartDropChance`（0.1）→ `FLOOR_LORD.heartChance` → `ACTION.regain.poolRatio`（0.3） |

---

## 6. 不確かな点（確認方法）

1. **受け流しの既定キー**（R に置き restart を P へ / パッド RB）: ユーザーに聞く。代案は「F を受け流し、奥義を R」。決めた後で `docs/GLOSSARY.md` と `tips.ts` を合わせる
2. **扇子の重さ**: 3-2 の例では「中」。今の `attackMoveMul` 1.0 の手触りを残すなら「軽」。段取り 5 で扇の型を決めるまでの暫定として軽で提案。ユーザー確認
3. **ダッシュの取り消し禁止中に押した入力の扱い**: 今回は捨てる（spec は無言）。手触りで不満が出たら `dashQueued`（発生の終わりまで 1 回だけ先行入力）を B の追加項目に。`npm run dev` で大剣を振りながらダッシュ連打して確認
4. **銃の家系の重さの効き方**: `isAttacking` は近接の振りだけなので、長銃・砲の「左の射撃中に止まる」は今回は起きない（右レーンの振りとダッシュ取り消しだけ）。射撃中の移動倍率を重さで縛るかは段取り 5（銃の型）で決める。`player.ts:745-753` と `updateShooting` を読んで確認
5. **`strikeSlotsFull` の待ち**（`enemies.ts:599-602`。予備動作の終わりで 0.1 秒ずつ延ばす）はコミット窓を延ばす。同時攻撃の上限を変える段取り 3 で一緒に見る。`probe.md` の集団の表で「完遂率」が 1 対 1 より落ちないか
6. **受け流しで止めた strike の後始末**: `touchPlayer` が `parried` を返したとき `strike()` が `endStrike` へ進まないか（A の `isStaggered` ガードで塞ぐ想定）。`parry.test.ts` に「受け流された敵の phase が chase で attackCooldown が入っている」を必ず入れる
7. **ボスのコミット**: 個別 AI（王スライム・霜の巨人・双子）は settle が 1 step 遅れる。ダウンの見た目に違和感が出たら各 AI の strike → recover にも `settlePendingStagger` を足す（1 行ずつ）
8. **予告線の長さの近似**（迅速の精鋭・冷気を無視）: 実際の到達距離とずれるのは強化された敵だけ。気になれば `enemyTelegraph` に `state` を渡して `enemySpeed` を使う（render は state を読むだけなので可）
9. **技巧のダッシュ短縮の下限** `ATTR.dexDashCooldownMin` は 0.45 基準の値。1.2 秒で技巧を積んだときの再使用が想定内か `attributes.ts:110` の式で試算し、tuner に渡す
10. **今日の挑戦の固定の確認**は DOM 依存のため手動: 設定でヒットストップを 0 にしてからデイリーを始め、`state.hitstopScale` が 1 のまま（保存したリプレイの `hitstopScale` も 1）を dev ツールで見る

## 資料に必要な変更（統合役）

- `docs/CODE_MAP.md`: `system/parry.ts`、`render/telegraphLineUi.ts` を 1 行ずつ。`poise.ts` の説明に「コミットと先送り」、`enemies.ts` に `windupTotal`
- `docs/ARCHITECTURE.md`: `REPLAY_VERSION` 13、`FrameInput.parryPressed`
- `docs/recipes/weapon.md`: `MovesetDef.weight` 必須・`weightClass` の帯・「重さの決め方」
- `docs/COMBAT_DESIGN.md`: C-1（敵弾は既定で消さない）、C-2（コミット）、C-4（回復の表）、D-4（先送り）
- `docs/GLOSSARY.md`: 受け流し（全武器共通）、予告の色（黄 = 崩せる / 赤 = コミット）
- `docs/BALANCE.md` の表に `PARRY` / `TELEGRAPH` / `weightClass`、`IDEAS.md` 現状、`docs/HANDOFF.md`