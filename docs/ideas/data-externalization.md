# バランス数値の JSON 外出し設計

作成: 2026-09-24（architect）。要望: 「武器種・ジョブ・敵などこまめに変えたい数値は JSON で管理し、値をいじれば手軽に変えられるようにしてほしい。今までの分もこれからの分も調整しやすい設計に」。

## 0. 結論

- **JSON は `src/data/balance/*.json`（8 ファイル + 武器 1 ファイル）に置き、Vite の JSON import で束ねる**。ランタイム依存なし・ビルド時に固定。TS 側は `export const PLAYER = BALANCE.combat.PLAYER` の形にして **既存の定数名と参照経路（`PLAYER.melee[0].scaling`、`SKILL.lunge.cost`、`BOON.feastHeal`）を変えない**。tuning を import している 178 ファイルは 1 行も触らずに済む
- **境界は「union 文字列・key・表示名・関数・Rule は TS、それ以外の数値・色・真偽・数値だけのネストは JSON」**。敵・ジョブ・スキルのような「本体テーブル」は TS に identity（key / name / behavior / flags / rules）を残し、数値は JSON の同じ key から `...N.slime` で差し込む 2 枚構成にする
- **型安全は tsc の構造的検査 + 小さな実行時検査**。TS 7（`typescript@7.0.2`）は `moduleResolution: bundler` で JSON import を **リテラルキー付きで型付けする**（scratchpad で確認: JSON 側のキー欠落は tsc で落ちる、`keyof typeof json.x` も効く。union 文字列だけ `string` に広がる）。schema DSL（mini-zod）は **作らない**。実行時検査は `src/data/balance/validate.ts`（有限数・`null` 禁止・`_note` は文字列・テーブル同士のキー集合一致）をテストで回す
- **編集体験は Vite の既定（JSON 保存 → full reload）に任せる**。部分 HMR は作らない（5.1: ENEMIES / SKILL_DEFS / MOVESETS は JSON を spread で写した派生テーブルなので、その場差し替えでは古い値が残る）。**Electron 配布後の差し替えは許さない**（JSON はバンドルに固定。決定性・デイリー・リプレイの前提を守る。MOD は 5.2 で保留）。リプレイには数値のハッシュ `balance` を記録し、不一致なら再生画面で注記する
- **移行は tuning.ts のブロック単位で 5 段階**（基盤 → 敵 → ジョブ → スキル・祝福 → 残り〔戦闘・装備・世界・演出〕→ 武器〔作り直し後〕）。抽出は `scripts/extract-balance.mjs`（Vite の JS API で TS を評価して JSON を吐く。依存追加なし）。ブロックの「なぜ」コメントは implementer が `_note` へ手で写す（TS 7 の npm パッケージには JS の compiler API が無いので自動では拾えない）

## 1. 現状の観察（根拠）

### 1.1 数値の所在は 7 系統・約 17,000 行

| 系統 | ファイル | 行数 | 中身 |
| --- | --- | --- | --- |
| 手触り・共通 | `src/data/tuning.ts` | 3,428 | `export const X = {…} as const` が 50 ブロック。キー約 2,070、色文字列 245、UI 文言 8（`text: "カウンター！"` など） |
| 武器 | `src/data/weapons.ts` + tuning の `WEAPON`（2710〜3220 行） | 714 + 510 | `MOVESETS` は `W.greatsword.steps` のように tuning の表を参照して組む（`src/data/weapons.ts:242,312-334`）。`shape: { kind: "box" }` の union 文字列が 119 か所（**tuning.ts の union 文字列はすべて WEAPON ブロック内**。他ブロックにはゼロ） |
| ジョブ | `src/data/jobs.ts` + tuning の `JOB` | 356 + 57 | `JOBS[].attributes`（数値）と `rules`（Rule）・`favored`（MovesetKey）・説明文（`JOB.x` を埋め込む。`src/data/jobs.ts:104-116`） |
| 敵 | `enemies.ts` / `enemiesWave3.ts` / `enemyCombat.ts` / `enemyCombatWave3.ts` / `enemyDefense.ts` + tuning の `ENEMY_AI` / `ENEMY_TEMPO` / `ELITE` / `BOSS` / `REAPER` | 2,150 | 104 体。`EnemyDef` は 13 個の数値フィールド + union 付きのフラグ（`chargeTrail: "boneWall"`、`deathTerrain: { kind: "bog", radius }`）。防御は `d(SOFT, BIOME_SWAMP, CONTACT)` の名前付き定数で書く（`src/data/enemyDefense.ts:26-72`） |
| スキル | `skills/data.ts` の `SKILL` + `skills/tuning.ts` / `tuning2.ts` / `tuning3.ts` | 2,170 | `SKILL` に 3 ファイルを spread で合流（`src/skills/data.ts:266-276`）。`SKILL_DEFS` は `cooldownSkill(SKILL.lunge, …)` で数値を写す（`:534`）。`tuning2.ts` の型替え表だけ `kind: "cone"` の union（16 か所） |
| 祝福 | tuning の `BOON`（2283〜2710 行）+ `boonDefs*.ts` | 430 + 3,070 | `BOON` は数値 + 色 11。`BoonDef` は name / desc / tags / rules で数値を持たない |
| 装備 | `loot/affixes.ts` の `curve`（201 本）・`bases.ts` の `minLevel`・tuning の `LOOT_DROP` / `RESONANCE` / `KEYSTONE` / `TRIGGER` / `SYNERGY` | 4,534 | `curve: [t(24, 6, 8), …]`（`src/loot/affixes.ts:131-138`）。`apply` 関数と同居 |

