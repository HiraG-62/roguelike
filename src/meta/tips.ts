import { type Keybinds, SKILL_ACTIONS, keyLabel, moveKeyLabel } from "../core/input";
import { ATTR_LABEL } from "../loot/resonance";
import type { AttrKey } from "../loot/types";
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

function skillKeys(binds: Keybinds | undefined): string {
  return SKILL_ACTIONS.map((a, i) => `スキル ${i + 1}: ${keyLabel(a, { binds })}`).join("、");
}

const CONTROL_TIPS: readonly TipDef[] = [
  { key: "move", term: "移動", category: "controls", body: (b) => `${moveKeyLabel(b)} で移動する。マウスの位置が狙う向き。` },
  { key: "dash", term: "ダッシュ", category: "controls", body: (b) => `${k(b, "dash")}。出だしに無敵がある。回数は HUD の点で、時間で戻る。` },
  { key: "attack1", term: "攻撃 1", category: "controls", body: (b) => `${k(b, "attack")}。武器種ごとの左の連撃。銃の家系なら射撃。` },
  { key: "attack2", term: "攻撃 2", category: "controls", body: (b) => `${k(b, "shoot")}。全武器種に共通の右の連撃。左右の押し方の列でコンボ派生が出る。` },
  { key: "special", term: "奥義", category: "controls", body: (b) => `${k(b, "special")}。奥義ゲージが満ちると出せる。持続の奥義はもう一度 ${k(b, "special")} で終える。武器種ごとの 3 本から装備画面のステータスタブで選ぶ（拠点のみ）。` },
  { key: "skillKeys", term: "スキル石", category: "controls", body: (b) => `${skillKeys(b)}。パッドは LB を押しながら A X Y B。` },
  { key: "interact", term: "拾う", category: "controls", body: (b) => `${k(b, "interact")}。注目している床の遺物・スキル石を倉庫へ入れる。手の届く距離のものだけ。ハート・刻印符は触れれば拾う。` },
  { key: "inventory", term: "装備画面", category: "controls", body: (b) => `${k(b, "inventory")} で開き、押すたびにタブが進む。開いている間は時間が止まる。` },
  { key: "dropInfo", term: "アイテム情報", category: "controls", body: (b) => `${k(b, "toggleDropInfo")} で床のアイテムの性能表示を切り替える。` },
  { key: "restart", term: "やり直す", category: "controls", body: (b) => `${k(b, "restart")} で新しいシードの探索をやり直す。` },
  { key: "keybinds", term: "キー設定", category: "controls", body: "設定 → キー設定で、アクションごとに主 / 副 / 予備の 3 つまで割り当てられる。画面の案内の表記もこれに合わせて変わる。" },
];

const COMBAT_TIPS: readonly TipDef[] = [
  { key: "hp", term: "生命", category: "combat", body: "尽きると探索が終わる。戦闘中の回復には 1 秒あたりの上限がある。" },
  { key: "mana", term: "気力", category: "combat", body: "スキルの資源。通常攻撃の命中・見切り・撃破で溜まり、スキルで減る。" },
  { key: "energy", term: "奥義ゲージ", category: "combat", body: "攻撃を当てると溜まる。満ちると枠が点滅し、奥義を出せる。持続の奥義の間は色が変わり、減っていく。" },
  { key: "justDodge", term: "見切り", category: "combat", body: "ダッシュの無敵中に攻撃を受けて避けた瞬間。時間がゆっくりになり、奥義ゲージが増え、気力が戻る。" },
  { key: "rightChain", term: "右の連撃", category: "combat", body: "攻撃 2 で出す連撃。段の中身は武器種ごとに違う。" },
  { key: "branch", term: "コンボ派生", category: "combat", body: "左右の押し方の列で差し替わる技。連撃がそこで終わるものもある。ジョブ固有の派生もある。" },
  { key: "charge", term: "溜め攻撃", category: "combat", body: "溜めの役割のボタンを長押しして離す近接。長く溜めるほど段が上がる。" },
  { key: "stagger", term: "怯み", category: "combat", body: "攻撃の怯み値が敵の怯み耐性を超えると付く行動停止。解けた直後は堅守が付く。" },
  { key: "guarded", term: "堅守", category: "combat", body: "怯みが解けた直後の状態。受ける怯み値が半減する（ボスは 1/4）。背面の一撃は堅守を無視する。" },
  { key: "counter", term: "カウンター", category: "combat", body: "敵の予備動作中に近接を当てる。ダメージと怯み値が上がる。" },
  { key: "regain", term: "リゲイン", category: "combat", body: "被弾してしばらくの間、近接を当てると失った生命を取り戻せる。" },
  { key: "status", term: "状態異常", category: "combat", body: "敵にも自分にも付く。同じものを積み切ると上位の状態へ昇華する。体力が高いほど自分に付いたものが早く切れる。" },
  { key: "reaction", term: "反応", category: "combat", body: "2 つの状態異常（か地形）が出会ったときの追加効果。図鑑の連携の頁に記録される。" },
  { key: "terrain", term: "地形", category: "combat", body: "床に重なる層（水たまり・油・溶岩・氷床など）。自分にも敵にも効く。" },
];

