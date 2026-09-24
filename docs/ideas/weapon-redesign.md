# 武器の根本設計: 射撃は銃だけ・右クリックは固有技・右手 / 左手（2026-09-24）

architect の設計メモ。ユーザーの決定 6 点を前提に、推奨 1 案と実装レーンを書く。数値は `src/data/tuning.ts` の `WEAPON` 経由に留める（数値の JSON 化と合流できるよう、ロジックに直書きしない）。

## 0. ユーザーの決定（そのまま守る）

1. 射撃はデフォルトの行動ではない。**射撃は銃の武器種だけ**
2. **右クリックは武器種ごとの固有技**（剣は受け流し、槍は突進、大盾は構え、斧は投擲 …）
3. 射撃の型 11 種は**銃の武器種のレパートリー**に組み込む（銃も左で撃ち、右は銃ごとの固有技）
4. 装備欄の「近接 / 銃」を廃止して**右手 / 左手**。今は武器 1 つを片手にだけ持てる
5. 鎌・斧・槌など片側に刃・頭が付く武器は、構えたとき**刃・頭が外向き**
6. 剣を「今の双剣より少し遅い」程度にして全体を速く。重量武器（大剣・戦鎚・斧・鉈）は据え置き

## 1. 結論（推奨案）

- `MovesetDef.secondary`（右の役割）を廃止し、`MovesetDef.art: WeaponArtDef`（右クリックの固有技）に置き換える。技の種類は 5 つ: **strike**（1 振り。既存の右単独派生を吸収）/ **charge**（長押しで溜め、離して振る = 刀の居合）/ **hold**（押している間の構え: 受け流し・盾構え）/ **throw**（弾を出す: 斧の投擲・杖の魔弾・乱れ撃ち。弾の挙動は射撃の型を借りる）/ **recall**（自分の弾を手元へ戻す）
- **strike の技は内部的には `sequence: ["secondary"]` の派生として `branches` に混ぜる**。既存の `matchBranch` / `tryBranch` / `branchSwing` 条件 / 来歴 `branchHits` がそのまま効き、Lane A の新規コードは hold / throw / recall の 3 経路だけになる
- 銃は **5 つの武器種（家系）** にする: 短銃 `sidearm` / 長銃 `longarm` / 砲 `cannon` / 投擲 `thrown` / 二丁拳銃 `gunner`（既存）。`primary: "shot"` を持ち、**撃つ弾の型はベースの `shot`（`PlayerStats.shot`）のまま**。家系が右クリックの技と手触り（移動倍率・ダッシュ攻撃）を、ベースが弾の型を決める（刺突剣 → 槍 と同じ「器と型」の関係）。1 型 = 1 武器種（11 種）は絵と技が 11 組必要で重いので却下
- スロットは `SLOTS = ["mainHand", "offHand", "armor", "boots", "ring", "amulet"]`。**offHand は型・保存・共鳴の環に存在するが、今はベースが無く何も入らない**（ドロップ抽選から除外、装備画面は「左手: —」）。将来の両手の仕組みのための席取りで、6 スロットのまま共鳴の環（`CONSTELLATION_RING`）を変えずに済む
- 旧セーブ: アイテムの `slot` が `"weapon"` / `"gun"` なら `"mainHand"` へ読み替える（`profile.ts` の sanitize 前に）。旧 `equipment.gun` の遺物は **倉庫へ落とす**（右手には旧 weapon を優先）。`PROFILE_KEY` は v1 のまま（アイテム単位の読み替えは `migrateItem` の前例に倣う）。リプレイは右クリックの意味が変わるので `REPLAY_VERSION` を 7 → 8 に上げて旧記録を拒否する
- 刃の向きは描画側の規則で解く: 片刃・片頭の武器に「刃の側」を宣言し、`weaponPose` が **刃が頭と反対側（構え）/ 振りの進行方向（攻撃中）** を向くよう鏡像を選ぶ。斜めの絵は反転で鏡像を作れないので、反対角線で写した 4 枚目の絵を自動生成する
- 速さは軽量武器の windup / active / recover を 0.7 倍前後に縮める（剣 1 段 0.31 → 0.215 秒 ≒ 今の双剣 0.19 × 1.13）。威力は据え置き（`SWORD_PINNED` 等のテスト固定値を変えない）。DPS が上がるぶんは QA を回してから balance-tuner が `PLAYER.melee` の base で調整する

## 2. 型（`src/data/weapons.ts`）