### 1.2 型の使われ方

- `as const` のリテラル型に依存しているのは 3 か所だけ: `keyof typeof SKILL.drop.runeOnKill`（`src/skills/generator.ts:100`）、`keyof typeof ROOM_KIND.extra`（`src/system/specialRooms.ts:212`）、`keyof typeof ROOM_KIND.gambleWeights`（`:636`）。いずれも **キー** のリテラルで、JSON import でも保たれる
- 配列添字: `PLAYER.melee[0].scaling` を `!` 無しで読む箇所が 4 つ（`src/system/boonRules.ts:199`、`src/system/attributes.test.ts:186-188`、`src/system/boonsAttrStatus.test.ts:67`）。`as const` のタプル型が `number[]` になると `noUncheckedIndexedAccess` で型エラーになる（`!` を 4 か所足す）。他は既に `?.` / `??` で受けている（`src/render/comboUi.ts:127` など）
- tuning ブロック間の参照は 3 つで、すべて `WEAPON` 内（`src/data/tuning.ts:2731,3150`）。スキル側は `MANA.baseMax`（`src/skills/tuning.ts:85,90`）と `STATUS.bleed.duration`（`src/skills/tuning2.ts:359`）
- tuning を `vi.mock` や `Object.assign` で書き換えるテストは無い（grep 該当なし）。読むだけ

### 1.3 JSON import の型付け（TS 7 で実測）

scratchpad に `x.json` = `{"a":1,"b":{"c":"box"},"arr":[1,2]}` と `import x from "./x.json"` を置いて tsc 7.0.2 を通した結果:

- `resolveJsonModule` を書かなくても解決される（bundler 解決の既定）。書いても同じ。**明示のため `tsconfig.json` に `"resolveJsonModule": true` を足す**
- 型は `{ a: number; b: { c: string }; arr: number[] }`。`keyof typeof x` は `"a" | "b" | "arr"` のリテラル
- `interface T { b: { c: "box" | "arc" } }` への代入は **`string` は `"box" | "arc"` に入らない** で落ちる → union 文字列は JSON に出せない（出すなら実行時に絞る）
- `const t: T = x` で T のキーが JSON に無ければ落ちる（欠落検出）。逆に JSON の余計なキーは落ちない（spread と同じ。余計なキーはテーブル同士のキー集合テストで拾う。4.4）

## 2. 境界: JSON に出すもの・TS に残すもの

| JSON に出す | TS に残す |
| --- | --- |
| 数値（秒・px・倍率・%・ステップ）、色文字列、真偽、数値だけのネスト（`dash: { time, speed }`）、数値配列（`linkWeights`）、AttrKey / Element / FloorKind をキーにした数値表（`attributes: { str: 2 }`、`resist: { fire: 50 }`。値が number ならキーは何でもよい） | `key`、表示名・説明文（localizer の領分。数値の埋め込みは `${JOB.x}` のまま動く）、union 文字列（`behavior` / `shape.kind` / `chargeTrail` / `terrain` / `StatusApply.kind` / `rarity`）、関数（`apply` / `check` / `measure`）、`Rule` / `keywords` / `tags`、`Scaling` の中身以外の型を持つ構造 |

判断規則（迷ったとき）:
1. 値が number / boolean / 色 だけなら JSON
2. union 文字列を 1 つでも含む構造は丸ごと TS（例: `deathTerrain: { kind: "bog", radius: 16 }` は TS に残す。radius だけ JSON に分けない）
3. JSON 側の 1 エントリは TS 側の 1 エントリと **同じ key** で対応させる（敵 `slime`、ジョブ `swordsman`、スキル `lunge`）。キー集合の一致をテストで固定する
4. `Scaling`（`{ base, str?, dex?, … }`）は数値だけなので JSON（`damage: { base: 10.4, str: 1 }`）

具体的な振り分け:

