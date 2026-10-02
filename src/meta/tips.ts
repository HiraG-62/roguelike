import { type Keybinds, SKILL_ACTIONS, keyLabel, moveKeyLabel } from "../core/input";
import { padActionLabel, padSkillKeysLabel } from "../core/padBinds";
import { ACTION, CARRY, DEEP, ECONOMY, MANA, META, PARRY, POISE, REACH, REFORGE, RESONANCE, STATUS, WEAPON } from "../data/tuning";
import { FORMS, FORM_KEYS } from "../data/weaponForms";
import { MOVESETS, MOVESET_KEYS } from "../data/weapons";
import { UNIQUES } from "../loot/named";
import { ATTR_LABEL, type AttrKey } from "../loot/types";
import { WEAR_TUNING } from "../skills/tuning2";
import type { ListEntry, ListTab } from "./listScreen";

/**
 * Tips ノート: 用語とシステムの説明の置き場。UI（ツールチップ・ヘルプ・ログ・一覧の案内）には説明を書かず、
 * 仕組みの「なぜ・どうなる」はここへ集める（docs/GLOSSARY.md の語と同じ表記）。
 * 操作の項目はキー設定どおりの表記にするため、本文を束縛表から組む
 */

export const TIP_CATEGORIES = ["controls", "combat", "growth", "relic", "skill", "run", "hub"] as const;
export type TipCategory = (typeof TIP_CATEGORIES)[number];

export const TIP_CATEGORY_LABEL: Readonly<Record<TipCategory, string>> = {
  controls: "操作",
  combat: "戦い",
  growth: "育成",
  relic: "遺物",
  skill: "スキル",
  run: "探索",
  hub: "拠点",
};

export interface TipEntry {
  key: string;
  /** 見出しの語（docs/GLOSSARY.md にある表記） */
  term: string;
  body: string;
  category: TipCategory;
}

interface TipDef {
  key: string;
  term: string;
  category: TipCategory;
  /** 操作の項目はキー表記を束縛表から組む */
  body: string | ((binds: Keybinds | undefined) => string);
}

/** 束縛表を指定したキー表記（undefined なら現在の表） */
function k(binds: Keybinds | undefined, action: Parameters<typeof keyLabel>[0], first = false): string {
  return keyLabel(action, { binds, first });
}

const PERCENT = 100;

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

/** 戦意のゲージの名の一覧（「剣 応報・連刃 熱…」。武器種の言い換え〔棍の棒先〕は後ろに足す）。型の定義から組む */
function moraleLabels(): string {
  const forms = FORM_KEYS.filter((f) => FORMS[f].morale.gain.length > 0).map((f) => `${FORMS[f].name} ${FORMS[f].morale.label}`);
  const renamed = MOVESET_KEYS.flatMap((k) => {
    const label = MOVESETS[k].moraleLabel;
    return label === undefined ? [] : [`${MOVESETS[k].name}は${label}`];
  });
  return renamed.length > 0 ? `${forms.join("・")}。${renamed.join("、")}` : forms.join("・");
}

/** 武器の型の名の一覧（剣・連刃・…） */
function formNames(): string {
  return FORM_KEYS.map((f) => FORMS[f].name).join("・");
}

/** 武器の重さの説明（WEAPON.weightClass の数値から） */
function weightBody(): string {
  const heavy = WEAPON.weightClass.heavy;
  const guard = heavy.finisherGuardBreak ? "、終撃が堅守を崩す" : "";
  return (
    "武器種ごとの軽・中・重。振りの出だしはどの重さもダッシュで切れない。軽は攻撃中も動け、当たっている最中でもダッシュで切れる。中は攻撃中の足が遅く、終撃で足を止め、当たっている間はダッシュで切れない。" +
    `重は振る間止まり、硬直の前半もダッシュで切れないが、威力 ×${heavy.damageMul}・怯み値 ×${heavy.poiseMul}で、終撃が大きく押し返す${guard}。`
  );
}

function skillKeys(binds: Keybinds | undefined): string {
  return SKILL_ACTIONS.map((a, i) => `スキル ${i + 1}: ${keyLabel(a, { binds })}`).join("、");
}

