# 用語集（日本語表記の統一）

表示文字列はこの表記に揃える。内部 key（英語の識別子）は変えない。表の「出典」は現在その表記を持っているコード。
新しい用語を足したら、この表にも 1 行足す。

## 世界観語の対応表（2026-09-24。世界観語はこの表を正とする）

表示（HUD・装備画面・祝福カード・スキル・ツールチップ・タイトル・設定・図鑑・依頼・死亡画面・ログ・浮き文字）に英字略語（HP / MP / CD / GCD / DPS / JUST）を出さない。内部 key・変数名・型名（`mana` / `hp` / `cooldown` / `elite` / `just` …）は変えない。設計文書では「ラン」「深度」「ドロップ」を開発用の語として使ってよい（表示には出さない）。

| 旧 | 新（表示） | 理由 |
| --- | --- | --- |
| マナ | 気力 | 「気力不足」「気力が満ちる」が日本語として自然に読め、資源だと初見で分かる。気力を伸ばすステータス「精神」とも意味がつながる。「霊気」は霊力、「精」は精神と紛れるので避けた |
| HP / 最大 HP | 生命 / 最大生命 | 「体力」はステータス（vit）と衝突、「命」は「最大命」が不自然。敵にも使える（「敵の生命が 3 割増える」） |
| CD / クールダウン | 再使用時間（短いラベルは「再使用」）。スキルの資源の型は 気力型 / 再使用型 | 既に「ダッシュ再使用時間」「スキルの再使用時間」で使っていた語に揃えた |
| ジャスト / ジャスト回避 / JUST / ジャスト！ | 見切り / 見切った / 見切り！ | 見切り斬り・見切りの息・見切りの息吹・見切りの記憶・見切り返しなど、派生の名前が既に「見切り」で揃っていた |
| ジャストカウンター（浮き文字） | 見切り斬り！ | 祝福名「見切り斬り」と揃えた。GLOSSARY では改名済みだったのに浮き文字だけ旧称が残っていた |
| エリート | 精鋭 | 縛り「精鋭」（精鋭の抽選が 2 回）と同じ語になり、説明が一続きで読める |
| エネルギー | 必殺ゲージ | 既存の正表記「必殺ゲージ」に揃えた（揺れの解消） |
| ラン（表示） | 探索（「1 ランで」→「1 回の探索で」、ラン履歴 → 探索履歴） | 「ラン」はローグライクの業界語で初見に通じない。「潜行」は敵の状態で使用済み |
| 低HP（語） | 瀕死 | 語の字形が既に「瀕」 |
| 語「マナ」の字形 魔 | 気 | 表示名の気力に合わせた |

比較した 3 案（採用は A）:
- A: 気力 / 生命 / 見切り / 精鋭 / 再使用時間 / 探索。日常語で意味が取れ、既存の世界観語（見切り斬り・縛り「精鋭」）と噛み合う
- B: 霊気 / 命 / 見極め / 強者 / 巡り。霊気がステータス「霊力」と、巡りが刻印符「巡り」と衝突する
- C: 灯 / 血 / 刹那 / 異形 / 冷え / 潜り。雰囲気は強いが「最大灯」「血が足りない（出血と紛れる）」など直感性が落ちる

変えずに残した語: ボス / 死神（既に日本語、または誰にでも通じる）、ダッシュ / コンボ / バースト / スキル / スキル石 / スロット / アーマー / リゲイン（カタカナのままの方が直感的。固有名詞を増やしすぎない）、起点 / 縛り / 位階 / 図鑑 / 依頼 / 実績 / 称号（既に日本語の世界観語）、地下 n 階（表示は既に階）。キー名・ボタン名（WASD / Space / Esc / LB / A X Y B）と URL は操作の案内なので英字のまま。

## 戦闘・操作

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| 見切り（見切り！） | just / justDodge | ダッシュ無敵中に攻撃を受けて回避した瞬間（旧表記「ジャスト」「JUST」）。スロー + ゲージ増 + 気力回収 | `system/combat.ts` |
| 見切り / 見切った | onJustDodge | 上の行為。説明文での名前（旧表記「ジャスト回避」）。「見切りの息吹」「見切りの記憶」など既存の名前と同じ語で揃う | `system/boons.ts`、`loot/affixes.ts`、`loot/stats.ts`、`loot/triggers.ts` |
| 見切り斬り（祝福） | justSlash（祝福 key）/ `ACTION.justCounter`（旧称「ジャストカウンター」、内部名は変えていない） | 見切り直後の攻撃で敵の目の前へ瞬間移動して斬る。祝福を取らないと出ない。浮き文字は「見切り斬り！」（祝福名と同じ文字列だと取得時の表示と区別できないため）| `system/boons.ts`、`data/tuning.ts` ACTION.justCounter |
| カウンター（カウンター！） | counter | 敵の予備動作中に近接を当てる。ダメージ ×1.5 + 怯み値 ×2（`ACTION.counter.poiseMul`。確定の怯みではなく、敵の強靭〔攻撃中 ×0.5〕と相殺して等倍になる値） | `data/tuning.ts` ACTION.counter |
| ガードブレイク | guard break | 盾騎士の正面ブロックをカウンターで割る | `system/elites.ts` GUARD_BREAK_TEXT |
| ブロック | block | 盾騎士の正面で攻撃が弾かれた。ブロック時も怯み値の 50% は溜まる | `system/elites.ts` BLOCK_TEXT |
| パリィ | parry | スキル。再使用型、近接の衝撃波 | `skills/data.ts` |
| 弾返し（祝福） | reflect（祝福 key） | 近接攻撃で敵弾を撃ち返す。撃ち返すと必殺ゲージ ×3。祝福を取らないと出ない | `system/boons.ts` |
| 殲滅 | lastKill | 交戦中の部屋の最後の 1 体を倒した瞬間のスロー演出 | tuning ACTION.lastKill |
| 壁叩きつけ | wallSplat | 吹き飛んだ敵が壁に激突して追加ダメージ + 怯み値（強靭を無視） | `system/enemies.ts`、tuning ACTION.wallSplat |
| リゲイン | regain | 被弾後しばらく、近接ヒットで生命を取り戻せる | `system/combat.ts` |
| 与ダメの n% を回復 | lifeOnHit | 命中時の回復。与えたダメージの n%（旧表記「命中時HP回復 +n」は固定値だった）。ステータス一覧では「与ダメからの生命回復(%)」 | `loot/affixes.ts`、`loot/stats.ts` |
| 撃破時の生命回復（n コンボ以上） | lifeOnKill | コンボが `HEAL.killHealMinCombo` 以上の撃破でだけ回復する | `system/combat.ts` |
| 生命自然回復（敵が近くにいない間） | hpRegen | 戦闘中（封鎖中・近くに敵）は止まる毎秒の回復 | `system/combat.ts` |
| 戦闘中の回復の上限 | `HEAL.sustainCapRatio` | 命中時・撃破時・祝福の撃破回復を合わせて 1 秒に最大生命の 4% まで。説明文では「戦闘中の回復の上限あり」 | `system/combat.ts` healSustained |
| ダッシュ攻撃 | dashAttack | ダッシュ中に押した攻撃が終了時に出る突き | tuning ACTION |
| コンボ | combo | 連続ヒット数。時間切れか被弾で途切れる | HUD |
| バースト | special | 必殺ゲージ満タンで出す周囲攻撃 | HUD |
| 必殺ゲージ | energy | バーストのゲージ。旧表記「エネルギー」（性質の「エネルギー獲得」）も「必殺ゲージ獲得」に揃えた | 祝福の説明文 |
| 怯み | stagger（状態異常 kind） | 攻撃の怯み値が敵の怯み耐性を超えると付く行動停止の状態異常。旧表記「スタガー」を置き換えた | `core/status.ts`、`system/poise.ts` |
| 堅守 | guarded（状態異常 kind） | 怯みが解けた直後に付く状態異常。受ける怯み値が半減（ボスは 1/4） | `core/status.ts`、`system/poise.ts` |
| ダウン | ボスの `stagger` | ボスの怯み。通常より長く（2.0 秒）、被ダメが増える（`POISE.bossDownDamageMul`） | `data/enemyCombat.ts`、`system/poise.ts` |
| 怯み値 | poise（攻撃側） | 攻撃 1 回が敵に与える怯みの量 | `data/tuning.ts` Scaling / `skills/data.ts` |
| 怯み耐性 | `EnemyCombatDef.poise` | 敵ごとの怯み値の上限。蓄積がこれを超えると怯む。未指定なら怯まない | `data/enemyCombat.ts` |
| 強靭 | `EnemyCombatDef.superArmorMul` | 敵の攻撃中（予備動作・攻撃）に受ける怯み値の倍率。低いほど怯みにくい | `data/enemyCombat.ts` |
| テレグラフ / 予備動作 | windup | 敵の攻撃前の予告。コード上の phase は windup | 設計文書 |
| 音量 / 音楽の音量 / 画面揺れ / ミュート | volume / musicVolume / screenShake / muted | 設定画面の項目。音楽の実際の大きさは 音量 × 音楽の音量。ミュートは効果音と音楽の両方を止める | `ui/title.ts` SETTINGS_ITEMS、`render/titleUi.ts` SETTINGS_LABEL、`ui/settings.ts` |
| キー設定 | keybinds | 設定画面の項目とサブ画面。アクションごとのキー / マウスボタンの割り当て | `ui/title.ts` SETTINGS_ITEMS、`render/titleUi.ts` |
| 主 / 副 / 予備 | Keybinds の配列の 0 / 1 / 2 番目 | キー設定の列見出し。1 アクション最大 3 つ（`KEYBIND_SLOTS`） | `render/titleUi.ts` KEYBIND_SLOT_LABEL |
| 既定に戻す | reset | キー設定を既定の割り当てへ戻す行 | `render/titleUi.ts` |
| 左クリック / 右クリック / サイド1 / サイド2 | Mouse0 / Mouse2 / Mouse3 / Mouse4 | マウスボタンの表示名。サイド1 = 戻る、サイド2 = 進む | `core/input.ts` formatBindingCode |
| 近接攻撃 / 射撃 / 装備画面 | attack / shoot / inventory | キー設定画面でのアクション名（ほかは 上 / 下 / 左 / 右 / ダッシュ / バースト / スキル 1〜4 / 拾う） | `render/titleUi.ts` ACTION_LABEL |
| 拾う | interact / interactPressed | 注目中の遺物・スキル石を倉庫へ入れる操作（既定 G、パッドは右スティック押し込み）。手の届く距離（`PICKUP.reach`）にあるものだけ。ハート・刻印符などは従来どおり触れて拾う。キー案内は「G: 拾う」、遠いときは「近づいて拾う」 | `system/loot.ts` updateDropInteract、`core/input.ts` |
| 注目 | focusedDrop | カーソル（パッドは照準スティックの先、中立なら手の届く最寄り）の近くにある床の遺物・スキル石。環とキー案内が付き、性能のポップアップが出る。state には持たず毎フレーム求める | `system/loot.ts` focusedDrop、`render/dropTooltip.ts` |

