# 用語集（日本語表記の統一）

表示文字列はこの表記に揃える。内部 key（英語の識別子）は変えない。表の「出典」は現在その表記を持っているコード。
新しい用語を足したら、この表にも 1 行足す。

## 戦闘・操作

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| ジャスト（ジャスト！） | just / justDodge | ダッシュ無敵中に攻撃を受けて回避した瞬間。スロー + ゲージ増 + マナ回収 | `system/combat.ts` |
| ジャスト回避 | onJustDodge | 上の行為。説明文での名前 | `system/boons.ts`、`loot/affixes.ts`、`loot/stats.ts`、`loot/triggers.ts` |
| 見切り斬り（祝福） | justSlash（祝福 key）/ `ACTION.justCounter`（旧称「ジャストカウンター」、内部名は変えていない） | ジャスト回避直後の攻撃で敵の目の前へ瞬間移動して斬る。祝福を取らないと出ない | `system/boons.ts`、`data/tuning.ts` ACTION.justCounter |
| カウンター（カウンター！） | counter | 敵の予備動作中に近接を当てる。ダメージ ×1.5 + 怯み値 ×2（`ACTION.counter.poiseMul`。確定の怯みではなく、敵の強靭〔攻撃中 ×0.5〕と相殺して等倍になる値） | `data/tuning.ts` ACTION.counter |
| ガードブレイク | guard break | 盾騎士の正面ブロックをカウンターで割る | `system/elites.ts` GUARD_BREAK_TEXT |
| ブロック | block | 盾騎士の正面で攻撃が弾かれた。ブロック時も怯み値の 50% は溜まる | `system/elites.ts` BLOCK_TEXT |
| パリィ | parry | スキル。CD 型、近接の衝撃波 | `skills/data.ts` |
| 弾返し（祝福） | reflect（祝福 key） | 近接攻撃で敵弾を撃ち返す。撃ち返すと必殺ゲージ ×3。祝福を取らないと出ない | `system/boons.ts` |
| 殲滅 | lastKill | 封鎖中の部屋の最後の 1 体を倒した瞬間のスロー演出 | tuning ACTION.lastKill |
| 壁叩きつけ | wallSplat | 吹き飛んだ敵が壁に激突して追加ダメージ + 怯み値（強靭を無視） | `system/enemies.ts`、tuning ACTION.wallSplat |
| リゲイン | regain | 被弾後しばらく、近接ヒットで HP を取り戻せる | `system/combat.ts` |
| ダッシュ攻撃 | dashAttack | ダッシュ中に押した攻撃が終了時に出る突き | tuning ACTION |
| コンボ | combo | 連続ヒット数。時間切れか被弾で途切れる | HUD |
| バースト | special | 必殺ゲージ満タンで出す周囲攻撃 | HUD |
| 必殺ゲージ | energy | バーストのゲージ | 祝福の説明文 |
| 怯み | stagger（状態異常 kind） | 攻撃の怯み値が敵の怯み耐性を超えると付く行動停止の状態異常。旧表記「スタガー」を置き換えた | `core/status.ts`、`system/poise.ts` |
| 堅守 | guarded（状態異常 kind） | 怯みが解けた直後に付く状態異常。受ける怯み値が半減（ボスは 1/4） | `core/status.ts`、`system/poise.ts` |
| ダウン | ボスの `stagger` | ボスの怯み。通常より長く（2.0 秒）、被ダメが増える（`POISE.bossDownDamageMul`） | `data/enemyCombat.ts`、`system/poise.ts` |
| 怯み値 | poise（攻撃側） | 攻撃 1 回が敵に与える怯みの量 | `data/tuning.ts` Scaling / `skills/data.ts` |
| 怯み耐性 | `EnemyCombatDef.poise` | 敵ごとの怯み値の上限。蓄積がこれを超えると怯む。未指定なら怯まない | `data/enemyCombat.ts` |
| 強靭 | `EnemyCombatDef.superArmorMul` | 敵の攻撃中（予備動作・攻撃）に受ける怯み値の倍率。低いほど怯みにくい | `data/enemyCombat.ts` |
| テレグラフ / 予備動作 | windup | 敵の攻撃前の予告。コード上の phase は windup | 設計文書 |
| キー設定 | keybinds | 設定画面の項目とサブ画面。アクションごとのキー / マウスボタンの割り当て | `ui/title.ts` SETTINGS_ITEMS、`render/titleUi.ts` |
| 主 / 副 / 予備 | Keybinds の配列の 0 / 1 / 2 番目 | キー設定の列見出し。1 アクション最大 3 つ（`KEYBIND_SLOTS`） | `render/titleUi.ts` KEYBIND_SLOT_LABEL |
| 既定に戻す | reset | キー設定を既定の割り当てへ戻す行 | `render/titleUi.ts` |
| 左クリック / 右クリック / サイド1 / サイド2 | Mouse0 / Mouse2 / Mouse3 / Mouse4 | マウスボタンの表示名。サイド1 = 戻る、サイド2 = 進む | `core/input.ts` formatBindingCode |
| 近接攻撃 / 射撃 / 装備画面 | attack / shoot / inventory | キー設定画面でのアクション名（ほかは 上 / 下 / 左 / 右 / ダッシュ / バースト / スキル 1〜4） | `render/titleUi.ts` ACTION_LABEL |

