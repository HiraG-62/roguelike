# ボスの読み合い（章ボスの作り直し。見本はスライム王）の実装の決定

2026-10-02。章ボスを「待てば隙ができる相手」から「動きを読めば勝て、読まなければ削られて負ける相手」に作り直す。見本はスライム王（章 1・深度 5）。

- 前提: **`docs/ideas/reading-core-impl.md`（読み合いの手直し）が先に入っている**こと。`Enemy.windupAt` / `committedAt`・`yellowAt(e, t)`（`src/system/readTiming.ts`）・出端（予告が黄の間に振り始めた近接 / 撃った放出の弾）・出端の命中が赤に入ったら技の後に怯む、をそのまま使う
- 下書き: メインの作業ツリーの `docs/ideas/brainstorm-20261002/raw/6-deep/D11-boss-slime-draft.md`。**食い違うときはこの文書が優先**（差は 3 章の末尾）
- 世界観は墨。予告の色は全ての敵と同じ関数（`render/telegraphLineUi.ts` の `telegraphColor`）を通し、淡墨 → 濃墨の塗り替えはそちらの段に任せる。ストーリーには触れない

---

## 0. 結論

1. **ボスの「黄」は「打てば何かが起きる技」にだけ付ける**。答えの無い技は予備動作の最初から赤。黄の長さは技が決める（器 `BossHooks.openTime`）。これで「黄 = 止められる / 赤 = 返すか避ける」がボスでも嘘にならない
2. スライム王の 3 段階 = 3 つの動詞の試験。**跳躍 = 黄を打つ（墜落）/ 分裂 = 大将を割る（冠落ち）/ 膨張 = 赤を返す（呑み損ね）**。避ける（見切り・隅）はどの段階でも通るが、ダウンを生まないので遅い
3. 「待てば隙」を 3 か所外す: 消化の棒立ち 1.5 秒・膨張の後の 2.5 秒・分裂体を全部倒すだけで進む段階。大きなダウンは答えでしか出ない
4. 器（`src/system/bossKit.ts`）に足す物は 6 つ（`openTime`・`tickWindup`・答えの口・技の後のダウンの予約・答えの印つき `bossDown`・行為で進んだ段階の記録）。数値を持たず、盗賊王・油壺の王・鏡の騎士・最深の主が同じ書き方で使える
5. 門は QA の 3 列（定跡 A = 読む / 定跡 B = 避ける / 連打）。鏡の騎士の 34 秒は、盾が近接を止めないこと・写し身がボスの技と同時に襲うことを先に直し、その後で生命を上げる

---

## 1. 今のスライム王の何が「待てば勝てる」か

| 観察 | 根拠 | 結果 |
| --- | --- | --- |
| 跳躍は避けるだけで無傷 | `src/system/bossKingSlime.ts:229`（狙いは跳んだ瞬間のプレイヤーの位置）、`:290`（潰しは半径 `shockRadius × 0.4` = 24px）、`src/system/hazards.ts:72-76, 285-294`（衝撃波は縁だけに判定）。空中 `jumpTime` 0.9 秒 × 歩き 120px/秒 = 108px > 衝撃波 60px | 歩いて離れれば当たらない。読む物が無い |
| 着地の後は毎回 1.8 秒の隙 | `src/system/bossKit.ts:120-130`（硬直 → 追跡 → `attackInterval`）、`src/data/balance/enemies/stats/kingSlime.json`（`recover` 0.72・`attackInterval` 1.08・`speed` 45） | 避けた人は必ず殴れる。避ける → 殴る が最適 |
| 攻撃中に関わっても何も起きない | `src/data/balance/enemies/combat/kingSlime.json`（`strikeSuperArmorMul` 0 = 空中は怯み値が溜まらない）、`src/system/poise.ts:57-61`（予備動作の 60% はコミット窓）、耐性 300 × 深度 5 の 1.44 = 432 | 出端を入れてもボスは止まらない。跳躍に向き合う理由が無い |
| 消化の 1.5 秒は棒立ち | `bossKingSlime.ts:152-157`（`recoverTime` の `digestTime`）、`:172-180`（怯ませると吐き出す） | 呑まれるのを待てば、答えなしで殴り放題の時間が来る |
| 膨張の後の 2.5 秒は棒立ち | `bossKingSlime.ts:155`（`exhaustTime` 2.5）、`:136-137`（近いと中央へ跳んで膨張） | 隅で待てば、答えなしで殴り放題の時間が来る |
| 第 2 段階は分裂体 3 体を倒すだけ | `bossKingSlime.ts:93`（分裂体が 0 体で第 3 段階）、`src/system/bossRecord.ts`（`noteBossMinionDeath` で 1 体ごとに耐性の 20%）。`src/qa/probe.md:540`（第 2 段階は戦いの 3%） | 「行為で進む段階」が読みでなく作業になっている |
| 第 1 段階の「止まる相手を潰す」が働いていない | `bossKingSlime.ts:143-150`（静止 0.6 秒で続け跳び）、`src/qa/probe.md:539`（静止中の被弾 0%） | 段階 1 の顔が無い |
| ボスに答えを届ける口が無い | `src/system/behaviors/families.ts:93`（`BossDriven.onStruck` は空）、`src/system/parry.ts:154-161`（ボスへの受け流しは怯み値 40 だけ） | 出端・受け流しをボスが「答え」として受け取れない |
| 跳躍の影が取り消しで消えない | `bossKingSlime.ts:240-247`（`spawnLanding` に `sourceId` が無い）、`hazards.ts:89-101`（`syncLanding` は `sourceId` のある影だけ同期） | 跳躍を止める答えを作ると影だけ残る |

---

## 2. 新しいスライム王

### 2-0. 約束（全段階に効く 4 つ）

1. **黄は答えのある技だけ**: 高い跳躍（`KS_JUMP` と中央へ戻る `KS_CENTER`）だけが黄を持つ。呑み・噛み・膨張は予備動作の最初から赤（`openTime` 0）
2. **高い跳躍の予備動作 = 空中**: 地上の屈みは予告にしない。予備動作が始まった瞬間に跳び上がり（上昇 `jumpRise`）、影の真上で止まり（滞空 `jumpHover`）、攻撃（strike）= 落下（`jumpFall`）。**上昇と滞空の全部が黄、落下が赤**。黄 → 赤は 1 回だけ（`yellowAt` の単調さを守る）
3. **空中の王は影の真上で当たる**: 上昇の間に体（`e.body.pos`）を影の中心まで動かす（空中なので壁を越える。着地点は `spawnSpot` で王の半径が入る所に寄せる）。絵と当たりがずれない
4. **答えの種類は 3 つ**: 出端（黄で振り始めた近接・黄で撃った放出の弾）/ 受け流し / 見切り。スライム王は出端と受け流しだけ使う。出端の命中が赤に入っていた（振り始めは黄）なら、技は止めずに **技の後に** 同じダウンを払う（reading-core 2-3 と同じ作法）

止まる相手への続け跳び（`followUp`）は今のまま連撃なので、**続け跳びは最初から赤**（`chainWindup`）。止まっていて答え損ねた人は、次の跳躍を必ず避けなければならない。

