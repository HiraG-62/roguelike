# 奥義と左右アクション: 必殺技の刷新と右クリックの連撃化（2026-09-25）

architect の設計メモ。memo `memo/20260925-1.md`「戦闘システム」の 1・2 項に対する推奨 1 案と実装レーン。コードは触っていない。根拠の行番号は 2026-09-25 時点。

## 0. 前提（ユーザーの決定と現状の観察）

- 決定: コンテンツ量は多いほど良い / 確認なしで進める / 移動 WASD・照準と攻撃はマウス・キーボードの攻撃キーは左手側（Q / E）/ 右クリックを封じる効果は作らない / 名称の第一候補は「奥義」「奥義ゲージ」
- 現状の観察
  - バーストは `src/system/player.ts:1448` `trySpecial` が `PLAYER.special`（`src/data/balance/combat.json:483`）の 1 種類だけを出す。威力は `burstDamage`（`player.ts:337`）= `scaled(PLAYER.special.scaling) × burstDamageMul`、範囲は `burstRadiusMul`、終わりに `onBoonBurstKills` と `onBurst` イベント（`player.ts:1481-1482`）
  - 右クリックは `MovesetDef.art: WeaponArtDef`（`src/data/weapons.ts:154-160`）1 つ。strike は `defineMoveset`（`weapons.ts:584`）が `["secondary"]` の派生として `branches` に混ぜ、hold / charge / throw / recall は `src/system/weaponArts.ts` が動かす
  - 派生の照合は `matchBranch`（`weapons.ts:1013`）= 入力列の末尾一致・長い列が先。入力列は `chainMaxInputs 5`・`chainWindow 0.5`（`weapons.json:7-8`）。段の進みは `AttackState.step`（`src/core/state.ts:45`）で左だけが持つ
  - 変身（`src/skills/forms.ts`）は `state.skills.shape.moveset` を `playerMoveset`（`player.ts:230`）が装備より先に読む。「型を差し替える」層はここにある
  - 「奥義」は既に **系譜の 4 段目**（`docs/GLOSSARY.md:320`、`docs/ideas/boons-expansion.md:19`）と **目覚め `schoolMastery` のラベル**（`src/loot/affixes.ts:2561`「奥義: ジョブの得意武器を…」）で使われている。祝福カード本体に「奥義」の文字は無い（grep で src のヒットは affixes の 1 件と inventoryUi のコメントだけ）
  - QA bot は右の技を `ART_PERIOD` ごとに押す（`src/qa/bot.ts:626`）が、**F（specialPressed）を一度も押していない**（bot.ts に `specialPressed` の出現なし）。バーストは QA で踏まれていない

## 1. 結論（推奨 1 案）

1. **名称**: 必殺技 = **奥義**、ゲージ = **奥義ゲージ**、キーは F のまま。内部 key（`energy` / `special` / `burstDamageMul` / `burstRadiusMul` / `onBurst` / `specialPressed` / 依頼 `burstMaster`）は変えない。衝突する既存表示は 系譜 4 段目「奥義」→ **「真髄」**、目覚めのラベル「奥義:」→ **「免許皆伝:」** に改める（表示だけ）
2. **奥義のデータ**: `src/data/ultimates.ts` に `UltimateDef`（`kind: "instant" | "sustain"`）。**23 武器種 × 3 = 69 本**。数値は `src/data/balance/ultimates.json` の `ULTIMATE` ブロック。instant は「行為の列」（`UltimateAct[]`: nova / swing / volley / lunge / pull / buff / detonate）の組み合わせ、sustain は「ゲージが減る間の倍率・段の差し替え・弾の差し替え・命中付与・Rule」の束
3. **選び方**: **拠点の武器掛け（rack）で武器種ごとに 1 本選び、`Profile` に `ultimates` を足して永続化**（`roguelike.profile.v1` のまま。追加フィールドは欠けたら既定 = その武器種の 1 本目）。ラン中は変えない。リプレイは `ReplayLoadout.ultimates` を写し `REPLAY_VERSION` を 8 → 9
4. **右クリック = アクション 2**: `MovesetDef.art` を廃止し、右の連撃 **`steps2: ActionStepDef[]`** を足す。段は「振り（swing）」のほかに **構え（hold）/ 弾（volley）/ 溜め（charge）/ 狙い（aim）/ 手元返し（recall）** でもよい（= 既存の固有技 5 種は右レーンの段になる）。**段カウンタは左右で共有**（`AttackState.step`）: 3 段目に左を押せば `steps[2]`、右を押せば `steps2[2]`。これで「左右左」「右左左」「左右右」…の **2^n 通りの混合が追加データなしで全部別の連撃**になり、その上に名前付きの派生（`BranchDef`、3 入力以上）を武器種ごとに 4 本以上重ねる
5. **sustain の「基本アクションの変化」は変身と同じ層**で表す: `playerMoveset` を 変身 → **奥義の差し替え** → ジョブ派生 の順にする。`ShapeFormState` 自体は流用しない（`CastParams` と刻印符に縛られている）が、`withExtraBranch` / `defineMoveset` と同じ「型を合成して返す」形で `withUltimateMoves(moveset, override)` を作る
6. 既存の `burstDamageMul` は奥義の行為（nova / swing / volley / lunge / aura）の威力に、`burstRadiusMul` は nova / pull / aura の半径にだけ掛ける（sustain 中の通常攻撃には掛けない = 二重掛けを避ける）。`onBurst` は instant なら発動時（amount = 倒した数）、sustain なら**終了時**（amount = 持続中に倒した数）に 1 回だけ積む。祝福 還元 / 焦土 / 換金 / 臨界 / 大地の怒り・依頼 全力解放 は無改造で生きる

却下した案（1 行ずつ）:
- 右の長押しで固有技・タップで右連撃: 受け流しは押した瞬間に窓が要るので長押し判定の遅延（0.1 秒超）と相性が悪い
- 奥義をラン内の祝福 3 択で差し替える: 装備スナップショットで確定できず、リプレイと bot の経路が増える。「祝福を強くしたい」は memo 3 項で別レーン
- 奥義を武器のベース（器）に紐付ける: 同じ武器種で器が 3〜4 個あり、表示と選択の説明が冗長になる
- 左右で独立の段カウンタ（右を押すと右レーンの 1 段目から）: 混合が「割り込み」になり、左右左 と 左左左 の違いが 1 段目の繰り返しに退化する
- `ShapeFormState` を奥義に流用: 変身は `slot` / `CastParams` / 共有の待ち（formWait）に縛られ、奥義に不要な状態が state に残る

## 2. 名称（`docs/GLOSSARY.md` に足す行）