## ステータス・マナ・状態異常（`docs/COMBAT_DESIGN.md`）

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| ステータス | Attributes / AttrKey | プレイヤーの 5 つの素質値。基礎値は各 5 | `loot/types.ts`、`system/attributes.ts` |
| 筋力 | str | 近接系の威力・怯み値・ノックバックが伸びる | `loot/resonance.ts` ATTR_LABEL |
| 技巧 | dex | 射撃系の威力・移動速度・連射・ダッシュ CD が伸びる | 同上 |
| 体力 | vit | 最大 HP が伸び、被る状態異常の持続が縮む | 同上 |
| 精神 | mnd | 最大マナ・マナ自然回復・会心率が伸びる | 同上 |
| 霊力 | spi | スキルの第 2 係数・状態異常の効果量が伸びる | 同上 |
| 実効値 | effectiveAttr / attributesEff | ステータスに逓減を掛けた計算用の値 | `system/attributes.ts` |
| マナ | mana | スキルの資源。通常攻撃の命中・ジャスト回避・撃破で溜まり、スキルで減る | `system/mana.ts` |
| 共通最低間隔 | GCD（`SKILL.gcd`） | どのスキルを撃った後も一定秒は次のスキルを撃てない | `system/skills.ts` |
| 状態異常 | StatusEffect / StatusBag | プレイヤーと敵に共通の状態異常の入れ物。34 種（昇華・良い状態を含む） | `core/status.ts`、`system/statusEffects.ts` |
| 燃焼 | burn | 継続ダメージ | `core/status.ts`、`render/statusUi.ts` |
| 冷気 | chill | 移動と行動が遅くなる。重ねると凍結へ | 同上 |
| 凍結 | freeze | 行動停止。次の被弾で「砕き」（ダメージ増 + 怯み値） | 同上 |
| 感電 | shock | 周期ごとに周囲の別の敵へ連鎖ダメージ。重ねると麻痺へ | 同上 |
| 麻痺 | paralyze | 短い行動停止 | 同上 |
| 毒 | poison | 最大 HP 割合の継続ダメージ | 同上 |
| 出血 | bleed | 移動距離に応じたダメージ | 同上 |
| 脆弱 | vulnerable | 受けるダメージ増 | 同上 |
| 弱体 | weaken | 与えるダメージ減 | 同上 |
| 恐怖 | fear | 敵がプレイヤーから逃げ、攻撃しない。拘束上限の対象外（実装メモ、`docs/COMBAT_DESIGN.md` C-3） | 同上 |
| 沈黙 | silence | 敵は射撃などを出せない、プレイヤーはスキル不可 | 同上 |
| 濡れ | wet | 燃焼が付かない（1 消費）。感電が広がる。3 で浸水 | 同上（`docs/COMBAT_DESIGN.md` E-6） |
| 油膜 | oiled | 燃焼・感電で炎上する | 同上 |
| 腐食 | corrode | 敵は怯みやすく、自分は被ダメ増 | 同上 |
| 烙印 | brand | 近接で刻み、射撃・スキルの命中で起爆 | 同上 |
| 崩勢 | broken | 怯みやすく、堅守を消す。崩勢中の怯みは長く、堅守が付かない | 同上 |
| 宣告 | doom | 付いている間に受けたダメージの一部を、切れた瞬間にまとめて受ける | 同上 |
| 吸魔 | siphon | この敵への命中でマナが戻る | 同上 |
| 彩痕 | hue | 5 色の印。共鳴と同じ色なら被ダメ増、対応する状態異常で色爆 | 同上 |
| 灼熱 / 炎上 / 猛毒 / 大出血 / 氷棺 / 露呈 / 無力 / 浸水 | scorch / blaze / venom / hemorrhage / encase / exposed / enfeeble / soaked | 昇華: 状態異常を積み切ったときに上乗せされる上位の状態 | 同上 |
| 加速 / 硬化 / 怒気 / 激昂 / 帯電 | haste / harden / wrath / fury / charged | 良い状態（プレイヤーのバフ）。HUD は緑の枠 | 同上 |
| 反応 | ReactionKey | 2 つの状態異常（か地形）が出会ったときの追加効果（蒸発・蒸気・拡散・炎上・毒霧…） | `core/status.ts`、`system/statusReactions.ts` |
| 昇華 | - | 同じ状態異常を積み切ると上位の状態に変わる・上乗せされること | 同上 |
| 異常数 / 総スタック | statusCount / totalStacks | 付いている悪い状態異常の種類数 / スタック合計 | `system/statusEffects.ts` |
| 地形 | TerrainLayer / TerrainKind | 床に重ねる層（水たまり・油・溶岩・毒沼・氷床・草むら・炎）。プレイヤーと敵の両方に効く | `core/terrain.ts`、`system/terrain.ts` |
| 処刑 | - | 怯み中で HP の少ない敵を重い一撃で即死させる | `system/poise.ts` |
| 背面の一撃 | - | 攻撃中の敵を背後から殴ると堅守を無視する | 同上 |