### 2-1. 段階 1「跳躍」（危ない間合い: still）

数値は深度 5（`scaledWindup` の 0.94 倍を掛けた値）。

| 技 | 予告（黄の長さと形） | 読みの答え | 外した罰 | 答えた報酬 |
| --- | --- | --- | --- | --- |
| 跳躍 `KS_JUMP` | 影（半径 `shockRadius` 60）が跳んだ瞬間のプレイヤーの足元に出て縮む。**黄 0.58 秒**（上昇 0.25 + 滞空 0.33）→ 赤 0.35 秒（落下）。頭の「!」と影の縁が同じ色 | **影から逃げず、黄のうちに影の上の王を打つ（出端）→ 墜落** | 赤で振り始めた・逃げ遅れた: 芯（半径 24）で潰し 11（深度で伸びる）+ 衝撃波。0.6 秒止まっていれば続け跳び（赤だけ） | 墜落: その場に落ちてダウン 1.5 秒（自傷のダウン = 堅守が付かない）。衝撃波も潰しも出ない。段階 1 の墜落は数える |
| 続け跳び（連撃） | 影。最初から赤（予備動作 × 0.6） | 避ける（見切り・影の外） | 潰し + 衝撃波 | — |
| 別の答え（B） | — | 影が出たら外へ歩く / 着地の潰しを受け流す | — | 着地の硬直（0.72 秒）と追跡の間を殴る。ダウンは出ない |

- 遅れた出端（滞空で振り始め、落下で当たった）: 着地して潰しと衝撃波は出る（芯にいれば自分も潰される）。**着地の直後に墜落のダウン**（相打ち）。数えるのは同じ
- 落下の前なら上昇中でも滞空中でも、黄のうちなら墜落する（遠くから放出の弾で落としてもよい）

### 2-2. 段階 2「分裂」（危ない間合い: moving）

分裂の瞬間に分裂体 3 体のうち **プレイヤーから最も遠い 1 体が冠を被る**（新しい敵 `crownSlime`「冠スライム」。同じ距離なら生成順の早い方。乱数なし）。冠スライムは攻撃せず、**王の陰**（王から見てプレイヤーの反対側 `crownShade` 26px）へ歩く。王が空中か怯み中の間は陰を追わずその場で震える（= 王が跳ぶと晒される）。

| 技 | 予告 | 読みの答え | 外した罰 | 答えた報酬 |
| --- | --- | --- | --- | --- |
| 跳躍 `KS_JUMP`（1.6 倍速の拍・着地に毒沼） | 影。**黄 0.49 秒**（上昇 0.25 + 滞空 0.24）→ 赤 0.35 秒 | 黄で打つ → 墜落（数えない）。または **王が跳んだ隙に、陰から晒された冠スライムへ詰めて割る** | 潰し・衝撃波・毒沼（床が減る） | 墜落: ダウン 1.5 秒。冠落ち: 下の行 |
| 呑み `KS_SWALLOW` | 屈み（**最初から赤**）→ 王に最も近い冠でない分裂体へ低く跳ぶ（小さな輪 `swallowRingRadius`） | 呑ませる前に分裂体を倒す（B）。冠を割れば残りは溶ける（A） | 呑まれるたびに `digestTime` 後に最大生命の 6% 回復。消化中も王は普通に動く | 消化中に王がダウン（墜落・怯み・冠落ちのどれでも）すれば吐き出して回復しない |
| 冠落ち（冠スライムを倒す） | 冠（絵）。陰に隠れている | 王の跳躍の後ろへ回り込む | 冠でない分裂体が尽きると王は冠を呑む = **冠呑み**: 最大生命の 15% 回復、冠が王へ戻り、そのまま段階 3（失敗の道） | **冠落ち**: 王がダウン 2 秒、残りの分裂体は溶ける（撃破に数えない）、起き上がると段階 3 |

### 2-3. 段階 3「膨張」（危ない間合い: near）

| 技 | 予告 | 読みの答え | 外した罰 | 答えた報酬 |
| --- | --- | --- | --- | --- |
| 噛み `KS_BITE`（near） | 屈み 0.52 秒（**最初から赤**）→ プレイヤーの位置へ低く跳ぶ 0.45 秒（小さな影 `biteRadius` 24、赤だけ） | **着地の瞬間を受け流す → 呑み損ね** | 噛まれる: 14（深度で伸びる。潰しより重い = 返す理由） | 呑み損ね: ダウン 2.5 秒。**最終段階の答え**（引導の窓） |
| 中央へ `KS_CENTER`（mid）→ 膨張 `KS_INFLATE` | 中央への跳躍は高い跳躍（黄 → 赤。墜落できる）。膨張は輪の影（**最初から赤**、1.4 秒）→ 衝撃波 3 重、四隅だけ安全 | 中央への跳躍を黄で落とす（膨張そのものが出ない）。膨張が出たら隅へ（B） | 近・中で衝撃波 3 重 | 墜落: ダウン 1.5 秒（数えない）。隅で凌いだ人の報酬は膨張の後の硬直 1.0 秒だけ |
| 跳躍 `KS_JUMP`（far） | 段階 2 と同じ | 黄で打つ → 墜落 | 段階 2 と同じ（毒沼は残さない） | 墜落 |

**引導**（G3-09。未決 5 で確認）: 呑み損ねのダウンの間に、生命が `POISE.executeHpRatioMax`（25%）以下の王へ怯み値 `POISE.executeMinPoise`（20）以上の一撃が当たると撃破。浮き文字「引導」。処刑の出来事 `onExecute` は出さない（処刑を起点にする祝福・依頼・実績をボスに効かせない）。

### 2-4. 段階の移り方

| 変わり目 | 行為（byAct = true） | 保険・失敗（byAct = false） | いつ移るか |
| --- | --- | --- | --- |
| 1 → 2 | 段階 1 の墜落が `dropsToSplit`（2）回 | 生命 ≤ `phase2Ratio`（0.5） | **王が起き上がった後**の最初の更新（ダウンの途中で分裂しない。怯み中はボスの更新が止まる `src/system/enemies.ts:193-194` ので自然にそうなる） |
| 2 → 3 | 冠落ち | 冠呑み / 生命 ≤ `phase3Ratio`（0.25） | 冠落ちは起き上がった後。冠呑み・保険はその場。保険で移るときは冠スライムと分裂体を溶かす |

「分裂体が 0 体で段階 3」（`bossKingSlime.ts:93`）は外す。冠の生死だけで決まる。危ない間合いは still / moving / near のまま（`BOSS_THREATS` は変えない）。

### 2-5. 技の選び（乱数なし。硬直の終わりの `pickMove`）

| 段階 | 条件（上から） | 技 |
| --- | --- | --- |
| 1 | 常に | `KS_JUMP` |
| 2 | 前の呑みから `swallowEvery` 秒経ち、呑める分裂体（冠でない分裂体、尽きていれば冠）がいる | `KS_SWALLOW` |
| 2 | それ以外 | `KS_JUMP` |
| 3 | `read.band === "near"` | `KS_BITE` |
| 3 | `read.band === "far"` | `KS_JUMP` |
| 3 | 中央にいる | `KS_INFLATE` |
| 3 | それ以外 | `KS_CENTER`（`followUp` で `KS_INFLATE`。連撃なので最初から赤） |