| 対象 | JSON | TS |
| --- | --- | --- |
| 敵（`EnemyDef`） | `radius hp speed contactDamage windup strikeTime recover engageRange attackInterval score minDepth weight dropChance` と `swarm` / `volley` / `explode` / `deathBurst` / `deathBomb` / `deathMana` / `timid` / `laserBeams` / `flank`（数値と色だけの構造） | `key name sprite behavior color recolor boss bossPart phasing blocks rout chargeTrail doubleCharge frenzy pack transformTo bossTitle biomeWeight deathTerrain lob bombTerrain deathRally aura terrainSpeed sporeOnHit` |
| 敵の戦闘（`EnemyCombatDef`） | `poise staggerTime superArmorMul strikeSuperArmorMul` | `inflicts immune rules keywords guard`（`inflicts` は StatusKind の union） |
| 敵の防御（`EnemyDefenseDef`） | 体つき表 `bodies`（SOFT / ARMORED … の defense / warding）、土地表 `biomes`（BIOME_FORGE … の耐性）、敵ごとの `{ body, biome?, resist?, stages? }`（body / biome は **JSON 内の表の key** なので文字列でよい。存在はテストで検査） | `attack`（`AttackProfile` は union）。`d(...)` ヘルパは `defenseOf(key)` に置き換え |
| ジョブ | `JOB` ブロック全体、`JOBS[].attributes`、`weakness.mul`（number 表） | `name desc favored rules starterSkill starterWeapon weakness.text keywords unlockedBy` |
| スキル | `SKILL` 直下の共通値、各スキルの `cost / cooldown / minInterval / poise / damage(Scaling) / radius …`、刻印符 `modifier.*`、`drop` | `SKILL_DEFS`（name / verb / tags / axes / resource / applies / rules）。`tuning2.ts` の型替え表（`kind: "cone"` を含む 16 エントリ）は小さいので TS に残す |
| 祝福 | `BOON` ブロック全体 | `boonDefs*.ts` 全部 |
| 装備 | `LOOT_DROP PICKUP RESONANCE KEYSTONE TRIGGER SYNERGY STASH_CAPACITY ARMOR_K ARMOR_MAX_REDUCTION`、`affixCurves`（性質 key → `CurvePoint[]`）、`bases` の `minLevel` / `marginBonus` | `AffixDef` の `label tags slots color apply stage cap awakening`、`UNIQUES`、`IMPLICITS` |
| 武器（後回し） | `WEAPON` の段の数値（`windup active recover scaling poise reach size knockback mana hits hitstop shake lunge`）、`charge.levels`、`tip`、`SHOT_TYPES` の倍率、`trail` 色 | `shape`（union）、`heavy`（段の性格なので TS 推奨）、`applies`、`branches[].sequence`（ButtonKey の union）、`rules`、`primary / secondary` |
| 世界・演出 | `ROOM ROOM_KIND FLOOR_KIND CAVE ROAM RUN_EVENT LINGER ORIGIN CONTRACT RUN_MOD HUB HUB_DECOR META DISCOVERY` / `FEEL EFFECTS MINIMAP MUSIC`（`ROOM_KIND.locks` は boolean 表なので JSON 可） | `text: "カウンター！"` などの UI 文言 8 つは **`ACTION` から `data/actionText.ts` に切り出して TS に残す**（localizer が触る文字列を JSON に混ぜない） |

## 3. ファイル構成と JSON の書き方

```
src/data/balance/
  index.ts            JSON の読み込み・_note の剥ぎ取り・readonly 化・BALANCE_HASH
  validate.ts         実行時検査（純関数。テストから呼ぶ）
  balance.test.ts     全ファイルの検査 + テーブル同士のキー集合一致
  combat.json         PLAYER HEAL ARMOR STATUS ATTR ATTR_GAIN MANA POISE ACTION(文言除く) ELEMENT GENRE TERRAIN TERRAIN_*
  enemies.json        ENEMY_AI ENEMY_TEMPO ELITE ELITE_GREEDY DOUBLE_CHARGE BOSS REAPER + stats / combat / defense（敵ごと）
  jobs.json           JOB + attributes / weakness（ジョブごと）
  skills.json         SKILL 共通 + スキルごと + modifier + drop（tuning.ts / tuning2.ts / tuning3.ts を合流）
  boons.json          BOON
  loot.json           LOOT_DROP PICKUP RESONANCE KEYSTONE TRIGGER SYNERGY STASH_CAPACITY ARMOR_* + affixCurves + bases
  world.json          ROOM ROOM_KIND FLOOR_KIND CAVE ROAM RUN_EVENT LINGER ORIGIN CONTRACT RUN_MOD HUB HUB_DECOR META DISCOVERY
  feel.json           FEEL EFFECTS MINIMAP MUSIC
  weapons.json        WEAPON（武器の作り直し後。段 5）
```

書き方の規約（`docs/ARCHITECTURE.md` にも写す）:

- **トップレベルのキーは今の定数名そのまま（大文字）**。`PLAYER.dash.speed` を変えたいときに `combat.json` → `"PLAYER"` → `"dash"` → `"speed"` と grep で辿れることを優先する（小文字化しない）
- **配列より key のオブジェクト**。敵・ジョブ・スキルはすべて `"slime": { … }` の形。順序に意味がある段（`melee` の 3 段、`charge.levels`）だけ配列
- **コメントは `"_note"`**（文字列。任意のオブジェクトの先頭に 1 つ）。ブロック単位の「なぜ」（QA の履歴）はここに写す。`_` で始まるキーは読み込み時に剥がされ、型からも消える（4.1 の `Clean<T>`）。個別の値について書きたい場合も `_note` に `"speed: 120 = 1 秒に 120px …"` の形でまとめる（`speed_note` のような兄弟キーは **禁止**。`keyof` で列挙する表を汚す）
- **単位を `_note` に書く**: 秒 / px / 倍率（1 = 等倍）/ 割合（0..1）/ %（表示単位。`+25%` は `25`）/ ステップ（60Hz。ヒットストップだけ）。ファイル先頭の `_note` に単位の凡例を置く
- 整形は 2 スペース・末尾改行（`.editorconfig` のまま）。長い段の行（武器の段）は 1 段 1 行を許す

例（`enemies.json` の一部）:

```json
{
  "_note": "敵の数値。単位: hp / contactDamage は生命、speed は px/秒、windup / strikeTime / recover / attackInterval は秒、engageRange / radius は px、weight は出現の重み、dropChance は 0..1",
  "ENEMY_AI": {
    "_note": "同時に strike に入れる敵は 2 体まで（QA 0.0.7α: 1 対 1 被弾 9.74 回/60 秒。囲まれたとき予告の重なりで避けられない瞬間を作らない）",
    "maxSimultaneousStrikers": 2,
    "strikerHoldTime": 0.1
  },
  "stats": {
    "slime": { "radius": 6, "hp": 20, "speed": 50, "contactDamage": 8, "windup": 0.35, "strikeTime": 0.22, "recover": 0.4, "engageRange": 44, "attackInterval": 0.18, "score": 10, "minDepth": 1, "weight": 5, "dropChance": 0.08 },
    "goldSlime": { "_note": "逃げるだけ。engageRange 0 で攻撃しない", "radius": 6, "hp": 30, "speed": 72, "contactDamage": 0, "windup": 0.35, "strikeTime": 0.22, "recover": 0.4, "engageRange": 0, "attackInterval": 1, "score": 150, "minDepth": 2, "weight": 0.5, "dropChance": 1, "timid": { "lifetime": 10 } }
  },
  "combat": {
    "slime": { "poise": 25, "staggerTime": 0.5, "superArmorMul": 0.5 }
  },
  "defense": {
    "bodies": { "soft": { "defense": 0, "warding": 0 }, "armored": { "defense": 30, "warding": -15 } },
    "biomes": { "forge": { "fire": 50, "ice": -50 }, "swamp": { "poison": 50, "lightning": -50 } },
    "enemies": { "slime": { "body": "soft", "biome": "swamp" }, "eye": { "body": "caster", "resist": { "light": 25, "dark": -50 } } }
  }
}
```

TS 側（`src/data/enemies.ts`）はこうなる:

```ts
import { BALANCE } from "./balance";
const N = BALANCE.enemies.stats;
export const ENEMIES: readonly EnemyDef[] = [
  { key: "slime", name: "スライム", sprite: "slime", behavior: "chaser", color: "#60c060", ...N.slime },
  { key: "goldSlime", name: "金色スライム", sprite: "goldSlime", recolor: { … }, behavior: "chaser", color: "#f8d848", ...N.goldSlime },
];
```

`N.slime` は JSON の型でキーが確定しているので、JSON から敵を消すと tsc がここで落ちる。逆（TS から消して JSON に残る）は `balance.test.ts` のキー集合一致で落ちる。

## 4. 読み込みと型安全

### 4.1 `src/data/balance/index.ts`

```ts
import combatJson from "./combat.json";
import enemiesJson from "./enemies.json";
// … 8 ファイル

/** `_` で始まるキー（_note）を型から消し、全体を readonly にする */
export type Clean<T> = T extends readonly (infer U)[]
  ? readonly Clean<U>[]
  : T extends object
    ? { readonly [K in keyof T as K extends `_${string}` ? never : K]: Clean<T[K]> }
    : T;

/** 実行時にも _note を剥がす（state に紛れ込ませない） */
export function stripNotes<T>(value: T): Clean<T>;

export const BALANCE = {
  combat: stripNotes(combatJson),
  enemies: stripNotes(enemiesJson),
  jobs: …, skills: …, boons: …, loot: …, world: …, feel: …,
} as const;

/** 数値の版。リプレイに記録し、再生時の不一致を注記する（core/rng の hashSeed を流用。8 桁 hex） */
export const BALANCE_HASH: string;
```

- `data/tuning.ts` は各ブロックを `export const PLAYER = BALANCE.combat.PLAYER;` に置き換える。**ファイルは残す**（178 ファイルの import 先を変えないため）。移行が終わるとブロックの再 export と、TS に残す少数の定数だけになる
- `Clean<T>` により `as const` 相当の readonly は保たれる。配列がタプルでなくなる分は 1.2 の 4 か所に `!` を足す
- `stripNotes` は JSON.parse 済みの値を深く写すだけ。モジュール評価時に 1 回
- `BALANCE_HASH` は `hashSeed(JSON.stringify(BALANCE))`（`src/core/rng.ts:42`。ファイル順・キー順が固定なので決定的）を 8 桁 hex にしたもの

### 4.2 `src/data/balance/validate.ts`（純関数・依存なし）

```ts
export interface BalanceIssue { path: string; message: string }
/** 汎用検査: 数値は有限、null 禁止、_note は文字列、空オブジェクト禁止、キーは識別子（英数と _） */
export function validateBalanceShape(root: unknown, file: string): BalanceIssue[];
/** 表同士のキー集合が一致するか（JSON に余分・TS に余分 の両方を報告） */
export function diffKeySets(label: string, jsonKeys: Iterable<string>, tsKeys: Iterable<string>): BalanceIssue[];
```

範囲（負の hp、1 を超える dropChance など）は **ここでは見ない**。既にある領域テスト（`src/data/enemyCombat.test.ts:34-48` の防御範囲、`weapons.test.ts` の段数・威力の固定値、`system/mana.test.ts` のコスト平均）が JSON 化後もそのまま効く。汎用検査に範囲を足すと領域ごとの例外が増えて嘘になる。

### 4.3 `tsconfig.json`

`"resolveJsonModule": true` を足す（1 行。TS 7 の bundler 解決では既定で解決されているが、意図を明示する）。`tsconfig.electron.json` は `src/data/balance` を include しないので変更なし。

### 4.4 テスト（`src/data/balance/balance.test.ts`）

