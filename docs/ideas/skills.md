# スキルシステム設計（アクティブスキル・修飾子・フォーム）

作成日: 2026-09-23
前提: `docs/LOOT_DESIGN.md`（ゴール装備を作らない）、`docs/ideas/build-diversity.md`（キーストーン・トリガー文法・逓減）、`docs/ideas/action-feel.md`（手動入力に報酬）、`docs/ideas/run-structure.md`（永続とラン内の住み分け）。
型は `src/loot/types.ts` の `PlayerStats` / `TriggeredEffect`、実装は `src/system/player.ts` を基準にする。

凡例: **コスト** S = 数時間 / M = 1〜2 日 / L = 数日以上。**タグ** はスキルがどの stat・トリガーと噛み合うかを決める（後述）。

---

## 0. 推奨案（要約）

| 層 | 寿命 | 中身 | ゴールが無い理由 |
| --- | --- | --- | --- |
| **スキル石**（アクティブスキル / フォーム） | 永続（stash） | 「何ができるか」の語彙。レベル・tier を持たず、**ゼロサムの変異軸** と **リンク数** だけがロールされる | 変異は必ず何かを得て何かを失う。リンクが多い石ほど素の CD が長い。上位互換の石が存在しない |
| **修飾子（刻印符）** | 1 ラン | PoE のサポートジェム相当。スキル石のリンクに差す。拾い物なのでランごとに形が変わる | 永続化しないので「最適な組み合わせ」を所有できない。毎ラン作り直す |
| **熟練分岐** | 1 ラン | スキルを使い込むとラン中に 2 択の分岐が開く（Hades のハンマー相当） | 分岐はランで消える。使い方が成長方向を決める |
| **スロット** | 装備依存 | アクティブ 2（装備アフィックスで最大 4、代償付き）+ アクション 4（近接 / 射撃 / ダッシュ / バースト）のフォーム差し替え | スロット増はトレードオフを伴う。枠の少なさが選択を意味あるものにする |

要点: **スキル石は永続で「形」を持ち、強さは装備とラン内修飾子が決める**。装備（数値の土台）× スキル石（動詞）× 修飾子（ランの揺らぎ）の 3 軸の積で、どの軸にも完成形を置かない。

---

## 1. スキルの位置づけ（比較と推奨）

| 案 | 長所 | 短所（ゴール化のリスク） |
| --- | --- | --- |
| A. 装備と別軸の永続ツリー（経験値でスキル習得・強化） | 成長の手応え | 「全部取った状態」がゴールになる。最悪の選択 |
| B. スキルジェムとしてドロップ（永続、PoE 型） | 収集欲、stash と相性が良い | ジェムレベル・品質を持たせると「20/20 ジェム」がゴールになる |
| C. ラン内で拾う一時スキル（Hades / Dead Cells 型） | 毎ラン新鮮 | 永続装備との接続が薄く、装備で積んだ方向性を活かせない |
| **D. B + C のハイブリッド（推奨）** | 永続の石は「形」、ラン内の修飾子と熟練が「伸び方」 | 実装量が多い → 最小実装では石と修飾子だけ入れる |

推奨理由: 永続側を **レベルの無い石** に限定すれば「集める楽しみ」を残したまま天井を作らずに済み、強化の軸はラン内（修飾子・熟練）と装備（数値）に逃がせる。`run-structure.md` の「ラン内要素はルール、数値は装備」の住み分けにもそのまま乗る。

### スキル石のロール（永続）

- **変異軸**（0〜2 本、値は -1..1）: どれも片方を伸ばすともう片方が縮む
  - `areaVsDamage`: 範囲 x(1 + 0.4v)、威力 x(1 - 0.3v)
  - `cooldownVsDamage`: CD x(1 - 0.3v)、威力 x(1 - 0.25v)
  - `speedVsDamage`: 予備動作・持続 x(1 - 0.3v)、威力 x(1 - 0.2v)
  - `countVsDamage`: 回数 / 弾数 +round(2v)、1 発の威力 x(1 - 0.3v)
  - `durationVsPotency`: 持続 x(1 + 0.5v)、効果量 x(1 - 0.3v)
- **リンク数**（0〜3、重み 30 / 45 / 20 / 5）: 修飾子を差せる数。**リンク 1 ごとに素の CD +15%**。3 リンク石は「改造しないと弱い」
- **変容**（5%）: スキルの形が変わる固有特性。例: 旋風斬りが「回転中に敵を中心へ吸い寄せる」、投げ槍が「壁に刺さると雷柱になる」、パリィ構えが「成功時に弾を全方位へ撃ち返す」。変容ごとに失うものがある（吸い寄せ版はノックバック 0）
- tier・レベル・品質は **持たない**。同名の石が 2 つあっても順序が付かない

---

## 2. アクティブスキル案（30）

操作は常に手動。スキルは装備のアフィックス・キーストーン・トリガーと **タグ** で繋がる。
タグ: `melee` / `projectile` / `area` / `movement` / `defense` / `buff` / `placed`（設置） / `channel`（押しっぱなし） / `fire` / `cold` / `lightning`