## 部屋・フロア

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| 封鎖（封鎖中） | locked / lockRoom | 部屋に入ると扉が閉じる状態。「部屋ロック」とも書かれているが表示は「封鎖」に寄せる | `system/floor.ts`、`render/renderer.ts` |
| 制圧 | cleared | 封鎖した部屋の敵を全滅させて解放した | `system/floor.ts`、祝福の説明文 |
| 宝物庫 | treasure | 敵なし・アイテム 2〜3 | `system/roomTypes.ts` |
| 試練（第 n 波） | challenge | 3 波の部屋 | `waveText` |
| 泉 | shrine | 全回復。代わりに次の部屋が呪われる | `system/roomTypes.ts` |
| 伏兵 | ambush | 入ると 2 倍湧き | 同上 |
| 通常 / 洞窟 / 暗闇 | rooms / cave / dark | フロア種別 | `render/renderer.ts` FLOOR_KIND_LABEL_JA |
| 地下 n 階 | depth | 階層 | HUD |
| 死神 | reaper | 長居すると出る無敵の追跡者。コードと設計文書では Reaper | `system/reaper.ts` |
| ボス | boss | 階層ボス（スライム王 / 骸骨卿 / 双子の騎士 / 霜の巨人） | `data/enemies.ts` |
| エリート | elite | 修飾子付きの敵。接頭辞は 爆裂の / 反射の / 障壁の / 迅速の / 連結の / 残響の / 伝染の / 堅牢の / 報復の / 分光の / 刻限の / 寄生の / 不動の / 貪食の / 群長の | `system/elites.ts` ELITE_PREFIX |
| 部屋主 | lairMaster | 通常の抽選に低い重みで混ざる中型の敵（喰らう宝箱 / 鎧の中身 / 骨の楽団長） | `data/enemies.ts` |
| 再配色種 | recolor | 元の敵の絵の色を差し替え、挙動を 1 つ足した派生 | `data/enemies.ts` recolor |
| 死骸 | corpse | 倒れた敵の跡。骨拾い・墓守の鐘・貪食の が使う | `system/enemyTraits.ts` |
| 取り巻き | pack / follower | 群れの長・楽団長が連れて湧き、号令で一斉に動く敵 | 同上 |