```ts
/** 左クリックの役割。melee = 連撃 / charge = 長押しで溜め（大剣・戦鎚）/ shot = 押している間ベースの射撃の型で撃つ（銃の家系だけ） */
export type PrimaryKind = "melee" | "charge" | "shot";

export type WeaponArtKind = "strike" | "charge" | "hold" | "throw" | "recall";

interface ArtBase {
  readonly key: string;   // "parry" など。名前は ART_NAMES（BRANCH_NAMES と同じ流儀）
  readonly name: string;
  readonly desc: string;
  /** 再使用までの秒。0 なら連撃と同じで制限なし（strike / charge は 0 が基本） */
  readonly cooldown: number;
}

export type WeaponArtDef =
  | (ArtBase & { readonly kind: "strike"; readonly step: MeleeStepDef; readonly next?: number })
  | (ArtBase & { readonly kind: "charge"; readonly charge: MeleeChargeDef })
  | (ArtBase & { readonly kind: "hold"; readonly hold: HoldArtDef })
  | (ArtBase & { readonly kind: "throw"; readonly throw: ThrowArtDef })
  | (ArtBase & { readonly kind: "recall"; readonly recall: RecallArtDef });

/** 押している間の構え。parry か guard のどちらかを持つ */
export interface HoldArtDef {
  readonly moveMul: number;
  /** これ以上押しても自動で解除する秒 */
  readonly maxSec: number;
  /** 受け流し: 押してから windowSec の間の被弾を無効化し、相手に怯み値 staggerPoise を入れてカウンター扱い（onCounter を発火）。失敗時は recoverSec の硬直 */
  readonly parry?: { readonly windowSec: number; readonly recoverSec: number; readonly staggerPoise: number };
  /** 構え: 向きから arcDeg の被弾を damageMul 倍にし、受けるたびに必殺ゲージ energyGain */
  readonly guard?: { readonly arcDeg: number; readonly damageMul: number; readonly energyGain: number };
  /** 離した瞬間に出す振り（盾押し）。内部では `${key}.release` の派生として branches に入れる */
  readonly release?: MeleeStepDef;
}

/** 弾を出す技。弾の挙動は射撃の型（SHOT_TYPES）を借り、威力・怯み値・素性は技のもの */
export interface ThrowArtDef {
  readonly shot: ShotKey;
  readonly scaling: Scaling;
  readonly poise: number;
  readonly count: number;
  readonly spreadDeg: number;
  readonly attack: AttackProfile;
  /** 弾の絵のキー（省略は BULLET の点。斧は武器の絵を回す） */
  readonly sprite?: string;
}

/** 自分の弾を手元へ戻す。戻りの弾は威力 returnDamageMul 倍 */
export interface RecallArtDef {
  readonly returnDamageMul: number;
  readonly speedMul: number;
}

export interface MovesetDef {
  readonly key: MovesetKey;
  readonly name: string;
  readonly desc: string;
  readonly steps: readonly MeleeStepDef[];
  readonly dashAttack: MeleeStepDef;
  /** 左の長押しの溜め（primary が charge の武器種だけ） */
  readonly charge?: MeleeChargeDef;
  readonly tip?: TipDef;
  readonly attackMoveMul: number;
  readonly primary: PrimaryKind;
  /** 右クリックの固有技 */
  readonly art: WeaponArtDef;
  /** コンボ派生。strike の技と hold の release は defineMoveset が ["secondary"] の派生としてここへ混ぜる */
  readonly branches: readonly BranchDef[];
  readonly keywords: KeywordProfile;
  readonly attack: AttackProfile;
  readonly rules?: readonly Rule[];
}
```

補助関数の新旧:

| 旧 | 新 |
| --- | --- |
| `secondary: ActionKind` | 削除。`ActionKind` は `PrimaryKind` に改名 |
| `meleeButton(m)` | `m.primary === "shot" ? undefined : "primary"` |
| `shotButton(m)` / `shotButtons(m)` | `isGun(m) ? "primary" : undefined` / `isGun(m) ? ["primary"] : []`。**`isGun(m) = m.primary === "shot"`** を新設し、`isShotOnly` は `isGun` の別名にして段階的に消す |
| `chargeButton(m)` | `m.primary === "charge" ? "primary" : m.art.kind === "charge" ? "secondary" : undefined` |
| `MELEE_SHOT` / `MELEE_MELEE` | 削除 |
| — | `defineMoveset(def)`: strike の技と hold.release を `["secondary"]` の派生に変換して `branchesOf` と同じ並び（長い列が先）で `branches` に混ぜる |
| — | `GUN_MOVESETS: readonly MovesetKey[] = ["sidearm", "longarm", "cannon", "thrown", "gunner"]`（祝福の loadout・性質の家系条件が読む） |
| — | `usesProjectiles(m)`: `isGun(m)` または `m.art.kind === "throw"`（祝福の「射撃」タグの生死判定） |

`MOVESET_KEYS` に `"sidearm" | "longarm" | "cannon" | "thrown"` を足す（`Record<MovesetKey, …>` の各所が型エラーで漏れを教える: `WEAPON_SPRITES` の `HELD`、`MOVESETS`、`WEAPON.movesets`）。

`PlayerStats.shot: ShotKey` は **そのまま残す**（右手のベースの `shot`、無ければ `single`）。読むのは `isGun(moveset)` のときの `updateShooting` と、`stats.shot` を見る性質フック（散弾の芯・追尾の毒・連射の烙印）・祝福の `loadout.shots`・ルール条件 `{ kind: "shot" }` で、どれも銃を持つときだけ意味を持つので触らない。

`FrameInput` は変えない（`attackPressed` / `attackHeld` / `shootHeld` の 3 つのまま。`shootHeld` は「右クリックの押しっぱなし」の意味になるのでコメントだけ直す）。ゲームパッドの割り当ても同じ。

## 3. 右クリックの固有技（全武器種）

既存の「右 1 手の派生」はそのまま技になる（strike）。「右→左」の派生は **「技 → 左」の追い打ち**として残す（受け流してから踏み込み斬り、など）。ただし技として昇格させた RL 派生は消す。派生数のテスト `MIN_BRANCHES` は「派生 + 技 ≥ 2」に読み替える。