| # | 名前 | 何が起きるか | テレグラフ / リスク | シナジー例 | タグ | コスト |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 旋風斬り | 0.45 秒回転し、周囲を 4 回斬る。回転中も移動可（速度 60%） | 回転中は近接・射撃不可、ダッシュでのみ中断。終わりに 0.15 秒の隙 | attack speed がヒット回数に効く / burn の多段再付与（4-1）/ `onMeleeHit` トリガーが 4 回走る | melee, area | S |
| 2 | 突進斬り | カーソル方向へ 90px を 0.14 秒で突進、経路上の敵を斬ってスタガー。直後の近接は 2 段目から始まる | 無敵なし。壁に当たると 0.25 秒自分がよろける | dashDistance で距離が伸びる / knockback + 壁叩きつけ / Momentum（K6） | melee, movement | S |
| 3 | 地裂き | 0.35 秒溜めて前方扇に衝撃波。確定スタガー | 溜め中に被弾すると中断、CD は消費 | damageVsStaggered / Iron Stance（K7）で溜め中の被ダメ軽減 | melee, area | S |
| 4 | 投げ槍 | 貫通する槍を投げ、壁に刺さって 4 秒残る。再入力で手元へ引き戻し、戻りの軌道でもヒット | 引き戻すまで再使用不可。槍の位置取りを誤ると CD を無駄にする | pierce / projectileSpeed / 戻りが敵を引き寄せる変容 | projectile, melee | M |
| 5 | ブーメラン刃 | 往復する刃。帰りをキャッチすると CD 半減 | 取り逃がすと CD 満額。キャッチのために敵の中へ入る必要がある | projectileCount で本数増 / shock 連鎖（4-3） | projectile | M |
| 6 | 投擲グレネード | 放物線で投げ、着弾 0.5 秒後に爆発。着弾地点に赤い円 | 自分が円内にいると最大 HP の 10% を受ける（無敵中は無効 → ダッシュで抜ける技術介入） | explodeOnKill の連鎖 / burn / knockback で死体を集団へ（4-9） | area, projectile, placed | S |
| 7 | 氷壁 | カーソル位置に長さ 3 タイルの氷壁を 3 秒。敵と敵弾を止める | 自分の弾も止まる。自分を閉じ込める配置ミスが起こりうる | 壁叩きつけの壁になる / chill / Ricochet（K14）の跳弾面 | cold, placed, defense | M |
| 8 | 雷撃 | カーソル地点に 0.5 秒後落雷、shock 確定 | 予兆の円は見えるが敵は動く。置き技の読みが要る | shockChance → 連鎖数 / 遅延・反響修飾子 | lightning, area, placed | S |
| 9 | 鎖フック | 鎖を撃ち、敵に刺さると引き寄せる。大型や壁に刺さると自分が飛ぶ | 引き寄せた敵が予備動作中ならカウンター機会、そうでなければ密着で被弾リスク | カウンターヒット（action-feel 1）/ 3 段目スタガー | movement, projectile | M |
| 10 | 影分身 | 2 秒間、分身が自分の近接・射撃を同時に模倣する（模倣のみ、自律攻撃なし） | 発動に最大 HP の 10%。分身は被弾で消える | projectileCount が実質 2 倍 / Phantom（K20） | buff | L |
| 11 | 時間減速 | 半径 60 の円に 3 秒フィールド。中の敵と敵弾が 40% 速度 | 自分の弾も減速する。フィールド外へ出ると恩恵なし | Cold Blood（K19）/ chill → 凍結 / Shotgun Soul（K16）の短射程を補う | area, placed, defense | M |
| 12 | 血の契約 | 最大 HP 12% を払い、4 秒間攻撃速度・連射 +35%、与ダメの 8% を吸収 | HP コスト（1 未満にはならない） | Berserker（K2）/ Vampire（K12）/ lifeOnHit | buff | S |
| 13 | 挑発の咆哮 | 周囲の敵に即座に予備動作を開始させる。全員の次の攻撃はカウンター可能 | 一斉攻撃が来る。捌けないと大被弾 | カウンターヒット / JUST 回避トリガーを量産 | area, defense | M |
| 14 | パリィ構え | 0.22 秒の構え。この間の被弾を無効化して JUST 扱い、周囲に反撃衝撃波。成功で CD 全回復 | 失敗すると 0.35 秒行動不能（ダッシュも不可） | `onJustDodge` 系トリガーをダッシュ以外から引ける / Cold Blood | defense, melee | S |
| 15 | 反射障壁 | 1 秒間の球状障壁。入った敵弾を反射する | 障壁中は移動不可 | rangedDamageMul が反射弾に乗る / 弾幕型の敵（action-feel 25） | defense, projectile | M |
| 16 | 爆裂跳躍 | 足元で爆発し、カーソルの反対方向へ自分を吹き飛ばす | 自傷 5%。着地点の制御が難しい | explodeDamage / Momentum / `onDashEnd` 相当の着地トリガー | movement, area, fire | S |
| 17 | 地雷設置 | 足元に地雷（最大 3）。敵が踏むか、再入力で全起爆 | 起爆タイミングは手動。敵を誘導する位置取りが要る | 引き撃ち + knockback で押し込み / burn | placed, area | M |
| 18 | 撃ち抜き | 0.35 秒の照準線の後、壁まで貫通する光線。経路上の敵弾も消す | 照準中は移動不可。反動で後退する | rangedDamageMul / crit / Pacifist（K4）の主砲 | projectile | S |
| 19 | 回転弾幕 | 1 秒間、自分中心に螺旋状に弾を 24 発 | 発射中は移動 40%、射撃不可 | projectileCount が腕の本数に / shock 連鎖 | projectile, channel | S |
| 20 | 大地の杭 | カーソル方向へ一直線に杭が順に突き出し、敵を 0.6 秒打ち上げる | 杭の到達まで時間差があり、先頭の敵は逃げうる | 打ち上げ中は damageVsStaggered 扱い / 3 段目への繋ぎ | area, melee | M |
| 21 | 引力球 | 着弾点に 2 秒の吸い込み球。敵を中心へ集める | 敵弾も集まり、中心が弾幕になる | burst radius / explodeOnKill / 敵ボウリング（action-feel 17） | area, placed | M |
| 22 | 処刑の一撃 | 前方の短い単発。スタガー中または HP 25% 以下なら即死 | 条件を満たさないと小ダメージ + 0.5 秒硬直 | 3 段目スタガー → 処刑の流れ / damageVsStaggered | melee | S |
| 23 | 火の刻印 | 敵 1 体に刻印。刻印中の敵が被弾するたび周囲へ火の粉。再入力で刻印を爆発させて消費 | 刻印は 1 体のみ。爆発させるタイミングが手動 | attack speed（火の粉の頻度）/ `consumeStatus` | fire, area | M |
| 24 | 疾風歩 | 3 秒間、移動 +60%、攻撃中の減速（attackMoveMul）を無効 | 効果中はダッシュのチャージが回復しない | Momentum（K6）/ 移動しながらの 3 段コンボ | buff, movement | S |
| 25 | 位置交換 | カーソル上の敵と位置を入れ替える | 敵の群れの中心に入ることになる | 背後攻撃 / 盾持ち（action-feel 26）の裏取り | movement | S |
| 26 | 共鳴 | 直前に使った別スキルをもう一度 60% の威力で発動 | CD が長い（14 秒）。直前のスキルが弱いと無駄打ち | 修飾子を積んだスキルの 2 回目 / 高 CD スキル | buff | M |
| 27 | 残響弾 | 次の射撃 5 発が、着弾の 0.5 秒後にその場でもう一度弾ける | 射撃を当てないと無駄 | projectileCount / fireRate | projectile, buff | S |
| 28 | 盾突撃 | 盾を構えて 0.5 秒前進。前面の敵弾を消し、敵を押し込む。壁に押し付けると叩きつけ | 側面と背後は無防備 | knockback / thorns / 壁叩きつけ | melee, defense, movement | M |
| 29 | 帯電の軌跡 | 2 秒間、移動した軌跡に帯電線が残り、触れた敵を shock | 軌跡を描くために敵の周りを回る必要がある | moveSpeed / dash charges / shockChance | lightning, movement, area | M |
| 30 | 呪詛の鐘 | 周囲の敵に「脆弱」（被ダメ +30%、4 秒）。自分も被ダメ +15% | 自分も脆くなる | 高単発（地裂き・撃ち抜き）の前置き / markTarget（build-diversity 3-3） | area, buff | S |