## ステータス・気力・状態異常（`docs/COMBAT_DESIGN.md`）

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| ステータス | Attributes / AttrKey | プレイヤーの 5 つの素質値。基礎値は各 5 | `loot/types.ts`、`system/attributes.ts` |
| 筋力 | str | 近接系の威力・怯み値・ノックバックが伸びる | `loot/resonance.ts` ATTR_LABEL |
| 技巧 | dex | 射撃系の威力・移動速度・連射・ダッシュ再使用時間が伸びる | 同上 |
| 体力 | vit | 最大生命が伸び、被る状態異常の持続が縮む | 同上 |
| 精神 | mnd | 最大気力・気力自然回復・会心率が伸びる | 同上 |
| 霊力 | spi | スキルの第 2 係数・状態異常の効果量が伸びる | 同上 |
| 実効値 | effectiveAttr / attributesEff | ステータスに逓減を掛けた計算用の値 | `system/attributes.ts` |
| 気力 | mana | スキルの資源。通常攻撃の命中・見切り・撃破で溜まり、スキルで減る | `system/mana.ts` |
| ~~共通最低間隔~~ | ~~GCD（`SKILL.gcd`）~~ | 2026-09-24 に廃止。スキルの待ちはスロットごとの最低間隔と再使用時間だけ（`docs/COMBAT_DESIGN.md` B-9） | - |
| 状態異常 | StatusEffect / StatusBag | プレイヤーと敵に共通の状態異常の入れ物。34 種（昇華・良い状態を含む） | `core/status.ts`、`system/statusEffects.ts` |
| 燃焼 | burn | 継続ダメージ | `core/status.ts`、`render/statusUi.ts` |
| 冷気 | chill | 移動と行動が遅くなる。重ねると凍結へ | 同上 |
| 凍結 | freeze | 行動停止。次の被弾で「砕き」（ダメージ増 + 怯み値） | 同上 |
| 感電 | shock | 周期ごとに周囲の別の敵へ連鎖ダメージ。重ねると麻痺へ | 同上 |
| 麻痺 | paralyze | 短い行動停止 | 同上 |
| 毒 | poison | 最大生命割合の継続ダメージ | 同上 |
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
| 吸魔 | siphon | この敵への命中で気力が戻る | 同上 |
| 彩痕 | hue | 5 色の印。共鳴と同じ色なら被ダメ増、対応する状態異常で色爆 | 同上 |
| 灼熱 / 炎上 / 猛毒 / 大出血 / 氷棺 / 露呈 / 無力 / 浸水 | scorch / blaze / venom / hemorrhage / encase / exposed / enfeeble / soaked | 昇華: 状態異常を積み切ったときに上乗せされる上位の状態 | 同上 |
| 加速 / 硬化 / 怒気 / 激昂 / 帯電 | haste / harden / wrath / fury / charged | 良い状態（プレイヤーのバフ）。HUD は緑の枠 | 同上 |
| 反応 | ReactionKey | 2 つの状態異常（か地形）が出会ったときの追加効果（蒸発・蒸気・拡散・炎上・毒霧…） | `core/status.ts`、`system/statusReactions.ts` |
| 昇華 | - | 同じ状態異常を積み切ると上位の状態に変わる・上乗せされること | 同上 |
| 異常数 / 総スタック | statusCount / totalStacks | 付いている悪い状態異常の種類数 / スタック合計 | `system/statusEffects.ts` |
| 地形 | TerrainLayer / TerrainKind | 床に重ねる層（水たまり・油・溶岩・毒沼・氷床・草むら・炎・泥・煙・崩れる床）。プレイヤーと敵の両方に効く | `core/terrain.ts`、`system/terrain.ts` |
| 泥 / 煙 | mud / smoke（`TerrainKind`） | 泥: 移動 ×0.6、突進の距離が縮む、燃焼で固まって麻痺、冷気で氷床。煙: 視線を遮り両陣営の弾が消える、火で晴れる、床の地形に重ねて持てる第 2 層 | `core/terrain.ts` TERRAIN_LABEL、`system/terrain.ts` |
| 崩れる床 | rubble（`TerrainKind`） | 地裂きの刻印符「地崩れ」が命中線に残す床。敵が 1 秒乗り続けると揺れ（予告）の後に抜け、落下ダメージと怯み（ボスは怯み値だけ）。プレイヤーは落ちない。状態異常の反応「崩落」と重ならないよう「崩れる床」にした | `core/terrain.ts`、`system/terrain.ts` tickRubble、tuning `TERRAIN_RUBBLE` |
| 処刑 | - | 怯み中で生命の少ない敵を重い一撃で即死させる | `system/poise.ts` |
| 背面の一撃 | - | 攻撃中の敵を背後から殴ると堅守を無視する | 同上 |