const CONTROL_TIPS: readonly TipDef[] = [
  { key: "move", term: "移動", category: "controls", body: (b) => `${moveKeyLabel(b)} で移動する。マウスの位置が狙う向き。` },
  { key: "dash", term: "ダッシュ", category: "controls", body: (b) => `${k(b, "dash")}。出だしに無敵がある。回数は HUD の点で、時間で戻る。` },
  { key: "attack1", term: "攻撃 1", category: "controls", body: (b) => `${k(b, "attack")}。武器種ごとの左の連撃。銃の家系なら射撃。` },
  { key: "attack2", term: "攻撃 2", category: "controls", body: (b) => `${k(b, "shoot")}。全武器種に共通の右の連撃。左右の押し方の列でコンボ派生が出る。` },
  { key: "special", term: "奥義", category: "controls", body: (b) => `${k(b, "special")}。奥義ゲージが満ちると出せる。持続の奥義はもう一度 ${k(b, "special")} で終える。武器種ごとの 3 本から装備画面の装束の人影の書付、奥義の頁で選ぶ（拠点のみ）。` },
  { key: "parry", term: "受け流し", category: "controls", body: (b) => `${k(b, "parry")}（パッドは ${padActionLabel("parry")}）。振っていなければいつでも出せる。窓（${PARRY.windowSec} 秒）の間の被弾を無効にして相手を怯ませ、予備動作を終えた攻撃も止められる。外すと ${PARRY.recoverSec} 秒の間、攻撃もダッシュもできない。` },
  { key: "skillKeys", term: "スキル石", category: "controls", body: (b) => `${skillKeys(b)}。パッドは ${padSkillKeysLabel()}（+ は押さえたまま次を押す）。` },
  { key: "interact", term: "拾う", category: "controls", body: (b) => `${k(b, "interact")}。注目している床の遺物を袋へ、スキル石を倉庫へ入れる。商人の品・契約者の台座・部屋の台座も、照準を合わせてこのキーで買う・選ぶ・使う。手の届く距離のものだけ。ハート・刻印符は触れれば拾い、上り階段は乗り続けると使う。` },
  { key: "flask", term: "瓶", category: "controls", body: (b) => `${k(b, "flask")}（パッドは ${padActionLabel("flask")}）。1 本飲むと最大生命の ${Math.round(ECONOMY.flask.healRatio * PERCENT)}% が戻る。戦闘中の回復の上限は通さない。ダッシュ中と、攻撃を振っている最中は飲めない。本数は HUD の枡で、上限までしか持てない。市で買え、章の境の泉で満ちる。` },
  { key: "inventory", term: "装備画面", category: "controls", body: (b) => `${k(b, "inventory")} で開き、開いている間にもう一度押すと装束と紋を行き来する。Esc で 1 段ずつ戻って閉じる。開いている間は時間が止まる。` },
  {
    key: "attire",
    term: "装束",
    category: "controls",
    body: "装備画面の体の面。人影の周りの 6 部位と腰のスキル石から着る物を選ぶ。部位を指すと、右の紋の写しでその遺物の珠が光り、外すと細る帯が点滅する。部位を選ぶと候補が並ぶ。",
  },
  {
    key: "crest",
    term: "紋",
    category: "controls",
    body: "装備画面の系統の面。帯が系統で、太く速く光るほど段が高い。帯の左に源、右に糧の出どころが珠で並び、右上が強め。珠を選ぶと、その物を着ている部位・スキル・加護の頁へ跳ぶ。帯を選ぶと、その系統に触れる物だけの頁が開く。",
  },
  {
    key: "sheet",
    term: "書付",
    category: "controls",
    body: (b) =>
      `${k(b, "interact")} で、焦点の物の全文と数字の頁を開く。候補からは候補と今の見開き、人影からは体の書付（体: ステータス・体の性能・行動の計算式、内訳: ステータスを参照する行動と攻撃に掛かる増と倍、奥義）。倉庫の遺物の書付の下端から鍛冶の操作ができる。`,
  },
  { key: "dropInfo", term: "アイテム情報", category: "controls", body: (b) => `${k(b, "toggleDropInfo")} で床のアイテムの性能表示を切り替える。` },
  { key: "restart", term: "やり直す", category: "controls", body: (b) => `${k(b, "restart")} で新しいシードの探索をやり直す。` },
  {
    key: "weaponManual",
    term: "武器指南書",
    category: "controls",
    body: "タイトルの記録とポーズから開く。武器種ごとの特色・型と戦意・技の一覧（連撃・右の段・コンボ派生・ダッシュ攻撃・溜め攻撃・戦意の放出・奥義）を載せる。技を選ぶと横の窓で、その技の入力どおりに木人へ打ち込む実演が流れ、入力の列の今の手が光る。",
  },
  { key: "keybinds", term: "キー設定", category: "controls", body: "設定 → キー設定で、アクションごとに主 / 副 / 予備の 3 つまで割り当てられる。画面の案内の表記もこれに合わせて変わる。" },
  { key: "hitstopDaily", term: "ヒットストップ", category: "controls", body: "設定のヒットストップの強さは、今日の挑戦では既定値で固定される（記録を競うため）。" },
  { key: "padBinds", term: "パッド設定", category: "controls", body: "設定 → パッド設定で、ゲームパッドのボタンを割り当て直せる。ボタンを押さえたまま別のボタンを押すと「LB+A」のような組み合わせになる。左スティック・十字キーの移動、A の決定、B の戻る、Start のポーズは固定。" },
  { key: "padAim", term: "パッドの照準", category: "controls", body: "右スティックを倒した方向を狙う。離すと移動の向きを狙う（マウスカーソルの位置には戻らない）。マウスを動かすかクリックすると、マウスの照準に戻る。" },
];

