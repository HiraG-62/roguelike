# 敵と陣の実装設計（段取り 3）

作成日: 2026-09-30
前提: `docs/ideas/core-synthesis.md` 9 章の段取り 3。architect の設計をそのまま置き、6 章の不確かな点は統合役が推奨で決めた。段取り 2 は `docs/ideas/combat-core-impl.md`。

## 決めたこと（統合役、2026-09-30）

- 格「強」の接頭辞は「猛」（猛スライム）。第 2 波は「後詰」（6 章の 1・2。ユーザーに報告して変えられるようにする）
- 敗走の行き先が無い敵は 12 秒逃げて画面外なら消える（報酬なし）
- 陣のメンバーに `rollElite` を通さない。精鋭が減りすぎたら陣形に精鋭スロットを足す
- 隙を狙う条件にダッシュの再使用中を含める（probe の連打+ダッシュの被弾が 3 を超えたら見直す）
- 段は 3a → 3b → 3c の順。各段で `REPLAY_VERSION` を 1 つ上げる

- **3a の実装で変えたこと**: 囲むは持ち場そのものでなく「交戦距離の外の輪をなぞる目標点」を返す（持ち場が交戦距離の内側だと散らばらないため。`REACTION.slotMargin / slotLead / slotAngleTol`）。`punishBias` は 0.7 → 0.4（連打+ダッシュの被弾が増えすぎたため）。蝙蝠の離脱は今の 1.2 のまま。陣は通常の部屋だけ（巣・潮の間など最初から敵がいる特別な部屋は従来の配置）。鶴翼に爆発 1・雁行に妨害 1・魚鱗と雁行に精鋭 1・魚鱗の先頭に猛 1 のスロットを足した。陣の中では同じ役割を同じ種類に揃える。総数は陣の数が候補の塊で頭打ちになるので `budgetBase` 9・`budgetPerDepth` 1・長蛇 3 本で合わせた（深度 1 平均 83）

- **3b の実装で変えたこと**: 群勢の強化は `poiseTakenMul` でなく `addPoise` の増分に掛ける（state が要るため）。合流は行き先の陣の id 最小のメンバーの位置へ `rout.mergeDist`（40px）で。歩き出した陣（stir）はメンバーの `roomIndex` を元の塊のままにする（倒し切れば制圧の報酬、空の部屋に入るだけで報酬が出ないように）。塊の陣の「敗走」は `clearRoom` 側だけで出す。`roamHeartChance` は交戦した陣の決着でだけ引く。物見の起床は `updateLookouts`（jinSpawn.ts）。偃月は深度 2 から、大将の部屋主は深度 4 から。大将の JSON は `{ role, grade, lairChance }`。5 の倍数のボス階は単騎のまま（陣を作らない）

- **3c の実装で変えたこと**: 跳躍は新しい敵を足さず毒スライムを `leaper` にした（再配色の敵を章の段へ吸収する方針。役割は突撃）。`followUps` は `depthStages`（連撃・離脱・後退射撃を深度で覚える）に置き換え、骸骨兵の連撃は深度 5・2 撃目の予備動作 0.4。連撃の 2 撃目以降の予備動作は最初からコミット（`Enemy.chainWindup`。連打で必ず潰れるため）。音で起きるには視線が要り、ボスは起きない。鋒矢は `cooldownStagger`、衡軛は `rotate` と `onRecoverEnd` フック（`system/jinFormations.ts`）。陣の目的（J）と精鋭修飾子の整理は段取り 6 以降

---

## 0. 結論

- **陣は部屋を置き換えず、部屋の上に乗せる**。`state.jins: Jin[]` を新設し、陣のメンバーは `Enemy.jinId` を持ちつつ `roomIndex` は「陣が占める塊」のまま。これで `engaged / cleared / clearRoom / isEngaged / 殲滅 / 祝福の onRoomLock・onRoomClear`（`roomIndex` を読む 30 ファイル・100 箇所）を **一切書き換えずに** 決着 → 報酬の経路を流用できる。敗走した敵は `roomIndex = ROAMING_ROOM` に付け替えるので「部屋の生存者 0 → clearRoom」が自然に「決着」になる（全滅・大将撃破・敗走のどれでも同じ 1 本の判定に落ちる）
- 生成は `populateRoom`（部屋ごとに 4 + 深度 回抽選）・`assignRoamers`・`populateCorridors`・10 秒ごとの `spawnRoamReinforcement` を **陣の配置 1 本**（`planJins`: 均等配置 + 予算 + 陣形）に置き換える。総数は `JIN.tilesPerJin / budgetBase` の 2 つのつまみで 80〜100 に合わせる
- 役割は **behavior → 役割の表 + `def.swarm` / `explode` の規則 + `EnemyDef.role?` で例外**（105 定義を全部書き換えない）。格は `Enemy.grade?: "strong"`（強）と既存の `elite`（精鋭）で表し、並は無印
- 反応ルール 3 つは `EnemyBehaviorBase` に **`onStruck` / `attackCooldownRate` / `slotTarget`** の 3 フックとして足し、既定の実装は新 `system/enemyReactions.ts` に置く（役割ごとの閾値は JSON `REACTION`）。乱数を使わないので決定的
- 3 段に分ける: **3a 陣で配る + 反応 + 上限**（決着は全滅のみ、遊べる）→ **3b 群勢・敗走・大将・隊長・HUD** → **3c 残りの陣形 2 種・跳躍・音で起きる・目的**。各段で `REPLAY_VERSION` を 1 つ上げる（14 / 15 / 16）

---

## 1. 今のコードの地図（根拠。行番号付き）

### 1-1. 生成と配置

| 事実 | 根拠 |
| --- | --- |
| `buildFloor` の順: 部屋種類の割当 → 各部屋 `populateRoom`（`enemyCount` = `ROOM.baseEnemies`(4) + 深度 × 1、面積倍率で伸びる、上限 16）→ 地形 → `assignRoamers`（`ROAM.fraction` 0.4 を徘徊に）→ `populateCorridors`（通路タイル 40 ごとに 1、上限 20）→ `clearEmptyOpenRooms` → 契約者 → 隠し部屋。「ここから下の乱数は部屋の中身が決まった後に引く」の注釈あり | `/home/user/roguelike/src/system/floor.ts:111-187, 340-373` |
| 通路の初期配置と徘徊の歩行・増援（`reinforceDelay` 15 秒後から 10 秒ごと、上限 `roamCap`） | `/home/user/roguelike/src/system/spawner.ts:150-166, 180-217, 229-236`、`floor.ts:1010-1026`、`src/data/balance/world/ROAM.json` |
| 洞窟の塊は開始からの歩数順に並ぶ（`rooms[i]` の i が「開始からの遠さ」の近似になる） | `/home/user/roguelike/src/map/cave.ts:321-334` |
| 起床: `idle` は距離 110（`NOTICE_RANGE`）+ 視線、または部屋の封鎖で `chase`。封鎖しない部屋は入る・部屋の誰かが気付くと `engageRoom` が **部屋の全員を起こす**。遠い idle は `isAsleep` で更新を飛ばす | `/home/user/roguelike/src/system/enemies.ts:107, 223-226, 253-259`、`floor.ts:534-567` |
| 制圧: 部屋の `roomIndex` の生存者 0 で `clearRoom` 1 回（得点・「制圧」・報酬 `dropRoomReward`・トリガー・祝福・来歴・契約・ハート 10%） | `floor.ts:544-546, 810-835`、`ROOM.heartDropChance` 0.1 |
| 徘徊は `ROAMING_ROOM`(-1) で制圧を妨げない。交戦判定 `isEngaged` は封鎖 or 部屋の engaged or 近くの気付いた徘徊 | `/home/user/roguelike/src/core/state.ts:670`、`/home/user/roguelike/src/system/engagement.ts:55-81` |
| 部屋主・階の主: 最後の部屋に `setupFloorLordRoom`（部屋主 ×1.6 / 格上げ ×3.0、怯み耐性 ×2、精鋭 1 つ、名「〜の長」）。封鎖時に取り巻き `enemyCount × 0.5` | `/home/user/roguelike/src/system/floorLord.ts:55-84`、`floor.ts:762-770`、`FLOOR_LORD.json` |
| 精鋭: `rollElite`（深度 3 から 10%+1%/深度、上限 35%）、`eliteKindsFor` は部屋主・臆病だけ群長のを外す。号令のは `commandNearby` で周りを一斉に予備動作へ | `/home/user/roguelike/src/system/elites.ts:142-181, 435-448` |
| 取り巻きは `def.pack` + `leaderId`、`followersOf` | `/home/user/roguelike/src/system/enemyTraits.ts:228-262` |
| 敵の定義は 105（`stats/` も 105）。通常抽選に出る（weight>0・minDepth<99）のは **82** | `src/data/enemies.ts` / `enemiesWave3.ts`、`src/data/balance/enemies/stats/` |