| 表記 | 内部名 | 意味 | 出典 |
| --- | --- | --- | --- |
| 奥義 | `special`（入力）/ `UltimateDef`（定義）/ `Player.ultimate`（作業領域） | 奥義ゲージ満タンで F。武器種ごとに 3 本から拠点で 1 本選ぶ。一撃（instant）と、ゲージが減る間の強化（sustain）がある。旧表記「バースト」 | `data/ultimates.ts`、`system/ultimates.ts` |
| 奥義ゲージ | `energy` / `maxEnergy` | 奥義の資源。旧表記「必殺ゲージ」「エネルギー」 | HUD、祝福の説明文 |
| 奥義の威力 / 奥義の範囲 / 奥義ゲージ獲得 | `burstDamageMul` / `burstRadiusMul` / `energyGainMul` | 性質の表示名（`loot/stats.ts:313-315`）。旧「必殺ダメージ / 必殺範囲 / 必殺ゲージ獲得」 | `loot/stats.ts` |
| アクション 1 / アクション 2 | `primary` / `secondary`（`ButtonKey`） | 左クリック / 右クリックの連撃。HUD の表示は「左」「右」のまま | `data/weapons.ts` |
| 真髄 | 系譜の 4 段目（`BoonDef.after` の末尾 + `requires`） | 旧表記「奥義」。祝福カードに文字は出ていないので docs とテスト名の置換のみ | `docs/ideas/boons-expansion.md` |
| 免許皆伝 | 目覚め `schoolMastery` のラベル接頭 | 旧「奥義:」 | `loot/affixes.ts:2561` |

- 「バースト」を残す語の一覧（`GLOSSARY.md:30`）から外し、`scripts/audit-agent-docs.mjs` の旧用語に「バースト」「必殺ゲージ」「固有技」を足す（Lane C の完了条件）
- 「固有技」は語として消える（右の 1 段目に吸収）。キー設定画面のアクション名 `shoot` の表示（`render/titleUi.ts:80`）は「攻撃 2（右）」、`attack` は「攻撃 1（左）」
- 「秘技」「必殺技」は候補から外す: 秘伝（目覚め）と紛れる / 「必殺」は既に「必殺ゲージ」で揺れの元になった語

## 3. 奥義（A）

### 3.1 型（`src/data/ultimates.ts`、新規）

```ts
export const ULTIMATE_KINDS = ["instant", "sustain"] as const;
export type UltimateKind = (typeof ULTIMATE_KINDS)[number];

/** instant の 1 行為。列に並べて順に出す（照準方向・自分の位置は発動時に固定） */
export type UltimateAct =
  | { kind: "nova"; radius: number; scaling: Scaling; poise: number; poiseRatio?: AttrRatio; knockback: number; applies?: readonly StatusApply[]; hits?: number; clearsBullets?: boolean }
  | { kind: "swing"; step: MeleeStepDef }                       // beginSwing に branch 相当で渡す 1 振り（heavy・lunge・hits を使える）
  | { kind: "volley"; throw: ThrowArtDef }                      // weaponArts.emitArtVolley を呼ぶ
  | { kind: "lunge"; distance: number; step: MeleeStepDef; invuln: number } // 照準方向へ distance 進みながら step で当てる（見切り斬り ACTION.justCounter の経路を借りる）
  | { kind: "pull"; radius: number; toDistance: number; applies?: readonly StatusApply[] }
  | { kind: "buff"; damageMul?: number; speedMul?: number; duration: number; invuln?: number; heal?: number }
  | { kind: "detonate" };                                        // 床の自分の設置弾を全部起爆（weaponArts.detonateOwnMines を export）

export interface SustainDef {
  /** 毎秒減るゲージ。0 になったら終わる。もう一度 F で早く終える（残りは保つ） */
  readonly drainPerSec: number;
  readonly minSec: number;
  readonly mul: { readonly damage?: number; readonly attackSpeed?: number; readonly fireRate?: number; readonly moveSpeed?: number; readonly poise?: number; readonly incoming?: number };
  /** 段の差し替え（省略した側はそのまま）。銃は bullet で弾を差し替える */
  readonly steps?: { readonly primary?: readonly MeleeStepDef[]; readonly secondary?: readonly ActionStepDef[] };
  readonly bullet?: Partial<BulletNumbers>;
  /** 近接・射撃の命中で付ける状態異常 */
  readonly applies?: readonly StatusApply[];
  /** 自分の周りに毎 interval 秒ダメージ（radius は burstRadiusMul が掛かる） */
  readonly aura?: { readonly radius: number; readonly interval: number; readonly scaling: Scaling; readonly poise: number };
  /** 持続中だけ効く Rule（system/rules.ts の collectRules が Player.ultimate.active のとき集める） */
  readonly rules?: readonly Rule[];
  /** 終わりに出す行為（狂戦士の反動、魔法陣の炸裂など） */
  readonly onEnd?: readonly UltimateAct[];
}

interface UltimateBase { readonly key: string; readonly name: string; readonly desc: string; readonly moveset: MovesetKey; readonly attack: AttackProfile; }
export type UltimateDef =
  | (UltimateBase & { readonly kind: "instant"; readonly acts: readonly UltimateAct[]; readonly invuln: number })
  | (UltimateBase & { readonly kind: "sustain"; readonly sustain: SustainDef });

export const ULTIMATES: Readonly<Record<MovesetKey, readonly [UltimateDef, UltimateDef, UltimateDef]>>;
export function ultimateDef(key: string): UltimateDef | undefined;
export function defaultUltimate(moveset: MovesetKey): UltimateDef;   // 配列の 0 番目
export function isUltimateKey(v: unknown): v is string;
```

- 数値は `ULTIMATE.common { cost: 100, invuln: 0.15, hitstop: FEEL.hitstopHeavy 相当, textColor, endTextColor }` と `ULTIMATE.defs.<key>`（行為ごとのブロック）。`PLAYER.special`（`combat.json:483`）は削除し、`maxEnergy` / `energyPerHit` は残す
- 係数は `docs/STATS_AND_SCALING.md` 2 章に従い、奥義は「体全体を使う締め」なので **3 種以上を許す**（同 2 章の例外表）。基準点: 基礎値で nova 34（現行と同じ = base 24 + mnd 1 + spi 1 の置き換え）、単体大技 60 前後、sustain の倍率 1.3〜1.5・8 秒（drain 12.5/秒）
- 素性（`attack`）は奥義ごとに決める。現行 `BURST_ATTACK`（`weapons.ts:1056` = area / arcane）は「円月」に残し、他は武器種の `attack` を基本にする

### 3.2 作業領域と流れ