敵名: スライム / 浮遊眼 / 猪 / 盾騎士 / 爆弾ゴブリン / 光線眼 / ゴーレム / 蝙蝠 / 鬼火 / スライム王 / 骸骨卿（`data/enemies.ts`）。

量産した敵名（`data/enemies.ts`）:
- 再配色種: 毒スライム / 氷スライム / 炎スライム / 金色スライム / 骨猪 / 呪い眼 / 氷眼 / 黒鉄騎士 / 溶岩ゴーレム / 霜ゴーレム / 結晶ゴーレム / 氷鬼火 / 紫光線眼 / 飛ぶ本 / 灰蝙蝠
- 既存の動きの流用: 若苗スライム / 棘鼠 / 双眼 / 三叉光線眼 / 影蝙蝠 / 狼 / 連投ゴブリン / 槍兵 / 角甲虫 / 投網兵 / 腐肉蝿 / 雷鬼火 / 骸骨兵
- 新しい動き: 導火鼠 / 結晶ダニ / 残像打ち / 群れの長 / マナ喰い / 骨拾い / 墓守の鐘 / 沈黙の修道士 / 霜砕き / 双子の影
- 部屋主: 喰らう宝箱 / 鎧の中身（割れると 鎧の中身・亡霊）/ 骨の楽団長
- ボスと付き物: 双子の騎士（双子の騎士・兄 / 双子の騎士・妹）/ 霜の巨人（氷柱）