### 1-2. 敵 AI と連携

| 事実 | 根拠 |
| --- | --- |
| 状態機械 idle → chase → windup → strike → recover。`chase` は `wantsEngage && attackCooldown <= 0 && canBeginAttack` で `beginWindup` | `enemies.ts:218-239, 380-394` |
| 追跡の進み方 `chaseMove`: shooter/laser は距離保持 + 横揺れ、狼は `def.flank` で回り込み、他は直進。behavior の `chaseMove` フックは席だけあって未使用 | `enemies.ts:408-446`、`/home/user/roguelike/src/system/behaviors/base.ts:49-51` |
| 連携ずらし `coordinateNearby`: 半径 90 内で `attackCooldown <= 0.4` の chase の敵を `coordDelay` **0.2** 秒待たせる | `enemies.ts:479-490`、`ENEMY_TEMPO.json` |
| 同時攻撃の上限 `strikeSlotsFull`: strike 中の非ボスが `ENEMY_AI.maxSimultaneousStrikers`(**2**) 以上なら予備動作の終わりで 0.1 秒ずつ待つ（コミット窓が延びる。段取り 2 の懸念 6-5） | `enemies.ts:603-622`、`ENEMY_AI/_index.json:3-4` |
| 予備動作中の移動は `windupMoveMul > 0` のときだけ前進（負は無視）。recover 中の後退は bat の分岐だけ | `enemies.ts:596-601, 896-901` |
| 恐怖 `isFeared` はプレイヤーから離れるだけの `flee` | `enemies.ts:201-204, 316-322` |
| 死の後処理は `handleDeaths` → `onEliteDeath` → `onEnemyDeath`（配列から消す直前に 1 回） | `enemies.ts:280-299`、`enemyTraits.ts:115-130` |
| 被弾の唯一の入口 `damageEnemy`（`kind` melee/shot/skill/proc、`silent` は継続） | `/home/user/roguelike/src/system/combat.ts:176-215` |
| プレイヤーの隙: `attack.phase === "recover"`（`combo` は最終段で 2）、`dashChargesLeft`、`parry.recover` | `/home/user/roguelike/src/system/player.ts:213-215, 678-710`、`core/state.ts:89-161` |
| 怯み値の倍率の入口 `poiseTakenMul`、コミット `windupCommitted` / `attackCommitted` | `/home/user/roguelike/src/system/poise.ts:57-64, 88` |
| QA: `countEngagedEnemies`（idle / spawning 以外）、`maxSimultaneousStrikers` の超過判定、probe の 1 対 1 / 集団 | `/home/user/roguelike/src/qa/combatMetrics.ts:28-34`、`/home/user/roguelike/src/qa/simulation.test.ts:1551-1594`、`/home/user/roguelike/src/qa/combatProbe.ts:217-284` |
| フル QA の平均生存敵数 107〜159 体、通路の徘徊は全階に立つ | `/home/user/roguelike/src/qa/report.md:15-31` |
| HUD の行は `collectHudLines`、ボスバーは `drawBossBar`、精鋭名は `eliteDisplayName` | `/home/user/roguelike/src/render/runUi.ts:423-448`、`renderer.ts:1576, 2932-2975` |
| 浮き文字の検査は `addFloatingText(..., "リテラル")` を正規表現で拾う（定数経由なら対象外だが体言止めにする） | `/home/user/roguelike/src/system/floatingText.test.ts:14` |
| 用語: 陣 / 陣形 / 群勢 は GLOSSARY に「未実装」で登録済み。「敗走」は黒鉄騎士の浮き文字で既出 | `/home/user/roguelike/docs/GLOSSARY.md:450`、`elites.ts:128, 604-610` |

---

## 2. 設計

### 2-1. 役割 `EnemyDef.role`（7 役割）

**置き場所**: 新規 `/home/user/roguelike/src/data/enemyRoles.ts`（union・表示名・表は TS）。`data/enemies.ts` には `role?: EnemyRole` の 1 行だけ足す。

```ts
export const ENEMY_ROLES = ["vanguard", "charge", "shooter", "disruptor", "support", "blast", "swarm"] as const; // 前衛・突撃・射手・妨害・支援・爆発・群れ
export type EnemyRole = (typeof ENEMY_ROLES)[number];
export const ROLE_LABEL: Record<EnemyRole, string>;
export const ROLE_BY_BEHAVIOR: Record<EnemyBehavior, EnemyRole>;  // Record なので behavior 追加時の漏れは型エラー
export function roleOf(def: EnemyDef): EnemyRole;
```

**決め方の規則**（`roleOf`、上から順に最初に当たったもの）
1. `def.role` があればそれ
2. `def.swarm` があれば **群れ**
3. `def.explode` か `def.deathBomb` があれば **爆発**
4. `ROLE_BY_BEHAVIOR[def.behavior]`

**`ROLE_BY_BEHAVIOR`**
- 前衛: chaser, knight, golem, hollowArmor, twinShade, scavenger, flameEater, crossGolem, frostCrusher, mimic, packLeader（自身は殴る。支援は号令の側面だけなので `role: "support"` を例外で付ける、下記）
- 突撃: charger, hollow, burrower, dropper, shadowStalker
- 射手: shooter, laser, lobber, turret, turretMaster, echoStriker, scribeImp, absorber
- 妨害: silencer, chainWarden, basilisk, windSprite, manaLeech, homunculus, giantToad
- 支援: conductor, graveBell, bellImp, bannerBearer, inert（旗・金床・氷柱。陣には入らない）, egg, forgeMaster
- 爆発: bomber, kamikaze, wisp, mineLayer, mine, oiler
- 群れ: bat
- ボス behavior（kingSlime, boneLord, twinBlade, twinBow, frostGiant, oilKing, broodMother, librarian, mirrorKnight, thiefKing）: 前衛（陣に入らないので使われない。表を埋めるだけ）

**例外（`role:` を定義行に書く）**: `netter`（shooter だが網で足止め → 妨害）、`packLeader`（支援）、`goldSlime` は `timid` なので陣の候補から除外（役割不要）、`thief` / `mirrorSelf` / `mirrorImage` / `reaperShade` / `trainingDummy` は weight 0 で陣に入らない。**新しく敵を足すときは behavior の表で自動的に決まる**（レシピ `docs/recipes/enemy.md` に「役割は表で決まる。違うなら `role:`」を 1 行）。

**陣の候補**: `enemiesForDepth(depth)` から `weight > 0 && !timid && !lairMaster`（部屋主は大将のスロットだけ）で役割ごとに絞り、`biomeEnemyWeight` で重み抽選。1 スロット = 1 種（3-15「同じ陣の中では揃っていて読める」）。

### 2-2. 格（並・強・精鋭）と精鋭修飾子

