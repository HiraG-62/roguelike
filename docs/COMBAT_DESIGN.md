# 戦闘再設計 実装仕様書（ステータス・マナ・怯み・状態異常）

作成日: 2026-09-23
前提: `docs/DESIGN_PRINCIPLES.md`、`docs/LOOT_DESIGN.md`（色・共鳴・`PlayerStats`）、`docs/ideas/skills.md`、`docs/ideas/action-feel.md`。
現状の要点:
- 与ダメは `rollOutgoing`（`src/system/combat.ts`）が `(base + flat) × mul × コンボ × JUST × バフ × 会心 × 誓約` で仕上げる。base は tuning / `SKILL` の固定値で、プレイヤー側の成長軸は装備の倍率だけ
- スキルは 2 スロット・CD とチャージ制（`src/system/skills.ts`）。左右クリック（3 段コンボ・連射）が主火力
- 3 段目・カウンター・突進斬り・地裂き・パリィ・壁叩きつけ・バーストがすべて **確定スタガー**（`HitOptions.stagger`）。加えて全ヒットのノックバックで敵が射程外へ押し出され、ダッシュ無敵は連打で約 62% の時間を覆う。1 対 1 ではほぼ被弾しない

凡例: 数値はすべて `src/data/tuning.ts`（スキルは `src/skills/data.ts` の `SKILL`）に定数化する前提。「要追加: 型.フィールド」は型の追加が要るもの。

---

## 0. 方針（要約）

| 軸 | 今 | これから |
| --- | --- | --- |
| 成長 | 装備の倍率だけ | **5 ステータス**（筋力 / 技巧 / 体力 / 精神 / 霊力）。技の威力 = 基礎 + Σ(係数 × ステータス) |
| 主火力 | 左右クリック | **スキル**（4 スロット）。左クリックは「マナを溜める手段」、右クリックは「弱い遠距離 + 少量回収」 |
| スキルの制限 | CD とチャージ | **マナ消費** + 共通最低間隔 0.15 秒 + スキル固有の最低間隔。一部はコスト 0 の CD 型 |
| 防御 | ダッシュ無敵・JUST・JUST カウンター・カウンター確定スタガー・弾返し・パリィ・リゲイン | デフォルトは **ダッシュ無敵（短縮）+ ジャスト回避 + リゲイン** のみ。他はスキル石・祝福・性質へ |
| 怯み | 確定スタガー | **怯み値 / 怯み耐性** の蓄積。怯んだ直後は **堅守**（受け怯み値半減）で固め不可 |
| 状態異常 | 敵のみ burn / chill（+ shock は即時 proc） | プレイヤーと敵に共通の `StatusEffect`。**13 種**、相互作用あり。敵もプレイヤーに付与する |

**不変の約束**:
1. ステータスが基礎値（各 5）のとき、全攻撃の威力は **現行の数値と一致** する（段階 1 でバランスを壊さない）。係数と基礎値はその条件から逆算している
2. 既存の `PlayerStats` フィールドは消さない。ステータスは「追加の入力」で、最後に既存フィールドへ差分を畳み込む
3. 乱数は `state.rng` のみ。ステータス・マナ・怯みの計算は乱数を使わない（状態異常の付与確率だけが既存どおり rng）

---

## 1. 用語（`docs/GLOSSARY.md` に追加する）

| 表記 | 内部名 | 意味 |
| --- | --- | --- |
| ステータス | `Attributes` / `AttrKey` | プレイヤーの 5 つの素質値。筋力 `str` / 技巧 `dex` / 体力 `vit` / 精神 `mnd` / 霊力 `spi` |
| 実効値 | `effectiveAttr` | ステータスに逓減を掛けた値。計算にはこれを使う |
| 係数 | `Scaling` | 技の威力がステータス 1 点あたり何増えるか（LoL の ratio） |
| マナ | `mana` | スキルの資源。通常攻撃の命中で溜まり、スキルで減る |
| 共通最低間隔 | `gcd` | どのスキルを撃った後も 0.15 秒は次のスキルを撃てない |
| 最低間隔 | `minInterval` | スキルごとの連打下限 |
| 負担 | `burdenMul`（旧 `cooldownMul`） | マナ型ならコスト、CD 型なら CD に掛かる倍率 |
| 怯み値 | `poise`（攻撃側） | 攻撃 1 回が敵に与える怯みの量 |
| 怯み耐性 | `PoiseDef.poise` | 敵ごとの怯み値の上限。蓄積がこれを超えると怯む |
| 怯み | `stagger`（状態異常） | 行動停止。表示は「怯み」（旧表記「スタガー」を置き換え） |
| 堅守 | `guarded`（状態異常） | 怯みが解けた直後の耐性。受ける怯み値が半減する |
| ダウン | ボスの `stagger` | ボスの怯み。長く、被ダメが増える |
| 拘束上限 | `STATUS.ccBudget` | 行動停止系（怯み・凍結・麻痺）を一定時間内に合計何秒まで入れられるか |
| 強靭 | `superArmorMul` | 敵の攻撃中（予備動作・攻撃）に受ける怯み値の倍率 |

---

## A. ステータス

### A-1. 5 種と伸びるもの

基礎値は全員 **各 5**（`ATTR.base`）。以下の「派生」は **基礎値からの差分** で既存の `PlayerStats` に畳み込む（基礎値なら何も変わらない）。`e` は実効値。

| ステータス | 色 | 係数で伸びる技 | 派生（差分 d = e − 5） |
| --- | --- | --- | --- |
| 筋力 `str` | 紅 | 近接 3 段・ダッシュ攻撃・近接系スキル | 怯み値倍率 `poiseDamageMul` +3%×d / ノックバック `knockbackMul` +2%×d |
| 技巧 `dex` | 蒼 | 射撃・射撃系スキル・設置系の一部 | 移動 `moveSpeedMul` +0.5%×d / 連射 `fireRateMul` +1%×d / ダッシュ CD `dashCooldownMul` −1%×d（下限 ×0.7） |
| 体力 `vit` | 翠 | （係数なし） | 最大 HP +4×d / 被る状態異常の持続 `statusTakenMul` ×100 / (100 + 3×d)（下限 ×0.5） |
| 精神 `mnd` | 金 | バースト | 最大マナ +5×d / マナ自然回復 +0.12×d 毎秒 / 会心率 +0.4%×d |
| 霊力 `spi` | 冥 | 全スキルの第 2 係数・バースト | 状態異常の効果量 `statusPotencyMul` +3%×d / buff 系スキルの効果量 +2%×d |

色の対応は `docs/LOOT_DESIGN.md` の 5 色の意味（紅 = 近接、蒼 = 射撃・機動、翠 = 生存、金 = 必殺・会心、冥 = 呪い）に揃えた。

### A-2. 逓減（実効値）

```
effectiveAttr(a) =
  a ≤ 0           → 0
  0 < a ≤ 20      → a
  20 < a ≤ 40     → 20 + (a − 20) × 0.5
  a > 40          → 30 + (a − 40) × 0.25
```
定数: `ATTR.knee1 = 20` / `ATTR.slope1 = 0.5` / `ATTR.knee2 = 40` / `ATTR.slope2 = 0.25`。
1 ステータスを 40 まで盛っても実効 30。2 つに 20 ずつ振った方が合計実効値が高い。

### A-3. 入手経路

| 経路 | 量 | 中身 | ゴール装備を作らない理由 |
| --- | --- | --- | --- |
| 基礎 | 各 5 | 固定 | - |
| 装備の性質 | 1 性質 +2〜+8 | 新性質 `attr_str` / `attr_dex` / `attr_vit` / `attr_mnd` / `attr_spi`。色はそれぞれ紅 / 蒼 / 翠 / 金 / 冥。期待値曲線は深度 1: 2 → 10: 5 → 20: 8 | 属性の性質も色の配合に数える。1 色に寄せると支配共鳴が成立し、**他色の性質（他のステータス含む）が 75% に弱まる**。逓減と排他の両方がかかる |
| 装備の変換 | - | 新変換 `cv_dexToStr` など 5 種:「技巧の 50% を筋力として扱う（技巧は 50% 減る）」 | 片方を捨てて片方を伸ばす交換 |
| 共鳴 | - | 支配: その色のステータス +3 / 二重: 2 色それぞれ +2 / 散光: 全ステータス +1 | 共鳴は同時に 1 つ |
| 祝福 | - | ルール変更のみ（数値盛りはしない。A-5） | ラン内 |
| ラン内成長 | 階層到達ごとに 1 点、ボス撃破で 2 点 | 祝福 3 択の直後に 5 択で振る | ランで消える。1 点は小さい |

ラン内成長は「方向の選択」で、各 1 点は小さい（係数 × 1 点。旋風斬りなら 1 ヒット +0.4）。深度 15 で合計 +16〜+20 程度。

### A-4. 集計の順序（パイプライン）

実装（`applyStats`、`src/system/player.ts`）は次の順序: **振り分け → 派生 → 祝福**。

