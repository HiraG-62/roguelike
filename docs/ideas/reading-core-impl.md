# 読み合いの手直し（出端・盾隙・止めの中の押下・総浚）の実装の決定

2026-10-02。ブレスト `docs/ideas/brainstorm-20261002/`（面白さ順の 1）の設計書の下書き `raw/6-deep/D02-combat-truth-draft.md` を、ユーザーの回答で絞った版。下書きはメインの作業ツリー（`E:/dev/roguelike/docs/ideas/brainstorm-20261002/raw/6-deep/`）にある。**下書きと食い違うときはこの文書が優先**。

目的: 「予告が黄の間は殴って止められる、赤は受け流す / 避ける」を、画面・報酬・入力・敵の全部で同じ言葉にする。読んで狙った人だけが得をする。

## 1. ユーザーの決定（2026-10-02）

| 項目 | 決定 | 下書きとの差 |
| --- | --- | --- |
| 出端の条件 | 予告が黄の間に **振り始めた** 一撃（近接）/ **撃った** 放出の弾（射撃）だけがカウンター（出端） | 同じ |
| 出端の見せ方 | **文字を出さない**。頭上の「カウンター！」は消し、エフェクト（音・粒・白黒・止め・墨の飛沫など）で表す | 下書きは文字「出端」。文字は出さない |
| 黄の最短秒 | **今のまま**（`yellowMinSec` / `redMinSec` は作らない。`red(T)` も入れない） | 下書きの 2-2 は不採用 |
| 予備動作中を条件にする報酬（C1〜C6） | **黄の間だけ** に揃える | 同じ |
| 盾の敵 | 黄の間は盾を下げる・弾でも崩れる（`shotBlockMul` 0.5）・**弾で押し返す動きは廃止** | 同じ |
| 撃破の止め | 普通の撃破 6 → **3**（ユーザー「1 はさみしい、2〜3 は残したい」）。陣の最後の 1 体・大将・精鋭・ボスは 6 のまま | 下書きは 1 |
| 先受（押した守りを捨てない） | **ヒットストップ中の押下だけ拾う**（受け流し・ダッシュ・攻撃）。振りの戻りの終わり際の先行受付（`bufferSec`）は作らない | 下書きの 2-4 の規則 6 だけ採用 |
| 出端の命中が赤に入ったとき | 敵の攻撃は止めず、怯み値を溜めて技の後に怯ませる（`poise.pending` へ先送り） | 同じ |
| 総浚 | 受け流しの成功を **全ての型の応手** に数える（刃斧・長柄の戦意が止まらないように） | 同じ |
| 来歴の節目「カウンター」の閾値 | 据え置き（計測の後に決める） | 保留 |

## 2. 仕様

### 2-1. 黄赤一致（描画だけ）

`render/renderer.ts` の敵の体の赤い点滅（今は `e.phase === "windup"` の間ずっと）を、予告の色と同じく `attackCommitted(e)` に従わせる。黄の間は赤くしない。

### 2-2. 時刻（`system/readTiming.ts`、新規）

- `Enemy.windupAt`（予備動作が始まった `state.time`）・`Enemy.committedAt`（赤になった `state.time`）。省略可で、生成の既定で埋める
- `markWindupStart(state, e)` を、`e.phase = "windup"` を書く全ての所（`enemies.ts`・`boss.ts`・`bossKit.ts`・`bossFrostGiant.ts`・`bossTwins.ts` ほか。Grep で全件）で呼ぶ。漏れはテストで縛る
- `noteCommit(state, e)`: 初めて赤を見たステップで `committedAt` を書く（`updateEnemies` の後）
- `yellowAt(e, t)` = `e.phase ∈ { windup, strike }` かつ `e.windupAt < t` かつ（まだ赤でない、または `e.committedAt >= t`）。理由は下書き 2-0
- `poise.ts` から再 export。`docs/CODE_MAP.md` に 1 行

### 2-3. 出端（下書き 2-1）

- 近接: `beginSwing` で `AttackState.startedAt = state.time`。`meleeHitEnemy` の判定を `yellowAt(e, a.startedAt)` に
- 射撃: `Projectile.release` が付く弾だけ生成時に `firedAt`。`hitEnemies` で `pr.release && yellowAt(e, pr.firedAt)` なら出端
- 効果: 威力 ×1.5（据え置き）・怯み値 ×1.5（`ACTION.counter.poiseMul` 1 → 1.5）・盾抜け・気力 ×2・ダメージタグ `counter`（`buildContext` で `tags.add("counter")`。共鳴の語「カウンター」の段がこれで初めて効く）
- 出端の止め: 5 ステップ（通常命中の上限 `hitstopNormalMax` の例外）。`FEEL.json` に `hitstopCounter`。`ACTION.counter.hitstopBonus` は削除
- 出来事（`onCounter`・`onTraitCounter`・音・白黒・応手）は **1 振り × 1 体に 1 回**。多段の命中ごとの倍・怯み値は今どおり
- `onCounter` に `tag: "debana" | "parry"` を足す（新しい出来事の種類は作らない）
- 出端の命中が赤に入っていた: 怯み値を溜め、溢れたら `pending` へ先送り（赤の攻撃は止めない。`PoiseHitOptions.readStart`）
- 赤の間に振り始めた命中: 倍・盾抜けなし。新しい効果音 `hitCommitted`（低く鈍い木の打音・短い）を 1 振り 1 回。同じ名前を 0.15 秒以内に重ねない。浮き文字なし
- 見せ方: 「カウンター！」の浮き文字（`data/actionText.ts`）を出さない。今の `counter` の音・粒・白黒（`counterMono`）は残し、命中点に **墨の飛沫**（描画だけ・座標ハッシュで散らす。`state.rng` を使わない）を足して、文字が無くても出端と分かるようにする