- `src/core/state.ts`（最小 Edit）: `Player.ultimate: { active: string | null; elapsed: number; kills: number; auraTick: number }`。`ultimate.active` は sustain 中の key。instant は state に残らない
- `src/system/ultimates.ts`（新規）
  - `tryUltimate(state): boolean` — `readActions`（`player.ts:392`）の `trySpecial` をこれに置き換える。ゲージ不足なら「未充填」（既存の文言）。sustain 中に押したら `endUltimate(state, "manual")`
  - `updateUltimate(state, dt)` — `updatePlayer` で `updateArt` の直後。drain・aura・時間切れ
  - `ultimateMoveset(state, base): MovesetDef` — `playerMoveset` が 変身の次に通す。`steps` / `bullet` の差し替えを畳んだ型を返す（key ごとにキャッシュ。`withJobBranch` と同じ流儀）
  - `ultimateOutgoingMul(state) / ultimateIncomingMul(state) / ultimateMoveMul(state) / ultimateSpeedMul(state)` — `player.ts` の `actionStats`（`player.ts:499`）・`updateMovement`（`player.ts:620`）・`combat.ts` の `damagePlayer` に 1 行ずつ
  - `ultimateApplies(state)` — `applyStepStatus`（`player.ts:1071`）と弾の命中で `sustain.applies` を足す
  - `noteUltimateKill(state)` — `combat.ts` の撃破分岐に 1 行（`kills += 1`）
  - `chosenUltimate(state): UltimateDef` — `state.profile.ultimates?.[moveset] ?? defaultUltimate(moveset)`。変身中は変身前の武器種で引く
- 発動の流れ（instant）: ゲージ 0 → `cancelAttack` → acts を順に実行（swing / lunge は 1 振りとして `beginSwing` に `spec.ultimate = true` で渡し、`meleeStep` が `Player.ultimate` の step を返す。振りが終わるまで次の act を待つ列は持たず、**swing / lunge は列の最後にだけ置く**という制約をテストで固定する）→ 無敵 → `pushSfx("burst")`（音名は据え置き）→ `onBoonBurstKills` → `onBurst`
- 発動の流れ（sustain）: ゲージはそのまま drain 開始 → `active = key` → 変身中なら `endShape(state, "manual")`（同時に立てない。逆に持続中に変身を撃ったら `endUltimate(state, "form")`）→ 浮き文字「<奥義名>」→ 終了時に `onEnd` acts → `onBurst`（amount = kills）→ 浮き文字「奥義が終わった」
- Rule 条件を 1 つ足す（`src/core/rules.ts`、最小 Edit）: `{ kind: "ultimateActive" }`。sustain の `rules` は `system/rules.ts` の `collectRules` が `active` のときだけ集める（武器種の `movesetRules` の隣）
- `burstDamageMul` の掛け先: acts と aura の `scaling` 評価の直後。`burstRadiusMul`: nova / pull / aura の radius
- 効果音: 発動 `burst`（既存）、sustain の終了は `formShift` を借りる。新規は足さない

### 3.3 全 23 武器種 × 3 本（名前 / 種類 / 1 行）

1 本目が既定。名前は 派生名（`BRANCH_NAMES`）・技名（`ART_NAMES`）・祝福名・スキル名（極意 / 十文字 / 大車輪 / 乱れ突き / 槍衾 / 大刈り / 猛打 / 唐竹割り / 大回し / 魔弾 …）と重ならないように選んだ。

| 武器種 | 1（既定） | 2 | 3 |
| --- | --- | --- | --- |
| 剣 | **円月**（instant）: 周囲 6.4m に nova・敵弾を消す（現行バーストの後継、area / arcane） | **一閃**（instant）: 照準方向へ 12m 突進しながら通過した敵を heavy で斬る。踏み込み中は無敵 | **剣気解放**（sustain）: 左右の段のリーチ ×1.5・各振りが剣気の波（volley、貫通）を 1 本飛ばす |
| 大剣 | **断罪**（instant）: 前方 240° に溜め 3 段相当の一振り（heavy・怯み値 ×3） | **巨人の膂力**（sustain）: 溜め時間 ×0.5・攻撃中の移動 ×2・怯み値 ×1.5 | **地割り**（instant）: 前方へ 3 連の衝撃波（volley、幅広・低速） |
| 双剣 | **千刃**（instant）: 周囲に hits 8 の乱舞（円 3.6m） | **影渡り**（instant）: 照準方向へ 10m すり抜けつつ斬る（無敵・出血 2） | **残影**（sustain）: 全段 hits +1・移動 ×1.3・会心率 +15% |
| 槍 | **龍穿**（instant）: 9m の長い突き（thrust、貫通、穂先判定 ×2） | **流星突き**（instant）: 突進突きを 3 連続（各 4m、最後だけ heavy） | **陣の構え**（sustain）: 全段に穂先判定・射程 ×1.3・敵の予備動作中の命中は常にカウンター |
| 大鎌 | **魂刈り**（instant）: 引き寄せ pull 6m → 360° の一振り。倒した数 × 生命 3% 回復 | **大回転**（instant）: 360° hits 3・引き寄せ | **死神の間合い**（sustain）: 全段 pull・範囲 ×1.3・撃破ごとに気力 +8 |
| 拳 | **震脚**（instant）: nova 4m・怯み値 80・崩勢 1.5 秒 | **崩拳**（instant）: 単体へ踏み込み heavy 一撃（威力 60・壁叩きつけ確定） | **闘気開放**（sustain）: 全段 heavy・連打段 hits +2・被ダメ ×0.7 |
| 鞭 | **蛇縛り**（instant）: pull 7m + 恐怖 2 秒 | **百鳴り**（instant）: 全周 hits 6・先端判定を常に最大 | **雷鞭**（sustain）: 命中で感電 1・先端判定が常に最大・属性を雷に |
| 鉈 | **血肉断ち**（instant）: 前方 heavy 一振り（威力 70）+ 出血 3 | **首落とし**（instant）: nova 4m。生命 30% 以下の敵は即死（ボス除く） | **狂戦士**（sustain）: 攻撃速度 ×1.4・移動 ×1.3・被ダメ ×1.3。終了時 2 秒弱体（onEnd buff） |
| 棍 | **竜巻**（instant）: nova hits 4・気力回収 ×2 | **千本突き**（instant）: 前方へ突き 5 連（各 hits 1、押し返し） | **柔の呼吸**（sustain）: 命中の気力 ×2・スキルの再使用の進み ×1.5（Rule） |
| 杖 | **魔導砲**（instant）: 大魔弾 1 本（volley、貫通 99、威力 ×4、arcane / light） | **魔法陣**（instant）: nova 6m（arcane）+ 敵弾を消す + 気力全回復 | **詠唱**（sustain）: 左が魔弾の 3 連射（steps.primary を volley 相当の短い振りに差し替え = 段の後ろに volley act）・移動 ×0.8 |
| 刀 | **一刀両断**（instant）: 照準方向へ 8m の突進斬り heavy（威力 65） | **燕舞**（instant）: 周囲へ 3 連の斬り（hits 3、最後 heavy） | **無想**（sustain）: 予備動作中の命中が常にカウンター・右 1 段目が居合の 2 段相当・移動 ×1.1 |
| 斧 | **血祭り**（instant）: nova 5m + 出血 3 | **大投擲**（instant）: 斧 3 本を扇に投げ、戻る（volley boomerang ×3） | **狂斧**（sustain）: 全段出血 1・出血の敵に威力 ×1.3 |
| 大盾 | **盾撃**（instant）: 前方 heavy（威力 45）+ ノックバック 600 | **反撃の狼煙**（instant）: nova 5m で押し返し + 生命 15% 回復 + 無敵 1 秒 | **鉄壁**（sustain）: 常時「構え」扱い（前方 120° 被ダメ ×0.3・移動そのまま）・命中の怯み値 ×1.5 |
| 鎖鎌 | **蜘蛛の巣**（instant）: 全周 pull 7m + 崩勢 2 秒 | **縛り首**（instant）: 最寄りの敵 1 体を pull → heavy（威力 55） | **分銅回し**（sustain）: 右の分銅段が hits 2・範囲 ×1.5・引いた敵に威力 ×1.3 |
| 戦鎚 | **天墜**（instant）: nova 6m heavy・怯み値 100・衝撃波 | **砕地**（instant）: 前方へ衝撃波 3 連（volley、堅守無視） | **鉄槌の律**（sustain）: 全段に衝撃波（Rule）・堅守の敵への怯み値 ×2 |
| 二丁拳銃 | **死の輪舞**（instant）: 全周 16 発 | **早撃ち**（instant）: 照準へ 6 連（間隔 0.05） | **弾幕**（sustain）: 弾数 +1・連射 ×1.5・反動なし |
| 短銃 | **早抜き**（instant）: 狙い撃ち 6 発を 0.4 秒で（貫通 +1） | **至近弾**（instant）: 全周 8 発 + 自分を後ろへ 40px | **集中**（sustain）: 移動 ×1.2・弾に貫通 +1・会心率 +20% |
| 長銃 | **徹甲弾**（instant）: 1 発（貫通 99・威力 ×4・怯み値 ×3） | **掃射**（instant）: 前方 60° に 8 発 | **狙撃手の息**（sustain）: 弾速 ×1.5・敵の予備動作中の命中 ×1.5（Rule）・立ち止まると射撃間隔 ×0.8 |
| 砲 | **大砲撃**（instant）: 大爆発の弾 1 発（blast 6m） | **全弾発射**（instant）: 床の設置弾を全部起爆（detonate）+ 前方 5 発 | **火薬庫**（sustain）: 爆風 ×1.5・設置弾は置いた 0.5 秒後に起爆 |
| 投擲 | **千手**（instant）: 全周 12 本 | **一点集中**（instant）: 照準の敵へ追尾 8 本（homing） | **手返しの理**（sustain）: 全弾が戻る（boomerang 化）・戻りの威力 ×1.3 |
| 擲弾 | **雨**（instant）: 照準を中心に曲射 5 発 | **焼夷弾**（instant）: 曲射 3 発が着弾点に炎の地形を残す（igniteTerrain） | **榴弾の宴**（sustain）: 弾数 +1・爆風 ×1.3・至近にも落とせる（minRange 0） |
| 仕掛け | **地雷原**（instant）: 周囲に設置弾 8 個 | **一斉起爆**（instant）: 全起爆 + 各爆発 ×2 | **罠師の勘**（sustain）: 炸裂半径 ×1.5・信管半分・置いた設置弾が敵を引く（pull 1.5m/秒、Rule） |
| 戦輪 | **輪舞**（instant）: 輪 4 本を全周に投げ、戻る | **断頭輪**（instant）: 巨大な輪 1 本（貫通 99・低速・hits 3） | **円環の理**（sustain）: 輪が跳弾 +2・必ず戻る・戻りで再度当たる |

