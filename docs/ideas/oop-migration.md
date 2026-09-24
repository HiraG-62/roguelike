# オブジェクト指向化とバランス調整ファイルの設計（docs/ideas/oop-migration.md 案）

作成: 2026-09-24（architect）。要望（memo「プロジェクト方針」）: 要素が増えたので親クラス + 継承で拡張しやすくしたい。数値は今のように分離したまま、項目の意味が人に読める形にしたい。

## 0. 結論

- **クラスにするのは「振る舞い」だけ。「定義データ」と「実行時の状態」はプレーンなまま残す**。敵の behavior（55 種、`src/system/enemies.ts` に約 15 か所の `switch (def.behavior)`）から始め、`EnemyBehaviorBase` → 家族（Rusher / Charger / Keeper / Flyer / Stationary / BossDriven）→ 個別クラスの 3 段の継承にする。インスタンスは**状態を持たない凍結された単一体**（`Object.freeze`）で、`Record<EnemyBehavior, EnemyBehaviorBase>` の登録表から引く。`GameState` / `Enemy` / `EnemyDef` はプレーンのまま（`structuredClone`・fingerprint・QA・`arena` ヘルパーが壊れない。乱数の消費順も変わらない）
- **バランス調整ファイルは JSON のまま**で、`_note`（なぜ）に加えて **`_fields`（項目ごとの「意味・単位・目安」）** を導入する。`_` 始まりのキーは既に `Clean<T>` / `stripNotes` が型と実行時から剥がす（`src/data/balance/index.ts:18-40`）ので配線の変更ゼロ、`BALANCE_HASH` も変わらない。`validate.ts` に「stale な説明」と「説明の無い数値の葉」の検査を足し、網羅はファイルごとの基準値を下げるだけのラチェットで守る。YAML / JSONC は tsc の JSON import 型付け（`...N.slime` の欠落検出）を失うか二重管理になるので採らない
- **移行は strangler**。第 1 段（今夜）は 2 レーン: A「behavior 登録表の骨格 + 定数表 5 つ + 述語 2 つの移行（結果を変えない証拠として黄金 fingerprint テストを先に固定）」、B「`_fields` の検査基盤 + `enemies.json` の `stats` / `combat` / `defense` の説明」。以降は要素ごと（敵の switch 全移行 → behavior の基本パラメータを JSON の `BEHAVIOR` へ → 状態異常 → 武器の固有技・弾 → スキル行動）。各段で `npm run check` が通る

## 1. 現状の観察（根拠）

### 1.1 敵: 定義はデータ、振る舞いは switch の散在

- `EnemyDef`（`/home/user/roguelike/src/data/enemies.ts:163-254`）は identity（key / name / sprite / behavior）+ フラグ（blocks / phasing / chargeTrail …）+ JSON から spread する数値（`...N.slime`、`:327`）の**プレーンなレコード**。104 体が 1 行ずつ
- 振る舞いは `EnemyBehavior` の union（`:7-101`、55 種）で表し、`/home/user/roguelike/src/system/enemies.ts` が
  - 定数表 5 つ: `STRIKE_SPEED_MUL`（`:110`）・`WINDUP_MOVE_MUL`（`:168`）は `Record<EnemyBehavior, number>` で追加漏れを型で検出、`KEEP_AWAY`（`:226`）・`STATIONARY`（`:239`）・`SILENCED_BEHAVIORS`（`:249`）
  - switch / if 分岐: `canBeginAttack`（`:530`）、`chaseMove`（`:556`）、`beginWindup`（`:602`）、`telegraphWindup`（`:661`）+ `telegraphWave3`（`:691`）、`aimFixedAtWindup`（`:767`）、`beginStrike`（`:792`）+ `beginStrikeWave2`（`:894`）+ `beginStrikeWave3`（`:829`）、`strike`（`:970-1010`）、`strikeSpeedMul`（`:1021`）、`recover`（`:1049,1056`）、`endStrike`（`:1063`）、`enemyTelegraph`（`:1196`。render が読む）
  - 個別の中身は `enemyBehaviors.ts`（Wave 2）/ `enemyWave3.ts`（Wave 3、export 45 本）に「1 behavior 1 関数」で分散し、`enemies.ts` が 40 本以上を import している（`:60-108`）
- 敵 1 体を足すレシピ（`docs/recipes/enemy.md` 手順 2）は「`STRIKE_SPEED_MUL` / `WINDUP_MOVE_MUL` と behavior の分岐を直す」。分岐の置き場が段（予告・出だし・持続・終わり）ごとに別の関数なので、1 つの behavior の全体像が 1 か所に無い

### 1.2 実行時の状態はプレーンであることに依存している

- `Enemy`（`/home/user/roguelike/src/core/state.ts:161-215`）・`EnemyAi`（`:275-294`）はプレーン。`state.enemies = state.enemies.filter(...)`（`system/enemies.ts:392`）
- `structuredClone` は `/home/user/roguelike/src/core/replay.ts:366,369,434,437,557,558`（装備・石・イベントのスナップショット）。クラスのインスタンスを含めると prototype が落ちる
- fingerprint はフィールドを直接読む（`src/core/replay.test.ts:45-59`、`src/core/game.test.ts:15`）。テストの `arena` / `placeEnemy`（`src/system/testHelpers.ts:15,27`）も `Enemy` をプレーンに組む
- `core/replay.test.ts` の「最終 fingerprint が一致する」（`:253`）は**記録と再生の一致**を見るだけで、リファクタ前後の同一性は固定していない → 移行の安全網は別に要る（4.1 の黄金テスト）