### スキル向けキーストーン（排他 group: `skill`）

| 名前 | 効果 | 代償 |
| --- | --- | --- |
| Spellblade | 近接 3 段目のヒットで、最後に使ったスキルが 40% で再発動（手動の 3 段目に連動するので自動攻撃ではない） | スキルの CD +40% |
| Empty Hand | スキルスロット 0。全ダメージ +25%、ダッシュ +1 | スキルを一切使えない |
| Overflow | CD 中でもスキルを使える。残り CD 1 秒につき最大 HP 4% を払う | スキルダメージ -20% |
| Cooldown Gambit | 発動ごとに CD が 0.3x〜2x でランダム | CD 短縮アフィックスが無効 |
| Single Focus | スキルスロット 1。そのスキルのリンク +2 | 2 つ目以降のスロットが消える |

**キーストーンの禁止範囲の原則**: Pacifist / Blade Oath などの「近接不可」「射撃不可」は **アクションスロット（左クリック・右クリック）にだけ効き、スキルには効かない**。これで「近接はスキルの旋風斬りだけ」の Pacifist ビルドが成立する。

---

## 3. 修飾子（刻印符）案（16）

修飾子は 1 回の発動パラメータ（後述 `CastParams`）を書き換える純関数。すべて **得るものと失うもの** を持つ。

| # | 名前 | 効果 | 代償 | 付けられないタグ | コスト |
| --- | --- | --- | --- | --- | --- |
| M1 | 多重（連射化） | チャージ +2 | 威力 x0.7、チャージ 1 回ぶんの CD x1.3 | なし | S |
| M2 | 貫通 | 弾・突進が敵を貫通（+3） | 範囲 x0.8 | 対象を持たない buff | S |
| M3 | 溜め | 長押しで溜め、最大 0.8 秒で威力 x2.2・範囲 x1.4 | 溜め中は移動 50%、被弾で溜め消失 | channel | M |
| M4 | 反動 | 発動時に照準の逆方向へ小ジャンプ（0.1 秒無敵） | 威力 x0.85、密着を維持できない | movement | S |
| M5 | 血の代償 | 威力 x1.6（buff は効果量 x1.3） | 発動ごとに最大 HP 6%（1 未満にしない） | なし | S |
| M6 | コンボ燃料 | 発動時にコンボを全消費し、1 スタックごとに威力 +4%（最大 +120%） | コンボ 0 だと威力 x0.8。コンボのスコア倍率も失う | なし | S |
| M7 | 遅延 | 0.8 秒後に発動、威力 x1.8。発動地点に予兆の円 | 即応性を失う（置き技化） | defense | S |
| M8 | 分裂 | 3 方向に同時発動 | 1 本あたり威力 x0.5 | buff | M |
| M9 | 反響 | 0.8 秒後に同じ地点・向きでもう一度 50% の威力で発動 | CD x1.25 | defense, buff | S |
| M10 | 拡大 | 範囲 x1.5 | CD x1.4 | なし | S |
| M11 | 圧縮 | 威力 x1.6 | 範囲 x0.6 | なし | S |
| M12 | 元素変換（火 / 氷 / 雷） | ダメージの 50% をその元素に変換し、状態異常を確定付与 | 物理ダメージ由来の knockback x0.5 | 同元素タグ持ち | M |
| M13 | JUST 装填 | キーで「装填」し、次の JUST 回避（またはパリィ成功）の瞬間に威力 x2 で発動 | 装填から 3 秒で失効し CD 消費。JUST を狙えないと無駄 | movement | M |
| M14 | 狂奔 | CD 半分 | 使うたびに以降の CD +10% 累積。部屋クリアでリセット | なし | S |
| M15 | ダッシュ撃ち | ダッシュ中に使え、ダッシュを中断しない | 威力 x0.8 | channel | S |
| M16 | 連結 | 使用すると、もう一方のスキルの残り CD を 1.5 秒短縮 | 自身の CD x1.3 | なし | S |

**不採用**: 「トリガーで自動発動」（PoE の Cast on Crit 相当）。スキルは常に手動。M13 の JUST 装填は「キーを押して装填」が必須なので手動の範囲に収まる。

---

## 4. 入手・成長・スロット

### 入手

| もの | 出所 | 保存先 |
| --- | --- | --- |
| スキル石 | 部屋クリア報酬の 10%（装備とは別枠）、ミニボス / チャレンジ部屋で確定 | 永続（スキル用 stash） |
| フォーム石 | 階層ボス確定、深さ 5 以降の部屋クリアで 3% | 永続 |
| 刻印符（修飾子） | 部屋クリアで 25%、祭壇 / 祝福 3 択に混ざる | ラン内（床に落ち、拾って装着） |

- 刻印符の抽選は **装着中のスキルのタグで重み付け**（付けられないものは出ない）。同じ石でもランごとに違う方向へ伸びる
- 刻印符の装着は **ゲームを止めない**: 刻印符の上に立っている間はスキルキーが「装着」になり、押したスキルに差さる。リンクが埋まっていれば最古の修飾子と入れ替え、外れた符は床に落ちる