## 4. 右クリック = アクション 2（B）

### 4.1 型（`src/data/weapons.ts`）

```ts
/** 右レーンの段。振り以外の段は押した瞬間に完結し、段カウンタだけ進む */
export type ActionStepDef =
  | { readonly kind: "swing"; readonly step: MeleeStepDef; readonly name?: string }
  | { readonly kind: "hold"; readonly key: string; readonly name: string; readonly cooldown: number; readonly hold: HoldArtDef }
  | { readonly kind: "volley"; readonly key: string; readonly name: string; readonly cooldown: number; readonly throw: ThrowArtDef }
  | { readonly kind: "charge"; readonly key: string; readonly name: string; readonly charge: MeleeChargeDef }
  | { readonly kind: "aim"; readonly key: string; readonly name: string; readonly cooldown: number; readonly aim: AimArtDef }
  | { readonly kind: "recall"; readonly key: string; readonly name: string; readonly cooldown: number; readonly recall: RecallArtDef };

export interface MovesetDef {
  // ... 既存
  readonly steps: readonly MeleeStepDef[];        // 左（アクション 1）。銃は []
  readonly steps2: readonly ActionStepDef[];      // 右（アクション 2）。近接は steps と同じ長さ、銃は 3
  readonly primary: PrimaryKind;
  // art: WeaponArtDef は削除
  readonly branches: readonly BranchDef[];       // 3 入力以上の名前付き派生。release は defineMoveset が混ぜる
}
```

- `BranchDef.step` は `MeleeStepDef` のまま（派生は振り）。`BranchArtRole` は `"release"` だけ残す（`"strike"` は右 1 段目に吸収）。`next?: number` に加えて **`nextLane?: ButtonKey`** を足す（省略は sequence の末尾のボタン）
- 補助関数の新旧: `chargeButton` → `steps2.some(kind === "charge") ? "secondary" : primary === "charge" ? "primary" : undefined` / `meleeChargeOf` → 左の charge か右の charge 段 / `usesProjectiles` → `isGun || steps2.some(kind === "volley")` / `releaseBranchIndex` 据え置き / `artHoldPose`（`render/renderMath.ts:471`）→ `holdPose(step: ActionStepDef, holding)` / `laneStep(moveset, lane, index)` 新設 / `laneLength(moveset, lane)`
- `WeaponArtDef` / `WeaponArtKind` / `ART_SEQUENCE` / `strikeArt` / `throwArt` / `artBranches` は消し、`reviveActionStep(raw)` が JSON の `steps2[]` を種類で絞る（`kind` は union 文字列なので `hitShape` と同じく TS で照合）。`ART_NAMES` は `STEP2_NAMES` に改名して右段の名前表にする
- `withExtraBranch`（ジョブ派生）は据え置き。ジョブ派生の入力列 左左左右 は共有カウンタと両立する（4 手目の右 = `steps2[3]` を派生が上書きする）

### 4.2 段カウンタと照合（`src/system/player.ts`）

