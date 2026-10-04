# 武器と流儀の実装設計（段取り 5）

作成日: 2026-09-30
前提: `docs/ideas/core-synthesis.md` 9 章の段取り 5。architect の設計をそのまま置く。7 章の「ユーザー確認」の項目は、ユーザーの「進められる限り自走して」の指示を受けて統合役が推奨で決めた（下の表）。後でユーザーが変えたら、ここと該当の段を直す。

> **2026-10-03 の改修（銃と投擲物の見直し。`docs/ideas/gun-bases-review.md`）で、この文書の次の記述は古くなった**（歴史として残す）。
> - 短銃の弾倉・装填（「撃つと増えて満ちたら装填」の戦意 `MoraleRelease.reload` / `shotFired` / `Player.morale.window`）は消え、弾倉は戦意とは別の `Player.magazine`（`system/magazine.ts`）へ移った。全銃が弾倉を持ち、短銃の戦意は「早込め」、放出は次の弾倉が強装填
> - 型 13 + 書・鈴は 20 になった。`thrower`（投具）は戦輪の型に、`artillery` は仕掛けだけ（砲は新しい型 `powder`〔装薬〕、擲弾は `shell`）、`pistol` は短銃だけで二丁拳銃は `akimbo`、クナイ = `dart`（苦無）、手裏剣 = `star`
> - `thrown`（投擲）と `warRing`（旧戦輪）の武器種・手元返しの仕組みは消え、チャクラムは戦輪（ringBlades）に統合した。短銃の狙い撃ちもやめた

## 決めたこと（統合役、2026-09-30。ユーザーに報告して変えられるようにする）

| 項目 | 決定 | 変えるときのつまみ |
| --- | --- | --- |
| 1. 武器種 27 と型 | 27 の武器種は key・ベース・絵・奥義ごと残し、上に型（13 + 書・鈴）を足す。手持ちの遺物は移行なし | — |
| 2. 流儀 | 得意武器の倍率と弱点を削り、ダッシュの形と気力の源に置き換える（5c）。気力の下地 35% は残す | `JOB.manaBaseMul` |
| 3. 短銃の装填 | 入れる（弾倉が空で 0.6 秒の装填、窓で右を押すと強装填）。**→ 2026-10-03 に全銃の弾倉・リロードと短銃の早込めへ作り直した** | （旧）`FORM.pistol.reload.windowSec` を 0 で無効 |
| 4. 陰陽師・巫女 | 既定で解放（5d） | `unlockedBy` |
| 5. 新語 | 2-1 の名前の原則で付け、付ける前に `src/` と GLOSSARY を検索して衝突を避ける | GLOSSARY |
| 6. 重さの既定から外れる武器種 | 個性として今の値を残す（連接棍・擲弾・仕掛け 中、扇子 軽） | 各 `movesets/*.json` の `weight` |
| 7〜13 | 7 章の推奨どおり（連刃 6・6・8 段、先制は交戦の外で 1.5 秒、放出は振りの開始で消費、改鋳は 5 の倍数の階のボスの後、応手の新イベントと既存の onCounter / onJustDodge は両方出す） | — |

---

## 0. 結論

- **27 の武器種（`MovesetKey`）は key・ベース・絵・効果音・奥義ごと残し、その上に「型」（`WeaponForm`、13 + 書・鈴 = 15）の層を 1 枚足す**。型は「重さの既定・戦意・共通の瞬間の出し方・連撃の段数の幅・改鋳」を持ち、武器種は型の「個性」（リーチ・速さ・右の段の 1 つ）。セーブは **無変更で互換**（遺物は `baseKey` → `BASES.moveset` の写像だけを持ち、`MovesetKey` を消さないので移行なし。`Profile.meta.ultimates` も据え置き）
- 新しい仕組みは 5 つ: (a) 型の定義 `data/weaponForms.ts` + 数値 `balance/weapons/FORM/`、(b) 戦意 `Player.morale` + `system/morale.ts`（溜まる出来事 → 放出の段の倍率）、(c) 共通の瞬間 = 6 つの `EventKind`（`onFirstStrike` / `onFinisher` / `onBrim` / `onRelease` / `onRiposte` / `onTwinStrike`）を `system/moments.ts` が 1 か所から積む、(d) 改鋳 `state.reforgeChoice` + `system/reforge.ts`（祝福 3 択と同じ入力経路で決定的）、(e) 流儀 = `JobDef.dash`（ダッシュの形 12）+ `JobDef.mana`（気力の源）→ `system/dashForms.ts` / `system/manaSources.ts`。得意武器の倍と弱点は削る
- 連撃は既に N 段を許す（`steps` 任意長、終撃は `hookCombo` が長さから決める）。縛りはテスト（`weapons.test.ts:37-38` の `MIN_STEPS 4 / MAX_STEPS 5`）と絵・計算式の頁だけ。連刃の型（双剣 6・拳 6・爪 8 段）へ広げ、幅は型ごとに `FORM.<型>.steps: {min,max}`
- 重さの補償は既にある口 `weightClass.<w>.damageMul / poiseMul`（今 1）に **副次の効果**（終撃のノックバック倍率・堅守崩し）を足し、**武器種ごとの probe**（`combatProbe.ts` に `gear: { moveset }` の軸を足す。bot は既存の `mashDodge`）で「撃破秒 × 被弾/60 秒」を型どうしで揃える
- `REPLAY_VERSION` は **段ごとに 1 回**: 19（5a+5b: 戦意・瞬間・段数・補償）/ 20（5c: 改鋳・流儀）/ 21（5d: 書・鈴・陰陽師・巫女）
- 段は 4 つ（各段で遊べる）。ドット絵（書・鈴の持ち手）と fx（連刃の 6〜8 段・書・鈴のシート）は別レーン

---

## 1. 今のコードの地図（根拠。行番号つき）

### 1-1. 武器種の定義と moveset
| 事実 | 根拠 |
| --- | --- |
| `MOVESET_KEYS` 27（近接 19 + 銃の家系 8 `GUN_MOVESETS`）。`MovesetDef` は `steps`（任意長）/ `dashAttack` / `charge?` / `tip?` / `attackMoveMul` / `weight`（必須）/ `primary: melee \| charge \| shot` / `steps2: ActionLane` / `branches` / `keywords` / `attack` / `rules?` / `modifiers?` | `/home/user/roguelike/src/data/weapons.ts:16-49, 335-370` |
| 段 `MeleeStepDef`: windup/active/recover/scaling/poise/poiseRatio/reach/size/knockback/heavy/mana/shape/pull/throw/hits/hitstop/shake/lunge/trail/applies/cancel/invuln/cast/cutsBullets | `weapons.ts:82-125` |
| 右レーンの段の種類 `ACTION_STEP_KINDS = swing/hold/volley/charge/aim/recall`。`HoldArtDef` に `parry`（窓・硬直・怯み値）と `guard`（角度・被ダメ倍率・奥義ゲージ）と `release`（離した振り）。`BranchDef.sequence` は 3 入力以上、`next` で続く段 | `weapons.ts:174-219, 293-307` |
| 溜め `MeleeChargeDef { moveMul, step, levels[], spinning? }`。levels は `time/damageMul/poiseMul/reachMul` | `weapons.ts:309-333` |
| `MOVESETS` は JSON（`balance/weapons/WEAPON/movesets/<key>.json`）を `reviveSteps / reviveLane / reviveBranches / reviveWeight` で復元。剣だけ左 3 段を `PLAYER_MELEE.json` から `swordSteps()` | `weapons.ts:521-523, 1074-1543` |
| 段数の実測: 左 3（剣）/ 4（大半）/ 5（双剣・爪・拳）/ 0（銃 8 種）。右は左と同じ段数（銃は 3）。派生 4〜6 本。右の kind: 剣 `hold(parry)`、刀・チェーンアレイ `charge`、盾・扇子 `hold(guard)`、短銃 `aim`、投擲 `recall`、杖 `volley×4`、それ以外 `swing` | 27 JSON を集計（`node` で `steps.length` 等を数えた） |
| 名前表 `STEP2_NAMES`（右の段）/ `CAST_NAMES`（詠唱）/ `BRANCH_NAMES`（派生）は TS の表 | `weapons.ts:844, 990, 646` |
| `Record<MovesetKey, …>` を持つ場所（武器種を足すと型エラーで漏れが分かる）: `MOVESETS` / `ULTIMATES` `SET_BUILDERS`（`data/ultimates.ts:904, 934`）/ `HELD`（`data/sprites/weapons.ts:925`）/ `WEAPON_TRAIL_WIDTH`（`render/renderMath.ts:459`）/ `SWING_SFX` `HIT_FAMILY`（`system/effects.ts:321, 361`）/ `weaponHitNames.ts:11` `weaponHits.ts:62` / `weapons.test.ts` `EXPECTED_ART:414`。Partial: `MOVESET_FX`（`render/fxMotions.ts:311`）/ `WEAPON_ART_LOOK`（`thrownLook.ts:121`）/ `WEAPON_EDGE` | grep 結果 |
| `MOVESET_KEYS` を回して自動追従する所: 倉庫の絞り込み `ui/stashFacets.ts:49, 131-136`、武器掛け `system/hub.ts:306-332` / `ui/rackScreen.ts`、ステータスタブの奥義選び `ui/statusTab.ts:97-116`、Tips `meta/weaponTips.ts`、技の重み `skills/generator.ts:58` → `skills/arts/index.ts:77-81` | 同上 |