`followUp`: 段階 1 の `KS_JUMP` の後、`stillSec ≥ BOSS.rules.stillSec` なら `KS_JUMP`（`stillJumpChain` 回まで。今のまま）。`KS_CENTER` の後は `KS_INFLATE`（今のまま）。

### 2-6. 外した「待てば隙」と、残した隙

| 隙 | 今 | 案 |
| --- | --- | --- |
| 消化 | 1.5 秒動かない | **外す**。消化は「回復が入るまでの秒」になり、王は普通に動く |
| 膨張の後 | 2.5 秒動かない | 1.0 秒（`inflateRecover`。ふつうの硬直と同じ程度） |
| 段階 2 の進み | 分裂体 3 体を倒すだけ | 冠を割る（読み）か、冠を呑まれる（失敗。回復つき） |
| 着地の硬直 0.72 秒 + 追跡 | あり | **残す**（B の答えの手応え。全ての敵に共通の拍）。門で B が遅すぎ / 速すぎなら `stats/kingSlime.json` の `recover` だけ動かす |

### 2-7. 数値（`src/data/balance/enemies/BOSS/kingSlime.json`）

新しい葉は `_fields` に 1 行ずつ（下の表の説明をそのまま）。`_note` に「2026-10-02 読み合いの作り直し（docs/ideas/boss-reading-impl.md）」を足す。

| 葉 | 今 | 案 | `_fields` の説明 |
| --- | --- | --- | --- |
| `jumpTime` | 0.9 | **削除** | — |
| `phase2JumpTime` | 0.8 | **削除** | — |
| `jumpRise`（新） | — | 0.25 | 高い跳躍: 跳んでから影の真上に着くまでの秒（黄。深度で縮めない） |
| `jumpHover`（新） | — | 0.35 | 高い跳躍: 影の真上で止まる秒（黄。深度で縮む） |
| `phase2Hover`（新） | — | 0.25 | 段階 2 以降の滞空の秒（`jumpHover` の代わり） |
| `jumpFall`（新） | — | 0.35 | 高い跳躍: 落ちる秒（赤。深度で縮めない = 赤を見てからの猶予を一定にする） |
| `dropDown`（新） | — | 1.5 | 墜落のダウンの秒 |
| `dropsToSplit`（新） | — | 2 | 段階 1 の墜落がこの回数で、生命に関わらず分裂する |
| `crownHpRatio`（新） | — | 0.05 | 冠スライムの生命 = 王の最大生命 × これ（深度 5 で約 90） |
| `crownShade`（新） | — | 26 | 冠スライムが隠れる、王から見てプレイヤーの反対側の距離（px） |
| `crownDown`（新） | — | 2.0 | 冠落ちのダウンの秒 |
| `crownHealRatio`（新） | — | 0.15 | 冠呑みで回復する最大生命の割合 |
| `swallowEvery` | 6 | 4.5 | 段階 2 で前の呑みから次の呑みまでの秒（段階 2 が短くなる分、呑みの圧を上げる） |
| `digestTime` | 1.5 | 1.5（意味を変える） | 呑み込んでから回復が入るまでの秒。その間も王は動き、ダウンすると吐き出す |
| `biteWindup`（新） | — | 0.55 | 噛みの屈みの秒（最初から赤。深度で縮む） |
| `biteHopTime`（新） | — | 0.45 | 噛みの低い跳びの空中の秒（赤） |
| `biteRadius`（新） | — | 24 | 噛みの当たりの半径（px）。影も同じ |
| `biteDamage`（新） | — | 14 | 噛みのダメージ（深度で伸びる） |
| `biteMissDown`（新） | — | 2.5 | 呑み損ね（噛みを受け流された）のダウンの秒 |
| `exhaustTime` → `inflateRecover` | 2.5 | 1.0 | 膨張の後の硬直の秒 |

- 据え置き: `shockRadius` 60・`shockDamage` 11・`phase2Ratio` 0.5・`splitCount` 3・`phase2SpeedMul` 1.6・`stillJumpChain` 1・`acidRadius` / `acidTime`・`swallowHopTime` 0.6・`swallowRingRadius` 24・`swallowHealRatio` 0.06・`phase3Ratio` 0.25・`inflateWindup` 1.4・`waveCount` 3・`waveGap` 0.5・`waveDamage` 10・`cornerSafeRatio` 0.8。生命 `stats/kingSlime.json` の `hp` 1250 も動かさない（門を見て最後に触る）
- 冠スライム: `enemies/stats/crownSlime.json`（`slime` の写し。`hp` は使わず王から決める・`contactDamage` 0・`engageRange` 0・`speed` 40（王の段階 2 の追跡 72 より遅い = 遅れて晒される）・`minDepth` 99・`weight` 0・`dropChance` 0）、`enemies/combat/crownSlime.json`（`slime` と同じ `poise`）、`enemies/defense/enemies/crownSlime.json`（`slime` と同じ）。`_index.json` の `_order` への足し方は `docs/recipes/enemy.md` に従う

---

## 3. ブレストの案（採る / 採らない）

| 案 | 判断 | 理由（1 行） |
| --- | --- | --- |
| L11-07 試金の主（跳躍 = 黄 / 呑み = 赤 / 膨張 = 大将） | 動詞は採る・**順は入れ替える**（跳躍 = 黄 / 分裂 = 大将 / 膨張 = 赤） | 今のコードの段階 2 は分裂体がいて大将が置け、段階 3 は近い間合いで受け流しの的が置ける |
| L11-07 の陣で大将を作り敗走させる | 採らない | 陣の敗走は逃げる敵を残して鬼ごっこになり、`newJin` が `state.rng` を引く。冠 1 つで足りる |
| G3-03 戦跡 | 採る（描画だけ・段 D） | 苔の釜の前例は「四隅の殻」でなく **墜落の跡**（潰れた殻の輪と刺さった刀）。四隅は B の答えを指してしまう |
| G3-10 溜墨 | 採る（描画だけ・段 D） | 段階 1 は still。止まると続け跳びが来ることを足元の墨で先に見せる |
| G3-09 引導 | 採る（未決 5） | 最終段階の答え（呑み損ね）にだけ開き、ボスの数値を触らずに読む人の速さを作る |
| G3-05 定跡 | 採る（門。段 C） | 「読めば勝て、読まなければ削られる」を bot の 3 列で示す唯一の物差し |
| G4-02 幕間 | 今は採らない | スライム王の段階の変わり目は答えのダウンの直後で、幕を足すと 1 回の答えに報酬が 2 つ重なる。奥義の側の設計が先 |
| G3-01 誘火 / G3-04 残写 / G3-06 縄切 | 採る（6 章で各ボスへ） | 同じ器（答えの口・黄の長さ・予約のダウン）で書ける |
| G3-02 門答 / 崩岸 / G3-07 面影 / G6-09 大詰 | 後（最深の主の段） | 章ボスの答えが決まってから。今は `actStages`（大詰の 1 ビットの元）と、借りた跳躍が壊れないための `tickWindup` の転送だけ入れる |
| 流れ矢 | 採らない | 画面の外から来る技はテレグラフの原則に反する（G3 の判断のまま） |
| D11 の `strikeOpen`（攻撃中に黄を開く） | 採らない | 屈みが赤 → 空中が黄 と色が戻ると、`yellowAt`（赤になった時刻は 1 つ）が成り立たない。予備動作そのものを空中にした |
| D11 の「跳んだ瞬間に当たりを影へ瞬間移動」 | 採らない | 上昇の間に体を動かせば絵と当たりが一致する |
| D11 の「吐き出し」を噛みの答えの名に使う | 採らない | 「吐き出し」は消化の中断（★1 確定）。噛みの答えは「呑み損ね」に分ける（未決 4） |
| D11 の `BossHooks.onStruck`（全ての命中をボスへ） | 採らない | 答えは出端・受け流し・見切りの 3 つに限る。命中のたびに呼ぶと「何でも答え」になり、reading-core の出端の判定と二重になる |