## 装備（響き・揺らぎ・来歴。詳細は `docs/LOOT_DESIGN.md`）

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| 装備 / 倉庫 | equipment / stash | 装着中と所持品 | `ui/inventory.ts` |
| 武器 / 銃 / 鎧 / 靴 / 指輪 / 首飾り | Slot | 6 スロット | `ui/inventoryLayout.ts` SLOT_LABEL |
| 遺物 | Item | 装備アイテム全般の呼称 | `loot/types.ts`、`loot/names.ts` |
| 静 / 揺 / 荒 / 反転あり | normal / magic / rare / unique（`Rarity`。キーは旧レアリティのまま） | 揺らぎの見た目の分類。格付けではない | `loot/types.ts` RARITY_LABEL |
| 性質 | AffixRoll（旧 affix） | 遺物に宿る 1 つの性質。表の性質 / トリガー文法 / 変換 / 誓約 | `loot/describe.ts`、装備画面 |
| 響き | TraitColor | 性質・共鳴が持つ 5 色。紅 crimson / 蒼 azure / 翠 jade / 金 gold / 冥 umbra | `loot/types.ts` TRAIT_COLOR_LABEL |
| 共鳴 | Resonance | 装備全体の色の配合で発現する効果。同時に 1 つ | `loot/resonance.ts` |
| 支配 / 二重 / 三和音 / 散光 | dominant / dual / triad / scatter | 共鳴の種類。1 色が過半 / 上位 2 色が拮抗 / ちょうど 3 色が各 22% 以上 / 全色が分散 | `loot/resonance.ts` resolveResonance |
| 三和音の名前 | TRIAD_EFFECTS | 四季 / 雷雨 / 煤 / 祭 / 血肉 / 賭場 / 凪 / 沼 / 流星 / 輪廻 | `loot/resonance.ts` |
| 揺らぎ | flux | 期待値（nominal）からの相対的なずれ | `loot/flux.ts` |
| 反転 | inverted | 揺らぎが強く裏返った性質。色は冥、共鳴への重み 2 倍 | `loot/flux.ts` |
| 来歴 | Provenance | 装備中に起きた出来事の記録 | `loot/provenance.ts` |
| 余白 | margin | まだ芽吹ける数 | `loot/types.ts` |
| 芽 | budOffer / buds | 節目で出る 2 択の成長。選ばなかった方は消える | `loot/provenance.ts` |
| 銘 | inscription | 余白を使い切った遺物に来歴から刻まれる名前 | `loot/names.ts` engraveName |
| 誓約 | keystone（`ks_`）。表示は「誓約」に統一 | 遊び方を変える大型改造。排他グループあり | `system/keystones.ts` |
| 誓約名 | - | 硝子の砲 / 狂戦士 / 瞬歩 / 不殺 / 不動 / 賭博師 / 吸血 / 過駆動 / 剣の誓い / 風走り / 過負荷 `ks_overdraw` / 静寂の誓い `ks_silentVow` / 渇きの誓約 `ks_thirst`（後 3 つはマナ関連、排他グループ） | `system/keystones.ts` KEYSTONE_NAME |
| 誓約名（2026-09 追加） | - | 無垢の誓い / 蝕みの誓約 / 病みの誓い（status）/ 楔の誓い / 揺るがぬ誓い / 締め上げの誓い（poise）/ 読み勝ちの誓い（tempo）/ 背水の誓い / 死神の誓い（room）/ 詠唱の誓い（mana）/ 単色の誓い / 無色の誓い / 鏡の誓い（hue）/ 修行の誓い / 忘却の誓い（chronicle） | `system/keystones.ts` KEYSTONE_NAME |
| 性質名（2026-09 追加） | `loot/affixes.ts` | 「名前: 効果」で表示する。汲み上げ / 底打ち / 満ち潮 / 引き潮 / 身代わり / 痛覚遮断 / 沈黙の報い / 殲滅の余韻 / 溢れ / 構えの呼吸 / 見切りの息吹 / 詠唱の集中 / 多彩 / 病み上がり / 弱体の盾 / 疫病の種 / 払い手 / 腐れ落ち / 毒気 / 耐性の布 / 払い清め / 楔 / 剥がし撃ち / 崩れの反響 / 怯み吸い / 追い討ち / 渦の芯 / 脆弱の楔 / 重い手 / 崩れ雷 / 崩れの充填 / 崩れの刻印 / 先読み / 崩し打ち / 返し波 / 堅守崩し / ダウン狩り / 撒き足 / 満ちた器 / 夜目 / 封鎖の熱 / 死神の影 / 若木 / 銘の重み / 裏の糧 / 異郷の響き / 橋渡し / 古傷 / 歴戦 / 旅の垢 / 王殺しの印 / 見切りの記憶 | `loot/affixes.ts` |
| 目覚め | `AffixDef.awakening` | 芽専用の性質。ドロップ・染めでは出ず、特定の節目の芽の片方にだけ出る（盾割り / 蹴り返し / 剥ぎ取り / 先の先 / 幕引き） | `loot/provenance.ts` MILESTONES |
| 殲滅 / 怯ませた / カウンター / スキル発動 / エリート撃破（節目） | lastKills / staggers / counters / skillCasts / eliteKills | 来歴の節目。銘の名詞は 幕引き / 崩し / 先読み / 詠み手 / 剥ぎ取り | `loot/provenance.ts`、`loot/names.ts` |
| 異色 | isOffColor | 既定と別の色で生まれた性質（生成時 10%）。異郷の響きが数える | `loot/traitContext.ts` |
| トリガー | trigger（`tr:`） | 「〜時: 〜」の条件付き効果（trigger × condition × effect） | `loot/triggers.ts` |
| 変換 | conversion（`cv_`） | ある軸の盛りを別の軸へ移す | `loot/affixes.ts` |
| 名のある遺物 | namedKey（旧 unique） | 性質が固定の遺物（値は小さく揺らぐ） | `loot/named.ts` |
| マナの性質 | maxManaFlat / manaRegenFlat / manaGainPct / manaCostPct / manaOnKillFlat / manaDrought | 最大マナ / マナ自然回復 / マナ回収 / スキルのコスト（代償: スキル威力）/ 撃破でマナ / 撃破でマナ・最大マナ −。tag `mana`、色は蒼 | `loot/affixes.ts` |
| 涸れ井戸の指輪 | driedWell | マナをテーマにした名のある遺物 | `loot/named.ts` |
| 残響 | EchoWallet | 分解で得る色ごとの素材。紅響 / 蒼響 / 翠響 / 金響 / 冥響 | `loot/crafting.ts` ECHO_LABEL |
| 砕く / 染め / 鎮め / 煽り / 削ぎ / 移し / 転調 | shatter / dye / calm / stir / pare / transfer / modulate | 残響タブの 7 操作。転調は性質の色だけを反対色へ変える | `loot/crafting.ts` ECHO_OP_LABEL |
| 残響（タブ名） | echo | 装備画面のタブ名（旧「鍛冶」から変更） | `render/inventoryUi.ts` TAB_LABEL |