## 部屋・フロア

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| 封鎖（封鎖中） | locked / lockRoom | 部屋に入ると扉が閉じる状態。「部屋ロック」とも書かれているが表示は「封鎖」に寄せる。開放型フロア（2026-09-24）では試練・闘技場・巣・巣窟・伏兵・護衛・鏡とボス部屋だけ（`ROOM_KIND.locks`） | `system/floor.ts`、`render/renderer.ts` |
| 交戦 | engaged | 封鎖しない部屋に入る、または部屋の敵が気付いた状態。封鎖と同じフック（祝福・ランイベント・呪い）が 1 回起きる | `system/floor.ts` |
| 交戦中 | isEngaged / roomLocked | 今いる部屋が封鎖中、または交戦が始まっていて敵が残っている状態。旧「封鎖中」を条件にしていた祝福・誓約・性質・トリガー条件・殲滅・縛りはこれを見る。回復・気力の「戦闘中」（近くに敵）とは別 | `system/engagement.ts` |
| 制圧 | cleared | 部屋の敵を全滅させた（封鎖した部屋は波も全て）。1 部屋 1 回 | `system/floor.ts`、祝福の説明文 |
| 巣窟 | horde | モンスターハウス。広い塊に深度 2 から 0〜2 個。入ると封鎖され 3 波で大量に湧き、制圧で rare 以上が確定で落ちる | `system/roomTypes.ts`、`system/specialRooms.ts` |
| 徘徊 | roam / ROAMING_ROOM | どの部屋にも属さず塊の間を歩き回る敵。気付くと追ってくる。時間経過で画面外に少しずつ増える（増援） | `system/spawner.ts` |
| 宝物庫 | treasure | 敵なし・アイテム 2〜3 | `system/roomTypes.ts` |
| 試練（第 n 波） | challenge | 3 波の部屋 | `waveText` |
| 泉 | shrine | 全回復。代わりに次の部屋が呪われる。深度 3 と 6 にだけ出る（1 ランに最大 2 回） | `system/roomTypes.ts` |
| 伏兵 | ambush | 入ると 2 倍湧き | 同上 |
| 通常 / 洞窟 / 暗闇 | rooms / cave / dark | フロア種別 | `render/renderer.ts` FLOOR_KIND_LABEL_JA |
| バイオーム: 熔鉱炉 / 骨の墓所 / 沼 / 氷窟 / 油の坑道 / 草原 | forge / ossuary / swamp / glacier / mine / meadow | 形・地形・出やすい敵・色調を束ねたフロア種別。回廊（rooms）はログと階段の行き先では「回廊」、HUD では「通常」 | `system/biomes.ts` BIOMES |
| 分岐路 | stairs / StairsChoice | 最後の部屋の 2〜3 個の階段。階段ごとに次のバイオームが違い、上に行き先を出す。案内人で 1 つ増やせる | `system/specialRooms.ts` planForkStairs / addForkStair |
| 上り階段 / 帰還 | ascend / strata.revisit | 最後の部屋に置かれる「上へ」の台座。乗り続けると 1 つ浅い階へ戻る（1 ランに 2 回、ボス階とその 1 つ下には出ない）。戻った階は「帰還」で、敵が半分・死神が早く、降り直しても階層到達の報酬は出ない | `system/specialRooms.ts` placeAscend、`system/floor.ts` ascend |
| 反転層 | invertedDepth / isInvertedDepth | 深度 20 以降。バイオームの重みが逆順になり、敵はエリートの抽選を 1 回多く引き、落ちた遺物はもう 1 回反転の抽選を受ける。画面に紫が重なる | `system/biomes.ts`、`system/runEvents.ts` |
| 無限の深み / 変異 | deepDepth / mutations | 深度 30 以降。敵の生命の伸びが寝て部屋の敵数の上限が外れ、10 階ごとに「変異」（階のランイベントの常時化: 狂乱の月 → 血の月 → 霧 → 属性の嵐）が 1 つ積まれる。スキル石の「変異軸」とは別 | `system/runEvents.ts` mutationsFor |
| 欠片 | shards | ラン内でだけ集まる小さな資源。制圧・初めて着いた階・賞金首・決闘で得て、契約者との取引と封印庫の解錠に使う。死ぬと消える（永続の残響とは別）。右上 HUD に「欠片 n」 | `system/contractors.ts`、`render/runUi.ts` |
| 契約者 | contractor / CONTRACTORS | 階の入口（開始部屋）に立つ人物。触れて選ぶ台座を 2〜3 個並べる。灰の公証人 / 行商 / 修理屋 / 占い / 賭場の主 / 語り部 / 鍛冶 / 案内人 / 渡し守 | `system/contractors.ts` |
| 契約 | pact / PACTS | 灰の公証人と結ぶ条件付きの約束。無傷の契約 / 疾走の契約 / 狩りの契約 / 沈黙の契約。破れたらその場で代償、次の階に着けば報酬。依頼（quest）とは別 | 同上 |
| 契約者の台座 | OfferKind | 遺物 / 残響 / 刻印符 / 傷を縫う / 清め / 呪いを解く / 次の階を読む / 凶兆を払う / この階を見通す / 欠片を賭ける / 生命を賭ける / 来歴を語る / 見届けてもらう / 〇の焼き付け / 分かれ道を増やす / 階段を教わる / 生命で時を買う / 欠片で時を買う | `system/contractors.ts` offerLabel |
| 語り部の目撃 | witness | 語り部に見届けてもらう 60 秒。その間の制圧は来歴に 2 回刻まれる | 同上 |
| 祭壇 / 図書館 / 闘技場 / 賭博 / 鍛冶場 / 交換所 / 呪いの祠 / 共鳴炉 / 護衛 / 逃走 / 死神の巣 / 巣 / 鏡 / 見張り台 | altar / library / arena / gamble / forge / exchange / curseShrine / resonance / escort / escape / reaperNest / nest / mirror / watchtower | 追加の部屋種類。台座の部屋は触れて選ぶ（誓約・刻印符・賭け台・金床・交換台・鐘・宝箱） | `system/specialRooms.ts` ROOM_KIND_LABEL / PROP_LABEL |
| 封印庫 / 属性の祭壇 / 試し場 / 霧の部屋 / 潮の間 / 反転の間 | vault / elementAltar / dummyHall / fogRoom / tideRoom / invertHall | 第 2 弾の部屋。封印庫は欠片で解くと深い遺物、属性の祭壇はこの階だけ通常攻撃に属性、試し場は木人、霧の部屋は中だけ視界が狭く制圧で rare、潮の間は封鎖すると水が満ちる、反転の間は置かれた遺物の性質を反転させる | 同上 |
| 賭け台 / 金床 / 交換台 / 鐘 / 捕らわれ人 / 封印 / 属性 / 反転の台 / 残響の鉱脈 / 上り階段 | lever / anvil / exchange / bell / captive / seal / element / inverter / vein / ascend | 特別な部屋の触れる物。捕らわれ人は護衛の部屋で守る対象。残響の鉱脈はランイベントで現れ、何度か触れられる | 同上 |
| 木人 | trainingDummy | 試し場と拠点の訓練場の的。動かず殴り返さず、倒しても撃破数・報酬に数えない（拠点では倒れても立ち直る） | `data/enemies.ts` |
| 鏡像 | mirrorSelf | 鏡の部屋で湧く、今のビルドを写した敵 | `data/enemies.ts` |
| ランイベント | runEvent | 予告（HUD の 1 行 + 効果音）の後に始まる一時的なルール変更。増援 / 賞金首 / 停電 / 地震 / 宝の雨 / 気力枯渇 / 刻の裂け目 / 霧 / 呪いの風 / 血の月 / 狂乱の月 / 流星群 / 縮みの呪い / 勢いの風 / 呪詛の声 / 決闘の申し込み / 鈍重 / 地形の氾濫 / 静寂 / 反応の共振 / 雷鳴の刻 / 属性の嵐 / 死神の通り道 / 残響の鉱脈 / 蝙蝠の渡り / 生命の逆流 / 流れ星 / 盗賊の追跡。祝福「雷雨」・刻印符「連鎖」と重ならないよう 雷鳴の刻 / 反応の共振 にした | `system/runEvents.ts` RUN_EVENTS |
| 予告 | warn | ランイベント・長居の代償が始まる前の知らせ。HUD の「予告: …」 | 同上 |
| 長居の代償 | linger | 死神以外の、同じ階にいるほど悪化する仕組み。影の自分 / 天井の崩落 / 潮（満潮） | `system/linger.ts` LINGER_LABEL |
| 起点 | origin | ラン開始時に選ぶ出発条件。放浪者 / 剣の巡礼者 / 呪われた者 / 素手 / 詠み手 / 賭博師 / 死神の友 | `system/runSetup.ts` ORIGINS |
| 縛り / 位階 | runMod / tier | 起点画面で積むラン修飾子と、その点の合計。厚い皮 / 早い手 / 精鋭 / 乾いた泉 / 急かす死神 / 常夜 / 絶えぬ増援 / 荒れた大地 / 長居の二重苦 / 部屋の砂時計 / 薄氷 | `system/runSetup.ts` RUN_MODS |
| 出発 | start | 起点画面でランを始める行 | `ui/origin.ts` START_LABEL |
| 地下 n 階 | depth | 階層 | HUD |
| 死神 | reaper | 長居すると出る無敵の追跡者。コードと設計文書では Reaper。バリアントは 鎖の死神 / 取り立て屋 / 双子の死神 / 影の死神（付き物は 死神の影）/ 静かな死神 | `system/reaper.ts`、`system/reaperVariants.ts` |
| ボス | boss | 階層ボス（スライム王 / 骸骨卿 / 双子の騎士 / 霜の巨人 / 油壺の王 / 群れの母 / 図書館の司書 / 鏡の騎士 / 盗賊王） | `data/enemies.ts`、`system/boss.ts` BOSS_ROTATION |
| 精鋭 | elite | 修飾子付きの敵。接頭辞は 爆裂の / 反射の / 障壁の / 迅速の / 連結の / 残響の / 伝染の / 堅牢の / 報復の / 分光の / 刻限の / 寄生の / 不動の / 貪食の / 群長の / 灼熱の / 封魔の / 号令の / 見切りの / 鎖縛の / 強欲の（2026-09-24 追加。床の遺物・気力結晶を拾って逃げる）。深層では 2 つ重なる組（炎の柱 = 灼熱の + 不動の など）がある | `system/elites.ts` ELITE_PREFIX / ELITE_PAIRS |
| 部屋主 | lairMaster | 巣の主。通常の抽選にも低い重みで混ざる中型の敵（喰らう宝箱 / 鎧の中身 / 骨の楽団長 / 大蝦蟇 / 炎の鍛冶 / 砲台長 / 石化の蜥蜴 / 影踏み） | `data/enemies.ts` |
| 再配色種 | recolor | 元の敵の絵の色を差し替え、挙動を 1 つ足した派生 | `data/enemies.ts` recolor |
| 死骸 | corpse | 倒れた敵の跡。骨拾い・墓守の鐘・貪食の が使う | `system/enemyTraits.ts` |
| 取り巻き | pack / follower | 群れの長・楽団長が連れて湧き、号令で一斉に動く敵 | 同上 |
| 鼓舞 | rally | 支援役の敵が周りの敵に掛ける一時的な強化。帯電（接触で感電、倒れると連鎖雷）/ 急かし（攻撃間隔が速く進む）/ 旗の加護（被ダメージ減） | `system/enemyTerrain.ts` |
| 潜行 | hidden | 土潜り・天井吊り・影踏みが潜っている状態。描かれず攻撃も当たらない。影の予告の後に姿を見せる | `system/enemyWave3.ts` |
| 敵の地形 | terrainSeeds | 敵が作る地形（油・毒沼・水たまり・氷床・炎）。予告の影の後に置かれ、プレイヤーと敵の両方に効く | `system/enemyTerrain.ts` |

敵名: スライム / 浮遊眼 / 猪 / 盾騎士 / 爆弾ゴブリン / 光線眼 / ゴーレム / 蝙蝠 / 鬼火 / スライム王 / 骸骨卿（`data/enemies.ts`）。

量産した敵名（`data/enemies.ts`）:
- 再配色種: 毒スライム / 氷スライム / 炎スライム / 金色スライム / 骨猪 / 呪い眼 / 氷眼 / 黒鉄騎士 / 溶岩ゴーレム / 霜ゴーレム / 結晶ゴーレム / 氷鬼火 / 紫光線眼 / 飛ぶ本 / 灰蝙蝠 / 二度突きの猪（2026-09-24 追加。深度 5〜。突進の予告線が 2 本の折れ線）
- 既存の動きの流用: 若苗スライム / 棘鼠 / 双眼 / 三叉光線眼 / 影蝙蝠 / 狼 / 連投ゴブリン / 槍兵 / 角甲虫 / 投網兵 / 腐肉蝿 / 雷鬼火 / 骸骨兵
- 新しい動き: 導火鼠 / 結晶ダニ / 残像打ち / 群れの長 / 気力喰い / 骨拾い / 墓守の鐘 / 沈黙の修道士 / 霜砕き / 双子の影
- 部屋主: 喰らう宝箱 / 鎧の中身（割れると 鎧の中身・亡霊）/ 骨の楽団長
- ボスと付き物: 双子の騎士（双子の騎士・兄 / 双子の騎士・妹）/ 霜の巨人（氷柱）