/** ステータス 5 種の体の性能（装備画面の ？ のヘルプから移した） */
const ATTR_TIP_BODY: Readonly<Record<AttrKey, string>> = {
  str: "体の性能は持たない。係数で参照する行動（武器種の段・スキルなど）の威力・怯み値が伸びる。",
  dex: "移動速度・ダッシュの再使用時間と、係数で参照する行動が伸びる。",
  vit: "最大生命が伸び、自分に付いた状態異常が早く切れる。係数で参照する行動も伸びる。",
  mnd: "最大気力・気力の自然回復と、係数で参照する行動が伸びる。",
  spi: "体の性能は持たない。係数で参照する行動の威力・怯み値・状態異常や強化の効果量が伸びる。",
};

const ATTR_ORDER: readonly AttrKey[] = ["str", "dex", "vit", "mnd", "spi"];

const GROWTH_TIPS: readonly TipDef[] = [
  { key: "attributes", term: "ステータス", category: "growth", body: "筋力・技巧・体力・精神・霊力の 5 つ。探索中に得た点を装備画面で振り分ける（振った点はその探索の間だけ）。" },
  ...ATTR_ORDER.map((a): TipDef => ({ key: `attr_${a}`, term: ATTR_LABEL[a], category: "growth", body: ATTR_TIP_BODY[a] })),
  { key: "effective", term: "実効値", category: "growth", body: "ステータスに逓減を掛けた計算用の値。高く積むほど 1 点あたりの伸びが小さくなる。" },
  {
    key: "formula",
    term: "計算式",
    category: "growth",
    body: "「威力 18 = 10+筋力×1.3+技巧×0.2」は、ステータス 0 のとき 10、実効値 1 点ごとに筋力は 1.3・技巧は 0.2 増えるという意味。左の数は今のステータスでの基礎の値で、装備の倍率・刻印符・祝福・敵の防御はこの後に掛かる。参照の無い行動はステータスで変わらない。",
  },
  { key: "job", term: "ジョブ", category: "growth", body: "起点とは別に選ぶ戦い方。ステータスの偏り・得意な武器・固有のルール・初期スキル石・弱点を持つ。" },
  { key: "favored", term: "得意な武器", category: "growth", body: "ジョブごとの武器種。その武器種を持っている間は近接の威力と攻撃速度が上がる。" },
  { key: "starterWeapon", term: "初期武器", category: "growth", body: "ジョブの得意武器の素の器。同じベースを持っていなければ、出撃のときに渡される。" },
  { key: "starterSkill", term: "初期スキル石", category: "growth", body: "ジョブのスキル石。そのスキルの石を持っていなければ、出撃のときに倉庫に入る。" },
  { key: "weakness", term: "弱点", category: "growth", body: "ジョブの代償。最大生命・射撃の威力・移動速度などが下がる。" },
];