### 1.3 他要素の分岐の量

`case "` の数: `skills/actions.ts` 37、`system/specialRooms.ts` 46、`system/statusEffects.ts` 28（`:305,430,504,829` の 4 つの switch で kind ごと）、`skills/actions2.ts` 9。祝福は `BoonDef.rules`（統一ルール文法）で既に宣言的、性質は `AffixDef.apply` の関数フィールド（`src/loot/affixes.ts:123`）で既に strategy。

### 1.4 バランス JSON

- `_note` はブロック先頭に「なぜ + 単位の凡例」（`weapons.json:2` は 1 つの `_note` に単位 10 種以上を詰め込んでいる）。項目ごとの説明は無く、`skills.json` だけ 105 個の `_note` で個別に書いている
- 型付けは JSON import に依存（`docs/ideas/data-externalization.md` 1.3）。`N.slime` の欠落は tsc、余分は `diffKeySets`（`balance.test.ts:70-74`）
- TS 7 の npm パッケージに `createSourceFile` は無い（`node -e` で `undefined` を確認）→ JSDoc の自動抽出は正規表現になる
- `BALANCE_HASH = hashSeed(JSON.stringify(BALANCE))`（`index.ts:58`）は `stripNotes` 後の値なので、`_` 始まりのキーを足しても変わらない

## 2. オブジェクト指向化の方針

### 2.1 3 層に分ける

| 層 | 形 | 例 | 理由 |
| --- | --- | --- | --- |
| 定義データ（Def） | プレーンな readonly レコード。数値は JSON から spread | `EnemyDef` / `SkillDef` / `MovesetDef` / `BoonDef` | JSON の型付けと `...N.key` の欠落検出を保つ。表示名・key は localizer / 図鑑 / QA が横断して読む |
| 振る舞い（Behavior） | **クラス**。状態を持たない凍結単一体。`Record<Key, Base>` の登録表 | `EnemyBehaviorBase` とその継承 | switch の散在を 1 クラス 1 behavior に畳む。親で既定値と既定動作、子で上書き。`Record` の完全性で追加漏れは型エラー |
| 実行時の状態（Runtime） | プレーン | `GameState` / `Enemy` / `EnemyAi` / `StatusBag` | `structuredClone`・fingerprint・QA・テストヘルパー・render（読むだけ）をそのまま生かす |

決定性が守られる理由: 振る舞いクラスは `state` / `e` / `def` を引数で受けて **今と同じ関数を同じ順で呼ぶだけ**（dispatch の置き換え）。乱数は `state.rng` から引く順が変わらない。インスタンスは `Object.freeze` するので `this.x = …` は strict mode で例外になり、「クラスに隠れた状態」がリプレイをずらす事故を構造で防ぐ。敵ごとの作業領域は今までどおり `e.ai`（`EnemyAi`）に置く。

### 2.2 敵から始める理由

分岐の数が最多（55 種 × 段 7 つ）、レシピの手順が最も長い、render との境界が `enemyTelegraph` 1 関数で細い、そして「500 ステップ例外なく動く」網羅テスト（`system/enemies.test.ts:27-43`）があり fingerprint 化しやすい。ボス（`isBossDriven` → `updateBossEnemy`、`enemies.ts:354`）は状態機械を通らないので、登録表に `BossDriven` として席だけ置き、中身の移行は後回しにできる。

### 2.3 型とクラス（`src/system/behaviors/base.ts`）

