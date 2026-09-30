# 祝福・スキル・遺物の実装設計（段取り 7）

作成日: 2026-09-30
前提: `docs/ideas/core-synthesis.md` 9 章の段取り 7。architect の設計をそのまま置く。6 章の ★（ユーザー確認）は、ユーザーの「進められる限り自走して」の指示を受けて統合役が推奨で仮に決めた（下の表）。**永続データを消す ★1・★2・★8 は 7c・7d に入る前にユーザーに確認する**（7a・7b はラン内の話なのでセーブを消さない）。

## 決めたこと（統合役、2026-09-30。ユーザーに報告して変えられるようにする）

| 項目 | 決定 |
| --- | --- |
| ★1 手持ちの刻印符 | 推奨は「消す」。**7c の前にユーザー確認**（保留） |
| ★2 武器技の石 | 推奨は `LEGACY_SKILL_MAP` で共通技へ写し、写せないものは消す。**7c の前にユーザー確認**（保留） |
| ★3 名前 | 輪廻 / 眷属 / 財宝、格 4・5 = 至高 / 極致、昇華「劫火」、「不断」で確定。「標的」は狩人の札に使わない |
| ★4 3 枠目 | 昇華と名のある遺物の 2 つだけ |
| ★5 芯 | 8 → 4（章ごとの選び直しは入れない） |
| ★8 倉庫の遺物の性質 | 推奨は「消えた分だけ margin +1」。**7d の前にユーザー確認**（保留） |
| 6・7・9〜13 | 6 章の推奨どおり |

---

## 結論（3 行）

- 祝福は **9 系譜 × 札 4 種（加護 5 / 摂理 3 / 研鑽 2 / 昇華 1 = 11）+ 融合 12 + 呪い 6 + 芯 4 ≒ 121 種** に作り直し、提示を「出口の予告で選んだ 1 系譜の 3 枚」に変える。加護は行動 5 つ（左 / 右 / ダッシュ / スキル / 奥義）に 2 枠、3 枠目は昇華・名のある遺物で開く。既存の抽選（`boonWeight`）・格（`boonGrade.ts`）・Rule / Modifier の器はそのまま使い、系譜・札種・行動・融合の 4 つのメタデータを `BoonDef` に足す。
- スキルは技 322 → 共通技 60（武器種の縛りを外し、型ごとの **変形表** `ArtTransform` で形を変える）+ 手書き 45、刻印符は 53 → 30 で **ラン内のみ**（`SkillProfile.runes` / `SkillStone.runes` を廃止し、既存の `SkillSlotState.runModifiers` を唯一の経路に。スロットのリンクは固定 4 / 3 / 2 / 2）。遺物は性質 212 → 約 70・転じ 12・誓約 20・名のある遺物 18（全部固有コード）、**色の共鳴・星座・陰画・拮抗を「源と糧の共鳴」に置き換え**（名前は共鳴のまま）、ステータス振り分けは撤去して錬磨（札の格 1〜5）と改鋳に委ねる。
- 段は **7a 祝福の骨格 → 7b 祝福の中身 → 7c スキル → 7d 遺物 → 7e 数値合わせ** の 5 段。各段で遊べる。`REPLAY_VERSION` は 26 → 27 / 28 / 29 / 30（7e は数値だけなら 31 を切る）。セーブは `roguelike.skills.v1` / `roguelike.profile.v1` とも **v2 を切らずに済む**（欠けたフィールドの読み捨てと key の写し表で足りる）が、**手持ちの刻印符は全て消え、武器技の石の 7 割は共通技に写る**。これはユーザー確認（6 章 ★1・★2）。

---

## 1. 今のコードの地図（根拠。行番号つき）

### 1-1. 祝福

| 何 | どこ | 観察 |
| --- | --- | --- |
| 定義 | `/home/user/roguelike/src/system/boonDefs.ts:27-160`（`BOON_KEYS`）、`:222-254`（`BoonDef`: key / name / desc / icon / rarity / tags / gives / cursed / requires / lineage / after / duo / loadout / rules / modifiers / keywords / core / graded） | **200 種**（実測。`BOON_KEYS` + Wave2 + Wave3）。内訳: rules 型 115 / modifiers 型 1 / **フック直書き 84**。rarity common 91 / rare 83 / epic 26。呪い付き 25、芯 8、系譜 6 × 4 段 = 24（`after` 18）、結び（`duo`）17、loadout 31、requires 15 |
| 系譜 | `boonDefs.ts:201-212`（`LineageKey = ash | frost | thunder | moon | earth | blade`、`LINEAGE_LABEL`）。次段の条件は `after`（`:238-239`）、4 段目は `requires` も見る（`:941-956` 焦土） | 月蝕の中身は今「マナ・スキル・沈黙」（`:87-91` moonRead / highTide / newMoon / eclipse）。build-core 4-4 の月蝕（宣告・代償）と食い違う → 今の月蝕 4 種は「輪廻」（旧 巡り）へ写す |
| 抽選 | `/home/user/roguelike/src/system/boons.ts:240-259`（`boonWeight`: 取得済み / loadout / requires / after / duo → 0、タグ一致 `tagBonus` 1.5、系譜 ×2、結び ×3、芯タグ ×2）、`:286-303`（`takeWeighted`: `state.rng.next()` 1 回）、`:319-345`（`rollBoonOptions`: 呪い枠 `cursedChance` 0.4、同じ系譜 / 結びは 1 枚まで `dropSiblings`）、`:388-402`（`offerBoons(state, boost)`: depth < 2 は出さない、`coreDepth` 2 で芯 3 択） | 提示の出所は `floor.ts:910`（階段。`stairsGradeBoost`）、`offerBoonsFromRule`（`boons.ts:414-426`、試練の徒）、`specialRooms.ts` / `contractors.ts` / `runEvents.ts`（import 一覧 `rg 'from "./boons"'`）。**系譜の次段が 3 択に出る確率 3.9%** は重み ×2 の構造そのもの（候補 88〜100 種から 3 枚） |
| 3 択の UI と入力 | `boons.ts:477-563`（`BOON_CARD` / `boonCardRect` / `selectedIndex`: skill1 = 1 枚目・skill2 = 2 枚目・attack = 3 枚目・skill4 = 4 枚目・クリック）、`:565-590`（`chooseBoon` / `grantBoon`）、描画 `/home/user/roguelike/src/render/boonUi.ts:1-120`（系譜の注記 `COLOR_LINEAGE`、段数をたどる `LINEAGE_MAX_DEPTH`） | step のゲートは `/home/user/roguelike/src/core/game.ts:157-164`（`boonChoice` → `reforgeChoice` の順） |
| 格 | `/home/user/roguelike/src/system/boonGrade.ts:14`（`BoonGrade = 1 | 2 | 3`）、`:46-51`（`rollGrade`: 乱数 1 回 + boost）、`:57-61`（`isGraded`: Rule の効果量があれば自動 opt-in）、倍率 `BOON.gradeMagnitudeMul [1, 1.5, 2.2]`・`gradeRadiusMul`・`gradeIcdMul`（`/home/user/roguelike/src/data/balance/boons/BOON.json:340-356`） | 格は `state.boonRun.grades` に別持ち（`boons.ts:121-124`）。取得後に上げる口は無い |
| 芯 | `/home/user/roguelike/src/system/boonCores.ts:91-106`（`CORE_FOLDS` 7 件の stats 畳み込み）、`:108-128`（抽選への割り込み） | 8 種のうち「操作の形」は 呪い喰い / 拍の刻 / 逃げ水 / 血の巡り の 4、残り（硝子の心 / 満ち潮の器 / 鉄の巨人 / 病み喰い）は数値の入れ替え |
| フック結合 | `boons.ts:608-636`（`foldBoonStats` 13 件の if）、`:731-1047`（`onBoonSwing` … `onBoonHeartPickup` 約 25 本）。呼び元は `combat.ts:26` / `player.ts:74` / `skills.ts:106` / `floor.ts:49` / `projectiles.ts:9` / `manaSources.ts:7` / `dashForms.ts:11` / `ultimates.ts:25` / `jinSpawn.ts:12` / `boss.ts:8` / `skills/hit.ts:9` | 拡張ルールの作業領域 `BoonRuleState`（`/home/user/roguelike/src/system/boonRules.ts:93-…`、31 フィールド）。`direct: true` の Rule は 2 か所（`rg "direct: true" src` 2 件） |
| Rule / Modifier の器 | `/home/user/roguelike/src/core/rules.ts:21-104`（条件 45 種）、`:114-180`（効果 60 種超）、`:255-280`（`Rule`）、`:357-412`（`PerCounter` 13 種 / `Modifier`）。照合順 `/home/user/roguelike/src/system/rules.ts:112-129`（ジョブ → 武器種 → 改鋳 → 持続奥義 → 祝福の取得順 → スキルスロット）、Modifier の集め方 `/home/user/roguelike/src/system/modifiers.ts:35-47` | 起点は `/home/user/roguelike/src/core/events.ts:14-71`（共通の瞬間 6: onFirstStrike / onFinisher / onBrim / onRelease / onRiposte / onTwinStrike、銭 3、瓶、受け流し） |
| 3 択の再利用例 | `/home/user/roguelike/src/system/reforge.ts:20-118`（`ReforgeChoice`、`cardIndexAt` を借用、`REFORGE.perRun` / `offerCount`） | 融合・錬磨の選択 UI はこの形をなぞる |

### 1-2. スキル・刻印符

| 何 | どこ | 観察 |
| --- | --- | --- |
| 数 | `SKILL_KEYS` **398**（`/home/user/roguelike/src/skills/types.ts:136-141`: LEGACY 76 + `ART_SKILL_KEYS`）、`COMMON_ART_KEYS` 24、武器技は `WEAPON_ART_KEYS`（`/home/user/roguelike/src/skills/arts/keys.ts:36-395`、武器種ごとの表。計 298）、刻印符 `MODIFIER_KEYS` **53**（`types.ts:144-214`） | 技は `ArtSpec.moveset`（`arts/types.ts:103-122`）で武器種に縛る。行為の種類 `ART_ACT_KINDS` = arc / ring / line / dash / blink / shot / chain / pull / buff / detonate（`arts/types.ts:19`） |
| 抽選 | `/home/user/roguelike/src/skills/generator.ts:58-70`（`skillWeight`: 装備中の武器技を厚く `ART.weights.matched / other`）、`:73-87`（`stoneFromSeed`: links は `SKILL.linkWeights [30,45,20,5]`）、`:97-105`（`rollRuneModifier`: 装着中スキルに付けられる符から）、`:122-130`（`rollRuneDrop`） | ドロップ率 `/home/user/roguelike/src/data/balance/skills/SKILL/drop.json`（`stoneOnKill` 0.03、`runeOnKill` normal 0.01 / elite 0.12 / boss 0.6） |
| 永続 | `/home/user/roguelike/src/skills/persistence.ts:26`（`roguelike.skills.v1`）、`:94-118`（`sanitizeStone`: 知らない `skillKey` は `isSkillKey` で捨てる。`runes` / `wear` は省略可）、`:185-209`（`loadSkillProfile`: 石の符で付けられないものを所持品へ戻す）、`SkillProfile.runes?`（`types.ts:516-523`）、`SkillStone.runes? / links`（`:477-494`） | **step の中で保存している**: `system/loot.ts:248`（石の拾得）、`system/skills.ts:2174`（符の拾得）、`skills/wear.ts:51`（芽）。不変条件 8 とずれる既存の負債。符のラン内化で `skills.ts:2174` は消える |
| ラン内の符 | `/home/user/roguelike/src/system/skills.ts:285-302`（`effectiveSlotModifiers` = 石の符 + `runModifiers`、`syncSlotModifiers`）、`:2110-2164`（`attachRune`: リンクに収まるスロットへ、溢れたら古い順に押し出す）、`:2170-2199`（`grantRune` → 所持品へ保存、`updateRunes` 床の符の拾得） | 起点「詠み手」は既に `attachRune` のラン内経路（`/home/user/roguelike/src/system/runSetup.ts:266`） |
| 芽 | `/home/user/roguelike/src/skills/wear.ts:39-53`（節目で link / power の芽。乱数なし） | 「枠」の芽は `stone.links += 1` |
| 連携 | `/home/user/roguelike/src/skills/combos.ts:16-34`（`ComboDef`: after / window / apply / requires）。直前 1 件（`SkillRunState.lastCast`）、技は対象外 | 直近 3 件はこの段では触らない（build-core 4-3 の「直近 3 件」は 7c の任意） |

### 1-3. 共鳴・ステータス振り分け・性質・遺物・キーワード