```
computeStats(equipment)              // 既存。性質 → PlayerStats。attributes は生の加算値（逓減前）を入れる
  └ 共鳴の効果に attributes の加算を追加（resonance.ts）
→ addRunAttributes(stats, runAlloc)   // 新規。ラン内の振り分けを attributes に足す
→ deriveAttributes(stats)             // 新規。実効値を計算し、A-1 の差分を既存フィールドへ畳み込む
→ foldBoonStats(stats, boons, run)    // 既存。祝福
→ state.stats
```
- 祝福を最後に畳み込む理由: 祝福「硝子の見切り」（`glassJust`）は `stats.maxHp` を強制的に 1 に上書きする（`BOON.glassJustMaxHp`）。ステータス由来の派生（体力の最大 HP 加算）を祝福より先に確定させないと、この上書きが体力の加算で崩れて最大 HP が 1 でなくなる
- `deriveAttributes` は `applyStats` の中で、`addRunAttributes` の直後・`foldBoonStats` の直前に呼ぶ。`computeStats` 単体のテストは影響を受けない
- 派生の差分は既存フィールドの **後** に掛ける（ソフトキャップの後）。ステータスは装備のソフトキャップと別の逓減（A-2）を持つので二重に潰さない
- `stats.attributes`（生値）と `stats.attributesEff`（実効値）の両方を持つ。UI は両方を出す（「筋力 26（実効 23）」）

### A-5. 祝福（ルール変更。レーン L7）

| key | 名前 | 効果 |
| --- | --- | --- |
| `lopsided` | 偏重 | 最も高いステータスの係数が 1.25 倍。最も低いステータスは 0 として扱う |
| `swapHands` | 持ち替え | 筋力と技巧の係数を入れ替える（近接が技巧で、射撃が筋力で伸びる） |
| `spiritBlade` | 霊刃 | 通常攻撃の係数に霊力 0.3 が加わる。代わりに通常攻撃のマナ回収 −50% |

### A-6. 威力の計算式

```ts
/** 係数表。base はステータス基礎値（各 5）のとき現行値と一致するよう逆算した値 */
type Scaling = { base: number } & Partial<Record<AttrKey, number>>;

function scaled(stats: Readonly<PlayerStats>, s: Scaling): number {
  let v = s.base;
  for (const k of ATTR_KEYS) v += (s[k] ?? 0) * stats.attributesEff[k];
  return v;
}
```

**与ダメの合成順序**（`rollOutgoing` の変更点は ★）:

```
1. raw   = scaled(stats, 技の Scaling) × CastParams.damageMul      … 呼び出し側（player.ts / skills）
2. kind  = melee:  (raw + meleeDamageFlat)  × meleeDamageMul
           ranged: (raw + rangedDamageFlat) × rangedDamageMul
           proc:   raw
3. ★ skill 由来なら × skillDamageMul（要追加: PlayerStats.skillDamageMul、既定 1）
4. ★ 攻撃側プレイヤーが「弱体」なら × (1 − STATUS.weaken.mul)
5. 怯み中の敵なら × damageVsStaggeredMul（判定を phase から isStaggered(e) へ）
6. コンボ / JUST / バフ / 会心（既存）
7. 狂戦士 / 賭博師（既存）
8. damageEnemy 側で ★ 敵の「脆弱」× 1.2、★「凍結」砕き × 1.5、スキルの呪い（既存 skillHit）
```
`rollOutgoing(state, enemy, base, kind, opts?: { skill?: boolean })` に第 5 引数を足す（既存呼び出しはそのまま動く）。

**通常攻撃の係数**（`PLAYER.melee` / `ACTION.dashAttack` / `PLAYER.shoot` / `PLAYER.special` の `damage` を `Scaling` に置き換える）:

| 技 | 現行 | 新 Scaling | 基礎値での値 |
| --- | --- | --- | --- |
| 近接 1 段 | 9 | base 6 + 筋 0.6 | 9 |
| 近接 2 段 | 9 | base 6 + 筋 0.6 | 9 |
| 近接 3 段 | 18 | base 12 + 筋 1.2 | 18 |
| ダッシュ攻撃 | 13 | base 9 + 筋 0.8 | 13 |
| 射撃（1 発） | 5 | base 3.5 + 技 0.3 | 5 |
| バースト | 34 | base 24 + 精 1.0 + 霊 1.0 | 34 |
| 壁叩きつけ | 10 | base 7 + 筋 0.6 | 10 |

段階 2（スキル主体化）で近接・射撃の `base` を約 20% 下げる（B-7）。

---

## B. マナとスキル主体

### B-1. 資源ループ

```
左クリック命中 ──(+3 / +3 / +5)──┐
右クリック命中 ──(+1、1 射撃 3 まで)─┤
ジャスト回避 ────(+12)──────────┤
撃破 ──────────(+4)───────────┼──▶ マナ ──▶ スキル（消費）
自然回復（戦闘中 1.2/秒、非封鎖中 ×2.5）─┘
```

**方針（2026-09-24 プレイ所見で締め直し）**: 序盤（装備・祝福なし）のマナは乏しい資源にする。満タン 80 からマナ型スキル（平均コスト約 19）を 3〜4 発撃つとほぼ空になり、以後は通常攻撃の命中・撃破・ジャスト回避で少しずつ取り戻す。自然回復だけでは 1 発ぶんに 15 秒前後かかるので、通常攻撃を混ぜる動機が生まれる。回復・軽減の伸びしろは基礎値ではなく装備の性質と祝福（`maxMana` / `manaRegen` / `manaGainMul` / `manaCostMul`）に置き、ビルドを組むほど理想の撃ち方に近づく体験にする。旧値（100 / 4.5 / ×4 / [5,5,8] など）は「回復が早すぎてコストが機能していない」ため改めた。

| 定数 `MANA` | 値 | 意味 |
| --- | --- | --- |
| `baseMax` | 80 | 精神 5 のときの最大マナ（派生は A-1: 精神 1 点 +5） |
| `baseRegen` | 1.2 | 精神 5 のときの自然回復 / 秒（派生は A-1: 精神 1 点 +0.12） |
| `idleRegenMul` | 2.5 | 封鎖されていない部屋・通路での自然回復倍率（待ち時間を作らない） |
| `onMelee` | [3, 3, 5] | 近接各段の命中 1 体ごと |
| `meleeTargetCap` | 2 | 近接 1 振りで回収する敵の上限 |
| `onDashAttack` | 3 | ダッシュ攻撃 |
| `onCounterMul` | 2 | カウンターヒットなら倍 |
| `onShot` | 1 | 射撃弾の命中 1 体ごと |
| `shotVolleyCap` | 3 | 1 回の射撃（複数弾）で回収できる上限 |
| `onJust` | 12 | ジャスト回避 |
| `onKill` | 4 | 撃破（どの手段でも） |
| `costMulMin` | 0.4 | 装備・祝福で下げられるコスト倍率の下限 |
| `startFull` | true | ラン開始で満タン |
| `descendRefill` | 0.5 | 階層到達で最大の 50% まで回復（既に上回っていれば何もしない） |

- 回収は `manaGainMul`（要追加: `PlayerStats.manaGainMul`、既定 1）を掛ける
- **スキル自身の命中ではマナが戻らない**（無限ループ防止）。例外は刻印符「連鎖」（B-5）
- 1 ヒットで回収するのは近接の「命中した敵 1 体ごと」だが、1 振りあたり上限 2 体ぶん（`MANA.meleeTargetCap = 2`）
- 必殺ゲージ（バースト）は別の資源として残す。マナと合わせない（祝福 10 種以上が必殺ゲージを参照しているため）

### B-2. 最低間隔とマナ不足

| 定数 `SKILL` | 値 | 意味 |
| --- | --- | --- |
| `gcd` | 0.15 | どのスキルを撃った後も全スロット共通で撃てない秒 |
| 各スキルの `minInterval` | B-4 の表 | そのスロットだけの連打下限 |

発動の判定順（`castSlot` の先頭）:
1. 未装備 → 既存どおり「スキル未装備」
2. `rs.gcd > 0` または `slot.intervalLeft > 0` → **先行入力として保持**（既存の `pendingSlot`、`SKILL.inputBuffer` 0.25 秒）
3. CD 型で `chargesLeft <= 0` → 既存どおり「冷却中」
4. マナ型で `mana < cost` → **不発**: 何も消費しない、`notReady(state, "マナ不足")`（既存の 0.6 秒抑制）、`pushSfx(state, "manaEmpty")`（要追加: `SFX_NAMES` に `manaEmpty`）、HUD のマナバーの不足分を 0.3 秒点滅（`rs.manaFlash`）。先行入力は破棄
5. 発動 → マナ型はコストを払う、`rs.gcd = SKILL.gcd`、`slot.intervalLeft = minInterval`

- 溜め（刻印符）は押した瞬間にコストを確認し、離した瞬間に払う。離した時点で足りなければ不発
- 先行入力中にマナが足りた場合（ダッシュ中に回収など）はそのまま発動する

### B-3. スロット 2 → 4 と入力

| スロット | キーボード（左手） | マウス | パッド |
| --- | --- | --- | --- |
| 1 | `Digit1` / `KeyC` | `Mouse3`（戻る） | LB 押しながら A |
| 2 | `Digit2` / `KeyV` | `Mouse4`（進む） | LB 押しながら X |
| 3 | `Digit3` / `KeyX` | - | LB 押しながら Y |
| 4 | `Digit4` / `KeyZ` | - | LB 押しながら B |

- パッドは **LB をスキル層のシフト** にする。LB を押している間、A / X / Y / B は攻撃・射撃・バースト・ダッシュではなくスキル 1〜4 になる。RT（攻撃）/ LT（射撃）/ RB（ダッシュ）は LB 中も効く。既存の RSTICK / DPAD_UP によるスキル 2 は外す
- `FrameInput` に `skill3Pressed` / `skill4Pressed` / `skill3Held` / `skill4Held` を足す（配列にせずフラットにする。`core/replay.ts` のビット列にそのまま並べられる）。**`REPLAY_VERSION` を 2 → 3** に上げる（旧リプレイは一覧に残るが再生不可、既存の仕組みどおり）
- `SKILL.slots = 4`。`SkillProfile.loadout` が 2 要素の旧セーブは読み込み時に `null` で 4 要素へ埋める（キー形式は変えないので `v2` は不要）
- 祝福の選択に使っている `skill1Pressed` / `skill2Pressed` / `attackPressed` はそのまま（`src/qa/bot.ts` もそのまま動く）