Wave 3 の敵名（`data/enemiesWave3.ts`）:
- 地形を作る敵: 泥人形 / 毒吐き蛙 / 油壺運び / 火喰い / 風吹き / 地雷撒き（地雷）
- 支援・仕掛け: 呼び鈴小鬼 / 旗持ち（旗）/ 土潜り / 天井吊り / 吸い込み蟲 / ホムンクルス / 写本の小悪魔 / 十字ゴーレム / 鎖の番人 / 虚ろ / 闇潜み
- 再配色種: 氷猪 / 煤ゴブリン / 苔ゴーレム / 沼鬼火 / 霜蛙 / 熔岩蛙 / 油スライム / 雷眼 / 火種鼠
- 部屋主: 大蝦蟇 / 炎の鍛冶（金床）/ 砲台長（砲台）/ 石化の蜥蜴 / 影踏み
- ボスと付き物: 油壺の王 / 群れの母（卵）/ 図書館の司書 / 鏡の騎士（写し身）/ 盗賊王（盗賊・地雷。盗賊はランイベント「盗賊の追跡」にも出る。第 4 弾）
- 死神の付き物: 死神の影

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
| 支配 / 二重 / 三和音 / 散光 | dominant / dual / triad / scatter | 共鳴の種類。1 色が過半 / 上位 2 色が各 30% 以上 / ちょうど 3 色が各 22% 以上 / 全色が分散 | `loot/resonance.ts` resolveResonance |
| 陰画 | `Resonance.form = "negative"`（kind は dominant） | 反転した性質の重みが 35% 以上で、反転を除いた配合に支配色があると支配が裏返る。冷たい炎（紅）/ 熱い氷（蒼）/ 枯れ森（翠）/ 暗雷（金）。冥の支配は虚極のまま | `loot/resonance.ts` NEGATIVE_EFFECTS |
| 拮抗 | `Resonance.form = "balance"`（kind は dual） | 他の共鳴が成立しないとき、反対色の組（紅と蒼 / 翠と金）がそれぞれ 25% 以上で差 5% 以内なら成立。天秤（紅と蒼）/ 表裏（翠と金） | `loot/resonance.ts` BALANCE_EFFECTS |
| 星座 | ConstellationKey | 6 部位の主色の並びで成立する、共鳴とは別の層の効果。同時に 1 つ。すべて代償付き。双子 / 対岸 / 背骨 / 環 / 鏡像 / 虚空 / 鎖 | `loot/resonance.ts` CONSTELLATIONS |
| 主色 | itemMainColor | 遺物 1 つの性質（implicit を除く）で重みが最も大きい色。同点なら先に付いた性質の色。無色の性質は数えない | `loot/resonance.ts` |
| 無色（性質） | `AffixRoll.colorless` | 脱色した性質。共鳴の配合に数えず、支配の減衰も受けない。行の頭に「無色」 | `loot/crafting.ts` bleachTrait |
| 三和音の名前 | TRIAD_EFFECTS | 四季 / 雷雨 / 煤 / 祭 / 血肉 / 賭場 / 凪 / 沼 / 流星 / 輪廻 | `loot/resonance.ts` |
| 揺らぎ | flux | 期待値（nominal）からの相対的なずれ | `loot/flux.ts` |
| 反転 | inverted | 揺らぎが強く裏返った性質。色は冥、共鳴への重み 2 倍 | `loot/flux.ts` |
| 来歴 | Provenance | 装備中に起きた出来事の記録 | `loot/provenance.ts` |
| 余白 | margin | まだ芽吹ける数 | `loot/types.ts` |
| 芽 | budOffer / buds | 節目で出る 2 択の成長。選ばなかった方は消える | `loot/provenance.ts` |
| 銘 | inscription | 余白を使い切った遺物に来歴から刻まれる名前 | `loot/names.ts` engraveName |
| 誓約 | keystone（`ks_`）。表示は「誓約」に統一 | 遊び方を変える大型改造。排他グループあり | `system/keystones.ts` |
| 誓約名 | - | 硝子の砲 / 狂戦士 / 瞬歩 / 不殺 / 不動 / 賭博師 / 吸血 / 過駆動 / 剣の誓い / 風走り / 過負荷 `ks_overdraw` / 静寂の誓い `ks_silentVow` / 渇きの誓約 `ks_thirst`（後 3 つは気力関連、排他グループ） | `system/keystones.ts` KEYSTONE_NAME |
| 誓約名（2026-09 追加） | - | 無垢の誓い / 蝕みの誓約 / 病みの誓い（status）/ 楔の誓い / 揺るがぬ誓い / 締め上げの誓い（poise）/ 読み勝ちの誓い（tempo）/ 背水の誓い / 死神の誓い（room）/ 詠唱の誓い（mana）/ 単色の誓い / 無色の誓い / 鏡の誓い（hue）/ 修行の誓い / 忘却の誓い（chronicle） | `system/keystones.ts` KEYSTONE_NAME |
| 性質名（2026-09 追加） | `loot/affixes.ts` | 「名前: 効果」で表示する。汲み上げ / 底打ち / 満ち潮 / 引き潮 / 身代わり / 痛覚遮断 / 沈黙の報い / 殲滅の余韻 / 溢れ / 構えの呼吸 / 見切りの息吹 / 詠唱の集中 / 多彩 / 病み上がり / 弱体の盾 / 疫病の種 / 払い手 / 腐れ落ち / 毒気 / 耐性の布 / 払い清め / 楔 / 剥がし撃ち / 崩れの反響 / 怯み吸い / 追い討ち / 渦の芯 / 脆弱の楔 / 重い手 / 崩れ雷 / 崩れの充填 / 崩れの刻印 / 先読み / 崩し打ち / 返し波 / 堅守崩し / ダウン狩り / 撒き足 / 満ちた器 / 夜目 / 封鎖の熱 / 死神の影 / 若木 / 銘の重み / 裏の糧 / 異郷の響き / 橋渡し / 古傷 / 歴戦 / 旅の垢 / 王殺しの印 / 見切りの記憶 / 余韻斬り / 形見 / 撃ち込み杭 / 置き土産 / 杭打ち / 血の署名 / 祝福の響き | `loot/affixes.ts` |
| 目覚め | `AffixDef.awakening` | 芽専用の性質。ドロップ・染めでは出ず、特定の節目の芽の片方にだけ出る（盾割り / 蹴り返し / 剥ぎ取り / 先の先 / 幕引き） | `loot/provenance.ts` MILESTONES |
| 目覚め（2026-09 第 2 弾） | `AffixDef.awakening` | 弱点の目 / 七色 / 逆目 / 地の利を知る / 沼の主 / 奥義 / 秘伝 / 満ち溜め / 型破り / 崩れの色 / 崩勢砕き / 戦の拍子 / 雷導 / 籠城の心 / 熾火歩き / 霜歩き | `loot/affixes.ts`、`loot/provenance.ts` MILESTONES |
| 弱点を突いた / 耐性に阻まれた / 地形の上の撃破 / 得意武器での撃破 / 溜めの命中 / 派生の命中（節目） | weakHits / resistedHits / terrainKills / favoredKills / chargedHits / branchHits | 第 2 弾の来歴の節目。銘の名詞は 急所読み / 逆鱗 / 地這い / 師範 / 満月 / 型破り | `loot/provenance.ts`、`loot/names.ts` |
| 帰還（節目） | returns / `ProvenanceEvent` の returned | 上り階段で浅い階へ戻ったとき装備していた遺物に積もる来歴。最初の 1 回で芽が 1 つ出る（第 4 弾） | `loot/provenance.ts`、`system/floor.ts` ascend |
| 誓約名（2026-09 第 2 弾） | - | 一色の誓い / 弱点の誓い / 無の誓い（element）/ 鉄の誓い / 溜めの誓い / 構えの誓い（weapon）/ 土の誓い / 滑りの誓い / 熾火の誓い（terrain） | `system/keystones.ts` KEYSTONE_NAME |
| 性質名（2026-09 第 2 弾） | `loot/affixes.ts` | 弱点読み / 弱点刺し / 耐性破り / 逆撫で / 通電 / 引火 / 崩れの属性 / 属性の帳 / 溜めの芯 / 溜め崩し / 派生の冴え / 散弾の芯 / 散弾押し / 追尾の毒 / 連射の烙印 / 起爆の手 / 流派の型 / 我流 / 無所属 / 流派の糧 / 地の利 / 滑り足 / 泥除け / 足場狩り / 地の爆ぜ / 残り火 / 霜の轍 / 土の息 / 崩勢狩り / 腐食の爪 / 宣告の鐘 / 籠城 / 封鎖の火花 / 持ち替え / 手替えの呼吸 | `loot/affixes.ts` |
| 攻撃手段 / 持ち替え | AttackMode（melee / ranged / skill） | 近接・射撃・スキルの 3 つ。直前と違う手段で当てることを「持ち替え」と呼ぶ | `system/traitHooks.ts` attackMode |
| 殲滅 / 怯ませた / カウンター / スキル発動 / 精鋭撃破（節目） | lastKills / staggers / counters / skillCasts / eliteKills | 来歴の節目。銘の名詞は 幕引き / 崩し / 先読み / 詠み手 / 剥ぎ取り | `loot/provenance.ts`、`loot/names.ts` |
| 異色 | isOffColor | 既定と別の色で生まれた性質（生成時 10%）。異郷の響きが数える | `loot/traitContext.ts` |
| トリガー | trigger（`tr:`） | 「〜時: 〜」の条件付き効果（trigger × condition × effect） | `loot/triggers.ts` |
| 変換 | conversion（`cv_`） | ある軸の盛りを別の軸へ移す | `loot/affixes.ts` |
| 名のある遺物 | namedKey（旧 unique） | 性質が固定の遺物（値は小さく揺らぐ） | `loot/named.ts` |
| 気力の性質 | maxManaFlat / manaRegenFlat / manaGainPct / manaCostPct / manaOnKillFlat / manaDrought | 最大気力 / 気力自然回復 / 気力回収 / スキルのコスト（代償: スキル威力）/ 撃破で気力 / 撃破で気力・最大気力 −。tag `mana`、色は蒼 | `loot/affixes.ts` |
| 涸れ井戸の指輪 | driedWell | 気力をテーマにした名のある遺物 | `loot/named.ts` |
| 残響 | EchoWallet | 分解で得る色ごとの素材。紅響 / 蒼響 / 翠響 / 金響 / 冥響 | `loot/crafting.ts` ECHO_LABEL |
| 砕く / 染め / 鎮め / 煽り / 削ぎ / 移し / 転調 | shatter / dye / calm / stir / pare / transfer / modulate | 残響タブの操作（第 1 弾の 7 つ）。転調は性質の色だけを反対色へ変える | `loot/crafting.ts` ECHO_OP_LABEL |
| 脱色 / 呼び戻し / 注ぎ / 鍛え直し / 張り | bleach / recall / pour / reforge / tension | 残響タブの操作（第 2 弾の 5 つ）。無色にする / 過去の芽の選ばなかった方を取り直す / 来歴の半分を同じ部位へ注ぐ / 期待値を来歴の最深で取り直す / 代償付きの性質の利得と代償を 1.3 倍 | `loot/crafting.ts` ECHO_OP_LABEL |
| 残響（タブ名） | echo | 装備画面のタブ名（旧「鍛冶」から変更） | `render/inventoryUi.ts` TAB_LABEL |
| 網（タブ名） | web | 装備画面の 4 つ目のタブ。40 語を 5 列に並べ、今のビルドの要素が各語を出す / 食う数と、余り（暖色）/ 飢え（寒色の点滅）を見せる | `render/synergyUi.ts`、`ui/synergyPanel.ts` |
| ここに噛む | `describeSynergy` | 遺物のツールチップ末尾の「語: 出す … 食う …」と「噛む: 〜 / 穴を埋める: 〜 / 余りを食う: 〜」の行 | `loot/describe.ts`、`render/inventoryUi.ts` |
| 出 / 食（祝福カード） | - | 祝福カードの語の行。今のビルドの飢えを埋める語・余りを食う語だけ語の色で明るく、他は暗い | `render/boonUi.ts` |
| 今のビルドと噛む | - | スキル石のツールチップ。石の語がビルドの飢えを埋める / 余りを食うときに出す。連携の先の石が装着済みなら「連携「渦雷」: 引力球 → これ」 | `render/inventoryUi.ts` |
| 連鎖の表示 | `state.chains` | HUD 右下（祝福アイコンの上）に「炎→爆 ×2」のように語の字形で 3 秒出す。深さ 2 以上は大きい文字 | `render/chainUi.ts` |