- `EnemyGrade = "normal" | "strong" | "elite"`（`data/enemyRoles.ts`）。**精鋭 = `e.elite !== undefined`**（既存）。**強 = `Enemy.grade === "strong"`**（新フィールド、`core/state.ts` に 1 行）。並は無印。`gradeOf(e)` を `data/enemyRoles.ts` に置く
- `makeStrong(e)`（`system/jinSpawn.ts`）: `maxHp × JIN.strong.hpMul`(1.6)、`poise.max × JIN.strong.poiseMul`(1.3)。接触ダメは `enemies.ts` の `contactDamageOf` に `× JIN.strong.damageMul`(1.2) を 1 行。表示名は `強〜`ではなく接頭辞 **「猛」**（猛スライム。GLOSSARY に追加。6 章で確認）
- 予算の重さ `JIN.gradeWeight`: 並 1 / 強 2 / 精鋭 3 / 大将 4（3-8「強い 1 体は並 2〜3 体ぶん」）
- 精鋭の付け方: **陣のメンバーは `rollElite` を通さない**（陣形のスロットが決める。二重に付かない）。精鋭スロットは `makeElite(e, pick(eliteKindsForRole(def, role)))`。縛り「精鋭」・呪いの `extraEliteRoll` は従来どおり最後に 1 回だけ回す（無印の敵に付く）
- `eliteKindsForRole(def, role)`（`elites.ts` の `eliteKindsFor` の後段に 3 行）: `ROLE_ELITE_EXCLUDE`（`data/enemyRoles.ts`）で外す。射手: reflective / retaliating / bulwark / anchored（動けない射手は的）。前衛: evasive / greedy。群れ: shielded / bulwark / commanding / greedy。支援: explosive / packed。爆発: shielded / bulwark / linked（爆ぜる前に倒せなくなる）。突撃: anchored。21 → 12 の整理は **3c 以降**（削るのは別レーン）
- 強の解禁 `JIN.strongMinDepth`(2)、精鋭は `ELITE.minDepth`(3) のまま。深度が足りないスロットは **人数を保って並に落とす**

### 2-3. 反応ルール（behavior 共通の 3 フック）

`/home/user/roguelike/src/system/behaviors/base.ts` に足すフック（既定は `system/enemyReactions.ts` の実装へ委譲。Stationary / BossDriven は無効化）:

```ts
/** 殴られた（damageEnemy の silent でない melee/shot/skill。継続ダメは呼ばない） */
onStruck(state, e, def): void            // 既定: reactStruck
/** attackCooldown の進む速さの倍率（1 = 通常。プレイヤーの隙で速くなる） */
attackCooldownRate(state, e, def): number // 既定: reactCooldownRate
/** 追跡の目標点（undefined なら共通の chaseHeading） */
slotTarget(state, e, def): Vec | undefined // 既定: reactSlotTarget
```

1. **間合い取り（`onStruck`）**: `e.ai.hitWindow = REACTION.hitWindowSec`(1.0) に戻し `hitCount++`。`hitCount >= REACTION.retreatHits[role]`（前衛 3 / 突撃 2 / 射手 1 / 妨害 1 / 支援 1 / 爆発 0 / 群れ 0、0 = しない）かつ phase が chase/recover、`!isStaggered && !attackCommitted` なら `ai.retreat = REACTION.retreatSec`(0.25)、`hitCount = 0`。`chase()` / `recover()` の頭で `ai.retreat > 0` ならプレイヤーの反対へ `REACTION.retreatDist / retreatSec`(50px / 0.25s = 200px/s、`def.speed` に依らず一定) で動いて return。`hitWindow` の減衰と `hitCount` の 0 戻しは `beforeAct`（`enemies.ts:269`）に 2 行。呼び出しは `combat.ts:194`（`enemy.hp -= amount` の後）に `if (!opts.silent && kind !== "proc") behaviorOf(def).onStruck(state, enemy, def)` の 1 行
2. **隙を狙う（`attackCooldownRate`）**: `playerExposed(state)` = `p.attack.phase === "recover" && p.attack.combo === 2`（終撃の硬直）`|| p.dashChargesLeft === 0`（ダッシュの再使用中）`|| p.parry.recover > 0`（受け流しの外し）。役割が `REACTION.punishRoles`（前衛・突撃）で exposed なら **`1 + REACTION.punishBias`(0.7) 倍の速さで攻撃間隔の時計が進む**（`enemies.ts:200` の `e.attackCooldown -= edt` を `edt × rate` に）。乱数なし・上限なし・「入りやすい」を時計の速さで表す。connect: 段取り 2 の commit と組んで「3 段目の後が最も危ない」が成立する
3. **囲む（`slotTarget`）**: 役割が `REACTION.slotRoles`（前衛・群れ）で、同じ `jinId`（無ければ `REACTION.slotRange`(140) 以内）の chase 中の同役割の仲間が `slotMinPeers`(2) 以上いれば、仲間を id 昇順に並べた自分の順位 k と人数 n から `angle = base + k × 2π / n`（base = 最小 id の敵からプレイヤーへの角）、目標 = `player.pos + fromAngle(angle) × REACTION.slotRadius`(34)。`chaseMove` の default 分岐（`enemies.ts:441-444`）で `slotTarget` があれば `chaseHeading(map, pos, target, dir)` へ向かい、`d < def.engageRange` なら従来の直進。狼の `flank` は仲間がいないときだけ残す。突撃は入れない（直線で横移動を罰する役）

### 2-4. 動きの語彙 7 種の割り振り

| 語彙 | 段 | 実装 |
| --- | --- | --- |
| 踏み込み | 既存 | `Rusher.strikeSpeedMul`（chaser 4.6・knight の lunge）。追加なし |
| 離脱 | 3a | `EnemyBehaviorBase.recoverRetreatMul`（既定 0）。`recover()` の bat 分岐（`enemies.ts:896-901`）を一般化し、`Flyer` に `ENEMY_AI.bat.retreatMul` を移す。狼（`wolf`）・棘鼠・盗賊に 1.5 を付ける（`families.ts` の個別クラスか、`REACTION.retreatAfterStrike[behavior]`） |
| 回り込み | 3a | 2-3 の `slotTarget` |
| 連撃 | 既存 | `ENEMY_TEMPO.followUps`。骸骨兵 `skeleton` に `{ minDepth: 4, count: 1, windup: 0.3 }` を JSON で足す（章 2 で覚える。4-3） |
| 跳躍 | 3c | 新 behavior `leaper`（着地点に影 → `hazards.ts` の `landing` を流用、着地で打つ）。スライムの章 2 の段か跳び蜘蛛。新 sprite が要るなら pixel-artist |
| 後退射撃 | 3a | `Keeper.windupMoveMul = -REACTION.shooterBackstepMul`(0.5)。`windup()`（`enemies.ts:596-601`）の `mul > 0` を `mul !== 0` にし、負なら離れる方向へ。射手役だけ（laser は据え置き 0） |
| 間合い取り | 3a | 2-3 の `onStruck` |

### 2-5. 陣 `Jin`

**型（`/home/user/roguelike/src/core/state.ts` に追加。`FormationKey` は `data/formations.ts` から type import）**

```ts
export type JinPhase = "sleeping" | "engaged" | "settled";
export interface Jin {
  id: number;
  /** 占める塊。長蛇・物見は ROAMING_ROOM */
  roomIndex: number;
  formation: FormationKey;
  center: Vec;
  /** 正面（開始側の隣の塊へ向く）。陣形の並びの向き */
  facing: Vec;
  /** 大将の敵 id。いない陣は null */
  leaderId: number | null;
  /** 群勢（士気）。moraleMax は生成時のメンバーの重さの合計 */
  morale: number;
  moraleMax: number;
  phase: JinPhase;
  /** 決着の種類（全滅 / 敗走）。settled のとき */
  settledBy?: "wipe" | "rout";
  /** 後詰（第 2 波）を起こす floorTime。null なら無し */
  secondWaveAt: number | null;
  /** 同じ tick の撃破数（一網打尽の判定） */
  deathsTick: number;
  deathsInTick: number;
}
// Enemy に: jinId?: number; grade?: "strong"; rout?: { toJin: number | null; time: number };
// EnemyAi に: hitWindow?: number; hitCount?: number; retreat?: number;
// GameState に: jins: Jin[]（buildFloor で作り直す。game.ts の初期値 []）
```