- 「各 JSON が汎用検査を通る（有限数・null 無し・_note は文字列）」
- 「enemies.json の stats / combat / defense.enemies のキー集合が ENEMIES の key と一致する」
- 「defense.enemies の body / biome が bodies / biomes に存在する」
- 「jobs.json のキー集合が JOB_KEYS と一致する」
- 「skills.json のスキルのキー集合が SKILL_KEYS と一致し、modifier のキー集合が MODIFIER_KEYS と一致する」
- 「loot.json の affixCurves のキー集合が AFFIXES のキーと一致する」
- 「BALANCE_HASH は 8 桁 hex で、同じ内容なら同じ値」

## 5. 編集体験

### 5.1 dev サーバ（HMR）

**JSON を保存すると Vite が full reload する（既定の挙動）。それに任せる。**

- 理由: `ENEMIES`（`...N.slime`）、`SKILL_DEFS`（`cooldownSkill(SKILL.lunge, …)`）、`MOVESETS`（`{ ...ACTION.dashAttack, shape: BOX }`）、`JOBS` の説明文（`${JOB.x}` 埋め込み）は **モジュール評価時に JSON の値を写す派生テーブル**。`import.meta.hot.accept` で JSON オブジェクトをその場で深く差し替えても、これらには反映されず「PLAYER は変わったのに敵は変わらない」状態になる。ユーザーが最も触りたい敵・ジョブ・スキルがまさに派生テーブル側なので、部分 HMR は逆に混乱を生む
- 代償: ラン中に保存するとタイトルに戻る。数値調整のループは「保存 → 新しいランを同じ seed で始める」になる。**任意の補助**として、dev のときだけ直前のラン設定（seedText・起点・ジョブ・縛り）を `sessionStorage` に覚えて、タイトルに「同じ条件でもう一度」を出す案を段 5 の後に検討する（`main.ts` の Edit が要るので今回の範囲外）
- リプレイ記録中に reload が入ると記録は捨てられる（今と同じ）

### 5.2 Electron 版

- **JSON はバンドルに固定し、配布後の差し替え口は作らない**。`resources/` や `userData/balance/` からの読み込みは実装しない
- 理由: (1) 決定性の前提（同じ seed + 同じ入力 → 同じ結果）が「同じ数値」を含んでいる。差し替えを許すとデイリーの比較とリプレイの再現が壊れる (2) 調整するのはユーザー本人で、`npm run dev` か `npm run electron:dev` で JSON を直せば足りる (3) 今の main プロセスは `save/` の既知キー以外を読まない設計（`electron/main.ts:83-120`）で、読み込み口を増やすと検証の穴になる
- 将来 MOD を許すなら: `userData/mods/balance/*.json` を起動時に読み、`BALANCE` に **上書きマージ**して `BALANCE_HASH` を再計算、タイトルに「改変版」バッジ、デイリー・実績の記録を止める。`BALANCE` が 1 か所に集まる本案の上に乗せられる

### 5.3 決定性・リプレイ

- `ReplayData` に `balance?: string`（`BALANCE_HASH`）を足す。`REPLAY_VERSION` は **上げない**（入力列の意味は変わらない。欄の無い旧記録はそのまま再生する。`src/core/replay.ts:33-42` の方針と同じ）
- 再生時は `data.balance !== BALANCE_HASH` なら再生画面に「数値が違う版の記録です。結果がずれることがあります」を出す（再生は拒否しない。ずれたら `result` との不一致を今の仕組みが検出する）
- 変更点: `src/core/replay.ts`（欄と `balanceMismatch(data): boolean`）、`src/main.ts`（記録時に `balance: BALANCE_HASH`、再生画面の注記 1 行）。QA の `src/qa/report.md` の先頭にも `BALANCE_HASH` を書く（`src/qa/simulation.ts` の出力に足す）

## 6. 移行計画

原則: **1 段 = tuning.ts のブロック群 1 組 + 対応する TS テーブル**。各段の完了条件は `npm run check` と、その段に関係する既存テストが 1 つも変わらないこと（固定値テストが「数値を変えていない」証拠になる）。数値の変更と移行を同じコミットに混ぜない。

### 6.0 抽出スクリプト `scripts/extract-balance.mjs`

- Vite の JS API で TS を評価して値を取り出す（依存追加なし。`scripts/electron-dev.mjs:8,16` が既に `createServer` を使っている）:
  ```js
  const server = await createServer({ root: ROOT, server: { middlewareMode: true }, logLevel: "error" });
  const runner = createServerModuleRunner(server.environments.ssr);   // Vite 6+ の module runner
  const tuning = await runner.import("/src/data/tuning.ts");
  writeJson("src/data/balance/combat.json", pick(tuning, ["PLAYER", "HEAL", …]));
  ```
- 引数で段を選ぶ（`node scripts/extract-balance.mjs combat|enemies|jobs|skills|boons|loot|world|feel|weapons`）。出力は 2 スペース整形・キー順は元のまま（`JSON.stringify` は挿入順を保つ）
- **コメントは拾えない**（TS 7 の npm パッケージに `createSourceFile` が無い。`node -e "require('typescript').createSourceFile"` → undefined）。implementer が段ごとにブロック先頭の doc コメントと「QA …」「memo …」で始まる行内コメントを `_note` に写す。写す対象を「なぜ」に限り、「何」（`/** 秒 */`）は単位の凡例で代替する
- 敵の `stats` のように TS のテーブルから数値フィールドだけ抜く段は、スクリプト側に「敵 1 体から JSON に出すフィールド一覧」（2 章の表）を定数で持たせ、残りを TS に残す。TS 側の書き換え（フィールド削除と `...N.key` の追加）は implementer が行う（104 体 × 1 行の機械的な編集）
- スクリプトは移行中だけ使う。移行が終わったら削除する（JSON が正になった後は逆方向の同期は要らない）