## 武器種・射撃の型（`docs/COMBAT_DESIGN.md` A-7）

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| 武器種 | moveset（`MovesetKey`） | 武器スロットのベースが決める通常攻撃の型。段数・当たり判定の形・ダッシュ攻撃・溜め・気力回収の傾向 | `data/weapons.ts` MOVESETS |
| 剣 / 大剣 / 双剣 / 槍 / 大鎌 / 拳 / 鞭 / 鉈 / 棍 / 杖 | sword / greatsword / twinBlades / spear / scythe / fists / whip / cleaver / staff / wand | 武器種の表示名。ベース名（短剣・刺突剣・戦鎚など）とは別 | `data/weapons.ts` MOVESETS[].name |
| 射撃の型 | shot（`ShotKey`） | 銃スロットのベースが決める射撃の型 | `data/weapons.ts` SHOT_TYPES |
| 単発 / 連射 / 散弾 / 貫通 / 追尾 / 跳弾 / チャージ / 設置弾 | single / rapid / spread / pierce / homing / ricochet / charge / mine | 射撃の型の表示名 | `data/weapons.ts` SHOT_TYPES[].name |
| 溜め攻撃 | attack.charging / chargeLevel | 攻撃キーの長押しで段を溜めて離す近接（大剣）。刻印符の「溜め」（スキル用）とは別 | `system/player.ts` |
| 穂先 / 先端 | tip（`TipDef`） | 突きの先の部分。槍は怯み値 ×2、鞭は先端だけ満額 | `data/weapons.ts` |
| 扇 / 突き / 円 / 箱 | arc / thrust / circle / box（`HitShape`） | 近接の当たり判定の形 | `data/weapons.ts` |
| コンボ派生 | branches（`BranchDef`） | 左右の押し方の列で差し替わる技。「フィニッシュ」は連撃がそこで終わる派生 | `data/weapons.ts` |
| 派生の技名 | BRANCH_NAMES | 十字断ち / 踏み込み斬り / 薙ぎ払い / 兜割り / 乱れ斬り / 交差斬り / 影踏み / 石突き回し / 飛び込み突き / 刈り取り / 鎌引き / 昇り拳 / 百裂拳 / 踏み込み拳 / 巻き打ち / 鞭鳴らし / 叩き落とし / 肩当て / 旋風 / 払い上げ / 魔力撃 / 杖払い | `data/weapons.ts` |
| 近接 / 射撃 / 溜め（ボタンの役割） | ActionKind: melee / shot / charge | 武器種ごとの左クリック・右クリックの役割 | `data/weapons.ts` |
| 多段ヒット / 踏み込み / 残像 | hits / lunge / trail | 1 振りで複数回当たる / 振りながら前へ出る / 振りの線 | `data/weapons.ts` |
| 引き寄せ / 投げ | pull / throw | 大鎌の手前へのノックバック / 拳のダッシュ攻撃の背後へのノックバック | `system/player.ts` knockDirection |
| 手甲 / 鞭 / 杖 / 跳ね銃 / 置き撃ち筒 | gauntlets / whip / wand / ricochetGun / mineLauncher | 武器種・射撃の型の器になるベース（implicit なし） | `loot/bases.ts` |

## ジョブ（`docs/COMBAT_DESIGN.md` A-9）

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| ジョブ | job（`JobKey`） | ラン開始時に起点とは別に選ぶ戦い方。ステータスの偏り・得意な武器・固有のルール 2 つ・初期スキル石・弱点を持つ | `data/jobs.ts` JOBS |
| 見習い / 剣士 / 狩人 / 拳闘士 / 盾持ち / 呪術師 / 槍兵 / 術士 / 影 / 錬金術師 | none / swordsman / hunter / brawler / shieldBearer / hexer / lancer / invoker / shadow / alchemist | ジョブの表示名。見習い = ジョブなし（既定）。起点「放浪者」「詠み手」と紛れないよう、ジョブ側は 見習い / 術士 にした | `data/jobs.ts` JOBS[].name |
| 得意な武器 | favored | ジョブごとの武器種 2〜3。持っている間は近接の威力と攻撃速度が上がる | `system/jobs.ts` applyJobStats |
| 弱点 | weakness | ジョブのトレードオフ（最大生命・射撃の威力・移動速度などが下がる） | `data/jobs.ts` |
| 初期スキル石 | starterSkill | ジョブの石。そのスキルの石をまだ持っていなければ、ラン開始時に倉庫へ加わる | `system/jobs.ts` startJob |
| ジョブを選ぶ | `OriginStage` の job | 起点画面の 1 段目。決定で「起点を選ぶ」段へ進み、Esc で戻る | `ui/origin.ts` |
| ジョブの解放 | `QuestReward` の job | 依頼の報酬。呪術師（血の道）/ 槍兵（急所読み）/ 術士（連鎖の糸）/ 影（見切りの舞）/ 錬金術師（三段の連鎖） | `meta/quests.ts` |
| 百芸の旅人 | jobsAll | 見習い以外のすべてのジョブで探索を終える実績 | `meta/achievements.ts` |