### 2-4. 「予備動作中」を条件にする報酬を黄へ（下書き 2-7 の C 列）

C1 性質「先読み」・C2 名のある遺物「星読みの眼」・C3 流儀「狩人」の固有 1・C4 起点の条件 `targetInWindup`（相性表の注記も）・C5 誓約「読み勝ちの誓い」（**出端の命中だけ** ×10、それ以外は今の罰）・C6 奥義の持続中の倍 `vsWindup`。判定は命中の時刻の黄 `yellowAt(e, state.time)`（C5 は出端かどうか）。説明文は黄を言う文に（GLOSSARY の予告の色の語で）。

A 列（`onCounter` の起点・性質・来歴・依頼）の数値は据え置き。依頼「返し手」の説明文だけ「出端か受け流しを 10 回」に。D 列: Tips に出端の項を足す（表示に「出端」の文字は出さないが、仕組みの名として Tips と GLOSSARY には置く）、`meta/weaponTips.ts` の「居合のカウンター」→「居合の出端」、`qa/combatProbe.ts` のカウンターの数え方を浮き文字ではなく `onCounter` の出来事で数える。

### 2-5. 盾隙（下書き 2-5）

- `canBlock(e)`: `yellowAt(e, state.time)` なら盾を下げる
- `deflectProjectile`: 盾の正面で消した弾の怯み値 × `POISE.shotBlockMul`（0.5、新規）を溜める。溢れたら近接と同じく崩れて怯む。弾のダメージは 0
- 弾の受けでは押し返さない（`showBlock` の `blockPushback` は近接だけ）
- 零距離: 型 `pistol`（短銃・二丁拳銃）の弾で、撃った時の盾持ちとの距離が `FORM.pistol.zeroDistance` 以内なら `pr.pointBlank = true` → 盾抜け
- 出端の弾は盾抜け
- 弾の受けは「BLOCK」の浮き文字を出さない。粒を小さく、音 `wallHit` は 1 体 0.15 秒に 1 回まで
- 鏡の騎士の返し（`bossReflects`）とは混ぜない
- 盾を下げた絵は後の段（描画は `yellowAt` を読むだけ）。この段では盾の縁を光らせる描画だけ足してよい

### 2-6. 止め（下書き 2-3 のうち決めた分だけ）

| 出来事 | 今 | 案 |
| --- | --- | --- |
| 普通の撃破 | 6 | **3**（`FEEL.hitstopKill`） |
| 陣の最後の 1 体・大将・精鋭・ボス | 6 | 6（`FEEL.hitstopKillMark`、新規） |
| 出端 | 実質 1 | 5（`FEEL.hitstopCounter`、新規） |
| その他（怯ませた・終撃・受け流し・被弾） | — | 今のまま |

撃破の止めを減らした分は、破片と `kill` の音を少し厚くして保つ（描画と音だけ）。

### 2-7. ヒットストップ中の押下（下書き 2-4 の規則 6）

`core/game.ts` の止めの分岐（`state.hitstop > 0` で `updatePlayer` を通らない所）で `latchFrozenInput(state, input)` を呼ぶ。受け流し・ダッシュは守りの席（`Player.guardBuffer`、1 つ）へ、攻撃は既存の `AttackState.buffered` の作法で 1 つだけ覚える。止めが明けた最初のステップの `readActions` の頭で出す。後から押した方が勝つ（守りと攻撃は後の方だけ残す）。ダッシュの向きは押した時の移動入力。外した受け流しの硬直・怯みの間の押下は今どおり捨てる。

### 2-8. 総浚（受け流しを全型の応手に）

`data/weaponForms.ts` の型ごとの応手の出どころ一覧に `parry` を全ての型で入れる（今は剣だけ）。正本は `raw/4-gaps/G4-player-kit-final.md` の総浚（G4-04）。数値は据え置き。

## 3. 段取り

1. レーン A: 2-1・2-2・2-3・2-4・2-6 の出端の止め
2. レーン B: 2-5・2-6 の撃破の止め・2-7・2-8
3. `REPLAY_VERSION` はブランチ `feat/ink-reading` の最後に 1 回だけ上げる（1〜4 の束）

## 4. テスト

- `yellowAt` の境界（同じステップで赤になった・同じステップで予備動作が始まった）
- `e.phase = "windup"` を書く全ての所で `windupAt` が書かれる（漏れの検査）
- 黄で振り始めて赤で当たった → 出端・敵の攻撃は止まらず技の後に怯む
- 赤で振り始めた → 普通の命中・`hitCommitted` が 1 振り 1 回
- 多段の一撃でも `onCounter` は 1 振り × 1 体に 1 回
- 盾持ち: 黄で盾が下がる・弾で崩れる・弾で押し返されない・零距離の短銃弾が抜ける
- ヒットストップ中に押した受け流し / ダッシュが明けた最初のステップで出る
- 受け流しの成功が全ての型で応手になる
- C1〜C6 が赤の敵には効かない