### B-4. スキル 14 種の分類と数値

**マナ型**（10）: 資源はマナ、`cooldown` は 0、チャージは常に 1（使わない）。
**CD 型**（4）: コスト 0、既存の CD とチャージ制。移動・防御・自己強化の「保険」に限る。

`Scaling` の列は「base + 係数」。基礎値（各 5）で現行の威力と一致する。怯み値は D 章の単位。

| key | 名前 | 型 | コスト | 最低間隔 | CD | 威力 Scaling | 基礎値での威力 | 怯み値 | 付与 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `whirl` | 旋風斬り | マナ | 18 | 0.6 | - | 3 + 筋 0.4 + 霊 0.4（1 回転ヒット） | 7 × 4 | 6 / ヒット | - |
| `lunge` | 突進斬り | CD | 0 | 0.3 | 3.0 | 8 + 筋 1.0 + 技 0.6 | 16 | 20 | - |
| `frag` | グレネード | マナ | 22 | 0.5 | - | 12 + 技 1.4 + 霊 1.4 | 26 | 30 | - |
| `railshot` | 撃ち抜き | マナ | 25 | 0.8 | - | 14 + 技 2.0 + 霊 1.2 | 30 | 25 | 脆弱 3 秒 |
| `parry` | パリィ | CD | 0 | 0.3 | 3.5 | 6 + 筋 0.6 + 霊 0.6（衝撃波） | 12 | 40 | - |
| `bloodPact` | 血の契約 | CD | 0（HP 12%） | 0.3 | 12 | 効果量 ×(1 + 0.02×(霊−5)) | - | - | - |
| `quake` | 地裂き | マナ | 24 | 0.6 | - | 10 + 筋 1.6 + 霊 0.8 | 22 | 45 | - |
| `thunder` | 雷撃 | マナ | 20 | 0.5 | - | 10 + 技 1.2 + 霊 1.6 | 24 | 15 | 感電 2 |
| `gravityWell` | 引力球 | マナ | 30 | 1.0 | - | tick 1 + 霊 0.4 / 破裂 8 + 霊 2.0 | 3 / 18 | tick 0 / 破裂 20 | 引き寄せ中 沈黙 |
| `mines` | 地雷 | マナ | 12 | 0.3 | - | 8 + 技 1.2 + 霊 1.2 | 20 | 25 | - |
| `haste` | 加速 | CD | 0 | 0.3 | 11 | 効果量 ×(1 + 0.02×(霊−5)) | - | - | - |
| `chainHook` | 鎖鎌 | マナ | 14 | 0.5 | - | 6 + 筋 1.0 + 技 0.6 | 14 | 15 | 出血 1 |
| `spiral` | 回転弾幕 | マナ | 28 | 1.1 | - | 2 + 技 0.3 + 霊 0.3（1 発） | 5 × 24 | 2 / 発 | - |
| `frostField` | 氷結地帯 | マナ | 26 | 0.8 | - | tick 1 + 霊 0.6 | 4 | 0 | 冷気 1 / tick |

目安: 戦闘中の回収は近接を当て続けて毎秒 10〜14、自然回復 3.5。コスト 20 前後のスキルを 1.5〜2.5 秒に 1 回撃てる（現行 CD 5 秒の約 2 倍の頻度）。当て続けないと回らないので「常に操作していたい」に合う。

パリィは D 章・C 章の変更も受ける（窓 0.22 → 0.16、成功時の CD 回復は全回復 → 50%、失敗硬直 0.35 → 0.45）。

### B-5. 刻印符 11 種の扱い

`CastParams.cooldownMul` を **`burdenMul`（負担）** に改名し、マナ型ではコスト、CD 型では CD に掛ける。

| key | 名前 | マナ型での効果 | CD 型での効果 |
| --- | --- | --- | --- |
| `multiCharge` | 多重 | コスト ×0.6、最低間隔 ×0.5、威力 ×0.7 | 現行どおり（チャージ +2、威力 ×0.7、CD ×1.3） |
| `bloodPrice` | 血の代償 | 最大 HP 6% を払い、威力 ×1.6、**コスト ×0.5**（血でマナを肩代わり） | 現行どおり |
| `comboFuel` | コンボ燃料 | 現行どおり | 現行どおり |
| `echo` | 反響 | 負担 ×1.25（コスト） | 負担 ×1.25（CD） |
| `pierce` | 貫通 | 現行どおり | 現行どおり |
| `recoil` | 反動 | 現行どおり（0.1 秒無敵は残す。ラン内要素） | 同左 |
| `chainReset` | 連鎖 | このスキルでの撃破で **コストの 50% を返す**、負担 ×1.2 | 現行どおり（チャージ +1、負担 ×1.35） |
| `curse` | 呪い | 現行どおり | 現行どおり |
| `delay` | 遅延 | 現行どおり | 現行どおり |
| `expand` | 拡大 | 負担 ×1.4 | 負担 ×1.4 |
| `charge` | 溜め | 押した時点でコストを確認、離した時点で払う | 現行どおり |

### B-6. スキル石の変異軸とリンク

- **リンク**: 1 本ごとに負担 +15%（`SKILL.linkCooldownPenalty` を `linkBurdenPenalty` に改名、値は 0.15 のまま）。マナ型ならコスト +15%、CD 型なら CD +15%
- **変異軸**: キーは変えない。`cooldownVsDamage` / `cooldownVsPotency` は負担に掛かる。ツールチップの表示だけ、マナ型は「コスト」、CD 型は「CD」と出し分ける（`formatVariant(roll, def)` に def を渡す）
- `castCooldown(def, params)` は `castBurden(def, params): { cost: number; cooldown: number }` に置き換える

### B-7. スキル主体化の調整（段階 2）

- 近接・射撃の `base` を約 20% 下げる（近接 1 段 6 → 4.8、3 段 12 → 9.6、射撃 3.5 → 2.8）。係数は据え置き
- 目標: QA bot の標準ビルドで **与ダメの 55〜65% がスキル由来**（L6 の計測項目）
- **未実施（QA 後に判断）**: `src/data/tuning.ts` の `Scaling` は現時点で近接 1 段 `base: 6`、2 段 `base: 6`、3 段 `base: 12`、射撃 `base: 3.5` のまま（ダッシュ攻撃 `base: 9` も同様）。−20% は L6 の QA でスキル由来ダメージ比率が目標（55〜65%）に届かなかった場合の調整用に残してある

### B-8. HUD

- マナバー: HP バーの直下、色 `#4aa0ff`。スキルのコストぶんを細い区切り線で示す（装着中の最小コストだけ）
- スキル枠 4 つ（16×16、間隔 4）。枠下にキー、右上にコスト数値。マナ不足の枠は暗く、CD 型は既存の CD マスク、最低間隔中は枠の縁が細く点滅
- 新規 `src/render/manaHud.ts`（マナバー）、既存 `src/render/skillHud.ts`（4 枠化）

---

## C. 難易度: 無効化手段の整理

### C-1. 現状と判断

| # | 手段（現状） | 判断 | 変更後 |
| --- | --- | --- | --- |
| 1 | ダッシュ無敵（全長 0.16 秒 + 終了後 0.04 秒、CD 0.32） | **残す（縮小）** | 無敵はダッシュ開始から **0.10 秒**（`PLAYER.dash.invulnTime`）、`graceInvuln` 0.04 → 0、CD 0.32 → **0.45**。連打時の無敵率: 現状 (0.16 + 0.04) / 0.32 = 62% → 0.10 / 0.45 = 22% |
| 2 | ジャスト回避（ダッシュ無敵中の被弾） | **残す** | 窓は上の 0.10 秒。報酬: スロー（0.45 → 0.35 秒）、必殺ゲージ、マナ +12（2026-09-24 に 15 から変更）、`justTimer` |
| 3 | ジャストカウンター（JUST 直後の攻撃で瞬間移動斬り、確定スタガー + 盾無視） | **祝福化** | 新祝福「見切り斬り」`justSlash`（rare）。怯み値 60、盾無視は維持 |
| 4 | カウンターヒット（予備動作中の近接、×1.5 + 確定スタガー + 盾無視） | **残す（変更）** | 威力 ×1.5 と盾無視は維持。確定スタガーをやめ **怯み値 ×2**（強靭 ×0.5 と相殺して等倍になる） |
| 5 | 弾返し（近接の active で敵弾を反射） | **祝福化** | 既存祝福「弾斬り充填」`parryCharge` を「弾返し」に置き換える（反射 + 必殺ゲージ ×3） |
| 6 | 敵弾を斬って消す（5 と一体） | **性質化** | デフォルトでは近接は敵弾を素通りする。新性質「弾斬り」`bulletCut`（蒼、武器）: 近接の active で敵弾を消す。代償: 近接リーチ −10% |
| 7 | パリィ（スキル） | **スキル石のまま（CD 型）** | 窓 0.22 → 0.16、成功時 CD 回復 100% → 50%、失敗硬直 0.35 → 0.45、衝撃波は怯み値 40 |
| 8 | リゲイン | **残す** | 取り戻せる割合 `poolRatio` 0.6 → 0.5 |
| 9 | 被弾後の無敵 0.7 秒 | **残す（短縮）** | 0.5 秒 |
| 10 | バーストの無敵 0.25 秒 + 周囲の敵弾消し | **残す（短縮）** | 無敵 0.15 秒。弾消しは維持（ゲージ満タンの対価） |
| 11 | 刻印符「反動」の 0.1 秒無敵 | 残す | ラン内要素 |
| 12 | 祝福: 鉄壁の構え / 回避一掃 / 勝利の帳 / 硝子の見切り / 再起 | 残す | ラン内の揺らぎ。選んだときだけ |
| 13 | トリガー効果 `invuln`（被弾時 + ゲージ満タン） | 残す（上限） | 持続の上限 0.4 秒（`TRIGGER.invulnMax`） |
| 14 | 全ヒットのノックバックで敵が射程外へ | **怯みへ統合** | 怯んでいない敵へのノックバックは ×0.35（D-4） |
| 15 | 3 段目・突進斬り・地裂き・パリィ・壁叩きつけ・バーストの確定スタガー | **怯み値へ置換** | D 章 |