**部屋との関係**
- 陣を置くのは `kind === "normal"` で封鎖しない・`startsEmpty` でない・開始とボス以外の塊（`roomLocks` false）。1 塊 ≤ 1 陣。メンバーの `roomIndex` はその塊 → `engaged / clearRoom / isEngaged / 殲滅 / 祝福 / 来歴` はそのまま効く
- 陣の無い塊は既存の `clearEmptyOpenRooms` で最初から制圧済み
- 封鎖する部屋（試練・闘技場・巣窟・伏兵・護衛・鏡・巣）と台座の部屋は陣を持たない。波の湧きは `enemyCount` のまま
- **ボス部屋**: `lockRoom`（`floor.ts:765-767`）で取り巻きが湧いた直後に `createBossJin(state, roomIndex, lordId, escorts)`（陣形 偃月、大将 = 階の主）。主を倒す → 大将撃破 → 群勢崩壊 → 取り巻きが敗走 → `roomIndex` 付け替えで部屋の生存者 0 → `clearRoom` で扉が開き階段（既存の流れ）。3-10「倒すと群勢が崩れる」がこれ
- 長蛇（通路の列）・物見（見張り）は `roomIndex = ROAMING_ROOM` の陣。決着しても部屋の報酬は無い（3b で `JIN.roamHeartChance` を `roomHooks.dropHeart` 経由で小さく）

**配り方（`/home/user/roguelike/src/system/jinSpawn.ts` の `planJins(state)`。`buildFloor` の 159-171 の `populateRoom` と 178-179 の `assignRoamers / populateCorridors` を置き換える）**
1. 候補 = 上記の塊のうち `tiles.size >= JIN.minRoomTiles`(24)
2. 数 `N = clamp(round(床タイル総数 / JIN.tilesPerJin), JIN.minJins, JIN.maxJins)`（面積倍率は床タイル数に含まれる）
3. **最遠点の逐次選択**: 選んだ集合 + 開始の塊の中心からの最小距離（px）が最大の候補を順に取る（同値は index が小さい方。乱数なし）。最小距離が `JIN.minSpacing`(260) を切ったら止める
4. 予算 `B = round(tri(JIN.budgetBase + depth × JIN.budgetPerDepth, ±JIN.budgetSpread) × lerp(JIN.densityNearStart, JIN.densityNearEnd, i / (rooms.length − 1)))`。`tri` は `state.rng` の三角分布（3-15）。`i` は塊の index（開始からの歩数順 = 疎 → 密の山谷）
5. 陣形を `FORMATION.<key>.minDepth <= depth` の中から `weight` で抽選 → `spawnJin(state, roomIndex, formationKey, B)`
6. 長蛇: `JIN.column.count(depth)` 本。`spawner.ts` の通路タイル一覧（`corridorTileList`）から、既に選んだ陣の中心と `JIN.column.minDistFromJin`(200) 以上離れた点を最遠点で選び、陣形 `column`（同じ 1 種 × `JIN.column.members`(3)）を `ROAMING_ROOM` で置く。先頭が `pickRoamTarget` で目的地を持ち、他は `leaderId` で先頭の `ai.roam` を写す（`retarget` に 2 行）
7. 物見（3b）: 2 つの陣の中心を結ぶ線の中点に近い通路タイルへ 射手 1（陣形 `lookout`）。`NOTICE_RANGE × JIN.lookout.noticeMul`(2) で気付き、気付いた瞬間に最も近い眠っている陣を `wakeJin`
8. `spawnJin`: 陣形の `slots` を順に埋める（2-6）。位置は `map/formation.ts` の `layoutOffsets(layout, n, spacing)` を `facing` で回して `center` に足し、`spawnSpot(state, want, center, radius)`（`enemyTraits.ts:61`）で空きへ寄せ、塊のタイル外なら見送る。`createEnemy` → `onBoonEnemySpawned` → `onRunEnemySpawned` → 格の付与 → `extraEliteRoll` → push。最後に `finalizeLinks(state, roomIndex)` と `initJinMorale(state, jin)`（3b）
- 削るもの: `populateRoom`（通常部屋向け）、`assignRoamers`、`populateCorridors`、`spawnRoamReinforcement` / `reinforceDue` / `roamCap` / `roamSpawnPoint`（`floor.ts:75-76, 508, 1010-1026` の呼び出しも）。`ROAM.json` の `fraction / corridor* / reinforce* / cap*` を消し `_fields` も揃える。残す: `speedMul / reach / stuckTime / sleepDist / sleepRoamEvery / engageLeash / spawnAttempts`（歩行・眠り・交戦判定）
- 増援の代わり（3b）: `updateJins` が `floorTime > JIN.stir.delay`(40) から `JIN.stir.interval`(25) ごとに **最も近い眠っている陣を長蛇に変えて**プレイヤーの塊へ歩かせる（湧かせないので総数は増えない。encounter-core 5-5）。縛り「絶えぬ増援」（`runSetup.ts:115`）は封鎖時の増援だけなので影響なし

**起床（交戦の始まり方）**
- 3a: `engageRoom`（`floor.ts:557-567`）と `lockRoom`（`756-758`）の「部屋の idle を全部 chase」を `wakeJin(state, jin, noticerPos)` に置き換え、中身は同じ（全員起こす）
- 3b: 気付いた者から `JIN.wake.radius`(160) 以内だけ起こし、残りは `jin.secondWaveAt = floorTime + JIN.wake.secondWaveDelay`(2.5) で `updateJins` が起こす（浮き文字「後詰」）。封鎖する部屋（ボス部屋）は全員起こす
- 3c: ダッシュ・命中の音で 200 px の眠っている敵が起きる（歩きでは起きない）

### 2-6. 陣形（八陣）

**データの置き場**: 形（layout の種類・key・表示名・並べる純関数）は TS、**人数・格・解禁深度・重み・間隔は JSON**。`skills/arts/build.ts` と同じ方針で、`data/formations.ts` が読み込み時に JSON の `role` / `grade` / `layout` の文字列を検査して落とす。

- `/home/user/roguelike/src/data/formations.ts`: `FORMATION_KEYS`（`fishScale` 魚鱗 / `craneWing` 鶴翼 / `crescent` 偃月 / `arrowhead` 鋒矢 / `circle` 方円 / `geese` 雁行 / `column` 長蛇 / `yoke` 衡軛 / `lookout` 物見）、`FORMATION_LABEL`、`FormationLayout = "wedge" | "vee" | "arc" | "line" | "ring" | "diagonal" | "column" | "twoRows" | "single"`、`FormationDef { key, layout, minDepth, weight, spacing, leader?: { roles, grade }, slots: { role, grade, share, min, max? }[] }`、`FORMATION_DEFS`、`formationDef(key)`
- `/home/user/roguelike/src/data/balance/enemies/FORMATION/_index.json`（`_note` / `_fields` を親に 1 回）+ `<key>.json`。例（魚鱗）:

```json
{
  "layout": "wedge", "minDepth": 1, "weight": 3, "spacing": 20,
  "slots": [
    { "role": "vanguard", "grade": "normal", "share": 0.75, "min": 3 },
    { "role": "charge",   "grade": "normal", "share": 0.25, "min": 0, "max": 1 }
  ]
}
```
- 人数の決め方: `count = clamp(round(B × share / gradeWeight[grade]), min, max ?? ∞)`。深度が格の解禁に足りなければ格だけ並に落とす。役割に合う敵が深度に無いスロットは見送る（支援は深度 3 の呼び鈴小鬼が最初）
- `/home/user/roguelike/src/map/formation.ts`: `layoutOffsets(layout, count, spacing): Vec[]`（正面 +x、原点が center。純関数・乱数なし）。wedge = 1,2,3… の三角で頂点が正面、vee = 左右へ後ろ開き、arc = 先頭 1 + 後ろの弧 ±70°、line = 正面へ一列、ring = 中心 + 半径 1.2 × spacing の輪、diagonal = 斜め一列、column = 後ろへ一列、twoRows = 2 列、single = 1 点。スロットの順 = 置く順（正面のスロットを先に書く）