| 武器種 | 右クリックの技（kind） | 中身 | 派生の整理 |
| --- | --- | --- | --- |
| 剣 sword | **受け流し**（hold / parry） | 0.25 秒の窓。成功で無敵・相手に怯み値 40・カウンター扱い（刀のルールや祝福の onCounter が乗る）。失敗は 0.2 秒硬直。再使用 0.6 秒 | LLR 十字断ち / **RL 踏み込み斬り** = 受け流し → 斬りの追い打ち |
| 大剣 greatsword | **薙ぎ払い**（strike → 3 段目） | 既存の右派生をそのまま | LLR 兜割り |
| 双剣 twinBlades | **影踏み**（strike → 2 段目） | 既存 RL を昇格（踏み込み突き、踏み込み中 0.1 秒無敵） | LLR 乱れ斬り / LLLR 交差斬り |
| 槍 spear | **突進突き**（strike → 2 段目） | 既存 RL 飛び込み突きを昇格し lunge を 40 に伸ばす（穂先判定・heavy） | LLR 石突き回し |
| 大鎌 scythe | **鎌引き**（strike → 2 段目） | 既存 RL を昇格（突き 44・引き寄せ） | LLR 刈り取り |
| 拳 fists | **掴み投げ**（strike） | 箱 r10・`throw: true`（ダッシュ攻撃と同じく背後へ放る）・heavy。既存 RL 踏み込み拳は消す | LLR 昇り拳 / LLLLR 百裂拳 |
| 鞭 whip | **巻き付け**（strike → 2 段目） | 既存 RL 鞭鳴らしを昇格し `pull: true` + 恐怖 1 秒（`applies`） | LLR 巻き打ち |
| 鉈 cleaver | **肩当て**（strike → 2 段目） | 既存 RL を昇格 | LLR 叩き落とし |
| 棍 staff | **払い上げ**（strike → 2 段目） | 既存 RL を昇格（ノックバック 360 に） | LLR 旋風 |
| 杖 wand | **魔弾**（throw） | 弾の型 single・魔法 / 光・威力 base 3.5 mnd 0.5・再使用 0.35 秒。左は杖打ち 4 段（既存 steps。primary を melee に） | **LR 魔力撃**（打ってから撃つ）/ RRL 杖払い（2 発撃ってから打つ） |
| 刀 katana | **居合**（charge） | 既存の右溜め | LLR 燕返し / RL 抜き打ち（溜めずに離した直後の斬り） |
| 斧 axe | **投擲**（throw） | 弾の型 boomerang（行って戻る）・武器の絵を回す・威力 base 8 str 1.0・怯み値 20・再使用 1.2 秒 | LLR 断ち割り / **RL 回転斬り**（投げた直後に回る → 3 段目。既存の右派生を RL へ移す） |
| 大盾 shield | **構え**（hold / guard、release = 盾押し） | 前方 120° の被ダメ ×0.3・受けるたび必殺ゲージ +3・移動 ×0.5・最長 2 秒。離すと盾押し（既存の右派生 → 2 段目） | LLR 盾落とし |
| 鎖鎌 chainSickle | **分銅**（strike → 2 段目） | 既存の右派生 | LLR 巻き取り |
| 戦鎚 hammer | **大薙ぎ**（strike → 3 段目） | 既存の右派生 | LLR 地砕き |
| 短銃 sidearm（新） | **狙い撃ち**（charge、離すと 1 発） | 押している間 移動 ×0.3、離すとベースの型の弾を 1 発、威力 ×2・貫通 +1・会心。段は 1 つ（0.4 秒） | ジョブ派生のみ |
| 長銃 longarm（新） | **銃剣突き**（strike） | 突き r34・lunge 20・heavy・怯み値 18。密着を剥がす | ジョブ派生のみ |
| 砲 cannon（新） | **零距離砲**（strike + 自分の後退） | 円 r0 s44 heavy・自分を後ろへ 40 px 跳ばす（散弾の反動と同じ経路）。床に自分の設置弾があれば全部起爆（`movesetRule`: onBranchSwing → detonateMines） | ジョブ派生のみ |
| 投擲 thrown（新） | **手元返し**（recall） | 飛んでいる自分の弾をすべて手元へ向け直し、戻りは威力 ×1.3。再使用 0.8 秒 | ジョブ派生のみ |
| 二丁拳銃 gunner | **乱れ撃ち**（throw） | 弾の型 spread を 8 発・45° 刻みで全周。再使用 1.5 秒。反転撃ち（ダッシュ攻撃）は据え置き | ジョブ派生のみ |

変身（`skills/forms.ts` の 狼化・鉄塊化）は `art` に噛みつき / 振りの strike を置く。右クリックは今まで通り `shapeButtonPress` が先に横取りするので挙動は変わらない。

## 4. 銃の家系とベースの再分類（`src/loot/bases.ts`）

`BaseItemDef` に家系のフィールドは足さず、**`moveset` が `GUN_MOVESETS` に入るかで家系を判定**する（`baseFamily(base)`: gun か melee）。銃ベースは `slot: "mainHand"` になり `moveset` を持つ（`shot` はそのまま）。

| 家系（武器種） | 移動 ×（攻撃中） | ダッシュ攻撃 | ベース（弾の型） |
| --- | --- | --- | --- |
| 短銃 sidearm | 0.8 | 反転撃ち（円 s36。gunner と同じ段） | 拳銃・回転式拳銃（single）/ 短機関銃（rapid）/ 三連銃（burst） |
| 長銃 longarm | 0.5 | 銃床薙ぎ（扇 160） | 小銃・電磁砲・弩（pierce）/ 三連弩（burst）/ 火縄銃・手砲（charge） |
| 砲 cannon | 0.4 | 零距離（円 s44 heavy） | 散弾銃・喇叭銃（spread）/ 曲射筒・擲弾筒（lob）/ 置き撃ち筒・撒き菱筒（mine） |
| 投擲 thrown | 0.7 | 投げ抜け（突き r40） | 投げ短剣（rapid）/ 吹き矢・導きの珠（homing）/ 跳ね銃・円月輪（ricochet）/ 返し輪・飛刃（boomerang） |
| 二丁拳銃 gunner | 0.8 | 反転撃ち | 二丁拳銃・双回転式（`shot: "single"` を明示。今は省略で単発） |