### 成長（ラン内のみ）

- **熟練分岐**: スキルごとに使用回数を数え、12 回と 36 回で 2 択の分岐が開く（ポーズなしの小ポップアップ、スキルキー 1 / 2 で選択）。例: 旋風斬り「A: 回転中の移動速度 100% / B: 最後の 1 回が敵を中心へ吸い寄せる」。ランで消える
- 永続の石は成長しない。ゴールが生まれないようにする

### スロット

| スロット | 数 | 増やし方と代償 |
| --- | --- | --- |
| アクティブ | 基本 2 | 装備アフィックス「Skill Socket」（amulet / armor の prefix、代償: 最大 HP -10%）で +1、最大 4 |
| リンク | 石ごとに 0〜3 | 石のロールで決まる（リンク 1 ごとに CD +15%） |
| アクション（フォーム） | 4 固定 | 近接 / 射撃 / ダッシュ / バースト。既定フォームが入っていて空にはできない |

**無限性の担保**: 30 スキル x 変異 2 軸 x リンク 0〜3 x 変容 x 修飾子 16 の順列 x フォーム 20 x 装備。どの軸にも「上」が無く、修飾子はラン内なので恒久的な完成形を所有できない。
**選択の意味**: スロットが 2 しかないので、装備のタグ（melee 盛り / projectile 盛り）とスキルのタグを揃えるか、あえて外して穴を埋めるかの判断が毎回ある。

---

## 5. 既存の攻撃をフォームとして差し替える

アクションスロット（近接 / 射撃 / ダッシュ / バースト）はそれぞれ「フォーム」を 1 つ持つ。既定フォームは今の挙動。フォーム石を差すと入力はそのままで動きが変わる。
武器ベース（dagger / greatsword …）は **数値**（implicit）、フォームは **動き** を担当し、役割を重ねない。

| スロット | フォーム | 動き | 代償 | コスト |
| --- | --- | --- | --- | --- |
| 近接 | 三段斬り（既定） | 今の 3 段コンボ | なし | - |
| 近接 | 大剣の溜め斬り | 押しっぱなしで溜め、離して 1 撃。溜め 3 段階（0.3 / 0.7 / 1.2 秒）で範囲と威力が伸び、最大溜めは確定スタガー | コンボが 1 段のみ。溜め中移動 40% | M |
| 近接 | 双刃乱舞 | 5 段コンボ、各段が速く軽い。5 段目で回転斬り | 1 段の威力 55%、リーチ 80% | S |
| 近接 | 槍の突き | 直線の長いリーチ、3 段目が貫通突進 | 横幅が狭く、敵弾を斬れない | S |
| 近接 | 鞭 | 超長リーチ（48px）の細い判定、先端ヒットで x1.5 | 手元の敵に当たらない | M |
| 近接 | 拳 | 超短リーチの 6 段、ヒットごとにコンボ +2 | 被弾でコンボ全損 | S |
| 射撃 | 連射（既定） | 今の押しっぱなし連射 | なし | - |
| 射撃 | 散弾 | 5 発の扇、射程 40% | 連射 x0.35 | S |
| 射撃 | チャージビーム | 押している間溜め、離すと太い貫通ビーム | 溜め中は移動 60%、連射なし | M |
| 射撃 | 擲弾 | 放物線の着弾爆発弾 | 弾速遅く、直撃しない | S |
| 射撃 | 投げナイフ | 敵に刺さり、近接で殴ると抜けて追加ダメージ | 単体では威力 60% | M |
| ダッシュ | 無敵ダッシュ（既定） | 今のダッシュ | なし | - |
| ダッシュ | ブリンク | テレポート + 着地爆発（既存の ks_blink をフォームへ移管） | 無敵なし、JUST 不可 | S（移管） |
| ダッシュ | スライディング | 長く低速の移動。すり抜けた敵を足払いで転ばせる | 無敵は前半 50% のみ | S |
| ダッシュ | グラップル | カーソル方向へ鎖を撃ち、壁や敵へ飛ぶ | 何も無い方向には出ない | M |
| ダッシュ | 影踏み | ダッシュ地点に影を残し、1.5 秒以内に再入力で影へ戻る | チャージ -1 | M |
| バースト | 衝撃波（既定） | 今のバースト | なし | - |
| バースト | 時止め | 3 秒間、敵と敵弾が停止 | 停止中の与ダメは解除時にまとめて入る（停止中に倒せない） | M |
| バースト | 覚醒 | 8 秒間、全攻撃 x1.8 + 攻撃速度 +30%。ゲージが減り続ける | 即時ダメージなし | S |
| バースト | 断罪光線 | カーソル方向へ 1.5 秒の極太レーザー、照準は追従 | 照射中は移動不可 | M |

**ks_blink の扱い**: ダッシュのフォーム「ブリンク」と重複するので、キーストーン側は「どのダッシュフォームでも終点で爆発する（無敵なし）」に意味を変えて残すのを推奨。

**実装方針**: `meleeStep(stats, combo)` が `PLAYER.melee` を直接読んでいるのを、`state.forms.melee.steps` を読む形に変える。フォームは `steps` の表 + 任意のフック（溜め・派生）で表現し、既定フォームの `steps` は今の `PLAYER.melee` そのもの。

---

## 6. データ構造（TypeScript 型案）と既存システムとの接続

### 6-1. 新規 `src/skills/types.ts`