### 1-2. 段の進み・派生・終撃・気力
| 事実 | 根拠 |
| --- | --- |
| `FINISHER_COMBO = PLAYER.melee.length - 1`（= 2）。`hookCombo(moveset, step, lane)` がレーンの最終段を `FINISHER_COMBO` に丸める（段数が違っても終撃の祝福は最終段）。`AttackState.step` は添字、`combo` は 0/1/2 の丸め | `/home/user/roguelike/src/system/player.ts:108, 298-303`、`core/state.ts:32-69` |
| 押下: `readActions`（ダッシュ → 受け流し → 左右 → 奥義）→ `onButtonPress` → 変身の差し替え → 派生 `tryBranch` → `pressLane`。右は `pressSecondary` → `startLaneStep`（swing は連撃の経路、charge は溜め、他は `weaponArts.startLaneArt`） | `player.ts:436-560` |
| 振りの開始 `startSwing` → `beginSwing`（`logButton` で入力列、`onLaneSwingStart`、`onBoonSwing`、`pushSwingEvent`）。終わり `endSwing` → 先行入力の次段 / 予約した派生 / `resetSwing`。`nextStepAfter` はレーンの長さで打ち切る | `player.ts:928-1138` |
| 段の倍率 `scaleStep`: 重さ `WEAPON.weightClass[moveset.weight]` の `recoverMul / damageMul / poiseMul` を掛ける唯一の場所。**放出の倍率を差す場所はここ** | `player.ts:334-365` |
| 命中 `meleeHitEnemy`: カウンター判定 → `rollOutgoing` → `damageEnemy(opts: poise/hitstop/energy/kind/crit/guardBreak/finisher/impact)` → `onCounter` イベント → `gainMeleeMana` → `fireTrigger` → `onBoonMeleeHit` → `pushSwingHitEvent` → `applyStepStatus`。**戦意の溜まりと双撃・終撃の瞬間を積む場所** | `player.ts:1281-1320` |
| 気力: 近接は `MANA.onMelee[step]`（3/3/5、`meleeTargetCap 2`、カウンター ×2）→ `gainAttackMana`。射撃 `onShot 1`、見切り `onJust 12`、撃破 `onKill 4`。`gainMana` の呼び出し元は 16 ファイル（poise / statusReactions / ultimates / boons / triggers / combat / player / traitHooks / enemyTraits / parry / mana / rules / projectiles / boonRules / arts/engine / summons） | `player.ts:1346-1351`、`/home/user/roguelike/src/system/mana.ts:16-34`、`balance/combat/MANA.json` |
| 溜め: `updateCharge` / `onChargeLevelUp`（段が上がった瞬間。重打の戦意の口）/ `meleeChargeLevel` | `player.ts:859-915` |
| ダッシュ: `canDashCancel`（重さの相）→ `tryDash`（`tryDashGuard` = 祝福「鉄壁の構え」の不退が既にダッシュを差し替える前例、`hasKeystone(KS.blink)` → `blink` の瞬間移動も前例） | `player.ts:694-751`、`system/keystones.ts:16, 64` |

### 1-3. 右レーンの構え・受け流し・狙い（応手の口）
| 事実 | 根拠 |
| --- | --- |
| `startLaneArt`: hold は `beginHold`（受け流しは押した瞬間に再使用）、aim は `beginHold`、volley は `emitArtVolley`、recall は `recallShots` | `/home/user/roguelike/src/system/weaponArts.ts:133-160` |
| `updateGuard`: 離す / maxSec で `releaseBranchIndex` の派生（盾押し）を出す。`guardDamageMul`（`combat.ts` が被ダメに掛ける。前方 `arcDeg` の被弾を `damageMul` にし `energyGain` を溜める）— **盾の「受け溜め」はここで受けた量を数える** | `weaponArts.ts:227-237, 289-298` |
| `updateAim`: `aim.time` 届いたら `onAimReady`、離すと `emitVolley(... { damageMul, pierceBonus })` | `weaponArts.ts:239-260` |
| 共通の受け流し `parry.ts`: `startParry` → `tickParry` → `tryWindowParry` → `parrySucceed`（無敵・浮き文字・`addMark("parry")`・気力・`onCounter` イベント・`stopAttacker`）。剣の構えの受け流し `weaponArts.tryParry:276-283` も `parrySucceed` に通る。**応手の成功を 1 か所で拾える** | `/home/user/roguelike/src/system/parry.ts:79-159` |
| 見切り `combat.ts justDodge`（`justDodgeWindow`、`onJustDodge` イベント）。弾消し `player.ts cutProjectile:1390` / 弾返し `reflectProjectile:1371` | `system/combat.ts:579-597` |
| 敵弾の消去は既定なし（`cutsBullets` は扇子だけ）。コミット中の敵を止められるのは受け流しだけ | `weapons.ts:124`、`parry.ts` 冒頭のコメント |

### 1-4. 奥義・技・固有効果
| 事実 | 根拠 |
| --- | --- |
| 奥義は武器種ごとに 3 本（`<key>Set()` 27 個 → `SET_BUILDERS` → `ULTIMATES`）。持続の差し替えは `system/ultimates.ts ultimateMoveset(state, base)`（**型の差し替えの合成順の前例**: `playerMoveset` = 変身 ?? `ultimateMoveset(withJobBranch(currentMoveset))`） | `data/ultimates.ts:562-934`、`system/ultimates.ts:687`、`player.ts:269-288` |
| 技: `WEAPON_ART_KEYS` は武器種ごとに 11 本（`arts.test.ts` が「10 種以上・接頭辞」を検査）。装備中の武器種の技は重み `W.matched` | `skills/arts/keys.ts`、`skills/arts/index.ts:74-97` |
| 武器種の固有効果は `MovesetDef.rules`（`movesetRule(key, i, …)`、数値 `WEAPON.movesetRules`）。今の 27 JSON は `rules` を持たず TS 側で組む | `weapons.ts:1056-1072` |
| Rule の条件に `{ kind: "moveset", movesets }`（利用 9 か所: rules.ts / main.ts×2 / boonDefsWave2 / hub / jobs / hubFlow×3）、`{ kind: "finisher" }`（`system/rules.ts:720-721` = `combo >= PLAYER.melee.length - 1`）、`favoredWeapon`、`lane`、`swingStep`、`chargedSwing`、`charging`、`branchSwing` | `core/rules.ts:22-97` |
| イベント 27 種（`onMeleeHit` … `onSwingHit`）。`SWING_TAG.finisher` は `onSwing` / `onSwingHit` の tag。`EventSource.kind` に `boon` がある（巫女の「加護が発動」を数える鍵） | `core/events.ts:14-49, 55-58, 257-271` |
| `Modifier`（常時の増・倍）と `PerCounter`（combo / targetStatusKinds / … / runKills）。**「戦意につき」は `PerCounter` に 1 語足すだけ** | `core/rules.ts:340-395` |
| `DAMAGE_TAGS` に `resource` は無い（`melee … poise` の 24 語） | `core/damage.ts:13-37` |

### 1-5. ジョブ（流儀の元）
| 事実 | 根拠 |
| --- | --- |
| `JOB_KEYS` 10。`JobDef = { name, desc, attributes, favored: MovesetKey[], rules: JobRuleDef[2], starterSkill, starterWeapon, weakness, keywords, unlockedBy? }`。ダッシュ・気力の湧き方の欄は無い | `/home/user/roguelike/src/data/jobs.ts:23-67, 105-320` |
| 得意武器 = `favoredModifiers`（`more` ×`JOB.favoredMeleeMul`、条件 `favoredWeapon` + 銃かどうか）+ `applyJobStats` の攻撃速度 ×`favoredAttackSpeedMul`。弱点 = `applyJobMul`（与ダメは `more`、他は stats 直掛け） | `system/jobs.ts:43-105`、`data/jobs.ts:388-400` |
| ジョブ固有の派生（左左左右）は `withJobBranch` で全武器種に 1 本足す | `player.ts:278-288`、`data/jobs.ts:355-370` |
| テスト `jobs.test.ts` は「得意な武器種・弱点を持つ」(73, 126, 163, 151) と「既定で 4 つ解放、残りは依頼」(106) を固定 | `src/system/jobs.test.ts` |

### 1-6. QA の計測
| 事実 | 根拠 |
| --- | --- |
| `combatProbe.ts`: `makeArena(seed, depth, gear: "none" \| "fitted")` は `DEFAULT_STATS`（= 剣・拳銃）か深度に合わせた装備。**武器種を選ぶ軸は無い**（`probe.md` 冒頭「装備なし（既定の剣）」）。bot は `mash / mashDodge / mashKite`、`runDuel` は 60 秒で撃破数・被弾を数える | `/home/user/roguelike/src/qa/combatProbe.ts:27, 79-93, 272-300, 341-368` |
| bot は武器種ごとの右レーン（`nextRightStep`、居合・溜め・構えの押し方）を既に扱う | `src/qa/bot.ts:745-828` |
| フル QA に武器種ごとの指標は無い（HANDOFF「QA のロガーに武器種ごとの指標が無い」） | `docs/HANDOFF.md`、`qa/simulation.test.ts:1365` |

### 1-7. 絵・HUD・計算式の頁（段数を増やすときの壁）
| 事実 | 根拠 |
| --- | --- |
| モーションの key は `l:<段>` / `r:<右の key>` / `branch:<key>` / `charge` / `dash`。`MOVESET_FX` に無い段は手続きの描画に落ちる。`swingMotionKeys` が網羅の検査に使われる | `render/fxMotions.ts:342-363` |
| コンボ HUD のピップは段数ぶん並ぶ（`comboPips(stepsCount…)`、左右の長い方） | `render/comboUi.ts:49-50, 149` |
| 計算式の頁: 1 式 3 行以内、全ベースで欄の高さに収まること（HANDOFF: 拳・双剣は 24 行で余裕 1 行）。派生は `actionListRows` で 1 段落に畳む | `render/detailPane.test.ts:34, 87, 119`、`ui/scalingText.ts:240` |

### 1-8. 祝福 3 択の入力経路（改鋳が真似る）
`state.boonChoice` を `updateBoonChoice(state, input, dt)` が step の中で読み（skill1〜3 / クリック）、`chooseBoon` へ。リプレイは入力列だけで再現できる（`system/boons.ts:548-566`）。

---

## 2. 27 → 13（+2）の写し方（推奨 1 案）

### 推奨: 「武器種は個性として全部残し、型を上に足す」
- `MovesetKey` 27 は消さない。`MovesetDef.form: FormKey` を必須で足す（TS の `defineMoveset` の spec に 1 行ずつ。union 文字列なので JSON でなく TS）
- 束ねた武器種の **ベース・絵・効果音・奥義 3 本・右の段の 1 つ・リーチ・速さ** は残る（= 個性）。型が決めるのは **重さの既定・戦意・放出の段・共通の瞬間の出し方・段数の幅・改鋳**。同じ型の武器種は同じ戦意を持つ
- 却下: MovesetKey を 13 に潰す（`Record<MovesetKey>` 12 か所の作り直し・`Profile.meta.ultimates` と技 `WEAPON_ART_KEYS` の移行・遺物の見た目の消失。得るものは束ねる工数の削減だけ）。却下: 型を JSON に置く（union 文字列は TS の方針）