---

## 4. 実装

### 4-1. 器（他の章ボスも使う）

**型（`src/core/state.ts`。最小 Edit）**

```ts
// Enemy に 1 欄（windupAt の隣）
/** 予備動作のうち黄（まだ止められる）の残り秒。ボスの技が BossHooks.openTime で決める。undefined は commitRatio の規則 */
openFor?: number;

// BossState の前に
/** 答えのダウンの印。answer = 段階の答え、final = 最終段階の答え（引導の窓） */
export type BossDownTag = "answer" | "final";
/** 技の後に払うダウン（答えの一撃が赤に入ったとき） */
export interface OwedBossDown {
  time: number;
  text: string;
  color: string;
  tag: BossDownTag;
}

// EnemyAi に 3 欄
/** 技の後に払うダウン（bossKit の oweBossDown。runBossCycle が攻撃の終わりに払う） */
owedDown?: OwedBossDown;
/** 最終段階の答えのダウンの間（引導の窓）。bossDown の "final" が立て、怯みの終わりで消す */
finale?: boolean;
/** スライム王: 呑んだ時点のダウンの総数（これより増えたら吐き出す） */
digestMark?: number;

// BossState に 2 欄
/** 答えのダウンの回数（浮き文字ごと。QA と戦跡が読む） */
answers?: Record<string, number>;
/** 段階の変わり目ごとに行為で進んだか（index 0 = 1 → 2） */
actStages?: boolean[];
```

**`src/system/poise.ts`（最小 Edit）**: `windupCommitted` の `chainWindup` の判定の次に 1 行。

```ts
if (e.openFor !== undefined) return e.openFor <= 0;
```

`attackCommitted` は変えない（strike は常に赤）。`noteCommit` は `attackCommitted` を読むので、赤になった時刻は `openFor` が 0 になったステップに自然に書かれる。`openFor` を書くのは器だけなので、雑魚と器を通らないボス（骸骨卿・双子・霜の巨人）は今のまま。

**`src/system/bossKit.ts`（所有）**

```ts
export type BossAnswerKind = "debana" | "parry" | "just";
export interface BossAnswerHit {
  readonly kind: BossAnswerKind;
  /** 命中（受け流し・見切り）の瞬間にまだ黄だったか（yellowAt(e, state.time)） */
  readonly landedYellow: boolean;
}

export interface BossHooks {
  // …今の欄
  /** 予備動作のうち黄の秒（0 = 最初から赤、予備動作の秒以上 = 全部黄）。null / 省略は commitRatio の規則 */
  openTime?(state: GameState, e: Enemy, def: EnemyDef): number | null;
  /** 予備動作中の毎ステップ（スライム王の上昇の移動など） */
  tickWindup?(state: GameState, e: Enemy, def: EnemyDef, dt: number): void;
}
export interface BossSignature {
  // …今の欄
  tickWindup?(state: GameState, e: Enemy, def: EnemyDef, dt: number): void;
}

/** tag を渡すと答えのダウン: 怯めなくても（既に怯み中・拘束上限）浮き文字と答えの記録は出す。final は引導の窓を開く */
export function bossDown(state: GameState, e: Enemy, time: number, text: string, color: string, tag?: BossDownTag): boolean;
/** 技を止めずに、攻撃の終わりにダウンを払う（遅れた出端など）。既に予約があれば上書きしない */
export function oweBossDown(e: Enemy, down: OwedBossDown): void;
/** 段階を進める（phaseShift + 行為で進んだかの記録） */
export function advanceBossStage(state: GameState, e: Enemy, text: string, color: string, stage: number, byAct: boolean): void;
/** ダウンの総数（怯み + 自傷）。スライム王の消化の吐き出しが読む */
export function bossDownCount(state: GameState, e: Enemy): number;
```

`runBossCycle` の変更（4 か所）:

1. `startWindup`: `h.beginWindup` と `windupTotal` の後に `e.openFor = h.openTime?.(state, e, def) ?? undefined;`（毎回代入する。前の技の値を残さない）
2. `chainFollowUp`: `e.openFor = undefined;`（連撃は `chainWindup` で最初から赤）
3. `case "windup"`: `phaseTimer -= dt` の前に `if (e.openFor !== undefined) e.openFor = Math.max(0, e.openFor - dt);` と `h.tickWindup?.(state, e, def, dt);`
4. `case "strike"` の終わり: `settlePendingStagger` の **前** に `if (settleOwedDown(state, e)) return;`（答えのダウンを怯み値の怯みより先に払う。`owedDown` を消してから `bossDown`）。硬直に入るときに `e.openFor = undefined`

`bossDown` の中身: tag があれば `noteBossAnswer(state, e, text)`（`bossRecord.ts`）と浮き文字を **怯みの成否に関わらず** 出し、`tag === "final"` なら `e.ai.finale = true`。怯み（`applyStagger(…, { selfInflicted: true })`）が入れば揺れ・音・`noteBossDown`。tag なしは今と同じ（入らなければ何も出さず false）。

`bossDownCount` = `e.poise.downs` + （`state.boss` がこの敵なら `selfDowns`）。

`signatureOf`: `tickWindup` も `asMove` で包んで渡す。

**`src/system/bossRecord.ts`（最小 Edit）**: `noteBossAnswer(state, e, text)`（ボス本人のときだけ `state.boss.answers[text] += 1`）と `noteBossStage(state, e, byAct)`（`actStages.push(byAct)`）。`NO_MINION_POISE` に `"crownBearer"`（冠スライムの撃破でボスに怯み値を入れない。冠落ちのダウンと二重にしない）。

**答えの口（`src/system/boss.ts`。最小 Edit、`bossReflects` の隣）**

```ts
/** プレイヤーの答え（出端・受け流し・見切り）をボスへ渡す。ボスでなければ何もしない */
export function bossOnAnswer(state: GameState, e: Enemy, kind: BossAnswerKind): void {
  const def = enemyDef(e.defKey);
  if (!isBossDriven(def) || e.hp <= 0) return;
  const hit: BossAnswerHit = { kind, landedYellow: yellowAt(e, state.time) };
  switch (def.behavior) {
    case "kingSlime":
      kingSlimeAnswer(state, e, def, hit);
      return;
    default:
      return;
  }
}
```