```ts
import type { Enemy, GameState } from "../../core/state";
import type { Vec } from "../../core/vec";
import type { EnemyBehavior, EnemyDef } from "../../data/enemies";

/** 予備動作中に描く予告の種類（render/renderer.ts が enemies.ts 経由で読む。今の EnemyTelegraph をここへ移す） */
export type EnemyTelegraph =
  | { kind: "line" } | { kind: "laser" } | { kind: "ring"; radius: number }
  | { kind: "cross" } | { kind: "cone"; range: number; halfDeg: number } | null;

/** 攻撃の出だしの結果。handled = 自分で処理した（既定の破片演出は出さない）、default = 共通処理へ */
export type StrikeStart = "handled" | "default";

/**
 * 敵の振る舞い（1 behavior = 1 インスタンス）。状態を持たない（registry が Object.freeze する）。
 * 敵ごとの作業領域は e.ai に置く。数値は def と data/tuning の ENEMY_AI から読む
 */
export abstract class EnemyBehaviorBase {
  constructor(readonly key: EnemyBehavior) {}

  // ---- 基本パラメータ（親で既定、子で上書き。段 2 で enemies.json の BEHAVIOR へ移す） ----
  /** strike 中の移動倍率（def.speed に掛ける）。0 はその場で攻撃 */
  readonly strikeSpeedMul = 0;
  /** 予備動作中の移動倍率。0 は止まる */
  readonly windupMoveMul = 0;
  /** 保つ距離（px）。undefined は保たない */
  readonly keepAway: number | undefined = undefined;
  /** その場から動かない（追わない・押されない） */
  readonly stationary = false;
  /** 沈黙で予備動作に入れない・取り消される（射撃・詠唱・鐘・指揮） */
  readonly silenceable = false;

  // ---- フック（状態機械の各段。既定は「何もしない / 共通処理へ」） ----
  /** 毎ステップ、状態機械の前（位置の記録・蘇生の時計） */
  beforeAct(_state: GameState, _e: Enemy, _def: EnemyDef, _dt: number): void {}
  /** 攻撃を始めてよいか（沈黙は共通側が見る） */
  canBeginAttack(_state: GameState, _e: Enemy, _def: EnemyDef, _d: number): boolean { return true; }
  /** 追跡中の進み方。undefined なら共通（flank か直進） */
  chaseMove(_state: GameState, _e: Enemy, _def: EnemyDef, _dir: Vec, _perp: Vec, _side: number, _d: number): Vec | undefined { return undefined; }
  /** 予備動作の始まり: 予告（影・線）を置く */
  telegraph(_state: GameState, _e: Enemy, _def: EnemyDef, _dir: Vec): void {}
  /** 狙いを予備動作の始まりで固定するか（避けた側が勝つ） */
  aimFixedAtWindup(_e: Enemy, _def: EnemyDef): boolean { return false; }
  /** 攻撃の出だし */
  beginStrike(_state: GameState, _e: Enemy, _def: EnemyDef): StrikeStart { return "default"; }
  /** strike 中、毎ステップ（移動と接触判定は共通側） */
  tickStrike(_state: GameState, _e: Enemy, _def: EnemyDef, _dt: number): void {}
  /** strike 中の移動倍率（技によって変える敵だけ上書き） */
  strikeSpeedMulFor(_e: Enemy, _def: EnemyDef): number { return this.strikeSpeedMul; }
  /** 攻撃の終わり（連続攻撃・跡の処理は共通側） */
  onStrikeEnd(_state: GameState, _e: Enemy, _def: EnemyDef, _byWall: boolean): void {}
  /** 隙の間、毎ステップ（一撃離脱の後退など） */
  tickRecover(_state: GameState, _e: Enemy, _def: EnemyDef, _toPlayer: Vec, _dt: number): void {}
  /** 隙の終わり */
  onRecoverEnd(_state: GameState, _e: Enemy, _def: EnemyDef): void {}
  /** 描画向け: 予備動作中の予告の形（render は state を読むだけ。ここも状態を書かない） */
  telegraphShape(_e: Enemy, _def: EnemyDef): EnemyTelegraph { return null; }
}
```

`_` 始まりの引数は `noUnusedParameters` の対象外。`target: ES2022` なので子クラスの `override readonly strikeSpeedMul = 4.6` は define 意味論で正しく上書きされる。

### 2.4 継承の階層（`src/system/behaviors/families.ts`）

```ts
/** 近づいて殴る（chaser 系）。スライム・狼・骸骨兵・気力喰い・骨拾い… */
export class Rusher extends EnemyBehaviorBase {
  override readonly strikeSpeedMul = 4.6;
}
/** 直線に突進する。壁に当たると隙、跡（骨壁・落石・氷）を残す */
export class Charger extends Rusher {
  override readonly strikeSpeedMul = 7.5;
  override aimFixedAtWindup(_e: Enemy, def: EnemyDef): boolean { return def.doubleCharge === true; }
  override telegraph(state: GameState, e: Enemy, def: EnemyDef, dir: Vec): void { if (def.doubleCharge) planDoubleCharge(state, e, dir); }
  override telegraphShape(_e: Enemy, def: EnemyDef): EnemyTelegraph { return def.doubleCharge ? null : { kind: "line" }; }
}
/** 距離を保って撃つ・詠唱する。沈黙が効く */
export class Keeper extends EnemyBehaviorBase {
  override readonly silenceable = true;
  constructor(key: EnemyBehavior, override readonly keepAway: number | undefined = undefined) { super(key); }
  override chaseMove(...): Vec | undefined { /* keepAwayMove または shooter 型のふらふら */ }
}
/** 一撃離脱で飛ぶ（蝙蝠・鬼火） */
export class Flyer extends EnemyBehaviorBase {
  override readonly strikeSpeedMul = 3.2;
  override readonly windupMoveMul = 0.3;
  override chaseMove(...) { /* zigzag */ }
  override tickRecover(...) { /* 後退 */ }
}
/** 動かない（鐘・氷柱・地雷・砲台・卵・吸い込み蟲） */
export class Stationary extends EnemyBehaviorBase {
  override readonly stationary = true;
}
/** ボス。状態機械を通らず boss*.ts が動かす。席を埋めるだけ */
export class BossDriven extends EnemyBehaviorBase {}

// 個別（例）
export class Kamikaze extends Rusher {
  override readonly strikeSpeedMul = 0;
  override telegraph(state: GameState, e: Enemy, def: EnemyDef): void { telegraphKamikaze(state, e, def); }
  override beginStrike(state: GameState, e: Enemy, def: EnemyDef): StrikeStart { detonate(state, e, def); return "handled"; }
}
export class Laser extends Keeper {
  override aimFixedAtWindup(): boolean { return true; }
  override telegraph(state, e, def, dir) { /* :662-667 の中身 */ }
  override beginStrike(state, e, def) { /* :800-807 */ return "handled"; }
  override telegraphShape(): EnemyTelegraph { return { kind: "laser" }; }
}
```

