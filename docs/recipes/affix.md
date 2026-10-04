# レシピ: 性質（旧アフィックス）/ 転じ / 誓約 / 名のある遺物 / ベース

- 性質: `src/loot/affixes.ts` の `AFFIXES` に `AffixDef`（`curve` = 深度ごとの期待値の点列、`slots`〔頭は `SLOT_ALIAS` で体（armor）の性質を引く。頭だけに出すなら `head` を明示〕、`tags`、`color`〔省略時は `colors.ts` の `colorFromTags` が tags から決める〕、`keywords`、`apply`）。prefix / suffix / tier の区別は無い。値は表示単位（+25% なら 25）。新しい stat が要るなら `loot/types.ts` の `PlayerStats` と `DEFAULT_STATS` に追加し、system 側で読む。装備全体や来歴など「自分の外」を読む性質は `loot/traitContext.ts` の文脈を通す
- **性質は 2 種類だけ**（段取り 7d。`docs/ideas/relics-7d-plan.md` 1 章）:
  - **条件の族**: 条件を満たす間だけ効く。`tags` に `condition` を付け、代償は持たない（条件が代償）。`apply` は `s.modifiers = [...s.modifiers, mod(v)]` で Modifier を足すか、条件付きの欄（`increased.vsStaggered` など）だけを動かす。owner は `{ kind: "item", key }`。見本は `purse`（懐。持ち金 50 以上で増。閾値は `ECONOMY.build.pocketCoins`）。Modifier は push せず差し替える
  - **行動**: 状態異常・トリガー・源の欄・`traits.*` を動かし、何かが起きる。代償は基礎の欄を下げる向きだけ
  - **無条件の数値だけの性質は作らない**（`affixes.test.ts` が検査）。近接ダメージ・最大生命・攻撃速度のような数値は地金（`loot/innate.ts`）に置く
- **`keywords` は必須**（`kw(源, 糧, 強め)`。`core/keywords.ts`）。遺物 1 つの共鳴の数えに使う語で、性質・転じの全部が持つ（`affixes.test.ts`）。語の付け方: その性質が起こす状況は源、その状況を条件に強くなるなら糧、結果の量や質を上げるなら強め。地金・implicit は数えない
- **与ダメの数値の書き方**（`docs/STATS_AND_SCALING.md` 3 章）: 性質・地金の与ダメは `s.increased.<タグ> += pct(v)`（増。タグは `core/damage.ts` の `DAMAGE_TAGS`）。誓約・名のある遺物の固有・共鳴など出所 1 つの常時の倍は `s.more = withMore(s.more, {...})`（倍）。`*DamageMul *=` は書かない（そのフィールドは無い）
- 期待値曲線は `src/data/balance/loot/affixCurves/<key>.json`（`_index.json` の `_order` にも足す。`curveFor` は key が無いと tsc で落ちる）。間合い・回数・秒などの数値は `src/data/balance/loot/TRIGGER.json` の `trait` ブロック
- 転じ（旧「変換」）: `CONVERSION_AFFIXES`（key は `cv_`。12 + 属性の変換 6）。「A を B に変換する」形で、`stage: "convert"`。会心時の転じは Rule（`onCrit`）を `s.rules` へ積む
- 誓約（旧キーストーン、表示名は「誓約」）: `KEYSTONES`（key は `ks_`、`group` = `KeystoneGroup` で排他。20 種）+ `system/keystones.ts` の `KS` / `KEYSTONE_NAME`。常時の倍は `keystoneModifiers`、「〜時: 〜」は `keystoneRules`。数値は `src/data/balance/loot/KEYSTONE.json`。共鳴の数えに使う語は `system/keywords.ts` の `KEYSTONE_FACTS`
- 名のある遺物（旧ユニーク）: `src/loot/named.ts` の `UNIQUES`（`baseKey` / 固定の性質 / 任意で誓約 / **固有の効果**）。固有は次のどれかで書く: `rules`（「〜時: 〜」の Rule）/ `modifiers`（常時の増・倍。「〜につき」）/ `apply`（stats を直接書き換える）/ `system/namedRelics.ts` の分岐（Rule と Modifier で書けないもの。共有ファイルからは 1 行で呼ぶ）。`keywords`（共鳴の数え）と `changes`（柱 7 の審査）も書く。数値は `src/data/balance/loot/RELIC.json`（`data/tuning.ts` の `RELIC`）、数え（連打・距離・賽の目・1 階 1 回）は `boonRun.tallies["relic:<key>"]`（`relicTallyKey`。ラン内で消える）。未知 key は生成時に throw するのでテストで気付ける。旧セーブから写すなら `loot/migrate.ts` の `LEGACY_UNIQUE_MAP`
- **到達の軸に効く性質を足したら**（段取り 10a。厳選の到達点 無尽 = 連鎖係数 / 燎原 = 燃焼の重ねの上限 / 常在 = 戦意の上限。`loot/reach.ts`）: 性質が動かす欄が `REACH_DEFS[k].measure` の読む欄（`chainCoefBonus` / `statusStackCapBonus.burn` / `moraleMaxAdd`）なら `REACH_DEFS[k].affixes`（届かせる主な性質の key。先頭が主）に 1 つ足す。QA の届き方の見積もり（`qa:probe --deep`）がこれを読む。閾値は `src/data/balance/loot/REACH.json`。到達は**装備だけ**で数える（装備に付いた性質・名のある遺物・誓約は入る。祝福・起点・祭壇の誓約の足しは入らない）ので、祝福側で同じ欄を動かしても届かない
- ベース: `src/loot/bases.ts` の `BASES` + `affixes.ts` の `IMPLICITS`
- テスト: `loot/affixes.test.ts` / `generator.test.ts` / `stats.test.ts`、名のある遺物は `loot/named.test.ts` と `system/namedRelics.test.ts`

最後に `pnpm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