呼ぶ所（各 1 行）:

| 所 | いつ | 注意 |
| --- | --- | --- |
| 近接の出端（reading-core レーン A が「出端の出来事を 1 振り × 1 体に 1 回」出す所。`system/debana.ts` を作るならそこ、無ければ `src/system/player.ts` の `meleeHitEnemy` の出来事の if の中） | 出端が成立した 1 回目 | `damageEnemy` の **後**（怯み値で先に怯んでいても、`bossDown` の tag が答えを数える） |
| 放出の弾の出端（`src/system/projectiles.ts` の `hitEnemies`。reading-core 2-3） | 同上 | 同上 |
| `src/system/parry.ts` の `parrySucceed` | `stopAttacker` の **前** | 先に答えのダウンを入れ、受け流しの怯み値 40 で普通の怯みに化けさせない |
| `src/system/combat.ts` の `justDodge(state, attacker)` | attacker があるとき | スライム王は使わない。盗賊王・鏡の騎士の口 |

**引導（未決 5 が通ったら。`src/system/poise.ts`）**: `tryExecute` の頭で `tryFinisher`。条件は「`e.ai?.finale` かつ怯み中かつ 生命 ≤ 最大 × `POISE.executeHpRatioMax` かつ `amount >= POISE.executeMinPoise`」。満たせば `e.hp = 0` と浮き文字「引導」。`onExecute`・恐怖の波及・`markExecuted` は出さない。`onStaggerEnd` の頭で `finale` を消す。

### 4-2. スライム王（`src/system/bossKingSlime.ts`。所有）

| 部品 | 中身 |
| --- | --- |
| 技の定数 | 今の 4 つに `export const KS_BITE = 4` |
| `isHighJump(move)` | `KS_JUMP` か `KS_CENTER` |
| `openTime` | 高い跳躍 → `e.phaseTimer`（予備動作の全部が黄）。他 → 0 |
| `beginWindup`（高い跳躍） | `ai.target` = `KS_JUMP` はプレイヤーの位置、`KS_CENTER` は部屋の中央。どちらも `spawnSpot(state, want, want, e.body.radius)` で寄せる。`ai.points = [{ ...e.body.pos }]`（上昇の始点）。`phaseTimer = ks.jumpRise + scaledWindup(hover, state.depth)`（hover は段階 1 が `jumpHover`、2 以降が `phase2Hover`）。影 = `spawnLanding(state, ai.target, 半径, phaseTimer + ks.jumpFall, e.id)` に `airTime = ks.jumpFall`（半径は `KS_JUMP` が `shockRadius`、`KS_CENTER` が `swallowRingRadius`） |
| `beginWindup`（他） | 呑み: 今のまま（`scaledWindup(def.windup, depth, 1 / speedMul)`）。噛み: `scaledWindup(ks.biteWindup, depth)`、`e.strikeDir = toPlayer`。膨張: 今のまま |
| `tickWindup` | 高い跳躍の上昇: 進み `f = clamp01((windupTotal − phaseTimer) / (windupTotal × rise / (rise + hover)))`、`e.body.pos = lerp(points[0], target, easeOut(f))`（空中なので `moveEnemy` を通さず壁を越える）。連撃で予備動作が 0.6 倍になっても比で進むので着く |
| `beginStrike` | 高い跳躍: `phaseTimer = ks.jumpFall`（移動なし。影は予備動作から続く）。呑み: 今の `leap` で、影に `sourceId = e.id` と `airTime` を付ける。噛み: `leap(state, e, def, プレイヤーの位置, ks.biteHopTime, ks.biteRadius)`（同じく `sourceId`）。膨張: 今のまま |
| `tickStrike` | 高い跳躍: 動かず、`phaseTimer <= 0` で `land`。呑み・噛み: 今の空中の移動 → `land` |
| `land` | `KS_JUMP` → `slam`（今のまま。段階 2 だけ毒沼）。`KS_CENTER` → 今のまま。`KS_SWALLOW` → `swallow`。`KS_BITE` → `bite` |
| `bite` | プレイヤーが `biteRadius` に入っていれば `damagePlayer(state, depthDamage(ks.biteDamage, depth), e.body.pos, e)`（**王を攻撃者に渡す** = 受け流せる）。`"hit"` なら `inflictOnPlayer(state, e, "contact")` |
| `kingSlimeAnswer(state, e, def, hit)`（export） | 出端 × 高い跳躍 × 連撃でない: `landedYellow` なら `bossDown(state, e, ks.dropDown, "墜落", color, "answer")`、でなければ `oweBossDown(e, { time: ks.dropDown, text: "墜落", color, tag: "answer" })`。**段階 1 ならどちらでも `ai.progress += 1`**。受け流し × `KS_BITE`: `bossDown(…, ks.biteMissDown, "呑み損ね", …, "final")`。他は何もしない |
| `updateKingSlime` | 順: `ai.timer += dt` → `tickDigest` → `checkCrown` が true なら return（冠落ちでダウンさせたら同じ更新で段階を進めない）→ `advanceStage` → `runBossCycle` |
| `tickDigest` | `digest > 0` で `bossDownCount(state, e) > ai.digestMark` なら吐き出し（今の浮き文字と粒。回復しない）。`ai.timer >= ks.swallowHopTime + ks.digestTime` なら `digest × swallowHealRatio × maxHp` 回復。今の `spitIfInterrupted` と `onRecoverEnd` は消す |
| 冠（段階 2 の間は `ai.progress` を冠の状態に使う） | `CROWN_ALIVE = 0` / `CROWN_BROKEN = 1` / `CROWN_EATEN = 2`。`checkCrown`: 段階 2 で `CROWN_ALIVE` かつ生きた冠スライムがいなければ冠落ち（`bossDown(…, ks.crownDown, "冠落ち", …, "answer")`・分裂体を `vanished`・`CROWN_BROKEN`）→ true |
| `splitKingSlime` | `splitCount` 個の位置を今の式で出し、プレイヤーから最も遠い位置（同じ距離は添字の小さい方）に `crownSlime`、他に `slime`。冠の `maxHp = hp = lastHp = round(e.maxHp × crownHpRatio)`。全部 `leaderId = e.id`。`ai.progress = CROWN_ALIVE` |
| `swallow` の獲物 | 王に最も近い冠でない分裂体。いなければ冠スライム → **冠呑み**: 冠を `vanished`、`crownHealRatio` を即回復、`CROWN_EATEN`、`advanceBossStage(…, STAGE_INFLATE, false)` |
| `advanceStage` | 1 → 2: `progress >= dropsToSplit` か生命 ≤ `phase2Ratio` → `advanceBossStage(…, STAGE_SPLIT, progress >= dropsToSplit)` → 分裂。2 → 3: `CROWN_BROKEN` → `byAct = true`。生命 ≤ `phase3Ratio` → 冠と分裂体を溶かして `byAct = false` |
| `recoverTime` | 膨張 → `ks.inflateRecover`。他 → `def.recover / speedMul`（消化の枝を消す） |
| 描画への読み出し（export） | `kingSlimePose(e)`（`"idle"` / `"crouch"` / `"air"` / `"fall"` / `"land"`）と `kingSlimeLift(e)`（0..1。上昇は 0 → 1、滞空 1、落下 1 → 0、呑み・噛みは低い弧 × `LOW_HOP_LIFT` 0.4）。`kingSlimeAirTime` は消す |
| `kingSlimeTelegraph` | 呑み = 輪（今のまま）、他 = null（影で出す） |
| `KING_SLIME_SIGNATURE` | そのまま（`signatureOf` が `tickWindup` も運ぶ） |