## スキル・ラン内

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| スキル石 | SkillStone | 永続のアクティブスキル。変異軸とリンク数だけがロールされる | `skills/` |
| 刻印符 | rune / modifier | ラン内限りの修飾子。スキルのリンクに刺さる | `skills/data.ts` MODIFIERS |
| 溜め | charge | 長押しで威力を上げる刻印符 | 同上 |
| 祝福 | boon | 階層到達時の 3 択。ルール変更が中心 | `system/boons.ts` |
| 呪い付き | cursed | 強い効果 + 代償の祝福 | 同上 |
| マナ系の祝福 | springWell / bloodMana / reaperCup / keenBreath / circulation / hollowVessel | 湧水 / 血の対価 / 屠りの盃 / 見切りの息 / 循環 / 虚ろの器。マナの回復・軽減のルールを変える（tag `mana`）。「血の代償」は祝福 clearHeal と刻印符で既に使っているので bloodMana は「血の対価」 | `system/boons.ts` |
| 祝福のレア度 | common / rare / epic | 通常 / 希少 / 極稀 | `render/boonUi.ts` |
| 系譜 | `BoonDef.lineage` / `after` | 同じ主から出る 4 段の祝福。前段を持つと次段が 3 択に出る。1 回の 3 択に同じ系譜は 1 枚まで。カードに「灰燼 2段」のように出す | `system/boonDefs.ts`、`render/boonUi.ts` |
| 系譜名 | ash / frost / thunder / moon | 灰燼 / 霜枷 / 雷鳴 / 月蝕（`LINEAGE_LABEL`） | `system/boonDefs.ts` |
| 奥義 | 系譜の 4 段目 | 3 段目に加えて装備（またはスキル石）のタグを要求する最終段。焦土 / 永冬 / 雷神の鼓 / 月蝕 | 同上 |
| 結び / 結び祝福 | `BoonDef.duo` | 特定の 2 つの祝福を両方持つと出る合体祝福。共鳴の「二重」と衝突するので「二重祝福」とは書かない。1 回の 3 択に 1 枚まで | 同上 |
| 出す | `BoonDef.gives` | その祝福が作り出すもの（燃焼・脆弱など）。持っていると、それを食う祝福が出やすくなる | 同上 |
| 呪いを受けて 4 択 | `takeCurse` | 3 択の画面で呪い付き祝福を 1 つ受け、4 枚目の候補を足す（3 / X か札のクリック、4 枚目は 4 / Z） | `system/boons.ts`、`render/boonUi.ts` |
| 系譜の祝福名 | emberSeed … eclipse | 灰燼: 火種 / 延焼 / 灰積もり / 焦土。霜枷: 霜息 / 凍て足 / 砕氷の鐘 / 永冬。雷鳴: 静電気 / 帯電の刃 / 落雷予告 / 雷神の鼓。月蝕: 月読 / 満ち潮 / 新月 / 月蝕 | `system/boonDefs.ts` |
| 結びの祝福名 | swallowReturn … waveReturn | 燕渡り / 疫血 / 雷爆走 / 総崩れ / 饗宴の盃 / 臨界 / 虚刃 / 冬籠り / 明鏡 / 瞬停 / 波返し | 同上 |
| 拡張の祝福名 | bulletSteal … fireWalk | 奪弾 / 口封じ / 睨み / 威圧 / 死神遊び / 起き上がり狙い / 属性の轍 / 呼び戻し / 狩り立て / 霜読み / 毒崩し / 看破 / 両輪 / 氷伝い / 試練の徒 / 片翼 / 見切り返し / 抜き胴 / 跳ね弾 / 炸裂弾頭 / 狙い目 / 燠火 / 神経断ち / 返り血 / 血裂き / 綻び広げ / 背討ち / 静寂の間 / 見逃さぬ / 崩し連鎖 / 立て直し狩り / 際打ち / 換金 / 取り返し / 傷の記憶 / 死神の影 / 時間稼ぎ / 死に急ぎ / 重荷 / 業の火 / 乾坤 / 余韻 / 伏兵返し / 見定め / 力の簒奪 / 綱渡り / 飛燕 / 詠唱返し / 満月撃ち / 持ち越し / 火渡り。状態異常「腐食」・スキル「跳弾」「燕返し」・状態異常「裂傷」と重ならないよう、祝福は 毒崩し / 跳ね弾 / 燕渡り / 血裂き にした | 同上 |
| 足止め / 還流 / 雷鼓 / 奪弾 / 灰 | - | 祝福の浮き文字（死神遊び / 払ったマナが戻る / 雷神の鼓 / 奪弾 / 灰を拾った） | `system/boonRules.ts` |
| 返却 | refundCharge | 刻印符「連鎖」でキルした時にチャージを 1 戻す時のフローティングテキスト | `skills/hit.ts` |
| 型替え符 | `ModifierDef.reshape` | 発動の「型」（近接 / 射撃 / 設置 / 溜め）を変える刻印符。リンクを 2 本使い、1 スロットに 1 枚まで | `skills/modifiers.ts` |
| 連携 | `ComboKey` / `SkillRunState.lastCast` | スキル A の直後にスキル B を手動で撃つと B が変化すること。成立すると「連携: 渦雷」のように浮き文字が出る。HUD の枠の左上の点滅する菱形が「連携可」 | `skills/combos.ts`、`render/skillHud.ts` |
| 連携名 | wellThunder … reelStomp | 渦雷（引力球 → 雷撃）/ 引き回し（鎖鎌 → 旋風斬り）/ 返し撃ち（パリィ成功 → 撃ち抜き）/ 落地裂（墜星 → 地裂き）/ 総解き（伝染 → 綻び）/ 血風（血の契約 → 旋風斬り）/ 氷砕き（氷結地帯 → 砕氷槌）/ 影刺し（影渡り → 刺し穿ち）/ 疾風弾幕（加速 → 回転弾幕）/ 手繰り踏み（手繰り糸 → 震脚） | `skills/combos.ts` COMBOS |
| 連動体 | `SkillTag` の `summon` | 召喚スキルが出す味方の物体。自分では攻撃せず、近接 3 段目（剣の墓標）・射撃（砲台）に合わせてだけ動く | `skills/summons.ts` |
| 対象なし / 燃焼なし / 出血なし / 感電なし / 戻れない | - | 撃つ前に弾かれたときの浮き文字（何も払わない）。影渡り・伝染 / 燃え種爆ぜ / 血抜き / 放電 / 巻き戻し | `skills/actions.ts` extraCastBlock |
| 満タンでない / マナが多い / 返済待ち | - | マナ不足以外で撃てないときの浮き文字（満月の砲 / 枯渇の刃 / 刻印符「後払い」の返済前） | `system/skills.ts` |
| 綻び n / 収穫 / 剥奪 / 処断 / 刃先 / 背面 / 傷返し n | - | スキルの浮き文字（消した状態異常の種類数 / 毒の収穫 / 弱体を奪った / 沈黙を消費 / 断頭振りの刃先 / 影渡りの背面ヒット / 剥がした種類数） | `skills/shots.ts`、`skills/actions.ts`、`system/skills.ts` |