第 1 段では既存の関数（`telegraphKamikaze` など）をメソッドから**呼ぶだけ**にし、中身の移設（`enemyBehaviors.ts` / `enemyWave3.ts` の解体）は第 2 段で行う。1 behavior の全体像がクラス 1 つに集まるのが狙いで、家族は「既定値の束」以上にしない（3 段より深くしない）。

### 2.5 登録表（`src/system/behaviors/registry.ts`）

```ts
import type { EnemyBehavior, EnemyDef } from "../../data/enemies";
import { EnemyBehaviorBase } from "./base";
import { BossDriven, Charger, Flyer, Keeper, Kamikaze, Laser, Rusher, Stationary /* … */ } from "./families";

function freezeAll<T extends Record<string, EnemyBehaviorBase>>(table: T): Readonly<T> {
  for (const b of Object.values(table)) Object.freeze(b);
  return Object.freeze(table);
}

/** behavior → 振る舞い。Record なので EnemyBehavior を足して登録を忘れると型エラー */
export const BEHAVIORS: Readonly<Record<EnemyBehavior, EnemyBehaviorBase>> = freezeAll({
  chaser: new Rusher("chaser"),
  shooter: new Keeper("shooter"),
  charger: new Charger("charger"),
  knight: new Knight("knight"),          // strikeSpeedMul = ENEMY_AI.knight.lungeSpeedMul
  bat: new Flyer("bat"),
  wisp: new Wisp("wisp"),
  kamikaze: new Kamikaze("kamikaze"),
  graveBell: new GraveBell("graveBell"), // Stationary + silenceable
  laser: new Laser("laser"),
  kingSlime: new BossDriven("kingSlime"),
  /* … 55 件 */
});

export function behaviorOf(def: EnemyDef): EnemyBehaviorBase {
  return BEHAVIORS[def.behavior];
}
```

移行中、まだ個別クラスが無い behavior は `Rusher` / `Keeper(key, keepAway)` / `Stationary` などの家族をそのまま登録する（今の 5 表の値をコンストラクタ引数か家族の既定値で再現する）。`enemies.ts` 側は `STRIKE_SPEED_MUL[def.behavior]` → `behaviorOf(def).strikeSpeedMul` のように置き換える。

### 2.6 switch をメソッドへ移すときの形

- 「処理したら true / 共通へ」の連鎖（`beginStrike` → `beginStrikeWave2` → `beginStrikeWave3` → 既定の破片、`:792-825`）は `StrikeStart` の `"handled"` / `"default"` に写す。`basilisk` のように「phaseTimer を変えてから共通へ」も `"default"` で表せる（`:875-879`）
- `chaseMove` の `default`（flank と直進、`:583-586`）は共通側に残し、フックは `undefined` で「共通へ」を返す
- `strikeSpeedMul`（技によって変わる `mimic` / `scribeImp` / `basilisk`、`:1021-1024`）は `strikeSpeedMulFor` の上書き
- `enemyTelegraph`（`:1196`）は `telegraphShape` へ。`enemies.ts` は `export type { EnemyTelegraph }` と `export function enemyTelegraph(e, def) { return behaviorOf(def).telegraphShape(e, def); }` を残して render の import 先を変えない
- 共通側に残すもの: 状態機械（phase 遷移・phaseTimer）、同時攻撃の上限、連携ずらし、接触判定、連続攻撃、深度補正、沈黙の判定（`silenceable` を見る）。フックは「段の中身」だけ

### 2.7 他の要素へ広げる順と、データのまま残すもの

| 要素 | 判断 | 形 |
| --- | --- | --- |
| 状態異常（34 種） | 第 3 段でクラス化 | `StatusBehavior` を `Record<StatusKind, …>` に。フック `onApply / tick / haltsAction / onExpire / describe`。`statusEffects.ts` の 4 つの switch（`:305,430,504,829`）を畳む。`STATUS_LABEL` と数値 `STATUS` は今の場所 |
| 武器の固有技（strike / throw / hold）・弾の挙動（sway / homing / bounce / …） | 第 4 段。武器レーンが落ち着いてから | `WeaponArtBase` / `BulletFeature` の登録表。`MovesetDef` / `BulletDef` はデータのまま |
| スキルの行動（`skills/actions*.ts` の key ごとの switch） | 第 4 段 | 家族（突進 / 範囲 / 設置 / 強化 / 変身）ごとの `SkillAction` クラス + key ごとの数値は JSON。`SkillDef` はデータのまま |
| 部屋主・ボスの専用ロジック（`boss*.ts`） | 第 2 段の後、`BossDriven` に `update` フックを足して 1 ボス 1 クラス | `bossKit.ts` の共通補助は親クラスのメソッドに |
| 祝福 | **データのまま** | `BoonDef.rules`（統一ルール文法）が既に宣言的。クラス化は文法と二重になる |
| 性質（AffixDef） | **データのまま** | `apply` 関数フィールドが strategy そのもの。4,606 行の表を動かす価値が無い |
| 部屋種類・ジョブ・契約者 | **データのまま**（`specialRooms.ts` の 46 case は第 5 段以降に検討） | 表 + 少数の関数で足りている |