名のある遺物（`named.ts` の 14 件: 雹嵐機関 = smg など）は `baseKey` を変えないので無傷。`describe.ts` は `SLOT_LABEL` 経由なので触らない。

## 5. スロット・性質・移行

### 5.1 `src/loot/types.ts`

```ts
export const SLOTS = ["mainHand", "offHand", "armor", "boots", "ring", "amulet"] as const;
/** ドロップ・依頼・QA の装備が対象にする部位（左手は今はベースが無い） */
export const LOOT_SLOTS: readonly Slot[] = SLOTS.filter((s) => s !== "offHand");
export const LEGACY_SLOT_MAP: Readonly<Record<string, Slot>> = { weapon: "mainHand", gun: "mainHand" };
```

- `generator.ts:406` の `rng.pick(SLOTS)` → `LOOT_SLOTS`。`rollBase` は候補ゼロで throw するので offHand を渡さないことをテストで固定
- `ui/inventoryLayout.ts` `SLOT_LABEL`: `mainHand: "右手"`, `offHand: "左手"`。`ui/inventory.ts` の装備操作は `basesForSlot(slot, …)` が空の部位（左手）への装備を拒否（今は入る物が無いので自然に成立するが、ドラッグ先の判定でも弾く）
- `resonance.ts` の `CONSTELLATION_RING` と対の表: `weapon → mainHand`, `gun → offHand`（環の形は変えない。左手が空なら今の「銃なし」と同じ扱い）

### 5.2 性質（`src/loot/affixes.ts`）

- `slots` の `"weapon"` / `"gun"` を機械的に `"mainHand"` に置換し、重複を潰す（39 か所が gun、100 か所が weapon）
- 射撃専用の性質（貫通・弾数・弾速・過負荷・深穿ち・剥がし撃ち・撃ち込み杭・散弾の芯・散弾押し・追尾の毒・連射の烙印・起爆の手・`cv_projectilesToPoise` など **`tags` に `ranged` を持ち `slots` が旧 gun のみだったもの**）に `family: "gun"` を付ける。`AffixDef.family?: "melee" | "gun"` を足し、`generator.ts` の `traitsFor(slot, depth)` / `conversionsFor` に **ベースの家系** を渡して絞る（`TraitContext` に `family` を足す）。指輪・首飾りに載る射撃性質はそのまま（ビルドの部品として残す）
- 「近接・射撃ダメージ」系の表示文言はそのまま。throw の技（斧の投擲・魔弾・乱れ撃ち）は **射撃扱い**（`kind: "ranged"`・`onRangedHit`・`rangedDamage` が乗る）にして、近接ビルドでも射撃性質が少し生きるようにする

### 5.3 旧セーブ（`src/loot/profile.ts` / `migrate.ts`）

- `sanitizeItem` の `isSlot` の前に `normalizeSlot(v.slot)`（`LEGACY_SLOT_MAP` で読み替え）。`equipment` の読み込みは旧キー `weapon` → `mainHand`、旧キー `gun` → 中身を `stash` の先頭へ（`loaned` の遺物は捨てる）。書き戻すと新形式になるので冪等
- `migrate.ts` の `migrateItem` は `slot` を `normalizeSlot` で通す（リプレイの装備スナップショットなど profile を通らない経路のため）
- `core/replay.ts`: `REPLAY_VERSION = 8`。`sanitizeLoadout` は `SLOTS` を回すので新キーだけ受ける（旧版は version で弾かれる）
- `ui/replayStore` に残る旧リプレイは読めなくなる（version 違いは今も黙って捨てる仕組み）

### 5.4 拠点の武器掛け（`src/system/hub.ts` / `ui/hubFlow.ts`）

`RackEntry` / `RackRow` を `{ kind: "moveset"; key }` だけにし、`trialShot` / `borrowGun` / 射撃の型タブを消す。銃の家系は武器種タブに並ぶ（貸し出しは家系の最初のベース = `earliestBase("mainHand", b => b.moveset === key)`）。

## 6. 射撃に依存する既存コンテンツの扱い