```ts
import type { DamageKind } from "../core/state";
import type { Vec } from "../core/vec";

export const SKILL_TAGS = [
  "melee", "projectile", "area", "movement", "defense", "buff",
  "placed", "channel", "fire", "cold", "lightning",
] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

export const ACTION_SLOTS = ["melee", "shoot", "dash", "burst"] as const;
export type ActionSlot = (typeof ACTION_SLOTS)[number];

/** 最小実装の 6。追加はここへ */
export const SKILL_KEYS = ["whirl", "lunge", "frag", "railshot", "parry", "bloodPact"] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/** 最小実装の 4 */
export const MODIFIER_KEYS = ["multiCharge", "bloodPrice", "comboFuel", "echo"] as const;
export type ModifierKey = (typeof MODIFIER_KEYS)[number];

export type Activation =
  | { kind: "tap" }
  | { kind: "hold"; maxTime: number }                                   // 押している間持続
  | { kind: "charge"; minTime: number; maxTime: number; maxMul: number } // 離して発動
  | { kind: "recast"; window: number };                                  // 再入力で別動作

export type SkillCost =
  | { kind: "none" }
  | { kind: "energy"; amount: number }
  | { kind: "hpFraction"; fraction: number }
  | { kind: "combo"; stacks: number };

export interface SkillDef {
  key: SkillKey;
  name: string;
  /** ツールチップ先頭の動詞 1 行（build-diversity 7-1） */
  verb: string;
  tags: readonly SkillTag[];
  /** rollOutgoing に渡す種別。melee / ranged なら装備の近接・射撃倍率に乗る */
  damageKind: DamageKind;
  activation: Activation;
  cooldown: number;
  charges: number;
  cost: SkillCost;
  /** 発動中に受け付けない入力（dash: true ならダッシュでもキャンセル不可） */
  locks: { melee: boolean; shoot: boolean; dash: boolean };
}

/** 1 回の発動の最終パラメータ。修飾子・変異を畳み込んだ結果 */
export interface CastParams {
  damageMul: number;
  /** buff 系の効果量倍率（血の代償が buff に効く経路） */
  potencyMul: number;
  areaMul: number;
  durationMul: number;
  cooldownMul: number;
  charges: number;
  /** 発動時に払う最大 HP 割合（0 なら無し） */
  hpCostFraction: number;
  /** コンボ燃料: 1 スタックあたりの威力加算。0 なら消費しない */
  comboFuelPerStack: number;
  comboFuelCap: number;
  comboFuelEmptyMul: number;
  /** 反響: 遅延秒と威力倍率。null なら無し */
  echo: { delay: number; damageMul: number } | null;
}

export interface ModifierDef {
  key: ModifierKey;
  name: string;
  verb: string;
  /** このタグを 1 つでも持つスキルには付けられない */
  excludesTags: readonly SkillTag[];
  apply(p: Readonly<CastParams>): CastParams;
}

// ---- 永続（スキル石） ----
export const VARIANT_AXES = [
  "areaVsDamage", "cooldownVsDamage", "speedVsDamage", "countVsDamage", "durationVsPotency",
] as const;
export type VariantAxis = (typeof VARIANT_AXES)[number];

export interface VariantRoll {
  axis: VariantAxis;
  /** -1..1 */
  value: number;
}

export interface SkillStone {
  id: string;
  seed: number;
  skillKey: SkillKey;
  /** 最小実装では [] */
  variants: VariantRoll[];
  /** 最小実装では 2 固定 */
  links: number;
  /** 最小実装では null */
  mutation: string | null;
  foundDepth: number;
  /** epoch ms */
  foundAt: number;
}

export interface SkillProfile {
  version: 1;
  /** スキルスロット i に装着した石の id */
  loadout: (string | null)[];
  stones: SkillStone[];
}

// ---- ラン内 ----
export interface SkillInstance {
  stoneId: string;
  skillKey: SkillKey;
  cooldownLeft: number;
  chargesLeft: number;
  /** ラン内修飾子。石ではなくスロットに属する（石を入れ替えても残る） */
  modifiers: ModifierKey[];
  /** 発動中の残り秒（旋風斬りの回転など）。0 なら非発動 */
  activeTimer: number;
  /** 多段ヒット用 */
  hitIds: Set<number>;
  tickTimer: number;
  /** 発動時に確定した CastParams（発動中の update で使う） */
  current: CastParams | null;
  aimDir: Vec;
  uses: number;
}

/** 遅延効果（グレネード起爆・反響）。決定性のため配列順で処理する */
export interface DelayedCast {
  id: number;
  timer: number;
  skillKey: SkillKey;
  pos: Vec;
  dir: Vec;
  params: CastParams;
  /** true なら反響による 2 回目（再度の反響を積まない） */
  isEcho: boolean;
}

export interface RuneTablet {
  id: number;
  modifier: ModifierKey;
  pos: Vec;
  bobTime: number;
}
```

### 6-2. 既存型への追加

| 場所 | 追加 | 理由 |
| --- | --- | --- |
| `src/loot/types.ts` `PlayerStats` | `skillSlots`（既定 2）、`skillDamageMul`（1）、`skillCooldownMul`（1）、`skillAreaMul`（1） | 装備アフィックスでスキルを伸ばす入口。types.ts は決定済みなので追加理由をコメントに残す |
| `src/loot/types.ts` `TriggerKind` | `onSkillUse` | 「スキル使用時 → 衝撃波」などをトリガー文法に乗せる |
| `src/loot/types.ts` `TriggerEffectKind` | `reduceSkillCooldown`（magnitude = 秒） | 装備側からスキル回転を支える |
| `src/core/state.ts` `DamageKind` | `"skill"` | melee / ranged 倍率を使わず `skillDamageMul` に乗る種別。crit と on-hit 状態異常は有効 |
| `src/core/state.ts` `GameState` | `skills: SkillInstance[]`、`delayedCasts: DelayedCast[]`、`skillProfile: SkillProfile`、`runeTablets: RuneTablet[]` | ラン内状態 |
| `src/core/state.ts` `Player` | `parryTimer`、`parryFailTimer`、`frenzy: TimedMul`、`lifesteal: TimedMul`、`lungeComboTimer` | パリィ・血の契約・突進斬りからの 2 段目派生 |
| `src/core/input.ts` | `ActionName` に `skill1`〜`skill4`、`FrameInput.skillPressed: readonly boolean[]` | 入力 |

### 6-3. ダメージの伸び方（タグと DamageKind）

```
最終威力 = base x CastParams.damageMul x rollOutgoing(kind) x stats.skillDamageMul
  kind = "melee"  → (base + meleeDamageFlat) x meleeDamageMul。onMeleeHit / everyNthMeleeHit も発火、lifeOnHit も乗る
  kind = "ranged" → (base + rangedDamageFlat) x rangedDamageMul。発動時に onShoot を 1 回発火
  kind = "skill"  → 武器倍率なし。crit・状態異常は有効
範囲 = base x CastParams.areaMul x stats.skillAreaMul（melee タグは meleeReachMul も掛ける）
CD   = def.cooldown x CastParams.cooldownMul x stats.skillCooldownMul
```