## 3. バランス調整ファイル: JSON + `_note` + `_fields`

### 3.1 書き方

```json
"stats": {
  "_note": "敵ごとの数値本体。行の key は src/data/enemies.ts の ENEMIES の key と同じ（キー集合は balance.test.ts が検査）",
  "_fields": {
    "hp": "生命。深さで depthHpScale（1 + 0.18 × (深さ − 1)）倍。目安: 雑魚 20〜60、部屋主 150〜300、ボス 600〜",
    "speed": "移動速度。px/秒（10px = 1m）。プレイヤーの歩き 90 が基準。目安 40〜120",
    "windup": "予備動作の秒。長いほど避けやすい（テレグラフ原則）。目安 0.35〜0.9",
    "engageRange": "攻撃を始める距離。px。0 なら攻撃しない（金色スライム）",
    "swarm.min": "群れで湧く数の下限。抽選 1 回でこの数だけ出る",
    "swarm.max": "群れで湧く数の上限"
  },
  "slime": { "radius": 6, "hp": 20, "speed": 50, … },
  "goldSlime": { "_note": "逃げるだけ。engageRange 0 で攻撃しない", "_fields": { "timid.lifetime": "逃げ回って消えるまでの秒" }, … }
}
```

規約:

- `_fields` は「項目名 → 説明」の文字列表。**表（行が並ぶオブジェクト）では親に 1 回だけ書き、行は引き継ぐ**（104 体で繰り返さない）。行に `_fields` を置けば追加・上書き
- 説明は「意味。単位。目安 / 範囲」の順。用語は `docs/GLOSSARY.md`。単位は 秒 / px / 倍率（1 = 等倍）/ 割合（0..1）/ %（表示単位）/ ステップ（60Hz）
- ネストした数値は `swarm.min` のドット表記か、子に `_fields` を置く（どちらも可。深さ 2 までならドット）
- `_note` は今までどおり「なぜ（QA の履歴）」。`_fields` に経緯を書かない
- 値は変えない（`_` 始まりの追加だけなので `BALANCE_HASH` は不変。差分は追加行のみ）

### 3.2 検査（`src/data/balance/validate.ts` に追加）

```ts
export const FIELD_DOCS_KEY = "_fields";
/** _fields の形: 文字列値のオブジェクト、空文字禁止、key は自分か子の行のどれかにある項目（無ければ stale） */
export function validateFieldDocs(root: unknown, file: string): BalanceIssue[];
/** 説明の無い数値・真偽の葉の path 一覧（祖先のどこかの _fields に無いもの。色文字列は対象外） */
export function undocumentedLeaves(root: unknown, file: string): string[];
```

`balance.test.ts` に足すもの:

- 「各 JSON の `_fields` は stale な項目を含まない」（`validateFieldDocs` が `[]`）
- 「説明の無い数値の葉の数がファイルごとの基準値以下（基準値は下げるだけ）」。`UNDOCUMENTED_BASELINE: Record<file, number>` を現状の実測で置き、書き足すたびに下げる。`enemies.json` の `stats` / `combat` / `defense` は第 1 段で 0 にする（ブロック単位の「0 である」テストを別に置く）

既存の `validateBalanceShape`（`_note` は文字列、キーは識別子）はそのまま。`_fields` の値が文字列なのは `walk` の既定で通る。

### 3.3 説明の埋め方（自動 + 手）

- `scripts/balance-fields.mjs <ファイル> <interface 名>`: 正規表現で `interface X { /** … */ name?: type; }` の JSDoc を拾い、`_fields` の雛形 JSON を出す（TS 7 に compiler API が無いため。`enemies.ts:171-184` の `/** 攻撃の予備動作時間（秒）。長いほど避けやすい */` のような 1 行 JSDoc が対象）。implementer が単位・目安を足して貼る。移行が終わったら `extract-balance.mjs` と一緒に削除
- JSDoc が無い項目（`skills.json` の skill ごとの `hits` / `radius` など）は手で書く。書く人は該当 system の読み手（`ENEMY_AI.bomber.fuse` なら `system/enemies.ts` の `throwBombs`）
- 単位の凡例だけを詰め込んでいる先頭の `_note`（`weapons.json:2`）は、`_fields` に移した後に「なぜ」だけに削る（第 5 段）

### 3.4 behavior の基本パラメータを JSON へ（第 2 段）

`STRIKE_SPEED_MUL` の 4.6 / 7.5 / 3.2 などは TS に直書きされたバランス数値（不変条件 4 に照らすと灰色）。第 2 段で `enemies.json` に `BEHAVIOR` ブロックを作る:

```json
"BEHAVIOR": {
  "_note": "behavior ごとの基本パラメータ。src/system/behaviors/ の親クラスがこれを読み、子クラスは動き（メソッド）だけを上書きする",
  "_fields": {
    "strikeSpeedMul": "strike 中の移動速度倍率（speed に掛ける）。0 はその場で攻撃。突進 7.5、飛びかかり 4.6、噛みつき 3.2",
    "windupMoveMul": "予備動作中の移動倍率。0 は止まる。蝙蝠・鬼火 0.3",
    "keepAway": "保つ距離。px。無い behavior は保たない"
  },
  "chaser": { "strikeSpeedMul": 4.6, "windupMoveMul": 0 },
  "echoStriker": { "strikeSpeedMul": 0, "windupMoveMul": 0, "keepAway": 110 }
}
```