const COMBAT_TIPS: readonly TipDef[] = [
  { key: "hp", term: "生命", category: "combat", body: "尽きると探索が終わる。戦闘中の回復には 1 秒あたりの上限がある。" },
  { key: "mana", term: "気力", category: "combat", body: "スキルの資源。見切り・受け流しで多く戻り、通常攻撃の命中・撃破でも少し溜まり、スキルで減る。自然にはゆっくりしか戻らないので、減ったら攻めるか読んで取り戻す。ジョブごとの気力の源（剣士は応手と終撃など）・輪廻の祝福・芯「気の泉」・気力の性質で伸ばせる。" },
  {
    key: "morale",
    term: "戦意",
    category: "combat",
    body:
      `武器の型ごとのゲージ。気力バーの隣に型ごとの名で出る（${moraleLabels()}）。` +
      "型ごとの出来事（剣は応手、連刃は命中、長柄は先端の命中、長銃は足を止めている間など）で溜まるか、刃斧の傷・鎖の繋ぎ・砲の置いた弾のように今の数がそのまま戦意になる。" +
      "放出の段（型ごとに違う。武器種タブの各武器に書いてある）を振ると、その一撃が戦意の量だけ強くなる。右の段が放出の型は、右の予告に「（放出）」と付く。" +
      "バーが点滅している間が放てる量。空振りしても使われる。武器種を持ち替えると空に戻る。",
  },
  {
    key: "moments",
    term: "共通の瞬間",
    category: "combat",
    body: "どの型でも起きる 6 つの瞬間。先制は交戦の外で少し待った後の最初の一撃、終撃は連撃の締めや最大の溜めなど型ごとの締めの一撃、充溢は戦意が満ちたとき、放出は戦意を使ったとき、応手は受け流し・見切り・弾返しなど型ごとの受けの成功、双撃は左右を交互に当てたとき。先制・充溢・放出・双撃は浮き文字で出る。応手は既存の「受け流し」「見切り！」「カウンター」の表示のまま。",
  },
  {
    key: "weaponForm",
    term: "武器の型",
    category: "combat",
    body: `武器種を束ねる ${FORM_KEYS.length} の型（${formNames()}）。型ごとに戦意の溜まり方と放出の段・応手になる出来事・終撃・重さの既定が決まり、共通技の形も型で変わる。同じ型の武器種は同じ戦意を持つ。武器種タブに各武器の型が書いてある。`,
  },
  { key: "weaponWeight", term: "武器の重さ", category: "combat", body: weightBody() },
  {
    key: "reforge",
    term: "改鋳",
    category: "combat",
    body: `章の主（5 の倍数の階のボス）を倒すと出る ${REFORGE.offerCount} 択（1 回の探索で ${REFORGE.perRun} 回まで）。武器の型の動きそのものを書き換える。今の型の札が先に並び、合わない型の札は、その型の武器種に持ち替えると効く。その探索の間だけ。`,
  },
  { key: "energy", term: "奥義ゲージ", category: "combat", body: "攻撃を当てると溜まる。満ちると枠が点滅し、奥義を出せる。持続の奥義の間は色が変わり、減っていく。" },
  { key: "justDodge", term: "見切り", category: "combat", body: "ダッシュの無敵中に攻撃を受けて避けた瞬間。時間がゆっくりになり、奥義ゲージが増え、気力が戻る。" },
  { key: "rightChain", term: "右の連撃", category: "combat", body: "攻撃 2 で出す連撃。段の中身は武器種ごとに違う。" },
  { key: "branch", term: "コンボ派生", category: "combat", body: "左右の押し方の列で差し替わる技。連撃がそこで終わるものもある。ジョブ固有の派生もある。" },
  { key: "charge", term: "溜め攻撃", category: "combat", body: "溜めの役割のボタンを長押しして離す近接。長く溜めるほど段が上がる。" },
  { key: "stagger", term: "怯み", category: "combat", body: "攻撃の怯み値が敵の怯み耐性を超えると付く行動停止。解けた直後は堅守が付く。" },
  {
    key: "guarded",
    term: "堅守",
    category: "combat",
    body: `怯みが解けた直後の状態（${POISE.guardedTime} 秒、ボスは ${POISE.bossGuardedTime} 秒）。受ける怯み値が ×${POISE.guardedMul}（ボスは ×${POISE.bossGuardedMul}）になる。背面の一撃は堅守を無視する。`,
  },
  {
    key: "inkTelegraph",
    term: "下絵と墨入れ",
    category: "combat",
    body: (b) =>
      `敵の攻撃は、薄墨の淡く掠れた帯（下絵）から始まる。下絵の間は殴って崩せる。当てるほど帯が掠れ、崩すと擦れて消える。やがて帯が白く縁取られた真っ黒な一筆（墨入れ）に変わり、入りに朱の点が付く。頭の上の印も薄墨の輪（○）から朱の芯の黒い玉（●）になり、体が朱に明滅する。墨入れの後は必ず来る。止められるのは受け流し（${k(b, "parry")}）だけで、受け流すと筆先が逸れる。範囲の予告は内側も墨で塗られ、下絵の間は淡い網目、墨入れで黒いむらになる。範囲の予告も下絵の間は崩せて、墨入れになれば避けるか受け流す。`,
  },
  {
    key: "debana",
    term: "出端",
    category: "combat",
    body: `敵の予告が下絵の間に振り始めた近接、または撃った放出の弾が当たると出端になる。命中の時に墨入れへ変わっていても取れる。ダメージ ×${ACTION.counter.damageMul}・怯み値 ×${ACTION.counter.poiseMul}・気力の回収 ×${MANA.onCounterMul}で、盾騎士の正面の守りも割り、命中が少し長く止まる。墨入れの間に振り始めた一撃は普通の命中で、鈍い音が鳴る。墨入れの攻撃は止まらず、技の後で怯む。`,
  },
  {
    key: "counter",
    term: "カウンター",
    category: "combat",
    body: "出端と受け流しの総称。成立すると起点「カウンター時」・共鳴の語「カウンター」が働く。",
  },
  { key: "regain", term: "リゲイン", category: "combat", body: "被弾してしばらくの間、近接を当てると失った生命を取り戻せる。" },
  { key: "status", term: "状態異常", category: "combat", body: "敵にも自分にも付く。同じものを積み切ると上位の状態へ昇華する。体力が高いほど自分に付いたものが早く切れる。" },
  { key: "reaction", term: "反応", category: "combat", body: "2 つの状態異常（か地形）が出会ったときの追加効果。図鑑の連携の頁に記録される。" },
  {
    key: "inkMark",
    term: "墨印",
    category: "combat",
    body: `書の左の 3 段（飛ぶ字「墨文字」）が記す印（最大 ${STATUS.inkMark.maxStacks}）。墨文字は記すだけで読まない。ほかの射撃かスキルが当たると読まれ（読誦）、その敵を中心に重ねの数だけ広い円の中の敵すべてに当たり、気力が戻る。倒した一撃でも読む。烙印と違い、1 体ではなく周りへ広がる。`,
  },
  { key: "terrain", term: "地形", category: "combat", body: "床に重なる層（水たまり・油・溶岩・氷床など）。自分にも敵にも効く。" },
  { key: "warding", term: "魔防", category: "combat", body: "魔法の攻撃の軽減。属性耐性とは別の軸で、両方掛かる（混成は防御力と魔防の平均）。" },
  {
    key: "aimLock",
    term: "狙いの固まり",
    category: "combat",
    body: "敵の予告の線は、下絵の間はこちらを追い、墨入れの途中で向きが決まる。向きが決まった後に横へ動けば外れる。砲台のように、攻撃の瞬間まで狙い続ける敵もいる。",
  },
  {
    key: "telegraphDiagram",
    term: "予告の図解",
    category: "combat",
    body: `同じ敵に ${META.diagramDeaths} 回倒されると、図鑑の敵の頁から開ける。その敵の予告の形・怯ませられる間とコミットの境・隙・安全な場所を、敵のデータから描く。`,
  },
];