**最初に入れる陣形（推奨）**
- 3a（4 種）: **魚鱗**（前衛 0.75 + 突撃 0.25）、**鶴翼**（群れ 0.5 両翼 + 射手 0.3 奥 + 突撃 0.2。vee）、**雁行**（射手 0.7 斜め + 前衛 0.3 前。diagonal）、**長蛇**（column、徘徊）
- 3b（+3）: **偃月**（大将 = 部屋主 or 強の前衛に精鋭を付ける + 前衛 0.6 + 群れ 0.4。arc）、**方円**（支援 1 中心 + 前衛 0.7 + 妨害 0.3。ring。minDepth 3）、**物見**（single、射手 1）
- 3c（+2）: **鋒矢**（突撃 1.0。line。列の後ろほど `attackCooldown` を +0.15 ずらす）、**衡軛**（前衛 2 列 + 射手。twoRows。前列が strike 後の recover で後ろへ下がり後列が前へ出る = `recoverRetreatMul` + 列の入れ替えを `onRecoverEnd` フックで）
- encounter-core 5-2 の変種（火計・罠陣・反魂・挟撃・一騎・巣窟）は 3c 以降に「陣形 + 目的」で

### 2-7. 群勢と敗走（3b。`/home/user/roguelike/src/system/jin.ts`）

- `initJinMorale`: `moraleMax = Σ gradeWeight(member)`（大将は `leader` 4）、`morale = moraleMax`
- **下がる**（`noteJinDeath(state, e, def)` を `enemyTraits.ts` の `onEnemyDeath` 冒頭で 1 行呼ぶ。`vanished` は数えない）: 仲間 −重さ。処刑で倒した（`poise.ts` の `tryExecute` が `e.executed = true` を立てる 1 行）なら −`JIN.morale.executeBonus`(1)。同じ tick の 2 体目以降は −`multiKillBonus`(1) ずつ（`deathsTick / deathsInTick`）。**大将の撃破**は `morale = min(morale − 4, moraleMax × JIN.morale.leaderBreakRatio(0.2))`（浮き文字「大将撃破」）
- **敗走**: `morale <= moraleMax × JIN.morale.routRatio`(0.34) で生存者がいれば全員 `rout = { toJin: nearestOtherJin(sleeping か engaged), time: JIN.rout.maxTime(12) }`、`jinId = undefined`、`roomIndex = ROAMING_ROOM`、`jin.phase = "settled"`, `settledBy = "rout"`、陣の中心に「敗走」。部屋の生存者が 0 になるので `clearRoom` が同じステップの `updateRooms` で走る（報酬はそのまま）。`clearRoom` の「制圧」は `settledBy === "rout"` なら「敗走」に差し替え（`floor.ts:815` を `JIN_TEXT` 参照に 2 行）
- **逃げる敵の挙動**（`stepRout` を `enemies.ts` の `isFeared` 分岐の直後に `if (e.rout) { stepRout(...); continue; }` の 2 行）: 目的地 = `toJin` の中心へ `nextWaypoint`（既存の距離場キャッシュ。目的地は陣の数だけ）、速さ `enemySpeed × JIN.rout.speedMul`(1.25)、攻撃しない、`JIN.rout.retargetSec`(1.0) ごとに目的地の陣が生きているか見直す。到着（`ROAM.reach` + 半径）で **合流**: `jinId = toJin`, `roomIndex = toJin.roomIndex`, `phase = "idle"`, 相手の `morale += 重さ`（上限 `moraleMax × mergeCapRatio` 1.25）。行き先が無ければプレイヤーの反対へ逃げ、`time` が尽きて `farFromPlayer` なら `vanish`（逃げ切り。報酬なし）。封鎖中の部屋の中では扉が開くまで壁沿いに逃げる（`nextWaypoint` が null → `flee`）。逃げている敵は phase `chase` のまま殴れる・倒せる。倒したときのドロップは `loot.ts:81` の確率に `× JIN.rout.dropMul`(1.5)（銭は段取り 6）
- **集まっている間の強化**: `morale / moraleMax >= JIN.morale.highRatio`(0.75) の engaged な陣のメンバーは `toChase`（`enemies.ts:364`）の `attackInterval × highAttackIntervalMul`(0.85)、`poiseTakenMul`（`poise.ts:88`）に `× highPoiseTakenMul`(0.85)。どちらも `jinBonusMul(state, e)` を 1 行掛けるだけ
- 決着の種類の記録: `jin.settledBy` を QA が数える（全滅 / 敗走。大将撃破は敗走の内訳）
- **2026-10-02 の見直し（ユーザーの指摘「毎回全部逃げる・反撃もせずゆっくり逃げる敵を追っても面白くない・追う得も逃がす損も無い」）**:
  - 崩れたら生き残りが 1 体ずつ逃げるか踏みとどまるかを決める（`morale.fleeChance` 並 0.6 / 猛 0.3 / 精鋭・大将 0.1、大将撃破で `leaderFleeBonus` +0.25。`state.rng` を逃げられる者だけ id 順に引く）。踏みとどまった者がいれば陣は決着せず `Jin.broken`（背水: 攻撃間隔 × `holdAttackIntervalMul` 0.75、もう崩れない。倒し切れば全滅で「制圧」）。全員が逃げたときだけ従来どおり敗走で決着
  - 逃げる敵の手（ユーザーの追加の指摘「普通に追いかけて簡単に倒せる・反撃してほしい・攻撃するリスクが 0」）: **窮鼠** = 体の縁から `rout.turnRadius`（30px）まで詰めると振り向いて普段の攻撃を 1 回返す（`enemies.ts` の `turnOnPursuer` が `beginWindup` で予備動作に入れ、予備動作・攻撃・隙の間だけ普段の状態機械を回す。隙が明けて chase に戻ればまた逃げる。逃げ出して `turnFirstDelay` 0.4 秒は振り向かない・次は `turnCooldown` 2.5 秒後）。**置き土産** = `mudInterval` 1.4 秒ごとに足元へ泥（半径 9px・4 秒。足が 0.6 倍）を撒く
  - 追う得: 撃破の銭 × `ECONOMY.income.routMul` 1.5 → 3。逃げ足 `rout.speedMul` 1.25 → 1.1（泥と窮鼠があるので、追いつけないほど速くはしない）
  - 逃がす損: 眠っている陣に合流すると急報（`alarmJin`。`Jin.alarmed`、その陣はプレイヤーのいた点へ歩き出す。長居の歩き出し `stirSleepingJin` の数には数えない）

- **2026-10-02 起床の見直し（ユーザーの指摘「気付かない所で敵対して、部屋の端まで寄ってくる。部屋の中心へ行かずに全部倒せてしまう」）**: 気付く距離 110 → 70px（`JIN.wake.noticeRange`。`enemies.ts` の `NOTICE_RANGE`）・起こす輪 160 → 80px・音 200 → ダッシュ 90 / 命中 110 / 爆発 140px。起こす輪の中心は「今気付いた者・今聞いた者」（`wakeJin` の seeds）で、誰も気付いていなければプレイヤー（以前は最寄りのメンバー）。自分で気付いた者は 1 輪だけ仲間を起こす（`alertJinNeighbors`。起きた者が次の輪を起こし続けない）。後詰は時間（2.5 秒）で全員を起こすのをやめ、群勢が `reserveMoraleRatio`（0.6）を切ったら `secondWaveDelay`（1 秒）後に出る（`armReserve`）

### 2-8. 同時攻撃の上限と予告の見やすさの上限（3a）