`EnemyBehaviorBase` のコンストラクタが `BALANCE.enemies.BEHAVIOR[key]` を読んでフィールドを埋め、`diffKeySets("enemies.BEHAVIOR", Object.keys(json.BEHAVIOR), Object.keys(BEHAVIORS))` で集合一致を固定する。`ENEMY_AI.<behavior>.keepAway` の重複は `BEHAVIOR` 側へ寄せる。これで「親クラスで基本パラメータ（JSON）、子で細分化（メソッド）」が揃う。

### 3.5 却下した案

- **YAML（自前サブセットパーサ or ビルド時変換）**: 色文字列 `#ff4040` が引用符なしだとコメントになる（JSON 全体に色が 245 個）、`no` / `on` の真偽化など事故の面が広い。Vite / Vitest / scripts の 3 経路に自前パーサを通すか、YAML → JSON を生成して二重にコミットするかのどちらかで、tsc の JSON import 型付け（`N.slime` の欠落を tsc が拾う）を失うか二重管理になる。趣味開発で維持するパーサとしては重い
- **JSONC（`//` コメント）**: パーサは 40 行で済むが、tsc は `.jsonc` を import できないので同じく生成 + 二重管理。`_fields` で得られる「1 か所に書いて行が引き継ぐ」も無い
- **TS に戻す（`as const` + JSDoc）**: 「コードをいじらない」方針に反する
- **`speed_note` 形式の兄弟キー**: `keyof` で列挙する表を汚す（data-externalization.md 9 章の判断を維持）
- **敵インスタンスをクラスにする**: `structuredClone` / fingerprint / `filter` / `arena` を全部直すことになり、得るものが `e.behavior.xxx()` の見た目だけ

将来の任意項目: `_fields` から JSON Schema（`description` 付き）を生成してエディタのホバーに出す `scripts/balance-schema.mjs`。`$schema` キーは `IDENTIFIER_RE` に通らないので、やるなら validate の例外を 1 つ足す。

## 4. 段階的な移行計画

原則: 1 段 = 1 要素の 1 側面。各段で `npm run check` が通り、その段の黄金テスト / 固定値テストが変わらない。数値の変更と移行を同じコミットに混ぜない。

### 4.1 第 1 段（今夜）: 2 レーン、互いに所有ファイルが重ならない

#### レーン A: 敵 behavior の骨格（implementer / Sonnet）

- 所有（新規）: `/home/user/roguelike/src/system/behaviors/base.ts`、`families.ts`、`registry.ts`、`registry.test.ts`、`/home/user/roguelike/src/system/enemyGolden.test.ts`
- 最小 Edit: `/home/user/roguelike/src/system/enemies.ts` — (1) 5 つの定数表（`:110-260`）を削除し `behaviorOf(def).strikeSpeedMul` / `.windupMoveMul` / `.keepAway` / `.stationary` / `.silenceable` へ、(2) `canBeginAttack`（`:530-548`）の switch を `behaviorOf(def).canBeginAttack(state, e, def, d)` へ（沈黙の判定は共通側に残す）、(3) `aimFixedAtWindup`（`:767-782`）を `behaviorOf(def).aimFixedAtWindup(e, def)` へ、(4) `EnemyTelegraph` 型を `behaviors/base.ts` から `export type` で再 export（render の import 先を変えない）。不要になった import を消す。他の switch は触らない
- 編集禁止: `enemyBehaviors.ts` / `enemyWave3.ts` / `enemyTraits.ts` / `boss*.ts` / `data/**` / `render/**` / `core/**`
- 先に読む: この文書 2 章、`src/system/enemies.ts:60-260,500-560,765-782`、`src/system/enemies.test.ts:20-43`、`src/core/replay.test.ts:45-59`（fingerprint の観点）
- 手順の順序（重要）: **最初に `enemyGolden.test.ts` を書き、移行前のコードで黄金値を採る**（統合役がこれだけ先にコミット）。その後で registry と enemies.ts の置き換え
- 黄金テスト: `ENEMIES` の各 def について `arena(11)` + `placeEnemy` 2 体 + 500 ステップ（`enemies.test.ts:29-41` と同じ入力）の後の fingerprint（`replay.test.ts:45` と同じ観点 + `e.phase` / `e.ai?.move`）を `GOLDEN: Readonly<Record<string, string>>` に固定。未登録の key は「実測値を含むメッセージで落とす」（貼り直せるように）。**移行期間だけの安全網**で、敵 behavior の移行完了時に削除する（意図した数値変更で落ちたら期待値を直す。既存の固定値テストと同じ扱い）
- 公開 API: `EnemyBehaviorBase`（2.3 のフィールドとフック）、`StrikeStart`、`EnemyTelegraph`、家族 `Rusher / Charger / Keeper / Flyer / Stationary / BossDriven`、個別 `Knight / Wisp / Mimic / Basilisk / FrostCrusher / Scavenger / Absorber / MineLayer / Hollow / BannerBearer / Laser / ChainWarden / GiantToad / WindSprite`（`canBeginAttack` と `aimFixedAtWindup` に登場する behavior だけ。各 3〜6 行）、`BEHAVIORS`、`behaviorOf(def)`
- テスト（`registry.test.ts` の `it` 名）: 「EnemyBehavior のすべての key に振る舞いが登録され、インスタンスの key と一致する」「振る舞いのインスタンスは凍結されていて、フィールドを書き換えると例外になる」「基本パラメータは移行前の表と同じ（chaser 4.6、charger 7.5、bat の windupMoveMul 0.3、echoStriker の keepAway は ENEMY_AI.echoStriker.keepAway、graveBell は stationary、laser は silenceable）」「地雷撒きは攻撃を始めず、旗持ちは旗が立っている間は近距離だけ攻撃を始める」（`arena` + `placeEnemy`）
- 完了条件: `npm run check`。`enemyGolden.test.ts` が移行前に採った値で全件通る。`grep -c "STRIKE_SPEED_MUL\|WINDUP_MOVE_MUL\|KEEP_AWAY\|STATIONARY\|SILENCED_BEHAVIORS" src/system/enemies.ts` が 0。`system/enemies.test.ts` は無変更。`git diff --stat` に `render/**` `data/**` が無い
- 報告に含める: CODE_MAP に足す 4 行（system 節）、レシピ enemy.md の手順 2 の新文言（5 章）