`docs/DESIGN_PRINCIPLES.md` 4（予備動作は攻めの合図）の例示を「カウンターヒット（怯み値 2 倍）・ジャスト回避・祝福の見切り斬り / 弾返し」に書き換える（統合役）。

### C-2. 敵側の調整（「1 対 1 でも被弾する」）

| 項目 | 値 | 狙い |
| --- | --- | --- |
| 非怯み時のノックバック | ×0.35（`POISE.knockbackUnstaggered`） | 殴っても射程外へ逃げない。敵の攻撃が届く |
| 強靭 | 予備動作・攻撃中の受け怯み値 ×0.5（敵ごとの `superArmorMul`） | 殴り合いで相手の攻撃が止まらない |
| 攻撃間隔 `attackInterval` | 全敵 ×0.8 | 手数を増やす |
| 攻撃後の隙 `recover` | 全敵 ×0.8 | 反撃の窓を狭める |
| 予備動作 `windup` | 深度で短縮: ×max(0.75, 1 − 0.02 ×(深度 − 1))。迅速エリートと掛けても **基準の 60% を下限にクランプ**（原則 3） | 深層で読みを速くする |
| 連携ずらし | 1 体が予備動作に入ると、半径 90 以内で `attackCooldown` が 0.4 秒以下の敵が 0.2 秒遅れて予備動作に入る | ダッシュ 1 回で全部を避けられない（予備動作は個別に見える） |
| 連続攻撃（段階 3） | スライム（深度 4+）2 連跳び / 盾騎士 2 段斬り（2 撃目の予備動作 0.3）/ 猪（深度 6+）壁で反転してもう 1 回 / ゴーレム 2 重リング / 蝙蝠 群れの噛みを 0.15 秒ずつずらす | ダッシュ CD 0.45 を跨がせる |

目標値（L6 の QA で計測）: 標準 bot が深度 3 のスライム 1 体と 60 秒戦ったときの被弾 1〜3 回。深度 1〜3 の到達率は現行比 −10〜−20% に収める。

### C-3. 実装メモ（設計との既知の差分）

- **恐怖は拘束上限の対象外**（`STATUS.ccBudget` に数えない）。設計時は「行動停止系（怯み・凍結・麻痺・恐怖）」とまとめていたが、`src/system/statusEffects.ts` は恐怖を外している。理由: 恐怖の解除後免疫が 6 秒あり、拘束上限のウィンドウ（3 秒）と噛み合わせると事実上ずっと恐怖に入れず、さらに鬼火の「2 倍の時間」が上限 2 秒で頭打ちになって意味を失うため
- **骸骨卿のテレポート中の強靭 0 は未実装**。`src/data/enemyCombat.ts` の `boneLord` に `strikeSuperArmorMul` が無く、通常の `superArmorMul: 0.5` のまま。スライム王（`kingSlime`）は `strikeSuperArmorMul: 0` が入っている

---

## D. 怯み（Poise）

### D-1. 仕組み

```
敵の蓄積 poiseDamage += 攻撃の怯み値 × 受け倍率
  受け倍率 = 強靭（攻撃中なら superArmorMul）× 堅守（0.5）× エリート・深度（耐性側に掛ける）
蓄積 ≥ 耐性 → 状態異常「怯み」を付与（staggerTime 秒）、蓄積を 0 に
怯みが解けた瞬間 → 状態異常「堅守」を付与（通常 2.0 秒 / ボス 6.0 秒）
最後に怯み値を受けてから 1.0 秒後、毎秒 耐性 × 0.3 ずつ蓄積が減る
```

| 定数 `POISE` | 値 |
| --- | --- |
| `decayDelay` | 1.0 |
| `decayRate` | 0.3（耐性に対する割合 / 秒） |
| `guardedTime` | 2.0 |
| `guardedMul` | 0.5 |
| `bossGuardedTime` | 6.0 |
| `bossGuardedMul` | 0.25 |
| `bossPoiseGrowth` | 1.5（ダウンのたびに耐性に掛ける、上限 ×3） |
| `bossDownDamageMul` | 1.25 |
| `depthScale` | 0.08（耐性 ×(1 + 0.08 ×(深度 − 1))） |
| `eliteMul` | 1.5 |
| `knockbackUnstaggered` | 0.35 |
| `legacyStagger` | 25（移行期間に `HitOptions.stagger: true` を怯み値に読み替える値） |

**怯みの効果**: 行動停止（AI は何もしない。予備動作中なら攻撃は取り消し）、ノックバック等倍、与ダメ × `damageVsStaggeredMul`、怯み開始時に既存の演出（白抜け・大きめのヒットストップ）。
**自傷の怯み**（猪の壁激突、障壁の破壊）は怯み値を通さず `applyStagger(e, time, { selfInflicted: true })` で直接入れる。自傷の怯みの後は堅守を付けない。

### D-2. プレイヤー側の怯み値

最終値 = 基礎 × `poiseDamageMul`（筋力の派生、基礎値で 1）× 修飾（カウンター ×2 など）。

| 攻撃 | 基礎怯み値 |
| --- | --- |
| 近接 1 段 / 2 段 | 8 / 8 |
| 近接 3 段 | 22 |
| ダッシュ攻撃 | 12 |
| 射撃 1 発 | 2 |
| カウンターヒット | 段の値 ×2 |
| 見切り斬り（祝福） | 60 |
| 壁叩きつけ | 20（強靭を無視） |
| バースト | 60 |
| スキル | B-4 の表 |
| 状態異常の tick・連鎖雷・爆発（proc）・棘 | 0 |

例: スライム（耐性 25）に 3 段を当てると 8 + 8 + 22 = 38 で 3 段目で 1 回怯む。堅守 2 秒の間に次の 3 段を当てても (8 + 8 + 22) × 0.5 = 19 で怯まない。**同じ操作で固め続けられない**。

### D-3. 敵ごとの初期値（新規 `src/data/enemyCombat.ts` の `ENEMY_COMBAT`）

`src/data/enemies.ts` の `EnemyDef` には触れず、敵 key → 戦闘パラメータの別表にする（並列作業で `enemies.ts` を取り合わないため）。テストで全敵のエントリの存在を検査する。

| key | 名前 | 耐性 | 怯み秒 | 強靭 | 備考 |
| --- | --- | --- | --- | --- | --- |
| `slime` | スライム | 25 | 0.5 | 0.5 | |
| `eye` | 浮遊眼 | 20 | 0.6 | 1.0 | 射撃型は攻撃中も脆い |
| `boar` | 猪 | 60 | 0.6 | 0.25 | 突進中はほぼ怯まない。壁激突の自傷怯み 1.0 秒は現行どおり |
| `knight` | 盾騎士 | 50 | 0.6 | 0.5 | 正面の近接はブロック（ダメージ 0）だが怯み値の 50% は溜まる。盾で怯みが溢れたら「ガードブレイク」表示 |
| `bomber` | 爆弾ゴブリン | 25 | 0.5 | 1.0 | |
| `laserEye` | 光線眼 | 35 | 0.7 | 0.5 | チャージ中に怯ませるとレーザー中止（読みの報酬） |
| `golem` | ゴーレム | 120 | 0.8 | 0.25 | |
| `bat` | 蝙蝠 | 8 | 0.3 | 1.0 | 軽い。群れで来る |
| `wisp` | 鬼火 | - | - | - | **怯まない**（`immune: true`、霊体）。代わりに恐怖が 2 倍の時間効く |
| `kingSlime` | スライム王 | 300 | ダウン 2.0 | 0.5 | 空中（ジャンプ中）は強靭 0（怯み値が溜まらない） |
| `boneLord` | 骸骨卿 | 250 | ダウン 2.0 | 0.5 | テレポート中は強靭 0 |

エリート: 耐性 ×1.5。障壁のエリートは障壁が残っている間は怯み値が溜まらず、障壁破壊で怯み 0.6 秒（現行 `ELITE.shieldBreakStagger`）。迅速のエリートは耐性据え置き。

### D-4. 既存コードとの統合