- `strikeSlotsFull` → `strikerCap(state) = ENEMY_TEMPO.strikerBase(2) + floor(awakeNear / ENEMY_TEMPO.strikerPerAwake(3))`。`awakeNear` = 生存・非ボス・`!hidden`・phase ∉ {idle, spawning}・プレイヤーから `strikerCountRadius`(220) 以内。上限なし。`ENEMY_AI.maxSimultaneousStrikers` は削って ENEMY_TEMPO へ
- **予告の見やすさの上限**: `chase()` の `beginWindup` 直前で、予備動作に入ってから `ENEMY_TEMPO.telegraphWindow`(0.3) 秒未満（`windupTotal − phaseTimer < window`）でプレイヤーから 260 px 以内の敵が `telegraphCap`(3) 以上なら `e.attackCooldown = telegraphWindow` にして return（次の窓で再挑戦）。同じ 0.3 秒に赤くなる予告を絞る。ボス・号令のの一斉は数えない（揃うのが号令の意味）
- `coordDelay` 0.2 → **0.35**（JSON のみ）。`strikerHoldTime` 0.1 は残す（上限が伸びるので待ちは減る。probe の集団の完遂率で確認）

### 2-9. 総数 180 → 80〜100

- 置き換え後の見積もり（深度 1、面積倍率 1）: 陣 ≈ 12 × 予算 6（並換算 4〜7）≈ 72 + 長蛇 2〜3 本 × 3 = 6〜9 + 物見 2 = **80〜83**。深度で `budgetPerDepth` 0.8 と `column.count` が伸び、深度 5 で ≈ 100〜110
- つまみ: `JIN.tilesPerJin`（陣の数）→ `JIN.budgetBase / budgetPerDepth`（陣の人数）→ `JIN.column.count`。測る指標は 5 章
- 通常部屋の `enemyCount` は封鎖する部屋の波・ボス取り巻きにだけ残る（`ROOM.baseEnemies` の意味を `_fields` で書き直す）

### 2-10. 決着の報酬・HUD・浮き文字

- 報酬は `clearRoom` のまま（ハート `ROOM.heartDropChance` 0.1・`dropRoomReward`・得点・トリガー）。銭・鍵は段取り 6 で `clearRoom` に足す
- 浮き文字（`/home/user/roguelike/src/data/actionText.ts` に `JIN_TEXT` を足し、リテラルを書かない）: 全滅「制圧」（既存）/ 敗走「敗走」/ 大将撃破「大将撃破」/ 後詰「後詰」。すべて体言止め
- HUD（新規 `/home/user/roguelike/src/render/jinUi.ts`、`drawRunHud` の直後に 1 行で呼ぶ）: 交戦中の陣（`engagedRoomIndex` の塊の陣、無ければ最も近い engaged の陣）について「魚鱗の陣」+ 群勢のバー（`morale / moraleMax`、`JIN.hud.color`）+ 大将名。ボスバーと重ねない（ボス部屋は `drawBossBar` に譲る）。文字は `drawText`、行高 `Math.max(定数, textLineHeight())`
- 頭上の印: 大将に小さな三角（`JIN.hud.leaderColor`）、猛（強）は名前を精鋭と同じ位置に出す（`renderer.ts:1576` の `eliteDisplayName` を `enemyDisplayName`（格の接頭辞を含む）に差し替え。`elites.ts` に 3 行）
- Tips ノート（`meta/tips.ts`）に「陣と群勢」1 項（3b の F レーン）

---

## 3. 型の変更・JSON・テスト・REPLAY_VERSION・壊れるテスト

### 3-1. 新しい balance JSON（`_fields` は親に 1 回）

| ブロック | 置き場所 | 主な項目（初期値） |
| --- | --- | --- |
| `JIN` | `src/data/balance/enemies/JIN.json`（`enemies/_index.json` の `_order` に追加、`tuning.ts` に `export const JIN = BALANCE.enemies.JIN`） | `tilesPerJin` 90 / `minJins` 6 / `maxJins` 14 / `minSpacing` 260 / `minRoomTiles` 24 / `budgetBase` 6 / `budgetPerDepth` 0.8 / `budgetSpread` 0.35 / `densityNearStart` 0.7 / `densityNearEnd` 1.25 / `strongMinDepth` 2 / `gradeWeight {normal 1, strong 2, elite 3, leader 4}` / `strong {hpMul 1.6, poiseMul 1.3, damageMul 1.2}` / `column {base 2, perDepth 0.34, max 4, members 3, spacing 22, minDistFromJin 200}` / `lookout {count 2, noticeMul 2, minDepth 2}` / `wake {radius 160, secondWaveDelay 2.5}` / `morale {routRatio 0.34, leaderBreakRatio 0.2, executeBonus 1, multiKillBonus 1, highRatio 0.75, highAttackIntervalMul 0.85, highPoiseTakenMul 0.85, mergeCapRatio 1.25}` / `rout {speedMul 1.25, maxTime 12, retargetSec 1.0, dropMul 1.5, color}` / `stir {delay 40, interval 25}` / `roamHeartChance` 0.05 / `hud {color, leaderColor}` |
| `FORMATION` | `src/data/balance/enemies/FORMATION/_index.json` + `<key>.json`（1 ディレクトリ = 1 オブジェクト） | 2-6 の形。`_fields`: layout / minDepth / weight / spacing / leader / slots（role・grade・share・min・max） |
| `REACTION` | `src/data/balance/enemies/REACTION.json` | `hitWindowSec` 1.0 / `retreatHits {vanguard 3, charge 2, shooter 1, disruptor 1, support 1, blast 0, swarm 0}` / `retreatDist` 50 / `retreatSec` 0.25 / `punishRoles ["vanguard","charge"]` / `punishBias` 0.7 / `slotRoles ["vanguard","swarm"]` / `slotRadius` 34 / `slotMinPeers` 2 / `slotRange` 140 / `shooterBackstepMul` 0.5 / `retreatAfterStrike {bat 2.2, wolf 1.5, spikeRat 1.5, thief 1.5}` |
| `ENEMY_TEMPO` 追記 | 既存 | `coordDelay` 0.35 / `strikerBase` 2 / `strikerPerAwake` 3 / `strikerCountRadius` 220 / `telegraphWindow` 0.3 / `telegraphCap` 3 / `followUps.skeleton` |
| `FLOOR_LORD` 追記 | 既存 | `captainMaxDepth` 3 / `captainHpMul` 2.5 |
| `ENEMY_AI` 削除 | 既存 | `maxSimultaneousStrikers` を消す（`_order` も） |
| `ROAM` 削除 | 既存 | `fraction / corridorPerTiles / corridorMax / corridorMinDist / reinforceDelay / reinforceInterval / capBase / capPerDepth / capMax / minSpawnDist / offscreenMargin` |

`pnpm run balance:gen` は統合役。`balance.test.ts` の `_fields` 検査に通るよう新しい数値には全部 1 行付ける。

### 3-2. 型の変更（共有ファイルは最小 Edit）

- `core/state.ts`: `Jin` / `JinPhase`（新）、`Enemy.jinId? / grade? / rout? / executed?`、`EnemyAi.hitWindow? / hitCount? / retreat?`、`GameState.jins`
- `core/game.ts`: `jins: []` 1 行
- `data/enemies.ts`: `EnemyDef.role?: EnemyRole` 1 行（type import）
- `data/tuning.ts`: `JIN` / `FORMATION` / `REACTION` の再 export 3 行
- `behaviors/base.ts`: 3 フック + `recoverRetreatMul`
- `floorLord.ts`: 深度 ≤ `captainMaxDepth` なら名「〜の隊長」・HP × 2.5・`makeElitePair(e, pick(eliteKindsForRole 以外の commanding を除いた候補), "commanding")`（精鋭 1 つ + 号令）。`lordName` を 3 行

### 3-3. REPLAY_VERSION

- 3a: 13 → **14**（生成の乱数消費・AI の進行が変わる）。3b: **15**。3c: **16**。各段の統合時に `core/replay.ts:53` と `docs/ARCHITECTURE.md` の版の説明を 1 行

### 3-4. 壊れる / 壊れそうなテスト