- `AttackState.lane: ButtonKey`（`state.ts:31`、最小 Edit）を足す。`step` は共有
- `onButtonPress`（`player.ts:401`）の新しい順序: 変身 → `logButton` → **再使用中の右段は積まずに捨てる**（`laneStepBlocked`。今の `artInputBlocked` の一般化: 押した右が `steps2[step]` の非 swing 段で、その key の再使用が残っている）→ 構え中の左は構えを解く → `tryBranch`（長い列が先。3 入力以上）→ **`pressLane(state, button)`**
- `pressLane`: `isGun` かつ左 → 反転撃ちの予約（今のまま）。それ以外は `startLaneStep(state, lane = button, index = attack.step)`:
  - `swing`: `startSwing` を `lane` 付きで（`beginSwing` に `lane` を持たせ、`meleeStep(stats, step, dashStrike, chargeLevel, branch, moveset, lane)` が `lane === "secondary" ? steps2[step].step : steps[step]` を引く）。先行入力 `buffered` は「どのボタンか」も覚える（`bufferedLane`）。`nextStepAfter` は `laneLength(bufferedLane)` で見る
  - `hold` / `aim`: `weaponArts.beginHold` を段の定義で（`currentHold` は `playerMoveset.steps2[attack.step]` を見る）。段カウンタは **離した / 窓が閉じたときに +1**（受け流し成功でも +1 → 右右 = 受け流し → 返し）
  - `volley` / `recall`: 即時に出し、`attack.step += 1`・`inputTimer = chainWindow`。連撃の途中でも出せる（recover 中なら振りを打ち切る = 今の `freeForArt`）
  - `charge`: 押した瞬間に `beginCharge`、離した段は `steps2[step].charge.step`（居合は右レーンの 1 段目、抜き打ちは「溜めずに離す」= 段 0 で次の右段）
- `chainWindow 0.5` / `chainMaxInputs 5` は据え置きで足りる（最長の派生は 5 入力 = 百裂拳）。**照合の順序に 1 つ追加**: 同じ長さなら `branches` の並び順（今と同じ）。「右右右」のような同一ボタンの繰り返しは派生にしない（共有カウンタで自然に右レーンの 3 段目）
- `endSwing`（`player.ts:868`）の「最終段なら入力列を捨てる」は据え置き。連撃の終わり = `step + 1 >= laneLength(lane)`
- 見切り斬り（`tryJustCounter`）・ダッシュ攻撃・溜めのキャンセルは変えない。`FINISHER_COMBO` は `hookCombo(moveset, step)`（`player.ts:255`）のままで左右共通（右レーンの最終段も終撃 = 「得物の誉れ」「終撃のみ」「百刃」が右でも出る。意図どおり）

### 4.3 全 23 武器種の右レーンと派生（最低 4 本・3 入力以上）

記法: 右 n = `steps2[n-1]`。既存の固有技は右 1 に置く（挙動を変えない）。左の段は今のまま。派生は L = 左、R = 右。名前は `BRANCH_NAMES` の既存を活かし、2 入力だった派生は 3 入力に伸ばした。

| 武器種 | 右レーン（右 1 → …） | 派生 4 本以上（入力 → 名前: 中身） |
| --- | --- | --- |
| 剣 | 受け流し（hold）→ 返し斬り（thrust 3m）→ 斬り上げ（heavy・浮かせる knockback 300） | LLR 十字断ち（既存）/ **RLL 踏み込み斬り**（受け流し → 踏み込み → 斬り、→ 3 段目）/ LRL 巴（円 hits 2）/ RRL 逆袈裟（heavy） |
| 大剣 | 薙ぎ払い（既存 arc 240）→ 振り上げ（arc 180・浮かせ）→ 大回転（circle 6m）→ 叩き伏せ（heavy） | LLR 兜割り（既存）/ RRL 横一文字（arc 270 heavy）/ LRR 車輪（circle hits 2）/ RLL 突き崩し（thrust heavy） |
| 双剣 | 影踏み（既存）→ 交差突き（thrust hits 2）→ 舞い斬り（arc 200 hits 2）→ 逆手斬り（box）→ 影縫い（heavy・崩勢） | LLR 乱れ斬り / LLLR 交差斬り（既存）/ RRL 影分かれ（円 hits 3）/ LRL 十字架（box heavy）/ RLR 影裂き（thrust 貫通 lunge 30） |
| 槍 | 突進突き（既存）→ 石突き（box 手前・押し返し）→ 払い（arc 180）→ 大突き（thrust heavy） | LLR 石突き回し（既存）/ RLL 連ね突き（hits 3）/ LRL 蹴り上げ（heavy 浮かせ）/ RRL 穿ち（thrust 貫通 5m） |
| 大鎌 | 鎌引き（既存）→ 巻き込み（arc 200 pull）→ 逆手回し（circle）→ 断ち（heavy） | LLR 刈り取り（既存）/ RRL 死の舞（circle hits 3 pull）/ LRL 首刈り（box heavy）/ RLL 引き倒し（thrust pull 崩勢） |
| 拳 | 掴み投げ（既存）→ 肘打ち（box heavy 至近）→ 膝（浮かせ）→ 回し蹴り（arc 180）→ 正拳（heavy） | LLR 昇り拳 / LLLLR 百裂拳（既存）/ RRL 崩し打ち（崩勢）/ LRL 二段蹴り（hits 2）/ RLL 連環（hits 4） |
| 鞭 | 巻き付け（既存）→ 打ち払い（arc 180）→ 地打ち（circle 至近）→ 鞭鳴らし（thrust 長・恐怖） | LLR 巻き打ち（既存）/ RRL 蛇打ち（thrust hits 2）/ LRL 巻き上げ（pull 浮かせ）/ RLL 引き裂き（出血 2） |
| 鉈 | 肩当て（既存）→ 唐竹（box heavy）→ 横薙ぎ（arc 160）→ 断頭（heavy 威力大） | LLR 叩き落とし（既存）/ RRL 血飛沫（出血 2 heavy）/ LRL 押し斬り（lunge 20 heavy）/ RLL 骨断ち（崩勢） |
| 棍 | 払い上げ（既存）→ 石突き（thrust）→ 回し打ち（circle）→ 天突き（heavy） | LLR 旋風（既存）/ RRL 風車（circle hits 3）/ LRL 二段払い（hits 2）/ RLL 打ち据え（heavy 怯み値大） |
| 杖 | 魔弾（volley・既存）→ 魔弾（volley）→ 大魔弾（volley 威力 ×1.6）→ 杖突き（thrust） | **LLR 魔力撃**（旧 LR）/ RRL 杖払い（既存）/ LRL 光条（thrust 貫通 volley）/ RLL 魔力破（circle arcane） |
| 刀 | 居合（charge・既存）→ 返し（thrust）→ 逆風（arc 180）→ 一文字（heavy） | LLR 燕返し（既存）/ **RLL 抜き打ち**（旧 RL）/ LRL 霞（box hits 2 無敵 0.05）/ RRL 峰打ち（怯み値 ×2 威力 ×0.5） |
| 斧 | 投擲（volley・既存）→ 叩き割り（box heavy）→ 回し斬り（circle）→ 断ち割り（heavy） | LLR 断ち割り（既存）/ **RLL 回転斬り**（旧 RL）/ LRL 首斬り（heavy 出血 2）/ RRL 二丁投げ（volley ×2） |
| 大盾 | 構え（hold・既存。離すと盾押し release）→ 盾突き（thrust）→ 盾叩き（circle heavy） → 押し潰し（heavy） | LLR 盾落とし（既存）/ RRL 城壁（circle 怯み値大・自分に硬化）/ LRL 盾殴り（box heavy）/ RLL 突進盾（lunge 30 heavy） |
| 鎖鎌 | 分銅（既存）→ 鎌返し（arc 120）→ 鎖回し（circle hits 2）→ 締め上げ（heavy 崩勢） | LLR 巻き取り（既存）/ RRL 鎌鼬（thrust hits 2 出血）/ LRL 引き斬り（pull heavy）/ RLL 鎖縛り（崩勢 2 秒） |
| 戦鎚 | 大薙ぎ（既存）→ 振り下ろし（box heavy）→ 横殴り（arc 160）→ 大地叩き（circle heavy） | LLR 地砕き（既存）/ RRL 大車輪は既存スキル名なので **鎚車**（circle hits 2）/ LRL 打ち上げ（浮かせ）/ RLL 鉄槌（heavy 堅守無視 Rule） |
| 二丁拳銃 | 乱れ撃ち（volley・既存）→ 銃把打ち（box）→ 回転撃ち（volley 全周 8） | LLR 二連（volley ×2）/ RRL 早抜き撃ち（volley 6 連）/ LRL 蹴り撃ち（box → volley）/ RLL 側転撃ち（lunge 20 + volley） |
| 短銃 | 狙い撃ち（aim・既存）→ 銃把打ち（box）→ 反転撃ち（circle 3.6m） | LLR 三点（volley 3）/ RRL 至近撃ち（volley + selfKnock）/ LRL 蹴り離し（box knockback 400）/ RLL 早撃ち（volley 2） |
| 長銃 | 銃剣突き（既存）→ 銃床打ち（arc 160 heavy）→ 銃剣払い（arc 200） | LLR 銃剣連突き（hits 2）/ RRL 銃床殴打（heavy）/ LRL 貫き撃ち（volley 貫通 +2）/ RLL 突き撃ち（thrust → volley） |
| 砲 | 零距離砲（既存）→ 筒殴り（box heavy）→ 尻叩き（arc 180・後退） | LLR 装填撃ち（volley 威力 ×1.5）/ RRL 砲身振り（circle heavy）/ LRL 密着砲（volley + detonate）/ RLL 突き飛ばし（lunge 20 knockback 500） |
| 投擲 | 手元返し（recall・既存）→ 投げ抜け（thrust lunge 16）→ 蹴り（box） | LLR 三本投げ（volley 3）/ RRL 回し投げ（volley 全周 6）/ LRL 掴み投げ（throw: true）/ RLL 返し斬り（thrust 貫通） |
| 擲弾 | 筒払い（既存）→ 筒突き（thrust）→ 蹴り飛ばし（box knockback 400） | LLR 二連弾（volley 2）/ RRL 至近弾（volley minRange 0）/ LRL 蹴り撃ち（box → volley）/ RLL 突き払い（arc 150 heavy） |
| 仕掛け | 撒き散らし（volley・既存）→ 罠蹴り（box・自分の設置弾を前へ押す）→ 起爆（detonate） | LLR 連置き（volley 2）/ RRL 罠陣（volley 5 円形）/ LRL 蹴り起爆（box → detonate）/ RLL 罠投げ（volley 1 遠投） |
| 戦輪 | 輪払い（既存）→ 輪投げ（volley）→ 二輪（volley 2） | LLR 三輪（volley 3）/ RRL 輪舞い（circle hits 3）/ LRL 輪斬り（arc 220 heavy）/ RLL 返し輪（volley boomerang） |