/** ステータス 6 種の体の性能（装備画面の ？ のヘルプから移した） */
const ATTR_TIP_BODY: Readonly<Record<AttrKey, string>> = {
  str: "体の性能は持たない。係数で参照する行動（武器種の段・スキルなど）の威力・怯み値が伸びる。",
  dex: "移動速度・ダッシュの再使用時間と、係数で参照する行動が伸びる。",
  vit: "最大生命が伸び、自分に付いた状態異常が早く切れる。係数で参照する行動も伸びる。",
  mnd: "最大気力・気力の自然回復と、係数で参照する行動が伸びる。",
  spi: "体の性能は持たない。係数で参照する行動の威力・怯み値・状態異常や強化の効果量が伸びる。",
  def: "防御力・魔防が伸び、係数で参照する行動（盾の技・反撃系のスキルなど）も伸びる。",
};

const ATTR_ORDER: readonly AttrKey[] = ["str", "dex", "vit", "mnd", "spi", "def"];

const GROWTH_TIPS: readonly TipDef[] = [
  { key: "attributes", term: "ステータス", category: "growth", body: "筋力・技巧・体力・精神・霊力・防御の 6 つ。装備の地金などで上がり、技の威力や体の性能に効く。" },
  ...ATTR_ORDER.map((a): TipDef => ({ key: `attr_${a}`, term: ATTR_LABEL[a], category: "growth", body: ATTR_TIP_BODY[a] })),
  { key: "effective", term: "実効値", category: "growth", body: "ステータスに逓減を掛けた計算用の値。高く積むほど 1 点あたりの伸びが小さくなる。" },
  {
    key: "formula",
    term: "計算式",
    category: "growth",
    body: "「威力 18 = 10+筋力×1.3+技巧×0.2」は、ステータス 0 のとき 10、実効値 1 点ごとに筋力は 1.3・技巧は 0.2 増えるという意味。左の数は今のステータスでの基礎の値で、装備の増と倍・刻印符・祝福・敵の防御はこの後に掛かる。参照の無い行動はステータスで変わらない。",
  },
  {
    key: "increased",
    term: "増",
    category: "growth",
    body: "性質・地金が上げる与ダメージ。1 撃に効く増はすべて足してから 1 回掛かる（近接 +50% と怯み中 +50% なら 2 倍）。積むほど 1 つあたりの伸びは小さくなる。",
  },
  {
    key: "more",
    term: "倍",
    category: "growth",
    body: "誓約・共鳴・芯・会心・コンボなどが掛ける与ダメージ。増とは別に、出所ごとに掛け合わさる（×1.5 と ×1.5 なら 2.25 倍）。同じ出所は 2 つ持っても 1 回だけ。",
  },
  { key: "job", term: "ジョブ", category: "growth", body: "起点とは別に選ぶ戦い方（流儀）。ステータスの偏り・ダッシュの形・気力の源・固有のルール・初期スキル石を持つ。最初は見習いだけで、依頼の報酬で増える。" },
  { key: "dashForm", term: "ダッシュの形", category: "growth", body: "ジョブごとのダッシュ。詰め足は振りの途中でも出せて連撃が続き、退き足は後ろへ跳んで足元に罠を残し、不退はその場で構えて受け止める。" },
  { key: "manaSource", term: "気力の源", category: "growth", body: "ジョブごとに気力が多く湧く出来事。剣士は応手と終撃、狩人は遠い命中、術士はスキルの命中など。通常攻撃の命中でも少しは湧く。" },
  { key: "starterWeapon", term: "初期武器", category: "growth", body: "ジョブの初期の武器種の素の器。同じベースを持っていなければ、出撃のときに渡される。遺物の来歴では、同じ型の武器での撃破も数える。" },
  { key: "starterSkill", term: "初期スキル石", category: "growth", body: "ジョブのスキル石。そのスキルの石を持っていなければ、出撃のときに倉庫に入る。" },
];