| 種類 | 対象 | 扱い |
| --- | --- | --- |
| 性質（射撃系） | 5.2 の一覧 | 銃の家系のベースだけに出る（`family: "gun"`）。指輪・首飾りの分は残す |
| 誓約 | `ks_bladeOath` 剣の誓い（撃てない）/ `ks_overclock` 過駆動（射撃 n 発ごと）/ `ks_pacifist` | 銃を持つビルドで生きる。bladeOath は throw の技も封じる（`blockedByBladeOath` を `emitVolley` の入口へ移す） |
| 祝福（`boonDefs.ts`） | dashGun 撒き足 / standingSniper / bulletSteal 奪弾 / silenceShot / fullMoonShot / triggerHappy（近接できない）/ 結び standingSniper+dashGun | `loadout: { movesets: GUN_MOVESETS }` を足して銃のときだけ 3 択に出す。加えて `buildTags` で `usesProjectiles(moveset)` が偽なら owned から `ranged` を外す（指輪の射撃性質だけで射撃祝福が出ないように） |
| 祝福（`boonDefsWave2.ts`） | 油の地雷 / 撃ち離れ / 毒蜂 / 礫雨（`loadout.shots`）、杖の灯（`weapon("wand")` + onRangedHit） | `loadout.shots` は `stats.shot` を見るので銃のときだけ出る。変更なし。杖の灯は魔弾（throw）が onRangedHit を出すので生きる |
| 祝福の onRangedHit 系（野焼き・野良の印・弱点突きの射撃分） | — | throw の技でも発火する。変更なし |
| ルール条件 `{ kind: "shot" }`（`core/rules.ts`） | — | 変更なし |
| スキル | 撃ち抜き railshot など射撃系スキル、砲台（`summons.ts` の `onTurretShoot`） | スキルは独立。砲台は「プレイヤーの射撃に合わせて撃つ」ので近接だと沈黙する → `startSwing` の入口でも `onTurretShoot` を呼ぶ（振りに合わせて撃つ） |
| ジョブ（`data/jobs.ts`） | 狩人 hunter（favored 槍・鞭、初期武器 鞭、初期石 撃ち抜き） | favored を `["longarm", "thrown", "whip"]`、初期武器を `crossbow`（弩）に。`system/jobs.ts` の得意武器の上乗せは `isGun` なら `rangedDamageMul` / `fireRateMul` に掛ける。ジョブ派生 LLLR は銃では「3 発撃って右」で出る（今の gunner と同じ） |
| 変身 | 狼化（右 = 遠吠え）/ 鉄塊化（右 = 砲撃） | `shapeButtonPress` が先に取るので変更なし。定義の `secondary` → `art` の置換のみ |
| QA bot（`qa/bot.ts`） | `holdShot` / `shootHeldFor` | `isGun` なら左を押しっぱなし（charge の型は既存の離し方）、近接なら近づいて振る。技は **strike / throw は射程内で `ART_PERIOD`（1.0 秒）ごとに右を 1 フレーム押す**、parry は敵が windup 中で射程内なら右を 0.2 秒押す、guard / charge / recall は使わない（QA の穴として report に注記） |
| QA 標準ビルド（`qa/simulation.test.ts`） | 全 SLOTS を回して装備を生成 | `LOOT_SLOTS` を回す。3 装備パターンのうち 1 つは銃の家系を右手に持たせる（今の「銃あり」相当の経路を踏ませる） |
| HUD（`render/comboUi.ts` `chargeHint`） | 「右 長押し: 溜め」「左 / 右: 撃つ」 | 「右: 受け流し」のように **技の名前と再使用の残り** を出す。`shot.charge` の案内は `isGun` のときだけ |
| `render/elementUi.ts:37` / `system/elementCombat.ts:50` | 射撃の素性 = `SHOT_TYPES[stats.shot].attack` | throw の弾は `Projectile.attack?: AttackProfile` を持たせて優先（無ければ従来通り） |
| 効果音 | `SHOT_SFX`（射撃の型ごと） | throw の技は借りた型の音をそのまま使う。受け流し成功は既存の効果音があれば流用、無ければ `sfxLayers` に 1 つ |
| 用語（`docs/GLOSSARY.md`） | 武器 / 銃 → 右手 / 左手、射撃の型、ボタンの役割 | 「固有技」（右クリックの技。key `art`）を追加。「射撃の型」は「銃のベースが決める弾の型」に説明を変える |

## 7. 刃・頭を外向きにする規則（`src/render/renderMath.ts` / `src/data/sprites/weapons.ts`）

現状の観察（`sprites/weapons.ts`）: 横の絵（右向き）は柄が右へ伸び、刃・頭は **上側**（大鎌・斧・戦鎚。鉈は刃が下側）。斜めの絵（右上向き）は刃・頭が柄の **左上側**。構え（`REST_ANGLE = -π/4`、`renderMath.ts:476`）は斜めの絵をそのまま使うので、刃が自分の頭の上に被さって見える。これが「内向き」の正体。

規則:

1. **構え中**: 刃の法線は「拳から自分の頭へ向かうベクトル」と反対側（頭と反対側 = 外）
2. **振りの最中（arc / box / circle）**: 刃の法線は角速度の向き（振り抜く方向が刃）。thrust は 1 と同じ
3. **銃・両刃・柄だけの武器**（剣・双剣・槍・棍・鞭・拳・杖・大盾・銃 4 家系・二丁拳銃）は対象外

実装:

- `sprites/weapons.ts`: `WEAPON_EDGE: Partial<Record<MovesetKey, "up" | "down">>`（横の絵で刃がある側。scythe / axe / hammer / chainSickle = up、cleaver = down。刀は片刃だが絵が細く判別できないので今回は外す）。`held()` は `edge` 付きの武器に **4 枚目 `diagonalOut`** を自動生成する: 反対角線で写す `mirrorAntiDiagonal(frame)`（`new[y][x] = old[W-1-x][W-1-y]`。画素の並べ替えだけなので崩れない。拳の位置 (2,10) は反対角線上にあるので動かない）。`WEAPON_FRAME.diagonalOut = 3`、`WEAPON_GRIPS[3] = { x: 2, y: 10 }`
- `renderMath.ts`: `weaponView(angle)` はそのまま、新たに `edgeView(view: WeaponView, edge: "up" | "down", wantNormal: Vec): WeaponView` を足す。絵と反転から今の刃の法線を求め（横 = (0,-1)、縦 = (-1,0)、斜め = (-1,-1)/√2、flipX / flipY で各成分を反転、`edge: "down"` は符号反転）、`wantNormal` との内積が負なら鏡像にする（横 → flipY 反転、縦 → flipX 反転、斜め → `diagonalOut` に差し替え）。`weaponPose` の入力に `edge?: "up" | "down"` を足し、規則 1 / 2 で `wantNormal` を計算して `edgeView` を通す
- `renderer.ts`（最小 Edit）: `heldWeaponPose` に `edge: WEAPON_EDGE[moveset.key]` を渡すだけ
- テスト（`renderMath.test.ts`）: 「大鎌を右向きで構えると刃は頭と反対側（右下）を向く」「左向きの構えでも刃は頭と反対側」「扇の振りでは刃が振り抜く方向を向く」「両刃の武器は反転しない」。`sprites.test.ts`: 「edge を持つ武器は斜めの絵の刃が柄の左上側にある（diagonalOut を作れる）」= 斜めの絵の上半分の左側に不透明画素が多いことで検査