### 6.1 段 0: 基盤

`src/data/balance/{index,validate}.ts`、`balance.test.ts`、`validate.test.ts`、`tsconfig.json` の 1 行、`scripts/extract-balance.mjs`。JSON はまだ小さくてよい（`combat.json` に `PLAYER` だけ入れて配線を通す。`PLAYER` は `src/system/attributes.test.ts:186-188` の固定値 7.8 / 7.8 / 15.6 が守ってくれる）。

### 6.2 段 1: 敵

`enemies.json`（`ENEMY_AI ENEMY_TEMPO ELITE ELITE_GREEDY DOUBLE_CHARGE BOSS REAPER` + `stats` / `combat` / `defense`）。`enemies.ts` / `enemiesWave3.ts` / `enemyCombat.ts` / `enemyCombatWave3.ts` / `enemyDefense.ts` を 2 章の表どおりに分ける。`enemyDefense.ts` の `d(...)` は `defenseOf(key)`（JSON の `body` / `biome` / `resist` / `stages` を畳んで `attack` を TS の表から足す）に置き換える。`data/enemyCombat.test.ts` はそのまま通ること。

### 6.3 段 2: ジョブ

`jobs.json`（`JOB` + ジョブごとの `attributes` / `weakness.mul`）。`jobs.ts` の `attributes: { str: 2, … }` を `attributes: J.swordsman.attributes` に。`system/jobs.test.ts` の「合計 0」がそのまま通ること。

### 6.4 段 3: スキル・祝福

`skills.json`（`SKILL` 共通 + `skills/tuning.ts` / `tuning2.ts` / `tuning3.ts` の数値。`MANA.baseMax` / `STATUS.bleed.duration` の参照は数値に展開し、一致を `balance.test.ts` に 1 件足す）。`tuning2.ts` の型替え表（`kind: "cone"`）は `skills/reshapes.ts` として TS に残す。`boons.json`（`BOON`）。`skills/data.ts` は `SKILL = BALANCE.skills.SKILL` の 1 行に、`skills/tuning*.ts` は削除。`system/mana.test.ts` のコスト平均、`skills/skills.test.ts` の `FORBIDDEN` はそのまま。

### 6.5 段 4: 残り（戦闘・装備・世界・演出）

`combat.json` の残りブロック、`loot.json`（tuning のブロック + `affixCurves` + `bases`）、`world.json`、`feel.json`。`ACTION` の文言 8 つは `src/data/actionText.ts` へ。`affixes.ts` の `curve: [t(…)]` は `curve: CURVES.meleeDamagePct`（`const CURVES = BALANCE.loot.affixCurves`。キー欠落は tsc、余分はテスト）。`t` / `t2` ヘルパは削除。

### 6.6 段 5: 武器（作り直しの後）

`weapons.json`（`WEAPON`）。段の `shape` は TS に残すか、`hitShape(json.shape)`（`kind` を `HitShape["kind"]` の一覧で絞って throw）で受ける。**作り直し（`arch-weapon2`）の設計が `MovesetDef` を変えるので、その形が固まってから JSON の形を決める**。段 0〜4 は武器に触らないので並行できる（`WEAPON` ブロックと `weapons.ts` は他の段の所有ファイルに含めない）。

## 7. CLAUDE.md とレシピの書き換え（統合役が編集）

不変条件 4 の新しい文言:

> 4. **バランス数値は `src/data/balance/*.json`**（トップレベルのキーは `PLAYER` / `BOON` / `SKILL` などブロック名。`_note` に「なぜ」と単位）。ロジックは `data/tuning.ts` / `skills/data.ts` が再 export する定数（`PLAYER.dash.speed` など）経由で読み、数値を直書きしない。union 文字列・key・表示名・関数は TS に残す（境界は `docs/ideas/data-externalization.md` 2 章）。JSON と TS のテーブルは同じ key で対応させ、キー集合の一致を `src/data/balance/balance.test.ts` が検査する

「要素の足し方」の各レシピに 1 行足す:

- 敵: 「`src/data/balance/enemies.json` の `stats` / `combat` / `defense.enemies` に同じ key で数値を足す（無いと `...N.key` で tsc が落ちる）」
- ジョブ: 「`jobs.json` に `attributes` / `weakness.mul` を同じ key で」
- スキル / 刻印符: 「数値は `skills.json` の同じ key（`SKILL.<key>` 経由で読むのは今と同じ）」
- 性質: 「`curve` は `loot.json` の `affixCurves` に同じ key で」
- 祝福: 「数値は `boons.json` の `BOON`」
- 武器種: 段 5 の後に追記

`docs/ARCHITECTURE.md` の `data/` の行と「決定性とリプレイ」節に `BALANCE_HASH` の 1 段落。

## 8. 実装レーン（Sonnet implementer 向け）

### レーン A: 基盤（段 0）