## 攻撃ジャンル・属性・防御（`docs/COMBAT_DESIGN.md` A-8）

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| 攻撃ジャンル | `AttackGenre`（range × quality） | 範囲軸と質軸の組み合わせ。表示は「近接・物理」 | `core/element.ts` genreLabel |
| 近接 / 遠距離 / 範囲 | `AttackRange`: melee / ranged / area | 範囲軸。射撃の型・遠距離のスキルは「遠距離」（ボタンの役割の「射撃」とは別） | `core/element.ts` RANGE_LABEL |
| 物理 / 魔法 / 混成 | `AttackQuality`: physical / arcane / hybrid | 質軸。物理はアーマー（敵は防御）、魔法は魔防、混成は両方の平均で受ける | `core/element.ts` QUALITY_LABEL |
| 属性 / 無属性 / 炎属性 / 氷属性 / 雷属性 / 毒属性 / 闇属性 / 光属性 | `Element`: none / fire / ice / lightning / poison / dark / light | 攻撃の属性。状態異常（燃焼・冷気…）とは別。表示は「炎属性」、耐性は「炎耐性」 | `core/element.ts` ELEMENT_LABEL |
| 魔防 | `PlayerStats.warding` / 敵の `EnemyDefenseDef.warding` | 魔法の軽減。アーマーと同じ逓減式 | `loot/stats.ts`、`data/enemyDefense.ts` |
| 防御（敵） | `EnemyDefenseDef.defense` | 敵の物理の軽減 %。プレイヤー側は「アーマー」 | `data/enemyDefense.ts` |
| 〜耐性 / 全属性耐性 | `PlayerStats.resist` | 属性ごとの軽減 %（50 を超えた分は半分、上限 75、下限 −100）。全属性耐性は無属性を除く | `loot/affixes.ts` res_* |
| 弱点 / 耐性（浮き文字） | `ELEMENT.weakText` / `resistText` | 敵の耐性が負 / 正の属性で当てたとき | `system/elementCombat.ts` |
| ダメージ数字の種類（2026-09-24 第 3 弾） | `FloatTextKind`: crit / weak / resist / dot / reaction / normal | 会心 / 弱点 / 耐性 / 継続 / 反応 / 通常の 6 種で色と大きさを変える（会心 > 反応 > 弱点 > 耐性 の優先順で 1 つ選ぶ）。継続（dot）は 0.5 秒ぶんを敵ごとに束ねて小さく表示 | `system/effects.ts` damageTextKind |
| 弱点の印 / ？ | `weaknessMark` | 敵の頭上の弱点の色。このランでその種類を倒すまでは「？」 | `render/elementUi.ts` |
| 属性の変換（近接・射撃の n% を炎属性に変換） | `cv_infuse*` / `PlayerStats.infuse` | 通常攻撃の一部を属性として扱う変換 | `loot/affixes.ts` |
| 無の刻印 | `cv_infuseNone` / `skillNeutral` | スキルの属性の n% を無属性に変換する | `loot/affixes.ts` |
| 堅牢 | `sturdy` | アーマーと魔防 + / 移動速度 − の性質 | `loot/affixes.ts` |

## スキル・ラン内

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| スキル石 | SkillStone | 永続のアクティブスキル。変異軸とリンク数だけがロールされる | `skills/` |
| 刻印符 | rune / modifier | スキルのリンクに刺す修飾子。拾うと所持品に入り、装備画面で石に付け外しする（石と一緒に持ち越す） | `skills/data.ts` MODIFIERS、`skills/persistence.ts` |
| 所持（刻印符） | `SkillProfile.runes` / RuneItem | 石に付けていない刻印符。スキルタブの刻印符の列に「所持 n/60」と出す。上限を超えると拾えず床に残る（浮き文字「刻印符が満杯」） | `skills/persistence.ts`、`render/skillRuneUi.ts` |
| 付ける / 外す / 捨てる（刻印符） | attachRuneToStone / detachRuneFromStone / discardRune | 選択中スロットの石に所持刻印符を付ける・石から所持品へ戻す・所持品から捨てる。石に付いた符は列で「付」と出す。付けられない理由の表示は「このスキルには付けられない」「リンクの空きが無い」「同じ刻印符が付いている」「型替え符は 1 枚まで」「付いている刻印符と排他」「スロットにスキル石が無い」 | `ui/skillRunes.ts` |
| ラン内の刻印符 | `SkillSlotState.runModifiers` | 起点「詠み手」の開始時に自動で付く、このランだけの刻印符。石に付けた符より後ろに並び、押し出されるのはこちらだけ | `system/skills.ts` attachRune |
| 本動作 | `SkillDef.exclusiveGroup: "body"` | 体を使うスキル（近接・移動・照準）。本動作どうしは同時に発動できず、それ以外（設置・射撃・強化）は並行して撃てる。HUD では本動作の最中に同じ組のスロットが暗くなる | `skills/data.ts` BODY_SKILL_KEYS |
| 溜め | charge | 長押しで威力を上げる刻印符 | 同上 |
| 祝福 | boon | 階層到達時の 3 択。ルール変更が中心 | `system/boons.ts` |
| 呪い付き | cursed | 強い効果 + 代償の祝福 | 同上 |
| 気力系の祝福 | springWell / bloodMana / reaperCup / keenBreath / circulation / hollowVessel | 湧水 / 血の対価 / 屠りの盃 / 見切りの息 / 循環 / 虚ろの器。気力の回復・軽減のルールを変える（tag `mana`）。「血の代償」は祝福 clearHeal と刻印符で既に使っているので bloodMana は「血の対価」 | `system/boons.ts` |
| 祝福のレア度 | common / rare / epic | 通常 / 希少 / 極稀 | `render/boonUi.ts` |
| 系譜 | `BoonDef.lineage` / `after` | 同じ主から出る 4 段の祝福。前段を持つと次段が 3 択に出る。1 回の 3 択に同じ系譜は 1 枚まで。カードに「灰燼 2段」のように出す | `system/boonDefs.ts`、`render/boonUi.ts` |
| 系譜名 | ash / frost / thunder / moon / earth / blade | 灰燼 / 霜枷 / 雷鳴 / 月蝕 / 大地 / 刃鳴（`LINEAGE_LABEL`） | `system/boonDefs.ts` |
| 奥義 | 系譜の 4 段目 | 3 段目に加えて装備（またはスキル石）のタグを要求する最終段。焦土 / 永冬 / 雷神の鼓 / 月蝕 / 大地の怒り / 百刃 | 同上 |
| 結び / 結び祝福 | `BoonDef.duo` | 特定の 2 つの祝福を両方持つと出る合体祝福。共鳴の「二重」と衝突するので「二重祝福」とは書かない。1 回の 3 択に 1 枚まで | 同上 |
| 出す | `BoonDef.gives` | その祝福が作り出すもの（燃焼・脆弱など）。持っていると、それを食う祝福が出やすくなる | 同上 |
| 呪いを受けて 4 択 | `takeCurse` | 3 択の画面で呪い付き祝福を 1 つ受け、4 枚目の候補を足す（3 / X か札のクリック、4 枚目は 4 / Z） | `system/boons.ts`、`render/boonUi.ts` |
| 系譜の祝福名 | emberSeed … eclipse / leyLine … hundredBlades | 灰燼: 火種 / 延焼 / 灰積もり / 焦土。霜枷: 霜息 / 凍て足 / 砕氷の鐘 / 永冬。雷鳴: 静電気 / 帯電の刃 / 落雷予告 / 雷神の鼓。月蝕: 月読 / 満ち潮 / 新月 / 月蝕。大地: 地脈 / 足場崩し / 油撒き / 大地の怒り。刃鳴: 刃鳴 / 重ね刃 / 溜め鳴り / 百刃 | `system/boonDefs.ts`、`system/boonDefsWave2.ts` |
| 結びの祝福名 | swallowReturn … waveReturn / oilBlast … weakChain | 燕渡り / 疫血 / 雷爆走 / 総崩れ / 饗宴の盃 / 臨界 / 虚刃 / 冬籠り / 明鏡 / 瞬停 / 波返し / 油火爆 / 氷上の舞 / 雷雨 / 地走り / 狩場の王 / 弱点連鎖 | 同上 |
| 拡張の祝福名 | bulletSteal … fireWalk | 奪弾 / 口封じ / 睨み / 威圧 / 死神遊び / 起き上がり狙い / 属性の轍 / 呼び戻し / 狩り立て / 霜読み / 毒崩し / 看破 / 両輪 / 氷伝い / 試練の徒 / 片翼 / 見切り返し / 抜き胴 / 跳ね弾 / 炸裂弾頭 / 狙い目 / 燠火 / 神経断ち / 返り血 / 血裂き / 綻び広げ / 背討ち / 静寂の間 / 見逃さぬ / 崩し連鎖 / 立て直し狩り / 際打ち / 換金 / 取り返し / 傷の記憶 / 死神の影 / 時間稼ぎ / 死に急ぎ / 重荷 / 業の火 / 乾坤 / 余韻 / 伏兵返し / 見定め / 力の簒奪 / 綱渡り / 飛燕 / 詠唱返し / 満月撃ち / 持ち越し / 火渡り。状態異常「腐食」・スキル「跳弾」「燕返し」・状態異常「裂傷」と重ならないよう、祝福は 毒崩し / 跳ね弾 / 燕渡り / 血裂き にした | 同上 |
| 第 2 弾の祝福名 | rockStance … drenched | 武器種: 岩の構え（大剣）/ 影分身（双剣）/ 穂先貫き（槍）/ 鎌の実り（大鎌）/ 連打の熱（拳）/ 鞭の脅し（鞭）/ 叩き割り（鉈）/ 棍の響き（棍）/ 杖の灯（杖）。射撃の型: 油の地雷 / 撃ち離れ / 毒蜂 / 礫雨。属性: 弱点突き / 耐性崩し / 油火斬り / 属性の奔流 / 闇喰らい / 光刺し / 水面の雷。地形: 氷滑り / 野焼き / 水走り / 凍て水。ジョブ: 得物の誉れ / 無名の誇り / 他流。部屋: 巣窟の主 / 群れ喰らい / 徘徊狩り / 迷い討ち / 旅慣れ / 口火。反応: 反応の余熱 / 蒸気隠れ。気力: 織り交ぜ / 満ち溢れ。呪い: 血染めの地 / 一念 / 焦がれ刃 / 狂い咲き / 野良の賞金 / 重き誓い / 濡れ鼠。刻印符「溢れ」・共鳴・分岐「刈り取り」「鞭鳴らし」と重ならないよう、満ち溢れ / 属性の奔流 / 鎌の実り / 鞭の脅し にした | `system/boonDefsWave2.ts` |
| 武器種・射撃の型・ジョブの祝福 | `BoonDef.loadout` | その武器種（射撃の型・ジョブ）を今持っているときだけ 3 択に出る祝福。大剣を持たない者に大剣の祝福は出ない | `system/boonDefs.ts`、`system/boons.ts` loadoutMatches |
| 地形（祝福のタグ） | `BoonTag` の `terrain` | 地形を踏む・撒く・広げる祝福のタグ。祝福が出すタグとして重みに乗る（装備からは出ない） | `system/boonDefs.ts` |
| 足止め / 還流 / 雷鼓 / 奪弾 / 灰 | - | 祝福の浮き文字（死神遊び / 払った気力が戻る / 雷神の鼓 / 奪弾 / 灰を拾った） | `system/boonRules.ts` |
| 再駆 / 溢れ / 狩場 / 巣窟の主 | - | 第 2 弾の祝福の浮き文字（ダッシュの回数が戻った / 満ち溢れで気力が戻った / 狩場の王 / 巣窟の主） | `system/rules.ts`、`system/boonRules.ts` |
| 返却 | refundCharge | 刻印符「連鎖」でキルした時にチャージを 1 戻す時のフローティングテキスト | `skills/hit.ts` |
| 型替え符 | `ModifierDef.reshape` | 発動の「型」（近接 / 射撃 / 設置 / 溜め / 足元 / 罠）を変える刻印符。リンクを 2 本使い、1 スロットに 1 枚まで | `skills/modifiers.ts`、`skills/modifiers2.ts` |
| 罠（型替え符「罠化」） | `SkillRunState.traps` | 撃たずにカーソル地点へ置く罠。起動後に敵が近づくと、罠の位置から最寄りの敵へ向けて元のスキルが起きる（最大 3） | `system/skills.ts` |
| 変身 | `SkillTag` の `form` / `SkillRunState.form` | 一定秒だけ武器種が変わる強化スキル（剛の型 = 大剣 / 迅の型 = 双剣 / 霊の型 = 杖）。変身の瞬間に周りを打ち、切れた後は少しの間遅くなる（反動）。変身先がジョブの得意な武器種なら長く続く | `skills/actions2.ts` |
| 変身（2026-09-24 第 3 弾） | `SkillRunState.shape` / `Wave3SkillKey` | 左右クリックの動作そのものを差し替える強化スキル 5 種: 狼化 / 霊体化 / 砲身化 / 鉄塊化 / 業火の化身。第 2 弾の剛の型・迅の型・霊の型と合わせて計 8 種の変身は待ちを共有し、同時に 1 つしか変身できない | `skills/forms.ts`、`skills/defs3.ts` |
| 使い込み | `SkillStone.wear` | スキル石の来歴。手動で撃った回数と命中数を数え、節目で芽が 1 つ出る。装備画面のスキルの説明に「使い込み 発動 n / 命中 n」と出る | `skills/wear.ts` |
| 芽（スキル石） | `WearBud`（link / power） | 使い込みの節目で出る変化。1 発で多くに当てた石は「威力」、撃ち続けた石は「枠」（刻印符のリンク +1。負担には数えない）。石ごとに 2 つまで | `skills/wear.ts`、`skills/tuning2.ts` WEAR_TUNING |
| 連携 | `ComboKey` / `SkillRunState.lastCast` | スキル A の直後にスキル B を手動で撃つと B が変化すること。成立すると「連携: 渦雷」のように浮き文字が出る。HUD の枠の左上の点滅する菱形が「連携可」 | `skills/combos.ts`、`render/skillHud.ts` |
| 連携名 | wellThunder … reelStomp | 渦雷（引力球 → 雷撃）/ 引き回し（鎖鎌 → 旋風斬り）/ 返し撃ち（パリィ成功 → 撃ち抜き）/ 落地裂（墜星 → 地裂き）/ 総解き（伝染 → 綻び）/ 血風（血の契約 → 旋風斬り）/ 氷砕き（氷結地帯 → 砕氷槌）/ 影刺し（影渡り → 刺し穿ち）/ 疾風弾幕（加速 → 回転弾幕）/ 手繰り踏み（手繰り糸 → 震脚） | `skills/combos.ts` COMBOS |
| 第 2 弾の連携名 | waterFreeze … levelMeteor | 瞬氷（水瓶 → 瞬凍）/ 走り火（油流し → 焼き払い）/ 烙火連（焼き印 → 烙火）/ 崩し落とし（崩し蹴り → 崩落槌）/ 彩爆（彩刻 → 色解き）/ 地裂墜（地均し → 墜星）。空間の連携（直前に撃っていなくてよく、照準地点が設置物の中なら成立）: 渦爆（引力球の中へグレネード）/ 氷雷（氷結地帯の中へ雷撃）。化身の極意（変身中の極意）。祝福「凍て水」「油火斬り」と重ならないよう瞬氷 / 走り火にした | `skills/combos.ts` COMBOS |
| 空間の連携 | `ComboDef.untimed` / `requiresAt` | 時間ではなく照準地点で成立する連携（渦爆・氷雷）。HUD の「連携可」の菱形は照準地点が分からないので出ない | `skills/combos.ts` |
| 連動体 | `SkillTag` の `summon` | 召喚スキルが出す味方の物体。自分では攻撃せず、近接 3 段目（剣の墓標）・射撃（砲台）に合わせてだけ動く | `skills/summons.ts` |
| 対象なし / 燃焼なし / 出血なし / 感電なし / 戻れない | - | 撃つ前に弾かれたときの浮き文字（何も払わない）。影渡り・伝染 / 燃え種爆ぜ / 血抜き / 放電 / 巻き戻し | `skills/actions.ts` extraCastBlock |
| 烙印なし / 彩痕なし / 濡れなし | - | 第 2 弾の撃つ前に弾かれたときの浮き文字（何も払わない）。烙火 / 色解き / 瞬凍（濡れた敵も水たまりも無い）。死の宣告は「対象なし」 | `skills/actions2.ts` wave2CastBlock |
| 地均し n / 火吸い n / 宣告 / 剛の型・迅の型・霊の型 / 変身が解けた / 芽: 刻印符の枠 +1 / 芽: 威力 +n% | - | 第 2 弾の浮き文字（砕いた地形の数 / 吸った炎の数 / 死の宣告を付けた / 変身した / 変身が切れた / 使い込みの芽） | `skills/actions2.ts`、`skills/wear.ts` |
| 満タンでない / 気力が多い / 返済待ち | - | 気力不足以外で撃てないときの浮き文字（満月の砲 / 枯渇の刃 / 刻印符「後払い」の返済前） | `system/skills.ts` |
| 綻び n / 収穫 / 剥奪 / 処断 / 刃先 / 背面 / 傷返し n | - | スキルの浮き文字（消した状態異常の種類数 / 毒の収穫 / 弱体を奪った / 沈黙を消費 / 断頭振りの刃先 / 影渡りの背面ヒット / 剥がした種類数） | `skills/shots.ts`、`skills/actions.ts`、`system/skills.ts` |