| テスト | 何が | 対処 |
| --- | --- | --- |
| `src/system/spawner.test.ts:43-95`（populateCorridors） | 関数を消す | 3a-A が「長蛇の配置」のテストに書き換え（数・通路タイル上・決定性） |
| `src/system/spawner.test.ts:97`、`floor.test.ts:106, 712-757`（roamCap・増援） | 関数を消す | 削除。3b-D で「長居で眠っている陣が長蛇になる」を足す |
| `src/system/floor.test.ts:88, 115`（部屋の抽選回数） | `enemyCount` は残る | 通る見込み。説明文の「部屋に置く」を「封鎖する部屋の波」に |
| `src/system/floor.test.ts:494-560, 650-710`（開放型の交戦・徘徊） | 敵の数・位置 | 「部屋の敵がまとめて起きる」は `wakeJin` 経由で同じ。650 の「一部が徘徊」は長蛇のテストへ |
| `src/system/enemies.test.ts:694-722`（上限 2） | 上限が `2 + floor(3/3)` = 3 になり 3 体目が待たない | 4 体置いて「4 体目が待つ」に。`ENEMY_TEMPO.strikerBase` を読む |
| `src/qa/simulation.test.ts:1551-1594` | `ENEMY_AI.maxSimultaneousStrikers` 参照 | 上限をその step の `strikerCap` で動的に判定（`countEngagedEnemies` を流用） |
| `src/system/floorLord.test.ts` | 深度 ≤3 の名前が「〜の隊長」 | 期待値を分ける |
| `src/system/enemyTempo.test.ts:168-203` | coordDelay を JSON から読む | 通る |
| `src/data/balance/balance.test.ts` | 新 JSON の `_fields` 漏れ | 各レーンが付ける |
| `src/system/floatingText.test.ts` | 新しい浮き文字 | `JIN_TEXT` 定数経由。体言止め |
| `src/core/game.test.ts` / `replay.test.ts` / `simulation.test.ts` の決定性 | 同じ seed で同じ結果を比べるだけ | 通る |
| seed 依存で落ちる可能性: `hiddenRoom.test.ts`・`contractors.test.ts`・`specialRooms.test.ts`・`meta/codex.test.ts`・`quests.test.ts` | 敵の配置の後に引く乱数がずれる | 性質の検証なら通る。特定の部屋番号・敵種を期待していれば seed を選び直す。確認は `pnpm exec vitest run src/system src/meta` |

---

## 4. 段階分けとレーン（`docs/AI_WORKFLOW.md` の作法）

### 前置き（統合役、30 分）: 共通の土台を先に 1 コミット
- `/home/user/roguelike/src/data/enemyRoles.ts`（役割・格・表・`roleOf` / `gradeOf` / `ROLE_ELITE_EXCLUDE`）+ `data/enemies.ts` の `role?` 1 行 + `enemyRoles.test.ts`（「全 behavior に役割がある」「swarm は群れ」「例外の敵」）。A・B の両方が読むので先に置く

### 3a: 陣で配る + 反応 + 上限（遊べる: 決着は全滅のみ）

| レーン | 所有 | 最小 Edit のみ | 編集禁止 | 仕様 |
| --- | --- | --- | --- | --- |
| **A 陣の配りと陣形**（**Opus**。`floor.ts` の乱数順と構造に触る） | 新規 `system/jinSpawn.ts`、新規 `map/formation.ts`、新規 `data/formations.ts`、`balance/enemies/FORMATION/*`、`balance/enemies/JIN.json`、`system/spawner.ts`（通路タイル一覧と長蛇の歩行を残し、他を削る）、`system/floor.ts`（`buildFloor` 159-180、`spawnRoamReinforcement` 削除、`engageRoom` / `lockRoom` を `wakeJin` に）、`system/floorLord.ts`（隊長）、`FLOOR_LORD.json`、`ROAM.json`、`world/_index.json`、`enemies/_index.json`、テスト `jinSpawn.test.ts` / `formation.test.ts` / `formations.test.ts` / `spawner.test.ts` / `floor.test.ts` / `floorLord.test.ts` | `core/state.ts`（`Jin`・`jins`・`Enemy.jinId / grade`）、`core/game.ts`（`jins: []`）、`data/tuning.ts`（`JIN` / `FORMATION`）、`system/elites.ts`（`eliteKindsForRole` 3 行 + `enemyDisplayName` 3 行）、`render/renderer.ts:1576`（1 行） | `system/enemies.ts`、`behaviors/*`、`combat.ts`、`poise.ts` | 2-1（候補）、2-2、2-5 の配り方・起床 3a、2-6 の 4 陣形、2-9、隊長 |
| **B 反応ルール・語彙・上限**（Sonnet。設計済み） | 新規 `system/enemyReactions.ts` + test、`behaviors/base.ts`、`behaviors/families.ts`、`system/enemies.ts`（`chase` / `chaseMove` / `windup` / `recover` / `beginWindup` / `coordinateNearby` / `strikeSlotsFull` / `contactDamageOf` の強の倍率 1 行）、`balance/enemies/REACTION.json`、`ENEMY_TEMPO.json`、`ENEMY_AI/_index.json`（削除）、テスト `enemies.test.ts` / `enemyTempo.test.ts` | `core/state.ts`（`EnemyAi` 3 項目）、`system/combat.ts:194`（`onStruck` 1 行）、`data/tuning.ts`（`REACTION`）、`qa/simulation.test.ts:1551-1594`（動的上限） | `floor.ts`、`spawner.ts`、`jinSpawn.ts`、`floorLord.ts` | 2-3、2-4 の 3a 分、2-8 |

- 接点: B の `slotTarget` は `e.jinId` を読む（A の型）。型は前置きのコミットで `core/state.ts` に **統合役が先に足す**（`Jin` 型と `Enemy.jinId? / grade?` の 4 行）。A・B は同じインターフェースに触らない
- 統合役: `pnpm run balance:gen` → `REPLAY_VERSION` 14 → `pnpm run check` → `pnpm run qa:probe` と `pnpm run qa:full` で 5 章の指標を出し、`JIN.tilesPerJin / budgetBase` で総数を 80〜100 に合わせる

### 3b: 群勢・敗走・大将・後詰・HUD

| レーン | 所有 | 最小 Edit のみ | 編集禁止 | 仕様 |
| --- | --- | --- | --- | --- |
| **D 群勢と敗走**（**Opus**。死亡経路と決定性） | 新規 `system/jin.ts`（`initJinMorale` / `noteJinDeath` / `routJin` / `stepRout` / `updateJins` / `wakeJin` の後詰 / `jinBonusMul` / `stirSleepingJin`）+ `jin.test.ts`、`JIN.json` の morale / rout / wake / stir | `enemyTraits.ts:115`（`noteJinDeath` 1 行）、`enemies.ts`（rout 分岐 2 行・`toChase` 1 行）、`poise.ts:88`（1 行）・`poise.ts` の `tryExecute`（`executed` 1 行）、`floor.ts`（`updateRooms` に `updateJins` 1 行、`clearRoom` の文字 2 行、`lockRoom` にボス陣 2 行）、`loot.ts:81`（1 行）、`core/state.ts`（`Enemy.rout? / executed?`、`Jin.secondWaveAt / deaths*`） | `jinSpawn.ts`（E が所有。`initJinMorale(state, jin)` を最後に 1 行呼ぶのは E） | 2-7、2-5 の起床 3b・増援の代わり |
| **E 陣形の追加**（Sonnet） | `data/formations.ts`、`FORMATION/*`（偃月・方円・物見）、`map/formation.ts`、`system/jinSpawn.ts`（大将スロット・物見の配置・ボス陣 `createBossJin`）+ テスト | — | `jin.ts` | 2-6 の 3b 分、大将の選び方 |
| **F HUD・浮き文字・頭上の印**（Sonnet） | 新規 `render/jinUi.ts` + `renderMath` 系のテスト、`data/actionText.ts`（`JIN_TEXT`）、`meta/tips.ts`（1 項）、`docs/GLOSSARY.md`（陣・群勢を実装済みに、猛・後詰・大将撃破を追加） | `render/renderer.ts`（HUD 呼び出し 1 行・頭上の印 1 行）、`render/runUi.ts`（不要なら触らない） | system 全部 | 2-10 |