- 所有（新規）: `src/data/balance/index.ts`、`validate.ts`、`balance.test.ts`、`validate.test.ts`、`combat.json`（`PLAYER` のみ）、`scripts/extract-balance.mjs`
- 最小 Edit: `tsconfig.json`（`resolveJsonModule`）、`src/data/tuning.ts`（`PLAYER` ブロックを `export const PLAYER = BALANCE.combat.PLAYER;` に置換。他ブロックは触らない）、`src/system/boonRules.ts:199` / `src/system/attributes.test.ts:186-188` / `src/system/boonsAttrStatus.test.ts:67`（`PLAYER.melee[i]!`）
- 編集禁止: 上記以外の `src/**`、`electron/**`
- 先に読む: この文書 3〜4 章、`src/core/rng.ts:42`（`hashSeed`）、`src/version.test.ts`（JSON を読むテストの前例）
- 公開 API: 4.1 / 4.2 のシグネチャ。`Clean<T>` / `stripNotes` / `BALANCE` / `BALANCE_HASH` / `validateBalanceShape` / `diffKeySets`
- テスト（`it` 名）: 「_note を剥がして readonly の値を返す」「_ で始まるキーは型からも消える（`// @ts-expect-error`）」「有限でない数値・null・文字列でない _note を path 付きで報告する」「diffKeySets は JSON 側の余分と TS 側の余分を両方報告する」「BALANCE_HASH は 8 桁 hex」
- 完了条件: `npm run check` 成功。`src/system/attributes.test.ts` の固定値テストが無変更で通る。`node scripts/extract-balance.mjs combat` が `combat.json` と同じ内容を吐く（差分ゼロ）

### レーン B: 敵（段 1。A の後）

- 所有: `src/data/balance/enemies.json`、`src/data/enemies.ts`、`enemiesWave3.ts`、`enemyCombat.ts`、`enemyCombatWave3.ts`、`enemyDefense.ts`
- 最小 Edit: `src/data/tuning.ts`（`ENEMY_AI ENEMY_TEMPO ELITE ELITE_GREEDY DOUBLE_CHARGE BOSS REAPER` の 7 ブロックを再 export に）、`src/data/balance/balance.test.ts`（敵のキー集合 3 件 + body / biome の存在）
- 追加する関数: `enemyDefense.ts` に `defenseOf(key: string): EnemyDefenseDef`（`BALANCE.enemies.defense` を畳む）、`ENEMY_ATTACK: Readonly<Record<string, AttackProfile>>`（`attack` を TS に残す表）
- テスト: 上記 + 既存 `data/enemyCombat.test.ts` / `system/enemies.test.ts` / `render/sprites.test.ts` が無変更で通る
- 完了条件: `npm run check`。`git diff --stat` で `system/**` に変更が無い

### レーン C: ジョブ（段 2。A の後。B と並行可）

- 所有: `jobs.json`、`src/data/jobs.ts`。最小 Edit: `tuning.ts`（`JOB`）、`balance.test.ts`（ジョブのキー集合）。既存 `system/jobs.test.ts` 無変更

### レーン D: スキル・祝福（段 3。A の後。B / C と並行可）

- 所有: `skills.json`、`boons.json`、`src/skills/data.ts`（`SKILL` の部分のみ）、`src/skills/tuning.ts` / `tuning2.ts` / `tuning3.ts`（削除。型替え表は `skills/reshapes.ts` に残す）。最小 Edit: `tuning.ts`（`BOON`）、`balance.test.ts`（スキル・刻印符のキー集合、`MANA.baseMax` との一致）。既存 `system/mana.test.ts` / `skills/skills.test.ts` / `system/boons.test.ts` 無変更

### レーン E: 残り（段 4。B〜D の後）

- 所有: `combat.json`（残り）、`loot.json`、`world.json`、`feel.json`、`src/data/actionText.ts`（新規）、`src/loot/affixes.ts`（`curve` の置換のみ）、`src/loot/bases.ts`。最小 Edit: `tuning.ts`（残り全ブロック → 再 export だけのファイルに）、`ACTION.x.text` を読む数か所（`ACTION_TEXT.x` へ）、`src/core/replay.ts` / `src/main.ts`（5.3 の `balance` 欄と注記）、`src/qa/simulation.ts`（report 先頭のハッシュ）、`docs/ARCHITECTURE.md`
- 完了条件: `npm run check`。`grep -c "as const" src/data/tuning.ts` が 0。`src/qa/report.md` に `BALANCE_HASH` が出る

## 9. 却下した案

- **schema DSL（mini-zod）で型を導く**: 約 2,070 キーぶんの schema を書く手間が移行そのものより大きく、tsc の構造的検査で欠落は既に拾える。union 文字列は TS に残す方針にしたので、実行時に絞る場面がほぼ無い
- **`import.meta.hot.accept` でその場差し替え**: 派生テーブル（ENEMIES / SKILL_DEFS / MOVESETS / JOBS の文言）に反映されず、半分だけ変わった状態を作る（5.1）
- **Electron の `resources/balance/` を起動時に読む**: 決定性・デイリー・リプレイの前提が崩れる。ユーザー本人が dev で直すので不要。MOD は 5.2 の形で後から乗せられる
- **敵・ジョブ・スキルの本体テーブルを丸ごと JSON にする（behavior や rules も文字列で）**: `Rule` と union 文字列の実行時検証が要り、`EnemyBehavior` を足すたびに 2 か所（型と検証の一覧）を直すことになる。「数値は JSON、振る舞いは TS」の境界の方が追加レシピが短い
- **JSON のキーを小文字化・スネーク化する**: 検索性が落ちる。`PLAYER.dash.speed` ↔ `"PLAYER" > "dash" > "speed"` の 1 対 1 を保つ
- **`speed_note` 形式の兄弟コメントキー**: `keyof typeof ROOM_KIND.extra` のような列挙表を汚す。`_note` 1 種類に限る
- **tuning.ts を廃止して全ファイルの import 先を `balance` に変える**: 178 ファイルの Edit になり、並行中の他レーンと衝突する。再 export で済む