スキル名: 旋風斬り / 突進斬り / グレネード / 撃ち抜き / パリィ / 血の契約 / 地裂き / 雷撃 / 引力球 / 地雷 / 加速 / 鎖鎌 / 回転弾幕 / 氷結地帯。刻印符名: 多重 / 血の代償 / コンボ燃料 / 反響 / 貫通 / 反動 / 連鎖 / 呪い / 遅延 / 拡大 / 溜め（`skills/data.ts`）。

大拡張のスキル名（`skills/defs.ts`）: 伝染 / 綻び / 燃え種爆ぜ / 五彩の礫 / 満月の砲 / 枯渇の刃 / 影渡り / 爆薬樽 / 剣の墓標 / 砕氷槌 / 血抜き / 毒の収穫 / 放電 / 追い討ち / 処断 / 刺し穿ち / 剥奪 / 背水の一閃 / 連環撃 / 恨み返し / 断頭振り / 跳弾 / 風切り / 散弾符 / 震脚 / 手繰り糸 / 墜星 / 燕返し / 骨片の輪 / 巻き戻し / 傷返し / 湧き石 / 砲台。

大拡張の刻印符名（`skills/modifiers.ts`）: 後払い / 返金 / 血の肩代わり / 溢れ / 渇き撃ち / 刃の給油 / 定刻（マナ型を CD 型に。「刻限」はエリート修飾子と祝福で使っているので避けた）/ 燃料化 / 過熱 / 重撃 / 軽打 / 突き放し / 手繰り / 延命 / 伝播 / 追撃 / 散り際 / 延長 / 着地衝撃 / 背水 / 同調 / 巡り / 背面 / 至近 / 遠当て。型替え符名: 投げ刃 / 投げ込み / 段階溜め。

## 設計上の用語（未実装を含む）

| 表記 | 意味 | 出典 |
| --- | --- | --- |
| ゴール装備 / BiS | 「これを作れば最強」の装備。作らないのが方針 | `docs/LOOT_DESIGN.md` |
| ソフトキャップ | +100% 超を sqrt 圧縮する逓減 | `loot/stats.ts` |

装備の「響き・揺らぎ・来歴」（共鳴・揺らぎ・来歴・芽・銘・残響）は実装済み。用語は上の「装備」節を参照（旧: `docs/ideas/loot-identity.md`）。

## 表記の揺れ（要統一。localizer への作業候補）

| 揺れ | 箇所 | 推奨 |
| --- | --- | --- |
| レアリティ `通常` と フロア種別 `通常` と 祝福 `通常` | titleUi / renderer / boonUi | 文脈で区別できるので現状維持 |