| 型 `FormKey` | 表示 | 束ねる武器種（個性） | 重さの既定（今の weight） |
| --- | --- | --- | --- |
| `blade` | 剣 | sword（構えの受け流し）・katana（居合） | 中（中・中） |
| `flurry` | 連刃 | twinBlades（影踏み）・claws（出血・踏み込み）・fists（投げ） | 軽（軽・軽・軽） |
| `crusher` | 重打 | greatsword（3 段溜め）・hammer（衝撃波）・flail（回し）| 重（重・重・**中**） |
| `hewer` | 刃斧 | axe（投擲）・cleaver（連続の刻み） | 重（重・重） |
| `polearm` | 長柄 | spear（先端）・staff（気力回収） | 中（中・中） |
| `chain` | 鎖 | whip（先端・恐怖）・chainSickle（引き寄せ）・scythe（大振り） | 中（中・中・中） |
| `bulwark` | 盾 | shield | 重 |
| `warfan` | 扇 | fan | 軽（暫定。3-2 の表では中） |
| `rod` | 杖 | wand | 中 |
| `thrower` | 投具（→ 戦輪） | ringBlades（周回。→ 今は戦輪）・thrown（手元返し。消えた）・warRing（払い。消えた） | 軽（軽・軽・軽） |
| `pistol` | 短銃 | sidearm（狙い撃ち。やめた）・gunner（二丁。今は型 `akimbo`） | 軽（軽・軽） |
| `rifle` | 長銃 | longarm（小銃・弩・電磁砲・吹き矢のベース） | 重 |
| `artillery` | 砲（→ 今は仕掛けだけ） | cannon（零距離。今は型 `powder`）・grenade（曲射。今は型 `shell`）・trapper（設置） | 重（重・**中**・**中**） |
| `tome` | 書 | tome（新規） | 軽 |
| `bell` | 鈴 | bell（新規） | 中 |

- FormKey は `MovesetKey` と文字列を重ねない（grep とログの混乱を避ける）
- **重さは「型の既定 + 個性の上書き」**: `FORM.<型>.weight` を既定にし、`movesets/<key>.json` の `weight` が違えば個性として優先。flail / grenade / trapper / fan が既定から外れる（**ユーザー確認 1**。動かすなら `weight` を書き換えるだけ）
- セーブ互換: 遺物は `baseKey` しか持たない（`loot/types.ts` の `Item` に moveset は無い。`loot/stats.ts:264` が `BASES` から引く）→ **移行なし**。`Profile.meta.ultimates`（`Partial<Record<MovesetKey,string>>`）も key が残るので **そのまま**。新武器種 tome / bell は `MOVESET_KEYS` の **末尾** に足す（`stashFacets` の並びは配列順）。`JOB_KEYS` の追加は `sanitizeJob` が未知を見習いへ落とすので旧セーブは壊れない。`v2` は不要

---

## 3. 設計

### 3-1. 型の層 `src/data/weaponForms.ts`（新規）
```ts
export const FORM_KEYS = ["blade","flurry","crusher","hewer","polearm","chain","bulwark","warfan","rod","thrower","pistol","rifle","artillery","tome","bell"] as const;
export type FormKey = (typeof FORM_KEYS)[number];

export interface FormDef {
  readonly key: FormKey;
  readonly name: string;                 // 剣・連刃…
  readonly desc: string;                 // 手触りの 1 行（「敵の攻撃を待って取る」）
  readonly weight: WeaponWeight;         // 既定の重さ（武器種の weight が優先）
  readonly steps: { readonly min: number; readonly max: number };   // 左の段数の幅（銃の家系は右レーンの段数）
  readonly morale: MoraleDef;            // 3-2
  readonly riposte: readonly RiposteSource[];   // 3-3 応手になる出来事
  readonly finisher: readonly FinisherSource[]; // 3-3 終撃になる出来事（"lastStep" は全型）
  readonly reforges: readonly ReforgeKey[];     // 3-6（5c で埋める。5a は []）
}
export const FORMS: Readonly<Record<FormKey, FormDef>>;
export function formOf(moveset: MovesetDef): FormDef;   // MOVESETS[k].form → FORMS
```
- 数値は `src/data/balance/weapons/FORM/<form>.json`（`weapons/_index.json` の `_order` に `"FORM"`、`FORM/_index.json` に `_fields` を親に 1 回）。TS の `FormDef` は union と構造だけを持ち、`FORM.<key>` の数値を差し込む（`data/ultimates.ts` の `instantDef(m, …)` と同じ流儀）
- `PlayerStats` に `form` は足さない（`formOf(currentMoveset(stats))` で毎回引く。`MOVESETS` は凍結なので安い）
- Rule 条件 `{ kind: "form"; forms: readonly FormKey[] }` を `core/rules.ts` に 1 行、照合は `system/rules.ts` で `formOf(playerMoveset(state)).key`。`BoonLoadout.forms?` も同様（`system/boonDefs.ts:215`）。既存の `moveset` 条件は残す（個性で絞りたい札のため）

### 3-2. 戦意（`Player.morale` + `system/morale.ts`）
```ts
// core/state.ts Player に最小 Edit
morale: { value: number; sinceGain: number; window: number; primed: boolean };
//  value = 今の量 / sinceGain = 最後に溜まってからの秒（冷め） / window = 装填の窓など型固有の残り秒 / primed = 次の一撃が放出（長銃・長柄・短銃の強装填）

// data/weaponForms.ts
export type MoraleGain =
  | { kind: "meleeHit"; amount: number }            // 連刃 熱・扇 風
  | { kind: "riposte"; amount: number }             // 剣 返し（受け流し・カウンター・見切り）
  | { kind: "chargeLevel" }                         // 重打（value = 溜めの段。導出）
  | { kind: "applyStatus"; status: StatusKind }     // 刃斧 傷（value = 近くの敵の最大スタック。導出）
  | { kind: "tipHit"; amount: number }              // 長柄 穂先
  | { kind: "pullHit" }                             // 鎖 繋ぎ（value = 繋いだ敵の数。導出）
  | { kind: "guardBlock"; perDamage: number }       // 盾 受け溜め
  | { kind: "bulletCut"; amount: number }           // 扇（meleeHit と両方持てる）
  | { kind: "cast" }                                // 杖 術式（value = この連撃で出た詠唱・魔弾の数。導出 = attack.inputs.length）
  | { kind: "flyingShots" }                         // 投具（value = 自分の boomerang / orbit の弾の数。導出）
  | { kind: "shotFired"; amount: number }           // 短銃 弾倉
  | { kind: "still"; perSec: number }               // 長銃 狙い（動いていない秒）
  | { kind: "placedShots" }                         // 砲（value = 床の自分の設置弾・曲射弾。導出）
  | { kind: "skillHit"; amount: number }            // 書
  | { kind: "minionHit"; amount: number };          // 鈴（設置物・従魔の命中）
export type MoraleRelease =
  | { kind: "laneStep"; key: string }               // 右レーンのこの key の段が放出（返し斬り・乱舞・裂き・叩きつけ・突風・起爆・無詠唱・打ち鳴らし）
  | { kind: "branch" }                              // 3 手の派生が放出（杖）
  | { kind: "nextPrimary" }                         // 満ちた後の最初の左が放出（長柄の貫く突き・長銃の最大溜め攻撃）
  | { kind: "maxCharge" }                           // 最大段の溜め攻撃（重打）
  | { kind: "release" }                             // 構えを離した振り（盾押し）
  | { kind: "reload"; windowSec: number; primeFrom: number; primeTo: number }; // 短銃: 空になると装填、窓の中で右を押すと強装填
export interface MoraleDef {
  readonly label: string;                           // ゲージの名（返し・熱・溜め…）
  readonly gain: readonly MoraleGain[];
  readonly release: MoraleRelease;
  readonly derived: boolean;                        // 導出なら tickMorale が毎ステップ計算し、溜め込まない
}
```
- **数値**（`FORM/<form>.json`）: `max`、`releaseMin`（これ未満はただの段）、`consume`（"all" か数）、`decay: { delaySec, perSec }`（連刃・扇。他は 0）、`perUnit: { damageMul, poiseMul, reachMul, hitsAdd, knockbackMul, pierceAdd }`（放出の 1 単位あたり。例 連刃 熱 100 で damageMul 2.5 = perUnit 0.015）、`unitText`（浮き文字用の桁）
- **溜まる場所**（`system/morale.ts` の `gainMorale(state, kind, amount)` を各フックから 1 行で呼ぶ）: `player.ts meleeHitEnemy`（meleeHit / tipHit / pullHit / applyStatus）、`onChargeLevelUp`、`weaponArts.guardDamageMul`（guardBlock）、`player.ts cutProjectile / reflectProjectile`（bulletCut）、`emitVolley`（shotFired）、`updateAttack` の cast 発射、`skills/hit.ts skillHit`（skillHit / minionHit: source が placed / minion）、`tickMorale`（still・導出）。応手経由は `moments.ts noteRiposte` が `gain.kind === "riposte"` を見て呼ぶ
- **放出の効き方**: `scaleStep(stats, base, moveset, level, release?: ReleaseMul)` に `release` を足し、`meleeStep(...)` の呼び出しで `releaseMulOf(state, lane, step)`（`morale.ts`）を渡す。`releaseMulOf` は「今の段が型の放出の段で `value >= releaseMin`」なら `perUnit × 単位数` を返す。**消費は命中ではなく振りの開始**（`beginSwing` で `consumeMorale`。空振りでも消える = 放つ時機を読む）。放出で出た段は `damageEnemy` の opts に `release: true` を渡し、`combat.ts` が `onRelease`・`onFinisher` を積む（3-3）
- 弾の放出（長柄の貫く突き・長銃・投具の往復・砲の起爆）は `VolleyOverride`（`player.ts:1580`）の `damageMul / pierceBonus` に同じ `perUnit` を写す。砲は `detonateOwnMines` を放出として扱い、起爆した弾の数が単位
- **充溢**: `tickMorale` の末尾で `value >= max` に **なった瞬間**（前ステップ未満）に `noteMoment("brim")`（浮き文字「充溢」、sfx `chargeLevel` を流用）。導出型は「条件が真になった瞬間」
- 増の口: `PlayerStats.moraleMaxAdd`（既定 0）と `moraleGainMul`（既定 1）を `loot/types.ts` に 2 行、`loot/stats.ts` の表示名（「戦意の上限」「戦意の溜まりやすさ」）。`DAMAGE_TAGS` に `release`（放出の一撃に付く与ダメの増）。`PerCounter` に `{ kind: "morale" }`（「戦意 10 につき」）。性質・祝福で使うのは段取り 7
- （旧。今は `system/magazine.ts`）短銃の弾倉: `MoraleRelease.reload` の型は `Player.morale.window` に装填の残り秒を持ち、`canShootNow`（`player.ts:1553`）が `window > 0` なら撃てない。窓の `primeFrom..primeTo` で右（`pressSecondary`）を押すと `primed = true`、次の弾倉（`max` 発）の弾に `perUnit.damageMul` が乗り、その 1 発目が終撃。**左押しっぱなしの手触りが変わる（ユーザー確認 3）**