| 何 | どこ | 観察 |
| --- | --- | --- |
| 色の共鳴 | `/home/user/roguelike/src/loot/resonance.ts`（1069 行: 支配 / 二重 / 三和音 / 散光 `:226-285`、効果表 `:357-709`、陰画 `:626`、拮抗 `:686`、星座 `:878-1069`、`ATTR_LABEL :780`）。畳み込みは `/home/user/roguelike/src/loot/stats.ts:240-260`（手順 2・3・5） | 参照 201 か所 / 39 ファイル（`resonance` で grep）。UI は `render/inventoryUi.ts`・`loot/describe.ts`・`render/lootUiParts.ts`（17 か所）、部屋「共鳴炉」`system/specialRooms.ts:132, 1052-1060`（`state.stats.resonance.colors` を読む）、`ATTR_LABEL` は `ui/attributeAlloc.ts:4` も import |
| 語（源 / 糧 / 強める） | `/home/user/roguelike/src/core/keywords.ts:7-56`（48 語）、`:119-123`（`KeywordProfile` produces / consumes / amplifies）。集計 `/home/user/roguelike/src/system/keywords.ts:489-499`（`buildProfile` = 装備 + 石と符 + 祝福）、`:529-537`（`affinity`） | 「強める」は表示専用（build-core 1-2）。流儀（`JobDef.keywords`、`/home/user/roguelike/src/data/jobs.ts:94`）は `buildProfile` に入っていない。**共鳴の後継はこの集計に載せる** |
| 振り分け | `GameState.runAttributes`（`/home/user/roguelike/src/core/state.ts:1068-1073`）、`/home/user/roguelike/src/ui/attributeAlloc.ts`（113 行）、`/home/user/roguelike/src/system/attributes.ts:71-75`（`addRunAttributes`）、`player.ts:205`、点の配り `floor.ts:919, 1005-1009`（`ATTR_GAIN.perFloor / perBoss / perFloorLord`）、起点 `runSetup.ts:260, 263, 294`、契約 `contractors.ts:790`、リプレイ `core/replay.ts:110, 571-592, 737`、bot `qa/bot.ts:545-551`、描画 `render/attributeUi.ts:68-121`、Tips `meta/tips.ts:119` | 撤去はこの 12 か所 |
| 性質 | `/home/user/roguelike/src/loot/affixes.ts:95-127`（`AffixDef`: tags / slots / family / curve / stage / apply）、`AFFIXES` **212**（`:411`）、`CONVERSION_AFFIXES` 41（`:2831`）、`KEYSTONES` 37（`:3418`）、`IMPLICITS` 92 | 発見深度で決まる期待値は既に `nominalAt(def, itemLevel)`（`/home/user/roguelike/src/loot/flux.ts:133`）で生成時に確定し値を保存する。**性質は発見深度固定 = 現状どおりで手を入れない**。地金は `innateAt(item, depth)`（`/home/user/roguelike/src/loot/innate.ts:326`）で段取り 4 実装済み |
| 名のある遺物 | `/home/user/roguelike/src/loot/named.ts:13-23`（`UniqueDef`: affixes の束 + keystone。**rules / modifiers を持つものは 0**）、`UNIQUES` 76 | `EventSource.kind` に `"item"` はある（`events.ts:80`）。固有コードの置き場は `UniqueDef.rules? / modifiers?` を足せば `collectRules` に載る |
| 性質のフック | `/home/user/roguelike/src/system/traitHooks.ts:73-…`（`targetBonus`: `stats.traits` を読む条件付き加算） | 条件の族はここの if 群を `Modifier`（`if` + `per`）へ移す形になる |
| 移行 | `/home/user/roguelike/src/loot/migrate.ts:10-22`、`/home/user/roguelike/src/loot/profile.ts:28-34`（`roguelike.profile.v1`、version 1 据え置き）、`:68`（`sanitizeRoll`） | 知らない性質 key は `applyRoll` が false を返して黙って効かない（`affixes.ts:4771`）。写し表を足す場所は `migrate.ts` |

### 1-4. 段取り 4〜6 で用意済みの土台（この段で乗るもの）

- 増と倍: `PlayerStats.increased / more / modifiers`（`/home/user/roguelike/src/loot/types.ts:386-393`）、`DAMAGE_TAGS` 24（`/home/user/roguelike/src/core/damage.ts:13-39`。`release` を含む）
- 常時の増と倍・「〜につき」: `Modifier` + `PerCounter`（combo / targetStatusKinds / targetStacks / selfStatusKinds / nearbyEnemies / chainVisits / missingHpTenths / stat 5 種 / runKills / morale / coins / coinsEarned / coinsSpent）
- 連鎖係数 `procCoefficient`・訪問回数（`core/rules.ts:238-239, 346-350`）
- 共通の瞬間 6 イベント（`/home/user/roguelike/src/system/moments.ts`）、戦意（`system/morale.ts`）、改鋳 30（`/home/user/roguelike/src/data/reforges.ts:31-95`）、流儀のダッシュと気力の源（`jobs.ts:79-97`。`boonFired` の源 = 巫女）
- 銭の口: Rule 効果 `gainCoins / spendCoins / scatterCoins`、条件 `coinsAtLeast`、`PerCounter coins / coinsEarned / coinsSpent`、見本 3 枚（懐 / 守銭 / 拾銭、`boonDefsWave3.ts:396-415`）
- 分岐路: `StairsChoice { tile; nextKind }`（`/home/user/roguelike/src/system/specialRooms.ts:110-113`）、`planForkStairs`（`:1188-1197`、`state.rng` 消費は `forkMin..forkMax` の 1 回 + `pickFloorKinds`）、`descend(state, nextKind)`（`/home/user/roguelike/src/system/floor.ts:914-940`）
- 計測: `qa/gearPower.ts:129`（`measureGearPower`）、`src/qa/probe.md:501-512`（地力 ÷ 敵の生命: 深度 5 0.66 / 10 0.57 / 15 0.44 / 20 0.40。Σ増（近接）は +10〜27% しか無い = 性質の増が薄い）

---

## 2. 設計

### 2-1. 系譜 9 と札 4 種（型）

**推奨**: `LineageKey` を 9 に広げ、全ての通常祝福に系譜と札種を必須で持たせる。呪い付き・芯だけが系譜を持たない。

| key | 表示 | 軸（5 章の行列の行） | 流儀の専用系譜（`JobDef.lineage`） |
| --- | --- | --- | --- |
| `ash` | 灰燼 | 燃焼（源） | 錬金術師 |
| `frost` | 霜枷 | 冷気・凍結・砕き | — |
| `thunder` | 雷鳴 | 連鎖・速さ・感電 | 狩人 |
| `moon` | 月蝕 | 宣告・遅れて来る傷・生命の代償 | 呪術師 |
| `earth` | 大地 | 怯み・重さ・壁 | 盾持ち・槍兵 |
| `blade` | 刃鳴 | コンボ・手数・分身 | 剣士・拳闘士・影 |
| `cycle` | **輪廻**（旧 巡り） | 気力・スキル・奥義ゲージ | 術士・書 |
| `horde` | **眷属**（旧 群れ） | 従魔・設置物 | 陰陽師・手鈴 |
| `wealth` | **財宝**（旧 財） | 銭 | 賭博師の起点 |

- 名前は 2-1 の原則（二字熟語）に合わせて 巡り → 輪廻 / 群れ → 眷属 / 財 → 財宝 を推奨（★6-3 ユーザー確認。「財」は $14 で「大賛成」を得た名なので変えるなら確認）。衝突検査済み: 輪廻は `loot/resonance.ts:614` の色の共鳴の効果名にだけあり、その表は 7d で消える。眷属・財宝は `src/` に無い
- 見習いは専用系譜なし。代わりに祝福の出口が 1 つ多く並ぶ（2-3）

**札 4 種**（`BoonCard = "grace" | "law" | "temper" | "apex"`）

| 札 | 数 / 系譜 | 中身 | 規則 | 実装の形 |
| --- | --- | --- | --- | --- |
| 加護 grace | 5（左 / 右 / ダッシュ / スキル / 奥義に 1 枚ずつ） | 行動に宿る。形・属性・追加の動きが付く | 1 行動に 2 枠（2-2）。同じ系譜の加護は 1 行動に 1 枚 | `rules`（起点はその行動のイベント: 左 = `onSwingHit / onFinisher` + `lane: primary`、右 = `onRelease / onRiposte / lane: secondary`、ダッシュ = `onDash / onDashEnd`、スキル = `onSkillCast / onSkillHit`、奥義 = `onBurst`）。スキルの加護は **全スロットに刻印符を 1 枚足す** `grantsModifier?: ModifierKey` でも書ける（反響・貫き・分裂など。2-9 と共有） |
| 摂理 law | 3 | 常時のルール | 枚数の制限なし | `modifiers`（常時の増・倍・条件付き）か `rules`（常時の起点） |
| 研鑽 temper | 2 | ラン中に上限なく育つ | 制限なし。**溜まる源は必ずプレイヤーの行動** | 新: `tally`（数え）。Rule 効果 `{ kind: "tally", key }` が `boonRun.tallies[key]` を +1（撃破・付与・応手…）し、Modifier の `per: { count: { kind: "tally", key }, every, cap? }` が読む。stats に効く研鑽（最大気力 +1 / 撃ったスキル）は `BoonDef.temperStat?: { tally, stat, per, every }` を `foldBoonStats` が畳む |
| 昇華 apex | 1 | 系譜の頂点。倍と循環の完成形 | **その系譜の札を 4 枚以上持つと次の提示に確定で 1 枚入る**。取ると **その系譜の加護が乗っている行動の枠が +1（3 枠目）** | `rules + modifiers` + 必要なら `BoonRunState` の小さな状態（2-6 の「新しい効果」） |

型（`/home/user/roguelike/src/system/boonDefs.ts` の `BoonDef` に足す・消す。実装は 7a）:

```ts
export type BoonCard = "grace" | "law" | "temper" | "apex";
export type BoonAction = "primary" | "secondary" | "dash" | "skill" | "ultimate";
/** 柱 7 の審査: 何が変わるか（press = 押すもの / timing = 押す時 / position = 立つ場所 / target = 狙う相手 / watch = 見るもの） */
export type BoonChange = "press" | "timing" | "position" | "target" | "watch";
interface BoonDef {
  … 既存 …
  lineage?: LineageKey;            // 通常の札は必須（呪い・芯は無し）。テストで強制
  card?: BoonCard;                 // 同上
  action?: BoonAction;             // card === "grace" のとき必須
  fusion?: readonly [LineageKey, LineageKey];  // 融合（結び duo の後継）
  changes: BoonChange;             // 全ての札で必須（量の方針 2-12）
  grantsModifier?: ModifierKey;    // スキルの加護: 全スロットに符を足す
  temperStat?: TemperStat;         // 研鑽が stats に効くとき
  // 消す: after / duo / rarity（重みは card と系譜で決めるので不要。色は card の色に）
}
```

`rarity` は消す（`BOON.rarityWeight / rarityColor` も）。札の色は card ごと（`BOON.cardColor`）。

### 2-2. 加護 2 枠

- 枠数: `graceSlotsOf(state, action) = BOON.graceSlots (2) + (昇華で開いた ? 1 : 0) + stats.graceSlotBonus[action]`、上限 `BOON.graceSlotsMax (3)`。状態は `BoonRunState.graceOpen: Partial<Record<BoonAction, number>>`（昇華で +1）、名のある遺物は `PlayerStats.graceSlotBonus: Partial<Record<BoonAction, number>>`（既定 `{}`。7d で「双頭の蛇」が右に +1）
- 今の加護の一覧は `state.boons` から導く（`gracesOf(state, action) = state.boons.filter(k => BOONS[k].card === "grace" && BOONS[k].action === action)`）。別の配列は持たない（取得順が Rule の照合順なので `state.boons` を正とする）
- 抽選: `boonWeight` に「同じ行動に同じ系譜の加護がある → 0」を足す。枠が満ちている行動の加護は **出す**（入れ替えの判断を促す）
- 入れ替え: `chooseBoon` で加護を選び、その行動の枠が満ちていれば `state.boonChoice` を閉じずに **第 2 段** `boonChoice.replace = { incoming, action, outgoing: BoonKey[] }` にし、札を「今の加護 N 枚 + 見送り」に差し替える（同じ `selectedIndex` の入力で選ぶ。見送り = 新しい札を取らない）。選んだ加護は `removeBoon`（`/home/user/roguelike/src/system/contractors.ts:610-615` を `boons.ts` へ移して共用。格も `boonRun.grades` から消す）→ `grantBoon(incoming, grade)`。融合の条件（2-4）は grant 後に評価
- UI: `render/boonUi.ts` に行動の見出し（「左 1/2」など。`keyLabel` でキー名）と、第 2 段の「入れ替える札を選ぶ」の題。右下の取得済みアイコン列は行動ごとに 5 列へ並べ替え
- 3 枠目の開け方は 昇華（その系譜の加護が乗っている行動）と名のある遺物の 2 つ。**錬磨では開かない**（錬磨は格の道に一本化。理由: 判断の軸を「格を上げる」1 つに保つ。core-synthesis 3-11 は「昇華・名のある遺物・錬磨で開く」と例示だが 3 つの口は多い。★6-4）

### 2-3. 出口の予告と系譜を選ぶ仕組み（6f を祝福込みで実装）

`run-arc.md` 3 章 A 案をそのまま入れ、報酬「祝福」に系譜名を添える。economy-impl の「6f は祝福なしの縮小版」は撤回し、この段で祝福込みで入れる（祝福の総数を変える作り直しと同じ段なので）。

