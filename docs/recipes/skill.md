# レシピ: スキル / 刻印符

- スキル石: 手書きの発動処理が要るものだけ（45 種。段取り 7c で行為の列で書けるものは技へ束ねた）。行為の列で書けるなら下の「技（共通技）」を先に検討する。`skills/types.ts` の `SKILL_KEYS` → `skills/data.ts` の `SKILL_DEFS`（大拡張分は `skills/defs.ts`、第 2 弾は `defs2.ts`、変身は `defs3.ts` に書いて `SKILL_DEFS` に混ぜる）
  - `resource: "mana" | "cooldown"` を選ぶ。気力型は `manaCost` を消費（`cooldown` は 0、チャージは常に 1）、再使用型は `manaCost` 0 で既存の `cooldown` / `charges` を使う。どちらも `minInterval`（スロットごとの連打下限）がかかる。全スロット共通の待ち（旧 GCD）は無く、同じステップに押した複数スロットは 1→4 の順にすべて発動する。本動作（`active`）を持つ近接・移動系は `exclusiveGroup: "body"` で互いに排他、それ以外（設置・強化・射撃の一部）は本動作中でも並行して撃てる
  - 威力は `Scaling`（`{ base, str?, dex?, vit?, mnd?, spi? }`）で書く。参照するステータスは行動ごとに自由（1 種・複数・全部・0 種 = 基礎値だけ。ジャンルで縛らない）。`base` はステータス基礎値（各 5）のとき狙いの威力になるよう逆算する（`docs/COMBAT_DESIGN.md` A-6 / A-10）。呼び出し側で `system/attributes.ts` の `scaled(stats, scaling)` を通す
  - 怯み値・状態異常の効果量も係数を持てる（数値ブロックの `poiseRatio`、`StatusApply.ratio`。基礎値での値 + 係数 × (実効値 − 5)、`withRatio`）。ステータスそのものが行動を伸ばす固定の派生は作らない（A-10）
  - 参照先の選び方・例外（0 種 / 3 種以上）・数値の目安・表示は `docs/STATS_AND_SCALING.md` に従う
  - `poise`（1 ヒットの基礎怯み値。最終値は × `poiseDamageMul`）を必ず入れる。状態異常を付けるなら `applies?: readonly StatusApply[]`（下記「状態異常」）
  - `SKILL` 定数（共通パラメータ）→ `system/skills.ts` の `castSlot` に発動処理（設置物なら `skills/placed.ts`）。発動処理の実体は近接型 `skills/actions.ts` / 弾型 `skills/shots.ts` / 設置・召喚型 `skills/summons.ts`、当たり判定の幾何は `skills/geom.ts`。数値は `skills/tuning.ts` に置き `SKILL.<key>` 経由で読む → `render/skillHud.ts` / `render/manaHud.ts` / `renderer.ts` の表現
  - 直前に撃った別のスキルを受けて効果が変わる「連携」を足すなら `skills/combos.ts` の `COMBOS`（発動元 → 受け側のキーで引く。受付秒は `SkillRunState.lastCast`）
- 刻印符（30。ラン内だけ）: `skills/types.ts` の `BASE_MODIFIER_KEYS`（変形）/ `EXTRA_MODIFIER_KEYS`（循環）/ `WAVE2_MODIFIER_KEYS`（行為の列・起点・連動）→ `MODIFIERS`。定義は `skills/modifiers.ts`（変形の一部と循環）と `skills/modifiers2.ts`（行為の列を作り替える符・起点の型替え符・連動）、`canAttach` の条件、数値は `src/data/balance/skills/SKILL/modifier.json` / `EXTRA_MODIFIER_TUNING.json` / `WAVE2_MODIFIER_TUNING.json`（同じ `skills/` の下）。`family`（変形 shape / 循環 cycle）は表示用の区分。効果は `CastParams` の旗・倍率へ立て、発動時の状態で変わるもの（循環）は `system/skills.ts`、命中ごとのもの（連鎖・爆ぜ・巡り・地形化）は `skills/hit.ts` が読む。`CastParams.burdenMul`（旧 `cooldownMul`）は気力型ならコスト、再使用型なら再使用時間に掛かる
  - 技（行為の列で書くスキル）の形を変える符は `ModifierDef.transform`（`ArtActsTransform`。行為の列を作り替える純関数）と `fitsArt`（技に付けられるか）を持つ。`transform` / `fitsArt` を持つ符は技だけに付く（分裂・旋回・重ね打ち・戻り刃・軌跡）。弾の動きの符（旋回・戻り刃）は `skills/arts/engine.ts` の `CastParams.shotPath` と `updateShotSteers` が読む
  - 発動の起点を変える型替え符は `ModifierDef.reshape`（照準起点・足元起点・据え置き。リンク 2 本、1 スロット 1 枚まで）
  - 連動符（終撃連動・応手連動）は `ModifierDef.autoCast`（`AutoCastTrigger`）。終撃が当たる（`system/moments.ts`）・応手が起きると `tryAutoCast` が予約し、次の `updateSkills` で `castSlotAt` が手動と同じ経路で撃つ（気力・再使用は払い、撃てなければ黙る）。変身・構えの維持（`form` / `channel`）とは噛み合わないので付けさせない。検査は `skills/autoCast.test.ts`
  - 符が語（共鳴の数え）を持つなら `ModifierDef.keywords`（`kw(源, 糧, 強め)`）