const RELIC_TIPS: readonly TipDef[] = [
  { key: "relic", term: "遺物", category: "relic", body: "装備アイテム。右手・左手・鎧・靴・指輪・首飾りの 6 部位。" },
  { key: "trait", term: "性質", category: "relic", body: "遺物に宿る 1 つの効果。それぞれが響き（色）を持つ。" },
  { key: "flux", term: "揺らぎ", category: "relic", body: "性質の値の、期待値からのずれ。静・揺・荒は揺らぎの見た目の分類で、格付けではない。" },
  { key: "inverted", term: "反転", category: "relic", body: "揺らぎが強く裏返った性質。色は冥になり、共鳴への重みが 2 倍になる。" },
  { key: "hue", term: "響き", category: "relic", body: "性質と共鳴が持つ 5 色（紅・蒼・翠・金・冥）。反対色は紅と蒼、翠と金。" },
  { key: "resonance", term: "共鳴", category: "relic", body: "装備全体の色の配合で発現する効果。同時に 1 つ。1 色が過半なら支配、2 色なら二重、3 色なら三和音。" },
  { key: "colorless", term: "無色", category: "relic", body: "脱色した性質。共鳴の配合に数えず、支配の減衰も受けない。" },
  { key: "provenance", term: "来歴", category: "relic", body: "装備している間に起きた出来事の記録。節目に達すると芽が出る。" },
  { key: "bud", term: "芽", category: "relic", body: "来歴の節目で出る 2 択の成長。選ばなかった方は失われる。" },
  { key: "margin", term: "余白", category: "relic", body: "その遺物があと何回芽吹けるか。無くなるとそれ以上育たない。" },
  { key: "inscription", term: "銘", category: "relic", body: "余白を使い切った遺物に、来歴から刻まれる名前。銘が付いたら成長は完了。" },
  { key: "keystone", term: "誓約", category: "relic", body: "遊び方を大きく変える性質。同じ組の誓約は同時に持てない。拠点の祭壇で試せる。" },
  { key: "echo", term: "残響", category: "relic", body: "遺物を砕くと、性質の色の残響を得る。残響を払って性質を作り替える（装備中の遺物は対象にできない）。" },
  { key: "dye", term: "染め", category: "relic", body: "性質 1 つを、残響の色の別の性質に置き換える。揺らぎは引き継ぐ。" },
  { key: "calm", term: "鎮め", category: "relic", body: "性質 1 つの揺らぎを半分にして期待値へ寄せる。反転も解ける。余白が 1 減る。" },
  { key: "stir", term: "煽り", category: "relic", body: "性質 1 つの揺らぎを大きく引き直す。反転することもある。" },
  { key: "pare", term: "削ぎ", category: "relic", body: "性質 1 つを消し、余白を 1 戻す（器の容量まで）。" },
  { key: "transfer", term: "移し", category: "relic", body: "銘か芽吹いた性質 1 つを、同じ部位の別の遺物へ移す。元の遺物は失われ、受け手の余白を 1 使う。" },
  { key: "modulate", term: "転調", category: "relic", body: "性質 1 つの効果はそのままに、色だけを反対色へ変える（紅と蒼、翠と金。冥は翠へ）。" },
  { key: "bleach", term: "脱色", category: "relic", body: "性質 1 つを無色にする。値は 9 割になる。" },
  { key: "recall", term: "呼び戻し", category: "relic", body: "過去の芽で選ばなかった方を取り直す。代わりに選んでいた方を失う。1 つの遺物に 1 回だけ。" },
  { key: "pour", term: "注ぎ", category: "relic", body: "遺物を捧げ、その来歴の半分を同じ部位の別の遺物へ注ぐ。捧げた遺物は消える。" },
  { key: "reforge", term: "鍛え直し", category: "relic", body: "性質 1 つの期待値を、来歴の最深で取り直す。揺らぎはそのまま。余白の上限が 1 減る。" },
  { key: "tension", term: "張り", category: "relic", body: "代償付きの性質 1 つの利得と代償を両方強める。鎮めでも戻らない。" },
  { key: "flow", term: "流れ", category: "relic", body: "燃焼・ダッシュ・瀕死などの状況の単位。源はその状況を起こす側、糧はその状況で強くなる側。源だけなら溢れ、糧だけなら枯れ。" },
];

const SKILL_TIPS: readonly TipDef[] = [
  { key: "stone", term: "スキル石", category: "skill", body: "スロット 1〜4 に装着して撃つスキル。拾った石は倉庫に入り、探索を越えて持ち越す。" },
  { key: "manaType", term: "気力型", category: "skill", body: "撃つたびに気力を払うスキル。" },
  { key: "cooldownType", term: "再使用型", category: "skill", body: "撃つと再使用時間が経つまで撃てないスキル。" },
  { key: "rune", term: "刻印符", category: "skill", body: "スキル石のリンクに付ける修飾。拾うと所持品に入り、装備画面で石に付け外しする。石と一緒に持ち越す。" },
  { key: "link", term: "リンク", category: "skill", body: "石に付けた刻印符の数。多いほど負担（気力のコスト / 再使用時間）が重くなる。" },
  { key: "combo", term: "連携", category: "skill", body: "スキルの直後に別のスキルを撃つと、後の方が変化する。HUD の枠の点滅する菱形が連携可の印。図鑑の連携の頁は、連携・反応・連鎖を初めて起こすと数える。" },
  { key: "form", term: "変身", category: "skill", body: "一定の間、武器種が変わる強化スキル。変身中の攻撃 1・攻撃 2 は変身先の技になる。" },
];