スキル名: 旋風斬り / 突進斬り / グレネード / 撃ち抜き / パリィ / 血の契約 / 地裂き / 雷撃 / 引力球 / 地雷 / 加速 / 鎖鎌 / 回転弾幕 / 氷結地帯。刻印符名: 多重 / 血の代償 / コンボ燃料 / 反響 / 貫通 / 反動 / 連鎖 / 呪い / 遅延 / 拡大 / 溜め（`skills/data.ts`）。

大拡張のスキル名（`skills/defs.ts`）: 伝染 / 綻び / 燃え種爆ぜ / 五彩の礫 / 満月の砲 / 枯渇の刃 / 影渡り / 爆薬樽 / 剣の墓標 / 砕氷槌 / 血抜き / 毒の収穫 / 放電 / 追い討ち / 処断 / 刺し穿ち / 剥奪 / 背水の一閃 / 連環撃 / 恨み返し / 断頭振り / 跳弾 / 風切り / 散弾符 / 震脚 / 手繰り糸 / 墜星 / 燕返し / 骨片の輪 / 巻き戻し / 傷返し / 湧き石 / 砲台。

大拡張の刻印符名（`skills/modifiers.ts`）: 後払い / 返金 / 血の肩代わり / 溢れ / 渇き撃ち / 刃の給油 / 定刻（気力型を再使用型に。「刻限」は精鋭修飾子と祝福で使っているので避けた）/ 燃料化 / 過熱 / 重撃 / 軽打 / 突き放し / 手繰り / 延命 / 伝播 / 追撃 / 散り際 / 延長 / 着地衝撃 / 背水 / 同調 / 巡り / 背面 / 至近 / 遠当て。型替え符名: 投げ刃 / 投げ込み / 段階溜め。

第 2 弾のスキル名（`skills/defs2.ts`）: 地形 = 水瓶 / 油流し / 焼き払い / 凍て道 / 地均し / 火吸い / 沼呼び。状態異常 = 焼き印（烙印）/ 烙火 / 崩し蹴り（崩勢）/ 崩落槌 / 水刃（濡れ）/ 瞬凍 / 彩刻（彩痕）/ 色解き / 吸魔の矢（吸魔）/ 死の宣告（宣告）。属性・武器種 = 移ろい刃（炎 → 氷 → 雷 → 毒と巡る）/ 極意（武器種で形が変わる: 十文字・大車輪・乱れ突き・槍衾・大刈り・猛打・先端打ち・唐竹割り・大回し・魔弾）。変身 = 剛の型 / 迅の型 / 霊の型。空間 = 結界杭。第 4 弾（地形）= 泥沼（泥を広げ、中の敵に怯み値）。敵「油壺」・祝福の系譜段「奥義」・分岐「十字断ち」「兜割り」「刈り取り」「百裂拳」「薙ぎ払い」・祝福「叩き割り」、状態異常「宣告」と重ならないよう、油流し / 極意 / 十文字 / 唐竹割り / 大刈り / 猛打 / 大回し / 死の宣告 にした。