const RELIC_TIPS: readonly TipDef[] = [
  { key: "relic", term: "遺物", category: "relic", body: "装備アイテム。右手・頭・体・足・指輪・首飾りの 6 部位。" },
  { key: "trait", term: "性質", category: "relic", body: "遺物に宿る 1 つの効果。それぞれが響き（色）を持つ。" },
  { key: "innate", term: "地金", category: "relic", body: "遺物に既定で宿るステータス・防御力・属性耐性。持ち込んだ遺物の地金は、今いる階の深さに合わせて伸びる。拾った時の配分と上振れはそのまま。" },
  {
    key: "reach",
    term: "到達",
    category: "relic",
    body:
      "遺物の性質を同じ向きに重ね、装備だけで数えた量が閾値に届くと、その軸の決まりが 1 つ変わる。" +
      `無尽（連鎖係数 +${Math.round(REACH.chain * PERCENT)}%）: 連鎖が衰えない。` +
      `燎原（燃焼の重ねの上限 +${REACH.burn}）: 燃焼が際限なく重なる。` +
      `常在（戦意の上限 +${REACH.morale}）: 戦意が冷めない。` +
      "祝福では届かない。深い階で拾った遺物ほど性質が強い。",
  },
  { key: "flux", term: "揺らぎ", category: "relic", body: "性質の値の、期待値からのずれ。静・揺・荒は揺らぎの見た目の分類で、格付けではない。" },
  { key: "inverted", term: "反転", category: "relic", body: "揺らぎが強く裏返った性質。色は冥になり、効果も裏返る。共鳴の数えには入らない。" },
  { key: "hue", term: "響き", category: "relic", body: "性質が持つ 5 色（紅・蒼・翠・金・冥）。反対色は紅と蒼、翠と金。遺物の色の帯や残響の色になる。共鳴には関わらない。" },
  {
    key: "resonance",
    term: "共鳴",
    category: "relic",
    body:
      `同じ系統（燃焼系・近接系など）の源が ${RESONANCE.minSources} つ以上、糧が ${RESONANCE.minSinks} つ以上そろうと、その系統が共鳴して段が立つ。` +
      "遺物・スキル石・祝福・流儀・武器の型・改鋳・誓約をそれぞれ 1 つと数える。" +
      `源と糧が増えるほど、強めるものがあるほど段が上がる（上限 ${RESONANCE.maxSteps}）。` +
      "段ごとにその系統の与ダメージが伸びる（ダッシュ・見切り・気力・回復・障壁は、その性能が伸びる）。",
  },
  { key: "colorless", term: "無色", category: "relic", body: "旧い遺物に残る、脱色された性質。色を持たない。" },
  { key: "provenance", term: "来歴", category: "relic", body: "装備している間に起きた出来事の記録。節目に達すると芽が出る。" },
  { key: "bud", term: "芽", category: "relic", body: "来歴の節目で出る 2 択の成長。選ばなかった方は失われる。" },
  { key: "margin", term: "余白", category: "relic", body: "その遺物があと何回芽吹けるか。無くなるとそれ以上育たない。" },
  { key: "inscription", term: "銘", category: "relic", body: "余白を使い切った遺物に、来歴から刻まれる名前。銘が付いたら成長は完了。" },
  { key: "named", term: "名のある遺物", category: "relic", body: `固有の効果を持つ遺物（${UNIQUES.length} 種）。効果は名前ごとに違い、性質のほかに固有の仕組みが付く。` },
  { key: "keystone", term: "誓約", category: "relic", body: "遊び方を大きく変える性質。同じ組の誓約は同時に持てない。拠点の社で試せる。" },
  { key: "echo", term: "残響", category: "relic", body: "遺物を砕くと、性質の色の残響を得る。残響を払って性質を作り替える。注ぎ・煽り・移し・呼び戻しは装備中の遺物にも使え、砕くのは倉庫の遺物だけ。" },
  { key: "stir", term: "煽り", category: "relic", body: "性質 1 つの揺らぎを大きく引き直す。反転することもある。" },
  { key: "transfer", term: "移し", category: "relic", body: "銘か芽吹いた性質 1 つを、同じ部位の別の遺物へ移す。元の遺物は失われ、受け手の余白を 1 使う。" },
  { key: "recall", term: "呼び戻し", category: "relic", body: "過去の芽で選ばなかった方を取り直す。代わりに選んでいた方を失う。1 つの遺物に 1 回だけ。" },
  { key: "pour", term: "注ぎ", category: "relic", body: "遺物を捧げ、その来歴の半分を同じ部位の別の遺物へ注ぐ。捧げた遺物は消える。" },
  {
    key: "candidates",
    term: "候補",
    category: "relic",
    body: (b) =>
      `部位を選ぶと並ぶ、その部位の倉庫の遺物（5 枚ずつ）。合は噛み合う順、新は新着順、名は名のある遺物・銘・芽のある物から（${k(b, "parry")} で切り替え）。指すと紋が動いて、太る・ひびが入る・消える・新しく立つ帯を見せる。決定で付け替え、外した物は一覧の先頭に戻る。`,
  },
  {
    key: "undercurrent",
    term: "伏流",
    category: "relic",
    body: "源か糧を持つが、まだ段の立っていない系統。紋の下に破線で描かれ、足りない側の「＋」から、その系統を足せる候補を開ける。",
  },
  { key: "flow", term: "系統", category: "relic", body: "燃焼系・ダッシュ系・瀕死系などの状況のまとまり。源はその状況を起こす側、糧はその状況で強くなる側。源だけなら溢れ、糧だけなら枯れ。" },
];

const SKILL_TIPS: readonly TipDef[] = [
  { key: "stone", term: "スキル石", category: "skill", body: "スロット 1〜4 に装着して撃つスキル。拾った石は倉庫に入り、探索を越えて持ち越す。同じスキルでも石ごとに変異（範囲と威力などの釣り合い）が違い、候補の頁の札の下の段に出る。同じスキルの石は束にまとまり、決定で 1 個ずつ見比べられる。" },
  { key: "dwell", term: "宿り符", category: "skill", body: "まれに刻印符が宿って生まれる石。宿った符はリンクを使わずに効く。深い階ほど出やすい。金の光で落ちる。" },
  { key: "stoneDispose", term: "処分", category: "skill", body: "候補の頁で石を長押しすると処分して冥響を得る（宿り符のある石は多い）。そのスキルを付けているときは、処分する石の使い込みの半分が付けている石へ注がれる。束を長押しすると、宿り符の無い石をまとめて注ぐ。" },
  { key: "stoneWear", term: "使い込み", category: "skill", body: `石を手で撃った回数が ${WEAR_TUNING.milestones.join(" 回・")} 回に届くと、その石に威力の芽が出る。同じ石に出る芽は 1 回の探索で ${WEAR_TUNING.perRunPerStone} つまで。` },
  { key: "commonArt", term: "共通技", category: "skill", body: "どの武器種でも撃てるスキル石。旋風斬り・火球・瞬身のような剣技・魔法・体術。" },
  { key: "artTransform", term: "変形", category: "skill", body: "共通技は今の武器の型で形が変わる。重打なら広く重く、短銃なら振りが弾に、鎖なら当てる前に引き寄せる。今の変わり方は石のツールチップの「今の型」の行。" },
  { key: "manaType", term: "気力型", category: "skill", body: "撃つたびに気力を払うスキル。" },
  { key: "cooldownType", term: "再使用型", category: "skill", body: "撃つと再使用時間が経つまで撃てないスキル。" },
  { key: "rune", term: "刻印符", category: "skill", body: "スキルのスロットに付ける修飾。探索ごとに拾い直す。形を変える変形と、気力・再使用の回し方を変える循環がある。分裂・旋回・重ね打ち・戻り刃・軌跡は共通技にだけ付く。終撃連動・応手連動は武器の終撃・応手と同時にそのスキルを撃つ（気力は払う）。床の符はカーソルを合わせて拾うキーで拾う。拾うと自動では付かず「手持ち」に入る（探索が終わると消える）。装備画面のスキルの頁の下の「手持ち」から符を選ぶと、付けられるスキルが金の破線で光り、決定で付く。付いている符は持ち上げて別の石へ移せ、長押しで外すと手持ちへ戻る。手持ちは種類・系統・付けられる物だけで絞り込み、並びも替えられる。" },
  { key: "link", term: "リンク", category: "skill", body: "スロットごとに決まった、刻印符を付けられる本数（スロット 1 が最も多い）。型替え符は 2 本使い、1 スロットに 1 枚まで。" },
  { key: "combo", term: "連携", category: "skill", body: "スキルの直後に別のスキルを撃つと、後の方が変化する。HUD の枠の点滅する菱形が連携可の印。図鑑の連携の頁は、連携・反応・連鎖を初めて起こすと数える。" },
  { key: "form", term: "変身", category: "skill", body: "一定の間、姿が変わる強化スキル（狼化・霊体化・鉄塊化など）。変身中は左右の攻撃の動きが変わり、他のスキルは撃てない。" },
];