#### レーン B: `_fields` の基盤と敵の説明（implementer / Sonnet）

- 所有: `/home/user/roguelike/src/data/balance/validate.ts`（関数追加のみ）、`validate.test.ts`、`balance.test.ts`（`describe` 追加のみ）、`/home/user/roguelike/src/data/balance/enemies.json`（`_fields` の追加のみ。値・キー順は変えない）、`/home/user/roguelike/scripts/balance-fields.mjs`（新規）、`/home/user/roguelike/docs/BALANCE.md`（「項目の意味を読む / 書く」節）
- 編集禁止: `index.ts`（変更不要）、他の JSON（第 5 段）、`src/**` の残り
- 先に読む: この文書 3 章、`validate.ts` 全部、`balance.test.ts:49-87`、`data/enemies.ts:163-254`（JSDoc）、`data/enemyCombat.ts` / `enemyDefense.ts` の型の JSDoc
- 公開 API: `FIELD_DOCS_KEY`、`validateFieldDocs(root, file): BalanceIssue[]`、`undocumentedLeaves(root, file): string[]`
- テスト（`it` 名）: `validate.test.ts` に「_fields は文字列値のオブジェクトで、兄弟にも子の行にも無い項目は stale として path 付きで報告する」「子の行は親の _fields を引き継ぎ、行に置けば上書きできる」「ドット表記でネストした項目を説明できる」「色文字列は説明の対象に数えない」。`balance.test.ts` に「各 JSON の _fields に stale な項目が無い」「説明の無い数値の葉の数がファイルごとの基準値以下」「enemies.json の stats / combat / defense はすべての項目に説明がある」
- 完了条件: `npm run check`。`git diff -U0 src/data/balance/enemies.json | grep '^-' | grep -v '^---'` が空（削除行なし = 値を変えていない）。`UNDOCUMENTED_BASELINE` の他ファイルの値は実測（下げるのは第 5 段）。`node scripts/balance-fields.mjs src/data/enemies.ts EnemyDef` が JSON の雛形を標準出力に出す

### 4.2 第 2 段: 敵 behavior の全移行と `BEHAVIOR` ブロック

- A2（1〜2 レーン、段ごとに分割可）: `telegraph` + `telegraphShape`（`:659-728, 1196`）→ `beginStrike`（`:792-936`）→ `tickStrike` / `strikeSpeedMulFor` / `onStrikeEnd`（`:970-1075`）→ `tickRecover` / `onRecoverEnd`（`:1047-1060`）→ `chaseMove` / `beforeAct`（`:396-403, 550-588`）。各段で黄金テスト無変更。並列にするなら「段」で切る（同じ behavior の別の段を 2 人が触らない）
- A3: `enemyBehaviors.ts` / `enemyWave3.ts` の関数をクラスの中へ移し、家族ごとのファイル（`behaviors/melee.ts` / `ranged.ts` / `support.ts` / `traps.ts` / `lairMasters.ts`）に並べ直す。両ファイルは削除（`enemyTraits.ts` の横断的な仕組みは残す）
- A4: `BEHAVIOR` ブロック（3.4）。`tuning.ts` に `export const BEHAVIOR = BALANCE.enemies.BEHAVIOR;`（追加 1 行）。黄金テスト無変更（値は同じ）。`BALANCE_HASH` は変わる（値の追加なので）→ リプレイの注記が出るだけで拒否はしない
- A5: ボス（`BossDriven.update` フック + 1 ボス 1 クラス。`bossKit.ts` を親に）。ここで黄金テストを削除

### 4.3 第 3 段: 状態異常

`src/system/status/`（`base.ts` / `registry.ts` / 家族 `Dot` / `Control` / `Debuff` / `Buff` / `Sublimation`）。`statusEffects.ts` の 4 switch を畳む。黄金は `statusEffects.test.ts` の既存固定値 + 縮小 QA の fingerprint 比較（scratchpad で前後を採る）。