### 3-3. 共通の瞬間（`system/moments.ts` 新規）
| 瞬間 | EventKind | 積む場所 | 判定 |
| --- | --- | --- | --- |
| 先制 | `onFirstStrike` | `combat.ts damageEnemy`（kind melee/ranged/skill の最初）| `Player.moment.firstStrikeArmed` が真なら積んで偽に。`tickMoments` が `!isEngaged(state)`（`system/engagement.ts:80`）を `MOMENT.firstStrikeIdleSec`（1.5）続けたら真に戻す |
| 終撃 | `onFinisher` | `damageEnemy` で opts に `finisher: true` のとき（今の `finisher` フラグを流用）+ `FinisherSource` が真の一撃（最大溜め攻撃 `chargeLevel === levels.length` / 放出の一撃 / 砲の一斉起爆 / 長銃の最大溜め攻撃）| `finisher` 条件（`rules.ts:720`）はそのまま。`SWING_TAG.finisher` もそのまま |
| 充溢 | `onBrim` | `morale.ts tickMorale` | 3-2 |
| 放出 | `onRelease` | `beginSwing`（近接）/ `emitVolley`（弾）/ `detonateOwnMines` | 消費した単位を `amount` に載せる（「放出の量につき」の札の元） |
| 応手 | `onRiposte` | `parry.ts parrySucceed`（parry）/ `player.ts meleeHitEnemy` の counter（counter）/ `combat.ts justDodge`（justDodge）/ `weaponArts.guardDamageMul`（guardBlock。コミット中の攻撃を受けたときだけ）/ `cutProjectile` `reflectProjectile`（bulletCut）/ 居合の release が windup の敵に当たった（iai）/ 引き寄せが windup の敵に当たった（pullInterrupt）/ 戻りの弾が敵弾を消した（recallCut。`projectiles.ts` の弾どうしの当たり）/ 溜め中に被弾を耐えた（chargeEndure。3-4）| `noteRiposte(state, source, enemy?)` が `formOf().riposte.includes(source)` を見て積む。既存の `onCounter` / `onJustDodge` は残す（重ねて出す） |
| 双撃 | `onTwinStrike` | `meleeHitEnemy` / 右レーンの弾の命中（`Projectile.lane?: ButtonKey` を `emitArtVolley` が付ける。`core/state.ts` 最小 Edit）| `Player.moment.lastHitLane` と違うレーンの命中で積み、`lastHitLane` を更新。連撃が切れる（`endSwing` の `inputs.length = 0`）と `null` |
- `RiposteSource = "parry" \| "counter" \| "justDodge" \| "guardBlock" \| "bulletCut" \| "iai" \| "pullInterrupt" \| "recallCut" \| "chargeEndure"`、`FinisherSource = "lastStep" \| "maxCharge" \| "release" \| "detonate" \| "aimedShot"`
- 浮き文字は体言止め（「充溢」「放出」「双撃」「先制」。応手は既存の「受け流し」「見切り！」「カウンター」を残し、応手そのものは出さない）。色・大きさは `balance/weapons/MOMENT.json`
- `system/keywords.ts` の語に `firstStrike / finisher / brim / release / riposte / twinStrike` の祝福タグを足すのは段取り 7

### 3-4. 型ごとの戦意・放出・応手・段数（5a で 4 型、5b で残り）
| 型 | 戦意（label / max / gain）| 放出 | 充溢 | 応手 | 段数 | 実装の要点（既存の口）|
| --- | --- | --- | --- | --- | --- | --- |
| 剣 | 返し / 3 / riposte +1 | laneStep `returnCut`（剣）・`iai` の release（刀）。consume all、perUnit reachMul 1.15・hitsAdd 1 | 3 | parry・counter・justDodge・iai | 3〜4 | 剣の右 2 段目は既にある。刀の居合は `charge` の段（`katana.json steps2[0]`）で、release の振りに乗せる |
| 連刃 | 熱 / 100 / meleeHit +6（爪の 2 ヒットは 2 回）、decay 1.2 秒後 −40/秒 | laneStep `frenzy`（右の最終段を「乱舞」に差し替え。3 武器種の JSON）。perUnit damageMul 0.015（100 で ×2.5）、applies 出血（爪）/ 燃焼は改鋳 | 100 | justDodge | **6〜8**（双剣 6・拳 6・爪 8）| 段の JSON を足す。`STEP2_NAMES` に新 key。fx は別レーン |
| 重打 | 溜め / 3 / chargeLevel（導出）| maxCharge（3 段目の溜め攻撃 = 放出 + 終撃）| 3 | chargeEndure・justDodge | 4 | `FORM.crusher.chargeArmor: { damageTakenMul 0.6, noKnock: true }` を `combat.ts damagePlayer` で `attack.charging && form === crusher` のとき掛ける（重打の「溜め中の堅さ」）。flail は `charge` が右 1 段目なので `meleeChargeOf` が拾う |
| 刃斧 | 傷 / 5 / applyStatus `wound`（導出 = 近く 60px の敵の最大スタック）| laneStep `rend`（右の最終段「裂き」）。命中した敵の `wound` を全部消し、perUnit damageMul 0.5 × スタック | 5 | counter・justDodge | 4 | **新 StatusKind `wound`（傷）**: 継続ダメージ無し・重ねるだけの印（`docs/recipes/status.md`）。左の段 `applies` に `wound 1`。裂きは `applyStepStatus` の前に `consumeWounds` |
| 長柄 | 穂先 / 4 / tipHit +1 | nextPrimary: 満ちた後の最初の突き（thrust）に `cast`（貫く穂先の弾 `cast.pierceThrust`、pierce 99、perUnit damageMul）。`primed` を立て、次の thrust の `beginSwing` で cast を差し込む | 4 | counter・bulletCut（`tip` 付きの thrust の active 中だけ `cutsBullets` 扱い: `FORM.polearm.tipCutsBullets`）| 4 | `MeleeStep.tip`（`weapons.ts:72-80`）と `meleeContact` の `"tip"` が既にある |
| 鎖 | 繋ぎ / 3 / pullHit（導出 = `Enemy.linkedTimer > 0` の数）| laneStep `slam`（右の最終段「叩きつけ」）: 繋いだ敵を全員 `pull` で自分の前に寄せてから当てる。consume all | 3 | pullInterrupt・justDodge | 4 | `Enemy.linked: number`（残り秒。`core/state.ts` 最小 Edit）。**一蓮托生**（繋いだ敵どうしで与ダメを分け合う）は `combat.ts damageEnemy` に「linked の敵に当てたら amount × `FORM.chain.shareRatio` を他の linked へ配る」1 か所。5b |
| 盾 | 受け溜め / 100 / guardBlock perDamage 1.0 | release（構えを離した盾押し = 既存の `release` 派生）。perUnit damageMul 0.012 | 100 | guardBlock | 4 | `guardDamageMul` で受けた量を `gainMorale`。`FORM.bulwark.blockOnlyCommitted`（コミット中の攻撃を受けたときだけ応手）|
| 扇 | 風 / 100 / meleeHit +8・bulletCut +25 | laneStep `fanning` の release（突風）。perUnit knockbackMul・`spreadTerrain` の radius | 100 | bulletCut | 4 | 既存の hold.guard + release。地形を広げる Rule は `movesetRules` に既にある |
| 杖 | 術式 / 3 / cast（導出 = `attack.inputs.length`）| branch（3 手の魔法 = 放出 + 終撃）| 3 | justDodge | 4 | 既存の派生 6 本がそのまま放出。`startBranch` で `sequence.length >= 3` かつ型が rod なら `onRelease` |
| 投具 | 飛んでいる数 / 3 / flyingShots（導出）| laneStep `recall`（投擲）/ `ringLaunch`（輪刃）/ 右の払い（戦輪）。戻りの弾に perUnit damageMul 0.3 | 3 | recallCut・justDodge | 3〜4 | `recallShots`（`weaponArts.ts:339`）が戻す弾に `returnDamageMul × (1 + perUnit × n)` |
| 短銃 | 弾倉 / 8 / shotFired +1 | reload（窓 0.6 秒、0.2〜0.4 で右 = 強装填。次の弾倉 damageMul 1.3、1 発目が終撃）| 弾倉が空 | justDodge（`FORM.pistol.zeroDistance` 30px 以内の見切りだけ）| 3（右）| 3-2 の末尾 |
| 長銃 | 狙い / 100 / still +60/秒（`input.move` が零。動くと −120/秒）| nextPrimary: 満ちた後の 1 発 = 最大溜め攻撃（pierce +3・会心確定・終撃）| 100 | justDodge | 3（右）| `tryShoot` で `primed` なら `VolleyOverride { pierceBonus, damageMul, crit: true }`（`rollOutgoing` に会心強制の口 `forceCrit` を 1 引数）|
| 砲 | 置いた弾 / 4 / placedShots（導出 = 自分の `mine` / `lob` 未炸裂）| laneStep `detonate`（右の `extras.detonateMines` を持つ段 = 一斉起爆 = 放出 + 終撃）| 4 | justDodge | 3（右）| `detonateOwnMines`（`weaponArts.ts:407`）が起爆した数を `onRelease.amount` に |
| 書 | 術 / 5 / skillHit +1 | laneStep `freeCast`（右 1 段目「無詠唱」: 次のスキル 1 回の気力 0。`state.skills.freeCast = true` を `spendMana` の呼び出し側 `skills.ts` で消費）| 5 | justDodge | 3 | 左は弱い杖打ち（size 12・威力 ×0.5）。`PlayerStats.skillCooldownMul` があれば型の `modifiers` で ×0.7、無ければ `FORM.tome.cooldownMul` を `skills.ts` の再使用に掛ける |
| 鈴 | 響き / 5 / minionHit +1 | laneStep `toll`（右 1 段目「打ち鳴らし」: 半径内の自分の設置物を即発動・従魔に攻撃命令 + `state.skills.bellBuff = { timer, mul }`）| 5 | justDodge | 3 | 左の振り `onSwing` で `bellBuff` を延長。設置物・従魔は `state.skills.fields / wells / summons`（`skills/placed.ts:96-97, summons.ts`）|

