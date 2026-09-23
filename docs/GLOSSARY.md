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
| 状態異常 | StatusEffect / StatusBag | プレイヤーと敵に共通の状態異常の入れ物。13 種 | `core/status.ts`、`system/statusEffects.ts` |
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
| ボス | boss | 階層ボス（スライム王 / 骸骨卿） | `data/enemies.ts` |
| エリート | elite | 修飾子付きの敵。接頭辞は 爆裂の / 反射の / 障壁の / 迅速の / 連結の | `system/elites.ts` ELITE_PREFIX |

敵名: スライム / 浮遊眼 / 猪 / 盾騎士 / 爆弾ゴブリン / 光線眼 / ゴーレム / 蝙蝠 / 鬼火 / スライム王 / 骸骨卿（`data/enemies.ts`）。

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
| 支配 / 二重 / 散光 | dominant / dual / scatter | 共鳴の種類。1 色が過半 / 上位 2 色が拮抗 / 全色が分散 | `loot/resonance.ts` resolveResonance |
| 揺らぎ | flux | 期待値（nominal）からの相対的なずれ | `loot/flux.ts` |
| 反転 | inverted | 揺らぎが強く裏返った性質。色は冥、共鳴への重み 2 倍 | `loot/flux.ts` |
| 来歴 | Provenance | 装備中に起きた出来事の記録 | `loot/provenance.ts` |
| 余白 | margin | まだ芽吹ける数 | `loot/types.ts` |
| 芽 | budOffer / buds | 節目で出る 2 択の成長。選ばなかった方は消える | `loot/provenance.ts` |
| 銘 | inscription | 余白を使い切った遺物に来歴から刻まれる名前 | `loot/names.ts` engraveName |
| 誓約 | keystone（`ks_`）。表示は「誓約」に統一 | 遊び方を変える大型改造。排他グループあり | `system/keystones.ts` |
| 誓約名 | - | 硝子の砲 / 狂戦士 / 瞬歩 / 不殺 / 不動 / 賭博師 / 吸血 / 過駆動 / 剣の誓い / 風走り / 過負荷 `ks_overdraw` / 静寂の誓い `ks_silentVow`（後 2 つはマナ関連、排他グループ） | `system/keystones.ts` KEYSTONE_NAME |
| トリガー | trigger（`tr:`） | 「〜時: 〜」の条件付き効果（trigger × condition × effect） | `loot/triggers.ts` |
| 変換 | conversion（`cv_`） | ある軸の盛りを別の軸へ移す | `loot/affixes.ts` |
| 名のある遺物 | namedKey（旧 unique） | 性質が固定の遺物（値は小さく揺らぐ） | `loot/named.ts` |
| 残響 | EchoWallet | 分解で得る色ごとの素材。紅響 / 蒼響 / 翠響 / 金響 / 冥響 | `loot/crafting.ts` ECHO_LABEL |
| 砕く / 染め / 鎮め / 煽り / 削ぎ / 移し | shatter / dye / calm / stir / pare / transfer | 残響タブの 6 操作 | `loot/crafting.ts` ECHO_OP_LABEL |
| 残響（タブ名） | echo | 装備画面のタブ名（旧「鍛冶」から変更） | `render/inventoryUi.ts` TAB_LABEL |

## スキル・ラン内

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| スキル石 | SkillStone | 永続のアクティブスキル。変異軸とリンク数だけがロールされる | `skills/` |
| 刻印符 | rune / modifier | ラン内限りの修飾子。スキルのリンクに刺さる | `skills/data.ts` MODIFIERS |
| 溜め | charge | 長押しで威力を上げる刻印符 | 同上 |
| 祝福 | boon | 階層到達時の 3 択。ルール変更が中心 | `system/boons.ts` |
| 呪い付き | cursed | 強い効果 + 代償の祝福 | 同上 |
| 祝福のレア度 | common / rare / epic | 通常 / 希少 / 極稀 | `render/boonUi.ts` |
| 返却 | refundCharge | 刻印符「連鎖」でキルした時にチャージを 1 戻す時のフローティングテキスト | `skills/hit.ts` |

スキル名: 旋風斬り / 突進斬り / グレネード / 撃ち抜き / パリィ / 血の契約 / 地裂き / 雷撃 / 引力球 / 地雷 / 加速 / 鎖鎌 / 回転弾幕 / 氷結地帯。刻印符名: 多重 / 血の代償 / コンボ燃料 / 反響 / 貫通 / 反動 / 連鎖 / 呪い / 遅延 / 拡大 / 溜め（`skills/data.ts`）。

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