- 刻印符はラン内だけの物（2026-09-30）。拾うと自動では付かず手持ち `SkillRunState.hand` へ入る（`addToHand`。起点「詠み手」も同じ）。付け外しは `attachFromHand` / `moveRunModifier` / `detachToHand`（外した符は手持ちへ戻る。`system/skills.ts`）で、装備画面のスキルの頁が呼ぶ。石を替えた後は `returnInactiveRunes` で付かなくなった符を手持ちへ戻す。リプレイは `ReplayLoadout.handRunes` に手持ちを写す（版 38）。QA の bot は画面を操作できないので `qa/bot.ts` の `autoAttachHand` が付ける（本体は自動で付けない）。1 スロットに付く本数は `SKILL.slotLinks`。石には符を持たせない
- **相性表**: `skills/skills.test.ts` の `FORBIDDEN` を必ず更新（手書きスキルとの全組み合わせをテストで固定している。技との相性は `fitsArt` / 行為の列で決まる）
- 常時の増・倍・条件付き・「〜につき」: スキル石の定義に `modifiers`（`core/rules.ts` の `Modifier`）を置くと、スロットに入っている間だけ与ダメ・怯み値に効く（評価は `system/modifiers.ts`。書き方は `docs/recipes/boon.md` の「常時の増・倍」節）。`CastParams` の倍率で常時の与ダメを盛らない

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。

## 技（共通技）

行為の列（扇・円・帯・踏み込み・跳躍・弾・連鎖・引き寄せ・強化・起爆）で書けるスキルは、発動処理を書かずに `skills/arts/` へ足す（`docs/ideas/weapon-skills.md` 1 章に行為と数値の目安）。技は武器種を問わず撃て（`moveset: null`。武器技は段取り 7c で共通技 60 に束ねた）、今の武器の型で形が変わる（変形。`skills/arts/transform.ts`）。

1. `skills/arts/keys.ts` の `COMMON_ART_KEYS` の末尾に key を足す（`common` + 英名。表示名に武器種名を入れない）
2. `skills/arts/common2.ts` に `ArtSpec`（名前・1 文字アイコン・動詞・タグ・素性・行為の列。`moveset: null`）を足す
3. `data/balance/skills/ART/common.json` に数値ブロック（`cost` か `cooldown`・`minInterval`・`poise`・照準を使うなら `range`、行為ごとのブロック）を足す。新しい項目名を使ったら `data/balance/skills/ART/_index.json` の `_fields` に 1 行。型ごとの形の変化は `transform.ts`（数値は `ART/TRANSFORM/<型>.json`）で、技ごとには書かない
4. `npx vitest run src/skills/arts`（全技を 1 回ずつ撃つ検査がある）→ `npm run check`

行為の種類を足すときは `types.ts` の `ART_ACT_KINDS`・`build.ts` の必須項目 / 項目名・`engine.ts` の `runAct` の 3 か所。
- 説明に「投げる」とある技・スキル石を足したら `render/thrownLook.ts` の表に載せる（飛ぶ武器の絵）。載せないなら `render/thrownLook.test.ts` の `EXCLUDED` に理由を書く