`computeStats` のタグ逓減（build-diversity 1-1）を入れる場合、`skillDamageMul` は damage タグに含める。

### 6-4. `resolveCast`（純関数、テスト対象）

```ts
// src/skills/resolve.ts
export function resolveCast(def: SkillDef, stone: SkillStone, modifiers: readonly ModifierKey[]): CastParams {
  let p = baseCastParams(def);             // damageMul 1, charges def.charges, echo null ...
  p = applyVariants(p, stone.variants);    // 最小実装では素通し
  const extraLinks = Math.max(0, stone.links - SKILL.baseLinks);
  p = { ...p, cooldownMul: p.cooldownMul * (1 + SKILL.linkCooldownPenalty * extraLinks) };
  for (const key of modifiers) {
    if (canAttach(def, key)) p = MODIFIERS[key].apply(p);
  }
  return p;
}
```

stats は発動時に `rollOutgoing` 経由で掛けるので `resolveCast` には渡さない（装備変更が即反映され、純関数のまま保てる）。

---

## 7. 最小実装の仕様（着手用）

### 7-1. スコープ

- アクティブスキル 6: 旋風斬り / 突進斬り / 投擲グレネード / 撃ち抜き / パリィ構え / 血の契約
- 修飾子 4: 多重 / 血の代償 / コンボ燃料 / 反響
- スロット 2、リンクは石ごとに 2 固定。変異・変容・熟練・フォームは入れない
- スキル石は永続（別キーで保存）、刻印符はラン内

選定理由: 6 スキルが近接・移動・設置・射撃・防御・自己強化を 1 つずつ覆い、全部が既存の `damageEnemy` / `explodeAt` / JUST 処理の流用で済む。修飾子 4 つは全部 `CastParams` の書き換えだけで入る。反響は遅延キューを必要とするが、グレネードで同じキューを作るので追加コストがほぼ無い。

### 7-2. 新規・変更ファイル

| ファイル | 内容 |
| --- | --- |
| 新規 `src/skills/types.ts` | 6-1 の型 |
| 新規 `src/skills/defs.ts` | `SKILL_DEFS: Record<SkillKey, SkillDef>` |
| 新規 `src/skills/modifiers.ts` | `MODIFIERS: Record<ModifierKey, ModifierDef>`、`canAttach(def, key)` |
| 新規 `src/skills/resolve.ts` | `resolveCast` |
| 新規 `src/skills/profile.ts` | スキル石の保存・読込。**localStorage key `roguelike.skills.v1`**（`Profile.version` を上げると `loadProfile` が既存装備を空にするので別キーにする） |
| 新規 `src/system/skills.ts` | `updateSkills(state, input, dt)`、各スキルの cast / update（`SKILL_BEHAVIORS: Record<SkillKey, SkillBehavior>`）、遅延キュー、刻印符の拾得・装着 |
| `src/core/input.ts` | `skill1` / `skill2` の束縛、`FrameInput.skillPressed` |
| `src/core/state.ts` | 6-2 の追加 |
| `src/system/player.ts` | `updatePlayer` で `trySpecial` の直後に `updateSkills` を呼ぶ。発動中の近接・射撃ロック判定、`frenzy` を攻撃速度と射撃 CD に掛ける、`lungeComboTimer` 中の近接は combo 1 から |
| `src/system/combat.ts` | `DamageKind "skill"` の処理、`damagePlayer` 冒頭でパリィ判定、吸収（lifesteal）処理 |
| `src/system/triggers.ts` | `onSkillUse` の発火、`reduceSkillCooldown` |
| `src/loot/types.ts` / `src/loot/stats.ts` / `src/loot/affixes.ts` | stats 追加とアフィックス 2 種、トリガー文法への追加 |
| `src/system/floor.ts` | 部屋クリア時のスキル石・刻印符ドロップ |
| `src/render/renderer.ts` | スキル HUD、グレネードの予兆円、撃ち抜きの照準線、刻印符、旋風斬りの円弧 |
| `src/ui/inventory.ts` / `src/render/inventoryUi.ts` | スキル石の一覧と 2 スロット |
| `src/audio/sfxNames.ts` / `src/audio/sfx.ts` | `skillWhirl` `skillLunge` `grenadeThrow` `grenadeBoom` `rail` `parry` `bloodPact` `runeAttach` |
| `src/data/tuning.ts` | `SKILL` 定数（下記） |

### 7-3. 入力

| スロット | キー | 理由 |
| --- | --- | --- |
| skill1 | `Digit1` / `KeyC` / マウス戻るボタン（`Mouse3`） | サイドボタンは照準を動かしながら押せて最速。無いマウス向けに左手のキーを 2 つ |
| skill2 | `Digit2` / `KeyV` / マウス進むボタン（`Mouse4`） | 同上 |

- `MOUSE_CODE` に `3: "Mouse3"`, `4: "Mouse4"` を追加する。**ブラウザの戻る / 進むが走らないよう、`mousedown` と `mouseup` の両方で `preventDefault`** する（戻る / 進むは `mouseup` で発火する）
- `FrameInput.skillPressed` は長さ `SKILL.maxSlots`（4）の配列。未使用スロットは false。`EMPTY_INPUT` も同じ長さの false 配列にする

### 7-4. 発動ルール（`updateSkills`）

1. 全スロットの `cooldownLeft` を減らし、0 でチャージを 1 回復（ダッシュと同じチャージ制。最大は `CastParams.charges`）
2. 押されたスロットについて:
   - 刻印符の上に立っている → 発動せず **装着**（7-7）
   - `parryFailTimer > 0` → 無視
   - ダッシュ中 → `SKILL.dashBuffer` 秒の先行入力として保持し、ダッシュ終了フレームで発動
   - 近接の windup / active 中 → 先行入力として保持し、recover に入った瞬間に近接をキャンセルして発動
   - チャージ 0 → `"cooling"` を灰色のフローティングテキスト（`SKILL.notReadyTextInterval` 秒間隔で抑制）
   - 別スキルが発動中（`activeTimer > 0`）→ 無視
