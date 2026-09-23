# 用語集（日本語表記の統一）

表示文字列はこの表記に揃える。内部 key（英語の識別子）は変えない。表の「出典」は現在その表記を持っているコード。
新しい用語を足したら、この表にも 1 行足す。

## 戦闘・操作

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| ジャスト（ジャスト！） | just / justDodge | ダッシュ無敵中に攻撃を受けて回避した瞬間。スロー + ゲージ増 | `system/combat.ts` |
| ジャスト回避 | onJustDodge | 上の行為。説明文での名前 | ※現状 `JUST回避` 表記が祝福・アフィックス・トリガーに残る（下の「揺れ」） |
| ジャストカウンター | justCounter | ジャスト直後の攻撃で背後へ瞬間移動して斬る | `data/tuning.ts` ACTION |
| カウンター（カウンター！） | counter | 敵の予備動作中に近接を当てる。1.5 倍 + 必ずスタガー | `data/tuning.ts` ACTION |
| ガードブレイク | guard break | 盾騎士の正面ブロックをカウンターで割る | `system/elites.ts` GUARD_BREAK_TEXT |
| ブロック | block | 盾騎士の正面で攻撃が弾かれた | `system/elites.ts` BLOCK_TEXT |
| パリィ | reflect / parry | 近接で敵弾を撃ち返す（弾返し）。スキル「パリィ」も同名 | tuning ACTION.reflect、`skills/data.ts` |
| 殲滅 | lastKill | 封鎖中の部屋の最後の 1 体を倒した瞬間のスロー演出 | tuning ACTION.lastKill |
| 壁叩きつけ | wallSplat | 吹き飛んだ敵が壁に激突して追加ダメージ + スタガー | `system/enemies.ts`、tuning ACTION.wallSplat |
| リゲイン | regain | 被弾後しばらく、近接ヒットで HP を取り戻せる | `system/combat.ts` |
| ダッシュ攻撃 | dashAttack | ダッシュ中に押した攻撃が終了時に出る突き | tuning ACTION |
| コンボ | combo | 連続ヒット数。時間切れか被弾で途切れる | HUD |
| バースト | special | 必殺ゲージ満タンで出す周囲攻撃 | HUD |
| 必殺ゲージ | energy | バーストのゲージ | 祝福の説明文 |
| スタガー | stagger | 敵がのけぞって行動不能 | 設計文書 |
| テレグラフ / 予備動作 | windup | 敵の攻撃前の予告。コード上の phase は windup | 設計文書 |

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

## 装備

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| 装備 / 倉庫 | equipment / stash | 装着中と所持品 | `ui/inventory.ts` |
| 武器 / 銃 / 鎧 / 靴 / 指輪 / 首飾り | Slot | 6 スロット | `ui/inventory.ts` SLOT_LABEL |
| 通常 / 魔法 / 希少 / 固有 | normal / magic / rare / unique | レアリティ | `render/titleUi.ts` |
| アフィックス | affix | 装備の性質 1 つ | 装備画面 |
| キーストーン | keystone（`ks_`） | 遊び方を変える大型改造。排他グループあり | `system/keystones.ts` |
| キーストーン名 | - | 硝子の砲 / 狂戦士 / 瞬歩 / 不殺 / 不動 / 賭博師 / 吸血 / 過駆動 / 剣の誓い / 風走り | `system/keystones.ts` KEYSTONE_NAME |
| トリガー | trigger（`tr:`） | 「〜時: 〜」の条件付き効果（trigger × condition × effect） | `loot/triggers.ts` |
| 変換 | conversion（`cv_`） | ある軸の盛りを別の軸へ移す | `loot/affixes.ts` |
| 鍛冶 | craft | クラフト画面のタブ名 | `render/inventoryUi.ts` |
| 再鍛造 / 付与 / 消去 / 侵蝕 / 融合 | reforge / augment / annul / corrupt / fuse | クラフト操作 | `render/inventoryUi.ts` |
| 欠片 / 精髄 | shard / essence | 通貨 | 両方で一致 |

## スキル・ラン内

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| スキル石 | SkillStone | 永続のアクティブスキル。変異軸とリンク数だけがロールされる | `skills/` |
| 刻印符 | rune / modifier | ラン内限りの修飾子。スキルのリンクに刺さる | `skills/data.ts` MODIFIERS |
| 溜め | charge | 長押しで威力を上げる刻印符 | 同上 |
| 祝福 | boon | 階層到達時の 3 択。ルール変更が中心 | `system/boons.ts` |
| 呪い付き | cursed | 強い効果 + 代償の祝福 | 同上 |
| 祝福のレア度 | common / rare / epic | 通常 / 希少 / 極稀 | `render/boonUi.ts` |

スキル名: 旋風斬り / 突進斬り / グレネード / 撃ち抜き / パリィ / 血の契約 / 地裂き / 雷撃 / 引力球 / 地雷 / 加速 / 鎖鎌 / 回転弾幕 / 氷結地帯。刻印符名: 多重 / 血の代償 / コンボ燃料 / 反響 / 貫通 / 反動 / 連鎖 / 呪い / 遅延 / 拡大 / 溜め（`skills/data.ts`）。

## 設計上の用語（未実装を含む）

| 表記 | 意味 | 出典 |
| --- | --- | --- |
| ゴール装備 / BiS | 「これを作れば最強」の装備。作らないのが方針 | `docs/LOOT_DESIGN.md` |
| ソフトキャップ | +100% 超を sqrt 圧縮する逓減 | `loot/stats.ts` |
| 共鳴 | 装備全体の色の配合で発現する効果（未実装） | `docs/ideas/loot-identity.md` |
| 響き・揺らぎ・来歴 | 装備再設計の推奨案（未実装）。色 / 性 / 誓約 / 芽 / 銘 などの用語は同文書の 3-1 | 同上 |

## 表記の揺れ（要統一。localizer への作業候補）

| 揺れ | 箇所 | 推奨 |
| --- | --- | --- |
| `JUST回避` と `ジャスト！` | 祝福 desc・アフィックス label・トリガー文（`JUST回避時`）・スキル verb | 「ジャスト回避」に統一 |
| 通貨 dust: `塵` と `粉塵` | `ui/inventory.ts` CURRENCY_LABEL と `loot/crafting.ts` | どちらかに統一（短い「塵」を推奨） |
| 通貨 relic: `遺物` と `秘宝` | 同上 | 「秘宝」を推奨（loot-identity 案で「遺物」を装備全般に使う予定のため） |
| `部屋ロック` と `封鎖` | 祝福 desc と HUD / トリガー文 | 表示は「封鎖」 |
| レアリティ `通常` と フロア種別 `通常` と 祝福 `通常` | titleUi / renderer / boonUi | 文脈で区別できるので現状維持 |