`src/system/bossDeepLord.ts`（最小 Edit）: HOOKS に `tickWindup` を足し、借りた技なら `beginWindup` / `tickStrike` と同じ `borrow(e, …, sig)` で `sig.tickWindup` を呼ぶ。**これが無いと借りた跳躍が始点で滞空し、影と着地点がずれる**。`openTime` は転送しない（借りた跳躍の黄は既定の規則のまま。面影の段で決める）。

### 4-3. 冠スライム（新しい敵。`docs/recipes/enemy.md` に従う）

- key `crownSlime`・表示「冠スライム」・behavior 新 `"crownBearer"`・`noCorpse`・絵は `slime` の再配色 + 冠（`data/sprites/`、pixel-artist）。定義は `src/data/enemies.ts` の `slime` の行の近く（置き場は recipe に合わせる）
- `src/system/behaviors/families.ts` に `CrownBearer`（`EnemyBehaviorBase` を継ぐ）: `canBeginAttack` → false、`onStruck` → 何もしない、`slotTarget` → 王（`leaderId`）が空中（windup / strike で技が高い跳躍・呑み・噛み）か怯み中なら **自分の位置**（動かない）、それ以外は「王の位置 + 王から見てプレイヤーの反対向き × `crownShade`」。状態は書かない
- `src/system/behaviors/registry.ts` に 1 行、`src/data/enemyRoles.ts` に 1 行、`enemyCombat` / `enemyDefense` の表に 1 行ずつ
- 図鑑に 1 頁増える（未決 3）

### 4-4. 描画・音・文字（state を読むだけ）

| 所 | 中身 | 段 |
| --- | --- | --- |
| `src/render/renderer.ts` の `drawLanding` | `drawLanding(state, h)` にし、`h.sourceId` の敵がいれば縁を `telegraphColor(source)`（いなければ今の色）。**全ての影が頭の「!」と同じ規則になる**（卵・落石・つららも黄 → 赤） | A（答えの手がかりなので必須） |
| `enemyFrame` / `jumpLift` | `kingSlimePose` → `KING_FRAME`（air・fall = stretch、land = squash、crouch = crouch）、`kingSlimeLift × KING_JUMP_HEIGHT` | A |
| 描画だけの身構え | 追跡中で `e.attackCooldown < CROUCH_HINT_SEC`（0.2）なら crouch のフレーム（予告ではない。乱数なし） | A |
| 墜落・噛み・冠 | 腹から落ちて平たく伸びた絵・口を開いた絵・冠の重ね（pixel-artist）。墜落の命中は reading-core 2-3 の出端の墨の飛沫をそのまま使う | D |
| 戦跡・溜墨 | 3 章の採る案。描画だけ | D |
| 効果音 | 墜落・冠落ち・呑み損ねは今の `wallHit`（`bossDown`）。専用の音は段 D で `docs/recipes/audio.md` に沿って | D |
| `src/meta/tips.ts` | 「主の間」の項に 3 行: 跳んだ主は影が黄のうちに打てば落ちる / 冠を割れば分裂は崩れる / 噛みは着地を受け流す（UI には書かない） | B |
| `docs/GLOSSARY.md` | 189 行（膨張 / 呑み込み / 吐き出し）を更新。墜落・冠落ち・呑み損ね・引導（浮き文字）、冠スライム（敵）を足す | B |

### 4-5. 段取り（全部 `feat/ink-reading` の上。reading-core のレーン A が入った後）

| 段 | 所有 | 最小 Edit のみ | 完了条件 |
| --- | --- | --- | --- |
| A 器 + 段階 1 | `src/system/bossKit.ts`・`bossKit.test.ts`・`bossKingSlime.ts`・`bossKingSlime.test.ts` | `core/state.ts`・`system/poise.ts`・`system/boss.ts`・`system/bossRecord.ts`・`system/parry.ts`・`system/combat.ts`・出端の口（`debana.ts` か `player.ts`）・`system/projectiles.ts`・`system/bossDeepLord.ts`・`render/renderer.ts`・`balance/enemies/BOSS/kingSlime.json` | 段階 1 の墜落と、墜落 2 回で分裂が動く。段階 2・3 は **今のまま**（消化の棒立ちもまだ残す）。`pnpm run check` |
| B 段階 2・3 | `bossKingSlime.ts`・`bossKingSlime.test.ts`・冠スライムの JSON 3 つ | `data/enemies.ts`・`data/enemyRoles.ts`・`enemyCombat` / `enemyDefense`・`behaviors/families.ts`・`behaviors/registry.ts`・`poise.ts`（引導）・`meta/tips.ts`・`docs/GLOSSARY.md` | 2 章の全部。`pnpm run balance:gen` を回す。`pnpm run check` |
| C 定跡と門 | `src/qa/bossAnswers.ts`（新）・`qa/bossProbe.ts`・`qa/bossMetrics.ts`・各 test | `qa/bot.ts`（要る関数を export するだけ） | 4-7 の 3 列が `probe.md` に出る。骨組みは A の後に B と並行で書ける |
| D 絵・音・戦跡・溜墨 | `data/sprites/`・`render/` の新しい描画・`audio/` | `render/renderer.ts` | 描画だけ（`REPLAY_VERSION` を動かさない） |

`REPLAY_VERSION`（`src/core/replay.ts:84`、今 36）は reading-core と同じく **ブランチの最後に 1 回だけ** 上げる（この作り直しも同じ束に入れる）。資料（`docs/CODE_MAP.md` に `qa/bossAnswers.ts` の 1 行、`docs/ideas/boss-impl.md` の 2-2 から本書への 1 行、`IDEAS.md` の現状）は統合役が段の終わりに直す。

### 4-6. テスト（`it` は日本語。`system/testHelpers.ts` を使う）

`src/system/bossKit.test.ts`（足す）

- `openTime` が 0 なら予備動作の最初から `attackCommitted` が真。予備動作の秒なら予備動作の間ずっと偽で、攻撃に入った瞬間に真。`yellowAt` は赤になったステップを境に切り替わる
- 連撃の予備動作は `openTime` に関わらず最初から赤
- `tickWindup` が予備動作の毎ステップ呼ばれる
- `oweBossDown` は攻撃を止めず、攻撃の終わりに、先送りの怯み値より先にダウンを払う
- `bossDown` に tag を渡すと、既に怯み中でも答えが `BossState.answers` に数えられる。`"final"` だけが `finale` を立て、怯みの終わりで消える。tag なしは今と同じ
- `advanceBossStage` が `actStages` に積む
- 借りた跳躍（`KING_SLIME_SIGNATURE`）でも上昇の後に影の真上へ着く（`tickWindup` の転送）