3. 発動: `resolveCast` → コスト支払い（`hpCostFraction` とコンボ燃料） → `SKILL_BEHAVIORS[key].cast(...)` → チャージ -1、`cooldownLeft` が 0 なら CD をセット → `uses += 1` → `fireTrigger("onSkillUse")` → `params.echo` があれば遅延キューへ反響を積む
4. 発動中スキルの `update`（旋風斬りの多段、撃ち抜きの照準、突進斬りの移動）
5. 遅延キューを配列順に進め、timer <= 0 のものを実行して取り除く
6. ダッシュ入力は発動中スキルをキャンセルする（`locks.dash` が false のもの）。キャンセルしても CD は消費済み
7. バーストは常にスキルをキャンセルできる
8. 乱数は `state.rng` のみ使う（決定性）

### 7-5. スキル 6 個の仕様（数値は `SKILL` 定数へ）

| key | 名前 | 種別 | CD | 仕様 |
| --- | --- | --- | --- | --- |
| `whirl` | 旋風斬り | melee | 5.0 | 0.45 秒の回転。0.1 秒ごとに `hitIds` をクリアして半径 `28 x meleeReachMul x areaMul` の円内を 1 ヒット（計 4〜5 回）、威力 7、knockback 60（敵を外に飛ばしすぎない）、ゲージ獲得あり。移動速度 x0.6。近接・射撃ロック。終了後 0.15 秒の recover（ダッシュ可）。回転中はプレイヤーの周りに白い円弧を 2 本描く |
| `lunge` | 突進斬り | melee | 4.0 | 照準方向へ `90 x dashDistanceMul` px を 0.14 秒で移動（`moveBody`）。毎フレーム半径 `radius + 10` の円内の敵に 1 回ずつヒット、威力 16、stagger、knockback 200（進行方向）。**無敵なし**。壁に当たったら停止し 0.25 秒行動不能 + `shake(3)`。終了後 0.3 秒以内の近接入力は combo 1（2 段目）から始める |
| `frag` | 投擲グレネード | skill | 6.0 | 照準位置（最大 120px、壁の手前でクランプ）へ 0.35 秒で飛ぶ（位置は直線補間、描画だけ放物線）。着弾から 0.5 秒後に半径 `36 x areaMul` で爆発、威力 26、knockback 240、stagger。着弾中は赤い円（点滅が加速）。爆発時にプレイヤーが円内で無敵でなければ最大 HP の 10% を受ける。起爆は遅延キューで処理 |
| `railshot` | 撃ち抜き | ranged | 5.0 | 0.35 秒照準（移動不可、向きはカーソル追従、細い赤線を点滅表示）。終了時に壁までの線分（グリッドを 2px 刻みで走査）上の全敵に威力 30、knockback 180。線上の敵弾を消す。反動 120 で後退、`shake(3)`。照準中のダッシュでキャンセルした場合 CD を半分返す |
| `parry` | パリィ構え | skill | 3.0 | `p.parryTimer = 0.22`。`damagePlayer` の冒頭で `parryTimer > 0` なら被ダメを無効化し、既存の JUST 処理（スロー・ゲージ・`justTimer`・`onJustDodge`）を呼ぶ。加えて半径 40 の衝撃波（威力 12、stagger、knockback 260）を出し、CD を 0 に戻す。構えが空振りで終わったら `parryFailTimer = 0.35`（移動・攻撃・ダッシュ・スキル不可、プレイヤーを暗く描く） |
| `bloodPact` | 血の契約 | skill（buff） | 12.0 | 最大 HP の 12% を払う（1 未満にしない）。4 秒間 `frenzy.mul = 1.35`（`meleeStep` の攻撃速度と射撃 CD に掛ける）、`lifesteal.mul = 0.08`（与ダメの 8% を回復、`healMul` を通す）。効果中は赤いオーラ粒子 |

`SKILL` 定数（`src/data/tuning.ts`）の骨子:

```ts
/** スキル。docs/ideas/skills.md 参照 */
export const SKILL = {
  maxSlots: 4,
  baseSlots: 2,
  baseLinks: 2,
  linkCooldownPenalty: 0.15,
  dashBuffer: 0.1,
  notReadyTextInterval: 0.6,
  whirl: { cooldown: 5, duration: 0.45, tick: 0.1, radius: 28, damage: 7, knockback: 60, moveMul: 0.6, recover: 0.15 },
  lunge: { cooldown: 4, distance: 90, time: 0.14, hitPad: 10, damage: 16, knockback: 200, wallStun: 0.25, comboLinkWindow: 0.3 },
  frag: { cooldown: 6, maxRange: 120, flight: 0.35, fuse: 0.5, radius: 36, damage: 26, knockback: 240, selfDamageFraction: 0.1 },
  railshot: { cooldown: 5, aim: 0.35, damage: 30, knockback: 180, recoil: 120, stepPx: 2, cancelRefund: 0.5 },
  parry: { cooldown: 3, window: 0.22, failLock: 0.35, radius: 40, damage: 12, knockback: 260 },
  bloodPact: { cooldown: 12, hpFraction: 0.12, duration: 4, speedMul: 1.35, lifesteal: 0.08 },
  modifier: {
    multiCharge: { extraCharges: 2, damageMul: 0.7, cooldownMul: 1.3 },
    bloodPrice: { hpFraction: 0.06, damageMul: 1.6 },
    comboFuel: { perStack: 0.04, cap: 1.2, emptyMul: 0.8 },
    echo: { delay: 0.8, damageMul: 0.5, cooldownMul: 1.25 },
  },
  drop: { stoneChance: 0.1, runeChance: 0.25, stoneColor: "#b080ff" },
  runePickupRadius: 10,
  hud: { size: 16, gap: 4 },
} as const;
```

### 7-6. 修飾子 4 個の仕様

