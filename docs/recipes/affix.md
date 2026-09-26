# レシピ: 性質（旧アフィックス）/ 変換 / 誓約 / 名のある遺物 / ベース

- 性質: `src/loot/affixes.ts` の `AFFIXES` に `AffixDef`（`curve` = 深度ごとの期待値の点列、`slots`〔頭は `SLOT_ALIAS` で体（armor）の性質を引く。頭だけに出すなら `head` を明示〕、`tags`、`color`〔省略時は `colors.ts` の `colorFromTags` が tags から決める〕、`apply`）。prefix / suffix / tier の区別は無い。値は表示単位（+25% なら 25）。新しい stat が要るなら `loot/types.ts` の `PlayerStats` と `DEFAULT_STATS` に追加し、system 側で読む。強いものほどトレードオフを付ける。装備全体や来歴など「自分の外」を読む性質は `loot/traitContext.ts` の文脈を通す
- 変換: `CONVERSION_AFFIXES`（key は `cv_`）。誓約（旧キーストーン、表示名は「誓約」）: `KEYSTONES`（key は `ks_`、`group` で排他）+ `system/keystones.ts` の `KS` / `KEYSTONE_NAME`
- 名のある遺物（旧ユニーク）: `src/loot/named.ts` の `UNIQUES`（`baseKey` / 固定の性質 / 任意で誓約。`generator.ts` が re-export）。未知 key は生成時に throw するのでテストで気付ける
- ベース: `src/loot/bases.ts` の `BASES` + `affixes.ts` の `IMPLICITS`
- テスト: `loot/affixes.test.ts` / `generator.test.ts` / `stats.test.ts`

最後に `npm run check`。関係するファイルの役割は `docs/CODE_MAP.md`、数値は `docs/BALANCE.md`、表示文字列は `docs/GLOSSARY.md`。