- **`EnemyPhase` から `"stagger"` を外す**。怯みは状態異常 `stagger` が唯一の真実。`updateEnemies` / `updateBossEnemy` は switch の前に `if (isStaggered(e)) continue;` 相当で行動を止め、解除後は `chase`（`attackCooldown = attackInterval`）から再開する
- `phase === "stagger"` の参照箇所（`combat.ts` の `rollOutgoing` と `damageEnemy`、`elites.ts` の `canBlock` / `breakShield` / `showGuardBreak`、`enemies.ts` の猪の壁激突と stagger 分岐、`boss.ts` の stagger 分岐、`renderer.ts` の 3 か所）はすべて `isStaggered(e)` / `applyStagger(...)` に置き換える
- `HitOptions.stagger?: boolean` は移行期間だけ残し、`poise?: number` を足す。`stagger: true` かつ `poise` 未指定なら `POISE.legacyStagger` として扱う。段階 1 の終わりで `stagger` を削除
- `damageVsStaggeredMul` は名前も意味も維持（怯み中 = 状態異常 `stagger` あり。ボスのダウンも含む）
- 盾騎士: 正面の近接は現行どおりブロック。ブロック時に怯み値 ×0.5 を蓄積し、溢れたら GUARD BREAK 表示 + 怯み。カウンターヒット（`guardBreak`）は盾を無視してダメージが通る（確定怯みは無くなり、怯み値 ×2 が入る）
- ボスの `BOSS_STAGGER_MAX` は廃止し `ENEMY_COMBAT` の怯み秒に置き換える
- 影響するテスト（書き換え対象）: `system/elites.test.ts:74`、`system/enemies.test.ts:75`、`system/actionFeel.test.ts:97` / `:244`、`system/skills.test.ts:150` / `:445` / `:581`。「確定スタガー」を「怯み値が耐性を超えたら怯む」に直す

### D-5. プレイヤーの怯み（被弾硬直）

重い攻撃（D-3 と E-4 の表で「怯み」を持つもの）は、プレイヤーに状態異常「怯み」を付ける。効果: 移動 ×0.3、攻撃・スキル・ダッシュ不可。持続は E-4 の値 × `statusTakenMul`（体力で短くなる）。被弾後の無敵 0.5 秒の中に収まる長さにする（追撃で即死させない）。硬化・激昂の間は怯まない（E-6）。

### D-6. 怯みの拡張（2026-09-24、`src/system/poise.ts`、数値は `POISE`）

| 案 | 仕組み |
| --- | --- |
| 処刑 | 怯み中で HP 25% 以下の敵（ボス除く）に怯み値 20 以上の一撃（近接 3 段目など）→ 即死、マナ +10、半径 60 の敵に恐怖 0.5 秒。`damageEnemy` が HP を減らした後の `addPoise` で HP を 0 にするだけなので撃破処理は 1 回 |
| 背面の一撃 | 攻撃中（予備動作〜硬直）の敵を攻撃の向きの背後（内積 < −0.3）から殴ると、堅守を無視して怯み値 ×1.25。強靭は残す（スライム王の空中の強靭 0 を崩さない） |
| 崩勢・腐食・萎縮 | 受ける怯み値 ×1.3 / +8% × スタック / 強靭を無視（E-6・E-7） |
| 崩落 | 崩勢中の怯みは ×1.5、解けても堅守が付かない |
| 怯みの伝播 | 怯んだ瞬間、半径 40 の敵に怯み値 15（伝播先からは伝播しない） |
| 怒気・激昂 | プレイヤーが与える怯み値に掛かる（`playerPoiseDealtMul`） |

---

## E. 状態異常の統一システム

### E-1. 型

初回実装時（0.0.3α）の 13 種。2026-09-24 に E-6 の 21 種が加わり、`core/status.ts` の `STATUS_KINDS` は計 34 種。

```ts
// 新規 src/core/status.ts（型と一覧だけ。ロジックは system/statusEffects.ts）
export const STATUS_KINDS = [
  "burn", "chill", "freeze", "shock", "paralyze", "poison", "bleed",
  "vulnerable", "weaken", "fear", "silence", "stagger", "guarded",
] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/** 付けた側。player 由来だけが装備・祝福のフック（野火・氷砕など）を起こす */
export type StatusSource = "player" | "enemy" | "env";

export interface StatusEffect {
  kind: StatusKind;
  stacks: number;
  /** 残り秒 */
  time: number;
  /** HUD の減り方用: 付与・延長時の持続 */
  maxTime: number;
  /** 種類ごとに解釈（burn = dps、poison = 最大 HP 割合 / 秒、bleed = 10px あたりダメージ …） */
  potency: number;
  source: StatusSource;
  /** DoT の端数（既存 BurnEffect.acc と同じ） */
  acc: number;
  /** 周期効果（感電の連鎖）のタイマー */
  tick: number;
}

export interface StatusBag {
  effects: StatusEffect[];
  /** 種類 → 免疫の残り秒 */
  immune: Partial<Record<StatusKind, number>>;
  /** on-hit 付与の内部 CD（既存 EnemyEffects.onHitCooldown） */
  procIcd: number;
  /** 拘束上限: 直近 ccWindow 秒に入った行動停止の合計秒 */
  ccSpent: number;
  ccWindowLeft: number;
}

export interface StatusApply {
  kind: StatusKind;
  stacks: number;
  duration: number;
  potency: number;
}
```

公開関数（`src/system/statusEffects.ts`）:
- `applyStatus(state, target: StatusTarget, apply: StatusApply, source: StatusSource): boolean`（免疫・拘束上限・スタック規則・相互作用を 1 か所で処理）
- `hasStatus(bag, kind)` / `statusStacks(bag, kind)` / `removeStatus(state, target, kind)`
- `updateStatusEffects(state, dt)`（敵とプレイヤーの両方を回す）
- `StatusTarget = { kind: "enemy"; enemy: Enemy } | { kind: "player" }`
- 既存の `applyBurn` / `applyChill` / `chillFactor` / `chainLightning` / `explodeAt` / `enemiesInRadius` は名前を残して中身を移す（呼び出し側の変更を減らす）

### E-2. 13 種の定義（`STATUS` 定数）

| kind | 表記 | 対象 | 効果 | 持続 | スタック規則 | 免疫・上限 |
| --- | --- | --- | --- | --- | --- | --- |
| `burn` | 燃焼 | 敵 / 自 | potency dps の継続ダメージ | 3 | 強い dps を採用、持続は延長（現行） | - |
| `chill` | 冷気 | 敵 / 自 | 移動と行動の進行が 0.12 × スタック遅くなる（既存 `chillSlow` があればその値を下限に） | 2 | 付与ごとに +1、最大 5（自は 3）、持続は更新 | 敵は 5 で凍結へ |
| `freeze` | 凍結 | 敵 | 行動停止 1.2 秒。次の被弾で「砕き」: 与ダメ ×1.5、怯み値 +20、凍結は解除 | 1.2 | 重ねない | 解除後 冷気免疫 3 秒。ボスは凍結しない（冷気の遅さ上限 0.4） |
| `shock` | 感電 | 敵 | 0.6 秒ごとに半径 50 の別の敵 1 体へ potency の連鎖ダメージ | 2.5 | +1、最大 3、持続更新 | 3 で麻痺へ |
| `paralyze` | 麻痺 | 敵 | 行動停止 0.5 秒（ボス 0.2）。予備動作は取り消さず一時停止 | 0.5 | 重ねない | 解除後 感電免疫 3 秒 |
| `poison` | 毒 | 敵 / 自 | 最大 HP の 1% × スタック / 秒（ボス 0.3%、自 0.5%） | 5 | +1、最大 5（自は 3）、付与で全スタックの持続更新 | - |
| `bleed` | 出血 | 敵 / 自 | 移動 10px ごとに potency × スタックのダメージ（ノックバック・ダッシュの移動も数える） | 4 | +1、最大 3 | - |
| `vulnerable` | 脆弱 | 敵 / 自 | 受けるダメージ ×1.2 | 4 | 重ねない、持続延長 | - |
| `weaken` | 弱体 | 敵 / 自 | 与えるダメージ ×0.75 | 4 | 重ねない、持続延長 | - |
| `fear` | 恐怖 | 敵 | プレイヤーから逃げ、攻撃しない。予備動作中なら取り消し | 2 | 重ねない | 解除後 恐怖免疫 6 秒。ボスは無効。鬼火は 2 倍の時間 |
| `silence` | 沈黙 | 敵 / 自 | 敵: 射撃・レーザー・爆弾・ボスの弾幕を出せない（接触・突進は出せる）。自: スキル不可 | 敵 3 / 自 1.5 | 重ねない | - |
| `stagger` | 怯み | 敵 / 自 | D 章 | D-3 / E-4 | 重ねない | 解除後 堅守 |
| `guarded` | 堅守 | 敵 | 受ける怯み値 ×0.5（ボス ×0.25） | 2（ボス 6） | 重ねない | - |

**拘束上限**: 行動停止系（怯み・凍結・麻痺・恐怖）は、直近 3 秒（`STATUS.ccWindow`）に合計 2.0 秒（`STATUS.ccBudget`）まで。超える付与は持続を切り詰める。組み合わせの連打で敵を永久に止めないため。

プレイヤーに付かないもの: 凍結・麻痺・恐怖（操作を奪いすぎる）。

### E-3. 相互作用

| 組み合わせ | 結果 |
| --- | --- |
| 燃焼中に冷気 / 冷気中に燃焼 | 両方消える。「蒸発」: 燃焼の残りダメージ（dps × 残り秒）の 50% を即時に与える |
| 凍結中に燃焼 | 凍結が解ける（砕きなし）。燃焼は付く |
| 感電 + 冷気 | 感電の周期ごとに冷気 +1（凍結が早まる） |
| 毒 + 出血 | 毒がある間、出血ダメージ ×1.5 |
| 脆弱 + 怯み | 乗算（×1.2 × `damageVsStaggeredMul`） |
| 恐怖中に怯み | 怯みが優先。恐怖の残り時間は止まる |
| 沈黙を予備動作中の光線眼・浮遊眼・爆弾ゴブリンに | 予備動作を取り消す |
| 凍結中に被弾 | 砕き（E-2） |