- 剣の左 3 段（`PLAYER_MELEE.json`）はそのまま（`steps.min 3`）。**`MIN_STEPS` を 3 に戻し、上限は `FORM.<型>.steps.max`** に置き換える（`weapons.test.ts:37-40, 77-80`）。「近接は右レーンも同じ段数」の規約（`:126`）は保つ

### 3-5. 重さの補償（`weightClass.json`）
- 既存 `damageMul / poiseMul`（今 1）に足す: `finisherKnockbackMul`（終撃のノックバック倍率）、`finisherGuardBreak`（終撃が堅守を崩す。真偽）、`hitstopFinisher`（終撃のヒットストップ。`FEEL.hitstopFinisher` を重さで上書き）。適用は `scaleStep`（knockback）と `meleeHitEnemy`（`guardBreak: counter || (finisher && w.finisherGuardBreak)`）
- 初期値（tuner の出発点）: 重 `damageMul 1.25 / poiseMul 1.35 / finisherKnockbackMul 1.4 / finisherGuardBreak true`、中 `1 / 1 / 1.1 / false`、軽 `1 / 1 / 1 / false`（軽の補償は「安全」なので数値では足さない）
- 釣り合いの測り方は 6 章（武器種ごとの probe）

### 3-6. 改鋳（`system/reforge.ts` + `data/reforges.ts`、5c）
- `GameState.reforges: ReforgeKey[]`（ラン内。永続化しない。ラン中の保存は無い）、`GameState.reforgeChoice: { options: ReforgeKey[]; hover; timer } | null`（`boonChoice` と同じ形）。`updateReforgeChoice` は `updateBoonChoice`（`boons.ts:548-563`）を写して skill1〜3 / クリックで選ぶ（リプレイは入力列で再現）
- 出所（推奨）: 今は章が無いので **`BossState.major`（5 の倍数の階）のボス撃破直後**に 3 択。段取り 6 で「章の出口」へ移す（**ユーザー確認 5** は不要、推奨で進める）。1 ランに 2〜4 回、`REFORGE.perRun 4`
- `ReforgeDef = { key, form: FormKey, name, desc, patch: (m: MovesetDef) => MovesetDef; moralePatch?: Partial<MoraleNumbers>; flags?: readonly ReforgeFlag[] }`。`playerMoveset` の合成順を **変身 ?? ultimateMoveset(withReforges(withJobBranch(currentMoveset)))** にし、`withReforges` は `${moveset.key}:${reforges.join(",")}` で cache（`JOB_MOVESET_CACHE` と同じ）。`ReforgeFlag`（"heatNoDecay" / "chargeWhileMoving" / "rendKeepsWound" …）は `morale.ts` / `player.ts` が `hasReforge(state, flag)` で読む
- 数は 5c で **各型 2（計 30）**、build-core 4-1 の表の例 1・例 2 をそのまま採用（蓄勢・四重詠唱・満身創痍など名前は GLOSSARY 2-2 に既にある）。「武器の重さの切り替え」（7 章）は `patch` で `weight` を書き換えるだけで表せる
- 数値は `balance/weapons/REFORGE/<form>.json`（改鋳 key ごとのブロック）。描画は `render/boonUi.ts` のカード描きに「見出し」引数を足して流用（renderer は 1 行）

### 3-7. 流儀（ジョブの作り直し。5c）
```ts
// data/jobs.ts JobDef に足す / 消す
readonly dash: DashForm;                 // 足す
readonly mana: readonly ManaSource[];    // 足す
// favored / weakness は削る（JOB.favoredMeleeMul / favoredAttackSpeedMul / weakness.json も）
export type DashForm = "standard" | "step" | "leap" | "slip" | "brace" | "mist" | "vault" | "blink" | "shadow" | "flask" | "swap" | "ward";
export type ManaSource =
  | { kind: "attackHit"; mul: number }            // 通常攻撃の命中（今の onMelee / onShot × mul）
  | { kind: "riposte"; amount: number }           // 剣士
  | { kind: "finisher"; amount: number }          // 剣士
  | { kind: "rangedHitFar"; perMeter: number; minMeters: number }  // 狩人
  | { kind: "comboHit"; perCombo: number; cap: number }             // 拳闘士
  | { kind: "guardBlock"; perDamage: number }     // 盾持ち
  | { kind: "statusTick"; amount: number }        // 呪術師（継続ダメージの刻み）
  | { kind: "tipHit"; amount: number }            // 槍兵
  | { kind: "skillHit"; amount: number }          // 術士
  | { kind: "backstab"; amount: number }          // 影（背面・処刑）
  | { kind: "reaction"; amount: number }          // 錬金術師
  | { kind: "minionHit"; amount: number }         // 陰陽師（式神 = 設置物・従魔）
  | { kind: "boonFired"; amount: number };        // 巫女（加護の Rule が発火）
```
| 流儀 | dash | 実装（`system/dashForms.ts`。`tryDash` の `tryDashGuard` / `blink` 分岐を `runDashForm(state, form)` に置き換え）| mana |
| --- | --- | --- | --- |
| 見習い | standard | 今のまま | attackHit ×1.0 |
| 剣士 | step（踏み込み）| 距離 ×0.6・無敵 ×0.5。**振りの active / recover 中も `canDashCancel` を無視して出せ**、ダッシュ後 `PLAYER.dash.time` 以内の次の左は段を進めたまま（`resetSwing` しない）| riposte 15・finisher 8・attackHit ×0.35 |
| 狩人 | leap（飛び退き）| 向きを `move` の逆、足元に設置弾（`emitVolley` で `mine` の弾 `dash.trap`）| rangedHitFar 0.4/m（4m 以上）・attackHit ×0.35 |
| 拳闘士 | slip（潜り）| 距離 ×0.5・`justDodgeWindow` +0.08 | comboHit 0.8/コンボ（上限 12）・attackHit ×0.35 |
| 盾持ち | brace（不退）| 既存 `tryDashGuard` の中身を移す（祝福「鉄壁の構え」は段取り 7 で削る）| guardBlock 0.15/ダメージ・attackHit ×0.35 |
| 呪術師 | mist（霧）| 無敵 ×0.5、通過した敵に `curse`（`applyStatus`）| statusTick 0.6・attackHit ×0.35 |
| 槍兵 | vault（跳躍）| 敵の体を通り抜ける（`physics` の敵との押し合いを無効）、着地で `dashAttack` を自動予約（`dashAttackQueued`）| tipHit 3・attackHit ×0.35 |
| 術士 | blink | 既存 `blink`（誓約「瞬歩」の爆発は誓約側に残す）| skillHit 2.5・attackHit ×0.35 |
| 影 | shadow（影潜り）| `dash.time` ×2.5・移動のみ・攻撃不可（`artLocksActions` 相当）・出た直後 0.5 秒の近接は背面扱い（`Player.moment.backstabUntil`）| backstab 6・attackHit ×0.35 |
| 錬金術師 | flask（瓶投げ）| 距離 ×0.6、始点に `placeTerrain`（`bog` か `oil`。`DASH_FORM.flask.terrain`）| reaction 10・attackHit ×0.35 |
| 陰陽師（新）| swap | 最も近い自分の設置物・従魔と位置を入れ替える（無ければ standard）| minionHit 2・attackHit ×0.35 |
| 巫女（新）| ward（結界）| 距離 ×0.4、着地に 1.5 秒の `guard`（全方位 ×0.5 被ダメ。`ultimateIncomingMul` と同じ経路に `wardIncomingMul`）| boonFired 3・attackHit ×0.35 |
- **気力の下地**: 見習い以外も通常攻撃の命中で今の 35%（`JOB.manaBaseMul` 0.35）は湧く（枯渇で遊べなくなる保険。tuner のつまみ）。**推奨、確認は不要**
- 実装: `system/manaSources.ts` の `onManaSource(state, source: ManaSourceKind, base)` が `JOBS[state.job].mana` を見て `gainAttackMana` / `gainMana`。`player.ts gainMeleeMana`（1346）と射撃の `onShot` を `onManaSource("attackHit", base)` に置き換え、`moments.ts`（riposte / finisher）、`combat.ts`（backstab / rangedHitFar）、`skills/hit.ts`（skillHit / minionHit）、`statusEffects.ts` の刻み（statusTick）、`statusReactions.ts`（reaction）、`system/rules.ts applyRuleEffect:251`（`rule.owner.kind === "boon"` なら boonFired）に各 1 行
- ステータスの偏り・固有ルール 2 本・初期スキル石・初期武器・ジョブ派生は残す。`favoredWeapon` 条件・`JobMulStat` は削る（`jobs.test.ts:73, 126, 151, 163` を書き換え）
- 新ジョブの解放: `unlockedBy` に既存の依頼を割り当てるか既定解放（**ユーザー確認 4**。推奨は既定解放で `jobs.test.ts:106` の「4 つ」を「6 つ」に）