- 型: `ExitReward = { kind: "boon"; lineage: LineageKey } | { kind: "relic" } | { kind: "coins" } | { kind: "key" } | { kind: "flask" } | { kind: "danger" } | { kind: "temper" }`。`StairsChoice.reward: ExitReward`。`GameState.pendingExit: ExitReward | null`（`descend` が渡し `buildFloor` の末尾で消す）
- 抽選（`system/exits.ts` 新規。`planForkStairs` の中、`pickFloorKinds` の直後に `state.rng` から引く）: 重みは `EXIT.weights`（boon 3 / relic 3 / coins 2 / key 1 / flask 1〔生命 5 割以下のときだけ〕/ danger 2 / temper 2〔格の対象の札を 1 枚以上持つときだけ〕）。規則: 1 階に少なくとも 1 つは祝福（`EXIT.boonGuaranteed`）、同じ報酬を並べない、深度 1 は boon / relic / coins だけ、章ボス階（5 / 10 / 15 / 20）は全部 boon で格 +1（既存 `stairsGradeBoost`）、隠し部屋・案内人の追加階段は `{ kind: "none" }` 表示
- **系譜の選び方**（`rollExitLineage`）: 候補 = 残りの札がある系譜。重み = 1 × 持っている札の数につき `EXIT.lineageOwnedMul`（1.8）× 流儀の専用系譜なら `EXIT.lineageJobMul`（1.5）× 既存のタグ一致（系譜に `tags` を持たせ `buildTags` と照合。今の `boonWeight` の `tagBonus` を系譜単位に移す）。同じ階の 2 つの祝福の出口は違う系譜。見習いは `forkMax + 1` 本目の階段を祝福で足す（`addForkStair` の形）
- 到着時: `offerBoons(state, boost, lineage)`。**提示は選んだ系譜の 3 枚**（加護 / 摂理 / 研鑽 から重み付きで、`dropSiblings` は「同じ card × action」に変える）。昇華の条件を満たしていれば 1 枚目に確定、融合が待っていれば（2-4）1 枚目に確定（両方なら昇華 → 融合）。呪い枠（`cursedChance`）は据え置き（呪いは系譜を持たない枠として 3 枚のうち 1 枚に混ざる）。芯の提示（深度 2 の最初）は据え置き
- 「祝福の出口を選ばなかった階は 3 択が出ない」ので 1 ラン 20 階で 12〜16 回。減った分は格の底上げ（`gradeBoostAfterBoss` 4 回）で受ける
- 錬磨の出口（2-5）・遺物（到着報酬確定 = `LOOT_DROP.depthArrivalChance` を 1 に）・銭（到着時の銭 ×3）・鍵 / 瓶（床に 1 つ）・危険（巣窟 / 闘技場 / 試練を 1 つ強制、制圧報酬 2 倍）は run-arc 3-2 の表のとおり
- 表示: `render/exitUi.ts`（新規。階段の上に 2 行、近づくと明るく。`drawText` / `textLineHeight`）、`render/minimap.ts` の階段の点に報酬の色。Tips「出口の予告」1 項目

### 2-4. 融合（結びの後継）

- 条件（3-11）: **違う 2 系譜の加護が同じ行動に乗った瞬間**。`grantBoon` の末尾で `state.boonRun.fusionDue` に、その 2 系譜の融合 key を積む（無ければ何もしない）。次の提示で確定 1 枚（取らなくても次の提示にまた出る。`fusionDue` は取るか、条件が崩れる〔入れ替えで片方が消える〕まで残す）
- 融合の札は系譜を 2 つ持ち（`fusion: [a, b]`、`lineage` は無し）、どちらの系譜の枚数にも数える（昇華の 4 枚の条件に寄与）。card は `"law"` 扱い（枠を取らない）
- 数は 12。組は原型 12（build-core 7 章）から: 灰燼 × 雷鳴（地雷原）、月蝕 × 眷属（鎖の牧者）、刃鳴 × 大地（返しの達人）、刃鳴 × 眷属（影の群れ）、大地 × 眷属（使役者）、雷鳴 × 霜枷（硝子の狙撃）、大地 × 月蝕（不動の城）、雷鳴 × 刃鳴（疾風）、灰燼 × 霜枷（反応の型。錬金術師）、輪廻 × 財宝（銭払い）、財宝 × 刃鳴（散財の剣客）、財宝 × 眷属（買収・親分）。名前と効果は 2-6 の末尾
- 今の結び 17（`duo`）は **削る**。中身が良いもの（雷爆 thunderBlast / 冬の巣 winterNest / 清鏡 clearMirror）は融合の効果に写す

### 2-5. 錬磨（格 1〜5）と振り分けの置き換え

- `BoonGrade = 1 | 2 | 3 | 4 | 5`。抽選は 3 まで（`rollGrade` 据え置き）、4・5 は錬磨だけ。表示 `BOON_GRADE_LABEL`: 1 "" / 2 大祝福 / 3 神威 / 4 **至高** / 5 **極致**（衝突なし。★6-3）。`BOON.gradeMagnitudeMul [1, 1.5, 2.2, 2.8, 3.4]`、`gradeRadiusMul [1, 1.2, 1.4, 1.5, 1.6]`、`gradeIcdMul [1, 1, 0.6, 0.5, 0.4]`
- 錬磨の入口は **出口の予告「錬磨」** の到着時: `state.boonChoice = { mode: "temper", options: 持っている格の対象の札から rng で 3 枚（3 枚未満なら全部）, … }`。選ぶと `boonRun.grades[key] = min(5, grade + 1)` + 浮き文字「錬磨 至高 火種」。`BoonChoice.mode?: "temper"` を足し、`chooseBoon` で分岐。描画は同じ札に「格 2 → 3」の 1 行
- 錬磨は 1 ラン 4〜6 回（`EXIT.weights.temper` 2 で自然に）。市の商人の品「錬磨」（`WareKind`）は 7e の任意
- **ステータス振り分けの撤去**（B38 承認）: `GameState.runAttributes`、`ui/attributeAlloc.ts`、`render/attributeUi.ts` の振り分け部分、`system/attributes.ts` の `addRunAttributes`、`ATTR_GAIN.perFloor / perBoss / perFloorLord`、`floor.ts:919 / 1005-1009`、`player.ts:205`（`deriveAttributes(base)` に）、`core/replay.ts` の alloc イベント（`:110, 571-592, 737`）、`qa/bot.ts:545-551`、Tips `attributes`。起点の点（`ORIGIN.cursedPoints / unarmedPoints / reaperFriendPoints`）は **銭**（`gainCoins` 20 / 30 / 階ごと 5）に、契約「pactSwift」の点は **錬磨 1 回**（次の階の到着時に temper の提示）に置き換える。名前は「錬磨」「改鋳」で置き換え済み（用語集の「設計上の用語」行を「実装済み」に）。ステータスの係数（`STATS_AND_SCALING.md`）は残す。`ATTR_LABEL` は `loot/resonance.ts` から `loot/types.ts` へ移す（resonance.ts が消えるため）

### 2-6. 今の祝福 200 を 9 系譜へ写す

原則: (a) フック直書き 84 は **Rule / Modifier に書き直せるものだけ残し**、残りは削る（`BoonRuleState` 31 フィールドは 7b の終わりに 0〜5 へ）。(b) 資源回収だけの 43 は削る（流儀の気力の源が担う）。(c) 脆弱 12 → 3、爆発・衝撃波 17 → 5、連鎖雷 9 → 3、恐怖 7 → 2。(d) 名前は原則 2-1（衝突検査済みのものだけ確定、それ以外は「案」）。(e) 番号は 加護 左 / 右 / ダ / スキ / 奥 → 摂理 ×3 → 研鑽 ×2 → 昇華。「出典」は今の key（残す・改名・束ねる）か「新」。

**灰燼 ash**

| 札 | 名 | 出典 | 中身（when → then / Modifier） | 変わるもの |
| --- | --- | --- | --- | --- |
| 加護 左 | 火種 | emberSeed | `onFinisher` lane primary → `afflict burn` | timing |
| 加護 右 | **炎陣** | 新 | `onRelease` → `placeTerrain fire`（自分の足元、半径 24）。Modifier `increased fire` if `selfOnTerrain fire` | position |
| 加護 ダ | 火渡り | fireWalk 改 | `onDash` → 軌跡に `placeTerrain fire`（`trail` の flag は消し、`onDashEnd` までの線分に 3 点） | position |
| 加護 スキ | 火柱 | firePillar | `onSkillHit` → `explode` + burn | — |
| 加護 奥 | 焦土 | scorchedEarth | `onBurst` → `detonate burn` | timing |
| 摂理 1 | 延焼 | wildfire | `onMeleeHit / onRangedHit / onSkillHit` if `targetHas burn` → `spreadStatus burn` | target |
| 摂理 2 | 野火 | burnSpread | `onKill` if targetHas burn → `spreadStatus inherit` | target |
| 摂理 3 | 熾火（案） | embers 改 | `onKill` if targetHas burn → `placeTerrain fire` 半径 16（炎が残る） | position |
| 研鑽 1 | 灰 | 新 | `onKill` targetHas burn → `tally ash`。Modifier `more fire`: `per tally ash every 5 → +1%`（上限なし） | watch |
| 研鑽 2 | 火勢 | 新 | `onStatusApplied` tag burn → `tally blaze`。`temperStat`: 燃焼の持続 +0.1 秒 / 10 | watch |
| 昇華 | **劫火**（業火は変身スキル「業火の化身」と衝突） | 新 | 燃焼の重ねの上限を外す（`stats.statusStackCapBonus.burn = ∞`）+ `onKill` targetHas burn → `spreadStatus inherit` 半径 64 | target |

削る: heartBurn（ハート回収）、karmaFire（数値）、elementTrail（3 属性の轍 → 火渡り / 氷の足跡 / 静電気に分割済み）、fireWalk の弾運び。

**霜枷 frost**

| 札 | 名 | 出典 | 中身 | 変わるもの |
| --- | --- | --- | --- | --- |
| 加護 左 | 霜息 | frostBreath | `onSwingHit` primary → `inflict chill`（弱） | — |
| 加護 右 | 砕氷の鐘 | shatterBell | `onRelease` → 半径内の凍結を `detonate`（砕き） | timing |
| 加護 ダ | 凍て足 / 氷の足跡 | frostFeet + iceStep 束ね | `onDash` → `placeTerrain ice`（氷床）、通過した敵に chill | position |
| 加護 スキ | 霜貫 | frostPierce | `onSkillHit` if targetHas frozen → 周囲へ chill 2 重 | target |
| 加護 奥 | 永冬 | eternalWinter | `onBurst` → `nearbyEnemies freeze` skipBoss | timing |
| 摂理 1 | 砕氷 | chillShatter | `onShatter` → `shards`（氷の破片） | target |
| 摂理 2 | 霜読み | frostRead | `onEnemyWindup` if targetHas chill → 予備動作を延長（`afflict chill` 強） | timing |
| 摂理 3 | 氷継ぎ | iceRelay | `onKill` targetHas chill → `passStatus` | target |
| 研鑽 1 | 砕 | 新 | `onShatter` → `tally shatter`。Modifier `more` tag `ice` per 5 | watch |
| 研鑽 2 | 凍 | 新 | `onStatusApplied` freeze → `tally freeze`。`temperStat`: 凍結の持続 | watch |
| 昇華 | **氷獄** | 新 | 凍った敵に与えた傷は解けるまで溜まり、砕きで一度に出る（`Enemy.iceVault: number` を `damageEnemy` が targetHas frozen のとき積み、`onShatter` で `strike eventAmount`）。**新しい engine 分岐 1 つ** | timing |

削る: frostLock（数値）、winterNest（結び → 融合へ）。

**雷鳴 thunder**

| 札 | 名 | 出典 | 中身 | 変わるもの |
| --- | --- | --- | --- | --- |
| 加護 左 | 帯電の刃 | chargedBlade | `onSwingHit` primary → `chainLightning`（ICD 0.3） | — |
| 加護 右 | 落雷 | boltDrop | `onRiposte` → `strike` + shock（応手で雷が落ちる） | timing |
| 加護 ダ | 静電気 | staticDash | `onDashEnd` → `chainLightning` 起点は自分 | position |
| 加護 スキ | 雷跳ね | 新 | `grantsModifier: "chain"`（連鎖の符を全スロットへ） | target |
| 加護 奥 | 雷神の鼓 | thunderDrum | `onBurst` → `chainLightning` 全方位 6 本 | timing |
| 摂理 1 | 会心雷撃 | critChain | `onCrit` → `chainLightning` | — |
| 摂理 2 | 落雷予告 | thunderMark | `onStatusApplied` paralyze → 1 秒後に落雷（`hazardBomb` 味方版 = 既存の marks を Rule `strike` に delay… **delay を持つ効果が無ければ `hazardBomb` を流用**） | timing |
| 摂理 3 | 崩れ雷 | collapseChain | `onStagger` → `chainLightning` | target |
| 研鑽 1 | 連 | 新 | `chainVisits` の最長記録（`tally chainBest` は max 更新: `tally` に `mode: "max"`）。Modifier: `stats.chainCoefBonus` += 0.02 / 1 | watch |
| 研鑽 2 | 電 | 新 | `onStatusApplied` shock → tally。Modifier `more lightning` per 10 | watch |
| 昇華 | **還雷** | 新 | 連鎖が最後の敵から戻る（`chainLightning` に `bounceBack: true`。`statusEffects.ts` の連鎖に 1 分岐）+ `stats.chainRevisits += 1` | target |

削る: dashShock（数値）、thunderBlast（結び → 融合）、電気系の資源回収。

**月蝕 moon**（宣告・遅れて来る傷・生命の代償。今の月蝕 4 種は輪廻へ）

| 札 | 名 | 出典 | 中身 | 変わるもの |
| --- | --- | --- | --- | --- |
| 加護 左 | 宣告の刃 | 新 | `onFinisher` primary → `afflict doom`（宣告。`doomSentence` の状態異常） | timing |
| 加護 右 | 血刃 | bloodMist 改 | `onRelease` → 生命 5% を払い `wave`（血の斬撃波。放出列） | press |
| 加護 ダ | 血霧 | 新 | `onDash` → 通過した敵に bleed、自分は生命 2% を払う | position |
| 加護 スキ | 血払い | bloodMana 改 | `grantsModifier: "bloodPrice"`（気力の代わりに生命） | press |
| 加護 奥 | 月食 | 新 | `onBurst` → 半径内の宣告を `detonate` ×1.5 | timing |
| 摂理 1 | 血の饗宴 | bloodFeast | `onKill` → `healDirect` 2（回復は絞る方針なので 1 系譜だけに残す） | — |
| 摂理 2 | 傷の記憶 | woundMemory | 被弾した敵へ次の一撃が倍（`onHurt` → 攻撃者に vulnerable） | target |
| 摂理 3 | 逆さ時計（案） | 新 | 受けたダメージが 3 秒遅れて来る（防御列。`Player.deferredDamage` の器を `combat.damagePlayer` に 1 分岐） | timing |
| 研鑽 1 | 恨 | 新 | 受けたダメージの総量 → tally。放出の倍（`more release` per 50） | watch |
| 研鑽 2 | 宣 | 新 | 宣告で倒した数 → tally。`temperStat`: 宣告の割合 | watch |
| 昇華 | 月蝕 | 新 | 全ての与ダメが宣告に溜まり 3 秒後に ×1.3 で出る（`Enemy.doomVault`。氷獄と同じ器を共用 `Enemy.vault: { kind; amount }`） | timing |