### E-4. 敵からプレイヤーへの状態異常

| 敵 | 攻撃 | 付与 |
| --- | --- | --- |
| スライム | 接触（深度 4 以上） | 毒 1（5 秒） |
| 浮遊眼 | 弾（深度 5 以上） | 沈黙 1.2 秒（スキルを封じる。スキル主体への圧力） |
| 猪 | 突進 | 出血 2、怯み 0.35 秒 |
| 盾騎士 | 斬り | 怯み 0.3 秒 |
| 爆弾ゴブリン | 爆風 | 脆弱 3 秒 |
| 光線眼 | レーザー | 燃焼 4 dps × 2 秒 |
| ゴーレム | 衝撃波 | 怯み 0.4 秒 |
| 蝙蝠 | 噛み | 出血 1 |
| 鬼火 | 接触 | 燃焼 3 dps × 2 秒（既存の `playerBurn` ハザードを状態異常に置き換える） |
| スライム王 | 着地の衝撃波 | 怯み 0.4 秒。分裂した子は接触で毒 1 |
| 骸骨卿 | 弾 | 弱体 3 秒 |

持続はすべて × `statusTakenMul`（体力の派生）。表は `ENEMY_COMBAT[key].inflicts: StatusApply[]` に持つ。

**HUD**:
- プレイヤー: HP バーの上に 1 行、8×8 の枠に 1 文字（燃 / 冷 / 毒 / 血 / 脆 / 弱 / 沈 / 怯）、右下にスタック数、枠の下線が残り時間で縮む。文字は `drawText`（不変条件 5）
- 敵: HP バーの上に色の点（種類ごとの色）。エリートとボスだけ HP バーの下に怯みゲージ（細い黄色、蓄積 / 耐性）。ボスの HP バーにも同じゲージ
- 新規 `src/render/statusUi.ts`

### E-5. 付与の経路

| 経路 | 仕組み |
| --- | --- |
| 装備の性質（既存） | `burnChance` / `burnDps` / `chillChance` / `chillSlow` / `shockChance` / `shockDamage` は残す。`applyOnHitStatus` がそれぞれ燃焼 1 / 冷気 1 / 即時の連鎖雷 + 感電 1 に変換する |
| 装備の性質（新規） | 要追加: `PlayerStats.statusProcs: StatusProc[]`（下記）。新性質: 出血（紅）、毒（冥）、脆弱（冥）、弱体（翠）、沈黙（蒼）、恐怖（金、会心時のみ） |
| 霊力 | すべてのプレイヤー由来の potency × `statusPotencyMul` |
| スキル | 要追加: `SkillDef.applies?: readonly StatusApply[]`（B-4 の「付与」列）。命中した敵に `applyStatus` |
| 祝福（既存） | 野火（燃焼の拡散）・氷砕（冷気の死亡時破片）・氷結封鎖・業火の心は `applyStatus` / `hasStatus` 経由に書き換える |
| 祝福（新規、L7） | 疫病 `plague`: 毒の敵が死ぬと周囲の敵に毒スタックを引き継ぐ / 血煙 `bloodMist`: 出血の敵を倒すと自分の出血が消え HP 3 回復 / 崩し `crumble`: 怯ませた敵に脆弱 / 凍て刺し `frostPierce`: 砕きで周囲に冷気 2 |
| トリガー文法 | 既存の `burnNearby` / `freezeNearby` を `applyStatus` 経由にする。新 effect は段階 3 以降 |

```ts
export interface StatusProc {
  kind: StatusKind;
  /** 0..1 */
  chance: number;
  stacks: number;
  duration: number;
  potency: number;
  /** どの攻撃で判定するか */
  on: "melee" | "ranged" | "skill" | "any";
  /** crit: 会心時のみ */
  requiresCrit?: boolean;
}
```

on-hit の判定は既存どおり敵ごとに `STATUS.onHitIcd`（0.2 秒）に 1 回（`StatusBag.procIcd`）。

### E-6. 追加の状態異常（2026-09-24、`docs/ideas/status-and-terrain.md` 1・5 章）

数値は `STATUS.<kind>`。付与はすべて `applyStatus` を通る（装備の `statusProcs`・スキルの `applies`・敵の `inflicts`・地形は kind を指定するだけでよい）。反応と昇華は `src/system/statusReactions.ts`。

| kind | 表記 | 対象 | 効果 | 持続 | スタック |
| --- | --- | --- | --- | --- | --- |
| `wet` | 濡れ | 敵 / 自 | 燃焼が付かない（付与時に濡れ 1 を消費）。感電の連鎖半径 ×1.5 | 5 | +1、最大 3。3 で浸水 |
| `oiled` | 油膜 | 敵 / 自 | 燃焼か感電が入ると炎上（自は油膜が消えて燃焼だけ） | 6 | 重ねない |
| `corrode` | 腐食 | 敵 / 自 | 敵: 受ける怯み値 +8% × スタック。自: 被ダメ +3% × スタック | 6 | +1、最大 5 |
| `brand` | 烙印 | 敵 | 射撃・スキルの命中で全スタックを起爆（1 スタック 6 ダメージ + 怯み値 6、怯み中 ×1.5） | 4 | +1、最大 5 |
| `broken` | 崩勢 | 敵 | 受ける怯み値 ×1.3。付いた瞬間に堅守を消す | 3 | 重ねない |
| `doom` | 宣告 | 敵 | 付与中に減った HP の 30%（脆弱中 50%）を切れた瞬間にまとめて与える | 4 | 付け直さない |
| `siphon` | 吸魔 | 敵 | この敵への命中でマナ +1（沈黙中 ×2）。倒すと残り秒 × 2 のマナ | 5 | 重ねない |
| `hue` | 彩痕 | 敵 | potency = 色番号（`TRAIT_COLORS`）。共鳴と同じ色なら被ダメ ×1.15。対応する状態異常で色爆 | 6 | 色を上書き |
| `haste` | 加速 | 自 | 移動 ×1.2。攻撃が当たるたびに +0.5 秒（上限 6） | 3 | 重ねない |
| `harden` | 硬化 | 自 | 被ダメ ×0.8、敵の攻撃で怯まない、移動 ×0.85 | 2 | 重ねない |
| `wrath` | 怒気 | 自 | 与える怯み値 +10% × スタック。付いている間は被弾で +1、怯むと +2 | 6 | +1、最大 5。5 で激昂 |
| `charged` | 帯電 | 自 | 近接の命中 1 回ごとに 1 消費して連鎖雷 + 感電 1 | 5 | 回数を加算、最大 6 |

良い状態（加速・硬化・怒気・激昂・帯電）は敵に付かず、体力の `statusTakenMul` で縮まない。HUD では緑の枠で出す。

**昇華**（ボスは昇華しない。元の状態に上乗せされる）:

| 昇華 | 条件 | 効果 |
| --- | --- | --- |
| 灼熱 `scorch` | 燃焼 5 スタック（燃焼は付与ごとに +1、dps は強い方を採用のまま） | 燃焼 dps ×2、1 秒ごとに半径 40 の敵へ燃焼、濡れで消えない |
| 炎上 `blaze` | 油膜 + 燃焼 | dps = 燃焼 ×2（下限 4）、1 秒ごとに半径 40 の油膜の敵と足元の油・草へ燃え移る |
| 猛毒 `venom` | 毒 5 スタック | 毒 ×1.5、死ぬと毒沼を残す |
| 大出血 `hemorrhage` | 出血 3 スタック | 止まっていても毎秒 potency × スタック × 3 |
| 氷棺 `encase` | 凍結中に冷気が 3 回入る（以前は blocked） | 凍結は延びない。砕くと半径 50 に破片（最大 HP の 15%、上限 60、怯み値 15）。燃焼で解けると水たまり |
| 露呈 `exposed` | 脆弱中に脆弱を 3 回付け直す | 脆弱込みで被ダメ ×1.4、堅守が付かない |
| 無力 `enfeeble` | 弱体中に弱体を 3 回付け直す | 与ダメ ×0.5 |
| 浸水 `soaked` | 濡れ 3 | 遅さ 0.3（冷気と合算）、燃焼が一切付かない、感電が入ると即麻痺 |
| 激昂 `fury` | 怒気 5（自） | 怒気を使い切る。怯まない、与える怯み値 ×1.5、与ダメ ×1.15、被ダメ ×1.2 |

### E-7. 反応の追加（出す側 = 消費される状態 / 食う側 = 反応を起こして残る状態）

同じ反応は同じ対象で `STATUS.reactionIcd`（0.5 秒）に 1 回（`StatusBag.reactionIcd`）。起きた反応は `StatusBag.lastReaction` に残り、浮き文字で名前が出る。