- D と E の接点は `initJinMorale(state: GameState, jin: Jin): void` の 1 関数（この文書で固定）。D が先に空実装を置いてもよい
- 統合役: `REPLAY_VERSION` 15。フル QA の「決着の内訳」と「敗走の合流 / 討伐」を見て `routRatio / leaderBreakRatio` を決める

### 3c: 残り（各 1 レーン、独立）
- **G** 鋒矢・衡軛（`onRecoverEnd` フックで列の入れ替え）
- **H** 跳躍 `leaper` behavior + skeleton の章 2 連撃 + 章で覚える段の枠（`ENEMY_TEMPO.followUps` の形を `depthStages` に広げる）
- **I** 音で起きる（ダッシュ・命中・爆発で 200 px、歩きは起こさない）+ 物見の鐘（既存 `bellImp` の音を流用）
- **J** 陣の目的（破壊・護衛で敵が対象を狙う）は段取り 6 の報酬（銭・鍵）と一緒に。精鋭 21 → 12 も別レーン

---

## 5. 調整つまみと測る指標

| 目標 | 物差し | つまみ（優先順） |
| --- | --- | --- |
| 総数 80〜100（深度 1〜3） | フル QA に **「生成直後の敵の総数（深度帯別の平均）」「陣の数・陣あたり人数・陣形の出現数」** を足す（`simulation.test.ts` が `descend` 直後の `state.enemies.length` と `state.jins` を数える。既存の「平均生存敵数」の隣） | `JIN.tilesPerJin` → `budgetBase / budgetPerDepth` → `column.count` |
| 空き地の解消 | 既存の時間配分「非交戦（移動・探索）」（`buildCombatSection`）。目標: 寝ている敵の近くの時間 42% → 25% 以下 | `JIN.minSpacing`（小さいほど密）→ `column.count` → `stir.interval` |
| 交戦の長さのばらつき | 既存の「交戦 平均 / 中央値 / 最大秒」 | `budgetSpread` → `densityNearStart / NearEnd` |
| 決着の内訳 | 新指標 **「決着: 全滅 / 敗走（うち大将撃破）」「敗走した敵: 合流 / 討伐 / 逃げ切り」** | `morale.routRatio`（0.34。上げると早く崩れる）→ `leaderBreakRatio` → `rout.speedMul` |
| 集団の被弾 | probe の集団に **陣形プリセット**（魚鱗 5・鶴翼 6・雁行 4。`runGroup` に `keys` を役割から組む補助を足す）。列 **「同時に赤い予告の最大」「予備動作の待ち（strikerHold）秒」** を追加 | `ENEMY_TEMPO.telegraphCap`（3）→ `coordDelay`（0.35）→ `strikerPerAwake`（3） |
| 反応が効いているか | probe 1 対 1 に **「間合い取り / 60 秒」「隙狙いで縮んだ秒の合計」** を足す（`ai.retreat` の立ち上がりと `attackCooldownRate > 1` の step を数える）。期待: 連打 bot の被弾は上がり、連打+ダッシュはほぼ変わらない | `REACTION.retreatHits.vanguard`（3）→ `punishBias`（0.7）→ `retreatDist`（50） |
| 完遂率 60〜80% を保つ | 既存の完遂率（1 対 1・集団） | `strikerHoldTime` → `telegraphCap` |
| 難易度 | 既存の到達深度・死因 | 上の順で。敵の HP は段取り 4 |

---

## 6. 不確かな点（推奨を 1 つ決めて書く。統合役が確定）

1. **強の接頭辞**: 「猛」（猛スライム・猛骸骨兵）を推奨。代案「大」は大蝦蟇と衝突、「強」は日常語で世界観語でない。GLOSSARY に 1 行。ユーザーに聞く
2. **第 2 波の語**: 「後詰」（ごづめ）を推奨。日常語の「増援」は縛り・ランイベントで別の意味に使っている。読みが難しければ「第二波」
3. **敗走の行き先が無いとき**: 12 秒逃げて画面外なら消える（報酬なし）を推奨。代案「その場で 1 体の陣として眠る」は空き地を作る
4. **陣のメンバーに `rollElite` を通さない**: 陣形が精鋭を決めるので通さない（推奨）。深度 3〜5 の精鋭の出現数が今より減るかはフル QA の「精鋭修飾子の出現数」で確認し、足りなければ雁行・魚鱗に精鋭スロット（share 0.15、`minDepth` 4）を足す
5. **隙を狙う条件の `dashChargesLeft === 0`**: 1 回 1.2 秒なので「ダッシュ直後の 1.2 秒は敵の時計が 1.7 倍」になる。強すぎれば `punishBias` を 0.4 に落とすか、ダッシュの条件を外して終撃・受け流し外しだけにする。probe の連打+ダッシュ bot の被弾（今 slime 深度 1 で 0.0）が 3 を超えたら見直す
6. **上限の数え方 `awakeNear` にボスの取り巻きを含めるか**: 含める（推奨。ボス自身は数えない）。ボス戦の被弾が跳ねたら `strikerCountRadius` を縛る
7. **長蛇の目的地**: 先頭だけが `pickRoamTarget`、他は写す（推奨）。列が伸びて分断されるなら `nextWaypoint` を先頭の位置へ向ける
8. **`ROAM` の削除範囲**: `roamSpawnPoint` は `floor.ts` からしか呼ばれていない（grep 済み）。盗賊のランイベントは `spawnReinforcements` 経由なので無事。削る前に `pnpm exec tsc --noEmit`
9. **決着の報酬を陣ごとに変える（陣形で違う）**: 今回はしない。段取り 6 の銭・鍵で「大将のいる陣は鍵」のように差を付ける
10. **QA bot が敗走した敵を追いかけて時間を溶かす**: bot は部屋の敵か近くの徘徊を狙う（`bot.ts:860-881`）。敗走敵は `ROAMING_ROOM` なので「近くの徘徊」扱いで追う可能性。フル QA の時間配分が悪化したら `bot.ts` で `e.rout` を無視する 1 行

## 資料に必要な変更（統合役）
- `docs/CODE_MAP.md`: `data/enemyRoles.ts` / `data/formations.ts` / `map/formation.ts` / `system/jinSpawn.ts` / `system/jin.ts` / `system/enemyReactions.ts` / `render/jinUi.ts` を 1 行ずつ。`spawner.ts` の説明から「populateCorridors・増援」を消し「長蛇の歩行」に。`floor.ts` に「陣の配置は jinSpawn」。`enemies.ts` の説明に「反応の 3 フック・上限は `strikerCap`」
- `docs/ARCHITECTURE.md`: 「フロアと部屋」節に「陣」の段を足す（部屋の上に乗る・roomIndex は塊・敗走で ROAMING_ROOM）。`REPLAY_VERSION` 14〜16。主要な型に `Jin`
- `docs/recipes/enemy.md`: 「役割は `ROLE_BY_BEHAVIOR` で決まる。違うなら `role:`」「陣形に入れたいなら FORMATION の slot の役割に合うか」
- 新レシピ `docs/recipes/formation.md`（陣形の足し方: JSON 1 つ + `FORMATION_KEYS` + layout）。CLAUDE.md の表に 1 行
- `docs/GLOSSARY.md`: 陣・陣形・群勢を実装済みに、猛・後詰・大将撃破・敗走（陣）・物見・長蛇
- `docs/BALANCE.md`: `JIN` / `FORMATION` / `REACTION`、`ROAM` の縮小
- `docs/COMBAT_DESIGN.md`: 同時攻撃の上限・予告の見やすさの上限・反応ルール
- `IDEAS.md` 現状、`docs/HANDOFF.md`、`CHANGELOG.md`