削る: bloodReturn / laceration / huntBleed（数値の出血）、reaper 系（reaperCup / reaperPlay / reaperShadow）は死神が段取り 9 で見直されるので削る。

**大地 earth**

| 札 | 名 | 出典 | 中身 | 変わるもの |
| --- | --- | --- | --- | --- |
| 加護 左 | 地脈 | leyLine（earth 1 段） | `onSwingHit` primary → `addPoise` +50% | — |
| 加護 右 | 壁叩き | 新 | `onRelease` → `knockback` 大 + 壁に当たれば `strike` | position |
| 加護 ダ | 足場崩し | 大地 2 段目 | `onDashEnd` → `placeTerrain rubble`（崩れる床） | position |
| 加護 スキ | 震脚 | 新 | `grantsModifier: "heavy"`（怯み値 ×、範囲 ×） | — |
| 加護 奥 | 大地の怒り | 大地 4 段目 | `onBurst` → `roomEnemies` 怯み値 | timing |
| 摂理 1 | 崩し | crumble 改 | `onStagger` → `afflict vulnerable`（怯み 1 回 1 度。`BoonRuleState.crumbled` → Rule の ICD 1 秒で近似） | target |
| 摂理 2 | 力の簒奪 | usurp | `onExecute`（処刑。**EventKind に足す**）→ 次の 3 振り怯み値 ×2（`selfStatus wrath`） | target |
| 摂理 3 | 領域（案） | 新 | 自分の周り 60px の敵へ `more ×1.2`、外は ×0.9（Modifier `if nearbyEnemies`… 距離条件が無いので `targetWithin: radius` を **RuleCondition に足す**） | position |
| 研鑽 1 | 処 | 新 | 処刑の数 → tally。Modifier `more poise` per 3 | watch |
| 研鑽 2 | 壁 | 新 | 壁叩きつけの数 → tally。`more melee` per 5 | watch |
| 昇華 | **地投げ** | 新 | 怯んだ敵を掴んで投げる（右の押下で `Enemy` を弾にする。`player.ts` の右レーンに 1 分岐。**engine 大**。7b で入らなければ「怯んだ敵の撃破で衝撃波 + 周りの怯み満タン」に落とす） | press |

削る: rockStance（大剣限定）、heavyHand 系の数値。

**刃鳴 blade**

| 札 | 名 | 出典 | 中身 | 変わるもの |
| --- | --- | --- | --- | --- |
| 加護 左 | 重ね刃 | blade 2 段 | `onSwingHit` primary → `strike` 分身の追撃（0.3 秒遅れ） | — |
| 加護 右 | 断裂波 | finisherWave 改 | `onRelease` → `wave` | position |
| 加護 ダ | 抜き胴 | passCut | `onDash` → 通過した敵へ `strike` + poise | position |
| 加護 スキ | 連刃 | 新 | `grantsModifier: "followUp"`（1 撃を 3 段に。符「連打」） | — |
| 加護 奥 | 百刃 | blade 4 段 | `onBurst` → 分身が 5 秒なぞる（`Ghost` = skills の ghosts を流用） | — |
| 摂理 1 | **専心** | finisherOnly | 連撃が終撃だけ（`stats.finisherOnly` flag。既存フックを stats へ） | press |
| 摂理 2 | 双撃波 | 新 | `onTwinStrike` → `wave` 小 | timing |
| 摂理 3 | 連撃波 | comboWave | `onComboHit` amountEvery 20 → `wave` | watch |
| 研鑽 1 | 連 | 新 | 最大コンボの記録（tally max）→ `increased melee` per 10 | watch |
| 研鑽 2 | 影 | 新 | 撃破数 → tally。5 体ごとに `Ghost` +1（上限 3。`temperStat: ghosts`） | watch |
| 昇華 | 途切れぬ刃（文なので **不断**〔案〕） | comboKeeper 改 | コンボが時間で切れない（`comboWindowBonus = ∞`）、被弾で半分 | timing |

削る: comboClock（数値）、spiritBlade、twinWheels（両輪）、edgeStrike、lopsided / swapHands（ステータスの入れ替え。振り分け撤去と同時に消す）。

**輪廻 cycle**（旧 巡り。今の月蝕 4 種を写す）

| 札 | 名 | 出典 | 中身 | 変わるもの |
| --- | --- | --- | --- | --- |
| 加護 左 | 満気（案） | 新 | `onSwingHit` primary if `manaFull` → `spawnBullets` 1（気弾。放出列） | timing |
| 加護 右 | 月読 | moonRead | `onRiposte` → `restoreMana` 25% + 再使用 20% 戻す（`refreshSkills` **効果を足す**） | timing |
| 加護 ダ | 新月 | newMoon 改 | `onDashEnd` → 最後に撃ったスキルの反響（`echoLast` **効果を足す**。`SkillRunState.lastCast` を読む） | position |
| 加護 スキ | 反響 | 新 | `grantsModifier: "echo"` | — |
| 加護 奥 | 満ち潮 | highTide 改 | `onBurst` → `refreshSkills fill` + `restoreMana fill` | timing |
| 摂理 1 | 循環 | circulation | `onSkillHit` → `restoreMana` 2（1 発動 8 まで。`circulationGained` は Rule の `group` + ICD 0.05 で近似） | — |
| 摂理 2 | 血の対価 | bloodMana | `lowHp` の間コスト −40%（`stats.manaCostMul` を条件付きで。**Modifier に `stat: "manaCostMul"` の口を足す** か既存フックを残す） | timing |
| 摂理 3 | 月蝕（旧 eclipse） → 改名 **四重奏**（案） | eclipse | 2 秒内に 2 スロット以上撃つと 3 つ目が無料（`SkillRunState` の窓） | timing |
| 研鑽 1 | 詠 | 新 | `onSkillCast` → tally。`temperStat`: 最大気力 +1 / 3 発 | watch |
| 研鑽 2 | 還 | 新 | 戻した気力の総量 → tally。`increased skill` per 100 | watch |
| 昇華 | **流転** | 新 | 気力を払うたび払った量 ÷ 最大気力 が次のスキルの倍（`BoonRunState.flowMul`。`skills.ts` の castSlot で読み書き） | timing |

削る: keenBreath / springWell / hollowVessel / reaperCup / chantReturn / manaTide 系（資源回収 43 の主）。

**眷属 horde**（従魔・設置物）

| 札 | 名 | 出典 | 中身 | 変わるもの |
| --- | --- | --- | --- | --- |
| 加護 左 | 号令 | 新 | `onSwingHit` primary → 自分の設置物・従魔が同じ敵を狙う（`retarget` **効果を足す**。summons.ts に入口） | target |
| 加護 右 | 供物 | 新 | `onRelease` → 設置物 1 つを爆ぜさせる（消費列。`detonatePlaced`） | press |
| 加護 ダ | 歩く杭 | 新 | `onDashEnd` → 最も近い設置物が自分の位置へ移る（陰陽師の入れ替わりの逆） | position |
| 加護 スキ | 設置 | 新 | `grantsModifier: "linger"`（設置の符） | — |
| 加護 奥 | 従魔 | 新 | `onBurst` → 半径内の怯んだ敵 3 体を 20 秒従える（`tameEnemy` **効果を足す**。`Enemy.allyUntil`。★6-6） | target |
| 摂理 1 | 十字砲火（4 字） | 新 | 設置物どうしの間に線が繋がり触れた敵が傷つく（`placed.ts` に 1 分岐） | position |
| 摂理 2 | 群長 | 新 | 従魔・設置物の数につき自分が強い（Modifier `per: { kind: "minions" }` **PerCounter を足す**） | watch |
| 摂理 3 | 身代わり | 新 | 被弾を従魔が肩代わり（防御列。`damagePlayer` に 1 分岐） | position |
| 研鑽 1 | 群 | 新 | 従えた数の最高 → tally max。`more minion` per 1 | watch |
| 研鑽 2 | 杭 | 新 | 置いた設置物の数 → tally。設置物の持続 +5% / 10 | watch |
| 昇華 | 群れの主 → **百鬼**（案） | 新 | 従魔が倒した敵も従う（上限 6） | target |

**財宝 wealth**（economy-core 9-2 のまま）

| 札 | 名 | 出典 | 中身 | 変わるもの |
| --- | --- | --- | --- | --- |
| 加護 左 | 銭吐き（案） | 新 | `onSwingHit` primary → `gainCoins` 1（1 体 1 回。ICD 敵ごと） | — |
| 加護 右 | 投銭 | 新 | `onRelease` → `scatterCoins` 0.1 を弾として飛ばす（`coinShot` **効果を足す**: 威力 = 額 × 係数、床に落ちて拾い直せる） | press |
| 加護 ダ | 掏り | 新 | `onDash` → 通過した敵から `gainCoins` 2（1 体 1 回） | position |
| 加護 スキ | 銭払い | 新 | `grantsModifier: "coinPrice"`（気力の代わりに銭。**符を 1 枚足す**） | press |
| 加護 奥 | 散財 | 新 | `onBurst` → 持ち金を全部払い威力 = 額 × 係数の一撃（`spendCoins` + `strike scaleBy coins` **`RuleMagnitudeBase` に `coins` を足す**） | press |
| 摂理 1 | 懐 / 守銭 | miser | Modifier `increased all per coins every 20 cap 0.25`（既存） | watch |
| 摂理 2 | 拾銭 | coinGleaner | 拾うたび短い強化（既存） | position |
| 摂理 3 | 戻り銭 | 新 | こぼれた銭が自分へ戻る（`onCoinSpill` → `gainCoins eventAmount ×0.5`） | — |
| 研鑽 1 | 稼 | 新 | `per coinsEarned every 50 → increased all +1%` | watch |
| 研鑽 2 | 散 | 新 | `per coinsSpent every 50 → more +1%` | watch |
| 昇華 | 黄金律 | 新 | 持ち金が 50 → 100 → 200 … を超えるたび倍が 1 段（Modifier `per coins` を対数で: `every` を `log2` にする `PerCounter { kind: "coinsLog" }`）。被弾でこぼれる量も倍 | watch |

**呪い付き 6**（系譜なし。今の 25 から残す）: 血染めの地 / 一念（系譜 1 つのとき倍）/ 焦がれ刃 / 狂い咲き / 重き誓い / 濡れ鼠 の 6（Wave2）。残り 19 は削る。**芯 4**: 呪い喰い / 拍の刻 / 逃げ水 / 血の巡り（数値の入れ替え 4 は削る。★6-5）。

**融合 12**（名は案。`fusion` の 2 系譜）: 地雷原 ash×thunder = 爆発が連鎖雷を呼ぶ（thunderBlast 写し）/ 鎖牧 moon×horde = 従魔が宣告を運ぶ / 返しの達人 → **返し打ち** blade×earth = 応手の直後の一撃が壁叩きつけ確定 / 影群 blade×horde = 分身が従魔になる / 使役 earth×horde = 処刑した敵が従う / 硝子 thunder×frost = 会心で砕き（冬の巣 写し）/ 不動 earth×moon = 受けたダメージを 3 秒溜めて壁叩きで返す / 疾風 thunder×blade = ダッシュがコンボを切らず落雷 / 蒸気 ash×frost = 反応が新しい反応を起こす（連鎖反応）/ 銭払い cycle×wealth = 気力が尽きたら銭で撃てる / 散財の剣客 → **豪遊** wealth×blade = 終撃で出た銭を次の終撃で払う / 買収 wealth×horde = 銭で敵を従える。

**新しい効果の種類（engine に足す。7b の統合役が先に型を 1 コミット）**: `tally`（数え。`mode: "add" | "max"`）、`refreshSkills`、`echoLast`、`retarget`、`detonatePlaced`、`tameEnemy`、`coinShot`、`RuleMagnitudeBase "coins"`、`PerCounter { tally } / { minions } / { coinsLog } / { lineageCards; lineage } / { lineagesOwned }`（一念・巡礼用）、`RuleCondition { targetWithin; radius }`、`EventKind onExecute / onWallSlam`（処刑・壁叩きは今 poise.ts / physics にあるので pushEvent を 1 行ずつ）。`Enemy.vault?: { kind: "ice" | "doom"; amount }`（氷獄・月蝕）。`Player.deferredDamage?`（逆さ時計・不動）。`Enemy.allyUntil?`（従魔化）。

### 2-7. 系譜・札の重みと「1 提示 1 系譜」の抽選

`rollLineageOptions(state, lineage)`: 候補 = その系譜の未取得の 加護 / 摂理 / 研鑽（昇華・融合は確定枠でだけ）。重み = `BOON.cardWeight[card]`（grace 5 / law 3 / temper 2）× 加護なら「その行動の枠に空きがあれば ×1.5、満ちていれば ×1」× 既存 `boonAffinityMul`（語の潤い）× `loadoutMatches`。同じ card × action は 1 枚まで。`takeWeighted` は据え置き（乱数 1 回 / 枚）。昇華は「その系譜の札（融合を含む）4 枚以上」で 1 枚目に確定（`rng` を引かずに `unshift`）。

### 2-8. スキルの圧縮（技 322 → 60、手書き 76 → 45）と変形表