| 反応 | 出す側 | 食う側 | 結果 |
| --- | --- | --- | --- |
| 蒸気 | 濡れ 1 | 燃焼 | 燃焼は付かない。プレイヤー由来なら半径 40 の敵に弱体 2 秒 |
| 急冷 | 濡れ | 冷気 | 冷気 +2。濡れ 3 なら冷気を上限まで（敵は即凍結） |
| 拡散 | 濡れ 1 | 感電 | 半径 ×2・対象 +2 の連鎖雷。濡れた敵を優先 |
| 炎上 | 油膜 | 燃焼 | 炎上（昇華表） |
| 引火 | - | 油膜 + 感電 | 燃焼 3 dps が入り、そのまま炎上へ |
| 毒霧 | 毒 | 燃焼 | 敵のみ。足元に毒沼、半径 50 の敵に毒 1 |
| 砕血 | 出血 | 凍結の砕き | 出血スタック × potency × 残り秒 × 4 を即時、近くの 1 体へ出血 1 |
| 焼灼 | 出血 | 燃焼 | 出血を消し、スタック × potency × 残り秒 × 3 を即時（自は ×0.25） |
| 溶解 | - | 腐食 + 毒 | 常時: 毒の上限 + 腐食スタック |
| 裂傷 | - | 腐食 + 出血 | 常時: 出血の上限 +2 |
| 崩落 | 崩勢 | 怯み | 怯み ×1.5、解けても堅守なし（崩勢は消える） |
| 暴露 | - | 脆弱 + 宣告 | 宣告の割合 30% → 50% |
| 萎縮 | - | 弱体 + 脆弱 | 常時: 強靭が効かない |
| 凍毒 | - | 冷気 + 毒 | 常時: 冷気がある間は毒の残り時間が減らない |
| 恐慌 | - | 恐怖 + 出血 | 常時: 出血 ×2 |
| 烙爆 | 烙印 | 射撃・スキルの命中 | 烙印の起爆（E-6） |
| 融解 | 氷棺 | 燃焼 | 凍結が解け、足元に水たまり |
| 逆上 | - | 怒気 + 怯み（自） | 怒気 +2 |
| 放電 | - | 帯電 + 濡れ（自） | 連鎖半径 ×2、自分に 1 ダメージ |
| 氷鎧 | - | 硬化 + 冷気（自） | 冷気 1 スタックごとに被ダメ −5% |
| 色爆 | 彩痕 | 色に対応する状態異常（紅 = 燃焼 / 蒼 = 冷気 / 翠 = 毒 / 金 = 感電 / 冥 = 脆弱） | 紅 = 燃焼の残りを即時 / 蒼 = 冷気 +2 / 翠 = HP 3 回復 / 金 = 麻痺 / 冥 = 宣告 |
| 魔断 | - | 吸魔 + 沈黙 | 回収 ×2 |
| 奮起 | 冷気 | 加速（自） | 冷気は付かず、加速 +1 秒 |

on-hit の最中（`applyOnHitStatus`）と砕きの最中に同じ敵へ入る反応ダメージは `StatusBag.queued` に積み、次のステップの `updateStatusEffects` で与える（外側の `damageEnemy` と撃破処理が二重に走るのを避ける）。

### E-8. 地形の層（`src/core/terrain.ts` / `src/system/terrain.ts`、数値は `TERRAIN`）

`GameState.terrain`（タイル index → 地形 + 残り秒）。プレイヤーと敵の両方に 0.5 秒ごとに効果を入れる（`applyStatus(..., "env")`）。フロアの最初のステップで `planTerrain`（`src/map/generator.ts`）が深度に応じて少量置く（開始部屋と最後の部屋を除く）。描画は `src/render/terrainUi.ts`。

| 地形 | 効果 | 変化 | 自然配置 |
| --- | --- | --- | --- |
| 水たまり | 濡れ +1 | 冷えた者が立つと氷床に。炎は置けない | 深度 1〜 |
| 油 | 油膜 | 火がつくと炎（3 秒）になり、0.3 秒で隣の油・草へ | 深度 2〜 |
| 溶岩 | 燃焼 2 dps + 即時 1（敵は 3）。ダッシュ中は無傷 | 消えない。上に他の地形を置けない | 深度 5〜 |
| 毒沼 | 毒 1、3 回に 1 回腐食 1 | 毒霧・猛毒の死で置かれる | 深度 3〜 |
| 氷床 | 4 回に 1 回冷気 1。プレイヤーは慣性で滑る | 火で水たまりに | 深度 3〜 |
| 草むら | なし | 火がつくと炎（2 秒）になり、0.8 秒で隣へ | 深度 1〜 |
| 炎 | 燃焼 3 dps | 時間で消える | - |

他レーン向け API: `placeTerrain(state, x, y, kind, radius, duration?)`（px。省略時の持続は `TERRAIN.placedDuration`）、`igniteTerrainAt(state, x, y, radius)`、`terrainAt(state, x, y)`。

### E-9. 状態異常を参照する語彙（`src/system/statusEffects.ts`）

| 関数 | 数えるもの |
| --- | --- |
| `statusCount(bag)` | 異常数: 悪い状態の種類数（怯み・堅守・良い状態は除く。上限 5） |
| `totalStacks(bag)` | 総スタック（上限 15） |
| `goodStatusCount(bag)` | 良い状態の数（上限 4） |
| `statusTimeLeft(bag, kind?)` | 指定した種類の残り秒、省略で悪い状態の最長 |
| `lastExpired(state, bag)` | 直前に消えた状態異常 `{ kind, cause: "expire" \| "remove" \| "consume", tick }`（1 秒以内） |

倍率の読み出し（combat.ts から呼ぶ想定）: `enemyStatusTakenMul(state, e)`（露呈・彩痕）、`playerStatusTakenMul(state)`（硬化・氷鎧・激昂・腐食）、`playerStatusOutgoingMul(state)`（激昂）、`playerPoiseDealtMul(state)`（怒気・激昂。`addPoise` が掛ける）、`onPlayerHurtStatus(state)`（被弾で怒気 +1）。

---

## F. 実装計画

### F-1. 型の変更

```ts
// src/loot/types.ts
export const ATTR_KEYS = ["str", "dex", "vit", "mnd", "spi"] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];
export type Attributes = Record<AttrKey, number>;

export interface PlayerStats {
  // …既存フィールドはすべて残す…
  /** 装備・共鳴・祝福・ラン内振り分けの生の合計（逓減前）。基礎値を含む */
  attributes: Attributes;
  /** 逓減後の実効値。deriveAttributes が埋める。計算はこちらを使う */
  attributesEff: Attributes;
  maxMana: number;
  /** 毎秒 */
  manaRegen: number;
  manaGainMul: number;
  skillDamageMul: number;
  poiseDamageMul: number;
  statusPotencyMul: number;
  /** プレイヤーが受ける状態異常の持続倍率 */
  statusTakenMul: number;
  statusProcs: StatusProc[];
}
// DEFAULT_STATS: attributes / attributesEff は全 5、maxMana 80、manaRegen 1.2（MANA.baseMax / baseRegen）、他の倍率は 1、statusProcs []
```

```ts
// src/core/state.ts
export interface Player {
  // …既存…
  mana: number;
  status: StatusBag;
}
export type EnemyPhase = "idle" | "chase" | "windup" | "strike" | "recover" | "spawning"; // "stagger" を削除（L3）
export interface PoiseState {
  /** 深度・エリート・ボスの成長を掛けた現在の耐性 */
  max: number;
  damage: number;
  /** 最後に怯み値を受けてからの秒 */
  sinceHit: number;
  /** ボスのダウン回数 */
  downs: number;
}
export interface Enemy {
  // …既存… effects: EnemyEffects は L3 で削除
  status: StatusBag;
  poise: PoiseState;
}
export interface GameState {
  // …既存…
  /** ラン内のステータス振り分け */
  runAttributes: { alloc: Attributes; unspent: number };
}
```

```ts
// src/data/enemyCombat.ts（新規）
export interface EnemyCombatDef {
  /** 未指定 = 怯まない */
  poise?: number;
  staggerTime: number;
  superArmorMul: number;
  inflicts: readonly StatusApply[];
  /** 怯み・恐怖などの個別免疫 */
  immune?: readonly StatusKind[];
}
export const ENEMY_COMBAT: Readonly<Record<string, EnemyCombatDef>>;
```

```ts
// src/skills/types.ts
export type SkillResource = "mana" | "cooldown";
export interface SkillDef {
  // …既存… cooldown / charges は CD 型でだけ使う
  resource: SkillResource;
  manaCost: number;
  minInterval: number;
  poise: number;
  applies?: readonly StatusApply[];
}
export interface CastParams {
  // cooldownMul → burdenMul に改名
  burdenMul: number;
  /** マナ型の最低間隔倍率（多重） */
  intervalMul: number;
  /** 連鎖（マナ型）: 撃破でコストのこの割合を返す。0 なら無し */
  killManaRefund: number;
}
export interface SkillSlotState { /* …既存… */ intervalLeft: number; }
export interface SkillRunState { /* …既存… */ gcd: number; manaFlash: number; }
```

```ts
// src/core/input.ts
export interface FrameInput {
  // …既存…
  skill3Pressed: boolean; skill4Pressed: boolean;
  skill3Held: boolean; skill4Held: boolean;
}
// src/core/replay.ts: ビット列に 4 つ追加、REPLAY_VERSION = 3
```

```ts
// src/system/combat.ts
export interface HitOptions {
  // …既存…
  /** @deprecated 移行期間のみ。poise 未指定なら POISE.legacyStagger として扱う */
  stagger?: boolean;
  /** 最終の怯み値（poiseDamageMul 込み）。0 / 未指定は怯み値なし */
  poise?: number;
  /** 壁叩きつけなど: 強靭を無視 */
  ignoreSuperArmor?: boolean;
}
```

### F-2. 作業レーン