## 8. 振りの速さの新旧表（`src/data/tuning.ts`。剣は `PLAYER.melee` / `ACTION.dashAttack`）

原則: 威力・怯み値・リーチは据え置き。軽量武器は windup / active / recover をおよそ ×0.7、最終段は ×0.75。派生・ダッシュ攻撃も同じ比率で縮める（表は段だけ）。windup は 2 ステップ（0.02 秒）を下限にする。重量武器（大剣・戦鎚・斧・鉈）と大鎌は据え置き。

| 武器種 | 段 | 旧 windup / active / recover（合計） | 新（合計） |
| --- | --- | --- | --- |
| 剣 | 1・2 | 0.05 / 0.10 / 0.16（0.31） | **0.035 / 0.08 / 0.10（0.215）** ≒ 旧双剣 0.19 × 1.13 |
| 剣 | 3（heavy） | 0.08 / 0.12 / 0.30（0.50） | 0.06 / 0.10 / 0.20（0.36） |
| 剣 | ダッシュ攻撃 | 0.03 / 0.10 / 0.18 | 0.03 / 0.08 / 0.14 |
| 双剣 | 1・2・4 | 0.03 / 0.07 / 0.09（0.19） | 0.02 / 0.06 / 0.08（0.16） |
| 双剣 | 3（×2） | 0.03 / 0.10 / 0.10（0.23） | 0.02 / 0.09 / 0.09（0.20） |
| 双剣 | 5（heavy） | 0.05 / 0.10 / 0.22（0.37） | 0.04 / 0.08 / 0.18（0.30） |
| 拳 | 1〜3 | 0.02 / 0.06 / 0.08（0.16） | 0.02 / 0.05 / 0.06（0.13） |
| 拳 | 4（×3） | 0.03 / 0.15 / 0.12（0.30） | 0.03 / 0.13 / 0.10（0.26） |
| 拳 | 5（heavy） | 0.04 / 0.08 / 0.20（0.32） | 0.04 / 0.07 / 0.16（0.27） |
| 刀 | 1・2 | 0.04 / 0.08 / 0.14（0.26） | 0.03 / 0.07 / 0.10（0.20） |
| 刀 | 3 | 0.05 / 0.08 / 0.16（0.29） | 0.04 / 0.07 / 0.11（0.22） |
| 刀 | 4（突き heavy） | 0.08 / 0.10 / 0.30（0.48） | 0.06 / 0.09 / 0.24（0.39） |
| 鎖鎌 | 1〜3 | 0.03 / 0.07 / 0.10（0.20） | 0.02 / 0.06 / 0.08（0.16） |
| 鎖鎌 | 4（heavy） | 0.05 / 0.10 / 0.24（0.39） | 0.04 / 0.09 / 0.20（0.33） |
| 槍 | 1・2 | 0.07 / 0.08 / 0.20（0.35） | 0.05 / 0.07 / 0.14（0.26） |
| 槍 | 3（×2） | 0.08 / 0.14 / 0.22（0.44） | 0.06 / 0.12 / 0.16（0.34） |
| 槍 | 4（heavy） | 0.10 / 0.12 / 0.32（0.54） | 0.08 / 0.10 / 0.26（0.44） |
| 棍 | 1〜3 | 0.06 / 0.10 / 0.20（0.36） | 0.04 / 0.09 / 0.14（0.27） |
| 棍 | 4（円） | 0.10 / 0.12 / 0.34（0.56） | 0.08 / 0.11 / 0.28（0.47） |
| 杖 | 1・2 | 0.05 / 0.08 / 0.18（0.31） | 0.04 / 0.07 / 0.12（0.23） |
| 杖 | 3 | 0.05 / 0.10 / 0.20（0.35） | 0.04 / 0.08 / 0.14（0.26） |
| 杖 | 4（円） | 0.10 / 0.12 / 0.30（0.52） | 0.08 / 0.11 / 0.26（0.45） |
| 鞭 | 1（突き） | 0.10 / 0.08 / 0.22（0.40） | 0.07 / 0.08 / 0.15（0.30） |
| 鞭 | 2（扇） | 0.08 / 0.10 / 0.20（0.38） | 0.06 / 0.10 / 0.14（0.30） |
| 鞭 | 3（扇 ×2） | 0.08 / 0.16 / 0.22（0.46） | 0.06 / 0.16 / 0.16（0.38） |
| 鞭 | 4（突き） | 0.12 / 0.10 / 0.30（0.52） | 0.10 / 0.10 / 0.26（0.46） |
| 大盾 | 1〜3 | 0.06 / 0.10 / 0.20（0.36） | 0.05 / 0.09 / 0.14（0.28） |
| 大盾 | 4（heavy） | 0.10 / 0.12 / 0.34（0.56） | 0.08 / 0.12 / 0.30（0.50） |
| 大鎌・大剣・斧・鉈・戦鎚 | 全段 | 据え置き | 据え置き |
| 銃 4 家系 | 段なし（`steps: []`） | — | 射撃間隔は `PLAYER.shoot.cooldown` × 型の `cooldownMul` のまま |

補足:

- `PLAYER.recoverCancel = 0.5` は据え置き（recover が短くなるぶん連打の吸い付きは自然に良くなる）
- `MANA.onMelee` は据え置き。手数が増えるぶん気力の回収が速くなるので、QA の気力回収の数値が上がる。balance-tuner が `MANA.onMelee` か `PLAYER.melee[].scaling.base` を 10〜15% 下げる判断をする（剣 = 基準線なので剣を先に見る）
- `data/weapons.test.ts` の「単一最強を作らない」テストは剣が速くなるぶん他が通りやすくなる（不利になる武器種は無い）

## 9. 実装レーン（並列 4 本）

先に **Lane A が `src/data/weapons.ts` の型と `MOVESET_KEYS`（`sidearm` / `longarm` / `cannon` / `thrown`）・`GUN_MOVESETS` / `isGun` / `usesProjectiles` を入れてコミット**し、その後 B / C / D を並列にする（B・C・D はこの 4 つのキーと 3 関数だけに依存する）。共有ファイル（`core/state.ts` / `core/game.ts` / `data/tuning.ts` / `render/renderer.ts` / `main.ts`）は最小 Edit。

### Lane A: 固有技と銃の家系（implementer、Opus 推奨。設計は本書で固まっている）

- 所有: `src/data/weapons.ts`、`src/system/weaponArts.ts`（新規）、`src/system/player.ts`、`src/skills/forms.ts`、`src/qa/bot.ts`、`src/data/weapons.test.ts`、`src/system/weaponArts.test.ts`（新規）、`src/render/comboUi.ts` + test
- 最小 Edit: `src/data/tuning.ts`（`WEAPON.movesets` の 4 家系と `arts` の数値、`WEAPON.artDefaults`〔parry 窓・guard 倍率〕、8 章の速さ）、`src/core/state.ts`（`Player.art: { cooldown: number; holding: boolean; holdTime: number }`）、`src/system/combat.ts`（`damagePlayer` の無敵判定の直後に `tryParry(state, attacker)` / `guardDamageMul(state, attacker)` を 2 行）
- 追加する型・関数: 2 章の `PrimaryKind` / `WeaponArtDef` / `HoldArtDef` / `ThrowArtDef` / `RecallArtDef`、`defineMoveset`、`isGun` / `usesProjectiles` / `GUN_MOVESETS` / `ART_NAMES`。`system/weaponArts.ts`: `startArt(state)`（右押下で tryBranch が外れたときに呼ぶ）/ `updateArt(state, input, dt)`（`updatePlayer` で `updateCharge` の直後）/ `tryParry` / `guardDamageMul` / `emitArtVolley`（`player.ts` の `emitVolley` を `export` にして `override?: { damage; poise; count; spreadDeg; attack; sprite }` を受けるようにし、それを呼ぶ）/ `recallShots`
- `player.ts` の変更点: `onButtonPress` の `role !== "shot"` 分岐を「左なら `tryAttack`、右なら `startArt`」に。`shotButtonHeld` は `isGun` のときだけ左を見る。`buttonRole` / `ActionKind` を消す。`updateShooting` は `isGun` でなければ呼ばない（`shotBurst` / `shotCharging` は銃のときだけ動く）。hold 中は `tryAttack` を通さず、左押下でホールドを解除してから通常の流れへ
- テスト（it 名）: 「右クリックは武器種の固有技を出す（剣は受け流し、大剣は薙ぎ払い）」「strike の技は派生として branches に混ざり、長い列の派生が優先される（左左右 → 兜割り）」「受け流しの窓の被弾は無効化され、相手が怯みカウンター扱いになる」「受け流しの窓を過ぎた被弾は通る」「盾の構えは前方の被ダメを減らし、後ろからは減らさない」「構えを離すと盾押しが出る」「斧の投擲は戻る弾を出し、再使用が明ける前は出ない」「手元返しで自分の弾が反転する」「銃の家系だけ左で撃ち、近接の武器種では左を押しても弾が出ない」「射撃の型はベースの shot のまま（短銃の三連銃は三点）」「技の再使用中は右を押しても何も起きず、入力列にも積まない」「変身中の右クリックは変身が引き受ける（遠吠え）」「bot は銃なら左を押し、近接なら右の技を周期的に使う」
- 完了条件: `npm run check` 緑、`docs/COMBAT_DESIGN.md` A-7 の「ボタンの役割」「コンボ派生」の表を 3 章に差し替え

### Lane B: 右手 / 左手と装備データ（implementer、Sonnet 可）

- 所有: `src/loot/types.ts`、`src/loot/bases.ts`、`src/loot/affixes.ts`（`slots` の置換と `family`）、`src/loot/generator.ts`、`src/loot/migrate.ts`、`src/loot/profile.ts`、`src/loot/resonance.ts`、`src/ui/inventoryLayout.ts`、`src/ui/inventory.ts`、`src/system/hub.ts`、`src/ui/hubFlow.ts`、`src/data/jobs.ts`、`src/system/jobs.ts`、`src/qa/simulation.test.ts`、`src/core/replay.ts`（version と sanitize）、関連テスト（`bases.test` / `stats.test` / `profile.test` / `migrate.test` / `generator.test` / `inventory.test` / `hub.test` / `jobs.test` / `resonance*.test` / `lootWave2.test` など `"gun"` / `"weapon"` を書いている 35 ファイル）
- 最小 Edit: `src/render/inventoryUi.ts`（左手の「—（両手の仕組みは後日）」表示）
- 追加: `SLOTS` / `LOOT_SLOTS` / `LEGACY_SLOT_MAP` / `normalizeSlot(v: unknown): Slot | null`、`AffixDef.family`、`TraitContext.family`、`baseFamily(base)`、`REPLAY_VERSION = 8`
- テスト（it 名）: 「旧セーブの weapon / gun スロットの遺物は右手と倉庫へ移る」「gun スロットの文字列を持つアイテムは mainHand として読める（冪等）」「左手にはベースが無く、ドロップの部位抽選に出ない」「射撃専用の性質は銃の家系のベースにだけ出る」「近接のベースに貫通が乗らない」「共鳴の環は 6 部位のまま（右手 – 鎧、左手 – 靴 が対）」「武器掛けは武器種だけを並べ、銃の家系も含む」「狩人の初期武器は弩で、得意武器の上乗せは射撃に掛かる」「旧版のリプレイは version 違いで捨てられる」
- 完了条件: `npm run check` 緑、`docs/GLOSSARY.md` の部位の行と `docs/ARCHITECTURE.md` の永続化の節を更新