- **残す 60 の選び方**: 共通技 24 は全部残す。武器技 298 は build-core 1-1 の「行為の並びで 43 形」に沿い、`ArtSpec.acts` の（kind の列, anchor の列）が同じものを 1 つに束ね、束の中で名前が最も一般的なもの（武器種名を含まない名）を残す。43 形のうち共通技 24 と同形の 7 を除いた **36 を新しい共通技**として `moveset: null` に（合計 60）。束ねる作業は機械的にできる: `arts.test.ts` の隣に一時テストで `ART_SPECS` を (kinds, anchors) で groupBy して出力 → 統合役が 60 を確定
- **武器種の縛りを外す**: `ArtSpec.moveset` を全て null にし、`artWeightFor`（`arts/index.ts:77-82`）と `ART.weights.matched / other` を消す。`SkillDef.moveset`（`types.ts:308`）は残す（手書きの変身などが使う可能性）が技では使わない
- **変形表 `ArtTransform`**（新規 `skills/arts/transform.ts`）: `Record<FormKey, (acts: readonly ArtAct[]) => ArtAct[]>` を **純関数**で持ち、`castArt`（`arts/engine.ts`）の頭で `currentForm(state).key` を引いて適用。数値は `balance/skills/ART/TRANSFORM/<型>.json`（`areaMul / hitsAdd / damageMul / weight` など）。例: crusher（重打）= ring / arc の半径 ×1.3・多段 −1・怯み値 ×1.5 / flurry（連刃）= 段 +2・1 撃 ×0.6 / pistol・rifle・artillery = arc → shot に置き換え（弧を弾に）/ chain（鎖）= 命中に `pull` を足す / rod（杖）= 属性を術式の色に / tome（書）= 再使用 ×0.7（既に `formSkillCooldownMul`）。表示は石のツールチップに「今の型: 重打（範囲 ×1.3・段 −1）」の 1 行（`loot/describe` ではなく `skills/data.ts` の `stoneLabel` の隣に `transformLabel`）
- **手書き 76 → 45**: 変身の第 2 弾 3 種（titanForm / swiftForm / spiritForm）を削り（持ち替えと等価）、技で書けるもの（whirl / lunge / frag / railshot / quake / thunder / spiral / meteorDive など行為の列に写せる 20 前後）を **共通技に吸収**して手書きから消す。残す基準は「他要素を読む・食う」（bloodPact / haste / parry / gravityWell / frostField / mines / chainHook / shiftingEdge / hueEtch / doomSentence / 変身 5 …）。確定リストは 7c の頭で統合役が `SKILL_DEFS` を舐めて作る（この設計書では基準だけ）
- **石の移行**（`skills/persistence.ts` の `sanitizeStone` の前に 1 段）: `LEGACY_SKILL_MAP: Readonly<Record<string, SkillKey | null>>`（旧 key → 束ねた共通技 / null = 消す）。武器技 → 同形の共通技へ写す（`seed / variants / wear` はそのまま。`variants` は新しい `axes` に無い軸を `sanitizeStone` が既に落とす）。手書きで消える 31 → 吸収先へ写す。null は石ごと消す。`roguelike.skills.v1` は **据え置き**（フィールドの形は同じ。読み捨て + 写しで足りる）
- 芽: `WearBud "link"` は意味を失うので `LEGACY` として読み `"power"` に写す（`sanitizeWear`）。2 択の変容（build-core）はこの段では入れない（★6-7）
- QA bot はスキルを撃ち分けないので、`qa/bot.ts` の標準ビルドの石 key を新しい key に差し替えるだけ

### 2-9. 刻印符のラン内化と 30 枚

- **永続の廃止**: `SkillProfile.runes` / `SkillStone.runes` を型から消し、`loadSkillProfile` は旧データの `runes` を読み捨てる（`settleStoneRunes / dedupeRunes` を消す）。`ownedRunes / addRune / attachRuneToStone / detachRuneFromStone / discardRune / runeAttachBlock` を消し、`grantRune`（`skills.ts:2170`）は `attachRune`（ラン内）に置き換える。`SKILL.runeCapacity` は消す
- **スロットのリンク固定**: `SKILL.slotLinks: [4, 3, 2, 2]`。`linksOf(slot) = SKILL.slotLinks[slot] + wearBonusLinks(stone)` … 芽の枠を写す方針（2-8）なら後者は 0 で、`SkillStone.links` は読まない（フィールドは互換のため残し、生成は `links: 0`）。`SKILL.linkWeights / maxLinks / linkBurdenPenalty` は消すか 0
- **ラン内の符の UI**: `ui/skillRunes.ts`（165 行）を「スロットごとのラン内の符の列。移す / 外す（外すと消える）」に書き直す。床の符は拾うと `attachRune` が空きのあるスロットへ自動で入れる（今のとおり）。装備画面のスキルタブで別のスロットへ移せる（`moveRunModifier(rs, from, to)` 新規。`syncSlotModifiers` が次のステップで反映）
- **30 枚の内訳と今の 53 からの写し**（変形 20 = `transform` を持つ / 循環 10 = `apply` で CastParams を変える）

| 新 | 出典 | 種 | 中身 |
| --- | --- | --- | --- |
| 分裂 | spread | 変形 | shot / arc を 3 つに（威力 ×0.5） |
| 連鎖 | 新 | 変形 | 命中点から次の敵へ跳ぶ（`chain` を足す） |
| 周回 | 新 | 変形 | shot → orbit（`BulletDef.orbit` 流用） |
| 設置 | linger | 変形 | その場に留まり近付いた敵に発動 |
| 遅延 | delay | 変形 | 2 秒後に出て ×1.5 |
| 反響 | echo | 変形 | 0.5 秒後にもう一度 ×0.5 |
| 収束 | expand の逆 | 変形 | 範囲 ×0.5・威力 ×1.6 |
| 連打 | followUp | 変形 | 1 撃を 3 段に |
| 溜め | charge | 変形 | 長押しで段 |
| 照準起点 | toThrown / toLobbed 束ね | 変形 | self → target |
| 足元起点 | toNova | 変形 | target → self |
| 軌跡 | 新 | 変形 | dash / blink の跡に地形（属性は攻撃の素性） |
| 分身 | 新 | 変形 | 0.3 秒遅れて同じ技（`Ghost` 流用） |
| 呼び戻し | 新 | 変形 | shot が戻る（投具の呼び戻し流用） |
| 貫き | pierce | 変形 | 貫通 +2 |
| 爆ぜ | 新 | 変形 | 命中点で小爆発（`explode` 0.4） |
| 引き寄せ | tether | 変形 | 命中を中心へ寄せる |
| 地形化 | fireInfuse / iceInfuse / stormInfuse / venomInfuse 束ね | 変形 | 着弾点に攻撃の属性の地形 |
| **終撃連動** | 新 | 変形 | 武器の終撃と同時に出る（気力は払う）。`ModifierDef.autoCast: "finisher"`。`moments.ts` の `noteHitMoments`（終撃）から `tryAutoCast(state, "finisher")` → その符を持つスロットを `castSlot` と同じ経路で撃つ（`minInterval` / 気力 / body 排他を通す。手動と同じ扱いなので連携も成立する）。**B40 承認** |
| **応手連動** | 新 | 変形 | `noteRiposte` から `tryAutoCast(state, "riposte")` |
| 血払い | bloodPrice | 循環 | 気力の代わりに生命 |
| 溢れ撃ち | spillover | 循環 | 気力が満ちている時 ×1.3 |
| 刻み撃ち | cycle 改 | 循環 | 同じスキルを続けて撃つたび +10%（別で途切れる） |
| 巡り | refund | 循環 | 命中で気力が戻る（払った額まで） |
| 過熱 | overheat | 循環 | 連続で倍が上がり上限で暴発 |
| 蓄え | deferred 改 | 循環 | 撃たずに待つほど強い |
| 共振 | 新 | 循環 | 他のスキルの直後に撃つと ×1.3 |
| 代償 | desperate 改 | 循環 | 生命の減りに比例して再使用が縮む |
| 捧げ | 新 | 循環 | 奥義ゲージを払って ×1.5 |
| 帳 | 新 | 循環 | 撃った数を積み 10 発ごとに無料 |

削る（23）: multiCharge / comboFuel / recoil / chainReset / curse / expand / dryFire / bladeFeed / timeLock / fuelize / heavy / feather / repel / lastGasp / sustain / landing / attune / flank / pointBlank / longshot / toStaged / toTrap / breakInfuse / hueInfuse / leyline / crumble（地崩れ）/ jobMastery / weaponBond / formSurge / formLinger。「地形化」に吸収されない `crumble`（地裂き専用）は地裂きが技に吸収されれば不要。

- `ModifierDef` に足す: `transform?: (acts: readonly ArtAct[], n: TransformNumbers) => ArtAct[]`（技だけに効く。手書きのスキルは `apply` のまま）、`autoCast?: "finisher" | "riposte"`。`canAttach` は `transform` を持つ符は技にだけ付けられる（`isArtKey`）
- 起点「詠み手」（`runSetup.ts:266`）はそのまま（ラン内経路）。図書館（`hubFlow.ts:33` は拠点の台 = スキルタブを開くだけ）、部屋「図書館」・契約者「刻印符」・市の品 `rune`（`WareKind`）は **床に符を落とす**形に統一（`dropRune` 効果は既にある）

### 2-10. 遺物（性質・転じ・誓約・名のある遺物・共鳴・残響）

- **性質 212 → 約 70**: 無条件の数値（79）は **削り、地金の予算へ移す**（`INNATE.budget.perDepth` 0.35 → 0.5 前後、`pointValue` は 7e で合わせる）。条件付き数値（100）は「条件の族 約 20」に束ね、`AffixDef` に `modifier?: (v) => Modifier` を足して `PlayerStats.modifiers` へ push（`traitHooks.ts` の if 群は Modifier の `if`（`targetHas / lowHp / manaFull / comboAbove / engagedIn / selfOnTerrain / coinsAtLeast / targetElite / targetWithin`）と `per`（`targetStatusKinds / nearbyEnemies / missingHpTenths / coins`）で書き直す）。族の例: 相手の状態（怯み中 / 燃焼中 / 精鋭 / 予備動作中）、自分の状態（瀕死 / 気力満 / 戦意充溢 / 静止）、場（地形の上 / 交戦中 / 陣の中）、手段（終撃 / 放出 / 応手 / 双撃 / 先制 = **共通の瞬間を性質が参照する**。段取り 5 で先送りした `weapon-forms-impl.md:204, 218`）、来歴（若木 / 歴戦…既存）。行動 約 50 = 挙動 12 + 誓約から降ろす 17 + 新規（連鎖の源 = `chainCoefBonus`、連鎖の再訪 = `chainRevisits`、戦意の上限 `moraleMaxAdd`、加護の枠 `graceSlotBonus`）
- **性質は発見深度**: 現状のまま（`nominalAt(def, itemLevel)` で生成時に確定、値を保存）。**ここは何も変えない**。揺らぎの幅だけ `FLUX.flux.lowScale / highScale` を「期待値の 0.6〜1.8 倍」（下振れを狭め上振れは残す）に
- **厳選の到達点**: 各軸に 1 つ、性質の曲線の上端でだけ届く閾値: 連鎖確率 100%（`chainCoefBonus` の合計 ≥ 1）、燃焼の重ねの上限撤廃（`statusStackCapBonus.burn` ≥ 15）、銭の利子の上限撤廃、戦意の冷めなし。表示は装備画面の「効果」頁に「到達: 連鎖 100%」の行
- **転じ 12**（変換 41 → `CONVERSION_AFFIXES` を 12 に）: `Modifier` の `per: { kind: "stat" }` で書く。`stat` に `maxMana / maxHp / comboWindow / morale` を足す。build-core 6-6 の 7 + 会心発生時の起点 3（会心で連鎖 / 銭 / 戦意 = Rule `onCrit`）+ 「防御 → 怯み」「気力 → 弾」
- **誓約 37 → 20**: 遊びが変わる 9 + 6-1〜6-5 の誓約（瞬歩 / 賭けの手 / 待ちの型 / 無想 / 遠間・近間 / 伝染 / 刹那 / 清貧 / 黄金の檻 / 喜捨）から 11。条件付き倍率 18 は性質の条件の族へ
- **名のある遺物 76 → 18**（build-core 4-5 の表 + economy-core 9-3 の 6 から 18）: `UniqueDef` に `rules? / modifiers? / flags?` を足し、`collectRules`（`system/rules.ts:112`）の装備の段（今は `fireTrigger` が即時照合）に「名のある遺物の Rule」を **装備スロット順で足す**（`state.profile.equipment` の `namedKey` を引く）。`EventSource { kind: "item", key: namedKey }`。固有の挙動で engine が要るもの（逆さ砂時計 = `deferredDamage`、空の鞘 = 攻撃が出ない、賽の目 = 階ごとの倍、星読みの眼 = 予備動作の表示延長）は render / player に 1 分岐ずつ。消える 58 の名のある遺物を持っている倉庫のアイテムは `migrate.ts` で `namedKey` を外して普通の遺物として残す
- **共鳴（源と糧）**: `loot/resonance.ts` を **全面書き直し**（色の配合・星座・陰画・拮抗は消す。`TraitColor` は分類・残響・ステータスの色分けとして `loot/colors.ts` に残す）。新 `system/resonance.ts`（state を読むので system）:
  - 入力 = `buildProfile(state)`（`system/keywords.ts:489`）に **流儀**（`JOBS[job].keywords`）・**武器の型**（`FormDef.keywords` を足す）・**改鋳**（`ReforgeDef.keywords` を足す）を加えた `KeywordProfile` の **件数つき版** `countKeywords(state): Record<Keyword, { produces; consumes; amplifies }>`（`mergeProfiles` は重複を潰すので数える版を足す）
  - 判定: 語 k について `produces ≥ RESONANCE.minSources (2)` かつ `consumes ≥ minSinks (2)` → 段 1、`produces + consumes` が `stepEvery (3)` 増えるごと +1、`amplifies` 1 つにつき +1、上限 `maxSteps (3)`
  - 効果: 段 × `RESONANCE.stepMul (1.15)` の **倍**（Modifier `more`、tag は語 → `DamageTag` の表: burn → fire / chill → ice / shock → lightning / poison → poison / melee → melee / ranged → ranged / placed → placed / bullet → ranged / explode → area / combo → melee … 対応の無い語（heal / ward / mana）は `temperStat` と同じ口で stats に）。`collectModifiers`（`system/modifiers.ts:35`）の誓約の直後に `resonanceModifiers(state)` を足す（毎回数え直すと重いので `applyStats` で `boonRun.resonance` に写し、ステップ中はそれを読む。祝福の取得・装備変更・改鋳で `applyStats` が走るので同期は保てる）
  - 表示: 流れタブ（`ui/synergyPanel.ts` / `render/synergyUi.ts`）に「共鳴中: 燃焼 2 段（源 3・糧 2・強め 1）」の行。装備のツールチップの「流れ: 源 … 糧 …」は据え置き。部屋「共鳴炉」（`specialRooms.ts:1052-1060`）は「共鳴している語を持つとき報酬 2 個」に（`state.stats.resonance.colors` → `boonRun.resonance` の段 ≥ 1）
  - `PlayerStats.resonance / constellation`、`Resonance` 型、`RESONANCE.json` の中身、`ATTR_GAIN.resonanceScatter`、`ConstellationKey`、Tips 4 項目（resonance / hue の共鳴の記述 / colorless の「共鳴の配合」/ inverted の「重み 2 倍」）を書き換え
