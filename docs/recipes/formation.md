# レシピ: 陣形（八陣）

陣形 = 陣（敵の一団が占める場所）の中の役割と格の組み合わせと並べ方。設計は `docs/ideas/jin-impl.md` 2-5・2-6、考え方は `docs/ideas/core-synthesis.md` 4 章。

- **key と表示名**: `src/data/formations.ts` の `FORMATION_KEYS` と `FORMATION_LABEL`（熟語。`docs/GLOSSARY.md` に 1 行）。まだ JSON の無い key は抽選に出ない
- **数値**: `src/data/balance/enemies/FORMATION/<key>.json` を 1 つ足し、`src/data/balance/enemies/FORMATION/_index.json` の `_order` に key を足して `npm run balance:gen`。項目の意味は `_index.json` の `_fields`
  - `layout`: 並べ方（`FORMATION_LAYOUTS`。wedge 三角 / vee V 字 / arc 弧 / line 一列 / ring 輪 / diagonal 斜め / column 縦列 / twoRows 2 列 / single 1 点）。新しい並べ方は `src/map/formation.ts` の `layoutOffsets` に足す（正面 +x、原点が陣の中心の純関数）
  - `minDepth` / `weight` / `spacing`
  - `leader`（任意）: 大将のスロット `{ role, grade, lairChance }`。先頭（正面）に置き、深度 3 以降は精鋭を必ず 1 つ付ける。部屋主が候補にいれば `lairChance` で大将にする。大将の重さは `JIN.gradeWeight.leader`（倒すと群勢が大きく下がる）
  - `cooldownStagger`（任意）: 置いた順に最初の攻撃を秒ずつ遅らせる（鋒矢: 列の後ろほど遅れて来る）
  - `rotate`（任意）: 前列が打った後に下がり、後列が前へ出る列の入れ替え `{ restMul, stepInCooldown }`（衡軛。`system/jinFormations.ts`）
  - `jinzu`（任意）: 本陣になったときの陣図 `{ leaderSeat, strokeSec?, strokes: [{ squad, path, pass, beyond }] }`。無い陣形は本陣にならない（偃月・方円・雁行・衡軛は未実装）。`leaderSeat`（rear / front / center）に最も近いメンバー 1 人が大将に格上げされる（新しく湧かせない）。`squad` は `data/formations.ts` の `JinzuSquadKey`、選び方は `system/jinzuSquads.ts` の `pickSquad`。`path` は hook / flank / thrust / volley（形は `map/jinzuShape.ts`）。本陣に開く陣形は `HONJIN.formationsByChapter`。テスト: `src/system/jinzu.test.ts` の「陣図の作図」が全陣形 × 的の距離 × 向きで安全地帯を縛る
  - `slots`: `{ role, grade, share, min, max? }` の配列。**正面に立つスロットを先に書く**（置く順 = 並びの順）。人数は `round(予算 × share / JIN.gradeWeight[grade])` を min / max で挟む。格が深度で解禁されていなければ並に落とし、役割に合う敵が深度に無いスロットは見送る
  - role / grade / layout の打ち間違いは読み込み時に throw する
- **役割**: 敵の役割は `src/data/enemyRoles.ts` の `ROLE_BY_BEHAVIOR` で決まる（違う敵だけ `EnemyDef.role`）。陣形のスロットに入れたい敵は役割が合うか確かめる
- **配り方**: `src/system/jinSpawn.ts` の `planJins`（陣を置く塊と予算）と `spawnJin`（スロットを埋める）。通路の長蛇は陣形 `column`
- テスト: `src/data/formations.test.ts`（JSON の検査）・`src/map/formation.test.ts`（並べ方）・`src/system/jinSpawn.test.ts`（配り）

最後に `npm run check`。生成直後の総数と陣形の出現数はフル QA の陣の表（`src/qa/jinMetrics.ts`）で見る。