**段階 0（統合役、先行 0.5 日）: 契約コミット**
- 上の型をすべて追加（既存フィールドは残し、新フィールドは中立の既定値）。`Enemy.effects` はまだ消さない
- `src/data/tuning.ts` に `ATTR` / `MANA` / `POISE` と `STATUS` の追加分、`PLAYER.dash.invulnTime` を定数として追加（ロジックはまだ読まない）
- 新規 `src/system/attributes.ts`（`effectiveAttr` / `scaled` / `deriveAttributes` / `addRunAttributes` の実装とテスト）と `src/system/mana.ts`（`gainMana` / `canAfford` / `spendMana` / `tickMana` の実装とテスト）。小さく、他の全レーンが依存するので先に本物を書く
- `applyStats` に `addRunAttributes` → `deriveAttributes` の呼び出しを入れる。基礎値なら全派生が 0 なので挙動は変わらない
- レーンを跨いで呼ばれる関数の口だけ先に入れる: `statusEffects.ts` に `applyStatus`（段階 0 では何もせず false）と `hasStatus`（本実装）、`combat.ts` の `rollOutgoing` に第 5 引数 `opts?: { skill?: boolean }`（段階 0 では読まない）と `HitOptions.poise` / `ignoreSuperArmor`（段階 0 では読まない）、`PlayerStats.bulletCut`（既定 0）
- `FrameInput` の 4 フィールドと `replay.ts`、`REPLAY_VERSION = 3`
- 完了条件: `npm run check` 通過、リプレイテストと QA 縮小版が現行と同じ結果

**段階 1（並列 4 レーン）**。全レーンとも `npm run check` を単独で通すこと。共有ファイル（`core/state.ts` / `data/tuning.ts` / `render/renderer.ts` / `main.ts`）は最小の Edit のみ。

| レーン | 所有ファイル | 中身 | 完了条件 | テスト観点 |
| --- | --- | --- | --- | --- |
| **L1 ステータス** | `src/loot/stats.ts` / `src/loot/resonance.ts` / `src/system/attributes.ts`（段階 0 以降）/ `src/system/floor.ts` / 新規 `src/ui/attributeAlloc.ts` / 新規 `src/render/attributeUi.ts` / 新規 `src/render/manaHud.ts` / `src/render/boonUi.ts` | 共鳴のステータス加算、ラン内振り分け（階層到達 +1、ボス +2、祝福 3 択の直後に 5 択。キーは スキル 1〜4 + 攻撃）、装備画面のステータス表示（生値と実効値、何が伸びるかの一言）、マナバー | 基礎値で全派生 0。振り分けで `state.stats` が変わる。マナバーが表示される | 逓減の境界（20 / 40）、共鳴 3 種の加算、振り分けの保存がラン内に限られる、決定性（振り分け入力を含むリプレイ） |
| **L2 スキル** | `src/skills/*`（`types.ts` / `data.ts` / `generator.ts` / `hit.ts` / `placed.ts` / `persistence.ts`）/ `src/system/skills.ts` / `src/render/skillHud.ts` / `src/core/input.ts` / `src/core/gamepad.ts` / `src/ui/inventory.ts`・`src/render/inventoryUi.ts` のスキルタブ部分 / `src/skills/skills.test.ts` | B 章すべて: マナ型 / CD 型、GCD、最低間隔、マナ不足の不発、4 スロット、LB シフト、`burdenMul` 改名、刻印符の読み替え、`Scaling` 化、`HitOptions.poise` と `rollOutgoing` の `skill: true` を渡す、`SkillDef.applies` の呼び出し（`applyStatus` は L3 が入るまで何もしない） | 14 スキルが B-4 の表どおりの型・コスト・間隔。4 スロット入力が動く。基礎値で威力が現行と一致 | マナ不足で何も消費しない、GCD 0.15 の間は発動しない、多重の読み替え、連鎖のマナ返却、溜めの支払いタイミング、旧 2 スロットの loadout が 4 に埋まる、`FORBIDDEN` 相性表の更新 |
| **L3 怯み・状態異常** | `src/system/statusEffects.ts` / 新規 `src/system/poise.ts` / 新規 `src/data/enemyCombat.ts` / `src/system/combat.ts` / `src/system/enemies.ts` / `src/system/boss.ts` / `src/system/elites.ts` / `src/system/projectiles.ts` / `src/system/hazards.ts` / 新規 `src/render/statusUi.ts` / `renderer.ts` の stagger 参照 3 か所 | D・E 章すべて: 怯みの蓄積・減衰・堅守・ダウン・強靭、非怯みノックバック ×0.35、`EnemyPhase` から stagger 削除、`StatusBag` への移行（`Enemy.effects` 削除）、13 種と相互作用、拘束上限、敵 → プレイヤーの付与、`rollOutgoing` の弱体・`skill` 引数、`damageEnemy` の脆弱・砕き、射撃命中と撃破のマナ回収呼び出し、JUST 回避のマナ +15 とスロー 0.35、被弾後無敵 0.5、リゲイン 0.5 | 確定スタガーがコードから消える。D-4 の既存テストを怯み値ベースに書き換えて通る | 3 段で怯む / 堅守中は怯まない / 減衰、ボスのダウンと耐性成長、盾のガードブレイク、各状態異常のスタックと免疫、相互作用 8 行、拘束上限、敵 → 自の付与と体力による短縮、決定性 |
| **L4 無効化と手触り** | `src/system/player.ts` / `src/system/boons.ts` / `src/system/triggers.ts` / `src/data/enemies.ts` | C 章: ダッシュ無敵 0.10・CD 0.45・grace 0、JUST カウンターを祝福「見切り斬り」へ、弾返しを祝福「弾返し」へ（`parryCharge` を置き換え）、デフォルトの弾消し削除（性質の判定フックだけ用意: `stats.bulletCut > 0` なら消す）、カウンターを怯み値 ×2 へ、バースト無敵 0.15、トリガー無敵の上限、敵の `attackInterval` / `recover` ×0.8、近接・射撃・バーストの `Scaling` 化と怯み値、近接命中のマナ回収呼び出し、プレイヤーの怯み（移動 ×0.3・行動不可） | デフォルトで弾を斬れない・JUST カウンターが出ない。祝福を取ると出る | ダッシュ 0.10 秒後は被弾する、JUST の窓、祝福 2 種の有無で挙動が切り替わる、近接命中でマナが増える、プレイヤー怯み中は行動不可 |

`bulletCut` は `PlayerStats` に要追加（段階 0 で型だけ入れる。値を入れる性質は L5）。
`data/tuning.ts` の値の変更は、その定数を読むファイルの所有レーンが最小の Edit で行う（例: `PLAYER.hurtInvuln` は `combat.ts` を持つ L3、`PLAYER.dash` は L4）。

**段階 1 の統合順**（各コミットで遊べる状態）: L3 → L4 → L1 → L2。L3 と L4 だけでも「スキルは CD 制のまま、怯みと難易度だけ新しい」状態で遊べる。L2 が入ってスキル主体になる。

**段階 2（並列 3 レーン）**

| レーン | 所有ファイル | 中身 | 完了条件 | テスト観点 |
| --- | --- | --- | --- | --- |
| **L5 装備の追随** | `src/loot/affixes.ts` / `src/loot/colors.ts` / `src/loot/describe.ts` / `src/loot/named.ts` / `src/loot/triggers.ts` / `src/system/keystones.ts` | 属性の性質 5 種と変換 5 種、`statusProcs` を持つ性質 6 種、「弾斬り」、誓約 2 種（「過負荷」`ks_overdraw`: マナ不足を HP で払う 1 マナ = 0.5 HP、スキル威力 −10% /「静寂の誓い」`ks_silentVow`: 通常攻撃でマナが戻らない、自然回復 ×3、スキル威力 +30%。排他グループ `mana`）、トリガーの invuln 生成上限、ツールチップの動詞 | 新性質が生成・集計・表示される | 期待値曲線、色、`computeStats` での加算、誓約の排他、describe の文言 |
| **L6 QA** | `src/qa/bot.ts` / `src/qa/simulation.test.ts` / `src/qa/report.md` | bot が 4 スロットをマナを見て撃つ、振り分けを選ぶ、パッド LB シフトは不要。計測: スキル由来与ダメ比率、1 対 1 被弾数、深度別到達率、マナ不足の不発回数 | `npm run qa:full` が完走し report に新指標 | 指標が C-2 / B-7 の目標範囲に入るか（外れたら数値を tuning で直す） |
| **L7 敵と祝福の追加** | `src/system/enemies.ts` / `src/system/boss.ts` / `src/system/boons.ts`（段階 1 の後なので競合しない） | 連携ずらし、深度による予備動作短縮（60% 下限のクランプ）、連続攻撃 5 種、祝福 A-5 の 3 種と E-5 の 4 種 | 各敵の連続攻撃に予備動作がある | 予備動作が基準の 60% を下回らない、連続攻撃の 2 撃目にも予備動作、祝福のルール |

**段階 3（統合役）**: B-7 の近接・射撃の基礎値 −20%、`docs/GLOSSARY.md`（1 章の用語、「スタガー」→「怯み」）、`docs/DESIGN_PRINCIPLES.md` 4 の例示、`IDEAS.md` の現状、`docs/ARCHITECTURE.md` の型の関係、`CHANGELOG.md`。

### F-3. 全体の完了条件

1. `npm run check` 通過、リプレイテスト（`core/replay.test.ts`）が新しい版で通る
2. `rg '"stagger"' src` で `EnemyPhase` と `HitOptions.stagger` の参照が 0（状態異常 kind の `"stagger"` を除く）
3. 基礎値のステータスで、全攻撃・全スキルの威力が段階 0 前と一致するテスト（`attributes.test.ts` に表で持つ）
4. QA フル: 深度 1〜3 の到達率が現行比 −10〜−20%、1 対 1 被弾が 60 秒で 1〜3 回、スキル由来与ダメ 55〜65%