`src/system/bossKingSlime.test.ts`（書き直し。今の「消化の digestTime 秒は動かず」「分裂体が 0 体になると第 3 段階」「膨張の後は exhaustTime 秒動かない」は仕様が変わるので書き換える）

- 高い跳躍の予備動作の間は黄で、上昇の後に王の体が影の中心にいる
- 黄のうちに振り始めて黄のうちに当てると墜落: 攻撃が取り消され、影が消え、衝撃波が出ず、ダウンの秒が `dropDown`
- 黄で振り始めて落下（赤）で当たると、着地の衝撃波は出て、その後に墜落のダウン
- 赤で振り始めた一撃では墜落しない（着地し衝撃波）
- 継続ダメージ（燃焼）が黄の間に入っても墜落しない
- 続け跳びは最初から赤で墜落しない
- 段階 1 の墜落 2 回で、生命が 50% より上でも、起き上がった後に分裂する。ダウンの途中では分裂しない
- 分裂で冠はプレイヤーから最も遠い分裂体に付き、同じ配置なら毎回同じ
- 王が空中の間、冠スライムは動かない
- 冠スライムを倒すと冠落ち（`crownDown`）。残りの分裂体は `vanished` で `state.kills` が増えず、王に取り巻きの怯み値が入らない。起き上がった後に段階 3（`actStages[1] === true`）
- 呑みは冠でない分裂体を先に狙い、尽きると冠を呑んで `crownHealRatio` 回復し、その場で段階 3（`actStages[1] === false`）
- 消化中も王は動き、`digestTime` 後に回復する。消化中にダウンすれば回復しない
- 段階 3 で near なら噛み、far なら跳躍、mid なら中央へ跳んでから膨張
- 噛み・呑み・膨張は予備動作の最初から赤
- 噛みの着地を受け流すと呑み損ね（`biteMissDown`、`finale` が立つ）。受け流さなければ `biteDamage` の被弾
- 膨張の後の硬直は `inflateRecover`
- 同じ seed と入力なら同じ技の順・同じ冠の位置（今のテストを残す）

`src/system/poise.test.ts`（引導を入れるなら）: 呑み損ねのダウン中・生命 25% 以下・怯み値 20 以上で撃破し `onExecute` が出ない / 生命 30% では撃破しない / 墜落・冠落ち・怯み値の怯みでは撃破しない。

その他: `src/system/floatingText.test.ts` が新しい浮き文字（墜落・冠落ち・呑み損ね・引導）の体言止めを見る。`src/system/readTiming.test.ts` の「予備動作を書く所の漏れ」は器の `startWindup` が既に押さえる。`core/replay.test.ts` は版の更新だけ。

### 4-7. QA（定跡と門）

- `BossFight`（`src/qa/bossMetrics.ts`）に `answers: Record<string, number>`・`actStages: boolean[]`・`unansweredDownSec`（答えでないダウンの秒）を足す。`stageAdvancedByAct` は `actStages` があればそちらを優先する
- `src/qa/bossAnswers.ts`（新）: `AnswerMode = "mash" | "A" | "B"`、`AnswerPolicy = (state, view, dt) => FrameInput | null`（null は今の連打の bot に任せる）。見え方は 12 ステップ（0.2 秒）前の写しだけを読む（人に無理な答えを通さない）
  - A: 影が出たら影の中心に留まり、影が黄なら振る、赤なら影の外へ / 段階 2 は王が空中の間に冠へ詰めて振る / 段階 3 は王の 60px 以内に留まり、噛みの影の着地 0.1 秒前に受け流し。呑み損ねの間は生命 25% 以下なら終撃の段を当てる。膨張の輪は最寄りの隅
  - B: 影に入らない / 王に最も近い冠でない分裂体から倒し、最後に冠 / 噛みは見切り、膨張は隅
- 門（スライム王は seed 10。統合役が `ppnpm run qa:probe --bosses` で見る。vitest の縮小版は 3 列が落ちずに回ることだけ）

| 列 | 勝ち | 撃破の秒（中央値） | 被弾（中央値） | 行為で進んだ段階 | 答え / 戦 |
| --- | --- | --- | --- | --- | --- |
| A（読む） | 10/10 | 40〜70、かつ連打の 0.8 倍以下 | 連打の 0.5 倍以下 | 8 割以上 | 墜落 2 以上・冠落ち 1・呑み損ね 1 以上 |
| B（避ける） | 8/10 以上 | A の 1.15 倍以上 | A の 1.5 倍以下 | 5 割以上 | — |
| 連打（今の bot） | 4〜8/10 | 60〜90 | A の 2 倍以上 | 3 割以下 | 墜落 0.5 以下 |

- 連打の墜落が 1 戦 1 回を超えたら黄が長すぎる: `jumpHover` だけを下げる。A が墜落を取れなければ上げる。2 回動かして駄目なら当たりの位置（上昇の移動）を疑う
- 銃の列: `src/qa/gearPower.ts:25` の `FITTED_WEAPON_BASE` が `shortsword` 固定なので、放出の弾での墜落はまだ測れない（8 章）

### 4-8. 決定性

- 乱数を使わない: 冠は距離（同じ距離は生成順）、技は `read` と段階、着地点はプレイヤーの位置と `spawnSpot`、黄の長さは数値
- 答えの判定は `state.time` と `windupAt` / `committedAt` だけ（実時間を読まない）
- 描画は `kingSlimePose` / `kingSlimeLift` / `telegraphColor` / `attackCooldown` を読むだけ。`state.rng` を引かない
- 段 A・B は sim を変える。`REPLAY_VERSION` は 4-5 のとおり束で 1 回

---

## 5. 鏡の騎士の撃破 34 秒（方針。実装は後）

**診断**

- probe: 撃破 33.6 秒（目標 80〜150）・死亡 5 戦 1・行為で進んだ段階 0%（`src/qa/probe.md:534`）。段階 3 の被弾 23 のうち近い 87%（`:550`）
- **段階 1 が段階になっていない**: 盾が止めるのは正面の弾だけ（`src/system/bossMirrorKnight.ts:422-430`）で、probe の武器は剣に固定（`src/qa/gearPower.ts:25`）。盾は bot に一度も効かず、激突 2 回を待つより削る方が早い
- **段階 2 は待てばダウン**: 2 回に 1 回の模写は必ず反動のダウン（`bossMirrorKnight.ts:60, 143, 263-269, 299-303`）
- **段階 3 の死因は写し身の同時攻撃**: 写し身は突進の雑魚（`behavior: "charger"`、接触 14 × 深度 20 の攻撃倍率 約 3.1 = 約 44）。同時に予告を出せる数の上限はボスの予備動作を数えない（`src/system/enemies.ts:490` で `isBossDriven` を除外）ので、騎士の技と写し身 2 体の突進が同じ瞬間に重なる
- `BOSS/mirrorKnight.json` の `_note` の「本体の写し（mirrorSelf）」はボス戦にいない（`mirrorSelf` は鏡の部屋の敵。`src/system/specialRooms.ts:1004`）。生命を上げられない理由は写し身だけ