- **残響 12 → 5**: 砕く / 育てる（= 今の「呼び戻し」）/ 移す / 呼び戻し（= recall）/ 煽り。染め・鎮め・削ぎ・転調・脱色・注ぎ・鍛え直し・張り を消す（`ECHO_OPS`、`ui/echoTab.ts`、`render/echoTabUi.ts`、`loot/crafting.ts`）
- **来歴・芽**: 持ち込んだ遺物だけに積もる形（袋・持ち込み 2 部位）は段取り 8 以降なので、この段では触らない

### 2-11. 軸 × 型の行列の使い方（系譜・性質・遺物の型紙）

`docs/ideas/core-synthesis.md` 5-2 の 9 軸 × 6 型 = 54 を **配り先の表**（`docs/ideas/build-impl.md` に置く）にし、各札 / 性質 / 遺物に `axis`（銭 / 生命 / 気力 / 戦意 / コンボ / 燃焼 … の `Keyword`）と `shape`（保持 / 消費 / 累積 / 放出 / 転化 / 防御）を **設計書の列**として持たせる（コードのフィールドにはしない。テストで強制すると自由度を削るため）。配り方の決まり: 系譜は主な軸 1〜2 本を「保持・消費・累積（研鑽）・放出」で持ち、「転化・防御」は性質・名のある遺物・誓約に配る。共鳴との対応: 保持・消費・累積 = 糧、放出 = 源。1 系譜に同じ軸の保持と消費を両方置いて張力を作る（財宝: 懐〔保持〕と銭払い〔消費〕）。

### 2-12. 量の方針（審査を型で強制）

- `BoonDef.changes: BoonChange`（必須）。`boonDefs.test.ts` に「全ての札が changes を持ち、加護は action を持ち、系譜ごとに 5 / 3 / 2 / 1 枚」の検査
- 刻印符 `ModifierDef.changes`、名のある遺物 `UniqueDef.changes`、誓約 `KeystoneDef.changes` も同じ union（`core/rules.ts` ではなく新 `core/build.ts` に `BuildChange` を置いて共有）
- 性質は「無条件の数値を持たない」を検査: `AFFIXES` の `apply` が `increased / more / modifiers / statusProcs / triggers` 以外の数値フィールドに触れないことを `affixes.test.ts` で（stats のスナップショットを 2 通りの入力で比べる）
- レシピ `docs/recipes/boon.md` / `skill.md` / `affix.md` の冒頭に「柱 7 の 1 文を書けないものは足さない」を 1 行

---

## 3. 型の変更・JSON・テスト・REPLAY_VERSION・壊れそうなテスト・セーブの移行

### 3-1. 型（共有ファイルは最小 Edit）

| ファイル | 変更 |
| --- | --- |
| `src/system/boonDefs.ts` | `LineageKey` 9、`LINEAGE_LABEL`、`BoonCard / BoonAction / BoonChange`、`BoonDef` に lineage / card / action / fusion / changes / grantsModifier / temperStat、`after / duo / rarity` 削除。`BOONS` を系譜ごとのファイル `boonDefs/<lineage>.ts` に分け `boonDefs.ts` は集約（Wave2 / Wave3 は解体） |
| `src/system/boons.ts` | `BoonChoice` に `lineage? / mode?: "temper" / replace?`、`BoonRunState` に `tallies: Record<string, number>` / `graceOpen` / `fusionDue` / `resonance`、`offerBoons(state, boost, lineage?)`、`rollLineageOptions`、`gracesOf / graceSlotsOf`、`removeBoon`（contractors から移す）、`foldBoonStats` の 13 if を Modifier / temperStat へ |
| `src/system/boonGrade.ts` | `BoonGrade = 1|2|3|4|5`、`temperGrade(state, key)` |
| `src/core/rules.ts`（最小 Edit） | `RuleEffectKind` に tally / refreshSkills / echoLast / retarget / detonatePlaced / tameEnemy / coinShot、`RuleMagnitudeBase` に coins、`PerCounter` に tally / minions / coinsLog / lineageCards / lineagesOwned、`stat` に maxMana / maxHp / comboWindow / morale、`RuleCondition` に targetWithin |
| `src/core/events.ts`（最小 Edit） | `EVENT_KINDS` に onExecute / onWallSlam |
| `src/core/state.ts`（最小 Edit） | `runAttributes` 削除、`pendingExit: ExitReward | null`、`Enemy.vault? / allyUntil?`、`Player.deferredDamage?` |
| `src/system/specialRooms.ts`（最小 Edit） | `StairsChoice.reward: ExitReward`。抽選は新 `system/exits.ts` |
| `src/loot/types.ts`（最小 Edit） | `PlayerStats` から `resonance / constellation`、足す `graceSlotBonus / statusStackCapBonus / finisherOnly`、`ATTR_LABEL` をここへ、`Item` は変えない |
| `src/skills/types.ts` | `SkillProfile.runes` / `SkillStone.runes` 削除、`ModifierDef.transform? / autoCast? / changes`、`SKILL_KEYS` の構成（`LEGACY` を 45 に、`ART_SKILL_KEYS` を 60 に）、`MODIFIER_KEYS` 30 |
| `src/skills/arts/types.ts` | `ArtSpec.moveset` を `null` 固定（型は残す） |
| `src/loot/named.ts` | `UniqueDef.rules? / modifiers? / changes` |
| `src/loot/affixes.ts` | `AffixDef.modifier?`、`AffixTag` に `condition`、`AFFIXES` 約 70 |
| `src/data/jobs.ts`（最小 Edit） | `JobDef.lineage?: LineageKey` |
| `src/data/weaponForms.ts` / `src/data/reforges.ts`（最小 Edit） | `keywords: KeywordProfile` |
| `src/core/replay.ts`（最小 Edit） | alloc イベントの削除、`REPLAY_VERSION` |

### 3-2. balance JSON（`_fields` を親に 1 回。`npm run balance:gen`）

| ブロック | 中身 |
| --- | --- |
| `boons/BOON.json` | 足す: `graceSlots 2 / graceSlotsMax 3 / cardWeight { grace 5, law 3, temper 2 } / cardColor / apexMinCards 4 / gradeMagnitudeMul [1,1.5,2.2,2.8,3.4] / gradeRadiusMul / gradeIcdMul（5 要素）/ gradeLabel / temperOfferCount 3 / lineageTags`。消す: `rarityWeight / rarityColor / lineageWeightMul / duoWeightMul / choiceCount`（3 は残す）と削った祝福の数値 100 前後。系譜ごとの数値は `boons/LINEAGE/<lineage>.json` に分ける（改鋳の `REFORGE/<型>.json` と同じ形） |
| `world/EXIT.json`（新） | `weights / boonGuaranteed / chapterBossAllBoons / lineageOwnedMul / lineageJobMul / firstFloorKinds / relicArrivalChance 1 / coinsMul 3 / dangerRewardMul 2 / apprenticeExtraExit 1` |
| `combat/ATTR_GAIN.json` | `perFloor / perBoss / perFloorLord / resonanceScatter` を消す |
| `world/ORIGIN.json` / `world/CONTRACT.json` | 振り分け点 → 銭 / 錬磨に |
| `skills/SKILL/_index.json` | `slotLinks [4,3,2,2]`、消す `linkWeights / maxLinks / linkBurdenPenalty / runeCapacity` |
| `skills/ART/_index.json` | `weights.matched / other` を消す。新 `skills/ART/TRANSFORM/<型>.json` |
| `skills/MODIFIER`（`SKILL/modifier.json`） | 30 枚ぶんに書き直し |
| `loot/RESONANCE.json` | 全面書き直し: `minSources 2 / minSinks 2 / stepEvery 3 / amplifyStep 1 / maxSteps 3 / stepMul 1.15 / keywordTag { burn: "fire", … }` |
| `loot/FLUX.json` | `flux.lowScale / highScale` → 0.6〜1.8 相当 |
| `loot/INNATE/budget.json` | `perDepth` 0.35 → 0.5（7e で確定） |
| `loot/affixCurves/` | 削った性質の曲線を消す（`curveFor` は key が無いと tsc で落ちるので同時に） |
| `loot/KEYSTONE.json` / `world/ECHO`（残響） | 20 / 5 に |

### 3-3. テスト（新しい仕組みには必ず。`it` は日本語）

- `system/boonDefs.test.ts`（新）: 系譜ごとに 5 / 3 / 2 / 1、加護は action を持つ、全札が changes を持つ、名前が `GLOSSARY` の衝突表（奥義 / 状態異常 / スキル / 性質 / 改鋳）と重ならない
- `system/boons.test.ts`: 「出口で選んだ系譜の 3 枚だけ出る」「同じ card × action は 1 枚」「昇華は 4 枚で 1 枚目に確定」「加護は 1 行動 2 枠、3 枚目で入れ替えの第 2 段が開き、見送りで取らない」「同じ系譜の加護は同じ行動に出ない」「融合は 2 系譜の加護が同じ行動に乗った次の提示に確定」「同じ seed なら同じ候補」
- `system/exits.test.ts`（新）: 1 階に祝福の出口が 1 つ以上、同じ報酬を並べない、深度 1 の種類、章ボス階は全部祝福、`pendingExit` が次の階で消える、rng の消費が階段の数だけ
- `system/boonGrade.test.ts`: 格 4・5 は抽選で出ない、錬磨で 5 まで、倍率の列が 5 要素
- `system/boonTallies.test.ts`（新）: tally add / max、Modifier per tally、temperStat
- `skills/arts/transform.test.ts`（新）: 型ごとの変形が純関数で決定的、全 60 技 × 15 型で acts が壊れない（kind の集合が `ART_ACT_KINDS` の中）
- `skills/persistence.test.ts`: 「旧セーブの runes は読み捨てる」「旧武器技の石は共通技に写る、写せないものは消える」「wear の link は power に写る」
- `skills/autoCast.test.ts`（新）: 終撃連動は終撃の命中で 1 回だけ撃ち、気力が無ければ撃たない、応手連動は onRiposte で
- `system/resonance.test.ts`（新）: 源 2 糧 2 で 1 段、強めで +1、上限 3、Modifier に出る、装備の付け替えで数え直す
- `loot/named.test.ts`（新）: 18 全部が rules か modifiers を持つ、collectRules に装備順で載る
- `loot/affixes.test.ts`: 無条件の数値を持たない検査、`LEGACY_AFFIX_MAP` で旧 key が写る
- `core/replay.test.ts`: そのまま（record → playback）。alloc のケースを消す
- `system/floatingText.test.ts`: 新しいラベル（至高 / 極致 / 錬磨 …）が体言止め

### 3-4. `REPLAY_VERSION`（`/home/user/roguelike/src/core/replay.ts:74`、今 26）

- **27**（7a）: 出口の予告（`planForkStairs` の rng 消費が増える）、系譜ごとの提示、加護の枠と入れ替え、錬磨、振り分けの撤去（alloc イベントの削除）
- **28**（7b）: 祝福 200 → 121（Rule の照合順・乱数消費が変わる）
- **29**（7c）: 技 60 + 変形表、符 30・ラン内化（石の抽選の重みと符の抽選が変わる）
- **30**（7d）: 性質・転じ・誓約・名のある遺物・共鳴（`computeStats` の結果と Modifier が変わる）
- **31**（7e）: 数値だけでも「同じ入力列で進行が変わる」ので上げる
- `docs/ARCHITECTURE.md:136` の版の一覧に 1 行ずつ

### 3-5. 壊れそうなテスト（既存）