### 4.4 第 4 段: 武器・スキル（並行レーンが落ち着いてから）

武器の固有技 / 弾の挙動の登録表、スキル行動の家族クラス。`MovesetDef` / `BulletDef` / `SkillDef` はデータのまま。

### 4.5 第 5 段: `_fields` の全ファイル化

`combat.json` → `weapons.json` → `skills.json` → `world.json` → `loot.json`（`affixCurves` は `CurvePoint` の 3 項目だけ）→ `boons.json` → `feel.json` / `jobs.json`。基準値をファイルごとに 0 へ。先頭 `_note` の単位凡例を削る。任意で JSON Schema 生成。

## 5. エージェント資料への影響

| 資料 | 変更 |
| --- | --- |
| `CLAUDE.md` | 不変条件 4 の末尾に「項目の意味は `_fields`（親に 1 回、行は引き継ぐ）」を 1 句。不変条件 9 の後に「振る舞いのクラス（`system/behaviors/` など）は状態を持たない凍結単一体。実行時の状態は `GameState` のプレーンなオブジェクトに置く」を 1 行。`docs/ideas/oop-migration.md` は `docs/ideas/README.md` 経由で参照（行数上限 150 を守る） |
| `docs/CODE_MAP.md` | system 節に `behaviors/base.ts`（親クラスとフック）/ `families.ts` / `registry.ts`（`BEHAVIORS`）の行。`enemies.ts` の説明を「状態機械。段の中身は behaviors/ へ委譲」に。data 節に `_fields` の 1 句。第 2 段以降で `enemyBehaviors.ts` / `enemyWave3.ts` の行を削る。`audit:docs` の「N 種」検査は配列の要素数を数えるので、`BEHAVIORS`（Record）には件数表記を付けない |
| `docs/recipes/enemy.md` | 手順 0 に「`stats` の項目の意味は `_fields` を読む。新しい項目を足したら `_fields` にも 1 行」。手順 2 を「`src/system/behaviors/` に家族を継いだクラスを 1 つ書き、`registry.ts` の `BEHAVIORS` に登録（Record なので漏れは型エラー）。既存の家族で足りるなら家族をそのまま登録」に。「`STRIKE_SPEED_MUL` / `WINDUP_MOVE_MUL`」の文言を削る |
| `docs/BALANCE.md` | 「項目の意味を読む」（`_fields` の場所と読み方）「項目を足すときは `_fields` に 1 行」節。基準値テストの説明 |
| `docs/ARCHITECTURE.md` | 「主要な型の関係」に「振る舞いクラスの層（状態を持たない・登録表）」の 1 段落。`data/` の行に `_fields` |
| `docs/AI_WORKFLOW.md` | 共有ファイルに `src/system/behaviors/registry.ts`（登録の 1 行追加だけ許す）を追加 |
| `.claude/skills/add-enemy` | レシピの手順 2 の変更に追随 |
| `docs/ideas/data-externalization.md` | 3 章の規約に `_fields` を追記（`speed_note` 禁止はそのまま） |
| `docs/recipes/status.md` | 第 3 段のとき |

`scripts/audit-agent-docs.mjs` は新ファイルが CODE_MAP に載っているかを見るので、レーン A の報告に CODE_MAP の行を含めて統合役が足す。

## 6. リスクとユーザーに確認したい点

1. **「がっつり OOP」の期待とのずれ**: 本案は敵インスタンスや GameState をクラスにしない（振る舞いだけ）。`e.behavior.strike()` のような書き味を求めているなら、その代償（`structuredClone` / fingerprint / `arena` / QA の全面改修とリプレイ版の更新）を先に伝えて判断してもらう
2. **YAML の期待**: 「項目の意味が読める」を `_fields` で満たす案。YAML の見た目（インラインコメント）がどうしても欲しい場合は、`_fields` を入れた後に「YAML → JSON 生成 + 同期テスト」を段 5 の別レーンとして乗せられる（`_fields` は無駄にならない）。今回は見送りでよいか
3. **黄金 fingerprint テストの摩擦**: 移行期間中、`enemies.json` の数値を変えると該当の敵の黄金値が落ちる。「意図した変更なら期待値を貼り直す」運用と、敵 behavior の移行完了で削除する前提を確認したい
4. **並行レーンとの衝突**: レーン A は `src/system/enemies.ts` の既存行を書き換える。今夜、武器・奥義・祝福・効果音・描画のレーンがこのファイルや `enemyBehaviors.ts` / `enemyWave3.ts` を触る予定があるか（触るなら A を先に通して rebase してもらう）
5. **不確かな点（確認方法）**: (a) `Object.freeze` した親クラスのフィールドを `override readonly` で上書きする define 意味論が tsc 7 / Vite の ESBuild で一致するか → レーン A の「基本パラメータは移行前の表と同じ」テストが拾う。(b) メソッド dispatch への置き換えで QA シミュレーションの実行時間が伸びないか → `npx vitest run src/qa/simulation.test.ts` の秒数を前後で比べる（1 割以内なら無視）。(c) 正規表現の JSDoc 抽出が複数行 JSDoc（`bossPart` の 3 行、`enemies.ts:190-193`）を 1 行に畳めるか → スクリプトのテストは不要、雛形の目視で足りる