### 3-8. 書・鈴（新武器種。5d）
- `MOVESET_KEYS` 末尾に `tome` / `bell`。`movesets/tome.json` / `bell.json`（左 3・右 3・派生 4。3-4 の表）。ベース各 2（`bases.ts` + `balance/loot/bases.json`。書: 写本 `codex` 深度 3 / 禁書 `grimoire` 深度 12、鈴: 神楽鈴 `kagura` 深度 4 / 五鈷鈴 `vajraBell` 深度 13。**表示名はユーザー確認 6**）。奥義 3 本ずつ（`SET_BUILDERS`）。`Record<MovesetKey>` 12 か所に 1 行ずつ（HELD は pixel-artist、fx は fx レーン、それまでは既存の絵を流用 = weapons-wave4 の Lane A と同じ手）
- 技: `arts.test.ts` の「武器種ごとに 10 種以上」は **tome / bell を除外リストに**（技の圧縮は段取り 7）。`WEAPON_ART_KEYS` に空配列
- 書の「スキルの再使用 3 割短く」は `MovesetDef.modifiers` では表せない（与ダメの増・倍だけ）→ `FORM.tome.skillCooldownMul` を `system/skills.ts` の再使用の計算に 1 か所

### 3-9. 連撃の段数の拡張（連刃）
- JSON: `twinBlades.json` 5 → 6、`fists.json` 5 → 6、`claws.json` 5 → 8。右レーンも同数（最終段 = 乱舞 `frenzy`）。段の目安は既存の 3〜4 段目を写して `hits` を足す。派生の `next` は張り直す（最終段を指すものは新しい最終段へ）
- 計算式の頁: `ui/scalingText.ts actionListRows` に **「連続する段で式が同じなら『1〜2 段目』に畳む」** を足す（連刃は 1・2 段が同じ式）。`detailPane.test.ts:87, 119` が受ける
- HUD: `comboPips` 8 個の幅（`render/comboUi.ts`）は `renderMath` の hudLayout で確認。溢れたらピップの間隔を段数で縮める
- fx: `MOVESET_FX` の網羅の検査（`swingMotionKeys`）が新しい `l:5..7` / `r:frenzy` を要求する → **fx レーン**（`scripts/fx/sheets/twinBlades.mjs / claws.mjs / fists.mjs` + `ppnpm run fx:gen --atlas <key>`）。先に入れるときは検査に「未描画の段の許容リスト」を足す（手続きの描画に落ちる）
- `data/meleeReach.test.ts`（外縁は刃先まで）が新段を検査するので reach/size は既存の段に揃える

### 3-10. 型の足し方（レシピ `docs/recipes/weapon.md` の書き直し）
1. `data/weaponForms.ts` に `FormKey` と `FormDef`（重さの既定・段数の幅・戦意 `MoraleDef`・応手 `riposte[]`・終撃 `finisher[]`・改鋳 2〜6）、`balance/weapons/FORM/<form>.json` に数値
2. 武器種を 1 つ以上 `form` で紐付け、放出の段（`MoraleRelease.laneStep.key`）を `steps2` に持たせる
3. 溜まる出来事が新しいなら `MoraleGain` に 1 語 + フックに `gainMorale` 1 行。応手が新しいなら `RiposteSource` に 1 語 + `noteRiposte` 1 行
4. テスト: `data/weaponForms.test.ts`（全型に放出の段が実在する・段数の幅・重さの既定）+ `system/morale.test.ts` に「<型>: 溜まる → 充溢 → 放出で倍率 → 0」の 1 本
5. これで祝福・性質・スキルの「終撃で / 充溢で / 放出で / 応手で」の札が全部そのまま効く

---

## 4. 型の変更・JSON・テスト・REPLAY_VERSION・壊れるテスト・移行

### 4-1. 型（共有ファイルは最小 Edit）
| ファイル | 変更 |
| --- | --- |
| `core/state.ts` | `Player.morale { value, sinceGain, window, primed }`、`Player.moment { firstStrikeArmed, lastHitLane, backstabUntil }`、`Enemy.linked: number`、`Projectile.lane?: ButtonKey`、`GameState.reforges: ReforgeKey[]`、`GameState.reforceChoice`（5c）|
| `core/events.ts` | `EVENT_KINDS` に `onFirstStrike / onFinisher / onBrim / onRelease / onRiposte / onTwinStrike` |
| `core/rules.ts` | `RuleCondition` に `{ kind: "form"; forms }`、`PerCounter` に `{ kind: "morale" }` |
| `core/damage.ts` | `DAMAGE_TAGS` に `release` |
| `core/status.ts` | `StatusKind` に `wound`（5b。`STATUS_KINDS` の件数 34 → 35、`audit:docs`）|
| `data/weapons.ts` | `MovesetDef.form: FormKey`（必須）、27 の spec に 1 行、`STEP2_NAMES` に `frenzy / rend / slam / freeCast / toll`、5d で `MOVESET_KEYS` +2 |
| `loot/types.ts` | `PlayerStats.moraleMaxAdd / moraleGainMul`（+ `DEFAULT_STATS`）|
| `data/jobs.ts` | `JobDef.dash / mana` 追加、`favored / weakness` 削除、`JOB_KEYS` +2（5c/5d）|
| `data/tuning.ts` | `FORM / MOMENT / REFORGE / DASH_FORM / MANA_SOURCE` の再 export |

### 4-2. 新しい balance JSON（置き場所と `_fields`）
| ブロック | 場所 | 主な項目（`_fields` は親に 1 回）|
| --- | --- | --- |
| `FORM` | `balance/weapons/FORM/<form>.json` + `_index.json`。`weapons/_index.json` の `_order` に `"FORM"` | `weight`（既定の重さ。武器種の weight が優先）/ `stepsMin` `stepsMax` / `label`（ゲージの名）/ `max` / `releaseMin` / `consume` / `decayDelaySec` `decayPerSec` / `gainAmount`（gain の種類ごと）/ `perUnit.{damageMul,poiseMul,reachMul,hitsAdd,knockbackMul,pierceAdd}` / 型固有（`chargeArmor.damageTakenMul` `shareRatio` `tipCutsBullets` `reload.{windowSec,primeFrom,primeTo,primedDamageMul}` `stillGainPerSec` `moveLossPerSec` `zeroDistancePx` `skillCooldownMul` `tollRadius` `bellBuffMul`）|
| `MOMENT` | `balance/weapons/MOMENT.json` | `firstStrikeIdleSec` 1.5 / `twinStrikeWindowSec`（連撃の窓と同じなら省く）/ 浮き文字 `text.{brim,release,twinStrike,firstStrike}` `color` `scale` `life` |
| `weightClass` | 既存に追記 | `finisherKnockbackMul` / `finisherGuardBreak` / `hitstopFinisher` |
| `REFORGE` | `balance/weapons/REFORGE/<form>.json` | 改鋳 key ごとのブロック（例 `heatKeep.{maxSecHeld, extraDamagePerSec}`）。`perRun` `offerCount` は `REFORGE/_index.json` 直置き |
| `DASH_FORM` | `balance/jobs/DASH_FORM.json` | 形ごとの `distanceMul / invulnMul / timeMul / trapKey / terrain / wardSec / wardMul / shadowBackstabSec / vaultLanding` |
| `MANA_SOURCE` | `balance/jobs/MANA_SOURCE.json` | 流儀ごとの源の量（3-7 の表）。`JOB.json` に `manaBaseMul` 0.35 |
| 削る | `balance/jobs/weakness.json`、`JOB.json` の `favored*` / `*Mul`（弱点）| 5c |
すべて `pnpm run balance:gen` → `balance.test.ts` の `_fields` 検査

### 4-3. テスト（新しい仕組みには必ず）
- `data/weaponForms.test.ts`: 全武器種が型を持つ / 型の放出の段の key が `steps2` に実在（laneStep のもの）/ 段数が型の幅に入る / 重さの既定から外れる武器種は `WEIGHT_OVERRIDES` に理由付き / FormKey と MovesetKey が重ならない
- `system/morale.test.ts`: 剣「受け流し 3 回で充溢、返し斬りで消費され reach と hits が伸びる」/ 連刃「命中で熱、1.2 秒手を止めると冷める、100 で乱舞が ×2.5」/ 重打「最大段の溜め攻撃が放出と終撃を出す」/ 長銃「止まると溜まり、動くと減り、満ちた 1 発が貫き会心」/ 短銃「弾倉が空で装填、窓で右を押すと次の弾倉が強い」/ 刃斧「傷 5 の敵を裂くと倍で傷が消える」/ 鎖「繋いだ敵どうしが与ダメを分け合う」/ 砲「起爆した数が放出の量」/ 導出型は溜め込まない
- `system/moments.test.ts`: 先制は交戦の外で 1.5 秒待った後の最初の一撃だけ / 終撃は最終段・最大溜め・放出・起爆で 1 回ずつ / 双撃は左右を交互に当てたとき、同じ側の連続では出ない / 応手は型の一覧にある出来事だけ（盾は guardBlock、剣は parry）/ `onCounter` `onJustDodge` は従来どおり出る
- `system/reforge.test.ts`（5c）: 5 の倍数の階のボス撃破で 3 択 / skill1 で選ぶと `reforges` に入り `playerMoveset` が変わる / 1 ランの上限 / 同じ改鋳は 2 度出ない / リプレイ（`core/replay.test.ts` に改鋳を選ぶ入力列の往復）
- `system/dashForms.test.ts` / `manaSources.test.ts`（5c）: 形ごとに 1 本（不退で被弾を受ける / 影潜りで攻撃が出ない / 式神と入れ替わる…）、源ごとに 1 本（剣士は通常の命中で 35%、受け流しで 15）
- `qa/combatProbe.test.ts`: 武器種の軸で `runDuel` が全 29 種で落ちない（1 seed・5 秒）

### 4-4. `REPLAY_VERSION`
- **19**（5a+5b 統合時）: 戦意と放出で同じ入力列の与ダメが変わる・連刃の段数・重さの補償・傷・繋ぎ。`FrameInput` は変えない（放出は右レーン、改鋳は skill1〜3）
- **20**（5c）: 改鋳の 3 択が step を止める・流儀のダッシュと気力・得意武器と弱点の削除
- **21**（5d）: 武器種 +2 で技の抽選の母集団が変わる（`skillWeight`）・ジョブ +2
- `docs/ARCHITECTURE.md:136` の版の説明に 1 文ずつ