| テスト | 理由 | 直し方 |
| --- | --- | --- |
| `system/boons.test.ts:543-602`（系譜 4 段・結び） | after / duo の廃止 | 2-1 の規則に書き直す |
| `system/boons.test.ts:151`「24 種以上」/ `:156`（3 枚重複なし） | 提示が 1 系譜 3 枚に | 系譜を渡す |
| `system/boonRules.test.ts`（84 のフック）/ `boonsWave2.test.ts` / `boonsAttrStatus.test.ts`（lopsided / swapHands） | 削除・Rule 化 | 残した札だけに縮める |
| `render/boonUi.test.ts` | 系譜の段数表示・rarity | 行動の見出しに |
| `core/replay.test.ts`（alloc） | 振り分け撤去 | ケース削除 |
| `system/attributes.test.ts` / `ui/attributeAlloc.test.ts` / `render/attributeUi.test.ts` / `ui/statusTab.test.ts` | 振り分け撤去 | 振り分けの節を消す（`deriveAttributes` の検査は残す） |
| `loot/resonance.test.ts` / `resonanceAttributes.test.ts` / `resonanceOrder.test.ts` / `stats.test.ts` / `lootExpansion.test.ts` / `lootWave2.test.ts`（星座・陰画・拮抗） | 色の共鳴の廃止 | 3 ファイルは削除、`stats.test.ts` は共鳴の段を外す |
| `skills/persistence.test.ts:54-146`（所持刻印符・永続） | ラン内化 | 2-9 の新しいケースに |
| `skills/expansion.test.ts` / `skills.test.ts` / `expansion2.test.ts`（符の付け外し・型替え符 2 本） | 符 30・リンク固定 | 残した符に |
| `skills/arts/arts.test.ts`「武器種ごとに 10 種以上」 | 縛りを外す | 「共通技 60、moveset は全て null」に |
| `loot/affixes.test.ts` / `generator.test.ts` / `migrate.test.ts` / `describe.test.ts` | 性質 70・名のある遺物 18 | 件数と写し |
| `system/keywords.test.ts`（網の網羅） | 定義の入れ替え | 網羅の対象を更新 |
| `qa/simulation.test.ts`（`BoonMetrics` の core / lineage、`ALLOC`）、`qa/bot.ts` | 提示の出所と振り分け | `stairs` を `exit:<lineage>` に、`drainAttributePoints` 削除 |
| `system/runEvents.test.ts` / `contractors.test.ts` / `specialRooms.test.ts`（`resonance` 部屋） | 祝福 key の変更・共鳴炉 | key を差し替え |
| `meta/tips.test.ts` | 項目の増減 | — |
| `npm run audit:docs` | `CODE_MAP.md` の「（`KEYSTONES`、37 種）」などの件数、`GLOSSARY` の旧用語（結び・星座・陰画・拮抗・振り分け・真髄） | 資料を直す（検査は緩めない） |

### 3-6. セーブの移行（v2 は切らない）

| キー | 何が変わるか | 扱い |
| --- | --- | --- |
| `roguelike.skills.v1` | `runes` フィールドの消滅、`skillKey` の入れ替え（398 → 105）、`links` を読まない、`wear.buds` の `link` | **v1 のまま**。`loadSkillProfile` で `runes` を読み捨て、`LEGACY_SKILL_MAP` で写し、写せない石は消す。★6-1 手持ちの刻印符が全て消える（所持品 + 石に付いた分）、★6-2 武器技の石の多くが共通技に変わる |
| `roguelike.profile.v1` | 性質 key の消滅 212 → 70、変換 41 → 12、誓約 37 → 20、`namedKey` 76 → 18、`Item.innate / innateLuck` は不変 | **v1 のまま**。`migrate.ts` に `LEGACY_AFFIX_MAP: Record<string, string | null>`（null = 消す。消えた分は `margin` に +1 で「余白」として残す）、`LEGACY_UNIQUE_MAP`（消えた名のある遺物は `namedKey` を外し普通の遺物として残す）。★6-8 倉庫 400 個の性質の一部が消える |
| `roguelike.codex.v1` / `quests.v1` / `achievements.v1` | 祝福・名のある遺物・スキル key の消滅 | `sanitizeKeyList(…, isBoonKeyString)`（`meta/codexStore.ts:28-29`）が知らない key を落とす。依頼の報酬（名のある遺物の解放）は `quests.ts` の対応表を直す |
| `roguelike.replays.v1` | 版不一致 | 再生拒否（従来どおり） |
| `roguelike.hub.v1` | 変更なし | — |

step の中で保存している既存の負債（`system/loot.ts:248`、`skills/wear.ts:51`）はこの段で **`main.ts` の `endRun` と拠点への戻りに集める**（7c の任意。`skills.ts:2174` はラン内化で消える）。

---

## 4. 段階分けとレーン（各段で遊べる）

### 前置き（統合役、各段の頭）: 共有の型を先に 1 コミット

`core/rules.ts` / `core/events.ts` / `core/state.ts` / `loot/types.ts` / `skills/types.ts` の型だけを足し（挙動は変えない）、`npm run check` を通してからレーンを走らせる。

### 7a. 祝福の骨格（遊べる: 出口で系譜を選び、系譜の 3 枚から選ぶ。中身は今の祝福のまま）

今の 200 種に **仮の系譜 / 札種 / 行動** を機械的に付ける（既存 6 系譜はそのまま、tags から mana / skill → cycle、placed → horde、loot → wealth、それ以外は burn / chill / shock / stagger / combo → 該当系譜。付けられないものは `legacy: true` で提示から外すが持っていれば動く）。振り分けの撤去、錬磨、融合の確定枠、出口の予告をここで入れる。REPLAY 27。

| レーン | 所有 | 最小 Edit | 編集禁止 | 完了条件 |
| --- | --- | --- | --- | --- |
| A 祝福の器（Opus） | `system/boons.ts`、`system/boonDefs.ts`（メタデータ・型）、`system/boonGrade.ts`、`system/boonCores.ts`、`render/boonUi.ts`、`system/boons.test.ts`、`system/boonDefs.test.ts`（新）、`system/boonGrade.test.ts`、`render/boonUi.test.ts`、`balance/boons/BOON.json` | `core/game.ts`（ゲートは同じ）、`system/contractors.ts`（`removeBoon` を import に）、`data/jobs.ts`（`lineage?`） | `system/floor.ts`、`system/specialRooms.ts` | 系譜 3 枚 / 加護 2 枠と入れ替え / 昇華・融合の確定 / 錬磨（`mode: "temper"`）が決定的に動く |
| B 出口の予告（Sonnet） | `system/exits.ts`（新）、`render/exitUi.ts`（新）、`system/exits.test.ts`、`balance/world/EXIT.json`、`meta/tips.ts`（1 項目） | `system/specialRooms.ts`（`StairsChoice.reward`、`planForkStairs` に 1 行）、`system/floor.ts`（`checkStairs` の `offerBoons` に `pendingExit` を渡す、`buildFloor` 末尾で消す、到着報酬の分岐）、`render/minimap.ts`（階段の色）、`render/renderer.ts`（`drawExitHints` 1 行）、`core/state.ts`（`pendingExit`） | `system/boons.ts` | 出口に報酬が出て次の階で確定する。A の `offerBoons(state, boost, lineage)` の署名は前置きで固定 |
| C 振り分けの撤去（Sonnet） | `ui/attributeAlloc.ts`（削除）、`render/attributeUi.ts`、`system/attributes.ts`、`ui/statusTab.ts`、`render/statusTabUi.ts`、`ui/attributeAlloc.test.ts`（削除）、`system/attributes.test.ts`、`render/attributeUi.test.ts`、`ui/statusTab.test.ts`、`balance/combat/ATTR_GAIN.json`、`balance/world/ORIGIN.json`、`balance/world/CONTRACT.json` | `core/state.ts`（`runAttributes` 削除）、`core/game.ts` / `system/hub.ts`（初期化）、`system/player.ts:205`、`system/floor.ts:919, 1005`、`system/runSetup.ts:260-294`、`system/contractors.ts:790`、`core/replay.ts`（alloc）、`qa/bot.ts:545`、`render/inventoryUi.ts:338`、`meta/tips.ts:119`、`docs/GLOSSARY.md`（設計上の用語） | `system/boons.ts` | `rg runAttributes src` が 0 件 |

統合: `REPLAY_VERSION` 27、`CODE_MAP` に exits / exitUi、`GLOSSARY` に 加護 / 摂理 / 研鑽 / 昇華 / 融合 / 錬磨 / 出口の予告 / 至高 / 極致 を「実装済み」で。

### 7b. 祝福の中身（遊べる: 9 系譜 × 11 + 融合 12 + 呪い 6 + 芯 4）

| レーン | 所有 | 最小 Edit | 編集禁止 |
| --- | --- | --- | --- |
| 0 統合役 | 新しい効果の種類（2-6 末尾）の型と `system/rules.ts` の `applyRuleEffect` の分岐、`system/modifiers.ts` の `countPer`、`BoonRunState.tallies`。1 コミット | `core/rules.ts` / `core/events.ts` / `core/state.ts` | — |
| D1 灰燼・霜枷・雷鳴（Opus） | `system/boonDefs/ash.ts` / `frost.ts` / `thunder.ts` + test、`balance/boons/LINEAGE/{ash,frost,thunder}.json` | `system/statusEffects.ts`（還雷の `bounceBack`、氷獄の vault）、`system/combat.ts`（vault の積み） | 他系譜 |
| D2 月蝕・大地・刃鳴（Opus） | `moon.ts` / `earth.ts` / `blade.ts` + test + JSON | `system/combat.ts`（`deferredDamage`）、`system/poise.ts`（`onExecute` を pushEvent）、`system/physics.ts` or `enemies.ts`（`onWallSlam`）、`system/player.ts`（専心の flag、地投げ） | 他系譜 |
| D3 輪廻・眷属・財宝 + 融合 + 呪い（Opus） | `cycle.ts` / `horde.ts` / `wealth.ts` / `fusion.ts` / `cursed.ts` + test + JSON | `system/skills.ts`（`flowMul`、`refreshSkills / echoLast`）、`skills/summons.ts` / `skills/placed.ts`（`retarget / detonatePlaced / 十字砲火`）、`system/enemies.ts`（`allyUntil`）、`system/economy.ts`（`coinShot`） | 他系譜 |
| E 旧祝福の撤去（Sonnet、D の後） | `system/boonRules.ts`（`BoonRuleState` を 0〜5 フィールドへ）、`system/boonDefsWave2.ts` / `boonDefsWave3.ts`（削除）、`system/boonRules.test.ts` / `boonsWave2.test.ts` / `boonsAttrStatus.test.ts` | `system/boons.ts`（`foldBoonStats` / フック 25 本の削除）、フックの呼び元 11 ファイル（1 行ずつ消す）、`system/keywords.ts`（`STATUS_BOON_TAGS` の整理） | D の 3 レーンのファイル |

統合: REPLAY 28。`docs/recipes/boon.md` を「系譜と札」の形に書き直す。QA: 系譜の提示率・1 ランの札の構成（5 章）。

### 7c. スキルと刻印符（遊べる: 技 60 が型で変形、符はラン内）

| レーン | 所有 | 最小 Edit | 編集禁止 |
| --- | --- | --- | --- |
| F 技の圧縮と変形表（Opus） | `skills/arts/keys.ts` / `common.ts`（60）/ `blades.ts` … `throwing.ts`（削除か縮小）、`skills/arts/transform.ts`（新）、`skills/arts/index.ts`、`skills/arts/engine.ts`（`castArt` の頭）、`skills/arts/arts.test.ts`、`skills/arts/transform.test.ts`、`balance/skills/ART/**` | `skills/generator.ts`（`skillWeight` の武器種の差し替えを消す）、`skills/data.ts`（`stoneLabel` に変形の 1 行） | `skills/persistence.ts` |
| G 手書き 76 → 45（Sonnet） | `skills/defs.ts` / `defs2.ts` / `defs3.ts` / `actions.ts` / `actions2.ts` / `shots.ts` / `summons.ts` / `forms.ts` / `combos.ts`、`skills/types.ts`（`LEGACY_SKILL_KEYS`）、`skills/skills.test.ts` / `forms.test.ts` / `expansion*.test.ts`、`balance/skills/{EXTRA,WAVE2,WAVE3}_SKILL_TUNING` | `system/skills.ts`（削除したスキルの分岐） | `skills/arts/**` |
| H 刻印符 30・ラン内化・連動（Opus） | `skills/modifiers.ts` / `modifiers2.ts`（30 に）、`skills/persistence.ts`（runes 廃止・`LEGACY_SKILL_MAP`・wear の写し）、`skills/persistence.test.ts`、`skills/autoCast.test.ts`（新）、`ui/skillRunes.ts`、`render/skillRuneUi.ts`、`balance/skills/SKILL/{_index,modifier}.json` | `skills/types.ts`（runes / ModifierDef）、`system/skills.ts`（`grantRune` → `attachRune`、`moveRunModifier`、`tryAutoCast`）、`system/moments.ts`（`tryAutoCast` 呼び出し 2 行）、`ui/inventory.ts`（スキルタブの符の列）、`core/replay.ts`（`runeCount` を捨てる）、`system/blackMarket.ts` / `merchants.ts` / `contractors.ts`（符の品は床へ落とす） | `skills/arts/**` |

統合: REPLAY 29。`docs/recipes/skill.md` を「共通技 + 変形表 / 符はラン内」に。★6-1・6-2 をこの段の前に確認。

### 7d. 遺物（遊べる: 性質 70・共鳴が源と糧・名のある遺物 18）