- 右 1 の既存技はすべて挙動据え置き（数値は `weapons.json` の `art` ブロックを `steps2[0]` に移すだけ）。銃 8 種は右レーン 3 段、近接 15 種は左と同じ段数（`data/weapons.test.ts` に「近接は `steps2.length === steps.length`、銃は 3」を足す）
- JSON の形（`WEAPON.movesets.<key>`）: `"steps2": [{"kind":"hold","key":"parry","cooldown":0.6,"hold":{...}}, {"kind":"swing","step":{...}}, ...]`。`art` ブロックは削除。`branches` の 2 入力（`steppingCut` / `arcaneStrike` / `quickDraw` / `axeSpin`）は 3 入力に書き換える
- 変身（`skills/forms.ts` の `buildMoveset`）: 狼化の右 = 遠吠え・砲身化の右 = 砲撃は `shapeButtonPress` が先に取るので据え置き。型は `steps2` に噛みつき / 振りの swing 段を並べる

### 4.4 HUD（`src/render/comboUi.ts`）と bot（`src/qa/bot.ts`）

- HUD: 段のピップは共有カウンタのまま。案内行を **「左: <steps[step].name ?? 段名> / 右: <steps2[step].name>」+ 成立しそうな派生（`branchHints`）** にする。派生の案内があれば派生を優先（今の `hudHintText` の順）。右段が再使用中なら「（あと n 秒）」。名前の無い swing 段は「n 段目」
- 溜めの目盛りは `meleeChargeOf` の差し替えで右の charge 段も拾う（今の居合と同じ）
- bot: `pressArtInput` を **レーン混合**に置き換える。射程内なら `bot.rng` で `[L,L,L] / [L,L,R] / [R,L,L] / [L,R,L] / [R,R,R]` から 1 列選び、1 押しずつ出す（右は 1 フレーム押し。hold 段は今の `tryParryInput` の経路）。volley / recall の右段は射程 `ART_THROW_RANGE` で押す。**奥義**: `energy >= maxEnergy` で敵が 8m 以内なら `specialPressed = true`。sustain は放置して drain させる（report に「sustain の手動終了は踏まない」と注記）

### 4.5 整合（来歴・ジョブ・祝福・ルール）

- 来歴 `branchHits`（`loot/provenance.ts:220`）: 派生の命中でだけ増える。右 1 段目は派生ではなくなるので、**「型破り」は名前付き派生の命中だけ**を数える（意図した絞り込み。`docs/LOOT_DESIGN.md` の来歴表に 1 行注記）
- ジョブ派生 左左左右（`jobs.ts` / `weapons.json:231`）: 共有カウンタで `steps2[3]` を上書きする。4 段の武器種では右レーンの最終段が潰れるが、ジョブ派生の方が特別なので許容。銃（右 3 段）では 4 手目の右 = 右レーンを超えるので派生だけが出る（今と同じ）
- 祝福 終撃依存（得物の誉れ / 終撃のみ / 百刃 / 終撃の波）: `hookCombo` が左右共通なので右レーンの最終段でも出る。`finisherOnly` の「常に最終段」は `startSwing` で `stepIndex = laneLength - 1` に直す
- Rule 条件 `branchSwing`（`rules.ts:706`）: 派生の振りだけ真（右 1 段目は偽になる）。鎖鎌の `not branchSwing`（`weapons.ts:820`）は「分銅以外の段」の意図なので、`{ kind: "lane", lane: "primary" }` を新設して置き換える
- 統一ルール `{ kind: "shot" }` / 祝福の `loadout.movesets` / `usesProjectiles`: 上の補助関数の置き換えで無傷

## 5. 選択と永続化（C）