const RUN_TIPS: readonly TipDef[] = [
  { key: "boon", term: "祝福", category: "run", body: "祝福の出口（階段の上の予告）を選んで降りた階で出る 3 択。試練の部屋や契約などでも出る。その探索の間だけ効く。" },
  { key: "boonGrade", term: "祝福の格", category: "run", body: "札ごとに抽選される大祝福・神威。効果量が上がり、範囲も広がる（神威は発動の間隔も縮む）。深いほど出やすい。" },
  { key: "core", term: "芯", category: "run", body: "1 回の探索に 1 つだけ持てる大型の祝福。遊び方を変える効果と代償を持ち、芯と重なる祝福が以後出やすい。" },
  { key: "cursed", term: "呪い付き", category: "run", body: "強い効果と代償を併せ持つ祝福。" },
  { key: "takeCurse", term: "呪いを受けて 4 択", category: "run", body: "祝福の 3 択で呪い付きの祝福を 1 つ受ける代わりに、4 枚目の候補が加わる。" },
  { key: "lineage", term: "系譜", category: "run", body: "祝福の 9 つの筋（灰燼・霜枷・雷鳴・月蝕・大地・刃鳴・輪廻・眷属・財宝）。祝福の出口で系譜を選ぶと、その系譜の札が 3 枚並ぶ。同じ系譜の札を 4 枚持つと真髄が確定で並ぶ。" },
  {
    key: "graceSlots",
    term: "加護",
    category: "run",
    body: "左・右・ダッシュ・スキル・奥義の行動に宿る祝福。1 つの行動に 2 枚まで。満ちた行動の加護を選ぶと、今の加護から 1 枚外すか見送るかを選ぶ。真髄を取ると、その系譜の加護が乗る行動は 3 枚まで。違う 2 系譜の加護が同じ行動に乗ると、次の提示に融合が並ぶ。",
  },
  { key: "temper", term: "錬磨", category: "run", body: "持っている祝福の札を 1 枚選び、格を 1 つ上げる。至高と極致は錬磨でだけ届く。出口の予告の「錬磨」や契約で開く。" },
  { key: "tally", term: "研鑽", category: "run", body: "使うほど育つ祝福の札。倒した数・燃やした数などの数えで、深みでは上限なく伸びる。今の数えは紋の台の系譜から開く書付に出る。" },
  { key: "frostPrison", term: "氷獄", category: "run", body: "霜枷の真髄。凍った敵へ与えた傷が溜まり、砕いたときにその一部がもう一度来る。" },
  { key: "thunderReturn", term: "還雷", category: "run", body: "雷鳴の真髄。連鎖雷が来た道を起点の敵まで戻り、同じ敵にもう一度当たる。" },
  { key: "moonReprieve", term: "執行猶予", category: "run", body: "月蝕の札。被弾の無敵と硬直はその場で起き、生命が減るのは少し後になる。減る前に回復しておけば持ちこたえられる。" },
  { key: "moonTotality", term: "皆既", category: "run", body: "月蝕の真髄。全ての命中で宣告が付く。宣告が明けると、その間に与えた傷の一部がもう一度来る。" },
  { key: "thrall", term: "従魔", category: "run", body: "眷属の札で従えた敵。時間まで他の敵を殴り、こちらの攻撃は当たらない。部屋の制圧には数えない。" },
  { key: "clue", term: "手がかり", category: "run", body: "祝福の 3 択に出る、今のビルドで成立し得る未発見の連携。" },
  { key: "engaged", term: "交戦", category: "run", body: "部屋に入る、または部屋の敵に気付かれた状態。扉が閉じる部屋（封鎖）もある。" },
  {
    key: "jinzu",
    term: "陣図",
    category: "run",
    body: "階に数個だけ立つ本陣は、地図に旗の印が出る。本陣の大将は、軍配を掲げると床に突撃の道を一筆ずつ書く。淡い線のうちに大将を怯ませれば筆が折れ、まだ書かれていない線の隊は来ない。濃く墨の入った線は、大将を怯ませても必ず来る。走ってくる隊の先頭を受け流せば、その隊は詰まる。線から外れた所は安全。大将を討つと旗が倒れ、近くで戦っている陣の群勢も大きく落ちる。群勢が減った本陣は陣図を書けない。",
  },
  { key: "jin", term: "陣", category: "run", body: "敵は陣形（魚鱗・鶴翼・雁行・長蛇など）を組んだ一団で待ち構える。画面上の群勢は仲間を倒すほど減り、大将を倒すと大きく崩れる。尽きると残りは 1 体ずつ逃げるか踏みとどまるかを決める（並ほど逃げ、精鋭はほぼ残る）。踏みとどまった者は背水で攻めが速い。逃げる者は足元に泥を撒き、詰め寄ると振り向いて一撃を返してくる（窮鼠）。倒せば銭を多く落とす。逃がすと眠っている陣に急報が届き、その陣がこちらへ向かってくる。気付くのは近くの者だけで、奥に控えた者は前線が崩れかけると後詰として遅れて加わる。" },
  {
    key: "coins",
    term: "銭",
    category: "run",
    body: `探索の間だけの通貨。敵を倒すと床に散り、${ECONOMY.coin.life} 秒で消える（近くの銭は吸い寄せられる）。被弾すると持ち金の ${pct(ECONOMY.spill.ratio)}% がこぼれる。市・旅商人・契約者・賭け・寄進と、封印庫の解錠に使う。探索が終わると消える。`,
  },
  {
    key: "keys",
    term: "鍵",
    category: "run",
    body: `探索の間だけの 2 つ目の通貨。陣を決着させると落ちることがある（大将のいる陣は ${pct(ECONOMY.key.leaderJinChance)}%、いない陣は ${pct(ECONOMY.key.jinChance)}%）。鍵付きの宝箱は ${ECONOMY.container.lockedChestKeys} 本、封印庫は ${ECONOMY.container.vaultKeys} 本で開く。市でも買える。`,
  },
  {
    key: "market",
    term: "商人 / 市",
    category: "run",
    body: `毎階の前室に立つ商人の店（瓶・遺物・刻印符・鍵・仕入れ直し）。章の主の階には章の市が立つ。品は照準を合わせてインタラクトで買う。商人は近くに敵がいる間は攻撃を受け流し、巻き添えでも傷つかない。敵のいないところで殴ると 1 発目は警告で、続けて殴ると怒って品を投げる。倒すと品が床に落ちるが、その探索の値段は ${ECONOMY.market.outlawPriceMul} 倍になる。旅商人は階を歩き、近くの敵を倒して助けると値引きしてくれる。隠し部屋を開くと奥に闇市が立つ。`,
  },
  { key: "bets", term: "賭け", category: "run", body: "賭場の主に銭を張る。運の賭けは張った瞬間に決まり、腕の賭け（無傷・速攻・凌ぎ）は次の陣や階の出来で決まる。張れるのは 1 つだけで、張ったら取り消せない。" },
  { key: "donation", term: "寄進", category: "run", body: "章の境（章の 1 階目）の開始部屋にある祠を使うたび、持ち金の一部を納める。全額まで繰り返せる。探索の中での効果は無く、総額は拠点の井戸に記録される。" },
  { key: "contractor", term: "契約者", category: "run", body: (b) => `階の入口に立つ人物。台座に照準を合わせ、${k(b, "interact")} で取引を選ぶ。` },
  { key: "pact", term: "契約", category: "run", body: "灰の公証人と結ぶ条件付きの約束。破るとその場で代償、次の階に着けば報酬。" },
  { key: "elementAltar", term: "属性の祭壇", category: "run", body: "選んだ属性の加護を得る部屋。その階の間、通常攻撃の一部がその属性になる。鍛冶の焼き付けは探索の間ずっと続く。" },
  { key: "library", term: "図書館", category: "run", body: "刻印符を得られる部屋。刻印符は拾うと手持ちに入り、装備画面のスキルの頁で選んで石に付ける（探索ごとに拾い直す）。" },
  { key: "reaper", term: "死神", category: "run", body: "同じ階に長く居ると現れる、倒せない追跡者。" },
  { key: "fork", term: "分岐路", category: "run", body: "最後の部屋の複数の階段。階段ごとに次のバイオームが違う。" },
  { key: "cleared", term: "踏破", category: "run", body: "最深の間（地下 21 階）の主を倒すと、階段のほかに地上への道が現れる。乗り続けると踏破でランが終わる。階段を降りて深みへ進み続けることもできる。最深の主を倒したランは、深みで力尽きても踏破に数える。" },
  {
    key: "deep",
    term: "深み",
    category: "run",
    body: `最深の主を倒した後、階段を降りた先（地下 22 階から）。敵の生命と攻撃が 1 層ごとに掛け算で伸び、${DEEP.mutationEvery} 層ごとに変異（階のイベントが常に効く）が 1 つ積まれる。祝福・遺物の「〜につき」の最大と研鑽の上限が外れる。どこまで潜れるかがビルドの物差し。`,
  },
  {
    key: "exitPreview",
    term: "出口の予告",
    category: "run",
    body: "分岐路の階段の上に、降りた先で手に入る報酬が出る。祝福は系譜の名前つきで、降りると選んだ系譜の札が 3 枚並ぶ（祝福の出口を選ばなかった階では並ばない）。遺物は到着報酬が確定し、銭は初めて着いた階の銭が 3 倍、鍵と瓶は足元の少し先に落ちる。危険は巣窟・闘技場・試練のどれかが 1 つ現れ、制圧の報酬が倍になる。錬磨は持っている札の格を 1 つ上げる。隠し部屋と案内人の階段には予告が出ない。",
  },
  { key: "floorLord", term: "階の主", category: "run", body: "毎階の最後の部屋に出る主。倒すまで階段は出ない。5 の倍数の階はボスが代わりに出る。" },
  { key: "bossDown", term: "ボスの隙", category: "run", body: "ボスは怯み値のほかに、見える形で動きが止まる。壁に突っ込ませる・床の火に焼かせる・技の後の反動を突く・門柱や姿見を割る、など段階ごとに違う隙がある。ボス部屋の取り巻きを倒すとボスの怯み値が溜まる。段階が進む条件も生命だけでなく、冠の割れ・追い詰め・引火・壁への激突・門柱でも進み、段階ごとに危ない間合い（近い・遠い・動く・止まる）が違う。間合いは図鑑の予告の図解で見られる。" },
  {
    key: "bossAnswer",
    term: "ボスの読み",
    category: "run",
    body: "章ボスの技のうち、下絵のうちに殴って止められるのは一部だけ。ほかは最初から墨入れで、避ける・受け流すしかない。スライム王は、跳んだ主を影の輪が下絵のうちに打てば落ちる（墜落）。分裂すると冠をかぶった 1 体がいて、割れば分裂は崩れる（冠落ち）。冠を呑まれると主が回復する。噛みは着地を受け流すと大きなダウンになる（呑み損ね）。読まずに避けるだけでも勝てるが、ダウンは取れず時間がかかる。",
  },
  { key: "thirdFace", term: "第三の顔", category: "run", body: "最深の主の最後の段階。門柱を全部折って陥没を越え、生命が減ると入る。そのランで被弾が多かった章ボス 2 体の技を借り、足元へ落ちる影（奈落の手。止まっていると当たる）と交互に撃つ。借りた技の後は反動で動きが止まる。" },
  { key: "hiddenRoom", term: "隠し部屋", category: "run", body: "稀に生成される、壁の中に隠れた小部屋。ひび割れた壁に近づくと風の音がする。体を押し当て続けると開き、遺物と次の階への階段が出る。ボスの出る階には無い。" },
  {
    key: "deathCause",
    term: "死因 / 次の山",
    category: "run",
    body: "力尽きると、最後に受けた傷の出どころ（敵とその攻撃の種類、状態異常・地形・死神など）と、その敵に倒された回数が出る。次の山は、力尽きた階から先で最初に待つ章の主（か最深の主）。前回比は、前の探索と比べた到達の階・被弾・見切りの差。",
  },
  {
    key: "nemesis",
    term: "仇",
    category: "run",
    body: "力尽きた相手は次の探索で仇になり、倒された階の少し手前から、眠った陣に 1 体だけ混ざる。名札に「仇・」が付き、精鋭の性質が 1 つ増え、猛で生命も多い。討つと遺物と鍵を落とす。仇に倒されるとさらに強くなって戻り、討つか別の相手に倒されるまで追ってくる。今日の挑戦には出ない。",
  },
  {
    key: "unlockGating",
    term: "解放",
    category: "run",
    body: "契約者・追加の部屋・ランイベントは、最初は一部だけが探索に出る。章の主を倒すと部屋と出来事が、依頼を達成すると契約者が増える。図鑑の未踏の部屋と依頼の一覧に開く条件が出る。今日の挑戦は封じない。",
  },
  {
    key: "tierReward",
    term: "位階の見返り",
    category: "run",
    body: "縛りを積んで踏破すると、最高位階に応じて次の探索から章の市の品と出口の階段が増える。強さは増えず、選べる幅が広がる。拠点の踏破の碑に回数と最高位階が出る。今日の挑戦には効かない。",
  },
];