| レーン | 所有 | 最小 Edit | 編集禁止 |
| --- | --- | --- | --- |
| I 性質・転じ・誓約（Opus） | `loot/affixes.ts`、`system/traitHooks.ts`（Modifier へ）、`loot/affixes.test.ts`、`loot/generator.test.ts`、`balance/loot/affixCurves/**`、`balance/loot/KEYSTONE.json` | `loot/types.ts`（`AffixTag`、`PlayerStats` の新フィールド）、`loot/stats.ts`（`applyRoll` の modifier push）、`system/damageMods.ts`（`traitIncreased` の整理） | `loot/resonance.ts` |
| J 名のある遺物 18（Opus） | `loot/named.ts`、`loot/named.test.ts`（新）、`loot/migrate.ts`（`LEGACY_UNIQUE_MAP` / `LEGACY_AFFIX_MAP`。I と分担: I が表を渡す）、`loot/migrate.test.ts` | `system/rules.ts:112`（名のある遺物の Rule を装備順で）、`system/modifiers.ts:35`、`system/combat.ts`（逆さ砂時計）、`system/player.ts`（空の鞘）、`render/telegraphLineUi.ts`（星読みの眼） | `loot/affixes.ts` |
| K 共鳴（Opus） | `system/resonance.ts`（新）、`loot/resonance.ts`（削除）、`loot/colors.ts`（色の分類だけ残す）、`ui/synergyPanel.ts`、`render/synergyUi.ts`、`system/resonance.test.ts`（新）、`loot/resonance*.test.ts`（削除）、`balance/loot/RESONANCE.json` | `loot/stats.ts:240-260`（手順 2・3・5 を消す）、`loot/types.ts`（`resonance / constellation` 削除、`ATTR_LABEL`）、`system/keywords.ts`（`countKeywords`）、`system/modifiers.ts`（`resonanceModifiers`）、`system/player.ts`（`applyStats` で写す）、`system/specialRooms.ts:1052-1060`（共鳴炉）、`render/inventoryUi.ts` / `loot/describe.ts` / `render/lootUiParts.ts`（色の配合バーを外す）、`data/weaponForms.ts` / `data/reforges.ts`（`keywords`）、`meta/tips.ts` | `loot/affixes.ts` |
| L 残響 12 → 5（Sonnet） | `loot/crafting.ts`、`ui/echoTab.ts`、`render/echoTabUi.ts`、`loot/crafting.test.ts` | `balance/loot/*ECHO*` | — |

統合: REPLAY 30。`docs/LOOT_DESIGN.md` / `docs/recipes/affix.md` / `GLOSSARY`（共鳴の行を書き直し、星座・陰画・拮抗・主色・無色を「廃止」）。

### 7e. 数値合わせとフル QA（コードは JSON と qa/ だけ）

**ここで初めて数値を合わせる**（性質の中身が変わる前に合わせても無駄になる）。balance-tuner 1 レーン + 統合役。

- 手順: `npm run qa:probe` → 地力 ÷ 敵の生命（`probe.md:501`）を見ながら `INNATE.budget.perDepth`（0.35 → 0.5 前後）と `FLUX.globalScale`、性質の増の曲線の上端を上げ、深度 10 で 0.85、20 で 0.85〜0.9 に。次に被弾で死ぬまでの回数 10〜14 → 4〜7 は **`ENEMY_SCALE.damagePerDepth`（0.05 → 0.08 前後）** と `INNATE.armor.perPoint` を下げる（守りが厚いのは地金の防御行の予算が大きいため）。相乗の倍 Π は「死亡時の内訳」で観測だけ（章 2 で ×1.5〜3、章 4 で ×5〜12 が目標だが札の枚数で自然に出るはず。足りなければ `gradeMagnitudeMul`）
- フル QA（隔離 worktree）: 到達深度・踏破率（目標: 標準の bot で「クリアがちょっと難しい」= 踏破率 10〜20%）、系譜の提示率・札の構成・昇華到達率・融合成立率・錬磨回数、スキル由来与ダメ比率 55〜65%、符の使用分布、装備の有無の到達差（2.63 → 1.5 以下）、共鳴の段数の分布
- REPLAY 31（数値を変えたら）

---

## 5. 調整つまみと測る指標

**つまみ（順に触る）**: `EXIT.weights.boon`（1 ランの祝福の回数 12〜16）→ `BOON.cardWeight`（加護 / 摂理 / 研鑽の比）→ `BOON.apexMinCards`（昇華の遠さ。4 が既定、5 で遠く）→ `EXIT.lineageOwnedMul`（系譜が寄る速さ。1.8 で「2 本目の系譜が章 3 で立つ」）→ `BOON.gradeMagnitudeMul[3..4]`（錬磨の価値）→ `RESONANCE.stepMul`（共鳴 1 段の倍。1.15）→ `SKILL.slotLinks`（主砲の枠の太さ）→ `INNATE.budget.perDepth` / `FLUX.globalScale` / `ENEMY_SCALE.hpPerDepth / damagePerDepth`（7e）。

**フル QA に足す表**（`qa/simulation.test.ts` の `BoonMetrics` を拡張、`qa/buildMetrics.ts` 新規）

| 指標 | 目標 |
| --- | --- |
| 出口の報酬の選択分布（bot は祝福 > 錬磨 > 遺物 > 銭の順） | 祝福の出口の選択率 60〜70% |
| 1 ランの札の構成（加護 / 摂理 / 研鑽 / 昇華 / 融合 / 呪い）と系譜の本数の分布 | 20 階で 12〜16 枚、系譜 1〜2 本が 7 割、昇華到達 4〜6 割、融合成立 2〜3 割 |
| 加護の入れ替え回数・見送り回数 | 入れ替え 1〜2 回 / ラン |
| 錬磨の回数と最高の格 | 4〜6 回、格 4 が 5 割、5 が 1〜2 割 |
| 研鑽の値の分布（灰 / 連 / 恨 …）と、死亡時の相乗の倍 Π | 章 2 で ×1.5〜3、章 4 で ×5〜12 |
| 共鳴の段数の分布（語ごと） | 1 ランで 1〜2 語が 1〜2 段 |
| スキル: 由来与ダメ比率、符の組み合わせの使用分布、終撃 / 応手連動の発動回数 | 55〜65% |
| 遺物: 装備の有無の到達差、性質の族の出現、名のある遺物の出現と固有 Rule の発火回数 | 到達差 1.5 以下 |
| 地力 ÷ 敵の生命（probe）、被弾で死ぬまでの回数 | 0.85〜0.9、4〜7 |
| 踏破率（標準 bot）、原型 3 種（火車 / 硝子の狙撃 / 巡る術士）の bot 方針の到達深度 | 10〜20%、原型ごとにばらつく |

---

## 6. 不確かな点（推奨 1 つ。★ はユーザー確認）

1. ★ **手持ちの刻印符が全て消える**（所持品 + 石に付けた分。B35 承認だが永続データの消滅は別の話）。→ 推奨: 消す（銭や欠片に換えない。換えると 7c が経済に絡む）。拠点の初回起動で 1 回だけ「刻印符は探索ごとに拾い直す仕組みになった」のログを出す。確認: `rg 'runes' src/skills/persistence.ts` の読み捨てと `persistence.test.ts` の新ケース
2. ★ **武器技の石の多くが共通技に変わり、写せない 3 割前後が消える**。→ 推奨: 同形の共通技へ写し、写せないものは消す（`LEGACY_SKILL_MAP`）。確認: 移行前後の `stones.length` を `persistence.test.ts` の fixture で
3. ★ **名前**: 巡り → 輪廻 / 群れ → 眷属 / 財 → 財宝、格 4・5 = 至高 / 極致、昇華「業火」→「劫火」（変身スキル「業火の化身」と衝突。`rg 業火 src` 20 件）、「途切れぬ刃」→「不断」（文にしない）、「標的」は `system/rules.ts:47` と `skills/arts/guns.ts:242` に既にある（狩人の系譜の札に使うなら別名）。→ 推奨: 上の案で確定し GLOSSARY に足す
4. ★ **3 枠目を開く口**: core-synthesis 3-11 は「昇華・名のある遺物・錬磨」。→ 推奨: 昇華と名のある遺物の 2 つだけ（錬磨は格の一本道に）。確認不要、方針だけ
5. ★ **芯 8 → 4**（硝子の心 / 満ち潮の器 / 鉄の巨人 / 病み喰い を削る。数値の入れ替えだけで指の動きが変わらないため）。→ 推奨: 削る。芯の「章ごとに選び直す」は入れない
6. **従魔（敵を従える）の engine**: `tameEnemy` は敵を味方化する新しい仕組み。今の召喚（`skills/summons.ts`）が Enemy とは別の実体なら、眷属の札の半分は「設置物・召喚」で書けるので、7b では従魔化を **昇華と融合だけ**に絞り、engine が重ければ「怯んだ敵の撃破で召喚が湧く」に落とす。確認: `rg 'ally|tamed|charm|faction' src/system/enemies.ts src/skills/summons.ts`
7. **芽の 2 択の変容**（build-core 4-3）はこの段に入れない（7c は圧縮とラン内化だけで大きい）。「枠」の芽は「威力」に写す
8. ★ **倉庫の遺物の性質が一部消える**（212 → 70。数値だけの性質は地金へ移る方針なので、倉庫の古い遺物は「性質が減って余白が増える」）。→ 推奨: 消えた分だけ `margin +1`（芽で埋め直せる）。確認: `migrate.test.ts` で 6 部位の fixture
9. **`direct: true` の撤廃**（scaling-impl 6-2 の先送り）: 7b で旧フック祝福が消えるので同時に撤廃。`rg "direct: true" src` は 2 件
10. **`favoredWeapon` 条件と `favoredMovesets`**（`system/jobs.ts:42-47`。段取り 5 で「段取り 7 で整理」）: 得意武器を読む性質 / 誓約 / 祝福（`rg favoredWeapon src` 19 件）を 7b・7d で全部消し、`JobDef` から `favoredMovesets` を落とす。→ 推奨: 消す
11. **共鳴の数え直しのコスト**: `countKeywords` は装備 6 部位 + 石 4 + 符 + 祝福 20 の走査で、`applyStats` のたび（装備変更・祝福取得）に走るだけなので毎ステップの負荷は無い。ただし研鑽の tally で語が変わることは無いので同期漏れも無い。確認: `qa/simulation.test.ts` の 1 step ms（今 0.22ms）
12. **経済と錬磨の干渉**: 出口「錬磨」を選ぶと祝福 / 遺物 / 銭の出口を捨てるので、経済の指標（economy-impl 5 章）が動く。7e のフル QA で「使い道の内訳」を見る
13. **step の中の保存**（`system/loot.ts:248` / `skills/wear.ts:51`）: 不変条件 8 とずれる既存の負債。7c で `main.ts` の `endRun` と拠点への戻りへ集めるのを推奨（任意。決定性には影響しない）

## 参照（絶対パス）

- 仕様: `/home/user/roguelike/docs/ideas/core-synthesis.md`（1・2-2・3-1・3-11・3-12・5・7・9・10）、`/home/user/roguelike/docs/ideas/build-core.md`（4-3〜4-5・4-7・5・6・7・9）、`/home/user/roguelike/docs/ideas/economy-core.md:251-307`、`/home/user/roguelike/docs/ideas/economy-impl.md:386-388, 421`、`/home/user/roguelike/docs/ideas/run-arc.md:194-231`、`/home/user/roguelike/docs/ideas/scaling-impl.md:13-15, 302, 339, 472`、`/home/user/roguelike/docs/ideas/weapon-forms-impl.md:204, 218, 281, 296, 455`、`/home/user/roguelike/docs/reviews/build-core.review.md`
- コード: `/home/user/roguelike/src/system/boons.ts`、`/home/user/roguelike/src/system/boonDefs.ts`、`/home/user/roguelike/src/system/boonRules.ts`、`/home/user/roguelike/src/system/boonGrade.ts`、`/home/user/roguelike/src/system/boonCores.ts`、`/home/user/roguelike/src/system/reforge.ts`、`/home/user/roguelike/src/system/rules.ts`、`/home/user/roguelike/src/system/modifiers.ts`、`/home/user/roguelike/src/system/moments.ts`、`/home/user/roguelike/src/system/keywords.ts`、`/home/user/roguelike/src/system/floor.ts`、`/home/user/roguelike/src/system/specialRooms.ts`、`/home/user/roguelike/src/system/skills.ts`、`/home/user/roguelike/src/system/traitHooks.ts`、`/home/user/roguelike/src/system/contractors.ts`、`/home/user/roguelike/src/core/rules.ts`、`/home/user/roguelike/src/core/events.ts`、`/home/user/roguelike/src/core/keywords.ts`、`/home/user/roguelike/src/core/damage.ts`、`/home/user/roguelike/src/core/state.ts`、`/home/user/roguelike/src/core/replay.ts`、`/home/user/roguelike/src/skills/types.ts`、`/home/user/roguelike/src/skills/persistence.ts`、`/home/user/roguelike/src/skills/generator.ts`、`/home/user/roguelike/src/skills/arts/index.ts`、`/home/user/roguelike/src/skills/arts/types.ts`、`/home/user/roguelike/src/skills/wear.ts`、`/home/user/roguelike/src/loot/resonance.ts`、`/home/user/roguelike/src/loot/stats.ts`、`/home/user/roguelike/src/loot/affixes.ts`、`/home/user/roguelike/src/loot/named.ts`、`/home/user/roguelike/src/loot/types.ts`、`/home/user/roguelike/src/loot/migrate.ts`、`/home/user/roguelike/src/loot/profile.ts`、`/home/user/roguelike/src/loot/innate.ts`、`/home/user/roguelike/src/loot/flux.ts`、`/home/user/roguelike/src/ui/attributeAlloc.ts`、`/home/user/roguelike/src/data/jobs.ts`、`/home/user/roguelike/src/data/reforges.ts`、`/home/user/roguelike/src/data/balance/boons/BOON.json`、`/home/user/roguelike/src/data/balance/skills/SKILL/_index.json`、`/home/user/roguelike/src/qa/probe.md:501-512`、`/home/user/roguelike/src/qa/gearPower.ts:129`