## 10. 不確かな点と確かめ方

1. **Vite 8 の module runner API 名**（6.0）: `createServerModuleRunner` と `server.environments.ssr` が Vite 8 でそのまま使えるか。`node -e "import('vite').then(v => console.log(typeof v.createServerModuleRunner))"` で確認。無ければ `server.ssrLoadModule("/src/data/tuning.ts")`（非推奨だが残っている想定）
2. **JSON import の型が 3,000 キー規模で tsc / エディタを遅くしないか**: 段 1 の後に `npm run check` の tsc の秒数を段 0 と比べる（`scripts/check.mjs` が秒数を出す）。1 ファイルが大きすぎるなら `enemies.json` を `enemies.stats.json` / `enemies.ai.json` に割る
3. **`Clean<T>` の `as` 句によるキー除去が深いネストで型の推論を鈍らせないか**: 段 0 のテストで `BALANCE.combat.PLAYER.melee[0]!.scaling.base` が `number` に推論されることを `expectTypeOf` で固定する
4. **Vite の JSON 変換と `_note`**: `build.json.stringify` の既定（`auto`）で問題ないはず。`vite build` 後の `dist/assets/*.js` に `_note` の文字列が残る（バンドルサイズが少し増える）。気になれば `stripNotes` を build 時に前倒しする Vite プラグイン（依存なし・数行）を後で足す
5. **`vitest` の JSON import**: Vite と同じ変換なのでそのまま読める想定。段 0 の `balance.test.ts` で確認
6. **`!` を足す 4 か所以外に tuple 型へ依存した箇所が無いか**: 段 0 で `PLAYER` を移した時点の tsc のエラー一覧がそのまま網羅になる（他ブロックも段ごとの tsc で洗う）
7. **QA report のハッシュ**: `src/qa/simulation.ts` の所有者（qa-runner）と調整
8. **武器の作り直しとの順序**: `arch-weapon2` の設計が `MeleeStepDef` / `MovesetDef` を変える前提で、段 5 はその後。段 0〜4 は `WEAPON` ブロックと `weapons.ts` を触らないことを各レーンの編集禁止に明記する

## 11. ユーザー向け: 数値の変え方

全部 `src/data/balance/*.json` を直接編集する。保存すると Vite が自動で再読み込みする（5.1。ラン中はタイトルへ戻る）。`npm run check` は通さなくても `npm run dev` は動くが、変える前に一度 `npm run check` で今の状態がクリーンか確かめておくと、自分の変更で壊れたのか元から壊れていたのか切り分けやすい。

**武器の振りの速さを変える**（例: 大剣の 1 段目を速くする）:
1. `src/data/balance/weapons.json` を開き、`WEAPON.movesets.greatsword.steps` の配列を探す（1 段 1 行）
2. 1 段目の `"windup"`（振りかぶり）・`"active"`（当たり判定が出ている秒数）・`"recover"`（硬直）を小さくする。単位は秒（ファイル先頭の `_note` に凡例）
3. 保存 → dev サーバが再読み込み。3 段目だけ・特定の派生（`branches`）だけ変えたいときも同じ配列の中の該当オブジェクトを探して編集する

**武器の威力を変える**:
- 同じ `steps[i]` の `"scaling"`（`{ "base": 8, "str": 0.9 }` の形）。`base` はステータス基礎値（各 5）のときの威力、`str` などは 1 あたりの伸び。持っているステータス次第で最終ダメージは変わるので、`base` だけ上げると素の威力が、`str` を上げるとそのステータスを伸ばしたときの伸びしろが変わる
- 固有技（右クリック）は `WEAPON.movesets.<武器種>.art` の中（`strike` 技なら `.step.scaling`、`throw` 技なら `.throw.scaling`）

**ジョブのステータスの偏りを変える**:
1. `src/data/balance/jobs.json` の `attributes.<ジョブ名>` を開く（例: `attributes.swordsman`）
2. `str` / `dex` / `vit` / `mnd` / `spi` の数値を書き換える。**合計が 0 になるように**（`system/jobs.test.ts` の「合計 0」テストが崩れを検出する）。弱点（`weakness.<ジョブ名>`）はこの偏りと対になっているので、強くしすぎたら弱点側もセットで見直す

**敵の HP を変える**:
1. `src/data/balance/enemies.json` の `stats.<敵の key>.hp` を書き換える（例: `stats.slime.hp`）。敵の key は `src/data/enemies.ts` の `ENEMIES` 一覧の `key` と同じ（日本語名ではなく英語の key で引く）
2. 怯み耐性（怯みにくさ）を変えたいときは `combat.<敵の key>.poise`、防御・耐性は `defense.enemies.<敵の key>`

**共通の注意**:
- 数値だけを直す分には型は壊れない（`shape.kind` のような形の種類や `key` は文字列の一覧と照合されるので、存在しない値を書くと `npm run check` の vitest で落ちる）
- 変えたら該当のテスト（`npx vitest run src/data/weapons.test.ts` など）と `npm run check` を通す。テストは「数値を変えていないこと」を固定しているものが多いので、意図した数値変更でテストが落ちるのは正常（そのテストの期待値も一緒に直す）