- `Profile`（`loot/types.ts:288`）に `ultimates?: Partial<Record<MovesetKey, string>>` を足す（version 1 のまま）。`loadProfile` の sanitize は `isMovesetKey(k) && isUltimateKey(v) && ultimateDef(v).moveset === k` のものだけ通し、それ以外は捨てる
- 拠点の武器掛け（`system/hub.ts:296` `RackEntry`、`ui/hubFlow.ts:90` `RackRow`）: 各武器種の行に **「奥義: <名前>」のサブ行 3 つ**を足し、選ぶと `profile.ultimates[moveset] = key` → `saveProfile`。`RackRow` を `{ kind: "moveset"; key } | { kind: "ultimate"; moveset; key }` に。描画は `render/hubUi.ts`（既存の rack 描画に 1 段ぶんの行を足す）
- 装備画面: 右手の詳細欄「要点」に「奥義: <名前>（拠点の武器掛けで変更）」の 1 行（`render/detailPane.ts`）、「計算式」頁の `SPECIAL_NAME`（`ui/scalingText.ts:234`）は選択中の奥義の名前と acts の scaling を出す
- リプレイ（`core/replay.ts:52` `ReplayLoadout`）: `ultimates` を写す。`captureLoadout` / `sanitizeLoadout` / `applyLoadout` に 1 か所ずつ。`REPLAY_VERSION = 9`（右クリックの意味が変わる更新なので必須。旧記録は拒否 = 今の仕組み）
- 表示文字列の置換（Lane C 所有。文言だけ）: `renderer.ts:2300`「F: バースト」→「F: 奥義」、`titleUi.ts:83,317`、`game.ts:128` の操作ログ、`boonDefs.ts` / `boonDefsWave2.ts` / `jobs.ts` / `resonance.ts` / `triggers.ts` / `stats.ts` の「必殺ゲージ」→「奥義ゲージ」「バースト」→「奥義」、`quests.ts:273` 全力解放の desc、`keywords.ts:78` の語 energy のラベル

## 6. 実装レーン（C）

共有ファイル（`core/state.ts` / `core/game.ts` / `data/tuning.ts` / `render/renderer.ts` / `main.ts`）は最小 Edit。**Lane 0 を先に 1 コミット**し、その後 A / B / C を並列。D は A・B の後。

### Lane 0: 型と骨組み（Opus implementer、順次。半日）

- 所有: `src/data/weapons.ts`（型だけ: `ActionStepDef` / `MovesetDef.steps2` / `BranchDef.nextLane` / 補助関数の新シグネチャ。`MOVESETS` の中身は各武器種を **`steps2: [旧 art を 1 段目に置いた 1 段]`** に機械変換して型を通す）、`src/data/ultimates.ts`（型 + `ULTIMATES` は各武器種 1 本目 = 「円月」相当の nova だけの仮定義）、`src/system/ultimates.ts`（公開関数のシグネチャと no-op）、`src/data/balance/ultimates.json`（`_note` + `common`）、`src/data/balance/index.ts`（1 行）、`src/data/tuning.ts`（`export const ULTIMATE`）
- 最小 Edit: `src/core/state.ts`（`AttackState.lane` / `bufferedLane`、`Player.ultimate`、`Player.art.cooldowns: Map<string, number>`）、`src/core/rules.ts`（`ultimateActive` / `lane` 条件）、`src/core/replay.ts`（`REPLAY_VERSION = 9`、`ReplayLoadout.ultimates`）、`src/loot/types.ts`（`Profile.ultimates?`）、`src/system/player.ts`（`trySpecial` → `tryUltimate` の呼び替え、`updateUltimate` の呼び出し、`playerMoveset` に `ultimateMoveset` を挟む。中身は Lane A / B）
- 完了条件: `npm run check` 緑（挙動は今と同じ。`weapons.test.ts` の `art` 参照は `steps2[0]` に読み替えるだけ）

### Lane A: 右レーンと混合コンボ（Opus implementer。設計は本書 4 章）

- 所有: `src/data/weapons.ts`（`MOVESETS` 23 種の `steps2` / `branches`、`reviveActionStep`、`STEP2_NAMES`、`BRANCH_NAMES` 追加分）、`src/data/balance/weapons.json`（`steps2` 23 本・派生 92 本以上）、`src/system/player.ts`（4.2 章）、`src/system/weaponArts.ts`（段の定義を受ける形に。`currentHold` / `currentAim` は `steps2[attack.step]` を読む）、`src/skills/forms.ts`（`buildMoveset` の `steps2`）、`src/render/renderMath.ts`（`holdPose`）、`src/render/comboUi.ts` + test、`src/data/weapons.test.ts`、`src/system/weaponArts.test.ts`、`src/system/player.test.ts`
- 編集禁止: `system/ultimates.ts`、`data/ultimates.ts`、hub / ui / renderer
- テスト（it 名）: 「右を押すと右レーンの段が出て、段カウンタは左右で共有される（左右左 = 1・2・3 段目）」「同じ段で左と右は別の振りになる（剣の 3 段目: 左は斬り、右は斬り上げ）」「名前付き派生は 3 入力以上で、長い列が先に一致する（右左左 → 踏み込み斬り）」「近接の武器種は steps2 が steps と同じ長さ、銃は 3 段」「受け流しは右 1 段目で、離す・窓が閉じると段が進む（右右 = 受け流し → 返し斬り）」「弾を出す右段は押した瞬間に出て段だけ進む（杖の右右右 = 魔弾・魔弾・大魔弾）」「再使用中の右段は入力列に積まない」「構えを離した盾押しは今までどおり派生として出る」「右レーンの最終段は終撃として扱われる（得物の誉れが乗る）」「ジョブ派生 左左左右 は右レーンの 4 段目を上書きする」「銃の家系は左で撃ち右で 3 段の連撃を出す」「変身中の右は変身が引き受ける」
- 完了条件: `npm run check` 緑。`docs/COMBAT_DESIGN.md` A-7「ボタンの役割」「コンボ派生」と表を 4 章に差し替え、`docs/recipes/weapon.md` に「右レーンの段の足し方」

### Lane B: 奥義の中身（Opus implementer。設計は本書 3 章）