| key | 名前 | `apply` | 付けられないタグ |
| --- | --- | --- | --- |
| `multiCharge` | 多重 | `charges + 2`、`damageMul x 0.7`、`cooldownMul x 1.3` | なし |
| `bloodPrice` | 血の代償 | `hpCostFraction + 0.06`、`damageMul x 1.6`、`potencyMul x 1.6`（血の契約は `speedMul` の超過分と `lifesteal` に `potencyMul` を掛ける） | なし |
| `comboFuel` | コンボ燃料 | `comboFuelPerStack = 0.04`、`comboFuelCap = 1.2`、`comboFuelEmptyMul = 0.8`。発動時に `state.combo.count` から倍率を決めて `damageMul` に掛け、コンボを 0 にする | なし |
| `echo` | 反響 | `echo = { delay: 0.8, damageMul: 0.5 }`、`cooldownMul x 1.25` | `defense`, `buff`（パリィ・血の契約） |

反響の各スキルでの意味: 旋風斬り = 発動地点に残像が回る / 突進斬り = 発動時の始点から残像が同じ軌跡を突進する（プレイヤーは動かない）/ グレネード = 同じ着弾点にもう 1 個 / 撃ち抜き = 同じ線分にもう 1 本（照準なし）。

同じ修飾子の重複装着は不可（2 つ目は入れ替え扱い）。

### 7-7. 入手と装着

- **スキル石**: 部屋クリア時に `SKILL.drop.stoneChance` で装備ドロップとは別に 1 個、床に落ちる（装備と同じ光柱、色 `#b080ff`）。触れると `skillProfile.stones` へ即保存し、フローティングテキストを出す。`skillKey` は 6 種から一様、`links = 2`、`variants = []`
- **初期所持**: 新規スキルプロフィールには `whirl` と `frag` の石を入れ、スロット 1 / 2 に装着済みにする（初回から遊べるように）
- **刻印符**: 部屋クリア時に `SKILL.drop.runeChance` で部屋中央に 1 枚。種類は装着中スキルのどちらかに付けられるものから一様。符の上（半径 `SKILL.runePickupRadius`）に立っている間、HUD のスキル枠に「+」を表示し、スキルキーでそのスキルへ装着（リンク満杯なら最古と入れ替え、外れた符は足元に落とす）。付けられないスキルのキーを押したら `"incompatible"` を表示。ラン終了で消える
- **装着 UI**: Tab の装備画面に「SKILLS」欄を追加。上に 2 スロット、下にスキル石の一覧。一覧クリック → 空きスロット（無ければ選択中スロット）へ装着、スロットクリック → 外す、Shift + クリック → 分解。ツールチップは `verb` 1 行 + タグ。ラン中に石を入れ替えた場合、修飾子は石ではなくスロットに残る（ラン内要素なので）。付けられなくなった修飾子は無効表示（灰色）で残す

### 7-8. HUD

- 画面左下、エネルギーバーの上にスロット 2 枠（16x16、間隔 4）。枠内にスキルの 1 文字アイコン、下にキー表示（`1` / `2`）
- CD 中は上から暗いマスクが減っていく（割合 = `cooldownLeft / cd`）。チャージは枠下のドット
- 装着中の修飾子は枠右の小さな色付きドット（多重 = 白、血の代償 = 赤、コンボ燃料 = 黄、反響 = 紫）

### 7-9. 装備側の接続（アフィックス 2 種 + トリガー）

| アフィックス | 種別 / スロット | 効果 | 代償 |
| --- | --- | --- | --- |
| Channeler's | prefix / amulet, ring | `skillDamageMul` +20〜40% | `meleeDamageMul` と `rangedDamageMul` -10% |
| of Recurrence | suffix / ring, boots | `skillCooldownMul` -10〜25% | なし（低 tier の重みを重くする） |

- トリガー文法に `onSkillUse` を追加（既存の effect 全部と組み合わせ可）、effect に `reduceSkillCooldown` を追加（magnitude 0.5〜1.5 秒）。`onSkillUse → reduceSkillCooldown` は自己ループになるので生成時に除外する
- キーストーンの禁止（pacifist / bladeOath）はスキルに効かない（2 章の原則）。`ks_overclock` の HP コストはスキル発動にも掛ける

### 7-10. テスト（Vitest）

| 対象 | 確認すること |
| --- | --- |
| `resolveCast` | 修飾子 0〜2 個の各組み合わせで `CastParams` が期待値になる。反響は `defense` / `buff` に付かない |
| チャージと CD | 多重付きで 3 回連続発動でき、4 回目は失敗。CD 経過で 1 回ずつ回復 |
| コスト | 血の代償 / 血の契約で HP が 1 未満にならない |
| コンボ燃料 | コンボ 10 で威力 x1.4、発動後コンボ 0。コンボ 0 で x0.8 |
| 各スキル | `testHelpers` で敵を配置し、範囲内だけにヒットする（旋風斬りは多段、撃ち抜きは壁で止まる、グレネードは fuse 後に爆発し、円内の非無敵プレイヤーが被弾） |
| パリィ | 構え中の被弾が無効化され `onJustDodge` が発火、CD が 0 に戻る。空振りで `parryFailTimer` が立つ |
| 反響 | 0.8 秒後に 50% で再発動し、反響の反響は起きない |
| 決定性 | 同 seed + 同入力列（スキル入力を含む）で最終 state が一致（既存のスモークテストに入力を追加） |
| 保存 | `roguelike.skills.v1` の読み書き、壊れた JSON で初期プロフィール、既存の `roguelike.profile.v1` に触れない |
| 入力 | `Digit1` / `Mouse3` が `skillPressed[0]` になる |

### 7-11. 実装順

1. 型・定義・`resolveCast`・`SKILL` 定数（テストだけで完結）
2. 入力と `updateSkills` の骨組み、HUD、旋風斬り（1 スキルでループ全体を通す）
3. 遅延キュー + グレネード + 反響
4. 突進斬り・撃ち抜き・パリィ・血の契約
5. スキル石の保存・ドロップ・Tab UI
6. 刻印符のドロップと装着
7. アフィックス 2 種とトリガー追加

### 7-12. 最小実装の後に入れる順

1. 変異軸とリンク数のロール（石に個性が出る。`resolveCast` の `applyVariants` を埋めるだけ）
2. 熟練分岐（ラン内成長）
3. フォーム: ダッシュ「ブリンク」（ks_blink の移管）と近接「大剣の溜め斬り」
4. スロット増設アフィックスとスキル向けキーストーン
5. 残りのスキル・修飾子を S コストのものから