### 4-5. 壊れそうな既存テスト
| テスト | 理由 | 直し |
| --- | --- | --- |
| `src/data/weapons.test.ts:37-40, 77-80` | `MIN_STEPS 4 / MAX_STEPS 5` | 型の幅 `FORM.<型>.steps` を読む |
| 同 `:126`「右レーンも同じ段数」 | 連刃の段数増 | そのまま（右も増やす）|
| 同 `:263` 単一最強 | 連刃の威力・段数 | 放出前の値で比べる（`releaseMul` 無しの `meleeStep`）|
| 同 `:414 EXPECTED_ART` / `:583 EXPECTED_CLAMP` | 新武器種・右の kind の差し替え | 1 行ずつ |
| `data/scalingVariety.test.ts` `LANE_TABLE` | 右レーンの係数表 | 新段を足す |
| `render/detailPane.test.ts:87, 119` | 8 段で頁が溢れる | 3-9 の畳み |
| `render/fxMotions.test.ts`（網羅）| 新しい段の絵が無い | fx レーンか許容リスト |
| `data/meleeReach.test.ts` | 新段の外縁 | 既存段に揃える |
| `src/system/jobs.test.ts:73, 106, 126, 151, 163` | 得意・弱点の削除、ジョブ数 | 3-7 |
| `src/system/actionFeel.test.ts`（ダッシュ・段の手触り）| 剣士の踏み込みは `canDashCancel` を無視 | 見習いで検査するよう `state.job` を固定 |
| `src/system/weaponArts.test.ts:118-148` | 剣の受け流しが返しを溜める | 期待値に `morale.value` を足すだけ |
| `src/system/player.test.ts`（段カウンタ・派生）| 双剣 5 段の固定値 | 6 段へ |
| `skills/arts/arts.test.ts` | tome / bell が 10 種未満 | 除外リスト |
| `render/sprites.test.ts` / `thrownLook.test.ts` / `audio` の `Record<MovesetKey>` | +2 | 1 行ずつ |
| `core/replay.test.ts` | 版 | 版と改鋳の入力の往復 |
| `qa/simulation.test.ts` | 決定性の比較だけ。被弾・到達は report で見る | 変更なし |
| `scripts/audit-agent-docs.mjs` | 「（`MOVESET_KEYS`、27 種）」→ 29、`STATUS_KINDS` 34 → 35、`JOB_KEYS` | 資料側を直す |
| `docs/GLOSSARY.md` の名前の衝突検査（派生・右の段・奥義・祝福）| `frenzy 乱舞` / `rend 裂き` / `slam 叩きつけ` / `toll 打ち鳴らし` / `freeCast 無詠唱` | 付ける前に `src/` を grep（「叩きつけ」は鎌の奥義・派生に無いか要確認）|

### 4-6. セーブの移行
- 不要（2 章）。`sanitizeUltimateChoices`（`loot/profile.ts:298`）は未知の武器種を落とし、新武器種は既定の奥義になる。ジョブは `sanitizeJob`。ラン内の値（戦意・改鋳）は永続化しない

---

## 5. 段階分けとレーン（各段で遊べる）

### 前置き（統合役、30 分）: 共有の型を先に 1 コミット
`core/state.ts`（Player.morale / moment、Enemy.linked、Projectile.lane）、`core/events.ts`（6 イベント）、`core/damage.ts`（release）、`core/rules.ts`（form 条件・morale の PerCounter）、`data/weapons.ts`（`MovesetDef.form` + 27 行 + `STEP2_NAMES` の予約 key）、空の `data/weaponForms.ts`（FORM_KEYS と FORMS の骨。morale は `derived: false, gain: [], release: laneStep(既存の右最終段)` の仮）、`balance/weapons/FORM/_index.json`、`tuning.ts`。これで各レーンが並列に入れる

### 5a. 型と戦意の器（遊べる: 剣・連刃・重打・長銃の 4 型で戦意が動き、6 つの瞬間が HUD と浮き文字に出る）
| レーン | 所有 | 最小 Edit | 編集禁止 |
| --- | --- | --- | --- |
| **A 戦意と瞬間の核**（Opus implementer。設計の要）| 新規 `system/morale.ts` `system/moments.ts` + test、`data/weaponForms.ts`（4 型の中身）、`balance/weapons/FORM/{blade,flurry,crusher,rifle}.json` `MOMENT.json`、`data/weaponForms.test.ts` | `system/player.ts`（`createPlayer` 初期値 / `tickTimers` に `tickMorale` `tickMoments` / `scaleStep` の release 引数 / `meleeStep` 呼び出し 3 か所 / `beginSwing` の consume と `onRelease` / `meleeHitEnemy` の gain・双撃・応手 counter / `onChargeLevelUp` / `tryShoot` の primed）、`system/combat.ts`（`damageEnemy` の先制・終撃、`justDodge` の応手、`rollOutgoing` の `forceCrit`）、`system/parry.ts`（`parrySucceed` に `noteRiposte` 1 行）、`system/weaponArts.ts`（`updateAim` `guardDamageMul` 各 1 行）、`system/rules.ts`（form 条件の照合）、`system/modifiers.ts`（morale の countPer）、`loot/types.ts` `loot/stats.ts`（2 stats）| `enemies.ts` `poise.ts` `boons*.ts` `render/*` |
| **B HUD**（Sonnet）| 新規 `render/moraleHud.ts`（気力バーの隣に型の名のゲージ。放出可なら点滅は座標ハッシュ）+ test、`render/comboUi.ts`（放出の段に印）、`meta/tips.ts`（「戦意」「共通の瞬間」の 2 項）、`docs/GLOSSARY.md`（戦意の各型の名） | `render/layers.ts` `render/renderer.ts`（呼び出し 1 行ずつ）| `system/*` |
| **C 武器種ごとの probe**（Sonnet qa-runner）| `qa/combatProbe.ts`（`ProbeGear` に `{ moveset }`、`ProbeConfig.weapons`、`buildProbeReport` に「武器種 × 敵」の表: 撃破秒・被弾/60 秒・放出/60 秒・応手/60 秒）、`qa/combatProbe.test.ts`、`scripts/qa-probe.mjs`、`src/qa/probe.md` | `qa/bot.ts`（放出の段を狙って押す 1 分岐）| 本体 |
- 順序: A → B（HUD は `Player.morale` の形だけ先に合意）。C は独立。統合役が `REPLAY_VERSION` 19 は **5b の後** に 1 回

### 5b. 全ての型・応手・段数・補償（遊べる: 15 型のうち 13 が戦意を持ち、連刃は 6〜8 段、重い武器が強い）
| レーン | 所有 | 最小 Edit | 編集禁止 |
| --- | --- | --- | --- |
| **D 近接の型 5**（刃斧・長柄・鎖・盾・扇・杖・投具。Sonnet ×2 に分けてよい: D1 刃斧・長柄・鎖 / D2 盾・扇・杖・投具）| `data/weaponForms.ts` の該当型、`FORM/<form>.json`、`movesets/{axe,cleaver,spear,staff,whip,chainSickle,scythe,shield,fan,wand,ringBlades,thrown,warRing}.json`（放出の段の key 付け・裂き `rend` / 叩きつけ `slam` の差し替え・`wound` の applies）、`core/status.ts` + `system/statusEffects.ts`（`wound`。D1）、`balance/combat/STATUS/wound.json`、`system/morale.test.ts` の該当節、`docs/recipes/status.md` に従う | `system/combat.ts`（一蓮托生 1 か所。D1）、`system/weaponArts.ts`（`recallShots` の倍率 1 行。D2）、`system/projectiles.ts`（戻りの弾 × 敵弾 = recallCut 1 か所。D2）、`system/enemies.ts`（`Enemy.linked` の初期化・減衰 各 1 行。D1）| `player.ts`（A が入れた口だけ使う）|
| **E 銃の型 3**（短銃・砲。長銃は 5a）| `data/weaponForms.ts` の該当型、`FORM/{pistol,artillery}.json`、`movesets/{sidearm,gunner,cannon,grenade,trapper}.json`、`system/morale.test.ts` の該当節 | `system/player.ts`（`canShootNow` に装填の窓 1 行、`pressSecondary` に強装填 1 分岐、`emitVolley` の shotFired 1 行）、`system/weaponArts.ts`（`detonateOwnMines` の戻り値 = 数）| D のファイル |
| **F 連刃の段数**（Sonnet）| `movesets/{twinBlades,claws,fists}.json`（6/8/6 段 + 右 + 乱舞 `frenzy` + 派生の `next`）、`data/weapons.ts` `STEP2_NAMES`、`ui/scalingText.ts`（同じ式の段の畳み）、`render/detailPane.test.ts`、`data/weapons.test.ts`（幅・EXPECTED）、`data/scalingVariety.test.ts`、`data/meleeReach.test.ts`、`system/player.test.ts`（段数の固定値）| `render/comboUi.ts`（ピップの間隔）、`render/fxMotions.test.ts`（未描画の許容リスト。G が消す）| `player.ts` |
| **G 連刃の fx**（fx。F の JSON が決まってから）| `scripts/fx/sheets/{twinBlades,claws,fists}.mjs`、`ppnpm run fx:gen --atlas <key>` の生成物（`data/fx/*.gen.json` `public/assets/fx/`）、`render/fxMotions.test.ts` の許容リストを消す | — | 本体 |
| **H 重さの補償**（balance-tuner Opus。A〜F の後）| `balance/weapons/WEAPON/weightClass.json`（補償の 3 項目の追加は A が型と口を入れる: `scaleStep` knockback / `meleeHitEnemy` guardBreak）、各 `movesets/*.json` の数値、`src/qa/probe.md` | — | コード |
- 統合役: `REPLAY_VERSION` 19、`pnpm run qa:probe`、6 章の指標で H に渡す