### Lane C: 射撃依存コンテンツの読み替え（implementer、Sonnet 可）

- 所有: `src/system/boonDefs.ts`（`loadout` の追加）、`src/system/boons.ts`（`buildTags` の `ranged` 判定）、`src/system/keystones.ts`（表示名の文言）、`src/loot/affixes.ts` の誓約 `ks_bladeOath` の `desc`（Lane B と同じファイルなので **Lane B の完了後** に着手。行は 3363 付近のみ）、`src/skills/summons.ts`（砲台の同期）、`src/system/elementCombat.ts` / `src/render/elementUi.ts`（`Projectile.attack` 優先）、`src/system/traitHooks.ts`（変更が要るか確認のみ）、`src/system/boons.test.ts` / `boonRules.test.ts`
- 最小 Edit: `src/core/state.ts`（`Projectile.attack?: AttackProfile`）
- テスト（it 名）: 「射撃の祝福は銃の家系を持つときだけ 3 択に出る」「指輪の射撃性質だけでは射撃の祝福が出ない」「杖の魔弾の命中で杖の灯が気力を戻す」「砲台は近接の振りに合わせて撃つ」「投擲の弾の素性は技のものが優先される」
- 完了条件: `npm run check` 緑

### Lane D: 持ち手の刃の向きと銃の絵（pixel-artist + implementer、Opus）

- 所有: `src/render/renderMath.ts`、`src/data/sprites/weapons.ts`、`src/render/renderMath.test.ts`、`src/render/sprites.test.ts`
- 最小 Edit: `src/render/renderer.ts`（`heldWeaponPose` に `edge` を渡す 1 行。`drawHeldWeapon` の二丁拳銃の分岐は `moveset.key === "gunner"` に）
- 追加: `WEAPON_EDGE`、`WEAPON_FRAME.diagonalOut`、`mirrorAntiDiagonal`、`edgeView`、`WeaponPoseInput.edge?`。銃 4 家系の絵（短銃 = 今の GUN を流用、長銃 = 長い銃身、砲 = 太い筒、投擲 = 輪 / 短刀）。絵が揃うまでは `HELD` で GUN を流用して `sprites.test` を通す
- テスト: 7 章の it 名
- 完了条件: `npm run check` 緑。ブラウザで大鎌・斧・戦鎚の構えと振りを目視（10 章）

統合順: A → B / C / D 並列 → 統合役が `CHANGELOG.md` に追記し `npm run qa:full`。QA の結果を見て balance-tuner が 8 章の補足の数値を詰める。

## 10. 不確かな点・ブラウザで確かめる点

- **受け流しの手触り**: 窓 0.25 秒・再使用 0.6 秒は仮。敵の windup は 0.3〜0.8 秒なので「予備動作を見てから押す」で間に合うはずだが、ブラウザで骸骨騎士・猪に対して試す。速すぎるなら窓を 0.3 に
- **連打の気持ちよさ**: 剣 0.215 秒 / 段だと 3 段が 0.8 秒。`recoverCancel 0.5` と組み合わせて連打の詰まりが無いか、双剣・拳で入力が飲まれないか（`chainMaxInputs 5`、`chainWindow 0.5` は据え置き）
- **DPS の上振れ**: QA の撃破数 / 到達深度が上がる見込み。剣で 20% 以上上がるなら `PLAYER.melee[].scaling.base` を下げる（威力の固定値テスト `SWORD_PINNED` / `attributes.test` も併せて更新）
- **反対角線の鏡像の見た目**: 光源が左上なので、写した絵は影が逆になる。目立つなら pixel-artist が `diagonalOut` を手描きする（`held()` に 4 枚目を明示で渡せる形にしておく）
- **銃の家系の名前**: 投げ短剣が「投擲」、三連弩が「長銃」の武器種名で HUD に出る。違和感があれば家系名だけ変える（key は変えない）
- **旧 gun スロットの遺物の行き先**: 倉庫が `STASH_CAPACITY` を超える場合は落とさず捨てるか、上限を一時的に超えて入れるか。推奨は「超えて入れる」（次に拾うまで整理を促す）。`profile.ts` の読み込みで上限を強制している箇所を確認する
- **`Projectile.attack` の優先**: `elementCombat.ts:50` の呼び出し元が stats だけを受けている場合、弾から素性を渡す経路（`projectiles.ts` の命中 → `damageEnemy`）に引数を 1 つ足す必要がある。Lane C が着手前に呼び出しの形を確認する
- **QA bot の技の使い方**: parry / guard を使わない bot は受け流し系の祝福・来歴を踏まない。report の「0 件は経路を踏まない傍証」の注記に追記する