const HUB_TIPS: readonly TipDef[] = [
  { key: "hub", term: "拠点", category: "hub", body: (b) => `探索の合間に戻る場所。台に近づいて ${k(b, "interact")} で開く。石段に踏み込むと支度を選んで出撃し、${k(b, "confirm")} の長押しなら前回の支度のまま出撃する。探索を重ねると設備が増える。` },
  {
    key: "anvilStance",
    term: "金床の構え",
    category: "hub",
    body: "拠点の鍛冶屋で開く装束。部位を選ぶと装備中の遺物とその部位の倉庫が並び、そこから鍛冶の操作を選ぶ。下の壺の水位が残響の量。砕くのは長押しで、倉庫の遺物だけ。",
  },
  { key: "origin", term: "起点", category: "hub", body: "出撃の前に選ぶ出発の条件。最初は放浪者だけで、依頼の報酬で増える。" },
  { key: "runMod", term: "縛り", category: "hub", body: "起点の画面で積む難しさ。点の合計が位階になる。" },
  { key: "quest", term: "依頼", category: "hub", body: "出撃の前に 3 択から 1 つ受けるお題。達成すると次の探索から選べるものが増える。未達成なら次へ引き継ぐ。" },
  { key: "codex", term: "図鑑", category: "hub", body: "見た・起きたものの記録。？は未発見。依頼の報酬「図鑑の頁」で手がかりが増える。" },
  { key: "title", term: "称号", category: "hub", body: "実績と依頼の報酬で得る名前。実績の画面の称号タブで選ぶと名乗れる。効果は持たない。" },
  { key: "altar", term: "社", category: "hub", body: "誓約を 1 つ選んで試せる。試している誓約は拠点を出ると消える。" },
  { key: "rack", term: "武器掛け", category: "hub", body: "全武器種を木人で試せる。決定の長押しで性質なしの武器を借りて出撃できる。" },
  {
    key: "carry",
    term: "持ち込み",
    category: "hub",
    body: `探索へ持ち込めるのは${CARRY.weaponFree ? "右手の武器と、ほかに " : " "}${CARRY.carrySlots} 部位まで。拠点の装備画面の装束で部位を長押しすると、持ち込みの印を付け外しできる（朱の判）。印の無い部位は空で始まり、探索で拾った遺物で埋める。`,
  },
  {
    key: "carryBack",
    term: "持ち帰り",
    category: "hub",
    body: `探索で拾った遺物は袋に入り、倉庫には入らない。探索の終わりに、袋と装備中の拾った遺物から持ち帰る物を選ぶ。力尽きたら ${CARRY.keepOnDeath} つ、踏破なら ${CARRY.keepOnClear} つまで。選ばなかった遺物は消える。持ち込んだ遺物は来歴と芽を積んだまま拠点の装備に戻る。探索の中で砕けるのは袋の遺物だけ。`,
  },
  { key: "loaned", term: "借り物", category: "hub", body: "武器掛けで借りた素の器。保存されず、探索が終わると消える。残響で育てたり砕いたりできない。" },
  { key: "bossHall", term: "御堂", category: "hub", body: "探索で倒した章ボスと最深の主に、今の装備の写しで挑み直せる。祝福は無い。拾った物・探索履歴・図鑑には残らず、封鎖してからの挑戦の数と、撃破の最速・最少の被弾だけが記録される。" },
];

const TIP_DEFS: readonly TipDef[] = [...CONTROL_TIPS, ...COMBAT_TIPS, ...GROWTH_TIPS, ...RELIC_TIPS, ...SKILL_TIPS, ...RUN_TIPS, ...HUB_TIPS];

/** 全項目。binds を省くと現在のキー設定で操作の本文を組む */
export function tipEntries(binds?: Keybinds): TipEntry[] {
  return TIP_DEFS.map((d) => ({
    key: d.key,
    term: d.term,
    category: d.category,
    body: typeof d.body === "string" ? d.body : d.body(binds),
  }));
}

function tipListEntry(t: TipEntry): ListEntry {
  return { key: t.key, known: true, name: t.term, info: "", detail: t.body };
}

/** Tips ノートの画面（src/meta/listScreen.ts の形）。カテゴリごとに 1 タブ */
export function tipsListTabs(binds?: Keybinds): ListTab[] {
  const entries = tipEntries(binds);
  return TIP_CATEGORIES.map((c) => ({
    label: TIP_CATEGORY_LABEL[c],
    entries: entries.filter((t) => t.category === c).map(tipListEntry),
  }));
}