const RUN_TIPS: readonly TipDef[] = [
  { key: "boon", term: "祝福", category: "run", body: "階に着くと出る 3 択。その探索の間だけ効く。" },
  { key: "boonGrade", term: "祝福の格", category: "run", body: "札ごとに抽選される大祝福・神威。効果量が上がり、範囲も広がる（神威は発動の間隔も縮む）。深いほど出やすい。" },
  { key: "core", term: "芯", category: "run", body: "1 回の探索に 1 つだけ持てる大型の祝福。遊び方を変える効果と代償を持ち、芯と重なる祝福が以後出やすい。" },
  { key: "cursed", term: "呪い付き", category: "run", body: "強い効果と代償を併せ持つ祝福。" },
  { key: "takeCurse", term: "呪いを受けて 4 択", category: "run", body: "祝福の 3 択で呪い付きの祝福を 1 つ受ける代わりに、4 枚目の候補が加わる。" },
  { key: "lineage", term: "系譜", category: "run", body: "同じ主から出る 4 段の祝福。前の段を持つと次の段が 3 択に出る。" },
  { key: "clue", term: "手がかり", category: "run", body: "祝福の 3 択に出る、今のビルドで成立し得る未発見の連携。" },
  { key: "engaged", term: "交戦", category: "run", body: "部屋に入る、または部屋の敵に気付かれた状態。扉が閉じる部屋（封鎖）もある。" },
  { key: "shards", term: "欠片", category: "run", body: "探索の間だけ集まる資源。契約者との取引と封印庫の解錠に使う。探索が終わると消える。" },
  { key: "contractor", term: "契約者", category: "run", body: "階の入口に立つ人物。台座に触れて取引を選ぶ。" },
  { key: "pact", term: "契約", category: "run", body: "灰の公証人と結ぶ条件付きの約束。破るとその場で代償、次の階に着けば報酬。" },
  { key: "elementAltar", term: "属性の祭壇", category: "run", body: "選んだ属性の加護を得る部屋。その階の間、通常攻撃の一部がその属性になる。鍛冶の焼き付けは探索の間ずっと続く。" },
  { key: "library", term: "図書館", category: "run", body: "刻印符を得られる部屋。刻印符は装備画面で石に付ける。" },
  { key: "reaper", term: "死神", category: "run", body: "同じ階に長く居ると現れる、倒せない追跡者。" },
  { key: "fork", term: "分岐路", category: "run", body: "最後の部屋の複数の階段。階段ごとに次のバイオームが違う。" },
];

const HUB_TIPS: readonly TipDef[] = [
  { key: "hub", term: "拠点", category: "hub", body: (b) => `探索の合間に戻る場所。台に近づいて ${k(b, "interact")} で開き、${k(b, "confirm")} の長押しで出撃する。探索を重ねると設備が増える。` },
  { key: "origin", term: "起点", category: "hub", body: "出撃の前に選ぶ出発の条件。依頼の報酬で増える。" },
  { key: "runMod", term: "縛り", category: "hub", body: "起点の画面で積む難しさ。点の合計が位階になる。" },
  { key: "quest", term: "依頼", category: "hub", body: "出撃の前に 3 択から 1 つ受けるお題。達成すると次の探索から選べるものが増える。未達成なら次へ引き継ぐ。" },
  { key: "codex", term: "図鑑", category: "hub", body: "見た・起きたものの記録。？は未発見。依頼の報酬「図鑑の頁」で手がかりが増える。" },
  { key: "title", term: "称号", category: "hub", body: "実績と依頼の報酬で得る名前。実績の画面の称号タブで選ぶと名乗れる。効果は持たない。" },
  { key: "altar", term: "祭壇", category: "hub", body: "誓約を 1 つ選んで試せる。試している誓約は拠点を出ると消える。" },
  { key: "rack", term: "武器掛け", category: "hub", body: "全武器種を木人で試せる。決定の長押しで性質なしの武器を借りて出撃できる。" },
  { key: "loaned", term: "借り物", category: "hub", body: "武器掛けで借りた素の器。保存されず、探索が終わると消える。残響で育てたり砕いたりできない。" },
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