**直す順**（1 つずつ probe で前後を比べる）

1. 測る: `BossFight` に被弾の出どころの敵 key（騎士 / 写し身）と、正面で弾かれた近接の数を足す
2. **順番取り**: ボスの取り巻き（`leaderId` がボス）は、ボスが予備動作・攻撃中の間は攻撃を始めない（`src/system/enemies.ts` の `canBeginAttack` の共通の判定に 1 行。画面の主役を 1 つにする）。写し身の突進は普通の敵の黄 → 赤なので、reading-core の出端（耐性 20）でそのまま止められる
3. 段階 1 の盾を **盾持ちの雑魚と同じ規則** にする: 正面の近接も止める。黄の間は盾が下がる（reading-core 2-5 の盾隙）、出端は盾抜け。「正面から斬るなら黄に合わせる。でなければ回り込むか激突させる」
4. 模写の反動を外す（待てば隙）。段階 2 を残写（G3-04）に置き換える段まで、模写は撃つだけ
5. 1〜4 の後で生命を上げる（目安 ×1.3〜1.6）。上げ幅は「A が 80〜150 秒・5 戦 4 勝以上」と「連打が 5 戦 2 敗以上」の両方で決める

---

## 6. 他の章ボスへ同じ器を広げる要点

**盗賊王**（短剣の扇・縄切）
- 扇の構えだけ黄を持つ（`openTime`）。出端で扇が散って空振りのダウン 1 秒（`"answer"`）。煙玉・地雷は最初から赤
- 見切り（`bossOnAnswer(…, "just")`）で扇を抜けると王が 0.8 秒見失う（ダウンでなく読み直し。`ai.read` を空にして次の技を遅らせる）
- 追い詰めのダウンの棒立ちを「最寄りの縄へ這う」に（待てば隙を外す）。縄が新しい物 1 つ
- 開き直りの 2 段目の突進を受け流すと転び（`"final"`、引導の窓）
- 段階の進みは `advanceBossStage`（追い詰め 2 回 = 行為）

**油壺の王**（誘火）
- 王の歩きは次の一歩が燃える床なら止まって投げる。引火は突進でしか起きない = 全ての引火がプレイヤーの立ち位置の結果
- 段階 3 の叩きつけの「掲げ」だけ黄（`openTime`）。出端で壺が割れて油被り（`"final"`。近くに火があれば火達磨）
- 遅れた出端は `oweBossDown`（叩きつけの後に油被り）
- 火達磨の 2 秒の棒立ちを「遠ざかる向きへ転げる」に
- 突進・油壺は最初から赤（答えは立ち位置）

**鏡の騎士**（盾・残写・姿見）
- 5 章の 1〜4 が先
- 段階 1: 縁を背に突進を見切る → 激突（今の `slamsToCrack`）。盾は 5 章の 3
- 段階 2: 残写（自分の振りが 1.5 秒後に残像から出る）。騎士が残像の技に入ると写し返し（`"answer"`）。当たりの帳は `state` に小さな列
- 段階 3: 姿見を割る → 鏡割れ（`"final"`）。写し身の順番取りは 5 章の 2
- 答えの無い技（剣の波・盾打ち）は最初から赤

共通: 各ボスの `advanceStage` の `phaseShift` を `advanceBossStage` に替え、`bossOnAnswer` の switch に 1 行足す。最深の主の面影は `BossSignature` に `openTime` と答えを通す段で行う（今回は `tickWindup` だけ）。

---

## 7. 未決の問い（推奨つき）

1. **ボスの黄は「打てば何かが起きる技」だけにし、他の技は予備動作の最初から赤にしてよいか**。推奨: そうする（黄 = 止められる、がボスで嘘にならないため。代わりにボスで出端を狙える窓は減る）
2. **高い跳躍の予備動作を地上の屈みから空中の滞空に変えてよいか**（跳ぶまでの合図は描画だけの身構え 0.2 秒と、跳んだ瞬間の影と「!」。予告の総秒は 1.75 → 0.93 秒）。推奨: 変える（屈みが赤 → 空中が黄、と色が戻る予告を作らないため。影から歩いて出る猶予は足りる）
3. **冠スライムを新しい敵として足してよいか**（図鑑に 1 頁）。推奨: 足す（段階 2 の「大将」を絵で言うため）
4. **名前**: 浮き文字「墜落」「冠落ち」「呑み損ね」「引導」、敵「冠スライム」でよいか（`src/`・`docs/` に衝突なし）。推奨: この案（「吐き出し」は消化の中断のまま分ける）
5. **引導**: 「ボスは処刑されない」を「最終段階の答えのダウンの間で、生命 25% 以下のときだけ討ち取れる」に変えてよいか（G3 の問い 1 と同じ）。推奨: 変える
6. **遅れた出端**（黄で振り始め、赤で当たった）でも墜落を技の後に払ってよいか。推奨: 払う（reading-core の「出端は振り始めの色で決まる」と揃え、振りの遅い武器にも答えを残すため。代わりに潰しは受ける）
7. **章 1 の門の強さ**: 連打の bot が 10 戦 4〜8 勝（負けもある）を、体験版の最後のボスとして受け入れるか。推奨: 受け入れる（初見の全滅は避けつつ、読まないと削られる差を作る。章 3 以降は「連打は 5 戦 2 敗以上」）
8. **鏡の騎士の生命**: 5 章の 1〜4 の後に ×1.3〜1.6 の範囲で上げてよいか。推奨: 上げてよい（数字は 2 つの門で決める）

## 8. 不確かな点（確かめ方）

- `src/system/player.ts`・`parry.ts` から `boss.ts` を import すると import の輪が増える（`combat.ts` → `elites.ts` → `boss.ts` → `bossKingSlime.ts` → `combat.ts` は既にある）。段 A で `pnpm run check` が通るかで確かめる。モジュールの初期化で落ちたら `bossOnAnswer` を葉のモジュールへ移し、各ボスの関数は `boss.ts` が登録する表にする
- 上昇で壁を越えた着地点が柱の縁にかかる場合: `spawnSpot(state, want, want, radius)` が空き地を探す（`src/system/enemyTraits.ts:64`）。苔の釜の格子（`src/map/layout/lordHallGrids.ts`）の全ての床から跳ばせるテストを 1 本足して確かめる
- 最深の主（体が大きい）が借りた跳躍で影の中心へ動くとき、門柱・壁と重ならないか: 段 A のテスト「借りた跳躍でも影の真上へ着く」を深度 21 の最深の間で回す
- 放出の弾での墜落が多すぎないか: 銃の列は `qa/gearPower.ts` の武器の基を引数にしてから測る（段 C の後）
- reading-core の出端の口（`system/debana.ts` を作るか `player.ts` に置くか）はレーン A の実装で決まる。段 A の実装役はその口を Grep（`onCounter` の `tag: "debana"`）で探して 1 行足す