第 2 弾の刻印符名（`skills/modifiers2.ts`）: 炎化 / 氷化 / 雷化 / 毒化（属性を差し替え、命中で状態異常。同時に 1 つだけ効く）/ 揺さぶり（崩勢）/ 彩り（共鳴の色の彩痕）/ 地染め（命中位置に属性の地形）/ 心得（ジョブの得意な武器種なら強い）/ 武器写し（属性を近接の武器に揃える）/ 化身（変身中は強い）/ 深化（変身が長く、反動も長い）。祝福「地脈」「崩し連鎖」「得物の誉れ」と重ならないよう、地染め / 揺さぶり / 心得 にした。型替え符名: 自己中心化（足元で起きる）/ 罠化。第 4 弾の刻印符: 地崩れ（地裂き専用。命中線が崩れる床になる。状態異常の反応「崩落」・スキル「崩落槌」と重ならないよう「地崩れ」にした）。

## メタ進行（図鑑・依頼・実績。`src/meta/`）

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| 図鑑 | codex | 見た・起きたものの記録。タブは 敵 / 遺物 / 祝福 / 連携 / 場所（2026-09-24 第 3 弾で「反応」「連鎖」タブを「連携」1 頁へ統合）。未発見は「？？？」と片側だけのヒント（反応なら「燃焼 + ？」） | `meta/codex.ts` |
| 連携（図鑑タブ・発見） | `LinkKind` / `CodexTab` の `link` | スキルの連携（`ComboKey`）・状態異常の反応（`ReactionKey`）・2 語以上の連鎖の 3 系統をまとめた発見の単位。id は「系統:key」。初めて成立したランの階とシードを記録し、5 / 15 / 30 種の節目で図鑑の頁と称号が開く | `meta/links.ts`、`meta/codex.ts` |
| 手がかり | - | 祝福 3 択（選択画面）に常時出る、今のビルドで成立し得る未発見の連携を片側伏せた行。「手がかり: 〜」 | `render/boonUi.ts`、`render/chainUi.ts` |
| 新たな連携 | - | 連携を初めて見つけた瞬間に HUD へ出す表示。「新たな連携「〜」」 | `render/chainUi.ts` |
| 祝福カードの印（2026-09-24 第 3 弾） | `BoonMark` | 祝福カード下段の 3 種の印。穴を埋める（飢えを満たす）/ 流れを太くする（余りを食う）/ 新しい流れ（どちらでもない） | `render/boonUi.ts` BOON_MARK_LABEL |
| 名のある連鎖 | `NamedChain` | 語の並び（連鎖）が特定の 2 語に一致すると付く名前。延焼 / 毒の連なり / 霜の連なり / 雷の連なり / 血の連なり / 誘爆 / 霜雷の兆し / 蒸気の兆し / 雷走り / 崩れの連なり / 設置の循環（計 12 エントリ） | `meta/links.ts` NAMED_CHAINS |
| 見た / 撃破 | `seen` / `killed` | 図鑑の敵の記録。見た = 予兆・命中・被弾で関わった、撃破 = 倒した回数 | `meta/codex.ts` |
| 常時の反応 | `CONSTANT_REACTIONS` | イベントを出さない反応（溶解・裂傷・崩落・萎縮・凍毒・恐慌・氷鎧・魔断）。2 つの状態異常が同時に付いたら起きたとみなす | `meta/codex.ts` |
| 階の種類 / 部屋 | - | 図鑑「場所」タブの 2 区分（バイオームと部屋の種類） | `meta/codex.ts` |
| 図鑑の頁 | page | 依頼の報酬。持っているタブは未発見の手がかりが 1 段詳しくなる（反応は両側、敵は頭文字、遺物・祝福は説明文、場所は名前） | `meta/quests.ts` の `codexPages` |
| 依頼 | quest | ラン開始時に 3 択から 1 つ受けるお題。達成で永続の報酬（強さではなく選択肢と表現）。未達成なら次のやり直しへ引き継ぐ。「契約」は使わない | `meta/quests.ts`、`ui/quests.ts` |
| 受けずに出発 | - | 依頼の 3 択で何も受けない選択 | `render/questUi.ts` |
| 目標 / 報酬 | goal / reward | 依頼の札の表記。報酬は 起点の解放 / 名のある遺物が抽選に加わる / 図鑑の頁 / 称号 | `meta/quests.ts` |
| 依頼名 | burnout … burstMaster | 燃え尽き / 蒸気の手 / 揺るがす者 / 誓約なき者 / 反応の目録 / 連携の稽古 / 巣窟崩し / 王殺し / 刃のみ / 無傷の階 / 見切りの舞 / 返し手 / 五重苦 / 呪いを抱く / 大博打 / 死神と踊る / 連鎖の糸 / 三段の連鎖 / 凍てつく刃 / 毒の庭 / 血の道 / 急所読み / 詠唱の道 / 深みへ / 試練を越えて / 部屋主狩り / 雷の狩り / 解き放つ者 | `meta/quests.ts` |
| 依頼名（2026-09-24 第 3 弾、発見系 5 件） | pathfinder / newReaction / comboForms / chainForms / linkWeb | 未踏の連携 / 新しい反応 / 連携の型 / 糸の綾 / 網の目 | `meta/quests.ts` |
| 実績 | achievement | 図鑑・依頼・履歴から判定する記録。解除した実績の名前は称号として名乗れる | `meta/achievements.ts` |
| 実績名（2026-09-24 第 3 弾、発見系 4 件） | link5 / link15 / link30 / comboAll | 連携の芽生え / 網の読み手 / 連携の賢者 / 型の極み | `meta/achievements.ts` |
| 称号 | title | 効果を持たない表示名。実績の名前と依頼の報酬から得る。タイトル画面に「称号「○○」」として 1 つ出る。「称号なし」で外せる | `meta/achievements.ts` |
| 称号（2026-09-24 第 3 弾、依頼の報酬） | - | 未踏を拓く者 / 錬金の徒 / 型の探究者 / 糸を手繰る者（依頼「未踏の連携」「新しい反応」「連携の型」「糸の綾」の報酬。「網の目」の報酬は図鑑の頁） | `meta/quests.ts` |
| 拠点 | hub | タイトルの後に歩く、敵のいない固定の 1 部屋。設備に近づいて開く。ランの記録（リプレイ）に含めない | `system/hub.ts`、`meta/hub.ts` |
| 井戸 / 掲示板 / 鍛冶場 / 図書館 / 祭壇 / 訓練場 / 記録室 / 庭 | well / board / forge / library / altar / training / archive / garden（`FacilityKey`） | 拠点の設備。井戸 = ジョブ・起点・縛りの画面へ、掲示板 = 依頼の一覧、鍛冶場 = 残響、図書館 = スキル石、祭壇 = 誓約を試す（拠点を出ると消える）、訓練場 = 木人の区画、記録室 = 探索履歴・図鑑・実績の 3 台、庭 = 装備と芽。部屋の種類の「祭壇 / 図書館 / 鍛冶場」とは別物（拠点の中の名前） | `meta/hub.ts` FACILITY_NAME |
| 〜が建った | `newlyBuilt` | 拠点の設備が新しく使えるようになったときのバナー。解放は既存の記録から導き、強さは変えない | `meta/hub.ts`、`render/hubUi.ts` |
| 記念品 / 書架 / 看板 | `HubDecor` | 拠点の飾り。倒したボスの記念品、図鑑の埋まり具合で伸びる記録室の書架、名乗っている称号の看板 | `meta/hub.ts` |
| 出撃（長押し） | depart | 拠点で決定キーを長押しすると、前回の支度と依頼のまま探索を始める | `render/hubUi.ts` |
| ？？？ | `UNKNOWN_NAME` | 図鑑の未発見・起点画面の未解放の起点の表示 | `meta/codex.ts`、`ui/origin.ts` |

## 設計上の用語（未実装を含む）

| 表記 | 意味 | 出典 |
| --- | --- | --- |
| ゴール装備 / BiS | 「これを作れば最強」の装備。作らないのが方針 | `docs/LOOT_DESIGN.md` |
| ソフトキャップ | +100% 超を sqrt 圧縮する逓減 | `loot/stats.ts` |
| 語（キーワード） | 全要素（装備・祝福・スキル石・刻印符・敵・部屋）が共有するシナジーの単位。40 語。内部名 `Keyword` | `core/keywords.ts`、`docs/ideas/synergy-web.md` 1 章 |
| 出す / 食う / 強める | 語への関わり方の 3 動詞。出す = その状況を作る、食う = その状況を条件・燃料にする、強める = 出した結果の量や質を上げる。内部名 `produces` / `consumes` / `amplifies` | `core/keywords.ts` |
| 余り / 飢え | 余り = 出しているのに誰も食わない語。飢え = 食うのに誰も出さない語。ビルドの穴を示す。内部名 `surplus` / `hunger` | `system/keywords.ts` |

装備の「響き・揺らぎ・来歴」（共鳴・揺らぎ・来歴・芽・銘・残響）は実装済み。用語は上の「装備」節を参照（旧: `docs/ideas/loot-identity.md`）。

## 表記の揺れ（要統一。localizer への作業候補）

| 揺れ | 箇所 | 推奨 |
| --- | --- | --- |
| レアリティ `通常` と フロア種別 `通常` と 祝福 `通常` | titleUi / renderer / boonUi | 文脈で区別できるので現状維持 |