- 所有: `src/data/ultimates.ts`（69 本）、`src/data/balance/ultimates.json`、`src/system/ultimates.ts`、`src/system/ultimates.test.ts`、`src/data/ultimates.test.ts`
- 最小 Edit: `src/system/combat.ts`（撃破で `noteUltimateKill`、`damagePlayer` に `ultimateIncomingMul`、1 行ずつ）、`src/system/rules.ts`（`collectRules` に sustain の rules、`ultimateActive` の判定）、`src/system/player.ts`（`actionStats` / `updateMovement` / `applyStepStatus` に倍率と付与を 1 行ずつ。Lane A と同じファイルなので **Lane A の完了後に着手する行だけ**を残し、それ以外は先に進める）、`src/system/weaponArts.ts`（`detonateOwnMines` / `emitArtVolley` を export）
- テスト（it 名）: 「奥義ゲージが満タンでなければ出ず、未充填の文字が出る」「一撃の奥義はゲージを 0 にし、行為の列を順に出す（円月は周囲に当てて敵弾を消す）」「一撃の奥義の威力と範囲に burstDamageMul / burstRadiusMul が掛かる」「一撃の奥義は発動時に onBurst（量 = 倒した数）を積む」「持続の奥義はゲージが毎秒減り、0 で終わる」「持続中にもう一度押すと終わり、残りのゲージは保つ」「持続中は段が差し替わり、終わると装備の型に戻って振りが止まる（剣気解放）」「持続中の倍率は通常攻撃に burstDamageMul を二重に掛けない」「持続の奥義は終了時に onBurst（量 = 持続中の撃破数）を積む」「持続中に変身を撃つと奥義が終わり、奥義を撃つと変身が解ける」「すべての武器種が 3 本の奥義を持ち、名前が派生・技・祝福・スキルと重ならない」「swing / lunge の行為は列の最後にだけ置かれている」「持続の rules は active のときだけ collectRules に入る」
- 完了条件: `npm run check` 緑。`docs/STATS_AND_SCALING.md` 2 章の例外表の例に「奥義（一閃・天墜）」を足す

### Lane C: 選択・永続化・HUD・表示名（Sonnet implementer。設計は本書 2・5 章）

- 所有: `src/loot/profile.ts`（sanitize と `ultimates`）、`src/system/hub.ts` / `src/ui/hubFlow.ts` / `src/render/hubUi.ts`（武器掛けの奥義行）、`src/render/detailPane.ts`、`src/ui/scalingText.ts`、`src/render/titleUi.ts`、`src/core/game.ts:128`（文言）、`src/render/renderer.ts:2300`（文言 1 行）、`src/audio/cues.ts`（変更不要なら触らない）、表示文字列の置換（5 章の一覧）、`docs/GLOSSARY.md`（2 章の行と「バースト」を残す語からの削除、系譜 4 段目 → 真髄）、`docs/ideas/boons-expansion.md` / `IDEAS.md`（奥義 → 真髄）、`scripts/audit-agent-docs.mjs`（旧用語 3 語）、`src/loot/affixes.ts:2561`（ラベル 1 行）、関連テスト（`profile.test` / `hub.test` / `hubFlow.test` / `scalingText.test` / `boonsWave2.test:87` の it 名）
- 編集禁止: `player.ts` / `weaponArts.ts` / `ultimates.ts` の中身
- テスト（it 名）: 「武器掛けで奥義を選ぶと profile.ultimates に保存され、読み直しても残る」「不正な奥義の key や武器種違いの組は捨てて既定へ落ちる」「奥義を選んでいない武器種は 1 本目が既定」「リプレイのスナップショットに奥義の選択が入り、再生側で同じ奥義が出る」「表示文字列に バースト / 必殺ゲージ / 固有技 が残っていない（audit:docs の旧用語）」
- 完了条件: `npm run check` 緑（`audit:docs` の旧用語検査を含む）

### Lane D: QA bot と資料（Sonnet qa-runner。A・B の後）

- 所有: `src/qa/bot.ts`（4.4 章）、`src/qa/bot.test.ts`、`docs/CODE_MAP.md`（`data/ultimates.ts` / `system/ultimates.ts` / `balance/ultimates.json` の行、`weaponArts.ts` の説明を「右レーンの構え・弾・溜め・手元返しの段」に）、`docs/ARCHITECTURE.md`（REPLAY_VERSION 9・Profile の `ultimates`）、`CHANGELOG.md` は統合役
- テスト（it 名）: 「bot は近接なら左右を混ぜた列で連撃を出し、名前付き派生を踏む」「bot は奥義ゲージが満タンなら敵の近くで F を押す」「bot は受け流しの右段だけ敵の予備動作に合わせて押す」
- 完了条件: `npm run check` 緑 → 統合役が `npm run qa:full` を回し、report に「sustain の手動終了・aim / recall の右段は踏まない」を注記

### 順序と決定性

1. Lane 0 → コミット → A / B / C 並列 → A・B が終わったら B の `player.ts` の 3 行 → D → 統合役が `CHANGELOG.md` と `npm run qa:full`
2. 決定性: 奥義・右レーンは `state.rng` を使わない（bot の列選びは `bot.rng`）。`Date.now()` は使わない。`core/replay.test.ts` は version 9 で記録を作り直す（seed と入力列で再現するテストなので、テスト内で `createGame` から記録すれば自動で追随する。フィクスチャ JSON を持っているかは Lane 0 が最初に確認）
3. 既存テストへの影響: `data/weapons.test.ts` の `art` を参照する 6 件（`weapons.test.ts:88,248,352,362,375,384`）は Lane A が書き換える。`MIN_BRANCHES 2` は「名前付き派生 ≥ 4・3 入力以上」に。`system/weaponArts.test.ts` は段の定義経由に。`qa/simulation.test.ts` は変更不要（bot の挙動が変わるので撃破数などの目安は report で見直す）
4. balance-tuner は統合後に `weapons.json` の右レーンの威力（左と同じ段番号なら **同じ秒間威力の目安**、右は「重い・広い」寄りで recover を 1.2 倍）と `ultimates.json` を詰める。`data/weapons.test.ts:178`「単一最強を作らない」は右レーンも含めた最大値で見る（テストの集計を Lane A が拡張）

## 7. 気になる点・ユーザーに確認したほうがよい点

- **段カウンタの共有**で、右 1 段目の固有技（受け流し・投擲・魔弾）は「連撃の 1 手目」でしか出ない（3 段目に右を押すと右 3 段目の振りになる）。受け流しを連撃の途中で出したい場面が減る。代替は「hold 段はどの段番号でも右で出る」という例外（`ActionStepDef.anyStep: true`）。ブラウザで剣を触ってから決める
- 剣の 右左 = 踏み込み斬り（2 入力）を 右左左 に伸ばしたので、受け流し直後の 1 手目は素の 2 段目になる。手触りが鈍ければ 2 入力の派生を「例外として許す」だけで戻せる（`matchBranch` は長さを問わない）
- 「真髄」「免許皆伝」の言い換え、および奥義の名前 69 本（3.3 章）は localizer に `GLOSSARY.md` 全体と突き合わせてもらう。特に「震脚」「一閃」「竜巻」は敵・スキルの技名と近い可能性がある
- sustain 中の HUD（ゲージが減る表示・段の差し替えの案内）は本書では `renderer.ts` のゲージ色を変えるだけにした。専用の帯を出すなら Lane C に 1 項足す
- 奥義の解放をすべて最初から（3 本とも選べる）にした。依頼・実績で 2・3 本目を解放したいなら `meta/quests.ts` に「<武器種>で 30 体倒す」型の依頼を足す（既存の `favoredKills` の流儀）。趣味開発の「遊べる量」を優先して今回は入れない
- `REPLAY_VERSION` を上げるので `ui/replayStore` の旧リプレイは全部読めなくなる（今の仕組みどおり黙って捨てる）