### 5c. 改鋳と流儀（遊べる: ボス後に改鋳 3 択、ジョブでダッシュと気力の湧き方が変わる）
| レーン | 所有 | 最小 Edit | 編集禁止 |
| --- | --- | --- | --- |
| **J 改鋳**（Opus implementer）| 新規 `data/reforges.ts`（15 型 × 2）、`system/reforge.ts` + test、`balance/weapons/REFORGE/*`、`render/reforgeUi.ts`（`boonUi` のカード描きを見出し付きで呼ぶ）、`docs/GLOSSARY.md` の改鋳名 | `core/state.ts`（`reforges` `reforgeChoice`）、`core/game.ts`（`step` の `boonChoice` の隣に `updateReforgeChoice`）、`system/boss.ts` か `floorLord.ts`（major 撃破で `offerReforges` 1 行）、`system/player.ts`（`playerMoveset` に `withReforges` 1 行）、`system/morale.ts`（flag の読み 2〜3 か所）、`render/renderer.ts`（1 行）、`main.ts`（選択中の入力の扱いは boonChoice と同じ経路なら不要。要確認）| `data/jobs.ts` |
| **K 流儀**（Opus implementer）| `data/jobs.ts`（dash / mana、favored / weakness 削除）、`system/jobs.ts`、新規 `system/dashForms.ts` `system/manaSources.ts` + test、`balance/jobs/{DASH_FORM,MANA_SOURCE}.json` `JOB.json`、`jobs.test.ts`、`ui/origin.ts` の説明行（`jobDetailLines`）、`docs/recipes/job.md` | `system/player.ts`（`tryDash` の分岐を `runDashForm` に、`gainMeleeMana` → `onManaSource`、`canDashCancel` の剣士の例外 1 行、射撃の `onShot`）、`system/combat.ts`（backstab / rangedHitFar / 結界の被ダメ）、`skills/hit.ts`（skillHit / minionHit）、`system/statusEffects.ts`（statusTick）、`system/statusReactions.ts`（reaction）、`system/rules.ts:251`（boonFired）、`system/modifiers.ts`（`jobModifiers` の呼び出しを外す）、`core/rules.ts`（`favoredWeapon` 条件の削除は段取り 7 の祝福整理と同時でもよい。今は未使用のまま残す）| `data/weaponForms.ts` |
- 統合役: `REPLAY_VERSION` 20

### 5d. 書・鈴・陰陽師・巫女（遊べる: 新武器種 2・新流儀 2）
| レーン | 所有 | 最小 Edit |
| --- | --- | --- |
| **L 書・鈴のデータ**（Sonnet）| `movesets/{tome,bell}.json`、`data/weapons.ts`（`MOVESET_KEYS` +2・spec 2・名前表）、`data/weaponForms.ts`（tome / bell）、`FORM/{tome,bell}.json`、`loot/bases.ts` + `balance/loot/bases.json`（ベース 4）、`data/ultimates.ts`（2 Set + `SET_BUILDERS`）+ `balance/ultimates/ULTIMATE/defs/{tome,bell}.json`、`skills/arts/keys.ts`（空配列）+ `arts.test.ts` 除外、`Record<MovesetKey>` の 1 行ずつ（`effects.ts` `renderMath.ts` `weaponHitNames.ts` `weaponHits.ts` `sprites/weapons.ts` は既存の絵・音を流用）| `system/skills.ts`（`freeCast` の消費・`skillCooldownMul`・`bellBuff`）、`skills/placed.ts` `skills/summons.ts`（打ち鳴らしの即発動・命令 各 1 関数）|
| **M 持ち手の絵**（pixel-artist）| `data/sprites/weapons.ts` の `HELD` 2 件、`WEAPON_EDGE`、`scripts/actor/` の武器の生成一覧、`render/sprites.test.ts` | — |
| **N fx**（fx）| `scripts/fx/sheets/{tome,bell,tomeUlt,bellUlt}.mjs` + 生成物 | — |
| **O 陰陽師・巫女**（Sonnet。K の後）| `data/jobs.ts`（2 ジョブ）、`balance/jobs/*`、`system/dashForms.ts`（swap / ward）、`system/manaSources.ts`（minionHit / boonFired）、`jobs.test.ts`、`meta/quests.ts`（解放の依頼を割り当てるなら）| `system/rules.ts`（boonFired は K が入れる）|
- 統合役: `REPLAY_VERSION` 21、`pnpm run qa:full`

### 資料に必要な変更（統合役）
`docs/recipes/weapon.md`（3-10 の形に書き直し）/ `job.md`（dash / mana）、`docs/CODE_MAP.md`（`weaponForms.ts` `morale.ts` `moments.ts` `reforge.ts` `dashForms.ts` `manaSources.ts` `moraleHud.ts` `reforgeUi.ts`、`FORM/` `REFORGE/`）、`docs/ARCHITECTURE.md`（版・戦意はラン内・改鋳は入力で決定）、`docs/GLOSSARY.md`（型名 15・戦意の名 15・放出の段名・改鋳名 30・流儀のダッシュ名）、`docs/BALANCE.md`（`weapons/FORM` `REFORGE` `MOMENT` `jobs/DASH_FORM` `MANA_SOURCE`）、`docs/COMBAT_DESIGN.md` A-7 / A-9、`IDEAS.md` 現状、`scripts/audit-agent-docs.mjs` の件数

---

## 6. 調整つまみと測る指標

物差しは `pnpm run qa:probe`（5a の C で武器種の軸を足す）。**bot は `mashDodge`（連打+ダッシュ）**、敵は slime（並）・knight（堅守）・eye（射手）、深度 1 / 5、60 秒 × seed 3。

| 目標 | 指標 | つまみ（優先順）|
| --- | --- | --- |
| 型どうしの釣り合い: 撃破秒が中央値 ±20%、被弾/60 秒が ±30% | 武器種 × 敵の表の「撃破秒」「被弾/60 秒」 | `weightClass.heavy.damageMul / poiseMul`（重が遅く安全でないなら上げる）→ `FORM.<型>.perUnit`（放出の強さ）→ `movesets/*.json` の段 → `weightClass.*.recoverMul` |
| 戦意が回る: 放出が 60 秒に 3〜8 回（型による。導出型は「充溢の秒の割合」）| 「放出/60 秒」「充溢%」（C が追加）| `FORM.<型>.max` → `gainAmount` → `decay` |
| 応手が起きる: 応手/60 秒が剣・盾で 5 以上（bot が受け流しを狙う `PARRY_CHANCE`）| 「応手/60 秒」 | `PARRY.windowSec`（既存）→ `FORM.blade.releaseMin` |
| 連刃: 手を止めない = 熱の冷めで放出が減らない | 連刃 3 種の放出回数が同じ深度の剣以上 | `FORM.flurry.decayDelaySec`（1.2）→ `decayPerSec` |
| 気力（5c）: 流儀ごとにスキル由来与ダメ比率が割れる（術士 60% 以上、拳闘士 40% 以下）| フル QA の「スキル由来与ダメ比率」をジョブ別に（`simulation.test.ts` の集計にジョブの軸。qa-runner）| `MANA_SOURCE.<流儀>.*` → `JOB.manaBaseMul`（0.35）|
| ダッシュの形が被弾を変える | 流儀 × `mashDodge` の被弾/60 秒 | `DASH_FORM.<形>.invulnMul / distanceMul` |
| 手触り（数値で測れない）| 手動: 重い武器で振る時機を読む・連刃で張り付く・短銃の装填の拍 | `weightClass.*.lockRecoverRatio`、`FORM.pistol.reload.*` |

---

## 7. 不確かな点（推奨を 1 つ決めて書く）

1. **【ユーザー確認 1】武器種を 27 のまま残し、型を上に足す**（推奨）。手持ちの遺物・武器種名・絵・奥義は全部そのまま。「剣と刀は同じ戦意（返し）」になる。代案の 13 への統合は遺物の見た目が消え移行が要る
2. **【ユーザー確認 2】流儀で得意武器の倍率と弱点を削る**（推奨。build-core 柱 2）。既存ジョブの手触りが「ダッシュの形 + 気力の源」に置き換わる。気力の下地 35% は保険として残す
3. **【ユーザー確認 3】短銃の弾倉と装填**: 左押しっぱなしの手触りに 0.6 秒の装填が入る。推奨は入れる（型の個性がこれだけ）。嫌なら `reload.windowSec 0` で無効化できるつまみにする
4. **【ユーザー確認 4】陰陽師・巫女の解放**: 推奨は既定解放（依頼の追加は段取り 9）
5. **【ユーザー確認 6】新語**: 型名（剣・連刃・重打・刃斧・長柄・鎖・盾・扇・杖・投具・短銃・長銃・砲・書・鈴）、戦意の名、放出の段名（乱舞・裂き・叩きつけ・無詠唱・打ち鳴らし）、書・鈴のベース名。付ける前に `src/` と GLOSSARY を grep（「叩きつけ」は既存の派生・奥義と衝突しないか）
6. **重さの既定から外れる武器種**（flail 中 / grenade・trapper 中 / fan 軽）: 推奨は個性として今の値を残す。3-2 の表に揃えるなら `weight` を 1 語ずつ
7. **連刃の段数**: 双剣 6・拳 6・爪 8 を推奨。計算式の頁の畳みが要る（F）。溢れたら爪を 7 に
8. **先制の定義**: 「交戦の外で 1.5 秒待った後の最初の一撃」を推奨（陣の phase に依存しないので通路の徘徊にも効く）。陣の `sleeping` を条件にする案は眠っている陣を殴らないと出ないので却下
9. **放出の消費は振りの開始**（空振りでも消える）を推奨。命中で消す案は「当たるまで振り続ける」で放つ時機を読まなくなる
10. **改鋳の出所**: 今は 5 の倍数の階のボス撃破直後。章（段取り 6）が入ったら出口へ。`REFORGE.perRun` で回数を縛る
11. **応手の 6 語の EventKind と既存の `onCounter` / `onJustDodge` の二重発火**: 既存の祝福・ジョブ Rule を壊さないため両方出す。段取り 7 で祝福を `onRiposte` に寄せてから既存を減らす
12. **確認方法**: 各段の終わりに `pnpm run check` → `pnpm run qa:probe` で 6 章の表 → 剣・双剣・大剣・長銃・拳銃を `pnpm run dev` で手動（充溢の浮き文字と放出の倍率が見えるか、装填の拍が押せるか）
13. **`boonChoice` 中の入力は `main.ts` を通らず step の中で読む**（`updateBoonChoice`）ので改鋳も同じ経路で `main.ts` は無変更のはず。J が `core/game.ts` の `step` を読んで確認する
